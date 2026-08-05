//
// ContinuedProcessingTaskRunner.swift
//
// Triple N - Continued Native Processing Task Runner
//
// المسؤوليات:
//
// 1) ربط BackgroundTaskManager مع
//    NativeScanProcessingCoordinator.
//
// 2) تسجيل BGContinuedProcessingTask مبكرًا
//    عندما يكون مدعومًا.
//
// 3) تشغيل واستكمال Native Jobs المحفوظة.
//
// 4) تمرير Progress والعناوين إلى واجهة iOS.
//
// 5) إيقاف المعالجة عند Expiration أو Cancellation.
//
// 6) إنهاء Background Task عند نجاح أو فشل المعالجة.
//
// 7) منع وجود أكثر من Runner نشط.
//
// هذا الملف لا ينفذ EdgeSAM.
// التنفيذ الفعلي داخل NativeScanProcessor.swift.
// إدارة الـQueue داخل NativeScanProcessingCoordinator.swift.
//

import Foundation

// MARK: - Runner state

enum ContinuedProcessingRunnerState:
  String,
  Equatable,
  Sendable {

  case idle

  case configured

  case registering

  case ready

  case starting

  case submitted

  case running

  case completing

  case completed

  case interrupted

  case cancelled

  case expired

  case unavailable

  case failed

  case disposed
}

// MARK: - Runner start result

struct ContinuedProcessingRunnerStartResult:
  Equatable,
  Sendable {

  let accepted:
    Bool

  let submitted:
    Bool

  let running:
    Bool

  let restored:
    Bool

  let state:
    ContinuedProcessingRunnerState

  let taskIdentifier:
    String

  let activeJobId:
    String?

  let queuedJobIds:
    [String]

  let errorCode:
    String?

  let errorMessage:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "accepted":
        accepted,

      "submitted":
        submitted,

      "running":
        running,

      "restored":
        restored,

      "state":
        state.rawValue,

      "taskIdentifier":
        taskIdentifier,

      "activeJobId":
        activeJobId ??
        NSNull(),

      "queuedJobIds":
        queuedJobIds,

      "errorCode":
        errorCode ??
        NSNull(),

      "errorMessage":
        errorMessage ??
        NSNull()
    ]
  }
}

// MARK: - Runner diagnostics

struct ContinuedProcessingRunnerDiagnostics:
  Equatable,
  Sendable {

  let state:
    ContinuedProcessingRunnerState

  let configured:
    Bool

  let registered:
    Bool

  let disposed:
    Bool

  let supported:
    Bool

  let startCount:
    Int

  let resumeCount:
    Int

  let completionCount:
    Int

  let failureCount:
    Int

  let cancellationCount:
    Int

  let expirationCount:
    Int

  let activeJobId:
    String?

  let activeNativeTaskId:
    String?

  let queuedJobIds:
    [String]

  let lastStartedAt:
    NativeProcessingTimestamp?

  let lastCompletedAt:
    NativeProcessingTimestamp?

  let lastInterruptedAt:
    NativeProcessingTimestamp?

  let lastError:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "state":
        state.rawValue,

      "configured":
        configured,

      "registered":
        registered,

      "disposed":
        disposed,

      "supported":
        supported,

      "startCount":
        startCount,

      "resumeCount":
        resumeCount,

      "completionCount":
        completionCount,

      "failureCount":
        failureCount,

      "cancellationCount":
        cancellationCount,

      "expirationCount":
        expirationCount,

      "activeJobId":
        activeJobId ??
        NSNull(),

      "activeNativeTaskId":
        activeNativeTaskId ??
        NSNull(),

      "queuedJobIds":
        queuedJobIds,

      "lastStartedAt":
        lastStartedAt ??
        NSNull(),

      "lastCompletedAt":
        lastCompletedAt ??
        NSNull(),

      "lastInterruptedAt":
        lastInterruptedAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull()
    ]
  }
}

// MARK: - Runner callbacks

typealias ContinuedProcessingRunnerCallback =
  @MainActor (
    _ reason:
      String
  ) -> Void

// MARK: - Runner

@MainActor
final class ContinuedProcessingTaskRunner {

  // MARK: Shared instance

  static let shared =
    ContinuedProcessingTaskRunner()

