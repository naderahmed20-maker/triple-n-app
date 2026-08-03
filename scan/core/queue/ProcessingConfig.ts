// scan/core/queue/ProcessingConfig.ts
//
// Triple N - Scan Item Processing Queue Configuration
//
// هذا الملف هو المرجع النهائي لإعدادات
// Queue معالجة صور Scan Item.
//
// مسؤولياته:
//
// 1) تعريف الإعدادات الافتراضية للـQueue.
// 2) ضبط عدد الصور المسموح بها.
// 3) ضبط عدد المحاولات وإعادة المحاولة.
// 4) ضبط متوسط وقت معالجة الصورة.
// 5) ضبط الإشعارات.
// 6) ضبط تشغيل الخلفية على iOS وAndroid.
// 7) التحقق من صحة الإعدادات.
// 8) دمج الإعدادات المخصصة بأمان.
// 9) إنشاء نسخة مستقلة من الإعدادات.
// 10) توفير إعدادات Production وDevelopment.
//
// هذا الملف لا يشغّل Queue.
// لا يحفظ داخل AsyncStorage.
// لا يشغّل EdgeSAM.
// لا يرسل إشعارات.

import type {
    ProcessingDurationMs,
    ProcessingQueueConfig,
    ProcessingRetryPolicy,
} from './QueueTypes';

import {
    DEFAULT_ESTIMATED_ITEM_PROCESSING_MS,
    DEFAULT_MAXIMUM_QUEUE_ITEMS,
    DEFAULT_PROCESSING_QUEUE_CONFIG,
    DEFAULT_PROCESSING_RETRY_POLICY,
    DEFAULT_QUEUE_MAXIMUM_ATTEMPTS,
    DEFAULT_QUEUE_RETRY_DELAY_MS,
    normalizeProcessingDuration,
} from './QueueTypes';

/* =========================================================
 * General constants
 * ======================================================= */

export const PROCESSING_QUEUE_DEFAULT_ID =
  'triple-n-scan-item-queue';

export const PROCESSING_QUEUE_MINIMUM_ITEMS =
  1;

export const PROCESSING_QUEUE_MAXIMUM_ITEMS =
  100;

export const PROCESSING_QUEUE_MINIMUM_ATTEMPTS =
  1;

export const PROCESSING_QUEUE_MAXIMUM_ATTEMPTS =
  10;

export const PROCESSING_QUEUE_MINIMUM_RETRY_DELAY_MS =
  250;

export const PROCESSING_QUEUE_MAXIMUM_RETRY_DELAY_MS =
  300_000;

export const PROCESSING_QUEUE_MINIMUM_ESTIMATED_ITEM_MS =
  1_000;

export const PROCESSING_QUEUE_MAXIMUM_ESTIMATED_ITEM_MS =
  3_600_000;

export const PROCESSING_QUEUE_DEFAULT_MAXIMUM_RETRY_DELAY_MS =
  30_000;

export const PROCESSING_QUEUE_DEFAULT_BACKOFF_MULTIPLIER =
  2;

export const PROCESSING_QUEUE_MINIMUM_BACKOFF_MULTIPLIER =
  1;

export const PROCESSING_QUEUE_MAXIMUM_BACKOFF_MULTIPLIER =
  10;

/* =========================================================
 * Background configuration
 * ======================================================= */

export type ProcessingIosBackgroundConfig = {
  enabled:
    boolean;

  minimumSupportedMajorVersion:
    number;

  useContinuedProcessingTask:
    boolean;

  fallbackToBackgroundTimeExtension:
    boolean;

  persistAfterEveryCompletedJob:
    boolean;

  stopWhenApplicationIsForceClosed:
    boolean;

  requestNotificationPermission:
    boolean;

  backgroundTaskIdentifier:
    string;
};

export type ProcessingAndroidBackgroundConfig = {
  enabled:
    boolean;

  useWorkManager:
    boolean;

  useForegroundService:
    boolean;

  useMediaProcessingServiceType:
    boolean;

  persistAfterEveryCompletedJob:
    boolean;

  stopOnForceStop:
    boolean;

  requestNotificationPermission:
    boolean;

  workName:
    string;

  notificationChannelId:
    string;

  notificationChannelName:
    string;

  foregroundNotificationId:
    number;

  completionNotificationId:
    number;
};

export type ProcessingBackgroundConfig = {
  ios:
    ProcessingIosBackgroundConfig;

  android:
    ProcessingAndroidBackgroundConfig;
};

/* =========================================================
 * Notification configuration
 * ======================================================= */

export type ProcessingNotificationConfig = {
  enabled:
    boolean;

  notifyWhenProcessingStarts:
    boolean;

  notifyDuringProgress:
    boolean;

  notifyWhenSingleItemCompletes:
    boolean;

  notifyWhenBatchCompletes:
    boolean;

  notifyWhenBatchCompletesWithErrors:
    boolean;

  notifyWhenProcessingFails:
    boolean;

  progressNotificationMinimumIntervalMs:
    number;

  completionRoute:
    string;

  singleItemRoute:
    string;

  processingStartedTitle:
    string;

  processingStartedBody:
    string;

  batchProcessingStartedTitle:
    string;

  batchProcessingStartedBody:
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

  failedTitle:
    string;

  failedBody:
    string;
};

/* =========================================================
 * Time estimation configuration
 * ======================================================= */

