// scan/core/ai/AdaptiveEdgeRefinerV3.ts
// Part 1/2
//
// Triple N - Adaptive Edge Refiner V3
//
// هذه هي المرحلة الأخيرة في نظام
// Image-Guided Boundary Processing V3.
//
// مسؤوليات الملف:
//
// 1) إزالة الـHalo والـGlow حول القطعة.
// 2) حذف بقايا الخلفية القريبة من الحواف.
// 3) إزالة Pixels الطائرة والمعزولة.
// 4) حماية الحواف الحقيقية القوية.
// 5) الحفاظ على التفاصيل الرفيعة مثل:
//    - أربطة الكوتشي.
//    - الأكمام.
//    - ياقة القميص.
//    - حواف الملابس الرفيعة.
// 6) استخدام Confidence وEdge Continuity
//    بدل Threshold ثابت لكل الصورة.
// 7) إنتاج Float Mask نهائي جاهز للتحويل إلى Alpha.
//
// لا يعتمد الملف على مكتبات خارجية.
// جميع الخرائط Typed Arrays ومناسبة للموبايل.

import type {
    ImageGuidedAdaptiveEdgeConfigV3,
    ImageGuidedAdaptiveEdgeResultV3,
    ImageGuidedBoundaryFeatureMapV3,
    ImageGuidedConfidenceVotingResultV3,
    SegmentationFloatMask,
} from './types';

import {
    clampSegmentationValue,
    clampUnitValue,
    cloneFloatMask,
    isValidFloatMask,
} from './types';

import {
    isValidConfidenceVotingResultV3,
} from './ConfidenceVotingV3';

/* =========================================================
 * Public contracts
 * ======================================================= */

/**
 * مدخلات تحسين الحواف النهائي.
 */
export type AdaptiveEdgeRefinerInputV3 = {
  /**
   * نتيجة ConfidenceVotingV3.
   */
  votingResult:
    ImageGuidedConfidenceVotingResultV3;

  /**
   * خرائط خصائص الحدود.
   */
  featureMap:
    ImageGuidedBoundaryFeatureMapV3;

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
      ImageGuidedAdaptiveEdgeConfigV3
    >;
};

/**
 * نتيجة التنفيذ مع الوقت والإعدادات.
 */
export type AdaptiveEdgeRefinerExecutionV3 = {
  result:
    ImageGuidedAdaptiveEdgeResultV3;

  config:
    ImageGuidedAdaptiveEdgeConfigV3;

  durationMs: number;
};

/**
 * تفاصيل تصحيح Pixel واحدة.
 */
export type AdaptiveEdgePixelDecisionV3 = {
  index: number;

  originalAlpha: number;

  refinedAlpha: number;

  correction: number;

  changed: boolean;

  removedHalo: boolean;

  preservedEdge: boolean;

  recoveredDetail: boolean;

  isolatedForeground: boolean;

  foregroundEvidence: number;

  backgroundEvidence: number;

  edgeEvidence: number;

  structureEvidence: number;
};

/**
 * Diagnostics إضافية داخلية للتطوير.
 */
export type AdaptiveEdgeRefinerDiagnosticsV3 = {
  processedPixelCount: number;

  changedPixelCount: number;

  removedHaloPixelCount: number;

  preservedEdgePixelCount: number;

  recoveredDetailPixelCount: number;

  isolatedForegroundPixelCount: number;

  averageCorrection: number;

  maximumCorrection: number;

  warnings:
    readonly string[];
};

/* =========================================================
 * Internal contracts
 * ======================================================= */

type SafeAdaptiveEdgeContextV3 = {
  width: number;

  height: number;

  pixelCount: number;

  votingResult:
    ImageGuidedConfidenceVotingResultV3;

  featureMap:
    ImageGuidedBoundaryFeatureMapV3;

  mainComponentMap:
    Uint8Array;

  config:
    ImageGuidedAdaptiveEdgeConfigV3;

  warnings:
    string[];
};

type EdgeNeighborhoodStatisticsV3 = {
  sampleCount: number;

  foregroundCount: number;

  backgroundCount: number;

  semiTransparentCount: number;

  foregroundRatio: number;

  backgroundRatio: number;

  semiTransparentRatio: number;

  averageAlpha: number;

  maximumAlpha: number;

  minimumAlpha: number;

  averageConfidence: number;

  averageEdgeContinuity: number;

  averageComponentSupport: number;
};

type AdaptiveEdgeAccumulatorV3 = {
  processedPixelCount: number;

  changedPixelCount: number;

  removedHaloPixelCount: number;

  preservedEdgePixelCount: number;

  recoveredDetailPixelCount: number;

  isolatedForegroundPixelCount: number;

  correctionSum: number;

  maximumCorrection: number;
};

/* =========================================================
 * Constants
 * ======================================================= */

const MAXIMUM_SAFE_PIXEL_COUNT =
  32_000_000;

const MAXIMUM_WARNING_COUNT =
  64;

const MAXIMUM_SAFE_REFINEMENT_DISTANCE =
  128;

const ALPHA_CHANGE_EPSILON =
  0.000_5;

const SCORE_EPSILON =
  0.000_001;

const FOREGROUND_NEIGHBOR_ALPHA =
  0.62;

const BACKGROUND_NEIGHBOR_ALPHA =
  0.10;

const SEMI_TRANSPARENT_MINIMUM =
  0.10;

const SEMI_TRANSPARENT_MAXIMUM =
  0.90;

const STRONG_COMPONENT_SUPPORT =
  0.74;

const STRONG_NEIGHBOR_AGREEMENT =
  0.74;

const STRONG_DETAIL_EDGE =
  0.72;

const WEAK_STRUCTURE_SUPPORT =
  0.30;

const MINIMUM_DETAIL_FOREGROUND_SUPPORT =
  0.42;

const ISOLATED_FOREGROUND_MAXIMUM_RATIO =
  0.16;

const MINIMUM_NEIGHBOR_SAMPLE_COUNT =
  3;

/* =========================================================
 * Default configuration
 * ======================================================= */

/**
 * الإعدادات الافتراضية متوازنة بين:
 *
 * - إزالة الهالة.
 * - منع بقع الخلفية.
 * - الحفاظ على الحواف الرفيعة.
 */
export const DEFAULT_ADAPTIVE_EDGE_CONFIG_V3:
  Readonly<
    ImageGuidedAdaptiveEdgeConfigV3
  > = {
    /**
     * Clamp الأدنى النهائي.
     */
    minimumAlpha:
      0,

    /**
     * Clamp الأعلى النهائي.
     */
    maximumAlpha:
      1,

    /**
     * Pixels الأعلى من هذا الحد
     * يمكن تثبيتها ناحية Foreground.
     */
    foregroundSnapThreshold:
      0.88,

    /**
     * Pixels الأقل من هذا الحد
     * يمكن تثبيتها ناحية Background.
     */
    backgroundSnapThreshold:
      0.07,

    /**
     * الحد الذي تعتبر عنده الحافة قوية.
     */
    strongEdgeThreshold:
      0.68,

    /**
     * الحد الذي تعتبر عنده الحافة ضعيفة.
     */
    weakEdgeThreshold:
      0.24,

    /**
     * أقصى Alpha مسموح لهالة ضعيفة
     * خارج بنية القطعة.
     */
    maximumHaloAlpha:
      0.18,

    /**
     * قوة إزالة الهالة.
     */
    haloSuppressionStrength:
      0.82,

    /**
     * قوة حماية الحواف الحقيقية.
     */
    edgePreservationStrength:
      0.88,

    /**
     * قوة الحفاظ على التفاصيل الرفيعة.
     */
    detailPreservationStrength:
      0.84,

    /**
     * أقصى مسافة من الحدود تدخل في التحسين.
     */
    maximumRefinementDistance:
      10,
  };

