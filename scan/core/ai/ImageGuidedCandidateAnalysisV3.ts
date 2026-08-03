// scan/core/ai/ImageGuidedCandidateAnalysisV3.ts
// Part 1/3
//
// Triple N - EdgeSAM Image-Guided Candidate Analysis V3
//
// هذه الطبقة لا تعدّل الماسك ولا تختار الـCandidate نهائيًا.
//
// مسؤوليتها:
//
// 1) استقبال صورة التحليل المصغرة.
// 2) استقبال Mask Candidate واحدة.
// 3) مقارنة حدود الـMask بحواف الصورة الحقيقية.
// 4) قياس اتساق ألوان الجسم.
// 5) اكتشاف تسرب الخلفية داخل الـMask.
// 6) قياس استقرار المنطقة الداخلية.
// 7) إنتاج Image-Guided Score مستقل.
// 8) توفير Diagnostics يمكن دمجها لاحقًا
//    مع Geometry Score وModel Score.
//
// تصميم الملف:
// - Part 1: الأنواع والإعدادات والتحقق والأدوات الأساسية.
// - Part 2: تحليل الحدود والألوان والتسرب والمنطقة الداخلية.
// - Part 3: التجميع النهائي والـPublic API.
//
// ملاحظة مهمة:
//
// ImageGuidedAnalysisImageV3 متوافق بنيويًا مع الصورة الناتجة من:
//
// createImageGuidedAnalysisImageV2(...)
//
// لذلك لن نحتاج إلى إعادة إنشاء الصورة أو نسخ Arrays جديدة.

import type {
    SegmentationCancellationSignal,
    SegmentationFloatMask,
} from './types';

import {
    SegmentationError,
    clampSegmentationValue,
    clampUnitValue,
    safeSegmentationDivide,
} from './types';

/* =========================================================
 * Public analysis image
 * ======================================================= */

/**
 * تمثيل الصورة المصغرة المستخدمة في تحليل الـCandidates.
 *
 * جميع القنوات يجب أن تكون داخل النطاق من 0 إلى 1.
 *
 * يمكن تمرير الكائن الناتج حاليًا من:
 *
 * createImageGuidedAnalysisImageV2(...)
 *
 * مباشرة إلى محلل V3 لأن TypeScript يعتمد هنا
 * على التوافق البنيوي.
 */
export type ImageGuidedAnalysisImageV3 = {
  width: number;

  height: number;

  red: Float32Array;

  green: Float32Array;

  blue: Float32Array;

  luminance: Float32Array;

  saturation: Float32Array;

  gradient: Float32Array;
};

/* =========================================================
 * Candidate input modes
 * ======================================================= */

/**
 * نوع قيم Candidate الداخلة إلى المحلل.
 *
 * logits:
 * القيم الخام الخارجة من Decoder.
 *
 * probabilities:
 * قيم مفعلة بالفعل داخل النطاق 0..1.
 *
 * auto:
 * يحدد النظام النوع من نطاق القيم.
 */
export type ImageGuidedCandidateValueMode =
  | 'auto'
  | 'logits'
  | 'probabilities';

/**
 * طريقة تفعيل Logits.
 */
export type ImageGuidedCandidateActivation =
  | 'auto'
  | 'sigmoid'
  | 'none';

/* =========================================================
 * Candidate analysis weights
 * ======================================================= */

/**
 * أوزان تجميع Image-Guided Score.
 *
 * يجب أن تكون جميع القيم غير سالبة.
 * سيتم تطبيعها داخليًا، لذلك ليس مطلوبًا
 * أن يكون مجموعها مساويًا لـ1.
 */
export type ImageGuidedCandidateWeightsV3 = {
  /**
   * تطابق حدود الماسك مع Gradient الصورة.
   */
  edgeAgreement: number;

  /**
   * قوة الحواف الحقيقية عند حدود الماسك.
   */
  boundaryStrength: number;

  /**
   * مدى اختلاف داخل الجسم عن الخلفية القريبة.
   */
  foregroundBackgroundSeparation: number;

  /**
   * اتساق ألوان المنطقة الداخلية.
   */
  colorConsistency: number;

  /**
   * استقرار الإضاءة داخل الجسم.
   */
  luminanceConsistency: number;

  /**
   * استقرار التشبع داخل الجسم.
   */
  saturationConsistency: number;

  /**
   * ثبات المنطقة الداخلية وعدم وجود مناطق شاذة كثيرة.
   */
  interiorStability: number;

  /**
   * مقاومة تسرب الخلفية داخل الماسك.
   */
  backgroundLeakageResistance: number;

  /**
   * جودة انتقال Alpha عبر الحدود.
   */
  alphaBoundaryQuality: number;
};

/* =========================================================
 * Candidate analysis configuration
 * ======================================================= */

export type ImageGuidedCandidateAnalysisConfigV3 = {
  /**
   * تفسير بيانات Candidate.
   */
  valueMode:
    ImageGuidedCandidateValueMode;

  /**
   * طريقة تحويل Logits إلى Probabilities.
   */
  activation:
    ImageGuidedCandidateActivation;

  /**
   * Threshold المستخدم لتعريف Foreground الأساسي.
   */
  foregroundThreshold: number;

  /**
   * Threshold أعلى لتعريف Foreground الموثوق.
   */
  confidentForegroundThreshold: number;

  /**
   * Threshold أقل لتعريف Background الموثوق.
   */
  confidentBackgroundThreshold: number;

  /**
   * أقل Alpha نعتبر عنده البكسل جزءًا من
   * المنطقة الانتقالية حول الحدود.
   */
  boundaryLowerThreshold: number;

  /**
   * أعلى Alpha نعتبر عنده البكسل جزءًا من
   * المنطقة الانتقالية حول الحدود.
   */
  boundaryUpperThreshold: number;

  /**
   * نصف قطر البحث حول Boundary Pixel.
   *
   * القيمة الصغيرة تحافظ على سرعة الهاتف.
   */
  boundarySearchRadius: number;

  /**
   * نصف قطر مقارنة لون الداخل بالخارج.
   */
  colorComparisonRadius: number;

  /**
   * المسافة الآمنة داخل الجسم عند جمع
   * عينات Foreground الموثوقة.
   */
  interiorSafeRadius: number;

  /**
   * خطوة أخذ العينات.
   *
   * 1 = فحص كل Pixel.
   * 2 = فحص Pixel من كل 2.
   */
  samplingStride: number;

  /**
   * أكبر عدد Boundary Samples نحلله.
   */
  maximumBoundarySamples: number;

  /**
   * أكبر عدد Interior Samples نحلله.
   */
  maximumInteriorSamples: number;

  /**
   * أقل عدد عينات لقبول تحليل الحدود.
   */
  minimumBoundarySamples: number;

  /**
   * أقل عدد عينات لقبول تحليل الداخل.
   */
  minimumInteriorSamples: number;

  /**
   * أقل Gradient نعتبره حافة حقيقية مفيدة.
   */
  minimumUsefulGradient: number;

  /**
   * Gradient قوي يعتبر تطابقًا ممتازًا.
   */
  strongGradientThreshold: number;

  /**
   * أقل فرق لون مرغوب بين Foreground
   * والخلفية القريبة.
   */
  minimumColorSeparation: number;

  /**
   * فرق اللون الذي يعتبر فصلًا قويًا.
   */
  strongColorSeparation: number;

  /**
   * أعلى انحراف معياري مقبول للإضاءة
   * داخل الجسم قبل العقوبة.
   */
  maximumInteriorLuminanceDeviation: number;

  /**
   * أعلى انحراف معياري مقبول للتشبع
   * داخل الجسم قبل العقوبة.
   */
  maximumInteriorSaturationDeviation: number;

  /**
   * أعلى نسبة Pixels مشتبه أنها Background
   * داخل Foreground قبل اعتبار Candidate ضعيفة.
   */
  maximumBackgroundLeakageRatio: number;

  /**
   * الحد الأدنى لنسبة Foreground التي تسمح
   * بتنفيذ التحليل.
   */
  minimumForegroundRatio: number;

  /**
   * الحد الأقصى لنسبة Foreground.
   */
  maximumForegroundRatio: number;

  /**
   * السماح بتحليل Candidate تلامس حدود الصورة.
   *
   * لا يعني قبولها تلقائيًا؛ فقط يمنع رفضها
   * قبل حساب بقية المقاييس.
   */
  allowImageBorderContact: boolean;

  /**
   * إضافة عقوبة عندما تلامس Candidate
   * نسبة كبيرة من حدود الصورة.
   */
  penalizeImageBorderContact: boolean;

  /**
   * قوة عقوبة ملامسة حدود الصورة.
   */
  imageBorderPenaltyStrength: number;

  /**
   * الحد الأدنى المقبول للـImage Score.
   *
   * المحلل لا يرفض Candidate بنفسه،
   * ولكنه يضعها weak داخل Diagnostics.
   */
  minimumAcceptableImageScore: number;

  /**
   * الأوزان النهائية.
   */
  weights:
    ImageGuidedCandidateWeightsV3;
};

/* =========================================================
 * Primitive statistics
 * ======================================================= */

export type ImageGuidedScalarStatisticsV3 = {
  count: number;

  minimum: number;

  maximum: number;

  mean: number;

  variance: number;

  standardDeviation: number;
};

export type ImageGuidedColorMeanV3 = {
  red: number;

  green: number;

  blue: number;

  luminance: number;

  saturation: number;
};

/* =========================================================
 * Boundary diagnostics
 * ======================================================= */

export type ImageGuidedBoundaryMetricsV3 = {
  /**
   * عدد Boundary Pixels التي تم اكتشافها.
   */
  detectedBoundaryPixels: number;

  /**
   * عدد Boundary Samples التي تم تحليلها فعليًا.
   */
  analyzedBoundarySamples: number;

  /**
   * متوسط Gradient على حدود Candidate.
   */
  meanBoundaryGradient: number;

  /**
   * أعلى Gradient مسجل على الحدود.
   */
  maximumBoundaryGradient: number;

  /**
   * نسبة Boundary Samples ذات Gradient مفيد.
   */
  usefulGradientRatio: number;

  /**
   * نسبة Boundary Samples ذات Gradient قوي.
   */
  strongGradientRatio: number;

  /**
   * Score تطابق الحدود مع الصورة.
   */
  edgeAgreementScore: number;

  /**
   * Score قوة الحدود.
   */
  boundaryStrengthScore: number;

  /**
   * Score جودة انتقال Alpha.
   */
  alphaBoundaryQualityScore: number;

  /**
   * نسبة Boundary Samples غير المدعومة
   * بحافة حقيقية في الصورة.
   */
  unsupportedBoundaryRatio: number;
};

/* =========================================================
 * Foreground/background separation diagnostics
 * ======================================================= */

export type ImageGuidedSeparationMetricsV3 = {
  analyzedPairs: number;

  foregroundMean:
    ImageGuidedColorMeanV3;

  backgroundMean:
    ImageGuidedColorMeanV3;

  meanRgbDistance: number;

  meanLuminanceDistance: number;

  meanSaturationDistance: number;

  weakSeparationRatio: number;

  strongSeparationRatio: number;

  separationScore: number;
};

/* =========================================================
 * Interior diagnostics
 * ======================================================= */

export type ImageGuidedInteriorMetricsV3 = {
  analyzedInteriorSamples: number;

  luminanceStatistics:
    ImageGuidedScalarStatisticsV3;

  saturationStatistics:
    ImageGuidedScalarStatisticsV3;

  gradientStatistics:
    ImageGuidedScalarStatisticsV3;

  colorConsistencyScore: number;

  luminanceConsistencyScore: number;

  saturationConsistencyScore: number;

  interiorStabilityScore: number;

  /**
   * نسبة Pixels التي تبدو أقرب لخلفية الحدود
   * من متوسط Foreground الموثوق.
   */
  suspectedBackgroundPixels: number;

  suspectedBackgroundRatio: number;

  backgroundLeakageResistanceScore: number;
};

/* =========================================================
 * Border contact diagnostics
 * ======================================================= */

export type ImageGuidedBorderContactMetricsV3 = {
  topContactRatio: number;

  rightContactRatio: number;

  bottomContactRatio: number;

  leftContactRatio: number;

  totalContactRatio: number;

  touchedEdgeCount: number;

  penalty: number;
};

/* =========================================================
 * Complete measurements
 * ======================================================= */

export type ImageGuidedCandidateMeasurementsV3 = {
  candidateWidth: number;

  candidateHeight: number;

  pixelCount: number;

  foregroundPixels: number;

  confidentForegroundPixels: number;

  backgroundPixels: number;

  uncertainPixels: number;

  foregroundRatio: number;

  confidentForegroundRatio: number;

  backgroundRatio: number;

  uncertainRatio: number;

  minimumProbability: number;

  maximumProbability: number;

  averageProbability: number;

  resolvedValueMode:
    Exclude<
      ImageGuidedCandidateValueMode,
      'auto'
    >;

  activationApplied:
    Exclude<
      ImageGuidedCandidateActivation,
      'auto'
    >;

  boundary:
    ImageGuidedBoundaryMetricsV3;

  separation:
    ImageGuidedSeparationMetricsV3;

  interior:
    ImageGuidedInteriorMetricsV3;

  borderContact:
    ImageGuidedBorderContactMetricsV3;
};

/* =========================================================
 * Final score breakdown
 * ======================================================= */

export type ImageGuidedCandidateScoreBreakdownV3 = {
  edgeAgreement: number;

  boundaryStrength: number;

  foregroundBackgroundSeparation: number;

  colorConsistency: number;

  luminanceConsistency: number;

  saturationConsistency: number;

  interiorStability: number;

  backgroundLeakageResistance: number;

  alphaBoundaryQuality: number;

  weightedScoreBeforePenalties: number;

  imageBorderPenalty: number;

  insufficientEvidencePenalty: number;

  finalImageScore: number;
};

/* =========================================================
 * Candidate quality classification
 * ======================================================= */

export type ImageGuidedCandidateQualityV3 =
  | 'strong'
  | 'acceptable'
  | 'weak'
  | 'invalid';

/* =========================================================
 * Complete public result
 * ======================================================= */

export type ImageGuidedCandidateAnalysisResultV3 = {
  candidateIndex: number | null;

  measurements:
    ImageGuidedCandidateMeasurementsV3;

  scores:
    ImageGuidedCandidateScoreBreakdownV3;

  quality:
    ImageGuidedCandidateQualityV3;

  reliable: boolean;

  warnings:
    readonly string[];

  rejectionReasons:
    readonly string[];

  durationMs: number;
};

/* =========================================================
 * Public analyzer input
 * ======================================================= */

