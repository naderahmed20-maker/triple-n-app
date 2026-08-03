// scan/core/ai/LocalSegmentationService.ts
//
// Triple N - Local EdgeSAM Segmentation Service
//
// الخدمة الموحدة لتشغيل الفصل المحلي وتصدير
// الصورة النهائية كملف PNG شفاف.
//
// التدفق:
//
// sourceUri
// → SegmentationEngine
// → EdgeSAM AlphaMask
// → TransparentMaskExporter
// → Transparent PNG URI

import type {
  AlphaMask,
} from './MaskGenerator';

import {
  exportTransparentMask,
  type ExportTransparentMaskResult,
} from '../services/TransparentMaskExporter';

import {
  disposeSharedSegmentationEngine,
  getSharedSegmentationEngine,
  initializeSegmentationEngine,
  runSegmentationEngine,
} from './SegmentationEngine';

import type {
  SegmentationCancellationSignal,
  SegmentationDiagnostics,
  SegmentationMaskStatistics,
  SegmentationProgressCallback,
  SegmentationProgressEvent,
  SegmentationResult,
  SegmentationTimings,
} from './types';

import {
  SegmentationError,
  createSegmentationCancellationController,
  createSegmentationRequestId,
  getUnknownErrorMessage,
  isSegmentationError,
  isValidAlphaMask,
} from './types';

/* =========================================================
 * Public types
 * ======================================================= */

export type LocalSegmentationProgressStage =
  | 'segmentation'
  | 'exporting'
  | 'complete';

export type LocalSegmentationProgressEvent = {
  requestId:
    string;

  /**
   * المرحلة العامة داخل الخدمة.
   */
  stage:
    LocalSegmentationProgressStage;

  /**
   * مرحلة محرك EdgeSAM التفصيلية.
   *
   * تكون موجودة أثناء مرحلة
   * segmentation فقط.
   */
  segmentationStage?:
    SegmentationProgressEvent['stage'];

  /**
   * النسبة من 0 إلى 1.
   */
  progress:
    number;

  message:
    string;

  elapsedMs:
    number;
};

export type LocalSegmentationProgressCallback = (
  event:
    LocalSegmentationProgressEvent
) => void;

