import Foundation
import UIKit

#if compiler(>=6.2)
import BackgroundTasks
#endif

@MainActor
final class BackgroundTaskManager {
  static let shared =
    BackgroundTaskManager()

  static let taskIdentifier =
    "com.naderahmed22.triplen.scan-processing"

  enum ManagerState:
    String {
    case idle
    case registering
    case submitted
    case running
    case completed
    case expired
    case cancelled
    case unavailable
    case failed
  }

  struct StartResult {
    let accepted:
      Bool

    let submitted:
      Bool

    let running:
      Bool

    let identifier:
      String

    let state:
      ManagerState

    let errorCode:
      String?

    let errorMessage:
      String?
  }

#if compiler(>=6.2)
  @available(
    iOS 26.0,
    *
  )
  private final class IOS26State {
    var task:
      BGContinuedProcessingTask?

    var registeredIdentifiers:
      Set<String> =
        []

    var requestSubmitted =
      false
  }

  private var ios26State:
    AnyObject?
#endif

  private var state:
    ManagerState =
      .idle

  private var currentIdentifier:
    String?

  private var currentTitle =
    "Processing your wardrobe"

  private var currentSubtitle =
    "Preparing your clothing items."

  private var currentProgress:
    Double =
      0.0

  private var startedAt:
    TimeInterval?

  private var updatedAt:
    TimeInterval =
      Date()
        .timeIntervalSince1970

  private var lastErrorCode:
    String?

  private var lastErrorMessage:
    String?

  private var expirationCallback:
    ((
      _ reason:
        String
    ) -> Void)?

  private var cancellationCallback:
    ((
      _ reason:
        String
    ) -> Void)?

  private init() {}

  /* =======================================================
   * Public availability
   * ===================================================== */

  func isSupported():
    Bool {
#if compiler(>=6.2)
    if #available(
      iOS 26.0,
      *
    ) {
      return true
    }
#endif

    return false
  }

  /* =======================================================
   * Optional early registration
   * ===================================================== */

  @discardableResult
  func registerIfSupported(
    identifier:
      String =
        BackgroundTaskManager
          .taskIdentifier
  ) -> Bool {
    let normalizedIdentifier =
      identifier
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard
      !normalizedIdentifier
        .isEmpty
    else {
      return false
    }

#if compiler(>=6.2)
    if #available(
      iOS 26.0,
      *
    ) {
      return registerIOS26Handler(
        identifier:
          normalizedIdentifier
      )
    }
#endif

    return false
  }

  /* =======================================================
   * Public start
   * ===================================================== */

  func start(
    identifier:
      String =
        BackgroundTaskManager
          .taskIdentifier,
    title:
      String,
    subtitle:
      String,
    onExpiration:
      ((
        _ reason:
          String
      ) -> Void)? =
        nil,
    onCancellation:
      ((
        _ reason:
          String
      ) -> Void)? =
        nil
  ) -> StartResult {
    let normalizedIdentifier =
      identifier
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard
      !normalizedIdentifier
        .isEmpty
    else {
      state =
        .failed

      lastErrorCode =
        "INVALID_CONTINUED_TASK_IDENTIFIER"

      lastErrorMessage =
        "The continued processing task identifier is empty."

      updatedAt =
        now()

      return createStartResult(
        accepted:
          false,
        submitted:
          false,
        running:
          false
      )
    }

    guard
      isSupported()
    else {
      state =
        .unavailable

      lastErrorCode =
        "CONTINUED_PROCESSING_UNAVAILABLE"

      lastErrorMessage =
        "BGContinuedProcessingTask requires an iOS 26 compatible SDK and iOS 26 or newer."

      updatedAt =
        now()

      return createStartResult(
        accepted:
          false,
        submitted:
          false,
        running:
          false,
        identifier:
          normalizedIdentifier
      )
    }

    currentIdentifier =
      normalizedIdentifier

    currentTitle =
      normalizeText(
        title,
        fallback:
          "Processing your wardrobe"
      )

    currentSubtitle =
      normalizeText(
        subtitle,
        fallback:
          "Preparing your clothing items."
      )

    currentProgress =
      0.0

    startedAt =
      now()

    updatedAt =
      startedAt ??
      now()

    lastErrorCode =
      nil

    lastErrorMessage =
      nil

    expirationCallback =
      onExpiration

    cancellationCallback =
      onCancellation

#if compiler(>=6.2)
    if #available(
      iOS 26.0,
      *
    ) {
      return startIOS26(
        identifier:
          normalizedIdentifier
      )
    }
