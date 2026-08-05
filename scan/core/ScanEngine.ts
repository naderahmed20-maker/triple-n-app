// scan/core/ScanEngine.ts

import {
  DEFAULT_SCAN_ENGINE_CONFIG,
  normalizeConfidence,
  type DetectedScanContour,
  type ScanAnalysisResult,
  type ScanAnalysisStatus,
  type ScanCategory,
  type ScanEngineConfig,
  type ScanEngineResult,
  type ScanErrorCode,
  type ScanFailure,
  type ScanGender,
  type ScanPoint,
  type ScanShapeMeasurements,
  type ScanViewDirection,
} from './scanTypes';

import {
  analyzeScanContourGeometry,
  clampScanPointsToCanvas,
  normalizeScanContourOrder,
  prepareScanContour,
  safeScanDivide,
  scanPointsToSvgPath,
} from './ShapeGeometry';

import {
  analyzeAlphaMask,
  generateMask,
  getMaskBackend,
  registerDefaultUriMaskBackend,
  type AlphaMask,
  type GenerateMaskInput,
  type GeneratedMask,
} from './ai/MaskGenerator';

import {
  detectContour,
  type ContourDetectionResult,
  type DetectContourInput,
  type DetectedContour,
} from './services/ContourDetector';

import {
  completeScanQualityGate,
  getDefaultScanQualityUserMessage,
  runScanQualityMaskOnlyGate,
  runScanQualityPreGate,
  type ScanQualityImageData,
  type ScanQualityIssue,
  type ScanQualityMaskData,
  type ScanQualityPreSegmentationResult,
  type ScanQualityResult,
  type ScanQualityUserMessageKey,
} from './quality/ScanQualityGate';

/**
 * مراحل تنفيذ ScanEngine.
 */
export type ScanEngineStage =
  | 'idle'
  | 'validating'
  | 'preparing'
  | 'generating-mask'
  | 'detecting-contour'
  | 'building-geometry'
  | 'finalizing'
  | 'ready'
  | 'failed'
  | 'cancelled';

/**
 * مصدر الصورة الذي يستطيع المحرك تحليله.
 *
 * uri:
 * تستخدمه خدمات Expo أو Native Backends.
 *
 * rgba:
 * يستخدم في الاختبارات أو عند قراءة
 * Pixels مباشرة قبل تشغيل المحرك.
 */
export type ScanEngineImageSource =
  | {
      kind:
        'uri';

      uri:
        string;

      width:
        number;

      height:
        number;
    }
  | {
      kind:
        'rgba';

      data:
        Uint8Array |
        Uint8ClampedArray;

      width:
        number;

      height:
        number;
    };

/**
 * إعدادات مرحلة إنشاء الـMask.
 *
 * يتم تمرير هذه القيم إلى
 * MaskGenerator حسب الـBackend المسجل.
 */
export type ScanEngineMaskOptions = {
  /**
   * اسم Backend معين.
   *
   * عند عدم إرساله يستخدم MaskGenerator
   * الـBackend الافتراضي.
   */
  backendId?:
    string;

  /**
   * Threshold اختياري لفصل
   * الجسم عن الخلفية.
   */
  threshold?:
    number;

  /**
   * هل يتم تشغيل تنظيف الـMask؟
   */
  cleanup?:
    boolean;

  /**
   * أقل مساحة Foreground مقبولة
   * كنسبة من مساحة الصورة.
   */
  minimumForegroundRatio?:
    number;

  /**
   * أكبر مساحة Foreground مقبولة
   * كنسبة من مساحة الصورة.
   */
  maximumForegroundRatio?:
    number;
};

/**
 * إعدادات مرحلة اكتشاف المحيط.
 */
export type ScanEngineContourOptions = {
  /**
   * عدد النقاط النهائي الذي يحتاجه
   * Matcher وFitter.
   */
  sampleCount?:
    number;

  /**
   * مقدار تبسيط المحيط.
   */
  simplifyTolerance?:
    number;

  /**
   * عدد مرات التنعيم.
   */
  smoothingIterations?:
    number;

  /**
   * قوة التنعيم من 0 إلى 0.5.
   */
  smoothingStrength?:
    number;

  /**
   * أقل عدد نقاط مقبول قبل
   * تشغيل المطابقة.
   */
  minimumPointCount?:
    number;

  /**
   * المسافة المستخدمة لتحديد
   * ملامسة حافة الصورة.
   */
  edgePadding?:
    number;
};

/**
 * خيارات Debug.
 *
 * لا يجب حفظ البيانات الثقيلة
 * في النسخة النهائية إلا عند الحاجة.
 */
export type ScanEngineDebugOptions = {
  enabled?:
    boolean;

  includeMask?:
    boolean;

  includeContourPoints?:
    boolean;

  includeStageTimings?:
    boolean;
};

/**
 * إعدادات ScanEngine الإضافية.
 */
export type ScanEngineRuntimeConfig = {
  /**
   * الإعدادات المركزية الموجودة
   * في scanTypes.ts.
   */
  engine?:
    PartialScanEngineConfig;

  mask?:
    ScanEngineMaskOptions;

  contour?:
    ScanEngineContourOptions;

  debug?:
    ScanEngineDebugOptions;

    /**
   * إعدادات بوابة جودة الصورة والماسك.
   */
  quality?: {
    /**
     * تشغيل نظام الجودة بالكامل.
     */
    enabled?:
      boolean;

    /**
     * تشغيل فحص الصورة قبل BiRefNet.
     *
     * يعمل حاليًا عند توفر RGBA فقط.
     */
    runPreCheck?:
      boolean;

    /**
     * تشغيل فحص Alpha Mask بعد BiRefNet.
     */
    runPostCheck?:
      boolean;

    /**
     * منع تشغيل BiRefNet عند فشل Pre Check.
     */
    rejectOnPreFailure?:
      boolean;

    /**
     * منع إكمال التحليل عند فشل Post Check.
     */
    rejectOnPostFailure?:
      boolean;
  };

};

/**
 * نسخة جزئية آمنة من إعدادات المحرك.
 */
export type PartialScanEngineConfig = {

  minimumForegroundConfidence?:
    number;

  minimumContourConfidence?:
    number;
};

/**
 * Input الأساسي لتشغيل ScanEngine.
 */
export type ScanEngineInput = {
  image:
    ScanEngineImageSource;

  gender:
    ScanGender;

  requestedCategory:
    ScanCategory;

  requestedSubCategory?:
    string | null;

  preferredDirection?:
    ScanViewDirection;

  config?:
    ScanEngineRuntimeConfig;

  /**
   * Signal اختياري لإلغاء العملية.
   */
  signal?:
    AbortSignal;

  /**
   * Callback لتحديث الشاشة
   * بالمرحلة الحالية.
   */
  onStageChange?: (
    update:
      ScanEngineStageUpdate
  ) => void;
};

/**
 * تحديث واحد أثناء تشغيل المحرك.
 */
export type ScanEngineStageUpdate = {
  stage:
    ScanEngineStage;

  analysisStatus:
    ScanAnalysisStatus;

  progress:
    number;

  message:
    string;

  startedAt:
    number;

  elapsedMs:
    number;
};

/**
 * زمن مرحلة واحدة.
 */
export type ScanEngineStageTiming = {
  stage:
    ScanEngineStage;

  startedAt:
    number;

  completedAt:
    number;

  durationMs:
    number;
};

/**
 * معلومات Debug النهائية.
 */
export type ScanEngineDebugData = {
  stages:
    readonly ScanEngineStageTiming[];

  mask?: {
    width:
      number;

    height:
      number;

    foregroundRatio:
      number;

    confidence:
      number;

    bounds:
      {
        x:
          number;

        y:
          number;

        width:
          number;

        height:
          number;
      } | null;
  };

  contour?: {
    originalPointCount:
      number;

    preparedPointCount:
      number;

    direction:
      ScanViewDirection;

    foregroundConfidence:
      number;

    contourConfidence:
      number;

    touchesImageEdge:
      boolean;

    backgroundIsUsable:
      boolean;
  };


  quality?: {
    accepted:
      boolean;

    decision:
      string;

    score:
      number;

    userMessageKey:
      string;

    primaryIssueCode:
      string | null;

    primaryIssueSeverity:
      string | null;

    issueCount:
      number;

    preScore:
      number | null;

    postScore:
      number | null;

    foregroundRatio:
      number | null;

    componentCount:
      number | null;

    touchedEdgeCount:
      number | null;

    processingTimeMs:
      number;
  };
};

/**
 * نتيجة النجاح مع Debug اختياري.
 */
export type ScanEngineSuccess = {
  result:
    ScanAnalysisResult;

  debug?:
    ScanEngineDebugData;
};

/**
 * نتيجة التشغيل الآمنة.
 */
export type TryScanEngineResult =
  | {
      success:
        true;

      output:
        ScanEngineSuccess;
    }
  | {
      success:
        false;

      failure:
        ScanFailure;

      debug?:
        ScanEngineDebugData;
    };

/**
 * Error داخلي يحمل ScanErrorCode
 * ومعلومات الاسترجاع.
 */
export class ScanEngineError
  extends Error {
  readonly code:
    ScanErrorCode;

  readonly recoverable:
    boolean;

  readonly shouldRetake:
    boolean;

  readonly details?:
    Record<
      string,
      string | number | boolean | null
    >;

  readonly cause?:
    unknown;

  constructor({
    code,
    message,
    recoverable,
    shouldRetake,
    details,
    cause,
  }: {
    code:
      ScanErrorCode;

    message:
      string;

    recoverable:
      boolean;

    shouldRetake:
      boolean;

    details?:
      Record<
        string,
        string | number | boolean | null
      >;

    cause?:
      unknown;
  }) {
    super(
      message
    );

    this.name =
      'ScanEngineError';

    this.code =
      code;

    this.recoverable =
      recoverable;

    this.shouldRetake =
      shouldRetake;

    this.details =
      details;

    this.cause =
      cause;
  }
}

/**
 * Error خاص بإلغاء العملية.
 */
export class ScanEngineCancelledError
  extends Error {
  constructor(
    message =
      'The scan operation was cancelled.'
  ) {
    super(
      message
    );

    this.name =
      'ScanEngineCancelledError';
  }
}

/**
 * إعدادات Mask الافتراضية.
 */
const DEFAULT_MASK_OPTIONS:
  Required<
    Omit<
      ScanEngineMaskOptions,
      'backendId'
    >
  > = {
    /**
     * BiRefNet ينتج Alpha ناعمًا حول الحواف.
     *
     * استخدام 0.5 كان يحذف أجزاء دقيقة مثل:
     * الأشرطة، الأربطة، الأكمام الرفيعة،
     * أطراف الفساتين، والكعب الرفيع.
     */
    threshold:
      0.35,

    cleanup:
      true,

    /**
     * يسمح باكتشاف قطع صغيرة مثل:
     * الإكسسوارات، الأحزمة، وربطات العنق.
     */
    minimumForegroundRatio:
      0.003,

    /**
     * نترك مساحة آمنة للقطع الكبيرة
     * مع استمرار منع الـMask الممتلئ بالكامل.
     */
    maximumForegroundRatio:
      0.975,
  };

/**
 * إعدادات Contour الافتراضية.
 */
