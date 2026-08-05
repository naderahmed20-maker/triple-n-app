//
// EdgeSamNativeEncoder.swift
//
// Triple N - Native EdgeSAM Encoder
//
// Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„ÙŠØ§Øª:
//
// 1) ØªØ´ØºÙŠÙ„ Encoder ONNX.
// 2) ØªØ­ÙˆÙŠÙ„ Tensor Ø§Ù„Ù€Preprocessor Ø¥Ù„Ù‰ ORTValue.
// 3) ØªØ´ØºÙŠÙ„ Session ÙˆØ§Ø­Ø¯Ø©.
// 4) Ø§Ø³ØªØ®Ø±Ø§Ø¬ Image Embedding.
// 5) Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Shape.
// 6) Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ù†ÙˆØ¹ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª.
// 7) Ø¥Ø¯Ø§Ø±Ø© ORTValue.
// 8) Ø¯Ø¹Ù… Cancellation.
// 9) Ø¥Ø®Ø±Ø§Ø¬ Embedding Ø¬Ø§Ù‡Ø²Ø© Ù„Ù„Ù€Decoder.
//

import Foundation
import onnxruntime_objc

// MARK: - Result

struct EdgeSamNativeEncoderResult:
  Sendable {

  let embedding:
    EdgeSamFloatTensor

  let width:
    Int

  let height:
    Int

  let channels:
    Int

  let durationMs:
    Int64

  let completedAt:
    NativeProcessingTimestamp
}

// MARK: - Encoder