  // MARK: Constants

  private static let defaultTaskIdentifier =
    BackgroundTaskManager
      .taskIdentifier

  private static let defaultTitle =
    "Processing your wardrobe"

  private static let defaultSubtitle =
    "Preparing your clothing items."

  private static let defaultCancellationReason =
    "Native processing was cancelled."

  private static let defaultExpirationReason =
    "iOS ended continued processing."

  private static let disposalReason =
    "Continued processing task runner was disposed."

  // MARK: Dependencies

  private let backgroundTaskManager:
    BackgroundTaskManager

  private var coordinator:
    NativeScanProcessingCoordinator?

  // MARK: Runtime state

  private var state:
    ContinuedProcessingRunnerState =
      .idle

  private var configured =
    false

  private var registered =
    false

  private var disposed =
    false

  private var currentTaskIdentifier:
    String =
      ContinuedProcessingTaskRunner
        .defaultTaskIdentifier

  private var currentTitle:
    String =
      ContinuedProcessingTaskRunner
        .defaultTitle

  private var currentSubtitle:
    String =
      ContinuedProcessingTaskRunner
        .defaultSubtitle

  private var latestProgress:
    Double =
      0

  private var latestStage:
    String =
      "idle"

  private var latestMessage:
    String =
      ""

  private var externalExpirationCallback:
    ContinuedProcessingRunnerCallback?

  private var externalCancellationCallback:
    ContinuedProcessingRunnerCallback?

  // MARK: Counters

  private var startCount =
    0

  private var resumeCount =
    0

  private var completionCount =
    0

  private var failureCount =
    0

  private var cancellationCount =
    0

  private var expirationCount =
    0

  // MARK: Timestamps

  private var lastStartedAt:
    NativeProcessingTimestamp?

  private var lastCompletedAt:
    NativeProcessingTimestamp?

  private var lastInterruptedAt:
    NativeProcessingTimestamp?

  private var lastError:
    String?

  // MARK: Initialization

  private init(
    backgroundTaskManager:
      BackgroundTaskManager =
        .shared
  ) {
    self.backgroundTaskManager =
      backgroundTaskManager
  }

  // MARK: - Availability

  func isSupported()
    -> Bool {
    backgroundTaskManager
      .isSupported()
  }

  // MARK: - Configuration

  @discardableResult
  func configure(
    coordinator:
      NativeScanProcessingCoordinator,
    taskIdentifier:
      String =
        ContinuedProcessingTaskRunner
          .defaultTaskIdentifier
  ) throws ->
      Bool {
    try assertNotDisposed()

    let normalizedIdentifier =
      try normalizeTaskIdentifier(
        taskIdentifier
      )

    self.coordinator =
      coordinator

    currentTaskIdentifier =
      normalizedIdentifier

    configured =
      true

    state =
      registered
        ? .ready
        : .configured

    lastError =
      nil

    return true
  }

  // MARK: - Early registration

  @discardableResult
  func registerIfSupported()
    throws ->
      Bool {
    try assertNotDisposed()
    try assertConfigured()

    guard isSupported() else {
      registered =
        false

      state =
        .unavailable

      lastError =
        "Continued processing is unavailable on this iOS runtime."

      return false
    }

    if registered {
      state =
        .ready

      lastError =
        nil

      return true
    }

    state =
      .registering

    let registrationAccepted =
      backgroundTaskManager
        .registerIfSupported(
          identifier:
            currentTaskIdentifier
        )

    registered =
      registrationAccepted

    if registrationAccepted {
      state =
        .ready

      lastError =
        nil
    } else {
      state =
        .failed

      failureCount +=
        1

      lastError =
        "The continued processing task could not be registered."
    }

    return registrationAccepted
  }

  // MARK: - Module-compatible start