export type ProcessingTimeEstimatorConfig = {
  initialEstimatedItemMs:
    ProcessingDurationMs;

  minimumSampleCount:
    number;

  maximumSampleCount:
    number;

  smoothingFactor:
    number;

  minimumEstimatedItemMs:
    ProcessingDurationMs;

  maximumEstimatedItemMs:
    ProcessingDurationMs;

  includeCurrentJobProgress:
    boolean;

  roundDisplayedMinutes:
    boolean;
};

/* =========================================================
 * Complete application configuration
 * ======================================================= */

export type ScanItemProcessingConfig = {
  queue:
    ProcessingQueueConfig;

  background:
    ProcessingBackgroundConfig;

  notifications:
    ProcessingNotificationConfig;

  timeEstimator:
    ProcessingTimeEstimatorConfig;

  enableDebugLogs:
    boolean;

  enableDiagnostics:
    boolean;

  enableRecovery:
    boolean;

  enableAutomaticResume:
    boolean;

  enableAutomaticRetry:
    boolean;

  enableWardrobePlaceholders:
    boolean;

  enablePerItemProgress:
    boolean;

  enableOverallProgress:
    boolean;

  enableEstimatedTime:
    boolean;
};

/* =========================================================
 * Partial configuration
 * ======================================================= */

export type PartialProcessingRetryPolicy =
  Partial<
    Omit<
      ProcessingRetryPolicy,
      'retryableErrorCodes'
    >
  > & {
    retryableErrorCodes?:
      readonly ProcessingRetryPolicy[
        'retryableErrorCodes'
      ][number][];
  };

export type PartialProcessingQueueConfig =
  Partial<
    Omit<
      ProcessingQueueConfig,
      'retryPolicy'
    >
  > & {
    retryPolicy?:
      PartialProcessingRetryPolicy;
  };

export type PartialScanItemProcessingConfig = {
  queue?:
    PartialProcessingQueueConfig;

  background?: {
    ios?:
      Partial<
        ProcessingIosBackgroundConfig
      >;

    android?:
      Partial<
        ProcessingAndroidBackgroundConfig
      >;
  };

  notifications?:
    Partial<
      ProcessingNotificationConfig
    >;

  timeEstimator?:
    Partial<
      ProcessingTimeEstimatorConfig
    >;

  enableDebugLogs?:
    boolean;

  enableDiagnostics?:
    boolean;

  enableRecovery?:
    boolean;

  enableAutomaticResume?:
    boolean;

  enableAutomaticRetry?:
    boolean;

  enableWardrobePlaceholders?:
    boolean;

  enablePerItemProgress?:
    boolean;

  enableOverallProgress?:
    boolean;

  enableEstimatedTime?:
    boolean;
};

/* =========================================================
 * Validation
 * ======================================================= */

export type ProcessingConfigIssueSeverity =
  | 'warning'
  | 'error';

export type ProcessingConfigIssueCode =
  | 'invalid-queue-id'
  | 'invalid-maximum-items'
  | 'invalid-concurrency'
  | 'invalid-estimated-processing-time'
  | 'invalid-retry-attempts'
  | 'invalid-retry-delay'
  | 'invalid-maximum-retry-delay'
  | 'invalid-backoff-multiplier'
  | 'invalid-ios-task-identifier'
  | 'invalid-android-work-name'
  | 'invalid-notification-channel-id'
  | 'invalid-notification-id'
  | 'invalid-notification-interval'
  | 'invalid-time-estimator-sample-count'
  | 'invalid-time-estimator-smoothing-factor';

export type ProcessingConfigIssue = {
  code:
    ProcessingConfigIssueCode;

  severity:
    ProcessingConfigIssueSeverity;

  message:
    string;

  path:
    string;
};

export type ProcessingConfigValidationResult = {
  valid:
    boolean;

  issues:
    readonly ProcessingConfigIssue[];

  errors:
    readonly ProcessingConfigIssue[];

  warnings:
    readonly ProcessingConfigIssue[];
};

/* =========================================================
 * Default background configuration
 * ======================================================= */

export const DEFAULT_IOS_BACKGROUND_CONFIG:
  ProcessingIosBackgroundConfig = {
    enabled:
      true,

    minimumSupportedMajorVersion:
      26,

    useContinuedProcessingTask:
      true,

    fallbackToBackgroundTimeExtension:
      true,

    persistAfterEveryCompletedJob:
      true,

    stopWhenApplicationIsForceClosed:
      true,

    requestNotificationPermission:
      true,

    backgroundTaskIdentifier:
      'com.naderahmed22.triplen.scan-processing',
  };

export const DEFAULT_ANDROID_BACKGROUND_CONFIG:
  ProcessingAndroidBackgroundConfig = {
    enabled:
      true,

    useWorkManager:
      true,

    useForegroundService:
      true,

    useMediaProcessingServiceType:
      true,

    persistAfterEveryCompletedJob:
      true,

    stopOnForceStop:
      true,

    requestNotificationPermission:
      true,

    workName:
      'triple-n-scan-item-processing',

    notificationChannelId:
      'triple_n_scan_processing',

    notificationChannelName:
      'Wardrobe Processing',

    foregroundNotificationId:
      4101,

    completionNotificationId:
      4102,
  };

export const DEFAULT_PROCESSING_BACKGROUND_CONFIG:
  ProcessingBackgroundConfig = {
    ios:
      DEFAULT_IOS_BACKGROUND_CONFIG,

    android:
      DEFAULT_ANDROID_BACKGROUND_CONFIG,
  };

