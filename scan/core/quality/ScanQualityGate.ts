// scan/core/quality/ScanQualityGate.ts
// Part 1/4
//
// Triple N - Scan Item Quality Gate
//
// هذا الملف مسؤول عن التحقق من جودة صورة القطعة
// قبل قبول النتيجة النهائية وبعد خروج Alpha Mask.
//
// المشاكل التي سيعالجها المحرك:
// 1) ضعف التباين بين القطعة والخلفية.
// 2) خروج جزء من القطعة خارج حدود الصورة.
// 3) وجود أكثر من جسم أو وجود يد/عنصر دخيل.
// 4) الصورة المهزوزة أو المظلمة أو شديدة الإضاءة.
//
// ملاحظة:
// هذا الجزء يحتوي على الأنواع والإعدادات والأدوات الأساسية.
// لا توجد مكتبات خارجية أو Imports في هذا الجزء.

/**
 * القيم الرقمية التي يتعامل معها المحرك
 * تكون غالبًا داخل النطاق من 0 إلى 1.
 */
export type ScanQualityNormalizedValue =
  number;

/**
 * مستوى خطورة المشكلة المكتشفة.
 */
export type ScanQualityIssueSeverity =
  | 'info'
  | 'warning'
  | 'error'
  | 'critical';

/**
 * المرحلة التي تم فيها تنفيذ الفحص.
 *
 * pre-segmentation:
 * فحوصات الصورة قبل تشغيل نموذج الفصل.
 *
 * post-segmentation:
 * فحوصات الصورة والماسك بعد تشغيل نموذج الفصل.
 *
 * final:
 * القرار النهائي بعد دمج كل النتائج.
 */
export type ScanQualityStage =
  | 'pre-segmentation'
  | 'post-segmentation'
  | 'final';

/**
 * القرار الذي يتخذه محرك الجودة.
 */
export type ScanQualityDecision =
  | 'accept'
  | 'accept-with-warning'
  | 'retry'
  | 'reject';

/**
 * أسباب عدم قبول الصورة أو طلب إعادة التصوير.
 */
export type ScanQualityIssueCode =
  | 'invalid-input'
  | 'invalid-image-size'
  | 'invalid-pixel-buffer'
  | 'invalid-mask'
  | 'image-too-small'
  | 'image-too-large'
  | 'image-too-dark'
  | 'image-too-bright'
  | 'image-underexposed'
  | 'image-overexposed'
  | 'image-low-contrast'
  | 'image-blurry'
  | 'image-severely-blurry'
  | 'background-too-similar'
  | 'foreground-too-small'
  | 'foreground-too-large'
  | 'foreground-missing'
  | 'foreground-touching-top'
  | 'foreground-touching-bottom'
  | 'foreground-touching-left'
  | 'foreground-touching-right'
  | 'foreground-touching-multiple-edges'
  | 'multiple-objects-detected'
  | 'secondary-object-detected'
  | 'possible-hand-detected'
  | 'mask-too-fragmented'
  | 'mask-has-holes'
  | 'mask-low-confidence'
  | 'mask-uncertain-edges'
  | 'subject-off-center'
  | 'subject-too-close'
  | 'subject-too-far'
  | 'quality-score-too-low'
  | 'unknown-quality-failure';

/**
 * الرسائل التي يمكن أن تظهر للمستخدم.
 *
 * الرسالة النهائية سيتم اختيارها بناءً على
 * المشكلة الأهم، حتى لا يرى المستخدم عشرات الرسائل.
 */
export type ScanQualityUserMessageKey =
  | 'ready'
  | 'move-back'
  | 'move-closer'
  | 'center-item'
  | 'keep-whole-item-inside'
  | 'use-darker-background'
  | 'use-lighter-background'
  | 'use-different-background'
  | 'improve-lighting'
  | 'reduce-lighting'
  | 'hold-still'
  | 'place-one-item-only'
  | 'remove-hand'
  | 'clean-camera-lens'
  | 'retake-photo'
  | 'could-not-detect-item';

/**
 * ترتيب القنوات داخل Pixel Buffer.
 */
export type ScanQualityPixelFormat =
  | 'rgba'
  | 'bgra'
  | 'rgb'
  | 'bgr'
  | 'grayscale';

/**
 * بيانات الصورة الخام المستخدمة في الفحص.
 *
 * pixels:
 * يمكن أن تكون Uint8Array أو Uint8ClampedArray.
 *
 * القيم متوقعة من 0 إلى 255.
 */
export type ScanQualityImageData = {
  width:
    number;

  height:
    number;

  pixels:
    Uint8Array |
    Uint8ClampedArray;

  format:
    ScanQualityPixelFormat;

  /**
   * عدد البايتات لكل صف.
   *
   * لو لم يتم تمريره،
   * سيحسب المحرك القيمة تلقائيًا.
   */
  bytesPerRow?:
    number;

  /**
   * اتجاه الصورة بعد تصحيح Orientation.
   *
   * هذا الحقل للمعلومات فقط.
   */
  orientationCorrected?:
    boolean;
};

/**
 * Alpha Mask خام.
 *
 * كل قيمة يمكن أن تكون:
 * - من 0 إلى 255
 * - أو من 0 إلى 1
 *
 * maskValueRange يحدد النطاق المستخدم.
 */
export type ScanQualityMaskValueRange =
  | 'zero-to-one'
  | 'zero-to-255';

export type ScanQualityMaskData = {
  width:
    number;

  height:
    number;

  data:
    Float32Array |
    Uint8Array |
    Uint8ClampedArray |
    readonly number[];

  valueRange?:
    ScanQualityMaskValueRange;
};

/**
 * مستطيل يحدد حدود الجسم الرئيسي.
 */
export type ScanQualityBoundingBox = {
  x:
    number;

  y:
    number;

  width:
    number;

  height:
    number;

  right:
    number;

  bottom:
    number;

  centerX:
    number;

  centerY:
    number;

  area:
    number;

  areaRatio:
    number;
};

/**
 * معلومات عن ملامسة الجسم لحواف الصورة.
 */
export type ScanQualityEdgeContact = {
  top:
    boolean;

  bottom:
    boolean;

  left:
    boolean;

  right:
    boolean;

  edgeCount:
    number;

  topRatio:
    number;

  bottomRatio:
    number;

  leftRatio:
    number;

  rightRatio:
    number;

  maximumContactRatio:
    number;
};

/**
 * جسم متصل تم اكتشافه داخل الماسك.
 */
export type ScanQualityConnectedComponent = {
  id:
    number;

  pixelCount:
    number;

  areaRatio:
    number;

  boundingBox:
    ScanQualityBoundingBox;

  touchesTop:
    boolean;

  touchesBottom:
    boolean;

  touchesLeft:
    boolean;

  touchesRight:
    boolean;

  centroidX:
    number;

  centroidY:
    number;
};

/**
 * نتيجة قياس الإضاءة.
 */
export type ScanQualityBrightnessMetrics = {
  mean:
    number;

  median:
    number;

  minimum:
    number;

  maximum:
    number;

  darkPixelRatio:
    number;

  brightPixelRatio:
    number;

  clippedBlackRatio:
    number;

  clippedWhiteRatio:
    number;

  dynamicRange:
    number;

  score:
    number;
};

/**
 * نتيجة قياس التباين.
 */
export type ScanQualityContrastMetrics = {
  standardDeviation:
    number;

  percentileRange:
    number;

  localContrast:
    number;

  score:
    number;
};

/**
 * نتيجة قياس حدة الصورة.
 */
export type ScanQualitySharpnessMetrics = {
  laplacianVariance:
    number;

  edgeStrength:
    number;

  edgeDensity:
    number;

  score:
    number;
};

/**
 * نتيجة فحص التشابه بين القطعة والخلفية.
 */
export type ScanQualityBackgroundMetrics = {
  foregroundLuminance:
    number;

  backgroundLuminance:
    number;

  luminanceDifference:
    number;

  foregroundColorSpread:
    number;

  backgroundColorSpread:
    number;

  boundaryContrast:
    number;

  similarityScore:
    number;

  score:
    number;
};

/**
 * نتيجة تحليل Alpha Mask.
 */
export type ScanQualityMaskMetrics = {
  foregroundPixelCount:
    number;

  foregroundRatio:
    number;

  softEdgePixelCount:
    number;

  softEdgeRatio:
    number;

  uncertainPixelCount:
    number;

  uncertainPixelRatio:
    number;

  componentCount:
    number;

  significantComponentCount:
    number;

  largestComponentRatio:
    number;

  secondLargestComponentRatio:
    number;

  fragmentationScore:
    number;

  holeRatio:
    number;

  boundingBox:
    ScanQualityBoundingBox |
    null;

  edgeContact:
    ScanQualityEdgeContact;

  components:
    readonly ScanQualityConnectedComponent[];

  score:
    number;
};

/**
 * كل مشكلة مكتشفة داخل نتيجة الجودة.
 */
export type ScanQualityIssue = {
  code:
    ScanQualityIssueCode;

  severity:
    ScanQualityIssueSeverity;

  stage:
    ScanQualityStage;

  messageKey:
    ScanQualityUserMessageKey;

  /**
   * قيمة من 0 إلى 1 تمثل قوة المشكلة.
   *
   * 0:
   * مشكلة ضعيفة جدًا.
   *
   * 1:
   * مشكلة مؤكدة أو شديدة.
   */
  confidence:
    number;

  /**
   * شرح تقني لا يظهر للمستخدم.
   */
  debugMessage:
    string;

  /**
   * بيانات إضافية للمراجعة والاختبارات.
   */
  details?:
    Readonly<
      Record<
        string,
        string |
        number |
        boolean |
        null
      >
    >;
};

/**
 * نتيجة فحص الصورة قبل تشغيل BiRefNet.
 */
export type ScanQualityPreSegmentationResult = {
  stage:
    'pre-segmentation';

  passed:
    boolean;

  score:
    number;

  decision:
    ScanQualityDecision;

  brightness:
    ScanQualityBrightnessMetrics;

  contrast:
    ScanQualityContrastMetrics;

  sharpness:
    ScanQualitySharpnessMetrics;

  issues:
    readonly ScanQualityIssue[];

  primaryIssue:
    ScanQualityIssue |
    null;

  userMessageKey:
    ScanQualityUserMessageKey;

  processingTimeMs:
    number;
};

/**
 * نتيجة الفحص بعد خروج Alpha Mask.
 */
export type ScanQualityPostSegmentationResult = {
  stage:
    'post-segmentation';

  passed:
    boolean;

  score:
    number;

  decision:
    ScanQualityDecision;

  mask:
    ScanQualityMaskMetrics;

  background:
    ScanQualityBackgroundMetrics |
    null;

  issues:
    readonly ScanQualityIssue[];

  primaryIssue:
    ScanQualityIssue |
    null;

  userMessageKey:
    ScanQualityUserMessageKey;

  processingTimeMs:
    number;
};

/**
 * النتيجة النهائية للمحرك.
 */
export type ScanQualityResult = {
  stage:
    'final';

  accepted:
    boolean;

  score:
    number;

  decision:
    ScanQualityDecision;

  preSegmentation:
    ScanQualityPreSegmentationResult |
    null;

  postSegmentation:
    ScanQualityPostSegmentationResult |
    null;

  issues:
    readonly ScanQualityIssue[];

  primaryIssue:
    ScanQualityIssue |
    null;

  userMessageKey:
    ScanQualityUserMessageKey;

  processingTimeMs:
    number;

  debugSummary:
    string;
};

/**
 * إعدادات فحص الصورة.
 */
export type ScanQualityImageConfig = {
  minimumWidth:
    number;

  minimumHeight:
    number;

  maximumWidth:
    number;

  maximumHeight:
    number;

  sampleMaximumDimension:
    number;

  darkLuminanceThreshold:
    number;

  brightLuminanceThreshold:
    number;

  clippedBlackThreshold:
    number;

  clippedWhiteThreshold:
    number;

  maximumDarkPixelRatio:
    number;

  maximumBrightPixelRatio:
    number;

  maximumClippedBlackRatio:
    number;

  maximumClippedWhiteRatio:
    number;

  minimumMeanBrightness:
    number;

  maximumMeanBrightness:
    number;

  minimumDynamicRange:
    number;

  minimumGlobalContrast:
    number;

  minimumLocalContrast:
    number;

  minimumSharpnessScore:
    number;

  severeBlurScore:
    number;
};

/**
 * إعدادات فحص Alpha Mask.
 */
export type ScanQualityMaskConfig = {
  foregroundThreshold:
    number;

  softForegroundThreshold:
    number;

  confidentForegroundThreshold:
    number;

  uncertainMinimum:
    number;

  uncertainMaximum:
    number;

  minimumForegroundRatio:
    number;

  maximumForegroundRatio:
    number;

  minimumLargestComponentRatio:
    number;

  minimumSignificantComponentRatio:
    number;

  maximumSecondComponentRatio:
    number;

  maximumSignificantComponents:
    number;

  maximumFragmentationScore:
    number;

  maximumHoleRatio:
    number;

  edgeMarginRatio:
    number;

  maximumEdgeContactRatio:
    number;

  maximumTouchedEdges:
    number;

  minimumSubjectPaddingRatio:
    number;

  minimumBoundingBoxAreaRatio:
    number;

  maximumBoundingBoxAreaRatio:
    number;

  maximumCenterOffsetRatio:
    number;

  maximumUncertainPixelRatio:
    number;

  maximumSoftEdgeRatio:
    number;
};

/**
 * إعدادات مقارنة القطعة بالخلفية.
 */
export type ScanQualityBackgroundConfig = {
  borderSampleRatio:
    number;

  boundarySampleRadius:
    number;

  minimumLuminanceDifference:
    number;

  minimumBoundaryContrast:
    number;

  maximumSimilarityScore:
    number;

  whiteForegroundThreshold:
    number;

  whiteBackgroundThreshold:
    number;

  blackForegroundThreshold:
    number;

  blackBackgroundThreshold:
    number;
};

/**
 * أوزان حساب النتيجة النهائية.
 */
export type ScanQualityScoreWeights = {
  brightness:
    number;

  contrast:
    number;

  sharpness:
    number;

  mask:
    number;

  backgroundSeparation:
    number;

  framing:
    number;

  objectIsolation:
    number;
};

/**
 * حدود القرارات.
 */
export type ScanQualityDecisionConfig = {
  acceptScore:
    number;

  acceptWithWarningScore:
    number;

  retryScore:
    number;

  rejectOnCriticalIssue:
    boolean;

  rejectOnSevereBlur:
    boolean;

  rejectOnMissingForeground:
    boolean;

  rejectOnMultipleEdgeContact:
    boolean;

  rejectOnMultipleObjects:
    boolean;
};

/**
 * الإعدادات الكاملة لمحرك الجودة.
 */
export type ScanQualityGateConfig = {
  image:
    ScanQualityImageConfig;

  mask:
    ScanQualityMaskConfig;

  background:
    ScanQualityBackgroundConfig;

  weights:
    ScanQualityScoreWeights;

  decision:
    ScanQualityDecisionConfig;
};

/**
 * إعدادات Triple N الافتراضية.
 *
 * القيم متوازنة لمنع الصور السيئة
 * بدون رفض الصور المقبولة بسهولة زائدة.
 *
 * سيتم تعديل الحدود النهائية بعد الاختبار
 * الحقيقي على أجهزة وصور مختلفة.
 */
export const DEFAULT_SCAN_QUALITY_GATE_CONFIG:
  Readonly<ScanQualityGateConfig> = {
    image: {
      minimumWidth:
        320,

      minimumHeight:
        320,

      maximumWidth:
        8192,

      maximumHeight:
        8192,

      sampleMaximumDimension:
        384,

      darkLuminanceThreshold:
        0.12,

      brightLuminanceThreshold:
        0.90,

      clippedBlackThreshold:
        0.015,

      clippedWhiteThreshold:
        0.985,

      maximumDarkPixelRatio:
        0.72,

      maximumBrightPixelRatio:
        0.82,

      maximumClippedBlackRatio:
        0.32,

      maximumClippedWhiteRatio:
        0.40,

      minimumMeanBrightness:
        0.16,

      maximumMeanBrightness:
        0.92,

      minimumDynamicRange:
        0.18,

      minimumGlobalContrast:
        0.055,

      minimumLocalContrast:
        0.035,

      minimumSharpnessScore:
        0.30,

      severeBlurScore:
        0.14,
    },

    mask: {
      foregroundThreshold:
        0.50,

      softForegroundThreshold:
        0.10,

      confidentForegroundThreshold:
        0.82,

      uncertainMinimum:
        0.25,

      uncertainMaximum:
        0.75,

      minimumForegroundRatio:
        0.035,

      maximumForegroundRatio:
        0.92,

      minimumLargestComponentRatio:
        0.72,

      minimumSignificantComponentRatio:
        0.012,

      maximumSecondComponentRatio:
        0.16,

      maximumSignificantComponents:
        2,

      maximumFragmentationScore:
        0.25,

      maximumHoleRatio:
        0.12,

      edgeMarginRatio:
        0.012,

      maximumEdgeContactRatio:
        0.055,

      maximumTouchedEdges:
        1,

      minimumSubjectPaddingRatio:
        0.018,

      minimumBoundingBoxAreaRatio:
        0.04,

      maximumBoundingBoxAreaRatio:
        0.91,

      maximumCenterOffsetRatio:
        0.30,

      maximumUncertainPixelRatio:
        0.22,

      maximumSoftEdgeRatio:
        0.35,
    },

    background: {
      borderSampleRatio:
        0.08,

      boundarySampleRadius:
        3,

      minimumLuminanceDifference:
        0.055,

      minimumBoundaryContrast:
        0.040,

      maximumSimilarityScore:
        0.82,

      whiteForegroundThreshold:
        0.78,

      whiteBackgroundThreshold:
        0.82,

      blackForegroundThreshold:
        0.20,

      blackBackgroundThreshold:
        0.18,
    },

    weights: {
      brightness:
        0.14,

      contrast:
        0.12,

      sharpness:
        0.16,

      mask:
        0.20,

      backgroundSeparation:
        0.14,

      framing:
        0.12,

      objectIsolation:
        0.12,
    },

    decision: {
      acceptScore:
        0.78,

      acceptWithWarningScore:
        0.66,

      retryScore:
        0.48,

      rejectOnCriticalIssue:
        true,

      rejectOnSevereBlur:
        true,

      rejectOnMissingForeground:
        true,

      rejectOnMultipleEdgeContact:
        true,

      rejectOnMultipleObjects:
        true,
    },
  };

/**
 * ترتيب أولوية المشكلات.
 *
 * كلما زادت القيمة،
 * أصبحت المشكلة أهم عند اختيار الرسالة النهائية.
 */
const ISSUE_PRIORITY:
  Readonly<
    Record<
      ScanQualityIssueCode,
      number
    >
  > = {
    'invalid-input':
      1000,

    'invalid-image-size':
      990,

    'invalid-pixel-buffer':
      980,

    'invalid-mask':
      970,

    'foreground-missing':
      960,

    'image-severely-blurry':
      950,

    'foreground-touching-multiple-edges':
      940,

    'multiple-objects-detected':
      930,

    'possible-hand-detected':
      920,

    'image-too-dark':
      910,

    'image-underexposed':
      900,

    'image-too-bright':
      890,

    'image-overexposed':
      880,

    'background-too-similar':
      870,

    'foreground-touching-top':
      860,

    'foreground-touching-bottom':
      850,

    'foreground-touching-left':
      840,

    'foreground-touching-right':
      830,

    'subject-too-close':
      820,

    'foreground-too-large':
      810,

    'subject-too-far':
      800,

    'foreground-too-small':
      790,

    'secondary-object-detected':
      780,

    'mask-too-fragmented':
      770,

    'mask-low-confidence':
      760,

    'mask-uncertain-edges':
      750,

    'mask-has-holes':
      740,

    'image-blurry':
      730,

    'image-low-contrast':
      720,

    'subject-off-center':
      710,

    'image-too-small':
      700,

    'image-too-large':
      690,

    'quality-score-too-low':
      680,

    'unknown-quality-failure':
      100,
  };

/**
 * يضمن أن القيمة تقع بين الحد الأدنى والأقصى.
 */
export function clampScanQualityValue(
  value:
    number,
  minimum:
    number,
  maximum:
    number
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return minimum;
  }

  if (
    value <
    minimum
  ) {
    return minimum;
  }

  if (
    value >
    maximum
  ) {
    return maximum;
  }

  return value;
}

/**
 * يحول القيمة إلى نطاق من 0 إلى 1.
 */
export function normalizeScanQualityValue(
  value:
    number
): ScanQualityNormalizedValue {
  return clampScanQualityValue(
    value,
    0,
    1
  );
}

/**
 * قسمة آمنة تمنع NaN وInfinity.
 */