export type AnalyzeImageGuidedCandidateInputV3 = {
  /**
   * Candidate واحدة بمقاس Analysis Image.
   *
   * يمكن أن تحتوي على Logits أو Probabilities
   * حسب config.valueMode.
   */
  candidate:
    SegmentationFloatMask;

  analysisImage:
    ImageGuidedAnalysisImageV3;

  candidateIndex?: number | null;

  config?:
    PartialImageGuidedCandidateAnalysisConfigV3;

  requestId?: string;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

/* =========================================================
 * Partial configuration
 * ======================================================= */

export type PartialImageGuidedCandidateAnalysisConfigV3 =
  Omit<
    Partial<ImageGuidedCandidateAnalysisConfigV3>,
    'weights'
  > & {
    weights?:
      Partial<ImageGuidedCandidateWeightsV3>;
  };

/* =========================================================
 * Default constants
 * ======================================================= */

const MAXIMUM_SAFE_ANALYSIS_PIXELS =
  32_000_000;

const ROW_CANCELLATION_INTERVAL =
  16;

const LOOP_CANCELLATION_INTERVAL =
  4096;

const FLOAT_EPSILON =
  1e-6;

const DEFAULT_EMPTY_COLOR_MEAN:
  ImageGuidedColorMeanV3 = {
  red: 0,

  green: 0,

  blue: 0,

  luminance: 0,

  saturation: 0,
};

const DEFAULT_EMPTY_SCALAR_STATISTICS:
  ImageGuidedScalarStatisticsV3 = {
  count: 0,

  minimum: 0,

  maximum: 0,

  mean: 0,

  variance: 0,

  standardDeviation: 0,
};

/* =========================================================
 * Default weights
 * ======================================================= */

export const DEFAULT_IMAGE_GUIDED_CANDIDATE_WEIGHTS_V3:
  Readonly<ImageGuidedCandidateWeightsV3> = {
  edgeAgreement:
    0.22,

  boundaryStrength:
    0.12,

  foregroundBackgroundSeparation:
    0.18,

  colorConsistency:
    0.08,

  luminanceConsistency:
    0.06,

  saturationConsistency:
    0.04,

  interiorStability:
    0.10,

  backgroundLeakageResistance:
    0.16,

  alphaBoundaryQuality:
    0.04,
};

/* =========================================================
 * Default configuration
 * ======================================================= */

export const DEFAULT_IMAGE_GUIDED_CANDIDATE_ANALYSIS_CONFIG_V3:
  Readonly<ImageGuidedCandidateAnalysisConfigV3> = {
  valueMode:
    'auto',

  activation:
    'auto',

  foregroundThreshold:
    0.5,

  confidentForegroundThreshold:
    0.72,

  confidentBackgroundThreshold:
    0.28,

  boundaryLowerThreshold:
    0.18,

  boundaryUpperThreshold:
    0.82,

  boundarySearchRadius:
    2,

  colorComparisonRadius:
    3,

  interiorSafeRadius:
    2,

  samplingStride:
    1,

  maximumBoundarySamples:
    18_000,

  maximumInteriorSamples:
    24_000,

  minimumBoundarySamples:
    24,

  minimumInteriorSamples:
    48,

  minimumUsefulGradient:
    0.06,

  strongGradientThreshold:
    0.18,

  minimumColorSeparation:
    0.055,

  strongColorSeparation:
    0.18,

  maximumInteriorLuminanceDeviation:
    0.24,

  maximumInteriorSaturationDeviation:
    0.28,

  maximumBackgroundLeakageRatio:
    0.22,

  minimumForegroundRatio:
    0.008,

  maximumForegroundRatio:
    0.96,

  allowImageBorderContact:
    true,

  penalizeImageBorderContact:
    true,

  imageBorderPenaltyStrength:
    0.20,

  minimumAcceptableImageScore:
    0.52,

  weights:
    DEFAULT_IMAGE_GUIDED_CANDIDATE_WEIGHTS_V3,
};

/* =========================================================
 * Configuration cloning
 * ======================================================= */

export function cloneImageGuidedCandidateAnalysisConfigV3(
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedCandidateAnalysisConfigV3 {
  return {
    ...config,

    weights: {
      ...config.weights,
    },
  };
}

/* =========================================================
 * Configuration merging
 * ======================================================= */

export function resolveImageGuidedCandidateAnalysisConfigV3(
  partial?:
    PartialImageGuidedCandidateAnalysisConfigV3
): ImageGuidedCandidateAnalysisConfigV3 {
  const defaults =
    DEFAULT_IMAGE_GUIDED_CANDIDATE_ANALYSIS_CONFIG_V3;

  const merged:
    ImageGuidedCandidateAnalysisConfigV3 = {
    ...defaults,

    ...partial,

    weights: {
      ...defaults.weights,

      ...partial?.weights,
    },
  };

  return validateImageGuidedCandidateAnalysisConfigV3(
    merged
  );
}

/* =========================================================
 * Configuration validation
 * ======================================================= */

export function validateImageGuidedCandidateAnalysisConfigV3(
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedCandidateAnalysisConfigV3 {
  const valueMode =
    resolveValueMode(
      config.valueMode
    );

  const activation =
    resolveActivationMode(
      config.activation
    );

  const foregroundThreshold =
    clampUnitValue(
      config.foregroundThreshold
    );

  const confidentForegroundThreshold =
    clampSegmentationValue(
      config.confidentForegroundThreshold,
      foregroundThreshold,
      1
    );

  const confidentBackgroundThreshold =
    clampSegmentationValue(
      config.confidentBackgroundThreshold,
      0,
      foregroundThreshold
    );

  const boundaryLowerThreshold =
    clampSegmentationValue(
      config.boundaryLowerThreshold,
      0,
      foregroundThreshold
    );

  const boundaryUpperThreshold =
    clampSegmentationValue(
      config.boundaryUpperThreshold,
      foregroundThreshold,
      1
    );

  const minimumForegroundRatio =
    clampSegmentationValue(
      config.minimumForegroundRatio,
      0,
      0.99
    );

  const maximumForegroundRatio =
    clampSegmentationValue(
      config.maximumForegroundRatio,
      Math.min(
        1,
        minimumForegroundRatio +
          FLOAT_EPSILON
      ),
      1
    );

  const minimumUsefulGradient =
    clampUnitValue(
      config.minimumUsefulGradient
    );

  const strongGradientThreshold =
    clampSegmentationValue(
      config.strongGradientThreshold,
      minimumUsefulGradient,
      1
    );

  const minimumColorSeparation =
    clampUnitValue(
      config.minimumColorSeparation
    );

  const strongColorSeparation =
    clampSegmentationValue(
      config.strongColorSeparation,
      minimumColorSeparation,
      1
    );

  const validatedWeights =
    validateImageGuidedCandidateWeightsV3(
      config.weights
    );

  return {
    valueMode,

    activation,

    foregroundThreshold,

    confidentForegroundThreshold,

    confidentBackgroundThreshold,

    boundaryLowerThreshold,

    boundaryUpperThreshold,

    boundarySearchRadius:
      clampInteger(
        config.boundarySearchRadius,
        1,
        6
      ),

    colorComparisonRadius:
      clampInteger(
        config.colorComparisonRadius,
        1,
        8
      ),

    interiorSafeRadius:
      clampInteger(
        config.interiorSafeRadius,
        1,
        6
      ),

    samplingStride:
      clampInteger(
        config.samplingStride,
        1,
        8
      ),

    maximumBoundarySamples:
      clampInteger(
        config.maximumBoundarySamples,
        64,
        250_000
      ),

    maximumInteriorSamples:
      clampInteger(
        config.maximumInteriorSamples,
        64,
        250_000
      ),

    minimumBoundarySamples:
      clampInteger(
        config.minimumBoundarySamples,
        1,
        10_000
      ),

    minimumInteriorSamples:
      clampInteger(
        config.minimumInteriorSamples,
        1,
        10_000
      ),

    minimumUsefulGradient,

    strongGradientThreshold,

    minimumColorSeparation,

    strongColorSeparation,

    maximumInteriorLuminanceDeviation:
      clampSegmentationValue(
        config.maximumInteriorLuminanceDeviation,
        0.01,
        1
      ),

    maximumInteriorSaturationDeviation:
      clampSegmentationValue(
        config.maximumInteriorSaturationDeviation,
        0.01,
        1
      ),

    maximumBackgroundLeakageRatio:
      clampSegmentationValue(
        config.maximumBackgroundLeakageRatio,
        0.01,
        1
      ),

    minimumForegroundRatio,

    maximumForegroundRatio,

    allowImageBorderContact:
      Boolean(
        config.allowImageBorderContact
      ),

    penalizeImageBorderContact:
      Boolean(
        config.penalizeImageBorderContact
      ),

    imageBorderPenaltyStrength:
      clampUnitValue(
        config.imageBorderPenaltyStrength
      ),

    minimumAcceptableImageScore:
      clampUnitValue(
        config.minimumAcceptableImageScore
      ),

    weights:
      validatedWeights,
  };
}

/* =========================================================
 * Weight validation
 * ======================================================= */

export function validateImageGuidedCandidateWeightsV3(
  weights:
    ImageGuidedCandidateWeightsV3
): ImageGuidedCandidateWeightsV3 {
  const validated:
    ImageGuidedCandidateWeightsV3 = {
    edgeAgreement:
      normalizeNonNegativeWeight(
        weights.edgeAgreement
      ),

    boundaryStrength:
      normalizeNonNegativeWeight(
        weights.boundaryStrength
      ),

    foregroundBackgroundSeparation:
      normalizeNonNegativeWeight(
        weights
          .foregroundBackgroundSeparation
      ),

    colorConsistency:
      normalizeNonNegativeWeight(
        weights.colorConsistency
      ),

    luminanceConsistency:
      normalizeNonNegativeWeight(
        weights.luminanceConsistency
      ),

    saturationConsistency:
      normalizeNonNegativeWeight(
        weights.saturationConsistency
      ),

    interiorStability:
      normalizeNonNegativeWeight(
        weights.interiorStability
      ),

    backgroundLeakageResistance:
      normalizeNonNegativeWeight(
        weights
          .backgroundLeakageResistance
      ),

    alphaBoundaryQuality:
      normalizeNonNegativeWeight(
        weights.alphaBoundaryQuality
      ),
  };

  const totalWeight =
    sumImageGuidedWeightsV3(
      validated
    );

  if (
    totalWeight >
    FLOAT_EPSILON
  ) {
    return validated;
  }

  return {
    ...DEFAULT_IMAGE_GUIDED_CANDIDATE_WEIGHTS_V3,
  };
}

/* =========================================================
 * Empty metric factories
 * ======================================================= */

function createEmptyBoundaryMetricsV3():
  ImageGuidedBoundaryMetricsV3 {
  return {
    detectedBoundaryPixels:
      0,

    analyzedBoundarySamples:
      0,

    meanBoundaryGradient:
      0,

    maximumBoundaryGradient:
      0,

    usefulGradientRatio:
      0,

    strongGradientRatio:
      0,

    edgeAgreementScore:
      0,

    boundaryStrengthScore:
      0,

    alphaBoundaryQualityScore:
      0,

    unsupportedBoundaryRatio:
      1,
  };
}

function createEmptySeparationMetricsV3():
  ImageGuidedSeparationMetricsV3 {
  return {
    analyzedPairs:
      0,

    foregroundMean: {
      ...DEFAULT_EMPTY_COLOR_MEAN,
    },

    backgroundMean: {
      ...DEFAULT_EMPTY_COLOR_MEAN,
    },

    meanRgbDistance:
      0,

    meanLuminanceDistance:
      0,

    meanSaturationDistance:
      0,

    weakSeparationRatio:
      1,

    strongSeparationRatio:
      0,

    separationScore:
      0,
  };
}

function createEmptyInteriorMetricsV3():
  ImageGuidedInteriorMetricsV3 {
  return {
    analyzedInteriorSamples:
      0,

    luminanceStatistics: {
      ...DEFAULT_EMPTY_SCALAR_STATISTICS,
    },

    saturationStatistics: {
      ...DEFAULT_EMPTY_SCALAR_STATISTICS,
    },

    gradientStatistics: {
      ...DEFAULT_EMPTY_SCALAR_STATISTICS,
    },

    colorConsistencyScore:
      0,

    luminanceConsistencyScore:
      0,

    saturationConsistencyScore:
      0,

    interiorStabilityScore:
      0,

    suspectedBackgroundPixels:
      0,

    suspectedBackgroundRatio:
      1,

    backgroundLeakageResistanceScore:
      0,
  };
}

function createEmptyBorderContactMetricsV3():
  ImageGuidedBorderContactMetricsV3 {
  return {
    topContactRatio:
      0,

    rightContactRatio:
      0,

    bottomContactRatio:
      0,

    leftContactRatio:
      0,

    totalContactRatio:
      0,

    touchedEdgeCount:
      0,

    penalty:
      0,
  };
}

/* =========================================================
 * Input validation
 * ======================================================= */

function validateAnalysisImageV3(
  image:
    ImageGuidedAnalysisImageV3,
  requestId?:
    string
): void {
  assertSafeAnalysisSize(
    image.width,
    image.height,
    requestId
  );

  const expectedLength =
    image.width *
    image.height;

  assertFloatChannelLength(
    image.red,
    expectedLength,
    'red',
    requestId
  );

  assertFloatChannelLength(
    image.green,
    expectedLength,
    'green',
    requestId
  );

  assertFloatChannelLength(
    image.blue,
    expectedLength,
    'blue',
    requestId
  );

  assertFloatChannelLength(
    image.luminance,
    expectedLength,
    'luminance',
    requestId
  );

  assertFloatChannelLength(
    image.saturation,
    expectedLength,
    'saturation',
    requestId
  );

  assertFloatChannelLength(
    image.gradient,
    expectedLength,
    'gradient',
    requestId
  );
}

function validateCandidateMaskV3(
  candidate:
    SegmentationFloatMask,
  image:
    ImageGuidedAnalysisImageV3,
  requestId?:
    string
): void {
  assertSafeAnalysisSize(
    candidate.width,
    candidate.height,
    requestId
  );

  if (
    !(
      candidate.data instanceof
      Float32Array
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Image-guided candidate data must be a Float32Array.',
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }

  const expectedLength =
    candidate.width *
    candidate.height;

  if (
    candidate.data.length !==
    expectedLength
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Image-guided candidate data length does not match its dimensions.',
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          width:
            candidate.width,

          height:
            candidate.height,

          expectedLength,

          actualLength:
            candidate.data.length,
        },
      }
    );
  }

  if (
    candidate.width !==
      image.width ||
    candidate.height !==
      image.height
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The candidate mask and analysis image must use identical dimensions.',
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          candidateWidth:
            candidate.width,

          candidateHeight:
            candidate.height,

          imageWidth:
            image.width,

          imageHeight:
            image.height,
        },
      }
    );
  }
}

/* =========================================================
 * Safe size validation
 * ======================================================= */

function assertSafeAnalysisSize(
  width:
    number,
  height:
    number,
  requestId?:
    string
): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Image-guided analysis dimensions must be positive integers.',
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          width:
            Number.isFinite(width)
              ? width
              : null,

          height:
            Number.isFinite(height)
              ? height
              : null,
        },
      }
    );
  }

  const pixelCount =
    width *
    height;

  if (
    !Number.isSafeInteger(
      pixelCount
    ) ||
    pixelCount >
      MAXIMUM_SAFE_ANALYSIS_PIXELS
  ) {
    throw new SegmentationError(
      'OUT_OF_MEMORY',
      'Image-guided candidate analysis exceeds the safe pixel limit.',
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          width,

          height,

          pixelCount:
            Number.isFinite(
              pixelCount
            )
              ? pixelCount
              : null,

          maximumSafePixels:
            MAXIMUM_SAFE_ANALYSIS_PIXELS,
        },
      }
    );
  }
}

/* =========================================================
 * Channel validation
 * ======================================================= */

