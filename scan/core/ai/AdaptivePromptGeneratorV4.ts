// scan/core/ai/AdaptivePromptGeneratorV4.ts
// Part 1/2
//
// Triple N - EdgeSAM Adaptive Prompt Generator V4
//
// هذا الملف يستقبل نتيجة:
// PromptFailureAnalyzerV3
//
// ثم ينشئ Prompt جديدًا للمحاولة التالية.
//
// المسؤوليات:
//
// 1) إضافة Positive Points للأجزاء المفقودة.
// 2) إضافة Negative Points لمناطق الخلفية والظل.
// 3) توسيع أو تصغير Bounding Box.
// 4) إعادة تمركز Bounding Box.
// 5) استخدام Previous Mask عند الحاجة.
// 6) منع تكرار النقاط وتقاربها الشديد.
// 7) حماية النقاط من حواف الصورة.
// 8) عدم تعديل الـPrompt الأصلي مباشرة.

/* =========================================================
 * Imports
 * ======================================================= */

import type {
    EdgeSamBoxPrompt,
    EdgeSamPreviousMaskPrompt,
    EdgeSamPrompt,
    EdgeSamPromptPoint,
    SegmentationCancellationSignal,
    SegmentationCoordinateSpace,
    SegmentationFloatMask,
    SegmentationSize,
} from './types';

import {
    SegmentationError,
    clampSegmentationValue,
    clampUnitValue,
    createEdgeSamPromptId,
    createSegmentationRequestId,
    getUnknownErrorMessage,
    isSegmentationError,
    isValidFloatMask,
} from './types';

import type {
    PromptFailureAnalysisResultV3,
    PromptFailureEvidencePointV3,
    PromptFailureSuggestedActionV3,
} from './PromptFailureAnalyzerV3';

/* =========================================================
 * Public types
 * ======================================================= */

export type AdaptivePromptAppliedActionV4 =
  PromptFailureSuggestedActionV3 |
  'preserve-current-prompt'
  | 'limit-positive-points'
  | 'limit-negative-points'
  | 'remove-duplicate-points'
  | 'clamp-points-to-safe-area'
  | 'fallback-center-point';

export type AdaptivePromptGenerationRequestV4 = {
  requestId?:
    string;

  /**
   * الـPrompt الحالي الذي أنتج
   * نتيجة Decoder الأخيرة.
   */
  currentPrompt:
    EdgeSamPrompt;

  /**
   * نتيجة PromptFailureAnalyzerV3.
   */
  failureAnalysis:
    PromptFailureAnalysisResultV3;

  /**
   * الماسك الذي يمكن تمريره إلى Decoder
   * كـPrevious Mask.
   *
   * غالبًا هو normalizedMask الخاصة
   * بأفضل Candidate حالية.
   */
  previousMask?:
    SegmentationFloatMask | null;

  /**
   * رقم المحاولة التالية.
   */
  iterationIndex?:
    number;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

export type AdaptivePromptGeneratorConfigV4 = {
  enabled:
    boolean;

  /**
   * الاحتفاظ بالنقاط الحالية عند التحسين.
   */
  preserveExistingPoints:
    boolean;

  /**
   * عند انهيار الماسك، نستبدل النقاط
   * بدل البناء فوق Prompt فاشلة.
   */
  replacePointsOnCollapse:
    boolean;

  maximumPositivePoints:
    number;

  maximumNegativePoints:
    number;

  /**
   * أقل مسافة بين نقطتين كنسبة
   * من القطر القطري لمساحة Prompt.
   */
  minimumPointDistanceRatio:
    number;

  /**
   * هامش آمن للنقاط من حواف الصورة.
   */
  edgeSafeMarginRatio:
    number;

  /**
   * مقدار توسيع الـBox.
   */
  boxExpansionRatio:
    number;

  /**
   * مقدار تصغير الـBox.
   */
  boxShrinkRatio:
    number;

  /**
   * قوة تحريك مركز الـBox تجاه
   * مركز الـMask.
   */
  boxRecenterStrength:
    number;

  /**
   * إنشاء Box عند عدم وجوده
   * والـFailure تحتاج Box.
   */
  allowBoxCreation:
    boolean;

  /**
   * السماح باستخدام Previous Mask.
   */
  allowPreviousMask:
    boolean;

  /**
   * أقل Failure Score لتنفيذ الإجراء.
   */
  minimumActionScore:
    number;

  /**
   * أقل Confidence لقبول Evidence Point.
   */
  minimumEvidenceConfidence:
    number;
};

export const DEFAULT_ADAPTIVE_PROMPT_GENERATOR_CONFIG_V4:
  Readonly<AdaptivePromptGeneratorConfigV4> = {
    enabled:
      true,

    preserveExistingPoints:
      true,

    replacePointsOnCollapse:
      true,

    maximumPositivePoints:
      8,

    maximumNegativePoints:
      10,

    minimumPointDistanceRatio:
      0.04,

    edgeSafeMarginRatio:
      0.018,

    boxExpansionRatio:
      0.08,

    boxShrinkRatio:
      0.08,

    boxRecenterStrength:
      0.65,

    allowBoxCreation:
      true,

    allowPreviousMask:
      true,

    minimumActionScore:
      0.20,

    minimumEvidenceConfidence:
      0.20,
  };

export type AdaptivePromptGeneratorDiagnosticsV4 = {
  iterationIndex:
    number;

  requestedAction:
    PromptFailureSuggestedActionV3;

  appliedActions:
    readonly AdaptivePromptAppliedActionV4[];

  originalMode:
    EdgeSamPrompt['mode'];

  generatedMode:
    EdgeSamPrompt['mode'];

  originalPositivePointCount:
    number;

  originalNegativePointCount:
    number;

  generatedPositivePointCount:
    number;

  generatedNegativePointCount:
    number;

  duplicatePointCount:
    number;

  rejectedEvidencePointCount:
    number;

  boundingBoxChanged:
    boolean;

  boundingBoxCreated:
    boolean;

  previousMaskAdded:
    boolean;

  previousMaskRemoved:
    boolean;

  usedFallbackCenterPoint:
    boolean;

  warnings:
    readonly string[];
};

export type AdaptivePromptGenerationResultV4 = {
  requestId:
    string;

  prompt:
    EdgeSamPrompt;

  changed:
    boolean;

  appliedActions:
    readonly AdaptivePromptAppliedActionV4[];

  diagnostics:
    AdaptivePromptGeneratorDiagnosticsV4;

  warnings:
    readonly string[];

  durationMs:
    number;
};

/* =========================================================
 * Internal types
 * ======================================================= */

type MutableAdaptivePromptStateV4 = {
  positivePoints:
    EdgeSamPromptPoint[];

  negativePoints:
    EdgeSamPromptPoint[];

  box:
    EdgeSamBoxPrompt | null;

  previousMask:
    EdgeSamPreviousMaskPrompt | null;

  appliedActions:
    AdaptivePromptAppliedActionV4[];

  warnings:
    string[];

  duplicatePointCount:
    number;

  rejectedEvidencePointCount:
    number;

  boundingBoxChanged:
    boolean;

  boundingBoxCreated:
    boolean;

  previousMaskAdded:
    boolean;

  previousMaskRemoved:
    boolean;

  usedFallbackCenterPoint:
    boolean;
};

/* =========================================================
 * Basic helpers
 * ======================================================= */

function nowV4():
  number {
  return Date.now();
}

function assertNotCancelledV4(
  signal:
    SegmentationCancellationSignal |
    undefined
):
  void {
  signal?.throwIfCancelled();
}

function safeDivideV4(
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

  const result =
    numerator /
    denominator;

  return Number.isFinite(
    result
  )
    ? result
    : fallback;
}

function clampIntegerV4(
  value:
    number,
  minimum:
    number,
  maximum:
    number
):
  number {
  const safeValue =
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
      safeValue
    )
  );
}

