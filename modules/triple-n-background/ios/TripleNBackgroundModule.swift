import ExpoModulesCore
import UIKit

public final class TripleNBackgroundModule: Module {
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

  private var activeExecutor:
    String =
      "idle"

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

    /*
     * هذه القيمة تشير إلى توفر الموديول نفسه.
     *
     * حتى على إصدارات iOS الأقدم من iOS 26،
     * ما زال UIApplication background task متاحًا
     * كـfallback.
     */
    Constant(
      "available"
    ) {
      true
    }

    AsyncFunction(
      "isAvailable"
    ) { () -> [String: Any] in
      return await MainActor.run {
        let continuedSupported =
          BackgroundTaskManager
            .shared
            .isSupported()

        return [
          "available":
            true,

          "platform":
            "ios",

          "executor":
            continuedSupported
              ? "bg-continued-processing-task"
              : "ios-background-task",

          "continuedProcessingAvailable":
            continuedSupported,

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

          completed:
            true,

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
        @MainActor
        [weak self] in

        guard
          let self
        else {
          return
        }

        _ =
          self.endBackgroundTask(
            requestedTaskId:
              nil,

            reason:
              "module-destroyed",

            completed:
              false,

            emitEvent:
              false
          )
      }
    }
  }

  /* =======================================================
   * Start
   * ===================================================== */

  @MainActor
  private func beginBackgroundTask(
    taskId:
      String,
    taskName:
      String?
  ) -> [String: Any] {
    /*
     * لو نفس المهمة تعمل بالفعل،
     * نعيد حالتها بدل بدء مهمة ثانية.
     */
    if
      isAnyTaskRunning()
    {
      if
        activeTaskId ==
          taskId
      {
        return createStatePayload(
          additionalValues: [
            "accepted":
              true,

            "started":
              true,

            "alreadyRunning":
              true
          ]
        )
      }

      /*
       * توجد مهمة أخرى تعمل.
       * ننهيها قبل بدء المهمة الجديدة.
       */
      _ =
        endBackgroundTask(
          requestedTaskId:
            nil,

          reason:
            "replaced",

          completed:
            false,

          emitEvent:
            true
        )
    }

    let normalizedName =
      normalizeText(
        taskName,
        fallback:
          "Triple N Scan Item Processing"
      )

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

    activeExecutor =
      "starting"

    /*
     * iOS 26 وما بعده:
     *
     * نحاول استخدام BGContinuedProcessingTask أولًا.
     */
    if
      BackgroundTaskManager
        .shared
        .isSupported()
    {
      let continuedResult =
        BackgroundTaskManager
          .shared
          .start(
            identifier:
              BackgroundTaskManager
                .taskIdentifier,

            title:
              normalizedName,

            subtitle:
              latestMessage,

            onExpiration: {
              [weak self]
              reason in

              Task {
                @MainActor
                [weak self] in

                self?
                  .handleContinuedProcessingExpiration(
                    reason:
                      reason
                  )
              }
            },

            onCancellation: {
              [weak self]
              reason in

              Task {
                @MainActor
                [weak self] in

                self?
                  .handleContinuedProcessingCancellation(
                    reason:
                      reason
                  )
              }
            }
          )

      if
        continuedResult.accepted
      {
        activeExecutor =
          "bg-continued-processing-task"

        latestStage =
          continuedResult.running
            ? "running"
            : "submitted"

        latestMessage =
          continuedResult.running
            ? "Background processing is running."
            : "Background processing was submitted to iOS."

        let payload =
          createStatePayload(
            additionalValues: [
              "accepted":
                true,

              "started":
                true,

              "submitted":
                continuedResult.submitted,

              "alreadyRunning":
                continuedResult.running,

              "continuedProcessing":
                true,

              "continuedProcessingState":
                continuedResult
                  .state
                  .rawValue
            ]
          )

        sendEvent(
          "onBackgroundTaskStarted",
          payload
        )

        return payload
      }
    }

    /*
     * Fallback:
     *
     * يستخدم على إصدارات iOS الأقدم من iOS 26،
     * أو عندما يرفض النظام BGContinuedProcessingTask.
     */
    return beginLegacyBackgroundTask(
      taskId:
        taskId,

      taskName:
        normalizedName
    )
  }

  /* =======================================================
   * Legacy fallback
   * ===================================================== */

