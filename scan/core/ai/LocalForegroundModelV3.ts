// scan/core/ai/LocalForegroundModelV3.ts
// Part 1/2
//
// Triple N - Local Foreground Model V3
//
// هذا الملف مسؤول عن بناء نموذج ألوان ذكي للقطعة
// ونموذج منفصل للخلفية.
//
// بدل الاعتماد على لون عام واحد للقطعة، يقوم النظام بـ:
//
// 1) اختيار Pixels داخلية موثوقة من الجسم الأساسي.
// 2) استبعاد Pixels القريبة من الحواف.
// 3) توزيع العينات على مناطق محلية داخل القطعة.
// 4) بناء Color Prototype لكل منطقة.
// 5) بناء Global Foreground Prototype.
// 6) بناء Global Background Prototype.
// 7) حساب مدى الفصل اللوني بين القطعة والخلفية.
// 8) توفير دوال مقارنة اللون للمراحل التالية.
//
// يستخدم الملف Typed Arrays ولا يعتمد على مكتبات خارجية.

import type {
    ImageGuidedAnalysisImageV3,
    ImageGuidedColorPrototypeV3,
    ImageGuidedHsvColorV3,
    ImageGuidedLabColorV3,
    ImageGuidedLocalForegroundConfigV3,
    ImageGuidedLocalForegroundModelV3,
    ImageGuidedLocalForegroundRegionV3,
    ImageGuidedRgbColorV3,
    SegmentationFloatMask,
    SegmentationMaskBounds,
} from './types';

import {
    clampSegmentationValue,
    clampUnitValue,
    isValidFloatMask,
} from './types';

/* =========================================================
 * Public contracts
 * ======================================================= */

/**
 * مدخلات بناء النموذج المحلي.
 */
export type LocalForegroundModelInputV3 = {
  /**
   * صورة التحليل.
   *
   * يجب أن تكون بنفس حجم الماسك.
   */
  image:
    ImageGuidedAnalysisImageV3;

  /**
   * الماسك الحالي.
   */
  mask:
    SegmentationFloatMask;

  /**
   * خريطة الجسم الأساسي.
   *
   * 1 = داخل الجسم الأساسي.
   * 0 = خارج الجسم الأساسي.
   */
  mainComponentMap:
    Uint8Array;

  /**
   * المسافة من حدود الماسك لكل Pixel.
   */
  boundaryDistance:
    Float32Array;

  /**
   * إعدادات اختيارية.
   */
  config?:
    Partial<
      ImageGuidedLocalForegroundConfigV3
    >;
};

/**
 * نتيجة بناء النموذج.
 */
export type LocalForegroundModelResultV3 = {
  model:
    ImageGuidedLocalForegroundModelV3;

  config:
    ImageGuidedLocalForegroundConfigV3;

  /**
   * Pixels التي استخدمت كعينات Foreground.
   */
  foregroundSampleMap:
    Uint8Array;

  /**
   * Pixels التي استخدمت كعينات Background.
   */
  backgroundSampleMap:
    Uint8Array;

  durationMs: number;

  warnings:
    readonly string[];
};

/**
 * نتيجة مقارنة لون Pixel بالنموذج.
 */
export type LocalForegroundSimilarityV3 = {
  localForegroundSimilarity: number;

  globalForegroundSimilarity: number;

  globalBackgroundSimilarity: number;

  foregroundRgbSimilarity: number;

  foregroundHsvSimilarity: number;

  foregroundLabSimilarity: number;

  backgroundRgbSimilarity: number;

  backgroundHsvSimilarity: number;

  backgroundLabSimilarity: number;

  nearestRegionId:
    number | null;

  nearestRegionDistance: number;
};

/* =========================================================
 * Internal contracts
 * ======================================================= */

type SafeLocalForegroundContextV3 = {
  width: number;

  height: number;

  pixelCount: number;

  image:
    ImageGuidedAnalysisImageV3;

  mask:
    SegmentationFloatMask;

  mainComponentMap:
    Uint8Array;

  boundaryDistance:
    Float32Array;

  config:
    ImageGuidedLocalForegroundConfigV3;

  warnings:
    string[];
};

type PixelSampleAccumulatorV3 = {
  redSum: number;

  greenSum: number;

  blueSum: number;

  luminanceSum: number;

  luminanceSquaredSum: number;

  count: number;
};

type RegionSeedV3 = {
  id: number;

  x: number;

  y: number;

  index: number;

  interiorDistance: number;
};

type RegionSampleCollectionV3 = {
  seed:
    RegionSeedV3;

  sampleIndexes:
    number[];

  bounds:
    SegmentationMaskBounds;

  averageAlpha: number;

  reliablePixelRatio: number;
};

type PrototypeDistanceV3 = {
  rgbDistance: number;

  hsvDistance: number;

  labDistance: number;

  luminanceDistance: number;

  combinedDistance: number;
};

/* =========================================================
 * Constants
 * ======================================================= */

const MAXIMUM_SAFE_PIXEL_COUNT =
  32_000_000;

const MAXIMUM_WARNING_COUNT =
  64;

const MINIMUM_SAMPLE_COUNT =
  1;

const MINIMUM_PROTOTYPE_VARIANCE =
  0.000_001;

const MINIMUM_COLOR_DISTANCE =
  0.000_001;

const DEFAULT_EMPTY_CONFIDENCE =
  0;

const BACKGROUND_BORDER_RATIO =
  0.08;

const MINIMUM_BACKGROUND_BORDER_SIZE =
  2;

const MAXIMUM_BACKGROUND_BORDER_SIZE =
  64;

const REGION_DISTANCE_EPSILON =
  0.000_001;

/* =========================================================
 * Default configuration
 * ======================================================= */

/**
 * إعدادات متوازنة للعمل على صور الملابس.
 */
export const DEFAULT_LOCAL_FOREGROUND_CONFIG_V3:
  Readonly<
    ImageGuidedLocalForegroundConfigV3
  > = {
    /**
     * Alpha الأدنى لقبول Pixel كجزء داخلي موثوق.
     */
    minimumForegroundAlpha:
      0.82,

    /**
     * Alpha الأعلى لقبول Pixel كخلفية موثوقة.
     */
    maximumBackgroundAlpha:
      0.08,

    /**
     * أقل مسافة مطلوبة من حدود الماسك.
     */
    minimumInteriorDistance:
      5,

    /**
     * عدد المناطق المحلية المستهدف.
     */
    targetRegionCount:
      8,

    /**
     * أقل عدد عينات داخل المنطقة.
     */
    minimumRegionSampleCount:
      24,

    /**
     * أقصى عدد عينات داخل المنطقة.
     */
    maximumRegionSampleCount:
      512,

    /**
     * نصف قطر المنطقة نسبة إلى أصغر بُعد.
     */
    regionRadiusRatio:
      0.09,

    /**
     * أقل فصل لوني لقبول النموذج للاستخدام.
     */
    minimumColorSeparation:
      0.08,

    /**
     * أقصى عدد عينات للنموذج العام.
     */
    maximumGlobalSamples:
      8_192,
  };

/* =========================================================
 * Configuration helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من الإعدادات الافتراضية.
 */
export function createDefaultLocalForegroundConfigV3():
  ImageGuidedLocalForegroundConfigV3 {
  return {
    ...DEFAULT_LOCAL_FOREGROUND_CONFIG_V3,
  };
}

/**
 * دمج وتطبيع الإعدادات.
 */
export function resolveLocalForegroundConfigV3(
  config?:
    Partial<
      ImageGuidedLocalForegroundConfigV3
    > | null
): ImageGuidedLocalForegroundConfigV3 {
  const source =
    config ?? {};

  const minimumForegroundAlpha =
    clampUnitValue(
      finiteOrFallbackV3(
        source.minimumForegroundAlpha,
        DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
          .minimumForegroundAlpha
      )
    );

  const maximumBackgroundAlpha =
    clampUnitValue(
      finiteOrFallbackV3(
        source.maximumBackgroundAlpha,
        DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
          .maximumBackgroundAlpha
      )
    );

  const minimumInteriorDistance =
    clampSegmentationValue(
      finiteOrFallbackV3(
        source.minimumInteriorDistance,
        DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
          .minimumInteriorDistance
      ),
      0,
      512
    );

  const targetRegionCount =
    clampIntegerV3(
      source.targetRegionCount,
      DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
        .targetRegionCount,
      1,
      64
    );

  let minimumRegionSampleCount =
    clampIntegerV3(
      source.minimumRegionSampleCount,
      DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
        .minimumRegionSampleCount,
      1,
      65_536
    );

  let maximumRegionSampleCount =
    clampIntegerV3(
      source.maximumRegionSampleCount,
      DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
        .maximumRegionSampleCount,
      1,
      262_144
    );

  if (
    minimumRegionSampleCount >
    maximumRegionSampleCount
  ) {
    const temporary =
      minimumRegionSampleCount;

    minimumRegionSampleCount =
      maximumRegionSampleCount;

    maximumRegionSampleCount =
      temporary;
  }

  const regionRadiusRatio =
    clampSegmentationValue(
      finiteOrFallbackV3(
        source.regionRadiusRatio,
        DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
          .regionRadiusRatio
      ),
      0.01,
      0.5
    );

  const minimumColorSeparation =
    clampUnitValue(
      finiteOrFallbackV3(
        source.minimumColorSeparation,
        DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
          .minimumColorSeparation
      )
    );

  const maximumGlobalSamples =
    clampIntegerV3(
      source.maximumGlobalSamples,
      DEFAULT_LOCAL_FOREGROUND_CONFIG_V3
        .maximumGlobalSamples,
      64,
      262_144
    );

  return {
    minimumForegroundAlpha,

    maximumBackgroundAlpha,

    minimumInteriorDistance,

    targetRegionCount,

    minimumRegionSampleCount,

    maximumRegionSampleCount,

    regionRadiusRatio,

    minimumColorSeparation,

    maximumGlobalSamples,
  };
}

