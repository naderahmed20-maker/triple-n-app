// scan/core/ai/modelConfig.ts
//
// Triple N - EdgeSAM Model Configuration
//
// هذا الملف يحتوي على الإعداد النهائي لمحرك
// Scan Item المحلي باستخدام:
//
// - EdgeSAM Image Encoder ONNX
// - EdgeSAM Mask Decoder ONNX
//
// هذا الملف لا يشغّل الموديلات.
// مسؤوليته:
//
// - تعريف ملفات Encoder وDecoder.
// - تعريف أسماء Inputs وOutputs.
// - إعداد تجهيز الصورة.
// - إعداد الـAutomatic Prompt.
// - إعداد اختيار أفضل Mask.
// - إعداد تحسين Alpha Mask.
// - إعداد جلسات ONNX.
// - إعداد Embedding Cache.
// - التحقق الكامل من سلامة الإعدادات.
// - إنشاء نسخ وإعدادات مخصصة للاختبار.

import {
  Platform,
} from 'react-native';

import {
  SegmentationError,
  clampSegmentationValue,
} from './types';

import type {
  EdgeSamAutomaticPromptConfig,
  EdgeSamDecoderConfig,
  EdgeSamEmbeddingCacheConfig,
  EdgeSamEncoderInputConfig,
  EdgeSamEncoderOutputConfig,
  EdgeSamMaskSelectionConfig,
  EdgeSamMaskSelectionWeights,
  SegmentationExecutionProvider,
  SegmentationLogLevel,
  SegmentationMaskRefinementConfig,
  SegmentationModelAsset,
  SegmentationModelConfig,
  SegmentationNormalization,
  SegmentationSessionConfig,
  SegmentationTensorLayout,
} from './types';

/* =========================================================
 * Model identity
 * ======================================================= */

export const EDGESAM_MODEL_ID =
  'edgesam-encoder-decoder-onnx';

export const EDGESAM_MODEL_DISPLAY_NAME =
  'EdgeSAM';

export const EDGESAM_MODEL_FAMILY =
  'edgesam' as const;

export const EDGESAM_MODEL_VERSION =
  '1.0.0';

/* =========================================================
 * Bundled model files
 * ======================================================= */

/**
 * ملفات .db هي الملفات التي تدخل داخل
 * Native Build لتجنب مرور ملفات ONNX
 * الكبيرة مباشرة عبر Metro.
 *
 * أثناء التشغيل يتم نسخها إلى مساحة
 * التطبيق المحلية وإعادة تسميتها إلى .onnx.
 */

export const EDGESAM_ENCODER_RESOURCE_NAME =
  'edge_sam_encoder';

export const EDGESAM_ENCODER_BUNDLED_FILE_NAME =
  'edge_sam_encoder.db';

export const EDGESAM_ENCODER_FILE_NAME =
  'edge_sam_encoder.onnx';

export const EDGESAM_DECODER_RESOURCE_NAME =
  'edge_sam_decoder';

export const EDGESAM_DECODER_BUNDLED_FILE_NAME =
  'edge_sam_decoder.db';

export const EDGESAM_DECODER_FILE_NAME =
  'edge_sam_decoder.onnx';

export const EDGESAM_MODEL_EXTENSION =
  'onnx' as const;

/* =========================================================
 * Encoder dimensions
 * ======================================================= */

export const EDGESAM_ENCODER_INPUT_WIDTH =
  1024;

export const EDGESAM_ENCODER_INPUT_HEIGHT =
  1024;

export const EDGESAM_ENCODER_INPUT_CHANNELS =
  3 as const;

export const EDGESAM_ENCODER_INPUT_BATCH_SIZE =
  1 as const;

export const EDGESAM_ENCODER_INPUT_LAYOUT =
  'NCHW' as const;

export const EDGESAM_ENCODER_INPUT_DATA_TYPE =
  'float32' as const;

/**
 * EdgeSAM يحافظ على نفس حجم إدخال
 * SAM الأساسي:
 *
 * [1, 3, 1024, 1024]
 */
export const EDGESAM_ENCODER_INPUT_NAME =
  'image';

/* =========================================================
 * Encoder output
 * ======================================================= */

/**
 * خرج Encoder المتوقع:
 *
 * [1, 256, 64, 64]
 *
 * SegmentationSession ستفحص أسماء الموديل
 * الفعلية، وتستخدم أول خرج Float صالح
 * إذا لم تجد الاسم المفضل.
 */
export const EDGESAM_ENCODER_OUTPUT_NAME:
  string | null =
  'image_embeddings';

export const EDGESAM_EMBEDDING_CHANNELS =
  256;

export const EDGESAM_EMBEDDING_WIDTH =
  64;

export const EDGESAM_EMBEDDING_HEIGHT =
  64;

/* =========================================================
 * Decoder input names
 * ======================================================= */

export const EDGESAM_DECODER_IMAGE_EMBEDDINGS_INPUT_NAME =
  'image_embeddings';

export const EDGESAM_DECODER_POINT_COORDS_INPUT_NAME =
  'point_coords';

export const EDGESAM_DECODER_POINT_LABELS_INPUT_NAME =
  'point_labels';

export const EDGESAM_DECODER_MASK_INPUT_NAME =
  'mask_input';

export const EDGESAM_DECODER_HAS_MASK_INPUT_NAME =
  'has_mask_input';

export const EDGESAM_DECODER_ORIGINAL_IMAGE_SIZE_INPUT_NAME =
  'orig_im_size';

/* =========================================================
 * Decoder output names
 * ======================================================= */

export const EDGESAM_DECODER_MASKS_OUTPUT_NAME:
  string | null =
  'masks';

export const EDGESAM_DECODER_IOU_OUTPUT_NAME:
  string | null =
  'iou_predictions';

export const EDGESAM_DECODER_LOW_RES_MASKS_OUTPUT_NAME:
  string | null =
  'low_res_masks';

/* =========================================================
 * Decoder mask-input dimensions
 * ======================================================= */

export const EDGESAM_DECODER_MASK_INPUT_WIDTH =
  256;

export const EDGESAM_DECODER_MASK_INPUT_HEIGHT =
  256;

/* =========================================================
 * Image normalization
 * ======================================================= */

/**
 * SAM / EdgeSAM preprocessing:
 *
 * normalized =
 *   pixel - mean
 *   ثم القسمة على std
 *
 * القيم الأصلية هنا على نطاق 0..255،
 * لذلك scale = 1 وليس 255.
 */
export const EDGESAM_NORMALIZATION:
  SegmentationNormalization = {
  mean: [
    123.675,
    116.28,
    103.53,
  ],

  std: [
    58.395,
    57.12,
    57.375,
  ],

  scale:
    1,

  channelOrder:
    'rgb',
};

/**
 * Padding أسود.
 *
 * ملاحظة تنفيذية:
 * Preprocessor الخاص بـEdgeSAM يجب أن يضع
 * الصورة بعد resize في أعلى اليسار،
 * ويضيف Padding ناحية اليمين والأسفل،
 * حتى تتطابق الإحداثيات مع SAM.
 */
export const EDGESAM_LETTERBOX_COLOR =
  [
    0,
    0,
    0,
  ] as const;

/* =========================================================
 * Encoder input configuration
 * ======================================================= */

export const EDGESAM_ENCODER_INPUT_CONFIG:
  EdgeSamEncoderInputConfig = {
  name:
    EDGESAM_ENCODER_INPUT_NAME,

  width:
    EDGESAM_ENCODER_INPUT_WIDTH,

  height:
    EDGESAM_ENCODER_INPUT_HEIGHT,

  channels:
    EDGESAM_ENCODER_INPUT_CHANNELS,

  batchSize:
    EDGESAM_ENCODER_INPUT_BATCH_SIZE,

  layout:
    EDGESAM_ENCODER_INPUT_LAYOUT,

  dataType:
    EDGESAM_ENCODER_INPUT_DATA_TYPE,

  resizeMode:
    'letterbox',

  interpolation:
    'linear',

  normalization:
    EDGESAM_NORMALIZATION,

  letterboxColor:
    EDGESAM_LETTERBOX_COLOR,
};

/* =========================================================
 * Encoder output configuration
 * ======================================================= */

export const EDGESAM_ENCODER_OUTPUT_CONFIG:
  EdgeSamEncoderOutputConfig = {
  preferredName:
    EDGESAM_ENCODER_OUTPUT_NAME,

  layout:
    'NCHW',

  dataType:
    'float32',

  convertToFloat32:
    true,

  expectedDimensions: [
    1,
    EDGESAM_EMBEDDING_CHANNELS,
    EDGESAM_EMBEDDING_HEIGHT,
    EDGESAM_EMBEDDING_WIDTH,
  ],
};