export function safeScanQualityDivide(
  numerator:
    number,
  denominator:
    number,
  fallback:
    number = 0
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
      Number.EPSILON
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

/**
 * Linear interpolation.
 */
export function interpolateScanQualityValue(
  start:
    number,
  end:
    number,
  amount:
    number
): number {
  const normalizedAmount =
    normalizeScanQualityValue(
      amount
    );

  return (
    start +
    (
      end -
      start
    ) *
      normalizedAmount
  );
}

/**
 * يحول رقمًا من نطاق إلى نطاق آخر.
 */
export function remapScanQualityValue(
  value:
    number,
  inputMinimum:
    number,
  inputMaximum:
    number,
  outputMinimum:
    number,
  outputMaximum:
    number,
  shouldClamp:
    boolean = true
): number {
  const inputRange =
    inputMaximum -
    inputMinimum;

  if (
    !Number.isFinite(
      inputRange
    ) ||
    Math.abs(
      inputRange
    ) <
      Number.EPSILON
  ) {
    return outputMinimum;
  }

  let ratio =
    (
      value -
      inputMinimum
    ) /
    inputRange;

  if (
    shouldClamp
  ) {
    ratio =
      normalizeScanQualityValue(
        ratio
      );
  }

  return (
    outputMinimum +
    ratio *
      (
        outputMaximum -
        outputMinimum
      )
  );
}

/**
 * متوسط مجموعة أرقام.
 */
export function getScanQualityMean(
  values:
    readonly number[]
): number {
  if (
    values.length ===
    0
  ) {
    return 0;
  }

  let total =
    0;

  let validCount =
    0;

  for (
    const value
    of values
  ) {
    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    total +=
      value;

    validCount +=
      1;
  }

  return safeScanQualityDivide(
    total,
    validCount,
    0
  );
}

/**
 * الانحراف المعياري.
 */
export function getScanQualityStandardDeviation(
  values:
    readonly number[],
  knownMean?:
    number
): number {
  if (
    values.length <
    2
  ) {
    return 0;
  }

  const mean =
    knownMean ??
    getScanQualityMean(
      values
    );

  let totalSquaredDifference =
    0;

  let validCount =
    0;

  for (
    const value
    of values
  ) {
    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    const difference =
      value -
      mean;

    totalSquaredDifference +=
      difference *
      difference;

    validCount +=
      1;
  }

  return Math.sqrt(
    safeScanQualityDivide(
      totalSquaredDifference,
      validCount,
      0
    )
  );
}

/**
 * ترتيب نسخة من القيم بدون تغيير المصفوفة الأصلية.
 */
export function sortScanQualityValues(
  values:
    readonly number[]
): number[] {
  return values
    .filter(
      (
        value
      ) =>
        Number.isFinite(
          value
        )
    )
    .slice()
    .sort(
      (
        first,
        second
      ) =>
        first -
        second
    );
}

/**
 * حساب Percentile.
 *
 * percentile:
 * قيمة من 0 إلى 1.
 */
export function getScanQualityPercentile(
  values:
    readonly number[],
  percentile:
    number
): number {
  const sorted =
    sortScanQualityValues(
      values
    );

  if (
    sorted.length ===
    0
  ) {
    return 0;
  }

  if (
    sorted.length ===
    1
  ) {
    return (
      sorted[0] ??
      0
    );
  }

  const normalizedPercentile =
    normalizeScanQualityValue(
      percentile
    );

  const rawIndex =
    normalizedPercentile *
    (
      sorted.length -
      1
    );

  const lowerIndex =
    Math.floor(
      rawIndex
    );

  const upperIndex =
    Math.ceil(
      rawIndex
    );

  const lowerValue =
    sorted[
      lowerIndex
    ] ?? 0;

  const upperValue =
    sorted[
      upperIndex
    ] ??
    lowerValue;

  if (
    lowerIndex ===
    upperIndex
  ) {
    return lowerValue;
  }

  return interpolateScanQualityValue(
    lowerValue,
    upperValue,
    rawIndex -
      lowerIndex
  );
}

/**
 * حساب Median.
 */
export function getScanQualityMedian(
  values:
    readonly number[]
): number {
  return getScanQualityPercentile(
    values,
    0.5
  );
}

/**
 * يجمع درجات متعددة باستخدام أوزان.
 */
export function getWeightedScanQualityScore(
  entries:
    readonly {
      score:
        number;

      weight:
        number;
    }[]
): number {
  let weightedTotal =
    0;

  let totalWeight =
    0;

  for (
    const entry
    of entries
  ) {
    const weight =
      Math.max(
        0,
        Number.isFinite(
          entry.weight
        )
          ? entry.weight
          : 0
      );

    if (
      weight ===
      0
    ) {
      continue;
    }

    weightedTotal +=
      normalizeScanQualityValue(
        entry.score
      ) *
      weight;

    totalWeight +=
      weight;
  }

  return normalizeScanQualityValue(
    safeScanQualityDivide(
      weightedTotal,
      totalWeight,
      0
    )
  );
}

/**
 * عدد القنوات حسب Pixel Format.
 */
export function getScanQualityChannelCount(
  format:
    ScanQualityPixelFormat
): number {
  switch (
    format
  ) {
    case 'rgba':
    case 'bgra':
      return 4;

    case 'rgb':
    case 'bgr':
      return 3;

    case 'grayscale':
      return 1;

    default:
      return 0;
  }
}

/**
 * حساب عدد البايتات المتوقع للصورة.
 */
export function getExpectedScanQualityPixelLength(
  image:
    Pick<
      ScanQualityImageData,
      | 'width'
      | 'height'
      | 'format'
      | 'bytesPerRow'
    >
): number {
  const channelCount =
    getScanQualityChannelCount(
      image.format
    );

  if (
    channelCount <=
    0
  ) {
    return 0;
  }

  const minimumBytesPerRow =
    image.width *
    channelCount;

  const bytesPerRow =
    image.bytesPerRow ??
    minimumBytesPerRow;

  return (
    bytesPerRow *
    image.height
  );
}

/**
 * التحقق من صلاحية أبعاد الصورة.
 */
export function isValidScanQualityDimension(
  value:
    number
): boolean {
  return (
    Number.isInteger(
      value
    ) &&
    value >
      0
  );
}

/**
 * التحقق الأساسي من بيانات الصورة.
 */
export function validateScanQualityImageData(
  image:
    ScanQualityImageData
): {
  valid:
    boolean;

  reason:
    string |
    null;
} {
  if (
    !image ||
    typeof image !==
      'object'
  ) {
    return {
      valid:
        false,

      reason:
        'Image data is missing.',
    };
  }

  if (
    !isValidScanQualityDimension(
      image.width
    ) ||
    !isValidScanQualityDimension(
      image.height
    )
  ) {
    return {
      valid:
        false,

      reason:
        'Image width or height is invalid.',
    };
  }

  const channelCount =
    getScanQualityChannelCount(
      image.format
    );

  if (
    channelCount <=
    0
  ) {
    return {
      valid:
        false,

      reason:
        'Image pixel format is unsupported.',
    };
  }

  if (
    !image.pixels ||
    typeof image.pixels.length !==
      'number'
  ) {
    return {
      valid:
        false,

      reason:
        'Image pixel buffer is missing.',
    };
  }

  const minimumBytesPerRow =
    image.width *
    channelCount;

  if (
    image.bytesPerRow !==
      undefined &&
    (
      !Number.isInteger(
        image.bytesPerRow
      ) ||
      image.bytesPerRow <
        minimumBytesPerRow
    )
  ) {
    return {
      valid:
        false,

      reason:
        'Image bytesPerRow is invalid.',
    };
  }

  const expectedLength =
    getExpectedScanQualityPixelLength(
      image
    );

  if (
    image.pixels.length <
    expectedLength
  ) {
    return {
      valid:
        false,

      reason:
        `Pixel buffer is too small. Expected at least ${expectedLength}, received ${image.pixels.length}.`,
    };
  }

  return {
    valid:
      true,

    reason:
      null,
  };
}

/**
 * التحقق الأساسي من Alpha Mask.
 */
export function validateScanQualityMaskData(
  mask:
    ScanQualityMaskData
): {
  valid:
    boolean;

  reason:
    string |
    null;
} {
  if (
    !mask ||
    typeof mask !==
      'object'
  ) {
    return {
      valid:
        false,

      reason:
        'Mask data is missing.',
    };
  }

  if (
    !isValidScanQualityDimension(
      mask.width
    ) ||
    !isValidScanQualityDimension(
      mask.height
    )
  ) {
    return {
      valid:
        false,

      reason:
        'Mask width or height is invalid.',
    };
  }

  if (
    !mask.data ||
    typeof mask.data.length !==
      'number'
  ) {
    return {
      valid:
        false,

      reason:
        'Mask pixel data is missing.',
    };
  }

  const expectedLength =
    mask.width *
    mask.height;

  if (
    mask.data.length <
    expectedLength
  ) {
    return {
      valid:
        false,

      reason:
        `Mask buffer is too small. Expected at least ${expectedLength}, received ${mask.data.length}.`,
    };
  }

  return {
    valid:
      true,

    reason:
      null,
  };
}

/**
 * تحويل Alpha Mask value إلى 0..1.
 */
export function normalizeScanQualityMaskValue(
  value:
    number,
  valueRange:
    ScanQualityMaskValueRange =
      'zero-to-one'
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  if (
    valueRange ===
      'zero-to-255'
  ) {
    return normalizeScanQualityValue(
      value /
      255
    );
  }

  return normalizeScanQualityValue(
    value
  );
}

/**
 * إنشاء نسخة عميقة آمنة من الإعدادات.
 */
export function createScanQualityGateConfig(
  overrides?:
    Partial<{
      image:
        Partial<
          ScanQualityImageConfig
        >;

      mask:
        Partial<
          ScanQualityMaskConfig
        >;

      background:
        Partial<
          ScanQualityBackgroundConfig
        >;

      weights:
        Partial<
          ScanQualityScoreWeights
        >;

      decision:
        Partial<
          ScanQualityDecisionConfig
        >;
    }>
): ScanQualityGateConfig {
  return {
    image: {
      ...DEFAULT_SCAN_QUALITY_GATE_CONFIG
        .image,

      ...overrides
        ?.image,
    },

    mask: {
      ...DEFAULT_SCAN_QUALITY_GATE_CONFIG
        .mask,

      ...overrides
        ?.mask,
    },

    background: {
      ...DEFAULT_SCAN_QUALITY_GATE_CONFIG
        .background,

      ...overrides
        ?.background,
    },

    weights: {
      ...DEFAULT_SCAN_QUALITY_GATE_CONFIG
        .weights,

      ...overrides
        ?.weights,
    },

    decision: {
      ...DEFAULT_SCAN_QUALITY_GATE_CONFIG
        .decision,

      ...overrides
        ?.decision,
    },
  };
}

/**
 * إنشاء Issue موحد.
 */
export function createScanQualityIssue(
  input: {
    code:
      ScanQualityIssueCode;

    severity:
      ScanQualityIssueSeverity;

    stage:
      ScanQualityStage;

    messageKey:
      ScanQualityUserMessageKey;

    confidence:
      number;

    debugMessage:
      string;

    details?:
      Readonly<
        Record<
          string,
          string |
          number |
          boolean |
          null
        >
      >;
  }
): ScanQualityIssue {
  return {
    code:
      input.code,

    severity:
      input.severity,

    stage:
      input.stage,

    messageKey:
      input.messageKey,

    confidence:
      normalizeScanQualityValue(
        input.confidence
      ),

    debugMessage:
      input.debugMessage,

    details:
      input.details,
  };
}

/**
 * قيمة رقمية لأهمية Severity.
 */
export function getScanQualitySeverityWeight(
  severity:
    ScanQualityIssueSeverity
): number {
  switch (
    severity
  ) {
    case 'critical':
      return 4;

    case 'error':
      return 3;

    case 'warning':
      return 2;

    case 'info':
      return 1;

    default:
      return 0;
  }
}

/**
 * اختيار أهم مشكلة من مجموعة Issues.
 */
export function selectPrimaryScanQualityIssue(
  issues:
    readonly ScanQualityIssue[]
): ScanQualityIssue |
  null {
  if (
    issues.length ===
    0
  ) {
    return null;
  }

  let selected =
    issues[0] ??
    null;

  if (
    !selected
  ) {
    return null;
  }

  for (
    let index =
      1;
    index <
    issues.length;
    index +=
      1
  ) {
    const current =
      issues[
        index
      ];

    if (
      !current
    ) {
      continue;
    }

    const currentSeverity =
      getScanQualitySeverityWeight(
        current.severity
      );

    const selectedSeverity =
      getScanQualitySeverityWeight(
        selected.severity
      );

    if (
      currentSeverity >
      selectedSeverity
    ) {
      selected =
        current;

      continue;
    }

    if (
      currentSeverity <
      selectedSeverity
    ) {
      continue;
    }

    const currentPriority =
      ISSUE_PRIORITY[
        current.code
      ] ?? 0;

    const selectedPriority =
      ISSUE_PRIORITY[
        selected.code
      ] ?? 0;

    if (
      currentPriority >
      selectedPriority
    ) {
      selected =
        current;

      continue;
    }

    if (
      currentPriority <
      selectedPriority
    ) {
      continue;
    }

    if (
      current.confidence >
      selected.confidence
    ) {
      selected =
        current;
    }
  }

  return selected;
}

/**
 * معرفة هل توجد مشكلة بمستوى معين.
 */
export function hasScanQualityIssueSeverity(
  issues:
    readonly ScanQualityIssue[],
  severity:
    ScanQualityIssueSeverity
): boolean {
  return issues.some(
    (
      issue
    ) =>
      issue.severity ===
      severity
  );
}

/**
 * معرفة هل توجد مشكلة بكود معين.
 */
export function hasScanQualityIssueCode(
  issues:
    readonly ScanQualityIssue[],
  code:
    ScanQualityIssueCode
): boolean {
  return issues.some(
    (
      issue
    ) =>
      issue.code ===
      code
  );
}

/**
 * اختيار رسالة المستخدم من أهم مشكلة.
 */
export function getScanQualityUserMessageKey(
  issues:
    readonly ScanQualityIssue[]
): ScanQualityUserMessageKey {
  const primaryIssue =
    selectPrimaryScanQualityIssue(
      issues
    );

  return (
    primaryIssue
      ?.messageKey ??
    'ready'
  );
}

/**
 * ترتيب Issues لسهولة Debug.
 */
export function sortScanQualityIssues(
  issues:
    readonly ScanQualityIssue[]
): ScanQualityIssue[] {
  return issues
    .slice()
    .sort(
      (
        first,
        second
      ) => {
        const severityDifference =
          getScanQualitySeverityWeight(
            second.severity
          ) -
          getScanQualitySeverityWeight(
            first.severity
          );

        if (
          severityDifference !==
          0
        ) {
          return severityDifference;
        }

        const priorityDifference =
          (
            ISSUE_PRIORITY[
              second.code
            ] ?? 0
          ) -
          (
            ISSUE_PRIORITY[
              first.code
            ] ?? 0
          );

        if (
          priorityDifference !==
          0
        ) {
          return priorityDifference;
        }

        return (
          second.confidence -
          first.confidence
        );
      }
    );
}

/**
 * قرار مبدئي بناءً على النتيجة والمشكلات.
 */
export function resolveScanQualityDecision(
  score:
    number,
  issues:
    readonly ScanQualityIssue[],
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): ScanQualityDecision {
  const normalizedScore =
    normalizeScanQualityValue(
      score
    );

  const hasCritical =
    hasScanQualityIssueSeverity(
      issues,
      'critical'
    );

  if (
    hasCritical &&
    config.decision
      .rejectOnCriticalIssue
  ) {
    return 'reject';
  }

  if (
    config.decision
      .rejectOnSevereBlur &&
    hasScanQualityIssueCode(
      issues,
      'image-severely-blurry'
    )
  ) {
    return 'retry';
  }

  if (
    config.decision
      .rejectOnMissingForeground &&
    hasScanQualityIssueCode(
      issues,
      'foreground-missing'
    )
  ) {
    return 'retry';
  }

  if (
    config.decision
      .rejectOnMultipleEdgeContact &&
    hasScanQualityIssueCode(
      issues,
      'foreground-touching-multiple-edges'
    )
  ) {
    return 'retry';
  }

  if (
    config.decision
      .rejectOnMultipleObjects &&
    hasScanQualityIssueCode(
      issues,
      'multiple-objects-detected'
    )
  ) {
    return 'retry';
  }

  if (
    normalizedScore >=
    config.decision
      .acceptScore
  ) {
    return issues.length >
      0
      ? 'accept-with-warning'
      : 'accept';
  }

  if (
    normalizedScore >=
    config.decision
      .acceptWithWarningScore
  ) {
    return 'accept-with-warning';
  }

  if (
    normalizedScore >=
    config.decision
      .retryScore
  ) {
    return 'retry';
  }

  return 'reject';
}

/**
 * تحويل القرار إلى passed.
 */
export function isScanQualityDecisionAccepted(
  decision:
    ScanQualityDecision
): boolean {
  return (
    decision ===
      'accept' ||
    decision ===
      'accept-with-warning'
  );
}

/**
 * Debug summary بسيط للمشكلات.
 */
export function createScanQualityIssueDebugSummary(
  issues:
    readonly ScanQualityIssue[]
): string {
  if (
    issues.length ===
    0
  ) {
    return 'No scan quality issues detected.';
  }

  const sorted =
    sortScanQualityIssues(
      issues
    );

  return sorted
    .map(
      (
        issue
      ) =>
        [
          issue.code,
          issue.severity,
          issue.stage,
          issue.confidence
            .toFixed(
              3
            ),
          issue.debugMessage,
        ].join(
          ' | '
        )
    )
    .join(
      '\n'
    );
}

/**
 * حساب الزمن المنقضي.
 */
export function getScanQualityElapsedTime(
  startedAt:
    number
): number {
  return Math.max(
    0,
    Date.now() -
      startedAt
  );
}

/**
 * إنشاء Bounding Box فارغ.
 */
export function createEmptyScanQualityBoundingBox():
  ScanQualityBoundingBox {
  return {
    x:
      0,

    y:
      0,

    width:
      0,

    height:
      0,

    right:
      0,

    bottom:
      0,

    centerX:
      0,

    centerY:
      0,

    area:
      0,

    areaRatio:
      0,
  };
}

/**
 * إنشاء Edge Contact فارغ.
 */
export function createEmptyScanQualityEdgeContact():
  ScanQualityEdgeContact {
  return {
    top:
      false,

    bottom:
      false,

    left:
      false,

    right:
      false,

    edgeCount:
      0,

    topRatio:
      0,

    bottomRatio:
      0,

    leftRatio:
      0,

    rightRatio:
      0,

    maximumContactRatio:
      0,
  };
}

/**
 * إنشاء Brightness Metrics افتراضية.
 */
export function createEmptyScanQualityBrightnessMetrics():
  ScanQualityBrightnessMetrics {
  return {
    mean:
      0,

    median:
      0,

    minimum:
      0,

    maximum:
      0,

    darkPixelRatio:
      0,

    brightPixelRatio:
      0,

    clippedBlackRatio:
      0,

    clippedWhiteRatio:
      0,

    dynamicRange:
      0,

    score:
      0,
  };
}

/**
 * إنشاء Contrast Metrics افتراضية.
 */
export function createEmptyScanQualityContrastMetrics():
  ScanQualityContrastMetrics {
  return {
    standardDeviation:
      0,

    percentileRange:
      0,

    localContrast:
      0,

    score:
      0,
  };
}

/**
 * إنشاء Sharpness Metrics افتراضية.
 */
export function createEmptyScanQualitySharpnessMetrics():
  ScanQualitySharpnessMetrics {
  return {
    laplacianVariance:
      0,

    edgeStrength:
      0,

    edgeDensity:
      0,

    score:
      0,
  };
}

/**
 * إنشاء Background Metrics افتراضية.
 */
export function createEmptyScanQualityBackgroundMetrics():
  ScanQualityBackgroundMetrics {
  return {
    foregroundLuminance:
      0,

    backgroundLuminance:
      0,

    luminanceDifference:
      0,

    foregroundColorSpread:
      0,

    backgroundColorSpread:
      0,

    boundaryContrast:
      0,

    similarityScore:
      1,

    score:
      0,
  };
}

/**
 * إنشاء Mask Metrics افتراضية.
 */
export function createEmptyScanQualityMaskMetrics():
  ScanQualityMaskMetrics {
  return {
    foregroundPixelCount:
      0,

    foregroundRatio:
      0,

    softEdgePixelCount:
      0,

    softEdgeRatio:
      0,

    uncertainPixelCount:
      0,

    uncertainPixelRatio:
      0,

    componentCount:
      0,

    significantComponentCount:
      0,

    largestComponentRatio:
      0,

    secondLargestComponentRatio:
      0,

    fragmentationScore:
      0,

    holeRatio:
      0,

    boundingBox:
      null,

    edgeContact:
      createEmptyScanQualityEdgeContact(),

    components:
      [],

    score:
      0,
  };
}

// End of Part 1/4
// scan/core/quality/ScanQualityGate.ts
// Part 2/4
//
// قراءة الصورة وتحليل:
// 1) الإضاءة.
// 2) التعريض.
// 3) التباين.
// 4) الاهتزاز والحدة.
// 5) القرار قبل تشغيل BiRefNet.

type ScanQualityRgbPixel = {
  red:
    number;

  green:
    number;

  blue:
    number;

  alpha:
    number;
};

type ScanQualitySampledImage = {
  width:
    number;

  height:
    number;

  luminance:
    Float32Array;

  red:
    Float32Array;

  green:
    Float32Array;

  blue:
    Float32Array;

  sampleStepX:
    number;

  sampleStepY:
    number;
};

/**
 * تحويل Byte من 0..255 إلى 0..1.
 */
function normalizeScanQualityByte(
  value:
    number
): number {
  return normalizeScanQualityValue(
    value /
    255
  );
}

/**
 * تحويل لون RGB إلى Luminance.
 *
 * نستخدم Rec.709 لأنها مناسبة
 * لتحليل السطوع البصري.
 */
export function getScanQualityLuminance(
  red:
    number,
  green:
    number,
  blue:
    number
): number {
  const normalizedRed =
    normalizeScanQualityValue(
      red
    );

  const normalizedGreen =
    normalizeScanQualityValue(
      green
    );

  const normalizedBlue =
    normalizeScanQualityValue(
      blue
    );

  return normalizeScanQualityValue(
    normalizedRed *
      0.2126 +
    normalizedGreen *
      0.7152 +
    normalizedBlue *
      0.0722
  );
}

/**
 * قراءة Pixel واحد من الصورة
 * مع احترام Pixel Format وbytesPerRow.
 */
export function readScanQualityPixel(
  image:
    ScanQualityImageData,
  x:
    number,
  y:
    number
): ScanQualityRgbPixel {
  const safeX =
    clampScanQualityValue(
      Math.floor(
        x
      ),
      0,
      image.width -
        1
    );

  const safeY =
    clampScanQualityValue(
      Math.floor(
        y
      ),
      0,
      image.height -
        1
    );

  const channelCount =
    getScanQualityChannelCount(
      image.format
    );

  const bytesPerRow =
    image.bytesPerRow ??
    image.width *
      channelCount;

  const index =
    safeY *
      bytesPerRow +
    safeX *
      channelCount;

  const first =
    image.pixels[
      index
    ] ?? 0;

  const second =
    image.pixels[
      index +
        1
    ] ?? first;

  const third =
    image.pixels[
      index +
        2
    ] ?? first;

  const fourth =
    image.pixels[
      index +
        3
    ] ?? 255;

  switch (
    image.format
  ) {
    case 'rgba':
      return {
        red:
          normalizeScanQualityByte(
            first
          ),

        green:
          normalizeScanQualityByte(
            second
          ),

        blue:
          normalizeScanQualityByte(
            third
          ),

        alpha:
          normalizeScanQualityByte(
            fourth
          ),
      };

    case 'bgra':
      return {
        red:
          normalizeScanQualityByte(
            third
          ),

        green:
          normalizeScanQualityByte(
            second
          ),

        blue:
          normalizeScanQualityByte(
            first
          ),

        alpha:
          normalizeScanQualityByte(
            fourth
          ),
      };

    case 'rgb':
      return {
        red:
          normalizeScanQualityByte(
            first
          ),

        green:
          normalizeScanQualityByte(
            second
          ),

        blue:
          normalizeScanQualityByte(
            third
          ),

        alpha:
          1,
      };

    case 'bgr':
      return {
        red:
          normalizeScanQualityByte(
            third
          ),

        green:
          normalizeScanQualityByte(
            second
          ),

        blue:
          normalizeScanQualityByte(
            first
          ),

        alpha:
          1,
      };

    case 'grayscale': {
      const gray =
        normalizeScanQualityByte(
          first
        );

      return {
        red:
          gray,

        green:
          gray,

        blue:
          gray,

        alpha:
          1,
      };
    }

    default:
      return {
        red:
          0,

        green:
          0,

        blue:
          0,

        alpha:
          1,
      };
  }
}

/**
 * اختيار حجم عينة مناسب للأداء.
 *
 * بدل تحليل ملايين البكسلات،
 * نصغر التحليل داخليًا فقط بدون تعديل الصورة الأصلية.
 */
function getScanQualitySamplingDimensions(
  width:
    number,
  height:
    number,
  maximumDimension:
    number
): {
  width:
    number;

  height:
    number;

  stepX:
    number;

  stepY:
    number;
} {
  const safeMaximumDimension =
    Math.max(
      32,
      Math.floor(
        maximumDimension
      )
    );

  const largestDimension =
    Math.max(
      width,
      height
    );

  if (
    largestDimension <=
    safeMaximumDimension
  ) {
    return {
      width,

      height,

      stepX:
        1,

      stepY:
        1,
    };
  }

  const scale =
    safeMaximumDimension /
    largestDimension;

  const sampledWidth =
    Math.max(
      1,
      Math.round(
        width *
          scale
      )
    );

  const sampledHeight =
    Math.max(
      1,
      Math.round(
        height *
          scale
      )
    );

  return {
    width:
      sampledWidth,

    height:
      sampledHeight,

    stepX:
      width /
      sampledWidth,

    stepY:
      height /
      sampledHeight,
  };
}

/**
 * إنشاء نسخة مصغرة للتحليل فقط.
 */
function createScanQualitySampledImage(
  image:
    ScanQualityImageData,
  maximumDimension:
    number
): ScanQualitySampledImage {
  const sampling =
    getScanQualitySamplingDimensions(
      image.width,
      image.height,
      maximumDimension
    );

  const pixelCount =
    sampling.width *
    sampling.height;

  const luminance =
    new Float32Array(
      pixelCount
    );

  const red =
    new Float32Array(
      pixelCount
    );

  const green =
    new Float32Array(
      pixelCount
    );

  const blue =
    new Float32Array(
      pixelCount
    );

  for (
    let sampledY =
      0;
    sampledY <
    sampling.height;
    sampledY +=
      1
  ) {
    const sourceY =
      Math.min(
        image.height -
          1,
        Math.floor(
          (
            sampledY +
            0.5
          ) *
            sampling.stepY
        )
      );

    for (
      let sampledX =
        0;
      sampledX <
      sampling.width;
      sampledX +=
        1
    ) {
      const sourceX =
        Math.min(
          image.width -
            1,
          Math.floor(
            (
              sampledX +
              0.5
            ) *
              sampling.stepX
          )
        );

      const pixel =
        readScanQualityPixel(
          image,
          sourceX,
          sourceY
        );

      const index =
        sampledY *
          sampling.width +
        sampledX;

      red[
        index
      ] =
        pixel.red;

      green[
        index
      ] =
        pixel.green;

      blue[
        index
      ] =
        pixel.blue;

      luminance[
        index
      ] =
        getScanQualityLuminance(
          pixel.red,
          pixel.green,
          pixel.blue
        );
    }
  }

  return {
    width:
      sampling.width,

    height:
      sampling.height,

    luminance,

    red,

    green,

    blue,

    sampleStepX:
      sampling.stepX,

    sampleStepY:
      sampling.stepY,
  };
}

/**
 * تحويل TypedArray إلى Array عادي
 * عند الحاجة إلى Median وPercentiles.
 */
function scanQualityFloatArrayToNumbers(
  values:
    Float32Array
): number[] {
  const result =
    new Array<number>(
      values.length
    );

  for (
    let index =
      0;
    index <
    values.length;
    index +=
      1
  ) {
    result[
      index
    ] =
      values[
        index
      ] ?? 0;
  }

  return result;
}

/**
 * حساب متوسط TypedArray بكفاءة.
 */
function getScanQualityFloatArrayMean(
  values:
    Float32Array
): number {
  if (
    values.length ===
    0
  ) {
    return 0;
  }

  let total =
    0;

  for (
    let index =
      0;
    index <
    values.length;
    index +=
      1
  ) {
    total +=
      values[
        index
      ] ?? 0;
  }

  return safeScanQualityDivide(
    total,
    values.length,
    0
  );
}

/**
 * حساب الانحراف المعياري لـTypedArray.
 */
function getScanQualityFloatArrayStandardDeviation(
  values:
    Float32Array,
  mean:
    number
): number {
  if (
    values.length <
    2
  ) {
    return 0;
  }

  let total =
    0;

  for (
    let index =
      0;
    index <
    values.length;
    index +=
      1
  ) {
    const difference =
      (
        values[
          index
        ] ?? 0
      ) -
      mean;

    total +=
      difference *
      difference;
  }

  return Math.sqrt(
    safeScanQualityDivide(
      total,
      values.length,
      0
    )
  );
}

/**
 * حساب Local Contrast عن طريق مقارنة
 * كل بكسل بالبكسل المجاور له أفقيًا ورأسيًا.
 */
function calculateScanQualityLocalContrast(
  sampled:
    ScanQualitySampledImage
): number {
  if (
    sampled.width <
      2 ||
    sampled.height <
      2
  ) {
    return 0;
  }

  let contrastTotal =
    0;

  let comparisonCount =
    0;

  for (
    let y =
      0;
    y <
    sampled.height;
    y +=
      1
  ) {
    for (
      let x =
        0;
      x <
      sampled.width;
      x +=
        1
    ) {
      const index =
        y *
          sampled.width +
        x;

      const current =
        sampled.luminance[
          index
        ] ?? 0;

      if (
        x +
          1 <
        sampled.width
      ) {
        const right =
          sampled.luminance[
            index +
              1
          ] ?? current;

        contrastTotal +=
          Math.abs(
            current -
            right
          );

        comparisonCount +=
          1;
      }

      if (
        y +
          1 <
        sampled.height
      ) {
        const below =
          sampled.luminance[
            index +
              sampled.width
          ] ?? current;

        contrastTotal +=
          Math.abs(
            current -
            below
          );

        comparisonCount +=
          1;
      }
    }
  }

  return normalizeScanQualityValue(
    safeScanQualityDivide(
      contrastTotal,
      comparisonCount,
      0
    )
  );
}

/**
 * حساب قوة الحواف باستخدام Sobel Operator.
 */
function calculateScanQualitySobelMetrics(
  sampled:
    ScanQualitySampledImage
): {
  edgeStrength:
    number;

  edgeDensity:
    number;
} {
  if (
    sampled.width <
      3 ||
    sampled.height <
      3
  ) {
    return {
      edgeStrength:
        0,

      edgeDensity:
        0,
    };
  }

  let totalStrength =
    0;

  let edgeCount =
    0;

  let measuredCount =
    0;

  const edgeThreshold =
    0.12;

  for (
    let y =
      1;
    y <
    sampled.height -
      1;
    y +=
      1
  ) {
    for (
      let x =
        1;
      x <
      sampled.width -
        1;
      x +=
        1
    ) {
      const topLeft =
        sampled.luminance[
          (
            y -
            1
          ) *
            sampled.width +
          (
            x -
            1
          )
        ] ?? 0;

      const top =
        sampled.luminance[
          (
            y -
            1
          ) *
            sampled.width +
          x
        ] ?? 0;

      const topRight =
        sampled.luminance[
          (
            y -
            1
          ) *
            sampled.width +
          (
            x +
            1
          )
        ] ?? 0;

      const left =
        sampled.luminance[
          y *
            sampled.width +
          (
            x -
            1
          )
        ] ?? 0;

      const right =
        sampled.luminance[
          y *
            sampled.width +
          (
            x +
            1
          )
        ] ?? 0;

      const bottomLeft =
        sampled.luminance[
          (
            y +
            1
          ) *
            sampled.width +
          (
            x -
            1
          )
        ] ?? 0;

      const bottom =
        sampled.luminance[
          (
            y +
            1
          ) *
            sampled.width +
          x
        ] ?? 0;

      const bottomRight =
        sampled.luminance[
          (
            y +
            1
          ) *
            sampled.width +
          (
            x +
            1
          )
        ] ?? 0;

      const gradientX =
        -topLeft +
        topRight -
        2 *
          left +
        2 *
          right -
        bottomLeft +
        bottomRight;

      const gradientY =
        -topLeft -
        2 *
          top -
        topRight +
        bottomLeft +
        2 *
          bottom +
        bottomRight;

      const magnitude =
        Math.sqrt(
          gradientX *
            gradientX +
          gradientY *
            gradientY
        ) /
        4;

      const normalizedMagnitude =
        normalizeScanQualityValue(
          magnitude
        );

      totalStrength +=
        normalizedMagnitude;

      if (
        normalizedMagnitude >=
        edgeThreshold
      ) {
        edgeCount +=
          1;
      }

      measuredCount +=
        1;
    }
  }

  return {
    edgeStrength:
      normalizeScanQualityValue(
        safeScanQualityDivide(
          totalStrength,
          measuredCount,
          0
        )
      ),

    edgeDensity:
      normalizeScanQualityValue(
        safeScanQualityDivide(
          edgeCount,
          measuredCount,
          0
        )
      ),
  };
}

/**
 * Laplacian Variance.
 *
 * كلما زادت القيمة، كانت الصورة أكثر حدة.
 */
function calculateScanQualityLaplacianVariance(
  sampled:
    ScanQualitySampledImage
): number {
  if (
    sampled.width <
      3 ||
    sampled.height <
      3
  ) {
    return 0;
  }

  let laplacianTotal =
    0;

  let squaredTotal =
    0;

  let measuredCount =
    0;

  for (
    let y =
      1;
    y <
    sampled.height -
      1;
    y +=
      1
  ) {
    for (
      let x =
        1;
      x <
      sampled.width -
        1;
      x +=
        1
    ) {
      const centerIndex =
        y *
          sampled.width +
        x;

      const center =
        sampled.luminance[
          centerIndex
        ] ?? 0;

      const top =
        sampled.luminance[
          centerIndex -
            sampled.width
        ] ?? center;

      const bottom =
        sampled.luminance[
          centerIndex +
            sampled.width
        ] ?? center;

      const left =
        sampled.luminance[
          centerIndex -
            1
        ] ?? center;

      const right =
        sampled.luminance[
          centerIndex +
            1
        ] ?? center;

      const laplacian =
        top +
        bottom +
        left +
        right -
        4 *
          center;

      laplacianTotal +=
        laplacian;

      squaredTotal +=
        laplacian *
        laplacian;

      measuredCount +=
        1;
    }
  }

  if (
    measuredCount ===
    0
  ) {
    return 0;
  }

  const mean =
    laplacianTotal /
    measuredCount;

  const variance =
    squaredTotal /
      measuredCount -
    mean *
      mean;

  return Math.max(
    0,
    variance
  );
}

/**
 * حساب نتيجة الإضاءة من 0 إلى 1.
 */
function calculateScanQualityBrightnessScore(
  metrics:
    Omit<
      ScanQualityBrightnessMetrics,
      'score'
    >,
  config:
    ScanQualityImageConfig
): number {
  const meanScore =
    metrics.mean <
      config.minimumMeanBrightness
      ? remapScanQualityValue(
          metrics.mean,
          0,
          config.minimumMeanBrightness,
          0,
          1
        )
      : metrics.mean >
          config.maximumMeanBrightness
        ? remapScanQualityValue(
            metrics.mean,
            config.maximumMeanBrightness,
            1,
            1,
            0
          )
        : 1;

  const darkRatioScore =
    remapScanQualityValue(
      metrics.darkPixelRatio,
      config.maximumDarkPixelRatio,
      1,
      1,
      0
    );

  const brightRatioScore =
    remapScanQualityValue(
      metrics.brightPixelRatio,
      config.maximumBrightPixelRatio,
      1,
      1,
      0
    );

  const blackClipScore =
    remapScanQualityValue(
      metrics.clippedBlackRatio,
      config.maximumClippedBlackRatio,
      1,
      1,
      0
    );

  const whiteClipScore =
    remapScanQualityValue(
      metrics.clippedWhiteRatio,
      config.maximumClippedWhiteRatio,
      1,
      1,
      0
    );

  const dynamicRangeScore =
    remapScanQualityValue(
      metrics.dynamicRange,
      0,
      config.minimumDynamicRange,
      0,
      1
    );

  return getWeightedScanQualityScore([
    {
      score:
        meanScore,

      weight:
        0.34,
    },
    {
      score:
        darkRatioScore,

      weight:
        0.16,
    },
    {
      score:
        brightRatioScore,

      weight:
        0.16,
    },
    {
      score:
        blackClipScore,

      weight:
        0.10,
    },
    {
      score:
        whiteClipScore,

      weight:
        0.10,
    },
    {
      score:
        dynamicRangeScore,

      weight:
        0.14,
    },
  ]);
}

/**
 * تحليل سطوع الصورة.
 */
export function analyzeScanQualityBrightness(
  sampled:
    ScanQualitySampledImage,
  config:
    ScanQualityImageConfig
): ScanQualityBrightnessMetrics {
  if (
    sampled.luminance.length ===
    0
  ) {
    return createEmptyScanQualityBrightnessMetrics();
  }

  let total =
    0;

  let minimum =
    1;

  let maximum =
    0;

  let darkPixelCount =
    0;

  let brightPixelCount =
    0;

  let clippedBlackCount =
    0;

  let clippedWhiteCount =
    0;

  for (
    let index =
      0;
    index <
    sampled.luminance.length;
    index +=
      1
  ) {
    const luminance =
      normalizeScanQualityValue(
        sampled.luminance[
          index
        ] ?? 0
      );

    total +=
      luminance;

    minimum =
      Math.min(
        minimum,
        luminance
      );

    maximum =
      Math.max(
        maximum,
        luminance
      );

    if (
      luminance <=
      config.darkLuminanceThreshold
    ) {
      darkPixelCount +=
        1;
    }

    if (
      luminance >=
      config.brightLuminanceThreshold
    ) {
      brightPixelCount +=
        1;
    }

    if (
      luminance <=
      config.clippedBlackThreshold
    ) {
      clippedBlackCount +=
        1;
    }

    if (
      luminance >=
      config.clippedWhiteThreshold
    ) {
      clippedWhiteCount +=
        1;
    }
  }

  const pixelCount =
    sampled.luminance.length;

  const mean =
    safeScanQualityDivide(
      total,
      pixelCount,
      0
    );

  const luminanceValues =
    scanQualityFloatArrayToNumbers(
      sampled.luminance
    );

  const median =
    getScanQualityMedian(
      luminanceValues
    );

  const percentile05 =
    getScanQualityPercentile(
      luminanceValues,
      0.05
    );

  const percentile95 =
    getScanQualityPercentile(
      luminanceValues,
      0.95
    );

  const metricsWithoutScore = {
    mean:
      normalizeScanQualityValue(
        mean
      ),

    median:
      normalizeScanQualityValue(
        median
      ),

    minimum:
      normalizeScanQualityValue(
        minimum
      ),

    maximum:
      normalizeScanQualityValue(
        maximum
      ),

    darkPixelRatio:
      normalizeScanQualityValue(
        safeScanQualityDivide(
          darkPixelCount,
          pixelCount,
          0
        )
      ),

    brightPixelRatio:
      normalizeScanQualityValue(
        safeScanQualityDivide(
          brightPixelCount,
          pixelCount,
          0
        )
      ),

    clippedBlackRatio:
      normalizeScanQualityValue(
        safeScanQualityDivide(
          clippedBlackCount,
          pixelCount,
          0
        )
      ),

    clippedWhiteRatio:
      normalizeScanQualityValue(
        safeScanQualityDivide(
          clippedWhiteCount,
          pixelCount,
          0
        )
      ),

    dynamicRange:
      normalizeScanQualityValue(
        percentile95 -
        percentile05
      ),
  };

  return {
    ...metricsWithoutScore,

    score:
      calculateScanQualityBrightnessScore(
        metricsWithoutScore,
        config
      ),
  };
}

/**
 * تحليل التباين العام والمحلي.
 */
export function analyzeScanQualityContrast(
  sampled:
    ScanQualitySampledImage,
  config:
    ScanQualityImageConfig
): ScanQualityContrastMetrics {
  if (
    sampled.luminance.length ===
    0
  ) {
    return createEmptyScanQualityContrastMetrics();
  }

  const mean =
    getScanQualityFloatArrayMean(
      sampled.luminance
    );

  const standardDeviation =
    getScanQualityFloatArrayStandardDeviation(
      sampled.luminance,
      mean
    );

  const luminanceValues =
    scanQualityFloatArrayToNumbers(
      sampled.luminance
    );

  const percentile10 =
    getScanQualityPercentile(
      luminanceValues,
      0.10
    );

  const percentile90 =
    getScanQualityPercentile(
      luminanceValues,
      0.90
    );

  const percentileRange =
    normalizeScanQualityValue(
      percentile90 -
      percentile10
    );

  const localContrast =
    calculateScanQualityLocalContrast(
      sampled
    );

  const globalScore =
    remapScanQualityValue(
      standardDeviation,
      0,
      config.minimumGlobalContrast,
      0,
      1
    );

  const percentileScore =
    remapScanQualityValue(
      percentileRange,
      0,
      config.minimumDynamicRange,
      0,
      1
    );

  const localScore =
    remapScanQualityValue(
      localContrast,
      0,
      config.minimumLocalContrast,
      0,
      1
    );

  return {
    standardDeviation:
      normalizeScanQualityValue(
        standardDeviation
      ),

    percentileRange,

    localContrast,

    score:
      getWeightedScanQualityScore([
        {
          score:
            globalScore,

          weight:
            0.40,
        },
        {
          score:
            percentileScore,

          weight:
            0.25,
        },
        {
          score:
            localScore,

          weight:
            0.35,
        },
      ]),
  };
}

/**
 * تحليل حدة الصورة والاهتزاز.
 */
export function analyzeScanQualitySharpness(
  sampled:
    ScanQualitySampledImage,
  config:
    ScanQualityImageConfig
): ScanQualitySharpnessMetrics {
  const laplacianVariance =
    calculateScanQualityLaplacianVariance(
      sampled
    );

  const sobel =
    calculateScanQualitySobelMetrics(
      sampled
    );

  /*
   * القيم هنا ليست مطلقة لأن الصور تختلف.
   * لذلك نحول كل Metric إلى Score
   * ثم ندمجهم.
   */
  const laplacianScore =
    remapScanQualityValue(
      laplacianVariance,
      0.00015,
      0.012,
      0,
      1
    );

  const edgeStrengthScore =
    remapScanQualityValue(
      sobel.edgeStrength,
      0.012,
      0.11,
      0,
      1
    );

  const edgeDensityScore =
    remapScanQualityValue(
      sobel.edgeDensity,
      0.015,
      0.22,
      0,
      1
    );

  const score =
    getWeightedScanQualityScore([
      {
        score:
          laplacianScore,

        weight:
          0.50,
      },
      {
        score:
          edgeStrengthScore,

        weight:
          0.30,
      },
      {
        score:
          edgeDensityScore,

        weight:
          0.20,
      },
    ]);

  /*
   * نستخدم config.minimumSharpnessScore
   * في القرار، وليس داخل الحساب نفسه.
   */
  void config;

  return {
    laplacianVariance:
      Math.max(
        0,
        laplacianVariance
      ),

    edgeStrength:
      sobel.edgeStrength,

    edgeDensity:
      sobel.edgeDensity,

    score,
  };
}

/**
 * إنشاء مشاكل أبعاد الصورة.
 */
function createScanQualityDimensionIssues(
  image:
    ScanQualityImageData,
  config:
    ScanQualityImageConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  if (
    image.width <
      config.minimumWidth ||
    image.height <
      config.minimumHeight
  ) {
    const widthRatio =
      safeScanQualityDivide(
        image.width,
        config.minimumWidth,
        0
      );

    const heightRatio =
      safeScanQualityDivide(
        image.height,
        config.minimumHeight,
        0
      );

    issues.push(
      createScanQualityIssue({
        code:
          'image-too-small',

        severity:
          'error',

        stage:
          'pre-segmentation',

        messageKey:
          'retake-photo',

        confidence:
          1 -
          Math.min(
            widthRatio,
            heightRatio
          ),

        debugMessage:
          `Image dimensions are too small: ${image.width}x${image.height}.`,

        details: {
          width:
            image.width,

          height:
            image.height,

          minimumWidth:
            config.minimumWidth,

          minimumHeight:
            config.minimumHeight,
        },
      })
    );
  }

  if (
    image.width >
      config.maximumWidth ||
    image.height >
      config.maximumHeight
  ) {
    const widthRatio =
      safeScanQualityDivide(
        image.width,
        config.maximumWidth,
        1
      );

    const heightRatio =
      safeScanQualityDivide(
        image.height,
        config.maximumHeight,
        1
      );

    issues.push(
      createScanQualityIssue({
        code:
          'image-too-large',

        severity:
          'warning',

        stage:
          'pre-segmentation',

        messageKey:
          'retake-photo',

        confidence:
          normalizeScanQualityValue(
            Math.max(
              widthRatio,
              heightRatio
            ) -
            1
          ),

        debugMessage:
          `Image dimensions are larger than the configured maximum: ${image.width}x${image.height}.`,

        details: {
          width:
            image.width,

          height:
            image.height,

          maximumWidth:
            config.maximumWidth,

          maximumHeight:
            config.maximumHeight,
        },
      })
    );
  }

  return issues;
}

/**
 * إنشاء مشاكل الإضاءة والتعريض.
 */
function createScanQualityBrightnessIssues(
  metrics:
    ScanQualityBrightnessMetrics,
  config:
    ScanQualityImageConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  if (
    metrics.mean <
      config.minimumMeanBrightness
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'image-too-dark',

        severity:
          metrics.mean <
            config.minimumMeanBrightness *
              0.55
            ? 'critical'
            : 'error',

        stage:
          'pre-segmentation',

        messageKey:
          'improve-lighting',

        confidence:
          1 -
          safeScanQualityDivide(
            metrics.mean,
            config.minimumMeanBrightness,
            0
          ),

        debugMessage:
          `Mean brightness is too low: ${metrics.mean.toFixed(
            4
          )}.`,

        details: {
          mean:
            metrics.mean,

          minimum:
            config.minimumMeanBrightness,
        },
      })
    );
  }

  if (
    metrics.mean >
      config.maximumMeanBrightness
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'image-too-bright',

        severity:
          metrics.mean >
            0.97
            ? 'critical'
            : 'error',

        stage:
          'pre-segmentation',

        messageKey:
          'reduce-lighting',

        confidence:
          remapScanQualityValue(
            metrics.mean,
            config.maximumMeanBrightness,
            1,
            0,
            1
          ),

        debugMessage:
          `Mean brightness is too high: ${metrics.mean.toFixed(
            4
          )}.`,

        details: {
          mean:
            metrics.mean,

          maximum:
            config.maximumMeanBrightness,
        },
      })
    );
  }

  if (
    metrics.darkPixelRatio >
      config.maximumDarkPixelRatio ||
    metrics.clippedBlackRatio >
      config.maximumClippedBlackRatio
  ) {
    const darkConfidence =
      Math.max(
        remapScanQualityValue(
          metrics.darkPixelRatio,
          config.maximumDarkPixelRatio,
          1,
          0,
          1
        ),
        remapScanQualityValue(
          metrics.clippedBlackRatio,
          config.maximumClippedBlackRatio,
          1,
          0,
          1
        )
      );

    issues.push(
      createScanQualityIssue({
        code:
          'image-underexposed',

        severity:
          darkConfidence >
            0.65
            ? 'error'
            : 'warning',

        stage:
          'pre-segmentation',

        messageKey:
          'improve-lighting',

        confidence:
          darkConfidence,

        debugMessage:
          'A large portion of the image is underexposed or clipped to black.',

        details: {
          darkPixelRatio:
            metrics.darkPixelRatio,

          clippedBlackRatio:
            metrics.clippedBlackRatio,
        },
      })
    );
  }

  if (
    metrics.brightPixelRatio >
      config.maximumBrightPixelRatio ||
    metrics.clippedWhiteRatio >
      config.maximumClippedWhiteRatio
  ) {
    const brightConfidence =
      Math.max(
        remapScanQualityValue(
          metrics.brightPixelRatio,
          config.maximumBrightPixelRatio,
          1,
          0,
          1
        ),
        remapScanQualityValue(
          metrics.clippedWhiteRatio,
          config.maximumClippedWhiteRatio,
          1,
          0,
          1
        )
      );

    issues.push(
      createScanQualityIssue({
        code:
          'image-overexposed',

        severity:
          brightConfidence >
            0.65
            ? 'error'
            : 'warning',

        stage:
          'pre-segmentation',

        messageKey:
          'reduce-lighting',

        confidence:
          brightConfidence,

        debugMessage:
          'A large portion of the image is overexposed or clipped to white.',

        details: {
          brightPixelRatio:
            metrics.brightPixelRatio,

          clippedWhiteRatio:
            metrics.clippedWhiteRatio,
        },
      })
    );
  }

  return issues;
}

