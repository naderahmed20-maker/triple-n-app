// scan/core/background/ExpoNotificationsAdapter.ts
//
// Triple N - Expo Notifications Adapter
//
// هذا الملف يربط نظام إشعارات معالجة Scan Item
// بمكتبة expo-notifications الحقيقية.
//
// مسؤولياته:
//
// 1) تهيئة expo-notifications.
// 2) فحص صلاحية الإشعارات.
// 3) طلب الصلاحية من المستخدم.
// 4) إنشاء Android Notification Channel.
// 5) إرسال Local Notification فوري.
// 6) تمرير route وبيانات Queue داخل الإشعار.
// 7) استقبال ضغط المستخدم على الإشعار.
// 8) إلغاء إشعار واحد أو جميع الإشعارات.
// 9) منع انهيار التطبيق عند غياب الصلاحية.
// 10) تنظيف Listeners عند Dispose.
//
// هذا الملف لا يستمع إلى Queue مباشرة.
//
// الربط مع Queue يتم داخل:
//
// BackgroundProcessingNotifications.ts

import {
    Platform,
} from 'react-native';

import * as Notifications from 'expo-notifications';

import type {
    ProcessingNotificationPayload,
} from '../queue/QueueTypes';

import type {
    ProcessingNotificationAdapter,
    ProcessingNotificationPermissionResult,
    ProcessingNotificationPermissionStatus,
    ProcessingNotificationResponse,
    ProcessingNotificationSendResult,
} from './BackgroundProcessingNotifications';

/* =========================================================
 * Constants
 * ======================================================= */

const DEFAULT_ANDROID_CHANNEL_ID =
  'triple-n-wardrobe-processing';

const DEFAULT_ANDROID_CHANNEL_NAME =
  'Wardrobe Processing';

const DEFAULT_ANDROID_CHANNEL_DESCRIPTION =
  'Notifications about Scan Item wardrobe processing.';

const DEFAULT_ANDROID_NOTIFICATION_COLOR =
  '#22C55E';

const DEFAULT_NOTIFICATION_SOUND =
  'default';

const NOTIFICATION_DATA_ROUTE_KEY =
  'route';

const NOTIFICATION_DATA_QUEUE_ID_KEY =
  'queueId';

const NOTIFICATION_DATA_BATCH_ID_KEY =
  'batchId';

const NOTIFICATION_DATA_JOB_ID_KEY =
  'jobId';

/* =========================================================
 * Public options
 * ======================================================= */

