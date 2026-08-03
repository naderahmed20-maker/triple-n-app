// scan/core/background/BackgroundProcessingNotificationsBootstrap.ts
//
// Triple N - Background Processing Notifications Bootstrap
//
// هذا الملف هو نقطة الربط النهائية بين:
//
// - ExpoNotificationsAdapter
// - BackgroundProcessingNotifications
// - ScanItemQueueService
//
// مسؤولياته:
//
// 1) إنشاء Expo Notifications Adapter.
// 2) إنشاء مدير إشعارات Queue.
// 3) تهيئة صلاحية الإشعارات.
// 4) إرسال إشعار اكتمال الدولاب.
// 5) تمرير ضغط المستخدم على الإشعار.
// 6) فتح المسار المطلوب من خلال Callback خارجي.
// 7) منع إنشاء أكثر من نسخة.
// 8) توفير Snapshot وتشخيصات موحدة.
// 9) تنظيف الـListeners والخدمات.
// 10) العمل دون ربط مباشر بـexpo-router.
//
// الربط مع router سيتم لاحقًا داخل app/_layout.tsx.

import type {
    ProcessingNotificationPayload,
    ProcessingQueueSnapshot,
} from '../queue/QueueTypes';

import type {
    ScanItemQueueService,
} from '../services/ScanItemQueueService';

import {
    getDefaultScanItemQueueService,
} from '../services/ScanItemQueueService';

import {
    BackgroundProcessingNotifications,
    createBackgroundProcessingNotifications,
    type BackgroundProcessingNotificationsConfig,
    type BackgroundProcessingNotificationsDiagnostics,
    type BackgroundProcessingNotificationsSnapshot,
    type ProcessingNotificationPermissionResult,
    type ProcessingNotificationResponse,
    type ProcessingNotificationSendResult,
} from './BackgroundProcessingNotifications';

import {
    createExpoNotificationsAdapter,
    type ExpoNotificationsAdapter,
    type ExpoNotificationsAdapterDiagnostics,
    type ExpoNotificationsAdapterOptions,
} from './ExpoNotificationsAdapter';

/* =========================================================
 * State
 * ======================================================= */

export type BackgroundNotificationsBootstrapState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'permission-denied'
  | 'unavailable'
  | 'failed'
  | 'disposing'
  | 'disposed';

/* =========================================================
 * Navigation
 * ======================================================= */

export type BackgroundNotificationRouteHandler = (
  route:
    string,
  response:
    ProcessingNotificationResponse
) => void | Promise<void>;

/* =========================================================
 * Options
 * ======================================================= */

