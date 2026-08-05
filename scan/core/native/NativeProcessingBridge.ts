// scan/core/native/NativeProcessingBridge.ts
// Part 1/2
//
// Triple N - Native Scan Item Processing Bridge
//
// هذا الملف هو طبقة الاتصال الموحدة بين JavaScript
// ومحرك المعالجة Native الحقيقي على iOS وAndroid.
//
// مسؤولياته:
//
// 1) اكتشاف Native Processing Module.
// 2) فحص قدرات التنفيذ على الجهاز.
// 3) إرسال NativeProcessingJobPayload صغيرة وآمنة.
// 4) استقبال Progress / Result / Failure Events.
// 5) منع إرسال أكثر من Job ثقيلة في الوقت نفسه.
// 6) تطبيع كل قيم Native قبل تمريرها لباقي المشروع.
// 7) دعم Recovery بعد رجوع JavaScript.
// 8) عدم تمرير TypedArrays أو SegmentationResult إلى Native.
// 9) العمل مع Dependency Injection للاختبارات.
// 10) عدم الاعتماد على UI أو React Hooks.
//
// ملاحظة معمارية مهمة:
//
// TripleNBackground الحالي يحافظ على Background Time
// لعملية JavaScript، لكنه لا ينفذ EdgeSAM بنفسه بعد تعليق JavaScript.
//
// هذا الـBridge يستهدف Native Module جديدًا:
//
// TripleNNativeProcessing
//
// والذي يجب لاحقًا أن ينفذ المعالجة Native بالكامل
// على iOS وAndroid.
//
// هذا الملف لا يشغّل EdgeSAM في JavaScript.
// لا يستخدم AsyncStorage مباشرة.
// لا يعدّل Queue مباشرة.
// لا يحدّث Wardrobe مباشرة.

import {
    requireOptionalNativeModule,
} from 'expo-modules-core';

import {
    Platform,
} from 'react-native';

import type {
    ProcessingJobErrorCode,
    ProcessingJobId,
    ProcessingJobStage,
    ProcessingJobStatus,
    ProcessingPlatform,
    ProcessingTimestamp,
} from '../queue/QueueTypes';

import {
    NATIVE_PROCESSING_CONTRACT_VERSION,
    clampNativeProcessingProgress,
    nativeProcessingPercentage,
    normalizeNativeProcessingDuration,
    normalizeNativeProcessingTimestamp,
} from './NativeProcessingContracts';

import type {
    NativeProcessingApplicationState,
    NativeProcessingCapabilityResult,
    NativeProcessingCapabilityStatus,
    NativeProcessingError,
    NativeProcessingErrorSource,
    NativeProcessingEvent,
    NativeProcessingEventListener,
    NativeProcessingEventType,
    NativeProcessingExecutorState,
    NativeProcessingJobPayload,
    NativeProcessingJobResult,
    NativeProcessingPersistedRecord,
    NativeProcessingProgress,
    NativeProcessingRuntime,
    NativeProcessingScheduleResult,
} from './NativeProcessingContracts';

/* =========================================================
 * Native module identity
 * ======================================================= */

export const NATIVE_PROCESSING_MODULE_NAME =
  'TripleNNativeProcessing';

export const NATIVE_PROCESSING_EVENT_SCHEDULED =
  'onNativeProcessingScheduled';

export const NATIVE_PROCESSING_EVENT_STARTED =
  'onNativeProcessingStarted';

export const NATIVE_PROCESSING_EVENT_PROGRESS =
  'onNativeProcessingProgress';

export const NATIVE_PROCESSING_EVENT_SUSPENDED =
  'onNativeProcessingSuspended';

export const NATIVE_PROCESSING_EVENT_RESUMED =
  'onNativeProcessingResumed';

export const NATIVE_PROCESSING_EVENT_COMPLETED =
  'onNativeProcessingCompleted';

export const NATIVE_PROCESSING_EVENT_FAILED =
  'onNativeProcessingFailed';

export const NATIVE_PROCESSING_EVENT_CANCELLED =
  'onNativeProcessingCancelled';

export const NATIVE_PROCESSING_EVENT_EXPIRED =
  'onNativeProcessingExpired';

export const NATIVE_PROCESSING_EVENT_INTERRUPTED =
  'onNativeProcessingInterrupted';

/* =========================================================
 * Native event names
 * ======================================================= */

export const NATIVE_PROCESSING_EVENT_NAMES =
  [
    NATIVE_PROCESSING_EVENT_SCHEDULED,
    NATIVE_PROCESSING_EVENT_STARTED,
    NATIVE_PROCESSING_EVENT_PROGRESS,
    NATIVE_PROCESSING_EVENT_SUSPENDED,
    NATIVE_PROCESSING_EVENT_RESUMED,
    NATIVE_PROCESSING_EVENT_COMPLETED,
    NATIVE_PROCESSING_EVENT_FAILED,
    NATIVE_PROCESSING_EVENT_CANCELLED,
    NATIVE_PROCESSING_EVENT_EXPIRED,
    NATIVE_PROCESSING_EVENT_INTERRUPTED,
  ] as const;

export type NativeProcessingNativeEventName =
  (typeof NATIVE_PROCESSING_EVENT_NAMES)[number];

/* =========================================================
 * Native module raw contracts
 * ======================================================= */

/**
 * القيم القادمة من Swift أو Kotlin تعامل كـunknown
 * ثم يتم التحقق منها داخل الـBridge.
 *
 * لا نفترض أن Native أعاد عقد TypeScript صحيحًا.
 */
export type NativeProcessingRawRecord =
  Record<
    string,
    unknown
  >;

export type NativeProcessingNativeSubscription = {
  remove():
    void;
};

/**
 * هذا هو العقد المطلوب من Native Module الجديد.
 *
 * iOS:
 * - Swift Expo Module باسم TripleNNativeProcessing.
 *
 * Android:
 * - Kotlin Expo Module بنفس الاسم.
 */
export type NativeProcessingNativeModule = {
  /**
   * فحص قدرة الجهاز والمنصة.
   */
  getCapability():
    Promise<unknown>;

  /**
   * تهيئة Native runtime واستعادة حالته الداخلية.
   */
  initialize?():
    Promise<unknown>;

  /**
   * إضافة Job إلى Native scheduler.
   */
  scheduleJob(
    payload:
      NativeProcessingJobPayload
  ):
    Promise<unknown>;

  /**
   * بدء Job مجدولة فورًا عندما تسمح المنصة.
   */
  startJob?(
    jobId:
      ProcessingJobId
  ):
    Promise<unknown>;

  /**
   * استرجاع Job واحدة من Native.
   */
  getJobState(
    jobId:
      ProcessingJobId
  ):
    Promise<unknown>;

  /**
   * استرجاع كل Jobs التي يعرفها Native.
   */
  getAllJobStates():
    Promise<unknown>;

  /**
   * استرجاع نتائج لم يتم استهلاكها بعد بواسطة JS.
   */
  getPendingResults():
    Promise<unknown>;

  /**
   * تعليم نتيجة بأنها وصلت بأمان إلى JavaScript.
   */
  acknowledgeResult?(
    jobId:
      ProcessingJobId
  ):
    Promise<unknown>;

  /**
   * إلغاء Job واحدة.
   */
  cancelJob(
    jobId:
      ProcessingJobId,
    reason?:
      string
  ):
    Promise<unknown>;

  /**
   * حذف سجل Native بعد اكتمال المزامنة.
   */
  removeJob?(
    jobId:
      ProcessingJobId
  ):
    Promise<unknown>;

  /**
   * تنظيف النتائج والسجلات النهائية القديمة.
   */
  clearCompletedJobs?():
    Promise<unknown>;

  /**
   * إيقاف Native runtime وتنظيف Listeners الداخلية.
   */
  dispose?():
    Promise<void>;

  /**
   * Expo Modules event subscription.
   */
  addListener(
    eventName:
      NativeProcessingNativeEventName,
    listener:
      (
        event:
          unknown
      ) => void
  ):
    NativeProcessingNativeSubscription;
};

/* =========================================================
 * Storage adapter
 * ======================================================= */

/**
 * استخدمنا Interface محليًا بدل افتراض أسماء الدوال
 * الموجودة في NativeProcessingStorage.ts.
 *
 * عند إنشاء الـBridge نمرر Adapter يطابق هذا العقد.
 * بهذه الطريقة لا نربط الملف بتوقيعات غير مؤكدة.
 */
export type NativeProcessingBridgeStorage = {
  getRecord(
    jobId:
      ProcessingJobId
  ):
    Promise<
      NativeProcessingPersistedRecord | null
    >;

  getAllRecords():
    Promise<
      readonly NativeProcessingPersistedRecord[]
    >;

  saveRecord(
    record:
      NativeProcessingPersistedRecord
  ):
    Promise<void>;

  removeRecord(
    jobId:
      ProcessingJobId
  ):
    Promise<void>;

  clearCompletedRecords?():
    Promise<void>;
};

/* =========================================================
 * Clock adapter
 * ======================================================= */

export type NativeProcessingBridgeClock = {
  now():
    number;
};

/* =========================================================
 * Bridge state
 * ======================================================= */

export type NativeProcessingBridgeState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'recovering'
  | 'disposing'
  | 'disposed'
  | 'failed';

/* =========================================================
 * Bridge options
 * ======================================================= */

