// scan/core/services/ScanItemQueueService.ts
//
// Triple N - Scan Item Queue Service
//
// هذه الطبقة تربط واجهة التطبيق مع ProcessingQueue.
//
// مسؤولياتها:
//
// 1) تهيئة Queue مرة واحدة.
// 2) تسجيل منفّذ معالجة الصور.
// 3) إضافة صورة واحدة أو عدة صور.
// 4) تشغيل الصور بالترتيب.
// 5) قراءة Snapshot الحالية.
// 6) الاشتراك في تغييرات Queue.
// 7) الإيقاف والاستكمال وإعادة المحاولة.
// 8) إلغاء أو حذف Job.
// 9) متابعة AppState.
// 10) توفير Singleton واحد لكل التطبيق.
//
// هذا الملف لا ينفذ EdgeSAM بنفسه.
// منفّذ EdgeSAM سيتم ربطه لاحقًا من خلال:
//
// setScanItemProcessingExecutor(...)

import {
    AppState,
    type AppStateStatus,
} from 'react-native';

import type {
    CancelProcessingJobRequest,
    CreateProcessingJobRequest,
    EnqueueProcessingJobsRequest,
    EnqueueProcessingJobsResult,
    ProcessingJob,
    ProcessingJobId,
    ProcessingQueueEvent,
    ProcessingQueueSnapshot,
    RemoveProcessingJobRequest,
    RetryProcessingJobRequest,
} from '../queue/QueueTypes';

import type {
    ProcessingQueueEventFilter,
    ProcessingQueueEventSubscription,
} from '../queue/QueueEvents';

import {
    getDefaultProcessingQueueEventBus,
} from '../queue/QueueEvents';

import type {
    ProcessingJobExecutor,
    ProcessingQueueDiagnostics,
    ProcessingQueueInitializeResult,
    ProcessingQueueOperationResult,
} from '../queue/ProcessingQueue';

import {
    getDefaultProcessingQueue,
} from '../queue/ProcessingQueue';

import type {
    ProcessingQueueTimeEstimate,
} from '../queue/TimeEstimator';

import type {
    ScanItemProcessingConfig,
} from '../queue/ProcessingConfig';

import {
    getDefaultScanItemProcessingConfig,
} from '../queue/ProcessingConfig';

/* =========================================================
 * Public types
 * ======================================================= */

export type ScanItemQueueServiceState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'paused'
  | 'failed'
  | 'disposed';

export type ScanItemQueueServiceListener = (
  snapshot:
    ProcessingQueueSnapshot,
  event:
    ProcessingQueueEvent | null
) => void;

export type ScanItemQueueServiceOptions = {
  config?:
    ScanItemProcessingConfig;

  executor?:
    ProcessingJobExecutor | null;

  autoStart?:
    boolean;

  autoInitialize?:
    boolean;
};

export type ScanItemQueueServiceDiagnostics = {
  state:
    ScanItemQueueServiceState;

  initialized:
    boolean;

  disposed:
    boolean;

  applicationState:
    AppStateStatus;

  listenerCount:
    number;

  initializationCount:
    number;

  enqueueCount:
    number;

  startCount:
    number;

  pauseCount:
    number;

  resumeCount:
    number;

  retryCount:
    number;

  cancelCount:
    number;

  removeCount:
    number;

  lastEventType:
    ProcessingQueueEvent['type'] | null;

  lastOperationAt:
    number | null;

  lastError:
    string | null;

  queue:
    ProcessingQueueDiagnostics;
};

/* =========================================================
 * Helpers
 * ======================================================= */