export type LocalSegmentationServiceInput = {
  sourceUri:
    string;

  /**
   * معرّف اختياري لتتبع العملية.
   */
  requestId?:
    string;

  /**
   * اسم بداية ملف PNG النهائي.
   */
  fileNamePrefix?:
    string;

  /**
   * قيمة من 0 إلى 100.
   */
  quality?:
    number;

  /**
   * إعادة استخدام Image Embedding
   * إذا كان المصدر نفسه موجودًا في Cache.
   *
   * الافتراضي true.
   *
   * نحافظ على اسم reuseSession مؤقتًا
   * حتى لا نكسر الشاشات القديمة.
   */
  reuseSession?:
    boolean;

  /**
   * إضافة معلومات تشخيصية للنتيجة.
   */
  collectDiagnostics?:
    boolean;

  onProgress?:
    LocalSegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

export type LocalSegmentationServiceResult = {
  requestId:
    string;

  sourceUri:
    string;

  transparentImageUri:
    string;

  width:
    number;

  height:
    number;

  alphaMask:
    AlphaMask;

  maskStatistics:
    SegmentationMaskStatistics;

  timings:
    SegmentationTimings;

  segmentation:
    SegmentationResult;

  export:
    ExportTransparentMaskResult;

  diagnostics?:
    SegmentationDiagnostics;

  totalMs:
    number;

  createdAt:
    number;
};

export type TryLocalSegmentationResult =
  | {
      success:
        true;

      result:
        LocalSegmentationServiceResult;
    }
  | {
      success:
        false;

      error:
        LocalSegmentationServiceError;
    };

export type LocalSegmentationServiceErrorCode =
  | 'INVALID_SOURCE'
  | 'SEGMENTATION_FAILED'
  | 'INVALID_MASK'
  | 'EXPORT_FAILED'
  | 'CANCELLED'
  | 'DISPOSED'
  | 'UNKNOWN';

export class LocalSegmentationServiceError
  extends Error {
  readonly code:
    LocalSegmentationServiceErrorCode;

  readonly requestId?:
    string;

  readonly causeValue?:
    unknown;

  readonly segmentationError?:
    SegmentationError;

  constructor(
    code:
      LocalSegmentationServiceErrorCode,
    message:
      string,
    options: {
      requestId?:
        string;

      causeValue?:
        unknown;

      segmentationError?:
        SegmentationError;
    } = {}
  ) {
    super(
      message
    );

    this.name =
      'LocalSegmentationServiceError';

    this.code =
      code;

    this.requestId =
      options.requestId;

    this.causeValue =
      options.causeValue;

    this.segmentationError =
      options.segmentationError;

    Object.setPrototypeOf(
      this,
      LocalSegmentationServiceError
        .prototype
    );
  }
}

/* =========================================================
 * Constants
 * ======================================================= */

/**
 * نخصص أول 95% لعملية EdgeSAM.
 *
 * آخر 5% يكون لإنشاء وحفظ
 * ملف PNG الشفاف.
 */
const SEGMENTATION_PROGRESS_WEIGHT =
  0.95;

const EXPORT_PROGRESS_START =
  SEGMENTATION_PROGRESS_WEIGHT;

/* =========================================================
 * Active cancellation
 * ======================================================= */

/**
 * Controller داخلي للطلب الذي يعمل حاليًا.
 *
 * يتم استخدامه عندما لا ترسل الشاشة
 * cancellationSignal خارجيًا.
 */
let activeCancellationController:
  ReturnType<
    typeof createSegmentationCancellationController
  > | null =
    null;

let activeSegmentationRequestId:
  string | null =
    null;

/* =========================================================
 * General helpers
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function clampUnit(
  value:
    number
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value
    )
  );
}

function validateSourceUri(
  sourceUri:
    string,
  requestId:
    string
): string {
  if (
    typeof sourceUri !==
      'string' ||
    sourceUri.trim().length ===
      0
  ) {
    throw new LocalSegmentationServiceError(
      'INVALID_SOURCE',
      'The source image URI is missing.',
      {
        requestId,
      }
    );
  }

  return sourceUri.trim();
}

function assertNotCancelled(
  signal?:
    SegmentationCancellationSignal
): void {
  signal?.throwIfCancelled();
}

function safelyEmitProgress(
  callback:
    LocalSegmentationProgressCallback | undefined,
  event:
    LocalSegmentationProgressEvent
): void {
  if (!callback) {
    return;
  }

  try {
    callback(
      event
    );
  } catch (error) {
    /**
     * خطأ Callback من الواجهة
     * لا يجب أن يوقف الفصل.
     */
    console.log(
      'LOCAL SEGMENTATION PROGRESS CALLBACK ERROR:',
      error
    );
  }
}

function createServiceCancellationSignal(
  suppliedSignal?:
    SegmentationCancellationSignal
): {
  signal:
    SegmentationCancellationSignal;

  internallyOwned:
    boolean;
} {
  if (suppliedSignal) {
    return {
      signal:
        suppliedSignal,

      internallyOwned:
        false,
    };
  }

  const controller =
    createSegmentationCancellationController();

  activeCancellationController =
    controller;

  return {
    signal:
      controller.signal,

    internallyOwned:
      true,
  };
}

function releaseActiveCancellationController(
  requestId:
    string,
  internallyOwned:
    boolean
): void {
  if (
    activeSegmentationRequestId ===
    requestId
  ) {
    activeSegmentationRequestId =
      null;
  }

  if (
    internallyOwned
  ) {
    activeCancellationController =
      null;
  }
}

/* =========================================================
 * Alpha-mask conversion
 * ======================================================= */

function convertSegmentationMask(
  result:
    SegmentationResult,
  requestId:
    string
): AlphaMask {
  const sourceMask:
    unknown =
    result.alphaMask;

  if (
    !isValidAlphaMask(
      sourceMask
    )
  ) {
    throw new LocalSegmentationServiceError(
      'INVALID_MASK',
      'The segmentation engine returned an invalid alpha mask.',
      {
        requestId,
      }
    );
  }

  return {
    width:
      sourceMask.width,

    height:
      sourceMask.height,

    data:
      new Uint8Array(
        sourceMask.data
      ),
  };
}

