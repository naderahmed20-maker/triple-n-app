// scan/core/native/NativeProcessingQueueExecutor.ts
// Part 1/3
//
// Triple N - Native Processing Queue Executor
//
// يربط ProcessingQueue بمحرك Native Processing.
//
// هذا الملف:
// - لا يشغّل EdgeSAM داخل JavaScript.
// - لا يمرر TypedArrays إلى Native.
// - لا يستخدم AsyncStorage مباشرة.
// - لا يحدّث Wardrobe مباشرة.
// - يسمح بـNative Job واحدة فقط في الوقت نفسه.

import type {
  ProcessingJob,
  ProcessingJobError,
  ProcessingJobErrorCode,
  ProcessingJobErrorSource,
  ProcessingJobExecutionResult,
  ProcessingJobId,
  ProcessingJobOutput,
  ProcessingJobStage,
  ProcessingProgress,
  ProcessingTimestamp,
} from '../queue/QueueTypes';

import {
  clampProcessingProgress,
  normalizeProcessingDuration,
  normalizeProcessingTimestamp,
} from '../queue/QueueTypes';

import {
  createNativeProcessingPayloadFromQueueJob,
} from './NativeProcessingPayloadFactory';

import type {
  NativeProcessingPayloadFactoryOptions,
} from './NativeProcessingPayloadFactory';

import {
  getSharedNativeProcessingBridge,
} from './NativeProcessingBridge';

import type {
  NativeProcessingBridge,
  NativeProcessingBridgeCancellationResult,
  NativeProcessingBridgeInitializeResult,
} from './NativeProcessingBridge';

import type {
  NativeProcessingError,
  NativeProcessingEvent,
  NativeProcessingJobPayload,
  NativeProcessingJobResult,
  NativeProcessingProgress,
  NativeProcessingRuntime,
  NativeProcessingScheduleResult,
} from './NativeProcessingContracts';

/* =========================================================
 * Constants
 * ======================================================= */

export const DEFAULT_NATIVE_EXECUTOR_RESULT_TIMEOUT_MS =
  30 * 60 * 1000;

export const DEFAULT_NATIVE_EXECUTOR_POLL_INTERVAL_MS =
  1_000;

export const DEFAULT_NATIVE_EXECUTOR_PROGRESS_THROTTLE_MS =
  100;

export const DEFAULT_NATIVE_EXECUTOR_RECOVERY_ATTEMPTS =
  3;

export const DEFAULT_NATIVE_EXECUTOR_RECOVERY_DELAY_MS =
  500;

/* =========================================================
 * State
 * ======================================================= */

export type NativeProcessingQueueExecutorState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'preparing'
  | 'scheduling'
  | 'waiting'
  | 'cancelling'
  | 'recovering'
  | 'completing'
  | 'failed'
  | 'disposing'
  | 'disposed';

/* =========================================================
 * Cancellation signal
 * ======================================================= */

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
    (() => void) | void;

  addEventListener?(
    eventName:
      'cancel',
    listener:
      (
        event?:
          unknown
      ) => void
  ):
    void;

  removeEventListener?(
    eventName:
      'cancel',
    listener:
      (
        event?:
          unknown
      ) => void
  ):
    void;
};

/* =========================================================
 * Progress update
 * ======================================================= */

export type NativeProcessingQueueProgressUpdate = {
  progress:
    ProcessingProgress;

  stage:
    ProcessingJobStage;

  message:
    string;

  estimatedRemainingMs?:
    number | null;
};

/* =========================================================
 * Execution context
 * ======================================================= */

export type NativeProcessingQueueExecutionContext = {
  queueId:
    string;

  jobId:
    ProcessingJobId;

  requestId:
    string;

  batchId:
    string;

  attempt:
    number;

  startedAt:
    ProcessingTimestamp;

  cancellationSignal:
    NativeProcessingQueueCancellationSignal;

  updateProgress(
    update:
      NativeProcessingQueueProgressUpdate
  ):
    void | Promise<void>;

  isApplicationInBackground():
    boolean;
};

export type NativeProcessingQueueExecutorFunction = (
  job:
    ProcessingJob,
  context:
    NativeProcessingQueueExecutionContext
) => Promise<
  ProcessingJobExecutionResult
>;

/* =========================================================
 * Clock and timer
 * ======================================================= */

export type NativeProcessingQueueExecutorClock = {
  now():
    number;
};

export type NativeProcessingQueueExecutorTimer = {
  setTimeout(
    callback:
      () => void,
    delayMs:
      number
  ):
    ReturnType<
      typeof setTimeout
    >;

  clearTimeout(
    timer:
      ReturnType<
        typeof setTimeout
      >
  ):
    void;
};

/* =========================================================
 * Options
 * ======================================================= */

export type NativeProcessingQueueExecutorOptions = {
  bridge?:
    NativeProcessingBridge;

  payloadOptions?:
    NativeProcessingPayloadFactoryOptions;

  clock?:
    NativeProcessingQueueExecutorClock;

  timer?:
    NativeProcessingQueueExecutorTimer;

  resultTimeoutMs?:
    number;

  pollIntervalMs?:
    number;

  progressThrottleMs?:
    number;

  maximumRecoveryAttempts?:
    number;

  recoveryDelayMs?:
    number;

  startImmediately?:
    boolean;

  persistBeforeScheduling?:
    boolean;

  acknowledgeResult?:
    boolean;

  autoInitialize?:
    boolean;

  enableDebugLogs?:
    boolean;
};

type NormalizedNativeProcessingQueueExecutorOptions = {
  bridge:
    NativeProcessingBridge;

  payloadOptions:
    NativeProcessingPayloadFactoryOptions;

  clock:
    NativeProcessingQueueExecutorClock;

  timer:
    NativeProcessingQueueExecutorTimer;

  resultTimeoutMs:
    number;

  pollIntervalMs:
    number;

  progressThrottleMs:
    number;

  maximumRecoveryAttempts:
    number;

  recoveryDelayMs:
    number;

  startImmediately:
    boolean;

  persistBeforeScheduling:
    boolean;

  acknowledgeResult:
    boolean;

  autoInitialize:
    boolean;

  enableDebugLogs:
    boolean;
};

/* =========================================================
 * Initialization result
 * ======================================================= */

export type NativeProcessingQueueExecutorInitializeResult = {
  initialized:
    boolean;

  available:
    boolean;

  bridge:
    NativeProcessingBridgeInitializeResult;

  initializedAt:
    ProcessingTimestamp;

  warnings:
    readonly string[];
};

/* =========================================================
 * Waiting job
 * ======================================================= */

