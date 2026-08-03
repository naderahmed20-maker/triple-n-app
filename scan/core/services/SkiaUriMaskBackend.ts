// scan/core/services/SkiaUriMaskBackend.ts
//
// Triple N - EdgeSAM URI Mask Backend
//
// اسم الملف واسم Backend القديم محفوظان
// للتوافق مع الاستيرادات الحالية.
//
// التنفيذ الفعلي:
//
// URI
// → EdgeSAM Preprocessor
// → EdgeSAM Image Encoder
// → Automatic Prompt
// → EdgeSAM Mask Decoder
// → Postprocessor
// → Soft Alpha Mask

import {
  runSegmentationEngine,
} from '../ai/SegmentationEngine';

import {
  createSegmentationCancellationController,
  isSegmentationError,
  type SegmentationCancellationController,
  type SegmentationResult,
} from '../ai/types';

import {
  type AlphaMask,
  type MaskBackendResult,
  type MaskGenerationBackend,
  type MaskImageSource,
} from '../ai/MaskGenerator';

/* =========================================================
 * Public configuration
 * ======================================================= */

/**
 * إعدادات URI Backend النهائي.
 *
 * الاسم محفوظ للتوافق مع الملفات القديمة،
 * لكن التنفيذ الحالي لا يستخدم Skia
 * أو فصل الخلفية حسب اللون.
 */
export type SkiaUriMaskBackendConfig = {
  /**
   * إعادة استخدام Image Embedding
   * عند معالجة المصدر نفسه.
   *
   * الافتراضي true.
   */
  reuseSession:
    boolean;

  /**
   * تفعيل Diagnostics.
   *
   * يفضل أن تبقى false في التشغيل العادي.
   */
  collectDiagnostics:
    boolean;

  /**
   * أقل نسبة Foreground منطقية.
   *
   * تستخدم لحساب ثقة Backend فقط.
   */
  minimumForegroundRatio:
    number;

  /**
   * أكبر نسبة Foreground منطقية.
   *
   * تستخدم لحساب ثقة Backend فقط.
   */
  maximumForegroundRatio:
    number;

  /**
   * الخصائص التالية محفوظة فقط
   * حتى لا تنكسر الاستدعاءات القديمة
   * الخاصة بإصدار Skia السابق.
   *
   * لا تستخدم داخل EdgeSAM.
   */
  maximumAnalysisSide?:
    number;

  minimumColorDistance?:
    number;

  backgroundTolerance?:
    number;

  neighborTolerance?:
    number;

  borderSampleRatio?:
    number;

  minimumSourceAlpha?:
    number;

  luminanceWeight?:
    number;

  chromaWeight?:
    number;
};

/* =========================================================
 * Defaults
 * ======================================================= */

const DEFAULT_SKIA_URI_MASK_BACKEND_CONFIG:
  SkiaUriMaskBackendConfig = {
    reuseSession:
      true,

    collectDiagnostics:
      false,

    minimumForegroundRatio:
      0.003,

    maximumForegroundRatio:
      0.975,
  };

/* =========================================================
 * Numeric helpers
 * ======================================================= */

function clamp(
  value:
    number,
  minimum:
    number,
  maximum:
    number
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function finiteOr(
  value:
    number | undefined,
  fallback:
    number
): number {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  )
    ? value
    : fallback;
}

/* =========================================================
 * Configuration resolution
 * ======================================================= */

function resolveBackendConfig(
  custom?:
    Partial<
      SkiaUriMaskBackendConfig
    >
): SkiaUriMaskBackendConfig {
  const resolvedMinimum =
    clamp(
      finiteOr(
        custom
          ?.minimumForegroundRatio,
        DEFAULT_SKIA_URI_MASK_BACKEND_CONFIG
          .minimumForegroundRatio
      ),
      0,
      1
    );

  const resolvedMaximum =
    clamp(
      finiteOr(
        custom
          ?.maximumForegroundRatio,
        DEFAULT_SKIA_URI_MASK_BACKEND_CONFIG
          .maximumForegroundRatio
      ),
      0,
      1
    );

  return {
    ...DEFAULT_SKIA_URI_MASK_BACKEND_CONFIG,

    ...custom,

    reuseSession:
      typeof custom
        ?.reuseSession ===
      'boolean'
        ? custom.reuseSession
        : DEFAULT_SKIA_URI_MASK_BACKEND_CONFIG
            .reuseSession,

    collectDiagnostics:
      typeof custom
        ?.collectDiagnostics ===
      'boolean'
        ? custom
            .collectDiagnostics
        : DEFAULT_SKIA_URI_MASK_BACKEND_CONFIG
            .collectDiagnostics,

    minimumForegroundRatio:
      Math.min(
        resolvedMinimum,
        resolvedMaximum
      ),

    maximumForegroundRatio:
      Math.max(
        resolvedMinimum,
        resolvedMaximum
      ),
  };
}

/* =========================================================
 * URI helpers
 * ======================================================= */

function normalizeImageUri(
  uri:
    string
): string {
  return uri.trim();
}