/* =========================================================
 * Default notification configuration
 * ======================================================= */

export const DEFAULT_PROCESSING_NOTIFICATION_CONFIG:
  ProcessingNotificationConfig = {
    enabled:
      true,

    notifyWhenProcessingStarts:
      true,

    notifyDuringProgress:
      true,

    notifyWhenSingleItemCompletes:
      false,

    notifyWhenBatchCompletes:
      true,

    notifyWhenBatchCompletesWithErrors:
      true,

    notifyWhenProcessingFails:
      true,

    progressNotificationMinimumIntervalMs:
      5_000,

    completionRoute:
      '/app/outfit',

    singleItemRoute:
      '/app/wardrobe',

    processingStartedTitle:
      'Your item is being processed',

    processingStartedBody:
      "Feel free to keep using your phone. We'll notify you as soon as your item is ready.",

    batchProcessingStartedTitle:
      'Your wardrobe is being prepared ✨',

    batchProcessingStartedBody:
      "Processing may take some time, so there's no need to wait here. Feel free to enjoy your phone, and we'll notify you as soon as your wardrobe is ready. Thank you for your patience!",

    singleItemCompletedTitle:
      'Your item is ready! 🎉',

    singleItemCompletedBody:
      'Your item has been processed successfully and is now available in your wardrobe.',

    batchCompletedTitle:
      'Your Triple N wardrobe is ready! 🎉',

    batchCompletedBody:
      'All your items have been processed successfully. Your wardrobe is ready—tap to create your first outfit!',

    batchCompletedWithErrorsTitle:
      'Your wardrobe is ready',

    batchCompletedWithErrorsBody:
      'Most of your items are ready. Open Triple N to review any items that need attention.',

    failedTitle:
      'An item needs your attention',

    failedBody:
      'We could not finish processing one of your items. Open Triple N to try again.',
  };

/* =========================================================
 * Default time estimator configuration
 * ======================================================= */

export const DEFAULT_PROCESSING_TIME_ESTIMATOR_CONFIG:
  ProcessingTimeEstimatorConfig = {
    initialEstimatedItemMs:
      DEFAULT_ESTIMATED_ITEM_PROCESSING_MS,

    minimumSampleCount:
      1,

    maximumSampleCount:
      20,

    smoothingFactor:
      0.35,

    minimumEstimatedItemMs:
      10_000,

    maximumEstimatedItemMs:
      600_000,

    includeCurrentJobProgress:
      true,

    roundDisplayedMinutes:
      true,
  };

/* =========================================================
 * Final default configuration
 * ======================================================= */

export const DEFAULT_SCAN_ITEM_PROCESSING_CONFIG:
  ScanItemProcessingConfig = {
    queue: {
      ...DEFAULT_PROCESSING_QUEUE_CONFIG,

      queueId:
        PROCESSING_QUEUE_DEFAULT_ID,

      maximumItems:
        DEFAULT_MAXIMUM_QUEUE_ITEMS,

      concurrency:
        1,

      estimatedItemProcessingMs:
        DEFAULT_ESTIMATED_ITEM_PROCESSING_MS,

      retryPolicy: {
        ...DEFAULT_PROCESSING_RETRY_POLICY,

        retryableErrorCodes:
          [
            ...DEFAULT_PROCESSING_RETRY_POLICY
              .retryableErrorCodes,
          ],
      },
    },

    background: {
      ios: {
        ...DEFAULT_IOS_BACKGROUND_CONFIG,
      },

      android: {
        ...DEFAULT_ANDROID_BACKGROUND_CONFIG,
      },
    },

    notifications: {
      ...DEFAULT_PROCESSING_NOTIFICATION_CONFIG,
    },

    timeEstimator: {
      ...DEFAULT_PROCESSING_TIME_ESTIMATOR_CONFIG,
    },

    enableDebugLogs:
      false,

    enableDiagnostics:
      true,

    enableRecovery:
      true,

    enableAutomaticResume:
      true,

    enableAutomaticRetry:
      true,

    enableWardrobePlaceholders:
      true,

    enablePerItemProgress:
      true,

    enableOverallProgress:
      true,

    enableEstimatedTime:
      true,
  };

/* =========================================================
 * Development configuration
 * ======================================================= */

export const DEVELOPMENT_SCAN_ITEM_PROCESSING_CONFIG:
  ScanItemProcessingConfig = {
    ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG,

    queue: {
      ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG.queue,

      retryPolicy: {
        ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
          .queue
          .retryPolicy,

        retryableErrorCodes:
          [
            ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
              .queue
              .retryPolicy
              .retryableErrorCodes,
          ],
      },
    },

    background: {
      ios: {
        ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
          .background
          .ios,
      },

      android: {
        ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
          .background
          .android,
      },
    },

    notifications: {
      ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
        .notifications,
    },

    timeEstimator: {
      ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
        .timeEstimator,
    },

    enableDebugLogs:
      true,

    enableDiagnostics:
      true,
  };

/* =========================================================
 * Production configuration
 * ======================================================= */

export const PRODUCTION_SCAN_ITEM_PROCESSING_CONFIG:
  ScanItemProcessingConfig = {
    ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG,

    queue: {
      ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG.queue,

      retryPolicy: {
        ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
          .queue
          .retryPolicy,

        retryableErrorCodes:
          [
            ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
              .queue
              .retryPolicy
              .retryableErrorCodes,
          ],
      },
    },

    background: {
      ios: {
        ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
          .background
          .ios,
      },

      android: {
        ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
          .background
          .android,
      },
    },

    notifications: {
      ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
        .notifications,
    },

    timeEstimator: {
      ...DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
        .timeEstimator,
    },

    enableDebugLogs:
      false,

    enableDiagnostics:
      true,
  };

