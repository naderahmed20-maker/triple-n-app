//
// EdgeSamNativeBackgroundUnderstanding.swift
//
// Triple N - Native EdgeSAM Background Understanding
//
// مسؤوليات الملف:
//
// 1) تحليل الصورة الأصلية مع الـMask المحسنة.
// 2) اكتشاف مناطق الخلفية المتصلة بحواف الصورة.
// 3) حساب Color / Luminance / Gradient Evidence.
// 4) تقليل تسرب الأرضيات والأسِرّة والمكاتب والخلفيات.
// 5) حماية المنطقة الرئيسية للقطعة.
// 6) الحفاظ على الحواف الرفيعة.
// 7) دعم Cancellation.
// 8) إخراج Float Mask نهائية قبل التصدير.
//
// هذا الملف لا يشغل Encoder أو Decoder.
// هذا الملف لا يختار Candidate.
// هذا الملف لا يصدر PNG.
//

import Foundation

// MARK: - Configuration

struct EdgeSamNativeBackgroundUnderstandingConfiguration:
  Equatable,
  Sendable {

  let backgroundThreshold:
    Float

  let strongBackgroundThreshold:
    Float

  let foregroundProtectionThreshold:
    Float

  let edgeConnectionThreshold:
    Float

  let colorDistanceThreshold:
    Float

  let luminanceDistanceThreshold:
    Float

  let gradientProtectionThreshold:
    Float

  let boundarySampleWidth:
    Int

  let cancellationRowInterval:
    Int

  let maximumPixels:
    Int

  init(
    backgroundThreshold:
      Float =
        0.62,
    strongBackgroundThreshold:
      Float =
        0.82,
    foregroundProtectionThreshold:
      Float =
        0.58,
    edgeConnectionThreshold:
      Float =
        0.55,
    colorDistanceThreshold:
      Float =
        0.18,
    luminanceDistanceThreshold:
      Float =
        0.16,
    gradientProtectionThreshold:
      Float =
        0.24,
    boundarySampleWidth:
      Int =
        8,
    cancellationRowInterval:
      Int =
        32,
    maximumPixels:
      Int =
        64 * 1024 * 1024
  ) {
    self.backgroundThreshold =
      backgroundThreshold

    self.strongBackgroundThreshold =
      strongBackgroundThreshold

    self.foregroundProtectionThreshold =
      foregroundProtectionThreshold

    self.edgeConnectionThreshold =
      edgeConnectionThreshold

    self.colorDistanceThreshold =
      colorDistanceThreshold

    self.luminanceDistanceThreshold =
      luminanceDistanceThreshold

    self.gradientProtectionThreshold =
      gradientProtectionThreshold

    self.boundarySampleWidth =
      boundarySampleWidth

    self.cancellationRowInterval =
      cancellationRowInterval

    self.maximumPixels =
      maximumPixels
  }

  func validated()
    throws ->
      EdgeSamNativeBackgroundUnderstandingConfiguration {
    try Self.validateUnitValue(
      backgroundThreshold,
      field:
        "backgroundThreshold"
    )

    try Self.validateUnitValue(
      strongBackgroundThreshold,
      field:
        "strongBackgroundThreshold"
    )

    try Self.validateUnitValue(
      foregroundProtectionThreshold,
      field:
        "foregroundProtectionThreshold"
    )

    try Self.validateUnitValue(
      edgeConnectionThreshold,
      field:
        "edgeConnectionThreshold"
    )

    try Self.validateUnitValue(
      colorDistanceThreshold,
      field:
        "colorDistanceThreshold"
    )

    try Self.validateUnitValue(
      luminanceDistanceThreshold,
      field:
        "luminanceDistanceThreshold"
    )

    try Self.validateUnitValue(
      gradientProtectionThreshold,
      field:
        "gradientProtectionThreshold"
    )

    guard strongBackgroundThreshold >=
            backgroundThreshold else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .invalidThresholdOrder
    }

    guard boundarySampleWidth >
            0 else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .invalidBoundarySampleWidth(
          boundarySampleWidth
        )
    }

    guard cancellationRowInterval >
            0 else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .invalidCancellationInterval(
          cancellationRowInterval
        )
    }

    guard maximumPixels >
            0 else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .invalidMaximumPixels(
          maximumPixels
        )
    }

    return self
  }

  private static func validateUnitValue(
    _ value:
      Float,
    field:
      String
  ) throws {
    guard value.isFinite,
          value >=
            0,
          value <=
            1 else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .invalidConfigurationValue(
          field:
            field,
          value:
            value
        )
    }
  }
}

