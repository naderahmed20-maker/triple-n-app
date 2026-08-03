// scan/core/ai/BackgroundUnderstandingV3.ts
// Part 1/4
//
// Triple N - EdgeSAM Background Understanding V3
//
// هذه الطبقة لا تعدّل الماسك النهائي مباشرة.
//
// مسؤوليتها:
//
// 1) فهم شكل الخلفية داخل صورة التحليل.
// 2) جمع Background Seeds آمنة من الحواف والزوايا.
// 3) بناء نماذج لونية متعددة للخلفية.
// 4) تحليل الإضاءة والظلال والتدرجات.
// 5) تحليل الحواف والـTexture.
// 6) إنشاء Background Confidence Map.
// 7) إنشاء Foreground Evidence Map.
// 8) تجهيز بيانات Region Growing وFlood Fill.
// 9) إنتاج Diagnostics يمكن استخدامها لاحقًا
//    داخل Adaptive Refinement أو Final Cleanup.
//
// تصميم الملف:
//
// - Part 1:
//   الأنواع والإعدادات والتحقق والأدوات الرقمية واللونية.
//
// - Part 2:
//   تحليل الحواف والزوايا واستخراج Background Seeds
//   وبناء النماذج اللونية.
//
// - Part 3:
//   حساب خرائط الاحتمالات والحواجز وRegion Growing
//   وBackground Flood Fill.
//
// - Part 4:
//   التجميع النهائي والـDiagnostics والـPublic API.
//
// ملاحظات مهمة:
//
// - الصورة المدخلة يجب أن تكون RGBA interleaved.
// - الماسك المدخل يجب أن يكون بنفس أبعاد الصورة.
// - جميع الخرائط العائمة تكون داخل النطاق 0..1.
// - هذه الطبقة مصممة للعمل محليًا بدون مكتبات خارجية.
// - لا توجد عمليات Async لأن التحليل يعتمد على بيانات جاهزة
//   موجودة بالفعل في الذاكرة.

import type {
  SegmentationCancellationSignal,
  SegmentationFloatMask,
  SegmentationMaskBounds,
  SegmentationPoint,
  SegmentationRgbaImageSource,
} from './types';

import {
  clampSegmentationValue,
  clampUnitValue,
  isSegmentationRgbaImageSource,
  isValidFloatMask,
  safeSegmentationDivide,
} from './types';

/* =========================================================
 * Public primitive types
 * ======================================================= */

/**
 * نوع نموذج الخلفية المستخدم أثناء المطابقة.
 */
export type BackgroundUnderstandingModelKindV3 =
  | 'global-border'
  | 'top-border'
  | 'right-border'
  | 'bottom-border'
  | 'left-border'
  | 'top-left-corner'
  | 'top-right-corner'
  | 'bottom-right-corner'
  | 'bottom-left-corner'
  | 'cluster'
  | 'shadow'
  | 'highlight';

/**
 * مصدر Pixel تم اعتباره Background Seed.
 */
export type BackgroundUnderstandingSeedSourceV3 =
  | 'top-border'
  | 'right-border'
  | 'bottom-border'
  | 'left-border'
  | 'top-left-corner'
  | 'top-right-corner'
  | 'bottom-right-corner'
  | 'bottom-left-corner'
  | 'low-mask-border'
  | 'flood-fill-expansion';

/**
 * سبب رفض Pixel من Background Seeds.
 */
export type BackgroundUnderstandingSeedRejectionReasonV3 =
  | 'mask-too-high'
  | 'gradient-too-high'
  | 'alpha-too-low'
  | 'invalid-color'
  | 'too-close-to-subject'
  | 'duplicate-location'
  | 'out-of-bounds';

/**
 * مستوى جودة فهم الخلفية.
 */
export type BackgroundUnderstandingQualityV3 =
  | 'excellent'
  | 'good'
  | 'acceptable'
  | 'weak'
  | 'invalid';

/**
 * شكل توزيع الخلفية المتوقع.
 */
export type BackgroundUnderstandingDistributionV3 =
  | 'uniform'
  | 'smooth-gradient'
  | 'multi-region'
  | 'textured'
  | 'uncertain';

/* =========================================================
 * Public color contracts
 * ======================================================= */

/**
 * لون RGB داخل النطاق 0..1.
 */
export type BackgroundUnderstandingRgbColorV3 = {
  r: number;

  g: number;

  b: number;
};

/**
 * لون Lab تقريبي مناسب للمقارنات المحلية.
 *
 * القيم ليست مخصصة للتصدير كـICC Color.
 * الهدف منها فقط قياس المسافة الإدراكية
 * بين لون Pixel ونماذج الخلفية.
 */
export type BackgroundUnderstandingLabColorV3 = {
  l: number;

  a: number;

  b: number;
};

/**
 * لون YCbCr داخل نطاقات مطبّعة.
 */
export type BackgroundUnderstandingYcbcrColorV3 = {
  y: number;

  cb: number;

  cr: number;
};

/**
 * عينة لون كاملة.
 */
export type BackgroundUnderstandingColorSampleV3 = {
  rgb: BackgroundUnderstandingRgbColorV3;

  lab: BackgroundUnderstandingLabColorV3;

  ycbcr: BackgroundUnderstandingYcbcrColorV3;

  luminance: number;

  chroma: number;

  saturation: number;
};

/* =========================================================
 * Public seed contracts
 * ======================================================= */

export type BackgroundUnderstandingSeedV3 = {
  id: number;

  x: number;

  y: number;

  index: number;

  source: BackgroundUnderstandingSeedSourceV3;

  color: BackgroundUnderstandingColorSampleV3;

  maskValue: number;

  gradientStrength: number;

  localTexture: number;

  borderDistanceRatio: number;

  confidence: number;
};

export type BackgroundUnderstandingRejectedSeedV3 = {
  x: number;

  y: number;

  index: number;

  source: BackgroundUnderstandingSeedSourceV3;

  reason: BackgroundUnderstandingSeedRejectionReasonV3;
};

/* =========================================================
 * Public color statistics
 * ======================================================= */

export type BackgroundUnderstandingColorStatisticsV3 = {
  count: number;

  meanRgb: BackgroundUnderstandingRgbColorV3;

  meanLab: BackgroundUnderstandingLabColorV3;

  meanYcbcr: BackgroundUnderstandingYcbcrColorV3;

  minimumRgb: BackgroundUnderstandingRgbColorV3;

  maximumRgb: BackgroundUnderstandingRgbColorV3;

  standardDeviationRgb: BackgroundUnderstandingRgbColorV3;

  standardDeviationLab: BackgroundUnderstandingLabColorV3;

  meanLuminance: number;

  luminanceStandardDeviation: number;

  meanChroma: number;

  chromaStandardDeviation: number;

  meanSaturation: number;

  saturationStandardDeviation: number;
};

/* =========================================================
 * Public background model contracts
 * ======================================================= */

export type BackgroundUnderstandingColorModelV3 = {
  id: string;

  kind: BackgroundUnderstandingModelKindV3;

  enabled: boolean;

  sampleCount: number;

  weight: number;

  centerRgb: BackgroundUnderstandingRgbColorV3;

  centerLab: BackgroundUnderstandingLabColorV3;

  centerYcbcr: BackgroundUnderstandingYcbcrColorV3;

  rgbTolerance: number;

  labTolerance: number;

  luminanceTolerance: number;

  chromaTolerance: number;

  textureTolerance: number;

  luminanceMinimum: number;

  luminanceMaximum: number;

  confidence: number;

  spatialCenter: SegmentationPoint | null;

  spatialRadiusRatio: number;

  sourceSeedIds: readonly number[];
};

/* =========================================================
 * Public map contracts
 * ======================================================= */

/**
 * خريطة Float بالحجم الكامل.
 */
export type BackgroundUnderstandingMapV3 = {
  width: number;

  height: number;

  data: Float32Array;
};

/**
 * خريطة Byte ثنائية أو شبه ثنائية.
 */
export type BackgroundUnderstandingByteMapV3 = {
  width: number;

  height: number;

  data: Uint8Array;
};

/* =========================================================
 * Configuration
 * ======================================================= */

export type BackgroundUnderstandingConfigV3 = {
  /**
   * أقصى عدد Pixels مسموح بتحليلها.
   */
  maximumPixelCount: number;

  /**
   * عدد Pixels بين كل عينة وأخرى على الحدود.
   */
  borderSampleStride: number;

  /**
   * نسبة عرض الحزام الخارجي المستخدم
   * لجمع عينات الخلفية.
   */
  borderBandRatio: number;

  /**
   * أقل عرض فعلي لحزام الحدود.
   */
  minimumBorderBandPixels: number;

  /**
   * أقصى عرض فعلي لحزام الحدود.
   */
  maximumBorderBandPixels: number;

  /**
   * نسبة حجم مناطق الزوايا.
   */
  cornerRegionRatio: number;

  /**
   * أقل عدد Seeds مطلوب لبناء نموذج موثوق.
   */
  minimumSeedCount: number;

  /**
   * الحد الأقصى لعدد Seeds المحتفظ بها.
   */
  maximumSeedCount: number;

  /**
   * أعلى قيمة Mask تسمح باعتبار Pixel
   * خلفية أولية مؤكدة.
   */
  maximumSeedMaskValue: number;

  /**
   * Pixels ذات Mask أعلى من هذه القيمة
   * لا تدخل نهائيًا كـSeed.
   */
  hardSeedMaskLimit: number;

  /**
   * أقصى Gradient مسموح به للـSeed.
   */
  maximumSeedGradient: number;

  /**
   * أقصى Local Texture مسموح به.
   */
  maximumSeedTexture: number;

  /**
   * أقل Alpha للصورة لقبول Pixel.
   */
  minimumSourceAlpha: number;

  /**
   * أقل مسافة نسبية من حدود الجسم المتوقع.
   */
  minimumSubjectDistanceRatio: number;

  /**
   * نصف قطر قياس Texture المحلي.
   */
  textureRadius: number;

  /**
   * نصف قطر حساب Gradient المساعد.
   */
  gradientRadius: number;

  /**
   * عدد نماذج Clusters القصوى.
   */
  maximumColorClusters: number;

  /**
   * أقل نسبة Samples لإنشاء Cluster مستقل.
   */
  minimumClusterSampleRatio: number;

  /**
   * أقل مسافة Lab بين Cluster وآخر.
   */
  minimumClusterLabDistance: number;

  /**
   * الحد الأساسي لمسافة Lab عند المطابقة.
   */
  baseLabTolerance: number;

  /**
   * الحد الأساسي لمسافة RGB.
   */
  baseRgbTolerance: number;

  /**
   * الحد الأساسي لاختلاف الإضاءة.
   */
  baseLuminanceTolerance: number;

  /**
   * الحد الأساسي لاختلاف Chroma.
   */
  baseChromaTolerance: number;

  /**
   * الحد الأساسي لاختلاف Texture.
   */
  baseTextureTolerance: number;

  /**
   * توسيع السماحية بناءً على
   * تباين Samples.
   */
  adaptiveToleranceScale: number;

  /**
   * أقل Tolerance ممكنة للـLab.
   */
  minimumLabTolerance: number;

  /**
   * أقصى Tolerance ممكنة للـLab.
   */
  maximumLabTolerance: number;

  /**
   * أقل Tolerance ممكنة للـRGB.
   */
  minimumRgbTolerance: number;

  /**
   * أقصى Tolerance ممكنة للـRGB.
   */
  maximumRgbTolerance: number;

  /**
   * وزن مسافة Lab.
   */
  labDistanceWeight: number;

  /**
   * وزن مسافة RGB.
   */
  rgbDistanceWeight: number;

  /**
   * وزن اختلاف Luminance.
   */
  luminanceDistanceWeight: number;

  /**
   * وزن اختلاف Chroma.
   */
  chromaDistanceWeight: number;

  /**
   * وزن اختلاف Texture.
   */
  textureDistanceWeight: number;

  /**
   * وزن القرب المكاني من نموذج الخلفية.
   */
  spatialPriorWeight: number;

  /**
   * وزن كون Pixel متصلًا بحدود الصورة.
   */
  borderConnectivityWeight: number;

  /**
   * وزن Edge Barrier.
   */
  edgeBarrierWeight: number;

  /**
   * قيمة Background Confidence اللازمة
   * لقبول Pixel أثناء Region Growing.
   */
  regionGrowingConfidenceThreshold: number;

  /**
   * الحد الأدنى الأقل أثناء توسعات لاحقة.
   */
  regionGrowingRelaxedThreshold: number;

  /**
   * أقصى فرق بين Pixel ووالده في Flood Fill.
   */
  maximumNeighborLabDistance: number;

  /**
   * أقصى Gradient يمكن عبوره.
   */
  maximumCrossableGradient: number;

  /**
   * أقصى Edge Barrier يمكن عبوره.
   */
  maximumCrossableBarrier: number;

  /**
   * عدد جولات Region Growing.
   */
  regionGrowingPasses: number;

  /**
   * هل نستخدم 8-neighbour بدل 4-neighbour.
   */
  useEightConnectivity: boolean;

  /**
   * تفعيل اكتشاف الظلال.
   */
  detectShadows: boolean;

  /**
   * أقصى فرق Chroma يسمح باعتبار
   * اللون نسخة مظللة من الخلفية.
   */
  shadowMaximumChromaDifference: number;

  /**
   * أقل نسبة إضاءة للظل مقارنة بالخلفية.
   */
  shadowMinimumLuminanceRatio: number;

  /**
   * أقصى نسبة إضاءة للظل مقارنة بالخلفية.
   */
  shadowMaximumLuminanceRatio: number;

  /**
   * تفعيل اكتشاف Highlight/Reflection.
   */
  detectHighlights: boolean;

  /**
   * أقل Luminance لاعتبار Pixel Highlight.
   */
  highlightMinimumLuminance: number;

  /**
   * أقصى Chroma للـHighlight المحايد.
   */
  highlightMaximumChroma: number;

  /**
   * حماية الأجزاء التي تظهر فيها حواف قوية.
   */
  protectStrongEdges: boolean;

  /**
   * الحد الأدنى للحافة القوية.
   */
  strongEdgeThreshold: number;

  /**
   * توسيع Edge Barrier حول الحواف.
   */
  edgeBarrierExpansionRadius: number;

  /**
   * تخفيف Barrier داخل مناطق Mask المرتفعة.
   */
  subjectBarrierBoost: number;

  /**
   * وزن الماسك الحالي كدليل Foreground.
   */
  inputMaskForegroundWeight: number;

  /**
   * قيمة Mask التي تعني Foreground قويًا.
   */
  strongForegroundMaskThreshold: number;

  /**
   * قيمة Mask التي تعني Background قويًا.
   */
  strongBackgroundMaskThreshold: number;

  /**
   * هل نستخدم Bounds لتقليل احتمال
   * الخلفية قرب مركز الجسم.
   */
  useSubjectSpatialPrior: boolean;

  /**
   * قوة الـSpatial Prior داخل Bounds.
   */
  subjectSpatialPriorStrength: number;

  /**
   * توسيع Bounds قبل حساب الـSpatial Prior.
   */
  subjectBoundsExpansionRatio: number;

  /**
   * فاصل فحص الإلغاء.
   */
  cancellationCheckInterval: number;

  /**
   * الاحتفاظ بالـRejected Seeds في Diagnostics.
   */
  includeRejectedSeeds: boolean;

  /**
   * أقصى عدد Rejected Seeds يتم حفظه.
   */
  maximumRejectedSeeds: number;
};

/* =========================================================
 * Default configuration
 * ======================================================= */

export const DEFAULT_BACKGROUND_UNDERSTANDING_CONFIG_V3:
  Readonly<BackgroundUnderstandingConfigV3> = {
    maximumPixelCount:
      32_000_000,

    borderSampleStride:
      2,

    borderBandRatio:
      0.035,

    minimumBorderBandPixels:
      3,

    maximumBorderBandPixels:
      32,

    cornerRegionRatio:
      0.12,

    minimumSeedCount:
      24,

    maximumSeedCount:
      4096,

    maximumSeedMaskValue:
      0.16,

    hardSeedMaskLimit:
      0.34,

    maximumSeedGradient:
      0.24,

    maximumSeedTexture:
      0.22,

    minimumSourceAlpha:
      0.1,

    minimumSubjectDistanceRatio:
      0.012,

    textureRadius:
      1,

    gradientRadius:
      1,

    maximumColorClusters:
      5,

    minimumClusterSampleRatio:
      0.08,

    minimumClusterLabDistance:
      0.115,

    baseLabTolerance:
      0.13,

    baseRgbTolerance:
      0.14,

    baseLuminanceTolerance:
      0.16,

    baseChromaTolerance:
      0.13,

    baseTextureTolerance:
      0.18,

    adaptiveToleranceScale:
      2.1,

    minimumLabTolerance:
      0.07,

    maximumLabTolerance:
      0.32,

    minimumRgbTolerance:
      0.07,

    maximumRgbTolerance:
      0.3,

    labDistanceWeight:
      0.34,

    rgbDistanceWeight:
      0.19,

    luminanceDistanceWeight:
      0.16,

    chromaDistanceWeight:
      0.12,

    textureDistanceWeight:
      0.09,

    spatialPriorWeight:
      0.1,

    borderConnectivityWeight:
      0.22,

    edgeBarrierWeight:
      0.24,

    regionGrowingConfidenceThreshold:
      0.62,

    regionGrowingRelaxedThreshold:
      0.52,

    maximumNeighborLabDistance:
      0.13,

    maximumCrossableGradient:
      0.28,

    maximumCrossableBarrier:
      0.52,

    regionGrowingPasses:
      3,

    useEightConnectivity:
      true,

    detectShadows:
      true,

    shadowMaximumChromaDifference:
      0.09,

    shadowMinimumLuminanceRatio:
      0.42,

    shadowMaximumLuminanceRatio:
      0.94,

    detectHighlights:
      true,

    highlightMinimumLuminance:
      0.83,

    highlightMaximumChroma:
      0.11,

    protectStrongEdges:
      true,

    strongEdgeThreshold:
      0.32,

    edgeBarrierExpansionRadius:
      1,

    subjectBarrierBoost:
      0.4,

    inputMaskForegroundWeight:
      0.46,

    strongForegroundMaskThreshold:
      0.76,

    strongBackgroundMaskThreshold:
      0.16,

    useSubjectSpatialPrior:
      true,

    subjectSpatialPriorStrength:
      0.28,

    subjectBoundsExpansionRatio:
      0.08,

    cancellationCheckInterval:
      65_536,

    includeRejectedSeeds:
      false,

    maximumRejectedSeeds:
      512,
  };

/* =========================================================
 * Input
 * ======================================================= */

