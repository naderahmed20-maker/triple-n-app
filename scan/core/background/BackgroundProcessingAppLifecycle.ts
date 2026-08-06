// scan/core/background/BackgroundProcessingAppLifecycle.ts
//
// Triple N - Background Processing App Lifecycle
//
// هذا الملف مسؤول عن تنسيق دورة حياة التطبيق مع:
//
// - ScanItemQueueService
// - BackgroundProcessingService
// - BackgroundProcessingRegistry
// - React Native AppState
//
// مسؤولياته:
//
// 1) تهيئة Queue وBackgroundProcessingService.
// 2) مراقبة انتقال التطبيق إلى الخلفية.
// 3) حفظ Queue قبل الانتقال إلى الخلفية.
// 4) بدء Native Background Processing عند وجود Jobs معلقة.
// 5) استكمال Queue عند رجوع التطبيق إلى الواجهة.
// 6) إيقاف Native Background Task عند الرجوع للواجهة.
// 7) منع تداخل انتقالات AppState.
// 8) توفير Snapshot وDiagnostics موحدين.
// 9) تنظيف AppState Listener عند Dispose.
//
// هذا الملف لا يشغّل EdgeSAM مباشرة.
// ولا ينشئ Drivers بنفسه.
//
// Drivers يتم تسجيلها من خلال:
//
// BackgroundProcessingBootstrap
// → BackgroundProcessingRegistry
// → BackgroundProcessingService