export type ExpoNotificationsAdapterOptions = {
  /**
   * Android Notification Channel ID.
   */
  androidChannelId?:
    string;

  /**
   * الاسم الظاهر للمستخدم داخل
   * إعدادات إشعارات Android.
   */
  androidChannelName?:
    string;

  androidChannelDescription?:
    string;

  /**
   * لون الإشعار على Android.
   */
  androidNotificationColor?:
    string;

  /**
   * تفعيل الصوت.
   */
  enableSound?:
    boolean;

  /**
   * تفعيل Badge على iOS.
   */
  enableBadge?:
    boolean;

  /**
   * إظهار الإشعار أثناء فتح التطبيق.
   */
  showNotificationsInForeground?:
    boolean;

  /**
   * مسح Badge عند التهيئة.
   */
  clearBadgeOnInitialize?:
    boolean;

  /**
   * إلغاء الإشعارات القديمة عند التهيئة.
   */
  clearDeliveredNotificationsOnInitialize?:
    boolean;

  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type ExpoNotificationsAdapterDiagnostics = {
  initialized:
    boolean;

  disposed:
    boolean;

  platform:
    string;

  permissionStatus:
    ProcessingNotificationPermissionStatus;

  permissionGranted:
    boolean;

  androidChannelCreated:
    boolean;

  initializeCount:
    number;

  permissionCheckCount:
    number;

  permissionRequestCount:
    number;

  sendAttemptCount:
    number;

  sendSuccessCount:
    number;

  sendFailureCount:
    number;

  cancelCount:
    number;

  cancelAllCount:
    number;

  responseCount:
    number;

  listenerAttached:
    boolean;

  lastNotificationId:
    string | null;

  lastNotificationKind:
    ProcessingNotificationPayload[
      'kind'
    ] | null;

  lastOperationAt:
    number | null;

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

function normalizeText(
  value:
    string | null | undefined,
  fallback:
    string
): string {
  if (
    typeof value !==
      'string'
  ) {
    return fallback;
  }

  const trimmed =
    value.trim();

  return trimmed.length >
    0
    ? trimmed
    : fallback;
}

function normalizeOptionalString(
  value:
    unknown
): string | null {
  if (
    typeof value !==
      'string'
  ) {
    return null;
  }

  const trimmed =
    value.trim();

  return trimmed.length >
    0
    ? trimmed
    : null;
}

function normalizePermissionStatus(
  status:
    unknown
): ProcessingNotificationPermissionStatus {
  switch (
    status
  ) {
    case 'granted':
      return 'granted';

    case 'denied':
      return 'denied';

    case 'undetermined':
      return 'undetermined';

    case 'restricted':
      return 'restricted';

    default:
      return 'unknown';
  }
}

function createUnavailablePermission(
  message:
    string
): ProcessingNotificationPermissionResult {
  return {
    status:
      'unavailable',

    granted:
      false,

    canAskAgain:
      false,

    message,
  };
}

function normalizePermissionResult(
  response:
    Notifications.NotificationPermissionsStatus
): ProcessingNotificationPermissionResult {
  const iosAuthorizationStatus =
    Platform.OS ===
      'ios'
      ? response.ios?.status
      : undefined;

  const iosGranted =
    iosAuthorizationStatus ===
      Notifications
        .IosAuthorizationStatus
        .AUTHORIZED ||
    iosAuthorizationStatus ===
      Notifications
        .IosAuthorizationStatus
        .PROVISIONAL ||
    iosAuthorizationStatus ===
      Notifications
        .IosAuthorizationStatus
        .EPHEMERAL;

  const status:
    ProcessingNotificationPermissionStatus =
      Platform.OS ===
        'ios'
        ? iosGranted
          ? 'granted'
          : iosAuthorizationStatus ===
              Notifications
                .IosAuthorizationStatus
                .DENIED
            ? 'denied'
            : iosAuthorizationStatus ===
                Notifications
                  .IosAuthorizationStatus
                  .NOT_DETERMINED
              ? 'undetermined'
              : 'unknown'
        : normalizePermissionStatus(
            response.status
          );

  const granted =
    response.granted ===
      true ||
    iosGranted ||
    status ===
      'granted';

  const canAskAgain =
    response.canAskAgain !==
      false;

  let message:
    string;

  if (
    granted
  ) {
    message =
      'Notification permission has been granted.';
  } else if (
    status ===
      'denied'
  ) {
    message =
      canAskAgain
        ? 'Notification permission has been denied.'
        : 'Notification permission has been permanently denied.';
  } else if (
    status ===
      'restricted'
  ) {
    message =
      'Notification permission is restricted by the device.';
  } else if (
    status ===
      'undetermined'
  ) {
    message =
      'Notification permission has not been requested yet.';
  } else {
    message =
      'Notification permission status is unknown.';
  }

  return {
    status,
    granted,
    canAskAgain,
    message,
  };
}

function normalizeNotificationDataValue(
  value:
    string | number | boolean | null
):
  | string
  | number
  | boolean
  | null {
  if (
    value ===
      null
  ) {
    return null;
  }

  if (
    typeof value ===
      'string' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  ) {
    return value;
  }

  return String(
    value
  );
}

function createNotificationData(
  payload:
    ProcessingNotificationPayload
): Record<
  string,
  string | number | boolean | null
> {
  const data:
    Record<
      string,
      string | number | boolean | null
    > = {};

  for (
    const [
      key,
      value,
    ] of Object.entries(
      payload.data
    )
  ) {
    data[
      key
    ] =
      normalizeNotificationDataValue(
        value
      );
  }

  data[
    NOTIFICATION_DATA_ROUTE_KEY
  ] =
    payload.route;

  data[
    NOTIFICATION_DATA_QUEUE_ID_KEY
  ] =
    payload.queueId;

  data[
    NOTIFICATION_DATA_BATCH_ID_KEY
  ] =
    payload.batchId;

  data[
    NOTIFICATION_DATA_JOB_ID_KEY
  ] =
    payload.jobId;

  data.kind =
    payload.kind;

  if (
    payload.overallProgress !==
      null
  ) {
    data.overallProgress =
      payload.overallProgress;
  }

  if (
    payload.completedItems !==
      null
  ) {
    data.completedItems =
      payload.completedItems;
  }

  if (
    payload.totalItems !==
      null
  ) {
    data.totalItems =
      payload.totalItems;
  }

  return data;
}

function readNotificationData(
  value:
    unknown
): Record<
  string,
  unknown
> {
  if (
    typeof value !==
      'object' ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return {};
  }

  return value as
    Record<
      string,
      unknown
    >;
}

function convertResponseData(
  source:
    Record<
      string,
      unknown
    >
): Readonly<
  Record<
    string,
    string | number | boolean | null
  >
> {
  const output:
    Record<
      string,
      string | number | boolean | null
    > = {};

  for (
    const [
      key,
      value,
    ] of Object.entries(
      source
    )
  ) {
    if (
      value ===
        null ||
      typeof value ===
        'string' ||
      typeof value ===
        'boolean'
    ) {
      output[
        key
      ] =
        value;

      continue;
    }

    if (
      typeof value ===
        'number' &&
      Number.isFinite(
        value
      )
    ) {
      output[
        key
      ] =
        value;

      continue;
    }

    if (
      value !==
        undefined
    ) {
      try {
        output[
          key
        ] =
          JSON.stringify(
            value
          );
      } catch {
        output[
          key
        ] =
          String(
            value
          );
      }
    }
  }

  return output;
}

function createNotificationResponse(
  response:
    Notifications.NotificationResponse
): ProcessingNotificationResponse {
  const notification =
    response.notification;

  const content =
    notification.request
      .content;

  const data =
    readNotificationData(
      content.data
    );

  return {
    notificationId:
      normalizeOptionalString(
        notification.request
          .identifier
      ),

    route:
      normalizeOptionalString(
        data[
          NOTIFICATION_DATA_ROUTE_KEY
        ]
      ),

    queueId:
      normalizeOptionalString(
        data[
          NOTIFICATION_DATA_QUEUE_ID_KEY
        ]
      ),

    batchId:
      normalizeOptionalString(
        data[
          NOTIFICATION_DATA_BATCH_ID_KEY
        ]
      ),

    jobId:
      normalizeOptionalString(
        data[
          NOTIFICATION_DATA_JOB_ID_KEY
        ]
      ),

    data:
      convertResponseData(
        data
      ),
  };
}

/* =========================================================
 * Adapter
 * ======================================================= */

export class ExpoNotificationsAdapter
  implements ProcessingNotificationAdapter
{
  private readonly androidChannelId:
    string;

  private readonly androidChannelName:
    string;

  private readonly androidChannelDescription:
    string;

  private readonly androidNotificationColor:
    string;

  private readonly enableSound:
    boolean;

  private readonly enableBadge:
    boolean;

  private readonly showNotificationsInForeground:
    boolean;

  private readonly clearBadgeOnInitialize:
    boolean;

  private readonly clearDeliveredNotificationsOnInitialize:
    boolean;

  private readonly enableDebugLogs:
    boolean;

  private initialized =
    false;

  private disposed =
    false;

  private androidChannelCreated =
    false;

  private permission:
    ProcessingNotificationPermissionResult =
      {
        status:
          'unknown',

        granted:
          false,

        canAskAgain:
          true,

        message:
          'Notification permission has not been checked.',
      };

  private responseSubscription:
    Notifications.EventSubscription | null =
      null;

  private responseHandler:
    (
      response:
        ProcessingNotificationResponse
    ) => void =
      () => undefined;

  private initializePromise:
    Promise<
      ProcessingNotificationPermissionResult
    > | null =
      null;

  private diagnostics:
    ExpoNotificationsAdapterDiagnostics;

  constructor(
    options:
      ExpoNotificationsAdapterOptions =
        {}
  ) {
    this.androidChannelId =
      normalizeText(
        options.androidChannelId,
        DEFAULT_ANDROID_CHANNEL_ID
      );

    this.androidChannelName =
      normalizeText(
        options.androidChannelName,
        DEFAULT_ANDROID_CHANNEL_NAME
      );

    this.androidChannelDescription =
      normalizeText(
        options
          .androidChannelDescription,
        DEFAULT_ANDROID_CHANNEL_DESCRIPTION
      );

    this.androidNotificationColor =
      normalizeText(
        options
          .androidNotificationColor,
        DEFAULT_ANDROID_NOTIFICATION_COLOR
      );

    this.enableSound =
      options.enableSound ??
      true;

    this.enableBadge =
      options.enableBadge ??
      true;

    this.showNotificationsInForeground =
      options
        .showNotificationsInForeground ??
      true;

    this.clearBadgeOnInitialize =
      options
        .clearBadgeOnInitialize ??
      true;

    this.clearDeliveredNotificationsOnInitialize =
      options
        .clearDeliveredNotificationsOnInitialize ??
      false;

    this.enableDebugLogs =
      options.enableDebugLogs ??
      false;

    this.diagnostics = {
      initialized:
        false,

      disposed:
        false,

      platform:
        Platform.OS,

      permissionStatus:
        'unknown',

      permissionGranted:
        false,

      androidChannelCreated:
        false,

      initializeCount:
        0,

      permissionCheckCount:
        0,

      permissionRequestCount:
        0,

      sendAttemptCount:
        0,

      sendSuccessCount:
        0,

      sendFailureCount:
        0,

      cancelCount:
        0,

      cancelAllCount:
        0,

      responseCount:
        0,

      listenerAttached:
        false,

      lastNotificationId:
        null,

      lastNotificationKind:
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
      return Promise.resolve(
        this.getPermissionSnapshot()
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
      ProcessingNotificationPermissionResult
    > {
    try {
      this.configureForegroundHandler();

      if (
        Platform.OS ===
          'android'
      ) {
        await this
          .createAndroidChannel();
      }

      if (
        this.clearBadgeOnInitialize
      ) {
        try {
          await Notifications
            .setBadgeCountAsync(
              0
            );
        } catch (error) {
          this.logWarning(
            'Could not clear notification badge.',
            error
          );
        }
      }

      if (
        this
          .clearDeliveredNotificationsOnInitialize
      ) {
        try {
          await Notifications
            .dismissAllNotificationsAsync();
        } catch (error) {
          this.logWarning(
            'Could not clear delivered notifications.',
            error
          );
        }
      }

      this.attachResponseListener();

      this.permission =
        await this
          .getPermissionStatus();

      this.initialized =
        true;

      this.updateDiagnostics({
        initialized:
          true,

        initializeCount:
          this.diagnostics
            .initializeCount +
          1,

        permissionStatus:
          this.permission.status,

        permissionGranted:
          this.permission.granted,

        androidChannelCreated:
          this.androidChannelCreated,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return this.getPermissionSnapshot();
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.updateDiagnostics({
        initializeCount:
          this.diagnostics
            .initializeCount +
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
   * Foreground behavior
   * ===================================================== */

  private configureForegroundHandler():
    void {
    const show =
      this.showNotificationsInForeground;

    Notifications
      .setNotificationHandler({
        handleNotification:
          async () => ({
            shouldShowBanner:
              show,

            shouldShowList:
              show,

            shouldPlaySound:
              show &&
              this.enableSound,

            shouldSetBadge:
              this.enableBadge,
          }),
      });
  }

  /* =======================================================
   * Android channel
   * ===================================================== */

  private async createAndroidChannel():
    Promise<void> {
    if (
      Platform.OS !==
        'android'
    ) {
      return;
    }

    await Notifications
      .setNotificationChannelAsync(
        this.androidChannelId,
        {
          name:
            this.androidChannelName,

          description:
            this
              .androidChannelDescription,

          importance:
            Notifications
              .AndroidImportance
              .HIGH,

          vibrationPattern:
            [
              0,
              250,
              250,
              250,
            ],

          lightColor:
            this
              .androidNotificationColor,

          sound:
            this.enableSound
              ? DEFAULT_NOTIFICATION_SOUND
              : null,

          enableVibrate:
            true,

          enableLights:
            true,

          showBadge:
            this.enableBadge,

          lockscreenVisibility:
            Notifications
              .AndroidNotificationVisibility
              .PUBLIC,
        }
      );

    this.androidChannelCreated =
      true;

    this.updateDiagnostics({
      androidChannelCreated:
        true,

      lastOperationAt:
        now(),
    });
  }

  /* =======================================================
   * Permission
   * ===================================================== */

  public async getPermissionStatus():
    Promise<
      ProcessingNotificationPermissionResult
    > {
    this.assertNotDisposed();

    this.updateDiagnostics({
      permissionCheckCount:
        this.diagnostics
          .permissionCheckCount +
      1,

      lastOperationAt:
        now(),
    });

    if (
      Platform.OS !==
        'ios' &&
      Platform.OS !==
        'android'
    ) {
      this.permission =
        createUnavailablePermission(
          `Notifications are unavailable on ${Platform.OS}.`
        );

      this.updatePermissionDiagnostics();

      return this.getPermissionSnapshot();
    }

    try {
      const response =
        await Notifications
          .getPermissionsAsync();

      this.permission =
        normalizePermissionResult(
          response
        );

      this.updatePermissionDiagnostics();

      return this.getPermissionSnapshot();
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.permission = {
        status:
          'unknown',

        granted:
          false,

        canAskAgain:
          true,

        message,
      };

      this.updateDiagnostics({
        permissionStatus:
          this.permission.status,

        permissionGranted:
          false,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      return this.getPermissionSnapshot();
    }
  }

  public async requestPermission():
    Promise<
      ProcessingNotificationPermissionResult
    > {
    this.assertNotDisposed();

    this.updateDiagnostics({
      permissionRequestCount:
        this.diagnostics
          .permissionRequestCount +
      1,

      lastOperationAt:
        now(),
    });

    if (
      Platform.OS !==
        'ios' &&
      Platform.OS !==
        'android'
    ) {
      this.permission =
        createUnavailablePermission(
          `Notifications are unavailable on ${Platform.OS}.`
        );

      this.updatePermissionDiagnostics();

      return this.getPermissionSnapshot();
    }

    try {
      if (
        Platform.OS ===
          'android' &&
        !this.androidChannelCreated
      ) {
        await this
          .createAndroidChannel();
      }

      const response =
        await Notifications
          .requestPermissionsAsync({
            ios: {
              allowAlert:
                true,

              allowBadge:
                this.enableBadge,

              allowSound:
                this.enableSound,

              allowCriticalAlerts:
                false,

              provideAppNotificationSettings:
                false,
            },
          });

      this.permission =
        normalizePermissionResult(
          response
        );

      this.updatePermissionDiagnostics();

      return this.getPermissionSnapshot();
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.permission = {
        status:
          'unknown',

        granted:
          false,

        canAskAgain:
          true,

        message,
      };

      this.updateDiagnostics({
        permissionStatus:
          this.permission.status,

        permissionGranted:
          false,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      return this.getPermissionSnapshot();
    }
  }

  /* =======================================================
   * Send
   * ===================================================== */

  public async send(
    payload:
      ProcessingNotificationPayload
  ): Promise<
    ProcessingNotificationSendResult
  > {
    this.assertNotDisposed();

    this.updateDiagnostics({
      sendAttemptCount:
        this.diagnostics
          .sendAttemptCount +
      1,

      lastNotificationKind:
        payload.kind,

      lastOperationAt:
        now(),

      lastError:
        null,
    });

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    if (
      !this.permission
        .granted
    ) {
      this.permission =
        await this
          .getPermissionStatus();
    }

    if (
      !this.permission
        .granted
    ) {
      const message =
        'Notification permission has not been granted.';

      this.updateDiagnostics({
        sendFailureCount:
          this.diagnostics
            .sendFailureCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      return {
        sent:
          false,

        notificationId:
          null,

        errorMessage:
          message,
      };
    }

    try {
      if (
        Platform.OS ===
          'android' &&
        !this.androidChannelCreated
      ) {
        await this
          .createAndroidChannel();
      }

      const identifier =
        await Notifications
          .scheduleNotificationAsync({
            content: {
              title:
                normalizeText(
                  payload.title,
                  'Triple N'
                ),

              body:
                normalizeText(
                  payload.body,
                  'Your wardrobe has been updated.'
                ),

              data:
                createNotificationData(
                  payload
                ),

             sound:
  this.enableSound
    ? DEFAULT_NOTIFICATION_SOUND
    : false,

              badge:
                this.enableBadge
                  ? 1
                  : undefined,

              color:
                Platform.OS ===
                  'android'
                  ? this
                      .androidNotificationColor
                  : undefined,
            },

            trigger:
              Platform.OS ===
                'android'
                ? {
                    channelId:
                      this
                        .androidChannelId,
                  }
                : null,
          });

      this.updateDiagnostics({
        sendSuccessCount:
          this.diagnostics
            .sendSuccessCount +
        1,

        lastNotificationId:
          identifier,

        lastNotificationKind:
          payload.kind,

        lastOperationAt:
          now(),

        lastError:
          null,
      });

      return {
        sent:
          true,

        notificationId:
          identifier,

        errorMessage:
          null,
      };
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.updateDiagnostics({
        sendFailureCount:
          this.diagnostics
            .sendFailureCount +
        1,

        lastOperationAt:
          now(),

        lastError:
          message,
      });

      this.logWarning(
        'Could not send the processing notification.',
        error
      );

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
   * Notification response
   * ===================================================== */

  public setResponseHandler(
    handler:
      (
        response:
          ProcessingNotificationResponse
      ) => void
  ): () => void {
    this.assertNotDisposed();

    this.responseHandler =
      handler;

    this.attachResponseListener();

    return () => {
      if (
        this.responseHandler ===
          handler
      ) {
        this.responseHandler =
          () => undefined;
      }
    };
  }

  private attachResponseListener():
    void {
    if (
      this.responseSubscription
    ) {
      return;
    }

    this.responseSubscription =
      Notifications
        .addNotificationResponseReceivedListener(
          response => {
            const converted =
              createNotificationResponse(
                response
              );

            this.updateDiagnostics({
              responseCount:
                this.diagnostics
                  .responseCount +
              1,

              lastNotificationId:
                converted
                  .notificationId,

              lastOperationAt:
                now(),
            });

            try {
              this.responseHandler(
                converted
              );
            } catch (error) {
              this.logWarning(
                'Notification response handler failed.',
                error
              );
            }
          }
        );

    this.updateDiagnostics({
      listenerAttached:
        true,

      lastOperationAt:
        now(),
    });
  }

  /**
   * يقرأ آخر إشعار فتح التطبيق،
   * حتى لا نفقد الضغط لو التطبيق
   * كان مغلقًا وتم فتحه من الإشعار.
   */
  public async getLastNotificationResponse():
    Promise<
      ProcessingNotificationResponse | null
    > {
    this.assertNotDisposed();

    try {
      const response =
        await Notifications
          .getLastNotificationResponseAsync();

      return response
        ? createNotificationResponse(
            response
          )
        : null;
    } catch (error) {
      this.logWarning(
        'Could not read the last notification response.',
        error
      );

      return null;
    }
  }

  /* =======================================================
   * Cancel
   * ===================================================== */

  public async cancel(
    notificationId:
      string
  ): Promise<void> {
    this.assertNotDisposed();

    const normalizedId =
      normalizeOptionalString(
        notificationId
      );

    if (
      !normalizedId
    ) {
      return;
    }

    try {
      /**
       * نحاول إلغاء Scheduled Notification،
       * ثم نحاول حذف النسخة الظاهرة.
       *
       * إحدى العمليتين قد لا تجد الإشعار،
       * وهذا طبيعي بعد ظهوره بالفعل.
       */
      try {
        await Notifications
          .cancelScheduledNotificationAsync(
            normalizedId
          );
      } catch {
        // قد يكون الإشعار قد ظهر بالفعل.
      }

      try {
        await Notifications
          .dismissNotificationAsync(
            normalizedId
          );
      } catch {
        // قد لا يكون الإشعار ظاهرًا حاليًا.
      }

      this.updateDiagnostics({
        cancelCount:
          this.diagnostics
            .cancelCount +
        1,

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
        lastOperationAt:
          now(),

        lastError:
          message,
      });

      throw error;
    }
  }

  public async cancelAll():
    Promise<void> {
    this.assertNotDisposed();

    try {
      await Promise.all([
        Notifications
          .cancelAllScheduledNotificationsAsync(),

        Notifications
          .dismissAllNotificationsAsync(),
      ]);

      if (
        this.enableBadge
      ) {
        try {
          await Notifications
            .setBadgeCountAsync(
              0
            );
        } catch {
          // لا نوقف الإلغاء بسبب Badge.
        }
      }

      this.updateDiagnostics({
        cancelAllCount:
          this.diagnostics
            .cancelAllCount +
        1,

        lastNotificationId:
          null,

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
        lastOperationAt:
          now(),

        lastError:
          message,
      });

      throw error;
    }
  }

  /* =======================================================
   * Badge
   * ===================================================== */

  public async setBadgeCount(
    count:
      number
  ): Promise<boolean> {
    this.assertNotDisposed();

    const safeCount =
      Number.isFinite(
        count
      )
        ? Math.max(
            0,
            Math.floor(
              count
            )
          )
        : 0;

    try {
      return await Notifications
        .setBadgeCountAsync(
          safeCount
        );
    } catch (error) {
      this.logWarning(
        'Could not update the app badge.',
        error
      );

      return false;
    }
  }

  public async clearBadge():
    Promise<boolean> {
    return this.setBadgeCount(
      0
    );
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    ExpoNotificationsAdapterDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  private updatePermissionDiagnostics():
    void {
    this.updateDiagnostics({
      permissionStatus:
        this.permission.status,

      permissionGranted:
        this.permission.granted,

      lastOperationAt:
        now(),

      lastError:
        null,
    });
  }

  private updateDiagnostics(
    updates:
      Partial<
        ExpoNotificationsAdapterDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...updates,
    };
  }

  private getPermissionSnapshot():
    ProcessingNotificationPermissionResult {
    return {
      ...this.permission,
    };
  }

  private logWarning(
    message:
      string,
    error:
      unknown
  ): void {
    if (
      !this.enableDebugLogs
    ) {
      return;
    }

    console.warn(
      `TRIPLE N EXPO NOTIFICATIONS: ${message}`,
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

    this.responseSubscription
      ?.remove();

    this.responseSubscription =
      null;

    this.responseHandler =
      () => undefined;

    this.initializePromise =
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

      listenerAttached:
        false,

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
        'Expo notifications adapter has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createExpoNotificationsAdapter(
  options:
    ExpoNotificationsAdapterOptions =
      {}
): ExpoNotificationsAdapter {
  return new ExpoNotificationsAdapter(
    options
  );
}

export default
  ExpoNotificationsAdapter;