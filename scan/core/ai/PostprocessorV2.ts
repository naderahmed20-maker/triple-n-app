// scan/core/ai/PostprocessorV2.ts
// Final Version - Part 1
//
// Triple N - EdgeSAM Postprocessor V2 + Image-Guided V3
//
// هذا الملف مسؤول عن:
//
// 1. قراءة Mask Candidates الخارجة من EdgeSAM.
// 2. اختيار أفضل Candidate باستخدام Model Score وGeometry.
// 3. دعم اختيار Candidate بالتحليل البصري للصورة.
// 4. إزالة Letterbox.
// 5. تشغيل Image-Guided Boundary Processing V3.
// 6. تنفيذ تنظيف V2 الآمن.
// 7. استعادة الحجم الأصلي.
// 8. حماية الحواف.
// 9. إنشاء Alpha Mask نهائي.
// 10. إنشاء Timings وDiagnostics وStatistics.

import type {
  ImageGuidedAnalysisImageV3 as BoundaryAnalysisImageV3,
  EdgeSamDecoderRawOutput,
  SegmentationAlphaMask,
  SegmentationCancellationSignal,
  SegmentationFloatMask,
  SegmentationFloatTensor,
  SegmentationMaskRefinementDiagnostics,
  SegmentationMaskStatistics,
  SegmentationModelConfig,
  SegmentationPostprocessResult,
  SegmentationPostprocessTimings,
  SegmentationProgressCallback,
  SegmentationProgressEvent,
  SegmentationTransform,
} from './types';

import {
  SEGMENTATION_STAGE_INDEX,
  SegmentationError,
  alphaByteFromUnitValue,
  clampUnitValue,
  createSegmentationRequestId,
  getSegmentationProgress,
  getUnknownErrorMessage,
  isSegmentationError,
} from './types';

import {
  DEFAULT_SEGMENTATION_MODEL_CONFIG,
  cloneSegmentationModelConfig,
  validateSegmentationModelConfig,
} from './modelConfig';

import {
  analyzeImageGuidedCandidatesV3,
  type ImageGuidedAnalysisImageV3 as CandidateAnalysisImageV3,
} from './ImageGuidedCandidateAnalysisV3';

import {
  extractBoundaryFeatureMapV3,
} from './BoundaryFeatureExtractorV3';

import {
  buildLocalForegroundModelV3,
} from './LocalForegroundModelV3';

import {
  classifyImageGuidedPixelsV3,
} from './ImageGuidedPixelClassifierV3';

import {
  applyConfidenceVotingV3,
} from './ConfidenceVotingV3';

import {
  refineAdaptiveEdgesV3,
} from './AdaptiveEdgeRefinerV3';

import {
  analyzeBackgroundUnderstandingV3,
} from './BackgroundUnderstandingV3';

import type {
  SegmentationRgbaImageSource,
} from './types';

import {
  applyBoundarySubPixelRefinementV3,
} from './BoundarySubPixelRefinerV3';

/* =========================================================
 * Public API
 * ======================================================= */

export type SegmentationPostprocessorV2Input = {
  decoderOutput:
    EdgeSamDecoderRawOutput;

  /**
   * الصورة بعد تصحيح EXIF وقبل Resize وLetterbox.
   */
  orientedImage: {
    width:
      number;

    height:
      number;

    rgba:
      Uint8Array;
  };

  transform:
    SegmentationTransform;

  config?:
    SegmentationModelConfig;

  requestId?:
    string;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

/**
 * Compatibility alias.
 *
 * يحافظ على اسم العقد القديم حتى لا ينكسر
 * SegmentationEngine أو أي Import موجود حاليًا.
 */
export type SegmentationPostprocessorInput =
  SegmentationPostprocessorV2Input;

/* =========================================================
 * Internal types
 * ======================================================= */

type MaskTensorShape = {
  batchSize:
    number;

  candidateCount:
    number;

  height:
    number;

  width:
    number;

  rank:
    number;

  pixelCount:
    number;
};

type CandidateMeasurements = {
  finiteRatio:
    number;

  foregroundRatio:
    number;

  uncertainRatio:
    number;

  borderForegroundRatio:
    number;

  centerForegroundRatio:
    number;

  contrastScore:
    number;

  occupancyScore:
    number;

  modelScore:
    number | null;

  largestComponentRatio:
    number;

  largestComponentTouchesBorder:
    boolean;

  componentCount:
    number;

  boundingBoxWidthRatio:
    number;

  boundingBoxHeightRatio:
    number;

  boundingBoxAreaRatio:
    number;

  aspectRatio:
    number;

  compactnessScore:
    number;

  edgeContactScore:
    number;

  shapeScore:
    number;

  fallbackScore:
    number;

  combinedScore:
    number;
};

type CandidateSelection = {
  candidateIndex:
    number;

  width:
    number;

  height:
    number;

  logits:
    Float32Array;

  modelScore:
    number | null;

  combinedScore:
    number;

  measurements:
    CandidateMeasurements;
};

type CandidateGeometryAnalysis = {
  largestComponentRatio:
    number;

  largestComponentTouchesBorder:
    boolean;

  componentCount:
    number;

  boundingBoxWidthRatio:
    number;

  boundingBoxHeightRatio:
    number;

  boundingBoxAreaRatio:
    number;

  aspectRatio:
    number;

  compactnessScore:
    number;

  edgeContactScore:
    number;

  shapeScore:
    number;
};

type BinaryConnectedComponent = {
  indexes:
    number[];

  area:
    number;

  minimumX:
    number;

  minimumY:
    number;

  maximumX:
    number;

  maximumY:
    number;

  touchesLeft:
    boolean;

  touchesTop:
    boolean;

  touchesRight:
    boolean;

  touchesBottom:
    boolean;

  touchesBorder:
    boolean;

  centroidX:
    number;

  centroidY:
    number;
};

type ConnectedComponentAnalysis = {
  components:
    BinaryConnectedComponent[];

  largestComponent:
    BinaryConnectedComponent | null;

  secondLargestComponent:
    BinaryConnectedComponent | null;

  significantComponentCount:
    number;

  foregroundPixelCount:
    number;
};

type NoiseRemovalResult = {
  mask:
    SegmentationFloatMask;

  removedComponentCount:
    number;

  removedPixelCount:
    number;

  retainedComponentCount:
    number;
};

type HoleFillingResult = {
  mask:
    SegmentationFloatMask;

  filledHoleCount:
    number;

  filledHolePixelCount:
    number;
};

type AdaptiveThresholdResult = {
  threshold:
    number;

  lower:
    number;

  upper:
    number;

  histogram:
    Uint32Array;

  foregroundRatio:
    number;

  confidence:
    number;
};

type MorphologyResult = {
  mask:
    SegmentationFloatMask;

  applied:
    boolean;

  operationCount:
    number;
};

type EdgeMap = {
  width:
    number;

  height:
    number;

  data:
    Float32Array;
};

type ImageGuidedPixel = {
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
};

type ImageGuidedColorModel = {
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

  sampleCount:
    number;

  variance:
    number;

  confidence:
    number;
};

type ImageGuidedBoundaryModels = {
  foreground:
    ImageGuidedColorModel;

  background:
    ImageGuidedColorModel;

  separation:
    number;

  usable:
    boolean;
};

type ForegroundVerificationResult = {
  mask:
    SegmentationFloatMask;

  seedPixelCount:
    number;

  acceptedPixelCount:
    number;

  removedPixelCount:
    number;

  applied:
    boolean;

  warnings:
    string[];
};

type ImageGuidedAnalysisImage = {
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

type ImageGuidedBoundaryRefinementResult = {
  mask:
    SegmentationFloatMask;

  applied:
    boolean;

  boundaryPixelCount:
    number;

  changedPixelCount:
    number;

  foregroundColorConfidence:
    number;

  backgroundColorConfidence:
    number;

  colorSeparation:
    number;

  averageBoundaryConfidence:
    number;

  warnings:
    string[];
};

type MaskProcessingContext = {
  requestId:
    string;

  startedAt:
    number;

  timings:
    SegmentationPostprocessTimings;

  config:
    SegmentationModelConfig;

  transform:
    SegmentationTransform;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;

  warnings:
    string[];

  removedComponentCount:
    number;

  removedPixelCount:
    number;

  filledHoleCount:
    number;

  filledHolePixelCount:
    number;

  morphologyApplied:
    boolean;

  edgeProtectionApplied:
    boolean;

  featherApplied:
    boolean;
};

/* =========================================================
 * Constants
 * ======================================================= */

const TOTAL_PIPELINE_STAGES =
  19 as const;

const MINIMUM_VALID_DIMENSION =
  1;

const MAXIMUM_SAFE_MASK_PIXELS =
  32_000_000;

const CANCELLATION_CHECK_INTERVAL =
  131_072;

const COMPONENT_CANCELLATION_INTERVAL =
  4096;

const ROW_CANCELLATION_INTERVAL =
  32;

const HISTOGRAM_BIN_COUNT =
  256;

const SIGMOID_POSITIVE_LIMIT =
  30;

const SIGMOID_NEGATIVE_LIMIT =
  -30;

const PROBABILITY_EPSILON =
  1e-6;

const STATISTICS_FOREGROUND_THRESHOLD =
  0.5;

const STATISTICS_FULLY_OPAQUE_THRESHOLD =
  0.999;

const STATISTICS_FULLY_TRANSPARENT_THRESHOLD =
  0.001;

const MINIMUM_SIGNIFICANT_COMPONENT_PIXELS =
  16;

const MINIMUM_SIGNIFICANT_COMPONENT_RATIO =
  0.00002;

const MAXIMUM_BLUR_RADIUS =
  12;

const MAXIMUM_MORPHOLOGY_RADIUS =
  4;

const DEFAULT_ADAPTIVE_THRESHOLD_MINIMUM =
  0.28;

const DEFAULT_ADAPTIVE_THRESHOLD_MAXIMUM =
  0.72;

const DEFAULT_ADAPTIVE_THRESHOLD_FALLBACK =
  0.5;

const DEFAULT_MINIMUM_FOREGROUND_RATIO =
  0.002;

const DEFAULT_MAXIMUM_FOREGROUND_RATIO =
  0.985;

const IMAGE_GUIDED_STRONG_FOREGROUND_THRESHOLD =
  0.82;

const IMAGE_GUIDED_STRONG_BACKGROUND_THRESHOLD =
  0.12;

const IMAGE_GUIDED_BOUNDARY_MINIMUM =
  0.035;

const IMAGE_GUIDED_BOUNDARY_MAXIMUM =
  0.965;

const IMAGE_GUIDED_MINIMUM_COLOR_SAMPLES =
  32;

const IMAGE_GUIDED_MAXIMUM_COLOR_SAMPLES =
  12_000;

const IMAGE_GUIDED_MINIMUM_COLOR_SEPARATION =
  0.045;

/* =========================================================
 * Timing
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function createEmptyTimings():
  SegmentationPostprocessTimings {
  return {
    readCandidatesMs:
      0,

    candidateSelectionMs:
      0,

    activationMs:
      0,

    normalizeMaskMs:
      0,

    removeLetterboxMs:
      0,

    removeNoiseMs:
      0,

    connectedComponentsMs:
      0,

    fillHolesMs:
      0,

    morphologyMs:
      0,

    thresholdMs:
      0,

    smoothingMs:
      0,

    featherMs:
      0,

    restoreOriginalSizeMs:
      0,

    protectEdgesMs:
      0,

    convertToAlphaMs:
      0,

    statisticsMs:
      0,

    totalMs:
      0,
  };
}

/* =========================================================
 * Progress
 * ======================================================= */

function emitProgress(
  context:
    MaskProcessingContext,
  stage:
    SegmentationProgressEvent[
      'stage'
    ],
  message:
    string
): void {
  context
    .cancellationSignal
    ?.throwIfCancelled();

  if (
    !context.onProgress
  ) {
    return;
  }

  try {
    context.onProgress({
      requestId:
        context.requestId,

      stage,

      stageNumber:
        SEGMENTATION_STAGE_INDEX[
          stage
        ],

      totalStages:
        TOTAL_PIPELINE_STAGES,

      progress:
        getSegmentationProgress(
          stage
        ),

      message,

      elapsedMs:
        Math.max(
          0,
          now() -
            context.startedAt
        ),
    });
  } catch (error) {
    console.log(
      'EDGESAM POSTPROCESSOR V2 PROGRESS CALLBACK ERROR:',
      error
    );
  }
}

/* =========================================================
 * Cancellation
 * ======================================================= */

function assertNotCancelled(
  signal?:
    SegmentationCancellationSignal
): void {
  signal
    ?.throwIfCancelled();
}

function assertLoopNotCancelled(
  index:
    number,
  signal?:
    SegmentationCancellationSignal,
  interval:
    number =
      CANCELLATION_CHECK_INTERVAL
): void {
  if (
    index %
      interval ===
    0
  ) {
    assertNotCancelled(
      signal
    );
  }
}

/* =========================================================
 * Numeric helpers
 * ======================================================= */

function clamp(
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

  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );
}

function safeDivide(
  numerator:
    number,
  denominator:
    number,
  fallback =
    0
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
    ) <=
      PROBABILITY_EPSILON
  ) {
    return fallback;
  }

  return (
    numerator /
    denominator
  );
}

function lerp(
  start:
    number,
  end:
    number,
  amount:
    number
): number {
  const safeAmount =
    clampUnitValue(
      amount
    );

  return (
    start +
    (
      end -
      start
    ) *
      safeAmount
  );
}

function smoothStep(
  edge0:
    number,
  edge1:
    number,
  value:
    number
): number {
  if (
    edge0 ===
    edge1
  ) {
    return value >=
      edge1
      ? 1
      : 0;
  }

  const normalized =
    clampUnitValue(
      (
        value -
        edge0
      ) /
      (
        edge1 -
        edge0
      )
    );

  return (
    normalized *
    normalized *
    (
      3 -
      2 *
        normalized
    )
  );
}

function sigmoid(
  value:
    number
): number {
  if (
    value >=
    SIGMOID_POSITIVE_LIMIT
  ) {
    return 1;
  }

  if (
    value <=
    SIGMOID_NEGATIVE_LIMIT
  ) {
    return 0;
  }

  return (
    1 /
    (
      1 +
      Math.exp(
        -value
      )
    )
  );
}

/* =========================================================
 * Warning helpers
 * ======================================================= */

function appendUniqueWarning(
  warnings:
    string[],
  warning:
    string
): void {
  const normalized =
    warning.trim();

  if (
    normalized.length ===
      0 ||
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

function appendUniqueWarnings(
  destination:
    string[],
  warnings:
    readonly string[]
): void {
  for (
    const warning of
      warnings
  ) {
    appendUniqueWarning(
      destination,
      warning
    );
  }
}

/* =========================================================
 * Validation
 * ======================================================= */

function assertPositiveInteger(
  value:
    number,
  fieldName:
    string,
  requestId?:
    string,
  stage:
    SegmentationProgressEvent[
      'stage'
    ] =
      'read-mask-candidates'
): void {
  if (
    !Number.isInteger(
      value
    ) ||
    value <
      MINIMUM_VALID_DIMENSION
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      `${fieldName} must be a positive integer.`,
      {
        requestId,

        component:
          'decoder',

        stage,

        retryable:
          false,

        metadata: {
          fieldName,

          value,
        },
      }
    );
  }
}

function assertSafeMaskSize(
  width:
    number,
  height:
    number,
  requestId?:
    string,
  stage:
    SegmentationProgressEvent[
      'stage'
    ] =
      'read-mask-candidates'
): void {
  assertPositiveInteger(
    width,
    'mask.width',
    requestId,
    stage
  );

  assertPositiveInteger(
    height,
    'mask.height',
    requestId,
    stage
  );

  const pixelCount =
    width *
    height;

  if (
    !Number.isSafeInteger(
      pixelCount
    ) ||
    pixelCount >
      MAXIMUM_SAFE_MASK_PIXELS
  ) {
    throw new SegmentationError(
      'OUT_OF_MEMORY',
      'The EdgeSAM mask is too large to process safely.',
      {
        requestId,

        component:
          'decoder',

        stage,

        retryable:
          false,

        metadata: {
          width,

          height,

          pixelCount,

          maximumSafeMaskPixels:
            MAXIMUM_SAFE_MASK_PIXELS,
        },
      }
    );
  }
}

function multiplyDimensions(
  dimensions:
    readonly number[],
  requestId?:
    string
): number {
  if (
    dimensions.length ===
    0
  ) {
    return 0;
  }

  let total =
    1;

  for (
    let index = 0;
    index <
      dimensions.length;
    index += 1
  ) {
    const dimension =
      dimensions[
        index
      ];

    if (
      !Number.isInteger(
        dimension
      ) ||
      dimension <=
        0
    ) {
      throw new SegmentationError(
        'INVALID_DECODER_OUTPUT',
        'EdgeSAM output contains an invalid tensor dimension.',
        {
          requestId,

          component:
            'decoder',

          stage:
            'read-mask-candidates',

          retryable:
            false,

          metadata: {
            dimension,

            dimensions:
              dimensions.join(
                'x'
              ),
          },
        }
      );
    }

    total *=
      dimension;

    if (
      !Number.isSafeInteger(
        total
      ) ||
      total >
        MAXIMUM_SAFE_MASK_PIXELS *
          64
    ) {
      throw new SegmentationError(
        'OUT_OF_MEMORY',
        'EdgeSAM output tensor is too large to process safely.',
        {
          requestId,

          component:
            'decoder',

          stage:
            'read-mask-candidates',

          retryable:
            false,

          metadata: {
            dimensions:
              dimensions.join(
                'x'
              ),

            calculatedElementCount:
              total,
          },
        }
      );
    }
  }

  return total;
}

/* =========================================================
 * Float mask helpers
 * ======================================================= */

function createFloatMask(
  width:
    number,
  height:
    number,
  data:
    Float32Array,
  requestId?:
    string,
  stage:
    SegmentationProgressEvent[
      'stage'
    ] =
      'refine-alpha-mask'
): SegmentationFloatMask {
  assertSafeMaskSize(
    width,
    height,
    requestId,
    stage
  );

  const expectedLength =
    width *
    height;

  if (
    data.length !==
    expectedLength
  ) {
    throw new SegmentationError(
      'MASK_INVALID',
      'Float mask data length does not match its dimensions.',
      {
        requestId,

        component:
          'decoder',

        stage,

        retryable:
          false,

        metadata: {
          width,

          height,

          expectedLength,

          actualLength:
            data.length,
        },
      }
    );
  }

  return {
    width,

    height,

    data,
  };
}

function cloneFloatMask(
  source:
    SegmentationFloatMask,
  requestId?:
    string,
  stage:
    SegmentationProgressEvent[
      'stage'
    ] =
      'refine-alpha-mask'
): SegmentationFloatMask {
  return createFloatMask(
    source.width,
    source.height,
    new Float32Array(
      source.data
    ),
    requestId,
    stage
  );
}

function assertMatchingMaskDimensions(
  first:
    SegmentationFloatMask,
  second:
    SegmentationFloatMask,
  requestId?:
    string,
  stage:
    SegmentationProgressEvent[
      'stage'
    ] =
      'refine-alpha-mask'
): void {
  if (
    first.width !==
      second.width ||
    first.height !==
      second.height
  ) {
    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      'Masks must have identical dimensions.',
      {
        requestId,

        component:
          'decoder',

        stage,

        retryable:
          false,

        metadata: {
          firstWidth:
            first.width,

          firstHeight:
            first.height,

          secondWidth:
            second.width,

          secondHeight:
            second.height,
        },
      }
    );
  }
}

/* =========================================================
 * Tensor conversion
 * ======================================================= */

function convertTensorToFloat32(
  tensor:
    SegmentationFloatTensor,
  requestId?:
    string
): Float32Array {
  if (
    tensor.data instanceof
    Float32Array
  ) {
    return tensor.data;
  }

  throw new SegmentationError(
    'INVALID_DECODER_OUTPUT',
    `EdgeSAM tensor "${tensor.name}" must contain Float32 data.`,
    {
      requestId,

      component:
        'decoder',

      stage:
        'read-mask-candidates',

      retryable:
        false,

      metadata: {
        tensorName:
          tensor.name,

        tensorDataType:
          tensor.dataType,
      },
    }
  );
}

/* =========================================================
 * Decoder tensor resolution
 * ======================================================= */

function resolveMasksTensor(
  decoderOutput:
    EdgeSamDecoderRawOutput,
  requestId:
    string
): SegmentationFloatTensor {
  if (
    decoderOutput
      .masksTensor
  ) {
    return decoderOutput
      .masksTensor;
  }

  if (
    decoderOutput
      .lowResolutionMasksTensor
  ) {
    return decoderOutput
      .lowResolutionMasksTensor;
  }

  throw new SegmentationError(
    'INVALID_DECODER_OUTPUT',
    'EdgeSAM decoder did not return a mask tensor.',
    {
      requestId,

      component:
        'decoder',

      stage:
        'read-mask-candidates',

      retryable:
        true,
    }
  );
}

function resolveScoresTensor(
  decoderOutput:
    EdgeSamDecoderRawOutput
): SegmentationFloatTensor | null {
  return (
    decoderOutput
      .scoresTensor ??
    null
  );
}

/* =========================================================
 * Tensor shape parsing
 * ======================================================= */

function parseMaskTensorShape(
  tensor:
    SegmentationFloatTensor,
  requestId?:
    string
): MaskTensorShape {
  const dimensions =
    Array.from(
      tensor.dimensions
    );

  if (
    dimensions.length <
      2 ||
    dimensions.length >
      4
  ) {
    throw new SegmentationError(
      'OUTPUT_SHAPE_UNSUPPORTED',
      'EdgeSAM mask output must contain between 2 and 4 dimensions.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'read-mask-candidates',

        retryable:
          false,

        metadata: {
          tensorName:
            tensor.name,

          dimensions:
            dimensions.join(
              'x'
            ),
        },
      }
    );
  }

  let batchSize =
    1;

  let candidateCount =
    1;

  let height =
    0;

  let width =
    0;

  if (
    dimensions.length ===
    4
  ) {
    batchSize =
      dimensions[0];

    candidateCount =
      dimensions[1];

    height =
      dimensions[2];

    width =
      dimensions[3];
  } else if (
    dimensions.length ===
    3
  ) {
    candidateCount =
      dimensions[0];

    height =
      dimensions[1];

    width =
      dimensions[2];
  } else {
    height =
      dimensions[0];

    width =
      dimensions[1];
  }

  if (
    batchSize !==
    1
  ) {
    throw new SegmentationError(
      'OUTPUT_SHAPE_UNSUPPORTED',
      'Only EdgeSAM batch size 1 is supported.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'read-mask-candidates',

        retryable:
          false,

        metadata: {
          batchSize,

          dimensions:
            dimensions.join(
              'x'
            ),
        },
      }
    );
  }

  assertPositiveInteger(
    candidateCount,
    'mask.candidateCount',
    requestId
  );

  assertSafeMaskSize(
    width,
    height,
    requestId
  );

  const expectedElementCount =
    multiplyDimensions(
      dimensions,
      requestId
    );

  if (
    tensor.data.length !==
    expectedElementCount
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      'EdgeSAM mask tensor length does not match its dimensions.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'read-mask-candidates',

        retryable:
          false,

        metadata: {
          tensorName:
            tensor.name,

          dimensions:
            dimensions.join(
              'x'
            ),

          expectedElementCount,

          actualElementCount:
            tensor.data.length,
        },
      }
    );
  }

  return {
    batchSize,

    candidateCount,

    height,

    width,

    rank:
      dimensions.length,

    pixelCount:
      width *
      height,
  };
}

