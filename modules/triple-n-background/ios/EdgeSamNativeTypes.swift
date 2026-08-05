//
// EdgeSamNativeTypes.swift
//
// Triple N - Native EdgeSAM Shared Types
//
// مسؤوليات هذا الملف:
//
// 1) جميع Shared Types الخاصة بمحرك EdgeSAM.
// 2) Shapes الخاصة بالـEncoder/Decoder.
// 3) Tensor Metadata.
// 4) Prompt Types.
// 5) Mask Types.
// 6) Candidate Types.
// 7) Diagnostics.
// 8) Shared Validation.
//
// لا يحتوي أي ONNX Runtime.
// لا يحتوي أي UIImage.
// لا يحتوي أي معالجة.
//

import Foundation
import CoreGraphics

// MARK: - Common aliases

typealias EdgeSamPixelIndex = Int
typealias EdgeSamChannelIndex = Int
typealias EdgeSamTensorIndex = Int
typealias EdgeSamFloat = Float
typealias EdgeSamProbability = Float
typealias EdgeSamScore = Float

// MARK: - Constants

enum EdgeSamNativeConstants {

  static let encoderInputWidth = 1024

  static let encoderInputHeight = 1024

  /*
   * أسماء توافقية تستخدمها ملفات Encoder وPreprocessor.
   */
  static let modelInputWidth =
    encoderInputWidth

  static let modelInputHeight =
    encoderInputHeight

  static let encoderChannels = 3

  static let encoderBatch = 1

  static let decoderMaskSize = 256

  static let maximumPromptPoints = 64

  static let minimumPromptPoints = 1

  static let encoderEmbeddingChannels = 256
}

// MARK: - Processing stage

enum EdgeSamProcessingStage:
  String,
  Codable,
  Sendable {

  case idle

  case loadingImage

  case correctingOrientation

  case resizing

  case letterbox

  case normalization

  case encoder

  case promptGeneration

  case decoder

  case candidateSelection

  case maskRestore

  case refinement

  case backgroundUnderstanding

  case export

  case completed
}

// MARK: - Tensor shape

struct EdgeSamTensorShape:
  Codable,
  Hashable,
  Sendable {

  let batch: Int

  let channels: Int

  let height: Int

  let width: Int

  var elementCount: Int {
    batch *
    channels *
    height *
    width
  }
}

// MARK: - Tensor description

struct EdgeSamTensorDescription:
  Codable,
  Sendable {

  let name: String

  let shape: EdgeSamTensorShape

  let dataType: String
}

// MARK: - Image size

struct EdgeSamImageSize:
  Codable,
  Hashable,
  Sendable {

  let width: Int

  let height: Int

  var pixelCount: Int {
    width * height
  }

  var cgSize: CGSize {
    CGSize(
      width: width,
      height: height
    )
  }
}

// MARK: - RGBA image

struct EdgeSamRGBAImage:
  Sendable {

  let width: Int

  let height: Int

  let bytesPerRow: Int

  let pixels: Data
}

// MARK: - Float image

struct EdgeSamFloatImage:
  Sendable {

  let width: Int

  let height: Int

  let channels: Int

  let values: [Float]
}

// MARK: - Letterbox

struct EdgeSamLetterbox:
  Codable,
  Sendable {

  let scale: Float

  let left: Int

  let top: Int

  let right: Int

  let bottom: Int

  let outputWidth: Int

  let outputHeight: Int
}
// MARK: - Tensor layout

enum EdgeSamTensorLayout:
  String,
  Codable,
  Equatable,
  Sendable {

  case nchw

  case nhwc

  case unknown
}

// MARK: - Tensor element type

enum EdgeSamTensorElementType:
  String,
  Codable,
  Equatable,
  Sendable {

  case float32

  case float16

  case int32

  case int64

  case uint8

  case unknown
}

// MARK: - Generic tensor metadata

struct EdgeSamTensorMetadata:
  Codable,
  Equatable,
  Sendable {

  let name:
    String

  let dimensions:
    [Int]

  let elementType:
    EdgeSamTensorElementType

  let layout:
    EdgeSamTensorLayout

  var rank:
    Int {
    dimensions.count
  }

  var elementCount:
    Int {
    guard !dimensions.isEmpty else {
      return 0
    }

    var result =
      1

    for dimension in dimensions {
      guard dimension >
              0 else {
        return 0
      }

      let multiplication =
        result
          .multipliedReportingOverflow(
            by:
              dimension
          )

      guard !multiplication
              .overflow else {
        return 0
      }

      result =
        multiplication
          .partialValue
    }

    return result
  }

  func validated()
    throws ->
      EdgeSamTensorMetadata {
    let normalizedName =
      name
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedName.isEmpty else {
      throw EdgeSamNativeTypeError
        .missingTensorName
    }

    guard !dimensions.isEmpty else {
      throw EdgeSamNativeTypeError
        .emptyTensorShape(
          tensorName:
            normalizedName
        )
    }

    guard dimensions.allSatisfy({
      $0 >
        0
    }) else {
      throw EdgeSamNativeTypeError
        .invalidTensorShape(
          tensorName:
            normalizedName,
          dimensions:
            dimensions
        )
    }

    guard elementCount >
            0 else {
      throw EdgeSamNativeTypeError
        .unsafeTensorElementCount(
          tensorName:
            normalizedName,
          dimensions:
            dimensions
        )
    }

    return EdgeSamTensorMetadata(
      name:
        normalizedName,
      dimensions:
        dimensions,
      elementType:
        elementType,
      layout:
        layout
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "name":
        name,

      "dimensions":
        dimensions,

      "rank":
        rank,

      "elementCount":
        elementCount,

      "elementType":
        elementType.rawValue,

      "layout":
        layout.rawValue
    ]
  }
}

// MARK: - Float tensor

struct EdgeSamFloatTensor:
  Sendable {

  let metadata:
    EdgeSamTensorMetadata

  let values:
    ContiguousArray<Float>

  var elementCount:
    Int {
    values.count
  }

  func validated()
    throws ->
      EdgeSamFloatTensor {
    let validatedMetadata =
      try metadata.validated()

    guard validatedMetadata
            .elementType ==
            .float32 ||
          validatedMetadata
            .elementType ==
            .float16 else {
      throw EdgeSamNativeTypeError
        .unsupportedTensorElementType(
          tensorName:
            validatedMetadata.name,
          elementType:
            validatedMetadata
              .elementType
        )
    }

    guard values.count ==
            validatedMetadata
              .elementCount else {
      throw EdgeSamNativeTypeError
        .tensorElementCountMismatch(
          tensorName:
            validatedMetadata.name,
          expected:
            validatedMetadata
              .elementCount,
          received:
            values.count
        )
    }

    guard values.allSatisfy({
      $0.isFinite
    }) else {
      throw EdgeSamNativeTypeError
        .nonFiniteTensorValue(
          tensorName:
            validatedMetadata.name
        )
    }

    return EdgeSamFloatTensor(
      metadata:
        validatedMetadata,
      values:
        values
    )
  }

  func asDictionary(
    includeValues:
      Bool =
        false
  ) -> [String: Any] {
    var dictionary:
      [String: Any] =
        [
          "metadata":
            metadata
              .asDictionary(),

          "elementCount":
            elementCount
        ]

    if includeValues {
      dictionary[
        "values"
      ] =
        Array(
          values
        )
    }

    return dictionary
  }

  func withUnsafeBufferPointer<Result>(
    _ body:
      (
        UnsafeBufferPointer<Float>
      ) throws ->
        Result
  ) rethrows ->
      Result {
    try values
      .withUnsafeBufferPointer(
        body
      )
  }
}

// MARK: - Encoder input tensor

