// scan/core/ai/BoundaryFeatureExtractorV3.ts
// Part 1/2
//
// Triple N - Image-Guided Boundary Feature Extractor V3
//
// هذا الملف مسؤول عن استخراج الخصائص البصرية والهندسية
// حول حدود الماسك الناتج من EdgeSAM.
//
// الأهداف الأساسية:
//
// 1) تحديد نطاق Pixels القريبة من حدود القطعة.
// 2) حساب المسافة من حدود الماسك.
// 3) حساب المسافة من الجسم الأساسي.
// 4) حساب خصائص الإضاءة والملمس والتباين.
// 5) حساب دعم الجيران لكل Pixel.
// 6) حساب استمرارية الحافة.
// 7) إنشاء Feature Maps يعاد استخدامها في:
//    - PixelClassifierV3
//    - ConfidenceVotingV3
//    - AdaptiveEdgeRefinerV3
//
// ملاحظات الأداء:
//
// - لا يتم إنشاء Object لكل Pixel أثناء بناء الخرائط.
// - جميع الخرائط مبنية باستخدام Typed Arrays.
// - لا توجد مكتبات خارجية.
// - التصميم مناسب للتشغيل المحلي على iOS وAndroid.

import type {
    ImageGuidedAnalysisImageV3,
    ImageGuidedBoundaryFeatureConfigV3,
    ImageGuidedBoundaryFeatureMapV3,
    SegmentationFloatMask,
} from './types';

import {
    clampSegmentationValue,
    clampUnitValue,
    isValidFloatMask,
} from './types';

/* =========================================================
 * Public input and output contracts
 * ======================================================= */

/**
 * مدخلات بناء خرائط خصائص الحدود.
 */
export type BoundaryFeatureExtractorInputV3 = {
  /**
   * الصورة المحللة.
   *
   * يجب أن تكون جميع خرائطها بنفس:
   *
   * width * height
   */
  image:
    ImageGuidedAnalysisImageV3;

  /**
   * الماسك الحالي الذي سيتم تحليل حدوده.
   */
  mask:
    SegmentationFloatMask;

  /**
   * خريطة الجسم الأساسي.
   *
   * القيمة:
   *
   * 0 = خارج الجسم الأساسي.
   * 1 = داخل الجسم الأساسي.
   *
   * عند عدم إرسالها سيقوم الملف باستخراج
   * أكبر Component من الماسك داخليًا.
   */
  mainComponentMap?:
    Uint8Array | null;

  /**
   * يمكن إرسال خريطة حدود جاهزة.
   *
   * القيمة:
   *
   * 1 = Pixel حدود.
   * 0 = Pixel عادي.
   *
   * عند عدم إرسالها يتم حسابها داخليًا.
   */
  boundaryMap?:
    Uint8Array | null;

  /**
   * إعدادات جزئية اختيارية.
   */
  config?:
    Partial<
      ImageGuidedBoundaryFeatureConfigV3
    >;
};

/**
 * نتيجة بناء خرائط الحدود.
 */
export type BoundaryFeatureExtractorResultV3 = {
  featureMap:
    ImageGuidedBoundaryFeatureMapV3;

  /**
   * خريطة الجسم الأساسي المستخدمة فعليًا.
   */
  mainComponentMap:
    Uint8Array;

  /**
   * خريطة حدود الجسم المستخدمة فعليًا.
   */
  boundaryMap:
    Uint8Array;

  /**
   * الإعدادات النهائية بعد الدمج والتطبيع.
   */
  config:
    ImageGuidedBoundaryFeatureConfigV3;

  /**
   * الوقت الكلي بالمللي ثانية.
   */
  durationMs: number;

  warnings:
    readonly string[];
};

/* =========================================================
 * Internal contracts
 * ======================================================= */

type SafeBoundaryFeatureContextV3 = {
  width: number;

  height: number;

  pixelCount: number;

  image:
    ImageGuidedAnalysisImageV3;

  mask:
    SegmentationFloatMask;

  config:
    ImageGuidedBoundaryFeatureConfigV3;

  warnings:
    string[];
};

type ConnectedComponentInfoV3 = {
  id: number;

  area: number;

  touchesBorder: boolean;
};

type ConnectedComponentExtractionV3 = {
  labels:
    Int32Array;

  components:
    ConnectedComponentInfoV3[];

  largestComponentId:
    number;

  largestComponentArea:
    number;
};

type DistanceTransformWorkspaceV3 = {
  distance:
    Float32Array;

  queue:
    Int32Array;
};

/* =========================================================
 * Constants
 * ======================================================= */

const MAXIMUM_SAFE_PIXEL_COUNT =
  32_000_000;

const MAXIMUM_SAFE_RADIUS =
  64;

const MINIMUM_ALPHA_DELTA =
  0.000_001;

const DISTANCE_INFINITY =
  1_000_000_000;

const SQRT_TWO =
  Math.SQRT2;

const CARDINAL_DISTANCE =
  1;

const DIAGONAL_DISTANCE =
  SQRT_TWO;

const COMPONENT_FOREGROUND_VALUE =
  1;

const COMPONENT_BACKGROUND_VALUE =
  0;

const UNVISITED_COMPONENT_LABEL =
  -1;

const DEFAULT_COMPONENT_THRESHOLD =
  0.5;

const MAXIMUM_WARNING_COUNT =
  64;

/* =========================================================
 * Default configuration
 * ======================================================= */

/**
 * الإعدادات الافتراضية لاستخراج خصائص الحدود.
 *
 * القيم متوازنة للحفاظ على:
 *
 * - دقة الحدود.
 * - تفاصيل الأكمام والأربطة.
 * - استهلاك ذاكرة مناسب للموبايل.
 */
export const DEFAULT_BOUNDARY_FEATURE_CONFIG_V3:
  Readonly<
    ImageGuidedBoundaryFeatureConfigV3
  > = {
    /**
     * Pixel يعتبر Foreground ثابتًا
     * عند الوصول لهذه القيمة.
     */
    boundaryThreshold:
      0.5,

    /**
     * بداية المنطقة الانتقالية.
     */
    transitionMinimumAlpha:
      0.08,

    /**
     * نهاية المنطقة الانتقالية.
     */
    transitionMaximumAlpha:
      0.92,

    /**
     * عرض نطاق التحليل حول الحدود.
     */
    boundaryRadius:
      6,

    /**
     * نصف قطر تحليل الجيران.
     */
    neighborhoodRadius:
      2,

    /**
     * نصف قطر حساب الإضاءة والملمس.
     */
    textureRadius:
      2,

    /**
     * أقصى مسافة تدخل داخل نطاق التحليل.
     */
    maximumBoundaryDistance:
      12,

    /**
     * أقصى مسافة مسموحة من الجسم الأساسي.
     */
    maximumMainComponentDistance:
      24,

    /**
     * Alpha الذي يعتبر الجار عنده Foreground.
     */
    foregroundNeighborThreshold:
      0.68,

    /**
     * Alpha الذي يعتبر الجار عنده Background.
     */
    backgroundNeighborThreshold:
      0.18,

    /**
     * أقل Gradient معتبر كحافة حقيقية.
     */
    minimumEdgeStrength:
      0.06,
  };

/* =========================================================
 * Public configuration helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من الإعدادات الافتراضية.
 */
export function createDefaultBoundaryFeatureConfigV3():
  ImageGuidedBoundaryFeatureConfigV3 {
  return {
    ...DEFAULT_BOUNDARY_FEATURE_CONFIG_V3,
  };
}

/**
 * دمج إعدادات مخصصة مع القيم الافتراضية،
 * ثم تطبيع كل قيمة إلى نطاق آمن.
 */
export function resolveBoundaryFeatureConfigV3(
  config?:
    Partial<
      ImageGuidedBoundaryFeatureConfigV3
    > | null
): ImageGuidedBoundaryFeatureConfigV3 {
  const source =
    config ?? {};

  const boundaryThreshold =
    clampUnitValue(
      finiteOrFallback(
        source.boundaryThreshold,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .boundaryThreshold
      )
    );

  let transitionMinimumAlpha =
    clampUnitValue(
      finiteOrFallback(
        source.transitionMinimumAlpha,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .transitionMinimumAlpha
      )
    );

  let transitionMaximumAlpha =
    clampUnitValue(
      finiteOrFallback(
        source.transitionMaximumAlpha,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .transitionMaximumAlpha
      )
    );

  if (
    transitionMinimumAlpha >
    transitionMaximumAlpha
  ) {
    const temporary =
      transitionMinimumAlpha;

    transitionMinimumAlpha =
      transitionMaximumAlpha;

    transitionMaximumAlpha =
      temporary;
  }

  if (
    transitionMaximumAlpha -
      transitionMinimumAlpha <
    MINIMUM_ALPHA_DELTA
  ) {
    transitionMinimumAlpha =
      clampUnitValue(
        boundaryThreshold -
          0.01
      );

    transitionMaximumAlpha =
      clampUnitValue(
        boundaryThreshold +
          0.01
      );
  }

  const boundaryRadius =
    clampInteger(
      source.boundaryRadius,
      DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
        .boundaryRadius,
      1,
      MAXIMUM_SAFE_RADIUS
    );

  const neighborhoodRadius =
    clampInteger(
      source.neighborhoodRadius,
      DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
        .neighborhoodRadius,
      1,
      MAXIMUM_SAFE_RADIUS
    );

  const textureRadius =
    clampInteger(
      source.textureRadius,
      DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
        .textureRadius,
      1,
      MAXIMUM_SAFE_RADIUS
    );

  const maximumBoundaryDistance =
    clampSegmentationValue(
      finiteOrFallback(
        source.maximumBoundaryDistance,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .maximumBoundaryDistance
      ),
      1,
      1024
    );

  const maximumMainComponentDistance =
    clampSegmentationValue(
      finiteOrFallback(
        source.maximumMainComponentDistance,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .maximumMainComponentDistance
      ),
      1,
      2048
    );

  let foregroundNeighborThreshold =
    clampUnitValue(
      finiteOrFallback(
        source.foregroundNeighborThreshold,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .foregroundNeighborThreshold
      )
    );

  let backgroundNeighborThreshold =
    clampUnitValue(
      finiteOrFallback(
        source.backgroundNeighborThreshold,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .backgroundNeighborThreshold
      )
    );

  if (
    backgroundNeighborThreshold >
    foregroundNeighborThreshold
  ) {
    const midpoint =
      (
        backgroundNeighborThreshold +
        foregroundNeighborThreshold
      ) /
      2;

    backgroundNeighborThreshold =
      clampUnitValue(
        midpoint -
          0.01
      );

    foregroundNeighborThreshold =
      clampUnitValue(
        midpoint +
          0.01
      );
  }

  const minimumEdgeStrength =
    clampUnitValue(
      finiteOrFallback(
        source.minimumEdgeStrength,
        DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
          .minimumEdgeStrength
      )
    );

  return {
    boundaryThreshold,

    transitionMinimumAlpha,

    transitionMaximumAlpha,

    boundaryRadius,

    neighborhoodRadius,

    textureRadius,

    maximumBoundaryDistance,

    maximumMainComponentDistance,

    foregroundNeighborThreshold,

    backgroundNeighborThreshold,

    minimumEdgeStrength,
  };
}

