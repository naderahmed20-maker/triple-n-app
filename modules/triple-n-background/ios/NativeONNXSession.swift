//
// NativeONNXSession.swift
//
// Triple N - Native ONNX Runtime Session Manager
//
// Part 1/4
//
// Ù‡Ø°Ø§ Ø§Ù„Ù…Ù„Ù Ù…Ø³Ø¤ÙˆÙ„ Ø¹Ù†:
//
// 1) Ø§ÙƒØªØ´Ø§Ù ONNX Runtime Ø¯Ø§Ø®Ù„ iOS Build.
// 2) Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ EdgeSAM Encoder ÙˆDecoder.
// 3) Ø¥Ù†Ø´Ø§Ø¡ ÙˆØ¥Ø¯Ø§Ø±Ø© ORT Environment ÙˆSessions.
// 4) ØªØ´ØºÙŠÙ„ Encoder ÙˆDecoder Ø¨Ø§Ù„ØªØªØ§Ø¨Ø¹.
// 5) Ù…Ù†Ø¹ Ø£ÙƒØ«Ø± Ù…Ù† Inference Ø«Ù‚ÙŠÙ„Ø© ÙÙŠ Ø§Ù„ÙˆÙ‚Øª Ù†ÙØ³Ù‡.
// 6) Ø§Ù„Ø§Ø­ØªÙØ§Ø¸ Ø¨Ø§Ù„Ù€Embedding ÙƒÙ€ORTValue Ø¨Ø¯ÙˆÙ† Ù†Ø³Ø®Ø© Ø¥Ø¶Ø§ÙÙŠØ©.
// 7) Ø¯Ø¹Ù… Cancellation.
// 8) ØªÙˆÙÙŠØ± Diagnostics.
// 9) ØªÙ†Ø¸ÙŠÙ Sessions ÙˆØ§Ù„Ø°Ø§ÙƒØ±Ø© Ø¹Ù†Ø¯ Dispose.
//
// ØªØ±ØªÙŠØ¨ Ø§Ù„Ø£Ø¬Ø²Ø§Ø¡:
//
// Part 1:
// - Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø¹Ù‚ÙˆØ¯.
// - Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø£Ø®Ø·Ø§Ø¡.
// - Ø¬Ù…ÙŠØ¹ Stored Properties.
// - Initialization ÙˆDiagnostics.
//
// Part 2:
// - Ø§ÙƒØªØ´Ø§Ù Ù…Ù„ÙØ§Øª Ø§Ù„Ù…ÙˆØ¯ÙŠÙ„Ø§Øª.
// - Ø¥Ù†Ø´Ø§Ø¡ Environment ÙˆSessions.
// - ÙØ­Øµ Ø£Ø³Ù…Ø§Ø¡ Inputs ÙˆOutputs.
//
// Part 3:
// - Ø¥Ù†Ø´Ø§Ø¡ Tensors.
// - ØªØ´ØºÙŠÙ„ Encoder.
// - Ù‚Ø±Ø§Ø¡Ø© Encoder Outputs.
//
// Part 4:
// - ØªØ´ØºÙŠÙ„ Decoder.
// - Ù‚Ø±Ø§Ø¡Ø© Decoder Outputs.
// - Disposal Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ.
//

import Foundation

#if canImport(onnxruntime_objc)
import onnxruntime_objc
#endif

/* =========================================================
 * Runtime availability
 * ======================================================= */

enum NativeONNXRuntimeAvailability:
  String,
  Codable,
  Equatable,
  Sendable {

  case available

  case unavailable

  case disposed
}

/* =========================================================
 * Model kind
 * ======================================================= */

enum NativeONNXModelKind:
  String,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case encoder

  case decoder

  var defaultFileNames:
    [String] {
    switch self {
    case .encoder:
      return [
        "edge_sam_3x_encoder.onnx",
        "edgesam_encoder.onnx",
        "edge_sam_encoder.onnx",
        "edgesam_encoder.onnx",
        "encoder.onnx",
        "edgesam_encoder.ort",
        "encoder.ort"
      ]

    case .decoder:
      return [
        "edge_sam_3x_decoder.onnx",
        "edgesam_decoder.onnx",
        "edge_sam_decoder.onnx",
        "edgesam_decoder.onnx",
        "decoder.onnx",
        "edgesam_decoder.ort",
        "decoder.ort"
      ]
    }
  }
}

/* =========================================================
 * Logging
 * ======================================================= */

enum NativeONNXLoggingLevel:
  String,
  Codable,
  Equatable,
  Sendable {

  case verbose

  case info

  case warning

  case error

  case fatal
}

/* =========================================================
 * Configuration
 * ======================================================= */

struct NativeONNXSessionConfiguration:
  Equatable,
  Sendable {

  let encoderFileName:
    String?

  let decoderFileName:
    String?

  let bundleSubdirectories:
    [String]

  let allowDocumentsDirectory:
    Bool

  let allowApplicationSupportDirectory:
    Bool

  let maximumModelFileBytes:
    Int64

  let loggingLevel:
    NativeONNXLoggingLevel

  /*
   * Ù„Ø§ Ù†ÙØ±Ø¶ CoreML ÙÙŠ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰.
   *
   * CPU Runtime Ù‡Ùˆ Ø§Ù„Ù…Ø±Ø¬Ø¹ Ø§Ù„Ø£ÙƒØ«Ø± Ø§Ø³ØªÙ‚Ø±Ø§Ø±Ù‹Ø§ØŒ
   * ÙˆÙŠÙ…ÙƒÙ† ØªÙØ¹ÙŠÙ„ CoreML Ù„Ø§Ø­Ù‚Ù‹Ø§ Ø¨Ø¹Ø¯ Ù†Ø¬Ø§Ø­ Pipeline.
   */
  let enableCoreMLExecutionProvider:
    Bool

  static let `default` =
    NativeONNXSessionConfiguration(
      encoderFileName:
        nil,

      decoderFileName:
        nil,

      bundleSubdirectories: [
        "",
        "models",
        "Models",
        "edgesam",
        "EdgeSAM",
        "assets",
        "assets/models"
      ],

      allowDocumentsDirectory:
        true,

      allowApplicationSupportDirectory:
        true,

      maximumModelFileBytes:
        1_024 *
        1_024 *
        1_024,

      loggingLevel:
        .warning,

      enableCoreMLExecutionProvider:
        false
    )
}

/* =========================================================
 * Model location
 * ======================================================= */

struct NativeONNXModelLocation:
  Equatable,
  Sendable {

  let kind:
    NativeONNXModelKind

  let url:
    URL

  let fileName:
    String

  let fileSizeBytes:
    Int64

  let source:
    String

  func asDictionary()
    -> [String: Any] {
    return [
      "kind":
        kind.rawValue,

      "url":
        url.absoluteString,

      "path":
        url.path,

      "fileName":
        fileName,

      "fileSizeBytes":
        fileSizeBytes,

      "source":
        source
    ]
  }
}

/* =========================================================
 * Model interface
 * ======================================================= */

struct NativeONNXModelSessionInfo:
  Equatable,
  Sendable {

  let kind:
    NativeONNXModelKind

  let modelLocation:
    NativeONNXModelLocation

  let inputNames:
    [String]

  let outputNames:
    [String]

  func asDictionary()
    -> [String: Any] {
    return [
      "kind":
        kind.rawValue,

      "model":
        modelLocation
          .asDictionary(),

      "inputNames":
        inputNames,

      "outputNames":
        outputNames
    ]
  }
}

/* =========================================================
 * Tensor output
 * ======================================================= */

#if canImport(onnxruntime_objc)

struct NativeONNXTensorOutput:
  @unchecked Sendable {

  let name:
    String

  /*
   * Ù†Ø­ØªÙØ¸ Ø¨Ù‚ÙŠÙ…Ø© ORT Ù†ÙØ³Ù‡Ø§ Ø­ØªÙ‰ Ù„Ø§ Ù†Ù†Ø´Ø¦ Ù†Ø³Ø®Ø© Swift
   * Ø¶Ø®Ù…Ø© Ù…Ù† Embedding Ø£Ùˆ Mask Ù‚Ø¨Ù„ Ø§Ù„Ø­Ø§Ø¬Ø© Ø¥Ù„ÙŠÙ‡Ø§.
   */
  let value:
    ORTValue

  let shape:
    [NSNumber]

  let elementType:
    ORTTensorElementDataType

  var elementCount:
    Int {
    var count =
      1

    for dimension in shape {
      let value =
        dimension.intValue

      guard value >
              0 else {
        return 0
      }

      let result =
        count
          .multipliedReportingOverflow(
            by:
              value
          )

      guard !result.overflow else {
        return 0
      }

      count =
        result.partialValue
    }

    return count
  }

  func asDictionary()
    -> [String: Any] {
    return [
      "name":
        name,

      "shape":
        shape,

      "elementCount":
        elementCount,

      "elementType":
        String(
          describing:
            elementType
        )
    ]
  }
}

#else

struct NativeONNXTensorOutput:
  @unchecked Sendable {

  let name:
    String

  let shape:
    [NSNumber]

  var elementCount:
    Int {
    return 0
  }

  func asDictionary()
    -> [String: Any] {
    return [
      "name":
        name,

      "shape":
        shape,

      "elementCount":
        0,

      "elementType":
        "unavailable"
    ]
  }
}

#endif

/* =========================================================
 * Encoder result
 * ======================================================= */

