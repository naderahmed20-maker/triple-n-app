// scan/core/queue/ProcessingQueue.ts
// Part 1/2
//
// Triple N - Persistent Scan Item Processing Queue
//
// هذا الملف هو القلب الرئيسي لنظام Queue معالجة صور Scan Item.
//
// مسؤولياته:
//
// 1) إضافة صورة واحدة أو عدة صور إلى الطابور.
// 2) تشغيل صورة واحدة فقط في كل مرة.
// 3) الانتقال تلقائيًا إلى الصورة التالية.
// 4) حفظ حالة الطابور بعد كل تغيير مهم.
// 5) إرسال Events للواجهة والخدمات.
// 6) تحديث نسبة تقدم كل صورة.
// 7) حساب تقدم الدولاب بالكامل.
// 8) إعادة المحاولة عند الأخطاء القابلة للإعادة.
// 9) إيقاف واستكمال المعالجة.
// 10) استعادة Queue بعد إعادة فتح التطبيق.
// 11) إلغاء أو حذف Job.
// 12) منع تشغيل أكثر من Job في نفس الوقت.
// 13) توفير Snapshot آمن للواجهة.
// 14) فصل إدارة الطابور عن تنفيذ EdgeSAM.
//
// هذا الملف لا يشغّل EdgeSAM بنفسه.
//
// التنفيذ الفعلي للصورة يتم تمريره من خلال:
//
// ProcessingJobExecutor
//
// الملفات القادمة ستربط هذا الملف مع:
//
// - ScanItemQueueService.ts
// - BackgroundProcessingService.ts
// - LocalSegmentationService.ts
// - iOS Native Background Processing
// - Android WorkManager

import type {
  CancelProcessingJobRequest,
  CompleteProcessingJobRequest,
  CreateProcessingJobRequest,
  EnqueueProcessingJobsRequest,
  EnqueueProcessingJobsResult,
  FailProcessingJobRequest,
  ProcessingBatchId,
  ProcessingDurationMs,
  ProcessingJob,
  ProcessingJobError,
  ProcessingJobExecutionResult,
  ProcessingJobId,
  ProcessingJobProgress,
  ProcessingJobStage,
  ProcessingJobStatus,
  ProcessingQueueEventType,
  ProcessingQueueSnapshot,
  ProcessingQueueStatistics,
  ProcessingQueueStatus,
  ProcessingTimestamp,
  RemoveProcessingJobRequest,
  RetryProcessingJobRequest,
  UpdateProcessingJobProgressRequest,
} from './QueueTypes';

import {
  COMPLETE_QUEUE_ITEM_PROGRESS,
  PROCESSING_QUEUE_SCHEMA_VERSION,
  calculateQueueStatistics,
  canCancelProcessingJob,
  canRetryProcessingJob,
  clampProcessingProgress,
  createProcessingJob,
  createProcessingJobId,
  isProcessingJobActive,
  isProcessingJobPending,
  isProcessingJobTerminal,
  normalizeProcessingDuration,
  processingProgressToPercentage,
  reindexProcessingJobs,
  sortProcessingJobs,
} from './QueueTypes';

import type {
  ProcessingQueueEventBus,
} from './QueueEvents';

import {
  getDefaultProcessingQueueEventBus,
} from './QueueEvents';

import type {
  ProcessingQueueStorage,
} from './QueueStorage';

import {
  getDefaultProcessingQueueStorage,
} from './QueueStorage';

import type {
  ScanItemProcessingConfig,
} from './ProcessingConfig';

import {
  calculateProcessingRetryDelayMs,
  cloneProcessingQueueConfig,
  getDefaultScanItemProcessingConfig,
} from './ProcessingConfig';

import type {
  ProcessingQueueTimeEstimate,
  ProcessingTimeEstimator,
} from './TimeEstimator';

import {
  getDefaultProcessingTimeEstimator,
} from './TimeEstimator';

/* =========================================================
 * Public executor contracts
 * ======================================================= */

export type ProcessingJobExecutionContext = {
  queueId:
    string;

  jobId:
    ProcessingJobId;

  requestId:
    string;

  batchId:
    ProcessingBatchId;

  attempt:
    number;

  startedAt:
    ProcessingTimestamp;

  cancellationSignal:
    ProcessingQueueCancellationSignal;

  updateProgress(
    request:
      Omit<
        UpdateProcessingJobProgressRequest,
        'jobId'
      >
  ): Promise<void>;

  isApplicationInBackground():
    boolean;
};

export type ProcessingJobExecutor = (
  job:
    ProcessingJob,
  context:
    ProcessingJobExecutionContext
) => Promise<
  ProcessingJobExecutionResult
>;

export type ProcessingQueueCancellationSignal = {
  readonly cancelled:
    boolean;

  readonly reason:
    string | null;

  throwIfCancelled():
    void;
};

export type ProcessingQueueCancellationController = {
  readonly signal:
    ProcessingQueueCancellationSignal;

  cancel(
    reason?:
      string
  ): void;
};

/* =========================================================
 * Queue options
 * ======================================================= */

export type ProcessingQueueOptions = {
  config?:
    ScanItemProcessingConfig;

  executor?:
    ProcessingJobExecutor | null;

  storage?:
    ProcessingQueueStorage;

  eventBus?:
    ProcessingQueueEventBus;

  timeEstimator?:
    ProcessingTimeEstimator;

  autoInitialize?:
    boolean;

  applicationStateProvider?:
    () =>
      | 'active'
      | 'inactive'
      | 'background'
      | 'unknown';
};

/* =========================================================
 * Queue initialization
 * ======================================================= */

export type ProcessingQueueInitializeResult = {
  initialized:
    boolean;

  restored:
    boolean;

  recoveredFromBackup:
    boolean;

  snapshot:
    ProcessingQueueSnapshot;

  warnings:
    readonly string[];

  durationMs:
    ProcessingDurationMs;
};

/* =========================================================
 * Queue operation result
 * ======================================================= */

