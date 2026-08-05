//
// NativeSegmentationEngine.swift
//
// Triple N - Native EdgeSAM Segmentation Engine
//
// Part 1/5
//
// مسؤوليات الملف الكامل:
//
// 1) استقبال Encoder Tensor الجاهز من NativeScanProcessor.
// 2) تشغيل EdgeSAM Encoder عبر NativeONNXSession.
// 3) بناء Prompts الخاصة بالـDecoder.
// 4) بناء جميع Decoder Tensors المطلوبة.
// 5) تمرير Image Embedding بدون نسخة Swift إضافية.
// 6) تشغيل EdgeSAM Decoder.
// 7) تحديد Mask Output وScore Output.
// 8) الاحتفاظ بمخرجات ONNX للعزل والمعالجة اللاحقة.
// 9) منع أكثر من Segmentation واحدة في الوقت نفسه.
// 10) دعم Cancellation وDiagnostics وDispose.
//
// ترتيب الأجزاء:
//
// Part 1:
// - جميع العقود.
// - جميع الأخطاء.
// - Diagnostics.
// - Stored Properties.
// - Initialization.
//
// Part 2:
// - التهيئة.
// - إدارة دورة حياة الـEngine.
// - التحقق من الطلب.
//
// Part 3:
// - تشغيل Encoder.
// - بناء Prompts.
// - حل أسماء Decoder Inputs.
//
// Part 4:
// - إنشاء Decoder Tensors.
// - تشغيل Decoder.
// - إنشاء النتيجة.
//
// Part 5:
// - Helpers.
// - Diagnostics updates.
// - Cancellation.
// - Dispose.
// - إغلاق الملف.
//

import Foundation
import CoreGraphics

#if canImport(onnxruntime_objc)
import onnxruntime_objc
#endif

/* =========================================================
 * Engine state
 * ======================================================= */

enum NativeSegmentationEngineState:
  String,
  Codable,
  Equatable,
  Sendable {

  case uninitialized

  case initializing

  case ready

  case encoding

  case preparingDecoder

  case decoding

  case completed

  case failed

  case cancelling

  case disposed
}

/* =========================================================
 * Prompt point
 * ======================================================= */

struct NativeSegmentationPromptPoint:
  Equatable,
  Sendable {

  /*
   * الإحداثيات موجودة داخل أبعاد الصورة الأصلية
   * بعد تصحيح Orientation.
   */
  let x:
    Float

  let y:
    Float

  /*
   * EdgeSAM / SAM labels:
   *
   * 1 = foreground point
   * 0 = background point
   * -1 = padding / unused point
   */
  let label:
    Float

  func validated(
    imageWidth:
      Int,
    imageHeight:
      Int
  ) throws ->
      NativeSegmentationPromptPoint {
    guard
      x.isFinite,
      y.isFinite,
      label.isFinite
    else {
      throw NativeSegmentationEngineError
        .invalidPromptPoint(
          x:
            x,
          y:
            y,
          label:
            label
        )
    }

    guard
      imageWidth >
        0,
      imageHeight >
        0
    else {
      throw NativeSegmentationEngineError
        .invalidSourceDimensions(
          width:
            imageWidth,
          height:
            imageHeight
        )
    }

    guard
      x >=
        0,
      y >=
        0,
      x <=
        Float(
          imageWidth
        ),
      y <=
        Float(
          imageHeight
        )
    else {
      throw NativeSegmentationEngineError
        .promptPointOutsideImage(
          x:
            x,
          y:
            y,
          imageWidth:
            imageWidth,
          imageHeight:
            imageHeight
        )
    }

    guard
      label ==
        1 ||
      label ==
        0 ||
      label ==
        -1
    else {
      throw NativeSegmentationEngineError
        .unsupportedPromptLabel(
          label:
            label
        )
    }

    return self
  }
}

/* =========================================================
 * Prompt set
 * ======================================================= */

struct NativeSegmentationPromptSet:
  Equatable,
  Sendable {

  let points:
    [NativeSegmentationPromptPoint]

  /*
   * عند true، يطلب من Decoder إرجاع عدة Masks
   * لو كان الموديل يدعم multimask_output.
   *
   * لا يغير دقة الموديل أو Thresholds.
   */
  let requestMultipleMasks:
    Bool

  /*
   * Mask input اختيارية لمرحلة Refinement لاحقة.
   *
   * النسخة الأولى تستخدم nil وتضع hasMaskInput = 0.
   */
  let previousMask:
    ContiguousArray<Float>?

  let previousMaskShape:
    [NSNumber]?

  static func automaticCenterPrompt(
    imageWidth:
      Int,
    imageHeight:
      Int
  ) -> NativeSegmentationPromptSet {
    return NativeSegmentationPromptSet(
      points: [
        NativeSegmentationPromptPoint(
          x:
            Float(
              imageWidth
            ) *
            0.5,

          y:
            Float(
              imageHeight
            ) *
            0.5,

          label:
            1
        )
      ],

      requestMultipleMasks:
        true,

      previousMask:
        nil,

      previousMaskShape:
        nil
    )
  }
}

/* =========================================================
 * Letterbox information
 * ======================================================= */

struct NativeSegmentationLetterboxInfo:
  Equatable,
  Sendable {

  let modelWidth:
    Int

  let modelHeight:
    Int

  let sourceWidth:
    Int

  let sourceHeight:
    Int

  let resizedWidth:
    Int

  let resizedHeight:
    Int

  let paddingLeft:
    Int

  let paddingTop:
    Int

  let paddingRight:
    Int

  let paddingBottom:
    Int

  let scale:
    Double

  func validated()
    throws ->
      NativeSegmentationLetterboxInfo {
    guard
      modelWidth >
        0,
      modelHeight >
        0
    else {
      throw NativeSegmentationEngineError
        .invalidModelDimensions(
          width:
            modelWidth,
          height:
            modelHeight
        )
    }

    guard
      sourceWidth >
        0,
      sourceHeight >
        0
    else {
      throw NativeSegmentationEngineError
        .invalidSourceDimensions(
          width:
            sourceWidth,
          height:
            sourceHeight
        )
    }

    guard
      resizedWidth >
        0,
      resizedHeight >
        0,
      resizedWidth <=
        modelWidth,
      resizedHeight <=
        modelHeight
    else {
      throw NativeSegmentationEngineError
        .invalidResizedDimensions(
          width:
            resizedWidth,
          height:
            resizedHeight,
          modelWidth:
            modelWidth,
          modelHeight:
            modelHeight
        )
    }

    guard
      paddingLeft >=
        0,
      paddingTop >=
        0,
      paddingRight >=
        0,
      paddingBottom >=
        0
    else {
      throw NativeSegmentationEngineError
        .invalidLetterboxPadding
    }

    guard
      paddingLeft +
      resizedWidth +
      paddingRight ==
      modelWidth,
      paddingTop +
      resizedHeight +
      paddingBottom ==
      modelHeight
    else {
      throw NativeSegmentationEngineError
        .inconsistentLetterboxDimensions
    }

    guard
      scale.isFinite,
      scale >
        0
    else {
      throw NativeSegmentationEngineError
        .invalidLetterboxScale(
          scale:
            scale
        )
    }

    return self
  }
}

/* =========================================================
 * Segmentation request
 * ======================================================= */

struct NativeSegmentationEngineRequest:
  @unchecked Sendable {

  let jobId:
    String

  /*
   * Encoder input:
   *
   * [1, 3, modelHeight, modelWidth]
   * NCHW Float32
   */
  let encoderTensor:
    ContiguousArray<Float>

  let encoderTensorShape:
    [NSNumber]

  let letterbox:
    NativeSegmentationLetterboxInfo

  let prompt:
    NativeSegmentationPromptSet

  let createdAt:
    NativeProcessingTimestamp

  let metadata:
    [String: String]

  func validated()
    throws ->
      NativeSegmentationEngineRequest {
    let normalizedJobId =
      jobId
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard
      !normalizedJobId.isEmpty
    else {
      throw NativeSegmentationEngineError
        .missingJobId
    }

    guard
      !encoderTensor.isEmpty
    else {
      throw NativeSegmentationEngineError
        .encoderTensorIsEmpty
    }

    guard
      encoderTensorShape.count ==
        4
    else {
      throw NativeSegmentationEngineError
        .invalidEncoderTensorShape(
          shape:
            encoderTensorShape
              .map {
                $0.intValue
              }
        )
    }

    let normalizedShape =
      encoderTensorShape
        .map {
          $0.intValue
        }

    guard
      normalizedShape[
        0
      ] ==
        1,
      normalizedShape[
        1
      ] ==
        3
    else {
      throw NativeSegmentationEngineError
        .invalidEncoderTensorShape(
          shape:
            normalizedShape
        )
    }

    let validatedLetterbox =
      try letterbox
        .validated()

    guard
      normalizedShape[
        2
      ] ==
        validatedLetterbox
          .modelHeight,
      normalizedShape[
        3
      ] ==
        validatedLetterbox
          .modelWidth
    else {
      throw NativeSegmentationEngineError
        .encoderShapeDoesNotMatchModel(
          shape:
            normalizedShape,
          modelWidth:
            validatedLetterbox
              .modelWidth,
          modelHeight:
            validatedLetterbox
              .modelHeight
        )
    }

    var expectedElementCount =
      1

    for dimension in
      normalizedShape
    {
      guard
        dimension >
          0
      else {
        throw NativeSegmentationEngineError
          .invalidEncoderTensorShape(
            shape:
              normalizedShape
          )
      }

      let multiplication =
        expectedElementCount
          .multipliedReportingOverflow(
            by:
              dimension
          )

      guard
        !multiplication.overflow,
        multiplication.partialValue >
          0
      else {
        throw NativeSegmentationEngineError
          .invalidEncoderTensorShape(
            shape:
              normalizedShape
          )
      }

      expectedElementCount =
        multiplication
          .partialValue
    }

    guard
      expectedElementCount ==
        encoderTensor.count
    else {
      throw NativeSegmentationEngineError
        .encoderTensorElementCountMismatch(
          expected:
            expectedElementCount,
          received:
            encoderTensor.count
        )
    }

    guard
      !prompt.points.isEmpty
    else {
      throw NativeSegmentationEngineError
        .promptSetIsEmpty
    }

    for point in
      prompt.points
    {
      _ =
        try point.validated(
          imageWidth:
            validatedLetterbox
              .sourceWidth,

          imageHeight:
            validatedLetterbox
              .sourceHeight
        )
    }

    if
      let previousMask =
        prompt.previousMask
    {
      guard
        let previousMaskShape =
          prompt.previousMaskShape
      else {
        throw NativeSegmentationEngineError
          .previousMaskShapeMissing
      }

      let expectedMaskElementCount =
        try Self
          .calculateElementCount(
            shape:
              previousMaskShape
          )

      guard
        expectedMaskElementCount ==
          previousMask.count
      else {
        throw NativeSegmentationEngineError
          .previousMaskElementCountMismatch(
            expected:
              expectedMaskElementCount,
            received:
              previousMask.count
          )
      }
    } else if
      prompt.previousMaskShape !=
        nil
    {
      throw NativeSegmentationEngineError
        .previousMaskDataMissing
    }

    return NativeSegmentationEngineRequest(
      jobId:
        normalizedJobId,

      encoderTensor:
        encoderTensor,

      encoderTensorShape:
        encoderTensorShape,

      letterbox:
        validatedLetterbox,

      prompt:
        prompt,

      createdAt:
        createdAt,

      metadata:
        metadata
    )
  }

  private static func calculateElementCount(
    shape:
      [NSNumber]
  ) throws ->
      Int {
    guard
      !shape.isEmpty
    else {
      throw NativeSegmentationEngineError
        .invalidPreviousMaskShape(
          shape:
            []
        )
    }

    var elementCount =
      1

    for dimension in
      shape
    {
      let value =
        dimension.intValue

      guard
        value >
          0
      else {
        throw NativeSegmentationEngineError
          .invalidPreviousMaskShape(
            shape:
              shape.map {
                $0.intValue
              }
          )
      }

      let multiplication =
        elementCount
          .multipliedReportingOverflow(
            by:
              value
          )

      guard
        !multiplication.overflow,
        multiplication.partialValue >
          0
      else {
        throw NativeSegmentationEngineError
          .invalidPreviousMaskShape(
            shape:
              shape.map {
                $0.intValue
              }
          )
      }

      elementCount =
        multiplication
          .partialValue
    }

    return elementCount
  }
}