/* =========================================================
 * Public validation
 * ======================================================= */

/**
 * التحقق من صلاحية صورة التحليل.
 */
export function isValidAnalysisImageV3(
  value: unknown
): value is ImageGuidedAnalysisImageV3 {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  const image =
    value as Partial<
      ImageGuidedAnalysisImageV3
    >;

  const width =
    image.width;

  const height =
    image.height;

  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    return false;
  }

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
    return false;
  }

  if (
    !(
      image.rgb instanceof
      Float32Array
    ) ||
    image.rgb.length !==
      pixelCount *
        3
  ) {
    return false;
  }

  if (
    !(
      image.gradient instanceof
      Float32Array
    ) ||
    image.gradient.length !==
      pixelCount
  ) {
    return false;
  }

  if (
    image.gradientDirection !==
      null &&
    !(
      image.gradientDirection instanceof
      Float32Array
    )
  ) {
    return false;
  }

  if (
    image.gradientDirection instanceof
      Float32Array &&
    image.gradientDirection.length !==
      pixelCount
  ) {
    return false;
  }

  if (
    !(
      image.luminance instanceof
      Float32Array
    ) ||
    image.luminance.length !==
      pixelCount
  ) {
    return false;
  }

  return true;
}

/**
 * التحقق من أن Uint8Array تمثل خريطة Pixel كاملة.
 */
export function isValidBoundaryByteMapV3(
  map: unknown,
  width: number,
  height: number
): map is Uint8Array {
  if (
    !(map instanceof Uint8Array)
  ) {
    return false;
  }

  const pixelCount =
    width *
    height;

  return (
    Number.isSafeInteger(
      pixelCount
    ) &&
    pixelCount > 0 &&
    map.length ===
      pixelCount
  );
}

/* =========================================================
 * Main public extractor
 * ======================================================= */

/**
 * استخراج جميع خرائط خصائص الحدود.
 *
 * هذه الدالة هي المدخل الرئيسي للملف.
 */
export function extractBoundaryFeatureMapV3(
  input:
    BoundaryFeatureExtractorInputV3
): BoundaryFeatureExtractorResultV3 {
  const startedAt =
    nowMs();

  const context =
    createSafeContextV3(
      input
    );

  const {
    width,
    height,
    pixelCount,
    image,
    mask,
    config,
    warnings,
  } = context;

  const suppliedMainComponentMap =
    input.mainComponentMap;

  const mainComponentMap =
    isValidBoundaryByteMapV3(
      suppliedMainComponentMap,
      width,
      height
    )
      ? normalizeBinaryMap(
          suppliedMainComponentMap
        )
      : createLargestComponentMapV3(
          mask,
          config.boundaryThreshold,
          warnings
        );

  if (
    suppliedMainComponentMap != null &&
    !isValidBoundaryByteMapV3(
      suppliedMainComponentMap,
      width,
      height
    )
  ) {
    pushWarning(
      warnings,
      'The supplied main component map was invalid and has been rebuilt.'
    );
  }

  const suppliedBoundaryMap =
    input.boundaryMap;

  const boundaryMap =
    isValidBoundaryByteMapV3(
      suppliedBoundaryMap,
      width,
      height
    )
      ? normalizeBinaryMap(
          suppliedBoundaryMap
        )
      : createMaskBoundaryMapV3(
          mask,
          config
        );

  if (
    suppliedBoundaryMap != null &&
    !isValidBoundaryByteMapV3(
      suppliedBoundaryMap,
      width,
      height
    )
  ) {
    pushWarning(
      warnings,
      'The supplied boundary map was invalid and has been rebuilt.'
    );
  }

  const boundaryWorkspace =
    createDistanceTransformWorkspaceV3(
      pixelCount
    );

  computeDistanceFromSeedsV3(
    width,
    height,
    boundaryMap,
    boundaryWorkspace,
    config.maximumBoundaryDistance
  );

  const boundaryDistance =
    boundaryWorkspace.distance;

  const mainComponentWorkspace =
    createDistanceTransformWorkspaceV3(
      pixelCount
    );

  computeDistanceFromSeedsV3(
    width,
    height,
    mainComponentMap,
    mainComponentWorkspace,
    config.maximumMainComponentDistance
  );

  const mainComponentDistance =
    mainComponentWorkspace.distance;

  const activeBoundaryMap =
    buildActiveBoundaryMapV3(
      mask,
      boundaryMap,
      boundaryDistance,
      mainComponentDistance,
      config
    );

  const localMeanLuminance =
    new Float32Array(
      pixelCount
    );

  const localVariance =
    new Float32Array(
      pixelCount
    );

  const localTexture =
    new Float32Array(
      pixelCount
    );

  const localContrast =
    new Float32Array(
      pixelCount
    );

  computeLocalLuminanceFeaturesV3(
    width,
    height,
    image.luminance,
    activeBoundaryMap,
    config.textureRadius,
    localMeanLuminance,
    localVariance,
    localTexture,
    localContrast
  );

  const foregroundNeighborRatio =
    new Float32Array(
      pixelCount
    );

  const backgroundNeighborRatio =
    new Float32Array(
      pixelCount
    );

  const uncertainNeighborRatio =
    new Float32Array(
      pixelCount
    );

  const neighborAgreement =
    new Float32Array(
      pixelCount
    );

  computeNeighborFeatureMapsV3(
    width,
    height,
    mask.data,
    activeBoundaryMap,
    config,
    foregroundNeighborRatio,
    backgroundNeighborRatio,
    uncertainNeighborRatio,
    neighborAgreement
  );

  const edgeContinuity =
    new Float32Array(
      pixelCount
    );

  computeEdgeContinuityMapV3(
    width,
    height,
    image.gradient,
    image.gradientDirection,
    activeBoundaryMap,
    config,
    edgeContinuity
  );

  const componentSupport =
    new Float32Array(
      pixelCount
    );

  computeComponentSupportMapV3(
    width,
    height,
    mainComponentMap,
    mainComponentDistance,
    foregroundNeighborRatio,
    edgeContinuity,
    activeBoundaryMap,
    config,
    componentSupport
  );

  let activePixelCount =
    0;

  let observedMaximumBoundaryDistance =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      activeBoundaryMap[index] ===
      0
    ) {
      continue;
    }

    activePixelCount +=
      1;

    const distance =
      boundaryDistance[index];

    if (
      Number.isFinite(distance) &&
      distance >
        observedMaximumBoundaryDistance
    ) {
      observedMaximumBoundaryDistance =
        distance;
    }
  }

  if (
    activePixelCount === 0
  ) {
    pushWarning(
      warnings,
      'No active boundary pixels were detected.'
    );
  }

  const featureMap:
    ImageGuidedBoundaryFeatureMapV3 = {
      width,

      height,

      activeBoundaryMap,

      boundaryDistance,

      mainComponentDistance,

      localMeanLuminance,

      localVariance,

      localTexture,

      localContrast,

      foregroundNeighborRatio,

      backgroundNeighborRatio,

      edgeContinuity,

      neighborAgreement,

      componentSupport,

      activePixelCount,

      maximumBoundaryDistance:
        observedMaximumBoundaryDistance,

      warnings:
        [...warnings],
    };

  return {
    featureMap,

    mainComponentMap,

    boundaryMap,

    config,

    durationMs:
      Math.max(
        0,
        nowMs() -
          startedAt
      ),

    warnings:
      [...warnings],
  };
}

/**
 * Alias باسم أبسط للاستخدام داخل بقية ملفات V3.
 */
export const extractBoundaryFeaturesV3 =
  extractBoundaryFeatureMapV3;

/* =========================================================
 * Context validation and preparation
 * ======================================================= */

function createSafeContextV3(
  input:
    BoundaryFeatureExtractorInputV3
): SafeBoundaryFeatureContextV3 {
  if (
    typeof input !== 'object' ||
    input === null
  ) {
    throw new Error(
      'BoundaryFeatureExtractorV3 received an invalid input object.'
    );
  }

  if (
    !isValidAnalysisImageV3(
      input.image
    )
  ) {
    throw new Error(
      'BoundaryFeatureExtractorV3 received an invalid analysis image.'
    );
  }

  if (
    !isValidFloatMask(
      input.mask
    )
  ) {
    throw new Error(
      'BoundaryFeatureExtractorV3 received an invalid float mask.'
    );
  }

  const width =
    input.image.width;

  const height =
    input.image.height;

  if (
    input.mask.width !==
      width ||
    input.mask.height !==
      height
  ) {
    throw new Error(
      [
        'BoundaryFeatureExtractorV3 image and mask sizes do not match.',
        `Image: ${width}x${height}.`,
        `Mask: ${input.mask.width}x${input.mask.height}.`,
      ].join(' ')
    );
  }

  const pixelCount =
    width *
    height;

  if (
    !Number.isSafeInteger(
      pixelCount
    ) ||
    pixelCount <= 0
  ) {
    throw new Error(
      'BoundaryFeatureExtractorV3 calculated an invalid pixel count.'
    );
  }

  if (
    pixelCount >
    MAXIMUM_SAFE_PIXEL_COUNT
  ) {
    throw new Error(
      [
        'BoundaryFeatureExtractorV3 image is too large.',
        `Pixels: ${pixelCount}.`,
        `Maximum: ${MAXIMUM_SAFE_PIXEL_COUNT}.`,
      ].join(' ')
    );
  }

  const warnings:
    string[] = [];

  const config =
    resolveBoundaryFeatureConfigV3(
      input.config
    );

  inspectInputValueRangesV3(
    input.image,
    input.mask,
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

    config,

    warnings,
  };
}

