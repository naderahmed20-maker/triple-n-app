// scan/core/native/NativeProcessingQueueAdapter.ts
// Part 1/3
//
// Triple N - Native Processing Queue Adapter
//
// هذا الملف يربط بين:
//
// - ProcessingQueue
// - NativeProcessingPayloadFactory
// - NativeProcessingBridge
// - NativeProcessingStorage
//
// المسؤوليات:
//
// 1) استقبال Queue Job من طبقة الـQueue.
// 2) تحويلها إلى NativeProcessingJobPayload.
// 3) إرسالها إلى NativeProcessingBridge.
// 4) تحويل Native Progress إلى تحديثات تفهمها الـQueue.
// 5) تحويل Native Result إلى نتيجة تنفيذ Queue.
// 6) دعم Recovery بعد رجوع JavaScript.
// 7) منع تشغيل أكثر من Native Job ثقيلة في الوقت نفسه.
// 8) الاحتفاظ بعلاقة Queue Job مع Native Job.
// 9) دعم الإلغاء والتنظيف.
// 10) عدم تشغيل EdgeSAM داخل JavaScript.
//
// هذا الملف لا:
// - ينفذ EdgeSAM.
// - يقرأ أو يكتب الصور.
// - يعدّل الماسك.
// - يحدّث Wardrobe مباشرة.
// - يخزن TypedArrays أو SegmentationResult.
// - يستبدل NativeProcessingQueueExecutor.
//
// NativeProcessingQueueExecutor يستخدم هذا الـAdapter
// لتنفيذ Job واحدة من ProcessingQueue.
//

import type {
  ProcessingJobErrorCode,
  ProcessingJobId,
  ProcessingJobStage,
  ProcessingJobStatus,
  ProcessingPlatform,
  ProcessingTimestamp,
} from '../queue/QueueTypes';

import {
  getNativeProcessingPayloadFactory
} from './NativeProcessingPayloadFactory';

import type {
  NativeProcessingPayloadFactory,
  NativeProcessingPayloadFactoryResult,
  NativeProcessingPayloadOptionsInput,
  NativeProcessingPayloadSourceInput,
  NativeProcessingPayloadWardrobeInput,
} from './NativeProcessingPayloadFactory';

import {
  getSharedNativeProcessingBridge,
} from './NativeProcessingBridge';

import type {
  NativeProcessingBridge,
  NativeProcessingBridgeAcknowledgementResult,
  NativeProcessingBridgeCancellationResult,
  NativeProcessingBridgeDiagnostics,
  NativeProcessingBridgeInitializeResult,
  NativeProcessingBridgeRecoveryResult,
} from './NativeProcessingBridge';

import type {
  NativeProcessingCapabilityResult,
  NativeProcessingError,
  NativeProcessingEvent,
  NativeProcessingEventType,
  NativeProcessingJobPayload,
  NativeProcessingJobResult,
  NativeProcessingPersistedRecord,
  NativeProcessingProgress,
  NativeProcessingRuntime,
  NativeProcessingScheduleResult
} from './NativeProcessingContracts';

/* =========================================================
 * Adapter state
 * ======================================================= */

export type NativeProcessingQueueAdapterState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'scheduling'
  | 'waiting'
  | 'recovering'
  | 'cancelling'
  | 'disposing'
  | 'disposed'
  | 'failed';

/* =========================================================
 * Clock
 * ======================================================= */

export type NativeProcessingQueueAdapterClock = {
  now():
    number;
};

/* =========================================================
 * Queue cancellation signal
 * ======================================================= */

/**
 * عقد صغير متوافق مع Cancellation Signals المستخدمة
 * في ProcessingQueue بدون ربط الملف بتنفيذ محدد.
 */
export type NativeProcessingQueueCancellationSignal = {
  readonly cancelled?:
    boolean;

  readonly isCancelled?:
    boolean;

  readonly reason?:
    string | null;

  throwIfCancelled?():
    void;

  subscribe?(
    listener:
      (
        reason?:
          string
      ) => void
  ):
    (() => void) |
    {
      remove():
        void;
    };
};

/* =========================================================
 * Queue progress callback
 * ======================================================= */

export type NativeProcessingQueueProgressUpdate = {
  jobId:
    ProcessingJobId;

  status:
    ProcessingJobStatus;

  stage:
    ProcessingJobStage;

  progress:
    number;

  percentage:
    number;

  message:
    string;

  startedAt:
    ProcessingTimestamp | null;

  updatedAt:
    ProcessingTimestamp;

  elapsedMs:
    number;

  estimatedRemainingMs:
    number | null;

  nativeTaskId:
    string | null;

  runtime:
    NativeProcessingRuntime;

  attempt:
    number;
};

export type NativeProcessingQueueProgressCallback =
  (
    update:
      NativeProcessingQueueProgressUpdate
  ) => void | Promise<void>;

/* =========================================================
 * Queue execution request
 * ======================================================= */

/**
 * job يتم استقباله كـunknown عمدًا.
 *
 * NativeProcessingPayloadFactory هو المسؤول عن قراءة
 * البنية الفعلية لـProcessingJob والتحقق منها.
 *
 * بهذه الطريقة لا نكرر عقد ProcessingJob داخل الملف.
 */
export type NativeProcessingQueueExecutionRequest = {
  job:
    unknown;

  jobId?:
    ProcessingJobId | string | null;

  queueId?:
    string | null;

  batchId?:
    string | null;

  requestId?:
    string | null;

  wardrobeItemId?:
    string | null;

  platform?:
    ProcessingPlatform | null;

  priority?:
    number | null;

  source?:
    Partial<
      NativeProcessingPayloadSourceInput
    > | null;

  wardrobe?:
    NativeProcessingPayloadWardrobeInput | null;

  options?:
    NativeProcessingPayloadOptionsInput | null;

  metadata?:
    Readonly<
      Record<
        string,
        unknown
      >
    > | null;

  createdAt?:
    number | null;

  startImmediately?:
    boolean;

  persistBeforeScheduling?:
    boolean;

  cancellationSignal?:
    NativeProcessingQueueCancellationSignal | null;

  onProgress?:
    NativeProcessingQueueProgressCallback | null;
};

/* =========================================================
 * Queue execution output
 * ======================================================= */

