import ExpoModulesCore

/*
 * Triple N - Disabled iOS Background Module
 *
 * المعالجة على iOS تعمل فقط أثناء عمل التطبيق بصورة طبيعية.
 *
 * هذا الموديول موجود كتوافق مؤقت مع واجهة JavaScript الحالية فقط.
 * لا يبدأ Background Task ولا يطلب وقت تنفيذ إضافيًا من iOS.
 */
public final class TripleNBackgroundModule:
  Module {

  public func definition() ->
    ModuleDefinition {

    Name(
      "TripleNBackground"
    )

    /*
     * نُبقي أسماء الأحداث متاحة حتى لا تنكسر
     * الاشتراكات الموجودة في JavaScript.
     *
     * هذا الموديول لا يرسل هذه الأحداث.
     */
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
     * false تعني أن تنفيذ المعالجة في الخلفية
     * غير متاح عمدًا على iOS.
     */
    Constant(
      "available"
    ) {
      false
    }

    AsyncFunction(
      "isAvailable"
    ) { () -> [String: Any] in
      return self.createDisabledState(
        additionalValues: [
          "available":
            false
        ]
      )
    }

    /*
     * لا يبدأ أي مهمة خلفية.
     *
     * تُعاد نتيجة واضحة بدل رمي Exception،
     * حتى يستطيع كود JavaScript استخدام
     * المعالجة العادية داخل التطبيق.
     */
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

      return self.createDisabledState(
        taskId:
          normalizedTaskId,

        additionalValues: [
          "accepted":
            false,

          "started":
            false,

          "submitted":
            false,

          "reason":
            "disabled",

          "taskName":
            self.normalizedOptionalText(
              taskName
            )
        ]
      )
    }

    /*
     * لا يوجد Native Background Task لتحديثه.
     *
     * الدالة موجودة فقط للحفاظ على توافق
     * واجهة JavaScript القديمة.
     */
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

      return self.createDisabledState(
        taskId:
          normalizedTaskId,

        additionalValues: [
          "updated":
            false,

          "progress":
            self.normalizedProgress(
              progress
            ),

          "percentage":
            Int(
              (
                self.normalizedProgress(
                  progress
                ) *
                  100.0
              )
              .rounded()
            ),

          "stage":
            self.normalizedOptionalText(
              stage
            ),

          "message":
            self.normalizedOptionalText(
              message
            )
        ]
      )
    }

    /*
     * لا توجد مهمة خلفية نشطة لإيقافها.
     */
    AsyncFunction(
      "stopBackgroundTask"
    ) {
      (
        taskId:
          String?
      ) -> [String: Any] in

      return self.createDisabledState(
        taskId:
          self.normalizedOptionalText(
            taskId
          ),

        additionalValues: [
          "stopped":
            false,

          "reason":
            "disabled"
        ]
      )
    }

    /*
     * الحالة ستظل دائمًا disabled وغير عاملة.
     */
    AsyncFunction(
      "getBackgroundTaskState"
    ) { () -> [String: Any] in
      return self.createDisabledState()
    }
  }

  /* =======================================================
   * Disabled state
   * ===================================================== */

  private func createDisabledState(
    taskId:
      String? =
        nil,

    additionalValues:
      [String: Any] =
        [:]
  ) -> [String: Any] {

    let normalizedTaskId =
      normalizedOptionalText(
        taskId
      )

    let taskIdValue:
      Any =
        normalizedTaskId ??
        NSNull()

    var payload:
      [String: Any] = [
        "available":
          false,

        "platform":
          "ios",

        "executor":
          "disabled",

        "status":
          "disabled",

        "running":
          false,

        "accepted":
          false,

        "started":
          false,

        "submitted":
          false,

        "updated":
          false,

        "stopped":
          false,

        "taskId":
          taskIdValue,

        "nativeTaskId":
          taskIdValue,

        "nativeJobId":
          NSNull(),

        "continuedProcessing":
          false,

        "continuedProcessingAvailable":
          false,

        "backgroundTimeRemaining":
          0.0,

        "errorCode":
          "IOS_BACKGROUND_PROCESSING_DISABLED",

        "errorMessage":
          "iOS background processing is disabled. Processing is available only while the app is open.",

        "updatedAt":
          Date()
            .timeIntervalSince1970
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

  /* =======================================================
   * Helpers
   * ===================================================== */

  private func normalizedOptionalText(
    _ value:
      String?
  ) -> String? {

    guard
      let value
    else {
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

  private func normalizedProgress(
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
}