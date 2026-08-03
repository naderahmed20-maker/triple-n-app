// scan/core/background/AndroidBackgroundProcessingDriver.ts
//
// Triple N - Android Background Processing Driver
//
// هذا الملف هو طبقة JavaScript التي تتواصل مع
// Native Android WorkManager وForeground Service.
//
// مسؤولياته:
//
// 1) اكتشاف وجود Native Module الخاص بـAndroid.
// 2) فحص إمكانية تشغيل المعالجة في الخلفية.
// 3) بدء WorkManager Job أو Foreground Service.
// 4) إرسال حالة Queue والتقدم إلى Native.
// 5) استقبال تقدم Native Background Job.
// 6) استقبال انتهاء أو توقف أو فشل المهمة.
// 7) استقبال طلب استكمال Queue.
// 8) إنهاء المهمة عند اكتمال المعالجة.
// 9) تنظيف جميع Event Listeners.
// 10) العمل بأمان عند غياب Native Module.
// 11) عدم تشغيل EdgeSAM داخل هذا الملف.
//
// الـNative Module المتوقع لاحقًا:
//
// TripleNAndroidBackgroundProcessing
//
// الأحداث المتوقعة:
//
// TripleNAndroidBackgroundProcessingProgress
// TripleNAndroidBackgroundProcessingStopped
// TripleNAndroidBackgroundProcessingFailure
// TripleNAndroidBackgroundProcessingResumeRequested
// TripleNAndroidBackgroundProcessingExpired

