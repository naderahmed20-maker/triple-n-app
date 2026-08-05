//
// EdgeSamNativePromptBuilder.swift
//
// Triple N - Native EdgeSAM Prompt Builder
//
// المسؤوليات:
//
// 1) إنشاء Automatic Prompts للقطعة.
// 2) استقبال Manual Positive / Negative Points.
// 3) تحويل الإحداثيات من الصورة الأصلية إلى مساحة Letterbox.
// 4) إنشاء Bounding Box اختياري.
// 5) احترام الحد الأقصى لعدد النقاط.
// 6) إنشاء EdgeSamPromptSet.
// 7) تجهيز EdgeSamDecoderPromptTensors.
//
// هذا الملف لا يستخدم ONNX Runtime.
// هذا الملف لا يشغّل Encoder أو Decoder.
// هذا الملف لا يكرر Shared Types الموجودة في EdgeSamNativeTypes.swift.
//

import Foundation
import CoreGraphics

// MARK: - Prompt request

enum EdgeSamNativePromptMode:
  String,
  Codable,
  Equatable,
  Sendable {

  case automatic

  case manual
}

// MARK: - Manual point

struct EdgeSamNativeManualPromptPoint:
  Codable,
  Equatable,
  Sendable {

  let x:
    Float

  let y:
    Float

  let positive:
    Bool

  let confidence:
    Float

  init(
    x:
      Float,
    y:
      Float,
    positive:
      Bool,
    confidence:
      Float =
        1
  ) {
    self.x =
      x

    self.y =
      y

    self.positive =
      positive

    self.confidence =
      confidence
  }
}

// MARK: - Prompt request

struct EdgeSamNativePromptRequest:
  Sendable {

  let mode:
    EdgeSamNativePromptMode

  let sourceSize:
    EdgeSamImageSize

  let letterbox:
    EdgeSamLetterbox

  let objectBounds:
    CGRect?

  let manualPoints:
    [EdgeSamNativeManualPromptPoint]

  let includeBoundingBox:
    Bool

  init(
    mode:
      EdgeSamNativePromptMode,
    sourceSize:
      EdgeSamImageSize,
    letterbox:
      EdgeSamLetterbox,
    objectBounds:
      CGRect? =
        nil,
    manualPoints:
      [EdgeSamNativeManualPromptPoint] =
        [],
    includeBoundingBox:
      Bool =
        true
  ) {
    self.mode =
      mode

    self.sourceSize =
      sourceSize

    self.letterbox =
      letterbox

    self.objectBounds =
      objectBounds

    self.manualPoints =
      manualPoints

    self.includeBoundingBox =
      includeBoundingBox
  }
}

// MARK: - Build result

