// scan/core/ai/IterativePromptRefinerV3.ts
//
// Part 1/4
//
// Triple N - Iterative Prompt Refiner V3
//
// ---------------------------------------------------------
// الهدف الحقيقي:
//
// EdgeSAM يخرج أول Mask فقط.
//
// هذا الملف لا يحسن الـMask.
//
// بل يحسن الـPrompt نفسه.
//
// أى:
//
// Decoder
// ↓
// Mask
// ↓
// تحليل سبب الفشل
// ↓
// Prompt جديد
// ↓
// Decoder
// ↓
// مقارنة
// ↓
// إعادة المحاولة
//
// حتى الوصول لأفضل نتيجة.
//
// ---------------------------------------------------------
//
// هذا الملف لا يحتوى أى Image Processing.
//
// لا يقوم بـ:
//
// Morphology
// Feather
// Threshold
//
// ولا أى تعديل مباشر للماسك.
//
// مهمته الوحيدة:
//
// تحسين الـPrompt بصورة Iterative.
//
// ---------------------------------------------------------
//
// الملفات المرتبطة:
//
// PromptFailureAnalyzerV3.ts
//
// مسئول عن معرفة:
//
// لماذا فشل الـMask.
//
// ---------------------------------------------------------
//
// AdaptivePromptGeneratorV4.ts
//
// مسئول عن إنشاء Prompt جديد
// بناء على تقرير الفشل.
//
// ---------------------------------------------------------
//
// PostprocessorV2.ts
//
// يستقبل فقط أفضل Mask
// بعد انتهاء جميع المحاولات.
//
// ---------------------------------------------------------

import type {
    EdgeSamDecoderInputs,
    EdgeSamDecoderResult,
    EdgeSamImageEmbedding,
    EdgeSamMaskCandidate,
    EdgeSamPrompt,
    SegmentationCancellationSignal,
    SegmentationFloatMask,
    SegmentationModelConfig,
    SegmentationPipelineStage,
    SegmentationProgressCallback,
    SegmentationProgressEvent
} from './types';

import {
    SegmentationError,
    createSegmentationRequestId,
    getSegmentationProgress,
    getUnknownErrorMessage,
} from './types';

/* =========================================================
 * Iteration state
 * ======================================================= */

export type IterativeRefinementState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/* =========================================================
 * Stop reason
 * ======================================================= */

export type IterativeStopReason =
  | 'maximum-iterations'
  | 'excellent-mask'
  | 'no-improvement'
  | 'decoder-failed'
  | 'cancelled'
  | 'internal-error';

/* =========================================================
 * Improvement reason
 * ======================================================= */

export type IterativeImprovementReason =
  | 'better-boundaries'
  | 'less-background'
  | 'less-shadow'
  | 'better-geometry'
  | 'better-confidence'
  | 'better-image-score'
  | 'overall';

/* =========================================================
 * Iteration score
 * ======================================================= */

export type IterationCompositeScore = {

  geometryScore:
    number;

  boundaryScore:
    number;

  imageGuidanceScore:
    number;

  foregroundScore:
    number;

  backgroundPenalty:
    number;

  shadowPenalty:
    number;

  leakagePenalty:
    number;

  confidenceScore:
    number;

  finalScore:
    number;
};

/* =========================================================
 * Failure summary
 * ======================================================= */

export type IterationFailureSummary = {

  backgroundLeakDetected:
    boolean;

  shadowLeakDetected:
    boolean;

  thinStructureLost:
    boolean;

  foregroundCollapsed:
    boolean;

  unstableBoundary:
    boolean;

  oversizedMask:
    boolean;

  undersizedMask:
    boolean;

  recommendation:
    string;
};

/* =========================================================
 * Prompt modification summary
 * ======================================================= */

export type PromptModificationSummary = {

  positivePointsAdded:
    number;

  positivePointsRemoved:
    number;

  negativePointsAdded:
    number;

  negativePointsRemoved:
    number;

  boundingBoxExpanded:
    boolean;

  previousMaskUsed:
    boolean;

  promptConfidence:
    number;
};

/* =========================================================
 * Single iteration
 * ======================================================= */

export type IterationResult = {

  iteration:
    number;

  prompt:
    EdgeSamPrompt;

  decoderResult:
    EdgeSamDecoderResult;

  selectedCandidate:
    EdgeSamMaskCandidate;

  selectedMask:
    SegmentationFloatMask;

  score:
    IterationCompositeScore;

  failure:
    IterationFailureSummary;

  promptChanges:
    PromptModificationSummary;

  improved:
    boolean;

  improvementReason:
    IterativeImprovementReason;

  durationMs:
    number;
};

/* =========================================================
 * Iteration history
 * ======================================================= */

export type IterationHistory = {

  iterations:
    readonly IterationResult[];

  bestIteration:
    number;

  averageScore:
    number;

  totalDurationMs:
    number;
};

/* =========================================================
 * Configuration
 * ======================================================= */

export type IterativePromptRefinerConfig = {

  enabled:
    boolean;

  maximumIterations:
    number;

  minimumScoreImprovement:
    number;

  excellentScore:
    number;

  stopWhenScoreStable:
    boolean;

  stabilityIterationCount:
    number;

  allowPromptExpansion:
    boolean;

  allowPromptReduction:
    boolean;

  allowBoundingBoxGrowth:
    boolean;

  allowBoundingBoxShrink:
    boolean;

  usePreviousMask:
    boolean;

  preserveBestPrompt:
    boolean;

  preserveBestMask:
    boolean;

  maximumPromptPoints:
    number;

  maximumNegativePoints:
    number;
};

/* =========================================================
 * Runtime context
 * ======================================================= */

type IterativeRuntimeContext = {

  requestId:
    string;

  startedAt:
    number;

  state:
    IterativeRefinementState;

  config:
    IterativePromptRefinerConfig;

  cancellationSignal?:
    SegmentationCancellationSignal;

  onProgress?:
    SegmentationProgressCallback;
};

/* =========================================================
 * Public request
 * ======================================================= */

export type IterativePromptRefinementRequest = {

  imageEmbedding:
    EdgeSamImageEmbedding;

  initialPrompt:
    EdgeSamPrompt;

  firstDecoderResult:
    EdgeSamDecoderResult;

  modelConfig:
    SegmentationModelConfig;

  cancellationSignal?:
    SegmentationCancellationSignal;

  onProgress?:
    SegmentationProgressCallback;

  requestId?:
    string;
};

/* =========================================================
 * Public result
 * ======================================================= */

export type IterativePromptRefinementResult = {

  bestPrompt:
    EdgeSamPrompt;

  bestMask:
    SegmentationFloatMask;

  bestCandidate:
    EdgeSamMaskCandidate;

  history:
    IterationHistory;

  stopReason:
    IterativeStopReason;

  warnings:
    readonly string[];
};

/* =========================================================
 * Default configuration
 * ======================================================= */

export const DEFAULT_ITERATIVE_PROMPT_REFINER_CONFIG:
Readonly<
IterativePromptRefinerConfig
> = {

  enabled:
    true,

  maximumIterations:
    4,

  minimumScoreImprovement:
    0.015,

  excellentScore:
    0.975,

  stopWhenScoreStable:
    true,

  stabilityIterationCount:
    2,

  allowPromptExpansion:
    true,

  allowPromptReduction:
    true,

  allowBoundingBoxGrowth:
    true,

  allowBoundingBoxShrink:
    true,

  usePreviousMask:
    true,

  preserveBestPrompt:
    true,

  preserveBestMask:
    true,

  maximumPromptPoints:
    48,

  maximumNegativePoints:
    32,
};
// scan/core/ai/IterativePromptRefinerV3.ts
// Part 2/4
//
// يكمل مباشرة بعد:
//
// export const DEFAULT_ITERATIVE_PROMPT_REFINER_CONFIG = {
//   ...
// };

/* =========================================================
 * Dependency contracts
 * ======================================================= */

/**
 * الـRefiner لا ينشئ Decoder Inputs بنفسه،
 * ولا يشغّل ONNX Session مباشرة.
 *
 * بدلًا من ذلك يستقبل Dependencies من
 * SegmentationEngine عند الربط النهائي.
 *
 * هذا يمنع:
 *
 * - Circular Imports.
 * - ربط الملف باسم Session API محدد.
 * - تكرار منطق Decoder Input Builder.
 * - تكرار منطق قراءة واختيار Candidates.
 */
export type IterativeDecoderInputBuilder = (
  input: {
    imageEmbedding:
      EdgeSamImageEmbedding;

    prompt:
      EdgeSamPrompt;

    modelConfig:
      SegmentationModelConfig;

    requestId:
      string;

    cancellationSignal?:
      SegmentationCancellationSignal;
  }
) =>
  | Promise<EdgeSamDecoderInputs>
  | EdgeSamDecoderInputs;

export type IterativeDecoderRunner = (
  input: {
    requestId:
      string;

    inputs:
      EdgeSamDecoderInputs;

    modelConfig:
      SegmentationModelConfig;

    cancellationSignal?:
      SegmentationCancellationSignal;

    onProgress?:
      SegmentationProgressCallback;
  }
) => Promise<EdgeSamDecoderResult>;

/* =========================================================
 * Failure analyzer contract
 * ======================================================= */

/**
 * هذا هو العقد الذي سيطبقه لاحقًا:
 *
 * PromptFailureAnalyzerV3.ts
 *
 * الملف الحالي لا يعرف كيف تم اكتشاف الفشل،
 * بل يستقبل تقريرًا موحدًا فقط.
 */
