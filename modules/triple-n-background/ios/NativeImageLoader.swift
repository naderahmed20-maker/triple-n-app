//
// NativeImageLoader.swift
// Part 1/4
//
// Triple N - Native Image Loader
//
// مسؤوليات هذا الملف:
//
// 1) تحميل الصورة من URI محلي آمن.
// 2) التحقق من الملف وحجمه وصيغته.
// 3) قراءة UIImage / CGImage.
// 4) قراءة وتصحيح EXIF Orientation.
// 5) فك الصورة إلى RGBA 8-bit.
// 6) تغيير الحجم مع الحفاظ على النسبة.
// 7) تنفيذ Crop آمن.
// 8) تقليل Peak Memory والنسخ المؤقتة.
// 9) دعم Cancellation أثناء العمليات الثقيلة.
// 10) توفير Diagnostics موحدة لباقي Native EdgeSAM Pipeline.
//
// هذا الملف لا يشغل ONNX Runtime.
// هذا الملف لا ينشئ Encoder Tensor.
// هذا الملف لا ينفذ Segmentation.
// هذا الملف لا يصدر PNG النهائي.
//

import Foundation
import UIKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// MARK: - Native image constants

enum NativeImageLoaderConstants {

  static let minimumImageDimension:
    Int =
      2

  static let maximumImageDimension:
    Int =
      16_384

  static let maximumSafeSourcePixels:
    Int64 =
      64_000_000

  static let maximumSafeDecodedBytes:
    Int64 =
      512 * 1_024 * 1_024

  static let maximumSafeFileSizeBytes:
    Int64 =
      256 * 1_024 * 1_024

  static let rgbaChannelCount:
    Int =
      4

  static let bitsPerComponent:
    Int =
      8

  static let bytesPerPixel:
    Int =
      4

  static let cancellationRowInterval:
    Int =
      32

  static let defaultInterpolationQuality:
    CGInterpolationQuality =
      .high
}

// MARK: - Pixel format

enum NativeImagePixelFormat:
  String,
  Codable,
  Equatable,
  Sendable {

  case rgba8888
}

// MARK: - Alpha format

enum NativeImageAlphaFormat:
  String,
  Codable,
  Equatable,
  Sendable {

  case premultipliedLast

  case straight

  case opaque
}

// MARK: - Image orientation

enum NativeImageOrientation:
  Int,
  Codable,
  CaseIterable,
  Equatable,
  Sendable {

  case up =
    1

  case upMirrored =
    2

  case down =
    3

  case downMirrored =
    4

  case leftMirrored =
    5

  case right =
    6

  case rightMirrored =
    7

  case left =
    8

  init(
    exifValue:
      Int?
  ) {
    guard let exifValue,
          let orientation =
            NativeImageOrientation(
              rawValue:
                exifValue
            ) else {
      self =
        .up

      return
    }

    self =
      orientation
  }

  init(
    cgImagePropertyOrientation:
      CGImagePropertyOrientation
  ) {
    self =
      NativeImageOrientation(
        rawValue:
          Int(
            cgImagePropertyOrientation
              .rawValue
          )
      ) ??
      .up
  }

  init(
    uiImageOrientation:
      UIImage.Orientation
  ) {
    switch uiImageOrientation {
    case .up:
      self =
        .up

    case .upMirrored:
      self =
        .upMirrored

    case .down:
      self =
        .down

    case .downMirrored:
      self =
        .downMirrored

    case .left:
      self =
        .left

    case .leftMirrored:
      self =
        .leftMirrored

    case .right:
      self =
        .right

    case .rightMirrored:
      self =
        .rightMirrored

    @unknown default:
      self =
        .up
    }
  }

  var cgImagePropertyOrientation:
    CGImagePropertyOrientation {
    CGImagePropertyOrientation(
      rawValue:
        UInt32(
          rawValue
        )
    ) ??
    .up
  }

  var uiImageOrientation:
    UIImage.Orientation {
    switch self {
    case .up:
      return .up

    case .upMirrored:
      return .upMirrored

    case .down:
      return .down

    case .downMirrored:
      return .downMirrored

    case .leftMirrored:
      return .leftMirrored

    case .right:
      return .right

    case .rightMirrored:
      return .rightMirrored

    case .left:
      return .left
    }
  }

  var swapsDimensions:
    Bool {
    switch self {
    case .leftMirrored,
         .right,
         .rightMirrored,
         .left:
      return true

    case .up,
         .upMirrored,
         .down,
         .downMirrored:
      return false
    }
  }
}

// MARK: - Resize mode

enum NativeImageResizeMode:
  String,
  Codable,
  Equatable,
  Sendable {

  case fit

  case fill

  case exact
}

// MARK: - Interpolation

enum NativeImageInterpolation:
  String,
  Codable,
  Equatable,
  Sendable {

  case none

  case low

  case medium

  case high

  var cgInterpolationQuality:
    CGInterpolationQuality {
    switch self {
    case .none:
      return .none

    case .low:
      return .low

    case .medium:
      return .medium

    case .high:
      return .high
    }
  }
}

// MARK: - Integer size

struct NativeImageSize:
  Codable,
  Equatable,
  Hashable,
  Sendable {

  let width:
    Int

  let height:
    Int

  var pixelCount:
    Int64 {
    Int64(
      width
    ) *
    Int64(
      height
    )
  }

  var rgbaByteCount:
    Int64 {
    pixelCount *
    Int64(
      NativeImageLoaderConstants
        .bytesPerPixel
    )
  }

  func validated()
    throws ->
      NativeImageSize {
    guard width >=
            NativeImageLoaderConstants
              .minimumImageDimension else {
      throw NativeImageLoaderError
        .imageDimensionTooSmall(
          width:
            width,
          height:
            height
        )
    }

    guard height >=
            NativeImageLoaderConstants
              .minimumImageDimension else {
      throw NativeImageLoaderError
        .imageDimensionTooSmall(
          width:
            width,
          height:
            height
        )
    }

    guard width <=
            NativeImageLoaderConstants
              .maximumImageDimension,
          height <=
            NativeImageLoaderConstants
              .maximumImageDimension else {
      throw NativeImageLoaderError
        .imageDimensionTooLarge(
          width:
            width,
          height:
            height
        )
    }

    guard pixelCount > 0,
          pixelCount <=
            NativeImageLoaderConstants
              .maximumSafeSourcePixels else {
      throw NativeImageLoaderError
        .unsafePixelCount(
          width:
            width,
          height:
            height,
          pixelCount:
            pixelCount
        )
    }

    guard rgbaByteCount > 0,
          rgbaByteCount <=
            NativeImageLoaderConstants
              .maximumSafeDecodedBytes else {
      throw NativeImageLoaderError
        .unsafeDecodedByteCount(
          width:
            width,
          height:
            height,
          byteCount:
            rgbaByteCount
        )
    }

    return self
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

      "rgbaByteCount":
        rgbaByteCount
    ]
  }
}

// MARK: - Crop rectangle

