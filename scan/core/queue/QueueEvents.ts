// scan/core/queue/QueueEvents.ts
//
// Triple N - Scan Item Processing Queue Events
//
// هذا الملف مسؤول عن توزيع أحداث Queue معالجة Scan Item
// على واجهة التطبيق والخدمات المرتبطة بها.
//
// مسؤولياته:
//
// 1) تسجيل Event Listeners.
// 2) إزالة Event Listeners بأمان.
// 3) إرسال أحداث Queue وJobs.
// 4) دعم الاشتراك في حدث معين.
// 5) دعم الاشتراك في Job معينة.
// 6) دعم الاشتراك في Batch معينة.
// 7) حفظ آخر حدث وآخر Snapshot.
// 8) منع Listener واحدة من تعطيل باقي الـListeners.
// 9) توفير Diagnostics واضحة.
// 10) توفير Singleton افتراضي لكل التطبيق.
//
// هذا الملف لا يشغّل EdgeSAM.
// لا يحفظ البيانات داخل AsyncStorage.
// لا يعدّل Queue بنفسه.
// لا يرسل إشعارات النظام.

import type {
    ProcessingBatchId,
    ProcessingJob,
    ProcessingJobError,
    ProcessingJobId,
    ProcessingQueueEvent,
    ProcessingQueueEventListener,
    ProcessingQueueEventType,
    ProcessingQueueId,
    ProcessingQueueSnapshot,
    ProcessingTimestamp,
} from './QueueTypes';

/* =========================================================
 * Constants
 * ======================================================= */

export const DEFAULT_QUEUE_EVENT_HISTORY_LIMIT =
  100;

export const MAXIMUM_QUEUE_EVENT_HISTORY_LIMIT =
  1_000;

export const DEFAULT_QUEUE_EVENT_LISTENER_LIMIT =
  500;

/* =========================================================
 * Public types
 * ======================================================= */

export type ProcessingQueueSubscriptionId =
  string;

export type ProcessingQueueEventFilter = {
  eventTypes?:
    readonly ProcessingQueueEventType[];

  queueId?:
    ProcessingQueueId | null;

  jobId?:
    ProcessingJobId | null;

  batchId?:
    ProcessingBatchId | null;

  includeEventsWithoutJob?:
    boolean;

  includeEventsWithoutBatch?:
    boolean;
};

export type ProcessingQueueEventSubscription = {
  id:
    ProcessingQueueSubscriptionId;

  createdAt:
    ProcessingTimestamp;

  active:
    boolean;

  filter:
    ProcessingQueueEventFilter;

  unsubscribe():
    void;
};

export type ProcessingQueueEventHistoryEntry = {
  sequence:
    number;

  event:
    ProcessingQueueEvent;
};

export type ProcessingQueueEventBusState =
  | 'idle'
  | 'emitting'
  | 'disposed';

export type ProcessingQueueEventBusDiagnostics = {
  state:
    ProcessingQueueEventBusState;

  disposed:
    boolean;

  listenerCount:
    number;

  emittedEventCount:
    number;

  deliveredEventCount:
    number;

  filteredEventCount:
    number;

  listenerErrorCount:
    number;

  historySize:
    number;

  historyLimit:
    number;

  lastEventAt:
    ProcessingTimestamp | null;

  lastEventType:
    ProcessingQueueEventType | null;

  lastQueueId:
    ProcessingQueueId | null;

  lastJobId:
    ProcessingJobId | null;

  lastBatchId:
    ProcessingBatchId | null;

  lastListenerError:
    string | null;
};

export type ProcessingQueueEventBusOptions = {
  historyLimit?:
    number;

  listenerLimit?:
    number;

  preserveHistory?:
    boolean;
};

