//
// NativeScanProcessingCoordinator.swift
//
// Triple N - Native Scan Processing Coordinator
//
// المسؤوليات:
//
// 1) إدارة دورة حياة Native Scan Jobs.
// 2) ضمان تشغيل Job ثقيلة واحدة فقط في الوقت نفسه.
// 3) حفظ Job وProgress وResult على القرص.
// 4) استرجاع الحالات بعد إعادة فتح التطبيق.
// 5) تشغيل NativeScanProcessor.
// 6) دعم Cancellation وInterruption وRecovery.
// 7) إصدار Events إلى TripleNNativeProcessingModule.
// 8) تجهيز النتائج التي لم يستلمها JavaScript بعد.
// 9) منع تكرار تشغيل نفس Job.
// 10) الحفاظ على ترتيب Queue حسب Priority ووقت الإنشاء.
//
// هذا الملف لا يحتوي على منطق EdgeSAM.
// التنفيذ الفعلي موجود داخل NativeScanProcessor.swift.
//

import Foundation
import UIKit

// MARK: - Processor protocol

protocol NativeScanJobProcessing:
  AnyObject {

  func process(
    job:
      NativeScanJob,
    context:
      NativeScanProcessorContext
  ) async throws ->
      NativeScanProcessingOutput

  func cancel(
    jobId:
      String
  )
}

// MARK: - Processor progress callback

typealias NativeScanProcessorProgressHandler =
  @Sendable (
    _ stage:
      String,
    _ progress:
      Double,
    _ message:
      String,
    _ estimatedRemainingMs:
      Int64?
  ) async -> Void

// MARK: - Processor context

struct NativeScanProcessorContext:
  Sendable {

  let nativeTaskId:
    String

  let runtime:
    NativeScanProcessingRuntime

  let attempt:
    Int

  let startedAt:
    NativeProcessingTimestamp

  let cancellationToken:
    NativeScanCancellationToken

  let reportProgress:
    NativeScanProcessorProgressHandler

  func throwIfCancelled()
    throws {
    try cancellationToken
      .throwIfCancelled()
  }

  var isCancelled:
    Bool {
    cancellationToken
      .isCancelled
  }
}

// MARK: - Cancellation token

final class NativeScanCancellationToken:
  @unchecked Sendable {

  private let lock =
    NSLock()

  private var cancelled =
    false

  private var cancellationReason:
    String?

  var isCancelled:
    Bool {
    lock.lock()

    defer {
      lock.unlock()
    }

    return cancelled
  }

  var reason:
    String? {
    lock.lock()

    defer {
      lock.unlock()
    }

    return cancellationReason
  }

  @discardableResult
  func cancel(
    reason:
      String? =
        nil
  ) -> Bool {
    lock.lock()

    defer {
      lock.unlock()
    }

    guard !cancelled else {
      return false
    }

    cancelled =
      true

    cancellationReason =
      Self.normalizeReason(
        reason
      )

    return true
  }

  func throwIfCancelled()
    throws {
    let cancellation:
      (
        cancelled:
          Bool,
        reason:
          String?
      )

    lock.lock()

    cancellation =
      (
        cancelled:
          cancelled,
        reason:
          cancellationReason
      )

    lock.unlock()

    guard !cancellation.cancelled else {
      throw NativeScanCoordinatorError
        .cancelled(
          reason:
            cancellation.reason
        )
    }
  }

  private static func normalizeReason(
    _ reason:
      String?
  ) -> String? {
    guard let reason else {
      return nil
    }

    let normalized =
      reason
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    return normalized.isEmpty
      ? nil
      : normalized
  }
}

// MARK: - Coordinator snapshot

struct NativeScanCoordinatorSnapshot:
  Equatable,
  Sendable {

  let initialized:
    Bool

  let disposed:
    Bool

  let processorInstalled:
    Bool

  let activeJobId:
    String?

  let activeNativeTaskId:
    String?

  let queuedJobIds:
    [String]

  let recordCount:
    Int

  let pendingResultCount:
    Int

  let completedResultCount:
    Int

  let runtime:
    NativeScanProcessingRuntime

  let lastInitializedAt:
    NativeProcessingTimestamp?

  let lastExecutionStartedAt:
    NativeProcessingTimestamp?

  let lastExecutionCompletedAt:
    NativeProcessingTimestamp?

  let lastError:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "initialized":
        initialized,

      "disposed":
        disposed,

      "processorInstalled":
        processorInstalled,

      "activeJobId":
        activeJobId ??
        NSNull(),

      "activeNativeTaskId":
        activeNativeTaskId ??
        NSNull(),

      "queuedJobIds":
        queuedJobIds,

      "recordCount":
        recordCount,

      "pendingResultCount":
        pendingResultCount,

      "completedResultCount":
        completedResultCount,

      "runtime":
        runtime.rawValue,

      "lastInitializedAt":
        lastInitializedAt ??
        NSNull(),

      "lastExecutionStartedAt":
        lastExecutionStartedAt ??
        NSNull(),

      "lastExecutionCompletedAt":
        lastExecutionCompletedAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull()
    ]
  }
}

// MARK: - Event handler

typealias NativeScanCoordinatorEventHandler =
  @Sendable (
    NativeScanProcessingEvent
  ) -> Void

// MARK: - Coordinator