/**
 * فحص سريع للقيم بدون إنشاء نسخة من البيانات.
 *
 * لا نرفض الصورة بسبب قيمة واحدة غير منضبطة؛
 * بقية الحسابات تستخدم Clamp عند القراءة.
 */
function inspectInputValueRangesV3(
  image:
    ImageGuidedAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  warnings:
    string[]
): void {
  const pixelCount =
    image.width *
    image.height;

  const samplingStep =
    Math.max(
      1,
      Math.floor(
        pixelCount /
          4096
      )
    );

  let invalidRgb =
    0;

  let invalidLuminance =
    0;

  let invalidGradient =
    0;

  let invalidAlpha =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += samplingStep
  ) {
    const rgbIndex =
      index *
      3;

    const red =
      image.rgb[
        rgbIndex
      ];

    const green =
      image.rgb[
        rgbIndex +
          1
      ];

    const blue =
      image.rgb[
        rgbIndex +
          2
      ];

    if (
      !isFiniteUnitValue(red) ||
      !isFiniteUnitValue(green) ||
      !isFiniteUnitValue(blue)
    ) {
      invalidRgb +=
        1;
    }

    if (
      !isFiniteUnitValue(
        image.luminance[index]
      )
    ) {
      invalidLuminance +=
        1;
    }

    if (
      !isFiniteUnitValue(
        image.gradient[index]
      )
    ) {
      invalidGradient +=
        1;
    }

    if (
      !isFiniteUnitValue(
        mask.data[index]
      )
    ) {
      invalidAlpha +=
        1;
    }
  }

  if (
    invalidRgb > 0
  ) {
    pushWarning(
      warnings,
      'Some RGB values were outside the expected 0..1 range and will be clamped during feature extraction.'
    );
  }

  if (
    invalidLuminance > 0
  ) {
    pushWarning(
      warnings,
      'Some luminance values were invalid or outside the expected 0..1 range.'
    );
  }

  if (
    invalidGradient > 0
  ) {
    pushWarning(
      warnings,
      'Some gradient values were invalid or outside the expected 0..1 range.'
    );
  }

  if (
    invalidAlpha > 0
  ) {
    pushWarning(
      warnings,
      'Some mask alpha values were invalid or outside the expected 0..1 range.'
    );
  }
}

/* =========================================================
 * Boundary map extraction
 * ======================================================= */

/**
 * إنشاء خريطة Pixels الواقعة على حدود الماسك.
 *
 * يعتبر Pixel حدًا عندما:
 *
 * - يكون داخل المنطقة الانتقالية.
 * - أو يختلف تصنيفه عن أحد الجيران.
 * - أو يوجد فرق Alpha واضح مع أحد الجيران.
 */
export function createMaskBoundaryMapV3(
  mask:
    SegmentationFloatMask,
  config:
    ImageGuidedBoundaryFeatureConfigV3
): Uint8Array {
  const {
    width,
    height,
    data,
  } = mask;

  const pixelCount =
    width *
    height;

  const result =
    new Uint8Array(
      pixelCount
    );

  const threshold =
    config.boundaryThreshold;

  const minimumTransition =
    config.transitionMinimumAlpha;

  const maximumTransition =
    config.transitionMaximumAlpha;

  const alphaDifferenceThreshold =
    Math.max(
      0.025,
      Math.min(
        0.25,
        (
          maximumTransition -
          minimumTransition
        ) *
          0.35
      )
    );

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y *
      width;

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const index =
        rowOffset +
        x;

      const alpha =
        safeUnitValue(
          data[index]
        );

      if (
        alpha >=
          minimumTransition &&
        alpha <=
          maximumTransition
      ) {
        result[index] =
          1;

        continue;
      }

      const inside =
        alpha >=
        threshold;

      let boundary =
        false;

      const leftX =
        x - 1;

      const rightX =
        x + 1;

      const topY =
        y - 1;

      const bottomY =
        y + 1;

      if (
        leftX >= 0
      ) {
        const neighborAlpha =
          safeUnitValue(
            data[
              index -
                1
            ]
          );

        if (
          (
            neighborAlpha >=
            threshold
          ) !== inside ||
          Math.abs(
            alpha -
              neighborAlpha
          ) >=
            alphaDifferenceThreshold
        ) {
          boundary =
            true;
        }
      } else if (inside) {
        boundary =
          true;
      }

      if (
        !boundary &&
        rightX <
          width
      ) {
        const neighborAlpha =
          safeUnitValue(
            data[
              index +
                1
            ]
          );

        if (
          (
            neighborAlpha >=
            threshold
          ) !== inside ||
          Math.abs(
            alpha -
              neighborAlpha
          ) >=
            alphaDifferenceThreshold
        ) {
          boundary =
            true;
        }
      } else if (
        !boundary &&
        rightX >= width &&
        inside
      ) {
        boundary =
          true;
      }

      if (
        !boundary &&
        topY >= 0
      ) {
        const neighborAlpha =
          safeUnitValue(
            data[
              index -
                width
            ]
          );

        if (
          (
            neighborAlpha >=
            threshold
          ) !== inside ||
          Math.abs(
            alpha -
              neighborAlpha
          ) >=
            alphaDifferenceThreshold
        ) {
          boundary =
            true;
        }
      } else if (
        !boundary &&
        topY < 0 &&
        inside
      ) {
        boundary =
          true;
      }

      if (
        !boundary &&
        bottomY <
          height
      ) {
        const neighborAlpha =
          safeUnitValue(
            data[
              index +
                width
            ]
          );

        if (
          (
            neighborAlpha >=
            threshold
          ) !== inside ||
          Math.abs(
            alpha -
              neighborAlpha
          ) >=
            alphaDifferenceThreshold
        ) {
          boundary =
            true;
        }
      } else if (
        !boundary &&
        bottomY >=
          height &&
        inside
      ) {
        boundary =
          true;
      }

      if (boundary) {
        result[index] =
          1;
      }
    }
  }

  return result;
}

/* =========================================================
 * Main component extraction
 * ======================================================= */

/**
 * استخراج أكبر جسم متصل من الماسك.
 */
export function createLargestComponentMapV3(
  mask:
    SegmentationFloatMask,
  threshold =
    DEFAULT_COMPONENT_THRESHOLD,
  warnings:
    string[] = []
): Uint8Array {
  const safeThreshold =
    clampUnitValue(
      finiteOrFallback(
        threshold,
        DEFAULT_COMPONENT_THRESHOLD
      )
    );

  const extraction =
    extractConnectedComponentsV3(
      mask,
      safeThreshold
    );

  const pixelCount =
    mask.width *
    mask.height;

  const result =
    new Uint8Array(
      pixelCount
    );

  const largestId =
    extraction
      .largestComponentId;

  if (
    largestId <
    0
  ) {
    pushWarning(
      warnings,
      'No foreground connected component was found in the mask.'
    );

    return result;
  }

  const labels =
    extraction.labels;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      labels[index] ===
      largestId
    ) {
      result[index] =
        COMPONENT_FOREGROUND_VALUE;
    }
  }

  return result;
}

/**
 * Connected Components باستخدام Queue واحدة
 * و4-neighborhood للحفاظ على ثبات الجسم.
 */
function extractConnectedComponentsV3(
  mask:
    SegmentationFloatMask,
  threshold: number
): ConnectedComponentExtractionV3 {
  const {
    width,
    height,
    data,
  } = mask;

  const pixelCount =
    width *
    height;

  const labels =
    new Int32Array(
      pixelCount
    );

  labels.fill(
    UNVISITED_COMPONENT_LABEL
  );

  const queue =
    new Int32Array(
      pixelCount
    );

  const components:
    ConnectedComponentInfoV3[] = [];

  let componentId =
    0;

  let largestComponentId =
    -1;

  let largestComponentArea =
    0;

  for (
    let seedIndex = 0;
    seedIndex <
      pixelCount;
    seedIndex += 1
  ) {
    if (
      labels[seedIndex] !==
      UNVISITED_COMPONENT_LABEL
    ) {
      continue;
    }

    const seedAlpha =
      safeUnitValue(
        data[seedIndex]
      );

    if (
      seedAlpha <
      threshold
    ) {
      labels[seedIndex] =
        COMPONENT_BACKGROUND_VALUE -
        1;

      continue;
    }

    let queueStart =
      0;

    let queueEnd =
      0;

    queue[queueEnd] =
      seedIndex;

    queueEnd +=
      1;

    labels[seedIndex] =
      componentId;

    let area =
      0;

    let touchesBorder =
      false;

    while (
      queueStart <
      queueEnd
    ) {
      const index =
        queue[
          queueStart
        ];

      queueStart +=
        1;

      area +=
        1;

      const x =
        index %
        width;

      const y =
        Math.floor(
          index /
            width
        );

      if (
        x === 0 ||
        y === 0 ||
        x ===
          width -
            1 ||
        y ===
          height -
            1
      ) {
        touchesBorder =
          true;
      }

      if (
        x > 0
      ) {
        tryQueueComponentPixelV3(
          index -
            1,
          componentId,
          threshold,
          data,
          labels,
          queue,
          queueEnd
        ) &&
          (queueEnd +=
            1);
      }

      if (
        x + 1 <
        width
      ) {
        tryQueueComponentPixelV3(
          index +
            1,
          componentId,
          threshold,
          data,
          labels,
          queue,
          queueEnd
        ) &&
          (queueEnd +=
            1);
      }

      if (
        y > 0
      ) {
        tryQueueComponentPixelV3(
          index -
            width,
          componentId,
          threshold,
          data,
          labels,
          queue,
          queueEnd
        ) &&
          (queueEnd +=
            1);
      }

      if (
        y + 1 <
        height
      ) {
        tryQueueComponentPixelV3(
          index +
            width,
          componentId,
          threshold,
          data,
          labels,
          queue,
          queueEnd
        ) &&
          (queueEnd +=
            1);
      }
    }

    components.push({
      id:
        componentId,

      area,

      touchesBorder,
    });

    if (
      area >
      largestComponentArea
    ) {
      largestComponentArea =
        area;

      largestComponentId =
        componentId;
    }

    componentId +=
      1;
  }

  return {
    labels,

    components,

    largestComponentId,

    largestComponentArea,
  };
}

