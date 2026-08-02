import ExpoModulesCore
import UIKit

public final class TripleNBackgroundModule: Module {
  private let stateQueue =
    DispatchQueue(
      label:
        "com.naderahmed22.triplen.background.state"
    )

  private var backgroundTaskIdentifier:
    UIBackgroundTaskIdentifier =
    .invalid

  private var activeTaskId:
    String?

  private var startedAt:
    TimeInterval?

  private var latestProgress:
    Double =
    0.0

  private var latestStage:
    String =
    "idle"

  private var latestMessage:
    String =
    ""

  public func definition() -> ModuleDefinition {
    Name(
      "TripleNBackground"
    )

    Events(
      "onBackgroundTaskStarted",
      "onBackgroundTaskProgress",
      "onBackgroundTaskExpired",
      "onBackgroundTaskStopped"
    )

    Constant(
      "platform"
    ) {
      "ios"
    }

    Constant(
      "available"
    ) {
      true
    }

    AsyncFunction(
      "isAvailable"
    ) { () -> [String: Any] in
      return await MainActor.run {
        [
          "available":
            true,

          "platform":
            "ios",

          "executor":
            "ios-background-task",

          "applicationState":
            self.applicationStateName(
              UIApplication
                .shared
                .applicationState
            ),

          "backgroundTimeRemaining":
            self.normalizedBackgroundTimeRemaining()
        ]
      }
    }

    AsyncFunction(
      "startBackgroundTask"
    ) {
      (
        taskId:
          String,
        taskName:
          String?
      ) -> [String: Any] in

      let normalizedTaskId =
        taskId
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      guard
        !normalizedTaskId
          .isEmpty
      else {
        throw InvalidBackgroundTaskIdException()
      }

      return await MainActor.run {
        self.beginBackgroundTask(
          taskId:
            normalizedTaskId,

          taskName:
            taskName
        )
      }
    }

    AsyncFunction(
      "updateBackgroundTask"
    ) {
      (
        taskId:
          String,
        progress:
          Double,
        stage:
          String?,
        message:
          String?
      ) -> [String: Any] in

      let normalizedTaskId =
        taskId
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      guard
        !normalizedTaskId
          .isEmpty
      else {
        throw InvalidBackgroundTaskIdException()
      }

      return await MainActor.run {
        self.updateBackgroundTaskState(
          taskId:
            normalizedTaskId,

          progress:
            progress,

          stage:
            stage,

          message:
            message
        )
      }
    }

    AsyncFunction(
      "stopBackgroundTask"
    ) {
      (
        taskId:
          String?
      ) -> [String: Any] in

      return await MainActor.run {
        self.endBackgroundTask(
          requestedTaskId:
            taskId,

          reason:
            "completed",

          emitEvent:
            true
        )
      }
    }

    AsyncFunction(
      "getBackgroundTaskState"
    ) { () -> [String: Any] in
      return await MainActor.run {
        self.createStatePayload()
      }
    }

    OnDestroy {
      Task {
        await MainActor.run {
          _ =
            self.endBackgroundTask(
              requestedTaskId:
                nil,

              reason:
                "module-destroyed",

              emitEvent:
                false
            )
        }
      }
    }
  }

  @MainActor
  private func beginBackgroundTask(
    taskId:
      String,
    taskName:
      String?
  ) -> [String: Any] {
    if
      backgroundTaskIdentifier !=
        .invalid
    {
      if
        activeTaskId ==
          taskId
      {
        return createStatePayload()
      }

      _ =
        endBackgroundTask(
          requestedTaskId:
            nil,

          reason:
            "replaced",

          emitEvent:
            true
        )
    }

    let normalizedName =
      taskName?
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )
        .isEmpty ==
        false
        ? taskName!
        : "Triple N Scan Item Processing"

    activeTaskId =
      taskId

    startedAt =
      Date()
        .timeIntervalSince1970

    latestProgress =
      0.0

    latestStage =
      "starting"

    latestMessage =
      "Background processing started."

    backgroundTaskIdentifier =
      UIApplication
        .shared
        .beginBackgroundTask(
          withName:
            normalizedName
        ) {
          Task {
            await MainActor.run {
              self.handleExpiration()
            }
          }
        }

    guard
      backgroundTaskIdentifier !=
        .invalid
    else {
      clearState()

      return [
        "accepted":
          false,

        "taskId":
          taskId,

        "platform":
          "ios",

        "status":
          "unavailable",

        "errorCode":
          "BACKGROUND_TASK_START_FAILED",

        "errorMessage":
          "iOS did not grant background execution time."
      ]
    }

    let payload =
      createStatePayload(
        additionalValues: [
          "accepted":
            true
        ]
      )

    sendEvent(
      "onBackgroundTaskStarted",
      payload
    )

