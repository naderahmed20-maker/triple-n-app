//
// EdgeSamNativeMaskRefiner.swift
//
// Triple N - Native EdgeSAM Mask Refiner
//
// المسؤوليات:
//
// 1) تحسين الـMask بعد استرجاع الحجم الأصلي.
// 2) إزالة الضوضاء الصغيرة.
// 3) Morphological Opening.
// 4) Morphological Closing.
// 5) إزالة الـIslands الصغيرة.
// 6) ملء الثقوب الداخلية.
// 7) Feather للحواف.
// 8) Edge Protection.
// 9) دعم Cancellation.
// 10) إخراج Float Mask محسنة.
//
// لا يقوم هذا الملف:
//
// - Background Understanding
// - PNG Export
// - Candidate Selection
//

import Foundation

// MARK: - Configuration

struct EdgeSamNativeMaskRefinerConfiguration:
  Equatable,
  Sendable {

  let openingRadius: Int

  let closingRadius: Int

  let featherRadius: Int

  let minimumComponentPixels: Int

  let minimumHolePixels: Int

  let edgeProtectionWidth: Int

  let cancellationRowInterval: Int

  init(
    openingRadius: Int = 1,
    closingRadius: Int = 2,
    featherRadius: Int = 2,
    minimumComponentPixels: Int = 48,
    minimumHolePixels: Int = 32,
    edgeProtectionWidth: Int = 2,
    cancellationRowInterval: Int = 32
  ) {
    self.openingRadius =
      openingRadius

    self.closingRadius =
      closingRadius

    self.featherRadius =
      featherRadius

    self.minimumComponentPixels =
      minimumComponentPixels

    self.minimumHolePixels =
      minimumHolePixels

    self.edgeProtectionWidth =
      edgeProtectionWidth

    self.cancellationRowInterval =
      cancellationRowInterval
  }
}

// MARK: - Request

struct EdgeSamNativeMaskRefinerRequest:
  Sendable {

  let mask:
    EdgeSamFloatMask

  let cancellationToken:
    NativeScanCancellationToken?

  init(
    mask:
      EdgeSamFloatMask,
    cancellationToken:
      NativeScanCancellationToken? =
        nil
  ) {
    self.mask =
      mask

    self.cancellationToken =
      cancellationToken
  }
}

// MARK: - Diagnostics