/* =========================================================
 * Main public builder
 * ======================================================= */

/**
 * بناء نموذج Foreground محلي ونموذج Background.
 */
export function buildLocalForegroundModelV3(
  input:
    LocalForegroundModelInputV3
): LocalForegroundModelResultV3 {
  const startedAt =
    nowMsV3();

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
    mainComponentMap,
    boundaryDistance,
    config,
    warnings,
  } = context;

  const foregroundSampleMap =
    new Uint8Array(
      pixelCount
    );

  const backgroundSampleMap =
    new Uint8Array(
      pixelCount
    );

  const foregroundSampleIndexes =
    collectForegroundSamplesV3(
      context,
      foregroundSampleMap
    );

  const backgroundSampleIndexes =
    collectBackgroundSamplesV3(
      context,
      backgroundSampleMap
    );

  if (
    foregroundSampleIndexes.length ===
    0
  ) {
    pushWarningV3(
      warnings,
      'No reliable foreground samples were found.'
    );
  }

  if (
    backgroundSampleIndexes.length ===
    0
  ) {
    pushWarningV3(
      warnings,
      'No reliable background samples were found.'
    );
  }

  const globalPrototype =
    createPrototypeFromIndexesV3(
      image,
      foregroundSampleIndexes
    );

  const backgroundPrototype =
    createPrototypeFromIndexesV3(
      image,
      backgroundSampleIndexes
    );

  const componentBounds =
    calculateBinaryMapBoundsV3(
      mainComponentMap,
      width,
      height
    );

  const regionRadius =
    calculateRegionRadiusV3(
      width,
      height,
      componentBounds,
      config
    );

  const seeds =
    selectRegionSeedsV3(
      context,
      foregroundSampleIndexes,
      componentBounds,
      regionRadius
    );

  const regionCollections =
    collectRegionSamplesV3(
      context,
      seeds,
      foregroundSampleMap,
      regionRadius
    );

  const regions:
    ImageGuidedLocalForegroundRegionV3[] = [];

  for (
    const collection of
    regionCollections
  ) {
    const sampleCount =
      collection
        .sampleIndexes
        .length;

    if (
      sampleCount <
      config.minimumRegionSampleCount
    ) {
      continue;
    }

    const prototype =
      createPrototypeFromIndexesV3(
        image,
        collection.sampleIndexes
      );

    const sampleCountConfidence =
      clampUnitValue(
        sampleCount /
          Math.max(
            1,
            config.maximumRegionSampleCount
          )
      );

    const confidence =
      clampUnitValue(
        prototype.confidence *
          0.55 +
        collection.reliablePixelRatio *
          0.25 +
        collection.averageAlpha *
          0.20 +
        sampleCountConfidence *
          0.10
      );

    regions.push({
      id:
        collection.seed.id,

      centerX:
        collection.seed.x,

      centerY:
        collection.seed.y,

      radius:
        regionRadius,

      bounds:
        collection.bounds,

      prototype:
        {
          ...prototype,

          confidence,
        },

      reliablePixelRatio:
        collection.reliablePixelRatio,

      averageAlpha:
        collection.averageAlpha,

      confidence,
    });
  }

  regions.sort(
    (
      first,
      second
    ) =>
      second.confidence -
      first.confidence
  );

  const colorSeparation =
    calculatePrototypeSeparationV3(
      globalPrototype,
      backgroundPrototype
    );

  const hasForegroundSamples =
    foregroundSampleIndexes.length >
    0;

  const hasBackgroundSamples =
    backgroundSampleIndexes.length >
    0;

  const hasUsableGlobalModel =
    globalPrototype.sampleCount >=
      MINIMUM_SAMPLE_COUNT &&
    globalPrototype.confidence >
      0;

  const hasUsableBackgroundModel =
    backgroundPrototype.sampleCount >=
      MINIMUM_SAMPLE_COUNT &&
    backgroundPrototype.confidence >
      0;

  const usable =
    hasForegroundSamples &&
    hasBackgroundSamples &&
    hasUsableGlobalModel &&
    hasUsableBackgroundModel &&
    colorSeparation >=
      config.minimumColorSeparation;

  if (
    colorSeparation <
    config.minimumColorSeparation
  ) {
    pushWarningV3(
      warnings,
      [
        'Foreground and background colors are weakly separated.',
        `Observed separation: ${colorSeparation.toFixed(4)}.`,
        `Required: ${config.minimumColorSeparation.toFixed(4)}.`,
      ].join(' ')
    );
  }

  if (
    regions.length ===
    0
  ) {
    pushWarningV3(
      warnings,
      'No reliable local foreground regions were created; the global prototype will be used as fallback.'
    );
  } else if (
    regions.length <
    Math.min(
      2,
      config.targetRegionCount
    )
  ) {
    pushWarningV3(
      warnings,
      'Only a limited number of local foreground regions were created.'
    );
  }

  const model:
    ImageGuidedLocalForegroundModelV3 = {
      width,

      height,

      regions,

      globalPrototype,

      backgroundPrototype,

      foregroundSampleCount:
        foregroundSampleIndexes.length,

      backgroundSampleCount:
        backgroundSampleIndexes.length,

      colorSeparation,

      usable,

      warnings:
        [...warnings],
    };

  return {
    model,

    config,

    foregroundSampleMap,

    backgroundSampleMap,

    durationMs:
      Math.max(
        0,
        nowMsV3() -
          startedAt
      ),

    warnings:
      [...warnings],
  };
}

/**
 * Alias متوافق مع أسماء بقية مراحل V3.
 */
export const createLocalForegroundModelV3 =
  buildLocalForegroundModelV3;

/* =========================================================
 * Context validation
 * ======================================================= */

function createSafeContextV3(
  input:
    LocalForegroundModelInputV3
): SafeLocalForegroundContextV3 {
  if (
    typeof input !==
      'object' ||
    input === null
  ) {
    throw new Error(
      'LocalForegroundModelV3 received an invalid input object.'
    );
  }

  if (
    !isValidAnalysisImageV3(
      input.image
    )
  ) {
    throw new Error(
      'LocalForegroundModelV3 received an invalid analysis image.'
    );
  }

  if (
    !isValidFloatMask(
      input.mask
    )
  ) {
    throw new Error(
      'LocalForegroundModelV3 received an invalid float mask.'
    );
  }

  const {
    width,
    height,
  } = input.image;

  if (
    input.mask.width !==
      width ||
    input.mask.height !==
      height
  ) {
    throw new Error(
      [
        'LocalForegroundModelV3 image and mask sizes do not match.',
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
    pixelCount <= 0 ||
    pixelCount >
      MAXIMUM_SAFE_PIXEL_COUNT
  ) {
    throw new Error(
      `LocalForegroundModelV3 received an unsafe pixel count: ${pixelCount}.`
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
      'LocalForegroundModelV3 received an invalid main component map.'
    );
  }

  if (
    !(
      input.boundaryDistance instanceof
      Float32Array
    ) ||
    input.boundaryDistance.length !==
      pixelCount
  ) {
    throw new Error(
      'LocalForegroundModelV3 received an invalid boundary distance map.'
    );
  }

  const warnings:
    string[] = [];

  const normalizedMainComponentMap =
    normalizeBinaryMapV3(
      input.mainComponentMap
    );

  const config =
    resolveLocalForegroundConfigV3(
      input.config
    );

  if (
    config.maximumBackgroundAlpha >=
    config.minimumForegroundAlpha
  ) {
    pushWarningV3(
      warnings,
      'Background and foreground alpha thresholds overlap; ambiguous pixels will be excluded.'
    );
  }

  inspectSourceRangesV3(
    input.image,
    input.mask,
    input.boundaryDistance,
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

    mainComponentMap:
      normalizedMainComponentMap,

    boundaryDistance:
      input.boundaryDistance,

    config,

    warnings,
  };
}

/**
 * التحقق من صورة التحليل بدون الاعتماد على ملف آخر.
 */
export function isValidAnalysisImageV3(
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
    !(
      image.luminance instanceof
      Float32Array
    ) ||
    image.luminance.length !==
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

  return true;
}

/* =========================================================
 * Foreground sample collection
 * ======================================================= */

/**
 * اختيار العينات الداخلية الموثوقة من القطعة.
 */
function collectForegroundSamplesV3(
  context:
    SafeLocalForegroundContextV3,
  sampleMap:
    Uint8Array
): number[] {
  const {
    pixelCount,
    mask,
    mainComponentMap,
    boundaryDistance,
    config,
  } = context;

  const candidates:
    number[] = [];

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      mainComponentMap[index] ===
      0
    ) {
      continue;
    }

    const alpha =
      safeUnitValueV3(
        mask.data[index]
      );

    if (
      alpha <
      config.minimumForegroundAlpha
    ) {
      continue;
    }

    const distance =
      safeNonNegativeValueV3(
        boundaryDistance[index]
      );

    if (
      distance <
      config.minimumInteriorDistance
    ) {
      continue;
    }

    candidates.push(
      index
    );
  }

  const sampled =
    downsampleIndexesEvenlyV3(
      candidates,
      config.maximumGlobalSamples
    );

  for (
    const index of sampled
  ) {
    sampleMap[index] =
      1;
  }

  return sampled;
}

/* =========================================================
 * Background sample collection
 * ======================================================= */

/**
 * اختيار Background موثوق.
 *
 * الأولوية:
 *
 * 1) Pixels منخفضة Alpha خارج الجسم الأساسي.
 * 2) Pixels الموجودة قرب حدود الصورة.
 * 3) توزيع العينات على كامل الخلفية.
 */
