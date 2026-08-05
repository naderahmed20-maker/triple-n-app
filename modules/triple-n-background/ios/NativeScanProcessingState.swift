//
// NativeScanProcessingState.swift
//
// Triple N - Native Scan Processing State Contracts
//
// هذا الملف يمثل نسخة Swift من أجزاء:
//
// - NativeProcessingProgress
// - NativeProcessingOutput
// - NativeProcessingError
// - NativeProcessingJobResult
// - NativeProcessingPersistedRecord
// - NativeProcessingScheduleResult
// - NativeProcessingCapabilityResult
// - NativeProcessingEvent
//
// الموجودة داخل:
//
// scan/core/native/NativeProcessingContracts.ts
//
// مسؤولياته:
//
// 1) تمثيل حالة تنفيذ Native Job.
// 2) حفظ التقدم والمرحلة والوقت.
// 3) تمثيل النتيجة النهائية أو الخطأ.
// 4) دعم Codable للتخزين والاسترجاع.
// 5) تجهيز Dictionaries صالحة للإرسال إلى JavaScript.
// 6) تطبيع progress وduration وtimestamps.
//
// هذا الملف لا يشغّل EdgeSAM.
// هذا الملف لا يبدأ Background Task.
// هذا الملف لا يصدر Events بنفسه.
//

import Foundation

// MARK: - Runtime

enum NativeScanProcessingRuntime:
  String,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case iosBackgroundProcessing =
    "ios-bg-processing"

  case iosContinuedProcessing =
    "ios-continued-processing"

  case androidWorkManager =
    "android-work-manager"

  case androidForegroundService =
    "android-foreground-service"

  case foregroundFallback =
    "foreground-fallback"

  case unknown =
    "unknown"
}

// MARK: - Executor state

enum NativeScanExecutorState:
  String,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case idle
  case scheduled
  case starting
  case running
  case suspending
  case suspended
  case resuming
  case finishing
  case completed
  case failed
  case cancelled
  case expired
  case interrupted
}

// MARK: - Application state

enum NativeScanApplicationState:
  String,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case active
  case inactive
  case background
  case locked
  case terminated
  case unknown
}

// MARK: - Error source

enum NativeScanProcessingErrorSource:
  String,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case scheduler
  case source
  case model
  case encoder
  case decoder
  case postprocessor
  case export
  case storage
  case wardrobe
  case expiration
  case cancellation
  case unknown
}

// MARK: - Capability status

enum NativeScanCapabilityStatus:
  String,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case available
  case unavailable
  case restricted
  case unsupported
  case unknown
}

// MARK: - Event type

enum NativeScanProcessingEventType:
  String,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case scheduled
  case started
  case progress
  case suspended
  case resumed
  case completed
  case failed
  case cancelled
  case expired
  case interrupted
}

// MARK: - Processing progress

