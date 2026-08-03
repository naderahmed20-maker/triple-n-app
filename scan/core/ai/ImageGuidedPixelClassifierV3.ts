// scan/core/ai/ImageGuidedPixelClassifierV3.ts
// Part 1/2
//
// Triple N - Image-Guided Pixel Classifier V3
//
// هذا الملف مسؤول عن تصنيف كل Pixel قريب من حدود
// ماسك EdgeSAM إلى:
//
// - Foreground
// - Background
// - Uncertain
//
// يعتمد القرار على:
//
// 1) Alpha الأصلي.
// 2) تشابه اللون مع القطعة.
// 3) تشابه اللون مع الخلفية.
// 4) نموذج Foreground المحلي.
// 5) قوة واستمرارية الحافة.
// 6) اتفاق الجيران.
// 7) دعم الجسم الأساسي.
// 8) المسافة من الجسم الأساسي.
// 9) الملمس والتباين المحلي.
// 10) حماية الجزء الداخلي القوي من القطعة.
//
// هذا الملف لا ينفذ تصويت الجيران النهائي.
// ConfidenceVotingV3.ts سيعالج القرارات غير المؤكدة لاحقًا.

import type {
    ImageGuidedAnalysisImageV3,
    ImageGuidedBoundaryFeatureMapV3,
    ImageGuidedBoundaryPixelFeaturesV3,
    ImageGuidedHsvColorV3,
    ImageGuidedLabColorV3,
    ImageGuidedLocalForegroundModelV3,
    ImageGuidedPixelClassificationV3,
    ImageGuidedPixelClassifierConfigV3,
    ImageGuidedPixelClassifierResultV3,
    ImageGuidedPixelClassifierWeightsV3,
    ImageGuidedRgbColorV3,
    SegmentationFloatMask,
} from './types';

import {
    clampSegmentationValue,
    clampUnitValue,
    cloneFloatMask,
    isValidFloatMask,
} from './types';

import {
    comparePreparedColorToLocalForegroundModelV3,
    isValidLocalForegroundModelV3,
    rgbToHsvV3,
    rgbToLabV3,
} from './LocalForegroundModelV3';

/* =========================================================
 * Public contracts
 * ======================================================= */

/**
 * مدخلات مصنف Pixels.
 */
export type ImageGuidedPixelClassifierInputV3 = {
  /**
   * صورة التحليل.
   */
  image:
    ImageGuidedAnalysisImageV3;

  /**
   * الماسك الحالي قبل التصنيف.
   */
  mask:
    SegmentationFloatMask;

  /**
   * خرائط الخصائص المحسوبة بواسطة:
   *
   * BoundaryFeatureExtractorV3.ts
   */
  featureMap:
    ImageGuidedBoundaryFeatureMapV3;

  /**
   * نموذج ألوان القطعة والخلفية.
   */
  foregroundModel:
    ImageGuidedLocalForegroundModelV3;

  /**
   * خريطة الجسم الأساسي.
   *
   * 1 = داخل الجسم الأساسي.
   * 0 = خارج الجسم الأساسي.
   */
  mainComponentMap:
    Uint8Array;

  /**
   * إعدادات اختيارية.
   */
  config?:
    Partial<
      ImageGuidedPixelClassifierConfigV3
    >;
};

/**
 * نتيجة التصنيف مع معلومات إضافية للاختبار.
 */
export type ImageGuidedPixelClassifierExecutionV3 = {
  result:
    ImageGuidedPixelClassifierResultV3;

  config:
    ImageGuidedPixelClassifierConfigV3;

  durationMs: number;
};

/**
 * تفاصيل حساب الدرجات الداخلية.
 */
export type ImageGuidedPixelScoreBreakdownV3 = {
  originalAlphaSupport: number;

  foregroundColorSupport: number;

  backgroundColorRejection: number;

  localForegroundSupport: number;

  textureSupport: number;

  contrastSupport: number;

  gradientSupport: number;

  edgeContinuitySupport: number;

  neighborSupport: number;

  componentSupport: number;

  mainComponentDistanceSupport: number;

  foregroundScore: number;

  backgroundScore: number;

  confidence: number;
};

/* =========================================================
 * Internal contracts
 * ======================================================= */

type SafePixelClassifierContextV3 = {
  width: number;

  height: number;

  pixelCount: number;

  image:
    ImageGuidedAnalysisImageV3;

  mask:
    SegmentationFloatMask;

  featureMap:
    ImageGuidedBoundaryFeatureMapV3;

  foregroundModel:
    ImageGuidedLocalForegroundModelV3;

  mainComponentMap:
    Uint8Array;

  config:
    ImageGuidedPixelClassifierConfigV3;

  warnings:
    string[];
};

type PixelClassifierAccumulatorV3 = {
  processedPixelCount: number;

  foregroundPixelCount: number;

  backgroundPixelCount: number;

  uncertainPixelCount: number;

  changedPixelCount: number;

  confidenceSum: number;
};

/* =========================================================
 * Classification map values
 * ======================================================= */

/**
 * قيم ثابتة داخل classificationMap.
 *
 * 0 = Pixel لم تتم معالجته.
 * 1 = Foreground.
 * 2 = Background.
 * 3 = Uncertain.
 */
export const IMAGE_GUIDED_CLASSIFICATION_UNPROCESSED_V3 =
  0;

export const IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3 =
  1;

export const IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3 =
  2;

export const IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3 =
  3;

/* =========================================================
 * Constants
 * ======================================================= */

const MAXIMUM_SAFE_PIXEL_COUNT =
  32_000_000;

const MAXIMUM_WARNING_COUNT =
  64;

const SCORE_EPSILON =
  0.000_001;

const MINIMUM_WEIGHT_TOTAL =
  0.000_001;

const DEFAULT_GRADIENT_DIRECTION =
  0;

const STRONG_COMPONENT_SUPPORT =
  0.72;

const STRONG_NEIGHBOR_AGREEMENT =
  0.76;

const STRONG_EDGE_CONTINUITY =
  0.68;

const WEAK_FOREGROUND_COLOR_SIMILARITY =
  0.32;

const STRONG_FOREGROUND_COLOR_SIMILARITY =
  0.70;

const STRONG_BACKGROUND_COLOR_SIMILARITY =
  0.72;

/* =========================================================
 * Default weights
 * ======================================================= */

/**
 * أوزان متوازنة لمعالجة حدود الملابس.
 *
 * مجموع الأوزان لا يشترط أن يساوي 1
 * لأن الملف يقوم بالتطبيع داخليًا.
 */
export const DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3:
  Readonly<
    ImageGuidedPixelClassifierWeightsV3
  > = {
    originalAlpha:
      1.35,

    rgbSimilarity:
      0.75,

    hsvSimilarity:
      0.60,

    labSimilarity:
      1.15,

    localForegroundSimilarity:
      1.30,

    backgroundRejection:
      1.25,

    localTexture:
      0.45,

    localContrast:
      0.55,

    gradientStrength:
      0.70,

    edgeContinuity:
      1.00,

    neighborAgreement:
      1.15,

    componentSupport:
      1.35,

    mainComponentDistance:
      0.90,
  };

/* =========================================================
 * Default configuration
 * ======================================================= */

export const DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3:
  Readonly<
    ImageGuidedPixelClassifierConfigV3
  > = {
    weights: {
      ...DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3,
    },

    /**
     * قبول Pixel كـForeground عند تخطي هذه الدرجة.
     */
    foregroundDecisionThreshold:
      0.58,

    /**
     * قبول Pixel كـBackground عند تخطي هذه الدرجة.
     */
    backgroundDecisionThreshold:
      0.58,

    /**
     * عند تقارب الدرجتين بهذا المقدار
     * تكون النتيجة Uncertain.
     */
    uncertainDecisionMargin:
      0.09,

    /**
     * Alpha يعتبر Foreground قويًا.
     */
    strongForegroundAlpha:
      0.86,

    /**
     * Alpha يعتبر Background قويًا.
     */
    strongBackgroundAlpha:
      0.08,

    /**
     * حماية مركز القطعة القوي.
     */
    preserveStrongCore:
      true,

    /**
     * رفض Pixel خارج البنية المحمية
     * إن لم يملك دعمًا بصريًا كافيًا.
     */
    rejectPixelsOutsideProtectedStructure:
      true,

    /**
     * أقل دعم بصري لقبول Pixel بعيد عن الجسم.
     */
    minimumVisualSupportOutsideStructure:
      0.58,

    /**
     * عند تشابه Pixel مع الخلفية أكثر من هذه القيمة
     * يزيد احتمال رفضه.
     */
    maximumBackgroundSimilarity:
      0.76,
  };

