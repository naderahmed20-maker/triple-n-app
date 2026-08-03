// scan/core/ai/ConfidenceVotingV3.ts
// Part 1/2
//
// Triple N - Confidence Voting V3
//
// هذا الملف مسؤول عن مراجعة قرارات
// ImageGuidedPixelClassifierV3.
//
// أي Pixel غير مؤكدة تسأل الجيران:
//
// - هل أغلب الجيران Foreground؟
// - هل أغلب الجيران Background؟
// - هل الجيران أصحاب ثقة كافية؟
// - هل Pixel تقع على حافة قوية يجب حمايتها؟
// - هل Pixel معزولة ويجب حذفها؟
//
// يتم تنفيذ عدة Passes صغيرة بدل قرار واحد قاسٍ،
// لتقليل:
//
// - النقاط العشوائية.
// - الضوضاء.
// - الثقوب الصغيرة.
// - Pixels المعزولة.
// - القرارات غير المستقرة.
//
// هذا الملف لا ينفذ تحسين الهالة النهائي.
// AdaptiveEdgeRefinerV3.ts سيقوم بالمرحلة الأخيرة.

import type {
    ImageGuidedBoundaryFeatureMapV3,
    ImageGuidedConfidenceVotingConfigV3,
    ImageGuidedConfidenceVotingResultV3,
    ImageGuidedPixelClassifierResultV3,
    SegmentationFloatMask,
} from './types';

import {
    clampSegmentationValue,
    clampUnitValue,
    cloneFloatMask,
    isValidFloatMask,
} from './types';

import {
    IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3,
    IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3,
    IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3,
    IMAGE_GUIDED_CLASSIFICATION_UNPROCESSED_V3,
    isValidPixelClassifierResultV3,
} from './ImageGuidedPixelClassifierV3';

/* =========================================================
 * Public contracts
 * ======================================================= */

/**
 * مدخلات تصويت الجيران.
 */
export type ConfidenceVotingInputV3 = {
  /**
   * نتيجة مصنف Pixels.
   */
  classifierResult:
    ImageGuidedPixelClassifierResultV3;

  /**
   * خرائط خصائص الحدود.
   */
  featureMap:
    ImageGuidedBoundaryFeatureMapV3;

  /**
   * خريطة الجسم الأساسي.
   *
   * 1 = داخل الجسم.
   * 0 = خارج الجسم.
   */
  mainComponentMap:
    Uint8Array;

  /**
   * إعدادات اختيارية.
   */
  config?:
    Partial<
      ImageGuidedConfidenceVotingConfigV3
    >;
};

/**
 * نتيجة التنفيذ مع الإعدادات والوقت.
 */
export type ConfidenceVotingExecutionV3 = {
  result:
    ImageGuidedConfidenceVotingResultV3;

  config:
    ImageGuidedConfidenceVotingConfigV3;

  durationMs: number;
};

/**
 * نتيجة تصويت Pixel واحدة.
 */
export type ConfidenceVotingPixelDecisionV3 = {
  index: number;

  originalClassification: number;

  votedClassification: number;

  foregroundVote: number;

  backgroundVote: number;

  uncertainVote: number;

  totalVoteWeight: number;

  confidence: number;

  refinedAlpha: number;

  changed: boolean;

  resolvedUncertain: boolean;

  promotedForeground: boolean;

  rejectedForeground: boolean;
};

/**
 * معلومات تشخيصية عن Pass واحدة.
 */
export type ConfidenceVotingPassDiagnosticsV3 = {
  passIndex: number;

  changedPixelCount: number;

  promotedForegroundPixelCount: number;

  rejectedForegroundPixelCount: number;

  resolvedUncertainPixelCount: number;

  remainingUncertainPixelCount: number;

  averageConfidence: number;
};

/* =========================================================
 * Internal contracts
 * ======================================================= */

type SafeConfidenceVotingContextV3 = {
  width: number;

  height: number;

  pixelCount: number;

  classifierResult:
    ImageGuidedPixelClassifierResultV3;

  featureMap:
    ImageGuidedBoundaryFeatureMapV3;

  mainComponentMap:
    Uint8Array;

  config:
    ImageGuidedConfidenceVotingConfigV3;

  warnings:
    string[];
};

type VotingPassInputV3 = {
  context:
    SafeConfidenceVotingContextV3;

  passIndex: number;

  sourceMask:
    SegmentationFloatMask;

  sourceClassificationMap:
    Uint8Array;

  sourceConfidenceMap:
    Float32Array;

  targetMask:
    SegmentationFloatMask;

  targetClassificationMap:
    Uint8Array;

  targetConfidenceMap:
    Float32Array;
};

type VotingPassAccumulatorV3 = {
  changedPixelCount: number;

  promotedForegroundPixelCount: number;

  rejectedForegroundPixelCount: number;

  resolvedUncertainPixelCount: number;

  remainingUncertainPixelCount: number;

  confidenceSum: number;

  processedPixelCount: number;
};

type NeighborhoodVoteV3 = {
  foregroundVote: number;

  backgroundVote: number;

  uncertainVote: number;

  totalWeight: number;

  foregroundNeighborCount: number;

  backgroundNeighborCount: number;

  uncertainNeighborCount: number;

  validNeighborCount: number;

  averageNeighborConfidence: number;
};

/* =========================================================
 * Constants
 * ======================================================= */

const MAXIMUM_SAFE_PIXEL_COUNT =
  32_000_000;

const MAXIMUM_WARNING_COUNT =
  64;

const MAXIMUM_SAFE_RADIUS =
  8;

const MAXIMUM_SAFE_PASSES =
  8;

const VOTE_EPSILON =
  0.000_001;

const ALPHA_CHANGE_EPSILON =
  0.000_5;

const STRONG_FOREGROUND_ALPHA =
  0.88;

const STRONG_BACKGROUND_ALPHA =
  0.06;

const STRONG_EDGE_CONTINUITY =
  0.70;

const STRONG_COMPONENT_SUPPORT =
  0.74;

const STRONG_NEIGHBOR_AGREEMENT =
  0.76;

const ISOLATED_FOREGROUND_MAXIMUM_RATIO =
  0.18;

const MINIMUM_RELIABLE_NEIGHBORS =
  2;