export type ProcessingQueueEventInput = {
  type:
    ProcessingQueueEventType;

  snapshot:
    ProcessingQueueSnapshot;

  job?:
    ProcessingJob | null;

  jobId?:
    ProcessingJobId | null;

  batchId?:
    ProcessingBatchId | null;

  error?:
    ProcessingJobError | null;

  timestamp?:
    ProcessingTimestamp;

  metadata?:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

type InternalProcessingQueueSubscription = {
  id:
    ProcessingQueueSubscriptionId;

  createdAt:
    ProcessingTimestamp;

  active:
    boolean;

  listener:
    ProcessingQueueEventListener;

  filter:
    ProcessingQueueEventFilter;
};

/* =========================================================
 * Internal helpers
 * ======================================================= */

function now(): number {
  return Date.now();
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
      Math.floor(value)
    )
  );
}

function createRandomPart(
  length:
    number
): string {
  return Math.random()
    .toString(36)
    .slice(
      2,
      2 +
        Math.max(
          4,
          Math.floor(length)
        )
    );
}

function createSubscriptionId():
  ProcessingQueueSubscriptionId {
  return [
    'queue-subscription',
    now().toString(36),
    createRandomPart(8),
  ].join('-');
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
      JSON.stringify(error);

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

  return String(error);
}

function cloneMetadata(
  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    > | undefined
): Readonly<
  Record<
    string,
    string | number | boolean | null
  >
> {
  return {
    ...(metadata ?? {}),
  };
}

function cloneQueueError(
  error:
    ProcessingJobError | null
): ProcessingJobError | null {
  if (!error) {
    return null;
  }

  return {
    ...error,

    metadata: {
      ...error.metadata,
    },
  };
}

function cloneQueueJob(
  job:
    ProcessingJob | null
): ProcessingJob | null {
  if (!job) {
    return null;
  }

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
        job =>
          cloneQueueJob(
            job
          ) as ProcessingJob
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
      cloneQueueError(
        snapshot.lastError
      ),
  };
}

function cloneQueueEvent(
  event:
    ProcessingQueueEvent
): ProcessingQueueEvent {
  return {
    ...event,

    snapshot:
      cloneQueueSnapshot(
        event.snapshot
      ),

    job:
      cloneQueueJob(
        event.job
      ),

    error:
      cloneQueueError(
        event.error
      ),

    metadata:
      cloneMetadata(
        event.metadata
      ),
  };
}

function normalizeEventFilter(
  filter:
    ProcessingQueueEventFilter | undefined
): ProcessingQueueEventFilter {
  return {
    eventTypes:
      filter?.eventTypes
        ? [
            ...filter.eventTypes,
          ]
        : undefined,

    queueId:
      filter?.queueId ??
      null,

    jobId:
      filter?.jobId ??
      null,

    batchId:
      filter?.batchId ??
      null,

    includeEventsWithoutJob:
      filter
        ?.includeEventsWithoutJob ??
      false,

    includeEventsWithoutBatch:
      filter
        ?.includeEventsWithoutBatch ??
      false,
  };
}

function doesEventMatchFilter(
  event:
    ProcessingQueueEvent,
  filter:
    ProcessingQueueEventFilter
): boolean {
  if (
    filter.eventTypes &&
    filter.eventTypes.length >
      0 &&
    !filter.eventTypes.includes(
      event.type
    )
  ) {
    return false;
  }

  if (
    filter.queueId &&
    event.queueId !==
      filter.queueId
  ) {
    return false;
  }

  if (
    filter.jobId
  ) {
    if (
      event.jobId ===
        null
    ) {
      return (
        filter
          .includeEventsWithoutJob ===
        true
      );
    }

    if (
      event.jobId !==
        filter.jobId
    ) {
      return false;
    }
  }

  if (
    filter.batchId
  ) {
    if (
      event.batchId ===
        null
    ) {
      return (
        filter
          .includeEventsWithoutBatch ===
        true
      );
    }

    if (
      event.batchId !==
        filter.batchId
    ) {
      return false;
    }
  }

  return true;
}

/* =========================================================
 * Event factory
 * ======================================================= */