import {
    NativeEventEmitter,
    NativeModules,
    Platform,
    type EmitterSubscription,
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

export type AndroidBackgroundNativeCapabilityResult = {
  available?:
    boolean;

  restricted?:
    boolean;

  capability?:
    ProcessingBackgroundCapability;

  message?:
    string;

  warnings?:
    readonly string[];

  workManagerAvailable?:
    boolean | null;

  foregroundServiceAvailable?:
    boolean | null;

  notificationsEnabled?:
    boolean | null;

  batteryOptimizationIgnored?:
    boolean | null;

  backgroundRestricted?:
    boolean | null;

  exactAlarmPermissionGranted?:
    boolean | null;
};

export type AndroidBackgroundExecutionStrategy =
  | 'work-manager'
  | 'foreground-service'
  | 'hybrid'
  | 'unknown';

export type AndroidBackgroundNativeStartRequest = {
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

  executionStrategy:
    AndroidBackgroundExecutionStrategy;

  notificationTitle:
    string;

  notificationBody:
    string;

  metadata:
    Record<
      string,
      string | number | boolean | null
    >;
};

export type AndroidBackgroundNativeStartResult = {
  started?:
    boolean;

  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  expirationAt?:
    number | null;

  capability?:
    ProcessingBackgroundCapability;

  executionStrategy?:
    AndroidBackgroundExecutionStrategy;

  warnings?:
    readonly string[];

  message?:
    string;
};

export type AndroidBackgroundNativeUpdateRequest = {
  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  payload:
    AndroidBackgroundNativeStartRequest;
};

export type AndroidBackgroundNativeStopRequest = {
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

  cancelWorkManager:
    boolean;

  stopForegroundService:
    boolean;
};

export type AndroidBackgroundProcessingNativeModule = {
  initialize?():
    Promise<
      AndroidBackgroundNativeCapabilityResult
    >;

  getCapability?():
    Promise<
      AndroidBackgroundNativeCapabilityResult
    >;

  startBackgroundProcessing?(
    request:
      AndroidBackgroundNativeStartRequest
  ): Promise<
    AndroidBackgroundNativeStartResult
  >;

  updateBackgroundProcessing?(
    request:
      AndroidBackgroundNativeUpdateRequest
  ): Promise<void>;

  stopBackgroundProcessing?(
    request:
      AndroidBackgroundNativeStopRequest
  ): Promise<void>;

  requestNotificationPermission?():
    Promise<boolean>;

  openBatteryOptimizationSettings?():
    Promise<boolean>;

  isIgnoringBatteryOptimizations?():
    Promise<boolean>;

  getConstants?():
    Record<
      string,
      unknown
    >;

  addListener?(
    eventName:
      string
  ): void;

  removeListeners?(
    count:
      number
  ): void;
};

/* =========================================================
 * Native event contracts
 * ======================================================= */

export type AndroidBackgroundProgressEvent = {
  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  jobId?:
    string | null;

  queueId?:
    string | null;

  progress?:
    number;

  percentage?:
    number;

  stage?:
    string | null;

  message?:
    string | null;

  updatedAt?:
    number | null;
};

export type AndroidBackgroundStoppedEvent = {
  reason?:
    string;

  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  completed?:
    boolean;

  cancelled?:
    boolean;
};

export type AndroidBackgroundFailureEvent = {
  message?:
    string;

  code?:
    string | null;

  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  retryable?:
    boolean;

  nativeStack?:
    string | null;
};

export type AndroidBackgroundResumeRequestedEvent = {
  reason?:
    string;

  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  applicationStarted?:
    boolean;
};

export type AndroidBackgroundExpiredEvent = {
  reason?:
    string;

  nativeTaskId?:
    string | null;

  nativeJobId?:
    string | null;

  retryable?:
    boolean;
};

/* =========================================================
 * Constants
 * ======================================================= */

const NATIVE_MODULE_NAME =
  'TripleNAndroidBackgroundProcessing';

const EVENT_PROGRESS =
  'TripleNAndroidBackgroundProcessingProgress';

const EVENT_STOPPED =
  'TripleNAndroidBackgroundProcessingStopped';

const EVENT_FAILURE =
  'TripleNAndroidBackgroundProcessingFailure';

const EVENT_RESUME_REQUESTED =
  'TripleNAndroidBackgroundProcessingResumeRequested';

const EVENT_EXPIRED =
  'TripleNAndroidBackgroundProcessingExpired';

/* =========================================================
 * Options
 * ======================================================= */

export type AndroidBackgroundProcessingDriverOptions = {
  nativeModule?:
    AndroidBackgroundProcessingNativeModule | null;

  enableDebugLogs?:
    boolean;

  allowUnavailableFallback?:
    boolean;

  executionStrategy?:
    AndroidBackgroundExecutionStrategy;

  notificationTitle?:
    string;

  notificationBody?:
    string;

  requestNotificationPermissionOnInitialize?:
    boolean;

  requireNotificationPermission?:
    boolean;

  requestIgnoreBatteryOptimization?:
    boolean;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type AndroidBackgroundProcessingDriverDiagnostics = {
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

  notificationPermissionRequestCount:
    number;

  batteryOptimizationCheckCount:
    number;

  batteryOptimizationRequestCount:
    number;

  startCount:
    number;

  updateCount:
    number;

  stopCount:
    number;

  progressEventCount:
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

  executionStrategy:
    AndroidBackgroundExecutionStrategy;

  notificationsEnabled:
    boolean | null;

  batteryOptimizationIgnored:
    boolean | null;

  lastNativeProgress:
    number | null;

  lastNativeStage:
    string | null;

  lastOperationAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;
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

function normalizeExecutionStrategy(
  value:
    AndroidBackgroundExecutionStrategy | null | undefined
): AndroidBackgroundExecutionStrategy {
  if (
    value ===
      'work-manager' ||
    value ===
      'foreground-service' ||
    value ===
      'hybrid' ||
    value ===
      'unknown'
  ) {
    return value;
  }

  return 'hybrid';
}

function resolveNativeModule():
  AndroidBackgroundProcessingNativeModule | null {
  const modules =
    NativeModules as Record<
      string,
      unknown
    >;

  const candidate =
    modules[
      NATIVE_MODULE_NAME
    ];

  if (
    typeof candidate !==
      'object' ||
    candidate ===
      null
  ) {
    return null;
  }

  return candidate as
    AndroidBackgroundProcessingNativeModule;
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
      'android',

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
      'android',

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
    AndroidBackgroundNativeCapabilityResult
): BackgroundProcessingCapabilityResult {
  const available =
    result.available ===
      true;

  const restricted =
    result.restricted ===
      true ||
    result.backgroundRestricted ===
      true;

  const capability =
    normalizeCapability(
      result.capability,
      available,
      restricted
    );

  const warnings = [
    ...normalizeWarnings(
      result.warnings
    ),
  ];

  if (
    result.notificationsEnabled ===
      false
  ) {
    warnings.push(
      'Android notification permission is disabled.'
    );
  }

  if (
    result.batteryOptimizationIgnored ===
      false
  ) {
    warnings.push(
      'Android battery optimization may interrupt background processing.'
    );
  }

  return {
    platform:
      'android',

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
        capability ===
          'available'
          ? 'Android background processing is available.'
          : capability ===
              'restricted'
            ? 'Android background processing is restricted.'
            : 'Android background processing is unavailable.'
      ),

    warnings,
  };
}

function createNativePayload(
  payload:
    BackgroundProcessingTaskPayload,
  executionStrategy:
    AndroidBackgroundExecutionStrategy,
  notificationTitle:
    string,
  notificationBody:
    string
): AndroidBackgroundNativeStartRequest {
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
      clampUnitValue(
        payload.overallProgress
      ),

    overallPercentage:
      Math.min(
        100,
        Math.max(
          0,
          Math.round(
            payload.overallPercentage
          )
        )
      ),

    estimatedRemainingMs:
      payload.estimatedRemainingMs,

    startedAt:
      payload.startedAt,

    updatedAt:
      payload.updatedAt,

    executionStrategy,

    notificationTitle,

    notificationBody,

    metadata: {
      ...payload.metadata,
    },
  };
}

function createStopPayload(
  request:
    BackgroundProcessingDriverStopRequest
): AndroidBackgroundNativeStopRequest {
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

    cancelWorkManager:
      true,

    stopForegroundService:
      true,
  };
}