/* =========================================================
 * Candidate extraction
 * ======================================================= */

function extractCandidateScores(
  scoresTensor:
    SegmentationFloatTensor | null,
  candidateCount:
    number,
  requestId?:
    string
): Float32Array | null {
  if (
    !scoresTensor
  ) {
    return null;
  }

  const data =
    convertTensorToFloat32(
      scoresTensor,
      requestId
    );

  if (
    data.length <
    candidateCount
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      'EdgeSAM score tensor contains fewer values than mask candidates.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          tensorName:
            scoresTensor.name,

          scoreCount:
            data.length,

          candidateCount,
        },
      }
    );
  }

  const scores =
    new Float32Array(
      candidateCount
    );

  for (
    let index = 0;
    index <
      candidateCount;
    index += 1
  ) {
    const value =
      data[index];

    scores[index] =
      Number.isFinite(
        value
      )
        ? value
        : Number
            .NEGATIVE_INFINITY;
  }

  return scores;
}

function extractCandidateLogits(
  maskData:
    Float32Array,
  shape:
    MaskTensorShape,
  candidateIndex:
    number,
  requestId?:
    string
): Float32Array {
  if (
    candidateIndex <
      0 ||
    candidateIndex >=
      shape.candidateCount
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      'Requested EdgeSAM mask candidate does not exist.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          candidateIndex,

          candidateCount:
            shape.candidateCount,
        },
      }
    );
  }

  const offset =
    candidateIndex *
    shape.pixelCount;

  const end =
    offset +
    shape.pixelCount;

  if (
    end >
    maskData.length
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      'EdgeSAM mask candidate exceeds the tensor data range.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'select-best-mask',

        retryable:
          false,

        metadata: {
          candidateIndex,

          offset,

          end,

          tensorLength:
            maskData.length,
        },
      }
    );
  }

  return maskData.subarray(
    offset,
    end
  );
}

/* =========================================================
 * Candidate geometry analysis
 * ======================================================= */

function analyzeCandidateGeometryV3(
  logits:
    Float32Array,
  width:
    number,
  height:
    number,
  foregroundBoundary:
    number,
  signal?:
    SegmentationCancellationSignal
): CandidateGeometryAnalysis {
  const pixelCount =
    width *
    height;

  if (
    width <=
      0 ||
    height <=
      0 ||
    pixelCount <=
      0 ||
    logits.length <
      pixelCount
  ) {
    return {
      largestComponentRatio:
        0,

      largestComponentTouchesBorder:
        false,

      componentCount:
        0,

      boundingBoxWidthRatio:
        0,

      boundingBoxHeightRatio:
        0,

      boundingBoxAreaRatio:
        0,

      aspectRatio:
        0,

      compactnessScore:
        0,

      edgeContactScore:
        0,

      shapeScore:
        0,
    };
  }

  const visited =
    new Uint8Array(
      pixelCount
    );

  const queue =
    new Int32Array(
      pixelCount
    );

  let totalForegroundCount =
    0;

  for (
    let index = 0;
    index <
      pixelCount;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      logits[index];

    if (
      Number.isFinite(
        value
      ) &&
      value >=
        foregroundBoundary
    ) {
      totalForegroundCount +=
        1;
    }
  }

  if (
    totalForegroundCount ===
    0
  ) {
    return {
      largestComponentRatio:
        0,

      largestComponentTouchesBorder:
        false,

      componentCount:
        0,

      boundingBoxWidthRatio:
        0,

      boundingBoxHeightRatio:
        0,

      boundingBoxAreaRatio:
        0,

      aspectRatio:
        0,

      compactnessScore:
        0,

      edgeContactScore:
        0,

      shapeScore:
        0,
    };
  }

  let componentCount =
    0;

  let largestArea =
    0;

  let largestMinimumX =
    0;

  let largestMinimumY =
    0;

  let largestMaximumX =
    0;

  let largestMaximumY =
    0;

  let largestTouchesBorder =
    false;

  let largestBorderPixelCount =
    0;

  const enqueueNeighbor = (
    neighborIndex:
      number,
    tail:
      number
  ): number => {
    if (
      neighborIndex <
        0 ||
      neighborIndex >=
        pixelCount ||
      visited[
        neighborIndex
      ] !==
        0
    ) {
      return tail;
    }

    const value =
      logits[
        neighborIndex
      ];

    if (
      !Number.isFinite(
        value
      ) ||
      value <
        foregroundBoundary
    ) {
      visited[
        neighborIndex
      ] =
        1;

      return tail;
    }

    visited[
      neighborIndex
    ] =
      1;

    queue[
      tail
    ] =
      neighborIndex;

    return (
      tail +
      1
    );
  };

  for (
    let startIndex = 0;
    startIndex <
      pixelCount;
    startIndex += 1
  ) {
    assertLoopNotCancelled(
      startIndex,
      signal
    );

    if (
      visited[
        startIndex
      ] !==
      0
    ) {
      continue;
    }

    const startValue =
      logits[
        startIndex
      ];

    if (
      !Number.isFinite(
        startValue
      ) ||
      startValue <
        foregroundBoundary
    ) {
      visited[
        startIndex
      ] =
        1;

      continue;
    }

    componentCount +=
      1;

    let head =
      0;

    let tail =
      0;

    queue[
      tail
    ] =
      startIndex;

    tail +=
      1;

    visited[
      startIndex
    ] =
      1;

    let area =
      0;

    let minimumX =
      width;

    let minimumY =
      height;

    let maximumX =
      0;

    let maximumY =
      0;

    let touchesBorder =
      false;

    let borderPixelCount =
      0;

    while (
      head <
      tail
    ) {
      if (
        head %
          COMPONENT_CANCELLATION_INTERVAL ===
        0
      ) {
        assertNotCancelled(
          signal
        );
      }

      const index =
        queue[
          head
        ];

      head +=
        1;

      const x =
        index %
        width;

      const y =
        Math.floor(
          index /
          width
        );

      area +=
        1;

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

      const onBorder =
        x ===
          0 ||
        y ===
          0 ||
        x ===
          width -
            1 ||
        y ===
          height -
            1;

      if (
        onBorder
      ) {
        touchesBorder =
          true;

        borderPixelCount +=
          1;
      }

      if (
        x >
        0
      ) {
        tail =
          enqueueNeighbor(
            index -
              1,
            tail
          );
      }

      if (
        x <
        width -
          1
      ) {
        tail =
          enqueueNeighbor(
            index +
              1,
            tail
          );
      }

      if (
        y >
        0
      ) {
        tail =
          enqueueNeighbor(
            index -
              width,
            tail
          );
      }

      if (
        y <
        height -
          1
      ) {
        tail =
          enqueueNeighbor(
            index +
              width,
            tail
          );
      }
    }

    if (
      area >
      largestArea
    ) {
      largestArea =
        area;

      largestMinimumX =
        minimumX;

      largestMinimumY =
        minimumY;

      largestMaximumX =
        maximumX;

      largestMaximumY =
        maximumY;

      largestTouchesBorder =
        touchesBorder;

      largestBorderPixelCount =
        borderPixelCount;
    }
  }

  if (
    largestArea <=
    0
  ) {
    return {
      largestComponentRatio:
        0,

      largestComponentTouchesBorder:
        false,

      componentCount,

      boundingBoxWidthRatio:
        0,

      boundingBoxHeightRatio:
        0,

      boundingBoxAreaRatio:
        0,

      aspectRatio:
        0,

      compactnessScore:
        0,

      edgeContactScore:
        0,

      shapeScore:
        0,
    };
  }

  const boundingBoxWidth =
    largestMaximumX -
    largestMinimumX +
    1;

  const boundingBoxHeight =
    largestMaximumY -
    largestMinimumY +
    1;

  const boundingBoxArea =
    boundingBoxWidth *
    boundingBoxHeight;

  const largestComponentRatio =
    safeDivide(
      largestArea,
      totalForegroundCount
    );

  const boundingBoxWidthRatio =
    safeDivide(
      boundingBoxWidth,
      width
    );

  const boundingBoxHeightRatio =
    safeDivide(
      boundingBoxHeight,
      height
    );

  const boundingBoxAreaRatio =
    safeDivide(
      boundingBoxArea,
      pixelCount
    );

  const aspectRatio =
    safeDivide(
      boundingBoxWidth,
      boundingBoxHeight
    );

  const compactnessScore =
    clampUnitValue(
      safeDivide(
        largestArea,
        boundingBoxArea
      )
    );

  const borderContactRatio =
    safeDivide(
      largestBorderPixelCount,
      largestArea
    );

  const edgeContactScore =
    clampUnitValue(
      1 -
      Math.min(
        1,
        borderContactRatio *
          12
      )
    );

  const componentCoherenceScore =
    clampUnitValue(
      largestComponentRatio
    );

  const fragmentationPenalty =
    clampUnitValue(
      Math.max(
        0,
        componentCount -
          1
      ) /
        8
    );

  const excessiveBoxPenalty =
    clampUnitValue(
      Math.max(
        0,
        boundingBoxAreaRatio -
          0.82
      ) /
        0.18
    );

  const shapeScore =
    clampUnitValue(
      componentCoherenceScore *
        0.38 +
      compactnessScore *
        0.27 +
      edgeContactScore *
        0.2 +
      (
        1 -
        fragmentationPenalty
      ) *
        0.1 +
      (
        1 -
        excessiveBoxPenalty
      ) *
        0.05
    );

  return {
    largestComponentRatio,

    largestComponentTouchesBorder:
      largestTouchesBorder,

    componentCount,

    boundingBoxWidthRatio,

    boundingBoxHeightRatio,

    boundingBoxAreaRatio,

    aspectRatio,

    compactnessScore,

    edgeContactScore,

    shapeScore,
  };
}

/* =========================================================
 * Candidate measurement helpers
 * ======================================================= */

function calculateBorderPixelCount(
  width:
    number,
  height:
    number,
  thickness:
    number
): number {
  const safeThickness =
    Math.max(
      1,
      Math.min(
        Math.floor(
          Math.min(
            width,
            height
          ) /
            2
        ),
        Math.round(
          thickness
        )
      )
    );

  const innerWidth =
    Math.max(
      0,
      width -
        safeThickness *
          2
    );

  const innerHeight =
    Math.max(
      0,
      height -
        safeThickness *
          2
    );

  return (
    width *
      height -
    innerWidth *
      innerHeight
  );
}

function createInvalidCandidateMeasurements(
  modelScore:
    number | null
): CandidateMeasurements {
  return {
    finiteRatio:
      0,

    foregroundRatio:
      0,

    uncertainRatio:
      1,

    borderForegroundRatio:
      1,

    centerForegroundRatio:
      0,

    contrastScore:
      0,

    occupancyScore:
      -1,

    modelScore,

    largestComponentRatio:
      0,

    largestComponentTouchesBorder:
      false,

    componentCount:
      0,

    boundingBoxWidthRatio:
      0,

    boundingBoxHeightRatio:
      0,

    boundingBoxAreaRatio:
      0,

    aspectRatio:
      0,

    compactnessScore:
      0,

    edgeContactScore:
      0,

    shapeScore:
      0,

    fallbackScore:
      Number.NEGATIVE_INFINITY,

    combinedScore:
      Number.NEGATIVE_INFINITY,
  };
}

function calculateCandidateMeasurements(
  logits:
    Float32Array,
  width:
    number,
  height:
    number,
  modelScore:
    number | null,
  signal?:
    SegmentationCancellationSignal
): CandidateMeasurements {
  if (
    logits.length ===
    0
  ) {
    return createInvalidCandidateMeasurements(
      modelScore
    );
  }

  let finiteMinimum =
    Number.POSITIVE_INFINITY;

  let finiteMaximum =
    Number.NEGATIVE_INFINITY;

  let finiteCount =
    0;

  for (
    let index = 0;
    index <
      logits.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      logits[
        index
      ];

    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    finiteMinimum =
      Math.min(
        finiteMinimum,
        value
      );

    finiteMaximum =
      Math.max(
        finiteMaximum,
        value
      );

    finiteCount +=
      1;
  }

  if (
    finiteCount ===
      0 ||
    !Number.isFinite(
      finiteMinimum
    ) ||
    !Number.isFinite(
      finiteMaximum
    )
  ) {
    return createInvalidCandidateMeasurements(
      modelScore
    );
  }

  const alreadyProbabilities =
    finiteMinimum >=
      0 &&
    finiteMaximum <=
      1;

  const foregroundBoundary =
    alreadyProbabilities
      ? 0.5
      : 0;

  const geometryAnalysis =
    analyzeCandidateGeometryV3(
      logits,
      width,
      height,
      foregroundBoundary,
      signal
    );

  const uncertainLower =
    alreadyProbabilities
      ? 0.38
      : -0.5;

  const uncertainUpper =
    alreadyProbabilities
      ? 0.62
      : 0.5;

  const borderThickness =
    Math.max(
      1,
      Math.round(
        Math.min(
          width,
          height
        ) *
          0.04
      )
    );

  const centerLeft =
    Math.round(
      width *
        0.2
    );

  const centerTop =
    Math.round(
      height *
        0.2
    );

  const centerRight =
    Math.round(
      width *
        0.8
    );

  const centerBottom =
    Math.round(
      height *
        0.8
    );

  let foregroundCount =
    0;

  let uncertainCount =
    0;

  let borderCount =
    0;

  let borderForegroundCount =
    0;

  let centerCount =
    0;

  let centerForegroundCount =
    0;

  let foregroundStrengthSum =
    0;

  let backgroundStrengthSum =
    0;

  let foregroundStrengthCount =
    0;

  let backgroundStrengthCount =
    0;

  for (
    let index = 0;
    index <
      logits.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      logits[
        index
      ];

    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    const foreground =
      value >=
      foregroundBoundary;

    let foregroundStrength:
      number;

    let backgroundStrength:
      number;

    if (
      alreadyProbabilities
    ) {
      foregroundStrength =
        foreground
          ? clampUnitValue(
              (
                value -
                0.5
              ) *
                2
            )
          : 0;

      backgroundStrength =
        !foreground
          ? clampUnitValue(
              (
                0.5 -
                value
              ) *
                2
            )
          : 0;
    } else {
      foregroundStrength =
        foreground
          ? clampUnitValue(
              value /
                4
            )
          : 0;

      backgroundStrength =
        !foreground
          ? clampUnitValue(
              Math.abs(
                value
              ) /
                4
            )
          : 0;
    }

    if (
      foreground
    ) {
      foregroundCount +=
        1;

      foregroundStrengthSum +=
        foregroundStrength;

      foregroundStrengthCount +=
        1;
    } else {
      backgroundStrengthSum +=
        backgroundStrength;

      backgroundStrengthCount +=
        1;
    }

    if (
      value >
        uncertainLower &&
      value <
        uncertainUpper
    ) {
      uncertainCount +=
        1;
    }

    const x =
      index %
      width;

    const y =
      Math.floor(
        index /
        width
      );

    const onBorder =
      x <
        borderThickness ||
      y <
        borderThickness ||
      x >=
        width -
          borderThickness ||
      y >=
        height -
          borderThickness;

    if (
      onBorder
    ) {
      borderCount +=
        1;

      if (
        foreground
      ) {
        borderForegroundCount +=
          1;
      }
    }

    const inCenter =
      x >=
        centerLeft &&
      x <
        centerRight &&
      y >=
        centerTop &&
      y <
        centerBottom;

    if (
      inCenter
    ) {
      centerCount +=
        1;

      if (
        foreground
      ) {
        centerForegroundCount +=
          1;
      }
    }
  }

  const finiteRatio =
    safeDivide(
      finiteCount,
      logits.length
    );

  const foregroundRatio =
    safeDivide(
      foregroundCount,
      finiteCount
    );

  const uncertainRatio =
    safeDivide(
      uncertainCount,
      finiteCount
    );

  const borderForegroundRatio =
    safeDivide(
      borderForegroundCount,
      borderCount
    );

  const centerForegroundRatio =
    safeDivide(
      centerForegroundCount,
      centerCount
    );

  const foregroundStrengthAverage =
    safeDivide(
      foregroundStrengthSum,
      foregroundStrengthCount
    );

  const backgroundStrengthAverage =
    safeDivide(
      backgroundStrengthSum,
      backgroundStrengthCount
    );

  const contrastScore =
    clampUnitValue(
      (
        foregroundStrengthAverage +
        backgroundStrengthAverage
      ) /
        2
    );

  let occupancyScore =
    0;

  if (
    foregroundRatio <=
      DEFAULT_MINIMUM_FOREGROUND_RATIO ||
    foregroundRatio >=
      DEFAULT_MAXIMUM_FOREGROUND_RATIO
  ) {
    occupancyScore =
      -1;
  } else {
    const preferredRatio =
      0.42;

    occupancyScore =
      clamp(
        1 -
          Math.abs(
            foregroundRatio -
              preferredRatio
          ) /
            0.58,
        -1,
        1
      );
  }

  const borderForegroundPenalty =
    clampUnitValue(
      borderForegroundRatio
    ) *
      0.4;

  const largestComponentBorderPenalty =
    geometryAnalysis
      .largestComponentTouchesBorder
      ? 0.18
      : 0;

  const edgeContactPenalty =
    (
      1 -
      clampUnitValue(
        geometryAnalysis
          .edgeContactScore
      )
    ) *
      0.12;

  const weakMainComponentPenalty =
    geometryAnalysis
      .largestComponentRatio <
      0.55
      ? clampUnitValue(
          (
            0.55 -
            geometryAnalysis
              .largestComponentRatio
          ) /
            0.55
        ) *
          0.12
      : 0;

  const fragmentationPenalty =
    geometryAnalysis
      .componentCount >
      2
      ? Math.min(
          0.14,
          (
            geometryAnalysis
              .componentCount -
            2
          ) *
            0.025
        )
      : 0;

  const oversizedBoundsPenalty =
    geometryAnalysis
      .boundingBoxWidthRatio >
      0.97 ||
    geometryAnalysis
      .boundingBoxHeightRatio >
      0.97
      ? 0.1
      : 0;

  const intrusiveObjectPenalty =
    geometryAnalysis
      .largestComponentTouchesBorder &&
    (
      geometryAnalysis
        .boundingBoxWidthRatio >
        0.82 ||
      geometryAnalysis
        .boundingBoxHeightRatio >
        0.82
    )
      ? 0.16
      : 0;

  const uncertaintyPenalty =
    clampUnitValue(
      uncertainRatio
    ) *
      0.24;

  const centerReward =
    clampUnitValue(
      centerForegroundRatio
    ) *
      0.12;

  const finiteReward =
    clampUnitValue(
      finiteRatio
    ) *
      0.08;

  const fallbackScore =
    occupancyScore *
      0.26 +
    contrastScore *
      0.14 +
    geometryAnalysis
      .shapeScore *
      0.28 +
    geometryAnalysis
      .compactnessScore *
      0.1 +
    centerReward +
    finiteReward -
    borderForegroundPenalty -
    largestComponentBorderPenalty -
    edgeContactPenalty -
    weakMainComponentPenalty -
    fragmentationPenalty -
    oversizedBoundsPenalty -
    intrusiveObjectPenalty -
    uncertaintyPenalty;

  const normalizedModelScore =
    modelScore !==
        null &&
      Number.isFinite(
        modelScore
      )
      ? modelScore >=
          0 &&
        modelScore <=
          1
        ? modelScore
        : sigmoid(
            modelScore
          )
      : null;

  const severeIntrusiveCandidate =
    geometryAnalysis
      .largestComponentTouchesBorder &&
    (
      geometryAnalysis
        .boundingBoxWidthRatio >
        0.9 ||
      geometryAnalysis
        .boundingBoxHeightRatio >
        0.9
    ) &&
    borderForegroundRatio >
      0.2;

  let combinedScore =
    normalizedModelScore !==
      null
      ? normalizedModelScore *
          0.52 +
        fallbackScore *
          0.48
      : fallbackScore;

  if (
    severeIntrusiveCandidate
  ) {
    combinedScore -=
      0.22;
  }

  if (
    geometryAnalysis
      .largestComponentRatio <
      0.35
  ) {
    combinedScore -=
      0.1;
  }

  if (
    finiteRatio <
    0.98
  ) {
    combinedScore -=
      (
        1 -
        finiteRatio
      ) *
        0.2;
  }

  return {
    finiteRatio,

    foregroundRatio,

    uncertainRatio,

    borderForegroundRatio,

    centerForegroundRatio,

    contrastScore,

    occupancyScore,

    modelScore,

    largestComponentRatio:
      geometryAnalysis
        .largestComponentRatio,

    largestComponentTouchesBorder:
      geometryAnalysis
        .largestComponentTouchesBorder,

    componentCount:
      geometryAnalysis
        .componentCount,

    boundingBoxWidthRatio:
      geometryAnalysis
        .boundingBoxWidthRatio,

    boundingBoxHeightRatio:
      geometryAnalysis
        .boundingBoxHeightRatio,

    boundingBoxAreaRatio:
      geometryAnalysis
        .boundingBoxAreaRatio,

    aspectRatio:
      geometryAnalysis
        .aspectRatio,

    compactnessScore:
      geometryAnalysis
        .compactnessScore,

    edgeContactScore:
      geometryAnalysis
        .edgeContactScore,

    shapeScore:
      geometryAnalysis
        .shapeScore,

    fallbackScore,

    combinedScore,
  };
}

/* =========================================================
 * Candidate selection V2 + Image-Guided V3
 * ======================================================= */