#endif

    state =
      .unavailable

    lastErrorCode =
      "CONTINUED_PROCESSING_UNAVAILABLE"

    lastErrorMessage =
      "The current compiler does not include BGContinuedProcessingTask."

    updatedAt =
      now()

    return createStartResult(
      accepted:
        false,
      submitted:
        false,
      running:
        false,
      identifier:
        normalizedIdentifier
    )
  }

  /* =======================================================
   * Public progress update
   * ===================================================== */

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
    currentProgress =
      normalizeProgress(
        progress
      )

    if
      let title
    {
      let normalizedTitle =
        title
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      if
        !normalizedTitle
          .isEmpty
      {
        currentTitle =
          normalizedTitle
      }
    }

    if
      let subtitle
    {
      let normalizedSubtitle =
        subtitle
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      if
        !normalizedSubtitle
          .isEmpty
      {
        currentSubtitle =
          normalizedSubtitle
      }
    }

    updatedAt =
      now()

#if compiler(>=6.2)
    if #available(
      iOS 26.0,
      *
    ) {
      updateIOS26Task()
    }
#endif
  }

  /* =======================================================
   * Public completion
   * ===================================================== */

  func complete(
    success:
      Bool
  ) {
    if
      success
    {
      currentProgress =
        1.0

      state =
        .completed

      lastErrorCode =
        nil

      lastErrorMessage =
        nil
    } else {
      state =
        .failed

      if
        lastErrorCode ==
          nil
      {
        lastErrorCode =
          "CONTINUED_PROCESSING_FAILED"
      }

      if
        lastErrorMessage ==
          nil
      {
        lastErrorMessage =
          "Continued processing did not complete successfully."
      }
    }

    updatedAt =
      now()

#if compiler(>=6.2)
    if #available(
      iOS 26.0,
      *
    ) {
      completeIOS26Task(
        success:
          success
      )
    }
#endif

    clearCallbacks()
  }

  /* =======================================================
   * Public cancellation
   * ===================================================== */

  func cancel(
    reason:
      String =
        "Continued processing was cancelled."
  ) {
    let normalizedReason =
      normalizeText(
        reason,
        fallback:
          "Continued processing was cancelled."
      )

    state =
      .cancelled

    lastErrorCode =
      "CONTINUED_PROCESSING_CANCELLED"

    lastErrorMessage =
      normalizedReason

    updatedAt =
      now()

#if compiler(>=6.2)
    if #available(
      iOS 26.0,
      *
    ) {
      cancelIOS26Task()
    }
#endif

    let callback =
      cancellationCallback

    clearCallbacks()

    callback?(
      normalizedReason
    )
  }

  /* =======================================================
   * Public state
   * ===================================================== */

  func createStatePayload():
    [String: Any] {
    let identifierValue:
      Any =
        currentIdentifier ??
        NSNull()

    let startedAtValue:
      Any =
        startedAt ??
        NSNull()

    let errorCodeValue:
      Any =
        lastErrorCode ??
        NSNull()

    let errorMessageValue:
      Any =
        lastErrorMessage ??
        NSNull()

    let running =
      state ==
        .running ||
      state ==
        .submitted ||
      state ==
        .registering

    return [
      "available":
        isSupported(),

      "platform":
        "ios",

      "executor":
        "bg-continued-processing-task",

      "identifier":
        identifierValue,

      "taskId":
        identifierValue,

      "nativeTaskId":
        identifierValue,

      "state":
        state.rawValue,

      "status":
        state.rawValue,

      "running":
        running,

      "submitted":
        state ==
          .submitted ||
        state ==
          .running,

      "progress":
        currentProgress,

      "percentage":
        Int(
          (
            currentProgress *
              100.0
          )
          .rounded()
        ),

      "title":
        currentTitle,

      "subtitle":
        currentSubtitle,

      "startedAt":
        startedAtValue,

      "updatedAt":
        updatedAt,

      "errorCode":
        errorCodeValue,

      "errorMessage":
        errorMessageValue
    ]
  }