/* =========================================================
 * Decoder configuration
 * ======================================================= */

export const EDGESAM_DECODER_CONFIG:
  EdgeSamDecoderConfig = {
  inputNames: {
    imageEmbeddings:
      EDGESAM_DECODER_IMAGE_EMBEDDINGS_INPUT_NAME,

    pointCoordinates:
      EDGESAM_DECODER_POINT_COORDS_INPUT_NAME,

    pointLabels:
      EDGESAM_DECODER_POINT_LABELS_INPUT_NAME,

    maskInput:
      EDGESAM_DECODER_MASK_INPUT_NAME,

    hasMaskInput:
      EDGESAM_DECODER_HAS_MASK_INPUT_NAME,

    originalImageSize:
      EDGESAM_DECODER_ORIGINAL_IMAGE_SIZE_INPUT_NAME,
  },

  outputNames: {
    masks:
      EDGESAM_DECODER_MASKS_OUTPUT_NAME,

    iouPredictions:
      EDGESAM_DECODER_IOU_OUTPUT_NAME,

    lowResolutionMasks:
      EDGESAM_DECODER_LOW_RES_MASKS_OUTPUT_NAME,
  },

  /**
   * Masks القياسية الخارجة من SAM Decoder
   * تكون Logits.
   */
  maskActivation:
    'sigmoid',

  masksLayout:
    'NCHW',

  maskResizeMode:
    'linear',

  containsLogits:
    true,

  /**
   * SAM Decoder غالبًا يعيد عدة Masks.
   *
   * نترك العدد null حتى يتم اكتشافه
   * من أبعاد الخرج الفعلية.
   */
  expectedMaskCount:
    null,

  maskInputSize: {
    width:
      EDGESAM_DECODER_MASK_INPUT_WIDTH,

    height:
      EDGESAM_DECODER_MASK_INPUT_HEIGHT,
  },

  emptyMaskValue:
    0,

  originalImageSizeDataType:
    'float32',

  originalImageSizeOrder:
    'height-width',
};

/* =========================================================
 * Automatic prompt configuration
 * ======================================================= */

/**
 * EdgeSAM موديل Prompt-based.
 *
 * في Scan Item المستخدم لن يضغط يدويًا
 * على القطعة، لذلك النظام سيكوّن:
 *
 * - Bounding Box تلقائي.
 * - Positive Point داخل مركز الجسم.
 * - Negative Points حول الجسم عند الحاجة.
 */
export const EDGESAM_AUTOMATIC_PROMPT_CONFIG:
  EdgeSamAutomaticPromptConfig = {
  enabled:
    true,

  includePositiveCenterPoint:
    true,

  additionalPositivePoints:
    2,

  includeNegativeBoundaryPoints:
    true,

  maximumNegativePoints:
    4,

  includeBoundingBox:
    true,

  /**
   * توسيع بسيط حول الجسم المتوقع
   * لمنع قص الحواف.
   */
  boxExpansionRatio:
    0.035,

  minimumPromptConfidence:
    0.3,

  /**
   * منع النقاط من الاقتراب جدًا
   * من أطراف الصورة.
   */
  edgeSafeMarginRatio:
    0.025,

  minimumPointDistanceRatio:
    0.08,

  allowCenterFallback:
    true,
};

/* =========================================================
 * Candidate selection weights
 * ======================================================= */

export const EDGESAM_MASK_SELECTION_WEIGHTS:
  EdgeSamMaskSelectionWeights = {
  predictedIou:
    0.27,

  stability:
    0.2,

  foregroundBalance:
    0.1,

  largestComponent:
    0.16,

  isolation:
    0.11,

  centering:
    0.06,

  edgePenalty:
    0.04,

  fragmentationPenalty:
    0.04,

  holePenalty:
    0.02,
};

/* =========================================================
 * Mask selection configuration
 * ======================================================= */

export const EDGESAM_MASK_SELECTION_CONFIG:
  EdgeSamMaskSelectionConfig = {
  mode:
    'best-balanced',

  weights:
    EDGESAM_MASK_SELECTION_WEIGHTS,

  minimumPredictedIou:
    0.45,

  minimumStabilityScore:
    0.55,

  minimumFinalScore:
    0.5,

  /**
   * يمنع اختيار ماسك فارغ تقريبًا.
   */
  minimumForegroundRatio:
    0.012,

  /**
   * يمنع قبول الخلفية كلها كقطعة.
   */
  maximumForegroundRatio:
    0.94,

  minimumLargestComponentRatio:
    0.68,

  maximumSecondComponentRatio:
    0.18,

  maximumEdgeContactRatio:
    0.08,

  maximumTouchedEdges:
    2,

  maximumHoleRatio:
    0.14,

  maximumSignificantComponents:
    3,

  /**
   * أثناء النسخة الأولى نسمح بأفضل
   * نتيجة ضعيفة بدل فشل العملية مباشرة،
   * ثم Quality Gate يقرر Retake.
   */
  allowWeakFallback:
    true,
};

/* =========================================================
 * Mask refinement configuration
 * ======================================================= */

export const EDGESAM_REFINEMENT_CONFIG:
  SegmentationMaskRefinementConfig = {
  threshold:
    0.46,

  softThresholdWidth:
    0.1,

  stabilityThresholdOffset:
    0.05,

  removeNoise:
    true,

  minimumComponentArea:
    32,

  minimumComponentAreaRatio:
    0.00003,

  keepLargestComponentOnly:
    false,

  fillSmallHoles:
    true,

  maximumHoleArea:
    160,

  maximumHoleAreaRatio:
    0.0015,

  applyMorphology:
    true,

  /**
   * نمنع Erosion افتراضيًا
   * لحماية الأربطة والأكمام والحواف.
   */
  erosionRadius:
    0,

  dilationRadius:
    0,

  closingRadius:
    1,

  openingRadius:
    0,

  smoothingRadius:
    0.75,

  smoothingPasses:
    1,

  featherRadius:
    1,

  edgeProtection:
    true,

  edgeProtectionStrength:
    0.78,

  edgeProtectionRadius:
    1,

  finalExpansionRadius:
    0,

  minimumAlpha:
    0,

  maximumAlpha:
    1,

  removeDetachedRegions:
    true,

  maximumDetachedRegionDistanceRatio:
    0.28,

  rejectInvalidForegroundRatio:
    true,

  minimumForegroundRatio:
    0.012,

  maximumForegroundRatio:
    0.94,
};

/* =========================================================
 * Session constants
 * ======================================================= */

export const DEFAULT_SESSION_LOAD_TIMEOUT_MS =
  60_000;

export const DEFAULT_ENCODER_INFERENCE_TIMEOUT_MS =
  120_000;

export const DEFAULT_DECODER_INFERENCE_TIMEOUT_MS =
  45_000;

export const DEFAULT_MAXIMUM_INFERENCE_ATTEMPTS =
  2;

export const DEFAULT_RETRY_BASE_DELAY_MS =
  250;

export const DEFAULT_INTRA_OP_THREADS =
  2;

export const DEFAULT_INTER_OP_THREADS =
  1;

export const DEFAULT_SESSION_LOG_LEVEL:
  SegmentationLogLevel =
  __DEV__
    ? 'warning'
    : 'error';

/* =========================================================
 * Execution provider
 * ======================================================= */

export function getPreferredExecutionProvider():
  SegmentationExecutionProvider {
  /**
   * لا نفرض CoreML أو NNAPI لأن دعمهم
   * يعتمد على نسخة ONNX Runtime
   * والـNative Build المستخدم.
   *
   * SegmentationSession تحاول المزود المتاح،
   * ثم ترجع إلى CPU عند الحاجة.
   */
  if (
    Platform.OS === 'ios' ||
    Platform.OS === 'android'
  ) {
    return 'auto';
  }

  return 'cpu';
}

/* =========================================================
 * Recommended threads
 * ======================================================= */

export function getRecommendedIntraOpThreads():
  number {
  if (
    Platform.OS === 'ios' ||
    Platform.OS === 'android'
  ) {
    return 2;
  }

  return 1;
}

export function getRecommendedInterOpThreads():
  number {
  return 1;
}

/* =========================================================
 * Session configuration factory
 * ======================================================= */