export function createProcessingQueueEvent(
  input:
    ProcessingQueueEventInput
): ProcessingQueueEvent {
  const job =
    input.job ??
    null;

  const resolvedJobId =
    input.jobId ??
    job?.id ??
    null;

  const resolvedBatchId =
    input.batchId ??
    job?.batchId ??
    input.snapshot
      .currentBatchId ??
    null;

  return {
    type:
      input.type,

    queueId:
      input.snapshot.queueId,

    jobId:
      resolvedJobId,

    batchId:
      resolvedBatchId,

    timestamp:
      typeof input.timestamp ===
        'number' &&
      Number.isFinite(
        input.timestamp
      ) &&
      input.timestamp >
        0
        ? Math.floor(
            input.timestamp
          )
        : now(),

    snapshot:
      cloneQueueSnapshot(
        input.snapshot
      ),

    job:
      cloneQueueJob(
        job
      ),

    error:
      cloneQueueError(
        input.error ??
          null
      ),

    metadata:
      cloneMetadata(
        input.metadata
      ),
  };
}

/* =========================================================
 * Event bus
 * ======================================================= */

export class ProcessingQueueEventBus {
  private readonly subscriptions =
    new Map<
      ProcessingQueueSubscriptionId,
      InternalProcessingQueueSubscription
    >();

  private readonly history:
    ProcessingQueueEventHistoryEntry[] =
      [];

  private readonly historyLimit:
    number;

  private readonly listenerLimit:
    number;

  private readonly preserveHistory:
    boolean;

  private state:
    ProcessingQueueEventBusState =
      'idle';

  private disposed =
    false;

  private sequence =
    0;

  private latestEvent:
    ProcessingQueueEvent | null =
      null;

  private latestSnapshot:
    ProcessingQueueSnapshot | null =
      null;

  private diagnostics:
    ProcessingQueueEventBusDiagnostics;

  constructor(
    options:
      ProcessingQueueEventBusOptions =
        {}
  ) {
    this.historyLimit =
      clampInteger(
        options.historyLimit ??
          DEFAULT_QUEUE_EVENT_HISTORY_LIMIT,
        0,
        MAXIMUM_QUEUE_EVENT_HISTORY_LIMIT,
        DEFAULT_QUEUE_EVENT_HISTORY_LIMIT
      );

    this.listenerLimit =
      clampInteger(
        options.listenerLimit ??
          DEFAULT_QUEUE_EVENT_LISTENER_LIMIT,
        1,
        10_000,
        DEFAULT_QUEUE_EVENT_LISTENER_LIMIT
      );

    this.preserveHistory =
      options.preserveHistory ??
      true;

    this.diagnostics = {
      state:
        'idle',

      disposed:
        false,

      listenerCount:
        0,

      emittedEventCount:
        0,

      deliveredEventCount:
        0,

      filteredEventCount:
        0,

      listenerErrorCount:
        0,

      historySize:
        0,

      historyLimit:
        this.historyLimit,

      lastEventAt:
        null,

      lastEventType:
        null,

      lastQueueId:
        null,

      lastJobId:
        null,

      lastBatchId:
        null,

      lastListenerError:
        null,
    };
  }

  public subscribe(
    listener:
      ProcessingQueueEventListener,
    filter?:
      ProcessingQueueEventFilter
  ): ProcessingQueueEventSubscription {
    this.assertNotDisposed();

    if (
      typeof listener !==
        'function'
    ) {
      throw new TypeError(
        'Processing queue event listener must be a function.'
      );
    }

    if (
      this.subscriptions.size >=
      this.listenerLimit
    ) {
      throw new Error(
        `Processing queue listener limit exceeded: ${this.listenerLimit}.`
      );
    }

    const id =
      createSubscriptionId();

    const createdAt =
      now();

    const subscription:
      InternalProcessingQueueSubscription = {
        id,

        createdAt,

        active:
          true,

        listener,

        filter:
          normalizeEventFilter(
            filter
          ),
      };

    this.subscriptions.set(
      id,
      subscription
    );

    this.updateDiagnostics({
      listenerCount:
        this.subscriptions.size,
    });

    return {
      id,

      createdAt,

      active:
        true,

      filter:
        normalizeEventFilter(
          subscription.filter
        ),

      unsubscribe:
        () => {
          this.unsubscribe(
            id
          );
        },
    };
  }

