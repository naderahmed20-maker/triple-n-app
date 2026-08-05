//
// EdgeSamNativeSessionManager.swift
//
// Triple N - Native EdgeSAM ONNX Session Manager
//
// Ù…Ø³Ø¤ÙˆÙ„ÙŠØ§Øª Ù‡Ø°Ø§ Ø§Ù„Ù…Ù„Ù:
//
// 1) Ø§ÙƒØªØ´Ø§Ù Ù…Ù„ÙØ§Øª Encoder ÙˆDecoder Ø¯Ø§Ø®Ù„ Bundle.
// 2) Ø¥Ù†Ø´Ø§Ø¡ ORTEnv ÙˆØ§Ø­Ø¯Ø© Ù…Ø´ØªØ±ÙƒØ©.
// 3) Ø¥Ù†Ø´Ø§Ø¡ Encoder ÙˆDecoder Sessions.
// 4) ØªÙØ¹ÙŠÙ„ CoreML Execution Provider Ø¹Ù†Ø¯ ØªÙˆÙØ±Ù‡.
// 5) Ø§Ù„Ø§Ø­ØªÙØ§Ø¸ Ø¨Ø§Ù„Ù€Sessions ÙˆØ¥Ø¹Ø§Ø¯Ø© Ø§Ø³ØªØ®Ø¯Ø§Ù…Ù‡Ø§.
// 6) Ù…Ù†Ø¹ ØªØ´ØºÙŠÙ„ Inference Ù…ØªØ²Ø§Ù…Ù† ØºÙŠØ± Ø¢Ù…Ù†.
// 7) ÙØ­Øµ Ø£Ø³Ù…Ø§Ø¡ Inputs ÙˆOutputs Ø§Ù„ÙØ¹Ù„ÙŠØ©.
// 8) ØªØ´ØºÙŠÙ„ Encoder ÙˆØ¥Ø±Ø¬Ø§Ø¹ Embedding.
// 9) ØªÙˆÙÙŠØ± Decoder Session Ù„Ù„Ù…Ù„Ù Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„ Ø¹Ù† Decoder.
// 10) ØªØ­Ø±ÙŠØ± ÙƒÙ„ Ù…ÙˆØ§Ø±Ø¯ ONNX Ø¹Ù†Ø¯ dispose.
//
// Ù‡Ø°Ø§ Ø§Ù„Ù…Ù„Ù Ù„Ø§ ÙŠØ¨Ù†ÙŠ Prompts.
// Ù‡Ø°Ø§ Ø§Ù„Ù…Ù„Ù Ù„Ø§ ÙŠØ®ØªØ§Ø± Ø£ÙØ¶Ù„ Mask.
// Ù‡Ø°Ø§ Ø§Ù„Ù…Ù„Ù Ù„Ø§ ÙŠØ¹Ø§Ù„Ø¬ Ø£Ùˆ ÙŠØµØ¯Ø± PNG.
//

import Foundation
import onnxruntime_objc

// MARK: - Session role

enum EdgeSamNativeSessionRole:
  String,
  Codable,
  Equatable,
  Sendable {

  case encoder

  case decoder
}

// MARK: - Execution provider

enum EdgeSamNativeExecutionProvider:
  String,
  Codable,
  Equatable,
  Sendable {

  case coreML =
    "coreml"

  case cpu =
    "cpu"
}

// MARK: - Model resource

struct EdgeSamNativeModelResource:
  Equatable,
  Sendable {

  let role:
    EdgeSamNativeSessionRole

  let fileName:
    String

  let fileExtension:
    String

  let subdirectory:
    String?

  init(
    role:
      EdgeSamNativeSessionRole,
    fileName:
      String,
    fileExtension:
      String =
        "onnx",
    subdirectory:
      String? =
        nil
  ) {
    self.role =
      role

    self.fileName =
      fileName

    self.fileExtension =
      fileExtension

    self.subdirectory =
      subdirectory
  }

  func validated()
    throws ->
      EdgeSamNativeModelResource {
    let normalizedFileName =
      fileName
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedFileName.isEmpty else {
      throw EdgeSamNativeSessionManagerError
        .missingModelFileName(
          role:
            role
        )
    }

    let normalizedExtension =
      fileExtension
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )
        .replacingOccurrences(
          of:
            ".",
          with:
            ""
        )

    guard !normalizedExtension.isEmpty else {
      throw EdgeSamNativeSessionManagerError
        .missingModelFileExtension(
          role:
            role
        )
    }

    let normalizedSubdirectory:
      String?

    if let subdirectory {
      let value =
        subdirectory
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      normalizedSubdirectory =
        value.isEmpty
          ? nil
          : value
    } else {
      normalizedSubdirectory =
        nil
    }

    return EdgeSamNativeModelResource(
      role:
        role,
      fileName:
        normalizedFileName,
      fileExtension:
        normalizedExtension,
      subdirectory:
        normalizedSubdirectory
    )
  }

  var displayName:
    String {
    "\(fileName).\(fileExtension)"
  }
}

// MARK: - Session configuration

