// scan/core/ai/PromptFailureAnalyzerV3.ts
// Part 1/2
//
// Triple N - EdgeSAM Prompt Failure Analyzer V3
//
// محلل مختصر وشامل لفشل Mask Candidate.
//
// المسؤوليات:
//
// 1) اكتشاف الماسك الفارغ أو المنهار.
// 2) اكتشاف الماسك الصغير أو الكبير.
// 3) اكتشاف التجزؤ والأجسام المنفصلة.
// 4) اكتشاف الثقوب.
// 5) اكتشاف ملامسة حدود الصورة.
// 6) اكتشاف ضعف الثقة والاستقرار.
// 7) اكتشاف Background / Shadow Leak عند توفر الصورة.
// 8) اقتراح الإجراء المناسب للمحاولة التالية.
//
// هذا الملف:
// - لا يشغّل Decoder.
// - لا يعدّل Prompt.
// - لا يعدّل Mask.

/* =========================================================
 * Imports
 * ======================================================= */

import type {
    EdgeSamMaskCandidate,
    EdgeSamPrompt,
    SegmentationCancellationSignal,
    SegmentationFloatMask,
    SegmentationMaskBounds,
    SegmentationProgressCallback,
    SegmentationProgressEvent,
} from './types';

import {
    SEGMENTATION_STAGE_INDEX,
    SEGMENTATION_TOTAL_STAGES,
    SegmentationError,
    clampUnitValue,
    createSegmentationRequestId,
    getSegmentationProgress,
    getUnknownErrorMessage,
    isSegmentationError,
    isValidFloatMask,
} from './types';

/* =========================================================
 * Public types
 * ======================================================= */

export type PromptFailureCategoryV3 =
  | 'none'
  | 'invalid-candidate'
  | 'collapsed-foreground'
  | 'undersized-mask'
  | 'oversized-mask'
  | 'fragmentation'
  | 'detached-region'
  | 'internal-holes'
  | 'excessive-edge-contact'
  | 'off-center-subject'
  | 'low-model-confidence'
  | 'low-mask-stability'
  | 'background-leak'
  | 'shadow-leak'
  | 'foreground-loss'
  | 'thin-structure-loss'
  | 'boundary-instability'
  | 'unknown';

export type PromptFailureSeverityV3 =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type PromptFailureSuggestedActionV3 =
  | 'none'
  | 'add-positive-point'
  | 'add-negative-point'
  | 'add-multiple-positive-points'
  | 'add-multiple-negative-points'
  | 'expand-box'
  | 'shrink-box'
  | 'recenter-box'
  | 'use-previous-mask'
  | 'remove-previous-mask'
  | 'protect-boundary'
  | 'strengthen-thin-structure-support'
  | 'replace-prompt'
  | 'reject-candidate'
  | 'stop-refinement';

export type PromptFailureAnalysisImageV3 = {
  width:
    number;

  height:
    number;

  red:
    Float32Array;

  green:
    Float32Array;

  blue:
    Float32Array;

  luminance:
    Float32Array;

  saturation:
    Float32Array;

  gradient:
    Float32Array;
};

export type PromptFailureEvidencePointV3 = {
  x:
    number;

  y:
    number;

  confidence:
    number;

  reason:
    string;
};

export type PromptFailureV3 = {
  id:
    string;

  category:
    PromptFailureCategoryV3;

  severity:
    PromptFailureSeverityV3;

  score:
    number;

  confidence:
    number;

  actionable:
    boolean;

  candidateRejecting:
    boolean;

  message:
    string;

  suggestedAction:
    PromptFailureSuggestedActionV3;

  positivePoints:
    readonly PromptFailureEvidencePointV3[];

  negativePoints:
    readonly PromptFailureEvidencePointV3[];
};

export type PromptFailureFlagsV3 = {
  hasFailure:
    boolean;

  invalidCandidate:
    boolean;

  foregroundCollapsed:
    boolean;

  undersizedMask:
    boolean;

  oversizedMask:
    boolean;

  fragmentedMask:
    boolean;

  detachedRegionDetected:
    boolean;

  holesDetected:
    boolean;

  excessiveEdgeContact:
    boolean;

  offCenterSubject:
    boolean;

  lowModelConfidence:
    boolean;

  lowMaskStability:
    boolean;

  backgroundLeakDetected:
    boolean;

  shadowLeakDetected:
    boolean;

  foregroundLossDetected:
    boolean;

  thinStructureLost:
    boolean;

  unstableBoundary:
    boolean;
};

export type PromptFailurePenaltiesV3 = {
  collapsePenalty:
    number;

  sizePenalty:
    number;

  fragmentationPenalty:
    number;

  holePenalty:
    number;

  edgePenalty:
    number;

  centeringPenalty:
    number;

  confidencePenalty:
    number;

  stabilityPenalty:
    number;

  validityPenalty:
    number;

  backgroundPenalty:
    number;

  shadowPenalty:
    number;

  boundaryPenalty:
    number;

  totalPenalty:
    number;
};

export type PromptFailureQualityScoresV3 = {
  geometryScore:
    number;

  isolationScore:
    number;

  boundaryScore:
    number;

  backgroundSeparationScore:
    number;

  confidenceScore:
    number;

  stabilityScore:
    number;

  overallQualityScore:
    number;
};

export type PromptFailureDiagnosticsV3 = {
  maskWidth:
    number;

  maskHeight:
    number;

  foregroundPixels:
    number;

  foregroundRatio:
    number;

  componentCount:
    number;

  significantComponentCount:
    number;

  largestComponentRatio:
    number;

  secondLargestComponentRatio:
    number;

  detachedPixelRatio:
    number;

  holeRatio:
    number;

  edgeContactRatio:
    number;

  touchedEdgeCount:
    number;

  centerOffsetRatio:
    number;

  boundaryPixelCount:
    number;

  boundaryAgreement:
    number;

  backgroundLeakRatio:
    number;

  shadowLeakRatio:
    number;

  previousMaskIou:
    number | null;

  previousMaskSizeRatio:
    number | null;

  bounds:
    SegmentationMaskBounds | null;

  warnings:
    readonly string[];
};

export type PromptFailureAnalysisRequestV3 = {
  requestId?:
    string;

  candidate:
    EdgeSamMaskCandidate;

  prompt:
    EdgeSamPrompt;

  analysisImage?:
    PromptFailureAnalysisImageV3 | null;

  previousMask?:
    SegmentationFloatMask | null;

  iterationIndex?:
    number;

  cancellationSignal?:
    SegmentationCancellationSignal;

  onProgress?:
    SegmentationProgressCallback;
};

export type PromptFailureAnalysisResultV3 = {
  requestId:
    string;

  iterationIndex:
    number;

  candidate:
    EdgeSamMaskCandidate;

  prompt:
    EdgeSamPrompt;

  failures:
    readonly PromptFailureV3[];

  dominantFailure:
    PromptFailureV3 | null;

  flags:
    PromptFailureFlagsV3;

  penalties:
    PromptFailurePenaltiesV3;

  qualityScores:
    PromptFailureQualityScoresV3;

  diagnostics:
    PromptFailureDiagnosticsV3;

  shouldRefine:
    boolean;

  candidateUsable:
    boolean;

  candidateRejected:
    boolean;

  recommendedAction:
    PromptFailureSuggestedActionV3;

  warnings:
    readonly string[];

  durationMs:
    number;
};

/* =========================================================
 * Configuration
 * ======================================================= */

export type PromptFailureAnalyzerConfigV3 = {
  enabled:
    boolean;

  foregroundThreshold:
    number;

  minimumForegroundRatio:
    number;

  maximumForegroundRatio:
    number;

  collapsedForegroundRatio:
    number;

  minimumLargestComponentRatio:
    number;

  maximumSecondComponentRatio:
    number;

  minimumSignificantComponentRatio:
    number;

  maximumSignificantComponentCount:
    number;

  maximumDetachedPixelRatio:
    number;

  maximumHoleRatio:
    number;

  maximumEdgeContactRatio:
    number;

  maximumTouchedEdgeCount:
    number;

  maximumCenterOffsetRatio:
    number;

  minimumPredictedIou:
    number;

  minimumStabilityScore:
    number;

  minimumCandidateScore:
    number;

  minimumBoundaryAgreement:
    number;

  maximumBackgroundLeakRatio:
    number;

  maximumShadowLeakRatio:
    number;

  maximumSuggestedPoints:
    number;

  minimumFailureScore:
    number;

  actionableFailureScore:
    number;

  candidateRejectingScore:
    number;

  minimumUsableQualityScore:
    number;
};

