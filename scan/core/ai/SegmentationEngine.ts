// scan/core/ai/SegmentationEngine.ts
// Part 1/2
//
// Triple N - EdgeSAM Segmentation Engine
//
// هذا الملف يربط بين:
//
// 1. Preprocessor.
// 2. EdgeSAM Encoder Session.
// 3. Automatic / Manual Prompt generation.
// 4. Decoder input creation.
// 5. EdgeSAM Decoder Session.
// 6. Postprocessor.
// 7. Timings, retries, diagnostics and engine state.
//
// هذا الملف لا يعدّل:
//
// - types.ts
// - modelConfig.ts
// - Preprocessor.ts
// - SegmentationSession.ts
// - Postprocessor.ts

import {
  Platform,
} from 'react-native';

import {
  DEFAULT_SEGMENTATION_MODEL_CONFIG,
  cloneSegmentationModelConfig,
  validateSegmentationModelConfig,
} from './modelConfig';

import {
  SegmentationPreprocessor,
} from './Preprocessor';

import {
  generateEdgeSamPrompt,
} from './PromptGenerator';

import {
  SegmentationPostprocessor,
} from './PostprocessorV2';

import {
  SegmentationSession,
} from './SegmentationSession';

import type {
  EdgeSamDecoderInputBuildResult,
  EdgeSamDecoderInputs,
  EdgeSamDecoderRawOutput,
  EdgeSamDecoderResult,
  EdgeSamHasMaskInputTensor,
  EdgeSamImageEmbedding,
  EdgeSamMaskCandidate,
  EdgeSamMaskCandidateCollection,
  EdgeSamMaskInputTensor,
  EdgeSamMaskSelectionDiagnostics,
  EdgeSamMaskSelectionResult,
  EdgeSamOriginalImageSizeTensor,
  EdgeSamPointCoordinatesTensor,
  EdgeSamPointLabelsTensor,
  EdgeSamPreviousMaskPrompt,
  EdgeSamPrompt,
  EdgeSamPromptGenerationResult,
  SegmentationCancellationSignal,
  SegmentationDiagnostics,
  SegmentationEngineDiagnostics,
  SegmentationEngineInitializeRequest,
  SegmentationEngineInitializeResult,
  SegmentationEngineState,
  SegmentationEngineStatistics,
  SegmentationErrorCode,
  SegmentationInferenceAttempt,
  SegmentationModelConfig,
  SegmentationPipelineStage,
  SegmentationPlatform,
  SegmentationPostprocessResult,
  SegmentationPreprocessResult,
  SegmentationProgressCallback,
  SegmentationProgressEvent,
  SegmentationRequest,
  SegmentationRequestOptions,
  SegmentationResult,
  SegmentationRuntime,
  SegmentationSessionLoadResult,
  SegmentationStageTiming,
  SegmentationTensor,
  SegmentationTimings,
  SegmentationTransform,
} from './types';

import {
  SegmentationError,
  clampUnitValue,
  createInitialEngineStatistics,
  createMaskCandidateId,
  createSegmentationProgressEvent,
  createSegmentationRequestId,
  createSegmentationStageTiming,
  isRetryableSegmentationError,
  isSegmentationError,
  isSegmentationSource,
  safeSegmentationDivide,
  toSegmentationError
} from './types';

import {
  analyzePromptFailureV3,
} from './PromptFailureAnalyzerV3';

import type {
  PromptFailureAnalysisResultV3,
} from './PromptFailureAnalyzerV3';

import {
  generateAdaptivePromptV4,
} from './AdaptivePromptGeneratorV4';

import {
  createIterativePromptRefinerDependenciesV3,
  getBestIterationResultV3,
  refinePromptIterativelyV3,
} from './IterativePromptRefinerV3';

import type {
  IterativeFailureAnalysisResult,
  IterativePromptRefinementResult,
} from './IterativePromptRefinerV3';

/* =========================================================
 * Constants
 * ======================================================= */

const MINIMUM_INFERENCE_ATTEMPTS =
  1;

const MAXIMUM_INFERENCE_ATTEMPTS =
  3;

const DEFAULT_RETRY_BASE_DELAY_MS =
  250;

const MAXIMUM_PROMPT_POINTS =
  64;

const MINIMUM_PROMPT_POINT_COUNT =
  1;

const ENGINE_WARNING_LIMIT =
  100;

/* =========================================================
 * Internal types
 * ======================================================= */

type EncoderSessionRunResult = Awaited<
  ReturnType<
    SegmentationSession[
      'runEncoder'
    ]
  >
>;

type QueuedEngineOperation<T> = {
  requestId:
    string;

  execute:
    () => Promise<T>;
};

type MutableEngineStatistics = {
  initializedAt:
    number | null;

  processedRequests:
    number;

  completedRequests:
    number;

  failedRequests:
    number;

  cancelledRequests:
    number;

  encoderRuns:
    number;

  decoderRuns:
    number;

  embeddingCacheHits:
    number;

  embeddingCacheMisses:
    number;

  sessionReloads:
    number;

  totalProcessingMs:
    number;

  averageProcessingMs:
    number;

  averageEncoderInferenceMs:
    number;

  averageDecoderInferenceMs:
    number;

  averagePostprocessingMs:
    number;

  lastCompletedAt:
    number | null;

  lastFailedAt:
    number | null;

  lastCancelledAt:
    number | null;
};

type RunningAverages = {
  encoderInferenceTotalMs:
    number;

  decoderInferenceTotalMs:
    number;

  postprocessingTotalMs:
    number;

  encoderSampleCount:
    number;

  decoderSampleCount:
    number;

  postprocessingSampleCount:
    number;
};

type EngineRunContext = {
  requestId:
    string;

  startedAt:
    number;

  options:
    SegmentationRequestOptions;

  config:
    SegmentationModelConfig;

  signal?:
    SegmentationCancellationSignal;

  onProgress?:
    SegmentationProgressCallback;

  stageTimings:
    SegmentationStageTiming[];

  attempts:
    SegmentationInferenceAttempt[];

  warnings:
    string[];
};

/* =========================================================
 * Time helpers
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function delay(
  durationMs:
    number,
  signal?:
    SegmentationCancellationSignal
): Promise<void> {
  const safeDurationMs =
    Math.max(
      0,
      Math.round(
        durationMs
      )
    );

  if (
    safeDurationMs ===
    0
  ) {
    signal?.throwIfCancelled();

    return Promise.resolve();
  }

  return new Promise<void>(
    (
      resolve,
      reject
    ) => {
      let settled =
        false;

      const timeout =
        setTimeout(
          () => {
            if (settled) {
              return;
            }

            settled =
              true;

            try {
              signal?.throwIfCancelled();

              resolve();
            } catch (error) {
              reject(
                error
              );
            }
          },
          safeDurationMs
        );

      try {
        signal?.throwIfCancelled();
      } catch (error) {
        settled =
          true;

        clearTimeout(
          timeout
        );

        reject(
          error
        );
      }
    }
  );
}

/* =========================================================
 * Configuration
 * ======================================================= */

function mergeSegmentationModelConfig(
  base:
    SegmentationModelConfig,
  override?:
    Partial<SegmentationModelConfig>
): SegmentationModelConfig {
  if (!override) {
    return validateSegmentationModelConfig(
      cloneSegmentationModelConfig(
        base
      )
    );
  }

  const merged:
    SegmentationModelConfig = {
    ...base,

    ...override,

    assets: {
      ...base.assets,

      ...override.assets,

      encoder: {
        ...base.assets.encoder,

        ...override.assets
          ?.encoder,
      },

      decoder: {
        ...base.assets.decoder,

        ...override.assets
          ?.decoder,
      },
    },

    encoder: {
      ...base.encoder,

      ...override.encoder,

      input: {
        ...base.encoder.input,

        ...override.encoder
          ?.input,

        normalization: {
          ...base.encoder
            .input
            .normalization,

          ...override.encoder
            ?.input
            ?.normalization,
        },
      },

      output: {
        ...base.encoder.output,

        ...override.encoder
          ?.output,
      },

      session: {
        ...base.encoder.session,

        ...override.encoder
          ?.session,
      },
    },

    decoder: {
      ...base.decoder,

      ...override.decoder,

      config: {
        ...base.decoder.config,

        ...override.decoder
          ?.config,

        inputNames: {
          ...base.decoder
            .config
            .inputNames,

          ...override.decoder
            ?.config
            ?.inputNames,
        },

        outputNames: {
          ...base.decoder
            .config
            .outputNames,

          ...override.decoder
            ?.config
            ?.outputNames,
        },

        maskInputSize: {
          ...base.decoder
            .config
            .maskInputSize,

          ...override.decoder
            ?.config
            ?.maskInputSize,
        },
      },

      session: {
        ...base.decoder.session,

        ...override.decoder
          ?.session,
      },
    },

    automaticPrompt: {
      ...base.automaticPrompt,

      ...override.automaticPrompt,
    },

    selection: {
      ...base.selection,

      ...override.selection,

      weights: {
        ...base.selection
          .weights,

        ...override.selection
          ?.weights,
      },
    },

    refinement: {
      ...base.refinement,

      ...override.refinement,
    },

    embeddingCache: {
      ...base.embeddingCache,

      ...override.embeddingCache,
    },
  };

  return validateSegmentationModelConfig(
    cloneSegmentationModelConfig(
      merged
    )
  );
}

/* =========================================================
 * Platform helpers
 * ======================================================= */

function resolvePlatform():
  SegmentationPlatform {
  switch (
    Platform.OS
  ) {
    case 'ios':
      return 'ios';

    case 'android':
      return 'android';

    case 'windows':
      return 'windows';

    case 'macos':
      return 'macos';

    case 'web':
      return 'web';

    default:
      return 'unknown';
  }
}

function resolveRuntime():
  SegmentationRuntime {
  return 'onnx';
}

/* =========================================================
 * Engine state helpers
 * ======================================================= */

function isCancellationError(
  error:
    unknown
): boolean {
  return (
    isSegmentationError(
      error
    ) &&
    (
      error.code ===
        'REQUEST_CANCELLED' ||
      error.code ===
        'CANCELLED'
    )
  );
}

function normalizeEngineError(
  error:
    unknown,
  requestId:
    string,
  fallbackCode:
    SegmentationErrorCode,
  fallbackMessage:
    string,
  stage?:
    SegmentationPipelineStage
): SegmentationError {
  if (
    isSegmentationError(
      error
    )
  ) {
    if (
      error.requestId
    ) {
      return error;
    }

    return new SegmentationError(
      error.code,
      error.message,
      {
        requestId,

        stage:
          error.stage ??
          stage,

        component:
          error.component,

        retryable:
          error.retryable,

        attempt:
          error.attempt,

        cause:
          error.cause ??
          error,

        metadata:
          error.metadata,
      }
    );
  }

  return toSegmentationError(
    error,
    fallbackCode,
    fallbackMessage,
    {
      requestId,

      stage,

      cause:
        error,

      retryable:
        false,
    }
  );
}