/* =========================================================
 * Default configuration
 * ======================================================= */

/**
 * إعدادات متوازنة لتقليل الضوضاء
 * بدون حذف التفاصيل الرفيعة.
 */
export const DEFAULT_CONFIDENCE_VOTING_CONFIG_V3:
  Readonly<
    ImageGuidedConfidenceVotingConfigV3
  > = {
    /**
     * نصف قطر الجيران.
     */
    radius:
      1,

    /**
     * عدد مرات التصويت.
     */
    passes:
      2,

    /**
     * أقل Confidence ليكون قرار الجار مؤثرًا.
     */
    minimumVotingConfidence:
      0.42,

    /**
     * النسبة المطلوبة لقبول Foreground.
     */
    foregroundVoteThreshold:
      0.60,

    /**
     * النسبة المطلوبة لقبول Background.
     */
    backgroundVoteThreshold:
      0.60,

    /**
     * وزن قرار Pixel الأصلي.
     */
    originalDecisionWeight:
      0.85,

    /**
     * وزن قرارات الجيران.
     */
    neighborDecisionWeight:
      1.00,

    /**
     * وزن حماية الحواف القوية.
     */
    edgeProtectionWeight:
      0.75,

    /**
     * حماية Foreground القوي.
     */
    preserveStrongForeground:
      true,

    /**
     * حذف Foreground المعزول.
     */
    removeIsolatedForeground:
      true,
  };

/* =========================================================
 * Configuration helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من الإعدادات الافتراضية.
 */
export function createDefaultConfidenceVotingConfigV3():
  ImageGuidedConfidenceVotingConfigV3 {
  return {
    ...DEFAULT_CONFIDENCE_VOTING_CONFIG_V3,
  };
}

/**
 * دمج وتطبيع إعدادات التصويت.
 */
export function resolveConfidenceVotingConfigV3(
  config?:
    Partial<
      ImageGuidedConfidenceVotingConfigV3
    > | null
): ImageGuidedConfidenceVotingConfigV3 {
  const source =
    config ?? {};

  let foregroundVoteThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.foregroundVoteThreshold,
        DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
          .foregroundVoteThreshold
      )
    );

  let backgroundVoteThreshold =
    clampUnitValue(
      finiteOrFallbackV3(
        source.backgroundVoteThreshold,
        DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
          .backgroundVoteThreshold
      )
    );

  foregroundVoteThreshold =
    Math.max(
      0.5,
      foregroundVoteThreshold
    );

  backgroundVoteThreshold =
    Math.max(
      0.5,
      backgroundVoteThreshold
    );

  return {
    radius:
      clampIntegerV3(
        source.radius,
        DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
          .radius,
        1,
        MAXIMUM_SAFE_RADIUS
      ),

    passes:
      clampIntegerV3(
        source.passes,
        DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
          .passes,
        1,
        MAXIMUM_SAFE_PASSES
      ),

    minimumVotingConfidence:
      clampUnitValue(
        finiteOrFallbackV3(
          source.minimumVotingConfidence,
          DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
            .minimumVotingConfidence
        )
      ),

    foregroundVoteThreshold,

    backgroundVoteThreshold,

    originalDecisionWeight:
      clampSegmentationValue(
        finiteOrFallbackV3(
          source.originalDecisionWeight,
          DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
            .originalDecisionWeight
        ),
        0,
        10
      ),

    neighborDecisionWeight:
      clampSegmentationValue(
        finiteOrFallbackV3(
          source.neighborDecisionWeight,
          DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
            .neighborDecisionWeight
        ),
        0,
        10
      ),

    edgeProtectionWeight:
      clampSegmentationValue(
        finiteOrFallbackV3(
          source.edgeProtectionWeight,
          DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
            .edgeProtectionWeight
        ),
        0,
        10
      ),

    preserveStrongForeground:
      source.preserveStrongForeground ??
      DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
        .preserveStrongForeground,

    removeIsolatedForeground:
      source.removeIsolatedForeground ??
      DEFAULT_CONFIDENCE_VOTING_CONFIG_V3
        .removeIsolatedForeground,
  };
}

/* =========================================================
 * Main public function
 * ======================================================= */

/**
 * تنفيذ تصويت الجيران على نتيجة المصنف.
 */