function collectBackgroundSamplesV3(
  context:
    SafeLocalForegroundContextV3,
  sampleMap:
    Uint8Array
): number[] {
  const {
    width,
    height,
    pixelCount,
    mask,
    mainComponentMap,
    config,
  } = context;

  const borderSize =
    Math.round(
      clampSegmentationValue(
        Math.min(
          width,
          height
        ) *
          BACKGROUND_BORDER_RATIO,
        MINIMUM_BACKGROUND_BORDER_SIZE,
        MAXIMUM_BACKGROUND_BORDER_SIZE
      )
    );

  const borderCandidates:
    number[] = [];

  const generalCandidates:
    number[] = [];

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      mainComponentMap[index] !==
      0
    ) {
      continue;
    }

    const alpha =
      safeUnitValueV3(
        mask.data[index]
      );

    if (
      alpha >
      config.maximumBackgroundAlpha
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

    const nearBorder =
      x <
        borderSize ||
      y <
        borderSize ||
      x >=
        width -
          borderSize ||
      y >=
        height -
          borderSize;

    if (
      nearBorder
    ) {
      borderCandidates.push(
        index
      );
    } else {
      generalCandidates.push(
        index
      );
    }
  }

  const maximumSampleCount =
    config.maximumGlobalSamples;

  const preferredBorderCount =
    Math.min(
      borderCandidates.length,
      Math.round(
        maximumSampleCount *
          0.65
      )
    );

  const preferredGeneralCount =
    Math.max(
      0,
      maximumSampleCount -
        preferredBorderCount
    );

  const selectedBorder =
    downsampleIndexesEvenlyV3(
      borderCandidates,
      preferredBorderCount
    );

  const selectedGeneral =
    downsampleIndexesEvenlyV3(
      generalCandidates,
      preferredGeneralCount
    );

  const result =
    [
      ...selectedBorder,
      ...selectedGeneral,
    ];

  if (
    result.length <
      maximumSampleCount &&
    borderCandidates.length >
      selectedBorder.length
  ) {
    const existing =
      new Set<number>(
        result
      );

    const remainingCapacity =
      maximumSampleCount -
      result.length;

    const additional =
      downsampleIndexesEvenlyV3(
        borderCandidates.filter(
          index =>
            !existing.has(
              index
            )
        ),
        remainingCapacity
      );

    result.push(
      ...additional
    );
  }

  for (
    const index of result
  ) {
    sampleMap[index] =
      1;
  }

  return result;
}

/* =========================================================
 * Prototype construction
 * ======================================================= */

/**
 * بناء Color Prototype من مجموعة Pixels.
 */
function createPrototypeFromIndexesV3(
  image:
    ImageGuidedAnalysisImageV3,
  indexes:
    readonly number[]
): ImageGuidedColorPrototypeV3 {
  if (
    indexes.length ===
    0
  ) {
    return createEmptyColorPrototypeV3();
  }

  const accumulator =
    createEmptyAccumulatorV3();

  for (
    const index of indexes
  ) {
    const rgbIndex =
      index *
      3;

    const red =
      safeUnitValueV3(
        image.rgb[
          rgbIndex
        ]
      );

    const green =
      safeUnitValueV3(
        image.rgb[
          rgbIndex +
            1
        ]
      );

    const blue =
      safeUnitValueV3(
        image.rgb[
          rgbIndex +
            2
        ]
      );

    const luminance =
      safeUnitValueV3(
        image.luminance[
          index
        ]
      );

    accumulator.redSum +=
      red;

    accumulator.greenSum +=
      green;

    accumulator.blueSum +=
      blue;

    accumulator.luminanceSum +=
      luminance;

    accumulator.luminanceSquaredSum +=
      luminance *
      luminance;

    accumulator.count +=
      1;
  }

  const sampleCount =
    accumulator.count;

  if (
    sampleCount <= 0
  ) {
    return createEmptyColorPrototypeV3();
  }

  const rgb:
    ImageGuidedRgbColorV3 = {
      r:
        clampUnitValue(
          accumulator.redSum /
            sampleCount
        ),

      g:
        clampUnitValue(
          accumulator.greenSum /
            sampleCount
        ),

      b:
        clampUnitValue(
          accumulator.blueSum /
            sampleCount
        ),
    };

  const luminance =
    clampUnitValue(
      accumulator.luminanceSum /
        sampleCount
    );

  const averageSquaredLuminance =
    accumulator.luminanceSquaredSum /
    sampleCount;

  const variance =
    Math.max(
      0,
      averageSquaredLuminance -
        luminance *
          luminance
    );

  const hsv =
    rgbToHsvV3(
      rgb
    );

  const lab =
    rgbToLabV3(
      rgb
    );

  const sampleConfidence =
    clampUnitValue(
      Math.log2(
        sampleCount +
          1
      ) /
        12
    );

  const consistencyConfidence =
    clampUnitValue(
      1 -
      Math.sqrt(
        Math.max(
          MINIMUM_PROTOTYPE_VARIANCE,
          variance
        )
      )
    );

  const confidence =
    clampUnitValue(
      sampleConfidence *
        0.55 +
      consistencyConfidence *
        0.45
    );

  return {
    rgb,

    hsv,

    lab,

    luminance,

    variance:
      clampUnitValue(
        variance
      ),

    sampleCount,

    confidence,
  };
}

/**
 * Prototype فارغ آمن.
 */
export function createEmptyColorPrototypeV3():
  ImageGuidedColorPrototypeV3 {
  return {
    rgb: {
      r: 0,

      g: 0,

      b: 0,
    },

    hsv: {
      h: 0,

      s: 0,

      v: 0,
    },

    lab: {
      l: 0,

      a: 0,

      b: 0,
    },

    luminance:
      0,

    variance:
      0,

    sampleCount:
      0,

    confidence:
      DEFAULT_EMPTY_CONFIDENCE,
  };
}

function createEmptyAccumulatorV3():
  PixelSampleAccumulatorV3 {
  return {
    redSum:
      0,

    greenSum:
      0,

    blueSum:
      0,

    luminanceSum:
      0,

    luminanceSquaredSum:
      0,

    count:
      0,
  };
}

/* =========================================================
 * Region seed selection
 * ======================================================= */

/**
 * اختيار مراكز موزعة داخل الجسم الأساسي.
 *
 * أول Seed هي أعمق Pixel داخل الجسم.
 *
 * باقي Seeds تختار Pixel تحقق توازنًا بين:
 *
 * - البعد عن Seeds السابقة.
 * - البعد عن حدود الماسك.
 * - Alpha المرتفع.
 */
function selectRegionSeedsV3(
  context:
    SafeLocalForegroundContextV3,
  foregroundSampleIndexes:
    readonly number[],
  componentBounds:
    SegmentationMaskBounds,
  regionRadius: number
): RegionSeedV3[] {
  const {
    width,
    mask,
    boundaryDistance,
    config,
  } = context;

  if (
    foregroundSampleIndexes.length ===
    0
  ) {
    return [];
  }

  const targetCount =
    Math.min(
      config.targetRegionCount,
      foregroundSampleIndexes.length
    );

  let deepestIndex =
    foregroundSampleIndexes[0];

  let deepestDistance =
    safeNonNegativeValueV3(
      boundaryDistance[
        deepestIndex
      ]
    );

  for (
    let samplePosition = 1;
    samplePosition <
      foregroundSampleIndexes.length;
    samplePosition += 1
  ) {
    const index =
      foregroundSampleIndexes[
        samplePosition
      ];

    const distance =
      safeNonNegativeValueV3(
        boundaryDistance[index]
      );

    if (
      distance >
      deepestDistance
    ) {
      deepestDistance =
        distance;

      deepestIndex =
        index;
    }
  }

  const seeds:
    RegionSeedV3[] = [
      createRegionSeedV3(
        0,
        deepestIndex,
        width,
        deepestDistance
      ),
    ];

  const minimumSeedDistance =
    Math.max(
      2,
      regionRadius *
        0.75
    );

  while (
    seeds.length <
    targetCount
  ) {
    let bestIndex =
      -1;

    let bestInteriorDistance =
      0;

    let bestScore =
      -Infinity;

    for (
      const candidateIndex of
      foregroundSampleIndexes
    ) {
      const candidateX =
        candidateIndex %
        width;

      const candidateY =
        Math.floor(
          candidateIndex /
            width
        );

      const candidateInteriorDistance =
        safeNonNegativeValueV3(
          boundaryDistance[
            candidateIndex
          ]
        );

      let nearestSeedDistance =
        Infinity;

      for (
        const seed of seeds
      ) {
        const deltaX =
          candidateX -
          seed.x;

        const deltaY =
          candidateY -
          seed.y;

        const distance =
          Math.sqrt(
            deltaX *
              deltaX +
            deltaY *
              deltaY
          );

        if (
          distance <
          nearestSeedDistance
        ) {
          nearestSeedDistance =
            distance;
        }
      }

      if (
        nearestSeedDistance <
        minimumSeedDistance
      ) {
        continue;
      }

      const alpha =
        safeUnitValueV3(
          mask.data[
            candidateIndex
          ]
        );

      const normalizedSpacing =
        clampUnitValue(
          nearestSeedDistance /
            Math.max(
              1,
              Math.sqrt(
                componentBounds.width *
                  componentBounds.width +
                componentBounds.height *
                  componentBounds.height
              )
            )
        );

      const normalizedInterior =
        clampUnitValue(
          candidateInteriorDistance /
            Math.max(
              1,
              regionRadius *
                2
            )
        );

      const score =
        normalizedSpacing *
          0.58 +
        normalizedInterior *
          0.30 +
        alpha *
          0.12;

      if (
        score >
        bestScore
      ) {
        bestScore =
          score;

        bestIndex =
          candidateIndex;

        bestInteriorDistance =
          candidateInteriorDistance;
      }
    }

    if (
      bestIndex <
      0
    ) {
      break;
    }

    seeds.push(
      createRegionSeedV3(
        seeds.length,
        bestIndex,
        width,
        bestInteriorDistance
      )
    );
  }

  return seeds;
}

function createRegionSeedV3(
  id: number,
  index: number,
  width: number,
  interiorDistance: number
): RegionSeedV3 {
  return {
    id,

    x:
      index %
      width,

    y:
      Math.floor(
        index /
          width
      ),

    index,

    interiorDistance,
  };
}