/**
 * محاولة إضافة Pixel إلى Queue الخاصة بالمكون.
 */
function tryQueueComponentPixelV3(
  index: number,
  componentId: number,
  threshold: number,
  maskData:
    Float32Array,
  labels:
    Int32Array,
  queue:
    Int32Array,
  queueWriteIndex: number
): boolean {
  if (
    labels[index] !==
    UNVISITED_COMPONENT_LABEL
  ) {
    return false;
  }

  const alpha =
    safeUnitValue(
      maskData[index]
    );

  if (
    alpha <
    threshold
  ) {
    labels[index] =
      COMPONENT_BACKGROUND_VALUE -
      1;

    return false;
  }

  labels[index] =
    componentId;

  queue[queueWriteIndex] =
    index;

  return true;
}

/* =========================================================
 * Distance transform
 * ======================================================= */

/**
 * إنشاء Workspace لخريطة المسافات.
 */
function createDistanceTransformWorkspaceV3(
  pixelCount: number
): DistanceTransformWorkspaceV3 {
  const distance =
    new Float32Array(
      pixelCount
    );

  distance.fill(
    DISTANCE_INFINITY
  );

  return {
    distance,

    queue:
      new Int32Array(
        pixelCount
      ),
  };
}

/**
 * حساب أقصر مسافة تقريبية من مجموعة Seed Pixels.
 *
 * نستخدم مرحلتين:
 *
 * 1) Multi-source BFS لتحديد المسافة الأولية.
 * 2) Chamfer refinement لإضافة دقة الاتجاهات القطرية.
 */
function computeDistanceFromSeedsV3(
  width: number,
  height: number,
  seedMap:
    Uint8Array,
  workspace:
    DistanceTransformWorkspaceV3,
  maximumDistance: number
): void {
  const pixelCount =
    width *
    height;

  const distance =
    workspace.distance;

  const queue =
    workspace.queue;

  const safeMaximumDistance =
    Math.max(
      1,
      finiteOrFallback(
        maximumDistance,
        1
      )
    );

  distance.fill(
    DISTANCE_INFINITY
  );

  let queueRead =
    0;

  let queueWrite =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      seedMap[index] !==
      0
    ) {
      distance[index] =
        0;

      queue[
        queueWrite
      ] =
        index;

      queueWrite +=
        1;
    }
  }

  if (
    queueWrite ===
    0
  ) {
    distance.fill(
      safeMaximumDistance
    );

    return;
  }

  while (
    queueRead <
    queueWrite
  ) {
    const index =
      queue[
        queueRead
      ];

    queueRead +=
      1;

    const currentDistance =
      distance[index];

    if (
      currentDistance >=
      safeMaximumDistance
    ) {
      continue;
    }

    const x =
      index %
      width;

    const y =
      Math.floor(
        index /
          width
      );

    const nextDistance =
      currentDistance +
      CARDINAL_DISTANCE;

    if (
      x > 0
    ) {
      relaxDistancePixelV3(
        index -
          1,
        nextDistance,
        distance,
        queue,
        queueWrite
      ) &&
        (queueWrite +=
          1);
    }

    if (
      x + 1 <
      width
    ) {
      relaxDistancePixelV3(
        index +
          1,
        nextDistance,
        distance,
        queue,
        queueWrite
      ) &&
        (queueWrite +=
          1);
    }

    if (
      y > 0
    ) {
      relaxDistancePixelV3(
        index -
          width,
        nextDistance,
        distance,
        queue,
        queueWrite
      ) &&
        (queueWrite +=
          1);
    }

    if (
      y + 1 <
      height
    ) {
      relaxDistancePixelV3(
        index +
          width,
        nextDistance,
        distance,
        queue,
        queueWrite
      ) &&
        (queueWrite +=
          1);
    }
  }

  refineChamferDistanceV3(
    width,
    height,
    distance,
    safeMaximumDistance
  );

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const value =
      distance[index];

    distance[index] =
      Number.isFinite(value)
        ? Math.min(
            value,
            safeMaximumDistance
          )
        : safeMaximumDistance;
  }
}

/**
 * تحديث مسافة Pixel وإضافته إلى Queue.
 */
function relaxDistancePixelV3(
  index: number,
  candidateDistance: number,
  distance:
    Float32Array,
  queue:
    Int32Array,
  queueWriteIndex: number
): boolean {
  if (
    candidateDistance >=
    distance[index]
  ) {
    return false;
  }

  distance[index] =
    candidateDistance;

  queue[
    queueWriteIndex
  ] =
    index;

  return true;
}

/**
 * تحسين المسافات باستخدام تمرير Chamfer.
 */
function refineChamferDistanceV3(
  width: number,
  height: number,
  distance:
    Float32Array,
  maximumDistance: number
): void {
  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y *
      width;

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const index =
        rowOffset +
        x;

      let best =
        distance[index];

      if (
        x > 0
      ) {
        best =
          Math.min(
            best,
            distance[
              index -
                1
            ] +
              CARDINAL_DISTANCE
          );
      }

      if (
        y > 0
      ) {
        best =
          Math.min(
            best,
            distance[
              index -
                width
            ] +
              CARDINAL_DISTANCE
          );

        if (
          x > 0
        ) {
          best =
            Math.min(
              best,
              distance[
                index -
                  width -
                  1
              ] +
                DIAGONAL_DISTANCE
            );
        }

        if (
          x + 1 <
          width
        ) {
          best =
            Math.min(
              best,
              distance[
                index -
                  width +
                  1
              ] +
                DIAGONAL_DISTANCE
            );
        }
      }

      distance[index] =
        Math.min(
          best,
          maximumDistance
        );
    }
  }

  for (
    let y =
      height -
      1;
    y >= 0;
    y -= 1
  ) {
    const rowOffset =
      y *
      width;

    for (
      let x =
        width -
        1;
      x >= 0;
      x -= 1
    ) {
      const index =
        rowOffset +
        x;

      let best =
        distance[index];

      if (
        x + 1 <
        width
      ) {
        best =
          Math.min(
            best,
            distance[
              index +
                1
            ] +
              CARDINAL_DISTANCE
          );
      }

      if (
        y + 1 <
        height
      ) {
        best =
          Math.min(
            best,
            distance[
              index +
                width
            ] +
              CARDINAL_DISTANCE
          );

        if (
          x > 0
        ) {
          best =
            Math.min(
              best,
              distance[
                index +
                  width -
                  1
              ] +
                DIAGONAL_DISTANCE
            );
        }

        if (
          x + 1 <
          width
        ) {
          best =
            Math.min(
              best,
              distance[
                index +
                  width +
                  1
              ] +
                DIAGONAL_DISTANCE
            );
        }
      }

      distance[index] =
        Math.min(
          best,
          maximumDistance
        );
    }
  }
}

/* =========================================================
 * Active boundary map
 * ======================================================= */

/**
 * بناء خريطة نطاق التحليل الفعلي.
 *
 * Pixel يدخل نطاق التحليل عندما:
 *
 * - يقع على الحدود.
 * - أو قريب من الحدود.
 * - أو داخل منطقة Alpha انتقالية.
 * - أو قريب بما يكفي من الجسم الأساسي.
 */
function buildActiveBoundaryMapV3(
  mask:
    SegmentationFloatMask,
  boundaryMap:
    Uint8Array,
  boundaryDistance:
    Float32Array,
  mainComponentDistance:
    Float32Array,
  config:
    ImageGuidedBoundaryFeatureConfigV3
): Uint8Array {
  const pixelCount =
    mask.width *
    mask.height;

  const result =
    new Uint8Array(
      pixelCount
    );

  const maximumBoundaryDistance =
    Math.min(
      config.maximumBoundaryDistance,
      Math.max(
        1,
        config.boundaryRadius
      )
    );

  const maximumMainDistance =
    config.maximumMainComponentDistance;

  const minimumTransition =
    config.transitionMinimumAlpha;

  const maximumTransition =
    config.transitionMaximumAlpha;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const alpha =
      safeUnitValue(
        mask.data[index]
      );

    const isTransition =
      alpha >=
        minimumTransition &&
      alpha <=
        maximumTransition;

    const closeToBoundary =
      boundaryDistance[index] <=
      maximumBoundaryDistance;

    const closeToMainComponent =
      mainComponentDistance[index] <=
      maximumMainDistance;

    if (
      boundaryMap[index] !==
        0 ||
      isTransition ||
      (
        closeToBoundary &&
        closeToMainComponent
      )
    ) {
      result[index] =
        1;
    }
  }

  return result;
}

/* =========================================================
 * Basic utility helpers
 * ======================================================= */

function finiteOrFallback(
  value: number | undefined,
  fallback: number
): number {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(value)
  )
    ? value
    : fallback;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const safeValue =
    finiteOrFallback(
      value,
      fallback
    );

  return Math.round(
    clampSegmentationValue(
      safeValue,
      minimum,
      maximum
    )
  );
}

function safeUnitValue(
  value: number
): number {
  return (
    Number.isFinite(value)
      ? clampUnitValue(value)
      : 0
  );
}