function throwIfAborted(
  signal?:
    AbortSignal
): void {
  if (
    signal
      ?.aborted
  ) {
    const error =
      new Error(
        'EdgeSAM URI segmentation was aborted.'
      );

    error.name =
      'AbortError';

    throw error;
  }
}

/* =========================================================
 * Abort bridge
 * ======================================================= */

/**
 * ينقل AbortSignal المستخدم داخل
 * MaskGenerator إلى CancellationSignal
 * المستخدم داخل EdgeSAM.
 */
function createAbortBridge(
  abortSignal?:
    AbortSignal
): {
  controller:
    SegmentationCancellationController;

  dispose:
    () => void;
} {
  const controller =
    createSegmentationCancellationController();

  const abortHandler =
    () => {
      controller.cancel(
        'EdgeSAM URI segmentation was aborted.'
      );
    };

  if (
    abortSignal
      ?.aborted
  ) {
    abortHandler();
  } else {
    abortSignal
      ?.addEventListener(
        'abort',
        abortHandler,
        {
          once:
            true,
        }
      );
  }

  return {
    controller,

    dispose() {
      abortSignal
        ?.removeEventListener(
          'abort',
          abortHandler
        );
    },
  };
}

/* =========================================================
 * Alpha-mask conversion
 * ======================================================= */

/**
 * يحول Alpha Mask الخاص بطبقة EdgeSAM
 * إلى AlphaMask الخاص بـMaskGenerator.
 *
 * ننشئ نسخة مستقلة لحماية حدود الطبقات
 * ومنع تعديل نفس Buffer من مكان آخر.
 */
function createMaskFromSegmentationResult(
  result:
    SegmentationResult
): AlphaMask {
  const mask =
    result.alphaMask;

  const expectedLength =
    mask.width *
    mask.height;

  if (
    !Number.isInteger(
      mask.width
    ) ||
    !Number.isInteger(
      mask.height
    ) ||
    mask.width <=
      0 ||
    mask.height <=
      0 ||
    !(
      mask.data instanceof
      Uint8Array
    ) ||
    mask.data.length !==
      expectedLength
  ) {
    throw new Error(
      'EdgeSAM returned an invalid alpha mask.'
    );
  }

  /**
   * لا نحول الماسك إلى Binary.
   *
   * نحتفظ بقيم Alpha من 0 إلى 255
   * لحماية الحواف والـFeather.
   */
  return {
    width:
      mask.width,

    height:
      mask.height,

    data:
      new Uint8Array(
        mask.data
      ),
  };
}

/* =========================================================
 * Backend confidence
 * ======================================================= */

/**
 * حساب ثقة Backend من نتيجة EdgeSAM.
 *
 * لا نعتمد على شكل القطعة أو امتلاء
 * مساحة معينة؛ لأن القطعة قد تكون:
 *
 * - رفيعة.
 * - صغيرة.
 * - طويلة.
 * - غير منتظمة.
 */
function calculateEdgeSamConfidence(
  result:
    SegmentationResult,
  config:
    SkiaUriMaskBackendConfig
): number {
  const statistics =
    result.maskStatistics;

  if (
    statistics
      .foregroundPixels <=
      0 ||
    statistics.maximum <=
      0
  ) {
    return 0;
  }

  const foregroundRatio =
    statistics
      .foregroundRatio;

  const ratioScore =
    foregroundRatio >=
      config
        .minimumForegroundRatio &&
    foregroundRatio <=
      config
        .maximumForegroundRatio
      ? 1
      : foregroundRatio <
          config
            .minimumForegroundRatio
        ? clamp(
            foregroundRatio /
              Math.max(
                config
                  .minimumForegroundRatio,
                0.000001
              ),
            0,
            1
          )
        : clamp(
            (
              1 -
              foregroundRatio
            ) /
              Math.max(
                1 -
                  config
                    .maximumForegroundRatio,
                0.000001
              ),
            0,
            1
          );

  /**
   * وجود Semi-transparent Pixels
   * يشير إلى بقاء حواف ناعمة.
   *
   * عدم وجودها لا يعني فشلًا.
   */
  const edgeQualityScore =
    statistics
      .semiTransparentPixels >
    0
      ? 1
      : 0.82;

  /**
   * minimum وmaximum في Alpha Mask
   * يكونان على نطاق 0..255.
   */
  const dynamicRangeScore =
    clamp(
      (
        statistics.maximum -
        statistics.minimum
      ) /
        255,
      0,
      1
    );

  const largestComponentScore =
    clamp(
      statistics
        .largestComponentRatio,
      0,
      1
    );

  return clamp(
    0.58 +
      ratioScore *
        0.2 +
      edgeQualityScore *
        0.07 +
      dynamicRangeScore *
        0.07 +
      largestComponentScore *
        0.08,
    0,
    1
  );
}

/* =========================================================
 * Metadata
 * ======================================================= */

function createBackendMetadata(
  result:
    SegmentationResult
): NonNullable<
  MaskBackendResult[
    'metadata'
  ]