struct NativeONNXEncoderResult:
  @unchecked Sendable {

  let outputs:
    [String: NativeONNXTensorOutput]

  let primaryOutputName:
    String

  let startedAt:
    NativeProcessingTimestamp

  let completedAt:
    NativeProcessingTimestamp

  let durationMs:
    Int64

  var primaryOutput:
    NativeONNXTensorOutput? {
    return outputs[
      primaryOutputName
    ]
  }

  func output(
    named name:
      String
  ) -> NativeONNXTensorOutput? {
    return outputs[
      name
    ]
  }

  func asDictionary()
    -> [String: Any] {
    return [
      "primaryOutputName":
        primaryOutputName,

      "outputNames":
        Array(
          outputs.keys
        )
        .sorted(),

      "outputs":
        outputs
          .mapValues {
            $0.asDictionary()
          },

      "startedAt":
        startedAt,

      "completedAt":
        completedAt,

      "durationMs":
        durationMs
    ]
  }
}

/* =========================================================
 * Decoder result
 * ======================================================= */

struct NativeONNXDecoderResult:
  @unchecked Sendable {

  let outputs:
    [String: NativeONNXTensorOutput]

  let primaryMaskOutputName:
    String

  let scoreOutputName:
    String?

  let startedAt:
    NativeProcessingTimestamp

  let completedAt:
    NativeProcessingTimestamp

  let durationMs:
    Int64

  var primaryMaskOutput:
    NativeONNXTensorOutput? {
    return outputs[
      primaryMaskOutputName
    ]
  }

  var scoreOutput:
    NativeONNXTensorOutput? {
    guard
      let scoreOutputName
    else {
      return nil
    }

    return outputs[
      scoreOutputName
    ]
  }

  func output(
    named name:
      String
  ) -> NativeONNXTensorOutput? {
    return outputs[
      name
    ]
  }

  func asDictionary()
    -> [String: Any] {
    return [
      "primaryMaskOutputName":
        primaryMaskOutputName,

      "scoreOutputName":
        scoreOutputName ??
        NSNull(),

      "outputNames":
        Array(
          outputs.keys
        )
        .sorted(),

      "outputs":
        outputs
          .mapValues {
            $0.asDictionary()
          },

      "startedAt":
        startedAt,

      "completedAt":
        completedAt,

      "durationMs":
        durationMs
    ]
  }
}

/* =========================================================
 * Diagnostics
 * ======================================================= */

struct NativeONNXSessionDiagnostics:
  Equatable,
  Sendable {

  let availability:
    NativeONNXRuntimeAvailability

  let initialized:
    Bool

  let disposed:
    Bool

  let encoderLoaded:
    Bool

  let decoderLoaded:
    Bool

  let encoderModelPath:
    String?

  let decoderModelPath:
    String?

  let encoderInputNames:
    [String]

  let encoderOutputNames:
    [String]

  let decoderInputNames:
    [String]

  let decoderOutputNames:
    [String]

  let initializationCount:
    Int

  let encoderRunCount:
    Int

  let decoderRunCount:
    Int

  let failedRunCount:
    Int

  let cancelledRunCount:
    Int

  let lastInitializedAt:
    NativeProcessingTimestamp?

  let lastRunStartedAt:
    NativeProcessingTimestamp?

  let lastRunCompletedAt:
    NativeProcessingTimestamp?

  let lastError:
    String?

  func asDictionary()
    -> [String: Any] {
    return [
      "availability":
        availability.rawValue,

      "initialized":
        initialized,

      "disposed":
        disposed,

      "encoderLoaded":
        encoderLoaded,

      "decoderLoaded":
        decoderLoaded,

      "encoderModelPath":
        encoderModelPath ??
        NSNull(),

      "decoderModelPath":
        decoderModelPath ??
        NSNull(),

      "encoderInputNames":
        encoderInputNames,

      "encoderOutputNames":
        encoderOutputNames,

      "decoderInputNames":
        decoderInputNames,

      "decoderOutputNames":
        decoderOutputNames,

      "initializationCount":
        initializationCount,

      "encoderRunCount":
        encoderRunCount,

      "decoderRunCount":
        decoderRunCount,

      "failedRunCount":
        failedRunCount,

      "cancelledRunCount":
        cancelledRunCount,

      "lastInitializedAt":
        lastInitializedAt ??
        NSNull(),

      "lastRunStartedAt":
        lastRunStartedAt ??
        NSNull(),

      "lastRunCompletedAt":
        lastRunCompletedAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull()
    ]
  }
}

/* =========================================================
 * Complete error contract
 * ======================================================= */