#if compiler(>=6.2)

  /* =======================================================
   * iOS 26 implementation
   * ===================================================== */

  @available(
    iOS 26.0,
    *
  )
  private func getIOS26State():
    IOS26State {
    if
      let existing =
        ios26State as?
          IOS26State
    {
      return existing
    }

    let created =
      IOS26State()

    ios26State =
      created

    return created
  }

  @available(
    iOS 26.0,
    *
  )
  private func startIOS26(
    identifier:
      String
  ) -> StartResult {
    let runtimeState =
      getIOS26State()

    if
      runtimeState.task !=
        nil
    {
      state =
        .running

      updateIOS26Task()

      return createStartResult(
        accepted:
          true,
        submitted:
          true,
        running:
          true,
        identifier:
          identifier
      )
    }

    state =
      .registering

    let registered =
      registerIOS26Handler(
        identifier:
          identifier
      )

    guard
      registered
    else {
      state =
        .failed

      lastErrorCode =
        "CONTINUED_PROCESSING_REGISTRATION_FAILED"

      lastErrorMessage =
        "The continued processing launch handler could not be registered."

      updatedAt =
        now()

      return createStartResult(
        accepted:
          false,
        submitted:
          false,
        running:
          false,
        identifier:
          identifier
      )
    }

    let request =
      BGContinuedProcessingTaskRequest(
        identifier:
          identifier,
        title:
          currentTitle,
        subtitle:
          currentSubtitle
      )

    request.strategy =
      .fail

    do {
      try BGTaskScheduler
        .shared
        .submit(
          request
        )

      runtimeState
        .requestSubmitted =
        true

      state =
        .submitted

      updatedAt =
        now()

      return createStartResult(
        accepted:
          true,
        submitted:
          true,
        running:
          false,
        identifier:
          identifier
      )
    } catch {
      runtimeState
        .requestSubmitted =
        false

      state =
        .failed

      lastErrorCode =
        "CONTINUED_PROCESSING_SUBMISSION_FAILED"

      lastErrorMessage =
        error.localizedDescription

      updatedAt =
        now()

      return createStartResult(
        accepted:
          false,
        submitted:
          false,
        running:
          false,
        identifier:
          identifier
      )
    }
  }

  @available(
    iOS 26.0,
    *
  )
  private func registerIOS26Handler(
    identifier:
      String
  ) -> Bool {
    let runtimeState =
      getIOS26State()

    if
      runtimeState
        .registeredIdentifiers
        .contains(
          identifier
        )
    {
      return true
    }

    let registered =
      BGTaskScheduler
        .shared
        .register(
          forTaskWithIdentifier:
            identifier,
          using:
            nil
        ) {
          [weak self]
          task in

          guard
            let continuedTask =
              task as?
                BGContinuedProcessingTask
          else {
            task.setTaskCompleted(
              success:
                false
            )

            return
          }

          Task {
            @MainActor
            [weak self] in

            self?
              .attachIOS26Task(
                continuedTask
              )
          }
        }

    if
      registered
    {
      runtimeState
        .registeredIdentifiers
        .insert(
          identifier
        )
    }

    return registered
  }

  @available(
    iOS 26.0,
    *
  )
  private func attachIOS26Task(
    _ task:
      BGContinuedProcessingTask
  ) {
    let runtimeState =
      getIOS26State()

    runtimeState.task =
      task

    runtimeState
      .requestSubmitted =
      true

    state =
      .running

    lastErrorCode =
      nil

    lastErrorMessage =
      nil

    updatedAt =
      now()

    task.progress
      .totalUnitCount =
      10_000

    task.progress
      .completedUnitCount =
      progressUnitCount(
        currentProgress
      )

    task.updateTitle(
      currentTitle,
      subtitle:
        currentSubtitle
    )

    task.expirationHandler = {
      [weak self] in

      Task {
        @MainActor
        [weak self] in

        self?
          .handleIOS26Expiration()
      }
    }
  }

  @available(
    iOS 26.0,
    *
  )
  private func updateIOS26Task() {
    let runtimeState =
      getIOS26State()

    guard
      let task =
        runtimeState.task
    else {
      return
    }

    task.progress
      .totalUnitCount =
      10_000

    task.progress
      .completedUnitCount =
      progressUnitCount(
        currentProgress
      )

    task.updateTitle(
      currentTitle,
      subtitle:
        currentSubtitle
    )
  }

  @available(
    iOS 26.0,
    *
  )
  private func completeIOS26Task(
    success:
      Bool
  ) {
    let runtimeState =
      getIOS26State()

    if
      success,
      let task =
        runtimeState.task
    {
      task.progress
        .totalUnitCount =
        10_000

      task.progress
        .completedUnitCount =
        10_000

      task.updateTitle(
        "Wardrobe processing complete",
        subtitle:
          "Your processed items are ready."
      )
    }

    runtimeState.task?
      .setTaskCompleted(
        success:
          success
      )

    runtimeState.task =
      nil

    runtimeState
      .requestSubmitted =
      false
  }

  @available(
    iOS 26.0,
    *
  )
  private func cancelIOS26Task() {
    let runtimeState =
      getIOS26State()

    runtimeState.task?
      .setTaskCompleted(
        success:
          false
      )

    if
      let identifier =
        currentIdentifier
    {
      BGTaskScheduler
        .shared
        .cancel(
          taskRequestWithIdentifier:
            identifier
        )
    }

    runtimeState.task =
      nil

    runtimeState
      .requestSubmitted =
      false
  }

  @available(
    iOS 26.0,
    *
  )
  private func handleIOS26Expiration() {
    let runtimeState =
      getIOS26State()

    guard
      runtimeState.task !=
        nil ||
      runtimeState
        .requestSubmitted
    else {
      return
    }

    let reason =
      "iOS ended continued background processing. Completed items remain saved and pending items can resume later."

    state =
      .expired

    lastErrorCode =
      "CONTINUED_PROCESSING_EXPIRED"

    lastErrorMessage =
      reason

    updatedAt =
      now()

    runtimeState.task?
      .setTaskCompleted(
        success:
          false
      )

    runtimeState.task =
      nil

    runtimeState
      .requestSubmitted =
      false

    let callback =
      expirationCallback

    clearCallbacks()

    callback?(
      reason
    )
  }