/* =========================================================
 * Region sample collection
 * ======================================================= */

/**
 * جمع عينات كل Region حول Seed الخاصة بها.
 */
function collectRegionSamplesV3(
  context:
    SafeLocalForegroundContextV3,
  seeds:
    readonly RegionSeedV3[],
  foregroundSampleMap:
    Uint8Array,
  regionRadius: number
): RegionSampleCollectionV3[] {
  const {
    width,
    height,
    mask,
    boundaryDistance,
    config,
  } = context;

  const collections:
    RegionSampleCollectionV3[] = [];

  const radiusSquared =
    regionRadius *
    regionRadius;

  for (
    const seed of seeds
  ) {
    const minimumX =
      Math.max(
        0,
        Math.floor(
          seed.x -
            regionRadius
        )
      );

    const maximumX =
      Math.min(
        width -
          1,
        Math.ceil(
          seed.x +
            regionRadius
        )
      );

    const minimumY =
      Math.max(
        0,
        Math.floor(
          seed.y -
            regionRadius
        )
      );

    const maximumY =
      Math.min(
        height -
          1,
        Math.ceil(
          seed.y +
            regionRadius
        )
      );

    const candidates:
      number[] = [];

    let reliableCount =
      0;

    let alphaSum =
      0;

    let consideredPixelCount =
      0;

    for (
      let y = minimumY;
      y <= maximumY;
      y += 1
    ) {
      const rowOffset =
        y *
        width;

      for (
        let x = minimumX;
        x <= maximumX;
        x += 1
      ) {
        const deltaX =
          x -
          seed.x;

        const deltaY =
          y -
          seed.y;

        const squaredDistance =
          deltaX *
            deltaX +
          deltaY *
            deltaY;

        if (
          squaredDistance >
          radiusSquared
        ) {
          continue;
        }

        const index =
          rowOffset +
          x;

        consideredPixelCount +=
          1;

        const alpha =
          safeUnitValueV3(
            mask.data[index]
          );

        alphaSum +=
          alpha;

        const reliable =
          foregroundSampleMap[index] !==
            0 &&
          alpha >=
            config.minimumForegroundAlpha &&
          safeNonNegativeValueV3(
            boundaryDistance[index]
          ) >=
            config.minimumInteriorDistance;

        if (
          !reliable
        ) {
          continue;
        }

        reliableCount +=
          1;

        candidates.push(
          index
        );
      }
    }

    const sampleIndexes =
      downsampleIndexesEvenlyV3(
        candidates,
        config.maximumRegionSampleCount
      );

    const reliablePixelRatio =
      consideredPixelCount >
        0
        ? reliableCount /
          consideredPixelCount
        : 0;

    const averageAlpha =
      consideredPixelCount >
        0
        ? alphaSum /
          consideredPixelCount
        : 0;

    collections.push({
      seed,

      sampleIndexes,

     bounds: {
  x:
    minimumX,

  y:
    minimumY,

  width:
    maximumX -
    minimumX +
    1,

  height:
    maximumY -
    minimumY +
    1,

  x2:
    maximumX,

  y2:
    maximumY,

  area:
    (
      maximumX -
      minimumX +
      1
    ) *
    (
      maximumY -
      minimumY +
      1
    ),

  areaRatio:
    (
      (
        maximumX -
        minimumX +
        1
      ) *
      (
        maximumY -
        minimumY +
        1
      )
    ) /
    Math.max(
      1,
      width *
        height
    ),
},

      averageAlpha:
        clampUnitValue(
          averageAlpha
        ),

      reliablePixelRatio:
        clampUnitValue(
          reliablePixelRatio
        ),
    });
  }

  return collections;
}

/* =========================================================
 * Bounds and radius helpers
 * ======================================================= */

function calculateBinaryMapBoundsV3(
  map:
    Uint8Array,
  width: number,
  height: number
): SegmentationMaskBounds {
  let minimumX =
    width;

  let minimumY =
    height;

  let maximumX =
    -1;

  let maximumY =
    -1;

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
        map[index] ===
        0
      ) {
        continue;
      }

      if (
        x <
        minimumX
      ) {
        minimumX =
          x;
      }

      if (
        x >
        maximumX
      ) {
        maximumX =
          x;
      }

      if (
        y <
        minimumY
      ) {
        minimumY =
          y;
      }

      if (
        y >
        maximumY
      ) {
        maximumY =
          y;
      }
    }
  }

  if (
    maximumX <
      minimumX ||
    maximumY <
      minimumY
  ) {
   return {
  x:
    0,

  y:
    0,

  width,

  height,

  x2:
    Math.max(
      0,
      width -
        1
    ),

  y2:
    Math.max(
      0,
      height -
        1
    ),

  area:
    width *
    height,

  areaRatio:
    1,
};
  }

 const boundsWidth =
  maximumX -
  minimumX +
  1;

const boundsHeight =
  maximumY -
  minimumY +
  1;

const boundsArea =
  boundsWidth *
  boundsHeight;

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

  area:
    boundsArea,

  areaRatio:
    boundsArea /
    Math.max(
      1,
      width *
        height
    ),
};

}

function calculateRegionRadiusV3(
  imageWidth: number,
  imageHeight: number,
  bounds:
    SegmentationMaskBounds,
  config:
    ImageGuidedLocalForegroundConfigV3
): number {
  const meaningfulWidth =
    Math.max(
      1,
      Math.min(
        imageWidth,
        bounds.width
      )
    );

  const meaningfulHeight =
    Math.max(
      1,
      Math.min(
        imageHeight,
        bounds.height
      )
    );

  const minimumDimension =
    Math.min(
      meaningfulWidth,
      meaningfulHeight
    );

  return Math.max(
    2,
    Math.round(
      minimumDimension *
        config.regionRadiusRatio
    )
  );
}

/* =========================================================
 * Colour conversion
 * ======================================================= */

/**
 * تحويل RGB إلى HSV.
 */
export function rgbToHsvV3(
  rgb:
    ImageGuidedRgbColorV3
): ImageGuidedHsvColorV3 {
  const red =
    safeUnitValueV3(
      rgb.r
    );

  const green =
    safeUnitValueV3(
      rgb.g
    );

  const blue =
    safeUnitValueV3(
      rgb.b
    );

  const maximum =
    Math.max(
      red,
      green,
      blue
    );

  const minimum =
    Math.min(
      red,
      green,
      blue
    );

  const delta =
    maximum -
    minimum;

  let hue =
    0;

  if (
    delta >
    MINIMUM_COLOR_DISTANCE
  ) {
    if (
      maximum === red
    ) {
      hue =
        (
          (
            green -
            blue
          ) /
          delta
        ) %
        6;
    } else if (
      maximum === green
    ) {
      hue =
        (
          blue -
          red
        ) /
          delta +
        2;
    } else {
      hue =
        (
          red -
          green
        ) /
          delta +
        4;
    }

    hue /=
      6;

    if (
      hue < 0
    ) {
      hue +=
        1;
    }
  }

  const saturation =
    maximum <=
    MINIMUM_COLOR_DISTANCE
      ? 0
      : delta /
        maximum;

  return {
    h:
      clampUnitValue(
        hue
      ),

    s:
      clampUnitValue(
        saturation
      ),

    v:
      clampUnitValue(
        maximum
      ),
  };
}

/**
 * تحويل RGB من sRGB إلى Lab موحّد تقريبًا.
 */
export function rgbToLabV3(
  rgb:
    ImageGuidedRgbColorV3
): ImageGuidedLabColorV3 {
  const linearRed =
    srgbChannelToLinearV3(
      safeUnitValueV3(
        rgb.r
      )
    );

  const linearGreen =
    srgbChannelToLinearV3(
      safeUnitValueV3(
        rgb.g
      )
    );

  const linearBlue =
    srgbChannelToLinearV3(
      safeUnitValueV3(
        rgb.b
      )
    );

  const x =
    linearRed *
      0.4124564 +
    linearGreen *
      0.3575761 +
    linearBlue *
      0.1804375;

  const y =
    linearRed *
      0.2126729 +
    linearGreen *
      0.7151522 +
    linearBlue *
      0.072175;

  const z =
    linearRed *
      0.0193339 +
    linearGreen *
      0.119192 +
    linearBlue *
      0.9503041;

  const normalizedX =
    x /
    0.95047;

  const normalizedY =
    y /
    1;

  const normalizedZ =
    z /
    1.08883;

  const transformedX =
    labPivotV3(
      normalizedX
    );

  const transformedY =
    labPivotV3(
      normalizedY
    );

  const transformedZ =
    labPivotV3(
      normalizedZ
    );

  const standardL =
    116 *
      transformedY -
    16;

  const standardA =
    500 *
    (
      transformedX -
      transformedY
    );

  const standardB =
    200 *
    (
      transformedY -
      transformedZ
    );

  return {
    l:
      clampUnitValue(
        standardL /
          100
      ),

    a:
      clampSegmentationValue(
        standardA /
          128,
        -1,
        1
      ),

    b:
      clampSegmentationValue(
        standardB /
          128,
        -1,
        1
      ),
  };
}

function srgbChannelToLinearV3(
  value: number
): number {
  return value <=
    0.04045
    ? value /
      12.92
    : Math.pow(
        (
          value +
          0.055
        ) /
          1.055,
        2.4
      );
}

function labPivotV3(
  value: number
): number {
  const epsilon =
    216 /
    24_389;

  const kappa =
    24_389 /
    27;

  return value >
    epsilon
    ? Math.cbrt(
        value
      )
    : (
        kappa *
          value +
        16
      ) /
      116;
}

/* =========================================================
 * Prototype distance and separation
 * ======================================================= */

/**
 * حساب المسافة بين نموذجين.
 */