/* =========================================================
 * Progress
 * ======================================================= */

function emitProgress(
  context:
    EngineRunContext,
  stage:
    SegmentationPipelineStage,
  message:
    string,
  metadata?: Record<
    string,
    string | number | boolean | null
  >
): void {
  context.signal
    ?.throwIfCancelled();

  if (
    !context.onProgress
  ) {
    return;
  }

  try {
    context.onProgress(
      createSegmentationProgressEvent(
        context.requestId,
        stage,
        context.startedAt,
        message,
        metadata
      )
    );
  } catch (error) {
    console.log(
      'EDGESAM ENGINE PROGRESS ERROR:',
      error
    );
  }
}

function createProgressForwarder(
  context:
    EngineRunContext
): SegmentationProgressCallback {
  return (
    event:
      SegmentationProgressEvent
  ) => {
    context.signal
      ?.throwIfCancelled();

    if (
      !context.onProgress
    ) {
      return;
    }

    try {
      context.onProgress({
        ...event,

        requestId:
          context.requestId,

        elapsedMs:
          Math.max(
            0,
            now() -
              context.startedAt
          ),
      });
    } catch (error) {
      console.log(
        'EDGESAM ENGINE FORWARDED PROGRESS ERROR:',
        error
      );
    }
  };
}

/* =========================================================
 * Stage timings
 * ======================================================= */

function startStage():
  number {
  return now();
}

function finishStage(
  context:
    EngineRunContext,
  stage:
    SegmentationPipelineStage,
  startedAt:
    number
): void {
  context.stageTimings.push(
    createSegmentationStageTiming(
      stage,
      startedAt,
      now()
    )
  );
}

function addPreprocessStageTimings(
  context:
    EngineRunContext,
  preprocess:
    SegmentationPreprocessResult
): void {
  const timings =
    preprocess.timings;

  const stages: readonly [
    SegmentationPipelineStage,
    number,
  ][] = [
    [
      'validate-input',
      timings.validateInputMs,
    ],

    [
      'load-image',
      timings.loadImageMs,
    ],

    [
      'correct-orientation',
      timings.correctOrientationMs,
    ],

    [
      'decode-pixels',
      timings.decodePixelsMs,
    ],

    [
      'resize-image',
      timings.resizeImageMs,
    ],

    [
      'apply-letterbox',
      timings.applyLetterboxMs,
    ],

    [
      'normalize-pixels',
      timings.normalizePixelsMs,
    ],

    [
      'create-encoder-tensor',
      timings.createEncoderTensorMs,
    ],
  ];

  let cursor =
    context.startedAt;

  for (
    const [
      stage,
      durationMs,
    ] of stages
  ) {
    const safeDurationMs =
      Math.max(
        0,
        durationMs
      );

    const completedAt =
      cursor +
      safeDurationMs;

    context.stageTimings.push({
      stage,

      startedAt:
        cursor,

      completedAt,

      durationMs:
        safeDurationMs,
    });

    cursor =
      completedAt;
  }
}

/* =========================================================
 * Source identifiers
 * ======================================================= */

function createSourceId(
  request:
    SegmentationRequest,
  requestId:
    string
): string {
  const source =
    request.source;

  if (
    'id' in source &&
    typeof source.id ===
      'string' &&
    source.id.trim()
      .length > 0
  ) {
    return source.id.trim();
  }

  if (
    'uri' in source
  ) {
    return [
      'uri',
      source.uri,
      source.width ??
        'unknown-width',
      source.height ??
        'unknown-height',
    ].join(':');
  }

  return [
    'rgba',
    source.width,
    source.height,
    source.rgba.byteLength,
    requestId,
  ].join(':');
}

/* =========================================================
 * Decoder prompt tensors
 * ======================================================= */

function buildDecoderPromptEntries(
  prompt:
    EdgeSamPrompt
): {
  coordinates:
    number[];

  labels:
    number[];
} {
  const coordinates:
    number[] =
      [];

  const labels:
    number[] =
      [];

  for (
    const point of
      prompt.points
  ) {
    if (
      coordinates.length /
        2 >=
      MAXIMUM_PROMPT_POINTS
    ) {
      break;
    }

    coordinates.push(
      point.x,
      point.y
    );

    labels.push(
      point.label
    );
  }

  if (
    prompt.box &&
    coordinates.length /
      2 <=
      MAXIMUM_PROMPT_POINTS -
        2
  ) {
    coordinates.push(
      prompt.box.box.x1,
      prompt.box.box.y1,
      prompt.box.box.x2,
      prompt.box.box.y2
    );

    labels.push(
      2,
      3
    );
  }

  if (
    labels.length <
      MINIMUM_PROMPT_POINT_COUNT
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'EdgeSAM decoder input requires at least one prompt point.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,
      }
    );
  }

  return {
    coordinates,

    labels,
  };
}

function createPointCoordinatesTensor(
  prompt:
    EdgeSamPrompt,
  config:
    SegmentationModelConfig
): EdgeSamPointCoordinatesTensor {
  const entries =
    buildDecoderPromptEntries(
      prompt
    );

  const pointCount =
    entries.labels.length;

  return {
    name:
      config.decoder
        .config
        .inputNames
        .pointCoordinates,

    data:
      new Float32Array(
        entries.coordinates
      ),

    dimensions: [
      1,
      pointCount,
      2,
    ],

    dataType:
      'float32',

    layout:
      'unknown',

    pointCount,
  };
}

function createPointLabelsTensor(
  prompt:
    EdgeSamPrompt,
  config:
    SegmentationModelConfig
): EdgeSamPointLabelsTensor {
  const entries =
    buildDecoderPromptEntries(
      prompt
    );

  const pointCount =
    entries.labels.length;

  return {
    name:
      config.decoder
        .config
        .inputNames
        .pointLabels,

    data:
      new Float32Array(
        entries.labels
      ),

    dimensions: [
      1,
      pointCount,
    ],

    dataType:
      'float32',

    layout:
      'unknown',

    pointCount,
  };
}

function resizePreviousMaskToDecoderInput(
  previousMask:
    EdgeSamPreviousMaskPrompt,
  destinationWidth:
    number,
  destinationHeight:
    number,
  signal?:
    SegmentationCancellationSignal
): Float32Array {
  const sourceDimensions =
    previousMask.dimensions;

  let sourceHeight =
    previousMask.height;

  let sourceWidth =
    previousMask.width;

  if (
    sourceDimensions.length >=
      2
  ) {
    sourceHeight =
      sourceDimensions[
        sourceDimensions.length -
          2
      ];

    sourceWidth =
      sourceDimensions[
        sourceDimensions.length -
          1
      ];
  }

  if (
    sourceWidth <=
      0 ||
    sourceHeight <=
      0 ||
    previousMask.data.length !==
      sourceWidth *
      sourceHeight
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'The previous-mask prompt dimensions are invalid.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,
      }
    );
  }

  if (
    sourceWidth ===
      destinationWidth &&
    sourceHeight ===
      destinationHeight
  ) {
    return new Float32Array(
      previousMask.data
    );
  }

  const output =
    new Float32Array(
      destinationWidth *
      destinationHeight
    );

  const xScale =
    sourceWidth /
    destinationWidth;

  const yScale =
    sourceHeight /
    destinationHeight;

  for (
    let y = 0;
    y <
      destinationHeight;
    y += 1
  ) {
    if (
      y %
        32 ===
      0
    ) {
      signal
        ?.throwIfCancelled();
    }

    const sourceY =
      Math.max(
        0,
        Math.min(
          sourceHeight -
            1,
          Math.round(
            (
              y +
              0.5
            ) *
              yScale -
            0.5
          )
        )
      );

    for (
      let x = 0;
      x <
        destinationWidth;
      x += 1
    ) {
      const sourceX =
        Math.max(
          0,
          Math.min(
            sourceWidth -
              1,
          Math.round(
            (
              x +
              0.5
            ) *
              xScale -
            0.5
          )
        )
      );

      output[
        y *
          destinationWidth +
        x
      ] =
        previousMask.data[
          sourceY *
            sourceWidth +
          sourceX
        ];
    }
  }

  return output;
}

function createMaskInputTensor(
  prompt:
    EdgeSamPrompt,
  config:
    SegmentationModelConfig,
  signal?:
    SegmentationCancellationSignal
): EdgeSamMaskInputTensor {
  const width =
    config.decoder
      .config
      .maskInputSize
      .width;

  const height =
    config.decoder
      .config
      .maskInputSize
      .height;

  const data =
    prompt.previousMask
      ? resizePreviousMaskToDecoderInput(
          prompt.previousMask,
          width,
          height,
          signal
        )
      : new Float32Array(
          width *
          height
        );

  if (
    !prompt.previousMask &&
    config.decoder
      .config
      .emptyMaskValue !==
      0
  ) {
    data.fill(
      config.decoder
        .config
        .emptyMaskValue
    );
  }

  return {
    name:
      config.decoder
        .config
        .inputNames
        .maskInput,

    data,

    dimensions: [
      1,
      1,
      height,
      width,
    ],

    dataType:
      'float32',

    layout:
      'NCHW',

    width,

    height,
  };
}

function createHasMaskInputTensor(
  prompt:
    EdgeSamPrompt,
  config:
    SegmentationModelConfig
): EdgeSamHasMaskInputTensor {
  const hasMask =
    prompt.previousMask !==
    null;

  return {
    name:
      config.decoder
        .config
        .inputNames
        .hasMaskInput,

    data:
      new Float32Array([
        hasMask
          ? 1
          : 0,
      ]),

    dimensions: [
      1,
    ],

    dataType:
      'float32',

    layout:
      'unknown',

    hasMask,
  };
}