/* =========================================================
 * Configuration helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من الإعدادات الافتراضية.
 */
export function createDefaultPixelClassifierConfigV3():
  ImageGuidedPixelClassifierConfigV3 {
  return {
    ...DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3,

    weights: {
      ...DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3,
    },
  };
}

/**
 * دمج وتطبيع أوزان المصنف.
 */
export function resolvePixelClassifierWeightsV3(
  weights?:
    Partial<
      ImageGuidedPixelClassifierWeightsV3
    > | null
): ImageGuidedPixelClassifierWeightsV3 {
  const source =
    weights ?? {};

  return {
    originalAlpha:
      resolveSafeWeightV3(
        source.originalAlpha,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .originalAlpha
      ),

    rgbSimilarity:
      resolveSafeWeightV3(
        source.rgbSimilarity,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .rgbSimilarity
      ),

    hsvSimilarity:
      resolveSafeWeightV3(
        source.hsvSimilarity,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .hsvSimilarity
      ),

    labSimilarity:
      resolveSafeWeightV3(
        source.labSimilarity,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .labSimilarity
      ),

    localForegroundSimilarity:
      resolveSafeWeightV3(
        source.localForegroundSimilarity,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .localForegroundSimilarity
      ),

    backgroundRejection:
      resolveSafeWeightV3(
        source.backgroundRejection,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .backgroundRejection
      ),

    localTexture:
      resolveSafeWeightV3(
        source.localTexture,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .localTexture
      ),

    localContrast:
      resolveSafeWeightV3(
        source.localContrast,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .localContrast
      ),

    gradientStrength:
      resolveSafeWeightV3(
        source.gradientStrength,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .gradientStrength
      ),

    edgeContinuity:
      resolveSafeWeightV3(
        source.edgeContinuity,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .edgeContinuity
      ),

    neighborAgreement:
      resolveSafeWeightV3(
        source.neighborAgreement,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .neighborAgreement
      ),

    componentSupport:
      resolveSafeWeightV3(
        source.componentSupport,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .componentSupport
      ),

    mainComponentDistance:
      resolveSafeWeightV3(
        source.mainComponentDistance,
        DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3
          .mainComponentDistance
      ),
  };
}

/**
 * دمج وتطبيع إعدادات المصنف.
 */
export function resolvePixelClassifierConfigV3(
  config?:
    Partial<
      ImageGuidedPixelClassifierConfigV3
    > | null
): ImageGuidedPixelClassifierConfigV3 {
  const source =
    config ?? {};

  let foregroundDecisionThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.foregroundDecisionThreshold,
        DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
          .foregroundDecisionThreshold
      )
    );

  let backgroundDecisionThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.backgroundDecisionThreshold,
        DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
          .backgroundDecisionThreshold
      )
    );

  /**
   * منع Threshold منخفض جدًا يؤدي إلى
   * قبول Foreground وBackground معًا بسهولة.
   */
  foregroundDecisionThreshold =
    Math.max(
      0.20,
      foregroundDecisionThreshold
    );

  backgroundDecisionThreshold =
    Math.max(
      0.20,
      backgroundDecisionThreshold
    );

  let strongForegroundAlpha =
    clampUnitValue(
      finiteOrFallbackV3(
        source.strongForegroundAlpha,
        DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
          .strongForegroundAlpha
      )
    );

  let strongBackgroundAlpha =
    clampUnitValue(
      finiteOrFallbackV3(
        source.strongBackgroundAlpha,
        DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
          .strongBackgroundAlpha
      )
    );

  if (
    strongBackgroundAlpha >
    strongForegroundAlpha
  ) {
    const midpoint =
      (
        strongBackgroundAlpha +
        strongForegroundAlpha
      ) /
      2;

    strongBackgroundAlpha =
      clampUnitValue(
        midpoint -
          0.05
      );

    strongForegroundAlpha =
      clampUnitValue(
        midpoint +
          0.05
      );
  }

  const uncertainDecisionMargin =
    clampSegmentationValue(
      finiteOrFallbackV3(
        source.uncertainDecisionMargin,
        DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
          .uncertainDecisionMargin
      ),
      0,
      0.5
    );

  const minimumVisualSupportOutsideStructure =
    clampUnitValue(
      finiteOrFallbackV3(
        source.minimumVisualSupportOutsideStructure,
        DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
          .minimumVisualSupportOutsideStructure
      )
    );

  const maximumBackgroundSimilarity =
    clampUnitValue(
      finiteOrFallbackV3(
        source.maximumBackgroundSimilarity,
        DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
          .maximumBackgroundSimilarity
      )
    );

  return {
    weights:
      resolvePixelClassifierWeightsV3(
        source.weights
      ),

    foregroundDecisionThreshold,

    backgroundDecisionThreshold,

    uncertainDecisionMargin,

    strongForegroundAlpha,

    strongBackgroundAlpha,

    preserveStrongCore:
      source.preserveStrongCore ??
      DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
        .preserveStrongCore,

    rejectPixelsOutsideProtectedStructure:
      source.rejectPixelsOutsideProtectedStructure ??
      DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
        .rejectPixelsOutsideProtectedStructure,

    minimumVisualSupportOutsideStructure,

    maximumBackgroundSimilarity,
  };
}

/* =========================================================
 * Main public classifier
 * ======================================================= */

/**
 * تصنيف جميع Pixels النشطة القريبة من الحدود.
 */
export function classifyImageGuidedPixelsV3(
  input:
    ImageGuidedPixelClassifierInputV3
): ImageGuidedPixelClassifierExecutionV3 {
  const startedAt =
    nowMsV3();

  const context =
    createSafeClassifierContextV3(
      input
    );

  const {
    width,
    height,
    pixelCount,
    mask,
    featureMap,
    warnings,
  } = context;

  const outputMask =
    cloneFloatMask(
      mask
    );

  const foregroundScoreMap =
    new Float32Array(
      pixelCount
    );

  const backgroundScoreMap =
    new Float32Array(
      pixelCount
    );

  const confidenceMap =
    new Float32Array(
      pixelCount
    );

  const classificationMap =
    new Uint8Array(
      pixelCount
    );

  const accumulator:
    PixelClassifierAccumulatorV3 = {
    processedPixelCount:
      0,

    foregroundPixelCount:
      0,

    backgroundPixelCount:
      0,

    uncertainPixelCount:
      0,

    changedPixelCount:
      0,

    confidenceSum:
      0,
  };

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      featureMap
        .activeBoundaryMap[
          index
        ] === 0
    ) {
      /**
       * Pixels غير النشطة تحتفظ بقيمتها الأصلية
       * ولا تدخل في إحصائيات المصنف.
       */
      continue;
    }

    const pixelFeatures =
      createBoundaryPixelFeaturesV3(
        context,
        index
      );

    const classification =
      classifyBoundaryPixelV3(
        pixelFeatures,
        context.config
      );

    foregroundScoreMap[index] =
      classification
        .foregroundScore;

    backgroundScoreMap[index] =
      classification
        .backgroundScore;

    confidenceMap[index] =
      classification.confidence;

    classificationMap[index] =
      classificationToMapValueV3(
        classification
          .classification
      );

    const originalAlpha =
      safeUnitValueV3(
        mask.data[index]
      );

    const refinedAlpha =
      safeUnitValueV3(
        classification
          .refinedAlpha
      );

    outputMask.data[index] =
      refinedAlpha;

    accumulator.processedPixelCount +=
      1;

    accumulator.confidenceSum +=
      classification.confidence;

    if (
      Math.abs(
        refinedAlpha -
        originalAlpha
      ) >
      SCORE_EPSILON
    ) {
      accumulator.changedPixelCount +=
        1;
    }

    switch (
      classification.classification
    ) {
      case 'foreground':
        accumulator.foregroundPixelCount +=
          1;

        break;

      case 'background':
        accumulator.backgroundPixelCount +=
          1;

        break;

      case 'uncertain':
        accumulator.uncertainPixelCount +=
          1;

        break;
    }
  }

  if (
    accumulator.processedPixelCount ===
    0
  ) {
    pushWarningV3(
      warnings,
      'No active boundary pixels were processed by the classifier.'
    );
  }

  if (
    accumulator.uncertainPixelCount >
    accumulator.processedPixelCount *
      0.5
  ) {
    pushWarningV3(
      warnings,
      'More than half of the processed boundary pixels remained uncertain.'
    );
  }

  if (
    !context.foregroundModel.usable
  ) {
    pushWarningV3(
      warnings,
      'The local foreground model was marked as unusable; classification relied more heavily on structural features.'
    );
  }

  const averageConfidence =
    accumulator.processedPixelCount >
      0
      ? accumulator.confidenceSum /
        accumulator.processedPixelCount
      : 0;

  const result:
    ImageGuidedPixelClassifierResultV3 = {
      mask:
        outputMask,

      foregroundScoreMap,

      backgroundScoreMap,

      confidenceMap,

      classificationMap,

      processedPixelCount:
        accumulator.processedPixelCount,

      foregroundPixelCount:
        accumulator.foregroundPixelCount,

      backgroundPixelCount:
        accumulator.backgroundPixelCount,

      uncertainPixelCount:
        accumulator.uncertainPixelCount,

      changedPixelCount:
        accumulator.changedPixelCount,

      averageConfidence:
        clampUnitValue(
          averageConfidence
        ),

      warnings:
        [...warnings],
    };

  return {
    result,

    config:
      context.config,

    durationMs:
      Math.max(
        0,
        nowMsV3() -
          startedAt
      ),
  };
}