export type BackgroundUnderstandingInputV3 = {
  image: SegmentationRgbaImageSource;

  mask: SegmentationFloatMask;

  /**
   * Bounds اختيارية للجسم المتوقع.
   *
   * لو لم يتم تمريرها، يتم حسابها من الماسك.
   */
  subjectBounds?: SegmentationMaskBounds | null;

  config?: Partial<BackgroundUnderstandingConfigV3>;

  cancellationSignal?: SegmentationCancellationSignal;

  /**
   * معرف اختياري يستخدم داخل Diagnostics.
   */
  requestId?: string;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type BackgroundUnderstandingTimingsV3 = {
  validationMs: number;

  gradientMapMs: number;

  textureMapMs: number;

  seedExtractionMs: number;

  colorStatisticsMs: number;

  colorClusteringMs: number;

  modelBuildingMs: number;

  probabilityMapsMs: number;

  edgeBarrierMs: number;

  regionGrowingMs: number;

  floodFillMs: number;

  diagnosticsMs: number;

  totalMs: number;
};

export type BackgroundUnderstandingDiagnosticsV3 = {
  requestId: string | null;

  width: number;

  height: number;

  pixelCount: number;

  quality: BackgroundUnderstandingQualityV3;

  distribution: BackgroundUnderstandingDistributionV3;

  acceptedSeedCount: number;

  rejectedSeedCount: number;

  modelCount: number;

  clusterCount: number;

  borderBackgroundRatio: number;

  connectedBackgroundRatio: number;

  probableBackgroundRatio: number;

  probableForegroundRatio: number;

  uncertainRatio: number;

  strongEdgeRatio: number;

  meanBackgroundConfidence: number;

  meanForegroundEvidence: number;

  globalColorVariation: number;

  luminanceVariation: number;

  chromaVariation: number;

  detectedShadowModel: boolean;

  detectedHighlightModel: boolean;

  usedFallbackModel: boolean;

  warnings: readonly string[];

  timings: BackgroundUnderstandingTimingsV3;

  seeds: readonly BackgroundUnderstandingSeedV3[];

  rejectedSeeds:
    readonly BackgroundUnderstandingRejectedSeedV3[];
};

/* =========================================================
 * Final result
 * ======================================================= */

export type BackgroundUnderstandingResultV3 = {
  width: number;

  height: number;

  backgroundConfidence:
    BackgroundUnderstandingMapV3;

  foregroundEvidence:
    BackgroundUnderstandingMapV3;

  uncertainty:
    BackgroundUnderstandingMapV3;

  gradient:
    BackgroundUnderstandingMapV3;

  texture:
    BackgroundUnderstandingMapV3;

  edgeBarrier:
    BackgroundUnderstandingMapV3;

  connectedBackground:
    BackgroundUnderstandingByteMapV3;

  strongBackground:
    BackgroundUnderstandingByteMapV3;

  strongForeground:
    BackgroundUnderstandingByteMapV3;

  seeds:
    readonly BackgroundUnderstandingSeedV3[];

  colorStatistics:
    BackgroundUnderstandingColorStatisticsV3;

  models:
    readonly BackgroundUnderstandingColorModelV3[];

  diagnostics:
    BackgroundUnderstandingDiagnosticsV3;
};

/* =========================================================
 * Internal types
 * ======================================================= */

type MutableBackgroundUnderstandingTimingsV3 = {
  validationMs: number;

  gradientMapMs: number;

  textureMapMs: number;

  seedExtractionMs: number;

  colorStatisticsMs: number;

  colorClusteringMs: number;

  modelBuildingMs: number;

  probabilityMapsMs: number;

  edgeBarrierMs: number;

  regionGrowingMs: number;

  floodFillMs: number;

  diagnosticsMs: number;

  totalMs: number;
};

type BackgroundUnderstandingNormalizedConfigV3 =
  BackgroundUnderstandingConfigV3;

type BackgroundUnderstandingInternalMapsV3 = {
  gradient: Float32Array;

  texture: Float32Array;

  backgroundConfidence: Float32Array;

  foregroundEvidence: Float32Array;

  uncertainty: Float32Array;

  edgeBarrier: Float32Array;

  connectedBackground: Uint8Array;

  strongBackground: Uint8Array;

  strongForeground: Uint8Array;

  largestSubjectMap: Uint8Array;

  borderReachabilityMap: Float32Array;

  largeSurfaceMap: Float32Array;

  planarSurfaceMap: Float32Array;

  structuralLineMap: Float32Array;

  cornerEvidenceMap: Float32Array;

  backgroundContinuationMap: Float32Array;

  shadowConnectivityMap: Float32Array;

  illuminationGradientMap: Float32Array;

  foldLikelihoodMap: Float32Array;

  objectProtectionMap: Float32Array;

  multiEvidenceConsensusMap: Float32Array;
};

type BackgroundUnderstandingClusterAccumulatorV3 = {
  id: number;

  seedIds: number[];

  count: number;

  sumR: number;

  sumG: number;

  sumB: number;

  sumL: number;

  sumA: number;

  sumLabB: number;

  sumY: number;

  sumCb: number;

  sumCr: number;

  sumLuminance: number;

  sumChroma: number;

  sumTexture: number;

  sumX: number;

  sumYPosition: number;
};

type BackgroundUnderstandingSeedCollectionV3 = {
  accepted:
    BackgroundUnderstandingSeedV3[];

  rejected:
    BackgroundUnderstandingRejectedSeedV3[];
};

type BackgroundUnderstandingModelMatchV3 = {
  modelId: string;

  modelKind:
    BackgroundUnderstandingModelKindV3;

  confidence: number;

  labDistance: number;

  rgbDistance: number;

  luminanceDistance: number;

  chromaDistance: number;

  textureDistance: number;

  spatialPenalty: number;

  shadowMatch: boolean;

  highlightMatch: boolean;
};

/* =========================================================
 * Constants
 * ======================================================= */

const BACKGROUND_UNDERSTANDING_EPSILON_V3 =
  1e-8;

const BACKGROUND_UNDERSTANDING_RGB_TO_XYZ_MATRIX_V3 = {
  xr: 0.4124564,
  xg: 0.3575761,
  xb: 0.1804375,

  yr: 0.2126729,
  yg: 0.7151522,
  yb: 0.072175,

  zr: 0.0193339,
  zg: 0.119192,
  zb: 0.9503041,
} as const;

const BACKGROUND_UNDERSTANDING_REFERENCE_WHITE_V3 = {
  x: 0.95047,

  y: 1,

  z: 1.08883,
} as const;

const BACKGROUND_UNDERSTANDING_NEIGHBOURS_4_V3 =
  [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;

const BACKGROUND_UNDERSTANDING_NEIGHBOURS_8_V3 =
  [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;

/* =========================================================
 * General numeric helpers
 * ======================================================= */

function nowV3(): number {
  return Date.now();
}

function createEmptyTimingsV3():
  MutableBackgroundUnderstandingTimingsV3 {
  return {
    validationMs: 0,

    gradientMapMs: 0,

    textureMapMs: 0,

    seedExtractionMs: 0,

    colorStatisticsMs: 0,

    colorClusteringMs: 0,

    modelBuildingMs: 0,

    probabilityMapsMs: 0,

    edgeBarrierMs: 0,

    regionGrowingMs: 0,

    floodFillMs: 0,

    diagnosticsMs: 0,

    totalMs: 0,
  };
}

function clampIntegerV3(
  value: number,
  minimum: number,
  maximum: number
): number {
  const safeMinimum =
    Math.ceil(
      Math.min(
        minimum,
        maximum
      )
    );

  const safeMaximum =
    Math.floor(
      Math.max(
        minimum,
        maximum
      )
    );

  if (
    !Number.isFinite(value)
  ) {
    return safeMinimum;
  }

  return Math.min(
    safeMaximum,
    Math.max(
      safeMinimum,
      Math.round(value)
    )
  );
}

function safeSquareV3(
  value: number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return value * value;
}

function safeSqrtV3(
  value: number
): number {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 0;
  }

  return Math.sqrt(value);
}

function safeMeanV3(
  sum: number,
  count: number
): number {
  return safeSegmentationDivide(
    sum,
    count,
    0
  );
}

function safeStandardDeviationV3(
  sum: number,
  sumSquares: number,
  count: number
): number {
  if (
    count <= 0
  ) {
    return 0;
  }

  const mean =
    sum / count;

  const variance =
    Math.max(
      0,
      sumSquares / count -
        mean * mean
    );

  return Math.sqrt(
    variance
  );
}

function smoothStepV3(
  edge0: number,
  edge1: number,
  value: number
): number {
  if (
    edge0 === edge1
  ) {
    return value >= edge1
      ? 1
      : 0;
  }

  const normalized =
    clampUnitValue(
      (value - edge0) /
        (edge1 - edge0)
    );

  return (
    normalized *
    normalized *
    (3 - 2 * normalized)
  );
}

function inverseSmoothStepV3(
  edge0: number,
  edge1: number,
  value: number
): number {
  return (
    1 -
    smoothStepV3(
      edge0,
      edge1,
      value
    )
  );
}

function normalizeDistanceV3(
  distance: number,
  tolerance: number
): number {
  if (
    tolerance <=
    BACKGROUND_UNDERSTANDING_EPSILON_V3
  ) {
    return distance <= 0
      ? 0
      : 1;
  }

  return clampUnitValue(
    distance / tolerance
  );
}

function confidenceFromDistanceV3(
  distance: number,
  tolerance: number
): number {
  const normalized =
    normalizeDistanceV3(
      distance,
      tolerance
    );

  return (
    1 -
    smoothStepV3(
      0,
      1,
      normalized
    )
  );
}

function weightedAverageV3(
  values: readonly number[],
  weights: readonly number[],
  fallback = 0
): number {
  const length =
    Math.min(
      values.length,
      weights.length
    );

  let weightedSum =
    0;

  let weightSum =
    0;

  for (
    let index = 0;
    index < length;
    index += 1
  ) {
    const value =
      values[index];

    const weight =
      weights[index];

    if (
      !Number.isFinite(value) ||
      !Number.isFinite(weight) ||
      weight <= 0
    ) {
      continue;
    }

    weightedSum +=
      value * weight;

    weightSum +=
      weight;
  }

  if (
    weightSum <=
    BACKGROUND_UNDERSTANDING_EPSILON_V3
  ) {
    return fallback;
  }

  return (
    weightedSum /
    weightSum
  );
}

function getPixelIndexV3(
  x: number,
  y: number,
  width: number
): number {
  return (
    y * width +
    x
  );
}

function getRgbaIndexV3(
  pixelIndex: number
): number {
  return (
    pixelIndex * 4
  );
}

function isInsideImageV3(
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height
  );
}

function getDistanceToBorderPixelsV3(
  x: number,
  y: number,
  width: number,
  height: number
): number {
  return Math.min(
    x,
    y,
    width - 1 - x,
    height - 1 - y
  );
}

function getDistanceToBorderRatioV3(
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const maximumDistance =
    Math.max(
      1,
      Math.min(
        width,
        height
      ) * 0.5
    );

  return clampUnitValue(
    getDistanceToBorderPixelsV3(
      x,
      y,
      width,
      height
    ) /
      maximumDistance
  );
}

function getNormalizedDistanceV3(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  height: number
): number {
  const dx =
    safeSegmentationDivide(
      x1 - x2,
      Math.max(
        1,
        width - 1
      ),
      0
    );

  const dy =
    safeSegmentationDivide(
      y1 - y2,
      Math.max(
        1,
        height - 1
      ),
      0
    );

  return clampUnitValue(
    Math.sqrt(
      dx * dx +
      dy * dy
    ) /
      Math.SQRT2
  );
}

function checkCancellationV3(
  signal:
    | SegmentationCancellationSignal
    | undefined,
  index: number,
  interval: number
): void {
  if (!signal) {
    return;
  }

  if (
    index % interval === 0
  ) {
    signal.throwIfCancelled();
  }
}

/* =========================================================
 * Configuration normalization
 * ======================================================= */

function normalizeConfigV3(
  input:
    | Partial<BackgroundUnderstandingConfigV3>
    | undefined
): BackgroundUnderstandingNormalizedConfigV3 {
  const defaults =
    DEFAULT_BACKGROUND_UNDERSTANDING_CONFIG_V3;

  const source =
    input ?? {};

  return {
    maximumPixelCount:
      clampIntegerV3(
        source.maximumPixelCount ??
          defaults.maximumPixelCount,
        1,
        100_000_000
      ),

    borderSampleStride:
      clampIntegerV3(
        source.borderSampleStride ??
          defaults.borderSampleStride,
        1,
        32
      ),

    borderBandRatio:
      clampSegmentationValue(
        source.borderBandRatio ??
          defaults.borderBandRatio,
        0.001,
        0.25
      ),

    minimumBorderBandPixels:
      clampIntegerV3(
        source.minimumBorderBandPixels ??
          defaults.minimumBorderBandPixels,
        1,
        128
      ),

    maximumBorderBandPixels:
      clampIntegerV3(
        source.maximumBorderBandPixels ??
          defaults.maximumBorderBandPixels,
        1,
        512
      ),

    cornerRegionRatio:
      clampSegmentationValue(
        source.cornerRegionRatio ??
          defaults.cornerRegionRatio,
        0.02,
        0.4
      ),

    minimumSeedCount:
      clampIntegerV3(
        source.minimumSeedCount ??
          defaults.minimumSeedCount,
        4,
        100_000
      ),

    maximumSeedCount:
      clampIntegerV3(
        source.maximumSeedCount ??
          defaults.maximumSeedCount,
        16,
        100_000
      ),

    maximumSeedMaskValue:
      clampUnitValue(
        source.maximumSeedMaskValue ??
          defaults.maximumSeedMaskValue
      ),

    hardSeedMaskLimit:
      clampUnitValue(
        source.hardSeedMaskLimit ??
          defaults.hardSeedMaskLimit
      ),

    maximumSeedGradient:
      clampUnitValue(
        source.maximumSeedGradient ??
          defaults.maximumSeedGradient
      ),

    maximumSeedTexture:
      clampUnitValue(
        source.maximumSeedTexture ??
          defaults.maximumSeedTexture
      ),

    minimumSourceAlpha:
      clampUnitValue(
        source.minimumSourceAlpha ??
          defaults.minimumSourceAlpha
      ),

    minimumSubjectDistanceRatio:
      clampUnitValue(
        source.minimumSubjectDistanceRatio ??
          defaults.minimumSubjectDistanceRatio
      ),

    textureRadius:
      clampIntegerV3(
        source.textureRadius ??
          defaults.textureRadius,
        1,
        8
      ),

    gradientRadius:
      clampIntegerV3(
        source.gradientRadius ??
          defaults.gradientRadius,
        1,
        8
      ),

    maximumColorClusters:
      clampIntegerV3(
        source.maximumColorClusters ??
          defaults.maximumColorClusters,
        1,
        12
      ),

    minimumClusterSampleRatio:
      clampUnitValue(
        source.minimumClusterSampleRatio ??
          defaults.minimumClusterSampleRatio
      ),

    minimumClusterLabDistance:
      clampUnitValue(
        source.minimumClusterLabDistance ??
          defaults.minimumClusterLabDistance
      ),

    baseLabTolerance:
      clampUnitValue(
        source.baseLabTolerance ??
          defaults.baseLabTolerance
      ),

    baseRgbTolerance:
      clampUnitValue(
        source.baseRgbTolerance ??
          defaults.baseRgbTolerance
      ),

    baseLuminanceTolerance:
      clampUnitValue(
        source.baseLuminanceTolerance ??
          defaults.baseLuminanceTolerance
      ),

    baseChromaTolerance:
      clampUnitValue(
        source.baseChromaTolerance ??
          defaults.baseChromaTolerance
      ),

    baseTextureTolerance:
      clampUnitValue(
        source.baseTextureTolerance ??
          defaults.baseTextureTolerance
      ),

    adaptiveToleranceScale:
      clampSegmentationValue(
        source.adaptiveToleranceScale ??
          defaults.adaptiveToleranceScale,
        0,
        8
      ),

    minimumLabTolerance:
      clampUnitValue(
        source.minimumLabTolerance ??
          defaults.minimumLabTolerance
      ),

    maximumLabTolerance:
      clampUnitValue(
        source.maximumLabTolerance ??
          defaults.maximumLabTolerance
      ),

    minimumRgbTolerance:
      clampUnitValue(
        source.minimumRgbTolerance ??
          defaults.minimumRgbTolerance
      ),

    maximumRgbTolerance:
      clampUnitValue(
        source.maximumRgbTolerance ??
          defaults.maximumRgbTolerance
      ),

    labDistanceWeight:
      clampUnitValue(
        source.labDistanceWeight ??
          defaults.labDistanceWeight
      ),

    rgbDistanceWeight:
      clampUnitValue(
        source.rgbDistanceWeight ??
          defaults.rgbDistanceWeight
      ),

    luminanceDistanceWeight:
      clampUnitValue(
        source.luminanceDistanceWeight ??
          defaults.luminanceDistanceWeight
      ),

    chromaDistanceWeight:
      clampUnitValue(
        source.chromaDistanceWeight ??
          defaults.chromaDistanceWeight
      ),

    textureDistanceWeight:
      clampUnitValue(
        source.textureDistanceWeight ??
          defaults.textureDistanceWeight
      ),

    spatialPriorWeight:
      clampUnitValue(
        source.spatialPriorWeight ??
          defaults.spatialPriorWeight
      ),

    borderConnectivityWeight:
      clampUnitValue(
        source.borderConnectivityWeight ??
          defaults.borderConnectivityWeight
      ),

    edgeBarrierWeight:
      clampUnitValue(
        source.edgeBarrierWeight ??
          defaults.edgeBarrierWeight
      ),

    regionGrowingConfidenceThreshold:
      clampUnitValue(
        source.regionGrowingConfidenceThreshold ??
          defaults.regionGrowingConfidenceThreshold
      ),

    regionGrowingRelaxedThreshold:
      clampUnitValue(
        source.regionGrowingRelaxedThreshold ??
          defaults.regionGrowingRelaxedThreshold
      ),

    maximumNeighborLabDistance:
      clampUnitValue(
        source.maximumNeighborLabDistance ??
          defaults.maximumNeighborLabDistance
      ),

    maximumCrossableGradient:
      clampUnitValue(
        source.maximumCrossableGradient ??
          defaults.maximumCrossableGradient
      ),

    maximumCrossableBarrier:
      clampUnitValue(
        source.maximumCrossableBarrier ??
          defaults.maximumCrossableBarrier
      ),

    regionGrowingPasses:
      clampIntegerV3(
        source.regionGrowingPasses ??
          defaults.regionGrowingPasses,
        1,
        12
      ),

    useEightConnectivity:
      source.useEightConnectivity ??
      defaults.useEightConnectivity,

    detectShadows:
      source.detectShadows ??
      defaults.detectShadows,

    shadowMaximumChromaDifference:
      clampUnitValue(
        source.shadowMaximumChromaDifference ??
          defaults.shadowMaximumChromaDifference
      ),

    shadowMinimumLuminanceRatio:
      clampUnitValue(
        source.shadowMinimumLuminanceRatio ??
          defaults.shadowMinimumLuminanceRatio
      ),

    shadowMaximumLuminanceRatio:
      clampUnitValue(
        source.shadowMaximumLuminanceRatio ??
          defaults.shadowMaximumLuminanceRatio
      ),

    detectHighlights:
      source.detectHighlights ??
      defaults.detectHighlights,

    highlightMinimumLuminance:
      clampUnitValue(
        source.highlightMinimumLuminance ??
          defaults.highlightMinimumLuminance
      ),

    highlightMaximumChroma:
      clampUnitValue(
        source.highlightMaximumChroma ??
          defaults.highlightMaximumChroma
      ),

    protectStrongEdges:
      source.protectStrongEdges ??
      defaults.protectStrongEdges,

    strongEdgeThreshold:
      clampUnitValue(
        source.strongEdgeThreshold ??
          defaults.strongEdgeThreshold
      ),

    edgeBarrierExpansionRadius:
      clampIntegerV3(
        source.edgeBarrierExpansionRadius ??
          defaults.edgeBarrierExpansionRadius,
        0,
        8
      ),

    subjectBarrierBoost:
      clampUnitValue(
        source.subjectBarrierBoost ??
          defaults.subjectBarrierBoost
      ),

    inputMaskForegroundWeight:
      clampUnitValue(
        source.inputMaskForegroundWeight ??
          defaults.inputMaskForegroundWeight
      ),

    strongForegroundMaskThreshold:
      clampUnitValue(
        source.strongForegroundMaskThreshold ??
          defaults.strongForegroundMaskThreshold
      ),

    strongBackgroundMaskThreshold:
      clampUnitValue(
        source.strongBackgroundMaskThreshold ??
          defaults.strongBackgroundMaskThreshold
      ),

    useSubjectSpatialPrior:
      source.useSubjectSpatialPrior ??
      defaults.useSubjectSpatialPrior,

    subjectSpatialPriorStrength:
      clampUnitValue(
        source.subjectSpatialPriorStrength ??
          defaults.subjectSpatialPriorStrength
      ),

    subjectBoundsExpansionRatio:
      clampUnitValue(
        source.subjectBoundsExpansionRatio ??
          defaults.subjectBoundsExpansionRatio
      ),

    cancellationCheckInterval:
      clampIntegerV3(
        source.cancellationCheckInterval ??
          defaults.cancellationCheckInterval,
        1,
        10_000_000
      ),

    includeRejectedSeeds:
      source.includeRejectedSeeds ??
      defaults.includeRejectedSeeds,

    maximumRejectedSeeds:
      clampIntegerV3(
        source.maximumRejectedSeeds ??
          defaults.maximumRejectedSeeds,
        0,
        100_000
      ),
  };
}

/* =========================================================
 * Input validation
 * ======================================================= */

function validateInputV3(
  input: BackgroundUnderstandingInputV3,
  config: BackgroundUnderstandingNormalizedConfigV3
): void {
  if (
    !input ||
    typeof input !== 'object'
  ) {
    throw new Error(
      'BackgroundUnderstandingV3 input is required.'
    );
  }

  if (
    !isSegmentationRgbaImageSource(
      input.image
    )
  ) {
    throw new Error(
      'BackgroundUnderstandingV3 requires a valid RGBA image.'
    );
  }

  if (
    !isValidFloatMask(
      input.mask
    )
  ) {
    throw new Error(
      'BackgroundUnderstandingV3 requires a valid Float32 mask.'
    );
  }

  if (
    input.image.width !==
      input.mask.width ||
    input.image.height !==
      input.mask.height
  ) {
    throw new Error(
      [
        'BackgroundUnderstandingV3 image and mask dimensions must match.',
        `Image: ${input.image.width}x${input.image.height}.`,
        `Mask: ${input.mask.width}x${input.mask.height}.`,
      ].join(' ')
    );
  }

  const pixelCount =
    input.image.width *
    input.image.height;

  if (
    !Number.isSafeInteger(
      pixelCount
    ) ||
    pixelCount <= 0
  ) {
    throw new Error(
      'BackgroundUnderstandingV3 received an invalid image size.'
    );
  }

  if (
    pixelCount >
    config.maximumPixelCount
  ) {
    throw new Error(
      [
        'BackgroundUnderstandingV3 image exceeds the maximum pixel count.',
        `Received: ${pixelCount}.`,
        `Maximum: ${config.maximumPixelCount}.`,
      ].join(' ')
    );
  }

  if (
    config.maximumSeedMaskValue >
    config.hardSeedMaskLimit
  ) {
    throw new Error(
      'maximumSeedMaskValue cannot exceed hardSeedMaskLimit.'
    );
  }

  if (
    config.minimumLabTolerance >
    config.maximumLabTolerance
  ) {
    throw new Error(
      'minimumLabTolerance cannot exceed maximumLabTolerance.'
    );
  }

  if (
    config.minimumRgbTolerance >
    config.maximumRgbTolerance
  ) {
    throw new Error(
      'minimumRgbTolerance cannot exceed maximumRgbTolerance.'
    );
  }

  if (
    config.shadowMinimumLuminanceRatio >
    config.shadowMaximumLuminanceRatio
  ) {
    throw new Error(
      'shadowMinimumLuminanceRatio cannot exceed shadowMaximumLuminanceRatio.'
    );
  }

  input.cancellationSignal
    ?.throwIfCancelled();
}

/* =========================================================
 * Color conversion helpers
 * ======================================================= */

function srgbChannelToLinearV3(
  value: number
): number {
  const normalized =
    clampUnitValue(value);

  if (
    normalized <= 0.04045
  ) {
    return (
      normalized /
      12.92
    );
  }

  return Math.pow(
    (normalized + 0.055) /
      1.055,
    2.4
  );
}

function xyzPivotV3(
  value: number
): number {
  const delta =
    6 / 29;

  const threshold =
    delta * delta * delta;

  if (
    value > threshold
  ) {
    return Math.cbrt(value);
  }

  return (
    value /
      (3 * delta * delta) +
    4 / 29
  );
}

function rgbToLabV3(
  rgb: BackgroundUnderstandingRgbColorV3
): BackgroundUnderstandingLabColorV3 {
  const linearR =
    srgbChannelToLinearV3(
      rgb.r
    );

  const linearG =
    srgbChannelToLinearV3(
      rgb.g
    );

  const linearB =
    srgbChannelToLinearV3(
      rgb.b
    );

  const matrix =
    BACKGROUND_UNDERSTANDING_RGB_TO_XYZ_MATRIX_V3;

  const x =
    linearR * matrix.xr +
    linearG * matrix.xg +
    linearB * matrix.xb;

  const y =
    linearR * matrix.yr +
    linearG * matrix.yg +
    linearB * matrix.yb;

  const z =
    linearR * matrix.zr +
    linearG * matrix.zg +
    linearB * matrix.zb;

  const white =
    BACKGROUND_UNDERSTANDING_REFERENCE_WHITE_V3;

  const fx =
    xyzPivotV3(
      x / white.x
    );

  const fy =
    xyzPivotV3(
      y / white.y
    );

  const fz =
    xyzPivotV3(
      z / white.z
    );

  const standardL =
    116 * fy - 16;

  const standardA =
    500 * (fx - fy);

  const standardB =
    200 * (fy - fz);

  return {
    l:
      clampUnitValue(
        standardL /
          100
      ),

    a:
      clampSegmentationValue(
        standardA /
          256 +
          0.5,
        0,
        1
      ),

    b:
      clampSegmentationValue(
        standardB /
          256 +
          0.5,
        0,
        1
      ),
  };
}

function rgbToYcbcrV3(
  rgb: BackgroundUnderstandingRgbColorV3
): BackgroundUnderstandingYcbcrColorV3 {
  const y =
    0.299 * rgb.r +
    0.587 * rgb.g +
    0.114 * rgb.b;

  const cb =
    0.5 +
    (
      -0.168736 * rgb.r -
      0.331264 * rgb.g +
      0.5 * rgb.b
    );

  const cr =
    0.5 +
    (
      0.5 * rgb.r -
      0.418688 * rgb.g -
      0.081312 * rgb.b
    );

  return {
    y:
      clampUnitValue(y),

    cb:
      clampUnitValue(cb),

    cr:
      clampUnitValue(cr),
  };
}

function calculateLuminanceV3(
  rgb: BackgroundUnderstandingRgbColorV3
): number {
  return clampUnitValue(
    0.2126 * rgb.r +
    0.7152 * rgb.g +
    0.0722 * rgb.b
  );
}

function calculateChromaV3(
  rgb: BackgroundUnderstandingRgbColorV3
): number {
  const maximum =
    Math.max(
      rgb.r,
      rgb.g,
      rgb.b
    );

  const minimum =
    Math.min(
      rgb.r,
      rgb.g,
      rgb.b
    );

  return clampUnitValue(
    maximum - minimum
  );
}

function calculateSaturationV3(
  rgb: BackgroundUnderstandingRgbColorV3
): number {
  const maximum =
    Math.max(
      rgb.r,
      rgb.g,
      rgb.b
    );

  const minimum =
    Math.min(
      rgb.r,
      rgb.g,
      rgb.b
    );

  if (
    maximum <=
    BACKGROUND_UNDERSTANDING_EPSILON_V3
  ) {
    return 0;
  }

  return clampUnitValue(
    (maximum - minimum) /
      maximum
  );
}

function createColorSampleV3(
  rByte: number,
  gByte: number,
  bByte: number
): BackgroundUnderstandingColorSampleV3 {
  const rgb: BackgroundUnderstandingRgbColorV3 = {
    r:
      clampSegmentationValue(
        rByte,
        0,
        255
      ) / 255,

    g:
      clampSegmentationValue(
        gByte,
        0,
        255
      ) / 255,

    b:
      clampSegmentationValue(
        bByte,
        0,
        255
      ) / 255,
  };

  return {
    rgb,

    lab:
      rgbToLabV3(rgb),

    ycbcr:
      rgbToYcbcrV3(rgb),

    luminance:
      calculateLuminanceV3(
        rgb
      ),

    chroma:
      calculateChromaV3(
        rgb
      ),

    saturation:
      calculateSaturationV3(
        rgb
      ),
  };
}

function readColorSampleAtPixelV3(
  rgba: Uint8Array,
  pixelIndex: number
): BackgroundUnderstandingColorSampleV3 {
  const rgbaIndex =
    getRgbaIndexV3(
      pixelIndex
    );

  return createColorSampleV3(
    rgba[rgbaIndex],
    rgba[rgbaIndex + 1],
    rgba[rgbaIndex + 2]
  );
}

function readSourceAlphaV3(
  rgba: Uint8Array,
  pixelIndex: number
): number {
  const rgbaIndex =
    getRgbaIndexV3(
      pixelIndex
    );

  return (
    rgba[
      rgbaIndex + 3
    ] / 255
  );
}

/* =========================================================
 * Color distance helpers
 * ======================================================= */

function calculateRgbDistanceV3(
  first:
    BackgroundUnderstandingRgbColorV3,
  second:
    BackgroundUnderstandingRgbColorV3
): number {
  const dr =
    first.r - second.r;

  const dg =
    first.g - second.g;

  const db =
    first.b - second.b;

  return clampUnitValue(
    Math.sqrt(
      dr * dr +
      dg * dg +
      db * db
    ) /
      Math.sqrt(3)
  );
}

function calculateLabDistanceV3(
  first:
    BackgroundUnderstandingLabColorV3,
  second:
    BackgroundUnderstandingLabColorV3
): number {
  const dl =
    first.l - second.l;

  const da =
    first.a - second.a;

  const db =
    first.b - second.b;

  return clampUnitValue(
    Math.sqrt(
      dl * dl +
      da * da +
      db * db
    ) /
      Math.sqrt(3)
  );
}

function calculateYcbcrDistanceV3(
  first:
    BackgroundUnderstandingYcbcrColorV3,
  second:
    BackgroundUnderstandingYcbcrColorV3
): number {
  const dy =
    first.y - second.y;

  const dcb =
    first.cb - second.cb;

  const dcr =
    first.cr - second.cr;

  return clampUnitValue(
    Math.sqrt(
      dy * dy +
      dcb * dcb +
      dcr * dcr
    ) /
      Math.sqrt(3)
  );
}

function calculateChromaDistanceV3(
  first:
    BackgroundUnderstandingColorSampleV3,
  second:
    BackgroundUnderstandingColorSampleV3
): number {
  const ycbcrDistance =
    Math.sqrt(
      safeSquareV3(
        first.ycbcr.cb -
          second.ycbcr.cb
      ) +
      safeSquareV3(
        first.ycbcr.cr -
          second.ycbcr.cr
      )
    ) /
    Math.SQRT2;

  const scalarDistance =
    Math.abs(
      first.chroma -
      second.chroma
    );

  return clampUnitValue(
    (
      ycbcrDistance +
      scalarDistance
    ) * 0.5
  );
}

/* =========================================================
 * Empty factories
 * ======================================================= */

function createZeroRgbV3():
  BackgroundUnderstandingRgbColorV3 {
  return {
    r: 0,

    g: 0,

    b: 0,
  };
}

function createZeroLabV3():
  BackgroundUnderstandingLabColorV3 {
  return {
    l: 0,

    a: 0,

    b: 0,
  };
}

function createZeroYcbcrV3():
  BackgroundUnderstandingYcbcrColorV3 {
  return {
    y: 0,

    cb: 0,

    cr: 0,
  };
}

function createEmptyColorStatisticsV3():
  BackgroundUnderstandingColorStatisticsV3 {
  return {
    count: 0,

    meanRgb:
      createZeroRgbV3(),

    meanLab:
      createZeroLabV3(),

    meanYcbcr:
      createZeroYcbcrV3(),

    minimumRgb:
      createZeroRgbV3(),

    maximumRgb:
      createZeroRgbV3(),

    standardDeviationRgb:
      createZeroRgbV3(),

    standardDeviationLab:
      createZeroLabV3(),

    meanLuminance: 0,

    luminanceStandardDeviation: 0,

    meanChroma: 0,

    chromaStandardDeviation: 0,

    meanSaturation: 0,

    saturationStandardDeviation: 0,
  };
}

function createInternalMapsV3(
  pixelCount: number
): BackgroundUnderstandingInternalMapsV3 {
  return {
    gradient:
      new Float32Array(
        pixelCount
      ),

    texture:
      new Float32Array(
        pixelCount
      ),

    backgroundConfidence:
      new Float32Array(
        pixelCount
      ),

    foregroundEvidence:
      new Float32Array(
        pixelCount
      ),

    uncertainty:
      new Float32Array(
        pixelCount
      ),

    edgeBarrier:
      new Float32Array(
        pixelCount
      ),

    connectedBackground:
      new Uint8Array(
        pixelCount
      ),

    strongBackground:
      new Uint8Array(
        pixelCount
      ),

    strongForeground:
      new Uint8Array(
        pixelCount
      ),

    largestSubjectMap:
      new Uint8Array(
        pixelCount
      ),

    borderReachabilityMap:
      new Float32Array(
        pixelCount
      ),

    largeSurfaceMap:
      new Float32Array(
        pixelCount
      ),

    planarSurfaceMap:
      new Float32Array(
        pixelCount
      ),

    structuralLineMap:
      new Float32Array(
        pixelCount
      ),

    cornerEvidenceMap:
      new Float32Array(
        pixelCount
      ),

    backgroundContinuationMap:
      new Float32Array(
        pixelCount
      ),

    shadowConnectivityMap:
      new Float32Array(
        pixelCount
      ),

    illuminationGradientMap:
      new Float32Array(
        pixelCount
      ),

    foldLikelihoodMap:
      new Float32Array(
        pixelCount
      ),

    objectProtectionMap:
      new Float32Array(
        pixelCount
      ),

    multiEvidenceConsensusMap:
      new Float32Array(
        pixelCount
      ),
  };
}

/* =========================================================
 * Subject bounds helpers
 * ======================================================= */

function calculateMaskBoundsV3(
  mask: SegmentationFloatMask,
  threshold: number
): SegmentationMaskBounds | null {
  const width =
    mask.width;

  const height =
    mask.height;

  let minimumX =
    width;

  let minimumY =
    height;

  let maximumX =
    -1;

  let maximumY =
    -1;

  let area =
    0;

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y * width;

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const index =
        rowOffset + x;

      if (
        mask.data[index] <
        threshold
      ) {
        continue;
      }

      area += 1;

      if (
        x < minimumX
      ) {
        minimumX = x;
      }

      if (
        x > maximumX
      ) {
        maximumX = x;
      }

      if (
        y < minimumY
      ) {
        minimumY = y;
      }

      if (
        y > maximumY
      ) {
        maximumY = y;
      }
    }
  }

  if (
    area <= 0 ||
    maximumX < minimumX ||
    maximumY < minimumY
  ) {
    return null;
  }

  const boundsWidth =
    maximumX -
    minimumX +
    1;

  const boundsHeight =
    maximumY -
    minimumY +
    1;

  return {
    x:
      minimumX,

    y:
      minimumY,

    width:
      boundsWidth,

    height:
      boundsHeight,

    x2:
      maximumX,

    y2:
      maximumY,

    area,

    areaRatio:
      safeSegmentationDivide(
        area,
        width * height,
        0
      ),
  };
}

function expandBoundsV3(
  bounds:
    SegmentationMaskBounds,
  width: number,
  height: number,
  expansionRatio: number
): SegmentationMaskBounds {
  const expansionX =
    Math.round(
      bounds.width *
      expansionRatio
    );

  const expansionY =
    Math.round(
      bounds.height *
      expansionRatio
    );

  const x =
    Math.max(
      0,
      bounds.x -
      expansionX
    );

  const y =
    Math.max(
      0,
      bounds.y -
      expansionY
    );

  const x2 =
    Math.min(
      width - 1,
      bounds.x2 +
      expansionX
    );

  const y2 =
    Math.min(
      height - 1,
      bounds.y2 +
      expansionY
    );

  const expandedWidth =
    x2 - x + 1;

  const expandedHeight =
    y2 - y + 1;

  const area =
    expandedWidth *
    expandedHeight;

  return {
    x,

    y,

    width:
      expandedWidth,

    height:
      expandedHeight,

    x2,

    y2,

    area,

    areaRatio:
      safeSegmentationDivide(
        area,
        width * height,
        0
      ),
  };
}

function getDistanceToBoundsV3(
  x: number,
  y: number,
  bounds:
    SegmentationMaskBounds
): number {
  const dx =
    x < bounds.x
      ? bounds.x - x
      : x > bounds.x2
        ? x - bounds.x2
        : 0;

  const dy =
    y < bounds.y
      ? bounds.y - y
      : y > bounds.y2
        ? y - bounds.y2
        : 0;

  return Math.sqrt(
    dx * dx +
    dy * dy
  );
}

function isInsideBoundsV3(
  x: number,
  y: number,
  bounds:
    SegmentationMaskBounds
): boolean {
  return (
    x >= bounds.x &&
    x <= bounds.x2 &&
    y >= bounds.y &&
    y <= bounds.y2
  );
}

/* =========================================================
 * Local image measurements
 * ======================================================= */

function calculatePixelLuminanceAtV3(
  rgba: Uint8Array,
  pixelIndex: number
): number {
  const rgbaIndex =
    pixelIndex * 4;

  return clampUnitValue(
    (
      0.2126 *
        rgba[rgbaIndex] +
      0.7152 *
        rgba[rgbaIndex + 1] +
      0.0722 *
        rgba[rgbaIndex + 2]
    ) / 255
  );
}

function calculateGradientAtV3(
  rgba: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): number {
  const leftX =
    Math.max(
      0,
      x - radius
    );

  const rightX =
    Math.min(
      width - 1,
      x + radius
    );

  const topY =
    Math.max(
      0,
      y - radius
    );

  const bottomY =
    Math.min(
      height - 1,
      y + radius
    );

  const left =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        leftX,
        y,
        width
      )
    );

  const right =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        rightX,
        y,
        width
      )
    );

  const top =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        x,
        topY,
        width
      )
    );

  const bottom =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        x,
        bottomY,
        width
      )
    );

  const diagonalTopLeft =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        leftX,
        topY,
        width
      )
    );

  const diagonalBottomRight =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        rightX,
        bottomY,
        width
      )
    );

  const diagonalTopRight =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        rightX,
        topY,
        width
      )
    );

  const diagonalBottomLeft =
    calculatePixelLuminanceAtV3(
      rgba,
      getPixelIndexV3(
        leftX,
        bottomY,
        width
      )
    );

  const horizontal =
    Math.abs(
      right - left
    );

  const vertical =
    Math.abs(
      bottom - top
    );

  const diagonalA =
    Math.abs(
      diagonalBottomRight -
      diagonalTopLeft
    );

  const diagonalB =
    Math.abs(
      diagonalBottomLeft -
      diagonalTopRight
    );

  return clampUnitValue(
    Math.sqrt(
      horizontal * horizontal +
      vertical * vertical +
      0.5 *
        diagonalA *
        diagonalA +
      0.5 *
        diagonalB *
        diagonalB
    ) /
      Math.sqrt(3)
  );
}

function calculateLocalTextureAtV3(
  rgba: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): number {
  let sum =
    0;

  let sumSquares =
    0;

  let count =
    0;

  const minimumX =
    Math.max(
      0,
      x - radius
    );

  const maximumX =
    Math.min(
      width - 1,
      x + radius
    );

  const minimumY =
    Math.max(
      0,
      y - radius
    );

  const maximumY =
    Math.min(
      height - 1,
      y + radius
    );

  for (
    let sampleY =
      minimumY;
    sampleY <=
      maximumY;
    sampleY += 1
  ) {
    const rowOffset =
      sampleY *
      width;

    for (
      let sampleX =
        minimumX;
      sampleX <=
        maximumX;
      sampleX += 1
    ) {
      const luminance =
        calculatePixelLuminanceAtV3(
          rgba,
          rowOffset +
            sampleX
        );

      sum +=
        luminance;

      sumSquares +=
        luminance *
        luminance;

      count += 1;
    }
  }

  return clampUnitValue(
    safeStandardDeviationV3(
      sum,
      sumSquares,
      count
    ) * 4
  );
}

/* =========================================================
 * Map generation
 * ======================================================= */

function buildGradientMapV3(
  image:
    SegmentationRgbaImageSource,
  output:
    Float32Array,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): void {
  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      index,
      config.cancellationCheckInterval
    );

    const x =
      index % width;

    const y =
      Math.floor(
        index / width
      );

    output[index] =
      calculateGradientAtV3(
        image.rgba,
        x,
        y,
        width,
        height,
        config.gradientRadius
      );
  }
}

function buildTextureMapV3(
  image:
    SegmentationRgbaImageSource,
  output:
    Float32Array,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): void {
  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      index,
      config.cancellationCheckInterval
    );

    const x =
      index % width;

    const y =
      Math.floor(
        index / width
      );

    output[index] =
      calculateLocalTextureAtV3(
        image.rgba,
        x,
        y,
        width,
        height,
        config.textureRadius
      );
  }
}

/* =========================================================
 * Statistics helpers
 * ======================================================= */

function calculateColorStatisticsV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[]
): BackgroundUnderstandingColorStatisticsV3 {
  if (
    seeds.length === 0
  ) {
    return createEmptyColorStatisticsV3();
  }

  let sumR =
    0;

  let sumG =
    0;

  let sumB =
    0;

  let sumR2 =
    0;

  let sumG2 =
    0;

  let sumB2 =
    0;

  let sumL =
    0;

  let sumA =
    0;

  let sumLabB =
    0;

  let sumL2 =
    0;

  let sumA2 =
    0;

  let sumLabB2 =
    0;

  let sumY =
    0;

  let sumCb =
    0;

  let sumCr =
    0;

  let sumLuminance =
    0;

  let sumLuminance2 =
    0;

  let sumChroma =
    0;

  let sumChroma2 =
    0;

  let sumSaturation =
    0;

  let sumSaturation2 =
    0;

  let minimumR =
    1;

  let minimumG =
    1;

  let minimumB =
    1;

  let maximumR =
    0;

  let maximumG =
    0;

  let maximumB =
    0;

  for (
    const seed of seeds
  ) {
    const rgb =
      seed.color.rgb;

    const lab =
      seed.color.lab;

    const ycbcr =
      seed.color.ycbcr;

    sumR +=
      rgb.r;

    sumG +=
      rgb.g;

    sumB +=
      rgb.b;

    sumR2 +=
      rgb.r *
      rgb.r;

    sumG2 +=
      rgb.g *
      rgb.g;

    sumB2 +=
      rgb.b *
      rgb.b;

    sumL +=
      lab.l;

    sumA +=
      lab.a;

    sumLabB +=
      lab.b;

    sumL2 +=
      lab.l *
      lab.l;

    sumA2 +=
      lab.a *
      lab.a;

    sumLabB2 +=
      lab.b *
      lab.b;

    sumY +=
      ycbcr.y;

    sumCb +=
      ycbcr.cb;

    sumCr +=
      ycbcr.cr;

    sumLuminance +=
      seed.color.luminance;

    sumLuminance2 +=
      seed.color.luminance *
      seed.color.luminance;

    sumChroma +=
      seed.color.chroma;

    sumChroma2 +=
      seed.color.chroma *
      seed.color.chroma;

    sumSaturation +=
      seed.color.saturation;

    sumSaturation2 +=
      seed.color.saturation *
      seed.color.saturation;

    minimumR =
      Math.min(
        minimumR,
        rgb.r
      );

    minimumG =
      Math.min(
        minimumG,
        rgb.g
      );

    minimumB =
      Math.min(
        minimumB,
        rgb.b
      );

    maximumR =
      Math.max(
        maximumR,
        rgb.r
      );

    maximumG =
      Math.max(
        maximumG,
        rgb.g
      );

    maximumB =
      Math.max(
        maximumB,
        rgb.b
      );
  }

  const count =
    seeds.length;

  return {
    count,

    meanRgb: {
      r:
        safeMeanV3(
          sumR,
          count
        ),

      g:
        safeMeanV3(
          sumG,
          count
        ),

      b:
        safeMeanV3(
          sumB,
          count
        ),
    },

    meanLab: {
      l:
        safeMeanV3(
          sumL,
          count
        ),

      a:
        safeMeanV3(
          sumA,
          count
        ),

      b:
        safeMeanV3(
          sumLabB,
          count
        ),
    },

    meanYcbcr: {
      y:
        safeMeanV3(
          sumY,
          count
        ),

      cb:
        safeMeanV3(
          sumCb,
          count
        ),

      cr:
        safeMeanV3(
          sumCr,
          count
        ),
    },

    minimumRgb: {
      r:
        minimumR,

      g:
        minimumG,

      b:
        minimumB,
    },

    maximumRgb: {
      r:
        maximumR,

      g:
        maximumG,

      b:
        maximumB,
    },

    standardDeviationRgb: {
      r:
        safeStandardDeviationV3(
          sumR,
          sumR2,
          count
        ),

      g:
        safeStandardDeviationV3(
          sumG,
          sumG2,
          count
        ),

      b:
        safeStandardDeviationV3(
          sumB,
          sumB2,
          count
        ),
    },

    standardDeviationLab: {
      l:
        safeStandardDeviationV3(
          sumL,
          sumL2,
          count
        ),

      a:
        safeStandardDeviationV3(
          sumA,
          sumA2,
          count
        ),

      b:
        safeStandardDeviationV3(
          sumLabB,
          sumLabB2,
          count
        ),
    },

    meanLuminance:
      safeMeanV3(
        sumLuminance,
        count
      ),

    luminanceStandardDeviation:
      safeStandardDeviationV3(
        sumLuminance,
        sumLuminance2,
        count
      ),

    meanChroma:
      safeMeanV3(
        sumChroma,
        count
      ),

    chromaStandardDeviation:
      safeStandardDeviationV3(
        sumChroma,
        sumChroma2,
        count
      ),

    meanSaturation:
      safeMeanV3(
        sumSaturation,
        count
      ),

    saturationStandardDeviation:
      safeStandardDeviationV3(
        sumSaturation,
        sumSaturation2,
        count
      ),
  };
}
// scan/core/ai/BackgroundUnderstandingV3.ts
// Part 2/4
//
// يكمل مباشرة بعد:
//
// function calculateColorStatisticsV3(
//   seeds:
//     readonly BackgroundUnderstandingSeedV3[]
// ): BackgroundUnderstandingColorStatisticsV3 {
//   ...
// }

/* =========================================================
 * Seed source helpers
 * ======================================================= */

function getBorderBandPixelsV3(
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  const basedOnRatio =
    Math.round(
      Math.min(
        width,
        height
      ) *
        config.borderBandRatio
    );

  return clampIntegerV3(
    basedOnRatio,
    config.minimumBorderBandPixels,
    Math.min(
      config.maximumBorderBandPixels,
      Math.max(
        1,
        Math.floor(
          Math.min(
            width,
            height
          ) * 0.25
        )
      )
    )
  );
}

function getCornerRegionSizeV3(
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): {
  width: number;

  height: number;
} {
  return {
    width:
      clampIntegerV3(
        width *
          config.cornerRegionRatio,
        1,
        Math.max(
          1,
          Math.floor(
            width * 0.4
          )
        )
      ),

    height:
      clampIntegerV3(
        height *
          config.cornerRegionRatio,
        1,
        Math.max(
          1,
          Math.floor(
            height * 0.4
          )
        )
      ),
  };
}