const DEFAULT_CONTOUR_OPTIONS:
  Required<
    ScanEngineContourOptions
  > = {
    /**
     * عدد أكبر من النقاط يحافظ على:
     * الأكمام، الياقات، الأربطة،
     * الكعب، أطراف الفساتين،
     * والانحناءات غير التقليدية.
     */
    sampleCount:
      256,

    /**
     * التبسيط القديم 1.5 كان قادرًا
     * على حذف تفاصيل حقيقية من الحافة.
     */
    simplifyTolerance:
      0.75,

    smoothingIterations:
      1,

    /**
     * تنعيم خفيف فقط.
     *
     * لا نريد تحويل الحواف الحقيقية
     * إلى شكل دائري أو قالب صناعي.
     */
    smoothingStrength:
      0.1,

    minimumPointCount:
      16,

    /**
     * هامش صغير لاكتشاف القص الحقيقي
     * دون رفض قطعة قريبة بصورة آمنة.
     */
    edgePadding:
      2,
  };

/**
 * إعدادات Debug الافتراضية.
 */
const DEFAULT_DEBUG_OPTIONS:
  Required<
    ScanEngineDebugOptions
  > = {
    enabled:
      false,

    includeMask:
      false,

    includeContourPoints:
      false,

    includeStageTimings:
      true,
  };

  /**
 * إعدادات Quality Gate الافتراضية.
 */
const DEFAULT_QUALITY_OPTIONS = {
  enabled:
    true,

  runPreCheck:
    true,

  runPostCheck:
    true,

  rejectOnPreFailure:
    true,

  rejectOnPostFailure:
    true,
} as const;

/**
 * مراحل المحرك ونسبة التقدم
 * المرتبطة بكل مرحلة.
 */
const STAGE_PROGRESS:
  Record<
    ScanEngineStage,
    number
  > = {
    idle:
      0,

    validating:
      0.05,

    preparing:
      0.12,

    'generating-mask':
      0.35,

    'detecting-contour':
      0.62,

    'building-geometry':
      0.82,

    finalizing:
      0.96,

    ready:
      1,

    failed:
      1,

    cancelled:
      1,
  };

/**
 * الرسالة الداخلية لكل مرحلة.
 *
 * يمكن لاحقًا تحويلها إلى مفاتيح i18n.
 */
const STAGE_MESSAGES:
  Record<
    ScanEngineStage,
    string
  > = {
    idle:
      'Waiting to start scan analysis.',

    validating:
      'Checking the captured image.',

    preparing:
      'Preparing the image for analysis.',

    'generating-mask':
      'Separating the item from the background.',

    'detecting-contour':
      'Detecting the outer shape of the item.',

    'building-geometry':
      'Analyzing the item geometry.',

    finalizing:
      'Preparing the final scan result.',

    ready:
      'The scan is ready.',

    failed:
      'The scan could not be completed.',

    cancelled:
      'The scan was cancelled.',
  };

/**
 * الفئات التي يستطيع المحرك
 * استقبالها من التطبيق.
 */
const SUPPORTED_SCAN_CATEGORIES:
  ReadonlySet<
    ScanCategory
  > = new Set([
    'Tops',
    'Pants',
    'Shorts',
    'Shoes',
    'Sneakers',
    'Jackets',
    'Accessories',
    'Dresses',
    'Skirts',
    'Heels',
    'Flats',
    'Sandals',
    'Bags',
  ]);

/**
 * الحد الأدنى لأبعاد الصورة.
 */
const MINIMUM_IMAGE_SIDE =
  32;

/**
 * منع الصور العملاقة غير المنطقية
 * من الدخول إلى الذاكرة.
 */
const MAXIMUM_IMAGE_SIDE =
  16_384;

  /**
 * الحد الأقصى لعدد Pixels قبل إدخال الصورة
 * إلى خط تحليل الـScan.
 *
 * يمنع صورة ذات أبعاد مسموحة منفردة
 * ولكن بمساحة هائلة من استهلاك الذاكرة.
 */
const MAXIMUM_IMAGE_PIXEL_COUNT =
  40_000_000;

/**
 * عدد قنوات RGBA.
 */
const RGBA_CHANNEL_COUNT =
  4;

/**
 * النوع النهائي للإعدادات بعد الدمج.
 */
type ResolvedScanEngineRuntimeConfig = {
  engine:
    ScanEngineConfig;

  mask:
    Required<
      Omit<
        ScanEngineMaskOptions,
        'backendId'
      >
    > & {
      backendId?:
        string;
    };

  contour:
    Required<
      ScanEngineContourOptions
    >;

  debug:
    Required<
      ScanEngineDebugOptions
    >;

    quality: {
    enabled:
      boolean;

    runPreCheck:
      boolean;

    runPostCheck:
      boolean;

    rejectOnPreFailure:
      boolean;

    rejectOnPostFailure:
      boolean;
  };
};

/**
 * بيانات التنفيذ الداخلية.
 */
type ScanExecutionContext = {
  input:
    ScanEngineInput;

  config:
    ResolvedScanEngineRuntimeConfig;

  startedAt:
    number;

  currentStage:
    ScanEngineStage;

  stageStartedAt:
    number;

  timings:
    ScanEngineStageTiming[];

  generatedMask?:
    GeneratedMask;

 alphaMask?:
    AlphaMask;

  qualityImage?:
    ScanQualityImageData;

  qualityMask?:
    ScanQualityMaskData;

  qualityPreResult?:
    ScanQualityPreSegmentationResult;

  qualityResult?:
    ScanQualityResult;

  rawContour?:
    DetectedContour;

  contourDetection?:
    ContourDetectionResult;

  detectedContour?:
    DetectedScanContour;
};

/**
 * فحص Boolean مع قيمة بديلة.
 */
function booleanOr(
  value:
    boolean | undefined,
  fallback:
    boolean
) {
  return typeof value ===
    'boolean'
    ? value
    : fallback;
}

/**
 * فحص رقم مع قيمة بديلة.
 */
