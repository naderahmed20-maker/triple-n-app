// scan/core/services/BackgroundProcessingService.ts
//
// Triple N - Background Processing Service
//
// هذا الملف هو مدير تشغيل Queue في الخلفية.
//
// مسؤولياته:
//
// 1) اكتشاف المنصة الحالية iOS أو Android.
// 2) فحص قدرة الجهاز على تشغيل Background Processing.
// 3) ربط Queue بالـNative Background Driver المناسب.
// 4) بدء جلسة معالجة خلفية عند وجود صور معلقة.
// 5) إبقاء صورة واحدة فقط قيد التنفيذ في كل مرة.
// 6) تحديث Native Background Task مع تغييرات Queue.
// 7) إيقاف الجلسة عند اكتمال الطابور.
// 8) التعامل مع انتهاء وقت iOS Background Task.
// 9) التعامل مع Android WorkManager / Foreground Service.
// 10) استكمال Queue عند رجوع التطبيق.
// 11) حفظ حالة Background Processing بشكل آمن.
// 12) عدم وضع أي منطق EdgeSAM داخل هذا الملف.
// 13) دعم تعطيل AppState الداخلي عند استخدام
//     BackgroundProcessingAppLifecycle.
//
// هذا الملف لا يحتوي Native implementation بنفسه.
//
// التنفيذ الفعلي يتم تمريره عبر:
//
// BackgroundProcessingDriver

import {
  AppState,
  Platform,
  type AppStateStatus,
} from 'react-native';

import type {
  ProcessingApplicationState,
  ProcessingBackgroundCapability,
  ProcessingBatchId,
  ProcessingJob,
  ProcessingJobError,
  ProcessingJobId,
  ProcessingPlatform,
  ProcessingQueueEvent,
  ProcessingQueueSnapshot,
  ProcessingQueueStatus,
  ProcessingTimestamp,
} from '../queue/QueueTypes';

import type {
  ProcessingQueueEventSubscription,
} from '../queue/QueueEvents';

import type {
  ScanItemQueueService,
} from './ScanItemQueueService';

import {
  getDefaultScanItemQueueService,
} from './ScanItemQueueService';

/* =========================================================
 * Service state
 * ======================================================= */

export type BackgroundProcessingServiceState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'restricted'
  | 'unavailable'
  | 'failed'
  | 'disposed';

/* =========================================================
 * Native task state
 * ======================================================= */

export type BackgroundNativeTaskState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'expiring'
  | 'stopping'
  | 'stopped'
  | 'failed';

/* =========================================================
 * Driver capability
 * ======================================================= */

export type BackgroundProcessingCapabilityResult = {
  platform:
    ProcessingPlatform;

  capability:
    ProcessingBackgroundCapability;

  available:
    boolean;

  restricted:
    boolean;

  message:
    string;

  warnings:
    readonly string[];
};

/* =========================================================
 * Native task payload
 * ======================================================= */