/**
 * Alias للاستخدام داخل Pipeline.
 */
export const runImageGuidedPixelClassifierV3 =
  classifyImageGuidedPixelsV3;

/* =========================================================
 * Public single-pixel classifier
 * ======================================================= */

/**
 * تصنيف Pixel واحدة اعتمادًا على الخصائص الجاهزة.
 */
export function classifyBoundaryPixelV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  config:
    ImageGuidedPixelClassifierConfigV3 =
      DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3
): ImageGuidedPixelClassificationV3 {
  const resolvedConfig =
    resolvePixelClassifierConfigV3(
      config
    );

  const breakdown =
    calculatePixelScoreBreakdownV3(
      features,
      resolvedConfig
    );

  return createPixelClassificationV3(
    features,
    breakdown,
    resolvedConfig
  );
}

/* =========================================================
 * Pixel feature creation
 * ======================================================= */

/**
 * تجميع جميع خصائص Pixel من:
 *
 * - الصورة.
 * - الماسك.
 * - BoundaryFeatureMap.
 * - LocalForegroundModel.
 */
export function createBoundaryPixelFeaturesV3(
  context:
    SafePixelClassifierContextV3,
  index: number
): ImageGuidedBoundaryPixelFeaturesV3 {
  const {
    width,
    height,
    image,
    mask,
    featureMap,
    foregroundModel,
    mainComponentMap,
  } = context;

  const safeIndex =
    Math.round(
      clampSegmentationValue(
        index,
        0,
        context.pixelCount -
          1
      )
    );

  const x =
    safeIndex %
    width;

  const y =
    Math.floor(
      safeIndex /
        width
    );

  const rgbIndex =
    safeIndex *
    3;

  const rgb:
    ImageGuidedRgbColorV3 = {
      r:
        safeUnitValueV3(
          image.rgb[
            rgbIndex
          ]
        ),

      g:
        safeUnitValueV3(
          image.rgb[
            rgbIndex +
              1
          ]
        ),

      b:
        safeUnitValueV3(
          image.rgb[
            rgbIndex +
              2
          ]
        ),
    };

  const hsv:
    ImageGuidedHsvColorV3 =
      rgbToHsvV3(
        rgb
      );

  const lab:
    ImageGuidedLabColorV3 =
      rgbToLabV3(
        rgb
      );

  const luminance =
    safeUnitValueV3(
      image.luminance[
        safeIndex
      ]
    );

  const similarities =
    comparePreparedColorToLocalForegroundModelV3(
      foregroundModel,
      x,
      y,
      rgb,
      hsv,
      lab,
      luminance
    );

  const foregroundNeighborRatio =
    safeUnitValueV3(
      featureMap
        .foregroundNeighborRatio[
          safeIndex
        ]
    );

  const backgroundNeighborRatio =
    safeUnitValueV3(
      featureMap
        .backgroundNeighborRatio[
          safeIndex
        ]
    );

  const uncertainNeighborRatio =
    clampUnitValue(
      1 -
      foregroundNeighborRatio -
      backgroundNeighborRatio
    );

  const distanceToBoundary =
    safeNonNegativeValueV3(
      featureMap
        .boundaryDistance[
          safeIndex
        ]
    );

  const distanceToMainComponent =
    safeNonNegativeValueV3(
      featureMap
        .mainComponentDistance[
          safeIndex
        ]
    );

  const insideMainComponent =
    mainComponentMap[
      safeIndex
    ] !== 0;

  const nearMainComponent =
    insideMainComponent ||
    distanceToMainComponent <=
      Math.max(
        2,
        featureMap
          .maximumBoundaryDistance
      );

  const touchesImageBorder =
    x === 0 ||
    y === 0 ||
    x ===
      width -
        1 ||
    y ===
      height -
        1;

  return {
    index:
      safeIndex,

    x,

    y,

    originalAlpha:
      safeUnitValueV3(
        mask.data[
          safeIndex
        ]
      ),

    rgb,

    hsv,

    lab,

    luminance,

    gradientStrength:
      safeUnitValueV3(
        image.gradient[
          safeIndex
        ]
      ),

    gradientDirection:
      image.gradientDirection
        ? finiteOrFallbackV3(
            image
              .gradientDirection[
                safeIndex
              ],
            DEFAULT_GRADIENT_DIRECTION
          )
        : DEFAULT_GRADIENT_DIRECTION,

    localMeanLuminance:
      safeUnitValueV3(
        featureMap
          .localMeanLuminance[
            safeIndex
          ]
      ),

    localVariance:
      safeUnitValueV3(
        featureMap
          .localVariance[
            safeIndex
          ]
      ),

    localTexture:
      safeUnitValueV3(
        featureMap
          .localTexture[
            safeIndex
          ]
      ),

    localContrast:
      safeUnitValueV3(
        featureMap
          .localContrast[
            safeIndex
          ]
      ),

    foregroundNeighborRatio,

    backgroundNeighborRatio,

    uncertainNeighborRatio,

    distanceToBoundary,

    distanceToMainComponent,

    insideMainComponent,

    nearMainComponent,

    touchesImageBorder,

    foregroundRgbSimilarity:
      similarities
        .foregroundRgbSimilarity,

    foregroundHsvSimilarity:
      similarities
        .foregroundHsvSimilarity,

    foregroundLabSimilarity:
      similarities
        .foregroundLabSimilarity,

    backgroundRgbSimilarity:
      similarities
        .backgroundRgbSimilarity,

    backgroundHsvSimilarity:
      similarities
        .backgroundHsvSimilarity,

    backgroundLabSimilarity:
      similarities
        .backgroundLabSimilarity,

    localForegroundSimilarity:
      similarities
        .localForegroundSimilarity,

    globalForegroundSimilarity:
      similarities
        .globalForegroundSimilarity,

    globalBackgroundSimilarity:
      similarities
        .globalBackgroundSimilarity,

    edgeContinuity:
      safeUnitValueV3(
        featureMap
          .edgeContinuity[
            safeIndex
          ]
      ),

    neighborAgreement:
      safeUnitValueV3(
        featureMap
          .neighborAgreement[
            safeIndex
          ]
      ),

    componentSupport:
      safeUnitValueV3(
        featureMap
          .componentSupport[
            safeIndex
          ]
      ),
  };
}

/* =========================================================
 * Score calculation
 * ======================================================= */

/**
 * حساب درجات Foreground وBackground.
 */