function isFiniteUnitValue(
  value: number
): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function normalizeBinaryMap(
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

function pushWarning(
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

function nowMs(): number {
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

// الجزء الثاني سيبدأ مباشرة من:
//
// function computeLocalLuminanceFeaturesV3(...)
//
// وسيحتوي على:
//
// - Local luminance mean.
// - Local variance.
// - Local texture.
// - Local contrast.
// - Foreground/background neighbor ratios.
// - Neighbor agreement.
// - Edge continuity.
// - Component support.
// - Pixel feature reader.
// - جميع الـExports النهائية.

/* =========================================================
 * Local luminance, variance, texture and contrast
 * ======================================================= */

/**
 * حساب الخصائص المحلية الخاصة بالإضاءة.
 *
 * يتم الحساب فقط داخل activeBoundaryMap.
 *
 * الخرائط الناتجة:
 *
 * - localMeanLuminance:
 *   متوسط الإضاءة داخل الجيران.
 *
 * - localVariance:
 *   مقدار اختلاف الإضاءة داخل المنطقة.
 *
 * - localTexture:
 *   متوسط الاختلاف بين Pixel والجيران.
 *
 * - localContrast:
 *   الفرق بين أعلى وأقل إضاءة محلية.
 */
function computeLocalLuminanceFeaturesV3(
  width: number,
  height: number,
  luminance:
    Float32Array,
  activeBoundaryMap:
    Uint8Array,
  radius: number,
  localMeanLuminance:
    Float32Array,
  localVariance:
    Float32Array,
  localTexture:
    Float32Array,
  localContrast:
    Float32Array
): void {
  const safeRadius =
    Math.max(
      1,
      Math.min(
        MAXIMUM_SAFE_RADIUS,
        Math.floor(radius)
      )
    );

  const pixelCount =
    width *
    height;

  if (
    pixelCount <= 0
  ) {
    return;
  }

  const integralWidth =
    width +
    1;

  const integralHeight =
    height +
    1;

  const integralPixelCount =
    integralWidth *
    integralHeight;

  const luminanceIntegral =
    new Float64Array(
      integralPixelCount
    );

  const squaredLuminanceIntegral =
    new Float64Array(
      integralPixelCount
    );

  buildIntegralLuminanceMapsV3(
    width,
    height,
    luminance,
    luminanceIntegral,
    squaredLuminanceIntegral
  );

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y *
      width;

    const minimumY =
      Math.max(
        0,
        y -
          safeRadius
      );

    const maximumY =
      Math.min(
        height -
          1,
        y +
          safeRadius
      );

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const index =
        rowOffset +
        x;

      if (
        activeBoundaryMap[index] ===
        0
      ) {
        continue;
      }

      const minimumX =
        Math.max(
          0,
          x -
            safeRadius
        );

      const maximumX =
        Math.min(
          width -
            1,
          x +
            safeRadius
        );

      const sampleCount =
        (
          maximumX -
          minimumX +
          1
        ) *
        (
          maximumY -
          minimumY +
          1
        );

      if (
        sampleCount <= 0
      ) {
        continue;
      }

      const sum =
        readIntegralRectangleV3(
          luminanceIntegral,
          integralWidth,
          minimumX,
          minimumY,
          maximumX,
          maximumY
        );

      const squaredSum =
        readIntegralRectangleV3(
          squaredLuminanceIntegral,
          integralWidth,
          minimumX,
          minimumY,
          maximumX,
          maximumY
        );

      const mean =
        clampUnitValue(
          sum /
            sampleCount
        );

      const rawVariance =
        (
          squaredSum /
          sampleCount
        ) -
        (
          mean *
          mean
        );

      const variance =
        clampUnitValue(
          Math.max(
            0,
            rawVariance
          )
        );

      const centerLuminance =
        safeUnitValue(
          luminance[index]
        );

      let minimumLocalLuminance =
        1;

      let maximumLocalLuminance =
        0;

      let absoluteDifferenceSum =
        0;

      let differenceSampleCount =
        0;

      for (
        let sampleY =
          minimumY;
        sampleY <=
          maximumY;
        sampleY += 1
      ) {
        const sampleRowOffset =
          sampleY *
          width;

        for (
          let sampleX =
            minimumX;
          sampleX <=
            maximumX;
          sampleX += 1
        ) {
          const sampleIndex =
            sampleRowOffset +
            sampleX;

          const value =
            safeUnitValue(
              luminance[
                sampleIndex
              ]
            );

          if (
            value <
            minimumLocalLuminance
          ) {
            minimumLocalLuminance =
              value;
          }

          if (
            value >
            maximumLocalLuminance
          ) {
            maximumLocalLuminance =
              value;
          }

          if (
            sampleIndex !==
            index
          ) {
            absoluteDifferenceSum +=
              Math.abs(
                centerLuminance -
                  value
              );

            differenceSampleCount +=
              1;
          }
        }
      }

      const texture =
        differenceSampleCount >
        0
          ? absoluteDifferenceSum /
            differenceSampleCount
          : 0;

      const contrast =
        maximumLocalLuminance -
        minimumLocalLuminance;

      localMeanLuminance[index] =
        mean;

      localVariance[index] =
        variance;

      localTexture[index] =
        clampUnitValue(
          texture
        );

      localContrast[index] =
        clampUnitValue(
          contrast
        );
    }
  }
}

/**
 * إنشاء Integral Images للإضاءة ومربع الإضاءة.
 *
 * استخدام Float64Array هنا يمنع تراكم الخطأ
 * عند الصور الكبيرة.
 */
function buildIntegralLuminanceMapsV3(
  width: number,
  height: number,
  luminance:
    Float32Array,
  luminanceIntegral:
    Float64Array,
  squaredLuminanceIntegral:
    Float64Array
): void {
  const integralWidth =
    width +
    1;

  for (
    let y = 1;
    y <= height;
    y += 1
  ) {
    let rowSum =
      0;

    let squaredRowSum =
      0;

    const sourceRowOffset =
      (
        y -
        1
      ) *
      width;

    const integralRowOffset =
      y *
      integralWidth;

    const previousIntegralRowOffset =
      (
        y -
        1
      ) *
      integralWidth;

    for (
      let x = 1;
      x <= width;
      x += 1
    ) {
      const value =
        safeUnitValue(
          luminance[
            sourceRowOffset +
              x -
              1
          ]
        );

      rowSum +=
        value;

      squaredRowSum +=
        value *
        value;

      const integralIndex =
        integralRowOffset +
        x;

      luminanceIntegral[
        integralIndex
      ] =
        luminanceIntegral[
          previousIntegralRowOffset +
            x
        ] +
        rowSum;

      squaredLuminanceIntegral[
        integralIndex
      ] =
        squaredLuminanceIntegral[
          previousIntegralRowOffset +
            x
        ] +
        squaredRowSum;
    }
  }
}

/**
 * قراءة مجموع مستطيل من Integral Image.
 */
function readIntegralRectangleV3(
  integral:
    Float64Array,
  integralWidth: number,
  minimumX: number,
  minimumY: number,
  maximumX: number,
  maximumY: number
): number {
  const left =
    minimumX;

  const top =
    minimumY;

  const right =
    maximumX +
    1;

  const bottom =
    maximumY +
    1;

  const bottomRight =
    integral[
      bottom *
        integralWidth +
        right
    ];

  const bottomLeft =
    integral[
      bottom *
        integralWidth +
        left
    ];

  const topRight =
    integral[
      top *
        integralWidth +
        right
    ];

  const topLeft =
    integral[
      top *
        integralWidth +
        left
    ];

  return (
    bottomRight -
    bottomLeft -
    topRight +
    topLeft
  );
}

/* =========================================================
 * Neighbor statistics
 * ======================================================= */

/**
 * حساب إحصائيات الجيران لكل Pixel داخل نطاق الحدود.
 *
 * الخرائط:
 *
 * foregroundNeighborRatio:
 * نسبة الجيران المصنفين كجزء من القطعة.
 *
 * backgroundNeighborRatio:
 * نسبة الجيران المصنفين كخلفية.
 *
 * uncertainNeighborRatio:
 * نسبة الجيران الواقعين في منطقة Alpha غير مؤكدة.
 *
 * neighborAgreement:
 * درجة اتفاق الجيران مع تصنيف Pixel الحالي.
 */
function computeNeighborFeatureMapsV3(
  width: number,
  height: number,
  maskData:
    Float32Array,
  activeBoundaryMap:
    Uint8Array,
  config:
    ImageGuidedBoundaryFeatureConfigV3,
  foregroundNeighborRatio:
    Float32Array,
  backgroundNeighborRatio:
    Float32Array,
  uncertainNeighborRatio:
    Float32Array,
  neighborAgreement:
    Float32Array
): void {
  const radius =
    Math.max(
      1,
      Math.min(
        MAXIMUM_SAFE_RADIUS,
        Math.floor(
          config.neighborhoodRadius
        )
      )
    );

  const foregroundThreshold =
    config.foregroundNeighborThreshold;

  const backgroundThreshold =
    config.backgroundNeighborThreshold;

  const classificationThreshold =
    config.boundaryThreshold;

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y *
      width;

    const minimumY =
      Math.max(
        0,
        y -
          radius
      );

    const maximumY =
      Math.min(
        height -
          1,
        y +
          radius
      );

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const index =
        rowOffset +
        x;

      if (
        activeBoundaryMap[index] ===
        0
      ) {
        continue;
      }

      const minimumX =
        Math.max(
          0,
          x -
            radius
        );

      const maximumX =
        Math.min(
          width -
            1,
          x +
            radius
        );

      let foregroundCount =
        0;

      let backgroundCount =
        0;

      let uncertainCount =
        0;

      let sampleCount =
        0;

      for (
        let sampleY =
          minimumY;
        sampleY <=
          maximumY;
        sampleY += 1
      ) {
        const sampleRowOffset =
          sampleY *
          width;

        for (
          let sampleX =
            minimumX;
          sampleX <=
            maximumX;
          sampleX += 1
        ) {
          const sampleIndex =
            sampleRowOffset +
            sampleX;

          if (
            sampleIndex ===
            index
          ) {
            continue;
          }

          const alpha =
            safeUnitValue(
              maskData[
                sampleIndex
              ]
            );

          sampleCount +=
            1;

          if (
            alpha >=
            foregroundThreshold
          ) {
            foregroundCount +=
              1;
          } else if (
            alpha <=
            backgroundThreshold
          ) {
            backgroundCount +=
              1;
          } else {
            uncertainCount +=
              1;
          }
        }
      }

      if (
        sampleCount <= 0
      ) {
        continue;
      }

      const foregroundRatio =
        foregroundCount /
        sampleCount;

      const backgroundRatio =
        backgroundCount /
        sampleCount;

      const uncertainRatio =
        uncertainCount /
        sampleCount;

      const currentAlpha =
        safeUnitValue(
          maskData[index]
        );

      const currentlyForeground =
        currentAlpha >=
        classificationThreshold;

      const agreement =
        currentlyForeground
          ? foregroundRatio +
            uncertainRatio *
              0.35
          : backgroundRatio +
            uncertainRatio *
              0.35;

      foregroundNeighborRatio[
        index
      ] =
        clampUnitValue(
          foregroundRatio
        );

      backgroundNeighborRatio[
        index
      ] =
        clampUnitValue(
          backgroundRatio
        );

      uncertainNeighborRatio[
        index
      ] =
        clampUnitValue(
          uncertainRatio
        );

      neighborAgreement[
        index
      ] =
        clampUnitValue(
          agreement
        );
    }
  }
}