function selectBestMaskCandidateV2(
  masksTensor:
    SegmentationFloatTensor,
  scoresTensor:
    SegmentationFloatTensor | null,
  analysisImage:
    CandidateAnalysisImageV3,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): CandidateSelection {
  const shape =
    parseMaskTensorShape(
      masksTensor,
      requestId
    );

  const maskData =
    convertTensorToFloat32(
      masksTensor,
      requestId
    );

  const candidateScores =
    extractCandidateScores(
      scoresTensor,
      shape.candidateCount,
      requestId
    );

  const candidates:
    SegmentationFloatMask[] =
      [];

  const candidateSelections:
    CandidateSelection[] =
      [];

  for (
    let candidateIndex = 0;
    candidateIndex <
      shape.candidateCount;
    candidateIndex += 1
  ) {
    assertNotCancelled(
      signal
    );

    const logits =
      extractCandidateLogits(
        maskData,
        shape,
        candidateIndex,
        requestId
      );

    const rawModelScore =
      candidateScores
        ? candidateScores[
            candidateIndex
          ]
        : Number.NaN;

    const modelScore =
      Number.isFinite(
        rawModelScore
      )
        ? rawModelScore
        : null;

    const measurements =
      calculateCandidateMeasurements(
        logits,
        shape.width,
        shape.height,
        modelScore,
        signal
      );

    candidates.push({
      width:
        shape.width,

      height:
        shape.height,

      data:
        logits,
    });

    candidateSelections.push({
      candidateIndex,

      width:
        shape.width,

      height:
        shape.height,

      logits,

      modelScore,

      combinedScore:
        measurements
          .combinedScore,

      measurements,
    });
  }

  assertNotCancelled(
    signal
  );

  const imageGuidedResults =
    analyzeImageGuidedCandidatesV3({
      candidates,

      analysisImage,

      requestId,

      cancellationSignal:
        signal,

      continueOnCandidateError:
        true,
    });

  assertNotCancelled(
    signal
  );

  let bestSelection:
    CandidateSelection | null =
      null;

  for (
    let candidateIndex = 0;
    candidateIndex <
      candidateSelections.length;
    candidateIndex += 1
  ) {
    assertNotCancelled(
      signal
    );

    const selection =
      candidateSelections[
        candidateIndex
      ];

    const imageGuidedResult =
      imageGuidedResults[
        candidateIndex
      ];

    const legacyScore =
      clampUnitValue(
        selection
          .combinedScore
      );

    const hasUsableImageAnalysis =
      Boolean(
        imageGuidedResult &&
        imageGuidedResult
          .quality !==
          'invalid' &&
        Number.isFinite(
          imageGuidedResult
            .scores
            .finalImageScore
        )
      );

    const imageGuidedScore =
      hasUsableImageAnalysis
        ? clampUnitValue(
            imageGuidedResult
              .scores
              .finalImageScore
          )
        : legacyScore;

const suspectedBackgroundRatio =
  hasUsableImageAnalysis
    ? clampUnitValue(
        imageGuidedResult
          .measurements
          .interior
          .suspectedBackgroundRatio
      )
    : 0;

const leakageResistance =
  hasUsableImageAnalysis
    ? clampUnitValue(
        imageGuidedResult
          .scores
          .backgroundLeakageResistance
      )
    : 0;

const edgeAgreement =
  hasUsableImageAnalysis
    ? clampUnitValue(
        imageGuidedResult
          .scores
          .edgeAgreement
      )
    : 0;

let finalCombinedScore =
  hasUsableImageAnalysis
    ? (
        legacyScore *
          0.38 +
        imageGuidedScore *
          0.62
      )
    : legacyScore;

/*
 * التحليل غير الموثوق لا يجب أن ينافس
 * Mask موثوقة بنفس القوة.
 */
if (
  hasUsableImageAnalysis &&
  !imageGuidedResult.reliable
) {
  /*
   * Unreliable image analysis is only a weak negative signal.
   * It must not beat a geometrically/model-supported full item.
   */
  finalCombinedScore -=
    0.04;
}

/*
 * عقوبة قوية لتسريب الخلفية داخل الماسك.
 *
 * نبدأ العقوبة من 18% بدل 30%،
 * ونسمح لها بالوصول إلى 32%.
 */
if (
  hasUsableImageAnalysis &&
  imageGuidedResult.reliable &&
  suspectedBackgroundRatio >
    0.24
) {
  const leakagePenalty =
    Math.min(
      0.20,
      (
        suspectedBackgroundRatio -
        0.24
      ) *
        0.55
    );

  finalCombinedScore -=
    leakagePenalty;
}

/*
 * ضعف مقاومة تسريب الخلفية
 * دليل مباشر ضد الـCandidate.
 */
if (
  hasUsableImageAnalysis &&
  imageGuidedResult.reliable &&
  leakageResistance <
    0.42
) {
  const resistancePenalty =
    Math.min(
      0.10,
      (
        0.42 -
        leakageResistance
      ) *
        0.35
    );

  finalCombinedScore -=
    resistancePenalty;
}

/*
 * Candidate تحتوي نسبة كبيرة جدًا
 * من الخلفية لا نسمح لها بالفوز
 * اعتمادًا على Model Score القديم.
 */
if (
  hasUsableImageAnalysis &&
  imageGuidedResult.reliable &&
  suspectedBackgroundRatio >
    0.55
) {
  finalCombinedScore =
    Math.min(
      finalCombinedScore,
      0.50
    );
}

/*
 * مكافأة محدودة فقط عندما تتفق الحواف
 * وتكون مقاومة التسريب قوية والتحليل موثوقًا.
 */
if (
  hasUsableImageAnalysis &&
  imageGuidedResult.reliable &&
  edgeAgreement >=
    0.67 &&
  leakageResistance >=
    0.72
) {
  finalCombinedScore +=
    0.035;
}

finalCombinedScore =
  clampUnitValue(
    finalCombinedScore
  );

    const rankedSelection:
      CandidateSelection = {
      ...selection,

      combinedScore:
        finalCombinedScore,
    };

    if (
      !bestSelection ||
      rankedSelection
        .combinedScore >
        bestSelection
          .combinedScore
    ) {
      bestSelection =
        rankedSelection;
    }
  }

  if (
    !bestSelection ||
    !Number.isFinite(
      bestSelection
        .combinedScore
    )
  ) {
    throw new SegmentationError(
      'MASK_SELECTION_FAILED',
      'EdgeSAM did not return a usable mask candidate.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'select-best-mask',

        retryable:
          true,
      }
    );
  }

  return bestSelection;
}

/* =========================================================
 * Activation
 * ======================================================= */

function getFiniteValueRange(
  data:
    Float32Array,
  requestId?:
    string
): {
  minimum:
    number;

  maximum:
    number;
} {
  if (
    data.length ===
    0
  ) {
    throw new SegmentationError(
      'MASK_EMPTY',
      'The selected EdgeSAM mask candidate is empty.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'select-best-mask',

        retryable:
          true,
      }
    );
  }

  let minimum =
    Number.POSITIVE_INFINITY;

  let maximum =
    Number.NEGATIVE_INFINITY;

  for (
    let index = 0;
    index <
      data.length;
    index += 1
  ) {
    const value =
      data[
        index
      ];

    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

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
  }

  if (
    !Number.isFinite(
      minimum
    ) ||
    !Number.isFinite(
      maximum
    )
  ) {
    throw new SegmentationError(
      'INVALID_DECODER_OUTPUT',
      'The selected EdgeSAM mask contains no finite values.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'read-mask-candidates',

        retryable:
          false,
      }
    );
  }

  return {
    minimum,

    maximum,
  };
}

function activateMaskLogitsV2(
  source:
    Float32Array,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): Float32Array {
  const range =
    getFiniteValueRange(
      source,
      requestId
    );

  const alreadyProbabilities =
    range.minimum >=
      0 &&
    range.maximum <=
      1;

  const output =
    new Float32Array(
      source.length
    );

  for (
    let index = 0;
    index <
      source.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      source[
        index
      ];

    if (
      !Number.isFinite(
        value
      )
    ) {
      output[
        index
      ] =
        0;

      continue;
    }

    output[
      index
    ] =
      alreadyProbabilities
        ? clampUnitValue(
            value
          )
        : sigmoid(
            value
          );
  }

  return output;
}

/* =========================================================
 * Mask normalization
 * ======================================================= */

function normalizeProbabilityMask(
  source:
    SegmentationFloatMask,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  let minimum =
    Number.POSITIVE_INFINITY;

  let maximum =
    Number.NEGATIVE_INFINITY;

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      source.data[
        index
      ];

    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

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
  }

  if (
    !Number.isFinite(
      minimum
    ) ||
    !Number.isFinite(
      maximum
    )
  ) {
    throw new SegmentationError(
      'MASK_INVALID',
      'The probability mask contains no finite values.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'refine-alpha-mask',

        retryable:
          true,
      }
    );
  }

  const output =
    new Float32Array(
      source.data.length
    );

  const range =
    maximum -
    minimum;

  if (
    range <=
    PROBABILITY_EPSILON
  ) {
    const fallbackValue =
      maximum >=
        0.5
        ? 1
        : 0;

    output.fill(
      fallbackValue
    );

    return createFloatMask(
      source.width,
      source.height,
      output,
      requestId
    );
  }

  const alreadyNormalized =
    minimum >=
      0 &&
    maximum <=
      1;

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      source.data[
        index
      ];

    if (
      !Number.isFinite(
        value
      )
    ) {
      output[
        index
      ] =
        0;

      continue;
    }

    output[
      index
    ] =
      alreadyNormalized
        ? clampUnitValue(
            value
          )
        : clampUnitValue(
            (
              value -
              minimum
            ) /
              range
          );
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * Crop and letterbox removal
 * ======================================================= */

function cropFloatMask(
  source:
    SegmentationFloatMask,
  left:
    number,
  top:
    number,
  width:
    number,
  height:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const safeLeft =
    Math.max(
      0,
      Math.min(
        source.width -
          1,
        Math.round(
          left
        )
      )
    );

  const safeTop =
    Math.max(
      0,
      Math.min(
        source.height -
          1,
        Math.round(
          top
        )
      )
    );

  const safeWidth =
    Math.max(
      1,
      Math.min(
        source.width -
          safeLeft,
        Math.round(
          width
        )
      )
    );

  const safeHeight =
    Math.max(
      1,
      Math.min(
        source.height -
          safeTop,
        Math.round(
          height
        )
      )
    );

  const output =
    new Float32Array(
      safeWidth *
        safeHeight
    );

  for (
    let y = 0;
    y <
      safeHeight;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const sourceOffset =
      (
        safeTop +
        y
      ) *
        source.width +
      safeLeft;

    const destinationOffset =
      y *
      safeWidth;

    output.set(
      source.data.subarray(
        sourceOffset,
        sourceOffset +
          safeWidth
      ),
      destinationOffset
    );
  }

  return createFloatMask(
    safeWidth,
    safeHeight,
    output,
    requestId
  );
}

function removeLetterboxV2(
  source:
    SegmentationFloatMask,
  transform:
    SegmentationTransform,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const modelWidth =
    transform
      .modelInputSize
      .width;

  const modelHeight =
    transform
      .modelInputSize
      .height;

  assertPositiveInteger(
    modelWidth,
    'transform.modelInputSize.width',
    requestId
  );

  assertPositiveInteger(
    modelHeight,
    'transform.modelInputSize.height',
    requestId
  );

  const scaleX =
    source.width /
    modelWidth;

  const scaleY =
    source.height /
    modelHeight;

  const left =
    transform
      .padding
      .left *
    scaleX;

  const top =
    transform
      .padding
      .top *
    scaleY;

  const cropWidth =
    transform
      .resizedSize
      .width *
    scaleX;

  const cropHeight =
    transform
      .resizedSize
      .height *
    scaleY;

  return cropFloatMask(
    source,
    left,
    top,
    cropWidth,
    cropHeight,
    requestId,
    signal
  );
}

/* =========================================================
 * End of Final Part 1
 *
 * Part 2 يبدأ مباشرة من:
 *
 * function calculatePixelSaturationV2(
 * ======================================================= */
/* =========================================================
 * Image-guided boundary analysis
 * ======================================================= */

function calculatePixelSaturationV2(
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
    PROBABILITY_EPSILON
  ) {
    return 0;
  }

  return clampUnitValue(
    safeDivide(
      maximum -
        minimum,
      maximum,
      0
    )
  );
}

function calculateRgbDistanceV2(
  first:
    ImageGuidedPixel,
  second:
    ImageGuidedColorModel
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
    safeDivide(
      Math.sqrt(
        redDifference *
          redDifference +
        greenDifference *
          greenDifference +
        blueDifference *
          blueDifference
      ),
      Math.sqrt(
        3
      ),
      0
    )
  );
}

function readAnalysisPixelV2(
  image:
    ImageGuidedAnalysisImage,
  index:
    number
): ImageGuidedPixel {
  return {
    red:
      image.red[
        index
      ],

    green:
      image.green[
        index
      ],

    blue:
      image.blue[
        index
      ],

    luminance:
      image.luminance[
        index
      ],

    saturation:
      image.saturation[
        index
      ],
  };
}

function createImageGuidedColorModelV2(
  image:
    ImageGuidedAnalysisImage,
  sampleIndexes:
    readonly number[],
  signal?:
    SegmentationCancellationSignal
): ImageGuidedColorModel {
  if (
    sampleIndexes.length ===
    0
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

      sampleCount:
        0,

      variance:
        1,

      confidence:
        0,
    };
  }

  const samplingStep =
    Math.max(
      1,
      Math.ceil(
        sampleIndexes.length /
          IMAGE_GUIDED_MAXIMUM_COLOR_SAMPLES
      )
    );

  let redSum =
    0;

  let greenSum =
    0;

  let blueSum =
    0;

  let luminanceSum =
    0;

  let saturationSum =
    0;

  let sampleCount =
    0;

  for (
    let position = 0;
    position <
      sampleIndexes.length;
    position +=
      samplingStep
  ) {
    assertLoopNotCancelled(
      position,
      signal,
      4096
    );

    const index =
      sampleIndexes[
        position
      ];

    redSum +=
      image.red[
        index
      ];

    greenSum +=
      image.green[
        index
      ];

    blueSum +=
      image.blue[
        index
      ];

    luminanceSum +=
      image.luminance[
        index
      ];

    saturationSum +=
      image.saturation[
        index
      ];

    sampleCount +=
      1;
  }

  if (
    sampleCount ===
    0
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

      sampleCount:
        0,

      variance:
        1,

      confidence:
        0,
    };
  }

  const initialModel:
    ImageGuidedColorModel = {
    red:
      redSum /
      sampleCount,

    green:
      greenSum /
      sampleCount,

    blue:
      blueSum /
      sampleCount,

    luminance:
      luminanceSum /
      sampleCount,

    saturation:
      saturationSum /
      sampleCount,

    sampleCount,

    variance:
      0,

    confidence:
      0,
  };

  let weightedRedSum =
    0;

  let weightedGreenSum =
    0;

  let weightedBlueSum =
    0;

  let weightedLuminanceSum =
    0;

  let weightedSaturationSum =
    0;

  let totalWeight =
    0;

  let distanceSquaredSum =
    0;

  let weightedSampleCount =
    0;

  for (
    let position = 0;
    position <
      sampleIndexes.length;
    position +=
      samplingStep
  ) {
    assertLoopNotCancelled(
      position,
      signal,
      4096
    );

    const index =
      sampleIndexes[
        position
      ];

    const pixel =
      readAnalysisPixelV2(
        image,
        index
      );

    const distance =
      calculateRgbDistanceV2(
        pixel,
        initialModel
      );

    const weight =
      Math.max(
        0.08,
        1 -
          smoothStep(
            0.06,
            0.34,
            distance
          ) *
            0.92
      );

    weightedRedSum +=
      pixel.red *
      weight;

    weightedGreenSum +=
      pixel.green *
      weight;

    weightedBlueSum +=
      pixel.blue *
      weight;

    weightedLuminanceSum +=
      pixel.luminance *
      weight;

    weightedSaturationSum +=
      pixel.saturation *
      weight;

    totalWeight +=
      weight;

    distanceSquaredSum +=
      distance *
      distance;

    weightedSampleCount +=
      1;
  }

  const model:
    ImageGuidedColorModel = {
    red:
      safeDivide(
        weightedRedSum,
        totalWeight,
        initialModel.red
      ),

    green:
      safeDivide(
        weightedGreenSum,
        totalWeight,
        initialModel.green
      ),

    blue:
      safeDivide(
        weightedBlueSum,
        totalWeight,
        initialModel.blue
      ),

    luminance:
      safeDivide(
        weightedLuminanceSum,
        totalWeight,
        initialModel.luminance
      ),

    saturation:
      safeDivide(
        weightedSaturationSum,
        totalWeight,
        initialModel.saturation
      ),

    sampleCount:
      weightedSampleCount,

    variance:
      safeDivide(
        distanceSquaredSum,
        weightedSampleCount,
        1
      ),

    confidence:
      0,
  };

  model.confidence =
    clampUnitValue(
      clampUnitValue(
        safeDivide(
          model.sampleCount,
          320,
          0
        )
      ) *
        0.44 +
      clampUnitValue(
        1 -
          model.variance *
            12
      ) *
        0.56
    );

  return model;
}

function collectImageGuidedColorSamplesV2(
  mask:
    SegmentationFloatMask,
  signal?:
    SegmentationCancellationSignal
): {
  foregroundIndexes:
    number[];

  backgroundIndexes:
    number[];
} {
  const foregroundIndexes:
    number[] =
      [];

  const backgroundIndexes:
    number[] =
      [];

  for (
    let index = 0;
    index <
      mask.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      clampUnitValue(
        mask.data[
          index
        ]
      );

    if (
      value >=
      IMAGE_GUIDED_STRONG_FOREGROUND_THRESHOLD
    ) {
      foregroundIndexes.push(
        index
      );
    } else if (
      value <=
      IMAGE_GUIDED_STRONG_BACKGROUND_THRESHOLD
    ) {
      backgroundIndexes.push(
        index
      );
    }
  }

  return {
    foregroundIndexes,

    backgroundIndexes,
  };
}

function calculateColorModelDistanceV2(
  first:
    ImageGuidedColorModel,
  second:
    ImageGuidedColorModel
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

  const rgbDistance =
    safeDivide(
      Math.sqrt(
        redDifference *
          redDifference +
        greenDifference *
          greenDifference +
        blueDifference *
          blueDifference
      ),
      Math.sqrt(
        3
      ),
      0
    );

  const luminanceDistance =
    Math.abs(
      first.luminance -
      second.luminance
    );

  const saturationDistance =
    Math.abs(
      first.saturation -
      second.saturation
    );

  return clampUnitValue(
    rgbDistance *
      0.7 +
    luminanceDistance *
      0.2 +
    saturationDistance *
      0.1
  );
}

function createImageGuidedBoundaryModelsV2(
  mask:
    SegmentationFloatMask,
  image:
    ImageGuidedAnalysisImage,
  signal?:
    SegmentationCancellationSignal
): ImageGuidedBoundaryModels {
  const samples =
    collectImageGuidedColorSamplesV2(
      mask,
      signal
    );

  const foreground =
    createImageGuidedColorModelV2(
      image,
      samples.foregroundIndexes,
      signal
    );

  const background =
    createImageGuidedColorModelV2(
      image,
      samples.backgroundIndexes,
      signal
    );

  const separation =
    calculateColorModelDistanceV2(
      foreground,
      background
    );

  const usable =
    foreground.sampleCount >=
      IMAGE_GUIDED_MINIMUM_COLOR_SAMPLES &&
    background.sampleCount >=
      IMAGE_GUIDED_MINIMUM_COLOR_SAMPLES &&
    separation >=
      IMAGE_GUIDED_MINIMUM_COLOR_SEPARATION &&
    foreground.confidence >=
      0.2 &&
    background.confidence >=
      0.2;

  return {
    foreground,

    background,

    separation,

    usable,
  };
}

function readOrientedImagePixelV2(
  rgba:
    Uint8Array |
    Uint8ClampedArray,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number
): ImageGuidedPixel {
  const safeX =
    Math.max(
      0,
      Math.min(
        width -
          1,
        Math.round(
          x
        )
      )
    );

  const safeY =
    Math.max(
      0,
      Math.min(
        height -
          1,
        Math.round(
          y
        )
      )
    );

  const index =
    (
      safeY *
        width +
      safeX
    ) *
    4;

  const alpha =
    clampUnitValue(
      safeDivide(
        rgba[
          index +
          3
        ] ??
          255,
        255,
        1
      )
    );

  const red =
    clampUnitValue(
      safeDivide(
        rgba[
          index
        ] ??
          0,
        255,
        0
      ) *
        alpha
    );

  const green =
    clampUnitValue(
      safeDivide(
        rgba[
          index +
          1
        ] ??
          0,
        255,
        0
      ) *
        alpha
    );

  const blue =
    clampUnitValue(
      safeDivide(
        rgba[
          index +
          2
        ] ??
          0,
        255,
        0
      ) *
        alpha
    );

  const luminance =
    clampUnitValue(
      red *
        0.2126 +
      green *
        0.7152 +
      blue *
        0.0722
    );

  return {
    red,

    green,

    blue,

    luminance,

    saturation:
      calculatePixelSaturationV2(
        red,
        green,
        blue
      ),
  };
}

function createImageGuidedAnalysisImageV2(
  orientedImage:
    SegmentationPostprocessorV2Input[
      'orientedImage'
    ],
  destinationWidth:
    number,
  destinationHeight:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): ImageGuidedAnalysisImage {
  assertSafeMaskSize(
    destinationWidth,
    destinationHeight,
    requestId,
    'refine-alpha-mask'
  );

  const expectedLength =
    orientedImage.width *
    orientedImage.height *
    4;

  if (
    orientedImage.rgba.length !==
    expectedLength
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The oriented image RGBA data length is invalid.',
      {
        requestId,

        stage:
          'refine-alpha-mask',

        retryable:
          false,

        metadata: {
          width:
            orientedImage.width,

          height:
            orientedImage.height,

          expectedLength,

          actualLength:
            orientedImage
              .rgba.length,
        },
      }
    );
  }

  const pixelCount =
    destinationWidth *
    destinationHeight;

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

  const luminance =
    new Float32Array(
      pixelCount
    );

  const saturation =
    new Float32Array(
      pixelCount
    );

  const gradient =
    new Float32Array(
      pixelCount
    );

  const xScale =
    orientedImage.width /
    destinationWidth;

  const yScale =
    orientedImage.height /
    destinationHeight;

  for (
    let y = 0;
    y <
      destinationHeight;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const sourceY =
      (
        y +
        0.5
      ) *
        yScale -
      0.5;

    for (
      let x = 0;
      x <
        destinationWidth;
      x += 1
    ) {
      const sourceX =
        (
          x +
          0.5
        ) *
          xScale -
        0.5;

      const pixel =
        readOrientedImagePixelV2(
          orientedImage.rgba,
          orientedImage.width,
          orientedImage.height,
          sourceX,
          sourceY
        );

      const index =
        y *
          destinationWidth +
        x;

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
        pixel.luminance;

      saturation[
        index
      ] =
        pixel.saturation;
    }
  }

  for (
    let y = 0;
    y <
      destinationHeight;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const previousY =
      Math.max(
        0,
        y -
          1
      );

    const nextY =
      Math.min(
        destinationHeight -
          1,
        y +
          1
      );

    for (
      let x = 0;
      x <
        destinationWidth;
      x += 1
    ) {
      const previousX =
        Math.max(
          0,
          x -
            1
        );

      const nextX =
        Math.min(
          destinationWidth -
            1,
          x +
            1
        );

      const left =
        luminance[
          y *
            destinationWidth +
          previousX
        ];

      const right =
        luminance[
          y *
            destinationWidth +
          nextX
        ];

      const top =
        luminance[
          previousY *
            destinationWidth +
          x
        ];

      const bottom =
        luminance[
          nextY *
            destinationWidth +
          x
        ];

      const diagonalTopLeft =
        luminance[
          previousY *
            destinationWidth +
          previousX
        ];

      const diagonalTopRight =
        luminance[
          previousY *
            destinationWidth +
          nextX
        ];

      const diagonalBottomLeft =
        luminance[
          nextY *
            destinationWidth +
          previousX
        ];

      const diagonalBottomRight =
        luminance[
          nextY *
            destinationWidth +
          nextX
        ];

      const horizontalGradient =
        (
          right -
          left
        ) *
          0.5 +
        (
          diagonalTopRight +
          diagonalBottomRight -
          diagonalTopLeft -
          diagonalBottomLeft
        ) *
          0.25;

      const verticalGradient =
        (
          bottom -
          top
        ) *
          0.5 +
        (
          diagonalBottomLeft +
          diagonalBottomRight -
          diagonalTopLeft -
          diagonalTopRight
        ) *
          0.25;

      gradient[
        y *
          destinationWidth +
        x
      ] =
        clampUnitValue(
          Math.sqrt(
            horizontalGradient *
              horizontalGradient +
            verticalGradient *
              verticalGradient
          ) *
            2.4
        );
    }
  }

  return {
    width:
      destinationWidth,

    height:
      destinationHeight,

    red,

    green,

    blue,

    luminance,

    saturation,

    gradient,
  };
}