/* =========================================================
 * Numeric helpers
 * ======================================================= */

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

function clampNumber(
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
      value
    )
  );
}

function normalizeRequiredString(
  value:
    string | null | undefined,
  fallback:
    string
): string {
  const normalized =
    value?.trim();

  return normalized
    ? normalized
    : fallback;
}

function normalizeNotificationId(
  value:
    number,
  fallback:
    number
): number {
  return clampInteger(
    value,
    1,
    2_147_483_647,
    fallback
  );
}

/* =========================================================
 * Clone helpers
 * ======================================================= */

export function cloneProcessingRetryPolicy(
  policy:
    ProcessingRetryPolicy
): ProcessingRetryPolicy {
  return {
    ...policy,

    retryableErrorCodes:
      [
        ...policy
          .retryableErrorCodes,
      ],
  };
}

export function cloneProcessingQueueConfig(
  config:
    ProcessingQueueConfig
): ProcessingQueueConfig {
  return {
    ...config,

    retryPolicy:
      cloneProcessingRetryPolicy(
        config.retryPolicy
      ),
  };
}

export function cloneScanItemProcessingConfig(
  config:
    ScanItemProcessingConfig
): ScanItemProcessingConfig {
  return {
    ...config,

    queue:
      cloneProcessingQueueConfig(
        config.queue
      ),

    background: {
      ios: {
        ...config.background.ios,
      },

      android: {
        ...config.background.android,
      },
    },

    notifications: {
      ...config.notifications,
    },

    timeEstimator: {
      ...config.timeEstimator,
    },
  };
}

/* =========================================================
 * Normalization helpers
 * ======================================================= */

export function normalizeProcessingRetryPolicy(
  policy:
    PartialProcessingRetryPolicy | undefined,
  fallback:
    ProcessingRetryPolicy =
      DEFAULT_PROCESSING_RETRY_POLICY
): ProcessingRetryPolicy {
  const maximumAttempts =
    clampInteger(
      policy?.maximumAttempts ??
        fallback.maximumAttempts,
      PROCESSING_QUEUE_MINIMUM_ATTEMPTS,
      PROCESSING_QUEUE_MAXIMUM_ATTEMPTS,
      DEFAULT_QUEUE_MAXIMUM_ATTEMPTS
    );

  const baseDelayMs =
    clampInteger(
      policy?.baseDelayMs ??
        fallback.baseDelayMs,
      PROCESSING_QUEUE_MINIMUM_RETRY_DELAY_MS,
      PROCESSING_QUEUE_MAXIMUM_RETRY_DELAY_MS,
      DEFAULT_QUEUE_RETRY_DELAY_MS
    );

  const maximumDelayMs =
    clampInteger(
      policy?.maximumDelayMs ??
        fallback.maximumDelayMs,
      baseDelayMs,
      PROCESSING_QUEUE_MAXIMUM_RETRY_DELAY_MS,
      PROCESSING_QUEUE_DEFAULT_MAXIMUM_RETRY_DELAY_MS
    );

  const backoffMultiplier =
    clampNumber(
      policy?.backoffMultiplier ??
        fallback.backoffMultiplier,
      PROCESSING_QUEUE_MINIMUM_BACKOFF_MULTIPLIER,
      PROCESSING_QUEUE_MAXIMUM_BACKOFF_MULTIPLIER,
      PROCESSING_QUEUE_DEFAULT_BACKOFF_MULTIPLIER
    );

  return {
    maximumAttempts,

    baseDelayMs,

    maximumDelayMs,

    backoffMultiplier,

    retryOnApplicationResume:
      policy
        ?.retryOnApplicationResume ??
      fallback
        .retryOnApplicationResume,

    retryOnBackgroundRestart:
      policy
        ?.retryOnBackgroundRestart ??
      fallback
        .retryOnBackgroundRestart,

    retryableErrorCodes:
      policy
        ?.retryableErrorCodes
        ? [
            ...policy
              .retryableErrorCodes,
          ]
        : [
            ...fallback
              .retryableErrorCodes,
          ],
  };
}