/* =========================================================
 * Configuration helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من الإعدادات الافتراضية.
 */
export function createDefaultAdaptiveEdgeConfigV3():
  ImageGuidedAdaptiveEdgeConfigV3 {
  return {
    ...DEFAULT_ADAPTIVE_EDGE_CONFIG_V3,
  };
}

/**
 * دمج وتطبيع إعدادات تحسين الحافة.
 */
export function resolveAdaptiveEdgeConfigV3(
  config?:
    Partial<
      ImageGuidedAdaptiveEdgeConfigV3
    > | null
): ImageGuidedAdaptiveEdgeConfigV3 {
  const source =
    config ?? {};

  let minimumAlpha =
    clampUnitValue(
      finiteOrFallbackV3(
        source.minimumAlpha,
        DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
          .minimumAlpha
      )
    );

  let maximumAlpha =
    clampUnitValue(
      finiteOrFallbackV3(
        source.maximumAlpha,
        DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
          .maximumAlpha
      )
    );

  if (
    minimumAlpha >
    maximumAlpha
  ) {
    const temporary =
      minimumAlpha;

    minimumAlpha =
      maximumAlpha;

    maximumAlpha =
      temporary;
  }

  let foregroundSnapThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.foregroundSnapThreshold,
        DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
          .foregroundSnapThreshold
      )
    );

  let backgroundSnapThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.backgroundSnapThreshold,
        DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
          .backgroundSnapThreshold
      )
    );

  if (
    backgroundSnapThreshold >
    foregroundSnapThreshold
  ) {
    const midpoint =
      (
        backgroundSnapThreshold +
        foregroundSnapThreshold
      ) /
      2;

    backgroundSnapThreshold =
      clampUnitValue(
        midpoint -
          0.05
      );

    foregroundSnapThreshold =
      clampUnitValue(
        midpoint +
          0.05
      );
  }

  let strongEdgeThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.strongEdgeThreshold,
        DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
          .strongEdgeThreshold
      )
    );

  let weakEdgeThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.weakEdgeThreshold,
        DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
          .weakEdgeThreshold
      )
    );

  if (
    weakEdgeThreshold >
    strongEdgeThreshold
  ) {
    const temporary =
      weakEdgeThreshold;

    weakEdgeThreshold =
      strongEdgeThreshold;

    strongEdgeThreshold =
      temporary;
  }

  return {
    minimumAlpha,

    maximumAlpha,

    foregroundSnapThreshold,

    backgroundSnapThreshold,

    strongEdgeThreshold,

    weakEdgeThreshold,

    maximumHaloAlpha:
      clampUnitValue(
        finiteOrFallbackV3(
          source.maximumHaloAlpha,
          DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
            .maximumHaloAlpha
        )
      ),

    haloSuppressionStrength:
      clampUnitValue(
        finiteOrFallbackV3(
          source.haloSuppressionStrength,
          DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
            .haloSuppressionStrength
        )
      ),

    edgePreservationStrength:
      clampUnitValue(
        finiteOrFallbackV3(
          source.edgePreservationStrength,
          DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
            .edgePreservationStrength
        )
      ),

    detailPreservationStrength:
      clampUnitValue(
        finiteOrFallbackV3(
          source.detailPreservationStrength,
          DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
            .detailPreservationStrength
        )
      ),

    maximumRefinementDistance:
      clampSegmentationValue(
        finiteOrFallbackV3(
          source.maximumRefinementDistance,
          DEFAULT_ADAPTIVE_EDGE_CONFIG_V3
            .maximumRefinementDistance
        ),
        1,
        MAXIMUM_SAFE_REFINEMENT_DISTANCE
      ),
  };
}

/* =========================================================
 * Main public refiner
 * ======================================================= */

/**
 * تنفيذ التحسين النهائي على الحواف.
 */
export function refineAdaptiveEdgesV3(
  input:
    AdaptiveEdgeRefinerInputV3
): AdaptiveEdgeRefinerExecutionV3 {
  const startedAt =
    nowMsV3();

  const context =
    createSafeAdaptiveEdgeContextV3(
      input
    );

  const {
    pixelCount,
    votingResult,
    featureMap,
    config,
    warnings,
  } = context;

  const outputMask =
    cloneFloatMask(
      votingResult.mask
    );

  const accumulator:
    AdaptiveEdgeAccumulatorV3 = {
    processedPixelCount:
      0,

    changedPixelCount:
      0,

    removedHaloPixelCount:
      0,

    preservedEdgePixelCount:
      0,

    recoveredDetailPixelCount:
      0,

    isolatedForegroundPixelCount:
      0,

    correctionSum:
      0,

    maximumCorrection:
      0,
  };

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const boundaryDistance =
      safeNonNegativeValueV3(
        featureMap
          .boundaryDistance[
            index
          ]
      );

    const active =
      featureMap
        .activeBoundaryMap[
          index
        ] !== 0;

    /**
     * لا نعدّل Pixels البعيدة عن نطاق الحدود.
     */
    if (
      !active ||
      boundaryDistance >
        config.maximumRefinementDistance
    ) {
      continue;
    }

    const decision =
      calculateAdaptiveEdgeDecisionV3(
        context,
        index,
        votingResult.mask
      );

    outputMask.data[index] =
      decision.refinedAlpha;

    accumulator.processedPixelCount +=
      1;

    accumulator.correctionSum +=
      decision.correction;

    if (
      decision.correction >
      accumulator.maximumCorrection
    ) {
      accumulator.maximumCorrection =
        decision.correction;
    }

    if (
      decision.changed
    ) {
      accumulator.changedPixelCount +=
        1;
    }

    if (
      decision.removedHalo
    ) {
      accumulator.removedHaloPixelCount +=
        1;
    }

    if (
      decision.preservedEdge
    ) {
      accumulator.preservedEdgePixelCount +=
        1;
    }

    if (
      decision.recoveredDetail
    ) {
      accumulator.recoveredDetailPixelCount +=
        1;
    }

    if (
      decision.isolatedForeground
    ) {
      accumulator.isolatedForegroundPixelCount +=
        1;
    }
  }

  const averageCorrection =
    accumulator.processedPixelCount >
      0
      ? accumulator.correctionSum /
        accumulator.processedPixelCount
      : 0;

  if (
    accumulator.processedPixelCount ===
    0
  ) {
    pushWarningV3(
      warnings,
      'Adaptive edge refinement did not find any active boundary pixels.'
    );
  }

  if (
    accumulator.removedHaloPixelCount >
    accumulator.processedPixelCount *
      0.45
  ) {
    pushWarningV3(
      warnings,
      'A large portion of boundary pixels was treated as halo; review refinement thresholds if the result becomes too aggressive.'
    );
  }

  if (
    accumulator.preservedEdgePixelCount ===
      0 &&
    accumulator.processedPixelCount >
      0
  ) {
    pushWarningV3(
      warnings,
      'No strong edge pixels were explicitly preserved.'
    );
  }

  const result:
    ImageGuidedAdaptiveEdgeResultV3 = {
      mask:
        outputMask,

      processedPixelCount:
        accumulator.processedPixelCount,

      changedPixelCount:
        accumulator.changedPixelCount,

      removedHaloPixelCount:
        accumulator.removedHaloPixelCount,

      preservedEdgePixelCount:
        accumulator.preservedEdgePixelCount,

      recoveredDetailPixelCount:
        accumulator.recoveredDetailPixelCount,

      averageCorrection:
        clampUnitValue(
          averageCorrection
        ),

      warnings:
        [...warnings],
    };

  return {
    result,

    config,

    durationMs:
      Math.max(
        0,
        nowMsV3() -
          startedAt
      ),
  };
}