/* =========================================================
 * Edge continuity
 * ======================================================= */

/**
 * حساب استمرارية الحافة البصرية حول كل Pixel.
 *
 * تعتمد النتيجة على:
 *
 * - قوة Gradient الحالية.
 * - قوة Gradient في الجيران.
 * - تشابه اتجاه الحافة.
 * - وجود سلسلة Edge متصلة.
 */
function computeEdgeContinuityMapV3(
  width: number,
  height: number,
  gradient:
    Float32Array,
  gradientDirection:
    Float32Array | null,
  activeBoundaryMap:
    Uint8Array,
  config:
    ImageGuidedBoundaryFeatureConfigV3,
  edgeContinuity:
    Float32Array
): void {
  const minimumStrength =
    config.minimumEdgeStrength;

  const radius =
    Math.max(
      1,
      Math.min(
        3,
        config.neighborhoodRadius
      )
    );

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowOffset =
      y *
      width;

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const index =
        rowOffset +
        x;

      if (
        activeBoundaryMap[index] ===
        0
      ) {
        continue;
      }

      const centerStrength =
        safeUnitValue(
          gradient[index]
        );

      if (
        centerStrength <
        minimumStrength
      ) {
        edgeContinuity[index] =
          centerStrength *
          0.25;

        continue;
      }

      const centerDirection =
        gradientDirection
          ? normalizeAngleRadiansV3(
              gradientDirection[index]
            )
          : 0;

      let edgeNeighborCount =
        0;

      let strongNeighborCount =
        0;

      let directionalAgreementSum =
        0;

      let strengthAgreementSum =
        0;

      let sampleCount =
        0;

      const minimumY =
        Math.max(
          0,
          y -
            radius
        );

      const maximumY =
        Math.min(
          height -
            1,
          y +
            radius
        );

      const minimumX =
        Math.max(
          0,
          x -
            radius
        );

      const maximumX =
        Math.min(
          width -
            1,
          x +
            radius
        );

      for (
        let sampleY =
          minimumY;
        sampleY <=
          maximumY;
        sampleY += 1
      ) {
        const sampleRowOffset =
          sampleY *
          width;

        for (
          let sampleX =
            minimumX;
          sampleX <=
            maximumX;
          sampleX += 1
        ) {
          const sampleIndex =
            sampleRowOffset +
            sampleX;

          if (
            sampleIndex ===
            index
          ) {
            continue;
          }

          const deltaX =
            sampleX -
            x;

          const deltaY =
            sampleY -
            y;

          const squaredDistance =
            deltaX *
              deltaX +
            deltaY *
              deltaY;

          if (
            squaredDistance >
            radius *
              radius
          ) {
            continue;
          }

          sampleCount +=
            1;

          const neighborStrength =
            safeUnitValue(
              gradient[
                sampleIndex
              ]
            );

          if (
            neighborStrength <
            minimumStrength
          ) {
            continue;
          }

          edgeNeighborCount +=
            1;

          if (
            neighborStrength >=
            centerStrength *
              0.65
          ) {
            strongNeighborCount +=
              1;
          }

          const strengthAgreement =
            1 -
            Math.min(
              1,
              Math.abs(
                centerStrength -
                  neighborStrength
              )
            );

          strengthAgreementSum +=
            strengthAgreement;

          if (
            gradientDirection
          ) {
            const neighborDirection =
              normalizeAngleRadiansV3(
                gradientDirection[
                  sampleIndex
                ]
              );

            const angleDifference =
              minimumUndirectedAngleDifferenceV3(
                centerDirection,
                neighborDirection
              );

            const directionalAgreement =
              1 -
              clampUnitValue(
                angleDifference /
                  (
                    Math.PI /
                    2
                  )
              );

            directionalAgreementSum +=
              directionalAgreement;
          } else {
            directionalAgreementSum +=
              strengthAgreement;
          }
        }
      }

      if (
        sampleCount <= 0 ||
        edgeNeighborCount <= 0
      ) {
        edgeContinuity[index] =
          centerStrength *
          0.2;

        continue;
      }

      const edgeDensity =
        edgeNeighborCount /
        sampleCount;

      const strongEdgeDensity =
        strongNeighborCount /
        edgeNeighborCount;

      const directionalAgreement =
        directionalAgreementSum /
        edgeNeighborCount;

      const strengthAgreement =
        strengthAgreementSum /
        edgeNeighborCount;

      const continuity =
        (
          centerStrength *
            0.28
        ) +
        (
          edgeDensity *
            0.22
        ) +
        (
          strongEdgeDensity *
            0.18
        ) +
        (
          directionalAgreement *
            0.22
        ) +
        (
          strengthAgreement *
            0.10
        );

      edgeContinuity[index] =
        clampUnitValue(
          continuity
        );
    }
  }
}

/**
 * تطبيع زاوية Gradient إلى 0..PI.
 *
 * اتجاه الحافة غير موجه، لذلك:
 *
 * 0 وPI يعتبران نفس الاتجاه.
 */
function normalizeAngleRadiansV3(
  angle: number
): number {
  if (
    !Number.isFinite(angle)
  ) {
    return 0;
  }

  let normalized =
    angle %
    Math.PI;

  if (
    normalized < 0
  ) {
    normalized +=
      Math.PI;
  }

  return normalized;
}

/**
 * أقل فرق بين زاويتين غير موجهتين.
 */
function minimumUndirectedAngleDifferenceV3(
  first: number,
  second: number
): number {
  const rawDifference =
    Math.abs(
      first -
      second
    );

  return Math.min(
    rawDifference,
    Math.PI -
      rawDifference
  );
}

/* =========================================================
 * Main component support
 * ======================================================= */

/**
 * حساب مدى دعم الجسم الأساسي لكل Pixel.
 *
 * النتيجة المرتفعة تعني أن Pixel:
 *
 * - داخل الجسم الأساسي أو قريب منه.
 * - محاط بجيران Foreground.
 * - يقع على Edge مستمر.
 *
 * النتيجة المنخفضة تعني أن Pixel:
 *
 * - بعيد عن الجسم.
 * - معزول.
 * - أو لا يملك دعمًا بصريًا كافيًا.
 */
function computeComponentSupportMapV3(
  width: number,
  height: number,
  mainComponentMap:
    Uint8Array,
  mainComponentDistance:
    Float32Array,
  foregroundNeighborRatio:
    Float32Array,
  edgeContinuity:
    Float32Array,
  activeBoundaryMap:
    Uint8Array,
  config:
    ImageGuidedBoundaryFeatureConfigV3,
  componentSupport:
    Float32Array
): void {
  const pixelCount =
    width *
    height;

  const maximumDistance =
    Math.max(
      1,
      config.maximumMainComponentDistance
    );

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      activeBoundaryMap[index] ===
      0
    ) {
      continue;
    }

    const insideMainComponent =
      mainComponentMap[index] !==
      0;

    const distance =
      Math.max(
        0,
        mainComponentDistance[
          index
        ]
      );

    const distanceSupport =
      insideMainComponent
        ? 1
        : 1 -
          clampUnitValue(
            distance /
              maximumDistance
          );

    const neighborSupport =
      clampUnitValue(
        foregroundNeighborRatio[
          index
        ]
      );

    const visualEdgeSupport =
      clampUnitValue(
        edgeContinuity[index]
      );

    const directComponentBonus =
      insideMainComponent
        ? 0.22
        : 0;

    const support =
      (
        distanceSupport *
          0.48
      ) +
      (
        neighborSupport *
          0.30
      ) +
      (
        visualEdgeSupport *
          0.22
      ) +
      directComponentBonus;

    componentSupport[index] =
      clampUnitValue(
        support
      );
  }
}

/* =========================================================
 * Public pixel feature snapshot
 * ======================================================= */

/**
 * نسخة خفيفة من خصائص Pixel واحدة.
 *
 * هذه النسخة مناسبة للتشخيص والاختبارات.
 *
 * لا يُنصح بإنشاء Snapshot لكل Pixels مرة واحدة،
 * لأن Feature Maps نفسها أقل استهلاكًا للذاكرة.
 */
export type BoundaryPixelFeatureSnapshotV3 = {
  index: number;

  x: number;

  y: number;

  active: boolean;

  currentAlpha: number;

  red: number;

  green: number;

  blue: number;

  luminance: number;

  gradient: number;

  gradientDirection: number | null;

  boundaryDistance: number;

  normalizedBoundaryDistance: number;

  mainComponentDistance: number;

  normalizedMainComponentDistance: number;

  localMeanLuminance: number;

  localVariance: number;

  localTexture: number;

  localContrast: number;

  foregroundNeighborRatio: number;

  backgroundNeighborRatio: number;

  uncertainNeighborRatio: number;

  neighborAgreement: number;

  edgeContinuity: number;

  componentSupport: number;
};

