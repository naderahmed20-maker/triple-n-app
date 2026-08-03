// scan/core/services/LocalScanItemProcessingAdapter.ts
//
// Triple N - Local Scan Item Processing Adapter
//
// هذا الملف يربط ScanItemProcessingExecutor
// بخدمة EdgeSAM المحلية الحقيقية.
//
// التدفق:
//
// ProcessingQueue
// → ScanItemProcessingExecutor
// → LocalScanItemProcessingAdapter
// → createLocalTransparentImage
// → EdgeSAM
// → Transparent PNG
// → تحديث عنصر الدولاب
//
// ملاحظة:
//
// تحديث عنصر الدولاب يتم تمريره كدالة واضحة
// عند إنشاء الـAdapter، حتى لا نفترض اسم API
// غير موجود داخل wardrobeService.ts.

import type {
  SegmentationCancellationSignal,
  SegmentationPipelineStage,
  SegmentationProgressEvent,
} from '../ai/types';

import {
  SEGMENTATION_STAGE_INDEX,
  SEGMENTATION_TOTAL_STAGES,
  getSegmentationProgress,
} from '../ai/types';

import {
  LocalSegmentationServiceError,
  createLocalTransparentImage,
  type LocalSegmentationProgressEvent,
} from '../ai/LocalSegmentationService';

import type {
  ProcessingJob,
  ProcessingJobError,
  ProcessingJobErrorCode,
  ProcessingJobErrorSource,
} from '../queue/QueueTypes';

import type {
  ProcessingQueueCancellationSignal,
} from '../queue/ProcessingQueue';

import type {
  ScanItemProcessingAdapter,
  ScanItemProcessingImageSource,
  ScanItemSavedOutput,
  ScanItemSegmentationResult,
  ScanItemWardrobeUpdateResult,
} from './ScanItemProcessingExecutor';

/* =========================================================
 * Public contracts
 * ======================================================= */