export const DEFAULT_PROMPT_FAILURE_ANALYZER_CONFIG_V3:
  Readonly<PromptFailureAnalyzerConfigV3> = {
    enabled:
      true,

    foregroundThreshold:
      0.5,

    minimumForegroundRatio:
      0.025,

    maximumForegroundRatio:
      0.92,

    collapsedForegroundRatio:
      0.008,

    minimumLargestComponentRatio:
      0.72,

    maximumSecondComponentRatio:
      0.14,

    minimumSignificantComponentRatio:
      0.008,

    maximumSignificantComponentCount:
      2,

    maximumDetachedPixelRatio:
      0.12,

    maximumHoleRatio:
      0.10,

    maximumEdgeContactRatio:
      0.055,

    maximumTouchedEdgeCount:
      1,

    maximumCenterOffsetRatio:
      0.30,

    minimumPredictedIou:
      0.52,

    minimumStabilityScore:
      0.48,

    minimumCandidateScore:
      0.50,

    minimumBoundaryAgreement:
      0.45,

    maximumBackgroundLeakRatio:
      0.12,

    maximumShadowLeakRatio:
      0.10,

    maximumSuggestedPoints:
      8,

    minimumFailureScore:
      0.18,

    actionableFailureScore:
      0.30,

    candidateRejectingScore:
      0.78,

    minimumUsableQualityScore:
      0.56,
  };

/* =========================================================
 * Internal types
 * ======================================================= */

type BinaryMaskV3 = {
  width:
    number;

  height:
    number;

  data:
    Uint8Array;

  foregroundPixels:
    number;
};

type ComponentV3 = {
  id:
    number;

  pixels:
    number;

  bounds:
    SegmentationMaskBounds;

  centerX:
    number;

  centerY:
    number;
};

type MaskMeasurementsV3 = {
  binary:
    BinaryMaskV3;

  components:
    readonly ComponentV3[];

  significantComponents:
    readonly ComponentV3[];

  foregroundRatio:
    number;

  largestComponentRatio:
    number;

  secondLargestComponentRatio:
    number;

  detachedPixelRatio:
    number;

  bounds:
    SegmentationMaskBounds | null;

  centerOffsetRatio:
    number;

  edgeContactPixels:
    number;

  edgeContactRatio:
    number;

  touchedEdgeCount:
    number;

  holePixels:
    number;

  holeRatio:
    number;

  boundary:
    Uint8Array;

  boundaryIndices:
    Int32Array;

  boundaryPixelCount:
    number;
};

type PreviousMaskComparisonV3 = {
  iou:
    number;

  sizeRatio:
    number;

  collapsed:
    boolean;

  expanded:
    boolean;
};

/* =========================================================
 * Basic helpers
 * ======================================================= */

function nowV3():
  number {
  return Date.now();
}

function assertNotCancelledV3(
  signal:
    SegmentationCancellationSignal |
    undefined
):
  void {
  signal?.throwIfCancelled();
}

function safeDivideV3(
  numerator:
    number,
  denominator:
    number,
  fallback =
    0
):
  number {
  if (
    !Number.isFinite(
      numerator
    ) ||
    !Number.isFinite(
      denominator
    ) ||
    denominator ===
      0
  ) {
    return fallback;
  }

  const value =
    numerator /
    denominator;

  return Number.isFinite(
    value
  )
    ? value
    : fallback;
}

function ratioV3(
  numerator:
    number,
  denominator:
    number
):
  number {
  return clampUnitValue(
    safeDivideV3(
      numerator,
      denominator,
      0
    )
  );
}

function clampIntegerV3(
  value:
    number,
  minimum:
    number,
  maximum:
    number
):
  number {
  const finite =
    Number.isFinite(
      value
    )
      ? Math.round(
          value
        )
      : minimum;

  return Math.min(
    maximum,
    Math.max(
      minimum,
      finite
    )
  );
}

function scoreAboveV3(
  value:
    number,
  threshold:
    number,
  severe:
    number
):
  number {
  if (
    value <=
    threshold
  ) {
    return 0;
  }

  return clampUnitValue(
    safeDivideV3(
      value -
        threshold,
      Math.max(
        1e-8,
        severe -
          threshold
      ),
      1
    )
  );
}

function scoreBelowV3(
  value:
    number,
  threshold:
    number,
  severe:
    number
):
  number {
  if (
    value >=
    threshold
  ) {
    return 0;
  }

  return clampUnitValue(
    safeDivideV3(
      threshold -
        value,
      Math.max(
        1e-8,
        threshold -
          severe
      ),
      1
    )
  );
}

function severityFromScoreV3(
  score:
    number
):
  PromptFailureSeverityV3 {
  if (
    score >=
    0.85
  ) {
    return 'critical';
  }

  if (
    score >=
    0.65
  ) {
    return 'high';
  }

  if (
    score >=
    0.40
  ) {
    return 'medium';
  }

  if (
    score >
    0
  ) {
    return 'low';
  }

  return 'none';
}

function normalizeConfigV3(
  input?:
    Partial<
      PromptFailureAnalyzerConfigV3
    >
):
  PromptFailureAnalyzerConfigV3 {
  const defaults =
    DEFAULT_PROMPT_FAILURE_ANALYZER_CONFIG_V3;

  const result = {
    ...defaults,
    ...(input ?? {}),
  };

  return {
    ...result,

    foregroundThreshold:
      clampUnitValue(
        result.foregroundThreshold
      ),

    minimumForegroundRatio:
      clampUnitValue(
        result.minimumForegroundRatio
      ),

    maximumForegroundRatio:
      clampUnitValue(
        result.maximumForegroundRatio
      ),

    collapsedForegroundRatio:
      clampUnitValue(
        result.collapsedForegroundRatio
      ),

    minimumLargestComponentRatio:
      clampUnitValue(
        result.minimumLargestComponentRatio
      ),

    maximumSecondComponentRatio:
      clampUnitValue(
        result.maximumSecondComponentRatio
      ),

    minimumSignificantComponentRatio:
      clampUnitValue(
        result.minimumSignificantComponentRatio
      ),

    maximumSignificantComponentCount:
      clampIntegerV3(
        result.maximumSignificantComponentCount,
        1,
        64
      ),

    maximumDetachedPixelRatio:
      clampUnitValue(
        result.maximumDetachedPixelRatio
      ),

    maximumHoleRatio:
      clampUnitValue(
        result.maximumHoleRatio
      ),

    maximumEdgeContactRatio:
      clampUnitValue(
        result.maximumEdgeContactRatio
      ),

    maximumTouchedEdgeCount:
      clampIntegerV3(
        result.maximumTouchedEdgeCount,
        0,
        4
      ),

    maximumCenterOffsetRatio:
      clampUnitValue(
        result.maximumCenterOffsetRatio
      ),

    minimumPredictedIou:
      clampUnitValue(
        result.minimumPredictedIou
      ),

    minimumStabilityScore:
      clampUnitValue(
        result.minimumStabilityScore
      ),

    minimumCandidateScore:
      clampUnitValue(
        result.minimumCandidateScore
      ),

    minimumBoundaryAgreement:
      clampUnitValue(
        result.minimumBoundaryAgreement
      ),

    maximumBackgroundLeakRatio:
      clampUnitValue(
        result.maximumBackgroundLeakRatio
      ),

    maximumShadowLeakRatio:
      clampUnitValue(
        result.maximumShadowLeakRatio
      ),

    maximumSuggestedPoints:
      clampIntegerV3(
        result.maximumSuggestedPoints,
        0,
        32
      ),

    minimumFailureScore:
      clampUnitValue(
        result.minimumFailureScore
      ),

    actionableFailureScore:
      clampUnitValue(
        result.actionableFailureScore
      ),

    candidateRejectingScore:
      clampUnitValue(
        result.candidateRejectingScore
      ),

    minimumUsableQualityScore:
      clampUnitValue(
        result.minimumUsableQualityScore
      ),
  };
}