struct NativeScanProcessingProgress:
  Codable,
  Equatable,
  Sendable {

  let contractVersion:
    Int

  let jobId:
    String

  let queueId:
    String

  let batchId:
    String

  /*
   * ProcessingJobStatus قادم من QueueTypes.ts.
   *
   * نحتفظ به كـString حتى تظل طبقة Native
   * متوافقة مع إضافة حالات Queue جديدة دون
   * كسر فك ترميز الحالات المخزنة.
   */
  let status:
    String

  let executorState:
    NativeScanExecutorState

  /*
   * ProcessingJobStage قادم من QueueTypes.ts.
   *
   * نحتفظ به كـString للأسباب نفسها.
   */
  let stage:
    String

  let progress:
    Double

  let percentage:
    Int

  let message:
    String

  let startedAt:
    NativeProcessingTimestamp?

  let updatedAt:
    NativeProcessingTimestamp

  let elapsedMs:
    Int64

  let estimatedRemainingMs:
    Int64?

  let nativeTaskId:
    String?

  let runtime:
    NativeScanProcessingRuntime

  let applicationState:
    NativeScanApplicationState

  let attempt:
    Int

  enum CodingKeys:
    String,
    CodingKey {

    case contractVersion
    case jobId
    case queueId
    case batchId
    case status
    case executorState
    case stage
    case progress
    case percentage
    case message
    case startedAt
    case updatedAt
    case elapsedMs
    case estimatedRemainingMs
    case nativeTaskId
    case runtime
    case applicationState
    case attempt
  }

  // MARK: Initial state

  static func initial(
    for job:
      NativeScanJob
  ) -> NativeScanProcessingProgress {
    let timestamp =
      NativeProcessingTime.now()

    return NativeScanProcessingProgress(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        job.jobId,
      queueId:
        job.queueId,
      batchId:
        job.batchId,
      status:
        "queued",
      executorState:
        .scheduled,
      stage:
        "queued",
      progress:
        0,
      percentage:
        0,
      message:
        "Waiting for native processing.",
      startedAt:
        nil,
      updatedAt:
        timestamp,
      elapsedMs:
        0,
      estimatedRemainingMs:
        nil,
      nativeTaskId:
        nil,
      runtime:
        .unknown,
      applicationState:
        .unknown,
      attempt:
        job.options
          .currentAttempt
    )
  }

  // MARK: Validation

  func validated()
    throws ->
      NativeScanProcessingProgress {
    guard contractVersion ==
            NativeProcessingContractConstants
              .contractVersion else {
      throw NativeScanProcessingStateError
        .unsupportedContractVersion(
          received:
            contractVersion
        )
    }

    let normalizedJobId =
      try Self.requireIdentifier(
        jobId,
        field:
          "jobId"
      )

    let normalizedQueueId =
      try Self.requireIdentifier(
        queueId,
        field:
          "queueId"
      )

    let normalizedBatchId =
      try Self.requireIdentifier(
        batchId,
        field:
          "batchId"
      )

    let normalizedStatus =
      try Self.requireIdentifier(
        status,
        field:
          "status"
      )

    let normalizedStage =
      try Self.requireIdentifier(
        stage,
        field:
          "stage"
      )

    guard updatedAt > 0 else {
      throw NativeScanProcessingStateError
        .invalidUpdatedAt
    }

    if let startedAt {
      guard startedAt > 0 else {
        throw NativeScanProcessingStateError
          .invalidStartedAt
      }
    }

    guard attempt >= 1 else {
      throw NativeScanProcessingStateError
        .invalidAttempt
    }

    let normalizedProgress =
      NativeScanProcessingMath
        .clampProgress(
          progress
        )

    let normalizedPercentage =
      NativeScanProcessingMath
        .percentage(
          normalizedProgress
        )

    let normalizedElapsedMs =
      NativeProcessingTime
        .normalizeDuration(
          elapsedMs
        )

    let normalizedEstimatedRemainingMs:
      Int64?

    if let estimatedRemainingMs {
      normalizedEstimatedRemainingMs =
        NativeProcessingTime
          .normalizeDuration(
            estimatedRemainingMs
          )
    } else {
      normalizedEstimatedRemainingMs =
        nil
    }

    return NativeScanProcessingProgress(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        normalizedJobId,
      queueId:
        normalizedQueueId,
      batchId:
        normalizedBatchId,
      status:
        normalizedStatus,
      executorState:
        executorState,
      stage:
        normalizedStage,
      progress:
        normalizedProgress,
      percentage:
        normalizedPercentage,
      message:
        message,
      startedAt:
        startedAt,
      updatedAt:
        updatedAt,
      elapsedMs:
        normalizedElapsedMs,
      estimatedRemainingMs:
        normalizedEstimatedRemainingMs,
      nativeTaskId:
        Self.normalizeOptionalString(
          nativeTaskId
        ),
      runtime:
        runtime,
      applicationState:
        applicationState,
      attempt:
        attempt
    )
  }

  // MARK: Updating

  func updating(
    status:
      String? =
        nil,
    executorState:
      NativeScanExecutorState? =
        nil,
    stage:
      String? =
        nil,
    progress:
      Double? =
        nil,
    message:
      String? =
        nil,
    startedAt:
      NativeProcessingTimestamp? =
        nil,
    preserveExistingStartedAt:
      Bool =
        true,
    updatedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now(),
    estimatedRemainingMs:
      Int64? =
        nil,
    preserveEstimatedRemainingMs:
      Bool =
        true,
    nativeTaskId:
      String? =
        nil,
    preserveNativeTaskId:
      Bool =
        true,
    runtime:
      NativeScanProcessingRuntime? =
        nil,
    applicationState:
      NativeScanApplicationState? =
        nil,
    attempt:
      Int? =
        nil
  ) -> NativeScanProcessingProgress {
    let resolvedProgress =
      NativeScanProcessingMath
        .clampProgress(
          progress ??
          self.progress
        )

    let resolvedStartedAt:
      NativeProcessingTimestamp?

    if let startedAt {
      resolvedStartedAt =
        startedAt
    } else if preserveExistingStartedAt {
      resolvedStartedAt =
        self.startedAt
    } else {
      resolvedStartedAt =
        nil
    }

    let resolvedEstimatedRemainingMs:
      Int64?

    if let estimatedRemainingMs {
      resolvedEstimatedRemainingMs =
        NativeProcessingTime
          .normalizeDuration(
            estimatedRemainingMs
          )
    } else if preserveEstimatedRemainingMs {
      resolvedEstimatedRemainingMs =
        self.estimatedRemainingMs
    } else {
      resolvedEstimatedRemainingMs =
        nil
    }

    let resolvedNativeTaskId:
      String?

    if let nativeTaskId {
      resolvedNativeTaskId =
        Self.normalizeOptionalString(
          nativeTaskId
        )
    } else if preserveNativeTaskId {
      resolvedNativeTaskId =
        self.nativeTaskId
    } else {
      resolvedNativeTaskId =
        nil
    }

    let resolvedElapsedMs =
      Self.calculateElapsedMs(
        startedAt:
          resolvedStartedAt,
        updatedAt:
          updatedAt
      )

    return NativeScanProcessingProgress(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        jobId,
      queueId:
        queueId,
      batchId:
        batchId,
      status:
        status ??
        self.status,
      executorState:
        executorState ??
        self.executorState,
      stage:
        stage ??
        self.stage,
      progress:
        resolvedProgress,
      percentage:
        NativeScanProcessingMath
          .percentage(
            resolvedProgress
          ),
      message:
        message ??
        self.message,
      startedAt:
        resolvedStartedAt,
      updatedAt:
        max(
          1,
          updatedAt
        ),
      elapsedMs:
        resolvedElapsedMs,
      estimatedRemainingMs:
        resolvedEstimatedRemainingMs,
      nativeTaskId:
        resolvedNativeTaskId,
      runtime:
        runtime ??
        self.runtime,
      applicationState:
        applicationState ??
        self.applicationState,
      attempt:
        max(
          1,
          attempt ??
          self.attempt
        )
    )
  }

  // MARK: Dictionary

  func asDictionary()
    -> [String: Any] {
    [
      "contractVersion":
        contractVersion,

      "jobId":
        jobId,

      "queueId":
        queueId,

      "batchId":
        batchId,

      "status":
        status,

      "executorState":
        executorState.rawValue,

      "stage":
        stage,

      "progress":
        progress,

      "percentage":
        percentage,

      "message":
        message,

      "startedAt":
        startedAt ??
        NSNull(),

      "updatedAt":
        updatedAt,

      "elapsedMs":
        elapsedMs,

      "estimatedRemainingMs":
        estimatedRemainingMs ??
        NSNull(),

      "nativeTaskId":
        nativeTaskId ??
        NSNull(),

      "runtime":
        runtime.rawValue,

      "applicationState":
        applicationState.rawValue,

      "attempt":
        attempt
    ]
  }

  // MARK: Private helpers

  private static func calculateElapsedMs(
    startedAt:
      NativeProcessingTimestamp?,
    updatedAt:
      NativeProcessingTimestamp
  ) -> Int64 {
    guard let startedAt,
          startedAt > 0,
          updatedAt >= startedAt else {
      return 0
    }

    return updatedAt -
      startedAt
  }

  private static func requireIdentifier(
    _ value:
      String,
    field:
      String
  ) throws ->
      String {
    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalized.isEmpty else {
      throw NativeScanProcessingStateError
        .missingIdentifier(
          field:
            field
        )
    }

    return normalized
  }

  private static func normalizeOptionalString(
    _ value:
      String?
  ) -> String? {
    guard let value else {
      return nil
    }

    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    return normalized.isEmpty
      ? nil
      : normalized
  }
}