function now():
  number {
  return Date.now();
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

function cloneSnapshot(
  snapshot:
    ProcessingQueueSnapshot
): ProcessingQueueSnapshot {
  return {
    ...snapshot,

    jobs:
      snapshot.jobs.map(
        job => ({
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
            job.error
              ? {
                  ...job.error,

                  metadata: {
                    ...job.error.metadata,
                  },
                }
              : null,

          metadata: {
            ...job.metadata,
          },
        })
      ),

    config: {
      ...snapshot.config,

      retryPolicy: {
        ...snapshot
          .config
          .retryPolicy,

        retryableErrorCodes:
          [
            ...snapshot
              .config
              .retryPolicy
              .retryableErrorCodes,
          ],
      },
    },

    statistics: {
      ...snapshot.statistics,
    },

    timing: {
      ...snapshot.timing,
    },

    lastError:
      snapshot.lastError
        ? {
            ...snapshot.lastError,

            metadata: {
              ...snapshot
                .lastError
                .metadata,
            },
          }
        : null,
  };
}

/* =========================================================
 * Service
 * ======================================================= */

export class ScanItemQueueService {
  private readonly config:
    ScanItemProcessingConfig;

  private readonly queue;

  private readonly eventBus;

  private readonly listeners =
    new Set<
      ScanItemQueueServiceListener
    >();

  private queueSubscription:
    ProcessingQueueEventSubscription | null =
      null;

  private appStateSubscription:
    ReturnType<
      typeof AppState.addEventListener
    > | null =
      null;

  private state:
    ScanItemQueueServiceState =
      'uninitialized';

  private initialized =
    false;

  private disposed =
    false;

  private applicationState:
    AppStateStatus =
      AppState.currentState;

  private initializePromise:
    Promise<ProcessingQueueInitializeResult> | null =
      null;

  private latestSnapshot:
    ProcessingQueueSnapshot;

  private diagnostics: {
    initializationCount:
      number;

    enqueueCount:
      number;

    startCount:
      number;

    pauseCount:
      number;

    resumeCount:
      number;

    retryCount:
      number;

    cancelCount:
      number;

    removeCount:
      number;

    lastEventType:
      ProcessingQueueEvent['type'] | null;

    lastOperationAt:
      number | null;

    lastError:
      string | null;
  } = {
    initializationCount:
      0,

    enqueueCount:
      0,

    startCount:
      0,

    pauseCount:
      0,

    resumeCount:
      0,

    retryCount:
      0,

    cancelCount:
      0,

    removeCount:
      0,

    lastEventType:
      null,

    lastOperationAt:
      null,

    lastError:
      null,
  };

  constructor(
    options:
      ScanItemQueueServiceOptions =
        {}
  ) {
    this.config =
      options.config ??
      getDefaultScanItemProcessingConfig();

    this.queue =
      getDefaultProcessingQueue({
        config:
          this.config,

        executor:
          options.executor ??
          null,

        applicationStateProvider:
          () =>
            this.resolveApplicationState(),
      });

    this.eventBus =
      getDefaultProcessingQueueEventBus();

    this.latestSnapshot =
      this.queue.getSnapshot();

    this.attachQueueEvents();
    this.attachApplicationState();

    if (
      options.autoInitialize
    ) {
      void this.initialize(
        options.autoStart ??
        false
      );
    }
  }

  /* =======================================================
   * Initialization
   * ===================================================== */

  public initialize(
    startAfterInitialization =
      false
  ): Promise<
    ProcessingQueueInitializeResult
  > {
    this.assertNotDisposed();

    if (
      this.initializePromise
    ) {
      return this.initializePromise;
    }

    if (
      this.initialized
    ) {
      const snapshot =
        this.queue.getSnapshot();

      return Promise.resolve({
        initialized:
          true,

        restored:
          snapshot
            .restoredFromStorage,

        recoveredFromBackup:
          false,

        snapshot,

        warnings:
          [],

        durationMs:
          0,
      });
    }

    this.state =
      'initializing';

    this.initializePromise =
      this.queue.initialize()
        .then(
          async result => {
            this.initialized =
              true;

            this.latestSnapshot =
              cloneSnapshot(
                result.snapshot
              );

            this.state =
              result.snapshot.status ===
                'running'
                ? 'running'
                : 'ready';

            this.diagnostics = {
              ...this.diagnostics,

              initializationCount:
                this.diagnostics
                  .initializationCount +
                1,

              lastOperationAt:
                now(),

              lastError:
                null,
            };

            this.notifyListeners(
              null
            );

            if (
              startAfterInitialization &&
              this.queue.hasExecutor() &&
              this.queue.hasPendingJobs()
            ) {
              await this.start();
            }

            return {
              ...result,

              snapshot:
                cloneSnapshot(
                  result.snapshot
                ),
            };
          }
        )
        .catch(
          error => {
            this.state =
              'failed';

            this.diagnostics = {
              ...this.diagnostics,

              lastOperationAt:
                now(),

              lastError:
                getUnknownErrorMessage(
                  error
                ),
            };

            throw error;
          }
        )
        .finally(
          () => {
            this.initializePromise =
              null;
          }
        );

    return this.initializePromise;
  }

  /* =======================================================
   * Executor
   * ===================================================== */

  public setExecutor(
    executor:
      ProcessingJobExecutor | null
  ): void {
    this.assertNotDisposed();

    this.queue.setExecutor(
      executor
    );
  }

  public hasExecutor():
    boolean {
    this.assertNotDisposed();

    return this.queue
      .hasExecutor();
  }

  /* =======================================================
   * Enqueue
   * ===================================================== */

  public async enqueueItems(
    request:
      EnqueueProcessingJobsRequest
  ): Promise<
    EnqueueProcessingJobsResult
  > {
    await this.ensureInitialized();

    try {
      const result =
        await this.queue.enqueue(
          request
        );

      this.latestSnapshot =
        cloneSnapshot(
          result.snapshot
        );

      this.diagnostics = {
        ...this.diagnostics,

        enqueueCount:
          this.diagnostics
            .enqueueCount +
          result.accepted.length,

        lastOperationAt:
          now(),

        lastError:
          null,
      };

      return {
        ...result,

        accepted:
          result.accepted.map(
            job => ({
              ...job,
            })
          ),

        rejected:
          result.rejected.map(
            rejection => ({
              ...rejection,

              error: {
                ...rejection.error,

                metadata: {
                  ...rejection
                    .error
                    .metadata,
                },
              },
            })
          ),

        snapshot:
          cloneSnapshot(
            result.snapshot
          ),
      };
    } catch (error) {
      this.recordError(
        error
      );

      throw error;
    }
  }

  public async enqueueItem(
    request:
      CreateProcessingJobRequest,
    startImmediately =
      true
  ): Promise<
    EnqueueProcessingJobsResult
  > {
    return this.enqueueItems({
      jobs: [
        request,
      ],

      startImmediately,
    });
  }

  /* =======================================================
   * Lifecycle
   * ===================================================== */

  public async start():
    Promise<
      ProcessingQueueSnapshot
    > {
    await this.ensureInitialized();

    try {
      const snapshot =
        await this.queue.start();

      this.latestSnapshot =
        cloneSnapshot(
          snapshot
        );

      this.state =
        'running';

      this.diagnostics = {
        ...this.diagnostics,

        startCount:
          this.diagnostics
            .startCount +
          1,

        lastOperationAt:
          now(),

        lastError:
          null,
      };

      return cloneSnapshot(
        snapshot
      );
    } catch (error) {
      this.state =
        'failed';

      this.recordError(
        error
      );

      throw error;
    }
  }

  public async pause():
    Promise<
      ProcessingQueueSnapshot
    > {
    await this.ensureInitialized();

    const snapshot =
      await this.queue.pause();

    this.latestSnapshot =
      cloneSnapshot(
        snapshot
      );

    this.state =
      'paused';

    this.diagnostics = {
      ...this.diagnostics,

      pauseCount:
        this.diagnostics
          .pauseCount +
        1,

      lastOperationAt:
        now(),

      lastError:
        null,
    };

    return cloneSnapshot(
      snapshot
    );
  }

  public async resume():
    Promise<
      ProcessingQueueSnapshot
    > {
    await this.ensureInitialized();

    const snapshot =
      await this.queue.resume();

    this.latestSnapshot =
      cloneSnapshot(
        snapshot
      );

    this.state =
      'running';

    this.diagnostics = {
      ...this.diagnostics,

      resumeCount:
        this.diagnostics
          .resumeCount +
        1,

      lastOperationAt:
        now(),

      lastError:
        null,
    };

    return cloneSnapshot(
      snapshot
    );
  }

  public async stop(
    reason?:
      string
  ): Promise<
      ProcessingQueueSnapshot
    > {
    await this.ensureInitialized();

    const snapshot =
      await this.queue.stop(
        reason
      );

    this.latestSnapshot =
      cloneSnapshot(
        snapshot
      );

    this.state =
      'ready';

    return cloneSnapshot(
      snapshot
    );
  }

  /* =======================================================
   * Job controls
   * ===================================================== */

  public async retryJob(
    request:
      RetryProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    const result =
      await this.queue.retryJob(
        request
      );

    this.latestSnapshot =
      cloneSnapshot(
        result.snapshot
      );

    this.diagnostics = {
      ...this.diagnostics,

      retryCount:
        this.diagnostics
          .retryCount +
        (
          result.changed
            ? 1
            : 0
        ),

      lastOperationAt:
        now(),
    };

    return {
      ...result,

      snapshot:
        cloneSnapshot(
          result.snapshot
        ),
    };
  }

  public async cancelJob(
    request:
      CancelProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    const result =
      await this.queue.cancelJob(
        request
      );

    this.latestSnapshot =
      cloneSnapshot(
        result.snapshot
      );

    this.diagnostics = {
      ...this.diagnostics,

      cancelCount:
        this.diagnostics
          .cancelCount +
        (
          result.changed
            ? 1
            : 0
        ),

      lastOperationAt:
        now(),
    };

    return {
      ...result,

      snapshot:
        cloneSnapshot(
          result.snapshot
        ),
    };
  }

  public async removeJob(
    request:
      RemoveProcessingJobRequest
  ): Promise<
    ProcessingQueueOperationResult
  > {
    await this.ensureInitialized();

    const result =
      await this.queue.removeJob(
        request
      );

    this.latestSnapshot =
      cloneSnapshot(
        result.snapshot
      );

    this.diagnostics = {
      ...this.diagnostics,

      removeCount:
        this.diagnostics
          .removeCount +
        (
          result.changed
            ? 1
            : 0
        ),

      lastOperationAt:
        now(),
    };

    return {
      ...result,

      snapshot:
        cloneSnapshot(
          result.snapshot
        ),
    };
  }

  /* =======================================================
   * Queries
   * ===================================================== */

  public getSnapshot():
    ProcessingQueueSnapshot {
    this.assertNotDisposed();

    this.latestSnapshot =
      this.queue.getSnapshot();

    return cloneSnapshot(
      this.latestSnapshot
    );
  }

  public getJobs():
    readonly ProcessingJob[] {
    this.assertNotDisposed();

    return this.queue.getJobs();
  }

  public getJob(
    jobId:
      ProcessingJobId
  ): ProcessingJob | null {
    this.assertNotDisposed();

    return this.queue.getJob(
      jobId
    );
  }

  public getQueueTimeEstimate():
    ProcessingQueueTimeEstimate {
    this.assertNotDisposed();

    return this.queue
      .getQueueTimeEstimate();
  }

  public isRunning():
    boolean {
    this.assertNotDisposed();

    return this.queue.isRunning();
  }

  public hasPendingJobs():
    boolean {
    this.assertNotDisposed();

    return this.queue
      .hasPendingJobs();
  }

  /* =======================================================
   * Subscriptions
   * ===================================================== */

  public subscribe(
    listener:
      ScanItemQueueServiceListener
  ): () => void {
    this.assertNotDisposed();

    this.listeners.add(
      listener
    );

    listener(
      this.getSnapshot(),
      null
    );

    return () => {
      this.listeners.delete(
        listener
      );
    };
  }

  public subscribeToEvents(
    listener:
      (
        event:
          ProcessingQueueEvent
      ) => void,
    filter?:
      ProcessingQueueEventFilter
  ): ProcessingQueueEventSubscription {
    this.assertNotDisposed();

    return this.eventBus.subscribe(
      listener,
      filter
    );
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getState():
    ScanItemQueueServiceState {
    return this.state;
  }

  public getDiagnostics():
    ScanItemQueueServiceDiagnostics {
    return {
      state:
        this.state,

      initialized:
        this.initialized,

      disposed:
        this.disposed,

      applicationState:
        this.applicationState,

      listenerCount:
        this.listeners.size,

      initializationCount:
        this.diagnostics
          .initializationCount,

      enqueueCount:
        this.diagnostics
          .enqueueCount,

      startCount:
        this.diagnostics
          .startCount,

      pauseCount:
        this.diagnostics
          .pauseCount,

      resumeCount:
        this.diagnostics
          .resumeCount,

      retryCount:
        this.diagnostics
          .retryCount,

      cancelCount:
        this.diagnostics
          .cancelCount,

      removeCount:
        this.diagnostics
          .removeCount,

      lastEventType:
        this.diagnostics
          .lastEventType,

      lastOperationAt:
        this.diagnostics
          .lastOperationAt,

      lastError:
        this.diagnostics
          .lastError,

      queue:
        this.queue
          .getDiagnostics(),
    };
  }

  /* =======================================================
   * Persistence
   * ===================================================== */

  public async flush():
    Promise<void> {
    await this.ensureInitialized();

    await this.queue
      .flushStorage();
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

    this.queueSubscription
      ?.unsubscribe();

    this.queueSubscription =
      null;

    this.appStateSubscription
      ?.remove();

    this.appStateSubscription =
      null;

    this.listeners.clear();

    await this.queue.flushStorage();

    this.initialized =
      false;

    this.disposed =
      true;

    this.state =
      'disposed';
  }

  /* =======================================================
   * Internal event handling
   * ===================================================== */

  private attachQueueEvents():
    void {
    if (
      this.queueSubscription
    ) {
      return;
    }

    this.queueSubscription =
      this.eventBus.subscribe(
        event => {
          this.latestSnapshot =
            cloneSnapshot(
              event.snapshot
            );

          this.state =
            this.resolveStateFromSnapshot(
              event.snapshot
            );

          this.diagnostics = {
            ...this.diagnostics,

            lastEventType:
              event.type,

            lastOperationAt:
              event.timestamp,

            lastError:
              event.error
                ?.message ??
              this.diagnostics
                .lastError,
          };

          this.notifyListeners(
            event
          );
        }
      );
  }

  private attachApplicationState():
    void {
    if (
      this.appStateSubscription
    ) {
      return;
    }

    this.appStateSubscription =
      AppState.addEventListener(
        'change',
        nextState => {
          this.applicationState =
            nextState;

          this.diagnostics = {
            ...this.diagnostics,

            lastOperationAt:
              now(),
          };
        }
      );
  }

  private notifyListeners(
    event:
      ProcessingQueueEvent | null
  ): void {
    const snapshot =
      cloneSnapshot(
        this.latestSnapshot
      );

    for (
      const listener of
      this.listeners
    ) {
      try {
        listener(
          cloneSnapshot(
            snapshot
          ),
          event
        );
      } catch (error) {
        console.error(
          'TRIPLE N SCAN ITEM QUEUE LISTENER ERROR:',
          error
        );
      }
    }
  }

  private resolveStateFromSnapshot(
    snapshot:
      ProcessingQueueSnapshot
  ): ScanItemQueueServiceState {
    switch (
      snapshot.status
    ) {
      case 'running':
        return 'running';

      case 'paused':
        return 'paused';

      case 'failed':
        return 'failed';

      case 'disposed':
        return 'disposed';

      default:
        return this.initialized
          ? 'ready'
          : 'uninitialized';
    }
  }

  private resolveApplicationState():
    | 'active'
    | 'inactive'
    | 'background'
    | 'unknown' {
    switch (
      this.applicationState
    ) {
      case 'active':
        return 'active';

      case 'inactive':
        return 'inactive';

      case 'background':
        return 'background';

      default:
        return 'unknown';
    }
  }

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
      throw new Error(
        'Scan Item queue service has already been disposed.'
      );
    }
  }

  private recordError(
    error:
      unknown
  ): void {
    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        now(),

      lastError:
        getUnknownErrorMessage(
          error
        ),
    };
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultScanItemQueueService:
  ScanItemQueueService | null =
    null;

export function getDefaultScanItemQueueService(
  options?:
    ScanItemQueueServiceOptions
): ScanItemQueueService {
  if (
    !defaultScanItemQueueService
  ) {
    defaultScanItemQueueService =
      new ScanItemQueueService(
        options
      );
  } else if (
    options?.executor !==
      undefined
  ) {
    defaultScanItemQueueService
      .setExecutor(
        options.executor
      );
  }

  return defaultScanItemQueueService;
}

export function setScanItemProcessingExecutor(
  executor:
    ProcessingJobExecutor | null
): void {
  getDefaultScanItemQueueService()
    .setExecutor(
      executor
    );
}

export async function initializeScanItemQueueService(
  options?:
    ScanItemQueueServiceOptions
): Promise<
  ProcessingQueueInitializeResult
> {
  return getDefaultScanItemQueueService(
    options
  ).initialize(
    options?.autoStart ??
    false
  );
}

export async function enqueueScanItem(
  request:
    CreateProcessingJobRequest,
  startImmediately =
    true
): Promise<
  EnqueueProcessingJobsResult
> {
  return getDefaultScanItemQueueService()
    .enqueueItem(
      request,
      startImmediately
    );
}

export async function enqueueScanItems(
  request:
    EnqueueProcessingJobsRequest
): Promise<
  EnqueueProcessingJobsResult
> {
  return getDefaultScanItemQueueService()
    .enqueueItems(
      request
    );
}

export function subscribeToScanItemQueue(
  listener:
    ScanItemQueueServiceListener
): () => void {
  return getDefaultScanItemQueueService()
    .subscribe(
      listener
    );
}

export async function disposeScanItemQueueService():
  Promise<void> {
  if (
    !defaultScanItemQueueService
  ) {
    return;
  }

  await defaultScanItemQueueService
    .dispose();

  defaultScanItemQueueService =
    null;
}