struct EdgeSamNativeSessionConfiguration:
  Equatable,
  Sendable {

  let encoderResource:
    EdgeSamNativeModelResource

  let decoderResource:
    EdgeSamNativeModelResource

  let preferCoreML:
    Bool

  let requireCoreML:
    Bool

  let allowCPUFallback:
    Bool

  let intraOpThreadCount:
    Int32

  let graphOptimizationLevel:
    ORTGraphOptimizationLevel

  let logSeverity:
    ORTLoggingLevel

  let encoderInputNameCandidates:
    [String]

  let encoderOutputNameCandidates:
    [String]

  let decoderImageEmbeddingInputNameCandidates:
    [String]

  let decoderPointCoordinatesInputNameCandidates:
    [String]

  let decoderPointLabelsInputNameCandidates:
    [String]

  let decoderMaskInputNameCandidates:
    [String]

  let decoderHasMaskInputNameCandidates:
    [String]

  let decoderOriginalImageSizeInputNameCandidates:
    [String]

  let decoderMaskOutputNameCandidates:
    [String]

  let decoderIOUOutputNameCandidates:
    [String]

  let decoderLowResolutionMaskOutputNameCandidates:
    [String]

  init(
    encoderResource:
      EdgeSamNativeModelResource =
        EdgeSamNativeModelResource(
          role:
            .encoder,
          fileName:
            "edge_sam_3x_encoder",
          fileExtension:
            "onnx",
          subdirectory:
            "models"
        ),
    decoderResource:
      EdgeSamNativeModelResource =
        EdgeSamNativeModelResource(
          role:
            .decoder,
          fileName:
            "edge_sam_3x_decoder",
          fileExtension:
            "onnx",
          subdirectory:
            "models"
        ),
    preferCoreML:
      Bool =
        true,
    requireCoreML:
      Bool =
        false,
    allowCPUFallback:
      Bool =
        true,
    intraOpThreadCount:
      Int32 =
        1,
    graphOptimizationLevel:
      ORTGraphOptimizationLevel =
        .all,
    logSeverity:
      ORTLoggingLevel =
        .warning,
    encoderInputNameCandidates:
      [String] =
        [
          "images",
          "image",
          "input_image",
          "input"
        ],
    encoderOutputNameCandidates:
      [String] =
        [
          "image_embeddings",
          "image_embedding",
          "embeddings",
          "output"
        ],
    decoderImageEmbeddingInputNameCandidates:
      [String] =
        [
          "image_embeddings",
          "image_embedding"
        ],
    decoderPointCoordinatesInputNameCandidates:
      [String] =
        [
          "point_coords",
          "point_coordinates"
        ],
    decoderPointLabelsInputNameCandidates:
      [String] =
        [
          "point_labels",
          "labels"
        ],
    decoderMaskInputNameCandidates:
      [String] =
        [
          "mask_input",
          "mask_inputs"
        ],
    decoderHasMaskInputNameCandidates:
      [String] =
        [
          "has_mask_input",
          "has_mask"
        ],
    decoderOriginalImageSizeInputNameCandidates:
      [String] =
        [
          "orig_im_size",
          "original_image_size"
        ],
    decoderMaskOutputNameCandidates:
      [String] =
        [
          "masks",
          "mask"
        ],
    decoderIOUOutputNameCandidates:
      [String] =
        [
          "iou_predictions",
          "iou_prediction",
          "scores"
        ],
    decoderLowResolutionMaskOutputNameCandidates:
      [String] =
        [
          "low_res_masks",
          "low_resolution_masks"
        ]
  ) {
    self.encoderResource =
      encoderResource

    self.decoderResource =
      decoderResource

    self.preferCoreML =
      preferCoreML

    self.requireCoreML =
      requireCoreML

    self.allowCPUFallback =
      allowCPUFallback

    self.intraOpThreadCount =
      intraOpThreadCount

    self.graphOptimizationLevel =
      graphOptimizationLevel

    self.logSeverity =
      logSeverity

    self.encoderInputNameCandidates =
      encoderInputNameCandidates

    self.encoderOutputNameCandidates =
      encoderOutputNameCandidates

    self.decoderImageEmbeddingInputNameCandidates =
      decoderImageEmbeddingInputNameCandidates

    self.decoderPointCoordinatesInputNameCandidates =
      decoderPointCoordinatesInputNameCandidates

    self.decoderPointLabelsInputNameCandidates =
      decoderPointLabelsInputNameCandidates

    self.decoderMaskInputNameCandidates =
      decoderMaskInputNameCandidates

    self.decoderHasMaskInputNameCandidates =
      decoderHasMaskInputNameCandidates

    self.decoderOriginalImageSizeInputNameCandidates =
      decoderOriginalImageSizeInputNameCandidates

    self.decoderMaskOutputNameCandidates =
      decoderMaskOutputNameCandidates

    self.decoderIOUOutputNameCandidates =
      decoderIOUOutputNameCandidates

    self.decoderLowResolutionMaskOutputNameCandidates =
      decoderLowResolutionMaskOutputNameCandidates
  }

  func validated()
    throws ->
      EdgeSamNativeSessionConfiguration {
    let validatedEncoderResource =
      try encoderResource
        .validated()

    let validatedDecoderResource =
      try decoderResource
        .validated()

    guard intraOpThreadCount >=
            0 else {
      throw EdgeSamNativeSessionManagerError
        .invalidThreadCount(
          count:
            intraOpThreadCount
        )
    }

    guard !requireCoreML ||
            preferCoreML else {
      throw EdgeSamNativeSessionManagerError
        .invalidExecutionProviderConfiguration
    }

    guard allowCPUFallback ||
            preferCoreML else {
      throw EdgeSamNativeSessionManagerError
        .invalidExecutionProviderConfiguration
    }

    return EdgeSamNativeSessionConfiguration(
      encoderResource:
        validatedEncoderResource,
      decoderResource:
        validatedDecoderResource,
      preferCoreML:
        preferCoreML,
      requireCoreML:
        requireCoreML,
      allowCPUFallback:
        allowCPUFallback,
      intraOpThreadCount:
        intraOpThreadCount,
      graphOptimizationLevel:
        graphOptimizationLevel,
      logSeverity:
        logSeverity,
      encoderInputNameCandidates:
        try normalizeNameCandidates(
          encoderInputNameCandidates,
          field:
            "encoderInputNameCandidates"
        ),
      encoderOutputNameCandidates:
        try normalizeNameCandidates(
          encoderOutputNameCandidates,
          field:
            "encoderOutputNameCandidates"
        ),
      decoderImageEmbeddingInputNameCandidates:
        try normalizeNameCandidates(
          decoderImageEmbeddingInputNameCandidates,
          field:
            "decoderImageEmbeddingInputNameCandidates"
        ),
      decoderPointCoordinatesInputNameCandidates:
        try normalizeNameCandidates(
          decoderPointCoordinatesInputNameCandidates,
          field:
            "decoderPointCoordinatesInputNameCandidates"
        ),
      decoderPointLabelsInputNameCandidates:
        try normalizeNameCandidates(
          decoderPointLabelsInputNameCandidates,
          field:
            "decoderPointLabelsInputNameCandidates"
        ),
      decoderMaskInputNameCandidates:
        try normalizeNameCandidates(
          decoderMaskInputNameCandidates,
          field:
            "decoderMaskInputNameCandidates"
        ),
      decoderHasMaskInputNameCandidates:
        try normalizeNameCandidates(
          decoderHasMaskInputNameCandidates,
          field:
            "decoderHasMaskInputNameCandidates"
        ),
      decoderOriginalImageSizeInputNameCandidates:
        try normalizeNameCandidates(
          decoderOriginalImageSizeInputNameCandidates,
          field:
            "decoderOriginalImageSizeInputNameCandidates"
        ),
      decoderMaskOutputNameCandidates:
        try normalizeNameCandidates(
          decoderMaskOutputNameCandidates,
          field:
            "decoderMaskOutputNameCandidates"
        ),
      decoderIOUOutputNameCandidates:
        try normalizeNameCandidates(
          decoderIOUOutputNameCandidates,
          field:
            "decoderIOUOutputNameCandidates"
        ),
      decoderLowResolutionMaskOutputNameCandidates:
        normalizeOptionalNameCandidates(
          decoderLowResolutionMaskOutputNameCandidates
        )
    )
  }

  private func normalizeNameCandidates(
    _ values:
      [String],
    field:
      String
  ) throws ->
      [String] {
    let normalized =
      normalizeOptionalNameCandidates(
        values
      )

    guard !normalized.isEmpty else {
      throw EdgeSamNativeSessionManagerError
        .emptyNameCandidates(
          field:
            field
        )
    }

    return normalized
  }

  private func normalizeOptionalNameCandidates(
    _ values:
      [String]
  ) -> [String] {
    var seen =
      Set<String>()

    var result:
      [String] =
        []

    result.reserveCapacity(
      values.count
    )

    for value in values {
      let normalized =
        value
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      guard !normalized.isEmpty,
            !seen.contains(
              normalized
            ) else {
        continue
      }

      seen.insert(
        normalized
      )

      result.append(
        normalized
      )
    }

    return result
  }
}