final class EdgeSamNativeEncoder:
  @unchecked Sendable {

  private let sessionManager:
    EdgeSamNativeSessionManager

  init(
    sessionManager:
      EdgeSamNativeSessionManager
  ) {
    self.sessionManager =
      sessionManager
  }

// MARK: - Encoder execution

  func encode(
    preprocessing:
      EdgeSamNativePreprocessorResult,
    cancellationToken:
      NativeScanCancellationToken?
  ) async throws ->
      EdgeSamNativeEncoderResult {
    try cancellationToken?
      .throwIfCancelled()

    try Task
      .checkCancellation()

    let startedAt =
      NativeProcessingTime.now()

    let inputTensor =
      try preprocessing
        .encoderTensor
        .validated()

    try validateInputTensor(
      inputTensor
    )

    let embedding =
      try await sessionManager
        .withEncoderSession {
          session,
          resolvedNames in

          try cancellationToken?
            .throwIfCancelled()

          let inputValue =
            try inputTensor
              .createORTValue()

          let outputs:
            [String: ORTValue]

          do {
            outputs =
              try session.run(
                withInputs: [
                  resolvedNames
                    .encoderInput:
                    inputValue
                ],
                outputNames: Set(
                  [
                    resolvedNames
                      .encoderOutput
                  ]
                ),
                runOptions:
                  nil
              )
          } catch {
            throw EdgeSamNativeEncoderError
              .encoderExecutionFailed(
                message:
                  error.localizedDescription
              )
          }

          try cancellationToken?
            .throwIfCancelled()

          guard let outputValue =
                  outputs[
                    resolvedNames
                      .encoderOutput
                  ] else {
            throw EdgeSamNativeEncoderError
              .missingEncoderOutput(
                name:
                  resolvedNames
                    .encoderOutput
              )
          }

          return try self
            .readEmbeddingTensor(
              value:
                outputValue,
              name:
                resolvedNames
                  .encoderOutput
            )
        }

    try cancellationToken?
      .throwIfCancelled()

    try Task
      .checkCancellation()

    let dimensions =
      embedding
        .metadata
        .dimensions

    guard dimensions.count ==
            4 else {
      throw EdgeSamNativeEncoderError
        .unsupportedEmbeddingShape(
          dimensions
        )
    }

    guard dimensions[0] ==
            1 else {
      throw EdgeSamNativeEncoderError
        .unsupportedEmbeddingBatchSize(
          dimensions[0]
        )
    }

    let completedAt =
      NativeProcessingTime.now()

    return EdgeSamNativeEncoderResult(
      embedding:
        embedding,
      width:
        dimensions[3],
      height:
        dimensions[2],
      channels:
        dimensions[1],
      durationMs:
        max(
          0,
          completedAt -
          startedAt
        ),
      completedAt:
        completedAt
    )
  }

  // MARK: - Input validation

  private func validateInputTensor(
    _ tensor:
      EdgeSamFloatTensor
  ) throws {
    let dimensions =
      tensor
        .metadata
        .dimensions

    guard dimensions.count ==
            4 else {
      throw EdgeSamNativeEncoderError
        .invalidInputShape(
          dimensions
        )
    }

    guard dimensions[0] ==
            1,
          dimensions[1] ==
            3,
          dimensions[2] ==
            EdgeSamNativeConstants
              .modelInputHeight,
          dimensions[3] ==
            EdgeSamNativeConstants
              .modelInputWidth else {
      throw EdgeSamNativeEncoderError
        .invalidInputShape(
          dimensions
        )
    }

    guard tensor
            .metadata
            .elementType ==
            .float32 else {
      throw EdgeSamNativeEncoderError
        .invalidInputElementType
    }

    let expectedElementCount =
      try calculateElementCount(
        dimensions:
          dimensions,
        tensorName:
          tensor
            .metadata
            .name
      )

    guard tensor.values.count ==
            expectedElementCount else {
      throw EdgeSamNativeEncoderError
        .inputElementCountMismatch(
          expected:
            expectedElementCount,
          received:
            tensor.values.count
        )
    }

    for (
      index,
      value
    ) in tensor.values
      .enumerated() {
      guard value.isFinite else {
        throw EdgeSamNativeEncoderError
          .nonFiniteInputValue(
            index:
              index
          )
      }
    }
  }

  // MARK: - Read embedding

  private func readEmbeddingTensor(
    value:
      ORTValue,
    name:
      String
  ) throws ->
      EdgeSamFloatTensor {
    let typeAndShape =
      try value
        .tensorTypeAndShapeInfo()

    guard typeAndShape
            .elementType ==
            .float else {
      throw EdgeSamNativeEncoderError
        .unsupportedOutputElementType(
          name:
            name,
          received:
            typeAndShape
              .elementType
              .rawValue
        )
    }

    let dimensions =
      try normalizeShape(
        typeAndShape
          .shape,
        tensorName:
          name
      )

    guard dimensions.count ==
            4 else {
      throw EdgeSamNativeEncoderError
        .unsupportedEmbeddingShape(
          dimensions
        )
    }

    guard dimensions[0] ==
            1,
          dimensions[1] >
            0,
          dimensions[2] >
            0,
          dimensions[3] >
            0 else {
      throw EdgeSamNativeEncoderError
        .unsupportedEmbeddingShape(
          dimensions
        )
    }

    let elementCount =
      try calculateElementCount(
        dimensions:
          dimensions,
        tensorName:
          name
      )

    let expectedByteCountResult =
      elementCount
        .multipliedReportingOverflow(
          by:
            MemoryLayout<Float>
              .stride
        )

    guard !expectedByteCountResult
            .overflow else {
      throw EdgeSamNativeEncoderError
        .tensorByteCountOverflow(
          name:
            name
        )
    }

    let expectedByteCount =
      expectedByteCountResult
        .partialValue

    let tensorData =
      try value
        .tensorData()

    guard tensorData.length >=
            expectedByteCount else {
      throw EdgeSamNativeEncoderError
        .tensorDataTooSmall(
          name:
            name,
          expectedBytes:
            expectedByteCount,
          receivedBytes:
            tensorData.length
        )
    }

    var values =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          elementCount
      )

    values.withUnsafeMutableBytes {
      destinationBuffer in

      guard let destinationAddress =
              destinationBuffer
                .baseAddress else {
        return
      }

      memcpy(
        destinationAddress,
        tensorData.bytes,
        expectedByteCount
      )
    }

    for (
      index,
      element
    ) in values.enumerated() {
      guard element.isFinite else {
        throw EdgeSamNativeEncoderError
          .nonFiniteOutputValue(
            index:
              index
          )
      }
    }

    let metadata =
      try EdgeSamTensorMetadata(
        name:
          name,
        dimensions:
          dimensions,
        elementType:
          .float32,
        layout:
          .nchw
      )
      .validated()

    return try EdgeSamFloatTensor(
      metadata:
        metadata,
      values:
        values
    )
    .validated()
  }

  // MARK: - Shape helpers

  private func normalizeShape(
    _ shape:
      [NSNumber],
    tensorName:
      String
  ) throws ->
      [Int] {
    guard !shape.isEmpty else {
      throw EdgeSamNativeEncoderError
        .emptyTensorShape(
          name:
            tensorName
        )
    }

    var dimensions:
      [Int] =
        []

    dimensions.reserveCapacity(
      shape.count
    )

    for number in shape {
      let dimension =
        number.intValue

      guard dimension >
              0 else {
        throw EdgeSamNativeEncoderError
          .invalidTensorDimension(
            name:
              tensorName,
            dimension:
              dimension
          )
      }

      dimensions.append(
        dimension
      )
    }

    return dimensions
  }

  private func calculateElementCount(
    dimensions:
      [Int],
    tensorName:
      String
  ) throws ->
      Int {
    guard !dimensions.isEmpty else {
      throw EdgeSamNativeEncoderError
        .emptyTensorShape(
          name:
            tensorName
        )
    }

    var elementCount =
      1

    for dimension in dimensions {
      guard dimension >
              0 else {
        throw EdgeSamNativeEncoderError
          .invalidTensorDimension(
            name:
              tensorName,
            dimension:
              dimension
          )
      }

      let result =
        elementCount
          .multipliedReportingOverflow(
            by:
              dimension
          )

      guard !result.overflow else {
        throw EdgeSamNativeEncoderError
          .tensorElementCountOverflow(
            name:
              tensorName
          )
      }

      elementCount =
        result.partialValue
    }

    return elementCount
  }
  }

