// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 1/4
//
// Triple N - Boundary Sub-Pixel Refiner V3
//
// هذه الطبقة تستهدف فقط آخر بكسلات الحافة:
//
// - إزالة تسريب الخلفية حول الرقبة.
// - تحسين الحواف المائلة والمنحنية.
// - الحفاظ على الأجزاء الرفيعة.
// - عدم تغيير قلب القطعة أو شكلها الأساسي.
// - العمل مع جميع أنواع الملابس والأحذية والحقائب
//   والإكسسوارات بدون قواعد خاصة بنوع محدد.
//
// ترتيب الملف:
//
// Part 1:
// - Imports.
// - Types.
// - Configuration.
// - Validation.
// - Numeric and sampling utilities.
//
// Part 2:
// - Boundary candidate detection.
// - Mask/image gradient directions.
// - Inside/outside orientation.
//
// Part 3:
// - Sub-pixel sampling.
// - Color and edge evidence.
// - Thin-structure and corner protection.
//
// Part 4:
// - Decision engine.
// - Mask update.
// - Diagnostics.
// - Public API.

import type {
    SegmentationCancellationSignal,
    SegmentationFloatMask,
} from './types';

import {
    SegmentationError,
    clampSegmentationValue,
    clampUnitValue,
    cloneFloatMask,
    isValidFloatMask,
} from './types';

/* =========================================================
 * Analysis image
 * ======================================================= */

/**
 * صورة التحليل المستخدمة في نظام V3.
 *
 * rgb:
 * RGB interleaved داخل النطاق 0..1.
 *
 * gradient:
 * قوة الحافة داخل النطاق 0..1.
 *
 * gradientDirection:
 * اتجاه Gradient بالراديان أو null.
 *
 * luminance:
 * إضاءة البكسل داخل النطاق 0..1.
 */
export type BoundarySubPixelAnalysisImageV3 = {
  width:
    number;

  height:
    number;

  rgb:
    Float32Array;

  gradient:
    Float32Array;

  gradientDirection:
    Float32Array | null;

  luminance:
    Float32Array;
};

/* =========================================================
 * Configuration types
 * ======================================================= */

export type BoundarySubPixelUncertainPolicyV3 =
  | 'preserve'
  | 'soft-preserve'
  | 'unchanged';

export type BoundarySubPixelDetectionConfigV3 = {
  /**
   * أقل قيمة Mask تسمح بدخول البكسل
   * إلى التحليل كـForeground محتمل.
   */
  minimumMaskValue:
    number;

  /**
   * أقل قيمة نعتبر عندها البكسل
   * Foreground قويًا.
   */
  strongForegroundThreshold:
    number;

  /**
   * أعلى قيمة نعتبر تحتها البكسل
   * Background قويًا.
   */
  strongBackgroundThreshold:
    number;

  /**
   * نصف قطر فحص تغير Alpha.
   */
  boundaryRadius:
    number;

  /**
   * أقل فرق محلي في Alpha
   * لاعتبار المنطقة حافة.
   */
  minimumLocalAlphaRange:
    number;

  /**
   * أقصى مسافة داخلية من الحافة
   * يمكن تعديلها.
   */
  maximumInnerDistance:
    number;

  /**
   * أقصى مسافة خارجية من الحافة
   * يمكن استعادتها.
   */
  maximumOuterDistance:
    number;

  /**
   * فحص البكسلات داخل الماسك.
   */
  includeInnerCandidates:
    boolean;

  /**
   * فحص البكسلات خارج الماسك مباشرة.
   */
  includeOuterCandidates:
    boolean;

  /**
   * الحد الأقصى للمرشحين.
   *
   * صفر يعني بدون حد.
   */
  maximumCandidates:
    number;
};

export type BoundarySubPixelDirectionConfigV3 = {
  /**
   * استخدام اتجاه Gradient الصورة.
   */
  useImageGradient:
    boolean;

  /**
   * استخدام اتجاه Gradient الماسك.
   */
  useMaskGradient:
    boolean;

  /**
   * أقل Gradient صورة يمكن الوثوق به.
   */
  minimumImageGradient:
    number;

  /**
   * أقل مقدار Gradient ماسك.
   */
  minimumMaskGradient:
    number;

  /**
   * نصف قطر حساب Gradient الماسك.
   */
  maskGradientRadius:
    number;

  /**
   * وزن اتجاه الصورة عند الدمج.
   */
  imageDirectionWeight:
    number;

  /**
   * وزن اتجاه الماسك عند الدمج.
   */
  maskDirectionWeight:
    number;

  /**
   * أقل اتفاق بين الاتجاهين.
   */
  minimumDirectionAgreement:
    number;

  /**
   * عند تعارض قوي نستخدم الاتجاه الأقوى.
   */
  preferStrongerDirectionOnConflict:
    boolean;
};

export type BoundarySubPixelSamplingConfigV3 = {
  /**
   * مسافات العينات داخل الجسم.
   */
  insideDistances:
    readonly number[];

  /**
   * مسافات العينات خارج الجسم.
   */
  outsideDistances:
    readonly number[];

  /**
   * عدد العينات الجانبية على Tangent.
   */
  tangentialSamples:
    number;

  /**
   * المسافة الجانبية القصوى.
   */
  tangentialRadius:
    number;

  /**
   * أقل عدد عينات داخلية صالحة.
   */
  minimumInsideSamples:
    number;

  /**
   * أقل عدد عينات خارجية صالحة.
   */
  minimumOutsideSamples:
    number;

  /**
   * استخدام Bilinear Sampling.
   */
  bilinear:
    boolean;

  /**
   * رفض العينة الخارجة من الصورة.
   */
  rejectOutOfBounds:
    boolean;

  /**
   * وزن أقرب عينة للحافة.
   */
  nearWeight:
    number;

  /**
   * وزن أبعد عينة عن الحافة.
   */
  farWeight:
    number;
};

export type BoundarySubPixelColorConfigV3 = {
  rgbWeight:
    number;

  luminanceWeight:
    number;

  saturationWeight:
    number;

  maximumChannelDifferenceWeight:
    number;

  /**
   * تضخيم فروق اللون الصغيرة.
   */
  distanceSensitivity:
    number;

  /**
   * حماية الملابس السوداء.
   */
  protectDarkForeground:
    boolean;

  darkLuminanceThreshold:
    number;

  /**
   * حماية الملابس البيضاء منخفضة التشبع.
   */
  protectBrightLowSaturationForeground:
    boolean;

  brightLuminanceThreshold:
    number;

  lowSaturationThreshold:
    number;
};

export type BoundarySubPixelEdgeConfigV3 = {
  minimumUsefulGradient:
    number;

  strongGradientThreshold:
    number;

  gradientStrengthWeight:
    number;

  gradientAlignmentWeight:
    number;

  edgeCenterWeight:
    number;

  /**
   * أقصى إزاحة Sub-Pixel.
   */
  maximumOffset:
    number;

  /**
   * خطوة البحث، مثال 0.25.
   */
  searchStep:
    number;

  /**
   * أقل تحسن لقبول الإزاحة.
   */
  minimumImprovement:
    number;
};

export type BoundarySubPixelProtectionConfigV3 = {
  protectThinStructures:
    boolean;

  thinStructureRadius:
    number;

  maximumThinWidth:
    number;

  minimumThinConnectivity:
    number;

  thinRemovalReduction:
    number;

  protectSharpCorners:
    boolean;

  sharpCornerThreshold:
    number;

  cornerRemovalReduction:
    number;

  protectHighTexture:
    boolean;

  highTextureThreshold:
    number;

  textureRemovalReduction:
    number;
};

export type BoundarySubPixelDecisionConfigV3 = {
  foregroundWeight:
    number;

  backgroundWeight:
    number;

  colorWeight:
    number;

  edgeWeight:
    number;

  originalMaskWeight:
    number;

  minimumRemovalConfidence:
    number;

  strongRemovalConfidence:
    number;

  minimumRecoveryConfidence:
    number;

  strongRecoveryConfidence:
    number;

  uncertaintyMargin:
    number;

  maximumAlphaReduction:
    number;

  maximumAlphaIncrease:
    number;

  maximumStrongBackgroundAlpha:
    number;

  minimumProtectedForegroundAlpha:
    number;

  uncertainPolicy:
    BoundarySubPixelUncertainPolicyV3;

  uncertaintyProtection:
    number;
};

export type BoundarySubPixelRuntimeConfigV3 = {
  passes:
    number;

  rebuildCandidatesBetweenPasses:
    boolean;

  minimumAverageChangeForNextPass:
    number;

  cancellationCheckInterval:
    number;

  collectDiagnostics:
    boolean;

  maximumWarnings:
    number;
};

export type BoundarySubPixelRefinerConfigV3 = {
  enabled:
    boolean;

  detection:
    BoundarySubPixelDetectionConfigV3;

  direction:
    BoundarySubPixelDirectionConfigV3;

  sampling:
    BoundarySubPixelSamplingConfigV3;

  color:
    BoundarySubPixelColorConfigV3;

  edge:
    BoundarySubPixelEdgeConfigV3;

  protection:
    BoundarySubPixelProtectionConfigV3;

  decision:
    BoundarySubPixelDecisionConfigV3;

  runtime:
    BoundarySubPixelRuntimeConfigV3;
};

/* =========================================================
 * Geometry and sample types
 * ======================================================= */

export type BoundarySubPixelVectorV3 = {
  x:
    number;

  y:
    number;
};

export type BoundarySubPixelRgbV3 = {
  red:
    number;

  green:
    number;

  blue:
    number;
};

export type BoundarySubPixelSampleV3 = {
  x:
    number;

  y:
    number;

  red:
    number;

  green:
    number;

  blue:
    number;

  luminance:
    number;

  saturation:
    number;

  gradient:
    number;

  maskValue:
    number;

  weight:
    number;

  valid:
    boolean;
};

export type BoundarySubPixelWeightedSampleV3 = {
  red:
    number;

  green:
    number;

  blue:
    number;

  luminance:
    number;

  saturation:
    number;

  gradient:
    number;

  maskValue:
    number;

  totalWeight:
    number;

  sampleCount:
    number;

  valid:
    boolean;
};

export type BoundarySubPixelDirectionSourceV3 =
  | 'image'
  | 'mask'
  | 'fused'
  | 'fallback'
  | 'invalid';

export type BoundarySubPixelDirectionV3 = {
  normal:
    BoundarySubPixelVectorV3;

  tangent:
    BoundarySubPixelVectorV3;

  imageNormal:
    BoundarySubPixelVectorV3 | null;

  maskNormal:
    BoundarySubPixelVectorV3 | null;

  imageStrength:
    number;

  maskStrength:
    number;

  agreement:
    number;

  confidence:
    number;

  source:
    BoundarySubPixelDirectionSourceV3;

  valid:
    boolean;
};

/* =========================================================
 * Candidate and decision types
 * ======================================================= */

export type BoundarySubPixelCandidateKindV3 =
  | 'inner'
  | 'outer'
  | 'soft';

export type BoundarySubPixelCandidateV3 = {
  index:
    number;

  x:
    number;

  y:
    number;

  kind:
    BoundarySubPixelCandidateKindV3;

  originalAlpha:
    number;

  localMinimumAlpha:
    number;

  localMaximumAlpha:
    number;

  localAlphaRange:
    number;

  estimatedBoundaryDistance:
    number;

  direction:
    BoundarySubPixelDirectionV3 | null;
};

export type BoundarySubPixelColorDistanceV3 = {
  rgb:
    number;

  luminance:
    number;

  saturation:
    number;

  maximumChannel:
    number;

  combined:
    number;
};

export type BoundarySubPixelProtectionV3 = {
  thinStructure:
    boolean;

  sharpCorner:
    boolean;

  highTexture:
    boolean;

  removalReduction:
    number;

  recoveryReduction:
    number;

  confidence:
    number;
};

export type BoundarySubPixelEvidenceV3 = {
  foreground:
    number;

  background:
    number;

  color:
    number;

  edge:
    number;

  originalMask:
    number;

  uncertainty:
    number;
};

export type BoundarySubPixelDecisionKindV3 =
  | 'remove-leak'
  | 'recover-foreground'
  | 'soften'
  | 'preserve'
  | 'unchanged'
  | 'reject';

export type BoundarySubPixelDecisionV3 = {
  kind:
    BoundarySubPixelDecisionKindV3;

  originalAlpha:
    number;

  targetAlpha:
    number;

  finalAlpha:
    number;

  confidence:
    number;

  subPixelOffset:
    number;

  evidence:
    BoundarySubPixelEvidenceV3;

  protection:
    BoundarySubPixelProtectionV3;

  reason:
    string;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type BoundarySubPixelPassDiagnosticsV3 = {
  pass:
    number;

  candidateCount:
    number;

  analyzedCount:
    number;

  rejectedCount:
    number;

  removedLeakPixels:
    number;

  recoveredForegroundPixels:
    number;

  softenedPixels:
    number;

  preservedPixels:
    number;

  unchangedPixels:
    number;

  protectedThinPixels:
    number;

  protectedCornerPixels:
    number;

  protectedTexturePixels:
    number;

  totalAlphaReduction:
    number;

  totalAlphaIncrease:
    number;

  averageAbsoluteChange:
    number;

  maximumAbsoluteChange:
    number;

  durationMs:
    number;
};

export type BoundarySubPixelDiagnosticsV3 = {
  enabled:
    boolean;

  applied:
    boolean;

  width:
    number;

  height:
    number;

  totalPixels:
    number;

  totalCandidates:
    number;

  totalAnalyzed:
    number;

  totalRejected:
    number;

  totalRemovedLeakPixels:
    number;

  totalRecoveredForegroundPixels:
    number;

  totalSoftenedPixels:
    number;

  totalPreservedPixels:
    number;

  totalUnchangedPixels:
    number;

  totalProtectedThinPixels:
    number;

  totalProtectedCornerPixels:
    number;

  totalProtectedTexturePixels:
    number;

  totalAlphaReduction:
    number;

  totalAlphaIncrease:
    number;

  averageAbsoluteChange:
    number;

  maximumAbsoluteChange:
    number;

  passesCompleted:
    number;

  passes:
    readonly BoundarySubPixelPassDiagnosticsV3[];

  warnings:
    readonly string[];

  durationMs:
    number;
};

export type BoundarySubPixelRefinerResultV3 = {
  mask:
    SegmentationFloatMask;

  diagnostics:
    BoundarySubPixelDiagnosticsV3;
};

export type BoundarySubPixelRefinerRequestV3 = {
  image:
    BoundarySubPixelAnalysisImageV3;

  mask:
    SegmentationFloatMask;

  config?:
    Partial<BoundarySubPixelRefinerConfigV3>;

  requestId?:
    string;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

/* =========================================================
 * Default configuration
 * ======================================================= */

export const DEFAULT_BOUNDARY_SUB_PIXEL_REFINER_CONFIG_V3:
  Readonly<BoundarySubPixelRefinerConfigV3> = {
    enabled:
      true,

    detection: {
      minimumMaskValue:
        0.025,

      strongForegroundThreshold:
        0.78,

      strongBackgroundThreshold:
        0.1,

      boundaryRadius:
        2,

      minimumLocalAlphaRange:
        0.1,

      maximumInnerDistance:
        3,

      maximumOuterDistance:
        2,

      includeInnerCandidates:
        true,

      includeOuterCandidates:
        true,

      maximumCandidates:
        0,
    },

    direction: {
      useImageGradient:
        true,

      useMaskGradient:
        true,

      minimumImageGradient:
        0.045,

      minimumMaskGradient:
        0.02,

      maskGradientRadius:
        1,

      imageDirectionWeight:
        0.58,

      maskDirectionWeight:
        0.42,

      minimumDirectionAgreement:
        0.26,

      preferStrongerDirectionOnConflict:
        true,
    },

    sampling: {
      insideDistances: [
        0.5,
        1,
        1.75,
        2.75,
      ],

      outsideDistances: [
        0.5,
        1,
        1.75,
        2.75,
      ],

      tangentialSamples:
        2,

      tangentialRadius:
        1.25,

      minimumInsideSamples:
        3,

      minimumOutsideSamples:
        3,

      bilinear:
        true,

      rejectOutOfBounds:
        true,

      nearWeight:
        1,

      farWeight:
        0.5,
    },

    color: {
      rgbWeight:
        0.52,

      luminanceWeight:
        0.18,

      saturationWeight:
        0.18,

      maximumChannelDifferenceWeight:
        0.12,

      distanceSensitivity:
        1.35,

      protectDarkForeground:
        true,

      darkLuminanceThreshold:
        0.09,

      protectBrightLowSaturationForeground:
        true,

      brightLuminanceThreshold:
        0.9,

      lowSaturationThreshold:
        0.12,
    },

    edge: {
      minimumUsefulGradient:
        0.03,

      strongGradientThreshold:
        0.17,

      gradientStrengthWeight:
        0.4,

      gradientAlignmentWeight:
        0.34,

      edgeCenterWeight:
        0.26,

      maximumOffset:
        1.25,

      searchStep:
        0.25,

      minimumImprovement:
        0.04,
    },

    protection: {
      protectThinStructures:
        true,

      thinStructureRadius:
        4,

      maximumThinWidth:
        5,

      minimumThinConnectivity:
        0.28,

      thinRemovalReduction:
        0.72,

      protectSharpCorners:
        true,

      sharpCornerThreshold:
        0.58,

      cornerRemovalReduction:
        0.48,

      protectHighTexture:
        true,

      highTextureThreshold:
        0.14,

      textureRemovalReduction:
        0.4,
    },

    decision: {
      foregroundWeight:
        0.22,

      backgroundWeight:
        0.26,

      colorWeight:
        0.23,

      edgeWeight:
        0.2,

      originalMaskWeight:
        0.09,

      minimumRemovalConfidence:
        0.6,

      strongRemovalConfidence:
        0.8,

      minimumRecoveryConfidence:
        0.72,

      strongRecoveryConfidence:
        0.88,

      uncertaintyMargin:
        0.1,

      maximumAlphaReduction:
        0.7,

      maximumAlphaIncrease:
        0.35,

      maximumStrongBackgroundAlpha:
        0.06,

      minimumProtectedForegroundAlpha:
        0.3,

      uncertainPolicy:
        'preserve',

      uncertaintyProtection:
        0.8,
    },

    runtime: {
      passes:
        1,

      rebuildCandidatesBetweenPasses:
        true,

      minimumAverageChangeForNextPass:
        0.0025,

      cancellationCheckInterval:
        16384,

      collectDiagnostics:
        true,

      maximumWarnings:
        40,
    },
  };

/* =========================================================
 * Internal constants
 * ======================================================= */

const SUB_PIXEL_EPSILON_V3 =
  1e-8;

const SUB_PIXEL_MAXIMUM_SAFE_PIXELS_V3 =
  32_000_000;

const SUB_PIXEL_TWO_PI_V3 =
  Math.PI * 2;

/* =========================================================
 * Numeric utilities
 * ======================================================= */

function finiteOrV3(
  value:
    number,
  fallback:
    number
): number {
  return Number.isFinite(value)
    ? value
    : fallback;
}

function clampFiniteV3(
  value:
    number,
  minimum:
    number,
  maximum:
    number,
  fallback:
    number
): number {
  return clampSegmentationValue(
    finiteOrV3(
      value,
      fallback
    ),
    minimum,
    maximum
  );
}

function clampIntegerV3(
  value:
    number,
  minimum:
    number,
  maximum:
    number,
  fallback:
    number
): number {
  return Math.round(
    clampFiniteV3(
      value,
      minimum,
      maximum,
      fallback
    )
  );
}

function safeDivideV3(
  numerator:
    number,
  denominator:
    number,
  fallback =
    0
): number {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    Math.abs(denominator) <=
      SUB_PIXEL_EPSILON_V3
  ) {
    return fallback;
  }

  const result =
    numerator /
    denominator;

  return Number.isFinite(result)
    ? result
    : fallback;
}

function lerpV3(
  start:
    number,
  end:
    number,
  amount:
    number
): number {
  const t =
    clampUnitValue(
      amount
    );

  return (
    start +
    (end - start) *
      t
  );
}

function inverseLerpV3(
  start:
    number,
  end:
    number,
  value:
    number
): number {
  const range =
    end -
    start;

  if (
    Math.abs(range) <=
    SUB_PIXEL_EPSILON_V3
  ) {
    return 0;
  }

  return clampUnitValue(
    (value - start) /
      range
  );
}

function smoothStepV3(
  edge0:
    number,
  edge1:
    number,
  value:
    number
): number {
  const t =
    inverseLerpV3(
      edge0,
      edge1,
      value
    );

  return (
    t *
    t *
    (3 - 2 * t)
  );
}

/* =========================================================
 * Vector utilities
 * ======================================================= */

function createVectorV3(
  x:
    number,
  y:
    number
): BoundarySubPixelVectorV3 {
  return {
    x:
      finiteOrV3(
        x,
        0
      ),

    y:
      finiteOrV3(
        y,
        0
      ),
  };
}

function vectorLengthSquaredV3(
  vector:
    BoundarySubPixelVectorV3
): number {
  return (
    vector.x *
      vector.x +
    vector.y *
      vector.y
  );
}

function vectorLengthV3(
  vector:
    BoundarySubPixelVectorV3
): number {
  return Math.sqrt(
    Math.max(
      0,
      vectorLengthSquaredV3(
        vector
      )
    )
  );
}

function normalizeVectorV3(
  vector:
    BoundarySubPixelVectorV3,
  fallback:
    BoundarySubPixelVectorV3 = {
      x: 1,
      y: 0,
    }
): BoundarySubPixelVectorV3 {
  const length =
    vectorLengthV3(
      vector
    );

  if (
    length <=
    SUB_PIXEL_EPSILON_V3
  ) {
    const fallbackLength =
      vectorLengthV3(
        fallback
      );

    if (
      fallbackLength <=
      SUB_PIXEL_EPSILON_V3
    ) {
      return {
        x: 1,
        y: 0,
      };
    }

    return {
      x:
        fallback.x /
        fallbackLength,

      y:
        fallback.y /
        fallbackLength,
    };
  }

  return {
    x:
      vector.x /
      length,

    y:
      vector.y /
      length,
  };
}

function negateVectorV3(
  vector:
    BoundarySubPixelVectorV3
): BoundarySubPixelVectorV3 {
  return {
    x:
      -vector.x,

    y:
      -vector.y,
  };
}

function scaleVectorV3(
  vector:
    BoundarySubPixelVectorV3,
  scalar:
    number
): BoundarySubPixelVectorV3 {
  const safeScalar =
    finiteOrV3(
      scalar,
      0
    );

  return {
    x:
      vector.x *
      safeScalar,

    y:
      vector.y *
      safeScalar,
  };
}

function addVectorsV3(
  first:
    BoundarySubPixelVectorV3,
  second:
    BoundarySubPixelVectorV3
): BoundarySubPixelVectorV3 {
  return {
    x:
      first.x +
      second.x,

    y:
      first.y +
      second.y,
  };
}

function dotVectorsV3(
  first:
    BoundarySubPixelVectorV3,
  second:
    BoundarySubPixelVectorV3
): number {
  return (
    first.x *
      second.x +
    first.y *
      second.y
  );
}

function vectorAgreementV3(
  first:
    BoundarySubPixelVectorV3,
  second:
    BoundarySubPixelVectorV3
): number {
  const normalizedFirst =
    normalizeVectorV3(
      first
    );

  const normalizedSecond =
    normalizeVectorV3(
      second
    );

  return clampUnitValue(
    Math.abs(
      dotVectorsV3(
        normalizedFirst,
        normalizedSecond
      )
    )
  );
}

function perpendicularVectorV3(
  vector:
    BoundarySubPixelVectorV3
): BoundarySubPixelVectorV3 {
  return normalizeVectorV3({
    x:
      -vector.y,

    y:
      vector.x,
  });
}

function vectorFromAngleV3(
  angle:
    number
): BoundarySubPixelVectorV3 {
  if (!Number.isFinite(angle)) {
    return {
      x: 1,
      y: 0,
    };
  }

  return {
    x:
      Math.cos(angle),

    y:
      Math.sin(angle),
  };
}

function normalizeAngleV3(
  angle:
    number
): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }

  let normalized =
    angle %
    SUB_PIXEL_TWO_PI_V3;

  if (normalized > Math.PI) {
    normalized -=
      SUB_PIXEL_TWO_PI_V3;
  } else if (
    normalized < -Math.PI
  ) {
    normalized +=
      SUB_PIXEL_TWO_PI_V3;
  }

  return normalized;
}

function fuseVectorsV3(
  first:
    BoundarySubPixelVectorV3,
  firstWeight:
    number,
  second:
    BoundarySubPixelVectorV3,
  secondWeight:
    number
): BoundarySubPixelVectorV3 {
  return normalizeVectorV3({
    x:
      first.x *
        Math.max(
          0,
          firstWeight
        ) +
      second.x *
        Math.max(
          0,
          secondWeight
        ),

    y:
      first.y *
        Math.max(
          0,
          firstWeight
        ) +
      second.y *
        Math.max(
          0,
          secondWeight
        ),
  });
}

/* =========================================================
 * Color utilities
 * ======================================================= */

function calculateLuminanceV3(
  red:
    number,
  green:
    number,
  blue:
    number
): number {
  return clampUnitValue(
    red *
      0.2126 +
    green *
      0.7152 +
    blue *
      0.0722
  );
}

function calculateSaturationV3(
  red:
    number,
  green:
    number,
  blue:
    number
): number {
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

  if (
    maximum <=
    SUB_PIXEL_EPSILON_V3
  ) {
    return 0;
  }

  return clampUnitValue(
    (maximum - minimum) /
      maximum
  );
}

/* =========================================================
 * Cancellation utilities
 * ======================================================= */

function assertNotCancelledV3(
  signal:
    SegmentationCancellationSignal | undefined
): void {
  signal?.throwIfCancelled();
}

function shouldCheckCancellationV3(
  operation:
    number,
  interval:
    number
): boolean {
  const safeInterval =
    Math.max(
      1,
      Math.floor(interval)
    );

  return (
    operation %
      safeInterval ===
    0
  );
}

/* =========================================================
 * Configuration normalization
 * ======================================================= */

function normalizeDistancesV3(
  values:
    readonly number[] | undefined,
  fallback:
    readonly number[]
): readonly number[] {
  const source =
    Array.isArray(values) &&
    values.length > 0
      ? values
      : fallback;

  const result:
    number[] = [];

  for (
    const value of source
  ) {
    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      continue;
    }

    const normalized =
      clampFiniteV3(
        value,
        0.125,
        12,
        1
      );

    if (
      !result.some(
        existing =>
          Math.abs(
            existing -
            normalized
          ) <=
          SUB_PIXEL_EPSILON_V3
      )
    ) {
      result.push(
        normalized
      );
    }
  }

  if (
    result.length === 0
  ) {
    return [
      0.5,
      1,
      2,
    ];
  }

  result.sort(
    (first, second) =>
      first -
      second
  );

  return result;
}

export function normalizeBoundarySubPixelRefinerConfigV3(
  config:
    Partial<BoundarySubPixelRefinerConfigV3> = {}
): BoundarySubPixelRefinerConfigV3 {
  const defaults =
    DEFAULT_BOUNDARY_SUB_PIXEL_REFINER_CONFIG_V3;

  const detection = {
    ...defaults.detection,
    ...(config.detection ?? {}),
  };

  const direction = {
    ...defaults.direction,
    ...(config.direction ?? {}),
  };

  const sampling = {
    ...defaults.sampling,
    ...(config.sampling ?? {}),
  };

  const color = {
    ...defaults.color,
    ...(config.color ?? {}),
  };

  const edge = {
    ...defaults.edge,
    ...(config.edge ?? {}),
  };

  const protection = {
    ...defaults.protection,
    ...(config.protection ?? {}),
  };

  const decision = {
    ...defaults.decision,
    ...(config.decision ?? {}),
  };

  const runtime = {
    ...defaults.runtime,
    ...(config.runtime ?? {}),
  };

  const strongBackgroundThreshold =
    clampFiniteV3(
      detection
        .strongBackgroundThreshold,
      0,
      0.49,
      defaults
        .detection
        .strongBackgroundThreshold
    );

  const strongForegroundThreshold =
    clampFiniteV3(
      detection
        .strongForegroundThreshold,
      Math.max(
        0.51,
        strongBackgroundThreshold +
          0.02
      ),
      1,
      defaults
        .detection
        .strongForegroundThreshold
    );

  const minimumRemovalConfidence =
    clampFiniteV3(
      decision
        .minimumRemovalConfidence,
      0,
      1,
      defaults
        .decision
        .minimumRemovalConfidence
    );

  const minimumRecoveryConfidence =
    clampFiniteV3(
      decision
        .minimumRecoveryConfidence,
      0,
      1,
      defaults
        .decision
        .minimumRecoveryConfidence
    );

  const uncertainPolicy:
    BoundarySubPixelUncertainPolicyV3 =
      decision.uncertainPolicy ===
        'soft-preserve' ||
      decision.uncertainPolicy ===
        'unchanged'
        ? decision.uncertainPolicy
        : 'preserve';

  return {
    enabled:
      config.enabled ??
      defaults.enabled,

    detection: {
      minimumMaskValue:
        clampFiniteV3(
          detection.minimumMaskValue,
          0,
          strongForegroundThreshold,
          defaults
            .detection
            .minimumMaskValue
        ),

      strongForegroundThreshold,

      strongBackgroundThreshold,

      boundaryRadius:
        clampIntegerV3(
          detection.boundaryRadius,
          1,
          6,
          defaults
            .detection
            .boundaryRadius
        ),

      minimumLocalAlphaRange:
        clampFiniteV3(
          detection
            .minimumLocalAlphaRange,
          0.005,
          1,
          defaults
            .detection
            .minimumLocalAlphaRange
        ),

      maximumInnerDistance:
        clampIntegerV3(
          detection
            .maximumInnerDistance,
          1,
          8,
          defaults
            .detection
            .maximumInnerDistance
        ),

      maximumOuterDistance:
        clampIntegerV3(
          detection
            .maximumOuterDistance,
          1,
          8,
          defaults
            .detection
            .maximumOuterDistance
        ),

      includeInnerCandidates:
        Boolean(
          detection
            .includeInnerCandidates
        ),

      includeOuterCandidates:
        Boolean(
          detection
            .includeOuterCandidates
        ),

      maximumCandidates:
        clampIntegerV3(
          detection
            .maximumCandidates,
          0,
          SUB_PIXEL_MAXIMUM_SAFE_PIXELS_V3,
          defaults
            .detection
            .maximumCandidates
        ),
    },

    direction: {
      useImageGradient:
        Boolean(
          direction
            .useImageGradient
        ),

      useMaskGradient:
        Boolean(
          direction
            .useMaskGradient
        ),

      minimumImageGradient:
        clampFiniteV3(
          direction
            .minimumImageGradient,
          0,
          1,
          defaults
            .direction
            .minimumImageGradient
        ),

      minimumMaskGradient:
        clampFiniteV3(
          direction
            .minimumMaskGradient,
          0,
          2,
          defaults
            .direction
            .minimumMaskGradient
        ),

      maskGradientRadius:
        clampIntegerV3(
          direction
            .maskGradientRadius,
          1,
          4,
          defaults
            .direction
            .maskGradientRadius
        ),

      imageDirectionWeight:
        clampFiniteV3(
          direction
            .imageDirectionWeight,
          0,
          4,
          defaults
            .direction
            .imageDirectionWeight
        ),

      maskDirectionWeight:
        clampFiniteV3(
          direction
            .maskDirectionWeight,
          0,
          4,
          defaults
            .direction
            .maskDirectionWeight
        ),

      minimumDirectionAgreement:
        clampFiniteV3(
          direction
            .minimumDirectionAgreement,
          0,
          1,
          defaults
            .direction
            .minimumDirectionAgreement
        ),

      preferStrongerDirectionOnConflict:
        Boolean(
          direction
            .preferStrongerDirectionOnConflict
        ),
    },

    sampling: {
      insideDistances:
        normalizeDistancesV3(
          sampling.insideDistances,
          defaults
            .sampling
            .insideDistances
        ),

      outsideDistances:
        normalizeDistancesV3(
          sampling.outsideDistances,
          defaults
            .sampling
            .outsideDistances
        ),

      tangentialSamples:
        clampIntegerV3(
          sampling
            .tangentialSamples,
          0,
          6,
          defaults
            .sampling
            .tangentialSamples
        ),

      tangentialRadius:
        clampFiniteV3(
          sampling
            .tangentialRadius,
          0,
          6,
          defaults
            .sampling
            .tangentialRadius
        ),

      minimumInsideSamples:
        clampIntegerV3(
          sampling
            .minimumInsideSamples,
          1,
          64,
          defaults
            .sampling
            .minimumInsideSamples
        ),

      minimumOutsideSamples:
        clampIntegerV3(
          sampling
            .minimumOutsideSamples,
          1,
          64,
          defaults
            .sampling
            .minimumOutsideSamples
        ),

      bilinear:
        Boolean(
          sampling.bilinear
        ),

      rejectOutOfBounds:
        Boolean(
          sampling
            .rejectOutOfBounds
        ),

      nearWeight:
        clampFiniteV3(
          sampling.nearWeight,
          0.01,
          8,
          defaults
            .sampling
            .nearWeight
        ),

      farWeight:
        clampFiniteV3(
          sampling.farWeight,
          0.01,
          8,
          defaults
            .sampling
            .farWeight
        ),
    },

    color: {
      rgbWeight:
        clampFiniteV3(
          color.rgbWeight,
          0,
          4,
          defaults
            .color
            .rgbWeight
        ),

      luminanceWeight:
        clampFiniteV3(
          color.luminanceWeight,
          0,
          4,
          defaults
            .color
            .luminanceWeight
        ),

      saturationWeight:
        clampFiniteV3(
          color.saturationWeight,
          0,
          4,
          defaults
            .color
            .saturationWeight
        ),

      maximumChannelDifferenceWeight:
        clampFiniteV3(
          color
            .maximumChannelDifferenceWeight,
          0,
          4,
          defaults
            .color
            .maximumChannelDifferenceWeight
        ),

      distanceSensitivity:
        clampFiniteV3(
          color
            .distanceSensitivity,
          0.1,
          8,
          defaults
            .color
            .distanceSensitivity
        ),

      protectDarkForeground:
        Boolean(
          color
            .protectDarkForeground
        ),

      darkLuminanceThreshold:
        clampFiniteV3(
          color
            .darkLuminanceThreshold,
          0,
          0.45,
          defaults
            .color
            .darkLuminanceThreshold
        ),

      protectBrightLowSaturationForeground:
        Boolean(
          color
            .protectBrightLowSaturationForeground
        ),

      brightLuminanceThreshold:
        clampFiniteV3(
          color
            .brightLuminanceThreshold,
          0.55,
          1,
          defaults
            .color
            .brightLuminanceThreshold
        ),

      lowSaturationThreshold:
        clampFiniteV3(
          color
            .lowSaturationThreshold,
          0,
          1,
          defaults
            .color
            .lowSaturationThreshold
        ),
    },

    edge: {
      minimumUsefulGradient:
        clampFiniteV3(
          edge
            .minimumUsefulGradient,
          0,
          1,
          defaults
            .edge
            .minimumUsefulGradient
        ),

      strongGradientThreshold:
        clampFiniteV3(
          edge
            .strongGradientThreshold,
          0,
          1,
          defaults
            .edge
            .strongGradientThreshold
        ),

      gradientStrengthWeight:
        clampFiniteV3(
          edge
            .gradientStrengthWeight,
          0,
          4,
          defaults
            .edge
            .gradientStrengthWeight
        ),

      gradientAlignmentWeight:
        clampFiniteV3(
          edge
            .gradientAlignmentWeight,
          0,
          4,
          defaults
            .edge
            .gradientAlignmentWeight
        ),

      edgeCenterWeight:
        clampFiniteV3(
          edge
            .edgeCenterWeight,
          0,
          4,
          defaults
            .edge
            .edgeCenterWeight
        ),

      maximumOffset:
        clampFiniteV3(
          edge.maximumOffset,
          0,
          4,
          defaults
            .edge
            .maximumOffset
        ),

      searchStep:
        clampFiniteV3(
          edge.searchStep,
          0.05,
          1,
          defaults
            .edge
            .searchStep
        ),

      minimumImprovement:
        clampFiniteV3(
          edge
            .minimumImprovement,
          0,
          1,
          defaults
            .edge
            .minimumImprovement
        ),
    },

    protection: {
      protectThinStructures:
        Boolean(
          protection
            .protectThinStructures
        ),

      thinStructureRadius:
        clampIntegerV3(
          protection
            .thinStructureRadius,
          1,
          10,
          defaults
            .protection
            .thinStructureRadius
        ),

      maximumThinWidth:
        clampIntegerV3(
          protection
            .maximumThinWidth,
          1,
          20,
          defaults
            .protection
            .maximumThinWidth
        ),

      minimumThinConnectivity:
        clampFiniteV3(
          protection
            .minimumThinConnectivity,
          0,
          1,
          defaults
            .protection
            .minimumThinConnectivity
        ),

      thinRemovalReduction:
        clampFiniteV3(
          protection
            .thinRemovalReduction,
          0,
          1,
          defaults
            .protection
            .thinRemovalReduction
        ),

      protectSharpCorners:
        Boolean(
          protection
            .protectSharpCorners
        ),

      sharpCornerThreshold:
        clampFiniteV3(
          protection
            .sharpCornerThreshold,
          0,
          1,
          defaults
            .protection
            .sharpCornerThreshold
        ),

      cornerRemovalReduction:
        clampFiniteV3(
          protection
            .cornerRemovalReduction,
          0,
          1,
          defaults
            .protection
            .cornerRemovalReduction
        ),

      protectHighTexture:
        Boolean(
          protection
            .protectHighTexture
        ),

      highTextureThreshold:
        clampFiniteV3(
          protection
            .highTextureThreshold,
          0,
          1,
          defaults
            .protection
            .highTextureThreshold
        ),

      textureRemovalReduction:
        clampFiniteV3(
          protection
            .textureRemovalReduction,
          0,
          1,
          defaults
            .protection
            .textureRemovalReduction
        ),
    },

    decision: {
      foregroundWeight:
        clampFiniteV3(
          decision
            .foregroundWeight,
          0,
          4,
          defaults
            .decision
            .foregroundWeight
        ),

      backgroundWeight:
        clampFiniteV3(
          decision
            .backgroundWeight,
          0,
          4,
          defaults
            .decision
            .backgroundWeight
        ),

      colorWeight:
        clampFiniteV3(
          decision.colorWeight,
          0,
          4,
          defaults
            .decision
            .colorWeight
        ),

      edgeWeight:
        clampFiniteV3(
          decision.edgeWeight,
          0,
          4,
          defaults
            .decision
            .edgeWeight
        ),

      originalMaskWeight:
        clampFiniteV3(
          decision
            .originalMaskWeight,
          0,
          4,
          defaults
            .decision
            .originalMaskWeight
        ),

      minimumRemovalConfidence,

      strongRemovalConfidence:
        clampFiniteV3(
          decision
            .strongRemovalConfidence,
          minimumRemovalConfidence,
          1,
          defaults
            .decision
            .strongRemovalConfidence
        ),

      minimumRecoveryConfidence,

      strongRecoveryConfidence:
        clampFiniteV3(
          decision
            .strongRecoveryConfidence,
          minimumRecoveryConfidence,
          1,
          defaults
            .decision
            .strongRecoveryConfidence
        ),

      uncertaintyMargin:
        clampFiniteV3(
          decision
            .uncertaintyMargin,
          0,
          0.5,
          defaults
            .decision
            .uncertaintyMargin
        ),

      maximumAlphaReduction:
        clampFiniteV3(
          decision
            .maximumAlphaReduction,
          0,
          1,
          defaults
            .decision
            .maximumAlphaReduction
        ),

      maximumAlphaIncrease:
        clampFiniteV3(
          decision
            .maximumAlphaIncrease,
          0,
          1,
          defaults
            .decision
            .maximumAlphaIncrease
        ),

      maximumStrongBackgroundAlpha:
        clampFiniteV3(
          decision
            .maximumStrongBackgroundAlpha,
          0,
          1,
          defaults
            .decision
            .maximumStrongBackgroundAlpha
        ),

      minimumProtectedForegroundAlpha:
        clampFiniteV3(
          decision
            .minimumProtectedForegroundAlpha,
          0,
          1,
          defaults
            .decision
            .minimumProtectedForegroundAlpha
        ),

      uncertainPolicy,

      uncertaintyProtection:
        clampFiniteV3(
          decision
            .uncertaintyProtection,
          0,
          1,
          defaults
            .decision
            .uncertaintyProtection
        ),
    },

    runtime: {
      passes:
        clampIntegerV3(
          runtime.passes,
          1,
          3,
          defaults
            .runtime
            .passes
        ),

      rebuildCandidatesBetweenPasses:
        Boolean(
          runtime
            .rebuildCandidatesBetweenPasses
        ),

      minimumAverageChangeForNextPass:
        clampFiniteV3(
          runtime
            .minimumAverageChangeForNextPass,
          0,
          1,
          defaults
            .runtime
            .minimumAverageChangeForNextPass
        ),

      cancellationCheckInterval:
        clampIntegerV3(
          runtime
            .cancellationCheckInterval,
          256,
          1_048_576,
          defaults
            .runtime
            .cancellationCheckInterval
        ),

      collectDiagnostics:
        Boolean(
          runtime
            .collectDiagnostics
        ),

      maximumWarnings:
        clampIntegerV3(
          runtime
            .maximumWarnings,
          0,
          500,
          defaults
            .runtime
            .maximumWarnings
        ),
    },
  };
}