enum NativeONNXSessionError:
  LocalizedError,
  Equatable,
  Sendable {

  case runtimeUnavailable

  case disposed

  case notInitialized

  case modelNotFound(
    kind:
      NativeONNXModelKind,
    searchedFileNames:
      [String]
  )

  case invalidModelURL(
    kind:
      NativeONNXModelKind,
    value:
      String
  )

  case modelFileNotFound(
    kind:
      NativeONNXModelKind,
    path:
      String
  )

  case modelFileNotReadable(
    kind:
      NativeONNXModelKind,
    path:
      String
  )

  case modelFileTooSmall(
    kind:
      NativeONNXModelKind,
    fileSizeBytes:
      Int64
  )

  case modelFileTooLarge(
    kind:
      NativeONNXModelKind,
    fileSizeBytes:
      Int64,
    maximumBytes:
      Int64
  )

  case unsupportedModelFormat(
    kind:
      NativeONNXModelKind,
    pathExtension:
      String
  )

  case environmentCreationFailed(
    message:
      String
  )

  case sessionOptionsCreationFailed(
    kind:
      NativeONNXModelKind,
    message:
      String
  )

  case sessionCreationFailed(
    kind:
      NativeONNXModelKind,
    message:
      String
  )

  case sessionUnavailable(
    kind:
      NativeONNXModelKind
  )

  case sessionInspectionFailed(
    kind:
      NativeONNXModelKind,
    message:
      String
  )

  case invalidModelInterface(
    kind:
      NativeONNXModelKind,
    inputNames:
      [String],
    outputNames:
      [String]
  )

  case invalidTensorShape

  case tensorElementCountMismatch(
    expected:
      Int,
    received:
      Int
  )

  case tensorCreationFailed(
    message:
      String
  )

  case missingInferenceOutputs(
    kind:
      NativeONNXModelKind
  )

  case outputInspectionFailed(
    kind:
      NativeONNXModelKind,
    outputName:
      String,
    message:
      String
  )

  case invalidOutputShape(
    kind:
      NativeONNXModelKind,
    outputName:
      String,
    shape:
      [Int64]
  )

  case inferenceFailed(
    kind:
      NativeONNXModelKind,
    message:
      String
  )

  case missingDecoderInputs(
    requiredInputNames:
      [String]
  )

  case missingRequiredModelInputs(
    kind:
      NativeONNXModelKind,
    missingInputNames:
      [String],
    suppliedInputNames:
      [String]
  )

  case unexpectedModelInputs(
    kind:
      NativeONNXModelKind,
    unexpectedInputNames:
      [String],
    declaredInputNames:
      [String]
  )

  case missingRequestedOutputs(
    kind:
      NativeONNXModelKind
  )

  case unknownRequestedOutputs(
    kind:
      NativeONNXModelKind,
    requestedOutputNames:
      [String],
    declaredOutputNames:
      [String]
  )

  case cancelled(
    reason:
      String?
  )

  var errorDescription:
    String? {
    switch self {
    case .runtimeUnavailable:
      return
        "ONNX Runtime is not included in this iOS build."

    case .disposed:
      return
        "The native ONNX session manager has been disposed."

    case .notInitialized:
      return
        "The native ONNX session manager has not been initialized."

    case .modelNotFound(
      let kind,
      let searchedFileNames
    ):
      return
        """
        The \(kind.rawValue) model was not found. Searched names: \(searchedFileNames.joined(separator: ", ")).
        """

    case .invalidModelURL(
      let kind,
      let value
    ):
      return
        """
        The \(kind.rawValue) model URL is invalid: \(value).
        """

    case .modelFileNotFound(
      let kind,
      let path
    ):
      return
        """
        The \(kind.rawValue) model file was not found at \(path).
        """

    case .modelFileNotReadable(
      let kind,
      let path
    ):
      return
        """
        The \(kind.rawValue) model file is not readable at \(path).
        """

    case .modelFileTooSmall(
      let kind,
      let fileSizeBytes
    ):
      return
        """
        The \(kind.rawValue) model file is unexpectedly small: \(fileSizeBytes) bytes.
        """

    case .modelFileTooLarge(
      let kind,
      let fileSizeBytes,
      let maximumBytes
    ):
      return
        """
        The \(kind.rawValue) model file is too large: \(fileSizeBytes) bytes. Maximum allowed size is \(maximumBytes) bytes.
        """

    case .unsupportedModelFormat(
      let kind,
      let pathExtension
    ):
      return
        """
        The \(kind.rawValue) model format .\(pathExtension) is unsupported. Expected .onnx or .ort.
        """

    case .environmentCreationFailed(
      let message
    ):
      return
        """
        ONNX Runtime environment creation failed: \(message)
        """

    case .sessionOptionsCreationFailed(
      let kind,
      let message
    ):
      return
        """
        ONNX Runtime \(kind.rawValue) session-options creation failed: \(message)
        """

    case .sessionCreationFailed(
      let kind,
      let message
    ):
      return
        """
        ONNX Runtime \(kind.rawValue) session creation failed: \(message)
        """

    case .sessionUnavailable(
      let kind
    ):
      return
        """
        The ONNX Runtime \(kind.rawValue) session is unavailable.
        """

    case .sessionInspectionFailed(
      let kind,
      let message
    ):
      return
        """
        ONNX Runtime could not inspect the \(kind.rawValue) model interface: \(message)
        """

    case .invalidModelInterface(
      let kind,
      let inputNames,
      let outputNames
    ):
      return
        """
        The \(kind.rawValue) model interface is invalid. Inputs: \(inputNames.joined(separator: ", ")). Outputs: \(outputNames.joined(separator: ", ")).
        """

    case .invalidTensorShape:
      return
        "ONNX Runtime received an invalid tensor shape."

    case .tensorElementCountMismatch(
      let expected,
      let received
    ):
      return
        """
        ONNX Runtime tensor element count is invalid. Expected \(expected), received \(received).
        """

    case .tensorCreationFailed(
      let message
    ):
      return
        """
        ONNX Runtime tensor creation failed: \(message)
        """

    case .missingInferenceOutputs(
      let kind
    ):
      return
        """
        ONNX Runtime returned no outputs from the \(kind.rawValue) model.
        """

    case .outputInspectionFailed(
      let kind,
      let outputName,
      let message
    ):
      return
        """
        ONNX Runtime could not inspect \(kind.rawValue) output \(outputName): \(message)
        """

    case .invalidOutputShape(
      let kind,
      let outputName,
      let shape
    ):
      return
        """
        ONNX Runtime \(kind.rawValue) output \(outputName) has an invalid shape: \(shape).
        """

    case .inferenceFailed(
      let kind,
      let message
    ):
      return
        """
        ONNX Runtime \(kind.rawValue) inference failed: \(message)
        """

    case .missingDecoderInputs(
      let requiredInputNames
    ):
      return
        """
        EdgeSAM decoder inputs are missing. Required inputs: \(requiredInputNames.joined(separator: ", ")).
        """

    case .missingRequiredModelInputs(
      let kind,
      let missingInputNames,
      let suppliedInputNames
    ):
      return
        """
        The \(kind.rawValue) model is missing required inputs: \(missingInputNames.joined(separator: ", ")). Supplied inputs: \(suppliedInputNames.joined(separator: ", ")).
        """

    case .unexpectedModelInputs(
      let kind,
      let unexpectedInputNames,
      let declaredInputNames
    ):
      return
        """
        The \(kind.rawValue) model received unexpected inputs: \(unexpectedInputNames.joined(separator: ", ")). Declared inputs: \(declaredInputNames.joined(separator: ", ")).
        """

    case .missingRequestedOutputs(
      let kind
    ):
      return
        """
        No \(kind.rawValue) output names were requested.
        """

    case .unknownRequestedOutputs(
      let kind,
      let requestedOutputNames,
      let declaredOutputNames
    ):
      return
        """
        Unknown \(kind.rawValue) outputs were requested: \(requestedOutputNames.joined(separator: ", ")). Declared outputs: \(declaredOutputNames.joined(separator: ", ")).
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
        "ONNX Runtime inference was cancelled."
    }
  }
}

/* =========================================================
 * Session manager
 * ======================================================= */

final class NativeONNXSession:
  @unchecked Sendable {

  /* =======================================================
   * Constants
   * ===================================================== */

  private static let minimumModelFileBytes:
    Int64 =
      1_024

  /* =======================================================
   * Dependencies
   * ===================================================== */

  private let fileManager:
    FileManager

  private let bundle:
    Bundle

  private let configuration:
    NativeONNXSessionConfiguration

  private let stateQueue:
    DispatchQueue

  private let inferenceQueue:
    DispatchQueue

  /* =======================================================
   * State
   * ===================================================== */

  private var initialized =
    false

  private var disposed =
    false

  private var encoderModelLocation:
    NativeONNXModelLocation?

  private var decoderModelLocation:
    NativeONNXModelLocation?

  private var encoderInputNamesStorage:
    [String] =
      []

  private var encoderOutputNamesStorage:
    [String] =
      []

  private var decoderInputNamesStorage:
    [String] =
      []

  private var decoderOutputNamesStorage:
    [String] =
      []

  private var initializationCount =
    0

  private var encoderRunCount =
    0

  private var decoderRunCount =
    0

  private var failedRunCount =
    0

  private var cancelledRunCount =
    0

  private var lastInitializedAt:
    NativeProcessingTimestamp?

  private var lastRunStartedAt:
    NativeProcessingTimestamp?

  private var lastRunCompletedAt:
    NativeProcessingTimestamp?

  private var lastError:
    String?

#if canImport(onnxruntime_objc)

  /*
   * Environment ÙŠØ¬Ø¨ Ø£Ù† ÙŠØ¹ÙŠØ´ Ù…Ø¯Ø© Ø£Ø·ÙˆÙ„ Ù…Ù† Ø§Ù„Ø¬Ù„Ø³Ø§Øª.
   */
  private var environment:
    ORTEnv?

  private var encoderSession:
    ORTSession?

  private var decoderSession:
    ORTSession?

#endif

  /* =======================================================
   * Initialization
   * ===================================================== */

  init(
    fileManager:
      FileManager =
        .default,

    bundle:
      Bundle =
        .main,

    configuration:
      NativeONNXSessionConfiguration =
        .default
  ) {
    self.fileManager =
      fileManager

    self.bundle =
      bundle

    self.configuration =
      configuration

    self.stateQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.onnx.state",
        qos:
          .userInitiated
      )

    self.inferenceQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.onnx.inference",
        qos:
          .userInitiated
      )
  }

  /* =======================================================
   * Runtime availability
   * ===================================================== */

  static var isRuntimeCompiled:
    Bool {
#if canImport(onnxruntime_objc)
    return true
#else
    return false
#endif
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  func diagnostics()
    -> NativeONNXSessionDiagnostics {
    return stateQueue.sync {
      NativeONNXSessionDiagnostics(
        availability:
          resolveAvailabilityLocked(),

        initialized:
          initialized,

        disposed:
          disposed,

        encoderLoaded:
          isEncoderLoadedLocked(),

        decoderLoaded:
          isDecoderLoadedLocked(),

        encoderModelPath:
          encoderModelLocation?
            .url
            .path,

        decoderModelPath:
          decoderModelLocation?
            .url
            .path,

        encoderInputNames:
          encoderInputNamesStorage,

        encoderOutputNames:
          encoderOutputNamesStorage,

        decoderInputNames:
          decoderInputNamesStorage,

        decoderOutputNames:
          decoderOutputNamesStorage,

        initializationCount:
          initializationCount,

        encoderRunCount:
          encoderRunCount,

        decoderRunCount:
          decoderRunCount,

        failedRunCount:
          failedRunCount,

        cancelledRunCount:
          cancelledRunCount,

        lastInitializedAt:
          lastInitializedAt,

        lastRunStartedAt:
          lastRunStartedAt,

        lastRunCompletedAt:
          lastRunCompletedAt,

        lastError:
          lastError
      )
    }
  }

  /* =======================================================
   * Private state helpers
   * ===================================================== */

  private func resolveAvailabilityLocked()
    -> NativeONNXRuntimeAvailability {
    if
      disposed
    {
      return .disposed
    }

    return Self.isRuntimeCompiled
      ? .available
      : .unavailable
  }

  private func isEncoderLoadedLocked()
    -> Bool {
#if canImport(onnxruntime_objc)
    return encoderSession !=
      nil
#else
    return false
#endif
  }

  private func isDecoderLoadedLocked()
    -> Bool {
#if canImport(onnxruntime_objc)
    return decoderSession !=
      nil
#else
    return false
#endif
  }

  private func assertNotDisposedLocked()
    throws {
    guard
      !disposed
    else {
      throw NativeONNXSessionError
        .disposed
    }
  }

  private func normalizeOptionalString(
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
  /* =======================================================
   * Public model discovery
   * ===================================================== */

  func resolveModelLocations()
    throws -> (
      encoder:
        NativeONNXModelLocation,
      decoder:
        NativeONNXModelLocation
    ) {
    return try stateQueue.sync {
      try assertNotDisposedLocked()

      let locations =
        try resolveModelLocationsLocked()

      encoderModelLocation =
        locations.encoder

      decoderModelLocation =
        locations.decoder

      return locations
    }
  }

  /* =======================================================
   * Initialization entry
   * ===================================================== */

  func initialize()
    async throws ->
      [String: Any] {
    return try await withCheckedThrowingContinuation {
      continuation in

      inferenceQueue.async {
        do {
          let result =
            try self
              .initializeSynchronously()

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
    }
  }

  /* =======================================================
   * Synchronous initialization
   * ===================================================== */

  private func initializeSynchronously()
    throws ->
      [String: Any] {
    return try stateQueue.sync {
      try assertNotDisposedLocked()

      if
        initialized
      {
        let encoderInfo =
          try createSessionInfoLocked(
            kind:
              .encoder
          )

        let decoderInfo =
          try createSessionInfoLocked(
            kind:
              .decoder
          )

        return [
          "initialized":
            true,

          "alreadyInitialized":
            true,

          "runtimeAvailable":
            Self.isRuntimeCompiled,

          "encoder":
            encoderInfo
              .asDictionary(),

          "decoder":
            decoderInfo
              .asDictionary(),

          "initializedAt":
            lastInitializedAt ??
            NativeProcessingTime.now()
        ]
      }

      guard
        Self.isRuntimeCompiled
      else {
        let runtimeError =
          NativeONNXSessionError
            .runtimeUnavailable

        lastError =
          runtimeError
            .localizedDescription

        throw runtimeError
      }

      let locations:
        (
          encoder:
            NativeONNXModelLocation,
          decoder:
            NativeONNXModelLocation
        )

      do {
        locations =
          try resolveModelLocationsLocked()
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }

#if canImport(onnxruntime_objc)

      let createdEnvironment:
        ORTEnv

      do {
        createdEnvironment =
          try ORTEnv(
            loggingLevel:
              resolveORTLoggingLevel(
                configuration
                  .loggingLevel
              )
          )
      } catch {
        let wrappedError =
          NativeONNXSessionError
            .environmentCreationFailed(
              message:
                error.localizedDescription
            )

        lastError =
          wrappedError
            .localizedDescription

        throw wrappedError
      }

      let encoderOptions:
        ORTSessionOptions

      do {
        encoderOptions =
          try createSessionOptions(
            kind:
              .encoder
          )
      } catch {
        let wrappedError =
          NativeONNXSessionError
            .sessionOptionsCreationFailed(
              kind:
                .encoder,
              message:
                error.localizedDescription
            )

        lastError =
          wrappedError
            .localizedDescription

        throw wrappedError
      }

      let decoderOptions:
        ORTSessionOptions

      do {
        decoderOptions =
          try createSessionOptions(
            kind:
              .decoder
          )
      } catch {
        let wrappedError =
          NativeONNXSessionError
            .sessionOptionsCreationFailed(
              kind:
                .decoder,
              message:
                error.localizedDescription
            )

        lastError =
          wrappedError
            .localizedDescription

        throw wrappedError
      }

      let createdEncoderSession:
        ORTSession

      do {
        createdEncoderSession =
          try ORTSession(
            env:
              createdEnvironment,

            modelPath:
              locations
                .encoder
                .url
                .path,

            sessionOptions:
              encoderOptions
          )
      } catch {
        let wrappedError =
          NativeONNXSessionError
            .sessionCreationFailed(
              kind:
                .encoder,

              message:
                error.localizedDescription
            )

        lastError =
          wrappedError
            .localizedDescription

        throw wrappedError
      }

      let createdDecoderSession:
        ORTSession

      do {
        createdDecoderSession =
          try ORTSession(
            env:
              createdEnvironment,

            modelPath:
              locations
                .decoder
                .url
                .path,

            sessionOptions:
              decoderOptions
          )
      } catch {
        let wrappedError =
          NativeONNXSessionError
            .sessionCreationFailed(
              kind:
                .decoder,

              message:
                error.localizedDescription
            )

        lastError =
          wrappedError
            .localizedDescription

        throw wrappedError
      }

      let encoderInputNames:
        [String]

      let encoderOutputNames:
        [String]

      do {
        encoderInputNames =
          try createdEncoderSession
            .inputNames()

        encoderOutputNames =
          try createdEncoderSession
            .outputNames()
      } catch {
        let wrappedError =
          NativeONNXSessionError
            .sessionInspectionFailed(
              kind:
                .encoder,

              message:
                error.localizedDescription
            )

        lastError =
          wrappedError
            .localizedDescription

        throw wrappedError
      }

      let decoderInputNames:
        [String]

      let decoderOutputNames:
        [String]

      do {
        decoderInputNames =
          try createdDecoderSession
            .inputNames()

        decoderOutputNames =
          try createdDecoderSession
            .outputNames()
      } catch {
        let wrappedError =
          NativeONNXSessionError
            .sessionInspectionFailed(
              kind:
                .decoder,

              message:
                error.localizedDescription
            )

        lastError =
          wrappedError
            .localizedDescription

        throw wrappedError
      }

      guard
        !encoderInputNames.isEmpty,
        !encoderOutputNames.isEmpty
      else {
        let interfaceError =
          NativeONNXSessionError
            .invalidModelInterface(
              kind:
                .encoder,

              inputNames:
                encoderInputNames,

              outputNames:
                encoderOutputNames
            )

        lastError =
          interfaceError
            .localizedDescription

        throw interfaceError
      }

      guard
        !decoderInputNames.isEmpty,
        !decoderOutputNames.isEmpty
      else {
        let interfaceError =
          NativeONNXSessionError
            .invalidModelInterface(
              kind:
                .decoder,

              inputNames:
                decoderInputNames,

              outputNames:
                decoderOutputNames
            )

        lastError =
          interfaceError
            .localizedDescription

        throw interfaceError
      }

      /*
       * Ù„Ø§ Ù†Ø­ÙØ¸ Ø£ÙŠ Session ÙÙŠ Ø§Ù„Ø­Ø§Ù„Ø© Ø¥Ù„Ø§ Ø¨Ø¹Ø¯ Ù†Ø¬Ø§Ø­
       * Ø¥Ù†Ø´Ø§Ø¡ ÙˆÙØ­Øµ Ø§Ù„Ø¬Ù„Ø³ØªÙŠÙ† Ø¨Ø§Ù„ÙƒØ§Ù…Ù„.
       *
       * Ø¨Ù‡Ø°Ø§ Ù„Ø§ ØªØ¨Ù‚Ù‰ ØªÙ‡ÙŠØ¦Ø© Ø¬Ø²Ø¦ÙŠØ© Ø¹Ù†Ø¯ ÙØ´Ù„ Decoder.
       */
      environment =
        createdEnvironment

      encoderSession =
        createdEncoderSession

      decoderSession =
        createdDecoderSession

      encoderModelLocation =
        locations.encoder

      decoderModelLocation =
        locations.decoder

      encoderInputNamesStorage =
        encoderInputNames

      encoderOutputNamesStorage =
        encoderOutputNames

      decoderInputNamesStorage =
        decoderInputNames

      decoderOutputNamesStorage =
        decoderOutputNames

      initialized =
        true

      initializationCount +=
        1

      lastInitializedAt =
        NativeProcessingTime.now()

      lastError =
        nil

      return [
        "initialized":
          true,

        "alreadyInitialized":
          false,

        "runtimeAvailable":
          true,

        "encoder":
          NativeONNXModelSessionInfo(
            kind:
              .encoder,

            modelLocation:
              locations.encoder,

            inputNames:
              encoderInputNames,

            outputNames:
              encoderOutputNames
          )
          .asDictionary(),

        "decoder":
          NativeONNXModelSessionInfo(
            kind:
              .decoder,

            modelLocation:
              locations.decoder,

            inputNames:
              decoderInputNames,

            outputNames:
              decoderOutputNames
          )
          .asDictionary(),

        "initializedAt":
          lastInitializedAt ??
          NativeProcessingTime.now()
      ]

#else

      let runtimeError =
        NativeONNXSessionError
          .runtimeUnavailable

      lastError =
        runtimeError
          .localizedDescription

      throw runtimeError

#endif
    }
  }

  /* =======================================================
   * Session options
   * ===================================================== */

#if canImport(onnxruntime_objc)

  private func createSessionOptions(
    kind:
      NativeONNXModelKind
  ) throws ->
      ORTSessionOptions {
    let options =
      try ORTSessionOptions()

    /*
     * ØªÙØ¹ÙŠÙ„ ÙƒÙ„ Graph Optimizations Ø§Ù„Ù…ØªØ§Ø­Ø©.
     *
     * Ù„Ø§ Ù†ÙØ±Ø¶ Ø¹Ø¯Ø¯ Threads ÙŠØ¯ÙˆÙŠÙ‹Ø§ ÙÙŠ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰Ø›
     * Ù†ØªØ±Ùƒ ONNX Runtime ÙŠØ®ØªØ§Ø± Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯ Ø§Ù„Ù…Ù†Ø§Ø³Ø¨ Ù„Ù„Ø¬Ù‡Ø§Ø².
     */
    try options
      .setGraphOptimizationLevel(
        .all
      )

    /*
     * CoreML Ø³ÙŠØ¸Ù„ Ù…Ø¹Ø·Ù„Ù‹Ø§ Ø§Ù„Ø¢Ù† Ø·Ø¨Ù‚Ù‹Ø§ Ù„Ù„Ø¥Ø¹Ø¯Ø§Ø¯ Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠ.
     *
     * Ù„Ù† Ù†Ø±Ø¨Ø·Ù‡ Ù‚Ø¨Ù„ Ù†Ø¬Ø§Ø­ CPU Pipeline Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ø­ØªÙ‰ Ù„Ø§
     * Ù†ØºÙŠØ± Ø§Ù„Ø¯Ù‚Ø© Ø£Ùˆ Ø³Ù„ÙˆÙƒ Ø§Ù„Ù…ÙˆØ¯ÙŠÙ„ Ø£Ø«Ù†Ø§Ø¡ Ø¨Ù†Ø§Ø¡ Ø§Ù„Ø£Ø³Ø§Ø³.
     */
    _ =
      kind

    return options
  }

  private func resolveORTLoggingLevel(
    _ level:
      NativeONNXLoggingLevel
  ) -> ORTLoggingLevel {
    switch level {
    case .verbose:
      return .verbose

    case .info:
      return .info

    case .warning:
      return .warning

    case .error:
      return .error

    case .fatal:
      return .fatal
    }
  }

#endif

  /* =======================================================
   * Model discovery
   * ===================================================== */

  private func resolveModelLocationsLocked()
    throws -> (
      encoder:
        NativeONNXModelLocation,
      decoder:
        NativeONNXModelLocation
    ) {
    let encoder =
      try resolveModelLocationLocked(
        kind:
          .encoder,

        explicitFileName:
          configuration
            .encoderFileName
      )

    let decoder =
      try resolveModelLocationLocked(
        kind:
          .decoder,

        explicitFileName:
          configuration
            .decoderFileName
      )

    return (
      encoder:
        encoder,

      decoder:
        decoder
    )
  }

  private func resolveModelLocationLocked(
    kind:
      NativeONNXModelKind,

    explicitFileName:
      String?
  ) throws ->
      NativeONNXModelLocation {
    let candidateFileNames =
      createCandidateFileNames(
        kind:
          kind,

        explicitFileName:
          explicitFileName
      )

    /*
     * Bundle Ù‡Ùˆ Ø§Ù„Ù…ØµØ¯Ø± Ø§Ù„Ø£ÙˆÙ„ Ù„Ø£Ù†Ù‡ ÙŠØ¸Ù„ Ù…ØªØ§Ø­Ù‹Ø§ Ø¹Ù†Ø¯Ù…Ø§
     * JavaScript ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ Ø£Ùˆ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ ÙÙŠ Ø§Ù„Ø®Ù„ÙÙŠØ©.
     */
    for fileName in
      candidateFileNames
    {
      for subdirectory in
        configuration
          .bundleSubdirectories
      {
        if
          let location =
            try resolveBundleModel(
              fileName:
                fileName,

              subdirectory:
                subdirectory,

              kind:
                kind
            )
        {
          return location
        }
      }
    }

    if
      configuration
        .allowApplicationSupportDirectory,
      let applicationSupportURL =
        try? fileManager.url(
          for:
            .applicationSupportDirectory,

          in:
            .userDomainMask,

          appropriateFor:
            nil,

          create:
            false
        ),
      let location =
        try resolveModelInDirectory(
          applicationSupportURL,

          candidateFileNames:
            candidateFileNames,

          kind:
            kind,

          source:
            "application-support"
        )
    {
      return location
    }

    if
      configuration
        .allowDocumentsDirectory,
      let documentsURL =
        try? fileManager.url(
          for:
            .documentDirectory,

          in:
            .userDomainMask,

          appropriateFor:
            nil,

          create:
            false
        ),
      let location =
        try resolveModelInDirectory(
          documentsURL,

          candidateFileNames:
            candidateFileNames,

          kind:
            kind,

          source:
            "documents"
        )
    {
      return location
    }

    throw NativeONNXSessionError
      .modelNotFound(
        kind:
          kind,

        searchedFileNames:
          candidateFileNames
      )
  }

  private func createCandidateFileNames(
    kind:
      NativeONNXModelKind,

    explicitFileName:
      String?
  ) -> [String] {
    var fileNames:
      [String] =
        []

    if
      let explicitFileName =
        normalizeOptionalString(
          explicitFileName
        )
    {
      fileNames.append(
        explicitFileName
      )
    }

    for fileName in
      kind.defaultFileNames
    {
      if
        !fileNames.contains(
          fileName
        )
      {
        fileNames.append(
          fileName
        )
      }
    }

    return fileNames
  }

  private func resolveBundleModel(
    fileName:
      String,

    subdirectory:
      String,

    kind:
      NativeONNXModelKind
  ) throws ->
      NativeONNXModelLocation? {
    let fileURL =
      URL(
        fileURLWithPath:
          fileName
      )

    let resourceName =
      fileURL
        .deletingPathExtension()
        .lastPathComponent

    let fileExtension =
      fileURL
        .pathExtension

    let normalizedSubdirectory =
      normalizeOptionalString(
        subdirectory
      )

    guard
      let resolvedURL =
        bundle.url(
          forResource:
            resourceName,

          withExtension:
            fileExtension.isEmpty
              ? nil
              : fileExtension,

          subdirectory:
            normalizedSubdirectory
        )
    else {
      return nil
    }

    let source:
      String

    if
      let normalizedSubdirectory
    {
      source =
        "bundle/\(normalizedSubdirectory)"
    } else {
      source =
        "bundle"
    }

    return try validateModelURL(
      resolvedURL,

      kind:
        kind,

      source:
        source
    )
  }

  private func resolveModelInDirectory(
    _ directoryURL:
      URL,

    candidateFileNames:
      [String],

    kind:
      NativeONNXModelKind,

    source:
      String
  ) throws ->
      NativeONNXModelLocation? {
    for fileName in
      candidateFileNames
    {
      let directURL =
        directoryURL
          .appendingPathComponent(
            fileName,

            isDirectory:
              false
          )

      if
        fileManager.fileExists(
          atPath:
            directURL.path
        )
      {
        return try validateModelURL(
          directURL,

          kind:
            kind,

          source:
            source
        )
      }

      for subdirectory in
        configuration
          .bundleSubdirectories
      {
        guard
          let normalizedSubdirectory =
            normalizeOptionalString(
              subdirectory
            )
        else {
          continue
        }

        let nestedURL =
          directoryURL
            .appendingPathComponent(
              normalizedSubdirectory,

              isDirectory:
                true
            )
            .appendingPathComponent(
              fileName,

              isDirectory:
                false
            )

        if
          fileManager.fileExists(
            atPath:
              nestedURL.path
          )
        {
          return try validateModelURL(
            nestedURL,

            kind:
              kind,

            source:
              "\(source)/\(normalizedSubdirectory)"
          )
        }
      }
    }

    return nil
  }

  private func validateModelURL(
    _ modelURL:
      URL,

    kind:
      NativeONNXModelKind,

    source:
      String
  ) throws ->
      NativeONNXModelLocation {
    let standardizedURL =
      modelURL
        .standardizedFileURL

    guard
      standardizedURL.isFileURL
    else {
      throw NativeONNXSessionError
        .invalidModelURL(
          kind:
            kind,

          value:
            modelURL
              .absoluteString
        )
    }

    guard
      fileManager.fileExists(
        atPath:
          standardizedURL.path
      )
    else {
      throw NativeONNXSessionError
        .modelFileNotFound(
          kind:
            kind,

          path:
            standardizedURL.path
        )
    }

    guard
      fileManager.isReadableFile(
        atPath:
          standardizedURL.path
      )
    else {
      throw NativeONNXSessionError
        .modelFileNotReadable(
          kind:
            kind,

          path:
            standardizedURL.path
        )
    }

    let attributes =
      try fileManager
        .attributesOfItem(
          atPath:
            standardizedURL.path
        )

    let fileSizeBytes =
      (
        attributes[
          .size
        ] as? NSNumber
      )?
      .int64Value ??
      0

    guard
      fileSizeBytes >=
        Self
          .minimumModelFileBytes
    else {
      throw NativeONNXSessionError
        .modelFileTooSmall(
          kind:
            kind,

          fileSizeBytes:
            fileSizeBytes
        )
    }

    guard
      fileSizeBytes <=
        configuration
          .maximumModelFileBytes
    else {
      throw NativeONNXSessionError
        .modelFileTooLarge(
          kind:
            kind,

          fileSizeBytes:
            fileSizeBytes,

          maximumBytes:
            configuration
              .maximumModelFileBytes
        )
    }

    let pathExtension =
      standardizedURL
        .pathExtension
        .lowercased()

    guard
      pathExtension ==
        "onnx" ||
      pathExtension ==
        "ort"
    else {
      throw NativeONNXSessionError
        .unsupportedModelFormat(
          kind:
            kind,

          pathExtension:
            pathExtension
        )
    }

    return NativeONNXModelLocation(
      kind:
        kind,

      url:
        standardizedURL,

      fileName:
        standardizedURL
          .lastPathComponent,

      fileSizeBytes:
        fileSizeBytes,

      source:
        source
    )
  }

  /* =======================================================
   * Session interface snapshots
   * ===================================================== */

  func modelInterface(
    kind:
      NativeONNXModelKind
  ) throws ->
      NativeONNXModelSessionInfo {
    return try stateQueue.sync {
      try assertNotDisposedLocked()

      guard
        initialized
      else {
        throw NativeONNXSessionError
          .notInitialized
      }

      return try createSessionInfoLocked(
        kind:
          kind
      )
    }
  }

  private func createSessionInfoLocked(
    kind:
      NativeONNXModelKind
  ) throws ->
      NativeONNXModelSessionInfo {
    switch kind {
    case .encoder:
      guard
        let location =
          encoderModelLocation
      else {
        throw NativeONNXSessionError
          .sessionUnavailable(
            kind:
              .encoder
          )
      }

      return NativeONNXModelSessionInfo(
        kind:
          .encoder,

        modelLocation:
          location,

        inputNames:
          encoderInputNamesStorage,

        outputNames:
          encoderOutputNamesStorage
      )

    case .decoder:
      guard
        let location =
          decoderModelLocation
      else {
        throw NativeONNXSessionError
          .sessionUnavailable(
            kind:
              .decoder
          )
      }

      return NativeONNXModelSessionInfo(
        kind:
          .decoder,

        modelLocation:
          location,

        inputNames:
          decoderInputNamesStorage,

        outputNames:
          decoderOutputNamesStorage
      )
    }
  }
  /* =======================================================
   * Encoder execution
   * ===================================================== */

  func runEncoder(
    tensor:
      ContiguousArray<Float>,

    shape:
      [NSNumber],

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeONNXEncoderResult {
    try cancellationToken
      .throwIfCancelled()

    return try await withCheckedThrowingContinuation {
      continuation in

      inferenceQueue.async {
        do {
          let result =
            try self
              .runEncoderSynchronously(
                tensor:
                  tensor,

                shape:
                  shape,

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
    }
  }

  /* =======================================================
   * Synchronous encoder execution
   * ===================================================== */

  private func runEncoderSynchronously(
    tensor:
      ContiguousArray<Float>,

    shape:
      [NSNumber],

    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      NativeONNXEncoderResult {
    try cancellationToken
      .throwIfCancelled()

    let requiresInitialization =
      stateQueue.sync {
        !initialized
      }

    if
      requiresInitialization
    {
      /*
       * Ù†Ø­Ù† Ø¨Ø§Ù„ÙØ¹Ù„ Ø¯Ø§Ø®Ù„ inferenceQueue.
       *
       * Ù„Ø°Ù„Ùƒ Ù†Ø³ØªØ¯Ø¹ÙŠ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ù…ØªØ²Ø§Ù…Ù†Ø© Ù…Ø¨Ø§Ø´Ø±Ø©
       * ÙˆÙ„Ø§ Ù†Ø³ØªØ¯Ø¹ÙŠ initialize() Ø­ØªÙ‰ Ù„Ø§ ÙŠØ­Ø¯Ø« Deadlock.
       */
      _ =
        try initializeSynchronously()
    }

    try cancellationToken
      .throwIfCancelled()

    let startedAt =
      NativeProcessingTime.now()

    stateQueue.sync {
      lastRunStartedAt =
        startedAt

      lastError =
        nil
    }

#if canImport(onnxruntime_objc)

    let executionState:
      (
        session:
          ORTSession,

        inputNames:
          [String],

        outputNames:
          [String]
      )

    do {
      executionState =
        try stateQueue.sync {
          try assertNotDisposedLocked()

          guard
            initialized
          else {
            throw NativeONNXSessionError
              .notInitialized
          }

          guard
            let encoderSession
          else {
            throw NativeONNXSessionError
              .sessionUnavailable(
                kind:
                  .encoder
              )
          }

          guard
            !encoderInputNamesStorage
              .isEmpty,
            !encoderOutputNamesStorage
              .isEmpty
          else {
            throw NativeONNXSessionError
              .invalidModelInterface(
                kind:
                  .encoder,

                inputNames:
                  encoderInputNamesStorage,

                outputNames:
                  encoderOutputNamesStorage
              )
          }

          return (
            session:
              encoderSession,

            inputNames:
              encoderInputNamesStorage,

            outputNames:
              encoderOutputNamesStorage
          )
        }
    } catch {
      recordRunFailure(
        error:
          error,

        cancellationToken:
          cancellationToken
      )

      throw error
    }

    do {
      try validateTensorShape(
        shape,

        elementCount:
          tensor.count
      )

      try cancellationToken
        .throwIfCancelled()

      let inputName =
        resolveEncoderInputName(
          executionState
            .inputNames
        )

      let requestedOutputNames =
        Set(
          executionState
            .outputNames
        )

      guard
        !requestedOutputNames
          .isEmpty
      else {
        throw NativeONNXSessionError
          .missingRequestedOutputs(
            kind:
              .encoder
          )
      }

      /*
       * NSMutableData ÙŠØ¬Ø¨ Ø£Ù† ØªØ¸Ù„ Ø­ÙŠØ© Ø­ØªÙ‰ ØªÙ†ØªÙ‡ÙŠ
       * session.run Ù„Ø£Ù† ORTValue ØªØ¹ØªÙ…Ø¯ Ø¹Ù„ÙŠÙ‡Ø§.
       */
      let tensorData =
        try createFloatTensorData(
          tensor
        )

      try cancellationToken
        .throwIfCancelled()

      let inputValue:
        ORTValue

      do {
        inputValue =
          try ORTValue(
            tensorData:
              tensorData,

            elementType:
              .float,

            shape:
              shape
          )
      } catch {
        throw NativeONNXSessionError
          .tensorCreationFailed(
            message:
              error.localizedDescription
          )
      }

      try cancellationToken
        .throwIfCancelled()

      let rawOutputs:
        [String: ORTValue]

      do {
        rawOutputs =
          try executionState
            .session
            .run(
              withInputs: [
                inputName:
                  inputValue
              ],

              outputNames:
                requestedOutputNames,

              runOptions:
                nil
            )
      } catch {
        throw NativeONNXSessionError
          .inferenceFailed(
            kind:
              .encoder,

            message:
              error.localizedDescription
          )
      }

      /*
       * Ù†Ø­Ø§ÙØ¸ Ø¹Ù„Ù‰ tensorData ÙˆinputValue Ø­ÙŠÙŠÙ† Ø­ØªÙ‰
       * Ù†Ù‡Ø§ÙŠØ© session.run Ø¨ÙˆØµÙˆÙ„ Ø§Ù„ØªÙ†ÙÙŠØ° Ø¥Ù„Ù‰ Ù‡Ù†Ø§.
       */
      _ =
        tensorData

      _ =
        inputValue

      try cancellationToken
        .throwIfCancelled()

      guard
        !rawOutputs.isEmpty
      else {
        throw NativeONNXSessionError
          .missingInferenceOutputs(
            kind:
              .encoder
          )
      }

      let parsedOutputs =
        try parseTensorOutputs(
          rawOutputs,

          kind:
            .encoder,

          cancellationToken:
            cancellationToken
        )

      let primaryOutputName =
        try resolvePrimaryEncoderOutputName(
          availableOutputNames:
            Array(
              parsedOutputs.keys
            )
        )

      guard
        parsedOutputs[
          primaryOutputName
        ] !=
          nil
      else {
        throw NativeONNXSessionError
          .missingInferenceOutputs(
            kind:
              .encoder
          )
      }

      let completedAt =
        NativeProcessingTime.now()

      let durationMs =
        normalizedDurationMilliseconds(
          startedAt:
            startedAt,

          completedAt:
            completedAt
        )

      stateQueue.sync {
        encoderRunCount +=
          1

        lastRunCompletedAt =
          completedAt

        lastError =
          nil
      }

      return NativeONNXEncoderResult(
        outputs:
          parsedOutputs,

        primaryOutputName:
          primaryOutputName,

        startedAt:
          startedAt,

        completedAt:
          completedAt,

        durationMs:
          durationMs
      )
    } catch {
      recordRunFailure(
        error:
          error,

        cancellationToken:
          cancellationToken
      )

      throw error
    }

#else

    let runtimeError =
      NativeONNXSessionError
        .runtimeUnavailable

    recordRunFailure(
      error:
        runtimeError,

      cancellationToken:
        cancellationToken
    )

    throw runtimeError

#endif
  }

  /* =======================================================
   * Tensor shape validation
   * ===================================================== */

  private func validateTensorShape(
    _ shape:
      [NSNumber],

    elementCount:
      Int
  ) throws {
    guard
      !shape.isEmpty,
      elementCount >
        0
    else {
      throw NativeONNXSessionError
        .invalidTensorShape
    }

    var expectedElementCount =
      1

    for dimension in
      shape
    {
      let dimensionValue =
        dimension.intValue

      guard
        dimensionValue >
          0
      else {
        throw NativeONNXSessionError
          .invalidTensorShape
      }

      let multiplication =
        expectedElementCount
          .multipliedReportingOverflow(
            by:
              dimensionValue
          )

      guard
        !multiplication
          .overflow,
        multiplication
          .partialValue >
          0
      else {
        throw NativeONNXSessionError
          .invalidTensorShape
      }

      expectedElementCount =
        multiplication
          .partialValue
    }

    guard
      expectedElementCount ==
        elementCount
    else {
      throw NativeONNXSessionError
        .tensorElementCountMismatch(
          expected:
            expectedElementCount,

          received:
            elementCount
        )
    }
  }

  /* =======================================================
   * Float tensor data
   * ===================================================== */

#if canImport(onnxruntime_objc)

  private func createFloatTensorData(
    _ tensor:
      ContiguousArray<Float>
  ) throws ->
      NSMutableData {
    guard
      !tensor.isEmpty
    else {
      throw NativeONNXSessionError
        .invalidTensorShape
    }

    let byteCountResult =
      tensor.count
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
      throw NativeONNXSessionError
        .invalidTensorShape
    }

    let byteCount =
      byteCountResult
        .partialValue

    return try tensor
      .withUnsafeBufferPointer {
        buffer in

        guard
          let baseAddress =
            buffer
              .baseAddress
        else {
          throw NativeONNXSessionError
            .tensorCreationFailed(
              message:
                "The encoder tensor buffer is unavailable."
            )
        }

        return NSMutableData(
          bytes:
            baseAddress,

          length:
            byteCount
        )
      }
  }

#endif

  /* =======================================================
   * Encoder input-name resolution
   * ===================================================== */

  private func resolveEncoderInputName(
    _ inputNames:
      [String]
  ) -> String {
    let preferredNames =
      [
        "image",
        "images",
        "input_image",
        "pixel_values",
        "input",
        "x"
      ]

    for preferredName in
      preferredNames
    {
      if
        let exactMatch =
          inputNames
            .first(
              where: {
                $0
                  .lowercased() ==
                preferredName
              }
            )
      {
        return exactMatch
      }
    }

    for inputName in
      inputNames
    {
      let normalized =
        inputName
          .lowercased()

      if
        normalized.contains(
          "image"
        ) ||
        normalized.contains(
          "pixel"
        )
      {
        return inputName
      }
    }

    /*
     * initializeSynchronously ÙŠØ¶Ù…Ù† Ø£Ù† Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©
     * Ù„ÙŠØ³Øª ÙØ§Ø±ØºØ© Ù‚Ø¨Ù„ Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ù‡Ù†Ø§.
     */
    return inputNames[
      0
    ]
  }

  /* =======================================================
   * Encoder output-name resolution
   * ===================================================== */

  private func resolvePrimaryEncoderOutputName(
    availableOutputNames:
      [String]
  ) throws ->
      String {
    guard
      !availableOutputNames
        .isEmpty
    else {
      throw NativeONNXSessionError
        .missingInferenceOutputs(
          kind:
            .encoder
        )
    }

    let preferredNames =
      [
        "image_embeddings",
        "image_embedding",
        "embeddings",
        "embedding",
        "image_features",
        "features",
        "output"
      ]

    for preferredName in
      preferredNames
    {
      if
        let exactMatch =
          availableOutputNames
            .first(
              where: {
                $0
                  .lowercased() ==
                preferredName
              }
            )
      {
        return exactMatch
      }
    }

    if
      let embeddingOutput =
        availableOutputNames
          .first(
            where: {
              let normalized =
                $0
                  .lowercased()

              return normalized
                .contains(
                  "embed"
                ) ||
              normalized
                .contains(
                  "feature"
                )
            }
          )
    {
      return embeddingOutput
    }

    return availableOutputNames
      .sorted()[
        0
      ]
  }

  /* =======================================================
   * Generic output parsing
   * ===================================================== */

#if canImport(onnxruntime_objc)

  private func parseTensorOutputs(
    _ rawOutputs:
      [String: ORTValue],

    kind:
      NativeONNXModelKind,

    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      [String: NativeONNXTensorOutput] {
    var parsedOutputs:
      [String: NativeONNXTensorOutput] =
        [:]

    parsedOutputs
      .reserveCapacity(
        rawOutputs.count
      )

    for (
      outputName,
      outputValue
    ) in rawOutputs
    {
      try cancellationToken
        .throwIfCancelled()

      let typeAndShape:
        ORTTensorTypeAndShapeInfo

      do {
        typeAndShape =
          try outputValue
            .tensorTypeAndShapeInfo()
      } catch {
        throw NativeONNXSessionError
          .outputInspectionFailed(
            kind:
              kind,

            outputName:
              outputName,

            message:
              error.localizedDescription
          )
      }

      let normalizedShape =
        typeAndShape
          .shape
          .map {
            $0.int64Value
          }

      try validateOutputShape(
        normalizedShape,

        kind:
          kind,

        outputName:
          outputName
      )

      parsedOutputs[
        outputName
      ] =
        NativeONNXTensorOutput(
          name:
            outputName,

          value:
            outputValue,

          shape:
            typeAndShape.shape,

          elementType:
            typeAndShape
              .elementType
        )
    }

    return parsedOutputs
  }

#endif

  /* =======================================================
   * Output shape validation
   * ===================================================== */

  private func validateOutputShape(
    _ shape:
      [Int64],

    kind:
      NativeONNXModelKind,

    outputName:
      String
  ) throws {
    guard
      !shape.isEmpty
    else {
      throw NativeONNXSessionError
        .invalidOutputShape(
          kind:
            kind,

          outputName:
            outputName,

          shape:
            shape
        )
    }

    var elementCount:
      Int64 =
        1

    for dimension in
      shape
    {
      guard
        dimension >
          0
      else {
        throw NativeONNXSessionError
          .invalidOutputShape(
            kind:
              kind,

            outputName:
              outputName,

            shape:
              shape
          )
      }

      let multiplication =
        elementCount
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
        throw NativeONNXSessionError
          .invalidOutputShape(
            kind:
              kind,

            outputName:
              outputName,

            shape:
              shape
          )
      }

      elementCount =
        multiplication
          .partialValue
    }
  }

  /* =======================================================
   * Duration
   * ===================================================== */

  private func normalizedDurationMilliseconds(
    startedAt:
      NativeProcessingTimestamp,

    completedAt:
      NativeProcessingTimestamp
  ) -> Int64 {
    /*
     * NativeProcessingTimestamp ÙÙŠ Ø§Ù„Ø¹Ù‚ÙˆØ¯ Ø§Ù„Ø­Ø§Ù„ÙŠØ©
     * ÙŠØ³ØªØ®Ø¯Ù… milliseconds Ù…Ù†Ø° epoch.
     */
    let duration =
      completedAt -
      startedAt

    guard
      duration >
        0
    else {
      return 0
    }

    return Int64(
      duration
    )
  }

  /* =======================================================
   * Run failure diagnostics
   * ===================================================== */

  private func recordRunFailure(
    error:
      Error,

    cancellationToken:
      NativeScanCancellationToken
  ) {
    let cancelled =
      cancellationToken
        .isCancelled ||
      error is
        CancellationError ||
      isCancellationError(
        error
      )

    stateQueue.sync {
      if
        cancelled
      {
        cancelledRunCount +=
          1
      } else {
        failedRunCount +=
          1
      }

      lastRunCompletedAt =
        NativeProcessingTime.now()

      lastError =
        error.localizedDescription
    }
  }

  /* =======================================================
   * Cancellation classification
   * ===================================================== */

  private func isCancellationError(
    _ error:
      Error
  ) -> Bool {
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
   * Decoder execution
   * ===================================================== */

#if canImport(onnxruntime_objc)

  func runDecoder(
    inputs:
      [String: ORTValue],

    requestedOutputNames:
      Set<String>? =
        nil,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeONNXDecoderResult {
    try cancellationToken
      .throwIfCancelled()

    return try await withCheckedThrowingContinuation {
      continuation in

      inferenceQueue.async {
        do {
          let result =
            try self
              .runDecoderSynchronously(
                inputs:
                  inputs,

                requestedOutputNames:
                  requestedOutputNames,

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
    }
  }

  /* =======================================================
   * Synchronous decoder execution
   * ===================================================== */

  private func runDecoderSynchronously(
    inputs:
      [String: ORTValue],

    requestedOutputNames:
      Set<String>?,

    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      NativeONNXDecoderResult {
    try cancellationToken
      .throwIfCancelled()

    let requiresInitialization =
      stateQueue.sync {
        !initialized
      }

    if
      requiresInitialization
    {
      /*
       * Ù†Ø­Ù† Ø¨Ø§Ù„ÙØ¹Ù„ Ø¯Ø§Ø®Ù„ inferenceQueue.
       *
       * Ù„Ø°Ù„Ùƒ Ù†Ø³ØªØ¯Ø¹ÙŠ Ø§Ù„ØªÙ‡ÙŠØ¦Ø© Ø§Ù„Ù…ØªØ²Ø§Ù…Ù†Ø© Ù…Ø¨Ø§Ø´Ø±Ø©
       * Ù„ØªØ¬Ù†Ø¨ Ø¥Ø¹Ø§Ø¯Ø© Ø¥Ø±Ø³Ø§Ù„ Ø¹Ù…Ù„ÙŠØ© Ø¥Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ù€Queue.
       */
      _ =
        try initializeSynchronously()
    }

    try cancellationToken
      .throwIfCancelled()

    let startedAt =
      NativeProcessingTime.now()

    stateQueue.sync {
      lastRunStartedAt =
        startedAt

      lastError =
        nil
    }

    let executionState:
      (
        session:
          ORTSession,

        declaredInputNames:
          [String],

        declaredOutputNames:
          [String]
      )

    do {
      executionState =
        try stateQueue.sync {
          try assertNotDisposedLocked()

          guard
            initialized
          else {
            throw NativeONNXSessionError
              .notInitialized
          }

          guard
            let decoderSession
          else {
            throw NativeONNXSessionError
              .sessionUnavailable(
                kind:
                  .decoder
              )
          }

          guard
            !decoderInputNamesStorage
              .isEmpty,
            !decoderOutputNamesStorage
              .isEmpty
          else {
            throw NativeONNXSessionError
              .invalidModelInterface(
                kind:
                  .decoder,

                inputNames:
                  decoderInputNamesStorage,

                outputNames:
                  decoderOutputNamesStorage
              )
          }

          return (
            session:
              decoderSession,

            declaredInputNames:
              decoderInputNamesStorage,

            declaredOutputNames:
              decoderOutputNamesStorage
          )
        }
    } catch {
      recordRunFailure(
        error:
          error,

        cancellationToken:
          cancellationToken
      )

      throw error
    }

    do {
      try validateDecoderInputs(
        inputs,

        declaredInputNames:
          executionState
            .declaredInputNames
      )

      let resolvedOutputNames =
        try resolveDecoderOutputNames(
          requestedOutputNames:
            requestedOutputNames,

          declaredOutputNames:
            executionState
              .declaredOutputNames
        )

      try cancellationToken
        .throwIfCancelled()

      let rawOutputs:
        [String: ORTValue]

      do {
        rawOutputs =
          try executionState
            .session
            .run(
              withInputs:
                inputs,

              outputNames:
                resolvedOutputNames,

              runOptions:
                nil
            )
      } catch {
        throw NativeONNXSessionError
          .inferenceFailed(
            kind:
              .decoder,

            message:
              error.localizedDescription
          )
      }

      try cancellationToken
        .throwIfCancelled()

      guard
        !rawOutputs.isEmpty
      else {
        throw NativeONNXSessionError
          .missingInferenceOutputs(
            kind:
              .decoder
          )
      }

      let parsedOutputs =
        try parseTensorOutputs(
          rawOutputs,

          kind:
            .decoder,

          cancellationToken:
            cancellationToken
        )

      let primaryMaskOutputName =
        try resolvePrimaryMaskOutputName(
          availableOutputNames:
            Array(
              parsedOutputs.keys
            )
        )

      guard
        parsedOutputs[
          primaryMaskOutputName
        ] !=
          nil
      else {
        throw NativeONNXSessionError
          .missingInferenceOutputs(
            kind:
              .decoder
          )
      }

      let scoreOutputName =
        resolveScoreOutputName(
          availableOutputNames:
            Array(
              parsedOutputs.keys
            ),

          excluding:
            primaryMaskOutputName
        )

      let completedAt =
        NativeProcessingTime.now()

      let durationMs =
        normalizedDurationMilliseconds(
          startedAt:
            startedAt,

          completedAt:
            completedAt
        )

      stateQueue.sync {
        decoderRunCount +=
          1

        lastRunCompletedAt =
          completedAt

        lastError =
          nil
      }

      return NativeONNXDecoderResult(
        outputs:
          parsedOutputs,

        primaryMaskOutputName:
          primaryMaskOutputName,

        scoreOutputName:
          scoreOutputName,

        startedAt:
          startedAt,

        completedAt:
          completedAt,

        durationMs:
          durationMs
      )
    } catch {
      recordRunFailure(
        error:
          error,

        cancellationToken:
          cancellationToken
      )

      throw error
    }
  }

  /* =======================================================
   * Decoder input validation
   * ===================================================== */

  private func validateDecoderInputs(
    _ inputs:
      [String: ORTValue],

    declaredInputNames:
      [String]
  ) throws {
    guard
      !inputs.isEmpty
    else {
      throw NativeONNXSessionError
        .missingDecoderInputs(
          requiredInputNames:
            declaredInputNames
        )
    }

    let suppliedNames =
      Set(
        inputs.keys
      )

    let declaredNames =
      Set(
        declaredInputNames
      )

    let missingNames =
      declaredNames
        .subtracting(
          suppliedNames
        )
        .sorted()

    guard
      missingNames.isEmpty
    else {
      throw NativeONNXSessionError
        .missingRequiredModelInputs(
          kind:
            .decoder,

          missingInputNames:
            missingNames,

          suppliedInputNames:
            suppliedNames
              .sorted()
        )
    }

    let unexpectedNames =
      suppliedNames
        .subtracting(
          declaredNames
        )
        .sorted()

    guard
      unexpectedNames.isEmpty
    else {
      throw NativeONNXSessionError
        .unexpectedModelInputs(
          kind:
            .decoder,

          unexpectedInputNames:
            unexpectedNames,

          declaredInputNames:
            declaredInputNames
        )
    }
  }

  /* =======================================================
   * Decoder output-name validation
   * ===================================================== */

  private func resolveDecoderOutputNames(
    requestedOutputNames:
      Set<String>?,

    declaredOutputNames:
      [String]
  ) throws ->
      Set<String> {
    let declaredNames =
      Set(
        declaredOutputNames
      )

    guard
      !declaredNames.isEmpty
    else {
      throw NativeONNXSessionError
        .invalidModelInterface(
          kind:
            .decoder,

          inputNames:
            decoderInputNamesStorage,

          outputNames:
            declaredOutputNames
        )
    }

    guard
      let requestedOutputNames
    else {
      return declaredNames
    }

    guard
      !requestedOutputNames.isEmpty
    else {
      throw NativeONNXSessionError
        .missingRequestedOutputs(
          kind:
            .decoder
        )
    }

    let unknownOutputNames =
      requestedOutputNames
        .subtracting(
          declaredNames
        )
        .sorted()

    guard
      unknownOutputNames.isEmpty
    else {
      throw NativeONNXSessionError
        .unknownRequestedOutputs(
          kind:
            .decoder,

          requestedOutputNames:
            unknownOutputNames,

          declaredOutputNames:
            declaredOutputNames
        )
    }

    return requestedOutputNames
  }

  /* =======================================================
   * Primary mask output
   * ===================================================== */

  private func resolvePrimaryMaskOutputName(
    availableOutputNames:
      [String]
  ) throws ->
      String {
    guard
      !availableOutputNames.isEmpty
    else {
      throw NativeONNXSessionError
        .missingInferenceOutputs(
          kind:
            .decoder
        )
    }

    let preferredNames =
      [
        "masks",
        "mask",
        "low_res_masks",
        "low_res_logits",
        "mask_logits",
        "output_masks",
        "output_mask"
      ]

    for preferredName in
      preferredNames
    {
      if
        let exactMatch =
          availableOutputNames
            .first(
              where: {
                $0
                  .lowercased() ==
                preferredName
              }
            )
      {
        return exactMatch
      }
    }

    if
      let maskOutput =
        availableOutputNames
          .first(
            where: {
              let normalized =
                $0
                  .lowercased()

              return normalized
                .contains(
                  "mask"
                ) ||
              normalized
                .contains(
                  "logit"
                )
            }
          )
    {
      return maskOutput
    }

    /*
     * Ø¨Ø¹Ø¶ Ù†Ø³Ø® EdgeSAM ØªØµØ¯Ø± Ø§Ø³Ù…Ù‹Ø§ Ø¹Ø§Ù…Ù‹Ø§ ÙÙ‚Ø·.
     * Ø¹Ù†Ø¯ ØºÙŠØ§Ø¨ Ø§Ø³Ù… ÙˆØ§Ø¶Ø­ Ù†Ø®ØªØ§Ø± Ø£ÙˆÙ„ Output Ø«Ø§Ø¨ØªÙ‹Ø§.
     */
    return availableOutputNames
      .sorted()[
        0
      ]
  }

  /* =======================================================
   * Score output
   * ===================================================== */

  private func resolveScoreOutputName(
    availableOutputNames:
      [String],

    excluding primaryOutputName:
      String
  ) -> String? {
    let candidates =
      availableOutputNames
        .filter {
          $0 !=
            primaryOutputName
        }

    guard
      !candidates.isEmpty
    else {
      return nil
    }

    let preferredNames =
      [
        "iou_predictions",
        "iou_prediction",
        "iou_scores",
        "iou_score",
        "scores",
        "score",
        "quality_scores",
        "quality_score"
      ]

    for preferredName in
      preferredNames
    {
      if
        let exactMatch =
          candidates
            .first(
              where: {
                $0
                  .lowercased() ==
                preferredName
              }
            )
      {
        return exactMatch
      }
    }

    return candidates
      .first(
        where: {
          let normalized =
            $0
              .lowercased()

          return normalized
            .contains(
              "iou"
            ) ||
          normalized
            .contains(
              "score"
            ) ||
          normalized
            .contains(
              "quality"
            )
        }
      )
  }

#endif

  /* =======================================================
   * Runtime-safe decoder fallback
   * ===================================================== */

#if !canImport(onnxruntime_objc)

  func runDecoder(
    inputs:
      [String: Any],

    requestedOutputNames:
      Set<String>? =
        nil,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeONNXDecoderResult {
    _ =
      inputs

    _ =
      requestedOutputNames

    try cancellationToken
      .throwIfCancelled()

    throw NativeONNXSessionError
      .runtimeUnavailable
  }

#endif

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

  var isEncoderReady:
    Bool {
    return stateQueue.sync {
      initialized &&
      !disposed &&
      isEncoderLoadedLocked()
    }
  }

  var isDecoderReady:
    Bool {
    return stateQueue.sync {
      initialized &&
      !disposed &&
      isDecoderLoadedLocked()
    }
  }

  /* =======================================================
   * Disposal
   * ===================================================== */

  func dispose() {
    /*
     * inferenceQueue Ù…Ø³Ù„Ø³Ù„ØŒ ÙˆÙ„Ø°Ù„Ùƒ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø± Ù‡Ù†Ø§ ÙŠØ¶Ù…Ù†
     * Ø¹Ø¯Ù… Ø¥Ø²Ø§Ù„Ø© Sessions Ø£Ø«Ù†Ø§Ø¡ Inference ØªØ¹Ù…Ù„ ÙØ¹Ù„ÙŠÙ‹Ø§.
     */
    inferenceQueue.sync {
      stateQueue.sync {
        guard
          !disposed
        else {
          return
        }

        disposed =
          true

        initialized =
          false

#if canImport(onnxruntime_objc)

        /*
         * ÙŠØ¬Ø¨ ØªØ­Ø±ÙŠØ± Sessions Ù‚Ø¨Ù„ Environment.
         */
        encoderSession =
          nil

        decoderSession =
          nil

        environment =
          nil

#endif

        encoderModelLocation =
          nil

        decoderModelLocation =
          nil

        encoderInputNamesStorage
          .removeAll(
            keepingCapacity:
              false
          )

        encoderOutputNamesStorage
          .removeAll(
            keepingCapacity:
              false
          )

        decoderInputNamesStorage
          .removeAll(
            keepingCapacity:
              false
          )

        decoderOutputNamesStorage
          .removeAll(
            keepingCapacity:
              false
          )

        lastError =
          nil
      }
    }
  }
}