// MARK: - Processing output

struct NativeScanProcessingOutput:
  Codable,
  Equatable,
  Sendable {

  let processedImageUri:
    String

  let width:
    Int

  let height:
    Int

  let format:
    String

  let fileSizeBytes:
    Int64?

  let foregroundRatio:
    Double?

  let processingDurationMs:
    Int64

  let completedAt:
    NativeProcessingTimestamp

  let metadata:
    [String: NativeProcessingMetadataValue]

  enum CodingKeys:
    String,
    CodingKey {

    case processedImageUri
    case width
    case height
    case format
    case fileSizeBytes
    case foregroundRatio
    case processingDurationMs
    case completedAt
    case metadata
  }

  func validated()
    throws ->
      NativeScanProcessingOutput {
    let normalizedImageURI =
      processedImageUri
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedImageURI.isEmpty else {
      throw NativeScanProcessingStateError
        .missingProcessedImageURI
    }

    guard width > 0 else {
      throw NativeScanProcessingStateError
        .invalidOutputWidth
    }

    guard height > 0 else {
      throw NativeScanProcessingStateError
        .invalidOutputHeight
    }

    guard format
            .lowercased() ==
            "png" else {
      throw NativeScanProcessingStateError
        .unsupportedOutputFormat
    }

    if let fileSizeBytes {
      guard fileSizeBytes >= 0 else {
        throw NativeScanProcessingStateError
          .invalidOutputFileSize
      }
    }

    let normalizedForegroundRatio:
      Double?

    if let foregroundRatio {
      guard foregroundRatio.isFinite else {
        throw NativeScanProcessingStateError
          .invalidForegroundRatio
      }

      normalizedForegroundRatio =
        min(
          1,
          max(
            0,
            foregroundRatio
          )
        )
    } else {
      normalizedForegroundRatio =
        nil
    }

    guard completedAt > 0 else {
      throw NativeScanProcessingStateError
        .invalidCompletedAt
    }

    return NativeScanProcessingOutput(
      processedImageUri:
        normalizedImageURI,
      width:
        width,
      height:
        height,
      format:
        "png",
      fileSizeBytes:
        fileSizeBytes,
      foregroundRatio:
        normalizedForegroundRatio,
      processingDurationMs:
        NativeProcessingTime
          .normalizeDuration(
            processingDurationMs
          ),
      completedAt:
        completedAt,
      metadata:
        metadata
    )
  }

  func asDictionary()
    -> [String: Any] {
    var metadataDictionary:
      [String: Any] =
        [:]

    for (
      key,
      value
    ) in metadata {
      metadataDictionary[
        key
      ] =
        value.foundationValue
    }

    return [
      "processedImageUri":
        processedImageUri,

      "width":
        width,

      "height":
        height,

      "format":
        format,

      "fileSizeBytes":
        fileSizeBytes ??
        NSNull(),

      "foregroundRatio":
        foregroundRatio ??
        NSNull(),

      "processingDurationMs":
        processingDurationMs,

      "completedAt":
        completedAt,

      "metadata":
        metadataDictionary
    ]
  }
}

// MARK: - Processing error