export function createEdgeSamSessionConfig(
  component:
    'encoder' | 'decoder',
  overrides:
    Partial<SegmentationSessionConfig> = {}
): SegmentationSessionConfig {
  const isEncoder =
    component === 'encoder';

  const base:
    SegmentationSessionConfig = {
    executionProvider:
      getPreferredExecutionProvider(),

    intraOpNumThreads:
      getRecommendedIntraOpThreads(),

    interOpNumThreads:
      getRecommendedInterOpThreads(),

    enableCpuMemArena:
      true,

    enableMemPattern:
      true,

    enableProfiling:
      false,

    logLevel:
      DEFAULT_SESSION_LOG_LEVEL,

    graphOptimizationLevel:
      'all',

    sessionLoadTimeoutMs:
      DEFAULT_SESSION_LOAD_TIMEOUT_MS,

    inferenceTimeoutMs:
      isEncoder
        ? DEFAULT_ENCODER_INFERENCE_TIMEOUT_MS
        : DEFAULT_DECODER_INFERENCE_TIMEOUT_MS,

    maximumInferenceAttempts:
      DEFAULT_MAXIMUM_INFERENCE_ATTEMPTS,

    retryBaseDelayMs:
      DEFAULT_RETRY_BASE_DELAY_MS,

    reuseSession:
      true,

    /**
     * Warmup يستهلك ذاكرة إضافية.
     * نتركه متوقفًا حتى انتهاء اختبارات
     * أجهزة 3GB و4GB.
     */
    warmupOnLoad:
      false,

    disposeOnMemoryWarning:
      true,
  };

  return {
    ...base,
    ...overrides,
  };
}

export const EDGESAM_ENCODER_SESSION_CONFIG:
  SegmentationSessionConfig =
  createEdgeSamSessionConfig(
    'encoder'
  );

export const EDGESAM_DECODER_SESSION_CONFIG:
  SegmentationSessionConfig =
  createEdgeSamSessionConfig(
    'decoder'
  );

/* =========================================================
 * Embedding cache
 * ======================================================= */

export const EDGESAM_EMBEDDING_CACHE_CONFIG:
  EdgeSamEmbeddingCacheConfig = {
  /**
   * نحتفظ بآخر Embedding فقط افتراضيًا.
   *
   * هذا يسمح بإعادة تشغيل Decoder
   * بـPrompt مختلف بدون إعادة Encoder.
   */
  policy:
    'memory-lru',

  maximumEntries:
    1,

  /**
   * حد تقريبي آمن للكاش.
   */
  maximumBytes:
    32 * 1024 * 1024,

  maximumAgeMs:
    2 * 60 * 1000,

  disposeAfterRequest:
    true,

  retainLatestEmbedding:
    false,
};

/* =========================================================
 * Model assets
 * ======================================================= */

export const EDGESAM_ENCODER_ASSET:
  SegmentationModelAsset = {
  component:
    'encoder',

  runtime:
    'onnx',

  resourceName:
    EDGESAM_ENCODER_RESOURCE_NAME,

  bundledFileName:
    EDGESAM_ENCODER_BUNDLED_FILE_NAME,

  fileName:
    EDGESAM_ENCODER_FILE_NAME,

  expectedExtension:
    EDGESAM_MODEL_EXTENSION,

  version:
    EDGESAM_MODEL_VERSION,

  required:
    true,
};

export const EDGESAM_DECODER_ASSET:
  SegmentationModelAsset = {
  component:
    'decoder',

  runtime:
    'onnx',

  resourceName:
    EDGESAM_DECODER_RESOURCE_NAME,

  bundledFileName:
    EDGESAM_DECODER_BUNDLED_FILE_NAME,

  fileName:
    EDGESAM_DECODER_FILE_NAME,

  expectedExtension:
    EDGESAM_MODEL_EXTENSION,

  version:
    EDGESAM_MODEL_VERSION,

  required:
    true,
};

/* =========================================================
 * Complete EdgeSAM configuration
 * ======================================================= */

export const EDGESAM_MODEL_CONFIG:
  SegmentationModelConfig = {
  id:
    EDGESAM_MODEL_ID,

  displayName:
    EDGESAM_MODEL_DISPLAY_NAME,

  family:
    EDGESAM_MODEL_FAMILY,

  version:
    EDGESAM_MODEL_VERSION,

  assets: {
    encoder:
      EDGESAM_ENCODER_ASSET,

    decoder:
      EDGESAM_DECODER_ASSET,
  },

  encoder: {
    input:
      EDGESAM_ENCODER_INPUT_CONFIG,

    output:
      EDGESAM_ENCODER_OUTPUT_CONFIG,

    session:
      EDGESAM_ENCODER_SESSION_CONFIG,
  },

  decoder: {
    config:
      EDGESAM_DECODER_CONFIG,

    session:
      EDGESAM_DECODER_SESSION_CONFIG,
  },

  automaticPrompt:
    EDGESAM_AUTOMATIC_PROMPT_CONFIG,

  selection:
    EDGESAM_MASK_SELECTION_CONFIG,

  refinement:
    EDGESAM_REFINEMENT_CONFIG,

  embeddingCache:
    EDGESAM_EMBEDDING_CACHE_CONFIG,
};

/* =========================================================
 * Validation helpers
 * ======================================================= */

function assertObject(
  value: unknown,
  fieldName: string
): asserts value is Record<
  string,
  unknown
> {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} must be an object.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,
        },
      }
    );
  }
}

function assertNonEmptyString(
  value: string,
  fieldName: string
): void {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} cannot be empty.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,
        },
      }
    );
  }
}

function assertFiniteNumber(
  value: number,
  fieldName: string
): void {
  if (
    !Number.isFinite(value)
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} must be finite.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,

          value:
            String(value),
        },
      }
    );
  }
}

function assertFinitePositiveNumber(
  value: number,
  fieldName: string
): void {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} must be a positive finite number.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,

          value:
            Number.isFinite(value)
              ? value
              : String(value),
        },
      }
    );
  }
}

function assertFiniteNonNegativeNumber(
  value: number,
  fieldName: string
): void {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} must be a non-negative finite number.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,

          value:
            Number.isFinite(value)
              ? value
              : String(value),
        },
      }
    );
  }
}

function assertInteger(
  value: number,
  fieldName: string
): void {
  if (
    !Number.isInteger(value)
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} must be an integer.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,
          value,
        },
      }
    );
  }
}

function assertPositiveInteger(
  value: number,
  fieldName: string
): void {
  assertFinitePositiveNumber(
    value,
    fieldName
  );

  assertInteger(
    value,
    fieldName
  );
}

function assertNonNegativeInteger(
  value: number,
  fieldName: string
): void {
  assertFiniteNonNegativeNumber(
    value,
    fieldName
  );

  assertInteger(
    value,
    fieldName
  );
}

function assertUnitRange(
  value: number,
  fieldName: string
): void {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} must be between 0 and 1.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,

          value:
            Number.isFinite(value)
              ? value
              : String(value),
        },
      }
    );
  }
}