export type NativeProcessingBridgeOptions = {
  /**
   * Native module مخصص للاختبارات.
   *
   * undefined:
   * نحاول اكتشاف الموديول الحقيقي.
   *
   * null:
   * تعطيل Native Module صراحة.
   */
  nativeModule?:
    NativeProcessingNativeModule | null;

  /**
   * Storage المستخدم لحفظ آخر حالة معروفة.
   */
  storage?:
    NativeProcessingBridgeStorage | null;

  /**
   * Clock مخصص للاختبارات.
   */
  clock?:
    NativeProcessingBridgeClock;

  /**
   * السماح باستدعاء initialize حتى عند غياب Native.
   *
   * لا يعني ذلك تشغيل المعالجة في JavaScript.
   */
  allowUnavailableInitialization?:
    boolean;

  /**
   * إرسال Events مكررة بنفس revision أم تجاهلها.
   */
  allowDuplicateNativeEvents?:
    boolean;

  /**
   * حذف سجل Native بعد acknowledgeResult.
   */
  removeNativeRecordAfterAcknowledgement?:
    boolean;

  /**
   * حذف السجل المحلي بعد acknowledgeResult.
   */
  removeLocalRecordAfterAcknowledgement?:
    boolean;

  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Initialization result
 * ======================================================= */

export type NativeProcessingBridgeInitializeResult = {
  initialized:
    boolean;

  available:
    boolean;

  capability:
    NativeProcessingCapabilityResult;

  restoredRecordCount:
    number;

  pendingResultCount:
    number;

  warnings:
    readonly string[];
};

/* =========================================================
 * Recovery result
 * ======================================================= */

export type NativeProcessingBridgeRecoveryResult = {
  recovered:
    readonly NativeProcessingPersistedRecord[];

  pendingResults:
    readonly NativeProcessingJobResult[];

  missingNativeJobIds:
    readonly ProcessingJobId[];

  warnings:
    readonly string[];

  recoveredAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Schedule request
 * ======================================================= */

export type NativeProcessingBridgeScheduleRequest = {
  payload:
    NativeProcessingJobPayload;

  /**
   * حفظ السجل محليًا قبل Native schedule.
   *
   * مهم لمنع فقدان Job عند توقف التطبيق
   * مباشرة بعد الاستدعاء.
   */
  persistBeforeScheduling?:
    boolean;

  /**
   * بدء Job فورًا بعد قبول الجدولة.
   */
  startImmediately?:
    boolean;
};

/* =========================================================
 * Cancellation result
 * ======================================================= */

export type NativeProcessingBridgeCancellationResult = {
  jobId:
    ProcessingJobId;

  cancelled:
    boolean;

  nativeTaskId:
    string | null;

  result:
    NativeProcessingJobResult | null;

  error:
    NativeProcessingError | null;

  cancelledAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Acknowledgement result
 * ======================================================= */

export type NativeProcessingBridgeAcknowledgementResult = {
  jobId:
    ProcessingJobId;

  acknowledged:
    boolean;

  removedFromNative:
    boolean;

  removedFromLocalStorage:
    boolean;

  acknowledgedAt:
    ProcessingTimestamp;

  error:
    NativeProcessingError | null;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type NativeProcessingBridgeDiagnostics = {
  state:
    NativeProcessingBridgeState;

  initialized:
    boolean;

  disposed:
    boolean;

  nativeModuleAvailable:
    boolean;

  platform:
    ProcessingPlatform;

  runtime:
    NativeProcessingRuntime;

  capability:
    NativeProcessingCapabilityStatus;

  listenerCount:
    number;

  eventListenerCount:
    number;

  activeJobId:
    ProcessingJobId | null;

  initializeCount:
    number;

  capabilityCheckCount:
    number;

  scheduleCount:
    number;

  acceptedScheduleCount:
    number;

  rejectedScheduleCount:
    number;

  startCount:
    number;

  cancelCount:
    number;

  recoveryCount:
    number;

  acknowledgeCount:
    number;

  nativeEventCount:
    number;

  duplicateEventCount:
    number;

  invalidEventCount:
    number;

  storageWriteCount:
    number;

  storageWriteFailureCount:
    number;

  storageReadCount:
    number;

  storageReadFailureCount:
    number;

  lastInitializedAt:
    ProcessingTimestamp | null;

  lastScheduledAt:
    ProcessingTimestamp | null;

  lastRecoveredAt:
    ProcessingTimestamp | null;

  lastNativeEventAt:
    ProcessingTimestamp | null;

  lastOperationAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;

  warnings:
    readonly string[];
};

/* =========================================================
 * Internal event identity
 * ======================================================= */

type NativeProcessingEventIdentity = {
  jobId:
    ProcessingJobId;

  type:
    NativeProcessingEventType;

  timestamp:
    ProcessingTimestamp;

  revision:
    number | null;
};

/* =========================================================
 * Internal parsed native state
 * ======================================================= */

type ParsedNativeProcessingState = {
  record:
    NativeProcessingPersistedRecord | null;

  progress:
    NativeProcessingProgress | null;

  result:
    NativeProcessingJobResult | null;
};

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
    // نستخدم String في النهاية.
  }

  return String(
    error
  );
}

function isRecord(
  value:
    unknown
): value is NativeProcessingRawRecord {
  return (
    typeof value ===
      'object' &&
    value !==
      null &&
    !Array.isArray(
      value
    )
  );
}

function readString(
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

function readBoolean(
  value:
    unknown,
  fallback =
    false
): boolean {
  return typeof value ===
    'boolean'
    ? value
    : fallback;
}

function readFiniteNumber(
  value:
    unknown
): number | null {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  )
    ? value
    : null;
}

function readInteger(
  value:
    unknown,
  fallback =
    0
): number {
  const numberValue =
    readFiniteNumber(
      value
    );

  if (
    numberValue ===
      null
  ) {
    return fallback;
  }

  return Math.floor(
    numberValue
  );
}

function readNullableTimestamp(
  value:
    unknown
): ProcessingTimestamp | null {
  const numberValue =
    readFiniteNumber(
      value
    );

  if (
    numberValue ===
      null ||
    numberValue <=
      0
  ) {
    return null;
  }

  return Math.floor(
    numberValue
  );
}

function readStringArray(
  value:
    unknown
): readonly string[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  const output:
    string[] = [];

  for (
    const entry of
    value
  ) {
    const normalized =
      readString(
        entry
      );

    if (
      normalized
    ) {
      output.push(
        normalized
      );
    }
  }

  return output;
}

function cloneMetadata(
  value:
    unknown
): Readonly<
  Record<
    string,
    string | number | boolean | null
  >
> {
  if (
    !isRecord(
      value
    )
  ) {
    return {};
  }

  const metadata:
    Record<
      string,
      string | number | boolean | null
    > = {};

  for (
    const [
      key,
      entry,
    ] of Object.entries(
      value
    )
  ) {
    if (
      typeof entry ===
        'string' ||
      typeof entry ===
        'number' ||
      typeof entry ===
        'boolean' ||
      entry ===
        null
    ) {
      metadata[key] =
        entry;
    }
  }

  return metadata;
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

/* =========================================================
 * Platform normalization
 * ======================================================= */

function resolveProcessingPlatform():
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

/* =========================================================
 * Runtime normalization
 * ======================================================= */

function normalizeRuntime(
  value:
    unknown,
  platform:
    ProcessingPlatform
): NativeProcessingRuntime {
  switch (
    value
  ) {
    case 'ios-bg-processing':
    case 'ios-continued-processing':
    case 'android-work-manager':
    case 'android-foreground-service':
    case 'foreground-fallback':
    case 'unknown':
      return value;

    default:
      if (
        platform ===
          'ios'
      ) {
        return 'ios-bg-processing';
      }

      if (
        platform ===
          'android'
      ) {
        return 'android-work-manager';
      }

      return 'unknown';
  }
}

/* =========================================================
 * Capability normalization
 * ======================================================= */

function normalizeCapabilityStatus(
  value:
    unknown
): NativeProcessingCapabilityStatus {
  switch (
    value
  ) {
    case 'available':
    case 'unavailable':
    case 'restricted':
    case 'unsupported':
    case 'unknown':
      return value;

    default:
      return 'unknown';
  }
}

function createUnavailableCapability(
  platform:
    ProcessingPlatform,
  reason:
    string,
  checkedAt:
    ProcessingTimestamp
): NativeProcessingCapabilityResult {
  return {
    platform,

    status:
      platform ===
        'unknown'
        ? 'unsupported'
        : 'unavailable',

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

    reason,

    checkedAt,
  };
}

function normalizeCapabilityResult(
  value:
    unknown,
  platform:
    ProcessingPlatform,
  checkedAt:
    ProcessingTimestamp
): NativeProcessingCapabilityResult {
  if (
    !isRecord(
      value
    )
  ) {
    return createUnavailableCapability(
      platform,
      'Native processing returned an invalid capability response.',
      checkedAt
    );
  }

  const resultPlatform =
    value.platform ===
      'ios' ||
    value.platform ===
      'android'
      ? value.platform
      : platform;

  const status =
    normalizeCapabilityStatus(
      value.status ??
      value.capability
    );

  return {
    platform:
      resultPlatform,

    status,

    runtime:
      normalizeRuntime(
        value.runtime ??
        value.executor,
        resultPlatform
      ),

    supportsLockedScreenExecution:
      readBoolean(
        value
          .supportsLockedScreenExecution,
        false
      ),

    supportsTerminatedAppExecution:
      readBoolean(
        value
          .supportsTerminatedAppExecution,
        false
      ),

    supportsProgressUpdates:
      readBoolean(
        value
          .supportsProgressUpdates,
        false
      ),

    supportsCancellation:
      readBoolean(
        value
          .supportsCancellation,
        false
      ),

    maximumConcurrentJobs:
      1,

    reason:
      readString(
        value.reason ??
        value.message
      ),

    checkedAt:
      normalizeNativeProcessingTimestamp(
        readFiniteNumber(
          value.checkedAt
        ),
        checkedAt
      ),
  };
}

/* =========================================================
 * Native module resolution
 * ======================================================= */

function resolveNativeProcessingModule():
  NativeProcessingNativeModule | null {
  const platform =
    resolveProcessingPlatform();

  if (
    platform ===
      'unknown'
  ) {
    return null;
  }

  try {
    return requireOptionalNativeModule<
      NativeProcessingNativeModule
    >(
      NATIVE_PROCESSING_MODULE_NAME
    );
  } catch {
    return null;
  }
}

/* =========================================================
 * Status normalization
 * ======================================================= */

function normalizeJobStatus(
  value:
    unknown,
  fallback:
    ProcessingJobStatus =
      'queued'
): ProcessingJobStatus {
  switch (
    value
  ) {
    case 'queued':
    case 'preparing':
    case 'processing':
    case 'finalizing':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'paused':
    case 'interrupted':
    case 'retry-scheduled':
      return value;

    default:
      return fallback;
  }
}

function normalizeExecutorState(
  value:
    unknown,
  fallback:
    NativeProcessingExecutorState =
      'idle'
): NativeProcessingExecutorState {
  switch (
    value
  ) {
    case 'idle':
    case 'scheduled':
    case 'starting':
    case 'running':
    case 'suspending':
    case 'suspended':
    case 'resuming':
    case 'finishing':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'expired':
    case 'interrupted':
      return value;

    default:
      return fallback;
  }
}

function normalizeApplicationState(
  value:
    unknown
): NativeProcessingApplicationState {
  switch (
    value
  ) {
    case 'active':
    case 'inactive':
    case 'background':
    case 'locked':
    case 'terminated':
    case 'unknown':
      return value;

    default:
      return 'unknown';
  }
}

function normalizeProcessingStage(
  value:
    unknown,
  fallback:
    ProcessingJobStage =
      'queued'
): ProcessingJobStage {
  switch (
    value
  ) {
    case 'queued':
    case 'load-source':
    case 'validate-source':
    case 'prepare-segmentation':
    case 'validate-input':
    case 'load-image':
    case 'correct-orientation':
    case 'decode-pixels':
    case 'resize-image':
    case 'apply-letterbox':
    case 'normalize-pixels':
    case 'create-encoder-tensor':
    case 'load-model-sessions':
    case 'run-image-encoder':
    case 'create-segmentation-prompt':
    case 'create-decoder-inputs':
    case 'run-mask-decoder':
    case 'read-mask-candidates':
    case 'select-best-mask':
    case 'refine-alpha-mask':
    case 'restore-original-size':
    case 'protect-object-edges':
    case 'export-transparent-image':
    case 'save-processed-image':
    case 'update-wardrobe-item':
    case 'complete':
    case 'failed':
    case 'cancelled':
      return value;

    default:
      return fallback;
  }
}

/* =========================================================
 * Error normalization
 * ======================================================= */

function normalizeProcessingErrorCode(
  value:
    unknown
): ProcessingJobErrorCode {
  const normalized =
    readString(
      value
    );

  return (
    normalized ??
    'UNKNOWN_QUEUE_ERROR'
  ) as ProcessingJobErrorCode;
}

function normalizeErrorSource(
  value:
    unknown
): NativeProcessingErrorSource {
  switch (
    value
  ) {
    case 'scheduler':
    case 'source':
    case 'model':
    case 'encoder':
    case 'decoder':
    case 'postprocessor':
    case 'export':
    case 'storage':
    case 'wardrobe':
    case 'expiration':
    case 'cancellation':
    case 'unknown':
      return value;

    default:
      return 'unknown';
  }
}

function createNativeProcessingError(
  input: {
    code?:
      unknown;

    message:
      string;

    source?:
      unknown;

    retryable?:
      unknown;

    occurredAt?:
      unknown;

    attempt?:
      unknown;

    stage?:
      unknown;

    nativeCode?:
      unknown;

    metadata?:
      unknown;
  },
  fallbackTimestamp:
    ProcessingTimestamp
): NativeProcessingError {
  return {
    code:
      normalizeProcessingErrorCode(
        input.code
      ),

    message:
      input.message,

    source:
      normalizeErrorSource(
        input.source
      ),

    retryable:
      readBoolean(
        input.retryable,
        false
      ),

    occurredAt:
      normalizeNativeProcessingTimestamp(
        readFiniteNumber(
          input.occurredAt
        ),
        fallbackTimestamp
      ),

    attempt:
      Math.max(
        0,
        readInteger(
          input.attempt,
          0
        )
      ),

    stage:
      input.stage ===
        null ||
      input.stage ===
        undefined
        ? null
        : normalizeProcessingStage(
            input.stage,
            'failed'
          ),

    nativeCode:
      readString(
        input.nativeCode
      ),

    metadata:
      cloneMetadata(
        input.metadata
      ),
  };
}

function normalizeNativeProcessingError(
  value:
    unknown,
  fallbackMessage:
    string,
  fallbackTimestamp:
    ProcessingTimestamp
): NativeProcessingError {
  if (
    !isRecord(
      value
    )
  ) {
    return createNativeProcessingError(
      {
        code:
          'UNKNOWN_QUEUE_ERROR',

        message:
          fallbackMessage,

        source:
          'unknown',

        retryable:
          false,
      },
      fallbackTimestamp
    );
  }

  return createNativeProcessingError(
    {
      code:
        value.code ??
        value.errorCode,

      message:
        readString(
          value.message ??
          value.errorMessage
        ) ??
        fallbackMessage,

      source:
        value.source,

      retryable:
        value.retryable,

      occurredAt:
        value.occurredAt ??
        value.timestamp,

      attempt:
        value.attempt,

      stage:
        value.stage,

      nativeCode:
        value.nativeCode,

      metadata:
        value.metadata,
    },
    fallbackTimestamp
  );
}

/* =========================================================
 * Progress normalization
 * ======================================================= */

function normalizeNativeProgress(
  value:
    unknown,
  fallbackPayload:
    NativeProcessingJobPayload | null,
  fallbackTimestamp:
    ProcessingTimestamp
): NativeProcessingProgress | null {
  if (
    !isRecord(
      value
    )
  ) {
    return null;
  }

  const jobId =
    readString(
      value.jobId
    ) ??
    fallbackPayload
      ?.jobId ??
    null;

  const queueId =
    readString(
      value.queueId
    ) ??
    fallbackPayload
      ?.queueId ??
    null;

  const batchId =
    readString(
      value.batchId
    ) ??
    fallbackPayload
      ?.batchId ??
    null;

  if (
    !jobId ||
    !queueId ||
    !batchId
  ) {
    return null;
  }

  const progress =
    clampNativeProcessingProgress(
      readFiniteNumber(
        value.progress
      ) ??
      0
    );

  const updatedAt =
    normalizeNativeProcessingTimestamp(
      readFiniteNumber(
        value.updatedAt ??
        value.timestamp
      ),
      fallbackTimestamp
    );

  return {
    contractVersion:
      NATIVE_PROCESSING_CONTRACT_VERSION,

    jobId,

    queueId,

    batchId,

    status:
      normalizeJobStatus(
        value.status,
        'processing'
      ),

    executorState:
      normalizeExecutorState(
        value.executorState ??
        value.state,
        'running'
      ),

    stage:
      normalizeProcessingStage(
        value.stage,
        'run-mask-decoder'
      ),

    progress,

    percentage:
      readFiniteNumber(
        value.percentage
      ) !==
        null
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                readFiniteNumber(
                  value.percentage
                ) as number
              )
            )
          )
        : nativeProcessingPercentage(
            progress
          ),

    message:
      readString(
        value.message
      ) ??
      'Native processing is running.',

    startedAt:
      readNullableTimestamp(
        value.startedAt
      ),

    updatedAt,

    elapsedMs:
      normalizeNativeProcessingDuration(
        readFiniteNumber(
          value.elapsedMs
        )
      ),

    estimatedRemainingMs:
      readFiniteNumber(
        value.estimatedRemainingMs
      ) ===
        null
        ? null
        : normalizeNativeProcessingDuration(
            readFiniteNumber(
              value.estimatedRemainingMs
            )
          ),

    nativeTaskId:
      readString(
        value.nativeTaskId ??
        value.taskId
      ),

    runtime:
      normalizeRuntime(
        value.runtime,
        fallbackPayload
          ?.platform ??
        resolveProcessingPlatform()
      ),

    applicationState:
      normalizeApplicationState(
        value.applicationState
      ),

    attempt:
      Math.max(
        0,
        readInteger(
          value.attempt,
          fallbackPayload
            ?.options
            .currentAttempt ??
          0
        )
      ),
  };
}