struct NativeScanProcessingError:
  Codable,
  Equatable,
  Sendable {

  /*
   * ProcessingJobErrorCode من QueueTypes.ts.
   *
   * String يمنع كسر Native عند إضافة Error Code جديد.
   */
  let code:
    String

  let message:
    String

  let source:
    NativeScanProcessingErrorSource

  let retryable:
    Bool

  let occurredAt:
    NativeProcessingTimestamp

  let attempt:
    Int

  let stage:
    String?

  let nativeCode:
    String?

  let metadata:
    [String: NativeProcessingMetadataValue]

  enum CodingKeys:
    String,
    CodingKey {

    case code
    case message
    case source
    case retryable
    case occurredAt
    case attempt
    case stage
    case nativeCode
    case metadata
  }

  func validated()
    throws ->
      NativeScanProcessingError {
    let normalizedCode =
      code
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedCode.isEmpty else {
      throw NativeScanProcessingStateError
        .missingErrorCode
    }

    let normalizedMessage =
      message
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedMessage.isEmpty else {
      throw NativeScanProcessingStateError
        .missingErrorMessage
    }

    guard occurredAt > 0 else {
      throw NativeScanProcessingStateError
        .invalidOccurredAt
    }

    guard attempt >= 1 else {
      throw NativeScanProcessingStateError
        .invalidAttempt
    }

    return NativeScanProcessingError(
      code:
        normalizedCode,
      message:
        normalizedMessage,
      source:
        source,
      retryable:
        retryable,
      occurredAt:
        occurredAt,
      attempt:
        attempt,
      stage:
        Self.normalizeOptionalString(
          stage
        ),
      nativeCode:
        Self.normalizeOptionalString(
          nativeCode
        ),
      metadata:
        metadata
    )
  }

  func asDictionary()
    -> [String: Any] {
    var metadataDictionary:
      [String: Any] =
        [:]

    for (
      key,
      value
    ) in metadata {
      metadataDictionary[
        key
      ] =
        value.foundationValue
    }

    return [
      "code":
        code,

      "message":
        message,

      "source":
        source.rawValue,

      "retryable":
        retryable,

      "occurredAt":
        occurredAt,

      "attempt":
        attempt,

      "stage":
        stage ??
        NSNull(),

      "nativeCode":
        nativeCode ??
        NSNull(),

      "metadata":
        metadataDictionary
    ]
  }

  static func from(
    _ error:
      Error,
    code:
      String =
        "NATIVE_PROCESSING_FAILED",
    source:
      NativeScanProcessingErrorSource =
        .unknown,
    retryable:
      Bool =
        false,
    attempt:
      Int,
    stage:
      String? =
        nil,
    nativeCode:
      String? =
        nil,
    metadata:
      [String: NativeProcessingMetadataValue] =
        [:]
  ) -> NativeScanProcessingError {
    NativeScanProcessingError(
      code:
        code,
      message:
        error.localizedDescription,
      source:
        source,
      retryable:
        retryable,
      occurredAt:
        NativeProcessingTime.now(),
      attempt:
        max(
          1,
          attempt
        ),
      stage:
        normalizeOptionalString(
          stage
        ),
      nativeCode:
        normalizeOptionalString(
          nativeCode
        ),
      metadata:
        metadata
    )
  }

  private static func normalizeOptionalString(
    _ value:
      String?
  ) -> String? {
    guard let value else {
      return nil
    }

    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    return normalized.isEmpty
      ? nil
      : normalized
  }
}

// MARK: - Job result