  public subscribeToEventType(
    eventType:
      ProcessingQueueEventType,
    listener:
      ProcessingQueueEventListener
  ): ProcessingQueueEventSubscription {
    return this.subscribe(
      listener,
      {
        eventTypes: [
          eventType,
        ],
      }
    );
  }

  public subscribeToEventTypes(
    eventTypes:
      readonly ProcessingQueueEventType[],
    listener:
      ProcessingQueueEventListener
  ): ProcessingQueueEventSubscription {
    return this.subscribe(
      listener,
      {
        eventTypes: [
          ...eventTypes,
        ],
      }
    );
  }

  public subscribeToJob(
    jobId:
      ProcessingJobId,
    listener:
      ProcessingQueueEventListener,
    includeEventsWithoutJob =
      false
  ): ProcessingQueueEventSubscription {
    return this.subscribe(
      listener,
      {
        jobId,

        includeEventsWithoutJob,
      }
    );
  }

  public subscribeToBatch(
    batchId:
      ProcessingBatchId,
    listener:
      ProcessingQueueEventListener,
    includeEventsWithoutBatch =
      false
  ): ProcessingQueueEventSubscription {
    return this.subscribe(
      listener,
      {
        batchId,

        includeEventsWithoutBatch,
      }
    );
  }

  public subscribeToQueue(
    queueId:
      ProcessingQueueId,
    listener:
      ProcessingQueueEventListener
  ): ProcessingQueueEventSubscription {
    return this.subscribe(
      listener,
      {
        queueId,
      }
    );
  }

  public unsubscribe(
    subscriptionId:
      ProcessingQueueSubscriptionId
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    const subscription =
      this.subscriptions.get(
        subscriptionId
      );

    if (
      !subscription
    ) {
      return false;
    }

    subscription.active =
      false;

    const deleted =
      this.subscriptions.delete(
        subscriptionId
      );

    this.updateDiagnostics({
      listenerCount:
        this.subscriptions.size,
    });

    return deleted;
  }

  public unsubscribeAll():
    number {
    if (
      this.disposed
    ) {
      return 0;
    }

    const count =
      this.subscriptions.size;

    for (
      const subscription of
      this.subscriptions.values()
    ) {
      subscription.active =
        false;
    }

    this.subscriptions.clear();

    this.updateDiagnostics({
      listenerCount:
        0,
    });

    return count;
  }

  public emit(
    input:
      ProcessingQueueEventInput
  ): ProcessingQueueEvent {
    this.assertNotDisposed();

    const event =
      createProcessingQueueEvent(
        input
      );

    this.emitEvent(
      event
    );

    return cloneQueueEvent(
      event
    );
  }