/* =========================================================
 * Validation
 * ======================================================= */

function assertSafeDimensionsV3(
  width:
    number,
  height:
    number,
  requestId:
    string | undefined
): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 received invalid dimensions.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,

        metadata: {
          width:
            Number.isFinite(width)
              ? width
              : -1,

          height:
            Number.isFinite(height)
              ? height
              : -1,
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
    pixelCount <= 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 could not calculate a safe pixel count.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  if (
    pixelCount >
    SUB_PIXEL_MAXIMUM_SAFE_PIXELS_V3
  ) {
    throw new SegmentationError(
      'OUT_OF_MEMORY',
      'BoundarySubPixelRefinerV3 input exceeds the safe pixel limit.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,

        metadata: {
          width,
          height,
          pixelCount,

          maximumSafePixels:
            SUB_PIXEL_MAXIMUM_SAFE_PIXELS_V3,
        },
      }
    );
  }

  return pixelCount;
}

function assertValidAnalysisImageV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  requestId:
    string | undefined
): number {
  if (
    typeof image !==
      'object' ||
    image === null
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 requires an analysis image.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  const pixelCount =
    assertSafeDimensionsV3(
      image.width,
      image.height,
      requestId
    );

  if (
    !(image.rgb instanceof
      Float32Array) ||
    image.rgb.length !==
      pixelCount *
        3
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 received invalid RGB data.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,

        metadata: {
          expectedLength:
            pixelCount *
            3,

          actualLength:
            image.rgb instanceof
              Float32Array
              ? image.rgb.length
              : -1,
        },
      }
    );
  }

  if (
    !(image.gradient instanceof
      Float32Array) ||
    image.gradient.length !==
      pixelCount
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 received invalid gradient data.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  if (
    image.gradientDirection !==
      null &&
    (
      !(image.gradientDirection instanceof
        Float32Array) ||
      image.gradientDirection.length !==
        pixelCount
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 received invalid gradient-direction data.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  if (
    !(image.luminance instanceof
      Float32Array) ||
    image.luminance.length !==
      pixelCount
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 received invalid luminance data.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  return pixelCount;
}

function assertValidMaskV3(
  mask:
    SegmentationFloatMask,
  image:
    BoundarySubPixelAnalysisImageV3,
  requestId:
    string | undefined
): void {
  if (!isValidFloatMask(mask)) {
    throw new SegmentationError(
      'MASK_INVALID',
      'BoundarySubPixelRefinerV3 received an invalid float mask.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  if (
    mask.width !==
      image.width ||
    mask.height !==
      image.height
  ) {
    throw new SegmentationError(
      'MASK_INVALID',
      'BoundarySubPixelRefinerV3 requires matching image and mask dimensions.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,

        metadata: {
          imageWidth:
            image.width,

          imageHeight:
            image.height,

          maskWidth:
            mask.width,

          maskHeight:
            mask.height,
        },
      }
    );
  }
}

/* =========================================================
 * Coordinate utilities
 * ======================================================= */

function isInsideImageV3(
  x:
    number,
  y:
    number,
  width:
    number,
  height:
    number
): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x <=
      width - 1 &&
    y <=
      height - 1
  );
}

function clampImageXV3(
  x:
    number,
  width:
    number
): number {
  return clampSegmentationValue(
    x,
    0,
    Math.max(
      0,
      width - 1
    )
  );
}

function clampImageYV3(
  y:
    number,
  height:
    number
): number {
  return clampSegmentationValue(
    y,
    0,
    Math.max(
      0,
      height - 1
    )
  );
}

function pixelIndexV3(
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

function rgbIndexV3(
  pixelIndex:
    number
): number {
  return (
    pixelIndex *
    3
  );
}

/* =========================================================
 * Scalar sampling
 * ======================================================= */

function sampleScalarNearestV3(
  data:
    Float32Array,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number,
  rejectOutOfBounds:
    boolean
): {
  value:
    number;

  valid:
    boolean;
} {
  if (
    rejectOutOfBounds &&
    !isInsideImageV3(
      x,
      y,
      width,
      height
    )
  ) {
    return {
      value:
        0,

      valid:
        false,
    };
  }

  const sampleX =
    Math.round(
      clampImageXV3(
        x,
        width
      )
    );

  const sampleY =
    Math.round(
      clampImageYV3(
        y,
        height
      )
    );

  return {
    value:
      finiteOrV3(
        data[
          pixelIndexV3(
            sampleX,
            sampleY,
            width
          )
        ],
        0
      ),

    valid:
      true,
  };
}

function sampleScalarBilinearV3(
  data:
    Float32Array,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number,
  rejectOutOfBounds:
    boolean
): {
  value:
    number;

  valid:
    boolean;
} {
  if (
    rejectOutOfBounds &&
    !isInsideImageV3(
      x,
      y,
      width,
      height
    )
  ) {
    return {
      value:
        0,

      valid:
        false,
    };
  }

  const safeX =
    clampImageXV3(
      x,
      width
    );

  const safeY =
    clampImageYV3(
      y,
      height
    );

  const x0 =
    Math.floor(
      safeX
    );

  const y0 =
    Math.floor(
      safeY
    );

  const x1 =
    Math.min(
      width - 1,
      x0 + 1
    );

  const y1 =
    Math.min(
      height - 1,
      y0 + 1
    );

  const tx =
    safeX -
    x0;

  const ty =
    safeY -
    y0;

  const topLeft =
    finiteOrV3(
      data[
        pixelIndexV3(
          x0,
          y0,
          width
        )
      ],
      0
    );

  const topRight =
    finiteOrV3(
      data[
        pixelIndexV3(
          x1,
          y0,
          width
        )
      ],
      topLeft
    );

  const bottomLeft =
    finiteOrV3(
      data[
        pixelIndexV3(
          x0,
          y1,
          width
        )
      ],
      topLeft
    );

  const bottomRight =
    finiteOrV3(
      data[
        pixelIndexV3(
          x1,
          y1,
          width
        )
      ],
      topLeft
    );

  const top =
    lerpV3(
      topLeft,
      topRight,
      tx
    );

  const bottom =
    lerpV3(
      bottomLeft,
      bottomRight,
      tx
    );

  return {
    value:
      lerpV3(
        top,
        bottom,
        ty
      ),

    valid:
      true,
  };
}

function sampleScalarV3(
  data:
    Float32Array,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number,
  bilinear:
    boolean,
  rejectOutOfBounds:
    boolean
): {
  value:
    number;

  valid:
    boolean;
} {
  return bilinear
    ? sampleScalarBilinearV3(
        data,
        width,
        height,
        x,
        y,
        rejectOutOfBounds
      )
    : sampleScalarNearestV3(
        data,
        width,
        height,
        x,
        y,
        rejectOutOfBounds
      );
}

/* =========================================================
 * RGB sampling
 * ======================================================= */

function readRgbPixelV3(
  rgb:
    Float32Array,
  width:
    number,
  x:
    number,
  y:
    number
): BoundarySubPixelRgbV3 {
  const index =
    rgbIndexV3(
      pixelIndexV3(
        x,
        y,
        width
      )
    );

  return {
    red:
      clampUnitValue(
        finiteOrV3(
          rgb[index],
          0
        )
      ),

    green:
      clampUnitValue(
        finiteOrV3(
          rgb[
            index + 1
          ],
          0
        )
      ),

    blue:
      clampUnitValue(
        finiteOrV3(
          rgb[
            index + 2
          ],
          0
        )
      ),
  };
}

function sampleRgbNearestV3(
  rgb:
    Float32Array,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number,
  rejectOutOfBounds:
    boolean
): {
  value:
    BoundarySubPixelRgbV3;

  valid:
    boolean;
} {
  if (
    rejectOutOfBounds &&
    !isInsideImageV3(
      x,
      y,
      width,
      height
    )
  ) {
    return {
      value: {
        red: 0,
        green: 0,
        blue: 0,
      },

      valid:
        false,
    };
  }

  const sampleX =
    Math.round(
      clampImageXV3(
        x,
        width
      )
    );

  const sampleY =
    Math.round(
      clampImageYV3(
        y,
        height
      )
    );

  return {
    value:
      readRgbPixelV3(
        rgb,
        width,
        sampleX,
        sampleY
      ),

    valid:
      true,
  };
}

function sampleRgbBilinearV3(
  rgb:
    Float32Array,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number,
  rejectOutOfBounds:
    boolean
): {
  value:
    BoundarySubPixelRgbV3;

  valid:
    boolean;
} {
  if (
    rejectOutOfBounds &&
    !isInsideImageV3(
      x,
      y,
      width,
      height
    )
  ) {
    return {
      value: {
        red: 0,
        green: 0,
        blue: 0,
      },

      valid:
        false,
    };
  }

  const safeX =
    clampImageXV3(
      x,
      width
    );

  const safeY =
    clampImageYV3(
      y,
      height
    );

  const x0 =
    Math.floor(
      safeX
    );

  const y0 =
    Math.floor(
      safeY
    );

  const x1 =
    Math.min(
      width - 1,
      x0 + 1
    );

  const y1 =
    Math.min(
      height - 1,
      y0 + 1
    );

  const tx =
    safeX -
    x0;

  const ty =
    safeY -
    y0;

  const topLeft =
    readRgbPixelV3(
      rgb,
      width,
      x0,
      y0
    );

  const topRight =
    readRgbPixelV3(
      rgb,
      width,
      x1,
      y0
    );

  const bottomLeft =
    readRgbPixelV3(
      rgb,
      width,
      x0,
      y1
    );

  const bottomRight =
    readRgbPixelV3(
      rgb,
      width,
      x1,
      y1
    );

  return {
    value: {
      red:
        clampUnitValue(
          lerpV3(
            lerpV3(
              topLeft.red,
              topRight.red,
              tx
            ),
            lerpV3(
              bottomLeft.red,
              bottomRight.red,
              tx
            ),
            ty
          )
        ),

      green:
        clampUnitValue(
          lerpV3(
            lerpV3(
              topLeft.green,
              topRight.green,
              tx
            ),
            lerpV3(
              bottomLeft.green,
              bottomRight.green,
              tx
            ),
            ty
          )
        ),

      blue:
        clampUnitValue(
          lerpV3(
            lerpV3(
              topLeft.blue,
              topRight.blue,
              tx
            ),
            lerpV3(
              bottomLeft.blue,
              bottomRight.blue,
              tx
            ),
            ty
          )
        ),
    },

    valid:
      true,
  };
}

function sampleRgbV3(
  rgb:
    Float32Array,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number,
  bilinear:
    boolean,
  rejectOutOfBounds:
    boolean
): {
  value:
    BoundarySubPixelRgbV3;

  valid:
    boolean;
} {
  return bilinear
    ? sampleRgbBilinearV3(
        rgb,
        width,
        height,
        x,
        y,
        rejectOutOfBounds
      )
    : sampleRgbNearestV3(
        rgb,
        width,
        height,
        x,
        y,
        rejectOutOfBounds
      );
}

/* =========================================================
 * Sample creation
 * ======================================================= */

function createInvalidSampleV3(
  x:
    number,
  y:
    number
): BoundarySubPixelSampleV3 {
  return {
    x,
    y,

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

    maskValue:
      0,

    weight:
      0,

    valid:
      false,
  };
}

function sampleAnalysisPointV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  weight:
    number,
  config:
    BoundarySubPixelSamplingConfigV3
): BoundarySubPixelSampleV3 {
  const rgb =
    sampleRgbV3(
      image.rgb,
      image.width,
      image.height,
      x,
      y,
      config.bilinear,
      config.rejectOutOfBounds
    );

  if (!rgb.valid) {
    return createInvalidSampleV3(
      x,
      y
    );
  }

  const maskSample =
    sampleScalarV3(
      mask.data,
      mask.width,
      mask.height,
      x,
      y,
      config.bilinear,
      config.rejectOutOfBounds
    );

  const gradientSample =
    sampleScalarV3(
      image.gradient,
      image.width,
      image.height,
      x,
      y,
      config.bilinear,
      config.rejectOutOfBounds
    );

  const luminanceSample =
    sampleScalarV3(
      image.luminance,
      image.width,
      image.height,
      x,
      y,
      config.bilinear,
      config.rejectOutOfBounds
    );

  if (
    !maskSample.valid ||
    !gradientSample.valid ||
    !luminanceSample.valid
  ) {
    return createInvalidSampleV3(
      x,
      y
    );
  }

  const red =
    rgb.value.red;

  const green =
    rgb.value.green;

  const blue =
    rgb.value.blue;

  const storedLuminance =
    luminanceSample.value;

  return {
    x,
    y,

    red,
    green,
    blue,

    luminance:
      Number.isFinite(
        storedLuminance
      )
        ? clampUnitValue(
            storedLuminance
          )
        : calculateLuminanceV3(
            red,
            green,
            blue
          ),

    saturation:
      calculateSaturationV3(
        red,
        green,
        blue
      ),

    gradient:
      clampUnitValue(
        gradientSample.value
      ),

    maskValue:
      clampUnitValue(
        maskSample.value
      ),

    weight:
      Math.max(
        0,
        finiteOrV3(
          weight,
          0
        )
      ),

    valid:
      true,
  };
}

function aggregateSamplesV3(
  samples:
    readonly BoundarySubPixelSampleV3[]
): BoundarySubPixelWeightedSampleV3 {
  let red =
    0;

  let green =
    0;

  let blue =
    0;

  let luminance =
    0;

  let saturation =
    0;

  let gradient =
    0;

  let maskValue =
    0;

  let totalWeight =
    0;

  let sampleCount =
    0;

  for (
    const sample of samples
  ) {
    if (
      !sample.valid ||
      sample.weight <= 0
    ) {
      continue;
    }

    const weight =
      sample.weight;

    red +=
      sample.red *
      weight;

    green +=
      sample.green *
      weight;

    blue +=
      sample.blue *
      weight;

    luminance +=
      sample.luminance *
      weight;

    saturation +=
      sample.saturation *
      weight;

    gradient +=
      sample.gradient *
      weight;

    maskValue +=
      sample.maskValue *
      weight;

    totalWeight +=
      weight;

    sampleCount +=
      1;
  }

  if (
    totalWeight <=
    SUB_PIXEL_EPSILON_V3
  ) {
    return {
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

      maskValue:
        0,

      totalWeight:
        0,

      sampleCount:
        0,

      valid:
        false,
    };
  }

  const inverseWeight =
    1 /
    totalWeight;

  return {
    red:
      clampUnitValue(
        red *
        inverseWeight
      ),

    green:
      clampUnitValue(
        green *
        inverseWeight
      ),

    blue:
      clampUnitValue(
        blue *
        inverseWeight
      ),

    luminance:
      clampUnitValue(
        luminance *
        inverseWeight
      ),

    saturation:
      clampUnitValue(
        saturation *
        inverseWeight
      ),

    gradient:
      clampUnitValue(
        gradient *
        inverseWeight
      ),

    maskValue:
      clampUnitValue(
        maskValue *
        inverseWeight
      ),

    totalWeight,

    sampleCount,

    valid:
      true,
  };
}

/* =========================================================
 * Warning helper
 * ======================================================= */

function pushWarningV3(
  warnings:
    string[],
  warning:
    string,
  maximumWarnings:
    number
): void {
  if (
    maximumWarnings <= 0 ||
    warnings.length >=
      maximumWarnings
  ) {
    return;
  }

  const normalized =
    warning.trim();

  if (
    normalized.length === 0 ||
    warnings.includes(
      normalized
    )
  ) {
    return;
  }

  warnings.push(
    normalized
  );
}

/* =========================================================
 * Diagnostics helpers
 * ======================================================= */

function createPassDiagnosticsV3(
  pass:
    number
): BoundarySubPixelPassDiagnosticsV3 {
  return {
    pass,

    candidateCount:
      0,

    analyzedCount:
      0,

    rejectedCount:
      0,

    removedLeakPixels:
      0,

    recoveredForegroundPixels:
      0,

    softenedPixels:
      0,

    preservedPixels:
      0,

    unchangedPixels:
      0,

    protectedThinPixels:
      0,

    protectedCornerPixels:
      0,

    protectedTexturePixels:
      0,

    totalAlphaReduction:
      0,

    totalAlphaIncrease:
      0,

    averageAbsoluteChange:
      0,

    maximumAbsoluteChange:
      0,

    durationMs:
      0,
  };
}

function createDiagnosticsV3(
  width:
    number,
  height:
    number,
  enabled:
    boolean
): BoundarySubPixelDiagnosticsV3 {
  return {
    enabled,

    applied:
      false,

    width,

    height,

    totalPixels:
      width *
      height,

    totalCandidates:
      0,

    totalAnalyzed:
      0,

    totalRejected:
      0,

    totalRemovedLeakPixels:
      0,

    totalRecoveredForegroundPixels:
      0,

    totalSoftenedPixels:
      0,

    totalPreservedPixels:
      0,

    totalUnchangedPixels:
      0,

    totalProtectedThinPixels:
      0,

    totalProtectedCornerPixels:
      0,

    totalProtectedTexturePixels:
      0,

    totalAlphaReduction:
      0,

    totalAlphaIncrease:
      0,

    averageAbsoluteChange:
      0,

    maximumAbsoluteChange:
      0,

    passesCompleted:
      0,

    passes:
      [],

    warnings:
      [],

    durationMs:
      0,
  };
}

/* =========================================================
 * Request preparation
 * ======================================================= */

function prepareBoundarySubPixelRequestV3(
  request:
    BoundarySubPixelRefinerRequestV3
): {
  pixelCount:
    number;

  config:
    BoundarySubPixelRefinerConfigV3;

  workingMask:
    SegmentationFloatMask;
} {
  if (
    typeof request !==
      'object' ||
    request === null
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'BoundarySubPixelRefinerV3 requires a valid request.',
      {
        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  assertNotCancelledV3(
    request
      .cancellationSignal
  );

  const pixelCount =
    assertValidAnalysisImageV3(
      request.image,
      request.requestId
    );

  assertValidMaskV3(
    request.mask,
    request.image,
    request.requestId
  );

  const config =
    normalizeBoundarySubPixelRefinerConfigV3(
      request.config
    );

  return {
    pixelCount,

    config,

    workingMask:
      cloneFloatMask(
        request.mask
      ),
  };
}

/* =========================================================
 * Part 1 internal references
 * ======================================================= */

/**
 * سيتم استخدام هذه الأدوات في الأجزاء التالية.
 * هذا المرجع يمنع تحذيرات noUnusedLocals أثناء
 * لصق الملف على أجزاء.
 */
const BOUNDARY_SUB_PIXEL_PART_1_INTERNALS_V3 = {
  safeDivideV3,
  smoothStepV3,

  createVectorV3,
  normalizeVectorV3,
  negateVectorV3,
  scaleVectorV3,
  addVectorsV3,
  dotVectorsV3,
  vectorAgreementV3,
  perpendicularVectorV3,
  vectorFromAngleV3,
  normalizeAngleV3,
  fuseVectorsV3,

  assertNotCancelledV3,
  shouldCheckCancellationV3,

  sampleScalarV3,
  sampleRgbV3,
  sampleAnalysisPointV3,
  aggregateSamplesV3,

  pushWarningV3,

  createPassDiagnosticsV3,
  createDiagnosticsV3,

  prepareBoundarySubPixelRequestV3,
};

void BOUNDARY_SUB_PIXEL_PART_1_INTERNALS_V3;

// End of Part 1/4
// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 2/4
//
// يكمل مباشرة بعد:
//
// // End of Part 1/4
//
// هذا الجزء مسؤول عن:
//
// 1) قياس تغير Alpha محليًا.
// 2) اكتشاف Boundary Candidates.
// 3) حساب Gradient الماسك.
// 4) قراءة اتجاه Gradient الصورة.
// 5) توحيد اتجاه الـNormal ليشير من الداخل للخارج.
// 6) دمج اتجاه الصورة والماسك.
// 7) تقدير مسافة البكسل من الحافة.
// 8) ترتيب وتقليل عدد الـCandidates بأمان.

/* =========================================================
 * Local alpha analysis
 * ======================================================= */

type BoundarySubPixelLocalAlphaRangeV3 = {
  minimum:
    number;

  maximum:
    number;

  range:
    number;

  average:
    number;

  foregroundNeighborCount:
    number;

  backgroundNeighborCount:
    number;

  softNeighborCount:
    number;

  sampleCount:
    number;
};

function createEmptyLocalAlphaRangeV3():
  BoundarySubPixelLocalAlphaRangeV3 {
  return {
    minimum:
      1,

    maximum:
      0,

    range:
      0,

    average:
      0,

    foregroundNeighborCount:
      0,

    backgroundNeighborCount:
      0,

    softNeighborCount:
      0,

    sampleCount:
      0,
  };
}

function analyzeLocalAlphaRangeV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  radius:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): BoundarySubPixelLocalAlphaRangeV3 {
  const safeRadius =
    Math.max(
      1,
      Math.floor(radius)
    );

  const result =
    createEmptyLocalAlphaRangeV3();

  let sum =
    0;

  for (
    let offsetY =
      -safeRadius;
    offsetY <=
      safeRadius;
    offsetY +=
      1
  ) {
    const sampleY =
      y +
      offsetY;

    if (
      sampleY < 0 ||
      sampleY >=
        mask.height
    ) {
      continue;
    }

    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      const sampleX =
        x +
        offsetX;

      if (
        sampleX < 0 ||
        sampleX >=
          mask.width
      ) {
        continue;
      }

      const value =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              pixelIndexV3(
                sampleX,
                sampleY,
                mask.width
              )
            ],
            0
          )
        );

      result.minimum =
        Math.min(
          result.minimum,
          value
        );

      result.maximum =
        Math.max(
          result.maximum,
          value
        );

      sum +=
        value;

      result.sampleCount +=
        1;

      if (
        value >=
        config
          .strongForegroundThreshold
      ) {
        result
          .foregroundNeighborCount +=
          1;
      } else if (
        value <=
        config
          .strongBackgroundThreshold
      ) {
        result
          .backgroundNeighborCount +=
          1;
      } else {
        result
          .softNeighborCount +=
          1;
      }
    }
  }

  if (
    result.sampleCount <= 0
  ) {
    result.minimum =
      0;

    result.maximum =
      0;

    result.average =
      0;

    result.range =
      0;

    return result;
  }

  result.average =
    clampUnitValue(
      sum /
      result.sampleCount
    );

  result.range =
    clampUnitValue(
      result.maximum -
      result.minimum
    );

  return result;
}

/* =========================================================
 * Binary neighborhood helpers
 * ======================================================= */

function isStrongForegroundAlphaV3(
  value:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): boolean {
  return (
    value >=
    config
      .strongForegroundThreshold
  );
}

function isStrongBackgroundAlphaV3(
  value:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): boolean {
  return (
    value <=
    config
      .strongBackgroundThreshold
  );
}

function isSoftBoundaryAlphaV3(
  value:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): boolean {
  return (
    value >
      config
        .strongBackgroundThreshold &&
    value <
      config
        .strongForegroundThreshold
  );
}

function countForegroundNeighborsV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  radius:
    number,
  threshold:
    number
): {
  foreground:
    number;

  background:
    number;

  total:
    number;

  ratio:
    number;
} {
  const safeRadius =
    Math.max(
      1,
      Math.floor(radius)
    );

  let foreground =
    0;

  let background =
    0;

  let total =
    0;

  for (
    let offsetY =
      -safeRadius;
    offsetY <=
      safeRadius;
    offsetY +=
      1
  ) {
    const sampleY =
      y +
      offsetY;

    if (
      sampleY < 0 ||
      sampleY >=
        mask.height
    ) {
      continue;
    }

    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      if (
        offsetX === 0 &&
        offsetY === 0
      ) {
        continue;
      }

      const sampleX =
        x +
        offsetX;

      if (
        sampleX < 0 ||
        sampleX >=
          mask.width
      ) {
        continue;
      }

      const value =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              pixelIndexV3(
                sampleX,
                sampleY,
                mask.width
              )
            ],
            0
          )
        );

      if (
        value >=
        threshold
      ) {
        foreground +=
          1;
      } else {
        background +=
          1;
      }

      total +=
        1;
    }
  }

  return {
    foreground,

    background,

    total,

    ratio:
      total > 0
        ? foreground /
          total
        : 0,
  };
}

function hasStrongForegroundNeighborV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  radius:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
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
    const sampleY =
      y +
      offsetY;

    if (
      sampleY < 0 ||
      sampleY >=
        mask.height
    ) {
      continue;
    }

    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      if (
        offsetX === 0 &&
        offsetY === 0
      ) {
        continue;
      }

      const sampleX =
        x +
        offsetX;

      if (
        sampleX < 0 ||
        sampleX >=
          mask.width
      ) {
        continue;
      }

      const value =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              pixelIndexV3(
                sampleX,
                sampleY,
                mask.width
              )
            ],
            0
          )
        );

      if (
        isStrongForegroundAlphaV3(
          value,
          config
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasStrongBackgroundNeighborV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  radius:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
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
    const sampleY =
      y +
      offsetY;

    if (
      sampleY < 0 ||
      sampleY >=
        mask.height
    ) {
      return true;
    }

    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      if (
        offsetX === 0 &&
        offsetY === 0
      ) {
        continue;
      }

      const sampleX =
        x +
        offsetX;

      if (
        sampleX < 0 ||
        sampleX >=
          mask.width
      ) {
        return true;
      }

      const value =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              pixelIndexV3(
                sampleX,
                sampleY,
                mask.width
              )
            ],
            0
          )
        );

      if (
        isStrongBackgroundAlphaV3(
          value,
          config
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/* =========================================================
 * Boundary distance estimation
 * ======================================================= */

function estimateDistanceToStrongBackgroundV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  maximumDistance:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): number {
  const safeMaximumDistance =
    Math.max(
      1,
      Math.floor(
        maximumDistance
      )
    );

  for (
    let radius =
      1;
    radius <=
      safeMaximumDistance;
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
            Math.abs(offsetX),
            Math.abs(offsetY)
          ) !==
          radius
        ) {
          continue;
        }

        const sampleX =
          x +
          offsetX;

        const sampleY =
          y +
          offsetY;

        if (
          sampleX < 0 ||
          sampleY < 0 ||
          sampleX >=
            mask.width ||
          sampleY >=
            mask.height
        ) {
          return radius;
        }

        const value =
          clampUnitValue(
            finiteOrV3(
              mask.data[
                pixelIndexV3(
                  sampleX,
                  sampleY,
                  mask.width
                )
              ],
              0
            )
          );

        if (
          isStrongBackgroundAlphaV3(
            value,
            config
          )
        ) {
          return radius;
        }
      }
    }
  }

  return (
    safeMaximumDistance +
    1
  );
}

function estimateDistanceToStrongForegroundV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  maximumDistance:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): number {
  const safeMaximumDistance =
    Math.max(
      1,
      Math.floor(
        maximumDistance
      )
    );

  for (
    let radius =
      1;
    radius <=
      safeMaximumDistance;
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
            Math.abs(offsetX),
            Math.abs(offsetY)
          ) !==
          radius
        ) {
          continue;
        }

        const sampleX =
          x +
          offsetX;

        const sampleY =
          y +
          offsetY;

        if (
          sampleX < 0 ||
          sampleY < 0 ||
          sampleX >=
            mask.width ||
          sampleY >=
            mask.height
        ) {
          continue;
        }

        const value =
          clampUnitValue(
            finiteOrV3(
              mask.data[
                pixelIndexV3(
                  sampleX,
                  sampleY,
                  mask.width
                )
              ],
              0
            )
          );

        if (
          isStrongForegroundAlphaV3(
            value,
            config
          )
        ) {
          return radius;
        }
      }
    }
  }

  return (
    safeMaximumDistance +
    1
  );
}

/* =========================================================
 * Mask gradient
 * ======================================================= */

type BoundarySubPixelMaskGradientV3 = {
  vector:
    BoundarySubPixelVectorV3;

  magnitude:
    number;

  valid:
    boolean;
};

function sampleMaskClampedV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number
): number {
  const sampleX =
    Math.max(
      0,
      Math.min(
        mask.width - 1,
        Math.round(x)
      )
    );

  const sampleY =
    Math.max(
      0,
      Math.min(
        mask.height - 1,
        Math.round(y)
      )
    );

  return clampUnitValue(
    finiteOrV3(
      mask.data[
        pixelIndexV3(
          sampleX,
          sampleY,
          mask.width
        )
      ],
      0
    )
  );
}

function calculateMaskGradientV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  config:
    BoundarySubPixelDirectionConfigV3
): BoundarySubPixelMaskGradientV3 {
  const radius =
    Math.max(
      1,
      Math.floor(
        config.maskGradientRadius
      )
    );

  const left =
    sampleMaskClampedV3(
      mask,
      x - radius,
      y
    );

  const right =
    sampleMaskClampedV3(
      mask,
      x + radius,
      y
    );

  const top =
    sampleMaskClampedV3(
      mask,
      x,
      y - radius
    );

  const bottom =
    sampleMaskClampedV3(
      mask,
      x,
      y + radius
    );

  const topLeft =
    sampleMaskClampedV3(
      mask,
      x - radius,
      y - radius
    );

  const topRight =
    sampleMaskClampedV3(
      mask,
      x + radius,
      y - radius
    );

  const bottomLeft =
    sampleMaskClampedV3(
      mask,
      x - radius,
      y + radius
    );

  const bottomRight =
    sampleMaskClampedV3(
      mask,
      x + radius,
      y + radius
    );

  const gradientX =
    (
      right -
      left
    ) *
      0.5 +
    (
      topRight +
      bottomRight -
      topLeft -
      bottomLeft
    ) *
      0.125;

  const gradientY =
    (
      bottom -
      top
    ) *
      0.5 +
    (
      bottomLeft +
      bottomRight -
      topLeft -
      topRight
    ) *
      0.125;

  const vector =
    createVectorV3(
      gradientX,
      gradientY
    );

  const magnitude =
    vectorLengthV3(
      vector
    );

  return {
    vector:
      magnitude >
      SUB_PIXEL_EPSILON_V3
        ? normalizeVectorV3(
            vector
          )
        : {
            x: 0,
            y: 0,
          },

    magnitude,

    valid:
      magnitude >=
      config
        .minimumMaskGradient,
  };
}

/* =========================================================
 * Image gradient direction
 * ======================================================= */

type BoundarySubPixelImageGradientV3 = {
  vector:
    BoundarySubPixelVectorV3;

  magnitude:
    number;

  angle:
    number;

  valid:
    boolean;
};

function readImageGradientDirectionV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  x:
    number,
  y:
    number,
  config:
    BoundarySubPixelDirectionConfigV3
): BoundarySubPixelImageGradientV3 {
  if (
    !config.useImageGradient ||
    image.gradientDirection ===
      null
  ) {
    return {
      vector: {
        x: 0,
        y: 0,
      },

      magnitude:
        0,

      angle:
        0,

      valid:
        false,
    };
  }

  const index =
    pixelIndexV3(
      x,
      y,
      image.width
    );

  const magnitude =
    clampUnitValue(
      finiteOrV3(
        image.gradient[index],
        0
      )
    );

  const angle =
    normalizeAngleV3(
      finiteOrV3(
        image
          .gradientDirection[
            index
          ],
        0
      )
    );

  if (
    magnitude <
    config.minimumImageGradient
  ) {
    return {
      vector: {
        x: 0,
        y: 0,
      },

      magnitude,

      angle,

      valid:
        false,
    };
  }

  return {
    vector:
      normalizeVectorV3(
        vectorFromAngleV3(
          angle
        )
      ),

    magnitude,

    angle,

    valid:
      true,
  };
}

/* =========================================================
 * Normal orientation
 * ======================================================= */

/**
 * Gradient الماسك الناتج من Alpha عادةً يشير
 * نحو زيادة Alpha، أي غالبًا من الخلفية للداخل.
 *
 * نحن نريد Normal يشير دائمًا:
 *
 * Foreground -> Background
 *
 * لذلك نقلب اتجاه Mask Gradient.
 */
function orientMaskNormalOutsideV3(
  maskGradient:
    BoundarySubPixelMaskGradientV3
): BoundarySubPixelVectorV3 | null {
  if (!maskGradient.valid) {
    return null;
  }

  return normalizeVectorV3(
    negateVectorV3(
      maskGradient.vector
    )
  );
}

function scoreNormalOrientationV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  normal:
    BoundarySubPixelVectorV3,
  distance:
    number
): number {
  const safeDistance =
    Math.max(
      0.5,
      finiteOrV3(
        distance,
        1
      )
    );

  const forward =
    sampleScalarV3(
      mask.data,
      mask.width,
      mask.height,
      x +
        normal.x *
        safeDistance,
      y +
        normal.y *
        safeDistance,
      true,
      false
    );

  const backward =
    sampleScalarV3(
      mask.data,
      mask.width,
      mask.height,
      x -
        normal.x *
        safeDistance,
      y -
        normal.y *
        safeDistance,
      true,
      false
    );

  if (
    !forward.valid ||
    !backward.valid
  ) {
    return 0;
  }

  /**
   * الاتجاه الصحيح للخارج يجب أن تكون
   * قيمة Alpha أمامه أقل من الخلف.
   */
  return (
    clampUnitValue(
      backward.value
    ) -
    clampUnitValue(
      forward.value
    )
  );
}

function orientNormalUsingMaskV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  normal:
    BoundarySubPixelVectorV3
): {
  normal:
    BoundarySubPixelVectorV3;

  orientationConfidence:
    number;
} {
  const normalized =
    normalizeVectorV3(
      normal
    );

  const score =
    scoreNormalOrientationV3(
      mask,
      x,
      y,
      normalized,
      1.25
    );

  if (score >= 0) {
    return {
      normal:
        normalized,

      orientationConfidence:
        clampUnitValue(
          Math.abs(score)
        ),
    };
  }

  return {
    normal:
      negateVectorV3(
        normalized
      ),

    orientationConfidence:
      clampUnitValue(
        Math.abs(score)
      ),
  };
}

/* =========================================================
 * Fallback boundary direction
 * ======================================================= */