  /*
   * هذه هي الواجهة التي يستخدمها:
   *
   * TripleNNativeProcessingModule.swift
   */
  func start(
    identifier:
      String =
        ContinuedProcessingTaskRunner
          .defaultTaskIdentifier,
    title:
      String,
    subtitle:
      String,
    onExpiration:
      ContinuedProcessingRunnerCallback? =
        nil,
    onCancellation:
      ContinuedProcessingRunnerCallback? =
        nil
  ) -> BackgroundTaskManager.StartResult {
    do {
      try assertNotDisposed()
      try assertConfigured()

      let normalizedIdentifier =
        try normalizeTaskIdentifier(
          identifier
        )

      currentTaskIdentifier =
        normalizedIdentifier

      currentTitle =
        normalizeText(
          title,
          fallback:
            Self.defaultTitle
        )

      currentSubtitle =
        normalizeText(
          subtitle,
          fallback:
            Self.defaultSubtitle
        )

      externalExpirationCallback =
        onExpiration

      externalCancellationCallback =
        onCancellation

      state =
        .starting

      startCount +=
        1

      lastStartedAt =
        NativeProcessingTime.now()

      lastError =
        nil

      guard isSupported() else {
        state =
          .unavailable

        lastError =
          "Continued processing is unavailable on this iOS runtime."

        return createBackgroundStartResult(
          accepted:
            false,
          submitted:
            false,
          running:
            false,
          identifier:
            normalizedIdentifier,
          state:
            .unavailable,
          errorCode:
            "CONTINUED_PROCESSING_UNAVAILABLE",
          errorMessage:
            lastError
        )
      }

      if !registered {
        registered =
          backgroundTaskManager
            .registerIfSupported(
              identifier:
                normalizedIdentifier
            )
      }

      guard registered else {
        state =
          .failed

        failureCount +=
          1

        lastError =
          "The continued processing task could not be registered."

        return createBackgroundStartResult(
          accepted:
            false,
          submitted:
            false,
          running:
            false,
          identifier:
            normalizedIdentifier,
          state:
            .failed,
          errorCode:
            "CONTINUED_PROCESSING_REGISTRATION_FAILED",
          errorMessage:
            lastError
        )
      }

      let result =
        backgroundTaskManager
          .start(
            identifier:
              normalizedIdentifier,
            title:
              currentTitle,
            subtitle:
              currentSubtitle,
            onExpiration: {
              [weak self]
              reason in

              self?
                .handleExpiration(
                  reason:
                    reason
                )
            },
            onCancellation: {
              [weak self]
              reason in

              self?
                .handleCancellation(
                  reason:
                    reason
                )
            }
          )

      if result.running {
        state =
          .running
      } else if result.submitted {
        state =
          .submitted
      } else if result.accepted {
        state =
          .ready
      } else {
        state =
          result.state ==
            .unavailable
            ? .unavailable
            : .failed

        failureCount +=
          1

        lastError =
          result.errorMessage
      }

      return result
    } catch {
      state =
        .failed

      failureCount +=
        1

      lastError =
        error.localizedDescription

      return createBackgroundStartResult(
        accepted:
          false,
        submitted:
          false,
        running:
          false,
        identifier:
          normalizeOptionalText(
            identifier
          ) ??
          currentTaskIdentifier,
        state:
          .failed,
        errorCode:
          "CONTINUED_PROCESSING_START_FAILED",
        errorMessage:
          error.localizedDescription
      )
    }
  }
  // MARK: - Restore and resume persisted work