struct EdgeSamNativeMaskRefinerDiagnostics:
  Equatable,
  Sendable {

  let width: Int

  let height: Int

  let openingRadius: Int

  let closingRadius: Int

  let featherRadius: Int

  let minimumComponentPixels: Int

  let minimumHolePixels: Int

  let edgeProtectionWidth: Int

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

      "openingRadius":
        openingRadius,

      "closingRadius":
        closingRadius,

      "featherRadius":
        featherRadius,

      "minimumComponentPixels":
        minimumComponentPixels,

      "minimumHolePixels":
        minimumHolePixels,

      "edgeProtectionWidth":
        edgeProtectionWidth,

      "durationMs":
        durationMs,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Result

struct EdgeSamNativeMaskRefinerResult:
  Sendable {

  let mask:
    EdgeSamFloatMask

  let diagnostics:
    EdgeSamNativeMaskRefinerDiagnostics
}

// MARK: - Refiner

final class EdgeSamNativeMaskRefiner:
  @unchecked Sendable {

  private let configuration:
    EdgeSamNativeMaskRefinerConfiguration

  init(
    configuration:
      EdgeSamNativeMaskRefinerConfiguration =
        EdgeSamNativeMaskRefinerConfiguration()
  ) {
    self.configuration =
      configuration
  }

  // MARK: Public

  func refine(
    request:
      EdgeSamNativeMaskRefinerRequest
  ) throws
    -> EdgeSamNativeMaskRefinerResult {

    let startedAt =
      NativeProcessingTime.now()

    try request
      .cancellationToken?
      .throwIfCancelled()

    var workingMask =
      try request.mask
        .validated()

    workingMask =
      try morphologicalOpening(
        workingMask,
        cancellationToken:
          request
            .cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    workingMask =
      try morphologicalClosing(
        workingMask,
        cancellationToken:
          request
            .cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()
      workingMask =
      try removeSmallComponents(
        workingMask,
        minimumComponentPixels:
          configuration
            .minimumComponentPixels,
        cancellationToken:
          request
            .cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    workingMask =
      try fillSmallHoles(
        workingMask,
        maximumHolePixels:
          configuration
            .minimumHolePixels,
        cancellationToken:
          request
            .cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    workingMask =
      try featherMask(
        workingMask,
        radius:
          configuration
            .featherRadius,
        cancellationToken:
          request
            .cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    workingMask =
      try protectEdges(
        original:
          request.mask,
        refined:
          workingMask,
        width:
          configuration
            .edgeProtectionWidth,
        cancellationToken:
          request
            .cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let completedAt =
      NativeProcessingTime.now()

    let diagnostics =
      EdgeSamNativeMaskRefinerDiagnostics(
        width:
          workingMask.width,
        height:
          workingMask.height,
        openingRadius:
          configuration
            .openingRadius,
        closingRadius:
          configuration
            .closingRadius,
        featherRadius:
          configuration
            .featherRadius,
        minimumComponentPixels:
          configuration
            .minimumComponentPixels,
        minimumHolePixels:
          configuration
            .minimumHolePixels,
        edgeProtectionWidth:
          configuration
            .edgeProtectionWidth,
        durationMs:
          max(
            0,
            completedAt -
            startedAt
          ),
        completedAt:
          completedAt
      )

    return EdgeSamNativeMaskRefinerResult(
      mask:
        workingMask,
      diagnostics:
        diagnostics
    )
  }

  // MARK: - Morphological opening

  private func morphologicalOpening(
    _ mask:
      EdgeSamFloatMask,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {
    guard configuration.openingRadius >
            0 else {
      return mask
    }

    let eroded =
      try erode(
        mask,
        radius:
          configuration
            .openingRadius,
        cancellationToken:
          cancellationToken
      )

    return try dilate(
      eroded,
      radius:
        configuration
          .openingRadius,
      cancellationToken:
        cancellationToken
    )
  }

  // MARK: - Morphological closing

  private func morphologicalClosing(
    _ mask:
      EdgeSamFloatMask,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {
    guard configuration.closingRadius >
            0 else {
      return mask
    }

    let dilated =
      try dilate(
        mask,
        radius:
          configuration
            .closingRadius,
        cancellationToken:
          cancellationToken
      )

    return try erode(
      dilated,
      radius:
        configuration
          .closingRadius,
      cancellationToken:
        cancellationToken
    )
  }

  // MARK: - Erosion

  private func erode(
    _ mask:
      EdgeSamFloatMask,
    radius:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {
    let validatedMask =
      try mask
        .validated()

    guard radius >
            0 else {
      return validatedMask
    }

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

    var output =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          pixelCount
      )

    for y in 0..<height {
      if y %
          configuration
            .cancellationRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let minimumY =
        max(
          0,
          y -
          radius
        )

      let maximumY =
        min(
          height -
          1,
          y +
          radius
        )

      for x in 0..<width {
        let minimumX =
          max(
            0,
            x -
            radius
          )

        let maximumX =
          min(
            width -
            1,
            x +
            radius
          )

        var minimumValue =
          Float
            .greatestFiniteMagnitude

        for sampleY in
          minimumY...maximumY {
          let sourceRow =
            sampleY *
            width

          for sampleX in
            minimumX...maximumX {
            minimumValue =
              min(
                minimumValue,
                validatedMask
                  .values[
                    sourceRow +
                    sampleX
                  ]
              )
          }
        }

        output[
          y *
          width +
          x
        ] =
          minimumValue
      }
    }

    return try EdgeSamFloatMask(
      width:
        width,
      height:
        height,
      values:
        output
    )
    .validated()
  }

  // MARK: - Dilation

  private func dilate(
    _ mask:
      EdgeSamFloatMask,
    radius:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {
    let validatedMask =
      try mask
        .validated()

    guard radius >
            0 else {
      return validatedMask
    }

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

    var output =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          pixelCount
      )

    for y in 0..<height {
      if y %
          configuration
            .cancellationRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let minimumY =
        max(
          0,
          y -
          radius
        )

      let maximumY =
        min(
          height -
          1,
          y +
          radius
        )

      for x in 0..<width {
        let minimumX =
          max(
            0,
            x -
            radius
          )

        let maximumX =
          min(
            width -
            1,
            x +
            radius
          )

        var maximumValue =
          -Float
            .greatestFiniteMagnitude

        for sampleY in
          minimumY...maximumY {
          let sourceRow =
            sampleY *
            width

          for sampleX in
            minimumX...maximumX {
            maximumValue =
              max(
                maximumValue,
                validatedMask
                  .values[
                    sourceRow +
                    sampleX
                  ]
              )
          }
        }

        output[
          y *
          width +
          x
        ] =
          maximumValue
      }
    }

    return try EdgeSamFloatMask(
      width:
        width,
      height:
        height,
      values:
        output
    )
    .validated()
  }
  // MARK: - Remove small components

  private func removeSmallComponents(
    _ mask:
      EdgeSamFloatMask,
    minimumComponentPixels:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {

    guard minimumComponentPixels >
            1 else {
      return mask
    }

    /*
     * سيتم استبدال هذا لاحقاً بخوارزمية
     * Connected Component Labeling الكاملة.
     *
     * حالياً نحافظ على الـMask كما هي حتى
     * لا نفقد أي تفاصيل للقطعة.
     */

    try cancellationToken?
      .throwIfCancelled()

    return mask
  }

  // MARK: - Fill holes

  private func fillSmallHoles(
    _ mask:
      EdgeSamFloatMask,
    maximumHolePixels:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {

    guard maximumHolePixels >
            0 else {
      return mask
    }

    /*
     * سيتم استبدالها لاحقاً بـ Flood Fill
     * داخلي سريع.
     *
     * المرحلة الحالية لا تغير الـMask.
     */

    try cancellationToken?
      .throwIfCancelled()

    return mask
  }

  // MARK: - Feather

  private func featherMask(
    _ mask:
      EdgeSamFloatMask,
    radius:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {

    guard radius >
            0 else {
      return mask
    }

    let width =
      mask.width

    let height =
      mask.height

    let pixelCount =
      try safePixelCount(
        width: width,
        height: height
      )

    var output =
      ContiguousArray<Float>(
        repeating: 0,
        count: pixelCount
      )

    for y in 0..<height {

      if y %
          configuration
            .cancellationRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      let minY =
        max(
          0,
          y - radius
        )

      let maxY =
        min(
          height - 1,
          y + radius
        )

      for x in 0..<width {

        let minX =
          max(
            0,
            x - radius
          )

        let maxX =
          min(
            width - 1,
            x + radius
          )

        var total:
          Float = 0

        var count =
          0

        for yy in
          minY...maxY {

          let row =
            yy * width

          for xx in
            minX...maxX {

            total +=
              mask.values[
                row + xx
              ]

            count += 1
          }
        }

        output[
          y * width + x
        ] =
          total /
          Float(
            count
          )
      }
    }

    return try EdgeSamFloatMask(
      width: width,
      height: height,
      values: output
    )
    .validated()
  }

  // MARK: - Edge protection

  private func protectEdges(
    original:
      EdgeSamFloatMask,
    refined:
      EdgeSamFloatMask,
    width:
      Int,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      EdgeSamFloatMask {

    guard width >
            0 else {
      return refined
    }

    guard original.width ==
            refined.width,
          original.height ==
            refined.height else {
      throw EdgeSamNativeMaskRefinerError
        .maskSizeMismatch
    }

    var values =
      refined.values

    let imageWidth =
      refined.width

    let imageHeight =
      refined.height

    for y in
      0..<imageHeight {

      if y %
          configuration
            .cancellationRowInterval ==
          0 {
        try cancellationToken?
          .throwIfCancelled()
      }

      for x in
        0..<imageWidth {

        if x < width ||
            y < width ||
            x >= imageWidth - width ||
            y >= imageHeight - width {

          values[
            y * imageWidth + x
          ] =
            original.values[
              y * imageWidth + x
            ]
        }
      }
    }

    return try EdgeSamFloatMask(
      width:
        imageWidth,
      height:
        imageHeight,
      values:
        values
    )
    .validated()
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
      throw EdgeSamNativeMaskRefinerError
        .invalidMaskDimensions(
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
      throw EdgeSamNativeMaskRefinerError
        .integerOverflow
    }

    return result.partialValue
  }
}

// MARK: - Refiner errors

enum EdgeSamNativeMaskRefinerError:
  LocalizedError,
  Equatable,
  Sendable {

  case invalidOpeningRadius(
    Int
  )

  case invalidClosingRadius(
    Int
  )

  case invalidFeatherRadius(
    Int
  )

  case invalidMinimumComponentPixels(
    Int
  )

  case invalidMaximumHolePixels(
    Int
  )

  case invalidEdgeProtectionWidth(
    Int
  )

  case invalidCancellationRowInterval(
    Int
  )

  case invalidMaskDimensions(
    width:
      Int,
    height:
      Int
  )

  case maskSizeMismatch

  case integerOverflow

  var errorDescription:
    String? {
    switch self {
    case .invalidOpeningRadius(
      let radius
    ):
      return
        """
        EdgeSAM mask refiner opening radius is invalid: \(radius).
        """

    case .invalidClosingRadius(
      let radius
    ):
      return
        """
        EdgeSAM mask refiner closing radius is invalid: \(radius).
        """

    case .invalidFeatherRadius(
      let radius
    ):
      return
        """
        EdgeSAM mask refiner feather radius is invalid: \(radius).
        """

    case .invalidMinimumComponentPixels(
      let count
    ):
      return
        """
        EdgeSAM mask refiner minimum component size is invalid: \(count).
        """

    case .invalidMaximumHolePixels(
      let count
    ):
      return
        """
        EdgeSAM mask refiner maximum hole size is invalid: \(count).
        """

    case .invalidEdgeProtectionWidth(
      let width
    ):
      return
        """
        EdgeSAM mask refiner edge protection width is invalid: \(width).
        """

    case .invalidCancellationRowInterval(
      let interval
    ):
      return
        """
        EdgeSAM mask refiner cancellation row interval is invalid: \(interval).
        """

    case .invalidMaskDimensions(
      let width,
      let height
    ):
      return
        """
        EdgeSAM mask refiner received invalid mask dimensions: \(width)x\(height).
        """

    case .maskSizeMismatch:
      return
        """
        EdgeSAM original and refined masks must have identical dimensions.
        """

    case .integerOverflow:
      return
        """
        EdgeSAM mask refiner encountered an integer overflow.
        """
    }
  }
}