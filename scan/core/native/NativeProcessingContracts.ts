// scan/core/native/NativeProcessingContracts.ts
//
// Triple N - Native Scan Item Processing Contracts
//
// هذا الملف هو العقد المشترك بين:
//
// - JavaScript Queue
// - iOS Native background execution
// - Android Native background execution
//
// الهدف:
//
// 1) إرسال Job صغيرة وقابلة للتخزين إلى Native.
// 2) عدم إرسال SegmentationResult أو TypedArrays.
// 3) حفظ تقدم Native بشكل مستقل.
// 4) استرجاع النتيجة بعد عودة JavaScript.
// 5) منع تشغيل أكثر من Job ثقيلة في الوقت نفسه.
// 6) دعم interruption / retry / recovery.
//
// هذا الملف لا يشغّل EdgeSAM.
// لا يستخدم React Native.
// لا يستخدم AsyncStorage.
// لا يستدعي Swift أو Kotlin مباشرة.

import type {
    ProcessingBatchId,
    ProcessingJobErrorCode,
    ProcessingJobId,
    ProcessingJobStage,
    ProcessingJobStatus,
    ProcessingPlatform,
    ProcessingQueueId,
    ProcessingRequestId,
    ProcessingTimestamp,
    ProcessingWardrobeItemId,
} from '../queue/QueueTypes';

/* =========================================================
 * Versions
 * ======================================================= */

export const NATIVE_PROCESSING_CONTRACT_VERSION =
  1 as const;

export const NATIVE_PROCESSING_STATE_VERSION =
  1 as const;

export type NativeProcessingContractVersion =
  typeof NATIVE_PROCESSING_CONTRACT_VERSION;

export type NativeProcessingStateVersion =
  typeof NATIVE_PROCESSING_STATE_VERSION;

/* =========================================================
 * Native runtime
 * ======================================================= */

export type NativeProcessingRuntime =
  | 'ios-bg-processing'
  | 'ios-continued-processing'
  | 'android-work-manager'
  | 'android-foreground-service'
  | 'foreground-fallback'
  | 'unknown';

export type NativeProcessingExecutorState =
  | 'idle'
  | 'scheduled'
  | 'starting'
  | 'running'
  | 'suspending'
  | 'suspended'
  | 'resuming'
  | 'finishing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'interrupted';

export type NativeProcessingApplicationState =
  | 'active'
  | 'inactive'
  | 'background'
  | 'locked'
  | 'terminated'
  | 'unknown';

/* =========================================================
 * Image source
 * ======================================================= */