function createOriginalImageSizeTensor(
  transform:
    SegmentationTransform,
  config:
    SegmentationModelConfig
): EdgeSamOriginalImageSizeTensor {
  const decoderConfig =
    config.decoder
      .config;

  const height =
    transform.orientedSize
      .height;

  const width =
    transform.orientedSize
      .width;

  const values =
    decoderConfig
      .originalImageSizeOrder ===
      'height-width'
      ? [
          height,
          width,
        ]
      : [
          width,
          height,
        ];

  if (
    decoderConfig
      .originalImageSizeDataType ===
      'int64'
  ) {
    if (
      typeof BigInt64Array ===
      'undefined'
    ) {
      throw new SegmentationError(
        'DECODER_INPUT_CREATION_FAILED',
        'BigInt64Array is unavailable for the EdgeSAM original-image-size tensor.',
        {
          stage:
            'create-decoder-inputs',

          component:
            'decoder',

          retryable:
            false,
        }
      );
    }

    return {
      name:
        decoderConfig
          .inputNames
          .originalImageSize,

      data:
        new BigInt64Array([
          BigInt(
            Math.round(
              values[0]
            )
          ),

          BigInt(
            Math.round(
              values[1]
            )
          ),
        ]),

      dimensions: [
        2,
      ],

      dataType:
        'int64',

      layout:
        'unknown',

      height,

      width,
    };
  }

  return {
    name:
      decoderConfig
        .inputNames
        .originalImageSize,

    data:
      new Float32Array(
        values
      ),

    dimensions: [
      2,
    ],

    dataType:
      'float32',

    layout:
      'unknown',

    height,

    width,
  };
}

function createEmbeddingFeedTensor(
  embedding:
    EdgeSamImageEmbedding,
  config:
    SegmentationModelConfig
): SegmentationTensor {
  return {
    name:
      config.decoder
        .config
        .inputNames
        .imageEmbeddings,

    data:
      embedding.data,

    dimensions: [
      ...embedding
        .dimensions,
    ],

    dataType:
      'float32',

    layout:
      embedding.layout,
  };
}

/* =========================================================
 * Decoder input builder
 * ======================================================= */

async function buildEdgeSamDecoderInputs(
  embedding:
    EdgeSamImageEmbedding,
  prompt:
    EdgeSamPrompt,
  transform:
    SegmentationTransform,
  config:
    SegmentationModelConfig,
  signal?:
    SegmentationCancellationSignal
): Promise<
  EdgeSamDecoderInputBuildResult
> {
  const startedAt =
    now();

  signal
    ?.throwIfCancelled();

  const pointCoordinates =
    createPointCoordinatesTensor(
      prompt,
      config
    );

  const pointLabels =
    createPointLabelsTensor(
      prompt,
      config
    );

  const maskInput =
    createMaskInputTensor(
      prompt,
      config,
      signal
    );

  const hasMaskInput =
    createHasMaskInputTensor(
      prompt,
      config
    );

  const originalImageSize =
    createOriginalImageSizeTensor(
      transform,
      config
    );

  const embeddingTensor =
    createEmbeddingFeedTensor(
      embedding,
      config
    );

  const feeds:
    Record<
      string,
      SegmentationTensor
    > = {
    [embeddingTensor.name]:
      embeddingTensor,

    [pointCoordinates.name]:
      pointCoordinates,

    [pointLabels.name]:
      pointLabels,

    [maskInput.name]:
      maskInput,

    [hasMaskInput.name]:
      hasMaskInput,

    [originalImageSize.name]:
      originalImageSize,
  };

  const inputs:
    EdgeSamDecoderInputs = {
    imageEmbedding:
      embedding,

    pointCoordinates,

    pointLabels,

    maskInput,

    hasMaskInput,

    originalImageSize,

    prompt,

    feeds,
  };

  return {
    inputs,

    warnings: [],

    durationMs:
      Math.max(
        0,
        now() -
          startedAt
      ),
  };
}

/* =========================================================
 * Inference attempts
 * ======================================================= */

function normalizeMaximumAttempts(
  requested:
    number | undefined,
  configured:
    number
): number {
  const resolved =
    requested ??
    configured;

  if (
    !Number.isFinite(
      resolved
    )
  ) {
    return MINIMUM_INFERENCE_ATTEMPTS;
  }

  return Math.max(
    MINIMUM_INFERENCE_ATTEMPTS,
    Math.min(
      MAXIMUM_INFERENCE_ATTEMPTS,
      Math.round(
        resolved
      )
    )
  );
}

async function runWithInferenceAttempts<T>(
  context:
    EngineRunContext,
  component:
    'encoder' | 'decoder',
  operation:
    (
      attempt:
        number
    ) => Promise<T>
): Promise<T> {
  const sessionConfig =
    component ===
      'encoder'
      ? context.config
          .encoder
          .session
      : context.config
          .decoder
          .session;

  const maximumAttempts =
    normalizeMaximumAttempts(
      context.options
        .maximumInferenceAttempts,
      sessionConfig
        .maximumInferenceAttempts
    );

  let lastError:
    unknown =
      null;

  for (
    let attempt = 1;
    attempt <=
      maximumAttempts;
    attempt += 1
  ) {
    context.signal
      ?.throwIfCancelled();

    const attemptStartedAt =
      now();

    try {
      const result =
        await operation(
          attempt
        );

      const completedAt =
        now();

      context.attempts.push({
        attempt,

        component,

        startedAt:
          attemptStartedAt,

        completedAt,

        durationMs:
          Math.max(
            0,
            completedAt -
              attemptStartedAt
          ),

        succeeded:
          true,
      });

      return result;
    } catch (error) {
      lastError =
        error;

      const completedAt =
        now();

      const normalized =
        normalizeEngineError(
          error,
          context.requestId,
          component ===
            'encoder'
            ? 'ENCODER_INFERENCE_FAILED'
            : 'DECODER_INFERENCE_FAILED',
          component ===
            'encoder'
            ? 'EdgeSAM encoder inference failed.'
            : 'EdgeSAM decoder inference failed.',
          component ===
            'encoder'
            ? 'run-image-encoder'
            : 'run-mask-decoder'
        );

      const retryable =
        isRetryableSegmentationError(
          normalized
        );

      context.attempts.push({
        attempt,

        component,

        startedAt:
          attemptStartedAt,

        completedAt,

        durationMs:
          Math.max(
            0,
            completedAt -
              attemptStartedAt
          ),

        succeeded:
          false,

        errorCode:
          normalized.code,

        errorMessage:
          normalized.message,

        retryable,
      });

      if (
        isCancellationError(
          normalized
        )
      ) {
        throw normalized;
      }

      if (
        !retryable ||
        attempt >=
          maximumAttempts
      ) {
        throw normalized;
      }

      const retryBaseDelayMs =
        Math.max(
          0,
          sessionConfig
            .retryBaseDelayMs ||
          DEFAULT_RETRY_BASE_DELAY_MS
        );

      await delay(
        retryBaseDelayMs *
          attempt,
        context.signal
      );
    }
  }

  throw normalizeEngineError(
    lastError,
    context.requestId,
    component ===
      'encoder'
      ? 'ENCODER_INFERENCE_FAILED'
      : 'DECODER_INFERENCE_FAILED',
    component ===
      'encoder'
      ? 'EdgeSAM encoder inference failed after all attempts.'
      : 'EdgeSAM decoder inference failed after all attempts.',
    component ===
      'encoder'
      ? 'run-image-encoder'
      : 'run-mask-decoder'
  );
}

/* =========================================================
 * Candidate helpers
 * ======================================================= */

function resolveMaskCandidateCount(
  decoderOutput:
    EdgeSamDecoderRawOutput
): number {
  const dimensions =
    decoderOutput
      .masksTensor
      .dimensions;

  if (
    dimensions.length ===
      4
  ) {
    return Math.max(
      1,
      dimensions[1]
    );
  }

  if (
    dimensions.length ===
      3
  ) {
    return Math.max(
      1,
      dimensions[0]
    );
  }

  return 1;
}

/* =========================================================
 * Iterative refinement adapters
 * ======================================================= */

function appendUniqueString(
  destination:
    string[],
  value:
    string
): void {
  const normalized =
    value.trim();

  if (
    normalized.length ===
      0 ||
    destination.includes(
      normalized
    )
  ) {
    return;
  }

  destination.push(
    normalized
  );
}

function mapFailureAnalysisToIterativeResult(
  analysis:
    PromptFailureAnalysisResultV3
): IterativeFailureAnalysisResult {
  const positiveSeedPoints:
    {
      x:
        number;

      y:
        number;

      confidence:
        number;
    }[] = [];

  const negativeSeedPoints:
    {
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
    }[] = [];

  for (
    const failure of
      analysis.failures
  ) {
    for (
      const point of
        failure.positivePoints
    ) {
      positiveSeedPoints.push({
        x:
          point.x,

        y:
          point.y,

        confidence:
          clampUnitValue(
            point.confidence
          ),
      });
    }

    for (
      const point of
        failure.negativePoints
    ) {
      let reason:
        | 'background'
        | 'shadow'
        | 'leakage'
        | 'boundary'
        | 'detached-region'
        | 'unknown' =
          'unknown';

      switch (
        failure.category
      ) {
        case 'background-leak':
          reason =
            'background';
          break;

        case 'shadow-leak':
          reason =
            'shadow';
          break;

        case 'boundary-instability':
        case 'excessive-edge-contact':
          reason =
            'boundary';
          break;

        case 'detached-region':
        case 'fragmentation':
          reason =
            'detached-region';
          break;

        case 'oversized-mask':
          reason =
            'leakage';
          break;

        default:
          reason =
            'unknown';
          break;
      }

      negativeSeedPoints.push({
        x:
          point.x,

        y:
          point.y,

        confidence:
          clampUnitValue(
            point.confidence
          ),

        reason,
      });
    }
  }

  const suspiciousRegions:
    {
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
    }[] = [];

  const maskWidth =
    Math.max(
      1,
      analysis.diagnostics
        .maskWidth
    );

  const maskHeight =
    Math.max(
      1,
      analysis.diagnostics
        .maskHeight
    );

  const evidenceRegionWidth =
    Math.max(
      1,
      maskWidth *
        0.025
    );

  const evidenceRegionHeight =
    Math.max(
      1,
      maskHeight *
        0.025
    );

  for (
    const point of
      negativeSeedPoints
  ) {
    let kind:
      | 'background'
      | 'shadow'
      | 'leakage'
      | 'unstable-boundary'
      | 'unknown';

    switch (
      point.reason
    ) {
      case 'background':
        kind =
          'background';
        break;

      case 'shadow':
        kind =
          'shadow';
        break;

      case 'leakage':
      case 'detached-region':
        kind =
          'leakage';
        break;

      case 'boundary':
        kind =
          'unstable-boundary';
        break;

      default:
        kind =
          'unknown';
        break;
    }

    suspiciousRegions.push({
      x:
        Math.max(
          0,
          point.x -
            evidenceRegionWidth /
              2
        ),

      y:
        Math.max(
          0,
          point.y -
            evidenceRegionHeight /
              2
        ),

      width:
        evidenceRegionWidth,

      height:
        evidenceRegionHeight,

      severity:
        point.confidence,

      kind,
    });
  }

  return {
    summary: {
      backgroundLeakDetected:
        analysis.flags
          .backgroundLeakDetected,

      shadowLeakDetected:
        analysis.flags
          .shadowLeakDetected,

      thinStructureLost:
        analysis.flags
          .thinStructureLost,

      foregroundCollapsed:
        analysis.flags
          .foregroundCollapsed,

      unstableBoundary:
        analysis.flags
          .unstableBoundary,

      oversizedMask:
        analysis.flags
          .oversizedMask,

      undersizedMask:
        analysis.flags
          .undersizedMask,

      recommendation:
        analysis
          .recommendedAction,
    },

    confidence:
      clampUnitValue(
        analysis
          .dominantFailure
          ?.confidence ??
        analysis
          .qualityScores
          .overallQualityScore
      ),

    suspiciousRegions,

    positiveSeedPoints,

    negativeSeedPoints,

    warnings: [
      ...analysis.warnings,
    ],
  };
}