  @MainActor
  private func beginLegacyBackgroundTask(
    taskId:
      String,
    taskName:
      String
  ) -> [String: Any] {
    latestStage =
      "running"

    latestMessage =
      "Background processing is running."

    let identifier =
      UIApplication
        .shared
        .beginBackgroundTask(
          withName:
            taskName
        ) {
          Task {
            @MainActor
            [weak self] in

            self?
              .handleLegacyExpiration()
          }
        }

    backgroundTaskIdentifier =
      identifier

    guard
      identifier !=
        .invalid
    else {
      backgroundTaskIdentifier =
        .invalid

      activeExecutor =
        "idle"

      let failedTaskId =
        taskId

      clearState()

      return [
        "accepted":
          false,

        "started":
          false,

        "submitted":
          false,

        "running":
          false,

        "taskId":
          failedTaskId,

        "nativeTaskId":
          failedTaskId,

        "platform":
          "ios",

        "executor":
          "ios-background-task",

        "continuedProcessing":
          false,

        "status":
          "unavailable",

        "errorCode":
          "BACKGROUND_TASK_START_FAILED",

        "errorMessage":
          "iOS did not grant background execution time."
      ]
    }

    activeExecutor =
      "ios-background-task"

    let payload =
      createStatePayload(
        additionalValues: [
          "accepted":
            true,

          "started":
            true,

          "submitted":
            true,

          "alreadyRunning":
            false,

          "continuedProcessing":
            false
        ]
      )

    sendEvent(
      "onBackgroundTaskStarted",
      payload
    )

    return payload
  }

