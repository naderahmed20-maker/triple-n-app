// scan/core/ai/types.ts
// Part 1/3
//
// Triple N - EdgeSAM Local Segmentation Types
//
// هذا الملف يحتوي على العقود الأساسية لمحرك
// فصل الملابس محليًا باستخدام EdgeSAM.
//
// EdgeSAM لا يعمل مثل موديلات الفصل المباشر.
// النظام يعتمد على:
//
// 1) تجهيز الصورة.
// 2) تشغيل Image Encoder.
// 3) استخراج Image Embedding.
// 4) إنشاء Prompt تلقائيًا.
// 5) تشغيل Mask Decoder.
// 6) تقييم عدة Masks.
// 7) اختيار أفضل Mask.
// 8) تحسين الماسك.
// 9) استرجاع الحجم الأصلي.
// 10) إنشاء Alpha Mask نهائي.
//
// هذا الملف لا يشغّل الموديلات فعليًا.
// دوره توحيد الأنواع بين:
//
// - modelConfig.ts
// - Preprocessor.ts
// - PromptGenerator.ts
// - SegmentationSession.ts
// - Postprocessor.ts
// - SegmentationEngine.ts
// - ExportTransparentMask.ts

/* =========================================================
 * General primitives
 * ======================================================= */

export type SegmentationPlatform =
  | 'ios'
  | 'android'
  | 'windows'
  | 'macos'
  | 'web'
  | 'unknown';

export type SegmentationRuntime =
  | 'coreml'
  | 'onnx'
  | 'unknown';

export type SegmentationModelComponent =
  | 'encoder'
  | 'decoder';

export type SegmentationImageFormat =
  | 'jpeg'
  | 'jpg'
  | 'png'
  | 'webp'
  | 'heic'
  | 'heif'
  | 'bmp'
  | 'unknown';

export type SegmentationTensorLayout =
  | 'NCHW'
  | 'NHWC'
  | 'CHW'
  | 'HWC'
  | 'NC'
  | 'CN'
  | 'unknown';

export type SegmentationTensorDataType =
  | 'float32'
  | 'float64'
  | 'float16'
  | 'int32'
  | 'int64'
  | 'uint8'
  | 'int8'
  | 'bool';

export type SegmentationTensorDimension =
  | number
  | 'dynamic';

export type SegmentationTensorShape =
  readonly SegmentationTensorDimension[];

export type SegmentationResizeMode =
  | 'stretch'
  | 'contain'
  | 'cover'
  | 'letterbox';

export type SegmentationInterpolationMode =
  | 'nearest'
  | 'linear'
  | 'cubic'
  | 'area';

export type SegmentationMaskResizeMode =
  | 'nearest'
  | 'linear';

export type SegmentationOutputActivation =
  | 'none'
  | 'sigmoid'
  | 'softmax'
  | 'auto';

export type SegmentationExecutionProvider =
  | 'cpu'
  | 'coreml'
  | 'xnnpack'
  | 'nnapi'
  | 'qnn'
  | 'webgl'
  | 'wasm'
  | 'auto';

export type SegmentationLogLevel =
  | 'none'
  | 'error'
  | 'warning'
  | 'info'
  | 'debug';

export type SegmentationCachePolicy =
  | 'disabled'
  | 'memory'
  | 'memory-lru';

export type SegmentationPromptMode =
  | 'automatic'
  | 'box'
  | 'points'
  | 'box-and-points'
  | 'previous-mask';

export type SegmentationMaskSelectionMode =
  | 'best-score'
  | 'largest-subject'
  | 'best-balanced'
  | 'first-valid';

export type SegmentationCoordinateSpace =
  | 'original-image'
  | 'oriented-image'
  | 'model-input'
  | 'normalized';

export type SegmentationPointLabel =
  | 0
  | 1;

export type SegmentationPromptPointKind =
  | 'positive'
  | 'negative';

export type SegmentationCandidateValidity =
  | 'valid'
  | 'weak'
  | 'invalid';

export type SegmentationEngineState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'processing'
  | 'failed'
  | 'cancelled'
  | 'disposed';

export type SegmentationSessionState =
  | 'uninitialized'
  | 'loading'
  | 'ready'
  | 'running'
  | 'failed'
  | 'disposed';

/* =========================================================
 * Official EdgeSAM pipeline stages
 * ======================================================= */

/**
 * هذه هي المراحل الرسمية للمحرك الجديد.
 *
 * المراحل مقسمة بحيث تغطي:
 *
 * - تجهيز الصورة.
 * - تشغيل Encoder.
 * - توليد Prompt.
 * - تشغيل Decoder.
 * - اختيار وتحسين الماسك.
 *
 * لا نغيّر أسماء هذه المراحل لاحقًا
 * لأن الواجهة والتسجيلات والاختبارات
 * ستعتمد عليها.
 */
export const SEGMENTATION_PIPELINE_STAGES = [
  'validate-input',
  'load-image',
  'correct-orientation',
  'decode-pixels',
  'resize-image',
  'apply-letterbox',
  'normalize-pixels',
  'create-encoder-tensor',
  'load-model-sessions',
  'run-image-encoder',
  'create-segmentation-prompt',
  'create-decoder-inputs',
  'run-mask-decoder',
  'read-mask-candidates',
  'select-best-mask',
  'refine-alpha-mask',
  'restore-original-size',
  'protect-object-edges',
  'complete',
] as const;

export type SegmentationPipelineStage =
  (typeof SEGMENTATION_PIPELINE_STAGES)[number];

export const SEGMENTATION_TOTAL_STAGES =
  SEGMENTATION_PIPELINE_STAGES.length;

/**
 * ترتيب رقمي ثابت للمراحل.
 */
export const SEGMENTATION_STAGE_INDEX: Readonly<
  Record<SegmentationPipelineStage, number>
> = {
  'validate-input': 1,
  'load-image': 2,
  'correct-orientation': 3,
  'decode-pixels': 4,
  'resize-image': 5,
  'apply-letterbox': 6,
  'normalize-pixels': 7,
  'create-encoder-tensor': 8,
  'load-model-sessions': 9,
  'run-image-encoder': 10,
  'create-segmentation-prompt': 11,
  'create-decoder-inputs': 12,
  'run-mask-decoder': 13,
  'read-mask-candidates': 14,
  'select-best-mask': 15,
  'refine-alpha-mask': 16,
  'restore-original-size': 17,
  'protect-object-edges': 18,
  complete: 19,
};

/* =========================================================
 * Geometry
 * ======================================================= */

export type SegmentationSize = {
  width: number;

  height: number;
};

export type SegmentationPoint = {
  x: number;

  y: number;
};

export type SegmentationNormalizedPoint = {
  x: number;

  y: number;
};

export type SegmentationRect = {
  x: number;

  y: number;

  width: number;

  height: number;
};

export type SegmentationBoxCoordinates = {
  x1: number;

  y1: number;

  x2: number;

  y2: number;
};

export type SegmentationPadding = {
  top: number;

  right: number;

  bottom: number;

  left: number;
};

export type SegmentationScale = {
  x: number;

  y: number;
};

export type SegmentationImageCenter = {
  x: number;

  y: number;
};

export type SegmentationTransform = {
  /**
   * الحجم الأصلي قبل أي معالجة.
   */
  originalSize: SegmentationSize;

  /**
   * الحجم بعد تصحيح الاتجاه.
   */
  orientedSize: SegmentationSize;

  /**
   * الحجم الثابت الذي يستقبله Encoder.
   */
  modelInputSize: SegmentationSize;

  /**
   * الحجم بعد resize وقبل letterbox.
   */
  resizedSize: SegmentationSize;

  scale: SegmentationScale;

  padding: SegmentationPadding;

  resizeMode: SegmentationResizeMode;

  /**
   * يساعد في تحويل نقاط وBounding Box
   * من الصورة الأصلية إلى مساحة الموديل.
   */
  originalToModelScale: SegmentationScale;

  /**
   * التحويل العكسي من مساحة الموديل
   * إلى الصورة الأصلية.
   */
  modelToOriginalScale: SegmentationScale;

  orientationApplied: number;
};

/* =========================================================
 * Image source
 * ======================================================= */

export type SegmentationImageSource = {
  /**
   * URI محلي للصورة.
   *
   * أمثلة:
   *
   * file://
   * content://
   * ph://
   */
  uri: string;

  /**
   * يمكن تمرير المقاسات إن كانت معروفة.
   */
  width?: number;

  height?: number;

  format?: SegmentationImageFormat;

  /**
   * EXIF orientation من 1 إلى 8.
   */
  orientation?: number;

  /**
   * معرف اختياري للصورة.
   */
  id?: string;

  /**
   * بيانات لا تدخل إلى الموديل.
   */
  metadata?: Record<
    string,
    string | number | boolean | null
  >;
};

export type SegmentationRgbaImageSource = {
  width: number;

  height: number;

  /**
   * RGBA interleaved:
   *
   * [R, G, B, A, R, G, B, A, ...]
   */
  rgba: Uint8Array;

  orientation?: number;

  id?: string;

  metadata?: Record<
    string,
    string | number | boolean | null
  >;
};

export type SegmentationSource =
  | SegmentationImageSource
  | SegmentationRgbaImageSource;

export type SegmentationLoadedImage = {
  uri: string | null;

  width: number;

  height: number;

  format: SegmentationImageFormat;

  orientation: number;

  rgba: Uint8Array;

  bytesPerPixel: 4;

  sourceId: string | null;
};

export type SegmentationOrientedImage = {
  width: number;

  height: number;

  rgba: Uint8Array;

  orientationCorrected: boolean;

  originalOrientation: number;

  appliedOrientation: number;
};

export type SegmentationResizedImage = {
  width: number;

  height: number;

  rgba: Uint8Array;

  transform: SegmentationTransform;
};

export type SegmentationModelImage = {
  width: number;

  height: number;

  rgba: Uint8Array;

  transform: SegmentationTransform;

  letterboxApplied: boolean;
};

/* =========================================================
 * Image metadata and validation
 * ======================================================= */

export type SegmentationImageValidationIssueCode =
  | 'missing-source'
  | 'invalid-uri'
  | 'invalid-width'
  | 'invalid-height'
  | 'invalid-rgba-data'
  | 'rgba-length-mismatch'
  | 'image-too-small'
  | 'image-too-large'
  | 'unsupported-format'
  | 'unsupported-orientation';

export type SegmentationImageValidationIssue = {
  code: SegmentationImageValidationIssueCode;

  message: string;

  fatal: boolean;
};

export type SegmentationImageValidationResult = {
  valid: boolean;

  issues: readonly SegmentationImageValidationIssue[];

  resolvedSize: SegmentationSize | null;
};

/* =========================================================
 * Normalization
 * ======================================================= */

export type SegmentationNormalization = {
  mean: readonly [
    number,
    number,
    number,
  ];

  std: readonly [
    number,
    number,
    number,
  ];

  /**
   * القيمة التي نقسم عليها RGB
   * قبل تطبيق mean/std.
   *
   * غالبًا 255.
   */
  scale: number;

  /**
   * ترتيب القنوات داخل Tensor.
   */
  channelOrder:
    | 'rgb'
    | 'bgr';
};

/* =========================================================
 * Generic tensors
 * ======================================================= */

export type SegmentationTensorData =
  | Float32Array
  | Float64Array
  | Int32Array
  | BigInt64Array
  | Uint8Array
  | Int8Array
  | boolean[];