export function calculatePixelScoreBreakdownV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  config:
    ImageGuidedPixelClassifierConfigV3
): ImageGuidedPixelScoreBreakdownV3 {
  const weights =
    config.weights;

  const originalAlphaSupport =
    calculateOriginalAlphaSupportV3(
      features.originalAlpha,
      config
    );

  const foregroundColorSupport =
    calculateForegroundColorSupportV3(
      features,
      weights
    );

  const backgroundColorRejection =
    calculateBackgroundColorRejectionV3(
      features
    );

  const localForegroundSupport =
    clampUnitValue(
      features
        .localForegroundSimilarity
    );

  const textureSupport =
    calculateTextureSupportV3(
      features
    );

  const contrastSupport =
    calculateContrastSupportV3(
      features
    );

  const gradientSupport =
    calculateGradientSupportV3(
      features
    );

  const edgeContinuitySupport =
    clampUnitValue(
      features.edgeContinuity
    );

  const neighborSupport =
    calculateNeighborSupportV3(
      features
    );

  const componentSupport =
    calculateProtectedComponentSupportV3(
      features
    );

  const mainComponentDistanceSupport =
    calculateMainComponentDistanceSupportV3(
      features
    );

  const foregroundWeightedSum =
    originalAlphaSupport *
      weights.originalAlpha +
    features.foregroundRgbSimilarity *
      weights.rgbSimilarity +
    features.foregroundHsvSimilarity *
      weights.hsvSimilarity +
    features.foregroundLabSimilarity *
      weights.labSimilarity +
    localForegroundSupport *
      weights.localForegroundSimilarity +
    backgroundColorRejection *
      weights.backgroundRejection +
    textureSupport *
      weights.localTexture +
    contrastSupport *
      weights.localContrast +
    gradientSupport *
      weights.gradientStrength +
    edgeContinuitySupport *
      weights.edgeContinuity +
    neighborSupport *
      weights.neighborAgreement +
    componentSupport *
      weights.componentSupport +
    mainComponentDistanceSupport *
      weights.mainComponentDistance;

  const foregroundWeightTotal =
    sumClassifierWeightsV3(
      weights
    );

  let foregroundScore =
    safeDivideV3(
      foregroundWeightedSum,
      foregroundWeightTotal,
      0
    );

  foregroundScore =
    applyForegroundStructuralRulesV3(
      foregroundScore,
      features,
      config
    );

  const backgroundScore =
    calculateBackgroundScoreV3(
      features,
      foregroundScore,
      config
    );

  const confidence =
    calculateClassificationConfidenceV3(
      foregroundScore,
      backgroundScore,
      features,
      config
    );

  return {
    originalAlphaSupport,

    foregroundColorSupport,

    backgroundColorRejection,

    localForegroundSupport,

    textureSupport,

    contrastSupport,

    gradientSupport,

    edgeContinuitySupport,

    neighborSupport,

    componentSupport,

    mainComponentDistanceSupport,

    foregroundScore:
      clampUnitValue(
        foregroundScore
      ),

    backgroundScore:
      clampUnitValue(
        backgroundScore
      ),

    confidence:
      clampUnitValue(
        confidence
      ),
  };
}

/* =========================================================
 * Context validation
 * ======================================================= */

function createSafeClassifierContextV3(
  input:
    ImageGuidedPixelClassifierInputV3
): SafePixelClassifierContextV3 {
  if (
    typeof input !==
      'object' ||
    input === null
  ) {
    throw new Error(
      'ImageGuidedPixelClassifierV3 received an invalid input object.'
    );
  }

  if (
    !isValidAnalysisImageV3(
      input.image
    )
  ) {
    throw new Error(
      'ImageGuidedPixelClassifierV3 received an invalid analysis image.'
    );
  }

  if (
    !isValidFloatMask(
      input.mask
    )
  ) {
    throw new Error(
      'ImageGuidedPixelClassifierV3 received an invalid float mask.'
    );
  }

  if (
    !isValidBoundaryFeatureMapV3(
      input.featureMap
    )
  ) {
    throw new Error(
      'ImageGuidedPixelClassifierV3 received an invalid boundary feature map.'
    );
  }

  if (
    !isValidLocalForegroundModelV3(
      input.foregroundModel
    )
  ) {
    throw new Error(
      'ImageGuidedPixelClassifierV3 received an invalid local foreground model.'
    );
  }

  const {
    width,
    height,
  } = input.image;

  const pixelCount =
    width *
    height;

  if (
    !Number.isSafeInteger(
      pixelCount
    ) ||
    pixelCount <= 0 ||
    pixelCount >
      MAXIMUM_SAFE_PIXEL_COUNT
  ) {
    throw new Error(
      `ImageGuidedPixelClassifierV3 received an unsafe pixel count: ${pixelCount}.`
    );
  }

  if (
    input.mask.width !==
      width ||
    input.mask.height !==
      height ||
    input.featureMap.width !==
      width ||
    input.featureMap.height !==
      height ||
    input.foregroundModel.width !==
      width ||
    input.foregroundModel.height !==
      height
  ) {
    throw new Error(
      [
        'ImageGuidedPixelClassifierV3 input sizes do not match.',
        `Image: ${width}x${height}.`,
        `Mask: ${input.mask.width}x${input.mask.height}.`,
        `Features: ${input.featureMap.width}x${input.featureMap.height}.`,
        `Model: ${input.foregroundModel.width}x${input.foregroundModel.height}.`,
      ].join(' ')
    );
  }

  if (
    !(
      input.mainComponentMap instanceof
      Uint8Array
    ) ||
    input.mainComponentMap.length !==
      pixelCount
  ) {
    throw new Error(
      'ImageGuidedPixelClassifierV3 received an invalid main component map.'
    );
  }

  const warnings:
    string[] = [];

  const config =
    resolvePixelClassifierConfigV3(
      input.config
    );

  const mainComponentMap =
    normalizeBinaryMapV3(
      input.mainComponentMap
    );

  inspectClassifierSourcesV3(
    input.image,
    input.mask,
    input.featureMap,
    warnings
  );

  return {
    width,

    height,

    pixelCount,

    image:
      input.image,

    mask:
      input.mask,

    featureMap:
      input.featureMap,

    foregroundModel:
      input.foregroundModel,

    mainComponentMap,

    config,

    warnings,
  };
}

/* =========================================================
 * Local validation helpers
 * ======================================================= */

function isValidAnalysisImageV3(
  value: unknown
): value is ImageGuidedAnalysisImageV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const image =
    value as Partial<
      ImageGuidedAnalysisImageV3
    >;

  if (
    typeof image.width !==
      'number' ||
    !Number.isInteger(
      image.width
    ) ||
    image.width <= 0 ||
    typeof image.height !==
      'number' ||
    !Number.isInteger(
      image.height
    ) ||
    image.height <= 0
  ) {
    return false;
  }

  const pixelCount =
    image.width *
    image.height;

  if (
    !Number.isSafeInteger(
      pixelCount
    ) ||
    pixelCount <= 0 ||
    pixelCount >
      MAXIMUM_SAFE_PIXEL_COUNT
  ) {
    return false;
  }

  return (
    image.rgb instanceof
      Float32Array &&
    image.rgb.length ===
      pixelCount *
        3 &&
    image.gradient instanceof
      Float32Array &&
    image.gradient.length ===
      pixelCount &&
    image.luminance instanceof
      Float32Array &&
    image.luminance.length ===
      pixelCount &&
    (
      image.gradientDirection ===
        null ||
      (
        image.gradientDirection instanceof
          Float32Array &&
        image.gradientDirection.length ===
          pixelCount
      )
    )
  );
}

function isValidBoundaryFeatureMapV3(
  value: unknown
): value is ImageGuidedBoundaryFeatureMapV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const map =
    value as Partial<
      ImageGuidedBoundaryFeatureMapV3
    >;

  if (
    typeof map.width !==
      'number' ||
    !Number.isInteger(
      map.width
    ) ||
    map.width <= 0 ||
    typeof map.height !==
      'number' ||
    !Number.isInteger(
      map.height
    ) ||
    map.height <= 0
  ) {
    return false;
  }

  const pixelCount =
    map.width *
    map.height;

  return (
    hasByteMapLengthV3(
      map.activeBoundaryMap,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.boundaryDistance,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.mainComponentDistance,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.localMeanLuminance,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.localVariance,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.localTexture,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.localContrast,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.foregroundNeighborRatio,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.backgroundNeighborRatio,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.edgeContinuity,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.neighborAgreement,
      pixelCount
    ) &&
    hasFloatMapLengthV3(
      map.componentSupport,
      pixelCount
    )
  );
}

/* =========================================================
 * Source inspection
 * ======================================================= */

function inspectClassifierSourcesV3(
  image:
    ImageGuidedAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3,
  warnings:
    string[]
): void {
  const pixelCount =
    image.width *
    image.height;

  const step =
    Math.max(
      1,
      Math.floor(
        pixelCount /
          4096
      )
    );

  let invalidImageValues =
    0;

  let invalidMaskValues =
    0;

  let invalidFeatureValues =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += step
  ) {
    const rgbIndex =
      index *
      3;

    if (
      !isFiniteUnitValueV3(
        image.rgb[
          rgbIndex
        ]
      ) ||
      !isFiniteUnitValueV3(
        image.rgb[
          rgbIndex +
            1
        ]
      ) ||
      !isFiniteUnitValueV3(
        image.rgb[
          rgbIndex +
            2
        ]
      ) ||
      !isFiniteUnitValueV3(
        image.luminance[
          index
        ]
      )
    ) {
      invalidImageValues +=
        1;
    }

    if (
      !isFiniteUnitValueV3(
        mask.data[index]
      )
    ) {
      invalidMaskValues +=
        1;
    }

    if (
      !Number.isFinite(
        featureMap
          .boundaryDistance[
            index
          ]
      ) ||
      !Number.isFinite(
        featureMap
          .mainComponentDistance[
            index
          ]
      )
    ) {
      invalidFeatureValues +=
        1;
    }
  }

  if (
    invalidImageValues >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some image values were invalid or outside the expected range and will be clamped.'
    );
  }

  if (
    invalidMaskValues >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some mask values were invalid or outside the expected range and will be clamped.'
    );
  }

  if (
    invalidFeatureValues >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some boundary feature values were invalid and will use safe fallback values.'
    );
  }
}