/**
 * قراءة جميع خصائص Pixel واحدة.
 */
export function readBoundaryPixelFeatureV3(
  image:
    ImageGuidedAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3,
  x: number,
  y: number,
  config:
    ImageGuidedBoundaryFeatureConfigV3 =
      DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
): BoundaryPixelFeatureSnapshotV3 {
  validateFeatureMapCompatibilityV3(
    image,
    mask,
    featureMap
  );

  const safeX =
    Math.round(
      clampSegmentationValue(
        x,
        0,
        image.width -
          1
      )
    );

  const safeY =
    Math.round(
      clampSegmentationValue(
        y,
        0,
        image.height -
          1
      )
    );

  const index =
    safeY *
      image.width +
    safeX;

  return readBoundaryPixelFeatureByIndexV3(
    image,
    mask,
    featureMap,
    index,
    config
  );
}

/**
 * قراءة خصائص Pixel باستخدام Index مباشر.
 */
export function readBoundaryPixelFeatureByIndexV3(
  image:
    ImageGuidedAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3,
  index: number,
  config:
    ImageGuidedBoundaryFeatureConfigV3 =
      DEFAULT_BOUNDARY_FEATURE_CONFIG_V3
): BoundaryPixelFeatureSnapshotV3 {
  validateFeatureMapCompatibilityV3(
    image,
    mask,
    featureMap
  );

  const pixelCount =
    image.width *
    image.height;

  const safeIndex =
    Math.round(
      clampSegmentationValue(
        index,
        0,
        pixelCount -
          1
      )
    );

  const x =
    safeIndex %
    image.width;

  const y =
    Math.floor(
      safeIndex /
        image.width
    );

  const rgbIndex =
    safeIndex *
    3;

  const currentAlpha =
    safeUnitValue(
      mask.data[
        safeIndex
      ]
    );

  const boundaryDistance =
    Math.max(
      0,
      finiteOrZeroV3(
        featureMap
          .boundaryDistance[
            safeIndex
          ]
      )
    );

  const mainComponentDistance =
    Math.max(
      0,
      finiteOrZeroV3(
        featureMap
          .mainComponentDistance[
            safeIndex
          ]
      )
    );

  const foregroundRatio =
    safeUnitValue(
      featureMap
        .foregroundNeighborRatio[
          safeIndex
        ]
    );

  const backgroundRatio =
    safeUnitValue(
      featureMap
        .backgroundNeighborRatio[
          safeIndex
        ]
    );

  const uncertainRatio =
    clampUnitValue(
      1 -
      foregroundRatio -
      backgroundRatio
    );

  return {
    index:
      safeIndex,

    x,

    y,

    active:
      featureMap
        .activeBoundaryMap[
          safeIndex
        ] !== 0,

    currentAlpha,

    red:
      safeUnitValue(
        image.rgb[
          rgbIndex
        ]
      ),

    green:
      safeUnitValue(
        image.rgb[
          rgbIndex +
            1
        ]
      ),

    blue:
      safeUnitValue(
        image.rgb[
          rgbIndex +
            2
        ]
      ),

    luminance:
      safeUnitValue(
        image.luminance[
          safeIndex
        ]
      ),

    gradient:
      safeUnitValue(
        image.gradient[
          safeIndex
        ]
      ),

    gradientDirection:
      image.gradientDirection
        ? normalizeAngleRadiansV3(
            image
              .gradientDirection[
                safeIndex
              ]
          )
        : null,

    boundaryDistance,

    normalizedBoundaryDistance:
      clampUnitValue(
        boundaryDistance /
          Math.max(
            1,
            config.maximumBoundaryDistance
          )
      ),

    mainComponentDistance,

    normalizedMainComponentDistance:
      clampUnitValue(
        mainComponentDistance /
          Math.max(
            1,
            config
              .maximumMainComponentDistance
          )
      ),

    localMeanLuminance:
      safeUnitValue(
        featureMap
          .localMeanLuminance[
            safeIndex
          ]
      ),

    localVariance:
      safeUnitValue(
        featureMap
          .localVariance[
            safeIndex
          ]
      ),

    localTexture:
      safeUnitValue(
        featureMap
          .localTexture[
            safeIndex
          ]
      ),

    localContrast:
      safeUnitValue(
        featureMap
          .localContrast[
            safeIndex
          ]
      ),

    foregroundNeighborRatio:
      foregroundRatio,

    backgroundNeighborRatio:
      backgroundRatio,

    uncertainNeighborRatio:
      uncertainRatio,

    neighborAgreement:
      safeUnitValue(
        featureMap
          .neighborAgreement[
            safeIndex
          ]
      ),

    edgeContinuity:
      safeUnitValue(
        featureMap
          .edgeContinuity[
            safeIndex
          ]
      ),

    componentSupport:
      safeUnitValue(
        featureMap
          .componentSupport[
            safeIndex
          ]
      ),
  };
}

/* =========================================================
 * Public active index extraction
 * ======================================================= */

/**
 * استخراج Indexes الخاصة بالـActive Boundary Pixels.
 *
 * يتم تخصيص Array بالحجم الحقيقي فقط.
 */
export function collectActiveBoundaryIndexesV3(
  featureMap:
    ImageGuidedBoundaryFeatureMapV3
): Uint32Array {
  const pixelCount =
    featureMap.width *
    featureMap.height;

  const expectedCount =
    Math.max(
      0,
      Math.min(
        pixelCount,
        Math.floor(
          featureMap.activePixelCount
        )
      )
    );

  const result =
    new Uint32Array(
      expectedCount
    );

  let writeIndex =
    0;

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
      continue;
    }

    if (
      writeIndex >=
      result.length
    ) {
      break;
    }

    result[
      writeIndex
    ] =
      index;

    writeIndex +=
      1;
  }

  if (
    writeIndex ===
    result.length
  ) {
    return result;
  }

  return result.slice(
    0,
    writeIndex
  );
}

/* =========================================================
 * Public feature-map validation
 * ======================================================= */

/**
 * التحقق من أن Feature Map صالحة.
 */
export function isValidBoundaryFeatureMapV3(
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

  if (
    !hasByteMapLengthV3(
      map.activeBoundaryMap,
      pixelCount
    )
  ) {
    return false;
  }

  if (
    !hasFloatMapLengthV3(
      map.boundaryDistance,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.mainComponentDistance,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.localMeanLuminance,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.localVariance,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.localTexture,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.localContrast,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.foregroundNeighborRatio,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.backgroundNeighborRatio,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.edgeContinuity,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.neighborAgreement,
      pixelCount
    ) ||
    !hasFloatMapLengthV3(
      map.componentSupport,
      pixelCount
    )
  ) {
    return false;
  }

  if (
    typeof map.activePixelCount !==
      'number' ||
    !Number.isFinite(
      map.activePixelCount
    ) ||
    map.activePixelCount <
      0 ||
    map.activePixelCount >
      pixelCount
  ) {
    return false;
  }

  if (
    typeof map.maximumBoundaryDistance !==
      'number' ||
    !Number.isFinite(
      map.maximumBoundaryDistance
    ) ||
    map.maximumBoundaryDistance <
      0
  ) {
    return false;
  }

  if (
    !Array.isArray(
      map.warnings
    )
  ) {
    return false;
  }

  return true;
}

/**
 * التأكد من تطابق الصورة والماسك والخرائط.
 */