/* =========================================================
 * Main class - declaration and lifecycle
 * ======================================================= */

export class SegmentationEngine {
  private config:
    SegmentationModelConfig;

  private session:
    SegmentationSession;

  private state:
    SegmentationEngineState =
      'idle';

  private activeRequestId:
    string | null =
      null;

  private queuedRequestCount =
    0;

  private queue:
    Promise<void> =
      Promise.resolve();

  private statistics:
    MutableEngineStatistics =
      createInitialEngineStatistics();

  private runningAverages:
    RunningAverages = {
    encoderInferenceTotalMs:
      0,

    decoderInferenceTotalMs:
      0,

    postprocessingTotalMs:
      0,

    encoderSampleCount:
      0,

    decoderSampleCount:
      0,

    postprocessingSampleCount:
      0,
  };

  private lastDurationMs:
    number | null =
      null;

  private lastErrorCode:
    SegmentationErrorCode | null =
      null;

  private lastErrorMessage:
    string | null =
      null;

  private warnings:
    string[] =
      [];

  constructor(
    config:
      SegmentationModelConfig =
        DEFAULT_SEGMENTATION_MODEL_CONFIG
  ) {
    this.config =
      validateSegmentationModelConfig(
        cloneSegmentationModelConfig(
          config
        )
      );

    this.session =
      new SegmentationSession(
        this.config
      );
  }

  getState():
    SegmentationEngineState {
    return this.state;
  }

  getConfig():
    SegmentationModelConfig {
    return cloneSegmentationModelConfig(
      this.config
    );
  }

  isReady():
    boolean {
    return (
      this.state ===
        'ready' &&
      this.session.isReady()
    );
  }

  isBusy():
    boolean {
    return (
      this.state ===
        'initializing' ||
      this.state ===
        'processing' ||
      this.activeRequestId !==
        null
    );
  }

  isDisposed():
    boolean {
    return (
      this.state ===
      'disposed'
    );
  }

  private assertNotDisposed(
    requestId?:
      string
  ): void {
    if (
      !this.isDisposed()
    ) {
      return;
    }

    throw new SegmentationError(
      'ENGINE_DISPOSED',
      'The EdgeSAM segmentation engine has been disposed.',
      {
        requestId,

        retryable:
          false,
      }
    );
  }

  private addWarning(
    warning:
      string
  ): void {
    const normalized =
      warning.trim();

    if (
      normalized.length ===
        0 ||
      this.warnings.includes(
        normalized
      )
    ) {
      return;
    }

    this.warnings.push(
      normalized
    );

    if (
      this.warnings.length >
      ENGINE_WARNING_LIMIT
    ) {
      this.warnings.splice(
        0,
        this.warnings.length -
          ENGINE_WARNING_LIMIT
      );
    }
  }

  private async enqueue<T>(
    operation:
      QueuedEngineOperation<T>
  ): Promise<T> {
    this.assertNotDisposed(
      operation.requestId
    );

    this.queuedRequestCount +=
      1;

    const previous =
      this.queue;

    let release:
      () => void =
      () => {};

    this.queue =
      new Promise<void>(
        resolve => {
          release =
            resolve;
        }
      );

    await previous;

    this.queuedRequestCount =
      Math.max(
        0,
        this.queuedRequestCount -
          1
      );

    try {
      this.assertNotDisposed(
        operation.requestId
      );

      return await operation
        .execute();
    } finally {
      release();
    }
  }

  async initialize(
    input:
      SegmentationEngineInitializeRequest = {}
  ): Promise<
    SegmentationEngineInitializeResult
  > {
    const requestId =
      input.requestId ??
      createSegmentationRequestId();

    return this.enqueue({
      requestId,

      execute:
        async () => {
          const startedAt =
            now();

          this.assertNotDisposed(
            requestId
          );

          input
            .cancellationSignal
            ?.throwIfCancelled();

          const nextConfig =
            input.config
              ? validateSegmentationModelConfig(
                  cloneSegmentationModelConfig(
                    input.config
                  )
                )
              : this.config;

          this.state =
            'initializing';

          this.activeRequestId =
            requestId;

          this.lastErrorCode =
            null;

          this.lastErrorMessage =
            null;

          try {
            if (
              input
                .forceSessionReload
            ) {
              this.config =
                nextConfig;

              const sessionLoad =
                await this.session
                  .reload({
                    config:
                      this.config,

                    requestId,

                    onProgress:
                      input.onProgress,

                    cancellationSignal:
                      input
                        .cancellationSignal,

                    warmup:
                      input.warmup,
                  });

              this.statistics
                .sessionReloads +=
                1;

              this.statistics
                .initializedAt =
                now();

              this.state =
                'ready';

              return {
                requestId,

                ready:
                  true,

                sessionLoad,

                durationMs:
                  Math.max(
                    0,
                    now() -
                      startedAt
                  ),

                warnings:
                  sessionLoad
                    .warnings,
              };
            }

            this.config =
              nextConfig;

            const sessionLoad =
              await this.session
                .initialize({
                  config:
                    this.config,

                  requestId,

                  onProgress:
                    input.onProgress,

                  cancellationSignal:
                    input
                      .cancellationSignal,

                  forceReload:
                    false,

                  warmup:
                    input.warmup,
                });

            this.statistics
              .initializedAt =
              this.statistics
                .initializedAt ??
              now();

            this.state =
              'ready';

            for (
              const warning of
                sessionLoad
                  .warnings
            ) {
              this.addWarning(
                warning
              );
            }

            return {
              requestId,

              ready:
                true,

              sessionLoad,

              durationMs:
                Math.max(
                  0,
                  now() -
                    startedAt
                ),

              warnings:
                sessionLoad
                  .warnings,
            };
          } catch (error) {
            const normalized =
              normalizeEngineError(
                error,
                requestId,
                'SESSION_CREATE_FAILED',
                'Unable to initialize the EdgeSAM segmentation engine.',
                'load-model-sessions'
              );

            this.lastErrorCode =
              normalized.code;

            this.lastErrorMessage =
              normalized.message;

            if (
              isCancellationError(
                normalized
              )
            ) {
              this.state =
                'cancelled';

              this.statistics
                .lastCancelledAt =
                now();
            } else {
              this.state =
                'failed';

              this.statistics
                .lastFailedAt =
                now();
            }

            throw normalized;
          } finally {
            this.activeRequestId =
              null;
          }
        },
    });
  }

  /**
   * نهاية Part 1/2.
   *
   * الجزء الثاني يبدأ مباشرة من:
   *
   * async process(
   *   request:
   *     SegmentationRequest
   * ): Promise<SegmentationResult>
   */
  async process(
    request:
      SegmentationRequest
  ): Promise<SegmentationResult> {
    const requestId =
      request.options
        ?.requestId ??
      createSegmentationRequestId();

    const waitForCurrentRequest =
      request.options
        ?.waitForCurrentRequest ??
      true;

    this.assertNotDisposed(
      requestId
    );

    if (
      !isSegmentationSource(
        request.source
      )
    ) {
      throw new SegmentationError(
        'INVALID_INPUT',
        'A valid EdgeSAM image source is required.',
        {
          requestId,

          stage:
            'validate-input',

          retryable:
            false,
        }
      );
    }

    if (
      !waitForCurrentRequest &&
      this.isBusy()
    ) {
      throw new SegmentationError(
        'ENGINE_BUSY',
        'The EdgeSAM segmentation engine is currently processing another request.',
        {
          requestId,

          retryable:
            true,

          metadata: {
            activeRequestId:
              this.activeRequestId,
          },
        }
      );
    }

    return this.enqueue({
      requestId,

      execute:
        () =>
          this.processInternal(
            request,
            requestId
          ),
    });
  }