/* =========================================================
 * Output normalization
 * ======================================================= */

function normalizeNativeOutput(
  value:
    unknown,
  fallbackTimestamp:
    ProcessingTimestamp
): NativeProcessingJobResult[
  'output'
] {
  if (
    !isRecord(
      value
    )
  ) {
    return null;
  }

  const processedImageUri =
    readString(
      value.processedImageUri ??
      value.outputUri
    );

  const width =
    readInteger(
      value.width,
      0
    );

  const height =
    readInteger(
      value.height,
      0
    );

  if (
    !processedImageUri ||
    width <=
      0 ||
    height <=
      0
  ) {
    return null;
  }

  const foregroundRatioValue =
    readFiniteNumber(
      value.foregroundRatio
    );

  return {
    processedImageUri,

    width,

    height,

    format:
      'png',

    fileSizeBytes:
      readFiniteNumber(
        value.fileSizeBytes
      ) ===
        null
        ? null
        : Math.max(
            0,
            Math.floor(
              readFiniteNumber(
                value.fileSizeBytes
              ) as number
            )
          ),

    foregroundRatio:
      foregroundRatioValue ===
        null
        ? null
        : clampNativeProcessingProgress(
            foregroundRatioValue
          ),

    processingDurationMs:
      normalizeNativeProcessingDuration(
        readFiniteNumber(
          value.processingDurationMs ??
          value.durationMs
        )
      ),

    completedAt:
      normalizeNativeProcessingTimestamp(
        readFiniteNumber(
          value.completedAt
        ),
        fallbackTimestamp
      ),

    metadata:
      cloneMetadata(
        value.metadata
      ),
  };
}

/* =========================================================
 * Job result normalization
 * ======================================================= */

function normalizeNativeJobResult(
  value:
    unknown,
  fallbackPayload:
    NativeProcessingJobPayload | null,
  fallbackTimestamp:
    ProcessingTimestamp
): NativeProcessingJobResult | null {
  if (
    !isRecord(
      value
    )
  ) {
    return null;
  }

  const jobId =
    readString(
      value.jobId
    ) ??
    fallbackPayload
      ?.jobId ??
    null;

  const queueId =
    readString(
      value.queueId
    ) ??
    fallbackPayload
      ?.queueId ??
    null;

  const batchId =
    readString(
      value.batchId
    ) ??
    fallbackPayload
      ?.batchId ??
    null;

  const requestId =
    readString(
      value.requestId
    ) ??
    fallbackPayload
      ?.requestId ??
    null;

  const wardrobeItemId =
    readString(
      value.wardrobeItemId
    ) ??
    fallbackPayload
      ?.wardrobeItemId ??
    null;

  if (
    !jobId ||
    !queueId ||
    !batchId ||
    !requestId ||
    !wardrobeItemId
  ) {
    return null;
  }

  const completedAt =
    normalizeNativeProcessingTimestamp(
      readFiniteNumber(
        value.completedAt ??
        value.timestamp
      ),
      fallbackTimestamp
    );

  const succeeded =
    readBoolean(
      value.succeeded ??
      value.success,
      false
    );

  const output =
    normalizeNativeOutput(
      value.output,
      completedAt
    );

  const rawError =
    value.error ??
    (
      value.errorCode ||
      value.errorMessage
        ? {
            code:
              value.errorCode,

            message:
              value.errorMessage,

            retryable:
              value.retryable,

            stage:
              value.stage,

            nativeCode:
              value.nativeCode,
          }
        : null
    );

  const error =
    rawError
      ? normalizeNativeProcessingError(
          rawError,
          'Native processing failed.',
          completedAt
        )
      : null;

  return {
    contractVersion:
      NATIVE_PROCESSING_CONTRACT_VERSION,

    jobId,

    queueId,

    batchId,

    requestId,

    wardrobeItemId,

    succeeded:
      succeeded &&
      output !==
        null,

    cancelled:
      readBoolean(
        value.cancelled,
        false
      ),

    expired:
      readBoolean(
        value.expired,
        false
      ),

    interrupted:
      readBoolean(
        value.interrupted,
        false
      ),

    output,

    error,

    runtime:
      normalizeRuntime(
        value.runtime,
        fallbackPayload
          ?.platform ??
        resolveProcessingPlatform()
      ),

    nativeTaskId:
      readString(
        value.nativeTaskId ??
        value.taskId
      ),

    startedAt:
      readNullableTimestamp(
        value.startedAt
      ),

    completedAt,

    attempt:
      Math.max(
        0,
        readInteger(
          value.attempt,
          fallbackPayload
            ?.options
            .currentAttempt ??
          0
        )
      ),
  };
}

/* =========================================================
 * Schedule result normalization
 * ======================================================= */