export type SegmentationTensor = {
  name: string;

  data: SegmentationTensorData;

  dimensions: readonly number[];

  dataType: SegmentationTensorDataType;

  layout: SegmentationTensorLayout;
};

export type SegmentationFloatTensor = {
  name: string;

  data: Float32Array;

  dimensions: readonly number[];

  dataType: 'float32';

  layout: SegmentationTensorLayout;
};

export type SegmentationInt64Tensor = {
  name: string;

  data: BigInt64Array;

  dimensions: readonly number[];

  dataType: 'int64';

  layout: SegmentationTensorLayout;
};

export type SegmentationTensorMetadata = {
  name: string;

  dimensions: SegmentationTensorShape;

  dataType: SegmentationTensorDataType;

  layout: SegmentationTensorLayout;
};

/* =========================================================
 * Encoder input
 * ======================================================= */

export type EdgeSamEncoderInputTensor = {
  name: string;

  data: Float32Array;

  dimensions: readonly [
    1,
    3,
    number,
    number,
  ];

  dataType: 'float32';

  layout: 'NCHW';

  width: number;

  height: number;

  channels: 3;

  batchSize: 1;
};

export type EdgeSamEncoderInput = {
  image: EdgeSamEncoderInputTensor;

  transform: SegmentationTransform;
};

/* =========================================================
 * Image embedding
 * ======================================================= */

/**
 * الـEmbedding الناتج من EdgeSAM Image Encoder.
 *
 * Encoder يعمل مرة واحدة لكل صورة.
 * Decoder يمكن تشغيله أكثر من مرة
 * باستخدام Prompts مختلفة.
 */
export type EdgeSamImageEmbedding = {
  /**
   * اسم خرج Encoder.
   */
  name: string;

  /**
   * بيانات الـEmbedding.
   */
  data: Float32Array;

  /**
   * الشكل المتوقع غالبًا:
   *
   * [1, C, H, W]
   *
   * لكننا لا نثبّت القيم هنا
   * لأن نسخة الموديل قد تختلف.
   */
  dimensions: readonly number[];

  dataType: 'float32';

  layout: SegmentationTensorLayout;

  batchSize: number;

  channels: number;

  width: number;

  height: number;

  /**
   * معرف الصورة التي تم إنشاء
   * الـEmbedding منها.
   */
  sourceId: string;

  /**
   * وقت الإنشاء.
   */
  createdAt: number;

  /**
   * الحجم التقريبي داخل الذاكرة.
   */
  byteLength: number;

  /**
   * معلومات التحويل المستخدمة للصورة.
   */
  transform: SegmentationTransform;
};

export type EdgeSamEmbeddingCacheKey = string;

export type EdgeSamEmbeddingCacheEntry = {
  key: EdgeSamEmbeddingCacheKey;

  embedding: EdgeSamImageEmbedding;

  createdAt: number;

  lastUsedAt: number;

  hitCount: number;

  byteLength: number;
};

export type EdgeSamEmbeddingCacheStats = {
  enabled: boolean;

  policy: SegmentationCachePolicy;

  entries: number;

  totalBytes: number;

  maximumEntries: number;

  maximumBytes: number;

  hits: number;

  misses: number;

  evictions: number;
};

/* =========================================================
 * Encoder output
 * ======================================================= */

export type EdgeSamEncoderRawOutput = {
  selectedOutputName: string;

  selectedTensor: SegmentationFloatTensor;

  outputs: Record<
    string,
    SegmentationTensor
  >;

  inferenceMs: number;
};

export type EdgeSamEncoderResult = {
  embedding: EdgeSamImageEmbedding;

  rawOutput: EdgeSamEncoderRawOutput;

  sessionReused: boolean;

  cacheHit: boolean;

  timings: EdgeSamEncoderTimings;
};

export type EdgeSamEncoderTimings = {
  tensorPreparationMs: number;

  sessionLoadMs: number;

  inferenceMs: number;

  outputReadMs: number;

  cacheWriteMs: number;

  totalMs: number;
};

/* =========================================================
 * Prompt points
 * ======================================================= */

/**
 * نقطة Prompt واحدة.
 *
 * label:
 *
 * 1 = Positive Point
 * 0 = Negative Point
 */
export type EdgeSamPromptPoint = {
  id: string;

  x: number;

  y: number;

  label: SegmentationPointLabel;

  kind: SegmentationPromptPointKind;

  coordinateSpace: SegmentationCoordinateSpace;

  confidence?: number;

  generatedAutomatically: boolean;
};

export type EdgeSamPositivePoint =
  EdgeSamPromptPoint & {
    label: 1;

    kind: 'positive';
  };

export type EdgeSamNegativePoint =
  EdgeSamPromptPoint & {
    label: 0;

    kind: 'negative';
  };

/* =========================================================
 * Box prompt
 * ======================================================= */

export type EdgeSamBoxPrompt = {
  id: string;

  box: SegmentationBoxCoordinates;

  coordinateSpace: SegmentationCoordinateSpace;

  confidence?: number;

  generatedAutomatically: boolean;

  /**
   * Padding تمت إضافته حول الجسم.
   */
  expansionRatio: number;
};

/* =========================================================
 * Previous mask prompt
 * ======================================================= */

export type EdgeSamPreviousMaskPrompt = {
  id: string;

  width: number;

  height: number;

  data: Float32Array;

  dimensions: readonly number[];

  coordinateSpace: 'model-input';

  generatedAutomatically: boolean;
};

/* =========================================================
 * Prompt request
 * ======================================================= */

export type EdgeSamPrompt = {
  mode: SegmentationPromptMode;

  points: readonly EdgeSamPromptPoint[];

  box: EdgeSamBoxPrompt | null;

  previousMask:
    | EdgeSamPreviousMaskPrompt
    | null;

  generatedAutomatically: boolean;

  /**
   * الحجم الذي تم إنشاء الإحداثيات عليه.
   */
  coordinateSpace: SegmentationCoordinateSpace;

  sourceSize: SegmentationSize;

  warnings: readonly string[];
};

export type EdgeSamManualPromptInput = {
  mode:
    | 'box'
    | 'points'
    | 'box-and-points'
    | 'previous-mask';

  points?: readonly Omit<
    EdgeSamPromptPoint,
    'id' | 'generatedAutomatically'
  >[];

  box?: Omit<
    EdgeSamBoxPrompt,
    'id' | 'generatedAutomatically'
  >;

  previousMask?: Omit<
    EdgeSamPreviousMaskPrompt,
    'id' | 'generatedAutomatically'
  >;
};

/* =========================================================
 * Automatic prompt generation
 * ======================================================= */

export type EdgeSamAutomaticPromptSource =
  | 'image-center'
  | 'saliency'
  | 'foreground-estimate'
  | 'edge-density'
  | 'contrast-region'
  | 'manual-fallback';

export type EdgeSamAutomaticPromptConfig = {
  enabled: boolean;

  /**
   * استخدام نقطة موجبة في مركز الجسم المتوقع.
   */
  includePositiveCenterPoint: boolean;

  /**
   * إضافة نقاط موجبة إضافية داخل الجسم.
   */
  additionalPositivePoints: number;

  /**
   * إضافة نقاط سالبة حول الجسم.
   */
  includeNegativeBoundaryPoints: boolean;

  maximumNegativePoints: number;

  /**
   * إنشاء Bounding Box تلقائي.
   */
  includeBoundingBox: boolean;

  /**
   * توسيع الـBounding Box بنسبة بسيطة.
   */
  boxExpansionRatio: number;

  /**
   * أقل ثقة لقبول الـPrompt التلقائي.
   */
  minimumPromptConfidence: number;

  /**
   * تجنب وضع النقاط قرب حدود الصورة.
   */
  edgeSafeMarginRatio: number;

  /**
   * الحد الأدنى للمسافة بين النقاط.
   */
  minimumPointDistanceRatio: number;

  /**
   * عند فشل التحليل الأولي،
   * نستخدم مركز الصورة كحل احتياطي.
   */
  allowCenterFallback: boolean;
};

export type EdgeSamPromptGenerationInput = {
  source: SegmentationSource;

  orientedImage: SegmentationOrientedImage;

  modelImage: SegmentationModelImage;

  transform: SegmentationTransform;

  config: EdgeSamAutomaticPromptConfig;

  manualPrompt?: EdgeSamManualPromptInput | null;
};

export type EdgeSamPromptGenerationDiagnostics = {
  source: EdgeSamAutomaticPromptSource;

  detectedRegion: SegmentationRect | null;

  regionConfidence: number;

  centerConfidence: number;

  positivePointsCreated: number;

  negativePointsCreated: number;

  usedCenterFallback: boolean;

  warnings: readonly string[];
};

export type EdgeSamPromptGenerationResult = {
  prompt: EdgeSamPrompt;

  diagnostics: EdgeSamPromptGenerationDiagnostics;

  durationMs: number;
};

/* =========================================================
 * Coordinate conversion
 * ======================================================= */

export type EdgeSamCoordinateConversionInput = {
  point: SegmentationPoint;

  from: SegmentationCoordinateSpace;

  to: SegmentationCoordinateSpace;

  transform: SegmentationTransform;
};

export type EdgeSamBoxConversionInput = {
  box: SegmentationBoxCoordinates;

  from: SegmentationCoordinateSpace;

  to: SegmentationCoordinateSpace;

  transform: SegmentationTransform;
};

/* =========================================================
 * Decoder point tensors
 * ======================================================= */

/**
 * Tensor إحداثيات النقاط.
 *
 * الشكل المعتاد:
 *
 * [1, N, 2]
 */
export type EdgeSamPointCoordinatesTensor = {
  name: string;

  data: Float32Array;

  dimensions: readonly [
    1,
    number,
    2,
  ];

  dataType: 'float32';

  layout: 'unknown';

  pointCount: number;
};

/**
 * Tensor Labels للنقاط.
 *
 * القيم:
 *
 * 1  = Positive Point
 * 0  = Negative Point
 * 2  = Box Top-Left
 * 3  = Box Bottom-Right
 * -1 = Padding Point
 */
export type EdgeSamPointLabelsTensor = {
  name: string;

  data: Float32Array;

  dimensions: readonly [
    1,
    number,
  ];

  dataType: 'float32';

  layout: 'unknown';

  pointCount: number;
};

/* =========================================================
 * Decoder mask input
 * ======================================================= */

export type EdgeSamMaskInputTensor = {
  name: string;

  data: Float32Array;

  dimensions: readonly [
    1,
    1,
    number,
    number,
  ];

  dataType: 'float32';

  layout: 'NCHW';

  width: number;

  height: number;
};

export type EdgeSamHasMaskInputTensor = {
  name: string;

  data: Float32Array;

  dimensions: readonly [
    1,
  ];

  dataType: 'float32';

  layout: 'unknown';

  hasMask: boolean;
};

/* =========================================================
 * Original image size tensor
 * ======================================================= */

export type EdgeSamOriginalImageSizeTensor = {
  name: string;

  data:
    | Float32Array
    | BigInt64Array;

  dimensions: readonly [
    2,
  ];

  dataType:
    | 'float32'
    | 'int64';

  layout: 'unknown';

  height: number;

  width: number;
};

/* =========================================================
 * Decoder inputs
 * ======================================================= */