/**
 * Alias مناسب للـPipeline.
 */
export const runAdaptiveEdgeRefinerV3 =
  refineAdaptiveEdgesV3;

/* =========================================================
 * Single-pixel refinement
 * ======================================================= */

/**
 * حساب تصحيح Pixel واحدة.
 */
export function calculateAdaptiveEdgeDecisionV3(
  context:
    SafeAdaptiveEdgeContextV3,
  index: number,
  sourceMask:
    SegmentationFloatMask
): AdaptiveEdgePixelDecisionV3 {
  const {
    width,
    height,
    featureMap,
    mainComponentMap,
    votingResult,
    config,
  } = context;

  const originalAlpha =
    safeUnitValueV3(
      sourceMask.data[
        index
      ]
    );

  const confidence =
    safeUnitValueV3(
      votingResult
        .confidenceMap[
          index
        ]
    );

  const x =
    index %
    width;

  const y =
    Math.floor(
      index /
        width
    );

  const insideMainComponent =
    mainComponentMap[
      index
    ] !== 0;

  const distanceToBoundary =
    safeNonNegativeValueV3(
      featureMap
        .boundaryDistance[
          index
        ]
    );

  const distanceToMainComponent =
    safeNonNegativeValueV3(
      featureMap
        .mainComponentDistance[
          index
        ]
    );

  const edgeContinuity =
    safeUnitValueV3(
      featureMap
        .edgeContinuity[
          index
        ]
    );

  const componentSupport =
    safeUnitValueV3(
      featureMap
        .componentSupport[
          index
        ]
    );

  const neighborAgreement =
    safeUnitValueV3(
      featureMap
        .neighborAgreement[
          index
        ]
    );

  const foregroundNeighborRatio =
    safeUnitValueV3(
      featureMap
        .foregroundNeighborRatio[
          index
        ]
    );

  const backgroundNeighborRatio =
    safeUnitValueV3(
      featureMap
        .backgroundNeighborRatio[
          index
        ]
    );

  const localContrast =
    safeUnitValueV3(
      featureMap
        .localContrast[
          index
        ]
    );

  const localTexture =
    safeUnitValueV3(
      featureMap
        .localTexture[
          index
        ]
    );

  const localVariance =
    safeUnitValueV3(
      featureMap
        .localVariance[
          index
        ]
    );

  const neighborhood =
    collectEdgeNeighborhoodStatisticsV3(
      context,
      index,
      sourceMask
    );

  const edgeEvidence =
    calculateEdgeEvidenceV3(
      edgeContinuity,
      localContrast,
      localTexture,
      localVariance,
      neighborhood
    );

  const structureEvidence =
    calculateStructureEvidenceV3(
      insideMainComponent,
      distanceToMainComponent,
      componentSupport,
      neighborAgreement,
      foregroundNeighborRatio,
      neighborhood
    );

  const foregroundEvidence =
    calculateForegroundEvidenceV3(
      originalAlpha,
      confidence,
      edgeEvidence,
      structureEvidence,
      foregroundNeighborRatio,
      backgroundNeighborRatio,
      neighborhood
    );

  const backgroundEvidence =
    calculateBackgroundEvidenceV3(
      originalAlpha,
      confidence,
      edgeEvidence,
      structureEvidence,
      foregroundNeighborRatio,
      backgroundNeighborRatio,
      distanceToMainComponent,
      neighborhood
    );

  const isolatedForeground =
    detectIsolatedForegroundV3(
      originalAlpha,
      insideMainComponent,
      componentSupport,
      edgeEvidence,
      structureEvidence,
      neighborhood
    );

  const haloCandidate =
    detectHaloCandidateV3(
      originalAlpha,
      insideMainComponent,
      distanceToBoundary,
      distanceToMainComponent,
      edgeEvidence,
      structureEvidence,
      foregroundEvidence,
      backgroundEvidence,
      backgroundNeighborRatio,
      neighborhood,
      config
    );

  const detailCandidate =
    detectRecoverableDetailV3(
      originalAlpha,
      insideMainComponent,
      edgeEvidence,
      structureEvidence,
      foregroundEvidence,
      backgroundEvidence,
      localTexture,
      localVariance,
      neighborhood,
      config
    );

  const protectedEdge =
    detectProtectedEdgeV3(
      originalAlpha,
      insideMainComponent,
      edgeEvidence,
      structureEvidence,
      foregroundEvidence,
      backgroundEvidence,
      config
    );

  let refinedAlpha =
    originalAlpha;

  let removedHalo =
    false;

  let preservedEdge =
    false;

  let recoveredDetail =
    false;

  if (
    isolatedForeground
  ) {
    refinedAlpha =
      suppressIsolatedForegroundV3(
        originalAlpha,
        backgroundEvidence,
        confidence,
        config
      );
  } else if (
    haloCandidate &&
    !protectedEdge &&
    !detailCandidate
  ) {
    refinedAlpha =
      suppressHaloAlphaV3(
        originalAlpha,
        foregroundEvidence,
        backgroundEvidence,
        edgeEvidence,
        structureEvidence,
        confidence,
        config
      );

    removedHalo =
      refinedAlpha <
      originalAlpha -
        ALPHA_CHANGE_EPSILON;
  } else if (
    detailCandidate
  ) {
    refinedAlpha =
      recoverThinDetailAlphaV3(
        originalAlpha,
        foregroundEvidence,
        edgeEvidence,
        structureEvidence,
        confidence,
        config
      );

    recoveredDetail =
      refinedAlpha >
      originalAlpha +
        ALPHA_CHANGE_EPSILON;
  } else if (
    protectedEdge
  ) {
    refinedAlpha =
      preserveEdgeAlphaV3(
        originalAlpha,
        foregroundEvidence,
        backgroundEvidence,
        edgeEvidence,
        structureEvidence,
        confidence,
        config
      );

    preservedEdge =
      refinedAlpha >=
        originalAlpha -
          ALPHA_CHANGE_EPSILON;
  } else {
    refinedAlpha =
      refineTransitionAlphaV3(
        originalAlpha,
        foregroundEvidence,
        backgroundEvidence,
        edgeEvidence,
        structureEvidence,
        confidence,
        config
      );
  }

  /**
   * Snap نهائي فقط عندما يكون الدليل واضحًا جدًا.
   */
  refinedAlpha =
    applyAdaptiveAlphaSnapV3(
      refinedAlpha,
      originalAlpha,
      foregroundEvidence,
      backgroundEvidence,
      edgeEvidence,
      structureEvidence,
      insideMainComponent,
      config
    );

  refinedAlpha =
    clampSegmentationValue(
      refinedAlpha,
      config.minimumAlpha,
      config.maximumAlpha
    );

  const correction =
    Math.abs(
      refinedAlpha -
      originalAlpha
    );

  return {
    index,

    originalAlpha,

    refinedAlpha,

    correction,

    changed:
      correction >
      ALPHA_CHANGE_EPSILON,

    removedHalo,

    preservedEdge,

    recoveredDetail,

    isolatedForeground,

    foregroundEvidence,

    backgroundEvidence,

    edgeEvidence,

    structureEvidence,
  };
}