function finiteOr(
  value:
    number | undefined,
  fallback:
    number
) {
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

/**
 * حصر قيمة بين حدين.
 */
function clampNumber(
  value:
    number,
  minimum:
    number,
  maximum:
    number
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

/**
 * دمج إعدادات ScanEngine المركزية.
 */
function resolveCoreEngineConfig(
  custom:
    PartialScanEngineConfig | undefined
): ScanEngineConfig {
  return {
    ...DEFAULT_SCAN_ENGINE_CONFIG,

    ...custom,
  };
}

/**
 * تجهيز كل إعدادات التشغيل.
 */
function resolveRuntimeConfig(
  custom:
    ScanEngineRuntimeConfig | undefined
): ResolvedScanEngineRuntimeConfig {
  return {
    engine:
      resolveCoreEngineConfig(
        custom
          ?.engine
      ),

    mask: {
      backendId:
        custom
          ?.mask
          ?.backendId,

      threshold:
        clampNumber(
          finiteOr(
            custom
              ?.mask
              ?.threshold,
            DEFAULT_MASK_OPTIONS
              .threshold
          ),
          0,
          1
        ),

      cleanup:
        booleanOr(
          custom
            ?.mask
            ?.cleanup,
          DEFAULT_MASK_OPTIONS
            .cleanup
        ),

      minimumForegroundRatio:
        clampNumber(
          finiteOr(
            custom
              ?.mask
              ?.minimumForegroundRatio,
            DEFAULT_MASK_OPTIONS
              .minimumForegroundRatio
          ),
          0,
          1
        ),

      maximumForegroundRatio:
        clampNumber(
          finiteOr(
            custom
              ?.mask
              ?.maximumForegroundRatio,
            DEFAULT_MASK_OPTIONS
              .maximumForegroundRatio
          ),
          0,
          1
        ),
    },

    contour: {
      sampleCount:
        Math.max(
          12,
          Math.floor(
            finiteOr(
              custom
                ?.contour
                ?.sampleCount,
              DEFAULT_CONTOUR_OPTIONS
                .sampleCount
            )
          )
        ),

      simplifyTolerance:
        Math.max(
          0,
          finiteOr(
            custom
              ?.contour
              ?.simplifyTolerance,
            DEFAULT_CONTOUR_OPTIONS
              .simplifyTolerance
          )
        ),

      smoothingIterations:
        Math.max(
          0,
          Math.floor(
            finiteOr(
              custom
                ?.contour
                ?.smoothingIterations,
              DEFAULT_CONTOUR_OPTIONS
                .smoothingIterations
            )
          )
        ),

      smoothingStrength:
        clampNumber(
          finiteOr(
            custom
              ?.contour
              ?.smoothingStrength,
            DEFAULT_CONTOUR_OPTIONS
              .smoothingStrength
          ),
          0,
          0.5
        ),

      minimumPointCount:
        Math.max(
          3,
          Math.floor(
            finiteOr(
              custom
                ?.contour
                ?.minimumPointCount,
              DEFAULT_CONTOUR_OPTIONS
                .minimumPointCount
            )
          )
        ),

      edgePadding:
        Math.max(
          0,
          finiteOr(
            custom
              ?.contour
              ?.edgePadding,
            DEFAULT_CONTOUR_OPTIONS
              .edgePadding
          )
        ),
    },

    debug: {
      enabled:
        booleanOr(
          custom
            ?.debug
            ?.enabled,
          DEFAULT_DEBUG_OPTIONS
            .enabled
        ),

      includeMask:
        booleanOr(
          custom
            ?.debug
            ?.includeMask,
          DEFAULT_DEBUG_OPTIONS
            .includeMask
        ),

      includeContourPoints:
        booleanOr(
          custom
            ?.debug
            ?.includeContourPoints,
          DEFAULT_DEBUG_OPTIONS
            .includeContourPoints
        ),

      includeStageTimings:
        booleanOr(
          custom
            ?.debug
            ?.includeStageTimings,
          DEFAULT_DEBUG_OPTIONS
            .includeStageTimings
        ),
    },

    quality: {
      enabled:
        booleanOr(
          custom
            ?.quality
            ?.enabled,
          DEFAULT_QUALITY_OPTIONS
            .enabled
        ),

      runPreCheck:
        booleanOr(
          custom
            ?.quality
            ?.runPreCheck,
          DEFAULT_QUALITY_OPTIONS
            .runPreCheck
        ),

      runPostCheck:
        booleanOr(
          custom
            ?.quality
            ?.runPostCheck,
          DEFAULT_QUALITY_OPTIONS
            .runPostCheck
        ),

      rejectOnPreFailure:
        booleanOr(
          custom
            ?.quality
            ?.rejectOnPreFailure,
          DEFAULT_QUALITY_OPTIONS
            .rejectOnPreFailure
        ),

      rejectOnPostFailure:
        booleanOr(
          custom
            ?.quality
            ?.rejectOnPostFailure,
          DEFAULT_QUALITY_OPTIONS
            .rejectOnPostFailure
        ),
    },
  };
}

// scan/core/ScanEngine.ts
// Part 2/4

/**
 * تحويل قيمة غير معروفة إلى Object آمن.
 */
function asRecord(
  value:
    unknown
): Record<
  string,
  unknown
> | null {
  if (
    typeof value !==
      'object' ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return null;
  }

  return value as Record<
    string,
    unknown
  >;
}

/**
 * قراءة رقم صالح من Object
 * باستخدام أكثر من اسم محتمل.
 */
function readFiniteNumber(
  source:
    unknown,
  keys:
    readonly string[],
  fallback =
    0
) {
  const record =
    asRecord(
      source
    );

  if (!record) {
    return fallback;
  }

  for (
    const key
    of keys
  ) {
    const value =
      record[key];

    if (
      typeof value ===
        'number' &&
      Number.isFinite(
        value
      )
    ) {
      return value;
    }
  }

  return fallback;
}

/**
 * قراءة Boolean من Object.
 */
function readBoolean(
  source:
    unknown,
  keys:
    readonly string[],
  fallback =
    false
) {
  const record =
    asRecord(
      source
    );

  if (!record) {
    return fallback;
  }

  for (
    const key
    of keys
  ) {
    const value =
      record[key];

    if (
      typeof value ===
      'boolean'
    ) {
      return value;
    }
  }

  return fallback;
}

/**
 * قراءة String من Object.
 */
function readString(
  source:
    unknown,
  keys:
    readonly string[],
  fallback =
    ''
) {
  const record =
    asRecord(
      source
    );

  if (!record) {
    return fallback;
  }

  for (
    const key
    of keys
  ) {
    const value =
      record[key];

    if (
      typeof value ===
        'string' &&
      value.trim()
    ) {
      return value;
    }
  }

  return fallback;
}

/**
 * فحص هل القيمة ScanPoint صالحة.
 */
function isScanPointValue(
  value:
    unknown
): value is ScanPoint {
  const record =
    asRecord(
      value
    );

  return Boolean(
    record &&
    typeof record.x ===
      'number' &&
    Number.isFinite(
      record.x
    ) &&
    typeof record.y ===
      'number' &&
    Number.isFinite(
      record.y
    )
  );
}

/**
 * قراءة Array من النقاط من أي نتيجة
 * بدون الاعتماد على اسم واحد فقط.
 */
function readScanPoints(
  source:
    unknown
): ScanPoint[] {
  const directArray =
    Array.isArray(
      source
    )
      ? source
      : null;

  if (directArray) {
    return directArray
      .filter(
        isScanPointValue
      )
      .map(
        point => ({
          x:
            point.x,

          y:
            point.y,
        })
      );
  }

  const record =
    asRecord(
      source
    );

  if (!record) {
    return [];
  }

  const possibleKeys = [
    'points',
    'contour',
    'contourPoints',
    'sampledPoints',
    'boundaryPoints',
    'outerPoints',
    'pathPoints',
  ] as const;

  for (
    const key
    of possibleKeys
  ) {
    const value =
      record[key];

    if (
      Array.isArray(
        value
      )
    ) {
      const points =
        value
          .filter(
            isScanPointValue
          )
          .map(
            point => ({
              x:
                point.x,

              y:
                point.y,
            })
          );

      if (
        points.length >
        0
      ) {
        return points;
      }
    }
  }

  const geometry =
    asRecord(
      record.geometry
    );

  if (geometry) {
    return readScanPoints(
      geometry
    );
  }

  return [];
}

/**
 * فحص إلغاء العملية.
 */
function throwIfCancelled(
  signal:
    AbortSignal | undefined
) {
  if (
    signal
      ?.aborted
  ) {
    throw new ScanEngineCancelledError();
  }
}

/**
 * تحويل المرحلة الحالية إلى
 * ScanAnalysisStatus المستخدم في الواجهة.
 */
function getAnalysisStatusForStage(
  stage:
    ScanEngineStage
): ScanAnalysisStatus {
  switch (stage) {
    case 'idle':
    case 'validating':
      return 'idle';

    case 'preparing':
    case 'generating-mask':
      return 'preparing';

    case 'detecting-contour':
    case 'building-geometry':
      return 'detecting';

    case 'finalizing':
  return 'detecting';

    case 'ready':
      return 'ready';

    case 'failed':
    case 'cancelled':
      return 'failed';

    default:
      return 'failed';
  }
}

/**
 * إنهاء زمن المرحلة السابقة.
 */
function completeCurrentStageTiming(
  context:
    ScanExecutionContext,
  completedAt =
    Date.now()
) {
  if (
    context.currentStage ===
    'idle'
  ) {
    return;
  }

  const existingTiming =
    context.timings[
      context.timings.length -
        1
    ];

  if (
    existingTiming &&
    existingTiming.stage ===
      context.currentStage &&
    existingTiming.completedAt ===
      0
  ) {
    existingTiming.completedAt =
      completedAt;

    existingTiming.durationMs =
      Math.max(
        0,
        completedAt -
          existingTiming
            .startedAt
      );
  }
}

/**
 * الانتقال إلى مرحلة جديدة
 * وإرسال التحديث إلى الشاشة.
 */
function enterStage(
  context:
    ScanExecutionContext,
  stage:
    ScanEngineStage
) {
  const now =
    Date.now();

  completeCurrentStageTiming(
    context,
    now
  );

  context.currentStage =
    stage;

  context.stageStartedAt =
    now;

  context.timings.push({
    stage,

    startedAt:
      now,

    completedAt:
      0,

    durationMs:
      0,
  });

  context.input
    .onStageChange
    ?.({
      stage,

      analysisStatus:
        getAnalysisStatusForStage(
          stage
        ),

      progress:
        STAGE_PROGRESS[
          stage
        ],

      message:
        STAGE_MESSAGES[
          stage
        ],

      startedAt:
        context.startedAt,

      elapsedMs:
        Math.max(
          0,
          now -
            context.startedAt
        ),
    });
}

/**
 * إغلاق آخر مرحلة قبل
 * إعادة النتيجة النهائية.
 */
function finalizeStageTimings(
  context:
    ScanExecutionContext
) {
  completeCurrentStageTiming(
    context,
    Date.now()
  );
}

/**
 * إنشاء Context جديد لعملية واحدة.
 */
function createExecutionContext(
  input:
    ScanEngineInput
): ScanExecutionContext {
  const startedAt =
    Date.now();

  return {
    input,

    config:
      resolveRuntimeConfig(
        input.config
      ),

    startedAt,

    currentStage:
      'idle',

    stageStartedAt:
      startedAt,

    timings:
      [],
  };
}

/**
 * تنظيف URI قبل استخدامه.
 */
function normalizeImageUri(
  uri:
    string
) {
  return uri.trim();
}

/**
 * تحويل صورة RGBA الخاصة بـScanEngine
 * إلى صيغة ScanQualityGate.
 *
 * صور URI لا تحتوي Pixels داخل المحرك،
 * لذلك يتم تخطي Pre Check لها حاليًا.
 */
function createScanQualityImageData(
  context:
    ScanExecutionContext
): ScanQualityImageData | null {
  const image =
    context.input.image;

  if (
    image.kind !==
    'rgba'
  ) {
    return null;
  }

  const pixels =
    image.data instanceof
      Uint8Array
      ? image.data
      : new Uint8Array(
          image.data
        );

  return {
    width:
      image.width,

    height:
      image.height,

    pixels,

    format:
      'rgba',

    bytesPerRow:
      image.width *
      RGBA_CHANNEL_COUNT,

    orientationCorrected:
      true,
  };
}

/**
 * قراءة بيانات Alpha من AlphaMask.
 */
function getAlphaMaskQualityData(
  alphaMask:
    AlphaMask
):
  | Uint8Array
  | Uint8ClampedArray
  | Float32Array
  | number[] {
  const record =
    asRecord(
      alphaMask
    );

  const data =
    record
      ?.data ??
    record
      ?.alpha ??
    record
      ?.values ??
    record
      ?.pixels;

  if (
    data instanceof
      Uint8Array ||
    data instanceof
      Uint8ClampedArray ||
    data instanceof
      Float32Array ||
    Array.isArray(
      data
    )
  ) {
    return data;
  }

  throw new ScanEngineError({
    code:
      'FOREGROUND_NOT_FOUND',

    message:
      'The alpha mask does not contain usable quality data.',

    recoverable:
      true,

    shouldRetake:
      true,
  });
}

/**
 * تحديد نطاق قيم AlphaMask.
 */
function resolveAlphaMaskQualityValueRange(
  data:
    | Uint8Array
    | Uint8ClampedArray
    | Float32Array
    | number[]
): 'zero-to-one' | 'zero-to-255' {
  if (
    data instanceof
      Uint8Array ||
    data instanceof
      Uint8ClampedArray
  ) {
    return 'zero-to-255';
  }

  if (
    data.length ===
    0
  ) {
    return 'zero-to-one';
  }

  const maximumSamples =
    Math.min(
      128,
      data.length
    );

  const sampleStep =
    Math.max(
      1,
      Math.floor(
        data.length /
          maximumSamples
      )
    );

  for (
    let index =
      0;
    index <
      data.length;
    index +=
      sampleStep
  ) {
    const value =
      data[
        index
      ] ?? 0;

    if (
      value >
      1
    ) {
      return 'zero-to-255';
    }
  }

  return 'zero-to-one';
}

/**
 * تحويل AlphaMask إلى صيغة
 * ScanQualityGate.
 */
function createScanQualityMaskData(
  alphaMask:
    AlphaMask
): ScanQualityMaskData {
  const record =
    asRecord(
      alphaMask
    );

  const width =
    readFiniteNumber(
      record,
      [
        'width',
      ],
      0
    );

  const height =
    readFiniteNumber(
      record,
      [
        'height',
      ],
      0
    );

  if (
    !Number.isInteger(
      width
    ) ||
    !Number.isInteger(
      height
    ) ||
    width <=
      0 ||
    height <=
      0
  ) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The alpha mask dimensions are invalid.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        maskWidth:
          width,

        maskHeight:
          height,
      },
    });
  }

  const sourceData =
    getAlphaMaskQualityData(
      alphaMask
    );

  const data =
    Array.isArray(
      sourceData
    )
      ? new Float32Array(
          sourceData
        )
      : sourceData;

  return {
    width,

    height,

    data,

    valueRange:
      resolveAlphaMaskQualityValueRange(
        data
      ),
  } as ScanQualityMaskData;
}

/**
 * تحويل مشكلة الجودة إلى ScanErrorCode.
 */
function getScanErrorCodeFromQualityIssue(
  issue:
    ScanQualityIssue | null | undefined
): ScanErrorCode {
  switch (
    issue?.code
  ) {
    case 'invalid-input':
    case 'invalid-image-size':
    case 'invalid-pixel-buffer':
    case 'image-too-small':
    case 'image-too-large':
      return 'INVALID_IMAGE';

    case 'invalid-mask':
    case 'foreground-missing':
    case 'foreground-too-small':
    case 'subject-too-far':
      return 'FOREGROUND_NOT_FOUND';

    case 'foreground-too-large':
    case 'subject-too-close':
    case 'foreground-touching-top':
    case 'foreground-touching-bottom':
    case 'foreground-touching-left':
    case 'foreground-touching-right':
    case 'foreground-touching-multiple-edges':
      return 'ITEM_TOUCHES_EDGE';

    case 'multiple-objects-detected':
    case 'secondary-object-detected':
    case 'possible-hand-detected':
      return 'MULTIPLE_ITEMS_FOUND';

    case 'background-too-similar':
    case 'image-low-contrast':
    case 'image-too-dark':
    case 'image-too-bright':
    case 'image-underexposed':
    case 'image-overexposed':
      return 'BACKGROUND_TOO_COMPLEX';

    case 'image-blurry':
    case 'image-severely-blurry':
    case 'mask-too-fragmented':
    case 'mask-has-holes':
    case 'mask-low-confidence':
    case 'mask-uncertain-edges':
    case 'quality-score-too-low':
      return 'LOW_CONTOUR_CONFIDENCE';

    default:
      return 'UNKNOWN_ERROR';
  }
}