export type IterativeFailureAnalysisInput = {
  iteration:
    number;

  prompt:
    EdgeSamPrompt;

  candidate:
    EdgeSamMaskCandidate;

  mask:
    SegmentationFloatMask;

  previousBestCandidate:
    EdgeSamMaskCandidate | null;

  previousBestMask:
    SegmentationFloatMask | null;

  modelConfig:
    SegmentationModelConfig;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

export type IterativeFailureAnalysisResult = {
  summary:
    IterationFailureSummary;

  /**
   * درجة جودة التحليل من 0 إلى 1.
   */
  confidence:
    number;

  /**
   * مناطق يشتبه أنها Background أو Shadow.
   *
   * الإحداثيات تكون داخل مساحة الماسك.
   */
  suspiciousRegions:
    readonly {
      x:
        number;

      y:
        number;

      width:
        number;

      height:
        number;

      severity:
        number;

      kind:
        | 'background'
        | 'shadow'
        | 'leakage'
        | 'unstable-boundary'
        | 'unknown';
    }[];

  /**
   * نقاط مقترحة لإبقائها Foreground.
   */
  positiveSeedPoints:
    readonly {
      x:
        number;

      y:
        number;

      confidence:
        number;
    }[];

  /**
   * نقاط مقترحة لاستبعادها.
   */
  negativeSeedPoints:
    readonly {
      x:
        number;

      y:
        number;

      confidence:
        number;

      reason:
        | 'background'
        | 'shadow'
        | 'leakage'
        | 'boundary'
        | 'detached-region'
        | 'unknown';
    }[];

  warnings:
    readonly string[];
};

export type IterativeFailureAnalyzer = (
  input:
    IterativeFailureAnalysisInput
) =>
  | Promise<IterativeFailureAnalysisResult>
  | IterativeFailureAnalysisResult;

/* =========================================================
 * Adaptive prompt generator contract
 * ======================================================= */

/**
 * هذا هو العقد الذي سيطبقه لاحقًا:
 *
 * AdaptivePromptGeneratorV4.ts
 */
export type IterativeAdaptivePromptInput = {
  iteration:
    number;

  originalPrompt:
    EdgeSamPrompt;

  currentPrompt:
    EdgeSamPrompt;

  currentCandidate:
    EdgeSamMaskCandidate;

  currentMask:
    SegmentationFloatMask;

  bestPrompt:
    EdgeSamPrompt;

  bestCandidate:
    EdgeSamMaskCandidate;

  bestMask:
    SegmentationFloatMask;

  failureAnalysis:
    IterativeFailureAnalysisResult;

  modelConfig:
    SegmentationModelConfig;

  refinerConfig:
    IterativePromptRefinerConfig;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

export type IterativeAdaptivePromptResult = {
  prompt:
    EdgeSamPrompt;

  changes:
    PromptModificationSummary;

  /**
   * false تعني أن Generator لم يجد
   * تعديلًا آمنًا ومفيدًا للـPrompt.
   */
  changed:
    boolean;

  /**
   * سبب عدم التعديل أو وصف التعديل.
   */
  reason:
    string;

  warnings:
    readonly string[];
};

export type IterativeAdaptivePromptGenerator = (
  input:
    IterativeAdaptivePromptInput
) =>
  | Promise<IterativeAdaptivePromptResult>
  | IterativeAdaptivePromptResult;

/* =========================================================
 * Optional score provider
 * ======================================================= */

/**
 * يسمح بدمج:
 *
 * - Geometry Score.
 * - Image-Guided Score.
 * - Boundary Score.
 * - Shadow Score.
 *
 * من الملفات الموجودة بالفعل داخل المشروع.
 *
 * لو لم يتم تمريره، يستخدم الملف
 * Default Scoring آمنًا مبنيًا على
 * Candidate Scores وStatistics.
 */
export type IterativeScoreProviderInput = {
  iteration:
    number;

  prompt:
    EdgeSamPrompt;

  candidate:
    EdgeSamMaskCandidate;

  mask:
    SegmentationFloatMask;

  failure:
    IterationFailureSummary;

  previousBest:
    IterationResult | null;

  modelConfig:
    SegmentationModelConfig;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

export type IterativeScoreProvider = (
  input:
    IterativeScoreProviderInput
) =>
  | Promise<IterationCompositeScore>
  | IterationCompositeScore;

/* =========================================================
 * Dependencies
 * ======================================================= */

export type IterativePromptRefinerDependencies = {
  buildDecoderInputs:
    IterativeDecoderInputBuilder;

  runDecoder:
    IterativeDecoderRunner;

  analyzeFailure:
    IterativeFailureAnalyzer;

  generateAdaptivePrompt:
    IterativeAdaptivePromptGenerator;

  scoreIteration?:
    IterativeScoreProvider;
};

/* =========================================================
 * Extended execution options
 * ======================================================= */

export type IterativePromptRefinementOptions = {
  config?:
    Partial<IterativePromptRefinerConfig>;

  /**
   * عند true، خطأ إحدى المحاولات
   * لا يلغي النتيجة الأولى الصالحة.
   */
  allowIterationFailureFallback?:
    boolean;
};

/* =========================================================
 * Internal constants
 * ======================================================= */

const MINIMUM_ITERATIONS =
  1;

const MAXIMUM_ITERATIONS =
  8;

const MINIMUM_STABILITY_ITERATIONS =
  1;

const MAXIMUM_STABILITY_ITERATIONS =
  5;

const MINIMUM_PROMPT_POINTS =
  1;

const MAXIMUM_PROMPT_POINTS =
  96;

const MINIMUM_NEGATIVE_POINTS =
  0;

const MAXIMUM_NEGATIVE_POINTS =
  72;

const DEFAULT_ALLOW_ITERATION_FAILURE_FALLBACK =
  true;

const SCORE_EPSILON =
  0.000001;

  /* =========================================================
 * Final acceptance gate thresholds
 * ======================================================= */

/**
 * هذه الحدود لا تختار أفضل نتيجة.
 *
 * الاختيار تم بالفعل داخل الـIterative Loop.
 *
 * دورها منع أفضل نتيجة سيئة من الخروج
 * كنتيجة ناجحة للمستخدم.
 */
const FINAL_ACCEPTANCE_MINIMUM_SCORE =
  0.70;

const FINAL_ACCEPTANCE_MINIMUM_BOUNDARY_SCORE =
  0.64;

const FINAL_ACCEPTANCE_MINIMUM_GEOMETRY_SCORE =
  0.58;

const FINAL_ACCEPTANCE_MINIMUM_CONFIDENCE_SCORE =
  0.62;

const FINAL_ACCEPTANCE_MAXIMUM_LEAKAGE_PENALTY =
  0.20;

const FINAL_ACCEPTANCE_MAXIMUM_BACKGROUND_PENALTY =
  0.18;

const FINAL_ACCEPTANCE_MAXIMUM_SHADOW_PENALTY =
  0.16;

/* =========================================================
 * Internal helpers
 * ======================================================= */

function clampNumber(
  value:
    number,
  minimum:
    number,
  maximum:
    number,
  fallback:
    number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  if (
    value < minimum
  ) {
    return minimum;
  }

  if (
    value > maximum
  ) {
    return maximum;
  }

  return value;
}

function clampUnit(
  value:
    number,
  fallback = 0
): number {
  return clampNumber(
    value,
    0,
    1,
    fallback
  );
}

function clampInteger(
  value:
    number,
  minimum:
    number,
  maximum:
    number,
  fallback:
    number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      Math.round(value)
    )
  );
}

function assertNotCancelled(
  signal?:
    SegmentationCancellationSignal
): void {
  signal?.throwIfCancelled();
}

function isCancellationError(
  error:
    unknown
): boolean {
  return (
    error instanceof SegmentationError &&
    (
      error.code ===
        'REQUEST_CANCELLED' ||
      error.code ===
        'CANCELLED'
    )
  );
}

function countPromptPoints(
  prompt:
    EdgeSamPrompt,
  label:
    0 | 1
): number {
  let count =
    0;

  for (
    const point of prompt.points
  ) {
    if (
      point.label === label
    ) {
      count +=
        1;
    }
  }

  return count;
}

function validateMask(
  mask:
    SegmentationFloatMask,
  label:
    string
): void {
  if (
    !Number.isInteger(
      mask.width
    ) ||
    !Number.isInteger(
      mask.height
    ) ||
    mask.width <= 0 ||
    mask.height <= 0 ||
    !(
      mask.data instanceof
        Float32Array
    ) ||
    mask.data.length !==
      mask.width *
        mask.height
  ) {
    throw new SegmentationError(
      'MASK_INVALID',
      `${label} is not a valid segmentation float mask.`,
      {
        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          width:
            mask.width,

          height:
            mask.height,

          dataLength:
            mask.data?.length ??
            0,
        },
      }
    );
  }
}