function addUniqueActionV4(
  actions:
    AdaptivePromptAppliedActionV4[],
  action:
    AdaptivePromptAppliedActionV4
):
  void {
  if (
    !actions.includes(
      action
    )
  ) {
    actions.push(
      action
    );
  }
}

function addUniqueWarningV4(
  warnings:
    string[],
  warning:
    string | null | undefined
):
  void {
  const normalized =
    warning
      ?.replace(
        /\s+/g,
        ' '
      )
      .trim();

  if (
    normalized &&
    !warnings.includes(
      normalized
    )
  ) {
    warnings.push(
      normalized
    );
  }
}

/* =========================================================
 * Configuration
 * ======================================================= */

function normalizeAdaptivePromptConfigV4(
  input?:
    Partial<
      AdaptivePromptGeneratorConfigV4
    >
):
  AdaptivePromptGeneratorConfigV4 {
  const defaults =
    DEFAULT_ADAPTIVE_PROMPT_GENERATOR_CONFIG_V4;

  const result = {
    ...defaults,
    ...(input ?? {}),
  };

  return {
    enabled:
      Boolean(
        result.enabled
      ),

    preserveExistingPoints:
      Boolean(
        result.preserveExistingPoints
      ),

    replacePointsOnCollapse:
      Boolean(
        result.replacePointsOnCollapse
      ),

    maximumPositivePoints:
      clampIntegerV4(
        result.maximumPositivePoints,
        1,
        32
      ),

    maximumNegativePoints:
      clampIntegerV4(
        result.maximumNegativePoints,
        0,
        32
      ),

    minimumPointDistanceRatio:
      clampUnitValue(
        result.minimumPointDistanceRatio
      ),

    edgeSafeMarginRatio:
      clampSegmentationValue(
        result.edgeSafeMarginRatio,
        0,
        0.25
      ),

    boxExpansionRatio:
      clampSegmentationValue(
        result.boxExpansionRatio,
        0,
        0.50
      ),

    boxShrinkRatio:
      clampSegmentationValue(
        result.boxShrinkRatio,
        0,
        0.45
      ),

    boxRecenterStrength:
      clampUnitValue(
        result.boxRecenterStrength
      ),

    allowBoxCreation:
      Boolean(
        result.allowBoxCreation
      ),

    allowPreviousMask:
      Boolean(
        result.allowPreviousMask
      ),

    minimumActionScore:
      clampUnitValue(
        result.minimumActionScore
      ),

    minimumEvidenceConfidence:
      clampUnitValue(
        result.minimumEvidenceConfidence
      ),
  };
}

export function createAdaptivePromptGeneratorConfigV4(
  input?:
    Partial<
      AdaptivePromptGeneratorConfigV4
    >
):
  AdaptivePromptGeneratorConfigV4 {
  return normalizeAdaptivePromptConfigV4(
    input
  );
}

/* =========================================================
 * Validation
 * ======================================================= */

function validatePromptV4(
  prompt:
    EdgeSamPrompt
):
  void {
  if (
    !prompt ||
    typeof prompt !==
      'object'
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'Adaptive prompt generation requires a valid EdgeSAM prompt.'
    );
  }

  if (
    !Number.isFinite(
      prompt.sourceSize.width
    ) ||
    !Number.isFinite(
      prompt.sourceSize.height
    ) ||
    prompt.sourceSize.width <=
      0 ||
    prompt.sourceSize.height <=
      0
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'Prompt source size is invalid.'
    );
  }

  for (
    const point of
    prompt.points
  ) {
    if (
      !Number.isFinite(
        point.x
      ) ||
      !Number.isFinite(
        point.y
      )
    ) {
      throw new SegmentationError(
        'PROMPT_INVALID',
        'Prompt contains an invalid point.'
      );
    }
  }
}