/* =========================================================
 * Edge evidence
 * ======================================================= */

/**
 * حساب قوة الدليل البصري للحافة.
 */
function calculateEdgeEvidenceV3(
  edgeContinuity: number,
  localContrast: number,
  localTexture: number,
  localVariance: number,
  neighborhood:
    EdgeNeighborhoodStatisticsV3
): number {
  const neighborhoodEdgeSupport =
    clampUnitValue(
      neighborhood
        .averageEdgeContinuity
    );

  const textureSupport =
    clampUnitValue(
      localTexture *
        0.60 +
      Math.sqrt(
        localVariance
      ) *
        0.40
    );

  return clampUnitValue(
    edgeContinuity *
      0.42 +
    localContrast *
      0.20 +
    textureSupport *
      0.14 +
    neighborhoodEdgeSupport *
      0.24
  );
}

/* =========================================================
 * Structure evidence
 * ======================================================= */

/**
 * حساب دعم البنية الأساسية للقطعة.
 */
function calculateStructureEvidenceV3(
  insideMainComponent: boolean,
  distanceToMainComponent: number,
  componentSupport: number,
  neighborAgreement: number,
  foregroundNeighborRatio: number,
  neighborhood:
    EdgeNeighborhoodStatisticsV3
): number {
  const directComponentSupport =
    insideMainComponent
      ? 1
      : clampUnitValue(
          1 -
          distanceToMainComponent /
            12
        );

  const localForegroundSupport =
    clampUnitValue(
      foregroundNeighborRatio *
        0.48 +
      neighborhood.foregroundRatio *
        0.32 +
      neighborhood
        .averageComponentSupport *
        0.20
    );

  return clampUnitValue(
    directComponentSupport *
      0.30 +
    componentSupport *
      0.30 +
    neighborAgreement *
      0.18 +
    localForegroundSupport *
      0.22
  );
}

/* =========================================================
 * Foreground evidence
 * ======================================================= */

function calculateForegroundEvidenceV3(
  originalAlpha: number,
  confidence: number,
  edgeEvidence: number,
  structureEvidence: number,
  foregroundNeighborRatio: number,
  backgroundNeighborRatio: number,
  neighborhood:
    EdgeNeighborhoodStatisticsV3
): number {
  const neighborhoodPreference =
    clampUnitValue(
      neighborhood.foregroundRatio -
      neighborhood.backgroundRatio *
        0.55 +
      0.5
    );

  const directPreference =
    clampUnitValue(
      foregroundNeighborRatio -
      backgroundNeighborRatio *
        0.50 +
      0.5
    );

  return clampUnitValue(
    originalAlpha *
      0.24 +
    confidence *
      0.10 +
    edgeEvidence *
      0.18 +
    structureEvidence *
      0.27 +
    directPreference *
      0.11 +
    neighborhoodPreference *
      0.10
  );
}

/* =========================================================
 * Background evidence
 * ======================================================= */

function calculateBackgroundEvidenceV3(
  originalAlpha: number,
  confidence: number,
  edgeEvidence: number,
  structureEvidence: number,
  foregroundNeighborRatio: number,
  backgroundNeighborRatio: number,
  distanceToMainComponent: number,
  neighborhood:
    EdgeNeighborhoodStatisticsV3
): number {
  const alphaBackgroundSupport =
    clampUnitValue(
      1 -
      originalAlpha
    );

  const directBackgroundPreference =
    clampUnitValue(
      backgroundNeighborRatio -
      foregroundNeighborRatio *
        0.55 +
      0.5
    );

  const neighborhoodBackgroundPreference =
    clampUnitValue(
      neighborhood.backgroundRatio -
      neighborhood.foregroundRatio *
        0.50 +
      0.5
    );

  const distanceSupport =
    clampUnitValue(
      distanceToMainComponent /
        12
    );

  const weakVisualSupport =
    clampUnitValue(
      1 -
      (
        edgeEvidence *
          0.52 +
        structureEvidence *
          0.48
      )
    );

  return clampUnitValue(
    alphaBackgroundSupport *
      0.26 +
    directBackgroundPreference *
      0.18 +
    neighborhoodBackgroundPreference *
      0.18 +
    distanceSupport *
      0.12 +
    weakVisualSupport *
      0.20 +
    confidence *
      0.06
  );
}

/* =========================================================
 * Halo detection
 * ======================================================= */

/**
 * Pixel تعتبر Halo عندما:
 *
 * - تقع خارج الجسم الأساسي.
 * - Alpha منخفضة أو متوسطة.
 * - لا يوجد Edge قوي.
 * - دعم البنية ضعيف.
 * - Background حولها أقوى.
 */
function detectHaloCandidateV3(
  originalAlpha: number,
  insideMainComponent: boolean,
  distanceToBoundary: number,
  distanceToMainComponent: number,
  edgeEvidence: number,
  structureEvidence: number,
  foregroundEvidence: number,
  backgroundEvidence: number,
  backgroundNeighborRatio: number,
  neighborhood:
    EdgeNeighborhoodStatisticsV3,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): boolean {
  if (
    insideMainComponent
  ) {
    return false;
  }

  if (
    originalAlpha <=
    config.minimumAlpha
  ) {
    return false;
  }

  if (
    distanceToBoundary >
    config.maximumRefinementDistance
  ) {
    return false;
  }

  const weakEdge =
    edgeEvidence <
    config.strongEdgeThreshold;

  const weakStructure =
    structureEvidence <
    0.58;

  const backgroundDominant =
    backgroundEvidence >
      foregroundEvidence +
        0.06 ||
    backgroundNeighborRatio >=
      0.58 ||
    neighborhood.backgroundRatio >=
      0.58;

  const detached =
    distanceToMainComponent >
      Math.max(
        1.5,
        distanceToBoundary +
          0.5
      );

  const haloAlphaRange =
    originalAlpha <=
      Math.max(
        config.maximumHaloAlpha *
          2.2,
        0.42
      );

  return (
    weakEdge &&
    weakStructure &&
    backgroundDominant &&
    haloAlphaRange &&
    (
      detached ||
      neighborhood.foregroundRatio <
        0.28
    )
  );
}

/* =========================================================
 * Protected-edge detection
 * ======================================================= */

function detectProtectedEdgeV3(
  originalAlpha: number,
  insideMainComponent: boolean,
  edgeEvidence: number,
  structureEvidence: number,
  foregroundEvidence: number,
  backgroundEvidence: number,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): boolean {
  const strongEdge =
    edgeEvidence >=
    config.strongEdgeThreshold;

  const supportedStructure =
    structureEvidence >=
    0.48;

  const foregroundCompetitive =
    foregroundEvidence >=
    backgroundEvidence -
      0.04;

  const visibleAlpha =
    originalAlpha >
    config.backgroundSnapThreshold;

  return (
    visibleAlpha &&
    strongEdge &&
    foregroundCompetitive &&
    (
      insideMainComponent ||
      supportedStructure
    )
  );
}