function calculatePrototypeDistanceV3(
  first:
    ImageGuidedColorPrototypeV3,
  second:
    ImageGuidedColorPrototypeV3
): PrototypeDistanceV3 {
  const rgbDistance =
    calculateRgbDistanceV3(
      first.rgb,
      second.rgb
    );

  const hsvDistance =
    calculateHsvDistanceV3(
      first.hsv,
      second.hsv
    );

  const labDistance =
    calculateLabDistanceV3(
      first.lab,
      second.lab
    );

  const luminanceDistance =
    Math.abs(
      first.luminance -
      second.luminance
    );

  const combinedDistance =
    clampUnitValue(
      rgbDistance *
        0.24 +
      hsvDistance *
        0.20 +
      labDistance *
        0.42 +
      luminanceDistance *
        0.14
    );

  return {
    rgbDistance,

    hsvDistance,

    labDistance,

    luminanceDistance,

    combinedDistance,
  };
}

/**
 * فصل Foreground عن Background.
 */
export function calculatePrototypeSeparationV3(
  foreground:
    ImageGuidedColorPrototypeV3,
  background:
    ImageGuidedColorPrototypeV3
): number {
  if (
    foreground.sampleCount <=
      0 ||
    background.sampleCount <=
      0
  ) {
    return 0;
  }

  const distance =
    calculatePrototypeDistanceV3(
      foreground,
      background
    );

  const confidenceFactor =
    Math.sqrt(
      clampUnitValue(
        foreground.confidence
      ) *
      clampUnitValue(
        background.confidence
      )
    );

  return clampUnitValue(
    distance.combinedDistance *
      (
        0.70 +
        confidenceFactor *
          0.30
      )
  );
}

/* =========================================================
 * Source inspection
 * ======================================================= */

function inspectSourceRangesV3(
  image:
    ImageGuidedAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  boundaryDistance:
    Float32Array,
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

  let invalidRgbCount =
    0;

  let invalidAlphaCount =
    0;

  let invalidDistanceCount =
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
      )
    ) {
      invalidRgbCount +=
        1;
    }

    if (
      !isFiniteUnitValueV3(
        mask.data[index]
      )
    ) {
      invalidAlphaCount +=
        1;
    }

    if (
      !Number.isFinite(
        boundaryDistance[
          index
        ]
      ) ||
      boundaryDistance[index] <
        0
    ) {
      invalidDistanceCount +=
        1;
    }
  }

  if (
    invalidRgbCount >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some RGB values were invalid or outside the expected 0..1 range.'
    );
  }

  if (
    invalidAlphaCount >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some mask alpha values were invalid or outside the expected 0..1 range.'
    );
  }

  if (
    invalidDistanceCount >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some boundary-distance values were invalid and will be treated as zero.'
    );
  }
}

/* =========================================================
 * General helpers
 * ======================================================= */