/* =========================================================
 * Decoder input-name mapping
 * ======================================================= */

struct NativeSegmentationDecoderInputNames:
  Equatable,
  Sendable {

  let imageEmbeddings:
    String

  let pointCoordinates:
    String

  let pointLabels:
    String

  let maskInput:
    String?

  let hasMaskInput:
    String?

  let originalImageSize:
    String?

  let multimaskOutput:
    String?

  let declaredInputNames:
    [String]

  func asDictionary()
    -> [String: Any] {
    return [
      "imageEmbeddings":
        imageEmbeddings,

      "pointCoordinates":
        pointCoordinates,

      "pointLabels":
        pointLabels,

      "maskInput":
        maskInput ??
        NSNull(),

      "hasMaskInput":
        hasMaskInput ??
        NSNull(),

      "originalImageSize":
        originalImageSize ??
        NSNull(),

      "multimaskOutput":
        multimaskOutput ??
        NSNull(),

      "declaredInputNames":
        declaredInputNames
    ]
  }
}

/* =========================================================
 * Timing
 * ======================================================= */

struct NativeSegmentationEngineTiming:
  Equatable,
  Sendable {

  let startedAt:
    NativeProcessingTimestamp

  let encoderStartedAt:
    NativeProcessingTimestamp

  let encoderCompletedAt:
    NativeProcessingTimestamp

  let decoderStartedAt:
    NativeProcessingTimestamp

  let decoderCompletedAt:
    NativeProcessingTimestamp

  let completedAt:
    NativeProcessingTimestamp

  let encoderDurationMs:
    Int64

  let decoderDurationMs:
    Int64

  let totalDurationMs:
    Int64

  func asDictionary()
    -> [String: Any] {
    return [
      "startedAt":
        startedAt,

      "encoderStartedAt":
        encoderStartedAt,

      "encoderCompletedAt":
        encoderCompletedAt,

      "decoderStartedAt":
        decoderStartedAt,

      "decoderCompletedAt":
        decoderCompletedAt,

      "completedAt":
        completedAt,

      "encoderDurationMs":
        encoderDurationMs,

      "decoderDurationMs":
        decoderDurationMs,

      "totalDurationMs":
        totalDurationMs
    ]
  }
}

/* =========================================================
 * Engine result
 * ======================================================= */

struct NativeSegmentationEngineResult:
  @unchecked Sendable {

  let jobId:
    String

  let encoderResult:
    NativeONNXEncoderResult

  let decoderResult:
    NativeONNXDecoderResult

  let decoderInputNames:
    NativeSegmentationDecoderInputNames

  let letterbox:
    NativeSegmentationLetterboxInfo

  let promptPointCount:
    Int

  let requestedMultipleMasks:
    Bool

  let timing:
    NativeSegmentationEngineTiming

  let metadata:
    [String: String]

  var primaryMaskOutput:
    NativeONNXTensorOutput? {
    return decoderResult
      .primaryMaskOutput
  }

  var scoreOutput:
    NativeONNXTensorOutput? {
    return decoderResult
      .scoreOutput
  }

  func asDictionary()
    -> [String: Any] {
    return [
      "jobId":
        jobId,

      "encoder":
        encoderResult
          .asDictionary(),

      "decoder":
        decoderResult
          .asDictionary(),

      "decoderInputNames":
        decoderInputNames
          .asDictionary(),

      "promptPointCount":
        promptPointCount,

      "requestedMultipleMasks":
        requestedMultipleMasks,

      "sourceWidth":
        letterbox.sourceWidth,

      "sourceHeight":
        letterbox.sourceHeight,

      "modelWidth":
        letterbox.modelWidth,

      "modelHeight":
        letterbox.modelHeight,

      "timing":
        timing
          .asDictionary(),

      "metadata":
        metadata
    ]
  }
}

/* =========================================================
 * Configuration
 * ======================================================= */

struct NativeSegmentationEngineConfiguration:
  Equatable,
  Sendable {

  let maximumPromptPointCount:
    Int

  let defaultMaskInputWidth:
    Int

  let defaultMaskInputHeight:
    Int

  let allowUnknownOptionalDecoderInputs:
    Bool

  let enableAutomaticInitialization:
    Bool

  static let `default` =
    NativeSegmentationEngineConfiguration(
      maximumPromptPointCount:
        64,

      defaultMaskInputWidth:
        256,

      defaultMaskInputHeight:
        256,

      allowUnknownOptionalDecoderInputs:
        false,

      enableAutomaticInitialization:
        true
    )
}

/* =========================================================
 * Diagnostics
 * ======================================================= */

struct NativeSegmentationEngineDiagnostics:
  Equatable,
  Sendable {

  let state:
    NativeSegmentationEngineState

  let initialized:
    Bool

  let disposed:
    Bool

  let activeJobId:
    String?

  let activeInferenceCount:
    Int

  let initializationCount:
    Int

  let inferenceCount:
    Int

  let completedInferenceCount:
    Int

  let failedInferenceCount:
    Int

  let cancelledInferenceCount:
    Int

  let lastInitializedAt:
    NativeProcessingTimestamp?

  let lastInferenceStartedAt:
    NativeProcessingTimestamp?

  let lastInferenceCompletedAt:
    NativeProcessingTimestamp?

  let lastError:
    String?

  let onnx:
    NativeONNXSessionDiagnostics

  func asDictionary()
    -> [String: Any] {
    return [
      "state":
        state.rawValue,

      "initialized":
        initialized,

      "disposed":
        disposed,

      "activeJobId":
        activeJobId ??
        NSNull(),

      "activeInferenceCount":
        activeInferenceCount,

      "initializationCount":
        initializationCount,

      "inferenceCount":
        inferenceCount,

      "completedInferenceCount":
        completedInferenceCount,

      "failedInferenceCount":
        failedInferenceCount,

      "cancelledInferenceCount":
        cancelledInferenceCount,

      "lastInitializedAt":
        lastInitializedAt ??
        NSNull(),

      "lastInferenceStartedAt":
        lastInferenceStartedAt ??
        NSNull(),

      "lastInferenceCompletedAt":
        lastInferenceCompletedAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull(),

      "onnx":
        onnx
          .asDictionary()
    ]
  }
}

/* =========================================================
 * Complete error contract
 * ======================================================= */