struct NativeScanJobResult:
  Codable,
  Equatable,
  Sendable {

  let contractVersion:
    Int

  let jobId:
    String

  let queueId:
    String

  let batchId:
    String

  let requestId:
    String

  let wardrobeItemId:
    String

  let succeeded:
    Bool

  let cancelled:
    Bool

  let expired:
    Bool

  let interrupted:
    Bool

  let output:
    NativeScanProcessingOutput?

  let error:
    NativeScanProcessingError?

  let runtime:
    NativeScanProcessingRuntime

  let nativeTaskId:
    String?

  let startedAt:
    NativeProcessingTimestamp?

  let completedAt:
    NativeProcessingTimestamp

  let attempt:
    Int

  enum CodingKeys:
    String,
    CodingKey {

    case contractVersion
    case jobId
    case queueId
    case batchId
    case requestId
    case wardrobeItemId
    case succeeded
    case cancelled
    case expired
    case interrupted
    case output
    case error
    case runtime
    case nativeTaskId
    case startedAt
    case completedAt
    case attempt
  }

  // MARK: Success result

  static func success(
    job:
      NativeScanJob,
    output:
      NativeScanProcessingOutput,
    runtime:
      NativeScanProcessingRuntime,
    nativeTaskId:
      String?,
    startedAt:
      NativeProcessingTimestamp?,
    completedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) throws ->
      NativeScanJobResult {
    let validatedOutput =
      try output.validated()

    return try NativeScanJobResult(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        job.jobId,
      queueId:
        job.queueId,
      batchId:
        job.batchId,
      requestId:
        job.requestId,
      wardrobeItemId:
        job.wardrobeItemId,
      succeeded:
        true,
      cancelled:
        false,
      expired:
        false,
      interrupted:
        false,
      output:
        validatedOutput,
      error:
        nil,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt,
      completedAt:
        completedAt,
      attempt:
        job.options
          .currentAttempt
    )
    .validated()
  }

  // MARK: Failure result

  static func failure(
    job:
      NativeScanJob,
    error:
      NativeScanProcessingError,
    runtime:
      NativeScanProcessingRuntime,
    nativeTaskId:
      String?,
    startedAt:
      NativeProcessingTimestamp?,
    completedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) throws ->
      NativeScanJobResult {
    let validatedError =
      try error.validated()

    return try NativeScanJobResult(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        job.jobId,
      queueId:
        job.queueId,
      batchId:
        job.batchId,
      requestId:
        job.requestId,
      wardrobeItemId:
        job.wardrobeItemId,
      succeeded:
        false,
      cancelled:
        false,
      expired:
        false,
      interrupted:
        false,
      output:
        nil,
      error:
        validatedError,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt,
      completedAt:
        completedAt,
      attempt:
        job.options
          .currentAttempt
    )
    .validated()
  }

  // MARK: Cancelled result

  static func cancelled(
    job:
      NativeScanJob,
    error:
      NativeScanProcessingError?,
    runtime:
      NativeScanProcessingRuntime,
    nativeTaskId:
      String?,
    startedAt:
      NativeProcessingTimestamp?,
    completedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) throws ->
      NativeScanJobResult {
    try NativeScanJobResult(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        job.jobId,
      queueId:
        job.queueId,
      batchId:
        job.batchId,
      requestId:
        job.requestId,
      wardrobeItemId:
        job.wardrobeItemId,
      succeeded:
        false,
      cancelled:
        true,
      expired:
        false,
      interrupted:
        false,
      output:
        nil,
      error:
        error,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt,
      completedAt:
        completedAt,
      attempt:
        job.options
          .currentAttempt
    )
    .validated()
  }

  // MARK: Expired result

  static func expired(
    job:
      NativeScanJob,
    error:
      NativeScanProcessingError?,
    runtime:
      NativeScanProcessingRuntime,
    nativeTaskId:
      String?,
    startedAt:
      NativeProcessingTimestamp?,
    completedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) throws ->
      NativeScanJobResult {
    try NativeScanJobResult(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        job.jobId,
      queueId:
        job.queueId,
      batchId:
        job.batchId,
      requestId:
        job.requestId,
      wardrobeItemId:
        job.wardrobeItemId,
      succeeded:
        false,
      cancelled:
        false,
      expired:
        true,
      interrupted:
        false,
      output:
        nil,
      error:
        error,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt,
      completedAt:
        completedAt,
      attempt:
        job.options
          .currentAttempt
    )
    .validated()
  }

  // MARK: Interrupted result

  static func interrupted(
    job:
      NativeScanJob,
    error:
      NativeScanProcessingError?,
    runtime:
      NativeScanProcessingRuntime,
    nativeTaskId:
      String?,
    startedAt:
      NativeProcessingTimestamp?,
    completedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) throws ->
      NativeScanJobResult {
    try NativeScanJobResult(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        job.jobId,
      queueId:
        job.queueId,
      batchId:
        job.batchId,
      requestId:
        job.requestId,
      wardrobeItemId:
        job.wardrobeItemId,
      succeeded:
        false,
      cancelled:
        false,
      expired:
        false,
      interrupted:
        true,
      output:
        nil,
      error:
        error,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt,
      completedAt:
        completedAt,
      attempt:
        job.options
          .currentAttempt
    )
    .validated()
  }

  // MARK: Validation

  func validated()
    throws ->
      NativeScanJobResult {
    guard contractVersion ==
            NativeProcessingContractConstants
              .contractVersion else {
      throw NativeScanProcessingStateError
        .unsupportedContractVersion(
          received:
            contractVersion
        )
    }

    let normalizedJobId =
      try Self.requireIdentifier(
        jobId,
        field:
          "jobId"
      )

    let normalizedQueueId =
      try Self.requireIdentifier(
        queueId,
        field:
          "queueId"
      )

    let normalizedBatchId =
      try Self.requireIdentifier(
        batchId,
        field:
          "batchId"
      )

    let normalizedRequestId =
      try Self.requireIdentifier(
        requestId,
        field:
          "requestId"
      )

    let normalizedWardrobeItemId =
      try Self.requireIdentifier(
        wardrobeItemId,
        field:
          "wardrobeItemId"
      )

    guard completedAt > 0 else {
      throw NativeScanProcessingStateError
        .invalidCompletedAt
    }

    if let startedAt {
      guard startedAt > 0 else {
        throw NativeScanProcessingStateError
          .invalidStartedAt
      }

      guard completedAt >=
              startedAt else {
        throw NativeScanProcessingStateError
          .completedBeforeStarted
      }
    }

    guard attempt >= 1 else {
      throw NativeScanProcessingStateError
        .invalidAttempt
    }

    let terminalFlagCount =
      [
        succeeded,
        cancelled,
        expired,
        interrupted
      ]
      .filter {
        $0
      }
      .count

    guard terminalFlagCount <= 1 else {
      throw NativeScanProcessingStateError
        .conflictingResultFlags
    }

    if succeeded {
      guard output != nil else {
        throw NativeScanProcessingStateError
          .successfulResultMissingOutput
      }

      guard error == nil else {
        throw NativeScanProcessingStateError
          .successfulResultContainsError
      }
    } else if !cancelled &&
                !expired &&
                !interrupted {
      guard error != nil else {
        throw NativeScanProcessingStateError
          .failedResultMissingError
      }
    }

    let validatedOutput =
      try output?
        .validated()

    let validatedError =
      try error?
        .validated()

    return NativeScanJobResult(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        normalizedJobId,
      queueId:
        normalizedQueueId,
      batchId:
        normalizedBatchId,
      requestId:
        normalizedRequestId,
      wardrobeItemId:
        normalizedWardrobeItemId,
      succeeded:
        succeeded,
      cancelled:
        cancelled,
      expired:
        expired,
      interrupted:
        interrupted,
      output:
        validatedOutput,
      error:
        validatedError,
      runtime:
        runtime,
      nativeTaskId:
        Self.normalizeOptionalString(
          nativeTaskId
        ),
      startedAt:
        startedAt,
      completedAt:
        completedAt,
      attempt:
        attempt
    )
  }

  // MARK: Dictionary

  func asDictionary()
    -> [String: Any] {
    [
      "contractVersion":
        contractVersion,

      "jobId":
        jobId,

      "queueId":
        queueId,

      "batchId":
        batchId,

      "requestId":
        requestId,

      "wardrobeItemId":
        wardrobeItemId,

      "succeeded":
        succeeded,

      "cancelled":
        cancelled,

      "expired":
        expired,

      "interrupted":
        interrupted,

      "output":
        output?
          .asDictionary() ??
        NSNull(),

      "error":
        error?
          .asDictionary() ??
        NSNull(),

      "runtime":
        runtime.rawValue,

      "nativeTaskId":
        nativeTaskId ??
        NSNull(),

      "startedAt":
        startedAt ??
        NSNull(),

      "completedAt":
        completedAt,

      "attempt":
        attempt
    ]
  }

  // MARK: Encoding

  func encodedData()
    throws ->
      Data {
    let validatedResult =
      try validated()

    let encoder =
      JSONEncoder()

    encoder.outputFormatting =
      [
        .sortedKeys
      ]

    return try encoder.encode(
      validatedResult
    )
  }

  static func decode(
    from data:
      Data
  ) throws ->
      NativeScanJobResult {
    let decoder =
      JSONDecoder()

    let result =
      try decoder.decode(
        NativeScanJobResult.self,
        from:
          data
      )

    return try result.validated()
  }

  // MARK: Private helpers

  private static func requireIdentifier(
    _ value:
      String,
    field:
      String
  ) throws ->
      String {
    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalized.isEmpty else {
      throw NativeScanProcessingStateError
        .missingIdentifier(
          field:
            field
        )
    }

    return normalized
  }

  private static func normalizeOptionalString(
    _ value:
      String?
  ) -> String? {
    guard let value else {
      return nil
    }

    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    return normalized.isEmpty
      ? nil
      : normalized
  }
}