export function createPromptFailureAnalyzerConfigV3(
  input?:
    Partial<
      PromptFailureAnalyzerConfigV3
    >
):
  PromptFailureAnalyzerConfigV3 {
  return normalizeConfigV3(
    input
  );
}

/* =========================================================
 * Validation
 * ======================================================= */

function validateRequestV3(
  request:
    PromptFailureAnalysisRequestV3
):
  void {
  if (
    !request ||
    typeof request !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Prompt failure analysis request is required.'
    );
  }

  if (
    !request.candidate ||
    typeof request.candidate !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      'Mask candidate is required.'
    );
  }

  if (
    !isValidFloatMask(
      request
        .candidate
        .normalizedMask
    )
  ) {
    throw new SegmentationError(
      'MASK_INVALID',
      'Candidate normalized mask is invalid.'
    );
  }

  if (
    !request.prompt ||
    typeof request.prompt !==
      'object'
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'EdgeSAM prompt is invalid.'
    );
  }

  const mask =
    request
      .candidate
      .normalizedMask;

  if (
    request.previousMask
  ) {
    if (
      !isValidFloatMask(
        request.previousMask
      ) ||
      request.previousMask.width !==
        mask.width ||
      request.previousMask.height !==
        mask.height
    ) {
      throw new SegmentationError(
        'MASK_INVALID',
        'Previous mask must match the current mask dimensions.'
      );
    }
  }

  if (
    request.analysisImage
  ) {
    const image =
      request.analysisImage;

    const pixelCount =
      mask.width *
      mask.height;

    if (
      image.width !==
        mask.width ||
      image.height !==
        mask.height ||
      image.red.length !==
        pixelCount ||
      image.green.length !==
        pixelCount ||
      image.blue.length !==
        pixelCount ||
      image.luminance.length !==
        pixelCount ||
      image.saturation.length !==
        pixelCount ||
      image.gradient.length !==
        pixelCount
    ) {
      throw new SegmentationError(
        'INVALID_INPUT',
        'Analysis image must match the current mask dimensions.'
      );
    }
  }

  assertNotCancelledV3(
    request.cancellationSignal
  );
}

/* =========================================================
 * Progress
 * ======================================================= */

function emitProgressV3(
  requestId:
    string,
  startedAt:
    number,
  callback:
    SegmentationProgressCallback |
    undefined,
  message:
    string,
  metadata?:
    Record<
      string,
      string | number | boolean | null
    >
):
  void {
  if (
    !callback
  ) {
    return;
  }

  const stage =
    'select-best-mask' as const;

  const event:
    SegmentationProgressEvent = {
      requestId,

      stage,

      stageNumber:
        SEGMENTATION_STAGE_INDEX[
          stage
        ],

      totalStages:
        SEGMENTATION_TOTAL_STAGES,

      progress:
        getSegmentationProgress(
          stage
        ),

      message,

      elapsedMs:
        Math.max(
          0,
          nowV3() -
            startedAt
        ),

      metadata,
    };

  callback(
    event
  );
}

/* =========================================================
 * Binary mask
 * ======================================================= */

function createBinaryMaskV3(
  mask:
    SegmentationFloatMask,
  threshold:
    number,
  signal:
    SegmentationCancellationSignal |
    undefined
):
  BinaryMaskV3 {
  const pixelCount =
    mask.width *
    mask.height;

  const data =
    new Uint8Array(
      pixelCount
    );

  let foregroundPixels =
    0;

  for (
    let index = 0;
    index <
    pixelCount;
    index += 1
  ) {
    if (
      (
        index &
        65_535
      ) ===
      0
    ) {
      assertNotCancelledV3(
        signal
      );
    }

    if (
      mask.data[
        index
      ] >=
      threshold
    ) {
      data[
        index
      ] = 1;

      foregroundPixels +=
        1;
    }
  }

  return {
    width:
      mask.width,

    height:
      mask.height,

    data,

    foregroundPixels,
  };
}

/* =========================================================
 * Bounds
 * ======================================================= */

function createBoundsV3(
  minimumX:
    number,
  minimumY:
    number,
  maximumX:
    number,
  maximumY:
    number,
  width:
    number,
  height:
    number
):
  SegmentationMaskBounds {
  const x =
    Math.max(
      0,
      minimumX
    );

  const y =
    Math.max(
      0,
      minimumY
    );

  const x2 =
    Math.min(
      width -
        1,
      maximumX
    );

  const y2 =
    Math.min(
      height -
        1,
      maximumY
    );

  const boundsWidth =
    x2 -
    x +
    1;

  const boundsHeight =
    y2 -
    y +
    1;

  const area =
    boundsWidth *
    boundsHeight;

  return {
    x,
    y,

    width:
      boundsWidth,

    height:
      boundsHeight,

    x2,
    y2,
    area,

    areaRatio:
      ratioV3(
        area,
        width *
          height
      ),
  };
}

/* =========================================================
 * Connected components
 * ======================================================= */

function extractComponentsV3(
  binary:
    BinaryMaskV3,
  signal:
    SegmentationCancellationSignal |
    undefined
):
  readonly ComponentV3[] {
  const pixelCount =
    binary.width *
    binary.height;

  const visited =
    new Uint8Array(
      pixelCount
    );

  const components:
    ComponentV3[] =
      [];

  const queue =
    new Int32Array(
      pixelCount
    );

  for (
    let startIndex = 0;
    startIndex <
    pixelCount;
    startIndex += 1
  ) {
    if (
      (
        startIndex &
        65_535
      ) ===
      0
    ) {
      assertNotCancelledV3(
        signal
      );
    }

    if (
      binary.data[
        startIndex
      ] ===
        0 ||
      visited[
        startIndex
      ] ===
        1
    ) {
      continue;
    }

    let readIndex =
      0;

    let writeIndex =
      1;

    queue[
      0
    ] =
      startIndex;

    visited[
      startIndex
    ] = 1;

    let minimumX =
      binary.width;

    let minimumY =
      binary.height;

    let maximumX =
      0;

    let maximumY =
      0;

    let totalX =
      0;

    let totalY =
      0;

    while (
      readIndex <
      writeIndex
    ) {
      const index =
        queue[
          readIndex
        ];

      readIndex +=
        1;

      const x =
        index %
        binary.width;

      const y =
        Math.floor(
          index /
          binary.width
        );

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

      totalX +=
        x;

      totalY +=
        y;

      const neighbors = [
        x >
          0
          ? index -
            1
          : -1,

        x <
          binary.width -
            1
          ? index +
            1
          : -1,

        y >
          0
          ? index -
            binary.width
          : -1,

        y <
          binary.height -
            1
          ? index +
            binary.width
          : -1,
      ];

      for (
        const neighbor of
        neighbors
      ) {
        if (
          neighbor <
            0 ||
          binary.data[
            neighbor
          ] ===
            0 ||
          visited[
            neighbor
          ] ===
            1
        ) {
          continue;
        }

        visited[
          neighbor
        ] = 1;

        queue[
          writeIndex
        ] =
          neighbor;

        writeIndex +=
          1;
      }
    }

    components.push({
      id:
        components.length +
        1,

      pixels:
        writeIndex,

      bounds:
        createBoundsV3(
          minimumX,
          minimumY,
          maximumX,
          maximumY,
          binary.width,
          binary.height
        ),

      centerX:
        safeDivideV3(
          totalX,
          writeIndex,
          0
        ),

      centerY:
        safeDivideV3(
          totalY,
          writeIndex,
          0
        ),
    });
  }

  return components.sort(
    (
      first,
      second
    ) =>
      second.pixels -
      first.pixels
  );
}

/* =========================================================
 * Part 2 continuation
 * ======================================================= */

/**
 * Part 2/2 سيكمل مباشرة بعد هذا التعليق ويحتوي على:
 *
 * - Boundary extraction.
 * - Hole estimation.
 * - Background leak analysis.
 * - Shadow leak analysis.
 * - Previous-mask comparison.
 * - Failure creation.
 * - Penalties and quality scores.
 * - Public analyzePromptFailureV3 API.
 */
// scan/core/ai/PromptFailureAnalyzerV3.ts
// Part 2/2
//
// Triple N - EdgeSAM Prompt Failure Analyzer V3
//
// يكمل مباشرة بعد extractComponentsV3.

