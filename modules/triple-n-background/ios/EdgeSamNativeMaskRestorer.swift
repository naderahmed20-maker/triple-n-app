//
// EdgeSamNativeMaskRestorer.swift
//
// Triple N - Native EdgeSAM Mask Restorer
//
// مسؤوليات هذا الملف:
//
// 1) استقبال الـMask المختارة من Decoder.
// 2) إزالة Letterbox Padding.
// 3) استخراج مساحة الصورة التي دخلت الموديل فعليًا.
// 4) Resize للـMask إلى أبعاد الصورة الأصلية.
// 5) الحفاظ على قيم Float بدون تحويل مبكر إلى Binary.
// 6) منع Overflow والـBuffers غير الآمنة.
// 7) دعم Cancellation أثناء المعالجة الكبيرة.
// 8) إرجاع EdgeSamFloatMask بالحجم الأصلي.
//
// هذا الملف لا يختار أفضل Candidate.
// هذا الملف لا ينفذ Morphology أو Feather.
// هذا الملف لا ينفذ Background Understanding.
// هذا الملف لا يصدر PNG.
//

import Foundation

// MARK: - Restoration interpolation

enum EdgeSamNativeMaskRestorationInterpolation:
  String,
  Codable,
  Equatable,
  Sendable {

  case bilinear

  case nearestNeighbor
}

// MARK: - Restorer configuration

struct EdgeSamNativeMaskRestorerConfiguration:
  Equatable,
  Sendable {

  let interpolation:
    EdgeSamNativeMaskRestorationInterpolation

  let maximumOutputPixels:
    Int

  let cancellationCheckRowInterval:
    Int

  let clampOutputValues:
    Bool

  let minimumOutputValue:
    Float

  let maximumOutputValue:
    Float

  init(
    interpolation:
      EdgeSamNativeMaskRestorationInterpolation =
        .bilinear,
    maximumOutputPixels:
      Int =
        64 * 1024 * 1024,
    cancellationCheckRowInterval:
      Int =
        32,
    clampOutputValues:
      Bool =
        false,
    minimumOutputValue:
      Float =
        -Float.greatestFiniteMagnitude,
    maximumOutputValue:
      Float =
        Float.greatestFiniteMagnitude
  ) {
    self.interpolation =
      interpolation

    self.maximumOutputPixels =
      maximumOutputPixels

    self.cancellationCheckRowInterval =
      cancellationCheckRowInterval

    self.clampOutputValues =
      clampOutputValues

    self.minimumOutputValue =
      minimumOutputValue

    self.maximumOutputValue =
      maximumOutputValue
  }

  func validated()
    throws ->
      EdgeSamNativeMaskRestorerConfiguration {
    guard maximumOutputPixels >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidMaximumOutputPixels(
          maximumOutputPixels
        )
    }

    guard cancellationCheckRowInterval >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidCancellationCheckInterval(
          cancellationCheckRowInterval
        )
    }

    guard minimumOutputValue.isFinite,
          maximumOutputValue.isFinite,
          minimumOutputValue <=
            maximumOutputValue else {
      throw EdgeSamNativeMaskRestorerError
        .invalidOutputValueRange(
          minimum:
            minimumOutputValue,
          maximum:
            maximumOutputValue
        )
    }

    return self
  }
}

// MARK: - Restoration request

struct EdgeSamNativeMaskRestorationRequest:
  Sendable {

  let mask:
    EdgeSamFloatMask

  let sourceSize:
    EdgeSamImageSize

  let modelSize:
    EdgeSamImageSize

  let letterbox:
    EdgeSamLetterbox

  let cancellationToken:
    NativeScanCancellationToken?

  init(
    mask:
      EdgeSamFloatMask,
    sourceSize:
      EdgeSamImageSize,
    modelSize:
      EdgeSamImageSize,
    letterbox:
      EdgeSamLetterbox,
    cancellationToken:
      NativeScanCancellationToken? =
        nil
  ) {
    self.mask =
      mask

    self.sourceSize =
      sourceSize

    self.modelSize =
      modelSize

    self.letterbox =
      letterbox

    self.cancellationToken =
      cancellationToken
  }
}

// MARK: - Restoration diagnostics