function assertBoolean(
  value: boolean,
  fieldName: string
): void {
  if (
    typeof value !== 'boolean'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${fieldName} must be boolean.`,
      {
        retryable:
          false,

        metadata: {
          fieldName,
        },
      }
    );
  }
}

/* =========================================================
 * Asset validation
 * ======================================================= */

function validateModelAsset(
  asset:
    SegmentationModelAsset,
  expectedComponent:
    'encoder' | 'decoder'
): void {
  assertObject(
    asset,
    `assets.${expectedComponent}`
  );

  if (
    asset.component !==
    expectedComponent
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${expectedComponent} asset component is incorrect.`,
      {
        retryable:
          false,

        metadata: {
          expectedComponent,

          receivedComponent:
            String(
              asset.component
            ),
        },
      }
    );
  }

  if (
    asset.runtime !== 'onnx'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${expectedComponent} runtime must be onnx.`,
      {
        retryable:
          false,

        metadata: {
          runtime:
            String(
              asset.runtime
            ),
        },
      }
    );
  }

  assertNonEmptyString(
    asset.resourceName,
    `assets.${expectedComponent}.resourceName`
  );

  assertNonEmptyString(
    asset.bundledFileName,
    `assets.${expectedComponent}.bundledFileName`
  );

  assertNonEmptyString(
    asset.fileName,
    `assets.${expectedComponent}.fileName`
  );

  assertNonEmptyString(
    asset.version,
    `assets.${expectedComponent}.version`
  );

  if (
    asset.expectedExtension !==
    'onnx'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${expectedComponent} expectedExtension must be onnx.`,
      {
        retryable:
          false,
      }
    );
  }

  if (
    !asset.fileName
      .toLowerCase()
      .endsWith('.onnx')
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: ${expectedComponent} fileName must end with .onnx.`,
      {
        retryable:
          false,

        metadata: {
          fileName:
            asset.fileName,
        },
      }
    );
  }

  if (
    asset.sha256 !== undefined
  ) {
    assertNonEmptyString(
      asset.sha256,
      `assets.${expectedComponent}.sha256`
    );
  }

  if (
    asset.approximateSizeBytes !==
    undefined
  ) {
    assertFinitePositiveNumber(
      asset.approximateSizeBytes,
      `assets.${expectedComponent}.approximateSizeBytes`
    );
  }

  assertBoolean(
    asset.required,
    `assets.${expectedComponent}.required`
  );
}

/* =========================================================
 * Normalization validation
 * ======================================================= */

function validateNormalization(
  normalization:
    SegmentationNormalization
): void {
  assertObject(
    normalization,
    'encoder.input.normalization'
  );

  if (
    !Array.isArray(
      normalization.mean
    ) ||
    normalization.mean.length !== 3
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: normalization.mean must contain exactly 3 values.',
      {
        retryable:
          false,
      }
    );
  }

  if (
    !Array.isArray(
      normalization.std
    ) ||
    normalization.std.length !== 3
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: normalization.std must contain exactly 3 values.',
      {
        retryable:
          false,
      }
    );
  }

  normalization.mean.forEach(
    (
      value,
      index
    ) => {
      assertFiniteNumber(
        value,
        `encoder.input.normalization.mean[${index}]`
      );
    }
  );

  normalization.std.forEach(
    (
      value,
      index
    ) => {
      assertFinitePositiveNumber(
        value,
        `encoder.input.normalization.std[${index}]`
      );
    }
  );

  assertFinitePositiveNumber(
    normalization.scale,
    'encoder.input.normalization.scale'
  );

  if (
    normalization.channelOrder !==
      'rgb' &&
    normalization.channelOrder !==
      'bgr'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported channel order.',
      {
        retryable:
          false,

        metadata: {
          channelOrder:
            String(
              normalization.channelOrder
            ),
        },
      }
    );
  }
}

/* =========================================================
 * Encoder validation
 * ======================================================= */

function validateEncoderInputConfig(
  input:
    EdgeSamEncoderInputConfig
): void {
  assertObject(
    input,
    'encoder.input'
  );

  assertNonEmptyString(
    input.name,
    'encoder.input.name'
  );

  assertPositiveInteger(
    input.width,
    'encoder.input.width'
  );

  assertPositiveInteger(
    input.height,
    'encoder.input.height'
  );

  if (
    input.channels !== 3
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: encoder input must contain exactly 3 channels.',
      {
        retryable:
          false,

        metadata: {
          channels:
            input.channels,
        },
      }
    );
  }

  if (
    input.batchSize !== 1
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: only batch size 1 is supported.',
      {
        retryable:
          false,

        metadata: {
          batchSize:
            input.batchSize,
        },
      }
    );
  }

  if (
    input.layout !== 'NCHW'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: encoder layout must be NCHW.',
      {
        retryable:
          false,

        metadata: {
          layout:
            String(
              input.layout
            ),
        },
      }
    );
  }

  if (
    input.dataType !==
      'float32' &&
    input.dataType !==
      'float16'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported encoder input data type.',
      {
        retryable:
          false,

        metadata: {
          dataType:
            String(
              input.dataType
            ),
        },
      }
    );
  }

  const resizeModes =
    new Set([
      'stretch',
      'contain',
      'cover',
      'letterbox',
    ]);

  if (
    !resizeModes.has(
      input.resizeMode
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported encoder resize mode.',
      {
        retryable:
          false,
      }
    );
  }

  const interpolationModes =
    new Set([
      'nearest',
      'linear',
      'cubic',
      'area',
    ]);

  if (
    !interpolationModes.has(
      input.interpolation
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported interpolation mode.',
      {
        retryable:
          false,
      }
    );
  }

  validateNormalization(
    input.normalization
  );

  if (
    !Array.isArray(
      input.letterboxColor
    ) ||
    input.letterboxColor.length !== 3
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: letterboxColor must contain exactly 3 values.',
      {
        retryable:
          false,
      }
    );
  }

  input.letterboxColor.forEach(
    (
      value,
      index
    ) => {
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        value > 255
      ) {
        throw new SegmentationError(
          'INVALID_INPUT',
          `Invalid EdgeSAM configuration: letterboxColor[${index}] must be between 0 and 255.`,
          {
            retryable:
              false,
          }
        );
      }
    }
  );
}

function validateEncoderOutputConfig(
  output:
    EdgeSamEncoderOutputConfig
): void {
  assertObject(
    output,
    'encoder.output'
  );

  if (
    output.preferredName !==
      null
  ) {
    assertNonEmptyString(
      output.preferredName,
      'encoder.output.preferredName'
    );
  }

  if (
    output.dataType !==
      'float32' &&
    output.dataType !==
      'float16'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported encoder output data type.',
      {
        retryable:
          false,
      }
    );
  }

  assertBoolean(
    output.convertToFloat32,
    'encoder.output.convertToFloat32'
  );

  if (
    output.expectedDimensions !==
    undefined
  ) {
    if (
      !Array.isArray(
        output.expectedDimensions
      ) ||
      output.expectedDimensions.length === 0
    ) {
      throw new SegmentationError(
        'INVALID_INPUT',
        'Invalid EdgeSAM configuration: encoder expectedDimensions must not be empty.',
        {
          retryable:
            false,
        }
      );
    }

    output.expectedDimensions.forEach(
      (
        dimension,
        index
      ) => {
        if (
          dimension !== 'dynamic'
        ) {
          assertPositiveInteger(
            dimension,
            `encoder.output.expectedDimensions[${index}]`
          );
        }
      }
    );
  }
}

/* =========================================================
 * Decoder validation
 * ======================================================= */

function validateDecoderConfig(
  decoder:
    EdgeSamDecoderConfig
): void {
  assertObject(
    decoder,
    'decoder.config'
  );

  assertNonEmptyString(
    decoder.inputNames
      .imageEmbeddings,
    'decoder.config.inputNames.imageEmbeddings'
  );

  assertNonEmptyString(
    decoder.inputNames
      .pointCoordinates,
    'decoder.config.inputNames.pointCoordinates'
  );

  assertNonEmptyString(
    decoder.inputNames
      .pointLabels,
    'decoder.config.inputNames.pointLabels'
  );

  assertNonEmptyString(
    decoder.inputNames
      .maskInput,
    'decoder.config.inputNames.maskInput'
  );

  assertNonEmptyString(
    decoder.inputNames
      .hasMaskInput,
    'decoder.config.inputNames.hasMaskInput'
  );

  assertNonEmptyString(
    decoder.inputNames
      .originalImageSize,
    'decoder.config.inputNames.originalImageSize'
  );

  if (
    decoder.outputNames.masks !==
    null
  ) {
    assertNonEmptyString(
      decoder.outputNames.masks,
      'decoder.config.outputNames.masks'
    );
  }

  if (
    decoder.outputNames
      .iouPredictions !== null
  ) {
    assertNonEmptyString(
      decoder.outputNames
        .iouPredictions,
      'decoder.config.outputNames.iouPredictions'
    );
  }

  if (
    decoder.outputNames
      .lowResolutionMasks !== null
  ) {
    assertNonEmptyString(
      decoder.outputNames
        .lowResolutionMasks,
      'decoder.config.outputNames.lowResolutionMasks'
    );
  }

  const activations =
    new Set([
      'none',
      'sigmoid',
      'softmax',
      'auto',
    ]);

  if (
    !activations.has(
      decoder.maskActivation
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported decoder mask activation.',
      {
        retryable:
          false,
      }
    );
  }

  if (
    decoder.maskResizeMode !==
      'nearest' &&
    decoder.maskResizeMode !==
      'linear'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported decoder mask resize mode.',
      {
        retryable:
          false,
      }
    );
  }

  assertBoolean(
    decoder.containsLogits,
    'decoder.config.containsLogits'
  );

  if (
    decoder.expectedMaskCount !==
    null
  ) {
    assertPositiveInteger(
      decoder.expectedMaskCount,
      'decoder.config.expectedMaskCount'
    );
  }

  assertPositiveInteger(
    decoder.maskInputSize.width,
    'decoder.config.maskInputSize.width'
  );

  assertPositiveInteger(
    decoder.maskInputSize.height,
    'decoder.config.maskInputSize.height'
  );

  assertFiniteNumber(
    decoder.emptyMaskValue,
    'decoder.config.emptyMaskValue'
  );

  if (
    decoder.originalImageSizeDataType !==
      'float32' &&
    decoder.originalImageSizeDataType !==
      'int64'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported original-image-size data type.',
      {
        retryable:
          false,
      }
    );
  }

  if (
    decoder.originalImageSizeOrder !==
      'height-width' &&
    decoder.originalImageSizeOrder !==
      'width-height'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported original-image-size order.',
      {
        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Session validation
 * ======================================================= */

function validateSessionConfig(
  session:
    SegmentationSessionConfig,
  fieldPrefix: string
): void {
  assertObject(
    session,
    fieldPrefix
  );

  const providers =
    new Set<
      SegmentationExecutionProvider
    >([
      'cpu',
      'coreml',
      'xnnpack',
      'nnapi',
      'qnn',
      'webgl',
      'wasm',
      'auto',
    ]);

  if (
    !providers.has(
      session.executionProvider
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: unsupported provider in ${fieldPrefix}.`,
      {
        retryable:
          false,
      }
    );
  }

  assertPositiveInteger(
    session.intraOpNumThreads,
    `${fieldPrefix}.intraOpNumThreads`
  );

  assertPositiveInteger(
    session.interOpNumThreads,
    `${fieldPrefix}.interOpNumThreads`
  );

  assertBoolean(
    session.enableCpuMemArena,
    `${fieldPrefix}.enableCpuMemArena`
  );

  assertBoolean(
    session.enableMemPattern,
    `${fieldPrefix}.enableMemPattern`
  );

  assertBoolean(
    session.enableProfiling,
    `${fieldPrefix}.enableProfiling`
  );

  const logLevels =
    new Set<
      SegmentationLogLevel
    >([
      'none',
      'error',
      'warning',
      'info',
      'debug',
    ]);

  if (
    !logLevels.has(
      session.logLevel
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: unsupported log level in ${fieldPrefix}.`,
      {
        retryable:
          false,
      }
    );
  }

  const graphLevels =
    new Set([
      'disabled',
      'basic',
      'extended',
      'all',
    ]);

  if (
    !graphLevels.has(
      session.graphOptimizationLevel
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Invalid EdgeSAM configuration: unsupported graph optimization level in ${fieldPrefix}.`,
      {
        retryable:
          false,
      }
    );
  }

  assertPositiveInteger(
    session.sessionLoadTimeoutMs,
    `${fieldPrefix}.sessionLoadTimeoutMs`
  );

  assertPositiveInteger(
    session.inferenceTimeoutMs,
    `${fieldPrefix}.inferenceTimeoutMs`
  );

  assertPositiveInteger(
    session.maximumInferenceAttempts,
    `${fieldPrefix}.maximumInferenceAttempts`
  );

  assertNonNegativeInteger(
    session.retryBaseDelayMs,
    `${fieldPrefix}.retryBaseDelayMs`
  );

  assertBoolean(
    session.reuseSession,
    `${fieldPrefix}.reuseSession`
  );

  assertBoolean(
    session.warmupOnLoad,
    `${fieldPrefix}.warmupOnLoad`
  );

  assertBoolean(
    session.disposeOnMemoryWarning,
    `${fieldPrefix}.disposeOnMemoryWarning`
  );
}