final class NativeScanProcessingCoordinator:
  @unchecked Sendable {

  // MARK: Constants

  private static let maximumJobIdLength =
    512

  private static let defaultCancellationReason =
    "Native processing was cancelled."

  private static let disposalCancellationReason =
    "Native processing coordinator was disposed."

  private static let restoredInterruptionMessage =
    "Native processing was interrupted and is waiting to resume."

  // MARK: Dependencies

  private let store:
    NativeScanJobStore

  private let stateQueue:
    DispatchQueue

  private let executionQueue:
    DispatchQueue

  // MARK: Configuration

  private var processor:
    NativeScanJobProcessing?

  private var eventHandler:
    NativeScanCoordinatorEventHandler?

  // MARK: Lifecycle state

  private var initialized =
    false

  private var disposed =
    false

  // MARK: Persisted state

  private var records:
    [String: NativeScanPersistedRecord] =
      [:]

  private var queuedJobIds:
    [String] =
      []

  private var acknowledgedResultJobIds:
    Set<String> =
      []

  // MARK: Active execution

  private var activeJobId:
    String?

  private var activeNativeTaskId:
    String?

  private var activeCancellationToken:
    NativeScanCancellationToken?

    private var activeInterruptionReason:
  String?

  private var activeExecutionTask:
    Task<Void, Never>?

  private var startNextJobScheduled =
    false

  // MARK: Diagnostics state

  private var runtime:
    NativeScanProcessingRuntime =
      .unknown

  private var lastInitializedAt:
    NativeProcessingTimestamp?

  private var lastExecutionStartedAt:
    NativeProcessingTimestamp?

  private var lastExecutionCompletedAt:
    NativeProcessingTimestamp?

  private var lastError:
    String?

  // MARK: Initialization

  init(
    store:
      NativeScanJobStore,
    processor:
      NativeScanJobProcessing? =
        nil,
    eventHandler:
      NativeScanCoordinatorEventHandler? =
        nil
  ) {
    self.store =
      store

    self.processor =
      processor

    self.eventHandler =
      eventHandler

    self.stateQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.coordinator.state",
        qos:
          .userInitiated
      )

    self.executionQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.coordinator.execution",
        qos:
          .userInitiated
      )
  }

  // MARK: - Public configuration

  func setProcessor(
    _ processor:
      NativeScanJobProcessing?
  ) throws {
    let shouldStart =
      try stateQueue.sync {
        try assertNotDisposedLocked()

        self.processor =
          processor

        return initialized &&
          processor != nil &&
          activeJobId == nil &&
          !queuedJobIds.isEmpty
      }

    if shouldStart {
      startNextJobIfPossible()
    }
  }

  func setEventHandler(
    _ handler:
      NativeScanCoordinatorEventHandler?
  ) throws {
    try stateQueue.sync {
      try assertNotDisposedLocked()

      eventHandler =
        handler
    }
  }

  // MARK: - Initialize

  func initialize(
    runtime:
      NativeScanProcessingRuntime
  ) throws {
    let shouldStart =
      try stateQueue.sync {
        try assertNotDisposedLocked()

        if initialized {
          self.runtime =
            runtime

          return processor != nil &&
            activeJobId == nil &&
            !queuedJobIds.isEmpty
        }

        do {
          self.runtime =
            runtime

          try restoreRecordsLocked()

          initialized =
            true

          lastInitializedAt =
            NativeProcessingTime.now()

          lastError =
            nil

          return processor != nil &&
            activeJobId == nil &&
            !queuedJobIds.isEmpty
        } catch {
          initialized =
            false

          lastError =
            error.localizedDescription

          throw error
        }
      }

    if shouldStart {
      startNextJobIfPossible()
    }
  }

  // MARK: - Schedule job

  func schedule(
    job:
      NativeScanJob,
    runtime:
      NativeScanProcessingRuntime,
    nativeTaskId:
      String? =
        nil
  ) throws ->
      NativeScanScheduleResult {
    let operation:
      (
        result:
          NativeScanScheduleResult,
        event:
          NativeScanProcessingEvent?,
        shouldStart:
          Bool
      )

    operation =
      try stateQueue.sync {
        try assertReadyLocked()

        do {
          let validatedJob =
            try job.validated()

          if let existingRecord =
              records[
                validatedJob.jobId
              ] {
            let existingResult =
              NativeScanScheduleResult(
                accepted:
                  true,
                jobId:
                  validatedJob.jobId,
                nativeTaskId:
                  existingRecord
                    .progress
                    .nativeTaskId,
                runtime:
                  existingRecord
                    .progress
                    .runtime,
                scheduledAt:
                  existingRecord
                    .createdAt,
                error:
                  nil
              )

            let shouldStart =
              existingRecord.result == nil &&
              processor != nil &&
              activeJobId == nil

            if existingRecord.result == nil {
              appendQueuedJobLocked(
                validatedJob.jobId
              )
            }

            return (
              result:
                existingResult,
              event:
                nil,
              shouldStart:
                shouldStart
            )
          }

          try store.saveJob(
            validatedJob
          )

          var record =
            try NativeScanPersistedRecord
              .initial(
                for:
                  validatedJob
              )

          let timestamp =
            NativeProcessingTime.now()

          let resolvedNativeTaskId =
            normalizeOptionalString(
              nativeTaskId
            ) ??
            createNativeTaskId(
              jobId:
                validatedJob.jobId
            )

          let scheduledProgress =
            record.progress
              .updating(
                status:
                  "queued",
                executorState:
                  .scheduled,
                stage:
                  "queued",
                progress:
                  0,
                message:
                  "Waiting for native processing.",
                updatedAt:
                  timestamp,
                estimatedRemainingMs:
                  nil,
                preserveEstimatedRemainingMs:
                  false,
                nativeTaskId:
                  resolvedNativeTaskId,
                preserveNativeTaskId:
                  false,
                runtime:
                  runtime,
                applicationState:
                  resolveApplicationState(),
                attempt:
                  validatedJob
                    .options
                    .currentAttempt
              )

          record =
            try record
              .updatingProgress(
                scheduledProgress,
                updatedAt:
                  timestamp
              )

          try persistRecordLocked(
            record
          )

          records[
            validatedJob.jobId
          ] =
            record

          appendQueuedJobLocked(
            validatedJob.jobId
          )

          acknowledgedResultJobIds
            .remove(
              validatedJob.jobId
            )

          self.runtime =
            runtime

          lastError =
            nil

          let scheduleResult =
            NativeScanScheduleResult(
              accepted:
                true,
              jobId:
                validatedJob.jobId,
              nativeTaskId:
                resolvedNativeTaskId,
              runtime:
                runtime,
              scheduledAt:
                timestamp,
              error:
                nil
            )

          let scheduledEvent =
            NativeScanProcessingEvent(
              type:
                .scheduled,
              jobId:
                validatedJob.jobId,
              queueId:
                validatedJob.queueId,
              batchId:
                validatedJob.batchId,
              timestamp:
                timestamp,
              progress:
                scheduledProgress,
              result:
                nil,
              error:
                nil
            )

          return (
            result:
              scheduleResult,
            event:
              scheduledEvent,
            shouldStart:
              processor != nil &&
              activeJobId == nil
          )
        } catch {
          lastError =
            error.localizedDescription

          throw error
        }
      }

    if let event =
        operation.event {
      emit(
        event
      )
    }

    if operation.shouldStart {
      startNextJobIfPossible()
    }

    return operation.result
  }

  // MARK: - Explicit start

  func start(
    jobId:
      String
  ) throws {
    let shouldStart =
      try stateQueue.sync {
        try assertReadyLocked()

        let normalizedJobId =
          try requireJobIdLocked(
            jobId
          )

        guard let record =
                records[
                  normalizedJobId
                ] else {
          throw NativeScanCoordinatorError
            .jobNotFound(
              jobId:
                normalizedJobId
            )
        }

        guard record.result ==
                nil else {
          throw NativeScanCoordinatorError
            .jobAlreadyCompleted(
              jobId:
                normalizedJobId
            )
        }

        guard processor != nil else {
          throw NativeScanCoordinatorError
            .processorUnavailable
        }

        if activeJobId ==
            normalizedJobId {
          return false
        }

        appendQueuedJobLocked(
          normalizedJobId
        )

        return activeJobId == nil
      }

    if shouldStart {
      startNextJobIfPossible()
    }
  }

  // MARK: - Record state

  func getRecord(
    jobId:
      String
  ) throws ->
      NativeScanPersistedRecord? {
    try stateQueue.sync {
      try assertReadyLocked()

      let normalizedJobId =
        try requireJobIdLocked(
          jobId
        )

      return records[
        normalizedJobId
      ]
    }
  }

  func getAllRecords()
    throws ->
      [NativeScanPersistedRecord] {
    try stateQueue.sync {
      try assertReadyLocked()

      return records
        .values
        .sorted(
          by:
            Self.compareRecords
        )
    }
  }

  func getPendingResults()
    throws ->
      [NativeScanJobResult] {
    try stateQueue.sync {
      try assertReadyLocked()

      return records
        .values
        .compactMap {
          record in

          guard let result =
                  record.result else {
            return nil
          }

          guard !acknowledgedResultJobIds
                  .contains(
                    result.jobId
                  ) else {
            return nil
          }

          return result
        }
        .sorted {
          if $0.completedAt !=
              $1.completedAt {
            return $0.completedAt <
              $1.completedAt
          }

          return $0.jobId <
            $1.jobId
        }
    }
  }
  // MARK: - Acknowledge result

func acknowledgeResult(
  jobId:
    String
) throws ->
    Bool {
  try stateQueue.sync {
    try assertReadyLocked()

    let normalizedJobId =
      try requireJobIdLocked(
        jobId
      )

    guard let record =
            records[
              normalizedJobId
            ],
          record.result !=
            nil else {
      return false
    }

    acknowledgedResultJobIds
      .insert(
        normalizedJobId
      )

    return true
  }
}

// MARK: - Cancel job