/* =========================================================
 * Boundary extraction
 * ======================================================= */

function extractBoundaryV3(
  binary:
    BinaryMaskV3,
  signal:
    SegmentationCancellationSignal |
    undefined
): {
  data:
    Uint8Array;

  indices:
    Int32Array;
} {
  const pixelCount =
    binary.width *
    binary.height;

  const data =
    new Uint8Array(
      pixelCount
    );

  const indices:
    number[] =
      [];

  for (
    let index = 0;
    index <
    pixelCount;
    index += 1
  ) {
    if (
      (
        index &
        65_535
      ) ===
      0
    ) {
      assertNotCancelledV3(
        signal
      );
    }

    if (
      binary.data[
        index
      ] ===
      0
    ) {
      continue;
    }

    const x =
      index %
      binary.width;

    const y =
      Math.floor(
        index /
        binary.width
      );

    const boundaryPixel =
      x ===
        0 ||
      y ===
        0 ||
      x ===
        binary.width -
          1 ||
      y ===
        binary.height -
          1 ||
      binary.data[
        index -
          1
      ] ===
        0 ||
      binary.data[
        index +
          1
      ] ===
        0 ||
      binary.data[
        index -
          binary.width
      ] ===
        0 ||
      binary.data[
        index +
          binary.width
      ] ===
        0;

    if (
      boundaryPixel
    ) {
      data[
        index
      ] = 1;

      indices.push(
        index
      );
    }
  }

  return {
    data,

    indices:
      Int32Array.from(
        indices
      ),
  };
}

/* =========================================================
 * Hole estimation
 * ======================================================= */

function estimateHolesV3(
  binary:
    BinaryMaskV3,
  signal:
    SegmentationCancellationSignal |
    undefined
): {
  holePixels:
    number;

  holeRatio:
    number;
} {
  const pixelCount =
    binary.width *
    binary.height;

  const visited =
    new Uint8Array(
      pixelCount
    );

  const queue =
    new Int32Array(
      pixelCount
    );

  let holePixels =
    0;

  for (
    let startIndex = 0;
    startIndex <
    pixelCount;
    startIndex += 1
  ) {
    if (
      (
        startIndex &
        65_535
      ) ===
      0
    ) {
      assertNotCancelledV3(
        signal
      );
    }

    if (
      binary.data[
        startIndex
      ] ===
        1 ||
      visited[
        startIndex
      ] ===
        1
    ) {
      continue;
    }

    let readIndex =
      0;

    let writeIndex =
      1;

    let touchesImageEdge =
      false;

    queue[
      0
    ] =
      startIndex;

    visited[
      startIndex
    ] = 1;

    while (
      readIndex <
      writeIndex
    ) {
      const index =
        queue[
          readIndex
        ];

      readIndex +=
        1;

      const x =
        index %
        binary.width;

      const y =
        Math.floor(
          index /
          binary.width
        );

      if (
        x ===
          0 ||
        y ===
          0 ||
        x ===
          binary.width -
            1 ||
        y ===
          binary.height -
            1
      ) {
        touchesImageEdge =
          true;
      }

      const neighbors = [
        x >
          0
          ? index -
            1
          : -1,

        x <
          binary.width -
            1
          ? index +
            1
          : -1,

        y >
          0
          ? index -
            binary.width
          : -1,

        y <
          binary.height -
            1
          ? index +
            binary.width
          : -1,
      ];

      for (
        const neighbor of
        neighbors
      ) {
        if (
          neighbor <
            0 ||
          binary.data[
            neighbor
          ] ===
            1 ||
          visited[
            neighbor
          ] ===
            1
        ) {
          continue;
        }

        visited[
          neighbor
        ] = 1;

        queue[
          writeIndex
        ] =
          neighbor;

        writeIndex +=
          1;
      }
    }

    if (
      !touchesImageEdge
    ) {
      holePixels +=
        writeIndex;
    }
  }

  return {
    holePixels,

    holeRatio:
      ratioV3(
        holePixels,
        Math.max(
          1,
          binary.foregroundPixels
        )
      ),
  };
}

/* =========================================================
 * Mask measurements
 * ======================================================= */

function measureMaskV3(
  mask:
    SegmentationFloatMask,
  config:
    PromptFailureAnalyzerConfigV3,
  signal:
    SegmentationCancellationSignal |
    undefined
):
  MaskMeasurementsV3 {
  const binary =
    createBinaryMaskV3(
      mask,
      config.foregroundThreshold,
      signal
    );

  const pixelCount =
    binary.width *
    binary.height;

  const components =
    extractComponentsV3(
      binary,
      signal
    );

  const significantComponents =
    components.filter(
      component =>
        ratioV3(
          component.pixels,
          pixelCount
        ) >=
        config
          .minimumSignificantComponentRatio
    );

  const largest =
    components[
      0
    ] ??
    null;

  const second =
    components[
      1
    ] ??
    null;

  const bounds =
    largest
      ? largest.bounds
      : null;

  const foregroundRatio =
    ratioV3(
      binary.foregroundPixels,
      pixelCount
    );

  const largestComponentRatio =
    ratioV3(
      largest?.pixels ??
        0,
      Math.max(
        1,
        binary.foregroundPixels
      )
    );

  const secondLargestComponentRatio =
    ratioV3(
      second?.pixels ??
        0,
      Math.max(
        1,
        binary.foregroundPixels
      )
    );

  const detachedPixels =
    Math.max(
      0,
      binary.foregroundPixels -
        (
          largest?.pixels ??
          0
        )
    );

  const detachedPixelRatio =
    ratioV3(
      detachedPixels,
      Math.max(
        1,
        binary.foregroundPixels
      )
    );

  let centerOffsetRatio =
    0;

  if (
    largest
  ) {
    const imageCenterX =
      (
        binary.width -
        1
      ) /
      2;

    const imageCenterY =
      (
        binary.height -
        1
      ) /
      2;

    centerOffsetRatio =
      clampUnitValue(
        safeDivideV3(
          Math.hypot(
            largest.centerX -
              imageCenterX,
            largest.centerY -
              imageCenterY
          ),
          Math.max(
            1,
            Math.hypot(
              imageCenterX,
              imageCenterY
            )
          ),
          0
        )
      );
  }

  let edgeContactPixels =
    0;

  let touchesTop =
    false;

  let touchesRight =
    false;

  let touchesBottom =
    false;

  let touchesLeft =
    false;

  for (
    let index = 0;
    index <
    pixelCount;
    index += 1
  ) {
    if (
      binary.data[
        index
      ] ===
      0
    ) {
      continue;
    }

    const x =
      index %
      binary.width;

    const y =
      Math.floor(
        index /
        binary.width
      );

    const top =
      y ===
      0;

    const right =
      x ===
      binary.width -
        1;

    const bottom =
      y ===
      binary.height -
        1;

    const left =
      x ===
      0;

    if (
      top ||
      right ||
      bottom ||
      left
    ) {
      edgeContactPixels +=
        1;
    }

    touchesTop ||= top;
    touchesRight ||= right;
    touchesBottom ||= bottom;
    touchesLeft ||= left;
  }

  const touchedEdgeCount =
    Number(
      touchesTop
    ) +
    Number(
      touchesRight
    ) +
    Number(
      touchesBottom
    ) +
    Number(
      touchesLeft
    );

  const holes =
    estimateHolesV3(
      binary,
      signal
    );

  const boundary =
    extractBoundaryV3(
      binary,
      signal
    );

  return {
    binary,
    components,
    significantComponents,
    foregroundRatio,
    largestComponentRatio,
    secondLargestComponentRatio,
    detachedPixelRatio,
    bounds,
    centerOffsetRatio,
    edgeContactPixels,

    edgeContactRatio:
      ratioV3(
        edgeContactPixels,
        Math.max(
          1,
          binary.foregroundPixels
        )
      ),

    touchedEdgeCount,

    holePixels:
      holes.holePixels,

    holeRatio:
      holes.holeRatio,

    boundary:
      boundary.data,

    boundaryIndices:
      boundary.indices,

    boundaryPixelCount:
      boundary.indices.length,
  };
}

/* =========================================================
 * Previous-mask comparison
 * ======================================================= */