export type EdgeSamDecoderInputs = {
  imageEmbedding: EdgeSamImageEmbedding;

  pointCoordinates:
    EdgeSamPointCoordinatesTensor;

  pointLabels:
    EdgeSamPointLabelsTensor;

  maskInput:
    EdgeSamMaskInputTensor;

  hasMaskInput:
    EdgeSamHasMaskInputTensor;

  originalImageSize:
    EdgeSamOriginalImageSizeTensor;

  prompt: EdgeSamPrompt;

  /**
   * Feed dictionary جاهز لتمريره
   * إلى ONNX/CoreML Session.
   */
  feeds: Record<
    string,
    SegmentationTensor
  >;
};

export type EdgeSamDecoderInputBuildResult = {
  inputs: EdgeSamDecoderInputs;

  warnings: readonly string[];

  durationMs: number;
};

/* =========================================================
 * Preprocessing
 * ======================================================= */

export type SegmentationPreprocessResult = {
  source: SegmentationSource;

  loadedImage: SegmentationLoadedImage;

  orientedImage: SegmentationOrientedImage;

  modelImage: SegmentationModelImage;

  encoderInput: EdgeSamEncoderInput;

  transform: SegmentationTransform;

  timings: SegmentationPreprocessTimings;
};

export type SegmentationPreprocessTimings = {
  validateInputMs: number;

  loadImageMs: number;

  correctOrientationMs: number;

  decodePixelsMs: number;

  resizeImageMs: number;

  applyLetterboxMs: number;

  normalizePixelsMs: number;

  createEncoderTensorMs: number;

  totalMs: number;
};
// scan/core/ai/types.ts
// Part 2/3
//
// يكمل مباشرة بعد:
//
// export type SegmentationPreprocessTimings = {
//   ...
// };

/* =========================================================
 * Decoder raw outputs
 * ======================================================= */

export type EdgeSamDecoderRawOutput = {
  /**
   * اسم Tensor الماسكات.
   */
  selectedMasksOutputName: string;

  /**
   * اسم Tensor درجات الجودة أو IoU.
   */
  selectedScoresOutputName: string | null;

  /**
   * اسم Tensor الـLow Resolution Masks
   * إن كان الموديل يرجعه.
   */
  selectedLowResolutionMasksOutputName:
    | string
    | null;

  masksTensor: SegmentationFloatTensor;

  scoresTensor:
    | SegmentationFloatTensor
    | null;

  lowResolutionMasksTensor:
    | SegmentationFloatTensor
    | null;

  /**
   * جميع مخارج Decoder.
   */
  outputs: Record<
    string,
    SegmentationTensor
  >;

  inferenceMs: number;
};

/* =========================================================
 * Float and alpha masks
 * ======================================================= */

/**
 * ماسك بقيم Float بين 0 و1.
 */
export type SegmentationFloatMask = {
  width: number;

  height: number;

  data: Float32Array;
};

/**
 * ماسك نهائي بقيم Alpha:
 *
 * 0   = شفاف بالكامل.
 * 255 = ظاهر بالكامل.
 */
export type SegmentationAlphaMask = {
  width: number;

  height: number;

  data: Uint8Array;
};

/* =========================================================
 * Mask bounds and connected regions
 * ======================================================= */

export type SegmentationMaskBounds = {
  x: number;

  y: number;

  width: number;

  height: number;

  x2: number;

  y2: number;

  area: number;

  areaRatio: number;
};

export type SegmentationConnectedComponent = {
  id: number;

  area: number;

  areaRatio: number;

  bounds: SegmentationMaskBounds;

  touchesTopEdge: boolean;

  touchesRightEdge: boolean;

  touchesBottomEdge: boolean;

  touchesLeftEdge: boolean;

  touchesAnyEdge: boolean;

  centroid: SegmentationPoint;
};

/* =========================================================
 * Mask statistics
 * ======================================================= */

export type SegmentationMaskStatistics = {
  minimum: number;

  maximum: number;

  average: number;

  foregroundPixels: number;

  backgroundPixels: number;

  semiTransparentPixels: number;

  foregroundRatio: number;

  backgroundRatio: number;

  semiTransparentRatio: number;

  largestComponentPixels: number;

  largestComponentRatio: number;

  secondLargestComponentPixels: number;

  secondLargestComponentRatio: number;

  connectedComponentCount: number;

  significantComponentCount: number;

  holePixels: number;

  holeRatio: number;

  edgeContactPixels: number;

  edgeContactRatio: number;

  touchedEdgeCount: number;

  bounds: SegmentationMaskBounds | null;

  centroid: SegmentationPoint | null;

  centerOffsetRatio: number;
};

/* =========================================================
 * Mask candidate scores
 * ======================================================= */

export type EdgeSamMaskCandidateScores = {
  /**
   * درجة IoU المتوقعة من Decoder.
   */
  predictedIou: number;

  /**
   * Stability Score محسوب محليًا.
   */
  stabilityScore: number;

  /**
   * نسبة الجسم داخل الصورة.
   */
  foregroundRatio: number;

  /**
   * نسبة أكبر جسم متصل.
   */
  largestComponentRatio: number;

  /**
   * جودة عزل الجسم عن الأجسام الأخرى.
   */
  isolationScore: number;

  /**
   * جودة تمركز الجسم.
   */
  centeringScore: number;

  /**
   * عقوبة ملامسة حدود الصورة.
   */
  edgePenalty: number;

  /**
   * عقوبة وجود أجزاء متعددة.
   */
  fragmentationPenalty: number;

  /**
   * عقوبة وجود ثقوب داخل القطعة.
   */
  holePenalty: number;

  /**
   * النتيجة النهائية المركبة.
   */
  finalScore: number;
};

/* =========================================================
 * Mask candidate
 * ======================================================= */

export type EdgeSamMaskCandidate = {
  id: string;

  index: number;

  /**
   * ماسك Decoder قبل التحسين.
   */
  rawMask: SegmentationFloatMask;

  /**
   * ماسك بعد Activation وClamp.
   */
  normalizedMask: SegmentationFloatMask;

  /**
   * الماسك بعد Threshold أولي.
   */
  thresholdedMask: SegmentationFloatMask;

  predictedIou: number;

  stabilityScore: number;

  statistics: SegmentationMaskStatistics;

  scores: EdgeSamMaskCandidateScores;

  validity: SegmentationCandidateValidity;

  rejectionReasons: readonly string[];

  warnings: readonly string[];
};

/* =========================================================
 * Mask candidate collection
 * ======================================================= */

export type EdgeSamMaskCandidateCollection = {
  candidates: readonly EdgeSamMaskCandidate[];

  validCandidates: readonly EdgeSamMaskCandidate[];

  weakCandidates: readonly EdgeSamMaskCandidate[];

  invalidCandidates: readonly EdgeSamMaskCandidate[];

  totalCount: number;

  validCount: number;

  weakCount: number;

  invalidCount: number;

  warnings: readonly string[];
};

/* =========================================================
 * Mask candidate read result
 * ======================================================= */

export type EdgeSamMaskCandidateReadResult = {
  collection: EdgeSamMaskCandidateCollection;

  decoderOutput: EdgeSamDecoderRawOutput;

  durationMs: number;
};

/* =========================================================
 * Mask selection
 * ======================================================= */

export type EdgeSamMaskSelectionWeights = {
  predictedIou: number;

  stability: number;

  foregroundBalance: number;

  largestComponent: number;

  isolation: number;

  centering: number;

  edgePenalty: number;

  fragmentationPenalty: number;

  holePenalty: number;
};

export type EdgeSamMaskSelectionConfig = {
  mode: SegmentationMaskSelectionMode;

  weights: EdgeSamMaskSelectionWeights;

  minimumPredictedIou: number;

  minimumStabilityScore: number;

  minimumFinalScore: number;

  minimumForegroundRatio: number;

  maximumForegroundRatio: number;

  minimumLargestComponentRatio: number;

  maximumSecondComponentRatio: number;

  maximumEdgeContactRatio: number;

  maximumTouchedEdges: number;

  maximumHoleRatio: number;

  maximumSignificantComponents: number;

  /**
   * لو لم توجد نتيجة صالحة،
   * هل نقبل أفضل نتيجة ضعيفة؟
   */
  allowWeakFallback: boolean;
};

export type EdgeSamMaskSelectionDiagnostics = {
  mode: SegmentationMaskSelectionMode;

  selectedCandidateId: string | null;

  selectedCandidateIndex: number | null;

  selectedFinalScore: number;

  candidateScores: readonly {
    id: string;

    index: number;

    validity: SegmentationCandidateValidity;

    predictedIou: number;

    stabilityScore: number;

    finalScore: number;

    rejectionReasons: readonly string[];
  }[];

  usedWeakFallback: boolean;

  warnings: readonly string[];
};

export type EdgeSamMaskSelectionResult = {
  selectedCandidate: EdgeSamMaskCandidate;

  diagnostics: EdgeSamMaskSelectionDiagnostics;

  durationMs: number;
};

/* =========================================================
 * Mask refinement
 * ======================================================= */

export type SegmentationMaskRefinementConfig = {
  /**
   * Threshold أساسي لتحويل الـLogits
   * أو الاحتمالات إلى Foreground.
   */
  threshold: number;

  /**
   * عرض منطقة الانتقال الناعم
   * حول Threshold.
   */
  softThresholdWidth: number;

  /**
   * Threshold إضافي يستخدم لحساب
   * Stability Score.
   */
  stabilityThresholdOffset: number;

  /**
   * إزالة الأجزاء الصغيرة المعزولة.
   */
  removeNoise: boolean;

  /**
   * أقل مساحة متصلة مسموح بها
   * بالـPixels.
   */
  minimumComponentArea: number;

  /**
   * أقل نسبة مكون من مساحة الصورة.
   */
  minimumComponentAreaRatio: number;

  /**
   * الاحتفاظ بأكبر جسم فقط.
   */
  keepLargestComponentOnly: boolean;

  /**
   * ملء الثقوب الصغيرة.
   */
  fillSmallHoles: boolean;

  maximumHoleArea: number;

  maximumHoleAreaRatio: number;

  /**
   * عمليات Morphology خفيفة.
   */
  applyMorphology: boolean;

  erosionRadius: number;

  dilationRadius: number;

  closingRadius: number;

  openingRadius: number;

  /**
   * تنعيم الماسك.
   */
  smoothingRadius: number;

  smoothingPasses: number;

  /**
   * Feather للحواف.
   */
  featherRadius: number;

  /**
   * حماية الحواف الرفيعة
   * مثل الأربطة والأكمام.
   */
  edgeProtection: boolean;

  edgeProtectionStrength: number;

  edgeProtectionRadius: number;

  /**
   * توسيع بسيط للماسك بعد التنظيف.
   */
  finalExpansionRadius: number;

  /**
   * Clamp نهائي.
   */
  minimumAlpha: number;

  maximumAlpha: number;

  /**
   * إزالة أي جسم بعيد عن مركز
   * القطعة الأساسية.
   */
  removeDetachedRegions: boolean;

  maximumDetachedRegionDistanceRatio: number;

  /**
   * رفض ماسك فارغ أو شبه ممتلئ.
   */
  rejectInvalidForegroundRatio: boolean;

  minimumForegroundRatio: number;

  maximumForegroundRatio: number;
};

/* =========================================================
 * Mask refinement diagnostics
 * ======================================================= */

export type SegmentationMaskRefinementDiagnostics = {
  originalStatistics: SegmentationMaskStatistics;

  refinedStatistics: SegmentationMaskStatistics;

  removedComponentCount: number;

  removedPixelCount: number;

  filledHoleCount: number;

  filledHolePixelCount: number;

  morphologyApplied: boolean;

  edgeProtectionApplied: boolean;

  featherApplied: boolean;

  warnings: readonly string[];
};