/* =========================================================
 * Error normalization
 * ======================================================= */

function normalizeServiceError(
  error:
    unknown,
  requestId:
    string,
  fallbackCode:
    LocalSegmentationServiceErrorCode
): LocalSegmentationServiceError {
  if (
    error instanceof
      LocalSegmentationServiceError
  ) {
    return error;
  }

  if (
    isSegmentationError(
      error
    )
  ) {
    if (
      error.code ===
        'CANCELLED' ||
      error.code ===
        'REQUEST_CANCELLED'
    ) {
      return new LocalSegmentationServiceError(
        'CANCELLED',
        error.message,
        {
          requestId,

          causeValue:
            error,

          segmentationError:
            error,
        }
      );
    }

    if (
      error.code ===
        'ENGINE_DISPOSED' ||
      error.code ===
        'SESSION_DISPOSED'
    ) {
      return new LocalSegmentationServiceError(
        'DISPOSED',
        error.message,
        {
          requestId,

          causeValue:
            error,

          segmentationError:
            error,
        }
      );
    }

    return new LocalSegmentationServiceError(
      'SEGMENTATION_FAILED',
      error.message,
      {
        requestId,

        causeValue:
          error,

        segmentationError:
          error,
      }
    );
  }

  return new LocalSegmentationServiceError(
    fallbackCode,
    getUnknownErrorMessage(
      error
    ),
    {
      requestId,

      causeValue:
        error,
    }
  );
}

/* =========================================================
 * Main operation
 * ======================================================= */

/**
 * يشغّل EdgeSAM محليًا ثم ينشئ
 * ملف PNG شفافًا.
 */
export async function createLocalTransparentImage(
  input:
    LocalSegmentationServiceInput
): Promise<LocalSegmentationServiceResult> {
  const requestId =
    input.requestId ??
    createSegmentationRequestId();

  const startedAt =
    now();

  const sourceUri =
    validateSourceUri(
      input.sourceUri,
      requestId
    );

  const cancellation =
    createServiceCancellationSignal(
      input.cancellationSignal
    );

  const cancellationSignal =
    cancellation.signal;

  activeSegmentationRequestId =
    requestId;

  try {
    assertNotCancelled(
      cancellationSignal
    );

   const segmentationProgress:
  SegmentationProgressCallback | undefined =
  input.onProgress
    ? event => {
        safelyEmitProgress(
          input.onProgress,
          {
            requestId,

            stage:
              'segmentation',

            segmentationStage:
              event.stage,

            progress:
              clampUnit(
                event.progress *
                SEGMENTATION_PROGRESS_WEIGHT
              ),

            message:
              event.message,

            elapsedMs:
              Math.max(
                0,
                now() -
                  startedAt
              ),
          }
        );
      }
    : undefined;

    let segmentation:
      SegmentationResult;

    try {
      segmentation =
        await runSegmentationEngine({
          source: {
            uri:
              sourceUri,
          },

          options: {
            requestId,

            onProgress:
              segmentationProgress,

            cancellationSignal,

            /**
             * الاسم القديم في الخدمة هو
             * reuseSession.
             *
             * عقد المحرك الجديد يستخدم
             * reuseEmbedding.
             */
            reuseEmbedding:
              input.reuseSession ??
              true,

            collectDiagnostics:
              input.collectDiagnostics ??
              false,

            waitForCurrentRequest:
              true,
          },
        });
    } catch (error) {
      throw normalizeServiceError(
        error,
        requestId,
        'SEGMENTATION_FAILED'
      );
    }

    assertNotCancelled(
      cancellationSignal
    );

    const alphaMask =
      convertSegmentationMask(
        segmentation,
        requestId
      );

    safelyEmitProgress(
      input.onProgress,
      {
        requestId,

        stage:
          'exporting',

        progress:
          EXPORT_PROGRESS_START,

        message:
          'Creating the transparent PNG image.',

        elapsedMs:
          Math.max(
            0,
            now() -
              startedAt
          ),
      }
    );

    let exported:
      ExportTransparentMaskResult;

    try {
      exported =
        await exportTransparentMask({
          sourceUri,

          mask:
            alphaMask,

          quality:
            input.quality ??
            100,

          fileNamePrefix:
            input.fileNamePrefix ??
            'scan-item',
        });
    } catch (error) {
      /**
       * بعد بداية Export لا يمكن إيقاف
       * Skia في منتصف العملية.
       *
       * لذلك نتحقق من الإلغاء قبل
       * إرجاع خطأ التصدير.
       */
      try {
        assertNotCancelled(
          cancellationSignal
        );
      } catch (cancellationError) {
        throw normalizeServiceError(
          cancellationError,
          requestId,
          'CANCELLED'
        );
      }

      throw new LocalSegmentationServiceError(
        'EXPORT_FAILED',
        `Could not create the transparent PNG: ${getUnknownErrorMessage(
          error
        )}`,
        {
          requestId,

          causeValue:
            error,
        }
      );
    }

    assertNotCancelled(
      cancellationSignal
    );

    const completedAt =
      now();

    safelyEmitProgress(
      input.onProgress,
      {
        requestId,

        stage:
          'complete',

        progress:
          1,

        message:
          'Transparent image created successfully.',

        elapsedMs:
          Math.max(
            0,
            completedAt -
              startedAt
          ),
      }
    );

    const result:
      LocalSegmentationServiceResult = {
      requestId,

      sourceUri,

      transparentImageUri:
        exported.uri,

      width:
        exported.width,

      height:
        exported.height,

      alphaMask,

      maskStatistics:
        segmentation
          .maskStatistics,

      timings:
        segmentation.timings,

      segmentation,

      export:
        exported,

      totalMs:
        Math.max(
          0,
          completedAt -
            startedAt
        ),

      createdAt:
        exported.createdAt,
    };

    if (
      segmentation
        .diagnostics
    ) {
      result.diagnostics =
        segmentation
          .diagnostics;
    }

    return result;
  } finally {
    releaseActiveCancellationController(
      requestId,
      cancellation
        .internallyOwned
    );
  }
}