import {
  AppState,
  Platform,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import type {
  ProcessingApplicationState,
  ProcessingBackgroundCapability,
  ProcessingQueueSnapshot,
  ProcessingQueueStatus,
  ProcessingTimestamp,
} from '../queue/QueueTypes';

import type {
  ScanItemQueueService,
} from '../services/ScanItemQueueService';

import {
  getDefaultScanItemQueueService,
} from '../services/ScanItemQueueService';

import type {
  BackgroundProcessingCapabilityResult,
  BackgroundProcessingService,
  BackgroundProcessingServiceSnapshot,
  BackgroundProcessingStartResult,
  BackgroundProcessingStopResult,
} from '../services/BackgroundProcessingService';

import {
  getRegisteredBackgroundProcessingService,
} from './BackgroundProcessingRegistry';

/* =========================================================
 * Lifecycle state
 * ======================================================= */

export type BackgroundProcessingAppLifecycleState =
  | 'uninitialized'
  | 'initializing'
  | 'active'
  | 'inactive'
  | 'background'
  | 'transitioning'
  | 'failed'
  | 'disposing'
  | 'disposed';

/* =========================================================
 * Transition reason
 * ======================================================= */

export type BackgroundProcessingAppLifecycleTransitionReason =
  | 'initialization'
  | 'app-state-change'
  | 'manual-active'
  | 'manual-inactive'
  | 'manual-background'
  | 'synchronization'
  | 'recovery'
  | 'dispose'
  | 'unknown';

/* =========================================================
 * Configuration
 * ======================================================= */

export type BackgroundProcessingAppLifecycleConfig = {
  /**
   * استكمال Queue عند رجوع التطبيق إلى الواجهة.
   */
  resumeQueueWhenApplicationBecomesActive:
    boolean;

  /**
   * إيقاف Native Background Task عند رجوع التطبيق.
   *
   * Queue نفسها تستمر محليًا.
   */
  stopBackgroundTaskWhenApplicationBecomesActive:
    boolean;

  /**
   * تشغيل Native Background Processing
   * عند انتقال التطبيق إلى الخلفية.
   */
  startBackgroundTaskWhenApplicationEntersBackground:
    boolean;

  /**
   * حفظ Queue قبل الانتقال إلى الخلفية.
   */
  flushQueueBeforeBackground:
    boolean;

  /**
   * عدم تشغيل Native Task إذا لم توجد Jobs معلقة.
   */
  requirePendingJobs:
    boolean;

  /**
   * تحديث Capability قبل كل محاولة تشغيل بالخلفية.
   */
  refreshCapabilityBeforeStart:
    boolean;

  /**
   * عند inactive نحفظ Queue فقط،
   * ولا نبدأ Native Task حتى يصل AppState إلى background.
   */
  flushQueueWhenApplicationBecomesInactive:
    boolean;

  /**
   * Logs إضافية أثناء التطوير.
   */
  enableDebugLogs:
    boolean;
};

export type PartialBackgroundProcessingAppLifecycleConfig =
  Partial<
    BackgroundProcessingAppLifecycleConfig
  >;

export const DEFAULT_BACKGROUND_PROCESSING_APP_LIFECYCLE_CONFIG:
  BackgroundProcessingAppLifecycleConfig = {
    resumeQueueWhenApplicationBecomesActive:
      true,

    stopBackgroundTaskWhenApplicationBecomesActive:
      true,

    startBackgroundTaskWhenApplicationEntersBackground:
      true,

    flushQueueBeforeBackground:
      true,

    requirePendingJobs:
      true,

    refreshCapabilityBeforeStart:
      true,

    flushQueueWhenApplicationBecomesInactive:
      true,

    enableDebugLogs:
      false,
  };

/* =========================================================
 * Options
 * ======================================================= */

export type BackgroundProcessingAppLifecycleOptions = {
  queueService?:
    ScanItemQueueService;

  backgroundService?:
    BackgroundProcessingService;

  config?:
    PartialBackgroundProcessingAppLifecycleConfig;

  autoInitialize?:
    boolean;

  onTransition?:
    (
      transition:
        BackgroundProcessingAppLifecycleTransition
    ) => void;

  onError?:
    (
      error:
        Error
    ) => void;
};

/* =========================================================
 * Transition
 * ======================================================= */

export type BackgroundProcessingAppLifecycleTransition = {
  id:
    string;

  previousState:
    ProcessingApplicationState;

  nextState:
    ProcessingApplicationState;

  reason:
    BackgroundProcessingAppLifecycleTransitionReason;

  startedAt:
    ProcessingTimestamp;

  completedAt:
    ProcessingTimestamp;

  durationMs:
    number;

  queueStatusBefore:
    ProcessingQueueStatus;

  queueStatusAfter:
    ProcessingQueueStatus;

  queueStarted:
    boolean;

  queueResumed:
    boolean;

  queueFlushed:
    boolean;

  backgroundStarted:
    boolean;

  backgroundStopped:
    boolean;

  succeeded:
    boolean;

  errorMessage:
    string | null;
};

/* =========================================================
 * Initialization result
 * ======================================================= */

export type BackgroundProcessingAppLifecycleInitializeResult = {
  initialized:
    boolean;

  state:
    BackgroundProcessingAppLifecycleState;

  applicationState:
    ProcessingApplicationState;

  queue:
    ProcessingQueueSnapshot;

  background:
    BackgroundProcessingServiceSnapshot;

  capability:
    BackgroundProcessingCapabilityResult;

  queueStarted:
    boolean;

  queueResumed:
    boolean;

  backgroundStarted:
    boolean;

  durationMs:
    number;

  warnings:
    readonly string[];
};

/* =========================================================
 * Snapshot
 * ======================================================= */

export type BackgroundProcessingAppLifecycleSnapshot = {
  state:
    BackgroundProcessingAppLifecycleState;

  initialized:
    boolean;

  disposed:
    boolean;

  transitioning:
    boolean;

  listenerAttached:
    boolean;

  applicationState:
    ProcessingApplicationState;

  previousApplicationState:
    ProcessingApplicationState;

  queueStatus:
    ProcessingQueueStatus;

  queueRunning:
    boolean;

  backgroundCapability:
    ProcessingBackgroundCapability;

  backgroundRunning:
    boolean;

  activeJobId:
    string | null;

  pendingJobCount:
    number;

  initializedAt:
    ProcessingTimestamp | null;

  lastStateChangeAt:
    ProcessingTimestamp | null;

  lastActiveAt:
    ProcessingTimestamp | null;

  lastInactiveAt:
    ProcessingTimestamp | null;

  lastBackgroundAt:
    ProcessingTimestamp | null;

  lastTransition:
    BackgroundProcessingAppLifecycleTransition | null;

  lastError:
    string | null;

  warnings:
    readonly string[];
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type BackgroundProcessingAppLifecycleDiagnostics = {
  initializeCount:
    number;

  initializeFailureCount:
    number;

  transitionCount:
    number;

  transitionFailureCount:
    number;

  ignoredTransitionCount:
    number;

  appStateEventCount:
    number;

  queueStartCount:
    number;

  queueResumeCount:
    number;

  queueFlushCount:
    number;

  queueFailureCount:
    number;

  backgroundStartCount:
    number;

  backgroundStopCount:
    number;

  backgroundFailureCount:
    number;

  recoveryCount:
    number;

  recoveryFailureCount:
    number;

  disposeCount:
    number;

  pendingTransitionCount:
    number;

  lastOperationAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;
};

/* =========================================================
 * Internal transition context
 * ======================================================= */

type LifecycleTransitionContext = {
  id:
    string;

  previousState:
    ProcessingApplicationState;

  nextState:
    ProcessingApplicationState;

  reason:
    BackgroundProcessingAppLifecycleTransitionReason;

  startedAt:
    ProcessingTimestamp;

  queueStatusBefore:
    ProcessingQueueStatus;

  queueStarted:
    boolean;

  queueResumed:
    boolean;

  queueFlushed:
    boolean;

  backgroundStarted:
    boolean;

  backgroundStopped:
    boolean;

  errorMessage:
    string | null;
};

/* =========================================================
 * Helpers
 * ======================================================= */

function now():
  ProcessingTimestamp {
  return Date.now();
}

function supportsClosedAppBackgroundProcessing():
  boolean {
  /*
   * استمرار المعالجة بعد خروج التطبيق من الواجهة
   * مسموح على Android فقط.
   *
   * iOS يعتمد على المعالجة داخل التطبيق المفتوح فقط.
   */
  return Platform.OS ===
    'android';
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

function resolveApplicationState(
  state:
    AppStateStatus | string | null | undefined
): ProcessingApplicationState {
  switch (
    state
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

function resolveLifecycleState(
  state:
    ProcessingApplicationState
): BackgroundProcessingAppLifecycleState {
  switch (
    state
  ) {
    case 'active':
      return 'active';

    case 'inactive':
      return 'inactive';

    case 'background':
      return 'background';

    default:
      return 'uninitialized';
  }
}

function normalizeConfig(
  config:
    PartialBackgroundProcessingAppLifecycleConfig =
      {}
): BackgroundProcessingAppLifecycleConfig {
  return {
    ...DEFAULT_BACKGROUND_PROCESSING_APP_LIFECYCLE_CONFIG,
    ...config,
  };
}

function createTransitionId():
  string {
  return [
    'background-lifecycle',
    Date.now()
      .toString(36),
    Math.random()
      .toString(36)
      .slice(
        2,
        10
      ),
  ].join(
    '-'
  );
}

function hasQueueWork(
  snapshot:
    ProcessingQueueSnapshot
): boolean {
  return (
    snapshot.statistics.pending >
      0 ||
    snapshot.statistics.active >
      0
  );
}

function cloneTransition(
  transition:
    BackgroundProcessingAppLifecycleTransition | null
): BackgroundProcessingAppLifecycleTransition | null {
  if (
    !transition
  ) {
    return null;
  }

  return {
    ...transition,
  };
}

/* =========================================================
 * Lifecycle class
 * ======================================================= */

export class BackgroundProcessingAppLifecycle {
  private readonly queueService:
    ScanItemQueueService;

  private readonly backgroundService:
    BackgroundProcessingService;

  private readonly config:
    BackgroundProcessingAppLifecycleConfig;

  private readonly onTransition:
    (
      transition:
        BackgroundProcessingAppLifecycleTransition
    ) => void;

  private readonly onError:
    (
      error:
        Error
    ) => void;

  private lifecycleState:
    BackgroundProcessingAppLifecycleState =
      'uninitialized';

  private applicationState:
    ProcessingApplicationState =
      'unknown';

  private previousApplicationState:
    ProcessingApplicationState =
      'unknown';

  private initialized =
    false;

  private disposed =
    false;

  private transitioning =
    false;

  private appStateSubscription:
    NativeEventSubscription | null =
      null;

  private initializePromise:
    Promise<
      BackgroundProcessingAppLifecycleInitializeResult
    > | null =
      null;

  /**
   * جميع انتقالات AppState تمر من خلال
   * Promise Chain واحدة حتى لا تتداخل.
   */
  private transitionChain:
    Promise<void> =
      Promise.resolve();

  private pendingTransitionCount =
    0;

  private initializedAt:
    ProcessingTimestamp | null =
      null;

  private lastStateChangeAt:
    ProcessingTimestamp | null =
      null;

  private lastActiveAt:
    ProcessingTimestamp | null =
      null;

  private lastInactiveAt:
    ProcessingTimestamp | null =
      null;

  private lastBackgroundAt:
    ProcessingTimestamp | null =
      null;

  private lastTransition:
    BackgroundProcessingAppLifecycleTransition | null =
      null;

  private lastError:
    string | null =
      null;

  private warnings:
    string[] =
      [];

  private diagnostics:
    BackgroundProcessingAppLifecycleDiagnostics = {
    initializeCount:
      0,

    initializeFailureCount:
      0,

    transitionCount:
      0,

    transitionFailureCount:
      0,

    ignoredTransitionCount:
      0,

    appStateEventCount:
      0,

    queueStartCount:
      0,

    queueResumeCount:
      0,

    queueFlushCount:
      0,

    queueFailureCount:
      0,

    backgroundStartCount:
      0,

    backgroundStopCount:
      0,

    backgroundFailureCount:
      0,

    recoveryCount:
      0,

    recoveryFailureCount:
      0,

    disposeCount:
      0,

    pendingTransitionCount:
      0,

    lastOperationAt:
      null,

    lastError:
      null,
  };

  constructor(
    options:
      BackgroundProcessingAppLifecycleOptions =
        {}
  ) {
    this.queueService =
      options.queueService ??
      getDefaultScanItemQueueService();

    this.config =
      normalizeConfig(
        options.config
      );

this.backgroundService =
  options.backgroundService ??
  getRegisteredBackgroundProcessingService({
    queueService:
      this.queueService,

    autoInitialize:
      false,

    autoStartWhenPending:
      true,

    resumeQueueWhenApplicationBecomesActive:
      true,

    stopNativeTaskWhenQueueCompletes:
      true,

    manageApplicationStateInternally:
      false,

    enableDebugLogs:
      this.config
        .enableDebugLogs,
  });

    this.onTransition =
      options.onTransition ??
      (() => undefined);

    this.onError =
      options.onError ??
      (() => undefined);

    if (
      options.autoInitialize
    ) {
      void this.initialize();
    }
  }

  /* =======================================================
   * Initialization
   * ===================================================== */

  public initialize():
    Promise<
      BackgroundProcessingAppLifecycleInitializeResult
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
      return Promise.resolve(
        this.createCurrentInitializationResult()
      );
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
      BackgroundProcessingAppLifecycleInitializeResult
    > {
    const startedAt =
      now();

    this.lifecycleState =
      'initializing';

    this.lastError =
      null;

    this.warnings =
      [];

    this.updateDiagnostics({
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
      const queueInitialization =
        await this.queueService
          .initialize(
            false
          );

      const capability =
        await this.backgroundService
          .initialize();

      this.attachAppStateListener();

      const resolvedState =
        resolveApplicationState(
          AppState.currentState
        );

      this.previousApplicationState =
        this.applicationState;

      this.applicationState =
        resolvedState;

      this.lifecycleState =
        resolveLifecycleState(
          resolvedState
        );

      this.initialized =
        true;

      this.initializedAt =
        now();

      this.recordStateTimestamp(
        resolvedState,
        this.initializedAt
      );

      let queueStarted =
        false;

      let queueResumed =
        false;

      let backgroundStarted =
        false;

      if (
        resolvedState ===
          'active'
      ) {
        const queueResult =
          await this.resumeQueueIfNeeded();

        queueStarted =
          queueResult.started;

        queueResumed =
          queueResult.resumed;
      }

      if (
  resolvedState ===
    'background' &&
  supportsClosedAppBackgroundProcessing()
) {
  const result =
    await this.startBackgroundIfNeeded();

  backgroundStarted =
    result.started;

  this.appendWarnings(
    result.warnings
  );
}

      this.appendWarnings(
        queueInitialization
          .warnings
      );

      this.appendWarnings(
        capability.warnings
      );

      const completedAt =
        now();

      this.updateDiagnostics({
        lastOperationAt:
          completedAt,

        lastError:
          null,
      });

      return {
        initialized:
          true,

        state:
          this.lifecycleState,

        applicationState:
          this.applicationState,

        queue:
          this.queueService
            .getSnapshot(),

        background:
          this.backgroundService
            .getSnapshot(),

        capability,

        queueStarted,

        queueResumed,

        backgroundStarted,

        durationMs:
          Math.max(
            0,
            completedAt -
            startedAt
          ),

        warnings:
          this.getWarnings(),
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.lifecycleState =
        'failed';

      this.lastError =
        message;

      this.updateDiagnostics({
        initializeFailureCount:
          this.diagnostics
            .initializeFailureCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      this.emitError(
        error
      );

      throw error;
    }
  }

  private createCurrentInitializationResult():
    BackgroundProcessingAppLifecycleInitializeResult {
    return {
      initialized:
        this.initialized,

      state:
        this.lifecycleState,

      applicationState:
        this.applicationState,

      queue:
        this.queueService
          .getSnapshot(),

      background:
        this.backgroundService
          .getSnapshot(),

      capability:
        this.backgroundService
          .getCapability(),

      queueStarted:
        false,

      queueResumed:
        false,

      backgroundStarted:
        this.backgroundService
          .isRunning(),

      durationMs:
        0,

      warnings:
        this.getWarnings(),
    };
  }

  /* =======================================================
   * AppState
   * ===================================================== */

  private attachAppStateListener():
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
          this.handleNativeAppStateChange(
            nextState
          );
        }
      );
  }

  private handleNativeAppStateChange(
    nativeState:
      AppStateStatus
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.updateDiagnostics({
      appStateEventCount:
        this.diagnostics
          .appStateEventCount +
      1,

      lastOperationAt:
        now(),
    });

    const nextState =
      resolveApplicationState(
        nativeState
      );

    void this.requestTransition(
      nextState,
      'app-state-change'
    ).catch(
      error => {
        this.logError(
          'AppState transition failed.',
          error
        );
      }
    );
  }

  /* =======================================================
   * Transition API
   * ===================================================== */

  public async requestTransition(
    nextState:
      ProcessingApplicationState,
    reason:
      BackgroundProcessingAppLifecycleTransitionReason =
        'unknown'
  ): Promise<
    BackgroundProcessingAppLifecycleTransition
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    let transition:
      BackgroundProcessingAppLifecycleTransition | null =
        null;

    let transitionError:
      unknown;

    this.pendingTransitionCount +=
      1;

    this.updateDiagnostics({
      pendingTransitionCount:
        this.pendingTransitionCount,
    });

    this.transitionChain =
      this.transitionChain.then(
        async () => {
          try {
            transition =
              await this.performTransition(
                nextState,
                reason
              );
          } catch (error) {
            transitionError =
              error;
          } finally {
            this.pendingTransitionCount =
              Math.max(
                0,
                this.pendingTransitionCount -
                  1
              );

            this.updateDiagnostics({
              pendingTransitionCount:
                this.pendingTransitionCount,

              lastOperationAt:
                now(),
            });
          }
        }
      );

    await this.transitionChain;

    if (
      transitionError !==
      undefined
    ) {
      throw transitionError;
    }

    if (
      !transition
    ) {
      throw new Error(
        'Lifecycle transition returned no result.'
      );
    }

    return transition;
  }

  public transitionToActive():
    Promise<
      BackgroundProcessingAppLifecycleTransition
    > {
    return this.requestTransition(
      'active',
      'manual-active'
    );
  }

  public transitionToInactive():
    Promise<
      BackgroundProcessingAppLifecycleTransition
    > {
    return this.requestTransition(
      'inactive',
      'manual-inactive'
    );
  }

  public transitionToBackground():
    Promise<
      BackgroundProcessingAppLifecycleTransition
    > {
    return this.requestTransition(
      'background',
      'manual-background'
    );
  }

  public synchronizeWithCurrentAppState():
    Promise<
      BackgroundProcessingAppLifecycleTransition
    > {
    return this.requestTransition(
      resolveApplicationState(
        AppState.currentState
      ),
      'synchronization'
    );
  }

  /* =======================================================
   * Transition execution
   * ===================================================== */

  private async performTransition(
    nextState:
      ProcessingApplicationState,
    reason:
      BackgroundProcessingAppLifecycleTransitionReason
  ): Promise<
    BackgroundProcessingAppLifecycleTransition
  > {
    const previousState =
      this.applicationState;

    const startedAt =
      now();

    const queueBefore =
      this.queueService
        .getSnapshot();

    const context:
      LifecycleTransitionContext = {
      id:
        createTransitionId(),

      previousState,

      nextState,

      reason,

      startedAt,

      queueStatusBefore:
        queueBefore.status,

      queueStarted:
        false,

      queueResumed:
        false,

      queueFlushed:
        false,

      backgroundStarted:
        false,

      backgroundStopped:
        false,

      errorMessage:
        null,
    };

    if (
      nextState ===
        previousState
    ) {
      this.updateDiagnostics({
        ignoredTransitionCount:
          this.diagnostics
            .ignoredTransitionCount +
        1,

        lastOperationAt:
          now(),
      });

      const ignoredTransition =
        this.finishTransition(
          context,
          true
        );

      this.lastTransition =
        ignoredTransition;

      return ignoredTransition;
    }

    this.transitioning =
      true;

    this.lifecycleState =
      'transitioning';

    try {
      if (
        nextState ===
          'active'
      ) {
        await this.handleActiveState(
          context
        );
      } else if (
        nextState ===
          'inactive'
      ) {
        await this.handleInactiveState(
          context
        );
      } else if (
        nextState ===
          'background'
      ) {
        await this.handleBackgroundState(
          context
        );
      }

      this.previousApplicationState =
        previousState;

      this.applicationState =
        nextState;

      this.lifecycleState =
        resolveLifecycleState(
          nextState
        );

      this.recordStateTimestamp(
        nextState,
        now()
      );

      const result =
        this.finishTransition(
          context,
          true
        );

      this.lastTransition =
        result;

      this.lastError =
        null;

      this.updateDiagnostics({
        transitionCount:
          this.diagnostics
            .transitionCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      this.emitTransition(
        result
      );

      return result;
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      context.errorMessage =
        message;

      this.lifecycleState =
        'failed';

      this.lastError =
        message;

      const result =
        this.finishTransition(
          context,
          false
        );

      this.lastTransition =
        result;

      this.updateDiagnostics({
        transitionCount:
          this.diagnostics
            .transitionCount +
        1,

        transitionFailureCount:
          this.diagnostics
            .transitionFailureCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      this.emitTransition(
        result
      );

      this.emitError(
        error
      );

      throw error;
    } finally {
      this.transitioning =
        false;
    }
  }

  /* =======================================================
   * Active
   * ===================================================== */

  private async handleActiveState(
    context:
      LifecycleTransitionContext
  ): Promise<void> {
   if (
  supportsClosedAppBackgroundProcessing() &&
  this.config
    .stopBackgroundTaskWhenApplicationBecomesActive &&
  this.backgroundService
    .isRunning()
) {
      try {
        const result =
          await this.backgroundService
            .stop(
              'Application returned to the foreground.'
            );

        context.backgroundStopped =
          result.stopped;

        if (
          result.stopped
        ) {
          this.updateDiagnostics({
            backgroundStopCount:
              this.diagnostics
                .backgroundStopCount +
            1,
          });
        }
      } catch (error) {
        this.updateDiagnostics({
          backgroundFailureCount:
            this.diagnostics
              .backgroundFailureCount +
          1,
        });

        throw error;
      }
    }

    const result =
      await this.resumeQueueIfNeeded();

    context.queueStarted =
      result.started;

    context.queueResumed =
      result.resumed;
  }

  /* =======================================================
   * Inactive
   * ===================================================== */

  private async handleInactiveState(
    context:
      LifecycleTransitionContext
  ): Promise<void> {
    if (
      !this.config
        .flushQueueWhenApplicationBecomesInactive
    ) {
      return;
    }

    await this.flushQueue(
      context
    );
  }

  /* =======================================================
   * Background
   * ===================================================== */

  private async handleBackgroundState(
  context:
    LifecycleTransitionContext
): Promise<void> {
  /*
   * نحفظ Queue على المنصتين حتى لا تضيع حالتها.
   */
  if (
    this.config
      .flushQueueBeforeBackground
  ) {
    await this.flushQueue(
      context
    );
  }

  /*
   * iOS:
   * لا نبدأ أي Native Background Task.
   * المعالجة ستستكمل عند رجوع التطبيق للواجهة.
   */
  if (
    !supportsClosedAppBackgroundProcessing()
  ) {
    return;
  }

  /*
   * Android فقط:
   * يحافظ على WorkManager / Foreground Service.
   */
  if (
    !this.config
      .startBackgroundTaskWhenApplicationEntersBackground
  ) {
    return;
  }

  const result =
    await this.startBackgroundIfNeeded();

  context.backgroundStarted =
    result.started;

  this.appendWarnings(
    result.warnings
  );
}

  /* =======================================================
   * Queue
   * ===================================================== */

  private async resumeQueueIfNeeded():
    Promise<{
      started:
        boolean;

      resumed:
        boolean;
    }> {
    if (
      !this.config
        .resumeQueueWhenApplicationBecomesActive
    ) {
      return {
        started:
          false,

        resumed:
          false,
      };
    }

    const snapshot =
      this.queueService
        .getSnapshot();

    if (
      !hasQueueWork(
        snapshot
      ) ||
      !this.queueService
        .hasExecutor() ||
      this.queueService
        .isRunning()
    ) {
      return {
        started:
          false,

        resumed:
          false,
      };
    }

    try {
      if (
        snapshot.status ===
          'paused' ||
        snapshot.status ===
          'stopped'
      ) {
        await this.queueService
          .resume();

        this.updateDiagnostics({
          queueResumeCount:
            this.diagnostics
              .queueResumeCount +
          1,
        });

        return {
          started:
            false,

          resumed:
            true,
        };
      }

      await this.queueService
        .start();

      this.updateDiagnostics({
        queueStartCount:
          this.diagnostics
            .queueStartCount +
        1,
      });

      return {
        started:
          true,

        resumed:
          false,
      };
    } catch (error) {
      this.updateDiagnostics({
        queueFailureCount:
          this.diagnostics
            .queueFailureCount +
        1,

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      throw error;
    }
  }

  private async flushQueue(
    context:
      LifecycleTransitionContext
  ): Promise<void> {
    try {
      await this.queueService
        .flush();

      context.queueFlushed =
        true;

      this.updateDiagnostics({
        queueFlushCount:
          this.diagnostics
            .queueFlushCount +
        1,
      });
    } catch (error) {
      this.updateDiagnostics({
        queueFailureCount:
          this.diagnostics
            .queueFailureCount +
        1,

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      throw error;
    }
  }

  /* =======================================================
   * Background service
   * ===================================================== */

  public async startBackgroundProcessing():
    Promise<
      BackgroundProcessingStartResult
    > {
      if (
  !supportsClosedAppBackgroundProcessing()
) {
  return this.createNotStartedResult(
    'Closed-app processing is disabled on iOS. Processing resumes while the app is open.'
  );
}
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    return this.startBackgroundIfNeeded();
  }

  private async startBackgroundIfNeeded():
    Promise<
      BackgroundProcessingStartResult
    > {
    const queueSnapshot =
      this.queueService
        .getSnapshot();

    if (
      this.config
        .requirePendingJobs &&
      !hasQueueWork(
        queueSnapshot
      )
    ) {
      return this.createNotStartedResult(
        'The processing queue does not contain pending items.'
      );
    }

    if (
      this.backgroundService
        .isRunning()
    ) {
      const backgroundSnapshot =
        this.backgroundService
          .getSnapshot();

      return {
        started:
          true,

        alreadyRunning:
          true,

        state:
          backgroundSnapshot.state,

        capability:
          this.backgroundService
            .getCapability(),

        nativeTaskId:
          backgroundSnapshot
            .nativeTaskId,

        nativeJobId:
          backgroundSnapshot
            .nativeJobId,

        snapshot:
          queueSnapshot,

        warnings:
          backgroundSnapshot
            .warnings,
      };
    }

    let capability =
      this.backgroundService
        .getCapability();

    if (
      this.config
        .refreshCapabilityBeforeStart
    ) {
      capability =
        await this.backgroundService
          .refreshCapability();
    }

    if (
      !capability.available
    ) {
      this.appendWarnings(
        [
          capability.message,
          ...capability.warnings,
        ]
      );

      return this.createNotStartedResult(
        capability.message,
        capability
      );
    }

    try {
      const result =
        await this.backgroundService
          .start();

      if (
        result.started &&
        !result.alreadyRunning
      ) {
        this.updateDiagnostics({
          backgroundStartCount:
            this.diagnostics
              .backgroundStartCount +
          1,
        });
      }

      if (
        !result.started
      ) {
        this.updateDiagnostics({
          backgroundFailureCount:
            this.diagnostics
              .backgroundFailureCount +
          1,
        });
      }

      return result;
    } catch (error) {
      this.updateDiagnostics({
        backgroundFailureCount:
          this.diagnostics
            .backgroundFailureCount +
        1,

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      throw error;
    }
  }

  private createNotStartedResult(
    warning:
      string,
    capability:
      BackgroundProcessingCapabilityResult =
        this.backgroundService
          .getCapability()
  ): BackgroundProcessingStartResult {
    const snapshot =
      this.backgroundService
        .getSnapshot();

    return {
      started:
        false,

      alreadyRunning:
        false,

      state:
        snapshot.state,

      capability,

      nativeTaskId:
        snapshot.nativeTaskId,

      nativeJobId:
        snapshot.nativeJobId,

      snapshot:
        this.queueService
          .getSnapshot(),

      warnings: [
        warning,
      ],
    };
  }

  public async stopBackgroundProcessing(
    reason =
      'Background processing stopped.'
  ): Promise<
      BackgroundProcessingStopResult
    > {
    this.assertNotDisposed();

    const result =
      await this.backgroundService
        .stop(
          reason
        );

    if (
      result.stopped
    ) {
      this.updateDiagnostics({
        backgroundStopCount:
          this.diagnostics
            .backgroundStopCount +
        1,
      });
    }

    return result;
  }

  /* =======================================================
   * Recovery
   * ===================================================== */

  public async recover():
    Promise<boolean> {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    this.updateDiagnostics({
      recoveryCount:
        this.diagnostics
          .recoveryCount +
      1,
    });

    try {
     if (
  this.applicationState ===
    'background'
) {
  /*
   * نحفظ الحالة فقط على iOS.
   * Android يظل قادرًا على استكمال المعالجة بالخلفية.
   */
  if (
    !supportsClosedAppBackgroundProcessing()
  ) {
    await this.queueService
      .flush();

    return true;
  }

  const result =
    await this.startBackgroundIfNeeded();

  return (
    result.started ||
    result.alreadyRunning
  );
}

      const result =
        await this.resumeQueueIfNeeded();

      return (
        result.started ||
        result.resumed ||
        this.queueService
          .isRunning() ||
        !hasQueueWork(
          this.queueService
            .getSnapshot()
        )
      );
    } catch (error) {
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

      this.emitError(
        error
      );

      return false;
    }
  }

  /* =======================================================
   * Transition result
   * ===================================================== */

  private finishTransition(
    context:
      LifecycleTransitionContext,
    succeeded:
      boolean
  ): BackgroundProcessingAppLifecycleTransition {
    const completedAt =
      now();

    return {
      id:
        context.id,

      previousState:
        context.previousState,

      nextState:
        context.nextState,

      reason:
        context.reason,

      startedAt:
        context.startedAt,

      completedAt,

      durationMs:
        Math.max(
          0,
          completedAt -
          context.startedAt
        ),

      queueStatusBefore:
        context.queueStatusBefore,

      queueStatusAfter:
        this.queueService
          .getSnapshot()
          .status,

      queueStarted:
        context.queueStarted,

      queueResumed:
        context.queueResumed,

      queueFlushed:
        context.queueFlushed,

      backgroundStarted:
        context.backgroundStarted,

      backgroundStopped:
        context.backgroundStopped,

      succeeded,

      errorMessage:
        context.errorMessage,
    };
  }

  /* =======================================================
   * Queries
   * ===================================================== */

  public getQueueSnapshot():
    ProcessingQueueSnapshot {
    return this.queueService
      .getSnapshot();
  }

  public getBackgroundSnapshot():
    BackgroundProcessingServiceSnapshot {
    return this.backgroundService
      .getSnapshot();
  }

  public getCapability():
    BackgroundProcessingCapabilityResult {
    return this.backgroundService
      .getCapability();
  }

  public getApplicationState():
    ProcessingApplicationState {
    return this.applicationState;
  }

  public isApplicationActive():
    boolean {
    return (
      this.applicationState ===
      'active'
    );
  }

  public isApplicationInBackground():
    boolean {
    return (
      this.applicationState ===
      'background'
    );
  }

  public isInitialized():
    boolean {
    return this.initialized;
  }

  public isDisposed():
    boolean {
    return this.disposed;
  }

  public getSnapshot():
    BackgroundProcessingAppLifecycleSnapshot {
    const queue =
      this.queueService
        .getSnapshot();

    const background =
      this.backgroundService
        .getSnapshot();

    return {
      state:
        this.lifecycleState,

      initialized:
        this.initialized,

      disposed:
        this.disposed,

      transitioning:
        this.transitioning,

      listenerAttached:
        this.appStateSubscription !==
        null,

      applicationState:
        this.applicationState,

      previousApplicationState:
        this.previousApplicationState,

      queueStatus:
        queue.status,

      queueRunning:
        this.queueService
          .isRunning(),

      backgroundCapability:
        background.capability,

      backgroundRunning:
        background.running,

      activeJobId:
        queue.activeJobId,

      pendingJobCount:
        queue.statistics.pending +
        queue.statistics.active,

      initializedAt:
        this.initializedAt,

      lastStateChangeAt:
        this.lastStateChangeAt,

      lastActiveAt:
        this.lastActiveAt,

      lastInactiveAt:
        this.lastInactiveAt,

      lastBackgroundAt:
        this.lastBackgroundAt,

      lastTransition:
        cloneTransition(
          this.lastTransition
        ),

      lastError:
        this.lastError,

      warnings:
        this.getWarnings(),
    };
  }

  public getDiagnostics():
    BackgroundProcessingAppLifecycleDiagnostics {
    return {
      ...this.diagnostics,

      pendingTransitionCount:
        this.pendingTransitionCount,

      lastError:
        this.lastError ??
        this.diagnostics
          .lastError,
    };
  }

  /* =======================================================
   * Internal state
   * ===================================================== */

  private recordStateTimestamp(
    state:
      ProcessingApplicationState,
    timestamp:
      ProcessingTimestamp
  ): void {
    this.lastStateChangeAt =
      timestamp;

    if (
      state ===
        'active'
    ) {
      this.lastActiveAt =
        timestamp;
    }

    if (
      state ===
        'inactive'
    ) {
      this.lastInactiveAt =
        timestamp;
    }

    if (
      state ===
        'background'
    ) {
      this.lastBackgroundAt =
        timestamp;
    }
  }

  private updateDiagnostics(
    updates:
      Partial<
        BackgroundProcessingAppLifecycleDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...updates,
    };
  }

  private getWarnings():
    readonly string[] {
    return [
      ...new Set(
        this.warnings
      ),
    ];
  }

  private appendWarnings(
    warnings:
      readonly string[]
  ): void {
    for (
      const warning of
      warnings
    ) {
      const normalized =
        warning.trim();

      if (
        normalized.length ===
          0 ||
        this.warnings.includes(
          normalized
        )
      ) {
        continue;
      }

      this.warnings.push(
        normalized
      );
    }
  }

  private emitTransition(
    transition:
      BackgroundProcessingAppLifecycleTransition
  ): void {
    try {
      this.onTransition(
        transition
      );
    } catch (error) {
      this.logError(
        'Transition callback failed.',
        error
      );
    }
  }

  private emitError(
    error:
      unknown
  ): void {
    const normalized =
      error instanceof Error
        ? error
        : new Error(
            getUnknownErrorMessage(
              error
            )
          );

    try {
      this.onError(
        normalized
      );
    } catch (callbackError) {
      this.logError(
        'Error callback failed.',
        callbackError
      );
    }
  }

  private logError(
    message:
      string,
    error:
      unknown
  ): void {
    if (
      !this.config
        .enableDebugLogs
    ) {
      return;
    }

    console.warn(
      `TRIPLE N BACKGROUND LIFECYCLE: ${message}`,
      error
    );
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

    this.lifecycleState =
      'disposing';

    this.appStateSubscription
      ?.remove();

    this.appStateSubscription =
      null;

    try {
      await this.transitionChain;
    } catch {
      // الأخطاء تم تسجيلها من قبل.
    }

    try {
      await this.queueService
        .flush();
    } catch (error) {
      this.logError(
        'Queue flush during dispose failed.',
        error
      );
    }

    this.initialized =
      false;

    this.transitioning =
      false;

    this.disposed =
      true;

    this.lifecycleState =
      'disposed';

    this.updateDiagnostics({
      disposeCount:
        this.diagnostics
          .disposeCount +
      1,

      pendingTransitionCount:
        0,

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
        'Background processing app lifecycle has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultBackgroundProcessingAppLifecycle:
  BackgroundProcessingAppLifecycle | null =
    null;

export function getDefaultBackgroundProcessingAppLifecycle(
  options?:
    BackgroundProcessingAppLifecycleOptions
): BackgroundProcessingAppLifecycle {
  if (
    !defaultBackgroundProcessingAppLifecycle
  ) {
    defaultBackgroundProcessingAppLifecycle =
      new BackgroundProcessingAppLifecycle(
        options
      );
  }

  return defaultBackgroundProcessingAppLifecycle;
}

export function initializeBackgroundProcessingAppLifecycle(
  options?:
    BackgroundProcessingAppLifecycleOptions
): Promise<
  BackgroundProcessingAppLifecycleInitializeResult
> {
  return getDefaultBackgroundProcessingAppLifecycle(
    options
  ).initialize();
}

export function synchronizeBackgroundProcessingAppLifecycle():
  Promise<
    BackgroundProcessingAppLifecycleTransition
  > {
  return getDefaultBackgroundProcessingAppLifecycle()
    .synchronizeWithCurrentAppState();
}

export function recoverBackgroundProcessingAppLifecycle():
  Promise<boolean> {
  return getDefaultBackgroundProcessingAppLifecycle()
    .recover();
}

export function getBackgroundProcessingAppLifecycleSnapshot():
  BackgroundProcessingAppLifecycleSnapshot {
  return getDefaultBackgroundProcessingAppLifecycle()
    .getSnapshot();
}

export function getBackgroundProcessingAppLifecycleDiagnostics():
  BackgroundProcessingAppLifecycleDiagnostics {
  return getDefaultBackgroundProcessingAppLifecycle()
    .getDiagnostics();
}

export async function disposeBackgroundProcessingAppLifecycle():
  Promise<void> {
  if (
    !defaultBackgroundProcessingAppLifecycle
  ) {
    return;
  }

  await defaultBackgroundProcessingAppLifecycle
    .dispose();

  defaultBackgroundProcessingAppLifecycle =
    null;
}

export default
  BackgroundProcessingAppLifecycle;