/* =========================================================
 * Thin-detail detection
 * ======================================================= */

/**
 * اكتشاف تفاصيل رفيعة يمكن استعادتها.
 */
function detectRecoverableDetailV3(
  originalAlpha: number,
  insideMainComponent: boolean,
  edgeEvidence: number,
  structureEvidence: number,
  foregroundEvidence: number,
  backgroundEvidence: number,
  localTexture: number,
  localVariance: number,
  neighborhood:
    EdgeNeighborhoodStatisticsV3,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): boolean {
  if (
    originalAlpha >=
    config.foregroundSnapThreshold
  ) {
    return false;
  }

  const strongThinEdge =
    edgeEvidence >=
      Math.max(
        config.strongEdgeThreshold,
        STRONG_DETAIL_EDGE
      );

  const enoughForegroundSupport =
    foregroundEvidence >=
      MINIMUM_DETAIL_FOREGROUND_SUPPORT &&
    foregroundEvidence >=
      backgroundEvidence -
        0.08;

  const connectedToForeground =
    neighborhood.foregroundRatio >=
      0.20 ||
    structureEvidence >=
      0.48 ||
    insideMainComponent;

  const texturedDetail =
    localTexture >=
      0.06 ||
    localVariance >=
      0.006;

  return (
    strongThinEdge &&
    enoughForegroundSupport &&
    connectedToForeground &&
    texturedDetail
  );
}

/* =========================================================
 * Isolated foreground detection
 * ======================================================= */

function detectIsolatedForegroundV3(
  originalAlpha: number,
  insideMainComponent: boolean,
  componentSupport: number,
  edgeEvidence: number,
  structureEvidence: number,
  neighborhood:
    EdgeNeighborhoodStatisticsV3
): boolean {
  if (
    insideMainComponent ||
    originalAlpha <
      0.18 ||
    neighborhood.sampleCount <
      MINIMUM_NEIGHBOR_SAMPLE_COUNT
  ) {
    return false;
  }

  return (
    neighborhood.foregroundRatio <=
      ISOLATED_FOREGROUND_MAXIMUM_RATIO &&
    neighborhood.backgroundRatio >=
      0.58 &&
    componentSupport <
      WEAK_STRUCTURE_SUPPORT &&
    structureEvidence <
      0.34 &&
    edgeEvidence <
      0.46
  );
}

/* =========================================================
 * Context validation
 * ======================================================= */

function createSafeAdaptiveEdgeContextV3(
  input:
    AdaptiveEdgeRefinerInputV3
): SafeAdaptiveEdgeContextV3 {
  if (
    typeof input !==
      'object' ||
    input === null
  ) {
    throw new Error(
      'AdaptiveEdgeRefinerV3 received an invalid input object.'
    );
  }

  if (
    !isValidConfidenceVotingResultV3(
      input.votingResult
    )
  ) {
    throw new Error(
      'AdaptiveEdgeRefinerV3 received an invalid confidence-voting result.'
    );
  }

  if (
    !isValidBoundaryFeatureMapV3(
      input.featureMap
    )
  ) {
    throw new Error(
      'AdaptiveEdgeRefinerV3 received an invalid boundary feature map.'
    );
  }

  const {
    width,
    height,
  } = input.votingResult.mask;

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
      `AdaptiveEdgeRefinerV3 received an unsafe pixel count: ${pixelCount}.`
    );
  }

  if (
    input.featureMap.width !==
      width ||
    input.featureMap.height !==
      height
  ) {
    throw new Error(
      [
        'AdaptiveEdgeRefinerV3 input sizes do not match.',
        `Voting result: ${width}x${height}.`,
        `Feature map: ${input.featureMap.width}x${input.featureMap.height}.`,
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
      'AdaptiveEdgeRefinerV3 received an invalid main component map.'
    );
  }

  const warnings:
    string[] = [];

  const config =
    resolveAdaptiveEdgeConfigV3(
      input.config
    );

  const mainComponentMap =
    normalizeBinaryMapV3(
      input.mainComponentMap
    );

  inspectAdaptiveEdgeSourcesV3(
    input.votingResult,
    input.featureMap,
    warnings
  );

  return {
    width,

    height,

    pixelCount,

    votingResult:
      input.votingResult,

    featureMap:
      input.featureMap,

    mainComponentMap,

    config,

    warnings,
  };
}

/* =========================================================
 * Feature-map validation
 * ======================================================= */

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

function inspectAdaptiveEdgeSourcesV3(
  votingResult:
    ImageGuidedConfidenceVotingResultV3,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3,
  warnings:
    string[]
): void {
  const pixelCount =
    votingResult.mask.width *
    votingResult.mask.height;

  const step =
    Math.max(
      1,
      Math.floor(
        pixelCount /
          4096
      )
    );

  let invalidMaskCount =
    0;

  let invalidConfidenceCount =
    0;

  let invalidFeatureCount =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += step
  ) {
    if (
      !isFiniteUnitValueV3(
        votingResult.mask.data[
          index
        ]
      )
    ) {
      invalidMaskCount +=
        1;
    }

    if (
      !isFiniteUnitValueV3(
        votingResult
          .confidenceMap[
            index
          ]
      )
    ) {
      invalidConfidenceCount +=
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
      ) ||
      !Number.isFinite(
        featureMap
          .edgeContinuity[
            index
          ]
      ) ||
      !Number.isFinite(
        featureMap
          .componentSupport[
            index
          ]
      )
    ) {
      invalidFeatureCount +=
        1;
    }
  }

  if (
    invalidMaskCount >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some mask values were invalid and will be clamped during adaptive edge refinement.'
    );
  }

  if (
    invalidConfidenceCount >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some confidence values were invalid and will use safe fallback values.'
    );
  }

  if (
    invalidFeatureCount >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some boundary feature values were invalid and will be clamped.'
    );
  }
}

/* =========================================================
 * Basic helpers
 * ======================================================= */

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
// function collectEdgeNeighborhoodStatisticsV3(...)
//
// ويحتوي على:
//
// - تحليل الجيران.
// - إزالة Halo.
// - حذف Pixels المعزولة.
// - استعادة التفاصيل الرفيعة.
// - حماية الحواف.
// - تحسين Alpha الانتقالي.
// - Adaptive Snap.
// - Result validator.
// - Clone.
// - Diagnostics.
// - Memory estimation.
// - Summary.
// - Default export.
/* =========================================================
 * Edge neighborhood statistics
 * ======================================================= */

/**
 * تحليل الجيران حول Pixel.
 *
 * نستخدم Radius صغير ثابت للحفاظ على الأداء،
 * لأن هذه المرحلة تعمل فقط داخل نطاق الحدود.
 */