/* =========================================================
 * Basic helpers
 * ======================================================= */

function resolveSafeWeightV3(
  value:
    number | undefined,
  fallback: number
): number {
  return clampSegmentationValue(
    finiteOrFallbackV3(
      value,
      fallback
    ),
    0,
    100
  );
}

function finiteOrFallbackV3(
  value:
    number | undefined,
  fallback: number
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

function safeUnitValueV3(
  value: number
): number {
  return Number.isFinite(
    value
  )
    ? clampUnitValue(
        value
      )
    : 0;
}

function safeNonNegativeValueV3(
  value: number
): number {
  return Number.isFinite(
    value
  )
    ? Math.max(
        0,
        value
      )
    : 0;
}

function safeDivideV3(
  numerator: number,
  denominator: number,
  fallback = 0
): number {
  if (
    !Number.isFinite(
      numerator
    ) ||
    !Number.isFinite(
      denominator
    ) ||
    Math.abs(
      denominator
    ) <
      MINIMUM_WEIGHT_TOTAL
  ) {
    return fallback;
  }

  const result =
    numerator /
    denominator;

  return Number.isFinite(
    result
  )
    ? result
    : fallback;
}

function isFiniteUnitValueV3(
  value: number
): boolean {
  return (
    Number.isFinite(
      value
    ) &&
    value >= 0 &&
    value <= 1
  );
}

function normalizeBinaryMapV3(
  source:
    Uint8Array
): Uint8Array {
  const result =
    new Uint8Array(
      source.length
    );

  for (
    let index = 0;
    index < source.length;
    index += 1
  ) {
    result[index] =
      source[index] ===
        0
        ? 0
        : 1;
  }

  return result;
}

function hasByteMapLengthV3(
  value: unknown,
  expectedLength: number
): value is Uint8Array {
  return (
    value instanceof
      Uint8Array &&
    value.length ===
      expectedLength
  );
}

function hasFloatMapLengthV3(
  value: unknown,
  expectedLength: number
): value is Float32Array {
  return (
    value instanceof
      Float32Array &&
    value.length ===
      expectedLength
  );
}

function pushWarningV3(
  warnings:
    string[],
  warning: string
): void {
  if (
    warnings.length >=
    MAXIMUM_WARNING_COUNT
  ) {
    return;
  }

  if (
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

function nowMsV3(): number {
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
 * Part 2 continues directly below
 * ======================================================= */

// الجزء الثاني يبدأ من:
//
// function calculateOriginalAlphaSupportV3(...)
//
// ويحتوي على:
//
// - حساب دعم Alpha.
// - حساب دعم الألوان.
// - حساب رفض الخلفية.
// - حساب Texture وContrast.
// - حساب دعم Gradient والحافة.
// - حساب دعم الجيران والـComponent.
// - حساب Background Score.
// - حماية Strong Core.
// - القرار Foreground / Background / Uncertain.
// - حساب refinedAlpha.
// - Validators وClone وDiagnostics.
// - Default export.
/* =========================================================
 * Original Alpha support
 * ======================================================= */

/**
 * تحويل Alpha الأصلي إلى دعم Foreground.
 *
 * نحافظ على Strong Core،
 * ونترك المنطقة الانتقالية مفتوحة لبقية الخصائص.
 */
function calculateOriginalAlphaSupportV3(
  alpha: number,
  config:
    ImageGuidedPixelClassifierConfigV3
): number {
  const safeAlpha =
    safeUnitValueV3(
      alpha
    );

  if (
    safeAlpha >=
    config.strongForegroundAlpha
  ) {
    return 1;
  }

  if (
    safeAlpha <=
    config.strongBackgroundAlpha
  ) {
    return 0;
  }

  const denominator =
    Math.max(
      SCORE_EPSILON,
      config.strongForegroundAlpha -
        config.strongBackgroundAlpha
    );

  return clampUnitValue(
    (
      safeAlpha -
      config.strongBackgroundAlpha
    ) /
      denominator
  );
}

/* =========================================================
 * Foreground color support
 * ======================================================= */

/**
 * دمج RGB وHSV وLab في دعم لوني واحد.
 */
function calculateForegroundColorSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  weights:
    ImageGuidedPixelClassifierWeightsV3
): number {
  const rgbWeight =
    Math.max(
      0,
      weights.rgbSimilarity
    );

  const hsvWeight =
    Math.max(
      0,
      weights.hsvSimilarity
    );

  const labWeight =
    Math.max(
      0,
      weights.labSimilarity
    );

  const totalWeight =
    rgbWeight +
    hsvWeight +
    labWeight;

  if (
    totalWeight <=
    MINIMUM_WEIGHT_TOTAL
  ) {
    return clampUnitValue(
      features
        .globalForegroundSimilarity
    );
  }

  const weightedSimilarity =
    features.foregroundRgbSimilarity *
      rgbWeight +
    features.foregroundHsvSimilarity *
      hsvWeight +
    features.foregroundLabSimilarity *
      labWeight;

  const prototypeSimilarity =
    safeDivideV3(
      weightedSimilarity,
      totalWeight,
      0
    );

  const globalSupport =
    clampUnitValue(
      features
        .globalForegroundSimilarity
    );

  return clampUnitValue(
    prototypeSimilarity *
      0.72 +
    globalSupport *
      0.28
  );
}

/* =========================================================
 * Background rejection
 * ======================================================= */

/**
 * كلما قل تشابه Pixel مع الخلفية،
 * زاد دعم Foreground.
 */
function calculateBackgroundColorRejectionV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  const combinedBackgroundSimilarity =
    clampUnitValue(
      features.backgroundRgbSimilarity *
        0.24 +
      features.backgroundHsvSimilarity *
        0.18 +
      features.backgroundLabSimilarity *
        0.38 +
      features.globalBackgroundSimilarity *
        0.20
    );

  return clampUnitValue(
    1 -
    combinedBackgroundSimilarity
  );
}

/* =========================================================
 * Texture support
 * ======================================================= */

/**
 * الملمس المرتفع جدًا قد يكون ضوضاء،
 * والمنخفض جدًا قد يكون خلفية مسطحة.
 *
 * نستخدم نطاقًا متوسطًا مرنًا.
 */
function calculateTextureSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  const texture =
    clampUnitValue(
      features.localTexture
    );

  const variance =
    clampUnitValue(
      features.localVariance
    );

  const textureBand =
    bellSupportV3(
      texture,
      0.18,
      0.42
    );

  const varianceBand =
    bellSupportV3(
      variance,
      0.12,
      0.38
    );

  const edgeAssist =
    clampUnitValue(
      features.edgeContinuity
    );

  return clampUnitValue(
    textureBand *
      0.40 +
    varianceBand *
      0.30 +
    edgeAssist *
      0.30
  );
}

/* =========================================================
 * Contrast support
 * ======================================================= */

/**
 * التباين المحلي يساعد على إثبات وجود
 * حافة حقيقية حول القطعة.
 */
function calculateContrastSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  const contrast =
    clampUnitValue(
      features.localContrast
    );

  const gradient =
    clampUnitValue(
      features.gradientStrength
    );

  const continuity =
    clampUnitValue(
      features.edgeContinuity
    );

  return clampUnitValue(
    contrast *
      0.45 +
    gradient *
      0.25 +
    continuity *
      0.30
  );
}

/* =========================================================
 * Gradient support
 * ======================================================= */

/**
 * Gradient قوي ومستمر يعطي دعمًا للحافة.
 */
function calculateGradientSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  const gradient =
    clampUnitValue(
      features.gradientStrength
    );

  const continuity =
    clampUnitValue(
      features.edgeContinuity
    );

  const contrast =
    clampUnitValue(
      features.localContrast
    );

  return clampUnitValue(
    gradient *
      0.50 +
    continuity *
      0.35 +
    contrast *
      0.15
  );
}