type NativeProcessingWaitingJob = {
  job:
    ProcessingJob;

  payload:
    NativeProcessingJobPayload;

  context:
    NativeProcessingQueueExecutionContext;

  resolve:
    (
      result:
        NativeProcessingJobResult
    ) => void;

  reject:
    (
      error:
        unknown
    ) => void;

  settled:
    boolean;

  timeoutTimer:
    ReturnType<
      typeof setTimeout
    > | null;

  pollTimer:
    ReturnType<
      typeof setTimeout
    > | null;

  cancellationCleanup:
    (() => void) | null;

  createdAt:
    ProcessingTimestamp;

  lastProgressAt:
    ProcessingTimestamp | null;

  lastProgress:
    ProcessingProgress;

  recoveryAttempts:
    number;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type NativeProcessingQueueExecutorDiagnostics = {
  state:
    NativeProcessingQueueExecutorState;

  initialized:
    boolean;

  disposed:
    boolean;

  available:
    boolean;

  activeJobId:
    ProcessingJobId | null;

  waitingJobCount:
    number;

  initializeCount:
    number;

  executeCount:
    number;

  scheduleCount:
    number;

  acceptedScheduleCount:
    number;

  rejectedScheduleCount:
    number;

  completedCount:
    number;

  failedCount:
    number;

  cancelledCount:
    number;

  interruptedCount:
    number;

  expiredCount:
    number;

  progressEventCount:
    number;

  resultEventCount:
    number;

  ignoredEventCount:
    number;

  pollCount:
    number;

  timeoutCount:
    number;

  recoveryCount:
    number;

  recoveryFailureCount:
    number;

  acknowledgementCount:
    number;

  acknowledgementFailureCount:
    number;

  lastInitializedAt:
    ProcessingTimestamp | null;

  lastExecutionStartedAt:
    ProcessingTimestamp | null;

  lastExecutionCompletedAt:
    ProcessingTimestamp | null;

  lastEventAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;

  warnings:
    readonly string[];
};

/* =========================================================
 * Executor error
 * ======================================================= */

export type NativeProcessingQueueExecutorErrorCode =
  | 'EXECUTOR_DISPOSED'
  | 'EXECUTOR_UNAVAILABLE'
  | 'INVALID_JOB'
  | 'INVALID_CONTEXT'
  | 'JOB_ALREADY_RUNNING'
  | 'PAYLOAD_CREATION_FAILED'
  | 'SCHEDULE_REJECTED'
  | 'RESULT_TIMEOUT'
  | 'RESULT_NOT_FOUND'
  | 'CANCEL_FAILED'
  | 'RECOVERY_FAILED'
  | 'INVALID_NATIVE_RESULT'
  | 'UNKNOWN_NATIVE_EXECUTOR_ERROR';

export class NativeProcessingQueueExecutorError
  extends Error {
  public readonly code:
    NativeProcessingQueueExecutorErrorCode;

  public readonly retryable:
    boolean;

  public readonly jobId:
    ProcessingJobId | null;

  public readonly stage:
    ProcessingJobStage | null;

  public readonly nativeError:
    NativeProcessingError | null;

  public constructor(
    input: {
      code:
        NativeProcessingQueueExecutorErrorCode;

      message:
        string;

      retryable?:
        boolean;

      jobId?:
        ProcessingJobId | null;

      stage?:
        ProcessingJobStage | null;

      nativeError?:
        NativeProcessingError | null;
    }
  ) {
    super(
      input.message
    );

    this.name =
      'NativeProcessingQueueExecutorError';

    this.code =
      input.code;

    this.retryable =
      input.retryable ??
      false;

    this.jobId =
      input.jobId ??
      null;

    this.stage =
      input.stage ??
      null;

    this.nativeError =
      input.nativeError ??
      null;

    Object.setPrototypeOf(
      this,
      NativeProcessingQueueExecutorError
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

function defaultSetTimeout(
  callback:
    () => void,
  delayMs:
    number
): ReturnType<
  typeof setTimeout
> {
  return setTimeout(
    callback,
    delayMs
  );
}

function defaultClearTimeout(
  timer:
    ReturnType<
      typeof setTimeout
    >
): void {
  clearTimeout(
    timer
  );
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
      serialized
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

function normalizePositiveInteger(
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
    value <
      1
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

function normalizeNonNegativeInteger(
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
    value <
      0
  ) {
    return Math.max(
      0,
      Math.floor(
        fallback
      )
    );
  }

  return Math.max(
    0,
    Math.floor(
      value
    )
  );
}

function readNonEmptyString(
  value:
    unknown
): string | null {
  if (
    typeof value !==
      'string'
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized.length >
    0
    ? normalized
    : null;
}

function appendUniqueWarning(
  warnings:
    string[],
  warning:
    string | null | undefined
): void {
  const normalized =
    warning
      ?.trim();

  if (
    !normalized ||
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

function isCancellationRequested(
  signal:
    NativeProcessingQueueCancellationSignal
): boolean {
  return (
    signal.cancelled ===
      true ||
    signal.isCancelled ===
      true
  );
}

function resolveCancellationReason(
  signal:
    NativeProcessingQueueCancellationSignal
): string {
  return (
    readNonEmptyString(
      signal.reason
    ) ??
    'Processing was cancelled by the queue.'
  );
}

/* =========================================================
 * Runtime mapping
 * ======================================================= */

function nativeRuntimeToErrorSource(
  runtime:
    NativeProcessingRuntime
): ProcessingJobErrorSource {
  switch (
    runtime
  ) {
    case 'ios-bg-processing':
    case 'ios-continued-processing':
      return 'ios-background';

    case 'android-work-manager':
    case 'android-foreground-service':
      return 'android-background';

    case 'foreground-fallback':
    case 'unknown':
      return 'unknown';
  }
}

/* =========================================================
 * Native progress mapping
 * ======================================================= */

function mapNativeProgress(
  progress:
    NativeProcessingProgress
): NativeProcessingQueueProgressUpdate {
  return {
    progress:
      clampProcessingProgress(
        progress.progress
      ),

    stage:
      progress.stage,

    message:
      progress.message,

    estimatedRemainingMs:
      progress.estimatedRemainingMs,
  };
}

/* =========================================================
 * Native output mapping
 * ======================================================= */

function mapNativeOutput(
  result:
    NativeProcessingJobResult
): ProcessingJobOutput | null {
  if (
    !result.succeeded ||
    !result.output
  ) {
    return null;
  }

  return {
    processedImageUri:
      result.output
        .processedImageUri,

    width:
      result.output.width,

    height:
      result.output.height,

    format:
      'png',

    fileSizeBytes:
      result.output
        .fileSizeBytes,

    completedAt:
      result.output
        .completedAt,

    metadata: {
      ...result.output
        .metadata,

      nativeRuntime:
        result.runtime,

      nativeTaskId:
        result.nativeTaskId,

      nativeAttempt:
        result.attempt,

      nativeProcessingDurationMs:
        result.output
          .processingDurationMs,

      nativeForegroundRatio:
        result.output
          .foregroundRatio,
    },
  };
}

/* =========================================================
 * Native error mapping
 * ======================================================= */

function resolveNativeFailureCode(
  result:
    NativeProcessingJobResult
): ProcessingJobErrorCode {
  if (
    result.error
  ) {
    return result.error.code;
  }

  if (
    result.cancelled
  ) {
    return 'JOB_CANCELLED';
  }

  if (
    result.expired
  ) {
    return 'BACKGROUND_PROCESSING_EXPIRED';
  }

  if (
    result.interrupted
  ) {
    return 'JOB_INTERRUPTED';
  }

  return 'UNKNOWN_QUEUE_ERROR';
}

function resolveNativeFailureMessage(
  result:
    NativeProcessingJobResult
): string {
  if (
    result.error
  ) {
    return result.error.message;
  }

  if (
    result.cancelled
  ) {
    return 'Native processing was cancelled.';
  }

  if (
    result.expired
  ) {
    return 'Native processing expired.';
  }

  if (
    result.interrupted
  ) {
    return 'Native processing was interrupted.';
  }

  return 'Native processing failed.';
}

function mapNativeError(
  result:
    NativeProcessingJobResult
): ProcessingJobError {
  return {
    code:
      resolveNativeFailureCode(
        result
      ),

    message:
      resolveNativeFailureMessage(
        result
      ),

    source:
      nativeRuntimeToErrorSource(
        result.runtime
      ),

    retryable:
      result.error
        ?.retryable ??
      result.interrupted,

    occurredAt:
      normalizeProcessingTimestamp(
        result.error
          ?.occurredAt ??
        result.completedAt
      ),

    attempt:
      Math.max(
        0,
        Math.floor(
          result.attempt
        )
      ),

    stage:
      result.error
        ?.stage ??
      (
        result.cancelled
          ? 'cancelled'
          : 'failed'
      ),

    nativeCode:
      result.error
        ?.nativeCode ??
      null,

    segmentationErrorCode:
      null,

    metadata: {
      ...(
        result.error
          ?.metadata ??
        {}
      ),

      nativeRuntime:
        result.runtime,

      nativeTaskId:
        result.nativeTaskId,

      nativeCancelled:
        result.cancelled,

      nativeExpired:
        result.expired,

      nativeInterrupted:
        result.interrupted,
    },
  };
}

/* =========================================================
 * Execution result mapping
 * ======================================================= */

function mapNativeResultToExecutionResult(
  job:
    ProcessingJob,
  result:
    NativeProcessingJobResult
): ProcessingJobExecutionResult {
  const output =
    mapNativeOutput(
      result
    );

  const succeeded =
    result.succeeded &&
    output !==
      null;

  return {
    job,

    succeeded,

    output:
      succeeded
        ? output
        : null,

    error:
      succeeded
        ? null
        : mapNativeError(
            result
          ),

    segmentationSource:
      null,
  };
}

/* =========================================================
 * Options normalization
 * ======================================================= */

function normalizeOptions(
  options:
    NativeProcessingQueueExecutorOptions
): NormalizedNativeProcessingQueueExecutorOptions {
  return {
    bridge:
      options.bridge ??
      getSharedNativeProcessingBridge(),

    payloadOptions: {
      ...(
        options.payloadOptions ??
        {}
      ),
    },

    clock:
      options.clock ?? {
        now:
          defaultNow,
      },

    timer:
      options.timer ?? {
        setTimeout:
          defaultSetTimeout,

        clearTimeout:
          defaultClearTimeout,
      },

    resultTimeoutMs:
      normalizePositiveInteger(
        options.resultTimeoutMs,
        DEFAULT_NATIVE_EXECUTOR_RESULT_TIMEOUT_MS
      ),

    pollIntervalMs:
      normalizePositiveInteger(
        options.pollIntervalMs,
        DEFAULT_NATIVE_EXECUTOR_POLL_INTERVAL_MS
      ),

    progressThrottleMs:
      normalizeNonNegativeInteger(
        options.progressThrottleMs,
        DEFAULT_NATIVE_EXECUTOR_PROGRESS_THROTTLE_MS
      ),

    maximumRecoveryAttempts:
      normalizePositiveInteger(
        options.maximumRecoveryAttempts,
        DEFAULT_NATIVE_EXECUTOR_RECOVERY_ATTEMPTS
      ),

    recoveryDelayMs:
      normalizeNonNegativeInteger(
        options.recoveryDelayMs,
        DEFAULT_NATIVE_EXECUTOR_RECOVERY_DELAY_MS
      ),

    startImmediately:
      options.startImmediately ??
      true,

    persistBeforeScheduling:
      options.persistBeforeScheduling ??
      true,

    acknowledgeResult:
      options.acknowledgeResult ??
      true,

    autoInitialize:
      options.autoInitialize ??
      true,

    enableDebugLogs:
      options.enableDebugLogs ??
      false,
  };
}

/* =========================================================
 * Executor class
 * ======================================================= */

export class NativeProcessingQueueExecutor {
  private readonly options:
    NormalizedNativeProcessingQueueExecutorOptions;

  private state:
    NativeProcessingQueueExecutorState =
      'idle';

  private initialized =
    false;

  private disposed =
    false;

  private available =
    false;

  private activeJobId:
    ProcessingJobId | null =
      null;

  private initializePromise:
    Promise<
      NativeProcessingQueueExecutorInitializeResult
    > | null =
      null;

  private disposePromise:
    Promise<void> | null =
      null;

  private unsubscribeBridge:
    (() => void) | null =
      null;

  private waitingJobs =
    new Map<
      ProcessingJobId,
      NativeProcessingWaitingJob
    >();

  private diagnostics:
    NativeProcessingQueueExecutorDiagnostics;

  public constructor(
    options:
      NativeProcessingQueueExecutorOptions =
        {}
  ) {
    this.options =
      normalizeOptions(
        options
      );

    this.diagnostics = {
      state:
        'idle',

      initialized:
        false,

      disposed:
        false,

      available:
        false,

      activeJobId:
        null,

      waitingJobCount:
        0,

      initializeCount:
        0,

      executeCount:
        0,

      scheduleCount:
        0,

      acceptedScheduleCount:
        0,

      rejectedScheduleCount:
        0,

      completedCount:
        0,

      failedCount:
        0,

      cancelledCount:
        0,

      interruptedCount:
        0,

      expiredCount:
        0,

      progressEventCount:
        0,

      resultEventCount:
        0,

      ignoredEventCount:
        0,

      pollCount:
        0,

      timeoutCount:
        0,

      recoveryCount:
        0,

      recoveryFailureCount:
        0,

      acknowledgementCount:
        0,

      acknowledgementFailureCount:
        0,

      lastInitializedAt:
        null,

      lastExecutionStartedAt:
        null,

      lastExecutionCompletedAt:
        null,

      lastEventAt:
        null,

      lastError:
        null,

      warnings:
        [],
    };

    if (
      this.options.autoInitialize
    ) {
      void this.initialize()
        .catch(
          (
            error:
              unknown
          ) => {
            if (
              this.options
                .enableDebugLogs
            ) {
              console.warn(
                'TRIPLE N NATIVE QUEUE EXECUTOR INITIALIZATION ERROR:',
                error
              );
            }
          }
        );
    }
  }

  /* =======================================================
   * Time
   * ===================================================== */

  private now():
    ProcessingTimestamp {
    return normalizeProcessingTimestamp(
      this.options.clock.now()
    );
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    NativeProcessingQueueExecutorDiagnostics {
    return {
      ...this.diagnostics,

      warnings: [
        ...this.diagnostics
          .warnings,
      ],
    };
  }

  private updateDiagnostics(
    patch:
      Partial<
        NativeProcessingQueueExecutorDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...patch,

      warnings:
        patch.warnings
          ? [
              ...patch.warnings,
            ]
          : this.diagnostics
              .warnings,
    };
  }

  /* =======================================================
   * Guards
   * ===================================================== */

  private assertNotDisposed():
    void {
    if (
      this.disposed ||
      this.state ===
        'disposing' ||
      this.state ===
        'disposed'
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'EXECUTOR_DISPOSED',

        message:
          'Native processing queue executor has been disposed.',

        retryable:
          false,
      });
    }
  }

  private assertValidJob(
    job:
      ProcessingJob
  ): void {
    if (
      !job ||
      typeof job !==
        'object' ||
      typeof job.id !==
        'string' ||
      job.id.trim().length ===
        0 ||
      typeof job.queueId !==
        'string' ||
      job.queueId.trim().length ===
        0 ||
      typeof job.batchId !==
        'string' ||
      job.batchId.trim().length ===
        0 ||
      typeof job.requestId !==
        'string' ||
      job.requestId.trim().length ===
        0 ||
      typeof job.wardrobeItemId !==
        'string' ||
      job.wardrobeItemId
        .trim()
        .length ===
        0 ||
      !job.source ||
      typeof job.source.uri !==
        'string' ||
      job.source.uri
        .trim()
        .length ===
        0
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'INVALID_JOB',

        message:
          'Native processing executor received an invalid ProcessingJob.',

        retryable:
          false,

        jobId:
          job?.id ??
          null,

        stage:
          'queued',
      });
    }
  }

  private assertValidContext(
    context:
      NativeProcessingQueueExecutionContext
  ): void {
    if (
      !context ||
      typeof context !==
        'object' ||
      typeof context.jobId !==
        'string' ||
      context.jobId.trim().length ===
        0 ||
      typeof context.queueId !==
        'string' ||
      context.queueId.trim().length ===
        0 ||
      typeof context.requestId !==
        'string' ||
      context.requestId.trim().length ===
        0 ||
      typeof context.batchId !==
        'string' ||
      context.batchId.trim().length ===
        0 ||
      typeof context.updateProgress !==
        'function' ||
      typeof context
        .isApplicationInBackground !==
        'function'
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'INVALID_CONTEXT',

        message:
          'Native processing executor received an invalid execution context.',

        retryable:
          false,

        jobId:
          context?.jobId ??
          null,

        stage:
          'queued',
      });
    }
  }

  /* =======================================================
   * Initialization
   * ======================================================= */

  public initialize():
    Promise<
      NativeProcessingQueueExecutorInitializeResult
    > {
    this.assertNotDisposed();

    if (
      this.initialized
    ) {
      return Promise.resolve({
        initialized:
          true,

        available:
          this.available,

        bridge: {
          initialized:
            true,

          available:
            this.available,

          capability:
            {
              platform:
                'unknown',

              status:
                this.available
                  ? 'available'
                  : 'unavailable',

              runtime:
                'unknown',

              supportsLockedScreenExecution:
                false,

              supportsTerminatedAppExecution:
                false,

              supportsProgressUpdates:
                true,

              supportsCancellation:
                true,

              maximumConcurrentJobs:
                1,

              reason:
                null,

              checkedAt:
                this.now(),
            },

          restoredRecordCount:
            0,

          pendingResultCount:
            0,

          warnings: [
            ...this.diagnostics
              .warnings,
          ],
        },

        initializedAt:
          this.diagnostics
            .lastInitializedAt ??
          this.now(),

        warnings: [
          ...this.diagnostics
            .warnings,
        ],
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
      NativeProcessingQueueExecutorInitializeResult
    > {
    const initializedAt =
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

      lastError:
        null,
    });

    try {
      const bridgeResult =
        await this.options
          .bridge
          .initialize();

      this.available =
        bridgeResult.available;

      if (
        !this.unsubscribeBridge
      ) {
        this.unsubscribeBridge =
          this.options
            .bridge
            .subscribe(
              (
                event:
                  NativeProcessingEvent
              ) => {
                void this.handleBridgeEvent(
                  event
                );
              }
            );
      }

      this.initialized =
        true;

      this.state =
        'ready';

      const warnings:
        string[] = [];

      for (
        const warning of
        bridgeResult.warnings
      ) {
        appendUniqueWarning(
          warnings,
          warning
        );
      }

      this.updateDiagnostics({
        state:
          'ready',

        initialized:
          true,

        available:
          this.available,

        lastInitializedAt:
          initializedAt,

        lastError:
          null,

        warnings,
      });

      return {
        initialized:
          true,

        available:
          this.available,

        bridge:
          bridgeResult,

        initializedAt,

        warnings,
      };
    } catch (
      error:
        unknown
    ) {
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

        available:
          false,

        lastError:
          message,
      });

      throw new NativeProcessingQueueExecutorError({
        code:
          'EXECUTOR_UNAVAILABLE',

        message,

        retryable:
          true,

        stage:
          'queued',
      });
    }
  }

  /*
   * Part 2/3 starts directly here with:
   *
   * - handleBridgeEvent()
   * - forwardNativeProgress()
   * - execute()
   * - createPayload()
   * - scheduleNativeJob()
   * - waitForNativeResult()
   * - polling
   * - cancellation
   */
  /* =======================================================
   * Bridge events
   * ======================================================= */

  private async handleBridgeEvent(
    event:
      NativeProcessingEvent
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    const waitingJob =
      this.waitingJobs.get(
        event.jobId
      );

    this.updateDiagnostics({
      lastEventAt:
        event.timestamp,
    });

    if (
      !waitingJob ||
      waitingJob.settled
    ) {
      this.updateDiagnostics({
        ignoredEventCount:
          this.diagnostics
            .ignoredEventCount +
        1,
      });

      return;
    }

    if (
      event.progress
    ) {
      await this.forwardNativeProgress(
        waitingJob,
        event.progress
      );
    }

    if (
      event.result
    ) {
      this.updateDiagnostics({
        resultEventCount:
          this.diagnostics
            .resultEventCount +
        1,
      });

      this.resolveWaitingJob(
        waitingJob,
        event.result
      );

      return;
    }

    if (
      event.type ===
        'failed' ||
      event.type ===
        'cancelled' ||
      event.type ===
        'expired' ||
      event.type ===
        'interrupted'
    ) {
      const recoveredResult =
        await this.readFinalResult(
          event.jobId,
          true
        );

      if (
        recoveredResult
      ) {
        this.resolveWaitingJob(
          waitingJob,
          recoveredResult
        );

        return;
      }

      const nativeError =
        event.error;

      this.rejectWaitingJob(
        waitingJob,
        new NativeProcessingQueueExecutorError({
          code:
            event.type ===
              'cancelled'
              ? 'CANCEL_FAILED'
              : 'RESULT_NOT_FOUND',

          message:
            nativeError
              ?.message ??
            `Native processing ended with "${event.type}" but no final result was available.`,

          retryable:
            nativeError
              ?.retryable ??
            event.type ===
              'interrupted',

          jobId:
            event.jobId,

          stage:
            nativeError
              ?.stage ??
            (
              event.type ===
                'cancelled'
                ? 'cancelled'
                : 'failed'
            ),

          nativeError,
        })
      );
    }
  }

  /* =======================================================
   * Progress forwarding
   * ======================================================= */

  private async forwardNativeProgress(
    waitingJob:
      NativeProcessingWaitingJob,
    progress:
      NativeProcessingProgress
  ): Promise<void> {
    if (
      waitingJob.settled
    ) {
      return;
    }

    if (
      progress.jobId !==
        waitingJob.job.id ||
      progress.queueId !==
        waitingJob.job.queueId ||
      progress.batchId !==
        waitingJob.job.batchId
    ) {
      this.updateDiagnostics({
        ignoredEventCount:
          this.diagnostics
            .ignoredEventCount +
        1,
      });

      return;
    }

    const timestamp =
      this.now();

    const normalizedProgress =
      clampProcessingProgress(
        progress.progress
      );

    const elapsedSinceLastProgress =
      waitingJob.lastProgressAt ===
        null
        ? Number.POSITIVE_INFINITY
        : timestamp -
          waitingJob.lastProgressAt;

    const progressAdvanced =
      normalizedProgress >
      waitingJob.lastProgress;

    const terminalProgress =
      normalizedProgress >=
        1;

    if (
      !terminalProgress &&
      !progressAdvanced &&
      elapsedSinceLastProgress <
        this.options
          .progressThrottleMs
    ) {
      return;
    }

    waitingJob.lastProgress =
      Math.max(
        waitingJob.lastProgress,
        normalizedProgress
      );

    waitingJob.lastProgressAt =
      timestamp;

    this.updateDiagnostics({
      progressEventCount:
        this.diagnostics
          .progressEventCount +
      1,

      lastEventAt:
        timestamp,
    });

    try {
      await waitingJob.context
        .updateProgress(
          mapNativeProgress(
            progress
          )
        );
    } catch (
      error:
        unknown
    ) {
      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE PROCESSING PROGRESS FORWARD ERROR:',
          error
        );
      }
    }
  }

  /* =======================================================
   * Execute
   * ======================================================= */

  public async execute(
    job:
      ProcessingJob,
    context:
      NativeProcessingQueueExecutionContext
  ): Promise<
    ProcessingJobExecutionResult
  > {
    this.assertNotDisposed();

    this.assertValidJob(
      job
    );

    this.assertValidContext(
      context
    );

    if (
      job.id !==
        context.jobId ||
      job.queueId !==
        context.queueId ||
      job.requestId !==
        context.requestId ||
      job.batchId !==
        context.batchId
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'INVALID_CONTEXT',

        message:
          'The execution context does not match the ProcessingJob identifiers.',

        retryable:
          false,

        jobId:
          job.id,

        stage:
          'queued',
      });
    }

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    if (
      !this.available
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'EXECUTOR_UNAVAILABLE',

        message:
          'Native processing is unavailable on this build or device.',

        retryable:
          false,

        jobId:
          job.id,

        stage:
          'queued',
      });
    }

    if (
      this.activeJobId &&
      this.activeJobId !==
        job.id
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'JOB_ALREADY_RUNNING',

        message:
          `Native processing job "${this.activeJobId}" is already running.`,

        retryable:
          true,

        jobId:
          job.id,

        stage:
          'queued',
      });
    }

    if (
      this.waitingJobs.has(
        job.id
      )
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'JOB_ALREADY_RUNNING',

        message:
          `Native processing job "${job.id}" is already waiting for a result.`,

        retryable:
          true,

        jobId:
          job.id,

        stage:
          'queued',
      });
    }

    if (
      isCancellationRequested(
        context.cancellationSignal
      )
    ) {
      return this.createCancelledExecutionResult(
        job,
        resolveCancellationReason(
          context.cancellationSignal
        ),
        context.attempt
      );
    }

    context.cancellationSignal
      .throwIfCancelled?.();

    const startedAt =
      this.now();

    this.state =
      'preparing';

    this.activeJobId =
      job.id;

    this.updateDiagnostics({
      state:
        'preparing',

      executeCount:
        this.diagnostics
          .executeCount +
      1,

      activeJobId:
        job.id,

      lastExecutionStartedAt:
        startedAt,

      lastError:
        null,
    });

    let payload:
      NativeProcessingJobPayload;

    try {
      payload =
        this.createPayload(
          job,
          context
        );
    } catch (
      error:
        unknown
    ) {
     
      this.activeJobId =
        null;

      this.state =
        'failed';

      const executorError =
        error instanceof
          NativeProcessingQueueExecutorError
          ? error
          : new NativeProcessingQueueExecutorError({
              code:
                'PAYLOAD_CREATION_FAILED',

              message:
                getUnknownErrorMessage(
                  error
                ),

              retryable:
                false,

              jobId:
                job.id,

              stage:
                'queued',
            });

      this.updateDiagnostics({
        state:
          'failed',

        activeJobId:
          null,

        failedCount:
          this.diagnostics
            .failedCount +
        1,

        lastExecutionCompletedAt:
          this.now(),

        lastError:
          executorError.message,
      });

      return this.createFailedExecutionResult(
        job,
        executorError,
        context.attempt
      );
    }

    try {
      await context.updateProgress({
        progress:
          Math.max(
            job.progress.progress,
            0.01
          ),

        stage:
          'prepare-segmentation',

        message:
          'Preparing native processing.',

        estimatedRemainingMs:
          job.progress
            .estimatedRemainingMs,
      });

      this.state =
        'scheduling';

      this.updateDiagnostics({
        state:
          'scheduling',

        scheduleCount:
          this.diagnostics
            .scheduleCount +
        1,
      });

      const scheduleResult =
        await this.scheduleNativeJob(
          payload
        );

      if (
        !scheduleResult.accepted
      ) {
        this.updateDiagnostics({
          rejectedScheduleCount:
            this.diagnostics
              .rejectedScheduleCount +
          1,
        });

        throw new NativeProcessingQueueExecutorError({
          code:
            'SCHEDULE_REJECTED',

          message:
            scheduleResult
              .error
              ?.message ??
            'Native processing rejected the job.',

          retryable:
            scheduleResult
              .error
              ?.retryable ??
            true,

          jobId:
            job.id,

          stage:
            'queued',

          nativeError:
            scheduleResult.error,
        });
      }

      this.updateDiagnostics({
        acceptedScheduleCount:
          this.diagnostics
            .acceptedScheduleCount +
        1,
      });

      await context.updateProgress({
        progress:
          Math.max(
            job.progress.progress,
            0.02
          ),

        stage:
          'queued',

        message:
          'Native processing was scheduled.',

        estimatedRemainingMs:
          job.progress
            .estimatedRemainingMs,
      });

      this.state =
  'waiting';

this.updateDiagnostics({
  state:
    'waiting',
});

const nativeResult =
  await this.waitForNativeResult(
    job,
    payload,
    context
  );

      this.state =
        'completing';

      this.updateDiagnostics({
        state:
          'completing',
      });

      const executionResult =
        mapNativeResultToExecutionResult(
          job,
          nativeResult
        );

      if (
        nativeResult.succeeded &&
        executionResult.output
      ) {
        await context.updateProgress({
          progress:
            1,

          stage:
            'complete',

          message:
            'Native processing completed.',

          estimatedRemainingMs:
            0,
        });
      }

      await this.acknowledgeNativeResult(
        nativeResult
      );

      this.updateTerminalDiagnostics(
        nativeResult
      );

      this.state =
        'ready';

      this.activeJobId =
        null;

      this.updateDiagnostics({
        state:
          'ready',

        activeJobId:
          null,

        lastExecutionCompletedAt:
          this.now(),

        lastError:
          executionResult.error
            ?.message ??
          null,
      });

      return executionResult;
    } catch (
      error:
        unknown
    ) {
      const waitingJob =
        this.waitingJobs.get(
          job.id
        );

      if (
        waitingJob
      ) {
        this.rejectWaitingJob(
          waitingJob,
          error
        );
      }

      const executorError =
        this.normalizeExecutorError(
          error,
          job.id
        );

      const cancelled =
        isCancellationRequested(
          context.cancellationSignal
        ) ||
        executorError.code ===
          'CANCEL_FAILED';

      this.activeJobId =
        null;

      this.state =
        cancelled
          ? 'ready'
          : 'failed';

      this.updateDiagnostics({
        state:
          this.state,

        activeJobId:
          null,

        failedCount:
          cancelled
            ? this.diagnostics
                .failedCount
            : this.diagnostics
                .failedCount +
              1,

        cancelledCount:
          cancelled
            ? this.diagnostics
                .cancelledCount +
              1
            : this.diagnostics
                .cancelledCount,

        lastExecutionCompletedAt:
          this.now(),

        lastError:
          executorError.message,
      });

      if (
        cancelled
      ) {
        return this.createCancelledExecutionResult(
          job,
          executorError.message,
          context.attempt
        );
      }

      return this.createFailedExecutionResult(
        job,
        executorError,
        context.attempt
      );
    } finally {
      const waitingJob =
        this.waitingJobs.get(
          job.id
        );

      if (
        waitingJob
      ) {
        this.cleanupWaitingJob(
          waitingJob
        );

        this.waitingJobs.delete(
          job.id
        );
      }

      if (
        this.activeJobId ===
          job.id
      ) {
        this.activeJobId =
          null;
      }

      if (
        !this.disposed &&
        this.state !==
          'failed'
      ) {
        this.state =
          'ready';
      }

      this.updateDiagnostics({
        state:
          this.state,

        activeJobId:
          this.activeJobId,

        waitingJobCount:
          this.waitingJobs
            .size,
      });
    }
  }

  /* =======================================================
   * Payload creation
   * ======================================================= */