function collectEdgeNeighborhoodStatisticsV3(
  context:
    SafeAdaptiveEdgeContextV3,
  index: number,
  sourceMask:
    SegmentationFloatMask
): EdgeNeighborhoodStatisticsV3 {
  const {
    width,
    height,
    featureMap,
    votingResult,
  } = context;

  const x =
    index %
    width;

  const y =
    Math.floor(
      index /
        width
    );

  const radius =
    1;

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

  let sampleCount =
    0;

  let foregroundCount =
    0;

  let backgroundCount =
    0;

  let semiTransparentCount =
    0;

  let alphaSum =
    0;

  let maximumAlpha =
    0;

  let minimumAlpha =
    1;

  let confidenceSum =
    0;

  let edgeContinuitySum =
    0;

  let componentSupportSum =
    0;

  for (
    let neighborY = minimumY;
    neighborY <= maximumY;
    neighborY += 1
  ) {
    const rowOffset =
      neighborY *
      width;

    for (
      let neighborX = minimumX;
      neighborX <= maximumX;
      neighborX += 1
    ) {
      const neighborIndex =
        rowOffset +
        neighborX;

      if (
        neighborIndex ===
        index
      ) {
        continue;
      }

      const alpha =
        safeUnitValueV3(
          sourceMask.data[
            neighborIndex
          ]
        );

      const confidence =
        safeUnitValueV3(
          votingResult
            .confidenceMap[
              neighborIndex
            ]
        );

      const edgeContinuity =
        safeUnitValueV3(
          featureMap
            .edgeContinuity[
              neighborIndex
            ]
        );

      const componentSupport =
        safeUnitValueV3(
          featureMap
            .componentSupport[
              neighborIndex
            ]
        );

      sampleCount +=
        1;

      alphaSum +=
        alpha;

      confidenceSum +=
        confidence;

      edgeContinuitySum +=
        edgeContinuity;

      componentSupportSum +=
        componentSupport;

      if (
        alpha >
        maximumAlpha
      ) {
        maximumAlpha =
          alpha;
      }

      if (
        alpha <
        minimumAlpha
      ) {
        minimumAlpha =
          alpha;
      }

      if (
        alpha >=
        FOREGROUND_NEIGHBOR_ALPHA
      ) {
        foregroundCount +=
          1;
      } else if (
        alpha <=
        BACKGROUND_NEIGHBOR_ALPHA
      ) {
        backgroundCount +=
          1;
      } else {
        semiTransparentCount +=
          1;
      }
    }
  }

  if (
    sampleCount ===
    0
  ) {
    return {
      sampleCount:
        0,

      foregroundCount:
        0,

      backgroundCount:
        0,

      semiTransparentCount:
        0,

      foregroundRatio:
        0,

      backgroundRatio:
        0,

      semiTransparentRatio:
        0,

      averageAlpha:
        0,

      maximumAlpha:
        0,

      minimumAlpha:
        0,

      averageConfidence:
        0,

      averageEdgeContinuity:
        0,

      averageComponentSupport:
        0,
    };
  }

  return {
    sampleCount,

    foregroundCount,

    backgroundCount,

    semiTransparentCount,

    foregroundRatio:
      clampUnitValue(
        foregroundCount /
          sampleCount
      ),

    backgroundRatio:
      clampUnitValue(
        backgroundCount /
          sampleCount
      ),

    semiTransparentRatio:
      clampUnitValue(
        semiTransparentCount /
          sampleCount
      ),

    averageAlpha:
      clampUnitValue(
        alphaSum /
          sampleCount
      ),

    maximumAlpha:
      clampUnitValue(
        maximumAlpha
      ),

    minimumAlpha:
      clampUnitValue(
        minimumAlpha
      ),

    averageConfidence:
      clampUnitValue(
        confidenceSum /
          sampleCount
      ),

    averageEdgeContinuity:
      clampUnitValue(
        edgeContinuitySum /
          sampleCount
      ),

    averageComponentSupport:
      clampUnitValue(
        componentSupportSum /
          sampleCount
      ),
  };
}

/* =========================================================
 * Halo suppression
 * ======================================================= */

/**
 * تقليل Alpha الخاص بالـHalo.
 */
function suppressHaloAlphaV3(
  originalAlpha: number,
  foregroundEvidence: number,
  backgroundEvidence: number,
  edgeEvidence: number,
  structureEvidence: number,
  confidence: number,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): number {
  const backgroundDominance =
    clampUnitValue(
      backgroundEvidence -
        foregroundEvidence +
        0.5
    );

  const weakVisualSupport =
    clampUnitValue(
      1 -
      (
        edgeEvidence *
          0.55 +
        structureEvidence *
          0.45
      )
    );

  const suppressionEvidence =
    clampUnitValue(
      backgroundDominance *
        0.50 +
      weakVisualSupport *
        0.34 +
      confidence *
        0.16
    );

  const suppressionStrength =
    clampUnitValue(
      config.haloSuppressionStrength *
      suppressionEvidence
    );

  const targetAlpha =
    Math.min(
      config.maximumHaloAlpha,
      originalAlpha *
        (
          1 -
          suppressionStrength
        )
    );

  return clampUnitValue(
    originalAlpha *
      (
        1 -
        suppressionStrength
      ) +
    targetAlpha *
      suppressionStrength
  );
}

/* =========================================================
 * Isolated foreground suppression
 * ======================================================= */

/**
 * حذف Pixel Foreground معزولة.
 */
function suppressIsolatedForegroundV3(
  originalAlpha: number,
  backgroundEvidence: number,
  confidence: number,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): number {
  const suppressionStrength =
    clampUnitValue(
      config.haloSuppressionStrength *
      (
        0.62 +
        backgroundEvidence *
          0.24 +
        confidence *
          0.14
      )
    );

  const targetAlpha =
    clampUnitValue(
      config.maximumHaloAlpha *
        0.35
    );

  return clampUnitValue(
    originalAlpha *
      (
        1 -
        suppressionStrength
      ) +
    targetAlpha *
      suppressionStrength
  );
}

/* =========================================================
 * Thin detail recovery
 * ======================================================= */

/**
 * استعادة Alpha لتفاصيل رفيعة ذات Edge قوي.
 */
function recoverThinDetailAlphaV3(
  originalAlpha: number,
  foregroundEvidence: number,
  edgeEvidence: number,
  structureEvidence: number,
  confidence: number,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): number {
  const recoveryEvidence =
    clampUnitValue(
      foregroundEvidence *
        0.34 +
      edgeEvidence *
        0.32 +
      structureEvidence *
        0.24 +
      confidence *
        0.10
    );

  const targetAlpha =
    clampUnitValue(
      Math.max(
        originalAlpha,
        recoveryEvidence *
          0.82
      )
    );

  const recoveryStrength =
    clampUnitValue(
      config.detailPreservationStrength *
      (
        0.36 +
        recoveryEvidence *
          0.64
      )
    );

  return clampUnitValue(
    originalAlpha *
      (
        1 -
        recoveryStrength
      ) +
    targetAlpha *
      recoveryStrength
  );
}

/* =========================================================
 * Strong edge preservation
 * ======================================================= */

/**
 * حماية Alpha للحافة الحقيقية.
 */
function preserveEdgeAlphaV3(
  originalAlpha: number,
  foregroundEvidence: number,
  backgroundEvidence: number,
  edgeEvidence: number,
  structureEvidence: number,
  confidence: number,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): number {
  const foregroundPreference =
    clampUnitValue(
      foregroundEvidence -
        backgroundEvidence +
        0.5
    );

  const protectedTarget =
    clampUnitValue(
      originalAlpha *
        0.42 +
      foregroundPreference *
        0.20 +
      edgeEvidence *
        0.20 +
      structureEvidence *
        0.12 +
      confidence *
        0.06
    );

  const targetAlpha =
    Math.max(
      originalAlpha *
        0.82,
      protectedTarget
    );

  const preservationStrength =
    clampUnitValue(
      config.edgePreservationStrength *
      (
        0.44 +
        edgeEvidence *
          0.36 +
        structureEvidence *
          0.20
      )
    );

  return clampUnitValue(
    originalAlpha *
      (
        1 -
        preservationStrength
      ) +
    targetAlpha *
      preservationStrength
  );
}