export function applyConfidenceVotingV3(
  input:
    ConfidenceVotingInputV3
): ConfidenceVotingExecutionV3 {
  const startedAt =
    nowMsV3();

  const context =
    createSafeVotingContextV3(
      input
    );

  const {
    pixelCount,
    classifierResult,
    config,
    warnings,
  } = context;

  let sourceMask =
    cloneFloatMask(
      classifierResult.mask
    );

  let sourceClassificationMap =
    new Uint8Array(
      classifierResult
        .classificationMap
    );

  let sourceConfidenceMap =
    new Float32Array(
      classifierResult
        .confidenceMap
    );

  let targetMask =
    cloneFloatMask(
      sourceMask
    );

  let targetClassificationMap =
    new Uint8Array(
      pixelCount
    );

  let targetConfidenceMap =
    new Float32Array(
      pixelCount
    );

  const passDiagnostics:
    ConfidenceVotingPassDiagnosticsV3[] = [];

  let totalChangedPixelCount =
    0;

  let totalPromotedForegroundPixelCount =
    0;

  let totalRejectedForegroundPixelCount =
    0;

  let totalResolvedUncertainPixelCount =
    0;

  let passesApplied =
    0;

  for (
    let passIndex = 0;
    passIndex < config.passes;
    passIndex += 1
  ) {
    targetMask.data.set(
      sourceMask.data
    );

    targetClassificationMap.set(
      sourceClassificationMap
    );

    targetConfidenceMap.set(
      sourceConfidenceMap
    );

    const passResult =
      runVotingPassV3({
        context,

        passIndex,

        sourceMask,

        sourceClassificationMap,

        sourceConfidenceMap,

        targetMask,

        targetClassificationMap,

        targetConfidenceMap,
      });

    passDiagnostics.push(
      passResult
    );

    passesApplied +=
      1;

    totalChangedPixelCount +=
      passResult.changedPixelCount;

    totalPromotedForegroundPixelCount +=
      passResult
        .promotedForegroundPixelCount;

    totalRejectedForegroundPixelCount +=
      passResult
        .rejectedForegroundPixelCount;

    totalResolvedUncertainPixelCount +=
      passResult
        .resolvedUncertainPixelCount;

    const previousMask =
      sourceMask;

    sourceMask =
      targetMask;

    targetMask =
      previousMask;

    const previousClassificationMap =
      sourceClassificationMap;

    sourceClassificationMap =
      targetClassificationMap;

    targetClassificationMap =
      previousClassificationMap;

    const previousConfidenceMap =
      sourceConfidenceMap;

    sourceConfidenceMap =
      targetConfidenceMap;

    targetConfidenceMap =
      previousConfidenceMap;

    /**
     * لو Pass لم تغيّر أي Pixel،
     * لا داعي لتكرار نفس الحساب.
     */
    if (
      passResult.changedPixelCount ===
      0
    ) {
      break;
    }
  }

  let remainingUncertainPixelCount =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    if (
      sourceClassificationMap[
        index
      ] ===
      IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3
    ) {
      remainingUncertainPixelCount +=
        1;
    }
  }

  if (
    remainingUncertainPixelCount >
    classifierResult.processedPixelCount *
      0.35
  ) {
    pushWarningV3(
      warnings,
      'A large number of uncertain pixels remained after confidence voting.'
    );
  }

  if (
    totalChangedPixelCount ===
    0
  ) {
    pushWarningV3(
      warnings,
      'Confidence voting completed without changing any pixel.'
    );
  }

  const result:
    ImageGuidedConfidenceVotingResultV3 = {
      mask:
        sourceMask,

      confidenceMap:
        sourceConfidenceMap,

      changedPixelCount:
        totalChangedPixelCount,

      promotedForegroundPixelCount:
        totalPromotedForegroundPixelCount,

      rejectedForegroundPixelCount:
        totalRejectedForegroundPixelCount,

      resolvedUncertainPixelCount:
        totalResolvedUncertainPixelCount,

      remainingUncertainPixelCount,

      passesApplied,

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
export const runConfidenceVotingV3 =
  applyConfidenceVotingV3;

/* =========================================================
 * Voting pass
 * ======================================================= */

/**
 * تنفيذ Pass واحدة.
 */
function runVotingPassV3(
  input:
    VotingPassInputV3
): ConfidenceVotingPassDiagnosticsV3 {
  const {
    context,
    passIndex,
    sourceMask,
    sourceClassificationMap,
    sourceConfidenceMap,
    targetMask,
    targetClassificationMap,
    targetConfidenceMap,
  } = input;

  const {
    pixelCount,
    featureMap,
  } = context;

  const accumulator:
    VotingPassAccumulatorV3 = {
    changedPixelCount:
      0,

    promotedForegroundPixelCount:
      0,

    rejectedForegroundPixelCount:
      0,

    resolvedUncertainPixelCount:
      0,

    remainingUncertainPixelCount:
      0,

    confidenceSum:
      0,

    processedPixelCount:
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
      continue;
    }

    const decision =
      calculateVotingDecisionV3(
        context,
        index,
        sourceMask,
        sourceClassificationMap,
        sourceConfidenceMap
      );

    targetMask.data[index] =
      decision.refinedAlpha;

    targetClassificationMap[
      index
    ] =
      decision.votedClassification;

    targetConfidenceMap[index] =
      decision.confidence;

    accumulator.processedPixelCount +=
      1;

    accumulator.confidenceSum +=
      decision.confidence;

    if (
      decision.changed
    ) {
      accumulator.changedPixelCount +=
        1;
    }

    if (
      decision.promotedForeground
    ) {
      accumulator
        .promotedForegroundPixelCount +=
        1;
    }

    if (
      decision.rejectedForeground
    ) {
      accumulator
        .rejectedForegroundPixelCount +=
        1;
    }

    if (
      decision.resolvedUncertain
    ) {
      accumulator
        .resolvedUncertainPixelCount +=
        1;
    }

    if (
      decision.votedClassification ===
      IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3
    ) {
      accumulator
        .remainingUncertainPixelCount +=
        1;
    }
  }

  const averageConfidence =
    accumulator.processedPixelCount >
      0
      ? accumulator.confidenceSum /
        accumulator.processedPixelCount
      : 0;

  return {
    passIndex,

    changedPixelCount:
      accumulator.changedPixelCount,

    promotedForegroundPixelCount:
      accumulator
        .promotedForegroundPixelCount,

    rejectedForegroundPixelCount:
      accumulator
        .rejectedForegroundPixelCount,

    resolvedUncertainPixelCount:
      accumulator
        .resolvedUncertainPixelCount,

    remainingUncertainPixelCount:
      accumulator
        .remainingUncertainPixelCount,

    averageConfidence:
      clampUnitValue(
        averageConfidence
      ),
  };
}

/* =========================================================
 * Single-pixel voting
 * ======================================================= */

/**
 * حساب قرار التصويت لـPixel واحدة.
 */
