//
// EdgeSamNativeDecoder.swift
//
// Triple N
// EdgeSAM Native Decoder
//

import Foundation
import CoreGraphics
import onnxruntime_objc

// MARK: - Decoder

final class EdgeSamNativeDecoder {

  private let sessionManager:
    EdgeSamNativeSessionManager

  init(
    sessionManager:
      EdgeSamNativeSessionManager
  ) {
    self.sessionManager =
      sessionManager
  }

  func decode(
    imageEmbedding:
      EdgeSamFloatTensor,
    prompts:
      EdgeSamDecoderPromptTensors
  ) throws ->
    EdgeSamDecoderRawOutput {

    let decoderSession =
    try sessionManager.decoderSession()

let names =
    try sessionManager.requireResolvedNames()

let inputValues =
    try createInputs(
        embedding: imageEmbedding,
        prompts: prompts,
        names: names
    )

let outputs =
    try runDecoder(
        session: decoderSession,
        inputs: inputValues
    )

return try parseOutputs(
  outputs,
  names:
    names
)
  }

  // MARK: Inputs

 private func createInputs(
    embedding: EdgeSamFloatTensor,
    prompts: EdgeSamDecoderPromptTensors,
    names: EdgeSamNativeResolvedSessionNames
) throws -> [String: ORTValue]

    var values:
      [String: ORTValue] =
      [:]

    values[names.decoderImageEmbeddingInput] =
      try embedding
        .createORTValue()

    values[names.decoderPointCoordinatesInput] =
      try prompts
        .pointCoordinates
        .createORTValue()

    values[names.decoderPointLabelsInput] =
      try prompts
        .pointLabels
        .createORTValue()

    values[names.decoderMaskInput] =
      try prompts
        .maskInput
        .createORTValue()

    values[names.decoderHasMaskInput] =
      try prompts
        .hasMaskInput
        .createORTValue()

    values[names.decoderOriginalImageSizeInput] =
      try prompts
        .originalImageSize
        .createORTValue()

    return values
  }

  // MARK: Decoder execution

  private func runDecoder(
    session:
      ORTSession,
    inputs:
      [String: ORTValue]
  ) throws ->
      [String: ORTValue] {

    let outputNames =
      try session
        .outputNames()

    return try session.run(
      withInputs:
        inputs,
      outputNames:
        Set(outputNames),
      runOptions:
        nil
    )
  }