func cancel(
  jobId:
    String,
  reason:
    String? =
      nil
) throws ->
    Bool {

  var shouldEmit =
    false

  var cancelledEvent:
    NativeScanProcessingEvent?

  let cancelled =
    try stateQueue.sync {

      try assertReadyLocked()

      let normalizedJobId =
        try requireJobIdLocked(
          jobId
        )

      guard var record =
              records[
                normalizedJobId
              ] else {
        return false
      }

      guard record.result ==
              nil else {
        return false
      }

      if activeJobId ==
          normalizedJobId {

        activeCancellationToken?
          .cancel(
            reason:
              reason
          )

        processor?
          .cancel(
            jobId:
              normalizedJobId
          )

        return true
      }

      removeQueuedJobLocked(
        normalizedJobId
      )

      let timestamp =
        NativeProcessingTime.now()

      let processingError =
        NativeScanProcessingError(
          code:
            "NATIVE_PROCESSING_CANCELLED",
          message:
            normalizedCancellationMessage(
              reason
            ),
          source:
            .cancellation,
          retryable:
            false,
          occurredAt:
            timestamp,
          attempt:
            record
              .payload
              .options
              .currentAttempt,
          stage:
            record
              .progress
              .stage,
          nativeCode:
            nil,
          metadata:
            [:]
        )

      let result =
        try NativeScanJobResult
          .cancelled(
            job:
              record.payload,
            error:
              processingError,
            runtime:
              record.progress.runtime,
            nativeTaskId:
              record.progress.nativeTaskId,
            startedAt:
              record.progress.startedAt,
            completedAt:
              timestamp
          )

      let progress =
        record.progress
          .updating(
            status:
              "cancelled",
            executorState:
              .cancelled,
            stage:
              "cancelled",
            progress:
              record.progress.progress,
            message:
              processingError.message,
            updatedAt:
              timestamp,
            estimatedRemainingMs:
              nil,
            preserveEstimatedRemainingMs:
              false,
            applicationState:
              resolveApplicationState()
          )

      record =
        try record.completing(
          with:
            result,
          progress:
            progress,
          updatedAt:
            timestamp
        )

      try persistRecordLocked(
        record
      )

      try persistResultLocked(
        result
      )

      records[
        normalizedJobId
      ] =
        record

      acknowledgedResultJobIds
        .remove(
          normalizedJobId
        )

      cancelledEvent =
        NativeScanProcessingEvent(
          type:
            .cancelled,
          jobId:
            result.jobId,
          queueId:
            result.queueId,
          batchId:
            result.batchId,
          timestamp:
            timestamp,
          progress:
            progress,
          result:
            result,
          error:
            processingError
        )

      shouldEmit =
        true

      return true
    }

  if shouldEmit,
     let cancelledEvent {
    emit(
      cancelledEvent
    )
  }

  return cancelled
}

// MARK: - Interrupt active job

@discardableResult
func interruptActiveJob(
  jobId:
    String,
  reason:
    String
) -> Bool {
  let operation:
    (
      token:
        NativeScanCancellationToken,
      processor:
        NativeScanJobProcessing?
    )? =
      stateQueue.sync {
        guard initialized,
              !disposed,
              activeJobId ==
                jobId,
              let token =
                activeCancellationToken else {
          return nil
        }

        activeInterruptionReason =
          normalizeOptionalString(
            reason
          ) ??
          Self.restoredInterruptionMessage

        return (
          token:
            token,
          processor:
            processor
        )
      }

  guard let operation else {
    return false
  }

  operation.token.cancel(
    reason:
      reason
  )

  operation.processor?
    .cancel(
      jobId:
        jobId
    )

  return true
}
// MARK: - Remove job

func remove(
  jobId:
    String
) throws ->
    Bool {

  try stateQueue.sync {

    try assertReadyLocked()

    let normalizedJobId =
      try requireJobIdLocked(
        jobId
      )

    guard records[
            normalizedJobId
          ] != nil else {
      return false
    }

    guard activeJobId !=
            normalizedJobId else {
      throw NativeScanCoordinatorError
        .cannotRemoveActiveJob(
          jobId:
            normalizedJobId
        )
    }

    removeQueuedJobLocked(
      normalizedJobId
    )

    records.removeValue(
      forKey:
        normalizedJobId
    )

    acknowledgedResultJobIds
      .remove(
        normalizedJobId
      )

    try store.removeJob(
      jobId:
        normalizedJobId,
      includeRecord:
        true,
      includeResult:
        true,
      includeDiagnostics:
        true
    )

    return true
  }
}

// MARK: - Clear completed

func clearCompletedJobs()
throws ->
Int {

  try stateQueue.sync {

    try assertReadyLocked()

    let removable =
      records.values.filter {

        $0.result != nil &&
        $0.payload.jobId !=
        activeJobId

      }

    for record in removable {

      removeQueuedJobLocked(
        record.payload.jobId
      )

      records.removeValue(
        forKey:
          record.payload.jobId
      )

      acknowledgedResultJobIds
        .remove(
          record.payload.jobId
        )

      try store.removeJob(
        jobId:
          record.payload.jobId,
        includeRecord:
          true,
        includeResult:
          true,
        includeDiagnostics:
          true
      )
    }

    return removable.count
  }
}

// MARK: - Snapshot

func snapshot()
throws ->
NativeScanCoordinatorSnapshot {

  try stateQueue.sync {

    try assertNotDisposedLocked()

    let completed =
      records.values.filter {
        $0.result != nil
      }.count

    let pending =
      records.values.filter {

        guard
          let result =
            $0.result
        else {
          return false
        }

        return
          !acknowledgedResultJobIds
            .contains(
              result.jobId
            )

      }.count

    return NativeScanCoordinatorSnapshot(

      initialized:
        initialized,

      disposed:
        disposed,

      processorInstalled:
        processor != nil,

      activeJobId:
        activeJobId,

      activeNativeTaskId:
        activeNativeTaskId,

      queuedJobIds:
        queuedJobIds,

      recordCount:
        records.count,

      pendingResultCount:
        pending,

      completedResultCount:
        completed,

      runtime:
        runtime,

      lastInitializedAt:
        lastInitializedAt,

      lastExecutionStartedAt:
        lastExecutionStartedAt,

      lastExecutionCompletedAt:
        lastExecutionCompletedAt,

      lastError:
        lastError
    )
  }
}

// MARK: - Dispose

func dispose() {

  let task =
    stateQueue.sync {

      if disposed {
        return nil
      }

      disposed =
        true

      activeCancellationToken?
        .cancel(
          reason:
            Self.disposalCancellationReason
        )

      let task =
        activeExecutionTask

      activeExecutionTask =
        nil

      activeCancellationToken =
        nil

        activeInterruptionReason =
  nil

      activeJobId =
        nil

      activeNativeTaskId =
        nil

      queuedJobIds.removeAll()

      processor =
        nil

      eventHandler =
        nil

      return task
    }

  task?.cancel()
}
// MARK: - Start next job

private func startNextJobIfPossible() {
  let shouldSchedule =
    stateQueue.sync {
      guard initialized,
            !disposed,
            !startNextJobScheduled,
            activeJobId ==
              nil,
            processor !=
              nil,
            !queuedJobIds
              .isEmpty else {
        return false
      }

      startNextJobScheduled =
        true

      return true
    }

  guard shouldSchedule else {
    return
  }

  executionQueue.async {
    [weak self] in

    guard let self else {
      return
    }

    let execution:
      (
        job:
          NativeScanJob,
        record:
          NativeScanPersistedRecord,
        nativeTaskId:
          String,
        cancellationToken:
          NativeScanCancellationToken,
        processor:
          NativeScanJobProcessing,
        runtime:
          NativeScanProcessingRuntime
      )?

    do {
      execution =
        try self.stateQueue.sync {
          self.startNextJobScheduled =
            false

          try self
            .assertReadyLocked()

          guard self.activeJobId ==
                  nil else {
            return nil
          }

          guard let processor =
                  self.processor else {
            throw NativeScanCoordinatorError
              .processorUnavailable
          }

          guard let nextJobId =
                  self.nextQueuedJobIdLocked() else {
            return nil
          }

          guard var record =
                  self.records[
                    nextJobId
                  ] else {
            self.removeQueuedJobLocked(
              nextJobId
            )

            return nil
          }

          guard record.result ==
                  nil else {
            self.removeQueuedJobLocked(
              nextJobId
            )

            return nil
          }

          let timestamp =
            NativeProcessingTime.now()

          let nativeTaskId =
            self.normalizeOptionalString(
              record
                .progress
                .nativeTaskId
            ) ??
            self.createNativeTaskId(
              jobId:
                nextJobId
            )

          let cancellationToken =
            NativeScanCancellationToken()

          let startingProgress =
            record.progress
              .updating(
                status:
                  "preparing",
                executorState:
                  .starting,
                stage:
                  "preparing",
                progress:
                  max(
                    0,
                    min(
                      1,
                      record
                        .progress
                        .progress
                    )
                  ),
                message:
                  "Starting native processing.",
                startedAt:
                  timestamp,
                preserveExistingStartedAt:
                  false,
                updatedAt:
                  timestamp,
                estimatedRemainingMs:
                  nil,
                preserveEstimatedRemainingMs:
                  false,
                nativeTaskId:
                  nativeTaskId,
                preserveNativeTaskId:
                  false,
                runtime:
                  self.runtime,
                applicationState:
                  self.resolveApplicationState(),
                attempt:
                  record
                    .payload
                    .options
                    .currentAttempt
              )

          record =
            try record
              .updatingProgress(
                startingProgress,
                updatedAt:
                  timestamp
              )

          try self
            .persistRecordLocked(
              record
            )

          self.records[
            nextJobId
          ] =
            record

          self.removeQueuedJobLocked(
            nextJobId
          )

          self.activeJobId =
            nextJobId

          self.activeNativeTaskId =
            nativeTaskId

          self.activeCancellationToken =
            cancellationToken

          self.lastExecutionStartedAt =
            timestamp

          self.lastError =
            nil

          return (
            job:
              record.payload,
            record:
              record,
            nativeTaskId:
              nativeTaskId,
            cancellationToken:
              cancellationToken,
            processor:
              processor,
            runtime:
              self.runtime
          )
        }
    } catch {
      self.stateQueue.sync {
        self.startNextJobScheduled =
          false

        self.lastError =
          error.localizedDescription
      }

      return
    }

    guard let execution else {
      return
    }

    self.emit(
      NativeScanProcessingEvent(
        type:
          .started,
        jobId:
          execution.job.jobId,
        queueId:
          execution.job.queueId,
        batchId:
          execution.job.batchId,
        timestamp:
          execution
            .record
            .progress
            .updatedAt,
        progress:
          execution
            .record
            .progress,
        result:
          nil,
        error:
          nil
      )
    )

    let task =
      Task {
        [weak self] in

        guard let self else {
          return
        }

        await self.execute(
          job:
            execution.job,
          nativeTaskId:
            execution.nativeTaskId,
          cancellationToken:
            execution.cancellationToken,
          processor:
            execution.processor,
          runtime:
            execution.runtime
        )
      }

    self.stateQueue.sync {
      guard self.activeJobId ==
              execution
                .job
                .jobId,
            !self.disposed else {
        task.cancel()

        return
      }

      self.activeExecutionTask =
        task
    }
  }
}