#endif

  /* =======================================================
   * Helpers
   * ===================================================== */

  private func createStartResult(
    accepted:
      Bool,
    submitted:
      Bool,
    running:
      Bool,
    identifier:
      String? =
        nil
  ) -> StartResult {
    return StartResult(
      accepted:
        accepted,

      submitted:
        submitted,

      running:
        running,

      identifier:
        identifier ??
        currentIdentifier ??
        BackgroundTaskManager
          .taskIdentifier,

      state:
        state,

      errorCode:
        lastErrorCode,

      errorMessage:
        lastErrorMessage
    )
  }

  private func normalizeProgress(
    _ value:
      Double
  ) -> Double {
    guard
      value.isFinite
    else {
      return 0.0
    }

    return min(
      1.0,
      max(
        0.0,
        value
      )
    )
  }

  private func progressUnitCount(
    _ progress:
      Double
  ) -> Int64 {
    return Int64(
      (
        normalizeProgress(
          progress
        ) *
        10_000.0
      )
      .rounded()
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

    return normalized.isEmpty
      ? fallback
      : normalized
  }

  private func now():
    TimeInterval {
    return Date()
      .timeIntervalSince1970
  }

  private func clearCallbacks() {
    expirationCallback =
      nil

    cancellationCallback =
      nil
  }
}