struct EdgeSamNativePromptBuildResult:
  Sendable {

  let promptSet:
    EdgeSamPromptSet

  let decoderTensors:
    EdgeSamDecoderPromptTensors

  let positivePointCount:
    Int

  let negativePointCount:
    Int

  let usedBoundingBox:
    Bool

  let warnings:
    [String]

  let completedAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    [
      "promptSet":
        promptSet
          .asDictionary(),

      "decoderTensors":
        decoderTensors
          .asDictionary(),

      "positivePointCount":
        positivePointCount,

      "negativePointCount":
        negativePointCount,

      "usedBoundingBox":
        usedBoundingBox,

      "warnings":
        warnings,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Builder configuration

struct EdgeSamNativePromptBuilderConfiguration:
  Equatable,
  Sendable {

  let maximumPromptPoints:
    Int

  let includeAutomaticBoundingBox:
    Bool

  let automaticInsetRatio:
    Float

  let automaticNegativeMarginRatio:
    Float

  let defaultPointConfidence:
    Float

  init(
    maximumPromptPoints:
      Int =
        EdgeSamNativeConstants
          .maximumPromptPoints,
    includeAutomaticBoundingBox:
      Bool =
        true,
    automaticInsetRatio:
      Float =
        0.18,
    automaticNegativeMarginRatio:
      Float =
        0.06,
    defaultPointConfidence:
      Float =
        1
  ) {
    self.maximumPromptPoints =
      maximumPromptPoints

    self.includeAutomaticBoundingBox =
      includeAutomaticBoundingBox

    self.automaticInsetRatio =
      automaticInsetRatio

    self.automaticNegativeMarginRatio =
      automaticNegativeMarginRatio

    self.defaultPointConfidence =
      defaultPointConfidence
  }

  func validated()
    throws ->
      EdgeSamNativePromptBuilderConfiguration {
    guard maximumPromptPoints >=
            EdgeSamNativeConstants
              .minimumPromptPoints,
          maximumPromptPoints <=
            EdgeSamNativeConstants
              .maximumPromptPoints else {
      throw EdgeSamNativePromptBuilderError
        .invalidMaximumPromptPointCount(
          maximumPromptPoints
        )
    }

    guard automaticInsetRatio.isFinite,
          automaticInsetRatio >=
            0,
          automaticInsetRatio <
            0.5 else {
      throw EdgeSamNativePromptBuilderError
        .invalidAutomaticInsetRatio(
          automaticInsetRatio
        )
    }

    guard automaticNegativeMarginRatio
            .isFinite,
          automaticNegativeMarginRatio >=
            0,
          automaticNegativeMarginRatio <=
            0.5 else {
      throw EdgeSamNativePromptBuilderError
        .invalidAutomaticNegativeMarginRatio(
          automaticNegativeMarginRatio
        )
    }

    guard defaultPointConfidence.isFinite,
          defaultPointConfidence >=
            0,
          defaultPointConfidence <=
            1 else {
      throw EdgeSamNativePromptBuilderError
        .invalidPointConfidence(
          defaultPointConfidence
        )
    }

    return self
  }
}

// MARK: - Prompt builder

final class EdgeSamNativePromptBuilder:
  @unchecked Sendable {

  private let configuration:
    EdgeSamNativePromptBuilderConfiguration

  init(
    configuration:
      EdgeSamNativePromptBuilderConfiguration =
        EdgeSamNativePromptBuilderConfiguration()
  ) throws {
    self.configuration =
      try configuration
        .validated()
  }

  // MARK: - Public build

  func build(
    request:
      EdgeSamNativePromptRequest
  ) throws ->
      EdgeSamNativePromptBuildResult {
    try validateRequest(
      request
    )

    let createdAt =
      NativeProcessingTime.now()

    var warnings:
      [String] =
        []

    let generated:
      (
        points:
          [EdgeSamPromptPoint],
        boundingBox:
          EdgeSamPromptBox?
      )

    switch request.mode {
    case .automatic:
      generated =
        try buildAutomaticPrompts(
          request:
            request,
          warnings:
            &warnings
        )

    case .manual:
      generated =
        try buildManualPrompts(
          request:
            request,
          warnings:
            &warnings
        )
    }

   let boundingBoxPointCount =
  generated.boundingBox !=
    nil
    ? 2
    : 0

let maximumRegularPointCount =
  max(
    EdgeSamNativeConstants
      .minimumPromptPoints,
    configuration
      .maximumPromptPoints -
    boundingBoxPointCount
  )

let limitedPoints =
  Array(
    generated
      .points
      .prefix(
        maximumRegularPointCount
      )
  )

   if limitedPoints.count <
    generated.points.count {
  warnings.append(
    "Prompt points were limited to \(maximumRegularPointCount) so the total decoder prompt count remains within \(configuration.maximumPromptPoints)."
  )
}

    let modelSize =
      EdgeSamImageSize(
        width:
          request
            .letterbox
            .outputWidth,
        height:
          request
            .letterbox
            .outputHeight
      )

    let promptSet =
      try EdgeSamPromptSet(
        points:
          limitedPoints,
        boundingBox:
          generated.boundingBox,
        sourceSize:
          request.sourceSize,
        modelSize:
          modelSize,
        createdAt:
          createdAt
      )
      .validated()

    let decoderTensors =
      try createDecoderPromptTensors(
        promptSet:
          promptSet
      )

    let positivePointCount =
      limitedPoints
        .filter {
          $0.label ==
            .positive
        }
        .count

    let negativePointCount =
      limitedPoints
        .filter {
          $0.label ==
            .negative
        }
        .count

    return EdgeSamNativePromptBuildResult(
      promptSet:
        promptSet,
      decoderTensors:
        decoderTensors,
      positivePointCount:
        positivePointCount,
      negativePointCount:
        negativePointCount,
      usedBoundingBox:
        generated.boundingBox !=
          nil,
      warnings:
        warnings,
      completedAt:
        createdAt
    )
  }
  // MARK: - Request validation

  private func validateRequest(
    _ request:
      EdgeSamNativePromptRequest
  ) throws {
    guard request.sourceSize.width >
            0,
          request.sourceSize.height >
            0 else {
      throw EdgeSamNativePromptBuilderError
        .invalidSourceImageSize(
          width:
            request.sourceSize.width,
          height:
            request.sourceSize.height
        )
    }

    guard request.letterbox.outputWidth >
            0,
          request.letterbox.outputHeight >
            0 else {
      throw EdgeSamNativePromptBuilderError
        .invalidModelImageSize(
          width:
            request.letterbox.outputWidth,
          height:
            request.letterbox.outputHeight
        )
    }

    guard request.letterbox.scale.isFinite,
          request.letterbox.scale >
            0 else {
      throw EdgeSamNativePromptBuilderError
        .invalidLetterboxScale(
          request.letterbox.scale
        )
    }

    guard request.letterbox.left >=
            0,
          request.letterbox.top >=
            0,
          request.letterbox.right >=
            0,
          request.letterbox.bottom >=
            0 else {
      throw EdgeSamNativePromptBuilderError
        .invalidLetterboxPadding
    }

    let horizontalPadding =
      request.letterbox.left +
      request.letterbox.right

    let verticalPadding =
      request.letterbox.top +
      request.letterbox.bottom

    guard horizontalPadding <
            request.letterbox.outputWidth,
          verticalPadding <
            request.letterbox.outputHeight else {
      throw EdgeSamNativePromptBuilderError
        .invalidLetterboxPadding
    }

    switch request.mode {
    case .automatic:
      if let objectBounds =
          request.objectBounds {
        guard objectBounds.origin.x.isFinite,
              objectBounds.origin.y.isFinite,
              objectBounds.size.width.isFinite,
              objectBounds.size.height.isFinite else {
          throw EdgeSamNativePromptBuilderError
            .nonFiniteObjectBounds
        }

        guard objectBounds.width >
                0,
              objectBounds.height >
                0 else {
          throw EdgeSamNativePromptBuilderError
            .invalidObjectBounds
        }
      }

    case .manual:
      guard !request.manualPoints.isEmpty else {
        throw EdgeSamNativePromptBuilderError
          .manualPromptPointsMissing
      }

      for point in request.manualPoints {
        guard point.x.isFinite,
              point.y.isFinite else {
          throw EdgeSamNativePromptBuilderError
            .nonFiniteManualPromptPoint
        }

        guard point.confidence.isFinite,
              point.confidence >=
                0,
              point.confidence <=
                1 else {
          throw EdgeSamNativePromptBuilderError
            .invalidPointConfidence(
              point.confidence
            )
        }
      }
    }
  }

  // MARK: - Automatic prompts

  private func buildAutomaticPrompts(
    request:
      EdgeSamNativePromptRequest,
    warnings:
      inout [String]
  ) throws ->
      (
        points:
          [EdgeSamPromptPoint],
        boundingBox:
          EdgeSamPromptBox?
      ) {
    let sourceBounds =
      CGRect(
        x:
          0,
        y:
          0,
        width:
          request.sourceSize.width,
        height:
          request.sourceSize.height
      )

    let requestedBounds =
      request.objectBounds ??
      sourceBounds

    let clampedBounds =
      requestedBounds
        .intersection(
          sourceBounds
        )

    guard !clampedBounds.isNull,
          !clampedBounds.isEmpty,
          clampedBounds.width >
            0,
          clampedBounds.height >
            0 else {
      throw EdgeSamNativePromptBuilderError
        .objectBoundsOutsideSourceImage
    }

    if clampedBounds !=
        requestedBounds {
      warnings.append(
        "Automatic prompt bounds were clamped to the source image."
      )
    }

    let insetX =
      clampedBounds.width *
      CGFloat(
        configuration
          .automaticInsetRatio
      )

    let insetY =
      clampedBounds.height *
      CGFloat(
        configuration
          .automaticInsetRatio
      )

    let centerX =
      clampedBounds.midX

    let centerY =
      clampedBounds.midY

    let positiveSourcePoints:
      [CGPoint] =
        [
          CGPoint(
            x:
              centerX,
            y:
              centerY
          ),

          CGPoint(
            x:
              clampedBounds.minX +
              insetX,
            y:
              centerY
          ),

          CGPoint(
            x:
              clampedBounds.maxX -
              insetX,
            y:
              centerY
          ),

          CGPoint(
            x:
              centerX,
            y:
              clampedBounds.minY +
              insetY
          ),

          CGPoint(
            x:
              centerX,
            y:
              clampedBounds.maxY -
              insetY
          )
        ]

    var points:
      [EdgeSamPromptPoint] =
        []

    points.reserveCapacity(
      9
    )

    for sourcePoint in positiveSourcePoints {
      points.append(
        try createMappedPromptPoint(
          sourcePoint:
            sourcePoint,
          label:
            .positive,
          confidence:
            configuration
              .defaultPointConfidence,
          request:
            request
        )
      )
    }

    let negativeMarginX =
      max(
        1,
        clampedBounds.width *
        CGFloat(
          configuration
            .automaticNegativeMarginRatio
        )
      )

    let negativeMarginY =
      max(
        1,
        clampedBounds.height *
        CGFloat(
          configuration
            .automaticNegativeMarginRatio
        )
      )

    let negativeSourcePoints:
      [CGPoint] =
        [
          CGPoint(
            x:
              clampedBounds.minX -
              negativeMarginX,
            y:
              clampedBounds.minY -
              negativeMarginY
          ),

          CGPoint(
            x:
              clampedBounds.maxX +
              negativeMarginX,
            y:
              clampedBounds.minY -
              negativeMarginY
          ),

          CGPoint(
            x:
              clampedBounds.minX -
              negativeMarginX,
            y:
              clampedBounds.maxY +
              negativeMarginY
          ),

          CGPoint(
            x:
              clampedBounds.maxX +
              negativeMarginX,
            y:
              clampedBounds.maxY +
              negativeMarginY
          )
        ]

    for sourcePoint in negativeSourcePoints {
      points.append(
        try createMappedPromptPoint(
          sourcePoint:
            clampSourcePoint(
              sourcePoint,
            sourceSize:
              request.sourceSize
          ),
          label:
            .negative,
          confidence:
            configuration
              .defaultPointConfidence,
          request:
            request
        )
      )
    }

    let shouldIncludeBoundingBox =
      request.includeBoundingBox &&
      configuration
        .includeAutomaticBoundingBox

    let boundingBox:
      EdgeSamPromptBox?

    if shouldIncludeBoundingBox {
      boundingBox =
        try createMappedBoundingBox(
          sourceBounds:
            clampedBounds,
          request:
            request
        )
    } else {
      boundingBox =
        nil
    }

    return (
      points:
        points,
      boundingBox:
        boundingBox
    )
  }

  // MARK: - Manual prompts

  private func buildManualPrompts(
    request:
      EdgeSamNativePromptRequest,
    warnings:
      inout [String]
  ) throws ->
      (
        points:
          [EdgeSamPromptPoint],
        boundingBox:
          EdgeSamPromptBox?
      ) {
    var points:
      [EdgeSamPromptPoint] =
        []

    points.reserveCapacity(
      min(
        request.manualPoints.count,
        configuration
          .maximumPromptPoints
      )
    )

    var didClampPoint =
      false

    for manualPoint in request.manualPoints {
      let sourcePoint =
        CGPoint(
          x:
            CGFloat(
              manualPoint.x
            ),
          y:
            CGFloat(
              manualPoint.y
            )
        )

      let clampedSourcePoint =
        clampSourcePoint(
          sourcePoint,
          sourceSize:
            request.sourceSize
        )

      if clampedSourcePoint !=
          sourcePoint {
        didClampPoint =
          true
      }

      points.append(
        try createMappedPromptPoint(
          sourcePoint:
            clampedSourcePoint,
          label:
            manualPoint.positive
              ? .positive
              : .negative,
          confidence:
            manualPoint.confidence,
          request:
            request
        )
      )
    }

    if didClampPoint {
      warnings.append(
        "One or more manual prompt points were clamped to the source image."
      )
    }

    guard points.contains(
      where: {
        $0.label ==
          .positive
      }
    ) else {
      throw EdgeSamNativePromptBuilderError
        .manualPositivePromptMissing
    }

    let boundingBox:
      EdgeSamPromptBox?

    if request.includeBoundingBox,
       let objectBounds =
         request.objectBounds {
      let sourceBounds =
        CGRect(
          x:
            0,
          y:
            0,
          width:
            request.sourceSize.width,
          height:
            request.sourceSize.height
        )

      let clampedBounds =
        objectBounds
          .intersection(
            sourceBounds
          )

      guard !clampedBounds.isNull,
            !clampedBounds.isEmpty else {
        throw EdgeSamNativePromptBuilderError
          .objectBoundsOutsideSourceImage
      }

      boundingBox =
        try createMappedBoundingBox(
          sourceBounds:
            clampedBounds,
          request:
            request
        )
    } else {
      boundingBox =
        nil
    }

    return (
      points:
        points,
      boundingBox:
        boundingBox
    )
  }

  // MARK: - Coordinate mapping

  private func createMappedPromptPoint(
    sourcePoint:
      CGPoint,
    label:
      EdgeSamPromptLabel,
    confidence:
      Float,
    request:
      EdgeSamNativePromptRequest
  ) throws ->
      EdgeSamPromptPoint {
    let mappedPoint =
      try mapSourcePointToModel(
        sourcePoint,
        sourceSize:
          request.sourceSize,
        letterbox:
          request.letterbox
      )

    return try EdgeSamPromptPoint(
      x:
        Float(
          mappedPoint.x
        ),
      y:
        Float(
          mappedPoint.y
        ),
      label:
        label,
      confidence:
        confidence
    )
    .validated(
      imageSize:
        EdgeSamImageSize(
          width:
            request
              .letterbox
              .outputWidth,
          height:
            request
              .letterbox
              .outputHeight
        )
    )
  }

  private func createMappedBoundingBox(
    sourceBounds:
      CGRect,
    request:
      EdgeSamNativePromptRequest
  ) throws ->
      EdgeSamPromptBox {
    let topLeft =
      try mapSourcePointToModel(
        CGPoint(
          x:
            sourceBounds.minX,
          y:
            sourceBounds.minY
        ),
        sourceSize:
          request.sourceSize,
        letterbox:
          request.letterbox
      )

    let bottomRight =
      try mapSourcePointToModel(
        CGPoint(
          x:
            sourceBounds.maxX,
          y:
            sourceBounds.maxY
        ),
        sourceSize:
          request.sourceSize,
        letterbox:
          request.letterbox
      )

    let modelSize =
      EdgeSamImageSize(
        width:
          request
            .letterbox
            .outputWidth,
        height:
          request
            .letterbox
            .outputHeight
      )

    return try EdgeSamPromptBox(
      left:
        Float(
          min(
            topLeft.x,
            bottomRight.x
          )
        ),
      top:
        Float(
          min(
            topLeft.y,
            bottomRight.y
          )
        ),
      right:
        Float(
          max(
            topLeft.x,
            bottomRight.x
          )
        ),
      bottom:
        Float(
          max(
            topLeft.y,
            bottomRight.y
          )
        )
    )
    .validated(
      imageSize:
        modelSize
    )
  }

  private func mapSourcePointToModel(
    _ sourcePoint:
      CGPoint,
    sourceSize:
      EdgeSamImageSize,
    letterbox:
      EdgeSamLetterbox
  ) throws ->
      CGPoint {
    guard sourcePoint.x.isFinite,
          sourcePoint.y.isFinite else {
      throw EdgeSamNativePromptBuilderError
        .nonFinitePromptPoint
    }

    let clampedPoint =
      clampSourcePoint(
        sourcePoint,
        sourceSize:
          sourceSize
      )

    let mappedX =
      CGFloat(
        letterbox.left
      ) +
      clampedPoint.x *
      CGFloat(
        letterbox.scale
      )

    let mappedY =
      CGFloat(
        letterbox.top
      ) +
      clampedPoint.y *
      CGFloat(
        letterbox.scale
      )

    let maximumX =
      CGFloat(
        max(
          0,
          letterbox.outputWidth -
          1
        )
      )

    let maximumY =
      CGFloat(
        max(
          0,
          letterbox.outputHeight -
          1
        )
      )

    return CGPoint(
      x:
        min(
          maximumX,
          max(
            0,
            mappedX
          )
        ),
      y:
        min(
          maximumY,
          max(
            0,
            mappedY
          )
        )
    )
  }

  private func clampSourcePoint(
    _ point:
      CGPoint,
    sourceSize:
      EdgeSamImageSize
  ) -> CGPoint {
    let maximumX =
      CGFloat(
        max(
          0,
          sourceSize.width -
          1
        )
      )

    let maximumY =
      CGFloat(
        max(
          0,
          sourceSize.height -
          1
        )
      )

    return CGPoint(
      x:
        min(
          maximumX,
          max(
            0,
            point.x
          )
        ),
      y:
        min(
          maximumY,
          max(
            0,
            point.y
          )
        )
    )
  }
  // MARK: - Decoder tensor creation

  private func createDecoderPromptTensors(
    promptSet:
      EdgeSamPromptSet
  ) throws ->
      EdgeSamDecoderPromptTensors {
    let validatedPromptSet =
      try promptSet
        .validated()

    var coordinates:
      [Float] =
        []

    var labels:
      [Float] =
        []

   let regularPointCount =
  validatedPromptSet
    .points
    .count

let boundingBoxPointCount =
  validatedPromptSet
    .boundingBox !=
    nil
    ? 2
    : 0

let decoderPointCount =
  regularPointCount +
  boundingBoxPointCount

guard decoderPointCount >=
        EdgeSamNativeConstants
          .minimumPromptPoints,
      decoderPointCount <=
        EdgeSamNativeConstants
          .maximumPromptPoints else {
  throw EdgeSamNativePromptBuilderError
    .decoderPromptPointCountOutOfRange(
      received:
        decoderPointCount,
      minimum:
        EdgeSamNativeConstants
          .minimumPromptPoints,
      maximum:
        EdgeSamNativeConstants
          .maximumPromptPoints
    )
}

coordinates.reserveCapacity(
  decoderPointCount *
  2
)

labels.reserveCapacity(
  decoderPointCount
)

    for point in
      validatedPromptSet.points {
      coordinates.append(
        point.x
      )

      coordinates.append(
        point.y
      )

      labels.append(
        Float(
          point
            .label
            .rawValue
        )
      )
    }

    if let boundingBox =
        validatedPromptSet
          .boundingBox {
      coordinates.append(
        boundingBox.left
      )

      coordinates.append(
        boundingBox.top
      )

      labels.append(
        Float(
          EdgeSamPromptLabel
            .boxTopLeft
            .rawValue
        )
      )

      coordinates.append(
        boundingBox.right
      )

      coordinates.append(
        boundingBox.bottom
      )

      labels.append(
        Float(
          EdgeSamPromptLabel
            .boxBottomRight
            .rawValue
        )
      )
    }

   guard labels.count ==
        decoderPointCount,
      coordinates.count ==
        decoderPointCount *
        2 else {
  throw EdgeSamNativePromptBuilderError
    .decoderPromptElementCountMismatch(
      expectedPointCount:
        decoderPointCount,
      coordinateValueCount:
        coordinates.count,
      labelValueCount:
        labels.count
    )
}

    let pointCoordinatesMetadata =
      try EdgeSamTensorMetadata(
        name:
          "point_coords",
        dimensions:
          [
            1,
            decoderPointCount,
            2
          ],
        elementType:
          .float32,
        layout:
          .unknown
      )
      .validated()

    let pointCoordinates =
      try EdgeSamFloatTensor(
        metadata:
          pointCoordinatesMetadata,
        values:
          ContiguousArray(
            coordinates
          )
      )
      .validated()

    let pointLabelsMetadata =
      try EdgeSamTensorMetadata(
        name:
          "point_labels",
        dimensions:
          [
            1,
            decoderPointCount,
          ],
        elementType:
          .float32,
        layout:
          .unknown
      )
      .validated()

    let pointLabels =
      try EdgeSamFloatTensor(
        metadata:
          pointLabelsMetadata,
        values:
          ContiguousArray(
            labels
          )
      )
      .validated()

    let decoderMaskWidth =
      EdgeSamNativeConstants
        .decoderMaskSize

    let decoderMaskHeight =
      EdgeSamNativeConstants
        .decoderMaskSize

    let maskPixelCountResult =
      decoderMaskWidth
        .multipliedReportingOverflow(
          by:
            decoderMaskHeight
        )

    guard !maskPixelCountResult
            .overflow,
          maskPixelCountResult
            .partialValue >
            0 else {
      throw EdgeSamNativePromptBuilderError
        .unsafeMaskInputSize
    }

    let maskInputMetadata =
      try EdgeSamTensorMetadata(
        name:
          "mask_input",
        dimensions:
          [
            1,
            1,
            decoderMaskHeight,
            decoderMaskWidth
          ],
        elementType:
          .float32,
        layout:
          .nchw
      )
      .validated()

    let maskInput =
      try EdgeSamFloatTensor(
        metadata:
          maskInputMetadata,
        values:
          ContiguousArray<Float>(
            repeating:
              0,
            count:
              maskPixelCountResult
                .partialValue
          )
      )
      .validated()

    let hasMaskInputMetadata =
      try EdgeSamTensorMetadata(
        name:
          "has_mask_input",
        dimensions:
          [
            1
          ],
        elementType:
          .float32,
        layout:
          .unknown
      )
      .validated()

    let hasMaskInput =
      try EdgeSamFloatTensor(
        metadata:
          hasMaskInputMetadata,
        values:
          ContiguousArray(
            [
              Float(
                0
              )
            ]
          )
      )
      .validated()

    let originalImageSizeMetadata =
      try EdgeSamTensorMetadata(
        name:
          "orig_im_size",
        dimensions:
          [
            2
          ],
        elementType:
          .float32,
        layout:
          .unknown
      )
      .validated()

    /*
     * ترتيب EdgeSAM / SAM:
     *
     * [height, width]
     *
     * وليس [width, height].
     */
    let originalImageSize =
      try EdgeSamFloatTensor(
        metadata:
          originalImageSizeMetadata,
        values:
          ContiguousArray(
            [
              Float(
                validatedPromptSet
                  .sourceSize
                  .height
              ),
              Float(
                validatedPromptSet
                  .sourceSize
                  .width
              )
            ]
          )
      )
      .validated()

    return try EdgeSamDecoderPromptTensors(
      pointCoordinates:
        pointCoordinates,
      pointLabels:
        pointLabels,
      maskInput:
        maskInput,
      hasMaskInput:
        hasMaskInput,
      originalImageSize:
        originalImageSize
    )
    .validated()
  }
}

// MARK: - Prompt builder errors

enum EdgeSamNativePromptBuilderError:
  LocalizedError,
  Equatable,
  Sendable {

  case invalidMaximumPromptPointCount(
    Int
  )

  case invalidAutomaticInsetRatio(
    Float
  )

  case invalidAutomaticNegativeMarginRatio(
    Float
  )

  case invalidPointConfidence(
    Float
  )

  case invalidSourceImageSize(
    width:
      Int,
    height:
      Int
  )

  case invalidModelImageSize(
    width:
      Int,
    height:
      Int
  )

  case invalidLetterboxScale(
    Float
  )

  case invalidLetterboxPadding

  case nonFiniteObjectBounds

  case invalidObjectBounds

  case objectBoundsOutsideSourceImage

  case manualPromptPointsMissing

  case manualPositivePromptMissing

  case nonFiniteManualPromptPoint

  case nonFinitePromptPoint

  case decoderPromptPointCountOutOfRange(
  received:
    Int,
  minimum:
    Int,
  maximum:
    Int
)



  case decoderPromptElementCountMismatch(
    expectedPointCount:
      Int,
    coordinateValueCount:
      Int,
    labelValueCount:
      Int
  )

  case unsafeMaskInputSize

  var errorDescription:
    String? {
    switch self {
    case .invalidMaximumPromptPointCount(
      let count
    ):
      return
        """
        EdgeSAM maximum prompt point count is invalid: \(count).
        """

    case .invalidAutomaticInsetRatio(
      let value
    ):
      return
        """
        EdgeSAM automatic prompt inset ratio is invalid: \(value).
        """

    case .invalidAutomaticNegativeMarginRatio(
      let value
    ):
      return
        """
        EdgeSAM automatic negative margin ratio is invalid: \(value).
        """

    case .invalidPointConfidence(
      let value
    ):
      return
        """
        EdgeSAM prompt confidence must be between zero and one. Received \(value).
        """

    case .invalidSourceImageSize(
      let width,
      let height
    ):
      return
        """
        EdgeSAM prompt source image size is invalid: \(width)x\(height).
        """

    case .invalidModelImageSize(
      let width,
      let height
    ):
      return
        """
        EdgeSAM prompt model image size is invalid: \(width)x\(height).
        """

    case .invalidLetterboxScale(
      let scale
    ):
      return
        """
        EdgeSAM prompt letterbox scale is invalid: \(scale).
        """

    case .invalidLetterboxPadding:
      return
        """
        EdgeSAM prompt letterbox padding is invalid.
        """

    case .nonFiniteObjectBounds:
      return
        """
        EdgeSAM automatic object bounds contain non-finite values.
        """

    case .invalidObjectBounds:
      return
        """
        EdgeSAM automatic object bounds must have positive width and height.
        """

    case .objectBoundsOutsideSourceImage:
      return
        """
        EdgeSAM object bounds do not intersect the source image.
        """

    case .manualPromptPointsMissing:
      return
        """
        EdgeSAM manual prompting requires at least one point.
        """

    case .manualPositivePromptMissing:
      return
        """
        EdgeSAM manual prompting requires at least one positive point.
        """

    case .nonFiniteManualPromptPoint:
      return
        """
        EdgeSAM manual prompt contains non-finite coordinates.
        """

    case .nonFinitePromptPoint:
      return
        """
        EdgeSAM prompt mapping produced non-finite coordinates.
        """

        case .decoderPromptPointCountOutOfRange(
  let received,
  let minimum,
  let maximum
):
  return
    """
    EdgeSAM decoder prompt count \(received) is outside the supported range \(minimum)...\(maximum).
    """

    case .decoderPromptElementCountMismatch(
      let expectedPointCount,
      let coordinateValueCount,
      let labelValueCount
    ):
      return
        """
        EdgeSAM decoder prompt tensor sizes are inconsistent. Expected \(expectedPointCount) points, received \(coordinateValueCount) coordinate values and \(labelValueCount) labels.
        """

    case .unsafeMaskInputSize:
      return
        """
        EdgeSAM decoder mask input size is unsafe.
        """
    }
  }
}