// MARK: - Execute job

private func execute(
  job:
    NativeScanJob,
  nativeTaskId:
    String,
  cancellationToken:
    NativeScanCancellationToken,
  processor:
    NativeScanJobProcessing,
  runtime:
    NativeScanProcessingRuntime
) async {
  let startedAt =
    NativeProcessingTime.now()

  do {
    try cancellationToken
      .throwIfCancelled()

    try Task
      .checkCancellation()

    await updateProgress(
      jobId:
        job.jobId,
      status:
        "processing",
      executorState:
        .running,
      stage:
        "load-image",
      progress:
        0.01,
      message:
        "Native processing started.",
      estimatedRemainingMs:
        nil
    )

    let context =
      NativeScanProcessorContext(
        nativeTaskId:
          nativeTaskId,
        runtime:
          runtime,
        attempt:
          job
            .options
            .currentAttempt,
        startedAt:
          startedAt,
        cancellationToken:
          cancellationToken,
        reportProgress: {
          [weak self]
          stage,
          progress,
          message,
          estimatedRemainingMs in

          guard let self else {
            return
          }

          await self.updateProgress(
            jobId:
              job.jobId,
            status:
              "processing",
            executorState:
              .running,
            stage:
              stage,
            progress:
              progress,
            message:
              message,
            estimatedRemainingMs:
              estimatedRemainingMs
          )
        }
      )

    let output =
      try await processor
        .process(
          job:
            job,
          context:
            context
        )

    try cancellationToken
      .throwIfCancelled()

    try Task
      .checkCancellation()

    try completeSuccessfully(
      job:
        job,
      output:
        output,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt
    )
  } catch {

  let interruptionReason =
  stateQueue.sync {
    guard activeJobId ==
            job.jobId else {
      return nil
    }

    return activeInterruptionReason
  }

if let interruptionReason {
  handleInterruption(
    job:
      job,
    runtime:
      runtime,
    nativeTaskId:
      nativeTaskId,
    startedAt:
      startedAt,
    reason:
      interruptionReason
  )
} else {
  let wasCancelled =
    cancellationToken
      .isCancelled ||
    Task.isCancelled ||
    isCancellationError(
      error
    )

  if wasCancelled {
    handleCancellation(
      job:
        job,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt,
      reason:
        cancellationToken
          .reason ??
        cancellationReason(
          from:
            error
        )
    )
  } else {
    handleFailure(
      job:
        job,
      runtime:
        runtime,
      nativeTaskId:
        nativeTaskId,
      startedAt:
        startedAt,
      error:
        error
    )
  }
}

  finishActiveExecution(
    jobId:
      job.jobId
  )

  startNextJobIfPossible()
}

// MARK: - Update progress

private func updateProgress(
  jobId:
    String,
  status:
    String,
  executorState:
    NativeScanExecutorState,
  stage:
    String,
  progress:
    Double,
  message:
    String,
  estimatedRemainingMs:
    Int64?
) async {
  let event:
    NativeScanProcessingEvent?

  event =
    stateQueue.sync {
      guard initialized,
            !disposed,
            activeJobId ==
              jobId,
            var record =
              records[
                jobId
              ],
            record.result ==
              nil else {
        return nil
      }

      do {
        let timestamp =
          NativeProcessingTime.now()

        let normalizedProgress =
          normalizeProgress(
            progress
          )

        let normalizedStage =
          normalizeRequiredString(
            stage,
            fallback:
              record
                .progress
                .stage
          )

        let normalizedMessage =
          normalizeRequiredString(
            message,
            fallback:
              record
                .progress
                .message
          )

        let normalizedEstimatedRemainingMs:
          Int64?

        if let estimatedRemainingMs {
          normalizedEstimatedRemainingMs =
            max(
              0,
              estimatedRemainingMs
            )
        } else {
          normalizedEstimatedRemainingMs =
            nil
        }

        let updatedProgress =
          record.progress
            .updating(
              status:
                normalizeRequiredString(
                  status,
                  fallback:
                    "processing"
                ),
              executorState:
                executorState,
              stage:
                normalizedStage,
              progress:
                max(
                  record
                    .progress
                    .progress,
                  normalizedProgress
                ),
              message:
                normalizedMessage,
              updatedAt:
                timestamp,
              estimatedRemainingMs:
                normalizedEstimatedRemainingMs,
              preserveEstimatedRemainingMs:
                estimatedRemainingMs ==
                  nil,
              nativeTaskId:
                activeNativeTaskId,
              preserveNativeTaskId:
                true,
              runtime:
                runtime,
              applicationState:
                resolveApplicationState()
            )

        record =
          try record
            .updatingProgress(
              updatedProgress,
              updatedAt:
                timestamp
            )

        try persistRecordLocked(
          record
        )

        records[
          jobId
        ] =
          record

        lastError =
          nil

        return NativeScanProcessingEvent(
          type:
            .progress,
          jobId:
            record
              .payload
              .jobId,
          queueId:
            record
              .payload
              .queueId,
          batchId:
            record
              .payload
              .batchId,
          timestamp:
            timestamp,
          progress:
            updatedProgress,
          result:
            nil,
          error:
            nil
        )
      } catch {
        lastError =
          error.localizedDescription

        return nil
      }
    }

  if let event {
    emit(
      event
    )
  }
}

// MARK: - Successful completion

private func completeSuccessfully(
  job:
    NativeScanJob,
  output:
    NativeScanProcessingOutput,
  runtime:
    NativeScanProcessingRuntime,
  nativeTaskId:
    String,
  startedAt:
    NativeProcessingTimestamp
) throws {
  let event =
    try stateQueue.sync {
      try assertReadyLocked()

      guard activeJobId ==
              job.jobId else {
        throw NativeScanCoordinatorError
          .activeJobMismatch(
            expectedJobId:
              activeJobId,
            receivedJobId:
              job.jobId
          )
      }

      guard var record =
              records[
                job.jobId
              ] else {
        throw NativeScanCoordinatorError
          .jobNotFound(
            jobId:
              job.jobId
          )
      }

      guard record.result ==
              nil else {
        throw NativeScanCoordinatorError
          .jobAlreadyCompleted(
            jobId:
              job.jobId
          )
      }

      let timestamp =
        NativeProcessingTime.now()

      let result =
        try NativeScanJobResult
          .success(
            job:
              job,
            output:
              output,
            runtime:
              runtime,
            nativeTaskId:
              nativeTaskId,
            startedAt:
              startedAt,
            completedAt:
              timestamp
          )

      let completedProgress =
        record.progress
          .updating(
            status:
              "completed",
            executorState:
              .completed,
            stage:
              "complete",
            progress:
              1,
            message:
              "Native processing completed.",
            updatedAt:
              timestamp,
            estimatedRemainingMs:
              nil,
            preserveEstimatedRemainingMs:
              false,
            nativeTaskId:
              nativeTaskId,
            preserveNativeTaskId:
              false,
            runtime:
              runtime,
            applicationState:
              resolveApplicationState()
          )

      record =
        try record
          .completing(
            with:
              result,
            progress:
              completedProgress,
            updatedAt:
              timestamp
          )

      /*
       * نحفظ Result أولًا ثم Record.
       *
       * في حالة انقطاع الكتابة بينهما، الاسترجاع يستطيع
       * قراءة Result وإكمال Record النهائي.
       */
      try persistResultLocked(
        result
      )

      do {
        try persistRecordLocked(
          record
        )
      } catch {
        try? store
          .removeResultData(
            jobId:
              job.jobId
          )

        throw error
      }

      records[
        job.jobId
      ] =
        record

      acknowledgedResultJobIds
        .remove(
          job.jobId
        )

      lastExecutionCompletedAt =
        timestamp

      lastError =
        nil

      return NativeScanProcessingEvent(
        type:
          .completed,
        jobId:
          job.jobId,
        queueId:
          job.queueId,
        batchId:
          job.batchId,
        timestamp:
          timestamp,
        progress:
          completedProgress,
        result:
          result,
        error:
          nil
      )
    }

  emit(
    event
  )
}

// MARK: - Failure

private func handleFailure(
  job:
    NativeScanJob,
  runtime:
    NativeScanProcessingRuntime,
  nativeTaskId:
    String,
  startedAt:
    NativeProcessingTimestamp,
  error:
    Error
) {
  let event:
    NativeScanProcessingEvent? =
      stateQueue.sync {
        guard initialized,
              !disposed,
              var record =
                records[
                  job.jobId
                ],
              record.result ==
                nil else {
          return nil
        }

        do {
          let timestamp =
            NativeProcessingTime.now()

          let processingError =
            NativeScanProcessingError
              .from(
                error,
                code:
                  resolveErrorCode(
                    error
                  ),
                source:
                  resolveErrorSource(
                    error
                  ),
                retryable:
                  resolveRetryable(
                    error
                  ),
                attempt:
                  job
                    .options
                    .currentAttempt,
                stage:
                  record
                    .progress
                    .stage,
                nativeCode:
                  nil
              )

          let result =
            try NativeScanJobResult
              .failure(
                job:
                  job,
                error:
                  processingError,
                runtime:
                  runtime,
                nativeTaskId:
                  nativeTaskId,
                startedAt:
                  startedAt,
                completedAt:
                  timestamp
              )

          let failedProgress =
            record.progress
              .updating(
                status:
                  "failed",
                executorState:
                  .failed,
                stage:
                  "failed",
                progress:
                  record
                    .progress
                    .progress,
                message:
                  processingError
                    .message,
                updatedAt:
                  timestamp,
                estimatedRemainingMs:
                  nil,
                preserveEstimatedRemainingMs:
                  false,
                nativeTaskId:
                  nativeTaskId,
                preserveNativeTaskId:
                  false,
                runtime:
                  runtime,
                applicationState:
                  resolveApplicationState()
              )

          record =
            try record
              .completing(
                with:
                  result,
                progress:
                  failedProgress,
                updatedAt:
                  timestamp
              )

          try persistResultLocked(
            result
          )

          do {
            try persistRecordLocked(
              record
            )
          } catch {
            try? store
              .removeResultData(
                jobId:
                  job.jobId
              )

            throw error
          }

          records[
            job.jobId
          ] =
            record

          acknowledgedResultJobIds
            .remove(
              job.jobId
            )

          lastExecutionCompletedAt =
            timestamp

          lastError =
            processingError
              .message

          return NativeScanProcessingEvent(
            type:
              .failed,
            jobId:
              job.jobId,
            queueId:
              job.queueId,
            batchId:
              job.batchId,
            timestamp:
              timestamp,
            progress:
              failedProgress,
            result:
              result,
            error:
              processingError
          )
        } catch {
          lastError =
            error.localizedDescription

          return nil
        }
      }

  if let event {
    emit(
      event
    )
  }
}

// MARK: - Cancellation completion

private func handleCancellation(
  job:
    NativeScanJob,
  runtime:
    NativeScanProcessingRuntime,
  nativeTaskId:
    String,
  startedAt:
    NativeProcessingTimestamp,
  reason:
    String?
) {
  let event:
    NativeScanProcessingEvent? =
      stateQueue.sync {
        guard initialized,
              !disposed,
              var record =
                records[
                  job.jobId
                ],
              record.result ==
                nil else {
          return nil
        }

        do {
          let timestamp =
            NativeProcessingTime.now()

          let cancellationError =
            NativeScanProcessingError(
              code:
                "NATIVE_PROCESSING_CANCELLED",
              message:
                normalizedCancellationMessage(
                  reason
                ),
              source:
                .cancellation,
              retryable:
                false,
              occurredAt:
                timestamp,
              attempt:
                job
                  .options
                  .currentAttempt,
              stage:
                record
                  .progress
                  .stage,
              nativeCode:
                nil,
              metadata:
                [:]
            )

          let result =
            try NativeScanJobResult
              .cancelled(
                job:
                  job,
                error:
                  cancellationError,
                runtime:
                  runtime,
                nativeTaskId:
                  nativeTaskId,
                startedAt:
                  startedAt,
                completedAt:
                  timestamp
              )

          let cancelledProgress =
            record.progress
              .updating(
                status:
                  "cancelled",
                executorState:
                  .cancelled,
                stage:
                  "cancelled",
                progress:
                  record
                    .progress
                    .progress,
                message:
                  cancellationError
                    .message,
                updatedAt:
                  timestamp,
                estimatedRemainingMs:
                  nil,
                preserveEstimatedRemainingMs:
                  false,
                nativeTaskId:
                  nativeTaskId,
                preserveNativeTaskId:
                  false,
                runtime:
                  runtime,
                applicationState:
                  resolveApplicationState()
              )

          record =
            try record
              .completing(
                with:
                  result,
                progress:
                  cancelledProgress,
                updatedAt:
                  timestamp
              )

          try persistResultLocked(
            result
          )

          do {
            try persistRecordLocked(
              record
            )
          } catch {
            try? store
              .removeResultData(
                jobId:
                  job.jobId
              )

            throw error
          }

          records[
            job.jobId
          ] =
            record

          acknowledgedResultJobIds
            .remove(
              job.jobId
            )

          lastExecutionCompletedAt =
            timestamp

          lastError =
            nil

          return NativeScanProcessingEvent(
            type:
              .cancelled,
            jobId:
              job.jobId,
            queueId:
              job.queueId,
            batchId:
              job.batchId,
            timestamp:
              timestamp,
            progress:
              cancelledProgress,
            result:
              result,
            error:
              cancellationError
          )
        } catch {
          lastError =
            error.localizedDescription

          return nil
        }
      }

  if let event {
    emit(
      event
    )
  }
}

// MARK: - Interruption completion

private func handleInterruption(
  job:
    NativeScanJob,
  runtime:
    NativeScanProcessingRuntime,
  nativeTaskId:
    String,
  startedAt:
    NativeProcessingTimestamp,
  reason:
    String
) {
  let event:
    NativeScanProcessingEvent? =
      stateQueue.sync {
        guard initialized,
              !disposed,
              var record =
                records[
                  job.jobId
                ],
              record.result ==
                nil else {
          return nil
        }

        do {
          let timestamp =
            NativeProcessingTime.now()

          let processingError =
            NativeScanProcessingError(
              code:
                "NATIVE_PROCESSING_INTERRUPTED",
              message:
                normalizeRequiredString(
                  reason,
                  fallback:
                    Self.restoredInterruptionMessage
                ),
              source:
                .expiration,
              retryable:
                true,
              occurredAt:
                timestamp,
              attempt:
                job
                  .options
                  .currentAttempt,
              stage:
                record
                  .progress
                  .stage,
              nativeCode:
                nil,
              metadata:
                [:]
            )

          let result =
            try NativeScanJobResult
              .interrupted(
                job:
                  job,
                error:
                  processingError,
                runtime:
                  runtime,
                nativeTaskId:
                  nativeTaskId,
                startedAt:
                  startedAt,
                completedAt:
                  timestamp
              )

          let interruptedProgress =
            record.progress
              .updating(
                status:
                  "interrupted",
                executorState:
                  .interrupted,
                stage:
                  "interrupted",
                progress:
                  record
                    .progress
                    .progress,
                message:
                  processingError.message,
                updatedAt:
                  timestamp,
                estimatedRemainingMs:
                  nil,
                preserveEstimatedRemainingMs:
                  false,
                nativeTaskId:
                  nativeTaskId,
                preserveNativeTaskId:
                  false,
                runtime:
                  runtime,
                applicationState:
                  resolveApplicationState()
              )

          record =
            try record
              .completing(
                with:
                  result,
                progress:
                  interruptedProgress,
                updatedAt:
                  timestamp
              )

          try persistResultLocked(
            result
          )

          do {
            try persistRecordLocked(
              record
            )
          } catch {
            try? store
              .removeResultData(
                jobId:
                  job.jobId
              )

            throw error
          }

          records[
            job.jobId
          ] =
            record

          acknowledgedResultJobIds
            .remove(
              job.jobId
            )

          lastExecutionCompletedAt =
            timestamp

          lastError =
            processingError.message

          return NativeScanProcessingEvent(
            type:
              .interrupted,
            jobId:
              job.jobId,
            queueId:
              job.queueId,
            batchId:
              job.batchId,
            timestamp:
              timestamp,
            progress:
              interruptedProgress,
            result:
              result,
            error:
              processingError
          )
        } catch {
          lastError =
            error.localizedDescription

          return nil
        }
      }

  if let event {
    emit(
      event
    )
  }
}

// MARK: - Finish active execution

private func finishActiveExecution(
  jobId:
    String
) {
  stateQueue.sync {
    guard activeJobId ==
            jobId else {
      return
    }

    activeJobId =
      nil

    activeNativeTaskId =
      nil

    activeCancellationToken =
      nil

      activeInterruptionReason =
  nil

    activeExecutionTask =
      nil

    startNextJobScheduled =
      false
  }
}
// MARK: - Restore records

private func restoreRecordsLocked()
  throws {
  let jobs =
    try store
      .loadAllJobs()

  records
    .removeAll(
      keepingCapacity:
        true
    )

  queuedJobIds
    .removeAll(
      keepingCapacity:
        true
    )

  acknowledgedResultJobIds
    .removeAll(
      keepingCapacity:
        true
    )

  activeJobId =
    nil

  activeNativeTaskId =
    nil

  activeCancellationToken =
    nil

    activeInterruptionReason =
  nil

  activeExecutionTask =
    nil

  startNextJobScheduled =
    false

  for storedJob in jobs {
    let job =
      try storedJob
        .validated()

    var restoredRecord =
      try restoreRecordLocked(
        for:
          job
      )

    restoredRecord =
      try restoreResultIfAvailableLocked(
        for:
          job,
        record:
          restoredRecord
      )

    if restoredRecord.result ==
        nil {
      restoredRecord =
        try markRestoredRecordInterruptedLocked(
          restoredRecord
        )
    } else {
      /*
       * نحفظ Record مرة أخرى لضمان تطابقه مع
       * Result المسترجع من ملف النتيجة.
       */
      try persistRecordLocked(
        restoredRecord
      )
    }

    records[
      job.jobId
    ] =
      restoredRecord
  }

  sortQueuedJobsLocked()
}

private func restoreRecordLocked(
  for job:
    NativeScanJob
) throws ->
    NativeScanPersistedRecord {
  guard let recordData =
          try store
            .loadRecordData(
              jobId:
                job.jobId
            ) else {
    let initialRecord =
      try NativeScanPersistedRecord
        .initial(
          for:
            job
        )

    try persistRecordLocked(
      initialRecord
    )

    return initialRecord
  }

  do {
    let decodedRecord =
      try NativeScanPersistedRecord
        .decode(
          from:
            recordData
        )

    guard decodedRecord
            .payload
            .jobId ==
            job.jobId else {
      throw NativeScanCoordinatorError
        .restoredRecordJobMismatch(
          expectedJobId:
            job.jobId,
          receivedJobId:
            decodedRecord
              .payload
              .jobId
        )
    }

    /*
     * ملف Job هو المرجع الأساسي للـPayload.
     *
     * إذا كانت نسخة Record قديمة أو غير متطابقة،
     * ننشئ Record جديدة بدل تشغيل بيانات متناقضة.
     */
    guard decodedRecord.payload ==
            job else {
      let replacementRecord =
        try NativeScanPersistedRecord
          .initial(
            for:
              job
          )

      try persistRecordLocked(
        replacementRecord
      )

      return replacementRecord
    }

    return decodedRecord
  } catch {
    /*
     * تلف Record لا يلغي Job السليمة.
     * نعيد بناء الحالة من Job نفسها.
     */
    let replacementRecord =
      try NativeScanPersistedRecord
        .initial(
          for:
            job
        )

    try persistRecordLocked(
      replacementRecord
    )

    return replacementRecord
  }
}

private func restoreResultIfAvailableLocked(
  for job:
    NativeScanJob,
  record:
    NativeScanPersistedRecord
) throws ->
    NativeScanPersistedRecord {
  if record.result !=
      nil {
    return record
  }

  guard let resultData =
          try store
            .loadResultData(
              jobId:
                job.jobId
            ) else {
    return record
  }

  do {
    let restoredResult =
      try NativeScanJobResult
        .decode(
          from:
            resultData
        )

    guard restoredResult.jobId ==
            job.jobId else {
      throw NativeScanCoordinatorError
        .restoredResultJobMismatch(
          expectedJobId:
            job.jobId,
          receivedJobId:
            restoredResult.jobId
        )
    }

    guard restoredResult.queueId ==
            job.queueId,
          restoredResult.batchId ==
            job.batchId,
          restoredResult.requestId ==
            job.requestId,
          restoredResult.wardrobeItemId ==
            job.wardrobeItemId else {
      throw NativeScanCoordinatorError
        .restoredResultContractMismatch(
          jobId:
            job.jobId
        )
    }

    let timestamp =
      max(
        record.updatedAt,
        restoredResult.completedAt
      )

    let terminalProgress =
      createTerminalProgressLocked(
        record:
          record,
        result:
          restoredResult,
        timestamp:
          timestamp
      )

    return try record
      .completing(
        with:
          restoredResult,
        progress:
          terminalProgress,
        updatedAt:
          timestamp
      )
  } catch {
    /*
     * Result تالفة لا يجب أن تجعل Job ناجحة وهميًا.
     * نحذف النتيجة التالفة، ثم نعيد Job إلى interrupted.
     */
    try? store
      .removeResultData(
        jobId:
          job.jobId
      )

    return record
  }
}

private func markRestoredRecordInterruptedLocked(
  _ record:
    NativeScanPersistedRecord
) throws ->
    NativeScanPersistedRecord {
  let timestamp =
    NativeProcessingTime.now()

  let interruptedProgress =
    record.progress
      .updating(
        status:
          "interrupted",
        executorState:
          .interrupted,
        stage:
          "interrupted",
        progress:
          normalizeProgress(
            record
              .progress
              .progress
          ),
        message:
          Self
            .restoredInterruptionMessage,
        updatedAt:
          timestamp,
        estimatedRemainingMs:
          nil,
        preserveEstimatedRemainingMs:
          false,
        nativeTaskId:
          record
            .progress
            .nativeTaskId,
        preserveNativeTaskId:
          true,
        runtime:
          runtime,
        applicationState:
          resolveApplicationState(),
        attempt:
          record
            .payload
            .options
            .currentAttempt
      )

  let updatedRecord =
    try record
      .updatingProgress(
        interruptedProgress,
        updatedAt:
          timestamp
      )

  try persistRecordLocked(
    updatedRecord
  )

  appendQueuedJobLocked(
    record
      .payload
      .jobId
  )

  return updatedRecord
}

// MARK: - Persist state

private func persistRecordLocked(
  _ record:
    NativeScanPersistedRecord
) throws {
  let data =
    try record
      .encodedData()

  try store
    .saveRecordData(
      data,
      jobId:
        record
          .payload
          .jobId
    )
}

private func persistResultLocked(
  _ result:
    NativeScanJobResult
) throws {
  let data =
    try result
      .encodedData()

  try store
    .saveResultData(
      data,
      jobId:
        result.jobId
    )
}

// MARK: - Queue helpers

private func appendQueuedJobLocked(
  _ jobId:
    String
) {
  guard records[
          jobId
        ]?
        .result ==
        nil else {
    return
  }

  guard activeJobId !=
          jobId else {
    return
  }

  guard !queuedJobIds
          .contains(
            jobId
          ) else {
    return
  }

  queuedJobIds
    .append(
      jobId
    )

  sortQueuedJobsLocked()
}

private func removeQueuedJobLocked(
  _ jobId:
    String
) {
  queuedJobIds
    .removeAll {
      $0 ==
        jobId
    }
}

private func nextQueuedJobIdLocked()
  -> String? {
  while let firstJobId =
    queuedJobIds.first {
    guard let record =
            records[
              firstJobId
            ] else {
      queuedJobIds
        .removeFirst()

      continue
    }

    guard record.result ==
            nil else {
      queuedJobIds
        .removeFirst()

      continue
    }

    guard firstJobId !=
            activeJobId else {
      queuedJobIds
        .removeFirst()

      continue
    }

    return firstJobId
  }

  return nil
}

private func sortQueuedJobsLocked() {
  queuedJobIds =
    Array(
      Set(
        queuedJobIds
      )
    )
    .filter {
      jobId in

      guard let record =
              records[
                jobId
              ] else {
        return false
      }

      return record.result ==
        nil &&
        jobId !=
        activeJobId
    }
    .sorted {
      leftJobId,
      rightJobId in

      guard let leftRecord =
              records[
                leftJobId
              ],
            let rightRecord =
              records[
                rightJobId
              ] else {
        return leftJobId <
          rightJobId
      }

      return Self.compareRecords(
        leftRecord,
        rightRecord
      )
    }
}

private static func compareRecords(
  _ left:
    NativeScanPersistedRecord,
  _ right:
    NativeScanPersistedRecord
) -> Bool {
  if left.payload.priority !=
      right.payload.priority {
    return left.payload.priority >
      right.payload.priority
  }

  if left.createdAt !=
      right.createdAt {
    return left.createdAt <
      right.createdAt
  }

  return left.payload.jobId <
    right.payload.jobId
}

// MARK: - Event emission

private func emit(
  _ event:
    NativeScanProcessingEvent
) {
  let handler =
    stateQueue.sync {
      guard !disposed else {
        return nil
      }

      return eventHandler
    }

  guard let handler else {
    return
  }

  DispatchQueue.main.async {
    handler(
      event
    )
  }
}

// MARK: - State guards

private func assertReadyLocked()
  throws {
  try assertNotDisposedLocked()

  guard initialized else {
    throw NativeScanCoordinatorError
      .notInitialized
  }
}

private func assertNotDisposedLocked()
  throws {
  guard !disposed else {
    throw NativeScanCoordinatorError
      .disposed
  }
}

private func requireJobIdLocked(
  _ jobId:
    String
) throws ->
    String {
  let normalizedJobId =
    jobId
      .trimmingCharacters(
        in:
          .whitespacesAndNewlines
      )

  guard !normalizedJobId
          .isEmpty else {
    throw NativeScanCoordinatorError
      .missingJobId
  }

  guard normalizedJobId.count <=
          Self
            .maximumJobIdLength else {
    throw NativeScanCoordinatorError
      .jobIdTooLong(
        maximumLength:
          Self
            .maximumJobIdLength
      )
  }

  return normalizedJobId
}

// MARK: - Identifier helpers

private func createNativeTaskId(
  jobId:
    String
) -> String {
  let safeJobId =
    jobId
      .replacingOccurrences(
        of:
          " ",
        with:
          "-"
      )
      .replacingOccurrences(
        of:
          "/",
        with:
          "-"
      )
      .replacingOccurrences(
        of:
          "\\",
        with:
          "-"
      )

  return
    "ios-\(safeJobId)-\(UUID().uuidString)"
}

// MARK: - Normalization helpers

private func normalizeOptionalString(
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

private func normalizeRequiredString(
  _ value:
    String,
  fallback:
    String
) -> String {
  let normalizedValue =
    value
      .trimmingCharacters(
        in:
          .whitespacesAndNewlines
      )

  if !normalizedValue.isEmpty {
    return normalizedValue
  }

  let normalizedFallback =
    fallback
      .trimmingCharacters(
        in:
          .whitespacesAndNewlines
      )

  return normalizedFallback.isEmpty
    ? "unknown"
    : normalizedFallback
}

private func normalizeProgress(
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

private func normalizedCancellationMessage(
  _ reason:
    String?
) -> String {
  normalizeOptionalString(
    reason
  ) ??
  Self.defaultCancellationReason
}

// MARK: - Application state

private func resolveApplicationState()
  -> NativeScanApplicationState {
  /*
   * UIApplication يجب أن تُقرأ من Main Thread.
   *
   * أغلب تحديثات Coordinator تتم على stateQueue،
   * لذلك لا ننفذ main.sync حتى لا يحدث Deadlock
   * عندما يكون Main Thread منتظرًا stateQueue.
   */
  guard Thread.isMainThread else {
    return .unknown
  }

  switch UIApplication
    .shared
    .applicationState {
  case .active:
    return .active

  case .inactive:
    return .inactive

  case .background:
    return .background

  @unknown default:
    return .unknown
  }
}

// MARK: - Terminal progress restoration

private func createTerminalProgressLocked(
  record:
    NativeScanPersistedRecord,
  result:
    NativeScanJobResult,
  timestamp:
    NativeProcessingTimestamp
) -> NativeScanProcessingProgress {
  if result.succeeded {
    return record.progress
      .updating(
        status:
          "completed",
        executorState:
          .completed,
        stage:
          "complete",
        progress:
          1,
        message:
          "Native processing completed.",
        startedAt:
          result.startedAt,
        preserveExistingStartedAt:
          false,
        updatedAt:
          timestamp,
        estimatedRemainingMs:
          nil,
        preserveEstimatedRemainingMs:
          false,
        nativeTaskId:
          result.nativeTaskId,
        preserveNativeTaskId:
          false,
        runtime:
          result.runtime,
        applicationState:
          resolveApplicationState(),
        attempt:
          result.attempt
      )
  }

  if result.cancelled {
    return record.progress
      .updating(
        status:
          "cancelled",
        executorState:
          .cancelled,
        stage:
          "cancelled",
        progress:
          normalizeProgress(
            record
              .progress
              .progress
          ),
        message:
          result
            .error?
            .message ??
          Self
            .defaultCancellationReason,
        startedAt:
          result.startedAt,
        preserveExistingStartedAt:
          false,
        updatedAt:
          timestamp,
        estimatedRemainingMs:
          nil,
        preserveEstimatedRemainingMs:
          false,
        nativeTaskId:
          result.nativeTaskId,
        preserveNativeTaskId:
          false,
        runtime:
          result.runtime,
        applicationState:
          resolveApplicationState(),
        attempt:
          result.attempt
      )
  }

  if result.expired {
    return record.progress
      .updating(
        status:
          "failed",
        executorState:
          .expired,
        stage:
          "expired",
        progress:
          normalizeProgress(
            record
              .progress
              .progress
          ),
        message:
          result
            .error?
            .message ??
          "Native processing expired.",
        startedAt:
          result.startedAt,
        preserveExistingStartedAt:
          false,
        updatedAt:
          timestamp,
        estimatedRemainingMs:
          nil,
        preserveEstimatedRemainingMs:
          false,
        nativeTaskId:
          result.nativeTaskId,
        preserveNativeTaskId:
          false,
        runtime:
          result.runtime,
        applicationState:
          resolveApplicationState(),
        attempt:
          result.attempt
      )
  }

  if result.interrupted {
    return record.progress
      .updating(
        status:
          "interrupted",
        executorState:
          .interrupted,
        stage:
          "interrupted",
        progress:
          normalizeProgress(
            record
              .progress
              .progress
          ),
        message:
          result
            .error?
            .message ??
          Self
            .restoredInterruptionMessage,
        startedAt:
          result.startedAt,
        preserveExistingStartedAt:
          false,
        updatedAt:
          timestamp,
        estimatedRemainingMs:
          nil,
        preserveEstimatedRemainingMs:
          false,
        nativeTaskId:
          result.nativeTaskId,
        preserveNativeTaskId:
          false,
        runtime:
          result.runtime,
        applicationState:
          resolveApplicationState(),
        attempt:
          result.attempt
      )
  }

  return record.progress
    .updating(
      status:
        "failed",
      executorState:
        .failed,
      stage:
        "failed",
      progress:
        normalizeProgress(
          record
            .progress
            .progress
        ),
      message:
        result
          .error?
          .message ??
        "Native processing failed.",
      startedAt:
        result.startedAt,
      preserveExistingStartedAt:
        false,
      updatedAt:
        timestamp,
      estimatedRemainingMs:
        nil,
      preserveEstimatedRemainingMs:
        false,
      nativeTaskId:
        result.nativeTaskId,
      preserveNativeTaskId:
        false,
      runtime:
        result.runtime,
      applicationState:
        resolveApplicationState(),
      attempt:
        result.attempt
    )
}

// MARK: - Cancellation classification

private func isCancellationError(
  _ error:
    Error
) -> Bool {
  if error is
      CancellationError {
    return true
  }

  if let coordinatorError =
      error as?
        NativeScanCoordinatorError {
    switch coordinatorError {
    case .cancelled:
      return true

    default:
      return false
    }
  }

  if let processorError =
      error as?
        NativeScanProcessorError {
    switch processorError {
    case .cancelled:
      return true

    default:
      return false
    }
  }

  return false
}

private func cancellationReason(
  from error:
    Error
) -> String? {
  if let coordinatorError =
      error as?
        NativeScanCoordinatorError {
    switch coordinatorError {
    case .cancelled(
      let reason
    ):
      return normalizeOptionalString(
        reason
      )

    default:
      break
    }
  }

  if let processorError =
      error as?
        NativeScanProcessorError {
    switch processorError {
    case .cancelled(
      let reason
    ):
      return normalizeOptionalString(
        reason
      )

    default:
      break
    }
  }

  if error is
      CancellationError {
    return Self
      .defaultCancellationReason
  }

  return normalizeOptionalString(
    error.localizedDescription
  )
}

// MARK: - Error classification

private func resolveErrorCode(
  _ error:
    Error
) -> String {
  if isCancellationError(
    error
  ) {
    return
      "NATIVE_PROCESSING_CANCELLED"
  }

  if let coordinatorError =
      error as?
        NativeScanCoordinatorError {
    switch coordinatorError {
    case .processorUnavailable:
      return
        "NATIVE_PROCESSOR_UNAVAILABLE"

    case .jobNotFound:
      return
        "NATIVE_PROCESSING_JOB_NOT_FOUND"

    case .jobAlreadyCompleted:
      return
        "NATIVE_PROCESSING_ALREADY_COMPLETED"

    case .activeJobMismatch:
      return
        "NATIVE_PROCESSING_ACTIVE_JOB_MISMATCH"

    case .disposed:
      return
        "NATIVE_PROCESSING_COORDINATOR_DISPOSED"

    case .notInitialized:
      return
        "NATIVE_PROCESSING_NOT_INITIALIZED"

    default:
      return
        "NATIVE_PROCESSING_FAILED"
    }
  }

  if error is
      NativeScanJobValidationError {
    return
      "INVALID_NATIVE_PROCESSING_PAYLOAD"
  }

  if error is
      NativeScanJobStoreError {
    return
      "NATIVE_PROCESSING_STORAGE_FAILED"
  }

  if error is
      NativeScanProcessorError {
    return
      "NATIVE_SCAN_PROCESSOR_FAILED"
  }

  return
    "NATIVE_PROCESSING_FAILED"
}

private func resolveErrorSource(
  _ error:
    Error
) -> NativeScanProcessingErrorSource {
  if isCancellationError(
    error
  ) {
    return .cancellation
  }

  if error is
      NativeScanJobStoreError {
    return .storage
  }

  if error is
      NativeScanJobValidationError {
    return .source
  }

  if let coordinatorError =
      error as?
        NativeScanCoordinatorError {
    switch coordinatorError {
    case .processorUnavailable:
      return .scheduler

    case .notInitialized,
         .disposed:
      return .scheduler

    default:
      return .unknown
    }
  }

  if error is
      NativeScanProcessorError {
    return .model
  }

  return .unknown
}

private func resolveRetryable(
  _ error:
    Error
) -> Bool {
  if isCancellationError(
    error
  ) {
    return false
  }

  if error is
      NativeScanJobValidationError {
    return false
  }

  if let coordinatorError =
      error as?
        NativeScanCoordinatorError {
    switch coordinatorError {
    case .disposed,
         .missingJobId,
         .jobIdTooLong,
         .jobAlreadyCompleted,
         .cannotRemoveActiveJob,
         .activeJobMismatch,
         .restoredRecordJobMismatch,
         .restoredResultJobMismatch,
         .restoredResultContractMismatch:
      return false

    case .notInitialized,
         .jobNotFound,
         .processorUnavailable:
      return true

    case .cancelled:
      return false
    }
  }

  /*
   * أخطاء التخزين والمعالج قد تكون مؤقتة،
   * لذلك تظل قابلة لإعادة المحاولة ما لم يصنفها
   * العقد نفسه كخطأ نهائي.
   */
  return true
}
}

// MARK: - Coordinator errors

enum NativeScanCoordinatorError:
  LocalizedError,
  Equatable,
  Sendable {

  case notInitialized

  case disposed

  case missingJobId

  case jobIdTooLong(
    maximumLength:
      Int
  )

  case jobNotFound(
    jobId:
      String
  )

  case jobAlreadyCompleted(
    jobId:
      String
  )

  case cannotRemoveActiveJob(
    jobId:
      String
  )

  case processorUnavailable

  case activeJobMismatch(
    expectedJobId:
      String?,
    receivedJobId:
      String
  )

  case restoredRecordJobMismatch(
    expectedJobId:
      String,
    receivedJobId:
      String
  )

  case restoredResultJobMismatch(
    expectedJobId:
      String,
    receivedJobId:
      String
  )

  case restoredResultContractMismatch(
    jobId:
      String
  )

  case cancelled(
    reason:
      String?
  )

  var errorDescription:
    String? {
    switch self {
    case .notInitialized:
      return
        """
        Native scan processing coordinator has not been initialized.
        """

    case .disposed:
      return
        """
        Native scan processing coordinator has been disposed.
        """

    case .missingJobId:
      return
        """
        Native scan processing coordinator requires a non-empty jobId.
        """

    case .jobIdTooLong(
      let maximumLength
    ):
      return
        """
        Native scan processing job ID exceeds the maximum length of \(maximumLength) characters.
        """

    case .jobNotFound(
      let jobId
    ):
      return
        """
        Native scan processing job \(jobId) was not found.
        """

    case .jobAlreadyCompleted(
      let jobId
    ):
      return
        """
        Native scan processing job \(jobId) has already completed.
        """

    case .cannotRemoveActiveJob(
      let jobId
    ):
      return
        """
        Active native scan processing job \(jobId) cannot be removed.
        """

    case .processorUnavailable:
      return
        """
        Native scan processor is unavailable.
        """

    case .activeJobMismatch(
      let expectedJobId,
      let receivedJobId
    ):
      return
        """
        Native processing active job mismatch. Expected \(expectedJobId ?? "none"), received \(receivedJobId).
        """

    case .restoredRecordJobMismatch(
      let expectedJobId,
      let receivedJobId
    ):
      return
        """
        Restored native processing record belongs to job \(receivedJobId), but job \(expectedJobId) was expected.
        """

    case .restoredResultJobMismatch(
      let expectedJobId,
      let receivedJobId
    ):
      return
        """
        Restored native processing result belongs to job \(receivedJobId), but job \(expectedJobId) was expected.
        """

    case .restoredResultContractMismatch(
      let jobId
    ):
      return
        """
        Restored native processing result does not match the persisted contract for job \(jobId).
        """

    case .cancelled(
      let reason
    ):
      let normalizedReason =
        reason?
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      if let normalizedReason,
         !normalizedReason.isEmpty {
        return normalizedReason
      }

      return
        """
        Native scan processing was cancelled.
        """
    }
  }
}