/**
 * تحويل نتيجة الجودة إلى ScanEngineError.
 */
function createScanEngineErrorFromQuality({
  primaryIssue,
  userMessageKey,
  score,
  decision,
}: {
  primaryIssue:
    ScanQualityIssue | null | undefined;

  userMessageKey:
    ScanQualityUserMessageKey;

  score:
    number;

  decision:
    string;
}) {
  return new ScanEngineError({
    code:
      getScanErrorCodeFromQualityIssue(
        primaryIssue
      ),

    message:
      getDefaultScanQualityUserMessage(
        userMessageKey
      ),

    recoverable:
      true,

    shouldRetake:
      true,

    details: {
      qualityScore:
        score,

      qualityDecision:
        decision,

      qualityIssue:
        primaryIssue
          ?.code ??
        null,

      qualitySeverity:
        primaryIssue
          ?.severity ??
        null,

      qualityConfidence:
        primaryIssue
          ?.confidence ??
        null,
    },
  });
}

/**
 * تشغيل فحص الجودة قبل BiRefNet.
 */
function runQualityPreCheck(
  context:
    ScanExecutionContext
) {
  if (
    !context.config
      .quality
      .enabled ||
    !context.config
      .quality
      .runPreCheck
  ) {
    return;
  }

  const qualityImage =
    createScanQualityImageData(
      context
    );

  /**
   * صور URI لا تحتوي RGBA هنا.
   * لا نوقف العملية، وسيعمل Post Check
   * بعد خروج Alpha Mask.
   */
  if (
    !qualityImage
  ) {
    return;
  }

  context.qualityImage =
    qualityImage;

  const preGate =
    runScanQualityPreGate(
      qualityImage
    );

  context.qualityPreResult =
    preGate.result;

  if (
    !preGate
      .shouldRunSegmentation &&
    context.config
      .quality
      .rejectOnPreFailure
  ) {
    throw createScanEngineErrorFromQuality({
      primaryIssue:
        preGate.result
          .primaryIssue,

      userMessageKey:
        preGate.result
          .userMessageKey,

      score:
        preGate.result
          .score,

      decision:
        preGate.result
          .decision,
    });
  }
}

/**
 * تشغيل فحص الجودة بعد BiRefNet.
 */
function runQualityPostCheck(
  context:
    ScanExecutionContext,
  alphaMask:
    AlphaMask
) {
  if (
    !context.config
      .quality
      .enabled ||
    !context.config
      .quality
      .runPostCheck
  ) {
    return;
  }

  const qualityMask =
    createScanQualityMaskData(
      alphaMask
    );

  context.qualityMask =
    qualityMask;

  const qualityResult =
    context.qualityImage &&
    context.qualityPreResult
      ? completeScanQualityGate({
          image:
            context.qualityImage,

          mask:
            qualityMask,

          preSegmentationResult:
            context.qualityPreResult,
        })
      : runScanQualityMaskOnlyGate(
          qualityMask
        );

 context.qualityResult =
  qualityResult;

if (__DEV__) {
  console.log(
    'SCAN QUALITY RESULT:',
    qualityResult.debugSummary
  );
}

if (
  !qualityResult
    .accepted &&
    context.config
      .quality
      .rejectOnPostFailure
  ) {
    throw createScanEngineErrorFromQuality({
      primaryIssue:
        qualityResult
          .primaryIssue,

      userMessageKey:
        qualityResult
          .userMessageKey,

      score:
        qualityResult
          .score,

      decision:
        qualityResult
          .decision,
    });
  }
}

/**
 * التأكد من صحة الصورة والمدخلات.
 */
function validateScanEngineInput(
  input:
    ScanEngineInput
) {
  if (
    !input ||
    typeof input !==
      'object'
  ) {
    throw new ScanEngineError({
      code:
        'INVALID_IMAGE',

      message:
        'The scan input is invalid.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

  if (
    input.gender !==
      'male' &&
    input.gender !==
      'female'
  ) {
    throw new ScanEngineError({
      code:
        'UNKNOWN_ERROR',

      message:
        'The wardrobe type is invalid.',

      recoverable:
        false,

      shouldRetake:
        false,

      details: {
        gender:
          String(
            input.gender
          ),
      },
    });
  }

  if (
    !SUPPORTED_SCAN_CATEGORIES
      .has(
        input
          .requestedCategory
      )
  ) {
    throw new ScanEngineError({
      code:
        'UNSUPPORTED_CATEGORY',

      message:
        `The category "${String(
          input
            .requestedCategory
        )}" is not supported by the scan engine.`,

      recoverable:
        false,

      shouldRetake:
        false,

      details: {
        category:
          String(
            input
              .requestedCategory
          ),
      },
    });
  }

  const image =
    input.image;

  if (
    !image ||
    (
      image.kind !==
        'uri' &&
      image.kind !==
        'rgba'
    )
  ) {
    throw new ScanEngineError({
      code:
        'INVALID_IMAGE',

      message:
        'The image source is missing or invalid.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

const hasValidDimensions =
    Number.isFinite(
      image.width
    ) &&
    Number.isFinite(
      image.height
    ) &&
    Number.isInteger(
      image.width
    ) &&
    Number.isInteger(
      image.height
    ) &&
    image.width >=
      MINIMUM_IMAGE_SIDE &&
    image.height >=
      MINIMUM_IMAGE_SIDE &&
    image.width <=
      MAXIMUM_IMAGE_SIDE &&
    image.height <=
      MAXIMUM_IMAGE_SIDE;

  const imagePixelCount =
    hasValidDimensions
      ? image.width *
        image.height
      : 0;

  if (
    !hasValidDimensions ||
    !Number.isSafeInteger(
      imagePixelCount
    ) ||
    imagePixelCount >
      MAXIMUM_IMAGE_PIXEL_COUNT
  ) {
    throw new ScanEngineError({
      code:
        'INVALID_IMAGE',

      message:
        'The captured image dimensions are invalid or too large.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        imageWidth:
          Number.isFinite(
            image.width
          )
            ? image.width
            : null,

        imageHeight:
          Number.isFinite(
            image.height
          )
            ? image.height
            : null,

        imagePixelCount:
          Number.isSafeInteger(
            imagePixelCount
          )
            ? imagePixelCount
            : null,

        maximumPixelCount:
          MAXIMUM_IMAGE_PIXEL_COUNT,
      },
    });
  }

  if (
    image.kind ===
    'rgba'
  ) {
    const expectedLength =
      image.width *
      image.height *
      RGBA_CHANNEL_COUNT;

    const hasSupportedBuffer =
      image.data instanceof
        Uint8Array ||
      image.data instanceof
        Uint8ClampedArray;

    if (
      !hasSupportedBuffer ||
      image.data.length !==
        expectedLength
    ) {
      throw new ScanEngineError({
        code:
          'INVALID_IMAGE',

        message:
          'The RGBA image data does not match the declared dimensions.',

        recoverable:
          true,

        shouldRetake:
          true,

        details: {
          expectedLength,

          receivedLength:
            image.data
              ?.length ??
            0,

          imageWidth:
            image.width,

          imageHeight:
            image.height,
        },
      });
    }
  }
}

/**
 * تحويل Error غير معروف إلى نص.
 */
function getUnknownErrorMessage(
  error:
    unknown
) {
  if (
    error instanceof
    Error
  ) {
    return (
      error.message ||
      'Unknown scan error.'
    );
  }

  if (
    typeof error ===
    'string'
  ) {
    return error;
  }

  const record =
    asRecord(
      error
    );

  if (
    record &&
    typeof record.message ===
      'string'
  ) {
    return record.message;
  }

  return 'Unknown scan error.';
}

/**
 * تحويل أي Error إلى ScanFailure موحدة.
 */
function createFailureFromError(
  error:
    unknown
): ScanFailure {
  if (
    error instanceof
    ScanEngineError
  ) {
    return {
      status:
        'failed',

      code:
        error.code,

      message:
        error.message,

      recoverable:
        error.recoverable,

      shouldRetake:
        error.shouldRetake,

      details:
        error.details,
    };
  }

  if (
    error instanceof
    ScanEngineCancelledError
  ) {
    return {
      status:
        'failed',

      code:
        'CANCELLED',

      message:
        error.message,

      recoverable:
        true,

      shouldRetake:
        false,

      details: {
        cancelled:
          true,
      },
    };
  }

  const message =
    getUnknownErrorMessage(
      error
    );

  const normalizedMessage =
    message
      .toLowerCase();

  if (
    normalizedMessage
      .includes(
        'foreground'
      ) ||
    normalizedMessage
      .includes(
        'subject not found'
      ) ||
    normalizedMessage
      .includes(
        'empty mask'
      )
  ) {
    return {
      status:
        'failed',

      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'No clear clothing item was found in the image.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        originalMessage:
          message,
      },
    };
  }

  if (
    normalizedMessage
      .includes(
        'multiple'
      ) &&
    (
      normalizedMessage
        .includes(
          'component'
        ) ||
      normalizedMessage
        .includes(
          'item'
        ) ||
      normalizedMessage
        .includes(
          'object'
        )
    )
  ) {
    return {
      status:
        'failed',

      code:
        'MULTIPLE_ITEMS_FOUND',

      message:
        'More than one item was detected in the image.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        originalMessage:
          message,
      },
    };
  }


  return {
    status:
      'failed',

    code:
      'UNKNOWN_ERROR',

    message,

    recoverable:
      true,

    shouldRetake:
      false,
  };
}

/**
 * قراءة Bounds من نتيجة غير معروفة.
 */
function readBounds(
  source:
    unknown
): {
  x:
    number;

  y:
    number;

  width:
    number;

  height:
    number;
} | null {
  const record =
    asRecord(
      source
    );

  if (!record) {
    return null;
  }

  const possibleBounds =
    asRecord(
      record.bounds
    ) ??
    asRecord(
      record.boundingBox
    ) ??
    asRecord(
      record.foregroundBounds
    ) ??
    asRecord(
      record.contourBounds
    );

  if (
    possibleBounds &&
    typeof possibleBounds.x ===
      'number' &&
    typeof possibleBounds.y ===
      'number' &&
    typeof possibleBounds.width ===
      'number' &&
    typeof possibleBounds.height ===
      'number' &&
    Number.isFinite(
      possibleBounds.x
    ) &&
    Number.isFinite(
      possibleBounds.y
    ) &&
    Number.isFinite(
      possibleBounds.width
    ) &&
    Number.isFinite(
      possibleBounds.height
    ) &&
    possibleBounds.width >
      0 &&
    possibleBounds.height >
      0
  ) {
    return {
      x:
        possibleBounds.x,

      y:
        possibleBounds.y,

      width:
        possibleBounds.width,

      height:
        possibleBounds.height,
    };
  }

  return null;
}

/**
 * استخراج نسبة الـForeground.
 */
/**
 * استخراج نسبة الـForeground.
 */
function getMaskForegroundRatio(
  mask:
    unknown
) {
  const maskRecord =
    asRecord(
      mask
    );

  const directRatio =
    readFiniteNumber(
      maskRecord,
      [
        'foregroundRatio',
        'coverage',
        'coverageRatio',
        'fillRatio',
      ],
      -1
    );

  if (
    directRatio >=
    0
  ) {
    return normalizeConfidence(
      directRatio
    );
  }

  /**
   * GeneratedMask الحقيقي يحتفظ
   * بالنسبة داخل statistics.
   */
  const statistics =
    asRecord(
      maskRecord
        ?.statistics
    );

  const statisticsRatio =
    readFiniteNumber(
      statistics,
      [
        'foregroundRatio',
        'coverage',
        'coverageRatio',
        'fillRatio',
      ],
      -1
    );

  if (
    statisticsRatio >=
    0
  ) {
    return normalizeConfidence(
      statisticsRatio
    );
  }

  const analysis =
    asRecord(
      maskRecord
        ?.analysis
    );

  const analysisRatio =
    readFiniteNumber(
      analysis,
      [
        'foregroundRatio',
        'coverage',
        'coverageRatio',
        'fillRatio',
      ],
      -1
    );

  if (
    analysisRatio >=
    0
  ) {
    return normalizeConfidence(
      analysisRatio
    );
  }

  const alphaMask =
    asRecord(
      maskRecord
        ?.mask
    ) ??
    maskRecord;

  const width =
    readFiniteNumber(
      alphaMask,
      [
        'width',
      ],
      0
    );

  const height =
    readFiniteNumber(
      alphaMask,
      [
        'height',
      ],
      0
    );

  const foregroundPixels =
    readFiniteNumber(
      statistics,
      [
        'foregroundPixelCount',
        'foregroundPixels',
        'activePixelCount',
        'opaquePixelCount',
      ],
      -1
    );

  if (
    width >
      0 &&
    height >
      0 &&
    foregroundPixels >=
      0
  ) {
    return normalizeConfidence(
      foregroundPixels /
        (
          width *
          height
        )
    );
  }

  return 0;
}

/**
 * قراءة ثقة الـMask.
 */
function getMaskConfidence(
  mask:
    unknown
) {
  const confidence =
    readFiniteNumber(
      mask,
      [
        'confidence',
        'foregroundConfidence',
        'maskConfidence',
        'quality',
      ],
      -1
    );

  if (
    confidence >=
    0
  ) {
    return normalizeConfidence(
      confidence
    );
  }

  const analysis =
    asRecord(
      mask
    )
      ?.analysis;

  return normalizeConfidence(
    readFiniteNumber(
      analysis,
      [
        'confidence',
        'foregroundConfidence',
        'maskConfidence',
        'quality',
      ],
      0
    )
  );
}

/**
 * التأكد من أن الـMask الناتج منطقي.
 */
function validateGeneratedMask(
  context:
    ScanExecutionContext,
  mask:
    GeneratedMask
) {
  const ratio =
    getMaskForegroundRatio(
      mask
    );

  const confidence =
    getMaskConfidence(
      mask
    );

  if (
    ratio <
    context.config
      .mask
      .minimumForegroundRatio
  ) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The clothing item is too small or was not detected.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        foregroundRatio:
          ratio,

        minimumForegroundRatio:
          context
            .config
            .mask
            .minimumForegroundRatio,
      },
    });
  }

  if (
    ratio >
    context.config
      .mask
      .maximumForegroundRatio
  ) {
    throw new ScanEngineError({
      code:
        'BACKGROUND_TOO_COMPLEX',

      message:
        'The detected foreground fills almost the entire image.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        foregroundRatio:
          ratio,

        maximumForegroundRatio:
          context
            .config
            .mask
            .maximumForegroundRatio,
      },
    });
  }

  if (
    confidence <
    context.config
      .engine
      .minimumForegroundConfidence
  ) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The clothing item could not be separated clearly from the background.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        foregroundConfidence:
          confidence,

        minimumForegroundConfidence:
          context
            .config
            .engine
            .minimumForegroundConfidence,
      },
    });
  }
}

