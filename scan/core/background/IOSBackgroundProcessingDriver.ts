// scan/core/background/IOSBackgroundProcessingDriver.ts
//
// Triple N - iOS Background Processing Driver
//
// يربط نظام Queue الحالي بموديول Expo Native:
//
// TripleNBackground
//
// Native API:
//
// - isAvailable()
// - startBackgroundTask(taskId, taskName?)
// - updateBackgroundTask(taskId, progress, stage?, message?)
// - stopBackgroundTask(taskId?)
// - getBackgroundTaskState()
//
// Native events:
//
// - onBackgroundTaskStarted
// - onBackgroundTaskProgress
// - onBackgroundTaskExpired
// - onBackgroundTaskStopped

import {
  requireOptionalNativeModule,
} from 'expo-modules-core';

import {
  Platform,
} from 'react-native';

import type {
  ProcessingBackgroundCapability,
  ProcessingPlatform,
  ProcessingQueueSnapshot,
  ProcessingTimestamp,
} from '../queue/QueueTypes';

import type {
  BackgroundProcessingCapabilityResult,
  BackgroundProcessingDriver,
  BackgroundProcessingDriverCallbacks,
  BackgroundProcessingDriverStartResult,
  BackgroundProcessingDriverStopRequest,
  BackgroundProcessingDriverUpdateRequest,
  BackgroundProcessingTaskPayload,
} from '../services/BackgroundProcessingService';

/* =========================================================
 * Native module contracts
 * ======================================================= */

export type IOSBackgroundNativeCapabilityResult = {
  available?:
    boolean;

  platform?:
    string;

  executor?:
    string;

  applicationState?:
    string;

  backgroundTimeRemaining?:
    number;

  restricted?:
    boolean;

  capability?:
    ProcessingBackgroundCapability;

  message?:
    string;

  warnings?:
    readonly string[];
};

export type IOSBackgroundNativeStartRequest = {
  queueId:
    string;

  batchId:
    string | null;

  activeJobId:
    string | null;

  pendingJobCount:
    number;

  totalJobCount:
    number;

  completedJobCount:
    number;

  failedJobCount:
    number;

  overallProgress:
    number;

  overallPercentage:
    number;

  estimatedRemainingMs:
    number | null;

  startedAt:
    number;

  updatedAt:
    number;

  metadata:
    Record<
      string,
      string | number | boolean | null
    >;
};

export type IOSBackgroundNativeStartResult = {
  accepted?:
    boolean;

  started?:
    boolean;

  running?:
    boolean;

  taskId?:
    string | null;

  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  expirationAt?:
    number | null;

  capability?:
    ProcessingBackgroundCapability;

  status?:
    string;

  errorCode?:
    string | null;

  errorMessage?:
    string | null;

  message?:
    string;

  warnings?:
    readonly string[];

  backgroundTimeRemaining?:
    number;
};

export type IOSBackgroundNativeUpdateRequest = {
  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  payload:
    IOSBackgroundNativeStartRequest;
};

export type IOSBackgroundNativeStopRequest = {
  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  reason:
    string;

  completed:
    boolean;

  queueId:
    string;

  queueStatus:
    string;

  updatedAt:
    number;
};

export type IOSBackgroundNativeEvent = {
  taskId?:
    string | null;

  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  running?:
    boolean;

  stopped?:
    boolean;

  expired?:
    boolean;

  status?:
    string;

  reason?:
    string;

  progress?:
    number;

  percentage?:
    number;

  stage?:
    string;

  message?:
    string;

  errorCode?:
    string | null;

  errorMessage?:
    string | null;

  backgroundTimeRemaining?:
    number;

  applicationState?:
    string;

  startedAt?:
    number | null;

  updatedAt?:
    number;
};

export type IOSBackgroundExpirationEvent =
  IOSBackgroundNativeEvent;

export type IOSBackgroundStoppedEvent =
  IOSBackgroundNativeEvent;

export type IOSBackgroundFailureEvent =
  IOSBackgroundNativeEvent & {
    code?:
      string | null;

    retryable?:
      boolean;
  };