// MARK: - Persisted record

struct NativeScanPersistedRecord:
  Codable,
  Equatable,
  Sendable {

  let stateVersion:
    Int

  let payload:
    NativeScanJob

  let progress:
    NativeScanProcessingProgress

  let result:
    NativeScanJobResult?

  let createdAt:
    NativeProcessingTimestamp

  let updatedAt:
    NativeProcessingTimestamp

  let revision:
    Int64

  enum CodingKeys:
    String,
    CodingKey {

    case stateVersion
    case payload
    case progress
    case result
    case createdAt
    case updatedAt
    case revision
  }

  static func initial(
    for job:
      NativeScanJob
  ) throws ->
      NativeScanPersistedRecord {
    let validatedJob =
      try job.validated()

    let timestamp =
      NativeProcessingTime.now()

    return NativeScanPersistedRecord(
      stateVersion:
        NativeProcessingContractConstants
          .stateVersion,
      payload:
        validatedJob,
      progress:
        NativeScanProcessingProgress
          .initial(
            for:
              validatedJob
          ),
      result:
        nil,
      createdAt:
        timestamp,
      updatedAt:
        timestamp,
      revision:
        0
    )
  }

  func updatingProgress(
    _ newProgress:
      NativeScanProcessingProgress,
    updatedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) throws ->
      NativeScanPersistedRecord {
    let validatedProgress =
      try newProgress.validated()

    guard validatedProgress.jobId ==
            payload.jobId else {
      throw NativeScanProcessingStateError
        .recordJobIdentifierMismatch
    }

    guard validatedProgress.queueId ==
            payload.queueId else {
      throw NativeScanProcessingStateError
        .recordQueueIdentifierMismatch
    }

    guard validatedProgress.batchId ==
            payload.batchId else {
      throw NativeScanProcessingStateError
        .recordBatchIdentifierMismatch
    }

    return NativeScanPersistedRecord(
      stateVersion:
        stateVersion,
      payload:
        payload,
      progress:
        validatedProgress,
      result:
        result,
      createdAt:
        createdAt,
      updatedAt:
        max(
          1,
          updatedAt
        ),
      revision:
        revision +
        1
    )
  }

  func completing(
    with newResult:
      NativeScanJobResult,
    progress newProgress:
      NativeScanProcessingProgress,
    updatedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) throws ->
      NativeScanPersistedRecord {
    let validatedResult =
      try newResult.validated()

    let validatedProgress =
      try newProgress.validated()

    guard validatedResult.jobId ==
            payload.jobId,
          validatedProgress.jobId ==
            payload.jobId else {
      throw NativeScanProcessingStateError
        .recordJobIdentifierMismatch
    }

    return NativeScanPersistedRecord(
      stateVersion:
        stateVersion,
      payload:
        payload,
      progress:
        validatedProgress,
      result:
        validatedResult,
      createdAt:
        createdAt,
      updatedAt:
        max(
          1,
          updatedAt
        ),
      revision:
        revision +
        1
    )
  }

  func validated()
    throws ->
      NativeScanPersistedRecord {
    guard stateVersion ==
            NativeProcessingContractConstants
              .stateVersion else {
      throw NativeScanProcessingStateError
        .unsupportedStateVersion(
          received:
            stateVersion
        )
    }

    guard createdAt > 0 else {
      throw NativeScanProcessingStateError
        .invalidCreatedAt
    }

    guard updatedAt > 0 else {
      throw NativeScanProcessingStateError
        .invalidUpdatedAt
    }

    guard updatedAt >=
            createdAt else {
      throw NativeScanProcessingStateError
        .updatedBeforeCreated
    }

    guard revision >= 0 else {
      throw NativeScanProcessingStateError
        .invalidRevision
    }

    let validatedPayload =
      try payload.validated()

    let validatedProgress =
      try progress.validated()

    let validatedResult =
      try result?
        .validated()

    guard validatedProgress.jobId ==
            validatedPayload.jobId else {
      throw NativeScanProcessingStateError
        .recordJobIdentifierMismatch
    }

    guard validatedProgress.queueId ==
            validatedPayload.queueId else {
      throw NativeScanProcessingStateError
        .recordQueueIdentifierMismatch
    }

    guard validatedProgress.batchId ==
            validatedPayload.batchId else {
      throw NativeScanProcessingStateError
        .recordBatchIdentifierMismatch
    }

    if let validatedResult {
      guard validatedResult.jobId ==
              validatedPayload.jobId else {
        throw NativeScanProcessingStateError
          .recordJobIdentifierMismatch
      }

      guard validatedResult.queueId ==
              validatedPayload.queueId else {
        throw NativeScanProcessingStateError
          .recordQueueIdentifierMismatch
      }

      guard validatedResult.batchId ==
              validatedPayload.batchId else {
        throw NativeScanProcessingStateError
          .recordBatchIdentifierMismatch
      }

      guard validatedResult.requestId ==
              validatedPayload.requestId else {
        throw NativeScanProcessingStateError
          .recordRequestIdentifierMismatch
      }
    }

    return NativeScanPersistedRecord(
      stateVersion:
        NativeProcessingContractConstants
          .stateVersion,
      payload:
        validatedPayload,
      progress:
        validatedProgress,
      result:
        validatedResult,
      createdAt:
        createdAt,
      updatedAt:
        updatedAt,
      revision:
        revision
    )
  }

  func encodedData()
    throws ->
      Data {
    let validatedRecord =
      try validated()

    let encoder =
      JSONEncoder()

    encoder.outputFormatting =
      [
        .sortedKeys
      ]

    return try encoder.encode(
      validatedRecord
    )
  }

  static func decode(
    from data:
      Data
  ) throws ->
      NativeScanPersistedRecord {
    let decoder =
      JSONDecoder()

    let record =
      try decoder.decode(
        NativeScanPersistedRecord.self,
        from:
          data
      )

    return try record.validated()
  }

  func asDictionary()
    -> [String: Any] {
    [
      "stateVersion":
        stateVersion,

      "payload":
        payload.asDictionary(),

      "progress":
        progress.asDictionary(),

      "result":
        result?
          .asDictionary() ??
        NSNull(),

      "createdAt":
        createdAt,

      "updatedAt":
        updatedAt,

      "revision":
        revision
    ]
  }
}

