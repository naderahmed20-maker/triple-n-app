// scan/core/queue/QueueTypes.ts
//
// Triple N - Local Scan Item Processing Queue Types
//
// هذا الملف هو المرجع الأساسي والنهائي لكل عقود
// Queue معالجة صور Scan Item.
//
// مسؤوليات الملف:
//
// 1) تعريف حالات الـJob.
// 2) تعريف بيانات الصورة الأصلية والنتيجة النهائية.
// 3) تعريف تقدم معالجة كل صورة.
// 4) تعريف تقدم الدولاب بالكامل.
// 5) تعريف الأخطاء وإعادة المحاولة.
// 6) تعريف بيانات التخزين الدائم.
// 7) تعريف العقود المشتركة بين React Native وiOS وAndroid.
// 8) توفير أدوات التحقق والتطبيع والنسخ الآمن.
//
// هذا الملف لا يشغّل المعالجة فعليًا.
// لا يستخدم AsyncStorage.
// لا يشغّل EdgeSAM.
// لا يرسل إشعارات.
//
// الملفات القادمة ستعتمد عليه:
//
// - QueueStorage.ts
// - QueueEvents.ts
// - ProcessingQueue.ts
// - TimeEstimator.ts
// - ScanItemQueueService.ts
// - BackgroundProcessingService.ts
// - واجهة الدولاب
// - Native iOS
// - Native Android

import type {
    SegmentationErrorCode,
    SegmentationImageFormat,
    SegmentationPipelineStage,
    SegmentationProgressEvent,
    SegmentationResult,
    SegmentationSource,
} from '../ai/types';

/* =========================================================
 * Constants
 * ======================================================= */

export const PROCESSING_QUEUE_SCHEMA_VERSION =
  1 as const;

export const PROCESSING_QUEUE_STORAGE_VERSION =
  1 as const;

export const DEFAULT_QUEUE_ITEM_PROGRESS =
  0;

export const COMPLETE_QUEUE_ITEM_PROGRESS =
  1;

export const MINIMUM_QUEUE_ITEM_PROGRESS =
  0;

export const MAXIMUM_QUEUE_ITEM_PROGRESS =
  1;

export const DEFAULT_ESTIMATED_ITEM_PROCESSING_MS =
  100_000;

export const DEFAULT_QUEUE_MAXIMUM_ATTEMPTS =
  3;

export const DEFAULT_QUEUE_RETRY_DELAY_MS =
  1_500;

export const DEFAULT_MAXIMUM_QUEUE_ITEMS =
  100;

export const QUEUE_TERMINAL_STATUSES =
  [
    'completed',
    'failed',
    'cancelled',
  ] as const;

export const QUEUE_ACTIVE_STATUSES =
  [
    'preparing',
    'processing',
    'finalizing',
  ] as const;

export const QUEUE_PENDING_STATUSES =
  [
    'queued',
    'paused',
    'interrupted',
    'retry-scheduled',
  ] as const;

/* =========================================================
 * Primitive types
 * ======================================================= */

export type ProcessingQueueSchemaVersion =
  typeof PROCESSING_QUEUE_SCHEMA_VERSION;

export type ProcessingQueueStorageVersion =
  typeof PROCESSING_QUEUE_STORAGE_VERSION;

export type ProcessingQueueId =
  string;

export type ProcessingJobId =
  string;

export type ProcessingBatchId =
  string;

export type ProcessingWardrobeItemId =
  string;

export type ProcessingRequestId =
  string;

export type ProcessingTimestamp =
  number;

export type ProcessingDurationMs =
  number;

export type ProcessingProgress =
  number;

export type ProcessingQueuePosition =
  number;

/* =========================================================
 * Platform and execution
 * ======================================================= */

export type ProcessingPlatform =
  | 'ios'
  | 'android'
  | 'unknown';

export type ProcessingExecutionMode =
  | 'foreground'
  | 'background'
  | 'restored'
  | 'unknown';

export type ProcessingExecutor =
  | 'javascript'
  | 'ios-native'
  | 'android-native'
  | 'unknown';

export type ProcessingBackgroundCapability =
  | 'available'
  | 'unavailable'
  | 'restricted'
  | 'unknown';

export type ProcessingApplicationState =
  | 'active'
  | 'inactive'
  | 'background'
  | 'terminated'
  | 'unknown';

/* =========================================================
 * Queue status
 * ======================================================= */

export type ProcessingQueueStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'recovering'
  | 'disposed';

/* =========================================================
 * Job status
 * ======================================================= */

export type ProcessingJobStatus =
  | 'queued'
  | 'preparing'
  | 'processing'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'interrupted'
  | 'retry-scheduled';

/* =========================================================
 * Processing stage
 * ======================================================= */

export type ProcessingJobStage =
  | 'queued'
  | 'load-source'
  | 'validate-source'
  | 'prepare-segmentation'
  | SegmentationPipelineStage
  | 'export-transparent-image'
  | 'save-processed-image'
  | 'update-wardrobe-item'
  | 'complete'
  | 'failed'
  | 'cancelled';

/* =========================================================
 * Job source
 * ======================================================= */

export type ProcessingJobSourceKind =
  | 'camera'
  | 'photo-library'
  | 'file'
  | 'unknown';