/* =========================================================
 * Image-Guided Boundary Processing V3
 * ======================================================= */

/**
 * صورة التحليل المستخدمة داخل مراحل V3.
 *
 * RGB تكون بقيم من 0 إلى 1.
 * Gradient وLuminance تكون خريطة Pixel واحدة
 * بطول width * height.
 */
export type ImageGuidedAnalysisImageV3 = {
  width: number;

  height: number;

  /**
   * RGB interleaved:
   *
   * [R, G, B, R, G, B, ...]
   *
   * كل قيمة من 0 إلى 1.
   */
  rgb: Float32Array;

  /**
   * شدة الحافة لكل Pixel من 0 إلى 1.
   */
  gradient: Float32Array;

  /**
   * اتجاه الحافة بالراديان.
   *
   * يمكن أن تكون null إذا لم يتم حسابها.
   */
  gradientDirection:
    | Float32Array
    | null;

  /**
   * الإضاءة لكل Pixel من 0 إلى 1.
   */
  luminance: Float32Array;
};

/**
 * لون RGB موحّد من 0 إلى 1.
 */
export type ImageGuidedRgbColorV3 = {
  r: number;

  g: number;

  b: number;
};

/**
 * لون HSV موحّد.
 *
 * h من 0 إلى 1.
 * s من 0 إلى 1.
 * v من 0 إلى 1.
 */
export type ImageGuidedHsvColorV3 = {
  h: number;

  s: number;

  v: number;
};

/**
 * لون Lab تقريبي موحّد.
 *
 * l من 0 إلى 1.
 * a وb من -1 إلى 1 تقريبًا.
 */
export type ImageGuidedLabColorV3 = {
  l: number;

  a: number;

  b: number;
};

/**
 * نموذج لون واحد داخل نظام V3.
 */
export type ImageGuidedColorPrototypeV3 = {
  rgb: ImageGuidedRgbColorV3;

  hsv: ImageGuidedHsvColorV3;

  lab: ImageGuidedLabColorV3;

  luminance: number;

  variance: number;

  sampleCount: number;

  confidence: number;
};

/**
 * منطقة محلية داخل الجسم الأساسي.
 *
 * الهدف هو عدم الاعتماد على متوسط لون واحد
 * للقطعة بالكامل.
 */
export type ImageGuidedLocalForegroundRegionV3 = {
  id: number;

  centerX: number;

  centerY: number;

  radius: number;

  bounds: SegmentationMaskBounds;

  prototype:
    ImageGuidedColorPrototypeV3;

  /**
   * نسبة Pixels الموثوقة داخل المنطقة.
   */
  reliablePixelRatio: number;

  /**
   * متوسط Alpha داخل المنطقة.
   */
  averageAlpha: number;

  confidence: number;
};

/**
 * نموذج القطعة المحلي.
 */
export type ImageGuidedLocalForegroundModelV3 = {
  width: number;

  height: number;

  regions:
    readonly ImageGuidedLocalForegroundRegionV3[];

  /**
   * نموذج عام احتياطي للقطعة.
   */
  globalPrototype:
    ImageGuidedColorPrototypeV3;

  /**
   * نموذج عام للخلفية.
   */
  backgroundPrototype:
    ImageGuidedColorPrototypeV3;

  foregroundSampleCount: number;

  backgroundSampleCount: number;

  colorSeparation: number;

  usable: boolean;

  warnings: readonly string[];
};

/**
 * إعدادات بناء نموذج الألوان المحلي.
 */
export type ImageGuidedLocalForegroundConfigV3 = {
  /**
   * Alpha الأدنى لقبول Pixel كعينة Foreground موثوقة.
   */
  minimumForegroundAlpha: number;

  /**
   * Alpha الأعلى لقبول Pixel كعينة Background موثوقة.
   */
  maximumBackgroundAlpha: number;

  /**
   * أقل مسافة من الحافة لاستخدام Pixel
   * كعينة داخلية موثوقة.
   */
  minimumInteriorDistance: number;

  /**
   * عدد المناطق المحلية المستهدف.
   */
  targetRegionCount: number;

  minimumRegionSampleCount: number;

  maximumRegionSampleCount: number;

  regionRadiusRatio: number;

  minimumColorSeparation: number;

  maximumGlobalSamples: number;
};

/**
 * الخصائص البصرية الخاصة بـPixel واحد
 * قريب من حدود الماسك.
 */
export type ImageGuidedBoundaryPixelFeaturesV3 = {
  index: number;

  x: number;

  y: number;

  originalAlpha: number;

  rgb:
    ImageGuidedRgbColorV3;

  hsv:
    ImageGuidedHsvColorV3;

  lab:
    ImageGuidedLabColorV3;

  luminance: number;

  gradientStrength: number;

  gradientDirection: number;

  localMeanLuminance: number;

  localVariance: number;

  localTexture: number;

  localContrast: number;

  foregroundNeighborRatio: number;

  backgroundNeighborRatio: number;

  uncertainNeighborRatio: number;

  distanceToBoundary: number;

  distanceToMainComponent: number;

  insideMainComponent: boolean;

  nearMainComponent: boolean;

  touchesImageBorder: boolean;

  foregroundRgbSimilarity: number;

  foregroundHsvSimilarity: number;

  foregroundLabSimilarity: number;

  backgroundRgbSimilarity: number;

  backgroundHsvSimilarity: number;

  backgroundLabSimilarity: number;

  localForegroundSimilarity: number;

  globalForegroundSimilarity: number;

  globalBackgroundSimilarity: number;

  edgeContinuity: number;

  neighborAgreement: number;

  componentSupport: number;
};

/**
 * خرائط الخصائص المحسوبة مرة واحدة
 * ليتم استخدامها في المراحل التالية.
 */
export type ImageGuidedBoundaryFeatureMapV3 = {
  width: number;

  height: number;

  /**
   * 1 يعني أن Pixel داخل نطاق التحليل.
   */
  activeBoundaryMap:
    Uint8Array;

  boundaryDistance:
    Float32Array;

  mainComponentDistance:
    Float32Array;

  localMeanLuminance:
    Float32Array;

  localVariance:
    Float32Array;

  localTexture:
    Float32Array;

  localContrast:
    Float32Array;

  foregroundNeighborRatio:
    Float32Array;

  backgroundNeighborRatio:
    Float32Array;

  edgeContinuity:
    Float32Array;

  neighborAgreement:
    Float32Array;

  componentSupport:
    Float32Array;

  activePixelCount: number;

  maximumBoundaryDistance: number;

  warnings: readonly string[];
};

/**
 * إعدادات استخراج خصائص الحدود.
 */
export type ImageGuidedBoundaryFeatureConfigV3 = {
  boundaryThreshold: number;

  transitionMinimumAlpha: number;

  transitionMaximumAlpha: number;

  boundaryRadius: number;

  neighborhoodRadius: number;

  textureRadius: number;

  maximumBoundaryDistance: number;

  maximumMainComponentDistance: number;

  foregroundNeighborThreshold: number;

  backgroundNeighborThreshold: number;

  minimumEdgeStrength: number;
};

/**
 * أوزان مصنف الـPixel.
 */
export type ImageGuidedPixelClassifierWeightsV3 = {
  originalAlpha: number;

  rgbSimilarity: number;

  hsvSimilarity: number;

  labSimilarity: number;

  localForegroundSimilarity: number;

  backgroundRejection: number;

  localTexture: number;

  localContrast: number;

  gradientStrength: number;

  edgeContinuity: number;

  neighborAgreement: number;

  componentSupport: number;

  mainComponentDistance: number;
};

/**
 * إعدادات تصنيف الـPixels.
 */
export type ImageGuidedPixelClassifierConfigV3 = {
  weights:
    ImageGuidedPixelClassifierWeightsV3;

  foregroundDecisionThreshold: number;

  backgroundDecisionThreshold: number;

  uncertainDecisionMargin: number;

  strongForegroundAlpha: number;

  strongBackgroundAlpha: number;

  preserveStrongCore: boolean;

  rejectPixelsOutsideProtectedStructure: boolean;

  minimumVisualSupportOutsideStructure: number;

  maximumBackgroundSimilarity: number;
};

/**
 * نتيجة تصنيف Pixel واحد.
 */
export type ImageGuidedPixelClassificationV3 = {
  index: number;

  foregroundScore: number;

  backgroundScore: number;

  confidence: number;

  classification:
    | 'foreground'
    | 'background'
    | 'uncertain';

  refinedAlpha: number;
};

/**
 * نتيجة مصنف الـPixels بالكامل.
 */
export type ImageGuidedPixelClassifierResultV3 = {
  mask:
    SegmentationFloatMask;

  foregroundScoreMap:
    Float32Array;

  backgroundScoreMap:
    Float32Array;

  confidenceMap:
    Float32Array;

  classificationMap:
    Uint8Array;

  processedPixelCount: number;

  foregroundPixelCount: number;

  backgroundPixelCount: number;

  uncertainPixelCount: number;

  changedPixelCount: number;

  averageConfidence: number;

  warnings: readonly string[];
};

/**
 * إعدادات تصويت الجيران.
 */
export type ImageGuidedConfidenceVotingConfigV3 = {
  radius: number;

  passes: number;

  minimumVotingConfidence: number;

  foregroundVoteThreshold: number;

  backgroundVoteThreshold: number;

  originalDecisionWeight: number;

  neighborDecisionWeight: number;

  edgeProtectionWeight: number;

  preserveStrongForeground: boolean;

  removeIsolatedForeground: boolean;
};

/**
 * نتيجة تصويت الجيران.
 */
export type ImageGuidedConfidenceVotingResultV3 = {
  mask:
    SegmentationFloatMask;

  confidenceMap:
    Float32Array;

  changedPixelCount: number;

  promotedForegroundPixelCount: number;

  rejectedForegroundPixelCount: number;

  resolvedUncertainPixelCount: number;

  remainingUncertainPixelCount: number;

  passesApplied: number;

  warnings: readonly string[];
};

/**
 * إعدادات تحسين الحافة النهائي.
 */
export type ImageGuidedAdaptiveEdgeConfigV3 = {
  minimumAlpha: number;

  maximumAlpha: number;

  foregroundSnapThreshold: number;

  backgroundSnapThreshold: number;

  strongEdgeThreshold: number;

  weakEdgeThreshold: number;

  maximumHaloAlpha: number;

  haloSuppressionStrength: number;

  edgePreservationStrength: number;

  detailPreservationStrength: number;

  maximumRefinementDistance: number;
};

/**
 * نتيجة تحسين الحافة النهائي.
 */
export type ImageGuidedAdaptiveEdgeResultV3 = {
  mask:
    SegmentationFloatMask;

  processedPixelCount: number;

  changedPixelCount: number;

  removedHaloPixelCount: number;

  preservedEdgePixelCount: number;

  recoveredDetailPixelCount: number;

  averageCorrection: number;

  warnings: readonly string[];
};

/**
 * Diagnostics موحدة لنظام V3.
 */
export type ImageGuidedBoundaryDiagnosticsV3 = {
  localRegionCount: number;

  foregroundSampleCount: number;

  backgroundSampleCount: number;

  colorSeparation: number;

  boundaryPixelCount: number;

  classifiedForegroundPixels: number;

  classifiedBackgroundPixels: number;

  classifiedUncertainPixels: number;

  votingChangedPixelCount: number;

  removedHaloPixelCount: number;

  preservedEdgePixelCount: number;

  totalChangedPixelCount: number;

  warnings: readonly string[];
};