// MARK: - Output parsing

  private func parseOutputs(
    _ outputs:
      [String: ORTValue],
    names:
      EdgeSamNativeResolvedSessionNames
  ) throws ->
      EdgeSamDecoderRawOutput {
    guard let masksValue =
            outputs[
              names.decoderMaskOutput
            ] else {
      throw EdgeSamNativeDecoderError
        .missingOutput(
          name:
            names.decoderMaskOutput
        )
    }

    guard let iouValue =
            outputs[
              names.decoderIOUOutput
            ] else {
      throw EdgeSamNativeDecoderError
        .missingOutput(
          name:
            names.decoderIOUOutput
        )
    }

    let masksTensor =
      try readFloatTensor(
        value:
          masksValue,
        name:
          names.decoderMaskOutput,
        layout:
          .nchw
      )

    let iouTensor =
      try readFloatTensor(
        value:
          iouValue,
        name:
          names.decoderIOUOutput,
        layout:
          .unknown
      )

    let lowResolutionMasks:
      EdgeSamFloatTensor?

    if let lowResolutionName =
        names
          .decoderLowResolutionMaskOutput,
       let lowResolutionValue =
         outputs[
           lowResolutionName
         ] {
      lowResolutionMasks =
        try readFloatTensor(
          value:
            lowResolutionValue,
          name:
            lowResolutionName,
          layout:
            .nchw
        )
    } else {
      lowResolutionMasks =
        nil
    }

    let maskDimensions =
      masksTensor
        .metadata
        .dimensions

    guard maskDimensions.count >=
            3 else {
      throw EdgeSamNativeDecoderError
        .unsupportedMaskShape(
          shape:
            maskDimensions
        )
    }

    let maskWidth =
      maskDimensions[
        maskDimensions.count -
        1
      ]

    let maskHeight =
      maskDimensions[
        maskDimensions.count -
        2
      ]

    guard maskWidth >
            0,
          maskHeight >
            0 else {
      throw EdgeSamNativeDecoderError
        .invalidMaskDimensions(
          width:
            maskWidth,
          height:
            maskHeight
        )
    }

    let maskPixelCountResult =
      maskWidth
        .multipliedReportingOverflow(
          by:
            maskHeight
        )

    guard !maskPixelCountResult
            .overflow,
          maskPixelCountResult
            .partialValue >
            0 else {
      throw EdgeSamNativeDecoderError
        .unsafeMaskPixelCount
    }

    let maskPixelCount =
      maskPixelCountResult
        .partialValue

    guard masksTensor
            .values
            .count %
            maskPixelCount ==
            0 else {
      throw EdgeSamNativeDecoderError
        .maskElementCountMismatch(
          maskElementCount:
            masksTensor
              .values
              .count,
          maskWidth:
            maskWidth,
          maskHeight:
            maskHeight
        )
    }

    let candidateCount =
      masksTensor
        .values
        .count /
      maskPixelCount

    guard candidateCount >
            0 else {
      throw EdgeSamNativeDecoderError
        .invalidCandidateCount(
          candidateCount
        )
    }

    guard iouTensor
            .values
            .count >=
            candidateCount else {
      throw EdgeSamNativeDecoderError
        .iouElementCountMismatch(
          expectedMinimum:
            candidateCount,
          received:
            iouTensor
              .values
              .count
        )
    }

    return try EdgeSamDecoderRawOutput(
      masks:
        masksTensor,
      iouPredictions:
        iouTensor,
      lowResolutionMasks:
        lowResolutionMasks,
      candidateCount:
        candidateCount,
      maskWidth:
        maskWidth,
      maskHeight:
        maskHeight,
      createdAt:
        NativeProcessingTime.now()
    )
    .validated()
  }

  // MARK: - ORT tensor reading

  private func readFloatTensor(
    value:
      ORTValue,
    name:
      String,
    layout:
      EdgeSamTensorLayout
  ) throws ->
      EdgeSamFloatTensor {
    let typeAndShape =
      try value
        .tensorTypeAndShapeInfo()

    guard typeAndShape.elementType ==
            .float else {
      throw EdgeSamNativeDecoderError
        .unsupportedOutputElementType(
          name:
            name,
         received:
  Int(
    typeAndShape
      .elementType
      .rawValue
  )
        )
    }

    let dimensions =
      try normalizeShape(
        typeAndShape
          .shape,
        name:
          name
      )

    let expectedElementCount =
      try calculateElementCount(
        dimensions:
          dimensions,
        name:
          name
      )

    let tensorData =
      try value
        .tensorData()

    let expectedByteCountResult =
      expectedElementCount
        .multipliedReportingOverflow(
          by:
            MemoryLayout<Float>
              .stride
        )

    guard !expectedByteCountResult
            .overflow else {
      throw EdgeSamNativeDecoderError
        .tensorByteCountOverflow(
          name:
            name
        )
    }

    let expectedByteCount =
      expectedByteCountResult
        .partialValue

    guard tensorData.length >=
            expectedByteCount else {
      throw EdgeSamNativeDecoderError
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
          expectedElementCount
      )

    values
      .withUnsafeMutableBytes {
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

    let metadata =
      try EdgeSamTensorMetadata(
        name:
          name,
        dimensions:
          dimensions,
        elementType:
          .float32,
        layout:
          layout
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
    name:
      String
  ) throws ->
      [Int] {
    guard !shape.isEmpty else {
      throw EdgeSamNativeDecoderError
        .emptyTensorShape(
          name:
            name
        )
    }

    var dimensions:
      [Int] =
        []

    dimensions.reserveCapacity(
      shape.count
    )

    for value in shape {
      let dimension =
        value.intValue

      guard dimension >
              0 else {
        throw EdgeSamNativeDecoderError
          .invalidTensorDimension(
            name:
              name,
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
    name:
      String
  ) throws ->
      Int {
    var result =
      1

    for dimension in dimensions {
      let multiplication =
        result
          .multipliedReportingOverflow(
            by:
              dimension
          )

      guard !multiplication
              .overflow else {
        throw EdgeSamNativeDecoderError
          .tensorElementCountOverflow(
            name:
              name
          )
      }

      result =
        multiplication
          .partialValue
    }

    guard result >
            0 else {
      throw EdgeSamNativeDecoderError
        .emptyTensor(
          name:
            name
        )
    }

    return result
  }
  // MARK: - ORT value creation

  private func createORTValue(
    from tensor:
      EdgeSamFloatTensor
  ) throws ->
      ORTValue {
    try tensor
      .createORTValue()
  }
}

// MARK: - EdgeSamFloatTensor ORT conversion

extension EdgeSamFloatTensor {

  func createORTValue()
    throws ->
      ORTValue {
    let validatedTensor =
      try validated()

    let dimensions =
      validatedTensor
        .metadata
        .dimensions

    guard !dimensions.isEmpty else {
      throw EdgeSamNativeDecoderError
        .emptyTensorShape(
          name:
            validatedTensor
              .metadata
              .name
        )
    }

    let shape =
      dimensions.map {
        NSNumber(
          value:
            $0
        )
      }

    let expectedElementCount =
      try Self.calculateElementCount(
        dimensions:
          dimensions,
        tensorName:
          validatedTensor
            .metadata
            .name
      )

    guard validatedTensor
            .values
            .count ==
            expectedElementCount else {
      throw EdgeSamNativeDecoderError
        .inputTensorElementCountMismatch(
          name:
            validatedTensor
              .metadata
              .name,
          expected:
            expectedElementCount,
          received:
            validatedTensor
              .values
              .count
        )
    }

    let byteCountResult =
      expectedElementCount
        .multipliedReportingOverflow(
          by:
            MemoryLayout<Float>
              .stride
        )

    guard !byteCountResult
            .overflow,
          byteCountResult
            .partialValue >
            0 else {
      throw EdgeSamNativeDecoderError
        .tensorByteCountOverflow(
          name:
            validatedTensor
              .metadata
              .name
        )
    }

    let tensorData =
      NSMutableData(
        length:
          byteCountResult
            .partialValue
      )

   let destinationAddress =
  tensorData
    .mutableBytes

    validatedTensor
      .values
      .withUnsafeBufferPointer {
        sourceBuffer in

        guard let sourceAddress =
                sourceBuffer
                  .baseAddress else {
          return
        }

        memcpy(
          destinationAddress,
          sourceAddress,
          byteCountResult
            .partialValue
        )
      }

    do {
      return try ORTValue(
        tensorData:
          tensorData,
        elementType:
          .float,
        shape:
          shape
      )
    } catch {
      throw EdgeSamNativeDecoderError
        .ortValueCreationFailed(
          name:
            validatedTensor
              .metadata
              .name,
          message:
            error.localizedDescription
        )
    }
  }

  private static func calculateElementCount(
    dimensions:
      [Int],
    tensorName:
      String
  ) throws ->
      Int {
    var result =
      1

    for dimension in dimensions {
      guard dimension >
              0 else {
        throw EdgeSamNativeDecoderError
          .invalidTensorDimension(
            name:
              tensorName,
            dimension:
              dimension
          )
      }

      let multiplication =
        result
          .multipliedReportingOverflow(
            by:
              dimension
          )

      guard !multiplication
              .overflow else {
        throw EdgeSamNativeDecoderError
          .tensorElementCountOverflow(
            name:
              tensorName
          )
      }

      result =
        multiplication
          .partialValue
    }

    guard result >
            0 else {
      throw EdgeSamNativeDecoderError
        .emptyTensor(
          name:
            tensorName
        )
    }

    return result
  }
}

// MARK: - Decoder errors

enum EdgeSamNativeDecoderError:
  LocalizedError,
  Equatable,
  Sendable {

  case missingOutput(
    name:
      String
  )

  case unsupportedMaskShape(
    shape:
      [Int]
  )

  case invalidMaskDimensions(
    width:
      Int,
    height:
      Int
  )

  case unsafeMaskPixelCount

  case invalidCandidateCount(
    Int
  )

  case maskElementCountMismatch(
    maskElementCount:
      Int,
    maskWidth:
      Int,
    maskHeight:
      Int
  )

  case iouElementCountMismatch(
    expectedMinimum:
      Int,
    received:
      Int
  )

  case unsupportedOutputElementType(
    name:
      String,
    received:
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

  case emptyTensor(
    name:
      String
  )

  case inputTensorElementCountMismatch(
    name:
      String,
    expected:
      Int,
    received:
      Int
  )

  case tensorBufferAllocationFailed(
    name:
      String
  )

  case ortValueCreationFailed(
    name:
      String,
    message:
      String
  )

  case decoderExecutionFailed(
    message:
      String
  )

  var errorDescription:
    String? {
    switch self {
    case .missingOutput(
      let name
    ):
      return
        """
        EdgeSAM decoder output \(name) is missing.
        """

    case .unsupportedMaskShape(
      let shape
    ):
      return
        """
        EdgeSAM decoder returned an unsupported mask shape: \(shape).
        """

    case .invalidMaskDimensions(
      let width,
      let height
    ):
      return
        """
        EdgeSAM decoder returned invalid mask dimensions: \(width)x\(height).
        """

    case .unsafeMaskPixelCount:
      return
        """
        EdgeSAM decoder mask pixel count is unsafe.
        """

    case .invalidCandidateCount(
      let count
    ):
      return
        """
        EdgeSAM decoder candidate count is invalid: \(count).
        """

    case .maskElementCountMismatch(
      let maskElementCount,
      let maskWidth,
      let maskHeight
    ):
      return
        """
        EdgeSAM decoder mask element count \(maskElementCount) is incompatible with mask size \(maskWidth)x\(maskHeight).
        """

    case .iouElementCountMismatch(
      let expectedMinimum,
      let received
    ):
      return
        """
        EdgeSAM decoder expected at least \(expectedMinimum) IoU values but received \(received).
        """

    case .unsupportedOutputElementType(
      let name,
      let received
    ):
      return
        """
        EdgeSAM decoder output \(name) has unsupported tensor element type \(received). Float32 is required.
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
        EdgeSAM tensor \(name) data is too small. Expected at least \(expectedBytes) bytes, received \(receivedBytes).
        """

    case .emptyTensor(
      let name
    ):
      return
        """
        EdgeSAM tensor \(name) contains no elements.
        """

    case .inputTensorElementCountMismatch(
      let name,
      let expected,
      let received
    ):
      return
        """
        EdgeSAM input tensor \(name) expected \(expected) elements but received \(received).
        """

    case .tensorBufferAllocationFailed(
      let name
    ):
      return
        """
        EdgeSAM could not allocate the ONNX buffer for tensor \(name).
        """

    case .ortValueCreationFailed(
      let name,
      let message
    ):
      return
        """
        EdgeSAM could not create an ONNX Runtime value for tensor \(name): \(message)
        """

    case .decoderExecutionFailed(
      let message
    ):
      return
        """
        EdgeSAM decoder inference failed: \(message)
        """
    }
  }
}