private createPayload(
    job:
      ProcessingJob,
    context:
      NativeProcessingQueueExecutionContext
  ): NativeProcessingJobPayload {
    try {
      const factoryResult =
        createNativeProcessingPayloadFromQueueJob(
          job,
          {
            options: {
              currentAttempt:
                context.attempt,

              maximumAttempts:
                job.retry
                  .maximumAttempts,
            },

            createdAt:
              job.timing
                .createdAt,

            metadata: {
              queueExecutionStartedAt:
                context.startedAt,

              queueApplicationInBackground:
                context
                  .isApplicationInBackground(),

              queueAttempt:
                context.attempt,
            },
          },
          this.options
            .payloadOptions
        );

      return factoryResult
        .payload;
    } catch (
      error:
        unknown
    ) {
      const message =
        error instanceof
          Error
          ? error.message
          : String(
              error
            );

      throw new NativeProcessingQueueExecutorError({
        code:
          'PAYLOAD_CREATION_FAILED',

        message:
          `Unable to create native processing payload: ${message}`,
      });
    }
  }

  /* =======================================================
   * Native scheduling
   * ======================================================= */

  private async scheduleNativeJob(
    payload:
      NativeProcessingJobPayload
  ): Promise<
    NativeProcessingScheduleResult
  > {
    try {
      return await this.options
        .bridge
        .schedule({
          payload,

          persistBeforeScheduling:
            this.options
              .persistBeforeScheduling,

          startImmediately:
            this.options
              .startImmediately,
        });
    } catch (
      error:
        unknown
    ) {
      throw new NativeProcessingQueueExecutorError({
        code:
          'SCHEDULE_REJECTED',

        message:
          getUnknownErrorMessage(
            error
          ),

        retryable:
          true,

        jobId:
          payload.jobId,

        stage:
          'queued',
      });
    }
  }

  /* =======================================================
   * Waiting
   * ======================================================= */

  private waitForNativeResult(
    job:
      ProcessingJob,
    payload:
      NativeProcessingJobPayload,
    context:
      NativeProcessingQueueExecutionContext
  ): Promise<
    NativeProcessingJobResult
  > {
    return new Promise<
      NativeProcessingJobResult
    >(
      (
        resolve,
        reject
      ) => {
        const waitingJob:
          NativeProcessingWaitingJob = {
          job,

          payload,

          context,

          resolve,

          reject,

          settled:
            false,

          timeoutTimer:
            null,

          pollTimer:
            null,

          cancellationCleanup:
            null,

          createdAt:
            this.now(),

          lastProgressAt:
            null,

          lastProgress:
            clampProcessingProgress(
              job.progress.progress
            ),

          recoveryAttempts:
            0,
        };

        this.waitingJobs.set(
          job.id,
          waitingJob
        );

        this.updateDiagnostics({
          waitingJobCount:
            this.waitingJobs
              .size,
        });

        waitingJob.timeoutTimer =
          this.options
            .timer
            .setTimeout(
              () => {
                this.handleResultTimeout(
                  waitingJob
                );
              },
              this.options
                .resultTimeoutMs
            );

        waitingJob.cancellationCleanup =
          this.subscribeToCancellation(
            waitingJob
          );

        this.scheduleNextPoll(
          waitingJob
        );

        if (
          isCancellationRequested(
            context
              .cancellationSignal
          )
        ) {
          void this.cancelWaitingJob(
            waitingJob,
            resolveCancellationReason(
              context
                .cancellationSignal
            )
          );
        }
      }
    );
  }

  /* =======================================================
   * Polling
   * ======================================================= */

  private scheduleNextPoll(
    waitingJob:
      NativeProcessingWaitingJob
  ): void {
    if (
      waitingJob.settled ||
      this.disposed
    ) {
      return;
    }

    if (
      waitingJob.pollTimer
    ) {
      this.options
        .timer
        .clearTimeout(
          waitingJob.pollTimer
        );
    }

    waitingJob.pollTimer =
      this.options
        .timer
        .setTimeout(
          () => {
            waitingJob.pollTimer =
              null;

            void this.pollWaitingJob(
              waitingJob
            );
          },
          this.options
            .pollIntervalMs
        );
  }

  private async pollWaitingJob(
    waitingJob:
      NativeProcessingWaitingJob
  ): Promise<void> {
    if (
      waitingJob.settled ||
      this.disposed
    ) {
      return;
    }

    this.updateDiagnostics({
      pollCount:
        this.diagnostics
          .pollCount +
      1,
    });

    try {
      const record =
        await this.options
          .bridge
          .getJobRecord(
            waitingJob.job.id,
            true
          );

      if (
        waitingJob.settled
      ) {
        return;
      }

      if (
        record?.progress
      ) {
        await this.forwardNativeProgress(
          waitingJob,
          record.progress
        );
      }

      if (
        record?.result
      ) {
        this.resolveWaitingJob(
          waitingJob,
          record.result
        );

        return;
      }

      waitingJob.recoveryAttempts =
        0;
    } catch (
      error:
        unknown
    ) {
      waitingJob.recoveryAttempts +=
        1;

      if (
        waitingJob.recoveryAttempts >=
          this.options
            .maximumRecoveryAttempts
      ) {
        const recovered =
          await this.recoverWaitingJob(
            waitingJob
          );

        if (
          recovered
        ) {
          return;
        }
      }

      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE PROCESSING POLL ERROR:',
          error
        );
      }
    }

    this.scheduleNextPoll(
      waitingJob
    );
  }

  /* =======================================================
   * Timeout
   * ======================================================= */

  private handleResultTimeout(
    waitingJob:
      NativeProcessingWaitingJob
  ): void {
    if (
      waitingJob.settled
    ) {
      return;
    }

    this.updateDiagnostics({
      timeoutCount:
        this.diagnostics
          .timeoutCount +
      1,
    });

    this.rejectWaitingJob(
      waitingJob,
      new NativeProcessingQueueExecutorError({
        code:
          'RESULT_TIMEOUT',

        message:
          `Native processing did not return a final result within ${this.options.resultTimeoutMs} ms.`,

        retryable:
          true,

        jobId:
          waitingJob.job.id,

        stage:
          waitingJob.job
            .progress
            .stage,
      })
    );
  }

  /* =======================================================
   * Cancellation subscription
   * ======================================================= */

  private subscribeToCancellation(
    waitingJob:
      NativeProcessingWaitingJob
  ): (() => void) | null {
    const signal =
      waitingJob.context
        .cancellationSignal;

    const onCancelled =
      (
        reason?:
          string
      ): void => {
        void this.cancelWaitingJob(
          waitingJob,
          readNonEmptyString(
            reason
          ) ??
          resolveCancellationReason(
            signal
          )
        );
      };

    if (
      typeof signal.subscribe ===
        'function'
    ) {
      const cleanup =
        signal.subscribe(
          onCancelled
        );

      return typeof cleanup ===
        'function'
        ? cleanup
        : null;
    }

    if (
      typeof signal.addEventListener ===
        'function'
    ) {
      const listener =
        (): void => {
          onCancelled();
        };

      signal.addEventListener(
        'cancel',
        listener
      );

      return () => {
        signal.removeEventListener?.(
          'cancel',
          listener
        );
      };
    }

    return null;
  }

  private async cancelWaitingJob(
    waitingJob:
      NativeProcessingWaitingJob,
    reason:
      string
  ): Promise<void> {
    if (
      waitingJob.settled
    ) {
      return;
    }

    this.state =
      'cancelling';

    this.updateDiagnostics({
      state:
        'cancelling',
    });

    try {
      const cancellation =
        await this.options
          .bridge
          .cancel(
            waitingJob.job.id,
            reason
          );

      if (
        waitingJob.settled
      ) {
        return;
      }

      if (
        cancellation.result
      ) {
        this.resolveWaitingJob(
          waitingJob,
          cancellation.result
        );

        return;
      }

      if (
        cancellation.cancelled
      ) {
        this.rejectWaitingJob(
          waitingJob,
          new NativeProcessingQueueExecutorError({
            code:
              'CANCEL_FAILED',

            message:
              reason,

            retryable:
              false,

            jobId:
              waitingJob.job.id,

            stage:
              'cancelled',

            nativeError:
              cancellation.error,
          })
        );

        return;
      }

      throw new NativeProcessingQueueExecutorError({
        code:
          'CANCEL_FAILED',

        message:
          cancellation
            .error
            ?.message ??
          'Native processing cancellation was not confirmed.',

        retryable:
          false,

        jobId:
          waitingJob.job.id,

        stage:
          'cancelled',

        nativeError:
          cancellation.error,
      });
    } catch (
      error:
        unknown
    ) {
      this.rejectWaitingJob(
        waitingJob,
        this.normalizeExecutorError(
          error,
          waitingJob.job.id,
          'CANCEL_FAILED',
          'cancelled'
        )
      );
    }
  }

  /* =======================================================
   * Recovery
   * ======================================================= */

  private async recoverWaitingJob(
    waitingJob:
      NativeProcessingWaitingJob
  ): Promise<boolean> {
    if (
      waitingJob.settled
    ) {
      return true;
    }

    this.state =
      'recovering';

    this.updateDiagnostics({
      state:
        'recovering',

      recoveryCount:
        this.diagnostics
          .recoveryCount +
      1,
    });

    if (
      this.options
        .recoveryDelayMs >
      0
    ) {
      await this.delay(
        this.options
          .recoveryDelayMs
      );
    }

    try {
      const recovery =
        await this.options
          .bridge
          .recover();

      const result =
        recovery.pendingResults
          .find(
            candidate =>
              candidate.jobId ===
              waitingJob.job.id
          ) ??
        recovery.recovered
          .find(
            record =>
              record.payload
                .jobId ===
              waitingJob.job.id
          )
          ?.result ??
        null;

      if (
        result
      ) {
        this.resolveWaitingJob(
          waitingJob,
          result
        );

        return true;
      }

      const record =
        recovery.recovered.find(
          candidate =>
            candidate.payload
              .jobId ===
            waitingJob.job.id
        );

      if (
        record?.progress
      ) {
        await this.forwardNativeProgress(
          waitingJob,
          record.progress
        );
      }

      waitingJob.recoveryAttempts =
        0;

      this.state =
        'waiting';

      this.updateDiagnostics({
        state:
          'waiting',
      });

      return false;
    } catch (
      error:
        unknown
    ) {
      this.updateDiagnostics({
        recoveryFailureCount:
          this.diagnostics
            .recoveryFailureCount +
        1,

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      waitingJob.recoveryAttempts =
        0;

      this.state =
        'waiting';

      return false;
    }
  }

  private async readFinalResult(
    jobId:
      ProcessingJobId,
    refreshFromNative:
      boolean
  ): Promise<
    NativeProcessingJobResult | null
  > {
    try {
      const record =
        await this.options
          .bridge
          .getJobRecord(
            jobId,
            refreshFromNative
          );

      return record?.result ??
        null;
    } catch {
      return null;
    }
  }

  /* =======================================================
   * Waiting-job settlement
   * ======================================================= */

  private resolveWaitingJob(
    waitingJob:
      NativeProcessingWaitingJob,
    result:
      NativeProcessingJobResult
  ): void {
    if (
      waitingJob.settled
    ) {
      return;
    }

    if (
      result.jobId !==
        waitingJob.payload.jobId ||
      result.queueId !==
        waitingJob.payload.queueId ||
      result.batchId !==
        waitingJob.payload.batchId ||
      result.requestId !==
        waitingJob.payload.requestId ||
      result.wardrobeItemId !==
        waitingJob.payload
          .wardrobeItemId
    ) {
      this.rejectWaitingJob(
        waitingJob,
        new NativeProcessingQueueExecutorError({
          code:
            'INVALID_NATIVE_RESULT',

          message:
            'Native processing returned a result that does not match the scheduled payload.',

          retryable:
            false,

          jobId:
            waitingJob.job.id,

          stage:
            'failed',

          nativeError:
            result.error,
        })
      );

      return;
    }

    waitingJob.settled =
      true;

    this.cleanupWaitingJob(
      waitingJob
    );

    this.waitingJobs.delete(
      waitingJob.job.id
    );

    this.updateDiagnostics({
      waitingJobCount:
        this.waitingJobs
          .size,
    });

    waitingJob.resolve(
      result
    );
  }

  private rejectWaitingJob(
    waitingJob:
      NativeProcessingWaitingJob,
    error:
      unknown
  ): void {
    if (
      waitingJob.settled
    ) {
      return;
    }

    waitingJob.settled =
      true;

    this.cleanupWaitingJob(
      waitingJob
    );

    this.waitingJobs.delete(
      waitingJob.job.id
    );

    this.updateDiagnostics({
      waitingJobCount:
        this.waitingJobs
          .size,
    });

    waitingJob.reject(
      error
    );
  }

  private cleanupWaitingJob(
    waitingJob:
      NativeProcessingWaitingJob
  ): void {
    if (
      waitingJob.timeoutTimer
    ) {
      this.options
        .timer
        .clearTimeout(
          waitingJob.timeoutTimer
        );

      waitingJob.timeoutTimer =
        null;
    }

    if (
      waitingJob.pollTimer
    ) {
      this.options
        .timer
        .clearTimeout(
          waitingJob.pollTimer
        );

      waitingJob.pollTimer =
        null;
    }

    if (
      waitingJob
        .cancellationCleanup
    ) {
      try {
        waitingJob
          .cancellationCleanup();
      } catch {
        // لا نرمي أثناء التنظيف.
      }

      waitingJob
        .cancellationCleanup =
        null;
    }
  }

  /* =======================================================
   * Result acknowledgement
   * ======================================================= */

  private async acknowledgeNativeResult(
    result:
      NativeProcessingJobResult
  ): Promise<void> {
    if (
      !this.options
        .acknowledgeResult
    ) {
      return;
    }

    try {
      const acknowledgement =
        await this.options
          .bridge
          .acknowledgeResult(
            result.jobId
          );

      if (
        acknowledgement
          .acknowledged
      ) {
        this.updateDiagnostics({
          acknowledgementCount:
            this.diagnostics
              .acknowledgementCount +
          1,
        });

        return;
      }

      this.updateDiagnostics({
        acknowledgementFailureCount:
          this.diagnostics
            .acknowledgementFailureCount +
        1,

        lastError:
          acknowledgement
            .error
            ?.message ??
          'Native result acknowledgement failed.',
      });
    } catch (
      error:
        unknown
    ) {
      this.updateDiagnostics({
        acknowledgementFailureCount:
          this.diagnostics
            .acknowledgementFailureCount +
        1,

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });
    }
  }

  /* =======================================================
   * Terminal diagnostics
   * ======================================================= */

  private updateTerminalDiagnostics(
    result:
      NativeProcessingJobResult
  ): void {
    this.updateDiagnostics({
      completedCount:
        result.succeeded
          ? this.diagnostics
              .completedCount +
            1
          : this.diagnostics
              .completedCount,

      failedCount:
        !result.succeeded &&
        !result.cancelled &&
        !result.interrupted &&
        !result.expired
          ? this.diagnostics
              .failedCount +
            1
          : this.diagnostics
              .failedCount,

      cancelledCount:
        result.cancelled
          ? this.diagnostics
              .cancelledCount +
            1
          : this.diagnostics
              .cancelledCount,

      interruptedCount:
        result.interrupted
          ? this.diagnostics
              .interruptedCount +
            1
          : this.diagnostics
              .interruptedCount,

      expiredCount:
        result.expired
          ? this.diagnostics
              .expiredCount +
            1
          : this.diagnostics
              .expiredCount,
    });
  }

  /*
   * Part 3/3 continues directly here with:
   *
   * - normalizeExecutorError()
   * - createFailedExecutionResult()
   * - createCancelledExecutionResult()
   * - delay()
   * - public cancel()
   * - public recover()
   * - createExecutorFunction()
   * - dispose()
   * - factories and shared instance
   */

  /* =======================================================
   * Executor-error normalization
   * ======================================================= */

  private normalizeExecutorError(
    error:
      unknown,
    jobId:
      ProcessingJobId | null,
    fallbackCode:
      NativeProcessingQueueExecutorErrorCode =
        'UNKNOWN_NATIVE_EXECUTOR_ERROR',
    fallbackStage:
      ProcessingJobStage =
        'failed'
  ): NativeProcessingQueueExecutorError {
    if (
      error instanceof
        NativeProcessingQueueExecutorError
    ) {
      return error;
    }

    const nativeError =
      this.readNativeError(
        error
      );

    return new NativeProcessingQueueExecutorError({
      code:
        fallbackCode,

      message:
        nativeError
          ?.message ??
        getUnknownErrorMessage(
          error
        ),

      retryable:
  nativeError
    ?.retryable ??
  (
    fallbackCode ===
      'RESULT_TIMEOUT' ||
    fallbackCode ===
      'RECOVERY_FAILED' ||
    fallbackCode ===
      'SCHEDULE_REJECTED'
  ),

      jobId,

      stage:
        nativeError
          ?.stage ??
        fallbackStage,

      nativeError,
    });
  }

  private readNativeError(
    value:
      unknown
  ): NativeProcessingError | null {
    if (
      !value ||
      typeof value !==
        'object'
    ) {
      return null;
    }

    const candidate =
      value as {
        nativeError?:
          unknown;

        error?:
          unknown;
      };

    if (
      candidate.nativeError &&
      typeof candidate.nativeError ===
        'object'
    ) {
      return candidate
        .nativeError as
        NativeProcessingError;
    }

    if (
      candidate.error &&
      typeof candidate.error ===
        'object'
    ) {
      const possibleError =
        candidate.error as
          Partial<
            NativeProcessingError
          >;

      if (
        typeof possibleError
          .message ===
          'string' &&
        typeof possibleError
          .code ===
          'string'
      ) {
        return possibleError as
          NativeProcessingError;
      }
    }

    return null;
  }

  /* =======================================================
   * Queue-error mapping
   * ======================================================= */

  private mapExecutorErrorCode(
    error:
      NativeProcessingQueueExecutorError
  ): ProcessingJobErrorCode {
    if (
      error.nativeError
    ) {
      return error.nativeError
        .code;
    }

    switch (
      error.code
    ) {
      case 'EXECUTOR_DISPOSED':
        return 'QUEUE_DISPOSED';

      case 'EXECUTOR_UNAVAILABLE':
        return 'BACKGROUND_PROCESSING_UNAVAILABLE';

      case 'INVALID_JOB':
      case 'INVALID_CONTEXT':
      case 'PAYLOAD_CREATION_FAILED':
        return 'INVALID_JOB';

      case 'JOB_ALREADY_RUNNING':
        return 'JOB_ALREADY_RUNNING';

      case 'SCHEDULE_REJECTED':
        return 'BACKGROUND_PROCESSING_START_FAILED';

      case 'RESULT_TIMEOUT':
        return 'BACKGROUND_PROCESSING_STOPPED';

      case 'RESULT_NOT_FOUND':
        return 'PROCESSED_IMAGE_NOT_FOUND';

      case 'CANCEL_FAILED':
        return 'JOB_CANCELLED';

      case 'RECOVERY_FAILED':
        return 'JOB_INTERRUPTED';

      case 'INVALID_NATIVE_RESULT':
      case 'UNKNOWN_NATIVE_EXECUTOR_ERROR':
        return 'UNKNOWN_QUEUE_ERROR';
    }
  }

  private resolveExecutorErrorSource(
    job:
      ProcessingJob,
    error:
      NativeProcessingQueueExecutorError
  ): ProcessingJobErrorSource {
    const nativeSource =
      error.nativeError
        ?.source ??
      null;

    switch (
      nativeSource
    ) {
      case 'source':
        return 'image-source';

      case 'model':
      case 'encoder':
      case 'decoder':
      case 'postprocessor':
        return 'segmentation';

      case 'export':
        return 'export';

      case 'storage':
        return 'storage';

      case 'wardrobe':
        return 'wardrobe';

      case 'scheduler':
      case 'expiration':
      case 'cancellation':
      case 'unknown':
      case null:
        break;
    }

    if (
      job.background.platform ===
        'ios' ||
      job.background.executor ===
        'ios-native'
    ) {
      return 'ios-background';
    }

    if (
      job.background.platform ===
        'android' ||
      job.background.executor ===
        'android-native'
    ) {
      return 'android-background';
    }

    return 'unknown';
  }

  /* =======================================================
   * Failed execution result
   * ======================================================= */

  private createFailedExecutionResult(
    job:
      ProcessingJob,
    error:
      NativeProcessingQueueExecutorError,
    attempt:
      number
  ): ProcessingJobExecutionResult {
    const occurredAt =
      this.now();

    const startedAt =
      job.timing.startedAt ??
      job.timing.createdAt;

    const processingError:
      ProcessingJobError = {
      code:
        this.mapExecutorErrorCode(
          error
        ),

      message:
        error.message,

      source:
        this.resolveExecutorErrorSource(
          job,
          error
        ),

      retryable:
        error.retryable,

      occurredAt,

      attempt:
        Math.max(
          0,
          Math.floor(
            attempt
          )
        ),

      stage:
        error.stage ??
        'failed',

      nativeCode:
        error.nativeError
          ?.nativeCode ??
        null,

      segmentationErrorCode:
        null,

      metadata: {
        ...(
          error.nativeError
            ?.metadata ??
          {}
        ),

        nativeExecutorErrorCode:
          error.code,

        nativeJobId:
          error.jobId,

        nativeExecutionDurationMs:
          normalizeProcessingDuration(
            occurredAt -
            startedAt
          ),
      },
    };

    return {
      job,

      succeeded:
        false,

      output:
        null,

      error:
        processingError,

      segmentationSource:
        null,
    };
  }

  /* =======================================================
   * Cancelled execution result
   * ======================================================= */

  private createCancelledExecutionResult(
    job:
      ProcessingJob,
    reason:
      string,
    attempt:
      number
  ): ProcessingJobExecutionResult {
    const occurredAt =
      this.now();

    const startedAt =
      job.timing.startedAt ??
      job.timing.createdAt;

    const error:
      ProcessingJobError = {
      code:
        'JOB_CANCELLED',

      message:
        reason,

      source:
        job.background.platform ===
          'ios'
          ? 'ios-background'
          : job.background.platform ===
              'android'
            ? 'android-background'
            : 'queue',

      retryable:
        false,

      occurredAt,

      attempt:
        Math.max(
          0,
          Math.floor(
            attempt
          )
        ),

      stage:
        'cancelled',

      nativeCode:
        null,

      segmentationErrorCode:
        null,

      metadata: {
        nativeCancelled:
          true,

        nativeExecutionDurationMs:
          normalizeProcessingDuration(
            occurredAt -
            startedAt
          ),
      },
    };

    return {
      job,

      succeeded:
        false,

      output:
        null,

      error,

      segmentationSource:
        null,
    };
  }

  /* =======================================================
   * Delay
   * ======================================================= */

  private delay(
    delayMs:
      number
  ): Promise<void> {
    const normalizedDelay =
      normalizeProcessingDuration(
        delayMs
      );

    if (
      normalizedDelay <=
        0
    ) {
      return Promise.resolve();
    }

    return new Promise<void>(
      resolve => {
        this.options
          .timer
          .setTimeout(
            resolve,
            normalizedDelay
          );
      }
    );
  }

  /* =======================================================
   * Public cancellation
   * ======================================================= */

  public async cancel(
    jobId:
      ProcessingJobId,
    reason =
      'Processing was cancelled by the queue.'
  ): Promise<
    NativeProcessingBridgeCancellationResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    this.state =
      'cancelling';

    this.updateDiagnostics({
      state:
        'cancelling',

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

      const waitingJob =
        this.waitingJobs.get(
          jobId
        );

      if (
        waitingJob &&
        !waitingJob.settled
      ) {
        if (
          cancellation.result
        ) {
          this.resolveWaitingJob(
            waitingJob,
            cancellation.result
          );
        } else if (
          cancellation.cancelled
        ) {
          this.rejectWaitingJob(
            waitingJob,
            new NativeProcessingQueueExecutorError({
              code:
                'CANCEL_FAILED',

              message:
                reason,

              retryable:
                false,

              jobId,

              stage:
                'cancelled',

              nativeError:
                cancellation.error,
            })
          );
        }
      }

      if (
        this.activeJobId ===
          jobId
      ) {
        this.activeJobId =
          null;
      }

      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        activeJobId:
          this.activeJobId,

        cancelledCount:
          cancellation.cancelled
            ? this.diagnostics
                .cancelledCount +
              1
            : this.diagnostics
                .cancelledCount,

        lastError:
          cancellation.error
            ?.message ??
          null,
      });

      return cancellation;
    } catch (
      error:
        unknown
    ) {
      const executorError =
        this.normalizeExecutorError(
          error,
          jobId,
          'CANCEL_FAILED',
          'cancelled'
        );

      this.state =
        'failed';

      this.updateDiagnostics({
        state:
          'failed',

        lastError:
          executorError.message,
      });

      throw executorError;
    }
  }

  /* =======================================================
   * Public recovery
   * ======================================================= */

  public async recover():
    Promise<number> {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    this.state =
      'recovering';

    this.updateDiagnostics({
      state:
        'recovering',

      recoveryCount:
        this.diagnostics
          .recoveryCount +
      1,

      lastError:
        null,
    });

    try {
      const recovery =
        await this.options
          .bridge
          .recover();

      let recoveredWaitingJobCount =
        0;

      for (
        const record of
        recovery.recovered
      ) {
        const waitingJob =
          this.waitingJobs.get(
            record.payload.jobId
          );

        if (
          !waitingJob ||
          waitingJob.settled
        ) {
          continue;
        }

        if (
          record.progress
        ) {
          await this.forwardNativeProgress(
            waitingJob,
            record.progress
          );
        }

        if (
          record.result
        ) {
          this.resolveWaitingJob(
            waitingJob,
            record.result
          );

          recoveredWaitingJobCount +=
            1;
        }
      }

      for (
        const result of
        recovery.pendingResults
      ) {
        const waitingJob =
          this.waitingJobs.get(
            result.jobId
          );

        if (
          !waitingJob ||
          waitingJob.settled
        ) {
          continue;
        }

        this.resolveWaitingJob(
          waitingJob,
          result
        );

        recoveredWaitingJobCount +=
          1;
      }

      const warnings = [
        ...this.diagnostics
          .warnings,
      ];

      for (
        const warning of
        recovery.warnings
      ) {
        appendUniqueWarning(
          warnings,
          warning
        );
      }

      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        waitingJobCount:
          this.waitingJobs
            .size,

        lastError:
          null,

        warnings,
      });

      return recoveredWaitingJobCount;
    } catch (
      error:
        unknown
    ) {
      const executorError =
        this.normalizeExecutorError(
          error,
          this.activeJobId,
          'RECOVERY_FAILED',
          'failed'
        );

      this.state =
        'failed';

      this.updateDiagnostics({
        state:
          'failed',

        recoveryFailureCount:
          this.diagnostics
            .recoveryFailureCount +
        1,

        lastError:
          executorError.message,
      });

      throw executorError;
    }
  }

  /* =======================================================
   * Executor function
   * ======================================================= */

  public createExecutorFunction():
    NativeProcessingQueueExecutorFunction {
    return (
      job,
      context
    ) =>
      this.execute(
        job,
        context
      );
  }

  /* =======================================================
   * Dispose
   * ======================================================= */

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
    });

    try {
      if (
        this.unsubscribeBridge
      ) {
        try {
          this.unsubscribeBridge();
        } catch {
          // لا نرمي أثناء التنظيف.
        }

        this.unsubscribeBridge =
          null;
      }

      const waitingJobs =
        Array.from(
          this.waitingJobs
            .values()
        );

      for (
        const waitingJob of
        waitingJobs
      ) {
        this.rejectWaitingJob(
          waitingJob,
          new NativeProcessingQueueExecutorError({
            code:
              'EXECUTOR_DISPOSED',

            message:
              'Native processing queue executor was disposed while waiting for a result.',

            retryable:
              false,

            jobId:
              waitingJob.job.id,

            stage:
              waitingJob.job
                .progress
                .stage,
          })
        );
      }

      this.waitingJobs.clear();
    } finally {
      this.activeJobId =
        null;

      this.initialized =
        false;

      this.available =
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

        available:
          false,

        activeJobId:
          null,

        waitingJobCount:
          0,
      });
    }
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createNativeProcessingQueueExecutor(
  options:
    NativeProcessingQueueExecutorOptions =
      {}
): NativeProcessingQueueExecutor {
  return new NativeProcessingQueueExecutor(
    options
  );
}