/* =========================================================
 * Driver
 * ======================================================= */

export class AndroidBackgroundProcessingDriver
  implements BackgroundProcessingDriver
{
  public readonly platform:
    ProcessingPlatform =
      'android';

  private readonly nativeModule:
    AndroidBackgroundProcessingNativeModule | null;

  private readonly enableDebugLogs:
    boolean;

  private readonly allowUnavailableFallback:
    boolean;

  private readonly requestedExecutionStrategy:
    AndroidBackgroundExecutionStrategy;

  private readonly notificationTitle:
    string;

  private readonly notificationBody:
    string;

  private readonly requestNotificationPermissionOnInitialize:
    boolean;

  private readonly requireNotificationPermission:
    boolean;

  private readonly requestIgnoreBatteryOptimization:
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

  private eventEmitter:
    NativeEventEmitter | null =
      null;

  private subscriptions:
    EmitterSubscription[] =
      [];

  private activeNativeTaskId:
    string | null =
      null;

  private activeNativeJobId:
    string | null =
      null;

  private activeExecutionStrategy:
    AndroidBackgroundExecutionStrategy =
      'unknown';

  private notificationsEnabled:
    boolean | null =
      null;

  private batteryOptimizationIgnored:
    boolean | null =
      null;

  private capability:
    BackgroundProcessingCapabilityResult =
      createUnavailableCapability(
        'Android background processing has not been initialized.'
      );

  private diagnostics:
    AndroidBackgroundProcessingDriverDiagnostics;

  constructor(
    options:
      AndroidBackgroundProcessingDriverOptions =
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

    this.requestedExecutionStrategy =
      normalizeExecutionStrategy(
        options.executionStrategy ??
        'hybrid'
      );

    this.notificationTitle =
      options.notificationTitle
        ?.trim() ||
      'Preparing your wardrobe';

    this.notificationBody =
      options.notificationBody
        ?.trim() ||
      'Triple N is processing your items in the background.';

    this.requestNotificationPermissionOnInitialize =
      options
        .requestNotificationPermissionOnInitialize ??
      true;

    this.requireNotificationPermission =
      options
        .requireNotificationPermission ??
      true;

    this.requestIgnoreBatteryOptimization =
      options
        .requestIgnoreBatteryOptimization ??
      false;

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

      notificationPermissionRequestCount:
        0,

      batteryOptimizationCheckCount:
        0,

      batteryOptimizationRequestCount:
        0,

      startCount:
        0,

      updateCount:
        0,

      stopCount:
        0,

      progressEventCount:
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

      executionStrategy:
        'unknown',

      notificationsEnabled:
        null,

      batteryOptimizationIgnored:
        null,

      lastNativeProgress:
        null,

      lastNativeStage:
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

    if (
      Platform.OS !==
        'android'
    ) {
      this.capability =
        createUnavailableCapability(
          'The Android background driver was loaded on a non-Android platform.'
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
      });

      return this.getCapabilitySnapshot();
    }

    if (
      !this.nativeModule
    ) {
      this.capability =
        createUnavailableCapability(
          'The TripleNAndroidBackgroundProcessing native module is not installed.',
          [
            'A development build containing the Android native module is required.',
          ]
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
      });

      return this.getCapabilitySnapshot();
    }

    try {
      const nativeResult =
        this.nativeModule
          .initialize
          ? await this.nativeModule
              .initialize()
          : this.nativeModule
              .getCapability
            ? await this.nativeModule
                .getCapability()
            : {
                available:
                  true,

                restricted:
                  false,

                capability:
                  'available' as const,

                workManagerAvailable:
                  true,

                foregroundServiceAvailable:
                  true,

                message:
                  'Android background native module is available.',

                warnings:
                  [],
              };

      this.notificationsEnabled =
        typeof nativeResult
          .notificationsEnabled ===
          'boolean'
          ? nativeResult
              .notificationsEnabled
          : null;

      this.batteryOptimizationIgnored =
        typeof nativeResult
          .batteryOptimizationIgnored ===
          'boolean'
          ? nativeResult
              .batteryOptimizationIgnored
          : null;

      if (
        this.requestNotificationPermissionOnInitialize &&
        this.notificationsEnabled ===
          false
      ) {
        await this.requestNotificationPermission();
      }

      await this.refreshBatteryOptimizationState();

      if (
        this.requestIgnoreBatteryOptimization &&
        this.batteryOptimizationIgnored ===
          false
      ) {
        await this.openBatteryOptimizationSettings();
      }

      this.capability =
        normalizeCapabilityResult({
          ...nativeResult,

          notificationsEnabled:
            this.notificationsEnabled,

          batteryOptimizationIgnored:
            this.batteryOptimizationIgnored,
        });

      if (
        this.requireNotificationPermission &&
        this.notificationsEnabled ===
          false
      ) {
        this.capability =
          createRestrictedCapability(
            'Android notification permission is required for foreground background processing.',
            [
              ...this.capability
                .warnings,
            ]
          );
      }

      this.attachNativeEvents();

      this.initialized =
        true;

      this.updateDiagnostics({
        initialized:
          true,

        initializeCount:
          this.diagnostics
            .initializeCount +
          1,

        notificationsEnabled:
          this.notificationsEnabled,

        batteryOptimizationIgnored:
          this.batteryOptimizationIgnored,

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

        initializeCount:
          this.diagnostics
            .initializeCount +
          1,

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
   * Permission and battery helpers
   * ===================================================== */

  public async requestNotificationPermission():
    Promise<boolean> {
    this.assertNotDisposed();

    this.updateDiagnostics({
      notificationPermissionRequestCount:
        this.diagnostics
          .notificationPermissionRequestCount +
      1,

      lastOperationAt:
        now(),
    });

    if (
      !this.nativeModule
        ?.requestNotificationPermission
    ) {
      return (
        this.notificationsEnabled ??
        false
      );
    }

    try {
      const granted =
        await this.nativeModule
          .requestNotificationPermission();

      this.notificationsEnabled =
        granted;

      this.updateDiagnostics({
        notificationsEnabled:
          granted,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return granted;
    } catch (error) {
      this.updateDiagnostics({
        notificationsEnabled:
          false,

        lastOperationAt:
          now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      return false;
    }
  }

  public async refreshBatteryOptimizationState():
    Promise<boolean | null> {
    this.assertNotDisposed();

    this.updateDiagnostics({
      batteryOptimizationCheckCount:
        this.diagnostics
          .batteryOptimizationCheckCount +
      1,

      lastOperationAt:
        now(),
    });

    if (
      !this.nativeModule
        ?.isIgnoringBatteryOptimizations
    ) {
      return this
        .batteryOptimizationIgnored;
    }

    try {
      const ignored =
        await this.nativeModule
          .isIgnoringBatteryOptimizations();

      this.batteryOptimizationIgnored =
        ignored;

      this.updateDiagnostics({
        batteryOptimizationIgnored:
          ignored,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return ignored;
    } catch (error) {
      this.updateDiagnostics({
        lastOperationAt:
          now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      return this
        .batteryOptimizationIgnored;
    }
  }

  public async openBatteryOptimizationSettings():
    Promise<boolean> {
    this.assertNotDisposed();

    this.updateDiagnostics({
      batteryOptimizationRequestCount:
        this.diagnostics
          .batteryOptimizationRequestCount +
      1,

      lastOperationAt:
        now(),
    });

    if (
      !this.nativeModule
        ?.openBatteryOptimizationSettings
    ) {
      return false;
    }

    try {
      const opened =
        await this.nativeModule
          .openBatteryOptimizationSettings();

      this.updateDiagnostics({
        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return opened;
    } catch (error) {
      this.updateDiagnostics({
        lastOperationAt:
          now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      return false;
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
        ?.getCapability
    ) {
      return this.getCapabilitySnapshot();
    }

    try {
      const nativeResult =
        await this.nativeModule
          .getCapability();

      this.notificationsEnabled =
        typeof nativeResult
          .notificationsEnabled ===
          'boolean'
          ? nativeResult
              .notificationsEnabled
          : this.notificationsEnabled;

      this.batteryOptimizationIgnored =
        typeof nativeResult
          .batteryOptimizationIgnored ===
          'boolean'
          ? nativeResult
              .batteryOptimizationIgnored
          : this.batteryOptimizationIgnored;

      this.capability =
        normalizeCapabilityResult({
          ...nativeResult,

          notificationsEnabled:
            this.notificationsEnabled,

          batteryOptimizationIgnored:
            this.batteryOptimizationIgnored,
        });

      if (
        this.requireNotificationPermission &&
        this.notificationsEnabled ===
          false
      ) {
        this.capability =
          createRestrictedCapability(
            'Android notification permission is required for foreground background processing.',
            [
              ...this.capability
                .warnings,
            ]
          );
      }

      this.updateDiagnostics({
        notificationsEnabled:
          this.notificationsEnabled,

        batteryOptimizationIgnored:
          this.batteryOptimizationIgnored,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return this.getCapabilitySnapshot();
    } catch (error) {
      this.updateDiagnostics({
        lastOperationAt:
          now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      return this.getCapabilitySnapshot();
    }
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
          'The Android background task is already running.',
        ],
      };
    }

    if (
      !this.capability
        .available
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

    if (
      this.requireNotificationPermission &&
      this.notificationsEnabled ===
        false
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
          'restricted',

        warnings: [
          'Android notification permission is required before starting background processing.',
        ],
      };
    }

    if (
      !this.nativeModule
        ?.startBackgroundProcessing
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
          'unavailable',

        warnings: [
          'The native startBackgroundProcessing function is unavailable.',
        ],
      };
    }

    this.callbacks =
      callbacks;

    this.attachNativeEvents();

    try {
      const result =
        await this.nativeModule
          .startBackgroundProcessing(
            createNativePayload(
              payload,
              this.requestedExecutionStrategy,
              this.notificationTitle,
              this.notificationBody
            )
          );

      const started =
        result.started ===
          true;

      const capability =
        normalizeCapability(
          result.capability,
          started,
          result.capability ===
            'restricted'
        );

      const resolvedStrategy =
        normalizeExecutionStrategy(
          result.executionStrategy ??
          this.requestedExecutionStrategy
        );

      if (
        !started
      ) {
        this.running =
          false;

        this.callbacks =
          null;

        this.activeExecutionStrategy =
          'unknown';

        this.updateDiagnostics({
          running:
            false,

          startCount:
            this.diagnostics
              .startCount +
          1,

          executionStrategy:
            'unknown',

          lastOperationAt:
            now(),

          lastError:
            result.message ??
            'The Android background task did not start.',
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

          capability,

          warnings:
            normalizeWarnings(
              result.warnings
            ),
        };
      }

      this.activeNativeTaskId =
        result.nativeTaskId ??
        null;

      this.activeNativeJobId =
        result.nativeJobId ??
        null;

      this.activeExecutionStrategy =
        resolvedStrategy;

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

        executionStrategy:
          resolvedStrategy,

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

        capability,

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

      this.activeExecutionStrategy =
        'unknown';

      this.updateDiagnostics({
        running:
          false,

        startCount:
          this.diagnostics
            .startCount +
        1,

        executionStrategy:
          'unknown',

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
        ?.updateBackgroundProcessing
    ) {
      return;
    }

    try {
      await this.nativeModule
        .updateBackgroundProcessing({
          nativeTaskId:
            request.nativeTaskId ??
            this.activeNativeTaskId,

          nativeJobId:
            request.nativeJobId ??
            this.activeNativeJobId,

          payload:
            createNativePayload(
              request.payload,
              this.activeExecutionStrategy ===
                'unknown'
                ? this.requestedExecutionStrategy
                : this.activeExecutionStrategy,
              this.notificationTitle,
              this.notificationBody
            ),
        });

      this.updateDiagnostics({
        updateCount:
          this.diagnostics
            .updateCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          null,
      });
    } catch (error) {
      this.updateDiagnostics({
        updateCount:
          this.diagnostics
            .updateCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      if (
        this.enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N ANDROID BACKGROUND UPDATE ERROR:',
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

    try {
      if (
        this.nativeModule
          ?.stopBackgroundProcessing
      ) {
        await this.nativeModule
          .stopBackgroundProcessing(
            createStopPayload(
              request
            )
          );
      }
    } finally {
      this.running =
        false;

      this.activeNativeTaskId =
        null;

      this.activeNativeJobId =
        null;

      this.activeExecutionStrategy =
        'unknown';

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

        executionStrategy:
          'unknown',

        lastNativeProgress:
          null,

        lastNativeStage:
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

    this.eventEmitter =
      new NativeEventEmitter(
        this.nativeModule as never
      );

    this.subscriptions = [
      this.eventEmitter.addListener(
        EVENT_PROGRESS,
        (
          event:
            AndroidBackgroundProgressEvent
        ) => {
          this.handleProgressEvent(
            event
          );
        }
      ),

      this.eventEmitter.addListener(
        EVENT_STOPPED,
        (
          event:
            AndroidBackgroundStoppedEvent
        ) => {
          this.handleStoppedEvent(
            event
          );
        }
      ),

      this.eventEmitter.addListener(
        EVENT_FAILURE,
        (
          event:
            AndroidBackgroundFailureEvent
        ) => {
          this.handleFailureEvent(
            event
          );
        }
      ),

      this.eventEmitter.addListener(
        EVENT_RESUME_REQUESTED,
        (
          event:
            AndroidBackgroundResumeRequestedEvent
        ) => {
          this.handleResumeRequestedEvent(
            event
          );
        }
      ),

      this.eventEmitter.addListener(
        EVENT_EXPIRED,
        (
          event:
            AndroidBackgroundExpiredEvent
        ) => {
          this.handleExpiredEvent(
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

  private handleProgressEvent(
    event:
      AndroidBackgroundProgressEvent
  ): void {
    const progress =
      typeof event.progress ===
        'number'
        ? clampUnitValue(
            event.progress
          )
        : typeof event.percentage ===
            'number'
          ? clampUnitValue(
              event.percentage /
              100
            )
          : null;

    const stage =
      typeof event.stage ===
        'string'
        ? event.stage
            .trim() ||
          null
        : null;

    this.updateDiagnostics({
      progressEventCount:
        this.diagnostics
          .progressEventCount +
      1,

      lastNativeProgress:
        progress,

      lastNativeStage:
        stage,

      lastOperationAt:
        typeof event.updatedAt ===
          'number' &&
        Number.isFinite(
          event.updatedAt
        )
          ? event.updatedAt
          : now(),
    });
  }

  private handleStoppedEvent(
    event:
      AndroidBackgroundStoppedEvent
  ): void {
    this.running =
      false;

    this.activeNativeTaskId =
      null;

    this.activeNativeJobId =
      null;

    this.activeExecutionStrategy =
      'unknown';

    const reason =
      event.reason
        ?.trim() ||
      'Android background processing stopped.';

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

      executionStrategy:
        'unknown',

      lastOperationAt:
        now(),
    });

    this.callbacks
      ?.onStopped(
        reason
      );
  }

  private handleFailureEvent(
    event:
      AndroidBackgroundFailureEvent
  ): void {
    this.running =
      false;

    const message =
      event.message
        ?.trim() ||
      'Android background processing failed.';

    this.updateDiagnostics({
      running:
        false,

      failureEventCount:
        this.diagnostics
          .failureEventCount +
      1,

      lastOperationAt:
        now(),

      lastError:
        message,
    });

    this.callbacks
      ?.onFailure({
        message,

        code:
          event.code ??
          null,

        nativeTaskId:
          event.nativeTaskId ??
          this.activeNativeTaskId,

        nativeJobId:
          event.nativeJobId ??
          this.activeNativeJobId,

        retryable:
          event.retryable ??
          true,

        nativeStack:
          event.nativeStack ??
          null,
      });
  }

  private handleResumeRequestedEvent(
    _event:
      AndroidBackgroundResumeRequestedEvent
  ): void {
    this.updateDiagnostics({
      resumeEventCount:
        this.diagnostics
          .resumeEventCount +
      1,

      lastOperationAt:
        now(),
    });

    this.callbacks
      ?.onResumeRequested();
  }

  private handleExpiredEvent(
    event:
      AndroidBackgroundExpiredEvent
  ): void {
    this.running =
      false;

    const reason =
      event.reason
        ?.trim() ||
      'Android background processing expired.';

    this.updateDiagnostics({
      running:
        false,

      expirationEventCount:
        this.diagnostics
          .expirationEventCount +
      1,

      lastOperationAt:
        now(),

      lastError:
        reason,
    });

    this.callbacks
      ?.onExpiration(
        reason
      );
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    AndroidBackgroundProcessingDriverDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  private updateDiagnostics(
    updates:
      Partial<
        AndroidBackgroundProcessingDriverDiagnostics
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
            'Android background driver disposed.',

          completed:
            false,

          snapshot:
            emptySnapshot,
        });
      } catch {
        // لا نرمي أثناء dispose.
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

    this.eventEmitter =
      null;

    this.callbacks =
      null;

    this.activeNativeTaskId =
      null;

    this.activeNativeJobId =
      null;

    this.activeExecutionStrategy =
      'unknown';

    this.running =
      false;

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

      executionStrategy:
        'unknown',

      lastNativeProgress:
        null,

      lastNativeStage:
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
        'Android background processing driver has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createAndroidBackgroundProcessingDriver(
  options:
    AndroidBackgroundProcessingDriverOptions =
      {}
): AndroidBackgroundProcessingDriver {
  return new AndroidBackgroundProcessingDriver(
    options
  );
}

export default
  AndroidBackgroundProcessingDriver;