/**
 * إنشاء مشاكل التباين.
 */
function createScanQualityContrastIssues(
  metrics:
    ScanQualityContrastMetrics,
  brightness:
    ScanQualityBrightnessMetrics,
  config:
    ScanQualityImageConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  const globalLow =
    metrics.standardDeviation <
    config.minimumGlobalContrast;

  const localLow =
    metrics.localContrast <
    config.minimumLocalContrast;

  const dynamicRangeLow =
    brightness.dynamicRange <
    config.minimumDynamicRange;

  if (
    globalLow &&
    localLow
  ) {
    const globalConfidence =
      1 -
      safeScanQualityDivide(
        metrics.standardDeviation,
        config.minimumGlobalContrast,
        0
      );

    const localConfidence =
      1 -
      safeScanQualityDivide(
        metrics.localContrast,
        config.minimumLocalContrast,
        0
      );

    const confidence =
      normalizeScanQualityValue(
        Math.max(
          globalConfidence,
          localConfidence
        )
      );

    issues.push(
      createScanQualityIssue({
        code:
          'image-low-contrast',

        severity:
          dynamicRangeLow
            ? 'error'
            : 'warning',

        stage:
          'pre-segmentation',

        messageKey:
          'use-different-background',

        confidence,

        debugMessage:
          'The image has insufficient global and local contrast.',

        details: {
          standardDeviation:
            metrics.standardDeviation,

          localContrast:
            metrics.localContrast,

          dynamicRange:
            brightness.dynamicRange,
        },
      })
    );
  }

  return issues;
}