  func resumePersistedWork(
    title:
      String =
        "Resuming wardrobe processing",
    subtitle:
      String =
        "Restoring unfinished clothing items."
  ) throws ->
      ContinuedProcessingRunnerStartResult {
    try assertNotDisposed()
    try assertConfigured()

    guard let coordinator else {
      throw ContinuedProcessingTaskRunnerError
        .coordinatorUnavailable
    }

    currentTitle =
      normalizeText(
        title,
        fallback:
          "Resuming wardrobe processing"
      )

    currentSubtitle =
      normalizeText(
        subtitle,
        fallback:
          "Restoring unfinished clothing items."
      )

    state =
      .starting

    resumeCount +=
      1

    lastStartedAt =
      NativeProcessingTime.now()

    lastError =
      nil

    do {
      try coordinator
        .initialize(
          runtime:
            resolveRuntime()
        )

      let snapshot =
        try coordinator
          .snapshot()

      let hasPendingWork =
        snapshot.activeJobId !=
          nil ||
        !snapshot
          .queuedJobIds
          .isEmpty

      guard hasPendingWork else {
        state =
          registered
            ? .ready
            : .configured

        return ContinuedProcessingRunnerStartResult(
          accepted:
            true,
          submitted:
            false,
          running:
            false,
          restored:
            true,
          state:
            state,
          taskIdentifier:
            currentTaskIdentifier,
          activeJobId:
            snapshot.activeJobId,
          queuedJobIds:
            snapshot.queuedJobIds,
          errorCode:
            nil,
          errorMessage:
            nil
        )
      }

      guard isSupported() else {
        /*
         * الـCoordinator يستمر في foregroundFallback.
         * عدم دعم BGContinuedProcessingTask لا يعني
         * رفض استرجاع الـJobs أو تشغيلها في المقدمة.
         */
        state =
          .unavailable

        lastError =
          "Continued processing is unavailable on this iOS runtime. Foreground fallback remains active."

        return ContinuedProcessingRunnerStartResult(
          accepted:
            true,
          submitted:
            false,
          running:
            snapshot.activeJobId !=
              nil,
          restored:
            true,
          state:
            state,
          taskIdentifier:
            currentTaskIdentifier,
          activeJobId:
            snapshot.activeJobId,
          queuedJobIds:
            snapshot.queuedJobIds,
          errorCode:
            "CONTINUED_PROCESSING_UNAVAILABLE",
          errorMessage:
            lastError
        )
      }

      if !registered {
        registered =
          backgroundTaskManager
            .registerIfSupported(
              identifier:
                currentTaskIdentifier
            )
      }

      guard registered else {
        state =
          .failed

        failureCount +=
          1

        lastError =
          "The continued processing task could not be registered."

        return ContinuedProcessingRunnerStartResult(
          accepted:
            false,
          submitted:
            false,
          running:
            snapshot.activeJobId !=
              nil,
          restored:
            true,
          state:
            state,
          taskIdentifier:
            currentTaskIdentifier,
          activeJobId:
            snapshot.activeJobId,
          queuedJobIds:
            snapshot.queuedJobIds,
          errorCode:
            "CONTINUED_PROCESSING_REGISTRATION_FAILED",
          errorMessage:
            lastError
        )
      }

      let backgroundResult =
        start(
          identifier:
            currentTaskIdentifier,
          title:
            currentTitle,
          subtitle:
            currentSubtitle,
          onExpiration:
            nil,
          onCancellation:
            nil
        )

      return ContinuedProcessingRunnerStartResult(
        accepted:
          backgroundResult.accepted,
        submitted:
          backgroundResult.submitted,
        running:
          backgroundResult.running ||
          snapshot.activeJobId !=
            nil,
        restored:
          true,
        state:
          state,
        taskIdentifier:
          backgroundResult.identifier,
        activeJobId:
          snapshot.activeJobId,
        queuedJobIds:
          snapshot.queuedJobIds,
        errorCode:
          backgroundResult.errorCode,
        errorMessage:
          backgroundResult.errorMessage
      )
    } catch {
      state =
        .failed

      failureCount +=
        1

      lastError =
        error.localizedDescription

      throw ContinuedProcessingTaskRunnerError
        .resumeFailed(
          message:
            error.localizedDescription
        )
    }
  }

  // MARK: - Start a known queued job

  @discardableResult
  func startJob(
    jobId:
      String
  ) throws ->
      Bool {
    try assertNotDisposed()
    try assertConfigured()

    let normalizedJobId =
      try normalizeJobIdentifier(
        jobId
      )

    guard let coordinator else {
      throw ContinuedProcessingTaskRunnerError
        .coordinatorUnavailable
    }

    do {
      try coordinator
        .start(
          jobId:
            normalizedJobId
        )

      let snapshot =
        try coordinator
          .snapshot()

      /*
       * startJob يحرك الـCoordinator فقط.
       * إذا كانت Continued Task غير نشطة نحاول بدءها،
       * لكن فشلها لا يوقف foregroundFallback.
       */
      if isSupported(),
         state !=
           .running,
         state !=
           .submitted,
         state !=
           .starting {
        _ =
          start(
            identifier:
              currentTaskIdentifier,
            title:
              currentTitle,
            subtitle:
              currentSubtitle,
            onExpiration:
              externalExpirationCallback,
            onCancellation:
              externalCancellationCallback
          )
      } else if snapshot.activeJobId !=
                  nil {
        state =
          .running
      }

      lastError =
        nil

      return true
    } catch {
      state =
        .failed

      failureCount +=
        1

      lastError =
        error.localizedDescription

      throw ContinuedProcessingTaskRunnerError
        .jobStartFailed(
          jobId:
            normalizedJobId,
          message:
            error.localizedDescription
        )
    }
  }