/**
 * تحويل Bounds من مساحة الصورة
 * إلى مساحة الـScan القياسية 1000×1000.
 */
function mapBoundsToScanCanvas(
  bounds: {
    x:
      number;

    y:
      number;

    width:
      number;

    height:
      number;
  },
  sourceWidth:
    number,
  sourceHeight:
    number,
  canvasSize:
    number
) {
  return {
    x:
      safeScanDivide(
        bounds.x,
        sourceWidth,
        0
      ) *
      canvasSize,

    y:
      safeScanDivide(
        bounds.y,
        sourceHeight,
        0
      ) *
      canvasSize,

    width:
      Math.max(
        1,
        safeScanDivide(
          bounds.width,
          sourceWidth,
          1
        ) *
        canvasSize
      ),

    height:
      Math.max(
        1,
        safeScanDivide(
          bounds.height,
          sourceHeight,
          1
        ) *
        canvasSize
      ),
  };
}

/**
 * تحويل نقاط الصورة إلى
 * مساحة 1000×1000.
 */
function mapPointsToScanCanvas(
  points:
    readonly ScanPoint[],
  sourceWidth:
    number,
  sourceHeight:
    number,
  canvasSize:
    number
): ScanPoint[] {
  return points.map(
    point => ({
      x:
        safeScanDivide(
          point.x,
          sourceWidth,
          0
        ) *
        canvasSize,

      y:
        safeScanDivide(
          point.y,
          sourceHeight,
          0
        ) *
        canvasSize,
    })
  );
}

/**
 * تحديد اتجاه التصوير النهائي.
 */
function resolveDetectedDirection(
  preferredDirection:
    ScanViewDirection | undefined,
  contourSource:
    unknown
): ScanViewDirection {
  const detectedDirection =
    readString(
      contourSource,
      [
        'direction',
        'viewDirection',
        'orientation',
      ],
      ''
    );

  const supportedDirections:
    readonly ScanViewDirection[] = [
      'left-profile',
      'right-profile',
      'front',
      'back',
      'top',
      'flat-lay',
      'unknown',
    ];

  if (
    supportedDirections
      .includes(
        detectedDirection as ScanViewDirection
      )
  ) {
    return detectedDirection as ScanViewDirection;
  }

  return (
    preferredDirection ??
    'unknown'
  );
}


/**
 * معرفة هل المحيط يلامس حافة الصورة.
 */
function calculateTouchesImageEdge(
  rawPoints:
    readonly ScanPoint[],
  sourceWidth:
    number,
  sourceHeight:
    number,
  padding:
    number
) {
  if (
    rawPoints.length ===
      0 ||
    sourceWidth <=
      0 ||
    sourceHeight <=
      0
  ) {
    return false;
  }

  const safePadding =
    clampNumber(
      padding,
      0,
      Math.max(
        0,
        Math.min(
          sourceWidth,
          sourceHeight
        ) /
          4
      )
    );

  const maximumX =
    Math.max(
      0,
      sourceWidth -
        1 -
        safePadding
    );

  const maximumY =
    Math.max(
      0,
      sourceHeight -
        1 -
        safePadding
    );

  return rawPoints.some(
    point =>
      point.x <=
        safePadding ||
      point.y <=
        safePadding ||
      point.x >=
        maximumX ||
      point.y >=
        maximumY
  );
}


/**
 * حساب القياسات الهندسية العامة
 * للمحيط المكتشف.
 */
function calculateDetectedMeasurements(
  points:
    readonly ScanPoint[]
): ScanShapeMeasurements {
  const geometry =
    analyzeScanContourGeometry(
      points
    );

  const width =
    Math.max(
      0,
      geometry.bounds.width
    );

  const height =
    Math.max(
      0,
      geometry.bounds.height
    );

  const area =
    Math.max(
      0,
      geometry.area
    );

  const perimeter =
    Math.max(
      0,
      geometry.perimeter
    );

  const boundsArea =
    width *
    height;

  return {
    aspectRatio:
      safeScanDivide(
        width,
        height,
        0
      ),

    width,

    height,

    area,

    perimeter,

    fillRatio:
      clampNumber(
        safeScanDivide(
          area,
          boundsArea,
          0
        ),
        0,
        1
      ),

    contourRoundness:
      normalizeConfidence(
        safeScanDivide(
          4 *
            Math.PI *
            area,
          perimeter *
            perimeter,
          0
        )
      ),

    centerXRatio:
      clampNumber(
        safeScanDivide(
          geometry.center.x,
          width,
          0
        ),
        0,
        1
      ),

    centerYRatio:
      clampNumber(
        safeScanDivide(
          geometry.center.y,
          height,
          0
        ),
        0,
        1
      ),
  };
}

/**
 * بناء DetectedScanContour النهائي
 * من نتيجة ContourDetector.
 */