struct NativeImageCropRect:
  Codable,
  Equatable,
  Sendable {

  let x:
    Int

  let y:
    Int

  let width:
    Int

  let height:
    Int

  var maxX:
    Int {
    x +
    width
  }

  var maxY:
    Int {
    y +
    height
  }

  var size:
    NativeImageSize {
    NativeImageSize(
      width:
        width,
      height:
        height
    )
  }

  func validated(
    within imageSize:
      NativeImageSize
  ) throws ->
      NativeImageCropRect {
    guard x >= 0,
          y >= 0 else {
      throw NativeImageLoaderError
        .invalidCropRectangle(
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

    guard width > 0,
          height > 0 else {
      throw NativeImageLoaderError
        .invalidCropRectangle(
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

    guard maxX <=
            imageSize.width,
          maxY <=
            imageSize.height else {
      throw NativeImageLoaderError
        .cropRectangleOutsideImage(
          cropX:
            x,
          cropY:
            y,
          cropWidth:
            width,
          cropHeight:
            height,
          imageWidth:
            imageSize.width,
          imageHeight:
            imageSize.height
        )
    }

    _ =
      try size.validated()

    return self
  }

  func asDictionary()
    -> [String: Any] {
    [
      "x":
        x,

      "y":
        y,

      "width":
        width,

      "height":
        height,

      "maxX":
        maxX,

      "maxY":
        maxY
    ]
  }
}

// MARK: - Resize request

struct NativeImageResizeRequest:
  Codable,
  Equatable,
  Sendable {

  let targetWidth:
    Int

  let targetHeight:
    Int

  let mode:
    NativeImageResizeMode

  let allowUpscaling:
    Bool

  let interpolation:
    NativeImageInterpolation

  func validated()
    throws ->
      NativeImageResizeRequest {
    let targetSize =
      NativeImageSize(
        width:
          targetWidth,
        height:
          targetHeight
      )

    _ =
      try targetSize.validated()

    return self
  }

  func asDictionary()
    -> [String: Any] {
    [
      "targetWidth":
        targetWidth,

      "targetHeight":
        targetHeight,

      "mode":
        mode.rawValue,

      "allowUpscaling":
        allowUpscaling,

      "interpolation":
        interpolation.rawValue
    ]
  }
}

// MARK: - Resolved resize geometry

struct NativeImageResizeGeometry:
  Codable,
  Equatable,
  Sendable {

  let sourceSize:
    NativeImageSize

  let targetCanvasSize:
    NativeImageSize

  let outputSize:
    NativeImageSize

  let drawX:
    Int

  let drawY:
    Int

  let drawWidth:
    Int

  let drawHeight:
    Int

  let scaleX:
    Double

  let scaleY:
    Double

  let mode:
    NativeImageResizeMode

  func asDictionary()
    -> [String: Any] {
    [
      "sourceSize":
        sourceSize
          .asDictionary(),

      "targetCanvasSize":
        targetCanvasSize
          .asDictionary(),

      "outputSize":
        outputSize
          .asDictionary(),

      "drawX":
        drawX,

      "drawY":
        drawY,

      "drawWidth":
        drawWidth,

      "drawHeight":
        drawHeight,

      "scaleX":
        scaleX,

      "scaleY":
        scaleY,

      "mode":
        mode.rawValue
    ]
  }
}

// MARK: - Source file information

struct NativeImageSourceFileInfo:
  Equatable,
  Sendable {

  let originalURI:
    String

  let normalizedFileURL:
    URL

  let fileName:
    String

  let fileExtension:
    String?

  let mimeType:
    String?

  let uniformTypeIdentifier:
    String?

  let fileSizeBytes:
    Int64?

  let creationTimestamp:
    NativeProcessingTimestamp?

  let modificationTimestamp:
    NativeProcessingTimestamp?

  func asDictionary()
    -> [String: Any] {
    [
      "originalURI":
        originalURI,

      "normalizedFileURL":
        normalizedFileURL
          .absoluteString,

      "fileName":
        fileName,

      "fileExtension":
        fileExtension ??
        NSNull(),

      "mimeType":
        mimeType ??
        NSNull(),

      "uniformTypeIdentifier":
        uniformTypeIdentifier ??
        NSNull(),

      "fileSizeBytes":
        fileSizeBytes ??
        NSNull(),

      "creationTimestamp":
        creationTimestamp ??
        NSNull(),

      "modificationTimestamp":
        modificationTimestamp ??
        NSNull()
    ]
  }
}

// MARK: - Decoded image metadata

struct NativeDecodedImageMetadata:
  Equatable,
  Sendable {

  let encodedSize:
    NativeImageSize

  let orientedSize:
    NativeImageSize

  let orientation:
    NativeImageOrientation

  let hasAlpha:
    Bool

  let colorSpaceName:
    String?

  let bitsPerComponent:
    Int

  let bitsPerPixel:
    Int

  let sourceCount:
    Int

  let mimeType:
    String?

  let uniformTypeIdentifier:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "encodedSize":
        encodedSize
          .asDictionary(),

      "orientedSize":
        orientedSize
          .asDictionary(),

      "orientation":
        orientation.rawValue,

      "hasAlpha":
        hasAlpha,

      "colorSpaceName":
        colorSpaceName ??
        NSNull(),

      "bitsPerComponent":
        bitsPerComponent,

      "bitsPerPixel":
        bitsPerPixel,

      "sourceCount":
        sourceCount,

      "mimeType":
        mimeType ??
        NSNull(),

      "uniformTypeIdentifier":
        uniformTypeIdentifier ??
        NSNull()
    ]
  }
}

// MARK: - Loaded encoded image

struct NativeLoadedImage:
  @unchecked Sendable {

  let source:
    NativeScanImageSource

  let fileInfo:
    NativeImageSourceFileInfo

  let imageSource:
    CGImageSource

  let cgImage:
    CGImage

  let metadata:
    NativeDecodedImageMetadata

  let loadedAt:
    NativeProcessingTimestamp

  var encodedSize:
    NativeImageSize {
    metadata
      .encodedSize
  }

  var orientedSize:
    NativeImageSize {
    metadata
      .orientedSize
  }

  var orientation:
    NativeImageOrientation {
    metadata
      .orientation
  }

  func asDictionary()
    -> [String: Any] {
    [
      "source":
        source
          .asDictionary(),

      "fileInfo":
        fileInfo
          .asDictionary(),

      "metadata":
        metadata
          .asDictionary(),

      "loadedAt":
        loadedAt
    ]
  }
}

// MARK: - RGBA image

struct NativeRGBAImage:
  Sendable {

  let width:
    Int

  let height:
    Int

  let bytesPerRow:
    Int

  let pixelFormat:
    NativeImagePixelFormat

  let alphaFormat:
    NativeImageAlphaFormat

  let data:
    Data

  let sourceOrientation:
    NativeImageOrientation

  let orientationNormalized:
    Bool

  let createdAt:
    NativeProcessingTimestamp

  var size:
    NativeImageSize {
    NativeImageSize(
      width:
        width,
      height:
        height
    )
  }

  var pixelCount:
    Int64 {
    size
      .pixelCount
  }

  var expectedByteCount:
    Int {
    bytesPerRow *
    height
  }

  func validated()
    throws ->
      NativeRGBAImage {
    _ =
      try size.validated()

    guard bytesPerRow >=
            width *
            NativeImageLoaderConstants
              .bytesPerPixel else {
      throw NativeImageLoaderError
        .invalidBytesPerRow(
          width:
            width,
          bytesPerRow:
            bytesPerRow
        )
    }

    guard expectedByteCount > 0,
          data.count ==
            expectedByteCount else {
      throw NativeImageLoaderError
        .rgbaByteCountMismatch(
          expected:
            expectedByteCount,
          received:
            data.count,
          width:
            width,
          height:
            height,
          bytesPerRow:
            bytesPerRow
        )
    }

    guard Int64(
            data.count
          ) <=
            NativeImageLoaderConstants
              .maximumSafeDecodedBytes else {
      throw NativeImageLoaderError
        .unsafeDecodedByteCount(
          width:
            width,
          height:
            height,
          byteCount:
            Int64(
              data.count
            )
        )
    }

    return self
  }

  func asDictionary(
    includeData:
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

          "bytesPerRow":
            bytesPerRow,

          "pixelFormat":
            pixelFormat.rawValue,

          "alphaFormat":
            alphaFormat.rawValue,

          "byteCount":
            data.count,

          "pixelCount":
            pixelCount,

          "sourceOrientation":
            sourceOrientation.rawValue,

          "orientationNormalized":
            orientationNormalized,

          "createdAt":
            createdAt
        ]

    if includeData {
      dictionary[
        "data"
      ] =
        data
    }

    return dictionary
  }

  func withUnsafeBytes<Result>(
    _ body:
      (
        UnsafeRawBufferPointer
      ) throws ->
        Result
  ) rethrows ->
      Result {
    try data
      .withUnsafeBytes(
        body
      )
  }
}

// MARK: - Image loading result

struct NativeImageLoadingResult:
  Sendable {

  let source:
    NativeScanImageSource

  let fileInfo:
    NativeImageSourceFileInfo

  let rgbaImage:
    NativeRGBAImage

  let originalEncodedSize:
    NativeImageSize

  let originalOrientation:
    NativeImageOrientation

  let orientationCorrected:
    Bool

  let resizeGeometry:
    NativeImageResizeGeometry?

  let cropRect:
    NativeImageCropRect?

  let loadDurationMs:
    Int64

  let decodeDurationMs:
    Int64

  let orientationDurationMs:
    Int64

  let resizeDurationMs:
    Int64

  let cropDurationMs:
    Int64

  let totalDurationMs:
    Int64

  let completedAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    [
      "source":
        source
          .asDictionary(),

      "fileInfo":
        fileInfo
          .asDictionary(),

      "rgbaImage":
        rgbaImage
          .asDictionary(),

      "originalEncodedSize":
        originalEncodedSize
          .asDictionary(),

      "originalOrientation":
        originalOrientation
          .rawValue,

      "orientationCorrected":
        orientationCorrected,

      "resizeGeometry":
        resizeGeometry?
          .asDictionary() ??
        NSNull(),

      "cropRect":
        cropRect?
          .asDictionary() ??
        NSNull(),

      "loadDurationMs":
        loadDurationMs,

      "decodeDurationMs":
        decodeDurationMs,

      "orientationDurationMs":
        orientationDurationMs,

      "resizeDurationMs":
        resizeDurationMs,

      "cropDurationMs":
        cropDurationMs,

      "totalDurationMs":
        totalDurationMs,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Loader diagnostics

struct NativeImageLoaderDiagnostics:
  Equatable,
  Sendable {

  let loadCount:
    Int

  let decodeCount:
    Int

  let orientationCorrectionCount:
    Int

  let resizeCount:
    Int

  let cropCount:
    Int

  let failureCount:
    Int

  let cancellationCount:
    Int

  let totalLoadedFileBytes:
    Int64

  let totalDecodedBytes:
    Int64

  let peakDecodedBytes:
    Int64

  let lastSourceURI:
    String?

  let lastInputSize:
    NativeImageSize?

  let lastOutputSize:
    NativeImageSize?

  let lastStartedAt:
    NativeProcessingTimestamp?

  let lastCompletedAt:
    NativeProcessingTimestamp?

  let lastFailureAt:
    NativeProcessingTimestamp?

  let lastError:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "loadCount":
        loadCount,

      "decodeCount":
        decodeCount,

      "orientationCorrectionCount":
        orientationCorrectionCount,

      "resizeCount":
        resizeCount,

      "cropCount":
        cropCount,

      "failureCount":
        failureCount,

      "cancellationCount":
        cancellationCount,

      "totalLoadedFileBytes":
        totalLoadedFileBytes,

      "totalDecodedBytes":
        totalDecodedBytes,

      "peakDecodedBytes":
        peakDecodedBytes,

      "lastSourceURI":
        lastSourceURI ??
        NSNull(),

      "lastInputSize":
        lastInputSize?
          .asDictionary() ??
        NSNull(),

      "lastOutputSize":
        lastOutputSize?
          .asDictionary() ??
        NSNull(),

      "lastStartedAt":
        lastStartedAt ??
        NSNull(),

      "lastCompletedAt":
        lastCompletedAt ??
        NSNull(),

      "lastFailureAt":
        lastFailureAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull()
    ]
  }
}

// MARK: - Cancellation checker

typealias NativeImageCancellationCheck =
  @Sendable () throws -> Void

// MARK: - Native image loader

final class NativeImageLoader:
  @unchecked Sendable {

  // MARK: Dependencies

  private let fileManager:
    FileManager

  private let workQueue:
    DispatchQueue

  private let stateQueue:
    DispatchQueue

  // MARK: State

  private var loadCount =
    0

  private var decodeCount =
    0

  private var orientationCorrectionCount =
    0

  private var resizeCount =
    0

  private var cropCount =
    0

  private var failureCount =
    0

  private var cancellationCount =
    0

  private var totalLoadedFileBytes:
    Int64 =
      0

  private var totalDecodedBytes:
    Int64 =
      0

  private var peakDecodedBytes:
    Int64 =
      0

  private var lastSourceURI:
    String?

  private var lastInputSize:
    NativeImageSize?

  private var lastOutputSize:
    NativeImageSize?

  private var lastStartedAt:
    NativeProcessingTimestamp?

  private var lastCompletedAt:
    NativeProcessingTimestamp?

  private var lastFailureAt:
    NativeProcessingTimestamp?

  private var lastError:
    String?

  // MARK: Initialization

  init(
    fileManager:
      FileManager =
        .default
  ) {
    self.fileManager =
      fileManager

    self.workQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-image-loader.work",
        qos:
          .userInitiated,
        autoreleaseFrequency:
          .workItem
      )

    self.stateQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-image-loader.state",
        qos:
          .utility
      )
  }

  // MARK: - Complete image loading pipeline

  func loadAndDecodeRGBA(
    source:
      NativeScanImageSource,
    resizeRequest:
      NativeImageResizeRequest? =
        nil,
    cropRect:
      NativeImageCropRect? =
        nil,
    normalizeOrientation:
      Bool =
        true,
    cancellationCheck:
      NativeImageCancellationCheck? =
        nil
  ) async throws ->
      NativeImageLoadingResult {
    try await withCheckedThrowingContinuation {
      continuation in

      workQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              NativeImageLoaderError
                .loaderDeallocated
          )

          return
        }

        autoreleasepool {
          do {
            let result =
              try self
                .loadAndDecodeRGBASynchronously(
                  source:
                    source,
                  resizeRequest:
                    resizeRequest,
                  cropRect:
                    cropRect,
                  normalizeOrientation:
                    normalizeOrientation,
                  cancellationCheck:
                    cancellationCheck
                )

            continuation.resume(
              returning:
                result
            )
          } catch {
            self.recordFailure(
              error
            )

            continuation.resume(
              throwing:
                error
            )
          }
        }
      }
    }
  }

  // MARK: - Load encoded image only

  func loadImage(
    source:
      NativeScanImageSource,
    cancellationCheck:
      NativeImageCancellationCheck? =
        nil
  ) async throws ->
      NativeLoadedImage {
    try await withCheckedThrowingContinuation {
      continuation in

      workQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              NativeImageLoaderError
                .loaderDeallocated
          )

          return
        }

        autoreleasepool {
          do {
            try self
              .performCancellationCheck(
                cancellationCheck
              )

            let result =
              try self
                .loadImageSynchronously(
                  source:
                    source,
                  cancellationCheck:
                    cancellationCheck
                )

            continuation.resume(
              returning:
                result
            )
          } catch {
            self.recordFailure(
              error
            )

            continuation.resume(
              throwing:
                error
            )
          }
        }
      }
    }
  }

  // MARK: - Decode loaded CGImage to RGBA

  func decodeRGBA(
    loadedImage:
      NativeLoadedImage,
    normalizeOrientation:
      Bool =
        true,
    cancellationCheck:
      NativeImageCancellationCheck? =
        nil
  ) async throws ->
      NativeRGBAImage {
    try await withCheckedThrowingContinuation {
      continuation in

      workQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              NativeImageLoaderError
                .loaderDeallocated
          )

          return
        }

        autoreleasepool {
          do {
            try self
              .performCancellationCheck(
                cancellationCheck
              )

            let decoded =
              try self
                .decodeRGBASynchronously(
                  loadedImage:
                    loadedImage,
                  normalizeOrientation:
                    normalizeOrientation,
                  cancellationCheck:
                    cancellationCheck
                )

            continuation.resume(
              returning:
                decoded
            )
          } catch {
            self.recordFailure(
              error
            )

            continuation.resume(
              throwing:
                error
            )
          }
        }
      }
    }
  }

  // MARK: - Normalize RGBA orientation

  func normalizeOrientation(
    image:
      NativeRGBAImage,
    cancellationCheck:
      NativeImageCancellationCheck? =
        nil
  ) async throws ->
      NativeRGBAImage {
    try await withCheckedThrowingContinuation {
      continuation in

      workQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              NativeImageLoaderError
                .loaderDeallocated
          )

          return
        }

        autoreleasepool {
          do {
            let result =
              try self
                .normalizeOrientationSynchronously(
                  image:
                    image,
                  cancellationCheck:
                    cancellationCheck
                )

            continuation.resume(
              returning:
                result
            )
          } catch {
            self.recordFailure(
              error
            )

            continuation.resume(
              throwing:
                error
            )
          }
        }
      }
    }
  }

  // MARK: - Resize RGBA image

  func resize(
    image:
      NativeRGBAImage,
    request:
      NativeImageResizeRequest,
    cancellationCheck:
      NativeImageCancellationCheck? =
        nil
  ) async throws ->
      (
        image:
          NativeRGBAImage,
        geometry:
          NativeImageResizeGeometry
      ) {
    try await withCheckedThrowingContinuation {
      continuation in

      workQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              NativeImageLoaderError
                .loaderDeallocated
          )

          return
        }

        autoreleasepool {
          do {
            let result =
              try self
                .resizeSynchronously(
                  image:
                    image,
                  request:
                    request,
                  cancellationCheck:
                    cancellationCheck
                )

            continuation.resume(
              returning:
                result
            )
          } catch {
            self.recordFailure(
              error
            )

            continuation.resume(
              throwing:
                error
            )
          }
        }
      }
    }
  }

  // MARK: - Crop RGBA image

  func crop(
    image:
      NativeRGBAImage,
    rect:
      NativeImageCropRect,
    cancellationCheck:
      NativeImageCancellationCheck? =
        nil
  ) async throws ->
      NativeRGBAImage {
    try await withCheckedThrowingContinuation {
      continuation in

      workQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              NativeImageLoaderError
                .loaderDeallocated
          )

          return
        }

        autoreleasepool {
          do {
            let result =
              try self
                .cropSynchronously(
                  image:
                    image,
                  rect:
                    rect,
                  cancellationCheck:
                    cancellationCheck
                )

            continuation.resume(
              returning:
                result
            )
          } catch {
            self.recordFailure(
              error
            )

            continuation.resume(
              throwing:
                error
            )
          }
        }
      }
    }
  }

  // MARK: - Resize geometry

  func resolveResizeGeometry(
    sourceSize:
      NativeImageSize,
    request:
      NativeImageResizeRequest
  ) throws ->
      NativeImageResizeGeometry {
    try resolveResizeGeometrySynchronously(
      sourceSize:
        sourceSize,
      request:
        request
    )
  }

  // MARK: - Diagnostics

  func diagnostics()
    -> NativeImageLoaderDiagnostics {
    stateQueue.sync {
      NativeImageLoaderDiagnostics(
        loadCount:
          loadCount,
        decodeCount:
          decodeCount,
        orientationCorrectionCount:
          orientationCorrectionCount,
        resizeCount:
          resizeCount,
        cropCount:
          cropCount,
        failureCount:
          failureCount,
        cancellationCount:
          cancellationCount,
        totalLoadedFileBytes:
          totalLoadedFileBytes,
        totalDecodedBytes:
          totalDecodedBytes,
        peakDecodedBytes:
          peakDecodedBytes,
        lastSourceURI:
          lastSourceURI,
        lastInputSize:
          lastInputSize,
        lastOutputSize:
          lastOutputSize,
        lastStartedAt:
          lastStartedAt,
        lastCompletedAt:
          lastCompletedAt,
        lastFailureAt:
          lastFailureAt,
        lastError:
          lastError
      )
    }
  }

  // MARK: - Reset diagnostics

  func resetDiagnostics() {
    stateQueue.sync {
      loadCount =
        0

      decodeCount =
        0

      orientationCorrectionCount =
        0

      resizeCount =
        0

      cropCount =
        0

      failureCount =
        0

      cancellationCount =
        0

      totalLoadedFileBytes =
        0

      totalDecodedBytes =
        0

      peakDecodedBytes =
        0

      lastSourceURI =
        nil

      lastInputSize =
        nil

      lastOutputSize =
        nil

      lastStartedAt =
        nil

      lastCompletedAt =
        nil

      lastFailureAt =
        nil

      lastError =
        nil
    }
  }

  // MARK: - Synchronous complete pipeline

  private func loadAndDecodeRGBASynchronously(
    source:
      NativeScanImageSource,
    resizeRequest:
      NativeImageResizeRequest?,
    cropRect:
      NativeImageCropRect?,
    normalizeOrientation:
      Bool,
    cancellationCheck:
      NativeImageCancellationCheck?
  ) throws ->
      NativeImageLoadingResult {
      let pipelineStartedAt =
      NativeProcessingTime.now()

    stateQueue.sync {
      lastStartedAt =
        pipelineStartedAt

      lastSourceURI =
        source.uri

      lastError =
        nil
    }

    try performCancellationCheck(
      cancellationCheck
    )

    let loadStartedAt =
      NativeProcessingTime.now()

    let loadedImage =
      try loadImageSynchronously(
        source:
          source,
        cancellationCheck:
          cancellationCheck
      )

    let loadCompletedAt =
      NativeProcessingTime.now()

    try performCancellationCheck(
      cancellationCheck
    )

    let decodeStartedAt =
      NativeProcessingTime.now()

    var workingImage =
      try decodeRGBASynchronously(
        loadedImage:
          loadedImage,
        normalizeOrientation:
          normalizeOrientation,
        cancellationCheck:
          cancellationCheck
      )

    let decodeCompletedAt =
      NativeProcessingTime.now()

    let orientationDurationMs:
      Int64

    if normalizeOrientation,
       loadedImage.orientation !=
         .up {
      orientationDurationMs =
        max(
          0,
          decodeCompletedAt -
          decodeStartedAt
        )
    } else {
      orientationDurationMs =
        0
    }

    try performCancellationCheck(
      cancellationCheck
    )

    var resolvedResizeGeometry:
      NativeImageResizeGeometry?

    var resizeDurationMs:
      Int64 =
        0

    if let resizeRequest {
      let resizeStartedAt =
        NativeProcessingTime.now()

      let resized =
        try resizeSynchronously(
          image:
            workingImage,
          request:
            resizeRequest,
          cancellationCheck:
            cancellationCheck
        )

      workingImage =
        resized.image

      resolvedResizeGeometry =
        resized.geometry

      resizeDurationMs =
        max(
          0,
          NativeProcessingTime.now() -
          resizeStartedAt
        )
    }

    try performCancellationCheck(
      cancellationCheck
    )

    var validatedCropRect:
      NativeImageCropRect?

    var cropDurationMs:
      Int64 =
        0

    if let cropRect {
      let resolvedCropRect =
        try cropRect.validated(
          within:
            workingImage.size
        )

      let cropStartedAt =
        NativeProcessingTime.now()

      workingImage =
        try cropSynchronously(
          image:
            workingImage,
          rect:
            resolvedCropRect,
          cancellationCheck:
            cancellationCheck
        )

      validatedCropRect =
        resolvedCropRect

      cropDurationMs =
        max(
          0,
          NativeProcessingTime.now() -
          cropStartedAt
        )
    }

    try performCancellationCheck(
      cancellationCheck
    )

    let validatedOutput =
      try workingImage
        .validated()

    let completedAt =
      NativeProcessingTime.now()

    let result =
      NativeImageLoadingResult(
        source:
          source,
        fileInfo:
          loadedImage.fileInfo,
        rgbaImage:
          validatedOutput,
        originalEncodedSize:
          loadedImage.encodedSize,
        originalOrientation:
          loadedImage.orientation,
        orientationCorrected:
          normalizeOrientation &&
          loadedImage.orientation !=
            .up,
        resizeGeometry:
          resolvedResizeGeometry,
        cropRect:
          validatedCropRect,
        loadDurationMs:
          max(
            0,
            loadCompletedAt -
            loadStartedAt
          ),
        decodeDurationMs:
          max(
            0,
            decodeCompletedAt -
            decodeStartedAt
          ),
        orientationDurationMs:
          orientationDurationMs,
        resizeDurationMs:
          resizeDurationMs,
        cropDurationMs:
          cropDurationMs,
        totalDurationMs:
          max(
            0,
            completedAt -
            pipelineStartedAt
          ),
        completedAt:
          completedAt
      )

    stateQueue.sync {
      lastOutputSize =
        validatedOutput.size

      lastCompletedAt =
        completedAt

      lastError =
        nil
    }

    return result
  }

  // MARK: - Synchronous source loading

  private func loadImageSynchronously(
    source:
      NativeScanImageSource,
    cancellationCheck:
      NativeImageCancellationCheck?
  ) throws ->
      NativeLoadedImage {
    try performCancellationCheck(
      cancellationCheck
    )

    let validatedSource =
      try source.validated()

    let fileInfo =
      try resolveSourceFileInfo(
        source:
          validatedSource
      )

    try performCancellationCheck(
      cancellationCheck
    )

    if let fileSizeBytes =
        fileInfo.fileSizeBytes {
      guard fileSizeBytes >=
              0 else {
        throw NativeImageLoaderError
          .invalidSourceFileSize(
            fileSizeBytes:
              fileSizeBytes
          )
      }

      guard fileSizeBytes <=
              NativeImageLoaderConstants
                .maximumSafeFileSizeBytes else {
        throw NativeImageLoaderError
          .sourceFileTooLarge(
            fileSizeBytes:
              fileSizeBytes,
            maximumBytes:
              NativeImageLoaderConstants
                .maximumSafeFileSizeBytes
          )
      }
    }

    let imageSourceOptions:
      CFDictionary =
        [
          kCGImageSourceShouldCache:
            false,
          kCGImageSourceShouldCacheImmediately:
            false
        ] as CFDictionary

    guard let imageSource =
            CGImageSourceCreateWithURL(
              fileInfo
                .normalizedFileURL as CFURL,
              imageSourceOptions
            ) else {
      throw NativeImageLoaderError
        .imageSourceCreationFailed(
          uri:
            validatedSource.uri
        )
    }

    let sourceCount =
      CGImageSourceGetCount(
        imageSource
      )

    guard sourceCount >
            0 else {
      throw NativeImageLoaderError
        .imageSourceContainsNoImages
    }

    try performCancellationCheck(
      cancellationCheck
    )

    guard let properties =
            CGImageSourceCopyPropertiesAtIndex(
              imageSource,
              0,
              nil
            ) as?
              [CFString: Any] else {
      throw NativeImageLoaderError
        .imageMetadataUnavailable
    }

    let pixelWidth =
      resolvePositiveInteger(
        properties[
          kCGImagePropertyPixelWidth
        ]
      )

    let pixelHeight =
      resolvePositiveInteger(
        properties[
          kCGImagePropertyPixelHeight
        ]
      )

    guard let pixelWidth,
          let pixelHeight else {
      throw NativeImageLoaderError
        .imageDimensionsUnavailable
    }

    let encodedSize =
      try NativeImageSize(
        width:
          pixelWidth,
        height:
          pixelHeight
      )
      .validated()

    let orientationValue =
      resolvePositiveInteger(
        properties[
          kCGImagePropertyOrientation
        ]
      ) ??
      validatedSource.orientation

    let orientation =
      NativeImageOrientation(
        exifValue:
          orientationValue
      )

    let orientedSize =
      try NativeImageSize(
        width:
          orientation.swapsDimensions
            ? encodedSize.height
            : encodedSize.width,
        height:
          orientation.swapsDimensions
            ? encodedSize.width
            : encodedSize.height
      )
      .validated()

    try performCancellationCheck(
      cancellationCheck
    )

    let decodeOptions:
      CFDictionary =
        [
          kCGImageSourceShouldCache:
            true,
          kCGImageSourceShouldCacheImmediately:
            true
        ] as CFDictionary

    guard let cgImage =
            CGImageSourceCreateImageAtIndex(
              imageSource,
              0,
              decodeOptions
            ) else {
      throw NativeImageLoaderError
        .cgImageDecodeFailed
    }

    let decodedSize =
      try NativeImageSize(
        width:
          cgImage.width,
        height:
          cgImage.height
      )
      .validated()

    guard decodedSize ==
            encodedSize else {
      /*
       * بعض الصيغ قد ترجع أبعادًا مختلفة قليلًا عن
       * Metadata، لذلك نعتمد أبعاد CGImage الفعلية.
       */
      let actualOrientedSize =
        try NativeImageSize(
          width:
            orientation.swapsDimensions
              ? decodedSize.height
              : decodedSize.width,
          height:
            orientation.swapsDimensions
              ? decodedSize.width
              : decodedSize.height
        )
        .validated()

      let metadata =
        NativeDecodedImageMetadata(
          encodedSize:
            decodedSize,
          orientedSize:
            actualOrientedSize,
          orientation:
            orientation,
          hasAlpha:
            Self.cgImageHasAlpha(
              cgImage
            ),
          colorSpaceName:
            Self.colorSpaceName(
              cgImage.colorSpace
            ),
          bitsPerComponent:
            cgImage.bitsPerComponent,
          bitsPerPixel:
            cgImage.bitsPerPixel,
          sourceCount:
            sourceCount,
          mimeType:
            fileInfo.mimeType,
          uniformTypeIdentifier:
            fileInfo
              .uniformTypeIdentifier
        )

      let loadedAt =
        NativeProcessingTime.now()

      recordSuccessfulLoad(
        source:
          validatedSource,
        fileInfo:
          fileInfo,
        metadata:
          metadata
      )

      return NativeLoadedImage(
        source:
          validatedSource,
        fileInfo:
          fileInfo,
        imageSource:
          imageSource,
        cgImage:
          cgImage,
        metadata:
          metadata,
        loadedAt:
          loadedAt
      )
    }

    let metadata =
      NativeDecodedImageMetadata(
        encodedSize:
          encodedSize,
        orientedSize:
          orientedSize,
        orientation:
          orientation,
        hasAlpha:
          Self.cgImageHasAlpha(
            cgImage
          ),
        colorSpaceName:
          Self.colorSpaceName(
            cgImage.colorSpace
          ),
        bitsPerComponent:
          cgImage.bitsPerComponent,
        bitsPerPixel:
          cgImage.bitsPerPixel,
        sourceCount:
          sourceCount,
        mimeType:
          fileInfo.mimeType,
        uniformTypeIdentifier:
          fileInfo
            .uniformTypeIdentifier
      )

    let loadedAt =
      NativeProcessingTime.now()

    recordSuccessfulLoad(
      source:
        validatedSource,
      fileInfo:
        fileInfo,
      metadata:
        metadata
    )

    return NativeLoadedImage(
      source:
        validatedSource,
      fileInfo:
        fileInfo,
      imageSource:
        imageSource,
      cgImage:
        cgImage,
      metadata:
        metadata,
      loadedAt:
        loadedAt
    )
  }

  // MARK: - Source URL and file metadata

  private func resolveSourceFileInfo(
    source:
      NativeScanImageSource
  ) throws ->
      NativeImageSourceFileInfo {
    let rawURI =
      source
        .uri
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !rawURI.isEmpty else {
      throw NativeImageLoaderError
        .missingSourceURI
    }

    let resolvedURL:
      URL

    if let parsedURL =
        URL(
          string:
            rawURI
        ),
       parsedURL.scheme !=
         nil {
      resolvedURL =
        parsedURL
    } else {
      resolvedURL =
        URL(
          fileURLWithPath:
            rawURI
        )
    }

    guard resolvedURL
            .isFileURL else {
      throw NativeImageLoaderError
        .unsupportedSourceScheme(
          scheme:
            resolvedURL.scheme ??
            "unknown"
        )
    }

    let standardizedURL =
      resolvedURL
        .standardizedFileURL

    guard fileManager
            .fileExists(
              atPath:
                standardizedURL.path
            ) else {
      throw NativeImageLoaderError
        .sourceFileNotFound(
          path:
            standardizedURL.path
        )
    }

    guard fileManager
            .isReadableFile(
              atPath:
                standardizedURL.path
            ) else {
      throw NativeImageLoaderError
        .sourceFileNotReadable(
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
      .int64Value

    if let fileSizeBytes {
      guard fileSizeBytes >=
              0 else {
        throw NativeImageLoaderError
          .invalidSourceFileSize(
            fileSizeBytes:
              fileSizeBytes
          )
      }

      guard fileSizeBytes <=
              NativeImageLoaderConstants
                .maximumSafeFileSizeBytes else {
        throw NativeImageLoaderError
          .sourceFileTooLarge(
            fileSizeBytes:
              fileSizeBytes,
            maximumBytes:
              NativeImageLoaderConstants
                .maximumSafeFileSizeBytes
          )
      }
    }

    let creationDate =
      attributes[
        .creationDate
      ] as? Date

    let modificationDate =
      attributes[
        .modificationDate
      ] as? Date

    let extensionValue =
      standardizedURL
        .pathExtension
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )
        .lowercased()

    let fileExtension =
      extensionValue.isEmpty
        ? nil
        : extensionValue

    let resolvedType =
      resolveUniformType(
        fileURL:
          standardizedURL,
        declaredFormat:
          source.format,
        declaredMimeType:
          source.mimeType
      )

    return NativeImageSourceFileInfo(
      originalURI:
        rawURI,
      normalizedFileURL:
        standardizedURL,
      fileName:
        standardizedURL
          .lastPathComponent,
      fileExtension:
        fileExtension,
      mimeType:
        resolvedType
          .mimeType,
      uniformTypeIdentifier:
        resolvedType
          .identifier,
      fileSizeBytes:
        fileSizeBytes,
      creationTimestamp:
        creationDate
          .map {
            Self.timestamp(
              $0
            )
          },
      modificationTimestamp:
        modificationDate
          .map {
            Self.timestamp(
              $0
            )
          }
    )
  }

  private func resolveUniformType(
    fileURL:
      URL,
    declaredFormat:
      String,
    declaredMimeType:
      String?
  ) -> (
    identifier:
      String?,
    mimeType:
      String?
  ) {
    if let declaredMimeType {
      let normalizedMimeType =
        declaredMimeType
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )
          .lowercased()

      if !normalizedMimeType.isEmpty,
         let type =
           UTType(
             mimeType:
               normalizedMimeType
           ) {
        return (
          identifier:
            type.identifier,
          mimeType:
            type
              .preferredMIMEType ??
            normalizedMimeType
        )
      }
    }

    let normalizedFormat =
      declaredFormat
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )
        .lowercased()

    if !normalizedFormat.isEmpty {
      if let knownType =
          Self.uniformType(
            forFormat:
              normalizedFormat
          ) {
        return (
          identifier:
            knownType.identifier,
          mimeType:
            knownType
              .preferredMIMEType
        )
      }
    }

    let pathExtension =
      fileURL
        .pathExtension
        .lowercased()

    if !pathExtension.isEmpty,
       let type =
         UTType(
           filenameExtension:
             pathExtension
         ) {
      return (
        identifier:
          type.identifier,
        mimeType:
          type
            .preferredMIMEType
      )
    }

    return (
      identifier:
        nil,
      mimeType:
        nil
    )
  }

  private static func uniformType(
    forFormat format:
      String
  ) -> UTType? {
    switch format {
    case "jpg",
         "jpeg":
      return .jpeg

    case "png":
      return .png

    case "heic":
      return .heic

    case "heif":
      return .heif

    case "gif":
      return .gif

    case "tif",
         "tiff":
      return .tiff

    case "bmp":
      return .bmp

    default:
      return UTType(
        filenameExtension:
          format
      )
    }
  }

  // MARK: - RGBA decoding

  private func decodeRGBASynchronously(
    loadedImage:
      NativeLoadedImage,
    normalizeOrientation:
      Bool,
    cancellationCheck:
      NativeImageCancellationCheck?
  ) throws ->
      NativeRGBAImage {
    try performCancellationCheck(
      cancellationCheck
    )

    let sourceImage =
      loadedImage.cgImage

    let sourceOrientation =
      loadedImage.orientation

    let outputSize:
      NativeImageSize

    if normalizeOrientation {
      outputSize =
        loadedImage
          .orientedSize
    } else {
      outputSize =
        loadedImage
          .encodedSize
    }

    _ =
      try outputSize.validated()

    let bytesPerRow =
      try checkedMultiply(
        outputSize.width,
        NativeImageLoaderConstants
          .bytesPerPixel
      )

    let byteCount =
      try checkedMultiply(
        bytesPerRow,
        outputSize.height
      )

    guard byteCount >
            0 else {
      throw NativeImageLoaderError
        .invalidDecodedBufferSize
    }

    guard Int64(
            byteCount
          ) <=
            NativeImageLoaderConstants
              .maximumSafeDecodedBytes else {
      throw NativeImageLoaderError
        .unsafeDecodedByteCount(
          width:
            outputSize.width,
          height:
            outputSize.height,
          byteCount:
            Int64(
              byteCount
            )
        )
    }

    var outputData =
      Data(
        count:
          byteCount
      )

    let colorSpace =
      CGColorSpace(
        name:
          CGColorSpace.sRGB
      ) ??
      CGColorSpaceCreateDeviceRGB()

    let bitmapInfo =
      CGBitmapInfo
        .byteOrder32Big
        .union(
          CGBitmapInfo(
            rawValue:
              CGImageAlphaInfo
                .premultipliedLast
                .rawValue
          )
        )

    let didRender =
      outputData
        .withUnsafeMutableBytes {
          rawBuffer ->
            Bool in

          guard let baseAddress =
                  rawBuffer
                    .baseAddress else {
            return false
          }

          guard let context =
                  CGContext(
                    data:
                      baseAddress,
                    width:
                      outputSize.width,
                    height:
                      outputSize.height,
                    bitsPerComponent:
                      NativeImageLoaderConstants
                        .bitsPerComponent,
                    bytesPerRow:
                      bytesPerRow,
                    space:
                      colorSpace,
                    bitmapInfo:
                      bitmapInfo.rawValue
                  ) else {
            return false
          }

          context
            .setBlendMode(
              .copy
            )

          context
            .interpolationQuality =
              .none

          context
            .setAllowsAntialiasing(
              false
            )

          context
            .setShouldAntialias(
              false
            )

          /*
           * نحول CGContext إلى إحداثيات أعلى-يسار
           * حتى يكون ترتيب RGBA مطابقًا لباقي الـPipeline.
           */
          context
            .translateBy(
              x:
                0,
              y:
                CGFloat(
                  outputSize.height
                )
            )

          context
            .scaleBy(
              x:
                1,
              y:
                -1
            )

          if normalizeOrientation {
            let transform =
              orientationTransform(
                orientation:
                  sourceOrientation,
                sourceWidth:
                  sourceImage.width,
                sourceHeight:
                  sourceImage.height
              )

            context
              .concatenate(
                transform
              )
          }

          context
            .draw(
              sourceImage,
              in:
                CGRect(
                  x:
                    0,
                  y:
                    0,
                  width:
                    sourceImage.width,
                  height:
                    sourceImage.height
                )
            )

          return true
        }

    guard didRender else {
      throw NativeImageLoaderError
        .rgbaContextCreationFailed
    }

    try performCancellationCheck(
      cancellationCheck
    )

    let decoded =
      try NativeRGBAImage(
        width:
          outputSize.width,
        height:
          outputSize.height,
        bytesPerRow:
          bytesPerRow,
        pixelFormat:
          .rgba8888,
        alphaFormat:
          .premultipliedLast,
        data:
          outputData,
        sourceOrientation:
          sourceOrientation,
        orientationNormalized:
          normalizeOrientation ||
          sourceOrientation ==
            .up,
        createdAt:
          NativeProcessingTime.now()
      )
      .validated()

    recordSuccessfulDecode(
      image:
        decoded,
      orientationCorrected:
        normalizeOrientation &&
        sourceOrientation !=
          .up
    )

    return decoded
  }

  // MARK: - Orientation transform

  private func orientationTransform(
    orientation:
      NativeImageOrientation,
    sourceWidth:
      Int,
    sourceHeight:
      Int
  ) -> CGAffineTransform {
    let width =
      CGFloat(
        sourceWidth
      )

    let height =
      CGFloat(
        sourceHeight
      )

    switch orientation {
    case .up:
      return .identity

    case .upMirrored:
      return CGAffineTransform(
        translationX:
          width,
        y:
          0
      )
      .scaledBy(
        x:
          -1,
        y:
          1
      )

    case .down:
      return CGAffineTransform(
        translationX:
          width,
        y:
          height
      )
      .rotated(
        by:
          .pi
      )

    case .downMirrored:
      return CGAffineTransform(
        translationX:
          0,
        y:
          height
      )
      .scaledBy(
        x:
          1,
        y:
          -1
      )

    case .leftMirrored:
      return CGAffineTransform(
        translationX:
          height,
        y:
          width
      )
      .scaledBy(
        x:
          -1,
        y:
          1
      )
      .rotated(
        by:
          -.pi /
          2
      )

    case .right:
      return CGAffineTransform(
        translationX:
          height,
        y:
          0
      )
      .rotated(
        by:
          .pi /
          2
      )

    case .rightMirrored:
      return CGAffineTransform(
        scaleX:
          -1,
        y:
          1
      )
      .rotated(
        by:
          .pi /
          2
      )

    case .left:
      return CGAffineTransform(
        translationX:
          0,
        y:
          width
      )
      .rotated(
        by:
          -.pi /
          2
      )
    }
  }

  // MARK: - Orientation normalization for existing RGBA

  private func normalizeOrientationSynchronously(
    image:
      NativeRGBAImage,
    cancellationCheck:
      NativeImageCancellationCheck?
  ) throws ->
      NativeRGBAImage {
        try performCancellationCheck(
      cancellationCheck
    )

    let validatedImage =
      try image.validated()

    guard !validatedImage
            .orientationNormalized,
          validatedImage
            .sourceOrientation !=
            .up else {
      return validatedImage
    }

    let sourceSize =
      validatedImage.size

    let outputSize =
      try NativeImageSize(
        width:
          validatedImage
            .sourceOrientation
            .swapsDimensions
            ? sourceSize.height
            : sourceSize.width,
        height:
          validatedImage
            .sourceOrientation
            .swapsDimensions
            ? sourceSize.width
            : sourceSize.height
      )
      .validated()

    let sourceImage =
      try createCGImage(
        from:
          validatedImage
      )

    try performCancellationCheck(
      cancellationCheck
    )

    let outputBytesPerRow =
      try checkedMultiply(
        outputSize.width,
        NativeImageLoaderConstants
          .bytesPerPixel
      )

    let outputByteCount =
      try checkedMultiply(
        outputBytesPerRow,
        outputSize.height
      )

    guard outputByteCount >
            0 else {
      throw NativeImageLoaderError
        .invalidDecodedBufferSize
    }

    guard Int64(
            outputByteCount
          ) <=
            NativeImageLoaderConstants
              .maximumSafeDecodedBytes else {
      throw NativeImageLoaderError
        .unsafeDecodedByteCount(
          width:
            outputSize.width,
          height:
            outputSize.height,
          byteCount:
            Int64(
              outputByteCount
            )
        )
    }

    var outputData =
      Data(
        count:
          outputByteCount
      )

    let colorSpace =
      CGColorSpace(
        name:
          CGColorSpace.sRGB
      ) ??
      CGColorSpaceCreateDeviceRGB()

    let bitmapInfo =
      CGBitmapInfo
        .byteOrder32Big
        .union(
          CGBitmapInfo(
            rawValue:
              CGImageAlphaInfo
                .premultipliedLast
                .rawValue
          )
        )

    let didDraw =
      outputData
        .withUnsafeMutableBytes {
          rawBuffer ->
            Bool in

          guard let baseAddress =
                  rawBuffer
                    .baseAddress else {
            return false
          }

          guard let context =
                  CGContext(
                    data:
                      baseAddress,
                    width:
                      outputSize.width,
                    height:
                      outputSize.height,
                    bitsPerComponent:
                      NativeImageLoaderConstants
                        .bitsPerComponent,
                    bytesPerRow:
                      outputBytesPerRow,
                    space:
                      colorSpace,
                    bitmapInfo:
                      bitmapInfo.rawValue
                  ) else {
            return false
          }

          context
            .setBlendMode(
              .copy
            )

          context
            .interpolationQuality =
              .none

          context
            .setAllowsAntialiasing(
              false
            )

          context
            .setShouldAntialias(
              false
            )

          context
            .translateBy(
              x:
                0,
              y:
                CGFloat(
                  outputSize.height
                )
            )

          context
            .scaleBy(
              x:
                1,
              y:
                -1
            )

          context
            .concatenate(
              orientationTransform(
                orientation:
                  validatedImage
                    .sourceOrientation,
                sourceWidth:
                  validatedImage.width,
                sourceHeight:
                  validatedImage.height
              )
            )

          context
            .draw(
              sourceImage,
              in:
                CGRect(
                  x:
                    0,
                  y:
                    0,
                  width:
                    validatedImage.width,
                  height:
                    validatedImage.height
                )
            )

          return true
        }

    guard didDraw else {
      throw NativeImageLoaderError
        .orientationCorrectionFailed
    }

    try performCancellationCheck(
      cancellationCheck
    )

    let result =
      try NativeRGBAImage(
        width:
          outputSize.width,
        height:
          outputSize.height,
        bytesPerRow:
          outputBytesPerRow,
        pixelFormat:
          .rgba8888,
        alphaFormat:
          .premultipliedLast,
        data:
          outputData,
        sourceOrientation:
          .up,
        orientationNormalized:
          true,
        createdAt:
          NativeProcessingTime.now()
      )
      .validated()

    stateQueue.sync {
      orientationCorrectionCount +=
        1

      totalDecodedBytes +=
        Int64(
          result.data.count
        )

      peakDecodedBytes =
        max(
          peakDecodedBytes,
          Int64(
            result.data.count
          )
        )

      lastOutputSize =
        result.size

      lastError =
        nil
    }

    return result
  }

  // MARK: - Resize implementation

  private func resizeSynchronously(
    image:
      NativeRGBAImage,
    request:
      NativeImageResizeRequest,
    cancellationCheck:
      NativeImageCancellationCheck?
  ) throws ->
      (
        image:
          NativeRGBAImage,
        geometry:
          NativeImageResizeGeometry
      ) {
    try performCancellationCheck(
      cancellationCheck
    )

    let validatedImage =
      try image.validated()

    let validatedRequest =
      try request.validated()

    let geometry =
      try resolveResizeGeometrySynchronously(
        sourceSize:
          validatedImage.size,
        request:
          validatedRequest
      )

    if geometry.outputSize ==
        validatedImage.size,
       geometry.drawX ==
         0,
       geometry.drawY ==
         0,
       geometry.drawWidth ==
         validatedImage.width,
       geometry.drawHeight ==
         validatedImage.height {
      return (
        image:
          validatedImage,
        geometry:
          geometry
      )
    }

    let sourceImage =
      try createCGImage(
        from:
          validatedImage
      )

    try performCancellationCheck(
      cancellationCheck
    )

    let outputWidth =
      geometry
        .outputSize
        .width

    let outputHeight =
      geometry
        .outputSize
        .height

    let outputBytesPerRow =
      try checkedMultiply(
        outputWidth,
        NativeImageLoaderConstants
          .bytesPerPixel
      )

    let outputByteCount =
      try checkedMultiply(
        outputBytesPerRow,
        outputHeight
      )

    guard outputByteCount >
            0 else {
      throw NativeImageLoaderError
        .invalidResizeBufferSize
    }

    guard Int64(
            outputByteCount
          ) <=
            NativeImageLoaderConstants
              .maximumSafeDecodedBytes else {
      throw NativeImageLoaderError
        .unsafeDecodedByteCount(
          width:
            outputWidth,
          height:
            outputHeight,
          byteCount:
            Int64(
              outputByteCount
            )
        )
    }

    var outputData =
      Data(
        count:
          outputByteCount
      )

    let colorSpace =
      CGColorSpace(
        name:
          CGColorSpace.sRGB
      ) ??
      CGColorSpaceCreateDeviceRGB()

    let bitmapInfo =
      CGBitmapInfo
        .byteOrder32Big
        .union(
          CGBitmapInfo(
            rawValue:
              CGImageAlphaInfo
                .premultipliedLast
                .rawValue
          )
        )

    let didDraw =
      outputData
        .withUnsafeMutableBytes {
          rawBuffer ->
            Bool in

          guard let baseAddress =
                  rawBuffer
                    .baseAddress else {
            return false
          }

          guard let context =
                  CGContext(
                    data:
                      baseAddress,
                    width:
                      outputWidth,
                    height:
                      outputHeight,
                    bitsPerComponent:
                      NativeImageLoaderConstants
                        .bitsPerComponent,
                    bytesPerRow:
                      outputBytesPerRow,
                    space:
                      colorSpace,
                    bitmapInfo:
                      bitmapInfo.rawValue
                  ) else {
            return false
          }

          context
            .setBlendMode(
              .copy
            )

          context
            .interpolationQuality =
              validatedRequest
                .interpolation
                .cgInterpolationQuality

          context
            .setAllowsAntialiasing(
              true
            )

          context
            .setShouldAntialias(
              true
            )

          context
            .clear(
              CGRect(
                x:
                  0,
                y:
                  0,
                width:
                  outputWidth,
                height:
                  outputHeight
              )
            )

          /*
           * نحول الإحداثيات إلى أعلى-يسار.
           */
          context
            .translateBy(
              x:
                0,
              y:
                CGFloat(
                  outputHeight
                )
            )

          context
            .scaleBy(
              x:
                1,
              y:
                -1
            )

          context
            .draw(
              sourceImage,
              in:
                CGRect(
                  x:
                    geometry.drawX,
                  y:
                    geometry.drawY,
                  width:
                    geometry.drawWidth,
                  height:
                    geometry.drawHeight
                )
            )

          return true
        }

    guard didDraw else {
      throw NativeImageLoaderError
        .resizeContextCreationFailed
    }

    try performCancellationCheck(
      cancellationCheck
    )

    let resizedImage =
      try NativeRGBAImage(
        width:
          outputWidth,
        height:
          outputHeight,
        bytesPerRow:
          outputBytesPerRow,
        pixelFormat:
          .rgba8888,
        alphaFormat:
          .premultipliedLast,
        data:
          outputData,
        sourceOrientation:
          validatedImage
            .sourceOrientation,
        orientationNormalized:
          validatedImage
            .orientationNormalized,
        createdAt:
          NativeProcessingTime.now()
      )
      .validated()

    stateQueue.sync {
      resizeCount +=
        1

      totalDecodedBytes +=
        Int64(
          resizedImage.data.count
        )

      peakDecodedBytes =
        max(
          peakDecodedBytes,
          Int64(
            resizedImage.data.count
          )
        )

      lastInputSize =
        validatedImage.size

      lastOutputSize =
        resizedImage.size

      lastError =
        nil
    }

    return (
      image:
        resizedImage,
      geometry:
        geometry
    )
  }

  // MARK: - Resize geometry implementation

  private func resolveResizeGeometrySynchronously(
    sourceSize:
      NativeImageSize,
    request:
      NativeImageResizeRequest
  ) throws ->
      NativeImageResizeGeometry {
    let validatedSourceSize =
      try sourceSize.validated()

    let validatedRequest =
      try request.validated()

    let targetCanvasSize =
      try NativeImageSize(
        width:
          validatedRequest
            .targetWidth,
        height:
          validatedRequest
            .targetHeight
      )
      .validated()

    let sourceWidth =
      Double(
        validatedSourceSize.width
      )

    let sourceHeight =
      Double(
        validatedSourceSize.height
      )

    let targetWidth =
      Double(
        targetCanvasSize.width
      )

    let targetHeight =
      Double(
        targetCanvasSize.height
      )

    let horizontalScale =
      targetWidth /
      sourceWidth

    let verticalScale =
      targetHeight /
      sourceHeight

    guard horizontalScale.isFinite,
          verticalScale.isFinite,
          horizontalScale >
            0,
          verticalScale >
            0 else {
      throw NativeImageLoaderError
        .invalidResizeScale
    }

    switch validatedRequest.mode {
    case .exact:
      let scaleX =
        validatedRequest
          .allowUpscaling
          ? horizontalScale
          : min(
              1,
              horizontalScale
            )

      let scaleY =
        validatedRequest
          .allowUpscaling
          ? verticalScale
          : min(
              1,
              verticalScale
            )

      let resolvedWidth =
        max(
          1,
          Int(
            (
              sourceWidth *
              scaleX
            )
            .rounded()
          )
        )

      let resolvedHeight =
        max(
          1,
          Int(
            (
              sourceHeight *
              scaleY
            )
            .rounded()
          )
        )

      let outputSize =
        try NativeImageSize(
          width:
            resolvedWidth,
          height:
            resolvedHeight
        )
        .validated()

      return NativeImageResizeGeometry(
        sourceSize:
          validatedSourceSize,
        targetCanvasSize:
          targetCanvasSize,
        outputSize:
          outputSize,
        drawX:
          0,
        drawY:
          0,
        drawWidth:
          outputSize.width,
        drawHeight:
          outputSize.height,
        scaleX:
          scaleX,
        scaleY:
          scaleY,
        mode:
          .exact
      )

    case .fit:
      var scale =
        min(
          horizontalScale,
          verticalScale
        )

      if !validatedRequest
            .allowUpscaling {
        scale =
          min(
            1,
            scale
          )
      }

      guard scale.isFinite,
            scale >
              0 else {
        throw NativeImageLoaderError
          .invalidResizeScale
      }

      let drawWidth =
        max(
          1,
          min(
            targetCanvasSize.width,
            Int(
              (
                sourceWidth *
                scale
              )
              .rounded()
            )
          )
        )

      let drawHeight =
        max(
          1,
          min(
            targetCanvasSize.height,
            Int(
              (
                sourceHeight *
                scale
              )
              .rounded()
            )
          )
        )

      /*
       * Fit هنا يرجع Canvas بالحجم المطلوب،
       * والصورة تتمركز داخله.
       */
      let drawX =
        max(
          0,
          (
            targetCanvasSize.width -
            drawWidth
          ) /
          2
        )

      let drawY =
        max(
          0,
          (
            targetCanvasSize.height -
            drawHeight
          ) /
          2
        )

      return NativeImageResizeGeometry(
        sourceSize:
          validatedSourceSize,
        targetCanvasSize:
          targetCanvasSize,
        outputSize:
          targetCanvasSize,
        drawX:
          drawX,
        drawY:
          drawY,
        drawWidth:
          drawWidth,
        drawHeight:
          drawHeight,
        scaleX:
          scale,
        scaleY:
          scale,
        mode:
          .fit
      )

    case .fill:
      var scale =
        max(
          horizontalScale,
          verticalScale
        )

      if !validatedRequest
            .allowUpscaling {
        scale =
          min(
            1,
            scale
          )
      }

      guard scale.isFinite,
            scale >
              0 else {
        throw NativeImageLoaderError
          .invalidResizeScale
      }

      let drawWidth =
        max(
          1,
          Int(
            (
              sourceWidth *
              scale
            )
            .rounded()
          )
        )

      let drawHeight =
        max(
          1,
          Int(
            (
              sourceHeight *
              scale
            )
            .rounded()
          )
        )

      /*
       * Fill يسمح بإحداثيات سالبة حتى يتم قص
       * الزائد خارج الـCanvas من المنتصف.
       */
      let drawX =
        (
          targetCanvasSize.width -
          drawWidth
        ) /
        2

      let drawY =
        (
          targetCanvasSize.height -
          drawHeight
        ) /
        2

      return NativeImageResizeGeometry(
        sourceSize:
          validatedSourceSize,
        targetCanvasSize:
          targetCanvasSize,
        outputSize:
          targetCanvasSize,
        drawX:
          drawX,
        drawY:
          drawY,
        drawWidth:
          drawWidth,
        drawHeight:
          drawHeight,
        scaleX:
          scale,
        scaleY:
          scale,
        mode:
          .fill
      )
    }
  }

  // MARK: - Crop implementation

  private func cropSynchronously(
    image:
      NativeRGBAImage,
    rect:
      NativeImageCropRect,
    cancellationCheck:
      NativeImageCancellationCheck?
  ) throws ->
      NativeRGBAImage {
    try performCancellationCheck(
      cancellationCheck
    )

    let validatedImage =
      try image.validated()

    let validatedRect =
      try rect.validated(
        within:
          validatedImage.size
      )

    if validatedRect.x ==
        0,
       validatedRect.y ==
         0,
       validatedRect.width ==
         validatedImage.width,
       validatedRect.height ==
         validatedImage.height {
      return validatedImage
    }

    let outputBytesPerRow =
      try checkedMultiply(
        validatedRect.width,
        NativeImageLoaderConstants
          .bytesPerPixel
      )

    let outputByteCount =
      try checkedMultiply(
        outputBytesPerRow,
        validatedRect.height
      )

    guard outputByteCount >
            0 else {
      throw NativeImageLoaderError
        .invalidCropBufferSize
    }

    guard Int64(
            outputByteCount
          ) <=
            NativeImageLoaderConstants
              .maximumSafeDecodedBytes else {
      throw NativeImageLoaderError
        .unsafeDecodedByteCount(
          width:
            validatedRect.width,
          height:
            validatedRect.height,
          byteCount:
            Int64(
              outputByteCount
            )
        )
    }

    var outputData =
      Data(
        count:
          outputByteCount
      )

    try validatedImage.data
      .withUnsafeBytes {
        sourceRawBuffer in

        try outputData
          .withUnsafeMutableBytes {
            destinationRawBuffer in

            guard let sourceBaseAddress =
                    sourceRawBuffer
                      .baseAddress?
                      .assumingMemoryBound(
                        to:
                          UInt8.self
                      ),
                  let destinationBaseAddress =
                    destinationRawBuffer
                      .baseAddress?
                      .assumingMemoryBound(
                        to:
                          UInt8.self
                      ) else {
              throw NativeImageLoaderError
                .cropBufferAccessFailed
            }

            for row in
              0..<validatedRect.height {
              if row %
                  NativeImageLoaderConstants
                    .cancellationRowInterval ==
                  0 {
                try performCancellationCheck(
                  cancellationCheck
                )
              }

              let sourceRow =
                validatedRect.y +
                row

              let sourceOffset =
                try checkedAdd(
                  try checkedMultiply(
                    sourceRow,
                    validatedImage
                      .bytesPerRow
                  ),
                  try checkedMultiply(
                    validatedRect.x,
                    NativeImageLoaderConstants
                      .bytesPerPixel
                  )
                )

              let destinationOffset =
                try checkedMultiply(
                  row,
                  outputBytesPerRow
                )

              memcpy(
                destinationBaseAddress
                  .advanced(
                    by:
                      destinationOffset
                  ),
                sourceBaseAddress
                  .advanced(
                    by:
                      sourceOffset
                  ),
                outputBytesPerRow
              )
            }
          }
      }

    try performCancellationCheck(
      cancellationCheck
    )

    let croppedImage =
      try NativeRGBAImage(
        width:
          validatedRect.width,
        height:
          validatedRect.height,
        bytesPerRow:
          outputBytesPerRow,
        pixelFormat:
          validatedImage
            .pixelFormat,
        alphaFormat:
          validatedImage
            .alphaFormat,
        data:
          outputData,
        sourceOrientation:
          validatedImage
            .sourceOrientation,
        orientationNormalized:
          validatedImage
            .orientationNormalized,
        createdAt:
          NativeProcessingTime.now()
      )
      .validated()

    stateQueue.sync {
      cropCount +=
        1

      totalDecodedBytes +=
        Int64(
          croppedImage.data.count
        )

      peakDecodedBytes =
        max(
          peakDecodedBytes,
          Int64(
            croppedImage.data.count
          )
        )

      lastInputSize =
        validatedImage.size

      lastOutputSize =
        croppedImage.size

      lastError =
        nil
    }

    return croppedImage
  }

  // MARK: - CGImage creation

  private func createCGImage(
    from image:
      NativeRGBAImage
  ) throws ->
      CGImage {
    let validatedImage =
      try image.validated()

    let colorSpace =
      CGColorSpace(
        name:
          CGColorSpace.sRGB
      ) ??
      CGColorSpaceCreateDeviceRGB()

    let bitmapInfo =
      CGBitmapInfo
        .byteOrder32Big
        .union(
          CGBitmapInfo(
            rawValue:
              CGImageAlphaInfo
                .premultipliedLast
                .rawValue
          )
        )

    return try validatedImage.data
      .withUnsafeBytes {
        rawBuffer in

        guard let baseAddress =
                rawBuffer
                  .baseAddress else {
          throw NativeImageLoaderError
            .cgImageProviderCreationFailed
        }

        guard let provider =
                CGDataProvider(
                  dataInfo:
                    nil,
                  data:
                    baseAddress,
                  size:
                    validatedImage
                      .data
                      .count,
                  releaseData: {
                    _,
                    _,
                    _ in
                  }
                ) else {
          throw NativeImageLoaderError
            .cgImageProviderCreationFailed
        }

        guard let cgImage =
                CGImage(
                  width:
                    validatedImage.width,
                  height:
                    validatedImage.height,
                  bitsPerComponent:
                    NativeImageLoaderConstants
                      .bitsPerComponent,
                  bitsPerPixel:
                    32,
                  bytesPerRow:
                    validatedImage
                      .bytesPerRow,
                  space:
                    colorSpace,
                  bitmapInfo:
                    bitmapInfo,
                  provider:
                    provider,
                  decode:
                    nil,
                  shouldInterpolate:
                    false,
                  intent:
                    .defaultIntent
                ) else {
          throw NativeImageLoaderError
            .cgImageCreationFailed
        }

        return cgImage
      }
  }

  // MARK: - Cancellation

  private func performCancellationCheck(
    _ cancellationCheck:
      NativeImageCancellationCheck?
  ) throws {
    if Task.isCancelled {
      stateQueue.sync {
        cancellationCount +=
          1

        lastFailureAt =
          NativeProcessingTime.now()

        lastError =
          "Native image loading was cancelled."
      }

      throw CancellationError()
    }

    do {
      try cancellationCheck?()
    } catch {
      stateQueue.sync {
        cancellationCount +=
          1

        lastFailureAt =
          NativeProcessingTime.now()

        lastError =
          error.localizedDescription
      }

      throw error
    }
  }

  // MARK: - Diagnostics recording

  private func recordSuccessfulLoad(
    source:
      NativeScanImageSource,
    fileInfo:
      NativeImageSourceFileInfo,
    metadata:
      NativeDecodedImageMetadata
  ) {
    stateQueue.sync {
      loadCount +=
        1

      totalLoadedFileBytes +=
        max(
          0,
          fileInfo
            .fileSizeBytes ??
          0
        )

      lastSourceURI =
        source.uri

      lastInputSize =
        metadata
          .encodedSize

      lastCompletedAt =
        NativeProcessingTime.now()

      lastError =
        nil
    }
  }

  private func recordSuccessfulDecode(
    image:
      NativeRGBAImage,
    orientationCorrected:
      Bool
  ) {
    stateQueue.sync {
      decodeCount +=
        1

      if orientationCorrected {
        orientationCorrectionCount +=
          1
      }

      let decodedByteCount =
        Int64(
          image.data.count
        )

      totalDecodedBytes +=
        decodedByteCount

      peakDecodedBytes =
        max(
          peakDecodedBytes,
          decodedByteCount
        )

      lastOutputSize =
        image.size

      lastCompletedAt =
        NativeProcessingTime.now()

      lastError =
        nil
    }
  }

  private func recordFailure(
    _ error:
      Error
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

      lastFailureAt =
        NativeProcessingTime.now()

      lastError =
        error.localizedDescription
    }
  }

  // MARK: - Numeric helpers

  private func checkedMultiply(
    _ left:
      Int,
    _ right:
      Int
  ) throws ->
      Int {
    let result =
      left
        .multipliedReportingOverflow(
          by:
            right
        )

    guard !result.overflow,
          result.partialValue >=
            0 else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    return result
      .partialValue
  }

  private func checkedAdd(
    _ left:
      Int,
    _ right:
      Int
  ) throws ->
      Int {
    let result =
      left
        .addingReportingOverflow(
          right
        )

    guard !result.overflow,
          result.partialValue >=
            0 else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    return result
      .partialValue
  }

  private func resolvePositiveInteger(
    _ value:
      Any?
  ) -> Int? {
    if let number =
        value as?
          NSNumber {
      let integerValue =
        number.intValue

      return integerValue >
        0
        ? integerValue
        : nil
    }

    if let integerValue =
        value as?
          Int {
      return integerValue >
        0
        ? integerValue
        : nil
    }

    if let stringValue =
        value as?
          String,
       let integerValue =
         Int(
           stringValue
         ),
       integerValue >
         0 {
      return integerValue
    }

    return nil
  }

  // MARK: - Static image helpers

  private static func cgImageHasAlpha(
    _ image:
      CGImage
  ) -> Bool {
    switch image.alphaInfo {
    case .first,
         .last,
         .premultipliedFirst,
         .premultipliedLast:
      return true

    case .none,
         .noneSkipFirst,
         .noneSkipLast,
         .alphaOnly:
      return false

    @unknown default:
      return false
    }
  }

  private static func colorSpaceName(
    _ colorSpace:
      CGColorSpace?
  ) -> String? {
    guard let colorSpace else {
      return nil
    }

    return colorSpace.name as String?
  }

  private static func timestamp(
    _ date:
      Date
  ) -> NativeProcessingTimestamp {
    let milliseconds =
      date
        .timeIntervalSince1970 *
      1_000

    guard milliseconds.isFinite,
          milliseconds >
            0 else {
      return 1
    }

    return NativeProcessingTimestamp(
      milliseconds
        .rounded(
          .down
        )
    )
  }
}