  // MARK: - Module-compatible progress update

  /*
   * هذه هي الواجهة المستخدمة من:
   *
   * TripleNNativeProcessingModule.swift
   */
  func update(
    progress:
      Double,
    title:
      String? =
        nil,
    subtitle:
      String? =
        nil
  ) {
    guard !disposed,
          configured else {
      return
    }

    latestProgress =
      normalizeProgress(
        progress
      )

    if let title {
      currentTitle =
        normalizeText(
          title,
          fallback:
            currentTitle
        )
    }

    if let subtitle {
      let normalizedSubtitle =
        normalizeText(
          subtitle,
          fallback:
            currentSubtitle
        )

      currentSubtitle =
        normalizedSubtitle

      latestMessage =
        normalizedSubtitle
    }

    if state ==
        .starting ||
       state ==
        .submitted ||
       state ==
        .ready ||
       state ==
        .configured {
      state =
        .running
    }

    backgroundTaskManager
      .update(
        progress:
          latestProgress,
        title:
          currentTitle,
        subtitle:
          currentSubtitle
      )
  }

  // MARK: - Detailed progress update

  /*
   * واجهة إضافية للاستخدام الداخلي عند الحاجة إلى
   * الاحتفاظ باسم Stage منفصل عن Subtitle.
   */
  func update(
    progress:
      Double,
    stage:
      String,
    message:
      String,
    title:
      String? =
        nil
  ) {
    guard !disposed,
          configured else {
      return
    }

    latestProgress =
      normalizeProgress(
        progress
      )

    latestStage =
      normalizeText(
        stage,
        fallback:
          latestStage
      )

    latestMessage =
      normalizeText(
        message,
        fallback:
          latestMessage
      )

    if let title {
      currentTitle =
        normalizeText(
          title,
        fallback:
          currentTitle
      )
    }

    currentSubtitle =
      createProgressSubtitle(
        stage:
          latestStage,
        message:
          latestMessage,
        progress:
          latestProgress
      )

    if state ==
        .starting ||
       state ==
        .submitted ||
       state ==
        .ready ||
       state ==
        .configured {
      state =
        .running
    }

    backgroundTaskManager
      .update(
        progress:
          latestProgress,
        title:
          currentTitle,
        subtitle:
          currentSubtitle
      )
  }

  // MARK: - Complete

  func complete(
    success:
      Bool,
    message:
      String? =
        nil
  ) {
    guard !disposed,
          configured else {
      return
    }

    /*
     * منع حساب نفس النهاية أكثر من مرة إذا وصل
     * Event مكرر من الـCoordinator أو JavaScript.
     */
    if success,
       state ==
         .completed {
      return
    }

    if !success,
       state ==
         .failed {
      return
    }

    state =
      .completing

    if let message {
      latestMessage =
        normalizeText(
          message,
          fallback:
            latestMessage
        )
    }

    let timestamp =
      NativeProcessingTime.now()

    if success {
      latestProgress =
        1

      latestStage =
        "complete"

      currentTitle =
        "Wardrobe processing complete"

      currentSubtitle =
        normalizeText(
          latestMessage,
          fallback:
            "Your processed items are ready."
        )

      completionCount +=
        1

      lastCompletedAt =
        timestamp

      lastError =
        nil
    } else {
      latestStage =
        "failed"

      currentSubtitle =
        normalizeText(
          latestMessage,
          fallback:
            "Continued processing did not complete successfully."
        )

      failureCount +=
        1

      lastCompletedAt =
        timestamp

      lastError =
        currentSubtitle
    }

    backgroundTaskManager
      .update(
        progress:
          latestProgress,
        title:
          currentTitle,
        subtitle:
          currentSubtitle
      )

    backgroundTaskManager
      .complete(
        success:
          success
      )

    clearExternalCallbacks()

    state =
      success
        ? .completed
        : .failed
  }