// MARK: - Resolved model paths

struct EdgeSamNativeResolvedModelPaths:
  Equatable,
  Sendable {

  let encoderURL:
    URL

  let decoderURL:
    URL
}

// MARK: - Resolved session names

struct EdgeSamNativeResolvedSessionNames:
  Equatable,
  Sendable {

  let encoderInput:
    String

  let encoderOutput:
    String

  let decoderImageEmbeddingInput:
    String

  let decoderPointCoordinatesInput:
    String

  let decoderPointLabelsInput:
    String

  let decoderMaskInput:
    String

  let decoderHasMaskInput:
    String

  let decoderOriginalImageSizeInput:
    String

  let decoderMaskOutput:
    String

  let decoderIOUOutput:
    String

  let decoderLowResolutionMaskOutput:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "encoderInput":
        encoderInput,

      "encoderOutput":
        encoderOutput,

      "decoderImageEmbeddingInput":
        decoderImageEmbeddingInput,

      "decoderPointCoordinatesInput":
        decoderPointCoordinatesInput,

      "decoderPointLabelsInput":
        decoderPointLabelsInput,

      "decoderMaskInput":
        decoderMaskInput,

      "decoderHasMaskInput":
        decoderHasMaskInput,

      "decoderOriginalImageSizeInput":
        decoderOriginalImageSizeInput,

      "decoderMaskOutput":
        decoderMaskOutput,

      "decoderIOUOutput":
        decoderIOUOutput,

      "decoderLowResolutionMaskOutput":
        decoderLowResolutionMaskOutput ??
        NSNull()
    ]
  }
}

// MARK: - Loaded session container

private final class EdgeSamNativeLoadedSessions:
  @unchecked Sendable {

  let environment:
    ORTEnv

  let encoderSession:
    ORTSession

  let decoderSession:
    ORTSession

  let modelPaths:
    EdgeSamNativeResolvedModelPaths

  let resolvedNames:
    EdgeSamNativeResolvedSessionNames

  let executionProvider:
    EdgeSamNativeExecutionProvider

  let loadedAt:
    NativeProcessingTimestamp

  init(
    environment:
      ORTEnv,
    encoderSession:
      ORTSession,
    decoderSession:
      ORTSession,
    modelPaths:
      EdgeSamNativeResolvedModelPaths,
    resolvedNames:
      EdgeSamNativeResolvedSessionNames,
    executionProvider:
      EdgeSamNativeExecutionProvider,
    loadedAt:
      NativeProcessingTimestamp
  ) {
    self.environment =
      environment

    self.encoderSession =
      encoderSession

    self.decoderSession =
      decoderSession

    self.modelPaths =
      modelPaths

    self.resolvedNames =
      resolvedNames

    self.executionProvider =
      executionProvider

    self.loadedAt =
      loadedAt
  }
}

// MARK: - Manager diagnostics

struct EdgeSamNativeSessionManagerDiagnostics:
  Sendable {

  let initialized:
    Bool

  let disposed:
    Bool

  let loading:
    Bool

  let encoderLoaded:
    Bool

  let decoderLoaded:
    Bool

  let executionProvider:
    EdgeSamNativeExecutionProvider?

  let onnxRuntimeVersion:
    String?

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

  let loadCount:
    Int

  let encoderRunCount:
    Int

  let decoderRunCount:
    Int

  let failureCount:
    Int

  let cancellationCount:
    Int

  let loadedAt:
    NativeProcessingTimestamp?

  let lastEncoderStartedAt:
    NativeProcessingTimestamp?

  let lastEncoderCompletedAt:
    NativeProcessingTimestamp?

  let lastDecoderStartedAt:
    NativeProcessingTimestamp?

  let lastDecoderCompletedAt:
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

      "loading":
        loading,

      "encoderLoaded":
        encoderLoaded,

      "decoderLoaded":
        decoderLoaded,

      "executionProvider":
        executionProvider?
          .rawValue ??
        NSNull(),

      "onnxRuntimeVersion":
        onnxRuntimeVersion ??
        NSNull(),

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

      "loadCount":
        loadCount,

      "encoderRunCount":
        encoderRunCount,

      "decoderRunCount":
        decoderRunCount,

      "failureCount":
        failureCount,

      "cancellationCount":
        cancellationCount,

      "loadedAt":
        loadedAt ??
        NSNull(),

      "lastEncoderStartedAt":
        lastEncoderStartedAt ??
        NSNull(),

      "lastEncoderCompletedAt":
        lastEncoderCompletedAt ??
        NSNull(),

      "lastDecoderStartedAt":
        lastDecoderStartedAt ??
        NSNull(),

      "lastDecoderCompletedAt":
        lastDecoderCompletedAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull()
    ]
  }
}