/**
 * إنشاء مشاكل الحدة والاهتزاز.
 */
function createScanQualitySharpnessIssues(
  metrics:
    ScanQualitySharpnessMetrics,
  config:
    ScanQualityImageConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  if (
    metrics.score <
      config.severeBlurScore
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'image-severely-blurry',

        severity:
          'critical',

        stage:
          'pre-segmentation',

        messageKey:
          'hold-still',

        confidence:
          1 -
          safeScanQualityDivide(
            metrics.score,
            config.severeBlurScore,
            0
          ),

        debugMessage:
          `Image sharpness is severely low: ${metrics.score.toFixed(
            4
          )}.`,

        details: {
          sharpnessScore:
            metrics.score,

          laplacianVariance:
            metrics.laplacianVariance,

          edgeStrength:
            metrics.edgeStrength,

          edgeDensity:
            metrics.edgeDensity,
        },
      })
    );

    return issues;
  }

  if (
    metrics.score <
      config.minimumSharpnessScore
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'image-blurry',

        severity:
          'error',

        stage:
          'pre-segmentation',

        messageKey:
          'hold-still',

        confidence:
          1 -
          safeScanQualityDivide(
            metrics.score,
            config.minimumSharpnessScore,
            0
          ),

        debugMessage:
          `Image sharpness is below the accepted threshold: ${metrics.score.toFixed(
            4
          )}.`,

        details: {
          sharpnessScore:
            metrics.score,

          minimumSharpnessScore:
            config.minimumSharpnessScore,

          laplacianVariance:
            metrics.laplacianVariance,

          edgeStrength:
            metrics.edgeStrength,

          edgeDensity:
            metrics.edgeDensity,
        },
      })
    );
  }

  return issues;
}

/**
 * بناء نتيجة فاشلة عند وجود Input غير صالح.
 */
function createInvalidScanQualityPreResult(
  startedAt:
    number,
  code:
    Extract<
      ScanQualityIssueCode,
      | 'invalid-input'
      | 'invalid-image-size'
      | 'invalid-pixel-buffer'
    >,
  debugMessage:
    string
): ScanQualityPreSegmentationResult {
  const issue =
    createScanQualityIssue({
      code,

      severity:
        'critical',

      stage:
        'pre-segmentation',

      messageKey:
        'could-not-detect-item',

      confidence:
        1,

      debugMessage,
    });

  return {
    stage:
      'pre-segmentation',

    passed:
      false,

    score:
      0,

    decision:
      'reject',

    brightness:
      createEmptyScanQualityBrightnessMetrics(),

    contrast:
      createEmptyScanQualityContrastMetrics(),

    sharpness:
      createEmptyScanQualitySharpnessMetrics(),

    issues: [
      issue,
    ],

    primaryIssue:
      issue,

    userMessageKey:
      issue.messageKey,

    processingTimeMs:
      getScanQualityElapsedTime(
        startedAt
      ),
  };
}

/**
 * تنفيذ فحص الصورة قبل BiRefNet.
 *
 * هذا الفحص يحل مشكلة:
 * - الصورة المظلمة.
 * - الصورة شديدة الإضاءة.
 * - الصورة المهزوزة.
 * - التباين شديد الضعف.
 *
 * المشاكل المرتبطة بالقطعة نفسها والماسك
 * سيتم تنفيذها في Part 3 بعد الفصل.
 */
export function analyzeScanQualityBeforeSegmentation(
  image:
    ScanQualityImageData,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): ScanQualityPreSegmentationResult {
  const startedAt =
    Date.now();

  const validation =
    validateScanQualityImageData(
      image
    );

  if (
    !validation.valid
  ) {
    const reason =
      validation.reason ??
      'Unknown image validation failure.';

    const code:
      Extract<
        ScanQualityIssueCode,
        | 'invalid-input'
        | 'invalid-image-size'
        | 'invalid-pixel-buffer'
      > =
      reason
        .toLowerCase()
        .includes(
          'buffer'
        )
        ? 'invalid-pixel-buffer'
        : reason
              .toLowerCase()
              .includes(
                'width'
              ) ||
            reason
              .toLowerCase()
              .includes(
                'height'
              )
          ? 'invalid-image-size'
          : 'invalid-input';

    return createInvalidScanQualityPreResult(
      startedAt,
      code,
      reason
    );
  }

  const sampled =
    createScanQualitySampledImage(
      image,
      config.image
        .sampleMaximumDimension
    );

  const brightness =
    analyzeScanQualityBrightness(
      sampled,
      config.image
    );

  const contrast =
    analyzeScanQualityContrast(
      sampled,
      config.image
    );

  const sharpness =
    analyzeScanQualitySharpness(
      sampled,
      config.image
    );

  const issues:
    ScanQualityIssue[] = [
      ...createScanQualityDimensionIssues(
        image,
        config.image
      ),

      ...createScanQualityBrightnessIssues(
        brightness,
        config.image
      ),

      ...createScanQualityContrastIssues(
        contrast,
        brightness,
        config.image
      ),

      ...createScanQualitySharpnessIssues(
        sharpness,
        config.image
      ),
    ];

  const score =
    getWeightedScanQualityScore([
      {
        score:
          brightness.score,

        weight:
          config.weights
            .brightness,
      },
      {
        score:
          contrast.score,

        weight:
          config.weights
            .contrast,
      },
      {
        score:
          sharpness.score,

        weight:
          config.weights
            .sharpness,
      },
    ]);

  if (
    score <
      config.decision
        .retryScore &&
    issues.length ===
      0
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'quality-score-too-low',

        severity:
          'error',

        stage:
          'pre-segmentation',

        messageKey:
          'retake-photo',

        confidence:
          1 -
          safeScanQualityDivide(
            score,
            config.decision
              .retryScore,
            0
          ),

        debugMessage:
          `Pre-segmentation quality score is too low: ${score.toFixed(
            4
          )}.`,

        details: {
          score,

          retryThreshold:
            config.decision
              .retryScore,
        },
      })
    );
  }

  const sortedIssues =
    sortScanQualityIssues(
      issues
    );

  const primaryIssue =
    selectPrimaryScanQualityIssue(
      sortedIssues
    );

  const decision =
    resolveScanQualityDecision(
      score,
      sortedIssues,
      config
    );

  return {
    stage:
      'pre-segmentation',

    passed:
      isScanQualityDecisionAccepted(
        decision
      ),

    score,

    decision,

    brightness,

    contrast,

    sharpness,

    issues:
      sortedIssues,

    primaryIssue,

    userMessageKey:
      primaryIssue
        ?.messageKey ??
      'ready',

    processingTimeMs:
      getScanQualityElapsedTime(
        startedAt
      ),
  };
}

/**
 * Alias مختصر للاستخدام داخل الخدمات.
 */
export const runScanQualityPreCheck =
  analyzeScanQualityBeforeSegmentation;

/**
 * Debug Summary لمرحلة ما قبل الفصل.
 */
export function getScanQualityPreCheckDebugSummary(
  result:
    ScanQualityPreSegmentationResult
): string {
  return [
    `Stage: ${result.stage}`,
    `Passed: ${String(
      result.passed
    )}`,
    `Decision: ${result.decision}`,
    `Score: ${result.score.toFixed(
      4
    )}`,
    `Brightness: ${result.brightness.score.toFixed(
      4
    )}`,
    `Brightness mean: ${result.brightness.mean.toFixed(
      4
    )}`,
    `Dark ratio: ${result.brightness.darkPixelRatio.toFixed(
      4
    )}`,
    `Bright ratio: ${result.brightness.brightPixelRatio.toFixed(
      4
    )}`,
    `Contrast: ${result.contrast.score.toFixed(
      4
    )}`,
    `Global contrast: ${result.contrast.standardDeviation.toFixed(
      4
    )}`,
    `Local contrast: ${result.contrast.localContrast.toFixed(
      4
    )}`,
    `Sharpness: ${result.sharpness.score.toFixed(
      4
    )}`,
    `Laplacian variance: ${result.sharpness.laplacianVariance.toFixed(
      6
    )}`,
    `Edge strength: ${result.sharpness.edgeStrength.toFixed(
      4
    )}`,
    `Issues: ${result.issues.length}`,
    createScanQualityIssueDebugSummary(
      result.issues
    ),
  ].join(
    '\n'
  );
}

// End of Part 2/4
// scan/core/quality/ScanQualityGate.ts
// Part 3/4
//
// تحليل Alpha Mask بعد تشغيل BiRefNet.
//
// هذا الجزء مسؤول عن:
// 1) اكتشاف خروج القطعة خارج الكادر.
// 2) اكتشاف أكثر من جسم داخل الصورة.
// 3) اكتشاف جسم ثانوي أو يد محتملة.
// 4) اكتشاف ضعف الفصل بين القطعة والخلفية.
// 5) اكتشاف تفكك الماسك والثقوب والحواف غير المؤكدة.
// 6) تحديد حجم القطعة وتمركزها داخل الصورة.

type ScanQualityBinaryMask = {
  width:
    number;

  height:
    number;

  data:
    Uint8Array;
};

type ScanQualityMaskAnalysisBuffers = {
  normalized:
    Float32Array;

  binary:
    Uint8Array;

  soft:
    Uint8Array;

  uncertain:
    Uint8Array;
};

type ScanQualityComponentInternal = {
  id:
    number;

  pixelCount:
    number;

  minimumX:
    number;

  minimumY:
    number;

  maximumX:
    number;

  maximumY:
    number;

  sumX:
    number;

  sumY:
    number;

  touchesTop:
    boolean;

  touchesBottom:
    boolean;

  touchesLeft:
    boolean;

  touchesRight:
    boolean;
};

type ScanQualityColorAccumulator = {
  red:
    number;

  green:
    number;

  blue:
    number;

  luminance:
    number;

  redSquared:
    number;

  greenSquared:
    number;

  blueSquared:
    number;

  count:
    number;
};

/**
 * قراءة قيمة Mask بعد تحويلها إلى 0..1.
 */
export function readNormalizedScanQualityMaskValue(
  mask:
    ScanQualityMaskData,
  index:
    number
): number {
  const rawValue =
    mask.data[
      index
    ] ?? 0;

  const inferredRange:
    ScanQualityMaskValueRange =
    mask.valueRange ??
    (
      rawValue >
        1
        ? 'zero-to-255'
        : 'zero-to-one'
    );

  return normalizeScanQualityMaskValue(
    rawValue,
    inferredRange
  );
}

/**
 * تحضير الماسك إلى Buffers منفصلة
 * حتى لا نكرر قراءة القيم في كل فحص.
 */