function normalizeScheduleResult(
  value:
    unknown,
  payload:
    NativeProcessingJobPayload,
  timestamp:
    ProcessingTimestamp
): NativeProcessingScheduleResult {
  if (
    !isRecord(
      value
    )
  ) {
    return {
      accepted:
        false,

      jobId:
        payload.jobId,

      nativeTaskId:
        null,

      runtime:
        'unknown',

      scheduledAt:
        null,

      error:
        createNativeProcessingError(
          {
            code:
              'BACKGROUND_PROCESSING_START_FAILED',

            message:
              'Native processing returned an invalid scheduling response.',

            source:
              'scheduler',

            retryable:
              true,

            attempt:
              payload
                .options
                .currentAttempt,

            stage:
              'queued',
          },
          timestamp
        ),
    };
  }

  const accepted =
    readBoolean(
      value.accepted ??
      value.scheduled ??
      value.started,
      false
    );

  const rawError =
    value.error ??
    (
      value.errorCode ||
      value.errorMessage
        ? {
            code:
              value.errorCode,

            message:
              value.errorMessage,

            source:
              'scheduler',

            retryable:
              value.retryable,

            nativeCode:
              value.nativeCode,
          }
        : null
    );

  return {
    accepted,

    jobId:
      readString(
        value.jobId
      ) ??
      payload.jobId,

    nativeTaskId:
      readString(
        value.nativeTaskId ??
        value.taskId
      ),

    runtime:
      normalizeRuntime(
        value.runtime,
        payload.platform
      ),

    scheduledAt:
      accepted
        ? normalizeNativeProcessingTimestamp(
            readFiniteNumber(
              value.scheduledAt ??
              value.timestamp
            ),
            timestamp
          )
        : null,

    error:
      rawError
        ? normalizeNativeProcessingError(
            rawError,
            'Native processing could not schedule the job.',
            timestamp
          )
        : accepted
          ? null
          : createNativeProcessingError(
              {
                code:
                  'BACKGROUND_PROCESSING_START_FAILED',

                message:
                  readString(
                    value.message
                  ) ??
                  'Native processing rejected the job.',

                source:
                  'scheduler',

                retryable:
                  true,

                attempt:
                  payload
                    .options
                    .currentAttempt,

                stage:
                  'queued',
              },
              timestamp
            ),
  };
}

/* =========================================================
 * Event type mapping
 * ======================================================= */

function eventNameToType(
  eventName:
    NativeProcessingNativeEventName
): NativeProcessingEventType {
  switch (
    eventName
  ) {
    case NATIVE_PROCESSING_EVENT_SCHEDULED:
      return 'scheduled';

    case NATIVE_PROCESSING_EVENT_STARTED:
      return 'started';

    case NATIVE_PROCESSING_EVENT_PROGRESS:
      return 'progress';

    case NATIVE_PROCESSING_EVENT_SUSPENDED:
      return 'suspended';

    case NATIVE_PROCESSING_EVENT_RESUMED:
      return 'resumed';

    case NATIVE_PROCESSING_EVENT_COMPLETED:
      return 'completed';

    case NATIVE_PROCESSING_EVENT_FAILED:
      return 'failed';

    case NATIVE_PROCESSING_EVENT_CANCELLED:
      return 'cancelled';

    case NATIVE_PROCESSING_EVENT_EXPIRED:
      return 'expired';

    case NATIVE_PROCESSING_EVENT_INTERRUPTED:
      return 'interrupted';
  }
}

/* =========================================================
 * Bridge
 * ======================================================= */

export class NativeProcessingBridge {
  private readonly nativeModule:
    NativeProcessingNativeModule | null;

  private readonly storage:
    NativeProcessingBridgeStorage | null;

  private readonly clock:
    NativeProcessingBridgeClock;

  private readonly allowUnavailableInitialization:
    boolean;

  private readonly allowDuplicateNativeEvents:
    boolean;

  private readonly removeNativeRecordAfterAcknowledgement:
    boolean;

  private readonly removeLocalRecordAfterAcknowledgement:
    boolean;

  private readonly enableDebugLogs:
    boolean;

  private readonly platform:
    ProcessingPlatform;

  private state:
    NativeProcessingBridgeState =
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
      NativeProcessingBridgeRecoveryResult
    > | null =
      null;

  private disposePromise:
    Promise<void> | null =
      null;

  private capability:
    NativeProcessingCapabilityResult;

  private subscriptions:
    NativeProcessingNativeSubscription[] =
      [];

  private eventListeners =
    new Set<
      NativeProcessingEventListener
    >();

  private activeJobId:
    ProcessingJobId | null =
      null;

  private payloadByJobId =
    new Map<
      ProcessingJobId,
      NativeProcessingJobPayload
    >();

  private latestRecordByJobId =
    new Map<
      ProcessingJobId,
      NativeProcessingPersistedRecord
    >();

  private latestEventIdentityByJobId =
    new Map<
      ProcessingJobId,
      NativeProcessingEventIdentity
    >();

  private operationTail:
    Promise<void> =
      Promise.resolve();

  private diagnostics:
    NativeProcessingBridgeDiagnostics;

  constructor(
    options:
      NativeProcessingBridgeOptions =
        {}
  ) {
    this.platform =
      resolveProcessingPlatform();

    this.nativeModule =
      options.nativeModule !==
        undefined
        ? options.nativeModule
        : resolveNativeProcessingModule();

    this.storage =
      options.storage ??
      null;

    this.clock =
      options.clock ?? {
        now:
          defaultNow,
      };

    this.allowUnavailableInitialization =
      options
        .allowUnavailableInitialization ??
      true;

    this.allowDuplicateNativeEvents =
      options
        .allowDuplicateNativeEvents ??
      false;

    this.removeNativeRecordAfterAcknowledgement =
      options
        .removeNativeRecordAfterAcknowledgement ??
      true;

    this.removeLocalRecordAfterAcknowledgement =
      options
        .removeLocalRecordAfterAcknowledgement ??
      false;

    this.enableDebugLogs =
      options.enableDebugLogs ??
      false;

    const createdAt =
      this.now();

    this.capability =
      createUnavailableCapability(
        this.platform,
        this.nativeModule
          ? 'Native processing capability has not been checked yet.'
          : 'The TripleNNativeProcessing native module is not installed.',
        createdAt
      );

    this.diagnostics = {
      state:
        'uninitialized',

      initialized:
        false,

      disposed:
        false,

      nativeModuleAvailable:
        this.nativeModule !==
        null,

      platform:
        this.platform,

      runtime:
        'unknown',

      capability:
        'unknown',

      listenerCount:
        0,

      eventListenerCount:
        0,

      activeJobId:
        null,

      initializeCount:
        0,

      capabilityCheckCount:
        0,

      scheduleCount:
        0,

      acceptedScheduleCount:
        0,

      rejectedScheduleCount:
        0,

      startCount:
        0,

      cancelCount:
        0,

      recoveryCount:
        0,

      acknowledgeCount:
        0,

      nativeEventCount:
        0,

      duplicateEventCount:
        0,

      invalidEventCount:
        0,

      storageWriteCount:
        0,

      storageWriteFailureCount:
        0,

      storageReadCount:
        0,

      storageReadFailureCount:
        0,

      lastInitializedAt:
        null,

      lastScheduledAt:
        null,

      lastRecoveredAt:
        null,

      lastNativeEventAt:
        null,

      lastOperationAt:
        null,

      lastError:
        null,

      warnings:
        [],
    };
  }

  /* =======================================================
   * Time
   * ===================================================== */

  private now():
    ProcessingTimestamp {
    return normalizeNativeProcessingTimestamp(
      this.clock.now()
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
          this.capability
            .status ===
          'available',

        capability:
          this.getCapabilitySnapshot(),

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

    const warnings:
      string[] = [];

    try {
      if (
        this.storage
      ) {
        try {
          const records =
            await this.storage
              .getAllRecords();

          this.updateDiagnostics({
            storageReadCount:
              this.diagnostics
                .storageReadCount +
            1,
          });

          for (
            const record of
            records
          ) {
            this.latestRecordByJobId
              .set(
                record.payload.jobId,
                record
              );

            this.payloadByJobId
              .set(
                record.payload.jobId,
                record.payload
              );
          }
        } catch (error) {
          const message =
            `Could not restore native processing records: ${
              getUnknownErrorMessage(
                error
              )
            }`;

          appendUniqueWarning(
            warnings,
            message
          );

          this.updateDiagnostics({
            storageReadFailureCount:
              this.diagnostics
                .storageReadFailureCount +
            1,

            lastError:
              message,
          });
        }
      }

      if (
        !this.nativeModule
      ) {
        this.capability =
          createUnavailableCapability(
            this.platform,
            'The TripleNNativeProcessing native module is not installed in this build.',
            this.now()
          );

        appendUniqueWarning(
          warnings,
          'A new native development or production build is required after adding TripleNNativeProcessing.'
        );

        if (
          !this
            .allowUnavailableInitialization
        ) {
          throw new Error(
            this.capability
              .reason ??
            'Native processing is unavailable.'
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

          capability:
            this.capability
              .status,

          runtime:
            this.capability
              .runtime,

          lastInitializedAt:
            this.now(),

          lastOperationAt:
            this.now(),

          warnings,
        });

        return {
          initialized:
            true,

          available:
            false,

          capability:
            this.getCapabilitySnapshot(),

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

          warnings,
        };
      }

      if (
        this.nativeModule
          .initialize
      ) {
        await this.nativeModule
          .initialize();
      }

      this.capability =
        normalizeCapabilityResult(
          await this.nativeModule
            .getCapability(),
          this.platform,
          this.now()
        );

      this.updateDiagnostics({
        capabilityCheckCount:
          this.diagnostics
            .capabilityCheckCount +
        1,
      });

      this.attachNativeListeners();

      this.initialized =
        true;

      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        initialized:
          true,

        capability:
          this.capability
            .status,

        runtime:
          this.capability
            .runtime,

        listenerCount:
          this.subscriptions
            .length,

        lastInitializedAt:
          this.now(),

        lastOperationAt:
          this.now(),

        lastError:
          null,

        warnings,
      });

      return {
        initialized:
          true,

        available:
          this.capability
            .status ===
          'available',

        capability:
          this.getCapabilitySnapshot(),

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

        warnings,
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

        warnings,
      });