/* =========================================================
 * Postprocessing result
 * ======================================================= */

export type SegmentationPostprocessResult = {
  /**
   * الماسك المختار من EdgeSAM.
   */
  selectedMask: SegmentationFloatMask;

  /**
   * بعد التنظيف والـThreshold.
   */
  refinedMask: SegmentationFloatMask;

  /**
   * بعد إزالة Letterbox
   * واستعادة مساحة الصورة الموجهة.
   */
  restoredMask: SegmentationFloatMask;

  /**
   * الماسك النهائي بالحجم الأصلي.
   */
  alphaMask: SegmentationAlphaMask;

  statistics: SegmentationMaskStatistics;

  diagnostics:
    SegmentationMaskRefinementDiagnostics;

  timings: SegmentationPostprocessTimings;
};

export type SegmentationPostprocessTimings = {
  readCandidatesMs: number;

  candidateSelectionMs: number;

  activationMs: number;

  normalizeMaskMs: number;

  removeLetterboxMs: number;

  removeNoiseMs: number;

  connectedComponentsMs: number;

  fillHolesMs: number;

  morphologyMs: number;

  thresholdMs: number;

  smoothingMs: number;

  featherMs: number;

  restoreOriginalSizeMs: number;

  protectEdgesMs: number;

  convertToAlphaMs: number;

  statisticsMs: number;

  totalMs: number;
};

/* =========================================================
 * Model assets
 * ======================================================= */

export type SegmentationModelAsset = {
  component: SegmentationModelComponent;

  runtime: SegmentationRuntime;

  /**
   * اسم Native Resource بدون الامتداد.
   */
  resourceName: string;

  /**
   * اسم الملف المضمّن داخل التطبيق.
   *
   * مثال:
   *
   * edgesam_encoder.db
   * edgesam_decoder.db
   */
  bundledFileName: string;

  /**
   * الاسم النهائي بعد النسخ
   * إلى مساحة التطبيق المحلية.
   */
  fileName: string;

  expectedExtension:
    | 'onnx'
    | 'mlmodelc'
    | 'mlpackage';

  sha256?: string;

  version: string;

  approximateSizeBytes?: number;

  required: boolean;
};

export type EdgeSamModelAssets = {
  encoder: SegmentationModelAsset;

  decoder: SegmentationModelAsset;
};

/* =========================================================
 * Encoder configuration
 * ======================================================= */

export type EdgeSamEncoderInputConfig = {
  name: string;

  width: number;

  height: number;

  channels: 3;

  batchSize: 1;

  layout: 'NCHW';

  dataType:
    | 'float32'
    | 'float16';

  resizeMode: SegmentationResizeMode;

  interpolation:
    SegmentationInterpolationMode;

  normalization:
    SegmentationNormalization;

  letterboxColor: readonly [
    number,
    number,
    number,
  ];
};

export type EdgeSamEncoderOutputConfig = {
  preferredName: string | null;

  layout: SegmentationTensorLayout;

  dataType:
    | 'float32'
    | 'float16';

  /**
   * هل يجب تحويل Float16 إلى Float32
   * بعد الاستدلال؟
   */
  convertToFloat32: boolean;

  /**
   * أبعاد متوقعة اختيارية.
   */
  expectedDimensions?:
    SegmentationTensorShape;
};

/* =========================================================
 * Decoder input names
 * ======================================================= */

export type EdgeSamDecoderInputNames = {
  imageEmbeddings: string;

  pointCoordinates: string;

  pointLabels: string;

  maskInput: string;

  hasMaskInput: string;

  originalImageSize: string;
};

/* =========================================================
 * Decoder output names
 * ======================================================= */

export type EdgeSamDecoderOutputNames = {
  masks: string | null;

  iouPredictions: string | null;

  lowResolutionMasks: string | null;
};

/* =========================================================
 * Decoder configuration
 * ======================================================= */

export type EdgeSamDecoderConfig = {
  inputNames: EdgeSamDecoderInputNames;

  outputNames: EdgeSamDecoderOutputNames;

  maskActivation:
    SegmentationOutputActivation;

  masksLayout:
    SegmentationTensorLayout;

  maskResizeMode:
    SegmentationMaskResizeMode;

  containsLogits: boolean;

  /**
   * عدد الماسكات المتوقع من Decoder.
   */
  expectedMaskCount: number | null;

  /**
   * حجم Mask Input منخفض الدقة.
   */
  maskInputSize: SegmentationSize;

  /**
   * القيمة المرسلة عند عدم وجود Previous Mask.
   */
  emptyMaskValue: number;

  /**
   * DataType لـOriginal Image Size.
   */
  originalImageSizeDataType:
    | 'float32'
    | 'int64';

  /**
   * ترتيب Original Image Size:
   *
   * height-width
   * أو width-height.
   */
  originalImageSizeOrder:
    | 'height-width'
    | 'width-height';
};

/* =========================================================
 * Session configuration
 * ======================================================= */

export type SegmentationSessionConfig = {
  executionProvider:
    SegmentationExecutionProvider;

  intraOpNumThreads: number;

  interOpNumThreads: number;

  enableCpuMemArena: boolean;

  enableMemPattern: boolean;

  enableProfiling: boolean;

  logLevel: SegmentationLogLevel;

  graphOptimizationLevel:
    | 'disabled'
    | 'basic'
    | 'extended'
    | 'all';

  /**
   * الحد الأقصى لتحميل Session.
   */
  sessionLoadTimeoutMs: number;

  /**
   * الحد الأقصى للاستدلال الواحد.
   */
  inferenceTimeoutMs: number;

  /**
   * عدد المحاولات عند خطأ قابل للإعادة.
   */
  maximumInferenceAttempts: number;

  /**
   * تأخير بين المحاولات.
   */
  retryBaseDelayMs: number;

  /**
   * إعادة استخدام الـSession.
   */
  reuseSession: boolean;

  /**
   * تشغيل Warmup بعد التحميل.
   */
  warmupOnLoad: boolean;

  /**
   * تفريغ Sessions عند Memory Warning.
   */
  disposeOnMemoryWarning: boolean;
};

/* =========================================================
 * Embedding cache configuration
 * ======================================================= */

export type EdgeSamEmbeddingCacheConfig = {
  policy: SegmentationCachePolicy;

  maximumEntries: number;

  maximumBytes: number;

  maximumAgeMs: number;

  /**
   * إزالة الـEmbedding بعد اكتمال الطلب.
   */
  disposeAfterRequest: boolean;

  /**
   * الاحتفاظ بآخر Embedding
   * لدعم تعديل الـPrompt.
   */
  retainLatestEmbedding: boolean;
};

/* =========================================================
 * Model configuration
 * ======================================================= */

export type SegmentationModelConfig = {
  id: string;

  displayName: string;

  family: 'edgesam';

  version: string;

  assets: EdgeSamModelAssets;

  encoder: {
    input: EdgeSamEncoderInputConfig;

    output: EdgeSamEncoderOutputConfig;

    session: SegmentationSessionConfig;
  };

  decoder: {
    config: EdgeSamDecoderConfig;

    session: SegmentationSessionConfig;
  };

  automaticPrompt:
    EdgeSamAutomaticPromptConfig;

  selection:
    EdgeSamMaskSelectionConfig;

  refinement:
    SegmentationMaskRefinementConfig;

  embeddingCache:
    EdgeSamEmbeddingCacheConfig;
};

/* =========================================================
 * Native session handles
 * ======================================================= */

/**
 * Handle عام لأن التطبيق قد يستخدم:
 *
 * - ONNX Runtime على Android.
 * - Core ML أو ONNX Runtime على iOS.
 */
export type SegmentationNativeSessionHandle =
  unknown;

/* =========================================================
 * Session metadata
 * ======================================================= */

export type SegmentationSessionTensorInfo = {
  name: string;

  dimensions: SegmentationTensorShape;

  dataType:
    SegmentationTensorDataType;

  layout: SegmentationTensorLayout;
};

export type SegmentationSessionModelInfo = {
  component: SegmentationModelComponent;

  assetPath: string;

  inputNames: readonly string[];

  outputNames: readonly string[];

  inputs: readonly SegmentationSessionTensorInfo[];

  outputs: readonly SegmentationSessionTensorInfo[];
};

/* =========================================================
 * Component session info
 * ======================================================= */

export type SegmentationComponentSessionInfo = {
  component: SegmentationModelComponent;

  state: SegmentationSessionState;

  modelId: string;

  modelVersion: string;

  loadedAt: number | null;

  lastUsedAt: number | null;

  runCount: number;

  inputNames: readonly string[];

  outputNames: readonly string[];

  executionProvider:
    SegmentationExecutionProvider;

  modelPath: string | null;

  sessionLoadMs: number | null;

  lastInferenceMs: number | null;

  lastError: string | null;
};

/* =========================================================
 * Combined EdgeSAM session info
 * ======================================================= */

export type EdgeSamSessionInfo = {
  state: SegmentationSessionState;

  encoder:
    SegmentationComponentSessionInfo;

  decoder:
    SegmentationComponentSessionInfo;

  initializedAt: number | null;

  lastUsedAt: number | null;

  totalEncoderRuns: number;

  totalDecoderRuns: number;

  executionProvider:
    SegmentationExecutionProvider;

  lastError: string | null;
};

/* =========================================================
 * Session load result
 * ======================================================= */

export type SegmentationSessionLoadResult = {
  encoderLoaded: boolean;

  decoderLoaded: boolean;

  encoderReused: boolean;

  decoderReused: boolean;

  encoderInfo:
    SegmentationSessionModelInfo;

  decoderInfo:
    SegmentationSessionModelInfo;

  timings: {
    encoderAssetResolveMs: number;

    decoderAssetResolveMs: number;

    encoderSessionCreateMs: number;

    decoderSessionCreateMs: number;

    warmupMs: number;

    totalMs: number;
  };

  warnings: readonly string[];
};

/* =========================================================
 * Session diagnostics
 * ======================================================= */

export type SegmentationSessionDiagnostics = {
  state: SegmentationSessionState;

  encoderState:
    SegmentationSessionState;

  decoderState:
    SegmentationSessionState;

  executionProvider:
    SegmentationExecutionProvider;

  encoderModelPath: string | null;

  decoderModelPath: string | null;

  encoderLoadMs: number | null;

  decoderLoadMs: number | null;

  encoderRunCount: number;

  decoderRunCount: number;

  currentMemoryUsageBytes: number | null;

  peakMemoryUsageBytes: number | null;

  embeddingCache:
    EdgeSamEmbeddingCacheStats;

  warnings: readonly string[];

  lastError: string | null;
};

/* =========================================================
 * Session initialization request
 * ======================================================= */

export type SegmentationSessionInitializeRequest = {
  requestId?: string;

  config?: SegmentationModelConfig;

  forceReload?: boolean;

  warmup?: boolean;

  cancellationSignal?:
    SegmentationCancellationSignal;

  onProgress?:
    SegmentationProgressCallback;
};

/* =========================================================
 * Session inference request
 * ======================================================= */