function comparePreviousMaskV3(
  current:
    BinaryMaskV3,
  previousMask:
    SegmentationFloatMask | null | undefined,
  threshold:
    number,
  signal:
    SegmentationCancellationSignal |
    undefined
):
  PreviousMaskComparisonV3 | null {
  if (
    !previousMask
  ) {
    return null;
  }

  let previousPixels =
    0;

  let intersection =
    0;

  let union =
    0;

  const pixelCount =
    current.width *
    current.height;

  for (
    let index = 0;
    index <
    pixelCount;
    index += 1
  ) {
    if (
      (
        index &
        65_535
      ) ===
      0
    ) {
      assertNotCancelledV3(
        signal
      );
    }

    const currentForeground =
      current.data[
        index
      ] ===
      1;

    const previousForeground =
      previousMask.data[
        index
      ] >=
      threshold;

    if (
      previousForeground
    ) {
      previousPixels +=
        1;
    }

    if (
      currentForeground &&
      previousForeground
    ) {
      intersection +=
        1;
    }

    if (
      currentForeground ||
      previousForeground
    ) {
      union +=
        1;
    }
  }

  const sizeRatio =
    previousPixels >
      0
      ? safeDivideV3(
          current.foregroundPixels,
          previousPixels,
          1
        )
      : 1;

  return {
    iou:
      ratioV3(
        intersection,
        union
      ),

    sizeRatio,

    collapsed:
      previousPixels >
        0 &&
      sizeRatio <
        0.45,

    expanded:
      previousPixels >
        0 &&
      sizeRatio >
        1.75,
  };
}

/* =========================================================
 * Image-guided analysis
 * ======================================================= */

function analyzeImageGuidanceV3(
  measurements:
    MaskMeasurementsV3,
  image:
    PromptFailureAnalysisImageV3 | null | undefined,
  config:
    PromptFailureAnalyzerConfigV3,
  signal:
    SegmentationCancellationSignal |
    undefined
): {
  boundaryAgreement:
    number;

  backgroundLeakRatio:
    number;

  shadowLeakRatio:
    number;

  negativePoints:
    readonly PromptFailureEvidencePointV3[];
} {
  if (
    !image ||
    measurements
      .binary
      .foregroundPixels ===
      0
  ) {
    return {
      boundaryAgreement:
        1,

      backgroundLeakRatio:
        0,

      shadowLeakRatio:
        0,

      negativePoints:
        [],
    };
  }

  const binary =
    measurements.binary;

  let agreeingBoundaryPixels =
    0;

  let suspectedBackgroundPixels =
    0;

  let suspectedShadowPixels =
    0;

  const negativeCandidates:
    PromptFailureEvidencePointV3[] =
      [];

  for (
    let position = 0;
    position <
    measurements
      .boundaryIndices
      .length;
    position += 1
  ) {
    if (
      (
        position &
        65_535
      ) ===
      0
    ) {
      assertNotCancelledV3(
        signal
      );
    }

    const index =
      measurements
        .boundaryIndices[
          position
        ];

    const gradient =
      clampUnitValue(
        image.gradient[
          index
        ]
      );

    if (
      gradient >=
      0.10
    ) {
      agreeingBoundaryPixels +=
        1;
    }
  }

  for (
    let index = 0;
    index <
    binary.data.length;
    index += 1
  ) {
    if (
      binary.data[
        index
      ] ===
      0
    ) {
      continue;
    }

    const gradient =
      clampUnitValue(
        image.gradient[
          index
        ]
      );

    const luminance =
      clampUnitValue(
        image.luminance[
          index
        ]
      );

    const saturation =
      clampUnitValue(
        image.saturation[
          index
        ]
      );

    const nearWeakBoundary =
      measurements.boundary[
        index
      ] ===
        1 &&
      gradient <
        0.06;

    const likelyNeutralBackground =
      nearWeakBoundary &&
      saturation <
        0.12 &&
      luminance >
        0.42;

    const likelyShadow =
      nearWeakBoundary &&
      luminance <
        0.32 &&
      saturation <
        0.24;

    if (
      likelyNeutralBackground
    ) {
      suspectedBackgroundPixels +=
        1;

      negativeCandidates.push({
        x:
          index %
          binary.width,

        y:
          Math.floor(
            index /
            binary.width
          ),

        confidence:
          clampUnitValue(
            1 -
              gradient
          ),

        reason:
          'Suspected background leakage near a weak mask boundary.',
      });
    }

    if (
      likelyShadow
    ) {
      suspectedShadowPixels +=
        1;

      negativeCandidates.push({
        x:
          index %
          binary.width,

        y:
          Math.floor(
            index /
            binary.width
          ),

        confidence:
          clampUnitValue(
            1 -
              luminance
          ),

        reason:
          'Suspected shadow leakage near the object boundary.',
      });
    }
  }

  negativeCandidates.sort(
    (
      first,
      second
    ) =>
      second.confidence -
      first.confidence
  );

  return {
    boundaryAgreement:
      measurements
        .boundaryPixelCount >
        0
        ? ratioV3(
            agreeingBoundaryPixels,
            measurements
              .boundaryPixelCount
          )
        : 0,

    backgroundLeakRatio:
      ratioV3(
        suspectedBackgroundPixels,
        Math.max(
          1,
          binary.foregroundPixels
        )
      ),

    shadowLeakRatio:
      ratioV3(
        suspectedShadowPixels,
        Math.max(
          1,
          binary.foregroundPixels
        )
      ),

    negativePoints:
      negativeCandidates.slice(
        0,
        config.maximumSuggestedPoints
      ),
  };
}

/* =========================================================
 * Suggested positive points
 * ======================================================= */

function createPositivePointsV3(
  measurements:
    MaskMeasurementsV3,
  maximumCount:
    number
):
  readonly PromptFailureEvidencePointV3[] {
  const points:
    PromptFailureEvidencePointV3[] =
      [];

  for (
    const component of
    measurements.components
  ) {
    if (
      points.length >=
      maximumCount
    ) {
      break;
    }

    points.push({
      x:
        component.centerX,

      y:
        component.centerY,

      confidence:
        clampUnitValue(
          ratioV3(
            component.pixels,
            Math.max(
              1,
              measurements
                .binary
                .foregroundPixels
            )
          )
        ),

      reason:
        'Support the center of a detected foreground region.',
    });
  }

  if (
    points.length ===
      0
  ) {
    points.push({
      x:
        (
          measurements
            .binary
            .width -
          1
        ) /
        2,

      y:
        (
          measurements
            .binary
            .height -
          1
        ) /
        2,

      confidence:
        0.5,

      reason:
        'Fallback positive point at the mask center.',
    });
  }

  return points.slice(
    0,
    maximumCount
  );
}

/* =========================================================
 * Failure creation
 * ======================================================= */

function createFailureV3(
  category:
    PromptFailureCategoryV3,
  score:
    number,
  message:
    string,
  action:
    PromptFailureSuggestedActionV3,
  config:
    PromptFailureAnalyzerConfigV3,
  positivePoints:
    readonly PromptFailureEvidencePointV3[] =
      [],
  negativePoints:
    readonly PromptFailureEvidencePointV3[] =
      []
):
  PromptFailureV3 | null {
  const safeScore =
    clampUnitValue(
      score
    );

  if (
    safeScore <
    config.minimumFailureScore
  ) {
    return null;
  }

  return {
    id:
      [
        category,
        Math.random()
          .toString(36)
          .slice(
            2,
            8
          ),
      ].join(
        '-'
      ),

    category,

    severity:
      severityFromScoreV3(
        safeScore
      ),

    score:
      safeScore,

    confidence:
      clampUnitValue(
        0.55 +
          safeScore *
            0.45
      ),

    actionable:
      safeScore >=
      config.actionableFailureScore,

    candidateRejecting:
      safeScore >=
      config.candidateRejectingScore,

    message,

    suggestedAction:
      action,

    positivePoints,

    negativePoints,
  };
}

function appendFailureV3(
  failures:
    PromptFailureV3[],
  failure:
    PromptFailureV3 | null
):
  void {
  if (
    failure
  ) {
    failures.push(
      failure
    );
  }
}

/* =========================================================
 * Failure analysis
 * ======================================================= */