  // MARK: - Cancel

  @discardableResult
  func cancel(
    jobId:
      String? =
        nil,
    reason:
      String =
        ContinuedProcessingTaskRunner
          .defaultCancellationReason
  ) -> Bool {
    guard !disposed,
          configured else {
      return false
    }

    let normalizedReason =
      normalizeText(
        reason,
        fallback:
          Self.defaultCancellationReason
      )

    var coordinatorAccepted =
      false

    if let coordinator {
      if let jobId,
         let normalizedJobId =
           try? normalizeJobIdentifier(
             jobId
           ) {
        coordinatorAccepted =
          (
            try? coordinator
              .cancel(
                jobId:
                  normalizedJobId,
                reason:
                  normalizedReason
              )
          ) ??
          false
      } else {
        let snapshot =
          try? coordinator
            .snapshot()

        if snapshot?
            .activeJobId !=
            nil {
          coordinator
            .interruptActiveJob(
              reason:
                normalizedReason
            )

          coordinatorAccepted =
            true
        }
      }
    }

    if state !=
        .cancelled {
      cancellationCount +=
        1
    }

    state =
      .cancelled

    lastInterruptedAt =
      NativeProcessingTime.now()

    lastError =
      normalizedReason

    /*
     * BackgroundTaskManager.cancel يستدعي Callback
     * الإلغاء. لذلك نخزن الـCallback ثم نفرغه قبل
     * الإلغاء لمنع دورة استدعاء مزدوجة داخل الـRunner.
     */
    let callback =
      externalCancellationCallback

    clearExternalCallbacks()

    backgroundTaskManager
      .cancel(
        reason:
          normalizedReason
      )

    callback?(
      normalizedReason
    )

    return coordinatorAccepted
  }

  // MARK: - Snapshot

  func snapshot()
    throws ->
      ContinuedProcessingRunnerDiagnostics {
    try assertNotDisposed()

    let coordinatorSnapshot =
      try? coordinator?
        .snapshot()

    return ContinuedProcessingRunnerDiagnostics(
      state:
        state,
      configured:
        configured,
      registered:
        registered,
      disposed:
        disposed,
      supported:
        isSupported(),
      startCount:
        startCount,
      resumeCount:
        resumeCount,
      completionCount:
        completionCount,
      failureCount:
        failureCount,
      cancellationCount:
        cancellationCount,
      expirationCount:
        expirationCount,
      activeJobId:
        coordinatorSnapshot?
          .activeJobId,
      activeNativeTaskId:
        coordinatorSnapshot?
          .activeNativeTaskId,
      queuedJobIds:
        coordinatorSnapshot?
          .queuedJobIds ??
        [],
      lastStartedAt:
        lastStartedAt,
      lastCompletedAt:
        lastCompletedAt,
      lastInterruptedAt:
        lastInterruptedAt,
      lastError:
        lastError ??
        coordinatorSnapshot?
          .lastError
    )
  }

  // MARK: - Native state payload

  func createStatePayload()
    -> [String: Any] {
    let coordinatorSnapshot =
      try? coordinator?
        .snapshot()

    var payload =
      backgroundTaskManager
        .createStatePayload()

    payload[
      "runnerState"
    ] =
      state.rawValue

    payload[
      "configured"
    ] =
      configured

    payload[
      "registered"
    ] =
      registered

    payload[
      "disposed"
    ] =
      disposed

    payload[
      "supported"
    ] =
      isSupported()

    payload[
      "taskIdentifier"
    ] =
      currentTaskIdentifier

    payload[
      "latestProgress"
    ] =
      latestProgress

    payload[
      "latestStage"
    ] =
      latestStage

    payload[
      "latestMessage"
    ] =
      latestMessage

    payload[
      "currentTitle"
    ] =
      currentTitle

    payload[
      "currentSubtitle"
    ] =
      currentSubtitle

    payload[
      "activeJobId"
    ] =
      coordinatorSnapshot?
        .activeJobId ??
      NSNull()

    payload[
      "activeNativeTaskId"
    ] =
      coordinatorSnapshot?
        .activeNativeTaskId ??
      NSNull()

    payload[
      "queuedJobIds"
    ] =
      coordinatorSnapshot?
        .queuedJobIds ??
      []

    payload[
      "recordCount"
    ] =
      coordinatorSnapshot?
        .recordCount ??
      0

    payload[
      "pendingResultCount"
    ] =
      coordinatorSnapshot?
        .pendingResultCount ??
      0

    payload[
      "completedResultCount"
    ] =
      coordinatorSnapshot?
        .completedResultCount ??
      0

    payload[
      "runtime"
    ] =
      coordinatorSnapshot?
        .runtime
        .rawValue ??
      resolveRuntime()
        .rawValue

    payload[
      "lastStartedAt"
    ] =
      lastStartedAt ??
      NSNull()

    payload[
      "lastCompletedAt"
    ] =
      lastCompletedAt ??
      NSNull()

    payload[
      "lastInterruptedAt"
    ] =
      lastInterruptedAt ??
      NSNull()

    payload[
      "lastError"
    ] =
      lastError ??
      coordinatorSnapshot?
        .lastError ??
      NSNull()

    return payload
  }
  // MARK: - Expiration callback