  private async processInternal(
    request:
      SegmentationRequest,
    requestId:
      string
  ): Promise<SegmentationResult> {
    const startedAt =
      now();

    const options =
      request.options ??
      {};

    const signal =
      options
        .cancellationSignal;

    const onProgress =
      options.onProgress;

    const config =
      mergeSegmentationModelConfig(
        this.config,
        options.config
      );

    const context:
      EngineRunContext = {
      requestId,

      startedAt,

      options,

      config,

      signal,

      onProgress,

      stageTimings: [],

      attempts: [],

      warnings: [],
    };

    this.assertNotDisposed(
      requestId
    );

    signal
      ?.throwIfCancelled();

    this.state =
      'processing';

    this.activeRequestId =
      requestId;

    this.lastErrorCode =
      null;

    this.lastErrorMessage =
      null;

    this.statistics
      .processedRequests +=
      1;

    let preprocessing:
      SegmentationPreprocessResult | null =
        null;

    let sessionLoad:
      SegmentationSessionLoadResult | null =
        null;

    let encoderSessionResult:
      EncoderSessionRunResult | null =
        null;

    let promptGeneration:
      EdgeSamPromptGenerationResult | null =
        null;

    let decoderInputBuild:
      EdgeSamDecoderInputBuildResult | null =
        null;

    let decoderOutput:
      EdgeSamDecoderRawOutput | null =
        null;

    let postprocessing:
      SegmentationPostprocessResult | null =
        null;

    try {
      /* ---------------------------------------------------
       * 1-8. Preprocess image
       * ------------------------------------------------- */

      const requestPreprocessor =
        new SegmentationPreprocessor(
          config
        );

      preprocessing =
        await requestPreprocessor
          .process({
            source:
              request.source,

            config,

            requestId,

            onProgress:
              createProgressForwarder(
                context
              ),

            cancellationSignal:
              signal,
          });

      addPreprocessStageTimings(
        context,
        preprocessing
      );

      signal
        ?.throwIfCancelled();

      /* ---------------------------------------------------
       * 9. Load native model sessions
       * ------------------------------------------------- */

      emitProgress(
        context,
        'load-model-sessions',
        'Loading EdgeSAM model sessions.'
      );

      const sessionLoadStartedAt =
        startStage();

      if (
        options
          .forceSessionReload
      ) {
        sessionLoad =
          await this.session
            .reload({
              config,

              requestId,

              onProgress:
                createProgressForwarder(
                  context
                ),

              cancellationSignal:
                signal,

              warmup:
                false,
            });

        this.statistics
          .sessionReloads +=
          1;
      } else {
        sessionLoad =
          await this.session
            .initialize({
              config,

              requestId,

              onProgress:
                createProgressForwarder(
                  context
                ),

              cancellationSignal:
                signal,

              forceReload:
                false,

              warmup:
                false,
            });
      }

      finishStage(
        context,
        'load-model-sessions',
        sessionLoadStartedAt
      );

      for (
        const warning of
          sessionLoad.warnings
      ) {
        context.warnings.push(
          warning
        );

        this.addWarning(
          warning
        );
      }

      signal
        ?.throwIfCancelled();

      /* ---------------------------------------------------
       * 10. Run image encoder
       * ------------------------------------------------- */

      const encoderStartedAt =
        startStage();

      const sourceId =
        createSourceId(
          request,
          requestId
        );

      encoderSessionResult =
        await runWithInferenceAttempts(
          context,
          'encoder',
          async () =>
            this.session
              .runEncoder({
                requestId,

                input:
  preprocessing!
    .encoderInput,

                sourceId,

                transform:
  preprocessing!
    .transform,

                config,

                onProgress:
                  createProgressForwarder(
                    context
                  ),

                cancellationSignal:
                  signal,

                reuseEmbedding:
                  options
                    .reuseEmbedding ??
                  true,
              })
        );

      finishStage(
        context,
        'run-image-encoder',
        encoderStartedAt
      );

      this.statistics
        .encoderRuns +=
        encoderSessionResult
          .cacheHit
          ? 0
          : 1;

      if (
        encoderSessionResult
          .cacheHit
      ) {
        this.statistics
          .embeddingCacheHits +=
          1;
      } else {
        this.statistics
          .embeddingCacheMisses +=
          1;
      }

      signal
        ?.throwIfCancelled();

      /* ---------------------------------------------------
       * 11. Generate EdgeSAM prompt
       * ------------------------------------------------- */

      emitProgress(
        context,
        'create-segmentation-prompt',
        'Creating the EdgeSAM segmentation prompt.'
      );

      const promptStartedAt =
        startStage();

        promptGeneration =
  await generateEdgeSamPrompt({
    source:
      request.source,

    orientedImage:
      preprocessing
        .orientedImage,

    modelImage:
      preprocessing
        .modelImage,

    transform:
      preprocessing
        .transform,

    config:
      config
        .automaticPrompt,

    manualPrompt:
      options.prompt ??
      null,

  });

      finishStage(
        context,
        'create-segmentation-prompt',
        promptStartedAt
      );

      for (
        const warning of
          promptGeneration
            .prompt
            .warnings
      ) {
        context.warnings.push(
          warning
        );

        this.addWarning(
          warning
        );
      }

      for (
        const warning of
          promptGeneration
            .diagnostics
            .warnings
      ) {
        if (
          !context.warnings
            .includes(
              warning
            )
        ) {
          context.warnings.push(
            warning
          );
        }

        this.addWarning(
          warning
        );
      }

      signal
        ?.throwIfCancelled();

      /* ---------------------------------------------------
       * 12. Build decoder inputs
       * ------------------------------------------------- */

      emitProgress(
        context,
        'create-decoder-inputs',
        'Creating EdgeSAM decoder input tensors.'
      );

      const decoderInputStartedAt =
        startStage();

      decoderInputBuild =
        await buildEdgeSamDecoderInputs(
          encoderSessionResult
            .embedding,
          promptGeneration
            .prompt,
          preprocessing
            .transform,
          config,
          signal
        );

      finishStage(
        context,
        'create-decoder-inputs',
        decoderInputStartedAt
      );

      for (
        const warning of
          decoderInputBuild
            .warnings
      ) {
        context.warnings.push(
          warning
        );

        this.addWarning(
          warning
        );
      }

      signal
        ?.throwIfCancelled();

      /* ---------------------------------------------------
       * 13. Run mask decoder
       * ------------------------------------------------- */

      const decoderSessionWasReady =
        this.session.isReady();

      const decoderStartedAt =
        startStage();

decoderOutput =
  await runWithInferenceAttempts(
    context,
    'decoder',
    async () =>
      this.session
        .runDecoder({
          requestId,

          inputs:
            decoderInputBuild!
              .inputs,

          config,

          onProgress:
            createProgressForwarder(
              context
            ),

          cancellationSignal:
            signal,
        })
  );

finishStage(
  context,
  'run-mask-decoder',
  decoderStartedAt
);

this.statistics
  .decoderRuns +=
  1;

signal
  ?.throwIfCancelled();

/* ---------------------------------------------------
 * 14. Evaluate initial decoder result
 * ------------------------------------------------- */

/**
 * الـIterative Refiner يحتاج Candidate كاملًا
 * يحتوي على:
 *
 * - normalizedMask
 * - thresholdedMask
 * - statistics
 * - validity
 * - candidate scores
 *
 * لذلك نشغل PostprocessorV2 كمرحلة تقييم
 * للمحاولة الأولى، ثم يستخدم نفس التقييم
 * لكل Decoder Run إضافي.
 */
const initialPostprocessor =
  new SegmentationPostprocessor(
    config
  );

const initialPostprocessStartedAt =
  now();

const initialPostprocessing =
  await initialPostprocessor
    .process({
      decoderOutput,

      orientedImage:
        preprocessing
          .orientedImage,

      transform:
        preprocessing
          .transform,

      config,

      requestId,

      onProgress:
        createProgressForwarder(
          context
        ),

      cancellationSignal:
        signal,
    });

signal
  ?.throwIfCancelled();

const initialSelectedCandidate =
  this.createSelectedCandidate(
    requestId,
    decoderOutput,
    initialPostprocessing,
    config
  );

const initialCandidateCollection =
  this.createCandidateCollection(
    initialSelectedCandidate
  );

const initialSelectionResult =
  this.createSelectionResult(
    initialSelectedCandidate,
    config
  );

const initialDecoderResult:
  EdgeSamDecoderResult = {
  rawOutput:
    decoderOutput,

  candidates:
    initialCandidateCollection,

  selection:
    initialSelectionResult,

  sessionReused:
    decoderSessionWasReady,

  timings: {
    promptBuildMs:
      promptGeneration
        .durationMs,

    inputBuildMs:
      decoderInputBuild
        .durationMs,

    sessionLoadMs:
      sessionLoad
        .timings
        .totalMs,

    inferenceMs:
      decoderOutput
        .inferenceMs,

    outputReadMs:
      0,

    candidateBuildMs:
      initialPostprocessing
        .timings
        .readCandidatesMs,

    candidateSelectionMs:
      initialPostprocessing
        .timings
        .candidateSelectionMs,

    totalMs:
      (
        promptGeneration
          .durationMs +
        decoderInputBuild
          .durationMs +
        decoderOutput
          .inferenceMs +
        initialPostprocessing
          .timings
          .readCandidatesMs +
        initialPostprocessing
          .timings
          .candidateSelectionMs
      ),
  },
};

/* ---------------------------------------------------
 * 15. Build iterative refinement dependencies
 * ------------------------------------------------- */

const iterativeDependencies =
  createIterativePromptRefinerDependenciesV3({
    buildDecoderInputs:
      async input => {
        input
          .cancellationSignal
          ?.throwIfCancelled();

        const buildResult =
          await buildEdgeSamDecoderInputs(
            input.imageEmbedding,
            input.prompt,
            preprocessing!
              .transform,
            input.modelConfig,
            input
              .cancellationSignal
          );

        for (
          const warning of
            buildResult.warnings
        ) {
          appendUniqueString(
            context.warnings,
            warning
          );

          this.addWarning(
            warning
          );
        }

        return buildResult
          .inputs;
      },

    runDecoder:
      async input => {
        input
          .cancellationSignal
          ?.throwIfCancelled();

        const iterativeDecoderStartedAt =
          now();

        const iterativeRawOutput =
          await runWithInferenceAttempts(
            context,
            'decoder',
            async () =>
              this.session
                .runDecoder({
                  requestId:
                    input.requestId,

                  inputs:
                    input.inputs,

                  config:
                    input.modelConfig,

                  onProgress:
                    input.onProgress,

                  cancellationSignal:
                    input
                      .cancellationSignal,
                })
          );

        this.statistics
          .decoderRuns +=
          1;

        const iterativePostprocessor =
          new SegmentationPostprocessor(
            input.modelConfig
          );

        const iterativePostprocessing =
          await iterativePostprocessor
            .process({
              decoderOutput:
                iterativeRawOutput,

              orientedImage:
                preprocessing!
                  .orientedImage,

              transform:
                preprocessing!
                  .transform,

              config:
                input.modelConfig,

              requestId:
                input.requestId,

              onProgress:
                input.onProgress,

              cancellationSignal:
                input
                  .cancellationSignal,
            });

        input
          .cancellationSignal
          ?.throwIfCancelled();

        for (
          const warning of
            iterativePostprocessing
              .diagnostics
              .warnings
        ) {
          appendUniqueString(
            context.warnings,
            warning
          );

          this.addWarning(
            warning
          );
        }

        const candidate =
          this.createSelectedCandidate(
            `${input.requestId}:iterative`,
            iterativeRawOutput,
            iterativePostprocessing,
            input.modelConfig
          );

        const candidates =
          this.createCandidateCollection(
            candidate
          );

        const selection =
          this.createSelectionResult(
            candidate,
            input.modelConfig
          );

        return {
          rawOutput:
            iterativeRawOutput,

          candidates,

          selection,

          sessionReused:
            true,

          timings: {
            promptBuildMs:
              0,

            inputBuildMs:
              0,

            sessionLoadMs:
              0,

            inferenceMs:
              iterativeRawOutput
                .inferenceMs,

            outputReadMs:
              0,

            candidateBuildMs:
              iterativePostprocessing
                .timings
                .readCandidatesMs,

            candidateSelectionMs:
              iterativePostprocessing
                .timings
                .candidateSelectionMs,

            totalMs:
              Math.max(
                0,
                now() -
                  iterativeDecoderStartedAt
              ),
          },
        };
      },

    analyzeFailure:
      input => {
        input
          .cancellationSignal
          ?.throwIfCancelled();

        const analysis =
          analyzePromptFailureV3({
            requestId:
              `${requestId}:failure:${input.iteration}`,

            candidate:
              input.candidate,

            prompt:
              input.prompt,

            previousMask:
              input.previousBestMask ??
              undefined,

            iterationIndex:
              input.iteration,

            cancellationSignal:
              input
                .cancellationSignal,

            onProgress:
              createProgressForwarder(
                context
              ),
          });

        return mapFailureAnalysisToIterativeResult(
          analysis
        );
      },

    generateAdaptivePrompt:
      input => {
        input
          .cancellationSignal
          ?.throwIfCancelled();

        const analysis =
          analyzePromptFailureV3({
            requestId:
              `${requestId}:adaptive-analysis:${input.iteration}`,

            candidate:
              input.currentCandidate,

            prompt:
              input.currentPrompt,

            previousMask:
              input.bestMask,

            iterationIndex:
              input.iteration,

            cancellationSignal:
              input
                .cancellationSignal,
          });

        const adaptiveResult =
          generateAdaptivePromptV4({
            requestId:
              `${requestId}:adaptive:${input.iteration}`,

            currentPrompt:
              input.currentPrompt,

            failureAnalysis:
              analysis,

            previousMask:
              input.bestMask,

            iterationIndex:
              input.iteration,

            cancellationSignal:
              input
                .cancellationSignal,
          });

        const originalPositivePointCount =
          input.currentPrompt
            .points
            .filter(
              point =>
                point.label ===
                1
            )
            .length;

        const originalNegativePointCount =
          input.currentPrompt
            .points
            .filter(
              point =>
                point.label ===
                0
            )
            .length;

        const generatedPositivePointCount =
          adaptiveResult
            .prompt
            .points
            .filter(
              point =>
                point.label ===
                1
            )
            .length;

        const generatedNegativePointCount =
          adaptiveResult
            .prompt
            .points
            .filter(
              point =>
                point.label ===
                0
            )
            .length;

        const boundingBoxExpanded =
          Boolean(
            input.currentPrompt
              .box &&
            adaptiveResult
              .prompt
              .box &&
            (
              adaptiveResult
                .prompt
                .box!
                .box
                .x1 <
              input.currentPrompt
                .box!
                .box
                .x1 ||
              adaptiveResult
                .prompt
                .box!
                .box
                .y1 <
              input.currentPrompt
                .box!
                .box
                .y1 ||
              adaptiveResult
                .prompt
                .box!
                .box
                .x2 >
              input.currentPrompt
                .box!
                .box
                .x2 ||
              adaptiveResult
                .prompt
                .box!
                .box
                .y2 >
              input.currentPrompt
                .box!
                .box
                .y2
            )
          );

        for (
          const warning of
            adaptiveResult.warnings
        ) {
          appendUniqueString(
            context.warnings,
            warning
          );

          this.addWarning(
            warning
          );
        }

        return {
          prompt:
            adaptiveResult.prompt,

          changed:
            adaptiveResult.changed,

          reason:
            adaptiveResult.changed
              ? adaptiveResult
                  .appliedActions
                  .join(',')
              : 'No safe adaptive prompt modification was produced.',

          changes: {
            positivePointsAdded:
              Math.max(
                0,
                generatedPositivePointCount -
                  originalPositivePointCount
              ),

            positivePointsRemoved:
              Math.max(
                0,
                originalPositivePointCount -
                  generatedPositivePointCount
              ),

            negativePointsAdded:
              Math.max(
                0,
                generatedNegativePointCount -
                  originalNegativePointCount
              ),

            negativePointsRemoved:
              Math.max(
                0,
                originalNegativePointCount -
                  generatedNegativePointCount
              ),

            boundingBoxExpanded,

            previousMaskUsed:
              adaptiveResult
                .prompt
                .previousMask !==
              null,

            promptConfidence:
              clampUnitValue(
                analysis
                  .dominantFailure
                  ?.confidence ??
                analysis
                  .qualityScores
                  .overallQualityScore
              ),
          },

          warnings: [
            ...adaptiveResult
              .warnings,
          ],
        };
      },

    scoreIteration:
      input => {
        input
          .cancellationSignal
          ?.throwIfCancelled();

        const analysis =
          analyzePromptFailureV3({
            requestId:
              `${requestId}:score:${input.iteration}`,

            candidate:
              input.candidate,

            prompt:
              input.prompt,

            previousMask:
              input.previousBest
                ?.selectedMask,

            iterationIndex:
              input.iteration,

            cancellationSignal:
              input
                .cancellationSignal,
          });

        const foregroundRatio =
          analysis
            .diagnostics
            .foregroundRatio;

        const foregroundScore =
          clampUnitValue(
            1 -
            Math.abs(
              foregroundRatio -
                0.45
            ) /
              0.45
          );

        const leakagePenalty =
          clampUnitValue(
            Math.max(
              analysis
                .penalties
                .backgroundPenalty,
              analysis
                .penalties
                .shadowPenalty,
              analysis
                .penalties
                .fragmentationPenalty
            )
          );

        const finalScore =
          clampUnitValue(
            (
              analysis
                .qualityScores
                .geometryScore *
                0.18 +
              analysis
                .qualityScores
                .boundaryScore *
                0.22 +
              analysis
                .qualityScores
                .backgroundSeparationScore *
                0.20 +
              foregroundScore *
                0.10 +
              analysis
                .qualityScores
                .confidenceScore *
                0.18 +
              analysis
                .qualityScores
                .stabilityScore *
                0.12
            ) *
            (
              1 -
              leakagePenalty *
                0.60
            )
          );

        return {
          geometryScore:
            analysis
              .qualityScores
              .geometryScore,

          boundaryScore:
            analysis
              .qualityScores
              .boundaryScore,

          imageGuidanceScore:
            analysis
              .qualityScores
              .backgroundSeparationScore,

          foregroundScore,

          backgroundPenalty:
            analysis
              .penalties
              .backgroundPenalty,

          shadowPenalty:
            analysis
              .penalties
              .shadowPenalty,

          leakagePenalty,

          confidenceScore:
            analysis
              .qualityScores
              .confidenceScore,

          finalScore,
        };
      },
  });

/* ---------------------------------------------------
 * 16. Run iterative prompt refinement
 * ------------------------------------------------- */

let iterativeRefinement:
  IterativePromptRefinementResult | null =
    null;

iterativeRefinement =
  await refinePromptIterativelyV3(
    {
      requestId:
        `${requestId}:iterative-refinement`,

      imageEmbedding:
        encoderSessionResult
          .embedding,

      initialPrompt:
        promptGeneration
          .prompt,

      firstDecoderResult:
        initialDecoderResult,

      modelConfig:
        config,

      cancellationSignal:
        signal,

      onProgress:
        createProgressForwarder(
          context
        ),
    },

    iterativeDependencies,

    {
      allowIterationFailureFallback:
        true,

      config: {
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

        usePreviousMask:
          true,

        preserveBestPrompt:
          true,

        preserveBestMask:
          true,
      },
    }
  );

signal
  ?.throwIfCancelled();

/* ---------------------------------------------------
 * 17. Resolve best decoder result
 * ------------------------------------------------- */

const bestIteration =
  getBestIterationResultV3(
    iterativeRefinement
  );

decoderOutput =
  bestIteration
    .decoderResult
    .rawOutput;

promptGeneration = {
  ...promptGeneration,

  prompt:
    iterativeRefinement
      .bestPrompt,
};

for (
  const warning of
    iterativeRefinement
      .warnings
) {
  appendUniqueString(
    context.warnings,
    warning
  );

  this.addWarning(
    warning
  );
}

/* ---------------------------------------------------
 * 18. Final postprocessing of best decoder result
 * ------------------------------------------------- */

const postprocessStartedAt =
  now();

/**
 * لو أفضل Iteration هي النتيجة الأولى،
 * نستخدم Postprocessing المحسوب بالفعل.
 *
 * لا ننشئ Postprocessor إضافيًا إلا لو
 * تم اختيار Iteration مختلفة فعلًا.
 */
if (
  bestIteration.iteration ===
    0
) {
  postprocessing =
    initialPostprocessing;
} else {
  const requestPostprocessor =
    new SegmentationPostprocessor(
      config
    );

  postprocessing =
    await requestPostprocessor
      .process({
        decoderOutput,

        orientedImage:
          preprocessing
            .orientedImage,

        transform:
          preprocessing
            .transform,

        config,

        requestId,

        onProgress:
          createProgressForwarder(
            context
          ),

        cancellationSignal:
          signal,
      });
}

this.addPostprocessStageTimings(
  context,
  postprocessing,
  bestIteration.iteration ===
    0
    ? initialPostprocessStartedAt
    : postprocessStartedAt
);

for (
  const warning of
    postprocessing
      .diagnostics
      .warnings
) {
  appendUniqueString(
    context.warnings,
    warning
  );

  this.addWarning(
    warning
  );
}

signal
  ?.throwIfCancelled();

/* ---------------------------------------------------
 * Build final typed candidate information
 * ------------------------------------------------- */

const selectedCandidate =
  this.createSelectedCandidate(
    requestId,
    decoderOutput,
    postprocessing,
    config
  );

      const totalMs =
        Math.max(
          0,
          now() -
            startedAt
        );

      const timings:
        SegmentationTimings = {
        preprocessingMs:
          preprocessing
            .timings
            .totalMs,

        sessionLoadMs:
          sessionLoad
            .timings
            .totalMs,

        encoderInferenceMs:
          encoderSessionResult
            .rawOutput
            .inferenceMs,

        promptGenerationMs:
          promptGeneration
            .durationMs,

        decoderInputBuildMs:
          decoderInputBuild
            .durationMs,

        decoderInferenceMs:
          decoderOutput
            .inferenceMs,

        candidateReadMs:
          postprocessing
            .timings
            .readCandidatesMs,

        candidateSelectionMs:
          postprocessing
            .timings
            .candidateSelectionMs,

        postprocessingMs:
          postprocessing
            .timings
            .totalMs,

        totalMs,

        stages: [
          ...context
            .stageTimings,
        ],
      };

      const diagnostics =
        options
          .collectDiagnostics ===
          false
          ? undefined
          : this.createResultDiagnostics(
              config,
              preprocessing,
              encoderSessionResult,
              promptGeneration,
              decoderOutput,
              selectedCandidate,
              postprocessing,
              context.warnings,
              options
                .includeMaskCandidatesInDiagnostics ??
                false
            );

      emitProgress(
        context,
        'complete',
        'EdgeSAM segmentation completed.',
        {
          width:
            postprocessing
              .alphaMask
              .width,

          height:
            postprocessing
              .alphaMask
              .height,

          foregroundRatio:
            postprocessing
              .statistics
              .foregroundRatio,
        }
      );

      const completeStartedAt =
        now();

      finishStage(
        context,
        'complete',
        completeStartedAt
      );

      this.updateCompletedStatistics(
        totalMs,
        encoderSessionResult
          .rawOutput
          .inferenceMs,
        decoderOutput
          .inferenceMs,
        postprocessing
          .timings
          .totalMs
      );

      this.lastDurationMs =
        totalMs;

      this.state =
        'ready';

      this.config =
        config;


      return {
        requestId,

        source:
          request.source,

        originalSize: {
          ...preprocessing
            .transform
            .originalSize,
        },

        modelInputSize: {
          ...preprocessing
            .transform
            .modelInputSize,
        },

        alphaMask:
          postprocessing
            .alphaMask,

        maskStatistics:
          postprocessing
            .statistics,

        transform:
          preprocessing
            .transform,

        prompt:
          promptGeneration
            .prompt,

        selectedCandidate,

        timings,

        attempts: [
          ...context.attempts,
        ],

        diagnostics,
      };
    } catch (error) {
      const normalized =
        normalizeEngineError(
          error,
          requestId,
          'INFERENCE_FAILED',
          'EdgeSAM segmentation failed.'
        );

      const durationMs =
        Math.max(
          0,
          now() -
            startedAt
        );

      this.lastDurationMs =
        durationMs;

      this.lastErrorCode =
        normalized.code;

      this.lastErrorMessage =
        normalized.message;

      if (
        isCancellationError(
          normalized
        )
      ) {
        this.state =
          'cancelled';

        this.statistics
          .cancelledRequests +=
          1;

        this.statistics
          .lastCancelledAt =
          now();
      } else {
        this.state =
          'failed';

        this.statistics
          .failedRequests +=
          1;

        this.statistics
          .lastFailedAt =
          now();
      }

      throw normalized;
    } finally {
      this.activeRequestId =
        null;
    }
  }