/* =========================================================
 * Neighbor support
 * ======================================================= */

/**
 * حساب دعم الجيران.
 *
 * لا نعتمد فقط على foregroundNeighborRatio،
 * لأن uncertain neighbors قد تكون تفاصيل حقيقية.
 */
function calculateNeighborSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  const foregroundRatio =
    clampUnitValue(
      features.foregroundNeighborRatio
    );

  const uncertainRatio =
    clampUnitValue(
      features.uncertainNeighborRatio
    );

  const agreement =
    clampUnitValue(
      features.neighborAgreement
    );

  return clampUnitValue(
    foregroundRatio *
      0.52 +
    uncertainRatio *
      0.18 +
    agreement *
      0.30
  );
}

/* =========================================================
 * Protected component support
 * ======================================================= */

/**
 * دعم الجسم الأساسي.
 */
function calculateProtectedComponentSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  const directSupport =
    features.insideMainComponent
      ? 1
      : features.nearMainComponent
        ? 0.70
        : 0.15;

  return clampUnitValue(
    directSupport *
      0.48 +
    features.componentSupport *
      0.37 +
    features.neighborAgreement *
      0.15
  );
}

/* =========================================================
 * Main component distance support
 * ======================================================= */

/**
 * تحويل المسافة من الجسم الأساسي إلى دعم.
 */
function calculateMainComponentDistanceSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  if (
    features.insideMainComponent
  ) {
    return 1;
  }

  const safeDistance =
    safeNonNegativeValueV3(
      features.distanceToMainComponent
    );

  const referenceDistance =
    Math.max(
      2,
      features.distanceToBoundary *
        2 +
        4
    );

  return clampUnitValue(
    1 -
    safeDistance /
      referenceDistance
  );
}

/* =========================================================
 * Structural foreground rules
 * ======================================================= */

/**
 * تطبيق قواعد حماية البنية بعد الحساب الأساسي.
 */
function applyForegroundStructuralRulesV3(
  inputScore: number,
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  config:
    ImageGuidedPixelClassifierConfigV3
): number {
  let score =
    clampUnitValue(
      inputScore
    );

  const strongCore =
    features.insideMainComponent &&
    features.originalAlpha >=
      config.strongForegroundAlpha;

  if (
    config.preserveStrongCore &&
    strongCore
  ) {
    score =
      Math.max(
        score,
        0.92
      );
  }

  const strongStructure =
    features.componentSupport >=
      STRONG_COMPONENT_SUPPORT &&
    features.neighborAgreement >=
      STRONG_NEIGHBOR_AGREEMENT;

  if (
    strongStructure
  ) {
    score =
      Math.max(
        score,
        0.76
      );
  }

  const supportedThinEdge =
    features.edgeContinuity >=
      STRONG_EDGE_CONTINUITY &&
    features.gradientStrength >=
      0.48 &&
    features.localForegroundSimilarity >=
      0.45;

  if (
    supportedThinEdge
  ) {
    score =
      Math.max(
        score,
        0.66
      );
  }

  const outsideStructure =
    !features.insideMainComponent &&
    !features.nearMainComponent;

  if (
    config.rejectPixelsOutsideProtectedStructure &&
    outsideStructure
  ) {
    const visualSupport =
      calculateOutsideStructureVisualSupportV3(
        features
      );

    if (
      visualSupport <
      config.minimumVisualSupportOutsideStructure
    ) {
      score *=
        0.42;
    }
  }

  if (
    features.touchesImageBorder &&
    !features.insideMainComponent &&
    features.componentSupport <
      0.55
  ) {
    score *=
      0.72;
  }

  if (
    features.globalBackgroundSimilarity >=
      config.maximumBackgroundSimilarity &&
    features.localForegroundSimilarity <
      0.62
  ) {
    score *=
      0.62;
  }

  return clampUnitValue(
    score
  );
}

/**
 * دعم Pixel بعيد عن البنية الأساسية.
 */
function calculateOutsideStructureVisualSupportV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3
): number {
  const colorSupport =
    clampUnitValue(
      features.localForegroundSimilarity *
        0.45 +
      features.globalForegroundSimilarity *
        0.25 +
      (
        1 -
        features.globalBackgroundSimilarity
      ) *
        0.30
    );

  const edgeSupport =
    clampUnitValue(
      features.edgeContinuity *
        0.55 +
      features.gradientStrength *
        0.25 +
      features.localContrast *
        0.20
    );

  const neighborhoodSupport =
    clampUnitValue(
      features.foregroundNeighborRatio *
        0.55 +
      features.neighborAgreement *
        0.45
    );

  return clampUnitValue(
    colorSupport *
      0.46 +
    edgeSupport *
      0.31 +
    neighborhoodSupport *
      0.23
  );
}

/* =========================================================
 * Background score
 * ======================================================= */

/**
 * حساب درجة الخلفية مستقلة عن Foreground،
 * ثم استخدام Foreground كعامل توازن فقط.
 */
function calculateBackgroundScoreV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  foregroundScore: number,
  config:
    ImageGuidedPixelClassifierConfigV3
): number {
  const backgroundColorSimilarity =
    clampUnitValue(
      features.backgroundRgbSimilarity *
        0.22 +
      features.backgroundHsvSimilarity *
        0.18 +
      features.backgroundLabSimilarity *
        0.36 +
      features.globalBackgroundSimilarity *
        0.24
    );

  const alphaBackgroundSupport =
    clampUnitValue(
      1 -
      calculateOriginalAlphaSupportV3(
        features.originalAlpha,
        config
      )
    );

  const neighborBackgroundSupport =
    clampUnitValue(
      features.backgroundNeighborRatio *
        0.62 +
      (
        1 -
        features.neighborAgreement
      ) *
        0.18 +
      features.uncertainNeighborRatio *
        0.20
    );

  const structureRejection =
    clampUnitValue(
      1 -
      (
        features.componentSupport *
          0.55 +
        (
          features.insideMainComponent
            ? 1
            : features.nearMainComponent
              ? 0.58
              : 0
        ) *
          0.45
      )
    );

  const weakEdgeSupport =
    clampUnitValue(
      1 -
      (
        features.edgeContinuity *
          0.55 +
        features.gradientStrength *
          0.25 +
        features.localContrast *
          0.20
      )
    );

  let backgroundScore =
    backgroundColorSimilarity *
      0.33 +
    alphaBackgroundSupport *
      0.24 +
    neighborBackgroundSupport *
      0.19 +
    structureRejection *
      0.16 +
    weakEdgeSupport *
      0.08;

  if (
    features.originalAlpha <=
    config.strongBackgroundAlpha &&
    !features.insideMainComponent
  ) {
    backgroundScore =
      Math.max(
        backgroundScore,
        0.88
      );
  }

  if (
    features.globalBackgroundSimilarity >=
      STRONG_BACKGROUND_COLOR_SIMILARITY &&
    features.localForegroundSimilarity <=
      WEAK_FOREGROUND_COLOR_SIMILARITY
  ) {
    backgroundScore =
      Math.max(
        backgroundScore,
        0.78
      );
  }

  if (
    features.insideMainComponent &&
    config.preserveStrongCore
  ) {
    backgroundScore *=
      0.30;
  }

  if (
    features.componentSupport >=
      STRONG_COMPONENT_SUPPORT &&
    features.edgeContinuity >=
      STRONG_EDGE_CONTINUITY
  ) {
    backgroundScore *=
      0.62;
  }

  /**
   * منع Foreground وBackground من الارتفاع
   * معًا بصورة غير منطقية.
   */
  const competitionPenalty =
    clampUnitValue(
      foregroundScore -
        0.50
    );

  backgroundScore *=
    1 -
    competitionPenalty *
      0.22;

  return clampUnitValue(
    backgroundScore
  );
}

/* =========================================================
 * Confidence
 * ======================================================= */

/**
 * حساب ثقة القرار النهائي.
 */