// MARK: - Session manager

final class EdgeSamNativeSessionManager:
  @unchecked Sendable {

  // MARK: Dependencies

  private let configuration:
    EdgeSamNativeSessionConfiguration

  private let bundle:
    Bundle

  private let stateQueue:
    DispatchQueue

  private let inferenceQueue:
    DispatchQueue

  // MARK: Runtime state

  private var sessions:
    EdgeSamNativeLoadedSessions?

  private var initialized =
    false

  private var loading =
    false

  private var disposed =
    false

  private var loadCount =
    0

  private var encoderRunCount =
    0

  private var decoderRunCount =
    0

  private var failureCount =
    0

  private var cancellationCount =
    0

  private var encoderInputNames:
    [String] =
      []

  private var encoderOutputNames:
    [String] =
      []

  private var decoderInputNames:
    [String] =
      []

  private var decoderOutputNames:
    [String] =
      []

  private var loadedAt:
    NativeProcessingTimestamp?

  private var lastEncoderStartedAt:
    NativeProcessingTimestamp?

  private var lastEncoderCompletedAt:
    NativeProcessingTimestamp?

  private var lastDecoderStartedAt:
    NativeProcessingTimestamp?

  private var lastDecoderCompletedAt:
    NativeProcessingTimestamp?

  private var lastError:
    String?

  // MARK: Initialization

  init(
    configuration:
      EdgeSamNativeSessionConfiguration =
        EdgeSamNativeSessionConfiguration(),
    bundle:
      Bundle =
        .main
  ) throws {
    self.configuration =
      try configuration
        .validated()

    self.bundle =
      bundle

    self.stateQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.edgesam.session-manager.state",
        qos:
          .userInitiated
      )

    self.inferenceQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.edgesam.session-manager.inference",
        qos:
          .userInitiated
      )
  }

  // MARK: Public state

  var isInitialized:
    Bool {
    stateQueue.sync {
      initialized &&
      sessions !=
        nil &&
      !disposed
    }
  }

  var isDisposed:
    Bool {
    stateQueue.sync {
      disposed
    }
  }

  var resolvedNames:
    EdgeSamNativeResolvedSessionNames? {
    stateQueue.sync {
      sessions?
        .resolvedNames
    }
  }

  var activeExecutionProvider:
    EdgeSamNativeExecutionProvider? {
    stateQueue.sync {
      sessions?
        .executionProvider
    }
  }

  func diagnostics()
    -> EdgeSamNativeSessionManagerDiagnostics {
    stateQueue.sync {
      EdgeSamNativeSessionManagerDiagnostics(
        initialized:
          initialized,
        disposed:
          disposed,
        loading:
          loading,
        encoderLoaded:
          sessions?
            .encoderSession !=
            nil,
        decoderLoaded:
          sessions?
            .decoderSession !=
            nil,
        executionProvider:
          sessions?
            .executionProvider,
        onnxRuntimeVersion:
          ORTVersion(),
        encoderModelPath:
          sessions?
            .modelPaths
            .encoderURL
            .path,
        decoderModelPath:
          sessions?
            .modelPaths
            .decoderURL
            .path,
        encoderInputNames:
          encoderInputNames,
        encoderOutputNames:
          encoderOutputNames,
        decoderInputNames:
          decoderInputNames,
        decoderOutputNames:
          decoderOutputNames,
        loadCount:
          loadCount,
        encoderRunCount:
          encoderRunCount,
        decoderRunCount:
          decoderRunCount,
        failureCount:
          failureCount,
        cancellationCount:
          cancellationCount,
        loadedAt:
          loadedAt,
        lastEncoderStartedAt:
          lastEncoderStartedAt,
        lastEncoderCompletedAt:
          lastEncoderCompletedAt,
        lastDecoderStartedAt:
          lastDecoderStartedAt,
        lastDecoderCompletedAt:
          lastDecoderCompletedAt,
        lastError:
          lastError
      )
    }
  }
  // MARK: - Load sessions

  func initialize()
    async throws {
    try assertNotDisposed()

    let alreadyInitialized =
      stateQueue.sync {
        initialized &&
        sessions !=
          nil
      }

    if alreadyInitialized {
      return
    }

    let shouldLoad =
      stateQueue.sync {
        if loading {
          return false
        }

        loading =
          true

        lastError =
          nil

        return true
      }

    guard shouldLoad else {
      try await waitForLoadingToFinish()

      try assertSessionsAvailable()

      return
    }

    do {
      let loadedSessions =
        try await withCheckedThrowingContinuation {
          continuation in

          inferenceQueue.async {
            [weak self] in

            guard let self else {
              continuation.resume(
                throwing:
                  EdgeSamNativeSessionManagerError
                    .managerDeallocated
              )

              return
            }

            do {
              let result =
                try self
                  .loadSessionsSynchronously()

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

      stateQueue.sync {
        sessions =
          loadedSessions

        initialized =
          true

        loading =
          false

        loadCount +=
          1

        encoderInputNames =
          [
            loadedSessions
              .resolvedNames
              .encoderInput
          ]

        encoderOutputNames =
          [
            loadedSessions
              .resolvedNames
              .encoderOutput
          ]

        decoderInputNames =
          [
            loadedSessions
              .resolvedNames
              .decoderImageEmbeddingInput,

            loadedSessions
              .resolvedNames
              .decoderPointCoordinatesInput,

            loadedSessions
              .resolvedNames
              .decoderPointLabelsInput,

            loadedSessions
              .resolvedNames
              .decoderMaskInput,

            loadedSessions
              .resolvedNames
              .decoderHasMaskInput,

            loadedSessions
              .resolvedNames
              .decoderOriginalImageSizeInput
          ]

        var resolvedDecoderOutputNames =
          [
            loadedSessions
              .resolvedNames
              .decoderMaskOutput,

            loadedSessions
              .resolvedNames
              .decoderIOUOutput
          ]

        if let lowResolutionMaskOutput =
            loadedSessions
              .resolvedNames
              .decoderLowResolutionMaskOutput {
          resolvedDecoderOutputNames
            .append(
              lowResolutionMaskOutput
            )
        }

        decoderOutputNames =
          resolvedDecoderOutputNames

        loadedAt =
          loadedSessions
            .loadedAt

        lastError =
          nil
      }
    } catch {
      stateQueue.sync {
        sessions =
          nil

        initialized =
          false

        loading =
          false

        failureCount +=
          1

        lastError =
          error.localizedDescription
      }

      throw EdgeSamNativeSessionManagerError
        .sessionInitializationFailed(
          message:
            error.localizedDescription
        )
    }
  }

  // MARK: - Ensure sessions

  func ensureInitialized()
    async throws {
    try assertNotDisposed()

    if isInitialized {
      return
    }

    try await initialize()
  }

  private func waitForLoadingToFinish()
    async throws {
    while true {
      try Task
        .checkCancellation()

      try assertNotDisposed()

      let currentState =
        stateQueue.sync {
          (
            loading:
              loading,

            initialized:
              initialized,

            hasSessions:
              sessions !=
                nil,

            error:
              lastError
          )
        }

      if !currentState.loading {
        if currentState.initialized,
           currentState.hasSessions {
          return
        }

        throw EdgeSamNativeSessionManagerError
          .sessionInitializationFailed(
            message:
              currentState.error ??
              "EdgeSAM ONNX sessions were not loaded."
          )
      }

      try await Task.sleep(
        nanoseconds:
          10_000_000
      )
    }
  }

  // MARK: - Synchronous session creation

  private func loadSessionsSynchronously()
    throws ->
      EdgeSamNativeLoadedSessions {
    try assertNotDisposed()

    let modelPaths =
      try resolveModelPaths()

    let environment =
      try ORTEnv(
        loggingLevel:
          configuration
            .logSeverity
      )

    let providerResult =
      try createSessionOptions()

    let encoderSession:
      ORTSession

    do {
      encoderSession =
        try ORTSession(
          env:
            environment,
          modelPath:
            modelPaths
              .encoderURL
              .path,
          sessionOptions:
            providerResult
              .options
        )
    } catch {
      throw EdgeSamNativeSessionManagerError
        .modelSessionCreationFailed(
          role:
            .encoder,
          path:
            modelPaths
              .encoderURL
              .path,
          message:
            error.localizedDescription
        )
    }

    let decoderSession:
      ORTSession

    do {
      decoderSession =
        try ORTSession(
          env:
            environment,
          modelPath:
            modelPaths
              .decoderURL
              .path,
          sessionOptions:
            providerResult
              .options
        )
    } catch {
      throw EdgeSamNativeSessionManagerError
        .modelSessionCreationFailed(
          role:
            .decoder,
          path:
            modelPaths
              .decoderURL
              .path,
          message:
            error.localizedDescription
        )
    }

    let discoveredEncoderInputNames =
      try encoderSession
        .inputNames()

    let discoveredEncoderOutputNames =
      try encoderSession
        .outputNames()

    let discoveredDecoderInputNames =
      try decoderSession
        .inputNames()

    let discoveredDecoderOutputNames =
      try decoderSession
        .outputNames()

    let resolvedNames =
      try resolveSessionNames(
        encoderInputNames:
          discoveredEncoderInputNames,
        encoderOutputNames:
          discoveredEncoderOutputNames,
        decoderInputNames:
          discoveredDecoderInputNames,
        decoderOutputNames:
          discoveredDecoderOutputNames
      )

    stateQueue.sync {
      encoderInputNames =
        discoveredEncoderInputNames

      encoderOutputNames =
        discoveredEncoderOutputNames

      decoderInputNames =
        discoveredDecoderInputNames

      decoderOutputNames =
        discoveredDecoderOutputNames
    }

    return EdgeSamNativeLoadedSessions(
      environment:
        environment,
      encoderSession:
        encoderSession,
      decoderSession:
        decoderSession,
      modelPaths:
        modelPaths,
      resolvedNames:
        resolvedNames,
      executionProvider:
        providerResult
          .provider,
      loadedAt:
        NativeProcessingTime.now()
    )
  }

  // MARK: - Session options

  private func createSessionOptions()
    throws ->
      (
        options:
          ORTSessionOptions,
        provider:
          EdgeSamNativeExecutionProvider
      ) {
    let options =
      try ORTSessionOptions()

    try options
      .setGraphOptimizationLevel(
        configuration
          .graphOptimizationLevel
      )

    try options
      .setLogSeverityLevel(
        configuration
          .logSeverity
      )

    try options
      .setLogID(
        "TripleN-EdgeSAM"
      )

    if configuration
        .intraOpThreadCount >
        0 {
      try options
        .setIntraOpNumThreads(
          configuration
            .intraOpThreadCount
        )
    }

    guard configuration
            .preferCoreML else {
      guard configuration
              .allowCPUFallback else {
        throw EdgeSamNativeSessionManagerError
          .noExecutionProviderAvailable
      }

      return (
        options:
          options,
        provider:
          .cpu
      )
    }

    let coreMLAvailable =
      ORTIsCoreMLExecutionProviderAvailable()

    if coreMLAvailable {
      do {
        try options
          .appendCoreMLExecutionProvider(
            withOptionsV2: [
              "MLComputeUnits":
                "All",

              "ModelFormat":
                "MLProgram",

              "RequireStaticInputShapes":
                "0",

              "EnableOnSubgraphs":
                "0"
            ]
          )

        return (
          options:
            options,
          provider:
            .coreML
        )
      } catch {
        if configuration
            .requireCoreML {
          throw EdgeSamNativeSessionManagerError
            .coreMLConfigurationFailed(
              message:
                error.localizedDescription
            )
        }

        guard configuration
                .allowCPUFallback else {
          throw EdgeSamNativeSessionManagerError
            .coreMLConfigurationFailed(
              message:
                error.localizedDescription
            )
        }

        return (
          options:
            options,
          provider:
            .cpu
        )
      }
    }

    if configuration
        .requireCoreML {
      throw EdgeSamNativeSessionManagerError
        .coreMLUnavailable
    }

    guard configuration
            .allowCPUFallback else {
      throw EdgeSamNativeSessionManagerError
        .noExecutionProviderAvailable
    }

    return (
      options:
        options,
      provider:
        .cpu
    )
  }

  // MARK: - Resolve model paths

  private func resolveModelPaths()
    throws ->
      EdgeSamNativeResolvedModelPaths {
    let encoderURL =
      try resolveModelURL(
        resource:
          configuration
            .encoderResource
      )

    let decoderURL =
      try resolveModelURL(
        resource:
          configuration
            .decoderResource
      )

    return EdgeSamNativeResolvedModelPaths(
      encoderURL:
        encoderURL,
      decoderURL:
        decoderURL
    )
  }

  private func resolveModelURL(
    resource:
      EdgeSamNativeModelResource
  ) throws ->
      URL {
    let validatedResource =
      try resource
        .validated()

    var searchedBundles:
      [Bundle] =
        [
          bundle,
          Bundle.main,
          Bundle(
            for:
              EdgeSamNativeSessionManager
                .self
          )
        ]

    var uniqueBundles:
      [Bundle] =
        []

    var seenBundlePaths =
      Set<String>()

    for candidateBundle in searchedBundles {
      let bundlePath =
        candidateBundle
          .bundleURL
          .path

      guard !seenBundlePaths
              .contains(
                bundlePath
              ) else {
        continue
      }

      seenBundlePaths
        .insert(
          bundlePath
        )

      uniqueBundles
        .append(
          candidateBundle
        )
    }

    searchedBundles =
      uniqueBundles

    for candidateBundle in searchedBundles {
      if let modelURL =
          candidateBundle.url(
            forResource:
              validatedResource
                .fileName,
            withExtension:
              validatedResource
                .fileExtension,
            subdirectory:
              validatedResource
                .subdirectory
          ) {
        return try validateModelURL(
          modelURL,
          resource:
            validatedResource
        )
      }

      if let modelURL =
          candidateBundle.url(
            forResource:
              validatedResource
                .fileName,
            withExtension:
              validatedResource
                .fileExtension
          ) {
        return try validateModelURL(
          modelURL,
          resource:
            validatedResource
        )
      }
    }

    let directCandidates =
      createDirectModelCandidates(
        resource:
          validatedResource,
        bundles:
          searchedBundles
      )

    for candidateURL in directCandidates {
      if FileManager.default
          .fileExists(
            atPath:
              candidateURL.path
          ) {
        return try validateModelURL(
          candidateURL,
          resource:
            validatedResource
        )
      }
    }

    throw EdgeSamNativeSessionManagerError
      .modelResourceNotFound(
        role:
          validatedResource.role,
        fileName:
          validatedResource.displayName,
        subdirectory:
          validatedResource.subdirectory
      )
  }

  private func createDirectModelCandidates(
    resource:
      EdgeSamNativeModelResource,
    bundles:
      [Bundle]
  ) -> [URL] {
    var result:
      [URL] =
        []

    let fullFileName =
      resource
        .displayName

    for candidateBundle in bundles {
      let resourceRoot =
        candidateBundle
          .resourceURL ??
        candidateBundle
          .bundleURL

      result.append(
        resourceRoot
          .appendingPathComponent(
            fullFileName,
            isDirectory:
              false
          )
      )

      if let subdirectory =
          resource
            .subdirectory {
        result.append(
          resourceRoot
            .appendingPathComponent(
              subdirectory,
              isDirectory:
                true
            )
            .appendingPathComponent(
              fullFileName,
              isDirectory:
                false
            )
        )
      }

      result.append(
        resourceRoot
          .appendingPathComponent(
            "models",
            isDirectory:
              true
          )
          .appendingPathComponent(
            fullFileName,
            isDirectory:
              false
          )
      )
    }

    return result
  }

  private func validateModelURL(
    _ modelURL:
      URL,
    resource:
      EdgeSamNativeModelResource
  ) throws ->
      URL {
    let fileManager =
      FileManager.default

    guard fileManager
            .fileExists(
              atPath:
                modelURL.path
            ) else {
      throw EdgeSamNativeSessionManagerError
        .modelResourceNotFound(
          role:
            resource.role,
          fileName:
            resource.displayName,
          subdirectory:
            resource.subdirectory
        )
    }

    guard fileManager
            .isReadableFile(
              atPath:
                modelURL.path
            ) else {
      throw EdgeSamNativeSessionManagerError
        .modelResourceNotReadable(
          role:
            resource.role,
          path:
            modelURL.path
        )
    }

    let attributes =
      try fileManager
        .attributesOfItem(
          atPath:
            modelURL.path
        )

    let fileSizeBytes =
      (
        attributes[
          .size
        ] as? NSNumber
      )?
      .int64Value ??
      0

    guard fileSizeBytes >
            0 else {
      throw EdgeSamNativeSessionManagerError
        .modelResourceEmpty(
          role:
            resource.role,
          path:
            modelURL.path
        )
    }

    return modelURL
  }
  // MARK: - Resolve model input and output names

  private func resolveSessionNames(
  encoderInputNames:
    [String],
  encoderOutputNames:
    [String],
  decoderInputNames:
    [String],
  decoderOutputNames:
    [String]
) throws ->
    EdgeSamNativeResolvedSessionNames {

  let encoderInput =
    try resolveRequiredName(
      candidates:
        configuration
          .encoderInputNameCandidates,
      available:
        encoderInputNames,
      role:
        "encoder input"
    )

  let encoderOutput =
    try resolveRequiredName(
      candidates:
        configuration
          .encoderOutputNameCandidates,
      available:
        encoderOutputNames,
      role:
        "encoder output"
    )

  let imageEmbeddings =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderImageEmbeddingInputNameCandidates,
      available:
        decoderInputNames,
      role:
        "decoder image embeddings"
    )

  let pointCoordinates =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderPointCoordinatesInputNameCandidates,
      available:
        decoderInputNames,
      role:
        "decoder point coordinates"
    )

  let pointLabels =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderPointLabelsInputNameCandidates,
      available:
        decoderInputNames,
      role:
        "decoder point labels"
    )

  let maskInput =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderMaskInputNameCandidates,
      available:
        decoderInputNames,
      role:
        "decoder mask input"
    )

  let hasMaskInput =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderHasMaskInputNameCandidates,
      available:
        decoderInputNames,
      role:
        "decoder has mask input"
    )

  let originalImageSize =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderOriginalImageSizeInputNameCandidates,
      available:
        decoderInputNames,
      role:
        "decoder original image size"
    )

  let masks =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderMaskOutputNameCandidates,
      available:
        decoderOutputNames,
      role:
        "decoder masks"
    )

  let iou =
    try resolveRequiredName(
      candidates:
        configuration
          .decoderIOUOutputNameCandidates,
      available:
        decoderOutputNames,
      role:
        "decoder iou"
    )

  let lowRes =
    resolveOptionalName(
      candidates:
        configuration
          .decoderLowResolutionMaskOutputNameCandidates,
      available:
        decoderOutputNames
    )

  return EdgeSamNativeResolvedSessionNames(
    encoderInput:
      encoderInput,
    encoderOutput:
      encoderOutput,
    decoderImageEmbeddingInput:
      imageEmbeddings,
    decoderPointCoordinatesInput:
      pointCoordinates,
    decoderPointLabelsInput:
      pointLabels,
    decoderMaskInput:
      maskInput,
    decoderHasMaskInput:
      hasMaskInput,
    decoderOriginalImageSizeInput:
      originalImageSize,
    decoderMaskOutput:
      masks,
    decoderIOUOutput:
      iou,
    decoderLowResolutionMaskOutput:
      lowRes
  )
}

  private func resolveRequiredName(
    candidates: [String],
    available: [String],
    role: String
  ) throws -> String {

    for candidate in candidates {
      if let match =
        available.first(
          where: {
            $0.caseInsensitiveCompare(candidate) == .orderedSame
          }
        ) {
        return match
      }
    }

    if let first = available.first {
      return first
    }

    throw EdgeSamNativeSessionManagerError
      .missingModelInputOrOutput(
        role: role
      )
  }

  private func resolveOptionalName(
    candidates: [String],
    available: [String]
  ) -> String? {

    for candidate in candidates {
      if let match =
        available.first(
          where: {
            $0.caseInsensitiveCompare(candidate) == .orderedSame
          }
        ) {
        return match
      }
    }

    return nil
  }

  // MARK: - Accessors

  func encoderSession() throws -> ORTSession {
    try assertSessionsAvailable()
    return stateQueue.sync {
      sessions!.encoderSession
    }
  }

  func decoderSession() throws -> ORTSession {
    try assertSessionsAvailable()
    return stateQueue.sync {
      sessions!.decoderSession
    }
  }

 func requireResolvedNames()
  throws -> EdgeSamNativeResolvedSessionNames {
    try assertSessionsAvailable()
    return stateQueue.sync {
      sessions!.resolvedNames
    }
  }

  func executionProvider()
    throws -> EdgeSamNativeExecutionProvider {
    try assertSessionsAvailable()
    return stateQueue.sync {
      sessions!.executionProvider
    }
  }

  func modelPaths()
    throws -> EdgeSamNativeResolvedModelPaths {
    try assertSessionsAvailable()
    return stateQueue.sync {
      sessions!.modelPaths
    }
  }