function validateAdaptivePromptRequestV4(
  request:
    AdaptivePromptGenerationRequestV4
):
  void {
  if (
    !request ||
    typeof request !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Adaptive prompt generation request is required.'
    );
  }

  validatePromptV4(
    request.currentPrompt
  );

  if (
    !request.failureAnalysis ||
    typeof request.failureAnalysis !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Prompt failure analysis result is required.'
    );
  }

  if (
    request.previousMask
  ) {
    if (
      !isValidFloatMask(
        request.previousMask
      )
    ) {
      throw new SegmentationError(
        'MASK_INVALID',
        'Previous mask is invalid.'
      );
    }

    const candidateMask =
      request
        .failureAnalysis
        .candidate
        .normalizedMask;

    if (
      request.previousMask.width !==
        candidateMask.width ||
      request.previousMask.height !==
        candidateMask.height
    ) {
      throw new SegmentationError(
        'MASK_INVALID',
        'Previous mask dimensions must match the analyzed candidate mask.'
      );
    }
  }

  assertNotCancelledV4(
    request.cancellationSignal
  );
}

/* =========================================================
 * Point helpers
 * ======================================================= */

function getPointCountByLabelV4(
  points:
    readonly EdgeSamPromptPoint[],
  label:
    0 | 1
):
  number {
  return points.reduce(
    (
      count,
      point
    ) =>
      count +
      (
        point.label ===
        label
          ? 1
          : 0
      ),
    0
  );
}

function clonePromptPointV4(
  point:
    EdgeSamPromptPoint
):
  EdgeSamPromptPoint {
  return {
    ...point,
  };
}

function cloneBoxPromptV4(
  box:
    EdgeSamBoxPrompt | null
):
  EdgeSamBoxPrompt | null {
  if (
    !box
  ) {
    return null;
  }

  return {
    ...box,

    box: {
      ...box.box,
    },
  };
}

function clonePreviousMaskPromptV4(
  mask:
    EdgeSamPreviousMaskPrompt | null
):
  EdgeSamPreviousMaskPrompt | null {
  if (
    !mask
  ) {
    return null;
  }

  return {
    ...mask,

    data:
      new Float32Array(
        mask.data
      ),

    dimensions: [
      ...mask.dimensions,
    ],
  };
}

function getPromptSafeMarginsV4(
  sourceSize:
    SegmentationSize,
  ratio:
    number
): {
  x:
    number;

  y:
    number;
} {
  return {
    x:
      Math.max(
        0,
        sourceSize.width *
          ratio
      ),

    y:
      Math.max(
        0,
        sourceSize.height *
          ratio
      ),
  };
}

function clampPromptPointV4(
  x:
    number,
  y:
    number,
  sourceSize:
    SegmentationSize,
  marginRatio:
    number
): {
  x:
    number;

  y:
    number;
} {
  const margins =
    getPromptSafeMarginsV4(
      sourceSize,
      marginRatio
    );

  const maximumX =
    Math.max(
      margins.x,
      sourceSize.width -
        1 -
        margins.x
    );

  const maximumY =
    Math.max(
      margins.y,
      sourceSize.height -
        1 -
        margins.y
    );

  return {
    x:
      clampSegmentationValue(
        x,
        margins.x,
        maximumX
      ),

    y:
      clampSegmentationValue(
        y,
        margins.y,
        maximumY
      ),
  };
}

/**
 * Evidence Points داخل PromptFailureAnalyzerV3
 * تكون في مساحة normalizedMask.
 *
 * هنا نحولها إلى مساحة currentPrompt.sourceSize.
 */
function convertEvidencePointToPromptSpaceV4(
  evidence:
    PromptFailureEvidencePointV3,
  maskSize:
    SegmentationSize,
  promptSize:
    SegmentationSize,
  edgeSafeMarginRatio:
    number
): {
  x:
    number;

  y:
    number;
} {
  const maximumMaskX =
    Math.max(
      1,
      maskSize.width -
        1
    );

  const maximumMaskY =
    Math.max(
      1,
      maskSize.height -
        1
    );

  const maximumPromptX =
    Math.max(
      0,
      promptSize.width -
        1
    );

  const maximumPromptY =
    Math.max(
      0,
      promptSize.height -
        1
    );

  const x =
    safeDivideV4(
      evidence.x,
      maximumMaskX,
      0.5
    ) *
    maximumPromptX;

  const y =
    safeDivideV4(
      evidence.y,
      maximumMaskY,
      0.5
    ) *
    maximumPromptY;

  return clampPromptPointV4(
    x,
    y,
    promptSize,
    edgeSafeMarginRatio
  );
}

function getPointDistanceV4(
  first:
    Pick<
      EdgeSamPromptPoint,
      'x' | 'y'
    >,
  second:
    Pick<
      EdgeSamPromptPoint,
      'x' | 'y'
    >
):
  number {
  return Math.hypot(
    first.x -
      second.x,
    first.y -
      second.y
  );
}

function getMinimumPointDistanceV4(
  sourceSize:
    SegmentationSize,
  ratio:
    number
):
  number {
  return Math.hypot(
    sourceSize.width,
    sourceSize.height
  ) *
  ratio;
}

function isPointFarEnoughV4(
  point:
    Pick<
      EdgeSamPromptPoint,
      'x' | 'y'
    >,
  points:
    readonly EdgeSamPromptPoint[],
  minimumDistance:
    number
):
  boolean {
  return points.every(
    existingPoint =>
      getPointDistanceV4(
        point,
        existingPoint
      ) >=
      minimumDistance
  );
}

function createAdaptivePromptPointV4(
  x:
    number,
  y:
    number,
  label:
    0 | 1,
  coordinateSpace:
    SegmentationCoordinateSpace,
  confidence:
    number
):
  EdgeSamPromptPoint {
  return {
    id:
      createEdgeSamPromptId(
        'point'
      ),

    x,
    y,
    label,

    kind:
      label ===
        1
        ? 'positive'
        : 'negative',

    coordinateSpace,

    confidence:
      clampUnitValue(
        confidence
      ),

    generatedAutomatically:
      true,
  };
}

/* =========================================================
 * Evidence point insertion
 * ======================================================= */