struct EdgeSamNativeMaskRestorationDiagnostics:
  Equatable,
  Sendable {

  let decoderMaskWidth:
    Int

  let decoderMaskHeight:
    Int

  let modelWidth:
    Int

  let modelHeight:
    Int

  let resizedContentWidth:
    Int

  let resizedContentHeight:
    Int

  let cropLeft:
    Int

  let cropTop:
    Int

  let cropWidth:
    Int

  let cropHeight:
    Int

  let outputWidth:
    Int

  let outputHeight:
    Int

  let interpolation:
    EdgeSamNativeMaskRestorationInterpolation

  let minimumInputValue:
    Float

  let maximumInputValue:
    Float

  let minimumOutputValue:
    Float

  let maximumOutputValue:
    Float

  let durationMs:
    Int64

  let completedAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    [
      "decoderMaskWidth":
        decoderMaskWidth,

      "decoderMaskHeight":
        decoderMaskHeight,

      "modelWidth":
        modelWidth,

      "modelHeight":
        modelHeight,

      "resizedContentWidth":
        resizedContentWidth,

      "resizedContentHeight":
        resizedContentHeight,

      "cropLeft":
        cropLeft,

      "cropTop":
        cropTop,

      "cropWidth":
        cropWidth,

      "cropHeight":
        cropHeight,

      "outputWidth":
        outputWidth,

      "outputHeight":
        outputHeight,

      "interpolation":
        interpolation.rawValue,

      "minimumInputValue":
        minimumInputValue,

      "maximumInputValue":
        maximumInputValue,

      "minimumOutputValue":
        minimumOutputValue,

      "maximumOutputValue":
        maximumOutputValue,

      "durationMs":
        durationMs,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Restoration result

struct EdgeSamNativeMaskRestorationResult:
  Sendable {

  let mask:
    EdgeSamFloatMask

  let diagnostics:
    EdgeSamNativeMaskRestorationDiagnostics
}

// MARK: - Calculated geometry

private struct EdgeSamNativeMaskRestorationGeometry:
  Equatable,
  Sendable {

  let decoderMaskWidth:
    Int

  let decoderMaskHeight:
    Int

  let modelWidth:
    Int

  let modelHeight:
    Int

  let resizedContentWidth:
    Int

  let resizedContentHeight:
    Int

  let cropLeft:
    Int

  let cropTop:
    Int

  let cropWidth:
    Int

  let cropHeight:
    Int

  let outputWidth:
    Int

  let outputHeight:
    Int
}

// MARK: - Mask restorer

final class EdgeSamNativeMaskRestorer:
  @unchecked Sendable {

  private let configuration:
    EdgeSamNativeMaskRestorerConfiguration

  init(
    configuration:
      EdgeSamNativeMaskRestorerConfiguration =
        EdgeSamNativeMaskRestorerConfiguration()
  ) throws {
    self.configuration =
      try configuration
        .validated()
  }

  // MARK: - Public restoration

  func restore(
    request:
      EdgeSamNativeMaskRestorationRequest
  ) throws ->
      EdgeSamNativeMaskRestorationResult {
    let operationStartedAt =
      NativeProcessingTime.now()

    try request
      .cancellationToken?
      .throwIfCancelled()

    let validatedMask =
      try request.mask
        .validated()

    try validateRequest(
      request,
      validatedMask:
        validatedMask
    )

    let geometry =
      try calculateGeometry(
        mask:
          validatedMask,
        sourceSize:
          request.sourceSize,
        modelSize:
          request.modelSize,
        letterbox:
          request.letterbox
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let croppedMask =
      try cropMask(
        validatedMask,
        geometry:
          geometry,
        cancellationToken:
          request.cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let restoredMask =
      try resizeMask(
        croppedMask,
        outputWidth:
          geometry.outputWidth,
        outputHeight:
          geometry.outputHeight,
        cancellationToken:
          request.cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let completedAt =
      NativeProcessingTime.now()

    let inputRange =
      calculateValueRange(
        validatedMask.values
      )

    let outputRange =
      calculateValueRange(
        restoredMask.values
      )

    let diagnostics =
      EdgeSamNativeMaskRestorationDiagnostics(
        decoderMaskWidth:
          geometry.decoderMaskWidth,
        decoderMaskHeight:
          geometry.decoderMaskHeight,
        modelWidth:
          geometry.modelWidth,
        modelHeight:
          geometry.modelHeight,
        resizedContentWidth:
          geometry.resizedContentWidth,
        resizedContentHeight:
          geometry.resizedContentHeight,
        cropLeft:
          geometry.cropLeft,
        cropTop:
          geometry.cropTop,
        cropWidth:
          geometry.cropWidth,
        cropHeight:
          geometry.cropHeight,
        outputWidth:
          geometry.outputWidth,
        outputHeight:
          geometry.outputHeight,
        interpolation:
          configuration.interpolation,
        minimumInputValue:
          inputRange.minimum,
        maximumInputValue:
          inputRange.maximum,
        minimumOutputValue:
          outputRange.minimum,
        maximumOutputValue:
          outputRange.maximum,
        durationMs:
          max(
            0,
            completedAt -
            operationStartedAt
          ),
        completedAt:
          completedAt
      )

    return EdgeSamNativeMaskRestorationResult(
      mask:
        restoredMask,
      diagnostics:
        diagnostics
    )
  }

  // MARK: - Request validation

  private func validateRequest(
    _ request:
      EdgeSamNativeMaskRestorationRequest,
    validatedMask:
      EdgeSamFloatMask
  ) throws {
    guard request.sourceSize.width >
            0,
          request.sourceSize.height >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidSourceSize(
          width:
            request.sourceSize.width,
          height:
            request.sourceSize.height
        )
    }

    guard request.modelSize.width >
            0,
          request.modelSize.height >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidModelSize(
          width:
            request.modelSize.width,
          height:
            request.modelSize.height
        )
    }

    guard request.letterbox.outputWidth ==
            request.modelSize.width,
          request.letterbox.outputHeight ==
            request.modelSize.height else {
      throw EdgeSamNativeMaskRestorerError
        .letterboxModelSizeMismatch(
          modelWidth:
            request.modelSize.width,
          modelHeight:
            request.modelSize.height,
          letterboxWidth:
            request.letterbox.outputWidth,
          letterboxHeight:
            request.letterbox.outputHeight
        )
    }

    guard request.letterbox.scale.isFinite,
          request.letterbox.scale >
            0 else {
      throw EdgeSamNativeMaskRestorerError
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
      throw EdgeSamNativeMaskRestorerError
        .invalidLetterboxPadding
    }

    let horizontalPaddingResult =
      request.letterbox.left
        .addingReportingOverflow(
          request.letterbox.right
        )

    let verticalPaddingResult =
      request.letterbox.top
        .addingReportingOverflow(
          request.letterbox.bottom
        )

    guard !horizontalPaddingResult
            .overflow,
          !verticalPaddingResult
            .overflow else {
      throw EdgeSamNativeMaskRestorerError
        .integerOverflow
    }

    guard horizontalPaddingResult
            .partialValue <
            request.modelSize.width,
          verticalPaddingResult
            .partialValue <
            request.modelSize.height else {
      throw EdgeSamNativeMaskRestorerError
        .invalidLetterboxPadding
    }

    let outputPixelCount =
      try safePixelCount(
        width:
          request.sourceSize.width,
        height:
          request.sourceSize.height
      )

    guard outputPixelCount <=
            configuration
              .maximumOutputPixels else {
      throw EdgeSamNativeMaskRestorerError
        .unsafeOutputPixelCount(
          width:
            request.sourceSize.width,
          height:
            request.sourceSize.height,
          pixelCount:
            outputPixelCount,
          maximum:
            configuration
              .maximumOutputPixels
        )
    }

    _ =
      try safePixelCount(
        width:
          validatedMask.width,
        height:
          validatedMask.height
      )

    guard !validatedMask.values.isEmpty else {
      throw EdgeSamNativeMaskRestorerError
        .emptyInputMask
    }
  }
  // MARK: - Geometry calculation

  private func calculateGeometry(
    mask:
      EdgeSamFloatMask,
    sourceSize:
      EdgeSamImageSize,
    modelSize:
      EdgeSamImageSize,
    letterbox:
      EdgeSamLetterbox
  ) throws ->
      EdgeSamNativeMaskRestorationGeometry {
    let decoderMaskWidth =
      mask.width

    let decoderMaskHeight =
      mask.height

    let resizedContentWidth =
      modelSize.width -
      letterbox.left -
      letterbox.right

    let resizedContentHeight =
      modelSize.height -
      letterbox.top -
      letterbox.bottom

    guard resizedContentWidth >
            0,
          resizedContentHeight >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidResizedContentSize(
          width:
            resizedContentWidth,
          height:
            resizedContentHeight
        )
    }

    let horizontalDecoderScale =
      Double(
        decoderMaskWidth
      ) /
      Double(
        modelSize.width
      )

    let verticalDecoderScale =
      Double(
        decoderMaskHeight
      ) /
      Double(
        modelSize.height
      )

    guard horizontalDecoderScale.isFinite,
          verticalDecoderScale.isFinite,
          horizontalDecoderScale >
            0,
          verticalDecoderScale >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidDecoderToModelScale
    }

    let rawCropLeft =
      Double(
        letterbox.left
      ) *
      horizontalDecoderScale

    let rawCropTop =
      Double(
        letterbox.top
      ) *
      verticalDecoderScale

    let rawCropRight =
      Double(
        modelSize.width -
        letterbox.right
      ) *
      horizontalDecoderScale

    let rawCropBottom =
      Double(
        modelSize.height -
        letterbox.bottom
      ) *
      verticalDecoderScale

    /*
     * بداية الـCrop تُقرب لأسفل،
     * والنهاية تُقرب لأعلى،
     * حتى لا نفقد أي جزء من حدود القطعة.
     */
    let cropLeft =
      min(
        decoderMaskWidth -
        1,
        max(
          0,
          Int(
            floor(
              rawCropLeft
            )
          )
        )
      )

    let cropTop =
      min(
        decoderMaskHeight -
        1,
        max(
          0,
          Int(
            floor(
              rawCropTop
            )
          )
        )
      )

    let cropRightExclusive =
      min(
        decoderMaskWidth,
        max(
          cropLeft +
          1,
          Int(
            ceil(
              rawCropRight
            )
          )
        )
      )

    let cropBottomExclusive =
      min(
        decoderMaskHeight,
        max(
          cropTop +
          1,
          Int(
            ceil(
              rawCropBottom
            )
          )
        )
      )

    let cropWidth =
      cropRightExclusive -
      cropLeft

    let cropHeight =
      cropBottomExclusive -
      cropTop

    guard cropWidth >
            0,
          cropHeight >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidCropSize(
          left:
            cropLeft,
          top:
            cropTop,
          width:
            cropWidth,
          height:
            cropHeight
        )
    }

    guard cropLeft +
            cropWidth <=
            decoderMaskWidth,
          cropTop +
            cropHeight <=
            decoderMaskHeight else {
      throw EdgeSamNativeMaskRestorerError
        .cropOutsideDecoderMask
    }

    _ =
      try safePixelCount(
        width:
          cropWidth,
        height:
          cropHeight
      )

    return EdgeSamNativeMaskRestorationGeometry(
      decoderMaskWidth:
        decoderMaskWidth,
      decoderMaskHeight:
        decoderMaskHeight,
      modelWidth:
        modelSize.width,
      modelHeight:
        modelSize.height,
      resizedContentWidth:
        resizedContentWidth,
      resizedContentHeight:
        resizedContentHeight,
      cropLeft:
        cropLeft,
      cropTop:
        cropTop,
      cropWidth:
        cropWidth,
      cropHeight:
        cropHeight,
      outputWidth:
        sourceSize.width,
      outputHeight:
        sourceSize.height
    )
  }

  // MARK: - Crop letterbox

  private func cropMask(
    _ mask:
      EdgeSamFloatMask,
    geometry:
      EdgeSamNativeMaskRestorationGeometry,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {
    let cropPixelCount =
      try safePixelCount(
        width:
          geometry.cropWidth,
        height:
          geometry.cropHeight
      )

    var croppedValues =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          cropPixelCount
      )

    for destinationY in
      0..<geometry.cropHeight {
      if destinationY %
          configuration
            .cancellationCheckRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let sourceY =
        geometry.cropTop +
        destinationY

      let sourceRowOffsetResult =
        sourceY
          .multipliedReportingOverflow(
            by:
              geometry.decoderMaskWidth
          )

      let destinationRowOffsetResult =
        destinationY
          .multipliedReportingOverflow(
            by:
              geometry.cropWidth
          )

      guard !sourceRowOffsetResult
              .overflow,
            !destinationRowOffsetResult
              .overflow else {
        throw EdgeSamNativeMaskRestorerError
          .integerOverflow
      }

      let sourceStartResult =
        sourceRowOffsetResult
          .partialValue
          .addingReportingOverflow(
            geometry.cropLeft
          )

      guard !sourceStartResult
              .overflow else {
        throw EdgeSamNativeMaskRestorerError
          .integerOverflow
      }

      let sourceStart =
        sourceStartResult
          .partialValue

      let sourceEndResult =
        sourceStart
          .addingReportingOverflow(
            geometry.cropWidth
          )

      guard !sourceEndResult
              .overflow else {
        throw EdgeSamNativeMaskRestorerError
          .integerOverflow
      }

      let sourceEnd =
        sourceEndResult
          .partialValue

      let destinationStart =
        destinationRowOffsetResult
          .partialValue

      let destinationEndResult =
        destinationStart
          .addingReportingOverflow(
            geometry.cropWidth
          )

      guard !destinationEndResult
              .overflow else {
        throw EdgeSamNativeMaskRestorerError
          .integerOverflow
      }

      let destinationEnd =
        destinationEndResult
          .partialValue

      guard sourceStart >=
              0,
            sourceEnd <=
              mask.values.count,
            destinationStart >=
              0,
            destinationEnd <=
              croppedValues.count else {
        throw EdgeSamNativeMaskRestorerError
          .cropRangeOutOfBounds
      }

      croppedValues
        .replaceSubrange(
          destinationStart..<destinationEnd,
          with:
            mask.values[
              sourceStart..<sourceEnd
            ]
        )
    }

    try cancellationToken?
      .throwIfCancelled()

    return try EdgeSamFloatMask(
      width:
        geometry.cropWidth,
      height:
        geometry.cropHeight,
      values:
        croppedValues
    )
    .validated()
  }

  // MARK: - Resize mask

  private func resizeMask(
    _ mask:
      EdgeSamFloatMask,
    outputWidth:
      Int,
    outputHeight:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {
    let validatedMask =
      try mask
        .validated()

    guard outputWidth >
            0,
          outputHeight >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidOutputSize(
          width:
            outputWidth,
          height:
            outputHeight
        )
    }

    let outputPixelCount =
      try safePixelCount(
        width:
          outputWidth,
        height:
          outputHeight
      )

    guard outputPixelCount <=
            configuration
              .maximumOutputPixels else {
      throw EdgeSamNativeMaskRestorerError
        .unsafeOutputPixelCount(
          width:
            outputWidth,
          height:
            outputHeight,
          pixelCount:
            outputPixelCount,
          maximum:
            configuration
              .maximumOutputPixels
        )
    }

    if validatedMask.width ==
        outputWidth,
       validatedMask.height ==
        outputHeight {
      return try clampMaskIfNeeded(
        validatedMask,
        cancellationToken:
          cancellationToken
      )
    }

    switch configuration.interpolation {
    case .bilinear:
      return try resizeMaskBilinear(
        validatedMask,
        outputWidth:
          outputWidth,
        outputHeight:
          outputHeight,
        cancellationToken:
          cancellationToken
      )

    case .nearestNeighbor:
      return try resizeMaskNearestNeighbor(
        validatedMask,
        outputWidth:
          outputWidth,
        outputHeight:
          outputHeight,
        cancellationToken:
          cancellationToken
      )
    }
  }

  // MARK: - Bilinear resize

  private func resizeMaskBilinear(
    _ mask:
      EdgeSamFloatMask,
    outputWidth:
      Int,
    outputHeight:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {
    let outputPixelCount =
      try safePixelCount(
        width:
          outputWidth,
        height:
          outputHeight
      )

    var outputValues =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          outputPixelCount
      )

    let sourceWidth =
      mask.width

    let sourceHeight =
      mask.height

    let horizontalScale =
      Double(
        sourceWidth
      ) /
      Double(
        outputWidth
      )

    let verticalScale =
      Double(
        sourceHeight
      ) /
      Double(
        outputHeight
      )

    guard horizontalScale.isFinite,
          verticalScale.isFinite,
          horizontalScale >
            0,
          verticalScale >
            0 else {
      throw EdgeSamNativeMaskRestorerError
        .invalidResizeScale
    }

    for outputY in
      0..<outputHeight {
      if outputY %
          configuration
            .cancellationCheckRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let sourceY =
        (
          Double(
            outputY
          ) +
          0.5
        ) *
        verticalScale -
        0.5

      let sourceY0 =
        max(
          0,
          min(
            sourceHeight -
            1,
            Int(
              floor(
                sourceY
              )
            )
          )
        )

      let sourceY1 =
        min(
          sourceHeight -
          1,
          sourceY0 +
          1
        )

      let verticalWeight =
        Float(
          min(
            1,
            max(
              0,
              sourceY -
              Double(
                sourceY0
              )
            )
          )
        )

      let sourceRow0 =
        sourceY0 *
        sourceWidth

      let sourceRow1 =
        sourceY1 *
        sourceWidth

      let outputRow =
        outputY *
        outputWidth

      for outputX in
        0..<outputWidth {
        let sourceX =
          (
            Double(
              outputX
            ) +
            0.5
          ) *
          horizontalScale -
          0.5

        let sourceX0 =
          max(
            0,
            min(
              sourceWidth -
              1,
              Int(
                floor(
                  sourceX
                )
              )
            )
          )

        let sourceX1 =
          min(
            sourceWidth -
            1,
            sourceX0 +
            1
          )

        let horizontalWeight =
          Float(
            min(
              1,
              max(
                0,
                sourceX -
                Double(
                  sourceX0
                )
              )
            )
          )

        let topLeft =
          mask.values[
            sourceRow0 +
            sourceX0
          ]

        let topRight =
          mask.values[
            sourceRow0 +
            sourceX1
          ]

        let bottomLeft =
          mask.values[
            sourceRow1 +
            sourceX0
          ]

        let bottomRight =
          mask.values[
            sourceRow1 +
            sourceX1
          ]

        let top =
          topLeft +
          (
            topRight -
            topLeft
          ) *
          horizontalWeight

        let bottom =
          bottomLeft +
          (
            bottomRight -
            bottomLeft
          ) *
          horizontalWeight

        var value =
          top +
          (
            bottom -
            top
          ) *
          verticalWeight

        if configuration
            .clampOutputValues {
          value =
            min(
              configuration
                .maximumOutputValue,
              max(
                configuration
                  .minimumOutputValue,
                value
              )
            )
        }

        outputValues[
          outputRow +
          outputX
        ] =
          value
      }
    }

    try cancellationToken?
      .throwIfCancelled()

    return try EdgeSamFloatMask(
      width:
        outputWidth,
      height:
        outputHeight,
      values:
        outputValues
    )
    .validated()
  }
  // MARK: - Nearest-neighbor resize

  private func resizeMaskNearestNeighbor(
    _ mask:
      EdgeSamFloatMask,
    outputWidth:
      Int,
    outputHeight:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {

    let outputPixelCount =
      try safePixelCount(
        width: outputWidth,
        height: outputHeight
      )

    var outputValues =
      ContiguousArray<Float>(
        repeating: 0,
        count: outputPixelCount
      )

    let scaleX =
      Double(mask.width) /
      Double(outputWidth)

    let scaleY =
      Double(mask.height) /
      Double(outputHeight)

    for outputY in
      0..<outputHeight {

      if outputY %
          configuration
            .cancellationCheckRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let sourceY =
        min(
          mask.height - 1,
          max(
            0,
            Int(
              (
                Double(outputY) +
                0.5
              ) *
              scaleY
            )
          )
        )

      let sourceRow =
        sourceY *
        mask.width

      let destinationRow =
        outputY *
        outputWidth

      for outputX in
        0..<outputWidth {

        let sourceX =
          min(
            mask.width - 1,
            max(
              0,
              Int(
                (
                  Double(outputX) +
                  0.5
                ) *
                scaleX
              )
            )
          )

        var value =
          mask.values[
            sourceRow +
            sourceX
          ]

        if configuration
          .clampOutputValues {

          value =
            min(
              configuration
                .maximumOutputValue,
              max(
                configuration
                  .minimumOutputValue,
                value
              )
            )
        }

        outputValues[
          destinationRow +
          outputX
        ] =
          value
      }
    }

    try cancellationToken?
      .throwIfCancelled()

    return try EdgeSamFloatMask(
      width: outputWidth,
      height: outputHeight,
      values: outputValues
    ).validated()
  }

  // MARK: - Clamp

  private func clampMaskIfNeeded(
    _ mask:
      EdgeSamFloatMask,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {

    guard configuration
      .clampOutputValues else {
      return mask
    }

    var values =
      mask.values

    for index in
      values.indices {

      if index %
          65536 ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      values[index] =
        min(
          configuration
            .maximumOutputValue,
          max(
            configuration
              .minimumOutputValue,
            values[index]
          )
        )
    }

    return try EdgeSamFloatMask(
      width: mask.width,
      height: mask.height,
      values: values
    ).validated()
  }

  // MARK: - Value range

  private func calculateValueRange(
    _ values:
      ContiguousArray<Float>
  ) -> (
    minimum: Float,
    maximum: Float
  ) {

    guard let first =
            values.first else {
      return (0, 0)
    }

    var minimum =
      first

    var maximum =
      first

    for value in
      values.dropFirst() {

      if value <
          minimum {
        minimum =
          value
      }

      if value >
          maximum {
        maximum =
          value
      }
    }

    return (
      minimum,
      maximum
    )
  }

  // MARK: - Safe pixels

  private func safePixelCount(
    width:
      Int,
    height:
      Int
  ) throws ->
      Int {

    let result =
      width
        .multipliedReportingOverflow(
          by:
            height
        )

    guard !result
            .overflow else {
      throw EdgeSamNativeMaskRestorerError
        .integerOverflow
    }

    return result.partialValue
  }
}

// MARK: - Errors

enum EdgeSamNativeMaskRestorerError:
  LocalizedError,
  Equatable,
  Sendable {

  case invalidMaximumOutputPixels(Int)
  case invalidCancellationCheckInterval(Int)
  case invalidOutputValueRange(minimum: Float, maximum: Float)

  case invalidSourceSize(width: Int, height: Int)
  case invalidModelSize(width: Int, height: Int)

  case invalidOutputSize(width: Int, height: Int)

  case invalidLetterboxScale(Float)
  case invalidLetterboxPadding
  case invalidResizedContentSize(width: Int, height: Int)

  case invalidCropSize(
    left: Int,
    top: Int,
    width: Int,
    height: Int
  )

  case cropOutsideDecoderMask
  case cropRangeOutOfBounds

  case invalidDecoderToModelScale
  case invalidResizeScale

  case integerOverflow

  case emptyInputMask

  case unsafeOutputPixelCount(
    width: Int,
    height: Int,
    pixelCount: Int,
    maximum: Int
  )

  case letterboxModelSizeMismatch(
    modelWidth: Int,
    modelHeight: Int,
    letterboxWidth: Int,
    letterboxHeight: Int
  )

  var errorDescription:
    String? {

      switch self {

      case .invalidMaximumOutputPixels:
        return "Invalid maximum output pixels."

      case .invalidCancellationCheckInterval:
        return "Invalid cancellation interval."

      case .invalidOutputValueRange:
        return "Invalid output clamp range."

      case .invalidSourceSize:
        return "Invalid source image size."

      case .invalidModelSize:
        return "Invalid model image size."

      case .invalidOutputSize:
        return "Invalid output image size."

      case .invalidLetterboxScale:
        return "Invalid letterbox scale."

      case .invalidLetterboxPadding:
        return "Invalid letterbox padding."

      case .invalidResizedContentSize:
        return "Invalid resized content."

      case .invalidCropSize:
        return "Invalid crop rectangle."

      case .cropOutsideDecoderMask:
        return "Crop rectangle exceeds decoder mask."

      case .cropRangeOutOfBounds:
        return "Crop indices exceed mask buffer."

      case .invalidDecoderToModelScale:
        return "Invalid decoder/model scale."

      case .invalidResizeScale:
        return "Invalid resize scale."

      case .integerOverflow:
        return "Integer overflow."

      case .emptyInputMask:
        return "Mask is empty."

      case .unsafeOutputPixelCount:
        return "Unsafe output pixel count."

      case .letterboxModelSizeMismatch:
        return "Letterbox/model size mismatch."
      }
    }
}