export type BackgroundNotificationsBootstrapOptions = {
  queueService?:
    ScanItemQueueService;

  adapter?:
    ExpoNotificationsAdapter;

  adapterOptions?:
    ExpoNotificationsAdapterOptions;

  notificationsConfig?:
    Partial<
      BackgroundProcessingNotificationsConfig
    >;

  requestPermissionOnInitialize?:
    boolean;

  onOpenRoute?:
    BackgroundNotificationRouteHandler;

  autoInitialize?:
    boolean;

  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Initialization result
 * ======================================================= */

export type BackgroundNotificationsBootstrapResult = {
  initialized:
    boolean;

  state:
    BackgroundNotificationsBootstrapState;

  permission:
    ProcessingNotificationPermissionResult;

  notifications:
    BackgroundProcessingNotificationsSnapshot;

  adapter:
    ExpoNotificationsAdapterDiagnostics;

  durationMs:
    number;

  warnings:
    readonly string[];
};

/* =========================================================
 * Snapshot
 * ======================================================= */

export type BackgroundNotificationsBootstrapSnapshot = {
  state:
    BackgroundNotificationsBootstrapState;

  initialized:
    boolean;

  disposed:
    boolean;

  permissionGranted:
    boolean;

  permissionStatus:
    ProcessingNotificationPermissionResult[
      'status'
    ];

  notifications:
    BackgroundProcessingNotificationsSnapshot | null;

  initializedAt:
    number | null;

  lastUpdatedAt:
    number;

  lastOpenedRoute:
    string | null;

  lastError:
    string | null;

  warnings:
    readonly string[];
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type BackgroundNotificationsBootstrapDiagnostics = {
  initializeCount:
    number;

  initializeFailureCount:
    number;

  permissionRequestCount:
    number;

  routeResponseCount:
    number;

  routeFailureCount:
    number;

  manualSendCount:
    number;

  disposeCount:
    number;

  lastOperationAt:
    number | null;

  lastError:
    string | null;

  notifications:
    BackgroundProcessingNotificationsDiagnostics | null;

  adapter:
    ExpoNotificationsAdapterDiagnostics | null;
};

/* =========================================================
 * Runtime
 * ======================================================= */

type BackgroundNotificationsRuntime = {
  queueService:
    ScanItemQueueService;

  adapter:
    ExpoNotificationsAdapter;

  notifications:
    BackgroundProcessingNotifications;
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

  if (
    typeof error ===
      'object' &&
    error !==
      null &&
    'message' in error &&
    typeof (
      error as {
        message?:
          unknown;
      }
    ).message ===
      'string'
  ) {
    return (
      error as {
        message:
          string;
      }
    ).message;
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

function normalizeRoute(
  route:
    string | null | undefined
): string | null {
  if (
    typeof route !==
      'string'
  ) {
    return null;
  }

  const trimmed =
    route.trim();

  return trimmed.length >
    0
    ? trimmed
    : null;
}

function normalizeWarnings(
  warnings:
    readonly string[]
): string[] {
  const normalizedWarnings:
    string[] =
      [];

  for (
    const warning of
      warnings
  ) {
    if (
      typeof warning !==
        'string'
    ) {
      continue;
    }

    const normalized =
      warning.trim();

    if (
      normalized.length ===
        0 ||
      normalizedWarnings.includes(
        normalized
      )
    ) {
      continue;
    }

    normalizedWarnings.push(
      normalized
    );
  }

  return normalizedWarnings;
}

function createInitialPermission():
  ProcessingNotificationPermissionResult {
  return {
    status:
      'unknown',

    granted:
      false,

    canAskAgain:
      true,

    message:
      'Notification permission has not been checked.',
  };
}

function clonePermission(
  permission:
    ProcessingNotificationPermissionResult
): ProcessingNotificationPermissionResult {
  return {
    ...permission,
  };
}

/* =========================================================
 * Bootstrap
 * ======================================================= */

export class BackgroundProcessingNotificationsBootstrap {
  private state:
    BackgroundNotificationsBootstrapState =
      'uninitialized';

  private runtime:
    BackgroundNotificationsRuntime | null =
      null;

  private initializePromise:
    Promise<
      BackgroundNotificationsBootstrapResult
    > | null =
      null;

  private disposePromise:
    Promise<void> | null =
      null;

  private permission:
    ProcessingNotificationPermissionResult =
      createInitialPermission();

  private initializedAt:
    number | null =
      null;

  private lastUpdatedAt =
    now();

  private lastOpenedRoute:
    string | null =
      null;

  private lastError:
    string | null =
      null;

  private warnings:
    string[] =
      [];

  private readonly routeHandler:
    BackgroundNotificationRouteHandler;

  private readonly enableDebugLogs:
    boolean;

  private readonly suppliedQueueService:
    ScanItemQueueService | null;

  private readonly suppliedAdapter:
    ExpoNotificationsAdapter | null;

  private readonly adapterOptions:
    ExpoNotificationsAdapterOptions;

  private readonly notificationsConfig:
    Partial<
      BackgroundProcessingNotificationsConfig
    >;

  private diagnostics: {
    initializeCount:
      number;

    initializeFailureCount:
      number;

    permissionRequestCount:
      number;

    routeResponseCount:
      number;

    routeFailureCount:
      number;

    manualSendCount:
      number;

    disposeCount:
      number;

    lastOperationAt:
      number | null;

    lastError:
      string | null;
  } = {
    initializeCount:
      0,

    initializeFailureCount:
      0,

    permissionRequestCount:
      0,

    routeResponseCount:
      0,

    routeFailureCount:
      0,

    manualSendCount:
      0,

    disposeCount:
      0,

    lastOperationAt:
      null,

    lastError:
      null,
  };

  constructor(
    options:
      BackgroundNotificationsBootstrapOptions =
        {}
  ) {
    this.suppliedQueueService =
      options.queueService ??
      null;

    this.suppliedAdapter =
      options.adapter ??
      null;

    this.adapterOptions = {
      ...(options.adapterOptions ??
      {}),

      enableDebugLogs:
        options.adapterOptions
          ?.enableDebugLogs ??
        options.enableDebugLogs ??
        false,
    };

    this.notificationsConfig = {
      ...(options.notificationsConfig ??
      {}),

      requestPermissionOnInitialize:
        options
          .notificationsConfig
          ?.requestPermissionOnInitialize ??
        options
          .requestPermissionOnInitialize ??
        true,

      enableDebugLogs:
        options
          .notificationsConfig
          ?.enableDebugLogs ??
        options.enableDebugLogs ??
        false,
    };

    this.routeHandler =
      options.onOpenRoute ??
      (() => undefined);

    this.enableDebugLogs =
      options.enableDebugLogs ??
      false;

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
      BackgroundNotificationsBootstrapResult
    > {
    this.assertNotDisposed();

    if (
      this.initializePromise
    ) {
      return this.initializePromise;
    }

    if (
      this.runtime &&
      (
        this.state ===
          'ready' ||
        this.state ===
          'permission-denied' ||
        this.state ===
          'unavailable'
      )
    ) {
      return Promise.resolve(
        this.createExistingResult()
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
      BackgroundNotificationsBootstrapResult
    > {
    const startedAt =
      now();

    this.state =
      'initializing';

    this.lastError =
      null;

    this.warnings =
      [];

    this.lastUpdatedAt =
      startedAt;

    this.diagnostics = {
      ...this.diagnostics,

      initializeCount:
        this.diagnostics
          .initializeCount +
      1,

      lastOperationAt:
        startedAt,

      lastError:
        null,
    };

    try {
      const queueService =
        this.suppliedQueueService ??
        getDefaultScanItemQueueService();

      const adapter =
        this.suppliedAdapter ??
        createExpoNotificationsAdapter(
          this.adapterOptions
        );

      const notifications =
        createBackgroundProcessingNotifications({
          adapter,

          queueService,

          config:
            this.notificationsConfig,

          autoInitialize:
            false,

          onNotificationResponse:
            response => {
              void this.handleNotificationResponse(
                response
              );
            },
        });

      this.runtime = {
        queueService,

        adapter,

        notifications,
      };

      this.permission =
        await notifications
          .initialize();

      const notificationsDiagnostics =
        notifications
          .getDiagnostics();

      this.diagnostics = {
        ...this.diagnostics,

        permissionRequestCount:
          notificationsDiagnostics
            .permissionRequestCount,
      };

      if (
        this.permission.granted
      ) {
        this.state =
          'ready';
      } else if (
        this.permission.status ===
          'unavailable'
      ) {
        this.state =
          'unavailable';
      } else {
        this.state =
          'permission-denied';
      }

      if (
        !this.permission.granted
      ) {
        this.warnings =
          normalizeWarnings([
            ...this.warnings,
            this.permission.message,
          ]);
      }

      const completedAt =
        now();

      this.initializedAt =
        completedAt;

      this.lastUpdatedAt =
        completedAt;

      this.lastError =
        null;

      this.diagnostics = {
        ...this.diagnostics,

        lastOperationAt:
          completedAt,

        lastError:
          null,
      };

      return {
        initialized:
          true,

        state:
          this.state,

        permission:
          clonePermission(
            this.permission
          ),

        notifications:
          notifications
            .getSnapshot(),

        adapter:
          adapter
            .getDiagnostics(),

        durationMs:
          Math.max(
            0,
            completedAt -
            startedAt
          ),

        warnings: [
          ...this.warnings,
        ],
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.state =
        'failed';

      this.lastError =
        message;

      this.lastUpdatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        initializeFailureCount:
          this.diagnostics
            .initializeFailureCount +
        1,

        lastOperationAt:
          this.lastUpdatedAt,

        lastError:
          message,
      };

      throw error;
    }
  }

  private createExistingResult():
    BackgroundNotificationsBootstrapResult {
    const runtime =
      this.requireRuntime();

    return {
      initialized:
        true,

      state:
        this.state,

      permission:
        clonePermission(
          this.permission
        ),

      notifications:
        runtime.notifications
          .getSnapshot(),

      adapter:
        runtime.adapter
          .getDiagnostics(),

      durationMs:
        0,

      warnings: [
        ...this.warnings,
      ],
    };
  }

  /* =======================================================
   * Permission
   * ===================================================== */

  public async requestPermission():
    Promise<
      ProcessingNotificationPermissionResult
    > {
    const runtime =
      await this.ensureRuntime();

    this.diagnostics = {
      ...this.diagnostics,

      permissionRequestCount:
        this.diagnostics
          .permissionRequestCount +
      1,

      lastOperationAt:
        now(),
    };

    try {
      this.permission =
        await runtime
          .notifications
          .requestPermission();

      this.resolveStateFromPermission();

      this.lastUpdatedAt =
        now();

      this.lastError =
        null;

      this.warnings =
        this.permission.granted
          ? []
          : normalizeWarnings([
              this.permission.message,
            ]);

      this.diagnostics = {
        ...this.diagnostics,

        lastOperationAt:
          this.lastUpdatedAt,

        lastError:
          null,
      };

      return clonePermission(
        this.permission
      );
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.state =
        'failed';

      this.lastError =
        message;

      this.lastUpdatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        lastOperationAt:
          this.lastUpdatedAt,

        lastError:
          message,
      };

      throw error;
    }
  }

  public async refreshPermission():
    Promise<
      ProcessingNotificationPermissionResult
    > {
    const runtime =
      await this.ensureRuntime();

    try {
      this.permission =
        await runtime
          .notifications
          .refreshPermission();

      this.resolveStateFromPermission();

      this.lastUpdatedAt =
        now();

      this.lastError =
        null;

      this.warnings =
        this.permission.granted
          ? []
          : normalizeWarnings([
              this.permission.message,
            ]);

      this.diagnostics = {
        ...this.diagnostics,

        lastOperationAt:
          this.lastUpdatedAt,

        lastError:
          null,
      };

      return clonePermission(
        this.permission
      );
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.state =
        'failed';

      this.lastError =
        message;

      this.lastUpdatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        lastOperationAt:
          this.lastUpdatedAt,

        lastError:
          message,
      };

      throw error;
    }
  }

  private resolveStateFromPermission():
    void {
    if (
      this.permission.granted
    ) {
      this.state =
        'ready';

      return;
    }

    if (
      this.permission.status ===
        'unavailable'
    ) {
      this.state =
        'unavailable';

      return;
    }

    this.state =
      'permission-denied';
  }

  /* =======================================================
   * Notification response
   * ===================================================== */

  private async handleNotificationResponse(
    response:
      ProcessingNotificationResponse
  ): Promise<void> {
    const route =
      normalizeRoute(
        response.route
      );

    this.diagnostics = {
      ...this.diagnostics,

      routeResponseCount:
        this.diagnostics
          .routeResponseCount +
      1,

      lastOperationAt:
        now(),
    };

    if (
      !route
    ) {
      return;
    }

    this.lastOpenedRoute =
      route;

    this.lastUpdatedAt =
      now();

    try {
      await this.routeHandler(
        route,
        response
      );

      this.lastError =
        null;

      this.diagnostics = {
        ...this.diagnostics,

        lastOperationAt:
          now(),

        lastError:
          null,
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.lastError =
        message;

      this.diagnostics = {
        ...this.diagnostics,

        routeFailureCount:
          this.diagnostics
            .routeFailureCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      };

      if (
        this.enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NOTIFICATION ROUTE ERROR:',
          error
        );
      }
    }
  }

  /* =======================================================
   * Manual sends
   * ===================================================== */

  public async send(
    payload:
      ProcessingNotificationPayload,
    allowDuplicate =
      false
  ): Promise<
    ProcessingNotificationSendResult
  > {
    const runtime =
      await this.ensureRuntime();

    this.diagnostics = {
      ...this.diagnostics,

      manualSendCount:
        this.diagnostics
          .manualSendCount +
      1,

      lastOperationAt:
        now(),
    };

    const result =
      await runtime.notifications
        .send(
          payload,
          allowDuplicate
        );

    if (
      result.sent
    ) {
      this.lastError =
        null;

      this.diagnostics = {
        ...this.diagnostics,

        lastError:
          null,
      };
    } else if (
      result.errorMessage
    ) {
      this.lastError =
        result.errorMessage;

      this.diagnostics = {
        ...this.diagnostics,

        lastError:
          result.errorMessage,
      };
    }

    this.lastUpdatedAt =
      now();

    return result;
  }

  public async sendWardrobeReady(
    snapshot?:
      ProcessingQueueSnapshot
  ): Promise<
    ProcessingNotificationSendResult
  > {
    const runtime =
      await this.ensureRuntime();

    this.diagnostics = {
      ...this.diagnostics,

      manualSendCount:
        this.diagnostics
          .manualSendCount +
      1,

      lastOperationAt:
        now(),
    };

    const result =
      await runtime.notifications
        .sendWardrobeReadyNotification(
          snapshot
        );

    if (
      result.sent
    ) {
      this.lastError =
        null;

      this.diagnostics = {
        ...this.diagnostics,

        lastError:
          null,
      };
    } else if (
      result.errorMessage
    ) {
      this.lastError =
        result.errorMessage;

      this.diagnostics = {
        ...this.diagnostics,

        lastError:
          result.errorMessage,
      };
    }

    this.lastUpdatedAt =
      now();

    return result;
  }

  /* =======================================================
   * Queries
   * ===================================================== */

  public getSnapshot():
    BackgroundNotificationsBootstrapSnapshot {
    return {
      state:
        this.state,

      initialized:
        this.runtime !==
          null &&
        (
          this.state ===
            'ready' ||
          this.state ===
            'permission-denied' ||
          this.state ===
            'unavailable'
        ),

      disposed:
        this.state ===
          'disposed',

      permissionGranted:
        this.permission.granted,

      permissionStatus:
        this.permission.status,

      notifications:
        this.runtime
          ? this.runtime
              .notifications
              .getSnapshot()
          : null,

      initializedAt:
        this.initializedAt,

      lastUpdatedAt:
        this.lastUpdatedAt,

      lastOpenedRoute:
        this.lastOpenedRoute,

      lastError:
        this.lastError,

      warnings: [
        ...this.warnings,
      ],
    };
  }

  public getDiagnostics():
    BackgroundNotificationsBootstrapDiagnostics {
    return {
      ...this.diagnostics,

      lastError:
        this.lastError ??
        this.diagnostics
          .lastError,

      notifications:
        this.runtime
          ? this.runtime
              .notifications
              .getDiagnostics()
          : null,

      adapter:
        this.runtime
          ? this.runtime
              .adapter
              .getDiagnostics()
          : null,
    };
  }

  public getNotifications():
    BackgroundProcessingNotifications {
    return this.requireRuntime()
      .notifications;
  }

  public getAdapter():
    ExpoNotificationsAdapter {
    return this.requireRuntime()
      .adapter;
  }

  public getPermission():
    ProcessingNotificationPermissionResult {
    return clonePermission(
      this.permission
    );
  }

  public isPermissionGranted():
    boolean {
    return this.permission
      .granted;
  }

  /* =======================================================
   * Runtime helpers
   * ===================================================== */

  private async ensureRuntime():
    Promise<
      BackgroundNotificationsRuntime
    > {
    this.assertNotDisposed();

    if (
      !this.runtime
    ) {
      await this.initialize();
    }

    return this.requireRuntime();
  }

  private requireRuntime():
    BackgroundNotificationsRuntime {
    if (
      !this.runtime
    ) {
      throw new Error(
        'Background notification processing has not been initialized.'
      );
    }

    return this.runtime;
  }

  /* =======================================================
   * Dispose
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
      this.state ===
        'disposed'
    ) {
      return;
    }

    this.state =
      'disposing';

    this.lastUpdatedAt =
      now();

    const runtime =
      this.runtime;

    this.runtime =
      null;

    if (
      runtime
    ) {
      try {
        /**
         * BackgroundProcessingNotifications
         * هو المالك للـAdapter ويقوم بتنظيفه داخليًا.
         *
         * لا نستدعي adapter.dispose هنا مرة ثانية.
         */
        await runtime
          .notifications
          .dispose();
      } catch {
        // لا نرمي أثناء dispose.
      }
    }

    this.state =
      'disposed';

    this.permission =
      createInitialPermission();

    this.initializedAt =
      null;

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      disposeCount:
        this.diagnostics
          .disposeCount +
      1,

      lastOperationAt:
        this.lastUpdatedAt,
    };
  }

  private assertNotDisposed():
    void {
    if (
      this.state ===
        'disposed' ||
      this.state ===
        'disposing'
    ) {
      throw new Error(
        'Background notification bootstrap has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultBackgroundNotificationsBootstrap:
  BackgroundProcessingNotificationsBootstrap | null =
    null;

export function getDefaultBackgroundNotificationsBootstrap(
  options?:
    BackgroundNotificationsBootstrapOptions
): BackgroundProcessingNotificationsBootstrap {
  if (
    !defaultBackgroundNotificationsBootstrap
  ) {
    defaultBackgroundNotificationsBootstrap =
      new BackgroundProcessingNotificationsBootstrap(
        options
      );
  }

  return defaultBackgroundNotificationsBootstrap;
}

/* =========================================================
 * Public helpers
 * ======================================================= */

export function initializeBackgroundProcessingNotifications(
  options?:
    BackgroundNotificationsBootstrapOptions
): Promise<
  BackgroundNotificationsBootstrapResult
> {
  return getDefaultBackgroundNotificationsBootstrap(
    options
  ).initialize();
}

export function getBackgroundProcessingNotificationsSnapshot():
  BackgroundNotificationsBootstrapSnapshot {
  return getDefaultBackgroundNotificationsBootstrap()
    .getSnapshot();
}

export function getBackgroundProcessingNotificationsDiagnostics():
  BackgroundNotificationsBootstrapDiagnostics {
  return getDefaultBackgroundNotificationsBootstrap()
    .getDiagnostics();
}

export async function requestBackgroundNotificationPermission():
  Promise<
    ProcessingNotificationPermissionResult
  > {
  return getDefaultBackgroundNotificationsBootstrap()
    .requestPermission();
}

export async function disposeBackgroundNotificationsBootstrap():
  Promise<void> {
  if (
    !defaultBackgroundNotificationsBootstrap
  ) {
    return;
  }

  await defaultBackgroundNotificationsBootstrap
    .dispose();

  defaultBackgroundNotificationsBootstrap =
    null;
}

export default
  BackgroundProcessingNotificationsBootstrap;