// scan/core/services/ScanItemProcessingExecutor.ts
//
// Triple N - Scan Item Processing Executor
//
// هذا الملف يربط ProcessingQueue بالتنفيذ الحقيقي
// لمعالجة صورة Scan Item.
//
// مسؤولياته:
//
// 1) استقبال Job من ProcessingQueue.
// 2) التحقق من الصورة الأصلية.
// 3) تجهيز مصدر الصورة.
// 4) تشغيل EdgeSAM من خلال Adapter.
// 5) تمرير تقدم EdgeSAM إلى Queue.
// 6) حفظ الصورة الشفافة.
// 7) تحديث عنصر الدولاب.
// 8) إنشاء ProcessingJobOutput مطابق للعقود.
// 9) تحويل الأخطاء إلى ProcessingJobError.
// 10) احترام Cancellation.
// 11) تنظيف الملفات المؤقتة.
// 12) عدم افتراض API غير موجود داخل EdgeSAM.

import type {
    SegmentationPipelineStage,
    SegmentationProgressEvent,
    SegmentationSource,
} from '../ai/types';

import type {
    ProcessingJob,
    ProcessingJobError,
    ProcessingJobErrorCode,
    ProcessingJobErrorSource,
    ProcessingJobExecutionResult,
    ProcessingJobOutput,
    ProcessingJobStage,
    ProcessingTimestamp,
} from '../queue/QueueTypes';

import type {
    ProcessingJobExecutionContext,
    ProcessingJobExecutor,
} from '../queue/ProcessingQueue';

/* =========================================================
 * Public processing contracts
 * ======================================================= */