function appendEvidencePointsV4(
  target:
    EdgeSamPromptPoint[],
  oppositePoints:
    readonly EdgeSamPromptPoint[],
  evidencePoints:
    readonly PromptFailureEvidencePointV3[],
  label:
    0 | 1,
  maximumCount:
    number,
  maskSize:
    SegmentationSize,
  prompt:
    EdgeSamPrompt,
  config:
    AdaptivePromptGeneratorConfigV4,
  state:
    MutableAdaptivePromptStateV4
):
  void {
  const minimumDistance =
    getMinimumPointDistanceV4(
      prompt.sourceSize,
      config.minimumPointDistanceRatio
    );

  const sortedEvidence = [
    ...evidencePoints,
  ].sort(
    (
      first,
      second
    ) =>
      second.confidence -
      first.confidence
  );

  for (
    const evidence of
    sortedEvidence
  ) {
    if (
      target.length >=
      maximumCount
    ) {
      break;
    }

    if (
      evidence.confidence <
      config.minimumEvidenceConfidence
    ) {
      state.rejectedEvidencePointCount +=
        1;

      continue;
    }

    const converted =
      convertEvidencePointToPromptSpaceV4(
        evidence,
        maskSize,
        prompt.sourceSize,
        config.edgeSafeMarginRatio
      );

    const point =
      createAdaptivePromptPointV4(
        converted.x,
        converted.y,
        label,
        prompt.coordinateSpace,
        evidence.confidence
      );

    const allExistingPoints = [
      ...target,
      ...oppositePoints,
    ];

    if (
      !isPointFarEnoughV4(
        point,
        allExistingPoints,
        minimumDistance
      )
    ) {
      state.duplicatePointCount +=
        1;

      continue;
    }

    target.push(
      point
    );
  }
}

/* =========================================================
 * Initial state
 * ======================================================= */

function createInitialAdaptivePromptStateV4(
  prompt:
    EdgeSamPrompt,
  config:
    AdaptivePromptGeneratorConfigV4
):
  MutableAdaptivePromptStateV4 {
  const positivePoints =
    config.preserveExistingPoints
      ? prompt.points
          .filter(
            point =>
              point.label ===
              1
          )
          .map(
            clonePromptPointV4
          )
      : [];

  const negativePoints =
    config.preserveExistingPoints
      ? prompt.points
          .filter(
            point =>
              point.label ===
              0
          )
          .map(
            clonePromptPointV4
          )
      : [];

  return {
    positivePoints,
    negativePoints,

    box:
      cloneBoxPromptV4(
        prompt.box
      ),

    previousMask:
      clonePreviousMaskPromptV4(
        prompt.previousMask
      ),

    appliedActions:
      [],

    warnings: [
      ...prompt.warnings,
    ],

    duplicatePointCount:
      0,

    rejectedEvidencePointCount:
      0,

    boundingBoxChanged:
      false,

    boundingBoxCreated:
      false,

    previousMaskAdded:
      false,

    previousMaskRemoved:
      false,

    usedFallbackCenterPoint:
      false,
  };
}

/* =========================================================
 * Part 2 continuation
 * ======================================================= */

/**
 * Part 2/2 سيكمل مباشرة بعد هذا التعليق:
 *
 * - إضافة Positive / Negative Points.
 * - Box expansion and shrinking.
 * - Box recentering.
 * - Previous-mask creation.
 * - Prompt mode resolution.
 * - Collapse fallback.
 * - Public generateAdaptivePromptV4 API.
 * - Adapter للربط مع IterativePromptRefinerV3.
 */
// scan/core/ai/AdaptivePromptGeneratorV4.ts
// Part 2/2
//
// يكمل مباشرة بعد createInitialAdaptivePromptStateV4.

/* =========================================================
 * Positive / negative points
 * ======================================================= */

function applyPositiveEvidenceV4(
  state:
    MutableAdaptivePromptStateV4,
  request:
    AdaptivePromptGenerationRequestV4,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  const failure =
    request
      .failureAnalysis
      .dominantFailure;

  if (
    !failure ||
    failure.score <
      config.minimumActionScore
  ) {
    return;
  }

  const mask =
    request
      .failureAnalysis
      .candidate
      .normalizedMask;

  appendEvidencePointsV4(
    state.positivePoints,
    state.negativePoints,
    failure.positivePoints,
    1,
    config.maximumPositivePoints,
    {
      width:
        mask.width,

      height:
        mask.height,
    },
    request.currentPrompt,
    config,
    state
  );

  if (
    failure
      .positivePoints
      .length >
    0
  ) {
    addUniqueActionV4(
      state.appliedActions,
      failure.suggestedAction
    );
  }
}

function applyNegativeEvidenceV4(
  state:
    MutableAdaptivePromptStateV4,
  request:
    AdaptivePromptGenerationRequestV4,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  const failure =
    request
      .failureAnalysis
      .dominantFailure;

  if (
    !failure ||
    failure.score <
      config.minimumActionScore
  ) {
    return;
  }

  const mask =
    request
      .failureAnalysis
      .candidate
      .normalizedMask;

  appendEvidencePointsV4(
    state.negativePoints,
    state.positivePoints,
    failure.negativePoints,
    0,
    config.maximumNegativePoints,
    {
      width:
        mask.width,

      height:
        mask.height,
    },
    request.currentPrompt,
    config,
    state
  );

  if (
    failure
      .negativePoints
      .length >
    0
  ) {
    addUniqueActionV4(
      state.appliedActions,
      failure.suggestedAction
    );
  }
}

/* =========================================================
 * Fallback center point
 * ======================================================= */

