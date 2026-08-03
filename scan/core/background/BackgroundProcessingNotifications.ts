// scan/core/background/BackgroundProcessingNotifications.ts
//
// Triple N - Background Processing Notifications
//
// هذا الملف هو المدير الموحد لإشعارات
// Scan Item Processing Queue.
//
// مسؤولياته:
//
// 1) طلب صلاحية الإشعارات.
// 2) معرفة حالة الصلاحية الحالية.
// 3) إرسال إشعار عند بداية معالجة مجموعة صور.
// 4) إرسال إشعار عند اكتمال صورة واحدة عند تفعيل ذلك.
// 5) إرسال إشعار عند اكتمال الدولاب بالكامل.
// 6) إرسال إشعار عند اكتمال المجموعة مع وجود أخطاء.
// 7) إرسال إشعار عند فشل المعالجة.
// 8) منع تكرار نفس الإشعار.
// 9) الاستماع إلى Queue Events.
// 10) دعم iOS وAndroid من خلال Adapter مستقل.
// 11) عدم ربط الملف مباشرة بمكتبة Notifications بعينها.
// 12) توفير النص الإنجليزي النهائي المتفق عليه.
//
// هذا الملف لا يستورد expo-notifications مباشرة.
//
// الملف القادم سيربطه بالتنفيذ الحقيقي:
//
// ExpoNotificationsAdapter.ts

import type {
    ProcessingBatchId,
    ProcessingJob,
    ProcessingJobError,
    ProcessingJobId,
    ProcessingNotificationKind,
    ProcessingNotificationPayload,
    ProcessingQueueEvent,
    ProcessingQueueSnapshot,
    ProcessingTimestamp,
} from '../queue/QueueTypes';

import type {
    ProcessingQueueEventSubscription,
} from '../queue/QueueEvents';

import type {
    ScanItemQueueService,
} from '../services/ScanItemQueueService';

import {
    getDefaultScanItemQueueService,
} from '../services/ScanItemQueueService';

/* =========================================================
 * Permission
 * ======================================================= */

export type ProcessingNotificationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'restricted'
  | 'unavailable'
  | 'unknown';

export type ProcessingNotificationPermissionResult = {
  status:
    ProcessingNotificationPermissionStatus;

  granted:
    boolean;

  canAskAgain:
    boolean;

  message:
    string;
};

/* =========================================================
 * Native notification result
 * ======================================================= */

export type ProcessingNotificationSendResult = {
  sent:
    boolean;

  notificationId:
    string | null;

  errorMessage:
    string | null;
};

/* =========================================================
 * Notification response
 * ======================================================= */