/* =========================================================
 * V3 image adapter
 * ======================================================= */

function createImageGuidedAnalysisImageV3Adapter(
  image:
    ImageGuidedAnalysisImage
): CandidateAnalysisImageV3 {
  return {
    width:
      image.width,

    height:
      image.height,

    red:
      image.red,

    green:
      image.green,

    blue:
      image.blue,

    luminance:
      image.luminance,

    saturation:
      image.saturation,

    gradient:
      image.gradient,
  };
}

function createBoundaryAnalysisImageV3(
  image:
    ImageGuidedAnalysisImage,
  signal?:
    SegmentationCancellationSignal
): BoundaryAnalysisImageV3 {
  const pixelCount =
    image.width *
    image.height;

  const rgb =
    new Float32Array(
      pixelCount *
        3
    );

  const gradientDirection =
    new Float32Array(
      pixelCount
    );

  for (
    let index = 0;
    index <
      pixelCount;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const rgbIndex =
      index *
      3;

    rgb[
      rgbIndex
    ] =
      image.red[
        index
      ];

    rgb[
      rgbIndex +
        1
    ] =
      image.green[
        index
      ];

    rgb[
      rgbIndex +
        2
    ] =
      image.blue[
        index
      ];

    const x =
      index %
      image.width;

    const y =
      Math.floor(
        index /
        image.width
      );

    const leftX =
      Math.max(
        0,
        x -
          1
      );

    const rightX =
      Math.min(
        image.width -
          1,
        x +
          1
      );

    const topY =
      Math.max(
        0,
        y -
          1
      );

    const bottomY =
      Math.min(
        image.height -
          1,
        y +
          1
      );

    const horizontalGradient =
      image.luminance[
        y *
          image.width +
        rightX
      ] -
      image.luminance[
        y *
          image.width +
        leftX
      ];

    const verticalGradient =
      image.luminance[
        bottomY *
          image.width +
        x
      ] -
      image.luminance[
        topY *
          image.width +
        x
      ];

    gradientDirection[
      index
    ] =
      Math.atan2(
        verticalGradient,
        horizontalGradient
      );
  }

  return {
    width:
      image.width,

    height:
      image.height,

    rgb,

    luminance:
      image.luminance,

    gradient:
      image.gradient,

    gradientDirection,
  };
}

/* =========================================================
 * Image-guided boundary refinement V2
 * ======================================================= */

function refineBoundaryUsingImageGuidanceV2(
  mask:
    SegmentationFloatMask,
  image:
    ImageGuidedAnalysisImage,
  models:
    ImageGuidedBoundaryModels,
  signal?:
    SegmentationCancellationSignal
): ImageGuidedBoundaryRefinementResult {
  if (
    mask.width !==
      image.width ||
    mask.height !==
      image.height
  ) {
    return {
      mask:
        cloneFloatMask(
          mask
        ),

      applied:
        false,

      boundaryPixelCount:
        0,

      changedPixelCount:
        0,

      foregroundColorConfidence:
        models.foreground
          .confidence,

      backgroundColorConfidence:
        models.background
          .confidence,

      colorSeparation:
        models.separation,

      averageBoundaryConfidence:
        0,

      warnings: [
        'Image-guided refinement skipped because image and mask dimensions differ.',
      ],
    };
  }

  if (
    !models.usable
  ) {
    return {
      mask:
        cloneFloatMask(
          mask
        ),

      applied:
        false,

      boundaryPixelCount:
        0,

      changedPixelCount:
        0,

      foregroundColorConfidence:
        models.foreground
          .confidence,

      backgroundColorConfidence:
        models.background
          .confidence,

      colorSeparation:
        models.separation,

      averageBoundaryConfidence:
        0,

      warnings: [
        'Image-guided refinement skipped because foreground and background are not sufficiently distinguishable.',
      ],
    };
  }

  const width =
    mask.width;

  const height =
    mask.height;

  const output =
    new Float32Array(
      mask.data
    );

  let boundaryPixelCount =
    0;

  let changedPixelCount =
    0;

  let confidenceSum =
    0;

  for (
    let y = 1;
    y <
      height -
        1;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    for (
      let x = 1;
      x <
        width -
          1;
      x += 1
    ) {
      const index =
        y *
          width +
        x;

      const originalValue =
        clampUnitValue(
          mask.data[
            index
          ]
        );

      const leftValue =
        mask.data[
          index -
            1
        ];

      const rightValue =
        mask.data[
          index +
            1
        ];

      const topValue =
        mask.data[
          index -
            width
        ];

      const bottomValue =
        mask.data[
          index +
            width
        ];

      const localMinimum =
        Math.min(
          originalValue,
          leftValue,
          rightValue,
          topValue,
          bottomValue
        );

      const localMaximum =
        Math.max(
          originalValue,
          leftValue,
          rightValue,
          topValue,
          bottomValue
        );

      const crossesBoundary =
        localMinimum <
          0.5 &&
        localMaximum >=
          0.5;

      const insideTransitionBand =
        originalValue >
          IMAGE_GUIDED_BOUNDARY_MINIMUM &&
        originalValue <
          IMAGE_GUIDED_BOUNDARY_MAXIMUM;

      if (
        !crossesBoundary &&
        !insideTransitionBand
      ) {
        continue;
      }

      boundaryPixelCount +=
        1;

      const pixel =
        readAnalysisPixelV2(
          image,
          index
        );

      const foregroundDistance =
        calculateRgbDistanceV2(
          pixel,
          models.foreground
        );

      const backgroundDistance =
        calculateRgbDistanceV2(
          pixel,
          models.background
        );

      const foregroundProbability =
        clampUnitValue(
          safeDivide(
            backgroundDistance,
            foregroundDistance +
              backgroundDistance,
            originalValue
          )
        );

      const edgeStrength =
        clampUnitValue(
          image.gradient[
            index
          ] *
            2.1
        );

      const separationStrength =
        clampUnitValue(
          models.separation *
            2.2
        );

      const correctionWeight =
        clampUnitValue(
          separationStrength *
            (
              0.42 +
              edgeStrength *
                0.28
            )
        );

      const refinedValue =
        clampUnitValue(
          lerp(
            originalValue,
            foregroundProbability,
            correctionWeight
          )
        );

      output[
        index
      ] =
        refinedValue;

      confidenceSum +=
        clampUnitValue(
          separationStrength *
            0.62 +
          edgeStrength *
            0.38
        );

      if (
        Math.abs(
          refinedValue -
            originalValue
        ) >
        0.015
      ) {
        changedPixelCount +=
          1;
      }
    }
  }

  return {
    mask:
      createFloatMask(
        width,
        height,
        output
      ),

    applied:
      changedPixelCount >
      0,

    boundaryPixelCount,

    changedPixelCount,

    foregroundColorConfidence:
      models.foreground
        .confidence,

    backgroundColorConfidence:
      models.background
        .confidence,

    colorSeparation:
      models.separation,

    averageBoundaryConfidence:
      safeDivide(
        confidenceSum,
        boundaryPixelCount,
        0
      ),

    warnings:
      [],
  };
}

/* =========================================================
 * Bilinear resize
 * ======================================================= */

function resizeFloatMaskBilinearV2(
  source:
    SegmentationFloatMask,
  destinationWidth:
    number,
  destinationHeight:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  assertSafeMaskSize(
    destinationWidth,
    destinationHeight,
    requestId,
    'restore-original-size'
  );

  if (
    source.width ===
      destinationWidth &&
    source.height ===
      destinationHeight
  ) {
    return cloneFloatMask(
      source,
      requestId,
      'restore-original-size'
    );
  }

  const output =
    new Float32Array(
      destinationWidth *
        destinationHeight
    );

  const xScale =
    source.width /
    destinationWidth;

  const yScale =
    source.height /
    destinationHeight;

  for (
    let destinationY = 0;
    destinationY <
      destinationHeight;
    destinationY += 1
  ) {
    if (
      destinationY %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const sourceY =
      (
        destinationY +
        0.5
      ) *
        yScale -
      0.5;

    const clampedY =
      clamp(
        sourceY,
        0,
        source.height -
          1
      );

    const y0 =
      Math.floor(
        clampedY
      );

    const y1 =
      Math.min(
        source.height -
          1,
        y0 +
          1
      );

    const yFraction =
      clampedY -
      y0;

    for (
      let destinationX = 0;
      destinationX <
        destinationWidth;
      destinationX += 1
    ) {
      const sourceX =
        (
          destinationX +
          0.5
        ) *
          xScale -
        0.5;

      const clampedX =
        clamp(
          sourceX,
          0,
          source.width -
            1
        );

      const x0 =
        Math.floor(
          clampedX
        );

      const x1 =
        Math.min(
          source.width -
            1,
          x0 +
            1
        );

      const xFraction =
        clampedX -
        x0;

      const topLeft =
        source.data[
          y0 *
            source.width +
          x0
        ];

      const topRight =
        source.data[
          y0 *
            source.width +
          x1
        ];

      const bottomLeft =
        source.data[
          y1 *
            source.width +
          x0
        ];

      const bottomRight =
        source.data[
          y1 *
            source.width +
          x1
        ];

      const topValue =
        lerp(
          topLeft,
          topRight,
          xFraction
        );

      const bottomValue =
        lerp(
          bottomLeft,
          bottomRight,
          xFraction
        );

      output[
        destinationY *
          destinationWidth +
        destinationX
      ] =
        clampUnitValue(
          lerp(
            topValue,
            bottomValue,
            yFraction
          )
        );
    }
  }

  return createFloatMask(
    destinationWidth,
    destinationHeight,
    output,
    requestId,
    'restore-original-size'
  );
}

/* =========================================================
 * Histogram and adaptive threshold
 * ======================================================= */

function createProbabilityHistogram(
  source:
    SegmentationFloatMask,
  signal?:
    SegmentationCancellationSignal
): Uint32Array {
  const histogram =
    new Uint32Array(
      HISTOGRAM_BIN_COUNT
    );

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      clampUnitValue(
        source.data[
          index
        ]
      );

    const bin =
      Math.min(
        HISTOGRAM_BIN_COUNT -
          1,
        Math.floor(
          value *
            (
              HISTOGRAM_BIN_COUNT -
              1
            )
        )
      );

    histogram[
      bin
    ] +=
      1;
  }

  return histogram;
}

function calculateOtsuThreshold(
  histogram:
    Uint32Array,
  pixelCount:
    number
): number {
  if (
    pixelCount <=
    0
  ) {
    return DEFAULT_ADAPTIVE_THRESHOLD_FALLBACK;
  }

  let totalWeightedSum =
    0;

  for (
    let index = 0;
    index <
      histogram.length;
    index += 1
  ) {
    totalWeightedSum +=
      index *
      histogram[
        index
      ];
  }

  let backgroundWeight =
    0;

  let backgroundWeightedSum =
    0;

  let maximumVariance =
    -1;

  let selectedBin =
    Math.round(
      DEFAULT_ADAPTIVE_THRESHOLD_FALLBACK *
        (
          HISTOGRAM_BIN_COUNT -
          1
        )
    );

  for (
    let thresholdBin = 0;
    thresholdBin <
      histogram.length;
    thresholdBin += 1
  ) {
    backgroundWeight +=
      histogram[
        thresholdBin
      ];

    if (
      backgroundWeight ===
      0
    ) {
      continue;
    }

    const foregroundWeight =
      pixelCount -
      backgroundWeight;

    if (
      foregroundWeight ===
      0
    ) {
      break;
    }

    backgroundWeightedSum +=
      thresholdBin *
      histogram[
        thresholdBin
      ];

    const backgroundMean =
      backgroundWeightedSum /
      backgroundWeight;

    const foregroundMean =
      (
        totalWeightedSum -
        backgroundWeightedSum
      ) /
      foregroundWeight;

    const meanDifference =
      backgroundMean -
      foregroundMean;

    const betweenClassVariance =
      backgroundWeight *
      foregroundWeight *
      meanDifference *
      meanDifference;

    if (
      betweenClassVariance >
      maximumVariance
    ) {
      maximumVariance =
        betweenClassVariance;

      selectedBin =
        thresholdBin;
    }
  }

  return clampUnitValue(
    selectedBin /
      (
        HISTOGRAM_BIN_COUNT -
        1
      )
  );
}

function calculateThresholdForegroundRatio(
  source:
    SegmentationFloatMask,
  threshold:
    number,
  signal?:
    SegmentationCancellationSignal
): number {
  let foregroundPixels =
    0;

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    if (
      source.data[
        index
      ] >=
      threshold
    ) {
      foregroundPixels +=
        1;
    }
  }

  return safeDivide(
    foregroundPixels,
    source.data.length
  );
}

function calculateAdaptiveThresholdV2(
  source:
    SegmentationFloatMask,
  configuredThreshold:
    number,
  softThresholdWidth:
    number,
  signal?:
    SegmentationCancellationSignal
): AdaptiveThresholdResult {
  const histogram =
    createProbabilityHistogram(
      source,
      signal
    );

  const otsuThreshold =
    calculateOtsuThreshold(
      histogram,
      source.data.length
    );

  const safeConfiguredThreshold =
    clampUnitValue(
      configuredThreshold
    );

  let threshold =
    lerp(
      safeConfiguredThreshold,
      otsuThreshold,
      0.58
    );

  threshold =
    clamp(
      threshold,
      DEFAULT_ADAPTIVE_THRESHOLD_MINIMUM,
      DEFAULT_ADAPTIVE_THRESHOLD_MAXIMUM
    );

  let foregroundRatio =
    calculateThresholdForegroundRatio(
      source,
      threshold,
      signal
    );

  if (
    foregroundRatio <
    DEFAULT_MINIMUM_FOREGROUND_RATIO
  ) {
    threshold =
      Math.max(
        DEFAULT_ADAPTIVE_THRESHOLD_MINIMUM,
        threshold -
          0.08
      );

    foregroundRatio =
      calculateThresholdForegroundRatio(
        source,
        threshold,
        signal
      );
  } else if (
    foregroundRatio >
    DEFAULT_MAXIMUM_FOREGROUND_RATIO
  ) {
    threshold =
      Math.min(
        DEFAULT_ADAPTIVE_THRESHOLD_MAXIMUM,
        threshold +
          0.08
      );

    foregroundRatio =
      calculateThresholdForegroundRatio(
        source,
        threshold,
        signal
      );
  }

  const safeSoftWidth =
    clamp(
      softThresholdWidth,
      0,
      1
    );

  const halfWidth =
    safeSoftWidth /
    2;

  const lower =
    clampUnitValue(
      threshold -
        halfWidth
    );

  const upper =
    clampUnitValue(
      threshold +
        halfWidth
    );

  const distanceFromConfigured =
    Math.abs(
      threshold -
        safeConfiguredThreshold
    );

  const confidence =
    clampUnitValue(
      1 -
        distanceFromConfigured *
          1.5
    );

  return {
    threshold,

    lower,

    upper,

    histogram,

    foregroundRatio,

    confidence,
  };
}

function applyAdaptiveSoftThreshold(
  source:
    SegmentationFloatMask,
  adaptive:
    AdaptiveThresholdResult,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const output =
    new Float32Array(
      source.data.length
    );

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    output[
      index
    ] =
      smoothStep(
        adaptive.lower,
        adaptive.upper,
        source.data[
          index
        ]
      );
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * Binary mask helpers
 * ======================================================= */

function createBinaryMask(
  source:
    SegmentationFloatMask,
  threshold:
    number,
  signal?:
    SegmentationCancellationSignal
): Uint8Array {
  const output =
    new Uint8Array(
      source.data.length
    );

  const safeThreshold =
    clampUnitValue(
      threshold
    );

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    output[
      index
    ] =
      source.data[
        index
      ] >=
      safeThreshold
        ? 1
        : 0;
  }

  return output;
}

function getFourConnectedNeighbors(
  index:
    number,
  width:
    number,
  height:
    number,
  output:
    number[]
): void {
  output.length =
    0;

  const x =
    index %
    width;

  const y =
    Math.floor(
      index /
      width
    );

  if (
    x >
    0
  ) {
    output.push(
      index -
        1
    );
  }

  if (
    x <
    width -
      1
  ) {
    output.push(
      index +
        1
    );
  }

  if (
    y >
    0
  ) {
    output.push(
      index -
        width
    );
  }

  if (
    y <
    height -
      1
  ) {
    output.push(
      index +
        width
    );
  }
}

function collectConnectedComponentV2(
  binary:
    Uint8Array,
  visited:
    Uint8Array,
  startIndex:
    number,
  width:
    number,
  height:
    number,
  targetValue:
    0 | 1,
  signal?:
    SegmentationCancellationSignal
): BinaryConnectedComponent {
  const stack:
    number[] = [
      startIndex,
    ];

  const indexes:
    number[] =
      [];

  const reusableNeighbors:
    number[] =
      [];

  let minimumX =
    width;

  let minimumY =
    height;

  let maximumX =
    0;

  let maximumY =
    0;

  let touchesLeft =
    false;

  let touchesTop =
    false;

  let touchesRight =
    false;

  let touchesBottom =
    false;

  let sumX =
    0;

  let sumY =
    0;

  visited[
    startIndex
  ] =
    1;

  while (
    stack.length >
    0
  ) {
    assertLoopNotCancelled(
      indexes.length,
      signal,
      COMPONENT_CANCELLATION_INTERVAL
    );

    const current =
      stack.pop();

    if (
      current ===
      undefined
    ) {
      break;
    }

    indexes.push(
      current
    );

    const x =
      current %
      width;

    const y =
      Math.floor(
        current /
        width
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

    sumX +=
      x;

    sumY +=
      y;

    if (
      x ===
      0
    ) {
      touchesLeft =
        true;
    }

    if (
      y ===
      0
    ) {
      touchesTop =
        true;
    }

    if (
      x ===
      width -
        1
    ) {
      touchesRight =
        true;
    }

    if (
      y ===
      height -
        1
    ) {
      touchesBottom =
        true;
    }

    getFourConnectedNeighbors(
      current,
      width,
      height,
      reusableNeighbors
    );

    for (
      let neighborIndex = 0;
      neighborIndex <
        reusableNeighbors.length;
      neighborIndex += 1
    ) {
      const neighbor =
        reusableNeighbors[
          neighborIndex
        ];

      if (
        visited[
          neighbor
        ] ===
          0 &&
        binary[
          neighbor
        ] ===
          targetValue
      ) {
        visited[
          neighbor
        ] =
          1;

        stack.push(
          neighbor
        );
      }
    }
  }

  const area =
    indexes.length;

  return {
    indexes,

    area,

    minimumX,

    minimumY,

    maximumX,

    maximumY,

    touchesLeft,

    touchesTop,

    touchesRight,

    touchesBottom,

    touchesBorder:
      touchesLeft ||
      touchesTop ||
      touchesRight ||
      touchesBottom,

    centroidX:
      area >
        0
        ? sumX /
          area
        : 0,

    centroidY:
      area >
        0
        ? sumY /
          area
        : 0,
  };
}

function analyzeConnectedComponentsV2(
  binary:
    Uint8Array,
  width:
    number,
  height:
    number,
  targetValue:
    0 | 1,
  signal?:
    SegmentationCancellationSignal
): ConnectedComponentAnalysis {
  const visited =
    new Uint8Array(
      binary.length
    );

  const components:
    BinaryConnectedComponent[] =
      [];

  let foregroundPixelCount =
    0;

  for (
    let index = 0;
    index <
      binary.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal,
      65_536
    );

    if (
      visited[
        index
      ] !==
        0 ||
      binary[
        index
      ] !==
        targetValue
    ) {
      continue;
    }

    const component =
      collectConnectedComponentV2(
        binary,
        visited,
        index,
        width,
        height,
        targetValue,
        signal
      );

    components.push(
      component
    );

    foregroundPixelCount +=
      component.area;
  }

  components.sort(
    (
      first,
      second
    ) =>
      second.area -
      first.area
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

  const pixelCount =
    width *
    height;

  const minimumSignificantArea =
    Math.max(
      MINIMUM_SIGNIFICANT_COMPONENT_PIXELS,
      Math.round(
        pixelCount *
          MINIMUM_SIGNIFICANT_COMPONENT_RATIO
      )
    );

  let significantComponentCount =
    0;

  for (
    let index = 0;
    index <
      components.length;
    index += 1
  ) {
    if (
      components[
        index
      ].area >=
      minimumSignificantArea
    ) {
      significantComponentCount +=
        1;
    }
  }

  return {
    components,

    largestComponent,

    secondLargestComponent,

    significantComponentCount,

    foregroundPixelCount,
  };
}

/* =========================================================
 * Main component maps for V3
 * ======================================================= */

function createMainComponentMapV3(
  mask:
    SegmentationFloatMask,
  threshold:
    number,
  signal?:
    SegmentationCancellationSignal
): Uint8Array {
  const binary =
    createBinaryMask(
      mask,
      threshold,
      signal
    );

  const analysis =
    analyzeConnectedComponentsV2(
      binary,
      mask.width,
      mask.height,
      1,
      signal
    );

  const output =
    new Uint8Array(
      mask.data.length
    );

  const largestComponent =
    analysis
      .largestComponent;

  if (
    !largestComponent
  ) {
    return output;
  }

  for (
    let index = 0;
    index <
      largestComponent
        .indexes
        .length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal,
      COMPONENT_CANCELLATION_INTERVAL
    );

    output[
      largestComponent
        .indexes[
          index
        ]
    ] =
      1;
  }

  return output;
}