function createScanQualityMaskAnalysisBuffers(
  mask:
    ScanQualityMaskData,
  config:
    ScanQualityMaskConfig
): ScanQualityMaskAnalysisBuffers {
  const pixelCount =
    mask.width *
    mask.height;

  const normalized =
    new Float32Array(
      pixelCount
    );

  const binary =
    new Uint8Array(
      pixelCount
    );

  const soft =
    new Uint8Array(
      pixelCount
    );

  const uncertain =
    new Uint8Array(
      pixelCount
    );

  for (
    let index =
      0;
    index <
      pixelCount;
    index +=
      1
  ) {
    const value =
      readNormalizedScanQualityMaskValue(
        mask,
        index
      );

    normalized[
      index
    ] =
      value;

    if (
      value >=
      config.foregroundThreshold
    ) {
      binary[
        index
      ] =
        1;
    }

    if (
      value >=
        config.softForegroundThreshold &&
      value <
        config.confidentForegroundThreshold
    ) {
      soft[
        index
      ] =
        1;
    }

    if (
      value >=
        config.uncertainMinimum &&
      value <=
        config.uncertainMaximum
    ) {
      uncertain[
        index
      ] =
        1;
    }
  }

  return {
    normalized,

    binary,

    soft,

    uncertain,
  };
}

/**
 * إنشاء Bounding Box من الإحداثيات.
 */
function createScanQualityBoundingBoxFromCoordinates(
  minimumX:
    number,
  minimumY:
    number,
  maximumX:
    number,
  maximumY:
    number,
  canvasWidth:
    number,
  canvasHeight:
    number
): ScanQualityBoundingBox {
  if (
    maximumX <
      minimumX ||
    maximumY <
      minimumY
  ) {
    return createEmptyScanQualityBoundingBox();
  }

  const width =
    maximumX -
    minimumX +
    1;

  const height =
    maximumY -
    minimumY +
    1;

  const area =
    width *
    height;

  const canvasArea =
    canvasWidth *
    canvasHeight;

  return {
    x:
      minimumX,

    y:
      minimumY,

    width,

    height,

    right:
      maximumX,

    bottom:
      maximumY,

    centerX:
      minimumX +
      width /
        2,

    centerY:
      minimumY +
      height /
        2,

    area,

    areaRatio:
      normalizeScanQualityValue(
        safeScanQualityDivide(
          area,
          canvasArea,
          0
        )
      ),
  };
}

/**
 * حساب Bounding Box لكل Foreground.
 */
function calculateScanQualityForegroundBoundingBox(
  binaryMask:
    Uint8Array,
  width:
    number,
  height:
    number
): ScanQualityBoundingBox |
  null {
  let minimumX =
    width;

  let minimumY =
    height;

  let maximumX =
    -1;

  let maximumY =
    -1;

  for (
    let y =
      0;
    y <
      height;
    y +=
      1
  ) {
    for (
      let x =
        0;
      x <
        width;
      x +=
        1
    ) {
      const index =
        y *
          width +
        x;

      if (
        binaryMask[
          index
        ] !==
          1
      ) {
        continue;
      }

      minimumX =
        Math.min(
          minimumX,
          x
        );

      minimumY =
        Math.min(
          minimumY,
          y
        );

      maximumX =
        Math.max(
          maximumX,
          x
        );

      maximumY =
        Math.max(
          maximumY,
          y
        );
    }
  }

  if (
    maximumX <
      0 ||
    maximumY <
      0
  ) {
    return null;
  }

  return createScanQualityBoundingBoxFromCoordinates(
    minimumX,
    minimumY,
    maximumX,
    maximumY,
    width,
    height
  );
}

/**
 * فحص نسبة ملامسة الماسك لحواف الصورة.
 */
function calculateScanQualityEdgeContact(
  binaryMask:
    Uint8Array,
  width:
    number,
  height:
    number,
  config:
    ScanQualityMaskConfig
): ScanQualityEdgeContact {
  if (
    width <=
      0 ||
    height <=
      0
  ) {
    return createEmptyScanQualityEdgeContact();
  }

  const marginX =
    Math.max(
      1,
      Math.round(
        width *
          config.edgeMarginRatio
      )
    );

  const marginY =
    Math.max(
      1,
      Math.round(
        height *
          config.edgeMarginRatio
      )
    );

  let topForeground =
    0;

  let bottomForeground =
    0;

  let leftForeground =
    0;

  let rightForeground =
    0;

  const topTotal =
    width *
    marginY;

  const bottomTotal =
    width *
    marginY;

  const leftTotal =
    height *
    marginX;

  const rightTotal =
    height *
    marginX;

  for (
    let y =
      0;
    y <
      marginY;
    y +=
      1
  ) {
    for (
      let x =
        0;
      x <
        width;
      x +=
        1
    ) {
      if (
        binaryMask[
          y *
            width +
          x
        ] ===
          1
      ) {
        topForeground +=
          1;
      }
    }
  }

  for (
    let y =
      Math.max(
        0,
        height -
          marginY
      );
    y <
      height;
    y +=
      1
  ) {
    for (
      let x =
        0;
      x <
        width;
      x +=
        1
    ) {
      if (
        binaryMask[
          y *
            width +
          x
        ] ===
          1
      ) {
        bottomForeground +=
          1;
      }
    }
  }

  for (
    let y =
      0;
    y <
      height;
    y +=
      1
  ) {
    for (
      let x =
        0;
      x <
        marginX;
      x +=
        1
    ) {
      if (
        binaryMask[
          y *
            width +
          x
        ] ===
          1
      ) {
        leftForeground +=
          1;
      }
    }
  }

  for (
    let y =
      0;
    y <
      height;
    y +=
      1
  ) {
    for (
      let x =
        Math.max(
          0,
          width -
            marginX
        );
      x <
        width;
      x +=
        1
    ) {
      if (
        binaryMask[
          y *
            width +
          x
        ] ===
          1
      ) {
        rightForeground +=
          1;
      }
    }
  }

  const topRatio =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        topForeground,
        topTotal,
        0
      )
    );

  const bottomRatio =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        bottomForeground,
        bottomTotal,
        0
      )
    );

  const leftRatio =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        leftForeground,
        leftTotal,
        0
      )
    );

  const rightRatio =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        rightForeground,
        rightTotal,
        0
      )
    );

  const top =
    topRatio >
    config.maximumEdgeContactRatio;

  const bottom =
    bottomRatio >
    config.maximumEdgeContactRatio;

  const left =
    leftRatio >
    config.maximumEdgeContactRatio;

  const right =
    rightRatio >
    config.maximumEdgeContactRatio;

  const edgeCount =
    Number(
      top
    ) +
    Number(
      bottom
    ) +
    Number(
      left
    ) +
    Number(
      right
    );

  return {
    top,

    bottom,

    left,

    right,

    edgeCount,

    topRatio,

    bottomRatio,

    leftRatio,

    rightRatio,

    maximumContactRatio:
      Math.max(
        topRatio,
        bottomRatio,
        leftRatio,
        rightRatio
      ),
  };
}

/**
 * استخراج الأجسام المتصلة داخل Binary Mask.
 *
 * نستخدم 8-direction connectivity
 * حتى لا تنفصل الأجزاء المتصلة قطريًا.
 */
function detectScanQualityConnectedComponents(
  binaryMask:
    Uint8Array,
  width:
    number,
  height:
    number
): ScanQualityConnectedComponent[] {
  const pixelCount =
    width *
    height;

  const visited =
    new Uint8Array(
      pixelCount
    );

  const components:
    ScanQualityConnectedComponent[] = [];

  const queueX =
    new Int32Array(
      pixelCount
    );

  const queueY =
    new Int32Array(
      pixelCount
    );

  let componentId =
    0;

  const directions =
    [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ] as const;

  for (
    let startY =
      0;
    startY <
      height;
    startY +=
      1
  ) {
    for (
      let startX =
        0;
      startX <
        width;
      startX +=
        1
    ) {
      const startIndex =
        startY *
          width +
        startX;

      if (
        visited[
          startIndex
        ] ===
          1 ||
        binaryMask[
          startIndex
        ] !==
          1
      ) {
        continue;
      }

      componentId +=
        1;

      let queueStart =
        0;

      let queueEnd =
        0;

      queueX[
        queueEnd
      ] =
        startX;

      queueY[
        queueEnd
      ] =
        startY;

      queueEnd +=
        1;

      visited[
        startIndex
      ] =
        1;

      const internal:
        ScanQualityComponentInternal = {
          id:
            componentId,

          pixelCount:
            0,

          minimumX:
            startX,

          minimumY:
            startY,

          maximumX:
            startX,

          maximumY:
            startY,

          sumX:
            0,

          sumY:
            0,

          touchesTop:
            false,

          touchesBottom:
            false,

          touchesLeft:
            false,

          touchesRight:
            false,
        };

      while (
        queueStart <
        queueEnd
      ) {
        const currentX =
          queueX[
            queueStart
          ] ?? 0;

        const currentY =
          queueY[
            queueStart
          ] ?? 0;

        queueStart +=
          1;

        internal.pixelCount +=
          1;

        internal.sumX +=
          currentX;

        internal.sumY +=
          currentY;

        internal.minimumX =
          Math.min(
            internal.minimumX,
            currentX
          );

        internal.minimumY =
          Math.min(
            internal.minimumY,
            currentY
          );

        internal.maximumX =
          Math.max(
            internal.maximumX,
            currentX
          );

        internal.maximumY =
          Math.max(
            internal.maximumY,
            currentY
          );

        if (
          currentY ===
          0
        ) {
          internal.touchesTop =
            true;
        }

        if (
          currentY ===
          height -
            1
        ) {
          internal.touchesBottom =
            true;
        }

        if (
          currentX ===
          0
        ) {
          internal.touchesLeft =
            true;
        }

        if (
          currentX ===
          width -
            1
        ) {
          internal.touchesRight =
            true;
        }

        for (
          const [
            offsetX,
            offsetY,
          ] of directions
        ) {
          const nextX =
            currentX +
            offsetX;

          const nextY =
            currentY +
            offsetY;

          if (
            nextX <
              0 ||
            nextY <
              0 ||
            nextX >=
              width ||
            nextY >=
              height
          ) {
            continue;
          }

          const nextIndex =
            nextY *
              width +
            nextX;

          if (
            visited[
              nextIndex
            ] ===
              1 ||
            binaryMask[
              nextIndex
            ] !==
              1
          ) {
            continue;
          }

          visited[
            nextIndex
          ] =
            1;

          queueX[
            queueEnd
          ] =
            nextX;

          queueY[
            queueEnd
          ] =
            nextY;

          queueEnd +=
            1;
        }
      }

      const boundingBox =
        createScanQualityBoundingBoxFromCoordinates(
          internal.minimumX,
          internal.minimumY,
          internal.maximumX,
          internal.maximumY,
          width,
          height
        );

      components.push({
        id:
          internal.id,

        pixelCount:
          internal.pixelCount,

        areaRatio:
          normalizeScanQualityValue(
            safeScanQualityDivide(
              internal.pixelCount,
              pixelCount,
              0
            )
          ),

        boundingBox,

        touchesTop:
          internal.touchesTop,

        touchesBottom:
          internal.touchesBottom,

        touchesLeft:
          internal.touchesLeft,

        touchesRight:
          internal.touchesRight,

        centroidX:
          safeScanQualityDivide(
            internal.sumX,
            internal.pixelCount,
            0
          ),

        centroidY:
          safeScanQualityDivide(
            internal.sumY,
            internal.pixelCount,
            0
          ),
      });
    }
  }

  return components.sort(
    (
      first,
      second
    ) =>
      second.pixelCount -
      first.pixelCount
  );
}

/**
 * حساب عدد الثقوب داخل الجسم الرئيسي.
 *
 * نعتبر الخلفية المتصلة بحدود الصورة Background طبيعي.
 * أي Background مغلق داخل Foreground يعتبر Hole.
 */
function calculateScanQualityHoleRatio(
  binaryMask:
    Uint8Array,
  width:
    number,
  height:
    number
): number {
  const pixelCount =
    width *
    height;

  if (
    pixelCount ===
    0
  ) {
    return 0;
  }

  const visited =
    new Uint8Array(
      pixelCount
    );

  const queue =
    new Int32Array(
      pixelCount
    );

  let queueStart =
    0;

  let queueEnd =
    0;

  function enqueueBackground(
    x:
      number,
    y:
      number
  ) {
    if (
      x <
        0 ||
      y <
        0 ||
      x >=
        width ||
      y >=
        height
    ) {
      return;
    }

    const index =
      y *
        width +
      x;

    if (
      visited[
        index
      ] ===
        1 ||
      binaryMask[
        index
      ] ===
        1
    ) {
      return;
    }

    visited[
      index
    ] =
      1;

    queue[
      queueEnd
    ] =
      index;

    queueEnd +=
      1;
  }

  for (
    let x =
      0;
    x <
      width;
    x +=
      1
  ) {
    enqueueBackground(
      x,
      0
    );

    enqueueBackground(
      x,
      height -
        1
    );
  }

  for (
    let y =
      0;
    y <
      height;
    y +=
      1
  ) {
    enqueueBackground(
      0,
      y
    );

    enqueueBackground(
      width -
        1,
      y
    );
  }

  while (
    queueStart <
    queueEnd
  ) {
    const index =
      queue[
        queueStart
      ] ?? 0;

    queueStart +=
      1;

    const x =
      index %
      width;

    const y =
      Math.floor(
        index /
        width
      );

    enqueueBackground(
      x -
        1,
      y
    );

    enqueueBackground(
      x +
        1,
      y
    );

    enqueueBackground(
      x,
      y -
        1
    );

    enqueueBackground(
      x,
      y +
        1
    );
  }

  let holePixelCount =
    0;

  let foregroundPixelCount =
    0;

  for (
    let index =
      0;
    index <
      pixelCount;
    index +=
      1
  ) {
    if (
      binaryMask[
        index
      ] ===
        1
    ) {
      foregroundPixelCount +=
        1;

      continue;
    }

    if (
      visited[
        index
      ] ===
        0
    ) {
      holePixelCount +=
        1;
    }
  }

  return normalizeScanQualityValue(
    safeScanQualityDivide(
      holePixelCount,
      foregroundPixelCount,
      0
    )
  );
}

/**
 * تحليل كامل للماسك.
 */
export function analyzeScanQualityMask(
  mask:
    ScanQualityMaskData,
  config:
    ScanQualityMaskConfig
): ScanQualityMaskMetrics {
  const validation =
    validateScanQualityMaskData(
      mask
    );

  if (
    !validation.valid
  ) {
    return createEmptyScanQualityMaskMetrics();
  }

  const buffers =
    createScanQualityMaskAnalysisBuffers(
      mask,
      config
    );

  const pixelCount =
    mask.width *
    mask.height;

  let foregroundPixelCount =
    0;

  let softEdgePixelCount =
    0;

  let uncertainPixelCount =
    0;

  for (
    let index =
      0;
    index <
      pixelCount;
    index +=
      1
  ) {
    if (
      buffers.binary[
        index
      ] ===
        1
    ) {
      foregroundPixelCount +=
        1;
    }

    if (
      buffers.soft[
        index
      ] ===
        1
    ) {
      softEdgePixelCount +=
        1;
    }

    if (
      buffers.uncertain[
        index
      ] ===
        1
    ) {
      uncertainPixelCount +=
        1;
    }
  }

  const foregroundRatio =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        foregroundPixelCount,
        pixelCount,
        0
      )
    );

  const softEdgeRatio =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        softEdgePixelCount,
        Math.max(
          1,
          foregroundPixelCount
        ),
        0
      )
    );

  const uncertainPixelRatio =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        uncertainPixelCount,
        Math.max(
          1,
          foregroundPixelCount
        ),
        0
      )
    );

  const components =
    detectScanQualityConnectedComponents(
      buffers.binary,
      mask.width,
      mask.height
    );

  const significantComponents =
    components.filter(
      (
        component
      ) =>
        component.areaRatio >=
        config.minimumSignificantComponentRatio
    );

  const largestComponent =
    components[
      0
    ] ??
    null;

  const secondLargestComponent =
    components[
      1
    ] ??
    null;

  const largestComponentRatio =
    largestComponent
      ? normalizeScanQualityValue(
          safeScanQualityDivide(
            largestComponent.pixelCount,
            foregroundPixelCount,
            0
          )
        )
      : 0;

  const secondLargestComponentRatio =
    secondLargestComponent
      ? normalizeScanQualityValue(
          safeScanQualityDivide(
            secondLargestComponent.pixelCount,
            foregroundPixelCount,
            0
          )
        )
      : 0;

  const fragmentationScore =
    normalizeScanQualityValue(
      1 -
      largestComponentRatio
    );

  const holeRatio =
    calculateScanQualityHoleRatio(
      buffers.binary,
      mask.width,
      mask.height
    );

  const boundingBox =
    calculateScanQualityForegroundBoundingBox(
      buffers.binary,
      mask.width,
      mask.height
    );

  const edgeContact =
    calculateScanQualityEdgeContact(
      buffers.binary,
      mask.width,
      mask.height,
      config
    );

  const foregroundAmountScore =
    foregroundRatio <
      config.minimumForegroundRatio
      ? remapScanQualityValue(
          foregroundRatio,
          0,
          config.minimumForegroundRatio,
          0,
          1
        )
      : foregroundRatio >
          config.maximumForegroundRatio
        ? remapScanQualityValue(
            foregroundRatio,
            config.maximumForegroundRatio,
            1,
            1,
            0
          )
        : 1;

  const largestComponentScore =
    remapScanQualityValue(
      largestComponentRatio,
      config.minimumLargestComponentRatio,
      1,
      0,
      1
    );

  const fragmentationQualityScore =
    remapScanQualityValue(
      fragmentationScore,
      0,
      config.maximumFragmentationScore,
      1,
      0
    );

  const holesScore =
    remapScanQualityValue(
      holeRatio,
      0,
      config.maximumHoleRatio,
      1,
      0
    );

  const uncertaintyScore =
    remapScanQualityValue(
      uncertainPixelRatio,
      0,
      config.maximumUncertainPixelRatio,
      1,
      0
    );

  const edgeScore =
    edgeContact.edgeCount ===
      0
      ? 1
      : remapScanQualityValue(
          edgeContact.maximumContactRatio,
          config.maximumEdgeContactRatio,
          1,
          0.65,
          0
        );

  const score =
    getWeightedScanQualityScore([
      {
        score:
          foregroundAmountScore,

        weight:
          0.18,
      },
      {
        score:
          largestComponentScore,

        weight:
          0.24,
      },
      {
        score:
          fragmentationQualityScore,

        weight:
          0.18,
      },
      {
        score:
          holesScore,

        weight:
          0.12,
      },
      {
        score:
          uncertaintyScore,

        weight:
          0.16,
      },
      {
        score:
          edgeScore,

        weight:
          0.12,
      },
    ]);

  return {
    foregroundPixelCount,

    foregroundRatio,

    softEdgePixelCount,

    softEdgeRatio,

    uncertainPixelCount,

    uncertainPixelRatio,

    componentCount:
      components.length,

    significantComponentCount:
      significantComponents.length,

    largestComponentRatio,

    secondLargestComponentRatio,

    fragmentationScore,

    holeRatio,

    boundingBox,

    edgeContact,

    components,

    score,
  };
}

/**
 * تحويل إحداثي من Mask إلى Image.
 */
function mapScanQualityMaskCoordinateToImage(
  coordinate:
    number,
  maskSize:
    number,
  imageSize:
    number
): number {
  if (
    maskSize <=
      1 ||
    imageSize <=
      1
  ) {
    return 0;
  }

  return clampScanQualityValue(
    Math.round(
      safeScanQualityDivide(
        coordinate,
        maskSize -
          1,
        0
      ) *
        (
          imageSize -
          1
        )
    ),
    0,
    imageSize -
      1
  );
}

/**
 * إضافة لون إلى Accumulator.
 */
function addScanQualityColorSample(
  accumulator:
    ScanQualityColorAccumulator,
  red:
    number,
  green:
    number,
  blue:
    number
) {
  const luminance =
    getScanQualityLuminance(
      red,
      green,
      blue
    );

  accumulator.red +=
    red;

  accumulator.green +=
    green;

  accumulator.blue +=
    blue;

  accumulator.luminance +=
    luminance;

  accumulator.redSquared +=
    red *
    red;

  accumulator.greenSquared +=
    green *
    green;

  accumulator.blueSquared +=
    blue *
    blue;

  accumulator.count +=
    1;
}

/**
 * حساب Color Spread من Accumulator.
 */