// MARK: - Schedule result

struct NativeScanScheduleResult:
  Codable,
  Equatable,
  Sendable {

  let accepted:
    Bool

  let jobId:
    String

  let nativeTaskId:
    String?

  let runtime:
    NativeScanProcessingRuntime

  let scheduledAt:
    NativeProcessingTimestamp?

  let error:
    NativeScanProcessingError?

  func asDictionary()
    -> [String: Any] {
    [
      "accepted":
        accepted,

      "jobId":
        jobId,

      "nativeTaskId":
        nativeTaskId ??
        NSNull(),

      "runtime":
        runtime.rawValue,

      "scheduledAt":
        scheduledAt ??
        NSNull(),

      "error":
        error?
          .asDictionary() ??
        NSNull()
    ]
  }
}

// MARK: - Capability result

struct NativeScanCapabilityResult:
  Codable,
  Equatable,
  Sendable {

  let platform:
    String

  let status:
    NativeScanCapabilityStatus

  let runtime:
    NativeScanProcessingRuntime

  let supportsLockedScreenExecution:
    Bool

  let supportsTerminatedAppExecution:
    Bool

  let supportsProgressUpdates:
    Bool

  let supportsCancellation:
    Bool

  let maximumConcurrentJobs:
    Int

  let reason:
    String?

  let checkedAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    [
      "platform":
        platform,

      "status":
        status.rawValue,

      "runtime":
        runtime.rawValue,

      "supportsLockedScreenExecution":
        supportsLockedScreenExecution,

      "supportsTerminatedAppExecution":
        supportsTerminatedAppExecution,

      "supportsProgressUpdates":
        supportsProgressUpdates,

      "supportsCancellation":
        supportsCancellation,

      "maximumConcurrentJobs":
        maximumConcurrentJobs,

      "reason":
        reason ??
        NSNull(),

      "checkedAt":
        checkedAt
    ]
  }
}

// MARK: - Native event