    return payload
  }

  @MainActor
  private func updateBackgroundTaskState(
    taskId:
      String,
    progress:
      Double,
    stage:
      String?,
    message:
      String?
  ) -> [String: Any] {
    guard
      backgroundTaskIdentifier !=
        .invalid,
      activeTaskId ==
        taskId
    else {
      return [
        "updated":
          false,

        "taskId":
          taskId,

        "platform":
          "ios",

        "status":
          "not-running",

        "errorCode":
          "BACKGROUND_TASK_NOT_FOUND",

        "errorMessage":
          "No active iOS background task matches this task ID."
      ]
    }

    latestProgress =
      normalizedProgress(
        progress
      )

    if
      let stage,
      !stage
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )
        .isEmpty
    {
      latestStage =
        stage
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )
    }

    if
      let message
    {
      latestMessage =
        message
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )
    }

    let payload =
      createStatePayload(
        additionalValues: [
          "updated":
            true
        ]
      )

    sendEvent(
      "onBackgroundTaskProgress",
      payload
    )

    return payload
  }

  @MainActor
  private func handleExpiration() {
    guard
      backgroundTaskIdentifier !=
        .invalid
    else {
      return
    }

    let payload =
      createStatePayload(
        additionalValues: [
          "expired":
            true,

          "status":
            "expired",

          "errorCode":
            "BACKGROUND_PROCESSING_EXPIRED",

          "errorMessage":
            "iOS background execution time expired before processing completed."
        ]
      )

    sendEvent(
      "onBackgroundTaskExpired",
      payload
    )

    _ =
      endBackgroundTask(
        requestedTaskId:
          nil,

        reason:
          "expired",

        emitEvent:
          false
      )
  }

  @MainActor
  private func endBackgroundTask(
    requestedTaskId:
      String?,
    reason:
      String,
    emitEvent:
      Bool
  ) -> [String: Any] {
    let normalizedRequestedTaskId =
      requestedTaskId?
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    if
      let normalizedRequestedTaskId,
      !normalizedRequestedTaskId
        .isEmpty,
      let activeTaskId,
      normalizedRequestedTaskId !=
        activeTaskId
    {
      return [
        "stopped":
          false,

        "taskId":
          normalizedRequestedTaskId,

        "platform":
          "ios",

        "status":
          "task-id-mismatch",

        "errorCode":
          "BACKGROUND_TASK_NOT_FOUND",

        "errorMessage":
          "The supplied task ID does not match the active iOS background task."
      ]
    }

    guard
      backgroundTaskIdentifier !=
        .invalid
    else {
      return [
        "stopped":
          false,

        "taskId":
          activeTaskId as Any,

        "platform":
          "ios",

        "status":
          "idle",

        "reason":
          reason
      ]
    }

    let identifier =
      backgroundTaskIdentifier

    let payload =
      createStatePayload(
        additionalValues: [
          "stopped":
            true,

          "status":
            "stopped",

          "reason":
            reason
        ]
      )

    backgroundTaskIdentifier =
      .invalid

    UIApplication
      .shared
      .endBackgroundTask(
        identifier
      )

    clearState()

    if
      emitEvent
    {
      sendEvent(
        "onBackgroundTaskStopped",
        payload
      )
    }

    return payload
  }

  @MainActor
  private func createStatePayload(
    additionalValues:
      [String: Any] =
      [:]
  ) -> [String: Any] {
    let isRunning =
      backgroundTaskIdentifier !=
      .invalid

    var payload:
      [String: Any] = [
        "platform":
          "ios",

        "executor":
          "ios-background-task",

        "running":
          isRunning,

        "status":
          isRunning
            ? "processing"
            : "idle",

        "taskId":
          activeTaskId as Any,

        "progress":
          latestProgress,

        "percentage":
          Int(
            (
              latestProgress *
              100.0
            )
            .rounded()
          ),

        "stage":
          latestStage,

        "message":
          latestMessage,

        "startedAt":
          startedAt as Any,

        "updatedAt":
          Date()
            .timeIntervalSince1970,

        "backgroundTimeRemaining":
          normalizedBackgroundTimeRemaining(),

        "applicationState":
          applicationStateName(
            UIApplication
              .shared
              .applicationState
          )
      ]

    for (
      key,
      value
    ) in additionalValues {
      payload[
        key
      ] =
        value
    }

    return payload
  }

  @MainActor
  private func normalizedBackgroundTimeRemaining() -> Double {
    let remaining =
      UIApplication
        .shared
        .backgroundTimeRemaining

    if
      remaining ==
        .greatestFiniteMagnitude ||
      !remaining
        .isFinite
    {
      return -1.0
    }

    return max(
      0.0,
      remaining
    )
  }

  private func normalizedProgress(
    _ value:
      Double
  ) -> Double {
    guard
      value
        .isFinite
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

  private func applicationStateName(
    _ state:
      UIApplication.State
  ) -> String {
    switch state {
    case .active:
      return "active"

    case .inactive:
      return "inactive"

    case .background:
      return "background"

    @unknown default:
      return "unknown"
    }
  }

  private func clearState() {
    activeTaskId =
      nil

    startedAt =
      nil

    latestProgress =
      0.0

    latestStage =
      "idle"

    latestMessage =
      ""
  }
}

private final class InvalidBackgroundTaskIdException:
  Exception {
  override var reason:
    String {
    "The iOS background task ID is missing."
  }
}