function getScanQualityColorSpread(
  accumulator:
    ScanQualityColorAccumulator
): number {
  if (
    accumulator.count <=
      0
  ) {
    return 0;
  }

  const meanRed =
    accumulator.red /
    accumulator.count;

  const meanGreen =
    accumulator.green /
    accumulator.count;

  const meanBlue =
    accumulator.blue /
    accumulator.count;

  const varianceRed =
    Math.max(
      0,
      accumulator.redSquared /
        accumulator.count -
      meanRed *
        meanRed
    );

  const varianceGreen =
    Math.max(
      0,
      accumulator.greenSquared /
        accumulator.count -
      meanGreen *
        meanGreen
    );

  const varianceBlue =
    Math.max(
      0,
      accumulator.blueSquared /
        accumulator.count -
      meanBlue *
        meanBlue
    );

  return normalizeScanQualityValue(
    Math.sqrt(
      (
        varianceRed +
        varianceGreen +
        varianceBlue
      ) /
        3
    )
  );
}

/**
 * تحليل الفرق بين القطعة والخلفية.
 */
export function analyzeScanQualityBackgroundSeparation(
  image:
    ScanQualityImageData,
  mask:
    ScanQualityMaskData,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): ScanQualityBackgroundMetrics {
  const imageValidation =
    validateScanQualityImageData(
      image
    );

  const maskValidation =
    validateScanQualityMaskData(
      mask
    );

  if (
    !imageValidation.valid ||
    !maskValidation.valid
  ) {
    return createEmptyScanQualityBackgroundMetrics();
  }

  const maskBuffers =
    createScanQualityMaskAnalysisBuffers(
      mask,
      config.mask
    );

  const foregroundAccumulator:
    ScanQualityColorAccumulator = {
      red:
        0,

      green:
        0,

      blue:
        0,

      luminance:
        0,

      redSquared:
        0,

      greenSquared:
        0,

      blueSquared:
        0,

      count:
        0,
    };

  const backgroundAccumulator:
    ScanQualityColorAccumulator = {
      red:
        0,

      green:
        0,

      blue:
        0,

      luminance:
        0,

      redSquared:
        0,

      greenSquared:
        0,

      blueSquared:
        0,

      count:
        0,
    };

  let boundaryDifferenceTotal =
    0;

  let boundaryComparisonCount =
    0;

  const step =
    Math.max(
      1,
      Math.floor(
        Math.max(
          mask.width,
          mask.height
        ) /
          384
      )
    );

  for (
    let maskY =
      0;
    maskY <
      mask.height;
    maskY +=
      step
  ) {
    for (
      let maskX =
        0;
      maskX <
        mask.width;
      maskX +=
        step
    ) {
      const maskIndex =
        maskY *
          mask.width +
        maskX;

      const maskValue =
        maskBuffers.normalized[
          maskIndex
        ] ?? 0;

      const imageX =
        mapScanQualityMaskCoordinateToImage(
          maskX,
          mask.width,
          image.width
        );

      const imageY =
        mapScanQualityMaskCoordinateToImage(
          maskY,
          mask.height,
          image.height
        );

      const pixel =
        readScanQualityPixel(
          image,
          imageX,
          imageY
        );

      if (
        maskValue >=
        config.mask
          .confidentForegroundThreshold
      ) {
        addScanQualityColorSample(
          foregroundAccumulator,
          pixel.red,
          pixel.green,
          pixel.blue
        );
      } else if (
        maskValue <=
        config.mask
          .softForegroundThreshold
      ) {
        addScanQualityColorSample(
          backgroundAccumulator,
          pixel.red,
          pixel.green,
          pixel.blue
        );
      }

      if (
        maskValue <
          config.mask
            .uncertainMinimum ||
        maskValue >
          config.mask
            .uncertainMaximum
      ) {
        continue;
      }

      const radius =
        config.background
          .boundarySampleRadius;

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
            offsetX ===
              0 &&
            offsetY ===
              0
          ) {
            continue;
          }

          const neighborX =
            maskX +
            offsetX;

          const neighborY =
            maskY +
            offsetY;

          if (
            neighborX <
              0 ||
            neighborY <
              0 ||
            neighborX >=
              mask.width ||
            neighborY >=
              mask.height
          ) {
            continue;
          }

          const neighborIndex =
            neighborY *
              mask.width +
            neighborX;

          const neighborMaskValue =
            maskBuffers.normalized[
              neighborIndex
            ] ?? 0;

          if (
            Math.abs(
              maskValue -
              neighborMaskValue
            ) <
              0.45
          ) {
            continue;
          }

          const neighborImageX =
            mapScanQualityMaskCoordinateToImage(
              neighborX,
              mask.width,
              image.width
            );

          const neighborImageY =
            mapScanQualityMaskCoordinateToImage(
              neighborY,
              mask.height,
              image.height
            );

          const neighborPixel =
            readScanQualityPixel(
              image,
              neighborImageX,
              neighborImageY
            );

          const currentLuminance =
            getScanQualityLuminance(
              pixel.red,
              pixel.green,
              pixel.blue
            );

          const neighborLuminance =
            getScanQualityLuminance(
              neighborPixel.red,
              neighborPixel.green,
              neighborPixel.blue
            );

          boundaryDifferenceTotal +=
            Math.abs(
              currentLuminance -
              neighborLuminance
            );

          boundaryComparisonCount +=
            1;
        }
      }
    }
  }

  const foregroundLuminance =
    safeScanQualityDivide(
      foregroundAccumulator.luminance,
      foregroundAccumulator.count,
      0
    );

  const backgroundLuminance =
    safeScanQualityDivide(
      backgroundAccumulator.luminance,
      backgroundAccumulator.count,
      0
    );

  const luminanceDifference =
    normalizeScanQualityValue(
      Math.abs(
        foregroundLuminance -
        backgroundLuminance
      )
    );

  const foregroundColorSpread =
    getScanQualityColorSpread(
      foregroundAccumulator
    );

  const backgroundColorSpread =
    getScanQualityColorSpread(
      backgroundAccumulator
    );

  const boundaryContrast =
    normalizeScanQualityValue(
      safeScanQualityDivide(
        boundaryDifferenceTotal,
        boundaryComparisonCount,
        0
      )
    );

  const luminanceSimilarity =
    1 -
    luminanceDifference;

  const boundarySimilarity =
    1 -
    boundaryContrast;

  const similarityScore =
    normalizeScanQualityValue(
      luminanceSimilarity *
        0.58 +
      boundarySimilarity *
        0.42
    );

  const luminanceScore =
    remapScanQualityValue(
      luminanceDifference,
      0,
      config.background
        .minimumLuminanceDifference,
      0,
      1
    );

  const boundaryScore =
    remapScanQualityValue(
      boundaryContrast,
      0,
      config.background
        .minimumBoundaryContrast,
      0,
      1
    );

  const similarityQualityScore =
    remapScanQualityValue(
      similarityScore,
      0,
      config.background
        .maximumSimilarityScore,
      1,
      0
    );

  const score =
    getWeightedScanQualityScore([
      {
        score:
          luminanceScore,

        weight:
          0.40,
      },
      {
        score:
          boundaryScore,

        weight:
          0.40,
      },
      {
        score:
          similarityQualityScore,

        weight:
          0.20,
      },
    ]);

  return {
    foregroundLuminance,

    backgroundLuminance,

    luminanceDifference,

    foregroundColorSpread,

    backgroundColorSpread,

    boundaryContrast,

    similarityScore,

    score,
  };
}

/**
 * اكتشاف لون أبيض على خلفية بيضاء
 * أو أسود على خلفية سوداء.
 */
function getScanQualityBackgroundMessageKey(
  metrics:
    ScanQualityBackgroundMetrics,
  config:
    ScanQualityBackgroundConfig
): ScanQualityUserMessageKey {
  const foregroundIsWhite =
    metrics.foregroundLuminance >=
    config.whiteForegroundThreshold;

  const backgroundIsWhite =
    metrics.backgroundLuminance >=
    config.whiteBackgroundThreshold;

  if (
    foregroundIsWhite &&
    backgroundIsWhite
  ) {
    return 'use-darker-background';
  }

  const foregroundIsBlack =
    metrics.foregroundLuminance <=
    config.blackForegroundThreshold;

  const backgroundIsBlack =
    metrics.backgroundLuminance <=
    config.blackBackgroundThreshold;

  if (
    foregroundIsBlack &&
    backgroundIsBlack
  ) {
    return 'use-lighter-background';
  }

  return 'use-different-background';
}

/**
 * إنشاء مشاكل حجم وتمركز القطعة.
 */
function createScanQualityFramingIssues(
  metrics:
    ScanQualityMaskMetrics,
  mask:
    ScanQualityMaskData,
  config:
    ScanQualityMaskConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  if (
    metrics.foregroundPixelCount ===
      0 ||
    !metrics.boundingBox
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-missing',

        severity:
          'critical',

        stage:
          'post-segmentation',

        messageKey:
          'could-not-detect-item',

        confidence:
          1,

        debugMessage:
          'No foreground pixels were detected in the segmentation mask.',
      })
    );

    return issues;
  }

  if (
    metrics.foregroundRatio <
    config.minimumForegroundRatio
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-too-small',

        severity:
          'error',

        stage:
          'post-segmentation',

        messageKey:
          'move-closer',

        confidence:
          1 -
          safeScanQualityDivide(
            metrics.foregroundRatio,
            config.minimumForegroundRatio,
            0
          ),

        debugMessage:
          `Foreground ratio is too small: ${metrics.foregroundRatio.toFixed(
            4
          )}.`,

        details: {
          foregroundRatio:
            metrics.foregroundRatio,

          minimumForegroundRatio:
            config.minimumForegroundRatio,
        },
      })
    );

    issues.push(
      createScanQualityIssue({
        code:
          'subject-too-far',

        severity:
          'warning',

        stage:
          'post-segmentation',

        messageKey:
          'move-closer',

        confidence:
          1 -
          safeScanQualityDivide(
            metrics.foregroundRatio,
            config.minimumForegroundRatio,
            0
          ),

        debugMessage:
          'The subject appears too far from the camera.',
      })
    );
  }

  if (
    metrics.foregroundRatio >
    config.maximumForegroundRatio
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-too-large',

        severity:
          'error',

        stage:
          'post-segmentation',

        messageKey:
          'move-back',

        confidence:
          remapScanQualityValue(
            metrics.foregroundRatio,
            config.maximumForegroundRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Foreground ratio is too large: ${metrics.foregroundRatio.toFixed(
            4
          )}.`,

        details: {
          foregroundRatio:
            metrics.foregroundRatio,

          maximumForegroundRatio:
            config.maximumForegroundRatio,
        },
      })
    );

    issues.push(
      createScanQualityIssue({
        code:
          'subject-too-close',

        severity:
          'warning',

        stage:
          'post-segmentation',

        messageKey:
          'move-back',

        confidence:
          remapScanQualityValue(
            metrics.foregroundRatio,
            config.maximumForegroundRatio,
            1,
            0,
            1
          ),

        debugMessage:
          'The subject appears too close to the camera.',
      })
    );
  }

  const canvasCenterX =
    mask.width /
    2;

  const canvasCenterY =
    mask.height /
    2;

  const offsetX =
    Math.abs(
      metrics.boundingBox.centerX -
      canvasCenterX
    );

  const offsetY =
    Math.abs(
      metrics.boundingBox.centerY -
      canvasCenterY
    );

  const normalizedOffsetX =
    safeScanQualityDivide(
      offsetX,
      mask.width /
        2,
      0
    );

  const normalizedOffsetY =
    safeScanQualityDivide(
      offsetY,
      mask.height /
        2,
      0
    );

  const centerOffset =
    Math.max(
      normalizedOffsetX,
      normalizedOffsetY
    );

  if (
    centerOffset >
    config.maximumCenterOffsetRatio
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'subject-off-center',

        severity:
          centerOffset >
            config.maximumCenterOffsetRatio *
              1.5
            ? 'error'
            : 'warning',

        stage:
          'post-segmentation',

        messageKey:
          'center-item',

        confidence:
          remapScanQualityValue(
            centerOffset,
            config.maximumCenterOffsetRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `The subject is too far from the image center: ${centerOffset.toFixed(
            4
          )}.`,

        details: {
          centerOffset,

          maximumCenterOffsetRatio:
            config.maximumCenterOffsetRatio,
        },
      })
    );
  }

  return issues;
}

/**
 * إنشاء مشاكل ملامسة الحواف.
 */
function createScanQualityEdgeContactIssues(
  metrics:
    ScanQualityMaskMetrics,
  config:
    ScanQualityMaskConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  const contact =
    metrics.edgeContact;

  if (
    contact.edgeCount >
    config.maximumTouchedEdges
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-touching-multiple-edges',

        severity:
          'critical',

        stage:
          'post-segmentation',

        messageKey:
          'keep-whole-item-inside',

        confidence:
          normalizeScanQualityValue(
            safeScanQualityDivide(
              contact.edgeCount,
              4,
              0
            )
          ),

        debugMessage:
          `Foreground touches ${contact.edgeCount} image edges.`,

        details: {
          edgeCount:
            contact.edgeCount,

          topRatio:
            contact.topRatio,

          bottomRatio:
            contact.bottomRatio,

          leftRatio:
            contact.leftRatio,

          rightRatio:
            contact.rightRatio,
        },
      })
    );
  }

  const individualSeverity:
    ScanQualityIssueSeverity =
    contact.edgeCount >
      1
      ? 'error'
      : 'warning';

  if (
    contact.top
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-touching-top',

        severity:
          individualSeverity,

        stage:
          'post-segmentation',

        messageKey:
          'keep-whole-item-inside',

        confidence:
          remapScanQualityValue(
            contact.topRatio,
            config.maximumEdgeContactRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Foreground touches the top edge with ratio ${contact.topRatio.toFixed(
            4
          )}.`,
      })
    );
  }

  if (
    contact.bottom
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-touching-bottom',

        severity:
          individualSeverity,

        stage:
          'post-segmentation',

        messageKey:
          'keep-whole-item-inside',

        confidence:
          remapScanQualityValue(
            contact.bottomRatio,
            config.maximumEdgeContactRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Foreground touches the bottom edge with ratio ${contact.bottomRatio.toFixed(
            4
          )}.`,
      })
    );
  }

  if (
    contact.left
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-touching-left',

        severity:
          individualSeverity,

        stage:
          'post-segmentation',

        messageKey:
          'keep-whole-item-inside',

        confidence:
          remapScanQualityValue(
            contact.leftRatio,
            config.maximumEdgeContactRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Foreground touches the left edge with ratio ${contact.leftRatio.toFixed(
            4
          )}.`,
      })
    );
  }

  if (
    contact.right
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'foreground-touching-right',

        severity:
          individualSeverity,

        stage:
          'post-segmentation',

        messageKey:
          'keep-whole-item-inside',

        confidence:
          remapScanQualityValue(
            contact.rightRatio,
            config.maximumEdgeContactRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Foreground touches the right edge with ratio ${contact.rightRatio.toFixed(
            4
          )}.`,
      })
    );
  }

  return issues;
}

/**
 * إنشاء مشاكل تعدد الأجسام.
 */
function createScanQualityObjectIsolationIssues(
  metrics:
    ScanQualityMaskMetrics,
  config:
    ScanQualityMaskConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  if (
    metrics.significantComponentCount >
    config.maximumSignificantComponents
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'multiple-objects-detected',

        severity:
          'critical',

        stage:
          'post-segmentation',

        messageKey:
          'place-one-item-only',

        confidence:
          normalizeScanQualityValue(
            safeScanQualityDivide(
              metrics.significantComponentCount -
                config.maximumSignificantComponents,
              Math.max(
                1,
                metrics.significantComponentCount
              ),
              0
            ) +
            0.5
          ),

        debugMessage:
          `Detected ${metrics.significantComponentCount} significant foreground components.`,

        details: {
          significantComponentCount:
            metrics.significantComponentCount,

          maximumSignificantComponents:
            config.maximumSignificantComponents,
        },
      })
    );
  } else if (
    metrics.secondLargestComponentRatio >
    config.maximumSecondComponentRatio
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'secondary-object-detected',

        severity:
          'error',

        stage:
          'post-segmentation',

        messageKey:
          'place-one-item-only',

        confidence:
          remapScanQualityValue(
            metrics.secondLargestComponentRatio,
            config.maximumSecondComponentRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Second largest component ratio is too high: ${metrics.secondLargestComponentRatio.toFixed(
            4
          )}.`,

        details: {
          secondLargestComponentRatio:
            metrics.secondLargestComponentRatio,

          maximumSecondComponentRatio:
            config.maximumSecondComponentRatio,
        },
      })
    );
  }

  /*
   * ملاحظة مهمة:
   * اكتشاف اليد هنا استدلالي وليس Skin Detection حقيقي.
   *
   * لو ظهر جسم ثانٍ صغير بجوار الجسم الرئيسي،
   * نعتبره يدًا محتملة ونطلب إخراج اليد من الكادر.
   */
  const secondComponent =
    metrics.components[
      1
    ] ??
    null;

  const largestComponent =
    metrics.components[
      0
    ] ??
    null;

  if (
    secondComponent &&
    largestComponent &&
    secondComponent.areaRatio >=
      config.minimumSignificantComponentRatio *
        0.45 &&
    secondComponent.areaRatio <
      config.maximumSecondComponentRatio
  ) {
    const horizontalDistance =
      Math.abs(
        secondComponent.centroidX -
        largestComponent.centroidX
      );

    const verticalDistance =
      Math.abs(
        secondComponent.centroidY -
        largestComponent.centroidY
      );

    const mainWidth =
      Math.max(
        1,
        largestComponent.boundingBox.width
      );

    const mainHeight =
      Math.max(
        1,
        largestComponent.boundingBox.height
      );

    const normalizedDistance =
      Math.min(
        safeScanQualityDivide(
          horizontalDistance,
          mainWidth,
          0
        ),
        safeScanQualityDivide(
          verticalDistance,
          mainHeight,
          0
        )
      );

    if (
      normalizedDistance <
      0.65
    ) {
      issues.push(
        createScanQualityIssue({
          code:
            'possible-hand-detected',

          severity:
            'warning',

          stage:
            'post-segmentation',

          messageKey:
            'remove-hand',

          confidence:
            normalizeScanQualityValue(
              1 -
              normalizedDistance
            ),

          debugMessage:
            'A small secondary component was detected close to the main subject. It may be a hand or another unwanted object.',

          details: {
            secondComponentAreaRatio:
              secondComponent.areaRatio,

            normalizedDistance,
          },
        })
      );
    }
  }

  return issues;
}

/**
 * إنشاء مشاكل جودة الماسك.
 */
function createScanQualityMaskStructureIssues(
  metrics:
    ScanQualityMaskMetrics,
  config:
    ScanQualityMaskConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  if (
    metrics.fragmentationScore >
    config.maximumFragmentationScore
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'mask-too-fragmented',

        severity:
          metrics.fragmentationScore >
            config.maximumFragmentationScore *
              1.6
            ? 'error'
            : 'warning',

        stage:
          'post-segmentation',

        messageKey:
          'retake-photo',

        confidence:
          remapScanQualityValue(
            metrics.fragmentationScore,
            config.maximumFragmentationScore,
            1,
            0,
            1
          ),

        debugMessage:
          `Mask is fragmented: ${metrics.fragmentationScore.toFixed(
            4
          )}.`,

        details: {
          fragmentationScore:
            metrics.fragmentationScore,

          largestComponentRatio:
            metrics.largestComponentRatio,

          componentCount:
            metrics.componentCount,
        },
      })
    );
  }

  if (
    metrics.holeRatio >
    config.maximumHoleRatio
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'mask-has-holes',

        severity:
          metrics.holeRatio >
            config.maximumHoleRatio *
              1.8
            ? 'error'
            : 'warning',

        stage:
          'post-segmentation',

        messageKey:
          'use-different-background',

        confidence:
          remapScanQualityValue(
            metrics.holeRatio,
            config.maximumHoleRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Mask contains too many internal holes: ${metrics.holeRatio.toFixed(
            4
          )}.`,

        details: {
          holeRatio:
            metrics.holeRatio,

          maximumHoleRatio:
            config.maximumHoleRatio,
        },
      })
    );
  }

  if (
    metrics.uncertainPixelRatio >
    config.maximumUncertainPixelRatio
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'mask-low-confidence',

        severity:
          metrics.uncertainPixelRatio >
            config.maximumUncertainPixelRatio *
              1.5
            ? 'error'
            : 'warning',

        stage:
          'post-segmentation',

        messageKey:
          'use-different-background',

        confidence:
          remapScanQualityValue(
            metrics.uncertainPixelRatio,
            config.maximumUncertainPixelRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Too many mask pixels are uncertain: ${metrics.uncertainPixelRatio.toFixed(
            4
          )}.`,

        details: {
          uncertainPixelRatio:
            metrics.uncertainPixelRatio,

          maximumUncertainPixelRatio:
            config.maximumUncertainPixelRatio,
        },
      })
    );
  }

  if (
    metrics.softEdgeRatio >
    config.maximumSoftEdgeRatio
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'mask-uncertain-edges',

        severity:
          'warning',

        stage:
          'post-segmentation',

        messageKey:
          'use-different-background',

        confidence:
          remapScanQualityValue(
            metrics.softEdgeRatio,
            config.maximumSoftEdgeRatio,
            1,
            0,
            1
          ),

        debugMessage:
          `Mask contains excessive soft or uncertain edge pixels: ${metrics.softEdgeRatio.toFixed(
            4
          )}.`,

        details: {
          softEdgeRatio:
            metrics.softEdgeRatio,

          maximumSoftEdgeRatio:
            config.maximumSoftEdgeRatio,
        },
      })
    );
  }

  return issues;
}