function calculateFallbackBoundaryNormalV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): BoundarySubPixelVectorV3 {
  let backgroundVectorX =
    0;

  let backgroundVectorY =
    0;

  let foregroundVectorX =
    0;

  let foregroundVectorY =
    0;

  const radius =
    Math.max(
      1,
      config.boundaryRadius
    );

  for (
    let offsetY =
      -radius;
    offsetY <=
      radius;
    offsetY +=
      1
  ) {
    const sampleY =
      y +
      offsetY;

    if (
      sampleY < 0 ||
      sampleY >=
        mask.height
    ) {
      backgroundVectorX +=
        offsetXSignFallbackV3(
          0
        );

      backgroundVectorY +=
        offsetY === 0
          ? 0
          : Math.sign(
              offsetY
            );

      continue;
    }

    for (
      let offsetX =
        -radius;
      offsetX <=
        radius;
      offsetX +=
        1
    ) {
      if (
        offsetX === 0 &&
        offsetY === 0
      ) {
        continue;
      }

      const sampleX =
        x +
        offsetX;

      const distanceSquared =
        offsetX *
          offsetX +
        offsetY *
          offsetY;

      if (
        distanceSquared >
        radius *
          radius
      ) {
        continue;
      }

      const distance =
        Math.sqrt(
          Math.max(
            1,
            distanceSquared
          )
        );

      const weight =
        1 /
        distance;

      if (
        sampleX < 0 ||
        sampleX >=
          mask.width
      ) {
        backgroundVectorX +=
          offsetX *
          weight;

        backgroundVectorY +=
          offsetY *
          weight;

        continue;
      }

      const value =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              pixelIndexV3(
                sampleX,
                sampleY,
                mask.width
              )
            ],
            0
          )
        );

      if (
        isStrongBackgroundAlphaV3(
          value,
          config
        )
      ) {
        backgroundVectorX +=
          offsetX *
          weight;

        backgroundVectorY +=
          offsetY *
          weight;
      } else if (
        isStrongForegroundAlphaV3(
          value,
          config
        )
      ) {
        foregroundVectorX +=
          offsetX *
          weight;

        foregroundVectorY +=
          offsetY *
          weight;
      }
    }
  }

  const backgroundVector =
    createVectorV3(
      backgroundVectorX,
      backgroundVectorY
    );

  if (
    vectorLengthV3(
      backgroundVector
    ) >
    SUB_PIXEL_EPSILON_V3
  ) {
    return normalizeVectorV3(
      backgroundVector
    );
  }

  const oppositeForeground =
    negateVectorV3(
      createVectorV3(
        foregroundVectorX,
        foregroundVectorY
      )
    );

  if (
    vectorLengthV3(
      oppositeForeground
    ) >
    SUB_PIXEL_EPSILON_V3
  ) {
    return normalizeVectorV3(
      oppositeForeground
    );
  }

  /**
   * آخر حل احتياطي:
   * الاتجاه نحو أقرب حافة للصورة.
   */
  const distanceLeft =
    x;

  const distanceRight =
    mask.width -
    1 -
    x;

  const distanceTop =
    y;

  const distanceBottom =
    mask.height -
    1 -
    y;

  const minimumDistance =
    Math.min(
      distanceLeft,
      distanceRight,
      distanceTop,
      distanceBottom
    );

  if (
    minimumDistance ===
    distanceLeft
  ) {
    return {
      x: -1,
      y: 0,
    };
  }

  if (
    minimumDistance ===
    distanceRight
  ) {
    return {
      x: 1,
      y: 0,
    };
  }

  if (
    minimumDistance ===
    distanceTop
  ) {
    return {
      x: 0,
      y: -1,
    };
  }

  return {
    x: 0,
    y: 1,
  };
}

/**
 * أداة صغيرة لتجنب استخدام متغير غير موجود
 * عند فحص حدود الصف في fallback.
 */
function offsetXSignFallbackV3(
  value:
    number
): number {
  if (value > 0) {
    return 1;
  }

  if (value < 0) {
    return -1;
  }

  return 0;
}

/* =========================================================
 * Direction fusion
 * ======================================================= */

function calculateBoundaryDirectionV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  detectionConfig:
    BoundarySubPixelDetectionConfigV3,
  directionConfig:
    BoundarySubPixelDirectionConfigV3
): BoundarySubPixelDirectionV3 {
  const imageGradient =
    readImageGradientDirectionV3(
      image,
      x,
      y,
      directionConfig
    );

  const maskGradient =
    directionConfig.useMaskGradient
      ? calculateMaskGradientV3(
          mask,
          x,
          y,
          directionConfig
        )
      : {
          vector: {
            x: 0,
            y: 0,
          },

          magnitude:
            0,

          valid:
            false,
        };

  const rawMaskNormal =
    orientMaskNormalOutsideV3(
      maskGradient
    );

  const maskNormal =
    rawMaskNormal
      ? orientNormalUsingMaskV3(
          mask,
          x,
          y,
          rawMaskNormal
        ).normal
      : null;

  const imageNormal =
    imageGradient.valid
      ? orientNormalUsingMaskV3(
          mask,
          x,
          y,
          imageGradient.vector
        ).normal
      : null;

  if (
    imageNormal &&
    maskNormal
  ) {
    const agreement =
      vectorAgreementV3(
        imageNormal,
        maskNormal
      );

    /**
     * لو الاتجاهان متعاكسان بعد توحيد
     * الاتجاه من الداخل للخارج، نقلب اتجاه
     * الصورة لضمان الدمج الصحيح.
     */
    const signedAgreement =
      dotVectorsV3(
        imageNormal,
        maskNormal
      );

    const alignedImageNormal =
      signedAgreement < 0
        ? negateVectorV3(
            imageNormal
          )
        : imageNormal;

    if (
      agreement >=
      directionConfig
        .minimumDirectionAgreement
    ) {
      const imageWeight =
        directionConfig
          .imageDirectionWeight *
        Math.max(
          imageGradient.magnitude,
          SUB_PIXEL_EPSILON_V3
        );

      const maskWeight =
        directionConfig
          .maskDirectionWeight *
        Math.max(
          maskGradient.magnitude,
          SUB_PIXEL_EPSILON_V3
        );

      const fused =
        fuseVectorsV3(
          alignedImageNormal,
          imageWeight,
          maskNormal,
          maskWeight
        );

      const oriented =
        orientNormalUsingMaskV3(
          mask,
          x,
          y,
          fused
        );

      return {
        normal:
          oriented.normal,

        tangent:
          perpendicularVectorV3(
            oriented.normal
          ),

        imageNormal:
          alignedImageNormal,

        maskNormal,

        imageStrength:
          clampUnitValue(
            imageGradient.magnitude
          ),

        maskStrength:
          clampUnitValue(
            maskGradient.magnitude
          ),

        agreement,

        confidence:
          clampUnitValue(
            agreement *
              0.45 +
            Math.max(
              imageGradient.magnitude,
              maskGradient.magnitude
            ) *
              0.35 +
            oriented
              .orientationConfidence *
              0.2
          ),

        source:
          'fused',

        valid:
          true,
      };
    }

    if (
      directionConfig
        .preferStrongerDirectionOnConflict
    ) {
      const imageReliability =
        imageGradient.magnitude *
        directionConfig
          .imageDirectionWeight;

      const maskReliability =
        maskGradient.magnitude *
        directionConfig
          .maskDirectionWeight;

      const selected =
        imageReliability >
        maskReliability
          ? alignedImageNormal
          : maskNormal;

      const selectedSource:
        BoundarySubPixelDirectionSourceV3 =
          imageReliability >
          maskReliability
            ? 'image'
            : 'mask';

      const oriented =
        orientNormalUsingMaskV3(
          mask,
          x,
          y,
          selected
        );

      return {
        normal:
          oriented.normal,

        tangent:
          perpendicularVectorV3(
            oriented.normal
          ),

        imageNormal:
          alignedImageNormal,

        maskNormal,

        imageStrength:
          clampUnitValue(
            imageGradient.magnitude
          ),

        maskStrength:
          clampUnitValue(
            maskGradient.magnitude
          ),

        agreement,

        confidence:
          clampUnitValue(
            Math.max(
              imageReliability,
              maskReliability
            ) *
              0.75 +
            oriented
              .orientationConfidence *
              0.25
          ),

        source:
          selectedSource,

        valid:
          true,
      };
    }
  }

  if (imageNormal) {
    const oriented =
      orientNormalUsingMaskV3(
        mask,
        x,
        y,
        imageNormal
      );

    return {
      normal:
        oriented.normal,

      tangent:
        perpendicularVectorV3(
          oriented.normal
        ),

      imageNormal:
        oriented.normal,

      maskNormal:
        null,

      imageStrength:
        clampUnitValue(
          imageGradient.magnitude
        ),

      maskStrength:
        clampUnitValue(
          maskGradient.magnitude
        ),

      agreement:
        0,

      confidence:
        clampUnitValue(
          imageGradient.magnitude *
            0.8 +
          oriented
            .orientationConfidence *
            0.2
        ),

      source:
        'image',

      valid:
        true,
    };
  }

  if (maskNormal) {
    const oriented =
      orientNormalUsingMaskV3(
        mask,
        x,
        y,
        maskNormal
      );

    return {
      normal:
        oriented.normal,

      tangent:
        perpendicularVectorV3(
          oriented.normal
        ),

      imageNormal:
        null,

      maskNormal:
        oriented.normal,

      imageStrength:
        clampUnitValue(
          imageGradient.magnitude
        ),

      maskStrength:
        clampUnitValue(
          maskGradient.magnitude
        ),

      agreement:
        0,

      confidence:
        clampUnitValue(
          maskGradient.magnitude *
            0.75 +
          oriented
            .orientationConfidence *
            0.25
        ),

      source:
        'mask',

      valid:
        true,
    };
  }

  const fallback =
    calculateFallbackBoundaryNormalV3(
      mask,
      x,
      y,
      detectionConfig
    );

  const orientedFallback =
    orientNormalUsingMaskV3(
      mask,
      x,
      y,
      fallback
    );

  return {
    normal:
      orientedFallback.normal,

    tangent:
      perpendicularVectorV3(
        orientedFallback.normal
      ),

    imageNormal:
      null,

    maskNormal:
      null,

    imageStrength:
      clampUnitValue(
        imageGradient.magnitude
      ),

    maskStrength:
      clampUnitValue(
        maskGradient.magnitude
      ),

    agreement:
      0,

    confidence:
      clampUnitValue(
        0.15 +
        orientedFallback
          .orientationConfidence *
          0.35
      ),

    source:
      'fallback',

    valid:
      true,
  };
}

/* =========================================================
 * Candidate classification
 * ======================================================= */

function classifyCandidateKindV3(
  alpha:
    number,
  local:
    BoundarySubPixelLocalAlphaRangeV3,
  config:
    BoundarySubPixelDetectionConfigV3
): BoundarySubPixelCandidateKindV3 | null {
  if (
    isSoftBoundaryAlphaV3(
      alpha,
      config
    )
  ) {
    return 'soft';
  }

  if (
    isStrongForegroundAlphaV3(
      alpha,
      config
    ) &&
    config.includeInnerCandidates &&
    (
      local
        .backgroundNeighborCount >
        0 ||
      local.minimum <=
        config
          .strongBackgroundThreshold
    )
  ) {
    return 'inner';
  }

  if (
    isStrongBackgroundAlphaV3(
      alpha,
      config
    ) &&
    config.includeOuterCandidates &&
    (
      local
        .foregroundNeighborCount >
        0 ||
      local.maximum >=
        config
          .strongForegroundThreshold
    )
  ) {
    return 'outer';
  }

  return null;
}

function shouldAcceptCandidateV3(
  kind:
    BoundarySubPixelCandidateKindV3,
  alpha:
    number,
  local:
    BoundarySubPixelLocalAlphaRangeV3,
  estimatedDistance:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): boolean {
  if (
    local.range <
    config.minimumLocalAlphaRange
  ) {
    return false;
  }

  switch (kind) {
    case 'inner':
      return (
        config
          .includeInnerCandidates &&
        alpha >=
          config.minimumMaskValue &&
        estimatedDistance <=
          config.maximumInnerDistance
      );

    case 'outer':
      return (
        config
          .includeOuterCandidates &&
        estimatedDistance <=
          config.maximumOuterDistance
      );

    case 'soft':
      return (
        alpha >=
          config
            .strongBackgroundThreshold &&
        alpha <=
          config
            .strongForegroundThreshold &&
        (
          local
            .foregroundNeighborCount >
            0 ||
          local
            .backgroundNeighborCount >
            0
        )
      );

    default:
      return false;
  }
}

/* =========================================================
 * Candidate priority
 * ======================================================= */

function calculateCandidatePriorityV3(
  candidate:
    BoundarySubPixelCandidateV3,
  image:
    BoundarySubPixelAnalysisImageV3
): number {
  const gradient =
    clampUnitValue(
      finiteOrV3(
        image.gradient[
          candidate.index
        ],
        0
      )
    );

  const directionConfidence =
    candidate.direction
      ?.confidence ??
    0;

  const kindWeight =
    candidate.kind ===
      'inner'
      ? 1
      : candidate.kind ===
          'soft'
        ? 0.9
        : 0.75;

  const distanceWeight =
    1 /
    Math.max(
      1,
      candidate
        .estimatedBoundaryDistance
    );

  return (
    candidate
      .localAlphaRange *
      0.34 +
    gradient *
      0.28 +
    directionConfidence *
      0.2 +
    kindWeight *
      0.12 +
    distanceWeight *
      0.06
  );
}

/* =========================================================
 * Candidate extraction
 * ======================================================= */

function createBoundaryCandidateV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  detectionConfig:
    BoundarySubPixelDetectionConfigV3,
  directionConfig:
    BoundarySubPixelDirectionConfigV3
): BoundarySubPixelCandidateV3 | null {
  const index =
    pixelIndexV3(
      x,
      y,
      mask.width
    );

  const alpha =
    clampUnitValue(
      finiteOrV3(
        mask.data[index],
        0
      )
    );

  const local =
    analyzeLocalAlphaRangeV3(
      mask,
      x,
      y,
      detectionConfig
        .boundaryRadius,
      detectionConfig
    );

  const kind =
    classifyCandidateKindV3(
      alpha,
      local,
      detectionConfig
    );

  if (!kind) {
    return null;
  }

  const estimatedDistance =
    kind === 'outer'
      ? estimateDistanceToStrongForegroundV3(
          mask,
          x,
          y,
          detectionConfig
            .maximumOuterDistance,
          detectionConfig
        )
      : estimateDistanceToStrongBackgroundV3(
          mask,
          x,
          y,
          detectionConfig
            .maximumInnerDistance,
          detectionConfig
        );

  if (
    !shouldAcceptCandidateV3(
      kind,
      alpha,
      local,
      estimatedDistance,
      detectionConfig
    )
  ) {
    return null;
  }

  const direction =
    calculateBoundaryDirectionV3(
      image,
      mask,
      x,
      y,
      detectionConfig,
      directionConfig
    );

  if (!direction.valid) {
    return null;
  }

  return {
    index,

    x,

    y,

    kind,

    originalAlpha:
      alpha,

    localMinimumAlpha:
      local.minimum,

    localMaximumAlpha:
      local.maximum,

    localAlphaRange:
      local.range,

    estimatedBoundaryDistance:
      estimatedDistance,

    direction,
  };
}

function extractBoundaryCandidatesV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelCandidateV3[] {
  const candidates:
    BoundarySubPixelCandidateV3[] = [];

  const width =
    mask.width;

  const height =
    mask.height;

  let operation =
    0;

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
      operation +=
        1;

      if (
        shouldCheckCancellationV3(
          operation,
          config
            .runtime
            .cancellationCheckInterval
        )
      ) {
        assertNotCancelledV3(
          cancellationSignal
        );
      }

      const index =
        pixelIndexV3(
          x,
          y,
          width
        );

      const alpha =
        clampUnitValue(
          finiteOrV3(
            mask.data[index],
            0
          )
        );

      /**
       * Fast reject:
       * لا نحسب التحليل المحلي للبكسلات الواضحة
       * داخل الجسم أو الخلفية إلا لو لها جار معاكس.
       */
      if (
        alpha <
          config
            .detection
            .minimumMaskValue &&
        !config
          .detection
          .includeOuterCandidates
      ) {
        continue;
      }

      if (
        isStrongForegroundAlphaV3(
          alpha,
          config.detection
        ) &&
        !hasStrongBackgroundNeighborV3(
          mask,
          x,
          y,
          config
            .detection
            .boundaryRadius,
          config.detection
        )
      ) {
        continue;
      }

      if (
        isStrongBackgroundAlphaV3(
          alpha,
          config.detection
        ) &&
        !hasStrongForegroundNeighborV3(
          mask,
          x,
          y,
          config
            .detection
            .boundaryRadius,
          config.detection
        )
      ) {
        continue;
      }

      const candidate =
        createBoundaryCandidateV3(
          image,
          mask,
          x,
          y,
          config.detection,
          config.direction
        );

      if (candidate) {
        candidates.push(
          candidate
        );
      }
    }
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  const maximumCandidates =
    config
      .detection
      .maximumCandidates;

  if (
    maximumCandidates <= 0 ||
    candidates.length <=
      maximumCandidates
  ) {
    return candidates;
  }

  candidates.sort(
    (
      first,
      second
    ) =>
      calculateCandidatePriorityV3(
        second,
        image
      ) -
      calculateCandidatePriorityV3(
        first,
        image
      )
  );

  candidates.length =
    maximumCandidates;

  /**
   * إعادة الترتيب حسب index لضمان معالجة
   * ثابتة ومتوقعة عبر الأجهزة.
   */
  candidates.sort(
    (
      first,
      second
    ) =>
      first.index -
      second.index
  );

  return candidates;
}

/* =========================================================
 * Candidate neighborhood metadata
 * ======================================================= */

type BoundarySubPixelCandidateNeighborhoodV3 = {
  foregroundRatio:
    number;

  backgroundRatio:
    number;

  softRatio:
    number;

  localMeanAlpha:
    number;

  localAlphaVariance:
    number;

  validSampleCount:
    number;
};

function analyzeCandidateNeighborhoodV3(
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  radius:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): BoundarySubPixelCandidateNeighborhoodV3 {
  const safeRadius =
    Math.max(
      1,
      Math.floor(radius)
    );

  let foreground =
    0;

  let background =
    0;

  let soft =
    0;

  let sum =
    0;

  let sumSquares =
    0;

  let count =
    0;

  for (
    let offsetY =
      -safeRadius;
    offsetY <=
      safeRadius;
    offsetY +=
      1
  ) {
    const sampleY =
      candidate.y +
      offsetY;

    if (
      sampleY < 0 ||
      sampleY >=
        mask.height
    ) {
      continue;
    }

    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      const sampleX =
        candidate.x +
        offsetX;

      if (
        sampleX < 0 ||
        sampleX >=
          mask.width
      ) {
        continue;
      }

      const value =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              pixelIndexV3(
                sampleX,
                sampleY,
                mask.width
              )
            ],
            0
          )
        );

      sum +=
        value;

      sumSquares +=
        value *
        value;

      count +=
        1;

      if (
        isStrongForegroundAlphaV3(
          value,
          config
        )
      ) {
        foreground +=
          1;
      } else if (
        isStrongBackgroundAlphaV3(
          value,
          config
        )
      ) {
        background +=
          1;
      } else {
        soft +=
          1;
      }
    }
  }

  const mean =
    count > 0
      ? sum /
        count
      : 0;

  const variance =
    count > 0
      ? Math.max(
          0,
          sumSquares /
            count -
          mean *
            mean
        )
      : 0;

  return {
    foregroundRatio:
      count > 0
        ? foreground /
          count
        : 0,

    backgroundRatio:
      count > 0
        ? background /
          count
        : 0,

    softRatio:
      count > 0
        ? soft /
          count
        : 0,

    localMeanAlpha:
      clampUnitValue(
        mean
      ),

    localAlphaVariance:
      clampUnitValue(
        variance *
        4
      ),

    validSampleCount:
      count,
  };
}

/* =========================================================
 * Direction consistency
 * ======================================================= */

function calculateDirectionConsistencyV3(
  candidates:
    readonly BoundarySubPixelCandidateV3[],
  candidateIndex:
    number,
  maximumNeighborDistance:
    number
): number {
  const candidate =
    candidates[
      candidateIndex
    ];

  if (
    !candidate ||
    !candidate.direction
  ) {
    return 0;
  }

  const maximumDistanceSquared =
    maximumNeighborDistance *
    maximumNeighborDistance;

  let weightedAgreement =
    0;

  let totalWeight =
    0;

  const searchStart =
    Math.max(
      0,
      candidateIndex -
      24
    );

  const searchEnd =
    Math.min(
      candidates.length,
      candidateIndex +
      25
    );

  for (
    let index =
      searchStart;
    index <
      searchEnd;
    index +=
      1
  ) {
    if (
      index ===
      candidateIndex
    ) {
      continue;
    }

    const neighbor =
      candidates[index];

    if (
      !neighbor ||
      !neighbor.direction
    ) {
      continue;
    }

    const deltaX =
      neighbor.x -
      candidate.x;

    const deltaY =
      neighbor.y -
      candidate.y;

    const distanceSquared =
      deltaX *
        deltaX +
      deltaY *
        deltaY;

    if (
      distanceSquared <= 0 ||
      distanceSquared >
        maximumDistanceSquared
    ) {
      continue;
    }

    const distance =
      Math.sqrt(
        distanceSquared
      );

    const weight =
      1 /
      Math.max(
        1,
        distance
      );

    weightedAgreement +=
      vectorAgreementV3(
        candidate
          .direction
          .normal,
        neighbor
          .direction
          .normal
      ) *
      weight;

    totalWeight +=
      weight;
  }

  return totalWeight >
    SUB_PIXEL_EPSILON_V3
    ? clampUnitValue(
        weightedAgreement /
        totalWeight
      )
    : candidate
        .direction
        .confidence;
}

/* =========================================================
 * Candidate direction refinement
 * ======================================================= */

function refineCandidateDirectionsV3(
  candidates:
    readonly BoundarySubPixelCandidateV3[],
  cancellationSignal:
    SegmentationCancellationSignal | undefined,
  cancellationInterval:
    number
): BoundarySubPixelCandidateV3[] {
  const refined:
    BoundarySubPixelCandidateV3[] =
      new Array(
        candidates.length
      );

  for (
    let index =
      0;
    index <
      candidates.length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        cancellationInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const candidate =
      candidates[index];

    if (
      !candidate.direction ||
      !candidate
        .direction
        .valid
    ) {
      refined[index] =
        candidate;

      continue;
    }

    const consistency =
      calculateDirectionConsistencyV3(
        candidates,
        index,
        4
      );

    refined[index] = {
      ...candidate,

      direction: {
        ...candidate.direction,

        confidence:
          clampUnitValue(
            candidate
              .direction
              .confidence *
              0.72 +
            consistency *
              0.28
          ),
      },
    };
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return refined;
}

/* =========================================================
 * Public internal candidate builder
 * ======================================================= */

function buildBoundarySubPixelCandidatesV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelCandidateV3[] {
  const candidates =
    extractBoundaryCandidatesV3(
      image,
      mask,
      config,
      cancellationSignal
    );

  if (
    candidates.length === 0
  ) {
    return candidates;
  }

  return refineCandidateDirectionsV3(
    candidates,
    cancellationSignal,
    config
      .runtime
      .cancellationCheckInterval
  );
}

/* =========================================================
 * Part 2 internal references
 * ======================================================= */

/**
 * الأدوات التالية ستستخدمها أجزاء التحليل
 * واتخاذ القرار في Part 3 وPart 4.
 */
const BOUNDARY_SUB_PIXEL_PART_2_INTERNALS_V3 = {
  analyzeLocalAlphaRangeV3,

  isStrongForegroundAlphaV3,
  isStrongBackgroundAlphaV3,
  isSoftBoundaryAlphaV3,

  countForegroundNeighborsV3,

  hasStrongForegroundNeighborV3,
  hasStrongBackgroundNeighborV3,

  estimateDistanceToStrongBackgroundV3,
  estimateDistanceToStrongForegroundV3,

  calculateMaskGradientV3,
  readImageGradientDirectionV3,

  orientMaskNormalOutsideV3,
  scoreNormalOrientationV3,
  orientNormalUsingMaskV3,

  calculateFallbackBoundaryNormalV3,
  calculateBoundaryDirectionV3,

  classifyCandidateKindV3,
  shouldAcceptCandidateV3,

  calculateCandidatePriorityV3,

  createBoundaryCandidateV3,
  extractBoundaryCandidatesV3,

  analyzeCandidateNeighborhoodV3,

  calculateDirectionConsistencyV3,
  refineCandidateDirectionsV3,

  buildBoundarySubPixelCandidatesV3,
};

void BOUNDARY_SUB_PIXEL_PART_2_INTERNALS_V3;

// End of Part 2/4
// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 3A/4
//
// يكمل مباشرة بعد:
//
// // End of Part 2/4
//
// هذا الجزء مسؤول عن:
//
// 1) بناء العينات داخل وخارج القطعة.
// 2) أخذ عينات على اتجاه الـNormal والـTangent.
// 3) حساب نموذج لون محلي للداخل والخارج.
// 4) حساب فروق RGB والإضاءة والتشبع.
// 5) تحليل موضع الحافة الحقيقي Sub-Pixel.
// 6) حساب أدلة اللون والحافة والماسك.
// 7) تجهيز البيانات التي سيستخدمها محرك القرار.
//
// Part 3B سيكمل:
// - Thin Structure Protection.
// - Sharp Corner Protection.
// - High Texture Protection.
// - Foreground/Background Evidence Fusion.
// - القرار الأولي لكل Candidate.

/* =========================================================
 * Sampling contracts
 * ======================================================= */

type BoundarySubPixelSideSampleSetV3 = {
  samples:
    readonly BoundarySubPixelSampleV3[];

  aggregate:
    BoundarySubPixelWeightedSampleV3;

  valid:
    boolean;

  requestedSampleCount:
    number;

  validSampleCount:
    number;

  rejectedSampleCount:
    number;
};

type BoundarySubPixelCandidateSamplesV3 = {
  center:
    BoundarySubPixelSampleV3;

  inside:
    BoundarySubPixelSideSampleSetV3;

  outside:
    BoundarySubPixelSideSampleSetV3;

  valid:
    boolean;
};

type BoundarySubPixelSubPixelSearchResultV3 = {
  offset:
    number;

  score:
    number;

  baselineScore:
    number;

  improvement:
    number;

  foregroundSideGradient:
    number;

  backgroundSideGradient:
    number;

  centerGradient:
    number;

  alignment:
    number;

  valid:
    boolean;
};

type BoundarySubPixelCandidateColorAnalysisV3 = {
  centerToInside:
    BoundarySubPixelColorDistanceV3;

  centerToOutside:
    BoundarySubPixelColorDistanceV3;

  insideToOutside:
    BoundarySubPixelColorDistanceV3;

  foregroundSimilarity:
    number;

  backgroundSimilarity:
    number;

  separation:
    number;

  contrastConfidence:
    number;

  ambiguousColor:
    boolean;

  darkForegroundProtection:
    number;

  brightForegroundProtection:
    number;
};

type BoundarySubPixelCandidateEdgeAnalysisV3 = {
  centerGradient:
    number;

  insideGradient:
    number;

  outsideGradient:
    number;

  strongestGradient:
    number;

  gradientStrengthEvidence:
    number;

  normalAlignment:
    number;

  edgeCenterEvidence:
    number;

  subPixel:
    BoundarySubPixelSubPixelSearchResultV3;

  combinedEvidence:
    number;

  valid:
    boolean;
};

type BoundarySubPixelCandidateMaskAnalysisV3 = {
  centerAlpha:
    number;

  insideAlpha:
    number;

  outsideAlpha:
    number;

  foregroundEvidence:
    number;

  backgroundEvidence:
    number;

  transitionStrength:
    number;

  directionConsistency:
    number;

  valid:
    boolean;
};

type BoundarySubPixelCandidateAnalysisV3 = {
  candidate:
    BoundarySubPixelCandidateV3;

  samples:
    BoundarySubPixelCandidateSamplesV3;

  color:
    BoundarySubPixelCandidateColorAnalysisV3;

  edge:
    BoundarySubPixelCandidateEdgeAnalysisV3;

  mask:
    BoundarySubPixelCandidateMaskAnalysisV3;

  valid:
    boolean;

  rejectionReason:
    string | null;
};

/* =========================================================
 * Sampling weight
 * ======================================================= */

function calculateDistanceSampleWeightV3(
  distance:
    number,
  minimumDistance:
    number,
  maximumDistance:
    number,
  config:
    BoundarySubPixelSamplingConfigV3
): number {
  const safeMinimum =
    Math.max(
      SUB_PIXEL_EPSILON_V3,
      finiteOrV3(
        minimumDistance,
        0.5
      )
    );

  const safeMaximum =
    Math.max(
      safeMinimum,
      finiteOrV3(
        maximumDistance,
        safeMinimum
      )
    );

  const normalizedDistance =
    inverseLerpV3(
      safeMinimum,
      safeMaximum,
      distance
    );

  return lerpV3(
    config.nearWeight,
    config.farWeight,
    normalizedDistance
  );
}

function calculateTangentialSampleOffsetV3(
  sampleIndex:
    number,
  sampleCount:
    number,
  tangentialRadius:
    number
): number {
  if (
    sampleCount <= 0 ||
    tangentialRadius <= 0
  ) {
    return 0;
  }

  const totalPositions =
    sampleCount *
      2 +
    1;

  const position =
    sampleIndex +
    sampleCount;

  const normalized =
    totalPositions > 1
      ? position /
        (
          totalPositions -
          1
        )
      : 0.5;

  return lerpV3(
    -tangentialRadius,
    tangentialRadius,
    normalized
  );
}

function calculateTangentialWeightV3(
  offset:
    number,
  radius:
    number
): number {
  if (
    radius <=
    SUB_PIXEL_EPSILON_V3
  ) {
    return 1;
  }

  const normalized =
    clampUnitValue(
      Math.abs(offset) /
      radius
    );

  return lerpV3(
    1,
    0.55,
    normalized
  );
}

/* =========================================================
 * Side sample construction
 * ======================================================= */

function buildBoundarySideSamplesV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  directionSign:
    -1 | 1,
  distances:
    readonly number[],
  config:
    BoundarySubPixelSamplingConfigV3
): BoundarySubPixelSideSampleSetV3 {
  const samples:
    BoundarySubPixelSampleV3[] = [];

  const normal =
    candidate
      .direction
      ?.normal;

  const tangent =
    candidate
      .direction
      ?.tangent;

  if (
    !normal ||
    !tangent
  ) {
    return {
      samples,

      aggregate:
        aggregateSamplesV3(
          samples
        ),

      valid:
        false,

      requestedSampleCount:
        0,

      validSampleCount:
        0,

      rejectedSampleCount:
        0,
    };
  }

  const minimumDistance =
    distances.length > 0
      ? distances[0]
      : 0.5;

  const maximumDistance =
    distances.length > 0
      ? distances[
          distances.length -
          1
        ]
      : minimumDistance;

  let requestedSampleCount =
    0;

  let validSampleCount =
    0;

  let rejectedSampleCount =
    0;

  for (
    const distance of distances
  ) {
    const distanceWeight =
      calculateDistanceSampleWeightV3(
        distance,
        minimumDistance,
        maximumDistance,
        config
      );

    for (
      let tangentialIndex =
        -config
          .tangentialSamples;
      tangentialIndex <=
        config
          .tangentialSamples;
      tangentialIndex +=
        1
    ) {
      const tangentialOffset =
        calculateTangentialSampleOffsetV3(
          tangentialIndex,
          config
            .tangentialSamples,
          config
            .tangentialRadius
        );

      const tangentialWeight =
        calculateTangentialWeightV3(
          tangentialOffset,
          config
            .tangentialRadius
        );

      const sampleX =
        candidate.x +
        normal.x *
          distance *
          directionSign +
        tangent.x *
          tangentialOffset;

      const sampleY =
        candidate.y +
        normal.y *
          distance *
          directionSign +
        tangent.y *
          tangentialOffset;

      const sample =
        sampleAnalysisPointV3(
          image,
          mask,
          sampleX,
          sampleY,
          distanceWeight *
            tangentialWeight,
          config
        );

      requestedSampleCount +=
        1;

      if (sample.valid) {
        validSampleCount +=
          1;
      } else {
        rejectedSampleCount +=
          1;
      }

      samples.push(
        sample
      );
    }
  }

  const aggregate =
    aggregateSamplesV3(
      samples
    );

  return {
    samples,

    aggregate,

    valid:
      aggregate.valid,

    requestedSampleCount,

    validSampleCount,

    rejectedSampleCount,
  };
}

/* =========================================================
 * Candidate sample construction
 * ======================================================= */

function buildCandidateSamplesV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelSamplingConfigV3
): BoundarySubPixelCandidateSamplesV3 {
  const center =
    sampleAnalysisPointV3(
      image,
      mask,
      candidate.x,
      candidate.y,
      1,
      config
    );

  /**
   * normal يشير:
   *
   * الداخل -> الخارج
   *
   * لذلك:
   *
   * -1 = داخل الجسم
   * +1 = خارج الجسم
   */
  const inside =
    buildBoundarySideSamplesV3(
      image,
      mask,
      candidate,
      -1,
      config.insideDistances,
      config
    );

  const outside =
    buildBoundarySideSamplesV3(
      image,
      mask,
      candidate,
      1,
      config.outsideDistances,
      config
    );

  const insideEnough =
    inside.validSampleCount >=
    config.minimumInsideSamples;

  const outsideEnough =
    outside.validSampleCount >=
    config.minimumOutsideSamples;

  return {
    center,

    inside,

    outside,

    valid:
      center.valid &&
      inside.valid &&
      outside.valid &&
      insideEnough &&
      outsideEnough,
  };
}

/* =========================================================
 * Color distance
 * ======================================================= */

function calculateRgbEuclideanDistanceV3(
  first:
    BoundarySubPixelWeightedSampleV3,
  second:
    BoundarySubPixelWeightedSampleV3
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

  return clampUnitValue(
    Math.sqrt(
      (
        redDifference *
          redDifference +
        greenDifference *
          greenDifference +
        blueDifference *
          blueDifference
      ) /
      3
    )
  );
}

function calculateMaximumChannelDifferenceV3(
  first:
    BoundarySubPixelWeightedSampleV3,
  second:
    BoundarySubPixelWeightedSampleV3
): number {
  return clampUnitValue(
    Math.max(
      Math.abs(
        first.red -
        second.red
      ),

      Math.abs(
        first.green -
        second.green
      ),

      Math.abs(
        first.blue -
        second.blue
      )
    )
  );
}

function calculateColorDistanceV3(
  first:
    BoundarySubPixelWeightedSampleV3,
  second:
    BoundarySubPixelWeightedSampleV3,
  config:
    BoundarySubPixelColorConfigV3
): BoundarySubPixelColorDistanceV3 {
  if (
    !first.valid ||
    !second.valid
  ) {
    return {
      rgb:
        0,

      luminance:
        0,

      saturation:
        0,

      maximumChannel:
        0,

      combined:
        0,
    };
  }

  const rgb =
    calculateRgbEuclideanDistanceV3(
      first,
      second
    );

  const luminance =
    clampUnitValue(
      Math.abs(
        first.luminance -
        second.luminance
      )
    );

  const saturation =
    clampUnitValue(
      Math.abs(
        first.saturation -
        second.saturation
      )
    );

  const maximumChannel =
    calculateMaximumChannelDifferenceV3(
      first,
      second
    );

  const totalWeight =
    config.rgbWeight +
    config.luminanceWeight +
    config.saturationWeight +
    config
      .maximumChannelDifferenceWeight;

  const weighted =
    totalWeight >
    SUB_PIXEL_EPSILON_V3
      ? (
          rgb *
            config.rgbWeight +
          luminance *
            config.luminanceWeight +
          saturation *
            config.saturationWeight +
          maximumChannel *
            config
              .maximumChannelDifferenceWeight
        ) /
        totalWeight
      : rgb;

  return {
    rgb,

    luminance,

    saturation,

    maximumChannel,

    combined:
      clampUnitValue(
        weighted *
        config
          .distanceSensitivity
      ),
  };
}

/* =========================================================
 * Single sample aggregation
 * ======================================================= */

function aggregateSingleSampleV3(
  sample:
    BoundarySubPixelSampleV3
): BoundarySubPixelWeightedSampleV3 {
  if (!sample.valid) {
    return {
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

      maskValue:
        0,

      totalWeight:
        0,

      sampleCount:
        0,

      valid:
        false,
    };
  }

  return {
    red:
      sample.red,

    green:
      sample.green,

    blue:
      sample.blue,

    luminance:
      sample.luminance,

    saturation:
      sample.saturation,

    gradient:
      sample.gradient,

    maskValue:
      sample.maskValue,

    totalWeight:
      Math.max(
        sample.weight,
        1
      ),

    sampleCount:
      1,

    valid:
      true,
  };
}

/* =========================================================
 * Color protection
 * ======================================================= */

function calculateDarkForegroundProtectionV3(
  center:
    BoundarySubPixelWeightedSampleV3,
  inside:
    BoundarySubPixelWeightedSampleV3,
  outside:
    BoundarySubPixelWeightedSampleV3,
  config:
    BoundarySubPixelColorConfigV3
): number {
  if (
    !config.protectDarkForeground ||
    !center.valid ||
    !inside.valid ||
    !outside.valid
  ) {
    return 0;
  }

  const darkThreshold =
    config
      .darkLuminanceThreshold;

  const centerDarkness =
    1 -
    smoothStepV3(
      darkThreshold *
        0.35,
      darkThreshold *
        1.35,
      center.luminance
    );

  const insideDarkness =
    1 -
    smoothStepV3(
      darkThreshold *
        0.35,
      darkThreshold *
        1.35,
      inside.luminance
    );

  const outsideBrighter =
    smoothStepV3(
      0.015,
      0.2,
      outside.luminance -
      inside.luminance
    );

  const centerSimilarInside =
    1 -
    clampUnitValue(
      Math.abs(
        center.luminance -
        inside.luminance
      ) *
      5
    );

  return clampUnitValue(
    centerDarkness *
      0.3 +
    insideDarkness *
      0.3 +
    outsideBrighter *
      0.2 +
    centerSimilarInside *
      0.2
  );
}

function calculateBrightForegroundProtectionV3(
  center:
    BoundarySubPixelWeightedSampleV3,
  inside:
    BoundarySubPixelWeightedSampleV3,
  outside:
    BoundarySubPixelWeightedSampleV3,
  config:
    BoundarySubPixelColorConfigV3
): number {
  if (
    !config
      .protectBrightLowSaturationForeground ||
    !center.valid ||
    !inside.valid ||
    !outside.valid
  ) {
    return 0;
  }

  const brightnessThreshold =
    config
      .brightLuminanceThreshold;

  const saturationThreshold =
    config
      .lowSaturationThreshold;

  const centerBrightness =
    smoothStepV3(
      brightnessThreshold -
        0.12,
      brightnessThreshold,
      center.luminance
    );

  const insideBrightness =
    smoothStepV3(
      brightnessThreshold -
        0.12,
      brightnessThreshold,
      inside.luminance
    );

  const centerLowSaturation =
    1 -
    smoothStepV3(
      saturationThreshold,
      saturationThreshold +
        0.16,
      center.saturation
    );

  const insideLowSaturation =
    1 -
    smoothStepV3(
      saturationThreshold,
      saturationThreshold +
        0.16,
      inside.saturation
    );

  const colorContinuity =
    1 -
    clampUnitValue(
      calculateRgbEuclideanDistanceV3(
        center,
        inside
      ) *
      4
    );

  const outsideDifference =
    clampUnitValue(
      calculateRgbEuclideanDistanceV3(
        inside,
        outside
      ) *
      3
    );

  return clampUnitValue(
    centerBrightness *
      0.2 +
    insideBrightness *
      0.2 +
    centerLowSaturation *
      0.18 +
    insideLowSaturation *
      0.18 +
    colorContinuity *
      0.14 +
    outsideDifference *
      0.1
  );
}

/* =========================================================
 * Color analysis
 * ======================================================= */