function isCornerSourceV3(
  source:
    BackgroundUnderstandingSeedSourceV3
): boolean {
  return (
    source ===
      'top-left-corner' ||
    source ===
      'top-right-corner' ||
    source ===
      'bottom-right-corner' ||
    source ===
      'bottom-left-corner'
  );
}

function getSeedSourceWeightV3(
  source:
    BackgroundUnderstandingSeedSourceV3
): number {
  switch (source) {
    case 'top-left-corner':
    case 'top-right-corner':
    case 'bottom-right-corner':
    case 'bottom-left-corner':
      return 1;

    case 'top-border':
    case 'right-border':
    case 'bottom-border':
    case 'left-border':
      return 0.92;

    case 'low-mask-border':
      return 0.82;

    case 'flood-fill-expansion':
      return 0.68;

    default:
      return 0.75;
  }
}

function getModelKindFromSeedSourceV3(
  source:
    BackgroundUnderstandingSeedSourceV3
): BackgroundUnderstandingModelKindV3 {
  switch (source) {
    case 'top-border':
      return 'top-border';

    case 'right-border':
      return 'right-border';

    case 'bottom-border':
      return 'bottom-border';

    case 'left-border':
      return 'left-border';

    case 'top-left-corner':
      return 'top-left-corner';

    case 'top-right-corner':
      return 'top-right-corner';

    case 'bottom-right-corner':
      return 'bottom-right-corner';

    case 'bottom-left-corner':
      return 'bottom-left-corner';

    case 'low-mask-border':
    case 'flood-fill-expansion':
    default:
      return 'global-border';
  }
}

/* =========================================================
 * Seed location collection
 * ======================================================= */

type BackgroundUnderstandingSeedLocationV3 = {
  x: number;

  y: number;

  source:
    BackgroundUnderstandingSeedSourceV3;
};

function appendSeedLocationV3(
  locations:
    BackgroundUnderstandingSeedLocationV3[],
  visited:
    Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  source:
    BackgroundUnderstandingSeedSourceV3
): void {
  if (
    !isInsideImageV3(
      x,
      y,
      width,
      height
    )
  ) {
    return;
  }

  const index =
    getPixelIndexV3(
      x,
      y,
      width
    );

  if (
    visited[index] !== 0
  ) {
    return;
  }

  visited[index] =
    1;

  locations.push({
    x,

    y,

    source,
  });
}

function collectTopBorderLocationsV3(
  output:
    BackgroundUnderstandingSeedLocationV3[],
  visited:
    Uint8Array,
  width: number,
  height: number,
  band: number,
  stride: number
): void {
  for (
    let y = 0;
    y < band;
    y += stride
  ) {
    for (
      let x = 0;
      x < width;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'top-border'
      );
    }
  }
}

function collectRightBorderLocationsV3(
  output:
    BackgroundUnderstandingSeedLocationV3[],
  visited:
    Uint8Array,
  width: number,
  height: number,
  band: number,
  stride: number
): void {
  const startX =
    Math.max(
      0,
      width - band
    );

  for (
    let y = 0;
    y < height;
    y += stride
  ) {
    for (
      let x = startX;
      x < width;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'right-border'
      );
    }
  }
}

function collectBottomBorderLocationsV3(
  output:
    BackgroundUnderstandingSeedLocationV3[],
  visited:
    Uint8Array,
  width: number,
  height: number,
  band: number,
  stride: number
): void {
  const startY =
    Math.max(
      0,
      height - band
    );

  for (
    let y = startY;
    y < height;
    y += stride
  ) {
    for (
      let x = 0;
      x < width;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'bottom-border'
      );
    }
  }
}

function collectLeftBorderLocationsV3(
  output:
    BackgroundUnderstandingSeedLocationV3[],
  visited:
    Uint8Array,
  width: number,
  height: number,
  band: number,
  stride: number
): void {
  for (
    let y = 0;
    y < height;
    y += stride
  ) {
    for (
      let x = 0;
      x < band;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'left-border'
      );
    }
  }
}

function collectCornerLocationsV3(
  output:
    BackgroundUnderstandingSeedLocationV3[],
  visited:
    Uint8Array,
  width: number,
  height: number,
  cornerWidth: number,
  cornerHeight: number,
  stride: number
): void {
  for (
    let y = 0;
    y < cornerHeight;
    y += stride
  ) {
    for (
      let x = 0;
      x < cornerWidth;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'top-left-corner'
      );
    }
  }

  const rightStart =
    Math.max(
      0,
      width -
        cornerWidth
    );

  for (
    let y = 0;
    y < cornerHeight;
    y += stride
  ) {
    for (
      let x = rightStart;
      x < width;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'top-right-corner'
      );
    }
  }

  const bottomStart =
    Math.max(
      0,
      height -
        cornerHeight
    );

  for (
    let y = bottomStart;
    y < height;
    y += stride
  ) {
    for (
      let x = rightStart;
      x < width;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'bottom-right-corner'
      );
    }
  }

  for (
    let y = bottomStart;
    y < height;
    y += stride
  ) {
    for (
      let x = 0;
      x < cornerWidth;
      x += stride
    ) {
      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'bottom-left-corner'
      );
    }
  }
}

function collectLowMaskBorderLocationsV3(
  output:
    BackgroundUnderstandingSeedLocationV3[],
  visited:
    Uint8Array,
  mask:
    SegmentationFloatMask,
  band: number,
  stride: number,
  maximumMaskValue: number
): void {
  const width =
    mask.width;

  const height =
    mask.height;

  for (
    let y = 0;
    y < height;
    y += stride
  ) {
    const rowOffset =
      y * width;

    for (
      let x = 0;
      x < width;
      x += stride
    ) {
      const distance =
        getDistanceToBorderPixelsV3(
          x,
          y,
          width,
          height
        );

      if (
        distance >
        band * 2
      ) {
        continue;
      }

      const index =
        rowOffset + x;

      if (
        mask.data[index] >
        maximumMaskValue
      ) {
        continue;
      }

      appendSeedLocationV3(
        output,
        visited,
        x,
        y,
        width,
        height,
        'low-mask-border'
      );
    }
  }
}

function collectSeedLocationsV3(
  mask:
    SegmentationFloatMask,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingSeedLocationV3[] {
  const width =
    mask.width;

  const height =
    mask.height;

  const pixelCount =
    width * height;

  const locations:
    BackgroundUnderstandingSeedLocationV3[] = [];

  const visited =
    new Uint8Array(
      pixelCount
    );

  const band =
    getBorderBandPixelsV3(
      width,
      height,
      config
    );

  const cornerSize =
    getCornerRegionSizeV3(
      width,
      height,
      config
    );

  const stride =
    config.borderSampleStride;

  collectCornerLocationsV3(
    locations,
    visited,
    width,
    height,
    cornerSize.width,
    cornerSize.height,
    stride
  );

  collectTopBorderLocationsV3(
    locations,
    visited,
    width,
    height,
    band,
    stride
  );

  collectRightBorderLocationsV3(
    locations,
    visited,
    width,
    height,
    band,
    stride
  );

  collectBottomBorderLocationsV3(
    locations,
    visited,
    width,
    height,
    band,
    stride
  );

  collectLeftBorderLocationsV3(
    locations,
    visited,
    width,
    height,
    band,
    stride
  );

  collectLowMaskBorderLocationsV3(
    locations,
    visited,
    mask,
    band,
    stride,
    config.maximumSeedMaskValue
  );

  return locations;
}

/* =========================================================
 * Seed validation
 * ======================================================= */

function getSeedSubjectDistanceRatioV3(
  x: number,
  y: number,
  bounds:
    SegmentationMaskBounds | null,
  width: number,
  height: number
): number {
  if (!bounds) {
    return 1;
  }

  const distance =
    getDistanceToBoundsV3(
      x,
      y,
      bounds
    );

  return clampUnitValue(
    safeSegmentationDivide(
      distance,
      Math.max(
        1,
        Math.min(
          width,
          height
        )
      ),
      0
    )
  );
}

function createRejectedSeedV3(
  x: number,
  y: number,
  width: number,
  source:
    BackgroundUnderstandingSeedSourceV3,
  reason:
    BackgroundUnderstandingSeedRejectionReasonV3
): BackgroundUnderstandingRejectedSeedV3 {
  return {
    x,

    y,

    index:
      getPixelIndexV3(
        x,
        y,
        width
      ),

    source,

    reason,
  };
}

function calculateSeedConfidenceV3(
  maskValue: number,
  gradient: number,
  texture: number,
  borderDistanceRatio: number,
  subjectDistanceRatio: number,
  source:
    BackgroundUnderstandingSeedSourceV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  const maskConfidence =
    inverseSmoothStepV3(
      0,
      Math.max(
        BACKGROUND_UNDERSTANDING_EPSILON_V3,
        config.hardSeedMaskLimit
      ),
      maskValue
    );

  const gradientConfidence =
    inverseSmoothStepV3(
      0,
      Math.max(
        BACKGROUND_UNDERSTANDING_EPSILON_V3,
        config.maximumSeedGradient
      ),
      gradient
    );

  const textureConfidence =
    inverseSmoothStepV3(
      0,
      Math.max(
        BACKGROUND_UNDERSTANDING_EPSILON_V3,
        config.maximumSeedTexture
      ),
      texture
    );

  const borderConfidence =
    clampUnitValue(
      1 -
      borderDistanceRatio
    );

  const subjectDistanceConfidence =
    clampUnitValue(
      subjectDistanceRatio /
        Math.max(
          BACKGROUND_UNDERSTANDING_EPSILON_V3,
          config.minimumSubjectDistanceRatio *
            4
        )
    );

  const sourceWeight =
    getSeedSourceWeightV3(
      source
    );

  return clampUnitValue(
    weightedAverageV3(
      [
        maskConfidence,
        gradientConfidence,
        textureConfidence,
        borderConfidence,
        subjectDistanceConfidence,
        sourceWeight,
      ],
      [
        0.3,
        0.2,
        0.14,
        0.1,
        0.12,
        0.14,
      ],
      0
    )
  );
}

function extractSeedsV3(
  image:
    SegmentationRgbaImageSource,
  mask:
    SegmentationFloatMask,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  subjectBounds:
    SegmentationMaskBounds | null,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingSeedCollectionV3 {
  const width =
    image.width;

  const height =
    image.height;

  const locations =
    collectSeedLocationsV3(
      mask,
      config
    );

  const accepted:
    BackgroundUnderstandingSeedV3[] = [];

  const rejected:
    BackgroundUnderstandingRejectedSeedV3[] = [];

  const maximumRejected =
    config.includeRejectedSeeds
      ? config.maximumRejectedSeeds
      : 0;

  const appendRejected = (
    rejectedSeed:
      BackgroundUnderstandingRejectedSeedV3
  ): void => {
    if (
      maximumRejected <= 0 ||
      rejected.length >=
        maximumRejected
    ) {
      return;
    }

    rejected.push(
      rejectedSeed
    );
  };

  for (
    let locationIndex = 0;
    locationIndex <
      locations.length;
    locationIndex += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      locationIndex,
      config.cancellationCheckInterval
    );

    if (
      accepted.length >=
      config.maximumSeedCount
    ) {
      break;
    }

    const location =
      locations[
        locationIndex
      ];

    const {
      x,
      y,
      source,
    } = location;

    if (
      !isInsideImageV3(
        x,
        y,
        width,
        height
      )
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'out-of-bounds'
        )
      );

      continue;
    }

    const index =
      getPixelIndexV3(
        x,
        y,
        width
      );

    const maskValue =
      clampUnitValue(
        mask.data[index]
      );

    if (
      maskValue >
      config.hardSeedMaskLimit
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'mask-too-high'
        )
      );

      continue;
    }

    const alpha =
      readSourceAlphaV3(
        image.rgba,
        index
      );

    if (
      !Number.isFinite(alpha) ||
      alpha <
        config.minimumSourceAlpha
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'alpha-too-low'
        )
      );

      continue;
    }

    const gradient =
      clampUnitValue(
        maps.gradient[index]
      );

    if (
      gradient >
      config.maximumSeedGradient
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'gradient-too-high'
        )
      );

      continue;
    }

    const texture =
      clampUnitValue(
        maps.texture[index]
      );

    if (
      texture >
      config.maximumSeedTexture
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'gradient-too-high'
        )
      );

      continue;
    }

    const subjectDistanceRatio =
      getSeedSubjectDistanceRatioV3(
        x,
        y,
        subjectBounds,
        width,
        height
      );

    if (
      subjectBounds &&
      isInsideBoundsV3(
        x,
        y,
        subjectBounds
      ) &&
      maskValue >
        config.maximumSeedMaskValue
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'too-close-to-subject'
        )
      );

      continue;
    }

    if (
      subjectBounds &&
      subjectDistanceRatio <
        config.minimumSubjectDistanceRatio &&
      maskValue >
        config.strongBackgroundMaskThreshold
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'too-close-to-subject'
        )
      );

      continue;
    }

    const color =
      readColorSampleAtPixelV3(
        image.rgba,
        index
      );

    if (
      !Number.isFinite(
        color.rgb.r
      ) ||
      !Number.isFinite(
        color.rgb.g
      ) ||
      !Number.isFinite(
        color.rgb.b
      )
    ) {
      appendRejected(
        createRejectedSeedV3(
          x,
          y,
          width,
          source,
          'invalid-color'
        )
      );

      continue;
    }

    const borderDistanceRatio =
      getDistanceToBorderRatioV3(
        x,
        y,
        width,
        height
      );

    const confidence =
      calculateSeedConfidenceV3(
        maskValue,
        gradient,
        texture,
        borderDistanceRatio,
        subjectDistanceRatio,
        source,
        config
      );

    accepted.push({
      id:
        accepted.length,

      x,

      y,

      index,

      source,

      color,

      maskValue,

      gradientStrength:
        gradient,

      localTexture:
        texture,

      borderDistanceRatio,

      confidence,
    });
  }

  accepted.sort(
    (
      first,
      second
    ) =>
      second.confidence -
      first.confidence
  );

  if (
    accepted.length >
    config.maximumSeedCount
  ) {
    accepted.length =
      config.maximumSeedCount;
  }

  for (
    let index = 0;
    index < accepted.length;
    index += 1
  ) {
    accepted[index] = {
      ...accepted[index],

      id:
        index,
    };
  }

  return {
    accepted,

    rejected,
  };
}

/* =========================================================
 * Fallback seed extraction
 * ======================================================= */

function extractFallbackSeedsV3(
  image:
    SegmentationRgbaImageSource,
  mask:
    SegmentationFloatMask,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  existingSeeds:
    readonly BackgroundUnderstandingSeedV3[],
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingSeedV3[] {
  if (
    existingSeeds.length >=
    config.minimumSeedCount
  ) {
    return [
      ...existingSeeds,
    ];
  }

  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  const output =
    [
      ...existingSeeds,
    ];

  const existingIndexes =
    new Uint8Array(
      pixelCount
    );

  for (
    const seed of output
  ) {
    existingIndexes[
      seed.index
    ] = 1;
  }

  const stride =
    Math.max(
      1,
      Math.floor(
        Math.min(
          width,
          height
        ) /
          64
      )
    );

  const maximumFallbackMask =
    Math.min(
      config.hardSeedMaskLimit,
      config.maximumSeedMaskValue +
        0.12
    );

  for (
    let y = 0;
    y < height;
    y += stride
  ) {
    for (
      let x = 0;
      x < width;
      x += stride
    ) {
      const index =
        getPixelIndexV3(
          x,
          y,
          width
        );

      checkCancellationV3(
        cancellationSignal,
        index,
        config.cancellationCheckInterval
      );

      if (
        output.length >=
        config.minimumSeedCount ||
        output.length >=
        config.maximumSeedCount
      ) {
        break;
      }

      if (
        existingIndexes[index] !== 0
      ) {
        continue;
      }

      const borderDistance =
        getDistanceToBorderPixelsV3(
          x,
          y,
          width,
          height
        );

      if (
        borderDistance >
        Math.max(
          2,
          Math.floor(
            Math.min(
              width,
              height
            ) * 0.08
          )
        )
      ) {
        continue;
      }

      const maskValue =
        clampUnitValue(
          mask.data[index]
        );

      if (
        maskValue >
        maximumFallbackMask
      ) {
        continue;
      }

      const gradient =
        clampUnitValue(
          maps.gradient[index]
        );

      const texture =
        clampUnitValue(
          maps.texture[index]
        );

      if (
        gradient >
          config.maximumSeedGradient *
            1.35 ||
        texture >
          config.maximumSeedTexture *
            1.35
      ) {
        continue;
      }

      const alpha =
        readSourceAlphaV3(
          image.rgba,
          index
        );

      if (
        alpha <
        config.minimumSourceAlpha
      ) {
        continue;
      }

      output.push({
        id:
          output.length,

        x,

        y,

        index,

        source:
          'low-mask-border',

        color:
          readColorSampleAtPixelV3(
            image.rgba,
            index
          ),

        maskValue,

        gradientStrength:
          gradient,

        localTexture:
          texture,

        borderDistanceRatio:
          getDistanceToBorderRatioV3(
            x,
            y,
            width,
            height
          ),

        confidence:
          clampUnitValue(
            0.48 +
            (1 - maskValue) *
              0.2 +
            (1 - gradient) *
              0.12 +
            (1 - texture) *
              0.1
          ),
      });

      existingIndexes[index] =
        1;
    }

    if (
      output.length >=
      config.minimumSeedCount
    ) {
      break;
    }
  }

  return output;
}

/* =========================================================
 * Seed grouping
 * ======================================================= */

function filterSeedsBySourceV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  source:
    BackgroundUnderstandingSeedSourceV3
): BackgroundUnderstandingSeedV3[] {
  const result:
    BackgroundUnderstandingSeedV3[] = [];

  for (
    const seed of seeds
  ) {
    if (
      seed.source ===
      source
    ) {
      result.push(seed);
    }
  }

  return result;
}

function filterSeedsForGlobalModelV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[]
): BackgroundUnderstandingSeedV3[] {
  const result:
    BackgroundUnderstandingSeedV3[] = [];

  for (
    const seed of seeds
  ) {
    if (
      seed.source !==
      'flood-fill-expansion'
    ) {
      result.push(seed);
    }
  }

  return result;
}

function getMeanSeedPositionV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  width: number,
  height: number
): SegmentationPoint | null {
  if (
    seeds.length === 0
  ) {
    return null;
  }

  let sumX =
    0;

  let sumY =
    0;

  let weightSum =
    0;

  for (
    const seed of seeds
  ) {
    const weight =
      Math.max(
        0.01,
        seed.confidence
      );

    sumX +=
      seed.x * weight;

    sumY +=
      seed.y * weight;

    weightSum +=
      weight;
  }

  if (
    weightSum <=
    BACKGROUND_UNDERSTANDING_EPSILON_V3
  ) {
    return null;
  }

  return {
    x:
      clampSegmentationValue(
        sumX / weightSum,
        0,
        Math.max(
          0,
          width - 1
        )
      ),

    y:
      clampSegmentationValue(
        sumY / weightSum,
        0,
        Math.max(
          0,
          height - 1
        )
      ),
  };
}

function getSeedSpatialRadiusV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  center:
    SegmentationPoint | null,
  width: number,
  height: number
): number {
  if (
    !center ||
    seeds.length === 0
  ) {
    return 1;
  }

  let distanceSum =
    0;

  let weightSum =
    0;

  for (
    const seed of seeds
  ) {
    const distance =
      getNormalizedDistanceV3(
        seed.x,
        seed.y,
        center.x,
        center.y,
        width,
        height
      );

    const weight =
      Math.max(
        0.01,
        seed.confidence
      );

    distanceSum +=
      distance * weight;

    weightSum +=
      weight;
  }

  return clampSegmentationValue(
    safeSegmentationDivide(
      distanceSum,
      weightSum,
      0.35
    ) * 2.2,
    0.08,
    1
  );
}

/* =========================================================
 * Cluster accumulator helpers
 * ======================================================= */

function createClusterAccumulatorV3(
  id: number
): BackgroundUnderstandingClusterAccumulatorV3 {
  return {
    id,

    seedIds: [],

    count: 0,

    sumR: 0,

    sumG: 0,

    sumB: 0,

    sumL: 0,

    sumA: 0,

    sumLabB: 0,

    sumY: 0,

    sumCb: 0,

    sumCr: 0,

    sumLuminance: 0,

    sumChroma: 0,

    sumTexture: 0,

    sumX: 0,

    sumYPosition: 0,
  };
}

function appendSeedToClusterV3(
  cluster:
    BackgroundUnderstandingClusterAccumulatorV3,
  seed:
    BackgroundUnderstandingSeedV3
): void {
  cluster.seedIds.push(
    seed.id
  );

  cluster.count +=
    1;

  cluster.sumR +=
    seed.color.rgb.r;

  cluster.sumG +=
    seed.color.rgb.g;

  cluster.sumB +=
    seed.color.rgb.b;

  cluster.sumL +=
    seed.color.lab.l;

  cluster.sumA +=
    seed.color.lab.a;

  cluster.sumLabB +=
    seed.color.lab.b;

  cluster.sumY +=
    seed.color.ycbcr.y;

  cluster.sumCb +=
    seed.color.ycbcr.cb;

  cluster.sumCr +=
    seed.color.ycbcr.cr;

  cluster.sumLuminance +=
    seed.color.luminance;

  cluster.sumChroma +=
    seed.color.chroma;

  cluster.sumTexture +=
    seed.localTexture;

  cluster.sumX +=
    seed.x;

  cluster.sumYPosition +=
    seed.y;
}

function getClusterCenterLabV3(
  cluster:
    BackgroundUnderstandingClusterAccumulatorV3
): BackgroundUnderstandingLabColorV3 {
  return {
    l:
      safeMeanV3(
        cluster.sumL,
        cluster.count
      ),

    a:
      safeMeanV3(
        cluster.sumA,
        cluster.count
      ),

    b:
      safeMeanV3(
        cluster.sumLabB,
        cluster.count
      ),
  };
}

function getClusterCenterRgbV3(
  cluster:
    BackgroundUnderstandingClusterAccumulatorV3
): BackgroundUnderstandingRgbColorV3 {
  return {
    r:
      safeMeanV3(
        cluster.sumR,
        cluster.count
      ),

    g:
      safeMeanV3(
        cluster.sumG,
        cluster.count
      ),

    b:
      safeMeanV3(
        cluster.sumB,
        cluster.count
      ),
  };
}

function getClusterCenterYcbcrV3(
  cluster:
    BackgroundUnderstandingClusterAccumulatorV3
): BackgroundUnderstandingYcbcrColorV3 {
  return {
    y:
      safeMeanV3(
        cluster.sumY,
        cluster.count
      ),

    cb:
      safeMeanV3(
        cluster.sumCb,
        cluster.count
      ),

    cr:
      safeMeanV3(
        cluster.sumCr,
        cluster.count
      ),
  };
}

/* =========================================================
 * Seed clustering
 * ======================================================= */

function findClosestClusterV3(
  seed:
    BackgroundUnderstandingSeedV3,
  clusters:
    readonly BackgroundUnderstandingClusterAccumulatorV3[],
  maximumDistance: number
): BackgroundUnderstandingClusterAccumulatorV3 | null {
  let selected:
    BackgroundUnderstandingClusterAccumulatorV3 | null = null;

  let selectedDistance =
    Number.POSITIVE_INFINITY;

  for (
    const cluster of clusters
  ) {
    if (
      cluster.count <= 0
    ) {
      continue;
    }

    const distance =
      calculateLabDistanceV3(
        seed.color.lab,
        getClusterCenterLabV3(
          cluster
        )
      );

    if (
      distance <
      selectedDistance
    ) {
      selected =
        cluster;

      selectedDistance =
        distance;
    }
  }

  if (
    selectedDistance >
    maximumDistance
  ) {
    return null;
  }

  return selected;
}

function mergeClosestClustersV3(
  clusters:
    BackgroundUnderstandingClusterAccumulatorV3[]
): void {
  if (
    clusters.length <= 1
  ) {
    return;
  }

  let firstIndex =
    -1;

  let secondIndex =
    -1;

  let minimumDistance =
    Number.POSITIVE_INFINITY;

  for (
    let i = 0;
    i < clusters.length;
    i += 1
  ) {
    const firstCenter =
      getClusterCenterLabV3(
        clusters[i]
      );

    for (
      let j = i + 1;
      j < clusters.length;
      j += 1
    ) {
      const distance =
        calculateLabDistanceV3(
          firstCenter,
          getClusterCenterLabV3(
            clusters[j]
          )
        );

      if (
        distance <
        minimumDistance
      ) {
        minimumDistance =
          distance;

        firstIndex =
          i;

        secondIndex =
          j;
      }
    }
  }

  if (
    firstIndex < 0 ||
    secondIndex < 0
  ) {
    return;
  }

  const target =
    clusters[firstIndex];

  const source =
    clusters[secondIndex];

  target.seedIds.push(
    ...source.seedIds
  );

  target.count +=
    source.count;

  target.sumR +=
    source.sumR;

  target.sumG +=
    source.sumG;

  target.sumB +=
    source.sumB;

  target.sumL +=
    source.sumL;

  target.sumA +=
    source.sumA;

  target.sumLabB +=
    source.sumLabB;

  target.sumY +=
    source.sumY;

  target.sumCb +=
    source.sumCb;

  target.sumCr +=
    source.sumCr;

  target.sumLuminance +=
    source.sumLuminance;

  target.sumChroma +=
    source.sumChroma;

  target.sumTexture +=
    source.sumTexture;

  target.sumX +=
    source.sumX;

  target.sumYPosition +=
    source.sumYPosition;

  clusters.splice(
    secondIndex,
    1
  );
}

function createColorClustersV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingClusterAccumulatorV3[] {
  if (
    seeds.length === 0
  ) {
    return [];
  }

  const sortedSeeds =
    [
      ...seeds,
    ].sort(
      (
        first,
        second
      ) =>
        second.confidence -
        first.confidence
    );

  const clusters:
    BackgroundUnderstandingClusterAccumulatorV3[] = [];

  const assignmentDistance =
    Math.max(
      0.025,
      config.minimumClusterLabDistance
    );

  for (
    const seed of sortedSeeds
  ) {
    const closest =
      findClosestClusterV3(
        seed,
        clusters,
        assignmentDistance
      );

    if (closest) {
      appendSeedToClusterV3(
        closest,
        seed
      );

      continue;
    }

    const cluster =
      createClusterAccumulatorV3(
        clusters.length
      );

    appendSeedToClusterV3(
      cluster,
      seed
    );

    clusters.push(
      cluster
    );

    while (
      clusters.length >
      config.maximumColorClusters
    ) {
      mergeClosestClustersV3(
        clusters
      );
    }
  }

  const minimumSamples =
    Math.max(
      2,
      Math.floor(
        seeds.length *
          config.minimumClusterSampleRatio
      )
    );

  const significant =
    clusters.filter(
      cluster =>
        cluster.count >=
        minimumSamples
    );

  const selected =
    significant.length > 0
      ? significant
      : clusters
          .sort(
            (
              first,
              second
            ) =>
              second.count -
              first.count
          )
          .slice(
            0,
            Math.max(
              1,
              Math.min(
                clusters.length,
                config.maximumColorClusters
              )
            )
          );

  selected.sort(
    (
      first,
      second
    ) =>
      second.count -
      first.count
  );

  for (
    let index = 0;
    index < selected.length;
    index += 1
  ) {
    selected[index].id =
      index;
  }

  return selected;
}

/* =========================================================
 * Model tolerance helpers
 * ======================================================= */

function calculateRgbVariationV3(
  statistics:
    BackgroundUnderstandingColorStatisticsV3
): number {
  return clampUnitValue(
    Math.sqrt(
      safeSquareV3(
        statistics
          .standardDeviationRgb
          .r
      ) +
      safeSquareV3(
        statistics
          .standardDeviationRgb
          .g
      ) +
      safeSquareV3(
        statistics
          .standardDeviationRgb
          .b
      )
    ) /
      Math.sqrt(3)
  );
}

function calculateLabVariationV3(
  statistics:
    BackgroundUnderstandingColorStatisticsV3
): number {
  return clampUnitValue(
    Math.sqrt(
      safeSquareV3(
        statistics
          .standardDeviationLab
          .l
      ) +
      safeSquareV3(
        statistics
          .standardDeviationLab
          .a
      ) +
      safeSquareV3(
        statistics
          .standardDeviationLab
          .b
      )
    ) /
      Math.sqrt(3)
  );
}

function calculateModelLabToleranceV3(
  statistics:
    BackgroundUnderstandingColorStatisticsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  return clampSegmentationValue(
    config.baseLabTolerance +
      calculateLabVariationV3(
        statistics
      ) *
        config.adaptiveToleranceScale,
    config.minimumLabTolerance,
    config.maximumLabTolerance
  );
}

function calculateModelRgbToleranceV3(
  statistics:
    BackgroundUnderstandingColorStatisticsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  return clampSegmentationValue(
    config.baseRgbTolerance +
      calculateRgbVariationV3(
        statistics
      ) *
        config.adaptiveToleranceScale,
    config.minimumRgbTolerance,
    config.maximumRgbTolerance
  );
}

function calculateModelConfidenceV3(
  statistics:
    BackgroundUnderstandingColorStatisticsV3,
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  minimumSeedCount: number
): number {
  if (
    seeds.length === 0
  ) {
    return 0;
  }

  let seedConfidenceSum =
    0;

  for (
    const seed of seeds
  ) {
    seedConfidenceSum +=
      seed.confidence;
  }

  const meanSeedConfidence =
    seedConfidenceSum /
    seeds.length;

  const countConfidence =
    clampUnitValue(
      seeds.length /
        Math.max(
          1,
          minimumSeedCount
        )
    );

  const variation =
    clampUnitValue(
      calculateLabVariationV3(
        statistics
      ) *
        2.4 +
      statistics
        .luminanceStandardDeviation *
        1.4
    );

  const stabilityConfidence =
    1 - variation;

  return clampUnitValue(
    weightedAverageV3(
      [
        meanSeedConfidence,
        countConfidence,
        stabilityConfidence,
      ],
      [
        0.46,
        0.28,
        0.26,
      ],
      0
    )
  );
}

/* =========================================================
 * Base model creation
 * ======================================================= */

function createColorModelFromSeedsV3(
  id: string,
  kind:
    BackgroundUnderstandingModelKindV3,
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  width: number,
  height: number,
  weight: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingColorModelV3 | null {
  if (
    seeds.length === 0
  ) {
    return null;
  }

  const statistics =
    calculateColorStatisticsV3(
      seeds
    );

  const center =
    getMeanSeedPositionV3(
      seeds,
      width,
      height
    );

  const spatialRadius =
    getSeedSpatialRadiusV3(
      seeds,
      center,
      width,
      height
    );

  const luminanceTolerance =
    clampUnitValue(
      config.baseLuminanceTolerance +
      statistics
        .luminanceStandardDeviation *
        config.adaptiveToleranceScale
    );

  const chromaTolerance =
    clampUnitValue(
      config.baseChromaTolerance +
      statistics
        .chromaStandardDeviation *
        config.adaptiveToleranceScale
    );

  let textureSum =
    0;

  for (
    const seed of seeds
  ) {
    textureSum +=
      seed.localTexture;
  }

  const meanTexture =
    safeMeanV3(
      textureSum,
      seeds.length
    );

  const textureTolerance =
    clampUnitValue(
      config.baseTextureTolerance +
      meanTexture *
        0.65
    );

  const minimumLuminance =
    clampUnitValue(
      statistics.meanLuminance -
      luminanceTolerance
    );

  const maximumLuminance =
    clampUnitValue(
      statistics.meanLuminance +
      luminanceTolerance
    );

  return {
    id,

    kind,

    enabled:
      true,

    sampleCount:
      seeds.length,

    weight:
      clampUnitValue(weight),

    centerRgb:
      statistics.meanRgb,

    centerLab:
      statistics.meanLab,

    centerYcbcr:
      statistics.meanYcbcr,

    rgbTolerance:
      calculateModelRgbToleranceV3(
        statistics,
        config
      ),

    labTolerance:
      calculateModelLabToleranceV3(
        statistics,
        config
      ),

    luminanceTolerance,

    chromaTolerance,

    textureTolerance,

    luminanceMinimum:
      minimumLuminance,

    luminanceMaximum:
      maximumLuminance,

    confidence:
      calculateModelConfidenceV3(
        statistics,
        seeds,
        config.minimumSeedCount
      ),

    spatialCenter:
      center,

    spatialRadiusRatio:
      spatialRadius,

    sourceSeedIds:
      seeds.map(
        seed =>
          seed.id
      ),
  };
}

/* =========================================================
 * Cluster model creation
 * ======================================================= */

function getSeedsByIdsV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  ids:
    readonly number[]
): BackgroundUnderstandingSeedV3[] {
  const byId =
    new Map<
      number,
      BackgroundUnderstandingSeedV3
    >();

  for (
    const seed of seeds
  ) {
    byId.set(
      seed.id,
      seed
    );
  }

  const output:
    BackgroundUnderstandingSeedV3[] = [];

  for (
    const id of ids
  ) {
    const seed =
      byId.get(id);

    if (seed) {
      output.push(seed);
    }
  }

  return output;
}