function downsampleIndexesEvenlyV3(
  source:
    readonly number[],
  maximumCount: number
): number[] {
  const safeMaximumCount =
    Math.max(
      0,
      Math.floor(
        maximumCount
      )
    );

  if (
    safeMaximumCount ===
    0 ||
    source.length ===
      0
  ) {
    return [];
  }

  if (
    source.length <=
    safeMaximumCount
  ) {
    return [
      ...source,
    ];
  }

  const result:
    number[] = [];

  const step =
    source.length /
    safeMaximumCount;

  let cursor =
    0;

  for (
    let outputIndex = 0;
    outputIndex <
      safeMaximumCount;
    outputIndex += 1
  ) {
    const sourceIndex =
      Math.min(
        source.length -
          1,
        Math.floor(
          cursor
        )
      );

    result.push(
      source[
        sourceIndex
      ]
    );

    cursor +=
      step;
  }

  return result;
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

function finiteOrFallbackV3(
  value:
    number | undefined,
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

function clampIntegerV3(
  value:
    number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Math.round(
    clampSegmentationValue(
      finiteOrFallbackV3(
        value,
        fallback
      ),
      minimum,
      maximum
    )
  );
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

function isFiniteUnitValueV3(
  value: number
): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
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
// export function calculateRgbDistanceV3(...)
//
// ويحتوي على:
//
// - RGB / HSV / Lab distance.
// - RGB / HSV / Lab similarity.
// - مقارنة Pixel بالنموذج المحلي.
// - اختيار أقرب Region.
// - دمج تشابه المناطق.
// - التحقق من صلاحية النموذج.
// - Clone وDiagnostics.
// - Default export.
/* =========================================================
 * RGB / HSV / Lab distance
 * ======================================================= */

/**
 * حساب المسافة الموحّدة بين لونين RGB.
 *
 * النتيجة من 0 إلى 1:
 *
 * 0 = اللونان متطابقان.
 * 1 = أقصى اختلاف تقريبي.
 */
export function calculateRgbDistanceV3(
  first:
    ImageGuidedRgbColorV3,
  second:
    ImageGuidedRgbColorV3
): number {
  const redDifference =
    safeUnitValueV3(
      first.r
    ) -
    safeUnitValueV3(
      second.r
    );

  const greenDifference =
    safeUnitValueV3(
      first.g
    ) -
    safeUnitValueV3(
      second.g
    );

  const blueDifference =
    safeUnitValueV3(
      first.b
    ) -
    safeUnitValueV3(
      second.b
    );

  const euclideanDistance =
    Math.sqrt(
      redDifference *
        redDifference +
      greenDifference *
        greenDifference +
      blueDifference *
        blueDifference
    );

  return clampUnitValue(
    euclideanDistance /
      Math.sqrt(3)
  );
}

/**
 * حساب المسافة بين لونين HSV.
 *
 * Hue دائري، لذلك الفرق بين 0 و1 يساوي صفر تقريبًا.
 */
export function calculateHsvDistanceV3(
  first:
    ImageGuidedHsvColorV3,
  second:
    ImageGuidedHsvColorV3
): number {
  const firstHue =
    normalizeHueV3(
      first.h
    );

  const secondHue =
    normalizeHueV3(
      second.h
    );

  const rawHueDifference =
    Math.abs(
      firstHue -
      secondHue
    );

  const hueDifference =
    Math.min(
      rawHueDifference,
      1 -
        rawHueDifference
    ) *
    2;

  const saturationDifference =
    Math.abs(
      safeUnitValueV3(
        first.s
      ) -
      safeUnitValueV3(
        second.s
      )
    );

  const valueDifference =
    Math.abs(
      safeUnitValueV3(
        first.v
      ) -
      safeUnitValueV3(
        second.v
      )
    );

  const averageSaturation =
    (
      safeUnitValueV3(
        first.s
      ) +
      safeUnitValueV3(
        second.s
      )
    ) /
    2;

  /**
   * عند الألوان شديدة الانخفاض في التشبع،
   * Hue لا يكون موثوقًا؛ لذلك نخفض وزنه.
   */
  const hueWeight =
    0.15 +
    averageSaturation *
      0.35;

  const saturationWeight =
    0.22;

  const valueWeight =
    1 -
    hueWeight -
    saturationWeight;

  return clampUnitValue(
    hueDifference *
      hueWeight +
    saturationDifference *
      saturationWeight +
    valueDifference *
      valueWeight
  );
}

/**
 * حساب المسافة بين لونين Lab موحّدين.
 */
export function calculateLabDistanceV3(
  first:
    ImageGuidedLabColorV3,
  second:
    ImageGuidedLabColorV3
): number {
  const lightnessDifference =
    clampSegmentationValue(
      first.l,
      0,
      1
    ) -
    clampSegmentationValue(
      second.l,
      0,
      1
    );

  const firstA =
    clampSegmentationValue(
      first.a,
      -1,
      1
    );

  const secondA =
    clampSegmentationValue(
      second.a,
      -1,
      1
    );

  const firstB =
    clampSegmentationValue(
      first.b,
      -1,
      1
    );

  const secondB =
    clampSegmentationValue(
      second.b,
      -1,
      1
    );

  const aDifference =
    (
      firstA -
      secondA
    ) /
    2;

  const bDifference =
    (
      firstB -
      secondB
    ) /
    2;

  const euclideanDistance =
    Math.sqrt(
      lightnessDifference *
        lightnessDifference +
      aDifference *
        aDifference +
      bDifference *
        bDifference
    );

  return clampUnitValue(
    euclideanDistance /
      Math.sqrt(3)
  );
}

/* =========================================================
 * RGB / HSV / Lab similarity
 * ======================================================= */

/**
 * تحويل مسافة لون إلى درجة تشابه.
 */
function colorDistanceToSimilarityV3(
  distance: number,
  softness:
    number
): number {
  const safeDistance =
    clampUnitValue(
      Number.isFinite(
        distance
      )
        ? distance
        : 1
    );

  const safeSoftness =
    clampSegmentationValue(
      softness,
      0.05,
      4
    );

  return clampUnitValue(
    Math.exp(
      -
      safeDistance *
        safeDistance *
        safeSoftness
    )
  );
}

/**
 * حساب تشابه RGB.
 */
export function calculateRgbSimilarityV3(
  first:
    ImageGuidedRgbColorV3,
  second:
    ImageGuidedRgbColorV3
): number {
  return colorDistanceToSimilarityV3(
    calculateRgbDistanceV3(
      first,
      second
    ),
    4.5
  );
}

/**
 * حساب تشابه HSV.
 */
export function calculateHsvSimilarityV3(
  first:
    ImageGuidedHsvColorV3,
  second:
    ImageGuidedHsvColorV3
): number {
  return colorDistanceToSimilarityV3(
    calculateHsvDistanceV3(
      first,
      second
    ),
    4
  );
}

/**
 * حساب تشابه Lab.
 */
export function calculateLabSimilarityV3(
  first:
    ImageGuidedLabColorV3,
  second:
    ImageGuidedLabColorV3
): number {
  return colorDistanceToSimilarityV3(
    calculateLabDistanceV3(
      first,
      second
    ),
    5
  );
}

/* =========================================================
 * Prototype similarity
 * ======================================================= */

/**
 * حساب تشابه لون Pixel مع Prototype كاملة.
 */
export function calculateColorPrototypeSimilarityV3(
  rgb:
    ImageGuidedRgbColorV3,
  hsv:
    ImageGuidedHsvColorV3,
  lab:
    ImageGuidedLabColorV3,
  luminance: number,
  prototype:
    ImageGuidedColorPrototypeV3
): {
  rgbSimilarity: number;

  hsvSimilarity: number;

  labSimilarity: number;

  luminanceSimilarity: number;

  combinedSimilarity: number;
} {
  if (
    prototype.sampleCount <=
      0 ||
    prototype.confidence <=
      0
  ) {
    return {
      rgbSimilarity:
        0,

      hsvSimilarity:
        0,

      labSimilarity:
        0,

      luminanceSimilarity:
        0,

      combinedSimilarity:
        0,
    };
  }

  const rgbSimilarity =
    calculateRgbSimilarityV3(
      rgb,
      prototype.rgb
    );

  const hsvSimilarity =
    calculateHsvSimilarityV3(
      hsv,
      prototype.hsv
    );

  const labSimilarity =
    calculateLabSimilarityV3(
      lab,
      prototype.lab
    );

  const luminanceDifference =
    Math.abs(
      safeUnitValueV3(
        luminance
      ) -
      safeUnitValueV3(
        prototype.luminance
      )
    );

  const varianceTolerance =
    Math.max(
      0.025,
      Math.sqrt(
        Math.max(
          MINIMUM_PROTOTYPE_VARIANCE,
          prototype.variance
        )
      ) *
        2.5
    );

  const normalizedLuminanceDistance =
    clampUnitValue(
      luminanceDifference /
        Math.max(
          0.05,
          varianceTolerance
        )
    );

  const luminanceSimilarity =
    colorDistanceToSimilarityV3(
      normalizedLuminanceDistance,
      2.5
    );

  const rawCombinedSimilarity =
    rgbSimilarity *
      0.24 +
    hsvSimilarity *
      0.18 +
    labSimilarity *
      0.42 +
    luminanceSimilarity *
      0.16;

  const confidence =
    clampUnitValue(
      prototype.confidence
    );

  const confidenceAdjustedSimilarity =
    rawCombinedSimilarity *
    (
      0.72 +
      confidence *
        0.28
    );

  return {
    rgbSimilarity,

    hsvSimilarity,

    labSimilarity,

    luminanceSimilarity,

    combinedSimilarity:
      clampUnitValue(
        confidenceAdjustedSimilarity
      ),
  };
}

/* =========================================================
 * Pixel-to-model comparison
 * ======================================================= */

/**
 * مقارنة Pixel واحدة بنموذج القطعة والخلفية.
 *
 * يمكن تمرير RGB فقط، ويتم حساب HSV وLab داخليًا.
 */
export function comparePixelToLocalForegroundModelV3(
  model:
    ImageGuidedLocalForegroundModelV3,
  x: number,
  y: number,
  rgb:
    ImageGuidedRgbColorV3,
  luminance?: number
): LocalForegroundSimilarityV3 {
  if (
    !isValidLocalForegroundModelV3(
      model
    )
  ) {
    return createEmptySimilarityV3();
  }

  const safeRgb:
    ImageGuidedRgbColorV3 = {
      r:
        safeUnitValueV3(
          rgb.r
        ),

      g:
        safeUnitValueV3(
          rgb.g
        ),

      b:
        safeUnitValueV3(
          rgb.b
        ),
    };

  const hsv =
    rgbToHsvV3(
      safeRgb
    );

  const lab =
    rgbToLabV3(
      safeRgb
    );

  const safeLuminance =
    typeof luminance ===
      'number' &&
    Number.isFinite(
      luminance
    )
      ? safeUnitValueV3(
          luminance
        )
      : calculateRgbLuminanceV3(
          safeRgb
        );

  return comparePreparedColorToLocalForegroundModelV3(
    model,
    x,
    y,
    safeRgb,
    hsv,
    lab,
    safeLuminance
  );
}

/**
 * مقارنة Pixel جاهزة التحويل بالنموذج.
 *
 * هذه الدالة أفضل للأداء عندما تكون HSV وLab
 * محسوبة بالفعل في BoundaryFeatureExtractorV3.
 */
export function comparePreparedColorToLocalForegroundModelV3(
  model:
    ImageGuidedLocalForegroundModelV3,
  x: number,
  y: number,
  rgb:
    ImageGuidedRgbColorV3,
  hsv:
    ImageGuidedHsvColorV3,
  lab:
    ImageGuidedLabColorV3,
  luminance: number
): LocalForegroundSimilarityV3 {
  if (
    !isValidLocalForegroundModelV3(
      model
    )
  ) {
    return createEmptySimilarityV3();
  }

  const globalForegroundComparison =
    calculateColorPrototypeSimilarityV3(
      rgb,
      hsv,
      lab,
      luminance,
      model.globalPrototype
    );

  const globalBackgroundComparison =
    calculateColorPrototypeSimilarityV3(
      rgb,
      hsv,
      lab,
      luminance,
      model.backgroundPrototype
    );

  const localResult =
    calculateLocalRegionSimilarityV3(
      model.regions,
      x,
      y,
      rgb,
      hsv,
      lab,
      luminance
    );

  const localAvailability =
    localResult.nearestRegionId ===
      null
      ? 0
      : clampUnitValue(
          localResult
            .regionConfidence
        );

  const separationFactor =
    clampUnitValue(
      model.colorSeparation
    );

  const globalWeight =
    localAvailability >
      0
      ? 0.38
      : 1;

  const localWeight =
    localAvailability >
      0
      ? 0.62
      : 0;

  const localForegroundSimilarity =
    clampUnitValue(
      localResult.similarity *
        localWeight +
      globalForegroundComparison
        .combinedSimilarity *
        globalWeight
    );

  const globalForegroundSimilarity =
    clampUnitValue(
      globalForegroundComparison
        .combinedSimilarity
    );

  const globalBackgroundSimilarity =
    clampUnitValue(
      globalBackgroundComparison
        .combinedSimilarity
    );

  /**
   * عند وجود فصل لوني ضعيف، نخفف الثقة
   * في الفرق بين Foreground وBackground.
   */
  const separationReliability =
    0.55 +
    separationFactor *
      0.45;

  return {
    localForegroundSimilarity:
      clampUnitValue(
        localForegroundSimilarity *
          separationReliability
      ),

    globalForegroundSimilarity:
      clampUnitValue(
        globalForegroundSimilarity *
          separationReliability
      ),

    globalBackgroundSimilarity,

    foregroundRgbSimilarity:
      globalForegroundComparison
        .rgbSimilarity,

    foregroundHsvSimilarity:
      globalForegroundComparison
        .hsvSimilarity,

    foregroundLabSimilarity:
      globalForegroundComparison
        .labSimilarity,

    backgroundRgbSimilarity:
      globalBackgroundComparison
        .rgbSimilarity,

    backgroundHsvSimilarity:
      globalBackgroundComparison
        .hsvSimilarity,

    backgroundLabSimilarity:
      globalBackgroundComparison
        .labSimilarity,

    nearestRegionId:
      localResult.nearestRegionId,

    nearestRegionDistance:
      localResult.nearestRegionDistance,
  };
}

/**
 * مقارنة Pixel من صورة التحليل مباشرة.
 */
export function compareImagePixelToLocalForegroundModelV3(
  model:
    ImageGuidedLocalForegroundModelV3,
  image:
    ImageGuidedAnalysisImageV3,
  index: number
): LocalForegroundSimilarityV3 {
  if (
    !isValidAnalysisImageV3(
      image
    ) ||
    model.width !==
      image.width ||
    model.height !==
      image.height
  ) {
    return createEmptySimilarityV3();
  }

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

  const hsv =
    rgbToHsvV3(
      rgb
    );

  const lab =
    rgbToLabV3(
      rgb
    );

  const luminance =
    safeUnitValueV3(
      image.luminance[
        safeIndex
      ]
    );

  return comparePreparedColorToLocalForegroundModelV3(
    model,
    x,
    y,
    rgb,
    hsv,
    lab,
    luminance
  );
}

/* =========================================================
 * Local region selection
 * ======================================================= */

type LocalRegionSimilarityResultV3 = {
  similarity: number;

  nearestRegionId:
    number | null;

  nearestRegionDistance: number;

  regionConfidence: number;
};

/**
 * حساب التشابه مع المناطق المحلية.
 *
 * يتم دمج أكثر المناطق قربًا بدل الاعتماد
 * على Region واحدة فقط، لتجنب الحدود الحادة
 * بين مناطق النموذج.
 */
function calculateLocalRegionSimilarityV3(
  regions:
    readonly ImageGuidedLocalForegroundRegionV3[],
  x: number,
  y: number,
  rgb:
    ImageGuidedRgbColorV3,
  hsv:
    ImageGuidedHsvColorV3,
  lab:
    ImageGuidedLabColorV3,
  luminance: number
): LocalRegionSimilarityResultV3 {
  if (
    regions.length ===
    0
  ) {
    return {
      similarity:
        0,

      nearestRegionId:
        null,

      nearestRegionDistance:
        Infinity,

      regionConfidence:
        0,
    };
  }

  let nearestRegionId:
    number | null =
      null;

  let nearestRegionDistance =
    Infinity;

  let nearestRegionConfidence =
    0;

  let weightedSimilaritySum =
    0;

  let weightSum =
    0;

  for (
    const region of
    regions
  ) {
    const deltaX =
      x -
      region.centerX;

    const deltaY =
      y -
      region.centerY;

    const distance =
      Math.sqrt(
        deltaX *
          deltaX +
        deltaY *
          deltaY
      );

    if (
      distance <
      nearestRegionDistance
    ) {
      nearestRegionDistance =
        distance;

      nearestRegionId =
        region.id;

      nearestRegionConfidence =
        clampUnitValue(
          region.confidence
        );
    }

    const safeRadius =
      Math.max(
        1,
        region.radius
      );

    const normalizedDistance =
      distance /
      safeRadius;

    /**
     * Gaussian-like spatial weighting.
     */
    const spatialWeight =
      Math.exp(
        -
        normalizedDistance *
          normalizedDistance *
          0.65
      );

    if (
      spatialWeight <
      0.001
    ) {
      continue;
    }

    const comparison =
      calculateColorPrototypeSimilarityV3(
        rgb,
        hsv,
        lab,
        luminance,
        region.prototype
      );

    const regionConfidence =
      clampUnitValue(
        region.confidence
      );

    const reliablePixelRatio =
      clampUnitValue(
        region.reliablePixelRatio
      );

    const alphaReliability =
      clampUnitValue(
        region.averageAlpha
      );

    const reliabilityWeight =
      regionConfidence *
        0.50 +
      reliablePixelRatio *
        0.30 +
      alphaReliability *
        0.20;

    const finalWeight =
      spatialWeight *
      Math.max(
        0.05,
        reliabilityWeight
      );

    weightedSimilaritySum +=
      comparison
        .combinedSimilarity *
      finalWeight;

    weightSum +=
      finalWeight;
  }

  if (
    weightSum <=
    REGION_DISTANCE_EPSILON
  ) {
    const nearestRegion =
      nearestRegionId ===
        null
        ? null
        : regions.find(
            region =>
              region.id ===
              nearestRegionId
          ) ??
          null;

    if (
      nearestRegion ===
      null
    ) {
      return {
        similarity:
          0,

        nearestRegionId:
          null,

        nearestRegionDistance:
          Infinity,

        regionConfidence:
          0,
      };
    }

    const fallbackComparison =
      calculateColorPrototypeSimilarityV3(
        rgb,
        hsv,
        lab,
        luminance,
        nearestRegion.prototype
      );

    return {
      similarity:
        fallbackComparison
          .combinedSimilarity,

      nearestRegionId,

      nearestRegionDistance,

      regionConfidence:
        nearestRegionConfidence,
    };
  }

  return {
    similarity:
      clampUnitValue(
        weightedSimilaritySum /
          weightSum
      ),

    nearestRegionId,

    nearestRegionDistance,

    regionConfidence:
      nearestRegionConfidence,
  };
}

/* =========================================================
 * Model validation
 * ======================================================= */

/**
 * التحقق من صلاحية RGB.
 */
export function isValidRgbColorV3(
  value: unknown
): value is ImageGuidedRgbColorV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const color =
    value as Partial<
      ImageGuidedRgbColorV3
    >;

  return (
    isFiniteUnitValueV3(
      color.r as number
    ) &&
    isFiniteUnitValueV3(
      color.g as number
    ) &&
    isFiniteUnitValueV3(
      color.b as number
    )
  );
}

/**
 * التحقق من صلاحية HSV.
 */
export function isValidHsvColorV3(
  value: unknown
): value is ImageGuidedHsvColorV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const color =
    value as Partial<
      ImageGuidedHsvColorV3
    >;

  return (
    isFiniteUnitValueV3(
      color.h as number
    ) &&
    isFiniteUnitValueV3(
      color.s as number
    ) &&
    isFiniteUnitValueV3(
      color.v as number
    )
  );
}

/**
 * التحقق من صلاحية Lab.
 */
export function isValidLabColorV3(
  value: unknown
): value is ImageGuidedLabColorV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const color =
    value as Partial<
      ImageGuidedLabColorV3
    >;

  return (
    typeof color.l ===
      'number' &&
    Number.isFinite(
      color.l
    ) &&
    color.l >= 0 &&
    color.l <= 1 &&
    typeof color.a ===
      'number' &&
    Number.isFinite(
      color.a
    ) &&
    color.a >= -1 &&
    color.a <= 1 &&
    typeof color.b ===
      'number' &&
    Number.isFinite(
      color.b
    ) &&
    color.b >= -1 &&
    color.b <= 1
  );
}