export function calculateVotingDecisionV3(
  context:
    SafeConfidenceVotingContextV3,
  index: number,
  sourceMask:
    SegmentationFloatMask,
  sourceClassificationMap:
    Uint8Array,
  sourceConfidenceMap:
    Float32Array
): ConfidenceVotingPixelDecisionV3 {
  const {
    featureMap,
    mainComponentMap,
    config,
  } = context;

  const originalClassification =
    sourceClassificationMap[
      index
    ];

  const originalAlpha =
    safeUnitValueV3(
      sourceMask.data[
        index
      ]
    );

  const originalConfidence =
    safeUnitValueV3(
      sourceConfidenceMap[
        index
      ]
    );

  const neighborhood =
    collectNeighborhoodVoteV3(
      context,
      index,
      sourceClassificationMap,
      sourceConfidenceMap
    );

  const insideMainComponent =
    mainComponentMap[
      index
    ] !== 0;

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

  const protectedStrongForeground =
    config.preserveStrongForeground &&
    (
      (
        insideMainComponent &&
        originalAlpha >=
          STRONG_FOREGROUND_ALPHA
      ) ||
      (
        componentSupport >=
          STRONG_COMPONENT_SUPPORT &&
        edgeContinuity >=
          STRONG_EDGE_CONTINUITY &&
        neighborAgreement >=
          STRONG_NEIGHBOR_AGREEMENT
      )
    );

  const originalVotes =
    createOriginalDecisionVotesV3(
      originalClassification,
      originalConfidence,
      config.originalDecisionWeight
    );

  const edgeProtectionVote =
    calculateEdgeProtectionVoteV3(
      originalClassification,
      originalAlpha,
      insideMainComponent,
      edgeContinuity,
      componentSupport,
      config.edgeProtectionWeight
    );

  let foregroundVote =
    originalVotes.foreground +
    neighborhood.foregroundVote *
      config.neighborDecisionWeight +
    edgeProtectionVote.foreground;

  let backgroundVote =
    originalVotes.background +
    neighborhood.backgroundVote *
      config.neighborDecisionWeight +
    edgeProtectionVote.background;

  let uncertainVote =
    originalVotes.uncertain +
    neighborhood.uncertainVote *
      config.neighborDecisionWeight;

  if (
    protectedStrongForeground
  ) {
    foregroundVote +=
      2.5;

    backgroundVote *=
      0.25;

    uncertainVote *=
      0.40;
  }

  const isolatedForeground =
    config.removeIsolatedForeground &&
    originalClassification ===
      IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3 &&
    neighborhood.validNeighborCount >=
      MINIMUM_RELIABLE_NEIGHBORS &&
    neighborhood.foregroundNeighborCount /
      Math.max(
        1,
        neighborhood.validNeighborCount
      ) <=
      ISOLATED_FOREGROUND_MAXIMUM_RATIO &&
    !insideMainComponent &&
    componentSupport <
      0.50 &&
    edgeContinuity <
      0.52;

  if (
    isolatedForeground
  ) {
    backgroundVote +=
      1.75;

    foregroundVote *=
      0.45;
  }

  const totalVoteWeight =
    Math.max(
      VOTE_EPSILON,
      foregroundVote +
        backgroundVote +
        uncertainVote
    );

  const foregroundRatio =
    foregroundVote /
    totalVoteWeight;

  const backgroundRatio =
    backgroundVote /
    totalVoteWeight;

  const uncertainRatio =
    uncertainVote /
    totalVoteWeight;

  let votedClassification =
    originalClassification;

  if (
    protectedStrongForeground
  ) {
    votedClassification =
      IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3;
  } else if (
    foregroundRatio >=
      config.foregroundVoteThreshold &&
    foregroundRatio >
      backgroundRatio
  ) {
    votedClassification =
      IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3;
  } else if (
    backgroundRatio >=
      config.backgroundVoteThreshold &&
    backgroundRatio >
      foregroundRatio
  ) {
    votedClassification =
      IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3;
  } else {
    votedClassification =
      IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3;
  }

  const confidence =
    calculateVotingConfidenceV3(
      votedClassification,
      foregroundRatio,
      backgroundRatio,
      uncertainRatio,
      originalConfidence,
      neighborhood,
      edgeContinuity,
      componentSupport
    );

  const refinedAlpha =
    calculateVotedAlphaV3(
      originalAlpha,
      originalClassification,
      votedClassification,
      confidence,
      foregroundRatio,
      backgroundRatio,
      edgeContinuity,
      componentSupport,
      protectedStrongForeground
    );

  const changed =
    votedClassification !==
      originalClassification ||
    Math.abs(
      refinedAlpha -
      originalAlpha
    ) >
      ALPHA_CHANGE_EPSILON;

  return {
    index,

    originalClassification,

    votedClassification,

    foregroundVote:
      foregroundRatio,

    backgroundVote:
      backgroundRatio,

    uncertainVote:
      uncertainRatio,

    totalVoteWeight,

    confidence,

    refinedAlpha,

    changed,

    resolvedUncertain:
      originalClassification ===
        IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3 &&
      votedClassification !==
        IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3,

    promotedForeground:
      originalClassification !==
        IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3 &&
      votedClassification ===
        IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3,

    rejectedForeground:
      originalClassification ===
        IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3 &&
      votedClassification ===
        IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3,
  };
}

/* =========================================================
 * Neighborhood collection
 * ======================================================= */

/**
 * جمع أصوات الجيران حول Pixel.
 */
function collectNeighborhoodVoteV3(
  context:
    SafeConfidenceVotingContextV3,
  index: number,
  classificationMap:
    Uint8Array,
  confidenceMap:
    Float32Array
): NeighborhoodVoteV3 {
  const {
    width,
    height,
    featureMap,
    config,
  } = context;

  const x =
    index %
    width;

  const y =
    Math.floor(
      index /
        width
    );

  const minimumX =
    Math.max(
      0,
      x -
        config.radius
    );

  const maximumX =
    Math.min(
      width -
        1,
      x +
        config.radius
    );

  const minimumY =
    Math.max(
      0,
      y -
        config.radius
    );

  const maximumY =
    Math.min(
      height -
        1,
      y +
        config.radius
    );

  let foregroundVote =
    0;

  let backgroundVote =
    0;

  let uncertainVote =
    0;

  let totalWeight =
    0;

  let foregroundNeighborCount =
    0;

  let backgroundNeighborCount =
    0;

  let uncertainNeighborCount =
    0;

  let validNeighborCount =
    0;

  let confidenceSum =
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

      const classification =
        classificationMap[
          neighborIndex
        ];

      if (
        classification ===
        IMAGE_GUIDED_CLASSIFICATION_UNPROCESSED_V3
      ) {
        continue;
      }

      const confidence =
        safeUnitValueV3(
          confidenceMap[
            neighborIndex
          ]
        );

      if (
        confidence <
        config.minimumVotingConfidence
      ) {
        continue;
      }

      const deltaX =
        neighborX -
        x;

      const deltaY =
        neighborY -
        y;

      const distance =
        Math.sqrt(
          deltaX *
            deltaX +
          deltaY *
            deltaY
        );

      const spatialWeight =
        1 /
        Math.max(
          1,
          distance
        );

      const activeSupport =
        featureMap
          .activeBoundaryMap[
            neighborIndex
          ] !== 0
          ? 1
          : 0.65;

      const edgeSupport =
        0.75 +
        safeUnitValueV3(
          featureMap
            .edgeContinuity[
              neighborIndex
            ]
        ) *
          0.25;

      const finalWeight =
        confidence *
        spatialWeight *
        activeSupport *
        edgeSupport;

      if (
        finalWeight <=
        VOTE_EPSILON
      ) {
        continue;
      }

      validNeighborCount +=
        1;

      confidenceSum +=
        confidence;

      totalWeight +=
        finalWeight;

      switch (
        classification
      ) {
        case IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3:
          foregroundVote +=
            finalWeight;

          foregroundNeighborCount +=
            1;

          break;

        case IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3:
          backgroundVote +=
            finalWeight;

          backgroundNeighborCount +=
            1;

          break;

        case IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3:
          uncertainVote +=
            finalWeight *
            0.55;

          uncertainNeighborCount +=
            1;

          break;
      }
    }
  }

  return {
    foregroundVote,

    backgroundVote,

    uncertainVote,

    totalWeight,

    foregroundNeighborCount,

    backgroundNeighborCount,

    uncertainNeighborCount,

    validNeighborCount,

    averageNeighborConfidence:
      validNeighborCount >
        0
        ? confidenceSum /
          validNeighborCount
        : 0,
  };
}