function ensurePositivePointV4(
  state:
    MutableAdaptivePromptStateV4,
  prompt:
    EdgeSamPrompt,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  if (
    state.positivePoints.length >
    0
  ) {
    return;
  }

  const center =
    clampPromptPointV4(
      (
        prompt
          .sourceSize
          .width -
        1
      ) /
        2,
      (
        prompt
          .sourceSize
          .height -
        1
      ) /
        2,
      prompt.sourceSize,
      config.edgeSafeMarginRatio
    );

  state
    .positivePoints
    .push(
      createAdaptivePromptPointV4(
        center.x,
        center.y,
        1,
        prompt.coordinateSpace,
        0.50
      )
    );

  state.usedFallbackCenterPoint =
    true;

  addUniqueActionV4(
    state.appliedActions,
    'fallback-center-point'
  );
}

/* =========================================================
 * Box helpers
 * ======================================================= */

function createDefaultBoxV4(
  prompt:
    EdgeSamPrompt
):
  EdgeSamBoxPrompt {
  const width =
    prompt
      .sourceSize
      .width;

  const height =
    prompt
      .sourceSize
      .height;

  return {
    id:
      createEdgeSamPromptId(
        'box'
      ),

    box: {
      x1:
        width *
        0.16,

      y1:
        height *
        0.10,

      x2:
        width *
        0.84,

      y2:
        height *
        0.90,
    },

    coordinateSpace:
      prompt.coordinateSpace,

    confidence:
      0.45,

    generatedAutomatically:
      true,

    expansionRatio:
      0,
  };
}

function clampBoxCoordinatesV4(
  box:
    EdgeSamBoxPrompt,
  sourceSize:
    SegmentationSize
):
  EdgeSamBoxPrompt {
  const maximumX =
    Math.max(
      0,
      sourceSize.width -
        1
    );

  const maximumY =
    Math.max(
      0,
      sourceSize.height -
        1
    );

  const x1 =
    clampSegmentationValue(
      Math.min(
        box.box.x1,
        box.box.x2
      ),
      0,
      maximumX
    );

  const y1 =
    clampSegmentationValue(
      Math.min(
        box.box.y1,
        box.box.y2
      ),
      0,
      maximumY
    );

  const x2 =
    clampSegmentationValue(
      Math.max(
        box.box.x1,
        box.box.x2
      ),
      x1,
      maximumX
    );

  const y2 =
    clampSegmentationValue(
      Math.max(
        box.box.y1,
        box.box.y2
      ),
      y1,
      maximumY
    );

  return {
    ...box,

    box: {
      x1,
      y1,
      x2,
      y2,
    },
  };
}

function ensureBoxV4(
  state:
    MutableAdaptivePromptStateV4,
  prompt:
    EdgeSamPrompt,
  config:
    AdaptivePromptGeneratorConfigV4
):
  EdgeSamBoxPrompt | null {
  if (
    state.box
  ) {
    return state.box;
  }

  if (
    !config.allowBoxCreation
  ) {
    addUniqueWarningV4(
      state.warnings,
      'Bounding box was required but box creation is disabled.'
    );

    return null;
  }

  state.box =
    createDefaultBoxV4(
      prompt
    );

  state.boundingBoxCreated =
    true;

  addUniqueActionV4(
    state.appliedActions,
    'replace-prompt'
  );

  return state.box;
}

function expandBoxV4(
  state:
    MutableAdaptivePromptStateV4,
  prompt:
    EdgeSamPrompt,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  const box =
    ensureBoxV4(
      state,
      prompt,
      config
    );

  if (
    !box
  ) {
    return;
  }

  const width =
    Math.max(
      1,
      box.box.x2 -
        box.box.x1
    );

  const height =
    Math.max(
      1,
      box.box.y2 -
        box.box.y1
    );

  const expansionX =
    width *
    config.boxExpansionRatio;

  const expansionY =
    height *
    config.boxExpansionRatio;

  state.box =
    clampBoxCoordinatesV4(
      {
        ...box,

        box: {
          x1:
            box.box.x1 -
            expansionX,

          y1:
            box.box.y1 -
            expansionY,

          x2:
            box.box.x2 +
            expansionX,

          y2:
            box.box.y2 +
            expansionY,
        },

        expansionRatio:
          box.expansionRatio +
          config.boxExpansionRatio,
      },
      prompt.sourceSize
    );

  state.boundingBoxChanged =
    true;

  addUniqueActionV4(
    state.appliedActions,
    'expand-box'
  );
}

function shrinkBoxV4(
  state:
    MutableAdaptivePromptStateV4,
  prompt:
    EdgeSamPrompt,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  const box =
    ensureBoxV4(
      state,
      prompt,
      config
    );

  if (
    !box
  ) {
    return;
  }

  const width =
    Math.max(
      1,
      box.box.x2 -
        box.box.x1
    );

  const height =
    Math.max(
      1,
      box.box.y2 -
        box.box.y1
    );

  const shrinkX =
    width *
    config.boxShrinkRatio;

  const shrinkY =
    height *
    config.boxShrinkRatio;

  state.box =
    clampBoxCoordinatesV4(
      {
        ...box,

        box: {
          x1:
            box.box.x1 +
            shrinkX,

          y1:
            box.box.y1 +
            shrinkY,

          x2:
            box.box.x2 -
            shrinkX,

          y2:
            box.box.y2 -
            shrinkY,
        },

        expansionRatio:
          Math.max(
            0,
            box.expansionRatio -
              config.boxShrinkRatio
          ),
      },
      prompt.sourceSize
    );

  state.boundingBoxChanged =
    true;

  addUniqueActionV4(
    state.appliedActions,
    'shrink-box'
  );
}