export function normalizeProcessingQueueConfig(
  config:
    PartialProcessingQueueConfig | undefined,
  fallback:
    ProcessingQueueConfig =
      DEFAULT_PROCESSING_QUEUE_CONFIG
): ProcessingQueueConfig {
  return {
    queueId:
      normalizeRequiredString(
        config?.queueId,
        fallback.queueId
      ),

    maximumItems:
      clampInteger(
        config?.maximumItems ??
          fallback.maximumItems,
        PROCESSING_QUEUE_MINIMUM_ITEMS,
        PROCESSING_QUEUE_MAXIMUM_ITEMS,
        DEFAULT_MAXIMUM_QUEUE_ITEMS
      ),

    concurrency:
      1,

    automaticStart:
      config
        ?.automaticStart ??
      fallback
        .automaticStart,

    continueAfterJobFailure:
      config
        ?.continueAfterJobFailure ??
      fallback
        .continueAfterJobFailure,

    pauseWhenApplicationTerminates:
      config
        ?.pauseWhenApplicationTerminates ??
      fallback
        .pauseWhenApplicationTerminates,

    resumeInterruptedJobs:
      config
        ?.resumeInterruptedJobs ??
      fallback
        .resumeInterruptedJobs,

    persistAfterEveryChange:
      config
        ?.persistAfterEveryChange ??
      fallback
        .persistAfterEveryChange,

    estimatedItemProcessingMs:
      clampInteger(
        config
          ?.estimatedItemProcessingMs ??
          fallback
            .estimatedItemProcessingMs,
        PROCESSING_QUEUE_MINIMUM_ESTIMATED_ITEM_MS,
        PROCESSING_QUEUE_MAXIMUM_ESTIMATED_ITEM_MS,
        DEFAULT_ESTIMATED_ITEM_PROCESSING_MS
      ),

    retryPolicy:
      normalizeProcessingRetryPolicy(
        config?.retryPolicy,
        fallback.retryPolicy
      ),

    enableNotifications:
      config
        ?.enableNotifications ??
      fallback
        .enableNotifications,

    notifyWhenSingleItemCompletes:
      config
        ?.notifyWhenSingleItemCompletes ??
      fallback
        .notifyWhenSingleItemCompletes,

    notifyWhenBatchCompletes:
      config
        ?.notifyWhenBatchCompletes ??
      fallback
        .notifyWhenBatchCompletes,
  };
}

export function normalizeIosBackgroundConfig(
  config:
    Partial<
      ProcessingIosBackgroundConfig
    > | undefined,
  fallback:
    ProcessingIosBackgroundConfig =
      DEFAULT_IOS_BACKGROUND_CONFIG
): ProcessingIosBackgroundConfig {
  return {
    enabled:
      config?.enabled ??
      fallback.enabled,

    minimumSupportedMajorVersion:
      clampInteger(
        config
          ?.minimumSupportedMajorVersion ??
          fallback
            .minimumSupportedMajorVersion,
        1,
        100,
        26
      ),

    useContinuedProcessingTask:
      config
        ?.useContinuedProcessingTask ??
      fallback
        .useContinuedProcessingTask,

    fallbackToBackgroundTimeExtension:
      config
        ?.fallbackToBackgroundTimeExtension ??
      fallback
        .fallbackToBackgroundTimeExtension,

    persistAfterEveryCompletedJob:
      config
        ?.persistAfterEveryCompletedJob ??
      fallback
        .persistAfterEveryCompletedJob,

    stopWhenApplicationIsForceClosed:
      config
        ?.stopWhenApplicationIsForceClosed ??
      fallback
        .stopWhenApplicationIsForceClosed,

    requestNotificationPermission:
      config
        ?.requestNotificationPermission ??
      fallback
        .requestNotificationPermission,

    backgroundTaskIdentifier:
      normalizeRequiredString(
        config
          ?.backgroundTaskIdentifier,
        fallback
          .backgroundTaskIdentifier
      ),
  };
}

export function normalizeAndroidBackgroundConfig(
  config:
    Partial<
      ProcessingAndroidBackgroundConfig
    > | undefined,
  fallback:
    ProcessingAndroidBackgroundConfig =
      DEFAULT_ANDROID_BACKGROUND_CONFIG
): ProcessingAndroidBackgroundConfig {
  return {
    enabled:
      config?.enabled ??
      fallback.enabled,

    useWorkManager:
      config
        ?.useWorkManager ??
      fallback
        .useWorkManager,

    useForegroundService:
      config
        ?.useForegroundService ??
      fallback
        .useForegroundService,

    useMediaProcessingServiceType:
      config
        ?.useMediaProcessingServiceType ??
      fallback
        .useMediaProcessingServiceType,

    persistAfterEveryCompletedJob:
      config
        ?.persistAfterEveryCompletedJob ??
      fallback
        .persistAfterEveryCompletedJob,

    stopOnForceStop:
      config
        ?.stopOnForceStop ??
      fallback
        .stopOnForceStop,

    requestNotificationPermission:
      config
        ?.requestNotificationPermission ??
      fallback
        .requestNotificationPermission,

    workName:
      normalizeRequiredString(
        config?.workName,
        fallback.workName
      ),

    notificationChannelId:
      normalizeRequiredString(
        config
          ?.notificationChannelId,
        fallback
          .notificationChannelId
      ),

    notificationChannelName:
      normalizeRequiredString(
        config
          ?.notificationChannelName,
        fallback
          .notificationChannelName
      ),

    foregroundNotificationId:
      normalizeNotificationId(
        config
          ?.foregroundNotificationId ??
          fallback
            .foregroundNotificationId,
        fallback
          .foregroundNotificationId
      ),

    completionNotificationId:
      normalizeNotificationId(
        config
          ?.completionNotificationId ??
          fallback
            .completionNotificationId,
        fallback
          .completionNotificationId
      ),
  };
}