/* =========================================================
 * Original decision votes
 * ======================================================= */

function createOriginalDecisionVotesV3(
  classification: number,
  confidence: number,
  weight: number
): {
  foreground: number;

  background: number;

  uncertain: number;
} {
  const finalWeight =
    Math.max(
      0,
      weight
    ) *
    (
      0.40 +
      safeUnitValueV3(
        confidence
      ) *
        0.60
    );

  switch (
    classification
  ) {
    case IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3:
      return {
        foreground:
          finalWeight,

        background:
          0,

        uncertain:
          0,
      };

    case IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3:
      return {
        foreground:
          0,

        background:
          finalWeight,

        uncertain:
          0,
      };

    case IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3:
      return {
        foreground:
          0,

        background:
          0,

        uncertain:
          finalWeight,
      };

    default:
      return {
        foreground:
          0,

        background:
          0,

        uncertain:
          0,
      };
  }
}

/* =========================================================
 * Edge-protection votes
 * ======================================================= */

function calculateEdgeProtectionVoteV3(
  originalClassification: number,
  originalAlpha: number,
  insideMainComponent: boolean,
  edgeContinuity: number,
  componentSupport: number,
  weight: number
): {
  foreground: number;

  background: number;
} {
  const safeWeight =
    Math.max(
      0,
      weight
    );

  const visualProtection =
    clampUnitValue(
      edgeContinuity *
        0.58 +
      componentSupport *
        0.42
    );

  let foreground =
    0;

  let background =
    0;

  if (
    insideMainComponent
  ) {
    foreground +=
      safeWeight *
      (
        0.55 +
        visualProtection *
          0.45
      );
  }

  if (
    originalClassification ===
      IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3 &&
    originalAlpha >=
      0.50
  ) {
    foreground +=
      safeWeight *
      visualProtection *
      0.75;
  }

  if (
    originalClassification ===
      IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3 &&
    originalAlpha <=
      STRONG_BACKGROUND_ALPHA &&
    componentSupport <
      0.35
  ) {
    background +=
      safeWeight *
      (
        1 -
        visualProtection
      );
  }

  return {
    foreground,

    background,
  };
}

/* =========================================================
 * Context validation
 * ======================================================= */

function createSafeVotingContextV3(
  input:
    ConfidenceVotingInputV3
): SafeConfidenceVotingContextV3 {
  if (
    typeof input !==
      'object' ||
    input === null
  ) {
    throw new Error(
      'ConfidenceVotingV3 received an invalid input object.'
    );
  }

  if (
    !isValidPixelClassifierResultV3(
      input.classifierResult
    )
  ) {
    throw new Error(
      'ConfidenceVotingV3 received an invalid pixel-classifier result.'
    );
  }

  if (
    !isValidBoundaryFeatureMapV3(
      input.featureMap
    )
  ) {
    throw new Error(
      'ConfidenceVotingV3 received an invalid boundary feature map.'
    );
  }

  const {
    width,
    height,
  } = input.classifierResult.mask;

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
      `ConfidenceVotingV3 received an unsafe pixel count: ${pixelCount}.`
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
        'ConfidenceVotingV3 input sizes do not match.',
        `Classifier result: ${width}x${height}.`,
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
      'ConfidenceVotingV3 received an invalid main component map.'
    );
  }

  const warnings:
    string[] = [];

  const config =
    resolveConfidenceVotingConfigV3(
      input.config
    );

  const mainComponentMap =
    normalizeBinaryMapV3(
      input.mainComponentMap
    );

  inspectVotingSourcesV3(
    input.classifierResult,
    input.featureMap,
    warnings
  );

  return {
    width,

    height,

    pixelCount,

    classifierResult:
      input.classifierResult,

    featureMap:
      input.featureMap,

    mainComponentMap,

    config,

    warnings,
  };
}

/* =========================================================
 * Boundary feature-map validation
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

function inspectVotingSourcesV3(
  classifierResult:
    ImageGuidedPixelClassifierResultV3,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3,
  warnings:
    string[]
): void {
  const pixelCount =
    classifierResult.mask.width *
    classifierResult.mask.height;

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

  let invalidClassificationCount =
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
        classifierResult
          .mask.data[
            index
          ]
      )
    ) {
      invalidMaskCount +=
        1;
    }

    if (
      !isFiniteUnitValueV3(
        classifierResult
          .confidenceMap[
            index
          ]
      )
    ) {
      invalidConfidenceCount +=
        1;
    }

    const classification =
      classifierResult
        .classificationMap[
          index
        ];

    if (
      classification !==
        IMAGE_GUIDED_CLASSIFICATION_UNPROCESSED_V3 &&
      classification !==
        IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3 &&
      classification !==
        IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3 &&
      classification !==
        IMAGE_GUIDED_CLASSIFICATION_UNCERTAIN_V3
    ) {
      invalidClassificationCount +=
        1;
    }

    if (
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
      'Some mask values were invalid and will be clamped during voting.'
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
    invalidClassificationCount >
    0
  ) {
    pushWarningV3(
      warnings,
      'Some classification-map values were unsupported.'
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
// function calculateVotingConfidenceV3(...)
//
// ويحتوي على:
//
// - حساب Confidence النهائي.
// - إنتاج Alpha بعد التصويت.
// - حماية Foreground القوي.
// - حل Pixels غير المؤكدة.
// - Result validator.
// - Clone.
// - Diagnostics.
// - Memory estimation.
// - Summary.
// - Default export.
/* =========================================================
 * Voting confidence
 * ======================================================= */