  public emitEvent(
    event:
      ProcessingQueueEvent
  ): void {
    this.assertNotDisposed();

    const safeEvent =
      cloneQueueEvent(
        event
      );

    this.state =
      'emitting';

    this.sequence +=
      1;

    this.latestEvent =
      safeEvent;

    this.latestSnapshot =
      cloneQueueSnapshot(
        safeEvent.snapshot
      );

    this.storeHistory(
      safeEvent
    );

    this.updateDiagnostics({
      state:
        'emitting',

      emittedEventCount:
        this.diagnostics
          .emittedEventCount +
        1,

      lastEventAt:
        safeEvent.timestamp,

      lastEventType:
        safeEvent.type,

      lastQueueId:
        safeEvent.queueId,

      lastJobId:
        safeEvent.jobId,

      lastBatchId:
        safeEvent.batchId,
    });

    const subscriptions =
      [
        ...this
          .subscriptions
          .values(),
      ];

    for (
      const subscription of
      subscriptions
    ) {
      if (
        !subscription.active
      ) {
        continue;
      }

      if (
        !doesEventMatchFilter(
          safeEvent,
          subscription.filter
        )
      ) {
        this.updateDiagnostics({
          filteredEventCount:
            this.diagnostics
              .filteredEventCount +
            1,
        });

        continue;
      }

      try {
        subscription.listener(
          cloneQueueEvent(
            safeEvent
          )
        );

        this.updateDiagnostics({
          deliveredEventCount:
            this.diagnostics
              .deliveredEventCount +
            1,
        });
      } catch (error) {
        this.updateDiagnostics({
          listenerErrorCount:
            this.diagnostics
              .listenerErrorCount +
            1,

          lastListenerError:
            getUnknownErrorMessage(
              error
            ),
        });

        console.error(
          'TRIPLE N QUEUE EVENT LISTENER ERROR:',
          error
        );
      }
    }

    this.state =
      'idle';

    this.updateDiagnostics({
      state:
        'idle',
    });
  }

  public getLatestEvent():
    ProcessingQueueEvent | null {
    return this.latestEvent
      ? cloneQueueEvent(
          this.latestEvent
        )
      : null;
  }

  public getLatestSnapshot():
    ProcessingQueueSnapshot | null {
    return this.latestSnapshot
      ? cloneQueueSnapshot(
          this.latestSnapshot
        )
      : null;
  }

  public getHistory(
    limit?:
      number
  ): readonly ProcessingQueueEventHistoryEntry[] {
    const resolvedLimit =
      typeof limit ===
        'number'
        ? clampInteger(
            limit,
            0,
            this.history.length,
            this.history.length
          )
        : this.history.length;

    if (
      resolvedLimit ===
        0
    ) {
      return [];
    }

    return this.history
      .slice(
        Math.max(
          0,
          this.history.length -
            resolvedLimit
        )
      )
      .map(
        entry => ({
          sequence:
            entry.sequence,

          event:
            cloneQueueEvent(
              entry.event
            ),
        })
      );
  }

  public getHistoryForJob(
    jobId:
      ProcessingJobId,
    limit?:
      number
  ): readonly ProcessingQueueEventHistoryEntry[] {
    const filtered =
      this.history.filter(
        entry =>
          entry.event.jobId ===
          jobId
      );

    const resolvedLimit =
      typeof limit ===
        'number'
        ? clampInteger(
            limit,
            0,
            filtered.length,
            filtered.length
          )
        : filtered.length;

    return filtered
      .slice(
        Math.max(
          0,
          filtered.length -
            resolvedLimit
        )
      )
      .map(
        entry => ({
          sequence:
            entry.sequence,

          event:
            cloneQueueEvent(
              entry.event
            ),
        })
      );
  }

  public getHistoryForBatch(
    batchId:
      ProcessingBatchId,
    limit?:
      number
  ): readonly ProcessingQueueEventHistoryEntry[] {
    const filtered =
      this.history.filter(
        entry =>
          entry.event.batchId ===
          batchId
      );

    const resolvedLimit =
      typeof limit ===
        'number'
        ? clampInteger(
            limit,
            0,
            filtered.length,
            filtered.length
          )
        : filtered.length;

    return filtered
      .slice(
        Math.max(
          0,
          filtered.length -
            resolvedLimit
        )
      )
      .map(
        entry => ({
          sequence:
            entry.sequence,

          event:
            cloneQueueEvent(
              entry.event
            ),
        })
      );
  }

  public clearHistory():
    number {
    const count =
      this.history.length;

    this.history.length =
      0;

    this.updateDiagnostics({
      historySize:
        0,
    });

    return count;
  }

  public getListenerCount():
    number {
    return this.subscriptions
      .size;
  }