  /* =======================================================
   * Postprocess stage timings
   * ===================================================== */

  private addPostprocessStageTimings(
    context:
      EngineRunContext,
    result:
      SegmentationPostprocessResult,
    startedAt:
      number
  ): void {
    const stages: readonly [
      SegmentationPipelineStage,
      number,
    ][] = [
      [
        'read-mask-candidates',
        result.timings
          .readCandidatesMs,
      ],

      [
        'select-best-mask',
        result.timings
          .candidateSelectionMs,
      ],

      [
        'refine-alpha-mask',
        (
          result.timings
            .activationMs +
          result.timings
            .normalizeMaskMs +
          result.timings
            .removeLetterboxMs +
          result.timings
            .removeNoiseMs +
          result.timings
            .connectedComponentsMs +
          result.timings
            .fillHolesMs +
          result.timings
            .morphologyMs +
          result.timings
            .thresholdMs +
          result.timings
            .smoothingMs +
          result.timings
            .featherMs
        ),
      ],

      [
        'restore-original-size',
        result.timings
          .restoreOriginalSizeMs,
      ],

      [
        'protect-object-edges',
        (
          result.timings
            .protectEdgesMs +
          result.timings
            .convertToAlphaMs +
          result.timings
            .statisticsMs
        ),
      ],
    ];

    let cursor =
      startedAt;

    for (
      const [
        stage,
        durationMs,
      ] of stages
    ) {
      const safeDurationMs =
        Math.max(
          0,
          durationMs
        );

      const completedAt =
        cursor +
        safeDurationMs;

      context
        .stageTimings
        .push({
          stage,

          startedAt:
            cursor,

          completedAt,

          durationMs:
            safeDurationMs,
        });

      cursor =
        completedAt;
    }
  }