function createClusterModelsV3(
  clusters:
    readonly BackgroundUnderstandingClusterAccumulatorV3[],
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingColorModelV3[] {
  const models:
    BackgroundUnderstandingColorModelV3[] = [];

  const totalSeedCount =
    Math.max(
      1,
      seeds.length
    );

  for (
    let index = 0;
    index < clusters.length;
    index += 1
  ) {
    const cluster =
      clusters[index];

    const clusterSeeds =
      getSeedsByIdsV3(
        seeds,
        cluster.seedIds
      );

    const ratio =
      clusterSeeds.length /
      totalSeedCount;

    const model =
      createColorModelFromSeedsV3(
        `background-cluster-${index}`,
        'cluster',
        clusterSeeds,
        width,
        height,
        clampUnitValue(
          0.45 +
          ratio * 0.55
        ),
        config
      );

    if (model) {
      models.push(model);
    }
  }

  return models;
}

/* =========================================================
 * Directional and corner models
 * ======================================================= */

function createDirectionalModelsV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingColorModelV3[] {
  const sources:
    readonly BackgroundUnderstandingSeedSourceV3[] = [
      'top-border',
      'right-border',
      'bottom-border',
      'left-border',
      'top-left-corner',
      'top-right-corner',
      'bottom-right-corner',
      'bottom-left-corner',
    ];

  const output:
    BackgroundUnderstandingColorModelV3[] = [];

  for (
    const source of sources
  ) {
    const sourceSeeds =
      filterSeedsBySourceV3(
        seeds,
        source
      );

    const minimumRequired =
      isCornerSourceV3(
        source
      )
        ? 3
        : 5;

    if (
      sourceSeeds.length <
      minimumRequired
    ) {
      continue;
    }

    const model =
      createColorModelFromSeedsV3(
        `background-${source}`,
        getModelKindFromSeedSourceV3(
          source
        ),
        sourceSeeds,
        width,
        height,
        isCornerSourceV3(
          source
        )
          ? 0.78
          : 0.72,
        config
      );

    if (model) {
      output.push(model);
    }
  }

  return output;
}

/* =========================================================
 * Shadow model
 * ======================================================= */

function createShadowModelV3(
  globalModel:
    BackgroundUnderstandingColorModelV3,
  statistics:
    BackgroundUnderstandingColorStatisticsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingColorModelV3 | null {
  if (
    !config.detectShadows
  ) {
    return null;
  }

  if (
    globalModel.centerLab.l <
    0.14
  ) {
    return null;
  }

  const targetLuminance =
    clampUnitValue(
      statistics.meanLuminance *
        0.68
    );

  const targetRgb: BackgroundUnderstandingRgbColorV3 = {
    r:
      clampUnitValue(
        globalModel.centerRgb.r *
          0.68
      ),

    g:
      clampUnitValue(
        globalModel.centerRgb.g *
          0.68
      ),

    b:
      clampUnitValue(
        globalModel.centerRgb.b *
          0.68
      ),
  };

  const targetLab =
    rgbToLabV3(
      targetRgb
    );

  const targetYcbcr =
    rgbToYcbcrV3(
      targetRgb
    );

 return {
  id:
    'background-shadow',

  kind:
    'shadow',

  enabled:
    true,

  sampleCount:
    globalModel.sampleCount,

  weight:
    0.58,

  rgbTolerance:
    clampUnitValue(
      globalModel.rgbTolerance *
        1.15
    ),

  labTolerance:
    clampUnitValue(
      globalModel.labTolerance *
        1.2
    ),

  luminanceTolerance:
    clampUnitValue(
      Math.max(
        globalModel
          .luminanceTolerance,
        statistics
          .luminanceStandardDeviation *
          2
      )
    ),

  chromaTolerance:
    clampUnitValue(
      Math.max(
        config.shadowMaximumChromaDifference,
        globalModel
          .chromaTolerance
      )
    ),

  textureTolerance:
    clampUnitValue(
      globalModel
        .textureTolerance *
        1.15
    ),

  luminanceMinimum:
    clampUnitValue(
      statistics.meanLuminance *
        config.shadowMinimumLuminanceRatio
    ),

  luminanceMaximum:
    clampUnitValue(
      statistics.meanLuminance *
        config.shadowMaximumLuminanceRatio
    ),

  confidence:
    clampUnitValue(
      globalModel.confidence *
        0.72
    ),

  spatialCenter:
    globalModel.spatialCenter,

  spatialRadiusRatio:
    Math.min(
      1,
      globalModel
        .spatialRadiusRatio *
        1.35
    ),

  sourceSeedIds:
    globalModel.sourceSeedIds,

  centerRgb: {
    r:
      targetRgb.r,

    g:
      targetRgb.g,

    b:
      targetRgb.b,
  },

  centerLab: {
    l:
      targetLab.l,

    a:
      targetLab.a,

    b:
      targetLab.b,
  },

  centerYcbcr: {
    y:
      targetLuminance,

    cb:
      targetYcbcr.cb,

    cr:
      targetYcbcr.cr,
  },
};
}

/* =========================================================
 * Highlight model
 * ======================================================= */

function createHighlightModelV3(
  globalModel:
    BackgroundUnderstandingColorModelV3,
  statistics:
    BackgroundUnderstandingColorStatisticsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingColorModelV3 | null {
  if (
    !config.detectHighlights
  ) {
    return null;
  }

  const targetLuminance =
    clampUnitValue(
      Math.max(
        config.highlightMinimumLuminance,
        statistics.meanLuminance +
          Math.max(
            0.08,
            statistics
              .luminanceStandardDeviation *
              1.4
          )
      )
    );

  const blendAmount =
    clampUnitValue(
      (
        targetLuminance -
        statistics.meanLuminance
      ) /
        Math.max(
          0.01,
          1 -
            statistics.meanLuminance
        )
    );

  const targetRgb: BackgroundUnderstandingRgbColorV3 = {
    r:
      clampUnitValue(
        globalModel.centerRgb.r +
        (
          1 -
          globalModel.centerRgb.r
        ) *
          blendAmount
      ),

    g:
      clampUnitValue(
        globalModel.centerRgb.g +
        (
          1 -
          globalModel.centerRgb.g
        ) *
          blendAmount
      ),

    b:
      clampUnitValue(
        globalModel.centerRgb.b +
        (
          1 -
          globalModel.centerRgb.b
        ) *
          blendAmount
      ),
  };

  const targetLab =
    rgbToLabV3(
      targetRgb
    );

  const targetYcbcr =
    rgbToYcbcrV3(
      targetRgb
    );

  return {
    id:
      'background-highlight',

    kind:
      'highlight',

    enabled:
      true,

    sampleCount:
      globalModel.sampleCount,

    weight:
      0.46,

    centerRgb:
      targetRgb,

    centerLab:
      targetLab,

    centerYcbcr:
      targetYcbcr,

    rgbTolerance:
      clampUnitValue(
        globalModel
          .rgbTolerance *
          1.1
      ),

    labTolerance:
      clampUnitValue(
        globalModel
          .labTolerance *
          1.12
      ),

    luminanceTolerance:
      clampUnitValue(
        Math.max(
          0.08,
          globalModel
            .luminanceTolerance
        )
      ),

    chromaTolerance:
      clampUnitValue(
        Math.max(
          config.highlightMaximumChroma,
          globalModel
            .chromaTolerance
        )
      ),

    textureTolerance:
      clampUnitValue(
        globalModel
          .textureTolerance *
          1.2
      ),

    luminanceMinimum:
      config.highlightMinimumLuminance,

    luminanceMaximum:
      1,

    confidence:
      clampUnitValue(
        globalModel.confidence *
          0.62
      ),

    spatialCenter:
      globalModel.spatialCenter,

    spatialRadiusRatio:
      Math.min(
        1,
        globalModel
          .spatialRadiusRatio *
          1.4
      ),

    sourceSeedIds:
      globalModel.sourceSeedIds,
  };
}

/* =========================================================
 * Model deduplication
 * ======================================================= */

function shouldMergeModelsV3(
  first:
    BackgroundUnderstandingColorModelV3,
  second:
    BackgroundUnderstandingColorModelV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): boolean {
  if (
    first.kind ===
      'shadow' ||
    second.kind ===
      'shadow' ||
    first.kind ===
      'highlight' ||
    second.kind ===
      'highlight'
  ) {
    return false;
  }

  const labDistance =
    calculateLabDistanceV3(
      first.centerLab,
      second.centerLab
    );

  const rgbDistance =
    calculateRgbDistanceV3(
      first.centerRgb,
      second.centerRgb
    );

  return (
    labDistance <
      config.minimumClusterLabDistance *
        0.52 &&
    rgbDistance <
      config.minimumClusterLabDistance *
        0.62
  );
}

function mergeModelPairV3(
  first:
    BackgroundUnderstandingColorModelV3,
  second:
    BackgroundUnderstandingColorModelV3
): BackgroundUnderstandingColorModelV3 {
  const firstWeight =
    Math.max(
      1,
      first.sampleCount
    );

  const secondWeight =
    Math.max(
      1,
      second.sampleCount
    );

  const totalWeight =
    firstWeight +
    secondWeight;

  const blend = (
    firstValue: number,
    secondValue: number
  ): number =>
    (
      firstValue *
        firstWeight +
      secondValue *
        secondWeight
    ) /
    totalWeight;

  const seedIds =
    Array.from(
      new Set([
        ...first.sourceSeedIds,
        ...second.sourceSeedIds,
      ])
    );

  let spatialCenter:
    SegmentationPoint | null = null;

  if (
    first.spatialCenter &&
    second.spatialCenter
  ) {
    spatialCenter = {
      x:
        blend(
          first.spatialCenter.x,
          second.spatialCenter.x
        ),

      y:
        blend(
          first.spatialCenter.y,
          second.spatialCenter.y
        ),
    };
  } else {
    spatialCenter =
      first.spatialCenter ??
      second.spatialCenter;
  }

  return {
    id:
      first.id,

    kind:
      first.kind,

    enabled:
      first.enabled ||
      second.enabled,

    sampleCount:
      first.sampleCount +
      second.sampleCount,

    weight:
      clampUnitValue(
        Math.max(
          first.weight,
          second.weight
        )
      ),

    centerRgb: {
      r:
        blend(
          first.centerRgb.r,
          second.centerRgb.r
        ),

      g:
        blend(
          first.centerRgb.g,
          second.centerRgb.g
        ),

      b:
        blend(
          first.centerRgb.b,
          second.centerRgb.b
        ),
    },

    centerLab: {
      l:
        blend(
          first.centerLab.l,
          second.centerLab.l
        ),

      a:
        blend(
          first.centerLab.a,
          second.centerLab.a
        ),

      b:
        blend(
          first.centerLab.b,
          second.centerLab.b
        ),
    },

    centerYcbcr: {
      y:
        blend(
          first.centerYcbcr.y,
          second.centerYcbcr.y
        ),

      cb:
        blend(
          first.centerYcbcr.cb,
          second.centerYcbcr.cb
        ),

      cr:
        blend(
          first.centerYcbcr.cr,
          second.centerYcbcr.cr
        ),
    },

    rgbTolerance:
      Math.max(
        first.rgbTolerance,
        second.rgbTolerance
      ),

    labTolerance:
      Math.max(
        first.labTolerance,
        second.labTolerance
      ),

    luminanceTolerance:
      Math.max(
        first.luminanceTolerance,
        second.luminanceTolerance
      ),

    chromaTolerance:
      Math.max(
        first.chromaTolerance,
        second.chromaTolerance
      ),

    textureTolerance:
      Math.max(
        first.textureTolerance,
        second.textureTolerance
      ),

    luminanceMinimum:
      Math.min(
        first.luminanceMinimum,
        second.luminanceMinimum
      ),

    luminanceMaximum:
      Math.max(
        first.luminanceMaximum,
        second.luminanceMaximum
      ),

    confidence:
      clampUnitValue(
        blend(
          first.confidence,
          second.confidence
        )
      ),

    spatialCenter,

    spatialRadiusRatio:
      Math.max(
        first.spatialRadiusRatio,
        second.spatialRadiusRatio
      ),

    sourceSeedIds:
      seedIds,
  };
}

function deduplicateModelsV3(
  models:
    readonly BackgroundUnderstandingColorModelV3[],
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingColorModelV3[] {
  const result:
    BackgroundUnderstandingColorModelV3[] = [];

  for (
    const model of models
  ) {
    let merged =
      false;

    for (
      let index = 0;
      index < result.length;
      index += 1
    ) {
      if (
        !shouldMergeModelsV3(
          result[index],
          model,
          config
        )
      ) {
        continue;
      }

      result[index] =
        mergeModelPairV3(
          result[index],
          model
        );

      merged =
        true;

      break;
    }

    if (!merged) {
      result.push(model);
    }
  }

  return result;
}

/* =========================================================
 * Complete background model building
 * ======================================================= */

type BackgroundUnderstandingModelBuildResultV3 = {
  models:
    BackgroundUnderstandingColorModelV3[];

  statistics:
    BackgroundUnderstandingColorStatisticsV3;

  clusters:
    BackgroundUnderstandingClusterAccumulatorV3[];

  usedFallbackModel: boolean;

  detectedShadowModel: boolean;

  detectedHighlightModel: boolean;
};

function buildBackgroundModelsV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingModelBuildResultV3 {
  const globalSeeds =
    filterSeedsForGlobalModelV3(
      seeds
    );

  const statistics =
    calculateColorStatisticsV3(
      globalSeeds
    );

  const models:
    BackgroundUnderstandingColorModelV3[] = [];

  let usedFallbackModel =
    false;

  const globalModel =
    createColorModelFromSeedsV3(
      'background-global-border',
      'global-border',
      globalSeeds,
      width,
      height,
      1,
      config
    );

  if (globalModel) {
    models.push(
      globalModel
    );
  }

  const directionalModels =
    createDirectionalModelsV3(
      seeds,
      width,
      height,
      config
    );

  models.push(
    ...directionalModels
  );

  const clusters =
    createColorClustersV3(
      globalSeeds,
      config
    );

  const clusterModels =
    createClusterModelsV3(
      clusters,
      globalSeeds,
      width,
      height,
      config
    );

  models.push(
    ...clusterModels
  );

  let detectedShadowModel =
    false;

  let detectedHighlightModel =
    false;

  if (globalModel) {
    const shadowModel =
      createShadowModelV3(
        globalModel,
        statistics,
        config
      );

    if (shadowModel) {
      models.push(
        shadowModel
      );

      detectedShadowModel =
        true;
    }

    const highlightModel =
      createHighlightModelV3(
        globalModel,
        statistics,
        config
      );

    if (highlightModel) {
      models.push(
        highlightModel
      );

      detectedHighlightModel =
        true;
    }
  }

  if (
    models.length === 0 &&
    seeds.length > 0
  ) {
    const fallback =
      createColorModelFromSeedsV3(
        'background-fallback',
        'global-border',
        seeds,
        width,
        height,
        0.55,
        {
          ...config,

          baseLabTolerance:
            Math.min(
              config.maximumLabTolerance,
              config.baseLabTolerance *
                1.35
            ),

          baseRgbTolerance:
            Math.min(
              config.maximumRgbTolerance,
              config.baseRgbTolerance *
                1.35
            ),
        }
      );

    if (fallback) {
      models.push(
        fallback
      );

      usedFallbackModel =
        true;
    }
  }

  const deduplicated =
    deduplicateModelsV3(
      models,
      config
    );

  deduplicated.sort(
    (
      first,
      second
    ) => {
      const firstScore =
        first.confidence *
        first.weight;

      const secondScore =
        second.confidence *
        second.weight;

      return (
        secondScore -
        firstScore
      );
    }
  );

  return {
    models:
      deduplicated,

    statistics,

    clusters,

    usedFallbackModel,

    detectedShadowModel,

    detectedHighlightModel,
  };
}

/* =========================================================
 * Model spatial matching
 * ======================================================= */

function calculateModelSpatialPenaltyV3(
  model:
    BackgroundUnderstandingColorModelV3,
  x: number,
  y: number,
  width: number,
  height: number
): number {
  if (
    !model.spatialCenter ||
    model.spatialRadiusRatio >=
      0.99
  ) {
    return 0;
  }

  const distance =
    getNormalizedDistanceV3(
      x,
      y,
      model.spatialCenter.x,
      model.spatialCenter.y,
      width,
      height
    );

  if (
    distance <=
    model.spatialRadiusRatio
  ) {
    return 0;
  }

  return clampUnitValue(
    (
      distance -
      model.spatialRadiusRatio
    ) /
      Math.max(
        BACKGROUND_UNDERSTANDING_EPSILON_V3,
        1 -
          model.spatialRadiusRatio
      )
  );
}

/* =========================================================
 * Shadow and highlight matching
 * ======================================================= */

function isShadowColorMatchV3(
  sample:
    BackgroundUnderstandingColorSampleV3,
  model:
    BackgroundUnderstandingColorModelV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): boolean {
  if (
    !config.detectShadows ||
    model.kind !==
      'shadow'
  ) {
    return false;
  }

  const luminanceInsideRange =
    sample.luminance >=
      model.luminanceMinimum &&
    sample.luminance <=
      model.luminanceMaximum;

  if (
    !luminanceInsideRange
  ) {
    return false;
  }

  const centerSample:
    BackgroundUnderstandingColorSampleV3 = {
    rgb:
      model.centerRgb,

    lab:
      model.centerLab,

    ycbcr:
      model.centerYcbcr,

    luminance:
      model.centerYcbcr.y,

    chroma:
      Math.sqrt(
        safeSquareV3(
          model.centerYcbcr.cb -
            0.5
        ) +
        safeSquareV3(
          model.centerYcbcr.cr -
            0.5
        )
      ),

    saturation:
      calculateSaturationV3(
        model.centerRgb
      ),
  };

  return (
    calculateChromaDistanceV3(
      sample,
      centerSample
    ) <=
    config.shadowMaximumChromaDifference
  );
}

function isHighlightColorMatchV3(
  sample:
    BackgroundUnderstandingColorSampleV3,
  model:
    BackgroundUnderstandingColorModelV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): boolean {
  if (
    !config.detectHighlights ||
    model.kind !==
      'highlight'
  ) {
    return false;
  }

  if (
    sample.luminance <
    config.highlightMinimumLuminance
  ) {
    return false;
  }

  return (
    sample.chroma <=
      config.highlightMaximumChroma ||
    calculateRgbDistanceV3(
      sample.rgb,
      model.centerRgb
    ) <=
      model.rgbTolerance
  );
}

/* =========================================================
 * Model matching
 * ======================================================= */

function matchSampleToModelV3(
  sample:
    BackgroundUnderstandingColorSampleV3,
  localTexture: number,
  model:
    BackgroundUnderstandingColorModelV3,
  x: number,
  y: number,
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingModelMatchV3 {
  const labDistance =
    calculateLabDistanceV3(
      sample.lab,
      model.centerLab
    );

  const rgbDistance =
    calculateRgbDistanceV3(
      sample.rgb,
      model.centerRgb
    );

  const luminanceDistance =
    Math.abs(
      sample.luminance -
      model.centerYcbcr.y
    );

  const sampleChromaCenter =
    Math.sqrt(
      safeSquareV3(
        sample.ycbcr.cb -
          0.5
      ) +
      safeSquareV3(
        sample.ycbcr.cr -
          0.5
      )
    );

  const modelChromaCenter =
    Math.sqrt(
      safeSquareV3(
        model.centerYcbcr.cb -
          0.5
      ) +
      safeSquareV3(
        model.centerYcbcr.cr -
          0.5
      )
    );

  const chromaDistance =
    Math.abs(
      sampleChromaCenter -
      modelChromaCenter
    );

  const textureDistance =
    Math.abs(
      localTexture -
      Math.min(
        localTexture,
        model.textureTolerance *
          0.5
      )
    );

  const spatialPenalty =
    calculateModelSpatialPenaltyV3(
      model,
      x,
      y,
      width,
      height
    );

  const labConfidence =
    confidenceFromDistanceV3(
      labDistance,
      model.labTolerance
    );

  const rgbConfidence =
    confidenceFromDistanceV3(
      rgbDistance,
      model.rgbTolerance
    );

  const luminanceConfidence =
    confidenceFromDistanceV3(
      luminanceDistance,
      model.luminanceTolerance
    );

  const chromaConfidence =
    confidenceFromDistanceV3(
      chromaDistance,
      model.chromaTolerance
    );

  const textureConfidence =
    confidenceFromDistanceV3(
      textureDistance,
      model.textureTolerance
    );

  const shadowMatch =
    isShadowColorMatchV3(
      sample,
      model,
      config
    );

  const highlightMatch =
    isHighlightColorMatchV3(
      sample,
      model,
      config
    );

  let confidence =
    weightedAverageV3(
      [
        labConfidence,
        rgbConfidence,
        luminanceConfidence,
        chromaConfidence,
        textureConfidence,
        1 -
          spatialPenalty,
      ],
      [
        config.labDistanceWeight,
        config.rgbDistanceWeight,
        config.luminanceDistanceWeight,
        config.chromaDistanceWeight,
        config.textureDistanceWeight,
        config.spatialPriorWeight,
      ],
      0
    );

  if (shadowMatch) {
    confidence =
      Math.max(
        confidence,
        0.7
      );
  }

  if (highlightMatch) {
    confidence =
      Math.max(
        confidence,
        0.66
      );
  }

  confidence *=
    clampUnitValue(
      0.45 +
      model.confidence *
        0.35 +
      model.weight *
        0.2
    );

  return {
    modelId:
      model.id,

    modelKind:
      model.kind,

    confidence:
      clampUnitValue(
        confidence
      ),

    labDistance,

    rgbDistance,

    luminanceDistance,

    chromaDistance,

    textureDistance,

    spatialPenalty,

    shadowMatch,

    highlightMatch,
  };
}

/* =========================================================
 * Best model matching
 * ======================================================= */

function findBestModelMatchV3(
  sample:
    BackgroundUnderstandingColorSampleV3,
  localTexture: number,
  models:
    readonly BackgroundUnderstandingColorModelV3[],
  x: number,
  y: number,
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingModelMatchV3 | null {
  let best:
    BackgroundUnderstandingModelMatchV3 | null = null;

  for (
    const model of models
  ) {
    if (
      !model.enabled
    ) {
      continue;
    }

    const match =
      matchSampleToModelV3(
        sample,
        localTexture,
        model,
        x,
        y,
        width,
        height,
        config
      );

    if (
      !best ||
      match.confidence >
        best.confidence
    ) {
      best =
        match;
    }
  }

  return best;
}

/* =========================================================
 * Background distribution classification
 * ======================================================= */

function classifyBackgroundDistributionV3(
  statistics:
    BackgroundUnderstandingColorStatisticsV3,
  clusterCount: number,
  meanTexture: number
): BackgroundUnderstandingDistributionV3 {
  if (
    statistics.count <= 0
  ) {
    return 'uncertain';
  }

  const colorVariation =
    clampUnitValue(
      calculateLabVariationV3(
        statistics
      ) *
        1.8 +
      statistics
        .luminanceStandardDeviation *
        1.1
    );

  if (
    clusterCount <= 1 &&
    colorVariation < 0.08 &&
    meanTexture < 0.08
  ) {
    return 'uniform';
  }

  if (
    clusterCount <= 2 &&
    statistics
      .luminanceStandardDeviation >
        0.06 &&
    statistics
      .chromaStandardDeviation <
        0.08 &&
    meanTexture < 0.14
  ) {
    return 'smooth-gradient';
  }

  if (
    meanTexture >
    0.18
  ) {
    return 'textured';
  }

  if (
    clusterCount >= 2
  ) {
    return 'multi-region';
  }

  return 'uncertain';
}

/* =========================================================
 * Mean seed texture
 * ======================================================= */

function calculateMeanSeedTextureV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[]
): number {
  if (
    seeds.length === 0
  ) {
    return 0;
  }

  let sum =
    0;

  let weightSum =
    0;

  for (
    const seed of seeds
  ) {
    const weight =
      Math.max(
        0.01,
        seed.confidence
      );

    sum +=
      seed.localTexture *
      weight;

    weightSum +=
      weight;
  }

  return clampUnitValue(
    safeSegmentationDivide(
      sum,
      weightSum,
      0
    )
  );
}
// scan/core/ai/BackgroundUnderstandingV3.ts
// Part 3/4
//
// يكمل مباشرة بعد:
//
// function calculateMeanSeedTextureV3(
//   seeds:
//     readonly BackgroundUnderstandingSeedV3[]
// ): number {
//   ...
// }

/* =========================================================
 * Probability map build result
 * ======================================================= */

type BackgroundUnderstandingProbabilityBuildResultV3 = {
  probableBackgroundPixels: number;

  probableForegroundPixels: number;

  uncertainPixels: number;

  meanBackgroundConfidence: number;

  meanForegroundEvidence: number;
};

/* =========================================================
 * Edge barrier build result
 * ======================================================= */

type BackgroundUnderstandingEdgeBarrierBuildResultV3 = {
  strongEdgePixels: number;

  meanBarrier: number;
};

/* =========================================================
 * Region growing result
 * ======================================================= */

type BackgroundUnderstandingRegionGrowingResultV3 = {
  acceptedPixelCount: number;

  passAcceptedCounts:
    readonly number[];

  queuedPixelCount: number;

  rejectedByConfidenceCount: number;

  rejectedByGradientCount: number;

  rejectedByBarrierCount: number;

  rejectedByNeighbourColorCount: number;

  rejectedByForegroundCount: number;
};

/* =========================================================
 * Flood fill result
 * ======================================================= */

type BackgroundUnderstandingFloodFillResultV3 = {
  connectedPixelCount: number;

  initialSeedPixelCount: number;

  expandedPixelCount: number;

  rejectedPixelCount: number;

  maximumQueueLength: number;
};

/* =========================================================
 * Queue implementation
 * ======================================================= */

type BackgroundUnderstandingIndexQueueV3 = {
  data: Int32Array;

  head: number;

  tail: number;

  size: number;

  capacity: number;
};

function createIndexQueueV3(
  capacity: number
): BackgroundUnderstandingIndexQueueV3 {
  const safeCapacity =
    Math.max(
      1,
      Math.floor(
        capacity
      )
    );

  return {
    data:
      new Int32Array(
        safeCapacity
      ),

    head: 0,

    tail: 0,

    size: 0,

    capacity:
      safeCapacity,
  };
}

function isQueueEmptyV3(
  queue:
    BackgroundUnderstandingIndexQueueV3
): boolean {
  return (
    queue.size <= 0
  );
}

function enqueueIndexV3(
  queue:
    BackgroundUnderstandingIndexQueueV3,
  index: number
): boolean {
  if (
    queue.size >=
    queue.capacity
  ) {
    return false;
  }

  queue.data[
    queue.tail
  ] =
    index;

  queue.tail =
    (
      queue.tail + 1
    ) %
    queue.capacity;

  queue.size +=
    1;

  return true;
}

function dequeueIndexV3(
  queue:
    BackgroundUnderstandingIndexQueueV3
): number {
  if (
    queue.size <= 0
  ) {
    return -1;
  }

  const value =
    queue.data[
      queue.head
    ];

  queue.head =
    (
      queue.head + 1
    ) %
    queue.capacity;

  queue.size -=
    1;

  return value;
}

/* =========================================================
 * Map wrapper helpers
 * ======================================================= */

function createFloatMapV3(
  width: number,
  height: number,
  data: Float32Array
): BackgroundUnderstandingMapV3 {
  return {
    width,

    height,

    data,
  };
}

function createByteMapV3(
  width: number,
  height: number,
  data: Uint8Array
): BackgroundUnderstandingByteMapV3 {
  return {
    width,

    height,

    data,
  };
}

/* =========================================================
 * Scene reasoning primitive results
 * ======================================================= */

type BackgroundUnderstandingLargestSubjectResultV3 = {
  componentCount: number;

  largestComponentPixelCount: number;

  totalForegroundPixelCount: number;

  largestComponentRatio: number;

  threshold: number;

  seedIndex: number;
};

type BackgroundUnderstandingBorderReachabilityResultV3 = {
  reachedPixelCount: number;

  strongReachabilityPixelCount: number;

  meanReachability: number;

  maximumQueueLength: number;
};

/* =========================================================
 * Scene reasoning map reset
 * ======================================================= */

function resetSceneReasoningMapsV3(
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  maps.largestSubjectMap.fill(
    0
  );

  maps.borderReachabilityMap.fill(
    0
  );

  maps.largeSurfaceMap.fill(
    0
  );

  maps.planarSurfaceMap.fill(
    0
  );

  maps.structuralLineMap.fill(
    0
  );

  maps.cornerEvidenceMap.fill(
    0
  );

  maps.backgroundContinuationMap.fill(
    0
  );

  maps.shadowConnectivityMap.fill(
    0
  );

  maps.illuminationGradientMap.fill(
    0
  );

  maps.foldLikelihoodMap.fill(
    0
  );

  maps.objectProtectionMap.fill(
    0
  );

  maps.multiEvidenceConsensusMap.fill(
    0
  );
}

/* =========================================================
 * Largest subject threshold
 * ======================================================= */

function calculateLargestSubjectThresholdV3(
  mask:
    SegmentationFloatMask,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  const pixelCount =
    mask.width *
    mask.height;

  if (
    pixelCount <= 0
  ) {
    return 0.5;
  }

  let strongForegroundCount =
    0;

  let probableForegroundCount =
    0;

  let maskSum =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const value =
      clampUnitValue(
        mask.data[index]
      );

    maskSum +=
      value;

    if (
      value >=
      config.strongForegroundMaskThreshold
    ) {
      strongForegroundCount +=
        1;
    }

    if (
      value >= 0.42
    ) {
      probableForegroundCount +=
        1;
    }
  }

  const meanMask =
    safeSegmentationDivide(
      maskSum,
      pixelCount,
      0
    );

  const strongRatio =
    safeSegmentationDivide(
      strongForegroundCount,
      pixelCount,
      0
    );

  const probableRatio =
    safeSegmentationDivide(
      probableForegroundCount,
      pixelCount,
      0
    );

  let threshold =
    0.46;

  if (
    strongRatio >= 0.04 &&
    strongRatio <= 0.72
  ) {
    threshold =
      Math.max(
        0.44,
        config
          .strongForegroundMaskThreshold *
          0.62
      );
  }

  if (
    probableRatio < 0.015
  ) {
    threshold =
      0.36;
  } else if (
    probableRatio > 0.86
  ) {
    threshold =
      Math.max(
        threshold,
        0.56
      );
  }

  if (
    meanMask < 0.12
  ) {
    threshold -=
      0.05;
  } else if (
    meanMask > 0.68
  ) {
    threshold +=
      0.06;
  }

  return clampSegmentationValue(
    threshold,
    0.3,
    0.68
  );
}

/* =========================================================
 * Largest foreground component discovery
 * ======================================================= */

function discoverLargestForegroundComponentV3(
  mask:
    SegmentationFloatMask,
  threshold: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingLargestSubjectResultV3 {
  const width =
    mask.width;

  const height =
    mask.height;

  const pixelCount =
    width *
    height;

  const visited =
    new Uint8Array(
      pixelCount
    );

  const queue =
    createIndexQueueV3(
      pixelCount
    );

  const neighbours =
    BACKGROUND_UNDERSTANDING_NEIGHBOURS_8_V3;

  let componentCount =
    0;

  let largestComponentPixelCount =
    0;

  let totalForegroundPixelCount =
    0;

  let largestSeedIndex =
    -1;

  let processedPixelCount =
    0;

  for (
    let startIndex = 0;
    startIndex < pixelCount;
    startIndex += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      startIndex,
      config.cancellationCheckInterval
    );

    if (
      visited[startIndex] !== 0
    ) {
      continue;
    }

    if (
      clampUnitValue(
        mask.data[startIndex]
      ) <
      threshold
    ) {
      visited[startIndex] =
        1;

      continue;
    }

    componentCount +=
      1;

    queue.head =
      0;

    queue.tail =
      0;

    queue.size =
      0;

    visited[startIndex] =
      1;

    enqueueIndexV3(
      queue,
      startIndex
    );

    let componentPixelCount =
      0;

    while (
      !isQueueEmptyV3(
        queue
      )
    ) {
      const currentIndex =
        dequeueIndexV3(
          queue
        );

      if (
        currentIndex < 0
      ) {
        break;
      }

      componentPixelCount +=
        1;

      totalForegroundPixelCount +=
        1;

      processedPixelCount +=
        1;

      checkCancellationV3(
        cancellationSignal,
        processedPixelCount,
        config.cancellationCheckInterval
      );

      const currentX =
        currentIndex %
        width;

      const currentY =
        Math.floor(
          currentIndex /
          width
        );

      for (
        const neighbour of neighbours
      ) {
        const neighbourX =
          currentX +
          neighbour[0];

        const neighbourY =
          currentY +
          neighbour[1];

        if (
          !isInsideImageV3(
            neighbourX,
            neighbourY,
            width,
            height
          )
        ) {
          continue;
        }

        const neighbourIndex =
          getPixelIndexV3(
            neighbourX,
            neighbourY,
            width
          );

        if (
          visited[neighbourIndex] !==
          0
        ) {
          continue;
        }

        if (
          clampUnitValue(
            mask.data[
              neighbourIndex
            ]
          ) <
          threshold
        ) {
          visited[neighbourIndex] =
            1;

          continue;
        }

        visited[neighbourIndex] =
          1;

        enqueueIndexV3(
          queue,
          neighbourIndex
        );
      }
    }

    if (
      componentPixelCount >
      largestComponentPixelCount
    ) {
      largestComponentPixelCount =
        componentPixelCount;

      largestSeedIndex =
        startIndex;
    }
  }

  return {
    componentCount,

    largestComponentPixelCount,

    totalForegroundPixelCount,

    largestComponentRatio:
      safeSegmentationDivide(
        largestComponentPixelCount,
        Math.max(
          1,
          totalForegroundPixelCount
        ),
        0
      ),

    threshold,

    seedIndex:
      largestSeedIndex,
  };
}

/* =========================================================
 * Largest subject map construction
 * ======================================================= */

function markLargestForegroundComponentV3(
  mask:
    SegmentationFloatMask,
  output:
    Uint8Array,
  seedIndex: number,
  threshold: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): number {
  output.fill(
    0
  );

  const width =
    mask.width;

  const height =
    mask.height;

  const pixelCount =
    width *
    height;

  if (
    seedIndex < 0 ||
    seedIndex >= pixelCount ||
    clampUnitValue(
      mask.data[seedIndex]
    ) <
    threshold
  ) {
    return 0;
  }

  const queue =
    createIndexQueueV3(
      pixelCount
    );

  const neighbours =
    BACKGROUND_UNDERSTANDING_NEIGHBOURS_8_V3;

  output[seedIndex] =
    1;

  enqueueIndexV3(
    queue,
    seedIndex
  );

  let markedPixelCount =
    0;

  while (
    !isQueueEmptyV3(
      queue
    )
  ) {
    const currentIndex =
      dequeueIndexV3(
        queue
      );

    if (
      currentIndex < 0
    ) {
      break;
    }

    markedPixelCount +=
      1;

    checkCancellationV3(
      cancellationSignal,
      markedPixelCount,
      config.cancellationCheckInterval
    );

    const currentX =
      currentIndex %
      width;

    const currentY =
      Math.floor(
        currentIndex /
        width
      );

    for (
      const neighbour of neighbours
    ) {
      const neighbourX =
        currentX +
        neighbour[0];

      const neighbourY =
        currentY +
        neighbour[1];

      if (
        !isInsideImageV3(
          neighbourX,
          neighbourY,
          width,
          height
        )
      ) {
        continue;
      }

      const neighbourIndex =
        getPixelIndexV3(
          neighbourX,
          neighbourY,
          width
        );

      if (
        output[neighbourIndex] !==
        0
      ) {
        continue;
      }

      if (
        clampUnitValue(
          mask.data[
            neighbourIndex
          ]
        ) <
        threshold
      ) {
        continue;
      }

      output[neighbourIndex] =
        1;

      enqueueIndexV3(
        queue,
        neighbourIndex
      );
    }
  }

  return markedPixelCount;
}

/* =========================================================
 * Largest subject protection map
 * ======================================================= */

function buildLargestSubjectProtectionMapV3(
  mask:
    SegmentationFloatMask,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingLargestSubjectResultV3 {
  const threshold =
    calculateLargestSubjectThresholdV3(
      mask,
      config
    );

  const discovery =
    discoverLargestForegroundComponentV3(
      mask,
      threshold,
      config,
      cancellationSignal
    );

  const markedPixelCount =
    markLargestForegroundComponentV3(
      mask,
      maps.largestSubjectMap,
      discovery.seedIndex,
      threshold,
      config,
      cancellationSignal
    );

  const pixelCount =
    mask.width *
    mask.height;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      index,
      config.cancellationCheckInterval
    );

    if (
      maps.largestSubjectMap[index] ===
      0
    ) {
      continue;
    }

    const maskValue =
      clampUnitValue(
        mask.data[index]
      );

    const gradient =
      clampUnitValue(
        maps.gradient[index]
      );

    const texture =
      clampUnitValue(
        maps.texture[index]
      );

    const maskProtection =
      smoothStepV3(
        threshold *
          0.82,
        Math.max(
          threshold +
            0.12,
          config
            .strongForegroundMaskThreshold
        ),
        maskValue
      );

    const structuralProtection =
      clampUnitValue(
        gradient *
          0.56 +
        texture *
          0.24 +
        maskProtection *
          0.72
      );

    maps.objectProtectionMap[index] =
      clampUnitValue(
        Math.max(
          0.58,
          structuralProtection
        )
      );
  }

  return {
    ...discovery,

    largestComponentPixelCount:
      markedPixelCount,
  };
}

/* =========================================================
 * Scene reasoning helpers
 * ======================================================= */

function clearSceneReasoningMapsV3(
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  maps.borderReachabilityMap.fill(
    0
  );

  maps.largeSurfaceMap.fill(
    0
  );

  maps.planarSurfaceMap.fill(
    0
  );

  maps.structuralLineMap.fill(
    0
  );

  maps.cornerEvidenceMap.fill(
    0
  );

  maps.backgroundContinuationMap.fill(
    0
  );

  maps.shadowConnectivityMap.fill(
    0
  );

  maps.illuminationGradientMap.fill(
    0
  );

  maps.foldLikelihoodMap.fill(
    0
  );

  maps.objectProtectionMap.fill(
    0
  );

  maps.multiEvidenceConsensusMap.fill(
    0
  );
}

/* =========================================================
 * Border reachability
 * ======================================================= */

function buildBorderReachabilityMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): void {
  const queue =
    createIndexQueueV3(
      width * height
    );

  const visited =
    new Uint8Array(
      width * height
    );

  const push =
    (
      x: number,
      y: number
    ): void => {
      const index =
        getPixelIndexV3(
          x,
          y,
          width
        );

      if (
        visited[index] !== 0
      ) {
        return;
      }

      visited[index] = 1;

      enqueueIndexV3(
        queue,
        index
      );

      maps.borderReachabilityMap[
        index
      ] = 1;
    };

  for (
    let x = 0;
    x < width;
    x++
  ) {
    push(
      x,
      0
    );

    push(
      x,
      height - 1
    );
  }

  for (
    let y = 1;
    y < height - 1;
    y++
  ) {
    push(
      0,
      y
    );

    push(
      width - 1,
      y
    );
  }

  while (
    !isQueueEmptyV3(
      queue
    )
  ) {
    cancellationSignal?.throwIfCancelled();

    const current =
      dequeueIndexV3(
        queue
      );

    if (
      current < 0
    ) {
      break;
    }

    const x =
      current % width;

    const y =
      Math.floor(
        current /
          width
      );

    const confidence =
      maps.borderReachabilityMap[
        current
      ];

    for (
      const neighbour of
        BACKGROUND_UNDERSTANDING_NEIGHBOURS_8_V3
    ) {
      const nx =
        x +
        neighbour[0];

      const ny =
        y +
        neighbour[1];

      if (
        !isInsideImageV3(
          nx,
          ny,
          width,
          height
        )
      ) {
        continue;
      }

      const neighbourIndex =
        getPixelIndexV3(
          nx,
          ny,
          width
        );

      if (
        visited[
          neighbourIndex
        ] !== 0
      ) {
        continue;
      }

      const attenuation =
        0.96 -
        maps.gradient[
          neighbourIndex
        ] *
          0.20 -
        maps.edgeBarrier[
          neighbourIndex
        ] *
          0.18;

      const propagated =
        confidence *
        Math.max(
          0.2,
          attenuation
        );

      if (
        propagated <
        0.05
      ) {
        continue;
      }

      visited[
        neighbourIndex
      ] = 1;

      maps.borderReachabilityMap[
        neighbourIndex
      ] =
        propagated;

      enqueueIndexV3(
        queue,
        neighbourIndex
      );
    }
  }
}

/* =========================================================
 * Large planar surfaces
 * ======================================================= */

function buildLargeSurfaceMapsV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index++
  ) {
    const gradient =
      clampUnitValue(
        maps.gradient[index]
      );

    const texture =
      clampUnitValue(
        maps.texture[index]
      );

    const reachability =
      clampUnitValue(
        maps.borderReachabilityMap[
          index
        ]
      );

    const smoothness =
      clampUnitValue(
        1 -
        (
          gradient *
            0.62 +
          texture *
            0.38
        )
      );

    const planar =
      clampUnitValue(
        smoothness *
        (
          0.55 +
          reachability *
            0.45
        )
      );

    maps.planarSurfaceMap[
      index
    ] =
      planar;

    maps.largeSurfaceMap[
      index
    ] =
      clampUnitValue(
        planar *
        (
          0.65 +
          reachability *
            0.35
        )
      );
  }
}