enum NativeSegmentationEngineError:
  LocalizedError,
  Equatable,
  Sendable {

  case disposed

  case notInitialized

  case initializationFailed(
    message:
      String
  )

  case missingJobId

  case anotherInferenceIsRunning(
    activeJobId:
      String,
    requestedJobId:
      String
  )

  case jobAlreadyRunning(
    jobId:
      String
  )

  case encoderTensorIsEmpty

  case invalidEncoderTensorShape(
    shape:
      [Int]
  )

  case encoderTensorElementCountMismatch(
    expected:
      Int,
    received:
      Int
  )

  case encoderShapeDoesNotMatchModel(
    shape:
      [Int],
    modelWidth:
      Int,
    modelHeight:
      Int
  )

  case invalidModelDimensions(
    width:
      Int,
    height:
      Int
  )

  case invalidSourceDimensions(
    width:
      Int,
    height:
      Int
  )

  case invalidResizedDimensions(
    width:
      Int,
    height:
      Int,
    modelWidth:
      Int,
    modelHeight:
      Int
  )

  case invalidLetterboxPadding

  case inconsistentLetterboxDimensions

  case invalidLetterboxScale(
    scale:
      Double
  )

  case promptSetIsEmpty

  case tooManyPromptPoints(
    count:
      Int,
    maximum:
      Int
  )

  case invalidPromptPoint(
    x:
      Float,
    y:
      Float,
    label:
      Float
  )

  case promptPointOutsideImage(
    x:
      Float,
    y:
      Float,
    imageWidth:
      Int,
    imageHeight:
      Int
  )

  case unsupportedPromptLabel(
    label:
      Float
  )

  case previousMaskShapeMissing

  case previousMaskDataMissing

  case invalidPreviousMaskShape(
    shape:
      [Int]
  )

  case previousMaskElementCountMismatch(
    expected:
      Int,
    received:
      Int
  )

  case encoderOutputUnavailable

  case decoderInterfaceUnavailable

  case decoderInputNameNotFound(
    semanticName:
      String,
    declaredInputNames:
      [String]
  )

  case ambiguousDecoderInputName(
    semanticName:
      String,
    matchingInputNames:
      [String]
  )

  case unsupportedRequiredDecoderInput(
    inputName:
      String
  )

  case decoderTensorCreationFailed(
    inputName:
      String,
    message:
      String
  )

  case decoderExecutionUnavailable

  case decoderOutputUnavailable

  case segmentationFailed(
    message:
      String
  )

  case cancelled(
    reason:
      String?
  )

  var errorDescription:
    String? {
    switch self {
    case .disposed:
      return
        "The native segmentation engine has been disposed."

    case .notInitialized:
      return
        "The native segmentation engine has not been initialized."

    case .initializationFailed(
      let message
    ):
      return
        """
        Native segmentation engine initialization failed: \(message)
        """

    case .missingJobId:
      return
        "The native segmentation request does not contain a valid job ID."

    case .anotherInferenceIsRunning(
      let activeJobId,
      let requestedJobId
    ):
      return
        """
        Native segmentation job \(requestedJobId) cannot start because job \(activeJobId) is already running.
        """

    case .jobAlreadyRunning(
      let jobId
    ):
      return
        """
        Native segmentation job \(jobId) is already running.
        """

    case .encoderTensorIsEmpty:
      return
        "The native segmentation encoder tensor is empty."

    case .invalidEncoderTensorShape(
      let shape
    ):
      return
        """
        The native segmentation encoder tensor shape is invalid: \(shape).
        """

    case .encoderTensorElementCountMismatch(
      let expected,
      let received
    ):
      return
        """
        The native segmentation encoder tensor contains an invalid number of values. Expected \(expected), received \(received).
        """

    case .encoderShapeDoesNotMatchModel(
      let shape,
      let modelWidth,
      let modelHeight
    ):
      return
        """
        The encoder tensor shape \(shape) does not match the model size \(modelWidth)x\(modelHeight).
        """

    case .invalidModelDimensions(
      let width,
      let height
    ):
      return
        """
        The native segmentation model dimensions are invalid: \(width)x\(height).
        """

    case .invalidSourceDimensions(
      let width,
      let height
    ):
      return
        """
        The native segmentation source dimensions are invalid: \(width)x\(height).
        """

    case .invalidResizedDimensions(
      let width,
      let height,
      let modelWidth,
      let modelHeight
    ):
      return
        """
        The resized dimensions \(width)x\(height) are invalid for model dimensions \(modelWidth)x\(modelHeight).
        """

    case .invalidLetterboxPadding:
      return
        "The native segmentation letterbox contains negative padding."

    case .inconsistentLetterboxDimensions:
      return
        "The native segmentation letterbox dimensions are inconsistent."

    case .invalidLetterboxScale(
      let scale
    ):
      return
        """
        The native segmentation letterbox scale is invalid: \(scale).
        """

    case .promptSetIsEmpty:
      return
        "The native segmentation prompt set is empty."

    case .tooManyPromptPoints(
      let count,
      let maximum
    ):
      return
        """
        The native segmentation request contains \(count) prompt points. The maximum allowed count is \(maximum).
        """

    case .invalidPromptPoint(
      let x,
      let y,
      let label
    ):
      return
        """
        The native segmentation prompt point is invalid: x=\(x), y=\(y), label=\(label).
        """

    case .promptPointOutsideImage(
      let x,
      let y,
      let imageWidth,
      let imageHeight
    ):
      return
        """
        The prompt point \(x),\(y) is outside the source image \(imageWidth)x\(imageHeight).
        """

    case .unsupportedPromptLabel(
      let label
    ):
      return
        """
        The native segmentation prompt label \(label) is unsupported.
        """

    case .previousMaskShapeMissing:
      return
        "Previous mask data was supplied without its tensor shape."

    case .previousMaskDataMissing:
      return
        "A previous-mask shape was supplied without previous-mask data."

    case .invalidPreviousMaskShape(
      let shape
    ):
      return
        """
        The previous-mask tensor shape is invalid: \(shape).
        """

    case .previousMaskElementCountMismatch(
      let expected,
      let received
    ):
      return
        """
        Previous-mask tensor element count is invalid. Expected \(expected), received \(received).
        """

    case .encoderOutputUnavailable:
      return
        "EdgeSAM encoder did not return a usable image embedding."

    case .decoderInterfaceUnavailable:
      return
        "The EdgeSAM decoder model interface is unavailable."

    case .decoderInputNameNotFound(
      let semanticName,
      let declaredInputNames
    ):
      return
        """
        Could not resolve the decoder input \(semanticName). Declared inputs: \(declaredInputNames.joined(separator: ", ")).
        """

    case .ambiguousDecoderInputName(
      let semanticName,
      let matchingInputNames
    ):
      return
        """
        Multiple decoder inputs match \(semanticName): \(matchingInputNames.joined(separator: ", ")).
        """

    case .unsupportedRequiredDecoderInput(
      let inputName
    ):
      return
        """
        The EdgeSAM decoder requires unsupported input \(inputName).
        """

    case .decoderTensorCreationFailed(
      let inputName,
      let message
    ):
      return
        """
        Could not create decoder tensor \(inputName): \(message)
        """

    case .decoderExecutionUnavailable:
      return
        "EdgeSAM decoder execution is unavailable in this build."

    case .decoderOutputUnavailable:
      return
        "EdgeSAM decoder did not return a usable mask output."

    case .segmentationFailed(
      let message
    ):
      return
        """
        Native EdgeSAM segmentation failed: \(message)
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

      if
        let normalizedReason,
        !normalizedReason.isEmpty
      {
        return normalizedReason
      }

      return
        "Native EdgeSAM segmentation was cancelled."
    }
  }
}

/* =========================================================
 * Engine
 * ======================================================= */

final class NativeSegmentationEngine:
  @unchecked Sendable {

  /* =======================================================
   * Dependencies
   * ===================================================== */

  private let onnxSession:
    NativeONNXSession

  private let configuration:
    NativeSegmentationEngineConfiguration

  private let stateQueue:
    DispatchQueue

  private let executionQueue:
    DispatchQueue

  /* =======================================================
   * State
   * ===================================================== */

  private var state:
    NativeSegmentationEngineState =
      .uninitialized

  private var initialized =
    false

  private var disposed =
    false

  private var activeJobId:
    String?

  private var activeCancellationToken:
    NativeScanCancellationToken?

  private var initializationCount =
    0

  private var inferenceCount =
    0

  private var completedInferenceCount =
    0

  private var failedInferenceCount =
    0

  private var cancelledInferenceCount =
    0

  private var lastInitializedAt:
    NativeProcessingTimestamp?

  private var lastInferenceStartedAt:
    NativeProcessingTimestamp?

  private var lastInferenceCompletedAt:
    NativeProcessingTimestamp?

  private var lastError:
    String?

  /* =======================================================
   * Initialization
   * ===================================================== */

  init(
    onnxSession:
      NativeONNXSession =
        NativeONNXSession(),

    configuration:
      NativeSegmentationEngineConfiguration =
        .default
  ) {
    self.onnxSession =
      onnxSession

    self.configuration =
      configuration

    self.stateQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.segmentation.state",

        qos:
          .userInitiated
      )

    self.executionQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.segmentation.execution",

        qos:
          .userInitiated
      )
  }
  /* =======================================================
   * Public initialization
   * ===================================================== */

  func initialize()
    async throws ->
      [String: Any] {
    let shouldInitialize =
      try stateQueue.sync {
        try assertNotDisposedLocked()

        if
          initialized
        {
          return false
        }

        guard
          state !=
            .initializing
        else {
          throw NativeSegmentationEngineError
            .initializationFailed(
              message:
                "Native segmentation initialization is already running."
            )
        }

        state =
          .initializing

        lastError =
          nil

        return true
      }

    if
      !shouldInitialize
    {
      return createInitializationPayload(
        alreadyInitialized:
          true
      )
    }

    do {
      let onnxInitialization =
        try await onnxSession
          .initialize()

      let initializedAt =
        NativeProcessingTime.now()

      stateQueue.sync {
        initialized =
          true

        state =
          .ready

        initializationCount +=
          1

        lastInitializedAt =
          initializedAt

        lastError =
          nil
      }

      return [
        "initialized":
          true,

        "alreadyInitialized":
          false,

        "state":
          NativeSegmentationEngineState
            .ready
            .rawValue,

        "initializedAt":
          initializedAt,

        "onnx":
          onnxInitialization
      ]
    } catch {
      let wrappedError:
        NativeSegmentationEngineError

      if
        let engineError =
          error as?
            NativeSegmentationEngineError
      {
        wrappedError =
          engineError
      } else {
        wrappedError =
          .initializationFailed(
            message:
              error.localizedDescription
          )
      }

      stateQueue.sync {
        initialized =
          false

        state =
          .failed

        lastError =
          wrappedError
            .localizedDescription
      }

      throw wrappedError
    }
  }

  /* =======================================================
   * Initialization payload
   * ===================================================== */

  private func createInitializationPayload(
    alreadyInitialized:
      Bool
  ) -> [String: Any] {
    let snapshot =
      diagnostics()

    return [
      "initialized":
        snapshot.initialized,

      "alreadyInitialized":
        alreadyInitialized,

      "state":
        snapshot.state
          .rawValue,

      "initializedAt":
        snapshot
          .lastInitializedAt ??
        NSNull(),

      "onnx":
        snapshot
          .onnx
          .asDictionary()
    ]
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  func diagnostics()
    -> NativeSegmentationEngineDiagnostics {
    let engineSnapshot:
      (
        state:
          NativeSegmentationEngineState,

        initialized:
          Bool,

        disposed:
          Bool,

        activeJobId:
          String?,

        activeInferenceCount:
          Int,

        initializationCount:
          Int,

        inferenceCount:
          Int,

        completedInferenceCount:
          Int,

        failedInferenceCount:
          Int,

        cancelledInferenceCount:
          Int,

        lastInitializedAt:
          NativeProcessingTimestamp?,

        lastInferenceStartedAt:
          NativeProcessingTimestamp?,

        lastInferenceCompletedAt:
          NativeProcessingTimestamp?,

        lastError:
          String?
      ) =
        stateQueue.sync {
          (
            state:
              state,

            initialized:
              initialized,

            disposed:
              disposed,

            activeJobId:
              activeJobId,

            activeInferenceCount:
              activeJobId ==
                nil
                ? 0
                : 1,

            initializationCount:
              initializationCount,

            inferenceCount:
              inferenceCount,

            completedInferenceCount:
              completedInferenceCount,

            failedInferenceCount:
              failedInferenceCount,

            cancelledInferenceCount:
              cancelledInferenceCount,

            lastInitializedAt:
              lastInitializedAt,

            lastInferenceStartedAt:
              lastInferenceStartedAt,

            lastInferenceCompletedAt:
              lastInferenceCompletedAt,

            lastError:
              lastError
          )
        }

    return NativeSegmentationEngineDiagnostics(
      state:
        engineSnapshot
          .state,

      initialized:
        engineSnapshot
          .initialized,

      disposed:
        engineSnapshot
          .disposed,

      activeJobId:
        engineSnapshot
          .activeJobId,

      activeInferenceCount:
        engineSnapshot
          .activeInferenceCount,

      initializationCount:
        engineSnapshot
          .initializationCount,

      inferenceCount:
        engineSnapshot
          .inferenceCount,

      completedInferenceCount:
        engineSnapshot
          .completedInferenceCount,

      failedInferenceCount:
        engineSnapshot
          .failedInferenceCount,

      cancelledInferenceCount:
        engineSnapshot
          .cancelledInferenceCount,

      lastInitializedAt:
        engineSnapshot
          .lastInitializedAt,

      lastInferenceStartedAt:
        engineSnapshot
          .lastInferenceStartedAt,

      lastInferenceCompletedAt:
        engineSnapshot
          .lastInferenceCompletedAt,

      lastError:
        engineSnapshot
          .lastError,

      onnx:
        onnxSession
          .diagnostics()
    )
  }

  /* =======================================================
   * Public state
   * ===================================================== */

  var isInitialized:
    Bool {
    return stateQueue.sync {
      initialized &&
      !disposed
    }
  }

  var isDisposed:
    Bool {
    return stateQueue.sync {
      disposed
    }
  }

  var currentState:
    NativeSegmentationEngineState {
    return stateQueue.sync {
      state
    }
  }

  var currentActiveJobId:
    String? {
    return stateQueue.sync {
      activeJobId
    }
  }

  /* =======================================================
   * Public segmentation entry
   * ===================================================== */

  func segment(
    request:
      NativeSegmentationEngineRequest,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeSegmentationEngineResult {
    let validatedRequest =
      try request
        .validated()

    try cancellationToken
      .throwIfCancelled()

    if
      configuration
        .enableAutomaticInitialization
    {
      let requiresInitialization =
        stateQueue.sync {
          !initialized
        }

      if
        requiresInitialization
      {
        _ =
          try await initialize()
      }
    }

    return try await withCheckedThrowingContinuation {
      continuation in

      executionQueue.async {
        let executionTask =
          Task {
            do {
              let result =
                try await self
                  .segmentSynchronouslySerialized(
                    request:
                      validatedRequest,

                    cancellationToken:
                      cancellationToken
                  )

              continuation.resume(
                returning:
                  result
              )
            } catch {
              continuation.resume(
                throwing:
                  error
              )
            }
          }

        /*
         * executionQueue مسلسل بالفعل، وTask هنا
         * فقط يسمح باستخدام async/await داخل الـQueue.
         */
        _ =
          executionTask
      }
    }
  }

  /* =======================================================
   * Serialized segmentation
   * ===================================================== */

  private func segmentSynchronouslySerialized(
    request:
      NativeSegmentationEngineRequest,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    try beginInference(
      request:
        request,

      cancellationToken:
        cancellationToken
    )

    let inferenceStartedAt =
      NativeProcessingTime.now()

    do {
      try cancellationToken
        .throwIfCancelled()

      let result =
        try await performSegmentation(
          request:
            request,

          cancellationToken:
            cancellationToken,

          inferenceStartedAt:
            inferenceStartedAt
        )

      finishInferenceSuccessfully(
        jobId:
          request.jobId
      )

      return result
    } catch {
      finishInferenceWithFailure(
        jobId:
          request.jobId,

        error:
          error,

        cancellationToken:
          cancellationToken
      )

      throw normalizeSegmentationError(
        error,
        cancellationToken:
          cancellationToken
      )
    }
  }

  /* =======================================================
   * Begin inference
   * ===================================================== */

  private func beginInference(
    request:
      NativeSegmentationEngineRequest,

    cancellationToken:
      NativeScanCancellationToken
  ) throws {
    try stateQueue.sync {
      try assertNotDisposedLocked()

      guard
        initialized
      else {
        throw NativeSegmentationEngineError
          .notInitialized
      }

      guard
        request.prompt.points.count <=
          configuration
            .maximumPromptPointCount
      else {
        throw NativeSegmentationEngineError
          .tooManyPromptPoints(
            count:
              request
                .prompt
                .points
                .count,

            maximum:
              configuration
                .maximumPromptPointCount
          )
      }

      if
        let activeJobId
      {
        if
          activeJobId ==
            request.jobId
        {
          throw NativeSegmentationEngineError
            .jobAlreadyRunning(
              jobId:
                request.jobId
            )
        }

        throw NativeSegmentationEngineError
          .anotherInferenceIsRunning(
            activeJobId:
              activeJobId,

            requestedJobId:
              request.jobId
          )
      }

      activeJobId =
        request.jobId

      activeCancellationToken =
        cancellationToken

      state =
        .encoding

      inferenceCount +=
        1

      lastInferenceStartedAt =
        NativeProcessingTime.now()

      lastInferenceCompletedAt =
        nil

      lastError =
        nil
    }
  }

  /* =======================================================
   * Successful inference completion
   * ===================================================== */

  private func finishInferenceSuccessfully(
    jobId:
      String
  ) {
    stateQueue.sync {
      guard
        activeJobId ==
          jobId
      else {
        return
      }

      completedInferenceCount +=
        1

      lastInferenceCompletedAt =
        NativeProcessingTime.now()

      lastError =
        nil

      activeJobId =
        nil

      activeCancellationToken =
        nil

      state =
        initialized
          ? .ready
          : .uninitialized
    }
  }

  /* =======================================================
   * Failed inference completion
   * ===================================================== */

  private func finishInferenceWithFailure(
    jobId:
      String,

    error:
      Error,

    cancellationToken:
      NativeScanCancellationToken
  ) {
    let wasCancelled =
      cancellationToken
        .isCancelled ||
      error is
        CancellationError ||
      isCancellationError(
        error
      )

    stateQueue.sync {
      guard
        activeJobId ==
          jobId
      else {
        return
      }

      if
        wasCancelled
      {
        cancelledInferenceCount +=
          1

        state =
          .ready
      } else {
        failedInferenceCount +=
          1

        state =
          .failed
      }

      lastInferenceCompletedAt =
        NativeProcessingTime.now()

      lastError =
        error.localizedDescription

      activeJobId =
        nil

      activeCancellationToken =
        nil
    }
  }

  /* =======================================================
   * Segmentation pipeline entry
   * ===================================================== */

  private func performSegmentation(
    request:
      NativeSegmentationEngineRequest,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    /*
     * Part 3/5 يبدأ من هنا:
     *
     * 1) تشغيل Encoder.
     * 2) استخراج Image Embedding.
     * 3) فحص Decoder model interface.
     * 4) تحويل Prompt coordinates إلى Letterbox space.
     * 5) حل أسماء Decoder Inputs.
     */
    return try await runEncoderAndPrepareDecoder(
      request:
        request,

      cancellationToken:
        cancellationToken,

      inferenceStartedAt:
        inferenceStartedAt
    )
  }

  /* =======================================================
   * Part 3 entry
   * ===================================================== */

  private func runEncoderAndPrepareDecoder(
    request:
      NativeSegmentationEngineRequest,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    /*
     * التنفيذ الفعلي موجود في Part 3/5 الذي سيتم
     * لصقه مباشرة تحت هذا الجزء.
     */
    return try await executeEncoderAndDecoderPipeline(
      request:
        request,

      cancellationToken:
        cancellationToken,

      inferenceStartedAt:
        inferenceStartedAt
    )
  }

  /* =======================================================
   * Guards
   * ===================================================== */

  private func assertNotDisposedLocked()
    throws {
    guard
      !disposed
    else {
      throw NativeSegmentationEngineError
        .disposed
    }
  }

  /* =======================================================
   * Error normalization
   * ===================================================== */

  private func normalizeSegmentationError(
    _ error:
      Error,

    cancellationToken:
      NativeScanCancellationToken
  ) -> Error {
    if
      cancellationToken
        .isCancelled ||
      error is
        CancellationError ||
      isCancellationError(
        error
      )
    {
      return NativeSegmentationEngineError
        .cancelled(
          reason:
            cancellationToken
              .reason ??
            error.localizedDescription
        )
    }

    if
      error is
        NativeSegmentationEngineError
    {
      return error
    }

    if
      let sessionError =
        error as?
          NativeONNXSessionError
    {
      return NativeSegmentationEngineError
        .segmentationFailed(
          message:
            sessionError
              .localizedDescription
        )
    }

    return NativeSegmentationEngineError
      .segmentationFailed(
        message:
          error.localizedDescription
      )
  }

  /* =======================================================
   * Cancellation classification
   * ===================================================== */

  private func isCancellationError(
    _ error:
      Error
  ) -> Bool {
    if
      let engineError =
        error as?
          NativeSegmentationEngineError
    {
      switch engineError {
      case .cancelled:
        return true

      default:
        return false
      }
    }

    if
      let sessionError =
        error as?
          NativeONNXSessionError
    {
      switch sessionError {
      case .cancelled:
        return true

      default:
        return false
      }
    }

    if
      let coordinatorError =
        error as?
          NativeScanCoordinatorError
    {
      switch coordinatorError {
      case .cancelled:
        return true

      default:
        return false
      }
    }

    return false
  }
  /* =======================================================
   * Prepared prompt contract
   * ===================================================== */

  private struct PreparedDecoderPrompt:
    Sendable {

    let pointCoordinates:
      ContiguousArray<Float>

    let pointCoordinateShape:
      [NSNumber]

    let pointLabels:
      ContiguousArray<Float>

    let pointLabelShape:
      [NSNumber]

    let transformedPoints:
      [NativeSegmentationPromptPoint]

    let originalImageSize:
      ContiguousArray<Float>

    let originalImageSizeShape:
      [NSNumber]

    let requestMultipleMasks:
      Bool

    let previousMask:
      ContiguousArray<Float>?

    let previousMaskShape:
      [NSNumber]?
  }

  /* =======================================================
   * Complete encoder and decoder pipeline
   * ===================================================== */

  private func executeEncoderAndDecoderPipeline(
    request:
      NativeSegmentationEngineRequest,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    stateQueue.sync {
      guard
        activeJobId ==
          request.jobId,
        !disposed
      else {
        return
      }

      state =
        .encoding
    }

    let encoderResult =
      try await onnxSession
        .runEncoder(
          tensor:
            request.encoderTensor,

          shape:
            request.encoderTensorShape,

          cancellationToken:
            cancellationToken
        )

    try cancellationToken
      .throwIfCancelled()

    guard
      let imageEmbedding =
        encoderResult
          .primaryOutput
    else {
      throw NativeSegmentationEngineError
        .encoderOutputUnavailable
    }

    stateQueue.sync {
      guard
        activeJobId ==
          request.jobId,
        !disposed
      else {
        return
      }

      state =
        .preparingDecoder
    }

    let decoderInterface:
      NativeONNXModelSessionInfo

    do {
      decoderInterface =
        try onnxSession
          .modelInterface(
            kind:
              .decoder
          )
    } catch {
      throw NativeSegmentationEngineError
        .decoderInterfaceUnavailable
    }

    guard
      !decoderInterface
        .inputNames
        .isEmpty,
      !decoderInterface
        .outputNames
        .isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderInterfaceUnavailable
    }

    let decoderInputNames =
      try resolveDecoderInputNames(
        declaredInputNames:
          decoderInterface
            .inputNames
      )

    try cancellationToken
      .throwIfCancelled()

    let preparedPrompt =
      try prepareDecoderPrompt(
        prompt:
          request.prompt,

        letterbox:
          request.letterbox,

        cancellationToken:
          cancellationToken
      )

    try cancellationToken
      .throwIfCancelled()

    /*
     * Part 4 ينشئ ORTValue لكل Decoder Input
     * ثم يشغل الـDecoder ويرجع النتيجة النهائية.
     */
    return try await createDecoderInputsAndExecute(
      request:
        request,

      imageEmbedding:
        imageEmbedding,

      decoderInputNames:
        decoderInputNames,

      decoderOutputNames:
        decoderInterface
          .outputNames,

      preparedPrompt:
        preparedPrompt,

      encoderResult:
        encoderResult,

      cancellationToken:
        cancellationToken,

      inferenceStartedAt:
        inferenceStartedAt
    )
  }

  /* =======================================================
   * Decoder input-name resolution
   * ===================================================== */

  private func resolveDecoderInputNames(
    declaredInputNames:
      [String]
  ) throws ->
      NativeSegmentationDecoderInputNames {
    guard
      !declaredInputNames
        .isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderInterfaceUnavailable
    }

    let imageEmbeddings =
      try resolveRequiredDecoderInputName(
        semanticName:
          "image embeddings",

        declaredInputNames:
          declaredInputNames,

        exactAliases: [
          "image_embeddings",
          "image_embedding",
          "embeddings",
          "embedding",
          "image_features",
          "features"
        ],

        containedAliases: [
          "image_embedding",
          "image_embed",
          "embedding",
          "feature"
        ]
      )

    let pointCoordinates =
      try resolveRequiredDecoderInputName(
        semanticName:
          "point coordinates",

        declaredInputNames:
          declaredInputNames,

        exactAliases: [
          "point_coords",
          "point_coordinates",
          "point_coordinates_input",
          "coords",
          "coordinates"
        ],

        containedAliases: [
          "point_coord",
          "point_position",
          "coordinate"
        ]
      )

    let pointLabels =
      try resolveRequiredDecoderInputName(
        semanticName:
          "point labels",

        declaredInputNames:
          declaredInputNames,

        exactAliases: [
          "point_labels",
          "point_label",
          "labels"
        ],

        containedAliases: [
          "point_label"
        ]
      )

    let maskInput =
      try resolveOptionalDecoderInputName(
        semanticName:
          "mask input",

        declaredInputNames:
          declaredInputNames,

        exactAliases: [
          "mask_input",
          "mask_inputs",
          "previous_mask",
          "input_mask"
        ],

        containedAliases: [
          "mask_input",
          "previous_mask"
        ]
      )

    let hasMaskInput =
      try resolveOptionalDecoderInputName(
        semanticName:
          "has mask input",

        declaredInputNames:
          declaredInputNames,

        exactAliases: [
          "has_mask_input",
          "has_mask",
          "mask_input_present"
        ],

        containedAliases: [
          "has_mask",
          "mask_present"
        ]
      )

    let originalImageSize =
      try resolveOptionalDecoderInputName(
        semanticName:
          "original image size",

        declaredInputNames:
          declaredInputNames,

        exactAliases: [
          "orig_im_size",
          "original_image_size",
          "original_size",
          "image_size",
          "orig_size"
        ],

        containedAliases: [
          "orig_im_size",
          "original_image",
          "original_size",
          "image_size"
        ]
      )

    let multimaskOutput =
      try resolveOptionalDecoderInputName(
        semanticName:
          "multimask output",

        declaredInputNames:
          declaredInputNames,

        exactAliases: [
          "multimask_output",
          "multi_mask_output",
          "return_multiple_masks"
        ],

        containedAliases: [
          "multimask",
          "multi_mask",
          "multiple_mask"
        ]
      )

    let resolvedNames =
      Set(
        [
          imageEmbeddings,
          pointCoordinates,
          pointLabels,
          maskInput,
          hasMaskInput,
          originalImageSize,
          multimaskOutput
        ]
        .compactMap {
          $0
        }
      )

    let unsupportedInputNames =
      declaredInputNames
        .filter {
          !resolvedNames
            .contains(
              $0
            )
        }

    if
      !unsupportedInputNames
        .isEmpty,
      !configuration
        .allowUnknownOptionalDecoderInputs
    {
      throw NativeSegmentationEngineError
        .unsupportedRequiredDecoderInput(
          inputName:
            unsupportedInputNames
              .joined(
                separator:
                  ", "
              )
        )
    }

    return NativeSegmentationDecoderInputNames(
      imageEmbeddings:
        imageEmbeddings,

      pointCoordinates:
        pointCoordinates,

      pointLabels:
        pointLabels,

      maskInput:
        maskInput,

      hasMaskInput:
        hasMaskInput,

      originalImageSize:
        originalImageSize,

      multimaskOutput:
        multimaskOutput,

      declaredInputNames:
        declaredInputNames
    )
  }

  /* =======================================================
   * Required input-name resolution
   * ===================================================== */

  private func resolveRequiredDecoderInputName(
    semanticName:
      String,

    declaredInputNames:
      [String],

    exactAliases:
      [String],

    containedAliases:
      [String]
  ) throws ->
      String {
    if
      let exactMatch =
        resolveExactInputName(
          declaredInputNames:
            declaredInputNames,

          aliases:
            exactAliases
        )
    {
      return exactMatch
    }

    let containedMatches =
      resolveContainedInputNames(
        declaredInputNames:
          declaredInputNames,

        aliases:
          containedAliases
      )

    if
      containedMatches.count ==
        1,
      let match =
        containedMatches.first
    {
      return match
    }

    if
      containedMatches.count >
        1
    {
      throw NativeSegmentationEngineError
        .ambiguousDecoderInputName(
          semanticName:
            semanticName,

          matchingInputNames:
            containedMatches
        )
    }

    throw NativeSegmentationEngineError
      .decoderInputNameNotFound(
        semanticName:
          semanticName,

        declaredInputNames:
          declaredInputNames
      )
  }

  /* =======================================================
   * Optional input-name resolution
   * ===================================================== */

  private func resolveOptionalDecoderInputName(
    semanticName:
      String,

    declaredInputNames:
      [String],

    exactAliases:
      [String],

    containedAliases:
      [String]
  ) throws ->
      String? {
    if
      let exactMatch =
        resolveExactInputName(
          declaredInputNames:
            declaredInputNames,

          aliases:
            exactAliases
        )
    {
      return exactMatch
    }

    let containedMatches =
      resolveContainedInputNames(
        declaredInputNames:
          declaredInputNames,

        aliases:
          containedAliases
      )

    if
      containedMatches.count ==
        1
    {
      return containedMatches
        .first
    }

    if
      containedMatches.count >
        1
    {
      throw NativeSegmentationEngineError
        .ambiguousDecoderInputName(
          semanticName:
            semanticName,

          matchingInputNames:
            containedMatches
        )
    }

    return nil
  }

  /* =======================================================
   * Exact input-name matching
   * ===================================================== */

  private func resolveExactInputName(
    declaredInputNames:
      [String],

    aliases:
      [String]
  ) -> String? {
    for alias in
      aliases
    {
      if
        let match =
          declaredInputNames
            .first(
              where: {
                normalizeModelInputName(
                  $0
                ) ==
                normalizeModelInputName(
                  alias
                )
              }
            )
      {
        return match
      }
    }

    return nil
  }

  /* =======================================================
   * Contained input-name matching
   * ===================================================== */

  private func resolveContainedInputNames(
    declaredInputNames:
      [String],

    aliases:
      [String]
  ) -> [String] {
    var matches:
      [String] =
        []

    for inputName in
      declaredInputNames
    {
      let normalizedInputName =
        normalizeModelInputName(
          inputName
        )

      let matchesAlias =
        aliases
          .contains {
            alias in

            let normalizedAlias =
              normalizeModelInputName(
                alias
              )

            return normalizedInputName
              .contains(
                normalizedAlias
              )
          }

      if
        matchesAlias,
        !matches
          .contains(
            inputName
          )
      {
        matches.append(
          inputName
        )
      }
    }

    return matches
  }

  /* =======================================================
   * Model input-name normalization
   * ===================================================== */

  private func normalizeModelInputName(
    _ value:
      String
  ) -> String {
    return value
      .trimmingCharacters(
        in:
          .whitespacesAndNewlines
      )
      .lowercased()
      .replacingOccurrences(
        of:
          "-",
        with:
          "_"
      )
      .replacingOccurrences(
        of:
          ".",
        with:
          "_"
      )
      .replacingOccurrences(
        of:
          "/",
        with:
          "_"
      )
      .replacingOccurrences(
        of:
          ":",
        with:
          "_"
      )
  }

  /* =======================================================
   * Prompt preparation
   * ===================================================== */

  private func prepareDecoderPrompt(
    prompt:
      NativeSegmentationPromptSet,

    letterbox:
      NativeSegmentationLetterboxInfo,

    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      PreparedDecoderPrompt {
    try cancellationToken
      .throwIfCancelled()

    let pointCount =
      prompt
        .points
        .count

    guard
      pointCount >
        0
    else {
      throw NativeSegmentationEngineError
        .promptSetIsEmpty
    }

    guard
      pointCount <=
        configuration
          .maximumPromptPointCount
    else {
      throw NativeSegmentationEngineError
        .tooManyPromptPoints(
          count:
            pointCount,

          maximum:
            configuration
              .maximumPromptPointCount
        )
    }

    var pointCoordinates =
      ContiguousArray<Float>()

    pointCoordinates
      .reserveCapacity(
        pointCount *
        2
      )

    var pointLabels =
      ContiguousArray<Float>()

    pointLabels
      .reserveCapacity(
        pointCount
      )

    var transformedPoints:
      [NativeSegmentationPromptPoint] =
        []

    transformedPoints
      .reserveCapacity(
        pointCount
      )

    let scale =
      Float(
        letterbox.scale
      )

    let paddingLeft =
      Float(
        letterbox
          .paddingLeft
      )

    let paddingTop =
      Float(
        letterbox
          .paddingTop
      )

    for (
      index,
      point
    ) in prompt
      .points
      .enumerated()
    {
      if
        index %
          16 ==
          0
      {
        try cancellationToken
          .throwIfCancelled()
      }

      let validatedPoint =
        try point
          .validated(
            imageWidth:
              letterbox
                .sourceWidth,

            imageHeight:
              letterbox
                .sourceHeight
          )

      let transformedX =
        (
          validatedPoint.x *
          scale
        ) +
        paddingLeft

      let transformedY =
        (
          validatedPoint.y *
          scale
        ) +
        paddingTop

      guard
        transformedX.isFinite,
        transformedY.isFinite
      else {
        throw NativeSegmentationEngineError
          .invalidPromptPoint(
            x:
              transformedX,

            y:
              transformedY,

            label:
              validatedPoint
                .label
          )
      }

      let clampedX =
        min(
          Float(
            letterbox
              .modelWidth
          ),
          max(
            0,
            transformedX
          )
        )

      let clampedY =
        min(
          Float(
            letterbox
              .modelHeight
          ),
          max(
            0,
            transformedY
          )
        )

      pointCoordinates.append(
        clampedX
      )

      pointCoordinates.append(
        clampedY
      )

      pointLabels.append(
        validatedPoint
          .label
      )

      transformedPoints.append(
        NativeSegmentationPromptPoint(
          x:
            clampedX,

          y:
            clampedY,

          label:
            validatedPoint
              .label
        )
      )
    }

    let coordinateShape:
      [NSNumber] = [
        1,
        NSNumber(
          value:
            pointCount
        ),
        2
      ]

    let labelShape:
      [NSNumber] = [
        1,
        NSNumber(
          value:
            pointCount
        )
      ]

    /*
     * SAM decoder يستخدم الترتيب:
     *
     * [originalHeight, originalWidth]
     */
    let originalImageSize =
      ContiguousArray<Float>(
        [
          Float(
            letterbox
              .sourceHeight
          ),
          Float(
            letterbox
              .sourceWidth
          )
        ]
      )

    let originalImageSizeShape:
      [NSNumber] = [
        2
      ]

    if
      let previousMask =
        prompt
          .previousMask
    {
      guard
        let previousMaskShape =
          prompt
            .previousMaskShape
      else {
        throw NativeSegmentationEngineError
          .previousMaskShapeMissing
      }

      let expectedElementCount =
        try calculateTensorElementCount(
          shape:
            previousMaskShape
        )

      guard
        expectedElementCount ==
          previousMask.count
      else {
        throw NativeSegmentationEngineError
          .previousMaskElementCountMismatch(
            expected:
              expectedElementCount,

            received:
              previousMask.count
          )
      }
    }

    try cancellationToken
      .throwIfCancelled()

    return PreparedDecoderPrompt(
      pointCoordinates:
        pointCoordinates,

      pointCoordinateShape:
        coordinateShape,

      pointLabels:
        pointLabels,

      pointLabelShape:
        labelShape,

      transformedPoints:
        transformedPoints,

      originalImageSize:
        originalImageSize,

      originalImageSizeShape:
        originalImageSizeShape,

      requestMultipleMasks:
        prompt
          .requestMultipleMasks,

      previousMask:
        prompt
          .previousMask,

      previousMaskShape:
        prompt
          .previousMaskShape
    )
  }

  /* =======================================================
   * Generic tensor element count
   * ===================================================== */

  private func calculateTensorElementCount(
    shape:
      [NSNumber]
  ) throws ->
      Int {
    guard
      !shape.isEmpty
    else {
      throw NativeSegmentationEngineError
        .invalidPreviousMaskShape(
          shape:
            []
        )
    }

    var elementCount =
      1

    for dimension in
      shape
    {
      let value =
        dimension
          .intValue

      guard
        value >
          0
      else {
        throw NativeSegmentationEngineError
          .invalidPreviousMaskShape(
            shape:
              shape.map {
                $0.intValue
              }
          )
      }

      let multiplication =
        elementCount
          .multipliedReportingOverflow(
            by:
              value
          )

      guard
        !multiplication
          .overflow,
        multiplication
          .partialValue >
          0
      else {
        throw NativeSegmentationEngineError
          .invalidPreviousMaskShape(
            shape:
              shape.map {
                $0.intValue
              }
          )
      }

      elementCount =
        multiplication
          .partialValue
    }

    return elementCount
  }

  /* =======================================================
   * Part 4 entry
   * ===================================================== */

  private func createDecoderInputsAndExecute(
    request:
      NativeSegmentationEngineRequest,

    imageEmbedding:
      NativeONNXTensorOutput,

    decoderInputNames:
      NativeSegmentationDecoderInputNames,

    decoderOutputNames:
      [String],

    preparedPrompt:
      PreparedDecoderPrompt,

    encoderResult:
      NativeONNXEncoderResult,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    /*
     * Part 4/5 سيكمل التنفيذ من هنا:
     *
     * - إنشاء point_coords.
     * - إنشاء point_labels.
     * - إنشاء mask_input.
     * - إنشاء has_mask_input.
     * - إنشاء original_image_size.
     * - إنشاء multimask_output.
     * - تشغيل Decoder.
     */
    return try await buildDecoderTensorsAndRun(
      request:
        request,

      imageEmbedding:
        imageEmbedding,

      decoderInputNames:
        decoderInputNames,

      decoderOutputNames:
        decoderOutputNames,

      preparedPrompt:
        preparedPrompt,

      encoderResult:
        encoderResult,

      cancellationToken:
        cancellationToken,

      inferenceStartedAt:
        inferenceStartedAt
    )
  }
  /* =======================================================
   * Decoder tensor storage
   * ===================================================== */

#if canImport(onnxruntime_objc)

  /*
   * نحتفظ بالـNSMutableData حية حتى ينتهي تشغيل Decoder.
   *
   * بعض إصدارات ONNX Runtime تستخدم الذاكرة التي تم
   * تمريرها إلى ORTValue مباشرة أثناء Inference.
   */
  private struct PreparedDecoderInputs {
    let values:
      [String: ORTValue]

    let retainedTensorData:
      [NSMutableData]
  }

#endif

  /* =======================================================
   * Build decoder tensors and continue
   * ===================================================== */

  private func buildDecoderTensorsAndRun(
    request:
      NativeSegmentationEngineRequest,

    imageEmbedding:
      NativeONNXTensorOutput,

    decoderInputNames:
      NativeSegmentationDecoderInputNames,

    decoderOutputNames:
      [String],

    preparedPrompt:
      PreparedDecoderPrompt,

    encoderResult:
      NativeONNXEncoderResult,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    stateQueue.sync {
      guard
        activeJobId ==
          request.jobId,
        !disposed
      else {
        return
      }

      state =
        .preparingDecoder
    }

#if canImport(onnxruntime_objc)

    let preparedInputs =
      try createDecoderORTInputs(
        imageEmbedding:
          imageEmbedding,

        decoderInputNames:
          decoderInputNames,

        preparedPrompt:
          preparedPrompt,

        cancellationToken:
          cancellationToken
      )

    try cancellationToken
      .throwIfCancelled()

    /*
     * Part 4B سيشغل Decoder باستخدام القيم الجاهزة،
     * مع الاحتفاظ بالـTensor Data حتى نهاية Inference.
     */
    return try await executeDecoderWithPreparedInputs(
      request:
        request,

      decoderInputs:
        preparedInputs.values,

      retainedTensorData:
        preparedInputs
          .retainedTensorData,

      decoderInputNames:
        decoderInputNames,

      decoderOutputNames:
        decoderOutputNames,

      preparedPrompt:
        preparedPrompt,

      encoderResult:
        encoderResult,

      cancellationToken:
        cancellationToken,

      inferenceStartedAt:
        inferenceStartedAt
    )

#else

    _ =
      imageEmbedding

    _ =
      decoderInputNames

    _ =
      decoderOutputNames

    _ =
      preparedPrompt

    _ =
      encoderResult

    _ =
      inferenceStartedAt

    throw NativeSegmentationEngineError
      .decoderExecutionUnavailable

#endif
  }

#if canImport(onnxruntime_objc)

  /* =======================================================
   * Create all decoder ORT inputs
   * ===================================================== */

  private func createDecoderORTInputs(
    imageEmbedding:
      NativeONNXTensorOutput,

    decoderInputNames:
      NativeSegmentationDecoderInputNames,

    preparedPrompt:
      PreparedDecoderPrompt,

    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      PreparedDecoderInputs {
    try cancellationToken
      .throwIfCancelled()

    var values:
      [String: ORTValue] =
        [:]

    values.reserveCapacity(
      decoderInputNames
        .declaredInputNames
        .count
    )

    var retainedTensorData:
      [NSMutableData] =
        []

    retainedTensorData.reserveCapacity(
      decoderInputNames
        .declaredInputNames
        .count
    )

    /*
     * Image Embedding ينتقل مباشرة من Encoder إلى Decoder.
     *
     * لا نحوله إلى Swift Array ولا ننشئ نسخة كبيرة إضافية.
     */
    values[
      decoderInputNames
        .imageEmbeddings
    ] =
      imageEmbedding.value

    try cancellationToken
      .throwIfCancelled()

    /*
     * Point coordinates:
     *
     * [1, N, 2]
     */
    let coordinatesTensor =
      try createFloatORTValue(
        values:
          preparedPrompt
            .pointCoordinates,

        shape:
          preparedPrompt
            .pointCoordinateShape,

        inputName:
          decoderInputNames
            .pointCoordinates
      )

    values[
      decoderInputNames
        .pointCoordinates
    ] =
      coordinatesTensor.value

    retainedTensorData.append(
      coordinatesTensor.data
    )

    try cancellationToken
      .throwIfCancelled()

    /*
     * Point labels:
     *
     * [1, N]
     */
    let labelsTensor =
      try createFloatORTValue(
        values:
          preparedPrompt
            .pointLabels,

        shape:
          preparedPrompt
            .pointLabelShape,

        inputName:
          decoderInputNames
            .pointLabels
      )

    values[
      decoderInputNames
        .pointLabels
    ] =
      labelsTensor.value

    retainedTensorData.append(
      labelsTensor.data
    )

    try cancellationToken
      .throwIfCancelled()

    /*
     * Optional mask input:
     *
     * عندما لا توجد Previous Mask ننشئ Tensor أصفار
     * بالشكل الافتراضي:
     *
     * [1, 1, 256, 256]
     */
    if
      let maskInputName =
        decoderInputNames
          .maskInput
    {
      let maskValues:
        ContiguousArray<Float>

      let maskShape:
        [NSNumber]

      if
        let previousMask =
          preparedPrompt
            .previousMask,
        let previousMaskShape =
          preparedPrompt
            .previousMaskShape
      {
        maskValues =
          previousMask

        maskShape =
          previousMaskShape
      } else {
        let maskWidth =
          configuration
            .defaultMaskInputWidth

        let maskHeight =
          configuration
            .defaultMaskInputHeight

        guard
          maskWidth >
            0,
          maskHeight >
            0
        else {
          throw NativeSegmentationEngineError
            .decoderTensorCreationFailed(
              inputName:
                maskInputName,

              message:
                "The default mask-input dimensions are invalid."
            )
        }

        let maskPixelCountResult =
          maskWidth
            .multipliedReportingOverflow(
              by:
                maskHeight
            )

        guard
          !maskPixelCountResult
            .overflow,
          maskPixelCountResult
            .partialValue >
            0
        else {
          throw NativeSegmentationEngineError
            .decoderTensorCreationFailed(
              inputName:
                maskInputName,

              message:
                "The default mask-input element count overflowed."
            )
        }

        maskValues =
          ContiguousArray<Float>(
            repeating:
              0,

            count:
              maskPixelCountResult
                .partialValue
          )

        maskShape = [
          1,
          1,
          NSNumber(
            value:
              maskHeight
          ),
          NSNumber(
            value:
              maskWidth
          )
        ]
      }

      let maskTensor =
        try createFloatORTValue(
          values:
            maskValues,

          shape:
            maskShape,

          inputName:
            maskInputName
        )

      values[
        maskInputName
      ] =
        maskTensor.value

      retainedTensorData.append(
        maskTensor.data
      )
    }

    try cancellationToken
      .throwIfCancelled()

    /*
     * has_mask_input:
     *
     * 1 عند وجود Previous Mask.
     * 0 عند استخدام Tensor الأصفار الافتراضي.
     *
     * الشكل المعتاد:
     *
     * [1]
     */
    if
      let hasMaskInputName =
        decoderInputNames
          .hasMaskInput
    {
      let hasMaskValue:
        Float =
          preparedPrompt
            .previousMask ==
          nil
            ? 0
            : 1

      let hasMaskTensor =
        try createFloatORTValue(
          values:
            ContiguousArray<Float>(
              [
                hasMaskValue
              ]
            ),

          shape: [
            1
          ],

          inputName:
            hasMaskInputName
        )

      values[
        hasMaskInputName
      ] =
        hasMaskTensor.value

      retainedTensorData.append(
        hasMaskTensor.data
      )
    }

    try cancellationToken
      .throwIfCancelled()

    /*
     * Original image size:
     *
     * [height, width]
     *
     * الشكل:
     *
     * [2]
     */
    if
      let originalImageSizeName =
        decoderInputNames
          .originalImageSize
    {
      let imageSizeTensor =
        try createFloatORTValue(
          values:
            preparedPrompt
              .originalImageSize,

          shape:
            preparedPrompt
              .originalImageSizeShape,

          inputName:
            originalImageSizeName
        )

      values[
        originalImageSizeName
      ] =
        imageSizeTensor.value

      retainedTensorData.append(
        imageSizeTensor.data
      )
    }

    try cancellationToken
      .throwIfCancelled()

    /*
     * multimask_output:
     *
     * Bool tensor بالشكل [1].
     */
    if
      let multimaskOutputName =
        decoderInputNames
          .multimaskOutput
    {
      let multimaskTensor =
        try createBooleanORTValue(
          value:
            preparedPrompt
              .requestMultipleMasks,

          shape: [
            1
          ],

          inputName:
            multimaskOutputName
        )

      values[
        multimaskOutputName
      ] =
        multimaskTensor.value

      retainedTensorData.append(
        multimaskTensor.data
      )
    }

    try cancellationToken
      .throwIfCancelled()

    /*
     * نتحقق أن كل Input أعلنها Decoder حصلت على قيمة.
     *
     * resolveDecoderInputNames رفض بالفعل أي Input غير
     * معروفة عندما allowUnknownOptionalDecoderInputs=false.
     */
    let missingInputNames =
      decoderInputNames
        .declaredInputNames
        .filter {
          values[
            $0
          ] ==
            nil
        }

    guard
      missingInputNames
        .isEmpty
    else {
      throw NativeSegmentationEngineError
        .unsupportedRequiredDecoderInput(
          inputName:
            missingInputNames
              .joined(
                separator:
                  ", "
              )
        )
    }

    return PreparedDecoderInputs(
      values:
        values,

      retainedTensorData:
        retainedTensorData
    )
  }

  /* =======================================================
   * Float ORT tensor result
   * ===================================================== */

  private struct CreatedFloatORTValue {
    let value:
      ORTValue

    let data:
      NSMutableData
  }

  /* =======================================================
   * Boolean ORT tensor result
   * ===================================================== */

  private struct CreatedBooleanORTValue {
    let value:
      ORTValue

    let data:
      NSMutableData
  }

  /* =======================================================
   * Create Float32 ORTValue
   * ===================================================== */

  private func createFloatORTValue(
    values:
      ContiguousArray<Float>,

    shape:
      [NSNumber],

    inputName:
      String
  ) throws ->
      CreatedFloatORTValue {
    guard
      !values.isEmpty,
      !shape.isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            inputName,

          message:
            "The Float32 tensor data or shape is empty."
        )
    }

    let expectedElementCount =
      try calculateDecoderTensorElementCount(
        shape:
          shape,

        inputName:
          inputName
      )

    guard
      expectedElementCount ==
        values.count
    else {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            inputName,

          message:
            """
            Tensor element count mismatch. Expected \(expectedElementCount), received \(values.count).
            """
        )
    }

    let byteCountResult =
      values.count
        .multipliedReportingOverflow(
          by:
            MemoryLayout<Float>
              .stride
        )

    guard
      !byteCountResult
        .overflow,
      byteCountResult
        .partialValue >
        0
    else {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            inputName,

          message:
            "The Float32 tensor byte count overflowed."
        )
    }

    let tensorData:
      NSMutableData =
        try values
          .withUnsafeBufferPointer {
            buffer in

            guard
              let baseAddress =
                buffer
                  .baseAddress
            else {
              throw NativeSegmentationEngineError
                .decoderTensorCreationFailed(
                  inputName:
                    inputName,

                  message:
                    "The Float32 tensor buffer is unavailable."
                )
            }

            return NSMutableData(
              bytes:
                baseAddress,

              length:
                byteCountResult
                  .partialValue
            )
          }

    do {
      let tensorValue =
        try ORTValue(
          tensorData:
            tensorData,

          elementType:
            .float,

          shape:
            shape
        )

      return CreatedFloatORTValue(
        value:
          tensorValue,

        data:
          tensorData
      )
    } catch {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            inputName,

          message:
            error.localizedDescription
        )
    }
  }

  /* =======================================================
   * Create Bool ORTValue
   * ===================================================== */

  private func createBooleanORTValue(
    value:
      Bool,

    shape:
      [NSNumber],

    inputName:
      String
  ) throws ->
      CreatedBooleanORTValue {
    let expectedElementCount =
      try calculateDecoderTensorElementCount(
        shape:
          shape,

        inputName:
          inputName
      )

    guard
      expectedElementCount ==
        1
    else {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            inputName,

          message:
            "The Bool tensor currently supports a single value only."
        )
    }

    var rawValue:
      UInt8 =
        value
          ? 1
          : 0

    let tensorData =
      NSMutableData(
        bytes:
          &rawValue,

        length:
          MemoryLayout<UInt8>
            .stride
      )

    do {
      let tensorValue =
        try ORTValue(
          tensorData:
            tensorData,

          elementType:
            .bool,

          shape:
            shape
        )

      return CreatedBooleanORTValue(
        value:
          tensorValue,

        data:
          tensorData
      )
    } catch {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            inputName,

          message:
            error.localizedDescription
        )
    }
  }

  /* =======================================================
   * Decoder tensor element count
   * ===================================================== */

  private func calculateDecoderTensorElementCount(
    shape:
      [NSNumber],

    inputName:
      String
  ) throws ->
      Int {
    guard
      !shape.isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            inputName,

          message:
            "The tensor shape is empty."
        )
    }

    var elementCount =
      1

    for dimension in
      shape
    {
      let value =
        dimension
          .intValue

      guard
        value >
          0
      else {
        throw NativeSegmentationEngineError
          .decoderTensorCreationFailed(
            inputName:
              inputName,

            message:
              "The tensor shape contains a non-positive dimension."
          )
      }

      let multiplication =
        elementCount
          .multipliedReportingOverflow(
            by:
              value
          )

      guard
        !multiplication
          .overflow,
        multiplication
          .partialValue >
          0
      else {
        throw NativeSegmentationEngineError
          .decoderTensorCreationFailed(
            inputName:
              inputName,

            message:
              "The tensor element count overflowed."
          )
      }

      elementCount =
        multiplication
          .partialValue
    }

    return elementCount
  }

#endif
/* =======================================================
   * Execute Decoder with prepared inputs
   * ===================================================== */

#if canImport(onnxruntime_objc)

  private func executeDecoderWithPreparedInputs(
    request:
      NativeSegmentationEngineRequest,

    decoderInputs:
      [String: ORTValue],

    retainedTensorData:
      [NSMutableData],

    decoderInputNames:
      NativeSegmentationDecoderInputNames,

    decoderOutputNames:
      [String],

    preparedPrompt:
      PreparedDecoderPrompt,

    encoderResult:
      NativeONNXEncoderResult,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    guard
      !decoderInputs.isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            "decoder-inputs",

          message:
            "No decoder input tensors were created."
        )
    }

    guard
      !decoderOutputNames.isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    /*
     * نتأكد أن كل Input أعلنها Decoder موجودة
     * داخل القيم التي سيتم تمريرها إلى ONNX Runtime.
     */
    let suppliedInputNames =
      Set(
        decoderInputs.keys
      )

    let declaredInputNames =
      Set(
        decoderInputNames
          .declaredInputNames
      )

    let missingInputNames =
      declaredInputNames
        .subtracting(
          suppliedInputNames
        )
        .sorted()

    guard
      missingInputNames.isEmpty
    else {
      throw NativeSegmentationEngineError
        .unsupportedRequiredDecoderInput(
          inputName:
            missingInputNames
              .joined(
                separator:
                  ", "
              )
        )
    }

    let unexpectedInputNames =
      suppliedInputNames
        .subtracting(
          declaredInputNames
        )
        .sorted()

    guard
      unexpectedInputNames.isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderTensorCreationFailed(
          inputName:
            unexpectedInputNames
              .joined(
                separator:
                  ", "
              ),

          message:
            "Decoder inputs contain names that are not declared by the model."
        )
    }

    try cancellationToken
      .throwIfCancelled()

    stateQueue.sync {
      guard
        activeJobId ==
          request.jobId,
        !disposed
      else {
        return
      }

      state =
        .decoding
    }

    let requestedOutputNames =
      Set(
        decoderOutputNames
      )

    guard
      !requestedOutputNames.isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    let decoderResult:
      NativeONNXDecoderResult

    do {
      decoderResult =
        try await onnxSession
          .runDecoder(
            inputs:
              decoderInputs,

            requestedOutputNames:
              requestedOutputNames,

            cancellationToken:
              cancellationToken
          )
    } catch {
      /*
       * الاحتفاظ بالقيم المستخدمة حتى نهاية
       * runDecoder يتم عن طريق retainedTensorData.
       */
      _ =
        retainedTensorData

      if
        cancellationToken
          .isCancelled ||
        error is
          CancellationError ||
        isCancellationError(
          error
        )
      {
        throw NativeSegmentationEngineError
          .cancelled(
            reason:
              cancellationToken
                .reason ??
              error.localizedDescription
          )
      }

      if
        let engineError =
          error as?
            NativeSegmentationEngineError
      {
        throw engineError
      }

      if
        let sessionError =
          error as?
            NativeONNXSessionError
      {
        throw NativeSegmentationEngineError
          .segmentationFailed(
            message:
              sessionError
                .localizedDescription
          )
      }

      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            error.localizedDescription
        )
    }

    /*
     * تظل NSMutableData حية حتى انتهاء الـDecoder.
     *
     * هذا السطر يمنع تحريرها مبكرًا بواسطة المحسن.
     */
    _ =
      retainedTensorData

    try cancellationToken
      .throwIfCancelled()

    guard
      !decoderResult
        .outputs
        .isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    guard
      let primaryMaskOutput =
        decoderResult
          .primaryMaskOutput
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    guard
      primaryMaskOutput
        .elementCount >
        0
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    guard
      !primaryMaskOutput
        .shape
        .isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    /*
     * Part 4C سيقوم بفحص شكل Mask وScore Outputs،
     * ثم اختيار معلومات النتيجة النهائية.
     */
    return try finalizeDecoderExecution(
      request:
        request,

      decoderInputNames:
        decoderInputNames,

      preparedPrompt:
        preparedPrompt,

      encoderResult:
        encoderResult,

      decoderResult:
        decoderResult,

      primaryMaskOutput:
        primaryMaskOutput,

      cancellationToken:
        cancellationToken,

      inferenceStartedAt:
        inferenceStartedAt
    )
  }

#endif

  /* =======================================================
   * Part 4C entry
   * ===================================================== */

  private func finalizeDecoderExecution(
    request:
      NativeSegmentationEngineRequest,

    decoderInputNames:
      NativeSegmentationDecoderInputNames,

    preparedPrompt:
      PreparedDecoderPrompt,

    encoderResult:
      NativeONNXEncoderResult,

    decoderResult:
      NativeONNXDecoderResult,

    primaryMaskOutput:
      NativeONNXTensorOutput,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    /*
     * التنفيذ الكامل موجود في Part 4C:
     *
     * - فحص Mask tensor.
     * - فحص Score tensor.
     * - التحقق من توقيت Encoder وDecoder.
     * - بناء NativeSegmentationEngineTiming.
     * - إنشاء NativeSegmentationEngineResult.
     */
    return try validateDecoderOutputsAndCreateResult(
      request:
        request,

      decoderInputNames:
        decoderInputNames,

      preparedPrompt:
        preparedPrompt,

      encoderResult:
        encoderResult,

      decoderResult:
        decoderResult,

      primaryMaskOutput:
        primaryMaskOutput,

      cancellationToken:
        cancellationToken,

      inferenceStartedAt:
        inferenceStartedAt
    )
  }
  /* =======================================================
   * Validate decoder outputs and create result
   * ===================================================== */

  private func validateDecoderOutputsAndCreateResult(
    request:
      NativeSegmentationEngineRequest,

    decoderInputNames:
      NativeSegmentationDecoderInputNames,

    preparedPrompt:
      PreparedDecoderPrompt,

    encoderResult:
      NativeONNXEncoderResult,

    decoderResult:
      NativeONNXDecoderResult,

    primaryMaskOutput:
      NativeONNXTensorOutput,

    cancellationToken:
      NativeScanCancellationToken,

    inferenceStartedAt:
      NativeProcessingTimestamp
  ) throws ->
      NativeSegmentationEngineResult {
    try cancellationToken
      .throwIfCancelled()

    let maskShape =
      primaryMaskOutput
        .shape
        .map {
          $0.intValue
        }

    try validatePrimaryMaskOutput(
      output:
        primaryMaskOutput,

      shape:
        maskShape
    )

    try cancellationToken
      .throwIfCancelled()

    if
      let scoreOutput =
        decoderResult
          .scoreOutput
    {
      try validateScoreOutput(
        scoreOutput
      )
    }

    try cancellationToken
      .throwIfCancelled()

    let encoderStartedAt =
      encoderResult
        .startedAt

    let encoderCompletedAt =
      encoderResult
        .completedAt

    let decoderStartedAt =
      decoderResult
        .startedAt

    let decoderCompletedAt =
      decoderResult
        .completedAt

    let completedAt =
      max(
        NativeProcessingTime.now(),
        decoderCompletedAt
      )

    let normalizedInferenceStartedAt =
      min(
        inferenceStartedAt,
        Main(
        encoderStartedAt,
        decoderStartedAt
      )
    )

    let encoderDurationMs =
      normalizeDuration(
        declaredDuration:
          encoderResult
            .durationMs,

        startedAt:
          encoderStartedAt,

        completedAt:
          encoderCompletedAt
      )

    let decoderDurationMs =
      normalizeDuration(
        declaredDuration:
          decoderResult
            .durationMs,

        startedAt:
          decoderStartedAt,

        completedAt:
          decoderCompletedAt
      )

    let totalDurationMs =
      durationBetween(
        startedAt:
          normalizedInferenceStartedAt,

        completedAt:
          completedAt
      )

    let timing =
      NativeSegmentationEngineTiming(
        startedAt:
          normalizedInferenceStartedAt,

        encoderStartedAt:
          encoderStartedAt,

        encoderCompletedAt:
          encoderCompletedAt,

        decoderStartedAt:
          decoderStartedAt,

        decoderCompletedAt:
          decoderCompletedAt,

        completedAt:
          completedAt,

        encoderDurationMs:
          encoderDurationMs,

        decoderDurationMs:
          decoderDurationMs,

        totalDurationMs:
          totalDurationMs
      )

    try cancellationToken
      .throwIfCancelled()

    stateQueue.sync {
      guard
        activeJobId ==
          request.jobId,
        !disposed
      else {
        return
      }

      state =
        .completed

      lastError =
        nil
    }

    return NativeSegmentationEngineResult(
      jobId:
        request.jobId,

      encoderResult:
        encoderResult,

      decoderResult:
        decoderResult,

      decoderInputNames:
        decoderInputNames,

      letterbox:
        request.letterbox,

      promptPointCount:
        preparedPrompt
          .transformedPoints
          .count,

      requestedMultipleMasks:
        preparedPrompt
          .requestMultipleMasks,

      timing:
        timing,

      metadata:
        request.metadata
    )
  }

  /* =======================================================
   * Primary mask validation
   * ===================================================== */

  private func validatePrimaryMaskOutput(
    output:
      NativeONNXTensorOutput,

    shape:
      [Int]
  ) throws {
    guard
      !shape.isEmpty
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    /*
     * EdgeSAM Decoder غالبًا يعيد:
     *
     * [1, maskCount, height, width]
     *
     * بعض نسخ التصدير قد تعيد:
     *
     * [maskCount, height, width]
     * [1, height, width]
     * [height, width]
     *
     * لذلك نقبل من بُعدين إلى أربعة أبعاد،
     * لكن نرفض أي Shape فارغة أو غير موجبة.
     */
    guard
      shape.count >=
        2,
      shape.count <=
        4
    else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            EdgeSAM mask output \(output.name) has an unsupported rank: \(shape).
            """
        )
    }

    var calculatedElementCount =
      1

    for dimension in
      shape
    {
      guard
        dimension >
          0
      else {
        throw NativeSegmentationEngineError
          .segmentationFailed(
            message:
              """
              EdgeSAM mask output \(output.name) contains a non-positive dimension: \(shape).
              """
          )
      }

      let multiplication =
        calculatedElementCount
          .multipliedReportingOverflow(
            by:
              dimension
          )

      guard
        !multiplication
          .overflow,
        multiplication
          .partialValue >
          0
      else {
        throw NativeSegmentationEngineError
          .segmentationFailed(
            message:
              """
              EdgeSAM mask output \(output.name) element count overflowed for shape \(shape).
              """
          )
      }

      calculatedElementCount =
        multiplication
          .partialValue
    }

    guard
      calculatedElementCount ==
        output.elementCount
    else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            EdgeSAM mask output \(output.name) has inconsistent storage. Shape \(shape) requires \(calculatedElementCount) values, but ONNX reported \(output.elementCount).
            """
        )
    }

    let spatialDimensions =
      resolveMaskSpatialDimensions(
        shape:
          shape
      )

    guard
      spatialDimensions.width >
        0,
      spatialDimensions.height >
        0
    else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            EdgeSAM mask output \(output.name) has invalid spatial dimensions: \(shape).
            """
        )
    }
  }

  /* =======================================================
   * Score validation
   * ===================================================== */

  private func validateScoreOutput(
    _ output:
      NativeONNXTensorOutput
  ) throws {
    let shape =
      output
        .shape
        .map {
          $0.intValue
        }

    guard
      !shape.isEmpty,
      output.elementCount >
        0
    else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            EdgeSAM score output \(output.name) is empty.
            """
        )
    }

    /*
     * Score output عادة:
     *
     * [1, maskCount]
     * [maskCount]
     *
     * لكن بعض exports قد تضيف Dimension حجمها 1.
     * لذلك نتحقق فقط من سلامة الأبعاد وعدد العناصر.
     */
    var calculatedElementCount =
      1

    for dimension in
      shape
    {
      guard
        dimension >
          0
      else {
        throw NativeSegmentationEngineError
          .segmentationFailed(
            message:
              """
              EdgeSAM score output \(output.name) contains a non-positive dimension: \(shape).
              """
          )
      }

      let multiplication =
        calculatedElementCount
          .multipliedReportingOverflow(
            by:
              dimension
          )

      guard
        !multiplication
          .overflow,
        multiplication
          .partialValue >
          0
      else {
        throw NativeSegmentationEngineError
          .segmentationFailed(
            message:
              """
              EdgeSAM score output \(output.name) element count overflowed for shape \(shape).
              """
          )
      }

      calculatedElementCount =
        multiplication
          .partialValue
    }

    guard
      calculatedElementCount ==
        output.elementCount
    else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            EdgeSAM score output \(output.name) has inconsistent storage. Shape \(shape) requires \(calculatedElementCount) values, but ONNX reported \(output.elementCount).
            """
        )
    }
  }

  /* =======================================================
   * Mask spatial dimensions
   * ===================================================== */

  private func resolveMaskSpatialDimensions(
    shape:
      [Int]
  ) -> (
    width:
      Int,
    height:
      Int
  ) {
    guard
      shape.count >=
        2
    else {
      return (
        width:
          0,

        height:
          0
      )
    }

    let width =
      shape[
        shape.count -
        1
      ]

    let height =
      shape[
        shape.count -
        2
      ]

    return (
      width:
        width,

      height:
        height
    )
  }

  /* =======================================================
   * Duration normalization
   * ===================================================== */

  private func normalizeDuration(
    declaredDuration:
      Int64,

    startedAt:
      NativeProcessingTimestamp,

    completedAt:
      NativeProcessingTimestamp
  ) -> Int64 {
    if
      declaredDuration >=
        0
    {
      return declaredDuration
    }

    return durationBetween(
      startedAt:
        startedAt,

      completedAt:
        completedAt
    )
  }

  private func durationBetween(
    startedAt:
      NativeProcessingTimestamp,

    completedAt:
      NativeProcessingTimestamp
  ) -> Int64 {
    guard
      completedAt >
        startedAt
    else {
      return 0
    }

    let difference =
      completedAt -
      startedAt

    if
      difference >
        NativeProcessingTimestamp(
          Int64.max
        )
    {
      return Int64.max
    }

    return Int64(
      difference
    )
  }

  /* =======================================================
   * Result inspection helpers
   * ===================================================== */

  func primaryMaskShape(
    from result:
      NativeSegmentationEngineResult
  ) throws ->
      [Int] {
    guard
      let output =
        result
          .primaryMaskOutput
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    let shape =
      output
        .shape
        .map {
          $0.intValue
        }

    try validatePrimaryMaskOutput(
      output:
        output,

      shape:
        shape
    )

    return shape
  }

  func primaryMaskDimensions(
    from result:
      NativeSegmentationEngineResult
  ) throws -> (
    width:
      Int,
    height:
      Int
  ) {
    let shape =
      try primaryMaskShape(
        from:
          result
      )

    let dimensions =
      resolveMaskSpatialDimensions(
        shape:
          shape
      )

    guard
      dimensions.width >
        0,
      dimensions.height >
        0
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    return dimensions
  }

  func decoderMaskCount(
    from result:
      NativeSegmentationEngineResult
  ) throws ->
      Int {
    let shape =
      try primaryMaskShape(
        from:
          result
      )

    switch shape.count {
    case 4:
      return shape[
        1
      ]

    case 3:
      /*
       * الشكل قد يكون:
       *
       * [maskCount, height, width]
       * أو [1, height, width]
       */
      return shape[
        0
      ]

    case 2:
      return 1

    default:
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }
  }