export function normalizeProcessingNotificationConfig(
  config:
    Partial<
      ProcessingNotificationConfig
    > | undefined,
  fallback:
    ProcessingNotificationConfig =
      DEFAULT_PROCESSING_NOTIFICATION_CONFIG
): ProcessingNotificationConfig {
  return {
    enabled:
      config?.enabled ??
      fallback.enabled,

    notifyWhenProcessingStarts:
      config
        ?.notifyWhenProcessingStarts ??
      fallback
        .notifyWhenProcessingStarts,

    notifyDuringProgress:
      config
        ?.notifyDuringProgress ??
      fallback
        .notifyDuringProgress,

    notifyWhenSingleItemCompletes:
      config
        ?.notifyWhenSingleItemCompletes ??
      fallback
        .notifyWhenSingleItemCompletes,

    notifyWhenBatchCompletes:
      config
        ?.notifyWhenBatchCompletes ??
      fallback
        .notifyWhenBatchCompletes,

    notifyWhenBatchCompletesWithErrors:
      config
        ?.notifyWhenBatchCompletesWithErrors ??
      fallback
        .notifyWhenBatchCompletesWithErrors,

    notifyWhenProcessingFails:
      config
        ?.notifyWhenProcessingFails ??
      fallback
        .notifyWhenProcessingFails,

    progressNotificationMinimumIntervalMs:
      clampInteger(
        config
          ?.progressNotificationMinimumIntervalMs ??
          fallback
            .progressNotificationMinimumIntervalMs,
        1_000,
        300_000,
        5_000
      ),

    completionRoute:
      normalizeRequiredString(
        config
          ?.completionRoute,
        fallback
          .completionRoute
      ),

    singleItemRoute:
      normalizeRequiredString(
        config
          ?.singleItemRoute,
        fallback
          .singleItemRoute
      ),

    processingStartedTitle:
      normalizeRequiredString(
        config
          ?.processingStartedTitle,
        fallback
          .processingStartedTitle
      ),

    processingStartedBody:
      normalizeRequiredString(
        config
          ?.processingStartedBody,
        fallback
          .processingStartedBody
      ),

    batchProcessingStartedTitle:
      normalizeRequiredString(
        config
          ?.batchProcessingStartedTitle,
        fallback
          .batchProcessingStartedTitle
      ),

    batchProcessingStartedBody:
      normalizeRequiredString(
        config
          ?.batchProcessingStartedBody,
        fallback
          .batchProcessingStartedBody
      ),

    singleItemCompletedTitle:
      normalizeRequiredString(
        config
          ?.singleItemCompletedTitle,
        fallback
          .singleItemCompletedTitle
      ),

    singleItemCompletedBody:
      normalizeRequiredString(
        config
          ?.singleItemCompletedBody,
        fallback
          .singleItemCompletedBody
      ),

    batchCompletedTitle:
      normalizeRequiredString(
        config
          ?.batchCompletedTitle,
        fallback
          .batchCompletedTitle
      ),

    batchCompletedBody:
      normalizeRequiredString(
        config
          ?.batchCompletedBody,
        fallback
          .batchCompletedBody
      ),

    batchCompletedWithErrorsTitle:
      normalizeRequiredString(
        config
          ?.batchCompletedWithErrorsTitle,
        fallback
          .batchCompletedWithErrorsTitle
      ),

    batchCompletedWithErrorsBody:
      normalizeRequiredString(
        config
          ?.batchCompletedWithErrorsBody,
        fallback
          .batchCompletedWithErrorsBody
      ),

    failedTitle:
      normalizeRequiredString(
        config?.failedTitle,
        fallback.failedTitle
      ),

    failedBody:
      normalizeRequiredString(
        config?.failedBody,
        fallback.failedBody
      ),
  };
}

export function normalizeProcessingTimeEstimatorConfig(
  config:
    Partial<
      ProcessingTimeEstimatorConfig
    > | undefined,
  fallback:
    ProcessingTimeEstimatorConfig =
      DEFAULT_PROCESSING_TIME_ESTIMATOR_CONFIG
): ProcessingTimeEstimatorConfig {
  const minimumEstimatedItemMs =
    clampInteger(
      config
        ?.minimumEstimatedItemMs ??
        fallback
          .minimumEstimatedItemMs,
      1_000,
      PROCESSING_QUEUE_MAXIMUM_ESTIMATED_ITEM_MS,
      fallback
        .minimumEstimatedItemMs
    );

  const maximumEstimatedItemMs =
    clampInteger(
      config
        ?.maximumEstimatedItemMs ??
        fallback
          .maximumEstimatedItemMs,
      minimumEstimatedItemMs,
      PROCESSING_QUEUE_MAXIMUM_ESTIMATED_ITEM_MS,
      fallback
        .maximumEstimatedItemMs
    );

  const minimumSampleCount =
    clampInteger(
      config
        ?.minimumSampleCount ??
        fallback
          .minimumSampleCount,
      1,
      100,
      fallback.minimumSampleCount
    );

  const maximumSampleCount =
    clampInteger(
      config
        ?.maximumSampleCount ??
        fallback
          .maximumSampleCount,
      minimumSampleCount,
      1_000,
      fallback.maximumSampleCount
    );

  return {
    initialEstimatedItemMs:
      clampInteger(
        config
          ?.initialEstimatedItemMs ??
          fallback
            .initialEstimatedItemMs,
        minimumEstimatedItemMs,
        maximumEstimatedItemMs,
        DEFAULT_ESTIMATED_ITEM_PROCESSING_MS
      ),

    minimumSampleCount,

    maximumSampleCount,

    smoothingFactor:
      clampNumber(
        config
          ?.smoothingFactor ??
          fallback
            .smoothingFactor,
        0.01,
        1,
        fallback.smoothingFactor
      ),

    minimumEstimatedItemMs,

    maximumEstimatedItemMs,

    includeCurrentJobProgress:
      config
        ?.includeCurrentJobProgress ??
      fallback
        .includeCurrentJobProgress,

    roundDisplayedMinutes:
      config
        ?.roundDisplayedMinutes ??
      fallback
        .roundDisplayedMinutes,
  };
}