function buildDetectedScanContour(
  context:
    ScanExecutionContext,
  detected:
    DetectedContour,
  detectionResult?:
    ContourDetectionResult
): DetectedScanContour {
  const image =
    context.input.image;
    /**
   * Skia Backend قد يصغّر الصورة للتحليل،
   * ولذلك نقاط المحيط مرتبطة بأبعاد الـMask
   * وليس أبعاد صورة الكاميرا الأصلية.
   */
  const contourSourceWidth =
    context.alphaMask
      ?.width ??
    image.width;

  const contourSourceHeight =
    context.alphaMask
      ?.height ??
    image.height;

  const rawPoints =
    readScanPoints(
      detected
    );

  const fallbackPoints =
    detectionResult
      ? readScanPoints(
          detectionResult
        )
      : [];

  const selectedPoints =
    rawPoints.length >
      0
      ? rawPoints
      : fallbackPoints;

  if (
    selectedPoints.length <
    context.config
      .contour
      .minimumPointCount
  ) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The detected item contour does not contain enough valid points.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        detectedPointCount:
          selectedPoints.length,

        minimumPointCount:
          context
            .config
            .contour
            .minimumPointCount,
      },
    });
  }

  const canvasPoints =
    mapPointsToScanCanvas(
      selectedPoints,
      contourSourceWidth,
      contourSourceHeight,
      context.config
        .engine
        .canvasSize
    );

  const preparedPoints =
    clampScanPointsToCanvas(
      prepareScanContour(
        canvasPoints,
        {
          outputPointCount:
            context
              .config
              .contour
              .sampleCount,

          smoothingIterations:
            context
              .config
              .contour
              .smoothingIterations,

          smoothingStrength:
            context
              .config
              .contour
              .smoothingStrength,

          simplifyTolerance:
            context
              .config
              .contour
              .simplifyTolerance,

          clockwise:
            true,
        }
      ),
      context.config
        .engine
        .canvasSize
    );

  const normalizedPoints =
    normalizeScanContourOrder(
      preparedPoints,
      true
    );

  if (
    normalizedPoints.length <
    context.config
      .contour
      .minimumPointCount
  ) {
    throw new ScanEngineError({
      code:
        'LOW_CONTOUR_CONFIDENCE',

      message:
        'The item outline became invalid after contour cleanup.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        preparedPointCount:
          normalizedPoints.length,
      },
    });
  }

  const geometry =
    analyzeScanContourGeometry(
      normalizedPoints
    );
    if (
  geometry.bounds.width <= 
  0 ||
  geometry.bounds.height <=
   0
) {
  throw new ScanEngineError({
    code: 
    'LOW_CONTOUR_CONFIDENCE',
    message:
      'The detected contour has invalid bounds.',
    recoverable: 
    true,
    shouldRetake: 
    true,
  });
}

  const explicitForegroundConfidence =
    readFiniteNumber(
      detected,
      [
        'foregroundConfidence',
        'maskConfidence',
      ],
      -1
    );

  const maskConfidence =
    context.generatedMask
      ? getMaskConfidence(
          context
            .generatedMask
        )
      : 0;

  const foregroundConfidence =
    normalizeConfidence(
      explicitForegroundConfidence >=
        0
        ? explicitForegroundConfidence
        : maskConfidence
    );

  const explicitContourConfidence =
    readFiniteNumber(
      detected,
      [
        'contourConfidence',
        'confidence',
        'quality',
      ],
      -1
    );

  const resultContourConfidence =
    detectionResult
      ? readFiniteNumber(
          detectionResult,
          [
            'contourConfidence',
            'confidence',
            'quality',
          ],
          -1
        )
      : -1;

  /**
   * لا نستخدم Roundness كعامل جودة رئيسي.
   *
   * قطعة الملابس قد تكون:
   * طويلة، رفيعة، غير متماثلة، ذات أشرطة،
   * أو ذات زوايا حادة، ومع ذلك يكون
   * الكونتور صحيحًا تمامًا.
   */
  const pointCoverage =
    clampNumber(
      safeScanDivide(
        normalizedPoints.length,
        context.config
          .contour
          .sampleCount,
        0
      ),
      0,
      1
    );

  const boundsArea =
    Math.max(
      1,
      geometry.bounds.width *
        geometry.bounds.height
    );

  const canvasArea =
    Math.max(
      1,
      context.config
        .engine
        .canvasSize *
      context.config
        .engine
        .canvasSize
    );

  const boundsCoverage =
    clampNumber(
      safeScanDivide(
        boundsArea,
        canvasArea,
        0
      ),
      0,
      1
    );

  const foregroundEvidence =
    normalizeConfidence(
      foregroundConfidence
    );

  const geometryConfidence =
    normalizeConfidence(
      pointCoverage *
        0.5 +
      foregroundEvidence *
        0.35 +
      Math.min(
        1,
        boundsCoverage *
          4
      ) *
        0.15
    );

  const contourConfidence =
    normalizeConfidence(
      explicitContourConfidence >=
        0
        ? explicitContourConfidence
        : resultContourConfidence >=
            0
          ? resultContourConfidence
          : geometryConfidence
    );

  const detectedEdgeValue =
    readBoolean(
      detected,
      [
        'touchesImageEdge',
        'touchesEdge',
        'isClipped',
      ],
      false
    );

  const touchesImageEdge =
    detectedEdgeValue ||
   calculateTouchesImageEdge(
      selectedPoints,
      contourSourceWidth,
      contourSourceHeight,
      context
        .config
        .contour
        .edgePadding
    );

  const backgroundIsUsable =
    readBoolean(
      detected,
      [
        'backgroundIsUsable',
        'backgroundUsable',
        'hasCleanBackground',
      ],
      foregroundConfidence >=
        context.config
          .engine
          .minimumForegroundConfidence
    );

  return {
    path:
      readString(
        detected,
        [
          'path',
          'svgPath',
          'contourPath',
        ],
        scanPointsToSvgPath(
          normalizedPoints,
          true,
          2
        )
      ),

    bounds:
      geometry.bounds,

    direction:
      resolveDetectedDirection(
        context.input
          .preferredDirection,
        detected
      ),

    measurements:
      calculateDetectedMeasurements(
        normalizedPoints
      ),

    sampledPoints:
      normalizedPoints,

    foregroundConfidence,

    contourConfidence,

    touchesImageEdge,

    backgroundIsUsable,
  };
}

/**
 * فحص جودة المحيط قبل المطابقة.
 */
function validateDetectedContour(
  context:
    ScanExecutionContext,
  contour:
    DetectedScanContour
) {
  if (
    contour
      .touchesImageEdge
  ) {
    throw new ScanEngineError({
      code:
        'ITEM_TOUCHES_EDGE',

      message:
        'Keep the complete item inside the camera frame.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

  if (
    contour
      .foregroundConfidence <
    context.config
      .engine
      .minimumForegroundConfidence
  ) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The clothing item is not clear enough in the image.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        foregroundConfidence:
          contour
            .foregroundConfidence,

        minimumForegroundConfidence:
          context
            .config
            .engine
            .minimumForegroundConfidence,
      },
    });
  }

  if (
    contour
      .contourConfidence <
    context.config
      .engine
      .minimumContourConfidence
  ) {
    throw new ScanEngineError({
      code:
        'LOW_CONTOUR_CONFIDENCE',

      message:
        'The outer shape of the item is not clear enough.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        contourConfidence:
          contour
            .contourConfidence,

        minimumContourConfidence:
          context
            .config
            .engine
            .minimumContourConfidence,
      },
    });
  }

  if (
    contour
      .sampledPoints
      .length <
    context.config
      .contour
      .minimumPointCount
  ) {
    throw new ScanEngineError({
      code:
        'LOW_CONTOUR_CONFIDENCE',

      message:
        'The detected contour does not contain enough geometry.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        pointCount:
          contour
            .sampledPoints
            .length,

        minimumPointCount:
          context
            .config
            .contour
            .minimumPointCount,
      },
    });
  }
}

// scan/core/ScanEngine.ts
// Part 3/4

/**
 * التأكد من أن نتيجة MaskGenerator
 * تحتوي على AlphaMask يمكن تمريرها
 * إلى ContourDetector.
 */
function extractAlphaMask(
  generatedMask:
    GeneratedMask
): AlphaMask {
  const generatedRecord =
    asRecord(
      generatedMask
    );

  if (!generatedRecord) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The generated mask is invalid.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

  const directMask =
    generatedRecord
      .mask;

  const alphaMask =
    generatedRecord
      .alphaMask;

  const outputMask =
    generatedRecord
      .output;

  const candidates = [
    alphaMask,
    directMask,
    outputMask,
    generatedMask,
  ];

  for (
    const candidate
    of candidates
  ) {
    const record =
      asRecord(
        candidate
      );

    if (!record) {
      continue;
    }

    const width =
      readFiniteNumber(
        record,
        [
          'width',
        ],
        0
      );

    const height =
      readFiniteNumber(
        record,
        [
          'height',
        ],
        0
      );

    const possibleData =
      record.data ??
      record.alpha ??
      record.values ??
      record.pixels;

    const hasValidData =
      possibleData instanceof
        Uint8Array ||
      possibleData instanceof
        Uint8ClampedArray ||
      possibleData instanceof
        Float32Array ||
      Array.isArray(
        possibleData
      );

    if (
      width >
        0 &&
      height >
        0 &&
      hasValidData
    ) {
      return candidate as AlphaMask;
    }
  }

  throw new ScanEngineError({
    code:
      'FOREGROUND_NOT_FOUND',

    message:
      'MaskGenerator did not return usable alpha data.',

    recoverable:
      true,

    shouldRetake:
      true,
  });
}

/**
 * التحقق من سلامة AlphaMask قبل
 * استخراج الكونتور.
 *
 * هذه المرحلة تمنع تمرير Mask:
 * - بأبعاد غير صالحة.
 * - ببيانات ناقصة.
 * - فارغ بالكامل.
 * - ممتلئ بالكامل بصورة غير منطقية.
 */
function validateAlphaMaskIntegrity(
  context:
    ScanExecutionContext,
  alphaMask:
    AlphaMask
) {
  const record =
    asRecord(
      alphaMask
    );

  if (!record) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The generated alpha mask is invalid.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

  const width =
    readFiniteNumber(
      record,
      [
        'width',
      ],
      0
    );

  const height =
    readFiniteNumber(
      record,
      [
        'height',
      ],
      0
    );

  const data =
    record.data ??
    record.alpha ??
    record.values ??
    record.pixels;

  const dataLength =
    (
      data instanceof
        Uint8Array ||
      data instanceof
        Uint8ClampedArray ||
      data instanceof
        Float32Array ||
      Array.isArray(
        data
      )
    )
      ? data.length
      : 0;

  const expectedLength =
    width *
    height;

  if (
    !Number.isInteger(
      width
    ) ||
    !Number.isInteger(
      height
    ) ||
    width <=
      0 ||
    height <=
      0 ||
    !Number.isSafeInteger(
      expectedLength
    ) ||
    dataLength <
      expectedLength
  ) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The generated alpha mask data is incomplete.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        maskWidth:
          width,

        maskHeight:
          height,

        expectedLength:
          Number.isSafeInteger(
            expectedLength
          )
            ? expectedLength
            : null,

        receivedLength:
          dataLength,
      },
    });
  }

  const analysis =
    analyzeAlphaMask(
      alphaMask
    );

  const foregroundRatio =
    getMaskForegroundRatio(
      analysis
    ) ||
    getMaskForegroundRatio(
      context.generatedMask
    );

  if (
    foregroundRatio <
    context.config
      .mask
      .minimumForegroundRatio
  ) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The alpha mask does not contain a clear clothing item.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        foregroundRatio,

        minimumForegroundRatio:
          context.config
            .mask
            .minimumForegroundRatio,
      },
    });
  }

  if (
    foregroundRatio >
    context.config
      .mask
      .maximumForegroundRatio
  ) {
    throw new ScanEngineError({
      code:
        'BACKGROUND_TOO_COMPLEX',

      message:
        'The alpha mask covers almost the complete image.',

      recoverable:
        true,

      shouldRetake:
        true,

      details: {
        foregroundRatio,

        maximumForegroundRatio:
          context.config
            .mask
            .maximumForegroundRatio,
      },
    });
  }
}

/**
 * بناء Input مرن لـMaskGenerator.
 *
 * استخدام Object موحد يسمح للـBackend
 * الحالي باستقبال URI أو RGBA بدون أن
 * يعرف ScanEngine تفاصيل التنفيذ الداخلي.
 */
/**
 * بناء Input الصحيح الذي يستقبله
 * MaskGenerator.
 */