/* =========================================================
 * Structural line estimation
 * ======================================================= */

function buildStructuralLineMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  for (
    let y = 1;
    y < height - 1;
    y += 1
  ) {
    const rowOffset =
      y * width;

    for (
      let x = 1;
      x < width - 1;
      x += 1
    ) {
      const index =
        rowOffset + x;

      const gx =
        Math.abs(
          maps.gradient[
            index + 1
          ] -
          maps.gradient[
            index - 1
          ]
        );

      const gy =
        Math.abs(
          maps.gradient[
            index + width
          ] -
          maps.gradient[
            index - width
          ]
        );

      const edgeStrength =
        Math.max(
          gx,
          gy
        );

      const texturePenalty =
        maps.texture[index] *
        0.35;

      maps.structuralLineMap[
        index
      ] =
        clampUnitValue(
          edgeStrength *
            (
              1 -
              texturePenalty
            )
        );
    }
  }
}

/* =========================================================
 * Corner estimation
 * ======================================================= */

function buildCornerEvidenceMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  for (
    let y = 1;
    y < height - 1;
    y++
  ) {
    const row =
      y * width;

    for (
      let x = 1;
      x < width - 1;
      x++
    ) {
      const index =
        row + x;

      const horizontal =
        Math.abs(
          maps.gradient[
            index + 1
          ] -
          maps.gradient[
            index - 1
          ]
        );

      const vertical =
        Math.abs(
          maps.gradient[
            index + width
          ] -
          maps.gradient[
            index - width
          ]
        );

      maps.cornerEvidenceMap[
        index
      ] =
        clampUnitValue(
          Math.min(
            horizontal,
            vertical
          ) *
            1.8
        );
    }
  }
}

/* =========================================================
 * Background continuation
 * ======================================================= */

function buildBackgroundContinuationMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index++
  ) {
    const reach =
      maps.borderReachabilityMap[
        index
      ];

    const planar =
      maps.planarSurfaceMap[
        index
      ];

    const structure =
      maps.structuralLineMap[
        index
      ];

    maps.backgroundContinuationMap[
      index
    ] =
      clampUnitValue(
        reach *
          0.55 +
        planar *
          0.35 +
        (
          1 -
          structure
        ) *
          0.10
      );
  }
}

/* =========================================================
 * Shadow connectivity
 * ======================================================= */

function buildShadowConnectivityMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index++
  ) {
    const planar =
      maps.planarSurfaceMap[
        index
      ];

    const continuation =
      maps.backgroundContinuationMap[
        index
      ];

    const gradient =
      maps.gradient[index];

    maps.shadowConnectivityMap[
      index
    ] =
      clampUnitValue(
        planar *
          0.45 +
        continuation *
          0.40 +
        (
          1 -
          gradient
        ) *
          0.15
      );
  }
}

/* =========================================================
 * Illumination gradient
 * ======================================================= */

function buildIlluminationGradientMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  for (
    let y = 1;
    y < height - 1;
    y++
  ) {
    const row =
      y * width;

    for (
      let x = 1;
      x < width - 1;
      x++
    ) {
      const index =
        row + x;

      const north =
        maps.planarSurfaceMap[
          index - width
        ];

      const south =
        maps.planarSurfaceMap[
          index + width
        ];

      const east =
        maps.planarSurfaceMap[
          index + 1
        ];

      const west =
        maps.planarSurfaceMap[
          index - 1
        ];

      const change =
        (
          Math.abs(
            north -
              south
          ) +
          Math.abs(
            east -
              west
          )
        ) *
        0.5;

      maps.illuminationGradientMap[
        index
      ] =
        clampUnitValue(
          1 -
          change
        );
    }
  }
}

/* =========================================================
 * Fold likelihood
 * ======================================================= */

function buildFoldLikelihoodMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index++
  ) {
    const structure =
      maps.structuralLineMap[
        index
      ];

    const corner =
      maps.cornerEvidenceMap[
        index
      ];

    const texture =
      maps.texture[index];

    maps.foldLikelihoodMap[
      index
    ] =
      clampUnitValue(
        structure *
          0.45 +
        corner *
          0.35 +
        texture *
          0.20
      );
  }
}

/* =========================================================
 * Multi-evidence consensus
 * ======================================================= */

function buildMultiEvidenceConsensusMapV3(
  width: number,
  height: number,
  maps:
    BackgroundUnderstandingInternalMapsV3
): void {
  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index++
  ) {
    maps.multiEvidenceConsensusMap[
      index
    ] =
      clampUnitValue(
        maps.backgroundContinuationMap[
          index
        ] *
          0.30 +
        maps.shadowConnectivityMap[
          index
        ] *
          0.20 +
        maps.largeSurfaceMap[
          index
        ] *
          0.20 +
        maps.planarSurfaceMap[
          index
        ] *
          0.15 +
        (
          1 -
          maps.foldLikelihoodMap[
            index
          ]
        ) *
          0.15
      );
  }
}

/* =========================================================
 * Neighbour helpers
 * ======================================================= */

function getNeighbourOffsetsV3(
  useEightConnectivity: boolean
): readonly (
  readonly [
    number,
    number,
  ]
)[] {
  return useEightConnectivity
    ? BACKGROUND_UNDERSTANDING_NEIGHBOURS_8_V3
    : BACKGROUND_UNDERSTANDING_NEIGHBOURS_4_V3;
}

function isDiagonalNeighbourV3(
  dx: number,
  dy: number
): boolean {
  return (
    dx !== 0 &&
    dy !== 0
  );
}

/* =========================================================
 * Border prior
 * ======================================================= */

function calculateBorderPriorV3(
  x: number,
  y: number,
  width: number,
  height: number,
  borderBandPixels: number
): number {
  const distance =
    getDistanceToBorderPixelsV3(
      x,
      y,
      width,
      height
    );

  const relaxedBand =
    Math.max(
      1,
      borderBandPixels *
        4
    );

  return inverseSmoothStepV3(
    borderBandPixels,
    relaxedBand,
    distance
  );
}

/* =========================================================
 * Subject spatial prior
 * ======================================================= */

function calculateSubjectSpatialForegroundPriorV3(
  x: number,
  y: number,
  bounds:
    SegmentationMaskBounds | null,
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  if (
    !config.useSubjectSpatialPrior ||
    !bounds
  ) {
    return 0;
  }

  if (
    isInsideBoundsV3(
      x,
      y,
      bounds
    )
  ) {
    const centerX =
      (
        bounds.x +
        bounds.x2
      ) * 0.5;

    const centerY =
      (
        bounds.y +
        bounds.y2
      ) * 0.5;

    const halfWidth =
      Math.max(
        1,
        bounds.width *
          0.5
      );

    const halfHeight =
      Math.max(
        1,
        bounds.height *
          0.5
      );

    const normalizedX =
      Math.abs(
        x - centerX
      ) /
      halfWidth;

    const normalizedY =
      Math.abs(
        y - centerY
      ) /
      halfHeight;

    const ellipticalDistance =
      Math.sqrt(
        normalizedX *
          normalizedX +
        normalizedY *
          normalizedY
      ) /
      Math.SQRT2;

    return clampUnitValue(
      (
        1 -
        smoothStepV3(
          0.25,
          1,
          ellipticalDistance
        )
      ) *
      config.subjectSpatialPriorStrength
    );
  }

  const distance =
    getDistanceToBoundsV3(
      x,
      y,
      bounds
    );

  const fadeDistance =
    Math.max(
      1,
      Math.min(
        width,
        height
      ) *
        0.08
    );

  return clampUnitValue(
    (
      1 -
      smoothStepV3(
        0,
        fadeDistance,
        distance
      )
    ) *
    config.subjectSpatialPriorStrength *
    0.45
  );
}

/* =========================================================
 * Seed influence
 * ======================================================= */

function calculateNearestSeedInfluenceV3(
  x: number,
  y: number,
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  width: number,
  height: number
): number {
  if (
    seeds.length === 0
  ) {
    return 0;
  }

  let bestInfluence =
    0;

  const maximumChecks =
    Math.min(
      seeds.length,
      128
    );

  for (
    let index = 0;
    index <
      maximumChecks;
    index += 1
  ) {
    const seed =
      seeds[index];

    const distance =
      getNormalizedDistanceV3(
        x,
        y,
        seed.x,
        seed.y,
        width,
        height
      );

    const influence =
      inverseSmoothStepV3(
        0.01,
        0.24,
        distance
      ) *
      seed.confidence;

    if (
      influence >
      bestInfluence
    ) {
      bestInfluence =
        influence;
    }

    if (
      bestInfluence >=
      0.995
    ) {
      break;
    }
  }

  return clampUnitValue(
    bestInfluence
  );
}

/* =========================================================
 * Background model aggregation
 * ======================================================= */

function aggregateModelMatchesV3(
  sample:
    BackgroundUnderstandingColorSampleV3,
  localTexture: number,
  models:
    readonly BackgroundUnderstandingColorModelV3[],
  x: number,
  y: number,
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): {
  bestMatch:
    BackgroundUnderstandingModelMatchV3 | null;

  combinedConfidence: number;

  supportingModelCount: number;

  shadowSupported: boolean;

  highlightSupported: boolean;
} {
  let bestMatch:
    BackgroundUnderstandingModelMatchV3 | null = null;

  let weightedConfidenceSum =
    0;

  let weightSum =
    0;

  let supportingModelCount =
    0;

  let shadowSupported =
    false;

  let highlightSupported =
    false;

  for (
    const model of models
  ) {
    if (
      !model.enabled
    ) {
      continue;
    }

    const match =
      matchSampleToModelV3(
        sample,
        localTexture,
        model,
        x,
        y,
        width,
        height,
        config
      );

    if (
      !bestMatch ||
      match.confidence >
        bestMatch.confidence
    ) {
      bestMatch =
        match;
    }

    const modelWeight =
      Math.max(
        0.01,
        model.weight *
          model.confidence
      );

    if (
      match.confidence >=
      0.42
    ) {
      supportingModelCount +=
        1;

      weightedConfidenceSum +=
        match.confidence *
        modelWeight;

      weightSum +=
        modelWeight;
    }

    if (
      match.shadowMatch
    ) {
      shadowSupported =
        true;
    }

    if (
      match.highlightMatch
    ) {
      highlightSupported =
        true;
    }
  }

  const combinedConfidence =
    weightSum >
      BACKGROUND_UNDERSTANDING_EPSILON_V3
      ? weightedConfidenceSum /
        weightSum
      : bestMatch?.confidence ??
        0;

  const bestConfidence =
    bestMatch?.confidence ??
    0;

  return {
    bestMatch,

    combinedConfidence:
      clampUnitValue(
        Math.max(
          bestConfidence,
          combinedConfidence *
            0.92
        )
      ),

    supportingModelCount,

    shadowSupported,

    highlightSupported,
  };
}

/* =========================================================
 * Scene reasoning evidence aggregation
 * ======================================================= */

type BackgroundUnderstandingSceneEvidenceV3 = {
  borderBackgroundSupport: number;

  surfaceBackgroundSupport: number;

  structuralBackgroundSupport: number;

  connectedBackgroundSupport: number;

  continuationBackgroundSupport: number;

  lineBackgroundSupport: number;

  cornerBackgroundSupport: number;

  shadowBackgroundSupport: number;

  illuminationBackgroundSupport: number;

  consensusBackgroundSupport: number;

  consensusForegroundSupport: number;

  foregroundProtection: number;

  structuralProtection: number;

  thinStructureProtection: number;

  foldForegroundSupport: number;
};


function calculateSceneBackgroundSupportV3(
  scene:
    BackgroundUnderstandingSceneEvidenceV3
): number {
  return clampUnitValue(
    weightedAverageV3(
      [
        scene.continuationBackgroundSupport,
        scene.surfaceBackgroundSupport,
        scene.borderBackgroundSupport,
        scene.shadowBackgroundSupport,
        scene.illuminationBackgroundSupport,
        scene.consensusBackgroundSupport,
      ],
      [
        0.25,
        0.19,
        0.2,
        0.11,
        0.1,
        0.15,
      ],
      0
    )
  );
}

function calculateSceneForegroundSupportV3(
  scene:
    BackgroundUnderstandingSceneEvidenceV3
): number {
  return clampUnitValue(
    weightedAverageV3(
      [
        scene.foregroundProtection,
        scene.structuralProtection,
        scene.thinStructureProtection,
        scene.foldForegroundSupport,
      ],
      [
        0.38,
        0.2,
        0.27,
        0.15,
      ],
      0
    )
  );
}

function calculateSceneReasoningEvidenceV3(
  index: number,
  maps: BackgroundUnderstandingInternalMapsV3
): BackgroundUnderstandingSceneEvidenceV3 {
  const borderBackgroundSupport =
    clampUnitValue(
      maps.borderReachabilityMap[index]
    );

  const surfaceBackgroundSupport =
    clampUnitValue(
      maps.largeSurfaceMap[index]
    );

  const lineBackgroundSupport =
    clampUnitValue(
      maps.structuralLineMap[index]
    );

  const cornerBackgroundSupport =
    clampUnitValue(
      maps.cornerEvidenceMap[index]
    );

  const continuationBackgroundSupport =
    clampUnitValue(
      maps.backgroundContinuationMap[index]
    );

  const shadowBackgroundSupport =
    clampUnitValue(
      maps.shadowConnectivityMap[index]
    );

  const illuminationBackgroundSupport =
    clampUnitValue(
      maps.illuminationGradientMap[index]
    );

  const foldForegroundSupport =
    clampUnitValue(
      maps.foldLikelihoodMap[index]
    );

  const consensusBackgroundSupport =
    clampUnitValue(
      maps.multiEvidenceConsensusMap[index]
    );

  /*
   * الخطوط والزوايا والأسطح الكبيرة معًا
   * تعتبر دليلًا قويًا على بنية الخلفية.
   */
  const structuralBackgroundSupport =
    clampUnitValue(
      weightedAverageV3(
        [
          lineBackgroundSupport,
          cornerBackgroundSupport,
          surfaceBackgroundSupport,
        ],
        [
          0.40,
          0.25,
          0.35,
        ],
        surfaceBackgroundSupport
      )
    );

  /*
   * امتداد الخلفية الحقيقي.
   */
  const connectedBackgroundSupport =
    clampUnitValue(
      weightedAverageV3(
        [
          borderBackgroundSupport,
          continuationBackgroundSupport,
          consensusBackgroundSupport,
        ],
        [
          0.34,
          0.33,
          0.33,
        ],
        continuationBackgroundSupport
      )
    );

  /*
   * حماية الجسم تعتمد على الطيات
   * وعدم اتفاق الخرائط على أنها خلفية.
   */
  const foregroundProtection =
    clampUnitValue(
      weightedAverageV3(
        [
          foldForegroundSupport,
          1 - consensusBackgroundSupport,
          1 - borderBackgroundSupport,
        ],
        [
          0.45,
          0.35,
          0.20,
        ],
        foldForegroundSupport
      )
    );

    /*
   * توافق عدة أدلة على أن الـPixel تابع للجسم.
   *
   * لا نعتمد على Fold وحده، بل نشترط أيضًا:
   *
   * - ضعف اتصال الـPixel بالخلفية الخارجية.
   * - ضعف استمرار سطح الخلفية خلاله.
   * - وجود حماية بنيوية أو Fold محتمل.
   */
  const consensusForegroundSupport =
    clampUnitValue(
      weightedAverageV3(
        [
          foregroundProtection,
          foldForegroundSupport,
          1 -
            consensusBackgroundSupport,
          1 -
            connectedBackgroundSupport,
          1 -
            continuationBackgroundSupport,
        ],
        [
          0.3,
          0.24,
          0.2,
          0.14,
          0.12,
        ],
        foregroundProtection
      )
    );

  /*
   * حماية الخطوط الرفيعة.
   */
const thinStructureProtection =
    clampUnitValue(
      weightedAverageV3(
        [
          foldForegroundSupport,
          consensusForegroundSupport,
          lineBackgroundSupport *
            (
              1 -
              connectedBackgroundSupport
            ),
          1 -
            consensusBackgroundSupport,
        ],
        [
          0.4,
          0.3,
          0.18,
          0.12,
        ],
        foldForegroundSupport
      )
    );


  /*
   * الحواف الحقيقية للجسم.
   */
  const structuralProtection =
    clampUnitValue(
      weightedAverageV3(
        [
          foregroundProtection,
          thinStructureProtection,
          consensusForegroundSupport,
          1 -
            structuralBackgroundSupport,
          1 -
            connectedBackgroundSupport,
        ],
        [
          0.28,
          0.25,
          0.22,
          0.15,
          0.1,
        ],
        foregroundProtection
      )
    );

    /*
   * اتفاق عدة أدلة مستقلة على أن المنطقة
   * تنتمي للجسم وليست امتدادًا للخلفية.
   */

  return {
    borderBackgroundSupport,

    surfaceBackgroundSupport,

    structuralBackgroundSupport,

    connectedBackgroundSupport,

    continuationBackgroundSupport,

    lineBackgroundSupport,

    cornerBackgroundSupport,

    shadowBackgroundSupport,

    illuminationBackgroundSupport,

    consensusBackgroundSupport,

    consensusForegroundSupport,

    foregroundProtection,

    structuralProtection,

    thinStructureProtection,

    foldForegroundSupport,
  };
}

/* =========================================================
 * Foreground evidence
 * ======================================================= */

function calculateForegroundEvidenceV3(
  index: number,
  maskValue: number,
  backgroundConfidence: number,
  gradient: number,
  texture: number,
  subjectSpatialPrior: number,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  const scene =
    calculateSceneReasoningEvidenceV3(
      index,
      maps
    );

  const sceneForegroundSupport =
    calculateSceneForegroundSupportV3(
      scene
    );

  const sceneBackgroundSupport =
    calculateSceneBackgroundSupportV3(
      scene
    );

  const maskEvidence =
    smoothStepV3(
      config.strongBackgroundMaskThreshold,
      config.strongForegroundMaskThreshold,
      maskValue
    );

  const inverseBackground =
    clampUnitValue(
      1 -
      backgroundConfidence
    );

  const structuralImageEvidence =
    clampUnitValue(
      gradient * 0.56 +
      texture * 0.44
    );

  const protectedStructuralEvidence =
    clampUnitValue(
      structuralImageEvidence *
      (
        0.48 +
        scene.structuralProtection *
          0.3 +
        scene.thinStructureProtection *
          0.22
      )
    );

  let foregroundEvidence =
    weightedAverageV3(
      [
        maskEvidence,
        inverseBackground,
        protectedStructuralEvidence,
        subjectSpatialPrior,
        sceneForegroundSupport,
      ],
      [
        config.inputMaskForegroundWeight,
        0.22,
        0.13,
        0.08,
        0.25,
      ],
      maskEvidence
    );

  /*
   * حماية مباشرة لأجزاء الجسم التي أثبتت عدة خرائط
   * أنها خطوط أو زوايا أو ثنيات تابعة للقطعة.
   */
  if (
    scene.foregroundProtection >=
      0.58
  ) {
    foregroundEvidence =
      Math.max(
        foregroundEvidence,

        maskValue *
          (
            0.58 +
            scene.foregroundProtection *
              0.34
          )
      );
  }

  if (
    scene.thinStructureProtection >=
      0.64 &&
    maskValue >=
      0.24
  ) {
    foregroundEvidence =
      Math.max(
        foregroundEvidence,

        0.42 +
        scene.thinStructureProtection *
          0.38 +
        maskValue *
          0.2
      );
  }

  /*
   * الخط أو الركن وحده لا يكفي.
   * لكن عند توافقه مع الماسك أو حماية الجسم
   * نرفع Foreground Evidence.
   */
  if (
    scene.structuralProtection >=
      0.62 &&
    (
      maskValue >= 0.34 ||
      scene.foregroundProtection >=
        0.58
    )
  ) {
    foregroundEvidence =
      Math.max(
        foregroundEvidence,

        0.48 +
        scene.structuralProtection *
          0.3 +
        maskValue *
          0.22
      );
  }

  /*
   * استمرار خلفية قوي ومتصل بالحواف والأسطح
   * يقلل الأدلة الكاذبة الناتجة عن Texture الخلفية.
   */
  const reliableBackgroundContinuation =
    clampUnitValue(
      sceneBackgroundSupport *
      (
        1 -
        scene.foregroundProtection *
          0.72
      )
    );

  if (
    reliableBackgroundContinuation >=
      0.52 &&
    maskValue <
      config.strongForegroundMaskThreshold
  ) {
    foregroundEvidence *=
      clampUnitValue(
        1 -
        reliableBackgroundContinuation *
          0.48
      );
  }

  /*
   * Shadow Connectivity لا يُعامل كجسم
   * عندما يكون امتدادًا واضحًا للخلفية.
   */
  if (
    scene.shadowBackgroundSupport >=
      0.58 &&
    scene.foregroundProtection <
      0.48 &&
    maskValue <
      0.62
  ) {
    foregroundEvidence *=
      clampUnitValue(
        1 -
        scene.shadowBackgroundSupport *
          0.36
      );
  }

  /*
   * تدرج الإضاءة فوق Surface مستمر غالبًا جزء
   * من الخلفية وليس حد جسم.
   */
  if (
    scene.illuminationBackgroundSupport >=
      0.6 &&
    scene.structuralProtection <
      0.5 &&
    maskValue <
      0.58
  ) {
    foregroundEvidence *=
      clampUnitValue(
        1 -
        scene.illuminationBackgroundSupport *
          0.28
      );
  }

  /*
   * لا نسمح بدليل الخلفية بإلغاء جسم قوي
   * مثبت بواسطة الماسك وحماية الجسم معًا.
   */
  const protectedMaskFloor =
    maskEvidence *
    (
      0.66 +
      scene.foregroundProtection *
        0.28
    );

  foregroundEvidence =
    Math.max(
      foregroundEvidence,
      protectedMaskFloor
    );

  return clampUnitValue(
    foregroundEvidence
  );
}

/* =========================================================
 * Uncertainty calculation
 * ======================================================= */

function calculateUncertaintyV3(
  backgroundConfidence: number,
  foregroundEvidence: number,
  supportingModelCount: number,
  gradient: number,
  maskValue: number
): number {
  const safeBackground =
    clampUnitValue(
      backgroundConfidence
    );

  const safeForeground =
    clampUnitValue(
      foregroundEvidence
    );

  const safeGradient =
    clampUnitValue(
      gradient
    );

  const safeMaskValue =
    clampUnitValue(
      maskValue
    );

  const classificationMargin =
    Math.abs(
      safeBackground -
      safeForeground
    );

  /*
   * عندما تكون نتيجة الخلفية والجسم متقاربة
   * تكون درجة عدم اليقين مرتفعة.
   */
  const classificationConflict =
    inverseSmoothStepV3(
      0.08,
      0.46,
      classificationMargin
    );

  /*
   * قلة عدد النماذج الداعمة تقلل الثقة.
   */
  const modelUncertainty =
    supportingModelCount <= 0
      ? 1
      : supportingModelCount === 1
        ? 0.48
        : supportingModelCount === 2
          ? 0.24
          : 0.1;

  /*
   * القيم الموجودة في منتصف الماسك
   * أكثر غموضًا من القيم القريبة من 0 أو 1.
   */
  const maskAmbiguity =
    clampUnitValue(
      1 -
      Math.abs(
        safeMaskValue * 2 -
        1
      )
    );

  /*
   * الحافة القوية لا تعني وحدها عدم يقين.
   * تصبح غير مؤكدة فقط عندما تكون الأدلة
   * بين الجسم والخلفية متقاربة.
   */
  const edgeConflict =
    clampUnitValue(
      safeGradient *
      classificationConflict
    );

  /*
   * لو كل من الخلفية والجسم ضعيف،
   * فهذا يعني عدم وجود دليل كافٍ للطرفين.
   */
  const evidenceWeakness =
    clampUnitValue(
      1 -
      Math.max(
        safeBackground,
        safeForeground
      )
    );

  /*
   * لو الطرفان مرتفعان معًا، توجد أدلة
   * متعارضة تحتاج إلى الحذر.
   */
  const competingEvidence =
    clampUnitValue(
      Math.min(
        safeBackground,
        safeForeground
      ) *
      1.35
    );

  let uncertainty =
    weightedAverageV3(
      [
        classificationConflict,
        modelUncertainty,
        maskAmbiguity,
        edgeConflict,
        evidenceWeakness,
        competingEvidence,
      ],
      [
        0.34,
        0.14,
        0.16,
        0.12,
        0.1,
        0.14,
      ],
      classificationConflict
    );

  /*
   * Foreground أو Background قوية بفارق واضح
   * تقلل عدم اليقين.
   */
  if (
    classificationMargin >=
      0.34 &&
    Math.max(
      safeBackground,
      safeForeground
    ) >=
      0.68
  ) {
    uncertainty *=
      0.58;
  }

  /*
   * الماسك القوي لا يكفي منفردًا،
   * لكنه يقلل الغموض لو Foreground Evidence
   * تؤيده بالفعل.
   */
  if (
    safeMaskValue >= 0.76 &&
    safeForeground >= 0.68 &&
    safeForeground >
      safeBackground
  ) {
    uncertainty *=
      0.62;
  }

  /*
   * اتصال خلفية واضح منطقيًا يظهر هنا
   * على شكل Background Confidence قوية
   * وForeground Evidence ضعيفة.
   */
  if (
    safeBackground >= 0.72 &&
    safeForeground <= 0.4
  ) {
    uncertainty *=
      0.5;
  }

  /*
   * لا نسمح بأن تصبح المناطق المتعارضة
   * وذات الحواف القوية مؤكدة بشكل زائف.
   */
  if (
    classificationMargin < 0.12 &&
    safeGradient >= 0.42
  ) {
    uncertainty =
      Math.max(
        uncertainty,
        0.64
      );
  }

  return clampUnitValue(
    uncertainty
  );
}