export type BackgroundProcessingTaskPayload = {
  queueId:
    string;

  batchId:
    ProcessingBatchId | null;

  activeJobId:
    ProcessingJobId | null;

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
    ProcessingTimestamp;

  updatedAt:
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
 * Driver start result
 * ======================================================= */

export type BackgroundProcessingDriverStartResult = {
  started:
    boolean;

  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  expirationAt:
    ProcessingTimestamp | null;

  capability:
    ProcessingBackgroundCapability;

  warnings:
    readonly string[];
};

/* =========================================================
 * Driver update request
 * ======================================================= */

export type BackgroundProcessingDriverUpdateRequest = {
  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  payload:
    BackgroundProcessingTaskPayload;

  snapshot:
    ProcessingQueueSnapshot;
};

/* =========================================================
 * Driver stop request
 * ======================================================= */

export type BackgroundProcessingDriverStopRequest = {
  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  reason:
    string;

  completed:
    boolean;

  snapshot:
    ProcessingQueueSnapshot;
};

/* =========================================================
 * Driver callbacks
 * ======================================================= */

export type BackgroundProcessingDriverCallbacks = {
  onExpiration(
    reason:
      string
  ): void;

  onStopped(
    reason:
      string
  ): void;

  onFailure(
    error:
      unknown
  ): void;

  onResumeRequested():
    void;
};

/* =========================================================
 * Driver contract
 * ======================================================= */

export type BackgroundProcessingDriver = {
  readonly platform:
    ProcessingPlatform;

  initialize():
    Promise<
      BackgroundProcessingCapabilityResult
    >;

  getCapability():
    Promise<
      BackgroundProcessingCapabilityResult
    >;

  start(
    payload:
      BackgroundProcessingTaskPayload,
    callbacks:
      BackgroundProcessingDriverCallbacks
  ): Promise<
      BackgroundProcessingDriverStartResult
    >;

  update?(
    request:
      BackgroundProcessingDriverUpdateRequest
  ): Promise<void>;

  stop(
    request:
      BackgroundProcessingDriverStopRequest
  ): Promise<void>;

  dispose?():
    Promise<void>;
};

/* =========================================================
 * Service options
 * ======================================================= */

export type BackgroundProcessingServiceOptions = {
  queueService?:
    ScanItemQueueService;

  androidDriver?:
    BackgroundProcessingDriver | null;

  unknownPlatformDriver?:
    BackgroundProcessingDriver | null;

  autoInitialize?:
    boolean;

  autoStartWhenPending?:
    boolean;

  resumeQueueWhenApplicationBecomesActive?:
    boolean;

  stopNativeTaskWhenQueueCompletes?:
    boolean;

  /**
   * عند true تستمع الخدمة إلى AppState بنفسها.
   *
   * عند استخدام BackgroundProcessingAppLifecycle
   * يجب تمرير false حتى لا يوجد أكثر من Listener
   * يحاول تشغيل وإيقاف Queue في الوقت نفسه.
   *
   * الافتراضي true للمحافظة على التوافق القديم.
   */
  manageApplicationStateInternally?:
    boolean;

  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Start result
 * ======================================================= */

export type BackgroundProcessingStartResult = {
  started:
    boolean;

  alreadyRunning:
    boolean;

  state:
    BackgroundProcessingServiceState;

  capability:
    BackgroundProcessingCapabilityResult;

  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  snapshot:
    ProcessingQueueSnapshot;

  warnings:
    readonly string[];
};

/* =========================================================
 * Stop result
 * ======================================================= */

export type BackgroundProcessingStopResult = {
  stopped:
    boolean;

  state:
    BackgroundProcessingServiceState;

  reason:
    string;

  snapshot:
    ProcessingQueueSnapshot;
};

/* =========================================================
 * Public snapshot
 * ======================================================= */

export type BackgroundProcessingServiceSnapshot = {
  state:
    BackgroundProcessingServiceState;

  nativeTaskState:
    BackgroundNativeTaskState;

  platform:
    ProcessingPlatform;

  capability:
    ProcessingBackgroundCapability;

  initialized:
    boolean;

  running:
    boolean;

  disposed:
    boolean;

  applicationState:
    ProcessingApplicationState;

  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  startedAt:
    ProcessingTimestamp | null;

  updatedAt:
    ProcessingTimestamp;

  expirationAt:
    ProcessingTimestamp | null;

  activeJobId:
    ProcessingJobId | null;

  pendingJobCount:
    number;

  queueStatus:
    ProcessingQueueStatus;

  lastError:
    ProcessingJobError | null;

  warnings:
    readonly string[];
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type BackgroundProcessingServiceDiagnostics = {
  initializeCount:
    number;

  startCount:
    number;

  stopCount:
    number;

  expirationCount:
    number;

  failureCount:
    number;

  resumeCount:
    number;

  queueEventCount:
    number;

  nativeUpdateCount:
    number;

  nativeUpdateFailureCount:
    number;

  applicationStateChangeCount:
    number;

  lastQueueEventType:
    ProcessingQueueEvent['type'] | null;

  lastOperationAt:
    ProcessingTimestamp | null;

  lastErrorMessage:
    string | null;
};

/* =========================================================
 * Listener
 * ======================================================= */

export type BackgroundProcessingServiceListener = (
  snapshot:
    BackgroundProcessingServiceSnapshot
) => void;

/* =========================================================
 * Internal helpers
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
    // نستخدم String في النهاية.
  }

  return String(
    error
  );
}

function resolvePlatform():
  ProcessingPlatform {
  if (
    Platform.OS ===
      'ios'
  ) {
    return 'ios';
  }

  if (
    Platform.OS ===
      'android'
  ) {
    return 'android';
  }

  return 'unknown';
}

function resolveApplicationState(
  state:
    AppStateStatus
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

function cloneProcessingError(
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

function createBackgroundError(
  message:
    string,
  source:
    ProcessingJobError['source'],
  code:
    ProcessingJobError['code'],
  retryable:
    boolean,
  metadata:
    ProcessingJobError['metadata'] =
      {}
): ProcessingJobError {
  return {
    code,

    message,

    source,

    retryable,

    occurredAt:
      now(),

    attempt:
      0,

    stage:
      null,

    nativeCode:
      null,

    segmentationErrorCode:
      null,

    metadata: {
      ...metadata,
    },
  };
}

function createUnavailableCapability(
  platform:
    ProcessingPlatform,
  message:
    string
): BackgroundProcessingCapabilityResult {
  return {
    platform,

    capability:
      'unavailable',

    available:
      false,

    restricted:
      false,

    message,

    warnings:
      [],
  };
}

function createTaskPayload(
  snapshot:
    ProcessingQueueSnapshot,
  startedAt:
    ProcessingTimestamp
): BackgroundProcessingTaskPayload {
  return {
    queueId:
      snapshot.queueId,

    batchId:
      snapshot.currentBatchId,

    activeJobId:
      snapshot.activeJobId,

    pendingJobCount:
      snapshot.statistics
        .pending +
      snapshot.statistics
        .active,

    totalJobCount:
      snapshot.statistics.total,

    completedJobCount:
      snapshot.statistics
        .completed,

    failedJobCount:
      snapshot.statistics.failed,

    overallProgress:
      snapshot.statistics
        .overallProgress,

    overallPercentage:
      snapshot.statistics
        .overallPercentage,

    estimatedRemainingMs:
      snapshot.statistics
        .estimatedRemainingMs,

    startedAt,

    updatedAt:
      now(),

    metadata: {
      queueStatus:
        snapshot.status,

      revision:
        snapshot.revision,

      cancelledItems:
        snapshot.statistics
          .cancelled,

      retryScheduledItems:
        snapshot.statistics
          .retryScheduled,
    },
  };
}

function isQueueComplete(
  snapshot:
    ProcessingQueueSnapshot
): boolean {
  return (
    snapshot.statistics.total >
      0 &&
    snapshot.statistics.terminal ===
      snapshot.statistics.total
  );
}

function hasProcessableQueueWork(
  snapshot:
    ProcessingQueueSnapshot
): boolean {
  return (
    snapshot.statistics.pending >
      0 ||
    snapshot.statistics.active >
      0 ||
    snapshot.status ===
      'running'
  );
}

/* =========================================================
 * Service class
 * ======================================================= */

export class BackgroundProcessingService {
  private readonly queueService:
    ScanItemQueueService;

  private readonly androidDriver:
    BackgroundProcessingDriver | null;

  private readonly unknownPlatformDriver:
    BackgroundProcessingDriver | null;

  private readonly autoStartWhenPending:
    boolean;

  private readonly resumeQueueWhenApplicationBecomesActive:
    boolean;

  private readonly stopNativeTaskWhenQueueCompletes:
    boolean;

  private readonly manageApplicationStateInternally:
    boolean;

  private readonly enableDebugLogs:
    boolean;

  private readonly platform:
    ProcessingPlatform;

  private readonly listeners =
    new Set<
      BackgroundProcessingServiceListener
    >();

  private state:
    BackgroundProcessingServiceState =
      'uninitialized';

  private nativeTaskState:
    BackgroundNativeTaskState =
      'idle';

  private capability:
    BackgroundProcessingCapabilityResult;

  private initialized =
    false;

  private disposed =
    false;

  private nativeTaskId:
    string | null =
      null;

  private nativeJobId:
    string | null =
      null;

  private startedAt:
    ProcessingTimestamp | null =
      null;

  private expirationAt:
    ProcessingTimestamp | null =
      null;

  private updatedAt:
    ProcessingTimestamp =
      now();

  private applicationState:
    ProcessingApplicationState =
      resolveApplicationState(
        AppState.currentState
      );

  private latestQueueSnapshot:
    ProcessingQueueSnapshot;

  private lastError:
    ProcessingJobError | null =
      null;

  private warnings:
    string[] =
      [];

  private initializePromise:
    Promise<
      BackgroundProcessingCapabilityResult
    > | null =
      null;

  private startPromise:
    Promise<
      BackgroundProcessingStartResult
    > | null =
      null;

  private stopPromise:
    Promise<
      BackgroundProcessingStopResult
    > | null =
      null;

  private queueSubscription:
    ProcessingQueueEventSubscription | null =
      null;

  private appStateSubscription:
    ReturnType<
      typeof AppState.addEventListener
    > | null =
      null;

  private diagnostics:
    BackgroundProcessingServiceDiagnostics = {
    initializeCount:
      0,

    startCount:
      0,

    stopCount:
      0,

    expirationCount:
      0,

    failureCount:
      0,

    resumeCount:
      0,

    queueEventCount:
      0,

    nativeUpdateCount:
      0,

    nativeUpdateFailureCount:
      0,

    applicationStateChangeCount:
      0,

    lastQueueEventType:
      null,

    lastOperationAt:
      null,

    lastErrorMessage:
      null,
  };

  constructor(
    options:
      BackgroundProcessingServiceOptions =
        {}
  ) {
    this.queueService =
      options.queueService ??
      getDefaultScanItemQueueService();

    this.androidDriver =
      options.androidDriver ??
      null;

    this.unknownPlatformDriver =
      options
        .unknownPlatformDriver ??
      null;

    this.autoStartWhenPending =
      options
        .autoStartWhenPending ??
      true;

    this.resumeQueueWhenApplicationBecomesActive =
      options
        .resumeQueueWhenApplicationBecomesActive ??
      true;

    this.stopNativeTaskWhenQueueCompletes =
      options
        .stopNativeTaskWhenQueueCompletes ??
      true;

    this.manageApplicationStateInternally =
      options
        .manageApplicationStateInternally ??
      true;

    this.enableDebugLogs =
      options.enableDebugLogs ??
      false;

    this.platform =
      resolvePlatform();

    this.capability =
      createUnavailableCapability(
        this.platform,
        'Background processing has not been initialized.'
      );

    this.latestQueueSnapshot =
      this.queueService
        .getSnapshot();

    this.attachQueueEvents();

    if (
      this.manageApplicationStateInternally
    ) {
      this.attachApplicationState();
    }

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
      BackgroundProcessingCapabilityResult
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
      return Promise.resolve({
        ...this.capability,

        warnings: [
          ...this.capability
            .warnings,
        ],
      });
    }

    this.state =
      'initializing';

    this.updatedAt =
      now();

    this.notifyListeners();

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
      BackgroundProcessingCapabilityResult
    > {
    const driver =
      this.resolveDriver();

    try {
      await this.queueService
        .initialize(
          false
        );

      if (
        !driver
      ) {
        this.capability =
          createUnavailableCapability(
            this.platform,
            `No background processing driver is registered for ${this.platform}.`
          );

        this.initialized =
          true;

        this.state =
          'unavailable';

        this.updatedAt =
          now();

        this.diagnostics = {
          ...this.diagnostics,

          initializeCount:
            this.diagnostics
              .initializeCount +
            1,

          lastOperationAt:
            this.updatedAt,
        };

        this.notifyListeners();

        return {
          ...this.capability,

          warnings: [
            ...this.capability
              .warnings,
          ],
        };
      }

      this.capability =
        await driver.initialize();

      this.initialized =
        true;

      if (
        this.capability
          .available
      ) {
        this.state =
          'ready';
      } else if (
        this.capability
          .restricted
      ) {
        this.state =
          'restricted';
      } else {
        this.state =
          'unavailable';
      }

      this.warnings = [
        ...this.capability
          .warnings,
      ];

      this.updatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        initializeCount:
          this.diagnostics
            .initializeCount +
          1,

        lastOperationAt:
          this.updatedAt,

        lastErrorMessage:
          null,
      };

      this.notifyListeners();

      if (
        this.autoStartWhenPending &&
        this.capability
          .available &&
        hasProcessableQueueWork(
          this.latestQueueSnapshot
        )
      ) {
        void this.start();
      }

      return {
        ...this.capability,

        warnings: [
          ...this.capability
            .warnings,
        ],
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.lastError =
        createBackgroundError(
          message,
          this.platform ===
            'ios'
            ? 'ios-background'
            : this.platform ===
                'android'
              ? 'android-background'
              : 'unknown',
          'BACKGROUND_PROCESSING_START_FAILED',
          true,
          {
            operation:
              'initialize',
          }
        );

      this.state =
        'failed';

      this.nativeTaskState =
        'failed';

      this.updatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        initializeCount:
          this.diagnostics
            .initializeCount +
          1,

        failureCount:
          this.diagnostics
            .failureCount +
          1,

        lastOperationAt:
          this.updatedAt,

        lastErrorMessage:
          message,
      };

      this.notifyListeners();

      throw error;
    }
  }

  /* =======================================================
   * Capability
   * ===================================================== */

  public async refreshCapability():
    Promise<
      BackgroundProcessingCapabilityResult
    > {
    this.assertNotDisposed();

    const driver =
      this.resolveDriver();

    if (
      !driver
    ) {
      this.capability =
        createUnavailableCapability(
          this.platform,
          `No background processing driver is registered for ${this.platform}.`
        );

      this.state =
        'unavailable';

      this.updatedAt =
        now();

      this.notifyListeners();

      return {
        ...this.capability,

        warnings: [
          ...this.capability
            .warnings,
        ],
      };
    }

    this.capability =
      await driver.getCapability();

    if (
      !this.capability
        .available
    ) {
      this.state =
        this.capability
          .restricted
          ? 'restricted'
          : 'unavailable';
    } else if (
      !this.isRunning()
    ) {
      this.state =
        'ready';
    }

    this.warnings = [
      ...this.capability
        .warnings,
    ];

    this.updatedAt =
      now();

    this.notifyListeners();

    return {
      ...this.capability,

      warnings: [
        ...this.capability
          .warnings,
      ],
    };
  }

  /* =======================================================
   * Start
   * ===================================================== */

  public start():
    Promise<
      BackgroundProcessingStartResult
    > {
    this.assertNotDisposed();

    if (
      this.startPromise
    ) {
      return this.startPromise;
    }

    this.startPromise =
      this.startInternal()
        .finally(
          () => {
            this.startPromise =
              null;
          }
        );

    return this.startPromise;
  }

  private async startInternal():
    Promise<
      BackgroundProcessingStartResult
    > {
    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    this.latestQueueSnapshot =
      this.queueService
        .getSnapshot();

    if (
      this.isRunning()
    ) {
      return {
        started:
          true,

        alreadyRunning:
          true,

        state:
          this.state,

        capability: {
          ...this.capability,

          warnings: [
            ...this.capability
              .warnings,
          ],
        },

        nativeTaskId:
          this.nativeTaskId,

        nativeJobId:
          this.nativeJobId,

        snapshot:
          this.latestQueueSnapshot,

        warnings: [
          ...this.warnings,
        ],
      };
    }

    const driver =
      this.resolveDriver();

    if (
      !driver ||
      !this.capability
        .available
    ) {
      return {
        started:
          false,

        alreadyRunning:
          false,

        state:
          this.state,

        capability: {
          ...this.capability,

          warnings: [
            ...this.capability
              .warnings,
          ],
        },

        nativeTaskId:
          null,

        nativeJobId:
          null,

        snapshot:
          this.latestQueueSnapshot,

        warnings: [
          ...this.warnings,
        ],
      };
    }

    if (
      !hasProcessableQueueWork(
        this.latestQueueSnapshot
      )
    ) {
      return {
        started:
          false,

        alreadyRunning:
          false,

        state:
          this.state,

        capability: {
          ...this.capability,

          warnings: [
            ...this.capability
              .warnings,
          ],
        },

        nativeTaskId:
          null,

        nativeJobId:
          null,

        snapshot:
          this.latestQueueSnapshot,

        warnings: [
          'The processing queue does not contain pending items.',
        ],
      };
    }

    this.state =
      'starting';

    this.nativeTaskState =
      'starting';

    this.startedAt =
      now();

    this.updatedAt =
      this.startedAt;

    this.lastError =
      null;

    this.notifyListeners();

    try {
      const payload =
        createTaskPayload(
          this.latestQueueSnapshot,
          this.startedAt
        );

      const result =
        await driver.start(
          payload,
          {
            onExpiration:
              reason => {
                void this.handleExpiration(
                  reason
                );
              },

            onStopped:
              reason => {
                this.handleNativeStopped(
                  reason
                );
              },

            onFailure:
              error => {
                this.handleNativeFailure(
                  error
                );
              },

            onResumeRequested:
              () => {
                void this.handleResumeRequested();
              },
          }
        );

      if (
        !result.started
      ) {
        this.state =
          result.capability ===
            'restricted'
            ? 'restricted'
            : 'unavailable';

        this.nativeTaskState =
          'stopped';

        this.warnings = [
          ...result.warnings,
        ];

        this.updatedAt =
          now();

        this.notifyListeners();

        return {
          started:
            false,

          alreadyRunning:
            false,

          state:
            this.state,

          capability: {
            ...this.capability,

            capability:
              result.capability,

            available:
              false,

            restricted:
              result.capability ===
              'restricted',

            warnings: [
              ...result.warnings,
            ],
          },

          nativeTaskId:
            null,

          nativeJobId:
            null,

          snapshot:
            this.latestQueueSnapshot,

          warnings: [
            ...result.warnings,
          ],
        };
      }

      this.nativeTaskId =
        result.nativeTaskId;

      this.nativeJobId =
        result.nativeJobId;

      this.expirationAt =
        result.expirationAt;

      this.state =
        'running';

      this.nativeTaskState =
        'running';

      this.warnings = [
        ...result.warnings,
      ];

      this.updatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        startCount:
          this.diagnostics
            .startCount +
          1,

        lastOperationAt:
          this.updatedAt,

        lastErrorMessage:
          null,
      };

      if (
        this.queueService
          .hasExecutor() &&
        this.queueService
          .hasPendingJobs() &&
        !this.queueService
          .isRunning()
      ) {
        await this.queueService
          .start();
      }

      this.latestQueueSnapshot =
        this.queueService
          .getSnapshot();

      this.notifyListeners();

      return {
        started:
          true,

        alreadyRunning:
          false,

        state:
          this.state,

        capability: {
          ...this.capability,

          warnings: [
            ...this.capability
              .warnings,
          ],
        },

        nativeTaskId:
          this.nativeTaskId,

        nativeJobId:
          this.nativeJobId,

        snapshot:
          this.latestQueueSnapshot,

        warnings: [
          ...this.warnings,
        ],
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.lastError =
        createBackgroundError(
          message,
          this.platform ===
            'ios'
            ? 'ios-background'
            : this.platform ===
                'android'
              ? 'android-background'
              : 'unknown',
          'BACKGROUND_PROCESSING_START_FAILED',
          true,
          {
            queueId:
              this.latestQueueSnapshot
                .queueId,
          }
        );

      this.state =
        'failed';

      this.nativeTaskState =
        'failed';

      this.updatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        failureCount:
          this.diagnostics
            .failureCount +
          1,

        lastOperationAt:
          this.updatedAt,

        lastErrorMessage:
          message,
      };

      this.notifyListeners();

      throw error;
    }
  }

  /* =======================================================
   * Stop
   * ===================================================== */

  public stop(
    reason =
      'Background processing stopped.'
  ): Promise<
      BackgroundProcessingStopResult
    > {
    this.assertNotDisposed();

    if (
      this.stopPromise
    ) {
      return this.stopPromise;
    }

    this.stopPromise =
      this.stopInternal(
        reason
      ).finally(
        () => {
          this.stopPromise =
            null;
        }
      );

    return this.stopPromise;
  }

  private async stopInternal(
    reason:
      string
  ): Promise<
      BackgroundProcessingStopResult
    > {
    const driver =
      this.resolveDriver();

    this.latestQueueSnapshot =
      this.queueService
        .getSnapshot();

    if (
      !this.isRunning() &&
      this.nativeTaskState !==
        'starting'
    ) {
      return {
        stopped:
          true,

        state:
          this.state,

        reason,

        snapshot:
          this.latestQueueSnapshot,
      };
    }

    this.state =
      'stopping';

    this.nativeTaskState =
      'stopping';

    this.updatedAt =
      now();

    this.notifyListeners();

    try {
      if (
        driver
      ) {
        await driver.stop({
          nativeTaskId:
            this.nativeTaskId,

          nativeJobId:
            this.nativeJobId,

          reason,

          completed:
            isQueueComplete(
              this.latestQueueSnapshot
            ),

          snapshot:
            this.latestQueueSnapshot,
        });
      }
    } catch (error) {
      if (
        this.enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N BACKGROUND DRIVER STOP ERROR:',
          error
        );
      }
    }

    this.nativeTaskId =
      null;

    this.nativeJobId =
      null;

    this.expirationAt =
      null;

    this.startedAt =
      null;

    this.nativeTaskState =
      'stopped';

    this.state =
      'stopped';

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      stopCount:
        this.diagnostics
          .stopCount +
      1,

      lastOperationAt:
        this.updatedAt,
    };

    this.notifyListeners();

    return {
      stopped:
        true,

      state:
        this.state,

      reason,

      snapshot:
        this.latestQueueSnapshot,
    };
  }

  /* =======================================================
   * Queue integration
   * ===================================================== */

  private attachQueueEvents():
    void {
    if (
      this.queueSubscription
    ) {
      return;
    }

    this.queueSubscription =
      this.queueService
        .subscribeToEvents(
          event => {
            void this.handleQueueEvent(
              event
            );
          }
        );
  }

  private async handleQueueEvent(
    event:
      ProcessingQueueEvent
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    this.latestQueueSnapshot =
      event.snapshot;

    this.updatedAt =
      event.timestamp;

    this.diagnostics = {
      ...this.diagnostics,

      queueEventCount:
        this.diagnostics
          .queueEventCount +
      1,

      lastQueueEventType:
        event.type,

      lastOperationAt:
        event.timestamp,
    };

    if (
      event.error
    ) {
      this.lastError =
        cloneProcessingError(
          event.error
        );
    }

    if (
      this.isRunning()
    ) {
      await this.updateNativeTask(
        event.snapshot
      );
    }

    if (
      event.type ===
        'queue-completed' ||
      isQueueComplete(
        event.snapshot
      )
    ) {
      if (
        this.stopNativeTaskWhenQueueCompletes &&
        this.isRunning()
      ) {
        await this.stop(
          'Processing queue completed.'
        );
      } else {
        this.notifyListeners();
      }

      return;
    }

    if (
      (
        event.type ===
          'job-added' ||
        event.type ===
          'queue-started' ||
        event.type ===
          'queue-restored'
      ) &&
      this.autoStartWhenPending &&
      !this.isRunning() &&
      this.capability
        .available &&
      hasProcessableQueueWork(
        event.snapshot
      )
    ) {
      void this.start();
    }

    this.notifyListeners();
  }

  private async updateNativeTask(
    snapshot:
      ProcessingQueueSnapshot
  ): Promise<void> {
    const driver =
      this.resolveDriver();

    if (
      !driver?.update ||
      !this.startedAt
    ) {
      return;
    }

    try {
      await driver.update({
        nativeTaskId:
          this.nativeTaskId,

        nativeJobId:
          this.nativeJobId,

        payload:
          createTaskPayload(
            snapshot,
            this.startedAt
          ),

        snapshot,
      });

      this.diagnostics = {
        ...this.diagnostics,

        nativeUpdateCount:
          this.diagnostics
            .nativeUpdateCount +
        1,

        lastOperationAt:
          now(),
      };
    } catch (error) {
      this.diagnostics = {
        ...this.diagnostics,

        nativeUpdateFailureCount:
          this.diagnostics
            .nativeUpdateFailureCount +
        1,

        lastErrorMessage:
          getUnknownErrorMessage(
            error
          ),
      };

      if (
        this.enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N BACKGROUND DRIVER UPDATE ERROR:',
          error
        );
      }
    }
  }

  /* =======================================================
   * Application state
   * ===================================================== */

  private attachApplicationState():
    void {
    if (
      !this.manageApplicationStateInternally ||
      this.appStateSubscription
    ) {
      return;
    }

    this.appStateSubscription =
      AppState.addEventListener(
        'change',
        nextState => {
          void this.handleApplicationStateChange(
            nextState
          );
        }
      );
  }

  private async handleApplicationStateChange(
    nextState:
      AppStateStatus
  ): Promise<void> {
    if (
      this.disposed ||
      !this.manageApplicationStateInternally
    ) {
      return;
    }

    this.applicationState =
      resolveApplicationState(
        nextState
      );

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      applicationStateChangeCount:
        this.diagnostics
          .applicationStateChangeCount +
      1,

      lastOperationAt:
        this.updatedAt,
    };

    this.latestQueueSnapshot =
      this.queueService
        .getSnapshot();

    if (
      this.applicationState ===
        'background' &&
      this.autoStartWhenPending &&
      this.capability
        .available &&
      hasProcessableQueueWork(
        this.latestQueueSnapshot
      ) &&
      !this.isRunning()
    ) {
      void this.start();
    }

    if (
      this.applicationState ===
        'active' &&
      this.resumeQueueWhenApplicationBecomesActive &&
      this.queueService
        .hasExecutor() &&
      this.queueService
        .hasPendingJobs() &&
      !this.queueService
        .isRunning()
    ) {
      this.diagnostics = {
        ...this.diagnostics,

        resumeCount:
          this.diagnostics
            .resumeCount +
        1,
      };

      try {
        await this.queueService
          .resume();
      } catch (error) {
        if (
          this.enableDebugLogs
        ) {
          console.warn(
            'TRIPLE N QUEUE RESUME ERROR:',
            error
          );
        }
      }
    }

    this.notifyListeners();
  }

  /* =======================================================
   * Native callbacks
   * ===================================================== */

  private async handleExpiration(
    reason:
      string
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    this.nativeTaskState =
      'expiring';

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      expirationCount:
        this.diagnostics
          .expirationCount +
      1,

      lastOperationAt:
        this.updatedAt,
    };

    this.lastError =
      createBackgroundError(
        reason ||
          'Background processing time expired.',
        this.platform ===
          'ios'
          ? 'ios-background'
          : this.platform ===
              'android'
            ? 'android-background'
            : 'unknown',
        'BACKGROUND_PROCESSING_EXPIRED',
        true,
        {
          nativeTaskId:
            this.nativeTaskId,

          nativeJobId:
            this.nativeJobId,
        }
      );

    this.notifyListeners();

    try {
      await this.queueService
        .pause();
    } catch (error) {
      if (
        this.enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N QUEUE PAUSE AFTER EXPIRATION ERROR:',
          error
        );
      }
    }

    await this.stop(
      reason ||
        'Background processing expired.'
    );
  }

  private handleNativeStopped(
    reason:
      string
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.nativeTaskState =
      'stopped';

    this.state =
      'stopped';

    this.nativeTaskId =
      null;

    this.nativeJobId =
      null;

    this.expirationAt =
      null;

    this.startedAt =
      null;

    this.updatedAt =
      now();

    this.warnings =
      reason
        ? [
            reason,
          ]
        : [];

    this.notifyListeners();
  }

  private handleNativeFailure(
    error:
      unknown
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const message =
      getUnknownErrorMessage(
        error
      );

    this.lastError =
      createBackgroundError(
        message,
        this.platform ===
          'ios'
          ? 'ios-background'
          : this.platform ===
              'android'
            ? 'android-background'
            : 'unknown',
        'BACKGROUND_PROCESSING_STOPPED',
        true,
        {
          nativeTaskId:
            this.nativeTaskId,

          nativeJobId:
            this.nativeJobId,
        }
      );

    this.state =
      'failed';

    this.nativeTaskState =
      'failed';

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      failureCount:
        this.diagnostics
          .failureCount +
      1,

      lastOperationAt:
        this.updatedAt,

      lastErrorMessage:
        message,
    };

    this.notifyListeners();
  }

  private async handleResumeRequested():
    Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    this.diagnostics = {
      ...this.diagnostics,

      resumeCount:
        this.diagnostics
          .resumeCount +
      1,

      lastOperationAt:
        now(),
    };

    if (
      this.queueService
        .hasExecutor() &&
      this.queueService
        .hasPendingJobs() &&
      !this.queueService
        .isRunning()
    ) {
      await this.queueService
        .resume();
    }
  }

  /* =======================================================
   * Queries
   * ===================================================== */

  public getSnapshot():
    BackgroundProcessingServiceSnapshot {
    this.assertNotDisposed();

    this.latestQueueSnapshot =
      this.queueService
        .getSnapshot();

    return {
      state:
        this.state,

      nativeTaskState:
        this.nativeTaskState,

      platform:
        this.platform,

      capability:
        this.capability
          .capability,

      initialized:
        this.initialized,

      running:
        this.isRunning(),

      disposed:
        this.disposed,

      applicationState:
        this.applicationState,

      nativeTaskId:
        this.nativeTaskId,

      nativeJobId:
        this.nativeJobId,

      startedAt:
        this.startedAt,

      updatedAt:
        this.updatedAt,

      expirationAt:
        this.expirationAt,

      activeJobId:
        this.latestQueueSnapshot
          .activeJobId,

      pendingJobCount:
        this.latestQueueSnapshot
          .statistics
          .pending +
        this.latestQueueSnapshot
          .statistics
          .active,

      queueStatus:
        this.latestQueueSnapshot
          .status,

      lastError:
        cloneProcessingError(
          this.lastError
        ),

      warnings: [
        ...this.warnings,
      ],
    };
  }

  public getCapability():
    BackgroundProcessingCapabilityResult {
    return {
      ...this.capability,

      warnings: [
        ...this.capability
          .warnings,
      ],
    };
  }

  public getDiagnostics():
    BackgroundProcessingServiceDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  public isRunning():
    boolean {
    return (
      this.state ===
        'running' &&
      this.nativeTaskState ===
        'running'
    );
  }

  public getActiveJob():
    ProcessingJob | null {
    const activeJobId =
      this.latestQueueSnapshot
        .activeJobId;

    if (
      !activeJobId
    ) {
      return null;
    }

    return this.queueService
      .getJob(
        activeJobId
      );
  }

  /* =======================================================
   * Subscription
   * ===================================================== */

  public subscribe(
    listener:
      BackgroundProcessingServiceListener
  ): () => void {
    this.assertNotDisposed();

    this.listeners.add(
      listener
    );

    listener(
      this.getSnapshot()
    );

    return () => {
      this.listeners.delete(
        listener
      );
    };
  }

  private notifyListeners():
    void {
    if (
      this.disposed
    ) {
      return;
    }

    const snapshot =
      this.getSnapshot();

    for (
      const listener of
        this.listeners
    ) {
      try {
        listener({
          ...snapshot,

          lastError:
            cloneProcessingError(
              snapshot.lastError
            ),

          warnings: [
            ...snapshot.warnings,
          ],
        });
      } catch (error) {
        if (
          this.enableDebugLogs
        ) {
          console.warn(
            'TRIPLE N BACKGROUND PROCESSING LISTENER ERROR:',
            error
          );
        }
      }
    }
  }

  /* =======================================================
   * Driver
   * ===================================================== */

  private resolveDriver():
  BackgroundProcessingDriver | null {
  if (
    this.platform ===
      'android'
  ) {
    return this.androidDriver;
  }

  return this
    .unknownPlatformDriver;
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

    try {
      if (
        this.isRunning()
      ) {
        await this.stop(
          'Background processing service disposed.'
        );
      }
    } catch {
      // لا نرمي أثناء dispose.
    }

    this.queueSubscription
      ?.unsubscribe();

    this.queueSubscription =
      null;

    this.appStateSubscription
      ?.remove();

    this.appStateSubscription =
      null;

    const drivers =
      new Set<
        BackgroundProcessingDriver
      >();

    if (
      this.androidDriver
    ) {
      drivers.add(
        this.androidDriver
      );
    }

    if (
      this.unknownPlatformDriver
    ) {
      drivers.add(
        this.unknownPlatformDriver
      );
    }

    for (
      const driver of
        drivers
    ) {
      try {
        await driver.dispose?.();
      } catch {
        // لا نرمي أثناء dispose.
      }
    }

    this.listeners.clear();

    this.initialized =
      false;

    this.disposed =
      true;

    this.state =
      'disposed';

    this.nativeTaskState =
      'stopped';

    this.nativeTaskId =
      null;

    this.nativeJobId =
      null;

    this.startedAt =
      null;

    this.expirationAt =
      null;

    this.updatedAt =
      now();
  }

  private assertNotDisposed():
    void {
    if (
      this.disposed
    ) {
      throw new Error(
        'Background processing service has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultBackgroundProcessingService:
  BackgroundProcessingService | null =
    null;

export function getDefaultBackgroundProcessingService(
  options?:
    BackgroundProcessingServiceOptions
): BackgroundProcessingService {
  if (
    !defaultBackgroundProcessingService
  ) {
    defaultBackgroundProcessingService =
      new BackgroundProcessingService(
        options
      );
  }

  return defaultBackgroundProcessingService;
}

export async function initializeBackgroundProcessingService(
  options?:
    BackgroundProcessingServiceOptions
): Promise<
  BackgroundProcessingCapabilityResult
> {
  return getDefaultBackgroundProcessingService(
    options
  ).initialize();
}

export async function startBackgroundProcessing():
  Promise<
    BackgroundProcessingStartResult
  > {
  return getDefaultBackgroundProcessingService()
    .start();
}

export async function stopBackgroundProcessing(
  reason?:
    string
): Promise<
  BackgroundProcessingStopResult
> {
  return getDefaultBackgroundProcessingService()
    .stop(
      reason
    );
}

export function subscribeToBackgroundProcessing(
  listener:
    BackgroundProcessingServiceListener
): () => void {
  return getDefaultBackgroundProcessingService()
    .subscribe(
      listener
    );
}

export async function disposeBackgroundProcessingService():
  Promise<void> {
  if (
    !defaultBackgroundProcessingService
  ) {
    return;
  }

  await defaultBackgroundProcessingService
    .dispose();

  defaultBackgroundProcessingService =
    null;
}

export default
  BackgroundProcessingService;