function validateFeatureMapCompatibilityV3(
  image:
    ImageGuidedAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3
): void {
  if (
    !isValidAnalysisImageV3(
      image
    )
  ) {
    throw new Error(
      'Invalid ImageGuidedAnalysisImageV3.'
    );
  }

  if (
    !isValidFloatMask(
      mask
    )
  ) {
    throw new Error(
      'Invalid SegmentationFloatMask.'
    );
  }

  if (
    !isValidBoundaryFeatureMapV3(
      featureMap
    )
  ) {
    throw new Error(
      'Invalid ImageGuidedBoundaryFeatureMapV3.'
    );
  }

  if (
    image.width !==
      mask.width ||
    image.height !==
      mask.height ||
    image.width !==
      featureMap.width ||
    image.height !==
      featureMap.height
  ) {
    throw new Error(
      [
        'Boundary feature data sizes do not match.',
        `Image: ${image.width}x${image.height}.`,
        `Mask: ${mask.width}x${mask.height}.`,
        `Features: ${featureMap.width}x${featureMap.height}.`,
      ].join(' ')
    );
  }
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

/* =========================================================
 * Public feature-map clone
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من Feature Map.
 */
export function cloneBoundaryFeatureMapV3(
  featureMap:
    ImageGuidedBoundaryFeatureMapV3
): ImageGuidedBoundaryFeatureMapV3 {
  if (
    !isValidBoundaryFeatureMapV3(
      featureMap
    )
  ) {
    throw new Error(
      'Cannot clone an invalid boundary feature map.'
    );
  }

  return {
    width:
      featureMap.width,

    height:
      featureMap.height,

    activeBoundaryMap:
      new Uint8Array(
        featureMap
          .activeBoundaryMap
      ),

    boundaryDistance:
      new Float32Array(
        featureMap
          .boundaryDistance
      ),

    mainComponentDistance:
      new Float32Array(
        featureMap
          .mainComponentDistance
      ),

    localMeanLuminance:
      new Float32Array(
        featureMap
          .localMeanLuminance
      ),

    localVariance:
      new Float32Array(
        featureMap
          .localVariance
      ),

    localTexture:
      new Float32Array(
        featureMap
          .localTexture
      ),

    localContrast:
      new Float32Array(
        featureMap
          .localContrast
      ),

    foregroundNeighborRatio:
      new Float32Array(
        featureMap
          .foregroundNeighborRatio
      ),

    backgroundNeighborRatio:
      new Float32Array(
        featureMap
          .backgroundNeighborRatio
      ),

    edgeContinuity:
      new Float32Array(
        featureMap
          .edgeContinuity
      ),

    neighborAgreement:
      new Float32Array(
        featureMap
          .neighborAgreement
      ),

    componentSupport:
      new Float32Array(
        featureMap
          .componentSupport
      ),

    activePixelCount:
      featureMap.activePixelCount,

    maximumBoundaryDistance:
      featureMap
        .maximumBoundaryDistance,

    warnings:
      [...featureMap.warnings],
  };
}

/* =========================================================
 * Public memory estimation
 * ======================================================= */

/**
 * تقدير الذاكرة التي تستخدمها Feature Map.
 */
export function estimateBoundaryFeatureMapBytesV3(
  featureMap:
    ImageGuidedBoundaryFeatureMapV3
): number {
  if (
    !isValidBoundaryFeatureMapV3(
      featureMap
    )
  ) {
    return 0;
  }

  return (
    featureMap
      .activeBoundaryMap
      .byteLength +
    featureMap
      .boundaryDistance
      .byteLength +
    featureMap
      .mainComponentDistance
      .byteLength +
    featureMap
      .localMeanLuminance
      .byteLength +
    featureMap
      .localVariance
      .byteLength +
    featureMap
      .localTexture
      .byteLength +
    featureMap
      .localContrast
      .byteLength +
    featureMap
      .foregroundNeighborRatio
      .byteLength +
    featureMap
      .backgroundNeighborRatio
      .byteLength +
    featureMap
      .edgeContinuity
      .byteLength +
    featureMap
      .neighborAgreement
      .byteLength +
    featureMap
      .componentSupport
      .byteLength
  );
}

/* =========================================================
 * Public diagnostics
 * ======================================================= */

export type BoundaryFeatureDiagnosticsV3 = {
  width: number;

  height: number;

  pixelCount: number;

  activePixelCount: number;

  activePixelRatio: number;

  maximumBoundaryDistance: number;

  averageBoundaryDistance: number;

  averageMainComponentDistance: number;

  averageLocalVariance: number;

  averageLocalTexture: number;

  averageLocalContrast: number;

  averageForegroundNeighborRatio: number;

  averageBackgroundNeighborRatio: number;

  averageNeighborAgreement: number;

  averageEdgeContinuity: number;

  averageComponentSupport: number;

  estimatedMemoryBytes: number;

  warnings:
    readonly string[];
};

/**
 * إنشاء ملخص تشخيصي لخرائط الخصائص.
 */
export function createBoundaryFeatureDiagnosticsV3(
  featureMap:
    ImageGuidedBoundaryFeatureMapV3
): BoundaryFeatureDiagnosticsV3 {
  if (
    !isValidBoundaryFeatureMapV3(
      featureMap
    )
  ) {
    throw new Error(
      'Cannot create diagnostics from an invalid boundary feature map.'
    );
  }

  const pixelCount =
    featureMap.width *
    featureMap.height;

  let activeCount =
    0;

  let boundaryDistanceSum =
    0;

  let mainComponentDistanceSum =
    0;

  let varianceSum =
    0;

  let textureSum =
    0;

  let contrastSum =
    0;

  let foregroundRatioSum =
    0;

  let backgroundRatioSum =
    0;

  let neighborAgreementSum =
    0;

  let edgeContinuitySum =
    0;

  let componentSupportSum =
    0;

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
      continue;
    }

    activeCount +=
      1;

    boundaryDistanceSum +=
      finiteOrZeroV3(
        featureMap
          .boundaryDistance[
            index
          ]
      );

    mainComponentDistanceSum +=
      finiteOrZeroV3(
        featureMap
          .mainComponentDistance[
            index
          ]
      );

    varianceSum +=
      safeUnitValue(
        featureMap
          .localVariance[
            index
          ]
      );

    textureSum +=
      safeUnitValue(
        featureMap
          .localTexture[
            index
          ]
      );

    contrastSum +=
      safeUnitValue(
        featureMap
          .localContrast[
            index
          ]
      );

    foregroundRatioSum +=
      safeUnitValue(
        featureMap
          .foregroundNeighborRatio[
            index
          ]
      );

    backgroundRatioSum +=
      safeUnitValue(
        featureMap
          .backgroundNeighborRatio[
            index
          ]
      );

    neighborAgreementSum +=
      safeUnitValue(
        featureMap
          .neighborAgreement[
            index
          ]
      );

    edgeContinuitySum +=
      safeUnitValue(
        featureMap
          .edgeContinuity[
            index
          ]
      );

    componentSupportSum +=
      safeUnitValue(
        featureMap
          .componentSupport[
            index
          ]
      );
  }

  const safeActiveCount =
    Math.max(
      1,
      activeCount
    );

  return {
    width:
      featureMap.width,

    height:
      featureMap.height,

    pixelCount,

    activePixelCount:
      activeCount,

    activePixelRatio:
      pixelCount >
        0
        ? activeCount /
          pixelCount
        : 0,

    maximumBoundaryDistance:
      featureMap
        .maximumBoundaryDistance,

    averageBoundaryDistance:
      activeCount >
        0
        ? boundaryDistanceSum /
          safeActiveCount
        : 0,

    averageMainComponentDistance:
      activeCount >
        0
        ? mainComponentDistanceSum /
          safeActiveCount
        : 0,

    averageLocalVariance:
      activeCount >
        0
        ? varianceSum /
          safeActiveCount
        : 0,

    averageLocalTexture:
      activeCount >
        0
        ? textureSum /
          safeActiveCount
        : 0,

    averageLocalContrast:
      activeCount >
        0
        ? contrastSum /
          safeActiveCount
        : 0,

    averageForegroundNeighborRatio:
      activeCount >
        0
        ? foregroundRatioSum /
          safeActiveCount
        : 0,

    averageBackgroundNeighborRatio:
      activeCount >
        0
        ? backgroundRatioSum /
          safeActiveCount
        : 0,

    averageNeighborAgreement:
      activeCount >
        0
        ? neighborAgreementSum /
          safeActiveCount
        : 0,

    averageEdgeContinuity:
      activeCount >
        0
        ? edgeContinuitySum /
          safeActiveCount
        : 0,

    averageComponentSupport:
      activeCount >
        0
        ? componentSupportSum /
          safeActiveCount
        : 0,

    estimatedMemoryBytes:
      estimateBoundaryFeatureMapBytesV3(
        featureMap
      ),

    warnings:
      [...featureMap.warnings],
  };
}

/* =========================================================
 * Public normalized feature vector
 * ======================================================= */

/**
 * ترتيب القيم ثابت لأن PixelClassifierV3
 * سيعتمد عليه.
 *
 * الترتيب:
 *
 * 0  currentAlpha
 * 1  red
 * 2  green
 * 3  blue
 * 4  luminance
 * 5  gradient
 * 6  normalizedBoundaryDistance
 * 7  normalizedMainComponentDistance
 * 8  localMeanLuminance
 * 9  localVariance
 * 10 localTexture
 * 11 localContrast
 * 12 foregroundNeighborRatio
 * 13 backgroundNeighborRatio
 * 14 uncertainNeighborRatio
 * 15 neighborAgreement
 * 16 edgeContinuity
 * 17 componentSupport
 */
export const BOUNDARY_FEATURE_VECTOR_LENGTH_V3 =
  18;

/**
 * إنشاء Feature Vector ثابتة الطول.
 */
export function createBoundaryFeatureVectorV3(
  image:
    ImageGuidedAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3,
  index: number,
  config:
    ImageGuidedBoundaryFeatureConfigV3 =
      DEFAULT_BOUNDARY_FEATURE_CONFIG_V3,
  target?:
    Float32Array,
  targetOffset = 0
): Float32Array {
  const snapshot =
    readBoundaryPixelFeatureByIndexV3(
      image,
      mask,
      featureMap,
      index,
      config
    );

  const safeOffset =
    Math.max(
      0,
      Math.floor(
        targetOffset
      )
    );

  const requiredLength =
    safeOffset +
    BOUNDARY_FEATURE_VECTOR_LENGTH_V3;

  const output =
    target &&
    target.length >=
      requiredLength
      ? target
      : new Float32Array(
          requiredLength
        );

  let writeIndex =
    safeOffset;

  output[
    writeIndex
  ] =
    snapshot.currentAlpha;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.red;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.green;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.blue;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.luminance;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.gradient;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot
      .normalizedBoundaryDistance;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot
      .normalizedMainComponentDistance;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot
      .localMeanLuminance;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.localVariance;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.localTexture;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.localContrast;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot
      .foregroundNeighborRatio;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot
      .backgroundNeighborRatio;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot
      .uncertainNeighborRatio;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.neighborAgreement;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.edgeContinuity;

  writeIndex +=
    1;

  output[
    writeIndex
  ] =
    snapshot.componentSupport;

  return output;
}

/* =========================================================
 * Small helpers
 * ======================================================= */

function finiteOrZeroV3(
  value: number
): number {
  return Number.isFinite(value)
    ? value
    : 0;
}

/* =========================================================
 * Default export
 * ======================================================= */

const BoundaryFeatureExtractorV3 = {
  DEFAULT_CONFIG:
    DEFAULT_BOUNDARY_FEATURE_CONFIG_V3,

  FEATURE_VECTOR_LENGTH:
    BOUNDARY_FEATURE_VECTOR_LENGTH_V3,

  createDefaultConfig:
    createDefaultBoundaryFeatureConfigV3,

  resolveConfig:
    resolveBoundaryFeatureConfigV3,

  extract:
    extractBoundaryFeatureMapV3,

  createBoundaryMap:
    createMaskBoundaryMapV3,

  createLargestComponentMap:
    createLargestComponentMapV3,

  readPixel:
    readBoundaryPixelFeatureV3,

  readPixelByIndex:
    readBoundaryPixelFeatureByIndexV3,

  createFeatureVector:
    createBoundaryFeatureVectorV3,

  collectActiveIndexes:
    collectActiveBoundaryIndexesV3,

  validate:
    isValidBoundaryFeatureMapV3,

  clone:
    cloneBoundaryFeatureMapV3,

  estimateBytes:
    estimateBoundaryFeatureMapBytesV3,

  createDiagnostics:
    createBoundaryFeatureDiagnosticsV3,
};

export default
  BoundaryFeatureExtractorV3;