function analyzeCandidateColorV3(
  samples:
    BoundarySubPixelCandidateSamplesV3,
  config:
    BoundarySubPixelColorConfigV3
): BoundarySubPixelCandidateColorAnalysisV3 {
  const center =
    aggregateSingleSampleV3(
      samples.center
    );

  const inside =
    samples
      .inside
      .aggregate;

  const outside =
    samples
      .outside
      .aggregate;

  const centerToInside =
    calculateColorDistanceV3(
      center,
      inside,
      config
    );

  const centerToOutside =
    calculateColorDistanceV3(
      center,
      outside,
      config
    );

  const insideToOutside =
    calculateColorDistanceV3(
      inside,
      outside,
      config
    );

  const foregroundSimilarity =
    clampUnitValue(
      1 -
      centerToInside.combined
    );

  const backgroundSimilarity =
    clampUnitValue(
      1 -
      centerToOutside.combined
    );

  const separation =
    clampUnitValue(
      insideToOutside.combined
    );

  const distanceDifference =
    Math.abs(
      centerToOutside.combined -
      centerToInside.combined
    );

  const contrastConfidence =
    clampUnitValue(
      separation *
        0.58 +
      distanceDifference *
        0.42
    );

  const ambiguousColor =
    separation <
      0.06 ||
    distanceDifference <
      0.025;

  const darkForegroundProtection =
    calculateDarkForegroundProtectionV3(
      center,
      inside,
      outside,
      config
    );

  const brightForegroundProtection =
    calculateBrightForegroundProtectionV3(
      center,
      inside,
      outside,
      config
    );

  return {
    centerToInside,

    centerToOutside,

    insideToOutside,

    foregroundSimilarity,

    backgroundSimilarity,

    separation,

    contrastConfidence,

    ambiguousColor,

    darkForegroundProtection,

    brightForegroundProtection,
  };
}

/* =========================================================
 * Gradient direction sampling
 * ======================================================= */

function sampleGradientDirectionVectorV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  x:
    number,
  y:
    number
): {
  vector:
    BoundarySubPixelVectorV3;

  strength:
    number;

  valid:
    boolean;
} {
  if (
    image.gradientDirection ===
      null ||
    !isInsideImageV3(
      x,
      y,
      image.width,
      image.height
    )
  ) {
    return {
      vector: {
        x: 0,
        y: 0,
      },

      strength:
        0,

      valid:
        false,
    };
  }

  const sampleX =
    Math.round(
      clampImageXV3(
        x,
        image.width
      )
    );

  const sampleY =
    Math.round(
      clampImageYV3(
        y,
        image.height
      )
    );

  const index =
    pixelIndexV3(
      sampleX,
      sampleY,
      image.width
    );

  const angle =
    normalizeAngleV3(
      finiteOrV3(
        image
          .gradientDirection[
            index
          ],
        0
      )
    );

  const strength =
    clampUnitValue(
      finiteOrV3(
        image.gradient[index],
        0
      )
    );

  return {
    vector:
      normalizeVectorV3(
        vectorFromAngleV3(
          angle
        )
      ),

    strength,

    valid:
      true,
  };
}

/* =========================================================
 * Gradient alignment
 * ======================================================= */

function calculateGradientNormalAlignmentV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  candidate:
    BoundarySubPixelCandidateV3
): number {
  const normal =
    candidate
      .direction
      ?.normal;

  if (!normal) {
    return 0;
  }

  const gradientDirection =
    sampleGradientDirectionVectorV3(
      image,
      candidate.x,
      candidate.y
    );

  if (
    !gradientDirection.valid
  ) {
    return candidate
      .direction
      ?.agreement ??
      0;
  }

  return vectorAgreementV3(
    gradientDirection.vector,
    normal
  );
}

/* =========================================================
 * Sub-pixel edge score
 * ======================================================= */

function calculateSubPixelPositionScoreV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  offset:
    number,
  samplingConfig:
    BoundarySubPixelSamplingConfigV3,
  edgeConfig:
    BoundarySubPixelEdgeConfigV3
): {
  score:
    number;

  centerGradient:
    number;

  foregroundGradient:
    number;

  backgroundGradient:
    number;

  alignment:
    number;

  valid:
    boolean;
} {
  const direction =
    candidate.direction;

  if (!direction) {
    return {
      score:
        0,

      centerGradient:
        0,

      foregroundGradient:
        0,

      backgroundGradient:
        0,

      alignment:
        0,

      valid:
        false,
    };
  }

  const normal =
    direction.normal;

  const centerX =
    candidate.x +
    normal.x *
      offset;

  const centerY =
    candidate.y +
    normal.y *
      offset;

  const centerSample =
    sampleAnalysisPointV3(
      image,
      mask,
      centerX,
      centerY,
      1,
      samplingConfig
    );

  const foregroundSample =
    sampleAnalysisPointV3(
      image,
      mask,
      centerX -
        normal.x *
        0.75,
      centerY -
        normal.y *
        0.75,
      1,
      samplingConfig
    );

  const backgroundSample =
    sampleAnalysisPointV3(
      image,
      mask,
      centerX +
        normal.x *
        0.75,
      centerY +
        normal.y *
        0.75,
      1,
      samplingConfig
    );

  if (
    !centerSample.valid ||
    !foregroundSample.valid ||
    !backgroundSample.valid
  ) {
    return {
      score:
        0,

      centerGradient:
        0,

      foregroundGradient:
        0,

      backgroundGradient:
        0,

      alignment:
        0,

      valid:
        false,
    };
  }

  const directionSample =
    sampleGradientDirectionVectorV3(
      image,
      centerX,
      centerY
    );

  const alignment =
    directionSample.valid
      ? vectorAgreementV3(
          directionSample.vector,
          normal
        )
      : direction.confidence;

  const centerGradient =
    centerSample.gradient;

  const foregroundGradient =
    foregroundSample.gradient;

  const backgroundGradient =
    backgroundSample.gradient;

  const localGradientPeak =
    clampUnitValue(
      centerGradient -
      (
        foregroundGradient +
        backgroundGradient
      ) *
        0.5 +
      0.5
    );

  const maskTransition =
    clampUnitValue(
      foregroundSample.maskValue -
      backgroundSample.maskValue
    );

  const gradientStrength =
    smoothStepV3(
      edgeConfig
        .minimumUsefulGradient,
      edgeConfig
        .strongGradientThreshold,
      centerGradient
    );

  const score =
    clampUnitValue(
      gradientStrength *
        0.38 +
      alignment *
        0.26 +
      localGradientPeak *
        0.2 +
      maskTransition *
        0.16
    );

  return {
    score,

    centerGradient,

    foregroundGradient,

    backgroundGradient,

    alignment,

    valid:
      true,
  };
}

/* =========================================================
 * Sub-pixel search
 * ======================================================= */

function searchBestSubPixelOffsetV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  samplingConfig:
    BoundarySubPixelSamplingConfigV3,
  edgeConfig:
    BoundarySubPixelEdgeConfigV3
): BoundarySubPixelSubPixelSearchResultV3 {
  const baseline =
    calculateSubPixelPositionScoreV3(
      image,
      mask,
      candidate,
      0,
      samplingConfig,
      edgeConfig
    );

  if (!baseline.valid) {
    return {
      offset:
        0,

      score:
        0,

      baselineScore:
        0,

      improvement:
        0,

      foregroundSideGradient:
        0,

      backgroundSideGradient:
        0,

      centerGradient:
        0,

      alignment:
        0,

      valid:
        false,
    };
  }

  let bestOffset =
    0;

  let best =
    baseline;

  const maximumOffset =
    Math.max(
      0,
      edgeConfig.maximumOffset
    );

  const step =
    Math.max(
      0.05,
      edgeConfig.searchStep
    );

  for (
    let offset =
      -maximumOffset;
    offset <=
      maximumOffset +
        SUB_PIXEL_EPSILON_V3;
    offset +=
      step
  ) {
    if (
      Math.abs(offset) <=
      SUB_PIXEL_EPSILON_V3
    ) {
      continue;
    }

    const current =
      calculateSubPixelPositionScoreV3(
        image,
        mask,
        candidate,
        offset,
        samplingConfig,
        edgeConfig
      );

    if (!current.valid) {
      continue;
    }

    /**
     * عقوبة خفيفة للإزاحات الكبيرة حتى لا
     * تتحرك الحافة بعيدًا لمجرد وجود Gradient قوي.
     */
    const offsetPenalty =
      maximumOffset >
      SUB_PIXEL_EPSILON_V3
        ? (
            Math.abs(offset) /
            maximumOffset
          ) *
          0.07
        : 0;

    const adjustedScore =
      current.score -
      offsetPenalty;

    const bestAdjustedScore =
      best.score -
      (
        maximumOffset >
        SUB_PIXEL_EPSILON_V3
          ? (
              Math.abs(
                bestOffset
              ) /
              maximumOffset
            ) *
            0.07
          : 0
      );

    if (
      adjustedScore >
      bestAdjustedScore
    ) {
      best =
        current;

      bestOffset =
        offset;
    }
  }

  const rawImprovement =
    best.score -
    baseline.score;

  const accepted =
    rawImprovement >=
    edgeConfig.minimumImprovement;

  return {
    offset:
      accepted
        ? bestOffset
        : 0,

    score:
      accepted
        ? best.score
        : baseline.score,

    baselineScore:
      baseline.score,

    improvement:
      accepted
        ? clampUnitValue(
            rawImprovement
          )
        : 0,

    foregroundSideGradient:
      accepted
        ? best.foregroundGradient
        : baseline
            .foregroundGradient,

    backgroundSideGradient:
      accepted
        ? best.backgroundGradient
        : baseline
            .backgroundGradient,

    centerGradient:
      accepted
        ? best.centerGradient
        : baseline
            .centerGradient,

    alignment:
      accepted
        ? best.alignment
        : baseline.alignment,

    valid:
      true,
  };
}

/* =========================================================
 * Edge analysis
 * ======================================================= */

function analyzeCandidateEdgeV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  samples:
    BoundarySubPixelCandidateSamplesV3,
  samplingConfig:
    BoundarySubPixelSamplingConfigV3,
  edgeConfig:
    BoundarySubPixelEdgeConfigV3
): BoundarySubPixelCandidateEdgeAnalysisV3 {
  const centerGradient =
    clampUnitValue(
      samples
        .center
        .gradient
    );

  const insideGradient =
    clampUnitValue(
      samples
        .inside
        .aggregate
        .gradient
    );

  const outsideGradient =
    clampUnitValue(
      samples
        .outside
        .aggregate
        .gradient
    );

  const strongestGradient =
    Math.max(
      centerGradient,
      insideGradient,
      outsideGradient
    );

  const gradientStrengthEvidence =
    smoothStepV3(
      edgeConfig
        .minimumUsefulGradient,
      edgeConfig
        .strongGradientThreshold,
      strongestGradient
    );

  const normalAlignment =
    calculateGradientNormalAlignmentV3(
      image,
      candidate
    );

  const subPixel =
    searchBestSubPixelOffsetV3(
      image,
      mask,
      candidate,
      samplingConfig,
      edgeConfig
    );

  const edgeCenterEvidence =
    subPixel.valid
      ? clampUnitValue(
          subPixel.score *
            0.75 +
          subPixel.improvement *
            0.25
        )
      : 0;

  const totalWeight =
    edgeConfig
      .gradientStrengthWeight +
    edgeConfig
      .gradientAlignmentWeight +
    edgeConfig
      .edgeCenterWeight;

  const combinedEvidence =
    totalWeight >
    SUB_PIXEL_EPSILON_V3
      ? clampUnitValue(
          (
            gradientStrengthEvidence *
              edgeConfig
                .gradientStrengthWeight +
            normalAlignment *
              edgeConfig
                .gradientAlignmentWeight +
            edgeCenterEvidence *
              edgeConfig
                .edgeCenterWeight
          ) /
          totalWeight
        )
      : gradientStrengthEvidence;

  return {
    centerGradient,

    insideGradient,

    outsideGradient,

    strongestGradient,

    gradientStrengthEvidence,

    normalAlignment,

    edgeCenterEvidence,

    subPixel,

    combinedEvidence,

    valid:
      samples.valid,
  };
}

/* =========================================================
 * Mask evidence analysis
 * ======================================================= */

function calculateCandidateDirectionConsistencyV3(
  candidate:
    BoundarySubPixelCandidateV3,
  insideAlpha:
    number,
  outsideAlpha:
    number
): number {
  const expectedDifference =
    clampUnitValue(
      insideAlpha -
      outsideAlpha
    );

  const directionConfidence =
    candidate
      .direction
      ?.confidence ??
    0;

  return clampUnitValue(
    expectedDifference *
      0.65 +
    directionConfidence *
      0.35
  );
}

function analyzeCandidateMaskV3(
  candidate:
    BoundarySubPixelCandidateV3,
  samples:
    BoundarySubPixelCandidateSamplesV3,
  detectionConfig:
    BoundarySubPixelDetectionConfigV3
): BoundarySubPixelCandidateMaskAnalysisV3 {
  const centerAlpha =
    clampUnitValue(
      candidate.originalAlpha
    );

  const insideAlpha =
    clampUnitValue(
      samples
        .inside
        .aggregate
        .maskValue
    );

  const outsideAlpha =
    clampUnitValue(
      samples
        .outside
        .aggregate
        .maskValue
    );

  const foregroundEvidence =
    clampUnitValue(
      insideAlpha *
        0.46 +
      centerAlpha *
        0.32 +
      (
        1 -
        outsideAlpha
      ) *
        0.22
    );

  const backgroundEvidence =
    clampUnitValue(
      (
        1 -
        outsideAlpha
      ) *
        0.5 +
      (
        1 -
        centerAlpha
      ) *
        0.28 +
      (
        1 -
        insideAlpha
      ) *
        0.22
    );

  const transitionStrength =
    clampUnitValue(
      insideAlpha -
      outsideAlpha
    );

  const directionConsistency =
    calculateCandidateDirectionConsistencyV3(
      candidate,
      insideAlpha,
      outsideAlpha
    );

  const valid =
    insideAlpha >=
      detectionConfig
        .minimumMaskValue ||
    centerAlpha >=
      detectionConfig
        .minimumMaskValue ||
    candidate.kind ===
      'outer';

  return {
    centerAlpha,

    insideAlpha,

    outsideAlpha,

    foregroundEvidence,

    backgroundEvidence,

    transitionStrength,

    directionConsistency,

    valid,
  };
}

/* =========================================================
 * Candidate rejection
 * ======================================================= */

function getCandidateAnalysisRejectionReasonV3(
  candidate:
    BoundarySubPixelCandidateV3,
  samples:
    BoundarySubPixelCandidateSamplesV3,
  color:
    BoundarySubPixelCandidateColorAnalysisV3,
  edge:
    BoundarySubPixelCandidateEdgeAnalysisV3,
  mask:
    BoundarySubPixelCandidateMaskAnalysisV3,
  config:
    BoundarySubPixelRefinerConfigV3
): string | null {
  if (!candidate.direction) {
    return 'missing-boundary-direction';
  }

  if (!samples.center.valid) {
    return 'invalid-center-sample';
  }

  if (
    samples
      .inside
      .validSampleCount <
    config
      .sampling
      .minimumInsideSamples
  ) {
    return 'insufficient-inside-samples';
  }

  if (
    samples
      .outside
      .validSampleCount <
    config
      .sampling
      .minimumOutsideSamples
  ) {
    return 'insufficient-outside-samples';
  }

  if (
    !samples.inside.valid ||
    !samples.outside.valid
  ) {
    return 'invalid-side-samples';
  }

  if (!mask.valid) {
    return 'invalid-mask-evidence';
  }

  /**
   * لو اللون متشابه جدًا والحافة ضعيفة جدًا
   * لا نملك دليلًا آمنًا لتغيير Alpha.
   */
  if (
    color.ambiguousColor &&
    edge.strongestGradient <
      config
        .edge
        .minimumUsefulGradient &&
    mask.transitionStrength <
      0.08
  ) {
    return 'ambiguous-low-evidence-boundary';
  }

  return null;
}

/* =========================================================
 * Complete candidate analysis
 * ======================================================= */

function analyzeBoundaryCandidateV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelCandidateAnalysisV3 {
  const samples =
    buildCandidateSamplesV3(
      image,
      mask,
      candidate,
      config.sampling
    );

  const color =
    analyzeCandidateColorV3(
      samples,
      config.color
    );

  const edge =
    analyzeCandidateEdgeV3(
      image,
      mask,
      candidate,
      samples,
      config.sampling,
      config.edge
    );

  const maskAnalysis =
    analyzeCandidateMaskV3(
      candidate,
      samples,
      config.detection
    );

  const rejectionReason =
    getCandidateAnalysisRejectionReasonV3(
      candidate,
      samples,
      color,
      edge,
      maskAnalysis,
      config
    );

  return {
    candidate,

    samples,

    color,

    edge,

    mask:
      maskAnalysis,

    valid:
      rejectionReason ===
      null,

    rejectionReason,
  };
}

/* =========================================================
 * Batch candidate analysis
 * ======================================================= */

function analyzeBoundaryCandidatesV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidates:
    readonly BoundarySubPixelCandidateV3[],
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelCandidateAnalysisV3[] {
  const analyses:
    BoundarySubPixelCandidateAnalysisV3[] =
      new Array(
        candidates.length
      );

  for (
    let index =
      0;
    index <
      candidates.length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    analyses[index] =
      analyzeBoundaryCandidateV3(
        image,
        mask,
        candidates[index],
        config
      );
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return analyses;
}

/* =========================================================
 * Part 3A internal references
 * ======================================================= */

const BOUNDARY_SUB_PIXEL_PART_3A_INTERNALS_V3 = {
  calculateDistanceSampleWeightV3,

  calculateTangentialSampleOffsetV3,

  calculateTangentialWeightV3,

  buildBoundarySideSamplesV3,

  buildCandidateSamplesV3,

  calculateRgbEuclideanDistanceV3,

  calculateMaximumChannelDifferenceV3,

  calculateColorDistanceV3,

  aggregateSingleSampleV3,

  calculateDarkForegroundProtectionV3,

  calculateBrightForegroundProtectionV3,

  analyzeCandidateColorV3,

  sampleGradientDirectionVectorV3,

  calculateGradientNormalAlignmentV3,

  calculateSubPixelPositionScoreV3,

  searchBestSubPixelOffsetV3,

  analyzeCandidateEdgeV3,

  calculateCandidateDirectionConsistencyV3,

  analyzeCandidateMaskV3,

  getCandidateAnalysisRejectionReasonV3,

  analyzeBoundaryCandidateV3,

  analyzeBoundaryCandidatesV3,
};

void BOUNDARY_SUB_PIXEL_PART_3A_INTERNALS_V3;

// End of Part 3A/4
// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 3B/4
//
// يكمل مباشرة بعد:
//
// // End of Part 3A/4
//
// هذا الجزء مسؤول عن:
//
// 1) اكتشاف وحماية الأجزاء الرفيعة.
// 2) اكتشاف الزوايا الحادة.
// 3) اكتشاف الحواف ذات Texture مرتفع.
// 4) دمج أدلة اللون والحافة والماسك.
// 5) حساب Foreground وBackground Confidence.
// 6) حساب عدم اليقين.
// 7) بناء القرار الأولي لكل Boundary Candidate.
//
// Part 4 سيكمل:
// - تحويل القرار إلى Alpha نهائي.
// - تطبيق القرارات بأمان.
// - تشغيل التمريرات.
// - تجميع Diagnostics.
// - Public API.

/* =========================================================
 * Protection analysis contracts
 * ======================================================= */

type BoundarySubPixelThinStructureAnalysisV3 = {
  detected:
    boolean;

  estimatedWidth:
    number;

  connectivity:
    number;

  oppositeForeground:
    boolean;

  confidence:
    number;
};

type BoundarySubPixelCornerAnalysisV3 = {
  detected:
    boolean;

  directionVariation:
    number;

  foregroundQuadrants:
    number;

  backgroundQuadrants:
    number;

  confidence:
    number;
};

type BoundarySubPixelTextureAnalysisV3 = {
  detected:
    boolean;

  luminanceVariance:
    number;

  gradientVariance:
    number;

  colorVariance:
    number;

  combinedTexture:
    number;

  confidence:
    number;
};

type BoundarySubPixelFusedEvidenceV3 = {
  foreground:
    number;

  background:
    number;

  color:
    number;

  edge:
    number;

  originalMask:
    number;

  uncertainty:
    number;

  signedDecision:
    number;

  removalConfidence:
    number;

  recoveryConfidence:
    number;
};

/* =========================================================
 * Local mask line sampling
 * ======================================================= */

function sampleMaskAlongDirectionV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  direction:
    BoundarySubPixelVectorV3,
  distance:
    number
): number {
  const sample =
    sampleScalarV3(
      mask.data,
      mask.width,
      mask.height,
      x +
        direction.x *
        distance,
      y +
        direction.y *
        distance,
      true,
      false
    );

  return sample.valid
    ? clampUnitValue(
        sample.value
      )
    : 0;
}

function findForegroundRunLengthV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  direction:
    BoundarySubPixelVectorV3,
  maximumDistance:
    number,
  threshold:
    number
): number {
  const safeMaximumDistance =
    Math.max(
      1,
      Math.floor(
        maximumDistance
      )
    );

  let runLength =
    0;

  for (
    let distance =
      1;
    distance <=
      safeMaximumDistance;
    distance +=
      1
  ) {
    const value =
      sampleMaskAlongDirectionV3(
        mask,
        x,
        y,
        direction,
        distance
      );

    if (
      value <
      threshold
    ) {
      break;
    }

    runLength +=
      1;
  }

  return runLength;
}

function findBackgroundRunLengthV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  direction:
    BoundarySubPixelVectorV3,
  maximumDistance:
    number,
  threshold:
    number
): number {
  const safeMaximumDistance =
    Math.max(
      1,
      Math.floor(
        maximumDistance
      )
    );

  let runLength =
    0;

  for (
    let distance =
      1;
    distance <=
      safeMaximumDistance;
    distance +=
      1
  ) {
    const value =
      sampleMaskAlongDirectionV3(
        mask,
        x,
        y,
        direction,
        distance
      );

    if (
      value >
      threshold
    ) {
      break;
    }

    runLength +=
      1;
  }

  return runLength;
}

/* =========================================================
 * Thin structure detection
 * ======================================================= */

function calculateThinStructureConnectivityV3(
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelRefinerConfigV3
): number {
  const neighborhood =
    countForegroundNeighborsV3(
      mask,
      candidate.x,
      candidate.y,
      Math.max(
        1,
        Math.min(
          2,
          config
            .protection
            .thinStructureRadius
        )
      ),
      config
        .detection
        .minimumMaskValue
    );

  return clampUnitValue(
    neighborhood.ratio
  );
}

function detectThinStructureV3(
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelThinStructureAnalysisV3 {
  if (
    !config
      .protection
      .protectThinStructures ||
    !candidate.direction
  ) {
    return {
      detected:
        false,

      estimatedWidth:
        0,

      connectivity:
        0,

      oppositeForeground:
        false,

      confidence:
        0,
    };
  }

  const normal =
    candidate
      .direction
      .normal;

  const tangent =
    candidate
      .direction
      .tangent;

  const threshold =
    config
      .detection
      .minimumMaskValue;

  const maximumSearch =
    Math.max(
      config
        .protection
        .maximumThinWidth +
        2,
      config
        .protection
        .thinStructureRadius
    );

  const negativeNormalRun =
    findForegroundRunLengthV3(
      mask,
      candidate.x,
      candidate.y,
      negateVectorV3(
        normal
      ),
      maximumSearch,
      threshold
    );

  const positiveNormalRun =
    findForegroundRunLengthV3(
      mask,
      candidate.x,
      candidate.y,
      normal,
      maximumSearch,
      threshold
    );

  const negativeTangentRun =
    findForegroundRunLengthV3(
      mask,
      candidate.x,
      candidate.y,
      negateVectorV3(
        tangent
      ),
      maximumSearch,
      threshold
    );

  const positiveTangentRun =
    findForegroundRunLengthV3(
      mask,
      candidate.x,
      candidate.y,
      tangent,
      maximumSearch,
      threshold
    );

  const normalWidth =
    negativeNormalRun +
    positiveNormalRun +
    1;

  const tangentWidth =
    negativeTangentRun +
    positiveTangentRun +
    1;

  const estimatedWidth =
    Math.min(
      normalWidth,
      tangentWidth
    );

  const longestAxis =
    Math.max(
      normalWidth,
      tangentWidth
    );

  const connectivity =
    calculateThinStructureConnectivityV3(
      mask,
      candidate,
      config
    );

  const oppositeNormalAlpha =
    sampleMaskAlongDirectionV3(
      mask,
      candidate.x,
      candidate.y,
      negateVectorV3(
        normal
      ),
      Math.max(
        1,
        estimatedWidth -
        1
      )
    );

  const oppositeTangentAlpha =
    Math.max(
      sampleMaskAlongDirectionV3(
        mask,
        candidate.x,
        candidate.y,
        tangent,
        Math.max(
          1,
          estimatedWidth
        )
      ),

      sampleMaskAlongDirectionV3(
        mask,
        candidate.x,
        candidate.y,
        negateVectorV3(
          tangent
        ),
        Math.max(
          1,
          estimatedWidth
        )
      )
    );

  const oppositeForeground =
    Math.max(
      oppositeNormalAlpha,
      oppositeTangentAlpha
    ) >=
    config
      .detection
      .strongForegroundThreshold;

  const widthEvidence =
    1 -
    smoothStepV3(
      config
        .protection
        .maximumThinWidth,
      config
        .protection
        .maximumThinWidth +
        4,
      estimatedWidth
    );

  const elongation =
    longestAxis >
    0
      ? clampUnitValue(
          (
            longestAxis -
            estimatedWidth
          ) /
          longestAxis
        )
      : 0;

  const connectivityEvidence =
    smoothStepV3(
      config
        .protection
        .minimumThinConnectivity *
        0.6,
      config
        .protection
        .minimumThinConnectivity +
        0.25,
      connectivity
    );

  const confidence =
    clampUnitValue(
      widthEvidence *
        0.42 +
      elongation *
        0.24 +
      connectivityEvidence *
        0.22 +
      (
        oppositeForeground
          ? 0.12
          : 0
      )
    );

  const detected =
    estimatedWidth <=
      config
        .protection
        .maximumThinWidth &&
    connectivity >=
      config
        .protection
        .minimumThinConnectivity &&
    confidence >=
      0.45;

  return {
    detected,

    estimatedWidth,

    connectivity,

    oppositeForeground,

    confidence,
  };
}

/* =========================================================
 * Direction variation helpers
 * ======================================================= */

function calculateMaskNormalAtPointV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  directionConfig:
    BoundarySubPixelDirectionConfigV3
): BoundarySubPixelVectorV3 | null {
  const gradient =
    calculateMaskGradientV3(
      mask,
      x,
      y,
      directionConfig
    );

  if (!gradient.valid) {
    return null;
  }

  return orientMaskNormalOutsideV3(
    gradient
  );
}

function collectNeighborNormalsV3(
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  radius:
    number,
  directionConfig:
    BoundarySubPixelDirectionConfigV3
): BoundarySubPixelVectorV3[] {
  const normals:
    BoundarySubPixelVectorV3[] = [];

  const safeRadius =
    Math.max(
      1,
      Math.floor(radius)
    );

  const offsets:
    readonly [
      number,
      number,
    ][] = [
      [
        -safeRadius,
        0,
      ],
      [
        safeRadius,
        0,
      ],
      [
        0,
        -safeRadius,
      ],
      [
        0,
        safeRadius,
      ],
      [
        -safeRadius,
        -safeRadius,
      ],
      [
        safeRadius,
        -safeRadius,
      ],
      [
        -safeRadius,
        safeRadius,
      ],
      [
        safeRadius,
        safeRadius,
      ],
    ];

  for (
    const [
      offsetX,
      offsetY,
    ] of offsets
  ) {
    const sampleX =
      candidate.x +
      offsetX;

    const sampleY =
      candidate.y +
      offsetY;

    if (
      sampleX < 0 ||
      sampleY < 0 ||
      sampleX >=
        mask.width ||
      sampleY >=
        mask.height
    ) {
      continue;
    }

    const normal =
      calculateMaskNormalAtPointV3(
        mask,
        sampleX,
        sampleY,
        directionConfig
      );

    if (normal) {
      normals.push(
        normalizeVectorV3(
          normal
        )
      );
    }
  }

  return normals;
}

function calculateNormalVariationV3(
  reference:
    BoundarySubPixelVectorV3,
  normals:
    readonly BoundarySubPixelVectorV3[]
): number {
  if (
    normals.length === 0
  ) {
    return 0;
  }

  let disagreementSum =
    0;

  for (
    const normal of normals
  ) {
    const agreement =
      vectorAgreementV3(
        reference,
        normal
      );

    disagreementSum +=
      1 -
      agreement;
  }

  return clampUnitValue(
    disagreementSum /
    normals.length
  );
}

/* =========================================================
 * Foreground quadrant analysis
 * ======================================================= */

function analyzeForegroundQuadrantsV3(
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  radius:
    number,
  threshold:
    number
): {
  foregroundQuadrants:
    number;

  backgroundQuadrants:
    number;

  mixedQuadrants:
    number;
} {
  const safeRadius =
    Math.max(
      1,
      Math.floor(radius)
    );

  const quadrantForeground = [
    0,
    0,
    0,
    0,
  ];

  const quadrantBackground = [
    0,
    0,
    0,
    0,
  ];

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
        offsetX === 0 &&
        offsetY === 0
      ) {
        continue;
      }

      const sampleX =
        candidate.x +
        offsetX;

      const sampleY =
        candidate.y +
        offsetY;

      if (
        sampleX < 0 ||
        sampleY < 0 ||
        sampleX >=
          mask.width ||
        sampleY >=
          mask.height
      ) {
        continue;
      }

      const quadrant =
        offsetY < 0
          ? (
              offsetX < 0
                ? 0
                : 1
            )
          : (
              offsetX < 0
                ? 2
                : 3
            );

      const value =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              pixelIndexV3(
                sampleX,
                sampleY,
                mask.width
              )
            ],
            0
          )
        );

      if (
        value >=
        threshold
      ) {
        quadrantForeground[
          quadrant
        ] +=
          1;
      } else {
        quadrantBackground[
          quadrant
        ] +=
          1;
      }
    }
  }

  let foregroundQuadrants =
    0;

  let backgroundQuadrants =
    0;

  let mixedQuadrants =
    0;

  for (
    let quadrant =
      0;
    quadrant <
      4;
    quadrant +=
      1
  ) {
    const foreground =
      quadrantForeground[
        quadrant
      ];

    const background =
      quadrantBackground[
        quadrant
      ];

    if (
      foreground > 0 &&
      background > 0
    ) {
      mixedQuadrants +=
        1;
    }

    if (
      foreground >
      background
    ) {
      foregroundQuadrants +=
        1;
    } else if (
      background >
      foreground
    ) {
      backgroundQuadrants +=
        1;
    }
  }

  return {
    foregroundQuadrants,

    backgroundQuadrants,

    mixedQuadrants,
  };
}

/* =========================================================
 * Sharp corner detection
 * ======================================================= */

function detectSharpCornerV3(
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelCornerAnalysisV3 {
  if (
    !config
      .protection
      .protectSharpCorners ||
    !candidate.direction
  ) {
    return {
      detected:
        false,

      directionVariation:
        0,

      foregroundQuadrants:
        0,

      backgroundQuadrants:
        0,

      confidence:
        0,
    };
  }

  const normals =
    collectNeighborNormalsV3(
      mask,
      candidate,
      2,
      config.direction
    );

  const directionVariation =
    calculateNormalVariationV3(
      candidate
        .direction
        .normal,
      normals
    );

  const quadrants =
    analyzeForegroundQuadrantsV3(
      mask,
      candidate,
      2,
      config
        .detection
        .minimumMaskValue
    );

  const quadrantTransitionEvidence =
    clampUnitValue(
      (
        quadrants
          .foregroundQuadrants *
          quadrants
            .backgroundQuadrants
      ) /
      4
    );

  const mixedEvidence =
    clampUnitValue(
      quadrants
        .mixedQuadrants /
      4
    );

  const confidence =
    clampUnitValue(
      directionVariation *
        0.55 +
      quadrantTransitionEvidence *
        0.3 +
      mixedEvidence *
        0.15
    );

  const detected =
    confidence >=
    config
      .protection
      .sharpCornerThreshold;

  return {
    detected,

    directionVariation,

    foregroundQuadrants:
      quadrants
        .foregroundQuadrants,

    backgroundQuadrants:
      quadrants
        .backgroundQuadrants,

    confidence,
  };
}

/* =========================================================
 * Local texture statistics
 * ======================================================= */

type BoundarySubPixelLocalTextureStatisticsV3 = {
  luminanceMean:
    number;

  luminanceVariance:
    number;

  gradientMean:
    number;

  gradientVariance:
    number;

  redVariance:
    number;

  greenVariance:
    number;

  blueVariance:
    number;

  sampleCount:
    number;
};

function calculateLocalTextureStatisticsV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  x:
    number,
  y:
    number,
  radius:
    number
): BoundarySubPixelLocalTextureStatisticsV3 {
  const safeRadius =
    Math.max(
      1,
      Math.floor(radius)
    );

  let luminanceSum =
    0;

  let luminanceSquareSum =
    0;

  let gradientSum =
    0;

  let gradientSquareSum =
    0;

  let redSum =
    0;

  let redSquareSum =
    0;

  let greenSum =
    0;

  let greenSquareSum =
    0;

  let blueSum =
    0;

  let blueSquareSum =
    0;

  let sampleCount =
    0;

  for (
    let offsetY =
      -safeRadius;
    offsetY <=
      safeRadius;
    offsetY +=
      1
  ) {
    const sampleY =
      y +
      offsetY;

    if (
      sampleY < 0 ||
      sampleY >=
        image.height
    ) {
      continue;
    }

    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      const sampleX =
        x +
        offsetX;

      if (
        sampleX < 0 ||
        sampleX >=
          image.width
      ) {
        continue;
      }

      const index =
        pixelIndexV3(
          sampleX,
          sampleY,
          image.width
        );

      const rgbIndex =
        rgbIndexV3(
          index
        );

      const luminance =
        clampUnitValue(
          finiteOrV3(
            image
              .luminance[
                index
              ],
            0
          )
        );

      const gradient =
        clampUnitValue(
          finiteOrV3(
            image
              .gradient[
                index
              ],
            0
          )
        );

      const red =
        clampUnitValue(
          finiteOrV3(
            image.rgb[
              rgbIndex
            ],
            0
          )
        );

      const green =
        clampUnitValue(
          finiteOrV3(
            image.rgb[
              rgbIndex + 1
            ],
            0
          )
        );

      const blue =
        clampUnitValue(
          finiteOrV3(
            image.rgb[
              rgbIndex + 2
            ],
            0
          )
        );

      luminanceSum +=
        luminance;

      luminanceSquareSum +=
        luminance *
        luminance;

      gradientSum +=
        gradient;

      gradientSquareSum +=
        gradient *
        gradient;

      redSum +=
        red;

      redSquareSum +=
        red *
        red;

      greenSum +=
        green;

      greenSquareSum +=
        green *
        green;

      blueSum +=
        blue;

      blueSquareSum +=
        blue *
        blue;

      sampleCount +=
        1;
    }
  }

  if (
    sampleCount <= 0
  ) {
    return {
      luminanceMean:
        0,

      luminanceVariance:
        0,

      gradientMean:
        0,

      gradientVariance:
        0,

      redVariance:
        0,

      greenVariance:
        0,

      blueVariance:
        0,

      sampleCount:
        0,
    };
  }

  const inverseCount =
    1 /
    sampleCount;

  const luminanceMean =
    luminanceSum *
    inverseCount;

  const gradientMean =
    gradientSum *
    inverseCount;

  const redMean =
    redSum *
    inverseCount;

  const greenMean =
    greenSum *
    inverseCount;

  const blueMean =
    blueSum *
    inverseCount;

  return {
    luminanceMean:
      clampUnitValue(
        luminanceMean
      ),

    luminanceVariance:
      Math.max(
        0,
        luminanceSquareSum *
          inverseCount -
        luminanceMean *
          luminanceMean
      ),

    gradientMean:
      clampUnitValue(
        gradientMean
      ),

    gradientVariance:
      Math.max(
        0,
        gradientSquareSum *
          inverseCount -
        gradientMean *
          gradientMean
      ),

    redVariance:
      Math.max(
        0,
        redSquareSum *
          inverseCount -
        redMean *
          redMean
      ),

    greenVariance:
      Math.max(
        0,
        greenSquareSum *
          inverseCount -
        greenMean *
          greenMean
      ),

    blueVariance:
      Math.max(
        0,
        blueSquareSum *
          inverseCount -
        blueMean *
          blueMean
      ),

    sampleCount,
  };
}

/* =========================================================
 * High texture detection
 * ======================================================= */

function detectHighTextureV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelTextureAnalysisV3 {
  if (
    !config
      .protection
      .protectHighTexture
  ) {
    return {
      detected:
        false,

      luminanceVariance:
        0,

      gradientVariance:
        0,

      colorVariance:
        0,

      combinedTexture:
        0,

      confidence:
        0,
    };
  }

  const statistics =
    calculateLocalTextureStatisticsV3(
      image,
      candidate.x,
      candidate.y,
      2
    );

  const luminanceVariance =
    clampUnitValue(
      statistics
        .luminanceVariance *
      12
    );

  const gradientVariance =
    clampUnitValue(
      statistics
        .gradientVariance *
      14
    );

  const colorVariance =
    clampUnitValue(
      (
        statistics
          .redVariance +
        statistics
          .greenVariance +
        statistics
          .blueVariance
      ) /
      3 *
      12
    );

  const combinedTexture =
    clampUnitValue(
      luminanceVariance *
        0.36 +
      gradientVariance *
        0.38 +
      colorVariance *
        0.26
    );

  const confidence =
    smoothStepV3(
      config
        .protection
        .highTextureThreshold *
        0.65,
      config
        .protection
        .highTextureThreshold *
        1.35 +
        0.01,
      combinedTexture
    );

  return {
    detected:
      combinedTexture >=
      config
        .protection
        .highTextureThreshold,

    luminanceVariance,

    gradientVariance,

    colorVariance,

    combinedTexture,

    confidence,
  };
}

/* =========================================================
 * Combined protection
 * ======================================================= */