/* =========================================================
 * Final config creation
 * ======================================================= */

export function createScanItemProcessingConfig(
  overrides:
    PartialScanItemProcessingConfig =
      {},
  base:
    ScanItemProcessingConfig =
      DEFAULT_SCAN_ITEM_PROCESSING_CONFIG
): ScanItemProcessingConfig {
  return {
    queue:
      normalizeProcessingQueueConfig(
        overrides.queue,
        base.queue
      ),

    background: {
      ios:
        normalizeIosBackgroundConfig(
          overrides
            .background
            ?.ios,
          base
            .background
            .ios
        ),

      android:
        normalizeAndroidBackgroundConfig(
          overrides
            .background
            ?.android,
          base
            .background
            .android
        ),
    },

    notifications:
      normalizeProcessingNotificationConfig(
        overrides.notifications,
        base.notifications
      ),

    timeEstimator:
      normalizeProcessingTimeEstimatorConfig(
        overrides.timeEstimator,
        base.timeEstimator
      ),

    enableDebugLogs:
      overrides
        .enableDebugLogs ??
      base
        .enableDebugLogs,

    enableDiagnostics:
      overrides
        .enableDiagnostics ??
      base
        .enableDiagnostics,

    enableRecovery:
      overrides
        .enableRecovery ??
      base
        .enableRecovery,

    enableAutomaticResume:
      overrides
        .enableAutomaticResume ??
      base
        .enableAutomaticResume,

    enableAutomaticRetry:
      overrides
        .enableAutomaticRetry ??
      base
        .enableAutomaticRetry,

    enableWardrobePlaceholders:
      overrides
        .enableWardrobePlaceholders ??
      base
        .enableWardrobePlaceholders,

    enablePerItemProgress:
      overrides
        .enablePerItemProgress ??
      base
        .enablePerItemProgress,

    enableOverallProgress:
      overrides
        .enableOverallProgress ??
      base
        .enableOverallProgress,

    enableEstimatedTime:
      overrides
        .enableEstimatedTime ??
      base
        .enableEstimatedTime,
  };
}

/* =========================================================
 * Environment config
 * ======================================================= */

export function getDefaultScanItemProcessingConfig():
  ScanItemProcessingConfig {
  const isDevelopment =
    typeof __DEV__ ===
      'boolean'
      ? __DEV__
      : false;

  return cloneScanItemProcessingConfig(
    isDevelopment
      ? DEVELOPMENT_SCAN_ITEM_PROCESSING_CONFIG
      : PRODUCTION_SCAN_ITEM_PROCESSING_CONFIG
  );
}

/* =========================================================
 * Validation helpers
 * ======================================================= */

function appendIssue(
  issues:
    ProcessingConfigIssue[],
  issue:
    ProcessingConfigIssue
): void {
  issues.push(
    issue
  );
}