// MARK: - Encoder errors

enum EdgeSamNativeEncoderError:
  LocalizedError,
  Equatable,
  Sendable {

  case invalidInputShape(
    [Int]
  )

  case invalidInputElementType

  case inputElementCountMismatch(
    expected:
      Int,
    received:
      Int
  )

  case nonFiniteInputValue(
    index:
      Int
  )

  case encoderExecutionFailed(
    message:
      String
  )

  case missingEncoderOutput(
    name:
      String
  )

  case unsupportedOutputElementType(
    name:
      String,
    received:
      Int
  )

  case unsupportedEmbeddingShape(
    [Int]
  )

  case unsupportedEmbeddingBatchSize(
    Int
  )

  case emptyTensorShape(
    name:
      String
  )

  case invalidTensorDimension(
    name:
      String,
    dimension:
      Int
  )

  case tensorElementCountOverflow(
    name:
      String
  )

  case tensorByteCountOverflow(
    name:
      String
  )

  case tensorDataTooSmall(
    name:
      String,
    expectedBytes:
      Int,
    receivedBytes:
      Int
  )

  case nonFiniteOutputValue(
    index:
      Int
  )

  var errorDescription:
    String? {
    switch self {
    case .invalidInputShape(
      let shape
    ):
      return
        """
        EdgeSAM encoder expected an input tensor with shape [1, 3, 1024, 1024], but received \(shape).
        """

    case .invalidInputElementType:
      return
        """
        EdgeSAM encoder input tensor must use Float32 values.
        """

    case .inputElementCountMismatch(
      let expected,
      let received
    ):
      return
        """
        EdgeSAM encoder input tensor expected \(expected) elements but received \(received).
        """

    case .nonFiniteInputValue(
      let index
    ):
      return
        """
        EdgeSAM encoder input contains a non-finite value at index \(index).
        """

    case .encoderExecutionFailed(
      let message
    ):
      return
        """
        EdgeSAM encoder inference failed: \(message)
        """

    case .missingEncoderOutput(
      let name
    ):
      return
        """
        EdgeSAM encoder output \(name) is missing.
        """

    case .unsupportedOutputElementType(
      let name,
      let received
    ):
      return
        """
        EdgeSAM encoder output \(name) has unsupported tensor element type \(received). Float32 is required.
        """

    case .unsupportedEmbeddingShape(
      let shape
    ):
      return
        """
        EdgeSAM encoder returned an unsupported embedding shape: \(shape).
        """

    case .unsupportedEmbeddingBatchSize(
      let batchSize
    ):
      return
        """
        EdgeSAM encoder embedding batch size must be one. Received \(batchSize).
        """

    case .emptyTensorShape(
      let name
    ):
      return
        """
        EdgeSAM tensor \(name) has an empty shape.
        """

    case .invalidTensorDimension(
      let name,
      let dimension
    ):
      return
        """
        EdgeSAM tensor \(name) contains an invalid dimension: \(dimension).
        """

    case .tensorElementCountOverflow(
      let name
    ):
      return
        """
        EdgeSAM tensor \(name) element count overflowed.
        """

    case .tensorByteCountOverflow(
      let name
    ):
      return
        """
        EdgeSAM tensor \(name) byte count overflowed.
        """

    case .tensorDataTooSmall(
      let name,
      let expectedBytes,
      let receivedBytes
    ):
      return
        """
        EdgeSAM tensor \(name) expected at least \(expectedBytes) bytes but received \(receivedBytes).
        """

    case .nonFiniteOutputValue(
      let index
    ):
      return
        """
        EdgeSAM encoder output contains a non-finite value at index \(index).
        """
    }
  }
}