/* =========================================================
 * Executor-function factory
 * ======================================================= */

export function createNativeProcessingQueueExecutorFunction(
  options:
    NativeProcessingQueueExecutorOptions =
      {}
): NativeProcessingQueueExecutorFunction {
  const executor =
    createNativeProcessingQueueExecutor(
      options
    );

  return executor
    .createExecutorFunction();
}

/* =========================================================
 * Shared executor
 * ======================================================= */

let sharedNativeProcessingQueueExecutor:
  NativeProcessingQueueExecutor | null =
    null;

export function getSharedNativeProcessingQueueExecutor(
  options:
    NativeProcessingQueueExecutorOptions =
      {}
): NativeProcessingQueueExecutor {
  if (
    !sharedNativeProcessingQueueExecutor
  ) {
    sharedNativeProcessingQueueExecutor =
      createNativeProcessingQueueExecutor(
        options
      );
  }

  return sharedNativeProcessingQueueExecutor;
}

/* =========================================================
 * Shared executor function
 * ======================================================= */

export function getSharedNativeProcessingQueueExecutorFunction():
  NativeProcessingQueueExecutorFunction {
  return getSharedNativeProcessingQueueExecutor()
    .createExecutorFunction();
}

/* =========================================================
 * Replace shared executor
 * ======================================================= */

export function setSharedNativeProcessingQueueExecutor(
  executor:
    NativeProcessingQueueExecutor | null
): void {
  sharedNativeProcessingQueueExecutor =
    executor;
}

/* =========================================================
 * Dispose shared executor
 * ======================================================= */

export async function disposeSharedNativeProcessingQueueExecutor():
  Promise<void> {
  const executor =
    sharedNativeProcessingQueueExecutor;

  sharedNativeProcessingQueueExecutor =
    null;

  if (
    executor
  ) {
    await executor.dispose();
  }
}

/* =========================================================
 * Default export
 * ======================================================= */

export default
  NativeProcessingQueueExecutor;