/**
 * حساب Confidence النهائي بعد التصويت.
 *
 * يعتمد على:
 *
 * - وضوح الفرق بين Foreground وBackground.
 * - قوة القرار الفائز.
 * - ثقة الجيران.
 * - دعم الحافة.
 * - دعم الجسم الأساسي.
 */
function calculateVotingConfidenceV3(
  votedClassification: number,
  foregroundRatio: number,
  backgroundRatio: number,
  uncertainRatio: number,
  originalConfidence: number,
  neighborhood:
    NeighborhoodVoteV3,
  edgeContinuity: number,
  componentSupport: number
): number {
  const foreground =
    clampUnitValue(
      foregroundRatio
    );

  const background =
    clampUnitValue(
      backgroundRatio
    );

  const uncertain =
    clampUnitValue(
      uncertainRatio
    );

  const dominantVote =
    Math.max(
      foreground,
      background,
      uncertain
    );

  const foregroundBackgroundMargin =
    Math.abs(
      foreground -
      background
    );

  const classificationAgreement =
    votedClassification ===
      IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3
      ? foreground
      : votedClassification ===
          IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3
        ? background
        : uncertain;

  const neighborConfidence =
    clampUnitValue(
      neighborhood
        .averageNeighborConfidence
    );

  const neighborCoverage =
    clampUnitValue(
      neighborhood.validNeighborCount /
        Math.max(
          MINIMUM_RELIABLE_NEIGHBORS,
          (
            neighborhood
              .foregroundNeighborCount +
            neighborhood
              .backgroundNeighborCount +
            neighborhood
              .uncertainNeighborCount
          )
        )
    );

  const structuralConfidence =
    clampUnitValue(
      safeUnitValueV3(
        edgeContinuity
      ) *
        0.45 +
      safeUnitValueV3(
        componentSupport
      ) *
        0.55
    );

  const uncertaintyPenalty =
    uncertain *
    0.35;

  const confidence =
    originalConfidence *
      0.18 +
    dominantVote *
      0.22 +
    foregroundBackgroundMargin *
      0.22 +
    classificationAgreement *
      0.16 +
    neighborConfidence *
      0.10 +
    neighborCoverage *
      0.04 +
    structuralConfidence *
      0.08 -
    uncertaintyPenalty;

  return clampUnitValue(
    confidence
  );
}

/* =========================================================
 * Alpha refinement after voting
 * ======================================================= */

/**
 * حساب Alpha الجديد بعد قرار التصويت.
 *
 * لا نستخدم Snap كامل هنا حتى لا نفقد
 * التفاصيل الرفيعة أو الحواف الناعمة.
 */
function calculateVotedAlphaV3(
  originalAlpha: number,
  originalClassification: number,
  votedClassification: number,
  confidence: number,
  foregroundRatio: number,
  backgroundRatio: number,
  edgeContinuity: number,
  componentSupport: number,
  protectedStrongForeground: boolean
): number {
  const safeOriginalAlpha =
    safeUnitValueV3(
      originalAlpha
    );

  const safeConfidence =
    safeUnitValueV3(
      confidence
    );

  const safeForegroundRatio =
    safeUnitValueV3(
      foregroundRatio
    );

  const safeBackgroundRatio =
    safeUnitValueV3(
      backgroundRatio
    );

  const safeEdgeContinuity =
    safeUnitValueV3(
      edgeContinuity
    );

  const safeComponentSupport =
    safeUnitValueV3(
      componentSupport
    );

  if (
    protectedStrongForeground
  ) {
    return clampUnitValue(
      Math.max(
        safeOriginalAlpha,
        0.94
      )
    );
  }

  if (
    votedClassification ===
    IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3
  ) {
    const structuralTarget =
      clampUnitValue(
        safeForegroundRatio *
          0.58 +
        safeComponentSupport *
          0.24 +
        safeEdgeContinuity *
          0.18
      );

    const targetAlpha =
      Math.max(
        safeOriginalAlpha,
        structuralTarget
      );

    const classificationChanged =
      originalClassification !==
      IMAGE_GUIDED_CLASSIFICATION_FOREGROUND_V3;

    const blendStrength =
      classificationChanged
        ? clampUnitValue(
            0.30 +
            safeConfidence *
              0.48
          )
        : clampUnitValue(
            0.18 +
            safeConfidence *
              0.34
          );

    return clampUnitValue(
      safeOriginalAlpha *
        (
          1 -
          blendStrength
        ) +
      targetAlpha *
        blendStrength
    );
  }

  if (
    votedClassification ===
    IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3
  ) {
    const edgeProtection =
      clampUnitValue(
        safeEdgeContinuity *
          0.58 +
        safeComponentSupport *
          0.42
      );

    const targetAlpha =
      clampUnitValue(
        (
          1 -
          safeBackgroundRatio
        ) *
          0.28 +
        safeForegroundRatio *
          0.12 +
        edgeProtection *
          0.10
      );

    const classificationChanged =
      originalClassification !==
      IMAGE_GUIDED_CLASSIFICATION_BACKGROUND_V3;

    let blendStrength =
      classificationChanged
        ? clampUnitValue(
            0.38 +
            safeConfidence *
              0.48
          )
        : clampUnitValue(
            0.22 +
            safeConfidence *
              0.40
          );

    /**
     * حماية الحافة القوية من الحذف السريع.
     */
    if (
      safeEdgeContinuity >=
        STRONG_EDGE_CONTINUITY ||
      safeComponentSupport >=
        STRONG_COMPONENT_SUPPORT
    ) {
      blendStrength *=
        0.55;
    }

    return clampUnitValue(
      safeOriginalAlpha *
        (
          1 -
          blendStrength
        ) +
      Math.min(
        safeOriginalAlpha,
        targetAlpha
      ) *
        blendStrength
    );
  }

  /**
   * Uncertain:
   *
   * نحافظ على Alpha الأصلي مع تعديل بسيط
   * باتجاه نتيجة التصويت الأقوى.
   */
  const voteSum =
    Math.max(
      VOTE_EPSILON,
      safeForegroundRatio +
        safeBackgroundRatio
    );

  const normalizedForegroundPreference =
    safeForegroundRatio /
    voteSum;

  const uncertaintyTarget =
    clampUnitValue(
      normalizedForegroundPreference *
        0.70 +
      safeEdgeContinuity *
        0.15 +
      safeComponentSupport *
        0.15
    );

  const blendStrength =
    clampUnitValue(
      0.08 +
      safeConfidence *
        0.18
    );

  return clampUnitValue(
    safeOriginalAlpha *
      (
        1 -
        blendStrength
      ) +
    uncertaintyTarget *
      blendStrength
  );
}