export type LocalScanItemWardrobeUpdateInput = {
  wardrobeItemId:
    string;

  originalImageUri:
    string;

  processedImageUri:
    string;

  width:
    number;

  height:
    number;

  category:
    string | null;

  subcategory:
    string | null;

  wardrobeType:
    'male' | 'female' | null;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type LocalScanItemWardrobeUpdater = (
  input:
    LocalScanItemWardrobeUpdateInput
) => Promise<
  void | boolean | {
    updated:
      boolean;

    metadata?:
      Readonly<
        Record<
          string,
          string | number | boolean | null
        >
      >;
  }
>;

export type LocalScanItemFileInspectorResult = {
  exists:
    boolean;

  readable:
    boolean;

  fileSizeBytes:
    number | null;
};

export type LocalScanItemFileInspector = (
  uri:
    string
) => Promise<
  LocalScanItemFileInspectorResult
>;

export type LocalScanItemTemporaryFileCleaner = (
  input: {
    uri:
      string;

    job:
      ProcessingJob;
  }
) => Promise<void>;

export type LocalScanItemProcessingAdapterOptions = {
  updateWardrobeItem:
    LocalScanItemWardrobeUpdater;

  inspectFile?:
    LocalScanItemFileInspector;

  cleanupTemporaryFile?:
    LocalScanItemTemporaryFileCleaner;

  quality?:
    number;

  collectDiagnostics?:
    boolean;

  reuseSession?:
    boolean;

  fileNamePrefix?:
    string;

  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type LocalScanItemProcessingAdapterDiagnostics = {
  createdAt:
    number;

  validationCount:
    number;

  segmentationCount:
    number;

  saveCount:
    number;

  wardrobeUpdateCount:
    number;

  cleanupCount:
    number;

  successfulSegmentationCount:
    number;

  failedSegmentationCount:
    number;

  lastJobId:
    string | null;

  lastRequestId:
    string | null;

  lastProcessedImageUri:
    string | null;

  lastError:
    string | null;
};

/* =========================================================
 * General helpers
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

function normalizePositiveInteger(
  value:
    number,
  fallback =
    1
): number {
  if (
    !Number.isFinite(
      value
    ) ||
    value <=
      0
  ) {
    return Math.max(
      1,
      Math.floor(
        fallback
      )
    );
  }

  return Math.max(
    1,
    Math.floor(
      value
    )
  );
}

function normalizeFileSize(
  value:
    number | null | undefined
): number | null {
  if (
    typeof value !==
      'number' ||
    !Number.isFinite(
      value
    ) ||
    value <
      0
  ) {
    return null;
  }

  return Math.floor(
    value
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

function assertValidUri(
  uri:
    string,
  message:
    string
): string {
  if (
    typeof uri !==
      'string' ||
    uri.trim().length ===
      0
  ) {
    throw new Error(
      message
    );
  }

  return uri.trim();
}

/* =========================================================
 * Queue cancellation → Segmentation cancellation
 * ======================================================= */

function createSegmentationCancellationSignal(
  queueSignal:
    ProcessingQueueCancellationSignal
): SegmentationCancellationSignal {
  return {
    get cancelled():
      boolean {
      return queueSignal
        .cancelled;
    },

    get reason():
      string | undefined {
      return (
        queueSignal.reason ??
        undefined
      );
    },

    throwIfCancelled():
      void {
      queueSignal
        .throwIfCancelled();
    },
  };
}

/* =========================================================
 * Progress conversion
 * ======================================================= */

function resolveProgressStage(
  event:
    LocalSegmentationProgressEvent
): SegmentationPipelineStage {
  if (
    event.stage ===
      'segmentation'
  ) {
    return (
      event.segmentationStage ??
      'run-mask-decoder'
    );
  }

  if (
    event.stage ===
      'exporting'
  ) {
    return 'protect-object-edges';
  }

  return 'complete';
}

function createSegmentationProgressEvent(
  event:
    LocalSegmentationProgressEvent,
  requestId:
    string
): SegmentationProgressEvent {
  const stage =
    resolveProgressStage(
      event
    );

  const stageNumber =
    SEGMENTATION_STAGE_INDEX[
      stage
    ];

  const calculatedProgress =
    event.stage ===
      'segmentation'
      ? clampUnitValue(
          event.progress
        )
      : getSegmentationProgress(
          stage
        );

  return {
    requestId,

    stage,

    stageNumber,

    totalStages:
      SEGMENTATION_TOTAL_STAGES,

    progress:
      event.stage ===
        'complete'
        ? 1
        : calculatedProgress,

    message:
      event.message,

    elapsedMs:
      Math.max(
        0,
        Math.floor(
          event.elapsedMs
        )
      ),

    metadata: {
      localServiceStage:
        event.stage,

      segmentationStage:
        event
          .segmentationStage ??
        null,
    },
  };
}

/* =========================================================
 * Serialized progress forwarding
 * ======================================================= */

/**
 * EdgeSAM قد يرسل Progress Events بسرعة كبيرة.
 *
 * سابقًا كان كل Event يشغّل Promise مستقلة من خلال:
 *
 * void input.onProgress(...)
 *
 * وهذا يسمح بتراكم عمليات تحديث الـQueue والحفظ
 * في الذاكرة أثناء استمرار معالجة الصورة.
 *
 * هذا الـForwarder يضمن:
 *
 * 1) وجود عملية Progress واحدة فقط في نفس الوقت.
 * 2) الاحتفاظ بأحدث Event فقط أثناء انشغال العملية.
 * 3) عدم التأثير على EdgeSAM أو نتيجة القص.
 * 4) عدم إيقاف المعالجة بسبب خطأ واجهة أو Progress.
 */
function createSerializedProgressForwarder(
  callback:
    (
      progress:
        SegmentationProgressEvent
    ) => Promise<void>,
  requestId:
    string,
  enableDebugLogs:
    boolean
): {
  push(
    event:
      LocalSegmentationProgressEvent
  ): void;

  flush():
    Promise<void>;
} {
  let pendingEvent:
    LocalSegmentationProgressEvent | null =
      null;

  let worker:
    Promise<void> | null =
      null;

  async function drain():
    Promise<void> {
    while (
      pendingEvent
    ) {
      const currentEvent =
        pendingEvent;

      pendingEvent =
        null;

      try {
        await callback(
          createSegmentationProgressEvent(
            currentEvent,
            requestId
          )
        );
      } catch (
        error:
          unknown
      ) {
        /**
         * Progress reporting لا يجب أن يكسر
         * معالجة الصورة أو يغيّر النتيجة.
         */
        if (
          enableDebugLogs
        ) {
          console.warn(
            'TRIPLE N LOCAL PROGRESS FORWARDING ERROR:',
            error
          );
        }
      }
    }
  }

  function ensureWorker():
    void {
    if (
      worker ||
      !pendingEvent
    ) {
      return;
    }

    worker =
      drain()
        .finally(
          () => {
            worker =
              null;

            /**
             * قد يصل Event جديد بين نهاية drain
             * وتنظيف worker.
             */
            if (
              pendingEvent
            ) {
              ensureWorker();
            }
          }
        );
  }

  return {
    push(
      event:
        LocalSegmentationProgressEvent
    ): void {
      /**
       * نستبدل الـEvent المنتظر بالأحدث.
       *
       * لا نحتاج تخزين كل النسب الوسيطة؛
       * المهم ألا نفقد أحدث حالة.
       */
      pendingEvent =
        event;

      ensureWorker();
    },

    async flush():
      Promise<void> {
      while (
        worker ||
        pendingEvent
      ) {
        ensureWorker();

        const activeWorker =
          worker;

        if (
          activeWorker
        ) {
          await activeWorker;
        }
      }
    },
  };
}

/* =========================================================
 * Error conversion
 * ======================================================= */

function resolveQueueErrorCode(
  error:
    LocalSegmentationServiceError
): ProcessingJobErrorCode {
  if (
    error.segmentationError
  ) {
    return error
      .segmentationError
      .code;
  }

  switch (
    error.code
  ) {
    case 'INVALID_SOURCE':
      return 'INVALID_SOURCE_URI';

    case 'INVALID_MASK':
      return 'MASK_INVALID';

    case 'EXPORT_FAILED':
      return 'EXPORT_FAILED';

    case 'CANCELLED':
      return 'JOB_CANCELLED';

    case 'DISPOSED':
      return 'SESSION_DISPOSED';

    case 'SEGMENTATION_FAILED':
      return 'INFERENCE_FAILED';

    default:
      return 'UNKNOWN_QUEUE_ERROR';
  }
}

function resolveQueueErrorSource(
  error:
    LocalSegmentationServiceError
): ProcessingJobErrorSource {
  switch (
    error.code
  ) {
    case 'INVALID_SOURCE':
      return 'image-source';

    case 'EXPORT_FAILED':
      return 'export';

    case 'CANCELLED':
      return 'queue';

    default:
      return 'segmentation';
  }
}

function createProcessingError(
  error:
    LocalSegmentationServiceError,
  job:
    ProcessingJob
): ProcessingJobError {
  const segmentationError =
    error.segmentationError;

  return {
    code:
      resolveQueueErrorCode(
        error
      ),

    message:
      error.message,

    source:
      resolveQueueErrorSource(
        error
      ),

    retryable:
      segmentationError
        ?.retryable ??
      (
        error.code ===
          'SEGMENTATION_FAILED'
      ),

    occurredAt:
      now(),

    attempt:
      job.retry.attempt,

    stage:
      segmentationError
        ?.stage ??
      (
        error.code ===
          'EXPORT_FAILED'
          ? 'export-transparent-image'
          : 'run-mask-decoder'
      ),

    nativeCode:
      null,

    segmentationErrorCode:
      segmentationError
        ?.code ??
      null,

    metadata: {
      jobId:
        job.id,

      requestId:
        job.requestId,

      wardrobeItemId:
        job.wardrobeItemId,

      localServiceErrorCode:
        error.code,
    },
  };
}

/* =========================================================
 * Adapter class
 * ======================================================= */

export class LocalScanItemProcessingAdapter
  implements ScanItemProcessingAdapter
{
  private readonly options:
    Required<
      Pick<
        LocalScanItemProcessingAdapterOptions,
        | 'quality'
        | 'collectDiagnostics'
        | 'reuseSession'
        | 'fileNamePrefix'
        | 'enableDebugLogs'
      >
    > &
    Pick<
      LocalScanItemProcessingAdapterOptions,
      | 'updateWardrobeItem'
      | 'inspectFile'
      | 'cleanupTemporaryFile'
    >;

  private diagnostics:
    LocalScanItemProcessingAdapterDiagnostics;

  constructor(
    options:
      LocalScanItemProcessingAdapterOptions
  ) {
    if (
      typeof options
        .updateWardrobeItem !==
      'function'
    ) {
      throw new Error(
        'LocalScanItemProcessingAdapter requires updateWardrobeItem.'
      );
    }

    this.options = {
      updateWardrobeItem:
        options
          .updateWardrobeItem,

      inspectFile:
        options.inspectFile,

      cleanupTemporaryFile:
        options
          .cleanupTemporaryFile,

      quality:
        Math.min(
          100,
          Math.max(
            1,
            Math.floor(
              options.quality ??
              100
            )
          )
        ),

      collectDiagnostics:
        options
          .collectDiagnostics ??
        false,

      reuseSession:
        options.reuseSession ??
        true,

      fileNamePrefix:
        options
          .fileNamePrefix
          ?.trim() ||
        'scan-item-queue',

      enableDebugLogs:
        options
          .enableDebugLogs ??
        false,
    };

    this.diagnostics = {
      createdAt:
        now(),

      validationCount:
        0,

      segmentationCount:
        0,

      saveCount:
        0,

      wardrobeUpdateCount:
        0,

      cleanupCount:
        0,

      successfulSegmentationCount:
        0,

      failedSegmentationCount:
        0,

      lastJobId:
        null,

      lastRequestId:
        null,

      lastProcessedImageUri:
        null,

      lastError:
        null,
    };
  }

  /* =======================================================
   * Source validation
   * ===================================================== */

  public async validateSource(
    source:
      ScanItemProcessingImageSource,
    job:
      ProcessingJob
  ): Promise<void> {
    this.diagnostics = {
      ...this.diagnostics,

      validationCount:
        this.diagnostics
          .validationCount +
        1,

      lastJobId:
        job.id,

      lastRequestId:
        job.requestId,

      lastError:
        null,
    };

    const sourceUri =
      assertValidUri(
        source.uri,
        'The Scan Item source image URI is missing.'
      );

    if (
      !this.options
        .inspectFile
    ) {
      return;
    }

    const inspection =
      await this.options
        .inspectFile(
          sourceUri
        );

    if (
      !inspection.exists
    ) {
      throw {
        code:
          'SOURCE_FILE_NOT_FOUND',

        message:
          'The source image file could not be found.',

        source:
          'image-source',

        retryable:
          false,

        occurredAt:
          now(),

        attempt:
          job.retry.attempt,

        stage:
          'validate-source',

        nativeCode:
          null,

        segmentationErrorCode:
          null,

        metadata: {
          jobId:
            job.id,

          sourceUri,
        },
      } satisfies ProcessingJobError;
    }

    if (
      !inspection.readable
    ) {
      throw {
        code:
          'SOURCE_FILE_UNREADABLE',

        message:
          'The source image file could not be read.',

        source:
          'image-source',

        retryable:
          true,

        occurredAt:
          now(),

        attempt:
          job.retry.attempt,

        stage:
          'validate-source',

        nativeCode:
          null,

        segmentationErrorCode:
          null,

        metadata: {
          jobId:
            job.id,

          sourceUri,
        },
      } satisfies ProcessingJobError;
    }
  }

  /* =======================================================
   * Source preparation
   * ===================================================== */

  public async prepareSource(
    source:
      ScanItemProcessingImageSource
  ): Promise<
    ScanItemProcessingImageSource
  > {
    return {
      ...source,

      uri:
        assertValidUri(
          source.uri,
          'The Scan Item source image URI is invalid.'
        ),

      metadata: {
        ...source.metadata,
      },
    };
  }

  /* =======================================================
   * Local EdgeSAM execution
   * ===================================================== */

  public async runSegmentation(
    input:
      Parameters<
        ScanItemProcessingAdapter[
          'runSegmentation'
        ]
      >[0]
  ): Promise<
    ScanItemSegmentationResult
  > {
    this.diagnostics = {
      ...this.diagnostics,

      segmentationCount:
        this.diagnostics
          .segmentationCount +
        1,

      lastRequestId:
        input.requestId,

      lastError:
        null,
    };

   const segmentationSignal =
  createSegmentationCancellationSignal(
    input
      .cancellationSignal
  );

const progressForwarder =
  createSerializedProgressForwarder(
    input.onProgress,
    input.requestId,
    this.options
      .enableDebugLogs
  );

try {
      const result =
        await createLocalTransparentImage({
          sourceUri:
            input.source.uri,

          requestId:
            input.requestId,

          fileNamePrefix:
            this.options
              .fileNamePrefix,

          quality:
            this.options.quality,

          reuseSession:
            this.options
              .reuseSession,

          collectDiagnostics:
            this.options
              .collectDiagnostics,

          cancellationSignal:
            segmentationSignal,

          onProgress:
  event => {
    progressForwarder
      .push(
        event
      );
  },
        });
        await progressForwarder
  .flush();

      this.diagnostics = {
        ...this.diagnostics,

        successfulSegmentationCount:
          this.diagnostics
            .successfulSegmentationCount +
          1,

        lastProcessedImageUri:
          result
            .transparentImageUri,

        lastError:
          null,
      };

      return {
        requestId:
          result.requestId,

        transparentImageUri:
          result
            .transparentImageUri,

        maskWidth:
          normalizePositiveInteger(
            result.width
          ),

        maskHeight:
          normalizePositiveInteger(
            result.height
          ),

        foregroundRatio:
          Number.isFinite(
            result
              .maskStatistics
              .foregroundRatio
          )
            ? clampUnitValue(
                result
                  .maskStatistics
                  .foregroundRatio
              )
            : null,

        durationMs:
          Math.max(
            0,
            Math.floor(
              result.totalMs
            )
          ),

        segmentationSource: {
          uri:
            input.source.uri,

          width:
            input.source.width ??
            undefined,

          height:
            input.source.height ??
            undefined,

          orientation:
            input.source
              .orientation ??
            undefined,

          id:
            input.source.sourceId,

          metadata: {
            ...input.source
              .metadata,
          },
        },

        diagnostics: {
          requestId:
            result.requestId,

          foregroundRatio:
            result
              .maskStatistics
              .foregroundRatio,

          selectedCandidateIndex:
            result
              .segmentation
              .selectedCandidate
              .index,

          selectedPredictedIou:
            result
              .segmentation
              .selectedCandidate
              .predictedIou,

          totalMs:
            result.totalMs,

          exportCreatedAt:
            result.export
              .createdAt,
        },
      };
    } catch (error) {
      this.diagnostics = {
        ...this.diagnostics,

        failedSegmentationCount:
          this.diagnostics
            .failedSegmentationCount +
          1,

        lastError:
          getUnknownErrorMessage(
            error
          ),
      };

      if (
        error instanceof
        LocalSegmentationServiceError
      ) {
        throw createProcessingError(
          error,
          {
            id:
              this.diagnostics
                .lastJobId ??
              input.requestId,

            requestId:
              input.requestId,

            wardrobeItemId:
              input.wardrobe
                .wardrobeItemId,

            retry: {
              attempt:
                0,
            },
          } as ProcessingJob
        );
      }

      throw error;
    }
  }

  /* =======================================================
   * Output saving
   * ===================================================== */

  public async saveProcessedImage(
    input:
      Parameters<
        ScanItemProcessingAdapter[
          'saveProcessedImage'
        ]
      >[0]
  ): Promise<
    ScanItemSavedOutput
  > {
    input.cancellationSignal
      .throwIfCancelled();

    const processedImageUri =
      assertValidUri(
        input.segmentation
          .transparentImageUri,
        'The transparent image URI is missing.'
      );

    let fileSizeBytes:
      number | null =
        null;

    if (
      this.options
        .inspectFile
    ) {
      const inspection =
        await this.options
          .inspectFile(
            processedImageUri
          );

      if (
        !inspection.exists
      ) {
        throw {
          code:
            'PROCESSED_IMAGE_NOT_FOUND',

          message:
            'The generated transparent image could not be found.',

          source:
            'export',

          retryable:
            false,

          occurredAt:
            now(),

          attempt:
            input.job.retry
              .attempt,

          stage:
            'save-processed-image',

          nativeCode:
            null,

          segmentationErrorCode:
            null,

          metadata: {
            jobId:
              input.job.id,

            processedImageUri,
          },
        } satisfies ProcessingJobError;
      }

      fileSizeBytes =
        normalizeFileSize(
          inspection
            .fileSizeBytes
        );
    }

    this.diagnostics = {
      ...this.diagnostics,

      saveCount:
        this.diagnostics
          .saveCount +
        1,

      lastJobId:
        input.job.id,

      lastProcessedImageUri:
        processedImageUri,

      lastError:
        null,
    };

    return {
      processedImageUri,

      width:
        input.segmentation
          .maskWidth,

      height:
        input.segmentation
          .maskHeight,

      fileSizeBytes,

      metadata: {
        generatedLocally:
          true,

        segmentationRequestId:
          input.segmentation
            .requestId,

        segmentationDurationMs:
          input.segmentation
            .durationMs,
      },
    };
  }

  /* =======================================================
   * Wardrobe update
   * ===================================================== */

  public async updateWardrobeItem(
    input:
      Parameters<
        ScanItemProcessingAdapter[
          'updateWardrobeItem'
        ]
      >[0]
  ): Promise<
    ScanItemWardrobeUpdateResult
  > {
    input.cancellationSignal
      .throwIfCancelled();

    try {
      const result =
        await this.options
          .updateWardrobeItem({
            wardrobeItemId:
              input.job
                .wardrobeItemId,

            originalImageUri:
              input.job.source.uri,

            processedImageUri:
              input.savedOutput
                .processedImageUri,

            width:
              normalizePositiveInteger(
                input.savedOutput
                  .width ??
                input.segmentation
                  .maskWidth
              ),

            height:
              normalizePositiveInteger(
                input.savedOutput
                  .height ??
                input.segmentation
                  .maskHeight
              ),

            category:
              input.job
                .wardrobe
                .category,

            subcategory:
              input.job
                .wardrobe
                .subcategory,

            wardrobeType:
              input.job
                .wardrobe
                .wardrobeType,

            metadata: {
              ...input.job.metadata,

              queueJobId:
                input.job.id,

              batchId:
                input.job.batchId,

              requestId:
                input.job.requestId,

              foregroundRatio:
                input.segmentation
                  .foregroundRatio,
            },
          });

      const normalizedResult =
        typeof result ===
          'object' &&
        result !==
          null
          ? result
          : {
              updated:
                result !== false,

              metadata:
                {},
            };

      this.diagnostics = {
        ...this.diagnostics,

        wardrobeUpdateCount:
          this.diagnostics
            .wardrobeUpdateCount +
          1,

        lastJobId:
          input.job.id,

        lastError:
          null,
      };

      return {
        wardrobeItemId:
          input.job
            .wardrobeItemId,

        processedImageUri:
          input.savedOutput
            .processedImageUri,

        updated:
          normalizedResult
            .updated,

        metadata: {
          ...(normalizedResult
            .metadata ??
          {}),
        },
      };
    } catch (error) {
      this.diagnostics = {
        ...this.diagnostics,

        lastError:
          getUnknownErrorMessage(
            error
          ),
      };

      throw {
        code:
          'WARDROBE_ITEM_UPDATE_FAILED',

        message:
          `Could not update the wardrobe item: ${getUnknownErrorMessage(
            error
          )}`,

        source:
          'wardrobe',

        retryable:
          true,

        occurredAt:
          now(),

        attempt:
          input.job.retry
            .attempt,

        stage:
          'update-wardrobe-item',

        nativeCode:
          null,

        segmentationErrorCode:
          null,

        metadata: {
          jobId:
            input.job.id,

          wardrobeItemId:
            input.job
              .wardrobeItemId,

          processedImageUri:
            input.savedOutput
              .processedImageUri,
        },
      } satisfies ProcessingJobError;
    }
  }

  /* =======================================================
   * Cleanup
   * ===================================================== */

  public async cleanupTemporaryFiles(
    input:
      Parameters<
        NonNullable<
          ScanItemProcessingAdapter[
            'cleanupTemporaryFiles'
          ]
        >
      >[0]
  ): Promise<void> {
    if (
      !this.options
        .cleanupTemporaryFile
    ) {
      return;
    }

    if (
      input.succeeded
    ) {
      return;
    }

    const generatedUri =
      input.segmentation
        ?.transparentImageUri ??
      input.savedOutput
        ?.processedImageUri ??
      null;

    if (
      !generatedUri
    ) {
      return;
    }

    try {
      await this.options
        .cleanupTemporaryFile({
          uri:
            generatedUri,

          job:
            input.job,
        });

      this.diagnostics = {
        ...this.diagnostics,

        cleanupCount:
          this.diagnostics
            .cleanupCount +
          1,
      };
    } catch (error) {
      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N LOCAL SCAN ITEM CLEANUP ERROR:',
          error
        );
      }
    }
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    LocalScanItemProcessingAdapterDiagnostics {
    return {
      ...this.diagnostics,
    };
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createLocalScanItemProcessingAdapter(
  options:
    LocalScanItemProcessingAdapterOptions
): LocalScanItemProcessingAdapter {
  return new LocalScanItemProcessingAdapter(
    options
  );
}