/**
 * نسخة آمنة لا ترمي Error.
 */
export async function tryCreateLocalTransparentImage(
  input:
    LocalSegmentationServiceInput
): Promise<TryLocalSegmentationResult> {
  const requestId =
    input.requestId ??
    createSegmentationRequestId();

  try {
    return {
      success:
        true,

      result:
        await createLocalTransparentImage({
          ...input,

          requestId,
        }),
    };
  } catch (error) {
    return {
      success:
        false,

      error:
        normalizeServiceError(
          error,
          requestId,
          'UNKNOWN'
        ),
    };
  }
}

/* =========================================================
 * Session initialization
 * ======================================================= */

/**
 * تحميل جلسات EdgeSAM دون تشغيل صورة.
 */
export async function initializeLocalSegmentation(
  input: {
    requestId?:
      string;

    onProgress?:
      LocalSegmentationProgressCallback;

    cancellationSignal?:
      SegmentationCancellationSignal;

    forceReload?:
      boolean;
  } = {}
): Promise<void> {
  const requestId =
    input.requestId ??
    createSegmentationRequestId();

  const startedAt =
    now();

  const cancellation =
    createServiceCancellationSignal(
      input.cancellationSignal
    );

  activeSegmentationRequestId =
    requestId;

  const progressCallback:
    SegmentationProgressCallback | undefined =
    input.onProgress
      ? event => {
          safelyEmitProgress(
            input.onProgress,
            {
              requestId,

              stage:
                'segmentation',

              segmentationStage:
                event.stage,

              progress:
                clampUnit(
                  event.progress
                ),

              message:
                event.message,

              elapsedMs:
                Math.max(
                  0,
                  now() -
                    startedAt
                ),
            }
          );
        }
      : undefined;

  try {
    await initializeSegmentationEngine({
      requestId,

      cancellationSignal:
        cancellation.signal,

      forceSessionReload:
        input.forceReload,

      warmup:
        false,

      onProgress:
        progressCallback,
    });
  } catch (error) {
    throw normalizeServiceError(
      error,
      requestId,
      'SEGMENTATION_FAILED'
    );
  } finally {
    releaseActiveCancellationController(
      requestId,
      cancellation
        .internallyOwned
    );
  }
}