function validatePrompt(
  prompt:
    EdgeSamPrompt,
  label:
    string
): void {
  if (
    typeof prompt !==
      'object' ||
    prompt === null
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      `${label} is missing.`,
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !Array.isArray(
      prompt.points
    )
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      `${label} points must be an array.`,
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !Number.isFinite(
      prompt.sourceSize.width
    ) ||
    !Number.isFinite(
      prompt.sourceSize.height
    ) ||
    prompt.sourceSize.width <= 0 ||
    prompt.sourceSize.height <= 0
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      `${label} contains an invalid source size.`,
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  for (
    let index = 0;
    index <
      prompt.points.length;
    index += 1
  ) {
    const point =
      prompt.points[index];

    if (
      !Number.isFinite(
        point.x
      ) ||
      !Number.isFinite(
        point.y
      ) ||
      (
        point.label !== 0 &&
        point.label !== 1
      )
    ) {
      throw new SegmentationError(
        'PROMPT_INVALID',
        `${label} contains an invalid point.`,
        {
          stage:
            'create-segmentation-prompt',

          retryable:
            false,

          metadata: {
            pointIndex:
              index,

            x:
              Number.isFinite(
                point.x
              )
                ? point.x
                : null,

            y:
              Number.isFinite(
                point.y
              )
                ? point.y
                : null,

            label:
              point.label,
          },
        }
      );
    }
  }
}

function validateCandidate(
  candidate:
    EdgeSamMaskCandidate,
  label:
    string
): void {
  if (
    typeof candidate !==
      'object' ||
    candidate === null
  ) {
    throw new SegmentationError(
      'NO_MASK_CANDIDATES',
      `${label} is missing.`,
      {
        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }

  validateMask(
    candidate.normalizedMask,
    `${label}.normalizedMask`
  );

  validateMask(
    candidate.thresholdedMask,
    `${label}.thresholdedMask`
  );
}

function validateDecoderResult(
  result:
    EdgeSamDecoderResult,
  label:
    string
): void {
  if (
    typeof result !==
      'object' ||
    result === null
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      `${label} is missing.`,
      {
        stage:
          'read-mask-candidates',

        component:
          'decoder',

        retryable:
          false,
      }
    );
  }

  const selectedCandidate =
    result.selection
      ?.selectedCandidate;

  validateCandidate(
    selectedCandidate,
    `${label}.selectedCandidate`
  );
}

function validateDependencies(
  dependencies:
    IterativePromptRefinerDependencies
): void {
  if (
    !dependencies ||
    typeof dependencies !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Iterative prompt refiner dependencies are missing.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    typeof dependencies
      .buildDecoderInputs !==
      'function'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The iterative decoder input builder is missing.',
      {
        stage:
          'create-decoder-inputs',

        retryable:
          false,
      }
    );
  }

  if (
    typeof dependencies
      .runDecoder !==
      'function'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The iterative decoder runner is missing.',
      {
        stage:
          'run-mask-decoder',

        retryable:
          false,
      }
    );
  }

  if (
    typeof dependencies
      .analyzeFailure !==
      'function'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The iterative failure analyzer is missing.',
      {
        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }

  if (
    typeof dependencies
      .generateAdaptivePrompt !==
      'function'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The adaptive prompt generator is missing.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    dependencies.scoreIteration !==
      undefined &&
    typeof dependencies
      .scoreIteration !==
      'function'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The iterative score provider must be a function.',
      {
        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Configuration normalization
 * ======================================================= */

function normalizeConfig(
  input?:
    Partial<IterativePromptRefinerConfig>
): IterativePromptRefinerConfig {
  const defaults =
    DEFAULT_ITERATIVE_PROMPT_REFINER_CONFIG;

  const maximumPromptPoints =
    clampInteger(
      input?.maximumPromptPoints ??
        defaults.maximumPromptPoints,
      MINIMUM_PROMPT_POINTS,
      MAXIMUM_PROMPT_POINTS,
      defaults.maximumPromptPoints
    );

  const maximumNegativePoints =
    clampInteger(
      input?.maximumNegativePoints ??
        defaults.maximumNegativePoints,
      MINIMUM_NEGATIVE_POINTS,
      Math.min(
        maximumPromptPoints,
        MAXIMUM_NEGATIVE_POINTS
      ),
      Math.min(
        defaults.maximumNegativePoints,
        maximumPromptPoints
      )
    );

  return {
    enabled:
      input?.enabled ??
      defaults.enabled,

    maximumIterations:
      clampInteger(
        input?.maximumIterations ??
          defaults.maximumIterations,
        MINIMUM_ITERATIONS,
        MAXIMUM_ITERATIONS,
        defaults.maximumIterations
      ),

    minimumScoreImprovement:
      clampNumber(
        input?.minimumScoreImprovement ??
          defaults.minimumScoreImprovement,
        0,
        0.25,
        defaults.minimumScoreImprovement
      ),

    excellentScore:
      clampUnit(
        input?.excellentScore ??
          defaults.excellentScore,
        defaults.excellentScore
      ),

    stopWhenScoreStable:
      input?.stopWhenScoreStable ??
      defaults.stopWhenScoreStable,

    stabilityIterationCount:
      clampInteger(
        input?.stabilityIterationCount ??
          defaults.stabilityIterationCount,
        MINIMUM_STABILITY_ITERATIONS,
        MAXIMUM_STABILITY_ITERATIONS,
        defaults.stabilityIterationCount
      ),

    allowPromptExpansion:
      input?.allowPromptExpansion ??
      defaults.allowPromptExpansion,

    allowPromptReduction:
      input?.allowPromptReduction ??
      defaults.allowPromptReduction,

    allowBoundingBoxGrowth:
      input?.allowBoundingBoxGrowth ??
      defaults.allowBoundingBoxGrowth,

    allowBoundingBoxShrink:
      input?.allowBoundingBoxShrink ??
      defaults.allowBoundingBoxShrink,

    usePreviousMask:
      input?.usePreviousMask ??
      defaults.usePreviousMask,

    preserveBestPrompt:
      input?.preserveBestPrompt ??
      defaults.preserveBestPrompt,

    preserveBestMask:
      input?.preserveBestMask ??
      defaults.preserveBestMask,

    maximumPromptPoints,

    maximumNegativePoints,
  };
}

/* =========================================================
 * Request validation
 * ======================================================= */

function validateRequest(
  request:
    IterativePromptRefinementRequest
): void {
  if (
    !request ||
    typeof request !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The iterative prompt refinement request is missing.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  const embedding =
    request.imageEmbedding;

  if (
    !embedding ||
    !(
      embedding.data instanceof
        Float32Array
    ) ||
    embedding.data.length <= 0 ||
    !Array.isArray(
      embedding.dimensions
    ) ||
    embedding.dimensions.length ===
      0 ||
    embedding.width <= 0 ||
    embedding.height <= 0
  ) {
    throw new SegmentationError(
      'EMBEDDING_INVALID',
      'The iterative prompt refiner received an invalid image embedding.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,
      }
    );
  }

  validatePrompt(
    request.initialPrompt,
    'initialPrompt'
  );

  validateDecoderResult(
    request.firstDecoderResult,
    'firstDecoderResult'
  );

  if (
    !request.modelConfig ||
    request.modelConfig.family !==
      'edgesam'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The iterative prompt refiner requires a valid EdgeSAM model configuration.',
      {
        stage:
          'validate-input',

        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Progress
 * ======================================================= */

function emitIterativeProgress(
  context:
    IterativeRuntimeContext,
  stage:
    SegmentationPipelineStage,
  message:
    string,
  metadata?: Record<
    string,
    string | number | boolean | null
  >
): void {
  const callback =
    context.onProgress;

  if (!callback) {
    return;
  }

  const stageNumber =
    stage === 'complete'
      ? 19
      : stage ===
          'run-mask-decoder'
        ? 13
        : stage ===
            'create-decoder-inputs'
          ? 12
          : stage ===
              'create-segmentation-prompt'
            ? 11
            : stage ===
                'read-mask-candidates'
              ? 14
              : 15;

  const progress =
    getSegmentationProgress(
      stage
    );

  const event:
    SegmentationProgressEvent = {
    requestId:
      context.requestId,

    stage,

    stageNumber,

    totalStages:
      19,

    progress,

    message,

    elapsedMs:
      Math.max(
        0,
        Date.now() -
          context.startedAt
      ),

    metadata,
  };

  callback(
    event
  );
}

/* =========================================================
 * Default failure values
 * ======================================================= */

function createEmptyFailureSummary():
  IterationFailureSummary {
  return {
    backgroundLeakDetected:
      false,

    shadowLeakDetected:
      false,

    thinStructureLost:
      false,

    foregroundCollapsed:
      false,

    unstableBoundary:
      false,

    oversizedMask:
      false,

    undersizedMask:
      false,

    recommendation:
      'No critical failure was detected.',
  };
}

function createInitialPromptChanges(
  prompt:
    EdgeSamPrompt
): PromptModificationSummary {
  return {
    positivePointsAdded:
      0,

    positivePointsRemoved:
      0,

    negativePointsAdded:
      0,

    negativePointsRemoved:
      0,

    boundingBoxExpanded:
      false,

    previousMaskUsed:
      prompt.previousMask !==
      null,

    promptConfidence:
      calculatePromptConfidence(
        prompt
      ),
  };
}

/* =========================================================
 * Prompt confidence
 * ======================================================= */

function calculatePromptConfidence(
  prompt:
    EdgeSamPrompt
): number {
  let total =
    0;

  let count =
    0;

  for (
    const point of prompt.points
  ) {
    if (
      typeof point.confidence ===
        'number' &&
      Number.isFinite(
        point.confidence
      )
    ) {
      total +=
        clampUnit(
          point.confidence
        );

      count +=
        1;
    }
  }

  if (
    prompt.box &&
    typeof prompt.box.confidence ===
      'number' &&
    Number.isFinite(
      prompt.box.confidence
    )
  ) {
    total +=
      clampUnit(
        prompt.box.confidence
      );

    count +=
      1;
  }

  if (
    count > 0
  ) {
    return clampUnit(
      total / count
    );
  }

  const positiveCount =
    countPromptPoints(
      prompt,
      1
    );

  const negativeCount =
    countPromptPoints(
      prompt,
      0
    );

  let fallback =
    0.35;

  if (
    positiveCount > 0
  ) {
    fallback +=
      Math.min(
        0.25,
        positiveCount *
          0.04
      );
  }

  if (
    negativeCount > 0
  ) {
    fallback +=
      Math.min(
        0.18,
        negativeCount *
          0.015
      );
  }

  if (prompt.box) {
    fallback +=
      0.12;
  }

  if (
    prompt.previousMask
  ) {
    fallback +=
      0.08;
  }

  return clampUnit(
    fallback
  );
}

/* =========================================================
 * Default scoring
 * ======================================================= */

function calculateForegroundBalanceScore(
  ratio:
    number
): number {
  const safeRatio =
    clampUnit(
      ratio
    );

  /**
   * الملابس المصورة منفردة عادةً
   * تشغل مساحة متوسطة وكبيرة من الصورة.
   *
   * لا نرفض القيم خارج هذا النطاق،
   * بل ننقص الدرجة تدريجيًا.
   */
  const idealMinimum =
    0.12;

  const idealMaximum =
    0.78;

  if (
    safeRatio >=
      idealMinimum &&
    safeRatio <=
      idealMaximum
  ) {
    const center =
      (
        idealMinimum +
        idealMaximum
      ) / 2;

    const halfRange =
      (
        idealMaximum -
        idealMinimum
      ) / 2;

    const offset =
      Math.abs(
        safeRatio -
          center
      );

    return clampUnit(
      1 -
        (
          offset /
          Math.max(
            halfRange,
            SCORE_EPSILON
          )
        ) *
          0.25
    );
  }

  if (
    safeRatio <
    idealMinimum
  ) {
    return clampUnit(
      safeRatio /
        idealMinimum
    );
  }

  return clampUnit(
    1 -
      (
        safeRatio -
          idealMaximum
      ) /
        Math.max(
          1 -
            idealMaximum,
          SCORE_EPSILON
        )
  );
}

function calculateDefaultCompositeScore(
  candidate:
    EdgeSamMaskCandidate,
  failure:
    IterationFailureSummary
): IterationCompositeScore {
  const statistics =
    candidate.statistics;

  const candidateScores =
    candidate.scores;

  const predictedIou =
    clampUnit(
      candidate.predictedIou
    );

  const stability =
    clampUnit(
      candidate.stabilityScore
    );

  const candidateFinal =
    clampUnit(
      candidateScores.finalScore
    );

  const largestComponent =
    clampUnit(
      statistics
        .largestComponentRatio
    );

  const isolation =
    clampUnit(
      candidateScores
        .isolationScore
    );

  const centering =
    clampUnit(
      candidateScores
        .centeringScore
    );

  const foregroundScore =
    calculateForegroundBalanceScore(
      statistics.foregroundRatio
    );

  const geometryScore =
    clampUnit(
      largestComponent *
        0.42 +
      isolation *
        0.28 +
      centering *
        0.18 +
      foregroundScore *
        0.12
    );

  const boundaryPenalty =
    clampUnit(
      candidateScores.edgePenalty *
        0.48 +
      candidateScores
        .fragmentationPenalty *
        0.32 +
      candidateScores.holePenalty *
        0.20
    );

  const boundaryScore =
    clampUnit(
      stability *
        0.62 +
      (
        1 -
        boundaryPenalty
      ) *
        0.38
    );

  const confidenceScore =
    clampUnit(
      predictedIou *
        0.52 +
      stability *
        0.28 +
      candidateFinal *
        0.20
    );

  const backgroundPenalty =
    failure
      .backgroundLeakDetected
      ? 0.32
      : failure.oversizedMask
        ? 0.16
        : clampUnit(
            candidateScores
              .edgePenalty *
              0.35
          );

  const shadowPenalty =
    failure
      .shadowLeakDetected
      ? 0.30
      : 0;

  const leakagePenalty =
    clampUnit(
      (
        failure
          .backgroundLeakDetected
          ? 0.42
          : 0
      ) +
      (
        failure
          .shadowLeakDetected
          ? 0.38
          : 0
      ) +
      (
        failure
          .unstableBoundary
          ? 0.12
          : 0
      ) +
      (
        failure
          .oversizedMask
          ? 0.12
          : 0
      ) +
      (
        failure
          .foregroundCollapsed
          ? 0.28
          : 0
      )
    );

  /**
   * Image Guidance الحقيقي سيتم تمريره
   * لاحقًا عبر scoreIteration.
   *
   * هنا نستخدم تقديرًا محافظًا فقط.
   */
  const imageGuidanceScore =
    clampUnit(
      candidateFinal *
        0.44 +
      boundaryScore *
        0.31 +
      geometryScore *
        0.25
    );

  const positiveScore =
    geometryScore *
      0.21 +
    boundaryScore *
      0.23 +
    imageGuidanceScore *
      0.18 +
    foregroundScore *
      0.10 +
    confidenceScore *
      0.28;

  const totalPenalty =
    backgroundPenalty *
      0.16 +
    shadowPenalty *
      0.18 +
    leakagePenalty *
      0.22;

  const finalScore =
    clampUnit(
      positiveScore -
        totalPenalty
    );

  return {
    geometryScore,

    boundaryScore,

    imageGuidanceScore,

    foregroundScore,

    backgroundPenalty,

    shadowPenalty,

    leakagePenalty,

    confidenceScore,

    finalScore,
  };
}

/* =========================================================
 * Score normalization
 * ======================================================= */

function normalizeCompositeScore(
  score:
    IterationCompositeScore
): IterationCompositeScore {
  return {
    geometryScore:
      clampUnit(
        score.geometryScore
      ),

    boundaryScore:
      clampUnit(
        score.boundaryScore
      ),

    imageGuidanceScore:
      clampUnit(
        score.imageGuidanceScore
      ),

    foregroundScore:
      clampUnit(
        score.foregroundScore
      ),

    backgroundPenalty:
      clampUnit(
        score.backgroundPenalty
      ),

    shadowPenalty:
      clampUnit(
        score.shadowPenalty
      ),

    leakagePenalty:
      clampUnit(
        score.leakagePenalty
      ),

    confidenceScore:
      clampUnit(
        score.confidenceScore
      ),

    finalScore:
      clampUnit(
        score.finalScore
      ),
  };
}

/* =========================================================
 * Improvement comparison
 * ======================================================= */

function resolveImprovementReason(
  previous:
    IterationCompositeScore | null,
  current:
    IterationCompositeScore
): IterativeImprovementReason {
  if (!previous) {
    return 'overall';
  }

  const improvements:
    {
      reason:
        IterativeImprovementReason;

      value:
        number;
    }[] = [
      {
        reason:
          'better-boundaries',

        value:
          current.boundaryScore -
          previous.boundaryScore,
      },

      {
        reason:
          'less-background',

        value:
          previous.backgroundPenalty -
          current.backgroundPenalty,
      },

      {
        reason:
          'less-shadow',

        value:
          previous.shadowPenalty -
          current.shadowPenalty,
      },

      {
        reason:
          'better-geometry',

        value:
          current.geometryScore -
          previous.geometryScore,
      },

      {
        reason:
          'better-confidence',

        value:
          current.confidenceScore -
          previous.confidenceScore,
      },

      {
        reason:
          'better-image-score',

        value:
          current.imageGuidanceScore -
          previous.imageGuidanceScore,
      },
    ];

  let bestReason:
    IterativeImprovementReason =
      'overall';

  let bestImprovement =
    SCORE_EPSILON;

  for (
    const improvement of improvements
  ) {
    if (
      improvement.value >
      bestImprovement
    ) {
      bestImprovement =
        improvement.value;

      bestReason =
        improvement.reason;
    }
  }

  return bestReason;
}

/* =========================================================
 * Initial iteration creation
 * ======================================================= */

async function createInitialIteration(
  request:
    IterativePromptRefinementRequest,
  dependencies:
    IterativePromptRefinerDependencies,
  context:
    IterativeRuntimeContext
): Promise<IterationResult> {
  assertNotCancelled(
    context.cancellationSignal
  );

  const startedAt =
    Date.now();

  const candidate =
    request.firstDecoderResult
      .selection
      .selectedCandidate;

  const mask =
    candidate.normalizedMask;

  const analysis =
    await dependencies
      .analyzeFailure({
        iteration:
          0,

        prompt:
          request.initialPrompt,

        candidate,

        mask,

        previousBestCandidate:
          null,

        previousBestMask:
          null,

        modelConfig:
          request.modelConfig,

        cancellationSignal:
          context
            .cancellationSignal,
      });

  assertNotCancelled(
    context.cancellationSignal
  );

  const failure =
    analysis?.summary ??
    createEmptyFailureSummary();

  const score =
    dependencies.scoreIteration
      ? normalizeCompositeScore(
          await dependencies
            .scoreIteration({
              iteration:
                0,

              prompt:
                request.initialPrompt,

              candidate,

              mask,

              failure,

              previousBest:
                null,

              modelConfig:
                request.modelConfig,

              cancellationSignal:
                context
                  .cancellationSignal,
            })
        )
      : calculateDefaultCompositeScore(
          candidate,
          failure
        );

  return {
    iteration:
      0,

    prompt:
      request.initialPrompt,

    decoderResult:
      request.firstDecoderResult,

    selectedCandidate:
      candidate,

    selectedMask:
      mask,

    score,

    failure,

    promptChanges:
      createInitialPromptChanges(
        request.initialPrompt
      ),

    improved:
      true,

    improvementReason:
      'overall',

    durationMs:
      Math.max(
        0,
        Date.now() -
          startedAt
      ),
  };
}

/* =========================================================
 * Single refinement iteration
 * ======================================================= */

async function runSingleIteration(
  input: {
    iteration:
      number;

    request:
      IterativePromptRefinementRequest;

    context:
      IterativeRuntimeContext;

    dependencies:
      IterativePromptRefinerDependencies;

    originalPrompt:
      EdgeSamPrompt;

    current:
      IterationResult;

    best:
      IterationResult;
  }
): Promise<IterationResult | null> {
  const {
    iteration,
    request,
    context,
    dependencies,
    originalPrompt,
    current,
    best,
  } =
    input;

  const startedAt =
    Date.now();

  assertNotCancelled(
    context.cancellationSignal
  );

  emitIterativeProgress(
    context,
    'create-segmentation-prompt',
    `Analyzing EdgeSAM mask iteration ${iteration}.`,
    {
      iterativeRefinement:
        true,

      iteration,

      maximumIterations:
        context.config
          .maximumIterations,

      currentScore:
        current.score.finalScore,

      bestScore:
        best.score.finalScore,
    }
  );

  const failureAnalysis =
    await dependencies
      .analyzeFailure({
        iteration,

        prompt:
          current.prompt,

        candidate:
          current.selectedCandidate,

        mask:
          current.selectedMask,

        previousBestCandidate:
          best.selectedCandidate,

        previousBestMask:
          best.selectedMask,

        modelConfig:
          request.modelConfig,

        cancellationSignal:
          context
            .cancellationSignal,
      });

  assertNotCancelled(
    context.cancellationSignal
  );

  const promptResult =
    await dependencies
      .generateAdaptivePrompt({
        iteration,

        originalPrompt,

        currentPrompt:
          current.prompt,

        currentCandidate:
          current.selectedCandidate,

        currentMask:
          current.selectedMask,

        bestPrompt:
          best.prompt,

        bestCandidate:
          best.selectedCandidate,

        bestMask:
          best.selectedMask,

        failureAnalysis,

        modelConfig:
          request.modelConfig,

        refinerConfig:
          context.config,

        cancellationSignal:
          context
            .cancellationSignal,
      });

  assertNotCancelled(
    context.cancellationSignal
  );

  if (
    !promptResult.changed
  ) {
    return null;
  }

  validatePrompt(
    promptResult.prompt,
    `iteration-${iteration}-prompt`
  );

  if (
    promptResult.prompt.points.length >
    context.config
      .maximumPromptPoints
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'The adaptive prompt exceeded the maximum allowed number of points.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,

        metadata: {
          iteration,

          pointCount:
            promptResult
              .prompt
              .points
              .length,

          maximumPromptPoints:
            context.config
              .maximumPromptPoints,
        },
      }
    );
  }

  const negativePointCount =
    countPromptPoints(
      promptResult.prompt,
      0
    );

  if (
    negativePointCount >
    context.config
      .maximumNegativePoints
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'The adaptive prompt exceeded the maximum allowed number of negative points.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,

        metadata: {
          iteration,

          negativePointCount,

          maximumNegativePoints:
            context.config
              .maximumNegativePoints,
        },
      }
    );
  }

  emitIterativeProgress(
    context,
    'create-decoder-inputs',
    `Building decoder inputs for refinement iteration ${iteration}.`,
    {
      iterativeRefinement:
        true,

      iteration,

      pointCount:
        promptResult
          .prompt
          .points
          .length,

      negativePointCount,

      hasBoundingBox:
        promptResult.prompt.box !==
        null,

      hasPreviousMask:
        promptResult
          .prompt
          .previousMask !==
        null,
    }
  );

  const decoderInputs =
    await dependencies
      .buildDecoderInputs({
        imageEmbedding:
          request.imageEmbedding,

        prompt:
          promptResult.prompt,

        modelConfig:
          request.modelConfig,

        requestId:
          context.requestId,

        cancellationSignal:
          context
            .cancellationSignal,
      });

  assertNotCancelled(
    context.cancellationSignal
  );

  emitIterativeProgress(
    context,
    'run-mask-decoder',
    `Running EdgeSAM decoder refinement iteration ${iteration}.`,
    {
      iterativeRefinement:
        true,

      iteration,
    }
  );

  const decoderResult =
    await dependencies
      .runDecoder({
        requestId:
          context.requestId,

        inputs:
          decoderInputs,

        modelConfig:
          request.modelConfig,

        cancellationSignal:
          context
            .cancellationSignal,

        onProgress:
          context.onProgress,
      });

  assertNotCancelled(
    context.cancellationSignal
  );

  validateDecoderResult(
    decoderResult,
    `iteration-${iteration}-decoderResult`
  );

  const candidate =
    decoderResult.selection
      .selectedCandidate;

  const mask =
    candidate.normalizedMask;

  emitIterativeProgress(
    context,
    'select-best-mask',
    `Scoring EdgeSAM refinement iteration ${iteration}.`,
    {
      iterativeRefinement:
        true,

      iteration,

      selectedCandidateIndex:
        candidate.index,

      predictedIou:
        candidate.predictedIou,

      stabilityScore:
        candidate.stabilityScore,
    }
  );

  const resultFailureAnalysis =
    await dependencies
      .analyzeFailure({
        iteration,

        prompt:
          promptResult.prompt,

        candidate,

        mask,

        previousBestCandidate:
          best.selectedCandidate,

        previousBestMask:
          best.selectedMask,

        modelConfig:
          request.modelConfig,

        cancellationSignal:
          context
            .cancellationSignal,
      });

  assertNotCancelled(
    context.cancellationSignal
  );

  const score =
    dependencies.scoreIteration
      ? normalizeCompositeScore(
          await dependencies
            .scoreIteration({
              iteration,

              prompt:
                promptResult.prompt,

              candidate,

              mask,

              failure:
                resultFailureAnalysis
                  .summary,

              previousBest:
                best,

              modelConfig:
                request.modelConfig,

              cancellationSignal:
                context
                  .cancellationSignal,
            })
        )
      : calculateDefaultCompositeScore(
          candidate,
          resultFailureAnalysis
            .summary
        );

  const improvement =
    score.finalScore -
    best.score.finalScore;

  const improved =
    improvement >=
    context.config
      .minimumScoreImprovement;

  return {
    iteration,

    prompt:
      promptResult.prompt,

    decoderResult,

    selectedCandidate:
      candidate,

    selectedMask:
      mask,

    score,

    failure:
      resultFailureAnalysis
        .summary,

    promptChanges: {
      ...promptResult.changes,

      promptConfidence:
        calculatePromptConfidence(
          promptResult.prompt
        ),
    },

    improved,

    improvementReason:
      resolveImprovementReason(
        best.score,
        score
      ),

    durationMs:
      Math.max(
        0,
        Date.now() -
          startedAt
      ),
  };
}

/**
 * نهاية Part 2/4.
 *
 * Part 3 سيحتوي على:
 *
 * - المقارنة الدقيقة بين النتائج.
 * - حماية النتيجة الأفضل من التراجع.
 * - Stable Score Detection.
 * - Early Stop.
 * - اختيار Best Iteration.
 * - إنشاء History وDiagnostics.
 * - معالجة فشل محاولة منفردة بأمان.
 */
// scan/core/ai/IterativePromptRefinerV3.ts
// Part 3/4
//
// يكمل مباشرة بعد:
//
// async function runSingleIteration(
//   ...
// ): Promise<IterationResult | null> {
//   ...
// }

/* =========================================================
 * Internal loop result
 * ======================================================= */

type IterativeLoopExecutionResult = {
  iterations:
    readonly IterationResult[];

  best:
    IterationResult;

  stopReason:
    IterativeStopReason;

  warnings:
    readonly string[];
};

/* =========================================================
 * Iteration comparison
 * ======================================================= */

/**
 * المقارنة لا تعتمد على finalScore فقط.
 *
 * عند تقارب الدرجات نستخدم:
 *
 * 1) Leakage الأقل.
 * 2) Shadow الأقل.
 * 3) Background الأقل.
 * 4) Boundary الأفضل.
 * 5) Image Guidance الأفضل.
 * 6) Confidence الأفضل.
 * 7) Geometry الأفضل.
 * 8) Candidate validity.
 * 9) Candidate final score.
 *
 * الهدف:
 *
 * منع Mask كبير يحتوي خلفية
 * من الفوز لمجرد أن IoU المتوقع مرتفع.
 */
function compareIterationResults(
  first:
    IterationResult,
  second:
    IterationResult
): number {
  const finalDifference =
    first.score.finalScore -
    second.score.finalScore;

  if (
    Math.abs(
      finalDifference
    ) >
    SCORE_EPSILON
  ) {
    return finalDifference;
  }

  const leakageDifference =
    second.score.leakagePenalty -
    first.score.leakagePenalty;

  if (
    Math.abs(
      leakageDifference
    ) >
    SCORE_EPSILON
  ) {
    return leakageDifference;
  }

  const shadowDifference =
    second.score.shadowPenalty -
    first.score.shadowPenalty;

  if (
    Math.abs(
      shadowDifference
    ) >
    SCORE_EPSILON
  ) {
    return shadowDifference;
  }

  const backgroundDifference =
    second.score.backgroundPenalty -
    first.score.backgroundPenalty;

  if (
    Math.abs(
      backgroundDifference
    ) >
    SCORE_EPSILON
  ) {
    return backgroundDifference;
  }

  const boundaryDifference =
    first.score.boundaryScore -
    second.score.boundaryScore;

  if (
    Math.abs(
      boundaryDifference
    ) >
    SCORE_EPSILON
  ) {
    return boundaryDifference;
  }

  const imageGuidanceDifference =
    first.score.imageGuidanceScore -
    second.score.imageGuidanceScore;

  if (
    Math.abs(
      imageGuidanceDifference
    ) >
    SCORE_EPSILON
  ) {
    return imageGuidanceDifference;
  }

  const confidenceDifference =
    first.score.confidenceScore -
    second.score.confidenceScore;

  if (
    Math.abs(
      confidenceDifference
    ) >
    SCORE_EPSILON
  ) {
    return confidenceDifference;
  }

  const geometryDifference =
    first.score.geometryScore -
    second.score.geometryScore;

  if (
    Math.abs(
      geometryDifference
    ) >
    SCORE_EPSILON
  ) {
    return geometryDifference;
  }

  const firstValidity =
    getCandidateValidityRank(
      first.selectedCandidate
        .validity
    );

  const secondValidity =
    getCandidateValidityRank(
      second.selectedCandidate
        .validity
    );

  const validityDifference =
    firstValidity -
    secondValidity;

  if (
    validityDifference !==
    0
  ) {
    return validityDifference;
  }

  const candidateScoreDifference =
    first.selectedCandidate
      .scores.finalScore -
    second.selectedCandidate
      .scores.finalScore;

  if (
    Math.abs(
      candidateScoreDifference
    ) >
    SCORE_EPSILON
  ) {
    return candidateScoreDifference;
  }

  const predictedIouDifference =
    first.selectedCandidate
      .predictedIou -
    second.selectedCandidate
      .predictedIou;

  if (
    Math.abs(
      predictedIouDifference
    ) >
    SCORE_EPSILON
  ) {
    return predictedIouDifference;
  }

  const stabilityDifference =
    first.selectedCandidate
      .stabilityScore -
    second.selectedCandidate
      .stabilityScore;

  if (
    Math.abs(
      stabilityDifference
    ) >
    SCORE_EPSILON
  ) {
    return stabilityDifference;
  }

  /**
   * عند التطابق الكامل نفضل المحاولة
   * الأقدم لأنها أقل تعقيدًا وأقل عرضة
   * للـPrompt Overfitting.
   */
  return (
    second.iteration -
    first.iteration
  );
}

function getCandidateValidityRank(
  validity:
    EdgeSamMaskCandidate[
      'validity'
    ]
): number {
  switch (validity) {
    case 'valid':
      return 3;

    case 'weak':
      return 2;

    case 'invalid':
    default:
      return 1;
  }
}

function isIterationBetter(
  candidate:
    IterationResult,
  currentBest:
    IterationResult
): boolean {
  return (
    compareIterationResults(
      candidate,
      currentBest
    ) > 0
  );
}

/* =========================================================
 * Material improvement
 * ======================================================= */

/**
 * نتيجة قد تكون أفضل بفارق صغير جدًا،
 * وبالتالي نحفظها كأفضل نتيجة،
 * لكن لا نعتبرها تحسنًا حقيقيًا يمنع
 * Stable Stop.
 */
function getMaterialImprovement(
  candidate:
    IterationResult,
  previousBest:
    IterationResult
): number {
  return (
    candidate.score.finalScore -
    previousBest.score.finalScore
  );
}

function hasMaterialImprovement(
  candidate:
    IterationResult,
  previousBest:
    IterationResult,
  config:
    IterativePromptRefinerConfig
): boolean {
  if (
    !isIterationBetter(
      candidate,
      previousBest
    )
  ) {
    return false;
  }

  const improvement =
    getMaterialImprovement(
      candidate,
      previousBest
    );

  if (
    improvement >=
    config.minimumScoreImprovement
  ) {
    return true;
  }

  /**
   * حتى لو لم يتحسن Final Score بما يكفي،
   * نعتبر انخفاض التسرب أو الظلال تحسنًا
   * ماديًا عندما يكون الفرق واضحًا.
   */
  const leakageReduction =
    previousBest.score
      .leakagePenalty -
    candidate.score
      .leakagePenalty;

  const shadowReduction =
    previousBest.score
      .shadowPenalty -
    candidate.score
      .shadowPenalty;

  const backgroundReduction =
    previousBest.score
      .backgroundPenalty -
    candidate.score
      .backgroundPenalty;

  const boundaryImprovement =
    candidate.score
      .boundaryScore -
    previousBest.score
      .boundaryScore;

  return (
    leakageReduction >=
      0.035 ||
    shadowReduction >=
      0.035 ||
    backgroundReduction >=
      0.035 ||
    boundaryImprovement >=
      0.04
  );
}

/* =========================================================
 * Excellent result detection
 * ======================================================= */

/**
 * لا نوقف التحسين بسبب finalScore فقط.
 *
 * يجب ألا توجد علامات واضحة على:
 *
 * - Shadow leakage.
 * - Background leakage.
 * - Collapse.
 * - Oversized mask.
 * - Unstable boundary.
 */
function isExcellentIteration(
  result:
    IterationResult,
  config:
    IterativePromptRefinerConfig
): boolean {
  if (
    result.score.finalScore <
    config.excellentScore
  ) {
    return false;
  }

  if (
    result.selectedCandidate
      .validity !==
    'valid'
  ) {
    return false;
  }

  if (
    result.failure
      .backgroundLeakDetected ||
    result.failure
      .shadowLeakDetected ||
    result.failure
      .foregroundCollapsed ||
    result.failure
      .oversizedMask ||
    result.failure
      .undersizedMask ||
    result.failure
      .unstableBoundary
  ) {
    return false;
  }

  if (
    result.score
      .leakagePenalty >
      0.08 ||
    result.score
      .backgroundPenalty >
      0.08 ||
    result.score
      .shadowPenalty >
      0.08
  ) {
    return false;
  }

  if (
    result.score
      .boundaryScore <
      0.82 ||
    result.score
      .confidenceScore <
      0.78 ||
    result.score
      .geometryScore <
      0.72
  ) {
    return false;
  }

  return true;
}

/* =========================================================
 * Degenerate result detection
 * ======================================================= */

/**
 * يمنع استبدال النتيجة الصحيحة بنتيجة
 * انهارت بسبب Prompt عدواني.
 */
function isDegenerateIteration(
  result:
    IterationResult
): boolean {
  const candidate =
    result.selectedCandidate;

  const statistics =
    candidate.statistics;

  if (
    result.failure
      .foregroundCollapsed
  ) {
    return true;
  }

  if (
    statistics.foregroundPixels <=
      0 ||
    statistics.foregroundRatio <=
      0.001
  ) {
    return true;
  }

  if (
    statistics.foregroundRatio >=
      0.995
  ) {
    return true;
  }

  if (
    !Number.isFinite(
      result.score.finalScore
    )
  ) {
    return true;
  }

  if (
    candidate.validity ===
      'invalid' &&
    result.score.finalScore <
      0.15
  ) {
    return true;
  }

  return false;
}

/* =========================================================
 * Iteration continuation strategy
 * ======================================================= */

/**
 * المحاولة التالية يمكن أن تبدأ من:
 *
 * - آخر نتيجة، حتى نواصل تصحيح نفس الفشل.
 * - أفضل نتيجة، لو آخر محاولة انهارت.
 *
 * هذا يسمح بالاستكشاف بدون فقدان
 * المسار الجيد.
 */
function chooseNextCurrentIteration(
  latest:
    IterationResult,
  best:
    IterationResult
): IterationResult {
  if (
    isDegenerateIteration(
      latest
    )
  ) {
    return best;
  }

  const latestDifference =
    latest.score.finalScore -
    best.score.finalScore;

  /**
   * لو النتيجة الأخيرة أسوأ جدًا،
   * نرجع لأفضل نقطة معروفة.
   */
  if (
    latestDifference <
    -0.12
  ) {
    return best;
  }

  return latest;
}

/* =========================================================
 * Iteration warnings
 * ======================================================= */

function appendUniqueWarning(
  warnings:
    string[],
  value:
    string | null | undefined
): void {
  const normalized =
    value?.trim();

  if (!normalized) {
    return;
  }

  if (
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

function collectIterationWarnings(
  result:
    IterationResult,
  target:
    string[]
): void {
  for (
    const warning of
      result.prompt.warnings
  ) {
    appendUniqueWarning(
      target,
      warning
    );
  }

  for (
    const warning of
      result.selectedCandidate
        .warnings
  ) {
    appendUniqueWarning(
      target,
      warning
    );
  }

  for (
    const rejectionReason of
      result.selectedCandidate
        .rejectionReasons
  ) {
    appendUniqueWarning(
      target,
      rejectionReason
    );
  }

  for (
    const warning of
      result.decoderResult
        .candidates.warnings
  ) {
    appendUniqueWarning(
      target,
      warning
    );
  }

  for (
    const warning of
      result.decoderResult
        .selection
        .diagnostics
        .warnings
  ) {
    appendUniqueWarning(
      target,
      warning
    );
  }

  if (
    result.failure
      .backgroundLeakDetected
  ) {
    appendUniqueWarning(
      target,
      `Iteration ${result.iteration} detected background leakage.`
    );
  }

  if (
    result.failure
      .shadowLeakDetected
  ) {
    appendUniqueWarning(
      target,
      `Iteration ${result.iteration} detected attached shadow leakage.`
    );
  }

  if (
    result.failure
      .thinStructureLost
  ) {
    appendUniqueWarning(
      target,
      `Iteration ${result.iteration} may have lost a thin garment structure.`
    );
  }

  if (
    result.failure
      .foregroundCollapsed
  ) {
    appendUniqueWarning(
      target,
      `Iteration ${result.iteration} produced a collapsed foreground mask.`
    );
  }

  if (
    result.failure
      .unstableBoundary
  ) {
    appendUniqueWarning(
      target,
      `Iteration ${result.iteration} produced an unstable boundary.`
    );
  }

  if (
    result.failure
      .oversizedMask
  ) {
    appendUniqueWarning(
      target,
      `Iteration ${result.iteration} produced an oversized mask.`
    );
  }

  if (
    result.failure
      .undersizedMask
  ) {
    appendUniqueWarning(
      target,
      `Iteration ${result.iteration} produced an undersized mask.`
    );
  }
}

/* =========================================================
 * History calculations
 * ======================================================= */

function calculateAverageIterationScore(
  iterations:
    readonly IterationResult[]
): number {
  if (
    iterations.length ===
    0
  ) {
    return 0;
  }

  let total =
    0;

  for (
    const iteration of
      iterations
  ) {
    total +=
      iteration.score.finalScore;
  }

  return clampUnit(
    total /
      iterations.length
  );
}

function calculateTotalIterationDuration(
  iterations:
    readonly IterationResult[]
): number {
  let total =
    0;

  for (
    const iteration of
      iterations
  ) {
    if (
      Number.isFinite(
        iteration.durationMs
      ) &&
      iteration.durationMs > 0
    ) {
      total +=
        iteration.durationMs;
    }
  }

  return Math.max(
    0,
    total
  );
}

function createIterationHistory(
  iterations:
    readonly IterationResult[],
  best:
    IterationResult
): IterationHistory {
  return {
    iterations:
      [...iterations],

    bestIteration:
      best.iteration,

    averageScore:
      calculateAverageIterationScore(
        iterations
      ),

    totalDurationMs:
      calculateTotalIterationDuration(
        iterations
      ),
  };
}

/* =========================================================
 * Error normalization
 * ======================================================= */

function createIterationFailureWarning(
  iteration:
    number,
  error:
    unknown
): string {
  return (
    `EdgeSAM refinement iteration ${iteration} failed: ` +
    getUnknownErrorMessage(
      error
    )
  );
}

function normalizeIterationError(
  iteration:
    number,
  requestId:
    string,
  error:
    unknown
): SegmentationError {
  if (
    error instanceof
    SegmentationError
  ) {
    return error;
  }

  return new SegmentationError(
    'INFERENCE_FAILED',
    createIterationFailureWarning(
      iteration,
      error
    ),
    {
      requestId,

      stage:
        'run-mask-decoder',

      component:
        'decoder',

      retryable:
        true,

      attempt:
        iteration,

      cause:
        error,

      metadata: {
        iterativeRefinement:
          true,

        iteration,
      },
    }
  );
}

/* =========================================================
 * Runtime context creation
 * ======================================================= */

function createRuntimeContext(
  request:
    IterativePromptRefinementRequest,
  config:
    IterativePromptRefinerConfig
): IterativeRuntimeContext {
  return {
    requestId:
      request.requestId ??
      createSegmentationRequestId(),

    startedAt:
      Date.now(),

    state:
      'idle',

    config,

    cancellationSignal:
      request.cancellationSignal,

    onProgress:
      request.onProgress,
  };
}

/* =========================================================
 * Iterative execution loop
 * ======================================================= */

/**
 * هذا هو قلب IterativePromptRefinerV3.
 *
 * الترتيب:
 *
 * 1) تقييم النتيجة الأولى.
 * 2) فحص هل النتيجة ممتازة.
 * 3) تحليل الفشل.
 * 4) إنشاء Prompt جديد.
 * 5) تشغيل Decoder.
 * 6) تقييم النتيجة الجديدة.
 * 7) حفظ الأفضل.
 * 8) التوقف عند الاستقرار أو الحد الأقصى.
 */
async function executeIterativeRefinementLoop(
  request:
    IterativePromptRefinementRequest,
  dependencies:
    IterativePromptRefinerDependencies,
  context:
    IterativeRuntimeContext,
  allowIterationFailureFallback:
    boolean
): Promise<IterativeLoopExecutionResult> {
  assertNotCancelled(
    context.cancellationSignal
  );

  context.state =
    'running';

  const iterations:
    IterationResult[] = [];

  const warnings:
    string[] = [];

  emitIterativeProgress(
    context,
    'select-best-mask',
    'Evaluating the initial EdgeSAM mask before iterative refinement.',
    {
      iterativeRefinement:
        true,

      maximumIterations:
        context.config
          .maximumIterations,
    }
  );

  const initialIteration =
    await createInitialIteration(
      request,
      dependencies,
      context
    );

  assertNotCancelled(
    context.cancellationSignal
  );

  iterations.push(
    initialIteration
  );

  collectIterationWarnings(
    initialIteration,
    warnings
  );

  let best =
    initialIteration;

  let current =
    initialIteration;

  let stableIterationCount =
    0;

  let stopReason:
    IterativeStopReason =
      'maximum-iterations';

  emitIterativeProgress(
    context,
    'select-best-mask',
    'Initial EdgeSAM mask evaluation completed.',
    {
      iterativeRefinement:
        true,

      iteration:
        initialIteration
          .iteration,

      initialScore:
        initialIteration
          .score.finalScore,

      validity:
        initialIteration
          .selectedCandidate
          .validity,

      backgroundLeakDetected:
        initialIteration
          .failure
          .backgroundLeakDetected,

      shadowLeakDetected:
        initialIteration
          .failure
          .shadowLeakDetected,
    }
  );

  if (
    isExcellentIteration(
      initialIteration,
      context.config
    )
  ) {
    stopReason =
      'excellent-mask';

    context.state =
      'completed';

    return {
      iterations,

      best,

      stopReason,

      warnings,
    };
  }

  /**
   * maximumIterations يمثل إجمالي
   * النتائج المقيمة بما فيها النتيجة الأولى.
   *
   * مثال:
   *
   * maximumIterations = 4
   *
   * يعني:
   *
   * Initial + 3 Decoder Refinements.
   */
  for (
    let iteration = 1;
    iteration <
      context.config
        .maximumIterations;
    iteration += 1
  ) {
    assertNotCancelled(
      context.cancellationSignal
    );

    let next:
      IterationResult | null;

    try {
      next =
        await runSingleIteration({
          iteration,

          request,

          context,

          dependencies,

          originalPrompt:
            request.initialPrompt,

          current,

          best,
        });
    } catch (error) {
      if (
        isCancellationError(
          error
        ) ||
        context
          .cancellationSignal
          ?.cancelled
      ) {
        context.state =
          'cancelled';

        throw error;
      }

      const normalizedError =
        normalizeIterationError(
          iteration,
          context.requestId,
          error
        );

      if (
        !allowIterationFailureFallback
      ) {
        context.state =
          'failed';

        throw normalizedError;
      }

      appendUniqueWarning(
        warnings,
        createIterationFailureWarning(
          iteration,
          normalizedError
        )
      );

      stopReason =
        'decoder-failed';

      break;
    }

    assertNotCancelled(
      context.cancellationSignal
    );

    /**
     * Generator لم يجد Prompt جديدًا
     * مختلفًا وآمنًا.
     */
    if (!next) {
      stableIterationCount +=
        1;

      appendUniqueWarning(
        warnings,
        `Iterative refinement stopped at iteration ${iteration} because no safe prompt improvement was available.`
      );

      stopReason =
        'no-improvement';

      break;
    }

    iterations.push(
      next
    );

    collectIterationWarnings(
      next,
      warnings
    );

    const previousBest =
      best;

    const candidateIsBetter =
      isIterationBetter(
        next,
        previousBest
      );

    const materialImprovement =
      hasMaterialImprovement(
        next,
        previousBest,
        context.config
      );

    if (
      candidateIsBetter &&
      !isDegenerateIteration(
        next
      )
    ) {
      best =
        next;
    }

    if (
      materialImprovement
    ) {
      stableIterationCount =
        0;
    } else {
      stableIterationCount +=
        1;
    }

    current =
      chooseNextCurrentIteration(
        next,
        best
      );

    emitIterativeProgress(
      context,
      'select-best-mask',
      `EdgeSAM refinement iteration ${iteration} completed.`,
      {
        iterativeRefinement:
          true,

        iteration,

        iterationScore:
          next.score.finalScore,

        bestIteration:
          best.iteration,

        bestScore:
          best.score.finalScore,

        candidateIsBetter,

        materialImprovement,

        stableIterationCount,

        backgroundLeakDetected:
          next.failure
            .backgroundLeakDetected,

        shadowLeakDetected:
          next.failure
            .shadowLeakDetected,

        unstableBoundary:
          next.failure
            .unstableBoundary,

        validity:
          next.selectedCandidate
            .validity,
      }
    );

    if (
      isExcellentIteration(
        best,
        context.config
      )
    ) {
      stopReason =
        'excellent-mask';

      break;
    }

    if (
      context.config
        .stopWhenScoreStable &&
      stableIterationCount >=
        context.config
          .stabilityIterationCount
    ) {
      stopReason =
        'no-improvement';

      break;
    }

    if (
      iteration ===
      context.config
        .maximumIterations -
        1
    ) {
      stopReason =
        'maximum-iterations';
    }
  }

  assertNotCancelled(
    context.cancellationSignal
  );

  context.state =
    'completed';

  return {
    iterations,

    best,

    stopReason,

    warnings,
  };
}

/* =========================================================
 * Result construction
 * ======================================================= */

function createPublicRefinementResult(
  loopResult:
    IterativeLoopExecutionResult
): IterativePromptRefinementResult {
  const {
    iterations,
    best,
    stopReason,
    warnings,
  } =
    loopResult;

  return {
    bestPrompt:
      best.prompt,

    bestMask:
      best.selectedMask,

    bestCandidate:
      best.selectedCandidate,

    history:
      createIterationHistory(
        iterations,
        best
      ),

    stopReason,

    warnings:
      [...warnings],
  };
}

/**
 * نهاية Part 3/4.
 *
 * Part 4 سيحتوي على:
 *
 * - Public API النهائي.
 * - refinePromptIterativelyV3().
 * - Disabled fallback.
 * - Error handling الكامل.
 * - Cancellation handling.
 * - Dependency factory validation.
 * - Safe result fallback.
 * - Diagnostics helpers.
 * - Config cloning.
 */
// scan/core/ai/IterativePromptRefinerV3.ts
// Part 4/4
//
// يكمل مباشرة بعد:
//
// function createPublicRefinementResult(
//   ...
// ): IterativePromptRefinementResult {
//   ...
// }

/* =========================================================
 * Public configuration helpers
 * ======================================================= */

/**
 * إنشاء نسخة مستقلة وآمنة من إعدادات
 * Iterative Prompt Refiner.
 *
 * الهدف:
 *
 * - منع تعديل Default Config بالخطأ.
 * - توحيد Clamp والتحقق.
 * - السماح بتمرير Partial Config.
 */
export function createIterativePromptRefinerConfigV3(
  input?:
    Partial<IterativePromptRefinerConfig>
): IterativePromptRefinerConfig {
  return normalizeConfig(
    input
  );
}

/**
 * Alias واضح عند استخدام الملف
 * داخل SegmentationEngine.
 */
export function resolveIterativePromptRefinerConfigV3(
  input?:
    Partial<IterativePromptRefinerConfig>
): IterativePromptRefinerConfig {
  return createIterativePromptRefinerConfigV3(
    input
  );
}

/* =========================================================
 * Public configuration validation
 * ======================================================= */

export function validateIterativePromptRefinerConfigV3(
  input:
    Partial<IterativePromptRefinerConfig> |
    IterativePromptRefinerConfig
): IterativePromptRefinerConfig {
  if (
    typeof input !==
      'object' ||
    input === null
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Iterative prompt refiner configuration must be an object.',
      {
        stage:
          'validate-input',

        retryable:
          false,
      }
    );
  }

  return normalizeConfig(
    input
  );
}

/* =========================================================
 * Disabled fallback
 * ======================================================= */

/**
 * عند تعطيل Iterative Refinement:
 *
 * - لا نشغّل Decoder مرة أخرى.
 * - لا نستدعي Failure Analyzer.
 * - لا نستدعي Adaptive Prompt Generator.
 * - نعيد النتيجة الأولى كما هي.
 *
 * هذا مهم حتى يمكن تعطيل الخاصية
 * من Config بدون تغيير بنية المحرك.
 */
function createDisabledRefinementResult(
  request:
    IterativePromptRefinementRequest
): IterativePromptRefinementResult {
  const candidate =
    request.firstDecoderResult
      .selection
      .selectedCandidate;

  const failure =
    createEmptyFailureSummary();

  const score =
    calculateDefaultCompositeScore(
      candidate,
      failure
    );

  const initialIteration:
    IterationResult = {
    iteration:
      0,

    prompt:
      request.initialPrompt,

    decoderResult:
      request.firstDecoderResult,

    selectedCandidate:
      candidate,

    selectedMask:
      candidate.normalizedMask,

    score,

    failure,

    promptChanges:
      createInitialPromptChanges(
        request.initialPrompt
      ),

    improved:
      true,

    improvementReason:
      'overall',

    durationMs:
      0,
  };

  return {
    bestPrompt:
      request.initialPrompt,

    bestMask:
      candidate.normalizedMask,

    bestCandidate:
      candidate,

    history: {
      iterations: [
        initialIteration,
      ],

      bestIteration:
        0,

      averageScore:
        score.finalScore,

      totalDurationMs:
        0,
    },

    stopReason:
      'maximum-iterations',

    warnings: [
      'Iterative EdgeSAM prompt refinement is disabled.',
    ],
  };
}

/* =========================================================
 * Public diagnostics types
 * ======================================================= */

export type IterativePromptRefinerIterationDiagnostics = {
  iteration:
    number;

  candidateId:
    string;

  candidateIndex:
    number;

  candidateValidity:
    EdgeSamMaskCandidate[
      'validity'
    ];

  promptMode:
    EdgeSamPrompt[
      'mode'
    ];

  positivePointCount:
    number;

  negativePointCount:
    number;

  usedBoundingBox:
    boolean;

  usedPreviousMask:
    boolean;

  predictedIou:
    number;

  stabilityScore:
    number;

  candidateFinalScore:
    number;

  compositeScore:
    IterationCompositeScore;

  improved:
    boolean;

  improvementReason:
    IterativeImprovementReason;

  backgroundLeakDetected:
    boolean;

  shadowLeakDetected:
    boolean;

  thinStructureLost:
    boolean;

  foregroundCollapsed:
    boolean;

  unstableBoundary:
    boolean;

  oversizedMask:
    boolean;

  undersizedMask:
    boolean;

  durationMs:
    number;
};

export type IterativePromptRefinerDiagnostics = {
  enabled:
    boolean;

  iterationCount:
    number;

  decoderRefinementRunCount:
    number;

  bestIteration:
    number;

  bestScore:
    number;

  averageScore:
    number;

  totalDurationMs:
    number;

  stopReason:
    IterativeStopReason;

  improvedOverInitial:
    boolean;

  initialScore:
    number;

  finalScore:
    number;

  scoreImprovement:
    number;

  initialCandidateId:
    string;

  bestCandidateId:
    string;

  finalPromptMode:
    EdgeSamPrompt[
      'mode'
    ];

  finalPositivePointCount:
    number;

  finalNegativePointCount:
    number;

  finalUsedBoundingBox:
    boolean;

  finalUsedPreviousMask:
    boolean;

  iterations:
    readonly IterativePromptRefinerIterationDiagnostics[];

  warnings:
    readonly string[];
};

/* =========================================================
 * Public diagnostics creation
 * ======================================================= */

function createIterationDiagnostics(
  result:
    IterationResult
): IterativePromptRefinerIterationDiagnostics {
  return {
    iteration:
      result.iteration,

    candidateId:
      result.selectedCandidate.id,

    candidateIndex:
      result.selectedCandidate.index,

    candidateValidity:
      result.selectedCandidate
        .validity,

    promptMode:
      result.prompt.mode,

    positivePointCount:
      countPromptPoints(
        result.prompt,
        1
      ),

    negativePointCount:
      countPromptPoints(
        result.prompt,
        0
      ),

    usedBoundingBox:
      result.prompt.box !==
      null,

    usedPreviousMask:
      result.prompt.previousMask !==
      null,

    predictedIou:
      result.selectedCandidate
        .predictedIou,

    stabilityScore:
      result.selectedCandidate
        .stabilityScore,

    candidateFinalScore:
      result.selectedCandidate
        .scores.finalScore,

    compositeScore: {
      ...result.score,
    },

    improved:
      result.improved,

    improvementReason:
      result.improvementReason,

    backgroundLeakDetected:
      result.failure
        .backgroundLeakDetected,

    shadowLeakDetected:
      result.failure
        .shadowLeakDetected,

    thinStructureLost:
      result.failure
        .thinStructureLost,

    foregroundCollapsed:
      result.failure
        .foregroundCollapsed,

    unstableBoundary:
      result.failure
        .unstableBoundary,

    oversizedMask:
      result.failure
        .oversizedMask,

    undersizedMask:
      result.failure
        .undersizedMask,

    durationMs:
      result.durationMs,
  };
}

/**
 * إنشاء Diagnostics خفيفة لا تحتوي
 * على بيانات الماسكات نفسها.
 *
 * آمنة للتخزين داخل Engine Diagnostics.
 */
export function createIterativePromptRefinerDiagnosticsV3(
  result:
    IterativePromptRefinementResult,
  enabled = true
): IterativePromptRefinerDiagnostics {
  const iterations =
    result.history.iterations;

  if (
    iterations.length ===
    0
  ) {
    throw new SegmentationError(
      'MASK_SELECTION_FAILED',
      'Iterative prompt refinement diagnostics require at least one iteration.',
      {
        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }

  const initial =
    iterations[0];

  const best =
    iterations.find(
      iteration =>
        iteration.iteration ===
        result.history
          .bestIteration
    ) ??
    initial;

  const initialScore =
    clampUnit(
      initial.score.finalScore
    );

  const finalScore =
    clampUnit(
      best.score.finalScore
    );

  const scoreImprovement =
    finalScore -
    initialScore;

  return {
    enabled,

    iterationCount:
      iterations.length,

    decoderRefinementRunCount:
      Math.max(
        0,
        iterations.length - 1
      ),

    bestIteration:
      result.history
        .bestIteration,

    bestScore:
      finalScore,

    averageScore:
      clampUnit(
        result.history
          .averageScore
      ),

    totalDurationMs:
      Math.max(
        0,
        result.history
          .totalDurationMs
      ),

    stopReason:
      result.stopReason,

    improvedOverInitial:
      isIterationBetter(
        best,
        initial
      ),

    initialScore,

    finalScore,

    scoreImprovement,

    initialCandidateId:
      initial.selectedCandidate.id,

    bestCandidateId:
      result.bestCandidate.id,

    finalPromptMode:
      result.bestPrompt.mode,

    finalPositivePointCount:
      countPromptPoints(
        result.bestPrompt,
        1
      ),

    finalNegativePointCount:
      countPromptPoints(
        result.bestPrompt,
        0
      ),

    finalUsedBoundingBox:
      result.bestPrompt.box !==
      null,

    finalUsedPreviousMask:
      result.bestPrompt
        .previousMask !==
      null,

    iterations:
      iterations.map(
        createIterationDiagnostics
      ),

    warnings:
      [...result.warnings],
  };
}

/* =========================================================
 * Result validation
 * ======================================================= */

function validatePublicResult(
  result:
    IterativePromptRefinementResult
): void {
  validatePrompt(
    result.bestPrompt,
    'iterativeResult.bestPrompt'
  );

  validateMask(
    result.bestMask,
    'iterativeResult.bestMask'
  );

  validateCandidate(
    result.bestCandidate,
    'iterativeResult.bestCandidate'
  );

  if (
    !result.history ||
    !Array.isArray(
      result.history.iterations
    ) ||
    result.history.iterations
      .length ===
      0
  ) {
    throw new SegmentationError(
      'MASK_SELECTION_FAILED',
      'Iterative prompt refinement returned an empty iteration history.',
      {
        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }

  const containsBestIteration =
    result.history
      .iterations
      .some(
        iteration =>
          iteration.iteration ===
          result.history
            .bestIteration
      );

  if (
    !containsBestIteration
  ) {
    throw new SegmentationError(
      'MASK_SELECTION_FAILED',
      'Iterative prompt refinement history does not contain the selected best iteration.',
      {
        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          bestIteration:
            result.history
              .bestIteration,

          iterationCount:
            result.history
              .iterations
              .length,
        },
      }
    );
  }

  if (
    result.bestCandidate.id
      .trim()
      .length ===
      0
  ) {
    throw new SegmentationError(
      'MASK_SELECTION_FAILED',
      'Iterative prompt refinement selected a candidate without a valid identifier.',
      {
        stage:
          'select-best-mask',

        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Final result acceptance gate
 * ======================================================= */

/**
 * تمنع تسليم أفضل نتيجة عندما تظل:
 *
 * - محتوية على Background.
 * - محتوية على Shadow.
 * - أكبر من القطعة الحقيقية.
 * - منهارة أو غير مستقرة.
 * - ضعيفة في الحدود أو الهندسة.
 *
 * مهم:
 *
 * هذه الدالة لا تحسن الماسك.
 *
 * التحسين حدث بالفعل داخل:
 *
 * PromptFailureAnalyzerV3
 * AdaptivePromptGeneratorV4
 * IterativePromptRefinerV3
 *
 * هنا نقرر فقط:
 *
 * Accept أو Retry.
 */
function assertAcceptableFinalRefinementResult(
  result:
    IterativePromptRefinementResult,
  requestId:
    string
): void {
  const best =
    result.history
      .iterations
      .find(
        iteration =>
          iteration.iteration ===
          result.history
            .bestIteration
      );

  if (!best) {
    throw new SegmentationError(
      'MASK_SELECTION_FAILED',
      'The selected iterative refinement result could not be found.',
      {
        requestId,

        stage:
          'select-best-mask',

        retryable:
          true,

        metadata: {
          iterativeRefinement:
            true,

          bestIteration:
            result.history
              .bestIteration,
        },
      }
    );
  }

  const candidate =
    best.selectedCandidate;

  const statistics =
    candidate.statistics;

  const score =
    best.score;

  const failure =
    best.failure;

  const rejectionReasons:
    string[] = [];

  /* =====================================================
   * 1. Validate numerical output
   * =================================================== */

  const requiredScores = [
    score.finalScore,
    score.boundaryScore,
    score.geometryScore,
    score.confidenceScore,
    score.leakagePenalty,
    score.backgroundPenalty,
    score.shadowPenalty,
    statistics.foregroundRatio,
  ];

  const containsInvalidNumber =
    requiredScores.some(
      value =>
        !Number.isFinite(
          value
        )
    );

  if (
    containsInvalidNumber
  ) {
    rejectionReasons.push(
      'invalid-numerical-result'
    );
  }

  /* =====================================================
   * 2. Reject genuinely empty or collapsed masks
   * =================================================== */

  const maskIsEffectivelyEmpty =
    statistics.foregroundPixels <=
      0 ||
    statistics.foregroundRatio <=
      0.005;

  const severeForegroundCollapse =
    failure.foregroundCollapsed &&
    statistics.foregroundRatio <
      0.025;

  if (
    maskIsEffectivelyEmpty
  ) {
    rejectionReasons.push(
      'foreground-empty'
    );
  }

  if (
    severeForegroundCollapse
  ) {
    rejectionReasons.push(
      'foreground-severely-collapsed'
    );
  }

  /* =====================================================
   * 3. Reject masks covering almost the whole image
   * =================================================== */

  const maskCoversAlmostEntireImage =
    statistics.foregroundRatio >=
      0.985;

  const severeOversizedMask =
    failure.oversizedMask &&
    statistics.foregroundRatio >=
      0.94;

  if (
    maskCoversAlmostEntireImage
  ) {
    rejectionReasons.push(
      'foreground-covers-entire-image'
    );
  }

  if (
    severeOversizedMask
  ) {
    rejectionReasons.push(
      'foreground-severely-oversized'
    );
  }

  /* =====================================================
   * 4. Reject only severe leakage
   *
   * A boolean detection alone is not enough.
   * The quantitative penalties must also be high.
   * =================================================== */

  const severeBackgroundLeak =
    failure.backgroundLeakDetected &&
    score.backgroundPenalty >
      0.78 &&
    score.leakagePenalty >
      0.78;

  const severeShadowLeak =
    failure.shadowLeakDetected &&
    score.shadowPenalty >
      0.84 &&
    score.leakagePenalty >
      0.72;

  if (
    severeBackgroundLeak
  ) {
    rejectionReasons.push(
      'severe-background-leak'
    );
  }

  if (
    severeShadowLeak
  ) {
    rejectionReasons.push(
      'severe-shadow-leak'
    );
  }

  /* =====================================================
   * 5. Reject only severely unstable boundaries
   * =================================================== */

  const severeBoundaryFailure =
    failure.unstableBoundary &&
    score.boundaryScore <
      0.16 &&
    score.finalScore <
      0.42;

  if (
    severeBoundaryFailure
  ) {
    rejectionReasons.push(
      'severe-boundary-instability'
    );
  }

  /* =====================================================
   * 6. Reject catastrophic fragmentation
   * =================================================== */

  const severeFragmentation =
    statistics.significantComponentCount >
      4 &&
    statistics.largestComponentRatio <
      0.42 &&
    score.finalScore <
      0.42;

  if (
    severeFragmentation
  ) {
    rejectionReasons.push(
      'severe-mask-fragmentation'
    );
  }

  /* =====================================================
   * 7. Candidate validity is not an automatic rejection
   *
   * A weak candidate can still be the best usable mask.
   * Invalid is rejected only when the measured quality
   * is also poor.
   * =================================================== */

  const invalidAndLowQuality =
    candidate.validity ===
      'invalid' &&
    score.finalScore <
      0.38 &&
    score.geometryScore <
      0.32 &&
    score.confidenceScore <
      0.32;

  if (
    invalidAndLowQuality
  ) {
    rejectionReasons.push(
      'invalid-low-quality-candidate'
    );
  }

  /* =====================================================
   * 8. Global catastrophic-quality rejection
   * =================================================== */

  const catastrophicFinalScore =
    score.finalScore <
      0.20;

  const globallyBrokenResult =
    score.finalScore <
      0.30 &&
    score.boundaryScore <
      0.18 &&
    score.geometryScore <
      0.22 &&
    score.confidenceScore <
      0.24;

  if (
    catastrophicFinalScore
  ) {
    rejectionReasons.push(
      'catastrophic-final-score'
    );
  }

  if (
    globallyBrokenResult
  ) {
    rejectionReasons.push(
      'globally-broken-mask'
    );
  }

  /* =====================================================
   * 9. Accept every non-catastrophic best result
   * =================================================== */

  if (
    rejectionReasons.length ===
      0
  ) {
    return;
  }

  throw new SegmentationError(
    'MASK_PROCESSING_FAILED',
    'No usable garment mask was produced after iterative EdgeSAM refinement.',
    {
      requestId,

      stage:
        'select-best-mask',

      component:
        'decoder',

      retryable:
        true,

      metadata: {
        iterativeRefinement:
          true,

        finalAcceptanceRejected:
          true,

        rejectionReasons:
          rejectionReasons.join(
            ','
          ),

        stopReason:
          result.stopReason,

        iterationCount:
          result.history
            .iterations
            .length,

        bestIteration:
          best.iteration,

        candidateId:
          candidate.id,

        candidateValidity:
          candidate.validity,

        finalScore:
          score.finalScore,

        boundaryScore:
          score.boundaryScore,

        geometryScore:
          score.geometryScore,

        confidenceScore:
          score.confidenceScore,

        leakagePenalty:
          score.leakagePenalty,

        backgroundPenalty:
          score.backgroundPenalty,

        shadowPenalty:
          score.shadowPenalty,

        foregroundRatio:
          statistics.foregroundRatio,

        foregroundPixels:
          statistics.foregroundPixels,

        largestComponentRatio:
          statistics
            .largestComponentRatio,

        significantComponentCount:
          statistics
            .significantComponentCount,

        backgroundLeakDetected:
          failure
            .backgroundLeakDetected,

        shadowLeakDetected:
          failure
            .shadowLeakDetected,

        foregroundCollapsed:
          failure
            .foregroundCollapsed,

        oversizedMask:
          failure
            .oversizedMask,

        undersizedMask:
          failure
            .undersizedMask,

        unstableBoundary:
          failure
            .unstableBoundary,
      },
    }
  );
}

/* =========================================================
 * Public error normalization
 * ======================================================= */

function normalizePublicRefinementError(
  context:
    IterativeRuntimeContext,
  error:
    unknown
): SegmentationError {
  if (
    error instanceof
    SegmentationError
  ) {
    return error;
  }

  return new SegmentationError(
    'MASK_PROCESSING_FAILED',
    `Iterative EdgeSAM prompt refinement failed: ${getUnknownErrorMessage(
      error
    )}`,
    {
      requestId:
        context.requestId,

      stage:
        'select-best-mask',

      retryable:
        false,

      cause:
        error,

      metadata: {
        iterativeRefinement:
          true,

        state:
          context.state,
      },
    }
  );
}

/* =========================================================
 * Main public API
 * ======================================================= */

/**
 * تشغيل Iterative Prompt Refinement V3.
 *
 * هذه الدالة:
 *
 * 1) تتحقق من الطلب.
 * 2) تطبع Config آمن.
 * 3) تحافظ على نتيجة Decoder الأولى.
 * 4) تعيد تشغيل Decoder باستخدام Prompts محسنة.
 * 5) تمنع أي نتيجة أسوأ من استبدال الأفضل.
 * 6) تتوقف عند:
 *
 *    - الوصول لنتيجة ممتازة.
 *    - ثبات النتيجة.
 *    - نفاد عدد المحاولات.
 *    - عدم توفر Prompt جديد.
 *    - فشل Decoder مع Safe Fallback.
 *
 * ملاحظة:
 *
 * maximumIterations تشمل النتيجة الأولى.
 *
 * مثال:
 *
 * maximumIterations = 4
 *
 * يعني:
 *
 * - Initial Decoder Result.
 * - Refinement Decoder Run 1.
 * - Refinement Decoder Run 2.
 * - Refinement Decoder Run 3.
 */
export async function refinePromptIterativelyV3(
  request:
    IterativePromptRefinementRequest,
  dependencies:
    IterativePromptRefinerDependencies,
  options:
    IterativePromptRefinementOptions = {}
): Promise<IterativePromptRefinementResult> {
  validateRequest(
    request
  );

  const config =
    normalizeConfig(
      options.config
    );

  const context =
    createRuntimeContext(
      request,
      config
    );

  assertNotCancelled(
    context.cancellationSignal
  );

  /**
   * عند تعطيل الخاصية لا نطلب
   * Dependencies صالحة، لأننا لن
   * نستدعي أيًا منها.
   */
  if (
    !config.enabled ||
    config.maximumIterations <=
      1
  ) {
    context.state =
      'completed';

    const fallbackResult =
      createDisabledRefinementResult(
        request
      );

    validatePublicResult(
      fallbackResult
    );

    return fallbackResult;
  }

  validateDependencies(
    dependencies
  );

  const allowIterationFailureFallback =
    options
      .allowIterationFailureFallback ??
    DEFAULT_ALLOW_ITERATION_FAILURE_FALLBACK;

  try {
    const loopResult =
      await executeIterativeRefinementLoop(
        request,
        dependencies,
        context,
        allowIterationFailureFallback
      );

    assertNotCancelled(
      context.cancellationSignal
    );

    const result =
      createPublicRefinementResult(
        loopResult
      );


validatePublicResult(
  result
);

/**
 * ممنوع تسليم أفضل Mask لمجرد أنه
 * الأفضل بين المحاولات.
 *
 * يجب أن يكون صالحًا فعليًا للعرض.
 */
assertAcceptableFinalRefinementResult(
  result,
  context.requestId
);

emitIterativeProgress(
      context,
      'select-best-mask',
      'Iterative EdgeSAM prompt refinement completed.',
      {
        iterativeRefinement:
          true,

        iterationCount:
          result.history
            .iterations
            .length,

        decoderRefinementRunCount:
          Math.max(
            0,
            result.history
              .iterations
              .length -
              1
          ),

        bestIteration:
          result.history
            .bestIteration,

        bestScore:
          result.bestCandidate
            .scores.finalScore,

        compositeBestScore:
          (
            result.history
              .iterations
              .find(
                iteration =>
                  iteration
                    .iteration ===
                  result.history
                    .bestIteration
              )
              ?.score
              .finalScore
          ) ??
          result.bestCandidate
            .scores.finalScore,

        stopReason:
          result.stopReason,

        selectedCandidateIndex:
          result.bestCandidate
            .index,

        selectedCandidateValidity:
          result.bestCandidate
            .validity,
      }
    );

    context.state =
      'completed';

    return result;
  } catch (error) {
    if (
      isCancellationError(
        error
      ) ||
      context
        .cancellationSignal
        ?.cancelled
    ) {
      context.state =
        'cancelled';

      if (
        error instanceof
        SegmentationError
      ) {
        throw error;
      }

      throw new SegmentationError(
        'REQUEST_CANCELLED',
        context
          .cancellationSignal
          ?.reason ??
        'Iterative EdgeSAM prompt refinement was cancelled.',
        {
          requestId:
            context.requestId,

          stage:
            'select-best-mask',

          retryable:
            false,

          cause:
            error,

          metadata: {
            iterativeRefinement:
              true,
          },
        }
      );
    }

    context.state =
      'failed';

    throw normalizePublicRefinementError(
      context,
      error
    );
  }
}

/* =========================================================
 * Simple public aliases
 * ======================================================= */

/**
 * اسم مختصر مناسب عند الربط داخل
 * SegmentationEngine.
 */
export const runIterativePromptRefinementV3 =
  refinePromptIterativelyV3;

/**
 * Alias آخر لمن يفضل تسمية Refiner.
 */
export const refineEdgeSamPromptV3 =
  refinePromptIterativelyV3;

/* =========================================================
 * Public result helpers
 * ======================================================= */

/**
 * هل Iterative Refiner غيّر النتيجة
 * المختارة عن نتيجة Decoder الأولى؟
 */
export function didIterativeRefinementImproveV3(
  result:
    IterativePromptRefinementResult
): boolean {
  const iterations =
    result.history.iterations;

  if (
    iterations.length <=
    1
  ) {
    return false;
  }

  const initial =
    iterations[0];

  const best =
    iterations.find(
      iteration =>
        iteration.iteration ===
        result.history
          .bestIteration
    );

  if (!best) {
    return false;
  }

  return isIterationBetter(
    best,
    initial
  );
}

/**
 * مقدار تحسن Composite Score.
 *
 * القيمة قد تكون:
 *
 * - موجبة: تحسن.
 * - صفر: لا تغيير.
 * - سالبة: لا يفترض حدوثها لأننا
 *   نحافظ دائمًا على أفضل نتيجة.
 */
export function getIterativeScoreImprovementV3(
  result:
    IterativePromptRefinementResult
): number {
  const iterations =
    result.history.iterations;

  if (
    iterations.length ===
    0
  ) {
    return 0;
  }

  const initial =
    iterations[0];

  const best =
    iterations.find(
      iteration =>
        iteration.iteration ===
        result.history
          .bestIteration
    ) ??
    initial;

  const improvement =
    best.score.finalScore -
    initial.score.finalScore;

  if (
    !Number.isFinite(
      improvement
    )
  ) {
    return 0;
  }

  return improvement;
}

/**
 * عدد تشغيلات Decoder الإضافية.
 *
 * لا يشمل Decoder الأول الموجود داخل الطلب.
 */
export function getIterativeDecoderRunCountV3(
  result:
    IterativePromptRefinementResult
): number {
  return Math.max(
    0,
    result.history
      .iterations
      .length -
      1
  );
}

/**
 * الوصول إلى أفضل Iteration كاملًا.
 */
export function getBestIterationResultV3(
  result:
    IterativePromptRefinementResult
): IterationResult {
  const best =
    result.history
      .iterations
      .find(
        iteration =>
          iteration.iteration ===
          result.history
            .bestIteration
      );

  if (best) {
    return best;
  }

  const fallback =
    result.history
      .iterations[0];

  if (fallback) {
    return fallback;
  }

  throw new SegmentationError(
    'MASK_SELECTION_FAILED',
    'Iterative prompt refinement result does not contain any iterations.',
    {
      stage:
        'select-best-mask',

      retryable:
        false,
    }
  );
}

/* =========================================================
 * Dependency factory
 * ======================================================= */

/**
 * Factory بسيطة لضمان أن Dependencies
 * تم تمريرها بنفس العقود المطلوبة.
 *
 * لا تغيّر الدوال ولا تغلفها حتى لا
 * تضيف تكلفة أثناء المعالجة.
 */
export function createIterativePromptRefinerDependenciesV3(
  dependencies:
    IterativePromptRefinerDependencies
): IterativePromptRefinerDependencies {
  validateDependencies(
    dependencies
  );

  return {
    buildDecoderInputs:
      dependencies
        .buildDecoderInputs,

    runDecoder:
      dependencies
        .runDecoder,

    analyzeFailure:
      dependencies
        .analyzeFailure,

    generateAdaptivePrompt:
      dependencies
        .generateAdaptivePrompt,

    scoreIteration:
      dependencies
        .scoreIteration,
  };
}

/* =========================================================
 * Feature support helpers
 * ======================================================= */

export function canRunIterativePromptRefinementV3(
  config?:
    Partial<IterativePromptRefinerConfig>
): boolean {
  const resolved =
    normalizeConfig(
      config
    );

  return (
    resolved.enabled &&
    resolved.maximumIterations >
      1
  );
}

/**
 * تقدير أقصى عدد لتشغيل Decoder إضافيًا.
 */
export function getMaximumAdditionalDecoderRunsV3(
  config?:
    Partial<IterativePromptRefinerConfig>
): number {
  const resolved =
    normalizeConfig(
      config
    );

  if (
    !resolved.enabled
  ) {
    return 0;
  }

  return Math.max(
    0,
    resolved.maximumIterations -
      1
  );
}

/* =========================================================
 * File completion
 * ======================================================= */

/**
 * IterativePromptRefinerV3.ts اكتمل.
 *
 * Public API الأساسي:
 *
 * refinePromptIterativelyV3()
 *
 * Dependencies المطلوبة:
 *
 * - buildDecoderInputs
 * - runDecoder
 * - analyzeFailure
 * - generateAdaptivePrompt
 * - scoreIteration اختياري
 *
 * التسلسل النهائي:
 *
 * Initial Decoder Result
 *          ↓
 * Failure Analysis
 *          ↓
 * Adaptive Prompt
 *          ↓
 * Decoder Inputs
 *          ↓
 * Decoder Run
 *          ↓
 * Candidate Scoring
 *          ↓
 * Best Result Protection
 *          ↓
 * Early Stop / Next Iteration
 */