export type NativeProcessingQueueExecutionOutput = {
  processedImageUri:
    string;

  width:
    number;

  height:
    number;

  format:
    'png';

  fileSizeBytes:
    number | null;

  foregroundRatio:
    number | null;

  processingDurationMs:
    number;

  completedAt:
    ProcessingTimestamp;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Queue execution result
 * ======================================================= */

export type NativeProcessingQueueExecutionResult = {
  jobId:
    ProcessingJobId;

  accepted:
    boolean;

  succeeded:
    boolean;

  cancelled:
    boolean;

  expired:
    boolean;

  interrupted:
    boolean;

  runtime:
    NativeProcessingRuntime;

  nativeTaskId:
    string | null;

  scheduledAt:
    ProcessingTimestamp | null;

  startedAt:
    ProcessingTimestamp | null;

  completedAt:
    ProcessingTimestamp;

  attempt:
    number;

  output:
    NativeProcessingQueueExecutionOutput | null;

  result:
    NativeProcessingJobResult | null;

  error:
    NativeProcessingError | null;
};

/* =========================================================
 * Scheduling result
 * ======================================================= */

export type NativeProcessingQueueAdapterScheduleResult = {
  payload:
    NativeProcessingJobPayload;

  factoryResult:
    NativeProcessingPayloadFactoryResult;

  scheduleResult:
    NativeProcessingScheduleResult;

  record:
    NativeProcessingPersistedRecord | null;
};

/* =========================================================
 * Recovery result
 * ======================================================= */

export type NativeProcessingQueueAdapterRecoveryResult = {
  recovered:
    readonly NativeProcessingPersistedRecord[];

  pendingResults:
    readonly NativeProcessingJobResult[];

  missingNativeJobIds:
    readonly ProcessingJobId[];

  activeJobId:
    ProcessingJobId | null;

  warnings:
    readonly string[];

  recoveredAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Adapter event
 * ======================================================= */

export type NativeProcessingQueueAdapterEvent = {
  type:
    NativeProcessingEventType;

  jobId:
    ProcessingJobId;

  timestamp:
    ProcessingTimestamp;

  progress:
    NativeProcessingProgress | null;

  result:
    NativeProcessingJobResult | null;

  error:
    NativeProcessingError | null;

  nativeEvent:
    NativeProcessingEvent;
};

export type NativeProcessingQueueAdapterEventListener =
  (
    event:
      NativeProcessingQueueAdapterEvent
  ) => void;

/* =========================================================
 * Adapter options
 * ======================================================= */

export type NativeProcessingQueueAdapterOptions = {
  bridge?:
    NativeProcessingBridge;

  payloadFactory?:
    NativeProcessingPayloadFactory;

  clock?:
    NativeProcessingQueueAdapterClock;

  platform?:
    ProcessingPlatform;

  defaultStartImmediately?:
    boolean;

  defaultPersistBeforeScheduling?:
    boolean;

  acknowledgeSuccessfulResults?:
    boolean;

  acknowledgeFailedResults?:
    boolean;

  removeListenersAfterTerminalResult?:
    boolean;

  maximumExecutionWaitMs?:
    number;

  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Normalized options
 * ======================================================= */

type NormalizedNativeProcessingQueueAdapterOptions = {
  bridge:
    NativeProcessingBridge;

  payloadFactory:
    NativeProcessingPayloadFactory;

  clock:
    NativeProcessingQueueAdapterClock;

  platform:
    ProcessingPlatform;

  defaultStartImmediately:
    boolean;

  defaultPersistBeforeScheduling:
    boolean;

  acknowledgeSuccessfulResults:
    boolean;

  acknowledgeFailedResults:
    boolean;

  removeListenersAfterTerminalResult:
    boolean;

  maximumExecutionWaitMs:
    number;

  enableDebugLogs:
    boolean;
};

/* =========================================================
 * Active execution
 * ======================================================= */

type ActiveNativeProcessingExecution = {
  jobId:
    ProcessingJobId;

  payload:
    NativeProcessingJobPayload;

  scheduleResult:
    NativeProcessingScheduleResult;

  startedAt:
    ProcessingTimestamp;

  lastProgress:
    NativeProcessingProgress | null;

  cancellationRequested:
    boolean;

  settled:
    boolean;

  unsubscribeCancellation:
    (() => void) | null;

    timeoutTimer:
  ReturnType<
    typeof setTimeout
  > | null;

  resolve:
    (
      result:
        NativeProcessingQueueExecutionResult
    ) => void;

  reject:
    (
      error:
        Error
    ) => void;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type NativeProcessingQueueAdapterDiagnostics = {
  state:
    NativeProcessingQueueAdapterState;

  initialized:
    boolean;

  disposed:
    boolean;

  platform:
    ProcessingPlatform;

  activeJobId:
    ProcessingJobId | null;

  listenerCount:
    number;

  initializeCount:
    number;

  scheduleCount:
    number;

  acceptedScheduleCount:
    number;

  rejectedScheduleCount:
    number;

  executionCount:
    number;

  successfulExecutionCount:
    number;

  failedExecutionCount:
    number;

  cancelledExecutionCount:
    number;

  expiredExecutionCount:
    number;

  interruptedExecutionCount:
    number;

  progressEventCount:
    number;

  ignoredEventCount:
    number;

  recoveryCount:
    number;

  cancellationCount:
    number;

  acknowledgementCount:
    number;

  lastInitializedAt:
    ProcessingTimestamp | null;

  lastScheduledAt:
    ProcessingTimestamp | null;

  lastCompletedAt:
    ProcessingTimestamp | null;

  lastRecoveredAt:
    ProcessingTimestamp | null;

  lastOperationAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;

  bridge:
    NativeProcessingBridgeDiagnostics;
};

/* =========================================================
 * Errors
 * ======================================================= */

export class NativeProcessingQueueAdapterError
  extends Error {
  public readonly code:
    ProcessingJobErrorCode;

  public readonly jobId:
    ProcessingJobId | null;

  public readonly nativeError:
    NativeProcessingError | null;

  public constructor(
    code:
      ProcessingJobErrorCode,
    message:
      string,
    jobId:
      ProcessingJobId | null =
        null,
    nativeError:
      NativeProcessingError | null =
        null
  ) {
    super(
      message
    );

    this.name =
      'NativeProcessingQueueAdapterError';

    this.code =
      code;

    this.jobId =
      jobId;

    this.nativeError =
      nativeError;

    Object.setPrototypeOf(
      this,
      NativeProcessingQueueAdapterError
        .prototype
    );
  }
}

/* =========================================================
 * General helpers
 * ======================================================= */

function defaultNow():
  number {
  return Date.now();
}

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof
      Error
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
    // نستخدم String كحل أخير.
  }

  return String(
    error
  );
}

function normalizeTimestamp(
  value:
    number
): ProcessingTimestamp {
  if (
    !Number.isFinite(
      value
    ) ||
    value <=
      0
  ) {
    return Date.now();
  }

  return Math.floor(
    value
  );
}

function normalizePositiveDuration(
  value:
    number | null | undefined,
  fallback:
    number
): number {
  if (
    typeof value !==
      'number' ||
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

function resolvePlatform(
  platform:
    ProcessingPlatform | null | undefined
): ProcessingPlatform {
  if (
    platform ===
      'ios' ||
    platform ===
      'android'
  ) {
    return platform;
  }

  return 'unknown';
}

function isTerminalEventType(
  type:
    NativeProcessingEventType
): boolean {
  return (
    type ===
      'completed' ||
    type ===
      'failed' ||
    type ===
      'cancelled' ||
    type ===
      'expired' ||
    type ===
      'interrupted'
  );
}

function isTerminalResult(
  result:
    NativeProcessingJobResult | null
): result is NativeProcessingJobResult {
  return result !==
    null;
}

function createQueueProgressUpdate(
  progress:
    NativeProcessingProgress
): NativeProcessingQueueProgressUpdate {
  return {
    jobId:
      progress.jobId,

    status:
      progress.status,

    stage:
      progress.stage,

    progress:
      progress.progress,

    percentage:
      progress.percentage,

    message:
      progress.message,

    startedAt:
      progress.startedAt,

    updatedAt:
      progress.updatedAt,

    elapsedMs:
      progress.elapsedMs,

    estimatedRemainingMs:
      progress.estimatedRemainingMs,

    nativeTaskId:
      progress.nativeTaskId,

    runtime:
      progress.runtime,

    attempt:
      progress.attempt,
  };
}

/* =========================================================
 * Option normalization
 * ======================================================= */

function normalizeAdapterOptions(
  options:
    NativeProcessingQueueAdapterOptions
): NormalizedNativeProcessingQueueAdapterOptions {
  return {
    bridge:
      options.bridge ??
      getSharedNativeProcessingBridge(),

    payloadFactory:
      options.payloadFactory ??
      getNativeProcessingPayloadFactory(),

    clock:
      options.clock ?? {
        now:
          defaultNow,
      },

    platform:
      resolvePlatform(
        options.platform
      ),

    defaultStartImmediately:
      options
        .defaultStartImmediately ??
      true,

    defaultPersistBeforeScheduling:
      options
        .defaultPersistBeforeScheduling ??
      true,

    acknowledgeSuccessfulResults:
      options
        .acknowledgeSuccessfulResults ??
      true,

    acknowledgeFailedResults:
      options
        .acknowledgeFailedResults ??
      false,

    removeListenersAfterTerminalResult:
      options
        .removeListenersAfterTerminalResult ??
      true,

    maximumExecutionWaitMs:
      normalizePositiveDuration(
        options.maximumExecutionWaitMs,
        30 *
        60 *
        1000
      ),

    enableDebugLogs:
      options.enableDebugLogs ??
      false,
  };
}

/* =========================================================
 * Adapter
 * ======================================================= */

export class NativeProcessingQueueAdapter {
  private readonly options:
    NormalizedNativeProcessingQueueAdapterOptions;

  private state:
    NativeProcessingQueueAdapterState =
      'uninitialized';

  private initialized =
    false;

  private disposed =
    false;

  private initializePromise:
    Promise<
      NativeProcessingBridgeInitializeResult
    > | null =
      null;

  private recoveryPromise:
    Promise<
      NativeProcessingQueueAdapterRecoveryResult
    > | null =
      null;

  private disposePromise:
    Promise<void> | null =
      null;

  private bridgeUnsubscribe:
    (() => void) | null =
      null;

  private activeExecution:
    ActiveNativeProcessingExecution | null =
      null;

      private currentProgressCallback:
    NativeProcessingQueueProgressCallback | null =
      null;

  private latestCapability:
    NativeProcessingCapabilityResult | null =
      null;

  private latestRecordByJobId =
    new Map<
      ProcessingJobId,
      NativeProcessingPersistedRecord
    >();

  private eventListeners =
    new Set<
      NativeProcessingQueueAdapterEventListener
    >();

  private operationTail:
    Promise<void> =
      Promise.resolve();

  private diagnostics:
    NativeProcessingQueueAdapterDiagnostics;

  public constructor(
    options:
      NativeProcessingQueueAdapterOptions =
        {}
  ) {
    this.options =
      normalizeAdapterOptions(
        options
      );

    const bridgeDiagnostics =
      this.options
        .bridge
        .getDiagnostics();

    this.diagnostics = {
      state:
        'uninitialized',

      initialized:
        false,

      disposed:
        false,

      platform:
        this.options
          .platform,

      activeJobId:
        null,

      listenerCount:
        0,

      initializeCount:
        0,

      scheduleCount:
        0,

      acceptedScheduleCount:
        0,

      rejectedScheduleCount:
        0,

      executionCount:
        0,

      successfulExecutionCount:
        0,

      failedExecutionCount:
        0,

      cancelledExecutionCount:
        0,

      expiredExecutionCount:
        0,

      interruptedExecutionCount:
        0,

      progressEventCount:
        0,

      ignoredEventCount:
        0,

      recoveryCount:
        0,

      cancellationCount:
        0,

      acknowledgementCount:
        0,

      lastInitializedAt:
        null,

      lastScheduledAt:
        null,

      lastCompletedAt:
        null,

      lastRecoveredAt:
        null,

      lastOperationAt:
        null,

      lastError:
        null,

      bridge:
        bridgeDiagnostics,
    };
  }

  /* =======================================================
   * Time
   * ===================================================== */

  private now():
    ProcessingTimestamp {
    return normalizeTimestamp(
      this.options
        .clock
        .now()
    );
  }

  /* =======================================================
   * Initialization
   * ===================================================== */

  public initialize():
    Promise<
      NativeProcessingBridgeInitializeResult
    > {
    this.assertNotDisposed();

    if (
      this.initialized
    ) {
      return Promise.resolve({
        initialized:
          true,

        available:
          this.latestCapability
            ?.status ===
          'available',

        capability:
          this.latestCapability ??
          this.createFallbackCapability(),

        restoredRecordCount:
          this.latestRecordByJobId
            .size,

        pendingResultCount:
          Array.from(
            this.latestRecordByJobId
              .values()
          ).filter(
            record =>
              record.result !==
              null
          ).length,

        warnings:
          [],
      });
    }

    if (
      this.initializePromise
    ) {
      return this.initializePromise;
    }

    this.initializePromise =
      this.initializeInternal()
        .finally(
          () => {
            this.initializePromise =
              null;
          }
        );

    return this.initializePromise;
  }

  private async initializeInternal():
    Promise<
      NativeProcessingBridgeInitializeResult
    > {
    this.assertNotDisposed();

    const startedAt =
      this.now();

    this.state =
      'initializing';

    this.updateDiagnostics({
      state:
        'initializing',

      initializeCount:
        this.diagnostics
          .initializeCount +
        1,

      lastOperationAt:
        startedAt,

      lastError:
        null,
    });

    try {
      const initialization =
        await this.options
          .bridge
          .initialize();

      this.latestCapability =
        initialization
          .capability;

      this.attachBridgeListener();

      const recovered =
        await this.options
          .bridge
          .recover();

      for (
        const record of
        recovered.recovered
      ) {
        this.latestRecordByJobId
          .set(
            record.payload.jobId,
            record
          );
      }

      this.initialized =
        true;

      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        initialized:
          true,

        listenerCount:
          this.eventListeners
            .size,

        lastInitializedAt:
          this.now(),

        lastOperationAt:
          this.now(),

        lastError:
          null,
      });

      return {
        ...initialization,

        restoredRecordCount:
          Math.max(
            initialization
              .restoredRecordCount,
            recovered
              .recovered
              .length
          ),

        pendingResultCount:
          Math.max(
            initialization
              .pendingResultCount,
            recovered
              .pendingResults
              .length
          ),

        warnings: [
          ...initialization
            .warnings,
          ...recovered
            .warnings,
        ],
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.state =
        'failed';

      this.updateDiagnostics({
        state:
          'failed',

        initialized:
          false,

        lastOperationAt:
          this.now(),

        lastError:
          message,
      });

      throw new NativeProcessingQueueAdapterError(
        'BACKGROUND_PROCESSING_INITIALIZATION_FAILED' as
          ProcessingJobErrorCode,
        message
      );
    }
  }

  /* =======================================================
   * Fallback capability
   * ===================================================== */

  private createFallbackCapability():
    NativeProcessingCapabilityResult {
    return {
      platform:
        this.options
          .platform,

      status:
        'unknown',

      runtime:
        'unknown',

      supportsLockedScreenExecution:
        false,

      supportsTerminatedAppExecution:
        false,

      supportsProgressUpdates:
        false,

      supportsCancellation:
        false,

      maximumConcurrentJobs:
        1,

      reason:
        'Native processing queue adapter has not completed capability discovery.',

      checkedAt:
        this.now(),
    };
  }

  /*
   * Part 2/3 continues inside this class with:
   *
   * - attachBridgeListener()
   * - subscribe()
   * - handleNativeEvent()
   * - progress forwarding
   * - schedule()
   * - execute()
   * - wait for terminal Native result
   */
  /* =======================================================
   * Bridge listener
   * ===================================================== */

  private attachBridgeListener():
    void {
    if (
      this.bridgeUnsubscribe
    ) {
      return;
    }

    this.bridgeUnsubscribe =
      this.options
        .bridge
        .subscribe(
          event => {
            void this.enqueueOperation(
              async () => {
                await this.handleNativeEvent(
                  event
                );
              }
            );
          }
        );
  }

  /* =======================================================
   * Public event subscription
   * ===================================================== */

  public subscribe(
    listener:
      NativeProcessingQueueAdapterEventListener
  ): () => void {
    this.assertNotDisposed();

    this.eventListeners.add(
      listener
    );

    this.updateDiagnostics({
      listenerCount:
        this.eventListeners
          .size,

      lastOperationAt:
        this.now(),
    });

    let active =
      true;

    return () => {
      if (
        !active
      ) {
        return;
      }

      active =
        false;

      this.eventListeners.delete(
        listener
      );

      this.updateDiagnostics({
        listenerCount:
          this.eventListeners
            .size,

        lastOperationAt:
          this.now(),
      });
    };
  }

  /* =======================================================
   * Native event handling
   * ===================================================== */

  private async handleNativeEvent(
    event:
      NativeProcessingEvent
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    const timestamp =
      this.now();

    const adapterEvent:
      NativeProcessingQueueAdapterEvent = {
      type:
        event.type,

      jobId:
        event.jobId,

      timestamp:
        event.timestamp,

      progress:
        event.progress,

      result:
        event.result,

      error:
        event.error,

      nativeEvent:
        event,
    };

    if (
      event.progress
    ) {
      await this.forwardProgress(
        event.progress
      );

      this.updateDiagnostics({
        progressEventCount:
          this.diagnostics
            .progressEventCount +
        1,
      });
    }

    const refreshedRecord =
      await this.options
        .bridge
        .getJobRecord(
          event.jobId,
          false
        );

    if (
      refreshedRecord
    ) {
      this.latestRecordByJobId
        .set(
          event.jobId,
          refreshedRecord
        );
    }

    const execution =
      this.activeExecution;

    if (
      !execution ||
      execution.jobId !==
        event.jobId
    ) {
      this.updateDiagnostics({
        ignoredEventCount:
          this.diagnostics
            .ignoredEventCount +
        1,

        lastOperationAt:
          timestamp,

        lastError:
          event.error
            ?.message ??
          null,
      });

      this.emitAdapterEvent(
        adapterEvent
      );

      return;
    }

    if (
      event.progress
    ) {
      execution.lastProgress =
        event.progress;
    }

    this.emitAdapterEvent(
      adapterEvent
    );

    if (
      !isTerminalEventType(
        event.type
      )
    ) {
      this.updateDiagnostics({
        lastOperationAt:
          timestamp,

        lastError:
          null,
      });

      return;
    }

    if (
      execution.settled
    ) {
      return;
    }

    execution.settled =
      true;

    const result =
      event.result ??
      refreshedRecord
        ?.result ??
      null;

    const executionResult =
      this.createExecutionResult(
        execution,
        result,
        event.error,
        event.type
      );

    await this.finishActiveExecution(
      execution,
      executionResult
    );
  }

  /* =======================================================
   * Progress forwarding
   * ===================================================== */

  private async forwardProgress(
    progress:
      NativeProcessingProgress
  ): Promise<void> {
    const execution =
      this.activeExecution;

    if (
      !execution ||
      execution.jobId !==
        progress.jobId
    ) {
      return;
    }

    execution.lastProgress =
      progress;

    const callback =
      this.currentProgressCallback;

    if (
      !callback
    ) {
      return;
    }

    try {
      await callback(
        createQueueProgressUpdate(
          progress
        )
      );
    } catch (error) {
      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE QUEUE PROGRESS CALLBACK ERROR:',
          error
        );
      }
    }
  }

  /* =======================================================
   * Adapter event dispatch
   * ===================================================== */

  private emitAdapterEvent(
    event:
      NativeProcessingQueueAdapterEvent
  ): void {
    for (
      const listener of
      Array.from(
        this.eventListeners
      )
    ) {
      try {
        listener(
          event
        );
      } catch (error) {
        if (
          this.options
            .enableDebugLogs
        ) {
          console.warn(
            'TRIPLE N NATIVE QUEUE ADAPTER LISTENER ERROR:',
            error
          );
        }
      }
    }
  }

  /* =======================================================
   * Scheduling
   * ===================================================== */

  public async schedule(
    request:
      NativeProcessingQueueExecutionRequest
  ): Promise<
    NativeProcessingQueueAdapterScheduleResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    const timestamp =
      this.now();

    this.state =
      'scheduling';

    this.updateDiagnostics({
      state:
        'scheduling',

      scheduleCount:
        this.diagnostics
          .scheduleCount +
        1,

      lastOperationAt:
        timestamp,

      lastError:
        null,
    });

    try {
      const factoryResult =
        this.options
          .payloadFactory
          .createFromQueueJob(
            request.job,
            {
              queueId:
                request.queueId,

              batchId:
                request.batchId,

              requestId:
                request.requestId,

              wardrobeItemId:
                request.wardrobeItemId,

              platform:
                request.platform ??
                (
                  this.options
                    .platform ===
                    'unknown'
                    ? null
                    : this.options
                        .platform
                ),

              priority:
                request.priority,

              source:
                request.source,

              wardrobe:
                request.wardrobe,

              options:
                request.options,

              metadata:
                request.metadata,

              createdAt:
                request.createdAt,
            }
          );

      const payload =
        factoryResult.payload;

      if (
        request.jobId &&
        String(
          request.jobId
        ).trim() !==
          payload.jobId
      ) {
        throw new NativeProcessingQueueAdapterError(
          'INVALID_QUEUE_JOB' as
            ProcessingJobErrorCode,
          `Queue job ID "${String(
            request.jobId
          )}" does not match payload job ID "${payload.jobId}".`,
          payload.jobId
        );
      }

      const scheduleResult =
        await this.options
          .bridge
          .schedule({
            payload,

            startImmediately:
              request.startImmediately ??
              this.options
                .defaultStartImmediately,

            persistBeforeScheduling:
              request
                .persistBeforeScheduling ??
              this.options
                .defaultPersistBeforeScheduling,
          });

      const record =
        await this.options
          .bridge
          .getJobRecord(
            payload.jobId,
            false
          );

      if (
        record
      ) {
        this.latestRecordByJobId
          .set(
            payload.jobId,
            record
          );
      }

      if (
        scheduleResult.accepted
      ) {
        this.state =
          'waiting';

        this.updateDiagnostics({
          state:
            'waiting',

          acceptedScheduleCount:
            this.diagnostics
              .acceptedScheduleCount +
          1,

          activeJobId:
            payload.jobId,

          lastScheduledAt:
            scheduleResult
              .scheduledAt ??
            this.now(),

          lastOperationAt:
            this.now(),

          lastError:
            null,
        });
      } else {
        this.state =
          'ready';

        this.updateDiagnostics({
          state:
            'ready',

          rejectedScheduleCount:
            this.diagnostics
              .rejectedScheduleCount +
          1,

          activeJobId:
            null,

          lastOperationAt:
            this.now(),

          lastError:
            scheduleResult
              .error
              ?.message ??
            'Native processing rejected the queue job.',
        });
      }

      return {
        payload,

        factoryResult,

        scheduleResult,

        record,
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.state =
        'failed';

      this.updateDiagnostics({
        state:
          'failed',

        rejectedScheduleCount:
          this.diagnostics
            .rejectedScheduleCount +
        1,

        activeJobId:
          null,

        lastOperationAt:
          this.now(),

        lastError:
          message,
      });

      if (
        error instanceof
          NativeProcessingQueueAdapterError
      ) {
        throw error;
      }

      throw new NativeProcessingQueueAdapterError(
        'BACKGROUND_PROCESSING_START_FAILED' as
          ProcessingJobErrorCode,
        message
      );
    }
  }

  /* =======================================================
   * Execute queue job
   * ===================================================== */

  public async execute(
    request:
      NativeProcessingQueueExecutionRequest
  ): Promise<
    NativeProcessingQueueExecutionResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    if (
      this.activeExecution
    ) {
      throw new NativeProcessingQueueAdapterError(
        'JOB_ALREADY_RUNNING' as
          ProcessingJobErrorCode,
        `Native processing job "${this.activeExecution.jobId}" is already active.`,
        this.activeExecution
          .jobId
      );
    }

    this.throwIfCancellationRequested(
      request.cancellationSignal
    );

    const scheduled =
      await this.schedule(
        request
      );

    const {
      payload,
      scheduleResult,
    } =
      scheduled;

    if (
      !scheduleResult.accepted
    ) {
      return this.createRejectedExecutionResult(
        payload,
        scheduleResult
      );
    }

    this.state =
      'waiting';

    this.currentProgressCallback =
      request.onProgress ??
      null;

    this.updateDiagnostics({
      state:
        'waiting',

      executionCount:
        this.diagnostics
          .executionCount +
      1,

      activeJobId:
        payload.jobId,

      lastOperationAt:
        this.now(),

      lastError:
        null,
    });

    return new Promise<
      NativeProcessingQueueExecutionResult
    >(
      (
        resolve,
        reject
      ) => {
        const execution:
          ActiveNativeProcessingExecution = {
          jobId:
            payload.jobId,

          payload,

          scheduleResult,

          startedAt:
            this.now(),

          lastProgress:
            scheduled
              .record
              ?.progress ??
            null,

          cancellationRequested:
            false,

          settled:
            false,

          unsubscribeCancellation:
            null,

          timeoutTimer:
            null,

          resolve,

          reject,
        };

        this.activeExecution =
          execution;

        execution.unsubscribeCancellation =
          this.attachCancellationSignal(
            request
              .cancellationSignal,
            payload.jobId
          );

        this.startExecutionTimeout(
          execution
        );

        void this.checkImmediateTerminalRecord(
          execution
        );
      }
    );
  }

  /* =======================================================
   * Immediate terminal-state check
   * ===================================================== */

  private async checkImmediateTerminalRecord(
    execution:
      ActiveNativeProcessingExecution
  ): Promise<void> {
    try {
      const record =
        await this.options
          .bridge
          .getJobRecord(
            execution.jobId,
            true
          );

      if (
        !record
      ) {
        return;
      }

      this.latestRecordByJobId
        .set(
          execution.jobId,
          record
        );

      if (
        !isTerminalResult(
          record.result
        ) ||
        execution.settled
      ) {
        return;
      }

      execution.settled =
        true;

      const eventType =
        this.resolveResultEventType(
          record.result
        );

      const executionResult =
        this.createExecutionResult(
          execution,
          record.result,
          record.result.error,
          eventType
        );

      await this.finishActiveExecution(
        execution,
        executionResult
      );
    } catch (error) {
      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE QUEUE IMMEDIATE STATE CHECK ERROR:',
          error
        );
      }
    }
  }

  /* =======================================================
   * Execution timeout
   * ===================================================== */

  private startExecutionTimeout(
  execution:
    ActiveNativeProcessingExecution
): void {
  const timeoutMs =
    this.options
      .maximumExecutionWaitMs;

  if (
    execution.timeoutTimer
  ) {
    clearTimeout(
      execution.timeoutTimer
    );
  }

  execution.timeoutTimer =
    setTimeout(
      () => {
        execution.timeoutTimer =
          null;

        if (
          this.disposed ||
          execution.settled ||
          this.activeExecution !==
            execution
        ) {
          return;
        }

        execution.settled =
          true;

        const completedAt =
          this.now();

        const timeoutError:
          NativeProcessingError = {
          code:
            'BACKGROUND_PROCESSING_TIMEOUT' as
              ProcessingJobErrorCode,

          message:
            'Native processing did not return a terminal result before the execution wait timeout.',

          source:
            'scheduler',

          retryable:
            true,

          occurredAt:
            completedAt,

          attempt:
            execution
              .payload
              .options
              .currentAttempt,

          stage:
            execution
              .lastProgress
              ?.stage ??
            'failed',

          nativeCode:
            null,

          metadata: {
            maximumExecutionWaitMs:
              timeoutMs,
          },
        };

        const result:
          NativeProcessingQueueExecutionResult = {
          jobId:
            execution.jobId,

          accepted:
            true,

          succeeded:
            false,

          cancelled:
            false,

          expired:
            false,

          interrupted:
            true,

          runtime:
            execution
              .scheduleResult
              .runtime,

          nativeTaskId:
            execution
              .scheduleResult
              .nativeTaskId,

          scheduledAt:
            execution
              .scheduleResult
              .scheduledAt,

          startedAt:
            execution
              .lastProgress
              ?.startedAt ??
            execution.startedAt,

          completedAt,

          attempt:
            execution
              .payload
              .options
              .currentAttempt,

          output:
            null,

          result:
            null,

          error:
            timeoutError,
        };

        void this.finishActiveExecution(
          execution,
          result
        );
      },
      timeoutMs
    );
}

  /* =======================================================
   * Cancellation signal
   * ===================================================== */

  private attachCancellationSignal(
    signal:
      NativeProcessingQueueCancellationSignal | null | undefined,
    jobId:
      ProcessingJobId
  ): (() => void) | null {
    if (
      !signal
    ) {
      return null;
    }

    const cancel =
      (
        reason?:
          string
      ) => {
        const execution =
          this.activeExecution;

        if (
          !execution ||
          execution.jobId !==
            jobId ||
          execution.settled ||
          execution.cancellationRequested
        ) {
          return;
        }

        execution.cancellationRequested =
          true;

        void this.cancel(
          jobId,
          reason ??
          signal.reason ??
          'Queue execution requested cancellation.'
        );
      };

    if (
      signal.cancelled ===
        true ||
      signal.isCancelled ===
        true
    ) {
      cancel(
        signal.reason ??
        undefined
      );

      return null;
    }

    if (
      !signal.subscribe
    ) {
      return null;
    }

    const subscription =
      signal.subscribe(
        cancel
      );

    if (
      typeof subscription ===
        'function'
    ) {
      return subscription;
    }

    if (
      subscription &&
      typeof subscription.remove ===
        'function'
    ) {
      return () => {
        subscription.remove();
      };
    }

    return null;
  }

  private throwIfCancellationRequested(
    signal:
      NativeProcessingQueueCancellationSignal | null | undefined
  ): void {
    if (
      !signal
    ) {
      return;
    }

    if (
      signal.throwIfCancelled
    ) {
      signal.throwIfCancelled();

      return;
    }

    if (
      signal.cancelled ===
        true ||
      signal.isCancelled ===
        true
    ) {
      throw new NativeProcessingQueueAdapterError(
        'JOB_CANCELLED' as
          ProcessingJobErrorCode,
        signal.reason ??
        'Queue execution was cancelled before native processing started.'
      );
    }
  }

  /* =======================================================
   * Result event mapping
   * ===================================================== */

  private resolveResultEventType(
    result:
      NativeProcessingJobResult
  ): NativeProcessingEventType {
    if (
      result.succeeded
    ) {
      return 'completed';
    }

    if (
      result.cancelled
    ) {
      return 'cancelled';
    }

    if (
      result.expired
    ) {
      return 'expired';
    }

    if (
      result.interrupted
    ) {
      return 'interrupted';
    }

    return 'failed';
  }

  /* =======================================================
   * Execution result creation
   * ===================================================== */

  private createExecutionResult(
    execution:
      ActiveNativeProcessingExecution,
    result:
      NativeProcessingJobResult | null,
    eventError:
      NativeProcessingError | null,
    eventType:
      NativeProcessingEventType
  ): NativeProcessingQueueExecutionResult {
    const completedAt =
      result
        ?.completedAt ??
      this.now();

    const output =
      result
        ?.output
        ? {
            processedImageUri:
              result
                .output
                .processedImageUri,

            width:
              result
                .output
                .width,

            height:
              result
                .output
                .height,

            format:
              'png' as const,

            fileSizeBytes:
              result
                .output
                .fileSizeBytes,

            foregroundRatio:
              result
                .output
                .foregroundRatio,

            processingDurationMs:
              result
                .output
                .processingDurationMs,

            completedAt:
              result
                .output
                .completedAt,

            metadata: {
              ...result
                .output
                .metadata,
            },
          }
        : null;

    const succeeded =
      result
        ?.succeeded ===
        true &&
      output !==
        null;

    return {
      jobId:
        execution.jobId,

      accepted:
        true,

      succeeded,

      cancelled:
        result
          ?.cancelled ??
        eventType ===
          'cancelled',

      expired:
        result
          ?.expired ??
        eventType ===
          'expired',

      interrupted:
        result
          ?.interrupted ??
        eventType ===
          'interrupted',

      runtime:
        result
          ?.runtime ??
        execution
          .scheduleResult
          .runtime,

      nativeTaskId:
        result
          ?.nativeTaskId ??
        execution
          .scheduleResult
          .nativeTaskId,

      scheduledAt:
        execution
          .scheduleResult
          .scheduledAt,

      startedAt:
        result
          ?.startedAt ??
        execution
          .lastProgress
          ?.startedAt ??
        execution
          .startedAt,

      completedAt,

      attempt:
        result
          ?.attempt ??
        execution
          .payload
          .options
          .currentAttempt,

      output,

      result,

      error:
        result
          ?.error ??
        eventError ??
        (
          succeeded
            ? null
            : this.createFallbackTerminalError(
                execution,
                eventType,
                completedAt
              )
        ),
    };
  }

  /* =======================================================
   * Rejected result creation
   * ===================================================== */

  private createRejectedExecutionResult(
    payload:
      NativeProcessingJobPayload,
    scheduleResult:
      NativeProcessingScheduleResult
  ): NativeProcessingQueueExecutionResult {
    const completedAt =
      this.now();

    return {
      jobId:
        payload.jobId,

      accepted:
        false,

      succeeded:
        false,

      cancelled:
        false,

      expired:
        false,

      interrupted:
        false,

      runtime:
        scheduleResult.runtime,

      nativeTaskId:
        scheduleResult.nativeTaskId,

      scheduledAt:
        scheduleResult.scheduledAt,

      startedAt:
        null,

      completedAt,

      attempt:
        payload
          .options
          .currentAttempt,

      output:
        null,

      result:
        null,

      error:
        scheduleResult.error ??
        {
          code:
            'BACKGROUND_PROCESSING_START_FAILED' as
              ProcessingJobErrorCode,

          message:
            'Native processing rejected the queue job.',

          source:
            'scheduler',

          retryable:
            true,

          occurredAt:
            completedAt,

          attempt:
            payload
              .options
              .currentAttempt,

          stage:
            'queued',

          nativeCode:
            null,

          metadata:
            {},
        },
    };
  }

  /* =======================================================
   * Fallback terminal error
   * ===================================================== */

  private createFallbackTerminalError(
    execution:
      ActiveNativeProcessingExecution,
    eventType:
      NativeProcessingEventType,
    timestamp:
      ProcessingTimestamp
  ): NativeProcessingError {
    let message =
      'Native processing failed.';

    let code =
      'UNKNOWN_QUEUE_ERROR' as
        ProcessingJobErrorCode;

    let source:
      NativeProcessingError[
        'source'
      ] =
        'unknown';

    if (
      eventType ===
        'cancelled'
    ) {
      message =
        'Native processing was cancelled.';

      code =
        'JOB_CANCELLED' as
          ProcessingJobErrorCode;

      source =
        'cancellation';
    } else if (
      eventType ===
        'expired'
    ) {
      message =
        'Native processing expired.';

      code =
        'BACKGROUND_PROCESSING_EXPIRED' as
          ProcessingJobErrorCode;

      source =
        'expiration';
    } else if (
      eventType ===
        'interrupted'
    ) {
      message =
        'Native processing was interrupted.';

      code =
        'BACKGROUND_PROCESSING_INTERRUPTED' as
          ProcessingJobErrorCode;
    }

    return {
      code,

      message,

      source,

      retryable:
        eventType !==
          'cancelled',

      occurredAt:
        timestamp,

      attempt:
        execution
          .payload
          .options
          .currentAttempt,

      stage:
        execution
          .lastProgress
          ?.stage ??
        'failed',

      nativeCode:
        null,

      metadata:
        {},
    };
  }

  /*
   * Part 3/3 continues inside this class with:
   *
   * - finishActiveExecution()
   * - result acknowledgement
   * - cancel()
   * - recover()
   * - diagnostics
   * - operation serialization
   * - dispose()
   * - guards
   * - shared instance
   * - final exports
   */

  /* =======================================================
   * Finish active execution
   * ===================================================== */

  private async finishActiveExecution(
    execution:
      ActiveNativeProcessingExecution,
    result:
      NativeProcessingQueueExecutionResult
  ): Promise<void> {
    if (
      this.activeExecution !==
        execution
    ) {
      return;
    }
       
    if (
  execution.timeoutTimer
) {
  clearTimeout(
    execution.timeoutTimer
  );

  execution.timeoutTimer =
    null;
}

    execution.unsubscribeCancellation
      ?.();

    execution.unsubscribeCancellation =
      null;

    this.activeExecution =
      null;

    this.currentProgressCallback =
      null;

    const completedAt =
      result.completedAt;

    if (
      result.succeeded
    ) {
      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        activeJobId:
          null,

        successfulExecutionCount:
          this.diagnostics
            .successfulExecutionCount +
          1,

        lastCompletedAt:
          completedAt,

        lastOperationAt:
          this.now(),

        lastError:
          null,
      });
    } else if (
      result.cancelled
    ) {
      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        activeJobId:
          null,

        cancelledExecutionCount:
          this.diagnostics
            .cancelledExecutionCount +
          1,

        lastCompletedAt:
          completedAt,

        lastOperationAt:
          this.now(),

        lastError:
          result.error
            ?.message ??
          'Native processing was cancelled.',
      });
    } else if (
      result.expired
    ) {
      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        activeJobId:
          null,

        expiredExecutionCount:
          this.diagnostics
            .expiredExecutionCount +
          1,

        lastCompletedAt:
          completedAt,

        lastOperationAt:
          this.now(),

        lastError:
          result.error
            ?.message ??
          'Native processing expired.',
      });
    } else if (
      result.interrupted
    ) {
      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        activeJobId:
          null,

        interruptedExecutionCount:
          this.diagnostics
            .interruptedExecutionCount +
          1,

        lastCompletedAt:
          completedAt,

        lastOperationAt:
          this.now(),

        lastError:
          result.error
            ?.message ??
          'Native processing was interrupted.',
      });
    } else {
      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        activeJobId:
          null,

        failedExecutionCount:
          this.diagnostics
            .failedExecutionCount +
          1,

        lastCompletedAt:
          completedAt,

        lastOperationAt:
          this.now(),

        lastError:
          result.error
            ?.message ??
          'Native processing failed.',
      });
    }

    if (
      result.result
    ) {
      const record =
        await this.options
          .bridge
          .getJobRecord(
            execution.jobId,
            false
          );

      if (
        record
      ) {
        this.latestRecordByJobId
          .set(
            execution.jobId,
            record
          );
      }
    }

    await this.acknowledgeTerminalResult(
      result
    );

    execution.resolve(
      result
    );
  }

  /* =======================================================
   * Result acknowledgement
   * ===================================================== */

  private async acknowledgeTerminalResult(
    result:
      NativeProcessingQueueExecutionResult
  ): Promise<
    NativeProcessingBridgeAcknowledgementResult | null
  > {
    const shouldAcknowledge =
      result.succeeded
        ? this.options
            .acknowledgeSuccessfulResults
        : this.options
            .acknowledgeFailedResults;

    if (
      !shouldAcknowledge ||
      !result.result
    ) {
      return null;
    }

    try {
      const acknowledgement =
        await this.options
          .bridge
          .acknowledgeResult(
            result.jobId
          );

      this.updateDiagnostics({
        acknowledgementCount:
          this.diagnostics
            .acknowledgementCount +
        1,

        lastOperationAt:
          this.now(),

        lastError:
          acknowledgement.error
            ?.message ??
          this.diagnostics
            .lastError,
      });

      if (
        acknowledgement
          .removedFromLocalStorage
      ) {
        this.latestRecordByJobId
          .delete(
            result.jobId
          );
      }

      return acknowledgement;
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.updateDiagnostics({
        acknowledgementCount:
          this.diagnostics
            .acknowledgementCount +
        1,

        lastOperationAt:
          this.now(),

        lastError:
          message,
      });

      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE QUEUE ACKNOWLEDGEMENT ERROR:',
          error
        );
      }

      return null;
    }
  }

  /* =======================================================
   * Cancellation
   * ===================================================== */

  public async cancel(
    jobId:
      ProcessingJobId,
    reason =
      'Native processing was cancelled.'
  ): Promise<
    NativeProcessingBridgeCancellationResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    const execution =
      this.activeExecution;

      if (
  execution?.timeoutTimer
) {
  clearTimeout(
    execution.timeoutTimer
  );

  execution.timeoutTimer =
    null;
}

    if (
      execution &&
      execution.jobId ===
        jobId
    ) {
      execution.cancellationRequested =
        true;
    }

    this.state =
      'cancelling';

    this.updateDiagnostics({
      state:
        'cancelling',

      cancellationCount:
        this.diagnostics
          .cancellationCount +
        1,

      lastOperationAt:
        this.now(),

      lastError:
        null,
    });

    try {
      const cancellation =
        await this.options
          .bridge
          .cancel(
            jobId,
            reason
          );

      const record =
        await this.options
          .bridge
          .getJobRecord(
            jobId,
            false
          );

      if (
        record
      ) {
        this.latestRecordByJobId
          .set(
            jobId,
            record
          );
      }

      if (
        execution &&
        execution.jobId ===
          jobId &&
        !execution.settled &&
        (
          cancellation.cancelled ||
          cancellation.result
        )
      ) {
        execution.settled =
          true;

        const result =
          cancellation.result;

        const executionResult =
          this.createExecutionResult(
            execution,
            result,
            cancellation.error,
            result
              ? this.resolveResultEventType(
                  result
                )
              : 'cancelled'
          );

        await this.finishActiveExecution(
          execution,
          executionResult
        );
      } else {
        this.state =
          this.activeExecution
            ? 'waiting'
            : 'ready';

        this.updateDiagnostics({
          state:
            this.state,

          activeJobId:
            this.activeExecution
              ?.jobId ??
            null,

          lastOperationAt:
            this.now(),

          lastError:
            cancellation.error
              ?.message ??
            null,
        });
      }

      return cancellation;
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.state =
        this.activeExecution
          ? 'waiting'
          : 'ready';

      this.updateDiagnostics({
        state:
          this.state,

        activeJobId:
          this.activeExecution
            ?.jobId ??
          null,

        lastOperationAt:
          this.now(),

        lastError:
          message,
      });

      throw new NativeProcessingQueueAdapterError(
        'JOB_CANCELLED' as
          ProcessingJobErrorCode,
        message,
        jobId
      );
    }
  }

  /* =======================================================
   * Recovery
   * ===================================================== */

  public recover():
    Promise<
      NativeProcessingQueueAdapterRecoveryResult
    > {
    this.assertNotDisposed();

    if (
      this.recoveryPromise
    ) {
      return this.recoveryPromise;
    }

    this.recoveryPromise =
      this.recoverInternal()
        .finally(
          () => {
            this.recoveryPromise =
              null;
          }
        );

    return this.recoveryPromise;
  }

  private async recoverInternal():
    Promise<
      NativeProcessingQueueAdapterRecoveryResult
    > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    const recoveredAt =
      this.now();

    this.state =
      'recovering';

    this.updateDiagnostics({
      state:
        'recovering',

      recoveryCount:
        this.diagnostics
          .recoveryCount +
        1,

      lastOperationAt:
        recoveredAt,

      lastError:
        null,
    });

    try {
      const bridgeRecovery:
        NativeProcessingBridgeRecoveryResult =
        await this.options
          .bridge
          .recover();

      this.latestRecordByJobId
        .clear();

      for (
        const record of
        bridgeRecovery.recovered
      ) {
        this.latestRecordByJobId
          .set(
            record.payload.jobId,
            record
          );
      }

      const bridgeDiagnostics =
        this.options
          .bridge
          .getDiagnostics();

      const activeJobId =
        bridgeDiagnostics
          .activeJobId;

      this.state =
        activeJobId
          ? 'waiting'
          : 'ready';

      this.updateDiagnostics({
        state:
          this.state,

        activeJobId,

        lastRecoveredAt:
          recoveredAt,

        lastOperationAt:
          this.now(),

        lastError:
          null,

        bridge:
          bridgeDiagnostics,
      });

      return {
        recovered:
          bridgeRecovery.recovered,

        pendingResults:
          bridgeRecovery.pendingResults,

        missingNativeJobIds:
          bridgeRecovery
            .missingNativeJobIds,

        activeJobId,

        warnings:
          bridgeRecovery.warnings,

        recoveredAt:
          bridgeRecovery.recoveredAt,
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.state =
        'failed';

      this.updateDiagnostics({
        state:
          'failed',

        lastOperationAt:
          this.now(),

        lastError:
          message,
      });

      throw new NativeProcessingQueueAdapterError(
        'BACKGROUND_PROCESSING_RECOVERY_FAILED' as
          ProcessingJobErrorCode,
        message
      );
    }
  }

  /* =======================================================
   * Records
   * ===================================================== */

  public async getRecord(
    jobId:
      ProcessingJobId,
    refreshFromNative =
      false
  ): Promise<
    NativeProcessingPersistedRecord | null
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    const record =
      await this.options
        .bridge
        .getJobRecord(
          jobId,
          refreshFromNative
        );

    if (
      record
    ) {
      this.latestRecordByJobId
        .set(
          jobId,
          record
        );

      return record;
    }

    return this.latestRecordByJobId
      .get(
        jobId
      ) ??
      null;
  }

  public getCachedRecords():
    readonly NativeProcessingPersistedRecord[] {
    return Array.from(
      this.latestRecordByJobId
        .values()
    );
  }

  /* =======================================================
   * Capability
   * ===================================================== */

  public async getCapability(
    forceRefresh =
      false
  ): Promise<
    NativeProcessingCapabilityResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    const capability =
      await this.options
        .bridge
        .getCapability(
          forceRefresh
        );

    this.latestCapability =
      capability;

    this.updateDiagnostics({
      lastOperationAt:
        this.now(),

      lastError:
        null,

      bridge:
        this.options
          .bridge
          .getDiagnostics(),
    });

    return {
      ...capability,
    };
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    NativeProcessingQueueAdapterDiagnostics {
    const bridgeDiagnostics =
      this.options
        .bridge
        .getDiagnostics();

    return {
      ...this.diagnostics,

      state:
        this.state,

      initialized:
        this.initialized,

      disposed:
        this.disposed,

      activeJobId:
        this.activeExecution
          ?.jobId ??
        this.diagnostics
          .activeJobId,

      listenerCount:
        this.eventListeners
          .size,

      bridge:
        bridgeDiagnostics,
    };
  }

  private updateDiagnostics(
    patch:
      Partial<
        NativeProcessingQueueAdapterDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...patch,

      initialized:
        patch.initialized ??
        this.initialized,

      disposed:
        patch.disposed ??
        this.disposed,

      bridge:
        patch.bridge ??
        this.options
          .bridge
          .getDiagnostics(),
    };
  }

  /* =======================================================
   * Operation serialization
   * ===================================================== */

  private enqueueOperation(
    operation:
      () => Promise<void>
  ): Promise<void> {
    const next =
      this.operationTail
        .catch(
          () => {
            // فشل العملية السابقة لا يمنع التالية.
          }
        )
        .then(
          operation
        );

    this.operationTail =
      next.catch(
        error => {
          if (
            this.options
              .enableDebugLogs
          ) {
            console.warn(
              'TRIPLE N NATIVE QUEUE SERIALIZED OPERATION ERROR:',
              error
            );
          }
        }
      );

    return next;
  }

  /* =======================================================
   * Disposal
   * ===================================================== */

  public dispose():
    Promise<void> {
    if (
      this.disposePromise
    ) {
      return this.disposePromise;
    }

    this.disposePromise =
      this.disposeInternal()
        .finally(
          () => {
            this.disposePromise =
              null;
          }
        );

    return this.disposePromise;
  }

  private async disposeInternal():
    Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    this.state =
      'disposing';

    this.updateDiagnostics({
      state:
        'disposing',

      lastOperationAt:
        this.now(),
    });

    const execution =
      this.activeExecution;

    if (
      execution &&
      !execution.settled
    ) {
      execution.cancellationRequested =
        true;

      try {
        await this.options
          .bridge
          .cancel(
            execution.jobId,
            'Native processing queue adapter was disposed.'
          );
      } catch {
        // نكمل التخلص حتى لو فشل الإلغاء.
      }

      if (
        !execution.settled
      ) {
        execution.settled =
          true;

        const completedAt =
          this.now();

        const disposalError:
          NativeProcessingError = {
          code:
            'BACKGROUND_PROCESSING_INTERRUPTED' as
              ProcessingJobErrorCode,

          message:
            'Native processing was interrupted because the queue adapter was disposed.',

          source:
            'cancellation',

          retryable:
            true,

          occurredAt:
            completedAt,

          attempt:
            execution
              .payload
              .options
              .currentAttempt,

          stage:
            execution
              .lastProgress
              ?.stage ??
            'failed',

          nativeCode:
            null,

          metadata:
            {},
        };

        execution.unsubscribeCancellation
          ?.();

        execution.unsubscribeCancellation =
          null;

        execution.resolve({
          jobId:
            execution.jobId,

          accepted:
            true,

          succeeded:
            false,

          cancelled:
            false,

          expired:
            false,

          interrupted:
            true,

          runtime:
            execution
              .scheduleResult
              .runtime,

          nativeTaskId:
            execution
              .scheduleResult
              .nativeTaskId,

          scheduledAt:
            execution
              .scheduleResult
              .scheduledAt,

          startedAt:
            execution
              .lastProgress
              ?.startedAt ??
            execution.startedAt,

          completedAt,

          attempt:
            execution
              .payload
              .options
              .currentAttempt,

          output:
            null,

          result:
            null,

          error:
            disposalError,
        });
      }
    }

    this.activeExecution =
      null;

    this.currentProgressCallback =
      null;

    if (
      this.bridgeUnsubscribe
    ) {
      try {
        this.bridgeUnsubscribe();
      } catch {
        // لا نرمي أثناء التخلص.
      }

      this.bridgeUnsubscribe =
        null;
    }

    this.eventListeners
      .clear();

    await this.operationTail
      .catch(
        () => {
          // لا نمنع التخلص بسبب Event سابق.
        }
      );

    this.latestRecordByJobId
      .clear();

    this.latestCapability =
      null;

    this.initialized =
      false;

    this.disposed =
      true;

    this.state =
      'disposed';

    this.updateDiagnostics({
      state:
        'disposed',

      initialized:
        false,

      disposed:
        true,

      activeJobId:
        null,

      listenerCount:
        0,

      lastOperationAt:
        this.now(),
    });
  }

  /* =======================================================
   * Guards
   * ===================================================== */

  private assertNotDisposed():
    void {
    if (
      this.disposed ||
      this.state ===
        'disposed' ||
      this.state ===
        'disposing'
    ) {
      throw new NativeProcessingQueueAdapterError(
        'BACKGROUND_PROCESSING_UNAVAILABLE' as
          ProcessingJobErrorCode,
        'Native processing queue adapter has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Shared adapter
 * ======================================================= */

let sharedNativeProcessingQueueAdapter:
  NativeProcessingQueueAdapter | null =
    null;

export function getNativeProcessingQueueAdapter(
  options:
    NativeProcessingQueueAdapterOptions =
      {}
): NativeProcessingQueueAdapter {
  if (
    !sharedNativeProcessingQueueAdapter
  ) {
    sharedNativeProcessingQueueAdapter =
      new NativeProcessingQueueAdapter(
        options
      );
  }

  return sharedNativeProcessingQueueAdapter;
}

/* =========================================================
 * Replace shared adapter
 * ======================================================= */

export function setSharedNativeProcessingQueueAdapter(
  adapter:
    NativeProcessingQueueAdapter | null
): void {
  sharedNativeProcessingQueueAdapter =
    adapter;
}

/* =========================================================
 * Initialize shared adapter
 * ======================================================= */

export async function initializeNativeProcessingQueueAdapter(
  options:
    NativeProcessingQueueAdapterOptions =
      {}
): Promise<
  NativeProcessingBridgeInitializeResult
> {
  return getNativeProcessingQueueAdapter(
    options
  ).initialize();
}

/* =========================================================
 * Execute through shared adapter
 * ======================================================= */

export async function executeNativeProcessingQueueJob(
  request:
    NativeProcessingQueueExecutionRequest
): Promise<
  NativeProcessingQueueExecutionResult
> {
  return getNativeProcessingQueueAdapter()
    .execute(
      request
    );
}

/* =========================================================
 * Recover shared adapter
 * ======================================================= */

export async function recoverNativeProcessingQueueAdapter():
  Promise<
    NativeProcessingQueueAdapterRecoveryResult
  > {
  return getNativeProcessingQueueAdapter()
    .recover();
}

/* =========================================================
 * Dispose shared adapter
 * ======================================================= */

export async function disposeNativeProcessingQueueAdapter():
  Promise<void> {
  const adapter =
    sharedNativeProcessingQueueAdapter;

  sharedNativeProcessingQueueAdapter =
    null;

  if (
    adapter
  ) {
    await adapter.dispose();
  }
}

/* =========================================================
 * Default export
 * ======================================================= */

export default
  NativeProcessingQueueAdapter;