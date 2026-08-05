//
// TripleNNativeProcessingModule.swift
//
// Triple N - Expo Native Scan Processing Module
//
// هذا الملف هو واجهة الاتصال النهائية بين:
//
// - JavaScript NativeProcessingBridge
// - NativeScanJob
// - NativeScanJobStore
// - NativeScanProcessingCoordinator
// - NativeScanProcessor
// - ContinuedProcessingTaskRunner
//
// المسؤوليات:
//
// 1) تهيئة Native Processing مرة واحدة.
// 2) إنشاء وربط Store وProcessor وCoordinator.
// 3) تسجيل Continued Processing مبكرًا.
// 4) استقبال Native Jobs الصغيرة من JavaScript.
// 5) تشغيل المعالجة مع foreground fallback عند الحاجة.
// 6) استرجاع الحالة والنتائج بعد عودة JavaScript.
// 7) إرسال Native Processing Events إلى React Native.
// 8) دعم الإلغاء والحذف والتنظيف والتشخيص.
// 9) التخلص الآمن من جميع الموارد.
//
// هذا الملف لا يحتوي على منطق EdgeSAM.
// التنفيذ الفعلي داخل NativeScanProcessor.swift.
//

import ExpoModulesCore
import Foundation

// MARK: - Module

public final class TripleNNativeProcessingModule:
  Module,
  @unchecked Sendable {

  // MARK: Event names

  private enum EventName {

    static let scheduled =
      "onNativeProcessingScheduled"

    static let started =
      "onNativeProcessingStarted"

    static let progress =
      "onNativeProcessingProgress"

    static let suspended =
      "onNativeProcessingSuspended"

    static let resumed =
      "onNativeProcessingResumed"

    static let completed =
      "onNativeProcessingCompleted"

    static let failed =
      "onNativeProcessingFailed"

    static let cancelled =
      "onNativeProcessingCancelled"

    static let expired =
      "onNativeProcessingExpired"

    static let interrupted =
      "onNativeProcessingInterrupted"
  }

  // MARK: Constants

  private static let platform =
    "ios"

  private static let processorUnavailableCode =
    "NATIVE_PROCESSOR_UNAVAILABLE"

  private static let initializationFailedCode =
    "NATIVE_PROCESSING_INITIALIZATION_FAILED"

  private static let notInitializedCode =
    "NATIVE_PROCESSING_NOT_INITIALIZED"

  private static let invalidPayloadCode =
    "INVALID_NATIVE_PROCESSING_PAYLOAD"

  private static let unsupportedPlatformCode =
    "UNSUPPORTED_PROCESSING_PLATFORM"

  // MARK: State queue

  private let moduleStateQueue =
    DispatchQueue(
      label:
        "com.naderahmed22.triplen.native-processing.module-state",
      qos:
        .userInitiated
    )

  // MARK: Native dependencies

  private var store:
    NativeScanJobStore?

  private var processor:
    NativeScanProcessor?

  private var coordinator:
    NativeScanProcessingCoordinator?

  // MARK: Lifecycle state

  private var initialized =
    false

  private var initializing =
    false

  private var processorInstalled =
    false

  private var disposed =
    false

  private var lastError:
    String?

  // MARK: Expo definition

  public func definition()
    -> ModuleDefinition {
    Name(
      "TripleNNativeProcessing"
    )

    Events(
      EventName.scheduled,
      EventName.started,
      EventName.progress,
      EventName.suspended,
      EventName.resumed,
      EventName.completed,
      EventName.failed,
      EventName.cancelled,
      EventName.expired,
      EventName.interrupted
    )

    Constant(
      "platform"
    ) {
      Self.platform
    }

    Constant(
      "contractVersion"
    ) {
      NativeProcessingContractConstants
        .contractVersion
    }

    Constant(
      "stateVersion"
    ) {
      NativeProcessingContractConstants
        .stateVersion
    }

    AsyncFunction(
      "initialize"
    ) { () -> [String: Any] in
      try await self
        .initializeModule()
    }

    AsyncFunction(
      "getCapability"
    ) { () -> [String: Any] in
      await self
        .createCapabilityPayload()
    }

    AsyncFunction(
      "scheduleJob"
    ) {
      (
        payload:
          [String: Any]
      ) -> [String: Any] in

      try await self
        .scheduleJob(
          payload:
            payload
        )
    }

    AsyncFunction(
      "startJob"
    ) {
      (
        jobId:
          String
      ) -> [String: Any] in

      try await self
        .startJob(
          jobId:
            jobId
        )
    }

    AsyncFunction(
      "getJobState"
    ) {
      (
        jobId:
          String
      ) -> Any in

      try await self
        .getJobState(
          jobId:
            jobId
        )
    }

    AsyncFunction(
      "getAllJobStates"
    ) { () -> [[String: Any]] in
      try await self
        .getAllJobStates()
    }

    AsyncFunction(
      "getPendingResults"
    ) { () -> [[String: Any]] in
      try await self
        .getPendingResults()
    }

    AsyncFunction(
      "acknowledgeResult"
    ) {
      (
        jobId:
          String
      ) -> [String: Any] in

      try await self
        .acknowledgeResult(
          jobId:
            jobId
        )
    }

    AsyncFunction(
      "cancelJob"
    ) {
      (
        jobId:
          String,
        reason:
          String?
      ) -> [String: Any] in

      try await self
        .cancelJob(
          jobId:
            jobId,
          reason:
            reason
        )
    }

    AsyncFunction(
      "removeJob"
    ) {
      (
        jobId:
          String
      ) -> [String: Any] in

      try await self
        .removeJob(
          jobId:
            jobId
        )
    }

    AsyncFunction(
      "clearCompletedJobs"
    ) { () -> [String: Any] in
      try await self
        .clearCompletedJobs()
    }

    AsyncFunction(
      "getDiagnostics"
    ) { () -> [String: Any] in
      await self
        .getDiagnostics()
    }

    AsyncFunction(
      "dispose"
    ) { () -> Void in
      await self
        .disposeModule()
    }

    OnDestroy {
      Task {
        [weak self] in

        await self?
          .disposeModule()
      }
    }
  }

  // MARK: - Initialization

  private func initializeModule()
    async throws ->
      [String: Any] {
    try assertNotDisposed()

    /*
     * إذا كان الـModule مهيأ بالفعل، نعيد Snapshot
     * بدل إنشاء Store أو Coordinator جديد.
     */
    if let existingCoordinator =
        currentInitializedCoordinator() {
      return try await createInitializationPayload(
        coordinator:
          existingCoordinator,
        warnings:
          []
      )
    }

    let mayInitialize =
      moduleStateQueue.sync {
        guard !disposed else {
          return false
        }

        guard !initializing else {
          return false
        }

        initializing =
          true

        return true
      }

    /*
     * قد يصل initialize مرتين متزامنتين من JavaScript.
     * ننتظر التهيئة الموجودة بدل إنشاء Native graph ثانٍ.
     */
    guard mayInitialize else {
      return try await waitForInitialization()
    }

    do {
      let createdStore =
        try NativeScanJobStore()

      let createdProcessor =
        NativeScanProcessor()

      let createdCoordinator =
        NativeScanProcessingCoordinator(
          store:
            createdStore,
          processor:
            createdProcessor,
          eventHandler: {
            [weak self]
            event in

            self?
              .handleCoordinatorEvent(
                event
              )
          }
        )

      /*
       * يجب إعداد الـRunner وتسجيل الـTask قبل
       * initialize() لأن initialize قد يسترجع Jobs
       * ويبدأ تنفيذها فورًا.
       */
      let runnerWarnings =
        try await configureContinuedProcessingRunner(
          coordinator:
            createdCoordinator
        )

      try createdCoordinator
        .initialize(
          runtime:
            await resolveRuntime()
        )

      let accepted =
        moduleStateQueue.sync {
          guard !disposed else {
            return false
          }

          store =
            createdStore

          processor =
            createdProcessor

          coordinator =
            createdCoordinator

          initialized =
            true

          initializing =
            false

          processorInstalled =
            true

          lastError =
            nil

          return true
        }

      guard accepted else {
        createdCoordinator
          .dispose()

        await MainActor.run {
          ContinuedProcessingTaskRunner
            .shared
            .dispose()
        }

        throw NativeProcessingModuleException(
          code:
            "NATIVE_PROCESSING_MODULE_DISPOSED",
          message:
            "The native processing module was disposed during initialization."
        )
      }

      return try await createInitializationPayload(
        coordinator:
          createdCoordinator,
        warnings:
          runnerWarnings
      )
    } catch {
      moduleStateQueue.sync {
        initializing =
          false

        initialized =
          false

        processorInstalled =
          false

        store =
          nil

        processor =
          nil

        coordinator =
          nil

        lastError =
          error.localizedDescription
      }

      throw NativeProcessingModuleException(
        code:
          Self.initializationFailedCode,
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: Initialization concurrency

  private func waitForInitialization()
    async throws ->
      [String: Any] {
    let maximumChecks =
      200

    let delayNanoseconds:
      UInt64 =
        25_000_000

    for _ in 0..<maximumChecks {
      try assertNotDisposed()

      if let initializedCoordinator =
          currentInitializedCoordinator() {
        return try await createInitializationPayload(
          coordinator:
            initializedCoordinator,
          warnings:
            []
        )
      }

      let stillInitializing =
        moduleStateQueue.sync {
          initializing
        }

      if !stillInitializing {
        break
      }

      try await Task.sleep(
        nanoseconds:
          delayNanoseconds
      )
    }

    let errorMessage =
      moduleStateQueue.sync {
        lastError
      } ??
      "Native processing initialization did not complete."

    throw NativeProcessingModuleException(
      code:
        Self.initializationFailedCode,
      message:
        errorMessage
    )
  }

  // MARK: Runner configuration

  private func configureContinuedProcessingRunner(
    coordinator:
      NativeScanProcessingCoordinator
  ) async throws ->
      [String] {
    try await MainActor.run {
      let runner =
        ContinuedProcessingTaskRunner
          .shared

      _ =
        try runner.configure(
          coordinator:
            coordinator,
          taskIdentifier:
            BackgroundTaskManager
              .taskIdentifier
        )

      guard runner
              .isSupported() else {
        return [
          """
          Continued processing is unavailable on this iOS runtime. Foreground fallback will be used.
          """
        ]
      }

      let registered =
        try runner
          .registerIfSupported()

      guard registered else {
        return [
          """
          Continued processing registration was not accepted by iOS. Foreground fallback will remain available.
          """
        ]
      }

      return []
    }
  }

  // MARK: Initialization payload

  private func createInitializationPayload(
    coordinator:
      NativeScanProcessingCoordinator,
    warnings:
      [String]
  ) async throws ->
      [String: Any] {
    let snapshot =
      try coordinator
        .snapshot()

    let runnerState =
      await MainActor.run {
        ContinuedProcessingTaskRunner
          .shared
          .createStatePayload()
      }

    return [
      "initialized":
        true,

      "available":
        true,

      "processorInstalled":
        true,

      "restoredRecordCount":
        snapshot.recordCount,

      "pendingResultCount":
        snapshot.pendingResultCount,

      "activeJobId":
        snapshot.activeJobId ??
        NSNull(),

      "queuedJobIds":
        snapshot.queuedJobIds,

      "runtime":
        snapshot.runtime.rawValue,

      "continuedProcessingRunner":
        runnerState,

      "warnings":
        warnings
    ]
  }

  // MARK: - Capability

  private func createCapabilityPayload()
    async ->
      [String: Any] {
    let timestamp =
      NativeProcessingTime.now()

    let runnerSupported =
      await MainActor.run {
        ContinuedProcessingTaskRunner
          .shared
          .isSupported()
      }

    let stateSnapshot =
      moduleStateQueue.sync {
        (
          initialized:
            initialized,
          processorInstalled:
            processorInstalled,
          disposed:
            disposed
        )
      }

    if stateSnapshot.disposed {
      return NativeScanCapabilityResult(
        platform:
          Self.platform,
        status:
          .unavailable,
        runtime:
          .unknown,
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
        reason:
          "The native processing module has been disposed.",
        checkedAt:
          timestamp
      )
      .asDictionary()
    }

    /*
     * عدم دعم Continued Processing لا يعني أن
     * Native Processing غير متاحة؛ يظل foreground fallback
     * قادرًا على تشغيل NativeScanProcessor.
     */
    let capabilityStatus:
      NativeScanCapabilityStatus

    let capabilityReason:
      String?

    if stateSnapshot.initialized &&
        stateSnapshot.processorInstalled {
      capabilityStatus =
        .available

      capabilityReason =
        runnerSupported
          ? nil
          : "Foreground native processing is available. Continued locked-screen execution is unavailable on this runtime."
    } else {
      capabilityStatus =
        .unknown

      capabilityReason =
        "The native processing module has not been initialized."
    }

    return NativeScanCapabilityResult(
      platform:
        Self.platform,
      status:
        capabilityStatus,
      runtime:
        runnerSupported
          ? .iosContinuedProcessing
          : .foregroundFallback,
      supportsLockedScreenExecution:
        runnerSupported,
      supportsTerminatedAppExecution:
        runnerSupported,
      supportsProgressUpdates:
        true,
      supportsCancellation:
        true,
      maximumConcurrentJobs:
        1,
      reason:
        capabilityReason,
      checkedAt:
        timestamp
    )
    .asDictionary()
  }
  // MARK: - Schedule job

  private func scheduleJob(
    payload:
      [String: Any]
  ) async throws ->
      [String: Any] {
    try await ensureInitialized()

    let job:
      NativeScanJob

    do {
      job =
        try NativeScanJob.decode(
          from:
            payload
        )
    } catch {
      throw NativeProcessingModuleException(
        code:
          Self.invalidPayloadCode,
        message:
          error.localizedDescription
      )
    }

    guard job.platform ==
            Self.platform else {
      throw NativeProcessingModuleException(
        code:
          Self.unsupportedPlatformCode,
        message:
          """
          The iOS native processing module received a job for platform \(job.platform).
          """
      )
    }

    let stateSnapshot =
      moduleStateQueue.sync {
        (
          processorInstalled:
            processorInstalled,
          disposed:
            disposed
        )
      }

    guard !stateSnapshot.disposed else {
      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_MODULE_DISPOSED",
        message:
          "The native processing module has been disposed."
      )
    }

    guard stateSnapshot.processorInstalled else {
      return createRejectedSchedulePayload(
        jobId:
          job.jobId,
        runtime:
          await resolveRuntime(),
        code:
          Self.processorUnavailableCode,
        message:
          "NativeScanProcessor is unavailable."
      )
    }

    guard let coordinator =
            currentCoordinator() else {
      throw NativeProcessingModuleException(
        code:
          Self.notInitializedCode,
        message:
          "The native processing coordinator is unavailable."
      )
    }

    let taskId =
      createTaskId(
        jobId:
          job.jobId
      )

    let runtime =
      await resolveRuntime()

    let scheduleResult:
      NativeScanScheduleResult

    do {
      /*
       * نحفظ الـJob داخل الـCoordinator أولًا.
       *
       * بهذه الطريقة لا تضيع الـJob إذا رفض iOS
       * BGContinuedProcessingTask، وسيستمر التنفيذ
       * باستخدام foregroundFallback.
       */
      scheduleResult =
        try coordinator.schedule(
          job:
            job,
          runtime:
            runtime,
          nativeTaskId:
            taskId
        )
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_SCHEDULE_FAILED",
        message:
          error.localizedDescription
      )
    }

    guard scheduleResult.accepted else {
      return scheduleResult
        .asDictionary()
    }

    /*
     * محاولة تشغيل Continued Processing.
     *
     * فشل هذه الخطوة لا يلغي الـJob المحفوظة؛
     * فالـCoordinator بدأ التنفيذ بالفعل ويمكنه
     * الاستمرار في foregroundFallback.
     */
    let runnerResult =
      await MainActor.run {
        ContinuedProcessingTaskRunner
          .shared
          .start(
            identifier:
              BackgroundTaskManager
                .taskIdentifier,
            title:
              createBackgroundTitle(
                job:
                  job
              ),
            subtitle:
              "Preparing your clothing item.",
            onExpiration: {
              [weak self]
              reason in

              self?
                .handleBackgroundExpiration(
                  jobId:
                    job.jobId,
                  reason:
                    reason
                )
            },
            onCancellation: {
              [weak self]
              reason in

              self?
                .handleBackgroundCancellation(
                  jobId:
                    job.jobId,
                  reason:
                    reason
                )
            }
          )
      }

    var response =
      scheduleResult
        .asDictionary()

    response[
      "backgroundAccepted"
    ] =
      runnerResult.accepted

    response[
      "backgroundSubmitted"
    ] =
      runnerResult.submitted

    response[
      "backgroundRunning"
    ] =
      runnerResult.running

    response[
      "backgroundState"
    ] =
      runnerResult.state.rawValue

    response[
      "backgroundErrorCode"
    ] =
      runnerResult.errorCode ??
      NSNull()

    response[
      "backgroundErrorMessage"
    ] =
      runnerResult.errorMessage ??
      NSNull()

    response[
      "foregroundFallbackActive"
    ] =
      !runnerResult.accepted

    return response
  }

  // MARK: - Explicit job start

  private func startJob(
    jobId:
      String
  ) async throws ->
      [String: Any] {
    try await ensureInitialized()

    let normalizedJobId =
      try requireJobId(
        jobId
      )

    let stateSnapshot =
      moduleStateQueue.sync {
        (
          processorInstalled:
            processorInstalled,
          disposed:
            disposed
        )
      }

    guard !stateSnapshot.disposed else {
      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_MODULE_DISPOSED",
        message:
          "The native processing module has been disposed."
      )
    }

    guard stateSnapshot.processorInstalled else {
      return [
        "started":
          false,

        "accepted":
          false,

        "running":
          false,

        "jobId":
          normalizedJobId,

        "errorCode":
          Self.processorUnavailableCode,

        "errorMessage":
          "NativeScanProcessor is unavailable."
      ]
    }

    guard let coordinator =
            currentCoordinator() else {
      throw NativeProcessingModuleException(
        code:
          Self.notInitializedCode,
        message:
          "The native processing coordinator is unavailable."
      )
    }

    do {
      try coordinator.start(
        jobId:
          normalizedJobId
      )

      let runnerStarted =
        await MainActor.run {
          (
            try? ContinuedProcessingTaskRunner
              .shared
              .startJob(
                jobId:
                  normalizedJobId
              )
          ) ??
          false
        }

      let record =
        try coordinator.getRecord(
          jobId:
            normalizedJobId
        )

      return [
        "started":
          true,

        "accepted":
          true,

        "running":
          true,

        "jobId":
          normalizedJobId,

        "nativeTaskId":
          record?
            .progress
            .nativeTaskId ??
          NSNull(),

        "continuedProcessingStarted":
          runnerStarted,

        "startedAt":
          NativeProcessingTime.now()
      ]
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_START_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: - Job state

  private func getJobState(
    jobId:
      String
  ) async throws ->
      Any {
    try await ensureInitialized()

    let normalizedJobId =
      try requireJobId(
        jobId
      )

    guard let coordinator =
            currentCoordinator() else {
      return NSNull()
    }

    do {
      let record =
        try coordinator.getRecord(
          jobId:
            normalizedJobId
        )

      return record?
        .asDictionary() ??
        NSNull()
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_STATE_READ_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  private func getAllJobStates()
    async throws ->
      [[String: Any]] {
    try await ensureInitialized()

    guard let coordinator =
            currentCoordinator() else {
      return []
    }

    do {
      return try coordinator
        .getAllRecords()
        .map {
          $0.asDictionary()
        }
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_STATES_READ_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: - Pending results

  private func getPendingResults()
    async throws ->
      [[String: Any]] {
    try await ensureInitialized()

    guard let coordinator =
            currentCoordinator() else {
      return []
    }

    do {
      return try coordinator
        .getPendingResults()
        .map {
          $0.asDictionary()
        }
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_RESULTS_READ_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: - Acknowledge result

  private func acknowledgeResult(
    jobId:
      String
  ) async throws ->
      [String: Any] {
    try await ensureInitialized()

    let normalizedJobId =
      try requireJobId(
        jobId
      )

    guard let coordinator =
            currentCoordinator() else {
      return [
        "acknowledged":
          false,

        "jobId":
          normalizedJobId,

        "acknowledgedAt":
          NSNull()
      ]
    }

    do {
      let acknowledged =
        try coordinator
          .acknowledgeResult(
            jobId:
              normalizedJobId
          )

      return [
        "acknowledged":
          acknowledged,

        "jobId":
          normalizedJobId,

        "acknowledgedAt":
          acknowledged
            ? NativeProcessingTime.now()
            : NSNull()
      ]
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_ACKNOWLEDGE_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: - Cancel job

  private func cancelJob(
    jobId:
      String,
    reason:
      String?
  ) async throws ->
      [String: Any] {
    try await ensureInitialized()

    let normalizedJobId =
      try requireJobId(
        jobId
      )

    let normalizedReason =
      normalizeOptionalText(
        reason
      ) ??
      "Native processing was cancelled."

    guard let coordinator =
            currentCoordinator() else {
      return [
        "cancelled":
          false,

        "jobId":
          normalizedJobId,

        "cancelledAt":
          NSNull()
      ]
    }

    do {
      let cancelled =
        try coordinator.cancel(
          jobId:
            normalizedJobId,
          reason:
            normalizedReason
        )

      if cancelled {
        _ =
          await MainActor.run {
            ContinuedProcessingTaskRunner
              .shared
              .cancel(
                jobId:
                  normalizedJobId,
                reason:
                  normalizedReason
              )
          }
      }

      let record =
        try coordinator.getRecord(
          jobId:
            normalizedJobId
        )

      return [
        "jobId":
          normalizedJobId,

        "cancelled":
          cancelled,

        "nativeTaskId":
          record?
            .progress
            .nativeTaskId ??
          NSNull(),

        "result":
          record?
            .result?
            .asDictionary() ??
          NSNull(),

        "error":
          record?
            .result?
            .error?
            .asDictionary() ??
          NSNull(),

        "cancelledAt":
          cancelled
            ? NativeProcessingTime.now()
            : NSNull()
      ]
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_CANCEL_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: - Remove job

  private func removeJob(
    jobId:
      String
  ) async throws ->
      [String: Any] {
    try await ensureInitialized()

    let normalizedJobId =
      try requireJobId(
        jobId
      )

    guard let coordinator =
            currentCoordinator() else {
      return [
        "removed":
          false,

        "jobId":
          normalizedJobId,

        "removedAt":
          NSNull()
      ]
    }

    do {
      let removed =
        try coordinator.remove(
          jobId:
            normalizedJobId
        )

      return [
        "removed":
          removed,

        "jobId":
          normalizedJobId,

        "removedAt":
          removed
            ? NativeProcessingTime.now()
            : NSNull()
      ]
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_REMOVE_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: - Clear completed jobs

  private func clearCompletedJobs()
    async throws ->
      [String: Any] {
    try await ensureInitialized()

    guard let coordinator =
            currentCoordinator() else {
      return [
        "cleared":
          false,

        "removedCount":
          0,

        "clearedAt":
          NSNull()
      ]
    }

    do {
      let removedCount =
        try coordinator
          .clearCompletedJobs()

      return [
        "cleared":
          true,

        "removedCount":
          removedCount,

        "clearedAt":
          NativeProcessingTime.now()
      ]
    } catch {
      updateLastError(
        error.localizedDescription
      )

      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_CLEAR_COMPLETED_FAILED",
        message:
          error.localizedDescription
      )
    }
  }

  // MARK: - Coordinator events

  private func handleCoordinatorEvent(
    _ event:
      NativeScanProcessingEvent
  ) {
    let eventName =
      resolveEventName(
        event.type
      )

    sendEvent(
      eventName,
      event.asDictionary()
    )

    Task {
      @MainActor in

      let runner =
        ContinuedProcessingTaskRunner
          .shared

      switch event.type {
      case .scheduled:
        break

      case .started,
           .progress,
           .resumed:
        guard let progress =
                event.progress else {
          return
        }

        runner.update(
          progress:
            progress.progress,
          stage:
            progress.stage,
          message:
            progress.message,
          title:
            createBackgroundTitle(
              progress:
                progress
            )
        )

      case .completed:
        runner.complete(
          success:
            true,
          message:
            event.result?
              .output?
              .processedImageUri !=
              nil
              ? "Your processed clothing item is ready."
              : "Native processing completed."
        )

      case .failed:
        runner.complete(
          success:
            false,
          message:
            event.error?
              .message ??
            "Native processing failed."
        )

      case .cancelled:
        _ =
          runner.cancel(
            jobId:
              event.jobId,
            reason:
              event.error?
                .message ??
              "Native processing was cancelled."
          )

      case .expired:
        runner.complete(
          success:
            false,
          message:
            event.error?
              .message ??
            "Native processing expired."
        )

      case .interrupted:
        runner.complete(
          success:
            false,
          message:
            event.error?
              .message ??
            "Native processing was interrupted."
        )

      case .suspended:
        break
      }
    }
  }

  private func resolveEventName(
    _ type:
      NativeScanProcessingEventType
  ) -> String {
    switch type {
    case .scheduled:
      return EventName.scheduled

    case .started:
      return EventName.started

    case .progress:
      return EventName.progress

    case .suspended:
      return EventName.suspended

    case .resumed:
      return EventName.resumed

    case .completed:
      return EventName.completed

    case .failed:
      return EventName.failed

    case .cancelled:
      return EventName.cancelled

    case .expired:
      return EventName.expired

    case .interrupted:
      return EventName.interrupted
    }
  }

  // MARK: - Background callbacks

  private func handleBackgroundExpiration(
    jobId:
      String,
    reason:
      String
  ) {
    guard let coordinator =
            currentCoordinator() else {
      return
    }

    _ =
  coordinator
    .interruptActiveJob(
      jobId:
        jobId,
      reason:
        normalizeOptionalText(
          reason
        ) ??
        "iOS ended continued processing."
    )
  }

  private func handleBackgroundCancellation(
    jobId:
      String,
    reason:
      String
  ) {
    guard let coordinator =
            currentCoordinator() else {
      return
    }

    let normalizedReason =
      normalizeOptionalText(
        reason
      ) ??
      "Native processing was cancelled."

    try? coordinator.cancel(
      jobId:
        jobId,
      reason:
        normalizedReason
    )
  }
  // MARK: - Diagnostics

  private func getDiagnostics()
    async ->
      [String: Any] {
    let moduleSnapshot =
      moduleStateQueue.sync {
        (
          initialized:
            initialized,
          initializing:
            initializing,
          processorInstalled:
            processorInstalled,
          disposed:
            disposed,
          storeAvailable:
            store !=
              nil,
          processorAvailable:
            processor !=
              nil,
          coordinatorAvailable:
            coordinator !=
              nil,
          lastError:
            lastError
        )
      }

    let coordinatorSnapshot =
      try? currentCoordinator()?
        .snapshot()

    let processorDiagnostics =
      currentProcessor()?
        .diagnostics()
        .asDictionary()

    let storeDiagnostics:
      NativeScanJobStoreDiagnostics? = {
        guard let currentStore =
                currentStore() else {
          return nil
        }

        return try? currentStore
          .diagnostics()
      }()

    let runnerState =
      await MainActor.run {
        ContinuedProcessingTaskRunner
          .shared
          .createStatePayload()
      }

    var payload:
      [String: Any] =
        [
          "platform":
            Self.platform,

          "contractVersion":
            NativeProcessingContractConstants
              .contractVersion,

          "stateVersion":
            NativeProcessingContractConstants
              .stateVersion,

          "initialized":
            moduleSnapshot.initialized,

          "initializing":
            moduleSnapshot.initializing,

          "disposed":
            moduleSnapshot.disposed,

          "processorInstalled":
            moduleSnapshot.processorInstalled,

          "storeAvailable":
            moduleSnapshot.storeAvailable,

          "processorAvailable":
            moduleSnapshot.processorAvailable,

          "coordinatorAvailable":
            moduleSnapshot.coordinatorAvailable,

          "activeJobId":
            coordinatorSnapshot?
              .activeJobId ??
            NSNull(),

          "queuedJobIds":
            coordinatorSnapshot?
              .queuedJobIds ??
            [],

          "recordCount":
            coordinatorSnapshot?
              .recordCount ??
            0,

          "pendingResultCount":
            coordinatorSnapshot?
              .pendingResultCount ??
            0,

          "runtime":
            coordinatorSnapshot?
              .runtime
              .rawValue ??
            "unknown",

          "coordinatorLastError":
            coordinatorSnapshot?
              .lastError ??
            NSNull(),

          "moduleLastError":
            moduleSnapshot
              .lastError ??
            NSNull(),

          "processor":
            processorDiagnostics ??
            NSNull(),

          "continuedProcessingRunner":
            runnerState
        ]

    if let storeDiagnostics {
      payload[
        "store"
      ] =
        [
          "initialized":
            storeDiagnostics.initialized,

          "rootDirectory":
            storeDiagnostics.rootDirectory,

          "savedJobCount":
            storeDiagnostics.savedJobCount,

          "savedRecordCount":
            storeDiagnostics.savedRecordCount,

          "savedResultCount":
            storeDiagnostics.savedResultCount,

          "savedDiagnosticsCount":
            storeDiagnostics.savedDiagnosticsCount,

          "totalFileCount":
            storeDiagnostics.totalFileCount,

          "totalSizeBytes":
            storeDiagnostics.totalSizeBytes,

          "lastReadAt":
            storeDiagnostics.lastReadAt ??
            NSNull(),

          "lastWriteAt":
            storeDiagnostics.lastWriteAt ??
            NSNull(),

          "lastDeleteAt":
            storeDiagnostics.lastDeleteAt ??
            NSNull(),

          "lastError":
            storeDiagnostics.lastError ??
            NSNull()
        ]
    } else {
      payload[
        "store"
      ] =
        NSNull()
    }

    return payload
  }

  // MARK: - Disposal

  private func disposeModule()
    async {
    let disposalSnapshot =
      moduleStateQueue.sync {
        () -> (
          coordinator:
            NativeScanProcessingCoordinator?,
          alreadyDisposed:
            Bool
        ) in

        if disposed {
          return (
            coordinator:
              nil,
            alreadyDisposed:
              true
          )
        }

        disposed =
          true

        initialized =
          false

        initializing =
          false

        processorInstalled =
          false

        let currentCoordinator =
          coordinator

        coordinator =
          nil

        processor =
          nil

        store =
          nil

        lastError =
          nil

        return (
          coordinator:
            currentCoordinator,
          alreadyDisposed:
            false
        )
      }

    guard !disposalSnapshot
            .alreadyDisposed else {
      return
    }

    /*
     * نوقف الـRunner أولًا حتى لا يحاول الوصول إلى
     * Coordinator أثناء تفريغه.
     */
    await MainActor.run {
      ContinuedProcessingTaskRunner
        .shared
        .dispose()
    }

    disposalSnapshot
      .coordinator?
      .dispose()
  }

  // MARK: - Initialization guard

  private func ensureInitialized()
    async throws {
    try assertNotDisposed()

    if currentInitializedCoordinator() !=
        nil {
      return
    }

    _ =
      try await initializeModule()
  }

  private func assertNotDisposed()
    throws {
    let isDisposed =
      moduleStateQueue.sync {
        disposed
      }

    guard !isDisposed else {
      throw NativeProcessingModuleException(
        code:
          "NATIVE_PROCESSING_MODULE_DISPOSED",
        message:
          "The native processing module has been disposed."
      )
    }
  }

  // MARK: - Dependency access

  private func currentInitializedCoordinator()
    -> NativeScanProcessingCoordinator? {
    moduleStateQueue.sync {
      guard initialized,
            !disposed else {
        return nil
      }

      return coordinator
    }
  }

  private func currentCoordinator()
    -> NativeScanProcessingCoordinator? {
    moduleStateQueue.sync {
      guard !disposed else {
        return nil
      }

      return coordinator
    }
  }

  private func currentProcessor()
    -> NativeScanProcessor? {
    moduleStateQueue.sync {
      guard !disposed else {
        return nil
      }

      return processor
    }
  }

  private func currentStore()
    -> NativeScanJobStore? {
    moduleStateQueue.sync {
      guard !disposed else {
        return nil
      }

      return store
    }
  }

  // MARK: - Runtime

  private func resolveRuntime()
    async ->
      NativeScanProcessingRuntime {
    let supported =
      await MainActor.run {
        ContinuedProcessingTaskRunner
          .shared
          .isSupported()
      }

    return supported
      ? .iosContinuedProcessing
      : .foregroundFallback
  }

  // MARK: - Error state

  private func updateLastError(
    _ message:
      String?
  ) {
    moduleStateQueue.sync {
      lastError =
        normalizeOptionalText(
          message
        )
    }
  }

  // MARK: - Identifier helpers

  private func requireJobId(
    _ jobId:
      String
  ) throws ->
      String {
    let normalizedJobId =
      normalizeJobId(
        jobId
      )

    guard !normalizedJobId.isEmpty else {
      throw NativeProcessingModuleException(
        code:
          "INVALID_NATIVE_PROCESSING_JOB_ID",
        message:
          "The native processing job ID is missing."
      )
    }

    return normalizedJobId
  }

  private func normalizeJobId(
    _ jobId:
      String
  ) -> String {
    jobId
      .trimmingCharacters(
        in:
          .whitespacesAndNewlines
      )
  }

  private func normalizeOptionalText(
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

  private func createTaskId(
    jobId:
      String
  ) -> String {
    let normalizedJobId =
      normalizeJobId(
        jobId
      )
      .replacingOccurrences(
        of:
          " ",
        with:
          "-"
      )

    return
      "native-scan-\(normalizedJobId)-\(UUID().uuidString)"
  }

  // MARK: - Background titles

  private func createBackgroundTitle(
    job:
      NativeScanJob
  ) -> String {
    if let itemName =
        normalizeOptionalText(
          job
            .wardrobe
            .itemName
        ) {
      return
        "Processing \(itemName)"
    }

    return
      "Processing your wardrobe"
  }

  private func createBackgroundTitle(
    progress:
      NativeScanProcessingProgress
  ) -> String {
    if progress.progress >=
        1 {
      return
        "Wardrobe processing complete"
    }

    return
      "Processing your wardrobe"
  }

  // MARK: - Rejected schedule payload

  private func createRejectedSchedulePayload(
    jobId:
      String,
    runtime:
      NativeScanProcessingRuntime,
    code:
      String,
    message:
      String
  ) -> [String: Any] {
    let timestamp =
      NativeProcessingTime.now()

    let processingError =
      NativeScanProcessingError(
        code:
          code,
        message:
          message,
        source:
          .scheduler,
        retryable:
          false,
        occurredAt:
          timestamp,
        attempt:
          0,
        stage:
          "queued",
        nativeCode:
          nil,
        metadata:
          [:]
      )

    return NativeScanScheduleResult(
      accepted:
        false,
      jobId:
        jobId,
      nativeTaskId:
        nil,
      runtime:
        runtime,
      scheduledAt:
        nil,
      error:
        processingError
    )
    .asDictionary()
  }
}

// MARK: - Expo exception

private final class NativeProcessingModuleException:
  Exception,
  @unchecked Sendable {

  private let exceptionCode:
    String

  private let exceptionMessage:
    String

  init(
    code:
      String,
    message:
      String
  ) {
    self.exceptionCode =
      code

    self.exceptionMessage =
      message

    super.init()
  }

  override var code:
    String {
    exceptionCode
  }

  override var reason:
    String {
    exceptionMessage
  }
}