/* =========================================================
 * Public result validation
 * ======================================================= */

/**
 * التحقق من صلاحية نتيجة Confidence Voting.
 */
export function isValidConfidenceVotingResultV3(
  value: unknown
): value is ImageGuidedConfidenceVotingResultV3 {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const result =
    value as Partial<
      ImageGuidedConfidenceVotingResultV3
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
      result.confidenceMap,
      pixelCount
    )
  ) {
    return false;
  }

  if (
    !isValidNonNegativeIntegerV3(
      result.changedPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.promotedForegroundPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.rejectedForegroundPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.resolvedUncertainPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.remainingUncertainPixelCount
    ) ||
    !isValidNonNegativeIntegerV3(
      result.passesApplied
    )
  ) {
    return false;
  }

  if (
    result.changedPixelCount >
      pixelCount ||
    result.promotedForegroundPixelCount >
      pixelCount ||
    result.rejectedForegroundPixelCount >
      pixelCount ||
    result.resolvedUncertainPixelCount >
      pixelCount ||
    result.remainingUncertainPixelCount >
      pixelCount ||
    result.passesApplied >
      MAXIMUM_SAFE_PASSES
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
 * إنشاء نسخة مستقلة من نتيجة التصويت.
 */
export function cloneConfidenceVotingResultV3(
  result:
    ImageGuidedConfidenceVotingResultV3
): ImageGuidedConfidenceVotingResultV3 {
  if (
    !isValidConfidenceVotingResultV3(
      result
    )
  ) {
    throw new Error(
      'Cannot clone an invalid ImageGuidedConfidenceVotingResultV3.'
    );
  }

  return {
    mask:
      cloneFloatMask(
        result.mask
      ),

    confidenceMap:
      new Float32Array(
        result.confidenceMap
      ),

    changedPixelCount:
      result.changedPixelCount,

    promotedForegroundPixelCount:
      result
        .promotedForegroundPixelCount,

    rejectedForegroundPixelCount:
      result
        .rejectedForegroundPixelCount,

    resolvedUncertainPixelCount:
      result
        .resolvedUncertainPixelCount,

    remainingUncertainPixelCount:
      result
        .remainingUncertainPixelCount,

    passesApplied:
      result.passesApplied,

    warnings:
      [...result.warnings],
  };
}

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type ConfidenceVotingDiagnosticsV3 = {
  width: number;

  height: number;

  pixelCount: number;

  changedPixelCount: number;

  changedPixelRatio: number;

  promotedForegroundPixelCount: number;

  promotedForegroundPixelRatio: number;

  rejectedForegroundPixelCount: number;

  rejectedForegroundPixelRatio: number;

  resolvedUncertainPixelCount: number;

  resolvedUncertainPixelRatio: number;

  remainingUncertainPixelCount: number;

  remainingUncertainPixelRatio: number;

  passesApplied: number;

  averageConfidence: number;

  highConfidencePixelCount: number;

  mediumConfidencePixelCount: number;

  lowConfidencePixelCount: number;

  estimatedMemoryBytes: number;

  warnings:
    readonly string[];
};

/**
 * إنشاء Diagnostics لنتيجة التصويت.
 */
export function createConfidenceVotingDiagnosticsV3(
  result:
    ImageGuidedConfidenceVotingResultV3
): ConfidenceVotingDiagnosticsV3 {
  if (
    !isValidConfidenceVotingResultV3(
      result
    )
  ) {
    throw new Error(
      'Cannot create diagnostics from an invalid confidence-voting result.'
    );
  }

  const pixelCount =
    result.mask.width *
    result.mask.height;

  let confidenceSum =
    0;

  let confidenceSampleCount =
    0;

  let highConfidencePixelCount =
    0;

  let mediumConfidencePixelCount =
    0;

  let lowConfidencePixelCount =
    0;

  for (
    let index = 0;
    index < pixelCount;
    index += 1
  ) {
    const confidence =
      result.confidenceMap[
        index
      ];

    if (
      !Number.isFinite(
        confidence
      )
    ) {
      continue;
    }

    const safeConfidence =
      clampUnitValue(
        confidence
      );

    confidenceSum +=
      safeConfidence;

    confidenceSampleCount +=
      1;

    if (
      safeConfidence >=
      0.75
    ) {
      highConfidencePixelCount +=
        1;
    } else if (
      safeConfidence >=
      0.40
    ) {
      mediumConfidencePixelCount +=
        1;
    } else {
      lowConfidencePixelCount +=
        1;
    }
  }

  const averageConfidence =
    confidenceSampleCount >
      0
      ? confidenceSum /
        confidenceSampleCount
      : 0;

  return {
    width:
      result.mask.width,

    height:
      result.mask.height,

    pixelCount,

    changedPixelCount:
      result.changedPixelCount,

    changedPixelRatio:
      pixelCount >
        0
        ? result.changedPixelCount /
          pixelCount
        : 0,

    promotedForegroundPixelCount:
      result
        .promotedForegroundPixelCount,

    promotedForegroundPixelRatio:
      pixelCount >
        0
        ? result
            .promotedForegroundPixelCount /
          pixelCount
        : 0,

    rejectedForegroundPixelCount:
      result
        .rejectedForegroundPixelCount,

    rejectedForegroundPixelRatio:
      pixelCount >
        0
        ? result
            .rejectedForegroundPixelCount /
          pixelCount
        : 0,

    resolvedUncertainPixelCount:
      result
        .resolvedUncertainPixelCount,

    resolvedUncertainPixelRatio:
      pixelCount >
        0
        ? result
            .resolvedUncertainPixelCount /
          pixelCount
        : 0,

    remainingUncertainPixelCount:
      result
        .remainingUncertainPixelCount,

    remainingUncertainPixelRatio:
      pixelCount >
        0
        ? result
            .remainingUncertainPixelCount /
          pixelCount
        : 0,

    passesApplied:
      result.passesApplied,

    averageConfidence:
      clampUnitValue(
        averageConfidence
      ),

    highConfidencePixelCount,

    mediumConfidencePixelCount,

    lowConfidencePixelCount,

    estimatedMemoryBytes:
      estimateConfidenceVotingResultBytesV3(
        result
      ),

    warnings:
      [...result.warnings],
  };
}

/* =========================================================
 * Memory estimation
 * ======================================================= */

/**
 * تقدير استهلاك نتيجة التصويت للذاكرة.
 */
export function estimateConfidenceVotingResultBytesV3(
  result:
    ImageGuidedConfidenceVotingResultV3
): number {
  if (
    !isValidConfidenceVotingResultV3(
      result
    )
  ) {
    return 0;
  }

  const warningBytes =
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
    result.confidenceMap.byteLength +
    warningBytes
  );
}