/**
 * إنشاء مشاكل تشابه القطعة والخلفية.
 */
function createScanQualityBackgroundIssues(
  metrics:
    ScanQualityBackgroundMetrics,
  config:
    ScanQualityBackgroundConfig
): ScanQualityIssue[] {
  const issues:
    ScanQualityIssue[] = [];

  const luminanceTooClose =
    metrics.luminanceDifference <
    config.minimumLuminanceDifference;

  const boundaryTooWeak =
    metrics.boundaryContrast <
    config.minimumBoundaryContrast;

  const similarityTooHigh =
    metrics.similarityScore >
    config.maximumSimilarityScore;

  if (
    (
      luminanceTooClose &&
      boundaryTooWeak
    ) ||
    similarityTooHigh
  ) {
    const luminanceConfidence =
      1 -
      safeScanQualityDivide(
        metrics.luminanceDifference,
        config.minimumLuminanceDifference,
        0
      );

    const boundaryConfidence =
      1 -
      safeScanQualityDivide(
        metrics.boundaryContrast,
        config.minimumBoundaryContrast,
        0
      );

    const similarityConfidence =
      remapScanQualityValue(
        metrics.similarityScore,
        config.maximumSimilarityScore,
        1,
        0,
        1
      );

    const confidence =
      normalizeScanQualityValue(
        Math.max(
          luminanceConfidence,
          boundaryConfidence,
          similarityConfidence
        )
      );

    issues.push(
      createScanQualityIssue({
        code:
          'background-too-similar',

        severity:
          confidence >
            0.70
            ? 'error'
            : 'warning',

        stage:
          'post-segmentation',

        messageKey:
          getScanQualityBackgroundMessageKey(
            metrics,
            config
          ),

        confidence,

        debugMessage:
          'The foreground and background are too visually similar for reliable separation.',

        details: {
          foregroundLuminance:
            metrics.foregroundLuminance,

          backgroundLuminance:
            metrics.backgroundLuminance,

          luminanceDifference:
            metrics.luminanceDifference,

          boundaryContrast:
            metrics.boundaryContrast,

          similarityScore:
            metrics.similarityScore,
        },
      })
    );
  }

  return issues;
}

/**
 * بناء نتيجة فاشلة لو الماسك غير صالح.
 */
function createInvalidScanQualityPostResult(
  startedAt:
    number,
  debugMessage:
    string
): ScanQualityPostSegmentationResult {
  const issue =
    createScanQualityIssue({
      code:
        'invalid-mask',

      severity:
        'critical',

      stage:
        'post-segmentation',

      messageKey:
        'could-not-detect-item',

      confidence:
        1,

      debugMessage,
    });

  return {
    stage:
      'post-segmentation',

    passed:
      false,

    score:
      0,

    decision:
      'reject',

    mask:
      createEmptyScanQualityMaskMetrics(),

    background:
      null,

    issues: [
      issue,
    ],

    primaryIssue:
      issue,

    userMessageKey:
      issue.messageKey,

    processingTimeMs:
      getScanQualityElapsedTime(
        startedAt
      ),
  };
}

/**
 * تنفيذ فحص Alpha Mask بعد BiRefNet.
 */
export function analyzeScanQualityAfterSegmentation(
  input: {
    mask:
      ScanQualityMaskData;

    image?:
      ScanQualityImageData |
      null;
  },
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): ScanQualityPostSegmentationResult {
  const startedAt =
    Date.now();

  const maskValidation =
    validateScanQualityMaskData(
      input.mask
    );

  if (
    !maskValidation.valid
  ) {
    return createInvalidScanQualityPostResult(
      startedAt,
      maskValidation.reason ??
        'Mask validation failed.'
    );
  }

  const maskMetrics =
    analyzeScanQualityMask(
      input.mask,
      config.mask
    );

  let backgroundMetrics:
    ScanQualityBackgroundMetrics |
    null = null;

  if (
    input.image
  ) {
    const imageValidation =
      validateScanQualityImageData(
        input.image
      );

    if (
      imageValidation.valid
    ) {
      backgroundMetrics =
        analyzeScanQualityBackgroundSeparation(
          input.image,
          input.mask,
          config
        );
    }
  }

  const issues:
    ScanQualityIssue[] = [
      ...createScanQualityFramingIssues(
        maskMetrics,
        input.mask,
        config.mask
      ),

      ...createScanQualityEdgeContactIssues(
        maskMetrics,
        config.mask
      ),

      ...createScanQualityObjectIsolationIssues(
        maskMetrics,
        config.mask
      ),

      ...createScanQualityMaskStructureIssues(
        maskMetrics,
        config.mask
      ),
  ];

  if (
    backgroundMetrics
  ) {
    issues.push(
      ...createScanQualityBackgroundIssues(
        backgroundMetrics,
        config.background
      )
    );
  }

  const framingScore =
    maskMetrics.edgeContact.edgeCount ===
      0 &&
    maskMetrics.boundingBox
      ? 1
      : remapScanQualityValue(
          maskMetrics.edgeContact.edgeCount,
          0,
          4,
          1,
          0
        );

  const objectIsolationScore =
    maskMetrics.significantComponentCount <=
      1
      ? 1
      : remapScanQualityValue(
          maskMetrics.significantComponentCount,
          1,
          5,
          1,
          0
        );

  const scoreEntries:
    {
      score:
        number;

      weight:
        number;
    }[] = [
      {
        score:
          maskMetrics.score,

        weight:
          config.weights
            .mask,
      },
      {
        score:
          framingScore,

        weight:
          config.weights
            .framing,
      },
      {
        score:
          objectIsolationScore,

        weight:
          config.weights
            .objectIsolation,
      },
    ];

  if (
    backgroundMetrics
  ) {
    scoreEntries.push({
      score:
        backgroundMetrics.score,

      weight:
        config.weights
          .backgroundSeparation,
    });
  }

  const score =
    getWeightedScanQualityScore(
      scoreEntries
    );

  if (
    score <
      config.decision
        .retryScore &&
    issues.length ===
      0
  ) {
    issues.push(
      createScanQualityIssue({
        code:
          'quality-score-too-low',

        severity:
          'error',

        stage:
          'post-segmentation',

        messageKey:
          'retake-photo',

        confidence:
          1 -
          safeScanQualityDivide(
            score,
            config.decision
              .retryScore,
            0
          ),

        debugMessage:
          `Post-segmentation quality score is too low: ${score.toFixed(
            4
          )}.`,
      })
    );
  }

  const sortedIssues =
    sortScanQualityIssues(
      issues
    );

  const primaryIssue =
    selectPrimaryScanQualityIssue(
      sortedIssues
    );

  const decision =
    resolveScanQualityDecision(
      score,
      sortedIssues,
      config
    );

  return {
    stage:
      'post-segmentation',

    passed:
      isScanQualityDecisionAccepted(
        decision
      ),

    score,

    decision,

    mask:
      maskMetrics,

    background:
      backgroundMetrics,

    issues:
      sortedIssues,

    primaryIssue,

    userMessageKey:
      primaryIssue
        ?.messageKey ??
      'ready',

    processingTimeMs:
      getScanQualityElapsedTime(
        startedAt
      ),
  };
}

/**
 * Alias مختصر للاستخدام داخل محرك الفصل.
 */
export const runScanQualityPostCheck =
  analyzeScanQualityAfterSegmentation;

/**
 * Debug Summary للماسك.
 */
export function getScanQualityPostCheckDebugSummary(
  result:
    ScanQualityPostSegmentationResult
): string {
  const lines = [
    `Stage: ${result.stage}`,
    `Passed: ${String(
      result.passed
    )}`,
    `Decision: ${result.decision}`,
    `Score: ${result.score.toFixed(
      4
    )}`,
    `Mask score: ${result.mask.score.toFixed(
      4
    )}`,
    `Foreground ratio: ${result.mask.foregroundRatio.toFixed(
      4
    )}`,
    `Components: ${result.mask.componentCount}`,
    `Significant components: ${result.mask.significantComponentCount}`,
    `Largest component ratio: ${result.mask.largestComponentRatio.toFixed(
      4
    )}`,
    `Second component ratio: ${result.mask.secondLargestComponentRatio.toFixed(
      4
    )}`,
    `Fragmentation: ${result.mask.fragmentationScore.toFixed(
      4
    )}`,
    `Hole ratio: ${result.mask.holeRatio.toFixed(
      4
    )}`,
    `Uncertain pixels: ${result.mask.uncertainPixelRatio.toFixed(
      4
    )}`,
    `Soft edges: ${result.mask.softEdgeRatio.toFixed(
      4
    )}`,
    `Touched edges: ${result.mask.edgeContact.edgeCount}`,
  ];

  if (
    result.background
  ) {
    lines.push(
      `Background score: ${result.background.score.toFixed(
        4
      )}`,
      `Foreground luminance: ${result.background.foregroundLuminance.toFixed(
        4
      )}`,
      `Background luminance: ${result.background.backgroundLuminance.toFixed(
        4
      )}`,
      `Luminance difference: ${result.background.luminanceDifference.toFixed(
        4
      )}`,
      `Boundary contrast: ${result.background.boundaryContrast.toFixed(
        4
      )}`,
      `Similarity score: ${result.background.similarityScore.toFixed(
        4
      )}`
    );
  }

  lines.push(
    `Issues: ${result.issues.length}`,
    createScanQualityIssueDebugSummary(
      result.issues
    )
  );

  return lines.join(
    '\n'
  );
}

// End of Part 3/4
// scan/core/quality/ScanQualityGate.ts
// Part 4/4
//
// القرار النهائي لمحرك جودة Scan Item.
//
// هذا الجزء مسؤول عن:
// 1) دمج نتيجة الفحص قبل الفصل وبعد الفصل.
// 2) منع قبول الصورة عند وجود مشكلة خطيرة.
// 3) تحديد الرسالة النهائية التي تظهر للمستخدم.
// 4) تشغيل Quality Gate كاملًا من مدخل واحد.
// 5) توفير Debug Summary نهائي.
// 6) توفير Helpers آمنة لربط المحرك بباقي النظام.

/**
 * مدخلات التشغيل الكامل لمحرك الجودة.
 *
 * يمكن تشغيل:
 * - فحص الصورة فقط.
 * - فحص الماسك فقط.
 * - الفحصين معًا.
 *
 * الأفضل في المسار النهائي:
 * تمرير الصورة والماسك معًا.
 */
export type ScanQualityGateInput = {
  image?:
    ScanQualityImageData |
    null;

  mask?:
    ScanQualityMaskData |
    null;

  /**
   * نتيجة Pre Check جاهزة إن كانت
   * قد نُفذت قبل تشغيل BiRefNet.
   *
   * تمريرها يمنع إعادة تحليل الصورة.
   */
  preSegmentationResult?:
    ScanQualityPreSegmentationResult |
    null;

  /**
   * نتيجة Post Check جاهزة إن كانت
   * قد نُفذت بالفعل بعد BiRefNet.
   *
   * تمريرها يمنع إعادة تحليل الماسك.
   */
  postSegmentationResult?:
    ScanQualityPostSegmentationResult |
    null;
};

/**
 * خيارات دمج النتائج النهائية.
 */
export type ScanQualityFinalizationOptions = {
  /**
   * عند true:
   * وجود نتيجة Pre مرفوضة يمنع القبول النهائي.
   */
  requirePreSegmentationPass:
    boolean;

  /**
   * عند true:
   * يجب وجود نتيجة Post Segmentation.
   *
   * تستخدم في مسار إنشاء PNG النهائي.
   */
  requirePostSegmentationPass:
    boolean;

  /**
   * عند true:
   * يتم إزالة Issues المتكررة بنفس الكود والمرحلة.
   */
  deduplicateIssues:
    boolean;
};

/**
 * الخيارات الافتراضية للقرار النهائي.
 */
export const DEFAULT_SCAN_QUALITY_FINALIZATION_OPTIONS:
  Readonly<ScanQualityFinalizationOptions> = {
    requirePreSegmentationPass:
      true,

    requirePostSegmentationPass:
      true,

    deduplicateIssues:
      true,
  };

/**
 * رسائل افتراضية باللغة الإنجليزية.
 *
 * يفضل أن تعتمد الواجهة على messageKey
 * وتستخدم ملفات الترجمة الخاصة بالتطبيق.
 *
 * هذه الرسائل تستخدم فقط كـFallback
 * أو أثناء الاختبارات وDebug.
 */
export const DEFAULT_SCAN_QUALITY_USER_MESSAGES:
  Readonly<
    Record<
      ScanQualityUserMessageKey,
      string
    >
  > = {
    ready:
      'The item is ready.',

    'move-back':
      'Move the camera slightly farther away.',

    'move-closer':
      'Move the camera slightly closer.',

    'center-item':
      'Place the item in the center of the frame.',

    'keep-whole-item-inside':
      'Keep the whole item inside the frame.',

    'use-darker-background':
      'Use a darker background behind the item.',

    'use-lighter-background':
      'Use a lighter background behind the item.',

    'use-different-background':
      'Use a background with a different color from the item.',

    'improve-lighting':
      'Improve the lighting and try again.',

    'reduce-lighting':
      'Reduce the lighting or glare and try again.',

    'hold-still':
      'Hold the camera still and retake the photo.',

    'place-one-item-only':
      'Place only one item inside the frame.',

    'remove-hand':
      'Remove your hand and any other objects from the frame.',

    'clean-camera-lens':
      'Clean the camera lens and try again.',

    'retake-photo':
      'Retake the photo and try again.',

    'could-not-detect-item':
      'The item could not be detected. Try again.',
  };

/**
 * تحويل Message Key إلى نص افتراضي.
 */
export function getDefaultScanQualityUserMessage(
  messageKey:
    ScanQualityUserMessageKey
): string {
  return (
    DEFAULT_SCAN_QUALITY_USER_MESSAGES[
      messageKey
    ] ??
    DEFAULT_SCAN_QUALITY_USER_MESSAGES[
      'retake-photo'
    ]
  );
}

/**
 * إنشاء مفتاح ثابت للمشكلة
 * بهدف إزالة التكرار.
 */
function getScanQualityIssueIdentity(
  issue:
    ScanQualityIssue
): string {
  return [
    issue.stage,
    issue.code,
    issue.messageKey,
  ].join(
    ':'
  );
}

/**
 * إزالة Issues المتكررة.
 *
 * لو تكررت نفس المشكلة:
 * نحتفظ بالأقوى من حيث:
 * 1) Severity.
 * 2) Confidence.
 */
export function deduplicateScanQualityIssues(
  issues:
    readonly ScanQualityIssue[]
): ScanQualityIssue[] {
  const issueMap =
    new Map<
      string,
      ScanQualityIssue
    >();

  for (
    const issue
    of issues
  ) {
    const identity =
      getScanQualityIssueIdentity(
        issue
      );

    const existing =
      issueMap.get(
        identity
      );

    if (
      !existing
    ) {
      issueMap.set(
        identity,
        issue
      );

      continue;
    }

    const existingSeverity =
      getScanQualitySeverityWeight(
        existing.severity
      );

    const currentSeverity =
      getScanQualitySeverityWeight(
        issue.severity
      );

    if (
      currentSeverity >
      existingSeverity
    ) {
      issueMap.set(
        identity,
        issue
      );

      continue;
    }

    if (
      currentSeverity ===
        existingSeverity &&
      issue.confidence >
        existing.confidence
    ) {
      issueMap.set(
        identity,
        issue
      );
    }
  }

  return sortScanQualityIssues(
    Array.from(
      issueMap.values()
    )
  );
}

/**
 * حساب مجموع أوزان مرحلة
 * ما قبل الفصل.
 */
function getScanQualityPreWeight(
  config:
    ScanQualityGateConfig
): number {
  return Math.max(
    0,
    config.weights
      .brightness
  ) +
    Math.max(
      0,
      config.weights
        .contrast
    ) +
    Math.max(
      0,
      config.weights
        .sharpness
    );
}

/**
 * حساب مجموع أوزان مرحلة
 * ما بعد الفصل.
 */
function getScanQualityPostWeight(
  postResult:
    ScanQualityPostSegmentationResult,
  config:
    ScanQualityGateConfig
): number {
  let weight =
    Math.max(
      0,
      config.weights
        .mask
    ) +
    Math.max(
      0,
      config.weights
        .framing
    ) +
    Math.max(
      0,
      config.weights
        .objectIsolation
    );

  if (
    postResult.background
  ) {
    weight +=
      Math.max(
        0,
        config.weights
          .backgroundSeparation
      );
  }

  return weight;
}

/**
 * حساب النتيجة النهائية من Pre وPost.
 *
 * لا يتم حساب المتوسط البسيط فقط،
 * بل نستخدم أوزان المراحل الموجودة في Config.
 */
export function calculateFinalScanQualityScore(
  preResult:
    ScanQualityPreSegmentationResult |
    null,
  postResult:
    ScanQualityPostSegmentationResult |
    null,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): number {
  const entries:
    {
      score:
        number;

      weight:
        number;
    }[] = [];

  if (
    preResult
  ) {
    entries.push({
      score:
        preResult.score,

      weight:
        getScanQualityPreWeight(
          config
        ),
    });
  }

  if (
    postResult
  ) {
    entries.push({
      score:
        postResult.score,

      weight:
        getScanQualityPostWeight(
          postResult,
          config
        ),
    });
  }

  if (
    entries.length ===
      0
  ) {
    return 0;
  }

  return getWeightedScanQualityScore(
    entries
  );
}

/**
 * معرفة هل Issue يجب أن يمنع
 * القبول النهائي بشكل مباشر.
 */
export function isBlockingScanQualityIssue(
  issue:
    ScanQualityIssue,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): boolean {
  if (
    issue.severity ===
      'critical' &&
    config.decision
      .rejectOnCriticalIssue
  ) {
    return true;
  }

  if (
    issue.code ===
      'image-severely-blurry' &&
    config.decision
      .rejectOnSevereBlur
  ) {
    return true;
  }

  if (
    issue.code ===
      'foreground-missing' &&
    config.decision
      .rejectOnMissingForeground
  ) {
    return true;
  }

  if (
    issue.code ===
      'foreground-touching-multiple-edges' &&
    config.decision
      .rejectOnMultipleEdgeContact
  ) {
    return true;
  }

  if (
    issue.code ===
      'multiple-objects-detected' &&
    config.decision
      .rejectOnMultipleObjects
  ) {
    return true;
  }

  switch (
    issue.code
  ) {
    case 'invalid-input':
    case 'invalid-image-size':
    case 'invalid-pixel-buffer':
    case 'invalid-mask':
      return true;

    default:
      return false;
  }
}

/**
 * معرفة هل النتيجة تحتوي
 * على مشكلة تمنع القبول.
 */
export function hasBlockingScanQualityIssue(
  issues:
    readonly ScanQualityIssue[],
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): boolean {
  return issues.some(
    (
      issue
    ) =>
      isBlockingScanQualityIssue(
        issue,
        config
      )
  );
}

/**
 * تحديد قرار نهائي آمن.
 *
 * الاختلاف عن resolveScanQualityDecision:
 * هذه الدالة تراعي وجود مرحلتي Pre وPost
 * وشروط requirePre/requirePost.
 */
export function resolveFinalScanQualityDecision(
  input: {
    score:
      number;

    issues:
      readonly ScanQualityIssue[];

    preSegmentation:
      ScanQualityPreSegmentationResult |
      null;

    postSegmentation:
      ScanQualityPostSegmentationResult |
      null;
  },
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG,
  options:
    ScanQualityFinalizationOptions =
      DEFAULT_SCAN_QUALITY_FINALIZATION_OPTIONS
): ScanQualityDecision {
  if (
    options.requirePreSegmentationPass &&
    !input.preSegmentation
  ) {
    return 'reject';
  }

  if (
    options.requirePostSegmentationPass &&
    !input.postSegmentation
  ) {
    return 'reject';
  }

  if (
    hasBlockingScanQualityIssue(
      input.issues,
      config
    )
  ) {
    const hasInvalidData =
      hasScanQualityIssueCode(
        input.issues,
        'invalid-input'
      ) ||
      hasScanQualityIssueCode(
        input.issues,
        'invalid-image-size'
      ) ||
      hasScanQualityIssueCode(
        input.issues,
        'invalid-pixel-buffer'
      ) ||
      hasScanQualityIssueCode(
        input.issues,
        'invalid-mask'
      );

    if (
      hasInvalidData
    ) {
      return 'reject';
    }

    return 'retry';
  }

  if (
    options.requirePreSegmentationPass &&
    input.preSegmentation &&
    !input.preSegmentation.passed
  ) {
    return input.preSegmentation
      .decision ===
      'reject'
      ? 'reject'
      : 'retry';
  }

  if (
    options.requirePostSegmentationPass &&
    input.postSegmentation &&
    !input.postSegmentation.passed
  ) {
    return input.postSegmentation
      .decision ===
      'reject'
      ? 'reject'
      : 'retry';
  }

  return resolveScanQualityDecision(
    input.score,
    input.issues,
    config
  );
}