/* =========================================================
 * Transition alpha refinement
 * ======================================================= */

/**
 * تعديل المنطقة الانتقالية بشكل تدريجي.
 */
function refineTransitionAlphaV3(
  originalAlpha: number,
  foregroundEvidence: number,
  backgroundEvidence: number,
  edgeEvidence: number,
  structureEvidence: number,
  confidence: number,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): number {
  const evidenceTotal =
    Math.max(
      SCORE_EPSILON,
      foregroundEvidence +
        backgroundEvidence
    );

  const foregroundPreference =
    foregroundEvidence /
    evidenceTotal;

  const visualProtection =
    clampUnitValue(
      edgeEvidence *
        0.52 +
      structureEvidence *
        0.48
    );

  const targetAlpha =
    clampUnitValue(
      foregroundPreference *
        0.72 +
      visualProtection *
        0.18 +
      originalAlpha *
        0.10
    );

  const evidenceDifference =
    Math.abs(
      foregroundEvidence -
      backgroundEvidence
    );

  let blendStrength =
    clampUnitValue(
      0.16 +
      evidenceDifference *
        0.36 +
      confidence *
        0.22
    );

  if (
    edgeEvidence >=
    config.strongEdgeThreshold
  ) {
    blendStrength *=
      0.72;
  }

  return clampUnitValue(
    originalAlpha *
      (
        1 -
        blendStrength
      ) +
    targetAlpha *
      blendStrength
  );
}

/* =========================================================
 * Adaptive Alpha snap
 * ======================================================= */

/**
 * Snap نهائي مشروط.
 *
 * لا يتم تحويل كل Pixel إلى 0 أو1،
 * بل فقط الحالات ذات الأدلة القوية.
 */
function applyAdaptiveAlphaSnapV3(
  refinedAlpha: number,
  originalAlpha: number,
  foregroundEvidence: number,
  backgroundEvidence: number,
  edgeEvidence: number,
  structureEvidence: number,
  insideMainComponent: boolean,
  config:
    ImageGuidedAdaptiveEdgeConfigV3
): number {
  let output =
    clampUnitValue(
      refinedAlpha
    );

  const strongForegroundEvidence =
    foregroundEvidence >=
      0.78 &&
    foregroundEvidence >=
      backgroundEvidence +
        0.18;

  const strongBackgroundEvidence =
    backgroundEvidence >=
      0.78 &&
    backgroundEvidence >=
      foregroundEvidence +
        0.18;

  const stronglyProtected =
    insideMainComponent ||
    structureEvidence >=
      STRONG_COMPONENT_SUPPORT ||
    edgeEvidence >=
      config.strongEdgeThreshold;

  if (
    strongForegroundEvidence &&
    stronglyProtected &&
    output >=
      config.foregroundSnapThreshold
  ) {
    output =
      Math.max(
        output,
        0.96
      );
  }

  if (
    strongBackgroundEvidence &&
    !stronglyProtected &&
    output <=
      Math.max(
        config.backgroundSnapThreshold,
        originalAlpha
      )
  ) {
    output =
      Math.min(
        output,
        config.minimumAlpha
      );
  }

  /**
   * Alpha شديدة الانخفاض خارج البنية
   * يتم تنظيفها نهائيًا.
   */
  if (
    output <=
      config.backgroundSnapThreshold &&
    backgroundEvidence >
      foregroundEvidence &&
    structureEvidence <
      0.35 &&
    edgeEvidence <
      config.weakEdgeThreshold
  ) {
    output =
      config.minimumAlpha;
  }

  /**
   * Alpha عالية جدًا داخل الجسم
   * يتم تثبيتها ناحية Foreground.
   */
  if (
    insideMainComponent &&
    output >=
      config.foregroundSnapThreshold &&
    foregroundEvidence >=
      backgroundEvidence
  ) {
    output =
      config.maximumAlpha;
  }

  return clampSegmentationValue(
    output,
    config.minimumAlpha,
    config.maximumAlpha
  );
}

/* =========================================================
 * Public result validation
 * ======================================================= */

/**
 * التحقق من صلاحية نتيجة AdaptiveEdgeRefinerV3.
 */