/**
 * التحقق من صلاحية Prototype.
 */
export function isValidColorPrototypeV3(
  value: unknown
): value is ImageGuidedColorPrototypeV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const prototype =
    value as Partial<
      ImageGuidedColorPrototypeV3
    >;

  return (
    isValidRgbColorV3(
      prototype.rgb
    ) &&
    isValidHsvColorV3(
      prototype.hsv
    ) &&
    isValidLabColorV3(
      prototype.lab
    ) &&
    typeof prototype.luminance ===
      'number' &&
    Number.isFinite(
      prototype.luminance
    ) &&
    prototype.luminance >=
      0 &&
    prototype.luminance <=
      1 &&
    typeof prototype.variance ===
      'number' &&
    Number.isFinite(
      prototype.variance
    ) &&
    prototype.variance >=
      0 &&
    prototype.variance <=
      1 &&
    typeof prototype.sampleCount ===
      'number' &&
    Number.isInteger(
      prototype.sampleCount
    ) &&
    prototype.sampleCount >=
      0 &&
    typeof prototype.confidence ===
      'number' &&
    Number.isFinite(
      prototype.confidence
    ) &&
    prototype.confidence >=
      0 &&
    prototype.confidence <=
      1
  );
}

/**
 * التحقق من صلاحية Region محلية.
 */
export function isValidLocalForegroundRegionV3(
  value: unknown
): value is ImageGuidedLocalForegroundRegionV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const region =
    value as Partial<
      ImageGuidedLocalForegroundRegionV3
    >;

  if (
    typeof region.id !==
      'number' ||
    !Number.isInteger(
      region.id
    ) ||
    region.id < 0 ||
    typeof region.centerX !==
      'number' ||
    !Number.isFinite(
      region.centerX
    ) ||
    typeof region.centerY !==
      'number' ||
    !Number.isFinite(
      region.centerY
    ) ||
    typeof region.radius !==
      'number' ||
    !Number.isFinite(
      region.radius
    ) ||
    region.radius <= 0
  ) {
    return false;
  }

  if (
    !isValidMaskBoundsV3(
      region.bounds
    )
  ) {
    return false;
  }

  if (
    !isValidColorPrototypeV3(
      region.prototype
    )
  ) {
    return false;
  }

  return (
    typeof region.reliablePixelRatio ===
      'number' &&
    Number.isFinite(
      region.reliablePixelRatio
    ) &&
    region.reliablePixelRatio >=
      0 &&
    region.reliablePixelRatio <=
      1 &&
    typeof region.averageAlpha ===
      'number' &&
    Number.isFinite(
      region.averageAlpha
    ) &&
    region.averageAlpha >=
      0 &&
    region.averageAlpha <=
      1 &&
    typeof region.confidence ===
      'number' &&
    Number.isFinite(
      region.confidence
    ) &&
    region.confidence >=
      0 &&
    region.confidence <=
      1
  );
}

/**
 * التحقق من صلاحية النموذج بالكامل.
 */
export function isValidLocalForegroundModelV3(
  value: unknown
): value is ImageGuidedLocalForegroundModelV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const model =
    value as Partial<
      ImageGuidedLocalForegroundModelV3
    >;

  if (
    typeof model.width !==
      'number' ||
    !Number.isInteger(
      model.width
    ) ||
    model.width <= 0 ||
    typeof model.height !==
      'number' ||
    !Number.isInteger(
      model.height
    ) ||
    model.height <= 0
  ) {
    return false;
  }

  const pixelCount =
    model.width *
    model.height;

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
    !Array.isArray(
      model.regions
    ) ||
    !model.regions.every(
      region =>
        isValidLocalForegroundRegionV3(
          region
        )
    )
  ) {
    return false;
  }

  if (
    !isValidColorPrototypeV3(
      model.globalPrototype
    ) ||
    !isValidColorPrototypeV3(
      model.backgroundPrototype
    )
  ) {
    return false;
  }

  if (
    typeof model.foregroundSampleCount !==
      'number' ||
    !Number.isInteger(
      model.foregroundSampleCount
    ) ||
    model.foregroundSampleCount <
      0 ||
    typeof model.backgroundSampleCount !==
      'number' ||
    !Number.isInteger(
      model.backgroundSampleCount
    ) ||
    model.backgroundSampleCount <
      0
  ) {
    return false;
  }

  if (
    typeof model.colorSeparation !==
      'number' ||
    !Number.isFinite(
      model.colorSeparation
    ) ||
    model.colorSeparation <
      0 ||
    model.colorSeparation >
      1
  ) {
    return false;
  }

  if (
    typeof model.usable !==
    'boolean' ||
    !Array.isArray(
      model.warnings
    )
  ) {
    return false;
  }

  return true;
}

/* =========================================================
 * Clone helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من Prototype.
 */
export function cloneColorPrototypeV3(
  prototype:
    ImageGuidedColorPrototypeV3
): ImageGuidedColorPrototypeV3 {
  return {
    rgb: {
      r:
        prototype.rgb.r,

      g:
        prototype.rgb.g,

      b:
        prototype.rgb.b,
    },

    hsv: {
      h:
        prototype.hsv.h,

      s:
        prototype.hsv.s,

      v:
        prototype.hsv.v,
    },

    lab: {
      l:
        prototype.lab.l,

      a:
        prototype.lab.a,

      b:
        prototype.lab.b,
    },

    luminance:
      prototype.luminance,

    variance:
      prototype.variance,

    sampleCount:
      prototype.sampleCount,

    confidence:
      prototype.confidence,
  };
}

/**
 * إنشاء نسخة مستقلة من النموذج.
 */