function createFailuresV3(
  candidate:
    EdgeSamMaskCandidate,
  measurements:
    MaskMeasurementsV3,
  previous:
    PreviousMaskComparisonV3 | null,
  imageGuidance: {
    boundaryAgreement:
      number;

    backgroundLeakRatio:
      number;

    shadowLeakRatio:
      number;

    negativePoints:
      readonly PromptFailureEvidencePointV3[];
  },
  config:
    PromptFailureAnalyzerConfigV3
):
  readonly PromptFailureV3[] {
  const failures:
    PromptFailureV3[] =
      [];

  const positivePoints =
    createPositivePointsV3(
      measurements,
      config.maximumSuggestedPoints
    );

  const collapsedScore =
    Math.max(
      scoreBelowV3(
        measurements
          .foregroundRatio,
        config
          .collapsedForegroundRatio,
        0
      ),
      previous?.collapsed
        ? 0.90
        : 0
    );

  appendFailureV3(
    failures,
    createFailureV3(
      'collapsed-foreground',
      collapsedScore,
      'The foreground mask is empty or has collapsed.',
      'replace-prompt',
      config,
      positivePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'undersized-mask',
      scoreBelowV3(
        measurements
          .foregroundRatio,
        config
          .minimumForegroundRatio,
        config
          .collapsedForegroundRatio
      ),
      'The selected foreground is smaller than expected.',
      'expand-box',
      config,
      positivePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'oversized-mask',
      Math.max(
        scoreAboveV3(
          measurements
            .foregroundRatio,
          config
            .maximumForegroundRatio,
          1
        ),
        previous?.expanded
          ? 0.80
          : 0
      ),
      'The mask covers too much of the image.',
      'shrink-box',
      config,
      [],
      imageGuidance
        .negativePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'fragmentation',
      Math.max(
        scoreBelowV3(
          measurements
            .largestComponentRatio,
          config
            .minimumLargestComponentRatio,
          0.30
        ),
        scoreAboveV3(
          measurements
            .significantComponents
            .length,
          config
            .maximumSignificantComponentCount,
          Math.max(
            config
              .maximumSignificantComponentCount +
              4,
            6
          )
        )
      ),
      'The foreground is split into multiple significant components.',
      'add-multiple-positive-points',
      config,
      positivePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'detached-region',
      Math.max(
        scoreAboveV3(
          measurements
            .detachedPixelRatio,
          config
            .maximumDetachedPixelRatio,
          0.50
        ),
        scoreAboveV3(
          measurements
            .secondLargestComponentRatio,
          config
            .maximumSecondComponentRatio,
          0.50
        )
      ),
      'A detached foreground region may belong to the background.',
      'add-multiple-negative-points',
      config,
      [],
      imageGuidance
        .negativePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'internal-holes',
      scoreAboveV3(
        measurements
          .holeRatio,
        config
          .maximumHoleRatio,
        0.45
      ),
      'The mask contains excessive internal holes.',
      'add-positive-point',
      config,
      positivePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'excessive-edge-contact',
      Math.max(
        scoreAboveV3(
          measurements
            .edgeContactRatio,
          config
            .maximumEdgeContactRatio,
          0.35
        ),
        scoreAboveV3(
          measurements
            .touchedEdgeCount,
          config
            .maximumTouchedEdgeCount,
          4
        )
      ),
      'The foreground touches too many image edges.',
      'recenter-box',
      config
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'off-center-subject',
      scoreAboveV3(
        measurements
          .centerOffsetRatio,
        config
          .maximumCenterOffsetRatio,
        0.80
      ),
      'The detected subject is significantly off-center.',
      'recenter-box',
      config
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'low-model-confidence',
      Math.max(
        scoreBelowV3(
          candidate.predictedIou,
          config
            .minimumPredictedIou,
          0
        ),
        scoreBelowV3(
          candidate
            .scores
            .finalScore,
          config
            .minimumCandidateScore,
          0
        )
      ),
      'The decoder confidence for this candidate is low.',
      'replace-prompt',
      config
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'low-mask-stability',
      scoreBelowV3(
        candidate.stabilityScore,
        config
          .minimumStabilityScore,
        0
      ),
      'The candidate mask is unstable around the threshold.',
      'use-previous-mask',
      config
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'boundary-instability',
      scoreBelowV3(
        imageGuidance
          .boundaryAgreement,
        config
          .minimumBoundaryAgreement,
        0
      ),
      'The mask boundary does not align well with image edges.',
      'protect-boundary',
      config,
      positivePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'background-leak',
      scoreAboveV3(
        imageGuidance
          .backgroundLeakRatio,
        config
          .maximumBackgroundLeakRatio,
        0.45
      ),
      'Background pixels appear to be included inside the mask.',
      'add-multiple-negative-points',
      config,
      [],
      imageGuidance
        .negativePoints
    )
  );

  appendFailureV3(
    failures,
    createFailureV3(
      'shadow-leak',
      scoreAboveV3(
        imageGuidance
          .shadowLeakRatio,
        config
          .maximumShadowLeakRatio,
        0.40
      ),
      'A cast shadow may be included in the foreground mask.',
      'add-multiple-negative-points',
      config,
      [],
      imageGuidance
        .negativePoints
    )
  );

  if (
    candidate.validity ===
    'invalid'
  ) {
    appendFailureV3(
      failures,
      createFailureV3(
        'invalid-candidate',
        1,
        'The selected mask candidate was marked invalid.',
        'reject-candidate',
        config
      )
    );
  }

  failures.sort(
    (
      first,
      second
    ) =>
      second.score -
      first.score
  );

  return failures;
}

/* =========================================================
 * Flags
 * ======================================================= */

function hasFailureCategoryV3(
  failures:
    readonly PromptFailureV3[],
  category:
    PromptFailureCategoryV3
):
  boolean {
  return failures.some(
    failure =>
      failure.category ===
      category
  );
}

function createFlagsV3(
  failures:
    readonly PromptFailureV3[]
):
  PromptFailureFlagsV3 {
  return {
    hasFailure:
      failures.length >
      0,

    invalidCandidate:
      hasFailureCategoryV3(
        failures,
        'invalid-candidate'
      ),

    foregroundCollapsed:
      hasFailureCategoryV3(
        failures,
        'collapsed-foreground'
      ),

    undersizedMask:
      hasFailureCategoryV3(
        failures,
        'undersized-mask'
      ),

    oversizedMask:
      hasFailureCategoryV3(
        failures,
        'oversized-mask'
      ),

    fragmentedMask:
      hasFailureCategoryV3(
        failures,
        'fragmentation'
      ),

    detachedRegionDetected:
      hasFailureCategoryV3(
        failures,
        'detached-region'
      ),

    holesDetected:
      hasFailureCategoryV3(
        failures,
        'internal-holes'
      ),

    excessiveEdgeContact:
      hasFailureCategoryV3(
        failures,
        'excessive-edge-contact'
      ),

    offCenterSubject:
      hasFailureCategoryV3(
        failures,
        'off-center-subject'
      ),

    lowModelConfidence:
      hasFailureCategoryV3(
        failures,
        'low-model-confidence'
      ),

    lowMaskStability:
      hasFailureCategoryV3(
        failures,
        'low-mask-stability'
      ),

    backgroundLeakDetected:
      hasFailureCategoryV3(
        failures,
        'background-leak'
      ),

    shadowLeakDetected:
      hasFailureCategoryV3(
        failures,
        'shadow-leak'
      ),

    foregroundLossDetected:
      hasFailureCategoryV3(
        failures,
        'foreground-loss'
      ),

    thinStructureLost:
      hasFailureCategoryV3(
        failures,
        'thin-structure-loss'
      ),

    unstableBoundary:
      hasFailureCategoryV3(
        failures,
        'boundary-instability'
      ),
  };
}

/* =========================================================
 * Penalties and quality
 * ======================================================= */

function getFailureScoreV3(
  failures:
    readonly PromptFailureV3[],
  categories:
    readonly PromptFailureCategoryV3[]
):
  number {
  let maximum =
    0;

  for (
    const failure of
    failures
  ) {
    if (
      categories.includes(
        failure.category
      )
    ) {
      maximum =
        Math.max(
          maximum,
          failure.score
        );
    }
  }

  return clampUnitValue(
    maximum
  );
}