export function isValidAdaptiveEdgeResultV3(
  value: unknown
): value is ImageGuidedAdaptiveEdgeResultV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const result =
    value as Partial<
      ImageGuidedAdaptiveEdgeResultV3
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
    !isValidNonNegativeIntegerV3(
      result.processedPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.changedPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.removedHaloPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.preservedEdgePixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.recoveredDetailPixelCount
    )
  ) {
    return false;
  }

  if (
    result.processedPixelCount >
      pixelCount ||
    result.changedPixelCount >
      pixelCount ||
    result.removedHaloPixelCount >
      pixelCount ||
    result.preservedEdgePixelCount >
      pixelCount ||
    result.recoveredDetailPixelCount >
      pixelCount
  ) {
    return false;
  }

  if (
    typeof result.averageCorrection !==
      'number' ||
    !Number.isFinite(
      result.averageCorrection
    ) ||
    result.averageCorrection <
      0 ||
    result.averageCorrection >
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
 * إنشاء نسخة مستقلة من النتيجة.
 */
export function cloneAdaptiveEdgeResultV3(
  result:
    ImageGuidedAdaptiveEdgeResultV3
): ImageGuidedAdaptiveEdgeResultV3 {
  if (
    !isValidAdaptiveEdgeResultV3(
      result
    )
  ) {
    throw new Error(
      'Cannot clone an invalid ImageGuidedAdaptiveEdgeResultV3.'
    );
  }

  return {
    mask:
      cloneFloatMask(
        result.mask
      ),

    processedPixelCount:
      result.processedPixelCount,

    changedPixelCount:
      result.changedPixelCount,

    removedHaloPixelCount:
      result.removedHaloPixelCount,

    preservedEdgePixelCount:
      result.preservedEdgePixelCount,

    recoveredDetailPixelCount:
      result.recoveredDetailPixelCount,

    averageCorrection:
      result.averageCorrection,

    warnings:
      [...result.warnings],
  };
}

/* =========================================================
 * Diagnostics
 * ======================================================= */

/**
 * إنشاء Diagnostics موحدة للنتيجة.
 */
export function createAdaptiveEdgeDiagnosticsV3(
  result:
    ImageGuidedAdaptiveEdgeResultV3
): AdaptiveEdgeRefinerDiagnosticsV3 {
  if (
    !isValidAdaptiveEdgeResultV3(
      result
    )
  ) {
    throw new Error(
      'Cannot create diagnostics from an invalid adaptive-edge result.'
    );
  }

  return {
    processedPixelCount:
      result.processedPixelCount,

    changedPixelCount:
      result.changedPixelCount,

    removedHaloPixelCount:
      result.removedHaloPixelCount,

    preservedEdgePixelCount:
      result.preservedEdgePixelCount,

    recoveredDetailPixelCount:
      result.recoveredDetailPixelCount,

    /**
     * النوع العام في types.ts لا يحتوي هذا العداد،
     * لذلك لا يمكن استعادته من النتيجة النهائية.
     */
    isolatedForegroundPixelCount:
      0,

    averageCorrection:
      result.averageCorrection,

    maximumCorrection:
      calculateMaximumMaskCorrectionV3(
        result.mask
      ),

    warnings:
      [...result.warnings],
  };
}

/**
 * إنشاء Diagnostics دقيقة أثناء التنفيذ.
 *
 * تستخدم عندما نريد الاحتفاظ بالقيم الداخلية
 * التي لا تدخل في العقد العام.
 */
export function createAdaptiveEdgeExecutionDiagnosticsV3(
  accumulator: {
    processedPixelCount: number;

    changedPixelCount: number;

    removedHaloPixelCount: number;

    preservedEdgePixelCount: number;

    recoveredDetailPixelCount: number;

    isolatedForegroundPixelCount: number;

    correctionSum: number;

    maximumCorrection: number;
  },
  warnings:
    readonly string[] = []
): AdaptiveEdgeRefinerDiagnosticsV3 {
  const processedPixelCount =
    Math.max(
      0,
      Math.floor(
        accumulator.processedPixelCount
      )
    );

  return {
    processedPixelCount,

    changedPixelCount:
      Math.max(
        0,
        Math.floor(
          accumulator.changedPixelCount
        )
      ),

    removedHaloPixelCount:
      Math.max(
        0,
        Math.floor(
          accumulator.removedHaloPixelCount
        )
      ),

    preservedEdgePixelCount:
      Math.max(
        0,
        Math.floor(
          accumulator.preservedEdgePixelCount
        )
      ),

    recoveredDetailPixelCount:
      Math.max(
        0,
        Math.floor(
          accumulator.recoveredDetailPixelCount
        )
      ),

    isolatedForegroundPixelCount:
      Math.max(
        0,
        Math.floor(
          accumulator.isolatedForegroundPixelCount
        )
      ),

    averageCorrection:
      processedPixelCount >
        0
        ? clampUnitValue(
            accumulator.correctionSum /
              processedPixelCount
          )
        : 0,

    maximumCorrection:
      clampUnitValue(
        accumulator.maximumCorrection
      ),

    warnings:
      [...warnings],
  };
}

/* =========================================================
 * Memory estimation
 * ======================================================= */

/**
 * تقدير الذاكرة المستخدمة في النتيجة.
 */
export function estimateAdaptiveEdgeResultBytesV3(
  result:
    ImageGuidedAdaptiveEdgeResultV3
): number {
  if (
    !isValidAdaptiveEdgeResultV3(
      result
    )
  ) {
    return 0;
  }

  const warningsBytes =
    result.warnings.reduce(
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
    result.mask.data.byteLength +
    warningsBytes
  );
}

/* =========================================================
 * Final mask statistics helpers
 * ======================================================= */

/**
 * حساب أكبر تصحيح تقريبي داخل الماسك.
 *
 * لا توجد نسخة الماسك الأصلية داخل Result،
 * لذلك ترجع الدالة أقصى بعد عن أقرب قيمة ثابتة
 * 0 أو1 كمؤشر للحواف الانتقالية.
 */
function calculateMaximumMaskCorrectionV3(
  mask:
    SegmentationFloatMask
): number {
  let maximumTransition =
    0;

  for (
    let index = 0;
    index < mask.data.length;
    index += 1
  ) {
    const alpha =
      safeUnitValueV3(
        mask.data[index]
      );

    const nearestHardAlphaDistance =
      Math.min(
        alpha,
        1 -
          alpha
      );

    if (
      nearestHardAlphaDistance >
      maximumTransition
    ) {
      maximumTransition =
        nearestHardAlphaDistance;
    }
  }

  return clampUnitValue(
    maximumTransition
  );
}

/**
 * حساب عدد Pixels الانتقالية في النتيجة.
 */
export function countAdaptiveTransitionPixelsV3(
  result:
    ImageGuidedAdaptiveEdgeResultV3,
  minimumAlpha =
    SEMI_TRANSPARENT_MINIMUM,
  maximumAlpha =
    SEMI_TRANSPARENT_MAXIMUM
): number {
  if (
    !isValidAdaptiveEdgeResultV3(
      result
    )
  ) {
    return 0;
  }

  let safeMinimumAlpha =
    clampUnitValue(
      minimumAlpha
    );

  let safeMaximumAlpha =
    clampUnitValue(
      maximumAlpha
    );

  if (
    safeMinimumAlpha >
    safeMaximumAlpha
  ) {
    const temporary =
      safeMinimumAlpha;

    safeMinimumAlpha =
      safeMaximumAlpha;

    safeMaximumAlpha =
      temporary;
  }

  let count =
    0;

  for (
    let index = 0;
    index <
      result.mask.data.length;
    index += 1
  ) {
    const alpha =
      safeUnitValueV3(
        result.mask.data[
          index
        ]
      );

    if (
      alpha >
        safeMinimumAlpha &&
      alpha <
        safeMaximumAlpha
    ) {
      count +=
        1;
    }
  }

  return count;
}

/* =========================================================
 * Summary
 * ======================================================= */

/**
 * إنشاء Summary نصي قصير.
 */
export function getAdaptiveEdgeSummaryV3(
  result:
    ImageGuidedAdaptiveEdgeResultV3
): string {
  if (
    !isValidAdaptiveEdgeResultV3(
      result
    )
  ) {
    return (
      'AdaptiveEdgeRefinerV3: invalid result.'
    );
  }

  return [
    'AdaptiveEdgeRefinerV3',
    `${result.mask.width}x${result.mask.height}`,
    `processed=${result.processedPixelCount}`,
    `changed=${result.changedPixelCount}`,
    `haloRemoved=${result.removedHaloPixelCount}`,
    `edgesPreserved=${result.preservedEdgePixelCount}`,
    `detailsRecovered=${result.recoveredDetailPixelCount}`,
    `averageCorrection=${result.averageCorrection.toFixed(4)}`,
  ].join(' | ');
}

/* =========================================================
 * Additional validation helpers
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

const AdaptiveEdgeRefinerV3 = {
  DEFAULT_CONFIG:
    DEFAULT_ADAPTIVE_EDGE_CONFIG_V3,

  createDefaultConfig:
    createDefaultAdaptiveEdgeConfigV3,

  resolveConfig:
    resolveAdaptiveEdgeConfigV3,

  refine:
    refineAdaptiveEdgesV3,

  run:
    runAdaptiveEdgeRefinerV3,

  calculatePixelDecision:
    calculateAdaptiveEdgeDecisionV3,

  validate:
    isValidAdaptiveEdgeResultV3,

  clone:
    cloneAdaptiveEdgeResultV3,

  createDiagnostics:
    createAdaptiveEdgeDiagnosticsV3,

  createExecutionDiagnostics:
    createAdaptiveEdgeExecutionDiagnosticsV3,

  estimateBytes:
    estimateAdaptiveEdgeResultBytesV3,

  countTransitionPixels:
    countAdaptiveTransitionPixelsV3,

  getSummary:
    getAdaptiveEdgeSummaryV3,
};

export default
  AdaptiveEdgeRefinerV3;