/* =========================================================
 * Probability maps
 * ======================================================= */

function buildProbabilityMapsV3(
  image:
    SegmentationRgbaImageSource,
  mask:
    SegmentationFloatMask,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  models:
    readonly BackgroundUnderstandingColorModelV3[],
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  subjectBounds:
    SegmentationMaskBounds | null,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingProbabilityBuildResultV3 {
  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  const borderBand =
    getBorderBandPixelsV3(
      width,
      height,
      config
    );

  let probableBackgroundPixels =
    0;

  let probableForegroundPixels =
    0;

  let uncertainPixels =
    0;

  let backgroundConfidenceSum =
    0;

  let foregroundEvidenceSum =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      index,
      config.cancellationCheckInterval
    );

    const x =
      index % width;

    const y =
      Math.floor(
        index /
        width
      );

    const maskValue =
      clampUnitValue(
        mask.data[index]
      );

    const gradient =
      clampUnitValue(
        maps.gradient[index]
      );

    const texture =
      clampUnitValue(
        maps.texture[index]
      );

    const sourceAlpha =
      readSourceAlphaV3(
        image.rgba,
        index
      );

    /*
     * Pixel شفافة أصلًا في الصورة
     * تعتبر Background مؤكدة.
     */
    if (
      sourceAlpha <
      config.minimumSourceAlpha
    ) {
      maps.backgroundConfidence[index] =
        1;

      maps.foregroundEvidence[index] =
        0;

      maps.uncertainty[index] =
        0;

      maps.strongBackground[index] =
        1;

      maps.strongForeground[index] =
        0;

      probableBackgroundPixels +=
        1;

      backgroundConfidenceSum +=
        1;

      continue;
    }

    const sample =
      readColorSampleAtPixelV3(
        image.rgba,
        index
      );

    const modelAggregation =
      aggregateModelMatchesV3(
        sample,
        texture,
        models,
        x,
        y,
        width,
        height,
        config
      );

    const scene =
      calculateSceneReasoningEvidenceV3(
        index,
        maps
      );

    const sceneBackgroundSupport =
      calculateSceneBackgroundSupportV3(
        scene
      );

    const sceneForegroundSupport =
      calculateSceneForegroundSupportV3(
        scene
      );

    const borderPrior =
      calculateBorderPriorV3(
        x,
        y,
        width,
        height,
        borderBand
      );

    const seedInfluence =
      calculateNearestSeedInfluenceV3(
        x,
        y,
        seeds,
        width,
        height
      );

    const lowMaskEvidence =
      inverseSmoothStepV3(
        config.strongBackgroundMaskThreshold,
        config.strongForegroundMaskThreshold,
        maskValue
      );

    const edgeSafety =
      inverseSmoothStepV3(
        config.maximumCrossableGradient *
          0.7,
        Math.max(
          config.maximumCrossableGradient,
          config.strongEdgeThreshold
        ),
        gradient
      );

    const textureSafety =
      inverseSmoothStepV3(
        config.maximumSeedTexture,
        Math.min(
          1,
          config.maximumSeedTexture *
            2.2
        ),
        texture
      );

    /*
     * الخلفية لا تعتمد فقط على تشابه اللون.
     *
     * نضيف:
     * - الوصول من حدود الصورة.
     * - الأسطح الكبيرة.
     * - استمرار الخلفية.
     * - الظلال المتصلة بالخلفية.
     * - تدرجات الإضاءة.
     * - إجماع الأدلة.
     */
    let backgroundConfidence =
      weightedAverageV3(
        [
          modelAggregation
            .combinedConfidence,
          borderPrior,
          seedInfluence,
          lowMaskEvidence,
          edgeSafety,
          textureSafety,
          sceneBackgroundSupport,
        ],
        [
          0.31,
          0.09,
          0.09,
          0.16,
          0.07,
          0.05,
          0.23,
        ],
        0
      );

    /*
     * الظل المرتبط بالخلفية لا يُعامل
     * كجزء من الملابس لمجرد تغير الإضاءة.
     */
    if (
      modelAggregation
        .shadowSupported
    ) {
      backgroundConfidence =
        Math.max(
          backgroundConfidence,
          0.64 *
            edgeSafety *
            (
              0.72 +
              scene.shadowBackgroundSupport *
                0.28
            )
        );
    }

    /*
     * Highlight فوق سطح خلفية مستمر.
     */
    if (
      modelAggregation
        .highlightSupported
    ) {
      backgroundConfidence =
        Math.max(
          backgroundConfidence,
          0.6 *
            edgeSafety *
            (
              0.76 +
              scene.illuminationBackgroundSupport *
                0.24
            )
        );
    }

    /*
     * استمرار خلفية قوي مدعوم من أكثر
     * من خريطة يرفع الثقة بوضوح.
     */
    if (
      sceneBackgroundSupport >=
        0.62 &&
      sceneForegroundSupport <
        0.5
    ) {
      backgroundConfidence =
        Math.max(
          backgroundConfidence,
          0.5 +
          sceneBackgroundSupport *
            0.42
        );
    }

    /*
     * لا نسمح لأسطح الخلفية أو الخطوط المستقيمة
     * بحذف جزء أثبت الماسك وبنية الجسم أنه Foreground.
     */
    const foregroundProtection =
      clampUnitValue(
        Math.max(
          sceneForegroundSupport,
          scene.foregroundProtection,
          scene.thinStructureProtection *
            0.92,
          scene.structuralProtection *
            maskValue
        )
      );

    if (
      maskValue >=
      config.strongForegroundMaskThreshold
    ) {
      backgroundConfidence *=
        clampUnitValue(
          1 -
          (
            maskValue -
            config.strongForegroundMaskThreshold
          ) *
            1.75
        );
    }

    if (
      foregroundProtection >=
        0.58
    ) {
      backgroundConfidence *=
        clampUnitValue(
          1 -
          foregroundProtection *
            0.58
        );
    }

    const subjectSpatialPrior =
      calculateSubjectSpatialForegroundPriorV3(
        x,
        y,
        subjectBounds,
        width,
        height,
        config
      );

    backgroundConfidence *=
      clampUnitValue(
        1 -
        subjectSpatialPrior *
          0.7
      );

    /*
     * الحافة القوية التابعة للجسم تمنع
     * خلفية مشابهة لونيًا من عبور الحد.
     */
    if (
      scene.structuralProtection >=
        0.62 &&
      maskValue >= 0.34
    ) {
      backgroundConfidence *=
        clampUnitValue(
          1 -
          scene.structuralProtection *
            0.38
        );
    }

    if (
      scene.thinStructureProtection >=
        0.62 &&
      maskValue >= 0.24
    ) {
      backgroundConfidence *=
        clampUnitValue(
          1 -
          scene.thinStructureProtection *
            0.48
        );
    }

    backgroundConfidence =
      clampUnitValue(
        backgroundConfidence
      );

    /*
     * مهم:
     * الدالة الجديدة تستقبل index وmaps،
     * لذلك الاستدعاء هنا بثمانية Arguments.
     */
    let foregroundEvidence =
      calculateForegroundEvidenceV3(
        index,
        maskValue,
        backgroundConfidence,
        gradient,
        texture,
        subjectSpatialPrior,
        maps,
        config
      );

    /*
     * إجماع واضح للجسم يرفع Foreground Evidence،
     * لكن بدون رسم جسم جديد خارج الماسك.
     */
    if (
      sceneForegroundSupport >=
        0.62 &&
      maskValue >= 0.2
    ) {
      foregroundEvidence =
        Math.max(
          foregroundEvidence,
          0.42 +
          sceneForegroundSupport *
            0.4 +
          maskValue *
            0.18
        );
    }

    /*
     * إجماع خلفية قوي يخفض Foreground الزائف،
     * إلا في المناطق المحمية من الجسم.
     */
    if (
      sceneBackgroundSupport >=
        0.64 &&
      foregroundProtection <
        0.48 &&
      maskValue <
        config.strongForegroundMaskThreshold
    ) {
      foregroundEvidence *=
        clampUnitValue(
          1 -
          sceneBackgroundSupport *
            0.42
        );
    }

    /*
     * Floor لحماية الجسم الأساسي:
     * لا نحذف Pixel داخل الجسم لمجرد
     * أن لونها قريب من الخلفية.
     */
    const protectedForegroundFloor =
      smoothStepV3(
        config.strongBackgroundMaskThreshold,
        config.strongForegroundMaskThreshold,
        maskValue
      ) *
      (
        0.64 +
        foregroundProtection *
          0.3
      );

    foregroundEvidence =
      clampUnitValue(
        Math.max(
          foregroundEvidence,
          protectedForegroundFloor
        )
      );

    const uncertainty =
      calculateUncertaintyV3(
        backgroundConfidence,
        foregroundEvidence,
        modelAggregation
          .supportingModelCount,
        gradient,
        maskValue
      );

    maps.backgroundConfidence[index] =
      backgroundConfidence;

    maps.foregroundEvidence[index] =
      foregroundEvidence;

    maps.uncertainty[index] =
      uncertainty;

    /*
     * Background قوية:
     * تحتاج ثقة خلفية واضحة وعدم وجود
     * حماية Foreground قوية.
     */
    const strongBackground =
      (
        backgroundConfidence >=
          0.76 &&
        foregroundEvidence <=
          0.4 &&
        foregroundProtection <
          0.52
      ) ||
      (
        maskValue <=
          config.strongBackgroundMaskThreshold &&
        backgroundConfidence >=
          0.62 &&
        sceneBackgroundSupport >=
          0.5
      );

    /*
     * Foreground قوية:
     * الماسك أو أدلة المشهد تحمي الجسم،
     * مع عدم وجود خلفية أقوى بشكل واضح.
     */
    const strongForeground =
      (
        foregroundEvidence >=
          0.72 &&
        backgroundConfidence <=
          0.5
      ) ||
      (
        maskValue >=
          config.strongForegroundMaskThreshold &&
        foregroundEvidence >
          backgroundConfidence
      ) ||
      (
        foregroundProtection >=
          0.72 &&
        maskValue >=
          0.3 &&
        backgroundConfidence <=
          0.6
      );

    maps.strongBackground[index] =
      strongBackground
        ? 1
        : 0;

    maps.strongForeground[index] =
      strongForeground
        ? 1
        : 0;

    if (
      strongBackground
    ) {
      probableBackgroundPixels +=
        1;
    } else if (
      strongForeground
    ) {
      probableForegroundPixels +=
        1;
    } else if (
      uncertainty >=
        0.42 ||
      Math.abs(
        backgroundConfidence -
        foregroundEvidence
      ) <
        0.1
    ) {
      uncertainPixels +=
        1;
    } else if (
      backgroundConfidence >=
        0.58 &&
      backgroundConfidence >
        foregroundEvidence
    ) {
      probableBackgroundPixels +=
        1;
    } else if (
      foregroundEvidence >=
        0.58 &&
      foregroundEvidence >
        backgroundConfidence
    ) {
      probableForegroundPixels +=
        1;
    } else {
      uncertainPixels +=
        1;
    }

    backgroundConfidenceSum +=
      backgroundConfidence;

    foregroundEvidenceSum +=
      foregroundEvidence;
  }

  return {
    probableBackgroundPixels,

    probableForegroundPixels,

    uncertainPixels,

    meanBackgroundConfidence:
      safeSegmentationDivide(
        backgroundConfidenceSum,
        pixelCount,
        0
      ),

    meanForegroundEvidence:
      safeSegmentationDivide(
        foregroundEvidenceSum,
        pixelCount,
        0
      ),
  };
}

/* =========================================================
 * Basic edge barrier
 * ======================================================= */

function calculateBaseEdgeBarrierV3(
  index: number,
  gradient: number,
  texture: number,
  maskValue: number,
  foregroundEvidence: number,
  backgroundConfidence: number,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  const scene =
    calculateSceneReasoningEvidenceV3(
      index,
      maps
    );

  const sceneForegroundSupport =
    calculateSceneForegroundSupportV3(
      scene
    );

  const sceneBackgroundSupport =
    calculateSceneBackgroundSupportV3(
      scene
    );

  const gradientBarrier =
    smoothStepV3(
      config.maximumCrossableGradient *
        0.55,
      config.strongEdgeThreshold,
      gradient
    );

  const textureBarrier =
    smoothStepV3(
      config.maximumSeedTexture,
      Math.min(
        1,
        config.maximumSeedTexture *
          2.4
      ),
      texture
    );

  const foregroundBarrier =
    smoothStepV3(
      0.45,
      config.strongForegroundMaskThreshold,
      maskValue
    );

  const evidenceBarrier =
    smoothStepV3(
      0.48,
      0.82,
      foregroundEvidence
    );

  const conflictBarrier =
    clampUnitValue(
      foregroundEvidence -
      backgroundConfidence
    );

  const structuralBarrier =
    clampUnitValue(
      scene.structuralProtection *
      (
        0.48 +
        maskValue *
          0.3 +
        foregroundEvidence *
          0.22
      )
    );

  const thinStructureBarrier =
    clampUnitValue(
      scene.thinStructureProtection *
      (
        0.4 +
        maskValue *
          0.34 +
        foregroundEvidence *
          0.26
      )
    );

  const objectProtectionBarrier =
    clampUnitValue(
      scene.foregroundProtection *
      (
        0.46 +
        foregroundEvidence *
          0.3 +
        maskValue *
          0.24
      )
    );

  let barrier =
    weightedAverageV3(
      [
        gradientBarrier,
        textureBarrier,
        foregroundBarrier,
        evidenceBarrier,
        conflictBarrier,
        structuralBarrier,
        thinStructureBarrier,
        objectProtectionBarrier,
      ],
      [
        0.22,
        0.07,
        0.14,
        0.15,
        0.08,
        0.11,
        0.11,
        0.12,
      ],
      gradientBarrier
    );

  /*
   * حماية الخطوط والزوايا والثنيات عندما تتوافق
   * مع الماسك أو Foreground Evidence.
   */
  if (
    sceneForegroundSupport >=
      0.58 &&
    (
      maskValue >= 0.3 ||
      foregroundEvidence >=
        0.52
    )
  ) {
    barrier =
      Math.max(
        barrier,

        0.44 +
        sceneForegroundSupport *
          0.42
      );
  }

  if (
    scene.thinStructureProtection >=
      0.66 &&
    maskValue >=
      0.24
  ) {
    barrier =
      Math.max(
        barrier,

        0.52 +
        scene.thinStructureProtection *
          0.4
      );
  }

  if (
    maskValue >=
      config.strongForegroundMaskThreshold &&
    gradient >=
      config.strongEdgeThreshold *
        0.72
  ) {
    barrier =
      Math.max(
        barrier,

        config.subjectBarrierBoost +
        gradient *
          (
            1 -
            config.subjectBarrierBoost
          )
      );
  }

  /*
   * لا نضع Barrier قوي فوق سطح خلفية مستمر
   * لمجرد وجود Texture أو تغير إضاءة.
   */
  const reliableBackgroundSurface =
    clampUnitValue(
      sceneBackgroundSupport *
      (
        1 -
        sceneForegroundSupport *
          0.78
      )
    );

  if (
    reliableBackgroundSurface >=
      0.54 &&
    maskValue <
      0.52 &&
    foregroundEvidence <
      0.56
  ) {
    barrier *=
      clampUnitValue(
        1 -
        reliableBackgroundSurface *
          0.5
      );
  }

  if (
    scene.shadowBackgroundSupport >=
      0.58 &&
    scene.foregroundProtection <
      0.44 &&
    maskValue <
      0.5
  ) {
    barrier *=
      clampUnitValue(
        1 -
        scene.shadowBackgroundSupport *
          0.38
      );
  }

  if (
    scene.illuminationBackgroundSupport >=
      0.58 &&
    scene.structuralProtection <
      0.46 &&
    maskValue <
      0.48
  ) {
    barrier *=
      clampUnitValue(
        1 -
        scene.illuminationBackgroundSupport *
          0.32
      );
  }

  /*
   * Object Protection يملك الأولوية النهائية
   * ولا يسمح بخفض الحاجز حول الجسم الحقيقي.
   */
  if (
    scene.foregroundProtection >=
      0.7 &&
    maskValue >=
      0.3
  ) {
    barrier =
      Math.max(
        barrier,

        0.58 +
        scene.foregroundProtection *
          0.36
      );
  }

  return clampUnitValue(
    barrier
  );
}

/* =========================================================
 * Edge barrier dilation
 * ======================================================= */

function expandEdgeBarrierV3(
  source:
    Float32Array,
  destination:
    Float32Array,
  width: number,
  height: number,
  radius: number,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined,
  cancellationInterval: number
): void {
  if (
    radius <= 0
  ) {
    destination.set(
      source
    );

    return;
  }

  const pixelCount =
    width * height;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      index,
      cancellationInterval
    );

    const x =
      index % width;

    const y =
      Math.floor(
        index /
        width
      );

    let maximum =
      source[index];

    const minimumX =
      Math.max(
        0,
        x - radius
      );

    const maximumX =
      Math.min(
        width - 1,
        x + radius
      );

    const minimumY =
      Math.max(
        0,
        y - radius
      );

    const maximumY =
      Math.min(
        height - 1,
        y + radius
      );

    for (
      let sampleY =
        minimumY;
      sampleY <=
        maximumY;
      sampleY += 1
    ) {
      const rowOffset =
        sampleY *
        width;

      for (
        let sampleX =
          minimumX;
        sampleX <=
          maximumX;
        sampleX += 1
      ) {
        const dx =
          sampleX - x;

        const dy =
          sampleY - y;

        const distance =
          Math.sqrt(
            dx * dx +
            dy * dy
          );

        if (
          distance >
          radius
        ) {
          continue;
        }

        const sourceValue =
          source[
            rowOffset +
            sampleX
          ];

        const distanceWeight =
          1 -
          safeSegmentationDivide(
            distance,
            radius + 1,
            0
          );

        const candidate =
          sourceValue *
          (
            0.55 +
            distanceWeight *
              0.45
          );

        if (
          candidate >
          maximum
        ) {
          maximum =
            candidate;
        }
      }
    }

    destination[index] =
      clampUnitValue(
        maximum
      );
  }
}

/* =========================================================
 * Build edge barrier
 * ======================================================= */

function buildEdgeBarrierV3(
  mask:
    SegmentationFloatMask,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingEdgeBarrierBuildResultV3 {
  const width =
    mask.width;

  const height =
    mask.height;

  const pixelCount =
    width * height;

  const baseBarrier =
    new Float32Array(
      pixelCount
    );

  let strongEdgePixels =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    checkCancellationV3(
      cancellationSignal,
      index,
      config.cancellationCheckInterval
    );

    const gradient =
      clampUnitValue(
        maps.gradient[index]
      );

    const texture =
      clampUnitValue(
        maps.texture[index]
      );

    const maskValue =
      clampUnitValue(
        mask.data[index]
      );

    const foregroundEvidence =
      clampUnitValue(
        maps.foregroundEvidence[index]
      );

    const backgroundConfidence =
      clampUnitValue(
        maps.backgroundConfidence[index]
      );

    const barrier =
  calculateBaseEdgeBarrierV3(
    index,
    gradient,
    texture,
    maskValue,
    foregroundEvidence,
    backgroundConfidence,
    maps,
    config
  );

    baseBarrier[index] =
      barrier;

    if (
      gradient >=
        config.strongEdgeThreshold ||
      barrier >=
        0.72
    ) {
      strongEdgePixels +=
        1;
    }
  }

  if (
    config.protectStrongEdges &&
    config.edgeBarrierExpansionRadius >
      0
  ) {
    expandEdgeBarrierV3(
      baseBarrier,
      maps.edgeBarrier,
      width,
      height,
      config.edgeBarrierExpansionRadius,
      cancellationSignal,
      config.cancellationCheckInterval
    );
  } else {
    maps.edgeBarrier.set(
      baseBarrier
    );
  }

  let barrierSum =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    barrierSum +=
      maps.edgeBarrier[index];
  }

  return {
    strongEdgePixels,

    meanBarrier:
      safeSegmentationDivide(
        barrierSum,
        pixelCount,
        0
      ),
  };
}

/* =========================================================
 * Connected background initial seeds
 * ======================================================= */

function initializeConnectedBackgroundV3(
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  maps:
    BackgroundUnderstandingInternalMapsV3,
  width: number,
  height: number,
  queue:
    BackgroundUnderstandingIndexQueueV3
): number {
  let inserted =
    0;

  for (
    const seed of seeds
  ) {
    if (
      !isInsideImageV3(
        seed.x,
        seed.y,
        width,
        height
      )
    ) {
      continue;
    }

    const index =
      seed.index;

    if (
      maps.connectedBackground[index] !==
      0
    ) {
      continue;
    }

    maps.connectedBackground[index] =
      1;

    maps.strongBackground[index] =
      1;

    if (
      enqueueIndexV3(
        queue,
        index
      )
    ) {
      inserted +=
        1;
    }
  }

  return inserted;
}

/* =========================================================
 * Region growing threshold
 * ======================================================= */

function getRegionGrowingThresholdV3(
  passIndex: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  if (
    config.regionGrowingPasses <=
    1
  ) {
    return config
      .regionGrowingConfidenceThreshold;
  }

  const ratio =
    clampUnitValue(
      passIndex /
      Math.max(
        1,
        config.regionGrowingPasses -
          1
      )
    );

  return (
    config
      .regionGrowingConfidenceThreshold *
      (
        1 -
        ratio
      ) +
    config
      .regionGrowingRelaxedThreshold *
      ratio
  );
}

/* =========================================================
 * Neighbour color compatibility
 * ======================================================= */

function isNeighbourColorCompatibleV3(
  rgba:
    Uint8Array,
  parentIndex: number,
  candidateIndex: number,
  maximumDistance: number
): boolean {
  const parentColor =
    readColorSampleAtPixelV3(
      rgba,
      parentIndex
    );

  const candidateColor =
    readColorSampleAtPixelV3(
      rgba,
      candidateIndex
    );

  const labDistance =
    calculateLabDistanceV3(
      parentColor.lab,
      candidateColor.lab
    );

  if (
    labDistance <=
    maximumDistance
  ) {
    return true;
  }

  const chromaDistance =
    calculateChromaDistanceV3(
      parentColor,
      candidateColor
    );

  const luminanceDistance =
    Math.abs(
      parentColor.luminance -
      candidateColor.luminance
    );

  return (
    chromaDistance <=
      maximumDistance *
        0.62 &&
    luminanceDistance <=
      maximumDistance *
        1.35
  );
}

/* =========================================================
 * Region growing candidate decision
 * ======================================================= */

type BackgroundUnderstandingRegionCandidateDecisionV3 = {
  accepted: boolean;

  reason:
    | 'accepted'
    | 'confidence'
    | 'gradient'
    | 'barrier'
    | 'neighbour-color'
    | 'foreground';
};

function evaluateRegionGrowingCandidateV3(
  image:
    SegmentationRgbaImageSource,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  parentIndex: number,
  candidateIndex: number,
  threshold: number,
  diagonal: boolean,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): BackgroundUnderstandingRegionCandidateDecisionV3 {
  const backgroundConfidence =
    clampUnitValue(
      maps.backgroundConfidence[
        candidateIndex
      ]
    );

  const foregroundEvidence =
    clampUnitValue(
      maps.foregroundEvidence[
        candidateIndex
      ]
    );

  const gradient =
    clampUnitValue(
      maps.gradient[
        candidateIndex
      ]
    );

  const barrier =
    clampUnitValue(
      maps.edgeBarrier[
        candidateIndex
      ]
    );

    const scene =
  calculateSceneReasoningEvidenceV3(
    candidateIndex,
    maps
  );

const sceneForegroundSupport =
  calculateSceneForegroundSupportV3(
    scene
  );

const sceneBackgroundSupport =
  calculateSceneBackgroundSupportV3(
    scene
  );

const reliableBackgroundContinuation =
  clampUnitValue(
    sceneBackgroundSupport *
    (
      1 -
      sceneForegroundSupport *
        0.82
    )
  );

const protectedForegroundStructure =
  clampUnitValue(
    sceneForegroundSupport *
    (
      0.52 +
      foregroundEvidence *
        0.28 +
      barrier *
        0.2
    )
  );

  const diagonalPenalty =
    diagonal
      ? 0.035
      : 0;

  const sceneRelaxation =
  reliableBackgroundContinuation *
  0.08;

const sceneProtectionPenalty =
  protectedForegroundStructure *
  0.14;

const requiredConfidence =
  clampUnitValue(
    threshold +
    diagonalPenalty +
    sceneProtectionPenalty -
    sceneRelaxation
  );

  if (
    backgroundConfidence <
    requiredConfidence
  ) {
    return {
      accepted:
        false,

      reason:
        'confidence',
    };
  }

  if (
    foregroundEvidence >
      backgroundConfidence &&
    foregroundEvidence >=
      0.56
  ) {
    return {
      accepted:
        false,

      reason:
        'foreground',
    };
  }

  /*
 * حماية Scene Reasoning لها أولوية حتى لو
 * لون الجسم قريب جدًا من لون الخلفية.
 */
if (
  protectedForegroundStructure >=
    0.58 &&
  sceneForegroundSupport >
    sceneBackgroundSupport
) {
  return {
    accepted:
      false,

    reason:
      'foreground',
  };
}

if (
  scene.thinStructureProtection >=
    0.64 &&
  foregroundEvidence >=
    0.42
) {
  return {
    accepted:
      false,

    reason:
      'foreground',
  };
}

if (
  calculateSceneForegroundSupportV3(
    scene
  ) >=
    0.6 &&
  scene.foregroundProtection >=
    0.52
) {
  return {
    accepted:
      false,

    reason:
      'foreground',
  };
}

  const backgroundTraversalSupport =
  clampUnitValue(
    Math.max(
      reliableBackgroundContinuation,
      scene.shadowBackgroundSupport,
      scene.illuminationBackgroundSupport
    )
  );

const adaptiveGradientLimit =
  clampUnitValue(
    config.maximumCrossableGradient *
    (
      1 +
      backgroundTraversalSupport *
        0.22
    )
  );

const adaptiveBarrierLimit =
  clampUnitValue(
    config.maximumCrossableBarrier *
    (
      1 +
      backgroundTraversalSupport *
        0.16
    )
  );

/*
 * لا نعبر حافة محمية كجسم أو خط تابع للقطعة.
 */
if (
  gradient >
    adaptiveGradientLimit &&
  sceneForegroundSupport >=
    sceneBackgroundSupport *
      0.86
) {
  return {
    accepted:
      false,

    reason:
      'gradient',
  };
}

if (
  barrier >
    adaptiveBarrierLimit &&
  sceneForegroundSupport >=
    sceneBackgroundSupport *
      0.82
) {
  return {
    accepted:
      false,

    reason:
      'barrier',
  };
}

/*
 * لو الحافة سببها ظل أو تدرج إضاءة فوق خلفية متصلة،
 * نسمح بالعبور بشرط عدم وجود Foreground قوي.
 */
if (
  gradient >
    config.maximumCrossableGradient &&
  backgroundTraversalSupport <
    0.56
) {
  return {
    accepted:
      false,

    reason:
      'gradient',
  };
}

if (
  barrier >
    config.maximumCrossableBarrier &&
  reliableBackgroundContinuation <
    0.54
) {
  return {
    accepted:
      false,

    reason:
      'barrier',
  };
}

  const backgroundColorRelaxation =
  clampUnitValue(
    Math.max(
      scene.continuationBackgroundSupport,
      scene.shadowBackgroundSupport,
      scene.illuminationBackgroundSupport
    )
  );

const foregroundColorRestriction =
  clampUnitValue(
    sceneForegroundSupport *
    (
      1 -
      sceneBackgroundSupport *
        0.58
    )
  );

const adaptiveNeighbourDistance =
  config.maximumNeighborLabDistance *
  clampSegmentationValue(
    0.72 +
    backgroundConfidence *
      0.44 +
    backgroundColorRelaxation *
      0.24 -
    foregroundColorRestriction *
      0.18,
    0.58,
    1.38
  );

  if (
    !isNeighbourColorCompatibleV3(
      image.rgba,
      parentIndex,
      candidateIndex,
      adaptiveNeighbourDistance
    )
  ) {
    return {
      accepted:
        false,

      reason:
        'neighbour-color',
    };
  }

  return {
    accepted:
      true,

    reason:
      'accepted',
  };
}

/* =========================================================
 * One region growing pass
 * ======================================================= */

function performRegionGrowingPassV3(
  image:
    SegmentationRgbaImageSource,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  threshold: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): {
  accepted: number;

  queued: number;

  rejectedByConfidence: number;

  rejectedByGradient: number;

  rejectedByBarrier: number;

  rejectedByNeighbourColor: number;

  rejectedByForeground: number;
} {
  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  const queue =
    createIndexQueueV3(
      pixelCount
    );

  const queuedMap =
    new Uint8Array(
      pixelCount
    );

  let queued =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      maps.connectedBackground[index] ===
      0
    ) {
      continue;
    }

    if (
      enqueueIndexV3(
        queue,
        index
      )
    ) {
      queuedMap[index] =
        1;

      queued +=
        1;
    }
  }

  const neighbours =
    getNeighbourOffsetsV3(
      config.useEightConnectivity
    );

  let accepted =
    0;

  let rejectedByConfidence =
    0;

  let rejectedByGradient =
    0;

  let rejectedByBarrier =
    0;

  let rejectedByNeighbourColor =
    0;

  let rejectedByForeground =
    0;

  let processed =
    0;

  while (
    !isQueueEmptyV3(
      queue
    )
  ) {
    const parentIndex =
      dequeueIndexV3(
        queue
      );

    if (
      parentIndex < 0
    ) {
      break;
    }

    processed +=
      1;

    checkCancellationV3(
      cancellationSignal,
      processed,
      config.cancellationCheckInterval
    );

    const parentX =
      parentIndex %
      width;

    const parentY =
      Math.floor(
        parentIndex /
        width
      );

    for (
      const neighbour of neighbours
    ) {
      const dx =
        neighbour[0];

      const dy =
        neighbour[1];

      const x =
        parentX + dx;

      const y =
        parentY + dy;

      if (
        !isInsideImageV3(
          x,
          y,
          width,
          height
        )
      ) {
        continue;
      }

      const candidateIndex =
        getPixelIndexV3(
          x,
          y,
          width
        );

      if (
        maps.connectedBackground[
          candidateIndex
        ] !== 0
      ) {
        continue;
      }

      const decision =
        evaluateRegionGrowingCandidateV3(
          image,
          maps,
          parentIndex,
          candidateIndex,
          threshold,
          isDiagonalNeighbourV3(
            dx,
            dy
          ),
          config
        );

      if (
        !decision.accepted
      ) {
        switch (
          decision.reason
        ) {
          case 'confidence':
            rejectedByConfidence +=
              1;
            break;

          case 'gradient':
            rejectedByGradient +=
              1;
            break;

          case 'barrier':
            rejectedByBarrier +=
              1;
            break;

          case 'neighbour-color':
            rejectedByNeighbourColor +=
              1;
            break;

          case 'foreground':
            rejectedByForeground +=
              1;
            break;

          default:
            break;
        }

        continue;
      }

      maps.connectedBackground[
        candidateIndex
      ] =
        1;

      accepted +=
        1;

      maps.backgroundConfidence[
        candidateIndex
      ] =
        Math.max(
          maps.backgroundConfidence[
            candidateIndex
          ],
          threshold
        );

      if (
        queuedMap[
          candidateIndex
        ] === 0 &&
        enqueueIndexV3(
          queue,
          candidateIndex
        )
      ) {
        queuedMap[
          candidateIndex
        ] =
          1;

        queued +=
          1;
      }
    }
  }

  return {
    accepted,

    queued,

    rejectedByConfidence,

    rejectedByGradient,

    rejectedByBarrier,

    rejectedByNeighbourColor,

    rejectedByForeground,
  };
}

/* =========================================================
 * Region growing
 * ======================================================= */