export function cloneLocalForegroundModelV3(
  model:
    ImageGuidedLocalForegroundModelV3
): ImageGuidedLocalForegroundModelV3 {
  if (
    !isValidLocalForegroundModelV3(
      model
    )
  ) {
    throw new Error(
      'Cannot clone an invalid local foreground model.'
    );
  }

  return {
    width:
      model.width,

    height:
      model.height,

    regions:
      model.regions.map(
        region => ({
          id:
            region.id,

          centerX:
            region.centerX,

          centerY:
            region.centerY,

          radius:
            region.radius,

          bounds: {
  x:
    region.bounds.x,

  y:
    region.bounds.y,

  width:
    region.bounds.width,

  height:
    region.bounds.height,

  x2:
    region.bounds.x2,

  y2:
    region.bounds.y2,

  area:
    region.bounds.area,

  areaRatio:
    region.bounds.areaRatio,
},

          prototype:
            cloneColorPrototypeV3(
              region.prototype
            ),

          reliablePixelRatio:
            region.reliablePixelRatio,

          averageAlpha:
            region.averageAlpha,

          confidence:
            region.confidence,
        })
      ),

    globalPrototype:
      cloneColorPrototypeV3(
        model.globalPrototype
      ),

    backgroundPrototype:
      cloneColorPrototypeV3(
        model.backgroundPrototype
      ),

    foregroundSampleCount:
      model.foregroundSampleCount,

    backgroundSampleCount:
      model.backgroundSampleCount,

    colorSeparation:
      model.colorSeparation,

    usable:
      model.usable,

    warnings:
      [...model.warnings],
  };
}

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type LocalForegroundModelDiagnosticsV3 = {
  width: number;

  height: number;

  regionCount: number;

  usableRegionCount: number;

  foregroundSampleCount: number;

  backgroundSampleCount: number;

  foregroundConfidence: number;

  backgroundConfidence: number;

  averageRegionConfidence: number;

  averageRegionSampleCount: number;

  averageReliablePixelRatio: number;

  averageRegionAlpha: number;

  colorSeparation: number;

  usable: boolean;

  estimatedMemoryBytes: number;

  warnings:
    readonly string[];
};

/**
 * إنشاء Diagnostics للنموذج المحلي.
 */
export function createLocalForegroundModelDiagnosticsV3(
  model:
    ImageGuidedLocalForegroundModelV3
): LocalForegroundModelDiagnosticsV3 {
  if (
    !isValidLocalForegroundModelV3(
      model
    )
  ) {
    throw new Error(
      'Cannot create diagnostics from an invalid local foreground model.'
    );
  }

  let confidenceSum =
    0;

  let sampleCountSum =
    0;

  let reliableRatioSum =
    0;

  let alphaSum =
    0;

  let usableRegionCount =
    0;

  for (
    const region of
    model.regions
  ) {
    confidenceSum +=
      region.confidence;

    sampleCountSum +=
      region.prototype
        .sampleCount;

    reliableRatioSum +=
      region.reliablePixelRatio;

    alphaSum +=
      region.averageAlpha;

    if (
      region.confidence >=
        0.35 &&
      region.prototype
        .sampleCount >
        0
    ) {
      usableRegionCount +=
        1;
    }
  }

  const regionCount =
    model.regions.length;

  const safeRegionCount =
    Math.max(
      1,
      regionCount
    );

  return {
    width:
      model.width,

    height:
      model.height,

    regionCount,

    usableRegionCount,

    foregroundSampleCount:
      model.foregroundSampleCount,

    backgroundSampleCount:
      model.backgroundSampleCount,

    foregroundConfidence:
      model.globalPrototype
        .confidence,

    backgroundConfidence:
      model.backgroundPrototype
        .confidence,

    averageRegionConfidence:
      regionCount >
        0
        ? confidenceSum /
          safeRegionCount
        : 0,

    averageRegionSampleCount:
      regionCount >
        0
        ? sampleCountSum /
          safeRegionCount
        : 0,

    averageReliablePixelRatio:
      regionCount >
        0
        ? reliableRatioSum /
          safeRegionCount
        : 0,

    averageRegionAlpha:
      regionCount >
        0
        ? alphaSum /
          safeRegionCount
        : 0,

    colorSeparation:
      model.colorSeparation,

    usable:
      model.usable,

    estimatedMemoryBytes:
      estimateLocalForegroundModelBytesV3(
        model
      ),

    warnings:
      [...model.warnings],
  };
}

/**
 * تقدير تقريبي لاستهلاك النموذج للذاكرة.
 *
 * النموذج يعتمد على Objects صغيرة،
 * وليس خرائط Pixel ضخمة.
 */
export function estimateLocalForegroundModelBytesV3(
  model:
    ImageGuidedLocalForegroundModelV3
): number {
  if (
    !isValidLocalForegroundModelV3(
      model
    )
  ) {
    return 0;
  }

  const prototypeNumberCount =
    3 +
    3 +
    3 +
    4;

  const prototypeBytes =
    prototypeNumberCount *
    8;

  const boundsBytes =
    4 *
    8;

  const regionBaseNumberCount =
    7;

  const regionBaseBytes =
    regionBaseNumberCount *
    8;

  const regionsBytes =
    model.regions.length *
    (
      prototypeBytes +
      boundsBytes +
      regionBaseBytes
    );

  const rootNumberCount =
    7;

  const rootBytes =
    rootNumberCount *
    8;

  const warningsBytes =
    model.warnings.reduce(
      (
        total,
        warning
      ) =>
        total +
        warning.length *
          2,
      0
    );

  return (
    prototypeBytes *
      2 +
    regionsBytes +
    rootBytes +
    warningsBytes
  );
}

/* =========================================================
 * Model summary
 * ======================================================= */

/**
 * إنشاء Summary نصي قصير للتشخيص.
 */
export function getLocalForegroundModelSummaryV3(
  model:
    ImageGuidedLocalForegroundModelV3
): string {
  if (
    !isValidLocalForegroundModelV3(
      model
    )
  ) {
    return (
      'LocalForegroundModelV3: invalid model.'
    );
  }

  return [
    'LocalForegroundModelV3',
    `${model.width}x${model.height}`,
    `regions=${model.regions.length}`,
    `foregroundSamples=${model.foregroundSampleCount}`,
    `backgroundSamples=${model.backgroundSampleCount}`,
    `separation=${model.colorSeparation.toFixed(4)}`,
    `usable=${model.usable}`,
  ].join(' | ');
}

/* =========================================================
 * Empty similarity
 * ======================================================= */

function createEmptySimilarityV3():
  LocalForegroundSimilarityV3 {
  return {
    localForegroundSimilarity:
      0,

    globalForegroundSimilarity:
      0,

    globalBackgroundSimilarity:
      0,

    foregroundRgbSimilarity:
      0,

    foregroundHsvSimilarity:
      0,

    foregroundLabSimilarity:
      0,

    backgroundRgbSimilarity:
      0,

    backgroundHsvSimilarity:
      0,

    backgroundLabSimilarity:
      0,

    nearestRegionId:
      null,

    nearestRegionDistance:
      Infinity,
  };
}

/* =========================================================
 * Additional helpers
 * ======================================================= */

function calculateRgbLuminanceV3(
  rgb:
    ImageGuidedRgbColorV3
): number {
  const red =
    srgbChannelToLinearV3(
      safeUnitValueV3(
        rgb.r
      )
    );

  const green =
    srgbChannelToLinearV3(
      safeUnitValueV3(
        rgb.g
      )
    );

  const blue =
    srgbChannelToLinearV3(
      safeUnitValueV3(
        rgb.b
      )
    );

  return clampUnitValue(
    red *
      0.2126 +
    green *
      0.7152 +
    blue *
      0.0722
  );
}

function normalizeHueV3(
  value: number
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  let normalized =
    value %
    1;

  if (
    normalized < 0
  ) {
    normalized +=
      1;
  }

  return normalized;
}

function isValidMaskBoundsV3(
  value: unknown
): value is SegmentationMaskBounds {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const bounds =
    value as Partial<
      SegmentationMaskBounds
    >;

  return (
    typeof bounds.x ===
      'number' &&
    Number.isFinite(
      bounds.x
    ) &&
    bounds.x >= 0 &&
    typeof bounds.y ===
      'number' &&
    Number.isFinite(
      bounds.y
    ) &&
    bounds.y >= 0 &&
    typeof bounds.width ===
      'number' &&
    Number.isFinite(
      bounds.width
    ) &&
    bounds.width >
      0 &&
    typeof bounds.height ===
      'number' &&
    Number.isFinite(
      bounds.height
    ) &&
    bounds.height >
      0
  );
}

/* =========================================================
 * Default export
 * ======================================================= */

const LocalForegroundModelV3 = {
  DEFAULT_CONFIG:
    DEFAULT_LOCAL_FOREGROUND_CONFIG_V3,

  createDefaultConfig:
    createDefaultLocalForegroundConfigV3,

  resolveConfig:
    resolveLocalForegroundConfigV3,

  build:
    buildLocalForegroundModelV3,

  create:
    createLocalForegroundModelV3,

  comparePixel:
    comparePixelToLocalForegroundModelV3,

  comparePreparedColor:
    comparePreparedColorToLocalForegroundModelV3,

  compareImagePixel:
    compareImagePixelToLocalForegroundModelV3,

  rgbToHsv:
    rgbToHsvV3,

  rgbToLab:
    rgbToLabV3,

  calculateRgbDistance:
    calculateRgbDistanceV3,

  calculateHsvDistance:
    calculateHsvDistanceV3,

  calculateLabDistance:
    calculateLabDistanceV3,

  calculateRgbSimilarity:
    calculateRgbSimilarityV3,

  calculateHsvSimilarity:
    calculateHsvSimilarityV3,

  calculateLabSimilarity:
    calculateLabSimilarityV3,

  calculatePrototypeSimilarity:
    calculateColorPrototypeSimilarityV3,

  calculatePrototypeSeparation:
    calculatePrototypeSeparationV3,

  createEmptyPrototype:
    createEmptyColorPrototypeV3,

  validatePrototype:
    isValidColorPrototypeV3,

  validateRegion:
    isValidLocalForegroundRegionV3,

  validate:
    isValidLocalForegroundModelV3,

  clonePrototype:
    cloneColorPrototypeV3,

  clone:
    cloneLocalForegroundModelV3,

  estimateBytes:
    estimateLocalForegroundModelBytesV3,

  createDiagnostics:
    createLocalForegroundModelDiagnosticsV3,

  getSummary:
    getLocalForegroundModelSummaryV3,
};

export default
  LocalForegroundModelV3;