function recenterBoxV4(
  state:
    MutableAdaptivePromptStateV4,
  request:
    AdaptivePromptGenerationRequestV4,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  const prompt =
    request.currentPrompt;

  const box =
    ensureBoxV4(
      state,
      prompt,
      config
    );

  if (
    !box
  ) {
    return;
  }

  const bounds =
    request
      .failureAnalysis
      .diagnostics
      .bounds;

  if (
    !bounds
  ) {
    addUniqueWarningV4(
      state.warnings,
      'Bounding box could not be recentered because mask bounds are unavailable.'
    );

    return;
  }

  const mask =
    request
      .failureAnalysis
      .candidate
      .normalizedMask;

  const maskCenterX =
    bounds.x +
    bounds.width /
      2;

  const maskCenterY =
    bounds.y +
    bounds.height /
      2;

  const promptTargetX =
    safeDivideV4(
      maskCenterX,
      Math.max(
        1,
        mask.width -
          1
      ),
      0.5
    ) *
    Math.max(
      0,
      prompt
        .sourceSize
        .width -
        1
    );

  const promptTargetY =
    safeDivideV4(
      maskCenterY,
      Math.max(
        1,
        mask.height -
          1
      ),
      0.5
    ) *
    Math.max(
      0,
      prompt
        .sourceSize
        .height -
        1
    );

  const boxCenterX =
    (
      box.box.x1 +
      box.box.x2
    ) /
    2;

  const boxCenterY =
    (
      box.box.y1 +
      box.box.y2
    ) /
    2;

  const movementX =
    (
      promptTargetX -
      boxCenterX
    ) *
    config.boxRecenterStrength;

  const movementY =
    (
      promptTargetY -
      boxCenterY
    ) *
    config.boxRecenterStrength;

  state.box =
    clampBoxCoordinatesV4(
      {
        ...box,

        box: {
          x1:
            box.box.x1 +
            movementX,

          y1:
            box.box.y1 +
            movementY,

          x2:
            box.box.x2 +
            movementX,

          y2:
            box.box.y2 +
            movementY,
        },
      },
      prompt.sourceSize
    );

  state.boundingBoxChanged =
    true;

  addUniqueActionV4(
    state.appliedActions,
    'recenter-box'
  );
}

/* =========================================================
 * Previous mask
 * ======================================================= */

function createPreviousMaskPromptV4(
  mask:
    SegmentationFloatMask
):
  EdgeSamPreviousMaskPrompt {
  return {
    id:
      createEdgeSamPromptId(
        'mask'
      ),

    width:
      mask.width,

    height:
      mask.height,

    data:
      new Float32Array(
        mask.data
      ),

    dimensions: [
      1,
      1,
      mask.height,
      mask.width,
    ],

    coordinateSpace:
      'model-input',

    generatedAutomatically:
      true,
  };
}

function addPreviousMaskV4(
  state:
    MutableAdaptivePromptStateV4,
  request:
    AdaptivePromptGenerationRequestV4,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  if (
    !config.allowPreviousMask
  ) {
    addUniqueWarningV4(
      state.warnings,
      'Previous mask support is disabled.'
    );

    return;
  }

  const mask =
    request.previousMask ??
    request
      .failureAnalysis
      .candidate
      .normalizedMask;

  if (
    !isValidFloatMask(
      mask
    )
  ) {
    addUniqueWarningV4(
      state.warnings,
      'Previous mask could not be created because the source mask is invalid.'
    );

    return;
  }

  state.previousMask =
    createPreviousMaskPromptV4(
      mask
    );

  state.previousMaskAdded =
    true;

  addUniqueActionV4(
    state.appliedActions,
    'use-previous-mask'
  );
}

function removePreviousMaskV4(
  state:
    MutableAdaptivePromptStateV4
):
  void {
  if (
    !state.previousMask
  ) {
    return;
  }

  state.previousMask =
    null;

  state.previousMaskRemoved =
    true;

  addUniqueActionV4(
    state.appliedActions,
    'remove-previous-mask'
  );
}

/* =========================================================
 * Collapse handling
 * ======================================================= */

function handleCollapsedPromptV4(
  state:
    MutableAdaptivePromptStateV4,
  request:
    AdaptivePromptGenerationRequestV4,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  if (
    !request
      .failureAnalysis
      .flags
      .foregroundCollapsed
  ) {
    return;
  }

  if (
    config.replacePointsOnCollapse
  ) {
    state.positivePoints =
      [];

    state.negativePoints =
      [];

    removePreviousMaskV4(
      state
    );

    addUniqueActionV4(
      state.appliedActions,
      'replace-prompt'
    );
  }

  ensurePositivePointV4(
    state,
    request.currentPrompt,
    config
  );

  expandBoxV4(
    state,
    request.currentPrompt,
    config
  );
}

/* =========================================================
 * Action routing
 * ======================================================= */

function applyRequestedActionV4(
  state:
    MutableAdaptivePromptStateV4,
  request:
    AdaptivePromptGenerationRequestV4,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  const dominantFailure =
    request
      .failureAnalysis
      .dominantFailure;

  if (
    !dominantFailure ||
    dominantFailure.score <
      config.minimumActionScore
  ) {
    addUniqueActionV4(
      state.appliedActions,
      'preserve-current-prompt'
    );

    return;
  }

  switch (
    dominantFailure.suggestedAction
  ) {
    case 'add-positive-point':
    case 'add-multiple-positive-points':
    case 'strengthen-thin-structure-support':
      applyPositiveEvidenceV4(
        state,
        request,
        config
      );
      break;

    case 'add-negative-point':
    case 'add-multiple-negative-points':
    case 'protect-boundary':
      applyNegativeEvidenceV4(
        state,
        request,
        config
      );
      break;

    case 'expand-box':
      expandBoxV4(
        state,
        request.currentPrompt,
        config
      );
      applyPositiveEvidenceV4(
        state,
        request,
        config
      );
      break;

    case 'shrink-box':
      shrinkBoxV4(
        state,
        request.currentPrompt,
        config
      );
      applyNegativeEvidenceV4(
        state,
        request,
        config
      );
      break;

    case 'recenter-box':
      recenterBoxV4(
        state,
        request,
        config
      );
      break;

    case 'use-previous-mask':
      addPreviousMaskV4(
        state,
        request,
        config
      );
      break;

    case 'remove-previous-mask':
      removePreviousMaskV4(
        state
      );
      break;

    case 'replace-prompt':
      state.positivePoints =
        [];

      state.negativePoints =
        [];

      removePreviousMaskV4(
        state
      );

      applyPositiveEvidenceV4(
        state,
        request,
        config
      );

      ensurePositivePointV4(
        state,
        request.currentPrompt,
        config
      );

      addUniqueActionV4(
        state.appliedActions,
        'replace-prompt'
      );
      break;

    case 'reject-candidate':
    case 'stop-refinement':
    case 'none':
      addUniqueActionV4(
        state.appliedActions,
        'preserve-current-prompt'
      );
      break;

    default:
      addUniqueActionV4(
        state.appliedActions,
        'preserve-current-prompt'
      );
      break;
  }
}