struct EdgeSamEncoderInput:
  Sendable {

  let tensor:
    EdgeSamFloatTensor

  let sourceSize:
    EdgeSamImageSize

  let resizedSize:
    EdgeSamImageSize

  let letterbox:
    EdgeSamLetterbox

  let createdAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamEncoderInput {
    let validatedTensor =
      try tensor.validated()

    let expectedDimensions =
      [
        EdgeSamNativeConstants
          .encoderBatch,
        EdgeSamNativeConstants
          .encoderChannels,
        EdgeSamNativeConstants
          .encoderInputHeight,
        EdgeSamNativeConstants
          .encoderInputWidth
      ]

    guard validatedTensor
            .metadata
            .dimensions ==
            expectedDimensions else {
      throw EdgeSamNativeTypeError
        .invalidEncoderInputShape(
          expected:
            expectedDimensions,
          received:
            validatedTensor
              .metadata
              .dimensions
        )
    }

    guard sourceSize.width >
            0,
          sourceSize.height >
            0,
          resizedSize.width >
            0,
          resizedSize.height >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidImageSize
    }

    return EdgeSamEncoderInput(
      tensor:
        validatedTensor,
      sourceSize:
        sourceSize,
      resizedSize:
        resizedSize,
      letterbox:
        letterbox,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "tensor":
        tensor
          .asDictionary(),

      "sourceSize": [
        "width":
          sourceSize.width,

        "height":
          sourceSize.height
      ],

      "resizedSize": [
        "width":
          resizedSize.width,

        "height":
          resizedSize.height
      ],

      "letterbox": [
        "scale":
          letterbox.scale,

        "left":
          letterbox.left,

        "top":
          letterbox.top,

        "right":
          letterbox.right,

        "bottom":
          letterbox.bottom,

        "outputWidth":
          letterbox.outputWidth,

        "outputHeight":
          letterbox.outputHeight
      ],

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Encoder embedding

struct EdgeSamEncoderEmbedding:
  Sendable {

  let tensor:
    EdgeSamFloatTensor

  let imageSize:
    EdgeSamImageSize

  let createdAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamEncoderEmbedding {
    let validatedTensor =
      try tensor.validated()

    guard validatedTensor
            .metadata
            .rank ==
            4 else {
      throw EdgeSamNativeTypeError
        .invalidEncoderEmbeddingRank(
          rank:
            validatedTensor
              .metadata
              .rank
        )
    }

    guard validatedTensor
            .metadata
            .dimensions
            .first ==
            1 else {
      throw EdgeSamNativeTypeError
        .invalidEncoderEmbeddingBatch
    }

    return EdgeSamEncoderEmbedding(
      tensor:
        validatedTensor,
      imageSize:
        imageSize,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "tensor":
        tensor
          .asDictionary(),

      "imageSize": [
        "width":
          imageSize.width,

        "height":
          imageSize.height
      ],

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Prompt label

enum EdgeSamPromptLabel:
  Int32,
  Codable,
  Equatable,
  Sendable {

  case negative =
    0

  case positive =
    1

  case boxTopLeft =
    2

  case boxBottomRight =
    3

  case padding =
    -1
}

// MARK: - Prompt point

struct EdgeSamPromptPoint:
  Codable,
  Equatable,
  Sendable {

  let x:
    Float

  let y:
    Float

  let label:
    EdgeSamPromptLabel

  let confidence:
    Float

  func validated(
    imageSize:
      EdgeSamImageSize
  ) throws ->
      EdgeSamPromptPoint {
    guard x.isFinite,
          y.isFinite,
          confidence.isFinite else {
      throw EdgeSamNativeTypeError
        .nonFinitePromptPoint
    }

    guard x >= 0,
          y >= 0,
          x <=
            Float(
              imageSize.width
            ),
          y <=
            Float(
              imageSize.height
            ) else {
      throw EdgeSamNativeTypeError
        .promptPointOutsideImage(
          x:
            x,
          y:
            y,
          imageWidth:
            imageSize.width,
          imageHeight:
            imageSize.height
        )
    }

    guard confidence >=
            0,
          confidence <=
            1 else {
      throw EdgeSamNativeTypeError
        .invalidPromptConfidence(
          confidence:
            confidence
        )
    }

    return self
  }

  func asDictionary()
    -> [String: Any] {
    [
      "x":
        x,

      "y":
        y,

      "label":
        label.rawValue,

      "confidence":
        confidence
    ]
  }
}

// MARK: - Prompt box

struct EdgeSamPromptBox:
  Codable,
  Equatable,
  Sendable {

  let left:
    Float

  let top:
    Float

  let right:
    Float

  let bottom:
    Float

  var width:
    Float {
    right -
    left
  }

  var height:
    Float {
    bottom -
    top
  }

  func validated(
    imageSize:
      EdgeSamImageSize
  ) throws ->
      EdgeSamPromptBox {
    guard left.isFinite,
          top.isFinite,
          right.isFinite,
          bottom.isFinite else {
      throw EdgeSamNativeTypeError
        .nonFinitePromptBox
    }

    guard left >=
            0,
          top >=
            0,
          right >
            left,
          bottom >
            top else {
      throw EdgeSamNativeTypeError
        .invalidPromptBox
    }

    guard right <=
            Float(
              imageSize.width
            ),
          bottom <=
            Float(
              imageSize.height
            ) else {
      throw EdgeSamNativeTypeError
        .promptBoxOutsideImage(
          imageWidth:
            imageSize.width,
          imageHeight:
            imageSize.height
        )
    }

    return self
  }

  func asDictionary()
    -> [String: Any] {
    [
      "left":
        left,

      "top":
        top,

      "right":
        right,

      "bottom":
        bottom,

      "width":
        width,

      "height":
        height
    ]
  }
}

// MARK: - Prompt set

struct EdgeSamPromptSet:
  Codable,
  Equatable,
  Sendable {

  let points:
    [EdgeSamPromptPoint]

  let boundingBox:
    EdgeSamPromptBox?

  let sourceSize:
    EdgeSamImageSize

  let modelSize:
    EdgeSamImageSize

  let createdAt:
    NativeProcessingTimestamp

  var pointCount:
    Int {
    points.count +
    (
      boundingBox ==
        nil
        ? 0
        : 2
    )
  }

  func validated()
    throws ->
      EdgeSamPromptSet {
    guard sourceSize.width >
            0,
          sourceSize.height >
            0,
          modelSize.width >
            0,
          modelSize.height >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidImageSize
    }

    guard pointCount >=
            EdgeSamNativeConstants
              .minimumPromptPoints else {
      throw EdgeSamNativeTypeError
        .insufficientPromptPoints(
          count:
            pointCount
        )
    }

    guard pointCount <=
            EdgeSamNativeConstants
              .maximumPromptPoints else {
      throw EdgeSamNativeTypeError
        .tooManyPromptPoints(
          count:
            pointCount,
          maximum:
            EdgeSamNativeConstants
              .maximumPromptPoints
        )
    }

    for point in points {
      _ =
        try point.validated(
          imageSize:
            modelSize
        )
    }

    if let boundingBox {
      _ =
        try boundingBox.validated(
          imageSize:
            modelSize
        )
    }

    return EdgeSamPromptSet(
      points:
        points,
      boundingBox:
        boundingBox,
      sourceSize:
        sourceSize,
      modelSize:
        modelSize,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "points":
        points.map {
          $0.asDictionary()
        },

      "boundingBox":
        boundingBox?
          .asDictionary() ??
        NSNull(),

      "pointCount":
        pointCount,

      "sourceSize": [
        "width":
          sourceSize.width,

        "height":
          sourceSize.height
      ],

      "modelSize": [
        "width":
          modelSize.width,

        "height":
          modelSize.height
      ],

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Decoder point tensors

struct EdgeSamDecoderPromptTensors:
  Sendable {

  let pointCoordinates:
    EdgeSamFloatTensor

  let pointLabels:
    EdgeSamFloatTensor

  let maskInput:
    EdgeSamFloatTensor

  let hasMaskInput:
    EdgeSamFloatTensor

  let originalImageSize:
    EdgeSamFloatTensor

  func validated()
    throws ->
      EdgeSamDecoderPromptTensors {
    let validatedCoordinates =
      try pointCoordinates
        .validated()

    let validatedLabels =
      try pointLabels
        .validated()

    let validatedMaskInput =
      try maskInput
        .validated()

    let validatedHasMaskInput =
      try hasMaskInput
        .validated()

    let validatedOriginalImageSize =
      try originalImageSize
        .validated()

    guard validatedCoordinates
            .metadata
            .rank ==
            3 else {
      throw EdgeSamNativeTypeError
        .invalidPointCoordinateTensorShape(
          dimensions:
            validatedCoordinates
              .metadata
              .dimensions
        )
    }

    guard validatedLabels
            .metadata
            .rank ==
            2 else {
      throw EdgeSamNativeTypeError
        .invalidPointLabelTensorShape(
          dimensions:
            validatedLabels
              .metadata
              .dimensions
        )
    }

    return EdgeSamDecoderPromptTensors(
      pointCoordinates:
        validatedCoordinates,
      pointLabels:
        validatedLabels,
      maskInput:
        validatedMaskInput,
      hasMaskInput:
        validatedHasMaskInput,
      originalImageSize:
        validatedOriginalImageSize
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "pointCoordinates":
        pointCoordinates
          .asDictionary(),

      "pointLabels":
        pointLabels
          .asDictionary(),

      "maskInput":
        maskInput
          .asDictionary(),

      "hasMaskInput":
        hasMaskInput
          .asDictionary(),

      "originalImageSize":
        originalImageSize
          .asDictionary()
    ]
  }
}
// MARK: - Float mask

struct EdgeSamFloatMask:
  Sendable {

  let width:
    Int

  let height:
    Int

  let values:
    ContiguousArray<Float>

  let createdAt:
    NativeProcessingTimestamp

    init(
    width:
      Int,
    height:
      Int,
    values:
      ContiguousArray<Float>,
    createdAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) {
    self.width =
      width

    self.height =
      height

    self.values =
      values

    self.createdAt =
      NativeProcessingTime.normalize(
        createdAt
      )
  }

  var pixelCount:
    Int {
    width *
    height
  }

  var size:
    EdgeSamImageSize {
    EdgeSamImageSize(
      width:
        width,
      height:
        height
    )
  }

  func validated(
    requireFiniteValues:
      Bool =
        true
  ) throws ->
      EdgeSamFloatMask {
    guard width >
            0,
          height >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidMaskDimensions(
          width:
            width,
          height:
            height
        )
    }

    let multiplication =
      width
        .multipliedReportingOverflow(
          by:
            height
        )

    guard !multiplication
            .overflow,
          multiplication
            .partialValue >
            0 else {
      throw EdgeSamNativeTypeError
        .unsafeMaskPixelCount(
          width:
            width,
          height:
            height
        )
    }

    guard values.count ==
            multiplication
              .partialValue else {
      throw EdgeSamNativeTypeError
        .maskElementCountMismatch(
          expected:
            multiplication
              .partialValue,
          received:
            values.count
        )
    }

    if requireFiniteValues {
      guard values.allSatisfy({
        $0.isFinite
      }) else {
        throw EdgeSamNativeTypeError
          .nonFiniteMaskValue
      }
    }

    return EdgeSamFloatMask(
      width:
        width,
      height:
        height,
      values:
        values,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func value(
    x:
      Int,
    y:
      Int
  ) throws ->
      Float {
    guard x >=
            0,
          y >=
            0,
          x <
            width,
          y <
            height else {
      throw EdgeSamNativeTypeError
        .maskCoordinateOutsideBounds(
          x:
            x,
          y:
            y,
          width:
            width,
          height:
            height
        )
    }

    return values[
      y *
      width +
      x
    ]
  }

  func asDictionary(
    includeValues:
      Bool =
        false
  ) -> [String: Any] {
    var dictionary:
      [String: Any] =
        [
          "width":
            width,

          "height":
            height,

          "pixelCount":
            pixelCount,

          "createdAt":
            createdAt
        ]

    if includeValues {
      dictionary[
        "values"
      ] =
        Array(
          values
        )
    }

    return dictionary
  }

  func withUnsafeBufferPointer<Result>(
    _ body:
      (
        UnsafeBufferPointer<Float>
      ) throws ->
        Result
  ) rethrows ->
      Result {
    try values
      .withUnsafeBufferPointer(
        body
      )
  }
}

// MARK: - Binary mask

struct EdgeSamBinaryMask:
  Sendable {

  let width:
    Int

  let height:
    Int

  let values:
    ContiguousArray<UInt8>

  let createdAt:
    NativeProcessingTimestamp

  var pixelCount:
    Int {
    width *
    height
  }

  var size:
    EdgeSamImageSize {
    EdgeSamImageSize(
      width:
        width,
      height:
        height
    )
  }

  func validated()
    throws ->
      EdgeSamBinaryMask {
    guard width >
            0,
          height >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidMaskDimensions(
          width:
            width,
          height:
            height
        )
    }

    let multiplication =
      width
        .multipliedReportingOverflow(
          by:
            height
        )

    guard !multiplication
            .overflow,
          multiplication
            .partialValue >
            0 else {
      throw EdgeSamNativeTypeError
        .unsafeMaskPixelCount(
          width:
            width,
          height:
            height
        )
    }

    guard values.count ==
            multiplication
              .partialValue else {
      throw EdgeSamNativeTypeError
        .maskElementCountMismatch(
          expected:
            multiplication
              .partialValue,
          received:
            values.count
        )
    }

    return EdgeSamBinaryMask(
      width:
        width,
      height:
        height,
      values:
        values,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary(
    includeValues:
      Bool =
        false
  ) -> [String: Any] {
    var dictionary:
      [String: Any] =
        [
          "width":
            width,

          "height":
            height,

          "pixelCount":
            pixelCount,

          "createdAt":
            createdAt
        ]

    if includeValues {
      dictionary[
        "values"
      ] =
        Array(
          values
        )
    }

    return dictionary
  }
}

// MARK: - Alpha mask

struct EdgeSamAlphaMask:
  Sendable {

  let width:
    Int

  let height:
    Int

  let values:
    Data

  let createdAt:
    NativeProcessingTimestamp

  var pixelCount:
    Int {
    width *
    height
  }

  var size:
    EdgeSamImageSize {
    EdgeSamImageSize(
      width:
        width,
      height:
        height
    )
  }

  func validated()
    throws ->
      EdgeSamAlphaMask {
    guard width >
            0,
          height >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidMaskDimensions(
          width:
            width,
          height:
            height
        )
    }

    let multiplication =
      width
        .multipliedReportingOverflow(
          by:
            height
        )

    guard !multiplication
            .overflow,
          multiplication
            .partialValue >
            0 else {
      throw EdgeSamNativeTypeError
        .unsafeMaskPixelCount(
          width:
            width,
          height:
            height
        )
    }

    guard values.count ==
            multiplication
              .partialValue else {
      throw EdgeSamNativeTypeError
        .maskElementCountMismatch(
          expected:
            multiplication
              .partialValue,
          received:
            values.count
        )
    }

    return EdgeSamAlphaMask(
      width:
        width,
      height:
        height,
      values:
        values,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary(
    includeValues:
      Bool =
        false
  ) -> [String: Any] {
    var dictionary:
      [String: Any] =
        [
          "width":
            width,

          "height":
            height,

          "pixelCount":
            pixelCount,

          "byteCount":
            values.count,

          "createdAt":
            createdAt
        ]

    if includeValues {
      dictionary[
        "values"
      ] =
        values
    }

    return dictionary
  }
}

// MARK: - Mask bounding box

struct EdgeSamMaskBoundingBox:
  Codable,
  Equatable,
  Sendable {

  let left:
    Int

  let top:
    Int

  let right:
    Int

  let bottom:
    Int

  var width:
    Int {
    max(
      0,
      right -
      left +
      1
    )
  }

  var height:
    Int {
    max(
      0,
      bottom -
      top +
      1
    )
  }

  var area:
    Int {
    width *
    height
  }

  func validated(
    imageSize:
      EdgeSamImageSize
  ) throws ->
      EdgeSamMaskBoundingBox {
    guard left >=
            0,
          top >=
            0,
          right >=
            left,
          bottom >=
            top,
          right <
            imageSize.width,
          bottom <
            imageSize.height else {
      throw EdgeSamNativeTypeError
        .invalidMaskBoundingBox
    }

    return self
  }

  func asDictionary()
    -> [String: Any] {
    [
      "left":
        left,

      "top":
        top,

      "right":
        right,

      "bottom":
        bottom,

      "width":
        width,

      "height":
        height,

      "area":
        area
    ]
  }
}

// MARK: - Mask statistics

struct EdgeSamMaskStatistics:
  Codable,
  Equatable,
  Sendable {

  let minimumValue:
    Float

  let maximumValue:
    Float

  let meanValue:
    Float

  let foregroundPixelCount:
    Int

  let foregroundRatio:
    Float

  let touchedEdgeCount:
    Int

  let connectedComponentCount:
    Int

  let significantComponentCount:
    Int

  let largestComponentPixelCount:
    Int

  let boundingBox:
    EdgeSamMaskBoundingBox?

  func validated(
    pixelCount:
      Int
  ) throws ->
      EdgeSamMaskStatistics {
    guard pixelCount >
            0 else {
      throw EdgeSamNativeTypeError
        .unsafeMaskPixelCount(
          width:
            0,
          height:
            0
        )
    }

    guard minimumValue.isFinite,
          maximumValue.isFinite,
          meanValue.isFinite,
          foregroundRatio.isFinite else {
      throw EdgeSamNativeTypeError
        .invalidMaskStatistics
    }

    guard foregroundPixelCount >=
            0,
          foregroundPixelCount <=
            pixelCount,
          foregroundRatio >=
            0,
          foregroundRatio <=
            1,
          touchedEdgeCount >=
            0,
          touchedEdgeCount <=
            4,
          connectedComponentCount >=
            0,
          significantComponentCount >=
            0,
          largestComponentPixelCount >=
            0,
          largestComponentPixelCount <=
            pixelCount else {
      throw EdgeSamNativeTypeError
        .invalidMaskStatistics
    }

    return self
  }

  func asDictionary()
    -> [String: Any] {
    [
      "minimumValue":
        minimumValue,

      "maximumValue":
        maximumValue,

      "meanValue":
        meanValue,

      "foregroundPixelCount":
        foregroundPixelCount,

      "foregroundRatio":
        foregroundRatio,

      "touchedEdgeCount":
        touchedEdgeCount,

      "connectedComponentCount":
        connectedComponentCount,

      "significantComponentCount":
        significantComponentCount,

      "largestComponentPixelCount":
        largestComponentPixelCount,

      "boundingBox":
        boundingBox?
          .asDictionary() ??
        NSNull()
    ]
  }
}

// MARK: - Candidate validity

enum EdgeSamCandidateValidity:
  String,
  Codable,
  Equatable,
  Sendable {

  case valid

  case fallback

  case rejected
}

// MARK: - Candidate rejection reason

enum EdgeSamCandidateRejectionReason:
  String,
  Codable,
  Equatable,
  Sendable {

  case emptyMask

  case fullMask

  case invalidScore

  case invalidShape

  case invalidStatistics

  case foregroundTooSmall

  case foregroundTooLarge

  case excessiveEdgeContact

  case excessiveComponents

  case decoderOutputInvalid

  case unsupportedOutput

  case unknown
}

// MARK: - Mask candidate

struct EdgeSamMaskCandidate:
  Sendable {

  let index:
    Int

  let mask:
    EdgeSamFloatMask

  let predictedIOU:
    Float

  let stabilityScore:
    Float?

  let confidenceScore:
    Float

  let combinedScore:
    Float

  let validity:
    EdgeSamCandidateValidity

  let rejectionReasons:
    [EdgeSamCandidateRejectionReason]

  let statistics:
    EdgeSamMaskStatistics?

  let createdAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamMaskCandidate {
    guard index >=
            0 else {
      throw EdgeSamNativeTypeError
        .invalidCandidateIndex(
          index:
            index
        )
    }

    let validatedMask =
      try mask.validated()

    guard predictedIOU.isFinite,
          confidenceScore.isFinite,
          combinedScore.isFinite else {
      throw EdgeSamNativeTypeError
        .invalidCandidateScore(
          index:
            index
        )
    }

    if let stabilityScore {
      guard stabilityScore.isFinite else {
        throw EdgeSamNativeTypeError
          .invalidCandidateScore(
            index:
              index
          )
      }
    }

    return EdgeSamMaskCandidate(
      index:
        index,
      mask:
        validatedMask,
      predictedIOU:
        predictedIOU,
      stabilityScore:
        stabilityScore,
      confidenceScore:
        confidenceScore,
      combinedScore:
        combinedScore,
      validity:
        validity,
      rejectionReasons:
        rejectionReasons,
      statistics:
        statistics,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "index":
        index,

      "mask":
        mask
          .asDictionary(),

      "predictedIOU":
        predictedIOU,

      "stabilityScore":
        stabilityScore ??
        NSNull(),

      "confidenceScore":
        confidenceScore,

      "combinedScore":
        combinedScore,

      "validity":
        validity.rawValue,

      "rejectionReasons":
        rejectionReasons.map {
          $0.rawValue
        },

      "statistics":
        statistics?
          .asDictionary() ??
        NSNull(),

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Decoder raw output

struct EdgeSamDecoderRawOutput:
  Sendable {

  let masks:
    EdgeSamFloatTensor

  let iouPredictions:
    EdgeSamFloatTensor

  let lowResolutionMasks:
    EdgeSamFloatTensor?

  let candidateCount:
    Int

  let maskWidth:
    Int

  let maskHeight:
    Int

  let createdAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamDecoderRawOutput {
    let validatedMasks =
      try masks.validated()

    let validatedIOU =
      try iouPredictions
        .validated()

    guard candidateCount >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidDecoderCandidateCount(
          count:
            candidateCount
        )
    }

    guard maskWidth >
            0,
          maskHeight >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidMaskDimensions(
          width:
            maskWidth,
          height:
            maskHeight
        )
    }

    let pixelsPerMaskResult =
      maskWidth
        .multipliedReportingOverflow(
          by:
            maskHeight
        )

    guard !pixelsPerMaskResult
            .overflow else {
      throw EdgeSamNativeTypeError
        .unsafeMaskPixelCount(
          width:
            maskWidth,
          height:
            maskHeight
        )
    }

    let expectedMaskValuesResult =
      pixelsPerMaskResult
        .partialValue
        .multipliedReportingOverflow(
          by:
            candidateCount
        )

    guard !expectedMaskValuesResult
            .overflow else {
      throw EdgeSamNativeTypeError
        .unsafeDecoderOutputSize
    }

    guard validatedMasks
            .values
            .count >=
            expectedMaskValuesResult
              .partialValue else {
      throw EdgeSamNativeTypeError
        .decoderMaskElementCountMismatch(
          expectedMinimum:
            expectedMaskValuesResult
              .partialValue,
          received:
            validatedMasks
              .values
              .count
        )
    }

    guard validatedIOU
            .values
            .count >=
            candidateCount else {
      throw EdgeSamNativeTypeError
        .decoderScoreElementCountMismatch(
          expectedMinimum:
            candidateCount,
          received:
            validatedIOU
              .values
              .count
        )
    }

    let validatedLowResolutionMasks:
      EdgeSamFloatTensor?

    if let lowResolutionMasks {
      validatedLowResolutionMasks =
        try lowResolutionMasks
          .validated()
    } else {
      validatedLowResolutionMasks =
        nil
    }

    return EdgeSamDecoderRawOutput(
      masks:
        validatedMasks,
      iouPredictions:
        validatedIOU,
      lowResolutionMasks:
        validatedLowResolutionMasks,
      candidateCount:
        candidateCount,
      maskWidth:
        maskWidth,
      maskHeight:
        maskHeight,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "masks":
        masks
          .asDictionary(),

      "iouPredictions":
        iouPredictions
          .asDictionary(),

      "lowResolutionMasks":
        lowResolutionMasks?
          .asDictionary() ??
        NSNull(),

      "candidateCount":
        candidateCount,

      "maskWidth":
        maskWidth,

      "maskHeight":
        maskHeight,

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Candidate selection result

struct EdgeSamCandidateSelectionResult:
  Sendable {

  let candidates:
    [EdgeSamMaskCandidate]

  let selectedCandidateIndex:
    Int

  let selectedCandidate:
    EdgeSamMaskCandidate

  let usedFallback:
    Bool

  let warnings:
    [String]

  let completedAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamCandidateSelectionResult {
    guard !candidates.isEmpty else {
      throw EdgeSamNativeTypeError
        .noMaskCandidates
    }

    guard selectedCandidateIndex >=
            0,
          selectedCandidateIndex <
            candidates.count else {
      throw EdgeSamNativeTypeError
        .selectedCandidateOutsideBounds(
          index:
            selectedCandidateIndex,
          candidateCount:
            candidates.count
        )
    }

    let validatedSelected =
      try selectedCandidate
        .validated()

    guard candidates[
            selectedCandidateIndex
          ]
          .index ==
            validatedSelected
              .index else {
      throw EdgeSamNativeTypeError
        .selectedCandidateMismatch
    }

    return EdgeSamCandidateSelectionResult(
      candidates:
        candidates,
      selectedCandidateIndex:
        selectedCandidateIndex,
      selectedCandidate:
        validatedSelected,
      usedFallback:
        usedFallback,
      warnings:
        warnings,
      completedAt:
        NativeProcessingTime
          .normalize(
            completedAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "candidates":
        candidates.map {
          $0.asDictionary()
        },

      "selectedCandidateIndex":
        selectedCandidateIndex,

      "selectedCandidate":
        selectedCandidate
          .asDictionary(),

      "usedFallback":
        usedFallback,

      "warnings":
        warnings,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Restored mask result

struct EdgeSamRestoredMaskResult:
  Sendable {

  let modelMask:
    EdgeSamFloatMask

  let restoredMask:
    EdgeSamFloatMask

  let originalImageSize:
    EdgeSamImageSize

  let letterbox:
    EdgeSamLetterbox

  let completedAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamRestoredMaskResult {
    let validatedModelMask =
      try modelMask
        .validated()

    let validatedRestoredMask =
      try restoredMask
        .validated()

    guard validatedRestoredMask.width ==
            originalImageSize.width,
          validatedRestoredMask.height ==
            originalImageSize.height else {
      throw EdgeSamNativeTypeError
        .restoredMaskSizeMismatch(
          expectedWidth:
            originalImageSize.width,
          expectedHeight:
            originalImageSize.height,
          receivedWidth:
            validatedRestoredMask.width,
          receivedHeight:
            validatedRestoredMask.height
        )
    }

    return EdgeSamRestoredMaskResult(
      modelMask:
        validatedModelMask,
      restoredMask:
        validatedRestoredMask,
      originalImageSize:
        originalImageSize,
      letterbox:
        letterbox,
      completedAt:
        NativeProcessingTime
          .normalize(
            completedAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "modelMask":
        modelMask
          .asDictionary(),

      "restoredMask":
        restoredMask
          .asDictionary(),

      "originalImageSize": [
        "width":
          originalImageSize.width,

        "height":
          originalImageSize.height
      ],

      "letterbox": [
        "scale":
          letterbox.scale,

        "left":
          letterbox.left,

        "top":
          letterbox.top,

        "right":
          letterbox.right,

        "bottom":
          letterbox.bottom,

        "outputWidth":
          letterbox.outputWidth,

        "outputHeight":
          letterbox.outputHeight
      ],

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Refined mask result

struct EdgeSamRefinedMaskResult:
  Sendable {

  let sourceMask:
    EdgeSamFloatMask

  let refinedMask:
    EdgeSamFloatMask

  let alphaMask:
    EdgeSamAlphaMask

  let originalStatistics:
    EdgeSamMaskStatistics

  let refinedStatistics:
    EdgeSamMaskStatistics

  let warnings:
    [String]

  let completedAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamRefinedMaskResult {
    let validatedSourceMask =
      try sourceMask
        .validated()

    let validatedRefinedMask =
      try refinedMask
        .validated()

    let validatedAlphaMask =
      try alphaMask
        .validated()

    guard validatedSourceMask.size ==
            validatedRefinedMask.size,
          validatedRefinedMask.size ==
            validatedAlphaMask.size else {
      throw EdgeSamNativeTypeError
        .refinedMaskSizeMismatch
    }

    _ =
      try originalStatistics
        .validated(
          pixelCount:
            validatedSourceMask
              .pixelCount
        )

    _ =
      try refinedStatistics
        .validated(
          pixelCount:
            validatedRefinedMask
              .pixelCount
        )

    return EdgeSamRefinedMaskResult(
      sourceMask:
        validatedSourceMask,
      refinedMask:
        validatedRefinedMask,
      alphaMask:
        validatedAlphaMask,
      originalStatistics:
        originalStatistics,
      refinedStatistics:
        refinedStatistics,
      warnings:
        warnings,
      completedAt:
        NativeProcessingTime
          .normalize(
            completedAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "sourceMask":
        sourceMask
          .asDictionary(),

      "refinedMask":
        refinedMask
          .asDictionary(),

      "alphaMask":
        alphaMask
          .asDictionary(),

      "originalStatistics":
        originalStatistics
          .asDictionary(),

      "refinedStatistics":
        refinedStatistics
          .asDictionary(),

      "warnings":
        warnings,

      "completedAt":
        completedAt
    ]
  }
}
// MARK: - Background understanding label

enum EdgeSamBackgroundRegionLabel:
  String,
  Codable,
  Equatable,
  Sendable {

  case unknown

  case probableForeground

  case probableBackground

  case connectedBackground

  case strongBackground

  case uncertain

  case protectedEdge
}

// MARK: - Background evidence map

struct EdgeSamBackgroundEvidenceMap:
  Sendable {

  let width:
    Int

  let height:
    Int

  let backgroundConfidence:
    ContiguousArray<Float>

  let foregroundEvidence:
    ContiguousArray<Float>

  let uncertainty:
    ContiguousArray<Float>

  let edgeBarrier:
    ContiguousArray<Float>

  let connectedBackground:
    ContiguousArray<UInt8>

  let strongBackground:
    ContiguousArray<UInt8>

  let createdAt:
    NativeProcessingTimestamp

  var pixelCount:
    Int {
    width *
    height
  }

  var size:
    EdgeSamImageSize {
    EdgeSamImageSize(
      width:
        width,
      height:
        height
    )
  }

  func validated()
    throws ->
      EdgeSamBackgroundEvidenceMap {
    guard width >
            0,
          height >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidBackgroundMapDimensions(
          width:
            width,
          height:
            height
        )
    }

    let multiplication =
      width
        .multipliedReportingOverflow(
          by:
            height
        )

    guard !multiplication.overflow,
          multiplication.partialValue >
            0 else {
      throw EdgeSamNativeTypeError
        .unsafeBackgroundMapPixelCount(
          width:
            width,
          height:
            height
        )
    }

    let expectedCount =
      multiplication
        .partialValue

    guard backgroundConfidence.count ==
            expectedCount,
          foregroundEvidence.count ==
            expectedCount,
          uncertainty.count ==
            expectedCount,
          edgeBarrier.count ==
            expectedCount,
          connectedBackground.count ==
            expectedCount,
          strongBackground.count ==
            expectedCount else {
      throw EdgeSamNativeTypeError
        .backgroundMapElementCountMismatch(
          expected:
            expectedCount,
          backgroundConfidence:
            backgroundConfidence.count,
          foregroundEvidence:
            foregroundEvidence.count,
          uncertainty:
            uncertainty.count,
          edgeBarrier:
            edgeBarrier.count,
          connectedBackground:
            connectedBackground.count,
          strongBackground:
            strongBackground.count
        )
    }

    guard backgroundConfidence.allSatisfy({
      $0.isFinite
    }),
    foregroundEvidence.allSatisfy({
      $0.isFinite
    }),
    uncertainty.allSatisfy({
      $0.isFinite
    }),
    edgeBarrier.allSatisfy({
      $0.isFinite
    }) else {
      throw EdgeSamNativeTypeError
        .nonFiniteBackgroundMapValue
    }

    return EdgeSamBackgroundEvidenceMap(
      width:
        width,
      height:
        height,
      backgroundConfidence:
        backgroundConfidence,
      foregroundEvidence:
        foregroundEvidence,
      uncertainty:
        uncertainty,
      edgeBarrier:
        edgeBarrier,
      connectedBackground:
        connectedBackground,
      strongBackground:
        strongBackground,
      createdAt:
        NativeProcessingTime
          .normalize(
            createdAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "width":
        width,

      "height":
        height,

      "pixelCount":
        pixelCount,

      "backgroundConfidenceCount":
        backgroundConfidence.count,

      "foregroundEvidenceCount":
        foregroundEvidence.count,

      "uncertaintyCount":
        uncertainty.count,

      "edgeBarrierCount":
        edgeBarrier.count,

      "connectedBackgroundCount":
        connectedBackground.count,

      "strongBackgroundCount":
        strongBackground.count,

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Background understanding statistics

struct EdgeSamBackgroundUnderstandingStatistics:
  Codable,
  Equatable,
  Sendable {

  let probableBackgroundPixelCount:
    Int

  let strongBackgroundPixelCount:
    Int

  let connectedBackgroundPixelCount:
    Int

  let probableForegroundPixelCount:
    Int

  let uncertainPixelCount:
    Int

  let protectedEdgePixelCount:
    Int

  let removedPixelCount:
    Int

  let restoredPixelCount:
    Int

  let backgroundRatio:
    Float

  let foregroundRatio:
    Float

  let uncertaintyRatio:
    Float

  func validated(
    pixelCount:
      Int
  ) throws ->
      EdgeSamBackgroundUnderstandingStatistics {
    guard pixelCount >
            0 else {
      throw EdgeSamNativeTypeError
        .invalidBackgroundStatistics
    }

    let counts =
      [
        probableBackgroundPixelCount,
        strongBackgroundPixelCount,
        connectedBackgroundPixelCount,
        probableForegroundPixelCount,
        uncertainPixelCount,
        protectedEdgePixelCount,
        removedPixelCount,
        restoredPixelCount
      ]

    guard counts.allSatisfy({
      $0 >=
        0 &&
      $0 <=
        pixelCount
    }) else {
      throw EdgeSamNativeTypeError
        .invalidBackgroundStatistics
    }

    guard backgroundRatio.isFinite,
          foregroundRatio.isFinite,
          uncertaintyRatio.isFinite,
          backgroundRatio >=
            0,
          backgroundRatio <=
            1,
          foregroundRatio >=
            0,
          foregroundRatio <=
            1,
          uncertaintyRatio >=
            0,
          uncertaintyRatio <=
            1 else {
      throw EdgeSamNativeTypeError
        .invalidBackgroundStatistics
    }

    return self
  }

  func asDictionary()
    -> [String: Any] {
    [
      "probableBackgroundPixelCount":
        probableBackgroundPixelCount,

      "strongBackgroundPixelCount":
        strongBackgroundPixelCount,

      "connectedBackgroundPixelCount":
        connectedBackgroundPixelCount,

      "probableForegroundPixelCount":
        probableForegroundPixelCount,

      "uncertainPixelCount":
        uncertainPixelCount,

      "protectedEdgePixelCount":
        protectedEdgePixelCount,

      "removedPixelCount":
        removedPixelCount,

      "restoredPixelCount":
        restoredPixelCount,

      "backgroundRatio":
        backgroundRatio,

      "foregroundRatio":
        foregroundRatio,

      "uncertaintyRatio":
        uncertaintyRatio
    ]
  }
}

// MARK: - Background understanding result

struct EdgeSamBackgroundUnderstandingResult:
  Sendable {

  let sourceMask:
    EdgeSamFloatMask

  let refinedMask:
    EdgeSamFloatMask

  let evidence:
    EdgeSamBackgroundEvidenceMap

  let statistics:
    EdgeSamBackgroundUnderstandingStatistics

  let warnings:
    [String]

  let completedAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamBackgroundUnderstandingResult {
    let validatedSourceMask =
      try sourceMask
        .validated()

    let validatedRefinedMask =
      try refinedMask
        .validated()

    let validatedEvidence =
      try evidence
        .validated()

    guard validatedSourceMask.size ==
            validatedRefinedMask.size,
          validatedRefinedMask.size ==
            validatedEvidence.size else {
      throw EdgeSamNativeTypeError
        .backgroundResultSizeMismatch
    }

    let validatedStatistics =
      try statistics
        .validated(
          pixelCount:
            validatedSourceMask
              .pixelCount
        )

    return EdgeSamBackgroundUnderstandingResult(
      sourceMask:
        validatedSourceMask,
      refinedMask:
        validatedRefinedMask,
      evidence:
        validatedEvidence,
      statistics:
        validatedStatistics,
      warnings:
        warnings,
      completedAt:
        NativeProcessingTime
          .normalize(
            completedAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "sourceMask":
        sourceMask
          .asDictionary(),

      "refinedMask":
        refinedMask
          .asDictionary(),

      "evidence":
        evidence
          .asDictionary(),

      "statistics":
        statistics
          .asDictionary(),

      "warnings":
        warnings,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Pipeline timing

struct EdgeSamStageTiming:
  Codable,
  Equatable,
  Sendable {

  let stage:
    EdgeSamProcessingStage

  let startedAt:
    NativeProcessingTimestamp

  let completedAt:
    NativeProcessingTimestamp

  let durationMs:
    Int64

  func validated()
    throws ->
      EdgeSamStageTiming {
    let normalizedStartedAt =
      NativeProcessingTime
        .normalize(
          startedAt
        )

    let normalizedCompletedAt =
      NativeProcessingTime
        .normalize(
          completedAt,
          fallback:
            normalizedStartedAt
        )

    guard normalizedCompletedAt >=
            normalizedStartedAt else {
      throw EdgeSamNativeTypeError
        .invalidStageTiming(
          stage:
            stage
        )
    }

    guard durationMs >=
            0 else {
      throw EdgeSamNativeTypeError
        .invalidStageTiming(
          stage:
            stage
        )
    }

    return EdgeSamStageTiming(
      stage:
        stage,
      startedAt:
        normalizedStartedAt,
      completedAt:
        normalizedCompletedAt,
      durationMs:
        durationMs
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "stage":
        stage.rawValue,

      "startedAt":
        startedAt,

      "completedAt":
        completedAt,

      "durationMs":
        durationMs
    ]
  }
}

// MARK: - Pipeline timings

struct EdgeSamPipelineTimings:
  Codable,
  Equatable,
  Sendable {

  let startedAt:
    NativeProcessingTimestamp

  let completedAt:
    NativeProcessingTimestamp

  let totalDurationMs:
    Int64

  let stages:
    [EdgeSamStageTiming]

  func validated()
    throws ->
      EdgeSamPipelineTimings {
    let normalizedStartedAt =
      NativeProcessingTime
        .normalize(
          startedAt
        )

    let normalizedCompletedAt =
      NativeProcessingTime
        .normalize(
          completedAt,
          fallback:
            normalizedStartedAt
        )

    guard normalizedCompletedAt >=
            normalizedStartedAt,
          totalDurationMs >=
            0 else {
      throw EdgeSamNativeTypeError
        .invalidPipelineTiming
    }

    let validatedStages =
      try stages.map {
        try $0.validated()
      }

    return EdgeSamPipelineTimings(
      startedAt:
        normalizedStartedAt,
      completedAt:
        normalizedCompletedAt,
      totalDurationMs:
        totalDurationMs,
      stages:
        validatedStages
    )
  }

  func duration(
    for stage:
      EdgeSamProcessingStage
  ) -> Int64 {
    stages
      .filter {
        $0.stage ==
          stage
      }
      .reduce(
        0
      ) {
        $0 +
        $1.durationMs
      }
  }

  func asDictionary()
    -> [String: Any] {
    [
      "startedAt":
        startedAt,

      "completedAt":
        completedAt,

      "totalDurationMs":
        totalDurationMs,

      "stages":
        stages.map {
          $0.asDictionary()
        }
    ]
  }
}

// MARK: - Model information

struct EdgeSamModelInformation:
  Codable,
  Equatable,
  Sendable {

  let encoderModelName:
    String

  let decoderModelName:
    String

  let encoderModelPath:
    String

  let decoderModelPath:
    String

  let executionProvider:
    String

  let encoderInputs:
    [EdgeSamTensorMetadata]

  let encoderOutputs:
    [EdgeSamTensorMetadata]

  let decoderInputs:
    [EdgeSamTensorMetadata]

  let decoderOutputs:
    [EdgeSamTensorMetadata]

  let loadedAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamModelInformation {
    let normalizedEncoderName =
      encoderModelName
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    let normalizedDecoderName =
      decoderModelName
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    let normalizedEncoderPath =
      encoderModelPath
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    let normalizedDecoderPath =
      decoderModelPath
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedEncoderName.isEmpty,
          !normalizedDecoderName.isEmpty,
          !normalizedEncoderPath.isEmpty,
          !normalizedDecoderPath.isEmpty else {
      throw EdgeSamNativeTypeError
        .invalidModelInformation
    }

    return EdgeSamModelInformation(
      encoderModelName:
        normalizedEncoderName,
      decoderModelName:
        normalizedDecoderName,
      encoderModelPath:
        normalizedEncoderPath,
      decoderModelPath:
        normalizedDecoderPath,
      executionProvider:
        executionProvider,
      encoderInputs:
        try encoderInputs.map {
          try $0.validated()
        },
      encoderOutputs:
        try encoderOutputs.map {
          try $0.validated()
        },
      decoderInputs:
        try decoderInputs.map {
          try $0.validated()
        },
      decoderOutputs:
        try decoderOutputs.map {
          try $0.validated()
        },
      loadedAt:
        NativeProcessingTime
          .normalize(
            loadedAt
          )
    )
  }

  func asDictionary()
    -> [String: Any] {
    [
      "encoderModelName":
        encoderModelName,

      "decoderModelName":
        decoderModelName,

      "encoderModelPath":
        encoderModelPath,

      "decoderModelPath":
        decoderModelPath,

      "executionProvider":
        executionProvider,

      "encoderInputs":
        encoderInputs.map {
          $0.asDictionary()
        },

      "encoderOutputs":
        encoderOutputs.map {
          $0.asDictionary()
        },

      "decoderInputs":
        decoderInputs.map {
          $0.asDictionary()
        },

      "decoderOutputs":
        decoderOutputs.map {
          $0.asDictionary()
        },

      "loadedAt":
        loadedAt
    ]
  }
}

// MARK: - Pipeline diagnostics

struct EdgeSamPipelineDiagnostics:
  Sendable {

  let requestId:
    String

  let jobId:
    String

  let stage:
    EdgeSamProcessingStage

  let sourceSize:
    EdgeSamImageSize

  let modelInputSize:
    EdgeSamImageSize

  let promptPointCount:
    Int

  let candidateCount:
    Int

  let selectedCandidateIndex:
    Int?

  let selectedCandidateScore:
    Float?

  let originalMaskStatistics:
    EdgeSamMaskStatistics?

  let finalMaskStatistics:
    EdgeSamMaskStatistics?

  let timings:
    EdgeSamPipelineTimings?

  let warnings:
    [String]

  let metadata:
    [String: NativeProcessingMetadataValue]

  let createdAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    var metadataDictionary:
      [String: Any] =
        [:]

    for (
      key,
      value
    ) in metadata {
      metadataDictionary[
        key
      ] =
        value.foundationValue
    }

    return [
      "requestId":
        requestId,

      "jobId":
        jobId,

      "stage":
        stage.rawValue,

      "sourceSize": [
        "width":
          sourceSize.width,

        "height":
          sourceSize.height
      ],

      "modelInputSize": [
        "width":
          modelInputSize.width,

        "height":
          modelInputSize.height
      ],

      "promptPointCount":
        promptPointCount,

      "candidateCount":
        candidateCount,

      "selectedCandidateIndex":
        selectedCandidateIndex ??
        NSNull(),

      "selectedCandidateScore":
        selectedCandidateScore ??
        NSNull(),

      "originalMaskStatistics":
        originalMaskStatistics?
          .asDictionary() ??
        NSNull(),

      "finalMaskStatistics":
        finalMaskStatistics?
          .asDictionary() ??
        NSNull(),

      "timings":
        timings?
          .asDictionary() ??
        NSNull(),

      "warnings":
        warnings,

      "metadata":
        metadataDictionary,

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Final pipeline result

struct EdgeSamNativePipelineResult:
  Sendable {

  let sourceImage:
    NativeRGBAImage

  let encoderInput:
    EdgeSamEncoderInput

  let embedding:
    EdgeSamEncoderEmbedding

  let prompts:
    EdgeSamPromptSet

  let decoderOutput:
    EdgeSamDecoderRawOutput

  let selection:
    EdgeSamCandidateSelectionResult

  let restored:
    EdgeSamRestoredMaskResult

  let backgroundUnderstanding:
    EdgeSamBackgroundUnderstandingResult?

  let refined:
    EdgeSamRefinedMaskResult

  let diagnostics:
    EdgeSamPipelineDiagnostics

  let completedAt:
    NativeProcessingTimestamp

  func validated()
    throws ->
      EdgeSamNativePipelineResult {
    let validatedSource =
      try sourceImage
        .validated()

    let validatedEncoderInput =
      try encoderInput
        .validated()

    let validatedEmbedding =
      try embedding
        .validated()

    let validatedPrompts =
      try prompts
        .validated()

    let validatedDecoderOutput =
      try decoderOutput
        .validated()

    let validatedSelection =
      try selection
        .validated()

    let validatedRestored =
      try restored
        .validated()

    let validatedBackground =
      try backgroundUnderstanding?
        .validated()

    let validatedRefined =
      try refined
        .validated()

    guard validatedRefined
            .refinedMask
            .width ==
            validatedSource.width,
          validatedRefined
            .refinedMask
            .height ==
            validatedSource.height else {
      throw EdgeSamNativeTypeError
        .finalMaskSizeMismatch(
          expectedWidth:
            validatedSource.width,
          expectedHeight:
            validatedSource.height,
          receivedWidth:
            validatedRefined
              .refinedMask
              .width,
          receivedHeight:
            validatedRefined
              .refinedMask
              .height
        )
    }

    return EdgeSamNativePipelineResult(
      sourceImage:
        validatedSource,
      encoderInput:
        validatedEncoderInput,
      embedding:
        validatedEmbedding,
      prompts:
        validatedPrompts,
      decoderOutput:
        validatedDecoderOutput,
      selection:
        validatedSelection,
      restored:
        validatedRestored,
      backgroundUnderstanding:
        validatedBackground,
      refined:
        validatedRefined,
      diagnostics:
        diagnostics,
      completedAt:
        NativeProcessingTime
          .normalize(
            completedAt
          )
    )
  }
}
// MARK: - Shared type errors

enum EdgeSamNativeTypeError:
  LocalizedError,
  Equatable,
  Sendable {

  case missingTensorName

  case emptyTensorShape(
    tensorName:
      String
  )

  case invalidTensorShape(
    tensorName:
      String,
    dimensions:
      [Int]
  )

  case unsafeTensorElementCount(
    tensorName:
      String,
    dimensions:
      [Int]
  )

  case unsupportedTensorElementType(
    tensorName:
      String,
    elementType:
      EdgeSamTensorElementType
  )

  case tensorElementCountMismatch(
    tensorName:
      String,
    expected:
      Int,
    received:
      Int
  )

  case nonFiniteTensorValue(
    tensorName:
      String
  )

  case invalidEncoderInputShape(
    expected:
      [Int],
    received:
      [Int]
  )

  case invalidImageSize

  case invalidEncoderEmbeddingRank(
    rank:
      Int
  )

  case invalidEncoderEmbeddingBatch

  case nonFinitePromptPoint

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

  case invalidPromptConfidence(
    confidence:
      Float
  )

  case nonFinitePromptBox

  case invalidPromptBox

  case promptBoxOutsideImage(
    imageWidth:
      Int,
    imageHeight:
      Int
  )

  case insufficientPromptPoints(
    count:
      Int
  )

  case tooManyPromptPoints(
    count:
      Int,
    maximum:
      Int
  )

  case invalidPointCoordinateTensorShape(
    dimensions:
      [Int]
  )

  case invalidPointLabelTensorShape(
    dimensions:
      [Int]
  )

  case invalidMaskDimensions(
    width:
      Int,
    height:
      Int
  )

  case unsafeMaskPixelCount(
    width:
      Int,
    height:
      Int
  )

  case maskElementCountMismatch(
    expected:
      Int,
    received:
      Int
  )

  case nonFiniteMaskValue

  case maskCoordinateOutsideBounds(
    x:
      Int,
    y:
      Int,
    width:
      Int,
    height:
      Int
  )

  case invalidMaskBoundingBox

  case invalidMaskStatistics

  case invalidCandidateIndex(
    index:
      Int
  )

  case invalidCandidateScore(
    index:
      Int
  )

  case invalidDecoderCandidateCount(
    count:
      Int
  )

  case unsafeDecoderOutputSize

  case decoderMaskElementCountMismatch(
    expectedMinimum:
      Int,
    received:
      Int
  )

  case decoderScoreElementCountMismatch(
    expectedMinimum:
      Int,
    received:
      Int
  )

  case noMaskCandidates

  case selectedCandidateOutsideBounds(
    index:
      Int,
    candidateCount:
      Int
  )

  case selectedCandidateMismatch

  case restoredMaskSizeMismatch(
    expectedWidth:
      Int,
    expectedHeight:
      Int,
    receivedWidth:
      Int,
    receivedHeight:
      Int
  )

  case refinedMaskSizeMismatch

  case invalidBackgroundStatistics

  case invalidBackgroundMapDimensions(
    width:
      Int,
    height:
      Int
  )

  case unsafeBackgroundMapPixelCount(
    width:
      Int,
    height:
      Int
  )

  case backgroundMapElementCountMismatch(
    expected:
      Int,
    backgroundConfidence:
      Int,
    foregroundEvidence:
      Int,
    uncertainty:
      Int,
    edgeBarrier:
      Int,
    connectedBackground:
      Int,
    strongBackground:
      Int
  )

  case nonFiniteBackgroundMapValue

  case backgroundResultSizeMismatch

  case invalidStageTiming(
    stage:
      EdgeSamProcessingStage
  )

  case invalidPipelineTiming

  case invalidModelInformation

  case finalMaskSizeMismatch(
    expectedWidth:
      Int,
    expectedHeight:
      Int,
    receivedWidth:
      Int,
    receivedHeight:
      Int
  )

  var errorDescription:
    String? {
    switch self {

    case .missingTensorName:
      return
        "EdgeSAM tensor name is missing."

    case .emptyTensorShape(
      let tensorName
    ):
      return
        "EdgeSAM tensor \(tensorName) has an empty shape."

    case .invalidTensorShape(
      let tensorName,
      let dimensions
    ):
      return
        "EdgeSAM tensor \(tensorName) has invalid dimensions: \(dimensions)."

    case .unsafeTensorElementCount(
      let tensorName,
      let dimensions
    ):
      return
        "EdgeSAM tensor \(tensorName) has an unsafe element count for dimensions \(dimensions)."

    case .unsupportedTensorElementType(
      let tensorName,
      let elementType
    ):
      return
        "EdgeSAM tensor \(tensorName) uses unsupported type \(elementType.rawValue)."

    case .tensorElementCountMismatch(
      let tensorName,
      let expected,
      let received
    ):
      return
        "EdgeSAM tensor \(tensorName) expected \(expected) elements but received \(received)."

    case .nonFiniteTensorValue(
      let tensorName
    ):
      return
        "EdgeSAM tensor \(tensorName) contains non-finite values."

    case .invalidEncoderInputShape(
      let expected,
      let received
    ):
      return
        "EdgeSAM encoder expected shape \(expected) but received \(received)."

    case .invalidImageSize:
      return
        "EdgeSAM received an invalid image size."

    case .invalidEncoderEmbeddingRank(
      let rank
    ):
      return
        "EdgeSAM encoder embedding must have rank four. Received \(rank)."

    case .invalidEncoderEmbeddingBatch:
      return
        "EdgeSAM encoder embedding batch size must be one."

    case .nonFinitePromptPoint:
      return
        "EdgeSAM prompt point contains non-finite coordinates."

    case .promptPointOutsideImage(
      let x,
      let y,
      let imageWidth,
      let imageHeight
    ):
      return
        "EdgeSAM prompt point (\(x), \(y)) is outside \(imageWidth)x\(imageHeight)."

    case .invalidPromptConfidence(
      let confidence
    ):
      return
        "EdgeSAM prompt confidence is invalid: \(confidence)."

    case .nonFinitePromptBox:
      return
        "EdgeSAM prompt box contains non-finite values."

    case .invalidPromptBox:
      return
        "EdgeSAM prompt box dimensions are invalid."

    case .promptBoxOutsideImage(
      let imageWidth,
      let imageHeight
    ):
      return
        "EdgeSAM prompt box is outside \(imageWidth)x\(imageHeight)."

    case .insufficientPromptPoints(
      let count
    ):
      return
        "EdgeSAM requires more prompt points. Received \(count)."

    case .tooManyPromptPoints(
      let count,
      let maximum
    ):
      return
        "EdgeSAM received \(count) prompt points; maximum is \(maximum)."

    case .invalidPointCoordinateTensorShape(
      let dimensions
    ):
      return
        "EdgeSAM point-coordinate tensor has invalid shape \(dimensions)."

    case .invalidPointLabelTensorShape(
      let dimensions
    ):
      return
        "EdgeSAM point-label tensor has invalid shape \(dimensions)."

    case .invalidMaskDimensions(
      let width,
      let height
    ):
      return
        "EdgeSAM mask dimensions are invalid: \(width)x\(height)."

    case .unsafeMaskPixelCount(
      let width,
      let height
    ):
      return
        "EdgeSAM mask pixel count is unsafe: \(width)x\(height)."

    case .maskElementCountMismatch(
      let expected,
      let received
    ):
      return
        "EdgeSAM mask expected \(expected) values but received \(received)."

    case .nonFiniteMaskValue:
      return
        "EdgeSAM mask contains non-finite values."

    case .maskCoordinateOutsideBounds(
      let x,
      let y,
      let width,
      let height
    ):
      return
        "EdgeSAM mask coordinate (\(x), \(y)) is outside \(width)x\(height)."

    case .invalidMaskBoundingBox:
      return
        "EdgeSAM mask bounding box is invalid."

    case .invalidMaskStatistics:
      return
        "EdgeSAM mask statistics are invalid."

    case .invalidCandidateIndex(
      let index
    ):
      return
        "EdgeSAM candidate index is invalid: \(index)."

    case .invalidCandidateScore(
      let index
    ):
      return
        "EdgeSAM candidate \(index) contains an invalid score."

    case .invalidDecoderCandidateCount(
      let count
    ):
      return
        "EdgeSAM decoder candidate count is invalid: \(count)."

    case .unsafeDecoderOutputSize:
      return
        "EdgeSAM decoder output size is unsafe."

    case .decoderMaskElementCountMismatch(
      let expectedMinimum,
      let received
    ):
      return
        "EdgeSAM decoder expected at least \(expectedMinimum) mask values but received \(received)."

    case .decoderScoreElementCountMismatch(
      let expectedMinimum,
      let received
    ):
      return
        "EdgeSAM decoder expected at least \(expectedMinimum) scores but received \(received)."

    case .noMaskCandidates:
      return
        "EdgeSAM did not produce any mask candidates."

    case .selectedCandidateOutsideBounds(
      let index,
      let candidateCount
    ):
      return
        "Selected EdgeSAM candidate \(index) is outside candidate count \(candidateCount)."

    case .selectedCandidateMismatch:
      return
        "Selected EdgeSAM candidate does not match the candidates array."

    case .restoredMaskSizeMismatch(
      let expectedWidth,
      let expectedHeight,
      let receivedWidth,
      let receivedHeight
    ):
      return
        "Restored mask expected \(expectedWidth)x\(expectedHeight) but received \(receivedWidth)x\(receivedHeight)."

    case .refinedMaskSizeMismatch:
      return
        "EdgeSAM refined and source mask sizes do not match."

    case .invalidBackgroundStatistics:
      return
        "EdgeSAM background-understanding statistics are invalid."

    case .invalidBackgroundMapDimensions(
      let width,
      let height
    ):
      return
        "EdgeSAM background map dimensions are invalid: \(width)x\(height)."

    case .unsafeBackgroundMapPixelCount(
      let width,
      let height
    ):
      return
        "EdgeSAM background map pixel count is unsafe: \(width)x\(height)."

    case .backgroundMapElementCountMismatch(
      let expected,
      let backgroundConfidence,
      let foregroundEvidence,
      let uncertainty,
      let edgeBarrier,
      let connectedBackground,
      let strongBackground
    ):
      return
        """
        EdgeSAM background map expected \(expected) values. Received background \(backgroundConfidence), foreground \(foregroundEvidence), uncertainty \(uncertainty), edge barrier \(edgeBarrier), connected \(connectedBackground), strong \(strongBackground).
        """

    case .nonFiniteBackgroundMapValue:
      return
        "EdgeSAM background map contains non-finite values."

    case .backgroundResultSizeMismatch:
      return
        "EdgeSAM background-understanding result sizes do not match."

    case .invalidStageTiming(
      let stage
    ):
      return
        "EdgeSAM timing for stage \(stage.rawValue) is invalid."

    case .invalidPipelineTiming:
      return
        "EdgeSAM pipeline timing is invalid."

    case .invalidModelInformation:
      return
        "EdgeSAM model information is invalid."

    case .finalMaskSizeMismatch(
      let expectedWidth,
      let expectedHeight,
      let receivedWidth,
      let receivedHeight
    ):
      return
        "EdgeSAM final mask expected \(expectedWidth)x\(expectedHeight) but received \(receivedWidth)x\(receivedHeight)."
    }
  }
}