> {
  return {
    engine:
      'edgesam-onnx',

    requestId:
      result.requestId,

    originalWidth:
      result
        .originalSize
        .width,

    originalHeight:
      result
        .originalSize
        .height,

    modelInputWidth:
      result
        .modelInputSize
        .width,

    modelInputHeight:
      result
        .modelInputSize
        .height,

    maskWidth:
      result
        .alphaMask
        .width,

    maskHeight:
      result
        .alphaMask
        .height,

    foregroundPixels:
      result
        .maskStatistics
        .foregroundPixels,

    backgroundPixels:
      result
        .maskStatistics
        .backgroundPixels,

    semiTransparentPixels:
      result
        .maskStatistics
        .semiTransparentPixels,

    foregroundRatio:
      result
        .maskStatistics
        .foregroundRatio,

    preprocessingMs:
      result
        .timings
        .preprocessingMs,

    sessionLoadMs:
      result
        .timings
        .sessionLoadMs,

    encoderInferenceMs:
      result
        .timings
        .encoderInferenceMs,

    decoderInferenceMs:
      result
        .timings
        .decoderInferenceMs,

    inferenceMs:
      result
        .timings
        .encoderInferenceMs +
      result
        .timings
        .decoderInferenceMs,

    postprocessingMs:
      result
        .timings
        .postprocessingMs,

    totalMs:
      result
        .timings
        .totalMs,
  };
}

/* =========================================================
 * Error normalization
 * ======================================================= */

function normalizeSegmentationBackendError(
  error:
    unknown
): Error {
  if (
    isSegmentationError(
      error
    )
  ) {
    const cancelled =
      error.code ===
        'CANCELLED' ||
      error.code ===
        'REQUEST_CANCELLED';

    const normalized =
      new Error(
        `EdgeSAM segmentation failed [${error.code}]: ${error.message}`
      );

    normalized.name =
      cancelled
        ? 'AbortError'
        : 'EdgeSamSegmentationError';

    return normalized;
  }

  if (
    error instanceof
      Error
  ) {
    return error;
  }

  return new Error(
    `EdgeSAM segmentation failed: ${String(
      error
    )}`
  );
}

/* =========================================================
 * Backend creation
 * ======================================================= */

/**
 * ينشئ URI Backend النهائي.
 *
 * اسم createSkiaUriMaskBackend محفوظ
 * لمنع كسر الاستيرادات القديمة.
 *
 * لا يوجد Skia Color Segmentation
 * داخل التنفيذ الحالي.
 */
export function createSkiaUriMaskBackend(
  customConfig?:
    Partial<
      SkiaUriMaskBackendConfig
    >
): MaskGenerationBackend {
  const config =
    resolveBackendConfig(
      customConfig
    );

  return {
    /**
     * ID جديد يوضح أن التنفيذ الفعلي
     * يتم باستخدام EdgeSAM ONNX.
     */
    id:
      'edgesam-onnx-uri',

    supports(
      source:
        MaskImageSource
    ): boolean {
      return (
        source.type ===
          'uri' &&
        Boolean(
          source.uri
            .trim()
        )
      );
    },

    async generate(
      source,
      options
    ): Promise<MaskBackendResult> {
      if (
        source.type !==
        'uri'
      ) {
        throw new Error(
          'EdgeSAM URI backend requires a URI image source.'
        );
      }

      throwIfAborted(
        options.signal
      );

      const uri =
        normalizeImageUri(
          source.uri
        );

      if (!uri) {
        throw new Error(
          'EdgeSAM URI backend received an empty image URI.'
        );
      }

      const abortBridge =
        createAbortBridge(
          options.signal
        );

      try {
        const result =
          await runSegmentationEngine({
            source: {
              uri,

              width:
                source.width,

              height:
                source.height,

              id:
                `mask-backend:${uri}`,
            },

            options: {
              cancellationSignal:
                abortBridge
                  .controller
                  .signal,

              /**
               * الاسم القديم في Backend:
               * reuseSession.
               *
               * عقد المحرك الجديد:
               * reuseEmbedding.
               */
              reuseEmbedding:
                config
                  .reuseSession,

              collectDiagnostics:
                config
                  .collectDiagnostics,

              waitForCurrentRequest:
                true,
            },
          });

        throwIfAborted(
          options.signal
        );

        const mask =
          createMaskFromSegmentationResult(
            result
          );

        const confidence =
          calculateEdgeSamConfidence(
            result,
            config
          );

        return {
          mask,

          confidence,

          metadata:
            createBackendMetadata(
              result
            ),
        };
      } catch (error) {
        throw normalizeSegmentationBackendError(
          error
        );
      } finally {
        abortBridge
          .dispose();
      }
    },
  };
}

/* =========================================================
 * Default backend
 * ======================================================= */

/**
 * الاسم محفوظ للتوافق مع:
 *
 * registerDefaultUriMaskBackend()
 *
 * لكنه الآن يشغّل EdgeSAM ONNX
 * وليس Skia Background Removal.
 */
export const skiaUriMaskBackend =
  createSkiaUriMaskBackend();

export default
  skiaUriMaskBackend;