// MARK: - Session access execution

  func withEncoderSession<Result>(
    _ operation:
      (
        ORTSession,
        EdgeSamNativeResolvedSessionNames
      ) throws ->
        Result
  ) async throws ->
      Result {
    try await ensureInitialized()
    try Task.checkCancellation()

    return try await withCheckedThrowingContinuation {
      continuation in

      inferenceQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              EdgeSamNativeSessionManagerError
                .managerDeallocated
          )

          return
        }

        do {
          try self.assertNotDisposed()
          try Task.checkCancellation()

          let loadedSessions =
            try self.requireSessions()

          self.stateQueue.sync {
            self.lastEncoderStartedAt =
              NativeProcessingTime.now()
          }

          let result =
            try operation(
              loadedSessions
                .encoderSession,
              loadedSessions
                .resolvedNames
            )

          self.stateQueue.sync {
            self.encoderRunCount +=
              1

            self.lastEncoderCompletedAt =
              NativeProcessingTime.now()

            self.lastError =
              nil
          }

          continuation.resume(
            returning:
              result
          )
        } catch {
          self.recordInferenceFailure(
            error,
            role:
              .encoder
          )

          continuation.resume(
            throwing:
              error
          )
        }
      }
    }
  }

  func withDecoderSession<Result>(
    _ operation:
      (
        ORTSession,
        EdgeSamNativeResolvedSessionNames
      ) throws ->
        Result
  ) async throws ->
      Result {
    try await ensureInitialized()
    try Task.checkCancellation()

    return try await withCheckedThrowingContinuation {
      continuation in

      inferenceQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              EdgeSamNativeSessionManagerError
                .managerDeallocated
          )

          return
        }

        do {
          try self.assertNotDisposed()
          try Task.checkCancellation()

          let loadedSessions =
            try self.requireSessions()

          self.stateQueue.sync {
            self.lastDecoderStartedAt =
              NativeProcessingTime.now()
          }

          let result =
            try operation(
              loadedSessions
                .decoderSession,
              loadedSessions
                .resolvedNames
            )

          self.stateQueue.sync {
            self.decoderRunCount +=
              1

            self.lastDecoderCompletedAt =
              NativeProcessingTime.now()

            self.lastError =
              nil
          }

          continuation.resume(
            returning:
              result
          )
        } catch {
          self.recordInferenceFailure(
            error,
            role:
              .decoder
          )

          continuation.resume(
            throwing:
              error
          )
        }
      }
    }
  }

  // MARK: - Session guards

  private func requireSessions()
    throws ->
      EdgeSamNativeLoadedSessions {
    try stateQueue.sync {
      try assertNotDisposedLocked()

      guard initialized,
            let sessions else {
        throw EdgeSamNativeSessionManagerError
          .sessionsUnavailable
      }

      return sessions
    }
  }

  private func assertSessionsAvailable()
    throws {
    _ =
      try requireSessions()
  }

  private func assertNotDisposed()
    throws {
    try stateQueue.sync {
      try assertNotDisposedLocked()
    }
  }

  private func assertNotDisposedLocked()
    throws {
    guard !disposed else {
      throw EdgeSamNativeSessionManagerError
        .disposed
    }
  }

  // MARK: - Failure recording

  private func recordInferenceFailure(
    _ error:
      Error,
    role:
      EdgeSamNativeSessionRole
  ) {
    stateQueue.sync {
      if error is
          CancellationError {
        cancellationCount +=
          1
      } else {
        failureCount +=
          1
      }

      switch role {
      case .encoder:
        lastEncoderCompletedAt =
          NativeProcessingTime.now()

      case .decoder:
        lastDecoderCompletedAt =
          NativeProcessingTime.now()
      }

      lastError =
        error.localizedDescription
    }
  }

  // MARK: - Unload

  func unload()
    throws {
    try stateQueue.sync {
      try assertNotDisposedLocked()

      guard !loading else {
        throw EdgeSamNativeSessionManagerError
          .cannotUnloadWhileLoading
      }

      sessions =
        nil

      initialized =
        false

      encoderInputNames
        .removeAll(
          keepingCapacity:
            false
        )

      encoderOutputNames
        .removeAll(
          keepingCapacity:
            false
        )

      decoderInputNames
        .removeAll(
          keepingCapacity:
            false
        )

      decoderOutputNames
        .removeAll(
          keepingCapacity:
            false
        )

      loadedAt =
        nil

      lastError =
        nil
    }
  }

  // MARK: - Dispose

  func dispose() {
    stateQueue.sync {
      guard !disposed else {
        return
      }

      disposed =
        true

      initialized =
        false

      loading =
        false

      sessions =
        nil

      encoderInputNames
        .removeAll(
          keepingCapacity:
            false
        )

      encoderOutputNames
        .removeAll(
          keepingCapacity:
            false
        )

      decoderInputNames
        .removeAll(
          keepingCapacity:
            false
        )

      decoderOutputNames
        .removeAll(
          keepingCapacity:
            false
        )

      loadedAt =
        nil
    }
  }
}