function createMaskGeneratorInput(
  context:
    ScanExecutionContext
): GenerateMaskInput {
  const image =
    context.input.image;

  const options =
    context.config
      .mask;

  const selectedBackend =
    options.backendId
      ? getMaskBackend(
          options.backendId
        )
      : undefined;

  if (
    options.backendId &&
    !selectedBackend
  ) {
    throw new ScanEngineError({
      code:
        'UNKNOWN_ERROR',

      message:
        `The requested mask backend "${options.backendId}" is not registered.`,

      recoverable:
        false,

      shouldRetake:
        false,

      details: {
        backendId:
          options.backendId,
      },
    });
  }

  const alphaThreshold =
    clampNumber(
      Math.round(
        options.threshold *
          255
      ),
      0,
      255
    );

  const cleanup =
    options.cleanup
      ? {
        alphaThreshold,

          /**
           * إزالة الضوضاء المنفصلة فقط،
           * دون إزالة أجزاء صغيرة متصلة بالقطعة.
           */
          removeSmallComponents:
            true,

          minimumComponentAreaRatio:
            0.00035,

          /**
           * صورة Scan Item يجب أن تحتوي
           * على قطعة رئيسية واحدة.
           */
          keepLargestComponent:
            true,

          /**
           * يغلق الثقوب الناتجة عن خطأ الموديل،
           * وليس الفتحات الطبيعية خارج المحيط.
           */
          fillHoles:
            true,

          /**
           * ممنوع تآكل الحافة الحقيقية.
           */
          erosionIterations:
            0,

          /**
           * الـDilation القديم كان يضيف Pixels
           * خارج حدود القطعة ويعيد جزءًا من الخلفية.
           */
          dilationIterations:
            0,

          smoothingIterations:
            1,

          /**
           * تنعيم خفيف يحافظ على تفاصيل
           * القماش والأشرطة والكعب والأكمام.
           */
          smoothingStrength:
            0.12,

          /**
           * لا نوسع حدود القطعة المصورة.
           */
          boundsPadding:
            0,
        }
      : {
          alphaThreshold,

          removeSmallComponents:
            false,

          minimumComponentAreaRatio:
            0,

          keepLargestComponent:
            false,

          fillHoles:
            false,

          erosionIterations:
            0,

          dilationIterations:
            0,

          smoothingIterations:
            0,

          smoothingStrength:
            0,

          boundsPadding:
            0,
        };

  if (
    image.kind ===
    'uri'
  ) {
    return {
      source: {
        type:
          'uri',

        uri:
          normalizeImageUri(
            image.uri
          ),

        width:
          image.width,

        height:
          image.height,
      },

      backend:
        selectedBackend,

      config: {
        mode:
          'automatic',

        cleanup,

        minimumConfidence:
          context.config
            .engine
            .minimumForegroundConfidence,
      },

      signal:
        context.input
          .signal,
    };
  }

  /**
   * MaskGenerator يشترط Uint8Array
   * بطول RGBA مطابق تمامًا.
   */
  const rgbaData =
    image.data instanceof
      Uint8Array
      ? image.data
      : new Uint8Array(
          image.data
        );

  return {
    source: {
      type:
        'rgba',

      width:
        image.width,

      height:
        image.height,

      data:
        rgbaData,
    },

    backend:
      selectedBackend,

    config: {
      mode:
        'automatic',

      cleanup,

      minimumConfidence:
        context.config
          .engine
          .minimumForegroundConfidence,
    },

    signal:
      context.input
        .signal,
  };
}

/**
 * تشغيل MaskGenerator من خلال
 * واجهة داخلية واحدة.
 *
 * الـCast هنا يعزل اختلاف شكل Input
 * الخاص بأي Backend عن باقي المحرك.
 */
/**
 * تشغيل MaskGenerator.
 */
async function runMaskGeneration(
  context:
    ScanExecutionContext
): Promise<GeneratedMask> {
  throwIfCancelled(
    context.input
      .signal
  );

  /**
   * تسجيل Backend الخاص بصور URI
   * قبل محاولة اختياره.
   */
  if (
    context.input
      .image
      .kind ===
    'uri'
  ) {
    await registerDefaultUriMaskBackend();
  }

  throwIfCancelled(
    context.input
      .signal
  );

  const generatedMask =
    await generateMask(
      createMaskGeneratorInput(
        context
      )
    );

  throwIfCancelled(
    context.input
      .signal
  );

  if (!generatedMask) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The item mask could not be generated.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

  validateGeneratedMask(
    context,
    generatedMask
  );

  return generatedMask;
}

/**
 * بناء Input الخاص بـContourDetector.
 */
/**
 * بناء Input الصحيح الخاص
 * بـContourDetector.
 */
function createContourDetectorInput(
  context:
    ScanExecutionContext,
  alphaMask:
    AlphaMask
): DetectContourInput {
  const contourConfig =
    context.config
      .contour;

  return {
    mask:
      alphaMask,

    config: {
      method:
        'automatic',

      threshold:
        clampNumber(
          Math.round(
            context.config
              .mask
              .threshold *
              255
          ),
          0,
          255
        ),

      keepLargestContour:
        true,

      minimumAreaRatio:
        context.config
          .mask
          .minimumForegroundRatio,

      /**
       * لا نرفضه داخل ContourDetector
       * حتى نحصل على نتيجة واضحة،
       * ثم ScanEngine يفحص الحواف بنفسه.
       */
      rejectEdgeTouchingContour:
        false,

      edgeMargin:
        Math.max(
          0,
          Math.floor(
            contourConfig
              .edgePadding
          )
        ),

      cleanup: {
        removeDuplicatePoints:
          true,

        minimumPointDistance:
          0.75,

        simplify:
          true,

        simplifyTolerance:
          contourConfig
            .simplifyTolerance,

        smooth:
          contourConfig
            .smoothingIterations >
          0,

        smoothingIterations:
          contourConfig
            .smoothingIterations,

        smoothingStrength:
          contourConfig
            .smoothingStrength,

        resamplePointCount:
          contourConfig
            .sampleCount,

        minimumPointCount:
          contourConfig
            .minimumPointCount,

        maximumPointCount:
          Math.max(
            512,
            contourConfig
              .sampleCount
          ),

        direction:
          'clockwise',

        normalizeStartPoint:
          true,
      },

      minimumConfidence:
        context.config
          .engine
          .minimumContourConfidence,
    },

    signal:
      context.input
        .signal,
  };
}

/**
 * استخراج DetectedContour الأساسي
 * من نتيجة ContourDetector.
 */
function extractDetectedContour(
  result:
    ContourDetectionResult
): DetectedContour {
  const record =
    asRecord(
      result
    );

  if (!record) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'ContourDetector returned an invalid result.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

  const candidates = [
    record.contour,
    record.detectedContour,
    record.primaryContour,
    record.result,
    result,
  ];

  for (
    const candidate
    of candidates
  ) {
    if (
      readScanPoints(
        candidate
      ).length >
      0
    ) {
      return candidate as DetectedContour;
    }
  }

  throw new ScanEngineError({
    code:
      'FOREGROUND_NOT_FOUND',

    message:
      'No valid outer contour was detected.',

    recoverable:
      true,

    shouldRetake:
      true,
  });
}

/**
 * تشغيل ContourDetector.
 */
/**
 * تشغيل ContourDetector.
 */
async function runContourDetection(
  context:
    ScanExecutionContext,
  alphaMask:
    AlphaMask
): Promise<{
  detectionResult:
    ContourDetectionResult;

  detectedContour:
    DetectedContour;
}> {
  throwIfCancelled(
    context.input
      .signal
  );

  const detectionResult =
    await detectContour(
      createContourDetectorInput(
        context,
        alphaMask
      )
    );

  throwIfCancelled(
    context.input
      .signal
  );

  if (!detectionResult) {
    throw new ScanEngineError({
      code:
        'FOREGROUND_NOT_FOUND',

      message:
        'The outer contour of the item could not be detected.',

      recoverable:
        true,

      shouldRetake:
        true,
    });
  }

  return {
    detectionResult,

    detectedContour:
      extractDetectedContour(
        detectionResult
      ),
  };
}

/**
 * بناء Debug خاص بالـMask.
 */
function createMaskDebugData(
  context:
    ScanExecutionContext
): ScanEngineDebugData['mask'] | undefined {
  const generatedMask =
    context.generatedMask;

  if (
    !generatedMask
  ) {
    return undefined;
  }

  const alphaMask =
    generatedMask.mask;

  const statistics =
    generatedMask
      .statistics;

  const rawBounds =
    statistics.bounds
      .width >
        0 &&
    statistics.bounds
      .height >
        0
      ? statistics.bounds
      : null;

  return {
    width:
      alphaMask.width,

    height:
      alphaMask.height,

    foregroundRatio:
      statistics
        .foregroundRatio,

    confidence:
      generatedMask
        .confidence,

    bounds:
      rawBounds
        ? mapBoundsToScanCanvas(
            rawBounds,
            alphaMask.width,
            alphaMask.height,
            context.config
              .engine
              .canvasSize
          )
        : null,
  };
}

/**
 * بناء Debug الخاص بالمحيط.
 */
function createContourDebugData(
  context:
    ScanExecutionContext
): ScanEngineDebugData['contour'] | undefined {
  if (
    !context
      .detectedContour
  ) {
    return undefined;
  }

  const rawPointCount =
    context.rawContour
      ? readScanPoints(
          context
            .rawContour
        ).length
      : 0;

  const contour =
    context.detectedContour;

  return {
    originalPointCount:
      rawPointCount,

    preparedPointCount:
      contour
        .sampledPoints
        .length,

    direction:
      contour
        .direction,

    foregroundConfidence:
      contour
        .foregroundConfidence,

    contourConfidence:
      contour
        .contourConfidence,

    touchesImageEdge:
      contour
        .touchesImageEdge,

    backgroundIsUsable:
      contour
        .backgroundIsUsable,
  };
}

/**
 * بناء Debug الخاص بـQuality Gate.
 */
function createQualityDebugData(
  context:
    ScanExecutionContext
): ScanEngineDebugData['quality'] | undefined {
  const qualityResult =
    context.qualityResult;

  if (
    !qualityResult
  ) {
    return undefined;
  }

  return {
    accepted:
      qualityResult
        .accepted,

    decision:
      qualityResult
        .decision,

    score:
      qualityResult
        .score,

    userMessageKey:
      qualityResult
        .userMessageKey,

    primaryIssueCode:
      qualityResult
        .primaryIssue
        ?.code ??
      null,

    primaryIssueSeverity:
      qualityResult
        .primaryIssue
        ?.severity ??
      null,

    issueCount:
      qualityResult
        .issues
        .length,

    preScore:
      qualityResult
        .preSegmentation
        ?.score ??
      null,

    postScore:
      qualityResult
        .postSegmentation
        ?.score ??
      null,

    foregroundRatio:
      qualityResult
        .postSegmentation
        ?.mask
        .foregroundRatio ??
      null,

    componentCount:
      qualityResult
        .postSegmentation
        ?.mask
        .componentCount ??
      null,

    touchedEdgeCount:
      qualityResult
        .postSegmentation
        ?.mask
        .edgeContact
        .edgeCount ??
      null,

    processingTimeMs:
      qualityResult
        .processingTimeMs,
  };
}

/**
 * بناء Debug النهائي.
 */
function createScanDebugData(
  context:
    ScanExecutionContext
): ScanEngineDebugData | undefined {
  if (
    !context.config
      .debug
      .enabled
  ) {
    return undefined;
  }

  const debug:
    ScanEngineDebugData = {
    stages:
      context.config
        .debug
        .includeStageTimings
        ? context.timings.map(
            timing => ({
              ...timing,
            })
          )
        : [],
  };

  if (
    context.config
      .debug
      .includeMask
  ) {
    debug.mask =
      createMaskDebugData(
        context
      );
  }

  if (
    context.config
      .debug
      .includeContourPoints
  ) {
    debug.contour =
      createContourDebugData(
        context
      );
  }

  if (
    context.qualityResult
  ) {
    debug.quality =
      createQualityDebugData(
        context
      );
  }

  return debug;
}

/**
 * إنشاء ScanAnalysisResult النهائي.
 */