/* =======================================================
   * Public cancellation
   * ===================================================== */

  @discardableResult
  func cancel(
    jobId:
      String,
    reason:
      String =
        "Native segmentation was cancelled."
  ) -> Bool {
    let normalizedJobId =
      jobId
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard
      !normalizedJobId.isEmpty
    else {
      return false
    }

    let token:
      NativeScanCancellationToken? =
        stateQueue.sync {
          guard
            !disposed,
            activeJobId ==
              normalizedJobId
          else {
            return nil
          }

          state =
            .cancelling

          return activeCancellationToken
        }

    guard
      let token
    else {
      return false
    }

    token.cancel(
      reason:
        normalizeCancellationReason(
          reason
        )
    )

    return true
  }

  /* =======================================================
   * Cancel active inference
   * ===================================================== */

  @discardableResult
  func cancelActiveInference(
    reason:
      String =
        "Native segmentation was cancelled."
  ) -> Bool {
    let active:
      (
        jobId:
          String,
        token:
          NativeScanCancellationToken
      )? =
        stateQueue.sync {
          guard
            !disposed,
            let activeJobId,
            let activeCancellationToken
          else {
            return nil
          }

          state =
            .cancelling

          return (
            jobId:
              activeJobId,

            token:
              activeCancellationToken
          )
        }

    guard
      let active
    else {
      return false
    }

    active.token.cancel(
      reason:
        normalizeCancellationReason(
          reason
        )
    )

    return true
  }

  /* =======================================================
   * Request inspection
   * ===================================================== */

  func validate(
    request:
      NativeSegmentationEngineRequest
  ) throws ->
      NativeSegmentationEngineRequest {
    try stateQueue.sync {
      try assertNotDisposedLocked()
    }

    let validatedRequest =
      try request
        .validated()

    guard
      validatedRequest
        .prompt
        .points
        .count <=
      configuration
        .maximumPromptPointCount
    else {
      throw NativeSegmentationEngineError
        .tooManyPromptPoints(
          count:
            validatedRequest
              .prompt
              .points
              .count,

          maximum:
            configuration
              .maximumPromptPointCount
        )
    }

    return validatedRequest
  }

  /* =======================================================
   * Model interface
   * ===================================================== */

  func encoderModelInterface()
    throws ->
      NativeONNXModelSessionInfo {
    try stateQueue.sync {
      try assertNotDisposedLocked()

      guard
        initialized
      else {
        throw NativeSegmentationEngineError
          .notInitialized
      }
    }

    return try onnxSession
      .modelInterface(
        kind:
          .encoder
      )
  }

  func decoderModelInterface()
    throws ->
      NativeONNXModelSessionInfo {
    try stateQueue.sync {
      try assertNotDisposedLocked()

      guard
        initialized
      else {
        throw NativeSegmentationEngineError
          .notInitialized
      }
    }

    return try onnxSession
      .modelInterface(
        kind:
          .decoder
      )
  }

  /* =======================================================
   * Runtime readiness
   * ===================================================== */

  var isReady:
    Bool {
    let engineReady =
      stateQueue.sync {
        initialized &&
        !disposed &&
        activeJobId ==
          nil &&
        (
          state ==
            .ready ||
          state ==
            .completed ||
          state ==
            .failed
        )
      }

    return engineReady &&
      onnxSession.isEncoderReady &&
      onnxSession.isDecoderReady
  }

  var hasActiveInference:
    Bool {
    return stateQueue.sync {
      activeJobId !=
        nil
    }
  }

  /* =======================================================
   * Cancellation normalization
   * ===================================================== */

  private func normalizeCancellationReason(
    _ reason:
      String
  ) -> String {
    let normalizedReason =
      reason
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    return normalizedReason.isEmpty
      ? "Native segmentation was cancelled."
      : normalizedReason
  }

  /* =======================================================
   * Reset terminal state
   * ===================================================== */

  func resetTerminalState()
    throws {
    try stateQueue.sync {
      try assertNotDisposedLocked()

      guard
        activeJobId ==
          nil
      else {
        throw NativeSegmentationEngineError
          .anotherInferenceIsRunning(
            activeJobId:
              activeJobId ??
              "unknown",

            requestedJobId:
              "reset"
          )
      }

      if
        initialized
      {
        state =
          .ready
      } else {
        state =
          .uninitialized
      }

      lastError =
        nil
    }
  }

  /* =======================================================
   * Disposal
   * ===================================================== */

  func dispose() {
    let tokenToCancel:
      NativeScanCancellationToken? =
        stateQueue.sync {
          if
            disposed
          {
            return nil
          }

          /*
           * نوقف قبول أي عملية جديدة أولًا.
           */
          disposed =
            true

          initialized =
            false

          state =
            .disposed

          let token =
            activeCancellationToken

          activeCancellationToken =
            nil

          activeJobId =
            nil

          lastInferenceCompletedAt =
            NativeProcessingTime.now()

          lastError =
            nil

          return token
        }

    tokenToCancel?
      .cancel(
        reason:
          "Native segmentation engine was disposed."
      )

    /*
     * NativeONNXSession تنتظر أي Inference جارية
     * على inferenceQueue قبل تحرير Sessions.
     */
    onnxSession
      .dispose()
  }
}