/* =========================================================
 * End of Final Part 2
 *
 * Part 3 يبدأ مباشرة من:
 *
 * function calculateComponentRetentionScore(
 * ======================================================= */
/* =========================================================
 * Connected Components V2 - foreground cleanup
 * ======================================================= */

function calculateComponentRetentionScore(
  component:
    BinaryConnectedComponent,
  largestArea:
    number,
  width:
    number,
  height:
    number
): number {
  if (
    component.area <=
      0 ||
    largestArea <=
      0
  ) {
    return 0;
  }

  const relativeArea =
    component.area /
    largestArea;

  const componentWidth =
    component.maximumX -
    component.minimumX +
    1;

  const componentHeight =
    component.maximumY -
    component.minimumY +
    1;

  const boxArea =
    componentWidth *
    componentHeight;

  const density =
    safeDivide(
      component.area,
      boxArea
    );

  const imageCenterX =
    (
      width -
      1
    ) /
    2;

  const imageCenterY =
    (
      height -
      1
    ) /
    2;

  const normalizedDistance =
    Math.sqrt(
      Math.pow(
        safeDivide(
          component.centroidX -
            imageCenterX,
          Math.max(
            1,
            width
          )
        ),
        2
      ) +
      Math.pow(
        safeDivide(
          component.centroidY -
            imageCenterY,
          Math.max(
            1,
            height
          )
        ),
        2
      )
    );

  const centerScore =
    clampUnitValue(
      1 -
        normalizedDistance *
          2
    );

  const borderPenalty =
    component.touchesBorder
      ? 0.12
      : 0;

  return clampUnitValue(
    relativeArea *
      0.62 +
    density *
      0.18 +
    centerScore *
      0.2 -
    borderPenalty
  );
}

function removeNoiseConnectedComponentsV2(
  source:
    SegmentationFloatMask,
  threshold:
    number,
  minimumComponentArea:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): NoiseRemovalResult {
  const binary =
    createBinaryMask(
      source,
      threshold,
      signal
    );

  const analysis =
    analyzeConnectedComponentsV2(
      binary,
      source.width,
      source.height,
      1,
      signal
    );

  if (
    !analysis
      .largestComponent ||
    analysis
      .components
      .length ===
      0
  ) {
    return {
      mask:
        cloneFloatMask(
          source,
          requestId
        ),

      removedComponentCount:
        0,

      removedPixelCount:
        0,

      retainedComponentCount:
        0,
    };
  }

  const output =
    new Float32Array(
      source.data
    );

  const largestArea =
    analysis
      .largestComponent
      .area;

  const safeMinimumArea =
    Math.max(
      1,
      Math.round(
        minimumComponentArea
      )
    );

  let removedComponentCount =
    0;

  let removedPixelCount =
    0;

  let retainedComponentCount =
    0;

  for (
    let componentIndex = 0;
    componentIndex <
      analysis
        .components
        .length;
    componentIndex += 1
  ) {
    assertLoopNotCancelled(
      componentIndex,
      signal,
      64
    );

    const component =
      analysis.components[
        componentIndex
      ];

    const relativeArea =
      component.area /
      largestArea;

    const retentionScore =
      calculateComponentRetentionScore(
        component,
        largestArea,
        source.width,
        source.height
      );

    const isLargest =
      componentIndex ===
      0;

    const passesAbsoluteArea =
      component.area >=
      safeMinimumArea;

    const passesRelativeArea =
      relativeArea >=
      0.025;

    const likelyFineDetail =
      component.area >=
        Math.max(
          4,
          safeMinimumArea *
            0.3
        ) &&
      retentionScore >=
        0.12;

    const retain =
      isLargest ||
      passesAbsoluteArea ||
      passesRelativeArea ||
      likelyFineDetail;

    if (
      retain
    ) {
      retainedComponentCount +=
        1;

      continue;
    }

    removedComponentCount +=
      1;

    removedPixelCount +=
      component.area;

    for (
      let pixelIndex = 0;
      pixelIndex <
        component
          .indexes
          .length;
      pixelIndex += 1
    ) {
      output[
        component.indexes[
          pixelIndex
        ]
      ] =
        0;
    }
  }

  return {
    mask:
      createFloatMask(
        source.width,
        source.height,
        output,
        requestId
      ),

    removedComponentCount,

    removedPixelCount,

    retainedComponentCount,
  };
}

/* =========================================================
 * Hole Filling V2
 * ======================================================= */

function fillBackgroundHolesV2(
  source:
    SegmentationFloatMask,
  threshold:
    number,
  maximumHoleArea:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): HoleFillingResult {
  if (
    maximumHoleArea <=
    0
  ) {
    return {
      mask:
        cloneFloatMask(
          source,
          requestId
        ),

      filledHoleCount:
        0,

      filledHolePixelCount:
        0,
    };
  }

  const binary =
    createBinaryMask(
      source,
      threshold,
      signal
    );

  const analysis =
    analyzeConnectedComponentsV2(
      binary,
      source.width,
      source.height,
      0,
      signal
    );

  const output =
    new Float32Array(
      source.data
    );

  const safeMaximumHoleArea =
    Math.max(
      1,
      Math.round(
        maximumHoleArea
      )
    );

  let filledHoleCount =
    0;

  let filledHolePixelCount =
    0;

  for (
    let componentIndex = 0;
    componentIndex <
      analysis
        .components
        .length;
    componentIndex += 1
  ) {
    assertLoopNotCancelled(
      componentIndex,
      signal,
      64
    );

    const component =
      analysis.components[
        componentIndex
      ];

    if (
      component
        .touchesBorder
    ) {
      continue;
    }

    if (
      component.area >
      safeMaximumHoleArea
    ) {
      continue;
    }

    filledHoleCount +=
      1;

    filledHolePixelCount +=
      component.area;

    for (
      let pixelIndex = 0;
      pixelIndex <
        component
          .indexes
          .length;
      pixelIndex += 1
    ) {
      const index =
        component.indexes[
          pixelIndex
        ];

      output[
        index
      ] =
        1;
    }
  }

  return {
    mask:
      createFloatMask(
        source.width,
        source.height,
        output,
        requestId
      ),

    filledHoleCount,

    filledHolePixelCount,
  };
}

/* =========================================================
 * Binary morphology helpers
 * ======================================================= */

function calculateMorphologyRadius(
  source:
    SegmentationFloatMask,
  configuredRadius:
    number
): number {
  if (
    !Number.isFinite(
      configuredRadius
    ) ||
    configuredRadius <=
      0
  ) {
    return 0;
  }

  const dimensionScale =
    Math.min(
      source.width,
      source.height
    ) /
    512;

  const scaledRadius =
    configuredRadius *
    Math.max(
      0.75,
      dimensionScale
    );

  return Math.max(
    1,
    Math.min(
      MAXIMUM_MORPHOLOGY_RADIUS,
      Math.round(
        scaledRadius
      )
    )
  );
}

function dilateBinaryMask(
  source:
    Uint8Array,
  width:
    number,
  height:
    number,
  radius:
    number,
  signal?:
    SegmentationCancellationSignal
): Uint8Array {
  if (
    radius <=
    0
  ) {
    return new Uint8Array(
      source
    );
  }

  const output =
    new Uint8Array(
      source.length
    );

  for (
    let y = 0;
    y <
      height;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    for (
      let x = 0;
      x <
        width;
      x += 1
    ) {
      let foundForeground =
        false;

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
          maximumY &&
        !foundForeground;
        sampleY += 1
      ) {
        const rowOffset =
          sampleY *
          width;

        for (
          let sampleX =
            minimumX;
          sampleX <=
            maximumX;
          sampleX += 1
        ) {
          if (
            source[
              rowOffset +
              sampleX
            ] !==
            0
          ) {
            foundForeground =
              true;

            break;
          }
        }
      }

      output[
        y *
          width +
        x
      ] =
        foundForeground
          ? 1
          : 0;
    }
  }

  return output;
}

function erodeBinaryMask(
  source:
    Uint8Array,
  width:
    number,
  height:
    number,
  radius:
    number,
  signal?:
    SegmentationCancellationSignal
): Uint8Array {
  if (
    radius <=
    0
  ) {
    return new Uint8Array(
      source
    );
  }

  const output =
    new Uint8Array(
      source.length
    );

  for (
    let y = 0;
    y <
      height;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    for (
      let x = 0;
      x <
        width;
      x += 1
    ) {
      let allForeground =
        true;

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
          maximumY &&
        allForeground;
        sampleY += 1
      ) {
        const rowOffset =
          sampleY *
          width;

        for (
          let sampleX =
            minimumX;
          sampleX <=
            maximumX;
          sampleX += 1
        ) {
          if (
            source[
              rowOffset +
              sampleX
            ] ===
            0
          ) {
            allForeground =
              false;

            break;
          }
        }
      }

      output[
        y *
          width +
        x
      ] =
        allForeground
          ? 1
          : 0;
    }
  }

  return output;
}

function mergeBinaryShapeWithProbabilities(
  binary:
    Uint8Array,
  reference:
    SegmentationFloatMask,
  threshold:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const output =
    new Float32Array(
      reference.data.length
    );

  const safeThreshold =
    clampUnitValue(
      threshold
    );

  for (
    let index = 0;
    index <
      output.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const referenceValue =
      clampUnitValue(
        reference.data[
          index
        ]
      );

    if (
      binary[
        index
      ] !==
      0
    ) {
      output[
        index
      ] =
        Math.max(
          referenceValue,
          safeThreshold
        );
    } else {
      output[
        index
      ] =
        Math.min(
          referenceValue,
          safeThreshold *
            0.45
        );
    }
  }

  return createFloatMask(
    reference.width,
    reference.height,
    output,
    requestId
  );
}

/* =========================================================
 * Smart Morphology V2
 * ======================================================= */

function applySmartMorphologyV2(
  source:
    SegmentationFloatMask,
  threshold:
    number,
  configuredRadius:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): MorphologyResult {
  const radius =
    calculateMorphologyRadius(
      source,
      configuredRadius
    );

  if (
    radius <=
    0
  ) {
    return {
      mask:
        cloneFloatMask(
          source,
          requestId
        ),

      applied:
        false,

      operationCount:
        0,
    };
  }

  const binary =
    createBinaryMask(
      source,
      threshold,
      signal
    );

  const analysis =
    analyzeConnectedComponentsV2(
      binary,
      source.width,
      source.height,
      1,
      signal
    );

  const foregroundRatio =
    safeDivide(
      analysis
        .foregroundPixelCount,
      binary.length
    );

  let processedBinary:
    Uint8Array;

  if (
    analysis
      .significantComponentCount >
      1 &&
    foregroundRatio <
      0.72
  ) {
    const dilated =
      dilateBinaryMask(
        binary,
        source.width,
        source.height,
        radius,
        signal
      );

    processedBinary =
      erodeBinaryMask(
        dilated,
        source.width,
        source.height,
        radius,
        signal
      );

    return {
      mask:
        mergeBinaryShapeWithProbabilities(
          processedBinary,
          source,
          threshold,
          requestId,
          signal
        ),

      applied:
        true,

      operationCount:
        2,
    };
  }

  if (
    foregroundRatio >
    0.84
  ) {
    const eroded =
      erodeBinaryMask(
        binary,
        source.width,
        source.height,
        radius,
        signal
      );

    processedBinary =
      dilateBinaryMask(
        eroded,
        source.width,
        source.height,
        radius,
        signal
      );

    return {
      mask:
        mergeBinaryShapeWithProbabilities(
          processedBinary,
          source,
          threshold,
          requestId,
          signal
        ),

      applied:
        true,

      operationCount:
        2,
    };
  }

  return {
    mask:
      cloneFloatMask(
        source,
        requestId
      ),

    applied:
      false,

    operationCount:
      0,
  };
}

/* =========================================================
 * Box blur
 * ======================================================= */

function calculateBlurRadius(
  value:
    number
): number {
  if (
    !Number.isFinite(
      value
    ) ||
    value <=
      0
  ) {
    return 0;
  }

  return Math.max(
    1,
    Math.min(
      MAXIMUM_BLUR_RADIUS,
      Math.round(
        value
      )
    )
  );
}

function horizontalBoxBlur(
  source:
    Float32Array,
  width:
    number,
  height:
    number,
  radius:
    number,
  signal?:
    SegmentationCancellationSignal
): Float32Array {
  if (
    radius <=
    0
  ) {
    return new Float32Array(
      source
    );
  }

  const output =
    new Float32Array(
      source.length
    );

  const windowSize =
    radius *
      2 +
    1;

  for (
    let y = 0;
    y <
      height;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const rowOffset =
      y *
      width;

    let runningSum =
      0;

    for (
      let offset =
        -radius;
      offset <=
        radius;
      offset += 1
    ) {
      const sampleX =
        Math.max(
          0,
          Math.min(
            width -
              1,
            offset
          )
        );

      runningSum +=
        source[
          rowOffset +
          sampleX
        ];
    }

    for (
      let x = 0;
      x <
        width;
      x += 1
    ) {
      output[
        rowOffset +
        x
      ] =
        runningSum /
        windowSize;

      const removeX =
        Math.max(
          0,
          Math.min(
            width -
              1,
            x -
              radius
          )
        );

      const addX =
        Math.max(
          0,
          Math.min(
            width -
              1,
            x +
              radius +
              1
          )
        );

      runningSum -=
        source[
          rowOffset +
          removeX
        ];

      runningSum +=
        source[
          rowOffset +
          addX
        ];
    }
  }

  return output;
}