/**
 * إنشاء Issue عند غياب نتيجة مطلوبة.
 */
function createMissingStageScanQualityIssue(
  stage:
    'pre-segmentation' |
    'post-segmentation'
): ScanQualityIssue {
  if (
    stage ===
    'pre-segmentation'
  ) {
    return createScanQualityIssue({
      code:
        'invalid-input',

      severity:
        'critical',

      stage:
        'final',

      messageKey:
        'could-not-detect-item',

      confidence:
        1,

      debugMessage:
        'Pre-segmentation quality result is required but was not provided.',
    });
  }

  return createScanQualityIssue({
    code:
      'invalid-mask',

    severity:
      'critical',

    stage:
      'final',

    messageKey:
      'could-not-detect-item',

    confidence:
      1,

    debugMessage:
      'Post-segmentation quality result is required but was not provided.',
  });
}

/**
 * إضافة مشكلة Quality Score النهائية
 * لو كانت النتيجة منخفضة ولم توجد
 * مشكلة أوضح تفسر الرفض.
 */
function appendFinalScoreIssueWhenNeeded(
  issues:
    ScanQualityIssue[],
  score:
    number,
  config:
    ScanQualityGateConfig
): void {
  if (
    score >=
      config.decision
        .retryScore
  ) {
    return;
  }

  if (
    issues.some(
      (
        issue
      ) =>
        issue.severity ===
          'critical' ||
        issue.severity ===
          'error'
    )
  ) {
    return;
  }

  issues.push(
    createScanQualityIssue({
      code:
        'quality-score-too-low',

      severity:
        'error',

      stage:
        'final',

      messageKey:
        'retake-photo',

      confidence:
        1 -
        safeScanQualityDivide(
          score,
          config.decision
            .retryScore,
          0
        ),

      debugMessage:
        `Final scan quality score is too low: ${score.toFixed(
          4
        )}.`,

      details: {
        score,

        retryThreshold:
          config.decision
            .retryScore,
      },
    })
  );
}

/**
 * دمج نتيجة Pre وPost في نتيجة نهائية.
 *
 * هذه هي الدالة الأساسية التي يجب استخدامها
 * بعد خروج Alpha Mask.
 */
export function finalizeScanQualityResult(
  input: {
    preSegmentation?:
      ScanQualityPreSegmentationResult |
      null;

    postSegmentation?:
      ScanQualityPostSegmentationResult |
      null;

    startedAt?:
      number;
  },
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG,
  options:
    ScanQualityFinalizationOptions =
      DEFAULT_SCAN_QUALITY_FINALIZATION_OPTIONS
): ScanQualityResult {
  const startedAt =
    input.startedAt ??
    Date.now();

  const preSegmentation =
    input.preSegmentation ??
    null;

  const postSegmentation =
    input.postSegmentation ??
    null;

  const collectedIssues:
    ScanQualityIssue[] = [];

  if (
    preSegmentation
  ) {
    collectedIssues.push(
      ...preSegmentation.issues
    );
  } else if (
    options.requirePreSegmentationPass
  ) {
    collectedIssues.push(
      createMissingStageScanQualityIssue(
        'pre-segmentation'
      )
    );
  }

  if (
    postSegmentation
  ) {
    collectedIssues.push(
      ...postSegmentation.issues
    );
  } else if (
    options.requirePostSegmentationPass
  ) {
    collectedIssues.push(
      createMissingStageScanQualityIssue(
        'post-segmentation'
      )
    );
  }

  const score =
    calculateFinalScanQualityScore(
      preSegmentation,
      postSegmentation,
      config
    );

  appendFinalScoreIssueWhenNeeded(
    collectedIssues,
    score,
    config
  );

  const issues =
    options.deduplicateIssues
      ? deduplicateScanQualityIssues(
          collectedIssues
        )
      : sortScanQualityIssues(
          collectedIssues
        );

  const primaryIssue =
    selectPrimaryScanQualityIssue(
      issues
    );

  const decision =
    resolveFinalScanQualityDecision(
      {
        score,

        issues,

        preSegmentation,

        postSegmentation,
      },
      config,
      options
    );

  const accepted =
    isScanQualityDecisionAccepted(
      decision
    );

  const resultWithoutDebug: Omit<
    ScanQualityResult,
    'debugSummary'
  > = {
    stage:
      'final',

    accepted,

    score,

    decision,

    preSegmentation,

    postSegmentation,

    issues,

    primaryIssue,

    userMessageKey:
      accepted &&
      !primaryIssue
        ? 'ready'
        : primaryIssue
            ?.messageKey ??
          (
            accepted
              ? 'ready'
              : 'retake-photo'
          ),

    processingTimeMs:
      getScanQualityElapsedTime(
        startedAt
      ),
  };

  return {
    ...resultWithoutDebug,

    debugSummary:
      createFinalScanQualityDebugSummary(
        resultWithoutDebug
      ),
  };
}

/**
 * إنشاء نتيجة Final غير صالحة
 * في حالة حدوث Exception غير متوقع.
 */
function createUnexpectedScanQualityFailureResult(
  startedAt:
    number,
  error:
    unknown
): ScanQualityResult {
  const errorMessage =
    error instanceof
      Error
      ? error.message
      : String(
          error
        );

  const issue =
    createScanQualityIssue({
      code:
        'unknown-quality-failure',

      severity:
        'critical',

      stage:
        'final',

      messageKey:
        'could-not-detect-item',

      confidence:
        1,

      debugMessage:
        `Unexpected ScanQualityGate failure: ${errorMessage}`,

      details: {
        error:
          errorMessage,
      },
    });

  const resultWithoutDebug: Omit<
    ScanQualityResult,
    'debugSummary'
  > = {
    stage:
      'final',

    accepted:
      false,

    score:
      0,

    decision:
      'reject',

    preSegmentation:
      null,

    postSegmentation:
      null,

    issues: [
      issue,
    ],

    primaryIssue:
      issue,

    userMessageKey:
      issue.messageKey,

    processingTimeMs:
      getScanQualityElapsedTime(
        startedAt
      ),
  };

  return {
    ...resultWithoutDebug,

    debugSummary:
      createFinalScanQualityDebugSummary(
        resultWithoutDebug
      ),
  };
}

/**
 * تشغيل Quality Gate كاملًا.
 *
 * السيناريو الأفضل:
 *
 * runScanQualityGate({
 *   image,
 *   mask,
 * });
 *
 * السيناريو المحسن للأداء:
 *
 * 1) شغّل runScanQualityPreCheck قبل BiRefNet.
 * 2) إن نجح، شغّل BiRefNet.
 * 3) مرر preSegmentationResult مع الصورة والماسك.
 */
export function runScanQualityGate(
  input:
    ScanQualityGateInput,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG,
  options:
    ScanQualityFinalizationOptions =
      DEFAULT_SCAN_QUALITY_FINALIZATION_OPTIONS
): ScanQualityResult {
  const startedAt =
    Date.now();

  try {
    let preSegmentation =
      input.preSegmentationResult ??
      null;

    let postSegmentation =
      input.postSegmentationResult ??
      null;

    if (
      !preSegmentation &&
      input.image
    ) {
      preSegmentation =
        analyzeScanQualityBeforeSegmentation(
          input.image,
          config
        );
    }

    /*
     * لا نشغّل Post Check إلا عند وجود Mask.
     *
     * تمرير الصورة اختياري داخل Post Check،
     * لكنه مهم لتحليل تشابه الخلفية.
     */
    if (
      !postSegmentation &&
      input.mask
    ) {
      postSegmentation =
        analyzeScanQualityAfterSegmentation(
          {
            mask:
              input.mask,

            image:
              input.image ??
              null,
          },
          config
        );
    }

    return finalizeScanQualityResult(
      {
        preSegmentation,

        postSegmentation,

        startedAt,
      },
      config,
      options
    );
  } catch (
    error
  ) {
    return createUnexpectedScanQualityFailureResult(
      startedAt,
      error
    );
  }
}

/**
 * تشغيل Quality Gate مع إيقاف مبكر.
 *
 * لو فشل Pre Check فشلًا يمنع تشغيل النموذج،
 * نرجع النتيجة مباشرة بدون الحاجة إلى Mask.
 *
 * هذه الدالة مناسبة للخدمة التي تدير BiRefNet.
 */
export function runScanQualityPreGate(
  image:
    ScanQualityImageData,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): {
  shouldRunSegmentation:
    boolean;

  result:
    ScanQualityPreSegmentationResult;
} {
  const result =
    analyzeScanQualityBeforeSegmentation(
      image,
      config
    );

  const hasBlockingIssue =
    hasBlockingScanQualityIssue(
      result.issues,
      config
    );

  return {
    shouldRunSegmentation:
      result.passed &&
      !hasBlockingIssue,

    result,
  };
}

/**
 * إكمال الفحص بعد خروج الماسك
 * باستخدام نتيجة Pre Check السابقة.
 */
export function completeScanQualityGate(
  input: {
    image:
      ScanQualityImageData;

    mask:
      ScanQualityMaskData;

    preSegmentationResult:
      ScanQualityPreSegmentationResult;
  },
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG,
  options:
    ScanQualityFinalizationOptions =
      DEFAULT_SCAN_QUALITY_FINALIZATION_OPTIONS
): ScanQualityResult {
  const startedAt =
    Date.now();

  try {
    const postSegmentation =
      analyzeScanQualityAfterSegmentation(
        {
          image:
            input.image,

          mask:
            input.mask,
        },
        config
      );

    return finalizeScanQualityResult(
      {
        preSegmentation:
          input.preSegmentationResult,

        postSegmentation,

        startedAt,
      },
      config,
      options
    );
  } catch (
    error
  ) {
    return createUnexpectedScanQualityFailureResult(
      startedAt,
      error
    );
  }
}

/**
 * تشغيل فحص الصورة فقط وإرجاع Final Result.
 *
 * يستخدم للـLive Camera Preview
 * قبل تشغيل الفصل.
 */
export function runScanQualityImageOnlyGate(
  image:
    ScanQualityImageData,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): ScanQualityResult {
  const startedAt =
    Date.now();

  try {
    const preSegmentation =
      analyzeScanQualityBeforeSegmentation(
        image,
        config
      );

    return finalizeScanQualityResult(
      {
        preSegmentation,

        postSegmentation:
          null,

        startedAt,
      },
      config,
      {
        ...DEFAULT_SCAN_QUALITY_FINALIZATION_OPTIONS,

        requirePostSegmentationPass:
          false,
      }
    );
  } catch (
    error
  ) {
    return createUnexpectedScanQualityFailureResult(
      startedAt,
      error
    );
  }
}

/**
 * تشغيل فحص الماسك فقط وإرجاع Final Result.
 *
 * مناسب للاختبارات أو عند عدم توفر
 * Pixel Buffer الخاص بالصورة الأصلية.
 */
export function runScanQualityMaskOnlyGate(
  mask:
    ScanQualityMaskData,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): ScanQualityResult {
  const startedAt =
    Date.now();

  try {
    const postSegmentation =
      analyzeScanQualityAfterSegmentation(
        {
          mask,

          image:
            null,
        },
        config
      );

    return finalizeScanQualityResult(
      {
        preSegmentation:
          null,

        postSegmentation,

        startedAt,
      },
      config,
      {
        ...DEFAULT_SCAN_QUALITY_FINALIZATION_OPTIONS,

        requirePreSegmentationPass:
          false,
      }
    );
  } catch (
    error
  ) {
    return createUnexpectedScanQualityFailureResult(
      startedAt,
      error
    );
  }
}

/**
 * معرفة هل يمكن استخدام النتيجة
 * لإنشاء PNG شفاف نهائي.
 */
export function canAcceptScanQualityResult(
  result:
    ScanQualityResult
): boolean {
  return (
    result.accepted &&
    (
      result.decision ===
        'accept' ||
      result.decision ===
        'accept-with-warning'
    ) &&
    Boolean(
      result.postSegmentation
    )
  );
}

/**
 * معرفة هل يجب على المستخدم
 * إعادة التصوير.
 */
export function shouldRetryScanQualityCapture(
  result:
    ScanQualityResult
): boolean {
  return (
    result.decision ===
      'retry' ||
    result.decision ===
      'reject'
  );
}

/**
 * معرفة هل النتيجة مقبولة
 * لكن تحتوي على تحذير.
 */
export function hasScanQualityWarnings(
  result:
    Pick<
      ScanQualityResult,
      | 'decision'
      | 'issues'
    >
): boolean {
  return (
    result.decision ===
      'accept-with-warning' ||
    result.issues.some(
      (
        issue
      ) =>
        issue.severity ===
        'warning'
    )
  );
}

/**
 * استخراج Issues التي تمنع القبول فقط.
 */
export function getBlockingScanQualityIssues(
  result:
    Pick<
      ScanQualityResult,
      'issues'
    >,
  config:
    ScanQualityGateConfig =
      DEFAULT_SCAN_QUALITY_GATE_CONFIG
): ScanQualityIssue[] {
  return result.issues.filter(
    (
      issue
    ) =>
      isBlockingScanQualityIssue(
        issue,
        config
      )
  );
}

/**
 * استخراج المشاكل التي يمكن إظهارها
 * في شاشة Debug أو الاختبارات.
 */
export function getVisibleScanQualityIssues(
  result:
    Pick<
      ScanQualityResult,
      'issues'
    >,
  maximumIssues:
    number = 5
): ScanQualityIssue[] {
  const safeMaximum =
    Math.max(
      0,
      Math.floor(
        maximumIssues
      )
    );

  return sortScanQualityIssues(
    result.issues
  ).slice(
    0,
    safeMaximum
  );
}

/**
 * تحويل نتيجة الجودة إلى بيانات بسيطة
 * مناسبة للحفظ في Logs أو Analytics.
 */
export function createScanQualityAnalyticsPayload(
  result:
    ScanQualityResult
): Readonly<{
  accepted:
    boolean;

  decision:
    ScanQualityDecision;

  score:
    number;

  userMessageKey:
    ScanQualityUserMessageKey;

  issueCount:
    number;

  primaryIssueCode:
    ScanQualityIssueCode |
    null;

  primaryIssueSeverity:
    ScanQualityIssueSeverity |
    null;

  preScore:
    number |
    null;

  postScore:
    number |
    null;

  brightnessScore:
    number |
    null;

  contrastScore:
    number |
    null;

  sharpnessScore:
    number |
    null;

  maskScore:
    number |
    null;

  backgroundScore:
    number |
    null;

  foregroundRatio:
    number |
    null;

  componentCount:
    number |
    null;

  touchedEdgeCount:
    number |
    null;

  processingTimeMs:
    number;
}> {
  return {
    accepted:
      result.accepted,

    decision:
      result.decision,

    score:
      result.score,

    userMessageKey:
      result.userMessageKey,

    issueCount:
      result.issues.length,

    primaryIssueCode:
      result.primaryIssue
        ?.code ??
      null,

    primaryIssueSeverity:
      result.primaryIssue
        ?.severity ??
      null,

    preScore:
      result.preSegmentation
        ?.score ??
      null,

    postScore:
      result.postSegmentation
        ?.score ??
      null,

    brightnessScore:
      result.preSegmentation
        ?.brightness
        .score ??
      null,

    contrastScore:
      result.preSegmentation
        ?.contrast
        .score ??
      null,

    sharpnessScore:
      result.preSegmentation
        ?.sharpness
        .score ??
      null,

    maskScore:
      result.postSegmentation
        ?.mask
        .score ??
      null,

    backgroundScore:
      result.postSegmentation
        ?.background
        ?.score ??
      null,

    foregroundRatio:
      result.postSegmentation
        ?.mask
        .foregroundRatio ??
      null,

    componentCount:
      result.postSegmentation
        ?.mask
        .componentCount ??
      null,

    touchedEdgeCount:
      result.postSegmentation
        ?.mask
        .edgeContact
        .edgeCount ??
      null,

    processingTimeMs:
      result.processingTimeMs,
  };
}

/**
 * إنشاء Debug Summary نهائي.
 *
 * تستقبل Omit بدون debugSummary أيضًا
 * حتى نستطيع استخدامها أثناء إنشاء النتيجة.
 */
export function createFinalScanQualityDebugSummary(
  result:
    Omit<
      ScanQualityResult,
      'debugSummary'
    > |
    ScanQualityResult
): string {
  const lines:
    string[] = [
      'Triple N Scan Quality Gate',
      `Stage: ${result.stage}`,
      `Accepted: ${String(
        result.accepted
      )}`,
      `Decision: ${result.decision}`,
      `Final score: ${result.score.toFixed(
        4
      )}`,
      `User message: ${result.userMessageKey}`,
      `Processing time: ${result.processingTimeMs}ms`,
    ];

  if (
    result.preSegmentation
  ) {
    lines.push(
      '',
      'Pre-segmentation:',
      `Pre passed: ${String(
        result.preSegmentation
          .passed
      )}`,
      `Pre decision: ${result.preSegmentation.decision}`,
      `Pre score: ${result.preSegmentation.score.toFixed(
        4
      )}`,
      `Brightness score: ${result.preSegmentation.brightness.score.toFixed(
        4
      )}`,
      `Contrast score: ${result.preSegmentation.contrast.score.toFixed(
        4
      )}`,
      `Sharpness score: ${result.preSegmentation.sharpness.score.toFixed(
        4
      )}`
    );
  } else {
    lines.push(
      '',
      'Pre-segmentation: unavailable'
    );
  }

  if (
    result.postSegmentation
  ) {
    lines.push(
      '',
      'Post-segmentation:',
      `Post passed: ${String(
        result.postSegmentation
          .passed
      )}`,
      `Post decision: ${result.postSegmentation.decision}`,
      `Post score: ${result.postSegmentation.score.toFixed(
        4
      )}`,
      `Mask score: ${result.postSegmentation.mask.score.toFixed(
        4
      )}`,
      `Foreground ratio: ${result.postSegmentation.mask.foregroundRatio.toFixed(
        4
      )}`,
      `Components: ${result.postSegmentation.mask.componentCount}`,
      `Significant components: ${result.postSegmentation.mask.significantComponentCount}`,
      `Touched edges: ${result.postSegmentation.mask.edgeContact.edgeCount}`
    );

    if (
      result.postSegmentation
        .background
    ) {
      lines.push(
        `Background score: ${result.postSegmentation.background.score.toFixed(
          4
        )}`,
        `Background similarity: ${result.postSegmentation.background.similarityScore.toFixed(
          4
        )}`
      );
    } else {
      lines.push(
        'Background analysis: unavailable'
      );
    }
  } else {
    lines.push(
      '',
      'Post-segmentation: unavailable'
    );
  }

  lines.push(
    '',
    `Issues: ${result.issues.length}`
  );

  if (
    result.primaryIssue
  ) {
    lines.push(
      `Primary issue: ${result.primaryIssue.code}`,
      `Primary severity: ${result.primaryIssue.severity}`,
      `Primary confidence: ${result.primaryIssue.confidence.toFixed(
        4
      )}`,
      `Primary message: ${result.primaryIssue.messageKey}`
    );
  } else {
    lines.push(
      'Primary issue: none'
    );
  }

  lines.push(
    '',
    createScanQualityIssueDebugSummary(
      result.issues
    )
  );

  return lines.join(
    '\n'
  );
}

/**
 * Alias موحد للاستخدام داخل Scan Engine.
 */
export const analyzeScanQuality =
  runScanQualityGate;

/**
 * Alias واضح للقرار النهائي.
 */
export const finalizeScanQuality =
  finalizeScanQualityResult;

/**
 * Alias لفحص إمكانية قبول الصورة.
 */
export const isScanQualityAccepted =
  canAcceptScanQualityResult;

/**
 * Alias للـDebug النهائي.
 */
export const getScanQualityDebugSummary =
  createFinalScanQualityDebugSummary;

// End of Part 4/4
// End of scan/core/quality/ScanQualityGate.ts