export type IOSBackgroundResumeRequestedEvent =
  IOSBackgroundNativeEvent;

type IOSNativeEventSubscription = {
  remove():
    void;
};

export type IOSBackgroundProcessingNativeModule = {
  isAvailable():
    Promise<
      IOSBackgroundNativeCapabilityResult
    >;

  startBackgroundTask(
    taskId:
      string,
    taskName?:
      string
  ):
    Promise<
      IOSBackgroundNativeStartResult
    >;

  updateBackgroundTask(
    taskId:
      string,
    progress:
      number,
    stage?:
      string,
    message?:
      string
  ):
    Promise<
      IOSBackgroundNativeEvent
    >;

  stopBackgroundTask(
    taskId?:
      string
  ):
    Promise<
      IOSBackgroundNativeEvent
    >;

  getBackgroundTaskState():
    Promise<
      IOSBackgroundNativeEvent
    >;

  addListener(
    eventName:
      string,
    listener:
      (
        event:
          IOSBackgroundNativeEvent
      ) => void
  ):
    IOSNativeEventSubscription;
};

/* =========================================================
 * Constants
 * ======================================================= */

const NATIVE_MODULE_NAME =
  'TripleNBackground';

const EVENT_STARTED =
  'onBackgroundTaskStarted';

const EVENT_PROGRESS =
  'onBackgroundTaskProgress';

const EVENT_EXPIRATION =
  'onBackgroundTaskExpired';

const EVENT_STOPPED =
  'onBackgroundTaskStopped';

/* =========================================================
 * Options
 * ======================================================= */