/* =========================================================
 * Point limiting
 * ======================================================= */

function limitPointsV4(
  state:
    MutableAdaptivePromptStateV4,
  config:
    AdaptivePromptGeneratorConfigV4
):
  void {
  if (
    state.positivePoints.length >
    config.maximumPositivePoints
  ) {
    state.positivePoints =
      state.positivePoints
        .sort(
          (
            first,
            second
          ) =>
            (
              second.confidence ??
              0
            ) -
            (
              first.confidence ??
              0
            )
        )
        .slice(
          0,
          config.maximumPositivePoints
        );

    addUniqueActionV4(
      state.appliedActions,
      'limit-positive-points'
    );
  }

  if (
    state.negativePoints.length >
    config.maximumNegativePoints
  ) {
    state.negativePoints =
      state.negativePoints
        .sort(
          (
            first,
            second
          ) =>
            (
              second.confidence ??
              0
            ) -
            (
              first.confidence ??
              0
            )
        )
        .slice(
          0,
          config.maximumNegativePoints
        );

    addUniqueActionV4(
      state.appliedActions,
      'limit-negative-points'
    );
  }
}

/* =========================================================
 * Prompt mode
 * ======================================================= */

function resolvePromptModeV4(
  state:
    MutableAdaptivePromptStateV4
):
  EdgeSamPrompt['mode'] {
  const hasPoints =
    state.positivePoints.length >
      0 ||
    state.negativePoints.length >
      0;

  if (
    state.previousMask
  ) {
    return 'previous-mask';
  }

  if (
    state.box &&
    hasPoints
  ) {
    return 'box-and-points';
  }

  if (
    state.box
  ) {
    return 'box';
  }

  return 'points';
}

/* =========================================================
 * Change detection
 * ======================================================= */

function promptsEqualV4(
  first:
    EdgeSamPrompt,
  second:
    EdgeSamPrompt
):
  boolean {
  if (
    first.mode !==
      second.mode ||
    first.points.length !==
      second.points.length ||
    Boolean(
      first.box
    ) !==
      Boolean(
        second.box
      ) ||
    Boolean(
      first.previousMask
    ) !==
      Boolean(
        second.previousMask
      )
  ) {
    return false;
  }

  for (
    let index = 0;
    index <
    first.points.length;
    index += 1
  ) {
    const firstPoint =
      first.points[
        index
      ];

    const secondPoint =
      second.points[
        index
      ];

    if (
      firstPoint.label !==
        secondPoint.label ||
      Math.abs(
        firstPoint.x -
          secondPoint.x
      ) >
        0.001 ||
      Math.abs(
        firstPoint.y -
          secondPoint.y
      ) >
        0.001
    ) {
      return false;
    }
  }

  if (
    first.box &&
    second.box
  ) {
    const firstBox =
      first.box.box;

    const secondBox =
      second.box.box;

    if (
      Math.abs(
        firstBox.x1 -
          secondBox.x1
      ) >
        0.001 ||
      Math.abs(
        firstBox.y1 -
          secondBox.y1
      ) >
        0.001 ||
      Math.abs(
        firstBox.x2 -
          secondBox.x2
      ) >
        0.001 ||
      Math.abs(
        firstBox.y2 -
          secondBox.y2
      ) >
        0.001
    ) {
      return false;
    }
  }

  return true;
}

/* =========================================================
 * Disabled result
 * ======================================================= */

function createDisabledAdaptivePromptResultV4(
  request:
    AdaptivePromptGenerationRequestV4,
  requestId:
    string,
  startedAt:
    number
):
  AdaptivePromptGenerationResultV4 {
  const prompt: EdgeSamPrompt = {
    ...request.currentPrompt,

    points:
      request
        .currentPrompt
        .points
        .map(
          clonePromptPointV4
        ),

    box:
      cloneBoxPromptV4(
        request
          .currentPrompt
          .box
      ),

    previousMask:
      clonePreviousMaskPromptV4(
        request
          .currentPrompt
          .previousMask
      ),

    warnings: [
      ...request
        .currentPrompt
        .warnings,
      'Adaptive prompt generation is disabled.',
    ],
  };

  return {
    requestId,

    prompt,

    changed:
      false,

    appliedActions: [
      'preserve-current-prompt',
    ],

    diagnostics: {
      iterationIndex:
        Math.max(
          0,
          Math.floor(
            request.iterationIndex ??
              0
          )
        ),

      requestedAction:
        request
          .failureAnalysis
          .recommendedAction,

      appliedActions: [
        'preserve-current-prompt',
      ],

      originalMode:
        request
          .currentPrompt
          .mode,

      generatedMode:
        prompt.mode,

      originalPositivePointCount:
        getPointCountByLabelV4(
          request
            .currentPrompt
            .points,
          1
        ),

      originalNegativePointCount:
        getPointCountByLabelV4(
          request
            .currentPrompt
            .points,
          0
        ),

      generatedPositivePointCount:
        getPointCountByLabelV4(
          prompt.points,
          1
        ),

      generatedNegativePointCount:
        getPointCountByLabelV4(
          prompt.points,
          0
        ),

      duplicatePointCount:
        0,

      rejectedEvidencePointCount:
        0,

      boundingBoxChanged:
        false,

      boundingBoxCreated:
        false,

      previousMaskAdded:
        false,

      previousMaskRemoved:
        false,

      usedFallbackCenterPoint:
        false,

      warnings:
        prompt.warnings,
    },

    warnings:
      prompt.warnings,

    durationMs:
      Math.max(
        0,
        nowV4() -
          startedAt
      ),
  };
}