export type ProcessingNotificationResponse = {
  notificationId:
    string | null;

  route:
    string | null;

  queueId:
    string | null;

  batchId:
    ProcessingBatchId | null;

  jobId:
    ProcessingJobId | null;

  data:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Notification adapter
 * ======================================================= */

export type ProcessingNotificationAdapter = {
  initialize():
    Promise<
      ProcessingNotificationPermissionResult
    >;

  getPermissionStatus():
    Promise<
      ProcessingNotificationPermissionResult
    >;

  requestPermission():
    Promise<
      ProcessingNotificationPermissionResult
    >;

  send(
    payload:
      ProcessingNotificationPayload
  ): Promise<
    ProcessingNotificationSendResult
  >;

  cancel?(
    notificationId:
      string
  ): Promise<void>;

  cancelAll?():
    Promise<void>;

  setResponseHandler?(
    handler:
      (
        response:
          ProcessingNotificationResponse
      ) => void
  ): () => void;

  dispose?():
    Promise<void>;
};

/* =========================================================
 * Service state
 * ======================================================= */

export type BackgroundProcessingNotificationsState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'permission-denied'
  | 'unavailable'
  | 'failed'
  | 'disposed';

/* =========================================================
 * Configuration
 * ======================================================= */

export type BackgroundProcessingNotificationsConfig = {
  enabled:
    boolean;

  requestPermissionOnInitialize:
    boolean;

  notifyWhenProcessingStarts:
    boolean;

  notifyWhenSingleItemCompletes:
    boolean;

  notifyWhenBatchCompletes:
    boolean;

  notifyWhenProcessingFails:
    boolean;

  wardrobeRoute:
    string;

  startedTitle:
    string;

  startedBody:
    string;

  singleItemCompletedTitle:
    string;

  singleItemCompletedBody:
    string;

  batchCompletedTitle:
    string;

  batchCompletedBody:
    string;

  batchCompletedWithErrorsTitle:
    string;

  batchCompletedWithErrorsBody:
    string;

  processingFailedTitle:
    string;

  processingFailedBody:
    string;

  enableDebugLogs:
    boolean;
};

export type PartialBackgroundProcessingNotificationsConfig =
  Partial<
    BackgroundProcessingNotificationsConfig
  >;

/* =========================================================
 * Default configuration
 * ======================================================= */

export const DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG:
  BackgroundProcessingNotificationsConfig = {
    enabled:
      true,

    requestPermissionOnInitialize:
      true,

    notifyWhenProcessingStarts:
      false,

    notifyWhenSingleItemCompletes:
      false,

    notifyWhenBatchCompletes:
      true,

    notifyWhenProcessingFails:
      true,

    wardrobeRoute:
      '/app/wardrobe',

    startedTitle:
      'Preparing your wardrobe',

    startedBody:
      'Your items are being processed. Enjoy using your phone and we will let you know when your wardrobe is ready.',

    singleItemCompletedTitle:
      'Your item is ready',

    singleItemCompletedBody:
      'One of your wardrobe items has finished processing.',

    batchCompletedTitle:
      'Your wardrobe is ready 🎉',

    batchCompletedBody:
      'Congratulations! Your wardrobe is ready. Open Triple N and try your first outfit.',

    batchCompletedWithErrorsTitle:
      'Your wardrobe is ready',

    batchCompletedWithErrorsBody:
      'Your wardrobe has finished processing, but some items could not be completed. Open Triple N to review them.',

    processingFailedTitle:
      'Item processing needs attention',

    processingFailedBody:
      'One of your items could not be processed. Open Triple N to try again.',

    enableDebugLogs:
      false,
  };

/* =========================================================
 * Service options
 * ======================================================= */

export type BackgroundProcessingNotificationsOptions = {
  adapter:
    ProcessingNotificationAdapter;

  queueService?:
    ScanItemQueueService;

  config?:
    PartialBackgroundProcessingNotificationsConfig;

  autoInitialize?:
    boolean;

  onNotificationResponse?:
    (
      response:
        ProcessingNotificationResponse
    ) => void;
};

/* =========================================================
 * Snapshot
 * ======================================================= */

export type BackgroundProcessingNotificationsSnapshot = {
  state:
    BackgroundProcessingNotificationsState;

  initialized:
    boolean;

  disposed:
    boolean;

  enabled:
    boolean;

  permission:
    ProcessingNotificationPermissionResult;

  sentNotificationCount:
    number;

  failedNotificationCount:
    number;

  lastNotificationKind:
    ProcessingNotificationKind | null;

  lastNotificationId:
    string | null;

  lastSentAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type BackgroundProcessingNotificationsDiagnostics = {
  initializeCount:
    number;

  permissionRequestCount:
    number;

  queueEventCount:
    number;

  sendAttemptCount:
    number;

  sendSuccessCount:
    number;

  sendFailureCount:
    number;

  skippedDuplicateCount:
    number;

  skippedDisabledCount:
    number;

  skippedPermissionCount:
    number;

  responseCount:
    number;

  lastQueueEventType:
    ProcessingQueueEvent['type'] | null;

  lastPayload:
    ProcessingNotificationPayload | null;

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

function createUnknownPermission():
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

function normalizeConfig(
  config:
    PartialBackgroundProcessingNotificationsConfig =
      {}
): BackgroundProcessingNotificationsConfig {
  const merged = {
    ...DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG,
    ...config,
  };

  return {
    ...merged,

    wardrobeRoute:
      merged.wardrobeRoute
        .trim() ||
      '/app/wardrobe',

    startedTitle:
      merged.startedTitle
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .startedTitle,

    startedBody:
      merged.startedBody
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .startedBody,

    singleItemCompletedTitle:
      merged
        .singleItemCompletedTitle
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .singleItemCompletedTitle,

    singleItemCompletedBody:
      merged
        .singleItemCompletedBody
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .singleItemCompletedBody,

    batchCompletedTitle:
      merged
        .batchCompletedTitle
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .batchCompletedTitle,

    batchCompletedBody:
      merged
        .batchCompletedBody
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .batchCompletedBody,

    batchCompletedWithErrorsTitle:
      merged
        .batchCompletedWithErrorsTitle
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .batchCompletedWithErrorsTitle,

    batchCompletedWithErrorsBody:
      merged
        .batchCompletedWithErrorsBody
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .batchCompletedWithErrorsBody,

    processingFailedTitle:
      merged
        .processingFailedTitle
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .processingFailedTitle,

    processingFailedBody:
      merged
        .processingFailedBody
        .trim() ||
      DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG
        .processingFailedBody,
  };
}

function clonePayload(
  payload:
    ProcessingNotificationPayload | null
): ProcessingNotificationPayload | null {
  if (
    !payload
  ) {
    return null;
  }

  return {
    ...payload,

    data: {
      ...payload.data,
    },
  };
}

function getBatchId(
  event:
    ProcessingQueueEvent
): ProcessingBatchId | null {
  return (
    event.batchId ??
    event.snapshot
      .currentBatchId ??
    event.job
      ?.batchId ??
    null
  );
}

function getJobId(
  event:
    ProcessingQueueEvent
): ProcessingJobId | null {
  return (
    event.jobId ??
    event.job?.id ??
    null
  );
}

function createNotificationKey(
  payload:
    ProcessingNotificationPayload
): string {
  return [
    payload.kind,
    payload.queueId,
    payload.batchId ??
      'no-batch',
    payload.jobId ??
      'no-job',
    payload.completedItems ??
      'no-completed-count',
    payload.totalItems ??
      'no-total-count',
  ].join(
    '::'
  );
}

function createBaseData(
  snapshot:
    ProcessingQueueSnapshot,
  event:
    ProcessingQueueEvent
): Record<
  string,
  string | number | boolean | null
> {
  return {
    queueId:
      snapshot.queueId,

    batchId:
      getBatchId(
        event
      ),

    jobId:
      getJobId(
        event
      ),

    queueStatus:
      snapshot.status,

    overallPercentage:
      snapshot.statistics
        .overallPercentage,

    totalItems:
      snapshot.statistics.total,

    completedItems:
      snapshot.statistics.completed,

    failedItems:
      snapshot.statistics.failed,

    cancelledItems:
      snapshot.statistics.cancelled,

    revision:
      snapshot.revision,
  };
}

function createStartedPayload(
  event:
    ProcessingQueueEvent,
  config:
    BackgroundProcessingNotificationsConfig
): ProcessingNotificationPayload {
  const snapshot =
    event.snapshot;

  return {
    kind:
      'processing-started',

    title:
      config.startedTitle,

    body:
      config.startedBody,

    queueId:
      snapshot.queueId,

    batchId:
      getBatchId(
        event
      ),

    jobId:
      null,

    overallProgress:
      snapshot.statistics
        .overallProgress,

    completedItems:
      snapshot.statistics
        .completed,

    totalItems:
      snapshot.statistics.total,

    route:
      config.wardrobeRoute,

    data:
      createBaseData(
        snapshot,
        event
      ),
  };
}

function createSingleItemCompletedPayload(
  event:
    ProcessingQueueEvent,
  config:
    BackgroundProcessingNotificationsConfig
): ProcessingNotificationPayload {
  const snapshot =
    event.snapshot;

  return {
    kind:
      'single-item-completed',

    title:
      config
        .singleItemCompletedTitle,

    body:
      config
        .singleItemCompletedBody,

    queueId:
      snapshot.queueId,

    batchId:
      getBatchId(
        event
      ),

    jobId:
      getJobId(
        event
      ),

    overallProgress:
      snapshot.statistics
        .overallProgress,

    completedItems:
      snapshot.statistics
        .completed,

    totalItems:
      snapshot.statistics.total,

    route:
      config.wardrobeRoute,

    data: {
      ...createBaseData(
        snapshot,
        event
      ),

      wardrobeItemId:
        event.job
          ?.wardrobeItemId ??
        null,

      processedImageUri:
        event.job
          ?.output
          ?.processedImageUri ??
        null,
    },
  };
}

function createBatchCompletedPayload(
  event:
    ProcessingQueueEvent,
  config:
    BackgroundProcessingNotificationsConfig
): ProcessingNotificationPayload {
  const snapshot =
    event.snapshot;

  const hasErrors =
    snapshot.statistics.failed >
      0 ||
    snapshot.statistics.cancelled >
      0;

  return {
    kind:
      hasErrors
        ? 'batch-completed-with-errors'
        : 'batch-completed',

    title:
      hasErrors
        ? config
            .batchCompletedWithErrorsTitle
        : config
            .batchCompletedTitle,

    body:
      hasErrors
        ? config
            .batchCompletedWithErrorsBody
        : config
            .batchCompletedBody,

    queueId:
      snapshot.queueId,

    batchId:
      getBatchId(
        event
      ),

    jobId:
      null,

    overallProgress:
      snapshot.statistics
        .overallProgress,

    completedItems:
      snapshot.statistics
        .completed,

    totalItems:
      snapshot.statistics.total,

    route:
      config.wardrobeRoute,

    data:
      createBaseData(
        snapshot,
        event
      ),
  };
}

function createFailurePayload(
  event:
    ProcessingQueueEvent,
  config:
    BackgroundProcessingNotificationsConfig
): ProcessingNotificationPayload {
  const snapshot =
    event.snapshot;

  return {
    kind:
      'processing-failed',

    title:
      config
        .processingFailedTitle,

    body:
      event.error
        ?.message
        ?.trim() ||
      config
        .processingFailedBody,

    queueId:
      snapshot.queueId,

    batchId:
      getBatchId(
        event
      ),

    jobId:
      getJobId(
        event
      ),

    overallProgress:
      snapshot.statistics
        .overallProgress,

    completedItems:
      snapshot.statistics
        .completed,

    totalItems:
      snapshot.statistics.total,

    route:
      config.wardrobeRoute,

    data: {
      ...createBaseData(
        snapshot,
        event
      ),

      errorCode:
        event.error
          ?.code ??
        null,

      retryable:
        event.error
          ?.retryable ??
        false,

      wardrobeItemId:
        event.job
          ?.wardrobeItemId ??
        null,
    },
  };
}

/* =========================================================
 * Notifications service
 * ======================================================= */

export class BackgroundProcessingNotifications {
  private readonly adapter:
    ProcessingNotificationAdapter;

  private readonly queueService:
    ScanItemQueueService;

  private readonly config:
    BackgroundProcessingNotificationsConfig;

  private readonly onNotificationResponse:
    (
      response:
        ProcessingNotificationResponse
    ) => void;

  private state:
    BackgroundProcessingNotificationsState =
      'uninitialized';

  private initialized =
    false;

  private disposed =
    false;

  private permission:
    ProcessingNotificationPermissionResult =
      createUnknownPermission();

  private queueSubscription:
    ProcessingQueueEventSubscription | null =
      null;

  private responseUnsubscribe:
    (() => void) | null =
      null;

  private initializePromise:
    Promise<ProcessingNotificationPermissionResult> | null =
      null;

  private sentKeys =
    new Set<
      string
    >();

  private sentNotificationIds =
    new Set<
      string
    >();

  private sentNotificationCount =
    0;

  private failedNotificationCount =
    0;

  private lastNotificationKind:
    ProcessingNotificationKind | null =
      null;

  private lastNotificationId:
    string | null =
      null;

  private lastSentAt:
    ProcessingTimestamp | null =
      null;

  private lastError:
    string | null =
      null;

  private diagnostics:
    BackgroundProcessingNotificationsDiagnostics = {
    initializeCount:
      0,

    permissionRequestCount:
      0,

    queueEventCount:
      0,

    sendAttemptCount:
      0,

    sendSuccessCount:
      0,

    sendFailureCount:
      0,

    skippedDuplicateCount:
      0,

    skippedDisabledCount:
      0,

    skippedPermissionCount:
      0,

    responseCount:
      0,

    lastQueueEventType:
      null,

    lastPayload:
      null,

    lastOperationAt:
      null,

    lastError:
      null,
  };

  constructor(
    options:
      BackgroundProcessingNotificationsOptions
  ) {
    if (
      !options.adapter
    ) {
      throw new Error(
        'BackgroundProcessingNotifications requires a notification adapter.'
      );
    }

    this.adapter =
      options.adapter;

    this.queueService =
      options.queueService ??
      getDefaultScanItemQueueService();

    this.config =
      normalizeConfig(
        options.config
      );

    this.onNotificationResponse =
      options
        .onNotificationResponse ??
      (() => undefined);

    this.attachQueueEvents();
    this.attachResponseHandler();

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
      ProcessingNotificationPermissionResult
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
        ...this.permission,
      });
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
      ProcessingNotificationPermissionResult
    > {
    this.state =
      'initializing';

    this.lastError =
      null;

    try {
      let permission =
        await this.adapter
          .initialize();

      if (
        this.config
          .requestPermissionOnInitialize &&
        !permission.granted &&
        permission.canAskAgain
      ) {
        this.diagnostics = {
          ...this.diagnostics,

          permissionRequestCount:
            this.diagnostics
              .permissionRequestCount +
          1,
        };

        permission =
          await this.adapter
            .requestPermission();
      }

      this.permission =
        permission;

      this.initialized =
        true;

      this.state =
        permission.granted
          ? 'ready'
          : permission.status ===
              'unavailable'
            ? 'unavailable'
            : 'permission-denied';

      this.diagnostics = {
        ...this.diagnostics,

        initializeCount:
          this.diagnostics
            .initializeCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          null,
      };

      return {
        ...this.permission,
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

      this.diagnostics = {
        ...this.diagnostics,

        initializeCount:
          this.diagnostics
            .initializeCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      };

      throw error;
    }
  }

  /* =======================================================
   * Permission
   * ===================================================== */

  public async refreshPermission():
    Promise<
      ProcessingNotificationPermissionResult
    > {
    this.assertNotDisposed();

    this.permission =
      await this.adapter
        .getPermissionStatus();

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

    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        now(),
    };

    return {
      ...this.permission,
    };
  }

  public async requestPermission():
    Promise<
      ProcessingNotificationPermissionResult
    > {
    this.assertNotDisposed();

    this.diagnostics = {
      ...this.diagnostics,

      permissionRequestCount:
        this.diagnostics
          .permissionRequestCount +
      1,

      lastOperationAt:
        now(),
    };

    this.permission =
      await this.adapter
        .requestPermission();

    this.state =
      this.permission.granted
        ? 'ready'
        : this.permission.status ===
            'unavailable'
          ? 'unavailable'
          : 'permission-denied';

    return {
      ...this.permission,
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
      !this.config.enabled
    ) {
      this.diagnostics = {
        ...this.diagnostics,

        skippedDisabledCount:
          this.diagnostics
            .skippedDisabledCount +
        1,
      };

      return;
    }

    let payload:
      ProcessingNotificationPayload | null =
        null;

    switch (
      event.type
    ) {
      case 'queue-started':
        if (
          this.config
            .notifyWhenProcessingStarts
        ) {
          payload =
            createStartedPayload(
              event,
              this.config
            );
        }
        break;

      case 'job-completed':
        if (
          this.config
            .notifyWhenSingleItemCompletes
        ) {
          payload =
            createSingleItemCompletedPayload(
              event,
              this.config
            );
        }
        break;

      case 'queue-completed':
      case 'batch-completed':
        if (
          this.config
            .notifyWhenBatchCompletes
        ) {
          payload =
            createBatchCompletedPayload(
              event,
              this.config
            );
        }
        break;

      case 'job-failed':
      case 'queue-failed':
        if (
          this.config
            .notifyWhenProcessingFails
        ) {
          payload =
            createFailurePayload(
              event,
              this.config
            );
        }
        break;

      default:
        break;
    }

    if (
      !payload
    ) {
      return;
    }

    await this.send(
      payload
    );
  }

  /* =======================================================
   * Send
   * ===================================================== */

  public async send(
    payload:
      ProcessingNotificationPayload,
    allowDuplicate =
      false
  ): Promise<
    ProcessingNotificationSendResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    this.diagnostics = {
      ...this.diagnostics,

      sendAttemptCount:
        this.diagnostics
          .sendAttemptCount +
      1,

      lastPayload:
        clonePayload(
          payload
        ),

      lastOperationAt:
        now(),
    };

    if (
      !this.config.enabled
    ) {
      this.diagnostics = {
        ...this.diagnostics,

        skippedDisabledCount:
          this.diagnostics
            .skippedDisabledCount +
        1,
      };

      return {
        sent:
          false,

        notificationId:
          null,

        errorMessage:
          'Notifications are disabled.',
      };
    }

    if (
      !this.permission.granted
    ) {
      this.diagnostics = {
        ...this.diagnostics,

        skippedPermissionCount:
          this.diagnostics
            .skippedPermissionCount +
        1,
      };

      return {
        sent:
          false,

        notificationId:
          null,

        errorMessage:
          'Notification permission has not been granted.',
      };
    }

    const notificationKey =
      createNotificationKey(
        payload
      );

    if (
      !allowDuplicate &&
      this.sentKeys.has(
        notificationKey
      )
    ) {
      this.diagnostics = {
        ...this.diagnostics,

        skippedDuplicateCount:
          this.diagnostics
            .skippedDuplicateCount +
        1,
      };

      return {
        sent:
          false,

        notificationId:
          null,

        errorMessage:
          'This notification has already been sent.',
      };
    }

    try {
      const result =
        await this.adapter
          .send({
            ...payload,

            data: {
              ...payload.data,
            },
          });

      if (
        !result.sent
      ) {
        const message =
          result.errorMessage ??
          'The notification was not sent.';

        this.failedNotificationCount +=
          1;

        this.lastError =
          message;

        this.diagnostics = {
          ...this.diagnostics,

          sendFailureCount:
            this.diagnostics
              .sendFailureCount +
          1,

          lastOperationAt:
            now(),

          lastError:
            message,
        };

        return result;
      }

      this.sentKeys.add(
        notificationKey
      );

      if (
        result.notificationId
      ) {
        this.sentNotificationIds.add(
          result.notificationId
        );
      }

      this.sentNotificationCount +=
        1;

      this.lastNotificationKind =
        payload.kind;

      this.lastNotificationId =
        result.notificationId;

      this.lastSentAt =
        now();

      this.lastError =
        null;

      this.diagnostics = {
        ...this.diagnostics,

        sendSuccessCount:
          this.diagnostics
            .sendSuccessCount +
        1,

        lastOperationAt:
          this.lastSentAt,

        lastError:
          null,
      };

      return result;
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.failedNotificationCount +=
        1;

      this.lastError =
        message;

      this.diagnostics = {
        ...this.diagnostics,

        sendFailureCount:
          this.diagnostics
            .sendFailureCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      };

      if (
        this.config
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N PROCESSING NOTIFICATION ERROR:',
          error
        );
      }

      return {
        sent:
          false,

        notificationId:
          null,

        errorMessage:
          message,
      };
    }
  }

  /* =======================================================
   * Manual notification helpers
   * ===================================================== */

  public async sendWardrobeReadyNotification(
    snapshot?:
      ProcessingQueueSnapshot
  ): Promise<
    ProcessingNotificationSendResult
  > {
    const resolvedSnapshot =
      snapshot ??
      this.queueService
        .getSnapshot();

    const syntheticEvent:
      ProcessingQueueEvent = {
      type:
        'queue-completed',

      queueId:
        resolvedSnapshot
          .queueId,

      jobId:
        null,

      batchId:
        resolvedSnapshot
          .currentBatchId,

      timestamp:
        now(),

      snapshot:
        resolvedSnapshot,

      job:
        null,

      error:
        null,

      metadata:
        {},
    };

    return this.send(
      createBatchCompletedPayload(
        syntheticEvent,
        this.config
      )
    );
  }

  public async sendProcessingFailureNotification(
    input: {
      snapshot?:
        ProcessingQueueSnapshot;

      job?:
        ProcessingJob | null;

      error:
        ProcessingJobError;
    }
  ): Promise<
    ProcessingNotificationSendResult
  > {
    const snapshot =
      input.snapshot ??
      this.queueService
        .getSnapshot();

    const syntheticEvent:
      ProcessingQueueEvent = {
      type:
        'job-failed',

      queueId:
        snapshot.queueId,

      jobId:
        input.job?.id ??
        null,

      batchId:
        input.job?.batchId ??
        snapshot.currentBatchId,

      timestamp:
        now(),

      snapshot,

      job:
        input.job ??
        null,

      error:
        input.error,

      metadata:
        {},
    };

    return this.send(
      createFailurePayload(
        syntheticEvent,
        this.config
      )
    );
  }

  /* =======================================================
   * Notification response
   * ===================================================== */

  private attachResponseHandler():
    void {
    if (
      !this.adapter
        .setResponseHandler ||
      this.responseUnsubscribe
    ) {
      return;
    }

    this.responseUnsubscribe =
      this.adapter
        .setResponseHandler(
          response => {
            this.diagnostics = {
              ...this.diagnostics,

              responseCount:
                this.diagnostics
                  .responseCount +
              1,

              lastOperationAt:
                now(),
            };

            try {
              this.onNotificationResponse(
                response
              );
            } catch (error) {
              if (
                this.config
                  .enableDebugLogs
              ) {
                console.warn(
                  'TRIPLE N NOTIFICATION RESPONSE HANDLER ERROR:',
                  error
                );
              }
            }
          }
        );
  }

  /* =======================================================
   * Cancellation
   * ===================================================== */

  public async cancelNotification(
    notificationId:
      string
  ): Promise<void> {
    this.assertNotDisposed();

    if (
      !notificationId ||
      !this.adapter.cancel
    ) {
      return;
    }

    await this.adapter
      .cancel(
        notificationId
      );

    this.sentNotificationIds.delete(
      notificationId
    );
  }

  public async cancelAllNotifications():
    Promise<void> {
    this.assertNotDisposed();

    if (
      this.adapter.cancelAll
    ) {
      await this.adapter
        .cancelAll();
    } else if (
      this.adapter.cancel
    ) {
      for (
        const notificationId of
        this.sentNotificationIds
      ) {
        try {
          await this.adapter
            .cancel(
              notificationId
            );
        } catch {
          // نكمل بقية الإشعارات.
        }
      }
    }

    this.sentNotificationIds.clear();
  }

  /* =======================================================
   * Queries
   * ===================================================== */

  public getSnapshot():
    BackgroundProcessingNotificationsSnapshot {
    return {
      state:
        this.state,

      initialized:
        this.initialized,

      disposed:
        this.disposed,

      enabled:
        this.config.enabled,

      permission: {
        ...this.permission,
      },

      sentNotificationCount:
        this.sentNotificationCount,

      failedNotificationCount:
        this.failedNotificationCount,

      lastNotificationKind:
        this.lastNotificationKind,

      lastNotificationId:
        this.lastNotificationId,

      lastSentAt:
        this.lastSentAt,

      lastError:
        this.lastError,
    };
  }

  public getDiagnostics():
    BackgroundProcessingNotificationsDiagnostics {
    return {
      ...this.diagnostics,

      lastPayload:
        clonePayload(
          this.diagnostics
            .lastPayload
        ),
    };
  }

  public isPermissionGranted():
    boolean {
    return this.permission
      .granted;
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

    this.responseUnsubscribe
      ?.();

    this.responseUnsubscribe =
      null;

    try {
      await this.adapter
        .dispose?.();
    } catch {
      // لا نرمي أثناء dispose.
    }

    this.sentKeys.clear();
    this.sentNotificationIds.clear();

    this.initialized =
      false;

    this.disposed =
      true;

    this.state =
      'disposed';
  }

  private assertNotDisposed():
    void {
    if (
      this.disposed
    ) {
      throw new Error(
        'Background processing notifications have already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createBackgroundProcessingNotifications(
  options:
    BackgroundProcessingNotificationsOptions
): BackgroundProcessingNotifications {
  return new BackgroundProcessingNotifications(
    options
  );
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultBackgroundProcessingNotifications:
  BackgroundProcessingNotifications | null =
    null;

export function getDefaultBackgroundProcessingNotifications(
  options?:
    BackgroundProcessingNotificationsOptions
): BackgroundProcessingNotifications {
  if (
    !defaultBackgroundProcessingNotifications
  ) {
    if (
      !options
    ) {
      throw new Error(
        'Background processing notification options are required during the first initialization.'
      );
    }

    defaultBackgroundProcessingNotifications =
      new BackgroundProcessingNotifications(
        options
      );
  }

  return defaultBackgroundProcessingNotifications;
}

export async function disposeBackgroundProcessingNotifications():
  Promise<void> {
  if (
    !defaultBackgroundProcessingNotifications
  ) {
    return;
  }

  await defaultBackgroundProcessingNotifications
    .dispose();

  defaultBackgroundProcessingNotifications =
    null;
}

export default
  BackgroundProcessingNotifications;