function assertFloatChannelLength(
  channel:
    Float32Array,
  expectedLength:
    number,
  channelName:
    string,
  requestId?:
    string
): void {
  if (
    !(
      channel instanceof
      Float32Array
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Image-guided ${channelName} channel must be a Float32Array.`,
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }

  if (
    channel.length !==
    expectedLength
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `Image-guided ${channelName} channel length is invalid.`,
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          expectedLength,

          actualLength:
            channel.length,
        },
      }
    );
  }
}

/* =========================================================
 * Cancellation
 * ======================================================= */

function assertImageGuidedAnalysisNotCancelled(
  signal?:
    SegmentationCancellationSignal
): void {
  if (!signal) {
    return;
  }

  signal.throwIfCancelled();
}

function checkLoopCancellationV3(
  index:
    number,
  signal?:
    SegmentationCancellationSignal
): void {
  if (
    index %
      LOOP_CANCELLATION_INTERVAL ===
    0
  ) {
    assertImageGuidedAnalysisNotCancelled(
      signal
    );
  }
}

function checkRowCancellationV3(
  row:
    number,
  signal?:
    SegmentationCancellationSignal
): void {
  if (
    row %
      ROW_CANCELLATION_INTERVAL ===
    0
  ) {
    assertImageGuidedAnalysisNotCancelled(
      signal
    );
  }
}

/* =========================================================
 * Value mode resolution
 * ======================================================= */

function resolveValueMode(
  value:
    ImageGuidedCandidateValueMode
): ImageGuidedCandidateValueMode {
  switch (value) {
    case 'auto':
    case 'logits':
    case 'probabilities':
      return value;

    default:
      return 'auto';
  }
}

function resolveActivationMode(
  value:
    ImageGuidedCandidateActivation
): ImageGuidedCandidateActivation {
  switch (value) {
    case 'auto':
    case 'sigmoid':
    case 'none':
      return value;

    default:
      return 'auto';
  }
}

/* =========================================================
 * Candidate value inspection
 * ======================================================= */

type CandidateValueRangeV3 = {
  minimum: number;

  maximum: number;

  finiteCount: number;

  nonFiniteCount: number;
};

function inspectCandidateValueRangeV3(
  data:
    Float32Array,
  signal?:
    SegmentationCancellationSignal
): CandidateValueRangeV3 {
  let minimum =
    Number.POSITIVE_INFINITY;

  let maximum =
    Number.NEGATIVE_INFINITY;

  let finiteCount =
    0;

  let nonFiniteCount =
    0;

  for (
    let index = 0;
    index <
      data.length;
    index +=
      1
  ) {
    checkLoopCancellationV3(
      index,
      signal
    );

    const value =
      data[
        index
      ];

    if (
      !Number.isFinite(value)
    ) {
      nonFiniteCount +=
        1;

      continue;
    }

    finiteCount +=
      1;

    if (
      value <
      minimum
    ) {
      minimum =
        value;
    }

    if (
      value >
      maximum
    ) {
      maximum =
        value;
    }
  }

  if (
    finiteCount ===
    0
  ) {
    return {
      minimum:
        0,

      maximum:
        0,

      finiteCount:
        0,

      nonFiniteCount,
    };
  }

  return {
    minimum,

    maximum,

    finiteCount,

    nonFiniteCount,
  };
}

function resolveCandidateValueModeV3(
  requestedMode:
    ImageGuidedCandidateValueMode,
  range:
    CandidateValueRangeV3
): Exclude<
  ImageGuidedCandidateValueMode,
  'auto'
> {
  if (
    requestedMode ===
    'logits'
  ) {
    return 'logits';
  }

  if (
    requestedMode ===
    'probabilities'
  ) {
    return 'probabilities';
  }

  const appearsNormalized =
    range.minimum >=
      -FLOAT_EPSILON &&
    range.maximum <=
      1 +
        FLOAT_EPSILON;

  return appearsNormalized
    ? 'probabilities'
    : 'logits';
}

function resolveCandidateActivationV3(
  requestedActivation:
    ImageGuidedCandidateActivation,
  valueMode:
    Exclude<
      ImageGuidedCandidateValueMode,
      'auto'
    >
): Exclude<
  ImageGuidedCandidateActivation,
  'auto'
> {
  if (
    requestedActivation ===
    'sigmoid'
  ) {
    return 'sigmoid';
  }

  if (
    requestedActivation ===
    'none'
  ) {
    return 'none';
  }

  return valueMode ===
    'logits'
    ? 'sigmoid'
    : 'none';
}

/* =========================================================
 * Probability conversion
 * ======================================================= */

function sigmoidStableV3(
  value:
    number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  if (
    value >= 0
  ) {
    const exponential =
      Math.exp(
        -value
      );

    return (
      1 /
      (
        1 +
        exponential
      )
    );
  }

  const exponential =
    Math.exp(value);

  return (
    exponential /
    (
      1 +
      exponential
    )
  );
}

function candidateValueToProbabilityV3(
  value:
    number,
  activation:
    Exclude<
      ImageGuidedCandidateActivation,
      'auto'
    >
): number {
  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  if (
    activation ===
    'sigmoid'
  ) {
    return clampUnitValue(
      sigmoidStableV3(
        value
      )
    );
  }

  return clampUnitValue(
    value
  );
}

/* =========================================================
 * Pixel indexing
 * ======================================================= */

function getPixelIndexV3(
  x:
    number,
  y:
    number,
  width:
    number
): number {
  return (
    y *
      width +
    x
  );
}

function clampPixelX(
  x:
    number,
  width:
    number
): number {
  return clampInteger(
    x,
    0,
    Math.max(
      0,
      width -
        1
    )
  );
}

function clampPixelY(
  y:
    number,
  height:
    number
): number {
  return clampInteger(
    y,
    0,
    Math.max(
      0,
      height -
        1
    )
  );
}

/* =========================================================
 * Image sampling
 * ======================================================= */

type ImageGuidedPixelV3 = {
  red: number;

  green: number;

  blue: number;

  luminance: number;

  saturation: number;

  gradient: number;
};

function readAnalysisPixelV3(
  image:
    ImageGuidedAnalysisImageV3,
  x:
    number,
  y:
    number
): ImageGuidedPixelV3 {
  const safeX =
    clampPixelX(
      x,
      image.width
    );

  const safeY =
    clampPixelY(
      y,
      image.height
    );

  const index =
    getPixelIndexV3(
      safeX,
      safeY,
      image.width
    );

  return {
    red:
      finiteUnitValue(
        image.red[
          index
        ]
      ),

    green:
      finiteUnitValue(
        image.green[
          index
        ]
      ),

    blue:
      finiteUnitValue(
        image.blue[
          index
        ]
      ),

    luminance:
      finiteUnitValue(
        image.luminance[
          index
        ]
      ),

    saturation:
      finiteUnitValue(
        image.saturation[
          index
        ]
      ),

    gradient:
      finiteUnitValue(
        image.gradient[
          index
        ]
      ),
  };
}

/* =========================================================
 * Color distances
 * ======================================================= */

function calculateRgbDistanceV3(
  first:
    ImageGuidedPixelV3 |
    ImageGuidedColorMeanV3,
  second:
    ImageGuidedPixelV3 |
    ImageGuidedColorMeanV3
): number {
  const redDifference =
    first.red -
    second.red;

  const greenDifference =
    first.green -
    second.green;

  const blueDifference =
    first.blue -
    second.blue;

  /**
   * أقصى مسافة RGB داخل نطاق 0..1
   * هي sqrt(3)، لذلك نقسم عليها.
   */
  return clampUnitValue(
    Math.sqrt(
      redDifference *
        redDifference +
      greenDifference *
        greenDifference +
      blueDifference *
        blueDifference
    ) /
      Math.sqrt(3)
  );
}

function calculatePerceptualColorDistanceV3(
  first:
    ImageGuidedPixelV3 |
    ImageGuidedColorMeanV3,
  second:
    ImageGuidedPixelV3 |
    ImageGuidedColorMeanV3
): number {
  const rgbDistance =
    calculateRgbDistanceV3(
      first,
      second
    );

  const luminanceDistance =
    Math.abs(
      first.luminance -
      second.luminance
    );

  const saturationDistance =
    Math.abs(
      first.saturation -
      second.saturation
    );

  return clampUnitValue(
    rgbDistance *
      0.62 +
    luminanceDistance *
      0.26 +
    saturationDistance *
      0.12
  );
}

/* =========================================================
 * Score normalization
 * ======================================================= */

function normalizeIncreasingScoreV3(
  value:
    number,
  weakBoundary:
    number,
  strongBoundary:
    number
): number {
  const safeWeakBoundary =
    Math.min(
      weakBoundary,
      strongBoundary
    );

  const safeStrongBoundary =
    Math.max(
      weakBoundary,
      strongBoundary
    );

  const range =
    safeStrongBoundary -
    safeWeakBoundary;

  if (
    range <=
    FLOAT_EPSILON
  ) {
    return value >=
      safeStrongBoundary
      ? 1
      : 0;
  }

  return clampUnitValue(
    (
      value -
      safeWeakBoundary
    ) /
      range
  );
}

function normalizeDecreasingScoreV3(
  value:
    number,
  idealMaximum:
    number,
  rejectedMaximum:
    number
): number {
  const safeIdealMaximum =
    Math.min(
      idealMaximum,
      rejectedMaximum
    );

  const safeRejectedMaximum =
    Math.max(
      idealMaximum,
      rejectedMaximum
    );

  const range =
    safeRejectedMaximum -
    safeIdealMaximum;

  if (
    range <=
    FLOAT_EPSILON
  ) {
    return value <=
      safeIdealMaximum
      ? 1
      : 0;
  }

  return clampUnitValue(
    1 -
      (
        value -
        safeIdealMaximum
      ) /
        range
  );
}

/* =========================================================
 * Weighted score helpers
 * ======================================================= */

function sumImageGuidedWeightsV3(
  weights:
    ImageGuidedCandidateWeightsV3
): number {
  return (
    weights.edgeAgreement +
    weights.boundaryStrength +
    weights
      .foregroundBackgroundSeparation +
    weights.colorConsistency +
    weights.luminanceConsistency +
    weights.saturationConsistency +
    weights.interiorStability +
    weights
      .backgroundLeakageResistance +
    weights.alphaBoundaryQuality
  );
}

function normalizeNonNegativeWeight(
  value:
    number
): number {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    return 0;
  }

  return value;
}

/* =========================================================
 * Generic numeric helpers
 * ======================================================= */

function finiteUnitValue(
  value:
    number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return clampUnitValue(
    value
  );
}

function finiteNonNegativeValue(
  value:
    number
): number {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 0;
  }

  return value;
}

function clampInteger(
  value:
    number,
  minimum:
    number,
  maximum:
    number
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

  return Math.round(
    clampSegmentationValue(
      value,
      safeMinimum,
      safeMaximum
    )
  );
}

function squareV3(
  value:
    number
): number {
  return (
    value *
    value
  );
}

/* =========================================================
 * Online scalar statistics accumulator
 * ======================================================= */

type MutableScalarAccumulatorV3 = {
  count: number;

  minimum: number;

  maximum: number;

  mean: number;

  sumOfSquaredDifferences: number;
};

function createScalarAccumulatorV3():
  MutableScalarAccumulatorV3 {
  return {
    count:
      0,

    minimum:
      Number.POSITIVE_INFINITY,

    maximum:
      Number.NEGATIVE_INFINITY,

    mean:
      0,

    sumOfSquaredDifferences:
      0,
  };
}

function appendScalarSampleV3(
  accumulator:
    MutableScalarAccumulatorV3,
  value:
    number
): void {
  if (
    !Number.isFinite(value)
  ) {
    return;
  }

  accumulator.count +=
    1;

  if (
    value <
    accumulator.minimum
  ) {
    accumulator.minimum =
      value;
  }

  if (
    value >
    accumulator.maximum
  ) {
    accumulator.maximum =
      value;
  }

  const difference =
    value -
    accumulator.mean;

  accumulator.mean +=
    difference /
    accumulator.count;

  const updatedDifference =
    value -
    accumulator.mean;

  accumulator
    .sumOfSquaredDifferences +=
    difference *
    updatedDifference;
}

function finalizeScalarAccumulatorV3(
  accumulator:
    MutableScalarAccumulatorV3
): ImageGuidedScalarStatisticsV3 {
  if (
    accumulator.count <=
    0
  ) {
    return {
      ...DEFAULT_EMPTY_SCALAR_STATISTICS,
    };
  }

  const variance =
    accumulator.count >
      1
      ? Math.max(
          0,
          accumulator
            .sumOfSquaredDifferences /
            accumulator.count
        )
      : 0;

  return {
    count:
      accumulator.count,

    minimum:
      Number.isFinite(
        accumulator.minimum
      )
        ? accumulator.minimum
        : 0,

    maximum:
      Number.isFinite(
        accumulator.maximum
      )
        ? accumulator.maximum
        : 0,

    mean:
      Number.isFinite(
        accumulator.mean
      )
        ? accumulator.mean
        : 0,

    variance,

    standardDeviation:
      Math.sqrt(
        variance
      ),
  };
}

/* =========================================================
 * Online color accumulator
 * ======================================================= */

type MutableColorAccumulatorV3 = {
  count: number;

  red: number;

  green: number;

  blue: number;

  luminance: number;

  saturation: number;
};

function createColorAccumulatorV3():
  MutableColorAccumulatorV3 {
  return {
    count:
      0,

    red:
      0,

    green:
      0,

    blue:
      0,

    luminance:
      0,

    saturation:
      0,
  };
}

function appendColorSampleV3(
  accumulator:
    MutableColorAccumulatorV3,
  pixel:
    ImageGuidedPixelV3
): void {
  accumulator.count +=
    1;

  accumulator.red +=
    pixel.red;

  accumulator.green +=
    pixel.green;

  accumulator.blue +=
    pixel.blue;

  accumulator.luminance +=
    pixel.luminance;

  accumulator.saturation +=
    pixel.saturation;
}

function finalizeColorAccumulatorV3(
  accumulator:
    MutableColorAccumulatorV3
): ImageGuidedColorMeanV3 {
  if (
    accumulator.count <=
    0
  ) {
    return {
      ...DEFAULT_EMPTY_COLOR_MEAN,
    };
  }

  const inverseCount =
    1 /
    accumulator.count;

  return {
    red:
      clampUnitValue(
        accumulator.red *
          inverseCount
      ),

    green:
      clampUnitValue(
        accumulator.green *
          inverseCount
      ),

    blue:
      clampUnitValue(
        accumulator.blue *
          inverseCount
      ),

    luminance:
      clampUnitValue(
        accumulator.luminance *
          inverseCount
      ),

    saturation:
      clampUnitValue(
        accumulator.saturation *
          inverseCount
      ),
  };
}

/* =========================================================
 * Sampling control
 * ======================================================= */

function calculateAdaptiveSamplingStepV3(
  availableSamples:
    number,
  maximumSamples:
    number,
  baseStride:
    number
): number {
  const safeAvailableSamples =
    Math.max(
      0,
      Math.floor(
        availableSamples
      )
    );

  const safeMaximumSamples =
    Math.max(
      1,
      Math.floor(
        maximumSamples
      )
    );

  const safeBaseStride =
    Math.max(
      1,
      Math.floor(
        baseStride
      )
    );

  if (
    safeAvailableSamples <=
    safeMaximumSamples
  ) {
    return safeBaseStride;
  }

  const additionalStride =
    Math.ceil(
      Math.sqrt(
        safeAvailableSamples /
          safeMaximumSamples
      )
    );

  return Math.max(
    safeBaseStride,
    additionalStride
  );
}

/* =========================================================
 * Internal candidate preparation types
 * ======================================================= */

type PreparedCandidateV3 = {
  width: number;

  height: number;

  probabilities:
    Float32Array;

  minimumProbability: number;

  maximumProbability: number;

  averageProbability: number;

  foregroundPixels: number;

  confidentForegroundPixels: number;

  backgroundPixels: number;

  uncertainPixels: number;

  foregroundRatio: number;

  confidentForegroundRatio: number;

  backgroundRatio: number;

  uncertainRatio: number;

  resolvedValueMode:
    Exclude<
      ImageGuidedCandidateValueMode,
      'auto'
    >;

  activationApplied:
    Exclude<
      ImageGuidedCandidateActivation,
      'auto'
    >;
};

/* =========================================================
 * Candidate preparation
 * ======================================================= */

function prepareCandidateProbabilitiesV3(
  candidate:
    SegmentationFloatMask,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): PreparedCandidateV3 {
  const range =
    inspectCandidateValueRangeV3(
      candidate.data,
      signal
    );

  const resolvedValueMode =
    resolveCandidateValueModeV3(
      config.valueMode,
      range
    );

  const activationApplied =
    resolveCandidateActivationV3(
      config.activation,
      resolvedValueMode
    );

  const probabilities =
    new Float32Array(
      candidate.data.length
    );

  let minimumProbability =
    1;

  let maximumProbability =
    0;

  let probabilitySum =
    0;

  let foregroundPixels =
    0;

  let confidentForegroundPixels =
    0;

  let backgroundPixels =
    0;

  let uncertainPixels =
    0;

  for (
    let index = 0;
    index <
      candidate.data.length;
    index +=
      1
  ) {
    checkLoopCancellationV3(
      index,
      signal
    );

    const probability =
      candidateValueToProbabilityV3(
        candidate.data[
          index
        ],
        activationApplied
      );

    probabilities[
      index
    ] =
      probability;

    probabilitySum +=
      probability;

    if (
      probability <
      minimumProbability
    ) {
      minimumProbability =
        probability;
    }

    if (
      probability >
      maximumProbability
    ) {
      maximumProbability =
        probability;
    }

    if (
      probability >=
      config.foregroundThreshold
    ) {
      foregroundPixels +=
        1;
    }

    if (
      probability >=
      config
        .confidentForegroundThreshold
    ) {
      confidentForegroundPixels +=
        1;
    }

    if (
      probability <=
      config
        .confidentBackgroundThreshold
    ) {
      backgroundPixels +=
        1;
    } else if (
      probability <
      config
        .confidentForegroundThreshold
    ) {
      uncertainPixels +=
        1;
    }
  }

  const pixelCount =
    probabilities.length;

  return {
    width:
      candidate.width,

    height:
      candidate.height,

    probabilities,

    minimumProbability:
      pixelCount > 0
        ? minimumProbability
        : 0,

    maximumProbability:
      pixelCount > 0
        ? maximumProbability
        : 0,

    averageProbability:
      safeSegmentationDivide(
        probabilitySum,
        pixelCount,
        0
      ),

    foregroundPixels,

    confidentForegroundPixels,

    backgroundPixels,

    uncertainPixels,

    foregroundRatio:
      safeSegmentationDivide(
        foregroundPixels,
        pixelCount,
        0
      ),

    confidentForegroundRatio:
      safeSegmentationDivide(
        confidentForegroundPixels,
        pixelCount,
        0
      ),

    backgroundRatio:
      safeSegmentationDivide(
        backgroundPixels,
        pixelCount,
        0
      ),

    uncertainRatio:
      safeSegmentationDivide(
        uncertainPixels,
        pixelCount,
        0
      ),

    resolvedValueMode,

    activationApplied,
  };
}

/* =========================================================
 * Probability neighbourhood helpers
 * ======================================================= */

function readCandidateProbabilityV3(
  candidate:
    PreparedCandidateV3,
  x:
    number,
  y:
    number
): number {
  const safeX =
    clampPixelX(
      x,
      candidate.width
    );

  const safeY =
    clampPixelY(
      y,
      candidate.height
    );

  return candidate
    .probabilities[
      getPixelIndexV3(
        safeX,
        safeY,
        candidate.width
      )
    ];
}

function isForegroundProbabilityV3(
  probability:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): boolean {
  return (
    probability >=
    config.foregroundThreshold
  );
}

function isConfidentForegroundProbabilityV3(
  probability:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): boolean {
  return (
    probability >=
    config
      .confidentForegroundThreshold
  );
}

function isConfidentBackgroundProbabilityV3(
  probability:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): boolean {
  return (
    probability <=
    config
      .confidentBackgroundThreshold
  );
}

/* =========================================================
 * Boundary detection primitive
 * ======================================================= */

function isCandidateBoundaryPixelV3(
  candidate:
    PreparedCandidateV3,
  x:
    number,
  y:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): boolean {
  const centerProbability =
    readCandidateProbabilityV3(
      candidate,
      x,
      y
    );

  const centerForeground =
    isForegroundProbabilityV3(
      centerProbability,
      config
    );

  const leftForeground =
    isForegroundProbabilityV3(
      readCandidateProbabilityV3(
        candidate,
        x -
          1,
        y
      ),
      config
    );

  const rightForeground =
    isForegroundProbabilityV3(
      readCandidateProbabilityV3(
        candidate,
        x +
          1,
        y
      ),
      config
    );

  const topForeground =
    isForegroundProbabilityV3(
      readCandidateProbabilityV3(
        candidate,
        x,
        y -
          1
      ),
      config
    );

  const bottomForeground =
    isForegroundProbabilityV3(
      readCandidateProbabilityV3(
        candidate,
        x,
        y +
          1
      ),
      config
    );

  if (
    centerForeground !==
      leftForeground ||
    centerForeground !==
      rightForeground ||
    centerForeground !==
      topForeground ||
    centerForeground !==
      bottomForeground
  ) {
    return true;
  }

  return (
    centerProbability >=
      config
        .boundaryLowerThreshold &&
    centerProbability <=
      config
        .boundaryUpperThreshold
  );
}

/* =========================================================
 * Interior safety primitive
 * ======================================================= */

function isSafeInteriorPixelV3(
  candidate:
    PreparedCandidateV3,
  x:
    number,
  y:
    number,
  radius:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): boolean {
  const safeRadius =
    Math.max(
      1,
      Math.floor(radius)
    );

  for (
    let offsetY =
      -safeRadius;
    offsetY <=
      safeRadius;
    offsetY +=
      1
  ) {
    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      if (
        Math.abs(offsetX) +
          Math.abs(offsetY) >
        safeRadius
      ) {
        continue;
      }

      const probability =
        readCandidateProbabilityV3(
          candidate,
          x +
            offsetX,
          y +
            offsetY
        );

      if (
        !isConfidentForegroundProbabilityV3(
          probability,
          config
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

/* =========================================================
 * Nearby foreground/background search result
 * ======================================================= */

type NearbyRegionSampleV3 = {
  found:
    boolean;

  x:
    number;

  y:
    number;

  distance:
    number;

  probability:
    number;

  pixel:
    ImageGuidedPixelV3;
};

function createMissingNearbyRegionSampleV3():
  NearbyRegionSampleV3 {
  return {
    found:
      false,

    x:
      0,

    y:
      0,

    distance:
      0,

    probability:
      0,

    pixel: {
      red:
        0,

      green:
        0,

      blue:
        0,

      luminance:
        0,

      saturation:
        0,

      gradient:
        0,
    },
  };
}

/* =========================================================
 * End of Part 1/3
 * ======================================================= */

// scan/core/ai/ImageGuidedCandidateAnalysisV3.ts
// Part 2A/3
//
// Boundary extraction
// Edge agreement
// Foreground/background separation
// Border contact analysis

/* =========================================================
 * Boundary sample internal types
 * ======================================================= */

type BoundarySampleDirectionV3 = {
  normalX: number;

  normalY: number;

  magnitude: number;
};

type ImageGuidedBoundarySampleV3 = {
  x: number;

  y: number;

  index: number;

  probability: number;

  gradient: number;

  transitionQuality: number;

  direction:
    BoundarySampleDirectionV3;

  foregroundSample:
    NearbyRegionSampleV3;

  backgroundSample:
    NearbyRegionSampleV3;
};

type BoundarySampleCollectionV3 = {
  detectedBoundaryPixels: number;

  samples:
    ImageGuidedBoundarySampleV3[];
};

/* =========================================================
 * Candidate normal estimation
 * ======================================================= */

/**
 * يحسب اتجاه تغير الـMask محليًا.
 *
 * الاتجاه الناتج يتحرك تقريبًا:
 *
 * Foreground → Background
 *
 * ويتم استخدامه للبحث عن عينات داخل وخارج الجسم
 * بدل البحث العشوائي حول Boundary Pixel.
 */
function estimateCandidateBoundaryDirectionV3(
  candidate:
    PreparedCandidateV3,
  x:
    number,
  y:
    number
): BoundarySampleDirectionV3 {
  const left =
    readCandidateProbabilityV3(
      candidate,
      x -
        1,
      y
    );

  const right =
    readCandidateProbabilityV3(
      candidate,
      x +
        1,
      y
    );

  const top =
    readCandidateProbabilityV3(
      candidate,
      x,
      y -
        1
    );

  const bottom =
    readCandidateProbabilityV3(
      candidate,
      x,
      y +
        1
    );

  /**
   * Gradient الماسك:
   *
   * القيم الأعلى تتجه إلى داخل الجسم.
   *
   * نحتاج Normal يتجه من الداخل إلى الخارج،
   * لذلك نعكس إشارة Gradient.
   */
  const gradientX =
    (
      right -
      left
    ) *
    0.5;

  const gradientY =
    (
      bottom -
      top
    ) *
    0.5;

  const magnitude =
    Math.sqrt(
      squareV3(
        gradientX
      ) +
      squareV3(
        gradientY
      )
    );

  if (
    magnitude <=
    FLOAT_EPSILON
  ) {
    return estimateCandidateBoundaryDirectionFallbackV3(
      candidate,
      x,
      y
    );
  }

  return {
    normalX:
      -gradientX /
      magnitude,

    normalY:
      -gradientY /
      magnitude,

    magnitude:
      clampUnitValue(
        magnitude
      ),
  };
}

/**
 * Fallback عند عدم وجود اتجاه واضح من Central Difference.
 *
 * نبحث في الاتجاهات الأربعة عن:
 *
 * - أقوى Foreground قريب.
 * - أقوى Background قريب.
 *
 * ثم نبني اتجاهًا من Foreground إلى Background.
 */
function estimateCandidateBoundaryDirectionFallbackV3(
  candidate:
    PreparedCandidateV3,
  x:
    number,
  y:
    number
): BoundarySampleDirectionV3 {
  const centerProbability =
    readCandidateProbabilityV3(
      candidate,
      x,
      y
    );

  const directions = [
    {
      x:
        -1,

      y:
        0,
    },

    {
      x:
        1,

      y:
        0,
    },

    {
      x:
        0,

      y:
        -1,
    },

    {
      x:
        0,

      y:
        1,
    },
  ] as const;

  let strongestDifference =
    0;

  let selectedX =
    0;

  let selectedY =
    0;

  for (
    let index = 0;
    index <
      directions.length;
    index +=
      1
  ) {
    const direction =
      directions[
        index
      ];

    const neighbourProbability =
      readCandidateProbabilityV3(
        candidate,
        x +
          direction.x,
        y +
          direction.y
      );

    const difference =
      centerProbability -
      neighbourProbability;

    if (
      Math.abs(
        difference
      ) >
      Math.abs(
        strongestDifference
      )
    ) {
      strongestDifference =
        difference;

      /**
       * لو المركز أقوى من الجار،
       * الجار غالبًا Background.
       *
       * الاتجاه إذًا من المركز إلى الجار.
       */
      selectedX =
        difference >= 0
          ? direction.x
          : -direction.x;

      selectedY =
        difference >= 0
          ? direction.y
          : -direction.y;
    }
  }

  if (
    selectedX ===
      0 &&
    selectedY ===
      0
  ) {
    return {
      normalX:
        1,

      normalY:
        0,

      magnitude:
        0,
    };
  }

  return {
    normalX:
      selectedX,

    normalY:
      selectedY,

    magnitude:
      clampUnitValue(
        Math.abs(
          strongestDifference
        )
      ),
  };
}

/* =========================================================
 * Boundary transition quality
 * ======================================================= */

/**
 * يقيس مدى جودة انتقال Alpha حول الحد.
 *
 * الانتقال الجيد غالبًا يحتوي على:
 *
 * - Foreground واضح في أحد الجانبين.
 * - Background واضح في الجانب الآخر.
 * - قيمة Boundary وسطية أو انتقال حاد منطقي.
 *
 * لا نكافئ النعومة الزائدة التي تجعل مساحة كبيرة
 * من الصورة داخل المنطقة غير المؤكدة.
 */
function calculateBoundaryTransitionQualityV3(
  centerProbability:
    number,
  foregroundProbability:
    number,
  backgroundProbability:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  const foregroundConfidence =
    normalizeIncreasingScoreV3(
      foregroundProbability,
      config.foregroundThreshold,
      config
        .confidentForegroundThreshold
    );

  const backgroundConfidence =
    normalizeDecreasingScoreV3(
      backgroundProbability,
      config
        .confidentBackgroundThreshold,
      config.foregroundThreshold
    );

  const probabilityContrast =
    clampUnitValue(
      foregroundProbability -
      backgroundProbability
    );

  const centerInsideTransition =
    centerProbability >=
      config
        .boundaryLowerThreshold &&
    centerProbability <=
      config
        .boundaryUpperThreshold;

  const centerTransitionScore =
    centerInsideTransition
      ? 1
      : clampUnitValue(
          1 -
          Math.min(
            Math.abs(
              centerProbability -
              config
                .boundaryLowerThreshold
            ),

            Math.abs(
              centerProbability -
              config
                .boundaryUpperThreshold
            )
          ) *
            2
        );

  return clampUnitValue(
    foregroundConfidence *
      0.30 +
    backgroundConfidence *
      0.30 +
    probabilityContrast *
      0.30 +
    centerTransitionScore *
      0.10
  );
}

/* =========================================================
 * Directional region search
 * ======================================================= */

/**
 * يبحث عن أقرب Foreground موثوق في اتجاه محدد.
 */
function findNearbyForegroundSampleV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  originX:
    number,
  originY:
    number,
  directionX:
    number,
  directionY:
    number,
  maximumDistance:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): NearbyRegionSampleV3 {
  const safeMaximumDistance =
    Math.max(
      1,
      Math.floor(
        maximumDistance
      )
    );

  for (
    let distance = 1;
    distance <=
      safeMaximumDistance;
    distance +=
      1
  ) {
    const sampleX =
      clampPixelX(
        Math.round(
          originX +
          directionX *
            distance
        ),
        candidate.width
      );

    const sampleY =
      clampPixelY(
        Math.round(
          originY +
          directionY *
            distance
        ),
        candidate.height
      );

    const probability =
      readCandidateProbabilityV3(
        candidate,
        sampleX,
        sampleY
      );

    if (
      isConfidentForegroundProbabilityV3(
        probability,
        config
      )
    ) {
      return {
        found:
          true,

        x:
          sampleX,

        y:
          sampleY,

        distance,

        probability,

        pixel:
          readAnalysisPixelV3(
            image,
            sampleX,
            sampleY
          ),
      };
    }
  }

  return createMissingNearbyRegionSampleV3();
}

/**
 * يبحث عن أقرب Background موثوق في اتجاه محدد.
 */
function findNearbyBackgroundSampleV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  originX:
    number,
  originY:
    number,
  directionX:
    number,
  directionY:
    number,
  maximumDistance:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): NearbyRegionSampleV3 {
  const safeMaximumDistance =
    Math.max(
      1,
      Math.floor(
        maximumDistance
      )
    );

  for (
    let distance = 1;
    distance <=
      safeMaximumDistance;
    distance +=
      1
  ) {
    const sampleX =
      clampPixelX(
        Math.round(
          originX +
          directionX *
            distance
        ),
        candidate.width
      );

    const sampleY =
      clampPixelY(
        Math.round(
          originY +
          directionY *
            distance
        ),
        candidate.height
      );

    const probability =
      readCandidateProbabilityV3(
        candidate,
        sampleX,
        sampleY
      );

    if (
      isConfidentBackgroundProbabilityV3(
        probability,
        config
      )
    ) {
      return {
        found:
          true,

        x:
          sampleX,

        y:
          sampleY,

        distance,

        probability,

        pixel:
          readAnalysisPixelV3(
            image,
            sampleX,
            sampleY
          ),
      };
    }
  }

  return createMissingNearbyRegionSampleV3();
}

/* =========================================================
 * Radial region fallback search
 * ======================================================= */

/**
 * Fallback للبحث عن Foreground عندما يفشل الاتجاه الأساسي.
 *
 * يتم فحص حلقة صغيرة حول Boundary Pixel.
 */
function findNearbyForegroundSampleRadialV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  originX:
    number,
  originY:
    number,
  maximumRadius:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): NearbyRegionSampleV3 {
  const safeMaximumRadius =
    Math.max(
      1,
      Math.floor(
        maximumRadius
      )
    );

  let bestProbability =
    Number.NEGATIVE_INFINITY;

  let bestSample =
    createMissingNearbyRegionSampleV3();

  for (
    let radius = 1;
    radius <=
      safeMaximumRadius;
    radius +=
      1
  ) {
    for (
      let offsetY =
        -radius;
      offsetY <=
        radius;
      offsetY +=
        1
    ) {
      for (
        let offsetX =
          -radius;
        offsetX <=
          radius;
        offsetX +=
          1
      ) {
        if (
          Math.max(
            Math.abs(
              offsetX
            ),
            Math.abs(
              offsetY
            )
          ) !==
          radius
        ) {
          continue;
        }

        const sampleX =
          clampPixelX(
            originX +
              offsetX,
            candidate.width
          );

        const sampleY =
          clampPixelY(
            originY +
              offsetY,
            candidate.height
          );

        const probability =
          readCandidateProbabilityV3(
            candidate,
            sampleX,
            sampleY
          );

        if (
          probability <=
          bestProbability
        ) {
          continue;
        }

        bestProbability =
          probability;

        bestSample = {
          found:
            isConfidentForegroundProbabilityV3(
              probability,
              config
            ),

          x:
            sampleX,

          y:
            sampleY,

          distance:
            Math.sqrt(
              squareV3(
                offsetX
              ) +
              squareV3(
                offsetY
              )
            ),

          probability,

          pixel:
            readAnalysisPixelV3(
              image,
              sampleX,
              sampleY
            ),
        };
      }
    }

    if (
      bestSample.found
    ) {
      return bestSample;
    }
  }

  return createMissingNearbyRegionSampleV3();
}

/**
 * Fallback للبحث عن Background عندما يفشل الاتجاه الأساسي.
 */
function findNearbyBackgroundSampleRadialV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  originX:
    number,
  originY:
    number,
  maximumRadius:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): NearbyRegionSampleV3 {
  const safeMaximumRadius =
    Math.max(
      1,
      Math.floor(
        maximumRadius
      )
    );

  let bestProbability =
    Number.POSITIVE_INFINITY;

  let bestSample =
    createMissingNearbyRegionSampleV3();

  for (
    let radius = 1;
    radius <=
      safeMaximumRadius;
    radius +=
      1
  ) {
    for (
      let offsetY =
        -radius;
      offsetY <=
        radius;
      offsetY +=
          1
    ) {
      for (
        let offsetX =
          -radius;
        offsetX <=
          radius;
        offsetX +=
          1
      ) {
        if (
          Math.max(
            Math.abs(
              offsetX
            ),
            Math.abs(
              offsetY
            )
          ) !==
          radius
        ) {
          continue;
        }

        const sampleX =
          clampPixelX(
            originX +
              offsetX,
            candidate.width
          );

        const sampleY =
          clampPixelY(
            originY +
              offsetY,
            candidate.height
          );

        const probability =
          readCandidateProbabilityV3(
            candidate,
            sampleX,
            sampleY
          );

        if (
          probability >=
          bestProbability
        ) {
          continue;
        }

        bestProbability =
          probability;

        bestSample = {
          found:
            isConfidentBackgroundProbabilityV3(
              probability,
              config
            ),

          x:
            sampleX,

          y:
            sampleY,

          distance:
            Math.sqrt(
              squareV3(
                offsetX
              ) +
              squareV3(
                offsetY
              )
            ),

          probability,

          pixel:
            readAnalysisPixelV3(
              image,
              sampleX,
              sampleY
            ),
        };
      }
    }

    if (
      bestSample.found
    ) {
      return bestSample;
    }
  }

  return createMissingNearbyRegionSampleV3();
}

/* =========================================================
 * Complete nearby pair resolution
 * ======================================================= */

function resolveBoundaryRegionSamplesV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  x:
    number,
  y:
    number,
  direction:
    BoundarySampleDirectionV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): {
  foreground:
    NearbyRegionSampleV3;

  background:
    NearbyRegionSampleV3;
} {
  /**
   * Normal يتجه من Foreground إلى Background.
   *
   * لذلك:
   * - الداخل في الاتجاه المعاكس.
   * - الخارج في اتجاه Normal.
   */
  let foreground =
    findNearbyForegroundSampleV3(
      candidate,
      image,
      x,
      y,
      -direction.normalX,
      -direction.normalY,
      config.colorComparisonRadius,
      config
    );

  let background =
    findNearbyBackgroundSampleV3(
      candidate,
      image,
      x,
      y,
      direction.normalX,
      direction.normalY,
      config.colorComparisonRadius,
      config
    );

  /**
   * أحيانًا يكون اتجاه Gradient معكوسًا بسبب Mask
   * غير مستقر أو Boundary Transition غريب.
   *
   * نجرب الاتجاه المقابل قبل الـRadial fallback.
   */
  if (
    !foreground.found
  ) {
    foreground =
      findNearbyForegroundSampleV3(
        candidate,
        image,
        x,
        y,
        direction.normalX,
        direction.normalY,
        config.colorComparisonRadius,
        config
      );
  }

  if (
    !background.found
  ) {
    background =
      findNearbyBackgroundSampleV3(
        candidate,
        image,
        x,
        y,
        -direction.normalX,
        -direction.normalY,
        config.colorComparisonRadius,
        config
      );
  }

  if (
    !foreground.found
  ) {
    foreground =
      findNearbyForegroundSampleRadialV3(
        candidate,
        image,
        x,
        y,
        config.colorComparisonRadius,
        config
      );
  }

  if (
    !background.found
  ) {
    background =
      findNearbyBackgroundSampleRadialV3(
        candidate,
        image,
        x,
        y,
        config.colorComparisonRadius,
        config
      );
  }

  return {
    foreground,

    background,
  };
}

/* =========================================================
 * Boundary sample creation
 * ======================================================= */

function createBoundarySampleV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  x:
    number,
  y:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedBoundarySampleV3 {
  const index =
    getPixelIndexV3(
      x,
      y,
      candidate.width
    );

  const probability =
    candidate
      .probabilities[
        index
      ];

  const direction =
    estimateCandidateBoundaryDirectionV3(
      candidate,
      x,
      y
    );

  const regionSamples =
    resolveBoundaryRegionSamplesV3(
      candidate,
      image,
      x,
      y,
      direction,
      config
    );

  const transitionQuality =
    calculateBoundaryTransitionQualityV3(
      probability,
      regionSamples
        .foreground
        .probability,
      regionSamples
        .background
        .probability,
      config
    );

  return {
    x,

    y,

    index,

    probability,

    gradient:
      finiteUnitValue(
        image.gradient[
          index
        ]
      ),

    transitionQuality,

    direction,

    foregroundSample:
      regionSamples
        .foreground,

    backgroundSample:
      regionSamples
        .background,
  };
}

/* =========================================================
 * Boundary counting
 * ======================================================= */

function countCandidateBoundaryPixelsV3(
  candidate:
    PreparedCandidateV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): number {
  let boundaryPixelCount =
    0;

  const stride =
    config.samplingStride;

  for (
    let y = 0;
    y <
      candidate.height;
    y +=
      stride
  ) {
    checkRowCancellationV3(
      y,
      signal
    );

    for (
      let x = 0;
      x <
        candidate.width;
      x +=
        stride
    ) {
      if (
        isCandidateBoundaryPixelV3(
          candidate,
          x,
          y,
          config
        )
      ) {
        boundaryPixelCount +=
          1;
      }
    }
  }

  return boundaryPixelCount;
}

/* =========================================================
 * Boundary sample collection
 * ======================================================= */

function collectBoundarySamplesV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): BoundarySampleCollectionV3 {
  const detectedBoundaryPixels =
    countCandidateBoundaryPixelsV3(
      candidate,
      config,
      signal
    );

  if (
    detectedBoundaryPixels <=
    0
  ) {
    return {
      detectedBoundaryPixels:
        0,

      samples:
        [],
    };
  }

  const adaptiveStride =
    calculateAdaptiveSamplingStepV3(
      detectedBoundaryPixels,
      config
        .maximumBoundarySamples,
      config.samplingStride
    );

  const samples:
    ImageGuidedBoundarySampleV3[] = [];

  for (
    let y = 0;
    y <
      candidate.height;
    y +=
      adaptiveStride
  ) {
    checkRowCancellationV3(
      y,
      signal
    );

    for (
      let x = 0;
      x <
        candidate.width;
      x +=
        adaptiveStride
    ) {
      if (
        !isCandidateBoundaryPixelV3(
          candidate,
          x,
          y,
          config
        )
      ) {
        continue;
      }

      samples.push(
        createBoundarySampleV3(
          candidate,
          image,
          x,
          y,
          config
        )
      );

      if (
        samples.length >=
        config
          .maximumBoundarySamples
      ) {
        return {
          detectedBoundaryPixels,

          samples,
        };
      }
    }
  }

  /**
   * في Masks الرفيعة جدًا قد يؤدي Adaptive Stride
   * إلى عدد قليل من العينات.
   *
   * لو العدد أقل من المطلوب، نجمع مرة ثانية
   * باستخدام Sampling Stride الأصلي.
   */
  if (
    samples.length <
      config
        .minimumBoundarySamples &&
    adaptiveStride >
      config.samplingStride
  ) {
    const usedIndices =
      new Set<number>();

    for (
      let index = 0;
      index <
        samples.length;
      index +=
        1
    ) {
      usedIndices.add(
        samples[
          index
        ].index
      );
    }

    for (
      let y = 0;
      y <
        candidate.height;
      y +=
        config.samplingStride
    ) {
      checkRowCancellationV3(
        y,
        signal
      );

      for (
        let x = 0;
        x <
          candidate.width;
        x +=
          config.samplingStride
      ) {
        const index =
          getPixelIndexV3(
            x,
            y,
            candidate.width
          );

        if (
          usedIndices.has(
            index
          )
        ) {
          continue;
        }

        if (
          !isCandidateBoundaryPixelV3(
            candidate,
            x,
            y,
            config
          )
        ) {
          continue;
        }

        samples.push(
          createBoundarySampleV3(
            candidate,
            image,
            x,
            y,
            config
          )
        );

        usedIndices.add(
          index
        );

        if (
          samples.length >=
          config
            .maximumBoundarySamples
        ) {
          return {
            detectedBoundaryPixels,

            samples,
          };
        }
      }
    }
  }

  return {
    detectedBoundaryPixels,

    samples,
  };
}

/* =========================================================
 * Boundary metrics analysis
 * ======================================================= */

function analyzeBoundaryMetricsV3(
  collection:
    BoundarySampleCollectionV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedBoundaryMetricsV3 {
  if (
    collection.samples.length <=
    0
  ) {
    return {
      ...createEmptyBoundaryMetricsV3(),

      detectedBoundaryPixels:
        collection
          .detectedBoundaryPixels,
    };
  }

  const gradientAccumulator =
    createScalarAccumulatorV3();

  const transitionAccumulator =
    createScalarAccumulatorV3();

  let usefulGradientSamples =
    0;

  let strongGradientSamples =
    0;

  let unsupportedBoundarySamples =
    0;

  for (
    let index = 0;
    index <
      collection.samples.length;
    index +=
      1
  ) {
    const sample =
      collection.samples[
        index
      ];

    appendScalarSampleV3(
      gradientAccumulator,
      sample.gradient
    );

    appendScalarSampleV3(
      transitionAccumulator,
      sample.transitionQuality
    );

    if (
      sample.gradient >=
      config.minimumUsefulGradient
    ) {
      usefulGradientSamples +=
        1;
    } else {
      unsupportedBoundarySamples +=
        1;
    }

    if (
      sample.gradient >=
      config.strongGradientThreshold
    ) {
      strongGradientSamples +=
        1;
    }
  }

  const gradientStatistics =
    finalizeScalarAccumulatorV3(
      gradientAccumulator
    );

  const transitionStatistics =
    finalizeScalarAccumulatorV3(
      transitionAccumulator
    );

  const analyzedBoundarySamples =
    collection.samples.length;

  const usefulGradientRatio =
    safeSegmentationDivide(
      usefulGradientSamples,
      analyzedBoundarySamples,
      0
    );

  const strongGradientRatio =
    safeSegmentationDivide(
      strongGradientSamples,
      analyzedBoundarySamples,
      0
    );

  const unsupportedBoundaryRatio =
    safeSegmentationDivide(
      unsupportedBoundarySamples,
      analyzedBoundarySamples,
      1
    );

  const normalizedMeanGradient =
    normalizeIncreasingScoreV3(
      gradientStatistics.mean,
      config.minimumUsefulGradient *
        0.5,
      config.strongGradientThreshold
    );

  /**
   * Edge Agreement يهتم بنسبة الحدود المدعومة
   * وليس فقط بمتوسط Gradient.
   */
  const edgeAgreementScore =
    clampUnitValue(
      usefulGradientRatio *
        0.48 +
      strongGradientRatio *
        0.22 +
      normalizedMeanGradient *
        0.20 +
      (
        1 -
        unsupportedBoundaryRatio
      ) *
        0.10
    );

  /**
   * Boundary Strength يعتمد أكثر على قوة Gradient نفسها.
   */
  const boundaryStrengthScore =
    clampUnitValue(
      normalizedMeanGradient *
        0.58 +
      strongGradientRatio *
        0.28 +
      usefulGradientRatio *
        0.14
    );

  const alphaBoundaryQualityScore =
    clampUnitValue(
      transitionStatistics.mean
    );

  return {
    detectedBoundaryPixels:
      collection
        .detectedBoundaryPixels,

    analyzedBoundarySamples,

    meanBoundaryGradient:
      clampUnitValue(
        gradientStatistics.mean
      ),

    maximumBoundaryGradient:
      clampUnitValue(
        gradientStatistics.maximum
      ),

    usefulGradientRatio:
      clampUnitValue(
        usefulGradientRatio
      ),

    strongGradientRatio:
      clampUnitValue(
        strongGradientRatio
      ),

    edgeAgreementScore,

    boundaryStrengthScore,

    alphaBoundaryQualityScore,

    unsupportedBoundaryRatio:
      clampUnitValue(
        unsupportedBoundaryRatio
      ),
  };
}

/* =========================================================
 * Separation pair analysis
 * ======================================================= */

type SeparationPairAccumulatorV3 = {
  pairCount: number;

  foregroundColors:
    MutableColorAccumulatorV3;

  backgroundColors:
    MutableColorAccumulatorV3;

  rgbDistance:
    MutableScalarAccumulatorV3;

  luminanceDistance:
    MutableScalarAccumulatorV3;

  saturationDistance:
    MutableScalarAccumulatorV3;

  perceptualDistance:
    MutableScalarAccumulatorV3;

  weakPairs: number;

  strongPairs: number;
};

function createSeparationPairAccumulatorV3():
  SeparationPairAccumulatorV3 {
  return {
    pairCount:
      0,

    foregroundColors:
      createColorAccumulatorV3(),

    backgroundColors:
      createColorAccumulatorV3(),

    rgbDistance:
      createScalarAccumulatorV3(),

    luminanceDistance:
      createScalarAccumulatorV3(),

    saturationDistance:
      createScalarAccumulatorV3(),

    perceptualDistance:
      createScalarAccumulatorV3(),

    weakPairs:
      0,

    strongPairs:
      0,
  };
}

function appendSeparationPairV3(
  accumulator:
    SeparationPairAccumulatorV3,
  foreground:
    ImageGuidedPixelV3,
  background:
    ImageGuidedPixelV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): void {
  const rgbDistance =
    calculateRgbDistanceV3(
      foreground,
      background
    );

  const luminanceDistance =
    Math.abs(
      foreground.luminance -
      background.luminance
    );

  const saturationDistance =
    Math.abs(
      foreground.saturation -
      background.saturation
    );

  const perceptualDistance =
    calculatePerceptualColorDistanceV3(
      foreground,
      background
    );

  accumulator.pairCount +=
    1;

  appendColorSampleV3(
    accumulator
      .foregroundColors,
    foreground
  );

  appendColorSampleV3(
    accumulator
      .backgroundColors,
    background
  );

  appendScalarSampleV3(
    accumulator.rgbDistance,
    rgbDistance
  );

  appendScalarSampleV3(
    accumulator
      .luminanceDistance,
    luminanceDistance
  );

  appendScalarSampleV3(
    accumulator
      .saturationDistance,
    saturationDistance
  );

  appendScalarSampleV3(
    accumulator
      .perceptualDistance,
    perceptualDistance
  );

  if (
    perceptualDistance <
    config.minimumColorSeparation
  ) {
    accumulator.weakPairs +=
      1;
  }

  if (
    perceptualDistance >=
    config.strongColorSeparation
  ) {
    accumulator.strongPairs +=
      1;
  }
}

/* =========================================================
 * Foreground/background separation analysis
 * ======================================================= */

function analyzeForegroundBackgroundSeparationV3(
  collection:
    BoundarySampleCollectionV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedSeparationMetricsV3 {
  if (
    collection.samples.length <=
    0
  ) {
    return createEmptySeparationMetricsV3();
  }

  const accumulator =
    createSeparationPairAccumulatorV3();

  for (
    let index = 0;
    index <
      collection.samples.length;
    index +=
      1
  ) {
    const sample =
      collection.samples[
        index
      ];

    if (
      !sample
        .foregroundSample
        .found ||
      !sample
        .backgroundSample
        .found
    ) {
      continue;
    }

    appendSeparationPairV3(
      accumulator,
      sample
        .foregroundSample
        .pixel,
      sample
        .backgroundSample
        .pixel,
      config
    );
  }

  if (
    accumulator.pairCount <=
    0
  ) {
    return createEmptySeparationMetricsV3();
  }

  const foregroundMean =
    finalizeColorAccumulatorV3(
      accumulator
        .foregroundColors
    );

  const backgroundMean =
    finalizeColorAccumulatorV3(
      accumulator
        .backgroundColors
    );

  const rgbStatistics =
    finalizeScalarAccumulatorV3(
      accumulator.rgbDistance
    );

  const luminanceStatistics =
    finalizeScalarAccumulatorV3(
      accumulator
        .luminanceDistance
    );

  const saturationStatistics =
    finalizeScalarAccumulatorV3(
      accumulator
        .saturationDistance
    );

  const perceptualStatistics =
    finalizeScalarAccumulatorV3(
      accumulator
        .perceptualDistance
    );

  const weakSeparationRatio =
    safeSegmentationDivide(
      accumulator.weakPairs,
      accumulator.pairCount,
      1
    );

  const strongSeparationRatio =
    safeSegmentationDivide(
      accumulator.strongPairs,
      accumulator.pairCount,
      0
    );

  const normalizedMeanSeparation =
    normalizeIncreasingScoreV3(
      perceptualStatistics.mean,
      config.minimumColorSeparation,
      config.strongColorSeparation
    );

  /**
   * Candidate الجيدة لا تحتاج أن تكون كل حدودها
   * ذات فصل قوي جدًا؛ الملابس قد تحتوي ألوانًا مشابهة
   * للخلفية في أجزاء صغيرة.
   *
   * لذلك نعطي:
   * - الوزن الأكبر لمتوسط الفصل.
   * - عقوبة واضحة لارتفاع Weak Ratio.
   * - مكافأة محدودة للـStrong Ratio.
   */
  const separationScore =
    clampUnitValue(
      normalizedMeanSeparation *
        0.58 +
      (
        1 -
        weakSeparationRatio
      ) *
        0.30 +
      strongSeparationRatio *
        0.12
    );

  return {
    analyzedPairs:
      accumulator.pairCount,

    foregroundMean,

    backgroundMean,

    meanRgbDistance:
      clampUnitValue(
        rgbStatistics.mean
      ),

    meanLuminanceDistance:
      clampUnitValue(
        luminanceStatistics.mean
      ),

    meanSaturationDistance:
      clampUnitValue(
        saturationStatistics.mean
      ),

    weakSeparationRatio:
      clampUnitValue(
        weakSeparationRatio
      ),

    strongSeparationRatio:
      clampUnitValue(
        strongSeparationRatio
      ),

    separationScore,
  };
}

/* =========================================================
 * Border contact helpers
 * ======================================================= */

function calculateEdgeForegroundContactRatioV3(
  candidate:
    PreparedCandidateV3,
  edge:
    'top' |
    'right' |
    'bottom' |
    'left',
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  let foregroundContacts =
    0;

  let sampleCount =
    0;

  const stride =
    config.samplingStride;

  switch (edge) {
    case 'top': {
      const y =
        0;

      for (
        let x = 0;
        x <
          candidate.width;
        x +=
          stride
      ) {
        sampleCount +=
          1;

        if (
          isForegroundProbabilityV3(
            readCandidateProbabilityV3(
              candidate,
              x,
              y
            ),
            config
          )
        ) {
          foregroundContacts +=
            1;
        }
      }

      break;
    }

    case 'right': {
      const x =
        candidate.width -
        1;

      for (
        let y = 0;
        y <
          candidate.height;
        y +=
          stride
      ) {
        sampleCount +=
          1;

        if (
          isForegroundProbabilityV3(
            readCandidateProbabilityV3(
              candidate,
              x,
              y
            ),
            config
          )
        ) {
          foregroundContacts +=
            1;
        }
      }

      break;
    }

    case 'bottom': {
      const y =
        candidate.height -
        1;

      for (
        let x = 0;
        x <
          candidate.width;
        x +=
          stride
      ) {
        sampleCount +=
          1;

        if (
          isForegroundProbabilityV3(
            readCandidateProbabilityV3(
              candidate,
              x,
              y
            ),
            config
          )
        ) {
          foregroundContacts +=
            1;
        }
      }

      break;
    }

    case 'left': {
      const x =
        0;

      for (
        let y = 0;
        y <
          candidate.height;
        y +=
          stride
      ) {
        sampleCount +=
          1;

        if (
          isForegroundProbabilityV3(
            readCandidateProbabilityV3(
              candidate,
              x,
              y
            ),
            config
          )
        ) {
          foregroundContacts +=
            1;
        }
      }

      break;
    }
  }

  return clampUnitValue(
    safeSegmentationDivide(
      foregroundContacts,
      sampleCount,
      0
    )
  );
}

/* =========================================================
 * Border contact penalty
 * ======================================================= */

function calculateImageBorderPenaltyV3(
  topContactRatio:
    number,
  rightContactRatio:
    number,
  bottomContactRatio:
    number,
  leftContactRatio:
    number,
  touchedEdgeCount:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  if (
    !config
      .penalizeImageBorderContact
  ) {
    return 0;
  }

  const maximumContact =
    Math.max(
      topContactRatio,
      rightContactRatio,
      bottomContactRatio,
      leftContactRatio
    );

  const averageContact =
    (
      topContactRatio +
      rightContactRatio +
      bottomContactRatio +
      leftContactRatio
    ) /
    4;

  /**
   * ملامسة بسيطة لحافة واحدة قد تكون طبيعية بسبب
   * Letterbox أو قص غير كامل.
   *
   * الملامسة القوية أو لمس أكثر من حافتين
   * هو الأكثر خطورة.
   */
  const contactSeverity =
    clampUnitValue(
      maximumContact *
        0.52 +
      averageContact *
        0.28 +
      clampUnitValue(
        (
          touchedEdgeCount -
          1
        ) /
          3
      ) *
        0.20
    );

  return clampUnitValue(
    contactSeverity *
      config
        .imageBorderPenaltyStrength
  );
}

/* =========================================================
 * Border contact analysis
 * ======================================================= */

function analyzeBorderContactV3(
  candidate:
    PreparedCandidateV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedBorderContactMetricsV3 {
  const topContactRatio =
    calculateEdgeForegroundContactRatioV3(
      candidate,
      'top',
      config
    );

  const rightContactRatio =
    calculateEdgeForegroundContactRatioV3(
      candidate,
      'right',
      config
    );

  const bottomContactRatio =
    calculateEdgeForegroundContactRatioV3(
      candidate,
      'bottom',
      config
    );

  const leftContactRatio =
    calculateEdgeForegroundContactRatioV3(
      candidate,
      'left',
      config
    );

  const contactThreshold =
    0.01;

  let touchedEdgeCount =
    0;

  if (
    topContactRatio >
    contactThreshold
  ) {
    touchedEdgeCount +=
      1;
  }

  if (
    rightContactRatio >
    contactThreshold
  ) {
    touchedEdgeCount +=
      1;
  }

  if (
    bottomContactRatio >
    contactThreshold
  ) {
    touchedEdgeCount +=
      1;
  }

  if (
    leftContactRatio >
    contactThreshold
  ) {
    touchedEdgeCount +=
      1;
  }

  const totalContactRatio =
    clampUnitValue(
      (
        topContactRatio +
        rightContactRatio +
        bottomContactRatio +
        leftContactRatio
      ) /
        4
    );

  const penalty =
    calculateImageBorderPenaltyV3(
      topContactRatio,
      rightContactRatio,
      bottomContactRatio,
      leftContactRatio,
      touchedEdgeCount,
      config
    );

  return {
    topContactRatio,

    rightContactRatio,

    bottomContactRatio,

    leftContactRatio,

    totalContactRatio,

    touchedEdgeCount,

    penalty,
  };
}

/* =========================================================
 * Boundary analysis bundle
 * ======================================================= */

type ImageGuidedBoundaryAnalysisBundleV3 = {
  collection:
    BoundarySampleCollectionV3;

  boundary:
    ImageGuidedBoundaryMetricsV3;

  separation:
    ImageGuidedSeparationMetricsV3;

  borderContact:
    ImageGuidedBorderContactMetricsV3;
};

function analyzeCandidateBoundaryBundleV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): ImageGuidedBoundaryAnalysisBundleV3 {
  assertImageGuidedAnalysisNotCancelled(
    signal
  );

  const collection =
    collectBoundarySamplesV3(
      candidate,
      image,
      config,
      signal
    );

  assertImageGuidedAnalysisNotCancelled(
    signal
  );

  const boundary =
    analyzeBoundaryMetricsV3(
      collection,
      config
    );

  const separation =
    analyzeForegroundBackgroundSeparationV3(
      collection,
      config
    );

  const borderContact =
    analyzeBorderContactV3(
      candidate,
      config
    );

  return {
    collection,

    boundary,

    separation,

    borderContact,
  };
}

/* =========================================================
 * End of Part 2A/3
 * ======================================================= */
// scan/core/ai/ImageGuidedCandidateAnalysisV3.ts
// Part 2B/3
//
// Interior analysis
// Colour consistency
// Luminance and saturation stability
// Background leakage detection

/* =========================================================
 * Interior analysis internal types
 * ======================================================= */

type ImageGuidedInteriorSampleV3 = {
  x: number;

  y: number;

  index: number;

  probability: number;

  pixel:
    ImageGuidedPixelV3;
};

type InteriorSampleCollectionV3 = {
  detectedSafeInteriorPixels: number;

  samples:
    ImageGuidedInteriorSampleV3[];
};

type InteriorReferenceModelsV3 = {
  foreground:
    ImageGuidedColorMeanV3;

  background:
    ImageGuidedColorMeanV3;

  hasForegroundReference:
    boolean;

  hasBackgroundReference:
    boolean;
};

type InteriorColorAnalysisV3 = {
  colorConsistencyScore: number;

  meanForegroundDistance: number;

  foregroundDistanceStatistics:
    ImageGuidedScalarStatisticsV3;

  redStatistics:
    ImageGuidedScalarStatisticsV3;

  greenStatistics:
    ImageGuidedScalarStatisticsV3;

  blueStatistics:
    ImageGuidedScalarStatisticsV3;
};

type InteriorLeakageAnalysisV3 = {
  suspectedBackgroundPixels: number;

  suspectedBackgroundRatio: number;

  backgroundLeakageResistanceScore:
    number;
};

/* =========================================================
 * Safe interior counting
 * ======================================================= */

function countSafeInteriorPixelsV3(
  candidate:
    PreparedCandidateV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): number {
  let safeInteriorPixelCount =
    0;

  const stride =
    config.samplingStride;

  for (
    let y = 0;
    y <
      candidate.height;
    y +=
      stride
  ) {
    checkRowCancellationV3(
      y,
      signal
    );

    for (
      let x = 0;
      x <
        candidate.width;
      x +=
        stride
    ) {
      const probability =
        readCandidateProbabilityV3(
          candidate,
          x,
          y
        );

      if (
        !isConfidentForegroundProbabilityV3(
          probability,
          config
        )
      ) {
        continue;
      }

      if (
        !isSafeInteriorPixelV3(
          candidate,
          x,
          y,
          config.interiorSafeRadius,
          config
        )
      ) {
        continue;
      }

      safeInteriorPixelCount +=
        1;
    }
  }

  return safeInteriorPixelCount;
}

/* =========================================================
 * Interior sample collection
 * ======================================================= */

function collectInteriorSamplesV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): InteriorSampleCollectionV3 {
  const detectedSafeInteriorPixels =
    countSafeInteriorPixelsV3(
      candidate,
      config,
      signal
    );

  if (
    detectedSafeInteriorPixels <=
    0
  ) {
    return {
      detectedSafeInteriorPixels:
        0,

      samples:
        [],
    };
  }

  const adaptiveStride =
    calculateAdaptiveSamplingStepV3(
      detectedSafeInteriorPixels,
      config
        .maximumInteriorSamples,
      config.samplingStride
    );

  const samples:
    ImageGuidedInteriorSampleV3[] = [];

  for (
    let y = 0;
    y <
      candidate.height;
    y +=
      adaptiveStride
  ) {
    checkRowCancellationV3(
      y,
      signal
    );

    for (
      let x = 0;
      x <
        candidate.width;
      x +=
        adaptiveStride
    ) {
      const probability =
        readCandidateProbabilityV3(
          candidate,
          x,
          y
        );

      if (
        !isConfidentForegroundProbabilityV3(
          probability,
          config
        )
      ) {
        continue;
      }

      if (
        !isSafeInteriorPixelV3(
          candidate,
          x,
          y,
          config.interiorSafeRadius,
          config
        )
      ) {
        continue;
      }

      const index =
        getPixelIndexV3(
          x,
          y,
          candidate.width
        );

      samples.push({
        x,

        y,

        index,

        probability,

        pixel:
          readAnalysisPixelV3(
            image,
            x,
            y
          ),
      });

      if (
        samples.length >=
        config
          .maximumInteriorSamples
      ) {
        return {
          detectedSafeInteriorPixels,

          samples,
        };
      }
    }
  }

  /**
   * لو Adaptive Stride أنتج عدد عينات أقل من الحد الأدنى،
   * نجمع مرة إضافية باستخدام الـStride الأصلي.
   */
  if (
    samples.length <
      config
        .minimumInteriorSamples &&
    adaptiveStride >
      config.samplingStride
  ) {
    const usedIndices =
      new Set<number>();

    for (
      let index = 0;
      index <
        samples.length;
      index +=
        1
    ) {
      usedIndices.add(
        samples[
          index
        ].index
      );
    }

    for (
      let y = 0;
      y <
        candidate.height;
      y +=
        config.samplingStride
    ) {
      checkRowCancellationV3(
        y,
        signal
      );

      for (
        let x = 0;
        x <
          candidate.width;
        x +=
          config.samplingStride
      ) {
        const index =
          getPixelIndexV3(
            x,
            y,
            candidate.width
          );

        if (
          usedIndices.has(
            index
          )
        ) {
          continue;
        }

        const probability =
          candidate
            .probabilities[
              index
            ];

        if (
          !isConfidentForegroundProbabilityV3(
            probability,
            config
          )
        ) {
          continue;
        }

        if (
          !isSafeInteriorPixelV3(
            candidate,
            x,
            y,
            config.interiorSafeRadius,
            config
          )
        ) {
          continue;
        }

        samples.push({
          x,

          y,

          index,

          probability,

          pixel:
            readAnalysisPixelV3(
              image,
              x,
              y
            ),
        });

        usedIndices.add(
          index
        );

        if (
          samples.length >=
          config
            .maximumInteriorSamples
        ) {
          return {
            detectedSafeInteriorPixels,

            samples,
          };
        }
      }
    }
  }

  return {
    detectedSafeInteriorPixels,

    samples,
  };
}

/* =========================================================
 * Interior foreground reference
 * ======================================================= */

function calculateInteriorForegroundReferenceV3(
  collection:
    InteriorSampleCollectionV3
): ImageGuidedColorMeanV3 {
  if (
    collection.samples.length <=
    0
  ) {
    return {
      ...DEFAULT_EMPTY_COLOR_MEAN,
    };
  }

  const accumulator =
    createColorAccumulatorV3();

  /**
   * نفضّل العينات الأعلى ثقة عند إنشاء
   * Foreground Colour Model.
   *
   * اختيار أعلى Probability يقلل تأثير مناطق
   * الخلفية التي تسربت داخل Candidate.
   */
  const sortedSamples =
    collection.samples
      .slice()
      .sort(
        (
          first,
          second
        ) =>
          second.probability -
          first.probability
      );

  const referenceSampleCount =
    Math.max(
      1,
      Math.min(
        sortedSamples.length,
        Math.max(
          32,
          Math.floor(
            sortedSamples.length *
              0.65
          )
        )
      )
    );

  for (
    let index = 0;
    index <
      referenceSampleCount;
    index +=
      1
  ) {
    appendColorSampleV3(
      accumulator,
      sortedSamples[
        index
      ].pixel
    );
  }

  return finalizeColorAccumulatorV3(
    accumulator
  );
}

/* =========================================================
 * Reference model resolution
 * ======================================================= */

function resolveInteriorReferenceModelsV3(
  collection:
    InteriorSampleCollectionV3,
  separation:
    ImageGuidedSeparationMetricsV3
): InteriorReferenceModelsV3 {
  const interiorForeground =
    calculateInteriorForegroundReferenceV3(
      collection
    );

  const hasInteriorForeground =
    collection.samples.length >
    0;

  const hasBoundaryForeground =
    separation.analyzedPairs >
    0;

  const foreground =
    hasInteriorForeground &&
    hasBoundaryForeground
      ? {
          red:
            clampUnitValue(
              interiorForeground.red *
                0.72 +
              separation
                .foregroundMean
                .red *
                0.28
            ),

          green:
            clampUnitValue(
              interiorForeground.green *
                0.72 +
              separation
                .foregroundMean
                .green *
                0.28
            ),

          blue:
            clampUnitValue(
              interiorForeground.blue *
                0.72 +
              separation
                .foregroundMean
                .blue *
                0.28
            ),

          luminance:
            clampUnitValue(
              interiorForeground
                .luminance *
                0.72 +
              separation
                .foregroundMean
                .luminance *
                0.28
            ),

          saturation:
            clampUnitValue(
              interiorForeground
                .saturation *
                0.72 +
              separation
                .foregroundMean
                .saturation *
                0.28
            ),
        }
      : hasInteriorForeground
        ? interiorForeground
        : separation.foregroundMean;

  return {
    foreground,

    background: {
      ...separation.backgroundMean,
    },

    hasForegroundReference:
      hasInteriorForeground ||
      hasBoundaryForeground,

    hasBackgroundReference:
      separation.analyzedPairs >
      0,
  };
}

/* =========================================================
 * Interior scalar statistics
 * ======================================================= */

function analyzeInteriorScalarStatisticsV3(
  collection:
    InteriorSampleCollectionV3,
  signal?:
    SegmentationCancellationSignal
): {
  luminance:
    ImageGuidedScalarStatisticsV3;

  saturation:
    ImageGuidedScalarStatisticsV3;

  gradient:
    ImageGuidedScalarStatisticsV3;
} {
  if (
    collection.samples.length <=
    0
  ) {
    return {
      luminance: {
        ...DEFAULT_EMPTY_SCALAR_STATISTICS,
      },

      saturation: {
        ...DEFAULT_EMPTY_SCALAR_STATISTICS,
      },

      gradient: {
        ...DEFAULT_EMPTY_SCALAR_STATISTICS,
      },
    };
  }

  const luminanceAccumulator =
    createScalarAccumulatorV3();

  const saturationAccumulator =
    createScalarAccumulatorV3();

  const gradientAccumulator =
    createScalarAccumulatorV3();

  for (
    let index = 0;
    index <
      collection.samples.length;
    index +=
      1
  ) {
    checkLoopCancellationV3(
      index,
      signal
    );

    const pixel =
      collection.samples[
        index
      ].pixel;

    appendScalarSampleV3(
      luminanceAccumulator,
      pixel.luminance
    );

    appendScalarSampleV3(
      saturationAccumulator,
      pixel.saturation
    );

    appendScalarSampleV3(
      gradientAccumulator,
      pixel.gradient
    );
  }

  return {
    luminance:
      finalizeScalarAccumulatorV3(
        luminanceAccumulator
      ),

    saturation:
      finalizeScalarAccumulatorV3(
        saturationAccumulator
      ),

    gradient:
      finalizeScalarAccumulatorV3(
        gradientAccumulator
      ),
  };
}

/* =========================================================
 * Interior colour consistency
 * ======================================================= */

function analyzeInteriorColorConsistencyV3(
  collection:
    InteriorSampleCollectionV3,
  foregroundReference:
    ImageGuidedColorMeanV3,
  signal?:
    SegmentationCancellationSignal
): InteriorColorAnalysisV3 {
  if (
    collection.samples.length <=
    0
  ) {
    return {
      colorConsistencyScore:
        0,

      meanForegroundDistance:
        0,

      foregroundDistanceStatistics: {
        ...DEFAULT_EMPTY_SCALAR_STATISTICS,
      },

      redStatistics: {
        ...DEFAULT_EMPTY_SCALAR_STATISTICS,
      },

      greenStatistics: {
        ...DEFAULT_EMPTY_SCALAR_STATISTICS,
      },

      blueStatistics: {
        ...DEFAULT_EMPTY_SCALAR_STATISTICS,
      },
    };
  }

  const foregroundDistanceAccumulator =
    createScalarAccumulatorV3();

  const redAccumulator =
    createScalarAccumulatorV3();

  const greenAccumulator =
    createScalarAccumulatorV3();

  const blueAccumulator =
    createScalarAccumulatorV3();

  for (
    let index = 0;
    index <
      collection.samples.length;
    index +=
      1
  ) {
    checkLoopCancellationV3(
      index,
      signal
    );

    const pixel =
      collection.samples[
        index
      ].pixel;

    appendScalarSampleV3(
      foregroundDistanceAccumulator,
      calculatePerceptualColorDistanceV3(
        pixel,
        foregroundReference
      )
    );

    appendScalarSampleV3(
      redAccumulator,
      pixel.red
    );

    appendScalarSampleV3(
      greenAccumulator,
      pixel.green
    );

    appendScalarSampleV3(
      blueAccumulator,
      pixel.blue
    );
  }

  const foregroundDistanceStatistics =
    finalizeScalarAccumulatorV3(
      foregroundDistanceAccumulator
    );

  const redStatistics =
    finalizeScalarAccumulatorV3(
      redAccumulator
    );

  const greenStatistics =
    finalizeScalarAccumulatorV3(
      greenAccumulator
    );

  const blueStatistics =
    finalizeScalarAccumulatorV3(
      blueAccumulator
    );

  const meanRgbStandardDeviation =
    (
      redStatistics
        .standardDeviation +
      greenStatistics
        .standardDeviation +
      blueStatistics
        .standardDeviation
    ) /
    3;

  /**
   * الملابس المنقوشة قد تملك أكثر من لون،
   * لذلك لا نعتبر كل تباين داخلي تسربًا.
   *
   * العقوبة تبدأ عندما:
   *
   * - متوسط الاختلاف عن Foreground Model مرتفع.
   * - أو توزيع RGB بالكامل غير مستقر جدًا.
   */
  const foregroundDistanceScore =
    normalizeDecreasingScoreV3(
      foregroundDistanceStatistics
        .mean,
      0.055,
      0.32
    );

  const foregroundDistanceSpreadScore =
    normalizeDecreasingScoreV3(
      foregroundDistanceStatistics
        .standardDeviation,
      0.045,
      0.24
    );

  const rgbVarianceScore =
    normalizeDecreasingScoreV3(
      meanRgbStandardDeviation,
      0.07,
      0.34
    );

  const colorConsistencyScore =
    clampUnitValue(
      foregroundDistanceScore *
        0.48 +
      foregroundDistanceSpreadScore *
        0.20 +
      rgbVarianceScore *
        0.32
    );

  return {
    colorConsistencyScore,

    meanForegroundDistance:
      foregroundDistanceStatistics
        .mean,

    foregroundDistanceStatistics,

    redStatistics,

    greenStatistics,

    blueStatistics,
  };
}

/* =========================================================
 * Interior stability scoring
 * ======================================================= */

function calculateLuminanceConsistencyScoreV3(
  statistics:
    ImageGuidedScalarStatisticsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  if (
    statistics.count <=
    0
  ) {
    return 0;
  }

  const deviationScore =
    normalizeDecreasingScoreV3(
      statistics
        .standardDeviation,
      config
        .maximumInteriorLuminanceDeviation *
        0.22,
      config
        .maximumInteriorLuminanceDeviation
    );

  const rangeScore =
    normalizeDecreasingScoreV3(
      statistics.maximum -
        statistics.minimum,
      0.26,
      0.92
    );

  return clampUnitValue(
    deviationScore *
      0.78 +
    rangeScore *
      0.22
  );
}

function calculateSaturationConsistencyScoreV3(
  statistics:
    ImageGuidedScalarStatisticsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  if (
    statistics.count <=
    0
  ) {
    return 0;
  }

  const deviationScore =
    normalizeDecreasingScoreV3(
      statistics
        .standardDeviation,
      config
        .maximumInteriorSaturationDeviation *
        0.20,
      config
        .maximumInteriorSaturationDeviation
    );

  const rangeScore =
    normalizeDecreasingScoreV3(
      statistics.maximum -
        statistics.minimum,
      0.30,
      0.98
    );

  return clampUnitValue(
    deviationScore *
      0.80 +
    rangeScore *
      0.20
  );
}

function calculateInteriorGradientStabilityScoreV3(
  statistics:
    ImageGuidedScalarStatisticsV3
): number {
  if (
    statistics.count <=
    0
  ) {
    return 0;
  }

  /**
   * التفاصيل الداخلية الطبيعية مسموحة.
   *
   * ارتفاع Gradient عبر المنطقة الداخلية كلها
   * هو الذي قد يعني دخول خلفية مثل:
   *
   * - ملاءة سرير.
   * - نقوش خلفية.
   * - أثاث.
   */
  const meanGradientScore =
    normalizeDecreasingScoreV3(
      statistics.mean,
      0.055,
      0.34
    );

  const gradientDeviationScore =
    normalizeDecreasingScoreV3(
      statistics
        .standardDeviation,
      0.05,
      0.28
    );

  const maximumGradientScore =
    normalizeDecreasingScoreV3(
      statistics.maximum,
      0.42,
      1
    );

  return clampUnitValue(
    meanGradientScore *
      0.55 +
    gradientDeviationScore *
      0.30 +
    maximumGradientScore *
      0.15
  );
}

/* =========================================================
 * Background leakage evidence
 * ======================================================= */

function calculateBackgroundLeakageEvidenceV3(
  pixel:
    ImageGuidedPixelV3,
  foregroundReference:
    ImageGuidedColorMeanV3,
  backgroundReference:
    ImageGuidedColorMeanV3,
  hasBackgroundReference:
    boolean,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  if (
    !hasBackgroundReference
  ) {
    return 0;
  }

  const foregroundDistance =
    calculatePerceptualColorDistanceV3(
      pixel,
      foregroundReference
    );

  const backgroundDistance =
    calculatePerceptualColorDistanceV3(
      pixel,
      backgroundReference
    );

  const colourPreference =
    clampUnitValue(
      0.5 +
      (
        foregroundDistance -
        backgroundDistance
      ) *
        2.5
    );

  const luminanceForegroundDistance =
    Math.abs(
      pixel.luminance -
      foregroundReference.luminance
    );

  const luminanceBackgroundDistance =
    Math.abs(
      pixel.luminance -
      backgroundReference.luminance
    );

  const luminancePreference =
    clampUnitValue(
      0.5 +
      (
        luminanceForegroundDistance -
        luminanceBackgroundDistance
      ) *
        2.2
    );

  const saturationForegroundDistance =
    Math.abs(
      pixel.saturation -
      foregroundReference.saturation
    );

  const saturationBackgroundDistance =
    Math.abs(
      pixel.saturation -
      backgroundReference.saturation
    );

  const saturationPreference =
    clampUnitValue(
      0.5 +
      (
        saturationForegroundDistance -
        saturationBackgroundDistance
      ) *
        1.8
    );

  const backgroundSimilarity =
    normalizeDecreasingScoreV3(
      backgroundDistance,
      config
        .minimumColorSeparation *
        0.35,
      Math.max(
        0.12,
        config
          .strongColorSeparation
      )
    );

  const foregroundMismatch =
    normalizeIncreasingScoreV3(
      foregroundDistance,
      config
        .minimumColorSeparation *
        0.75,
      Math.max(
        0.16,
        config
          .strongColorSeparation *
          1.45
      )
    );

  return clampUnitValue(
    colourPreference *
      0.38 +
    luminancePreference *
      0.17 +
    saturationPreference *
      0.08 +
    backgroundSimilarity *
      0.22 +
    foregroundMismatch *
      0.15
  );
}

function isStrongBackgroundLeakageEvidenceV3(
  evidence:
    number,
  pixel:
    ImageGuidedPixelV3,
  foregroundReference:
    ImageGuidedColorMeanV3,
  backgroundReference:
    ImageGuidedColorMeanV3,
  hasBackgroundReference:
    boolean
): boolean {
  if (
    !hasBackgroundReference
  ) {
    return false;
  }

  const foregroundDistance =
    calculatePerceptualColorDistanceV3(
      pixel,
      foregroundReference
    );

  const backgroundDistance =
    calculatePerceptualColorDistanceV3(
      pixel,
      backgroundReference
    );

  const clearlyCloserToBackground =
    backgroundDistance +
      0.018 <
    foregroundDistance;

  const strongEvidence =
    evidence >=
    0.63;

  const veryStrongEvidence =
    evidence >=
    0.78;

  return (
    (
      strongEvidence &&
      clearlyCloserToBackground
    ) ||
    veryStrongEvidence
  );
}

/* =========================================================
 * Background leakage analysis
 * ======================================================= */

function analyzeInteriorBackgroundLeakageV3(
  collection:
    InteriorSampleCollectionV3,
  referenceModels:
    InteriorReferenceModelsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): InteriorLeakageAnalysisV3 {
  if (
    collection.samples.length <=
      0 ||
    !referenceModels
      .hasForegroundReference
  ) {
    return {
      suspectedBackgroundPixels:
        0,

      suspectedBackgroundRatio:
        0,

      backgroundLeakageResistanceScore:
        referenceModels
          .hasBackgroundReference
          ? 0
          : 0.5,
    };
  }

  if (
    !referenceModels
      .hasBackgroundReference
  ) {
    /**
     * لا نملك Background Reference كافيًا.
     *
     * لا نعطي Score كاملًا ولا نعاقب Candidate
     * بقوة؛ نستخدم قيمة حيادية.
     */
    return {
      suspectedBackgroundPixels:
        0,

      suspectedBackgroundRatio:
        0,

      backgroundLeakageResistanceScore:
        0.5,
    };
  }

  let suspectedBackgroundPixels =
    0;

  const leakageEvidenceAccumulator =
    createScalarAccumulatorV3();

  for (
    let index = 0;
    index <
      collection.samples.length;
    index +=
      1
  ) {
    checkLoopCancellationV3(
      index,
      signal
    );

    const sample =
      collection.samples[
        index
      ];

    const evidence =
      calculateBackgroundLeakageEvidenceV3(
        sample.pixel,
        referenceModels
          .foreground,
        referenceModels
          .background,
        referenceModels
          .hasBackgroundReference,
        config
      );

    appendScalarSampleV3(
      leakageEvidenceAccumulator,
      evidence
    );

    if (
      isStrongBackgroundLeakageEvidenceV3(
        evidence,
        sample.pixel,
        referenceModels
          .foreground,
        referenceModels
          .background,
        referenceModels
          .hasBackgroundReference
      )
    ) {
      suspectedBackgroundPixels +=
        1;
    }
  }

  const suspectedBackgroundRatio =
    safeSegmentationDivide(
      suspectedBackgroundPixels,
      collection.samples.length,
      0
    );

  const leakageEvidenceStatistics =
    finalizeScalarAccumulatorV3(
      leakageEvidenceAccumulator
    );

  const ratioResistanceScore =
    normalizeDecreasingScoreV3(
      suspectedBackgroundRatio,
      config
        .maximumBackgroundLeakageRatio *
        0.15,
      config
        .maximumBackgroundLeakageRatio
    );

  const meanEvidenceResistanceScore =
    normalizeDecreasingScoreV3(
      leakageEvidenceStatistics
        .mean,
      0.28,
      0.72
    );

  const evidenceSpreadResistanceScore =
    normalizeDecreasingScoreV3(
      leakageEvidenceStatistics
        .standardDeviation,
      0.14,
      0.38
    );

  const backgroundLeakageResistanceScore =
    clampUnitValue(
      ratioResistanceScore *
        0.64 +
      meanEvidenceResistanceScore *
        0.28 +
      evidenceSpreadResistanceScore *
        0.08
    );

  return {
    suspectedBackgroundPixels,

    suspectedBackgroundRatio:
      clampUnitValue(
        suspectedBackgroundRatio
      ),

    backgroundLeakageResistanceScore,
  };
}

/* =========================================================
 * Complete interior stability score
 * ======================================================= */

function calculateCompleteInteriorStabilityScoreV3(
  colorConsistencyScore:
    number,
  luminanceConsistencyScore:
    number,
  saturationConsistencyScore:
    number,
  gradientStabilityScore:
    number,
  backgroundLeakageResistanceScore:
    number,
  analyzedSampleCount:
    number,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  const evidenceScore =
    normalizeIncreasingScoreV3(
      analyzedSampleCount,
      Math.max(
        1,
        config
          .minimumInteriorSamples *
          0.30
      ),
      config
        .minimumInteriorSamples
    );

  return clampUnitValue(
    colorConsistencyScore *
      0.28 +
    luminanceConsistencyScore *
      0.18 +
    saturationConsistencyScore *
      0.10 +
    gradientStabilityScore *
      0.18 +
    backgroundLeakageResistanceScore *
      0.21 +
    evidenceScore *
      0.05
  );
}

/* =========================================================
 * Complete interior analysis
 * ======================================================= */

function analyzeCandidateInteriorV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  separation:
    ImageGuidedSeparationMetricsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): ImageGuidedInteriorMetricsV3 {
  assertImageGuidedAnalysisNotCancelled(
    signal
  );

  const collection =
    collectInteriorSamplesV3(
      candidate,
      image,
      config,
      signal
    );

  if (
    collection.samples.length <=
    0
  ) {
    return createEmptyInteriorMetricsV3();
  }

  const referenceModels =
    resolveInteriorReferenceModelsV3(
      collection,
      separation
    );

  const scalarStatistics =
    analyzeInteriorScalarStatisticsV3(
      collection,
      signal
    );

  const colorAnalysis =
    analyzeInteriorColorConsistencyV3(
      collection,
      referenceModels
        .foreground,
      signal
    );

  const luminanceConsistencyScore =
    calculateLuminanceConsistencyScoreV3(
      scalarStatistics
        .luminance,
      config
    );

  const saturationConsistencyScore =
    calculateSaturationConsistencyScoreV3(
      scalarStatistics
        .saturation,
      config
    );

  const gradientStabilityScore =
    calculateInteriorGradientStabilityScoreV3(
      scalarStatistics
        .gradient
    );

  const leakageAnalysis =
    analyzeInteriorBackgroundLeakageV3(
      collection,
      referenceModels,
      config,
      signal
    );

  const interiorStabilityScore =
    calculateCompleteInteriorStabilityScoreV3(
      colorAnalysis
        .colorConsistencyScore,
      luminanceConsistencyScore,
      saturationConsistencyScore,
      gradientStabilityScore,
      leakageAnalysis
        .backgroundLeakageResistanceScore,
      collection.samples.length,
      config
    );

  return {
    analyzedInteriorSamples:
      collection.samples.length,

    luminanceStatistics:
      scalarStatistics
        .luminance,

    saturationStatistics:
      scalarStatistics
        .saturation,

    gradientStatistics:
      scalarStatistics
        .gradient,

    colorConsistencyScore:
      colorAnalysis
        .colorConsistencyScore,

    luminanceConsistencyScore,

    saturationConsistencyScore,

    interiorStabilityScore,

    suspectedBackgroundPixels:
      leakageAnalysis
        .suspectedBackgroundPixels,

    suspectedBackgroundRatio:
      leakageAnalysis
        .suspectedBackgroundRatio,

    backgroundLeakageResistanceScore:
      leakageAnalysis
        .backgroundLeakageResistanceScore,
  };
}

/* =========================================================
 * Complete image-guided analysis bundle
 * ======================================================= */

type ImageGuidedCandidateAnalysisBundleV3 = {
  boundary:
    ImageGuidedBoundaryMetricsV3;

  separation:
    ImageGuidedSeparationMetricsV3;

  interior:
    ImageGuidedInteriorMetricsV3;

  borderContact:
    ImageGuidedBorderContactMetricsV3;
};

function analyzePreparedCandidateImageEvidenceV3(
  candidate:
    PreparedCandidateV3,
  image:
    ImageGuidedAnalysisImageV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3,
  signal?:
    SegmentationCancellationSignal
): ImageGuidedCandidateAnalysisBundleV3 {
  assertImageGuidedAnalysisNotCancelled(
    signal
  );

  const boundaryBundle =
    analyzeCandidateBoundaryBundleV3(
      candidate,
      image,
      config,
      signal
    );

  assertImageGuidedAnalysisNotCancelled(
    signal
  );

  const interior =
    analyzeCandidateInteriorV3(
      candidate,
      image,
      boundaryBundle
        .separation,
      config,
      signal
    );

  assertImageGuidedAnalysisNotCancelled(
    signal
  );

  return {
    boundary:
      boundaryBundle.boundary,

    separation:
      boundaryBundle.separation,

    interior,

    borderContact:
      boundaryBundle
        .borderContact,
  };
}

/* =========================================================
 * End of Part 2B/3
 * ======================================================= */
// scan/core/ai/ImageGuidedCandidateAnalysisV3.ts
// Part 3/3
//
// Score aggregation
// Warnings and rejection diagnostics
// Quality classification
// Public API

/* =========================================================
 * Time helper
 * ======================================================= */

function getImageGuidedAnalysisTimeV3():
  number {
  if (
    typeof performance !==
      'undefined' &&
    typeof performance.now ===
      'function'
  ) {
    return performance.now();
  }

  return Date.now();
}

/* =========================================================
 * Measurement construction
 * ======================================================= */

function createCandidateMeasurementsV3(
  candidate:
    PreparedCandidateV3,
  evidence:
    ImageGuidedCandidateAnalysisBundleV3
): ImageGuidedCandidateMeasurementsV3 {
  const pixelCount =
    candidate.width *
    candidate.height;

  return {
    candidateWidth:
      candidate.width,

    candidateHeight:
      candidate.height,

    pixelCount,

    foregroundPixels:
      candidate.foregroundPixels,

    confidentForegroundPixels:
      candidate
        .confidentForegroundPixels,

    backgroundPixels:
      candidate.backgroundPixels,

    uncertainPixels:
      candidate.uncertainPixels,

    foregroundRatio:
      clampUnitValue(
        candidate.foregroundRatio
      ),

    confidentForegroundRatio:
      clampUnitValue(
        candidate
          .confidentForegroundRatio
      ),

    backgroundRatio:
      clampUnitValue(
        candidate.backgroundRatio
      ),

    uncertainRatio:
      clampUnitValue(
        candidate.uncertainRatio
      ),

    minimumProbability:
      clampUnitValue(
        candidate
          .minimumProbability
      ),

    maximumProbability:
      clampUnitValue(
        candidate
          .maximumProbability
      ),

    averageProbability:
      clampUnitValue(
        candidate
          .averageProbability
      ),

    resolvedValueMode:
      candidate.resolvedValueMode,

    activationApplied:
      candidate.activationApplied,

    boundary:
      evidence.boundary,

    separation:
      evidence.separation,

    interior:
      evidence.interior,

    borderContact:
      evidence.borderContact,
  };
}

/* =========================================================
 * Individual score sanitization
 * ======================================================= */

function sanitizeImageGuidedScoreV3(
  value:
    number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return clampUnitValue(
    value
  );
}

/* =========================================================
 * Weighted score aggregation
 * ======================================================= */

function calculateWeightedImageScoreV3(
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): {
  edgeAgreement:
    number;

  boundaryStrength:
    number;

  foregroundBackgroundSeparation:
    number;

  colorConsistency:
    number;

  luminanceConsistency:
    number;

  saturationConsistency:
    number;

  interiorStability:
    number;

  backgroundLeakageResistance:
    number;

  alphaBoundaryQuality:
    number;

  weightedScore:
    number;
} {
  const edgeAgreement =
    sanitizeImageGuidedScoreV3(
      measurements
        .boundary
        .edgeAgreementScore
    );

  const boundaryStrength =
    sanitizeImageGuidedScoreV3(
      measurements
        .boundary
        .boundaryStrengthScore
    );

  const foregroundBackgroundSeparation =
    sanitizeImageGuidedScoreV3(
      measurements
        .separation
        .separationScore
    );

  const colorConsistency =
    sanitizeImageGuidedScoreV3(
      measurements
        .interior
        .colorConsistencyScore
    );

  const luminanceConsistency =
    sanitizeImageGuidedScoreV3(
      measurements
        .interior
        .luminanceConsistencyScore
    );

  const saturationConsistency =
    sanitizeImageGuidedScoreV3(
      measurements
        .interior
        .saturationConsistencyScore
    );

  const interiorStability =
    sanitizeImageGuidedScoreV3(
      measurements
        .interior
        .interiorStabilityScore
    );

  const backgroundLeakageResistance =
    sanitizeImageGuidedScoreV3(
      measurements
        .interior
        .backgroundLeakageResistanceScore
    );

  const alphaBoundaryQuality =
    sanitizeImageGuidedScoreV3(
      measurements
        .boundary
        .alphaBoundaryQualityScore
    );

  const weights =
    config.weights;

  const totalWeight =
    sumImageGuidedWeightsV3(
      weights
    );

  if (
    totalWeight <=
    FLOAT_EPSILON
  ) {
    return {
      edgeAgreement,

      boundaryStrength,

      foregroundBackgroundSeparation,

      colorConsistency,

      luminanceConsistency,

      saturationConsistency,

      interiorStability,

      backgroundLeakageResistance,

      alphaBoundaryQuality,

      weightedScore:
        0,
    };
  }

  const weightedSum =
    edgeAgreement *
      weights.edgeAgreement +
    boundaryStrength *
      weights.boundaryStrength +
    foregroundBackgroundSeparation *
      weights
        .foregroundBackgroundSeparation +
    colorConsistency *
      weights.colorConsistency +
    luminanceConsistency *
      weights.luminanceConsistency +
    saturationConsistency *
      weights.saturationConsistency +
    interiorStability *
      weights.interiorStability +
    backgroundLeakageResistance *
      weights
        .backgroundLeakageResistance +
    alphaBoundaryQuality *
      weights.alphaBoundaryQuality;

  return {
    edgeAgreement,

    boundaryStrength,

    foregroundBackgroundSeparation,

    colorConsistency,

    luminanceConsistency,

    saturationConsistency,

    interiorStability,

    backgroundLeakageResistance,

    alphaBoundaryQuality,

    weightedScore:
      clampUnitValue(
        safeSegmentationDivide(
          weightedSum,
          totalWeight,
          0
        )
      ),
  };
}

/* =========================================================
 * Insufficient evidence penalty
 * ======================================================= */

function calculateInsufficientEvidencePenaltyV3(
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  const boundarySampleRatio =
    clampUnitValue(
      safeSegmentationDivide(
        measurements
          .boundary
          .analyzedBoundarySamples,
        config
          .minimumBoundarySamples,
        0
      )
    );

  const interiorSampleRatio =
    clampUnitValue(
      safeSegmentationDivide(
        measurements
          .interior
          .analyzedInteriorSamples,
        config
          .minimumInteriorSamples,
        0
      )
    );

  const separationPairRatio =
    clampUnitValue(
      safeSegmentationDivide(
        measurements
          .separation
          .analyzedPairs,
        config
          .minimumBoundarySamples,
        0
      )
    );

  const boundaryDeficit =
    1 -
    boundarySampleRatio;

  const interiorDeficit =
    1 -
    interiorSampleRatio;

  const separationDeficit =
    1 -
    separationPairRatio;

  /**
   * نقص أدلة الحدود أخطر من نقص عينات الداخل؛
   * لأن الدور الأساسي للطبقة هو التحقق من أن
   * Candidate تتبع الحواف الحقيقية.
   */
  const evidenceDeficit =
    clampUnitValue(
      boundaryDeficit *
        0.48 +
      interiorDeficit *
        0.30 +
      separationDeficit *
        0.22
    );

  /**
   * أقصى عقوبة لنقص الأدلة هي 0.22.
   *
   * لا نرفض Candidate الصغيرة تلقائيًا، لكن
   * نقلل ثقة Score عندما لا توجد بيانات كافية.
   */
  return clampUnitValue(
    evidenceDeficit *
      0.22
  );
}

/* =========================================================
 * Border penalty resolution
 * ======================================================= */

function resolveFinalImageBorderPenaltyV3(
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): number {
  if (
    !config
      .penalizeImageBorderContact
  ) {
    return 0;
  }

  if (
    config
      .allowImageBorderContact
  ) {
    return clampUnitValue(
      measurements
        .borderContact
        .penalty
    );
  }

  const touchedEdgeCount =
    measurements
      .borderContact
      .touchedEdgeCount;

  if (
    touchedEdgeCount <=
    0
  ) {
    return 0;
  }

  /**
   * عند منع Border Contact نضيف عقوبة إضافية،
   * مع الحفاظ على العقوبة الأصلية المحسوبة
   * من قوة ونسبة التلامس.
   */
  const forbiddenContactPenalty =
    clampUnitValue(
      safeSegmentationDivide(
        touchedEdgeCount,
        4,
        0
      ) *
        0.32
    );

  return clampUnitValue(
    measurements
      .borderContact
      .penalty +
    forbiddenContactPenalty
  );
}

/* =========================================================
 * Complete score breakdown
 * ======================================================= */

function calculateCandidateScoreBreakdownV3(
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedCandidateScoreBreakdownV3 {
  const weighted =
    calculateWeightedImageScoreV3(
      measurements,
      config
    );

  const weightedScoreBeforePenalties =
    clampUnitValue(
      weighted.weightedScore
    );

  const imageBorderPenalty =
    resolveFinalImageBorderPenaltyV3(
      measurements,
      config
    );

  const insufficientEvidencePenalty =
    calculateInsufficientEvidencePenaltyV3(
      measurements,
      config
    );

  const finalImageScore =
    clampUnitValue(
      weightedScoreBeforePenalties -
      imageBorderPenalty -
      insufficientEvidencePenalty
    );

  return {
    edgeAgreement:
      weighted.edgeAgreement,

    boundaryStrength:
      weighted.boundaryStrength,

    foregroundBackgroundSeparation:
      weighted
        .foregroundBackgroundSeparation,

    colorConsistency:
      weighted.colorConsistency,

    luminanceConsistency:
      weighted
        .luminanceConsistency,

    saturationConsistency:
      weighted
        .saturationConsistency,

    interiorStability:
      weighted.interiorStability,

    backgroundLeakageResistance:
      weighted
        .backgroundLeakageResistance,

    alphaBoundaryQuality:
      weighted
        .alphaBoundaryQuality,

    weightedScoreBeforePenalties,

    imageBorderPenalty,

    insufficientEvidencePenalty,

    finalImageScore,
  };
}

/* =========================================================
 * Warning helpers
 * ======================================================= */

function appendUniqueDiagnosticMessageV3(
  messages:
    string[],
  message:
    string
): void {
  if (
    !messages.includes(
      message
    )
  ) {
    messages.push(
      message
    );
  }
}

/* =========================================================
 * Warning collection
 * ======================================================= */

function collectCandidateWarningsV3(
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  scores:
    ImageGuidedCandidateScoreBreakdownV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): readonly string[] {
  const warnings:
    string[] = [];

  if (
    measurements.foregroundRatio <
    config.minimumForegroundRatio
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate foreground area is smaller than the configured minimum.'
    );
  }

  if (
    measurements.foregroundRatio >
    config.maximumForegroundRatio
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate foreground area is larger than the configured maximum.'
    );
  }

  if (
    measurements
      .boundary
      .analyzedBoundarySamples <
    config.minimumBoundarySamples
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate boundary analysis has insufficient samples.'
    );
  }

  if (
    measurements
      .interior
      .analyzedInteriorSamples <
    config.minimumInteriorSamples
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate interior analysis has insufficient samples.'
    );
  }

  if (
    measurements
      .separation
      .analyzedPairs <
    config.minimumBoundarySamples
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate foreground/background separation has insufficient evidence.'
    );
  }

  if (
    measurements
      .boundary
      .unsupportedBoundaryRatio >
    0.55
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'A large portion of the candidate boundary is not supported by image edges.'
    );
  }

  if (
    measurements
      .boundary
      .edgeAgreementScore <
    0.42
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate boundary has weak agreement with the source image.'
    );
  }

  if (
    measurements
      .separation
      .weakSeparationRatio >
    0.58
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Foreground and nearby background colours are weakly separated.'
    );
  }

  if (
    measurements
      .interior
      .suspectedBackgroundRatio >
    config
      .maximumBackgroundLeakageRatio *
      0.65
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate interior contains possible background leakage.'
    );
  }

  if (
    measurements
      .interior
      .backgroundLeakageResistanceScore <
    0.42
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate has weak resistance to background leakage.'
    );
  }

  if (
    measurements
      .interior
      .interiorStabilityScore <
    0.40
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate interior appearance is unstable.'
    );
  }

  if (
    measurements
      .borderContact
      .touchedEdgeCount >
    0
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate touches one or more analysis image borders.'
    );
  }

  if (
    measurements.uncertainRatio >
    0.48
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate contains a large uncertain alpha region.'
    );
  }

  if (
    scores.finalImageScore <
    config.minimumAcceptableImageScore
  ) {
    appendUniqueDiagnosticMessageV3(
      warnings,
      'Candidate image-guided score is below the acceptable threshold.'
    );
  }

  return warnings;
}

/* =========================================================
 * Rejection reason collection
 * ======================================================= */

function collectCandidateRejectionReasonsV3(
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  scores:
    ImageGuidedCandidateScoreBreakdownV3,
  config:
    ImageGuidedCandidateAnalysisConfigV3
): readonly string[] {
  const rejectionReasons:
    string[] = [];

  if (
    measurements.pixelCount <=
    0
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate has no pixels.'
    );
  }

  if (
    measurements.foregroundPixels <=
    0
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate has no foreground pixels.'
    );
  }

  if (
    measurements.foregroundRatio <
    config.minimumForegroundRatio
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate foreground ratio is below the valid range.'
    );
  }

  if (
    measurements.foregroundRatio >
    config.maximumForegroundRatio
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate foreground ratio exceeds the valid range.'
    );
  }

  if (
    !config.allowImageBorderContact &&
    measurements
      .borderContact
      .touchedEdgeCount >
      0
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate touches the image border while border contact is disabled.'
    );
  }

  /**
   * لا نرفض بسبب Metric واحدة متوسطة.
   *
   * الرفض البصري يتطلب عادة اجتماع أكثر من
   * علامة قوية على أن Candidate ابتلعت الخلفية
   * أو لا تتبع الجسم الحقيقي.
   */
  const severeBoundaryFailure =
    measurements
      .boundary
      .analyzedBoundarySamples >=
      config.minimumBoundarySamples &&
    measurements
      .boundary
      .edgeAgreementScore <
      0.18 &&
    measurements
      .boundary
      .unsupportedBoundaryRatio >
      0.78;

  if (
    severeBoundaryFailure
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate boundary is not supported by the source image.'
    );
  }

  const severeLeakageFailure =
    measurements
      .interior
      .analyzedInteriorSamples >=
      config.minimumInteriorSamples &&
    measurements
      .interior
      .suspectedBackgroundRatio >
      config.maximumBackgroundLeakageRatio &&
    measurements
      .interior
      .backgroundLeakageResistanceScore <
      0.22;

  if (
    severeLeakageFailure
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate contains excessive background leakage.'
    );
  }

  const combinedImageFailure =
    scores.finalImageScore <
      Math.min(
        0.28,
        config
          .minimumAcceptableImageScore *
          0.55
      ) &&
    measurements
      .boundary
      .analyzedBoundarySamples >=
      config.minimumBoundarySamples &&
    measurements
      .interior
      .analyzedInteriorSamples >=
      config.minimumInteriorSamples;

  if (
    combinedImageFailure
  ) {
    appendUniqueDiagnosticMessageV3(
      rejectionReasons,
      'Candidate has critically weak image-guided evidence.'
    );
  }

  return rejectionReasons;
}

/* =========================================================
 * Candidate quality classification
 * ======================================================= */

function classifyCandidateQualityV3(
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  scores:
    ImageGuidedCandidateScoreBreakdownV3,
  rejectionReasons:
    readonly string[],
  config:
    ImageGuidedCandidateAnalysisConfigV3
): ImageGuidedCandidateQualityV3 {
  if (
    rejectionReasons.length >
    0
  ) {
    return 'invalid';
  }

  const sufficientBoundaryEvidence =
    measurements
      .boundary
      .analyzedBoundarySamples >=
    config.minimumBoundarySamples;

  const sufficientInteriorEvidence =
    measurements
      .interior
      .analyzedInteriorSamples >=
    config.minimumInteriorSamples;

  const sufficientSeparationEvidence =
    measurements
      .separation
      .analyzedPairs >=
    Math.max(
      1,
      Math.floor(
        config
          .minimumBoundarySamples *
          0.50
      )
    );

  const strongEvidence =
    sufficientBoundaryEvidence &&
    sufficientInteriorEvidence &&
    sufficientSeparationEvidence;

  const strongScoreThreshold =
    Math.max(
      0.74,
      config
        .minimumAcceptableImageScore +
        0.14
    );

  if (
    scores.finalImageScore >=
      strongScoreThreshold &&
    strongEvidence &&
    measurements
      .boundary
      .edgeAgreementScore >=
      0.58 &&
    measurements
      .interior
      .backgroundLeakageResistanceScore >=
      0.60
  ) {
    return 'strong';
  }

  if (
    scores.finalImageScore >=
    config.minimumAcceptableImageScore
  ) {
    return 'acceptable';
  }

  return 'weak';
}

/* =========================================================
 * Reliability resolution
 * ======================================================= */

function resolveCandidateReliabilityV3(
  quality:
    ImageGuidedCandidateQualityV3,
  measurements:
    ImageGuidedCandidateMeasurementsV3,
  scores:
    ImageGuidedCandidateScoreBreakdownV3,
  rejectionReasons:
    readonly string[],
  config:
    ImageGuidedCandidateAnalysisConfigV3
): boolean {
  if (
    quality ===
      'invalid' ||
    quality ===
      'weak' ||
    rejectionReasons.length >
      0
  ) {
    return false;
  }

  if (
    scores.finalImageScore <
    config.minimumAcceptableImageScore
  ) {
    return false;
  }

  if (
    measurements
      .boundary
      .analyzedBoundarySamples <
    config.minimumBoundarySamples
  ) {
    return false;
  }

  if (
    measurements
      .boundary
      .edgeAgreementScore <
    0.34
  ) {
    return false;
  }

  if (
    measurements
      .interior
      .analyzedInteriorSamples <
    Math.max(
      1,
      Math.floor(
        config
          .minimumInteriorSamples *
          0.50
      )
    )
  ) {
    return false;
  }

  if (
    measurements
      .interior
      .suspectedBackgroundRatio >
    config.maximumBackgroundLeakageRatio
  ) {
    return false;
  }

  if (
    !config.allowImageBorderContact &&
    measurements
      .borderContact
      .touchedEdgeCount >
      0
  ) {
    return false;
  }

  return true;
}

/* =========================================================
 * Invalid result fallback
 * ======================================================= */

function createInvalidCandidateMeasurementsV3(
  candidate:
    SegmentationFloatMask
): ImageGuidedCandidateMeasurementsV3 {
  const safeWidth =
    Number.isInteger(
      candidate.width
    ) &&
    candidate.width >
      0
      ? candidate.width
      : 0;

  const safeHeight =
    Number.isInteger(
      candidate.height
    ) &&
    candidate.height >
      0
      ? candidate.height
      : 0;

  const pixelCount =
    safeWidth *
    safeHeight;

  return {
    candidateWidth:
      safeWidth,

    candidateHeight:
      safeHeight,

    pixelCount:
      Number.isSafeInteger(
        pixelCount
      )
        ? pixelCount
        : 0,

    foregroundPixels:
      0,

    confidentForegroundPixels:
      0,

    backgroundPixels:
      0,

    uncertainPixels:
      0,

    foregroundRatio:
      0,

    confidentForegroundRatio:
      0,

    backgroundRatio:
      0,

    uncertainRatio:
      0,

    minimumProbability:
      0,

    maximumProbability:
      0,

    averageProbability:
      0,

    resolvedValueMode:
      'probabilities',

    activationApplied:
      'none',

    boundary:
      createEmptyBoundaryMetricsV3(),

    separation:
      createEmptySeparationMetricsV3(),

    interior:
      createEmptyInteriorMetricsV3(),

    borderContact:
      createEmptyBorderContactMetricsV3(),
  };
}

function createInvalidCandidateScoresV3():
  ImageGuidedCandidateScoreBreakdownV3 {
  return {
    edgeAgreement:
      0,

    boundaryStrength:
      0,

    foregroundBackgroundSeparation:
      0,

    colorConsistency:
      0,

    luminanceConsistency:
      0,

    saturationConsistency:
      0,

    interiorStability:
      0,

    backgroundLeakageResistance:
      0,

    alphaBoundaryQuality:
      0,

    weightedScoreBeforePenalties:
      0,

    imageBorderPenalty:
      0,

    insufficientEvidencePenalty:
      0,

    finalImageScore:
      0,
  };
}

/* =========================================================
 * Public single-candidate analyzer
 * ======================================================= */

/**
 * يحلل Candidate واحدة بصريًا مقابل صورة التحليل.
 *
 * لا يختار Candidate النهائية ولا يعدّل الماسك.
 *
 * الاستخدام المقترح:
 *
 * const imageAnalysis =
 *   analyzeImageGuidedCandidateV3({
 *     candidate,
 *     analysisImage,
 *     candidateIndex,
 *   });
 *
 * ثم يدمج Caller:
 *
 * - Model Score
 * - Geometry Score
 * - imageAnalysis.scores.finalImageScore
 */
export function analyzeImageGuidedCandidateV3(
  input:
    AnalyzeImageGuidedCandidateInputV3
): ImageGuidedCandidateAnalysisResultV3 {
  const startedAt =
    getImageGuidedAnalysisTimeV3();

  const candidateIndex =
    Number.isInteger(
      input.candidateIndex
    )
      ? input.candidateIndex ??
        null
      : null;

  assertImageGuidedAnalysisNotCancelled(
    input.cancellationSignal
  );

  validateAnalysisImageV3(
    input.analysisImage,
    input.requestId
  );

  validateCandidateMaskV3(
    input.candidate,
    input.analysisImage,
    input.requestId
  );

  const config =
    resolveImageGuidedCandidateAnalysisConfigV3(
      input.config
    );

  assertImageGuidedAnalysisNotCancelled(
    input.cancellationSignal
  );

  const candidate =
    prepareCandidateProbabilitiesV3(
      input.candidate,
      config,
      input.cancellationSignal
    );

  assertImageGuidedAnalysisNotCancelled(
    input.cancellationSignal
  );

  const evidence =
    analyzePreparedCandidateImageEvidenceV3(
      candidate,
      input.analysisImage,
      config,
      input.cancellationSignal
    );

  const measurements =
    createCandidateMeasurementsV3(
      candidate,
      evidence
    );

  const scores =
    calculateCandidateScoreBreakdownV3(
      measurements,
      config
    );

  const warnings =
    collectCandidateWarningsV3(
      measurements,
      scores,
      config
    );

  const rejectionReasons =
    collectCandidateRejectionReasonsV3(
      measurements,
      scores,
      config
    );

  const quality =
    classifyCandidateQualityV3(
      measurements,
      scores,
      rejectionReasons,
      config
    );

  const reliable =
    resolveCandidateReliabilityV3(
      quality,
      measurements,
      scores,
      rejectionReasons,
      config
    );

  assertImageGuidedAnalysisNotCancelled(
    input.cancellationSignal
  );

  const finishedAt =
    getImageGuidedAnalysisTimeV3();

  return {
    candidateIndex,

    measurements,

    scores,

    quality,

    reliable,

    warnings,

    rejectionReasons,

    durationMs:
      Math.max(
        0,
        finishedAt -
          startedAt
      ),
  };
}

/* =========================================================
 * Safe public single-candidate analyzer
 * ======================================================= */

/**
 * نسخة لا ترمي Error لأخطاء التحليل العادية.
 *
 * Cancellation لا يتم ابتلاعها؛ يتم تمريرها
 * حتى يستطيع المحرك إيقاف الطلب فورًا.
 */
export function tryAnalyzeImageGuidedCandidateV3(
  input:
    AnalyzeImageGuidedCandidateInputV3
): ImageGuidedCandidateAnalysisResultV3 {
  const startedAt =
    getImageGuidedAnalysisTimeV3();

  try {
    return analyzeImageGuidedCandidateV3(
      input
    );
  } catch (
    error
  ) {
    /**
     * لا نبتلع Cancellation.
     *
     * SegmentationCancellationSignal هو المرجع
     * القانوني لتحديد الإلغاء.
     */
    input
      .cancellationSignal
      ?.throwIfCancelled();

    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Unknown image-guided candidate analysis error.';

    return {
      candidateIndex:
        Number.isInteger(
          input.candidateIndex
        )
          ? input.candidateIndex ??
            null
          : null,

      measurements:
        createInvalidCandidateMeasurementsV3(
          input.candidate
        ),

      scores:
        createInvalidCandidateScoresV3(),

      quality:
        'invalid',

      reliable:
        false,

      warnings: [
        'Image-guided candidate analysis failed.',
      ],

      rejectionReasons: [
        errorMessage,
      ],

      durationMs:
        Math.max(
          0,
          getImageGuidedAnalysisTimeV3() -
            startedAt
        ),
    };
  }
}

/* =========================================================
 * Batch analyzer input
 * ======================================================= */

export type AnalyzeImageGuidedCandidatesInputV3 = {
  candidates:
    readonly SegmentationFloatMask[];

  analysisImage:
    ImageGuidedAnalysisImageV3;

  config?:
    PartialImageGuidedCandidateAnalysisConfigV3;

  requestId?: string;

  cancellationSignal?:
    SegmentationCancellationSignal;

  /**
   * true:
   * Candidate غير الصالحة تعيد Result من نوع invalid
   * ويستمر تحليل بقية Candidates.
   *
   * false:
   * أول خطأ يوقف التحليل.
   */
  continueOnCandidateError?:
    boolean;
};

/* =========================================================
 * Public batch analyzer
 * ======================================================= */

/**
 * يحلل جميع Candidates بنفس Analysis Image.
 *
 * ترتيب النتائج يطابق ترتيب Candidates.
 */
export function analyzeImageGuidedCandidatesV3(
  input:
    AnalyzeImageGuidedCandidatesInputV3
): readonly ImageGuidedCandidateAnalysisResultV3[] {
  if (
    !Array.isArray(
      input.candidates
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Image-guided candidates must be an array.',
      {
        requestId:
          input.requestId,

        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }

  validateAnalysisImageV3(
    input.analysisImage,
    input.requestId
  );

  const resolvedConfig =
    resolveImageGuidedCandidateAnalysisConfigV3(
      input.config
    );

  const continueOnCandidateError =
    input
      .continueOnCandidateError ??
    true;

  const results:
    ImageGuidedCandidateAnalysisResultV3[] = [];

  for (
    let candidateIndex =
      0;
    candidateIndex <
      input.candidates.length;
    candidateIndex +=
      1
  ) {
    checkLoopCancellationV3(
      candidateIndex,
      input.cancellationSignal
    );

    const candidate =
      input.candidates[
        candidateIndex
      ];

    const candidateInput:
      AnalyzeImageGuidedCandidateInputV3 = {
      candidate,

      analysisImage:
        input.analysisImage,

      candidateIndex,

      config:
        resolvedConfig,

      requestId:
        input.requestId,

      cancellationSignal:
        input.cancellationSignal,
    };

    if (
      continueOnCandidateError
    ) {
      results.push(
        tryAnalyzeImageGuidedCandidateV3(
          candidateInput
        )
      );
    } else {
      results.push(
        analyzeImageGuidedCandidateV3(
          candidateInput
        )
      );
    }
  }

  assertImageGuidedAnalysisNotCancelled(
    input.cancellationSignal
  );

  return results;
}

/* =========================================================
 * Best image-guided result selection
 * ======================================================= */

/**
 * يختار أفضل نتيجة بناءً على Image Score فقط.
 *
 * هذه الدالة مساعدة وليست بديلًا عن Ranking V3 النهائي؛
 * الترتيب النهائي يجب أن يدمج:
 *
 * - Model Score
 * - Geometry Score
 * - Image-Guided Score
 */
export function selectBestImageGuidedCandidateResultV3(
  results:
    readonly ImageGuidedCandidateAnalysisResultV3[]
): ImageGuidedCandidateAnalysisResultV3 |
  null {
  if (
    results.length <=
    0
  ) {
    return null;
  }

  let bestResult:
    ImageGuidedCandidateAnalysisResultV3 |
    null =
      null;

  for (
    let index = 0;
    index <
      results.length;
    index +=
      1
  ) {
    const result =
      results[
        index
      ];

    if (
      result.quality ===
      'invalid'
    ) {
      continue;
    }

    if (
      !bestResult
    ) {
      bestResult =
        result;

      continue;
    }

    const scoreDifference =
      result
        .scores
        .finalImageScore -
      bestResult
        .scores
        .finalImageScore;

    if (
      scoreDifference >
      FLOAT_EPSILON
    ) {
      bestResult =
        result;

      continue;
    }

    if (
      Math.abs(
        scoreDifference
      ) >
      FLOAT_EPSILON
    ) {
      continue;
    }

    /**
     * Tie breakers:
     *
     * 1) Reliable Candidate.
     * 2) أقل تسرب خلفية.
     * 3) Edge Agreement أعلى.
     * 4) Boundary Samples أكثر.
     */
    if (
      result.reliable &&
      !bestResult.reliable
    ) {
      bestResult =
        result;

      continue;
    }

    if (
      result.reliable !==
      bestResult.reliable
    ) {
      continue;
    }

    const leakageDifference =
      result
        .measurements
        .interior
        .suspectedBackgroundRatio -
      bestResult
        .measurements
        .interior
        .suspectedBackgroundRatio;

    if (
      leakageDifference <
      -FLOAT_EPSILON
    ) {
      bestResult =
        result;

      continue;
    }

    if (
      Math.abs(
        leakageDifference
      ) >
      FLOAT_EPSILON
    ) {
      continue;
    }

    const edgeDifference =
      result
        .scores
        .edgeAgreement -
      bestResult
        .scores
        .edgeAgreement;

    if (
      edgeDifference >
      FLOAT_EPSILON
    ) {
      bestResult =
        result;

      continue;
    }

    if (
      Math.abs(
        edgeDifference
      ) >
      FLOAT_EPSILON
    ) {
      continue;
    }

    if (
      result
        .measurements
        .boundary
        .analyzedBoundarySamples >
      bestResult
        .measurements
        .boundary
        .analyzedBoundarySamples
    ) {
      bestResult =
        result;
    }
  }

  /**
   * لو كل النتائج Invalid نعيد أعلى Score منها
   * لتوفير Diagnostics للـCaller.
   */
  if (
    bestResult
  ) {
    return bestResult;
  }

  let fallbackResult =
    results[
      0
    ];

  for (
    let index = 1;
    index <
      results.length;
    index +=
      1
  ) {
    const result =
      results[
        index
      ];

    if (
      result
        .scores
        .finalImageScore >
      fallbackResult
        .scores
        .finalImageScore
    ) {
      fallbackResult =
        result;
    }
  }

  return fallbackResult;
}

/* =========================================================
 * Compact diagnostics summary
 * ======================================================= */

export function getImageGuidedCandidateSummaryV3(
  result:
    ImageGuidedCandidateAnalysisResultV3
): string {
  const candidateLabel =
    result.candidateIndex ===
    null
      ? 'unknown'
      : String(
          result.candidateIndex
        );

  return [
    `candidate=${candidateLabel}`,

    `quality=${result.quality}`,

    `reliable=${String(
      result.reliable
    )}`,

    `imageScore=${result.scores.finalImageScore.toFixed(
      4
    )}`,

    `edge=${result.scores.edgeAgreement.toFixed(
      4
    )}`,

    `separation=${result.scores.foregroundBackgroundSeparation.toFixed(
      4
    )}`,

    `leakageResistance=${result.scores.backgroundLeakageResistance.toFixed(
      4
    )}`,

    `leakageRatio=${result.measurements.interior.suspectedBackgroundRatio.toFixed(
      4
    )}`,

    `foregroundRatio=${result.measurements.foregroundRatio.toFixed(
      4
    )}`,

    `boundarySamples=${String(
      result
        .measurements
        .boundary
        .analyzedBoundarySamples
    )}`,

    `interiorSamples=${String(
      result
        .measurements
        .interior
        .analyzedInteriorSamples
    )}`,

    `durationMs=${result.durationMs.toFixed(
      2
    )}`,
  ].join(
    ' | '
  );
}

/* =========================================================
 * End of ImageGuidedCandidateAnalysisV3.ts
 * ======================================================= */