export type IOSBackgroundProcessingDriverOptions = {
  nativeModule?:
    IOSBackgroundProcessingNativeModule | null;

  enableDebugLogs?:
    boolean;

  allowUnavailableFallback?:
    boolean;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type IOSBackgroundProcessingDriverDiagnostics = {
  initialized:
    boolean;

  disposed:
    boolean;

  nativeModuleAvailable:
    boolean;

  running:
    boolean;

  listenerCount:
    number;

  initializeCount:
    number;

  capabilityCheckCount:
    number;

  startCount:
    number;

  updateCount:
    number;

  stopCount:
    number;

  expirationEventCount:
    number;

  stoppedEventCount:
    number;

  failureEventCount:
    number;

  resumeEventCount:
    number;

  activeNativeTaskId:
    string | null;

  activeNativeJobId:
    string | null;

  lastOperationAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;
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
      serialized
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

function normalizeWarnings(
  warnings:
    readonly string[] | null | undefined
): readonly string[] {
  if (
    !warnings
  ) {
    return [];
  }

  return warnings
    .filter(
      warning =>
        typeof warning ===
          'string' &&
        warning.trim().length >
          0
    )
    .map(
      warning =>
        warning.trim()
    );
}

function normalizeProgress(
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

  return Math.max(
    0,
    Math.min(
      1,
      value
    )
  );
}

function normalizeCapability(
  value:
    ProcessingBackgroundCapability | null | undefined,
  available:
    boolean,
  restricted:
    boolean
): ProcessingBackgroundCapability {
  if (
    value ===
      'available' ||
    value ===
      'unavailable' ||
    value ===
      'restricted' ||
    value ===
      'unknown'
  ) {
    return value;
  }

  if (
    restricted
  ) {
    return 'restricted';
  }

  if (
    available
  ) {
    return 'available';
  }

  return 'unavailable';
}

function resolveNativeModule():
  IOSBackgroundProcessingNativeModule | null {
  if (
    Platform.OS !==
      'ios'
  ) {
    return null;
  }

  try {
    return requireOptionalNativeModule<
      IOSBackgroundProcessingNativeModule
    >(
      NATIVE_MODULE_NAME
    );
  } catch {
    return null;
  }
}

function createUnavailableCapability(
  message:
    string,
  warnings:
    readonly string[] =
      []
): BackgroundProcessingCapabilityResult {
  return {
    platform:
      'ios',

    capability:
      'unavailable',

    available:
      false,

    restricted:
      false,

    message,

    warnings,
  };
}

function createRestrictedCapability(
  message:
    string,
  warnings:
    readonly string[] =
      []
): BackgroundProcessingCapabilityResult {
  return {
    platform:
      'ios',

    capability:
      'restricted',

    available:
      false,

    restricted:
      true,

    message,

    warnings,
  };
}

function normalizeCapabilityResult(
  result:
    IOSBackgroundNativeCapabilityResult
): BackgroundProcessingCapabilityResult {
  const available =
    result.available ===
      true;

  const restricted =
    result.restricted ===
      true;

  const capability =
    normalizeCapability(
      result.capability,
      available,
      restricted
    );

  return {
    platform:
      'ios',

    capability,

    available:
      capability ===
        'available' &&
      available,

    restricted:
      capability ===
        'restricted' ||
      restricted,

    message:
      result.message
        ?.trim() ||
      (
        available
          ? 'iOS background execution is available.'
          : restricted
            ? 'iOS background execution is restricted.'
            : 'iOS background execution is unavailable.'
      ),

    warnings:
      normalizeWarnings(
        result.warnings
      ),
  };
}

function createNativePayload(
  payload:
    BackgroundProcessingTaskPayload
): IOSBackgroundNativeStartRequest {
  return {
    queueId:
      payload.queueId,

    batchId:
      payload.batchId,

    activeJobId:
      payload.activeJobId,

    pendingJobCount:
      payload.pendingJobCount,

    totalJobCount:
      payload.totalJobCount,

    completedJobCount:
      payload.completedJobCount,

    failedJobCount:
      payload.failedJobCount,

    overallProgress:
      payload.overallProgress,

    overallPercentage:
      payload.overallPercentage,

    estimatedRemainingMs:
      payload.estimatedRemainingMs,

    startedAt:
      payload.startedAt,

    updatedAt:
      payload.updatedAt,

    metadata: {
      ...payload.metadata,
    },
  };
}

function createStopPayload(
  request:
    BackgroundProcessingDriverStopRequest
): IOSBackgroundNativeStopRequest {
  return {
    nativeTaskId:
      request.nativeTaskId,

    nativeJobId:
      request.nativeJobId,

    reason:
      request.reason,

    completed:
      request.completed,

    queueId:
      request.snapshot
        .queueId,

    queueStatus:
      request.snapshot.status,

    updatedAt:
      now(),
  };
}

function createNativeTaskId(
  payload:
    BackgroundProcessingTaskPayload
): string {
  const queueId =
    payload.queueId
      .trim();

  if (
    queueId.length >
      0
  ) {
    return queueId;
  }

  return `triple-n-ios-${now()}`;
}

function createTaskName(
  payload:
    BackgroundProcessingTaskPayload
): string {
  if (
    payload.batchId
  ) {
    return `Triple N Scan Item ${payload.batchId}`;
  }

  return 'Triple N Scan Item Processing';
}

function createUpdateStage(
  payload:
    BackgroundProcessingTaskPayload
): string {
  if (
    payload.activeJobId
  ) {
    return `processing-${payload.activeJobId}`;
  }

  if (
    payload.pendingJobCount >
      0
  ) {
    return 'processing-queue';
  }

  return 'finalizing';
}

function createUpdateMessage(
  payload:
    BackgroundProcessingTaskPayload
): string {
  return (
    `Processed ${payload.completedJobCount} ` +
    `of ${payload.totalJobCount} items.`
  );
}

/* =========================================================
 * Driver
 * ======================================================= */

export class IOSBackgroundProcessingDriver
  implements BackgroundProcessingDriver
{
  public readonly platform:
    ProcessingPlatform =
      'ios';

  private readonly nativeModule:
    IOSBackgroundProcessingNativeModule | null;

  private readonly enableDebugLogs:
    boolean;

  private readonly allowUnavailableFallback:
    boolean;

  private initialized =
    false;

  private disposed =
    false;

  private running =
    false;

  private callbacks:
    BackgroundProcessingDriverCallbacks | null =
      null;

  private subscriptions:
    IOSNativeEventSubscription[] =
      [];

  private activeNativeTaskId:
    string | null =
      null;

  private activeNativeJobId:
    string | null =
      null;

      private lastSentProgress =
  -1;

private lastSentStage:
  string | null =
    null;

private lastSentMessage:
  string | null =
    null;

  private capability:
    BackgroundProcessingCapabilityResult =
      createUnavailableCapability(
        'iOS background processing has not been initialized.'
      );

  private diagnostics:
    IOSBackgroundProcessingDriverDiagnostics;

  constructor(
    options:
      IOSBackgroundProcessingDriverOptions =
        {}
  ) {
    this.nativeModule =
      options.nativeModule !==
        undefined
        ? options.nativeModule
        : resolveNativeModule();

    this.enableDebugLogs =
      options.enableDebugLogs ??
      false;

    this.allowUnavailableFallback =
      options
        .allowUnavailableFallback ??
      true;

    this.diagnostics = {
      initialized:
        false,

      disposed:
        false,

      nativeModuleAvailable:
        this.nativeModule !==
        null,

      running:
        false,

      listenerCount:
        0,

      initializeCount:
        0,

      capabilityCheckCount:
        0,

      startCount:
        0,

      updateCount:
        0,

      stopCount:
        0,

      expirationEventCount:
        0,

      stoppedEventCount:
        0,

      failureEventCount:
        0,

      resumeEventCount:
        0,

      activeNativeTaskId:
        null,

      activeNativeJobId:
        null,

      lastOperationAt:
        null,

      lastError:
        null,
    };
  }

  /* =======================================================
   * Initialization
   * ===================================================== */

  public async initialize():
    Promise<
      BackgroundProcessingCapabilityResult
    > {
    this.assertNotDisposed();

    if (
      this.initialized
    ) {
      return this.getCapabilitySnapshot();
    }

    this.updateDiagnostics({
      initializeCount:
        this.diagnostics
          .initializeCount +
        1,

      lastOperationAt:
        now(),
    });

    if (
      Platform.OS !==
        'ios'
    ) {
      this.capability =
        createUnavailableCapability(
          'The iOS background driver was loaded on a non-iOS platform.'
        );

      this.initialized =
        true;

      this.updateDiagnostics({
        initialized:
          true,
      });

      return this.getCapabilitySnapshot();
    }

    if (
      !this.nativeModule
    ) {
      this.capability =
        createUnavailableCapability(
          'The TripleNBackground native module is not installed.',
          [
            'Install a new iOS development or production build containing the local native module.',
          ]
        );

      this.initialized =
        true;

      this.updateDiagnostics({
        initialized:
          true,
      });

      return this.getCapabilitySnapshot();
    }

    try {
      const nativeResult =
        await this.nativeModule
          .isAvailable();

      this.capability =
        normalizeCapabilityResult(
          nativeResult
        );

      this.attachNativeEvents();

      this.initialized =
        true;

      this.updateDiagnostics({
        initialized:
          true,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return this.getCapabilitySnapshot();
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.capability =
        this.allowUnavailableFallback
          ? createUnavailableCapability(
              message
            )
          : createRestrictedCapability(
              message
            );

      this.initialized =
        true;

      this.updateDiagnostics({
        initialized:
          true,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      if (
        !this.allowUnavailableFallback
      ) {
        throw error;
      }

      return this.getCapabilitySnapshot();
    }
  }

  /* =======================================================
   * Capability
   * ===================================================== */

  public async getCapability():
    Promise<
      BackgroundProcessingCapabilityResult
    > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      return this.initialize();
    }

    this.updateDiagnostics({
      capabilityCheckCount:
        this.diagnostics
          .capabilityCheckCount +
      1,

      lastOperationAt:
        now(),
    });

    if (
      !this.nativeModule
    ) {
      return this.getCapabilitySnapshot();
    }

    try {
      this.capability =
        normalizeCapabilityResult(
          await this.nativeModule
            .isAvailable()
        );

      this.updateDiagnostics({
        lastOperationAt:
          now(),

        lastError:
          null,
      });
    } catch (error) {
      this.updateDiagnostics({
        lastOperationAt:
          now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });
    }

    return this.getCapabilitySnapshot();
  }

  /* =======================================================
   * Start
   * ===================================================== */

  public async start(
    payload:
      BackgroundProcessingTaskPayload,
    callbacks:
      BackgroundProcessingDriverCallbacks
  ): Promise<
    BackgroundProcessingDriverStartResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    if (
      this.running
    ) {
      return {
        started:
          true,

        nativeTaskId:
          this.activeNativeTaskId,

        nativeJobId:
          this.activeNativeJobId,

        expirationAt:
          null,

        capability:
          this.capability
            .capability,

        warnings: [
          'The iOS background task is already running.',
        ],
      };
    }

    if (
      !this.capability
        .available ||
      !this.nativeModule
    ) {
      return {
        started:
          false,

        nativeTaskId:
          null,

        nativeJobId:
          null,

        expirationAt:
          null,

        capability:
          this.capability
            .capability,

        warnings: [
          ...this.capability
            .warnings,
        ],
      };
    }

    this.callbacks =
      callbacks;

    this.attachNativeEvents();

    const nativeTaskId =
      createNativeTaskId(
        payload
      );

    try {
      const result =
        await this.nativeModule
          .startBackgroundTask(
            nativeTaskId,
            createTaskName(
              payload
            )
          );

      const started =
        result.accepted ===
          true ||
        result.started ===
          true ||
        result.running ===
          true;

      if (
        !started
      ) {
        const message =
          result.errorMessage
            ?.trim() ||
          result.message
            ?.trim() ||
          'The iOS background task did not start.';

        this.running =
          false;

        this.callbacks =
          null;

        this.updateDiagnostics({
          running:
            false,

          startCount:
            this.diagnostics
              .startCount +
          1,

          lastOperationAt:
            now(),

          lastError:
            message,
        });

        return {
          started:
            false,

          nativeTaskId:
            null,

          nativeJobId:
            null,

          expirationAt:
            result.expirationAt ??
            null,

          capability:
            'unavailable',

          warnings: [
            ...normalizeWarnings(
              result.warnings
            ),
            message,
          ],
        };
      }

      this.activeNativeTaskId =
        result.taskId ??
        result.nativeTaskId ??
        nativeTaskId;

      this.activeNativeJobId =
        result.nativeJobId ??
        payload.activeJobId ??
        null;

      this.running =
        true;

      this.updateDiagnostics({
        running:
          true,

        startCount:
          this.diagnostics
            .startCount +
        1,

        activeNativeTaskId:
          this.activeNativeTaskId,

        activeNativeJobId:
          this.activeNativeJobId,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return {
        started:
          true,

        nativeTaskId:
          this.activeNativeTaskId,

        nativeJobId:
          this.activeNativeJobId,

        expirationAt:
          result.expirationAt ??
          null,

        capability:
          'available',

        warnings:
          normalizeWarnings(
            result.warnings
          ),
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.running =
        false;

      this.callbacks =
        null;

      this.updateDiagnostics({
        running:
          false,

        startCount:
          this.diagnostics
            .startCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      throw error;
    }
  }

  /* =======================================================
   * Update
   * ===================================================== */

 public async update(
  request:
    BackgroundProcessingDriverUpdateRequest
): Promise<void> {
  this.assertNotDisposed();

  if (
    !this.running ||
    !this.nativeModule
  ) {
    return;
  }

  const taskId =
    request.nativeTaskId ??
    this.activeNativeTaskId ??
    request.payload.queueId;

  const progress =
    normalizeProgress(
      request.payload
        .overallProgress
    );

  const stage =
    createUpdateStage(
      request.payload
    );

  const message =
    createUpdateMessage(
      request.payload
    );

  const progressChanged =
    Math.abs(
      progress -
      this.lastSentProgress
    ) >=
    0.005;

  const stageChanged =
    stage !==
    this.lastSentStage;

  const messageChanged =
    message !==
    this.lastSentMessage;

  if (
    !progressChanged &&
    !stageChanged &&
    !messageChanged
  ) {
    return;
  }

  try {
    await this.nativeModule
      .updateBackgroundTask(
        taskId,
        progress,
        stage,
        message
      );

    this.lastSentProgress =
      progress;

    this.lastSentStage =
      stage;

    this.lastSentMessage =
      message;

    this.activeNativeJobId =
      request.nativeJobId ??
      request.payload.activeJobId ??
      this.activeNativeJobId;

    this.updateDiagnostics({
      updateCount:
        this.diagnostics
          .updateCount +
      1,

      activeNativeJobId:
        this.activeNativeJobId,

      lastOperationAt:
        now(),

      lastError:
        null,
    });
  } catch (error) {
    const message =
      getUnknownErrorMessage(
        error
      );

    this.updateDiagnostics({
      updateCount:
        this.diagnostics
          .updateCount +
      1,

      lastOperationAt:
        now(),

      lastError:
        message,
    });

    if (
      this.enableDebugLogs
    ) {
      console.warn(
        'TRIPLE N IOS BACKGROUND UPDATE ERROR:',
        error
      );
    }

    throw error;
  }
}

  /* =======================================================
   * Stop
   * ===================================================== */

  public async stop(
    request:
      BackgroundProcessingDriverStopRequest
  ): Promise<void> {
    this.assertNotDisposed();

    const nativeTaskId =
      request.nativeTaskId ??
      this.activeNativeTaskId ??
      request.snapshot.queueId;

    try {
      if (
        this.nativeModule
      ) {
        await this.nativeModule
          .stopBackgroundTask(
            nativeTaskId
          );
      }
    } finally {
      this.running =
        false;

      this.activeNativeTaskId =
        null;

      this.activeNativeJobId =
        null;

      this.callbacks =
        null;

      this.updateDiagnostics({
        running:
          false,

        stopCount:
          this.diagnostics
            .stopCount +
        1,

        activeNativeTaskId:
          null,

        activeNativeJobId:
          null,

        lastOperationAt:
          now(),
      });
    }
  }

  /* =======================================================
   * Native events
   * ===================================================== */

  private attachNativeEvents():
    void {
    if (
      !this.nativeModule ||
      this.subscriptions.length >
        0
    ) {
      return;
    }

    this.subscriptions = [
      this.nativeModule
        .addListener(
          EVENT_STARTED,
          event => {
            this.handleStartedEvent(
              event
            );
          }
        ),

      this.nativeModule
        .addListener(
          EVENT_PROGRESS,
          event => {
            this.handleProgressEvent(
              event
            );
          }
        ),

      this.nativeModule
        .addListener(
          EVENT_EXPIRATION,
          event => {
            this.handleExpirationEvent(
              event
            );
          }
        ),

      this.nativeModule
        .addListener(
          EVENT_STOPPED,
          event => {
            this.handleStoppedEvent(
              event
            );
          }
        ),
    ];

    this.updateDiagnostics({
      listenerCount:
        this.subscriptions.length,

      lastOperationAt:
        now(),
    });
  }

  private handleStartedEvent(
  event:
    IOSBackgroundNativeEvent
): void {
  this.running =
    true;

    this.lastSentProgress =
  -1;

this.lastSentStage =
  null;

this.lastSentMessage =
  null;


  this.activeNativeTaskId =
    event.taskId ??
    event.nativeTaskId ??
    this.activeNativeTaskId;

  this.activeNativeJobId =
    event.nativeJobId ??
    this.activeNativeJobId;

  this.updateDiagnostics({
    running:
      true,

    activeNativeTaskId:
      this.activeNativeTaskId,

    activeNativeJobId:
      this.activeNativeJobId,

    lastOperationAt:
      now(),

    lastError:
      null,
  });
}

  private handleProgressEvent(
  event:
    IOSBackgroundNativeEvent
): void {
  this.activeNativeTaskId =
    event.taskId ??
    event.nativeTaskId ??
    this.activeNativeTaskId;

  this.activeNativeJobId =
    event.nativeJobId ??
    this.activeNativeJobId;

  this.running =
    event.running ??
    this.running;

  this.updateDiagnostics({
    running:
      this.running,

    activeNativeTaskId:
      this.activeNativeTaskId,

    activeNativeJobId:
      this.activeNativeJobId,

    lastOperationAt:
      now(),
  });
}

private handleExpirationEvent(
  event:
    IOSBackgroundExpirationEvent
): void {
  const reason =
    event.errorMessage
      ?.trim() ||
    event.message
      ?.trim() ||
    event.reason
      ?.trim() ||
    'iOS background processing time expired.';

  const callbacks =
    this.callbacks;

  this.running =
    false;

  this.activeNativeTaskId =
    null;

  this.activeNativeJobId =
    null;

  this.callbacks =
    null;

  this.updateDiagnostics({
    running:
      false,

    expirationEventCount:
      this.diagnostics
        .expirationEventCount +
      1,

    activeNativeTaskId:
      null,

    activeNativeJobId:
      null,

    lastOperationAt:
      now(),

    lastError:
      reason,
  });

  callbacks
    ?.onExpiration(
      reason
    );
}

  private handleStoppedEvent(
    event:
      IOSBackgroundStoppedEvent
  ): void {
    const reason =
      event.reason
        ?.trim() ||
      event.message
        ?.trim() ||
      'iOS background processing stopped.';

    this.running =
      false;

    this.activeNativeTaskId =
      null;

    this.activeNativeJobId =
      null;

    this.updateDiagnostics({
      running:
        false,

      stoppedEventCount:
        this.diagnostics
          .stoppedEventCount +
      1,

      activeNativeTaskId:
        null,

      activeNativeJobId:
        null,

      lastOperationAt:
        now(),
    });

    const callbacks =
      this.callbacks;

    this.callbacks =
      null;

      this.lastSentProgress =
  -1;

this.lastSentStage =
  null;

this.lastSentMessage =
  null;

    callbacks
      ?.onStopped(
        reason
      );
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    IOSBackgroundProcessingDriverDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  private updateDiagnostics(
    updates:
      Partial<
        IOSBackgroundProcessingDriverDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...updates,
    };
  }

  private getCapabilitySnapshot():
    BackgroundProcessingCapabilityResult {
    return {
      ...this.capability,

      warnings: [
        ...this.capability
          .warnings,
      ],
    };
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

    if (
      this.running
    ) {
      const emptySnapshot =
        {
          queueId:
            'triple-n-scan-item-queue',

          status:
            'stopped',
        } as ProcessingQueueSnapshot;

      try {
        await this.stop({
          nativeTaskId:
            this.activeNativeTaskId,

          nativeJobId:
            this.activeNativeJobId,

          reason:
            'iOS background driver disposed.',

          completed:
            false,

          snapshot:
            emptySnapshot,
        });
      } catch {
        // لا نرمي أثناء التنظيف.
      }
    }

    for (
      const subscription of
      this.subscriptions
    ) {
      try {
        subscription.remove();
      } catch {
        // لا نرمي أثناء التنظيف.
      }
    }

    this.subscriptions =
      [];

    this.callbacks =
      null;

    this.activeNativeTaskId =
      null;

    this.activeNativeJobId =
      null;

    this.running =
      false;

      this.lastSentProgress =
  -1;

this.lastSentStage =
  null;

this.lastSentMessage =
  null;

    this.initialized =
      false;

    this.disposed =
      true;

    this.updateDiagnostics({
      initialized:
        false,

      disposed:
        true,

      running:
        false,

      listenerCount:
        0,

      activeNativeTaskId:
        null,

      activeNativeJobId:
        null,

      lastOperationAt:
        now(),
    });
  }

  private assertNotDisposed():
    void {
    if (
      this.disposed
    ) {
      throw new Error(
        'iOS background processing driver has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createIOSBackgroundProcessingDriver(
  options:
    IOSBackgroundProcessingDriverOptions =
      {}
): IOSBackgroundProcessingDriver {
  return new IOSBackgroundProcessingDriver(
    options
  );
}

export default
  IOSBackgroundProcessingDriver;