export type ProcessingImageSource = {
  /**
   * URI المحلية الأصلية للصورة.
   */
  uri: string;

  /**
   * مصدر الصورة داخل Scan Item.
   */
  kind: ProcessingJobSourceKind;

  width:
    number | null;

  height:
    number | null;

  format:
    SegmentationImageFormat;

  orientation:
    number | null;

  fileName:
    string | null;

  mimeType:
    string | null;

  fileSizeBytes:
    number | null;

  assetId:
    string | null;

  /**
   * معرف داخلي للصورة داخل EdgeSAM.
   */
  segmentationSourceId:
    string | null;

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
 * Wardrobe metadata
 * ======================================================= */

export type ProcessingWardrobeMetadata = {
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

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Output
 * ======================================================= */

export type ProcessingJobOutput = {
  /**
   * URI الصورة النهائية الشفافة.
   */
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

  completedAt:
    ProcessingTimestamp;

  /**
   * نتيجة EdgeSAM لا يتم حفظها داخل AsyncStorage.
   *
   * هذا الحقل يستخدم أثناء التشغيل فقط،
   * ثم يتم حذفه قبل التخزين الدائم.
   */
  segmentationResult?:
    SegmentationResult;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Retry information
 * ======================================================= */

export type ProcessingRetryPolicy = {
  maximumAttempts:
    number;

  baseDelayMs:
    number;

  maximumDelayMs:
    number;

  backoffMultiplier:
    number;

  retryOnApplicationResume:
    boolean;

  retryOnBackgroundRestart:
    boolean;

  retryableErrorCodes:
    readonly SegmentationErrorCode[];
};

export type ProcessingRetryState = {
  attempt:
    number;

  maximumAttempts:
    number;

  nextRetryAt:
    ProcessingTimestamp | null;

  previousRetryAt:
    ProcessingTimestamp | null;

  retryScheduled:
    boolean;

  exhausted:
    boolean;
};

/* =========================================================
 * Job error
 * ======================================================= */

export type ProcessingJobErrorSource =
  | 'queue'
  | 'storage'
  | 'image-source'
  | 'segmentation'
  | 'export'
  | 'wardrobe'
  | 'notification'
  | 'ios-background'
  | 'android-background'
  | 'unknown';

export type ProcessingJobErrorCode =
  | SegmentationErrorCode
  | 'QUEUE_NOT_INITIALIZED'
  | 'QUEUE_DISPOSED'
  | 'QUEUE_CAPACITY_EXCEEDED'
  | 'JOB_NOT_FOUND'
  | 'JOB_ALREADY_EXISTS'
  | 'JOB_ALREADY_RUNNING'
  | 'JOB_NOT_RETRYABLE'
  | 'JOB_CANCELLED'
  | 'JOB_INTERRUPTED'
  | 'INVALID_JOB'
  | 'INVALID_SOURCE_URI'
  | 'SOURCE_FILE_NOT_FOUND'
  | 'SOURCE_FILE_UNREADABLE'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_DATA_INVALID'
  | 'EXPORT_FAILED'
  | 'PROCESSED_IMAGE_NOT_FOUND'
  | 'WARDROBE_ITEM_CREATE_FAILED'
  | 'WARDROBE_ITEM_UPDATE_FAILED'
  | 'BACKGROUND_PROCESSING_UNAVAILABLE'
  | 'BACKGROUND_PROCESSING_START_FAILED'
  | 'BACKGROUND_PROCESSING_EXPIRED'
  | 'BACKGROUND_PROCESSING_STOPPED'
  | 'NOTIFICATION_PERMISSION_DENIED'
  | 'NOTIFICATION_SEND_FAILED'
  | 'UNKNOWN_QUEUE_ERROR';

export type ProcessingJobError = {
  code:
    ProcessingJobErrorCode;

  message:
    string;

  source:
    ProcessingJobErrorSource;

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

  segmentationErrorCode:
    SegmentationErrorCode | null;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Job progress
 * ======================================================= */

export type ProcessingJobProgress = {
  /**
   * القيمة من 0 إلى 1.
   */
  progress:
    ProcessingProgress;

  /**
   * القيمة من 0 إلى 100 للعرض فقط.
   */
  percentage:
    number;

  stage:
    ProcessingJobStage;

  message:
    string;

  updatedAt:
    ProcessingTimestamp;

  elapsedMs:
    ProcessingDurationMs;

  estimatedRemainingMs:
    ProcessingDurationMs | null;

  segmentationProgress:
    SegmentationProgressEvent | null;
};

/* =========================================================
 * Job timing
 * ======================================================= */

export type ProcessingJobTiming = {
  createdAt:
    ProcessingTimestamp;

  queuedAt:
    ProcessingTimestamp;

  startedAt:
    ProcessingTimestamp | null;

  lastUpdatedAt:
    ProcessingTimestamp;

  pausedAt:
    ProcessingTimestamp | null;

  interruptedAt:
    ProcessingTimestamp | null;

  completedAt:
    ProcessingTimestamp | null;

  failedAt:
    ProcessingTimestamp | null;

  cancelledAt:
    ProcessingTimestamp | null;

  totalProcessingMs:
    ProcessingDurationMs;

  lastAttemptDurationMs:
    ProcessingDurationMs;

  estimatedProcessingMs:
    ProcessingDurationMs;
};

/* =========================================================
 * Native background state
 * ======================================================= */

export type ProcessingNativeBackgroundState = {
  platform:
    ProcessingPlatform;

  capability:
    ProcessingBackgroundCapability;

  executor:
    ProcessingExecutor;

  executionMode:
    ProcessingExecutionMode;

  nativeTaskId:
    string | null;

  nativeJobId:
    string | null;

  startedAt:
    ProcessingTimestamp | null;

  lastHeartbeatAt:
    ProcessingTimestamp | null;

  expirationAt:
    ProcessingTimestamp | null;

  applicationState:
    ProcessingApplicationState;

  isRunning:
    boolean;

  wasInterrupted:
    boolean;

  interruptionReason:
    string | null;
};

/* =========================================================
 * Complete job
 * ======================================================= */

export type ProcessingJob = {
  schemaVersion:
    ProcessingQueueSchemaVersion;

  id:
    ProcessingJobId;

  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId;

  requestId:
    ProcessingRequestId;

  wardrobeItemId:
    ProcessingWardrobeItemId;

  status:
    ProcessingJobStatus;

  source:
    ProcessingImageSource;

  wardrobe:
    ProcessingWardrobeMetadata;

  output:
    ProcessingJobOutput | null;

  progress:
    ProcessingJobProgress;

  timing:
    ProcessingJobTiming;

  retry:
    ProcessingRetryState;

  retryPolicy:
    ProcessingRetryPolicy;

  background:
    ProcessingNativeBackgroundState;

  error:
    ProcessingJobError | null;

  queuePosition:
    ProcessingQueuePosition;

  priority:
    number;

  cancellationRequested:
    boolean;

  deletionRequested:
    boolean;

  persist:
    boolean;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Serializable job
 * ======================================================= */

/**
 * النسخة التي يمكن حفظها في AsyncStorage.
 *
 * SegmentationResult لا تُخزّن لأنها تحتوي
 * TypedArrays كبيرة جدًا.
 */
export type StoredProcessingJobOutput =
  Omit<
    ProcessingJobOutput,
    'segmentationResult'
  >;

export type StoredProcessingJob =
  Omit<
    ProcessingJob,
    'output'
  > & {
    output:
      StoredProcessingJobOutput | null;
  };

/* =========================================================
 * Queue configuration
 * ======================================================= */

export type ProcessingQueueConfig = {
  queueId:
    ProcessingQueueId;

  maximumItems:
    number;

  concurrency:
    1;

  automaticStart:
    boolean;

  continueAfterJobFailure:
    boolean;

  pauseWhenApplicationTerminates:
    boolean;

  resumeInterruptedJobs:
    boolean;

  persistAfterEveryChange:
    boolean;

  estimatedItemProcessingMs:
    ProcessingDurationMs;

  retryPolicy:
    ProcessingRetryPolicy;

  enableNotifications:
    boolean;

  notifyWhenSingleItemCompletes:
    boolean;

  notifyWhenBatchCompletes:
    boolean;
};

/* =========================================================
 * Queue timing
 * ======================================================= */

export type ProcessingQueueTiming = {
  createdAt:
    ProcessingTimestamp;

  startedAt:
    ProcessingTimestamp | null;

  lastUpdatedAt:
    ProcessingTimestamp;

  completedAt:
    ProcessingTimestamp | null;

  totalActiveMs:
    ProcessingDurationMs;

  estimatedRemainingMs:
    ProcessingDurationMs | null;
};

/* =========================================================
 * Queue statistics
 * ======================================================= */

export type ProcessingQueueStatistics = {
  total:
    number;

  queued:
    number;

  preparing:
    number;

  processing:
    number;

  finalizing:
    number;

  completed:
    number;

  failed:
    number;

  cancelled:
    number;

  paused:
    number;

  interrupted:
    number;

  retryScheduled:
    number;

  active:
    number;

  pending:
    number;

  terminal:
    number;

  overallProgress:
    ProcessingProgress;

  overallPercentage:
    number;

  averageCompletedItemMs:
    ProcessingDurationMs | null;

  estimatedRemainingMs:
    ProcessingDurationMs | null;
};

/* =========================================================
 * Queue snapshot
 * ======================================================= */

export type ProcessingQueueSnapshot = {
  schemaVersion:
    ProcessingQueueSchemaVersion;

  queueId:
    ProcessingQueueId;

  status:
    ProcessingQueueStatus;

  jobs:
    readonly ProcessingJob[];

  activeJobId:
    ProcessingJobId | null;

  currentBatchId:
    ProcessingBatchId | null;

  config:
    ProcessingQueueConfig;

  statistics:
    ProcessingQueueStatistics;

  timing:
    ProcessingQueueTiming;

  lastError:
    ProcessingJobError | null;

  revision:
    number;

  restoredFromStorage:
    boolean;
};

/* =========================================================
 * Stored queue snapshot
 * ======================================================= */

export type StoredProcessingQueueSnapshot = {
  storageVersion:
    ProcessingQueueStorageVersion;

  schemaVersion:
    ProcessingQueueSchemaVersion;

  queueId:
    ProcessingQueueId;

  status:
    ProcessingQueueStatus;

  jobs:
    readonly StoredProcessingJob[];

  activeJobId:
    ProcessingJobId | null;

  currentBatchId:
    ProcessingBatchId | null;

  config:
    ProcessingQueueConfig;

  timing:
    ProcessingQueueTiming;

  lastError:
    ProcessingJobError | null;

  revision:
    number;

  savedAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Queue summary for UI
 * ======================================================= */

export type ProcessingQueueSummary = {
  queueId:
    ProcessingQueueId;

  status:
    ProcessingQueueStatus;

  totalItems:
    number;

  completedItems:
    number;

  failedItems:
    number;

  pendingItems:
    number;

  activeJobId:
    ProcessingJobId | null;

  overallProgress:
    ProcessingProgress;

  overallPercentage:
    number;

  estimatedRemainingMs:
    ProcessingDurationMs | null;

  isActive:
    boolean;

  isComplete:
    boolean;

  hasFailures:
    boolean;
};

/* =========================================================
 * Wardrobe processing presentation
 * ======================================================= */

export type WardrobeProcessingStatus =
  | ProcessingJobStatus;

export type WardrobeProcessingItem = {
  wardrobeItemId:
    ProcessingWardrobeItemId;

  queueJobId:
    ProcessingJobId;

  batchId:
    ProcessingBatchId;

  originalImageUri:
    string;

  processedImageUri:
    string | null;

  status:
    WardrobeProcessingStatus;

  progress:
    ProcessingProgress;

  percentage:
    number;

  stage:
    ProcessingJobStage;

  message:
    string;

  queuePosition:
    ProcessingQueuePosition;

  estimatedRemainingMs:
    ProcessingDurationMs | null;

  errorMessage:
    string | null;

  canRetry:
    boolean;

  canCancel:
    boolean;

  createdAt:
    ProcessingTimestamp;

  completedAt:
    ProcessingTimestamp | null;
};

/* =========================================================
 * Batch
 * ======================================================= */

export type ProcessingBatchStatus =
  | 'collecting'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'completed-with-errors'
  | 'cancelled';

export type ProcessingBatch = {
  id:
    ProcessingBatchId;

  status:
    ProcessingBatchStatus;

  jobIds:
    readonly ProcessingJobId[];

  createdAt:
    ProcessingTimestamp;

  startedAt:
    ProcessingTimestamp | null;

  completedAt:
    ProcessingTimestamp | null;

  totalItems:
    number;

  completedItems:
    number;

  failedItems:
    number;

  cancelledItems:
    number;

  overallProgress:
    ProcessingProgress;

  estimatedRemainingMs:
    ProcessingDurationMs | null;

  notificationSent:
    boolean;
};

/* =========================================================
 * Requests
 * ======================================================= */

export type CreateProcessingJobRequest = {
  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId;

  wardrobeItemId:
    ProcessingWardrobeItemId;

  source:
    ProcessingImageSource;

  wardrobe:
    ProcessingWardrobeMetadata;

  priority?:
    number;

  metadata?:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type EnqueueProcessingJobsRequest = {
  jobs:
    readonly CreateProcessingJobRequest[];

  startImmediately?:
    boolean;
};

export type RetryProcessingJobRequest = {
  jobId:
    ProcessingJobId;

  resetAttemptCount?:
    boolean;

  startImmediately?:
    boolean;
};

export type CancelProcessingJobRequest = {
  jobId:
    ProcessingJobId;

  reason?:
    string;

  deleteWardrobePlaceholder?:
    boolean;
};

export type RemoveProcessingJobRequest = {
  jobId:
    ProcessingJobId;

  deleteSourceFile?:
    boolean;

  deleteProcessedFile?:
    boolean;
};

export type UpdateProcessingJobProgressRequest = {
  jobId:
    ProcessingJobId;

  progress:
    ProcessingProgress;

  stage:
    ProcessingJobStage;

  message:
    string;

  segmentationProgress?:
    SegmentationProgressEvent | null;

  estimatedRemainingMs?:
    ProcessingDurationMs | null;
};

export type CompleteProcessingJobRequest = {
  jobId:
    ProcessingJobId;

  output:
    ProcessingJobOutput;
};

export type FailProcessingJobRequest = {
  jobId:
    ProcessingJobId;

  error:
    ProcessingJobError;
};

/* =========================================================
 * Results
 * ======================================================= */

export type EnqueueProcessingJobsResult = {
  accepted:
    readonly ProcessingJob[];

  rejected:
    readonly {
      request:
        CreateProcessingJobRequest;

      error:
        ProcessingJobError;
    }[];

  snapshot:
    ProcessingQueueSnapshot;
};

export type ProcessingJobExecutionResult = {
  job:
    ProcessingJob;

  succeeded:
    boolean;

  output:
    ProcessingJobOutput | null;

  error:
    ProcessingJobError | null;

  segmentationSource:
    SegmentationSource | null;
};

/* =========================================================
 * Queue events
 * ======================================================= */

export type ProcessingQueueEventType =
  | 'queue-initialized'
  | 'queue-restored'
  | 'queue-started'
  | 'queue-paused'
  | 'queue-resumed'
  | 'queue-stopped'
  | 'queue-completed'
  | 'queue-failed'
  | 'queue-updated'
  | 'job-added'
  | 'job-started'
  | 'job-progress'
  | 'job-paused'
  | 'job-interrupted'
  | 'job-retry-scheduled'
  | 'job-completed'
  | 'job-failed'
  | 'job-cancelled'
  | 'job-removed'
  | 'batch-created'
  | 'batch-completed'
  | 'background-started'
  | 'background-stopped'
  | 'background-expired'
  | 'storage-saved'
  | 'storage-failed';

export type ProcessingQueueEvent = {
  type:
    ProcessingQueueEventType;

  queueId:
    ProcessingQueueId;

  jobId:
    ProcessingJobId | null;

  batchId:
    ProcessingBatchId | null;

  timestamp:
    ProcessingTimestamp;

  snapshot:
    ProcessingQueueSnapshot;

  job:
    ProcessingJob | null;

  error:
    ProcessingJobError | null;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type ProcessingQueueEventListener = (
  event: ProcessingQueueEvent
) => void;

/* =========================================================
 * Native bridge contracts
 * ======================================================= */

export type NativeBackgroundJobPayload = {
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

  sourceUri:
    string;

  outputDirectoryUri:
    string | null;

  priority:
    number;

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

export type NativeBackgroundJobProgress = {
  jobId:
    ProcessingJobId;

  status:
    ProcessingJobStatus;

  stage:
    ProcessingJobStage;

  progress:
    ProcessingProgress;

  percentage:
    number;

  message:
    string;

  updatedAt:
    ProcessingTimestamp;

  nativeTaskId:
    string | null;
};

export type NativeBackgroundJobResult = {
  jobId:
    ProcessingJobId;

  succeeded:
    boolean;

  processedImageUri:
    string | null;

  width:
    number | null;

  height:
    number | null;

  completedAt:
    ProcessingTimestamp;

  errorCode:
    ProcessingJobErrorCode | null;

  errorMessage:
    string | null;

  retryable:
    boolean;
};

export type NativeBackgroundQueueState = {
  platform:
    ProcessingPlatform;

  capability:
    ProcessingBackgroundCapability;

  running:
    boolean;

  activeJobId:
    ProcessingJobId | null;

  nativeTaskId:
    string | null;

  pendingJobCount:
    number;

  updatedAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Notification contracts
 * ======================================================= */

export type ProcessingNotificationKind =
  | 'processing-started'
  | 'processing-progress'
  | 'single-item-completed'
  | 'batch-completed'
  | 'batch-completed-with-errors'
  | 'processing-failed';

export type ProcessingNotificationPayload = {
  kind:
    ProcessingNotificationKind;

  title:
    string;

  body:
    string;

  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId | null;

  jobId:
    ProcessingJobId | null;

  overallProgress:
    ProcessingProgress | null;

  completedItems:
    number | null;

  totalItems:
    number | null;

  route:
    string | null;

  data:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Default values
 * ======================================================= */

export const DEFAULT_RETRYABLE_SEGMENTATION_ERROR_CODES:
  readonly SegmentationErrorCode[] =
  [
    'IMAGE_LOAD_FAILED',
    'IMAGE_DECODE_FAILED',
    'IMAGE_RESIZE_FAILED',
    'PIXEL_READ_FAILED',
    'TENSOR_CREATION_FAILED',
    'ENCODER_TENSOR_CREATION_FAILED',
    'PROMPT_GENERATION_FAILED',
    'DECODER_INPUT_CREATION_FAILED',
    'MODEL_COPY_FAILED',
    'ENCODER_SESSION_CREATE_FAILED',
    'DECODER_SESSION_CREATE_FAILED',
    'SESSION_CREATE_FAILED',
    'SESSION_NOT_READY',
    'SESSION_BUSY',
    'ENCODER_INFERENCE_FAILED',
    'DECODER_INFERENCE_FAILED',
    'INFERENCE_FAILED',
    'INFERENCE_TIMEOUT',
    'EMBEDDING_CACHE_FAILED',
    'MASK_CANDIDATE_READ_FAILED',
    'NO_MASK_CANDIDATES',
    'NO_VALID_MASK_CANDIDATE',
    'MASK_SELECTION_FAILED',
    'MASK_PROCESSING_FAILED',
    'OUT_OF_MEMORY',
    'ENGINE_BUSY',
    'UNKNOWN',
  ];

export const DEFAULT_PROCESSING_RETRY_POLICY:
  ProcessingRetryPolicy = {
    maximumAttempts:
      DEFAULT_QUEUE_MAXIMUM_ATTEMPTS,

    baseDelayMs:
      DEFAULT_QUEUE_RETRY_DELAY_MS,

    maximumDelayMs:
      30_000,

    backoffMultiplier:
      2,

    retryOnApplicationResume:
      true,

    retryOnBackgroundRestart:
      true,

    retryableErrorCodes:
      DEFAULT_RETRYABLE_SEGMENTATION_ERROR_CODES,
  };

export const DEFAULT_PROCESSING_QUEUE_CONFIG:
  ProcessingQueueConfig = {
    queueId:
      'triple-n-scan-item-queue',

    maximumItems:
      DEFAULT_MAXIMUM_QUEUE_ITEMS,

    concurrency:
      1,

    automaticStart:
      true,

    continueAfterJobFailure:
      true,

    pauseWhenApplicationTerminates:
      true,

    resumeInterruptedJobs:
      true,

    persistAfterEveryChange:
      true,

    estimatedItemProcessingMs:
      DEFAULT_ESTIMATED_ITEM_PROCESSING_MS,

    retryPolicy:
      DEFAULT_PROCESSING_RETRY_POLICY,

    enableNotifications:
      true,

    notifyWhenSingleItemCompletes:
      false,

    notifyWhenBatchCompletes:
      true,
  };

/* =========================================================
 * Numeric helpers
 * ======================================================= */

export function clampProcessingProgress(
  value: number
): ProcessingProgress {
  if (!Number.isFinite(value)) {
    return MINIMUM_QUEUE_ITEM_PROGRESS;
  }

  return Math.min(
    MAXIMUM_QUEUE_ITEM_PROGRESS,
    Math.max(
      MINIMUM_QUEUE_ITEM_PROGRESS,
      value
    )
  );
}

export function processingProgressToPercentage(
  progress: ProcessingProgress
): number {
  return Math.round(
    clampProcessingProgress(progress) *
      100
  );
}

export function normalizeProcessingDuration(
  value: number | null | undefined
): ProcessingDurationMs {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return 0;
  }

  return Math.floor(value);
}

export function normalizeProcessingTimestamp(
  value: number | null | undefined,
  fallback = Date.now()
): ProcessingTimestamp {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return Math.max(
      1,
      Math.floor(fallback)
    );
  }

  return Math.floor(value);
}

export function normalizeQueuePosition(
  value: number
): ProcessingQueuePosition {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    return 0;
  }

  return Math.floor(value);
}

/* =========================================================
 * Identifier helpers
 * ======================================================= */

function createRandomIdentifierPart(
  length:
    number
): string {
  return Math.random()
    .toString(36)
    .slice(
      2,
      2 +
        Math.max(
          4,
          Math.floor(length)
        )
    );
}

export function createProcessingJobId():
  ProcessingJobId {
  return [
    'scan-job',
    Date.now().toString(36),
    createRandomIdentifierPart(8),
  ].join('-');
}

export function createProcessingBatchId():
  ProcessingBatchId {
  return [
    'scan-batch',
    Date.now().toString(36),
    createRandomIdentifierPart(8),
  ].join('-');
}

export function createProcessingRequestId(
  jobId:
    ProcessingJobId
): ProcessingRequestId {
  return [
    'queue-request',
    jobId,
    createRandomIdentifierPart(6),
  ].join('-');
}

export function createTemporaryWardrobeItemId():
  ProcessingWardrobeItemId {
  return [
    'pending-wardrobe-item',
    Date.now().toString(36),
    createRandomIdentifierPart(8),
  ].join('-');
}

/* =========================================================
 * Status helpers
 * ======================================================= */

export function isProcessingJobTerminal(
  status:
    ProcessingJobStatus
): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

export function isProcessingJobActive(
  status:
    ProcessingJobStatus
): boolean {
  return (
    status === 'preparing' ||
    status === 'processing' ||
    status === 'finalizing'
  );
}

export function isProcessingJobPending(
  status:
    ProcessingJobStatus
): boolean {
  return (
    status === 'queued' ||
    status === 'paused' ||
    status === 'interrupted' ||
    status === 'retry-scheduled'
  );
}

export function canRetryProcessingJob(
  job:
    ProcessingJob
): boolean {
  return (
    job.status === 'failed' &&
    job.error?.retryable === true &&
    !job.retry.exhausted &&
    job.retry.attempt <
      job.retry.maximumAttempts
  );
}

export function canCancelProcessingJob(
  job:
    ProcessingJob
): boolean {
  return !isProcessingJobTerminal(
    job.status
  );
}

/* =========================================================
 * Factory helpers
 * ======================================================= */

export function createInitialProcessingJobProgress(
  createdAt =
    Date.now()
): ProcessingJobProgress {
  const timestamp =
    normalizeProcessingTimestamp(
      createdAt
    );

  return {
    progress:
      DEFAULT_QUEUE_ITEM_PROGRESS,

    percentage:
      0,

    stage:
      'queued',

    message:
      'Waiting to be processed.',

    updatedAt:
      timestamp,

    elapsedMs:
      0,

    estimatedRemainingMs:
      DEFAULT_ESTIMATED_ITEM_PROCESSING_MS,

    segmentationProgress:
      null,
  };
}

export function createInitialProcessingRetryState(
  policy:
    ProcessingRetryPolicy =
      DEFAULT_PROCESSING_RETRY_POLICY
): ProcessingRetryState {
  return {
    attempt:
      0,

    maximumAttempts:
      Math.max(
        1,
        Math.floor(
          policy.maximumAttempts
        )
      ),

    nextRetryAt:
      null,

    previousRetryAt:
      null,

    retryScheduled:
      false,

    exhausted:
      false,
  };
}

export function createInitialNativeBackgroundState(
  platform:
    ProcessingPlatform =
      'unknown'
): ProcessingNativeBackgroundState {
  return {
    platform,

    capability:
      'unknown',

    executor:
      'unknown',

    executionMode:
      'foreground',

    nativeTaskId:
      null,

    nativeJobId:
      null,

    startedAt:
      null,

    lastHeartbeatAt:
      null,

    expirationAt:
      null,

    applicationState:
      'unknown',

    isRunning:
      false,

    wasInterrupted:
      false,

    interruptionReason:
      null,
  };
}

export function createProcessingJob(
  request:
    CreateProcessingJobRequest,
  config:
    ProcessingQueueConfig =
      DEFAULT_PROCESSING_QUEUE_CONFIG,
  now =
    Date.now()
): ProcessingJob {
  const createdAt =
    normalizeProcessingTimestamp(
      now
    );

  const jobId =
    createProcessingJobId();

  return {
    schemaVersion:
      PROCESSING_QUEUE_SCHEMA_VERSION,

    id:
      jobId,

    queueId:
      request.queueId,

    batchId:
      request.batchId,

    requestId:
      createProcessingRequestId(
        jobId
      ),

    wardrobeItemId:
      request.wardrobeItemId,

    status:
      'queued',

    source: {
      ...request.source,

      metadata: {
        ...request.source.metadata,
      },
    },

    wardrobe: {
      ...request.wardrobe,

      metadata: {
        ...request.wardrobe.metadata,
      },
    },

    output:
      null,

    progress:
      createInitialProcessingJobProgress(
        createdAt
      ),

    timing: {
      createdAt,

      queuedAt:
        createdAt,

      startedAt:
        null,

      lastUpdatedAt:
        createdAt,

      pausedAt:
        null,

      interruptedAt:
        null,

      completedAt:
        null,

      failedAt:
        null,

      cancelledAt:
        null,

      totalProcessingMs:
        0,

      lastAttemptDurationMs:
        0,

      estimatedProcessingMs:
        normalizeProcessingDuration(
          config
            .estimatedItemProcessingMs
        ),
    },

    retry:
      createInitialProcessingRetryState(
        config.retryPolicy
      ),

    retryPolicy: {
      ...config.retryPolicy,

      retryableErrorCodes:
        [
          ...config
            .retryPolicy
            .retryableErrorCodes,
        ],
    },

    background:
      createInitialNativeBackgroundState(),

    error:
      null,

    queuePosition:
      0,

    priority:
      Number.isFinite(
        request.priority
      )
        ? Math.floor(
            request.priority as number
          )
        : 0,

    cancellationRequested:
      false,

    deletionRequested:
      false,

    persist:
      true,

    metadata: {
      ...(request.metadata ?? {}),
    },
  };
}

/* =========================================================
 * Statistics helpers
 * ======================================================= */

export function createEmptyQueueStatistics():
  ProcessingQueueStatistics {
  return {
    total: 0,

    queued: 0,

    preparing: 0,

    processing: 0,

    finalizing: 0,

    completed: 0,

    failed: 0,

    cancelled: 0,

    paused: 0,

    interrupted: 0,

    retryScheduled: 0,

    active: 0,

    pending: 0,

    terminal: 0,

    overallProgress: 0,

    overallPercentage: 0,

    averageCompletedItemMs: null,

    estimatedRemainingMs: null,
  };
}

export function calculateQueueStatistics(
  jobs:
    readonly ProcessingJob[],
  fallbackEstimatedItemMs =
    DEFAULT_ESTIMATED_ITEM_PROCESSING_MS
): ProcessingQueueStatistics {
  const statistics =
    createEmptyQueueStatistics();

  let totalProgress =
    0;

  let completedDurationTotal =
    0;

  let completedDurationCount =
    0;

  for (const job of jobs) {
    statistics.total +=
      1;

    totalProgress +=
      clampProcessingProgress(
        job.progress.progress
      );

    switch (job.status) {
      case 'queued':
        statistics.queued +=
          1;
        break;

      case 'preparing':
        statistics.preparing +=
          1;
        break;

      case 'processing':
        statistics.processing +=
          1;
        break;

      case 'finalizing':
        statistics.finalizing +=
          1;
        break;

      case 'completed':
        statistics.completed +=
          1;

        if (
          job.timing
            .totalProcessingMs >
          0
        ) {
          completedDurationTotal +=
            job.timing
              .totalProcessingMs;

          completedDurationCount +=
            1;
        }
        break;

      case 'failed':
        statistics.failed +=
          1;
        break;

      case 'cancelled':
        statistics.cancelled +=
          1;
        break;

      case 'paused':
        statistics.paused +=
          1;
        break;

      case 'interrupted':
        statistics.interrupted +=
          1;
        break;

      case 'retry-scheduled':
        statistics.retryScheduled +=
          1;
        break;

      default:
        break;
    }
  }

  statistics.active =
    statistics.preparing +
    statistics.processing +
    statistics.finalizing;

  statistics.pending =
    statistics.queued +
    statistics.paused +
    statistics.interrupted +
    statistics.retryScheduled;

  statistics.terminal =
    statistics.completed +
    statistics.failed +
    statistics.cancelled;

  statistics.overallProgress =
    statistics.total > 0
      ? clampProcessingProgress(
          totalProgress /
            statistics.total
        )
      : 0;

  statistics.overallPercentage =
    processingProgressToPercentage(
      statistics.overallProgress
    );

  statistics.averageCompletedItemMs =
    completedDurationCount > 0
      ? Math.round(
          completedDurationTotal /
            completedDurationCount
        )
      : null;

  const estimatedItemMs =
    statistics
      .averageCompletedItemMs ??
    normalizeProcessingDuration(
      fallbackEstimatedItemMs
    );

  const remainingEquivalentItems =
    jobs.reduce(
      (
        total,
        job
      ) =>
        total +
        (
          1 -
          clampProcessingProgress(
            job.progress.progress
          )
        ),
      0
    );

  statistics.estimatedRemainingMs =
    statistics.total ===
      statistics.terminal
      ? 0
      : Math.max(
          0,
          Math.round(
            remainingEquivalentItems *
              estimatedItemMs
          )
        );

  return statistics;
}

/* =========================================================
 * Snapshot helpers
 * ======================================================= */

export function createInitialQueueSnapshot(
  config:
    ProcessingQueueConfig =
      DEFAULT_PROCESSING_QUEUE_CONFIG,
  now =
    Date.now()
): ProcessingQueueSnapshot {
  const createdAt =
    normalizeProcessingTimestamp(
      now
    );

  const clonedConfig:
    ProcessingQueueConfig = {
      ...config,

      retryPolicy: {
        ...config.retryPolicy,

        retryableErrorCodes:
          [
            ...config
              .retryPolicy
              .retryableErrorCodes,
          ],
      },
    };

  return {
    schemaVersion:
      PROCESSING_QUEUE_SCHEMA_VERSION,

    queueId:
      clonedConfig.queueId,

    status:
      'idle',

    jobs:
      [],

    activeJobId:
      null,

    currentBatchId:
      null,

    config:
      clonedConfig,

    statistics:
      createEmptyQueueStatistics(),

    timing: {
      createdAt,

      startedAt:
        null,

      lastUpdatedAt:
        createdAt,

      completedAt:
        null,

      totalActiveMs:
        0,

      estimatedRemainingMs:
        null,
    },

    lastError:
      null,

    revision:
      0,

    restoredFromStorage:
      false,
  };
}

export function createQueueSummary(
  snapshot:
    ProcessingQueueSnapshot
): ProcessingQueueSummary {
  const statistics =
    snapshot.statistics;

  return {
    queueId:
      snapshot.queueId,

    status:
      snapshot.status,

    totalItems:
      statistics.total,

    completedItems:
      statistics.completed,

    failedItems:
      statistics.failed,

    pendingItems:
      statistics.pending +
      statistics.active,

    activeJobId:
      snapshot.activeJobId,

    overallProgress:
      statistics.overallProgress,

    overallPercentage:
      statistics.overallPercentage,

    estimatedRemainingMs:
      statistics.estimatedRemainingMs,

    isActive:
      statistics.active >
        0 ||
      snapshot.status ===
        'running',

    isComplete:
      statistics.total >
        0 &&
      statistics.terminal ===
        statistics.total,

    hasFailures:
      statistics.failed >
      0,
  };
}

/* =========================================================
 * Storage conversion helpers
 * ======================================================= */

export function toStoredProcessingJob(
  job:
    ProcessingJob
): StoredProcessingJob {
  const storedOutput:
    StoredProcessingJobOutput | null =
      job.output
        ? {
            processedImageUri:
              job.output
                .processedImageUri,

            width:
              job.output.width,

            height:
              job.output.height,

            format:
              job.output.format,

            fileSizeBytes:
              job.output
                .fileSizeBytes,

            completedAt:
              job.output
                .completedAt,

            metadata: {
              ...job.output
                .metadata,
            },
          }
        : null;

  return {
    ...job,

    source: {
      ...job.source,

      metadata: {
        ...job.source
          .metadata,
      },
    },

    wardrobe: {
      ...job.wardrobe,

      metadata: {
        ...job.wardrobe
          .metadata,
      },
    },

    output:
      storedOutput,

    progress: {
      ...job.progress,

      segmentationProgress:
        job.progress
          .segmentationProgress
          ? {
              ...job.progress
                .segmentationProgress,

              metadata:
                job.progress
                  .segmentationProgress
                  .metadata
                  ? {
                      ...job
                        .progress
                        .segmentationProgress
                        .metadata,
                    }
                  : undefined,
            }
          : null,
    },

    timing: {
      ...job.timing,
    },

    retry: {
      ...job.retry,
    },

    retryPolicy: {
      ...job.retryPolicy,

      retryableErrorCodes:
        [
          ...job
            .retryPolicy
            .retryableErrorCodes,
        ],
    },

    background: {
      ...job.background,
    },

    error:
      job.error
        ? {
            ...job.error,

            metadata: {
              ...job.error
                .metadata,
            },
          }
        : null,

    metadata: {
      ...job.metadata,
    },
  };
}

export function restoreProcessingJob(
  storedJob:
    StoredProcessingJob
): ProcessingJob {
  return {
    ...storedJob,

    source: {
      ...storedJob.source,

      metadata: {
        ...storedJob.source
          .metadata,
      },
    },

    wardrobe: {
      ...storedJob.wardrobe,

      metadata: {
        ...storedJob.wardrobe
          .metadata,
      },
    },

    output:
      storedJob.output
        ? {
            ...storedJob.output,

            metadata: {
              ...storedJob.output
                .metadata,
            },
          }
        : null,

    progress: {
      ...storedJob.progress,

      progress:
        clampProcessingProgress(
          storedJob
            .progress
            .progress
        ),

      percentage:
        processingProgressToPercentage(
          storedJob
            .progress
            .progress
        ),
    },

    timing: {
      ...storedJob.timing,
    },

    retry: {
      ...storedJob.retry,
    },

    retryPolicy: {
      ...storedJob.retryPolicy,

      retryableErrorCodes:
        [
          ...storedJob
            .retryPolicy
            .retryableErrorCodes,
        ],
    },

    background: {
      ...storedJob.background,

      isRunning:
        false,

      wasInterrupted:
        isProcessingJobActive(
          storedJob.status
        )
          ? true
          : storedJob
              .background
              .wasInterrupted,

      interruptionReason:
        isProcessingJobActive(
          storedJob.status
        )
          ? 'Application execution was interrupted.'
          : storedJob
              .background
              .interruptionReason,
    },

    status:
      isProcessingJobActive(
        storedJob.status
      )
        ? 'interrupted'
        : storedJob.status,

    error:
      storedJob.error
        ? {
            ...storedJob.error,

            metadata: {
              ...storedJob.error
                .metadata,
            },
          }
        : null,

    metadata: {
      ...storedJob.metadata,
    },
  };
}

/* =========================================================
 * Wardrobe presentation helpers
 * ======================================================= */

export function toWardrobeProcessingItem(
  job:
    ProcessingJob
): WardrobeProcessingItem {
  return {
    wardrobeItemId:
      job.wardrobeItemId,

    queueJobId:
      job.id,

    batchId:
      job.batchId,

    originalImageUri:
      job.source.uri,

    processedImageUri:
      job.output
        ?.processedImageUri ??
      null,

    status:
      job.status,

    progress:
      clampProcessingProgress(
        job.progress.progress
      ),

    percentage:
      processingProgressToPercentage(
        job.progress.progress
      ),

    stage:
      job.progress.stage,

    message:
      job.progress.message,

    queuePosition:
      job.queuePosition,

    estimatedRemainingMs:
      job.progress
        .estimatedRemainingMs,

    errorMessage:
      job.error?.message ??
      null,

    canRetry:
      canRetryProcessingJob(
        job
      ),

    canCancel:
      canCancelProcessingJob(
        job
      ),

    createdAt:
      job.timing.createdAt,

    completedAt:
      job.timing.completedAt,
  };
}

/* =========================================================
 * Validation helpers
 * ======================================================= */

export function isProcessingJobStatus(
  value:
    unknown
): value is ProcessingJobStatus {
  return (
    value === 'queued' ||
    value === 'preparing' ||
    value === 'processing' ||
    value === 'finalizing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'paused' ||
    value === 'interrupted' ||
    value === 'retry-scheduled'
  );
}

export function isProcessingQueueStatus(
  value:
    unknown
): value is ProcessingQueueStatus {
  return (
    value === 'idle' ||
    value === 'running' ||
    value === 'paused' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'recovering' ||
    value === 'disposed'
  );
}

export function isValidProcessingImageSource(
  value:
    unknown
): value is ProcessingImageSource {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const possibleSource =
    value as Partial<
      ProcessingImageSource
    >;

  return (
    typeof possibleSource.uri ===
      'string' &&
    possibleSource.uri.trim().length >
      0 &&
    (
      possibleSource.kind ===
        'camera' ||
      possibleSource.kind ===
        'photo-library' ||
      possibleSource.kind ===
        'file' ||
      possibleSource.kind ===
        'unknown'
    ) &&
    typeof possibleSource.createdAt ===
      'number' &&
    Number.isFinite(
      possibleSource.createdAt
    )
  );
}

export function isValidProcessingJob(
  value:
    unknown
): value is ProcessingJob {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const possibleJob =
    value as Partial<
      ProcessingJob
    >;

  return (
    possibleJob.schemaVersion ===
      PROCESSING_QUEUE_SCHEMA_VERSION &&
    typeof possibleJob.id ===
      'string' &&
    possibleJob.id.length >
      0 &&
    typeof possibleJob.queueId ===
      'string' &&
    possibleJob.queueId.length >
      0 &&
    typeof possibleJob.batchId ===
      'string' &&
    possibleJob.batchId.length >
      0 &&
    typeof possibleJob.requestId ===
      'string' &&
    possibleJob.requestId.length >
      0 &&
    typeof possibleJob
      .wardrobeItemId ===
      'string' &&
    possibleJob
      .wardrobeItemId
      .length >
      0 &&
    isProcessingJobStatus(
      possibleJob.status
    ) &&
    isValidProcessingImageSource(
      possibleJob.source
    ) &&
    typeof possibleJob.progress ===
      'object' &&
    possibleJob.progress !==
      null &&
    typeof possibleJob
      .progress
      .progress ===
      'number' &&
    Number.isFinite(
      possibleJob
        .progress
        .progress
    )
  );
}

/* =========================================================
 * Segmentation progress mapping
 * ======================================================= */

export function mapSegmentationProgressToJobProgress(
  event:
    SegmentationProgressEvent,
  estimatedRemainingMs:
    ProcessingDurationMs | null =
      null
): ProcessingJobProgress {
  const progress =
    clampProcessingProgress(
      event.progress
    );

  return {
    progress,

    percentage:
      processingProgressToPercentage(
        progress
      ),

    stage:
      event.stage,

    message:
      event.message,

    updatedAt:
      Date.now(),

    elapsedMs:
      normalizeProcessingDuration(
        event.elapsedMs
      ),

    estimatedRemainingMs,

    segmentationProgress: {
      ...event,

      metadata:
        event.metadata
          ? {
              ...event.metadata,
            }
          : undefined,
    },
  };
}

/* =========================================================
 * Queue ordering
 * ======================================================= */

export function sortProcessingJobs(
  jobs:
    readonly ProcessingJob[]
): ProcessingJob[] {
  return [...jobs].sort(
    (
      first,
      second
    ) => {
      if (
        first.priority !==
        second.priority
      ) {
        return (
          second.priority -
          first.priority
        );
      }

      if (
        first.queuePosition !==
        second.queuePosition
      ) {
        return (
          first.queuePosition -
          second.queuePosition
        );
      }

      return (
        first.timing.createdAt -
        second.timing.createdAt
      );
    }
  );
}

export function reindexProcessingJobs(
  jobs:
    readonly ProcessingJob[]
): ProcessingJob[] {
  return sortProcessingJobs(
    jobs
  ).map(
    (
      job,
      index
    ) => ({
      ...job,

      queuePosition:
        index,
    })
  );
}