function performRegionGrowingV3(
  image:
    SegmentationRgbaImageSource,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingRegionGrowingResultV3 {
  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  const initialQueue =
    createIndexQueueV3(
      pixelCount
    );

  initializeConnectedBackgroundV3(
    seeds,
    maps,
    width,
    height,
    initialQueue
  );

  const passAcceptedCounts:
    number[] = [];

  let acceptedPixelCount =
    0;

  let queuedPixelCount =
    0;

  let rejectedByConfidenceCount =
    0;

  let rejectedByGradientCount =
    0;

  let rejectedByBarrierCount =
    0;

  let rejectedByNeighbourColorCount =
    0;

  let rejectedByForegroundCount =
    0;

  for (
    let passIndex = 0;
    passIndex <
      config.regionGrowingPasses;
    passIndex += 1
  ) {
    cancellationSignal
      ?.throwIfCancelled();

    const threshold =
      getRegionGrowingThresholdV3(
        passIndex,
        config
      );

    const pass =
      performRegionGrowingPassV3(
        image,
        maps,
        threshold,
        config,
        cancellationSignal
      );

    passAcceptedCounts.push(
      pass.accepted
    );

    acceptedPixelCount +=
      pass.accepted;

    queuedPixelCount +=
      pass.queued;

    rejectedByConfidenceCount +=
      pass.rejectedByConfidence;

    rejectedByGradientCount +=
      pass.rejectedByGradient;

    rejectedByBarrierCount +=
      pass.rejectedByBarrier;

    rejectedByNeighbourColorCount +=
      pass.rejectedByNeighbourColor;

    rejectedByForegroundCount +=
      pass.rejectedByForeground;

    if (
      pass.accepted <= 0
    ) {
      break;
    }
  }

  return {
    acceptedPixelCount,

    passAcceptedCounts,

    queuedPixelCount,

    rejectedByConfidenceCount,

    rejectedByGradientCount,

    rejectedByBarrierCount,

    rejectedByNeighbourColorCount,

    rejectedByForegroundCount,
  };
}

/* =========================================================
 * Flood fill border initialization
 * ======================================================= */

function initializeFloodFillFromBordersV3(
  maps:
    BackgroundUnderstandingInternalMapsV3,
  width: number,
  height: number,
  queue:
    BackgroundUnderstandingIndexQueueV3,
  queued:
    Uint8Array,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  let inserted =
    0;

  const tryInsert = (
    x: number,
    y: number
  ): void => {
    const index =
      getPixelIndexV3(
        x,
        y,
        width
      );

    if (
      queued[index] !== 0 ||
      maps.connectedBackground[index] !==
        0
    ) {
      return;
    }

    const backgroundConfidence =
      maps.backgroundConfidence[
        index
      ];

    const foregroundEvidence =
      maps.foregroundEvidence[
        index
      ];

    const barrier =
      maps.edgeBarrier[
        index
      ];

    if (
      backgroundConfidence <
        config.regionGrowingRelaxedThreshold ||
      foregroundEvidence >
        backgroundConfidence ||
      barrier >
        config.maximumCrossableBarrier
    ) {
      return;
    }

    queued[index] =
      1;

    maps.connectedBackground[index] =
      1;

    if (
      enqueueIndexV3(
        queue,
        index
      )
    ) {
      inserted +=
        1;
    }
  };

  for (
    let x = 0;
    x < width;
    x += 1
  ) {
    tryInsert(
      x,
      0
    );

    if (
      height > 1
    ) {
      tryInsert(
        x,
        height - 1
      );
    }
  }

  for (
    let y = 1;
    y <
      height - 1;
    y += 1
  ) {
    tryInsert(
      0,
      y
    );

    if (
      width > 1
    ) {
      tryInsert(
        width - 1,
        y
      );
    }
  }

  return inserted;
}

/* =========================================================
 * Flood fill candidate decision
 * ======================================================= */

function canFloodFillCandidateV3(
  image:
    SegmentationRgbaImageSource,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  parentIndex: number,
  candidateIndex: number,
  diagonal: boolean,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): boolean {
  const confidence =
    maps.backgroundConfidence[
      candidateIndex
    ];

  const foreground =
    maps.foregroundEvidence[
      candidateIndex
    ];

  const barrier =
    maps.edgeBarrier[
      candidateIndex
    ];

  const gradient =
    maps.gradient[
      candidateIndex
    ];

  const uncertainty =
    maps.uncertainty[
      candidateIndex
    ];

    const scene =
  calculateSceneReasoningEvidenceV3(
    candidateIndex,
    maps
  );

const sceneForegroundSupport =
  calculateSceneForegroundSupportV3(
    scene
  );

const sceneBackgroundSupport =
  calculateSceneBackgroundSupportV3(
    scene
  );

const reliableSceneBackground =
  clampUnitValue(
    sceneBackgroundSupport *
    (
      1 -
      sceneForegroundSupport *
        0.84
    )
  );

const protectedSceneForeground =
  clampUnitValue(
    sceneForegroundSupport *
    (
      0.5 +
      foreground *
        0.3 +
      barrier *
        0.2
    )
  );

 const requiredConfidence =
  clampUnitValue(
    config.regionGrowingRelaxedThreshold +
    (
      diagonal
        ? 0.04
        : 0
    ) +
    uncertainty *
      0.06 +
    protectedSceneForeground *
      0.13 -
    reliableSceneBackground *
      0.07
  );

  if (
    confidence <
    requiredConfidence
  ) {
    return false;
  }

  if (
    foreground >=
      0.62 &&
    foreground >
      confidence
  ) {
    return false;
  }

  if (
  protectedSceneForeground >=
    0.56 &&
  sceneForegroundSupport >
    sceneBackgroundSupport
) {
  return false;
}

if (
  scene.thinStructureProtection >=
    0.62 &&
  foreground >=
    0.4
) {
  return false;
}

if (
  calculateSceneForegroundSupportV3(
    scene
  ) >=
    0.58 &&
  scene.foregroundProtection >=
    0.5
) {
  return false;
}

 const backgroundTraversalSupport =
  clampUnitValue(
    Math.max(
      reliableSceneBackground,
      scene.shadowBackgroundSupport,
      scene.illuminationBackgroundSupport
    )
  );

const adaptiveBarrierLimit =
  clampUnitValue(
    config.maximumCrossableBarrier *
    (
      1 +
      backgroundTraversalSupport *
        0.14
    )
  );

const adaptiveGradientLimit =
  clampUnitValue(
    config.maximumCrossableGradient *
    (
      1.08 +
      backgroundTraversalSupport *
        0.2
    )
  );

if (
  barrier >
    adaptiveBarrierLimit &&
  sceneForegroundSupport >=
    sceneBackgroundSupport *
      0.8
) {
  return false;
}

if (
  gradient >
    adaptiveGradientLimit &&
  sceneForegroundSupport >=
    sceneBackgroundSupport *
      0.84
) {
  return false;
}

if (
  barrier >
    config.maximumCrossableBarrier &&
  reliableSceneBackground <
    0.52
) {
  return false;
}

if (
  gradient >
    config.maximumCrossableGradient *
      1.08 &&
  backgroundTraversalSupport <
    0.54
) {
  return false;
}

  const adaptiveNeighbourDistance =
  config.maximumNeighborLabDistance *
  clampSegmentationValue(
    0.76 +
    confidence *
      0.46 +
    backgroundTraversalSupport *
      0.25 -
    protectedSceneForeground *
      0.17,
    0.56,
    1.4
  );

return isNeighbourColorCompatibleV3(
  image.rgba,
  parentIndex,
  candidateIndex,
  adaptiveNeighbourDistance
);

}

/* =========================================================
 * Flood fill
 * ======================================================= */

function performBackgroundFloodFillV3(
  image:
    SegmentationRgbaImageSource,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingFloodFillResultV3 {
  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  const queue =
    createIndexQueueV3(
      pixelCount
    );

  const queued =
    new Uint8Array(
      pixelCount
    );

  let initialSeedPixelCount =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      maps.connectedBackground[index] ===
      0
    ) {
      continue;
    }

    if (
      enqueueIndexV3(
        queue,
        index
      )
    ) {
      queued[index] =
        1;

      initialSeedPixelCount +=
        1;
    }
  }

  initialSeedPixelCount +=
    initializeFloodFillFromBordersV3(
      maps,
      width,
      height,
      queue,
      queued,
      config
    );

  const neighbours =
    getNeighbourOffsetsV3(
      config.useEightConnectivity
    );

  let expandedPixelCount =
    0;

  let rejectedPixelCount =
    0;

  let maximumQueueLength =
    queue.size;

  let processed =
    0;

  while (
    !isQueueEmptyV3(
      queue
    )
  ) {
    maximumQueueLength =
      Math.max(
        maximumQueueLength,
        queue.size
      );

    const parentIndex =
      dequeueIndexV3(
        queue
      );

    if (
      parentIndex < 0
    ) {
      break;
    }

    processed +=
      1;

    checkCancellationV3(
      cancellationSignal,
      processed,
      config.cancellationCheckInterval
    );

    const parentX =
      parentIndex %
      width;

    const parentY =
      Math.floor(
        parentIndex /
        width
      );

    for (
      const neighbour of neighbours
    ) {
      const dx =
        neighbour[0];

      const dy =
        neighbour[1];

      const candidateX =
        parentX + dx;

      const candidateY =
        parentY + dy;

      if (
        !isInsideImageV3(
          candidateX,
          candidateY,
          width,
          height
        )
      ) {
        continue;
      }

      const candidateIndex =
        getPixelIndexV3(
          candidateX,
          candidateY,
          width
        );

      if (
        maps.connectedBackground[
          candidateIndex
        ] !== 0
      ) {
        continue;
      }

      if (
        !canFloodFillCandidateV3(
          image,
          maps,
          parentIndex,
          candidateIndex,
          isDiagonalNeighbourV3(
            dx,
            dy
          ),
          config
        )
      ) {
        rejectedPixelCount +=
          1;

        continue;
      }

      maps.connectedBackground[
        candidateIndex
      ] =
        1;

      maps.backgroundConfidence[
        candidateIndex
      ] =
        Math.max(
          maps.backgroundConfidence[
            candidateIndex
          ],
          config.regionGrowingRelaxedThreshold
        );

      maps.uncertainty[
        candidateIndex
      ] *=
        0.72;

      expandedPixelCount +=
        1;

      if (
        queued[
          candidateIndex
        ] === 0 &&
        enqueueIndexV3(
          queue,
          candidateIndex
        )
      ) {
        queued[
          candidateIndex
        ] =
          1;
      }
    }
  }

  let connectedPixelCount =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      maps.connectedBackground[index] !==
      0
    ) {
      connectedPixelCount +=
        1;
    }
  }

  return {
    connectedPixelCount,

    initialSeedPixelCount,

    expandedPixelCount,

    rejectedPixelCount,

    maximumQueueLength,
  };
}

/* =========================================================
 * Remove weak disconnected background
 * ======================================================= */

function suppressDisconnectedBackgroundV3(
  maps:
    BackgroundUnderstandingInternalMapsV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): void {
  const pixelCount =
    maps.backgroundConfidence.length;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      maps.connectedBackground[index] !==
      0
    ) {
      maps.backgroundConfidence[index] =
        clampUnitValue(
          Math.max(
            maps.backgroundConfidence[index],
            config.regionGrowingRelaxedThreshold
          )
        );

      continue;
    }

    const background =
      maps.backgroundConfidence[index];

    const foreground =
      maps.foregroundEvidence[index];

    if (
      background >
        0.5 &&
      foreground >=
        background
    ) {
      maps.backgroundConfidence[index] *=
        0.72;
    } else if (
      background >
      config.regionGrowingRelaxedThreshold
    ) {
      maps.backgroundConfidence[index] =
        config.regionGrowingRelaxedThreshold +
        (
          background -
          config.regionGrowingRelaxedThreshold
        ) *
          0.45;
    }

    maps.backgroundConfidence[index] =
      clampUnitValue(
        maps.backgroundConfidence[index]
      );
  }
}

/* =========================================================
 * Strong map reconciliation
 * ======================================================= */

function reconcileStrongMapsV3(
  maps:
    BackgroundUnderstandingInternalMapsV3,
  mask:
    SegmentationFloatMask,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): void {
  const pixelCount =
    mask.width *
    mask.height;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const maskValue =
      clampUnitValue(
        mask.data[index]
      );

    const background =
      clampUnitValue(
        maps.backgroundConfidence[index]
      );

    const foreground =
      clampUnitValue(
        maps.foregroundEvidence[index]
      );

    const connected =
      maps.connectedBackground[index] !==
      0;

    const strongBackground =
      connected &&
      (
        background >=
          0.64 ||
        (
          maskValue <=
            config.strongBackgroundMaskThreshold &&
          background >=
            0.54
        )
      ) &&
      foreground <=
        0.58;

    const strongForeground =
      !connected &&
      (
        foreground >=
          0.68 ||
        (
          maskValue >=
            config.strongForegroundMaskThreshold &&
          foreground >
            background
        )
      );

    maps.strongBackground[index] =
      strongBackground
        ? 1
        : 0;

    maps.strongForeground[index] =
      strongForeground
        ? 1
        : 0;

    if (
      strongBackground
    ) {
      maps.uncertainty[index] *=
        0.5;
    }

    if (
      strongForeground
    ) {
      maps.uncertainty[index] *=
        0.62;
    }

    maps.uncertainty[index] =
      clampUnitValue(
        maps.uncertainty[index]
      );
  }
}

/* =========================================================
 * Thin structure protection
 * ======================================================= */

function countForegroundNeighboursV3(
  map:
    Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number
): number {
  let count =
    0;

  for (
    const neighbour of
      BACKGROUND_UNDERSTANDING_NEIGHBOURS_8_V3
  ) {
    const sampleX =
      x + neighbour[0];

    const sampleY =
      y + neighbour[1];

    if (
      !isInsideImageV3(
        sampleX,
        sampleY,
        width,
        height
      )
    ) {
      continue;
    }

    const index =
      getPixelIndexV3(
        sampleX,
        sampleY,
        width
      );

    if (
      map[index] !== 0
    ) {
      count +=
        1;
    }
  }

  return count;
}

function protectThinForegroundStructuresV3(
  maps:
    BackgroundUnderstandingInternalMapsV3,
  mask:
    SegmentationFloatMask,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): void {
  const width =
    mask.width;

  const height =
    mask.height;

  const pixelCount =
    width * height;

  const protectedForeground =
    new Uint8Array(
      maps.strongForeground
    );

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const maskValue =
      mask.data[index];

    if (
      maskValue <
      0.42
    ) {
      continue;
    }

    const x =
      index % width;

    const y =
      Math.floor(
        index /
        width
      );

    const foregroundNeighbours =
      countForegroundNeighboursV3(
        maps.strongForeground,
        x,
        y,
        width,
        height
      );

    const gradient =
      maps.gradient[index];

    const barrier =
      maps.edgeBarrier[index];

    const background =
      maps.backgroundConfidence[index];

    const foreground =
      maps.foregroundEvidence[index];

    const thinStructureCandidate =
      foregroundNeighbours >=
        1 &&
      foregroundNeighbours <=
        4 &&
      (
        gradient >=
          config.strongEdgeThreshold *
            0.55 ||
        barrier >=
          0.52
      ) &&
      foreground >=
        background *
          0.82;

    if (
      !thinStructureCandidate
    ) {
      continue;
    }

    protectedForeground[index] =
      1;

    maps.foregroundEvidence[index] =
      Math.max(
        maps.foregroundEvidence[index],
        0.66
      );

    maps.backgroundConfidence[index] *=
      0.62;

    maps.connectedBackground[index] =
      0;

    maps.uncertainty[index] =
      Math.min(
        maps.uncertainty[index],
        0.46
      );
  }

  maps.strongForeground.set(
    protectedForeground
  );
}

/* =========================================================
 * Final probability reconciliation
 * ======================================================= */

function reconcileProbabilityMapsV3(
  maps:
    BackgroundUnderstandingInternalMapsV3,
  mask:
    SegmentationFloatMask,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): void {
  const pixelCount =
    mask.width *
    mask.height;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const maskValue =
      clampUnitValue(
        mask.data[index]
      );

    let background =
      clampUnitValue(
        maps.backgroundConfidence[index]
      );

    let foreground =
      clampUnitValue(
        maps.foregroundEvidence[index]
      );

    const barrier =
      clampUnitValue(
        maps.edgeBarrier[index]
      );

    const connected =
      maps.connectedBackground[index] !==
      0;

    if (
      connected
    ) {
      background =
        Math.max(
          background,
          config.regionGrowingRelaxedThreshold
        );

      foreground *=
        clampUnitValue(
          1 -
          background *
            0.42
        );
    }

    if (
      maps.strongForeground[index] !==
      0
    ) {
      foreground =
        Math.max(
          foreground,
          0.68
        );

      background *=
        0.58;
    }

    if (
      maps.strongBackground[index] !==
      0
    ) {
      background =
        Math.max(
          background,
          0.7
        );

      foreground *=
        0.48;
    }

    if (
      barrier >=
        0.68 &&
      maskValue >=
        0.42
    ) {
      background *=
        clampUnitValue(
          1 -
          barrier *
            0.38
        );

      foreground =
        Math.max(
          foreground,
          maskValue *
            0.62
        );
    }

    maps.backgroundConfidence[index] =
      clampUnitValue(
        background
      );

    maps.foregroundEvidence[index] =
      clampUnitValue(
        foreground
      );

    maps.uncertainty[index] =
      calculateUncertaintyV3(
        background,
        foreground,
        (
          maps.strongBackground[index] !==
            0 ||
          maps.strongForeground[index] !==
            0
        )
          ? 2
          : 1,
        maps.gradient[index],
        maskValue
      );
  }
}

/* =========================================================
 * Map count helpers
 * ======================================================= */

function countByteMapPixelsV3(
  map:
    Uint8Array
): number {
  let count =
    0;

  for (
    let index = 0;
    index < map.length;
    index += 1
  ) {
    if (
      map[index] !== 0
    ) {
      count +=
        1;
    }
  }

  return count;
}

function calculateFloatMapMeanV3(
  map:
    Float32Array
): number {
  if (
    map.length === 0
  ) {
    return 0;
  }

  let sum =
    0;

  for (
    let index = 0;
    index < map.length;
    index += 1
  ) {
    sum +=
      clampUnitValue(
        map[index]
      );
  }

  return safeSegmentationDivide(
    sum,
    map.length,
    0
  );
}

/* =========================================================
 * Final map classification
 * ======================================================= */

function classifyFinalProbabilityMapsV3(
  maps:
    BackgroundUnderstandingInternalMapsV3
): BackgroundUnderstandingProbabilityBuildResultV3 {
  const pixelCount =
    maps.backgroundConfidence.length;

  let probableBackgroundPixels =
    0;

  let probableForegroundPixels =
    0;

  let uncertainPixels =
    0;

  let backgroundSum =
    0;

  let foregroundSum =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const background =
      clampUnitValue(
        maps.backgroundConfidence[index]
      );

    const foreground =
      clampUnitValue(
        maps.foregroundEvidence[index]
      );

    const uncertainty =
      clampUnitValue(
        maps.uncertainty[index]
      );

    backgroundSum +=
      background;

    foregroundSum +=
      foreground;

    if (
      maps.strongBackground[index] !==
        0 ||
      (
        background >=
          0.58 &&
        background >
          foreground
      )
    ) {
      probableBackgroundPixels +=
        1;
    } else if (
      maps.strongForeground[index] !==
        0 ||
      (
        foreground >=
          0.58 &&
        foreground >
          background
      )
    ) {
      probableForegroundPixels +=
        1;
    } else if (
      uncertainty >=
        0.34
    ) {
      uncertainPixels +=
        1;
    } else if (
      background >=
      foreground
    ) {
      probableBackgroundPixels +=
        1;
    } else {
      probableForegroundPixels +=
        1;
    }
  }

  return {
    probableBackgroundPixels,

    probableForegroundPixels,

    uncertainPixels,

    meanBackgroundConfidence:
      safeSegmentationDivide(
        backgroundSum,
        pixelCount,
        0
      ),

    meanForegroundEvidence:
      safeSegmentationDivide(
        foregroundSum,
        pixelCount,
        0
      ),
  };
}

/* =========================================================
 * Internal analysis result
 * ======================================================= */

type BackgroundUnderstandingMapAnalysisResultV3 = {
  initialProbability:
    BackgroundUnderstandingProbabilityBuildResultV3;

  finalProbability:
    BackgroundUnderstandingProbabilityBuildResultV3;

  edgeBarrier:
    BackgroundUnderstandingEdgeBarrierBuildResultV3;

  regionGrowing:
    BackgroundUnderstandingRegionGrowingResultV3;

  floodFill:
    BackgroundUnderstandingFloodFillResultV3;

  connectedBackgroundPixels: number;

  strongBackgroundPixels: number;

  strongForegroundPixels: number;

  meanUncertainty: number;
};

/* =========================================================
 * Complete map analysis
 * ======================================================= */

function analyzeBackgroundMapsV3(
  image:
    SegmentationRgbaImageSource,
  mask:
    SegmentationFloatMask,
  maps:
    BackgroundUnderstandingInternalMapsV3,
  models:
    readonly BackgroundUnderstandingColorModelV3[],
  seeds:
    readonly BackgroundUnderstandingSeedV3[],
  subjectBounds:
    SegmentationMaskBounds | null,
  config:
    BackgroundUnderstandingNormalizedConfigV3,
  cancellationSignal:
    | SegmentationCancellationSignal
    | undefined
): BackgroundUnderstandingMapAnalysisResultV3 {
  const initialProbability =
    buildProbabilityMapsV3(
      image,
      mask,
      maps,
      models,
      seeds,
      subjectBounds,
      config,
      cancellationSignal
    );

    clearSceneReasoningMapsV3(
  maps
);

buildBorderReachabilityMapV3(
  image.width,
  image.height,
  maps,
  cancellationSignal
);

buildLargeSurfaceMapsV3(
  image.width,
  image.height,
  maps
);

buildStructuralLineMapV3(
  image.width,
  image.height,
  maps
);

buildCornerEvidenceMapV3(
  image.width,
  image.height,
  maps
);

buildBackgroundContinuationMapV3(
  image.width,
  image.height,
  maps
);

buildShadowConnectivityMapV3(
  image.width,
  image.height,
  maps
);

buildIlluminationGradientMapV3(
  image.width,
  image.height,
  maps
);

buildFoldLikelihoodMapV3(
  image.width,
  image.height,
  maps
);

buildMultiEvidenceConsensusMapV3(
  image.width,
  image.height,
  maps
);

  const edgeBarrier =
    buildEdgeBarrierV3(
      mask,
      maps,
      config,
      cancellationSignal
    );

  const regionGrowing =
    performRegionGrowingV3(
      image,
      maps,
      seeds,
      config,
      cancellationSignal
    );

  const floodFill =
    performBackgroundFloodFillV3(
      image,
      maps,
      config,
      cancellationSignal
    );

  suppressDisconnectedBackgroundV3(
    maps,
    config
  );

  reconcileStrongMapsV3(
    maps,
    mask,
    config
  );

  protectThinForegroundStructuresV3(
    maps,
    mask,
    config
  );

  reconcileProbabilityMapsV3(
    maps,
    mask,
    config
  );

  reconcileStrongMapsV3(
    maps,
    mask,
    config
  );

  const finalProbability =
    classifyFinalProbabilityMapsV3(
      maps
    );

  return {
    initialProbability,

    finalProbability,

    edgeBarrier,

    regionGrowing,

    floodFill,

    connectedBackgroundPixels:
      countByteMapPixelsV3(
        maps.connectedBackground
      ),

    strongBackgroundPixels:
      countByteMapPixelsV3(
        maps.strongBackground
      ),

    strongForegroundPixels:
      countByteMapPixelsV3(
        maps.strongForeground
      ),

    meanUncertainty:
      calculateFloatMapMeanV3(
        maps.uncertainty
      ),
  };
}
// scan/core/ai/BackgroundUnderstandingV3.ts
// Part 4/4
//
// يكمل مباشرة بعد:
//
// function analyzeBackgroundMapsV3(
//   image:
//     SegmentationRgbaImageSource,
//   mask:
//     SegmentationFloatMask,
//   maps:
//     BackgroundUnderstandingInternalMapsV3,
//   models:
//     readonly BackgroundUnderstandingColorModelV3[],
//   seeds:
//     readonly BackgroundUnderstandingSeedV3[],
//   subjectBounds:
//     SegmentationMaskBounds | null,
//   config:
//     BackgroundUnderstandingNormalizedConfigV3,
//   cancellationSignal:
//     | SegmentationCancellationSignal
//     | undefined
// ): BackgroundUnderstandingMapAnalysisResultV3 {
//   ...
// }

/* =========================================================
 * Diagnostics warning helpers
 * ======================================================= */

function appendUniqueWarningV3(
  warnings: string[],
  warning: string
): void {
  if (
    !warning ||
    warnings.includes(
      warning
    )
  ) {
    return;
  }

  warnings.push(
    warning
  );
}

function createDiagnosticsWarningsV3(
  seedCount: number,
  rejectedSeedCount: number,
  modelBuild:
    BackgroundUnderstandingModelBuildResultV3,
  mapAnalysis:
    BackgroundUnderstandingMapAnalysisResultV3,
  pixelCount: number,
  distribution:
    BackgroundUnderstandingDistributionV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): string[] {
  const warnings:
    string[] = [];

  const seedRatio =
    safeSegmentationDivide(
      seedCount,
      pixelCount,
      0
    );

  const rejectedRatio =
    safeSegmentationDivide(
      rejectedSeedCount,
      seedCount +
        rejectedSeedCount,
      0
    );

  const connectedRatio =
    safeSegmentationDivide(
      mapAnalysis
        .connectedBackgroundPixels,
      pixelCount,
      0
    );

  const probableBackgroundRatio =
    safeSegmentationDivide(
      mapAnalysis
        .finalProbability
        .probableBackgroundPixels,
      pixelCount,
      0
    );

  const probableForegroundRatio =
    safeSegmentationDivide(
      mapAnalysis
        .finalProbability
        .probableForegroundPixels,
      pixelCount,
      0
    );

  const uncertainRatio =
    safeSegmentationDivide(
      mapAnalysis
        .finalProbability
        .uncertainPixels,
      pixelCount,
      0
    );

  const strongEdgeRatio =
    safeSegmentationDivide(
      mapAnalysis
        .edgeBarrier
        .strongEdgePixels,
      pixelCount,
      0
    );

  if (
    seedCount <
    config.minimumSeedCount
  ) {
    appendUniqueWarningV3(
      warnings,
      [
        'BackgroundUnderstandingV3 collected fewer background seeds than recommended.',
        `Collected: ${seedCount}.`,
        `Recommended minimum: ${config.minimumSeedCount}.`,
      ].join(' ')
    );
  }

  if (
    seedRatio <
    0.0005
  ) {
    appendUniqueWarningV3(
      warnings,
      'Background seed coverage is extremely low.'
    );
  }

  if (
    rejectedRatio >
    0.75
  ) {
    appendUniqueWarningV3(
      warnings,
      'Most background seed candidates were rejected.'
    );
  }

  if (
    modelBuild.models.length ===
    0
  ) {
    appendUniqueWarningV3(
      warnings,
      'No valid background color model could be created.'
    );
  }

  if (
    modelBuild.usedFallbackModel
  ) {
    appendUniqueWarningV3(
      warnings,
      'A relaxed fallback background model was used.'
    );
  }

  if (
    distribution ===
    'uncertain'
  ) {
    appendUniqueWarningV3(
      warnings,
      'The background distribution could not be classified reliably.'
    );
  }

  if (
    distribution ===
    'textured'
  ) {
    appendUniqueWarningV3(
      warnings,
      'The detected background contains significant texture.'
    );
  }

  if (
    uncertainRatio >
    0.28
  ) {
    appendUniqueWarningV3(
      warnings,
      'A large image region remains uncertain after background analysis.'
    );
  }

  if (
    connectedRatio <
    0.08
  ) {
    appendUniqueWarningV3(
      warnings,
      'Only a small background region is connected to the image borders.'
    );
  }

  if (
    connectedRatio >
    0.93
  ) {
    appendUniqueWarningV3(
      warnings,
      'Background connectivity covers almost the entire image.'
    );
  }

  if (
    probableForegroundRatio <
    0.01
  ) {
    appendUniqueWarningV3(
      warnings,
      'Very little foreground evidence was detected.'
    );
  }

  if (
    probableForegroundRatio >
    0.92
  ) {
    appendUniqueWarningV3(
      warnings,
      'Foreground evidence covers almost the entire image.'
    );
  }

  if (
    probableBackgroundRatio <
    0.03
  ) {
    appendUniqueWarningV3(
      warnings,
      'Very little probable background was detected.'
    );
  }

  if (
    strongEdgeRatio >
    0.42
  ) {
    appendUniqueWarningV3(
      warnings,
      'The image contains a high concentration of strong edges.'
    );
  }

  if (
    mapAnalysis
      .finalProbability
      .meanBackgroundConfidence <
    0.22
  ) {
    appendUniqueWarningV3(
      warnings,
      'Mean background confidence is weak.'
    );
  }

  if (
    mapAnalysis.meanUncertainty >
    0.58
  ) {
    appendUniqueWarningV3(
      warnings,
      'Mean classification uncertainty is high.'
    );
  }

  if (
    mapAnalysis
      .regionGrowing
      .acceptedPixelCount <=
      0
  ) {
    appendUniqueWarningV3(
      warnings,
      'Region growing did not expand beyond its initial seeds.'
    );
  }

  if (
    mapAnalysis
      .floodFill
      .expandedPixelCount <=
      0
  ) {
    appendUniqueWarningV3(
      warnings,
      'Background flood fill did not expand.'
    );
  }

  return warnings;
}

/* =========================================================
 * Quality calculation
 * ======================================================= */

function calculateBackgroundQualityScoreV3(
  seedCount: number,
  modelBuild:
    BackgroundUnderstandingModelBuildResultV3,
  mapAnalysis:
    BackgroundUnderstandingMapAnalysisResultV3,
  pixelCount: number,
  distribution:
    BackgroundUnderstandingDistributionV3,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  if (
    pixelCount <= 0
  ) {
    return 0;
  }

  const seedConfidence =
    clampUnitValue(
      seedCount /
        Math.max(
          1,
          config.minimumSeedCount *
            1.5
        )
    );

  let meanModelConfidence =
    0;

  let modelWeightSum =
    0;

  for (
    const model of
      modelBuild.models
  ) {
    const weight =
      Math.max(
        0.01,
        model.weight
      );

    meanModelConfidence +=
      model.confidence *
      weight;

    modelWeightSum +=
      weight;
  }

  meanModelConfidence =
    safeSegmentationDivide(
      meanModelConfidence,
      modelWeightSum,
      0
    );

  const modelCountConfidence =
    clampUnitValue(
      modelBuild.models.length /
        Math.max(
          1,
          Math.min(
            4,
            config.maximumColorClusters +
              1
          )
        )
    );

  const connectedRatio =
    safeSegmentationDivide(
      mapAnalysis
        .connectedBackgroundPixels,
      pixelCount,
      0
    );

  const connectivityConfidence =
    connectedRatio <= 0
      ? 0
      : connectedRatio < 0.04
        ? connectedRatio /
          0.04
        : connectedRatio >
            0.96
          ? clampUnitValue(
              (
                1 -
                connectedRatio
              ) /
                0.04
            )
          : 1;

  const uncertaintyConfidence =
    1 -
    clampUnitValue(
      mapAnalysis.meanUncertainty
    );

  const backgroundConfidence =
    clampUnitValue(
      mapAnalysis
        .finalProbability
        .meanBackgroundConfidence
    );

  const foregroundConfidence =
    clampUnitValue(
      mapAnalysis
        .finalProbability
        .meanForegroundEvidence
    );

  const classBalance =
    clampUnitValue(
      Math.min(
        mapAnalysis
          .finalProbability
          .probableBackgroundPixels,
        mapAnalysis
          .finalProbability
          .probableForegroundPixels
      ) /
        Math.max(
          1,
          Math.max(
            mapAnalysis
              .finalProbability
              .probableBackgroundPixels,
            mapAnalysis
              .finalProbability
              .probableForegroundPixels
          )
        ) *
        2
    );

  let distributionConfidence:
    number;

  switch (
    distribution
  ) {
    case 'uniform':
      distributionConfidence =
        1;
      break;

    case 'smooth-gradient':
      distributionConfidence =
        0.92;
      break;

    case 'multi-region':
      distributionConfidence =
        0.82;
      break;

    case 'textured':
      distributionConfidence =
        0.68;
      break;

    case 'uncertain':
    default:
      distributionConfidence =
        0.38;
      break;
  }

  let score =
    weightedAverageV3(
      [
        seedConfidence,
        meanModelConfidence,
        modelCountConfidence,
        connectivityConfidence,
        uncertaintyConfidence,
        backgroundConfidence,
        foregroundConfidence,
        classBalance,
        distributionConfidence,
      ],
      [
        0.13,
        0.18,
        0.08,
        0.14,
        0.14,
        0.1,
        0.07,
        0.06,
        0.1,
      ],
      0
    );

  if (
    modelBuild.usedFallbackModel
  ) {
    score *=
      0.84;
  }

  if (
    modelBuild.models.length ===
    0
  ) {
    score *=
      0.35;
  }

  if (
    seedCount <
    config.minimumSeedCount
  ) {
    score *=
      clampSegmentationValue(
        seedCount /
          Math.max(
            1,
            config.minimumSeedCount
          ),
        0.35,
        1
      );
  }

  return clampUnitValue(
    score
  );
}

function classifyBackgroundQualityV3(
  score: number,
  modelCount: number,
  seedCount: number
): BackgroundUnderstandingQualityV3 {
  if (
    modelCount <= 0 ||
    seedCount <= 0
  ) {
    return 'invalid';
  }

  if (
    score >= 0.84
  ) {
    return 'excellent';
  }

  if (
    score >= 0.7
  ) {
    return 'good';
  }

  if (
    score >= 0.53
  ) {
    return 'acceptable';
  }

  if (
    score > 0
  ) {
    return 'weak';
  }

  return 'invalid';
}

/* =========================================================
 * Border background measurement
 * ======================================================= */