// MARK: - Loader errors

enum NativeImageLoaderError:
  LocalizedError,
  Equatable,
  Sendable {

  case loaderDeallocated

  case missingSourceURI

  case unsupportedSourceScheme(
    scheme:
      String
  )

  case sourceFileNotFound(
    path:
      String
  )

  case sourceFileNotReadable(
    path:
      String
  )

  case invalidSourceFileSize(
    fileSizeBytes:
      Int64
  )

  case sourceFileTooLarge(
    fileSizeBytes:
      Int64,
    maximumBytes:
      Int64
  )

  case imageSourceCreationFailed(
    uri:
      String
  )

  case imageSourceContainsNoImages

  case imageMetadataUnavailable

  case imageDimensionsUnavailable

  case cgImageDecodeFailed

  case imageDimensionTooSmall(
    width:
      Int,
    height:
      Int
  )

  case imageDimensionTooLarge(
    width:
      Int,
    height:
      Int
  )

  case unsafePixelCount(
    width:
      Int,
    height:
      Int,
    pixelCount:
      Int64
  )

  case unsafeDecodedByteCount(
    width:
      Int,
    height:
      Int,
    byteCount:
      Int64
  )

  case invalidBytesPerRow(
    width:
      Int,
    bytesPerRow:
      Int
  )

  case rgbaByteCountMismatch(
    expected:
      Int,
    received:
      Int,
    width:
      Int,
    height:
      Int,
    bytesPerRow:
      Int
  )

  case invalidDecodedBufferSize

  case rgbaContextCreationFailed

  case orientationCorrectionFailed

  case invalidResizeScale

  case invalidResizeBufferSize

  case resizeContextCreationFailed

  case invalidCropRectangle(
    x:
      Int,
    y:
      Int,
    width:
      Int,
    height:
      Int
  )

  case cropRectangleOutsideImage(
    cropX:
      Int,
    cropY:
      Int,
    cropWidth:
      Int,
    cropHeight:
      Int,
    imageWidth:
      Int,
    imageHeight:
      Int
  )

  case invalidCropBufferSize

  case cropBufferAccessFailed

  case cgImageProviderCreationFailed

  case cgImageCreationFailed

  case integerOverflow

  var errorDescription:
    String? {
    switch self {
    case .loaderDeallocated:
      return
        """
        Native image loader was released before the operation completed.
        """

    case .missingSourceURI:
      return
        """
        Native image loading requires a source URI.
        """

    case .unsupportedSourceScheme(
      let scheme
    ):
      return
        """
        Native image loading does not support the source URI scheme \(scheme).
        """

    case .sourceFileNotFound(
      let path
    ):
      return
        """
        Native image source file was not found at \(path).
        """

    case .sourceFileNotReadable(
      let path
    ):
      return
        """
        Native image source file is not readable at \(path).
        """

    case .invalidSourceFileSize(
      let fileSizeBytes
    ):
      return
        """
        Native image source file size is invalid: \(fileSizeBytes) bytes.
        """

    case .sourceFileTooLarge(
      let fileSizeBytes,
      let maximumBytes
    ):
      return
        """
        Native image source file is too large: \(fileSizeBytes) bytes. Maximum allowed size is \(maximumBytes) bytes.
        """

    case .imageSourceCreationFailed(
      let uri
    ):
      return
        """
        Native image loading could not create an image source for \(uri).
        """

    case .imageSourceContainsNoImages:
      return
        """
        Native image source does not contain a decodable image.
        """

    case .imageMetadataUnavailable:
      return
        """
        Native image metadata is unavailable.
        """

    case .imageDimensionsUnavailable:
      return
        """
        Native image dimensions are unavailable.
        """

    case .cgImageDecodeFailed:
      return
        """
        Native image loading could not decode a CGImage.
        """

    case .imageDimensionTooSmall(
      let width,
      let height
    ):
      return
        """
        Native image dimensions are too small: \(width)x\(height).
        """

    case .imageDimensionTooLarge(
      let width,
      let height
    ):
      return
        """
        Native image dimensions are too large: \(width)x\(height).
        """

    case .unsafePixelCount(
      let width,
      let height,
      let pixelCount
    ):
      return
        """
        Native image \(width)x\(height) contains an unsafe pixel count: \(pixelCount).
        """

    case .unsafeDecodedByteCount(
      let width,
      let height,
      let byteCount
    ):
      return
        """
        Native image \(width)x\(height) requires an unsafe decoded buffer of \(byteCount) bytes.
        """

    case .invalidBytesPerRow(
      let width,
      let bytesPerRow
    ):
      return
        """
        Native RGBA image has invalid bytesPerRow \(bytesPerRow) for width \(width).
        """

    case .rgbaByteCountMismatch(
      let expected,
      let received,
      let width,
      let height,
      let bytesPerRow
    ):
      return
        """
        Native RGBA buffer length mismatch for \(width)x\(height) with bytesPerRow \(bytesPerRow). Expected \(expected) bytes, received \(received) bytes.
        """

    case .invalidDecodedBufferSize:
      return
        """
        Native image decoding calculated an invalid output buffer size.
        """

    case .rgbaContextCreationFailed:
      return
        """
        Native image loading could not create an RGBA graphics context.
        """

    case .orientationCorrectionFailed:
      return
        """
        Native image loading could not correct the image orientation.
        """

    case .invalidResizeScale:
      return
        """
        Native image resizing calculated an invalid scale.
        """

    case .invalidResizeBufferSize:
      return
        """
        Native image resizing calculated an invalid output buffer size.
        """

    case .resizeContextCreationFailed:
      return
        """
        Native image resizing could not create a graphics context.
        """

    case .invalidCropRectangle(
      let x,
      let y,
      let width,
      let height
    ):
      return
        """
        Native image crop rectangle is invalid: x=\(x), y=\(y), width=\(width), height=\(height).
        """

    case .cropRectangleOutsideImage(
      let cropX,
      let cropY,
      let cropWidth,
      let cropHeight,
      let imageWidth,
      let imageHeight
    ):
      return
        """
        Native image crop rectangle x=\(cropX), y=\(cropY), width=\(cropWidth), height=\(cropHeight) is outside the image \(imageWidth)x\(imageHeight).
        """

    case .invalidCropBufferSize:
      return
        """
        Native image cropping calculated an invalid output buffer size.
        """

    case .cropBufferAccessFailed:
      return
        """
        Native image cropping could not access the source or destination buffer.
        """

    case .cgImageProviderCreationFailed:
      return
        """
        Native image loading could not create a CGDataProvider from RGBA pixels.
        """

    case .cgImageCreationFailed:
      return
        """
        Native image loading could not create a CGImage from RGBA pixels.
        """

    case .integerOverflow:
      return
        """
        Native image processing encountered an unsafe integer overflow.
        """
    }
  }
}