/* =========================================================
 * Summary
 * ======================================================= */

/**
 * Summary نصي قصير للتسجيلات.
 */
export function getConfidenceVotingSummaryV3(
  result:
    ImageGuidedConfidenceVotingResultV3
): string {
  if (
    !isValidConfidenceVotingResultV3(
      result
    )
  ) {
    return (
      'ConfidenceVotingV3: invalid result.'
    );
  }

  return [
    'ConfidenceVotingV3',
    `${result.mask.width}x${result.mask.height}`,
    `passes=${result.passesApplied}`,
    `changed=${result.changedPixelCount}`,
    `promoted=${result.promotedForegroundPixelCount}`,
    `rejected=${result.rejectedForegroundPixelCount}`,
    `resolvedUncertain=${result.resolvedUncertainPixelCount}`,
    `remainingUncertain=${result.remainingUncertainPixelCount}`,
  ].join(' | ');
}

/* =========================================================
 * Public confidence-map helpers
 * ======================================================= */

/**
 * إنشاء خريطة Pixels منخفضة الثقة.
 *
 * 1 = Confidence أقل من Threshold.
 * 0 = Confidence كافية.
 */
export function createLowConfidenceMapV3(
  result:
    ImageGuidedConfidenceVotingResultV3,
  threshold =
    0.40
): Uint8Array {
  if (
    !isValidConfidenceVotingResultV3(
      result
    )
  ) {
    throw new Error(
      'Cannot create a low-confidence map from an invalid voting result.'
    );
  }

  const safeThreshold =
    clampUnitValue(
      threshold
    );

  const output =
    new Uint8Array(
      result.confidenceMap.length
    );

  for (
    let index = 0;
    index <
      result.confidenceMap.length;
    index += 1
  ) {
    const confidence =
      safeUnitValueV3(
        result.confidenceMap[
          index
        ]
      );

    output[index] =
      confidence <
        safeThreshold
        ? 1
        : 0;
  }

  return output;
}

/**
 * حساب متوسط Confidence داخل Active Boundary فقط.
 */
export function calculateActiveVotingConfidenceV3(
  result:
    ImageGuidedConfidenceVotingResultV3,
  featureMap:
    ImageGuidedBoundaryFeatureMapV3
): number {
  if (
    !isValidConfidenceVotingResultV3(
      result
    ) ||
    !isValidBoundaryFeatureMapV3(
      featureMap
    ) ||
    result.mask.width !==
      featureMap.width ||
    result.mask.height !==
      featureMap.height
  ) {
    return 0;
  }

  const pixelCount =
    result.mask.width *
    result.mask.height;

  let confidenceSum =
    0;

  let activeCount =
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

    confidenceSum +=
      safeUnitValueV3(
        result.confidenceMap[
          index
        ]
      );

    activeCount +=
      1;
  }

  return activeCount >
    0
    ? clampUnitValue(
        confidenceSum /
          activeCount
      )
    : 0;
}

/* =========================================================
 * Pass diagnostics helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة من Diagnostics الخاصة بالـPass.
 */
export function cloneConfidenceVotingPassDiagnosticsV3(
  diagnostics:
    ConfidenceVotingPassDiagnosticsV3
): ConfidenceVotingPassDiagnosticsV3 {
  return {
    passIndex:
      diagnostics.passIndex,

    changedPixelCount:
      diagnostics.changedPixelCount,

    promotedForegroundPixelCount:
      diagnostics
        .promotedForegroundPixelCount,

    rejectedForegroundPixelCount:
      diagnostics
        .rejectedForegroundPixelCount,

    resolvedUncertainPixelCount:
      diagnostics
        .resolvedUncertainPixelCount,

    remainingUncertainPixelCount:
      diagnostics
        .remainingUncertainPixelCount,

    averageConfidence:
      diagnostics.averageConfidence,
  };
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

const ConfidenceVotingV3 = {
  DEFAULT_CONFIG:
    DEFAULT_CONFIDENCE_VOTING_CONFIG_V3,

  createDefaultConfig:
    createDefaultConfidenceVotingConfigV3,

  resolveConfig:
    resolveConfidenceVotingConfigV3,

  apply:
    applyConfidenceVotingV3,

  run:
    runConfidenceVotingV3,

  calculatePixelDecision:
    calculateVotingDecisionV3,

  validate:
    isValidConfidenceVotingResultV3,

  clone:
    cloneConfidenceVotingResultV3,

  createDiagnostics:
    createConfidenceVotingDiagnosticsV3,

  estimateBytes:
    estimateConfidenceVotingResultBytesV3,

  createLowConfidenceMap:
    createLowConfidenceMapV3,

  calculateActiveConfidence:
    calculateActiveVotingConfidenceV3,

  clonePassDiagnostics:
    cloneConfidenceVotingPassDiagnosticsV3,

  getSummary:
    getConfidenceVotingSummaryV3,
};

export default
  ConfidenceVotingV3;