  /* =======================================================
   * Candidate creation
   * ===================================================== */

  private resolveSelectedCandidateIndex(
    decoderOutput:
      EdgeSamDecoderRawOutput
  ): number {
    const candidateCount =
      resolveMaskCandidateCount(
        decoderOutput
      );

    const scores =
      decoderOutput
        .scoresTensor
        ?.data;

    if (
      !scores ||
      scores.length ===
        0
    ) {
      return 0;
    }

    let selectedIndex =
      0;

    let selectedScore =
      Number.NEGATIVE_INFINITY;

    const maximumIndex =
      Math.min(
        candidateCount,
        scores.length
      );

    for (
      let index = 0;
      index <
        maximumIndex;
      index += 1
    ) {
      const value =
        scores[index];

      if (
        Number.isFinite(
          value
        ) &&
        value >
          selectedScore
      ) {
        selectedScore =
          value;

        selectedIndex =
          index;
      }
    }

    return selectedIndex;
  }

  private createSelectedCandidate(
    requestId:
      string,
    decoderOutput:
      EdgeSamDecoderRawOutput,
    postprocessing:
      SegmentationPostprocessResult,
    config:
      SegmentationModelConfig
  ): EdgeSamMaskCandidate {
    const index =
      this.resolveSelectedCandidateIndex(
        decoderOutput
      );

    const predictedIou =
      decoderOutput
        .scoresTensor &&
      decoderOutput
        .scoresTensor
        .data.length >
        index
        ? clampUnitValue(
            decoderOutput
              .scoresTensor
              .data[
                index
              ]
          )
        : 0;

    const statistics =
      postprocessing
        .statistics;

    const stabilityScore =
      clampUnitValue(
        1 -
        statistics
          .semiTransparentRatio
      );

    const isolationScore =
      clampUnitValue(
        1 -
        statistics
          .secondLargestComponentRatio
      );

    const centeringScore =
      clampUnitValue(
        1 -
        statistics
          .centerOffsetRatio
      );

    const edgePenalty =
      clampUnitValue(
        statistics
          .edgeContactRatio
      );

    const fragmentationPenalty =
      clampUnitValue(
        statistics
          .significantComponentCount >
          1
          ? (
              statistics
                .significantComponentCount -
              1
            ) /
            Math.max(
              1,
              config.selection
                .maximumSignificantComponents
            )
          : 0
      );

    const holePenalty =
      clampUnitValue(
        statistics.holeRatio
      );

    const foregroundMidpoint =
      (
        config.selection
          .minimumForegroundRatio +
        config.selection
          .maximumForegroundRatio
      ) /
      2;

    const foregroundRange =
      Math.max(
        0.0001,
        (
          config.selection
            .maximumForegroundRatio -
          config.selection
            .minimumForegroundRatio
        ) /
        2
      );

    const foregroundBalance =
      clampUnitValue(
        1 -
        Math.abs(
          statistics
            .foregroundRatio -
          foregroundMidpoint
        ) /
        foregroundRange
      );

    const weights =
      config.selection
        .weights;

    const positiveWeightTotal =
      Math.max(
        0.0001,
        weights.predictedIou +
        weights.stability +
        weights.foregroundBalance +
        weights.largestComponent +
        weights.isolation +
        weights.centering
      );

    const positiveScore =
      (
        predictedIou *
          weights.predictedIou +
        stabilityScore *
          weights.stability +
        foregroundBalance *
          weights.foregroundBalance +
        statistics
          .largestComponentRatio *
          weights.largestComponent +
        isolationScore *
          weights.isolation +
        centeringScore *
          weights.centering
      ) /
      positiveWeightTotal;

    const negativeScore =
      (
        edgePenalty *
          weights.edgePenalty +
        fragmentationPenalty *
          weights.fragmentationPenalty +
        holePenalty *
          weights.holePenalty
      );

    const finalScore =
      clampUnitValue(
        positiveScore -
        negativeScore
      );

    const rejectionReasons:
      string[] =
        [];

    if (
      predictedIou <
      config.selection
        .minimumPredictedIou
    ) {
      rejectionReasons.push(
        'Predicted IoU is below the configured minimum.'
      );
    }

    if (
      stabilityScore <
      config.selection
        .minimumStabilityScore
    ) {
      rejectionReasons.push(
        'Mask stability is below the configured minimum.'
      );
    }

    if (
      statistics
        .foregroundRatio <
        config.selection
          .minimumForegroundRatio
    ) {
      rejectionReasons.push(
        'Foreground ratio is too small.'
      );
    }

    if (
      statistics
        .foregroundRatio >
        config.selection
          .maximumForegroundRatio
    ) {
      rejectionReasons.push(
        'Foreground ratio is too large.'
      );
    }

    if (
      statistics
        .largestComponentRatio <
        config.selection
          .minimumLargestComponentRatio
    ) {
      rejectionReasons.push(
        'Largest connected component is too small.'
      );
    }

    let validity:
      EdgeSamMaskCandidate[
        'validity'
      ] =
        'valid';

    if (
      rejectionReasons.length >
        0
    ) {
      validity =
        finalScore >=
          config.selection
            .minimumFinalScore *
            0.75
          ? 'weak'
          : 'invalid';
    }

    return {
      id:
        createMaskCandidateId(
          requestId,
          index
        ),

      index,

      rawMask:
        postprocessing
          .selectedMask,

      normalizedMask:
        postprocessing
          .selectedMask,

      thresholdedMask:
        postprocessing
          .refinedMask,

      predictedIou,

      stabilityScore,

      statistics,

      scores: {
        predictedIou,

        stabilityScore,

        foregroundRatio:
          statistics
            .foregroundRatio,

        largestComponentRatio:
          statistics
            .largestComponentRatio,

        isolationScore,

        centeringScore,

        edgePenalty,

        fragmentationPenalty,

        holePenalty,

        finalScore,
      },

      validity,

      rejectionReasons,

      warnings: [
        ...postprocessing
          .diagnostics
          .warnings,
      ],
    };
  }

  private createCandidateCollection(
    selectedCandidate:
      EdgeSamMaskCandidate
  ): EdgeSamMaskCandidateCollection {
    const validCandidates =
      selectedCandidate
        .validity ===
        'valid'
        ? [
            selectedCandidate,
          ]
        : [];

    const weakCandidates =
      selectedCandidate
        .validity ===
        'weak'
        ? [
            selectedCandidate,
          ]
        : [];

    const invalidCandidates =
      selectedCandidate
        .validity ===
        'invalid'
        ? [
            selectedCandidate,
          ]
        : [];

    return {
      candidates: [
        selectedCandidate,
      ],

      validCandidates,

      weakCandidates,

      invalidCandidates,

      totalCount:
        1,

      validCount:
        validCandidates.length,

      weakCount:
        weakCandidates.length,

      invalidCount:
        invalidCandidates.length,

      warnings: [
        ...selectedCandidate
          .warnings,
      ],
    };
  }