  private func handleExpiration(
    reason:
      String
  ) {
    guard !disposed,
          configured else {
      return
    }

    let normalizedReason =
      normalizeText(
        reason,
        fallback:
          Self.defaultExpirationReason
      )

    /*
     * إيقاف الـJob النشطة فقط.
     *
     * الـCoordinator سيحوّل الإلغاء الناتج إلى
     * نتيجة نهائية ويحفظها على القرص.
     */
    coordinator?
      .interruptActiveJob(
        reason:
          normalizedReason
      )

    if state !=
        .expired {
      expirationCount +=
        1
    }

    state =
      .expired

    lastInterruptedAt =
      NativeProcessingTime.now()

    lastError =
      normalizedReason

    let callback =
      externalExpirationCallback

    clearExternalCallbacks()

    callback?(
      normalizedReason
    )
  }

  // MARK: - Cancellation callback

  private func handleCancellation(
    reason:
      String
  ) {
    guard !disposed,
          configured else {
      return
    }

    let normalizedReason =
      normalizeText(
        reason,
        fallback:
          Self.defaultCancellationReason
      )

    coordinator?
      .interruptActiveJob(
        reason:
          normalizedReason
      )

    if state !=
        .cancelled {
      cancellationCount +=
        1
    }

    state =
      .cancelled

    lastInterruptedAt =
      NativeProcessingTime.now()

    lastError =
      normalizedReason

    let callback =
      externalCancellationCallback

    clearExternalCallbacks()

    callback?(
      normalizedReason
    )
  }

  // MARK: - Disposal

  func dispose() {
    guard !disposed else {
      return
    }

    disposed =
      true

    state =
      .disposed

    let disposalTimestamp =
      NativeProcessingTime.now()

    coordinator?
      .interruptActiveJob(
        reason:
          Self.disposalReason
      )

    /*
     * BackgroundTaskManager.cancel قد يستدعي
     * handleCancellation.
     *
     * disposed أصبح true بالفعل، لذلك Callback الداخلي
     * سيعود فورًا ولن يحسب Cancellation إضافية.
     */
    backgroundTaskManager
      .cancel(
        reason:
          Self.disposalReason
      )

    coordinator =
      nil

    configured =
      false

    registered =
      false

    currentTaskIdentifier =
      Self.defaultTaskIdentifier

    currentTitle =
      Self.defaultTitle

    currentSubtitle =
      Self.defaultSubtitle

    latestProgress =
      0

    latestStage =
      "idle"

    latestMessage =
      ""

    lastInterruptedAt =
      disposalTimestamp

    lastError =
      nil

    clearExternalCallbacks()
  }

  // MARK: - Guards

  private func assertConfigured()
    throws {
    guard configured,
          coordinator !=
            nil else {
      throw ContinuedProcessingTaskRunnerError
        .notConfigured
    }
  }

  private func assertNotDisposed()
    throws {
    guard !disposed else {
      throw ContinuedProcessingTaskRunnerError
        .disposed
    }
  }

  // MARK: - Runtime