export function validateScanItemProcessingConfig(
  config:
    ScanItemProcessingConfig
): ProcessingConfigValidationResult {
  const issues:
    ProcessingConfigIssue[] =
      [];

  if (
    config.queue
      .queueId
      .trim()
      .length ===
    0
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-queue-id',

        severity:
          'error',

        message:
          'Queue ID must not be empty.',

        path:
          'queue.queueId',
      }
    );
  }

  if (
    config.queue
      .maximumItems <
      PROCESSING_QUEUE_MINIMUM_ITEMS ||
    config.queue
      .maximumItems >
      PROCESSING_QUEUE_MAXIMUM_ITEMS
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-maximum-items',

        severity:
          'error',

        message:
          `Queue maximumItems must be between ${PROCESSING_QUEUE_MINIMUM_ITEMS} and ${PROCESSING_QUEUE_MAXIMUM_ITEMS}.`,

        path:
          'queue.maximumItems',
      }
    );
  }

  if (
    config.queue
      .concurrency !==
    1
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-concurrency',

        severity:
          'error',

        message:
          'Scan Item processing concurrency must remain 1.',

        path:
          'queue.concurrency',
      }
    );
  }

  if (
    config.queue
      .estimatedItemProcessingMs <
      PROCESSING_QUEUE_MINIMUM_ESTIMATED_ITEM_MS ||
    config.queue
      .estimatedItemProcessingMs >
      PROCESSING_QUEUE_MAXIMUM_ESTIMATED_ITEM_MS
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-estimated-processing-time',

        severity:
          'error',

        message:
          'Estimated item processing time is outside the supported range.',

        path:
          'queue.estimatedItemProcessingMs',
      }
    );
  }

  if (
    config.queue
      .retryPolicy
      .maximumAttempts <
      PROCESSING_QUEUE_MINIMUM_ATTEMPTS ||
    config.queue
      .retryPolicy
      .maximumAttempts >
      PROCESSING_QUEUE_MAXIMUM_ATTEMPTS
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-retry-attempts',

        severity:
          'error',

        message:
          'Retry maximumAttempts is outside the supported range.',

        path:
          'queue.retryPolicy.maximumAttempts',
      }
    );
  }

  if (
    config.queue
      .retryPolicy
      .baseDelayMs <
      PROCESSING_QUEUE_MINIMUM_RETRY_DELAY_MS ||
    config.queue
      .retryPolicy
      .baseDelayMs >
      PROCESSING_QUEUE_MAXIMUM_RETRY_DELAY_MS
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-retry-delay',

        severity:
          'error',

        message:
          'Retry baseDelayMs is outside the supported range.',

        path:
          'queue.retryPolicy.baseDelayMs',
      }
    );
  }

  if (
    config.queue
      .retryPolicy
      .maximumDelayMs <
      config.queue
        .retryPolicy
        .baseDelayMs ||
    config.queue
      .retryPolicy
      .maximumDelayMs >
      PROCESSING_QUEUE_MAXIMUM_RETRY_DELAY_MS
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-maximum-retry-delay',

        severity:
          'error',

        message:
          'Retry maximumDelayMs must be greater than or equal to baseDelayMs.',

        path:
          'queue.retryPolicy.maximumDelayMs',
      }
    );
  }

  if (
    config.queue
      .retryPolicy
      .backoffMultiplier <
      PROCESSING_QUEUE_MINIMUM_BACKOFF_MULTIPLIER ||
    config.queue
      .retryPolicy
      .backoffMultiplier >
      PROCESSING_QUEUE_MAXIMUM_BACKOFF_MULTIPLIER
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-backoff-multiplier',

        severity:
          'error',

        message:
          'Retry backoffMultiplier is outside the supported range.',

        path:
          'queue.retryPolicy.backoffMultiplier',
      }
    );
  }

  if (
    config.background
      .ios
      .enabled &&
    config.background
      .ios
      .backgroundTaskIdentifier
      .trim()
      .length ===
      0
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-ios-task-identifier',

        severity:
          'error',

        message:
          'iOS background task identifier must not be empty.',

        path:
          'background.ios.backgroundTaskIdentifier',
      }
    );
  }

  if (
    config.background
      .android
      .enabled &&
    config.background
      .android
      .workName
      .trim()
      .length ===
      0
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-android-work-name',

        severity:
          'error',

        message:
          'Android WorkManager work name must not be empty.',

        path:
          'background.android.workName',
      }
    );
  }

  if (
    config.background
      .android
      .enabled &&
    config.background
      .android
      .notificationChannelId
      .trim()
      .length ===
      0
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-notification-channel-id',

        severity:
          'error',

        message:
          'Android notification channel ID must not be empty.',

        path:
          'background.android.notificationChannelId',
      }
    );
  }

  if (
    config.background
      .android
      .foregroundNotificationId <=
      0 ||
    config.background
      .android
      .completionNotificationId <=
      0
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-notification-id',

        severity:
          'error',

        message:
          'Android notification IDs must be positive integers.',

        path:
          'background.android',
      }
    );
  }

  if (
    config.notifications
      .progressNotificationMinimumIntervalMs <
      1_000
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-notification-interval',

        severity:
          'warning',

        message:
          'Progress notification interval is very short and may create excessive updates.',

        path:
          'notifications.progressNotificationMinimumIntervalMs',
      }
    );
  }

  if (
    config.timeEstimator
      .minimumSampleCount >
    config.timeEstimator
      .maximumSampleCount
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-time-estimator-sample-count',

        severity:
          'error',

        message:
          'Time estimator minimumSampleCount must not exceed maximumSampleCount.',

        path:
          'timeEstimator',
      }
    );
  }

  if (
    config.timeEstimator
      .smoothingFactor <=
      0 ||
    config.timeEstimator
      .smoothingFactor >
      1
  ) {
    appendIssue(
      issues,
      {
        code:
          'invalid-time-estimator-smoothing-factor',

        severity:
          'error',

        message:
          'Time estimator smoothingFactor must be greater than 0 and less than or equal to 1.',

        path:
          'timeEstimator.smoothingFactor',
      }
    );
  }

  const errors =
    issues.filter(
      issue =>
        issue.severity ===
        'error'
    );

  const warnings =
    issues.filter(
      issue =>
        issue.severity ===
        'warning'
    );

  return {
    valid:
      errors.length ===
      0,

    issues,

    errors,

    warnings,
  };
}

export function assertValidScanItemProcessingConfig(
  config:
    ScanItemProcessingConfig
): void {
  const validation =
    validateScanItemProcessingConfig(
      config
    );

  if (
    validation.valid
  ) {
    return;
  }

  const message =
    validation.errors
      .map(
        issue =>
          `${issue.path}: ${issue.message}`
      )
      .join('\n');

  throw new Error(
    `Invalid Scan Item processing configuration:\n${message}`
  );
}

/* =========================================================
 * Retry delay
 * ======================================================= */

export function calculateProcessingRetryDelayMs(
  attempt:
    number,
  policy:
    ProcessingRetryPolicy
): ProcessingDurationMs {
  const safeAttempt =
    clampInteger(
      attempt,
      1,
      PROCESSING_QUEUE_MAXIMUM_ATTEMPTS,
      1
    );

  const exponentialDelay =
    policy.baseDelayMs *
    Math.pow(
      policy.backoffMultiplier,
      Math.max(
        0,
        safeAttempt -
          1
      )
    );

  return normalizeProcessingDuration(
    Math.min(
      policy.maximumDelayMs,
      exponentialDelay
    )
  );
}

/* =========================================================
 * Estimated batch time
 * ======================================================= */

export function calculateInitialBatchEstimateMs(
  itemCount:
    number,
  config:
    ScanItemProcessingConfig
): ProcessingDurationMs {
  const safeItemCount =
    clampInteger(
      itemCount,
      0,
      config.queue.maximumItems,
      0
    );

  return normalizeProcessingDuration(
    safeItemCount *
      config.timeEstimator
        .initialEstimatedItemMs
  );
}