function verticalBoxBlur(
  source:
    Float32Array,
  width:
    number,
  height:
    number,
  radius:
    number,
  signal?:
    SegmentationCancellationSignal
): Float32Array {
  if (
    radius <=
    0
  ) {
    return new Float32Array(
      source
    );
  }

  const output =
    new Float32Array(
      source.length
    );

  const windowSize =
    radius *
      2 +
    1;

  for (
    let x = 0;
    x <
      width;
    x += 1
  ) {
    if (
      x %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    let runningSum =
      0;

    for (
      let offset =
        -radius;
      offset <=
        radius;
      offset += 1
    ) {
      const sampleY =
        Math.max(
          0,
          Math.min(
            height -
              1,
            offset
          )
        );

      runningSum +=
        source[
          sampleY *
            width +
          x
        ];
    }

    for (
      let y = 0;
      y <
        height;
      y += 1
    ) {
      output[
        y *
          width +
        x
      ] =
        runningSum /
        windowSize;

      const removeY =
        Math.max(
          0,
          Math.min(
            height -
              1,
            y -
              radius
          )
        );

      const addY =
        Math.max(
          0,
          Math.min(
            height -
              1,
            y +
              radius +
              1
          )
        );

      runningSum -=
        source[
          removeY *
            width +
          x
        ];

      runningSum +=
        source[
          addY *
            width +
          x
        ];
    }
  }

  return output;
}

function applyBoxBlurV2(
  source:
    SegmentationFloatMask,
  radius:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const safeRadius =
    calculateBlurRadius(
      radius
    );

  if (
    safeRadius <=
    0
  ) {
    return cloneFloatMask(
      source,
      requestId
    );
  }

  const horizontal =
    horizontalBoxBlur(
      source.data,
      source.width,
      source.height,
      safeRadius,
      signal
    );

  const vertical =
    verticalBoxBlur(
      horizontal,
      source.width,
      source.height,
      safeRadius,
      signal
    );

  return createFloatMask(
    source.width,
    source.height,
    vertical,
    requestId
  );
}

/* =========================================================
 * Edge map
 * ======================================================= */

function calculateLocalEdgeMagnitude(
  data:
    Float32Array,
  width:
    number,
  height:
    number,
  x:
    number,
  y:
    number
): number {
  const leftX =
    Math.max(
      0,
      x -
        1
    );

  const rightX =
    Math.min(
      width -
        1,
      x +
        1
    );

  const topY =
    Math.max(
      0,
      y -
        1
    );

  const bottomY =
    Math.min(
      height -
        1,
      y +
        1
    );

  const left =
    data[
      y *
        width +
      leftX
    ];

  const right =
    data[
      y *
        width +
      rightX
    ];

  const top =
    data[
      topY *
        width +
      x
    ];

  const bottom =
    data[
      bottomY *
        width +
      x
    ];

  const horizontal =
    right -
    left;

  const vertical =
    bottom -
    top;

  return clampUnitValue(
    Math.sqrt(
      horizontal *
        horizontal +
      vertical *
        vertical
    )
  );
}

function createEdgeMapV2(
  source:
    SegmentationFloatMask,
  signal?:
    SegmentationCancellationSignal
): EdgeMap {
  const output =
    new Float32Array(
      source.data.length
    );

  for (
    let y = 0;
    y <
      source.height;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    for (
      let x = 0;
      x <
        source.width;
      x += 1
    ) {
      const index =
        y *
          source.width +
        x;

      output[
        index
      ] =
        calculateLocalEdgeMagnitude(
          source.data,
          source.width,
          source.height,
          x,
          y
        );
    }
  }

  return {
    width:
      source.width,

    height:
      source.height,

    data:
      output,
  };
}

/* =========================================================
 * Shadow Suppression V2
 * ======================================================= */

function suppressSoftBackgroundShadowsV2(
  source:
    SegmentationFloatMask,
  adaptiveThreshold:
    AdaptiveThresholdResult,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const output =
    new Float32Array(
      source.data.length
    );

  const threshold =
    adaptiveThreshold
      .threshold;

  const shadowUpper =
    Math.max(
      0.08,
      threshold *
        0.76
    );

  const shadowLower =
    Math.max(
      0,
      shadowUpper -
        0.24
    );

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      clampUnitValue(
        source.data[
          index
        ]
      );

    if (
      value >=
      threshold
    ) {
      output[
        index
      ] =
        value;

      continue;
    }

    if (
      value <=
      shadowLower
    ) {
      output[
        index
      ] =
        value *
        0.08;

      continue;
    }

    const survival =
      smoothStep(
        shadowLower,
        shadowUpper,
        value
      );

    output[
      index
    ] =
      value *
      survival *
      0.72;
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * Detail Recovery V2
 * ======================================================= */

function recoverFineDetailsV2(
  processed:
    SegmentationFloatMask,
  reference:
    SegmentationFloatMask,
  threshold:
    number,
  strength:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  assertMatchingMaskDimensions(
    processed,
    reference,
    requestId
  );

  const safeStrength =
    clampUnitValue(
      strength
    );

  if (
    safeStrength <=
    0
  ) {
    return cloneFloatMask(
      processed,
      requestId
    );
  }

  const referenceEdges =
    createEdgeMapV2(
      reference,
      signal
    );

  const output =
    new Float32Array(
      processed.data.length
    );

  const recoveryFloor =
    Math.max(
      0.08,
      threshold -
        0.22
    );

  for (
    let index = 0;
    index <
      output.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const processedValue =
      clampUnitValue(
        processed.data[
          index
        ]
      );

    const referenceValue =
      clampUnitValue(
        reference.data[
          index
        ]
      );

    const edgeStrength =
      clampUnitValue(
        referenceEdges
          .data[
            index
          ] *
          2.2
      );

    const recoverable =
      smoothStep(
        recoveryFloor,
        threshold +
          0.08,
        referenceValue
      );

    const recoveryWeight =
      edgeStrength *
      recoverable *
      safeStrength;

    output[
      index
    ] =
      clampUnitValue(
        Math.max(
          processedValue,
          lerp(
            processedValue,
            referenceValue,
            recoveryWeight
          )
        )
      );
  }

  return createFloatMask(
    processed.width,
    processed.height,
    output,
    requestId
  );
}

/* =========================================================
 * Alpha Refinement V2
 * ======================================================= */

function refineAlphaCurveV2(
  source:
    SegmentationFloatMask,
  threshold:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const output =
    new Float32Array(
      source.data.length
    );

  const safeThreshold =
    clampUnitValue(
      threshold
    );

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      clampUnitValue(
        source.data[
          index
        ]
      );

    let refinedValue:
      number;

    if (
      value <=
      safeThreshold
    ) {
      const normalized =
        safeDivide(
          value,
          Math.max(
            safeThreshold,
            PROBABILITY_EPSILON
          )
        );

      refinedValue =
        Math.pow(
          normalized,
          1.35
        ) *
        safeThreshold;
    } else {
      const normalized =
        safeDivide(
          value -
            safeThreshold,
          Math.max(
            1 -
              safeThreshold,
            PROBABILITY_EPSILON
          )
        );

      refinedValue =
        safeThreshold +
        (
          1 -
          Math.pow(
            1 -
              normalized,
            1.18
          )
        ) *
          (
            1 -
            safeThreshold
          );
    }

    output[
      index
    ] =
      clampUnitValue(
        refinedValue
      );
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * End of Final Part 3
 *
 * Part 4 يبدأ مباشرة من:
 *
 * function applyEdgeAwareSmoothingV2(
 * ======================================================= */
/* =========================================================
 * Edge-aware smoothing
 * ======================================================= */

function applyEdgeAwareSmoothingV2(
  source:
    SegmentationFloatMask,
  reference:
    SegmentationFloatMask,
  radius:
    number,
  strength:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  assertMatchingMaskDimensions(
    source,
    reference,
    requestId
  );

  const safeRadius =
    calculateBlurRadius(
      radius
    );

  const safeStrength =
    clampUnitValue(
      strength
    );

  if (
    safeRadius <=
      0 ||
    safeStrength <=
      0
  ) {
    return cloneFloatMask(
      source,
      requestId
    );
  }

  const blurred =
    applyBoxBlurV2(
      source,
      safeRadius,
      requestId,
      signal
    );

  const edgeMap =
    createEdgeMapV2(
      reference,
      signal
    );

  const output =
    new Float32Array(
      source.data.length
    );

  for (
    let index = 0;
    index <
      output.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const edgeProtection =
      clampUnitValue(
        edgeMap.data[
          index
        ] *
          2.4
      );

    const blurWeight =
      safeStrength *
      (
        1 -
        edgeProtection
      );

    output[
      index
    ] =
      clampUnitValue(
        lerp(
          source.data[
            index
          ],
          blurred.data[
            index
          ],
          blurWeight
        )
      );
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * Edge-aware Feather V2
 * ======================================================= */

function applyEdgeAwareFeatherV2(
  source:
    SegmentationFloatMask,
  reference:
    SegmentationFloatMask,
  radius:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  assertMatchingMaskDimensions(
    source,
    reference,
    requestId
  );

  const safeRadius =
    calculateBlurRadius(
      radius
    );

  if (
    safeRadius <=
    0
  ) {
    return cloneFloatMask(
      source,
      requestId
    );
  }

  const blurred =
    applyBoxBlurV2(
      source,
      safeRadius,
      requestId,
      signal
    );

  const edgeMap =
    createEdgeMapV2(
      reference,
      signal
    );

  const output =
    new Float32Array(
      source.data.length
    );

  for (
    let index = 0;
    index <
      output.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const sourceValue =
      clampUnitValue(
        source.data[
          index
        ]
      );

    const referenceValue =
      clampUnitValue(
        reference.data[
          index
        ]
      );

    const blurredValue =
      clampUnitValue(
        blurred.data[
          index
        ]
      );

    const edgeStrength =
      clampUnitValue(
        edgeMap.data[
          index
        ] *
          2
      );

    const transitionWeight =
      1 -
      Math.abs(
        sourceValue *
          2 -
        1
      );

    const featherWeight =
      clampUnitValue(
        transitionWeight *
          (
            0.4 +
            edgeStrength *
              0.6
          )
      );

    const protectedReference =
      Math.max(
        blurredValue,
        referenceValue *
          edgeStrength
      );

    output[
      index
    ] =
      clampUnitValue(
        lerp(
          sourceValue,
          protectedReference,
          featherWeight
        )
      );
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * Anti Halo V2
 * ======================================================= */

function applyAntiHaloV2(
  source:
    SegmentationFloatMask,
  reference:
    SegmentationFloatMask,
  threshold:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  assertMatchingMaskDimensions(
    source,
    reference,
    requestId
  );

  const output =
    new Float32Array(
      source.data.length
    );

  const safeThreshold =
    clampUnitValue(
      threshold
    );

  const haloLimit =
    Math.max(
      0.04,
      safeThreshold *
        0.72
    );

  for (
    let y = 0;
    y <
      source.height;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    for (
      let x = 0;
      x <
        source.width;
      x += 1
    ) {
      const index =
        y *
          source.width +
        x;

      const value =
        clampUnitValue(
          source.data[
            index
          ]
        );

      const referenceValue =
        clampUnitValue(
          reference.data[
            index
          ]
        );

      if (
        value <=
          0 ||
        value >=
          0.98
      ) {
        output[
          index
        ] =
          value;

        continue;
      }

      let neighborMaximum =
        0;

      let neighborAverage =
        0;

      let neighborCount =
        0;

      const minimumY =
        Math.max(
          0,
          y -
            1
        );

      const maximumY =
        Math.min(
          source.height -
            1,
          y +
            1
        );

      const minimumX =
        Math.max(
          0,
          x -
            1
        );

      const maximumX =
        Math.min(
          source.width -
            1,
          x +
            1
        );

      for (
        let sampleY =
          minimumY;
        sampleY <=
          maximumY;
        sampleY += 1
      ) {
        for (
          let sampleX =
            minimumX;
          sampleX <=
            maximumX;
          sampleX += 1
        ) {
          if (
            sampleX ===
              x &&
            sampleY ===
              y
          ) {
            continue;
          }

          const neighborValue =
            reference.data[
              sampleY *
                source.width +
              sampleX
            ];

          neighborMaximum =
            Math.max(
              neighborMaximum,
              neighborValue
            );

          neighborAverage +=
            neighborValue;

          neighborCount +=
            1;
        }
      }

      neighborAverage =
        safeDivide(
          neighborAverage,
          neighborCount
        );

      const unsupportedHalo =
        referenceValue <
          haloLimit &&
        neighborMaximum <
          safeThreshold &&
        neighborAverage <
          haloLimit;

      if (
        unsupportedHalo
      ) {
        const suppression =
          1 -
          smoothStep(
            0,
            haloLimit,
            referenceValue
          );

        output[
          index
        ] =
          value *
          (
            1 -
            suppression *
              0.82
          );
      } else {
        output[
          index
        ] =
          value;
      }
    }
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * Edge Protection V2
 * ======================================================= */

function protectObjectEdgesV2(
  processed:
    SegmentationFloatMask,
  reference:
    SegmentationFloatMask,
  strength:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  assertMatchingMaskDimensions(
    processed,
    reference,
    requestId,
    'protect-object-edges'
  );

  const safeStrength =
    clampUnitValue(
      strength
    );

  if (
    safeStrength <=
    0
  ) {
    return cloneFloatMask(
      processed,
      requestId,
      'protect-object-edges'
    );
  }

  const edgeMap =
    createEdgeMapV2(
      reference,
      signal
    );

  const output =
    new Float32Array(
      processed.data.length
    );

  for (
    let y = 0;
    y <
      processed.height;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    for (
      let x = 0;
      x <
        processed.width;
      x += 1
    ) {
      const index =
        y *
          processed.width +
        x;

      const processedValue =
        clampUnitValue(
          processed.data[
            index
          ]
        );

      const referenceValue =
        clampUnitValue(
          reference.data[
            index
          ]
        );

      const edgeStrength =
        clampUnitValue(
          edgeMap.data[
            index
          ] *
          2.25
        );

      let localProcessedMaximum =
        processedValue;

      let localProcessedAverage =
        0;

      let localSampleCount =
        0;

      const minimumY =
        Math.max(
          0,
          y -
            1
        );

      const maximumY =
        Math.min(
          processed.height -
            1,
          y +
            1
        );

      const minimumX =
        Math.max(
          0,
          x -
            1
        );

      const maximumX =
        Math.min(
          processed.width -
            1,
          x +
            1
        );

      for (
        let sampleY =
          minimumY;
        sampleY <=
          maximumY;
        sampleY += 1
      ) {
        for (
          let sampleX =
            minimumX;
          sampleX <=
            maximumX;
          sampleX += 1
        ) {
          const sampleValue =
            clampUnitValue(
              processed.data[
                sampleY *
                  processed.width +
                sampleX
              ]
            );

          localProcessedMaximum =
            Math.max(
              localProcessedMaximum,
              sampleValue
            );

          localProcessedAverage +=
            sampleValue;

          localSampleCount +=
            1;
        }
      }

      localProcessedAverage =
        safeDivide(
          localProcessedAverage,
          localSampleCount
        );

      const localSupport =
        clampUnitValue(
          localProcessedMaximum *
            0.7 +
          localProcessedAverage *
            0.3
        );

      const supportWeight =
        smoothStep(
          0.1,
          0.55,
          localSupport
        );

      const preserveWeight =
        edgeStrength *
        safeStrength *
        supportWeight;

      if (
        processedValue <
          0.025 &&
        localSupport <
          0.14
      ) {
        output[
          index
        ] =
          processedValue;

        continue;
      }

      const protectedValue =
        referenceValue >
          processedValue
          ? lerp(
              processedValue,
              referenceValue,
              0.48
            )
          : lerp(
              processedValue,
              referenceValue,
              0.22
            );

      output[
        index
      ] =
        clampUnitValue(
          lerp(
            processedValue,
            protectedValue,
            preserveWeight
          )
        );
    }
  }

  return createFloatMask(
    processed.width,
    processed.height,
    output,
    requestId,
    'protect-object-edges'
  );
}

/* =========================================================
 * Matte Polish V2
 * ======================================================= */

function polishMatteV2(
  source:
    SegmentationFloatMask,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationFloatMask {
  const output =
    new Float32Array(
      source.data.length
    );

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const value =
      clampUnitValue(
        source.data[
          index
        ]
      );

    if (
      value <=
      0.015
    ) {
      output[
        index
      ] =
        0;

      continue;
    }

    if (
      value >=
      0.985
    ) {
      output[
        index
      ] =
        1;

      continue;
    }

    output[
      index
    ] =
      smoothStep(
        0.01,
        0.99,
        value
      );
  }

  return createFloatMask(
    source.width,
    source.height,
    output,
    requestId
  );
}

/* =========================================================
 * Alpha conversion
 * ======================================================= */

function convertToAlphaMaskV2(
  source:
    SegmentationFloatMask,
  minimumAlpha:
    number,
  maximumAlpha:
    number,
  requestId?:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationAlphaMask {
  const output =
    new Uint8Array(
      source.data.length
    );

  const safeMinimum =
    clampUnitValue(
      minimumAlpha
    );

  const safeMaximum =
    clampUnitValue(
      maximumAlpha
    );

  const lower =
    Math.min(
      safeMinimum,
      safeMaximum
    );

  const upper =
    Math.max(
      safeMinimum,
      safeMaximum
    );

  const alphaRange =
    upper -
    lower;

  for (
    let index = 0;
    index <
      source.data.length;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const unitAlpha =
      lower +
      clampUnitValue(
        source.data[
          index
        ]
      ) *
        alphaRange;

    output[
      index
    ] =
      alphaByteFromUnitValue(
        unitAlpha
      );
  }

  return {
    width:
      source.width,

    height:
      source.height,

    data:
      output,
  };
}

/* =========================================================
 * Statistics helpers
 * ======================================================= */

function createStatisticsBounds(
  minimumX:
    number,
  minimumY:
    number,
  maximumX:
    number,
  maximumY:
    number,
  maskWidth:
    number,
  maskHeight:
    number
): NonNullable<
  SegmentationMaskStatistics[
    'bounds'
  ]
> {
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

  const totalArea =
    Math.max(
      1,
      maskWidth *
        maskHeight
    );

  return {
    x:
      minimumX,

    y:
      minimumY,

    width,

    height,

    x2:
      maximumX,

    y2:
      maximumY,

    area,

    areaRatio:
      area /
      totalArea,
  };
}

function createStatisticsCentroid(
  x:
    number,
  y:
    number
): NonNullable<
  SegmentationMaskStatistics[
    'centroid'
  ]
> {
  return {
    x,

    y,
  } as NonNullable<
    SegmentationMaskStatistics[
      'centroid'
    ]
  >;
}

function countTouchedEdges(
  component:
    BinaryConnectedComponent | null
): number {
  if (
    !component
  ) {
    return 0;
  }

  let count =
    0;

  if (
    component
      .touchesLeft
  ) {
    count +=
      1;
  }

  if (
    component
      .touchesTop
  ) {
    count +=
      1;
  }

  if (
    component
      .touchesRight
  ) {
    count +=
      1;
  }

  if (
    component
      .touchesBottom
  ) {
    count +=
      1;
  }

  return count;
}

function countEdgeContactPixels(
  binary:
    Uint8Array,
  width:
    number,
  height:
    number
): number {
  if (
    width <=
      0 ||
    height <=
      0
  ) {
    return 0;
  }

  let count =
    0;

  for (
    let x = 0;
    x <
      width;
    x += 1
  ) {
    if (
      binary[
        x
      ] !==
      0
    ) {
      count +=
        1;
    }

    if (
      height >
        1 &&
      binary[
        (
          height -
          1
        ) *
          width +
        x
      ] !==
        0
    ) {
      count +=
        1;
    }
  }

  for (
    let y = 1;
    y <
      height -
        1;
    y += 1
  ) {
    if (
      binary[
        y *
          width
      ] !==
      0
    ) {
      count +=
        1;
    }

    if (
      width >
        1 &&
      binary[
        y *
          width +
        width -
          1
      ] !==
        0
    ) {
      count +=
        1;
    }
  }

  return count;
}

function calculateHoleStatistics(
  binary:
    Uint8Array,
  width:
    number,
  height:
    number,
  signal?:
    SegmentationCancellationSignal
): {
  holePixels:
    number;

  holeCount:
    number;
} {
  const backgroundAnalysis =
    analyzeConnectedComponentsV2(
      binary,
      width,
      height,
      0,
      signal
    );

  let holePixels =
    0;

  let holeCount =
    0;

  for (
    let index = 0;
    index <
      backgroundAnalysis
        .components
        .length;
    index += 1
  ) {
    const component =
      backgroundAnalysis
        .components[
          index
        ];

    if (
      component
        .touchesBorder
    ) {
      continue;
    }

    holeCount +=
      1;

    holePixels +=
      component.area;
  }

  return {
    holePixels,

    holeCount,
  };
}

/* =========================================================
 * Statistics V2
 * ======================================================= */

function calculateMaskStatisticsV2(
  mask:
    SegmentationAlphaMask,
  signal?:
    SegmentationCancellationSignal
): SegmentationMaskStatistics {
  const pixelCount =
    mask.data.length;

  if (
    pixelCount ===
    0
  ) {
    return {
      minimum:
        0,

      maximum:
        0,

      average:
        0,

      foregroundPixels:
        0,

      backgroundPixels:
        0,

      semiTransparentPixels:
        0,

      foregroundRatio:
        0,

      backgroundRatio:
        0,

      semiTransparentRatio:
        0,

      largestComponentPixels:
        0,

      largestComponentRatio:
        0,

      secondLargestComponentPixels:
        0,

      secondLargestComponentRatio:
        0,

      connectedComponentCount:
        0,

      significantComponentCount:
        0,

      holePixels:
        0,

      holeRatio:
        0,

      edgeContactPixels:
        0,

      edgeContactRatio:
        0,

      touchedEdgeCount:
        0,

      bounds:
        null,

      centroid:
        null,

      centerOffsetRatio:
        0,
    };
  }

  const binary =
    new Uint8Array(
      pixelCount
    );

  let minimum =
    255;

  let maximum =
    0;

  let sum =
    0;

  let foregroundPixels =
    0;

  let backgroundPixels =
    0;

  let semiTransparentPixels =
    0;

  let minimumX =
    mask.width;

  let minimumY =
    mask.height;

  let maximumX =
    -1;

  let maximumY =
    -1;

  let weightedX =
    0;

  let weightedY =
    0;

  let totalWeight =
    0;

  for (
    let index = 0;
    index <
      pixelCount;
    index += 1
  ) {
    assertLoopNotCancelled(
      index,
      signal
    );

    const byteValue =
      mask.data[
        index
      ];

    const unitValue =
      byteValue /
      255;

    minimum =
      Math.min(
        minimum,
        byteValue
      );

    maximum =
      Math.max(
        maximum,
        byteValue
      );

    sum +=
      byteValue;

    if (
      unitValue <=
      STATISTICS_FULLY_TRANSPARENT_THRESHOLD
    ) {
      backgroundPixels +=
        1;
    } else if (
      unitValue >=
      STATISTICS_FULLY_OPAQUE_THRESHOLD
    ) {
      foregroundPixels +=
        1;
    } else {
      semiTransparentPixels +=
        1;
    }

    if (
      unitValue >=
      STATISTICS_FOREGROUND_THRESHOLD
    ) {
      binary[
        index
      ] =
        1;

      const x =
        index %
        mask.width;

      const y =
        Math.floor(
          index /
          mask.width
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

      weightedX +=
        x *
        unitValue;

      weightedY +=
        y *
        unitValue;

      totalWeight +=
        unitValue;
    }
  }

  const occupiedPixels =
    foregroundPixels +
    semiTransparentPixels;

  const componentAnalysis =
    analyzeConnectedComponentsV2(
      binary,
      mask.width,
      mask.height,
      1,
      signal
    );

  const largestComponentPixels =
    componentAnalysis
      .largestComponent
      ?.area ??
    0;

  const secondLargestComponentPixels =
    componentAnalysis
      .secondLargestComponent
      ?.area ??
    0;

  const holeStatistics =
    calculateHoleStatistics(
      binary,
      mask.width,
      mask.height,
      signal
    );

  const edgeContactPixels =
    countEdgeContactPixels(
      binary,
      mask.width,
      mask.height
    );

  const borderPixelCount =
    calculateBorderPixelCount(
      mask.width,
      mask.height,
      1
    );

  const touchedEdgeCount =
    countTouchedEdges(
      componentAnalysis
        .largestComponent
    );

  const hasBounds =
    maximumX >=
      minimumX &&
    maximumY >=
      minimumY;

  const centroidX =
    totalWeight >
      PROBABILITY_EPSILON
      ? weightedX /
        totalWeight
      : 0;

  const centroidY =
    totalWeight >
      PROBABILITY_EPSILON
      ? weightedY /
        totalWeight
      : 0;

  const imageCenterX =
    (
      mask.width -
      1
    ) /
    2;

  const imageCenterY =
    (
      mask.height -
      1
    ) /
    2;

  const normalizedOffsetX =
    safeDivide(
      centroidX -
        imageCenterX,
      Math.max(
        1,
        mask.width
      )
    );

  const normalizedOffsetY =
    safeDivide(
      centroidY -
        imageCenterY,
      Math.max(
        1,
        mask.height
      )
    );

  const centerOffsetRatio =
    hasBounds
      ? Math.sqrt(
          normalizedOffsetX *
            normalizedOffsetX +
          normalizedOffsetY *
            normalizedOffsetY
        )
      : 0;

  return {
    minimum,

    maximum,

    average:
      sum /
      pixelCount,

    foregroundPixels,

    backgroundPixels,

    semiTransparentPixels,

    foregroundRatio:
      occupiedPixels /
      pixelCount,

    backgroundRatio:
      backgroundPixels /
      pixelCount,

    semiTransparentRatio:
      semiTransparentPixels /
      pixelCount,

    largestComponentPixels,

    largestComponentRatio:
      largestComponentPixels /
      pixelCount,

    secondLargestComponentPixels,

    secondLargestComponentRatio:
      secondLargestComponentPixels /
      pixelCount,

    connectedComponentCount:
      componentAnalysis
        .components
        .length,

    significantComponentCount:
      componentAnalysis
        .significantComponentCount,

    holePixels:
      holeStatistics
        .holePixels,

    holeRatio:
      holeStatistics
        .holePixels /
      pixelCount,

    edgeContactPixels,

    edgeContactRatio:
      safeDivide(
        edgeContactPixels,
        borderPixelCount
      ),

    touchedEdgeCount,

    bounds:
      hasBounds
        ? createStatisticsBounds(
            minimumX,
            minimumY,
            maximumX,
            maximumY,
            mask.width,
            mask.height
          )
        : null,

    centroid:
      hasBounds
        ? createStatisticsCentroid(
            centroidX,
            centroidY
          )
        : null,

    centerOffsetRatio,
  };
}

/* =========================================================
 * Diagnostics
 * ======================================================= */

function createDiagnosticsV2(
  context:
    MaskProcessingContext,
  originalStatistics:
    SegmentationMaskStatistics,
  refinedStatistics:
    SegmentationMaskStatistics
): SegmentationMaskRefinementDiagnostics {
  return {
    originalStatistics,

    refinedStatistics,

    removedComponentCount:
      context
        .removedComponentCount,

    removedPixelCount:
      context
        .removedPixelCount,

    filledHoleCount:
      context
        .filledHoleCount,

    filledHolePixelCount:
      context
        .filledHolePixelCount,

    morphologyApplied:
      context
        .morphologyApplied,

    edgeProtectionApplied:
      context
        .edgeProtectionApplied,

    featherApplied:
      context
        .featherApplied,

    warnings:
      Object.freeze(
        [
          ...context.warnings,
        ]
      ),
  };
}

function appendQualityWarnings(
  context:
    MaskProcessingContext,
  originalStatistics:
    SegmentationMaskStatistics,
  refinedStatistics:
    SegmentationMaskStatistics
): void {
  if (
    refinedStatistics
      .foregroundRatio <
    DEFAULT_MINIMUM_FOREGROUND_RATIO
  ) {
    appendUniqueWarning(
      context.warnings,
      'The refined foreground ratio is extremely small.'
    );
  }

  if (
    refinedStatistics
      .foregroundRatio >
    DEFAULT_MAXIMUM_FOREGROUND_RATIO
  ) {
    appendUniqueWarning(
      context.warnings,
      'The refined mask covers almost the entire image.'
    );
  }

  if (
    refinedStatistics
      .significantComponentCount >
    2
  ) {
    appendUniqueWarning(
      context.warnings,
      'Multiple significant foreground components remain after refinement.'
    );
  }

  if (
    refinedStatistics
      .touchedEdgeCount >
    1
  ) {
    appendUniqueWarning(
      context.warnings,
      'The foreground touches multiple image edges.'
    );
  }

  if (
    originalStatistics
      .foregroundRatio >
      0 &&
    refinedStatistics
      .foregroundRatio <
      originalStatistics
        .foregroundRatio *
        0.45
  ) {
    appendUniqueWarning(
      context.warnings,
      'Refinement removed a large portion of the original mask.'
    );
  }

  if (
    refinedStatistics
      .semiTransparentRatio >
    0.35
  ) {
    appendUniqueWarning(
      context.warnings,
      'The final matte contains an unusually high semi-transparent area.'
    );
  }
}

/* =========================================================
 * Final mask validation
 * ======================================================= */

function assertUsefulMaskV2(
  statistics:
    SegmentationMaskStatistics,
  requestId:
    string,
  selectedCandidateIndex:
    number,
  selectedCandidateScore:
    number
): void {
  if (
    statistics.maximum <=
      0 ||
    statistics
      .foregroundRatio <=
      0.0001
  ) {
    throw new SegmentationError(
      'MASK_EMPTY',
      'EdgeSAM returned an empty foreground mask.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'protect-object-edges',

        retryable:
          true,

        metadata: {
          maximum:
            statistics.maximum,

          foregroundRatio:
            statistics
              .foregroundRatio,

          selectedCandidateIndex,

          selectedCandidateScore,
        },
      }
    );
  }

  if (
    statistics
      .backgroundRatio <=
    0.0001
  ) {
    throw new SegmentationError(
      'MASK_INVALID',
      'EdgeSAM marked almost the entire image as foreground.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'protect-object-edges',

        retryable:
          true,

        metadata: {
          backgroundRatio:
            statistics
              .backgroundRatio,

          selectedCandidateIndex,

          selectedCandidateScore,
        },
      }
    );
  }
}

function applyBackgroundUnderstandingToMaskV3(
  sourceMask:
    SegmentationFloatMask,
  backgroundConfidence:
    Float32Array,
  foregroundEvidence:
    Float32Array,
  uncertainty:
    Float32Array,
  edgeBarrier:
    Float32Array,
  connectedBackground:
    Uint8Array,
  strongBackground:
    Uint8Array,
  strongForeground:
    Uint8Array,
  requestId:
    string,
  signal:
    SegmentationCancellationSignal | undefined
): SegmentationFloatMask {
  const width =
    sourceMask.width;

  const height =
    sourceMask.height;

  const pixelCount =
    width *
    height;

  if (
    backgroundConfidence.length !==
      pixelCount ||
    foregroundEvidence.length !==
      pixelCount ||
    uncertainty.length !==
      pixelCount ||
    edgeBarrier.length !==
      pixelCount ||
    connectedBackground.length !==
      pixelCount ||
    strongBackground.length !==
      pixelCount ||
    strongForeground.length !==
      pixelCount
  ) {
    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      'BackgroundUnderstandingV3 maps do not match the adaptive mask dimensions.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'refine-alpha-mask',

        retryable:
          true,

        metadata: {
          width,

          height,

          pixelCount,

          sourceMaskLength:
            sourceMask.data.length,

          backgroundConfidenceLength:
            backgroundConfidence.length,

          foregroundEvidenceLength:
            foregroundEvidence.length,

          uncertaintyLength:
            uncertainty.length,

          edgeBarrierLength:
            edgeBarrier.length,

          connectedBackgroundLength:
            connectedBackground.length,

          strongBackgroundLength:
            strongBackground.length,

          strongForegroundLength:
            strongForeground.length,
        },
      }
    );
  }

  const output =
    new Float32Array(
      pixelCount
    );

  for (
    let index = 0;
    index <
      pixelCount;
    index += 1
  ) {
    if (
      index %
        CANCELLATION_CHECK_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const sourceValue =
      clampUnitValue(
        sourceMask.data[index]
      );

    const background =
      clampUnitValue(
        backgroundConfidence[index]
      );

    const foreground =
      clampUnitValue(
        foregroundEvidence[index]
      );

    const pixelUncertainty =
      clampUnitValue(
        uncertainty[index]
      );

    const barrier =
      clampUnitValue(
        edgeBarrier[index]
      );

    const isConnectedBackground =
      connectedBackground[index] !==
      0;

    const isStrongBackground =
      strongBackground[index] !==
      0;

    const isStrongForeground =
      strongForeground[index] !==
      0;

    const foregroundAdvantage =
      clampUnitValue(
        foreground -
        background
      );

    const backgroundAdvantage =
      clampUnitValue(
        background -
        foreground
      );

    /*
     * =====================================================
     * 1) Foreground مؤكد
     * =====================================================
     *
     * لا نحذف Pixel صنّفها النظام كجسم مؤكد.
     * لكن لا نرفع Pixel ضعيفة جدًا إلى جسم كامل
     * بدون دعم فعلي من Foreground Evidence.
     */
    if (
      isStrongForeground
    ) {
      const evidenceFloor =
        foreground *
        (
          0.74 +
          barrier *
            0.18
        );

      const protectedValue =
        Math.max(
          sourceValue *
            0.94,
          evidenceFloor
        );

      output[index] =
        clampUnitValue(
          protectedValue
        );

      continue;
    }

    /*
     * =====================================================
     * 2) Background مؤكد ومتصل بالحواف
     * =====================================================
     *
     * هذا أقوى دليل حذف:
     *
     * - Background قوي.
     * - متصل بحدود الصورة.
     * - Foreground Evidence ضعيف.
     * - لا توجد حافة قوية تحميه.
     */
    if (
      isStrongBackground &&
      isConnectedBackground &&
      background >=
        0.68 &&
      foreground <=
        0.50
    ) {
      const confidenceStrength =
        clampUnitValue(
          (
            background -
            0.52
          ) /
            0.48
        );

      const foregroundResistance =
        clampUnitValue(
          foreground *
            0.92
        );

      const edgeResistance =
        clampUnitValue(
          barrier *
            0.82
        );

      const uncertaintyResistance =
        clampUnitValue(
          pixelUncertainty *
            0.52
        );

      const removalStrength =
        clampUnitValue(
          confidenceStrength *
          (
            0.82 -
            foregroundResistance *
              0.42 -
            edgeResistance *
              0.38 -
            uncertaintyResistance *
              0.26
          )
        );

      let removedValue =
        sourceValue *
        (
          1 -
          removalStrength
        );

      /*
       * الخلفية شديدة الثقة والمتصلة بالحواف
       * يجب أن تقترب من الصفر فعلًا.
       */
      if (
        background >=
          0.86 &&
        foreground <=
          0.22 &&
        barrier <=
          0.30 &&
        pixelUncertainty <=
          0.34
      ) {
        const hardRemovalStrength =
          clampUnitValue(
            (
              background -
              0.78
            ) /
              0.22
          );

        removedValue *=
          1 -
          hardRemovalStrength *
            0.94;
      }

      output[index] =
        clampUnitValue(
          removedValue
        );

      continue;
    }

    /*
     * =====================================================
     * 3) خلفية متصلة ولكن ليست Strong Background
     * =====================================================
     *
     * نستخدم حذف تدريجي محافظ.
     */
    let connectivityStrength =
      isConnectedBackground
        ? 1
        : 0.48;

    if (
      isStrongBackground
    ) {
      connectivityStrength =
        Math.max(
          connectivityStrength,
          0.82
        );
    }

    const backgroundReliability =
      clampUnitValue(
        backgroundAdvantage *
        connectivityStrength *
        (
          1 -
          pixelUncertainty *
            0.58
        )
      );

    /*
     * الحافة القوية تقلل الحذف، لكنها لا تمنعه بالكامل
     * عندما تكون الخلفية متصلة ومؤكدة.
     */
    const edgeRemovalPermission =
      clampUnitValue(
        1 -
        barrier *
          (
            isConnectedBackground
              ? 0.46
              : 0.7
          )
      );

    const sourceRemovalPermission =
      sourceValue <= 0.2
        ? 1
        : sourceValue <= 0.5
          ? 0.72
          : 0.42;

    const safeRemovalStrength =
      clampUnitValue(
        backgroundReliability *
        edgeRemovalPermission *
        sourceRemovalPermission *
        0.9
      );

    let refinedValue =
      sourceValue *
      (
        1 -
        safeRemovalStrength
      );

    /*
     * =====================================================
     * 4) حذف الخلفية الضعيفة حول الجسم
     * =====================================================
     *
     * Pixels ذات Mask منخفضة أصلًا، ومتّصلة بالخلفية،
     * لا تحتاج مقاومة كبيرة للحذف.
     */
    if (
      isConnectedBackground &&
      sourceValue <=
        0.26 &&
      background >=
        0.60 &&
      foreground <=
        0.42
    ) {
      const softBackgroundRemoval =
        clampUnitValue(
          (
            background *
              0.66 +
            backgroundAdvantage *
              0.34
          ) *
          (
            1 -
            barrier *
              0.38
          ) *
          (
            1 -
            pixelUncertainty *
              0.46
          )
        );

      refinedValue =
        Math.min(
          refinedValue,
          sourceValue *
            (
              1 -
              softBackgroundRemoval *
                0.80
            )
        );
    }

    /*
     * =====================================================
     * 5) Foreground Recovery
     * =====================================================
     *
     * نسترجع أجزاء القطعة فقط عند وجود فرق واضح
     * لصالح الـForeground.
     *
     * لا ننشئ جسمًا جديدًا من Pixel شبه فارغة.
     */
    if (
      foregroundAdvantage >=
        0.05 &&
      foreground >=
        0.48
    ) {
      const sourceSupport =
        smoothStep(
          0.08,
          0.52,
          sourceValue
        );

      const recoveryConfidence =
        clampUnitValue(
          foregroundAdvantage *
          (
            0.52 +
            barrier *
              0.28 +
            sourceSupport *
              0.2
          ) *
          (
            1 -
            pixelUncertainty *
              0.4
          )
        );

      const recoveredFloor =
        foreground *
        (
          0.5 +
          barrier *
            0.18 +
          sourceSupport *
            0.18
        );

      const maximumRecoveredValue =
        sourceValue <
          0.08
          ? Math.max(
              sourceValue,
              recoveredFloor *
                0.42
            )
          : Math.max(
              sourceValue,
              recoveredFloor
            );

      refinedValue =
        refinedValue *
          (
            1 -
            recoveryConfidence
          ) +
        maximumRecoveredValue *
          recoveryConfidence;
    }

    /*
     * =====================================================
     * 6) Strong Background غير متصل
     * =====================================================
     *
     * لا نحذفه بنفس قوة الخلفية المتصلة،
     * لكنه يظل دليلًا مهمًا عند ضعف الـForeground.
     */
    if (
      isStrongBackground &&
      !isConnectedBackground &&
      backgroundAdvantage >=
        0.12 &&
      foreground <=
        0.52
    ) {
      const disconnectedRemoval =
        clampUnitValue(
          backgroundAdvantage *
          (
            1 -
            barrier *
              0.64
          ) *
          (
            1 -
            pixelUncertainty *
              0.7
          ) *
          0.58
        );

      refinedValue *=
        1 -
        disconnectedRemoval;
    }

    /*
     * =====================================================
     * 7) حماية الحواف
     * =====================================================
     *
     * الحافة القوية تعيد النتيجة جزئيًا ناحية
     * AdaptiveEdgeRefinerV3، لكن فقط عندما لا تكون
     * الخلفية متصلة بدليل قوي.
     */
    if (
      barrier >=
        0.56
    ) {
      const edgeProtection =
        clampUnitValue(
          (
            barrier -
            0.56
          ) /
            0.44
        );

      const protectionMultiplier =
        isConnectedBackground &&
        backgroundAdvantage >=
          0.18
          ? 0.38
          : 0.72;

      const protectedBlend =
        edgeProtection *
        protectionMultiplier;

      refinedValue =
        refinedValue *
          (
            1 -
            protectedBlend
          ) +
        sourceValue *
          protectedBlend;
    }

    /*
     * =====================================================
     * 8) حماية المناطق الغامضة
     * =====================================================
     *
     * الغموض وحده لا يعيد الخلفية بالكامل.
     * لو المنطقة متصلة بالحواف والخلفية أقوى،
     * تظل نسبة الحماية محدودة.
     */
    if (
      pixelUncertainty >=
        0.54
    ) {
      const uncertaintyProtection =
        clampUnitValue(
          (
            pixelUncertainty -
            0.54
          ) /
            0.46
        );

      const uncertaintyMultiplier =
        isConnectedBackground &&
        backgroundAdvantage >=
          0.14
          ? 0.36
          : 0.7;

      const protectedBlend =
        uncertaintyProtection *
        uncertaintyMultiplier;

      refinedValue =
        refinedValue *
          (
            1 -
            protectedBlend
          ) +
        sourceValue *
          protectedBlend;
    }

    /*
     * =====================================================
     * 9) حسم Pixels منخفضة القيمة
     * =====================================================
     *
     * يمنع بقاء ضباب خلفية خفيف حول القطعة.
     */
    if (
      refinedValue <=
        0.12 &&
      background >=
        0.58 &&
      background >
        foreground &&
      (
        isConnectedBackground ||
        isStrongBackground
      )
    ) {
      refinedValue *=
        clampUnitValue(
          1 -
          background *
            0.72
        );
    }

    /*
     * لا نسمح بزيادة Pixel عن الماسك الأصلي
     * عند عدم وجود Foreground Advantage حقيقي.
     */
    if (
      foregroundAdvantage <
        0.06 &&
      refinedValue >
        sourceValue
    ) {
      refinedValue =
        sourceValue;
    }

    output[index] =
      clampUnitValue(
        refinedValue
      );
  }

  assertNotCancelled(
    signal
  );

  return createFloatMask(
    width,
    height,
    output,
    requestId
  );
}


function createBackgroundRgbaImageV3(
  image:
    ImageGuidedAnalysisImage,
  signal:
    SegmentationCancellationSignal | undefined
): SegmentationRgbaImageSource {
  const pixelCount =
    image.width *
    image.height;

  if (
    image.red.length !==
      pixelCount ||
    image.green.length !==
      pixelCount ||
    image.blue.length !==
      pixelCount
  ) {
    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      'Image-guided RGB channel dimensions are invalid.',
      {
        component:
          'decoder',

        stage:
          'refine-alpha-mask',

        retryable:
          true,

        metadata: {
          width:
            image.width,

          height:
            image.height,

          pixelCount,

          redLength:
            image.red.length,

          greenLength:
            image.green.length,

          blueLength:
            image.blue.length,
        },
      }
    );
  }

  const rgba =
    new Uint8Array(
      pixelCount * 4
    );

  for (
    let pixelIndex = 0;
    pixelIndex < pixelCount;
    pixelIndex += 1
  ) {
    if (
      pixelIndex %
        CANCELLATION_CHECK_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const rgbaIndex =
      pixelIndex * 4;

    rgba[rgbaIndex] =
      Math.round(
        clampUnitValue(
          image.red[pixelIndex]
        ) * 255
      );

    rgba[rgbaIndex + 1] =
      Math.round(
        clampUnitValue(
          image.green[pixelIndex]
        ) * 255
      );

    rgba[rgbaIndex + 2] =
      Math.round(
        clampUnitValue(
          image.blue[pixelIndex]
        ) * 255
      );

    rgba[rgbaIndex + 3] =
      255;
  }

  assertNotCancelled(
    signal
  );

  return {
    width:
      image.width,

    height:
      image.height,

    rgba,
  };
}


/* =========================================================
 * V3 refinement pipeline
 * ======================================================= */

function runImageGuidedRefinementV3(
  image:
    ImageGuidedAnalysisImage,
  sourceMask:
    SegmentationFloatMask,
  threshold:
    number,
  context:
    MaskProcessingContext
): SegmentationFloatMask {
  const signal =
    context
      .cancellationSignal;

  assertNotCancelled(
    signal
  );

  const mainComponentMap =
    createMainComponentMapV3(
      sourceMask,
      threshold,
      signal
    );

  const v3Image =
  createBoundaryAnalysisImageV3(
    image,
    signal
  );

  const boundaryResult =
    extractBoundaryFeatureMapV3({
      image:
        v3Image,

      mask:
        sourceMask,

      mainComponentMap,
    });

  appendUniqueWarnings(
    context.warnings,
    boundaryResult
      .warnings
  );

  assertNotCancelled(
    signal
  );

  const foregroundModelResult =
    buildLocalForegroundModelV3({
      image:
        v3Image,

      mask:
        sourceMask,

      mainComponentMap:
        boundaryResult
          .mainComponentMap,

      boundaryDistance:
        boundaryResult
          .featureMap
          .boundaryDistance,
    });

  assertNotCancelled(
    signal
  );

  const classifierResult =
    classifyImageGuidedPixelsV3({
      image:
        v3Image,

      mask:
        sourceMask,

      featureMap:
        boundaryResult
          .featureMap,

      foregroundModel:
        foregroundModelResult
          .model,

      mainComponentMap:
        boundaryResult
          .mainComponentMap,
    });

  assertNotCancelled(
    signal
  );

  const votingResult =
    applyConfidenceVotingV3({
      classifierResult:
        classifierResult
          .result,

      featureMap:
        boundaryResult
          .featureMap,

      mainComponentMap:
        boundaryResult
          .mainComponentMap,
    });

  assertNotCancelled(
    signal
  );

  const adaptiveResult =
    refineAdaptiveEdgesV3({
      votingResult:
        votingResult
          .result,

      featureMap:
        boundaryResult
          .featureMap,

      mainComponentMap:
        boundaryResult
          .mainComponentMap,
    });

assertNotCancelled(
  signal
);

const adaptiveMask =
  createFloatMask(
    sourceMask.width,
    sourceMask.height,
    new Float32Array(
      adaptiveResult
        .result
        .mask
        .data
    ),
    context.requestId
  );

const backgroundImage =
  createBackgroundRgbaImageV3(
    image,
    signal
  );

const backgroundResult =
  analyzeBackgroundUnderstandingV3({
    image:
      backgroundImage,

    mask:
      adaptiveMask,

    requestId:
      context.requestId,

    cancellationSignal:
      signal,
  });

appendUniqueWarnings(
  context.warnings,
  backgroundResult
    .diagnostics
    .warnings
);

assertNotCancelled(
  signal
);

const backgroundRefinedMask =
  applyBackgroundUnderstandingToMaskV3(
    adaptiveMask,
    backgroundResult
      .backgroundConfidence
      .data,
    backgroundResult
      .foregroundEvidence
      .data,
    backgroundResult
      .uncertainty
      .data,
    backgroundResult
      .edgeBarrier
      .data,
    backgroundResult
      .connectedBackground
      .data,
    backgroundResult
      .strongBackground
      .data,
    backgroundResult
      .strongForeground
      .data,
    context.requestId,
    signal
  );

  const subPixelRefinedMask =
  applyBoundarySubPixelRefinementV3(
    v3Image,
    backgroundRefinedMask,
    signal,
    context.requestId
  );

/*
 * الدمج الآمن بين:
 *
 * 1) الماسك الأصلي الخارج من EdgeSAM.
 * 2) نتيجة تحسين الحواف.
 * 3) نتيجة فهم الخلفية.
 *
 * لا نسمح لـBackground Understanding بحذف مناطق قوية
 * من داخل جسم القطعة، خصوصًا الطباعة والكرمشة
 * والاختلافات اللونية الموجودة داخل الملابس.
 */
const safelyFusedData =
  new Float32Array(
    sourceMask.data.length
  );

const strongInteriorThreshold =
  Math.max(
    0.68,
    Math.min(
      0.88,
      threshold +
        0.20
    )
  );

const normalForegroundThreshold =
  Math.max(
    0.44,
    Math.min(
      0.72,
      threshold
    )
  );

for (
  let index = 0;
  index <
    safelyFusedData.length;
  index += 1
) {
  if (
    (
      index &
      131071
    ) ===
    0
  ) {
    assertNotCancelled(
      signal
    );
  }

  const sourceValue =
    sourceMask
      .data[
        index
      ];

  const adaptiveValue =
    adaptiveMask
      .data[
        index
      ];

  const refinedValue =
  subPixelRefinedMask.data[index];

  const backgroundConfidence =
    backgroundResult
      .backgroundConfidence
      .data[
        index
      ];

  const foregroundEvidence =
    backgroundResult
      .foregroundEvidence
      .data[
        index
      ];

  const uncertainty =
    backgroundResult
      .uncertainty
      .data[
        index
      ];

  const connectedBackground =
    backgroundResult
      .connectedBackground
      .data[
        index
      ];

  const strongBackground =
    backgroundResult
      .strongBackground
      .data[
        index
      ];

  const strongForeground =
    backgroundResult
      .strongForeground
      .data[
        index
      ];

  /*
   * جسم داخلي مؤكد:
   *
   * لا نسمح بحذفه بسبب اختلاف اللون أو الطباعة
   * أو مناطق الإضاءة والكرمشة.
   */
  const isTrustedForeground =
  (
    strongForeground >=
      0.5 ||
    foregroundEvidence >=
      0.62
  ) &&
  backgroundConfidence <
    0.56;

const isConfirmedBackground =
  (
    strongBackground >=
      0.5 ||
    backgroundConfidence >=
      0.76
  ) &&
  connectedBackground >=
    0.5 &&
  foregroundEvidence <
    0.38 &&
  strongForeground <
    0.5 &&
  uncertainty <
    0.68;

if (
  isConfirmedBackground
) {
  safelyFusedData[
    index
  ] =
    Math.min(
      refinedValue,
      adaptiveValue
    );

  continue;
}

if (
  isTrustedForeground
) {
  safelyFusedData[
    index
  ] =
    Math.max(
      refinedValue,
      adaptiveValue *
        0.96
    );

  continue;
}

/*
 * في المناطق غير المؤكدة نعتمد نتيجة
 * Background Understanding وSubPixel نفسها.
 *
 * ممنوع إعادة sourceMask الخام كحد أدنى،
 * لأنه قد يحتوي الأرضية أو الظلال.
 */
safelyFusedData[
  index
] =
  Math.max(
    0,
    Math.min(
      1,
      refinedValue
    )
  );

  /*
   * المناطق الضعيفة الأصلية يمكن تنقيتها بشكل طبيعي.
   */
  safelyFusedData[
    index
  ] =
    Math.max(
      0,
      Math.min(
        1,
        refinedValue
      )
    );
}

assertNotCancelled(
  signal
);

return createFloatMask(
  sourceMask.width,
  sourceMask.height,
  safelyFusedData,
  context.requestId,
  'refine-alpha-mask'
);
}

 type EdgeProtectionResultV2 = {
  mask:
    SegmentationFloatMask;

  applied:
    boolean;

  recoveredPixelCount:
    number;
};

/**
 * يسترجع أجزاء الحواف القوية التي ربما أزالتها مراحل التنظيف،
 * دون إعادة الظلال أو المناطق المنفصلة عن الجسم الأساسي.
 *
 * refinedMask:
 * النتيجة المنظفة والمستعادة للحجم الأصلي.
 *
 * referenceMask:
 * الماسك الأصلي قبل تنقية الحواف، بعد استعادته للحجم الأصلي.
 */
function protectOriginalObjectEdgesV2(
  refinedMask:
    SegmentationFloatMask,
  referenceMask:
    SegmentationFloatMask,
  threshold:
    number,
  requestId:
    string,
  cancellationSignal?:
    SegmentationCancellationSignal
): EdgeProtectionResultV2 {
  assertNotCancelled(
    cancellationSignal
  );

  if (
    refinedMask.width !==
      referenceMask.width ||
    refinedMask.height !==
      referenceMask.height ||
    refinedMask.data.length !==
      referenceMask.data.length
  ) {
    throw new SegmentationError(
      'MASK_PROCESSING_FAILED',
      'Edge protection masks must have matching dimensions.',
      {
        requestId,

        component:
          'decoder',

        stage:
          'protect-object-edges',

        retryable:
          false,

        metadata: {
          refinedWidth:
            refinedMask.width,

          refinedHeight:
            refinedMask.height,

          referenceWidth:
            referenceMask.width,

          referenceHeight:
            referenceMask.height,
        },
      }
    );
  }

  const width =
    refinedMask.width;

  const height =
    refinedMask.height;

  const refinedData =
    refinedMask.data;

  const referenceData =
    referenceMask.data;

  const outputData =
    new Float32Array(
      refinedData
    );

  /*
   * لا نسترجع أي بكسل ضعيف من الماسك الأصلي.
   * القيمة المرتفعة تمنع رجوع الظلال الرمادية.
   */
  const strongReferenceThreshold =
    Math.max(
      0.62,
      Math.min(
        0.88,
        threshold +
          0.12
      )
    );

  /*
   * الحد الذي يعتبر البكسل الحالي جزءًا مؤكدًا
   * من القطعة المنظفة.
   */
  const refinedForegroundThreshold =
    Math.max(
      0.48,
      Math.min(
        0.78,
        threshold
      )
    );

  let recoveredPixelCount =
    0;

  for (
    let y = 1;
    y <
      height - 1;
    y += 1
  ) {
    assertNotCancelled(
      cancellationSignal
    );

    const rowOffset =
      y *
      width;

    for (
      let x = 1;
      x <
        width - 1;
      x += 1
    ) {
      const index =
        rowOffset +
        x;

      const currentValue =
        refinedData[
          index
        ];

      const referenceValue =
        referenceData[
          index
        ];

      /*
       * البكسل موجود بالفعل بقوة،
       * أو الماسك الأصلي غير واثق فيه.
       */
      if (
        currentValue >=
          refinedForegroundThreshold ||
        referenceValue <
          strongReferenceThreshold
      ) {
        continue;
      }

      const left =
        refinedData[
          index - 1
        ];

      const right =
        refinedData[
          index + 1
        ];

      const top =
        refinedData[
          index -
            width
        ];

      const bottom =
        refinedData[
          index +
            width
        ];

      const topLeft =
        refinedData[
          index -
            width -
            1
        ];

      const topRight =
        refinedData[
          index -
            width +
            1
        ];

      const bottomLeft =
        refinedData[
          index +
            width -
            1
        ];

      const bottomRight =
        refinedData[
          index +
            width +
            1
        ];

      const strongestNeighbour =
        Math.max(
          left,
          right,
          top,
          bottom,
          topLeft,
          topRight,
          bottomLeft,
          bottomRight
        );

      /*
       * أهم شرط:
       * لا نسترجع البكسل إلا لو كان متصلًا مباشرة
       * بجسم قوي داخل النتيجة المنظفة.
       *
       * لذلك الظل أو الخلفية المنفصلة لن يعودا.
       */
      if (
        strongestNeighbour <
          refinedForegroundThreshold
      ) {
        continue;
      }

      /*
       * نحافظ على ألفا الحافة ولا نعيدها بقوة 100%
       * إلا إذا كان كل من المرجع والجوار قويين جدًا.
       */
      const neighbourLimitedValue =
        strongestNeighbour *
        0.96;

      const recoveredValue =
        Math.max(
          currentValue,
          Math.min(
            referenceValue,
            neighbourLimitedValue
          )
        );

      if (
        recoveredValue >
          currentValue +
            0.01
      ) {
        outputData[
          index
        ] =
          recoveredValue;

        recoveredPixelCount +=
          1;
      }
    }
  }

  assertNotCancelled(
    cancellationSignal
  );

  return {
    mask:
      createFloatMask(
        width,
        height,
        outputData,
        requestId,
        'protect-object-edges'
      ),

    applied:
      recoveredPixelCount >
      0,

    recoveredPixelCount,
  };
}

/* =========================================================
 * End of Final Part 4
 *
 * Part 5 يبدأ مباشرة من:
 *
 * export class SegmentationPostprocessorV2 {
 * ======================================================= */
/* =========================================================
 * Postprocessor V2 + V3
 * ======================================================= */

export class SegmentationPostprocessorV2 {
  private readonly baseConfig:
    SegmentationModelConfig;

  public constructor(
    config:
      SegmentationModelConfig =
        DEFAULT_SEGMENTATION_MODEL_CONFIG
  ) {
    this.baseConfig =
      validateSegmentationModelConfig(
        cloneSegmentationModelConfig(
          config
        )
      );
  }

  public async process(
    input:
      SegmentationPostprocessorV2Input
  ): Promise<
    SegmentationPostprocessResult
  > {
    const requestId =
      input.requestId ??
      createSegmentationRequestId();

    const startedAt =
      now();

    const config =
      input.config
        ? validateSegmentationModelConfig(
            cloneSegmentationModelConfig(
              input.config
            )
          )
        : cloneSegmentationModelConfig(
            this.baseConfig
          );

    const context:
      MaskProcessingContext = {
      requestId,

      startedAt,

      timings:
        createEmptyTimings(),

      config,

      transform:
        input.transform,

      onProgress:
        input.onProgress,

      cancellationSignal:
        input.cancellationSignal,

      warnings:
        [],

      removedComponentCount:
        0,

      removedPixelCount:
        0,

      filledHoleCount:
        0,

      filledHolePixelCount:
        0,

      morphologyApplied:
        false,

      edgeProtectionApplied:
        false,

      featherApplied:
        false,
    };

    try {
      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 1. Create image analysis
       * =================================================== */

      const masksTensor =
        resolveMasksTensor(
          input.decoderOutput,
          requestId
        );

      const scoresTensor =
        resolveScoresTensor(
          input.decoderOutput
        );

      const maskShape =
        parseMaskTensorShape(
          masksTensor,
          requestId
        );

      const imageAnalysis =
        createImageGuidedAnalysisImageV2(
          input.orientedImage,
          maskShape.width,
          maskShape.height,
          requestId,
          context
            .cancellationSignal
        );

      const imageAnalysisV3 =
        createImageGuidedAnalysisImageV3Adapter(
          imageAnalysis
        );

      /* =====================================================
       * 2. Read candidate outputs
       * =================================================== */

      emitProgress(
        context,
        'read-mask-candidates',
        'Reading EdgeSAM mask candidates.'
      );

      const readCandidatesStartedAt =
        now();

      assertNotCancelled(
        context
          .cancellationSignal
      );

      context
        .timings
        .readCandidatesMs =
          Math.max(
            0,
            now() -
              readCandidatesStartedAt
          );

      /* =====================================================
       * 3. Candidate selection
       * =================================================== */

      emitProgress(
        context,
        'select-best-mask',
        'Selecting the best EdgeSAM mask candidate.'
      );

      const selectionStartedAt =
        now();

      const selectedCandidate =
        selectBestMaskCandidateV2(
          masksTensor,
          scoresTensor,
          imageAnalysisV3,
          requestId,
          context
            .cancellationSignal
        );

      context
        .timings
        .candidateSelectionMs =
          Math.max(
            0,
            now() -
              selectionStartedAt
          );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 4. Activate selected candidate
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Activating the selected EdgeSAM mask.'
      );

      const activationStartedAt =
        now();

      const activatedData =
        activateMaskLogitsV2(
          selectedCandidate
            .logits,
          requestId,
          context
            .cancellationSignal
        );

      let workingMask =
        createFloatMask(
          selectedCandidate
            .width,
          selectedCandidate
            .height,
          activatedData,
          requestId,
          'refine-alpha-mask'
        );

      context
        .timings
        .activationMs =
          Math.max(
            0,
            now() -
              activationStartedAt
          );

      /* =====================================================
       * 5. Normalize probabilities
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Normalizing the selected mask.'
      );

      const normalizationStartedAt =
        now();

      workingMask =
        normalizeProbabilityMask(
          workingMask,
          requestId,
          context
            .cancellationSignal
        );

        const selectedMask =
  cloneFloatMask(
    workingMask,
    requestId
  );

      context
        .timings
        .normalizeMaskMs =
          Math.max(
            0,
            now() -
              normalizationStartedAt
          );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 6. Remove model letterbox
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Removing model letterbox padding.'
      );

      const removeLetterboxStartedAt =
        now();

      const croppedMask =
        removeLetterboxV2(
          workingMask,
          input.transform,
          requestId,
          context
            .cancellationSignal
        );

      workingMask =
        croppedMask;

      context
        .timings
        .removeLetterboxMs =
          Math.max(
            0,
            now() -
              removeLetterboxStartedAt
          );

      /* =====================================================
       * 7. Recreate image analysis at cropped-mask size
       * =================================================== */

      const croppedImageAnalysis =
        createImageGuidedAnalysisImageV2(
          input.orientedImage,
          croppedMask.width,
          croppedMask.height,
          requestId,
          context
            .cancellationSignal
        );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 8. Adaptive threshold
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Calculating the adaptive foreground threshold.'
      );

      const thresholdStartedAt =
        now();

      const refinementConfig =
        config.refinement;

      const adaptiveThreshold =
        calculateAdaptiveThresholdV2(
          workingMask,
          refinementConfig
            .threshold,
          refinementConfig
            .softThresholdWidth,
          context
            .cancellationSignal
        );

      context
        .timings
        .thresholdMs =
          Math.max(
            0,
            now() -
              thresholdStartedAt
          );

      if (
        adaptiveThreshold
          .confidence <
        0.35
      ) {
        appendUniqueWarning(
          context.warnings,
          'The adaptive mask threshold has low confidence.'
        );
      }

      if (
        adaptiveThreshold
          .foregroundRatio <
        DEFAULT_MINIMUM_FOREGROUND_RATIO
      ) {
        appendUniqueWarning(
          context.warnings,
          'The selected candidate contains very little foreground.'
        );
      }

      if (
        adaptiveThreshold
          .foregroundRatio >
        DEFAULT_MAXIMUM_FOREGROUND_RATIO
      ) {
        appendUniqueWarning(
          context.warnings,
          'The selected candidate covers almost the entire image.'
        );
      }

      /* =====================================================
       * 9. Preserve decoder evidence for V3
       * =================================================== */

      /*
       * Do not suppress low-confidence mask values before
       * image/background understanding.
       *
       * Thin clothing edges, trouser legs, shoe soles and
       * laces can legitimately have lower decoder confidence.
       * BackgroundUnderstandingV3 must see those pixels before
       * any destructive suppression is allowed.
       */

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 10. V3 boundary-guided pipeline
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Running image-guided boundary refinement V3.'
      );

      let v3Succeeded =
        false;

      try {
        workingMask =
          runImageGuidedRefinementV3(
            croppedImageAnalysis,
            workingMask,
            adaptiveThreshold
              .threshold,
            context
          );

        v3Succeeded =
          true;
      } catch (error) {
        if (
          isSegmentationError(
            error
          ) &&
          (
            error.code ===
              'CANCELLED' ||
            error.code ===
              'REQUEST_CANCELLED'
          )
        ) {
          throw error;
        }

        appendUniqueWarning(
          context.warnings,
          `Image-guided V3 refinement was skipped: ${getUnknownErrorMessage(
            error
          )}`
        );

        workingMask =
          croppedMask;
      }

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 11. V2 color-boundary fallback
       * =================================================== */

      if (
        !v3Succeeded
      ) {
        const imageGuidedModels =
          createImageGuidedBoundaryModelsV2(
            workingMask,
            croppedImageAnalysis,
            context
              .cancellationSignal
          );

        const imageGuidedResult =
          refineBoundaryUsingImageGuidanceV2(
            workingMask,
            croppedImageAnalysis,
            imageGuidedModels,
            context
              .cancellationSignal
          );

        appendUniqueWarnings(
          context.warnings,
          imageGuidedResult
            .warnings
        );

        if (
          imageGuidedResult
            .applied
        ) {
          workingMask =
            imageGuidedResult
              .mask;
        }
      }

      /*
       * Preserve the strongest refined mask before later
       * cleanup/morphology so thin valid details can recover.
       */
      const v3RefinedReference =
        cloneFloatMask(
          workingMask,
          requestId
        );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 12. Connected component cleanup
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Removing detached foreground noise.'
      );

      const removeNoiseStartedAt =
        now();

      const configuredMinimumArea =
        Math.max(
          refinementConfig
            .minimumComponentArea,
          Math.round(
            workingMask
              .data
              .length *
            refinementConfig
              .minimumComponentAreaRatio
          )
        );

      const noiseResult =
        removeNoiseConnectedComponentsV2(
          workingMask,
          adaptiveThreshold
            .threshold,
          configuredMinimumArea,
          requestId,
          context
            .cancellationSignal
        );

      workingMask =
        noiseResult.mask;

      context
        .removedComponentCount +=
          noiseResult
            .removedComponentCount;

      context
        .removedPixelCount +=
          noiseResult
            .removedPixelCount;

      context
        .timings
        .removeNoiseMs =
          Math.max(
            0,
            now() -
              removeNoiseStartedAt
          );

      context
        .timings
        .connectedComponentsMs =
          context
            .timings
            .removeNoiseMs;

      /* =====================================================
       * 13. Fill small holes
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Filling small foreground holes.'
      );

      const holeFillingStartedAt =
        now();

      if (
        refinementConfig
          .fillSmallHoles
      ) {
        const maximumHoleArea =
          Math.max(
            refinementConfig
              .maximumHoleArea,
            Math.round(
              workingMask
                .data
                .length *
              refinementConfig
                .maximumHoleAreaRatio
            )
          );

        const holeResult =
          fillBackgroundHolesV2(
            workingMask,
            adaptiveThreshold
              .threshold,
            maximumHoleArea,
            requestId,
            context
              .cancellationSignal
          );

        workingMask =
          holeResult.mask;

        context
          .filledHoleCount +=
            holeResult
              .filledHoleCount;

        context
          .filledHolePixelCount +=
            holeResult
              .filledHolePixelCount;
      }

      context
        .timings
        .fillHolesMs =
          Math.max(
            0,
            now() -
              holeFillingStartedAt
          );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 14. Morphology
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Applying safe mask morphology.'
      );

      const morphologyStartedAt =
        now();

      if (
        refinementConfig
          .applyMorphology
      ) {
        const configuredRadius =
          Math.max(
            refinementConfig
              .closingRadius,
            refinementConfig
              .openingRadius,
            refinementConfig
              .erosionRadius,
            refinementConfig
              .dilationRadius,
            refinementConfig
              .finalExpansionRadius
          );

        const morphologyResult =
          applySmartMorphologyV2(
            workingMask,
            adaptiveThreshold
              .threshold,
            configuredRadius,
            requestId,
            context
              .cancellationSignal
          );

        workingMask =
          morphologyResult
            .mask;

        context
          .morphologyApplied =
            morphologyResult
              .applied;
      }

      context
        .timings
        .morphologyMs =
          Math.max(
            0,
            now() -
              morphologyStartedAt
          );

      /* =====================================================
       * 15. Recover thin details
       * =================================================== */

      workingMask =
  recoverFineDetailsV2(
    workingMask,
    v3RefinedReference,
    adaptiveThreshold
      .threshold,
    0.72,
    requestId,
    context
      .cancellationSignal
  );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 16. Foreground region verification
       * =================================================== */

      const verificationResult:
        ForegroundVerificationResult = {
        mask:
          workingMask,

        seedPixelCount:
          0,

        acceptedPixelCount:
          0,

        removedPixelCount:
          0,

        applied:
          false,

        warnings:
          [],
      };

      appendUniqueWarnings(
        context.warnings,
        verificationResult
          .warnings
      );

      workingMask =
        verificationResult
          .mask;

      /* =====================================================
       * 17. Alpha curve
       * =================================================== */

      workingMask =
        refineAlphaCurveV2(
          workingMask,
          adaptiveThreshold
            .threshold,
          requestId,
          context
            .cancellationSignal
        );

      /* =====================================================
       * 18. Edge-aware smoothing
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Applying edge-aware alpha smoothing.'
      );

      const smoothingStartedAt =
        now();

      const smoothingPasses =
        Math.max(
          0,
          Math.min(
            3,
            Math.round(
              refinementConfig
                .smoothingPasses
            )
          )
        );

      for (
        let pass = 0;
        pass <
          smoothingPasses;
        pass += 1
      ) {
        assertNotCancelled(
          context
            .cancellationSignal
        );

        workingMask =
         applyEdgeAwareSmoothingV2(
  workingMask,
  v3RefinedReference,
            refinementConfig
              .smoothingRadius,
            0.52,
            requestId,
            context
              .cancellationSignal
          );
      }

      context
        .timings
        .smoothingMs =
          Math.max(
            0,
            now() -
              smoothingStartedAt
          );

      /* =====================================================
       * 19. Feather
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Applying edge-aware feathering.'
      );

      const featherStartedAt =
        now();

      if (
        refinementConfig
          .featherRadius >
        0
      ) {
        workingMask =
         applyEdgeAwareFeatherV2(
  workingMask,
  v3RefinedReference,
            refinementConfig
              .featherRadius,
            requestId,
            context
              .cancellationSignal
          );

        context
          .featherApplied =
            true;
      }

      context
        .timings
        .featherMs =
          Math.max(
            0,
            now() -
              featherStartedAt
          );

      /* =====================================================
       * 20. Anti-halo
       * =================================================== */

      workingMask =
      applyAntiHaloV2(
  workingMask,
  v3RefinedReference,
          adaptiveThreshold
            .threshold,
          requestId,
          context
            .cancellationSignal
        );

      /*
       * Pre-restore matte polish removed.
       *
       * The final polish after restore + edge protection
       * remains authoritative. Avoiding this earlier pass
       * saves a full Float32 mask allocation and full-image
       * pixel traversal, while also avoiding sharpening the
       * matte before bilinear restoration.
       */

      assertNotCancelled(
        context
          .cancellationSignal
      );


      /* =====================================================
       * 22. Original mask statistics
       * =================================================== */

      const originalAlphaMask =
        convertToAlphaMaskV2(
          croppedMask,
          refinementConfig
            .minimumAlpha,
          refinementConfig
            .maximumAlpha,
          requestId,
          context
            .cancellationSignal
        );

      const originalStatistics =
        calculateMaskStatisticsV2(
          originalAlphaMask,
          context
            .cancellationSignal
        );

      /* =====================================================
       * 23. Restore original image size
       * =================================================== */

      emitProgress(
        context,
        'restore-original-size',
        'Restoring the mask to the original image size.'
      );

      const restoreStartedAt =
        now();

      const restoredMask =
        resizeFloatMaskBilinearV2(
          workingMask,
          input.transform
            .originalSize
            .width,
          input.transform
            .originalSize
            .height,
          requestId,
          context
            .cancellationSignal
        );

      /*
       * مهم:
       * المرجع يجب أن يكون croppedMask الأصلي،
       * وليس refinedMask أو restoredMask.
       */
    const restoredReference =
  resizeFloatMaskBilinearV2(
    v3RefinedReference,
          input.transform
            .originalSize
            .width,
          input.transform
            .originalSize
            .height,
          requestId,
          context
            .cancellationSignal
        );

      context
        .timings
        .restoreOriginalSizeMs =
          Math.max(
            0,
            now() -
              restoreStartedAt
          );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 24. Protect original edges
       * =================================================== */

      emitProgress(
        context,
        'protect-object-edges',
        'Protecting original object boundaries.'
      );

     const edgeProtectionStartedAt =
  now();

let protectedMask =
  restoredMask;

if (
  refinementConfig
    .edgeProtection
) {
  const edgeProtectionResult =
    protectOriginalObjectEdgesV2(
      restoredMask,
      restoredReference,
      adaptiveThreshold
        .threshold,
      requestId,
      context
        .cancellationSignal
    );

  protectedMask =
    edgeProtectionResult
      .mask;

  context
    .edgeProtectionApplied =
      edgeProtectionResult
        .applied;

  if (
    edgeProtectionResult
      .recoveredPixelCount >
    0
  ) {
    appendUniqueWarning(
      context.warnings,
      `Edge protection recovered ${edgeProtectionResult.recoveredPixelCount} boundary pixels.`
    );
  }
}

context
  .timings
  .protectEdgesMs =
    Math.max(
      0,
      now() -
        edgeProtectionStartedAt
    );

      /* =====================================================
       * 25. Final matte polish
       * =================================================== */

      protectedMask =
        polishMatteV2(
          protectedMask,
          requestId,
          context
            .cancellationSignal
        );

      assertNotCancelled(
        context
          .cancellationSignal
      );

      /* =====================================================
       * 26. Convert to alpha
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Converting the refined mask to alpha.'
      );

      const alphaConversionStartedAt =
        now();

      const alphaMask =
        convertToAlphaMaskV2(
          protectedMask,
          refinementConfig
            .minimumAlpha,
          refinementConfig
            .maximumAlpha,
          requestId,
          context
            .cancellationSignal
        );

      context
        .timings
        .convertToAlphaMs =
          Math.max(
            0,
            now() -
              alphaConversionStartedAt
          );

      /* =====================================================
       * 27. Statistics
       * =================================================== */

      emitProgress(
        context,
        'refine-alpha-mask',
        'Calculating final mask statistics.'
      );

      const statisticsStartedAt =
        now();

      const refinedStatistics =
        calculateMaskStatisticsV2(
          alphaMask,
          context
            .cancellationSignal
        );

      context
        .timings
        .statisticsMs =
          Math.max(
            0,
            now() -
              statisticsStartedAt
          );

      appendQualityWarnings(
        context,
        originalStatistics,
        refinedStatistics
      );

      assertUsefulMaskV2(
        refinedStatistics,
        requestId,
        selectedCandidate
          .candidateIndex,
        selectedCandidate
          .combinedScore
      );

      if (
        refinementConfig
          .rejectInvalidForegroundRatio &&
        (
          refinedStatistics
            .foregroundRatio <
            refinementConfig
              .minimumForegroundRatio ||
          refinedStatistics
            .foregroundRatio >
            refinementConfig
              .maximumForegroundRatio
        )
      ) {
        throw new SegmentationError(
          'MASK_INVALID',
          'The refined foreground ratio is outside the configured safe range.',
          {
            requestId,

            component:
              'decoder',

            stage:
              'refine-alpha-mask',

            retryable:
              true,

            metadata: {
              foregroundRatio:
                refinedStatistics
                  .foregroundRatio,

              minimumForegroundRatio:
                refinementConfig
                  .minimumForegroundRatio,

              maximumForegroundRatio:
                refinementConfig
                  .maximumForegroundRatio,
            },
          }
        );
      }

      /* =====================================================
       * 28. Diagnostics and result
       * =================================================== */

      const diagnostics =
        createDiagnosticsV2(
          context,
          originalStatistics,
          refinedStatistics
        );

      context
        .timings
        .totalMs =
          Math.max(
            0,
            now() -
              startedAt
          );

      emitProgress(
        context,
        'complete',
        'EdgeSAM mask postprocessing completed.'
      );

     return {
  selectedMask,

  refinedMask:
    workingMask,

  restoredMask:
    protectedMask,

  alphaMask,

  statistics:
    refinedStatistics,

  diagnostics,

  timings:
    context.timings,
};
    } catch (error) {
      context
        .timings
        .totalMs =
          Math.max(
            0,
            now() -
              startedAt
          );

      if (
        isSegmentationError(
          error
        )
      ) {
        throw error;
      }

      throw new SegmentationError(
        'MASK_PROCESSING_FAILED',
        `EdgeSAM mask postprocessing failed: ${getUnknownErrorMessage(
          error
        )}`,
        {
          requestId,

          component:
            'decoder',

          stage:
            'refine-alpha-mask',

          retryable:
            true,

          cause:
            error,

          metadata: {
            elapsedMs:
              context
                .timings
                .totalMs,
          },
        }
      );
    }
  }
}

/* =========================================================
 * Functional API
 * ======================================================= */

export async function postprocessEdgeSamMaskV2(
  input:
    SegmentationPostprocessorV2Input
): Promise<
  SegmentationPostprocessResult
> {
  const postprocessor =
    new SegmentationPostprocessorV2(
      input.config ??
        DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return postprocessor.process(
    input
  );
}

/**
 * Compatibility API.
 *
 * يحافظ على الاسم المستخدم قبل إضافة V3.
 */
export async function postprocessEdgeSamMask(
  input:
    SegmentationPostprocessorInput
): Promise<
  SegmentationPostprocessResult
> {
  return postprocessEdgeSamMaskV2(
    input
  );
}

/* =========================================================
 * Compatibility class
 * ======================================================= */

export class EdgeSamPostprocessorV2
  extends SegmentationPostprocessorV2 {}

/**
 * Compatibility aliases.
 */
export const PostprocessorV2 =
  SegmentationPostprocessorV2;

export const Postprocessor =
  SegmentationPostprocessorV2;

  /**
 * Compatibility exports المطلوبة بواسطة Postprocessor.ts
 */
export class SegmentationPostprocessor
  extends SegmentationPostprocessorV2 {}

export const postprocessSegmentationMaskV2 =
  postprocessEdgeSamMaskV2;

export const postprocessSegmentationMask =
  postprocessEdgeSamMask;

export default SegmentationPostprocessorV2;

/* =========================================================
 * End of file
 * ======================================================= */