// MARK: - Request

struct EdgeSamNativeBackgroundUnderstandingRequest:
  Sendable {

  let image:
    NativeRGBAImage

  let mask:
    EdgeSamFloatMask

  let cancellationToken:
    NativeScanCancellationToken?

  init(
    image:
      NativeRGBAImage,
    mask:
      EdgeSamFloatMask,
    cancellationToken:
      NativeScanCancellationToken? =
        nil
  ) {
    self.image =
      image

    self.mask =
      mask

    self.cancellationToken =
      cancellationToken
  }
}

// MARK: - Pixel analysis

private struct EdgeSamNativeBackgroundPixelAnalysis:
  Sendable {

  let luminance:
    ContiguousArray<Float>

  let red:
    ContiguousArray<Float>

  let green:
    ContiguousArray<Float>

  let blue:
    ContiguousArray<Float>

  let gradient:
    ContiguousArray<Float>

  let boundaryBackground:
    (
      red:
        Float,
      green:
        Float,
      blue:
        Float,
      luminance:
        Float
    )
}

// MARK: - Diagnostics

struct EdgeSamNativeBackgroundUnderstandingDiagnostics:
  Equatable,
  Sendable {

  let width:
    Int

  let height:
    Int

  let examinedPixelCount:
    Int

  let connectedBackgroundPixelCount:
    Int

  let strongBackgroundPixelCount:
    Int

  let protectedForegroundPixelCount:
    Int

  let removedPixelCount:
    Int

  let backgroundRatio:
    Float

  let foregroundRatioBefore:
    Float

  let foregroundRatioAfter:
    Float

  let durationMs:
    Int64

  let completedAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    [
      "width":
        width,

      "height":
        height,

      "examinedPixelCount":
        examinedPixelCount,

      "connectedBackgroundPixelCount":
        connectedBackgroundPixelCount,

      "strongBackgroundPixelCount":
        strongBackgroundPixelCount,

      "protectedForegroundPixelCount":
        protectedForegroundPixelCount,

      "removedPixelCount":
        removedPixelCount,

      "backgroundRatio":
        backgroundRatio,

      "foregroundRatioBefore":
        foregroundRatioBefore,

      "foregroundRatioAfter":
        foregroundRatioAfter,

      "durationMs":
        durationMs,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Result

struct EdgeSamNativeBackgroundUnderstandingResult:
  Sendable {

  let mask:
    EdgeSamFloatMask

  let diagnostics:
    EdgeSamNativeBackgroundUnderstandingDiagnostics
}

// MARK: - Analyzer

final class EdgeSamNativeBackgroundUnderstanding:
  @unchecked Sendable {

  private let configuration:
    EdgeSamNativeBackgroundUnderstandingConfiguration

  init(
    configuration:
      EdgeSamNativeBackgroundUnderstandingConfiguration =
        EdgeSamNativeBackgroundUnderstandingConfiguration()
  ) throws {
    self.configuration =
      try configuration
        .validated()
  }

  // MARK: - Public analysis

  func analyze(
    request:
      EdgeSamNativeBackgroundUnderstandingRequest
  ) throws ->
      EdgeSamNativeBackgroundUnderstandingResult {
    let startedAt =
      NativeProcessingTime.now()

    try request
      .cancellationToken?
      .throwIfCancelled()

    let image =
      try request.image
        .validated()

    let mask =
      try request.mask
        .validated()

    try validateRequest(
      image:
        image,
      mask:
        mask
    )

    let pixelAnalysis =
      try createPixelAnalysis(
        image:
          image,
        cancellationToken:
          request.cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let backgroundConfidence =
      try createBackgroundConfidence(
        analysis:
          pixelAnalysis,
        width:
          image.width,
        height:
          image.height,
        cancellationToken:
          request.cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let connectedBackground =
      try createConnectedBackgroundMap(
        confidence:
          backgroundConfidence,
        mask:
          mask,
        width:
          image.width,
        height:
          image.height,
        cancellationToken:
          request.cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let refinement =
      try applyBackgroundUnderstanding(
        mask:
          mask,
        analysis:
          pixelAnalysis,
        backgroundConfidence:
          backgroundConfidence,
        connectedBackground:
          connectedBackground,
        cancellationToken:
          request.cancellationToken
      )

    let completedAt =
      NativeProcessingTime.now()

    let totalPixels =
      image.width *
      image.height

    let diagnostics =
      EdgeSamNativeBackgroundUnderstandingDiagnostics(
        width:
          image.width,
        height:
          image.height,
        examinedPixelCount:
          totalPixels,
        connectedBackgroundPixelCount:
          refinement
            .connectedBackgroundPixelCount,
        strongBackgroundPixelCount:
          refinement
            .strongBackgroundPixelCount,
        protectedForegroundPixelCount:
          refinement
            .protectedForegroundPixelCount,
        removedPixelCount:
          refinement
            .removedPixelCount,
        backgroundRatio:
          totalPixels >
            0
            ? Float(
                refinement
                  .connectedBackgroundPixelCount
              ) /
              Float(
                totalPixels
              )
            : 0,
        foregroundRatioBefore:
          refinement
            .foregroundRatioBefore,
        foregroundRatioAfter:
          refinement
            .foregroundRatioAfter,
        durationMs:
          max(
            0,
            completedAt -
            startedAt
          ),
        completedAt:
          completedAt
      )

    return EdgeSamNativeBackgroundUnderstandingResult(
      mask:
        refinement.mask,
      diagnostics:
        diagnostics
    )
  }
  // MARK: - Request validation

  private func validateRequest(
    image:
      NativeRGBAImage,
    mask:
      EdgeSamFloatMask
  ) throws {

    guard image.width ==
            mask.width,
          image.height ==
            mask.height else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .imageMaskSizeMismatch(
          imageWidth:
            image.width,
          imageHeight:
            image.height,
          maskWidth:
            mask.width,
          maskHeight:
            mask.height
        )
    }

   _ =
  try safePixelCount(
    width:
      image.width,
    height:
      image.height
  )
  }

  // MARK: - Pixel analysis

  private func createPixelAnalysis(
    image:
      NativeRGBAImage,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws
    -> EdgeSamNativeBackgroundPixelAnalysis {

    let pixelCount =
      image.width *
      image.height

    var red =
      ContiguousArray<Float>(
        repeating: 0,
        count: pixelCount
      )

    var green =
      ContiguousArray<Float>(
        repeating: 0,
        count: pixelCount
      )

    var blue =
      ContiguousArray<Float>(
        repeating: 0,
        count: pixelCount
      )

    var luminance =
      ContiguousArray<Float>(
        repeating: 0,
        count: pixelCount
      )

    var gradient =
      ContiguousArray<Float>(
        repeating: 0,
        count: pixelCount
      )

    var boundaryCount:
      Float = 0

    var boundaryRed:
      Float = 0

    var boundaryGreen:
      Float = 0

    var boundaryBlue:
      Float = 0

    var boundaryLuminance:
      Float = 0

    let boundaryWidth =
      configuration
        .boundarySampleWidth

    for y in
      0..<image.height {

      if y %
          configuration
            .cancellationRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      for x in
        0..<image.width {

        let pixel =
          image.pixel(
            x: x,
            y: y
          )

        let index =
          y *
          image.width +
          x

        red[index] =
          pixel.red

        green[index] =
          pixel.green

        blue[index] =
          pixel.blue

        let l =
          (
            pixel.red *
            0.299
          ) +
          (
            pixel.green *
            0.587
          ) +
          (
            pixel.blue *
            0.114
          )

        luminance[index] =
          l

        if x <
            boundaryWidth ||
            y <
            boundaryWidth ||
            x >=
              image.width -
              boundaryWidth ||
            y >=
              image.height -
              boundaryWidth {

          boundaryCount +=
            1

          boundaryRed +=
            pixel.red

          boundaryGreen +=
            pixel.green

          boundaryBlue +=
            pixel.blue

          boundaryLuminance +=
            l
        }
      }
    }

   if image.width >=
    3 &&
   image.height >=
    3 {

  for y in
    1..<(image.height - 1) {

    if y %
        configuration
          .cancellationRowInterval ==
        0 {
      try cancellationToken?
        .throwIfCancelled()
    }

    let rowOffset =
      y *
      image.width

    let previousRowOffset =
      (
        y -
        1
      ) *
      image.width

    let nextRowOffset =
      (
        y +
        1
      ) *
      image.width

    for x in
      1..<(image.width - 1) {

      let left =
        luminance[
          rowOffset +
          x -
          1
        ]

      let right =
        luminance[
          rowOffset +
          x +
          1
        ]

      let top =
        luminance[
          previousRowOffset +
          x
        ]

      let bottom =
        luminance[
          nextRowOffset +
          x
        ]

      let gx =
        right -
        left

      let gy =
        bottom -
        top

      gradient[
        rowOffset +
        x
      ] =
        min(
          1,
          sqrt(
            gx *
            gx +
            gy *
            gy
          )
        )
    }
  }
}

    let divisor =
      max(
        1,
        boundaryCount
      )

    return EdgeSamNativeBackgroundPixelAnalysis(
      luminance:
        luminance,
      red:
        red,
      green:
        green,
      blue:
        blue,
      gradient:
        gradient,
      boundaryBackground: (
        red:
          boundaryRed /
          divisor,
        green:
          boundaryGreen /
          divisor,
        blue:
          boundaryBlue /
          divisor,
        luminance:
          boundaryLuminance /
          divisor
      )
    )
  }
  // MARK: - Background confidence

  private func createBackgroundConfidence(
    analysis:
      EdgeSamNativeBackgroundPixelAnalysis,
    width:
      Int,
    height:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws
    -> ContiguousArray<Float> {

    let pixelCount =
      try safePixelCount(
        width: width,
        height: height
      )

    var confidence =
      ContiguousArray<Float>(
        repeating: 0,
        count: pixelCount
      )

    let reference =
      analysis
        .boundaryBackground

    for y in
      0..<height {

      if y %
          configuration
            .cancellationRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let row =
        y * width

      for x in
        0..<width {

        let index =
          row + x

        let dr =
          abs(
            analysis.red[index] -
            reference.red
          )

        let dg =
          abs(
            analysis.green[index] -
            reference.green
          )

        let db =
          abs(
            analysis.blue[index] -
            reference.blue
          )

        let dl =
          abs(
            analysis.luminance[index] -
            reference.luminance
          )

        let colorDistance =
          (
            dr +
            dg +
            db
          ) /
          3

        var score:
          Float = 0

        if colorDistance <
            configuration
              .colorDistanceThreshold {

          score +=
            0.45
        }

        if dl <
            configuration
              .luminanceDistanceThreshold {

          score +=
            0.35
        }

        if analysis.gradient[
            index
          ] <
            configuration
              .gradientProtectionThreshold {

          score +=
            0.20
        }

        confidence[
          index
        ] =
          min(
            1,
            max(
              0,
              score
            )
          )
      }
    }

    return confidence
  }

  // MARK: - Connected background

  private func createConnectedBackgroundMap(
    confidence:
      ContiguousArray<Float>,
    mask:
      EdgeSamFloatMask,
    width:
      Int,
    height:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws
    -> ContiguousArray<Bool> {

    let pixelCount =
      try safePixelCount(
        width: width,
        height: height
      )

    var connected =
      ContiguousArray<Bool>(
        repeating: false,
        count: pixelCount
      )

    var queue =
      Array<Int>()

    queue.reserveCapacity(
      4096
    )

    func enqueue(
      _ index:
        Int
    ) {

      guard !connected[
              index
            ] else {
        return
      }

      guard confidence[
              index
            ] >=
            configuration
              .edgeConnectionThreshold else {
        return
      }

      guard mask.values[
              index
            ] <
            configuration
              .foregroundProtectionThreshold else {
        return
      }

      connected[
        index
      ] = true

      queue.append(
        index
      )
    }

    for x in
      0..<width {

      enqueue(
        x
      )

      enqueue(
        (
          height - 1
        ) *
        width +
        x
      )
    }

    for y in
      0..<height {

      enqueue(
        y *
        width
      )

      enqueue(
        y *
        width +
        (
          width - 1
        )
      )
    }

    var head =
      0

    while head <
            queue.count {

      if head %
          4096 ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let index =
        queue[
          head
        ]

      head += 1

      let x =
        index %
        width

      let y =
        index /
        width

    if x >
    0 {
  enqueue(
    index -
    1
  )
}

if x +
    1 <
    width {
  enqueue(
    index +
    1
  )
}

if y >
    0 {
  enqueue(
    index -
    width
  )
}

if y +
    1 <
    height {
  enqueue(
    index +
    width
  )
}
    }

    return connected
  }
  // MARK: - Apply background understanding

  private func applyBackgroundUnderstanding(
    mask:
      EdgeSamFloatMask,
    analysis:
      EdgeSamNativeBackgroundPixelAnalysis,
    backgroundConfidence:
      ContiguousArray<Float>,
    connectedBackground:
      ContiguousArray<Bool>,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      (
        mask:
          EdgeSamFloatMask,
        connectedBackgroundPixelCount:
          Int,
        strongBackgroundPixelCount:
          Int,
        protectedForegroundPixelCount:
          Int,
        removedPixelCount:
          Int,
        foregroundRatioBefore:
          Float,
        foregroundRatioAfter:
          Float
      ) {
    let validatedMask =
      try mask
        .validated()

    let width =
      validatedMask.width

    let height =
      validatedMask.height

    let pixelCount =
      try safePixelCount(
        width:
          width,
        height:
          height
      )

    guard backgroundConfidence.count ==
            pixelCount else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .backgroundConfidenceSizeMismatch(
          expected:
            pixelCount,
          received:
            backgroundConfidence.count
        )
    }

    guard connectedBackground.count ==
            pixelCount else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .connectedBackgroundSizeMismatch(
          expected:
            pixelCount,
          received:
            connectedBackground.count
        )
    }

    guard analysis.gradient.count ==
            pixelCount else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .gradientSizeMismatch(
          expected:
            pixelCount,
          received:
            analysis.gradient.count
        )
    }

    var outputValues =
      validatedMask.values

    var connectedBackgroundPixelCount =
      0

    var strongBackgroundPixelCount =
      0

    var protectedForegroundPixelCount =
      0

    var removedPixelCount =
      0

    var foregroundPixelCountBefore =
      0

    var foregroundPixelCountAfter =
      0

    let foregroundDecisionThreshold:
      Float =
        0.5

    for y in
      0..<height {
      if y %
          configuration
            .cancellationRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let rowOffset =
        y *
        width

      for x in
        0..<width {
        let index =
          rowOffset +
          x

        let originalValue =
          validatedMask
            .values[
              index
            ]

        guard originalValue.isFinite else {
          throw EdgeSamNativeBackgroundUnderstandingError
            .nonFiniteMaskValue(
              index:
                index
            )
        }

        if originalValue >
            foregroundDecisionThreshold {
          foregroundPixelCountBefore +=
            1
        }

        guard connectedBackground[
                index
              ] else {
          if originalValue >
              foregroundDecisionThreshold {
            foregroundPixelCountAfter +=
              1
          }

          continue
        }

        connectedBackgroundPixelCount +=
          1

        let confidence =
          min(
            1,
            max(
              0,
              backgroundConfidence[
                index
              ]
            )
          )

        let gradient =
          min(
            1,
            max(
              0,
              analysis.gradient[
                index
              ]
            )
          )

        let strongBackground =
          confidence >=
          configuration
            .strongBackgroundThreshold

        if strongBackground {
          strongBackgroundPixelCount +=
            1
        }

        /*
         * حماية foreground القوي أو الحواف الواضحة.
         *
         * لا نحذف Pixel تحمل دليلًا قويًا على أنها
         * جزء من القطعة حتى لو كانت متصلة بحافة الصورة.
         */
        let protectedForeground =
          originalValue >=
            configuration
              .foregroundProtectionThreshold ||
          gradient >=
            configuration
              .gradientProtectionThreshold

        if protectedForeground {
          protectedForegroundPixelCount +=
            1

          if originalValue >
              foregroundDecisionThreshold {
            foregroundPixelCountAfter +=
              1
          }

          continue
        }

        guard confidence >=
                configuration
                  .backgroundThreshold else {
          if originalValue >
              foregroundDecisionThreshold {
            foregroundPixelCountAfter +=
              1
          }

          continue
        }

        let thresholdRange =
          max(
            0.000_001,
            1 -
            configuration
              .backgroundThreshold
          )

        let normalizedBackgroundStrength =
          min(
            1,
            max(
              0,
              (
                confidence -
                configuration
                  .backgroundThreshold
              ) /
              thresholdRange
            )
          )

        let attenuation:
          Float

        if strongBackground {
          attenuation =
            1
        } else {
          attenuation =
            min(
              0.85,
              max(
                0,
                normalizedBackgroundStrength *
                0.85
              )
            )
        }

        /*
         * نحافظ على مجال القيم الأصلي:
         *
         * - القيم الموجبة يتم تقليلها تدريجيًا.
         * - القيم الصفرية أو السالبة لا تحتاج حذفًا إضافيًا.
         */
        let refinedValue:
          Float

        if originalValue >
            0 {
          refinedValue =
            originalValue *
            (
              1 -
              attenuation
            )
        } else {
          refinedValue =
            originalValue
        }

        outputValues[
          index
        ] =
          refinedValue

        if refinedValue <
            originalValue -
            0.000_001 {
          removedPixelCount +=
            1
        }

        if refinedValue >
            foregroundDecisionThreshold {
          foregroundPixelCountAfter +=
            1
        }
      }
    }

    try cancellationToken?
      .throwIfCancelled()

    let outputMask =
      try EdgeSamFloatMask(
        width:
          width,
        height:
          height,
        values:
          outputValues
      )
      .validated()

    let foregroundRatioBefore =
      pixelCount >
        0
        ? Float(
            foregroundPixelCountBefore
          ) /
          Float(
            pixelCount
          )
        : 0

    let foregroundRatioAfter =
      pixelCount >
        0
        ? Float(
            foregroundPixelCountAfter
          ) /
          Float(
            pixelCount
          )
        : 0

    return (
      mask:
        outputMask,
      connectedBackgroundPixelCount:
        connectedBackgroundPixelCount,
      strongBackgroundPixelCount:
        strongBackgroundPixelCount,
      protectedForegroundPixelCount:
        protectedForegroundPixelCount,
      removedPixelCount:
        removedPixelCount,
      foregroundRatioBefore:
        foregroundRatioBefore,
      foregroundRatioAfter:
        foregroundRatioAfter
    )
  }

  // MARK: - Safe pixel count

  private func safePixelCount(
    width:
      Int,
    height:
      Int
  ) throws ->
      Int {
    guard width >
            0,
          height >
            0 else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .invalidImageDimensions(
          width:
            width,
          height:
            height
        )
    }

    let result =
      width
        .multipliedReportingOverflow(
          by:
            height
        )

    guard !result.overflow,
          result.partialValue >
            0 else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .integerOverflow
    }

    guard result.partialValue <=
            configuration
              .maximumPixels else {
      throw EdgeSamNativeBackgroundUnderstandingError
        .imageTooLarge(
          pixelCount:
            result.partialValue,
          maximum:
            configuration
              .maximumPixels
        )
    }

    return result.partialValue
  }
}

// MARK: - Background understanding errors

enum EdgeSamNativeBackgroundUnderstandingError:
  LocalizedError,
  Equatable,
  Sendable {

  case invalidConfigurationValue(
    field:
      String,
    value:
      Float
  )

  case invalidThresholdOrder

  case invalidBoundarySampleWidth(
    Int
  )

  case invalidCancellationInterval(
    Int
  )

  case invalidMaximumPixels(
    Int
  )

  case invalidImageDimensions(
    width:
      Int,
    height:
      Int
  )

  case imageMaskSizeMismatch(
    imageWidth:
      Int,
    imageHeight:
      Int,
    maskWidth:
      Int,
    maskHeight:
      Int
  )

  case imageTooLarge(
    pixelCount:
      Int,
    maximum:
      Int
  )

  case backgroundConfidenceSizeMismatch(
    expected:
      Int,
    received:
      Int
  )

  case connectedBackgroundSizeMismatch(
    expected:
      Int,
    received:
      Int
  )

  case gradientSizeMismatch(
    expected:
      Int,
    received:
      Int
  )

  case nonFiniteMaskValue(
    index:
      Int
  )

  case integerOverflow

  var errorDescription:
    String? {
    switch self {
    case .invalidConfigurationValue(
      let field,
      let value
    ):
      return
        """
        EdgeSAM background-understanding value \(field) must be finite and between zero and one. Received \(value).
        """

    case .invalidThresholdOrder:
      return
        """
        EdgeSAM strong background threshold must be greater than or equal to the background threshold.
        """

    case .invalidBoundarySampleWidth(
      let width
    ):
      return
        """
        EdgeSAM background boundary sample width is invalid: \(width).
        """

    case .invalidCancellationInterval(
      let interval
    ):
      return
        """
        EdgeSAM background cancellation interval is invalid: \(interval).
        """

    case .invalidMaximumPixels(
      let maximum
    ):
      return
        """
        EdgeSAM background maximum pixel count is invalid: \(maximum).
        """

    case .invalidImageDimensions(
      let width,
      let height
    ):
      return
        """
        EdgeSAM background analysis received invalid image dimensions: \(width)x\(height).
        """

    case .imageMaskSizeMismatch(
      let imageWidth,
      let imageHeight,
      let maskWidth,
      let maskHeight
    ):
      return
        """
        EdgeSAM background analysis requires matching image and mask dimensions. Image: \(imageWidth)x\(imageHeight), mask: \(maskWidth)x\(maskHeight).
        """

    case .imageTooLarge(
      let pixelCount,
      let maximum
    ):
      return
        """
        EdgeSAM background analysis received \(pixelCount) pixels, exceeding the configured maximum of \(maximum).
        """

    case .backgroundConfidenceSizeMismatch(
      let expected,
      let received
    ):
      return
        """
        EdgeSAM background-confidence map expected \(expected) values but received \(received).
        """

    case .connectedBackgroundSizeMismatch(
      let expected,
      let received
    ):
      return
        """
        EdgeSAM connected-background map expected \(expected) values but received \(received).
        """

    case .gradientSizeMismatch(
      let expected,
      let received
    ):
      return
        """
        EdgeSAM gradient map expected \(expected) values but received \(received).
        """

    case .nonFiniteMaskValue(
      let index
    ):
      return
        """
        EdgeSAM background analysis found a non-finite mask value at index \(index).
        """

    case .integerOverflow:
      return
        """
        EdgeSAM background analysis encountered an integer overflow.
        """
    }
  }
}