// MARK: - Session manager errors

enum EdgeSamNativeSessionManagerError:
  LocalizedError,
  Equatable,
  Sendable {

  case managerDeallocated

  case disposed

  case sessionsUnavailable

  case cannotUnloadWhileLoading

  case missingModelFileName(
    role:
      EdgeSamNativeSessionRole
  )

  case missingModelFileExtension(
    role:
      EdgeSamNativeSessionRole
  )

  case invalidThreadCount(
    count:
      Int32
  )

  case invalidExecutionProviderConfiguration

  case emptyNameCandidates(
    field:
      String
  )

  case sessionInitializationFailed(
    message:
      String
  )

  case modelResourceNotFound(
    role:
      EdgeSamNativeSessionRole,
    fileName:
      String,
    subdirectory:
      String?
  )

  case modelResourceNotReadable(
    role:
      EdgeSamNativeSessionRole,
    path:
      String
  )

  case modelResourceEmpty(
    role:
      EdgeSamNativeSessionRole,
    path:
      String
  )

  case modelSessionCreationFailed(
    role:
      EdgeSamNativeSessionRole,
    path:
      String,
    message:
      String
  )

  case missingModelInputOrOutput(
    role:
      String
  )

  case coreMLUnavailable

  case coreMLConfigurationFailed(
    message:
      String
  )

  case noExecutionProviderAvailable

  var errorDescription:
    String? {
    switch self {
    case .managerDeallocated:
      return
        """
        EdgeSAM session manager was released before the operation completed.
        """

    case .disposed:
      return
        """
        EdgeSAM session manager has been disposed.
        """

    case .sessionsUnavailable:
      return
        """
        EdgeSAM encoder and decoder sessions are unavailable.
        """

    case .cannotUnloadWhileLoading:
      return
        """
        EdgeSAM sessions cannot be unloaded while model loading is active.
        """

    case .missingModelFileName(
      let role
    ):
      return
        """
        EdgeSAM \(role.rawValue) model file name is missing.
        """

    case .missingModelFileExtension(
      let role
    ):
      return
        """
        EdgeSAM \(role.rawValue) model file extension is missing.
        """

    case .invalidThreadCount(
      let count
    ):
      return
        """
        EdgeSAM ONNX Runtime thread count is invalid: \(count).
        """

    case .invalidExecutionProviderConfiguration:
      return
        """
        EdgeSAM execution-provider configuration is invalid.
        """

    case .emptyNameCandidates(
      let field
    ):
      return
        """
        EdgeSAM session configuration requires at least one name in \(field).
        """

    case .sessionInitializationFailed(
      let message
    ):
      return
        """
        EdgeSAM ONNX sessions could not be initialized: \(message)
        """

    case .modelResourceNotFound(
      let role,
      let fileName,
      let subdirectory
    ):
      if let subdirectory {
        return
          """
          EdgeSAM \(role.rawValue) model \(fileName) was not found in \(subdirectory).
          """
      }

      return
        """
        EdgeSAM \(role.rawValue) model \(fileName) was not found.
        """

    case .modelResourceNotReadable(
      let role,
      let path
    ):
      return
        """
        EdgeSAM \(role.rawValue) model is not readable at \(path).
        """

    case .modelResourceEmpty(
      let role,
      let path
    ):
      return
        """
        EdgeSAM \(role.rawValue) model is empty at \(path).
        """

    case .modelSessionCreationFailed(
      let role,
      let path,
      let message
    ):
      return
        """
        EdgeSAM \(role.rawValue) session could not be created from \(path): \(message)
        """

    case .missingModelInputOrOutput(
      let role
    ):
      return
        """
        EdgeSAM could not resolve the required \(role) name.
        """

    case .coreMLUnavailable:
      return
        """
        EdgeSAM requires CoreML, but the CoreML execution provider is unavailable.
        """

    case .coreMLConfigurationFailed(
      let message
    ):
      return
        """
        EdgeSAM could not configure the CoreML execution provider: \(message)
        """

    case .noExecutionProviderAvailable:
      return
        """
        EdgeSAM has no permitted ONNX Runtime execution provider.
        """
    }
  }
}