export type EdgeSamEncoderRunRequest = {
  requestId: string;

  input: EdgeSamEncoderInput;

  sourceId: string;

  transform: SegmentationTransform;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

export type EdgeSamDecoderRunRequest = {
  requestId: string;

  inputs: EdgeSamDecoderInputs;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

/* =========================================================
 * Progress
 * ======================================================= */

export type SegmentationProgressEvent = {
  requestId: string;

  stage: SegmentationPipelineStage;

  stageNumber: number;

  totalStages:
    typeof SEGMENTATION_TOTAL_STAGES;

  /**
   * من 0 إلى 1.
   */
  progress: number;

  message: string;

  elapsedMs: number;

  metadata?: Record<
    string,
    string | number | boolean | null
  >;
};

export type SegmentationProgressCallback = (
  event: SegmentationProgressEvent
) => void;

export type SegmentationStageTiming = {
  stage: SegmentationPipelineStage;

  startedAt: number;

  completedAt: number;

  durationMs: number;
};

/* =========================================================
 * Cancellation
 * ======================================================= */

export type SegmentationCancellationSignal = {
  readonly cancelled: boolean;

  readonly reason?: string;

  throwIfCancelled(): void;
};

export type SegmentationCancellationController = {
  readonly signal:
    SegmentationCancellationSignal;

  cancel(reason?: string): void;
};

/* =========================================================
 * Engine initialization
 * ======================================================= */

export type SegmentationEngineInitializeRequest = {
  requestId?: string;

  config?: SegmentationModelConfig;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;

  forceSessionReload?: boolean;

  warmup?: boolean;
};

export type SegmentationEngineInitializeResult = {
  requestId: string;

  ready: boolean;

  sessionLoad:
    SegmentationSessionLoadResult;

  durationMs: number;

  warnings: readonly string[];
};

/* =========================================================
 * Engine request options
 * ======================================================= */

export type SegmentationRequestOptions = {
  /**
   * معرف العملية.
   */
  requestId?: string;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;

  /**
   * Prompt يدوي اختياري.
   *
   * عند عدم إرساله،
   * المحرك يولد Prompt تلقائيًا.
   */
  prompt?:
    EdgeSamManualPromptInput | null;

  /**
   * إعدادات مخصصة للطلب فقط.
   */
  config?:
    Partial<SegmentationModelConfig>;

  /**
   * عدد محاولات Encoder وDecoder.
   */
  maximumInferenceAttempts?: number;

  /**
   * إعادة تحميل Sessions.
   */
  forceSessionReload?: boolean;

  /**
   * إعادة استخدام Sessions الموجودة.
   */
  reuseSession?: boolean;

  /**
   * إعادة استخدام Embedding للصورة نفسها.
   */
  reuseEmbedding?: boolean;

  /**
   * الانتظار لو فيه طلب حالي.
   */
  waitForCurrentRequest?: boolean;

  /**
   * الاحتفاظ بكل Mask Candidates
   * داخل Diagnostics.
   */
  includeMaskCandidatesInDiagnostics?:
    boolean;

  collectDiagnostics?: boolean;
};

/* =========================================================
 * Engine request
 * ======================================================= */

export type SegmentationRequest = {
  source: SegmentationSource;

  options?: SegmentationRequestOptions;
};

/* =========================================================
 * Engine run attempts
 * ======================================================= */

export type SegmentationInferenceAttempt = {
  attempt: number;

  component:
    SegmentationModelComponent;

  startedAt: number;

  completedAt: number;

  durationMs: number;

  succeeded: boolean;

  errorCode?: string;

  errorMessage?: string;

  retryable?: boolean;
};

/* =========================================================
 * Decoder result
 * ======================================================= */

export type EdgeSamDecoderResult = {
  rawOutput: EdgeSamDecoderRawOutput;

  candidates:
    EdgeSamMaskCandidateCollection;

  selection:
    EdgeSamMaskSelectionResult;

  sessionReused: boolean;

  timings: EdgeSamDecoderTimings;
};

export type EdgeSamDecoderTimings = {
  promptBuildMs: number;

  inputBuildMs: number;

  sessionLoadMs: number;

  inferenceMs: number;

  outputReadMs: number;

  candidateBuildMs: number;

  candidateSelectionMs: number;

  totalMs: number;
};

/* =========================================================
 * Complete EdgeSAM inference result
 * ======================================================= */

export type EdgeSamInferenceResult = {
  encoder: EdgeSamEncoderResult;

  prompt:
    EdgeSamPromptGenerationResult;

  decoder:
    EdgeSamDecoderResult;

  attempts:
    readonly SegmentationInferenceAttempt[];

  totalMs: number;
};
// scan/core/ai/types.ts
// Part 3/3
//
// يكمل مباشرة بعد:
//
// export type EdgeSamInferenceResult = {
//   ...
// };

/* =========================================================
 * Final segmentation result
 * ======================================================= */

export type SegmentationResult = {
  requestId: string;

  source: SegmentationSource;

  originalSize: SegmentationSize;

  modelInputSize: SegmentationSize;

  alphaMask: SegmentationAlphaMask;

  maskStatistics: SegmentationMaskStatistics;

  transform: SegmentationTransform;

  prompt: EdgeSamPrompt;

  selectedCandidate: EdgeSamMaskCandidate;

  timings: SegmentationTimings;

  attempts: readonly SegmentationInferenceAttempt[];

  diagnostics?: SegmentationDiagnostics;
};

/* =========================================================
 * Complete timings
 * ======================================================= */

export type SegmentationTimings = {
  preprocessingMs: number;

  sessionLoadMs: number;

  encoderInferenceMs: number;

  promptGenerationMs: number;

  decoderInputBuildMs: number;

  decoderInferenceMs: number;

  candidateReadMs: number;

  candidateSelectionMs: number;

  postprocessingMs: number;

  totalMs: number;

  stages: readonly SegmentationStageTiming[];
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type SegmentationDiagnostics = {
  modelId: string;

  modelVersion: string;

  modelFamily: 'edgesam';

  platform: SegmentationPlatform;

  runtime: SegmentationRuntime;

  executionProvider:
    SegmentationExecutionProvider;

  encoderInputName: string;

  encoderInputDimensions:
    readonly number[];

  encoderOutputName: string;

  encoderOutputDimensions:
    readonly number[];

  decoderInputNames:
    readonly string[];

  decoderOutputNames:
    readonly string[];

  selectedMasksOutputName: string;

  selectedScoresOutputName:
    string | null;

  encoderSessionReused: boolean;

  decoderSessionReused: boolean;

  embeddingCacheHit: boolean;

  promptMode:
    SegmentationPromptMode;

  promptGeneratedAutomatically: boolean;

  positivePointCount: number;

  negativePointCount: number;

  usedBoundingBox: boolean;

  maskCandidateCount: number;

  selectedCandidateIndex: number;

  selectedPredictedIou: number;

  selectedStabilityScore: number;

  selectedFinalScore: number;

  selectedCandidateValidity:
    SegmentationCandidateValidity;

  maskStatistics:
    SegmentationMaskStatistics;

  session:
    SegmentationSessionDiagnostics;

  warnings: readonly string[];

  /**
   * لا نضع بيانات الماسك الكاملة هنا افتراضيًا
   * لتجنب استهلاك الذاكرة.
   */
  maskCandidates?: readonly {
    id: string;

    index: number;

    validity:
      SegmentationCandidateValidity;

    predictedIou: number;

    stabilityScore: number;

    finalScore: number;

    statistics:
      SegmentationMaskStatistics;

    rejectionReasons:
      readonly string[];

    warnings:
      readonly string[];
  }[];
};

/* =========================================================
 * Engine statistics
 * ======================================================= */

export type SegmentationEngineStatistics = {
  initializedAt: number | null;

  processedRequests: number;

  completedRequests: number;

  failedRequests: number;

  cancelledRequests: number;

  encoderRuns: number;

  decoderRuns: number;

  embeddingCacheHits: number;

  embeddingCacheMisses: number;

  sessionReloads: number;

  totalProcessingMs: number;

  averageProcessingMs: number;

  averageEncoderInferenceMs: number;

  averageDecoderInferenceMs: number;

  averagePostprocessingMs: number;

  lastCompletedAt: number | null;

  lastFailedAt: number | null;

  lastCancelledAt: number | null;
};

/* =========================================================
 * Engine diagnostics
 * ======================================================= */

export type SegmentationEngineDiagnostics = {
  state: SegmentationEngineState;

  ready: boolean;

  busy: boolean;

  disposed: boolean;

  activeRequestId: string | null;

  queuedRequestCount: number;

  modelId: string;

  modelVersion: string;

  session:
    SegmentationSessionDiagnostics;

  statistics:
    SegmentationEngineStatistics;

  lastDurationMs: number | null;

  lastErrorCode:
    SegmentationErrorCode | null;

  lastErrorMessage: string | null;

  warnings: readonly string[];
};

/* =========================================================
 * Device information
 * ======================================================= */

export type SegmentationDeviceInfo = {
  platform:
    SegmentationPlatform;

  operatingSystemVersion:
    string | null;

  totalMemoryBytes:
    number | null;

  availableMemoryBytes:
    number | null;

  processorCount:
    number | null;

  architecture:
    string | null;

  isPhysicalDevice:
    boolean;

  runtimeAvailable:
    boolean;

  supportedExecutionProviders:
    readonly SegmentationExecutionProvider[];
};

/* =========================================================
 * Device compatibility
 * ======================================================= */

export type SegmentationCompatibilityStatus =
  | 'supported'
  | 'unsupported'
  | 'unknown';

export type SegmentationCompatibilityReason =
  | 'supported'
  | 'memory-too-low'
  | 'platform-not-supported'
  | 'architecture-not-supported'
  | 'runtime-not-available'
  | 'execution-provider-unavailable'
  | 'physical-device-required'
  | 'device-information-unavailable';

export type SegmentationCompatibilityRequirements = {
  minimumMemoryBytes: number;

  supportedPlatforms:
    readonly SegmentationPlatform[];

  supportedArchitectures:
    readonly string[];

  requirePhysicalDevice: boolean;

  requiredExecutionProviders:
    readonly SegmentationExecutionProvider[];

  allowUnknownMemory: boolean;

  allowUnknownArchitecture: boolean;
};

export type SegmentationCompatibilityResult = {
  status:
    SegmentationCompatibilityStatus;

  reason:
    SegmentationCompatibilityReason;

  device:
    SegmentationDeviceInfo;

  requirements:
    SegmentationCompatibilityRequirements;

  selectedExecutionProvider:
    SegmentationExecutionProvider | null;

  message: string;

  warnings: readonly string[];
};

/* =========================================================
 * Memory information
 * ======================================================= */

export type SegmentationMemorySnapshot = {
  capturedAt: number;

  totalMemoryBytes:
    number | null;

  availableMemoryBytes:
    number | null;

  usedMemoryBytes:
    number | null;

  processMemoryBytes:
    number | null;

  embeddingCacheBytes:
    number;

  estimatedTensorBytes:
    number;
};

export type SegmentationMemoryWarningLevel =
  | 'none'
  | 'moderate'
  | 'high'
  | 'critical';

export type SegmentationMemoryStatus = {
  level:
    SegmentationMemoryWarningLevel;

  snapshot:
    SegmentationMemorySnapshot;

  shouldClearEmbeddingCache:
    boolean;

  shouldDisposeSessions:
    boolean;

  shouldRejectRequest:
    boolean;

  message: string;
};

/* =========================================================
 * Errors
 * ======================================================= */

export type SegmentationErrorCode =
  | 'INVALID_INPUT'
  | 'IMAGE_NOT_FOUND'
  | 'IMAGE_LOAD_FAILED'
  | 'IMAGE_DECODE_FAILED'
  | 'IMAGE_ORIENTATION_FAILED'
  | 'IMAGE_RESIZE_FAILED'
  | 'PIXEL_READ_FAILED'
  | 'TENSOR_CREATION_FAILED'
  | 'ENCODER_TENSOR_CREATION_FAILED'
  | 'PROMPT_GENERATION_FAILED'
  | 'PROMPT_INVALID'
  | 'DECODER_INPUT_CREATION_FAILED'
  | 'MODEL_ASSET_NOT_FOUND'
  | 'MODEL_ASSET_INVALID'
  | 'MODEL_COPY_FAILED'
  | 'ENCODER_SESSION_CREATE_FAILED'
  | 'DECODER_SESSION_CREATE_FAILED'
  | 'SESSION_CREATE_FAILED'
  | 'SESSION_NOT_READY'
  | 'SESSION_BUSY'
  | 'ENCODER_INFERENCE_FAILED'
  | 'DECODER_INFERENCE_FAILED'
  | 'INFERENCE_FAILED'
  | 'INFERENCE_TIMEOUT'
  | 'INVALID_ENCODER_OUTPUT'
  | 'INVALID_DECODER_OUTPUT'
  | 'INVALID_MODEL_OUTPUT'
  | 'OUTPUT_SHAPE_UNSUPPORTED'
  | 'EMBEDDING_INVALID'
  | 'EMBEDDING_CACHE_FAILED'
  | 'MASK_CANDIDATE_READ_FAILED'
  | 'NO_MASK_CANDIDATES'
  | 'NO_VALID_MASK_CANDIDATE'
  | 'MASK_SELECTION_FAILED'
  | 'MASK_PROCESSING_FAILED'
  | 'MASK_EMPTY'
  | 'MASK_INVALID'
  | 'MASK_TOO_SMALL'
  | 'MASK_TOO_LARGE'
  | 'DEVICE_UNSUPPORTED'
  | 'RUNTIME_UNAVAILABLE'
  | 'EXECUTION_PROVIDER_UNAVAILABLE'
  | 'OUT_OF_MEMORY'
  | 'ENGINE_BUSY'
  | 'REQUEST_CANCELLED'
  | 'CANCELLED'
  | 'SESSION_DISPOSED'
  | 'ENGINE_DISPOSED'
  | 'UNKNOWN';
  

export type SegmentationErrorMetadataValue =
  | string
  | number
  | boolean
  | null;

export type SegmentationErrorDetails = {
  requestId?: string;

  stage?:
    SegmentationPipelineStage;

  component?:
    SegmentationModelComponent;

  cause?: unknown;

  retryable?: boolean;

  attempt?: number;

  metadata?: Record<
    string,
    SegmentationErrorMetadataValue
  >;
};

/**
 * الخطأ الموحد لكل طبقة EdgeSAM.
 */
export class SegmentationError extends Error {
  readonly code:
    SegmentationErrorCode;

  readonly stage?:
    SegmentationPipelineStage;

  readonly component?:
    SegmentationModelComponent;

  readonly retryable:
    boolean;

  readonly requestId?:
    string;

  readonly attempt?:
    number;

  readonly cause?:
    unknown;

  readonly metadata?: Record<
    string,
    SegmentationErrorMetadataValue
  >;

  constructor(
    code: SegmentationErrorCode,
    message: string,
    details: SegmentationErrorDetails = {}
  ) {
    super(message);

    this.name =
      'SegmentationError';

    this.code =
      code;

    this.stage =
      details.stage;

    this.component =
      details.component;

    this.retryable =
      details.retryable ?? false;

    this.requestId =
      details.requestId;

    this.attempt =
      details.attempt;

    this.cause =
      details.cause;

    this.metadata =
      details.metadata;

    Object.setPrototypeOf(
      this,
      SegmentationError.prototype
    );
  }
}

/* =========================================================
 * Type guards
 * ======================================================= */

export function isSegmentationError(
  value: unknown
): value is SegmentationError {
  return (
    value instanceof
    SegmentationError
  );
}

export function isSegmentationImageSource(
  value: unknown
): value is SegmentationImageSource {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleSource =
    value as Partial<SegmentationImageSource>;

  return (
    typeof possibleSource.uri ===
      'string' &&
    possibleSource.uri.trim().length > 0
  );
}

export function isSegmentationRgbaImageSource(
  value: unknown
): value is SegmentationRgbaImageSource {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleSource =
    value as Partial<SegmentationRgbaImageSource>;

  const width =
    possibleSource.width;

  const height =
    possibleSource.height;

  const rgba =
    possibleSource.rgba;

  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isInteger(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    !Number.isInteger(height) ||
    height <= 0 ||
    !(rgba instanceof Uint8Array)
  ) {
    return false;
  }

  return (
    rgba.length ===
    width *
      height *
      4
  );
}

export function isSegmentationSource(
  value: unknown
): value is SegmentationSource {
  return (
    isSegmentationImageSource(value) ||
    isSegmentationRgbaImageSource(value)
  );
}

export function isValidSegmentationSize(
  value: unknown
): value is SegmentationSize {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleSize =
    value as Partial<SegmentationSize>;

  return (
    typeof possibleSize.width ===
      'number' &&
    Number.isFinite(
      possibleSize.width
    ) &&
    Number.isInteger(
      possibleSize.width
    ) &&
    possibleSize.width > 0 &&
    typeof possibleSize.height ===
      'number' &&
    Number.isFinite(
      possibleSize.height
    ) &&
    Number.isInteger(
      possibleSize.height
    ) &&
    possibleSize.height > 0
  );
}

export function isValidSegmentationPoint(
  value: unknown
): value is SegmentationPoint {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possiblePoint =
    value as Partial<SegmentationPoint>;

  return (
    typeof possiblePoint.x ===
      'number' &&
    Number.isFinite(
      possiblePoint.x
    ) &&
    typeof possiblePoint.y ===
      'number' &&
    Number.isFinite(
      possiblePoint.y
    )
  );
}

export function isValidSegmentationRect(
  value: unknown
): value is SegmentationRect {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleRect =
    value as Partial<SegmentationRect>;

  return (
    typeof possibleRect.x ===
      'number' &&
    Number.isFinite(
      possibleRect.x
    ) &&
    typeof possibleRect.y ===
      'number' &&
    Number.isFinite(
      possibleRect.y
    ) &&
    typeof possibleRect.width ===
      'number' &&
    Number.isFinite(
      possibleRect.width
    ) &&
    possibleRect.width >= 0 &&
    typeof possibleRect.height ===
      'number' &&
    Number.isFinite(
      possibleRect.height
    ) &&
    possibleRect.height >= 0
  );
}

export function isValidSegmentationBox(
  value: unknown
): value is SegmentationBoxCoordinates {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleBox =
    value as Partial<SegmentationBoxCoordinates>;

  return (
    typeof possibleBox.x1 ===
      'number' &&
    Number.isFinite(
      possibleBox.x1
    ) &&
    typeof possibleBox.y1 ===
      'number' &&
    Number.isFinite(
      possibleBox.y1
    ) &&
    typeof possibleBox.x2 ===
      'number' &&
    Number.isFinite(
      possibleBox.x2
    ) &&
    typeof possibleBox.y2 ===
      'number' &&
    Number.isFinite(
      possibleBox.y2
    ) &&
    possibleBox.x2 >
      possibleBox.x1 &&
    possibleBox.y2 >
      possibleBox.y1
  );
}

export function isValidFloatMask(
  value: unknown
): value is SegmentationFloatMask {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleMask =
    value as Partial<SegmentationFloatMask>;

  if (
    typeof possibleMask.width !==
      'number' ||
    typeof possibleMask.height !==
      'number' ||
    !Number.isInteger(
      possibleMask.width
    ) ||
    !Number.isInteger(
      possibleMask.height
    ) ||
    possibleMask.width <= 0 ||
    possibleMask.height <= 0 ||
    !(
      possibleMask.data instanceof
      Float32Array
    )
  ) {
    return false;
  }

  return (
    possibleMask.data.length ===
    possibleMask.width *
      possibleMask.height
  );
}

export function isValidAlphaMask(
  value: unknown
): value is SegmentationAlphaMask {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleMask =
    value as Partial<SegmentationAlphaMask>;

  if (
    typeof possibleMask.width !==
      'number' ||
    typeof possibleMask.height !==
      'number' ||
    !Number.isInteger(
      possibleMask.width
    ) ||
    !Number.isInteger(
      possibleMask.height
    ) ||
    possibleMask.width <= 0 ||
    possibleMask.height <= 0 ||
    !(
      possibleMask.data instanceof
      Uint8Array
    )
  ) {
    return false;
  }

  return (
    possibleMask.data.length ===
    possibleMask.width *
      possibleMask.height
  );
}

export function isValidEdgeSamEmbedding(
  value: unknown
): value is EdgeSamImageEmbedding {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const possibleEmbedding =
    value as Partial<EdgeSamImageEmbedding>;

  return (
    typeof possibleEmbedding.name ===
      'string' &&
    possibleEmbedding.name.length > 0 &&
    possibleEmbedding.data instanceof
      Float32Array &&
    Array.isArray(
      possibleEmbedding.dimensions
    ) &&
    possibleEmbedding.dimensions.length > 0 &&
    possibleEmbedding.dimensions.every(
      dimension =>
        Number.isInteger(dimension) &&
        dimension > 0
    ) &&
    typeof possibleEmbedding.sourceId ===
      'string' &&
    possibleEmbedding.sourceId.length > 0 &&
    typeof possibleEmbedding.byteLength ===
      'number' &&
    possibleEmbedding.byteLength ===
      possibleEmbedding.data.byteLength &&
    isValidSegmentationSize({
      width: possibleEmbedding.width,
      height: possibleEmbedding.height,
    })
  );
}

/* =========================================================
 * Progress helpers
 * ======================================================= */

export function getSegmentationStageNumber(
  stage: SegmentationPipelineStage
): number {
  return SEGMENTATION_STAGE_INDEX[
    stage
  ];
}

export function getSegmentationProgress(
  stage: SegmentationPipelineStage
): number {
  const stageNumber =
    getSegmentationStageNumber(stage);

  return clampUnitValue(
    stageNumber /
      SEGMENTATION_TOTAL_STAGES
  );
}

export function createSegmentationProgressEvent(
  requestId: string,
  stage: SegmentationPipelineStage,
  startedAt: number,
  message: string,
  metadata?: Record<
    string,
    string | number | boolean | null
  >
): SegmentationProgressEvent {
  return {
    requestId,

    stage,

    stageNumber:
      getSegmentationStageNumber(
        stage
      ),

    totalStages:
      SEGMENTATION_TOTAL_STAGES,

    progress:
      getSegmentationProgress(stage),

    message,

    elapsedMs:
      Math.max(
        0,
        Date.now() - startedAt
      ),

    metadata,
  };
}

/* =========================================================
 * Cancellation implementation
 * ======================================================= */

class DefaultSegmentationCancellationSignal
  implements SegmentationCancellationSignal
{
  private _cancelled =
    false;

  private _reason?:
    string;

  get cancelled(): boolean {
    return this._cancelled;
  }

  get reason():
    string | undefined {
    return this._reason;
  }

  cancel(reason?: string): void {
    if (this._cancelled) {
      return;
    }

    this._cancelled =
      true;

    this._reason =
      reason?.trim() ||
      'Segmentation request cancelled.';
  }

  throwIfCancelled(): void {
    if (!this._cancelled) {
      return;
    }

    throw new SegmentationError(
      'REQUEST_CANCELLED',
      this._reason ||
        'Segmentation request cancelled.',
      {
        retryable: false,
      }
    );
  }
}

/**
 * إنشاء Controller لإلغاء طلب EdgeSAM.
 */
export function createSegmentationCancellationController():
  SegmentationCancellationController {
  const signal =
    new DefaultSegmentationCancellationSignal();

  return {
    signal,

    cancel(reason?: string) {
      signal.cancel(reason);
    },
  };
}

/* =========================================================
 * Numeric helpers
 * ======================================================= */

export function clampSegmentationValue(
  value: number,
  minimum: number,
  maximum: number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return minimum;
  }

  const safeMinimum =
    Math.min(
      minimum,
      maximum
    );

  const safeMaximum =
    Math.max(
      minimum,
      maximum
    );

  if (value < safeMinimum) {
    return safeMinimum;
  }

  if (value > safeMaximum) {
    return safeMaximum;
  }

  return value;
}

export function clampUnitValue(
  value: number
): number {
  return clampSegmentationValue(
    value,
    0,
    1
  );
}

export function alphaByteFromUnitValue(
  value: number
): number {
  return Math.round(
    clampUnitValue(value) *
      255
  );
}

export function unitValueFromAlphaByte(
  value: number
): number {
  return (
    clampSegmentationValue(
      Math.round(value),
      0,
      255
    ) / 255
  );
}

export function safeSegmentationDivide(
  numerator: number,
  denominator: number,
  fallback = 0
): number {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return fallback;
  }

  const result =
    numerator / denominator;

  return Number.isFinite(result)
    ? result
    : fallback;
}

/* =========================================================
 * Geometry helpers
 * ======================================================= */

export function clampPointToSize(
  point: SegmentationPoint,
  size: SegmentationSize
): SegmentationPoint {
  return {
    x: clampSegmentationValue(
      point.x,
      0,
      Math.max(
        0,
        size.width - 1
      )
    ),

    y: clampSegmentationValue(
      point.y,
      0,
      Math.max(
        0,
        size.height - 1
      )
    ),
  };
}

export function clampBoxToSize(
  box: SegmentationBoxCoordinates,
  size: SegmentationSize
): SegmentationBoxCoordinates {
  const maximumX =
    Math.max(
      0,
      size.width - 1
    );

  const maximumY =
    Math.max(
      0,
      size.height - 1
    );

  const x1 =
    clampSegmentationValue(
      Math.min(
        box.x1,
        box.x2
      ),
      0,
      maximumX
    );

  const y1 =
    clampSegmentationValue(
      Math.min(
        box.y1,
        box.y2
      ),
      0,
      maximumY
    );

  const x2 =
    clampSegmentationValue(
      Math.max(
        box.x1,
        box.x2
      ),
      x1,
      maximumX
    );

  const y2 =
    clampSegmentationValue(
      Math.max(
        box.y1,
        box.y2
      ),
      y1,
      maximumY
    );

  return {
    x1,
    y1,
    x2,
    y2,
  };
}

export function rectToBoxCoordinates(
  rect: SegmentationRect
): SegmentationBoxCoordinates {
  return {
    x1: rect.x,

    y1: rect.y,

    x2:
      rect.x +
      rect.width,

    y2:
      rect.y +
      rect.height,
  };
}

export function boxCoordinatesToRect(
  box: SegmentationBoxCoordinates
): SegmentationRect {
  return {
    x:
      Math.min(
        box.x1,
        box.x2
      ),

    y:
      Math.min(
        box.y1,
        box.y2
      ),

    width:
      Math.abs(
        box.x2 -
        box.x1
      ),

    height:
      Math.abs(
        box.y2 -
        box.y1
      ),
  };
}

/* =========================================================
 * Tensor helpers
 * ======================================================= */

export function getTensorElementCount(
  dimensions: readonly number[]
): number {
  if (
    dimensions.length === 0
  ) {
    return 0;
  }

  let total =
    1;

  for (
    const dimension of dimensions
  ) {
    if (
      !Number.isInteger(
        dimension
      ) ||
      dimension <= 0
    ) {
      return 0;
    }

    total *=
      dimension;

    if (
      !Number.isSafeInteger(
        total
      )
    ) {
      return 0;
    }
  }

  return total;
}

export function getTensorDataLength(
  data: SegmentationTensorData
): number {
  return data.length;
}

export function getTensorByteLength(
  data: SegmentationTensorData
): number {
  if (
    Array.isArray(data)
  ) {
    return data.length;
  }

  return data.byteLength;
}

export function isTensorShapeCompatible(
  dimensions: readonly number[],
  dataLength: number
): boolean {
  return (
    getTensorElementCount(
      dimensions
    ) === dataLength
  );
}

/* =========================================================
 * Request identifiers
 * ======================================================= */

export function createSegmentationRequestId():
  string {
  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 10);

  return [
    'edgesam',
    Date.now().toString(36),
    randomPart,
  ].join('-');
}