/* =========================================================
 * Public API
 * ======================================================= */

/**
 * إنشاء Prompt محسّن للمحاولة التالية.
 */
export function generateAdaptivePromptV4(
  request:
    AdaptivePromptGenerationRequestV4,
  configInput?:
    Partial<
      AdaptivePromptGeneratorConfigV4
    >
):
  AdaptivePromptGenerationResultV4 {
  const startedAt =
    nowV4();

  const requestId =
    request
      ?.requestId
      ?.trim() ||
    createSegmentationRequestId();

  try {
    validateAdaptivePromptRequestV4(
      request
    );

    const config =
      normalizeAdaptivePromptConfigV4(
        configInput
      );

    if (
      !config.enabled
    ) {
      return createDisabledAdaptivePromptResultV4(
        request,
        requestId,
        startedAt
      );
    }

    assertNotCancelledV4(
      request.cancellationSignal
    );

    const currentPrompt =
      request.currentPrompt;

    const state =
      createInitialAdaptivePromptStateV4(
        currentPrompt,
        config
      );

    handleCollapsedPromptV4(
      state,
      request,
      config
    );

    if (
      !request
        .failureAnalysis
        .flags
        .foregroundCollapsed
    ) {
      applyRequestedActionV4(
        state,
        request,
        config
      );
    }

    ensurePositivePointV4(
      state,
      currentPrompt,
      config
    );

    limitPointsV4(
      state,
      config
    );

    const points = [
      ...state.positivePoints,
      ...state.negativePoints,
    ];

    const prompt: EdgeSamPrompt = {
      mode:
        resolvePromptModeV4(
          state
        ),

      points,

      box:
        state.box,

      previousMask:
        state.previousMask,

      generatedAutomatically:
        true,

      coordinateSpace:
        currentPrompt.coordinateSpace,

      sourceSize: {
        ...currentPrompt.sourceSize,
      },

      warnings: [
        ...state.warnings,
      ],
    };

    const changed =
      !promptsEqualV4(
        currentPrompt,
        prompt
      );

    if (
      !changed
    ) {
      addUniqueActionV4(
        state.appliedActions,
        'preserve-current-prompt'
      );
    }

    assertNotCancelledV4(
      request.cancellationSignal
    );

    const appliedActions = [
      ...state.appliedActions,
    ];

    const warnings = [
      ...state.warnings,
    ];

    return {
      requestId,

      prompt,

      changed,

      appliedActions,

      diagnostics: {
        iterationIndex:
          Math.max(
            0,
            Math.floor(
              request.iterationIndex ??
                0
            )
          ),

        requestedAction:
          request
            .failureAnalysis
            .recommendedAction,

        appliedActions,

        originalMode:
          currentPrompt.mode,

        generatedMode:
          prompt.mode,

        originalPositivePointCount:
          getPointCountByLabelV4(
            currentPrompt.points,
            1
          ),

        originalNegativePointCount:
          getPointCountByLabelV4(
            currentPrompt.points,
            0
          ),

        generatedPositivePointCount:
          getPointCountByLabelV4(
            prompt.points,
            1
          ),

        generatedNegativePointCount:
          getPointCountByLabelV4(
            prompt.points,
            0
          ),

        duplicatePointCount:
          state
            .duplicatePointCount,

        rejectedEvidencePointCount:
          state
            .rejectedEvidencePointCount,

        boundingBoxChanged:
          state
            .boundingBoxChanged,

        boundingBoxCreated:
          state
            .boundingBoxCreated,

        previousMaskAdded:
          state
            .previousMaskAdded,

        previousMaskRemoved:
          state
            .previousMaskRemoved,

        usedFallbackCenterPoint:
          state
            .usedFallbackCenterPoint,

        warnings,
      },

      warnings,

      durationMs:
        Math.max(
          0,
          nowV4() -
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
      'PROMPT_GENERATION_FAILED',
      `Adaptive prompt generation failed: ${getUnknownErrorMessage(
        error
      )}`,
      {
        requestId,

        stage:
          'create-segmentation-prompt',

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

export const createAdaptivePromptV4 =
  generateAdaptivePromptV4;

export const runAdaptivePromptGeneratorV4 =
  generateAdaptivePromptV4;

/* =========================================================
 * Generator adapter
 * ======================================================= */

export function createAdaptivePromptGeneratorV4(
  config?:
    Partial<
      AdaptivePromptGeneratorConfigV4
    >
): {
  generate(
    request:
      AdaptivePromptGenerationRequestV4
  ):
    AdaptivePromptGenerationResultV4;
} {
  const resolvedConfig =
    normalizeAdaptivePromptConfigV4(
      config
    );

  return {
    generate(
      request:
        AdaptivePromptGenerationRequestV4
    ):
      AdaptivePromptGenerationResultV4 {
      return generateAdaptivePromptV4(
        request,
        resolvedConfig
      );
    },
  };
}

/* =========================================================
 * Result helpers
 * ======================================================= */

export function didAdaptivePromptChangeV4(
  result:
    AdaptivePromptGenerationResultV4
):
  boolean {
  return result.changed;
}

export function hasAdaptivePreviousMaskV4(
  result:
    AdaptivePromptGenerationResultV4
):
  boolean {
  return Boolean(
    result.prompt.previousMask
  );
}

export function getAdaptivePromptPointCountV4(
  result:
    AdaptivePromptGenerationResultV4
): {
  positive:
    number;

  negative:
    number;

  total:
    number;
} {
  const positive =
    getPointCountByLabelV4(
      result.prompt.points,
      1
    );

  const negative =
    getPointCountByLabelV4(
      result.prompt.points,
      0
    );

  return {
    positive,
    negative,

    total:
      positive +
      negative,
  };
}