function calculateBorderBackgroundRatioV3(
  maps:
    BackgroundUnderstandingInternalMapsV3,
  width: number,
  height: number,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): number {
  const band =
    getBorderBandPixelsV3(
      width,
      height,
      config
    );

  let backgroundPixels =
    0;

  let borderPixels =
    0;

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y * width;

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      if (
        getDistanceToBorderPixelsV3(
          x,
          y,
          width,
          height
        ) >= band
      ) {
        continue;
      }

      const index =
        rowOffset + x;

      borderPixels +=
        1;

      if (
        maps.connectedBackground[index] !==
          0 ||
        maps.strongBackground[index] !==
          0 ||
        maps.backgroundConfidence[index] >=
          0.58
      ) {
        backgroundPixels +=
          1;
      }
    }
  }

  return clampUnitValue(
    safeSegmentationDivide(
      backgroundPixels,
      borderPixels,
      0
    )
  );
}

/* =========================================================
 * Diagnostics creation
 * ======================================================= */

type BackgroundUnderstandingDiagnosticsInputV3 = {
  requestId:
    string | null;

  width: number;

  height: number;

  seeds:
    readonly BackgroundUnderstandingSeedV3[];

  rejectedSeeds:
    readonly BackgroundUnderstandingRejectedSeedV3[];

  modelBuild:
    BackgroundUnderstandingModelBuildResultV3;

  mapAnalysis:
    BackgroundUnderstandingMapAnalysisResultV3;

  distribution:
    BackgroundUnderstandingDistributionV3;

  meanSeedTexture: number;

  maps:
    BackgroundUnderstandingInternalMapsV3;

  timings:
    MutableBackgroundUnderstandingTimingsV3;

  config:
    BackgroundUnderstandingNormalizedConfigV3;
};

function createDiagnosticsV3(
  input:
    BackgroundUnderstandingDiagnosticsInputV3
): BackgroundUnderstandingDiagnosticsV3 {
  const {
    requestId,
    width,
    height,
    seeds,
    rejectedSeeds,
    modelBuild,
    mapAnalysis,
    distribution,
    meanSeedTexture,
    maps,
    timings,
    config,
  } = input;

  const pixelCount =
    width * height;

  const qualityScore =
    calculateBackgroundQualityScoreV3(
      seeds.length,
      modelBuild,
      mapAnalysis,
      pixelCount,
      distribution,
      config
    );

  const quality =
    classifyBackgroundQualityV3(
      qualityScore,
      modelBuild.models.length,
      seeds.length
    );

  const borderBackgroundRatio =
    calculateBorderBackgroundRatioV3(
      maps,
      width,
      height,
      config
    );

  const connectedBackgroundRatio =
    safeSegmentationDivide(
      mapAnalysis
        .connectedBackgroundPixels,
      pixelCount,
      0
    );

  const probableBackgroundRatio =
    safeSegmentationDivide(
      mapAnalysis
        .finalProbability
        .probableBackgroundPixels,
      pixelCount,
      0
    );

  const probableForegroundRatio =
    safeSegmentationDivide(
      mapAnalysis
        .finalProbability
        .probableForegroundPixels,
      pixelCount,
      0
    );

  const uncertainRatio =
    safeSegmentationDivide(
      mapAnalysis
        .finalProbability
        .uncertainPixels,
      pixelCount,
      0
    );

  const strongEdgeRatio =
    safeSegmentationDivide(
      mapAnalysis
        .edgeBarrier
        .strongEdgePixels,
      pixelCount,
      0
    );

  const warnings =
    createDiagnosticsWarningsV3(
      seeds.length,
      rejectedSeeds.length,
      modelBuild,
      mapAnalysis,
      pixelCount,
      distribution,
      config
    );

  if (
    meanSeedTexture >
    0.22
  ) {
    appendUniqueWarningV3(
      warnings,
      'Accepted background seeds contain considerable local texture.'
    );
  }

  return {
    requestId,

    width,

    height,

    pixelCount,

    quality,

    distribution,

    acceptedSeedCount:
      seeds.length,

    rejectedSeedCount:
      rejectedSeeds.length,

    modelCount:
      modelBuild.models.length,

    clusterCount:
      modelBuild.clusters.length,

    borderBackgroundRatio:
      clampUnitValue(
        borderBackgroundRatio
      ),

    connectedBackgroundRatio:
      clampUnitValue(
        connectedBackgroundRatio
      ),

    probableBackgroundRatio:
      clampUnitValue(
        probableBackgroundRatio
      ),

    probableForegroundRatio:
      clampUnitValue(
        probableForegroundRatio
      ),

    uncertainRatio:
      clampUnitValue(
        uncertainRatio
      ),

    strongEdgeRatio:
      clampUnitValue(
        strongEdgeRatio
      ),

    meanBackgroundConfidence:
      clampUnitValue(
        mapAnalysis
          .finalProbability
          .meanBackgroundConfidence
      ),

    meanForegroundEvidence:
      clampUnitValue(
        mapAnalysis
          .finalProbability
          .meanForegroundEvidence
      ),

    globalColorVariation:
      calculateLabVariationV3(
        modelBuild.statistics
      ),

    luminanceVariation:
      clampUnitValue(
        modelBuild
          .statistics
          .luminanceStandardDeviation
      ),

    chromaVariation:
      clampUnitValue(
        modelBuild
          .statistics
          .chromaStandardDeviation
      ),

    detectedShadowModel:
      modelBuild.detectedShadowModel,

    detectedHighlightModel:
      modelBuild.detectedHighlightModel,

    usedFallbackModel:
      modelBuild.usedFallbackModel,

    warnings,

    timings: {
      validationMs:
        timings.validationMs,

      gradientMapMs:
        timings.gradientMapMs,

      textureMapMs:
        timings.textureMapMs,

      seedExtractionMs:
        timings.seedExtractionMs,

      colorStatisticsMs:
        timings.colorStatisticsMs,

      colorClusteringMs:
        timings.colorClusteringMs,

      modelBuildingMs:
        timings.modelBuildingMs,

      probabilityMapsMs:
        timings.probabilityMapsMs,

      edgeBarrierMs:
        timings.edgeBarrierMs,

      regionGrowingMs:
        timings.regionGrowingMs,

      floodFillMs:
        timings.floodFillMs,

      diagnosticsMs:
        timings.diagnosticsMs,

      totalMs:
        timings.totalMs,
    },

    seeds,

    rejectedSeeds,
  };
}

/* =========================================================
 * Subject bounds resolution
 * ======================================================= */

function isUsableMaskBoundsV3(
  bounds:
    SegmentationMaskBounds | null | undefined,
  width: number,
  height: number
): bounds is SegmentationMaskBounds {
  if (!bounds) {
    return false;
  }

  if (
    !Number.isFinite(
      bounds.x
    ) ||
    !Number.isFinite(
      bounds.y
    ) ||
    !Number.isFinite(
      bounds.width
    ) ||
    !Number.isFinite(
      bounds.height
    ) ||
    !Number.isFinite(
      bounds.x2
    ) ||
    !Number.isFinite(
      bounds.y2
    )
  ) {
    return false;
  }

  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x2 <
      bounds.x ||
    bounds.y2 <
      bounds.y
  ) {
    return false;
  }

  if (
    bounds.x >= width ||
    bounds.y >= height ||
    bounds.x2 < 0 ||
    bounds.y2 < 0
  ) {
    return false;
  }

  return true;
}

function normalizeMaskBoundsV3(
  bounds:
    SegmentationMaskBounds,
  width: number,
  height: number
): SegmentationMaskBounds {
  const x =
    clampIntegerV3(
      bounds.x,
      0,
      Math.max(
        0,
        width - 1
      )
    );

  const y =
    clampIntegerV3(
      bounds.y,
      0,
      Math.max(
        0,
        height - 1
      )
    );

  const x2 =
    clampIntegerV3(
      bounds.x2,
      x,
      Math.max(
        x,
        width - 1
      )
    );

  const y2 =
    clampIntegerV3(
      bounds.y2,
      y,
      Math.max(
        y,
        height - 1
      )
    );

  const normalizedWidth =
    x2 - x + 1;

  const normalizedHeight =
    y2 - y + 1;

  const area =
    normalizedWidth *
    normalizedHeight;

  return {
    x,

    y,

    width:
      normalizedWidth,

    height:
      normalizedHeight,

    x2,

    y2,

    area,

    areaRatio:
      safeSegmentationDivide(
        area,
        width * height,
        0
      ),
  };
}

function resolveSubjectBoundsV3(
  inputBounds:
    SegmentationMaskBounds | null | undefined,
  mask:
    SegmentationFloatMask,
  config:
    BackgroundUnderstandingNormalizedConfigV3
): SegmentationMaskBounds | null {
  const width =
    mask.width;

  const height =
    mask.height;

  const baseBounds =
    isUsableMaskBoundsV3(
      inputBounds,
      width,
      height
    )
      ? normalizeMaskBoundsV3(
          inputBounds,
          width,
          height
        )
      : calculateMaskBoundsV3(
          mask,
          Math.max(
            0.34,
            config
              .strongBackgroundMaskThreshold
          )
        );

  if (!baseBounds) {
    return null;
  }

  return expandBoundsV3(
    baseBounds,
    width,
    height,
    config.subjectBoundsExpansionRatio
  );
}

/* =========================================================
 * Timing helpers
 * ======================================================= */

function measureStageV3<T>(
  run: () => T,
  assignTiming:
    (milliseconds: number) => void
): T {
  const startedAt =
    nowV3();

  try {
    return run();
  } finally {
    assignTiming(
      Math.max(
        0,
        nowV3() -
          startedAt
      )
    );
  }
}

/* =========================================================
 * Public validation API
 * ======================================================= */

export function validateBackgroundUnderstandingInputV3(
  input:
    BackgroundUnderstandingInputV3
): BackgroundUnderstandingConfigV3 {
  const config =
    normalizeConfigV3(
      input?.config
    );

  validateInputV3(
    input,
    config
  );

  return config;
}

/* =========================================================
 * Public config API
 * ======================================================= */

export function createBackgroundUnderstandingConfigV3(
  overrides?:
    Partial<BackgroundUnderstandingConfigV3>
): BackgroundUnderstandingConfigV3 {
  return normalizeConfigV3(
    overrides
  );
}

/* =========================================================
 * Public map guards
 * ======================================================= */

export function isBackgroundUnderstandingMapV3(
  value: unknown
): value is BackgroundUnderstandingMapV3 {
  if (
    !value ||
    typeof value !==
      'object'
  ) {
    return false;
  }

  const candidate =
    value as
      Partial<BackgroundUnderstandingMapV3>;

  if (
    !Number.isInteger(
      candidate.width
    ) ||
    !Number.isInteger(
      candidate.height
    ) ||
    (
      candidate.width ??
      0
    ) <= 0 ||
    (
      candidate.height ??
      0
    ) <= 0
  ) {
    return false;
  }

  if (
    !(
      candidate.data instanceof
      Float32Array
    )
  ) {
    return false;
  }

  return (
    candidate.data.length ===
    (
      candidate.width as number
    ) *
      (
        candidate.height as number
      )
  );
}

export function isBackgroundUnderstandingByteMapV3(
  value: unknown
): value is BackgroundUnderstandingByteMapV3 {
  if (
    !value ||
    typeof value !==
      'object'
  ) {
    return false;
  }

  const candidate =
    value as
      Partial<BackgroundUnderstandingByteMapV3>;

  if (
    !Number.isInteger(
      candidate.width
    ) ||
    !Number.isInteger(
      candidate.height
    ) ||
    (
      candidate.width ??
      0
    ) <= 0 ||
    (
      candidate.height ??
      0
    ) <= 0
  ) {
    return false;
  }

  if (
    !(
      candidate.data instanceof
      Uint8Array
    )
  ) {
    return false;
  }

  return (
    candidate.data.length ===
    (
      candidate.width as number
    ) *
      (
        candidate.height as number
      )
  );
}

/* =========================================================
 * Result guard
 * ======================================================= */

export function isBackgroundUnderstandingResultV3(
  value: unknown
): value is BackgroundUnderstandingResultV3 {
  if (
    !value ||
    typeof value !==
      'object'
  ) {
    return false;
  }

  const candidate =
    value as
      Partial<BackgroundUnderstandingResultV3>;

  if (
    !Number.isInteger(
      candidate.width
    ) ||
    !Number.isInteger(
      candidate.height
    ) ||
    (
      candidate.width ??
      0
    ) <= 0 ||
    (
      candidate.height ??
      0
    ) <= 0
  ) {
    return false;
  }

  return (
    isBackgroundUnderstandingMapV3(
      candidate
        .backgroundConfidence
    ) &&
    isBackgroundUnderstandingMapV3(
      candidate
        .foregroundEvidence
    ) &&
    isBackgroundUnderstandingMapV3(
      candidate.uncertainty
    ) &&
    isBackgroundUnderstandingMapV3(
      candidate.gradient
    ) &&
    isBackgroundUnderstandingMapV3(
      candidate.texture
    ) &&
    isBackgroundUnderstandingMapV3(
      candidate.edgeBarrier
    ) &&
    isBackgroundUnderstandingByteMapV3(
      candidate
        .connectedBackground
    ) &&
    isBackgroundUnderstandingByteMapV3(
      candidate
        .strongBackground
    ) &&
    isBackgroundUnderstandingByteMapV3(
      candidate
        .strongForeground
    ) &&
    Array.isArray(
      candidate.seeds
    ) &&
    Array.isArray(
      candidate.models
    ) &&
    !!candidate.diagnostics &&
    typeof candidate.diagnostics ===
      'object'
  );
}

/* =========================================================
 * Result clone helpers
 * ======================================================= */

function cloneFloatMapV3(
  map:
    BackgroundUnderstandingMapV3
): BackgroundUnderstandingMapV3 {
  return {
    width:
      map.width,

    height:
      map.height,

    data:
      new Float32Array(
        map.data
      ),
  };
}

function cloneByteMapV3(
  map:
    BackgroundUnderstandingByteMapV3
): BackgroundUnderstandingByteMapV3 {
  return {
    width:
      map.width,

    height:
      map.height,

    data:
      new Uint8Array(
        map.data
      ),
  };
}

function cloneSeedV3(
  seed:
    BackgroundUnderstandingSeedV3
): BackgroundUnderstandingSeedV3 {
  return {
    ...seed,

    color: {
      rgb: {
        ...seed.color.rgb,
      },

      lab: {
        ...seed.color.lab,
      },

      ycbcr: {
        ...seed.color.ycbcr,
      },

      luminance:
        seed.color.luminance,

      chroma:
        seed.color.chroma,

      saturation:
        seed.color.saturation,
    },
  };
}

function cloneColorModelV3(
  model:
    BackgroundUnderstandingColorModelV3
): BackgroundUnderstandingColorModelV3 {
  return {
    ...model,

    centerRgb: {
      ...model.centerRgb,
    },

    centerLab: {
      ...model.centerLab,
    },

    centerYcbcr: {
      ...model.centerYcbcr,
    },

    spatialCenter:
      model.spatialCenter
        ? {
            ...model.spatialCenter,
          }
        : null,

    sourceSeedIds: [
      ...model.sourceSeedIds,
    ],
  };
}

export function cloneBackgroundUnderstandingResultV3(
  result:
    BackgroundUnderstandingResultV3
): BackgroundUnderstandingResultV3 {
  return {
    width:
      result.width,

    height:
      result.height,

    backgroundConfidence:
      cloneFloatMapV3(
        result.backgroundConfidence
      ),

    foregroundEvidence:
      cloneFloatMapV3(
        result.foregroundEvidence
      ),

    uncertainty:
      cloneFloatMapV3(
        result.uncertainty
      ),

    gradient:
      cloneFloatMapV3(
        result.gradient
      ),

    texture:
      cloneFloatMapV3(
        result.texture
      ),

    edgeBarrier:
      cloneFloatMapV3(
        result.edgeBarrier
      ),

    connectedBackground:
      cloneByteMapV3(
        result.connectedBackground
      ),

    strongBackground:
      cloneByteMapV3(
        result.strongBackground
      ),

    strongForeground:
      cloneByteMapV3(
        result.strongForeground
      ),

    seeds:
      result.seeds.map(
        cloneSeedV3
      ),

    colorStatistics: {
      ...result.colorStatistics,

      meanRgb: {
        ...result
          .colorStatistics
          .meanRgb,
      },

      meanLab: {
        ...result
          .colorStatistics
          .meanLab,
      },

      meanYcbcr: {
        ...result
          .colorStatistics
          .meanYcbcr,
      },

      minimumRgb: {
        ...result
          .colorStatistics
          .minimumRgb,
      },

      maximumRgb: {
        ...result
          .colorStatistics
          .maximumRgb,
      },

      standardDeviationRgb: {
        ...result
          .colorStatistics
          .standardDeviationRgb,
      },

      standardDeviationLab: {
        ...result
          .colorStatistics
          .standardDeviationLab,
      },
    },

    models:
      result.models.map(
        cloneColorModelV3
      ),

    diagnostics: {
      ...result.diagnostics,

      warnings: [
        ...result
          .diagnostics
          .warnings,
      ],

      timings: {
        ...result
          .diagnostics
          .timings,
      },

      seeds:
        result.diagnostics.seeds.map(
          cloneSeedV3
        ),

      rejectedSeeds:
        result
          .diagnostics
          .rejectedSeeds
          .map(
            rejected => ({
              ...rejected,
            })
          ),
    },
  };
}

/* =========================================================
 * Public analysis API
 * ======================================================= */

/**
 * ينفّذ التحليل الكامل للخلفية.
 *
 * هذه الدالة:
 *
 * - لا تعدّل الصورة.
 * - لا تعدّل الماسك المدخل.
 * - لا تختار Candidate.
 * - لا تنتج Alpha Mask نهائية.
 *
 * الناتج عبارة عن Evidence Maps وModels وDiagnostics
 * يمكن استخدامها داخل مراحل Voting وRefinement والCleanup.
 */
export function analyzeBackgroundUnderstandingV3(
  input:
    BackgroundUnderstandingInputV3
): BackgroundUnderstandingResultV3 {
  const totalStartedAt =
    nowV3();

  const timings =
    createEmptyTimingsV3();

  let config:
    BackgroundUnderstandingNormalizedConfigV3;

  measureStageV3(
    () => {
      config =
        normalizeConfigV3(
          input?.config
        );

      validateInputV3(
        input,
        config
      );
    },
    milliseconds => {
      timings.validationMs =
        milliseconds;
    }
  );

  config =
    config!;

  const {
    image,
    mask,
    cancellationSignal,
  } = input;

  const width =
    image.width;

  const height =
    image.height;

  const pixelCount =
    width * height;

  cancellationSignal
    ?.throwIfCancelled();

  const subjectBounds =
    resolveSubjectBoundsV3(
      input.subjectBounds,
      mask,
      config
    );

  const maps =
    createInternalMapsV3(
      pixelCount
    );

  measureStageV3(
    () => {
      buildGradientMapV3(
        image,
        maps.gradient,
        config,
        cancellationSignal
      );
    },
    milliseconds => {
      timings.gradientMapMs =
        milliseconds;
    }
  );

  cancellationSignal
    ?.throwIfCancelled();

  measureStageV3(
    () => {
      buildTextureMapV3(
        image,
        maps.texture,
        config,
        cancellationSignal
      );
    },
    milliseconds => {
      timings.textureMapMs =
        milliseconds;
    }
  );

  cancellationSignal
    ?.throwIfCancelled();

  let seedCollection:
    BackgroundUnderstandingSeedCollectionV3;

  measureStageV3(
    () => {
      seedCollection =
        extractSeedsV3(
          image,
          mask,
          maps,
          subjectBounds,
          config,
          cancellationSignal
        );

      seedCollection = {
        accepted:
          extractFallbackSeedsV3(
            image,
            mask,
            maps,
            seedCollection.accepted,
            config,
            cancellationSignal
          ),

        rejected:
          seedCollection.rejected,
      };
    },
    milliseconds => {
      timings.seedExtractionMs =
        milliseconds;
    }
  );

  seedCollection =
    seedCollection!;

  cancellationSignal
    ?.throwIfCancelled();

  let colorStatistics:
    BackgroundUnderstandingColorStatisticsV3;

  measureStageV3(
    () => {
      colorStatistics =
        calculateColorStatisticsV3(
          seedCollection.accepted
        );
    },
    milliseconds => {
      timings.colorStatisticsMs =
        milliseconds;
    }
  );

  colorStatistics =
    colorStatistics!;

  let preliminaryClusters:
    BackgroundUnderstandingClusterAccumulatorV3[];

  measureStageV3(
    () => {
      preliminaryClusters =
        createColorClustersV3(
          seedCollection.accepted,
          config
        );
    },
    milliseconds => {
      timings.colorClusteringMs =
        milliseconds;
    }
  );

  preliminaryClusters =
    preliminaryClusters!;

  cancellationSignal
    ?.throwIfCancelled();

  let modelBuild:
    BackgroundUnderstandingModelBuildResultV3;

  measureStageV3(
    () => {
      modelBuild =
        buildBackgroundModelsV3(
          seedCollection.accepted,
          width,
          height,
          config
        );

      if (
        modelBuild.clusters.length ===
          0 &&
        preliminaryClusters.length >
          0
      ) {
        modelBuild = {
          ...modelBuild,

          clusters:
            preliminaryClusters,
        };
      }

      if (
        modelBuild.statistics.count ===
          0 &&
        colorStatistics.count >
          0
      ) {
        modelBuild = {
          ...modelBuild,

          statistics:
            colorStatistics,
        };
      }
    },
    milliseconds => {
      timings.modelBuildingMs =
        milliseconds;
    }
  );

  modelBuild =
    modelBuild!;

  cancellationSignal
    ?.throwIfCancelled();

  const meanSeedTexture =
    calculateMeanSeedTextureV3(
      seedCollection.accepted
    );

  const distribution =
    classifyBackgroundDistributionV3(
      modelBuild.statistics,
      modelBuild.clusters.length,
      meanSeedTexture
    );

  let initialProbability:
    BackgroundUnderstandingProbabilityBuildResultV3;

  measureStageV3(
    () => {
      initialProbability =
        buildProbabilityMapsV3(
          image,
          mask,
          maps,
          modelBuild.models,
          seedCollection.accepted,
          subjectBounds,
          config,
          cancellationSignal
        );
    },
    milliseconds => {
      timings.probabilityMapsMs =
        milliseconds;
    }
  );

  initialProbability =
    initialProbability!;

  cancellationSignal
    ?.throwIfCancelled();

  let edgeBarrier:
    BackgroundUnderstandingEdgeBarrierBuildResultV3;

  measureStageV3(
    () => {
      edgeBarrier =
        buildEdgeBarrierV3(
          mask,
          maps,
          config,
          cancellationSignal
        );
    },
    milliseconds => {
      timings.edgeBarrierMs =
        milliseconds;
    }
  );

  edgeBarrier =
    edgeBarrier!;

  cancellationSignal
    ?.throwIfCancelled();

  let regionGrowing:
    BackgroundUnderstandingRegionGrowingResultV3;

  measureStageV3(
    () => {
      regionGrowing =
        performRegionGrowingV3(
          image,
          maps,
          seedCollection.accepted,
          config,
          cancellationSignal
        );
    },
    milliseconds => {
      timings.regionGrowingMs =
        milliseconds;
    }
  );

  regionGrowing =
    regionGrowing!;

  cancellationSignal
    ?.throwIfCancelled();

  let floodFill:
    BackgroundUnderstandingFloodFillResultV3;

  measureStageV3(
    () => {
      floodFill =
        performBackgroundFloodFillV3(
          image,
          maps,
          config,
          cancellationSignal
        );
    },
    milliseconds => {
      timings.floodFillMs =
        milliseconds;
    }
  );

  floodFill =
    floodFill!;

  suppressDisconnectedBackgroundV3(
    maps,
    config
  );

  reconcileStrongMapsV3(
    maps,
    mask,
    config
  );

  protectThinForegroundStructuresV3(
    maps,
    mask,
    config
  );

  reconcileProbabilityMapsV3(
    maps,
    mask,
    config
  );

  reconcileStrongMapsV3(
    maps,
    mask,
    config
  );

  cancellationSignal
    ?.throwIfCancelled();

  const finalProbability =
    classifyFinalProbabilityMapsV3(
      maps
    );

  const mapAnalysis:
    BackgroundUnderstandingMapAnalysisResultV3 = {
    initialProbability,

    finalProbability,

    edgeBarrier,

    regionGrowing,

    floodFill,

    connectedBackgroundPixels:
      countByteMapPixelsV3(
        maps.connectedBackground
      ),

    strongBackgroundPixels:
      countByteMapPixelsV3(
        maps.strongBackground
      ),

    strongForegroundPixels:
      countByteMapPixelsV3(
        maps.strongForeground
      ),

    meanUncertainty:
      calculateFloatMapMeanV3(
        maps.uncertainty
      ),
  };

  let diagnostics:
    BackgroundUnderstandingDiagnosticsV3;

  measureStageV3(
    () => {
      timings.totalMs =
        Math.max(
          0,
          nowV3() -
            totalStartedAt
        );

      diagnostics =
        createDiagnosticsV3({
          requestId:
            input.requestId ??
            null,

          width,

          height,

          seeds:
            seedCollection.accepted,

          rejectedSeeds:
            seedCollection.rejected,

          modelBuild,

          mapAnalysis,

          distribution,

          meanSeedTexture,

          maps,

          timings,

          config,
        });
    },
    milliseconds => {
      timings.diagnosticsMs =
        milliseconds;
    }
  );

  timings.totalMs =
    Math.max(
      0,
      nowV3() -
        totalStartedAt
    );

  diagnostics = {
    ...diagnostics!,

    timings: {
      ...diagnostics!
        .timings,

      diagnosticsMs:
        timings.diagnosticsMs,

      totalMs:
        timings.totalMs,
    },
  };

  cancellationSignal
    ?.throwIfCancelled();

  return {
    width,

    height,

    backgroundConfidence:
      createFloatMapV3(
        width,
        height,
        maps.backgroundConfidence
      ),

    foregroundEvidence:
      createFloatMapV3(
        width,
        height,
        maps.foregroundEvidence
      ),

    uncertainty:
      createFloatMapV3(
        width,
        height,
        maps.uncertainty
      ),

    gradient:
      createFloatMapV3(
        width,
        height,
        maps.gradient
      ),

    texture:
      createFloatMapV3(
        width,
        height,
        maps.texture
      ),

    edgeBarrier:
      createFloatMapV3(
        width,
        height,
        maps.edgeBarrier
      ),

    connectedBackground:
      createByteMapV3(
        width,
        height,
        maps.connectedBackground
      ),

    strongBackground:
      createByteMapV3(
        width,
        height,
        maps.strongBackground
      ),

    strongForeground:
      createByteMapV3(
        width,
        height,
        maps.strongForeground
      ),

    seeds:
      seedCollection.accepted,

    colorStatistics:
      modelBuild.statistics,

    models:
      modelBuild.models,

    diagnostics,
  };
}

/* =========================================================
 * Alias public API
 * ======================================================= */

/**
 * Alias مختصر للاستخدام داخل الـPipeline.
 */
export const runBackgroundUnderstandingV3 =
  analyzeBackgroundUnderstandingV3;

/* =========================================================
 * Public confidence sampling
 * ======================================================= */

export function sampleBackgroundConfidenceV3(
  result:
    BackgroundUnderstandingResultV3,
  x: number,
  y: number
): number {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    return 0;
  }

  const safeX =
    clampIntegerV3(
      x,
      0,
      result.width - 1
    );

  const safeY =
    clampIntegerV3(
      y,
      0,
      result.height - 1
    );

  return clampUnitValue(
    result
      .backgroundConfidence
      .data[
        getPixelIndexV3(
          safeX,
          safeY,
          result.width
        )
      ]
  );
}

export function sampleForegroundEvidenceV3(
  result:
    BackgroundUnderstandingResultV3,
  x: number,
  y: number
): number {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    return 0;
  }

  const safeX =
    clampIntegerV3(
      x,
      0,
      result.width - 1
    );

  const safeY =
    clampIntegerV3(
      y,
      0,
      result.height - 1
    );

  return clampUnitValue(
    result
      .foregroundEvidence
      .data[
        getPixelIndexV3(
          safeX,
          safeY,
          result.width
        )
      ]
  );
}

export function sampleBackgroundUncertaintyV3(
  result:
    BackgroundUnderstandingResultV3,
  x: number,
  y: number
): number {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    return 1;
  }

  const safeX =
    clampIntegerV3(
      x,
      0,
      result.width - 1
    );

  const safeY =
    clampIntegerV3(
      y,
      0,
      result.height - 1
    );

  return clampUnitValue(
    result
      .uncertainty
      .data[
        getPixelIndexV3(
          safeX,
          safeY,
          result.width
        )
      ]
  );
}

/* =========================================================
 * Public classification helpers
 * ======================================================= */

export type BackgroundUnderstandingPixelClassV3 =
  | 'strong-background'
  | 'probable-background'
  | 'uncertain'
  | 'probable-foreground'
  | 'strong-foreground';

export function classifyBackgroundUnderstandingPixelV3(
  result:
    BackgroundUnderstandingResultV3,
  x: number,
  y: number
): BackgroundUnderstandingPixelClassV3 {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    return 'uncertain';
  }

  const safeX =
    clampIntegerV3(
      x,
      0,
      result.width - 1
    );

  const safeY =
    clampIntegerV3(
      y,
      0,
      result.height - 1
    );

  const index =
    getPixelIndexV3(
      safeX,
      safeY,
      result.width
    );

  if (
    result
      .strongBackground
      .data[index] !== 0
  ) {
    return 'strong-background';
  }

  if (
    result
      .strongForeground
      .data[index] !== 0
  ) {
    return 'strong-foreground';
  }

  const background =
    result
      .backgroundConfidence
      .data[index];

  const foreground =
    result
      .foregroundEvidence
      .data[index];

  const uncertainty =
    result
      .uncertainty
      .data[index];

  if (
    uncertainty >=
      0.52 ||
    Math.abs(
      background -
      foreground
    ) <
      0.12
  ) {
    return 'uncertain';
  }

  if (
    background >
    foreground
  ) {
    return 'probable-background';
  }

  return 'probable-foreground';
}

/* =========================================================
 * Public mask helpers
 * ======================================================= */

/**
 * ينشئ خريطة Background Probability مستقلة.
 *
 * يتم نسخ البيانات حتى لا يستطيع المستهلك
 * تعديل نتيجة التحليل الأصلية بالخطأ.
 */
export function createBackgroundProbabilityMaskV3(
  result:
    BackgroundUnderstandingResultV3
): SegmentationFloatMask {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    throw new Error(
      'A valid BackgroundUnderstandingResultV3 is required.'
    );
  }

  return {
    width:
      result.width,

    height:
      result.height,

    data:
      new Float32Array(
        result
          .backgroundConfidence
          .data
      ),
  };
}

/**
 * ينشئ خريطة Foreground Evidence مستقلة.
 */
export function createForegroundEvidenceMaskV3(
  result:
    BackgroundUnderstandingResultV3
): SegmentationFloatMask {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    throw new Error(
      'A valid BackgroundUnderstandingResultV3 is required.'
    );
  }

  return {
    width:
      result.width,

    height:
      result.height,

    data:
      new Float32Array(
        result
          .foregroundEvidence
          .data
      ),
  };
}

/**
 * يحوّل الخلفية المتصلة إلى Float Mask.
 */
export function createConnectedBackgroundMaskV3(
  result:
    BackgroundUnderstandingResultV3
): SegmentationFloatMask {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    throw new Error(
      'A valid BackgroundUnderstandingResultV3 is required.'
    );
  }

  const pixelCount =
    result.width *
    result.height;

  const data =
    new Float32Array(
      pixelCount
    );

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    data[index] =
      result
        .connectedBackground
        .data[index] !== 0
        ? 1
        : 0;
  }

  return {
    width:
      result.width,

    height:
      result.height,

    data,
  };
}

/* =========================================================
 * Debug summary
 * ======================================================= */

export function getBackgroundUnderstandingDebugSummaryV3(
  result:
    BackgroundUnderstandingResultV3
): string {
  if (
    !isBackgroundUnderstandingResultV3(
      result
    )
  ) {
    return (
      'BackgroundUnderstandingV3: invalid result.'
    );
  }

  const diagnostics =
    result.diagnostics;

  return [
    'BackgroundUnderstandingV3',
    `${diagnostics.width}x${diagnostics.height}`,
    `quality=${diagnostics.quality}`,
    `distribution=${diagnostics.distribution}`,
    `seeds=${diagnostics.acceptedSeedCount}`,
    `models=${diagnostics.modelCount}`,
    `clusters=${diagnostics.clusterCount}`,
    `background=${diagnostics.probableBackgroundRatio.toFixed(3)}`,
    `foreground=${diagnostics.probableForegroundRatio.toFixed(3)}`,
    `connected=${diagnostics.connectedBackgroundRatio.toFixed(3)}`,
    `uncertain=${diagnostics.uncertainRatio.toFixed(3)}`,
    `meanBg=${diagnostics.meanBackgroundConfidence.toFixed(3)}`,
    `meanFg=${diagnostics.meanForegroundEvidence.toFixed(3)}`,
    `warnings=${diagnostics.warnings.length}`,
    `time=${diagnostics.timings.totalMs.toFixed(1)}ms`,
  ].join(' | ');
}

/* =========================================================
 * Default export
 * ======================================================= */

export default analyzeBackgroundUnderstandingV3;