  private createSelectionResult(
    selectedCandidate:
      EdgeSamMaskCandidate,
    config:
      SegmentationModelConfig
  ): EdgeSamMaskSelectionResult {
    const diagnostics:
      EdgeSamMaskSelectionDiagnostics = {
      mode:
        config.selection
          .mode,

      selectedCandidateId:
        selectedCandidate.id,

      selectedCandidateIndex:
        selectedCandidate.index,

      selectedFinalScore:
        selectedCandidate
          .scores
          .finalScore,

      candidateScores: [
        {
          id:
            selectedCandidate.id,

          index:
            selectedCandidate
              .index,

          validity:
            selectedCandidate
              .validity,

          predictedIou:
            selectedCandidate
              .predictedIou,

          stabilityScore:
            selectedCandidate
              .stabilityScore,

          finalScore:
            selectedCandidate
              .scores
              .finalScore,

          rejectionReasons:
            selectedCandidate
              .rejectionReasons,
        },
      ],

      usedWeakFallback:
        selectedCandidate
          .validity ===
        'weak',

      warnings: [
        ...selectedCandidate
          .warnings,
      ],
    };

    return {
      selectedCandidate,

      diagnostics,

      durationMs:
        0,
    };
  }

  /* =======================================================
   * Result diagnostics
   * ===================================================== */

  private createResultDiagnostics(
    config:
      SegmentationModelConfig,
    preprocessing:
      SegmentationPreprocessResult,
    encoder:
      EncoderSessionRunResult,
    promptGeneration:
      EdgeSamPromptGenerationResult,
    decoderOutput:
      EdgeSamDecoderRawOutput,
    selectedCandidate:
      EdgeSamMaskCandidate,
    postprocessing:
      SegmentationPostprocessResult,
    warnings:
      readonly string[],
    includeCandidates:
      boolean
  ): SegmentationDiagnostics {
    const sessionDiagnostics =
      this.session
        .getDiagnostics();

    const prompt =
      promptGeneration
        .prompt;

    const positivePointCount =
      prompt.points.filter(
        point =>
          point.label ===
          1
      ).length;

    const negativePointCount =
      prompt.points.filter(
        point =>
          point.label ===
          0
      ).length;

    return {
      modelId:
        config.id,

      modelVersion:
        config.version,

      modelFamily:
        'edgesam',

      platform:
        resolvePlatform(),

      runtime:
        resolveRuntime(),

      executionProvider:
        sessionDiagnostics
          .executionProvider,

      encoderInputName:
        preprocessing
          .encoderInput
          .image
          .name,

      encoderInputDimensions: [
        ...preprocessing
          .encoderInput
          .image
          .dimensions,
      ],

      encoderOutputName:
        encoder
          .rawOutput
          .selectedOutputName,

      encoderOutputDimensions: [
        ...encoder
          .rawOutput
          .selectedTensor
          .dimensions,
      ],

      decoderInputNames:
        Object.keys(
          config.decoder
            .config
            .inputNames
        ).map(
          key =>
            config.decoder
              .config
              .inputNames[
                key as keyof typeof config.decoder.config.inputNames
              ]
        ),

      decoderOutputNames:
        Object.keys(
          decoderOutput.outputs
        ),

      selectedMasksOutputName:
        decoderOutput
          .selectedMasksOutputName,

      selectedScoresOutputName:
        decoderOutput
          .selectedScoresOutputName,

      encoderSessionReused:
        encoder
          .sessionReused,

      decoderSessionReused:
        true,

      embeddingCacheHit:
        encoder
          .cacheHit,

      promptMode:
        prompt.mode,

      promptGeneratedAutomatically:
        prompt
          .generatedAutomatically,

      positivePointCount,

      negativePointCount,

      usedBoundingBox:
        prompt.box !==
        null,

      maskCandidateCount:
        resolveMaskCandidateCount(
          decoderOutput
        ),

      selectedCandidateIndex:
        selectedCandidate
          .index,

      selectedPredictedIou:
        selectedCandidate
          .predictedIou,

      selectedStabilityScore:
        selectedCandidate
          .stabilityScore,

      selectedFinalScore:
        selectedCandidate
          .scores
          .finalScore,

      selectedCandidateValidity:
        selectedCandidate
          .validity,

      maskStatistics:
        postprocessing
          .statistics,

      session:
        sessionDiagnostics,

      warnings: [
        ...new Set(
          warnings
        ),
      ],

      maskCandidates:
        includeCandidates
          ? [
              {
                id:
                  selectedCandidate
                    .id,

                index:
                  selectedCandidate
                    .index,

                validity:
                  selectedCandidate
                    .validity,

                predictedIou:
                  selectedCandidate
                    .predictedIou,

                stabilityScore:
                  selectedCandidate
                    .stabilityScore,

                finalScore:
                  selectedCandidate
                    .scores
                    .finalScore,

                statistics:
                  selectedCandidate
                    .statistics,

                rejectionReasons:
                  selectedCandidate
                    .rejectionReasons,

                warnings:
                  selectedCandidate
                    .warnings,
              },
            ]
          : undefined,
    };
  }

  /* =======================================================
   * Statistics
   * ===================================================== */

  private updateCompletedStatistics(
    totalMs:
      number,
    encoderInferenceMs:
      number,
    decoderInferenceMs:
      number,
    postprocessingMs:
      number
  ): void {
    this.statistics
      .completedRequests +=
      1;

    this.statistics
      .lastCompletedAt =
      now();

    this.statistics
      .totalProcessingMs +=
      totalMs;

    this.statistics
      .averageProcessingMs =
      safeSegmentationDivide(
        this.statistics
          .totalProcessingMs,
        this.statistics
          .completedRequests,
        0
      );

    this.runningAverages
      .encoderInferenceTotalMs +=
      encoderInferenceMs;

    this.runningAverages
      .encoderSampleCount +=
      1;

    this.statistics
      .averageEncoderInferenceMs =
      safeSegmentationDivide(
        this.runningAverages
          .encoderInferenceTotalMs,
        this.runningAverages
          .encoderSampleCount,
        0
      );

    this.runningAverages
      .decoderInferenceTotalMs +=
      decoderInferenceMs;

    this.runningAverages
      .decoderSampleCount +=
      1;

    this.statistics
      .averageDecoderInferenceMs =
      safeSegmentationDivide(
        this.runningAverages
          .decoderInferenceTotalMs,
        this.runningAverages
          .decoderSampleCount,
        0
      );

    this.runningAverages
      .postprocessingTotalMs +=
      postprocessingMs;

    this.runningAverages
      .postprocessingSampleCount +=
      1;

    this.statistics
      .averagePostprocessingMs =
      safeSegmentationDivide(
        this.runningAverages
          .postprocessingTotalMs,
        this.runningAverages
          .postprocessingSampleCount,
        0
      );
  }

  /* =======================================================
   * Public diagnostics
   * ===================================================== */

  getStatistics():
    SegmentationEngineStatistics {
    return {
      ...this.statistics,
    };
  }

  getDiagnostics():
    SegmentationEngineDiagnostics {
    const sessionDiagnostics =
      this.session
        .getDiagnostics();

    return {
      state:
        this.state,

      ready:
        this.isReady(),

      busy:
        this.isBusy(),

      disposed:
        this.isDisposed(),

      activeRequestId:
        this.activeRequestId,

      queuedRequestCount:
        this.queuedRequestCount,

      modelId:
        this.config.id,

      modelVersion:
        this.config.version,

      session:
        sessionDiagnostics,

      statistics:
        this.getStatistics(),

      lastDurationMs:
        this.lastDurationMs,

      lastErrorCode:
        this.lastErrorCode,

      lastErrorMessage:
        this.lastErrorMessage,

      warnings: [
        ...this.warnings,
      ],
    };
  }

  /* =======================================================
   * Cache and session lifecycle
   * ===================================================== */

  clearEmbeddingCache():
    void {
    this.session
      .clearEmbeddingCache();
  }

  async reload(
    input:
      SegmentationEngineInitializeRequest = {}
  ): Promise<
    SegmentationEngineInitializeResult
  > {
    return this.initialize({
      ...input,

      forceSessionReload:
        true,
    });
  }

  async dispose(
    options: {
      removeCopiedModels?:
        boolean;

      clearEmbeddingCache?:
        boolean;
    } = {}
  ): Promise<void> {
    if (
      this.state ===
      'disposed'
    ) {
      return;
    }

    const requestId =
      createSegmentationRequestId();

    await this.enqueue({
      requestId,

      execute:
        async () => {
          this.state =
            'disposed';

          this.activeRequestId =
            null;

          await this.session
            .dispose({
              removeCopiedModels:
                options
                  .removeCopiedModels,

              clearEmbeddingCache:
                options
                  .clearEmbeddingCache,
            });

          this.state =
            'disposed';
        },
    });
  }
}

/* =========================================================
 * Shared engine
 * ======================================================= */

let sharedSegmentationEngine:
  SegmentationEngine | null =
    null;

export function getSharedSegmentationEngine(
  config:
    SegmentationModelConfig =
      DEFAULT_SEGMENTATION_MODEL_CONFIG
): SegmentationEngine {
  if (
    !sharedSegmentationEngine ||
    sharedSegmentationEngine
      .isDisposed()
  ) {
    sharedSegmentationEngine =
      new SegmentationEngine(
        config
      );
  }

  return sharedSegmentationEngine;
}

/* =========================================================
 * Functional API
 * ======================================================= */

export async function initializeSegmentationEngine(
  input:
    SegmentationEngineInitializeRequest = {}
): Promise<
  SegmentationEngineInitializeResult
> {
  const engine =
    getSharedSegmentationEngine(
      input.config ??
      DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return engine.initialize(
    input
  );
}

export async function runSegmentationEngine(
  request:
    SegmentationRequest
): Promise<SegmentationResult> {
  const engine =
    getSharedSegmentationEngine();

  return engine.process(
    request
  );
}

export function getSharedSegmentationEngineDiagnostics():
  SegmentationEngineDiagnostics | null {
  return (
    sharedSegmentationEngine
      ?.getDiagnostics() ??
    null
  );
}

export function clearSharedSegmentationEngineEmbeddingCache():
  void {
  sharedSegmentationEngine
    ?.clearEmbeddingCache();
}

export async function reloadSharedSegmentationEngine(
  input:
    SegmentationEngineInitializeRequest = {}
): Promise<
  SegmentationEngineInitializeResult
> {
  const engine =
    getSharedSegmentationEngine(
      input.config ??
      DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return engine.reload(
    input
  );
}

export async function disposeSharedSegmentationEngine(
  options: {
    removeCopiedModels?:
      boolean;

    clearEmbeddingCache?:
      boolean;
  } = {}
): Promise<void> {
  if (
    !sharedSegmentationEngine
  ) {
    return;
  }

  await sharedSegmentationEngine
    .dispose(
      options
    );

  sharedSegmentationEngine =
    null;
}

export default
  SegmentationEngine;