/* =========================================================
 * Prompt validation
 * ======================================================= */

function validateAutomaticPromptConfig(
  prompt:
    EdgeSamAutomaticPromptConfig
): void {
  assertBoolean(
    prompt.enabled,
    'automaticPrompt.enabled'
  );

  assertBoolean(
    prompt.includePositiveCenterPoint,
    'automaticPrompt.includePositiveCenterPoint'
  );

  assertNonNegativeInteger(
    prompt.additionalPositivePoints,
    'automaticPrompt.additionalPositivePoints'
  );

  assertBoolean(
    prompt.includeNegativeBoundaryPoints,
    'automaticPrompt.includeNegativeBoundaryPoints'
  );

  assertNonNegativeInteger(
    prompt.maximumNegativePoints,
    'automaticPrompt.maximumNegativePoints'
  );

  assertBoolean(
    prompt.includeBoundingBox,
    'automaticPrompt.includeBoundingBox'
  );

  assertUnitRange(
    prompt.boxExpansionRatio,
    'automaticPrompt.boxExpansionRatio'
  );

  assertUnitRange(
    prompt.minimumPromptConfidence,
    'automaticPrompt.minimumPromptConfidence'
  );

  assertUnitRange(
    prompt.edgeSafeMarginRatio,
    'automaticPrompt.edgeSafeMarginRatio'
  );

  assertUnitRange(
    prompt.minimumPointDistanceRatio,
    'automaticPrompt.minimumPointDistanceRatio'
  );

  assertBoolean(
    prompt.allowCenterFallback,
    'automaticPrompt.allowCenterFallback'
  );

  if (
    !prompt.includePositiveCenterPoint &&
    prompt.additionalPositivePoints === 0 &&
    !prompt.includeBoundingBox
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: automatic prompt must create at least one point or box.',
      {
        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Selection validation
 * ======================================================= */

function validateSelectionWeights(
  weights:
    EdgeSamMaskSelectionWeights
): void {
  Object.entries(
    weights
  ).forEach(
    ([
      key,
      value,
    ]) => {
      assertFiniteNonNegativeNumber(
        value,
        `selection.weights.${key}`
      );
    }
  );

  const total =
    Object.values(
      weights
    ).reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    );

  if (
    total <= 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: mask-selection weights cannot all be zero.',
      {
        retryable:
          false,
      }
    );
  }
}

function validateSelectionConfig(
  selection:
    EdgeSamMaskSelectionConfig
): void {
  validateSelectionWeights(
    selection.weights
  );

  assertUnitRange(
    selection.minimumPredictedIou,
    'selection.minimumPredictedIou'
  );

  assertUnitRange(
    selection.minimumStabilityScore,
    'selection.minimumStabilityScore'
  );

  assertUnitRange(
    selection.minimumFinalScore,
    'selection.minimumFinalScore'
  );

  assertUnitRange(
    selection.minimumForegroundRatio,
    'selection.minimumForegroundRatio'
  );

  assertUnitRange(
    selection.maximumForegroundRatio,
    'selection.maximumForegroundRatio'
  );

  if (
    selection.minimumForegroundRatio >=
    selection.maximumForegroundRatio
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: minimumForegroundRatio must be lower than maximumForegroundRatio.',
      {
        retryable:
          false,
      }
    );
  }

  assertUnitRange(
    selection.minimumLargestComponentRatio,
    'selection.minimumLargestComponentRatio'
  );

  assertUnitRange(
    selection.maximumSecondComponentRatio,
    'selection.maximumSecondComponentRatio'
  );

  assertUnitRange(
    selection.maximumEdgeContactRatio,
    'selection.maximumEdgeContactRatio'
  );

  assertNonNegativeInteger(
    selection.maximumTouchedEdges,
    'selection.maximumTouchedEdges'
  );

  if (
    selection.maximumTouchedEdges > 4
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: maximumTouchedEdges cannot exceed 4.',
      {
        retryable:
          false,
      }
    );
  }

  assertUnitRange(
    selection.maximumHoleRatio,
    'selection.maximumHoleRatio'
  );

  assertPositiveInteger(
    selection.maximumSignificantComponents,
    'selection.maximumSignificantComponents'
  );

  assertBoolean(
    selection.allowWeakFallback,
    'selection.allowWeakFallback'
  );
}

/* =========================================================
 * Refinement validation
 * ======================================================= */