      throw error;
    }
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

    if (
      !forceRefresh ||
      !this.nativeModule
    ) {
      return this.getCapabilitySnapshot();
    }

    try {
      const result =
        await this.nativeModule
          .getCapability();

      this.capability =
        normalizeCapabilityResult(
          result,
          this.platform,
          this.now()
        );

      this.updateDiagnostics({
        capabilityCheckCount:
          this.diagnostics
            .capabilityCheckCount +
        1,

        capability:
          this.capability
            .status,

        runtime:
          this.capability
            .runtime,

        lastOperationAt:
          this.now(),

        lastError:
          null,
      });
    } catch (error) {
      this.updateDiagnostics({
        capabilityCheckCount:
          this.diagnostics
            .capabilityCheckCount +
        1,

        lastOperationAt:
          this.now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });
    }

    return this.getCapabilitySnapshot();
  }

  private getCapabilitySnapshot():
    NativeProcessingCapabilityResult {
    return {
      ...this.capability,
    };
  }

  /* =======================================================
   * Event subscription
   * ===================================================== */

  public subscribe(
    listener:
      NativeProcessingEventListener
  ): () => void {
    this.assertNotDisposed();

    this.eventListeners.add(
      listener
    );

    this.updateDiagnostics({
      eventListenerCount:
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
        eventListenerCount:
          this.eventListeners
            .size,

        lastOperationAt:
          this.now(),
      });
    };
  }

  private attachNativeListeners():
    void {
    if (
      !this.nativeModule ||
      this.subscriptions.length >
        0
    ) {
      return;
    }

    for (
      const eventName of
      NATIVE_PROCESSING_EVENT_NAMES
    ) {
      const subscription =
        this.nativeModule
          .addListener(
            eventName,
            event => {
              void this
                .enqueueOperation(
                  async () => {
                    await this
                      .handleRawNativeEvent(
                        eventName,
                        event
                      );
                  }
                );
            }
          );

      this.subscriptions.push(
        subscription
      );
    }

    this.updateDiagnostics({
      listenerCount:
        this.subscriptions
          .length,

      lastOperationAt:
        this.now(),
    });
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
            // العملية السابقة لا تمنع العملية التالية.
          }
        )
        .then(
          operation
        );

    this.operationTail =
      next.catch(
        error => {
          if (
            this.enableDebugLogs
          ) {
            console.warn(
              'TRIPLE N NATIVE PROCESSING BRIDGE OPERATION ERROR:',
              error
            );
          }
        }
      );

    return next;
  }

  /* =======================================================
   * Native event parsing entry
   * ===================================================== */

  private async handleRawNativeEvent(
    eventName:
      NativeProcessingNativeEventName,
    rawValue:
      unknown
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    const timestamp =
      this.now();

    const parsed =
      this.parseNativeState(
        rawValue,
        timestamp
      );

    const event =
      this.createBridgeEvent(
        eventName,
        rawValue,
        parsed,
        timestamp
      );

    if (
      !event
    ) {
      this.updateDiagnostics({
        invalidEventCount:
          this.diagnostics
            .invalidEventCount +
        1,

        lastNativeEventAt:
          timestamp,

        lastOperationAt:
          timestamp,
      });

      return;
    }

    if (
      this.isDuplicateEvent(
        event,
        rawValue
      )
    ) {
      this.updateDiagnostics({
        duplicateEventCount:
          this.diagnostics
            .duplicateEventCount +
        1,

        lastNativeEventAt:
          timestamp,

        lastOperationAt:
          timestamp,
      });

      return;
    }

    this.updateEventIdentity(
      event,
      rawValue
    );

    if (
      parsed.record
    ) {
      this.latestRecordByJobId
        .set(
          event.jobId,
          parsed.record
        );

      this.payloadByJobId
        .set(
          event.jobId,
          parsed.record
            .payload
        );

      await this.persistRecordSafely(
        parsed.record
      );
    } else {
      await this.mergeAndPersistEventState(
        event,
        parsed
      );
    }

    if (
      event.type ===
        'started' ||
      event.type ===
        'progress' ||
      event.type ===
        'resumed'
    ) {
      this.activeJobId =
        event.jobId;
    }

    if (
      event.type ===
        'completed' ||
      event.type ===
        'failed' ||
      event.type ===
        'cancelled' ||
      event.type ===
        'expired' ||
      event.type ===
        'interrupted'
    ) {
      if (
        this.activeJobId ===
          event.jobId
      ) {
        this.activeJobId =
          null;
      }
    }

    this.updateDiagnostics({
      nativeEventCount:
        this.diagnostics
          .nativeEventCount +
      1,

      activeJobId:
        this.activeJobId,

      lastNativeEventAt:
        timestamp,

      lastOperationAt:
        timestamp,

      lastError:
        event.error
          ?.message ??
        null,
    });

    this.emitEvent(
      event
    );
  }

  /* =======================================================
   * Parsed state
   * ===================================================== */

  private parseNativeState(
    rawValue:
      unknown,
    timestamp:
      ProcessingTimestamp
  ): ParsedNativeProcessingState {
    if (
      !isRecord(
        rawValue
      )
    ) {
      return {
        record:
          null,

        progress:
          null,

        result:
          null,
      };
    }

    const directJobId =
      readString(
        rawValue.jobId
      );

    const payload =
      directJobId
        ? this.payloadByJobId
            .get(
              directJobId
            ) ??
          null
        : null;

    const nestedProgress =
      rawValue.progress;

    const nestedResult =
      rawValue.result;

    const progress =
      normalizeNativeProgress(
        isRecord(
          nestedProgress
        )
          ? nestedProgress
          : rawValue,
        payload,
        timestamp
      );

    const result =
      normalizeNativeJobResult(
        isRecord(
          nestedResult
        )
          ? nestedResult
          : rawValue,
        payload,
        timestamp
      );

    const nestedRecord =
      rawValue.record;

    const record =
      this.normalizePersistedRecord(
        nestedRecord,
        timestamp
      );

    return {
      record,

      progress,

      result,
    };
  }

  /* =======================================================
   * Persisted record normalization
   * ===================================================== */

  private normalizePersistedRecord(
    value:
      unknown,
    timestamp:
      ProcessingTimestamp
  ): NativeProcessingPersistedRecord | null {
    if (
      !isRecord(
        value
      ) ||
      !isRecord(
        value.payload
      )
    ) {
      return null;
    }

    const payload =
      value
        .payload as unknown as
        NativeProcessingJobPayload;

    if (
      payload.contractVersion !==
        NATIVE_PROCESSING_CONTRACT_VERSION ||
      typeof payload.jobId !==
        'string' ||
      payload.jobId.length ===
        0
    ) {
      return null;
    }

    const progress =
      normalizeNativeProgress(
        value.progress,
        payload,
        timestamp
      );

    if (
      !progress
    ) {
      return null;
    }

    const result =
      normalizeNativeJobResult(
        value.result,
        payload,
        timestamp
      );

    return {
      stateVersion:
        1,

      payload,

      progress,

      result,

      createdAt:
        normalizeNativeProcessingTimestamp(
          readFiniteNumber(
            value.createdAt
          ),
          payload.createdAt
        ),

      updatedAt:
        normalizeNativeProcessingTimestamp(
          readFiniteNumber(
            value.updatedAt
          ),
          timestamp
        ),

      revision:
        Math.max(
          0,
          readInteger(
            value.revision,
            0
          )
        ),
    };
  }

  /* =======================================================
   * Event creation
   * ===================================================== */

  private createBridgeEvent(
    eventName:
      NativeProcessingNativeEventName,
    rawValue:
      unknown,
    parsed:
      ParsedNativeProcessingState,
    timestamp:
      ProcessingTimestamp
  ): NativeProcessingEvent | null {
    const rawRecord =
      isRecord(
        rawValue
      )
        ? rawValue
        : null;

    const type =
      eventNameToType(
        eventName
      );

    const jobId =
      parsed.record
        ?.payload
        .jobId ??
      parsed.progress
        ?.jobId ??
      parsed.result
        ?.jobId ??
      readString(
        rawRecord
          ?.jobId
      );

    if (
      !jobId
    ) {
      return null;
    }

    const payload =
      parsed.record
        ?.payload ??
      this.payloadByJobId
        .get(
          jobId
        ) ??
      null;

    const queueId =
      parsed.record
        ?.payload
        .queueId ??
      parsed.progress
        ?.queueId ??
      parsed.result
        ?.queueId ??
      payload
        ?.queueId ??
      readString(
        rawRecord
          ?.queueId
      );

    const batchId =
      parsed.record
        ?.payload
        .batchId ??
      parsed.progress
        ?.batchId ??
      parsed.result
        ?.batchId ??
      payload
        ?.batchId ??
      readString(
        rawRecord
          ?.batchId
      );

    if (
      !queueId ||
      !batchId
    ) {
      return null;
    }

    const eventTimestamp =
      normalizeNativeProcessingTimestamp(
        readFiniteNumber(
          rawRecord
            ?.timestamp ??
          rawRecord
            ?.updatedAt
        ),
        timestamp
      );

    let error =
      parsed.result
        ?.error ??
      null;

    if (
      !error &&
      (
        type ===
          'failed' ||
        type ===
          'expired' ||
        type ===
          'interrupted'
      )
    ) {
      error =
        normalizeNativeProcessingError(
          rawRecord
            ?.error ??
          rawRecord,
          type ===
            'expired'
            ? 'Native processing expired.'
            : type ===
                'interrupted'
              ? 'Native processing was interrupted.'
              : 'Native processing failed.',
          eventTimestamp
        );
    }

    return {
      type,

      jobId,

      queueId,

      batchId,

      timestamp:
        eventTimestamp,

      progress:
        parsed.progress,

      result:
        parsed.result,

      error,
    };
  }

  /* =======================================================
   * Duplicate protection
   * ===================================================== */

  private isDuplicateEvent(
    event:
      NativeProcessingEvent,
    rawValue:
      unknown
  ): boolean {
    if (
      this.allowDuplicateNativeEvents
    ) {
      return false;
    }

    const previous =
      this.latestEventIdentityByJobId
        .get(
          event.jobId
        );

    if (
      !previous
    ) {
      return false;
    }

    const revision =
      isRecord(
        rawValue
      )
        ? readFiniteNumber(
            rawValue.revision
          )
        : null;

    if (
      revision !==
        null &&
      previous.revision !==
        null
    ) {
      return (
        revision <=
        previous.revision
      );
    }

    return (
      previous.type ===
        event.type &&
      previous.timestamp ===
        event.timestamp
    );
  }

  private updateEventIdentity(
    event:
      NativeProcessingEvent,
    rawValue:
      unknown
  ): void {
    const revisionValue =
      isRecord(
        rawValue
      )
        ? readFiniteNumber(
            rawValue.revision
          )
        : null;

    this.latestEventIdentityByJobId
      .set(
        event.jobId,
        {
          jobId:
            event.jobId,

          type:
            event.type,

          timestamp:
            event.timestamp,

          revision:
            revisionValue ===
              null
              ? null
              : Math.max(
                  0,
                  Math.floor(
                    revisionValue
                  )
                ),
        }
      );
  }

  /* =======================================================
   * Event dispatch
   * ===================================================== */

  private emitEvent(
    event:
      NativeProcessingEvent
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
          this.enableDebugLogs
        ) {
          console.warn(
            'TRIPLE N NATIVE PROCESSING EVENT LISTENER ERROR:',
            error
          );
        }
      }
    }
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    NativeProcessingBridgeDiagnostics {
    return {
      ...this.diagnostics,

      warnings: [
        ...this.diagnostics
          .warnings,
      ],
    };
  }

  private updateDiagnostics(
    updates:
      Partial<
        NativeProcessingBridgeDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...updates,

      warnings:
        updates.warnings
          ? [
              ...updates.warnings,
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
        'disposed' ||
      this.state ===
        'disposing'
    ) {
      throw new Error(
        'Native processing bridge has already been disposed.'
      );
    }
  }

  private assertPayload(
    payload:
      NativeProcessingJobPayload
  ): void {
    if (
      payload.contractVersion !==
        NATIVE_PROCESSING_CONTRACT_VERSION
    ) {
      throw new Error(
        `Unsupported native processing contract version: ${String(
          payload.contractVersion
        )}.`
      );
    }

    if (
      typeof payload.jobId !==
        'string' ||
      payload.jobId.trim().length ===
        0
    ) {
      throw new Error(
        'Native processing payload does not contain a valid jobId.'
      );
    }

    if (
      typeof payload.source
        .uri !==
        'string' ||
      payload.source.uri
        .trim()
        .length ===
        0
    ) {
      throw new Error(
        'Native processing payload does not contain a valid source URI.'
      );
    }

    if (
      payload.platform !==
        'ios' &&
      payload.platform !==
        'android'
    ) {
      throw new Error(
        'Native processing payload contains an unsupported platform.'
      );
    }

    if (
      payload.options
        .outputFormat !==
        'png'
    ) {
      throw new Error(
        'Native processing currently supports PNG output only.'
      );
    }
  }