export type ScanItemProcessingImageSource = {
  uri:
    string;

  width:
    number | null;

  height:
    number | null;

  orientation:
    number | null;

  format:
    string;

  sourceId:
    string;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type ScanItemProcessingWardrobeContext = {
  wardrobeItemId:
    string;

  wardrobeType:
    'male' | 'female' | null;

  category:
    string | null;

  subcategory:
    string | null;

  itemName:
    string | null;

  color:
    string | null;

  style:
    string | null;

  season:
    string | null;

  occasion:
    string | null;

  isFavorite:
    boolean;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type ScanItemSegmentationProgress =
  SegmentationProgressEvent;

export type ScanItemSegmentationResult = {
  requestId:
    string;

  transparentImageUri:
    string;

  maskWidth:
    number;

  maskHeight:
    number;

  foregroundRatio:
    number | null;

  durationMs:
    number;

  segmentationSource:
    SegmentationSource | null;

  diagnostics:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type ScanItemSavedOutput = {
  processedImageUri:
    string;

  width:
    number | null;

  height:
    number | null;

  fileSizeBytes:
    number | null;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type ScanItemWardrobeUpdateResult = {
  wardrobeItemId:
    string;

  processedImageUri:
    string;

  updated:
    boolean;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Adapter
 * ======================================================= */

export type ScanItemProcessingAdapter = {
  validateSource(
    source:
      ScanItemProcessingImageSource,
    job:
      ProcessingJob
  ): Promise<void>;

  prepareSource?(
    source:
      ScanItemProcessingImageSource,
    job:
      ProcessingJob
  ): Promise<
    ScanItemProcessingImageSource
  >;

  runSegmentation(
    input: {
      requestId:
        string;

      source:
        ScanItemProcessingImageSource;

      wardrobe:
        ScanItemProcessingWardrobeContext;

      onProgress(
        progress:
          ScanItemSegmentationProgress
      ): Promise<void>;

      cancellationSignal:
        ProcessingJobExecutionContext[
          'cancellationSignal'
        ];
    }
  ): Promise<
    ScanItemSegmentationResult
  >;

  saveProcessedImage(
    input: {
      job:
        ProcessingJob;

      segmentation:
        ScanItemSegmentationResult;

      cancellationSignal:
        ProcessingJobExecutionContext[
          'cancellationSignal'
        ];
    }
  ): Promise<
    ScanItemSavedOutput
  >;

  updateWardrobeItem(
    input: {
      job:
        ProcessingJob;

      savedOutput:
        ScanItemSavedOutput;

      segmentation:
        ScanItemSegmentationResult;

      cancellationSignal:
        ProcessingJobExecutionContext[
          'cancellationSignal'
        ];
    }
  ): Promise<
    ScanItemWardrobeUpdateResult
  >;

  cleanupTemporaryFiles?(
    input: {
      job:
        ProcessingJob;

      preparedSource:
        ScanItemProcessingImageSource | null;

      segmentation:
        ScanItemSegmentationResult | null;

      savedOutput:
        ScanItemSavedOutput | null;

      succeeded:
        boolean;
    }
  ): Promise<void>;
};

/* =========================================================
 * Executor configuration
 * ======================================================= */

export type ScanItemProcessingExecutorConfig = {
  minimumProgress:
    number;

  maximumProgressBeforeCompletion:
    number;

  validateSourceProgress:
    number;

  prepareSourceProgress:
    number;

  segmentationStartProgress:
    number;

  segmentationEndProgress:
    number;

  saveImageProgress:
    number;

  updateWardrobeProgress:
    number;

  cleanupProgress:
    number;

  enableDebugLogs:
    boolean;
};

export type PartialScanItemProcessingExecutorConfig =
  Partial<
    ScanItemProcessingExecutorConfig
  >;

/* =========================================================
 * Defaults
 * ======================================================= */

export const DEFAULT_SCAN_ITEM_PROCESSING_EXECUTOR_CONFIG:
  ScanItemProcessingExecutorConfig = {
    minimumProgress:
      0.01,

    maximumProgressBeforeCompletion:
      0.99,

    validateSourceProgress:
      0.03,

    prepareSourceProgress:
      0.08,

    segmentationStartProgress:
      0.1,

    segmentationEndProgress:
      0.86,

    saveImageProgress:
      0.9,

    updateWardrobeProgress:
      0.96,

    cleanupProgress:
      0.985,

    enableDebugLogs:
      false,
  };

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type ScanItemProcessingExecutorDiagnostics = {
  createdAt:
    ProcessingTimestamp;

  executionCount:
    number;

  successfulCount:
    number;

  failedCount:
    number;

  cancelledCount:
    number;

  totalDurationMs:
    number;

  averageDurationMs:
    number;

  lastStartedAt:
    ProcessingTimestamp | null;

  lastCompletedAt:
    ProcessingTimestamp | null;

  lastFailedAt:
    ProcessingTimestamp | null;

  lastJobId:
    string | null;

  lastRequestId:
    string | null;

  lastError:
    ProcessingJobError | null;
};

/* =========================================================
 * Internal helpers
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function clampUnitValue(
  value:
    number
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value
    )
  );
}

function clampProgressRange(
  value:
    number,
  minimum:
    number,
  maximum:
    number
): number {
  const safeMinimum =
    Math.min(
      minimum,
      maximum
    );

  const safeMaximum =
    Math.max(
      minimum,
      maximum
    );

  return Math.min(
    safeMaximum,
    Math.max(
      safeMinimum,
      value
    )
  );
}

function normalizeDuration(
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

  return Math.floor(
    value
  );
}

function normalizePositiveDimension(
  value:
    number | null | undefined,
  fallback:
    number
): number {
  if (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    ) &&
    value >
      0
  ) {
    return Math.max(
      1,
      Math.floor(
        value
      )
    );
  }

  return Math.max(
    1,
    Math.floor(
      fallback
    )
  );
}

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'string'
  ) {
    return error;
  }

  try {
    const serialized =
      JSON.stringify(
        error
      );

    if (
      typeof serialized ===
        'string' &&
      serialized.length >
        0
    ) {
      return serialized;
    }
  } catch {
    // نستخدم String في النهاية.
  }

  return String(
    error
  );
}

function cloneError(
  error:
    ProcessingJobError | null
): ProcessingJobError | null {
  if (
    !error
  ) {
    return null;
  }

  return {
    ...error,

    metadata: {
      ...error.metadata,
    },
  };
}

function resolveErrorSource(
  stage:
    ProcessingJobStage
): ProcessingJobErrorSource {
  if (
    stage ===
      'load-source' ||
    stage ===
      'validate-source'
  ) {
    return 'image-source';
  }

  if (
    stage ===
      'export-transparent-image' ||
    stage ===
      'save-processed-image'
  ) {
    return 'export';
  }

  if (
    stage ===
      'update-wardrobe-item'
  ) {
    return 'wardrobe';
  }

  if (
    stage ===
      'queued' ||
    stage ===
      'complete' ||
    stage ===
      'failed' ||
    stage ===
      'cancelled'
  ) {
    return 'queue';
  }

  return 'segmentation';
}

function createExecutorError(
  code:
    ProcessingJobErrorCode,
  message:
    string,
  options?: {
    source?:
      ProcessingJobErrorSource;

    retryable?:
      boolean;

    attempt?:
      number;

    stage?:
      ProcessingJobStage | null;

    nativeCode?:
      string | null;

    segmentationErrorCode?:
      ProcessingJobError[
        'segmentationErrorCode'
      ];

    metadata?:
      ProcessingJobError[
        'metadata'
      ];
  }
): ProcessingJobError {
  const stage =
    options?.stage ??
    null;

  return {
    code,

    message,

    source:
      options?.source ??
      (
        stage
          ? resolveErrorSource(
              stage
            )
          : 'unknown'
      ),

    retryable:
      options?.retryable ??
      false,

    occurredAt:
      now(),

    attempt:
      Math.max(
        0,
        Math.floor(
          options?.attempt ??
          0
        )
      ),

    stage,

    nativeCode:
      options?.nativeCode ??
      null,

    segmentationErrorCode:
      options
        ?.segmentationErrorCode ??
      null,

    metadata: {
      ...(options?.metadata ??
      {}),
    },
  };
}

function isProcessingJobError(
  value:
    unknown
): value is ProcessingJobError {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    return false;
  }

  const possibleError =
    value as Partial<
      ProcessingJobError
    >;

  return (
    typeof possibleError.code ===
      'string' &&
    typeof possibleError.message ===
      'string' &&
    typeof possibleError.source ===
      'string' &&
    typeof possibleError.retryable ===
      'boolean'
  );
}

function resolveExecutorError(
  error:
    unknown,
  job:
    ProcessingJob,
  stage:
    ProcessingJobStage
): ProcessingJobError {
  if (
    isProcessingJobError(
      error
    )
  ) {
    return {
      ...error,

      attempt:
        error.attempt ||
        job.retry.attempt,

      stage:
        error.stage ??
        stage,

      metadata: {
        ...error.metadata,

        jobId:
          job.id,

        requestId:
          job.requestId,

        wardrobeItemId:
          job.wardrobeItemId,
      },
    };
  }

  return createExecutorError(
    'UNKNOWN_QUEUE_ERROR',
    getUnknownErrorMessage(
      error
    ),
    {
      source:
        resolveErrorSource(
          stage
        ),

      retryable:
        false,

      attempt:
        job.retry.attempt,

      stage,

      metadata: {
        jobId:
          job.id,

        requestId:
          job.requestId,

        wardrobeItemId:
          job.wardrobeItemId,
      },
    }
  );
}

function createSourceFromJob(
  job:
    ProcessingJob
): ScanItemProcessingImageSource {
  const uri =
    job.source.uri.trim();

  if (
    uri.length ===
      0
  ) {
    throw createExecutorError(
      'INVALID_SOURCE_URI',
      'The processing job does not contain a valid source image URI.',
      {
        source:
          'image-source',

        retryable:
          false,

        attempt:
          job.retry.attempt,

        stage:
          'validate-source',

        metadata: {
          jobId:
            job.id,
        },
      }
    );
  }

  return {
    uri,

    width:
      job.source.width,

    height:
      job.source.height,

    orientation:
      job.source.orientation,

    format:
      job.source.format,

    sourceId:
      job.source
        .segmentationSourceId ??
      job.source.assetId ??
      job.id,

    metadata: {
      ...job.source.metadata,

      fileName:
        job.source.fileName,

      mimeType:
        job.source.mimeType,

      assetId:
        job.source.assetId,
    },
  };
}

function createWardrobeContextFromJob(
  job:
    ProcessingJob
): ScanItemProcessingWardrobeContext {
  return {
    wardrobeItemId:
      job.wardrobeItemId,

    wardrobeType:
      job.wardrobe
        .wardrobeType,

    category:
      job.wardrobe.category,

    subcategory:
      job.wardrobe
        .subcategory,

    itemName:
      job.wardrobe.itemName,

    color:
      job.wardrobe.color,

    style:
      job.wardrobe.style,

    season:
      job.wardrobe.season,

    occasion:
      job.wardrobe.occasion,

    isFavorite:
      job.wardrobe
        .isFavorite,

    metadata: {
      ...job.wardrobe.metadata,
    },
  };
}

function createSegmentationSourceFromPreparedSource(
  source:
    ScanItemProcessingImageSource | null
): SegmentationSource | null {
  if (
    !source
  ) {
    return null;
  }

  return {
    uri:
      source.uri,

    width:
      source.width ??
      undefined,

    height:
      source.height ??
      undefined,

    orientation:
      source.orientation ??
      undefined,

    id:
      source.sourceId,

    metadata: {
      ...source.metadata,
    },
  };
}

function normalizeConfig(
  config:
    PartialScanItemProcessingExecutorConfig
): ScanItemProcessingExecutorConfig {
  const merged:
    ScanItemProcessingExecutorConfig = {
    ...DEFAULT_SCAN_ITEM_PROCESSING_EXECUTOR_CONFIG,
    ...config,
  };

  const minimumProgress =
    clampUnitValue(
      merged.minimumProgress
    );

  const maximumProgressBeforeCompletion =
    clampProgressRange(
      merged
        .maximumProgressBeforeCompletion,
      minimumProgress,
      0.999
    );

  const validateSourceProgress =
    clampProgressRange(
      merged
        .validateSourceProgress,
      minimumProgress,
      maximumProgressBeforeCompletion
    );

  const prepareSourceProgress =
    clampProgressRange(
      merged
        .prepareSourceProgress,
      validateSourceProgress,
      maximumProgressBeforeCompletion
    );

  const segmentationStartProgress =
    clampProgressRange(
      merged
        .segmentationStartProgress,
      prepareSourceProgress,
      maximumProgressBeforeCompletion
    );

  const segmentationEndProgress =
    clampProgressRange(
      merged
        .segmentationEndProgress,
      segmentationStartProgress,
      maximumProgressBeforeCompletion
    );

  const saveImageProgress =
    clampProgressRange(
      merged
        .saveImageProgress,
      segmentationEndProgress,
      maximumProgressBeforeCompletion
    );

  const updateWardrobeProgress =
    clampProgressRange(
      merged
        .updateWardrobeProgress,
      saveImageProgress,
      maximumProgressBeforeCompletion
    );

  const cleanupProgress =
    clampProgressRange(
      merged.cleanupProgress,
      updateWardrobeProgress,
      maximumProgressBeforeCompletion
    );

  return {
    minimumProgress,

    maximumProgressBeforeCompletion,

    validateSourceProgress,

    prepareSourceProgress,

    segmentationStartProgress,

    segmentationEndProgress,

    saveImageProgress,

    updateWardrobeProgress,

    cleanupProgress,

    enableDebugLogs:
      merged.enableDebugLogs,
  };
}

function mapSegmentationProgress(
  segmentationProgress:
    number,
  config:
    ScanItemProcessingExecutorConfig
): number {
  const normalized =
    clampUnitValue(
      segmentationProgress
    );

  const range =
    config
      .segmentationEndProgress -
    config
      .segmentationStartProgress;

  return clampProgressRange(
    config
      .segmentationStartProgress +
    (
      normalized *
      range
    ),
    config
      .segmentationStartProgress,
    config
      .segmentationEndProgress
  );
}

function createJobOutput(
  job:
    ProcessingJob,
  segmentation:
    ScanItemSegmentationResult,
  savedOutput:
    ScanItemSavedOutput,
  wardrobeUpdate:
    ScanItemWardrobeUpdateResult,
  completedAt:
    ProcessingTimestamp
): ProcessingJobOutput {
  const width =
    normalizePositiveDimension(
      savedOutput.width,
      segmentation.maskWidth
    );

  const height =
    normalizePositiveDimension(
      savedOutput.height,
      segmentation.maskHeight
    );

  return {
    processedImageUri:
      savedOutput
        .processedImageUri,

    width,

    height,

    format:
      'png',

    fileSizeBytes:
      savedOutput
        .fileSizeBytes,

    completedAt,

    metadata: {
      ...savedOutput.metadata,
      ...wardrobeUpdate.metadata,

      wardrobeItemId:
        job.wardrobeItemId,

      requestId:
        segmentation.requestId,

      maskWidth:
        segmentation.maskWidth,

      maskHeight:
        segmentation.maskHeight,

      foregroundRatio:
        segmentation
          .foregroundRatio,

      segmentationDurationMs:
        segmentation.durationMs,

      wardrobeUpdated:
        wardrobeUpdate.updated,
    },
  };
}

function resolveSegmentationStage(
  progress:
    ScanItemSegmentationProgress
): SegmentationPipelineStage {
  return progress.stage;
}

/* =========================================================
 * Executor class
 * ======================================================= */

export class ScanItemProcessingExecutor {
  private readonly adapter:
    ScanItemProcessingAdapter;

  private readonly config:
    ScanItemProcessingExecutorConfig;

  private diagnostics:
    ScanItemProcessingExecutorDiagnostics;

  constructor(
    adapter:
      ScanItemProcessingAdapter,
    config:
      PartialScanItemProcessingExecutorConfig =
        {}
  ) {
    this.adapter =
      adapter;

    this.config =
      normalizeConfig(
        config
      );

    this.diagnostics = {
      createdAt:
        now(),

      executionCount:
        0,

      successfulCount:
        0,

      failedCount:
        0,

      cancelledCount:
        0,

      totalDurationMs:
        0,

      averageDurationMs:
        0,

      lastStartedAt:
        null,

      lastCompletedAt:
        null,

      lastFailedAt:
        null,

      lastJobId:
        null,

      lastRequestId:
        null,

      lastError:
        null,
    };
  }

  public execute:
    ProcessingJobExecutor =
    async (
      job,
      context
    ): Promise<
      ProcessingJobExecutionResult
    > => {
      const startedAt =
        now();

      let currentStage:
        ProcessingJobStage =
          'validate-source';

      let preparedSource:
        ScanItemProcessingImageSource | null =
          null;

      let segmentation:
        ScanItemSegmentationResult | null =
          null;

      let savedOutput:
        ScanItemSavedOutput | null =
          null;

      let segmentationSource:
        SegmentationSource | null =
          null;

      let succeeded =
        false;

      this.diagnostics = {
        ...this.diagnostics,

        executionCount:
          this.diagnostics
            .executionCount +
          1,

        lastStartedAt:
          startedAt,

        lastJobId:
          job.id,

        lastRequestId:
          job.requestId,

        lastError:
          null,
      };

      try {
        context
          .cancellationSignal
          .throwIfCancelled();

        const source =
          createSourceFromJob(
            job
          );

        const wardrobe =
          createWardrobeContextFromJob(
            job
          );

        await context.updateProgress({
          progress:
            this.config
              .validateSourceProgress,

          stage:
            'validate-source',

          message:
            'Validating the source image.',

          estimatedRemainingMs:
            job.timing
              .estimatedProcessingMs,

          segmentationProgress:
            null,
        });

        await this.adapter
          .validateSource(
            source,
            job
          );

        context
          .cancellationSignal
          .throwIfCancelled();

        currentStage =
          'load-source';

        await context.updateProgress({
          progress:
            this.config
              .prepareSourceProgress,

          stage:
            'load-source',

          message:
            'Preparing the source image.',

          estimatedRemainingMs:
            job.timing
              .estimatedProcessingMs,

          segmentationProgress:
            null,
        });

        preparedSource =
          this.adapter
            .prepareSource
            ? await this.adapter
                .prepareSource(
                  source,
                  job
                )
            : source;

        segmentationSource =
          createSegmentationSourceFromPreparedSource(
            preparedSource
          );

        context
          .cancellationSignal
          .throwIfCancelled();

        currentStage =
          'prepare-segmentation';

        await context.updateProgress({
          progress:
            this.config
              .segmentationStartProgress,

          stage:
            'prepare-segmentation',

          message:
            'Preparing EdgeSAM segmentation.',

          estimatedRemainingMs:
            job.timing
              .estimatedProcessingMs,

          segmentationProgress:
            null,
        });

        currentStage =
          'run-mask-decoder';

        segmentation =
          await this.adapter
            .runSegmentation({
              requestId:
                job.requestId,

              source:
                preparedSource,

              wardrobe,

              cancellationSignal:
                context
                  .cancellationSignal,

              onProgress:
                async progress => {
                  context
                    .cancellationSignal
                    .throwIfCancelled();

                  const queueProgress =
                    mapSegmentationProgress(
                      progress.progress,
                      this.config
                    );

                  const elapsedMs =
                    normalizeDuration(
                      now() -
                      startedAt
                    );

                  const estimatedRemainingMs =
                    Math.max(
                      0,
                      job.timing
                        .estimatedProcessingMs -
                      elapsedMs
                    );

                  const segmentationStage =
                    resolveSegmentationStage(
                      progress
                    );

                  currentStage =
                    segmentationStage;

                  await context
                    .updateProgress({
                      progress:
                        queueProgress,

                      stage:
                        segmentationStage,

                      message:
                        progress.message,

                      estimatedRemainingMs,

                      segmentationProgress: {
                        ...progress,

                        requestId:
                          progress.requestId ||
                          job.requestId,

                        progress:
                          clampUnitValue(
                            progress.progress
                          ),

                        metadata:
                          progress.metadata
                            ? {
                                ...progress
                                  .metadata,
                              }
                            : undefined,
                      },
                    });
                },
            });

        context
          .cancellationSignal
          .throwIfCancelled();

        segmentationSource =
          segmentation
            .segmentationSource ??
          segmentationSource;

        if (
          !segmentation
            .transparentImageUri ||
          segmentation
            .transparentImageUri
            .trim()
            .length ===
            0
        ) {
          throw createExecutorError(
            'PROCESSED_IMAGE_NOT_FOUND',
            'Segmentation completed without a transparent image URI.',
            {
              source:
                'export',

              retryable:
                false,

              attempt:
                context.attempt,

              stage:
                'export-transparent-image',

              metadata: {
                jobId:
                  job.id,

                requestId:
                  job.requestId,
              },
            }
          );
        }

        currentStage =
          'save-processed-image';

        await context.updateProgress({
          progress:
            this.config
              .saveImageProgress,

          stage:
            'save-processed-image',

          message:
            'Saving the processed image.',

          estimatedRemainingMs:
            Math.max(
              0,
              job.timing
                .estimatedProcessingMs -
              (
                now() -
                startedAt
              )
            ),

          segmentationProgress:
            null,
        });

        savedOutput =
          await this.adapter
            .saveProcessedImage({
              job,

              segmentation,

              cancellationSignal:
                context
                  .cancellationSignal,
            });

        context
          .cancellationSignal
          .throwIfCancelled();

        if (
          !savedOutput
            .processedImageUri ||
          savedOutput
            .processedImageUri
            .trim()
            .length ===
            0
        ) {
          throw createExecutorError(
            'PROCESSED_IMAGE_NOT_FOUND',
            'The processed image was not saved correctly.',
            {
              source:
                'export',

              retryable:
                false,

              attempt:
                context.attempt,

              stage:
                'save-processed-image',

              metadata: {
                jobId:
                  job.id,

                requestId:
                  job.requestId,
              },
            }
          );
        }

        currentStage =
          'update-wardrobe-item';

        await context.updateProgress({
          progress:
            this.config
              .updateWardrobeProgress,

          stage:
            'update-wardrobe-item',

          message:
            'Updating your wardrobe item.',

          estimatedRemainingMs:
            Math.max(
              0,
              job.timing
                .estimatedProcessingMs -
              (
                now() -
                startedAt
              )
            ),

          segmentationProgress:
            null,
        });

        const wardrobeUpdate =
          await this.adapter
            .updateWardrobeItem({
              job,

              savedOutput,

              segmentation,

              cancellationSignal:
                context
                  .cancellationSignal,
            });

        context
          .cancellationSignal
          .throwIfCancelled();

        if (
          !wardrobeUpdate.updated
        ) {
          throw createExecutorError(
            'WARDROBE_ITEM_UPDATE_FAILED',
            'The processed image was created, but the wardrobe item was not updated.',
            {
              source:
                'wardrobe',

              retryable:
                true,

              attempt:
                context.attempt,

              stage:
                'update-wardrobe-item',

              metadata: {
                jobId:
                  job.id,

                wardrobeItemId:
                  job.wardrobeItemId,

                processedImageUri:
                  savedOutput
                    .processedImageUri,
              },
            }
          );
        }

        await context.updateProgress({
          progress:
            this.config
              .cleanupProgress,

          stage:
            'update-wardrobe-item',

          message:
            'Finishing item processing.',

          estimatedRemainingMs:
            0,

          segmentationProgress:
            null,
        });

        succeeded =
          true;

        const completedAt =
          now();

        const durationMs =
          normalizeDuration(
            completedAt -
            startedAt
          );

        const output =
          createJobOutput(
            job,
            segmentation,
            savedOutput,
            wardrobeUpdate,
            completedAt
          );

        this.recordSuccessfulExecution(
          durationMs,
          completedAt
        );

        return {
          job,

          succeeded:
            true,

          output,

          error:
            null,

          segmentationSource,
        };
      } catch (error) {
        const failedAt =
          now();

        const cancelled =
          context
            .cancellationSignal
            .cancelled;

        const resolvedError =
          cancelled
            ? createExecutorError(
                'JOB_CANCELLED',
                context
                  .cancellationSignal
                  .reason ??
                'Processing was cancelled.',
                {
                  source:
                    'queue',

                  retryable:
                    false,

                  attempt:
                    context.attempt,

                  stage:
                    'cancelled',

                  metadata: {
                    jobId:
                      job.id,

                    requestId:
                      job.requestId,
                  },
                }
              )
            : resolveExecutorError(
                error,
                job,
                currentStage
              );

        this.recordFailedExecution(
          resolvedError,
          normalizeDuration(
            failedAt -
            startedAt
          ),
          failedAt,
          cancelled
        );

        return {
          job,

          succeeded:
            false,

          output:
            null,

          error:
            resolvedError,

          segmentationSource,
        };
      } finally {
        if (
          this.adapter
            .cleanupTemporaryFiles
        ) {
          try {
            await this.adapter
              .cleanupTemporaryFiles({
                job,

                preparedSource,

                segmentation,

                savedOutput,

                succeeded,
              });
          } catch (cleanupError) {
            if (
              this.config
                .enableDebugLogs
            ) {
              console.warn(
                'TRIPLE N SCAN ITEM TEMPORARY FILE CLEANUP FAILED:',
                cleanupError
              );
            }
          }
        }
      }
    };

  public getExecutor():
    ProcessingJobExecutor {
    return this.execute;
  }

  public getDiagnostics():
    ScanItemProcessingExecutorDiagnostics {
    return {
      ...this.diagnostics,

      lastError:
        cloneError(
          this.diagnostics
            .lastError
        ),
    };
  }

  private recordSuccessfulExecution(
    durationMs:
      number,
    completedAt:
      ProcessingTimestamp
  ): void {
    const successfulCount =
      this.diagnostics
        .successfulCount +
      1;

    const completedExecutionCount =
      successfulCount +
      this.diagnostics
        .failedCount;

    const totalDurationMs =
      this.diagnostics
        .totalDurationMs +
      durationMs;

    this.diagnostics = {
      ...this.diagnostics,

      successfulCount,

      totalDurationMs,

      averageDurationMs:
        completedExecutionCount >
          0
          ? totalDurationMs /
            completedExecutionCount
          : 0,

      lastCompletedAt:
        completedAt,

      lastError:
        null,
    };
  }

  private recordFailedExecution(
    error:
      ProcessingJobError,
    durationMs:
      number,
    failedAt:
      ProcessingTimestamp,
    cancelled:
      boolean
  ): void {
    const failedCount =
      this.diagnostics
        .failedCount +
      1;

    const completedExecutionCount =
      this.diagnostics
        .successfulCount +
      failedCount;

    const totalDurationMs =
      this.diagnostics
        .totalDurationMs +
      durationMs;

    this.diagnostics = {
      ...this.diagnostics,

      failedCount,

      cancelledCount:
        this.diagnostics
          .cancelledCount +
        (
          cancelled
            ? 1
            : 0
        ),

      totalDurationMs,

      averageDurationMs:
        completedExecutionCount >
          0
          ? totalDurationMs /
            completedExecutionCount
          : 0,

      lastFailedAt:
        failedAt,

      lastError:
        cloneError(
          error
        ),
    };
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createScanItemProcessingExecutor(
  adapter:
    ScanItemProcessingAdapter,
  config:
    PartialScanItemProcessingExecutorConfig =
      {}
): ScanItemProcessingExecutor {
  return new ScanItemProcessingExecutor(
    adapter,
    config
  );
}

export function createScanItemProcessingJobExecutor(
  adapter:
    ScanItemProcessingAdapter,
  config:
    PartialScanItemProcessingExecutorConfig =
      {}
): ProcessingJobExecutor {
  return createScanItemProcessingExecutor(
    adapter,
    config
  ).getExecutor();
}