struct NativeScanProcessingEvent:
  Codable,
  Equatable,
  Sendable {

  let type:
    NativeScanProcessingEventType

  let jobId:
    String

  let queueId:
    String

  let batchId:
    String

  let timestamp:
    NativeProcessingTimestamp

  let progress:
    NativeScanProcessingProgress?

  let result:
    NativeScanJobResult?

  let error:
    NativeScanProcessingError?

  func asDictionary()
    -> [String: Any] {
    [
      "type":
        type.rawValue,

      "jobId":
        jobId,

      "queueId":
        queueId,

      "batchId":
        batchId,

      "timestamp":
        timestamp,

      "progress":
        progress?
          .asDictionary() ??
        NSNull(),

      "result":
        result?
          .asDictionary() ??
        NSNull(),

      "error":
        error?
          .asDictionary() ??
        NSNull()
    ]
  }
}

// MARK: - Progress math

enum NativeScanProcessingMath {

  static func clampProgress(
    _ value:
      Double
  ) -> Double {
    guard value.isFinite else {
      return 0
    }

    return min(
      1,
      max(
        0,
        value
      )
    )
  }

  static func percentage(
    _ progress:
      Double
  ) -> Int {
    Int(
      (
        clampProgress(
          progress
        ) *
        100
      )
      .rounded()
    )
  }
}

// MARK: - State errors

enum NativeScanProcessingStateError:
  LocalizedError,
  Equatable,
  Sendable {

  case unsupportedContractVersion(
    received:
      Int
  )

  case unsupportedStateVersion(
    received:
      Int
  )

  case missingIdentifier(
    field:
      String
  )

  case invalidCreatedAt
  case invalidUpdatedAt
  case invalidStartedAt
  case invalidOccurredAt
  case invalidCompletedAt
  case completedBeforeStarted
  case updatedBeforeCreated
  case invalidAttempt
  case invalidRevision

  case missingProcessedImageURI
  case invalidOutputWidth
  case invalidOutputHeight
  case unsupportedOutputFormat
  case invalidOutputFileSize
  case invalidForegroundRatio

  case missingErrorCode
  case missingErrorMessage

  case conflictingResultFlags
  case successfulResultMissingOutput
  case successfulResultContainsError
  case failedResultMissingError

  case recordJobIdentifierMismatch
  case recordQueueIdentifierMismatch
  case recordBatchIdentifierMismatch
  case recordRequestIdentifierMismatch

  var errorDescription:
    String? {
    switch self {
    case .unsupportedContractVersion(
      let received
    ):
      return
        """
        Unsupported native processing contract version: \(received).
        """

    case .unsupportedStateVersion(
      let received
    ):
      return
        """
        Unsupported native processing state version: \(received).
        """

    case .missingIdentifier(
      let field
    ):
      return
        """
        Native processing state is missing \(field).
        """

    case .invalidCreatedAt:
      return
        """
        Native processing createdAt must be greater than zero.
        """

    case .invalidUpdatedAt:
      return
        """
        Native processing updatedAt must be greater than zero.
        """

    case .invalidStartedAt:
      return
        """
        Native processing startedAt must be greater than zero.
        """

    case .invalidOccurredAt:
      return
        """
        Native processing occurredAt must be greater than zero.
        """

    case .invalidCompletedAt:
      return
        """
        Native processing completedAt must be greater than zero.
        """

    case .completedBeforeStarted:
      return
        """
        Native processing completedAt cannot be earlier than startedAt.
        """

    case .updatedBeforeCreated:
      return
        """
        Native processing updatedAt cannot be earlier than createdAt.
        """

    case .invalidAttempt:
      return
        """
        Native processing attempt must be at least one.
        """

    case .invalidRevision:
      return
        """
        Native processing revision cannot be negative.
        """

    case .missingProcessedImageURI:
      return
        """
        Native processing output URI is missing.
        """

    case .invalidOutputWidth:
      return
        """
        Native processing output width must be greater than zero.
        """

    case .invalidOutputHeight:
      return
        """
        Native processing output height must be greater than zero.
        """

    case .unsupportedOutputFormat:
      return
        """
        Native processing output format must be PNG.
        """

    case .invalidOutputFileSize:
      return
        """
        Native processing output file size cannot be negative.
        """

    case .invalidForegroundRatio:
      return
        """
        Native processing foreground ratio must be finite.
        """

    case .missingErrorCode:
      return
        """
        Native processing error code is missing.
        """

    case .missingErrorMessage:
      return
        """
        Native processing error message is missing.
        """

    case .conflictingResultFlags:
      return
        """
        Native processing result contains conflicting terminal flags.
        """

    case .successfulResultMissingOutput:
      return
        """
        Successful native processing result must contain output.
        """

    case .successfulResultContainsError:
      return
        """
        Successful native processing result cannot contain an error.
        """

    case .failedResultMissingError:
      return
        """
        Failed native processing result must contain an error.
        """

    case .recordJobIdentifierMismatch:
      return
        """
        Native processing record contains mismatched job identifiers.
        """

    case .recordQueueIdentifierMismatch:
      return
        """
        Native processing record contains mismatched queue identifiers.
        """

    case .recordBatchIdentifierMismatch:
      return
        """
        Native processing record contains mismatched batch identifiers.
        """

    case .recordRequestIdentifierMismatch:
      return
        """
        Native processing record contains mismatched request identifiers.
        """
    }
}