function validateRefinementConfig(
  refinement:
    SegmentationMaskRefinementConfig
): void {
  assertUnitRange(
    refinement.threshold,
    'refinement.threshold'
  );

  assertUnitRange(
    refinement.softThresholdWidth,
    'refinement.softThresholdWidth'
  );

  assertUnitRange(
    refinement.stabilityThresholdOffset,
    'refinement.stabilityThresholdOffset'
  );

  assertBoolean(
    refinement.removeNoise,
    'refinement.removeNoise'
  );

  assertNonNegativeInteger(
    refinement.minimumComponentArea,
    'refinement.minimumComponentArea'
  );

  assertUnitRange(
    refinement.minimumComponentAreaRatio,
    'refinement.minimumComponentAreaRatio'
  );

  assertBoolean(
    refinement.keepLargestComponentOnly,
    'refinement.keepLargestComponentOnly'
  );

  assertBoolean(
    refinement.fillSmallHoles,
    'refinement.fillSmallHoles'
  );

  assertNonNegativeInteger(
    refinement.maximumHoleArea,
    'refinement.maximumHoleArea'
  );

  assertUnitRange(
    refinement.maximumHoleAreaRatio,
    'refinement.maximumHoleAreaRatio'
  );

  assertBoolean(
    refinement.applyMorphology,
    'refinement.applyMorphology'
  );

  assertFiniteNonNegativeNumber(
    refinement.erosionRadius,
    'refinement.erosionRadius'
  );

  assertFiniteNonNegativeNumber(
    refinement.dilationRadius,
    'refinement.dilationRadius'
  );

  assertFiniteNonNegativeNumber(
    refinement.closingRadius,
    'refinement.closingRadius'
  );

  assertFiniteNonNegativeNumber(
    refinement.openingRadius,
    'refinement.openingRadius'
  );

  assertFiniteNonNegativeNumber(
    refinement.smoothingRadius,
    'refinement.smoothingRadius'
  );

  assertNonNegativeInteger(
    refinement.smoothingPasses,
    'refinement.smoothingPasses'
  );

  assertFiniteNonNegativeNumber(
    refinement.featherRadius,
    'refinement.featherRadius'
  );

  assertBoolean(
    refinement.edgeProtection,
    'refinement.edgeProtection'
  );

  assertUnitRange(
    refinement.edgeProtectionStrength,
    'refinement.edgeProtectionStrength'
  );

  assertFiniteNonNegativeNumber(
    refinement.edgeProtectionRadius,
    'refinement.edgeProtectionRadius'
  );

  assertFiniteNonNegativeNumber(
    refinement.finalExpansionRadius,
    'refinement.finalExpansionRadius'
  );

  assertUnitRange(
    refinement.minimumAlpha,
    'refinement.minimumAlpha'
  );

  assertUnitRange(
    refinement.maximumAlpha,
    'refinement.maximumAlpha'
  );

  if (
    refinement.minimumAlpha >
    refinement.maximumAlpha
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: minimumAlpha cannot exceed maximumAlpha.',
      {
        retryable:
          false,
      }
    );
  }

  assertBoolean(
    refinement.removeDetachedRegions,
    'refinement.removeDetachedRegions'
  );

  assertUnitRange(
    refinement.maximumDetachedRegionDistanceRatio,
    'refinement.maximumDetachedRegionDistanceRatio'
  );

  assertBoolean(
    refinement.rejectInvalidForegroundRatio,
    'refinement.rejectInvalidForegroundRatio'
  );

  assertUnitRange(
    refinement.minimumForegroundRatio,
    'refinement.minimumForegroundRatio'
  );

  assertUnitRange(
    refinement.maximumForegroundRatio,
    'refinement.maximumForegroundRatio'
  );

  if (
    refinement.minimumForegroundRatio >=
    refinement.maximumForegroundRatio
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: refinement foreground-ratio range is invalid.',
      {
        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Embedding cache validation
 * ======================================================= */

function validateEmbeddingCacheConfig(
  cache:
    EdgeSamEmbeddingCacheConfig
): void {
  if (
    cache.policy !== 'disabled' &&
    cache.policy !== 'memory' &&
    cache.policy !== 'memory-lru'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: unsupported embedding-cache policy.',
      {
        retryable:
          false,
      }
    );
  }

  assertNonNegativeInteger(
    cache.maximumEntries,
    'embeddingCache.maximumEntries'
  );

  assertFiniteNonNegativeNumber(
    cache.maximumBytes,
    'embeddingCache.maximumBytes'
  );

  assertFiniteNonNegativeNumber(
    cache.maximumAgeMs,
    'embeddingCache.maximumAgeMs'
  );

  assertBoolean(
    cache.disposeAfterRequest,
    'embeddingCache.disposeAfterRequest'
  );

  assertBoolean(
    cache.retainLatestEmbedding,
    'embeddingCache.retainLatestEmbedding'
  );

  if (
    cache.policy !== 'disabled' &&
    (
      cache.maximumEntries === 0 ||
      cache.maximumBytes === 0
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: enabled embedding cache requires positive limits.',
      {
        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Complete configuration validation
 * ======================================================= */

export function validateSegmentationModelConfig(
  config:
    SegmentationModelConfig
): SegmentationModelConfig {
  assertObject(
    config,
    'config'
  );

  assertNonEmptyString(
    config.id,
    'id'
  );

  assertNonEmptyString(
    config.displayName,
    'displayName'
  );

  if (
    config.family !== 'edgesam'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid EdgeSAM configuration: model family must be edgesam.',
      {
        retryable:
          false,

        metadata: {
          family:
            String(
              config.family
            ),
        },
      }
    );
  }

  assertNonEmptyString(
    config.version,
    'version'
  );

  validateModelAsset(
    config.assets.encoder,
    'encoder'
  );

  validateModelAsset(
    config.assets.decoder,
    'decoder'
  );

  validateEncoderInputConfig(
    config.encoder.input
  );

  validateEncoderOutputConfig(
    config.encoder.output
  );

  validateSessionConfig(
    config.encoder.session,
    'encoder.session'
  );

  validateDecoderConfig(
    config.decoder.config
  );

  validateSessionConfig(
    config.decoder.session,
    'decoder.session'
  );

  validateAutomaticPromptConfig(
    config.automaticPrompt
  );

  validateSelectionConfig(
    config.selection
  );

  validateRefinementConfig(
    config.refinement
  );

  validateEmbeddingCacheConfig(
    config.embeddingCache
  );

  return config;
}

/* =========================================================
 * Deep clone
 * ======================================================= */

export function cloneSegmentationModelConfig(
  config:
    SegmentationModelConfig
): SegmentationModelConfig {
  return {
    id:
      config.id,

    displayName:
      config.displayName,

    family:
      config.family,

    version:
      config.version,

    assets: {
      encoder: {
        ...config.assets.encoder,
      },

      decoder: {
        ...config.assets.decoder,
      },
    },

    encoder: {
      input: {
        ...config.encoder.input,

        normalization: {
          mean: [
            config.encoder.input
              .normalization.mean[0],

            config.encoder.input
              .normalization.mean[1],

            config.encoder.input
              .normalization.mean[2],
          ],

          std: [
            config.encoder.input
              .normalization.std[0],

            config.encoder.input
              .normalization.std[1],

            config.encoder.input
              .normalization.std[2],
          ],

          scale:
            config.encoder.input
              .normalization.scale,

          channelOrder:
            config.encoder.input
              .normalization.channelOrder,
        },

        letterboxColor: [
          config.encoder.input
            .letterboxColor[0],

          config.encoder.input
            .letterboxColor[1],

          config.encoder.input
            .letterboxColor[2],
        ],
      },

      output: {
        ...config.encoder.output,

        expectedDimensions:
          config.encoder.output
            .expectedDimensions
            ? [
                ...config.encoder.output
                  .expectedDimensions,
              ]
            : undefined,
      },

      session: {
        ...config.encoder.session,
      },
    },

    decoder: {
      config: {
        ...config.decoder.config,

        inputNames: {
          ...config.decoder.config
            .inputNames,
        },

        outputNames: {
          ...config.decoder.config
            .outputNames,
        },

        maskInputSize: {
          ...config.decoder.config
            .maskInputSize,
        },
      },

      session: {
        ...config.decoder.session,
      },
    },

    automaticPrompt: {
      ...config.automaticPrompt,
    },

    selection: {
      ...config.selection,

      weights: {
        ...config.selection.weights,
      },
    },

    refinement: {
      ...config.refinement,
    },

    embeddingCache: {
      ...config.embeddingCache,
    },
  };
}

/* =========================================================
 * Configuration overrides
 * ======================================================= */

export type SegmentationModelConfigOverrides = {
  encoder?: {
    input?: Partial<
      EdgeSamEncoderInputConfig
    > & {
      normalization?: Partial<
        SegmentationNormalization
      >;
    };

    output?: Partial<
      EdgeSamEncoderOutputConfig
    >;

    session?: Partial<
      SegmentationSessionConfig
    >;
  };

  decoder?: {
    config?: Partial<
      EdgeSamDecoderConfig
    > & {
      inputNames?: Partial<
        EdgeSamDecoderConfig['inputNames']
      >;

      outputNames?: Partial<
        EdgeSamDecoderConfig['outputNames']
      >;

      maskInputSize?: Partial<
        EdgeSamDecoderConfig['maskInputSize']
      >;
    };

    session?: Partial<
      SegmentationSessionConfig
    >;
  };

  automaticPrompt?: Partial<
    EdgeSamAutomaticPromptConfig
  >;

  selection?: Partial<
    EdgeSamMaskSelectionConfig
  > & {
    weights?: Partial<
      EdgeSamMaskSelectionWeights
    >;
  };

  refinement?: Partial<
    SegmentationMaskRefinementConfig
  >;

  embeddingCache?: Partial<
    EdgeSamEmbeddingCacheConfig
  >;
};

/* =========================================================
 * Configuration factory
 * ======================================================= */

export function createSegmentationModelConfig(
  overrides:
    SegmentationModelConfigOverrides = {}
): SegmentationModelConfig {
  const base =
    cloneSegmentationModelConfig(
      EDGESAM_MODEL_CONFIG
    );

  const normalizationOverride =
    overrides.encoder
      ?.input
      ?.normalization;

  const letterboxOverride =
    overrides.encoder
      ?.input
      ?.letterboxColor;

  const merged:
    SegmentationModelConfig = {
    ...base,

    encoder: {
      input: {
        ...base.encoder.input,
        ...overrides.encoder?.input,

        channels:
          3,

        batchSize:
          1,

        layout:
          'NCHW',

        normalization: {
          ...base.encoder.input
            .normalization,
          ...normalizationOverride,

          mean:
            normalizationOverride
              ?.mean
              ? [
                  normalizationOverride
                    .mean[0],

                  normalizationOverride
                    .mean[1],

                  normalizationOverride
                    .mean[2],
                ]
              : [
                  base.encoder.input
                    .normalization.mean[0],

                  base.encoder.input
                    .normalization.mean[1],

                  base.encoder.input
                    .normalization.mean[2],
                ],

          std:
            normalizationOverride
              ?.std
              ? [
                  normalizationOverride
                    .std[0],

                  normalizationOverride
                    .std[1],

                  normalizationOverride
                    .std[2],
                ]
              : [
                  base.encoder.input
                    .normalization.std[0],

                  base.encoder.input
                    .normalization.std[1],

                  base.encoder.input
                    .normalization.std[2],
                ],
        },

        letterboxColor:
          letterboxOverride
            ? [
                letterboxOverride[0],
                letterboxOverride[1],
                letterboxOverride[2],
              ]
            : [
                base.encoder.input
                  .letterboxColor[0],

                base.encoder.input
                  .letterboxColor[1],

                base.encoder.input
                  .letterboxColor[2],
              ],
      },

      output: {
        ...base.encoder.output,
        ...overrides.encoder?.output,

        expectedDimensions:
          overrides.encoder
            ?.output
            ?.expectedDimensions
            ? [
                ...overrides.encoder
                  .output
                  .expectedDimensions,
              ]
            : base.encoder.output
                .expectedDimensions
              ? [
                  ...base.encoder.output
                    .expectedDimensions,
                ]
              : undefined,
      },

      session: {
        ...base.encoder.session,
        ...overrides.encoder?.session,
      },
    },

    decoder: {
      config: {
        ...base.decoder.config,
        ...overrides.decoder?.config,

        inputNames: {
          ...base.decoder.config
            .inputNames,
          ...overrides.decoder
            ?.config
            ?.inputNames,
        },

        outputNames: {
          ...base.decoder.config
            .outputNames,
          ...overrides.decoder
            ?.config
            ?.outputNames,
        },

        maskInputSize: {
          ...base.decoder.config
            .maskInputSize,
          ...overrides.decoder
            ?.config
            ?.maskInputSize,
        },
      },

      session: {
        ...base.decoder.session,
        ...overrides.decoder?.session,
      },
    },

    automaticPrompt: {
      ...base.automaticPrompt,
      ...overrides.automaticPrompt,
    },

    selection: {
      ...base.selection,
      ...overrides.selection,

      weights: {
        ...base.selection.weights,
        ...overrides.selection
          ?.weights,
      },
    },

    refinement: {
      ...base.refinement,
      ...overrides.refinement,
    },

    embeddingCache: {
      ...base.embeddingCache,
      ...overrides.embeddingCache,
    },
  };

  return validateSegmentationModelConfig(
    merged
  );
}

/* =========================================================
 * Safe refinement profiles
 * ======================================================= */

export function createThresholdOverride(
  threshold: number
): SegmentationModelConfig {
  return createSegmentationModelConfig({
    refinement: {
      threshold:
        clampSegmentationValue(
          threshold,
          0,
          1
        ),
    },
  });
}

export function createEdgePreservingConfig():
  SegmentationModelConfig {
  return createSegmentationModelConfig({
    refinement: {
      threshold:
        0.4,

      softThresholdWidth:
        0.14,

      minimumComponentArea:
        16,

      minimumComponentAreaRatio:
        0.000015,

      maximumHoleArea:
        96,

      maximumHoleAreaRatio:
        0.001,

      closingRadius:
        1,

      smoothingRadius:
        0.5,

      featherRadius:
        0.75,

      edgeProtectionStrength:
        0.9,

      edgeProtectionRadius:
        1,

      maximumDetachedRegionDistanceRatio:
        0.34,
    },

    selection: {
      minimumPredictedIou:
        0.4,

      minimumStabilityScore:
        0.48,

      minimumFinalScore:
        0.44,
    },
  });
}

export function createBackgroundStrictConfig():
  SegmentationModelConfig {
  return createSegmentationModelConfig({
    refinement: {
      threshold:
        0.54,

      softThresholdWidth:
        0.07,

      minimumComponentArea:
        96,

      minimumComponentAreaRatio:
        0.00009,

      keepLargestComponentOnly:
        true,

      maximumHoleArea:
        192,

      openingRadius:
        1,

      smoothingRadius:
        1,

      featherRadius:
        0.75,

      edgeProtectionStrength:
        0.62,

      removeDetachedRegions:
        true,

      maximumDetachedRegionDistanceRatio:
        0.2,
    },

    selection: {
      minimumPredictedIou:
        0.5,

      minimumStabilityScore:
        0.62,

      minimumFinalScore:
        0.56,

      maximumSecondComponentRatio:
        0.1,

      maximumSignificantComponents:
        2,
    },
  });
}

/* =========================================================
 * Device profiles
 * ======================================================= */

export type SegmentationDeviceProfile =
  | 'low-memory-test'
  | 'balanced'
  | 'high-performance';

export function createConfigForDeviceProfile(
  profile:
    SegmentationDeviceProfile
): SegmentationModelConfig {
  switch (profile) {
    case 'low-memory-test':
      return createSegmentationModelConfig({
        encoder: {
          session: {
            executionProvider:
              'cpu',

            intraOpNumThreads:
              1,

            interOpNumThreads:
              1,

            enableCpuMemArena:
              false,

            enableMemPattern:
              false,

            enableProfiling:
              false,

            inferenceTimeoutMs:
              180_000,

            maximumInferenceAttempts:
              1,

            warmupOnLoad:
              false,
          },
        },

        decoder: {
          session: {
            executionProvider:
              'cpu',

            intraOpNumThreads:
              1,

            interOpNumThreads:
              1,

            enableCpuMemArena:
              false,

            enableMemPattern:
              false,

            enableProfiling:
              false,

            inferenceTimeoutMs:
              90_000,

            maximumInferenceAttempts:
              1,

            warmupOnLoad:
              false,
          },
        },

        embeddingCache: {
          policy:
            'memory',

          maximumEntries:
            1,

          maximumBytes:
            24 * 1024 * 1024,

          maximumAgeMs:
            60_000,

          disposeAfterRequest:
            true,

          retainLatestEmbedding:
            false,
        },
      });

    case 'balanced':
      return createSegmentationModelConfig({
        encoder: {
          session: {
            executionProvider:
              getPreferredExecutionProvider(),

            intraOpNumThreads:
              2,

            interOpNumThreads:
              1,

            enableCpuMemArena:
              true,

            enableMemPattern:
              true,

            inferenceTimeoutMs:
              120_000,

            maximumInferenceAttempts:
              2,
          },
        },

        decoder: {
          session: {
            executionProvider:
              getPreferredExecutionProvider(),

            intraOpNumThreads:
              2,

            interOpNumThreads:
              1,

            enableCpuMemArena:
              true,

            enableMemPattern:
              true,

            inferenceTimeoutMs:
              45_000,

            maximumInferenceAttempts:
              2,
          },
        },
      });

    case 'high-performance':
      return createSegmentationModelConfig({
        encoder: {
          session: {
            executionProvider:
              getPreferredExecutionProvider(),

            intraOpNumThreads:
              4,

            interOpNumThreads:
              1,

            enableCpuMemArena:
              true,

            enableMemPattern:
              true,

            inferenceTimeoutMs:
              90_000,

            maximumInferenceAttempts:
              2,
          },
        },

        decoder: {
          session: {
            executionProvider:
              getPreferredExecutionProvider(),

            intraOpNumThreads:
              2,

            interOpNumThreads:
              1,

            enableCpuMemArena:
              true,

            enableMemPattern:
              true,

            inferenceTimeoutMs:
              30_000,

            maximumInferenceAttempts:
              2,
          },
        },
      });

    default: {
      const unreachable:
        never =
        profile;

      throw new SegmentationError(
        'INVALID_INPUT',
        `Unknown EdgeSAM device profile: ${String(
          unreachable
        )}`,
        {
          retryable:
            false,
        }
      );
    }
  }
}

/* =========================================================
 * Tensor dimensions
 * ======================================================= */

export function getEdgeSamEncoderInputDimensions(
  config:
    SegmentationModelConfig =
      EDGESAM_MODEL_CONFIG
): readonly [
  number,
  number,
  number,
  number,
] {
  return [
    config.encoder.input.batchSize,
    config.encoder.input.channels,
    config.encoder.input.height,
    config.encoder.input.width,
  ];
}

export function getExpectedEncoderInputElementCount(
  config:
    SegmentationModelConfig =
      EDGESAM_MODEL_CONFIG
): number {
  return getEdgeSamEncoderInputDimensions(
    config
  ).reduce(
    (
      total,
      dimension
    ) =>
      total *
      dimension,
    1
  );
}

/* =========================================================
 * Memory estimate
 * ======================================================= */

export type SegmentationMemoryEstimate = {
  encoderInputTensorElements: number;

  encoderInputTensorBytes: number;

  encoderInputRgbaBytes: number;

  embeddingElements: number;

  embeddingBytes: number;

  decoderMaskInputBytes: number;

  candidateMaskBytes: number;

  estimatedWorkingMemoryBytes: number;

  estimatedMinimumFreeMemoryBytes: number;
};

export function estimateSegmentationMemory(
  config:
    SegmentationModelConfig =
      EDGESAM_MODEL_CONFIG
): SegmentationMemoryEstimate {
  const inputPixelCount =
    config.encoder.input.width *
    config.encoder.input.height;

  const encoderInputTensorElements =
    config.encoder.input.batchSize *
    config.encoder.input.channels *
    inputPixelCount;

  const encoderInputTensorBytes =
    encoderInputTensorElements *
    Float32Array.BYTES_PER_ELEMENT;

  const encoderInputRgbaBytes =
    inputPixelCount * 4;

  const embeddingElements =
    EDGESAM_EMBEDDING_CHANNELS *
    EDGESAM_EMBEDDING_WIDTH *
    EDGESAM_EMBEDDING_HEIGHT;

  const embeddingBytes =
    embeddingElements *
    Float32Array.BYTES_PER_ELEMENT;

  const decoderMaskInputElements =
    config.decoder.config
      .maskInputSize.width *
    config.decoder.config
      .maskInputSize.height;

  const decoderMaskInputBytes =
    decoderMaskInputElements *
    Float32Array.BYTES_PER_ELEMENT;

  const candidateMaskBytes =
    inputPixelCount *
    Float32Array.BYTES_PER_ELEMENT *
    4;

  /**
   * تقدير للـBuffers التي نديرها نحن.
   *
   * لا يشمل بالكامل:
   *
   * - ذاكرة Native ONNX Runtime.
   * - أوزان الموديل.
   * - ذاكرة Graph execution.
   * - الذاكرة المؤقتة الخاصة بمزود التنفيذ.
   */
  const estimatedWorkingMemoryBytes =
    encoderInputRgbaBytes * 3 +
    encoderInputTensorBytes * 2 +
    embeddingBytes * 2 +
    decoderMaskInputBytes * 2 +
    candidateMaskBytes * 3;

  /**
   * هامش أمان لتشغيل التطبيق والموديل.
   *
   * القرار النهائي لدعم أجهزة 3GB أو 4GB
   * سيعتمد على الاختبار الحقيقي،
   * وليس على هذا التقدير وحده.
   */
  const estimatedMinimumFreeMemoryBytes =
    Math.max(
      estimatedWorkingMemoryBytes *
        3,

      384 * 1024 * 1024
    );

  return {
    encoderInputTensorElements,

    encoderInputTensorBytes,

    encoderInputRgbaBytes,

    embeddingElements,

    embeddingBytes,

    decoderMaskInputBytes,

    candidateMaskBytes,

    estimatedWorkingMemoryBytes,

    estimatedMinimumFreeMemoryBytes,
  };
}

export const EDGESAM_MEMORY_ESTIMATE =
  estimateSegmentationMemory(
    EDGESAM_MODEL_CONFIG
  );

/* =========================================================
 * Runtime helpers
 * ======================================================= */

export function isSupportedNativePlatform():
  boolean {
  return (
    Platform.OS === 'ios' ||
    Platform.OS === 'android'
  );
}

export function assertSupportedNativePlatform():
  void {
  if (
    isSupportedNativePlatform()
  ) {
    return;
  }

  throw new SegmentationError(
    'DEVICE_UNSUPPORTED',
    `Local EdgeSAM segmentation is not supported on platform: ${Platform.OS}.`,
    {
      retryable:
        false,

      metadata: {
        platform:
          Platform.OS,
      },
    }
  );
}

/**
 * متطلبات تشغيل EdgeSAM محليًا.
 *
 * الموديل يحتاج Native Runtime،
 * ولذلك لا يعمل داخل Expo Go.
 */
export function getSegmentationRuntimeRequirements():
  readonly string[] {
  return [
    'A native Expo Development Build or production build is required.',
    'Expo Go does not include the ONNX Runtime native module.',
    'Both EdgeSAM encoder and decoder assets must exist inside assets/models.',
    'The bundled .db files must be copied to local .onnx files before session creation.',
    'The device compatibility gate must pass before EdgeSAM inference starts.',
    'Encoder preprocessing and decoder prompt coordinates must use the same image transform.',
  ];
}

/* =========================================================
 * Configuration summary
 * ======================================================= */

export type SegmentationModelConfigSummary = {
  id: string;

  displayName: string;

  family: 'edgesam';

  version: string;

  encoderFileName: string;

  decoderFileName: string;

  encoderInputName: string;

  encoderInputDimensions:
    readonly number[];

  encoderInputLayout:
    SegmentationTensorLayout;

  encoderOutputName:
    string | null;

  decoderMasksOutputName:
    string | null;

  threshold: number;

  minimumPredictedIou: number;

  minimumStabilityScore: number;

  encoderExecutionProvider:
    SegmentationExecutionProvider;

  decoderExecutionProvider:
    SegmentationExecutionProvider;

  encoderInferenceTimeoutMs: number;

  decoderInferenceTimeoutMs: number;

  embeddingCachePolicy:
    EdgeSamEmbeddingCacheConfig['policy'];

  estimatedWorkingMemoryBytes: number;
};

export function getSegmentationModelConfigSummary(
  config:
    SegmentationModelConfig =
      EDGESAM_MODEL_CONFIG
): SegmentationModelConfigSummary {
  const memory =
    estimateSegmentationMemory(
      config
    );

  return {
    id:
      config.id,

    displayName:
      config.displayName,

    family:
      config.family,

    version:
      config.version,

    encoderFileName:
      config.assets.encoder
        .fileName,

    decoderFileName:
      config.assets.decoder
        .fileName,

    encoderInputName:
      config.encoder.input.name,

    encoderInputDimensions:
      getEdgeSamEncoderInputDimensions(
        config
      ),

    encoderInputLayout:
      config.encoder.input.layout,

    encoderOutputName:
      config.encoder.output
        .preferredName,

    decoderMasksOutputName:
      config.decoder.config
        .outputNames.masks,

    threshold:
      config.refinement.threshold,

    minimumPredictedIou:
      config.selection
        .minimumPredictedIou,

    minimumStabilityScore:
      config.selection
        .minimumStabilityScore,

    encoderExecutionProvider:
      config.encoder.session
        .executionProvider,

    decoderExecutionProvider:
      config.decoder.session
        .executionProvider,

    encoderInferenceTimeoutMs:
      config.encoder.session
        .inferenceTimeoutMs,

    decoderInferenceTimeoutMs:
      config.decoder.session
        .inferenceTimeoutMs,

    embeddingCachePolicy:
      config.embeddingCache.policy,

    estimatedWorkingMemoryBytes:
      memory
        .estimatedWorkingMemoryBytes,
  };
}

/* =========================================================
 * Production configuration
 * ======================================================= */

/**
 * الإعداد الافتراضي الذي تستخدمه
 * بقية ملفات محرك Scan Item.
 *
 * يتم إنشاء نسخة مستقلة ومتأكد من صحتها،
 * بدل استخدام الكائن الأساسي مباشرة.
 */
export const DEFAULT_SEGMENTATION_MODEL_CONFIG =
  createSegmentationModelConfig();

/**
 * فحص مبكر عند تحميل الملف.
 *
 * أي خطأ داخل إعدادات:
 *
 * - Encoder
 * - Decoder
 * - Prompt
 * - Mask selection
 * - Refinement
 * - Sessions
 *
 * سيظهر مباشرة قبل تشغيل Scan Item.
 */
validateSegmentationModelConfig(
  DEFAULT_SEGMENTATION_MODEL_CONFIG
);

export default
  DEFAULT_SEGMENTATION_MODEL_CONFIG;