function createPenaltiesV3(
  failures:
    readonly PromptFailureV3[]
):
  PromptFailurePenaltiesV3 {
  const collapsePenalty =
    getFailureScoreV3(
      failures,
      [
        'collapsed-foreground',
      ]
    );

  const sizePenalty =
    getFailureScoreV3(
      failures,
      [
        'undersized-mask',
        'oversized-mask',
      ]
    );

  const fragmentationPenalty =
    getFailureScoreV3(
      failures,
      [
        'fragmentation',
        'detached-region',
      ]
    );

  const holePenalty =
    getFailureScoreV3(
      failures,
      [
        'internal-holes',
      ]
    );

  const edgePenalty =
    getFailureScoreV3(
      failures,
      [
        'excessive-edge-contact',
      ]
    );

  const centeringPenalty =
    getFailureScoreV3(
      failures,
      [
        'off-center-subject',
      ]
    );

  const confidencePenalty =
    getFailureScoreV3(
      failures,
      [
        'low-model-confidence',
      ]
    );

  const stabilityPenalty =
    getFailureScoreV3(
      failures,
      [
        'low-mask-stability',
      ]
    );

  const validityPenalty =
    getFailureScoreV3(
      failures,
      [
        'invalid-candidate',
      ]
    );

  const backgroundPenalty =
    getFailureScoreV3(
      failures,
      [
        'background-leak',
      ]
    );

  const shadowPenalty =
    getFailureScoreV3(
      failures,
      [
        'shadow-leak',
      ]
    );

  const boundaryPenalty =
    getFailureScoreV3(
      failures,
      [
        'boundary-instability',
        'foreground-loss',
        'thin-structure-loss',
      ]
    );

  const values = [
    collapsePenalty,
    sizePenalty,
    fragmentationPenalty,
    holePenalty,
    edgePenalty,
    centeringPenalty,
    confidencePenalty,
    stabilityPenalty,
    validityPenalty,
    backgroundPenalty,
    shadowPenalty,
    boundaryPenalty,
  ];

  const totalPenalty =
    clampUnitValue(
      safeDivideV3(
        values.reduce(
          (
            total,
            value
          ) =>
            total +
            value,
          0
        ),
        values.length,
        0
      )
    );

  return {
    collapsePenalty,
    sizePenalty,
    fragmentationPenalty,
    holePenalty,
    edgePenalty,
    centeringPenalty,
    confidencePenalty,
    stabilityPenalty,
    validityPenalty,
    backgroundPenalty,
    shadowPenalty,
    boundaryPenalty,
    totalPenalty,
  };
}

function createQualityScoresV3(
  candidate:
    EdgeSamMaskCandidate,
  measurements:
    MaskMeasurementsV3,
  imageGuidance: {
    boundaryAgreement:
      number;

    backgroundLeakRatio:
      number;

    shadowLeakRatio:
      number;
  },
  penalties:
    PromptFailurePenaltiesV3
):
  PromptFailureQualityScoresV3 {
  const geometryScore =
    clampUnitValue(
      (
        measurements
          .largestComponentRatio +
        (
          1 -
          Math.min(
            1,
            Math.abs(
              measurements
                .foregroundRatio -
              0.45
            ) /
              0.45
          )
        ) +
        (
          1 -
          measurements
            .centerOffsetRatio
        )
      ) /
        3
    );

  const isolationScore =
    clampUnitValue(
      1 -
      Math.max(
        measurements
          .detachedPixelRatio,
        measurements
          .secondLargestComponentRatio
      )
    );

  const boundaryScore =
    clampUnitValue(
      imageGuidance
        .boundaryAgreement
    );

  const backgroundSeparationScore =
    clampUnitValue(
      1 -
      Math.max(
        imageGuidance
          .backgroundLeakRatio,
        imageGuidance
          .shadowLeakRatio
      )
    );

  const confidenceScore =
    clampUnitValue(
      (
        candidate.predictedIou +
        candidate
          .scores
          .finalScore
      ) /
        2
    );

  const stabilityScore =
    clampUnitValue(
      candidate.stabilityScore
    );

  const positiveAverage =
    (
      geometryScore +
      isolationScore +
      boundaryScore +
      backgroundSeparationScore +
      confidenceScore +
      stabilityScore
    ) /
    6;

  const overallQualityScore =
    clampUnitValue(
      positiveAverage *
      (
        1 -
        penalties.totalPenalty *
          0.70
      )
    );

  return {
    geometryScore,
    isolationScore,
    boundaryScore,
    backgroundSeparationScore,
    confidenceScore,
    stabilityScore,
    overallQualityScore,
  };
}

/* =========================================================
 * Warnings
 * ======================================================= */

function createWarningsV3(
  candidate:
    EdgeSamMaskCandidate,
  prompt:
    EdgeSamPrompt,
  failures:
    readonly PromptFailureV3[]
):
  readonly string[] {
  const warnings =
    new Set<string>();

  for (
    const warning of
    candidate.warnings
  ) {
    if (
      warning.trim()
    ) {
      warnings.add(
        warning.trim()
      );
    }
  }

  for (
    const reason of
    candidate.rejectionReasons
  ) {
    if (
      reason.trim()
    ) {
      warnings.add(
        reason.trim()
      );
    }
  }

  for (
    const warning of
    prompt.warnings
  ) {
    if (
      warning.trim()
    ) {
      warnings.add(
        warning.trim()
      );
    }
  }

  for (
    const failure of
    failures
  ) {
    warnings.add(
      failure.message
    );
  }

  return [
    ...warnings,
  ];
}

/* =========================================================
 * Disabled result
 * ======================================================= */

function createDisabledResultV3(
  request:
    PromptFailureAnalysisRequestV3,
  requestId:
    string,
  startedAt:
    number
):
  PromptFailureAnalysisResultV3 {
  const candidate =
    request.candidate;

  const statistics =
    candidate.statistics;

  const warnings = [
    ...candidate.warnings,
    ...candidate.rejectionReasons,
    ...request.prompt.warnings,
    'Prompt failure analysis is disabled.',
  ];

  return {
    requestId,

    iterationIndex:
      Math.max(
        0,
        Math.floor(
          request.iterationIndex ??
            0
        )
      ),

    candidate,

    prompt:
      request.prompt,

    failures:
      [],

    dominantFailure:
      null,

    flags: {
      hasFailure:
        false,

      invalidCandidate:
        false,

      foregroundCollapsed:
        false,

      undersizedMask:
        false,

      oversizedMask:
        false,

      fragmentedMask:
        false,

      detachedRegionDetected:
        false,

      holesDetected:
        false,

      excessiveEdgeContact:
        false,

      offCenterSubject:
        false,

      lowModelConfidence:
        false,

      lowMaskStability:
        false,

      backgroundLeakDetected:
        false,

      shadowLeakDetected:
        false,

      foregroundLossDetected:
        false,

      thinStructureLost:
        false,

      unstableBoundary:
        false,
    },

    penalties: {
      collapsePenalty:
        0,

      sizePenalty:
        0,

      fragmentationPenalty:
        0,

      holePenalty:
        0,

      edgePenalty:
        0,

      centeringPenalty:
        0,

      confidencePenalty:
        0,

      stabilityPenalty:
        0,

      validityPenalty:
        0,

      backgroundPenalty:
        0,

      shadowPenalty:
        0,

      boundaryPenalty:
        0,

      totalPenalty:
        0,
    },

    qualityScores: {
      geometryScore:
        candidate
          .scores
          .centeringScore,

      isolationScore:
        candidate
          .scores
          .isolationScore,

      boundaryScore:
        1,

      backgroundSeparationScore:
        1,

      confidenceScore:
        candidate.predictedIou,

      stabilityScore:
        candidate.stabilityScore,

      overallQualityScore:
        candidate
          .scores
          .finalScore,
    },

    diagnostics: {
      maskWidth:
        candidate
          .normalizedMask
          .width,

      maskHeight:
        candidate
          .normalizedMask
          .height,

      foregroundPixels:
        statistics
          .foregroundPixels,

      foregroundRatio:
        statistics
          .foregroundRatio,

      componentCount:
        statistics
          .connectedComponentCount,

      significantComponentCount:
        statistics
          .significantComponentCount,

      largestComponentRatio:
        statistics
          .largestComponentRatio,

      secondLargestComponentRatio:
        statistics
          .secondLargestComponentRatio,

      detachedPixelRatio:
        Math.max(
          0,
          1 -
            statistics
              .largestComponentRatio
        ),

      holeRatio:
        statistics
          .holeRatio,

      edgeContactRatio:
        statistics
          .edgeContactRatio,

      touchedEdgeCount:
        statistics
          .touchedEdgeCount,

      centerOffsetRatio:
        statistics
          .centerOffsetRatio,

      boundaryPixelCount:
        0,

      boundaryAgreement:
        1,

      backgroundLeakRatio:
        0,

      shadowLeakRatio:
        0,

      previousMaskIou:
        null,

      previousMaskSizeRatio:
        null,

      bounds:
        statistics.bounds,

      warnings,
    },

    shouldRefine:
      false,

    candidateUsable:
      candidate.validity !==
      'invalid',

    candidateRejected:
      candidate.validity ===
      'invalid',

    recommendedAction:
      'none',

    warnings,

    durationMs:
      Math.max(
        0,
        nowV3() -
          startedAt
      ),
  };
}