function calculateClassificationConfidenceV3(
  foregroundScore: number,
  backgroundScore: number,
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  config:
    ImageGuidedPixelClassifierConfigV3
): number {
  const scoreDifference =
    Math.abs(
      foregroundScore -
      backgroundScore
    );

  const dominantScore =
    Math.max(
      foregroundScore,
      backgroundScore
    );

  const structureConfidence =
    clampUnitValue(
      features.componentSupport *
        0.38 +
      features.neighborAgreement *
        0.30 +
      features.edgeContinuity *
        0.20 +
      features.gradientStrength *
        0.12
    );

  const colorConfidence =
    clampUnitValue(
      Math.abs(
        features.localForegroundSimilarity -
        features.globalBackgroundSimilarity
      )
    );

  const marginConfidence =
    clampUnitValue(
      scoreDifference /
        Math.max(
          SCORE_EPSILON,
          config.uncertainDecisionMargin *
            2
        )
    );

  return clampUnitValue(
    dominantScore *
      0.30 +
    marginConfidence *
      0.36 +
    structureConfidence *
      0.20 +
    colorConfidence *
      0.14
  );
}

/* =========================================================
 * Classification creation
 * ======================================================= */

/**
 * إنشاء القرار النهائي لـPixel.
 */
function createPixelClassificationV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  breakdown:
    ImageGuidedPixelScoreBreakdownV3,
  config:
    ImageGuidedPixelClassifierConfigV3
): ImageGuidedPixelClassificationV3 {
  const foregroundScore =
    clampUnitValue(
      breakdown.foregroundScore
    );

  const backgroundScore =
    clampUnitValue(
      breakdown.backgroundScore
    );

  const scoreDifference =
    foregroundScore -
    backgroundScore;

  const absoluteDifference =
    Math.abs(
      scoreDifference
    );

  const strongCore =
    config.preserveStrongCore &&
    features.insideMainComponent &&
    features.originalAlpha >=
      config.strongForegroundAlpha;

  let classification:
    | 'foreground'
    | 'background'
    | 'uncertain';

  if (
    strongCore
  ) {
    classification =
      'foreground';
  } else if (
    foregroundScore >=
      config.foregroundDecisionThreshold &&
    scoreDifference >
      config.uncertainDecisionMargin
  ) {
    classification =
      'foreground';
  } else if (
    backgroundScore >=
      config.backgroundDecisionThreshold &&
    scoreDifference <
      -
      config.uncertainDecisionMargin
  ) {
    classification =
      'background';
  } else if (
    absoluteDifference <=
    config.uncertainDecisionMargin
  ) {
    classification =
      'uncertain';
  } else {
    classification =
      scoreDifference >
      0
        ? 'foreground'
        : 'background';
  }

  const refinedAlpha =
    calculateRefinedAlphaV3(
      features,
      classification,
      foregroundScore,
      backgroundScore,
      breakdown.confidence,
      config
    );

  return {
    index:
      features.index,

    foregroundScore,

    backgroundScore,

    confidence:
      breakdown.confidence,

    classification,

    refinedAlpha,
  };
}

/* =========================================================
 * Refined Alpha
 * ======================================================= */

/**
 * إنتاج Alpha جديد بدون Snap قاسٍ.
 *
 * ConfidenceVotingV3 وAdaptiveEdgeRefinerV3
 * سيقومان بالتسوية النهائية لاحقًا.
 */
function calculateRefinedAlphaV3(
  features:
    ImageGuidedBoundaryPixelFeaturesV3,
  classification:
    | 'foreground'
    | 'background'
    | 'uncertain',
  foregroundScore: number,
  backgroundScore: number,
  confidence: number,
  config:
    ImageGuidedPixelClassifierConfigV3
): number {
  const originalAlpha =
    clampUnitValue(
      features.originalAlpha
    );

  const safeConfidence =
    clampUnitValue(
      confidence
    );

  if (
    config.preserveStrongCore &&
    features.insideMainComponent &&
    originalAlpha >=
      config.strongForegroundAlpha
  ) {
    return Math.max(
      originalAlpha,
      0.94
    );
  }

  if (
    classification ===
    'foreground'
  ) {
    const targetAlpha =
      clampUnitValue(
        foregroundScore *
          0.72 +
        features.componentSupport *
          0.12 +
        features.neighborAgreement *
          0.10 +
        features.edgeContinuity *
          0.06
      );

    const blendStrength =
      clampUnitValue(
        0.38 +
        safeConfidence *
          0.48
      );

    return clampUnitValue(
      originalAlpha *
        (
          1 -
          blendStrength
        ) +
      Math.max(
        originalAlpha,
        targetAlpha
      ) *
        blendStrength
    );
  }

  if (
    classification ===
    'background'
  ) {
    const targetAlpha =
      clampUnitValue(
        (
          1 -
          backgroundScore
        ) *
        0.55 +
        foregroundScore *
          0.20 +
        features.edgeContinuity *
          0.10
      );

    const protectedEdge =
      features.edgeContinuity >=
        STRONG_EDGE_CONTINUITY &&
      features.localForegroundSimilarity >=
        0.48;

    const blendStrength =
      protectedEdge
        ? clampUnitValue(
            0.20 +
            safeConfidence *
              0.28
          )
        : clampUnitValue(
            0.42 +
            safeConfidence *
              0.48
          );

    return clampUnitValue(
      originalAlpha *
        (
          1 -
          blendStrength
        ) +
      Math.min(
        originalAlpha,
        targetAlpha
      ) *
        blendStrength
    );
  }

  /**
   * Uncertain:
   * نحتفظ بقدر كبير من Alpha الأصلي،
   * مع انحياز طفيف للدرجة الأقوى.
   */
  const neutralTarget =
    clampUnitValue(
      foregroundScore /
        Math.max(
          SCORE_EPSILON,
          foregroundScore +
            backgroundScore
        )
    );

  const uncertainBlend =
    clampUnitValue(
      0.12 +
      safeConfidence *
        0.16
    );

  return clampUnitValue(
    originalAlpha *
      (
        1 -
        uncertainBlend
      ) +
    neutralTarget *
      uncertainBlend
  );
}

/* =========================================================
 * Classification map helpers
 * ======================================================= */

function classificationToMapValueV3(
  classification:
    | 'foreground'
    | 'background'
    | 'uncertain'
): number {
  switch (
    classification
  ) {
    case 'foreground':
      return IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3;

    case 'background':
      return IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3;

    case 'uncertain':
      return IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3;
  }
}

/* =========================================================
 * Weight helpers
 * ======================================================= */

function sumClassifierWeightsV3(
  weights:
    ImageGuidedPixelClassifierWeightsV3
): number {
  return Math.max(
    MINIMUM_WEIGHT_TOTAL,
    weights.originalAlpha +
      weights.rgbSimilarity +
      weights.hsvSimilarity +
      weights.labSimilarity +
      weights.localForegroundSimilarity +
      weights.backgroundRejection +
      weights.localTexture +
      weights.localContrast +
      weights.gradientStrength +
      weights.edgeContinuity +
      weights.neighborAgreement +
      weights.componentSupport +
      weights.mainComponentDistance
  );
}

/* =========================================================
 * General mathematical support
 * ======================================================= */

/**
 * Bell-shaped دعم مرن حول مركز معين.
 */
function bellSupportV3(
  value: number,
  center: number,
  width: number
): number {
  const safeValue =
    clampUnitValue(
      value
    );

  const safeCenter =
    clampUnitValue(
      center
    );

  const safeWidth =
    Math.max(
      SCORE_EPSILON,
      width
    );

  const normalizedDistance =
    (
      safeValue -
      safeCenter
    ) /
    safeWidth;

  return clampUnitValue(
    Math.exp(
      -
      normalizedDistance *
        normalizedDistance
    )
  );
}

/* =========================================================
 * Result validation
 * ======================================================= */

/**
 * التحقق من صلاحية نتيجة المصنف.
 */
export function isValidPixelClassifierResultV3(
  value: unknown
): value is ImageGuidedPixelClassifierResultV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const result =
    value as Partial<
      ImageGuidedPixelClassifierResultV3
    >;

  if (
    !isValidFloatMask(
      result.mask
    )
  ) {
    return false;
  }

  const pixelCount =
    result.mask.width *
    result.mask.height;

  if (
    !hasFloatMapLengthV3(
      result.foregroundScoreMap,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      result.backgroundScoreMap,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      result.confidenceMap,
      pixelCount
    ) ||
    !hasByteMapLengthV3(
      result.classificationMap,
      pixelCount
    )
  ) {
    return false;
  }

  if (
    !isValidNonNegativeIntegerV3(
      result.processedPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.foregroundPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.backgroundPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.uncertainPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.changedPixelCount
    )
  ) {
    return false;
  }

  if (
    result.processedPixelCount >
      pixelCount ||
    result.foregroundPixelCount +
      result.backgroundPixelCount +
      result.uncertainPixelCount !==
      result.processedPixelCount
  ) {
    return false;
  }

  if (
    typeof result.averageConfidence !==
      'number' ||
    !Number.isFinite(
      result.averageConfidence
    ) ||
    result.averageConfidence <
      0 ||
    result.averageConfidence >
      1
  ) {
    return false;
  }

  return Array.isArray(
    result.warnings
  );
}