function createAnalysisResult(
  context:
    ScanExecutionContext
): ScanAnalysisResult {
  const detectedContour =
    context.detectedContour;

  if (
    !detectedContour
  ) {
    throw new ScanEngineError({
      code:
        'UNKNOWN_ERROR',

      message:
        'The scan result is incomplete.',

      recoverable:
        true,

      shouldRetake:
        false,
    });
  }

  const processedAt =
    Date.now();

  return {
    status:
      'ready',

    gender:
      context.input
        .gender,

    requestedCategory:
      context.input
        .requestedCategory,

    requestedSubCategory:
      context.input
        .requestedSubCategory ??
      null,

    detectedContour,

    finalCategory:
      context.input
        .requestedCategory,

    finalSubCategory:
      context.input
        .requestedSubCategory ??
      null,

    processedAt,

    processingTimeMs:
      Math.max(
        0,
        processedAt -
          context.startedAt
      ),
  };
}

// scan/core/ScanEngine.ts
// Part 4/4

/**
 * تشغيل خط التحليل الكامل.
 *
 * هذه الدالة ترمي ScanEngineError
 * عند حدوث مشكلة.
 *
 * للاستخدام الآمن داخل الشاشات
 * استخدم tryRunScanEngine().
 */
export async function runScanEngine(
  input:
    ScanEngineInput
): Promise<ScanEngineSuccess> {
  const context =
    createExecutionContext(
      input
    );

  try {
    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'validating'
    );

    validateScanEngineInput(
      input
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'preparing'
    );

    /**
     * هذه المرحلة جاهزة لأي تجهيز إضافي
     * مثل Crop أو Resize قبل MaskGenerator.
     *
     * حاليًا MaskGenerator يستقبل الصورة
     * مباشرة مع الأبعاد الأصلية.
     */
    await Promise.resolve();

    runQualityPreCheck(
      context
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'generating-mask'
    );

    const generatedMask =
      await runMaskGeneration(
        context
      );

    context.generatedMask =
      generatedMask;

    const alphaMask =
      extractAlphaMask(
        generatedMask
      );

    context.alphaMask =
      alphaMask;

    validateAlphaMaskIntegrity(
      context,
      alphaMask
    );

    runQualityPostCheck(
      context,
      alphaMask
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'detecting-contour'
    );

    const contourOutput =
      await runContourDetection(
        context,
        alphaMask
      );

    context.contourDetection =
      contourOutput
        .detectionResult;

    context.rawContour =
      contourOutput
        .detectedContour;

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'building-geometry'
    );

    const detectedContour =
      buildDetectedScanContour(
        context,
        contourOutput
          .detectedContour,
        contourOutput
          .detectionResult
      );

    context.detectedContour =
      detectedContour;

    validateDetectedContour(
      context,
      detectedContour
    );

    throwIfCancelled(
      input.signal
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'finalizing'
    );

    const result =
      createAnalysisResult(
        context
      );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'ready'
    );

    finalizeStageTimings(
      context
    );

    return {
      result,

      debug:
        createScanDebugData(
          context
        ),
    };
  } catch (
    error
  ) {
    if (
      error instanceof
      ScanEngineCancelledError
    ) {
      enterStage(
        context,
        'cancelled'
      );
    } else {
      enterStage(
        context,
        'failed'
      );
    }

    finalizeStageTimings(
      context
    );

    throw error;
  }
}

/**
 * تشغيل المحرك بدون رمي Error.
 *
 * هذه هي الدالة المناسبة لشاشات React Native.
 */
export async function tryRunScanEngine(
  input:
    ScanEngineInput
): Promise<TryScanEngineResult> {
  let context:
    ScanExecutionContext | null =
      null;

  try {
    context =
      createExecutionContext(
        input
      );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'validating'
    );

    validateScanEngineInput(
      input
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'preparing'
    );

    await Promise.resolve();

    runQualityPreCheck(
      context
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'generating-mask'
    );

    const generatedMask =
      await runMaskGeneration(
        context
      );

    context.generatedMask =
      generatedMask;

    const alphaMask =
      extractAlphaMask(
        generatedMask
      );

    context.alphaMask =
      alphaMask;

   validateAlphaMaskIntegrity(
      context,
      alphaMask
    );

    runQualityPostCheck(
      context,
      alphaMask
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'detecting-contour'
    );

    const contourOutput =
      await runContourDetection(
        context,
        alphaMask
      );

    context.contourDetection =
      contourOutput
        .detectionResult;

    context.rawContour =
      contourOutput
        .detectedContour;

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'building-geometry'
    );

    const detectedContour =
      buildDetectedScanContour(
        context,
        contourOutput
          .detectedContour,
        contourOutput
          .detectionResult
      );

    context.detectedContour =
      detectedContour;

    validateDetectedContour(
      context,
      detectedContour
    );

    throwIfCancelled(
      input.signal
    );

    throwIfCancelled(
      input.signal
    );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'finalizing'
    );

    const result =
      createAnalysisResult(
        context
      );

    throwIfCancelled(
      input.signal
    );

    enterStage(
      context,
      'ready'
    );

    finalizeStageTimings(
      context
    );

    return {
      success:
        true,

      output: {
        result,

        debug:
          createScanDebugData(
            context
          ),
      },
    };
  } catch (
    error
  ) {
    if (context) {
      if (
        error instanceof
        ScanEngineCancelledError
      ) {
        enterStage(
          context,
          'cancelled'
        );
      } else {
        enterStage(
          context,
          'failed'
        );
      }

      finalizeStageTimings(
        context
      );
    }

    const failure =
      createFailureFromError(
        error
      );

    return {
      success:
        false,

      failure,

      debug:
        context
          ? createScanDebugData(
              context
            )
          : undefined,
    };
  }
}

/**
 * واجهة مختصرة تعيد ScanEngineResult فقط.
 *
 * مناسبة للخدمات التي لا تحتاج Debug.
 */
export async function analyzeScanImage(
  input:
    ScanEngineInput
): Promise<ScanEngineResult> {
  const scanResult =
    await tryRunScanEngine(
      input
    );

  if (
    scanResult.success
  ) {
    return scanResult
      .output
      .result;
  }

  return scanResult
    .failure;
}

/**
 * فحص هل نتيجة المحرك ناجحة.
 */
export function isScanEngineSuccess(
  result:
    ScanEngineResult
): result is ScanAnalysisResult {
  return (
    result.status ===
    'ready'
  );
}

/**
 * فحص هل نتيجة المحرك فاشلة.
 */
export function isScanEngineFailure(
  result:
    ScanEngineResult
): result is ScanFailure {
  return (
    result.status ===
    'failed'
  );
}

/**
 * فحص هل الخطأ يمثل إلغاءً.
 */
export function isScanEngineCancelled(
  error:
    unknown
) {
  if (
    error instanceof
    ScanEngineCancelledError
  ) {
    return true;
  }

  if (
    error instanceof
      ScanEngineError &&
    error.details
      ?.cancelled ===
      true
  ) {
    return true;
  }

  const message =
    getUnknownErrorMessage(
      error
    )
      .toLowerCase();

  return (
    message.includes(
      'cancelled'
    ) ||
    message.includes(
      'canceled'
    ) ||
    message.includes(
      'aborted'
    )
  );
}

/**
 * معرفة هل يمكن إعادة المحاولة
 * بنفس الصورة.
 */
export function canRetryScanFailure(
  failure:
    ScanFailure
) {
  return (
    failure.recoverable &&
    !failure.shouldRetake
  );
}

/**
 * معرفة هل يحتاج المستخدم
 * إلى فتح الكاميرا من جديد.
 */
export function shouldRetakeScanPhoto(
  result:
    ScanEngineResult
) {
  return (
    result.status ===
      'failed' &&
    result.shouldRetake
  );
}

/**
 * إنشاء رسالة مناسبة للواجهة
 * من نتيجة الفشل.
 *
 * يمكن لاحقًا استبدال النصوص
 * بمفاتيح i18n.
 */
export function getScanFailureUserMessage(
  failure:
    ScanFailure
) {
  switch (
    failure.code
  ) {
    case 'INVALID_IMAGE':
      return 'The selected image is invalid. Please try another photo.';

    case 'IMAGE_NOT_FOUND':
      return 'The captured image could not be found. Please take the photo again.';

    case 'UNSUPPORTED_CATEGORY':
      return 'This item category is not supported by the scanner yet.';

    case 'FOREGROUND_NOT_FOUND':
      return 'Place one item on a clean contrasting background and try again.';

    case 'MULTIPLE_ITEMS_FOUND':
      return 'Only one item should appear inside the camera frame.';

    case 'ITEM_TOUCHES_EDGE':
      return 'Keep the complete item inside the camera frame with space around it.';

    case 'BACKGROUND_TOO_COMPLEX':
      return 'Use a cleaner plain background with stronger contrast.';

    case 'LOW_CONTOUR_CONFIDENCE':
      return 'The item outline is not clear enough. Improve the lighting and try again.';

    case 'EXPORT_FAILED':
      return 'The transparent image could not be created. Please try again.';

      case 'CANCELLED':
  return 'The scan was cancelled.';

    case 'UNKNOWN_ERROR':
    default:
      return (
        failure.message ||
        'The scan could not be completed. Please try again.'
      );
  }
}


  /**
 * إنشاء ملخص خفيف لنتيجة النجاح.
 */
export function getScanResultSummary(
  result:
    ScanAnalysisResult
) {
  return {
    status:
      result.status,

    gender:
      result.gender,

    requestedCategory:
      result
        .requestedCategory,

    finalCategory:
      result
        .finalCategory,

    finalSubCategory:
      result
        .finalSubCategory,

    direction:
      result
        .detectedContour
        .direction,

    foregroundConfidence:
      result
        .detectedContour
        .foregroundConfidence,

    contourConfidence:
      result
        .detectedContour
        .contourConfidence,

    pointCount:
      result
        .detectedContour
        .sampledPoints
        .length,

    touchesImageEdge:
      result
        .detectedContour
        .touchesImageEdge,

    processingTimeMs:
      result
        .processingTimeMs,
  };
}

/**
 * إنشاء ملخص Debug للعملية الكاملة.
 */
export function getScanEngineDebugSummary(
  output:
    ScanEngineSuccess
) {
  const result =
    output.result;

  return {
    result:
      getScanResultSummary(
        result
      ),

    detectedContour: {
      direction:
        result
          .detectedContour
          .direction,

      pointCount:
        result
          .detectedContour
          .sampledPoints
          .length,

      bounds:
        result
          .detectedContour
          .bounds,

      foregroundConfidence:
        result
          .detectedContour
          .foregroundConfidence,

      contourConfidence:
        result
          .detectedContour
          .contourConfidence,

      touchesImageEdge:
        result
          .detectedContour
          .touchesImageEdge,

      backgroundIsUsable:
        result
          .detectedContour
          .backgroundIsUsable,
    },

    stages:
      output.debug
        ?.stages ??
      [],

    mask:
      output.debug
        ?.mask,

    contour:
      output.debug
        ?.contour,

    quality:
      output.debug
        ?.quality,
  };
}

/**
 * إنشاء إعدادات جديدة بدون تعديل
 * DEFAULT_SCAN_ENGINE_CONFIG الأصلي.
 */
export function createScanEngineConfig(
  custom?:
    PartialScanEngineConfig
): ScanEngineConfig {
  return resolveCoreEngineConfig(
    custom
  );
}

/**
 * تجهيز Runtime Config كامل
 * للاختبارات أو الخدمات الخارجية.
 */
export function createScanRuntimeConfig(
  custom?:
    ScanEngineRuntimeConfig
) {
  return resolveRuntimeConfig(
    custom
  );
}