/* =========================================================
 * Public API
 * ======================================================= */

/**
 * تحليل فشل Mask Candidate واحدة.
 */
export function analyzePromptFailureV3(
  request:
    PromptFailureAnalysisRequestV3,
  configInput?:
    Partial<
      PromptFailureAnalyzerConfigV3
    >
):
  PromptFailureAnalysisResultV3 {
  const startedAt =
    nowV3();

  const requestId =
    request?.requestId?.trim() ||
    createSegmentationRequestId();

  try {
    validateRequestV3(
      request
    );

    const config =
      normalizeConfigV3(
        configInput
      );

    assertNotCancelledV3(
      request.cancellationSignal
    );

    if (
      !config.enabled
    ) {
      return createDisabledResultV3(
        request,
        requestId,
        startedAt
      );
    }

    emitProgressV3(
      requestId,
      startedAt,
      request.onProgress,
      'Analyzing mask candidate failures.',
      {
        candidateIndex:
          request
            .candidate
            .index,

        iterationIndex:
          Math.max(
            0,
            Math.floor(
              request
                .iterationIndex ??
                0
            )
          ),

        imageGuidanceAvailable:
          Boolean(
            request.analysisImage
          ),

        previousMaskAvailable:
          Boolean(
            request.previousMask
          ),
      }
    );

    const candidate =
      request.candidate;

    const measurements =
      measureMaskV3(
        candidate.normalizedMask,
        config,
        request
          .cancellationSignal
      );

    const previous =
      comparePreviousMaskV3(
        measurements.binary,
        request.previousMask,
        config.foregroundThreshold,
        request
          .cancellationSignal
      );

    const imageGuidance =
      analyzeImageGuidanceV3(
        measurements,
        request.analysisImage,
        config,
        request
          .cancellationSignal
      );

    const failures =
      createFailuresV3(
        candidate,
        measurements,
        previous,
        imageGuidance,
        config
      );

    const flags =
      createFlagsV3(
        failures
      );

    const penalties =
      createPenaltiesV3(
        failures
      );

    const qualityScores =
      createQualityScoresV3(
        candidate,
        measurements,
        imageGuidance,
        penalties
      );

    const warnings =
      createWarningsV3(
        candidate,
        request.prompt,
        failures
      );

    const dominantFailure =
      failures[
        0
      ] ??
      null;

    const candidateRejected =
      candidate.validity ===
        'invalid' ||
      failures.some(
        failure =>
          failure
            .candidateRejecting
      );

    const candidateUsable =
      !candidateRejected &&
      qualityScores
        .overallQualityScore >=
        config
          .minimumUsableQualityScore;

    const shouldRefine =
      !candidateRejected &&
      failures.some(
        failure =>
          failure.actionable
      );

    assertNotCancelledV3(
      request.cancellationSignal
    );

    emitProgressV3(
      requestId,
      startedAt,
      request.onProgress,
      'Mask candidate failure analysis completed.',
      {
        failureCount:
          failures.length,

        candidateRejected,

        candidateUsable,

        shouldRefine,

        overallQualityScore:
          qualityScores
            .overallQualityScore,

        dominantFailure:
          dominantFailure
            ?.category ??
          'none',
      }
    );

    return {
      requestId,

      iterationIndex:
        Math.max(
          0,
          Math.floor(
            request
              .iterationIndex ??
              0
          )
        ),

      candidate,

      prompt:
        request.prompt,

      failures,
      dominantFailure,
      flags,
      penalties,
      qualityScores,

      diagnostics: {
        maskWidth:
          measurements
            .binary
            .width,

        maskHeight:
          measurements
            .binary
            .height,

        foregroundPixels:
          measurements
            .binary
            .foregroundPixels,

        foregroundRatio:
          measurements
            .foregroundRatio,

        componentCount:
          measurements
            .components
            .length,

        significantComponentCount:
          measurements
            .significantComponents
            .length,

        largestComponentRatio:
          measurements
            .largestComponentRatio,

        secondLargestComponentRatio:
          measurements
            .secondLargestComponentRatio,

        detachedPixelRatio:
          measurements
            .detachedPixelRatio,

        holeRatio:
          measurements
            .holeRatio,

        edgeContactRatio:
          measurements
            .edgeContactRatio,

        touchedEdgeCount:
          measurements
            .touchedEdgeCount,

        centerOffsetRatio:
          measurements
            .centerOffsetRatio,

        boundaryPixelCount:
          measurements
            .boundaryPixelCount,

        boundaryAgreement:
          imageGuidance
            .boundaryAgreement,

        backgroundLeakRatio:
          imageGuidance
            .backgroundLeakRatio,

        shadowLeakRatio:
          imageGuidance
            .shadowLeakRatio,

        previousMaskIou:
          previous?.iou ??
          null,

        previousMaskSizeRatio:
          previous?.sizeRatio ??
          null,

        bounds:
          measurements.bounds,

        warnings,
      },

      shouldRefine,
      candidateUsable,
      candidateRejected,

      recommendedAction:
        dominantFailure
          ?.suggestedAction ??
        'none',

      warnings,

      durationMs:
        Math.max(
          0,
          nowV3() -
            startedAt
        ),
    };
  } catch (
    error
  ) {
    if (
      isSegmentationError(
        error
      )
    ) {
      throw error;
    }

    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      `Prompt failure analysis failed: ${getUnknownErrorMessage(
        error
      )}`,
      {
        requestId,

        stage:
          'select-best-mask',

        cause:
          error,

        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Public aliases
 * ======================================================= */

export const analyzeMaskPromptFailureV3 =
  analyzePromptFailureV3;

export const runPromptFailureAnalysisV3 =
  analyzePromptFailureV3;

/* =========================================================
 * Dependency adapter
 * ======================================================= */

/**
 * Adapter مناسب للربط مع
 * IterativePromptRefinerV3.
 */
export function createPromptFailureAnalyzerV3(
  config?:
    Partial<
      PromptFailureAnalyzerConfigV3
    >
): {
  analyze(
    request:
      PromptFailureAnalysisRequestV3
  ):
    PromptFailureAnalysisResultV3;
} {
  const resolvedConfig =
    normalizeConfigV3(
      config
    );

  return {
    analyze(
      request:
        PromptFailureAnalysisRequestV3
    ):
      PromptFailureAnalysisResultV3 {
      return analyzePromptFailureV3(
        request,
        resolvedConfig
      );
    },
  };
}

/* =========================================================
 * Result helpers
 * ======================================================= */

export function hasActionablePromptFailureV3(
  result:
    PromptFailureAnalysisResultV3
):
  boolean {
  return result.failures.some(
    failure =>
      failure.actionable
  );
}

export function getPromptFailureScoreV3(
  result:
    PromptFailureAnalysisResultV3
):
  number {
  return (
    result
      .dominantFailure
      ?.score ??
    0
  );
}

export function isPromptFailureResultUsableV3(
  result:
    PromptFailureAnalysisResultV3
):
  boolean {
  return (
    result.candidateUsable &&
    !result.candidateRejected
  );
}