  /* =======================================================
   * Update
   * ===================================================== */

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
      activeTaskId ==
        taskId,
      isAnyTaskRunning()
    else {
      return [
        "updated":
          false,

        "running":
          false,

        "taskId":
          taskId,

        "nativeTaskId":
          taskId,

        "platform":
          "ios",

        "executor":
          activeExecutor,

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
      let stage
    {
      let normalizedStage =
        stage
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      if
        !normalizedStage
          .isEmpty
      {
        latestStage =
          normalizedStage
      }
    }

    if
      let message
    {
      let normalizedMessage =
        message
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      if
        !normalizedMessage
          .isEmpty
      {
        latestMessage =
          normalizedMessage
      }
    }

    if
      activeExecutor ==
        "bg-continued-processing-task"
    {
      BackgroundTaskManager
        .shared
        .update(
          progress:
            latestProgress,

          title:
            createContinuedProcessingTitle(),

          subtitle:
            createContinuedProcessingSubtitle()
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

  /* =======================================================
   * Legacy expiration
   * ===================================================== */

  @MainActor
  private func handleLegacyExpiration() {
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

          "running":
            false,

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

        completed:
          false,

        emitEvent:
          false
      )
  }

  /* =======================================================
   * Continued-processing expiration
   * ===================================================== */

  @MainActor
  private func handleContinuedProcessingExpiration(
    reason:
      String
  ) {
    guard
      activeExecutor ==
        "bg-continued-processing-task"
    else {
      return
    }

    let payload =
      createStatePayload(
        additionalValues: [
          "expired":
            true,

          "running":
            false,

          "status":
            "expired",

          "reason":
            reason,

          "errorCode":
            "CONTINUED_PROCESSING_EXPIRED",

          "errorMessage":
            reason
        ]
      )

    activeExecutor =
      "idle"

    backgroundTaskIdentifier =
      .invalid

    clearState()

    sendEvent(
      "onBackgroundTaskExpired",
      payload
    )
  }

  /* =======================================================
   * Continued-processing cancellation
   * ===================================================== */

  @MainActor
  private func handleContinuedProcessingCancellation(
    reason:
      String
  ) {
    guard
      activeExecutor ==
        "bg-continued-processing-task"
    else {
      return
    }

    let payload =
      createStatePayload(
        additionalValues: [
          "stopped":
            true,

          "running":
            false,

          "status":
            "cancelled",

          "reason":
            reason,

          "errorCode":
            "CONTINUED_PROCESSING_CANCELLED",

          "errorMessage":
            reason
        ]
      )

    activeExecutor =
      "idle"

    backgroundTaskIdentifier =
      .invalid

    clearState()

    sendEvent(
      "onBackgroundTaskStopped",
      payload
    )
  }

  /* =======================================================
   * Stop
   * ===================================================== */

  @MainActor
  private func endBackgroundTask(
    requestedTaskId:
      String?,
    reason:
      String,
    completed:
      Bool,
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

        "running":
          isAnyTaskRunning(),

        "taskId":
          normalizedRequestedTaskId,

        "nativeTaskId":
          normalizedRequestedTaskId,

        "platform":
          "ios",

        "executor":
          activeExecutor,

        "status":
          "task-id-mismatch",

        "errorCode":
          "BACKGROUND_TASK_NOT_FOUND",

        "errorMessage":
          "The supplied task ID does not match the active iOS background task."
      ]
    }

    guard
      isAnyTaskRunning()
    else {
      let taskIdValue:
        Any =
          activeTaskId ??
          normalizedRequestedTaskId ??
          NSNull()

      return [
        "stopped":
          false,

        "running":
          false,

        "taskId":
          taskIdValue,

        "nativeTaskId":
          taskIdValue,

        "platform":
          "ios",

        "executor":
          activeExecutor,

        "status":
          "idle",

        "reason":
          reason
      ]
    }

    let executorBeingStopped =
      activeExecutor

    let payload =
      createStatePayload(
        additionalValues: [
          "stopped":
            true,

          "running":
            false,

          "status":
            completed
              ? "completed"
              : "stopped",

          "reason":
            reason
        ]
      )

    /*
     * نغيّر executor قبل استدعاء cancel.
     *
     * BackgroundTaskManager.cancel قد يستدعي
     * cancellation callback فورًا.
     *
     * تغيير القيمة هنا يمنع إرسال حدث إيقاف مكرر.
     */
    activeExecutor =
      "stopping"

    if
      executorBeingStopped ==
        "bg-continued-processing-task"
    {
      if
        completed
      {
        BackgroundTaskManager
          .shared
          .complete(
            success:
              true
          )
      } else {
        BackgroundTaskManager
          .shared
          .cancel(
            reason:
              reason
          )
      }
    }

    if
      backgroundTaskIdentifier !=
        .invalid
    {
      let identifier =
        backgroundTaskIdentifier

      backgroundTaskIdentifier =
        .invalid

      UIApplication
        .shared
        .endBackgroundTask(
          identifier
        )
    }

    activeExecutor =
      "idle"

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

  /* =======================================================
   * State payload
   * ===================================================== */

  @MainActor
  private func createStatePayload(
    additionalValues:
      [String: Any] =
      [:]
  ) -> [String: Any] {
    let running =
      isAnyTaskRunning()

    let taskIdValue:
      Any =
        activeTaskId ??
        NSNull()

    let startedAtValue:
      Any =
        startedAt ??
        NSNull()

    var payload:
      [String: Any] = [
        "available":
          true,

        "platform":
          "ios",

        "executor":
          activeExecutor,

        "running":
          running,

        "status":
          running
            ? "processing"
            : "idle",

        "taskId":
          taskIdValue,

        "nativeTaskId":
          taskIdValue,

        "nativeJobId":
          NSNull(),

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
          startedAtValue,

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
          ),

        "continuedProcessing":
          activeExecutor ==
            "bg-continued-processing-task",

        "continuedProcessingAvailable":
          BackgroundTaskManager
            .shared
            .isSupported()
      ]

    if
      activeExecutor ==
        "bg-continued-processing-task"
    {
      let continuedPayload =
        BackgroundTaskManager
          .shared
          .createStatePayload()

      payload[
        "continuedProcessingState"
      ] =
        continuedPayload[
          "state"
        ] ??
        NSNull()

      payload[
        "continuedProcessingSubmitted"
      ] =
        continuedPayload[
          "submitted"
        ] ??
        false
    }

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

  /* =======================================================
   * Helpers
   * ===================================================== */

  @MainActor
  private func isAnyTaskRunning() -> Bool {
    if
      backgroundTaskIdentifier !=
        .invalid
    {
      return true
    }

    if
      activeExecutor ==
        "bg-continued-processing-task"
    {
      let payload =
        BackgroundTaskManager
          .shared
          .createStatePayload()

      return payload[
        "running"
      ] as?
        Bool ??
        false
    }

    return false
  }

  private func createContinuedProcessingTitle() -> String {
    if
      latestProgress >=
        1.0
    {
      return "Wardrobe processing complete"
    }

    return "Processing your wardrobe"
  }

  private func createContinuedProcessingSubtitle() -> String {
    let percentage =
      Int(
        (
          latestProgress *
            100.0
        )
        .rounded()
      )

    if
      latestMessage
        .isEmpty
    {
      return "\(percentage)% complete"
    }

    return
      "\(percentage)% — \(latestMessage)"
  }

  private func normalizeText(
    _ value:
      String?,
    fallback:
      String
  ) -> String {
    let normalized =
      value?
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    if
      let normalized,
      !normalized
        .isEmpty
    {
      return normalized
    }

    return fallback
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

  @MainActor
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
    return "The iOS background task ID is missing."
  }
}