  public hasListeners():
    boolean {
    return (
      this.subscriptions.size >
      0
    );
  }

  public getDiagnostics():
    ProcessingQueueEventBusDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  public dispose():
    void {
    if (
      this.disposed
    ) {
      return;
    }

    this.unsubscribeAll();

    this.clearHistory();

    this.latestEvent =
      null;

    this.latestSnapshot =
      null;

    this.disposed =
      true;

    this.state =
      'disposed';

    this.updateDiagnostics({
      state:
        'disposed',

      disposed:
        true,

      listenerCount:
        0,
    });
  }

  private storeHistory(
    event:
      ProcessingQueueEvent
  ): void {
    if (
      !this.preserveHistory ||
      this.historyLimit <=
        0
    ) {
      return;
    }

    this.history.push({
      sequence:
        this.sequence,

      event:
        cloneQueueEvent(
          event
        ),
    });

    while (
      this.history.length >
      this.historyLimit
    ) {
      this.history.shift();
    }

    this.updateDiagnostics({
      historySize:
        this.history.length,
    });
  }

  private assertNotDisposed():
    void {
    if (
      this.disposed
    ) {
      throw new Error(
        'Processing queue event bus has already been disposed.'
      );
    }
  }

  private updateDiagnostics(
    updates:
      Partial<
        ProcessingQueueEventBusDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...updates,
    };
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultProcessingQueueEventBus:
  ProcessingQueueEventBus | null =
    null;

export function getDefaultProcessingQueueEventBus():
  ProcessingQueueEventBus {
  if (
    !defaultProcessingQueueEventBus
  ) {
    defaultProcessingQueueEventBus =
      new ProcessingQueueEventBus();
  }

  return defaultProcessingQueueEventBus;
}

export function disposeDefaultProcessingQueueEventBus():
  void {
  if (
    !defaultProcessingQueueEventBus
  ) {
    return;
  }

  defaultProcessingQueueEventBus
    .dispose();

  defaultProcessingQueueEventBus =
    null;
}

/* =========================================================
 * Convenience subscriptions
 * ======================================================= */

export function subscribeToProcessingQueue(
  listener:
    ProcessingQueueEventListener,
  filter?:
    ProcessingQueueEventFilter
): ProcessingQueueEventSubscription {
  return getDefaultProcessingQueueEventBus()
    .subscribe(
      listener,
      filter
    );
}

export function subscribeToProcessingJob(
  jobId:
    ProcessingJobId,
  listener:
    ProcessingQueueEventListener
): ProcessingQueueEventSubscription {
  return getDefaultProcessingQueueEventBus()
    .subscribeToJob(
      jobId,
      listener
    );
}

export function subscribeToProcessingBatch(
  batchId:
    ProcessingBatchId,
  listener:
    ProcessingQueueEventListener
): ProcessingQueueEventSubscription {
  return getDefaultProcessingQueueEventBus()
    .subscribeToBatch(
      batchId,
      listener
    );
}

export function subscribeToProcessingEventType(
  eventType:
    ProcessingQueueEventType,
  listener:
    ProcessingQueueEventListener
): ProcessingQueueEventSubscription {
  return getDefaultProcessingQueueEventBus()
    .subscribeToEventType(
      eventType,
      listener
    );
}

/* =========================================================
 * Convenience emission
 * ======================================================= */

export function emitProcessingQueueEvent(
  input:
    ProcessingQueueEventInput
): ProcessingQueueEvent {
  return getDefaultProcessingQueueEventBus()
    .emit(
      input
    );
}

export function getLatestProcessingQueueEvent():
  ProcessingQueueEvent | null {
  return getDefaultProcessingQueueEventBus()
    .getLatestEvent();
}

export function getLatestProcessingQueueSnapshot():
  ProcessingQueueSnapshot | null {
  return getDefaultProcessingQueueEventBus()
    .getLatestSnapshot();
}