/* =========================================================
 * Clone
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من نتيجة المصنف.
 */
export function clonePixelClassifierResultV3(
  result:
    ImageGuidedPixelClassifierResultV3
): ImageGuidedPixelClassifierResultV3 {
  if (
    !isValidPixelClassifierResultV3(
      result
    )
  ) {
    throw new Error(
      'Cannot clone an invalid ImageGuidedPixelClassifierResultV3.'
    );
  }

  return {
    mask:
      cloneFloatMask(
        result.mask
      ),

    foregroundScoreMap:
      new Float32Array(
        result
          .foregroundScoreMap
      ),

    backgroundScoreMap:
      new Float32Array(
        result
          .backgroundScoreMap
      ),

    confidenceMap:
      new Float32Array(
        result.confidenceMap
      ),

    classificationMap:
      new Uint8Array(
        result
          .classificationMap
      ),

    processedPixelCount:
      result.processedPixelCount,

    foregroundPixelCount:
      result.foregroundPixelCount,

    backgroundPixelCount:
      result.backgroundPixelCount,

    uncertainPixelCount:
      result.uncertainPixelCount,

    changedPixelCount:
      result.changedPixelCount,

    averageConfidence:
      result.averageConfidence,

    warnings:
      [...result.warnings],
  };
}

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type PixelClassifierDiagnosticsV3 = {
  width: number;

  height: number;

  pixelCount: number;

  processedPixelCount: number;

  processedPixelRatio: number;

  foregroundPixelCount: number;

  foregroundPixelRatio: number;

  backgroundPixelCount: number;

  backgroundPixelRatio: number;

  uncertainPixelCount: number;

  uncertainPixelRatio: number;

  changedPixelCount: number;

  changedPixelRatio: number;

  averageConfidence: number;

  averageForegroundScore: number;

  averageBackgroundScore: number;

  highConfidencePixelCount: number;

  lowConfidencePixelCount: number;

  estimatedMemoryBytes: number;

  warnings:
    readonly string[];
};

/**
 * إنشاء Diagnostics للمصنف.
 */
export function createPixelClassifierDiagnosticsV3(
  result:
    ImageGuidedPixelClassifierResultV3
): PixelClassifierDiagnosticsV3 {
  if (
    !isValidPixelClassifierResultV3(
      result
    )
  ) {
    throw new Error(
      'Cannot create diagnostics from an invalid pixel-classifier result.'
    );
  }

  const pixelCount =
    result.mask.width *
    result.mask.height;

  let foregroundScoreSum =
    0;

  let backgroundScoreSum =
    0;

  let highConfidencePixelCount =
    0;

  let lowConfidencePixelCount =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      result.classificationMap[
        index
      ] ===
      IMAGE_GUIDED_CLASSIFICATION_UNPROCESSED_V3
    ) {
      continue;
    }

    const foregroundScore =
      safeUnitValueV3(
        result
          .foregroundScoreMap[
            index
          ]
      );

    const backgroundScore =
      safeUnitValueV3(
        result
          .backgroundScoreMap[
            index
          ]
      );

    const confidence =
      safeUnitValueV3(
        result
          .confidenceMap[
            index
          ]
      );

    foregroundScoreSum +=
      foregroundScore;

    backgroundScoreSum +=
      backgroundScore;

    if (
      confidence >=
      0.75
    ) {
      highConfidencePixelCount +=
        1;
    }

    if (
      confidence <
      0.40
    ) {
      lowConfidencePixelCount +=
        1;
    }
  }

  const processedCount =
    result.processedPixelCount;

  const safeProcessedCount =
    Math.max(
      1,
      processedCount
    );

  return {
    width:
      result.mask.width,

    height:
      result.mask.height,

    pixelCount,

    processedPixelCount:
      processedCount,

    processedPixelRatio:
      pixelCount >
        0
        ? processedCount /
          pixelCount
        : 0,

    foregroundPixelCount:
      result.foregroundPixelCount,

    foregroundPixelRatio:
      processedCount >
        0
        ? result.foregroundPixelCount /
          processedCount
        : 0,

    backgroundPixelCount:
      result.backgroundPixelCount,

    backgroundPixelRatio:
      processedCount >
        0
        ? result.backgroundPixelCount /
          processedCount
        : 0,

    uncertainPixelCount:
      result.uncertainPixelCount,

    uncertainPixelRatio:
      processedCount >
        0
        ? result.uncertainPixelCount /
          processedCount
        : 0,

    changedPixelCount:
      result.changedPixelCount,

    changedPixelRatio:
      processedCount >
        0
        ? result.changedPixelCount /
          processedCount
        : 0,

    averageConfidence:
      result.averageConfidence,

    averageForegroundScore:
      processedCount >
        0
        ? foregroundScoreSum /
          safeProcessedCount
        : 0,

    averageBackgroundScore:
      processedCount >
        0
        ? backgroundScoreSum /
          safeProcessedCount
        : 0,

    highConfidencePixelCount,

    lowConfidencePixelCount,

    estimatedMemoryBytes:
      estimatePixelClassifierResultBytesV3(
        result
      ),

    warnings:
      [...result.warnings],
  };
}

/* =========================================================
 * Memory estimation
 * ======================================================= */

export function estimatePixelClassifierResultBytesV3(
  result:
    ImageGuidedPixelClassifierResultV3
): number {
  if (
    !isValidPixelClassifierResultV3(
      result
    )
  ) {
    return 0;
  }

  return (
    result.mask.data.byteLength +
    result.foregroundScoreMap.byteLength +
    result.backgroundScoreMap.byteLength +
    result.confidenceMap.byteLength +
    result.classificationMap.byteLength
  );
}

/* =========================================================
 * Summary
 * ======================================================= */

export function getPixelClassifierSummaryV3(
  result:
    ImageGuidedPixelClassifierResultV3
): string {
  if (
    !isValidPixelClassifierResultV3(
      result
    )
  ) {
    return (
      'ImageGuidedPixelClassifierV3: invalid result.'
    );
  }

  return [
    'ImageGuidedPixelClassifierV3',
    `${result.mask.width}x${result.mask.height}`,
    `processed=${result.processedPixelCount}`,
    `foreground=${result.foregroundPixelCount}`,
    `background=${result.backgroundPixelCount}`,
    `uncertain=${result.uncertainPixelCount}`,
    `changed=${result.changedPixelCount}`,
    `confidence=${result.averageConfidence.toFixed(4)}`,
  ].join(' | ');
}

/* =========================================================
 * Remaining helpers
 * ======================================================= */

function isValidNonNegativeIntegerV3(
  value: unknown
): value is number {
  return (
    typeof value ===
      'number' &&
    Number.isInteger(
      value
    ) &&
    value >= 0
  );
}

/* =========================================================
 * Default export
 * ======================================================= */

const ImageGuidedPixelClassifierV3 = {
  DEFAULT_WEIGHTS:
    DEFAULT_PIXEL_CLASSIFIER_WEIGHTS_V3,

  DEFAULT_CONFIG:
    DEFAULT_PIXEL_CLASSIFIER_CONFIG_V3,

  CLASSIFICATION_UNPROCESSED:
    IMAGE_GUIDED_CLASSIFICATION_UNPROCESSED_V3,

  CLASSIFICATION_FOREGROUND:
    IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3,

  CLASSIFICATION_BACKGROUND:
    IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3,

  CLASSIFICATION_UNCERTAIN:
    IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3,

  createDefaultConfig:
    createDefaultPixelClassifierConfigV3,

  resolveWeights:
    resolvePixelClassifierWeightsV3,

  resolveConfig:
    resolvePixelClassifierConfigV3,

  classify:
    classifyImageGuidedPixelsV3,

  run:
    runImageGuidedPixelClassifierV3,

  classifyPixel:
    classifyBoundaryPixelV3,

  createPixelFeatures:
    createBoundaryPixelFeaturesV3,

  calculateScoreBreakdown:
    calculatePixelScoreBreakdownV3,

  validate:
    isValidPixelClassifierResultV3,

  clone:
    clonePixelClassifierResultV3,

  createDiagnostics:
    createPixelClassifierDiagnosticsV3,

  estimateBytes:
    estimatePixelClassifierResultBytesV3,

  getSummary:
    getPixelClassifierSummaryV3,
};

export default
  ImageGuidedPixelClassifierV3;