/* =======================================================
   * Scheduled record creation
   * ===================================================== */

  private createScheduledRecord(
    payload:
      NativeProcessingJobPayload,
    scheduleResult?:
      NativeProcessingScheduleResult | null
  ): NativeProcessingPersistedRecord {
    const timestamp =
      scheduleResult
        ?.scheduledAt ??
      this.now();

    const progress:
      NativeProcessingProgress = {
      contractVersion:
        NATIVE_PROCESSING_CONTRACT_VERSION,

      jobId:
        payload.jobId,

      queueId:
        payload.queueId,

      batchId:
        payload.batchId,

      status:
        'queued',

      executorState:
        scheduleResult
          ?.accepted
          ? 'scheduled'
          : 'idle',

      stage:
        'queued',

      progress:
        0,

      percentage:
        0,

      message:
        scheduleResult
          ?.accepted
          ? 'Native processing was scheduled.'
          : 'Waiting for native processing.',

      startedAt:
        null,

      updatedAt:
        timestamp,

      elapsedMs:
        0,

      estimatedRemainingMs:
        null,

      nativeTaskId:
        scheduleResult
          ?.nativeTaskId ??
        null,

      runtime:
        scheduleResult
          ?.runtime ??
        'unknown',

      applicationState:
        'unknown',

      attempt:
        Math.max(
          0,
          Math.floor(
            payload.options
              .currentAttempt
          )
        ),
    };

    return {
      stateVersion:
        1,

      payload,

      progress,

      result:
        null,

      createdAt:
        normalizeNativeProcessingTimestamp(
          payload.createdAt,
          timestamp
        ),

      updatedAt:
        timestamp,

      revision:
        0,
    };
  }

  /* =======================================================
   * Schedule
   * ===================================================== */

  public async schedule(
    request:
      NativeProcessingBridgeScheduleRequest
  ): Promise<
    NativeProcessingScheduleResult
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    const payload =
      request.payload;

    this.assertPayload(
      payload
    );

    const persistBeforeScheduling =
      request
        .persistBeforeScheduling ??
      true;

    const startImmediately =
      request
        .startImmediately ??
      true;

    const timestamp =
      this.now();

    this.updateDiagnostics({
      scheduleCount:
        this.diagnostics
          .scheduleCount +
      1,

      lastOperationAt:
        timestamp,

      lastError:
        null,
    });

    if (
      this.activeJobId &&
      this.activeJobId !==
        payload.jobId
    ) {
      const error =
        createNativeProcessingError(
          {
            code:
              'JOB_ALREADY_RUNNING',

            message:
              `Native processing job "${this.activeJobId}" is already active.`,

            source:
              'scheduler',

            retryable:
              true,

            attempt:
              payload.options
                .currentAttempt,

            stage:
              'queued',

            metadata: {
              activeJobId:
                this.activeJobId,

              requestedJobId:
                payload.jobId,
            },
          },
          timestamp
        );

      this.updateDiagnostics({
        rejectedScheduleCount:
          this.diagnostics
            .rejectedScheduleCount +
        1,

        lastOperationAt:
          timestamp,

        lastError:
          error.message,
      });

      return {
        accepted:
          false,

        jobId:
          payload.jobId,

        nativeTaskId:
          null,

        runtime:
          this.capability
            .runtime,

        scheduledAt:
          null,

        error,
      };
    }

    if (
      !this.nativeModule ||
      this.capability.status !==
        'available'
    ) {
      const error =
        createNativeProcessingError(
          {
            code:
              'BACKGROUND_PROCESSING_UNAVAILABLE',

            message:
              this.capability
                .reason ??
              'Native processing is unavailable on this build or device.',

            source:
              'scheduler',

            retryable:
              false,

            attempt:
              payload.options
                .currentAttempt,

            stage:
              'queued',
          },
          timestamp
        );

      this.updateDiagnostics({
        rejectedScheduleCount:
          this.diagnostics
            .rejectedScheduleCount +
        1,

        lastOperationAt:
          timestamp,

        lastError:
          error.message,
      });

      return {
        accepted:
          false,

        jobId:
          payload.jobId,

        nativeTaskId:
          null,

        runtime:
          this.capability
            .runtime,

        scheduledAt:
          null,

        error,
      };
    }

    this.payloadByJobId.set(
      payload.jobId,
      payload
    );

    const initialRecord =
      this.createScheduledRecord(
        payload,
        null
      );

    this.latestRecordByJobId.set(
      payload.jobId,
      initialRecord
    );

    if (
      persistBeforeScheduling
    ) {
      await this.persistRecordSafely(
        initialRecord
      );
    }

    try {
      const rawResult =
        await this.nativeModule
          .scheduleJob(
            payload
          );

      const scheduleResult =
        normalizeScheduleResult(
          rawResult,
          payload,
          this.now()
        );

      const scheduledRecord =
        this.createScheduledRecord(
          payload,
          scheduleResult
        );

      scheduledRecord.revision =
        initialRecord.revision +
        1;

      scheduledRecord.createdAt =
        initialRecord.createdAt;

      this.latestRecordByJobId.set(
        payload.jobId,
        scheduledRecord
      );

      await this.persistRecordSafely(
        scheduledRecord
      );

      if (
        !scheduleResult.accepted
      ) {
        this.updateDiagnostics({
          rejectedScheduleCount:
            this.diagnostics
              .rejectedScheduleCount +
          1,

          lastOperationAt:
            this.now(),

          lastError:
            scheduleResult
              .error
              ?.message ??
            'Native processing rejected the job.',
        });

        return scheduleResult;
      }

      this.activeJobId =
        payload.jobId;

      this.updateDiagnostics({
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

      if (
        startImmediately &&
        this.nativeModule
          .startJob
      ) {
        await this.start(
          payload.jobId
        );
      }

      return scheduleResult;
    } catch (error) {
      const nativeError =
        normalizeNativeProcessingError(
          error,
          getUnknownErrorMessage(
            error
          ),
          this.now()
        );

      const failedRecord:
        NativeProcessingPersistedRecord = {
        ...initialRecord,

        progress: {
          ...initialRecord
            .progress,

          status:
            'failed',

          executorState:
            'failed',

          stage:
            'failed',

          message:
            nativeError.message,

          updatedAt:
            this.now(),
        },

        result: {
          contractVersion:
            NATIVE_PROCESSING_CONTRACT_VERSION,

          jobId:
            payload.jobId,

          queueId:
            payload.queueId,

          batchId:
            payload.batchId,

          requestId:
            payload.requestId,

          wardrobeItemId:
            payload.wardrobeItemId,

          succeeded:
            false,

          cancelled:
            false,

          expired:
            false,

          interrupted:
            false,

          output:
            null,

          error:
            nativeError,

          runtime:
            this.capability
              .runtime,

          nativeTaskId:
            null,

          startedAt:
            null,

          completedAt:
            this.now(),

          attempt:
            payload.options
              .currentAttempt,
        },

        updatedAt:
          this.now(),

        revision:
          initialRecord.revision +
          1,
      };

      this.latestRecordByJobId.set(
        payload.jobId,
        failedRecord
      );

      await this.persistRecordSafely(
        failedRecord
      );

      this.activeJobId =
        null;

      this.updateDiagnostics({
        rejectedScheduleCount:
          this.diagnostics
            .rejectedScheduleCount +
        1,

        activeJobId:
          null,

        lastOperationAt:
          this.now(),

        lastError:
          nativeError.message,
      });

      return {
        accepted:
          false,

        jobId:
          payload.jobId,

        nativeTaskId:
          null,

        runtime:
          this.capability
            .runtime,

        scheduledAt:
          null,

        error:
          nativeError,
      };
    }
  }

  /* =======================================================
   * Start scheduled job
   * ===================================================== */

  public async start(
    jobId:
      ProcessingJobId
  ): Promise<boolean> {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    if (
      !this.nativeModule ||
      !this.nativeModule
        .startJob
    ) {
      return false;
    }

    if (
      this.activeJobId &&
      this.activeJobId !==
        jobId
    ) {
      throw new Error(
        `Cannot start native processing job "${jobId}" because "${this.activeJobId}" is already active.`
      );
    }

    try {
      const rawResult =
        await this.nativeModule
          .startJob(
            jobId
          );

      const started =
        isRecord(
          rawResult
        )
          ? readBoolean(
              rawResult.started ??
              rawResult.accepted ??
              rawResult.running,
              false
            )
          : rawResult ===
              true;

      if (
        started
      ) {
        this.activeJobId =
          jobId;
      }

      this.updateDiagnostics({
        startCount:
          this.diagnostics
            .startCount +
        1,

        activeJobId:
          this.activeJobId,

        lastOperationAt:
          this.now(),

        lastError:
          started
            ? null
            : 'Native processing did not start the scheduled job.',
      });

      return started;
    } catch (error) {
      this.updateDiagnostics({
        startCount:
          this.diagnostics
            .startCount +
        1,

        lastOperationAt:
          this.now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      throw error;
    }
  }

  /* =======================================================
   * Cancel
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

    const timestamp =
      this.now();

    if (
      !this.nativeModule
    ) {
      const error =
        createNativeProcessingError(
          {
            code:
              'BACKGROUND_PROCESSING_UNAVAILABLE',

            message:
              'The native processing module is unavailable.',

            source:
              'cancellation',

            retryable:
              false,

            stage:
              'cancelled',
          },
          timestamp
        );

      return {
        jobId,

        cancelled:
          false,

        nativeTaskId:
          null,

        result:
          null,

        error,

        cancelledAt:
          timestamp,
      };
    }

    try {
      const rawResult =
        await this.nativeModule
          .cancelJob(
            jobId,
            reason
          );

      const payload =
        this.payloadByJobId
          .get(
            jobId
          ) ??
        null;

      const result =
        normalizeNativeJobResult(
          isRecord(
            rawResult
          ) &&
          rawResult.result !==
            undefined
            ? rawResult.result
            : rawResult,
          payload,
          timestamp
        );

      const cancelled =
        result
          ?.cancelled ===
          true ||
        (
          isRecord(
            rawResult
          ) &&
          readBoolean(
            rawResult.cancelled,
            false
          )
        );

      const nativeTaskId =
        result
          ?.nativeTaskId ??
        (
          isRecord(
            rawResult
          )
            ? readString(
                rawResult.nativeTaskId ??
                rawResult.taskId
              )
            : null
        );

      const error =
        result
          ?.error ??
        (
          cancelled
            ? null
            : createNativeProcessingError(
                {
                  code:
                    'JOB_CANCELLED',

                  message:
                    'Native processing did not confirm cancellation.',

                  source:
                    'cancellation',

                  retryable:
                    false,

                  stage:
                    'cancelled',
                },
                timestamp
              )
        );

      if (
        result
      ) {
        await this.mergeAndPersistEventState(
          {
            type:
              'cancelled',

            jobId:
              result.jobId,

            queueId:
              result.queueId,

            batchId:
              result.batchId,

            timestamp,

            progress:
              null,

            result,

            error:
              result.error,
          },
          {
            record:
              null,

            progress:
              null,

            result,
          }
        );
      }

      if (
        this.activeJobId ===
          jobId
      ) {
        this.activeJobId =
          null;
      }

      this.updateDiagnostics({
        cancelCount:
          this.diagnostics
            .cancelCount +
        1,

        activeJobId:
          this.activeJobId,

        lastOperationAt:
          timestamp,

        lastError:
          error
            ?.message ??
          null,
      });

      return {
        jobId,

        cancelled,

        nativeTaskId,

        result,

        error,

        cancelledAt:
          timestamp,
      };
    } catch (error) {
      const nativeError =
        normalizeNativeProcessingError(
          error,
          getUnknownErrorMessage(
            error
          ),
          timestamp
        );

      this.updateDiagnostics({
        cancelCount:
          this.diagnostics
            .cancelCount +
        1,

        lastOperationAt:
          timestamp,

        lastError:
          nativeError.message,
      });

      return {
        jobId,

        cancelled:
          false,

        nativeTaskId:
          null,

        result:
          null,

        error:
          nativeError,

        cancelledAt:
          timestamp,
      };
    }
  }

  /* =======================================================
   * Local record
   * ===================================================== */

  public async getJobRecord(
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

    if (
      refreshFromNative &&
      this.nativeModule
    ) {
      try {
        const rawState =
          await this.nativeModule
            .getJobState(
              jobId
            );

        const parsed =
          this.parseNativeState(
            rawState,
            this.now()
          );

        if (
          parsed.record
        ) {
          this.latestRecordByJobId.set(
            jobId,
            parsed.record
          );

          this.payloadByJobId.set(
            jobId,
            parsed.record.payload
          );

          await this.persistRecordSafely(
            parsed.record
          );

          return {
            ...parsed.record,
          };
        }

        const existing =
          this.latestRecordByJobId
            .get(
              jobId
            ) ??
          null;

        if (
          existing &&
          (
            parsed.progress ||
            parsed.result
          )
        ) {
          const event:
            NativeProcessingEvent = {
            type:
              parsed.result
                ? parsed.result
                    .succeeded
                  ? 'completed'
                  : parsed.result
                      .cancelled
                    ? 'cancelled'
                    : parsed.result
                        .expired
                      ? 'expired'
                      : parsed.result
                          .interrupted
                        ? 'interrupted'
                        : 'failed'
                : 'progress',

            jobId:
              existing.payload
                .jobId,

            queueId:
              existing.payload
                .queueId,

            batchId:
              existing.payload
                .batchId,

            timestamp:
              this.now(),

            progress:
              parsed.progress,

            result:
              parsed.result,

            error:
              parsed.result
                ?.error ??
              null,
          };

          await this.mergeAndPersistEventState(
            event,
            parsed
          );
        }
      } catch (error) {
        this.updateDiagnostics({
          lastOperationAt:
            this.now(),

          lastError:
            getUnknownErrorMessage(
              error
            ),
        });
      }
    }

    const cached =
      this.latestRecordByJobId
        .get(
          jobId
        );

    if (
      cached
    ) {
      return {
        ...cached,
      };
    }

    if (
      !this.storage
    ) {
      return null;
    }

    try {
      const stored =
        await this.storage
          .getRecord(
            jobId
          );

      this.updateDiagnostics({
        storageReadCount:
          this.diagnostics
            .storageReadCount +
        1,

        lastOperationAt:
          this.now(),
      });

      if (
        stored
      ) {
        this.latestRecordByJobId.set(
          jobId,
          stored
        );

        this.payloadByJobId.set(
          jobId,
          stored.payload
        );
      }

      return stored;
    } catch (error) {
      this.updateDiagnostics({
        storageReadFailureCount:
          this.diagnostics
            .storageReadFailureCount +
        1,

        lastOperationAt:
          this.now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),
      });

      return null;
    }
  }

  /* =======================================================
   * Pending results
   * ===================================================== */

  public async getPendingResults(
    refreshFromNative =
      true
  ): Promise<
    readonly NativeProcessingJobResult[]
  > {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      await this.initialize();
    }

    if (
      refreshFromNative &&
      this.nativeModule
    ) {
      try {
        const rawResults =
          await this.nativeModule
            .getPendingResults();

        if (
          Array.isArray(
            rawResults
          )
        ) {
          for (
            const rawResult of
            rawResults
          ) {
            const jobId =
              isRecord(
                rawResult
              )
                ? readString(
                    rawResult.jobId
                  )
                : null;

            const payload =
              jobId
                ? this.payloadByJobId
                    .get(
                      jobId
                    ) ??
                  null
                : null;

            const result =
              normalizeNativeJobResult(
                rawResult,
                payload,
                this.now()
              );

            if (
              !result
            ) {
              continue;
            }

            const event:
              NativeProcessingEvent = {
              type:
                result.succeeded
                  ? 'completed'
                  : result.cancelled
                    ? 'cancelled'
                    : result.expired
                      ? 'expired'
                      : result.interrupted
                        ? 'interrupted'
                        : 'failed',

              jobId:
                result.jobId,

              queueId:
                result.queueId,

              batchId:
                result.batchId,

              timestamp:
                result.completedAt,

              progress:
                null,

              result,

              error:
                result.error,
            };

            await this.mergeAndPersistEventState(
              event,
              {
                record:
                  null,

                progress:
                  null,

                result,
              }
            );
          }
        }
      } catch (error) {
        this.updateDiagnostics({
          lastOperationAt:
            this.now(),

          lastError:
            getUnknownErrorMessage(
              error
            ),
        });
      }
    }

    return Array.from(
      this.latestRecordByJobId
        .values()
    )
      .map(
        record =>
          record.result
      )
      .filter(
        (
          result
        ): result is NativeProcessingJobResult =>
          result !==
          null
      );
  }

  /* =======================================================
   * Recovery
   * ===================================================== */

  public recover():
    Promise<
      NativeProcessingBridgeRecoveryResult
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
      NativeProcessingBridgeRecoveryResult
    > {
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

    const warnings:
      string[] = [];

    try {
      if (
        this.storage
      ) {
        try {
          const records =
            await this.storage
              .getAllRecords();

          this.updateDiagnostics({
            storageReadCount:
              this.diagnostics
                .storageReadCount +
            1,
          });

          for (
            const record of
            records
          ) {
            this.latestRecordByJobId.set(
              record.payload.jobId,
              record
            );

            this.payloadByJobId.set(
              record.payload.jobId,
              record.payload
            );
          }
        } catch (error) {
          appendUniqueWarning(
            warnings,
            `Could not read local native-processing records during recovery: ${getUnknownErrorMessage(
              error
            )}`
          );

          this.updateDiagnostics({
            storageReadFailureCount:
              this.diagnostics
                .storageReadFailureCount +
            1,
          });
        }
      }

      const nativeJobIds =
        new Set<
          ProcessingJobId
        >();

      if (
        this.nativeModule
      ) {
        try {
          const rawStates =
            await this.nativeModule
              .getAllJobStates();

          if (
            Array.isArray(
              rawStates
            )
          ) {
            for (
              const rawState of
              rawStates
            ) {
              const parsed =
                this.parseNativeState(
                  rawState,
                  this.now()
                );

              const jobId =
                parsed.record
                  ?.payload
                  .jobId ??
                parsed.progress
                  ?.jobId ??
                parsed.result
                  ?.jobId ??
                (
                  isRecord(
                    rawState
                  )
                    ? readString(
                        rawState.jobId
                      )
                    : null
                );

              if (
                !jobId
              ) {
                continue;
              }

              nativeJobIds.add(
                jobId
              );

              if (
                parsed.record
              ) {
                this.latestRecordByJobId.set(
                  jobId,
                  parsed.record
                );

                this.payloadByJobId.set(
                  jobId,
                  parsed.record
                    .payload
                );

                await this.persistRecordSafely(
                  parsed.record
                );

                continue;
              }

              const existing =
                this.latestRecordByJobId
                  .get(
                    jobId
                  );

              if (
                !existing
              ) {
                continue;
              }

              const event:
                NativeProcessingEvent = {
                type:
                  parsed.result
                    ? parsed.result
                        .succeeded
                      ? 'completed'
                      : parsed.result
                          .cancelled
                        ? 'cancelled'
                        : parsed.result
                            .expired
                          ? 'expired'
                          : parsed.result
                              .interrupted
                            ? 'interrupted'
                            : 'failed'
                    : 'progress',

                jobId:
                  existing.payload
                    .jobId,

                queueId:
                  existing.payload
                    .queueId,

                batchId:
                  existing.payload
                    .batchId,

                timestamp:
                  this.now(),

                progress:
                  parsed.progress,

                result:
                  parsed.result,

                error:
                  parsed.result
                    ?.error ??
                  null,
              };

              await this.mergeAndPersistEventState(
                event,
                parsed
              );
            }
          }
        } catch (error) {
          appendUniqueWarning(
            warnings,
            `Could not read native job states during recovery: ${getUnknownErrorMessage(
              error
            )}`
          );
        }
      }

      const pendingResults =
        await this.getPendingResults(
          true
        );

      const missingNativeJobIds:
        ProcessingJobId[] = [];

      if (
        this.nativeModule
      ) {
        for (
          const [
            jobId,
            record,
          ] of this.latestRecordByJobId
        ) {
          if (
            record.result ||
            nativeJobIds.has(
              jobId
            )
          ) {
            continue;
          }

          missingNativeJobIds.push(
            jobId
          );
        }
      }

      const recovered =
        Array.from(
          this.latestRecordByJobId
            .values()
        );

      this.state =
        'ready';

      this.updateDiagnostics({
        state:
          'ready',

        lastRecoveredAt:
          recoveredAt,

        lastOperationAt:
          this.now(),

        lastError:
          null,

        warnings,
      });

      return {
        recovered,

        pendingResults,

        missingNativeJobIds,

        warnings,

        recoveredAt,
      };
    } catch (error) {
      this.state =
        'failed';

      this.updateDiagnostics({
        state:
          'failed',

        lastOperationAt:
          this.now(),

        lastError:
          getUnknownErrorMessage(
            error
          ),

        warnings,
      });

      throw error;
    }
  }

  /* =======================================================
   * Result acknowledgement
   * ===================================================== */

  public async acknowledgeResult(
    jobId:
      ProcessingJobId
  ): Promise<
    NativeProcessingBridgeAcknowledgementResult
  > {
    this.assertNotDisposed();

    const timestamp =
      this.now();

    let removedFromNative =
      false;

    let removedFromLocalStorage =
      false;

    try {
      if (
        this.nativeModule
          ?.acknowledgeResult
      ) {
        await this.nativeModule
          .acknowledgeResult(
            jobId
          );
      }

      if (
        this
          .removeNativeRecordAfterAcknowledgement &&
        this.nativeModule
          ?.removeJob
      ) {
        await this.nativeModule
          .removeJob(
            jobId
          );

        removedFromNative =
          true;
      }

      if (
        this
          .removeLocalRecordAfterAcknowledgement
      ) {
        this.latestRecordByJobId.delete(
          jobId
        );

        this.payloadByJobId.delete(
          jobId
        );

        this.latestEventIdentityByJobId.delete(
          jobId
        );

        if (
          this.storage
        ) {
          await this.storage
            .removeRecord(
              jobId
            );
        }

        removedFromLocalStorage =
          true;
      }

      this.updateDiagnostics({
        acknowledgeCount:
          this.diagnostics
            .acknowledgeCount +
        1,

        lastOperationAt:
          timestamp,

        lastError:
          null,
      });

      return {
        jobId,

        acknowledged:
          true,

        removedFromNative,

        removedFromLocalStorage,

        acknowledgedAt:
          timestamp,

        error:
          null,
      };
    } catch (error) {
      const nativeError =
        normalizeNativeProcessingError(
          error,
          getUnknownErrorMessage(
            error
          ),
          timestamp
        );

      this.updateDiagnostics({
        acknowledgeCount:
          this.diagnostics
            .acknowledgeCount +
        1,

        lastOperationAt:
          timestamp,

        lastError:
          nativeError.message,
      });

      return {
        jobId,

        acknowledged:
          false,

        removedFromNative,

        removedFromLocalStorage,

        acknowledgedAt:
          timestamp,

        error:
          nativeError,
      };
    }
  }

  /* =======================================================
   * Event state merge
   * ===================================================== */

  private async mergeAndPersistEventState(
    event:
      NativeProcessingEvent,
    parsed:
      ParsedNativeProcessingState
  ): Promise<void> {
    const existing =
      this.latestRecordByJobId
        .get(
          event.jobId
        ) ??
      null;

    const payload =
      existing
        ?.payload ??
      this.payloadByJobId
        .get(
          event.jobId
        ) ??
      null;

    if (
      !payload
    ) {
      return;
    }

    const timestamp =
      event.timestamp;

    const baseRecord =
      existing ??
      this.createScheduledRecord(
        payload,
        null
      );

    let progress =
      parsed.progress ??
      event.progress ??
      baseRecord.progress;

    const result =
      parsed.result ??
      event.result ??
      baseRecord.result;

    if (
      result
    ) {
      const status:
        ProcessingJobStatus =
        result.succeeded
          ? 'completed'
          : result.cancelled
            ? 'cancelled'
            : result.interrupted
              ? 'interrupted'
              : 'failed';

      const executorState:
        NativeProcessingExecutorState =
        result.succeeded
          ? 'completed'
          : result.cancelled
            ? 'cancelled'
            : result.expired
              ? 'expired'
              : result.interrupted
                ? 'interrupted'
                : 'failed';

      const stage:
        ProcessingJobStage =
        result.succeeded
          ? 'complete'
          : result.cancelled
            ? 'cancelled'
            : 'failed';

      progress = {
        ...progress,

        status,

        executorState,

        stage,

        progress:
          result.succeeded
            ? 1
            : progress.progress,

        percentage:
          result.succeeded
            ? 100
            : progress.percentage,

        message:
          result.succeeded
            ? 'Native processing completed.'
            : result.error
                ?.message ??
              (
                result.cancelled
                  ? 'Native processing was cancelled.'
                  : result.expired
                    ? 'Native processing expired.'
                    : result.interrupted
                      ? 'Native processing was interrupted.'
                      : 'Native processing failed.'
              ),

        nativeTaskId:
          result.nativeTaskId ??
          progress.nativeTaskId,

        runtime:
          result.runtime,

        updatedAt:
          result.completedAt,

        attempt:
          result.attempt,
      };
    } else {
      switch (
        event.type
      ) {
        case 'scheduled':
          progress = {
            ...progress,

            status:
              'queued',

            executorState:
              'scheduled',

            stage:
              'queued',

            updatedAt:
              timestamp,
          };
          break;

        case 'started':
          progress = {
            ...progress,

            status:
              'processing',

            executorState:
              'running',

            startedAt:
              progress.startedAt ??
              timestamp,

            updatedAt:
              timestamp,
          };
          break;

        case 'suspended':
          progress = {
            ...progress,

            status:
              'paused',

            executorState:
              'suspended',

            updatedAt:
              timestamp,
          };
          break;

        case 'resumed':
          progress = {
            ...progress,

            status:
              'processing',

            executorState:
              'running',

            updatedAt:
              timestamp,
          };
          break;

        case 'interrupted':
          progress = {
            ...progress,

            status:
              'interrupted',

            executorState:
              'interrupted',

            stage:
              'failed',

            message:
              event.error
                ?.message ??
              'Native processing was interrupted.',

            updatedAt:
              timestamp,
          };
          break;

        case 'expired':
          progress = {
            ...progress,

            status:
              'failed',

            executorState:
              'expired',

            stage:
              'failed',

            message:
              event.error
                ?.message ??
              'Native processing expired.',

            updatedAt:
              timestamp,
          };
          break;

        case 'failed':
          progress = {
            ...progress,

            status:
              'failed',

            executorState:
              'failed',

            stage:
              'failed',

            message:
              event.error
                ?.message ??
              'Native processing failed.',

            updatedAt:
              timestamp,
          };
          break;

        case 'cancelled':
          progress = {
            ...progress,

            status:
              'cancelled',

            executorState:
              'cancelled',

            stage:
              'cancelled',

            message:
              event.error
                ?.message ??
              'Native processing was cancelled.',

            updatedAt:
              timestamp,
          };
          break;

        case 'completed':
          progress = {
            ...progress,

            status:
              'completed',

            executorState:
              'completed',

            stage:
              'complete',

            progress:
              1,

            percentage:
              100,

            message:
              'Native processing completed.',

            updatedAt:
              timestamp,
          };
          break;

        case 'progress':
          break;
      }
    }

    const mergedRecord:
      NativeProcessingPersistedRecord = {
      stateVersion:
        baseRecord
          .stateVersion,

      payload,

      progress: {
        ...progress,

        progress:
          clampNativeProcessingProgress(
            progress.progress
          ),

        percentage:
          nativeProcessingPercentage(
            progress.progress
          ),

        updatedAt:
          normalizeNativeProcessingTimestamp(
            progress.updatedAt,
            timestamp
          ),
      },

      result,

      createdAt:
        baseRecord.createdAt,

      updatedAt:
        Math.max(
          baseRecord.updatedAt,
          timestamp,
          progress.updatedAt,
          result
            ?.completedAt ??
          0
        ),

      revision:
        baseRecord.revision +
        1,
    };

    this.latestRecordByJobId.set(
      event.jobId,
      mergedRecord
    );

    this.payloadByJobId.set(
      event.jobId,
      payload
    );

    await this.persistRecordSafely(
      mergedRecord
    );
  }

  /* =======================================================
   * Safe persistence
   * ===================================================== */

  private async persistRecordSafely(
    record:
      NativeProcessingPersistedRecord
  ): Promise<void> {
    if (
      !this.storage
    ) {
      return;
    }

    try {
      await this.storage
        .saveRecord(
          record
        );

      this.updateDiagnostics({
        storageWriteCount:
          this.diagnostics
            .storageWriteCount +
        1,

        lastOperationAt:
          this.now(),
      });
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      this.updateDiagnostics({
        storageWriteFailureCount:
          this.diagnostics
            .storageWriteFailureCount +
        1,

        lastOperationAt:
          this.now(),

        lastError:
          message,
      });

      if (
        this.enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE PROCESSING STORAGE WRITE ERROR:',
          error
        );
      }
    }
  }

  /* =======================================================
   * Clear completed records
   * ===================================================== */

  public async clearCompletedRecords():
    Promise<void> {
    this.assertNotDisposed();

    if (
      this.nativeModule
        ?.clearCompletedJobs
    ) {
      await this.nativeModule
        .clearCompletedJobs();
    }

    if (
      this.storage
        ?.clearCompletedRecords
    ) {
      await this.storage
        .clearCompletedRecords();
    }

    for (
      const [
        jobId,
        record,
      ] of Array.from(
        this.latestRecordByJobId
          .entries()
      )
    ) {
      if (
        record.result
      ) {
        this.latestRecordByJobId.delete(
          jobId
        );

        this.payloadByJobId.delete(
          jobId
        );

        this.latestEventIdentityByJobId.delete(
          jobId
        );
      }
    }

    this.updateDiagnostics({
      lastOperationAt:
        this.now(),

      lastError:
        null,
    });
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

    try {
      await this.operationTail
        .catch(
          () => {
            // لا نمنع التنظيف بسبب عملية سابقة فاشلة.
          }
        );

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

      this.eventListeners.clear();

      if (
        this.nativeModule
          ?.dispose
      ) {
        try {
          await this.nativeModule
            .dispose();
        } catch (error) {
          if (
            this.enableDebugLogs
          ) {
            console.warn(
              'TRIPLE N NATIVE PROCESSING MODULE DISPOSE ERROR:',
              error
            );
          }
        }
      }
    } finally {
      this.activeJobId =
        null;

      this.payloadByJobId.clear();

      this.latestRecordByJobId.clear();

      this.latestEventIdentityByJobId.clear();

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

        listenerCount:
          0,

        eventListenerCount:
          0,

        activeJobId:
          null,

        lastOperationAt:
          this.now(),
      });
    }
  }
}

/* =========================================================
 * Factory
 * ======================================================= */

export function createNativeProcessingBridge(
  options:
    NativeProcessingBridgeOptions =
      {}
): NativeProcessingBridge {
  return new NativeProcessingBridge(
    options
  );
}

/* =========================================================
 * Shared instance
 * ======================================================= */

let sharedNativeProcessingBridge:
  NativeProcessingBridge | null =
    null;

export function getSharedNativeProcessingBridge(
  options:
    NativeProcessingBridgeOptions =
      {}
): NativeProcessingBridge {
  if (
    !sharedNativeProcessingBridge
  ) {
    sharedNativeProcessingBridge =
      createNativeProcessingBridge(
        options
      );
  }

  return sharedNativeProcessingBridge;
}

export async function disposeSharedNativeProcessingBridge():
  Promise<void> {
  const bridge =
    sharedNativeProcessingBridge;

  sharedNativeProcessingBridge =
    null;

  if (
    bridge
  ) {
    await bridge.dispose();
  }
}

export default
  NativeProcessingBridge;