export function createEdgeSamPromptId(
  prefix:
    | 'point'
    | 'box'
    | 'mask' =
      'point'
): string {
  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 8);

  return [
    prefix,
    Date.now().toString(36),
    randomPart,
  ].join('-');
}

export function createMaskCandidateId(
  requestId: string,
  index: number
): string {
  return [
    requestId,
    'mask',
    Math.max(
      0,
      Math.floor(index)
    ).toString(36),
  ].join('-');
}

/* =========================================================
 * Error helpers
 * ======================================================= */

export function getUnknownErrorMessage(
  error: unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'string'
  ) {
    return error;
  }

  try {
    const serialized =
      JSON.stringify(error);

    if (
      typeof serialized ===
        'string' &&
      serialized.length > 0
    ) {
      return serialized;
    }
  } catch {
    // نستخدم String في النهاية.
  }

  return String(error);
}

export function toSegmentationError(
  error: unknown,
  fallbackCode:
    SegmentationErrorCode,
  fallbackMessage: string,
  details: SegmentationErrorDetails = {}
): SegmentationError {
  if (
    isSegmentationError(error)
  ) {
    return error;
  }

  const originalMessage =
    getUnknownErrorMessage(error);

  return new SegmentationError(
    fallbackCode,
    originalMessage
      ? `${fallbackMessage} ${originalMessage}`
      : fallbackMessage,
    {
      ...details,

      cause:
        details.cause ??
        error,
    }
  );
}