  private func resolveRuntime()
    -> NativeScanProcessingRuntime {
    isSupported()
      ? .iosContinuedProcessing
      : .foregroundFallback
  }

  // MARK: - Start result helpers

  private func createBackgroundStartResult(
    accepted:
      Bool,
    submitted:
      Bool,
    running:
      Bool,
    identifier:
      String,
    state runnerState:
      ContinuedProcessingRunnerState,
    errorCode:
      String?,
    errorMessage:
      String?
  ) -> BackgroundTaskManager.StartResult {
    BackgroundTaskManager.StartResult(
      accepted:
        accepted,
      submitted:
        submitted,
      running:
        running,
      identifier:
        identifier,
      state:
        resolveManagerState(
          runnerState
        ),
      errorCode:
        errorCode,
      errorMessage:
        errorMessage
    )
  }

  private func resolveManagerState(
    _ runnerState:
      ContinuedProcessingRunnerState
  ) -> BackgroundTaskManager.ManagerState {
    switch runnerState {
    case .idle,
         .configured,
         .ready:
      return .idle

    case .registering:
      return .registering

    case .starting,
         .submitted:
      return .submitted

    case .running:
      return .running

    case .completing,
         .completed:
      return .completed

    case .interrupted,
         .expired:
      return .expired

    case .cancelled,
         .disposed:
      return .cancelled

    case .unavailable:
      return .unavailable

    case .failed:
      return .failed
    }
  }

  // MARK: - Identifier normalization

  private func normalizeTaskIdentifier(
    _ value:
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
      throw ContinuedProcessingTaskRunnerError
        .invalidTaskIdentifier
    }

    return normalized
  }

  private func normalizeJobIdentifier(
    _ value:
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
      throw ContinuedProcessingTaskRunnerError
        .invalidJobIdentifier
    }

    return normalized
  }

  // MARK: - Value normalization

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

  private func normalizeText(
    _ value:
      String,
    fallback:
      String
  ) -> String {
    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    if !normalized.isEmpty {
      return normalized
    }

    let normalizedFallback =
      fallback
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    return normalizedFallback
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

  // MARK: - Progress subtitle

  private func createProgressSubtitle(
    stage:
      String,
    message:
      String,
    progress:
      Double
  ) -> String {
    let percentage =
      Int(
        (
          normalizeProgress(
            progress
          ) *
          100
        )
        .rounded()
      )

    let normalizedMessage =
      message
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    if !normalizedMessage.isEmpty {
      return
        "\(percentage)% — \(normalizedMessage)"
    }

    let normalizedStage =
      stage
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    if !normalizedStage.isEmpty {
      return
        "\(percentage)% — \(normalizedStage)"
    }

    return
      "\(percentage)% complete"
  }

  // MARK: - Callback cleanup

  private func clearExternalCallbacks() {
    externalExpirationCallback =
      nil

    externalCancellationCallback =
      nil
  }
}

// MARK: - Runner errors

enum ContinuedProcessingTaskRunnerError:
  LocalizedError,
  Equatable,
  Sendable {

  case notConfigured

  case disposed

  case invalidTaskIdentifier

  case invalidJobIdentifier

  case coordinatorUnavailable

  case startFailed(
    message:
      String
  )

  case resumeFailed(
    message:
      String
  )

  case jobStartFailed(
    jobId:
      String,
    message:
      String
  )

  var errorDescription:
    String? {
    switch self {
    case .notConfigured:
      return
        """
        Continued processing task runner has not been configured.
        """

    case .disposed:
      return
        """
        Continued processing task runner has been disposed.
        """

    case .invalidTaskIdentifier:
      return
        """
        Continued processing requires a non-empty task identifier.
        """

    case .invalidJobIdentifier:
      return
        """
        Continued processing requires a non-empty job identifier.
        """

    case .coordinatorUnavailable:
      return
        """
        Native scan processing coordinator is unavailable.
        """

    case .startFailed(
      let message
    ):
      return
        """
        Continued processing could not start: \(message)
        """

    case .resumeFailed(
      let message
    ):
      return
        """
        Persisted native processing work could not resume: \(message)
        """

    case .jobStartFailed(
      let jobId,
      let message
    ):
      return
        """
        Native scan job \(jobId) could not start: \(message)
        """
    }
  }
}