function combineBoundaryProtectionV3(
  thin:
    BoundarySubPixelThinStructureAnalysisV3,
  corner:
    BoundarySubPixelCornerAnalysisV3,
  texture:
    BoundarySubPixelTextureAnalysisV3,
  color:
    BoundarySubPixelCandidateColorAnalysisV3,
  config:
    BoundarySubPixelProtectionConfigV3
): BoundarySubPixelProtectionV3 {
  let removalReduction =
    0;

  let recoveryReduction =
    0;

  let confidence =
    0;

  if (thin.detected) {
    removalReduction =
      Math.max(
        removalReduction,
        config
          .thinRemovalReduction *
        thin.confidence
      );

    recoveryReduction =
      Math.max(
        recoveryReduction,
        0.12 *
        thin.confidence
      );

    confidence =
      Math.max(
        confidence,
        thin.confidence
      );
  }

  if (corner.detected) {
    removalReduction =
      Math.max(
        removalReduction,
        config
          .cornerRemovalReduction *
        corner.confidence
      );

    recoveryReduction =
      Math.max(
        recoveryReduction,
        0.08 *
        corner.confidence
      );

    confidence =
      Math.max(
        confidence,
        corner.confidence
      );
  }

  if (texture.detected) {
    removalReduction =
      Math.max(
        removalReduction,
        config
          .textureRemovalReduction *
        texture.confidence
      );

    confidence =
      Math.max(
        confidence,
        texture.confidence
      );
  }

  const colorForegroundProtection =
    Math.max(
      color
        .darkForegroundProtection,
      color
        .brightForegroundProtection
    );

  removalReduction =
    Math.max(
      removalReduction,
      colorForegroundProtection *
        0.68
    );

  confidence =
    Math.max(
      confidence,
      colorForegroundProtection
    );

  return {
    thinStructure:
      thin.detected,

    sharpCorner:
      corner.detected,

    highTexture:
      texture.detected,

    removalReduction:
      clampUnitValue(
        removalReduction
      ),

    recoveryReduction:
      clampUnitValue(
        recoveryReduction
      ),

    confidence:
      clampUnitValue(
        confidence
      ),
  };
}

function analyzeCandidateProtectionV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelProtectionV3 {
  const thin =
    detectThinStructureV3(
      mask,
      analysis.candidate,
      config
    );

  const corner =
    detectSharpCornerV3(
      mask,
      analysis.candidate,
      config
    );

  const texture =
    detectHighTextureV3(
      image,
      analysis.candidate,
      config
    );

  return combineBoundaryProtectionV3(
    thin,
    corner,
    texture,
    analysis.color,
    config.protection
  );
}

/* =========================================================
 * Color-side evidence
 * ======================================================= */

function calculateColorForegroundEvidenceV3(
  analysis:
    BoundarySubPixelCandidateColorAnalysisV3
): number {
  const foregroundAdvantage =
    clampUnitValue(
      analysis
        .centerToOutside
        .combined -
      analysis
        .centerToInside
        .combined +
      0.5
    );

  const centeredAdvantage =
    clampUnitValue(
      (
        analysis
          .centerToOutside
          .combined -
        analysis
          .centerToInside
          .combined
      ) *
      2.5 +
      0.5
    );

  return clampUnitValue(
    analysis
      .foregroundSimilarity *
      0.42 +
    foregroundAdvantage *
      0.24 +
    centeredAdvantage *
      0.18 +
    analysis.separation *
      0.16
  );
}

function calculateColorBackgroundEvidenceV3(
  analysis:
    BoundarySubPixelCandidateColorAnalysisV3
): number {
  const backgroundAdvantage =
    clampUnitValue(
      analysis
        .centerToInside
        .combined -
      analysis
        .centerToOutside
        .combined +
      0.5
    );

  const centeredAdvantage =
    clampUnitValue(
      (
        analysis
          .centerToInside
          .combined -
        analysis
          .centerToOutside
          .combined
      ) *
      2.5 +
      0.5
    );

  return clampUnitValue(
    analysis
      .backgroundSimilarity *
      0.44 +
    backgroundAdvantage *
      0.24 +
    centeredAdvantage *
      0.18 +
    analysis.separation *
      0.14
  );
}

/* =========================================================
 * Edge-side evidence
 * ======================================================= */

function calculateEdgeForegroundEvidenceV3(
  analysis:
    BoundarySubPixelCandidateAnalysisV3
): number {
  const subPixelOffset =
    analysis
      .edge
      .subPixel
      .offset;

  /**
   * Normal يشير للخارج.
   *
   * Offset موجب:
   * الحافة الحقيقية أقرب للخارج،
   * وبالتالي البكسل الحالي غالبًا Foreground.
   *
   * Offset سالب:
   * الحافة الحقيقية داخل البكسل،
   * وبالتالي توجد فرصة أكبر أنه تسريب خلفية.
   */
  const offsetEvidence =
    clampUnitValue(
      subPixelOffset /
      2 +
      0.5
    );

  return clampUnitValue(
    analysis
      .edge
      .combinedEvidence *
      0.42 +
    analysis
      .edge
      .normalAlignment *
      0.2 +
    offsetEvidence *
      0.22 +
    analysis
      .mask
      .directionConsistency *
      0.16
  );
}

function calculateEdgeBackgroundEvidenceV3(
  analysis:
    BoundarySubPixelCandidateAnalysisV3
): number {
  const subPixelOffset =
    analysis
      .edge
      .subPixel
      .offset;

  const inwardOffsetEvidence =
    clampUnitValue(
      -subPixelOffset /
      2 +
      0.5
    );

  const weakCenterStrongOutside =
    clampUnitValue(
      analysis
        .edge
        .outsideGradient -
      analysis
        .edge
        .centerGradient +
      0.5
    );

  return clampUnitValue(
    analysis
      .edge
      .combinedEvidence *
      0.38 +
    inwardOffsetEvidence *
      0.26 +
    weakCenterStrongOutside *
      0.14 +
    (
      1 -
      analysis
        .mask
        .directionConsistency
    ) *
      0.22
  );
}

/* =========================================================
 * Original mask evidence
 * ======================================================= */

function calculateOriginalForegroundEvidenceV3(
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelDetectionConfigV3
): number {
  return smoothStepV3(
    config
      .strongBackgroundThreshold,
    config
      .strongForegroundThreshold,
    candidate.originalAlpha
  );
}

function calculateOriginalBackgroundEvidenceV3(
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelDetectionConfigV3
): number {
  return (
    1 -
    calculateOriginalForegroundEvidenceV3(
      candidate,
      config
    )
  );
}

/* =========================================================
 * Candidate-kind priors
 * ======================================================= */

function calculateKindForegroundPriorV3(
  kind:
    BoundarySubPixelCandidateKindV3
): number {
  switch (kind) {
    case 'inner':
      return 0.68;

    case 'outer':
      return 0.28;

    case 'soft':
      return 0.5;

    default:
      return 0.5;
  }
}

function calculateKindBackgroundPriorV3(
  kind:
    BoundarySubPixelCandidateKindV3
): number {
  return (
    1 -
    calculateKindForegroundPriorV3(
      kind
    )
  );
}

/* =========================================================
 * Evidence uncertainty
 * ======================================================= */

function calculateEvidenceUncertaintyV3(
  foreground:
    number,
  background:
    number,
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  protection:
    BoundarySubPixelProtectionV3
): number {
  const decisionCloseness =
    1 -
    clampUnitValue(
      Math.abs(
        foreground -
        background
      ) *
      2
    );

  const colorAmbiguity =
    analysis
      .color
      .ambiguousColor
      ? 1
      : (
          1 -
          analysis
            .color
            .contrastConfidence
        );

  const weakEdge =
    1 -
    analysis
      .edge
      .combinedEvidence;

  const weakDirection =
    1 -
    (
      analysis
        .candidate
        .direction
        ?.confidence ??
      0
    );

  const protectionUncertainty =
    protection.confidence *
    0.35;

  return clampUnitValue(
    decisionCloseness *
      0.38 +
    colorAmbiguity *
      0.22 +
    weakEdge *
      0.16 +
    weakDirection *
      0.14 +
    protectionUncertainty *
      0.1
  );
}

/* =========================================================
 * Evidence fusion
 * ======================================================= */