export type NativeProcessingImageSource = {
  uri:
    string;

  width:
    number | null;

  height:
    number | null;

  orientation:
    number | null;

  format:
    string;

  fileName:
    string | null;

  mimeType:
    string | null;

  fileSizeBytes:
    number | null;

  sourceId:
    string;

  createdAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Wardrobe context
 * ======================================================= */

export type NativeProcessingWardrobeContext = {
  wardrobeType:
    'male' | 'female' | null;

  category:
    string | null;

  subcategory:
    string | null;

  itemName:
    string | null;

  color:
    string | null;

  style:
    string | null;

  season:
    string | null;

  occasion:
    string | null;

  isFavorite:
    boolean;
};

/* =========================================================
 * Processing options
 * ======================================================= */

export type NativeProcessingOptions = {
  outputDirectoryUri:
    string | null;

  outputFileName:
    string;

  outputFormat:
    'png';

  outputQuality:
    number;

  maximumAttempts:
    number;

  currentAttempt:
    number;

  collectDiagnostics:
    boolean;

  preserveSourceFile:
    boolean;

  replaceExistingOutput:
    boolean;

  allowForegroundFallback:
    boolean;
};

/* =========================================================
 * Job payload
 * ======================================================= */

/**
 * النسخة الوحيدة التي يسمح بإرسالها إلى Native.
 *
 * ممنوع إضافة:
 *
 * - SegmentationResult
 * - Float32Array
 * - Uint8Array
 * - Image Embedding
 * - Decoder outputs
 * - Alpha mask data
 */
export type NativeProcessingJobPayload = {
  contractVersion:
    NativeProcessingContractVersion;

  jobId:
    ProcessingJobId;

  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId;

  requestId:
    ProcessingRequestId;

  wardrobeItemId:
    ProcessingWardrobeItemId;

  platform:
    ProcessingPlatform;

  priority:
    number;

  source:
    NativeProcessingImageSource;

  wardrobe:
    NativeProcessingWardrobeContext;

  options:
    NativeProcessingOptions;

  createdAt:
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
 * Progress
 * ======================================================= */

export type NativeProcessingProgress = {
  contractVersion:
    NativeProcessingContractVersion;

  jobId:
    ProcessingJobId;

  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId;

  status:
    ProcessingJobStatus;

  executorState:
    NativeProcessingExecutorState;

  stage:
    ProcessingJobStage;

  progress:
    number;

  percentage:
    number;

  message:
    string;

  startedAt:
    ProcessingTimestamp | null;

  updatedAt:
    ProcessingTimestamp;

  elapsedMs:
    number;

  estimatedRemainingMs:
    number | null;

  nativeTaskId:
    string | null;

  runtime:
    NativeProcessingRuntime;

  applicationState:
    NativeProcessingApplicationState;

  attempt:
    number;
};

/* =========================================================
 * Output
 * ======================================================= */

export type NativeProcessingOutput = {
  processedImageUri:
    string;

  width:
    number;

  height:
    number;

  format:
    'png';

  fileSizeBytes:
    number | null;

  foregroundRatio:
    number | null;

  processingDurationMs:
    number;

  completedAt:
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
 * Error
 * ======================================================= */

export type NativeProcessingErrorSource =
  | 'scheduler'
  | 'source'
  | 'model'
  | 'encoder'
  | 'decoder'
  | 'postprocessor'
  | 'export'
  | 'storage'
  | 'wardrobe'
  | 'expiration'
  | 'cancellation'
  | 'unknown';

export type NativeProcessingError = {
  code:
    ProcessingJobErrorCode;

  message:
    string;

  source:
    NativeProcessingErrorSource;

  retryable:
    boolean;

  occurredAt:
    ProcessingTimestamp;

  attempt:
    number;

  stage:
    ProcessingJobStage | null;

  nativeCode:
    string | null;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Result
 * ======================================================= */

export type NativeProcessingJobResult = {
  contractVersion:
    NativeProcessingContractVersion;

  jobId:
    ProcessingJobId;

  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId;

  requestId:
    ProcessingRequestId;

  wardrobeItemId:
    ProcessingWardrobeItemId;

  succeeded:
    boolean;

  cancelled:
    boolean;

  expired:
    boolean;

  interrupted:
    boolean;

  output:
    NativeProcessingOutput | null;

  error:
    NativeProcessingError | null;

  runtime:
    NativeProcessingRuntime;

  nativeTaskId:
    string | null;

  startedAt:
    ProcessingTimestamp | null;

  completedAt:
    ProcessingTimestamp;

  attempt:
    number;
};

/* =========================================================
 * Persisted native record
 * ======================================================= */

export type NativeProcessingPersistedRecord = {
  stateVersion:
    NativeProcessingStateVersion;

  payload:
    NativeProcessingJobPayload;

  progress:
    NativeProcessingProgress;

  result:
    NativeProcessingJobResult | null;

  createdAt:
    ProcessingTimestamp;

  updatedAt:
    ProcessingTimestamp;

  revision:
    number;
};

/* =========================================================
 * Scheduler result
 * ======================================================= */

export type NativeProcessingScheduleResult = {
  accepted:
    boolean;

  jobId:
    ProcessingJobId;

  nativeTaskId:
    string | null;

  runtime:
    NativeProcessingRuntime;

  scheduledAt:
    ProcessingTimestamp | null;

  error:
    NativeProcessingError | null;
};

/* =========================================================
 * Capability
 * ======================================================= */

export type NativeProcessingCapabilityStatus =
  | 'available'
  | 'unavailable'
  | 'restricted'
  | 'unsupported'
  | 'unknown';

export type NativeProcessingCapabilityResult = {
  platform:
    ProcessingPlatform;

  status:
    NativeProcessingCapabilityStatus;

  runtime:
    NativeProcessingRuntime;

  supportsLockedScreenExecution:
    boolean;

  supportsTerminatedAppExecution:
    boolean;

  supportsProgressUpdates:
    boolean;

  supportsCancellation:
    boolean;

  maximumConcurrentJobs:
    1;

  reason:
    string | null;

  checkedAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Events
 * ======================================================= */

export type NativeProcessingEventType =
  | 'scheduled'
  | 'started'
  | 'progress'
  | 'suspended'
  | 'resumed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'interrupted';

export type NativeProcessingEvent = {
  type:
    NativeProcessingEventType;

  jobId:
    ProcessingJobId;

  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId;

  timestamp:
    ProcessingTimestamp;

  progress:
    NativeProcessingProgress | null;

  result:
    NativeProcessingJobResult | null;

  error:
    NativeProcessingError | null;
};

export type NativeProcessingEventListener = (
  event:
    NativeProcessingEvent
) => void;

/* =========================================================
 * Helpers
 * ======================================================= */

export function clampNativeProcessingProgress(
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

export function nativeProcessingPercentage(
  progress:
    number
): number {
  return Math.round(
    clampNativeProcessingProgress(
      progress
    ) *
      100
  );
}

export function normalizeNativeProcessingTimestamp(
  value:
    number | null | undefined,
  fallback =
    Date.now()
): ProcessingTimestamp {
  if (
    typeof value !==
      'number' ||
    !Number.isFinite(
      value
    ) ||
    value <=
      0
  ) {
    return Math.max(
      1,
      Math.floor(
        fallback
      )
    );
  }

  return Math.floor(
    value
  );
}

export function normalizeNativeProcessingDuration(
  value:
    number | null | undefined
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
    return 0;
  }

  return Math.floor(
    value
  );
}

export function createInitialNativeProcessingProgress(
  payload:
    NativeProcessingJobPayload
): NativeProcessingProgress {
  const timestamp =
    Date.now();

  return {
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
      'scheduled',

    stage:
      'queued',

    progress:
      0,

    percentage:
      0,

    message:
      'Waiting for native processing.',

    startedAt:
      null,

    updatedAt:
      timestamp,

    elapsedMs:
      0,

    estimatedRemainingMs:
      null,

    nativeTaskId:
      null,

    runtime:
      'unknown',

    applicationState:
      'unknown',

    attempt:
      payload.options
        .currentAttempt,
  };
}

export function createNativeProcessingPersistedRecord(
  payload:
    NativeProcessingJobPayload
): NativeProcessingPersistedRecord {
  const timestamp =
    Date.now();

  return {
    stateVersion:
      NATIVE_PROCESSING_STATE_VERSION,

    payload,

    progress:
      createInitialNativeProcessingProgress(
        payload
      ),

    result:
      null,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    revision:
      0,
  };
}

/* =========================================================
 * Validation
 * ======================================================= */

export function isNativeProcessingJobPayload(
  value:
    unknown
): value is NativeProcessingJobPayload {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    return false;
  }

  const candidate =
    value as Partial<
      NativeProcessingJobPayload
    >;

  return (
    candidate.contractVersion ===
      NATIVE_PROCESSING_CONTRACT_VERSION &&
    typeof candidate.jobId ===
      'string' &&
    candidate.jobId.length >
      0 &&
    typeof candidate.queueId ===
      'string' &&
    candidate.queueId.length >
      0 &&
    typeof candidate.batchId ===
      'string' &&
    candidate.batchId.length >
      0 &&
    typeof candidate.requestId ===
      'string' &&
    candidate.requestId.length >
      0 &&
    typeof candidate.wardrobeItemId ===
      'string' &&
    candidate.wardrobeItemId.length >
      0 &&
    typeof candidate.source ===
      'object' &&
    candidate.source !==
      null &&
    typeof candidate.source.uri ===
      'string' &&
    candidate.source.uri.trim().length >
      0 &&
    typeof candidate.options ===
      'object' &&
    candidate.options !==
      null &&
    candidate.options.outputFormat ===
      'png'
  );
}

export function isNativeProcessingJobResult(
  value:
    unknown
): value is NativeProcessingJobResult {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    return false;
  }

  const candidate =
    value as Partial<
      NativeProcessingJobResult
    >;

  return (
    candidate.contractVersion ===
      NATIVE_PROCESSING_CONTRACT_VERSION &&
    typeof candidate.jobId ===
      'string' &&
    candidate.jobId.length >
      0 &&
    typeof candidate.succeeded ===
      'boolean' &&
    typeof candidate.completedAt ===
      'number' &&
    Number.isFinite(
      candidate.completedAt
    )
  );
}