export function isRetryableSegmentationError(
  error: unknown
): boolean {
  return (
    isSegmentationError(error) &&
    error.retryable
  );
}

/* =========================================================
 * Stage timing helpers
 * ======================================================= */

export function createSegmentationStageTiming(
  stage: SegmentationPipelineStage,
  startedAt: number,
  completedAt = Date.now()
): SegmentationStageTiming {
  const safeStartedAt =
    Number.isFinite(startedAt)
      ? startedAt
      : completedAt;

  const safeCompletedAt =
    Number.isFinite(completedAt)
      ? Math.max(
          safeStartedAt,
          completedAt
        )
      : safeStartedAt;

  return {
    stage,

    startedAt:
      safeStartedAt,

    completedAt:
      safeCompletedAt,

    durationMs:
      Math.max(
        0,
        safeCompletedAt -
          safeStartedAt
      ),
  };
}

/* =========================================================
 * Mask creation helpers
 * ======================================================= */

export function createEmptyFloatMask(
  width: number,
  height: number,
  value = 0
): SegmentationFloatMask {
  const safeWidth =
    Math.max(
      1,
      Math.floor(width)
    );

  const safeHeight =
    Math.max(
      1,
      Math.floor(height)
    );

  const data =
    new Float32Array(
      safeWidth *
        safeHeight
    );

  if (value !== 0) {
    data.fill(
      clampUnitValue(value)
    );
  }

  return {
    width:
      safeWidth,

    height:
      safeHeight,

    data,
  };
}

export function createEmptyAlphaMask(
  width: number,
  height: number,
  value = 0
): SegmentationAlphaMask {
  const safeWidth =
    Math.max(
      1,
      Math.floor(width)
    );

  const safeHeight =
    Math.max(
      1,
      Math.floor(height)
    );

  const data =
    new Uint8Array(
      safeWidth *
        safeHeight
    );

  if (value !== 0) {
    data.fill(
      alphaByteFromUnitValue(
        value
      )
    );
  }

  return {
    width:
      safeWidth,

    height:
      safeHeight,

    data,
  };
}

export function cloneFloatMask(
  mask: SegmentationFloatMask
): SegmentationFloatMask {
  return {
    width:
      mask.width,

    height:
      mask.height,

    data:
      new Float32Array(
        mask.data
      ),
  };
}

export function cloneAlphaMask(
  mask: SegmentationAlphaMask
): SegmentationAlphaMask {
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
 * Default statistics
 * ======================================================= */

export function createEmptyMaskStatistics():
  SegmentationMaskStatistics {
  return {
    minimum: 0,

    maximum: 0,

    average: 0,

    foregroundPixels: 0,

    backgroundPixels: 0,

    semiTransparentPixels: 0,

    foregroundRatio: 0,

    backgroundRatio: 1,

    semiTransparentRatio: 0,

    largestComponentPixels: 0,

    largestComponentRatio: 0,

    secondLargestComponentPixels: 0,

    secondLargestComponentRatio: 0,

    connectedComponentCount: 0,

    significantComponentCount: 0,

    holePixels: 0,

    holeRatio: 0,

    edgeContactPixels: 0,

    edgeContactRatio: 0,

    touchedEdgeCount: 0,

    bounds: null,

    centroid: null,

    centerOffsetRatio: 0,
  };
}

/* =========================================================
 * Engine statistics helpers
 * ======================================================= */

export function createInitialEngineStatistics():
  SegmentationEngineStatistics {
  return {
    initializedAt: null,

    processedRequests: 0,

    completedRequests: 0,

    failedRequests: 0,

    cancelledRequests: 0,

    encoderRuns: 0,

    decoderRuns: 0,

    embeddingCacheHits: 0,

    embeddingCacheMisses: 0,

    sessionReloads: 0,

    totalProcessingMs: 0,

    averageProcessingMs: 0,

    averageEncoderInferenceMs: 0,

    averageDecoderInferenceMs: 0,

    averagePostprocessingMs: 0,

    lastCompletedAt: null,

    lastFailedAt: null,

    lastCancelledAt: null,
  };
}

/* =========================================================
 * Miscellaneous helpers
 * ======================================================= */

export function normalizeSegmentationOrientation(
  orientation: number | undefined
): number {
  if (
    !Number.isFinite(
      orientation
    )
  ) {
    return 1;
  }

  const normalized =
    Math.floor(
      orientation as number
    );

  if (
    normalized < 1 ||
    normalized > 8
  ) {
    return 1;
  }

  return normalized;
}

export function normalizeSegmentationImageFormat(
  format:
    | string
    | null
    | undefined
): SegmentationImageFormat {
  if (!format) {
    return 'unknown';
  }

  const normalized =
    format
      .trim()
      .toLowerCase()
      .replace(
        /^\./,
        ''
      );

  switch (normalized) {
    case 'jpeg':
    case 'jpg':
    case 'png':
    case 'webp':
    case 'heic':
    case 'heif':
    case 'bmp':
      return normalized;

    default:
      return 'unknown';
  }
}

export function assertNever(
  value: never,
  message =
    'Unexpected value.'
): never {
  throw new SegmentationError(
    'UNKNOWN',
    `${message} Received: ${String(
      value
    )}`
  );
}