/**
 * تحميل الجلسات مع تفعيل Warmup.
 *
 * يفضّل تشغيله قبل دخول شاشة التصوير
 * لتقليل زمن أول عملية فصل.
 */
export async function warmupLocalSegmentation(
  input: {
    requestId?:
      string;

    onProgress?:
      LocalSegmentationProgressCallback;

    cancellationSignal?:
      SegmentationCancellationSignal;

    forceReload?:
      boolean;
  } = {}
): Promise<void> {
  const requestId =
    input.requestId ??
    createSegmentationRequestId();

  const startedAt =
    now();

  const cancellation =
    createServiceCancellationSignal(
      input.cancellationSignal
    );

  activeSegmentationRequestId =
    requestId;

  const progressCallback:
    SegmentationProgressCallback | undefined =
    input.onProgress
      ? event => {
          safelyEmitProgress(
            input.onProgress,
            {
              requestId,

              stage:
                'segmentation',

              segmentationStage:
                event.stage,

              progress:
                clampUnit(
                  event.progress
                ),

              message:
                event.message,

              elapsedMs:
                Math.max(
                  0,
                  now() -
                    startedAt
                ),
            }
          );
        }
      : undefined;

  try {
    await initializeSegmentationEngine({
      requestId,

      cancellationSignal:
        cancellation.signal,

      forceSessionReload:
        input.forceReload,

      warmup:
        true,

      onProgress:
        progressCallback,
    });
  } catch (error) {
    throw normalizeServiceError(
      error,
      requestId,
      'SEGMENTATION_FAILED'
    );
  } finally {
    releaseActiveCancellationController(
      requestId,
      cancellation
        .internallyOwned
    );
  }
}

/* =========================================================
 * Cancellation
 * ======================================================= */

/**
 * إلغاء الطلب المحلي الحالي.
 *
 * يعمل عندما تكون الخدمة هي التي أنشأت
 * Cancellation Controller الداخلي.
 *
 * عند تمرير Controller من الشاشة،
 * يمكن للشاشة أيضًا استدعاء:
 *
 * controller.cancel(reason)
 */
export function cancelLocalSegmentation(
  reason =
    'User cancelled local segmentation.'
): boolean {
  const controller =
    activeCancellationController;

  if (!controller) {
    return false;
  }

  controller.cancel(
    reason
  );

  return true;
}

/**
 * إنشاء Controller يمكن للشاشة الاحتفاظ به.
 *
 * مثال:
 *
 * const controller =
 *   createLocalSegmentationCancellationController();
 *
 * await createLocalTransparentImage({
 *   sourceUri,
 *   cancellationSignal:
 *     controller.signal,
 * });
 *
 * controller.cancel();
 */
export function createLocalSegmentationCancellationController() {
  return createSegmentationCancellationController();
}

/* =========================================================
 * Engine lifecycle
 * ======================================================= */

/**
 * تنظيف جلسات EdgeSAM المشتركة.
 */
export async function disposeLocalSegmentation(
  options: {
    removeCopiedModel?:
      boolean;

    clearEmbeddingCache?:
      boolean;
  } = {}
): Promise<void> {
  cancelLocalSegmentation(
    'Local segmentation engine is being disposed.'
  );

  await disposeSharedSegmentationEngine({
    removeCopiedModels:
      options
        .removeCopiedModel,

    clearEmbeddingCache:
      options
        .clearEmbeddingCache,
  });

  activeCancellationController =
    null;

  activeSegmentationRequestId =
    null;
}

/**
 * معلومات وتشخيصات المحرك الحالي.
 */
export function getLocalSegmentationEngineInfo() {
  return getSharedSegmentationEngine()
    .getDiagnostics();
}

/**
 * معرّف الطلب الحالي إن وجد.
 */
export function getActiveLocalSegmentationRequestId():
  string | null {
  return activeSegmentationRequestId;
}

export default
  createLocalTransparentImage;