function fuseCandidateEvidenceV3(
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  protection:
    BoundarySubPixelProtectionV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelFusedEvidenceV3 {
  const colorForeground =
    calculateColorForegroundEvidenceV3(
      analysis.color
    );

  const colorBackground =
    calculateColorBackgroundEvidenceV3(
      analysis.color
    );

  const edgeForeground =
    calculateEdgeForegroundEvidenceV3(
      analysis
    );

  const edgeBackground =
    calculateEdgeBackgroundEvidenceV3(
      analysis
    );

  const originalForeground =
    calculateOriginalForegroundEvidenceV3(
      analysis.candidate,
      config.detection
    );

  const originalBackground =
    calculateOriginalBackgroundEvidenceV3(
      analysis.candidate,
      config.detection
    );

  const kindForeground =
    calculateKindForegroundPriorV3(
      analysis
        .candidate
        .kind
    );

  const kindBackground =
    calculateKindBackgroundPriorV3(
      analysis
        .candidate
        .kind
    );

  const maskForeground =
    clampUnitValue(
      analysis
        .mask
        .foregroundEvidence *
        0.72 +
      kindForeground *
        0.28
    );

  const maskBackground =
    clampUnitValue(
      analysis
        .mask
        .backgroundEvidence *
        0.72 +
      kindBackground *
        0.28
    );

  const totalWeight =
    config
      .decision
      .foregroundWeight +
    config
      .decision
      .backgroundWeight +
    config
      .decision
      .colorWeight +
    config
      .decision
      .edgeWeight +
    config
      .decision
      .originalMaskWeight;

  const safeTotalWeight =
    Math.max(
      SUB_PIXEL_EPSILON_V3,
      totalWeight
    );

  let foreground =
    (
      maskForeground *
        config
          .decision
          .foregroundWeight +
      colorForeground *
        config
          .decision
          .colorWeight +
      edgeForeground *
        config
          .decision
          .edgeWeight +
      originalForeground *
        config
          .decision
          .originalMaskWeight +
      (
        1 -
        maskBackground
      ) *
        config
          .decision
          .backgroundWeight
    ) /
    safeTotalWeight;

  let background =
    (
      maskBackground *
        config
          .decision
          .backgroundWeight +
      colorBackground *
        config
          .decision
          .colorWeight +
      edgeBackground *
        config
          .decision
          .edgeWeight +
      originalBackground *
        config
          .decision
          .originalMaskWeight +
      (
        1 -
        maskForeground
      ) *
        config
          .decision
          .foregroundWeight
    ) /
    safeTotalWeight;

  foreground =
    clampUnitValue(
      foreground
    );

  background =
    clampUnitValue(
      background
    );

  /**
   * الحماية تقلل فقط دليل الحذف.
   * لا نزوّر دليل Foreground، بل نقلل ثقة
   * Background عندما يكون هناك احتمال
   * تركيب رفيع أو زاوية أو Pattern.
   */
  background *=
    1 -
    protection
      .removalReduction;

  foreground *=
    1 -
    protection
      .recoveryReduction;

  foreground =
    clampUnitValue(
      foreground
    );

  background =
    clampUnitValue(
      background
    );

  const uncertainty =
    calculateEvidenceUncertaintyV3(
      foreground,
      background,
      analysis,
      protection
    );

  const signedDecision =
    clampSegmentationValue(
      foreground -
      background,
      -1,
      1
    );

  const decisionMagnitude =
    clampUnitValue(
      Math.abs(
        signedDecision
      )
    );

  const confidenceScale =
    1 -
    uncertainty *
      0.72;

  const removalConfidence =
    signedDecision < 0
      ? clampUnitValue(
          decisionMagnitude *
          confidenceScale +
          background *
          0.28
        )
      : 0;

  const recoveryConfidence =
    signedDecision > 0
      ? clampUnitValue(
          decisionMagnitude *
          confidenceScale +
          foreground *
          0.28
        )
      : 0;

  return {
    foreground,

    background,

    color:
      clampUnitValue(
        Math.max(
          colorForeground,
          colorBackground
        )
      ),

    edge:
      clampUnitValue(
        Math.max(
          edgeForeground,
          edgeBackground
        )
      ),

    originalMask:
      originalForeground,

    uncertainty,

    signedDecision,

    removalConfidence,

    recoveryConfidence,
  };
}

/* =========================================================
 * Decision target helpers
 * ======================================================= */

function calculateRemovalTargetAlphaV3(
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  evidence:
    BoundarySubPixelFusedEvidenceV3,
  protection:
    BoundarySubPixelProtectionV3,
  config:
    BoundarySubPixelRefinerConfigV3
): number {
  const originalAlpha =
    analysis
      .candidate
      .originalAlpha;

  const minimumConfidence =
    config
      .decision
      .minimumRemovalConfidence;

  const strongConfidence =
    config
      .decision
      .strongRemovalConfidence;

  const strength =
    smoothStepV3(
      minimumConfidence,
      strongConfidence,
      evidence
        .removalConfidence
    );

  const maximumReduction =
    config
      .decision
      .maximumAlphaReduction *
    (
      1 -
      protection
        .removalReduction
    );

  const alphaReduction =
    maximumReduction *
    strength;

  let targetAlpha =
    originalAlpha -
    alphaReduction;

  const strongBackgroundTarget =
    config
      .decision
      .maximumStrongBackgroundAlpha;

  if (
    evidence
      .removalConfidence >=
    strongConfidence &&
    protection
      .removalReduction <
      0.35
  ) {
    targetAlpha =
      Math.min(
        targetAlpha,
        lerpV3(
          originalAlpha,
          strongBackgroundTarget,
          strength
        )
      );
  }

  if (
    protection
      .thinStructure ||
    protection
      .sharpCorner
  ) {
    targetAlpha =
      Math.max(
        targetAlpha,
        Math.min(
          originalAlpha,
          config
            .decision
            .minimumProtectedForegroundAlpha
        )
      );
  }

  return clampUnitValue(
    targetAlpha
  );
}

function calculateRecoveryTargetAlphaV3(
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  evidence:
    BoundarySubPixelFusedEvidenceV3,
  protection:
    BoundarySubPixelProtectionV3,
  config:
    BoundarySubPixelRefinerConfigV3
): number {
  const originalAlpha =
    analysis
      .candidate
      .originalAlpha;

  const minimumConfidence =
    config
      .decision
      .minimumRecoveryConfidence;

  const strongConfidence =
    config
      .decision
      .strongRecoveryConfidence;

  const strength =
    smoothStepV3(
      minimumConfidence,
      strongConfidence,
      evidence
        .recoveryConfidence
    );

  const maximumIncrease =
    config
      .decision
      .maximumAlphaIncrease *
    (
      1 -
      protection
        .recoveryReduction
    );

  const insideReference =
    analysis
      .samples
      .inside
      .aggregate
      .maskValue;

  const evidenceTarget =
    lerpV3(
      originalAlpha,
      Math.max(
        originalAlpha,
        insideReference
      ),
      strength
    );

  return clampUnitValue(
    Math.min(
      originalAlpha +
        maximumIncrease *
        strength,
      evidenceTarget
    )
  );
}

function calculateSoftenedTargetAlphaV3(
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  evidence:
    BoundarySubPixelFusedEvidenceV3
): number {
  const originalAlpha =
    analysis
      .candidate
      .originalAlpha;

  const insideAlpha =
    analysis
      .samples
      .inside
      .aggregate
      .maskValue;

  const outsideAlpha =
    analysis
      .samples
      .outside
      .aggregate
      .maskValue;

  const transitionAlpha =
    clampUnitValue(
      (
        insideAlpha +
        outsideAlpha
      ) *
      0.5
    );

  const uncertaintyStrength =
    clampUnitValue(
      evidence.uncertainty
    );

  return clampUnitValue(
    lerpV3(
      originalAlpha,
      transitionAlpha,
      uncertaintyStrength *
        0.35
    )
  );
}

/* =========================================================
 * Rejected decision
 * ======================================================= */

function createRejectedDecisionV3(
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  reason:
    string
): BoundarySubPixelDecisionV3 {
  const originalAlpha =
    analysis
      .candidate
      .originalAlpha;

  return {
    kind:
      'reject',

    originalAlpha,

    targetAlpha:
      originalAlpha,

    finalAlpha:
      originalAlpha,

    confidence:
      0,

    subPixelOffset:
      analysis
        .edge
        .subPixel
        .offset,

    evidence: {
      foreground:
        0,

      background:
        0,

      color:
        0,

      edge:
        0,

      originalMask:
        originalAlpha,

      uncertainty:
        1,
    },

    protection: {
      thinStructure:
        false,

      sharpCorner:
        false,

      highTexture:
        false,

      removalReduction:
        0,

      recoveryReduction:
        0,

      confidence:
        0,
    },

    reason,
  };
}

/* =========================================================
 * Candidate decision
 * ======================================================= */

function decideBoundaryCandidateV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  analysis:
    BoundarySubPixelCandidateAnalysisV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelDecisionV3 {
  if (!analysis.valid) {
    return createRejectedDecisionV3(
      analysis,
      analysis
        .rejectionReason ??
      'candidate-analysis-invalid'
    );
  }

  const protection =
    analyzeCandidateProtectionV3(
      image,
      mask,
      analysis,
      config
    );

  const fused =
    fuseCandidateEvidenceV3(
      analysis,
      protection,
      config
    );

  const originalAlpha =
    analysis
      .candidate
      .originalAlpha;

  const commonEvidence:
    BoundarySubPixelEvidenceV3 = {
      foreground:
        fused.foreground,

      background:
        fused.background,

      color:
        fused.color,

      edge:
        fused.edge,

      originalMask:
        fused.originalMask,

      uncertainty:
        fused.uncertainty,
    };

  const uncertaintyLimit =
    config
      .decision
      .uncertaintyMargin;

  const decisionDifference =
    Math.abs(
      fused.foreground -
      fused.background
    );

  const isUncertain =
    decisionDifference <
      uncertaintyLimit ||
    fused.uncertainty >
      0.72;

  if (isUncertain) {
    switch (
      config
        .decision
        .uncertainPolicy
    ) {
      case 'unchanged':
        return {
          kind:
            'unchanged',

          originalAlpha,

          targetAlpha:
            originalAlpha,

          finalAlpha:
            originalAlpha,

          confidence:
            1 -
            fused.uncertainty,

          subPixelOffset:
            analysis
              .edge
              .subPixel
              .offset,

          evidence:
            commonEvidence,

          protection,

          reason:
            'uncertain-evidence-left-unchanged',
        };

      case 'soft-preserve': {
        const softened =
          calculateSoftenedTargetAlphaV3(
            analysis,
            fused
          );

        const preserved =
          lerpV3(
            softened,
            originalAlpha,
            config
              .decision
              .uncertaintyProtection
          );

        return {
          kind:
            'soften',

          originalAlpha,

          targetAlpha:
            softened,

          finalAlpha:
            clampUnitValue(
              preserved
            ),

          confidence:
            1 -
            fused.uncertainty,

          subPixelOffset:
            analysis
              .edge
              .subPixel
              .offset,

          evidence:
            commonEvidence,

          protection,

          reason:
            'uncertain-evidence-soft-preserved',
        };
      }

      case 'preserve':
      default:
        return {
          kind:
            'preserve',

          originalAlpha,

          targetAlpha:
            originalAlpha,

          finalAlpha:
            originalAlpha,

          confidence:
            1 -
            fused.uncertainty,

          subPixelOffset:
            analysis
              .edge
              .subPixel
              .offset,

          evidence:
            commonEvidence,

          protection,

          reason:
            'uncertain-evidence-preserved',
        };
    }
  }

  if (
    fused.background >
      fused.foreground &&
    fused.removalConfidence >=
      config
        .decision
        .minimumRemovalConfidence
  ) {
    const targetAlpha =
      calculateRemovalTargetAlphaV3(
        analysis,
        fused,
        protection,
        config
      );

    return {
      kind:
        'remove-leak',

      originalAlpha,

      targetAlpha,

      finalAlpha:
        targetAlpha,

      confidence:
        fused
          .removalConfidence,

      subPixelOffset:
        analysis
          .edge
          .subPixel
          .offset,

      evidence:
        commonEvidence,

      protection,

      reason:
        protection
          .removalReduction >
          0.45
          ? 'background-evidence-with-protection'
          : 'background-evidence-dominant',
    };
  }

  if (
    fused.foreground >
      fused.background &&
    fused.recoveryConfidence >=
      config
        .decision
        .minimumRecoveryConfidence
  ) {
    const targetAlpha =
      calculateRecoveryTargetAlphaV3(
        analysis,
        fused,
        protection,
        config
      );

    return {
      kind:
        'recover-foreground',

      originalAlpha,

      targetAlpha,

      finalAlpha:
        targetAlpha,

      confidence:
        fused
          .recoveryConfidence,

      subPixelOffset:
        analysis
          .edge
          .subPixel
          .offset,

      evidence:
        commonEvidence,

      protection,

      reason:
        'foreground-evidence-dominant',
    };
  }

  if (
    analysis
      .candidate
      .kind ===
      'soft' &&
    analysis
      .edge
      .combinedEvidence >=
      0.45
  ) {
    const targetAlpha =
      calculateSoftenedTargetAlphaV3(
        analysis,
        fused
      );

    return {
      kind:
        'soften',

      originalAlpha,

      targetAlpha,

      finalAlpha:
        targetAlpha,

      confidence:
        clampUnitValue(
          analysis
            .edge
            .combinedEvidence *
            0.55 +
          analysis
            .color
            .contrastConfidence *
            0.45
        ),

      subPixelOffset:
        analysis
          .edge
          .subPixel
          .offset,

      evidence:
        commonEvidence,

      protection,

      reason:
        'soft-boundary-refined',
    };
  }

  return {
    kind:
      'preserve',

    originalAlpha,

    targetAlpha:
      originalAlpha,

    finalAlpha:
      originalAlpha,

    confidence:
      clampUnitValue(
        Math.max(
          fused.foreground,
          fused.background
        ) *
        (
          1 -
          fused.uncertainty
        )
      ),

    subPixelOffset:
      analysis
        .edge
        .subPixel
        .offset,

    evidence:
      commonEvidence,

    protection,

    reason:
      'insufficient-confidence-for-safe-change',
  };
}

/* =========================================================
 * Batch decision
 * ======================================================= */

function decideBoundaryCandidatesV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  analyses:
    readonly BoundarySubPixelCandidateAnalysisV3[],
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelDecisionV3[] {
  const decisions:
    BoundarySubPixelDecisionV3[] =
      new Array(
        analyses.length
      );

  for (
    let index =
      0;
    index <
      analyses.length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    decisions[index] =
      decideBoundaryCandidateV3(
        image,
        mask,
        analyses[index],
        config
      );
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return decisions;
}

/* =========================================================
 * Part 3B internal references
 * ======================================================= */

const BOUNDARY_SUB_PIXEL_PART_3B_INTERNALS_V3 = {
  sampleMaskAlongDirectionV3,

  findForegroundRunLengthV3,

  findBackgroundRunLengthV3,

  calculateThinStructureConnectivityV3,

  detectThinStructureV3,

  calculateMaskNormalAtPointV3,

  collectNeighborNormalsV3,

  calculateNormalVariationV3,

  analyzeForegroundQuadrantsV3,

  detectSharpCornerV3,

  calculateLocalTextureStatisticsV3,

  detectHighTextureV3,

  combineBoundaryProtectionV3,

  analyzeCandidateProtectionV3,

  calculateColorForegroundEvidenceV3,

  calculateColorBackgroundEvidenceV3,

  calculateEdgeForegroundEvidenceV3,

  calculateEdgeBackgroundEvidenceV3,

  calculateOriginalForegroundEvidenceV3,

  calculateOriginalBackgroundEvidenceV3,

  calculateKindForegroundPriorV3,

  calculateKindBackgroundPriorV3,

  calculateEvidenceUncertaintyV3,

  fuseCandidateEvidenceV3,

  calculateRemovalTargetAlphaV3,

  calculateRecoveryTargetAlphaV3,

  calculateSoftenedTargetAlphaV3,

  createRejectedDecisionV3,

  decideBoundaryCandidateV3,

  decideBoundaryCandidatesV3,
};

void BOUNDARY_SUB_PIXEL_PART_3B_INTERNALS_V3;

// End of Part 3B/4
// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 4A-1
//
// يكمل مباشرة بعد:
//
// // End of Part 3B/4
//
// هذا الجزء مسؤول عن:
//
// 1) ربط كل Decision بالـCandidate الخاص بها.
// 2) تحويل القرار إلى Alpha مقترح.
// 3) منع الكتابة المباشرة أثناء تحليل نفس التمريرة.
// 4) حل تعارض القرارات التي تستهدف البكسل نفسه.
// 5) حماية التغييرات الصغيرة وغير الموثوقة.
// 6) تجهيز Mask Update Plan.
// 7) تجميع Diagnostics الخاصة بالقرارات.
//
// الجزء التالي Part 4A-2 سيقوم بـ:
//
// - تطبيق خطة التعديل على نسخة جديدة من الماسك.
// - Edge consistency pass.
// - إزالة isolated alpha changes.
// - التحقق من أن التعديل لم يغيّر قلب القطعة.

/* =========================================================
 * Update-plan contracts
 * ======================================================= */

type BoundarySubPixelPlannedUpdateKindV3 =
  | 'reduce-alpha'
  | 'increase-alpha'
  | 'soft-adjust'
  | 'preserve'
  | 'unchanged'
  | 'rejected';

type BoundarySubPixelPlannedUpdateV3 = {
  index:
    number;

  x:
    number;

  y:
    number;

  candidateKind:
    BoundarySubPixelCandidateKindV3;

  decisionKind:
    BoundarySubPixelDecisionKindV3;

  updateKind:
    BoundarySubPixelPlannedUpdateKindV3;

  originalAlpha:
    number;

  requestedAlpha:
    number;

  resolvedAlpha:
    number;

  absoluteChange:
    number;

  signedChange:
    number;

  confidence:
    number;

  uncertainty:
    number;

  priority:
    number;

  subPixelOffset:
    number;

  protectedThinStructure:
    boolean;

  protectedSharpCorner:
    boolean;

  protectedHighTexture:
    boolean;

  reason:
    string;
};

type BoundarySubPixelUpdateConflictV3 = {
  index:
    number;

  updateCount:
    number;

  reductionCount:
    number;

  increaseCount:
    number;

  softCount:
    number;

  preserveCount:
    number;

  selectedPriority:
    number;

  selectedConfidence:
    number;

  resolvedAlpha:
    number;
};

type BoundarySubPixelUpdatePlanV3 = {
  updates:
    readonly BoundarySubPixelPlannedUpdateV3[];

  conflicts:
    readonly BoundarySubPixelUpdateConflictV3[];

  updateByPixel:
    ReadonlyMap<
      number,
      BoundarySubPixelPlannedUpdateV3
    >;

  requestedUpdateCount:
    number;

  resolvedUpdateCount:
    number;

  conflictCount:
    number;

  reductionCount:
    number;

  increaseCount:
    number;

  softAdjustmentCount:
    number;

  preserveCount:
    number;

  rejectedCount:
    number;
};

type BoundarySubPixelDecisionStatisticsV3 = {
  total:
    number;

  removeLeak:
    number;

  recoverForeground:
    number;

  soften:
    number;

  preserve:
    number;

  unchanged:
    number;

  reject:
    number;

  protectedThin:
    number;

  protectedCorner:
    number;

  protectedTexture:
    number;

  averageConfidence:
    number;

  averageUncertainty:
    number;

  averageRequestedChange:
    number;

  maximumRequestedChange:
    number;
};

/* =========================================================
 * Decision/update mapping
 * ======================================================= */

function mapDecisionKindToUpdateKindV3(
  kind:
    BoundarySubPixelDecisionKindV3
): BoundarySubPixelPlannedUpdateKindV3 {
  switch (kind) {
    case 'remove-leak':
      return 'reduce-alpha';

    case 'recover-foreground':
      return 'increase-alpha';

    case 'soften':
      return 'soft-adjust';

    case 'preserve':
      return 'preserve';

    case 'unchanged':
      return 'unchanged';

    case 'reject':
    default:
      return 'rejected';
  }
}

/* =========================================================
 * Priority calculation
 * ======================================================= */

function calculateDecisionKindPriorityV3(
  kind:
    BoundarySubPixelDecisionKindV3
): number {
  switch (kind) {
    case 'remove-leak':
      return 1;

    case 'recover-foreground':
      return 0.92;

    case 'soften':
      return 0.72;

    case 'preserve':
      return 0.48;

    case 'unchanged':
      return 0.32;

    case 'reject':
    default:
      return 0;
  }
}

function calculateCandidateKindPriorityV3(
  kind:
    BoundarySubPixelCandidateKindV3
): number {
  switch (kind) {
    case 'inner':
      return 1;

    case 'soft':
      return 0.88;

    case 'outer':
      return 0.72;

    default:
      return 0.5;
  }
}

function calculateProtectionPenaltyV3(
  decision:
    BoundarySubPixelDecisionV3
): number {
  const protection =
    decision.protection;

  let penalty =
    0;

  if (
    decision.kind ===
      'remove-leak'
  ) {
    penalty =
      Math.max(
        penalty,
        protection
          .removalReduction
      );
  }

  if (
    decision.kind ===
      'recover-foreground'
  ) {
    penalty =
      Math.max(
        penalty,
        protection
          .recoveryReduction
      );
  }

  if (
    protection
      .thinStructure
  ) {
    penalty =
      Math.max(
        penalty,
        0.2
      );
  }

  if (
    protection
      .sharpCorner
  ) {
    penalty =
      Math.max(
        penalty,
        0.14
      );
  }

  if (
    protection
      .highTexture
  ) {
    penalty =
      Math.max(
        penalty,
        0.1
      );
  }

  return clampUnitValue(
    penalty
  );
}

function calculatePlannedUpdatePriorityV3(
  candidate:
    BoundarySubPixelCandidateV3,
  decision:
    BoundarySubPixelDecisionV3
): number {
  const decisionPriority =
    calculateDecisionKindPriorityV3(
      decision.kind
    );

  const candidatePriority =
    calculateCandidateKindPriorityV3(
      candidate.kind
    );

  const confidence =
    clampUnitValue(
      decision.confidence
    );

  const certainty =
    1 -
    clampUnitValue(
      decision
        .evidence
        .uncertainty
    );

  const changeMagnitude =
    clampUnitValue(
      Math.abs(
        decision.finalAlpha -
        decision.originalAlpha
      )
    );

  const directionConfidence =
    candidate
      .direction
      ?.confidence ??
    0;

  const subPixelEvidence =
    clampUnitValue(
      Math.abs(
        decision.subPixelOffset
      ) /
      1.5
    );

  const protectionPenalty =
    calculateProtectionPenaltyV3(
      decision
    );

  const basePriority =
    decisionPriority *
      0.28 +
    candidatePriority *
      0.12 +
    confidence *
      0.24 +
    certainty *
      0.14 +
    changeMagnitude *
      0.08 +
    directionConfidence *
      0.08 +
    subPixelEvidence *
      0.06;

  return clampUnitValue(
    basePriority *
    (
      1 -
      protectionPenalty *
        0.42
    )
  );
}

/* =========================================================
 * Alpha sanitization
 * ======================================================= */

function sanitizePlannedAlphaV3(
  originalAlpha:
    number,
  requestedAlpha:
    number,
  decision:
    BoundarySubPixelDecisionV3,
  config:
    BoundarySubPixelRefinerConfigV3
): number {
  const original =
    clampUnitValue(
      originalAlpha
    );

  let requested =
    clampUnitValue(
      requestedAlpha
    );

  switch (decision.kind) {
    case 'remove-leak': {
      const maximumReduction =
        config
          .decision
          .maximumAlphaReduction *
        (
          1 -
          decision
            .protection
            .removalReduction
        );

      const minimumAllowed =
        Math.max(
          0,
          original -
          maximumReduction
        );

      requested =
        clampSegmentationValue(
          requested,
          minimumAllowed,
          original
        );

      if (
        decision
          .protection
          .thinStructure ||
        decision
          .protection
          .sharpCorner
      ) {
        requested =
          Math.max(
            requested,
            Math.min(
              original,
              config
                .decision
                .minimumProtectedForegroundAlpha
            )
          );
      }

      break;
    }

    case 'recover-foreground': {
      const maximumIncrease =
        config
          .decision
          .maximumAlphaIncrease *
        (
          1 -
          decision
            .protection
            .recoveryReduction
        );

      const maximumAllowed =
        Math.min(
          1,
          original +
          maximumIncrease
        );

      requested =
        clampSegmentationValue(
          requested,
          original,
          maximumAllowed
        );

      break;
    }

    case 'soften': {
      /**
       * Soft adjustment لا يجب أن يقفز
       * بقيمة Alpha أكثر من نصف الحدين.
       */
      const maximumReduction =
        config
          .decision
          .maximumAlphaReduction *
        0.5;

      const maximumIncrease =
        config
          .decision
          .maximumAlphaIncrease *
        0.5;

      requested =
        clampSegmentationValue(
          requested,
          Math.max(
            0,
            original -
            maximumReduction
          ),
          Math.min(
            1,
            original +
            maximumIncrease
          )
        );

      break;
    }

    case 'preserve':
    case 'unchanged':
    case 'reject':
    default:
      requested =
        original;

      break;
  }

  return clampUnitValue(
    requested
  );
}

/* =========================================================
 * Candidate decision to update
 * ======================================================= */

function createPlannedUpdateV3(
  candidate:
    BoundarySubPixelCandidateV3,
  decision:
    BoundarySubPixelDecisionV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelPlannedUpdateV3 {
  const originalAlpha =
    clampUnitValue(
      candidate.originalAlpha
    );

  const requestedAlpha =
    sanitizePlannedAlphaV3(
      originalAlpha,
      decision.finalAlpha,
      decision,
      config
    );

  const signedChange =
    requestedAlpha -
    originalAlpha;

  return {
    index:
      candidate.index,

    x:
      candidate.x,

    y:
      candidate.y,

    candidateKind:
      candidate.kind,

    decisionKind:
      decision.kind,

    updateKind:
      mapDecisionKindToUpdateKindV3(
        decision.kind
      ),

    originalAlpha,

    requestedAlpha,

    resolvedAlpha:
      requestedAlpha,

    absoluteChange:
      Math.abs(
        signedChange
      ),

    signedChange,

    confidence:
      clampUnitValue(
        decision.confidence
      ),

    uncertainty:
      clampUnitValue(
        decision
          .evidence
          .uncertainty
      ),

    priority:
      calculatePlannedUpdatePriorityV3(
        candidate,
        decision
      ),

    subPixelOffset:
      finiteOrV3(
        decision.subPixelOffset,
        0
      ),

    protectedThinStructure:
      decision
        .protection
        .thinStructure,

    protectedSharpCorner:
      decision
        .protection
        .sharpCorner,

    protectedHighTexture:
      decision
        .protection
        .highTexture,

    reason:
      decision.reason,
  };
}

/* =========================================================
 * Update classification
 * ======================================================= */

function isReductionUpdateV3(
  update:
    BoundarySubPixelPlannedUpdateV3
): boolean {
  return (
    update.updateKind ===
      'reduce-alpha' &&
    update.signedChange <
      -SUB_PIXEL_EPSILON_V3
  );
}

function isIncreaseUpdateV3(
  update:
    BoundarySubPixelPlannedUpdateV3
): boolean {
  return (
    update.updateKind ===
      'increase-alpha' &&
    update.signedChange >
      SUB_PIXEL_EPSILON_V3
  );
}

function isSoftUpdateV3(
  update:
    BoundarySubPixelPlannedUpdateV3
): boolean {
  return (
    update.updateKind ===
      'soft-adjust' &&
    update.absoluteChange >
      SUB_PIXEL_EPSILON_V3
  );
}

function isNonChangingUpdateV3(
  update:
    BoundarySubPixelPlannedUpdateV3
): boolean {
  return (
    update.absoluteChange <=
      SUB_PIXEL_EPSILON_V3 ||
    update.updateKind ===
      'preserve' ||
    update.updateKind ===
      'unchanged' ||
    update.updateKind ===
      'rejected'
  );
}

/* =========================================================
 * Conflict comparison
 * ======================================================= */

function comparePlannedUpdatesV3(
  first:
    BoundarySubPixelPlannedUpdateV3,
  second:
    BoundarySubPixelPlannedUpdateV3
): number {
  if (
    Math.abs(
      first.priority -
      second.priority
    ) >
    SUB_PIXEL_EPSILON_V3
  ) {
    return (
      second.priority -
      first.priority
    );
  }

  if (
    Math.abs(
      first.confidence -
      second.confidence
    ) >
    SUB_PIXEL_EPSILON_V3
  ) {
    return (
      second.confidence -
      first.confidence
    );
  }

  if (
    Math.abs(
      first.uncertainty -
      second.uncertainty
    ) >
    SUB_PIXEL_EPSILON_V3
  ) {
    return (
      first.uncertainty -
      second.uncertainty
    );
  }

  if (
    Math.abs(
      first.absoluteChange -
      second.absoluteChange
    ) >
    SUB_PIXEL_EPSILON_V3
  ) {
    return (
      second.absoluteChange -
      first.absoluteChange
    );
  }

  return (
    first.index -
    second.index
  );
}

/* =========================================================
 * Compatible update blending
 * ======================================================= */

function calculateUpdateBlendWeightV3(
  update:
    BoundarySubPixelPlannedUpdateV3
): number {
  const certainty =
    1 -
    update.uncertainty;

  return Math.max(
    SUB_PIXEL_EPSILON_V3,
    update.priority *
      0.4 +
    update.confidence *
      0.35 +
    certainty *
      0.2 +
    update.absoluteChange *
      0.05
  );
}

function blendCompatibleUpdatesV3(
  updates:
    readonly BoundarySubPixelPlannedUpdateV3[],
  originalAlpha:
    number
): number {
  if (
    updates.length === 0
  ) {
    return clampUnitValue(
      originalAlpha
    );
  }

  let weightedAlpha =
    0;

  let totalWeight =
    0;

  for (
    const update of updates
  ) {
    const weight =
      calculateUpdateBlendWeightV3(
        update
      );

    weightedAlpha +=
      update.requestedAlpha *
      weight;

    totalWeight +=
      weight;
  }

  if (
    totalWeight <=
    SUB_PIXEL_EPSILON_V3
  ) {
    return clampUnitValue(
      updates[0]
        .requestedAlpha
    );
  }

  return clampUnitValue(
    weightedAlpha /
    totalWeight
  );
}

/* =========================================================
 * Opposing update resolution
 * ======================================================= */

function calculateGroupStrengthV3(
  updates:
    readonly BoundarySubPixelPlannedUpdateV3[]
): number {
  if (
    updates.length === 0
  ) {
    return 0;
  }

  let strength =
    0;

  for (
    const update of updates
  ) {
    strength +=
      update.priority *
        0.38 +
      update.confidence *
        0.34 +
      (
        1 -
        update.uncertainty
      ) *
        0.2 +
      update.absoluteChange *
        0.08;
  }

  return strength /
    updates.length;
}

function resolveOpposingUpdateGroupsV3(
  reductions:
    readonly BoundarySubPixelPlannedUpdateV3[],
  increases:
    readonly BoundarySubPixelPlannedUpdateV3[],
  soft:
    readonly BoundarySubPixelPlannedUpdateV3[],
  originalAlpha:
    number,
  config:
    BoundarySubPixelRefinerConfigV3
): {
  alpha:
    number;

  selected:
    BoundarySubPixelPlannedUpdateV3;

  conflict:
    boolean;
} {
  const allChanging = [
    ...reductions,
    ...increases,
    ...soft,
  ].sort(
    comparePlannedUpdatesV3
  );

  const fallback =
    allChanging[0];

  if (!fallback) {
    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      'BoundarySubPixelRefinerV3 could not resolve an empty update conflict.',
      {
        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  if (
    reductions.length > 0 &&
    increases.length === 0
  ) {
    return {
      alpha:
        blendCompatibleUpdatesV3(
          reductions,
          originalAlpha
        ),

      selected:
        reductions
          .slice()
          .sort(
            comparePlannedUpdatesV3
          )[0],

      conflict:
        reductions.length > 1,
    };
  }

  if (
    increases.length > 0 &&
    reductions.length === 0
  ) {
    return {
      alpha:
        blendCompatibleUpdatesV3(
          increases,
          originalAlpha
        ),

      selected:
        increases
          .slice()
          .sort(
            comparePlannedUpdatesV3
          )[0],

      conflict:
        increases.length > 1,
    };
  }

  if (
    reductions.length === 0 &&
    increases.length === 0 &&
    soft.length > 0
  ) {
    return {
      alpha:
        blendCompatibleUpdatesV3(
          soft,
          originalAlpha
        ),

      selected:
        soft
          .slice()
          .sort(
            comparePlannedUpdatesV3
          )[0],

      conflict:
        soft.length > 1,
    };
  }

  const reductionStrength =
    calculateGroupStrengthV3(
      reductions
    );

  const increaseStrength =
    calculateGroupStrengthV3(
      increases
    );

  const strengthDifference =
    Math.abs(
      reductionStrength -
      increaseStrength
    );

  const uncertaintyMargin =
    Math.max(
      0.02,
      config
        .decision
        .uncertaintyMargin
    );

  /**
   * عند تعارض حقيقي وقوة الفريقين متقاربة،
   * نحافظ على Alpha الأصلي بدل المخاطرة
   * بحذف جزء صحيح أو استعادة خلفية.
   */
  if (
    strengthDifference <
    uncertaintyMargin
  ) {
    const best =
      allChanging[0];

    return {
      alpha:
        clampUnitValue(
          lerpV3(
            originalAlpha,
            best.requestedAlpha,
            0.12
          )
        ),

      selected:
        {
          ...best,

          updateKind:
            'preserve',

          decisionKind:
            'preserve',

          reason:
            'opposing-updates-preserved',
        },

      conflict:
        true,
    };
  }

  if (
    reductionStrength >
    increaseStrength
  ) {
    const selectedReduction =
      reductions
        .slice()
        .sort(
          comparePlannedUpdatesV3
        )[0];

    const blended =
      blendCompatibleUpdatesV3(
        reductions,
        originalAlpha
      );

    const dominance =
      clampUnitValue(
        safeDivideV3(
          reductionStrength -
            increaseStrength,
          Math.max(
            reductionStrength,
            increaseStrength
          ),
          0
        )
      );

    return {
      alpha:
        clampUnitValue(
          lerpV3(
            originalAlpha,
            blended,
            0.55 +
              dominance *
              0.45
          )
        ),

      selected:
        selectedReduction,

      conflict:
        true,
    };
  }

  const selectedIncrease =
    increases
      .slice()
      .sort(
        comparePlannedUpdatesV3
      )[0];

  const blended =
    blendCompatibleUpdatesV3(
      increases,
      originalAlpha
    );

  const dominance =
    clampUnitValue(
      safeDivideV3(
        increaseStrength -
          reductionStrength,
        Math.max(
          reductionStrength,
          increaseStrength
        ),
        0
      )
    );

  return {
    alpha:
      clampUnitValue(
        lerpV3(
          originalAlpha,
          blended,
          0.5 +
            dominance *
            0.5
        )
      ),

    selected:
      selectedIncrease,

    conflict:
      true,
  };
}

/* =========================================================
 * Pixel conflict resolution
 * ======================================================= */

function resolvePixelUpdatesV3(
  updates:
    readonly BoundarySubPixelPlannedUpdateV3[],
  config:
    BoundarySubPixelRefinerConfigV3
): {
  update:
    BoundarySubPixelPlannedUpdateV3;

  conflict:
    BoundarySubPixelUpdateConflictV3 | null;
} {
  if (
    updates.length === 0
  ) {
    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      'BoundarySubPixelRefinerV3 received an empty update group.',
      {
        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  if (
    updates.length === 1
  ) {
    return {
      update:
        updates[0],

      conflict:
        null,
    };
  }

  const originalAlpha =
    clampUnitValue(
      updates[0]
        .originalAlpha
    );

  const reductions =
    updates.filter(
      isReductionUpdateV3
    );

  const increases =
    updates.filter(
      isIncreaseUpdateV3
    );

  const soft =
    updates.filter(
      isSoftUpdateV3
    );

  const preserves =
    updates.filter(
      isNonChangingUpdateV3
    );

  const resolution =
    resolveOpposingUpdateGroupsV3(
      reductions,
      increases,
      soft,
      originalAlpha,
      config
    );

  const selected =
    resolution.selected;

  const resolvedAlpha =
    clampUnitValue(
      resolution.alpha
    );

  const signedChange =
    resolvedAlpha -
    originalAlpha;

  const resolvedUpdate:
    BoundarySubPixelPlannedUpdateV3 = {
      ...selected,

      originalAlpha,

      resolvedAlpha,

      requestedAlpha:
        selected
          .requestedAlpha,

      signedChange,

      absoluteChange:
        Math.abs(
          signedChange
        ),

      updateKind:
        signedChange <
          -SUB_PIXEL_EPSILON_V3
          ? 'reduce-alpha'
          : signedChange >
              SUB_PIXEL_EPSILON_V3
            ? 'increase-alpha'
            : selected
                .updateKind ===
                'soft-adjust'
              ? 'soft-adjust'
              : 'preserve',
  };

  return {
    update:
      resolvedUpdate,

    conflict: {
      index:
        selected.index,

      updateCount:
        updates.length,

      reductionCount:
        reductions.length,

      increaseCount:
        increases.length,

      softCount:
        soft.length,

      preserveCount:
        preserves.length,

      selectedPriority:
        selected.priority,

      selectedConfidence:
        selected.confidence,

      resolvedAlpha,
    },
  };
}

/* =========================================================
 * Decision statistics
 * ======================================================= */

function calculateDecisionStatisticsV3(
  decisions:
    readonly BoundarySubPixelDecisionV3[]
): BoundarySubPixelDecisionStatisticsV3 {
  const result:
    BoundarySubPixelDecisionStatisticsV3 = {
      total:
        decisions.length,

      removeLeak:
        0,

      recoverForeground:
        0,

      soften:
        0,

      preserve:
        0,

      unchanged:
        0,

      reject:
        0,

      protectedThin:
        0,

      protectedCorner:
        0,

      protectedTexture:
        0,

      averageConfidence:
        0,

      averageUncertainty:
        0,

      averageRequestedChange:
        0,

      maximumRequestedChange:
        0,
    };

  if (
    decisions.length === 0
  ) {
    return result;
  }

  let confidenceSum =
    0;

  let uncertaintySum =
    0;

  let changeSum =
    0;

  for (
    const decision of decisions
  ) {
    switch (decision.kind) {
      case 'remove-leak':
        result.removeLeak +=
          1;
        break;

      case 'recover-foreground':
        result.recoverForeground +=
          1;
        break;

      case 'soften':
        result.soften +=
          1;
        break;

      case 'preserve':
        result.preserve +=
          1;
        break;

      case 'unchanged':
        result.unchanged +=
          1;
        break;

      case 'reject':
      default:
        result.reject +=
          1;
        break;
    }

    if (
      decision
        .protection
        .thinStructure
    ) {
      result.protectedThin +=
        1;
    }

    if (
      decision
        .protection
        .sharpCorner
    ) {
      result.protectedCorner +=
        1;
    }

    if (
      decision
        .protection
        .highTexture
    ) {
      result.protectedTexture +=
        1;
    }

    const confidence =
      clampUnitValue(
        decision.confidence
      );

    const uncertainty =
      clampUnitValue(
        decision
          .evidence
          .uncertainty
      );

    const requestedChange =
      Math.abs(
        decision.finalAlpha -
        decision.originalAlpha
      );

    confidenceSum +=
      confidence;

    uncertaintySum +=
      uncertainty;

    changeSum +=
      requestedChange;

    result.maximumRequestedChange =
      Math.max(
        result
          .maximumRequestedChange,
        requestedChange
      );
  }

  result.averageConfidence =
    confidenceSum /
    decisions.length;

  result.averageUncertainty =
    uncertaintySum /
    decisions.length;

  result.averageRequestedChange =
    changeSum /
    decisions.length;

  return result;
}

/* =========================================================
 * Group updates by pixel
 * ======================================================= */

function groupPlannedUpdatesByPixelV3(
  updates:
    readonly BoundarySubPixelPlannedUpdateV3[]
): Map<
  number,
  BoundarySubPixelPlannedUpdateV3[]
> {
  const grouped =
    new Map<
      number,
      BoundarySubPixelPlannedUpdateV3[]
    >();

  for (
    const update of updates
  ) {
    const existing =
      grouped.get(
        update.index
      );

    if (existing) {
      existing.push(
        update
      );
    } else {
      grouped.set(
        update.index,
        [
          update,
        ]
      );
    }
  }

  return grouped;
}

/* =========================================================
 * Create raw update list
 * ======================================================= */

function createRawPlannedUpdatesV3(
  analyses:
    readonly BoundarySubPixelCandidateAnalysisV3[],
  decisions:
    readonly BoundarySubPixelDecisionV3[],
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelPlannedUpdateV3[] {
  if (
    analyses.length !==
    decisions.length
  ) {
    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      'BoundarySubPixelRefinerV3 analysis and decision counts do not match.',
      {
        stage:
          'refine-alpha-mask',

        retryable:
          false,

        metadata: {
          analysisCount:
            analyses.length,

          decisionCount:
            decisions.length,
        },
      }
    );
  }

  const updates:
    BoundarySubPixelPlannedUpdateV3[] =
      new Array(
        decisions.length
      );

  for (
    let index =
      0;
    index <
      decisions.length;
    index +=
      1
  ) {
    updates[index] =
      createPlannedUpdateV3(
        analyses[index]
          .candidate,
        decisions[index],
        config
      );
  }

  return updates;
}

/* =========================================================
 * Update plan creation
 * ======================================================= */

function buildBoundarySubPixelUpdatePlanV3(
  analyses:
    readonly BoundarySubPixelCandidateAnalysisV3[],
  decisions:
    readonly BoundarySubPixelDecisionV3[],
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelUpdatePlanV3 {
  const rawUpdates =
    createRawPlannedUpdatesV3(
      analyses,
      decisions,
      config
    );

  const grouped =
    groupPlannedUpdatesByPixelV3(
      rawUpdates
    );

  const resolvedUpdates:
    BoundarySubPixelPlannedUpdateV3[] = [];

  const conflicts:
    BoundarySubPixelUpdateConflictV3[] = [];

  const updateByPixel =
    new Map<
      number,
      BoundarySubPixelPlannedUpdateV3
    >();

  let operation =
    0;

  for (
    const [
      pixel,
      pixelUpdates,
    ] of grouped
  ) {
    operation +=
      1;

    if (
      shouldCheckCancellationV3(
        operation,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const resolved =
      resolvePixelUpdatesV3(
        pixelUpdates,
        config
      );

    /**
     * تأكيد أن المفتاح والـindex متطابقان.
     */
    if (
      resolved.update.index !==
      pixel
    ) {
      throw new SegmentationError(
        'MASK_PROCESSING_FAILED',
        'BoundarySubPixelRefinerV3 resolved an update for the wrong pixel.',
        {
          stage:
            'refine-alpha-mask',

          retryable:
            false,

          metadata: {
            expectedIndex:
              pixel,

            actualIndex:
              resolved
                .update
                .index,
          },
        }
      );
    }

    resolvedUpdates.push(
      resolved.update
    );

    updateByPixel.set(
      pixel,
      resolved.update
    );

    if (resolved.conflict) {
      conflicts.push(
        resolved.conflict
      );
    }
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  resolvedUpdates.sort(
    (
      first,
      second
    ) =>
      first.index -
      second.index
  );

  let reductionCount =
    0;

  let increaseCount =
    0;

  let softAdjustmentCount =
    0;

  let preserveCount =
    0;

  let rejectedCount =
    0;

  for (
    const update of resolvedUpdates
  ) {
    switch (update.updateKind) {
      case 'reduce-alpha':
        reductionCount +=
          1;
        break;

      case 'increase-alpha':
        increaseCount +=
          1;
        break;

      case 'soft-adjust':
        softAdjustmentCount +=
          1;
        break;

      case 'rejected':
        rejectedCount +=
          1;
        break;

      case 'preserve':
      case 'unchanged':
      default:
        preserveCount +=
          1;
        break;
    }
  }

  return {
    updates:
      resolvedUpdates,

    conflicts,

    updateByPixel,

    requestedUpdateCount:
      rawUpdates.length,

    resolvedUpdateCount:
      resolvedUpdates.length,

    conflictCount:
      conflicts.length,

    reductionCount,

    increaseCount,

    softAdjustmentCount,

    preserveCount,

    rejectedCount,
  };
}

/* =========================================================
 * Update-plan validation
 * ======================================================= */

function validateBoundarySubPixelUpdatePlanV3(
  plan:
    BoundarySubPixelUpdatePlanV3,
  mask:
    SegmentationFloatMask
): void {
  let previousIndex =
    -1;

  for (
    const update of plan.updates
  ) {
    if (
      !Number.isInteger(
        update.index
      ) ||
      update.index < 0 ||
      update.index >=
        mask.data.length
    ) {
      throw new SegmentationError(
        'MASK_PROCESSING_FAILED',
        'BoundarySubPixelRefinerV3 produced an out-of-range pixel update.',
        {
          stage:
            'refine-alpha-mask',

          retryable:
            false,

          metadata: {
            index:
              Number.isFinite(
                update.index
              )
                ? update.index
                : -1,

            maskLength:
              mask.data.length,
          },
        }
      );
    }

    if (
      update.index <=
      previousIndex
    ) {
      throw new SegmentationError(
        'MASK_PROCESSING_FAILED',
        'BoundarySubPixelRefinerV3 update plan is not strictly ordered.',
        {
          stage:
            'refine-alpha-mask',

          retryable:
            false,

          metadata: {
            previousIndex,

            currentIndex:
              update.index,
          },
        }
      );
    }

    if (
      !Number.isFinite(
        update.originalAlpha
      ) ||
      !Number.isFinite(
        update.resolvedAlpha
      ) ||
      update.originalAlpha < 0 ||
      update.originalAlpha > 1 ||
      update.resolvedAlpha < 0 ||
      update.resolvedAlpha > 1
    ) {
      throw new SegmentationError(
        'MASK_PROCESSING_FAILED',
        'BoundarySubPixelRefinerV3 produced a non-normalized Alpha update.',
        {
          stage:
            'refine-alpha-mask',

          retryable:
            false,

          metadata: {
            index:
              update.index,

            originalAlpha:
              Number.isFinite(
                update.originalAlpha
              )
                ? update.originalAlpha
                : -1,

            resolvedAlpha:
              Number.isFinite(
                update.resolvedAlpha
              )
                ? update.resolvedAlpha
                : -1,
          },
        }
      );
    }

    previousIndex =
      update.index;
  }
}

/* =========================================================
 * Diagnostics accumulation from decisions
 * ======================================================= */

function accumulateDecisionDiagnosticsV3(
  passDiagnostics:
    BoundarySubPixelPassDiagnosticsV3,
  decisions:
    readonly BoundarySubPixelDecisionV3[]
): void {
  for (
    const decision of decisions
  ) {
    switch (decision.kind) {
      case 'remove-leak':
        passDiagnostics
          .removedLeakPixels +=
          1;
        break;

      case 'recover-foreground':
        passDiagnostics
          .recoveredForegroundPixels +=
          1;
        break;

      case 'soften':
        passDiagnostics
          .softenedPixels +=
          1;
        break;

      case 'preserve':
        passDiagnostics
          .preservedPixels +=
          1;
        break;

      case 'unchanged':
        passDiagnostics
          .unchangedPixels +=
          1;
        break;

      case 'reject':
      default:
        passDiagnostics
          .rejectedCount +=
          1;
        break;
    }

    if (
      decision
        .protection
        .thinStructure
    ) {
      passDiagnostics
        .protectedThinPixels +=
        1;
    }

    if (
      decision
        .protection
        .sharpCorner
    ) {
      passDiagnostics
        .protectedCornerPixels +=
        1;
    }

    if (
      decision
        .protection
        .highTexture
    ) {
      passDiagnostics
        .protectedTexturePixels +=
        1;
    }
  }
}

/* =========================================================
 * Diagnostics accumulation from plan
 * ======================================================= */

function accumulatePlanDiagnosticsV3(
  passDiagnostics:
    BoundarySubPixelPassDiagnosticsV3,
  plan:
    BoundarySubPixelUpdatePlanV3
): void {
  let absoluteChangeSum =
    0;

  let changedCount =
    0;

  for (
    const update of plan.updates
  ) {
    const signedChange =
      update.resolvedAlpha -
      update.originalAlpha;

    const absoluteChange =
      Math.abs(
        signedChange
      );

    if (
      signedChange <
      -SUB_PIXEL_EPSILON_V3
    ) {
      passDiagnostics
        .totalAlphaReduction +=
        -signedChange;
    } else if (
      signedChange >
      SUB_PIXEL_EPSILON_V3
    ) {
      passDiagnostics
        .totalAlphaIncrease +=
        signedChange;
    }

    if (
      absoluteChange >
      SUB_PIXEL_EPSILON_V3
    ) {
      absoluteChangeSum +=
        absoluteChange;

      changedCount +=
        1;

      passDiagnostics
        .maximumAbsoluteChange =
        Math.max(
          passDiagnostics
            .maximumAbsoluteChange,
          absoluteChange
        );
    }
  }

  passDiagnostics
    .averageAbsoluteChange =
    changedCount > 0
      ? absoluteChangeSum /
        changedCount
      : 0;
}

/* =========================================================
 * Plan warning generation
 * ======================================================= */

function appendUpdatePlanWarningsV3(
  warnings:
    string[],
  plan:
    BoundarySubPixelUpdatePlanV3,
  statistics:
    BoundarySubPixelDecisionStatisticsV3,
  config:
    BoundarySubPixelRefinerConfigV3
): void {
  const maximumWarnings =
    config
      .runtime
      .maximumWarnings;

  if (
    plan.resolvedUpdateCount === 0
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 did not produce any boundary updates.',
      maximumWarnings
    );
  }

  if (
    plan.conflictCount > 0
  ) {
    const conflictRatio =
      safeDivideV3(
        plan.conflictCount,
        Math.max(
          1,
          plan
            .resolvedUpdateCount
        ),
        0
      );

    if (
      conflictRatio >
      0.08
    ) {
      pushWarningV3(
        warnings,
        'BoundarySubPixelRefinerV3 detected a high boundary-decision conflict ratio.',
        maximumWarnings
      );
    }
  }

  if (
    statistics
      .averageUncertainty >
    0.68
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 boundary evidence was highly uncertain.',
      maximumWarnings
    );
  }

  if (
    statistics.removeLeak >
      0 &&
    statistics.protectedThin >
      0
  ) {
    const protectedRemovalRatio =
      safeDivideV3(
        statistics
          .protectedThin,
        statistics
          .removeLeak,
        0
      );

    if (
      protectedRemovalRatio >
      0.45
    ) {
      pushWarningV3(
        warnings,
        'BoundarySubPixelRefinerV3 applied strong thin-structure protection to many removal candidates.',
        maximumWarnings
      );
    }
  }

  if (
    statistics
      .maximumRequestedChange >
    config
      .decision
      .maximumAlphaReduction +
      0.001
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 clamped one or more excessive Alpha reductions.',
      maximumWarnings
    );
  }
}

/* =========================================================
 * Complete pass planning
 * ======================================================= */

type BoundarySubPixelPassPlanResultV3 = {
  analyses:
    readonly BoundarySubPixelCandidateAnalysisV3[];

  decisions:
    readonly BoundarySubPixelDecisionV3[];

  decisionStatistics:
    BoundarySubPixelDecisionStatisticsV3;

  plan:
    BoundarySubPixelUpdatePlanV3;
};

function createBoundarySubPixelPassPlanV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  candidates:
    readonly BoundarySubPixelCandidateV3[],
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined,
  passDiagnostics:
    BoundarySubPixelPassDiagnosticsV3,
  warnings:
    string[]
): BoundarySubPixelPassPlanResultV3 {
  const analyses =
    analyzeBoundaryCandidatesV3(
      image,
      mask,
      candidates,
      config,
      cancellationSignal
    );

  const decisions =
    decideBoundaryCandidatesV3(
      image,
      mask,
      analyses,
      config,
      cancellationSignal
    );

  const decisionStatistics =
    calculateDecisionStatisticsV3(
      decisions
    );

  const plan =
    buildBoundarySubPixelUpdatePlanV3(
      analyses,
      decisions,
      config,
      cancellationSignal
    );

  validateBoundarySubPixelUpdatePlanV3(
    plan,
    mask
  );

  passDiagnostics
    .candidateCount =
    candidates.length;

  passDiagnostics
    .analyzedCount =
    analyses.filter(
      analysis =>
        analysis.valid
    ).length;

  accumulateDecisionDiagnosticsV3(
    passDiagnostics,
    decisions
  );

  accumulatePlanDiagnosticsV3(
    passDiagnostics,
    plan
  );

  appendUpdatePlanWarningsV3(
    warnings,
    plan,
    decisionStatistics,
    config
  );

  return {
    analyses,

    decisions,

    decisionStatistics,

    plan,
  };
}

/* =========================================================
 * Part 4A-1 internal references
 * ======================================================= */

const BOUNDARY_SUB_PIXEL_PART_4A_1_INTERNALS_V3 = {
  mapDecisionKindToUpdateKindV3,

  calculateDecisionKindPriorityV3,

  calculateCandidateKindPriorityV3,

  calculateProtectionPenaltyV3,

  calculatePlannedUpdatePriorityV3,

  sanitizePlannedAlphaV3,

  createPlannedUpdateV3,

  isReductionUpdateV3,

  isIncreaseUpdateV3,

  isSoftUpdateV3,

  isNonChangingUpdateV3,

  comparePlannedUpdatesV3,

  calculateUpdateBlendWeightV3,

  blendCompatibleUpdatesV3,

  calculateGroupStrengthV3,

  resolveOpposingUpdateGroupsV3,

  resolvePixelUpdatesV3,

  calculateDecisionStatisticsV3,

  groupPlannedUpdatesByPixelV3,

  createRawPlannedUpdatesV3,

  buildBoundarySubPixelUpdatePlanV3,

  validateBoundarySubPixelUpdatePlanV3,

  accumulateDecisionDiagnosticsV3,

  accumulatePlanDiagnosticsV3,

  appendUpdatePlanWarningsV3,

  createBoundarySubPixelPassPlanV3,
};

void BOUNDARY_SUB_PIXEL_PART_4A_1_INTERNALS_V3;

// End of Part 4A-1
// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 4A-2
//
// يكمل مباشرة بعد:
//
// // End of Part 4A-1
//
// هذا الجزء مسؤول عن:
//
// 1) تطبيق Update Plan على نسخة جديدة من الماسك.
// 2) عدم تعديل الماسك المصدر أثناء نفس التمريرة.
// 3) اكتشاف التغييرات المنعزلة وغير المتسقة.
// 4) منع النتوءات والحفر الصغيرة في الحافة.
// 5) حماية قلب القطعة من أي تعديل غير مقصود.
// 6) ضبط التغييرات حسب الجيران واتجاه الحافة.
// 7) إنتاج نتيجة تطبيق أولية قابلة للصقل.
//
// الجزء التالي Part 4A-3 سيقوم بـ:
//
// - Edge-consistency polishing.
// - Anti-halo cleanup.
// - فحص تغير مساحة القطعة.
// - منع الانكماش أو التوسع غير الآمن.
// - إنهاء نتيجة التمريرة الواحدة.

/* =========================================================
 * Applied-update contracts
 * ======================================================= */

type BoundarySubPixelAppliedUpdateV3 = {
  index:
    number;

  x:
    number;

  y:
    number;

  originalAlpha:
    number;

  plannedAlpha:
    number;

  appliedAlpha:
    number;

  plannedChange:
    number;

  appliedChange:
    number;

  confidence:
    number;

  uncertainty:
    number;

  priority:
    number;

  updateKind:
    BoundarySubPixelPlannedUpdateKindV3;

  decisionKind:
    BoundarySubPixelDecisionKindV3;

  candidateKind:
    BoundarySubPixelCandidateKindV3;

  protectedThinStructure:
    boolean;

  protectedSharpCorner:
    boolean;

  protectedHighTexture:
    boolean;

  suppressed:
    boolean;

  suppressionReason:
    string | null;
};

type BoundarySubPixelApplyPlanResultV3 = {
  mask:
    SegmentationFloatMask;

  appliedUpdates:
    readonly BoundarySubPixelAppliedUpdateV3[];

  changedPixelCount:
    number;

  reducedPixelCount:
    number;

  increasedPixelCount:
    number;

  suppressedPixelCount:
    number;

  totalReduction:
    number;

  totalIncrease:
    number;

  averageAbsoluteChange:
    number;

  maximumAbsoluteChange:
    number;
};

type BoundarySubPixelNeighborStatisticsV3 = {
  minimum:
    number;

  maximum:
    number;

  average:
    number;

  variance:
    number;

  foregroundCount:
    number;

  backgroundCount:
    number;

  softCount:
    number;

  changedNeighborCount:
    number;

  reductionNeighborCount:
    number;

  increaseNeighborCount:
    number;

  sampleCount:
    number;
};

type BoundarySubPixelUpdateConsistencyV3 = {
  spatialSupport:
    number;

  directionalSupport:
    number;

  alphaSupport:
    number;

  kindSupport:
    number;

  combinedSupport:
    number;

  isolated:
    boolean;

  contradictory:
    boolean;

  safe:
    boolean;
};

type BoundarySubPixelCoreProtectionMapV3 = {
  protected:
    Uint8Array;

  distance:
    Uint8Array;

  protectedPixelCount:
    number;

  maximumStoredDistance:
    number;
};

/* =========================================================
 * Neighbor iteration helpers
 * ======================================================= */

function forEachNeighborV3(
  x:
    number,
  y:
    number,
  width:
    number,
  height:
    number,
  radius:
    number,
  callback: (
    neighborX:
      number,
    neighborY:
      number,
    neighborIndex:
      number,
    offsetX:
      number,
    offsetY:
      number,
    distance:
      number
  ) => void
): void {
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
    const neighborY =
      y +
      offsetY;

    if (
      neighborY < 0 ||
      neighborY >=
        height
    ) {
      continue;
    }

    for (
      let offsetX =
        -safeRadius;
      offsetX <=
        safeRadius;
      offsetX +=
        1
    ) {
      if (
        offsetX === 0 &&
        offsetY === 0
      ) {
        continue;
      }

      const neighborX =
        x +
        offsetX;

      if (
        neighborX < 0 ||
        neighborX >=
          width
      ) {
        continue;
      }

      const distanceSquared =
        offsetX *
          offsetX +
        offsetY *
          offsetY;

      if (
        distanceSquared >
        safeRadius *
          safeRadius
      ) {
        continue;
      }

      callback(
        neighborX,
        neighborY,
        pixelIndexV3(
          neighborX,
          neighborY,
          width
        ),
        offsetX,
        offsetY,
        Math.sqrt(
          distanceSquared
        )
      );
    }
  }
}

/* =========================================================
 * Update lookup
 * ======================================================= */

function createAppliedUpdateLookupV3(
  updates:
    readonly BoundarySubPixelAppliedUpdateV3[]
): Map<
  number,
  BoundarySubPixelAppliedUpdateV3
> {
  const lookup =
    new Map<
      number,
      BoundarySubPixelAppliedUpdateV3
    >();

  for (
    const update of updates
  ) {
    lookup.set(
      update.index,
      update
    );
  }

  return lookup;
}

/* =========================================================
 * Neighbor statistics
 * ======================================================= */

function analyzeAppliedUpdateNeighborsV3(
  sourceMask:
    SegmentationFloatMask,
  appliedMask:
    SegmentationFloatMask,
  updateLookup:
    ReadonlyMap<
      number,
      BoundarySubPixelAppliedUpdateV3
    >,
  x:
    number,
  y:
    number,
  radius:
    number,
  detectionConfig:
    BoundarySubPixelDetectionConfigV3
): BoundarySubPixelNeighborStatisticsV3 {
  let minimum =
    1;

  let maximum =
    0;

  let sum =
    0;

  let squareSum =
    0;

  let foregroundCount =
    0;

  let backgroundCount =
    0;

  let softCount =
    0;

  let changedNeighborCount =
    0;

  let reductionNeighborCount =
    0;

  let increaseNeighborCount =
    0;

  let sampleCount =
    0;

  forEachNeighborV3(
    x,
    y,
    sourceMask.width,
    sourceMask.height,
    radius,
    (
      _neighborX,
      _neighborY,
      neighborIndex
    ) => {
      const value =
        clampUnitValue(
          finiteOrV3(
            appliedMask.data[
              neighborIndex
            ],
            sourceMask.data[
              neighborIndex
            ]
          )
        );

      minimum =
        Math.min(
          minimum,
          value
        );

      maximum =
        Math.max(
          maximum,
          value
        );

      sum +=
        value;

      squareSum +=
        value *
        value;

      sampleCount +=
        1;

      if (
        value >=
        detectionConfig
          .strongForegroundThreshold
      ) {
        foregroundCount +=
          1;
      } else if (
        value <=
        detectionConfig
          .strongBackgroundThreshold
      ) {
        backgroundCount +=
          1;
      } else {
        softCount +=
          1;
      }

      const neighborUpdate =
        updateLookup.get(
          neighborIndex
        );

      if (
        !neighborUpdate ||
        Math.abs(
          neighborUpdate
            .appliedChange
        ) <=
          SUB_PIXEL_EPSILON_V3
      ) {
        return;
      }

      changedNeighborCount +=
        1;

      if (
        neighborUpdate
          .appliedChange <
        0
      ) {
        reductionNeighborCount +=
          1;
      } else {
        increaseNeighborCount +=
          1;
      }
    }
  );

  if (
    sampleCount <= 0
  ) {
    return {
      minimum:
        0,

      maximum:
        0,

      average:
        0,

      variance:
        0,

      foregroundCount:
        0,

      backgroundCount:
        0,

      softCount:
        0,

      changedNeighborCount:
        0,

      reductionNeighborCount:
        0,

      increaseNeighborCount:
        0,

      sampleCount:
        0,
    };
  }

  const average =
    sum /
    sampleCount;

  const variance =
    Math.max(
      0,
      squareSum /
        sampleCount -
      average *
        average
    );

  return {
    minimum:
      clampUnitValue(
        minimum
      ),

    maximum:
      clampUnitValue(
        maximum
      ),

    average:
      clampUnitValue(
        average
      ),

    variance:
      clampUnitValue(
        variance *
        4
      ),

    foregroundCount,

    backgroundCount,

    softCount,

    changedNeighborCount,

    reductionNeighborCount,

    increaseNeighborCount,

    sampleCount,
  };
}

/* =========================================================
 * Directional support
 * ======================================================= */

function calculateDirectionalNeighborSupportV3(
  update:
    BoundarySubPixelAppliedUpdateV3,
  updateLookup:
    ReadonlyMap<
      number,
      BoundarySubPixelAppliedUpdateV3
    >,
  width:
    number,
  height:
    number,
  radius:
    number
): number {
  let weightedSupport =
    0;

  let totalWeight =
    0;

  forEachNeighborV3(
    update.x,
    update.y,
    width,
    height,
    radius,
    (
      _neighborX,
      _neighborY,
      neighborIndex,
      offsetX,
      offsetY,
      distance
    ) => {
      const neighbor =
        updateLookup.get(
          neighborIndex
        );

      if (
        !neighbor ||
        Math.abs(
          neighbor
            .appliedChange
        ) <=
          SUB_PIXEL_EPSILON_V3
      ) {
        return;
      }

      const sameSign =
        Math.sign(
          neighbor
            .appliedChange
        ) ===
        Math.sign(
          update
            .appliedChange
        );

      const directionVector =
        normalizeVectorV3({
          x:
            offsetX,

          y:
            offsetY,
        });

      /**
       * الحواف المستمرة غالبًا تمتد على Tangent،
       * لكن لا نملك اتجاه المرشح هنا مباشرة.
       *
       * نستخدم توافق نوع القرار والمسافة
       * كدليل ثابت وبسيط.
       */
      const radialWeight =
        1 /
        Math.max(
          1,
          distance
        );

      const axisBalance =
        1 -
        Math.abs(
          Math.abs(
            directionVector.x
          ) -
          Math.abs(
            directionVector.y
          )
        ) *
          0.2;

      const confidenceWeight =
        neighbor.confidence *
          0.55 +
        neighbor.priority *
          0.45;

      const support =
        sameSign
          ? 1
          : 0;

      const weight =
        radialWeight *
        axisBalance *
        Math.max(
          0.05,
          confidenceWeight
        );

      weightedSupport +=
        support *
        weight;

      totalWeight +=
        weight;
    }
  );

  return totalWeight >
    SUB_PIXEL_EPSILON_V3
    ? clampUnitValue(
        weightedSupport /
        totalWeight
      )
    : 0;
}

/* =========================================================
 * Update consistency
 * ======================================================= */

function analyzeAppliedUpdateConsistencyV3(
  sourceMask:
    SegmentationFloatMask,
  appliedMask:
    SegmentationFloatMask,
  update:
    BoundarySubPixelAppliedUpdateV3,
  updateLookup:
    ReadonlyMap<
      number,
      BoundarySubPixelAppliedUpdateV3
    >,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelUpdateConsistencyV3 {
  const neighbors =
    analyzeAppliedUpdateNeighborsV3(
      sourceMask,
      appliedMask,
      updateLookup,
      update.x,
      update.y,
      2,
      config.detection
    );

  const spatialSupport =
    neighbors.sampleCount > 0
      ? clampUnitValue(
          neighbors
            .changedNeighborCount /
          Math.max(
            1,
            neighbors
              .sampleCount
          ) *
          2.5
        )
      : 0;

  const sameDirectionCount =
    update.appliedChange < 0
      ? neighbors
          .reductionNeighborCount
      : neighbors
          .increaseNeighborCount;

  const kindSupport =
    neighbors
      .changedNeighborCount >
      0
      ? clampUnitValue(
          sameDirectionCount /
          neighbors
            .changedNeighborCount
        )
      : 0;

  const directionalSupport =
    calculateDirectionalNeighborSupportV3(
      update,
      updateLookup,
      sourceMask.width,
      sourceMask.height,
      3
    );

  const sourceAlpha =
    clampUnitValue(
      sourceMask.data[
        update.index
      ]
    );

  const appliedAlpha =
    clampUnitValue(
      appliedMask.data[
        update.index
      ]
    );

  const expectedNeighborAlpha =
    update.appliedChange < 0
      ? neighbors.minimum
      : neighbors.maximum;

  const alphaDifference =
    Math.abs(
      appliedAlpha -
      expectedNeighborAlpha
    );

  const localRange =
    Math.max(
      SUB_PIXEL_EPSILON_V3,
      neighbors.maximum -
      neighbors.minimum
    );

  const normalizedDifference =
    clampUnitValue(
      alphaDifference /
      localRange
    );

  const alphaSupport =
    clampUnitValue(
      1 -
      normalizedDifference
    );

  const sourceToNeighborhood =
    clampUnitValue(
      1 -
      Math.abs(
        sourceAlpha -
        neighbors.average
      )
    );

  const combinedSupport =
    clampUnitValue(
      spatialSupport *
        0.27 +
      directionalSupport *
        0.25 +
      kindSupport *
        0.23 +
      alphaSupport *
        0.15 +
      sourceToNeighborhood *
        0.1
    );

 const isolated =
  neighbors
    .changedNeighborCount ===
    0 &&
  Math.abs(
    update.appliedChange
  ) >
    0.035;

const contradictory =
  neighbors
    .changedNeighborCount >
    0 &&
  kindSupport <
    0.34 &&
  Math.abs(
    update.appliedChange
  ) >
    0.05;

  const isProtected =
  update
    .protectedThinStructure ||
  update
    .protectedSharpCorner ||
  update
    .protectedHighTexture;

const minimumSupport =
  isProtected
    ? 0.28
    : 0.22;

  return {
    spatialSupport,

    directionalSupport,

    alphaSupport,

    kindSupport,

    combinedSupport,

    isolated,

    contradictory,

    safe:
      !isolated &&
      !contradictory &&
      combinedSupport >=
        minimumSupport,
  };
}

/* =========================================================
 * Initial update application
 * ======================================================= */

function shouldApplyPlannedUpdateV3(
  update:
    BoundarySubPixelPlannedUpdateV3
): boolean {
  if (
    update.updateKind ===
      'preserve' ||
    update.updateKind ===
      'unchanged' ||
    update.updateKind ===
      'rejected'
  ) {
    return false;
  }

  if (
    update.absoluteChange <=
    SUB_PIXEL_EPSILON_V3
  ) {
    return false;
  }

  if (
    update.confidence <=
      0 ||
    update.priority <=
      0
  ) {
    return false;
  }

  return true;
}

function applyRawBoundaryUpdatePlanV3(
  sourceMask:
    SegmentationFloatMask,
  plan:
    BoundarySubPixelUpdatePlanV3,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelApplyPlanResultV3 {
  const output =
    cloneFloatMask(
      sourceMask
    );

  const appliedUpdates:
    BoundarySubPixelAppliedUpdateV3[] = [];

  let changedPixelCount =
    0;

  let reducedPixelCount =
    0;

  let increasedPixelCount =
    0;

  let suppressedPixelCount =
    0;

  let totalReduction =
    0;

  let totalIncrease =
    0;

  let absoluteChangeSum =
    0;

  let maximumAbsoluteChange =
    0;

  for (
    let updateIndex =
      0;
    updateIndex <
      plan.updates.length;
    updateIndex +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        updateIndex,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const update =
      plan.updates[
        updateIndex
      ];

    const sourceAlpha =
      clampUnitValue(
        sourceMask.data[
          update.index
        ]
      );

    let appliedAlpha =
      sourceAlpha;

    let suppressed =
      false;

    let suppressionReason:
      string | null =
        null;

    if (
      shouldApplyPlannedUpdateV3(
        update
      )
    ) {
      /**
       * نستخدم resolvedAlpha، لكن نعيد ضبطه
       * مرة أخيرة بالنسبة لقيمة المصدر الحقيقية.
       */
      const requested =
        clampUnitValue(
          update.resolvedAlpha
        );

      const change =
        requested -
        sourceAlpha;

      const confidenceScale =
        clampUnitValue(
          update.confidence *
            0.72 +
          update.priority *
            0.28
        );

      const uncertaintyScale =
        1 -
        update.uncertainty *
          0.62;

      const applicationStrength =
        clampUnitValue(
          confidenceScale *
          uncertaintyScale
        );

      appliedAlpha =
        clampUnitValue(
          lerpV3(
            sourceAlpha,
            requested,
            applicationStrength
          )
        );

      if (
        update
          .protectedThinStructure ||
        update
          .protectedSharpCorner
      ) {
        const protectedStrength =
          update.updateKind ===
            'reduce-alpha'
            ? 0.72
            : 0.88;

        appliedAlpha =
          clampUnitValue(
            lerpV3(
              sourceAlpha,
              appliedAlpha,
              protectedStrength
            )
          );
      }

      if (
        Math.abs(
          appliedAlpha -
          sourceAlpha
        ) <
        0.0015
      ) {
        appliedAlpha =
          sourceAlpha;

        suppressed =
          true;

        suppressionReason =
          'change-below-application-epsilon';
      }
    } else {
      suppressed =
        true;

      suppressionReason =
        'non-changing-planned-update';
    }

    output.data[
      update.index
    ] =
      appliedAlpha;

    const appliedChange =
      appliedAlpha -
      sourceAlpha;

    const absoluteChange =
      Math.abs(
        appliedChange
      );

    if (
      absoluteChange >
      SUB_PIXEL_EPSILON_V3
    ) {
      changedPixelCount +=
        1;

      absoluteChangeSum +=
        absoluteChange;

      maximumAbsoluteChange =
        Math.max(
          maximumAbsoluteChange,
          absoluteChange
        );

      if (
        appliedChange < 0
      ) {
        reducedPixelCount +=
          1;

        totalReduction +=
          -appliedChange;
      } else {
        increasedPixelCount +=
          1;

        totalIncrease +=
          appliedChange;
      }
    }

    if (suppressed) {
      suppressedPixelCount +=
        1;
    }

    appliedUpdates.push({
      index:
        update.index,

      x:
        update.x,

      y:
        update.y,

      originalAlpha:
        sourceAlpha,

      plannedAlpha:
        update.resolvedAlpha,

      appliedAlpha,

      plannedChange:
        update.resolvedAlpha -
        sourceAlpha,

      appliedChange,

      confidence:
        update.confidence,

      uncertainty:
        update.uncertainty,

      priority:
        update.priority,

      updateKind:
        update.updateKind,

      decisionKind:
        update.decisionKind,

      candidateKind:
        update.candidateKind,

      protectedThinStructure:
        update
          .protectedThinStructure,

      protectedSharpCorner:
        update
          .protectedSharpCorner,

      protectedHighTexture:
        update
          .protectedHighTexture,

      suppressed,

      suppressionReason,
    });
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return {
    mask:
      output,

    appliedUpdates,

    changedPixelCount,

    reducedPixelCount,

    increasedPixelCount,

    suppressedPixelCount,

    totalReduction,

    totalIncrease,

    averageAbsoluteChange:
      changedPixelCount > 0
        ? absoluteChangeSum /
          changedPixelCount
        : 0,

    maximumAbsoluteChange,
  };
}

/* =========================================================
 * Isolated update suppression
 * ======================================================= */

function calculateSuppressedAlphaV3(
  sourceAlpha:
    number,
  appliedAlpha:
    number,
  consistency:
    BoundarySubPixelUpdateConsistencyV3,
  update:
    BoundarySubPixelAppliedUpdateV3
): number {
  if (
    consistency.isolated
  ) {
    return sourceAlpha;
  }

  if (
    consistency.contradictory
  ) {
    return lerpV3(
      sourceAlpha,
      appliedAlpha,
      0.16
    );
  }

  const supportStrength =
    smoothStepV3(
      0.18,
      0.62,
      consistency
        .combinedSupport
    );

  const protectedMinimum =
    update
      .protectedThinStructure ||
    update
      .protectedSharpCorner
      ? 0.5
      : 0.28;

  const strength =
    Math.max(
      protectedMinimum,
      supportStrength
    );

  return clampUnitValue(
    lerpV3(
      sourceAlpha,
      appliedAlpha,
      strength
    )
  );
}

function suppressInconsistentAppliedUpdatesV3(
  sourceMask:
    SegmentationFloatMask,
  initialResult:
    BoundarySubPixelApplyPlanResultV3,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelApplyPlanResultV3 {
  const output =
    cloneFloatMask(
      initialResult.mask
    );

  const lookup =
    createAppliedUpdateLookupV3(
      initialResult
        .appliedUpdates
    );

  const resolvedUpdates:
    BoundarySubPixelAppliedUpdateV3[] =
      new Array(
        initialResult
          .appliedUpdates
          .length
      );

  let changedPixelCount =
    0;

  let reducedPixelCount =
    0;

  let increasedPixelCount =
    0;

  let suppressedPixelCount =
    0;

  let totalReduction =
    0;

  let totalIncrease =
    0;

  let absoluteChangeSum =
    0;

  let maximumAbsoluteChange =
    0;

  for (
    let index =
      0;
    index <
      initialResult
        .appliedUpdates
        .length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const update =
      initialResult
        .appliedUpdates[
          index
        ];

    const sourceAlpha =
      clampUnitValue(
        sourceMask.data[
          update.index
        ]
      );

    if (
      Math.abs(
        update.appliedChange
      ) <=
        SUB_PIXEL_EPSILON_V3
    ) {
      resolvedUpdates[
        index
      ] = {
        ...update,

        appliedAlpha:
          sourceAlpha,

        appliedChange:
          0,
      };

      output.data[
        update.index
      ] =
        sourceAlpha;

      suppressedPixelCount +=
        1;

      continue;
    }

    const consistency =
      analyzeAppliedUpdateConsistencyV3(
        sourceMask,
        initialResult.mask,
        update,
        lookup,
        config
      );

    let resolvedAlpha =
      update.appliedAlpha;

    let suppressed =
      update.suppressed;

    let suppressionReason =
      update.suppressionReason;

    if (!consistency.safe) {
      resolvedAlpha =
        calculateSuppressedAlphaV3(
          sourceAlpha,
          update.appliedAlpha,
          consistency,
          update
        );

      suppressed =
        true;

      suppressionReason =
        consistency.isolated
          ? 'isolated-boundary-change'
          : consistency
              .contradictory
            ? 'contradictory-neighbor-updates'
            : 'insufficient-neighbor-support';
    } else if (
      consistency
        .combinedSupport <
      0.42
    ) {
      resolvedAlpha =
        lerpV3(
          sourceAlpha,
          update.appliedAlpha,
          0.72
        );
    }

    resolvedAlpha =
      clampUnitValue(
        resolvedAlpha
      );

    output.data[
      update.index
    ] =
      resolvedAlpha;

    const appliedChange =
      resolvedAlpha -
      sourceAlpha;

    const absoluteChange =
      Math.abs(
        appliedChange
      );

    if (
      absoluteChange >
      SUB_PIXEL_EPSILON_V3
    ) {
      changedPixelCount +=
        1;

      absoluteChangeSum +=
        absoluteChange;

      maximumAbsoluteChange =
        Math.max(
          maximumAbsoluteChange,
          absoluteChange
        );

      if (
        appliedChange < 0
      ) {
        reducedPixelCount +=
          1;

        totalReduction +=
          -appliedChange;
      } else {
        increasedPixelCount +=
          1;

        totalIncrease +=
          appliedChange;
      }
    }

    if (suppressed) {
      suppressedPixelCount +=
        1;
    }

    resolvedUpdates[
      index
    ] = {
      ...update,

      appliedAlpha:
        resolvedAlpha,

      appliedChange,

      suppressed,

      suppressionReason,
    };
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return {
    mask:
      output,

    appliedUpdates:
      resolvedUpdates,

    changedPixelCount,

    reducedPixelCount,

    increasedPixelCount,

    suppressedPixelCount,

    totalReduction,

    totalIncrease,

    averageAbsoluteChange:
      changedPixelCount > 0
        ? absoluteChangeSum /
          changedPixelCount
        : 0,

    maximumAbsoluteChange,
  };
}

/* =========================================================
 * Core foreground protection
 * ======================================================= */

/**
 * نبني خريطة مسافة داخلية بسيطة بدءًا من
 * البكسلات القريبة من الخلفية.
 *
 * البكسلات البعيدة عن الحافة تعتبر قلب القطعة
 * ولا يُسمح لهذه الطبقة بتغييرها.
 */
function buildForegroundCoreProtectionMapV3(
  mask:
    SegmentationFloatMask,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelCoreProtectionMapV3 {
  const pixelCount =
    mask.data.length;

  const distance =
    new Uint8Array(
      pixelCount
    );

  const protectedMap =
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

  const boundaryThreshold =
    config
      .detection
      .strongForegroundThreshold;

  /**
   * القيمة 255 تعني لم تتم زيارتها.
   */
  distance.fill(
    255
  );

  for (
    let y =
      0;
    y <
      mask.height;
    y +=
      1
  ) {
    for (
      let x =
        0;
      x <
        mask.width;
      x +=
        1
    ) {
      const index =
        pixelIndexV3(
          x,
          y,
          mask.width
        );

      if (
        shouldCheckCancellationV3(
          index,
          config
            .runtime
            .cancellationCheckInterval
        )
      ) {
        assertNotCancelledV3(
          cancellationSignal
        );
      }

      const alpha =
        clampUnitValue(
          mask.data[
            index
          ]
        );

      if (
        alpha <
        boundaryThreshold
      ) {
        distance[index] =
          0;

        queue[
          queueEnd
        ] =
          index;

        queueEnd +=
          1;
      }
    }
  }

  const maximumStoredDistance =
    Math.min(
      254,
      Math.max(
        config
          .detection
          .maximumInnerDistance +
          4,
        8
      )
    );

  const neighborOffsets =
    [
      -1,
      1,
      -mask.width,
      mask.width,
    ] as const;

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

    if (
      shouldCheckCancellationV3(
        queueStart,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const currentDistance =
      distance[index];

    if (
      currentDistance >=
      maximumStoredDistance
    ) {
      continue;
    }

    const x =
      index %
      mask.width;

    const y =
      Math.floor(
        index /
        mask.width
      );

    for (
      const offset of
        neighborOffsets
    ) {
      const neighborIndex =
        index +
        offset;

      if (
        neighborIndex < 0 ||
        neighborIndex >=
          pixelCount
      ) {
        continue;
      }

      if (
        offset === -1 &&
        x === 0
      ) {
        continue;
      }

      if (
        offset === 1 &&
        x ===
          mask.width - 1
      ) {
        continue;
      }

      if (
        offset ===
          -mask.width &&
        y === 0
      ) {
        continue;
      }

      if (
        offset ===
          mask.width &&
        y ===
          mask.height - 1
      ) {
        continue;
      }

      if (
        distance[
          neighborIndex
        ] !==
        255
      ) {
        continue;
      }

      distance[
        neighborIndex
      ] =
        Math.min(
          254,
          currentDistance +
          1
        );

      queue[
        queueEnd
      ] =
        neighborIndex;

      queueEnd +=
        1;
    }
  }

  let protectedPixelCount =
    0;

  const protectedDistance =
    Math.max(
      config
        .detection
        .maximumInnerDistance +
        1,
      4
    );

  for (
    let index =
      0;
    index <
      pixelCount;
    index +=
      1
  ) {
    const alpha =
      clampUnitValue(
        mask.data[index]
      );

    const isProtected =
      alpha >=
        boundaryThreshold &&
      distance[index] >=
        protectedDistance;

    if (isProtected) {
      protectedMap[index] =
        1;

      protectedPixelCount +=
        1;
    }
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return {
    protected:
      protectedMap,

    distance,

    protectedPixelCount,

    maximumStoredDistance,
  };
}

/* =========================================================
 * Restore protected core
 * ======================================================= */

function restoreProtectedForegroundCoreV3(
  sourceMask:
    SegmentationFloatMask,
  refinedResult:
    BoundarySubPixelApplyPlanResultV3,
  coreProtection:
    BoundarySubPixelCoreProtectionMapV3,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelApplyPlanResultV3 {
  const output =
    cloneFloatMask(
      refinedResult.mask
    );

  const resolvedUpdates:
    BoundarySubPixelAppliedUpdateV3[] =
      new Array(
        refinedResult
          .appliedUpdates
          .length
      );

  let changedPixelCount =
    0;

  let reducedPixelCount =
    0;

  let increasedPixelCount =
    0;

  let suppressedPixelCount =
    0;

  let totalReduction =
    0;

  let totalIncrease =
    0;

  let absoluteChangeSum =
    0;

  let maximumAbsoluteChange =
    0;

  for (
    let index =
      0;
    index <
      refinedResult
        .appliedUpdates
        .length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const update =
      refinedResult
        .appliedUpdates[
          index
        ];

    const sourceAlpha =
      clampUnitValue(
        sourceMask.data[
          update.index
        ]
      );

    let resolvedAlpha =
      update.appliedAlpha;

    let suppressed =
      update.suppressed;

    let suppressionReason =
      update.suppressionReason;

    if (
      coreProtection
        .protected[
          update.index
        ] ===
      1
    ) {
      resolvedAlpha =
        sourceAlpha;

      suppressed =
        true;

      suppressionReason =
        'foreground-core-protected';
    }

    output.data[
      update.index
    ] =
      resolvedAlpha;

    const appliedChange =
      resolvedAlpha -
      sourceAlpha;

    const absoluteChange =
      Math.abs(
        appliedChange
      );

    if (
      absoluteChange >
      SUB_PIXEL_EPSILON_V3
    ) {
      changedPixelCount +=
        1;

      absoluteChangeSum +=
        absoluteChange;

      maximumAbsoluteChange =
        Math.max(
          maximumAbsoluteChange,
          absoluteChange
        );

      if (
        appliedChange < 0
      ) {
        reducedPixelCount +=
          1;

        totalReduction +=
          -appliedChange;
      } else {
        increasedPixelCount +=
          1;

        totalIncrease +=
          appliedChange;
      }
    }

    if (suppressed) {
      suppressedPixelCount +=
        1;
    }

    resolvedUpdates[index] = {
      ...update,

      appliedAlpha:
        resolvedAlpha,

      appliedChange,

      suppressed,

      suppressionReason,
    };
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return {
    mask:
      output,

    appliedUpdates:
      resolvedUpdates,

    changedPixelCount,

    reducedPixelCount,

    increasedPixelCount,

    suppressedPixelCount,

    totalReduction,

    totalIncrease,

    averageAbsoluteChange:
      changedPixelCount > 0
        ? absoluteChangeSum /
          changedPixelCount
        : 0,

    maximumAbsoluteChange,
  };
}

/* =========================================================
 * Complete safe plan application
 * ======================================================= */

function applyBoundarySubPixelUpdatePlanV3(
  sourceMask:
    SegmentationFloatMask,
  plan:
    BoundarySubPixelUpdatePlanV3,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelApplyPlanResultV3 {
  const rawResult =
    applyRawBoundaryUpdatePlanV3(
      sourceMask,
      plan,
      config,
      cancellationSignal
    );

  if (
    rawResult
      .changedPixelCount ===
    0
  ) {
    return rawResult;
  }

  const consistentResult =
    suppressInconsistentAppliedUpdatesV3(
      sourceMask,
      rawResult,
      config,
      cancellationSignal
    );

  const coreProtection =
    buildForegroundCoreProtectionMapV3(
      sourceMask,
      config,
      cancellationSignal
    );

  return restoreProtectedForegroundCoreV3(
    sourceMask,
    consistentResult,
    coreProtection,
    config,
    cancellationSignal
  );
}

/* =========================================================
 * Apply-result diagnostics
 * ======================================================= */

function applyResultToPassDiagnosticsV3(
  passDiagnostics:
    BoundarySubPixelPassDiagnosticsV3,
  applyResult:
    BoundarySubPixelApplyPlanResultV3
): void {
  passDiagnostics
    .totalAlphaReduction =
    applyResult
      .totalReduction;

  passDiagnostics
    .totalAlphaIncrease =
    applyResult
      .totalIncrease;

  passDiagnostics
    .averageAbsoluteChange =
    applyResult
      .averageAbsoluteChange;

  passDiagnostics
    .maximumAbsoluteChange =
    applyResult
      .maximumAbsoluteChange;

  /**
   * أعداد أنواع القرارات تم تسجيلها سابقًا.
   * هنا نضبط unchanged بحيث يعكس التغييرات
   * التي تم إلغاؤها أثناء فحص الاتساق.
   */
  passDiagnostics
    .unchangedPixels +=
    applyResult
      .suppressedPixelCount;
}

/* =========================================================
 * Application warnings
 * ======================================================= */

function appendApplyResultWarningsV3(
  warnings:
    string[],
  applyResult:
    BoundarySubPixelApplyPlanResultV3,
  plan:
    BoundarySubPixelUpdatePlanV3,
  config:
    BoundarySubPixelRefinerConfigV3
): void {
  const maximumWarnings =
    config
      .runtime
      .maximumWarnings;

  if (
    plan
      .resolvedUpdateCount >
      0 &&
    applyResult
      .changedPixelCount ===
      0
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 suppressed all proposed boundary updates.',
      maximumWarnings
    );
  }

  const suppressionRatio =
    safeDivideV3(
      applyResult
        .suppressedPixelCount,
      Math.max(
        1,
        plan
          .resolvedUpdateCount
      ),
      0
    );

  if (
    suppressionRatio >
    0.65
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 suppressed most updates due to weak local consistency.',
      maximumWarnings
    );
  }

  if (
    applyResult
      .maximumAbsoluteChange >
    Math.max(
      config
        .decision
        .maximumAlphaReduction,
      config
        .decision
        .maximumAlphaIncrease
    ) +
      0.001
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 detected an excessive applied Alpha change.',
      maximumWarnings
    );
  }

  if (
    applyResult
      .reducedPixelCount >
    0 &&
    applyResult
      .increasedPixelCount >
    0
  ) {
    const smallerGroup =
      Math.min(
        applyResult
          .reducedPixelCount,
        applyResult
          .increasedPixelCount
      );

    const largerGroup =
      Math.max(
        applyResult
          .reducedPixelCount,
        applyResult
          .increasedPixelCount
      );

    if (
      smallerGroup /
      Math.max(
        1,
        largerGroup
      ) >
      0.7
    ) {
      pushWarningV3(
        warnings,
        'BoundarySubPixelRefinerV3 produced similarly sized Alpha-reduction and Alpha-recovery groups.',
        maximumWarnings
      );
    }
  }
}

/* =========================================================
 * Part 4A-2 internal references
 * ======================================================= */

const BOUNDARY_SUB_PIXEL_PART_4A_2_INTERNALS_V3 = {
  forEachNeighborV3,

  createAppliedUpdateLookupV3,

  analyzeAppliedUpdateNeighborsV3,

  calculateDirectionalNeighborSupportV3,

  analyzeAppliedUpdateConsistencyV3,

  shouldApplyPlannedUpdateV3,

  applyRawBoundaryUpdatePlanV3,

  calculateSuppressedAlphaV3,

  suppressInconsistentAppliedUpdatesV3,

  buildForegroundCoreProtectionMapV3,

  restoreProtectedForegroundCoreV3,

  applyBoundarySubPixelUpdatePlanV3,

  applyResultToPassDiagnosticsV3,

  appendApplyResultWarningsV3,
};

void BOUNDARY_SUB_PIXEL_PART_4A_2_INTERNALS_V3;

// End of Part 4A-2
// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 4A-3A
//
// يكمل مباشرة بعد:
//
// // End of Part 4A-2
//
// هذا الجزء مسؤول عن:
//
// 1) إزالة الـHalo الرفيع حول الحافة.
// 2) تحسين الحواف المائلة والمنحنية.
// 3) منع النتوءات والحفر الصغيرة.
// 4) الحفاظ على التفاصيل الرفيعة والزوايا.
// 5) تعديل البكسلات الحدّية فقط.
//
// الجزء التالي Part 4A-3B سيقوم بـ:
//
// - فحص تغير المساحة.
// - منع الانكماش أو التوسع غير الآمن.
// - إنهاء التمريرة الواحدة.
// - تشغيل التمريرات.
// - Diagnostics النهائية.
// - Public API.

/* =========================================================
 * Final polish contracts
 * ======================================================= */

type BoundarySubPixelBoundaryNeighborhoodV3 = {
  minimumAlpha:
    number;

  maximumAlpha:
    number;

  averageAlpha:
    number;

  medianAlpha:
    number;

  foregroundCount:
    number;

  backgroundCount:
    number;

  softCount:
    number;

  sampleCount:
    number;
};

type BoundarySubPixelHaloEvidenceV3 = {
  detected:
    boolean;

  confidence:
    number;

  foregroundSimilarity:
    number;

  backgroundSimilarity:
    number;

  outsideBackgroundSupport:
    number;

  insideForegroundSupport:
    number;

  gradientSupport:
    number;

  suggestedAlpha:
    number;
};

type BoundarySubPixelEdgeConsistencyEvidenceV3 = {
  isolatedPeak:
    boolean;

  isolatedValley:
    boolean;

  jagged:
    boolean;

  consistency:
    number;

  suggestedAlpha:
    number;
};

type BoundarySubPixelPolishUpdateV3 = {
  index:
    number;

  x:
    number;

  y:
    number;

  originalAlpha:
    number;

  inputAlpha:
    number;

  targetAlpha:
    number;

  finalAlpha:
    number;

  confidence:
    number;

  kind:
    | 'anti-halo'
    | 'edge-consistency'
    | 'jagged-suppression'
    | 'preserve';

  isProtected:
    boolean;

  reason:
    string;
};

type BoundarySubPixelPolishResultV3 = {
  mask:
    SegmentationFloatMask;

  updates:
    readonly BoundarySubPixelPolishUpdateV3[];

  changedPixelCount:
    number;

  haloRemovedPixelCount:
    number;

  consistencyAdjustedPixelCount:
    number;

  jaggedSuppressedPixelCount:
    number;

  protectedPixelCount:
    number;

  totalAlphaReduction:
    number;

  totalAlphaIncrease:
    number;

  averageAbsoluteChange:
    number;

  maximumAbsoluteChange:
    number;
};

/* =========================================================
 * Numeric sorting
 * ======================================================= */

function sortNumericAscendingV3(
  values:
    number[]
): number[] {
  values.sort(
    (
      first,
      second
    ) =>
      first -
      second
  );

  return values;
}

/* =========================================================
 * Boundary neighborhood
 * ======================================================= */

function analyzeBoundaryNeighborhoodV3(
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  radius:
    number,
  config:
    BoundarySubPixelDetectionConfigV3
): BoundarySubPixelBoundaryNeighborhoodV3 {
  const values:
    number[] = [];

  let foregroundCount =
    0;

  let backgroundCount =
    0;

  let softCount =
    0;

  forEachNeighborV3(
    x,
    y,
    mask.width,
    mask.height,
    radius,
    (
      _neighborX,
      _neighborY,
      neighborIndex
    ) => {
      const alpha =
        clampUnitValue(
          finiteOrV3(
            mask.data[
              neighborIndex
            ],
            0
          )
        );

      values.push(
        alpha
      );

      if (
        alpha >=
        config
          .strongForegroundThreshold
      ) {
        foregroundCount +=
          1;
      } else if (
        alpha <=
        config
          .strongBackgroundThreshold
      ) {
        backgroundCount +=
          1;
      } else {
        softCount +=
          1;
      }
    }
  );

  if (
    values.length === 0
  ) {
    return {
      minimumAlpha:
        0,

      maximumAlpha:
        0,

      averageAlpha:
        0,

      medianAlpha:
        0,

      foregroundCount:
        0,

      backgroundCount:
        0,

      softCount:
        0,

      sampleCount:
        0,
    };
  }

  sortNumericAscendingV3(
    values
  );

  let sum =
    0;

  for (
    const value of values
  ) {
    sum +=
      value;
  }

  const middle =
    Math.floor(
      values.length /
      2
    );

  const medianAlpha =
    values.length %
      2 ===
      0
      ? (
          values[
            middle - 1
          ] +
          values[
            middle
          ]
        ) *
        0.5
      : values[
          middle
        ];

  return {
    minimumAlpha:
      values[0],

    maximumAlpha:
      values[
        values.length -
        1
      ],

    averageAlpha:
      clampUnitValue(
        sum /
        values.length
      ),

    medianAlpha:
      clampUnitValue(
        medianAlpha
      ),

    foregroundCount,

    backgroundCount,

    softCount,

    sampleCount:
      values.length,
  };
}

/* =========================================================
 * Protection lookup
 * ======================================================= */

function createProtectedPixelLookupV3(
  updates:
    readonly BoundarySubPixelAppliedUpdateV3[]
): ReadonlyMap<
  number,
  BoundarySubPixelAppliedUpdateV3
> {
  const lookup =
    new Map<
      number,
      BoundarySubPixelAppliedUpdateV3
    >();

  for (
    const update of updates
  ) {
    if (
      update
        .protectedThinStructure ||
      update
        .protectedSharpCorner ||
      update
        .protectedHighTexture
    ) {
      lookup.set(
        update.index,
        update
      );
    }
  }

  return lookup;
}

/* =========================================================
 * Color comparison at integer pixel
 * ======================================================= */

function readWeightedPixelV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number
): BoundarySubPixelWeightedSampleV3 {
  const sample =
    sampleAnalysisPointV3(
      image,
      mask,
      x,
      y,
      1,
      {
        ...DEFAULT_BOUNDARY_SUB_PIXEL_REFINER_CONFIG_V3
          .sampling,

        bilinear:
          false,

        rejectOutOfBounds:
          true,
      }
    );

  return aggregateSingleSampleV3(
    sample
  );
}

/* =========================================================
 * Foreground/background color models
 * ======================================================= */

function buildDirectionalColorReferenceV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  x:
    number,
  y:
    number,
  normal:
    BoundarySubPixelVectorV3,
  directionSign:
    -1 | 1,
  samplingConfig:
    BoundarySubPixelSamplingConfigV3
): BoundarySubPixelWeightedSampleV3 {
  const samples:
    BoundarySubPixelSampleV3[] = [];

  const distances =
    [
      1,
      1.75,
      2.5,
      3.25,
    ] as const;

  const tangent =
    perpendicularVectorV3(
      normal
    );

  for (
    const distance of distances
  ) {
    for (
      let tangentStep =
        -1;
      tangentStep <=
        1;
      tangentStep +=
        1
    ) {
      const tangentialOffset =
        tangentStep *
        0.75;

      const sampleX =
        x +
        normal.x *
          distance *
          directionSign +
        tangent.x *
          tangentialOffset;

      const sampleY =
        y +
        normal.y *
          distance *
          directionSign +
        tangent.y *
          tangentialOffset;

      const sample =
        sampleAnalysisPointV3(
          image,
          mask,
          sampleX,
          sampleY,
          1 /
            Math.max(
              1,
              distance
            ),
          samplingConfig
        );

      samples.push(
        sample
      );
    }
  }

  return aggregateSamplesV3(
    samples
  );
}

/* =========================================================
 * Halo detection
 * ======================================================= */

function analyzeHaloEvidenceV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  sourceMask:
    SegmentationFloatMask,
  currentMask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelHaloEvidenceV3 {
  const direction =
    candidate.direction;

  if (!direction) {
    return {
      detected:
        false,

      confidence:
        0,

      foregroundSimilarity:
        0,

      backgroundSimilarity:
        0,

      outsideBackgroundSupport:
        0,

      insideForegroundSupport:
        0,

      gradientSupport:
        0,

      suggestedAlpha:
        candidate.originalAlpha,
    };
  }

  const center =
    readWeightedPixelV3(
      image,
      currentMask,
      candidate.x,
      candidate.y
    );

  const inside =
    buildDirectionalColorReferenceV3(
      image,
      currentMask,
      candidate.x,
      candidate.y,
      direction.normal,
      -1,
      config.sampling
    );

  const outside =
    buildDirectionalColorReferenceV3(
      image,
      currentMask,
      candidate.x,
      candidate.y,
      direction.normal,
      1,
      config.sampling
    );

  if (
    !center.valid ||
    !inside.valid ||
    !outside.valid
  ) {
    return {
      detected:
        false,

      confidence:
        0,

      foregroundSimilarity:
        0,

      backgroundSimilarity:
        0,

      outsideBackgroundSupport:
        0,

      insideForegroundSupport:
        0,

      gradientSupport:
        0,

      suggestedAlpha:
        candidate.originalAlpha,
    };
  }

  const centerToInside =
    calculateColorDistanceV3(
      center,
      inside,
      config.color
    );

  const centerToOutside =
    calculateColorDistanceV3(
      center,
      outside,
      config.color
    );

  const foregroundSimilarity =
    clampUnitValue(
      1 -
      centerToInside.combined
    );

  const backgroundSimilarity =
    clampUnitValue(
      1 -
      centerToOutside.combined
    );

  const outsideBackgroundSupport =
    clampUnitValue(
      1 -
      outside.maskValue
    );

  const insideForegroundSupport =
    clampUnitValue(
      inside.maskValue
    );

  const gradient =
    clampUnitValue(
      image.gradient[
        candidate.index
      ]
    );

  const gradientSupport =
    smoothStepV3(
      config
        .edge
        .minimumUsefulGradient,
      config
        .edge
        .strongGradientThreshold,
      gradient
    );

  const backgroundColorAdvantage =
    clampUnitValue(
      (
        centerToInside.combined -
        centerToOutside.combined
      ) *
      2 +
      0.5
    );

  const sourceAlpha =
    clampUnitValue(
      sourceMask.data[
        candidate.index
      ]
    );

  const currentAlpha =
    clampUnitValue(
      currentMask.data[
        candidate.index
      ]
    );

  const softEdgeSupport =
    1 -
    smoothStepV3(
      config
        .detection
        .strongForegroundThreshold,
      1,
      currentAlpha
    );

  const confidence =
    clampUnitValue(
      backgroundSimilarity *
        0.25 +
      backgroundColorAdvantage *
        0.24 +
      outsideBackgroundSupport *
        0.18 +
      insideForegroundSupport *
        0.13 +
      gradientSupport *
        0.12 +
      softEdgeSupport *
        0.08
    );

  const detected =
    currentAlpha >
      config
        .detection
        .strongBackgroundThreshold &&
    backgroundSimilarity >
      foregroundSimilarity +
        0.06 &&
    outsideBackgroundSupport >
      0.58 &&
    insideForegroundSupport >
      0.42 &&
    confidence >=
      0.58;

  const maximumReduction =
    config
      .decision
      .maximumAlphaReduction *
    0.42;

  const reductionStrength =
    smoothStepV3(
      0.58,
      0.9,
      confidence
    );

  const suggestedAlpha =
    detected
      ? clampUnitValue(
          Math.max(
            config
              .decision
              .maximumStrongBackgroundAlpha,
            currentAlpha -
              maximumReduction *
              reductionStrength
          )
        )
      : currentAlpha;

  return {
    detected,

    confidence,

    foregroundSimilarity,

    backgroundSimilarity,

    outsideBackgroundSupport,

    insideForegroundSupport,

    gradientSupport,

    suggestedAlpha:
      Math.min(
        sourceAlpha,
        suggestedAlpha
      ),
  };
}

/* =========================================================
 * Edge consistency analysis
 * ======================================================= */

function analyzeEdgeConsistencyEvidenceV3(
  mask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelEdgeConsistencyEvidenceV3 {
  const neighborhood =
    analyzeBoundaryNeighborhoodV3(
      mask,
      candidate.x,
      candidate.y,
      1,
      config.detection
    );

  const alpha =
    clampUnitValue(
      mask.data[
        candidate.index
      ]
    );

  const localRange =
    neighborhood
      .maximumAlpha -
    neighborhood
      .minimumAlpha;

  const peakDifference =
    alpha -
    neighborhood
      .medianAlpha;

  const valleyDifference =
    neighborhood
      .medianAlpha -
    alpha;

  const isolatedPeak =
    peakDifference >
      0.16 &&
    neighborhood
      .foregroundCount <=
      2;

  const isolatedValley =
    valleyDifference >
      0.16 &&
    neighborhood
      .backgroundCount <=
      2;

  const jagged =
    localRange >
      0.48 &&
    neighborhood
      .softCount <=
      2 &&
    (
      Math.abs(
        alpha -
        neighborhood
          .averageAlpha
      ) >
      0.14
    );

  const medianAgreement =
    1 -
    clampUnitValue(
      Math.abs(
        alpha -
        neighborhood
          .medianAlpha
      )
    );

  const averageAgreement =
    1 -
    clampUnitValue(
      Math.abs(
        alpha -
        neighborhood
          .averageAlpha
      )
    );

  const consistency =
    clampUnitValue(
      medianAgreement *
        0.6 +
      averageAgreement *
        0.4
    );

  let suggestedAlpha =
    alpha;

  if (isolatedPeak) {
    suggestedAlpha =
      lerpV3(
        alpha,
        neighborhood
          .medianAlpha,
        0.68
      );
  } else if (
    isolatedValley
  ) {
    suggestedAlpha =
      lerpV3(
        alpha,
        neighborhood
          .medianAlpha,
        0.48
      );
  } else if (jagged) {
    suggestedAlpha =
      lerpV3(
        alpha,
        neighborhood
          .medianAlpha,
        0.36
      );
  }

  return {
    isolatedPeak,

    isolatedValley,

    jagged,

    consistency,

    suggestedAlpha:
      clampUnitValue(
        suggestedAlpha
      ),
  };
}

/* =========================================================
 * Candidate lookup
 * ======================================================= */

function createCandidateLookupV3(
  candidates:
    readonly BoundarySubPixelCandidateV3[]
): ReadonlyMap<
  number,
  BoundarySubPixelCandidateV3
> {
  const lookup =
    new Map<
      number,
      BoundarySubPixelCandidateV3
    >();

  for (
    const candidate of candidates
  ) {
    lookup.set(
      candidate.index,
      candidate
    );
  }

  return lookup;
}

/* =========================================================
 * Single polish decision
 * ======================================================= */

function createBoundaryPolishUpdateV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  sourceMask:
    SegmentationFloatMask,
  currentMask:
    SegmentationFloatMask,
  candidate:
    BoundarySubPixelCandidateV3,
  protectedLookup:
    ReadonlyMap<
      number,
      BoundarySubPixelAppliedUpdateV3
    >,
  config:
    BoundarySubPixelRefinerConfigV3
): BoundarySubPixelPolishUpdateV3 {
  const originalAlpha =
    clampUnitValue(
      sourceMask.data[
        candidate.index
      ]
    );

  const inputAlpha =
    clampUnitValue(
      currentMask.data[
        candidate.index
      ]
    );

  const protectedUpdate =
    protectedLookup.get(
      candidate.index
    );

  const isProtected =
    Boolean(
      protectedUpdate
    );

  const halo =
    analyzeHaloEvidenceV3(
      image,
      sourceMask,
      currentMask,
      candidate,
      config
    );

  const consistency =
    analyzeEdgeConsistencyEvidenceV3(
      currentMask,
      candidate,
      config
    );

  if (
    halo.detected &&
    !isProtected
  ) {
    const confidence =
      halo.confidence;

    const strength =
      smoothStepV3(
        0.58,
        0.92,
        confidence
      );

    const targetAlpha =
      Math.min(
        inputAlpha,
        halo.suggestedAlpha
      );

    const finalAlpha =
      clampUnitValue(
        lerpV3(
          inputAlpha,
          targetAlpha,
          strength
        )
      );

    return {
      index:
        candidate.index,

      x:
        candidate.x,

      y:
        candidate.y,

      originalAlpha,

      inputAlpha,

      targetAlpha,

      finalAlpha,

      confidence,

      kind:
        'anti-halo',

      isProtected:
        false,

      reason:
        'background-colored-edge-halo',
    };
  }

  if (
    consistency.isolatedPeak &&
    !isProtected
  ) {
    return {
      index:
        candidate.index,

      x:
        candidate.x,

      y:
        candidate.y,

      originalAlpha,

      inputAlpha,

      targetAlpha:
        consistency
          .suggestedAlpha,

      finalAlpha:
        clampUnitValue(
          lerpV3(
            inputAlpha,
            consistency
              .suggestedAlpha,
            0.7
          )
        ),

      confidence:
        1 -
        consistency
          .consistency,

      kind:
        'edge-consistency',

      isProtected:
        false,

      reason:
        'isolated-alpha-peak',
    };
  }

  if (
    consistency.jagged &&
    !isProtected
  ) {
    return {
      index:
        candidate.index,

      x:
        candidate.x,

      y:
        candidate.y,

      originalAlpha,

      inputAlpha,

      targetAlpha:
        consistency
          .suggestedAlpha,

      finalAlpha:
        clampUnitValue(
          lerpV3(
            inputAlpha,
            consistency
              .suggestedAlpha,
            0.42
          )
        ),

      confidence:
        1 -
        consistency
          .consistency,

      kind:
        'jagged-suppression',

      isProtected:
        false,

      reason:
        'locally-jagged-boundary',
    };
  }

  return {
    index:
      candidate.index,

    x:
      candidate.x,

    y:
      candidate.y,

    originalAlpha,

    inputAlpha,

    targetAlpha:
      inputAlpha,

    finalAlpha:
      inputAlpha,

    confidence:
      isProtected
        ? 1
        : consistency
            .consistency,

    kind:
      'preserve',

    isProtected,

    reason:
      isProtected
        ? 'protected-boundary-detail'
        : 'no-safe-polish-change',
  };
}

/* =========================================================
 * Polish update conflict
 * ======================================================= */

function comparePolishUpdatesV3(
  first:
    BoundarySubPixelPolishUpdateV3,
  second:
    BoundarySubPixelPolishUpdateV3
): number {
  const kindPriority = (
    update:
      BoundarySubPixelPolishUpdateV3
  ): number => {
    switch (update.kind) {
      case 'anti-halo':
        return 1;

      case 'edge-consistency':
        return 0.8;

      case 'jagged-suppression':
        return 0.7;

      case 'preserve':
      default:
        return 0;
    }
  };

  const firstPriority =
    kindPriority(
      first
    );

  const secondPriority =
    kindPriority(
      second
    );

  if (
    firstPriority !==
    secondPriority
  ) {
    return (
      secondPriority -
      firstPriority
    );
  }

  if (
    Math.abs(
      first.confidence -
      second.confidence
    ) >
    SUB_PIXEL_EPSILON_V3
  ) {
    return (
      second.confidence -
      first.confidence
    );
  }

  return (
    first.index -
    second.index
  );
}

/* =========================================================
 * Apply polish updates
 * ======================================================= */

function applyBoundaryPolishUpdatesV3(
  sourceMask:
    SegmentationFloatMask,
  inputMask:
    SegmentationFloatMask,
  updates:
    readonly BoundarySubPixelPolishUpdateV3[],
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelPolishResultV3 {
  const output =
    cloneFloatMask(
      inputMask
    );

  const grouped =
    new Map<
      number,
      BoundarySubPixelPolishUpdateV3[]
    >();

  for (
    const update of updates
  ) {
    const existing =
      grouped.get(
        update.index
      );

    if (existing) {
      existing.push(
        update
      );
    } else {
      grouped.set(
        update.index,
        [
          update,
        ]
      );
    }
  }

  const resolvedUpdates:
    BoundarySubPixelPolishUpdateV3[] = [];

  let changedPixelCount =
    0;

  let haloRemovedPixelCount =
    0;

  let consistencyAdjustedPixelCount =
    0;

  let jaggedSuppressedPixelCount =
    0;

  let protectedPixelCount =
    0;

  let totalAlphaReduction =
    0;

  let totalAlphaIncrease =
    0;

  let absoluteChangeSum =
    0;

  let maximumAbsoluteChange =
    0;

  let operation =
    0;

  for (
    const pixelUpdates of
      grouped.values()
  ) {
    operation +=
      1;

    if (
      shouldCheckCancellationV3(
        operation,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    pixelUpdates.sort(
      comparePolishUpdatesV3
    );

    const selected =
      pixelUpdates[0];

    const inputAlpha =
      clampUnitValue(
        inputMask.data[
          selected.index
        ]
      );

    const originalAlpha =
      clampUnitValue(
        sourceMask.data[
          selected.index
        ]
      );

    let finalAlpha =
      clampUnitValue(
        selected.finalAlpha
      );

    if (
      selected.isProtected
    ) {
      finalAlpha =
        inputAlpha;

      protectedPixelCount +=
        1;
    }

    /**
     * الـPolish لا يسمح بزيادة التغيير الكلي
     * بعيدًا عن الماسك الأصلي بدرجة خطرة.
     */
    const maximumReduction =
      config
        .decision
        .maximumAlphaReduction *
      0.48;

    const maximumIncrease =
      config
        .decision
        .maximumAlphaIncrease *
      0.34;

    finalAlpha =
      clampSegmentationValue(
        finalAlpha,
        Math.max(
          0,
          originalAlpha -
          maximumReduction
        ),
        Math.min(
          1,
          originalAlpha +
          maximumIncrease
        )
      );

    const change =
      finalAlpha -
      inputAlpha;

    const absoluteChange =
      Math.abs(
        change
      );

    if (
      absoluteChange <
      0.0015
    ) {
      finalAlpha =
        inputAlpha;
    }

    output.data[
      selected.index
    ] =
      finalAlpha;

    const appliedChange =
      finalAlpha -
      inputAlpha;

    const appliedAbsoluteChange =
      Math.abs(
        appliedChange
      );

    if (
      appliedAbsoluteChange >
      SUB_PIXEL_EPSILON_V3
    ) {
      changedPixelCount +=
        1;

      absoluteChangeSum +=
        appliedAbsoluteChange;

      maximumAbsoluteChange =
        Math.max(
          maximumAbsoluteChange,
          appliedAbsoluteChange
        );

      if (
        appliedChange < 0
      ) {
        totalAlphaReduction +=
          -appliedChange;
      } else {
        totalAlphaIncrease +=
          appliedChange;
      }

      switch (selected.kind) {
        case 'anti-halo':
          haloRemovedPixelCount +=
            1;
          break;

        case 'edge-consistency':
          consistencyAdjustedPixelCount +=
            1;
          break;

        case 'jagged-suppression':
          jaggedSuppressedPixelCount +=
            1;
          break;

        case 'preserve':
        default:
          break;
      }
    }

    resolvedUpdates.push({
      ...selected,

      inputAlpha,

      finalAlpha,

      originalAlpha,
    });
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return {
    mask:
      output,

    updates:
      resolvedUpdates,

    changedPixelCount,

    haloRemovedPixelCount,

    consistencyAdjustedPixelCount,

    jaggedSuppressedPixelCount,

    protectedPixelCount,

    totalAlphaReduction,

    totalAlphaIncrease,

    averageAbsoluteChange:
      changedPixelCount > 0
        ? absoluteChangeSum /
          changedPixelCount
        : 0,

    maximumAbsoluteChange,
  };
}

/* =========================================================
 * Build and apply final polish
 * ======================================================= */

function polishBoundarySubPixelsV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  sourceMask:
    SegmentationFloatMask,
  inputResult:
    BoundarySubPixelApplyPlanResultV3,
  candidates:
    readonly BoundarySubPixelCandidateV3[],
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelPolishResultV3 {
  if (
    candidates.length === 0
  ) {
    return {
      mask:
        cloneFloatMask(
          inputResult.mask
        ),

      updates:
        [],

      changedPixelCount:
        0,

      haloRemovedPixelCount:
        0,

      consistencyAdjustedPixelCount:
        0,

      jaggedSuppressedPixelCount:
        0,

      protectedPixelCount:
        0,

      totalAlphaReduction:
        0,

      totalAlphaIncrease:
        0,

      averageAbsoluteChange:
        0,

      maximumAbsoluteChange:
        0,
    };
  }

  const protectedLookup =
    createProtectedPixelLookupV3(
      inputResult
        .appliedUpdates
    );

  const updates:
    BoundarySubPixelPolishUpdateV3[] =
      new Array(
        candidates.length
      );

  for (
    let index =
      0;
    index <
      candidates.length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    updates[index] =
      createBoundaryPolishUpdateV3(
        image,
        sourceMask,
        inputResult.mask,
        candidates[index],
        protectedLookup,
        config
      );
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  return applyBoundaryPolishUpdatesV3(
    sourceMask,
    inputResult.mask,
    updates,
    config,
    cancellationSignal
  );
}

/* =========================================================
 * Polish diagnostics
 * ======================================================= */

function applyPolishToPassDiagnosticsV3(
  passDiagnostics:
    BoundarySubPixelPassDiagnosticsV3,
  polishResult:
    BoundarySubPixelPolishResultV3
): void {
  passDiagnostics
    .totalAlphaReduction +=
    polishResult
      .totalAlphaReduction;

  passDiagnostics
    .totalAlphaIncrease +=
    polishResult
      .totalAlphaIncrease;

  passDiagnostics
    .maximumAbsoluteChange =
    Math.max(
      passDiagnostics
        .maximumAbsoluteChange,
      polishResult
        .maximumAbsoluteChange
    );

  if (
    polishResult
      .changedPixelCount >
    0
  ) {
    const existingChanged =
      Math.max(
        0,
        passDiagnostics
          .removedLeakPixels +
        passDiagnostics
          .recoveredForegroundPixels +
        passDiagnostics
          .softenedPixels
      );

    const totalChanged =
      existingChanged +
      polishResult
        .changedPixelCount;

    passDiagnostics
      .averageAbsoluteChange =
      totalChanged > 0
        ? (
            passDiagnostics
              .averageAbsoluteChange *
              existingChanged +
            polishResult
              .averageAbsoluteChange *
              polishResult
                .changedPixelCount
          ) /
          totalChanged
        : 0;
  }
}

/* =========================================================
 * Polish warnings
 * ======================================================= */

function appendPolishWarningsV3(
  warnings:
    string[],
  polishResult:
    BoundarySubPixelPolishResultV3,
  candidateCount:
    number,
  config:
    BoundarySubPixelRefinerConfigV3
): void {
  const maximumWarnings =
    config
      .runtime
      .maximumWarnings;

  if (
    polishResult
      .changedPixelCount >
    candidateCount *
      0.7
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 polish modified a large fraction of boundary candidates.',
      maximumWarnings
    );
  }

  if (
    polishResult
      .haloRemovedPixelCount >
    candidateCount *
      0.5
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 detected widespread boundary halo evidence.',
      maximumWarnings
    );
  }

  if (
    polishResult
      .maximumAbsoluteChange >
    config
      .decision
      .maximumAlphaReduction *
      0.55
  ) {
    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 polish produced a large local Alpha adjustment.',
      maximumWarnings
    );
  }
}

/* =========================================================
 * Part 4A-3A internal references
 * ======================================================= */

const BOUNDARY_SUB_PIXEL_PART_4A_3A_INTERNALS_V3 = {
  sortNumericAscendingV3,

  analyzeBoundaryNeighborhoodV3,

  createProtectedPixelLookupV3,

  readWeightedPixelV3,

  buildDirectionalColorReferenceV3,

  analyzeHaloEvidenceV3,

  analyzeEdgeConsistencyEvidenceV3,

  createCandidateLookupV3,

  createBoundaryPolishUpdateV3,

  comparePolishUpdatesV3,

  applyBoundaryPolishUpdatesV3,

  polishBoundarySubPixelsV3,

  applyPolishToPassDiagnosticsV3,

  appendPolishWarningsV3,
};

void BOUNDARY_SUB_PIXEL_PART_4A_3A_INTERNALS_V3;

// End of Part 4A-3A
// scan/core/ai/BoundarySubPixelRefinerV3.ts
// Part 4A-3B - Final
//
// يكمل مباشرة بعد:
//
// // End of Part 4A-3A
//
// هذا الجزء مسؤول عن:
//
// 1) قياس تغير مساحة الماسك.
// 2) منع الانكماش أو التوسع غير الآمن.
// 3) إنهاء تمريرة واحدة كاملة.
// 4) تشغيل عدة تمريرات عند الحاجة.
// 5) تجميع Diagnostics النهائية.
// 6) التحقق النهائي من الماسك.
// 7) Public API النهائية.
//
// بعد لصق هذا الجزء يكون الملف كاملًا.

/* =========================================================
 * Mask measurement contracts
 * ======================================================= */

type BoundarySubPixelMaskMeasurementV3 = {
  minimumAlpha:
    number;

  maximumAlpha:
    number;

  averageAlpha:
    number;

  alphaSum:
    number;

  foregroundPixelCount:
    number;

  softPixelCount:
    number;

  backgroundPixelCount:
    number;

  foregroundRatio:
    number;

  softRatio:
    number;

  backgroundRatio:
    number;
};

type BoundarySubPixelAreaChangeV3 = {
  source:
    BoundarySubPixelMaskMeasurementV3;

  refined:
    BoundarySubPixelMaskMeasurementV3;

  foregroundPixelDelta:
    number;

  foregroundRatioDelta:
    number;

  alphaSumDelta:
    number;

  alphaSumRatioDelta:
    number;

  shrinkRatio:
    number;

  expansionRatio:
    number;

  excessiveShrink:
    boolean;

  excessiveExpansion:
    boolean;

  safe:
    boolean;
};

type BoundarySubPixelAreaGuardResultV3 = {
  mask:
    SegmentationFloatMask;

  measurement:
    BoundarySubPixelAreaChangeV3;

  guardApplied:
    boolean;

  restoredPixelCount:
    number;

  limitedPixelCount:
    number;

  blendStrength:
    number;
};

type BoundarySubPixelSinglePassResultV3 = {
  mask:
    SegmentationFloatMask;

  candidates:
    readonly BoundarySubPixelCandidateV3[];

  analyses:
    readonly BoundarySubPixelCandidateAnalysisV3[];

  decisions:
    readonly BoundarySubPixelDecisionV3[];

  plan:
    BoundarySubPixelUpdatePlanV3;

  applyResult:
    BoundarySubPixelApplyPlanResultV3;

  polishResult:
    BoundarySubPixelPolishResultV3;

  areaGuard:
    BoundarySubPixelAreaGuardResultV3;

  diagnostics:
    BoundarySubPixelPassDiagnosticsV3;

  warnings:
    readonly string[];
};

/* =========================================================
 * Mask measurements
 * ======================================================= */

function measureBoundarySubPixelMaskV3(
  mask:
    SegmentationFloatMask,
  detectionConfig:
    BoundarySubPixelDetectionConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined,
  cancellationInterval:
    number
): BoundarySubPixelMaskMeasurementV3 {
  let minimumAlpha =
    1;

  let maximumAlpha =
    0;

  let alphaSum =
    0;

  let foregroundPixelCount =
    0;

  let softPixelCount =
    0;

  let backgroundPixelCount =
    0;

  for (
    let index =
      0;
    index <
      mask.data.length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        cancellationInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const alpha =
      clampUnitValue(
        finiteOrV3(
          mask.data[index],
          0
        )
      );

    minimumAlpha =
      Math.min(
        minimumAlpha,
        alpha
      );

    maximumAlpha =
      Math.max(
        maximumAlpha,
        alpha
      );

    alphaSum +=
      alpha;

    if (
      alpha >=
      detectionConfig
        .strongForegroundThreshold
    ) {
      foregroundPixelCount +=
        1;
    } else if (
      alpha <=
      detectionConfig
        .strongBackgroundThreshold
    ) {
      backgroundPixelCount +=
        1;
    } else {
      softPixelCount +=
        1;
    }
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  const pixelCount =
    Math.max(
      1,
      mask.data.length
    );

  return {
    minimumAlpha:
      clampUnitValue(
        minimumAlpha
      ),

    maximumAlpha:
      clampUnitValue(
        maximumAlpha
      ),

    averageAlpha:
      clampUnitValue(
        alphaSum /
        pixelCount
      ),

    alphaSum,

    foregroundPixelCount,

    softPixelCount,

    backgroundPixelCount,

    foregroundRatio:
      foregroundPixelCount /
      pixelCount,

    softRatio:
      softPixelCount /
      pixelCount,

    backgroundRatio:
      backgroundPixelCount /
      pixelCount,
  };
}

/* =========================================================
 * Area change analysis
 * ======================================================= */

function analyzeBoundarySubPixelAreaChangeV3(
  sourceMask:
    SegmentationFloatMask,
  refinedMask:
    SegmentationFloatMask,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelAreaChangeV3 {
  const source =
    measureBoundarySubPixelMaskV3(
      sourceMask,
      config.detection,
      cancellationSignal,
      config
        .runtime
        .cancellationCheckInterval
    );

  const refined =
    measureBoundarySubPixelMaskV3(
      refinedMask,
      config.detection,
      cancellationSignal,
      config
        .runtime
        .cancellationCheckInterval
    );

  const foregroundPixelDelta =
    refined
      .foregroundPixelCount -
    source
      .foregroundPixelCount;

  const foregroundRatioDelta =
    refined.foregroundRatio -
    source.foregroundRatio;

  const alphaSumDelta =
    refined.alphaSum -
    source.alphaSum;

  const alphaSumRatioDelta =
    safeDivideV3(
      alphaSumDelta,
      Math.max(
        source.alphaSum,
        SUB_PIXEL_EPSILON_V3
      ),
      0
    );

  const shrinkRatio =
    foregroundPixelDelta < 0
      ? safeDivideV3(
          -foregroundPixelDelta,
          Math.max(
            1,
            source
              .foregroundPixelCount
          ),
          0
        )
      : 0;

  const expansionRatio =
    foregroundPixelDelta > 0
      ? safeDivideV3(
          foregroundPixelDelta,
          Math.max(
            1,
            source
              .foregroundPixelCount
          ),
          0
        )
      : 0;

  /**
   * الطبقة تعمل فقط على الحافة، لذلك أي تغير
   * أكبر من هذه النسب يعتبر غير طبيعي.
   */
  const maximumSafeShrinkRatio =
    0.012;

  const maximumSafeExpansionRatio =
    0.008;

  const maximumSafeAlphaLossRatio =
    0.018;

  const maximumSafeAlphaGainRatio =
    0.012;

  const excessiveShrink =
    shrinkRatio >
      maximumSafeShrinkRatio ||
    alphaSumRatioDelta <
      -maximumSafeAlphaLossRatio;

  const excessiveExpansion =
    expansionRatio >
      maximumSafeExpansionRatio ||
    alphaSumRatioDelta >
      maximumSafeAlphaGainRatio;

  return {
    source,

    refined,

    foregroundPixelDelta,

    foregroundRatioDelta,

    alphaSumDelta,

    alphaSumRatioDelta,

    shrinkRatio,

    expansionRatio,

    excessiveShrink,

    excessiveExpansion,

    safe:
      !excessiveShrink &&
      !excessiveExpansion,
  };
}

/* =========================================================
 * Area guard blend strength
 * ======================================================= */

function calculateAreaGuardBlendStrengthV3(
  measurement:
    BoundarySubPixelAreaChangeV3
): number {
  if (measurement.safe) {
    return 1;
  }

  if (
    measurement
      .excessiveShrink
  ) {
    const shrinkSeverity =
      clampUnitValue(
        measurement
          .shrinkRatio /
        0.03
      );

    const alphaSeverity =
      clampUnitValue(
        Math.max(
          0,
          -measurement
            .alphaSumRatioDelta
        ) /
        0.04
      );

    const severity =
      Math.max(
        shrinkSeverity,
        alphaSeverity
      );

    return clampSegmentationValue(
      1 -
      severity *
        0.78,
      0.12,
      0.72
    );
  }

  const expansionSeverity =
    clampUnitValue(
      measurement
        .expansionRatio /
      0.025
    );

  const alphaSeverity =
    clampUnitValue(
      Math.max(
        0,
        measurement
          .alphaSumRatioDelta
      ) /
      0.03
    );

  const severity =
    Math.max(
      expansionSeverity,
      alphaSeverity
    );

  return clampSegmentationValue(
    1 -
    severity *
      0.82,
    0.1,
    0.68
  );
}

/* =========================================================
 * Per-pixel area guard
 * ======================================================= */

function applyBoundarySubPixelAreaGuardV3(
  sourceMask:
    SegmentationFloatMask,
  refinedMask:
    SegmentationFloatMask,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelAreaGuardResultV3 {
  const measurement =
    analyzeBoundarySubPixelAreaChangeV3(
      sourceMask,
      refinedMask,
      config,
      cancellationSignal
    );

  if (measurement.safe) {
    return {
      mask:
        cloneFloatMask(
          refinedMask
        ),

      measurement,

      guardApplied:
        false,

      restoredPixelCount:
        0,

      limitedPixelCount:
        0,

      blendStrength:
        1,
    };
  }

  const output =
    cloneFloatMask(
      refinedMask
    );

  const blendStrength =
    calculateAreaGuardBlendStrengthV3(
      measurement
    );

  let restoredPixelCount =
    0;

  let limitedPixelCount =
    0;

  for (
    let index =
      0;
    index <
      output.data.length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        config
          .runtime
          .cancellationCheckInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const sourceAlpha =
      clampUnitValue(
        sourceMask.data[index]
      );

    const refinedAlpha =
      clampUnitValue(
        refinedMask.data[index]
      );

    const signedChange =
      refinedAlpha -
      sourceAlpha;

    if (
      Math.abs(
        signedChange
      ) <=
      SUB_PIXEL_EPSILON_V3
    ) {
      continue;
    }

    let guardedAlpha =
      refinedAlpha;

    if (
      measurement
        .excessiveShrink &&
      signedChange < 0
    ) {
      guardedAlpha =
        lerpV3(
          sourceAlpha,
          refinedAlpha,
          blendStrength
        );

      /**
       * البكسلات القوية في المصدر لا يسمح
       * بتحويلها فجأة إلى خلفية قوية.
       */
      if (
        sourceAlpha >=
          config
            .detection
            .strongForegroundThreshold &&
        guardedAlpha <=
          config
            .detection
            .strongBackgroundThreshold
      ) {
        guardedAlpha =
          Math.max(
            guardedAlpha,
            config
              .decision
              .minimumProtectedForegroundAlpha
          );

        restoredPixelCount +=
          1;
      }

      limitedPixelCount +=
        1;
    } else if (
      measurement
        .excessiveExpansion &&
      signedChange > 0
    ) {
      guardedAlpha =
        lerpV3(
          sourceAlpha,
          refinedAlpha,
          blendStrength
        );

      /**
       * الخلفية القوية لا تتحول مباشرة
       * إلى Foreground قوي.
       */
      if (
        sourceAlpha <=
          config
            .detection
            .strongBackgroundThreshold &&
        guardedAlpha >=
          config
            .detection
            .strongForegroundThreshold
      ) {
        guardedAlpha =
          Math.min(
            guardedAlpha,
            0.5
          );

        restoredPixelCount +=
          1;
      }

      limitedPixelCount +=
        1;
    }

    output.data[index] =
      clampUnitValue(
        guardedAlpha
      );
  }

  assertNotCancelledV3(
    cancellationSignal
  );

  const guardedMeasurement =
    analyzeBoundarySubPixelAreaChangeV3(
      sourceMask,
      output,
      config,
      cancellationSignal
    );

  return {
    mask:
      output,

    measurement:
      guardedMeasurement,

    guardApplied:
      true,

    restoredPixelCount,

    limitedPixelCount,

    blendStrength,
  };
}

/* =========================================================
 * Final mask validation
 * ======================================================= */

function assertValidBoundarySubPixelOutputMaskV3(
  mask:
    SegmentationFloatMask,
  expectedWidth:
    number,
  expectedHeight:
    number,
  requestId:
    string | undefined,
  cancellationSignal:
    SegmentationCancellationSignal | undefined,
  cancellationInterval:
    number
): void {
  if (!isValidFloatMask(mask)) {
    throw new SegmentationError(
      'MASK_INVALID',
      'BoundarySubPixelRefinerV3 produced an invalid output mask.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,
      }
    );
  }

  if (
    mask.width !==
      expectedWidth ||
    mask.height !==
      expectedHeight
  ) {
    throw new SegmentationError(
      'MASK_INVALID',
      'BoundarySubPixelRefinerV3 changed the output mask dimensions.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,

        metadata: {
          expectedWidth,

          expectedHeight,

          actualWidth:
            mask.width,

          actualHeight:
            mask.height,
        },
      }
    );
  }

  let nonZeroPixelCount =
    0;

  for (
    let index =
      0;
    index <
      mask.data.length;
    index +=
      1
  ) {
    if (
      shouldCheckCancellationV3(
        index,
        cancellationInterval
      )
    ) {
      assertNotCancelledV3(
        cancellationSignal
      );
    }

    const value =
      mask.data[index];

    if (
      !Number.isFinite(value)
    ) {
      throw new SegmentationError(
        'MASK_INVALID',
        'BoundarySubPixelRefinerV3 produced a non-finite Alpha value.',
        {
          requestId,

          stage:
            'refine-alpha-mask',

          retryable:
            false,

          metadata: {
            pixelIndex:
              index,
          },
        }
      );
    }

    if (
      value < 0 ||
      value > 1
    ) {
      mask.data[index] =
        clampUnitValue(
          value
        );
    }

    if (
      mask.data[index] >
      0.001
    ) {
      nonZeroPixelCount +=
        1;
    }
  }

  if (
    nonZeroPixelCount === 0
  ) {
    throw new SegmentationError(
      'MASK_EMPTY',
      'BoundarySubPixelRefinerV3 produced an empty mask.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          true,
      }
    );
  }

  assertNotCancelledV3(
    cancellationSignal
  );
}

/* =========================================================
 * Single pass
 * ======================================================= */

function runBoundarySubPixelPassV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  sourceMask:
    SegmentationFloatMask,
  passNumber:
    number,
  config:
    BoundarySubPixelRefinerConfigV3,
  cancellationSignal:
    SegmentationCancellationSignal | undefined
): BoundarySubPixelSinglePassResultV3 {
  const startedAt =
    Date.now();

  const warnings:
    string[] = [];

  const passDiagnostics =
    createPassDiagnosticsV3(
      passNumber
    );

  assertNotCancelledV3(
    cancellationSignal
  );

  const candidates =
    buildBoundarySubPixelCandidatesV3(
      image,
      sourceMask,
      config,
      cancellationSignal
    );

  passDiagnostics
    .candidateCount =
    candidates.length;

  if (
    candidates.length === 0
  ) {
    passDiagnostics.durationMs =
      Math.max(
        0,
        Date.now() -
          startedAt
      );

    pushWarningV3(
      warnings,
      'BoundarySubPixelRefinerV3 found no editable boundary candidates.',
      config
        .runtime
        .maximumWarnings
    );

    const emptyPlan:
      BoundarySubPixelUpdatePlanV3 = {
        updates:
          [],

        conflicts:
          [],

        updateByPixel:
          new Map(),

        requestedUpdateCount:
          0,

        resolvedUpdateCount:
          0,

        conflictCount:
          0,

        reductionCount:
          0,

        increaseCount:
          0,

        softAdjustmentCount:
          0,

        preserveCount:
          0,

        rejectedCount:
          0,
      };

    const emptyApply:
      BoundarySubPixelApplyPlanResultV3 = {
        mask:
          cloneFloatMask(
            sourceMask
          ),

        appliedUpdates:
          [],

        changedPixelCount:
          0,

        reducedPixelCount:
          0,

        increasedPixelCount:
          0,

        suppressedPixelCount:
          0,

        totalReduction:
          0,

        totalIncrease:
          0,

        averageAbsoluteChange:
          0,

        maximumAbsoluteChange:
          0,
      };

    const emptyPolish:
      BoundarySubPixelPolishResultV3 = {
        mask:
          cloneFloatMask(
            sourceMask
          ),

        updates:
          [],

        changedPixelCount:
          0,

        haloRemovedPixelCount:
          0,

        consistencyAdjustedPixelCount:
          0,

        jaggedSuppressedPixelCount:
          0,

        protectedPixelCount:
          0,

        totalAlphaReduction:
          0,

        totalAlphaIncrease:
          0,

        averageAbsoluteChange:
          0,

        maximumAbsoluteChange:
          0,
      };

    const emptyAreaGuard =
      applyBoundarySubPixelAreaGuardV3(
        sourceMask,
        sourceMask,
        config,
        cancellationSignal
      );

    return {
      mask:
        cloneFloatMask(
          sourceMask
        ),

      candidates,

      analyses:
        [],

      decisions:
        [],

      plan:
        emptyPlan,

      applyResult:
        emptyApply,

      polishResult:
        emptyPolish,

      areaGuard:
        emptyAreaGuard,

      diagnostics:
        passDiagnostics,

      warnings,
    };
  }

  const passPlan =
    createBoundarySubPixelPassPlanV3(
      image,
      sourceMask,
      candidates,
      config,
      cancellationSignal,
      passDiagnostics,
      warnings
    );

  const applyResult =
    applyBoundarySubPixelUpdatePlanV3(
      sourceMask,
      passPlan.plan,
      config,
      cancellationSignal
    );

  applyResultToPassDiagnosticsV3(
    passDiagnostics,
    applyResult
  );

  appendApplyResultWarningsV3(
    warnings,
    applyResult,
    passPlan.plan,
    config
  );

  const polishResult =
    polishBoundarySubPixelsV3(
      image,
      sourceMask,
      applyResult,
      candidates,
      config,
      cancellationSignal
    );

  applyPolishToPassDiagnosticsV3(
    passDiagnostics,
    polishResult
  );

  appendPolishWarningsV3(
    warnings,
    polishResult,
    candidates.length,
    config
  );

  const areaGuard =
    applyBoundarySubPixelAreaGuardV3(
      sourceMask,
      polishResult.mask,
      config,
      cancellationSignal
    );

  if (
    areaGuard.guardApplied
  ) {
    if (
      areaGuard
        .measurement
        .excessiveShrink
    ) {
      pushWarningV3(
        warnings,
        'BoundarySubPixelRefinerV3 limited excessive foreground shrinkage.',
        config
          .runtime
          .maximumWarnings
      );
    }

    if (
      areaGuard
        .measurement
        .excessiveExpansion
    ) {
      pushWarningV3(
        warnings,
        'BoundarySubPixelRefinerV3 limited excessive foreground expansion.',
        config
          .runtime
          .maximumWarnings
      );
    }
  }

  assertValidBoundarySubPixelOutputMaskV3(
    areaGuard.mask,
    sourceMask.width,
    sourceMask.height,
    undefined,
    cancellationSignal,
    config
      .runtime
      .cancellationCheckInterval
  );

  passDiagnostics.durationMs =
    Math.max(
      0,
      Date.now() -
        startedAt
    );

  return {
    mask:
      areaGuard.mask,

    candidates,

    analyses:
      passPlan.analyses,

    decisions:
      passPlan.decisions,

    plan:
      passPlan.plan,

    applyResult,

    polishResult,

    areaGuard,

    diagnostics:
      passDiagnostics,

    warnings,
  };
}

/* =========================================================
 * Pass continuation
 * ======================================================= */

function shouldRunAnotherBoundarySubPixelPassV3(
  passIndex:
    number,
  passResult:
    BoundarySubPixelSinglePassResultV3,
  config:
    BoundarySubPixelRefinerConfigV3
): boolean {
  const completedPasses =
    passIndex +
    1;

  if (
    completedPasses >=
    config.runtime.passes
  ) {
    return false;
  }

  if (
    passResult
      .candidates
      .length ===
    0
  ) {
    return false;
  }

  if (
    passResult
      .applyResult
      .changedPixelCount ===
      0 &&
    passResult
      .polishResult
      .changedPixelCount ===
      0
  ) {
    return false;
  }

  const averageChange =
    Math.max(
      passResult
        .applyResult
        .averageAbsoluteChange,
      passResult
        .polishResult
        .averageAbsoluteChange
    );

  if (
    averageChange <
    config
      .runtime
      .minimumAverageChangeForNextPass
  ) {
    return false;
  }

  return true;
}

/* =========================================================
 * Diagnostics aggregation
 * ======================================================= */

function aggregateBoundarySubPixelDiagnosticsV3(
  diagnostics:
    BoundarySubPixelDiagnosticsV3,
  passResults:
    readonly BoundarySubPixelSinglePassResultV3[],
  warnings:
    readonly string[],
  durationMs:
    number
): BoundarySubPixelDiagnosticsV3 {
  let totalCandidates =
    0;

  let totalAnalyzed =
    0;

  let totalRejected =
    0;

  let totalRemovedLeakPixels =
    0;

  let totalRecoveredForegroundPixels =
    0;

  let totalSoftenedPixels =
    0;

  let totalPreservedPixels =
    0;

  let totalUnchangedPixels =
    0;

  let totalProtectedThinPixels =
    0;

  let totalProtectedCornerPixels =
    0;

  let totalProtectedTexturePixels =
    0;

  let totalAlphaReduction =
    0;

  let totalAlphaIncrease =
    0;

  let weightedChangeSum =
    0;

  let weightedChangeCount =
    0;

  let maximumAbsoluteChange =
    0;

  const passes:
    BoundarySubPixelPassDiagnosticsV3[] = [];

  for (
    const passResult of
      passResults
  ) {
    const pass =
      passResult.diagnostics;

    passes.push(
      pass
    );

    totalCandidates +=
      pass.candidateCount;

    totalAnalyzed +=
      pass.analyzedCount;

    totalRejected +=
      pass.rejectedCount;

    totalRemovedLeakPixels +=
      pass.removedLeakPixels;

    totalRecoveredForegroundPixels +=
      pass.recoveredForegroundPixels;

    totalSoftenedPixels +=
      pass.softenedPixels;

    totalPreservedPixels +=
      pass.preservedPixels;

    totalUnchangedPixels +=
      pass.unchangedPixels;

    totalProtectedThinPixels +=
      pass.protectedThinPixels;

    totalProtectedCornerPixels +=
      pass.protectedCornerPixels;

    totalProtectedTexturePixels +=
      pass.protectedTexturePixels;

    totalAlphaReduction +=
      pass.totalAlphaReduction;

    totalAlphaIncrease +=
      pass.totalAlphaIncrease;

    maximumAbsoluteChange =
      Math.max(
        maximumAbsoluteChange,
        pass.maximumAbsoluteChange
      );

    const passChangedCount =
      passResult
        .applyResult
        .changedPixelCount +
      passResult
        .polishResult
        .changedPixelCount;

    if (
      passChangedCount >
      0
    ) {
      weightedChangeSum +=
        pass.averageAbsoluteChange *
        passChangedCount;

      weightedChangeCount +=
        passChangedCount;
    }
  }

  return {
    ...diagnostics,

    applied:
      totalRemovedLeakPixels >
        0 ||
      totalRecoveredForegroundPixels >
        0 ||
      totalSoftenedPixels >
        0 ||
      totalAlphaReduction >
        SUB_PIXEL_EPSILON_V3 ||
      totalAlphaIncrease >
        SUB_PIXEL_EPSILON_V3,

    totalCandidates,

    totalAnalyzed,

    totalRejected,

    totalRemovedLeakPixels,

    totalRecoveredForegroundPixels,

    totalSoftenedPixels,

    totalPreservedPixels,

    totalUnchangedPixels,

    totalProtectedThinPixels,

    totalProtectedCornerPixels,

    totalProtectedTexturePixels,

    totalAlphaReduction,

    totalAlphaIncrease,

    averageAbsoluteChange:
      weightedChangeCount > 0
        ? weightedChangeSum /
          weightedChangeCount
        : 0,

    maximumAbsoluteChange,

    passesCompleted:
      passResults.length,

    passes,

    warnings,

    durationMs,
  };
}

/* =========================================================
 * Public API
 * ======================================================= */

/**
 * يحسن آخر بكسلات الحافة فقط.
 *
 * لا يغير شكل الجسم الأساسي.
 * لا يطبق Erosion أو Dilation عامًا.
 * لا يستخدم قواعد خاصة بفئة معينة.
 *
 * يعمل على:
 *
 * - الملابس العلوية.
 * - البناطيل والشورتات.
 * - الفساتين والتنانير.
 * - الجاكيتات.
 * - الأحذية.
 * - الحقائب.
 * - الإكسسوارات.
 */
export function refineBoundarySubPixelsV3(
  request:
    BoundarySubPixelRefinerRequestV3
): BoundarySubPixelRefinerResultV3 {
  const startedAt =
    Date.now();

  const prepared =
    prepareBoundarySubPixelRequestV3(
      request
    );

  const config =
    prepared.config;

  const initialDiagnostics =
    createDiagnosticsV3(
      request.image.width,
      request.image.height,
      config.enabled
    );

  if (!config.enabled) {
    return {
      mask:
        cloneFloatMask(
          request.mask
        ),

      diagnostics: {
        ...initialDiagnostics,

        enabled:
          false,

        applied:
          false,

        durationMs:
          Math.max(
            0,
            Date.now() -
              startedAt
          ),
      },
    };
  }

  assertNotCancelledV3(
    request
      .cancellationSignal
  );

  let workingMask =
    prepared.workingMask;

  const passResults:
    BoundarySubPixelSinglePassResultV3[] = [];

  const warnings:
    string[] = [];

  for (
    let passIndex =
      0;
    passIndex <
      config.runtime.passes;
    passIndex +=
      1
  ) {
    assertNotCancelledV3(
      request
        .cancellationSignal
    );

    const passResult =
      runBoundarySubPixelPassV3(
        request.image,
        workingMask,
        passIndex + 1,
        config,
        request
          .cancellationSignal
      );

    passResults.push(
      passResult
    );

    for (
      const warning of
        passResult.warnings
    ) {
      pushWarningV3(
        warnings,
        warning,
        config
          .runtime
          .maximumWarnings
      );
    }

    workingMask =
      cloneFloatMask(
        passResult.mask
      );

    if (
      !shouldRunAnotherBoundarySubPixelPassV3(
        passIndex,
        passResult,
        config
      )
    ) {
      break;
    }

    if (
      !config
        .runtime
        .rebuildCandidatesBetweenPasses
    ) {
      break;
    }
  }

  assertValidBoundarySubPixelOutputMaskV3(
    workingMask,
    request.mask.width,
    request.mask.height,
    request.requestId,
    request
      .cancellationSignal,
    config
      .runtime
      .cancellationCheckInterval
  );

  assertNotCancelledV3(
    request
      .cancellationSignal
  );

  const durationMs =
    Math.max(
      0,
      Date.now() -
        startedAt
    );

  const diagnostics =
    aggregateBoundarySubPixelDiagnosticsV3(
      initialDiagnostics,
      passResults,
      warnings,
      durationMs
    );

  return {
    mask:
      workingMask,

    diagnostics,
  };
}

/* =========================================================
 * Convenience API
 * ======================================================= */

/**
 * Convenience API للربط السريع داخل PostprocessorV2.
 */
export function applyBoundarySubPixelRefinementV3(
  image:
    BoundarySubPixelAnalysisImageV3,
  mask:
    SegmentationFloatMask,
  cancellationSignal?:
    SegmentationCancellationSignal,
  requestId?:
    string,
  config?:
    Partial<BoundarySubPixelRefinerConfigV3>
): SegmentationFloatMask {
  return refineBoundarySubPixelsV3({
    image,

    mask,

    config,

    requestId,

    cancellationSignal,
  }).mask;
}

/* =========================================================
 * Final exports
 * ======================================================= */

export const BOUNDARY_SUB_PIXEL_REFINER_VERSION_V3 =
  '3.0.0';

export const BOUNDARY_SUB_PIXEL_REFINER_NAME_V3 =
  'Triple N Boundary Sub-Pixel Refiner V3';

/* =========================================================
 * Final internal references
 * ======================================================= */

const BOUNDARY_SUB_PIXEL_PART_4A_3B_INTERNALS_V3 = {
  measureBoundarySubPixelMaskV3,

  analyzeBoundarySubPixelAreaChangeV3,

  calculateAreaGuardBlendStrengthV3,

  applyBoundarySubPixelAreaGuardV3,

  assertValidBoundarySubPixelOutputMaskV3,

  runBoundarySubPixelPassV3,

  shouldRunAnotherBoundarySubPixelPassV3,

  aggregateBoundarySubPixelDiagnosticsV3,
};

void BOUNDARY_SUB_PIXEL_PART_4A_3B_INTERNALS_V3;

// End of BoundarySubPixelRefinerV3.ts