export type ProcessingQueueOperationResult = {
  changed:
    boolean;

  snapshot:
    ProcessingQueueSnapshot;

  job:
    ProcessingJob | null;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type ProcessingQueueDiagnostics = {
  initialized:
    boolean;

  disposed:
    boolean;

  running:
    boolean;

  loopActive:
    boolean;

  executorAvailable:
    boolean;

  activeJobId:
    ProcessingJobId | null;

  queuedOperationCount:
    number;

  successfulJobCount:
    number;

  failedJobCount:
    number;

  cancelledJobCount:
    number;

  retryScheduledCount:
    number;

  initializeCount:
    number;

  startCount:
    number;

  pauseCount:
    number;

  resumeCount:
    number;

  stopCount:
    number;

  persistCount:
    number;

  persistFailureCount:
    number;

  lastOperationAt:
    ProcessingTimestamp | null;

  lastJobStartedAt:
    ProcessingTimestamp | null;

  lastJobCompletedAt:
    ProcessingTimestamp | null;

  lastJobFailedAt:
    ProcessingTimestamp | null;

  lastError:
    ProcessingJobError | null;
};

/* =========================================================
 * Internal cancellation implementation
 * ======================================================= */

class DefaultQueueCancellationSignal
  implements ProcessingQueueCancellationSignal
{
  private _cancelled =
    false;

  private _reason:
    string | null =
      null;

  get cancelled():
    boolean {
    return this._cancelled;
  }

  get reason():
    string | null {
    return this._reason;
  }

  public cancel(
    reason?:
      string
  ): void {
    if (
      this._cancelled
    ) {
      return;
    }

    this._cancelled =
      true;

    this._reason =
      reason?.trim() ||
      'Processing job cancelled.';
  }

  public throwIfCancelled():
    void {
    if (
      !this._cancelled
    ) {
      return;
    }

    throw createQueueError(
      'JOB_CANCELLED',
      this._reason ||
        'Processing job cancelled.',
      {
        retryable:
          false,

        source:
          'queue',

        stage:
          'cancelled',
      }
    );
  }
}

export function createProcessingQueueCancellationController():
  ProcessingQueueCancellationController {
  const signal =
    new DefaultQueueCancellationSignal();

  return {
    signal,

    cancel(
      reason?:
        string
    ): void {
      signal.cancel(
        reason
      );
    },
  };
}

/* =========================================================
 * Internal helpers
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function sleep(
  durationMs:
    number
): Promise<void> {
  const safeDuration =
    Math.max(
      0,
      Math.floor(
        durationMs
      )
    );

  if (
    safeDuration ===
    0
  ) {
    return Promise.resolve();
  }

  return new Promise(
    resolve => {
      setTimeout(
        resolve,
        safeDuration
      );
    }
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

function cloneQueueError(
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

function cloneProcessingJob(
  job:
    ProcessingJob
): ProcessingJob {
  return {
    ...job,

    source: {
      ...job.source,

      metadata: {
        ...job.source.metadata,
      },
    },

    wardrobe: {
      ...job.wardrobe,

      metadata: {
        ...job.wardrobe.metadata,
      },
    },

    output:
      job.output
        ? {
            ...job.output,

            metadata: {
              ...job.output.metadata,
            },
          }
        : null,

    progress: {
      ...job.progress,

      segmentationProgress:
        job.progress
          .segmentationProgress
          ? {
              ...job.progress
                .segmentationProgress,

              metadata:
                job.progress
                  .segmentationProgress
                  .metadata
                  ? {
                      ...job
                        .progress
                        .segmentationProgress
                        .metadata,
                    }
                  : undefined,
            }
          : null,
    },

    timing: {
      ...job.timing,
    },

    retry: {
      ...job.retry,
    },

    retryPolicy: {
      ...job.retryPolicy,

      retryableErrorCodes:
        [
          ...job
            .retryPolicy
            .retryableErrorCodes,
        ],
    },

    background: {
      ...job.background,
    },

    error:
      cloneQueueError(
        job.error
      ),

    metadata: {
      ...job.metadata,
    },
  };
}

function cloneQueueSnapshot(
  snapshot:
    ProcessingQueueSnapshot
): ProcessingQueueSnapshot {
  return {
    ...snapshot,

    jobs:
      snapshot.jobs.map(
        cloneProcessingJob
      ),

    config:
      cloneProcessingQueueConfig(
        snapshot.config
      ),

    statistics: {
      ...snapshot.statistics,
    },

    timing: {
      ...snapshot.timing,
    },

    lastError:
      cloneQueueError(
        snapshot.lastError
      ),
  };
}

function createQueueError(
  code:
    ProcessingJobError['code'],
  message:
    string,
  options?: {
    source?:
      ProcessingJobError['source'];

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
      ProcessingJobError['metadata'];
  }
): ProcessingJobError {
  return {
    code,

    message,

    source:
      options?.source ??
      'queue',

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

    stage:
      options?.stage ??
      null,

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

function resolveExecutionError(
  error:
    unknown,
  job:
    ProcessingJob
): ProcessingJobError {
  if (
    typeof error ===
      'object' &&
    error !==
      null &&
    'code' in error &&
    'message' in error &&
    'source' in error
  ) {
    const possibleError =
      error as Partial<
        ProcessingJobError
      >;

    if (
      typeof possibleError.code ===
        'string' &&
      typeof possibleError.message ===
        'string' &&
      typeof possibleError.source ===
        'string'
    ) {
      return {
        code:
          possibleError.code as
            ProcessingJobError[
              'code'
            ],

        message:
          possibleError.message,

        source:
          possibleError.source as
            ProcessingJobError[
              'source'
            ],

        retryable:
          possibleError.retryable ??
          false,

        occurredAt:
          possibleError.occurredAt ??
          now(),

        attempt:
          possibleError.attempt ??
          job.retry.attempt,

        stage:
          possibleError.stage ??
          job.progress.stage,

        nativeCode:
          possibleError.nativeCode ??
          null,

        segmentationErrorCode:
          possibleError
            .segmentationErrorCode ??
          null,

        metadata: {
          ...(possibleError
            .metadata ??
          {}),
        },
      };
    }
  }

  return createQueueError(
    'UNKNOWN_QUEUE_ERROR',
    getUnknownErrorMessage(
      error
    ),
    {
      source:
        'unknown',

      retryable:
        false,

      attempt:
        job.retry.attempt,

      stage:
        job.progress.stage,

      metadata: {
        jobId:
          job.id,
      },
    }
  );
}

function isJobEligibleForExecution(
  job:
    ProcessingJob,
  timestamp:
    ProcessingTimestamp
): boolean {
  if (
    job.cancellationRequested ||
    job.deletionRequested
  ) {
    return false;
  }

  if (
    job.status ===
      'queued' ||
    job.status ===
      'interrupted'
  ) {
    return true;
  }

  if (
    job.status ===
      'retry-scheduled'
  ) {
    return (
      job.retry.nextRetryAt ===
        null ||
      job.retry.nextRetryAt <=
        timestamp
    );
  }

  return false;
}

function findJobIndex(
  jobs:
    readonly ProcessingJob[],
  jobId:
    ProcessingJobId
): number {
  return jobs.findIndex(
    job =>
      job.id ===
      jobId
  );
}

function updateJobInCollection(
  jobs:
    readonly ProcessingJob[],
  updatedJob:
    ProcessingJob
): ProcessingJob[] {
  const index =
    jobs.findIndex(
      job =>
        job.id ===
        updatedJob.id
    );

  if (
    index < 0
  ) {
    return [
      ...jobs,
    ];
  }

  if (
    jobs[index] ===
    updatedJob
  ) {
    return jobs as ProcessingJob[];
  }

  const nextJobs =
    jobs.slice();

  nextJobs[index] =
    updatedJob;

  return nextJobs;
}

/* =========================================================
 * Processing queue class
 * ======================================================= */

export class ProcessingQueue {
  private readonly applicationConfig:
    ScanItemProcessingConfig;

  private readonly storage:
    ProcessingQueueStorage;

  private readonly eventBus:
    ProcessingQueueEventBus;

  private readonly timeEstimator:
    ProcessingTimeEstimator;

  private readonly applicationStateProvider:
    () =>
      | 'active'
      | 'inactive'
      | 'background'
      | 'unknown';

  private executor:
    ProcessingJobExecutor | null;

  private snapshot:
    ProcessingQueueSnapshot;

  private initialized =
    false;

  private disposed =
    false;

  private loopActive =
    false;

  private processingLoopPromise:
    Promise<void> | null =
      null;

  private activeCancellationController:
    ProcessingQueueCancellationController | null =
      null;

  private operationChain:
    Promise<void> =
      Promise.resolve();

  private operationCount =
    0;

  private diagnostics:
    ProcessingQueueDiagnostics;

    private cachedSnapshot:
  ProcessingQueueSnapshot | null =
    null;

private cachedSnapshotRevision =
  -1;

  constructor(
    options:
      ProcessingQueueOptions =
        {}
  ) {
    this.applicationConfig =
      options.config ??
      getDefaultScanItemProcessingConfig();

    this.storage =
      options.storage ??
      getDefaultProcessingQueueStorage();

    this.eventBus =
      options.eventBus ??
      getDefaultProcessingQueueEventBus();

    this.timeEstimator =
      options.timeEstimator ??
      getDefaultProcessingTimeEstimator();

    this.executor =
      options.executor ??
      null;

    this.applicationStateProvider =
      options.applicationStateProvider ??
      (() => 'unknown');

    const timestamp =
      now();

    this.snapshot = {
      schemaVersion:
        PROCESSING_QUEUE_SCHEMA_VERSION,

      queueId:
        this.applicationConfig
          .queue
          .queueId,

      status:
        'idle',

      jobs:
        [],

      activeJobId:
        null,

      currentBatchId:
        null,

      config:
        cloneProcessingQueueConfig(
          this.applicationConfig
            .queue
        ),

      statistics:
        calculateQueueStatistics(
          [],
          this.applicationConfig
            .queue
            .estimatedItemProcessingMs
        ),

      timing: {
        createdAt:
          timestamp,

        startedAt:
          null,

        lastUpdatedAt:
          timestamp,

        completedAt:
          null,

        totalActiveMs:
          0,

        estimatedRemainingMs:
          null,
      },

      lastError:
        null,

      revision:
        0,

      restoredFromStorage:
        false,
    };

    this.diagnostics = {
      initialized:
        false,

      disposed:
        false,

      running:
        false,

      loopActive:
        false,

      executorAvailable:
        this.executor !==
        null,

      activeJobId:
        null,

      queuedOperationCount:
        0,

      successfulJobCount:
        0,

      failedJobCount:
        0,

      cancelledJobCount:
        0,

      retryScheduledCount:
        0,

      initializeCount:
        0,

      startCount:
        0,

      pauseCount:
        0,

      resumeCount:
        0,

      stopCount:
        0,

      persistCount:
        0,

      persistFailureCount:
        0,

      lastOperationAt:
        null,

      lastJobStartedAt:
        null,

      lastJobCompletedAt:
        null,

      lastJobFailedAt:
        null,

      lastError:
        null,
    };

    if (
      options.autoInitialize
    ) {
      void this.initialize();
    }
  }

  /* =======================================================
   * Initialization
   * ===================================================== */

  public async initialize():
    Promise<
      ProcessingQueueInitializeResult
    > {
    this.assertNotDisposed();

    if (
      this.initialized
    ) {
      return {
        initialized:
          true,

        restored:
          this.snapshot
            .restoredFromStorage,

        recoveredFromBackup:
          false,

        snapshot:
          this.getSnapshot(),

        warnings:
          [],

        durationMs:
          0,
      };
    }

    const startedAt =
      now();

    try {
      const stored =
        await this.storage.read(
          this.applicationConfig
            .queue
        );

      this.snapshot =
        this.normalizeRestoredSnapshot(
          stored.snapshot
        );

      this.initialized =
        true;

      this.updateDiagnostics({
        initialized:
          true,

        initializeCount:
          this.diagnostics
            .initializeCount +
          1,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      this.emitEvent(
        stored.restored
          ? 'queue-restored'
          : 'queue-initialized',
        null,
        null,
        {
          restored:
            stored.restored,

          recoveredFromBackup:
            stored
              .recoveredFromBackup,
        }
      );

      if (
        this.applicationConfig
          .enableAutomaticResume &&
        this.snapshot
          .config
          .automaticStart &&
        this.hasExecutableJobs() &&
        this.executor
      ) {
        void this.start();
      }

      return {
        initialized:
          true,

        restored:
          stored.restored,

        recoveredFromBackup:
          stored
            .recoveredFromBackup,

        snapshot:
          this.getSnapshot(),

        warnings:
          stored.warnings,

        durationMs:
          normalizeProcessingDuration(
            now() -
            startedAt
          ),
      };
    } catch (error) {
      const queueError =
        resolveExecutionError(
          error,
          this.createSyntheticJobForError()
        );

      this.snapshot = {
        ...this.snapshot,

        status:
          'failed',

        lastError:
          queueError,

        timing: {
          ...this.snapshot.timing,

          lastUpdatedAt:
            now(),
        },

        revision:
          this.snapshot.revision +
          1,
      };

      this.updateDiagnostics({
        lastError:
          queueError,

        lastOperationAt:
          now(),
      });

      throw queueError;
    }
  }

  /* =======================================================
   * Executor
   * ===================================================== */

  public setExecutor(
    executor:
      ProcessingJobExecutor | null
  ): void {
    this.assertNotDisposed();

    this.executor =
      executor;

    this.updateDiagnostics({
      executorAvailable:
        executor !==
        null,
    });

    if (
      executor &&
      this.initialized &&
      this.snapshot
        .config
        .automaticStart &&
      this.hasExecutableJobs()
    ) {
      void this.start();
    }
  }

  public hasExecutor():
    boolean {
    return (
      this.executor !==
      null
    );
  }

  /* =======================================================
   * Queue lifecycle
   * ===================================================== */

  public async start():
    Promise<
      ProcessingQueueSnapshot
    > {
    await this.ensureInitialized();

    if (
      this.snapshot.status ===
        'disposed'
    ) {
      throw createQueueError(
        'QUEUE_DISPOSED',
        'Processing queue has already been disposed.'
      );
    }

    if (
      this.snapshot.status ===
        'running' &&
      (
        this.loopActive ||
        this.processingLoopPromise
      )
    ) {
      return this.getSnapshot();
    }

    if (
      !this.executor
    ) {
      throw createQueueError(
        'QUEUE_NOT_INITIALIZED',
        'Processing queue cannot start because no executor has been registered.',
        {
          retryable:
            true,
        }
      );
    }

    const timestamp =
      now();

    this.snapshot = {
      ...this.snapshot,

      status:
        'running',

      timing: {
        ...this.snapshot.timing,

        startedAt:
          this.snapshot
            .timing
            .startedAt ??
          timestamp,

        lastUpdatedAt:
          timestamp,

        completedAt:
          null,
      },

      revision:
        this.snapshot.revision +
        1,
    };

    this.recalculateSnapshot();

    await this.persistSnapshot();

    this.updateDiagnostics({
      running:
        true,

      startCount:
        this.diagnostics
          .startCount +
        1,

      lastOperationAt:
        timestamp,
    });

    this.emitEvent(
      'queue-started'
    );

    this.ensureProcessingLoop();

    return this.getSnapshot();
  }

  public async pause():
    Promise<
      ProcessingQueueSnapshot
    > {
    await this.ensureInitialized();

    if (
      this.snapshot.status ===
        'paused'
    ) {
      return this.getSnapshot();
    }

    const timestamp =
      now();

    this.snapshot = {
      ...this.snapshot,

      status:
        'paused',

      timing: {
        ...this.snapshot.timing,

        lastUpdatedAt:
          timestamp,
      },

      revision:
        this.snapshot.revision +
        1,
    };

    this.loopActive =
      false;

    this.activeCancellationController
      ?.cancel(
        'Queue paused.'
      );

    await this.persistSnapshot();

    this.updateDiagnostics({
      running:
        false,

      pauseCount:
        this.diagnostics
          .pauseCount +
        1,

      lastOperationAt:
        timestamp,
    });

    this.emitEvent(
      'queue-paused'
    );

    return this.getSnapshot();
  }

  public async resume():
    Promise<
      ProcessingQueueSnapshot
    > {
    await this.ensureInitialized();

    this.updateDiagnostics({
      resumeCount:
        this.diagnostics
          .resumeCount +
        1,

      lastOperationAt:
        now(),
    });

    this.emitEvent(
      'queue-resumed'
    );

    return this.start();
  }

  public async stop(
    reason =
      'Queue stopped.'
  ): Promise<
    ProcessingQueueSnapshot
  > {
    await this.ensureInitialized();

    const stoppingAt =
      now();

    this.snapshot = {
      ...this.snapshot,

      status:
        'stopping',

      timing: {
        ...this.snapshot.timing,

        lastUpdatedAt:
          stoppingAt,
      },

      revision:
        this.snapshot.revision +
        1,
    };

    this.loopActive =
      false;

    this.activeCancellationController
      ?.cancel(
        reason
      );

    if (
      this.processingLoopPromise
    ) {
      try {
        await this
          .processingLoopPromise;
      } catch {
        // الخطأ تم تسجيله داخل الحلقة.
      }
    }

    const stoppedAt =
      now();

    this.snapshot = {
      ...this.snapshot,

      status:
        'stopped',

      activeJobId:
        null,

      timing: {
        ...this.snapshot.timing,

        lastUpdatedAt:
          stoppedAt,
      },

      revision:
        this.snapshot.revision +
        1,
    };

    this.recalculateSnapshot();

    await this.persistSnapshot();

    this.updateDiagnostics({
      running:
        false,

      loopActive:
        false,

      activeJobId:
        null,

      stopCount:
        this.diagnostics
          .stopCount +
        1,

      lastOperationAt:
        stoppedAt,
    });

    this.emitEvent(
      'queue-stopped',
      null,
      null,
      {
        reason,
      }
    );

    return this.getSnapshot();
  }

  /* =======================================================
   * Enqueue
   * ===================================================== */

  public async enqueue(
    request:
      EnqueueProcessingJobsRequest
  ): Promise<
    EnqueueProcessingJobsResult
  > {
    await this.ensureInitialized();

    const result =
      await this.runExclusive(
        async () => {
          const accepted:
            ProcessingJob[] =
            [];

        const rejected:
  Array<
    EnqueueProcessingJobsResult[
      'rejected'
    ][number]
  > =
  [];

          const currentCount =
            this.snapshot.jobs.filter(
              job =>
                !job.deletionRequested
            ).length;

          let remainingCapacity =
            Math.max(
              0,
              this.snapshot
                .config
                .maximumItems -
              currentCount
            );

          const existingJobKeys =
            new Set(
              this.snapshot.jobs.map(
                job =>
                  [
                    job.source.uri,
                    job.wardrobeItemId,
                  ].join(
                    '::'
                  )
              )
            );

          const newJobs:
            ProcessingJob[] =
            [];

          for (
            const jobRequest of request.jobs
          ) {
            if (
              remainingCapacity <=
              0
            ) {
              rejected.push({
                request:
                  jobRequest,

                error:
                  createQueueError(
                    'QUEUE_CAPACITY_EXCEEDED',
                    `The processing queue supports a maximum of ${this.snapshot.config.maximumItems} items.`,
                    {
                      retryable:
                        false,
                    }
                  ),
              });

              continue;
            }

            const duplicateKey =
              [
                jobRequest
                  .source
                  .uri,
                jobRequest
                  .wardrobeItemId,
              ].join(
                '::'
              );

            if (
              existingJobKeys.has(
                duplicateKey
              )
            ) {
              rejected.push({
                request:
                  jobRequest,

                error:
                  createQueueError(
                    'JOB_ALREADY_EXISTS',
                    'This image is already present in the processing queue.',
                    {
                      retryable:
                        false,

                      metadata: {
                        sourceUri:
                          jobRequest
                            .source
                            .uri,

                        wardrobeItemId:
                          jobRequest
                            .wardrobeItemId,
                      },
                    }
                  ),
              });

              continue;
            }

            const job =
              createProcessingJob(
                jobRequest,
                this.snapshot.config
              );

            newJobs.push(
              job
            );

            accepted.push(
              cloneProcessingJob(
                job
              )
            );

            existingJobKeys.add(
              duplicateKey
            );

            remainingCapacity -=
              1;
          }

          if (
            newJobs.length >
            0
          ) {
            const combined =
              reindexProcessingJobs([
                ...this.snapshot.jobs,
                ...newJobs,
              ]);

            const resolvedBatchId =
              newJobs[
                newJobs.length -
                1
              ].batchId;

            this.snapshot = {
              ...this.snapshot,

              jobs:
                combined,

              currentBatchId:
                resolvedBatchId,

              status:
                this.snapshot
                  .status ===
                  'completed' ||
                this.snapshot
                  .status ===
                  'failed'
                  ? 'idle'
                  : this.snapshot
                      .status,

              lastError:
                null,

              timing: {
                ...this.snapshot.timing,

                completedAt:
                  null,

                lastUpdatedAt:
                  now(),
              },

              revision:
                this.snapshot.revision +
                1,
            };

            this.recalculateSnapshot();

            await this.persistSnapshot();

            for (
              const job of newJobs
            ) {
              this.emitEvent(
                'job-added',
                job
              );
            }

            this.emitEvent(
              'queue-updated'
            );
          }

          return {
            accepted,

            rejected,

            snapshot:
              this.getSnapshot(),
          };
        }
      );

    const shouldStart =
      request.startImmediately ??
      this.snapshot
        .config
        .automaticStart;

    if (
      shouldStart &&
      result.accepted.length >
        0 &&
      this.executor
    ) {
      void this.start();
    }

    return result;
  }

  public async enqueueOne(
    request:
      CreateProcessingJobRequest,
    startImmediately =
      true
  ): Promise<
    EnqueueProcessingJobsResult
  > {
    return this.enqueue({
      jobs: [
        request,
      ],

      startImmediately,
    });
  }

  /* =======================================================
   * Progress
   * ===================================================== */

  public async updateJobProgress(
    request:
      UpdateProcessingJobProgressRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    return this.runExclusive(
      async () => {
        const index =
          findJobIndex(
            this.snapshot.jobs,
            request.jobId
          );

        if (
          index <
          0
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              null,
          };
        }

        const existing =
          this.snapshot.jobs[
            index
          ];

        if (
          isProcessingJobTerminal(
            existing.status
          )
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              cloneProcessingJob(
                existing
              ),
          };
        }

        const progress =
          clampProcessingProgress(
            Math.max(
              existing.progress
                .progress,
              request.progress
            )
          );

        const timestamp =
          now();

        const startedAt =
          existing.timing
            .startedAt ??
          timestamp;

        const updatedProgress:
          ProcessingJobProgress = {
          progress,

          percentage:
            processingProgressToPercentage(
              progress
            ),

          stage:
            request.stage,

          message:
            request.message,

          updatedAt:
            timestamp,

          elapsedMs:
            normalizeProcessingDuration(
              timestamp -
              startedAt
            ),

          estimatedRemainingMs:
            request
              .estimatedRemainingMs ??
            existing.progress
              .estimatedRemainingMs,

          segmentationProgress:
            request
              .segmentationProgress ??
            existing.progress
              .segmentationProgress,
        };

        const nextStatus =
          this.resolveStatusFromStage(
            existing.status,
            request.stage,
            progress
          );

        const updatedJob:
          ProcessingJob = {
          ...existing,

          status:
            nextStatus,

          progress:
            updatedProgress,

          timing: {
            ...existing.timing,

            lastUpdatedAt:
              timestamp,
          },

          background: {
            ...existing.background,

            lastHeartbeatAt:
              timestamp,
          },
        };

        this.snapshot = {
          ...this.snapshot,

          jobs:
            updateJobInCollection(
              this.snapshot.jobs,
              updatedJob
            ),

          timing: {
            ...this.snapshot.timing,

            lastUpdatedAt:
              timestamp,
          },

          revision:
            this.snapshot.revision +
            1,
        };

        this.recalculateSnapshot();

        if (
          this.snapshot
            .config
            .persistAfterEveryChange
        ) {
          await this.persistSnapshot();
        }

        this.emitEvent(
          'job-progress',
          updatedJob
        );

        return {
          changed:
            true,

          snapshot:
            this.getSnapshot(),

          job:
            cloneProcessingJob(
              updatedJob
            ),
        };
      }
    );
  }

  /* =======================================================
   * Completion
   * ===================================================== */

  public async completeJob(
    request:
      CompleteProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    return this.runExclusive(
      async () => {
        const index =
          findJobIndex(
            this.snapshot.jobs,
            request.jobId
          );

        if (
          index <
          0
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              null,
          };
        }

        const existing =
          this.snapshot.jobs[
            index
          ];

        if (
          existing.status ===
          'completed'
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              cloneProcessingJob(
                existing
              ),
          };
        }

        const timestamp =
          now();

        const startedAt =
          existing.timing
            .startedAt ??
          timestamp;

        const totalProcessingMs =
          normalizeProcessingDuration(
            timestamp -
            startedAt
          );

        const updatedJob:
          ProcessingJob = {
          ...existing,

          status:
            'completed',

          output: {
            ...request.output,

            completedAt:
              request.output
                .completedAt ||
              timestamp,

            metadata: {
              ...request.output
                .metadata,
            },
          },

          progress: {
            progress:
              COMPLETE_QUEUE_ITEM_PROGRESS,

            percentage:
              100,

            stage:
              'complete',

            message:
              'Processing completed.',

            updatedAt:
              timestamp,

            elapsedMs:
              totalProcessingMs,

            estimatedRemainingMs:
              0,

            segmentationProgress:
              existing.progress
                .segmentationProgress,
          },

          timing: {
            ...existing.timing,

            lastUpdatedAt:
              timestamp,

            completedAt:
              timestamp,

            failedAt:
              null,

            cancelledAt:
              null,

            totalProcessingMs:

              totalProcessingMs,

            lastAttemptDurationMs:
              totalProcessingMs,
          },

          retry: {
            ...existing.retry,

            nextRetryAt:
              null,

            retryScheduled:
              false,

            exhausted:
              false,
          },

          background: {
            ...existing.background,

            isRunning:
              false,

            lastHeartbeatAt:
              timestamp,
          },

          error:
            null,

          cancellationRequested:
            false,
        };

        this.snapshot = {
          ...this.snapshot,

          jobs:
            updateJobInCollection(
              this.snapshot.jobs,
              updatedJob
            ),

          activeJobId:
            this.snapshot
              .activeJobId ===
              existing.id
              ? null
              : this.snapshot
                  .activeJobId,

          timing: {
            ...this.snapshot.timing,

            lastUpdatedAt:
              timestamp,
          },

          revision:
            this.snapshot.revision +
            1,
        };

        this.timeEstimator
          .addCompletedJob(
            updatedJob
          );

        this.recalculateSnapshot();

        await this.persistSnapshot();

        this.updateDiagnostics({
          successfulJobCount:
            this.diagnostics
              .successfulJobCount +
            1,

          activeJobId:
            this.snapshot
              .activeJobId,

          lastJobCompletedAt:
            timestamp,

          lastOperationAt:
            timestamp,
        });

        this.emitEvent(
          'job-completed',
          updatedJob
        );

        this.evaluateQueueCompletion();

        return {
          changed:
            true,

          snapshot:
            this.getSnapshot(),

          job:
            cloneProcessingJob(
              updatedJob
            ),
        };
      }
    );
  }

  /* =========================================================
   * Part 2 continues directly with:
   *
   * Failure
   * ======================================================= */
  /* =======================================================
   * Failure
   * ===================================================== */

  public async failJob(
    request:
      FailProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    return this.runExclusive(
      async () => {
        const index =
          findJobIndex(
            this.snapshot.jobs,
            request.jobId
          );

        if (
          index <
          0
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              null,
          };
        }

        const existing =
          this.snapshot.jobs[
            index
          ];

        if (
          existing.status ===
            'completed' ||
          existing.status ===
            'cancelled'
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              cloneProcessingJob(
                existing
              ),
          };
        }

        const timestamp =
          now();

        const startedAt =
          existing.timing
            .startedAt ??
          timestamp;

        const lastAttemptDurationMs =
          normalizeProcessingDuration(
            timestamp -
            startedAt
          );

        const currentAttempt =
          Math.max(
            1,
            existing.retry
              .attempt,
            request.error
              .attempt
          );

        const retryableByPolicy =
          request.error
            .segmentationErrorCode ===
            null ||
          existing.retryPolicy
            .retryableErrorCodes
            .includes(
              request.error
                .segmentationErrorCode
            );

        const mayRetry =
          this.applicationConfig
            .enableAutomaticRetry &&
          request.error.retryable &&
          retryableByPolicy &&
          currentAttempt <
            existing.retry
              .maximumAttempts &&
          !existing
            .cancellationRequested &&
          !existing
            .deletionRequested;

        let updatedJob:
          ProcessingJob;

        if (
          mayRetry
        ) {
          const retryDelayMs =
            calculateProcessingRetryDelayMs(
              currentAttempt,
              existing.retryPolicy
            );

          const nextRetryAt =
            timestamp +
            retryDelayMs;

          updatedJob = {
            ...existing,

            status:
              'retry-scheduled',

            progress: {
              ...existing.progress,

              stage:
                'queued',

              message:
                'Waiting to retry processing.',

              updatedAt:
                timestamp,

              elapsedMs:
                lastAttemptDurationMs,

              estimatedRemainingMs:
                retryDelayMs +
                existing.timing
                  .estimatedProcessingMs,
            },

            timing: {
              ...existing.timing,

              lastUpdatedAt:
                timestamp,

              lastAttemptDurationMs,
            },

            retry: {
              ...existing.retry,

              attempt:
                currentAttempt,

              nextRetryAt,

              previousRetryAt:
                timestamp,

              retryScheduled:
                true,

              exhausted:
                false,
            },

            background: {
              ...existing.background,

              isRunning:
                false,

              lastHeartbeatAt:
                timestamp,
            },

            error: {
              ...request.error,

              attempt:
                currentAttempt,

              metadata: {
                ...request.error
                  .metadata,

                nextRetryAt,

                retryDelayMs,
              },
            },
          };

          this.updateDiagnostics({
            retryScheduledCount:
              this.diagnostics
                .retryScheduledCount +
              1,
          });
        } else {
          updatedJob = {
            ...existing,

            status:
              'failed',

            progress: {
              ...existing.progress,

              stage:
                'failed',

              message:
                request.error
                  .message,

              updatedAt:
                timestamp,

              elapsedMs:
                lastAttemptDurationMs,

              estimatedRemainingMs:
                0,
            },

            timing: {
              ...existing.timing,

              lastUpdatedAt:
                timestamp,

              failedAt:
                timestamp,

              lastAttemptDurationMs,
            },

            retry: {
              ...existing.retry,

              attempt:
                currentAttempt,

              nextRetryAt:
                null,

              retryScheduled:
                false,

              exhausted:
                true,
            },

            background: {
              ...existing.background,

              isRunning:
                false,

              lastHeartbeatAt:
                timestamp,
            },

            error: {
              ...request.error,

              attempt:
                currentAttempt,

              metadata: {
                ...request.error
                  .metadata,
              },
            },
          };

          this.updateDiagnostics({
            failedJobCount:
              this.diagnostics
                .failedJobCount +
              1,

            lastJobFailedAt:
              timestamp,
          });
        }

        this.snapshot = {
          ...this.snapshot,

          jobs:
            updateJobInCollection(
              this.snapshot.jobs,
              updatedJob
            ),

          activeJobId:
            this.snapshot
              .activeJobId ===
              existing.id
              ? null
              : this.snapshot
                  .activeJobId,

          lastError:
            updatedJob.error,

          timing: {
            ...this.snapshot.timing,

            lastUpdatedAt:
              timestamp,
          },

          revision:
            this.snapshot.revision +
            1,
        };

        this.recalculateSnapshot();

        await this.persistSnapshot();

        this.emitEvent(
          mayRetry
            ? 'job-retry-scheduled'
            : 'job-failed',
          updatedJob,
          updatedJob.error
        );

        if (
          !mayRetry &&
          !this.snapshot
            .config
            .continueAfterJobFailure
        ) {
          this.snapshot = {
            ...this.snapshot,

            status:
              'paused',

            timing: {
              ...this.snapshot.timing,

              lastUpdatedAt:
                now(),
            },

            revision:
              this.snapshot.revision +
              1,
          };

          this.loopActive =
            false;

          this.updateDiagnostics({
            running:
              false,

            pauseCount:
              this.diagnostics
                .pauseCount +
              1,
          });

          await this.persistSnapshot();

          this.emitEvent(
            'queue-paused',
            updatedJob,
            updatedJob.error
          );
        }

        this.evaluateQueueCompletion();

        return {
          changed:
            true,

          snapshot:
            this.getSnapshot(),

          job:
            cloneProcessingJob(
              updatedJob
            ),
        };
      }
    );
  }

  /* =======================================================
   * Retry
   * ===================================================== */

  public async retryJob(
    request:
      RetryProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    const result =
      await this.runExclusive(
        async () => {
          const index =
            findJobIndex(
              this.snapshot.jobs,
              request.jobId
            );

          if (
            index <
            0
          ) {
            return {
              changed:
                false,

              snapshot:
                this.getSnapshot(),

              job:
                null,
            };
          }

          const existing =
            this.snapshot.jobs[
              index
            ];

          const retryableStatus =
            existing.status ===
              'failed' ||
            existing.status ===
              'interrupted' ||
            existing.status ===
              'retry-scheduled';

          if (
            !retryableStatus
          ) {
            return {
              changed:
                false,

              snapshot:
                this.getSnapshot(),

              job:
                cloneProcessingJob(
                  existing
                ),
            };
          }

          if (
            existing.status ===
              'failed' &&
            !canRetryProcessingJob(
              existing
            ) &&
            !request
              .resetAttemptCount
          ) {
            return {
              changed:
                false,

              snapshot:
                this.getSnapshot(),

              job:
                cloneProcessingJob(
                  existing
                ),
            };
          }

          const timestamp =
            now();

          const updatedJob:
            ProcessingJob = {
            ...existing,

            status:
              'queued',

            output:
              null,

            progress: {
              progress:
                0,

              percentage:
                0,

              stage:
                'queued',

              message:
                'Waiting to be processed.',

              updatedAt:
                timestamp,

              elapsedMs:
                0,

              estimatedRemainingMs:
                existing.timing
                  .estimatedProcessingMs,

              segmentationProgress:
                null,
            },

            timing: {
              ...existing.timing,

              startedAt:
                null,

              lastUpdatedAt:
                timestamp,

              pausedAt:
                null,

              interruptedAt:
                null,

              completedAt:
                null,

              failedAt:
                null,

              cancelledAt:
                null,

              lastAttemptDurationMs:
                0,
            },

            retry: {
              ...existing.retry,

              attempt:
                request
                  .resetAttemptCount
                  ? 0
                  : existing.retry
                      .attempt,

              nextRetryAt:
                null,

              previousRetryAt:
                null,

              retryScheduled:
                false,

              exhausted:
                false,
            },

            background: {
              ...existing.background,

              isRunning:
                false,

              wasInterrupted:
                false,

              interruptionReason:
                null,

              nativeTaskId:
                null,

              nativeJobId:
                null,
            },

            error:
              null,

            cancellationRequested:
              false,

            deletionRequested:
              false,
          };

          this.snapshot = {
            ...this.snapshot,

            jobs:
              updateJobInCollection(
                this.snapshot.jobs,
                updatedJob
              ),

            status:
              this.snapshot
                .status ===
                'completed' ||
              this.snapshot
                .status ===
                'failed'
                ? 'idle'
                : this.snapshot
                    .status,

            lastError:
              null,

            timing: {
              ...this.snapshot.timing,

              completedAt:
                null,

              lastUpdatedAt:
                timestamp,
            },

            revision:
              this.snapshot.revision +
              1,
          };

          this.recalculateSnapshot();

          await this.persistSnapshot();

          this.emitEvent(
            'job-added',
            updatedJob,
            null,
            {
              retry:
                true,
            }
          );

          return {
            changed:
              true,

            snapshot:
              this.getSnapshot(),

            job:
              cloneProcessingJob(
                updatedJob
              ),
          };
        }
      );

    if (
      result.changed &&
      (
        request.startImmediately ??
        true
      ) &&
      this.executor
    ) {
      void this.start();
    }

    return result;
  }

  /* =======================================================
   * Cancellation
   * ===================================================== */

  public async cancelJob(
    request:
      CancelProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    return this.runExclusive(
      async () => {
        const index =
          findJobIndex(
            this.snapshot.jobs,
            request.jobId
          );

        if (
          index <
          0
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              null,
          };
        }

        const existing =
          this.snapshot.jobs[
            index
          ];

        if (
          !canCancelProcessingJob(
            existing
          )
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              cloneProcessingJob(
                existing
              ),
          };
        }

        const timestamp =
          now();

        if (
          this.snapshot
            .activeJobId ===
          existing.id
        ) {
          this.activeCancellationController
            ?.cancel(
              request.reason ??
              'Processing cancelled by the user.'
            );
        }

        const cancellationError =
          createQueueError(
            'JOB_CANCELLED',
            request.reason ??
              'Processing cancelled.',
            {
              retryable:
                false,

              stage:
                'cancelled',

              attempt:
                existing.retry
                  .attempt,
            }
          );

        const updatedJob:
          ProcessingJob = {
          ...existing,

          status:
            'cancelled',

          progress: {
            ...existing.progress,

            stage:
              'cancelled',

            message:
              request.reason ??
              'Processing cancelled.',

            updatedAt:
              timestamp,

            estimatedRemainingMs:
              0,
          },

          timing: {
            ...existing.timing,

            lastUpdatedAt:
              timestamp,

            cancelledAt:
              timestamp,
          },

          background: {
            ...existing.background,

            isRunning:
              false,

            lastHeartbeatAt:
              timestamp,

            interruptionReason:
              request.reason ??
              'Processing cancelled.',
          },

          cancellationRequested:
            true,

          deletionRequested:
            request
              .deleteWardrobePlaceholder ??
            false,

          retry: {
            ...existing.retry,

            nextRetryAt:
              null,

            retryScheduled:
              false,
          },

          error:
            cancellationError,
        };

        this.snapshot = {
          ...this.snapshot,

          jobs:
            updateJobInCollection(
              this.snapshot.jobs,
              updatedJob
            ),

          activeJobId:
            this.snapshot
              .activeJobId ===
              existing.id
              ? null
              : this.snapshot
                  .activeJobId,

          timing: {
            ...this.snapshot.timing,

            lastUpdatedAt:
              timestamp,
          },

          revision:
            this.snapshot.revision +
            1,
        };

        this.recalculateSnapshot();

        await this.persistSnapshot();

        this.updateDiagnostics({
          cancelledJobCount:
            this.diagnostics
              .cancelledJobCount +
            1,

          activeJobId:
            this.snapshot
              .activeJobId,

          lastOperationAt:
            timestamp,
        });

        this.emitEvent(
          'job-cancelled',
          updatedJob,
          cancellationError
        );

        this.evaluateQueueCompletion();

        return {
          changed:
            true,

          snapshot:
            this.getSnapshot(),

          job:
            cloneProcessingJob(
              updatedJob
            ),
        };
      }
    );
  }

  /* =======================================================
   * Remove
   * ===================================================== */

  public async removeJob(
    request:
      RemoveProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    return this.runExclusive(
      async () => {
        const index =
          findJobIndex(
            this.snapshot.jobs,
            request.jobId
          );

        if (
          index <
          0
        ) {
          return {
            changed:
              false,

            snapshot:
              this.getSnapshot(),

            job:
              null,
          };
        }

        const existing =
          this.snapshot.jobs[
            index
          ];

        if (
          isProcessingJobActive(
            existing.status
          )
        ) {
          this.activeCancellationController
            ?.cancel(
              'Processing job removed.'
            );
        }

        const remaining =
          this.snapshot.jobs.filter(
            job =>
              job.id !==
              existing.id
          );

        const timestamp =
          now();

        this.snapshot = {
          ...this.snapshot,

          jobs:
            reindexProcessingJobs(
              remaining
            ),

          activeJobId:
            this.snapshot
              .activeJobId ===
              existing.id
              ? null
              : this.snapshot
                  .activeJobId,

          timing: {
            ...this.snapshot.timing,

            lastUpdatedAt:
              timestamp,
          },

          revision:
            this.snapshot.revision +
            1,
        };

        this.recalculateSnapshot();

        await this.persistSnapshot();

        this.emitEvent(
          'job-removed',
          existing,
          null,
          {
            deleteSourceFile:
              request
                .deleteSourceFile ??
              false,

            deleteProcessedFile:
              request
                .deleteProcessedFile ??
              false,
          }
        );

        this.evaluateQueueCompletion();

        return {
          changed:
            true,

          snapshot:
            this.getSnapshot(),

          job:
            cloneProcessingJob(
              existing
            ),
        };
      }
    );
  }

  /* =======================================================
   * Queries
   * ===================================================== */

 public getSnapshot():
  ProcessingQueueSnapshot {
  this.assertNotDisposed();

  if (
    this.cachedSnapshot &&
    this.cachedSnapshotRevision ===
      this.snapshot.revision
  ) {
    return this.cachedSnapshot;
  }

  const snapshot =
    cloneQueueSnapshot(
      this.snapshot
    );

  this.cachedSnapshot =
    snapshot;

  this.cachedSnapshotRevision =
    this.snapshot.revision;

  return snapshot;
}

  public getStatistics():
    ProcessingQueueStatistics {
    this.assertNotDisposed();

    return {
      ...this.snapshot
        .statistics,
    };
  }

  public getStatus():
    ProcessingQueueStatus {
    this.assertNotDisposed();

    return this.snapshot
      .status;
  }

  public getJob(
    jobId:
      ProcessingJobId
  ): ProcessingJob | null {
    this.assertNotDisposed();

    const job =
      this.snapshot.jobs.find(
        candidate =>
          candidate.id ===
          jobId
      );

    return job
      ? cloneProcessingJob(
          job
        )
      : null;
  }

  public getJobs():
    readonly ProcessingJob[] {
    this.assertNotDisposed();

    return this.snapshot.jobs.map(
      cloneProcessingJob
    );
  }

  public getPendingJobs():
    readonly ProcessingJob[] {
    this.assertNotDisposed();

    return this.snapshot.jobs
      .filter(
        job =>
          isProcessingJobPending(
            job.status
          )
      )
      .map(
        cloneProcessingJob
      );
  }

  public getActiveJob():
    ProcessingJob | null {
    this.assertNotDisposed();

    const activeJobId =
      this.snapshot
        .activeJobId;

    if (
      !activeJobId
    ) {
      return null;
    }

    return this.getJob(
      activeJobId
    );
  }

  public getQueueTimeEstimate():
    ProcessingQueueTimeEstimate {
    this.assertNotDisposed();

    return this.timeEstimator
      .estimateQueue(
        this.snapshot
      );
  }

  public hasPendingJobs():
    boolean {
    this.assertNotDisposed();

    return this.snapshot.jobs.some(
      job =>
        isProcessingJobPending(
          job.status
        )
    );
  }

  public isRunning():
    boolean {
    this.assertNotDisposed();

    return (
      this.snapshot.status ===
        'running' &&
      (
        this.loopActive ||
        this.processingLoopPromise !==
          null
      )
    );
  }

  public getDiagnostics():
    ProcessingQueueDiagnostics {
    return {
      ...this.diagnostics,

      lastError:
        cloneQueueError(
          this.diagnostics
            .lastError
        ),
    };
  }

  /* =======================================================
   * Persistence
   * ===================================================== */

  public async flushStorage():
    Promise<void> {
    await this.ensureInitialized();

    await this.storage.flush();
  }

  public async clearStorage():
    Promise<void> {
    await this.ensureInitialized();

    await this.storage.clear();
  }

  /* =======================================================
   * Dispose
   * ===================================================== */

  public async dispose():
    Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    this.loopActive =
      false;

    this.activeCancellationController
      ?.cancel(
        'Processing queue disposed.'
      );

    if (
      this.processingLoopPromise
    ) {
      try {
        await this
          .processingLoopPromise;
      } catch {
        // لا نرمي أثناء dispose.
      }
    }

    try {
      await this.persistSnapshot();
      await this.storage.flush();
    } catch {
      // لا نرمي أثناء dispose.
    }

    this.snapshot = {
      ...this.snapshot,

      status:
        'disposed',

      activeJobId:
        null,

      timing: {
        ...this.snapshot.timing,

        lastUpdatedAt:
          now(),
      },

      revision:
        this.snapshot.revision +
        1,
    };

    this.initialized =
      false;

    this.disposed =
      true;

    this.executor =
      null;

    this.processingLoopPromise =
      null;

    this.activeCancellationController =
      null;

    this.updateDiagnostics({
      initialized:
        false,

      disposed:
        true,

      running:
        false,

      loopActive:
        false,

      executorAvailable:
        false,

      activeJobId:
        null,
    });
  }

  /* =======================================================
   * Processing loop
   * ===================================================== */

  private ensureProcessingLoop():
    void {
    if (
      this.loopActive ||
      this.processingLoopPromise
    ) {
      return;
    }

    this.loopActive =
      true;

    this.updateDiagnostics({
      loopActive:
        true,

      running:
        true,
    });

    this.processingLoopPromise =
      this.runProcessingLoop()
        .catch(
          error => {
            const queueError =
              resolveExecutionError(
                error,
                this.createSyntheticJobForError()
              );

            this.snapshot = {
              ...this.snapshot,

              status:
                'failed',

              lastError:
                queueError,

              activeJobId:
                null,

              timing: {
                ...this.snapshot.timing,

                lastUpdatedAt:
                  now(),
              },

              revision:
                this.snapshot
                  .revision +
                1,
            };

            this.recalculateSnapshot();

            this.updateDiagnostics({
              running:
                false,

              loopActive:
                false,

              activeJobId:
                null,

              lastError:
                queueError,
            });

            this.emitEvent(
              'queue-failed',
              null,
              queueError
            );

            void this.persistSnapshot();
          }
        )
        .finally(
          () => {
            this.loopActive =
              false;

            this.processingLoopPromise =
              null;

            this.activeCancellationController =
              null;

            this.updateDiagnostics({
              loopActive:
                false,

              running:
                this.snapshot
                  .status ===
                  'running',

              activeJobId:
                this.snapshot
                  .activeJobId,
            });
          }
        );
  }

  private async runProcessingLoop():
    Promise<void> {
    while (
      this.loopActive &&
      this.snapshot.status ===
        'running' &&
      !this.disposed
    ) {
      const nextJob =
        this.findNextExecutableJob();

      if (
        !nextJob
      ) {
        const nextRetryAt =
          this.findNextRetryTimestamp();

        if (
          nextRetryAt !==
            null
        ) {
          const waitMs =
            Math.max(
              0,
              nextRetryAt -
              now()
            );

          if (
            waitMs >
            0
          ) {
            await sleep(
              Math.min(
                waitMs,
                1_000
              )
            );

            continue;
          }
        }

        this.evaluateQueueCompletion();

        if (
          this.snapshot.status ===
            'running'
        ) {
          this.snapshot = {
            ...this.snapshot,

            status:
              'idle',

            activeJobId:
              null,

            timing: {
              ...this.snapshot.timing,

              lastUpdatedAt:
                now(),
            },

            revision:
              this.snapshot.revision +
              1,
          };

          this.recalculateSnapshot();

          await this.persistSnapshot();

          this.emitEvent(
            'queue-updated'
          );
        }

        break;
      }

      await this.executeJob(
        nextJob
      );
    }
  }

  private async executeJob(
    sourceJob:
      ProcessingJob
  ): Promise<void> {
    const executor =
      this.executor;

    if (
      !executor
    ) {
      throw createQueueError(
        'QUEUE_NOT_INITIALIZED',
        'No processing executor has been registered.',
        {
          retryable:
            true,
        }
      );
    }

    const timestamp =
      now();

    const attempt =
      sourceJob.retry
        .attempt +
      1;

    const cancellationController =
      createProcessingQueueCancellationController();

    this.activeCancellationController =
      cancellationController;

    const applicationState =
      this.resolveApplicationState();

    const startedJob:
      ProcessingJob = {
      ...sourceJob,

      status:
        'preparing',

      progress: {
        progress:
          Math.max(
            0.01,
            sourceJob.progress
              .progress
          ),

        percentage:
          Math.max(
            1,
            processingProgressToPercentage(
              sourceJob.progress
                .progress
            )
          ),

        stage:
          'prepare-segmentation',

        message:
          'Preparing the item for processing.',

        updatedAt:
          timestamp,

        elapsedMs:
          0,

        estimatedRemainingMs:
          sourceJob.timing
            .estimatedProcessingMs,

        segmentationProgress:
          null,
      },

      timing: {
        ...sourceJob.timing,

        startedAt:
          timestamp,

        lastUpdatedAt:
          timestamp,

        pausedAt:
          null,

        interruptedAt:
          null,

        completedAt:
          null,

        failedAt:
          null,

        cancelledAt:
          null,
      },

      retry: {
        ...sourceJob.retry,

        attempt,

        nextRetryAt:
          null,

        retryScheduled:
          false,
      },

      error:
        null,

      cancellationRequested:
        false,

      background: {
        ...sourceJob.background,

        applicationState,

        executionMode:
          applicationState ===
            'background'
            ? 'background'
            : 'foreground',

        startedAt:
          timestamp,

        lastHeartbeatAt:
          timestamp,

        isRunning:
          true,

        wasInterrupted:
          false,

        interruptionReason:
          null,
      },
    };

    this.snapshot = {
      ...this.snapshot,

      jobs:
        updateJobInCollection(
          this.snapshot.jobs,
          startedJob
        ),

      activeJobId:
        startedJob.id,

      status:
        'running',

      timing: {
        ...this.snapshot.timing,

        startedAt:
          this.snapshot
            .timing
            .startedAt ??
          timestamp,

        lastUpdatedAt:
          timestamp,
      },

      revision:
        this.snapshot.revision +
        1,
    };

    this.recalculateSnapshot();

    await this.persistSnapshot();

    this.updateDiagnostics({
      running:
        true,

      activeJobId:
        startedJob.id,

      lastJobStartedAt:
        timestamp,

      lastOperationAt:
        timestamp,
    });

    this.emitEvent(
      'job-started',
      startedJob
    );

    try {
      const result =
        await executor(
          cloneProcessingJob(
            startedJob
          ),
          {
            queueId:
              startedJob.queueId,

            jobId:
              startedJob.id,

            requestId:
              startedJob.requestId,

            batchId:
              startedJob.batchId,

            attempt,

            startedAt:
              timestamp,

            cancellationSignal:
              cancellationController
                .signal,

            updateProgress:
              async request => {
                cancellationController
                  .signal
                  .throwIfCancelled();

                await this
                  .updateJobProgress({
                    jobId:
                      startedJob.id,

                    ...request,
                  });
              },

            isApplicationInBackground:
              () =>
                this.resolveApplicationState() ===
                'background',
          }
        );

      cancellationController
        .signal
        .throwIfCancelled();

      if (
        result.succeeded &&
        result.output
      ) {
        await this.completeJob({
          jobId:
            startedJob.id,

          output:
            result.output,
        });
      } else {
        const executionError =
          result.error ??
          createQueueError(
            'UNKNOWN_QUEUE_ERROR',
            'The processing executor finished without a valid result.',
            {
              retryable:
                false,

              attempt,

              stage:
                'failed',
            }
          );

        await this.failJob({
          jobId:
            startedJob.id,

          error:
            executionError,
        });
      }
    } catch (error) {
      const latestJob =
        this.getJob(
          startedJob.id
        ) ??
        startedJob;

      if (
        cancellationController
          .signal
          .cancelled
      ) {
        const latestStatus =
          latestJob.status;

        if (
          latestStatus !==
            'cancelled' &&
          !isProcessingJobTerminal(
            latestStatus
          )
        ) {
          await this.cancelJob({
            jobId:
              latestJob.id,

            reason:
              cancellationController
                .signal
                .reason ??
              'Processing cancelled.',
          });
        }

        return;
      }

      const queueError =
        resolveExecutionError(
          error,
          latestJob
        );

      await this.failJob({
        jobId:
          latestJob.id,

        error:
          queueError,
      });
    } finally {
      this.activeCancellationController =
        null;

      const finishedAt =
        now();

      this.snapshot = {
        ...this.snapshot,

        activeJobId:
          this.snapshot
            .activeJobId ===
            startedJob.id
            ? null
            : this.snapshot
                .activeJobId,

        jobs:
          this.snapshot.jobs.map(
            job =>
              job.id ===
                startedJob.id
                ? {
                    ...job,

                    background: {
                      ...job.background,

                      isRunning:
                        false,

                      lastHeartbeatAt:
                        finishedAt,
                    },
                  }
                : job
          ),

        timing: {
          ...this.snapshot.timing,

          lastUpdatedAt:
            finishedAt,
        },

        revision:
          this.snapshot.revision +
          1,
      };

      this.recalculateSnapshot();

      await this.persistSnapshot();

      this.updateDiagnostics({
        activeJobId:
          this.snapshot
            .activeJobId,
      });
    }
  }

  /* =======================================================
   * Selection helpers
   * ===================================================== */

  private findNextExecutableJob():
    ProcessingJob | null {
    const timestamp =
      now();

    const sortedJobs =
      sortProcessingJobs(
        this.snapshot.jobs
      );

    const job =
      sortedJobs.find(
        candidate =>
          isJobEligibleForExecution(
            candidate,
            timestamp
          )
      );

    return job
      ? cloneProcessingJob(
          job
        )
      : null;
  }

  private findNextRetryTimestamp():
    ProcessingTimestamp | null {
    let nextRetryAt:
      ProcessingTimestamp | null =
        null;

    for (
      const job of this
        .snapshot
        .jobs
    ) {
      if (
        job.status !==
          'retry-scheduled' ||
        job.retry.nextRetryAt ===
          null
      ) {
        continue;
      }

      if (
        nextRetryAt ===
          null ||
        job.retry.nextRetryAt <
          nextRetryAt
      ) {
        nextRetryAt =
          job.retry.nextRetryAt;
      }
    }

    return nextRetryAt;
  }

  private hasExecutableJobs():
    boolean {
    const timestamp =
      now();

    return this.snapshot.jobs.some(
      job =>
        isJobEligibleForExecution(
          job,
          timestamp
        )
    );
  }

  /* =======================================================
   * Snapshot helpers
   * ===================================================== */

  private recalculateSnapshot():
    void {
    const jobs =
      reindexProcessingJobs(
        this.snapshot.jobs
      );

    const statistics =
      calculateQueueStatistics(
        jobs,
        this.snapshot
          .config
          .estimatedItemProcessingMs
      );

    const queueEstimate =
      this.timeEstimator
        .estimateQueue({
          ...this.snapshot,

          jobs,

          statistics,
        });

    this.snapshot = {
      ...this.snapshot,

      jobs,

      statistics: {
        ...statistics,

        averageCompletedItemMs:
          queueEstimate
            .basedOnCompletedSamples
            ? queueEstimate
                .averageItemMs
            : statistics
                .averageCompletedItemMs,

        estimatedRemainingMs:
          queueEstimate
            .estimatedRemainingMs,
      },

      timing: {
        ...this.snapshot.timing,

        estimatedRemainingMs:
          queueEstimate
            .estimatedRemainingMs,
      },
    };
    this.cachedSnapshot =
  null;

this.cachedSnapshotRevision =
  -1;
  }

  private normalizeRestoredSnapshot(
    snapshot:
      ProcessingQueueSnapshot
  ): ProcessingQueueSnapshot {
    const timestamp =
      now();

    const jobs =
      snapshot.jobs.map(
        job => {
          if (
            isProcessingJobActive(
              job.status
            )
          ) {
            return {
              ...job,

              status:
                'interrupted' as
                  ProcessingJobStatus,

              progress: {
                ...job.progress,

                stage:
                  'queued' as
                    ProcessingJobStage,

                message:
                  'Waiting to resume processing.',

                updatedAt:
                  timestamp,
              },

              timing: {
                ...job.timing,

                interruptedAt:
                  timestamp,

                lastUpdatedAt:
                  timestamp,
              },

              background: {
                ...job.background,

                isRunning:
                  false,

                wasInterrupted:
                  true,

                interruptionReason:
                  'Application processing was interrupted.',
              },
            };
          }

          return cloneProcessingJob(
            job
          );
        }
      );

    const hasPending =
      jobs.some(
        job =>
          isProcessingJobPending(
            job.status
          )
      );

    const restored:
      ProcessingQueueSnapshot = {
      ...snapshot,

      status:
        hasPending
          ? 'stopped'
          : snapshot.status ===
              'disposed'
            ? 'stopped'
            : snapshot.status,

      jobs:
        reindexProcessingJobs(
          jobs
        ),

      activeJobId:
        null,

      config:
        cloneProcessingQueueConfig(
          snapshot.config
        ),

      timing: {
        ...snapshot.timing,

        lastUpdatedAt:
          timestamp,
      },

      restoredFromStorage:
        snapshot
          .restoredFromStorage,

      revision:
        snapshot.revision +
        1,
    };

    const statistics =
      calculateQueueStatistics(
        restored.jobs,
        restored.config
          .estimatedItemProcessingMs
      );

    return {
      ...restored,

      statistics,

      timing: {
        ...restored.timing,

        estimatedRemainingMs:
          statistics
            .estimatedRemainingMs,
      },
    };
  }

  private evaluateQueueCompletion():
    void {
    const jobs =
      this.snapshot.jobs.filter(
        job =>
          !job.deletionRequested
      );

    if (
      jobs.length ===
        0
    ) {
      return;
    }

    const allTerminal =
      jobs.every(
        job =>
          isProcessingJobTerminal(
            job.status
          )
      );

    if (
      !allTerminal
    ) {
      return;
    }

    if (
      this.snapshot.status ===
        'completed'
    ) {
      return;
    }

    const timestamp =
      now();

    this.snapshot = {
      ...this.snapshot,

      status:
        'completed',

      activeJobId:
        null,

      timing: {
        ...this.snapshot.timing,

        completedAt:
          timestamp,

        lastUpdatedAt:
          timestamp,
      },

      revision:
        this.snapshot.revision +
        1,
    };

    this.recalculateSnapshot();

    this.updateDiagnostics({
      running:
        false,

      activeJobId:
        null,

      lastOperationAt:
        timestamp,
    });

    this.emitEvent(
      'queue-completed'
    );

    void this.persistSnapshot();
  }

  private resolveStatusFromStage(
    currentStatus:
      ProcessingJobStatus,
    stage:
      ProcessingJobStage,
    progress:
      number
  ): ProcessingJobStatus {
    if (
      currentStatus ===
        'cancelled' ||
      currentStatus ===
        'failed' ||
      currentStatus ===
        'completed'
    ) {
      return currentStatus;
    }

    if (
      stage ===
        'export-transparent-image' ||
      stage ===
        'save-processed-image' ||
      stage ===
        'update-wardrobe-item' ||
      progress >=
        0.95
    ) {
      return 'finalizing';
    }

    if (
      stage ===
        'queued'
    ) {
      return 'queued';
    }

    if (
      stage ===
        'load-source' ||
      stage ===
        'validate-source' ||
      stage ===
        'prepare-segmentation'
    ) {
      return 'preparing';
    }

    return 'processing';
  }

  /* =======================================================
   * Persistence helper
   * ===================================================== */

  private async persistSnapshot():
    Promise<void> {
    if (
      !this.snapshot
        .config
        .persistAfterEveryChange &&
      this.snapshot.status ===
        'running'
    ) {
      return;
    }

    try {
      await this.storage.save(
        this.snapshot
      );

      this.updateDiagnostics({
        persistCount:
          this.diagnostics
            .persistCount +
          1,

        lastOperationAt:
          now(),
      });

      this.emitEvent(
        'storage-saved'
      );
    } catch (error) {
      const storageError =
        resolveExecutionError(
          error,
          this.createSyntheticJobForError()
        );

      this.snapshot = {
        ...this.snapshot,

        lastError:
          storageError,
      };

      this.updateDiagnostics({
        persistFailureCount:
          this.diagnostics
            .persistFailureCount +
          1,

        lastError:
          storageError,
      });

      this.emitEvent(
        'storage-failed',
        null,
        storageError
      );
    }
  }

  /* =======================================================
   * Event helper
   * ===================================================== */

  private emitEvent(
    type:
      ProcessingQueueEventType,
    job:
      ProcessingJob | null =
        null,
    error:
      ProcessingJobError | null =
        null,
    metadata:
      Readonly<
        Record<
          string,
          string | number | boolean | null
        >
      > =
        {}
  ): void {
    this.eventBus.emit({
      type,

      snapshot:
        this.snapshot,

      job,

      error,

      metadata,
    });
  }

  /* =======================================================
   * Operation locking
   * ===================================================== */

  private async runExclusive<
    TResult,
  >(
    operation:
      () => Promise<TResult>
  ): Promise<TResult> {
    this.assertNotDisposed();

    this.operationCount +=
      1;

    this.updateDiagnostics({
      queuedOperationCount:
        this.operationCount,
    });

    const previousOperation =
      this.operationChain;

    let releaseOperation:
      () => void =
        () => {};

    this.operationChain =
      new Promise<void>(
        resolve => {
          releaseOperation =
            resolve;
        }
      );

    await previousOperation;

    try {
      return await operation();
    } finally {
      this.operationCount =
        Math.max(
          0,
          this.operationCount -
          1
        );

      this.updateDiagnostics({
        queuedOperationCount:
          this.operationCount,

        lastOperationAt:
          now(),
      });

      releaseOperation();
    }
  }

  /* =======================================================
   * Initialization helpers
   * ===================================================== */

  private async ensureInitialized():
    Promise<void> {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }
  }

  private assertNotDisposed():
    void {
    if (
      this.disposed
    ) {
      throw createQueueError(
        'QUEUE_DISPOSED',
        'Processing queue has already been disposed.'
      );
    }
  }

  private resolveApplicationState():
    | 'active'
    | 'inactive'
    | 'background'
    | 'unknown' {
    try {
      return this
        .applicationStateProvider();
    } catch {
      return 'unknown';
    }
  }

  private updateDiagnostics(
    updates:
      Partial<
        ProcessingQueueDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...updates,
    };
  }

  private createSyntheticJobForError():
    ProcessingJob {
    const timestamp =
      now();

    const syntheticId =
      createProcessingJobId();

    return {
      schemaVersion:
        PROCESSING_QUEUE_SCHEMA_VERSION,

      id:
        syntheticId,

      queueId:
        this.snapshot
          .queueId,

      batchId:
        'synthetic-batch',

      requestId:
        `synthetic-request-${syntheticId}`,

      wardrobeItemId:
        'synthetic-wardrobe-item',

      status:
        'failed',

      source: {
        uri:
          'unknown://queue',

        kind:
          'unknown',

        width:
          null,

        height:
          null,

        format:
          'unknown',

        orientation:
          null,

        fileName:
          null,

        mimeType:
          null,

        fileSizeBytes:
          null,

        assetId:
          null,

        segmentationSourceId:
          null,

        createdAt:
          timestamp,

        metadata:
          {},
      },

      wardrobe: {
        wardrobeType:
          null,

        category:
          null,

        subcategory:
          null,

        itemName:
          null,

        color:
          null,

        style:
          null,

        season:
          null,

        occasion:
          null,

        isFavorite:
          false,

        metadata:
          {},
      },

      output:
        null,

      progress: {
        progress:
          0,

        percentage:
          0,

        stage:
          'failed',

        message:
          'Queue operation failed.',

        updatedAt:
          timestamp,

        elapsedMs:
          0,

        estimatedRemainingMs:
          null,

        segmentationProgress:
          null,
      },

      timing: {
        createdAt:
          timestamp,

        queuedAt:
          timestamp,

        startedAt:
          null,

        lastUpdatedAt:
          timestamp,

        pausedAt:
          null,

        interruptedAt:
          null,

        completedAt:
          null,

        failedAt:
          timestamp,

        cancelledAt:
          null,

        totalProcessingMs:
          0,

        lastAttemptDurationMs:
          0,

        estimatedProcessingMs:
          this.snapshot
            .config
            .estimatedItemProcessingMs,
      },

      retry: {
        attempt:
          0,

        maximumAttempts:
          this.snapshot
            .config
            .retryPolicy
            .maximumAttempts,

        nextRetryAt:
          null,

        previousRetryAt:
          null,

        retryScheduled:
          false,

        exhausted:
          true,
      },

      retryPolicy: {
        ...this.snapshot
          .config
          .retryPolicy,

        retryableErrorCodes:
          [
            ...this.snapshot
              .config
              .retryPolicy
              .retryableErrorCodes,
          ],
      },

      background: {
        platform:
          'unknown',

        capability:
          'unknown',

        executor:
          'unknown',

        executionMode:
          'unknown',

        nativeTaskId:
          null,

        nativeJobId:
          null,

        startedAt:
          null,

        lastHeartbeatAt:
          null,

        expirationAt:
          null,

        applicationState:
          'unknown',

        isRunning:
          false,

        wasInterrupted:
          false,

        interruptionReason:
          null,
      },

      error:
        null,

      queuePosition:
        0,

      priority:
        0,

      cancellationRequested:
        false,

      deletionRequested:
        false,

      persist:
        false,

      metadata:
        {},
    };
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultProcessingQueue:
  ProcessingQueue | null =
    null;

export function getDefaultProcessingQueue(
  options?:
    ProcessingQueueOptions
): ProcessingQueue {
  if (
    !defaultProcessingQueue
  ) {
    defaultProcessingQueue =
      new ProcessingQueue(
        options
      );
  } else if (
    options?.executor !==
      undefined
  ) {
    defaultProcessingQueue
      .setExecutor(
        options.executor
      );
  }

  return defaultProcessingQueue;
}

export async function initializeDefaultProcessingQueue(
  options?:
    ProcessingQueueOptions
): Promise<
  ProcessingQueueInitializeResult
> {
  return getDefaultProcessingQueue(
    options
  ).initialize();
}

export async function disposeDefaultProcessingQueue():
  Promise<void> {
  if (
    !defaultProcessingQueue
  ) {
    return;
  }

  await defaultProcessingQueue
    .dispose();

  defaultProcessingQueue =
    null;
}