//
// NativeScanProcessor.swift
//
// Triple N - Native Scan Item Processor
//
// Part 1/8 + Part 2/8
//
// مسؤوليات هذا الجزء:
//
// 1) تنفيذ NativeScanJobProcessing.
// 2) منع معالجة نفس Job مرتين.
// 3) تسجيل Cancellation Token لكل Job.
// 4) التحقق من مصدر الصورة.
// 5) حل file URI بأمان.
// 6) قراءة الصورة من القرص.
// 7) فك UIImage وCGImage.
// 8) فحص أبعاد الصورة وحجمها.
// 9) إرسال Progress إلى Coordinator.
// 10) تنظيف الحالة بعد النجاح أو الفشل.
//
// الأجزاء التالية ستضيف:
//
// - تصحيح Orientation.
// - تحويل RGBA.
// - تجهيز النموذج.
// - تشغيل Native segmentation engine.
// - Post-processing.
// - تصدير PNG شفاف.
//

import Foundation
import UIKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

#if canImport(onnxruntime_objc)
import onnxruntime_objc
#endif

// MARK: - Loaded source

struct NativeScanLoadedImage:
  @unchecked Sendable {

  let sourceURL:
    URL

  let sourceData:
    Data

  let image:
    UIImage

  let cgImage:
    CGImage

  let pixelWidth:
    Int

  let pixelHeight:
    Int

  let scale:
    CGFloat

  let orientation:
    UIImage.Orientation

  let fileSizeBytes:
    Int64

  let sourceFormat:
    String
}

// MARK: - Processor diagnostics

struct NativeScanProcessorDiagnostics:
  Equatable,
  Sendable {

  let activeJobId:
    String?

  let activeJobCount:
    Int

  let startedJobCount:
    Int

  let completedJobCount:
    Int

  let failedJobCount:
    Int

  let cancelledJobCount:
    Int

  let lastStartedAt:
    NativeProcessingTimestamp?

  let lastCompletedAt:
    NativeProcessingTimestamp?

  let lastFailedAt:
    NativeProcessingTimestamp?

  let lastError:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "activeJobId":
        activeJobId ??
        NSNull(),

      "activeJobCount":
        activeJobCount,

      "startedJobCount":
        startedJobCount,

      "completedJobCount":
        completedJobCount,

      "failedJobCount":
        failedJobCount,

      "cancelledJobCount":
        cancelledJobCount,

      "lastStartedAt":
        lastStartedAt ??
        NSNull(),

      "lastCompletedAt":
        lastCompletedAt ??
        NSNull(),

      "lastFailedAt":
        lastFailedAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull()
    ]
  }
}

// MARK: - Processor

final class NativeScanProcessor:
  NativeScanJobProcessing,
  @unchecked Sendable {

  // MARK: Constants

  fileprivate static let sharedSegmentationEngine =
    NativeSegmentationEngine()

  private static let minimumImageDimension =
    2

  private static let maximumImageDimension =
    16_384

  private static let maximumSafeSourcePixels:
    Int64 =
      64_000_000

  private static let maximumSafeSourceFileBytes:
    Int64 =
      128 *
      1_024 *
      1_024

  // MARK: Dependencies

  private let fileManager:
    FileManager

  private let stateQueue:
    DispatchQueue

  private let imageLoadingQueue:
    DispatchQueue

  // MARK: Runtime state

  private var activeTokens:
    [String: NativeScanCancellationToken] =
      [:]

  private var activeJobId:
    String?

  private var startedJobCount =
    0

  private var completedJobCount =
    0

  private var failedJobCount =
    0

  private var cancelledJobCount =
    0

  private var lastStartedAt:
    NativeProcessingTimestamp?

  private var lastCompletedAt:
    NativeProcessingTimestamp?

  private var lastFailedAt:
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

    self.stateQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.processor.state",
        qos:
          .userInitiated
      )

    self.imageLoadingQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.processor.image-loading",
        qos:
          .userInitiated
      )
  }

  // MARK: NativeScanJobProcessing

  func process(
    job:
      NativeScanJob,
    context:
      NativeScanProcessorContext
  ) async throws ->
      NativeScanProcessingOutput {
    let validatedJob =
      try job.validated()

    try beginExecution(
      job:
        validatedJob,
      cancellationToken:
        context.cancellationToken
    )

    let startedAt =
      NativeProcessingTime.now()

    do {
      try context
        .throwIfCancelled()

      await context.reportProgress(
        "validate-source",
        0.02,
        "Validating the source image.",
        nil
      )

      let sourceURL =
        try resolveSourceURL(
          job:
            validatedJob
        )

      try context
        .throwIfCancelled()

      await context.reportProgress(
        "load-image",
        0.05,
        "Loading the source image.",
        nil
      )

      let loadedImage =
        try await loadImage(
          from:
            sourceURL,
          declaredFormat:
            validatedJob
              .source
              .format,
          cancellationToken:
            context
              .cancellationToken
        )

      try context
        .throwIfCancelled()

      await context.reportProgress(
        "decode-pixels",
        0.09,
        "The source image was decoded.",
        nil
      )

      /*
       * الجزء الثالث سيكمل من هنا:
       *
       * - Orientation normalization
       * - RGBA extraction
       * - Pixel buffer allocation
       * - Native model input preparation
       */
      let output =
        try await processLoadedImage(
          loadedImage,
          job:
            validatedJob,
          context:
            context,
          processingStartedAt:
            startedAt
        )

      stateQueue.sync {
        completedJobCount +=
          1

        lastCompletedAt =
          NativeProcessingTime.now()

        lastError =
          nil
      }

      finishExecution(
        jobId:
          validatedJob.jobId
      )

      return output
    } catch {
      let wasCancelled =
        context
          .cancellationToken
          .isCancelled ||
        Task.isCancelled ||
        isCancellationError(
          error
        )

      stateQueue.sync {
        if wasCancelled {
          cancelledJobCount +=
            1
        } else {
          failedJobCount +=
            1
        }

        lastFailedAt =
          NativeProcessingTime.now()

        lastError =
          error.localizedDescription
      }

      finishExecution(
        jobId:
          validatedJob.jobId
      )

      throw error
    }
  }

  func cancel(
    jobId:
      String
  ) {
    let normalizedJobId =
      jobId
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedJobId.isEmpty else {
      return
    }

    let token =
      stateQueue.sync {
        activeTokens[
          normalizedJobId
        ]
      }

    token?
      .cancel(
        reason:
          "Native scan processing was cancelled."
      )
  }

  // MARK: Diagnostics

  func diagnostics()
    -> NativeScanProcessorDiagnostics {
    stateQueue.sync {
      NativeScanProcessorDiagnostics(
        activeJobId:
          activeJobId,
        activeJobCount:
          activeTokens.count,
        startedJobCount:
          startedJobCount,
        completedJobCount:
          completedJobCount,
        failedJobCount:
          failedJobCount,
        cancelledJobCount:
          cancelledJobCount,
        lastStartedAt:
          lastStartedAt,
        lastCompletedAt:
          lastCompletedAt,
        lastFailedAt:
          lastFailedAt,
        lastError:
          lastError
      )
    }
  }

  // MARK: Execution state

  private func beginExecution(
    job:
      NativeScanJob,
    cancellationToken:
      NativeScanCancellationToken
  ) throws {
    try stateQueue.sync {
      if let activeJobId,
         activeJobId !=
           job.jobId {
        throw NativeScanProcessorError
          .anotherJobIsRunning(
            activeJobId:
              activeJobId,
            requestedJobId:
              job.jobId
          )
      }

      if activeTokens[
          job.jobId
        ] != nil {
        throw NativeScanProcessorError
          .jobAlreadyRunning(
            jobId:
              job.jobId
          )
      }

      activeJobId =
        job.jobId

      activeTokens[
        job.jobId
      ] =
        cancellationToken

      startedJobCount +=
        1

      lastStartedAt =
        NativeProcessingTime.now()

      lastError =
        nil
    }
  }

  private func finishExecution(
    jobId:
      String
  ) {
    stateQueue.sync {
      activeTokens
        .removeValue(
          forKey:
            jobId
        )

      if activeJobId ==
          jobId {
        activeJobId =
          nil
      }
    }
  }

  // MARK: Source URL

  private func resolveSourceURL(
    job:
      NativeScanJob
  ) throws ->
      URL {
    let rawURI =
      job
        .source
        .uri
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !rawURI.isEmpty else {
      throw NativeScanProcessorError
        .missingSourceURI
    }

    let sourceURL:
      URL

    if let parsedURL =
        URL(
          string:
            rawURI
        ),
       parsedURL.scheme !=
         nil {
      sourceURL =
        parsedURL
    } else {
      sourceURL =
        URL(
          fileURLWithPath:
            rawURI
        )
    }

    guard sourceURL.isFileURL else {
      throw NativeScanProcessorError
        .unsupportedSourceScheme(
          scheme:
            sourceURL.scheme ??
            "unknown"
        )
    }

    let standardizedURL =
      sourceURL
        .standardizedFileURL

    guard fileManager
            .fileExists(
              atPath:
                standardizedURL.path
            ) else {
      throw NativeScanProcessorError
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
      throw NativeScanProcessorError
        .sourceFileNotReadable(
          path:
            standardizedURL.path
        )
    }

    return standardizedURL
  }

  // MARK: Image loading

  private func loadImage(
    from sourceURL:
      URL,
    declaredFormat:
      String,
    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeScanLoadedImage {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          let attributes =
            try self.fileManager
              .attributesOfItem(
                atPath:
                  sourceURL.path
              )

          let fileSizeBytes =
            (
              attributes[
                .size
              ] as? NSNumber
            )?
            .int64Value ??
            0

          guard fileSizeBytes >=
                  0 else {
            throw NativeScanProcessorError
              .invalidSourceFileSize
          }

          guard fileSizeBytes <=
                  Self
                    .maximumSafeSourceFileBytes else {
            throw NativeScanProcessorError
              .sourceFileTooLarge(
                fileSizeBytes:
                  fileSizeBytes,
                maximumBytes:
                  Self
                    .maximumSafeSourceFileBytes
              )
          }

          try cancellationToken
            .throwIfCancelled()

          let sourceData =
            try Data(
              contentsOf:
                sourceURL,
              options:
                [
                  .mappedIfSafe
                ]
            )

          guard !sourceData.isEmpty else {
            throw NativeScanProcessorError
              .sourceFileIsEmpty
          }

          try cancellationToken
            .throwIfCancelled()

          guard let image =
                  UIImage(
                    data:
                      sourceData,
                    scale:
                      1
                  ) else {
            throw NativeScanProcessorError
              .sourceImageDecodeFailed
          }

          guard let cgImage =
                  image.cgImage else {
            throw NativeScanProcessorError
              .sourceCGImageUnavailable
          }

          let pixelWidth =
            cgImage.width

          let pixelHeight =
            cgImage.height

          try self
            .validateImageDimensions(
              width:
                pixelWidth,
              height:
                pixelHeight
            )

          let resolvedFormat =
            self.resolveSourceFormat(
              sourceURL:
                sourceURL,
              declaredFormat:
                declaredFormat,
              sourceData:
                sourceData
            )

          try cancellationToken
            .throwIfCancelled()

          continuation.resume(
            returning:
              NativeScanLoadedImage(
                sourceURL:
                  sourceURL,
                sourceData:
                  sourceData,
                image:
                  image,
                cgImage:
                  cgImage,
                pixelWidth:
                  pixelWidth,
                pixelHeight:
                  pixelHeight,
                scale:
                  image.scale,
                orientation:
                  image.imageOrientation,
                fileSizeBytes:
                  fileSizeBytes,
                sourceFormat:
                  resolvedFormat
              )
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

  // MARK: Image dimension validation

  private func validateImageDimensions(
    width:
      Int,
    height:
      Int
  ) throws {
    guard width >=
            Self
              .minimumImageDimension,
          height >=
            Self
              .minimumImageDimension else {
      throw NativeScanProcessorError
        .sourceDimensionsTooSmall(
          width:
            width,
          height:
            height
        )
    }

    guard width <=
            Self
              .maximumImageDimension,
          height <=
            Self
              .maximumImageDimension else {
      throw NativeScanProcessorError
        .sourceDimensionsTooLarge(
          width:
            width,
          height:
            height
        )
    }

    let pixelCount =
      Int64(
        width
      ) *
      Int64(
        height
      )

    guard pixelCount <=
            Self
              .maximumSafeSourcePixels else {
      throw NativeScanProcessorError
        .sourcePixelCountTooLarge(
          pixelCount:
            pixelCount,
          maximumPixelCount:
            Self
              .maximumSafeSourcePixels
        )
    }
  }

  // MARK: Source format

  private func resolveSourceFormat(
    sourceURL:
      URL,
    declaredFormat:
      String,
    sourceData:
      Data
  ) -> String {
    let normalizedDeclaredFormat =
      declaredFormat
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )
        .lowercased()

    if !normalizedDeclaredFormat.isEmpty {
      return normalizedDeclaredFormat
    }

    if let imageSource =
        CGImageSourceCreateWithData(
          sourceData as CFData,
          nil
        ),
       let typeIdentifier =
         CGImageSourceGetType(
           imageSource
         ) {
      let identifier =
        typeIdentifier as String

      if identifier ==
          UTType.png.identifier {
        return "png"
      }

      if identifier ==
          UTType.jpeg.identifier {
        return "jpeg"
      }

      if identifier ==
          UTType.heic.identifier {
        return "heic"
      }

      if identifier ==
          UTType.heif.identifier {
        return "heif"
      }

      return identifier
    }

    let pathExtension =
      sourceURL
        .pathExtension
        .lowercased()

    return pathExtension.isEmpty
      ? "unknown"
      : pathExtension
  }

  // MARK: Cancellation classification

  private func isCancellationError(
    _ error:
      Error
  ) -> Bool {
    if error is
        CancellationError {
      return true
    }

    if let coordinatorError =
        error as?
          NativeScanCoordinatorError {
      switch coordinatorError {
      case .cancelled:
        return true

      default:
        return false
      }
    }

    if let processorError =
        error as?
          NativeScanProcessorError {
      switch processorError {
      case .cancelled:
        return true

      default:
        return false
      }
    }

    return false
  }

  // MARK: Next pipeline stage

  /*
   * سيتم تنفيذ هذه الدالة في Part 3/8.
   *
   * Swift يسمح باستدعائها هنا لأنها ستكون ضمن
   * نفس النوع بعد اكتمال أجزاء الملف.
   */
  private func processLoadedImage(
    _ loadedImage:
      NativeScanLoadedImage,
    job:
      NativeScanJob,
    context:
      NativeScanProcessorContext,
    processingStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeScanProcessingOutput {
    try context
      .throwIfCancelled()

    return try await prepareOrientedImage(
      loadedImage,
      job:
        job,
      context:
        context,
      processingStartedAt:
        processingStartedAt
    )
  }
}

// MARK: - Processor errors

enum NativeScanProcessorError:
  LocalizedError,
  Equatable,
  Sendable {

  case anotherJobIsRunning(
    activeJobId:
      String,
    requestedJobId:
      String
  )

  case jobAlreadyRunning(
    jobId:
      String
  )

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

  case invalidSourceFileSize

  case sourceFileTooLarge(
    fileSizeBytes:
      Int64,
    maximumBytes:
      Int64
  )

  case sourceFileIsEmpty

  case sourceImageDecodeFailed

  case sourceCGImageUnavailable

  case sourceDimensionsTooSmall(
    width:
      Int,
    height:
      Int
  )

  case sourceDimensionsTooLarge(
    width:
      Int,
    height:
      Int
  )

  case sourcePixelCountTooLarge(
    pixelCount:
      Int64,
    maximumPixelCount:
      Int64
  )

  case orientationCorrectionFailed

  case rgbaContextCreationFailed

  case rgbaExtractionFailed

  case invalidPreprocessingDimensions

case invalidPreprocessingScale

case invalidLetterboxDimensions

case invalidSourceRGBALength(
  expected:
    Int,
  received:
    Int
)

case sourceCGImageCreationFailed

case letterboxContextCreationFailed

case invalidLetterboxBufferLength

case encoderTensorAllocationFailed

case encoderTensorCreationFailed

case nativeModelNotConnected

  case cancelled(
    reason:
      String?
  )

  var errorDescription:
    String? {
    switch self {
    case .anotherJobIsRunning(
      let activeJobId,
      let requestedJobId
    ):
      return
        """
        Native scan job \(requestedJobId) cannot start because job \(activeJobId) is already running.
        """

    case .jobAlreadyRunning(
      let jobId
    ):
      return
        """
        Native scan job \(jobId) is already running.
        """

    case .missingSourceURI:
      return
        """
        Native scan processing source URI is missing.
        """

    case .unsupportedSourceScheme(
      let scheme
    ):
      return
        """
        Native scan processing does not support the source URI scheme \(scheme).
        """

    case .sourceFileNotFound(
      let path
    ):
      return
        """
        Native scan processing source file was not found at \(path).
        """

    case .sourceFileNotReadable(
      let path
    ):
      return
        """
        Native scan processing cannot read the source file at \(path).
        """

    case .invalidSourceFileSize:
      return
        """
        Native scan processing source file size is invalid.
        """

    case .sourceFileTooLarge(
      let fileSizeBytes,
      let maximumBytes
    ):
      return
        """
        Native scan source file is too large: \(fileSizeBytes) bytes. Maximum allowed size is \(maximumBytes) bytes.
        """

    case .sourceFileIsEmpty:
      return
        """
        Native scan processing source file is empty.
        """

    case .sourceImageDecodeFailed:
      return
        """
        Native scan processing could not decode the source image.
        """

    case .sourceCGImageUnavailable:
      return
        """
        Native scan processing could not create a CGImage from the source image.
        """

    case .sourceDimensionsTooSmall(
      let width,
      let height
    ):
      return
        """
        Native scan source dimensions are too small: \(width)x\(height).
        """

    case .sourceDimensionsTooLarge(
      let width,
      let height
    ):
      return
        """
        Native scan source dimensions are too large: \(width)x\(height).
        """

    case .sourcePixelCountTooLarge(
      let pixelCount,
      let maximumPixelCount
    ):
      return
        """
        Native scan source contains \(pixelCount) pixels. Maximum allowed count is \(maximumPixelCount).
        """

    case .orientationCorrectionFailed:
      return
        """
        Native scan processing could not correct the source image orientation.
        """

    case .rgbaContextCreationFailed:
      return
        """
        Native scan processing could not create an RGBA graphics context.
        """

    case .rgbaExtractionFailed:
      return
        """
        Native scan processing could not extract RGBA pixels.
        """

        case .invalidPreprocessingDimensions:
  return
    """
    Native EdgeSAM preprocessing received invalid image dimensions.
    """

case .invalidPreprocessingScale:
  return
    """
    Native EdgeSAM preprocessing calculated an invalid resize scale.
    """

case .invalidLetterboxDimensions:
  return
    """
    Native EdgeSAM preprocessing calculated invalid letterbox dimensions.
    """

case .invalidSourceRGBALength(
  let expected,
  let received
):
  return
    """
    Native source RGBA buffer has an invalid length. Expected \(expected) bytes, received \(received) bytes.
    """

case .sourceCGImageCreationFailed:
  return
    """
    Native EdgeSAM preprocessing could not recreate a CGImage from the RGBA source.
    """

case .letterboxContextCreationFailed:
  return
    """
    Native EdgeSAM preprocessing could not create the letterbox graphics context.
    """

case .invalidLetterboxBufferLength:
  return
    """
    Native EdgeSAM letterbox buffer has an invalid length.
    """

case .encoderTensorAllocationFailed:
  return
    """
    Native EdgeSAM could not access the allocated encoder tensor memory.
    """

case .encoderTensorCreationFailed:
  return
    """
    Native EdgeSAM could not create the encoder input tensor.
    """

    case .nativeModelNotConnected:
  return
    """
    Native EdgeSAM model is not connected yet.
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

      if let normalizedReason,
         !normalizedReason.isEmpty {
        return normalizedReason
      }

      return
        """
        Native scan processing was cancelled.
        """
    }
  }
}
// MARK: - Oriented and RGBA image contracts

private struct NativeScanOrientedImage:
  @unchecked Sendable {

  let cgImage:
    CGImage

  let width:
    Int

  let height:
    Int

  let originalOrientation:
    UIImage.Orientation
}

private struct NativeScanRGBAImage:
  @unchecked Sendable {

  let width:
    Int

  let height:
    Int

  let bytesPerRow:
    Int

  let pixelData:
    Data

  var pixelCount:
    Int {
    width *
    height
  }

  var byteCount:
    Int {
    pixelData.count
  }
}

// MARK: - Orientation and RGBA preparation

extension NativeScanProcessor {

  fileprivate func prepareOrientedImage(
    _ loadedImage:
      NativeScanLoadedImage,
    job:
      NativeScanJob,
    context:
      NativeScanProcessorContext,
    processingStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeScanProcessingOutput {
    try context
      .throwIfCancelled()

    await context.reportProgress(
      "correct-orientation",
      0.12,
      "Correcting the source image orientation.",
      nil
    )

    let orientedImage =
      try await createOrientedImage(
        from:
          loadedImage,
        cancellationToken:
          context.cancellationToken
      )

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "decode-pixels",
      0.16,
      "Extracting RGBA pixels.",
      nil
    )

    let rgbaImage =
      try await createRGBAImage(
        from:
          orientedImage,
        cancellationToken:
          context.cancellationToken
      )

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "prepare-segmentation",
      0.20,
      "Preparing the image for native segmentation.",
      nil
    )

    return try await prepareSegmentationInput(
      rgbaImage,
      job:
        job,
      context:
        context,
      processingStartedAt:
        processingStartedAt
    )
  }

  // MARK: Orientation normalization

  private func createOrientedImage(
    from loadedImage:
      NativeScanLoadedImage,
    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeScanOrientedImage {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          let orientation =
            loadedImage.orientation

          if orientation ==
              .up {
            continuation.resume(
              returning:
                NativeScanOrientedImage(
                  cgImage:
                    loadedImage.cgImage,
                  width:
                    loadedImage.pixelWidth,
                  height:
                    loadedImage.pixelHeight,
                  originalOrientation:
                    orientation
                )
            )

            return
          }

          let outputSize =
            self.orientedPixelSize(
              width:
                loadedImage.pixelWidth,
              height:
                loadedImage.pixelHeight,
              orientation:
                orientation
            )

          guard outputSize.width >
                  0,
                outputSize.height >
                  0 else {
            throw NativeScanProcessorError
              .orientationCorrectionFailed
          }

          guard let colorSpace =
                  loadedImage
                    .cgImage
                    .colorSpace ??
                  CGColorSpace(
                    name:
                      CGColorSpace.sRGB
                  ) else {
            throw NativeScanProcessorError
              .orientationCorrectionFailed
          }

          let bitmapInfo =
            CGBitmapInfo(
              rawValue:
                CGImageAlphaInfo
                  .premultipliedLast
                  .rawValue
            )
            .union(
              .byteOrder32Big
            )

          guard let drawingContext =
                  CGContext(
                    data:
                      nil,
                    width:
                      outputSize.width,
                    height:
                      outputSize.height,
                    bitsPerComponent:
                      8,
                    bytesPerRow:
                      outputSize.width *
                      4,
                    space:
                      colorSpace,
                    bitmapInfo:
                      bitmapInfo.rawValue
                  ) else {
            throw NativeScanProcessorError
              .orientationCorrectionFailed
          }

          drawingContext
            .interpolationQuality =
              .high

          drawingContext
            .setBlendMode(
              .copy
            )

          let transform =
            self.orientationTransform(
              orientation:
                orientation,
              sourceWidth:
                loadedImage.pixelWidth,
              sourceHeight:
                loadedImage.pixelHeight
            )

          drawingContext
            .concatenate(
              transform
            )

          drawingContext
            .draw(
              loadedImage.cgImage,
              in:
                CGRect(
                  x:
                    0,
                  y:
                    0,
                  width:
                    loadedImage.pixelWidth,
                  height:
                    loadedImage.pixelHeight
                )
            )

          try cancellationToken
            .throwIfCancelled()

          guard let correctedImage =
                  drawingContext
                    .makeImage() else {
            throw NativeScanProcessorError
              .orientationCorrectionFailed
          }

          continuation.resume(
            returning:
              NativeScanOrientedImage(
                cgImage:
                  correctedImage,
                width:
                  outputSize.width,
                height:
                  outputSize.height,
                originalOrientation:
                  orientation
              )
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

  private func orientedPixelSize(
    width:
      Int,
    height:
      Int,
    orientation:
      UIImage.Orientation
  ) -> (
    width:
      Int,
    height:
      Int
  ) {
    switch orientation {
    case .left,
         .leftMirrored,
         .right,
         .rightMirrored:
      return (
        width:
          height,
        height:
          width
      )

    case .up,
         .upMirrored,
         .down,
         .downMirrored:
      return (
        width:
          width,
        height:
          height
      )

    @unknown default:
      return (
        width:
          width,
        height:
          height
      )
    }
  }

  private func orientationTransform(
    orientation:
      UIImage.Orientation,
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

    @unknown default:
      return .identity
    }
  }

  // MARK: RGBA extraction

  private func createRGBAImage(
    from orientedImage:
      NativeScanOrientedImage,
    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeScanRGBAImage {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          let width =
            orientedImage.width

          let height =
            orientedImage.height

          try self
            .validateImageDimensions(
              width:
                width,
              height:
                height
            )

          let bytesPerPixel =
            4

          let bytesPerRow =
            try self.checkedMultiply(
              width,
              bytesPerPixel
            )

          let totalBytes =
            try self.checkedMultiply(
              bytesPerRow,
              height
            )

          guard totalBytes >
                  0 else {
            throw NativeScanProcessorError
              .rgbaExtractionFailed
          }

          var pixelData =
            Data(
              count:
                totalBytes
            )

          let colorSpace =
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
            pixelData
              .withUnsafeMutableBytes {
                rawBuffer ->
                  Bool in

                guard let baseAddress =
                        rawBuffer
                          .baseAddress else {
                  return false
                }

                guard let rgbaContext =
                        CGContext(
                          data:
                            baseAddress,
                          width:
                            width,
                          height:
                            height,
                          bitsPerComponent:
                            8,
                          bytesPerRow:
                            bytesPerRow,
                          space:
                            colorSpace,
                          bitmapInfo:
                            bitmapInfo
                              .rawValue
                        ) else {
                  return false
                }

                rgbaContext
                  .setBlendMode(
                    .copy
                  )

                rgbaContext
                  .interpolationQuality =
                    .none

                /*
                 * CGContext إحداثياته تبدأ من أسفل اليسار.
                 * نقلب المحور الرأسي حتى يكون Buffer بترتيب
                 * أعلى-يسار مثل مرحلة JavaScript الحالية.
                 */
                rgbaContext
                  .translateBy(
                    x:
                      0,
                    y:
                      CGFloat(
                        height
                      )
                  )

                rgbaContext
                  .scaleBy(
                    x:
                      1,
                    y:
                      -1
                  )

                rgbaContext
                  .draw(
                    orientedImage.cgImage,
                    in:
                      CGRect(
                        x:
                          0,
                        y:
                          0,
                        width:
                          width,
                        height:
                          height
                      )
                  )

                return true
              }

          guard didDraw else {
            throw NativeScanProcessorError
              .rgbaContextCreationFailed
          }

          try cancellationToken
            .throwIfCancelled()

          guard pixelData.count ==
                  totalBytes else {
            throw NativeScanProcessorError
              .rgbaExtractionFailed
          }

          continuation.resume(
            returning:
              NativeScanRGBAImage(
                width:
                  width,
                height:
                  height,
                bytesPerRow:
                  bytesPerRow,
                pixelData:
                  pixelData
              )
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
      throw NativeScanProcessorError
        .rgbaExtractionFailed
    }

    return result
      .partialValue
  }

  // MARK: Part 4 entry

  // MARK: - Native model input contracts

fileprivate struct NativeScanLetterboxInfo:
  Sendable {

  let modelWidth:
    Int

  let modelHeight:
    Int

  let sourceWidth:
    Int

  let sourceHeight:
    Int

  let resizedWidth:
    Int

  let resizedHeight:
    Int

  let paddingLeft:
    Int

  let paddingTop:
    Int

  let paddingRight:
    Int

  let paddingBottom:
    Int

  let scale:
    Double
}

fileprivate struct NativeScanPreparedModelInput:
  @unchecked Sendable {

  /*
   * RGBA بحجم 1024 × 1024.
   *
   * نحتفظ به مؤقتًا لأن المراحل اللاحقة قد تحتاج
   * الصورة نفسها لبناء الـPrompts أو الـRefinement.
   */
  let letterboxedRGBA:
    Data

  /*
   * Tensor بصيغة:
   *
   * [1, 3, 1024, 1024]
   *
   * NCHW Float32
   */
  let encoderTensor:
    ContiguousArray<Float>

  let tensorShape:
    [NSNumber]

  let letterbox:
    NativeScanLetterboxInfo

  let originalRGBA:
    NativeScanRGBAImage
}

// MARK: - Native preprocessing

extension NativeScanProcessor {

  fileprivate func prepareSegmentationInput(
    _ rgbaImage:
      NativeScanRGBAImage,
    job:
      NativeScanJob,
    context:
      NativeScanProcessorContext,
    processingStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeScanProcessingOutput {
    try context
      .throwIfCancelled()

    await context.reportProgress(
      "resize-image",
      0.23,
      "Resizing the image for EdgeSAM.",
      nil
    )

    let preparedInput =
      try await createPreparedModelInput(
        from:
          rgbaImage,
        cancellationToken:
          context.cancellationToken
      )

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "apply-letterbox",
      0.28,
      "Applying the EdgeSAM letterbox.",
      nil
    )

    /*
     * Letterbox تم تنفيذه بالفعل داخل
     * createPreparedModelInput.
     *
     * نفصل Progress stage حتى يظل العقد مطابقًا
     * لمراحل Queue الحالية.
     */
    try context
      .throwIfCancelled()

    await context.reportProgress(
      "normalize-pixels",
      0.32,
      "Normalizing image pixels.",
      nil
    )

    /*
     * Normalization تم كذلك أثناء بناء Tensor،
     * لكننا نحافظ على Stage مستقلة لواجهة JavaScript.
     */
    try context
      .throwIfCancelled()

    await context.reportProgress(
      "create-encoder-tensor",
      0.36,
      "Creating the EdgeSAM encoder tensor.",
      nil
    )

    return try await runNativeSegmentation(
      preparedInput:
        preparedInput,
      job:
        job,
      context:
        context,
      processingStartedAt:
        processingStartedAt
    )
  }

  // MARK: Prepared model input

  private func createPreparedModelInput(
    from rgbaImage:
      NativeScanRGBAImage,
    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeScanPreparedModelInput {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          let modelWidth =
            1_024

          let modelHeight =
            1_024

          let sourceWidth =
            rgbaImage.width

          let sourceHeight =
            rgbaImage.height

          guard sourceWidth >
                  0,
                sourceHeight >
                  0 else {
            throw NativeScanProcessorError
              .invalidPreprocessingDimensions
          }

          let horizontalScale =
            Double(
              modelWidth
            ) /
            Double(
              sourceWidth
            )

          let verticalScale =
            Double(
              modelHeight
            ) /
            Double(
              sourceHeight
            )

          let scale =
            min(
              horizontalScale,
              verticalScale
            )

          guard scale.isFinite,
                scale >
                  0 else {
            throw NativeScanProcessorError
              .invalidPreprocessingScale
          }

          let resizedWidth =
            max(
              1,
              min(
                modelWidth,
                Int(
                  (
                    Double(
                      sourceWidth
                    ) *
                    scale
                  )
                  .rounded()
                )
              )
            )

          let resizedHeight =
            max(
              1,
              min(
                modelHeight,
                Int(
                  (
                    Double(
                      sourceHeight
                    ) *
                    scale
                  )
                  .rounded()
                )
              )
            )

          /*
           * EdgeSAM/SAM يضع الصورة في أعلى اليسار.
           *
           * لذلك:
           *
           * paddingLeft = 0
           * paddingTop = 0
           */
          let paddingLeft =
            0

          let paddingTop =
            0

          let paddingRight =
            modelWidth -
            resizedWidth

          let paddingBottom =
            modelHeight -
            resizedHeight

          guard paddingRight >=
                  0,
                paddingBottom >=
                  0 else {
            throw NativeScanProcessorError
              .invalidLetterboxDimensions
          }

          try cancellationToken
            .throwIfCancelled()

          let letterboxedRGBA =
            try self.createLetterboxedRGBA(
              source:
                rgbaImage,
              modelWidth:
                modelWidth,
              modelHeight:
                modelHeight,
              resizedWidth:
                resizedWidth,
              resizedHeight:
                resizedHeight,
              cancellationToken:
                cancellationToken
            )

          try cancellationToken
            .throwIfCancelled()

          let encoderTensor =
            try self.createEncoderTensor(
              letterboxedRGBA:
                letterboxedRGBA,
              width:
                modelWidth,
              height:
                modelHeight,
              cancellationToken:
                cancellationToken
            )

          try cancellationToken
            .throwIfCancelled()

          continuation.resume(
            returning:
              NativeScanPreparedModelInput(
                letterboxedRGBA:
                  letterboxedRGBA,
                encoderTensor:
                  encoderTensor,
                tensorShape:
                  [
                    1,
                    3,
                    NSNumber(
                      value:
                        modelHeight
                    ),
                    NSNumber(
                      value:
                        modelWidth
                    )
                  ],
                letterbox:
                  NativeScanLetterboxInfo(
                    modelWidth:
                      modelWidth,
                    modelHeight:
                      modelHeight,
                    sourceWidth:
                      sourceWidth,
                    sourceHeight:
                      sourceHeight,
                    resizedWidth:
                      resizedWidth,
                    resizedHeight:
                      resizedHeight,
                    paddingLeft:
                      paddingLeft,
                    paddingTop:
                      paddingTop,
                    paddingRight:
                      paddingRight,
                    paddingBottom:
                      paddingBottom,
                    scale:
                      scale
                  ),
                originalRGBA:
                  rgbaImage
              )
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

  // MARK: Letterbox RGBA

  private func createLetterboxedRGBA(
    source:
      NativeScanRGBAImage,
    modelWidth:
      Int,
    modelHeight:
      Int,
    resizedWidth:
      Int,
    resizedHeight:
      Int,
    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      Data {
    let sourceExpectedBytes =
      try checkedMultiply(
        source.bytesPerRow,
        source.height
      )

    guard source.pixelData.count ==
            sourceExpectedBytes else {
      throw NativeScanProcessorError
        .invalidSourceRGBALength(
          expected:
            sourceExpectedBytes,
          received:
            source.pixelData.count
        )
    }

    let modelBytesPerRow =
      try checkedMultiply(
        modelWidth,
        4
      )

    let modelByteCount =
      try checkedMultiply(
        modelBytesPerRow,
        modelHeight
      )

    /*
     * Data(count:) يبدأ بأصفار:
     *
     * R = 0
     * G = 0
     * B = 0
     * A = 0
     *
     * أثناء تجهيز Tensor، مناطق Padding ستظل RGB = 0.
     */
    var outputData =
      Data(
        count:
          modelByteCount
      )

    let sourceColorSpace =
      CGColorSpaceCreateDeviceRGB()

    let sourceBitmapInfo =
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

    let sourceImage:
      CGImage =
        try source
          .pixelData
          .withUnsafeBytes {
            rawBuffer in

            guard let baseAddress =
                    rawBuffer
                      .baseAddress else {
              throw NativeScanProcessorError
                .sourceCGImageCreationFailed
            }

            guard let provider =
                    CGDataProvider(
                      dataInfo:
                        nil,
                      data:
                        baseAddress,
                      size:
                        source.pixelData.count,
                      releaseData: {
                        _,
                        _,
                        _ in
                      }
                    ) else {
              throw NativeScanProcessorError
                .sourceCGImageCreationFailed
            }

            guard let image =
                    CGImage(
                      width:
                        source.width,
                      height:
                        source.height,
                      bitsPerComponent:
                        8,
                      bitsPerPixel:
                        32,
                      bytesPerRow:
                        source.bytesPerRow,
                      space:
                        sourceColorSpace,
                      bitmapInfo:
                        sourceBitmapInfo,
                      provider:
                        provider,
                      decode:
                        nil,
                      shouldInterpolate:
                        true,
                      intent:
                        .defaultIntent
                    ) else {
              throw NativeScanProcessorError
                .sourceCGImageCreationFailed
            }

            return image
          }

    try cancellationToken
      .throwIfCancelled()

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
                      modelWidth,
                    height:
                      modelHeight,
                    bitsPerComponent:
                      8,
                    bytesPerRow:
                      modelBytesPerRow,
                    space:
                      CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo:
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
                        .rawValue
                  ) else {
            return false
          }

          context
            .setBlendMode(
              .copy
            )

          context
            .interpolationQuality =
              .high

          /*
           * تحويل إحداثيات CGContext إلى أعلى-يسار.
           *
           * رسم y = 0 هنا يضع الصورة فعلًا في أعلى الـTensor.
           */
          context
            .translateBy(
              x:
                0,
              y:
                CGFloat(
                  modelHeight
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
                    0,
                  y:
                    0,
                  width:
                    resizedWidth,
                  height:
                    resizedHeight
                )
            )

          return true
        }

    guard didDraw else {
      throw NativeScanProcessorError
        .letterboxContextCreationFailed
    }

    try cancellationToken
      .throwIfCancelled()

    guard outputData.count ==
            modelByteCount else {
      throw NativeScanProcessorError
        .invalidLetterboxBufferLength
    }

    return outputData
  }

  // MARK: Encoder tensor

  private func createEncoderTensor(
    letterboxedRGBA:
      Data,
    width:
      Int,
    height:
      Int,
    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      ContiguousArray<Float> {
    let pixelCount =
      try checkedMultiply(
        width,
        height
      )

    let expectedRGBAByteCount =
      try checkedMultiply(
        pixelCount,
        4
      )

    guard letterboxedRGBA.count ==
            expectedRGBAByteCount else {
      throw NativeScanProcessorError
        .invalidLetterboxBufferLength
    }

    let tensorElementCount =
      try checkedMultiply(
        pixelCount,
        3
      )

    var tensor =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          tensorElementCount
      )

    /*
     * SAM / EdgeSAM normalization.
     *
     * الإدخال RGB ما بين 0 و255.
     */
    let redMean:
      Float =
        123.675

    let greenMean:
      Float =
        116.28

    let blueMean:
      Float =
        103.53

    let redStandardDeviation:
      Float =
        58.395

    let greenStandardDeviation:
      Float =
        57.12

    let blueStandardDeviation:
      Float =
        57.375

    let redOffset =
      0

    let greenOffset =
      pixelCount

    let blueOffset =
      pixelCount *
      2

    let cancellationCheckInterval =
      131_072

    try letterboxedRGBA
      .withUnsafeBytes {
        rawBuffer in

        let sourceBytes =
          rawBuffer
            .bindMemory(
              to:
                UInt8.self
            )

        try tensor
          .withUnsafeMutableBufferPointer {
            tensorBuffer in

            guard let tensorBase =
                    tensorBuffer
                      .baseAddress else {
              throw NativeScanProcessorError
                .encoderTensorAllocationFailed
            }

            for pixelIndex in
              0..<pixelCount {
              if pixelIndex %
                  cancellationCheckInterval ==
                  0 {
                try cancellationToken
                  .throwIfCancelled()
              }

              let rgbaIndex =
                pixelIndex *
                4

              let red =
                Float(
                  sourceBytes[
                    rgbaIndex
                  ]
                )

              let green =
                Float(
                  sourceBytes[
                    rgbaIndex +
                    1
                  ]
                )

              let blue =
                Float(
                  sourceBytes[
                    rgbaIndex +
                    2
                  ]
                )

              tensorBase[
                redOffset +
                pixelIndex
              ] =
                (
                  red -
                  redMean
                ) /
                redStandardDeviation

              tensorBase[
                greenOffset +
                pixelIndex
              ] =
                (
                  green -
                  greenMean
                ) /
                greenStandardDeviation

              tensorBase[
                blueOffset +
                pixelIndex
              ] =
                (
                  blue -
                  blueMean
                ) /
                blueStandardDeviation
            }
          }
      }

    try cancellationToken
      .throwIfCancelled()

    guard tensor.count ==
            tensorElementCount else {
      throw NativeScanProcessorError
        .encoderTensorCreationFailed
    }

    return tensor
  }
// MARK: Part 5 entry

  /*
   * الـEngine مشترك لأن:
   *
   * 1) NativeScanProcessingCoordinator يسمح أصلًا
   *    بتشغيل Job ثقيلة واحدة فقط.
   *
   * 2) NativeSegmentationEngine يمنع تشغيل أكثر من
   *    Inference في الوقت نفسه.
   *
   * 3) الاحتفاظ بالـONNX Sessions يمنع إعادة تحميل
   *    Encoder وDecoder مع كل صورة.
   */

  fileprivate func runNativeSegmentation(
    preparedInput:
      NativeScanPreparedModelInput,
    job:
      NativeScanJob,
    context:
      NativeScanProcessorContext,
    processingStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeScanProcessingOutput {
    try context
      .throwIfCancelled()

    /*
     * تهيئة ONNX Runtime وتحميل:
     *
     * - EdgeSAM Encoder
     * - EdgeSAM Decoder
     *
     * initialize() آمنة للاستدعاء المتكرر،
     * ولن تعيد تحميل الـSessions بعد نجاح التهيئة.
     */
    await context.reportProgress(
      "load-model-sessions",
      0.39,
      "Loading the native EdgeSAM model sessions.",
      nil
    )

    do {
      if
        !Self
          .sharedSegmentationEngine
          .isInitialized
      {
        _ =
          try await Self
            .sharedSegmentationEngine
            .initialize()
      }
    } catch {
      if
        context
          .cancellationToken
          .isCancelled ||
        Task.isCancelled
      {
        throw NativeScanProcessorError
          .cancelled(
            reason:
              context
                .cancellationToken
                .reason
          )
      }

      throw error
    }

    try context
      .throwIfCancelled()

    /*
     * تحويل Letterbox Contract المحلي إلى العقد
     * الذي يستقبله NativeSegmentationEngine.
     */
    let segmentationLetterbox =
      NativeSegmentationLetterboxInfo(
        modelWidth:
          preparedInput
            .letterbox
            .modelWidth,

        modelHeight:
          preparedInput
            .letterbox
            .modelHeight,

        sourceWidth:
          preparedInput
            .letterbox
            .sourceWidth,

        sourceHeight:
          preparedInput
            .letterbox
            .sourceHeight,

        resizedWidth:
          preparedInput
            .letterbox
            .resizedWidth,

        resizedHeight:
          preparedInput
            .letterbox
            .resizedHeight,

        paddingLeft:
          preparedInput
            .letterbox
            .paddingLeft,

        paddingTop:
          preparedInput
            .letterbox
            .paddingTop,

        paddingRight:
          preparedInput
            .letterbox
            .paddingRight,

        paddingBottom:
          preparedInput
            .letterbox
            .paddingBottom,

        scale:
          preparedInput
            .letterbox
            .scale
      )

    _ =
      try segmentationLetterbox
        .validated()

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "create-segmentation-prompt",
      0.43,
      "Creating the native segmentation prompt.",
      nil
    )

    /*
     * نقطة البداية الحالية:
     *
     * Foreground point في منتصف الصورة الأصلية.
     *
     * هذا لا يضيف Threshold أو يغيّر Post-processing.
     * Prompt profiles المتقدمة ستُربط لاحقًا في جزء
     * مستقل بدون تعديل Encoder أو Decoder.
     */
    let prompt =
      NativeSegmentationPromptSet
        .automaticCenterPrompt(
          imageWidth:
            preparedInput
              .letterbox
              .sourceWidth,

          imageHeight:
            preparedInput
              .letterbox
              .sourceHeight
        )

    try context
      .throwIfCancelled()

    let requestCreatedAt =
      NativeProcessingTime.now()

    let segmentationRequest =
      NativeSegmentationEngineRequest(
        jobId:
          job.jobId,

        encoderTensor:
          preparedInput
            .encoderTensor,

        encoderTensorShape:
          preparedInput
            .tensorShape,

        letterbox:
          segmentationLetterbox,

        prompt:
          prompt,

        createdAt:
          requestCreatedAt,

        metadata: [
          "pipeline":
            "native-edgesam",

          "processor":
            "NativeScanProcessor",

          "runtime":
            context
              .runtime
              .rawValue,

          "attempt":
            String(
              context.attempt
            )
        ]
      )

    let validatedRequest =
      try Self
        .sharedSegmentationEngine
        .validate(
          request:
            segmentationRequest
        )

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "run-image-encoder",
      0.47,
      "Running the native EdgeSAM encoder.",
      nil
    )

    /*
     * segment() تنفذ:
     *
     * 1) Encoder.
     * 2) Image embedding.
     * 3) Decoder input resolution.
     * 4) Prompt coordinate conversion.
     * 5) Decoder.
     * 6) Mask وScore output validation.
     */
    let segmentationResult:
      NativeSegmentationEngineResult

    do {
      segmentationResult =
        try await Self
          .sharedSegmentationEngine
          .segment(
            request:
              validatedRequest,

            cancellationToken:
              context
                .cancellationToken
          )
    } catch {
      if
        context
          .cancellationToken
          .isCancelled ||
        Task.isCancelled
      {
        throw NativeScanProcessorError
          .cancelled(
            reason:
              context
                .cancellationToken
                .reason ??
              error.localizedDescription
          )
      }

      if
        let engineError =
          error as?
            NativeSegmentationEngineError
      {
        switch engineError {
        case .cancelled(
          let reason
        ):
          throw NativeScanProcessorError
            .cancelled(
              reason:
                reason
            )

        default:
          throw engineError
        }
      }

      if
        let sessionError =
          error as?
            NativeONNXSessionError
      {
        switch sessionError {
        case .cancelled(
          let reason
        ):
          throw NativeScanProcessorError
            .cancelled(
              reason:
                reason
            )

        default:
          throw sessionError
        }
      }

      throw error
    }

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "create-decoder-inputs",
      0.61,
      "The EdgeSAM decoder inputs were created.",
      nil
    )

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "run-mask-decoder",
      0.72,
      "The native EdgeSAM decoder completed.",
      nil
    )

    guard
      segmentationResult
        .primaryMaskOutput !=
        nil
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    let maskDimensions =
      try Self
        .sharedSegmentationEngine
        .primaryMaskDimensions(
          from:
            segmentationResult
        )

    let maskCount =
      try Self
        .sharedSegmentationEngine
        .decoderMaskCount(
          from:
            segmentationResult
        )

    guard
      maskDimensions.width >
        0,
      maskDimensions.height >
        0,
      maskCount >
        0
    else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "read-mask-candidates",
      0.77,
      "Reading the native EdgeSAM mask candidates.",
      nil
    )

    /*
     * Part 6/8 يبدأ من الدالة التالية.
     *
     * مسؤوليته:
     *
     * 1) قراءة Float values من ORTValue.
     * 2) قراءة IoU / Score output.
     * 3) اختيار أفضل Mask.
     * 4) إزالة Letterbox.
     * 5) إعادة Mask إلى أبعاد الصورة الأصلية.
     * 6) تجهيز Alpha mask للـPost-processing.
     *
     * الدالة سيتم تعريفها تحت هذا الجزء مباشرة،
     * ولذلك لا نعيد نجاحًا وهميًا هنا.
     */
    return try await processNativeSegmentationResult(
      segmentationResult:
        segmentationResult,

      preparedInput:
        preparedInput,

      job:
        job,

      context:
        context,

      processingStartedAt:
        processingStartedAt
    )
  }
}
// MARK: - Native decoder output contracts

private struct NativeScanMaskTensorLayout:
  Sendable {

  let shape:
    [Int]

  let maskCount:
    Int

  let maskWidth:
    Int

  let maskHeight:
    Int

  let valuesPerMask:
    Int

  let totalValueCount:
    Int
}

private struct NativeScanSelectedMask:
  @unchecked Sendable {

  let logits:
    ContiguousArray<Float>

  let width:
    Int

  let height:
    Int

  let candidateIndex:
    Int

  let candidateCount:
    Int

  let score:
    Float?

  let sourceMaskShape:
    [Int]
}

// MARK: - Read and select decoder mask

extension NativeScanProcessor {

  fileprivate func processNativeSegmentationResult(
    segmentationResult:
      NativeSegmentationEngineResult,
    preparedInput:
      NativeScanPreparedModelInput,
    job:
      NativeScanJob,
    context:
      NativeScanProcessorContext,
    processingStartedAt:
      NativeProcessingTimestamp
  ) async throws ->
      NativeScanProcessingOutput {
    try context
      .throwIfCancelled()

    await context.reportProgress(
      "read-mask-candidates",
      0.79,
      "Reading native EdgeSAM mask values.",
      nil
    )

#if canImport(onnxruntime_objc)

    guard let primaryMaskOutput =
            segmentationResult
              .primaryMaskOutput else {
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    let maskLayout =
      try createMaskTensorLayout(
        output:
          primaryMaskOutput
      )

    try context
      .throwIfCancelled()

    let maskValues =
      try readFloatTensorValues(
        output:
          primaryMaskOutput,
        expectedElementCount:
          maskLayout
            .totalValueCount,
        cancellationToken:
          context
            .cancellationToken
      )

    try context
      .throwIfCancelled()

    let scoreValues:
      ContiguousArray<Float>?

    if let scoreOutput =
        segmentationResult
          .scoreOutput {
      scoreValues =
        try readOptionalScoreValues(
          output:
            scoreOutput,
          expectedMaskCount:
            maskLayout
              .maskCount,
          cancellationToken:
            context
              .cancellationToken
        )
    } else {
      scoreValues =
        nil
    }

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "select-best-mask",
      0.83,
      "Selecting the best native EdgeSAM mask.",
      nil
    )

    let selectedCandidateIndex =
      selectBestMaskCandidateIndex(
        maskCount:
          maskLayout
            .maskCount,
        scores:
          scoreValues
      )

    let selectedMask =
      try extractSelectedMask(
        allMaskValues:
          maskValues,
        layout:
          maskLayout,
        candidateIndex:
          selectedCandidateIndex,
        scores:
          scoreValues,
        cancellationToken:
          context
            .cancellationToken
      )

    try context
      .throwIfCancelled()

    /*
     * Part 7/8 سيبدأ من الدالة التالية:
     *
     * 1) Sigmoid للـLogits.
     * 2) إزالة Letterbox.
     * 3) Resize إلى أبعاد الصورة الأصلية.
     * 4) إنشاء Alpha Mask.
     * 5) دمج Alpha مع RGBA الأصلية.
     */
    return try await processSelectedNativeMask(
      selectedMask:
        selectedMask,
      preparedInput:
        preparedInput,
      job:
        job,
      context:
        context,
      processingStartedAt:
        processingStartedAt,
      segmentationTiming:
        segmentationResult
          .timing
    )

#else

    _ =
      segmentationResult

    _ =
      preparedInput

    _ =
      job

    _ =
      processingStartedAt

    throw NativeSegmentationEngineError
      .decoderExecutionUnavailable

#endif
  }

#if canImport(onnxruntime_objc)

  // MARK: Mask tensor layout

  private func createMaskTensorLayout(
    output:
      NativeONNXTensorOutput
  ) throws ->
      NativeScanMaskTensorLayout {
    let shape =
      output
        .shape
        .map {
          $0.intValue
        }

    guard shape.count >=
            2,
          shape.count <=
            4 else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            Native EdgeSAM mask output has an unsupported shape: \(shape).
            """
        )
    }

    guard shape.allSatisfy({
      $0 >
        0
    }) else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            Native EdgeSAM mask output contains an invalid dimension: \(shape).
            """
        )
    }

    let maskWidth =
      shape[
        shape.count -
        1
      ]

    let maskHeight =
      shape[
        shape.count -
        2
      ]

    let maskCount:
      Int

    switch shape.count {
    case 4:
      /*
       * الشكل المتوقع:
       *
       * [batch, masks, height, width]
       *
       * المعالجة الحالية تدعم Batch واحدة فقط.
       */
      guard shape[
        0
      ] ==
        1 else {
        throw NativeSegmentationEngineError
          .segmentationFailed(
            message:
              """
              Native EdgeSAM mask output uses an unsupported batch size: \(shape).
              """
          )
      }

      maskCount =
        shape[
          1
        ]

    case 3:
      /*
       * الشكل:
       *
       * [masks, height, width]
       */
      maskCount =
        shape[
          0
        ]

    case 2:
      /*
       * الشكل:
       *
       * [height, width]
       */
      maskCount =
        1

    default:
      throw NativeSegmentationEngineError
        .decoderOutputUnavailable
    }

    let valuesPerMaskResult =
      maskWidth
        .multipliedReportingOverflow(
          by:
            maskHeight
        )

    guard !valuesPerMaskResult
            .overflow,
          valuesPerMaskResult
            .partialValue >
            0 else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "Native EdgeSAM mask dimensions overflowed."
        )
    }

    let valuesPerMask =
      valuesPerMaskResult
        .partialValue

    let totalValueCountResult =
      valuesPerMask
        .multipliedReportingOverflow(
          by:
            maskCount
        )

    guard !totalValueCountResult
            .overflow,
          totalValueCountResult
            .partialValue >
            0 else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "Native EdgeSAM mask element count overflowed."
        )
    }

    let totalValueCount =
      totalValueCountResult
        .partialValue

    guard totalValueCount ==
            output
              .elementCount else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            Native EdgeSAM mask output expected \(totalValueCount) values but ONNX reported \(output.elementCount).
            """
        )
    }

    return NativeScanMaskTensorLayout(
      shape:
        shape,
      maskCount:
        maskCount,
      maskWidth:
        maskWidth,
      maskHeight:
        maskHeight,
      valuesPerMask:
        valuesPerMask,
      totalValueCount:
        totalValueCount
    )
  }

  // MARK: Read Float32 output

  private func readFloatTensorValues(
    output:
      NativeONNXTensorOutput,
    expectedElementCount:
      Int,
    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      ContiguousArray<Float> {
    guard expectedElementCount >
            0 else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "Native ONNX output expected element count is invalid."
        )
    }

    guard output.elementType ==
            .float else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            Native EdgeSAM output \(output.name) uses unsupported element type \(String(describing: output.elementType)). Float32 is required.
            """
        )
    }

    try cancellationToken
      .throwIfCancelled()

    let tensorData:
      NSMutableData

    do {
      tensorData =
        try output
          .value
          .tensorData()
    } catch {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            Could not read Native EdgeSAM output \(output.name): \(error.localizedDescription)
            """
        )
    }

    let expectedByteCountResult =
      expectedElementCount
        .multipliedReportingOverflow(
          by:
            MemoryLayout<Float>
              .stride
        )

    guard !expectedByteCountResult
            .overflow,
          expectedByteCountResult
            .partialValue >
            0 else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "Native ONNX output byte count overflowed."
        )
    }

    let expectedByteCount =
      expectedByteCountResult
        .partialValue

    guard tensorData.length >=
            expectedByteCount else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            Native EdgeSAM output \(output.name) contains \(tensorData.length) bytes, but \(expectedByteCount) bytes are required.
            """
        )
    }

    var values =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          expectedElementCount
      )

    let cancellationCheckInterval =
      131_072

    let sourcePointer =
      tensorData
        .bytes
        .assumingMemoryBound(
          to:
            Float.self
        )

    try values
      .withUnsafeMutableBufferPointer {
        destinationBuffer in

        guard let destinationPointer =
                destinationBuffer
                  .baseAddress else {
          throw NativeSegmentationEngineError
            .segmentationFailed(
              message:
                "Could not allocate native mask output storage."
            )
        }

        for index in
          0..<expectedElementCount {
          if index %
              cancellationCheckInterval ==
              0 {
            try cancellationToken
              .throwIfCancelled()
          }

          let value =
            sourcePointer[
              index
            ]

          guard value.isFinite else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  """
                  Native EdgeSAM output \(output.name) contains a non-finite value at index \(index).
                  """
              )
          }

          destinationPointer[
            index
          ] =
            value
        }
      }

    try cancellationToken
      .throwIfCancelled()

    return values
  }

  // MARK: Score values

  private func readOptionalScoreValues(
    output:
      NativeONNXTensorOutput,
    expectedMaskCount:
      Int,
    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      ContiguousArray<Float>? {
    guard output.elementCount >
            0 else {
      return nil
    }

    let allScores =
      try readFloatTensorValues(
        output:
          output,
        expectedElementCount:
          output.elementCount,
        cancellationToken:
          cancellationToken
      )

    guard !allScores.isEmpty else {
      return nil
    }

    /*
     * بعض exports قد تعيد قيمًا إضافية.
     *
     * نستخدم أول maskCount قيم فقط طالما العدد كافٍ.
     */
    guard allScores.count >=
            expectedMaskCount else {
      return nil
    }

    if allScores.count ==
        expectedMaskCount {
      return allScores
    }

    var normalizedScores =
      ContiguousArray<Float>()

    normalizedScores.reserveCapacity(
      expectedMaskCount
    )

    for index in
      0..<expectedMaskCount {
      normalizedScores.append(
        allScores[
          index
        ]
      )
    }

    return normalizedScores
  }

  // MARK: Candidate selection

  private func selectBestMaskCandidateIndex(
    maskCount:
      Int,
    scores:
      ContiguousArray<Float>?
  ) -> Int {
    guard maskCount >
            1 else {
      return 0
    }

    guard let scores,
          scores.count >=
            maskCount else {
      return 0
    }

    var selectedIndex =
      0

    var selectedScore =
      scores[
        0
      ]

    for index in
      1..<maskCount {
      let score =
        scores[
          index
        ]

      if score >
          selectedScore {
        selectedScore =
          score

        selectedIndex =
          index
      }
    }

    return selectedIndex
  }

  // MARK: Extract selected candidate

  private func extractSelectedMask(
    allMaskValues:
      ContiguousArray<Float>,
    layout:
      NativeScanMaskTensorLayout,
    candidateIndex:
      Int,
    scores:
      ContiguousArray<Float>?,
    cancellationToken:
      NativeScanCancellationToken
  ) throws ->
      NativeScanSelectedMask {
    guard candidateIndex >=
            0,
          candidateIndex <
            layout
              .maskCount else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            Native EdgeSAM selected mask index \(candidateIndex) is outside the valid range.
            """
        )
    }

    guard allMaskValues.count ==
            layout
              .totalValueCount else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "Native EdgeSAM mask storage does not match its tensor layout."
        )
    }

    let startIndexResult =
      candidateIndex
        .multipliedReportingOverflow(
          by:
            layout
              .valuesPerMask
        )

    guard !startIndexResult
            .overflow else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "Native EdgeSAM selected-mask offset overflowed."
        )
    }

    let startIndex =
      startIndexResult
        .partialValue

    let endIndexResult =
      startIndex
        .addingReportingOverflow(
          layout
            .valuesPerMask
        )

    guard !endIndexResult
            .overflow,
          endIndexResult
            .partialValue <=
            allMaskValues
              .count else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "Native EdgeSAM selected-mask range is invalid."
        )
    }

    let endIndex =
      endIndexResult
        .partialValue

    var selectedLogits =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          layout
            .valuesPerMask
      )

    let cancellationCheckInterval =
      131_072

    try selectedLogits
      .withUnsafeMutableBufferPointer {
        destinationBuffer in

        guard let destinationPointer =
                destinationBuffer
                  .baseAddress else {
          throw NativeSegmentationEngineError
            .segmentationFailed(
              message:
                "Could not allocate selected-mask storage."
            )
        }

        var sourceIndex =
          startIndex

        var destinationIndex =
          0

        while sourceIndex <
                endIndex {
          if destinationIndex %
              cancellationCheckInterval ==
              0 {
            try cancellationToken
              .throwIfCancelled()
          }

          destinationPointer[
            destinationIndex
          ] =
            allMaskValues[
              sourceIndex
            ]

          sourceIndex +=
            1

          destinationIndex +=
            1
        }
      }

    let selectedScore:
      Float?

    if let scores,
       candidateIndex <
         scores.count {
      selectedScore =
        scores[
          candidateIndex
        ]
    } else {
      selectedScore =
        nil
    }

    return NativeScanSelectedMask(
      logits:
        selectedLogits,
      width:
        layout
          .maskWidth,
      height:
        layout
          .maskHeight,
      candidateIndex:
        candidateIndex,
      candidateCount:
        layout
          .maskCount,
      score:
        selectedScore,
      sourceMaskShape:
        layout
          .shape
    )
  }

#endif
}
// MARK: - Restored native mask contracts

private struct NativeScanRestoredMask:
  @unchecked Sendable {

  let width:
    Int

  let height:
    Int

  /*
   * قيم بين 0 و1 بعد:
   *
   * - Sigmoid
   * - إزالة Letterbox
   * - Resize إلى الحجم الأصلي
   */
  let probabilities:
    ContiguousArray<Float>

  /*
   * Alpha بقيم 0...255.
   */
  let alpha:
    Data

  let foregroundRatio:
    Double

  let candidateIndex:
    Int

  let candidateCount:
    Int

  let candidateScore:
    Float?
}

private struct NativeScanTransparentImage:
  @unchecked Sendable {

  let width:
    Int

  let height:
    Int

  let bytesPerRow:
    Int

  let rgba:
    Data

  let foregroundRatio:
    Double

  let candidateIndex:
    Int

  let candidateCount:
    Int

  let candidateScore:
    Float?
}

// MARK: - Restore selected mask

extension NativeScanProcessor {

  fileprivate func processSelectedNativeMask(
    selectedMask:
      NativeScanSelectedMask,

    preparedInput:
      NativeScanPreparedModelInput,

    job:
      NativeScanJob,

    context:
      NativeScanProcessorContext,

    processingStartedAt:
      NativeProcessingTimestamp,

    segmentationTiming:
      NativeSegmentationEngineTiming
  ) async throws ->
      NativeScanProcessingOutput {
    try context
      .throwIfCancelled()

    await context.reportProgress(
      "refine-alpha-mask",
      0.86,
      "Creating the native alpha mask.",
      nil
    )

    let restoredMask =
      try await restoreSelectedMaskToSource(
        selectedMask:
          selectedMask,

        letterbox:
          preparedInput
            .letterbox,

        cancellationToken:
          context
            .cancellationToken
      )

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "restore-original-size",
      0.90,
      "Restoring the mask to the original image size.",
      nil
    )

    guard
      restoredMask.width ==
        preparedInput
          .originalRGBA
          .width,
      restoredMask.height ==
        preparedInput
          .originalRGBA
          .height
    else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            """
            The restored native mask dimensions do not match the original image.
            """
        )
    }

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "protect-object-edges",
      0.93,
      "Applying the native alpha mask to the clothing item.",
      nil
    )

    let transparentImage =
      try await createTransparentSourceImage(
        source:
          preparedInput
            .originalRGBA,

        restoredMask:
          restoredMask,

        cancellationToken:
          context
            .cancellationToken
      )

    try context
      .throwIfCancelled()

    /*
     * Part 8/8 سيقوم بـ:
     *
     * 1) إنشاء CGImage من RGBA الشفافة.
     * 2) ترميز PNG.
     * 3) تحديد Output directory.
     * 4) الكتابة الذرية على القرص.
     * 5) إنشاء NativeScanProcessingOutput.
     */
    return try await exportTransparentNativeImage(
      transparentImage:
        transparentImage,

      job:
        job,

      context:
        context,

      processingStartedAt:
        processingStartedAt,

      segmentationTiming:
        segmentationTiming
    )
  }

  // MARK: Restore mask to source dimensions

  private func restoreSelectedMaskToSource(
    selectedMask:
      NativeScanSelectedMask,

    letterbox:
      NativeScanLetterboxInfo,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeScanRestoredMask {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          let sourceWidth =
            letterbox
              .sourceWidth

          let sourceHeight =
            letterbox
              .sourceHeight

          let modelWidth =
            letterbox
              .modelWidth

          let modelHeight =
            letterbox
              .modelHeight

          let maskWidth =
            selectedMask
              .width

          let maskHeight =
            selectedMask
              .height

          guard
            sourceWidth >
              0,
            sourceHeight >
              0,
            modelWidth >
              0,
            modelHeight >
              0,
            maskWidth >
              0,
            maskHeight >
              0
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "Native mask restoration received invalid dimensions."
              )
          }

          let expectedMaskValueCountResult =
            maskWidth
              .multipliedReportingOverflow(
                by:
                  maskHeight
              )

          guard
            !expectedMaskValueCountResult
              .overflow,
            expectedMaskValueCountResult
              .partialValue ==
              selectedMask
                .logits
                .count
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The selected native mask buffer does not match its dimensions."
              )
          }

          let sourcePixelCountResult =
            sourceWidth
              .multipliedReportingOverflow(
                by:
                  sourceHeight
              )

          guard
            !sourcePixelCountResult
              .overflow,
            sourcePixelCountResult
              .partialValue >
              0
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The restored native mask pixel count overflowed."
              )
          }

          let sourcePixelCount =
            sourcePixelCountResult
              .partialValue

          var probabilities =
            ContiguousArray<Float>(
              repeating:
                0,

              count:
                sourcePixelCount
            )

          var alpha =
            Data(
              count:
                sourcePixelCount
            )

          let scale =
            Float(
              letterbox
                .scale
            )

          guard
            scale.isFinite,
            scale >
              0
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The native mask letterbox scale is invalid."
              )
          }

          let paddingLeft =
            Float(
              letterbox
                .paddingLeft
            )

          let paddingTop =
            Float(
              letterbox
                .paddingTop
            )

          let maskScaleX =
            Float(
              maskWidth
            ) /
            Float(
              modelWidth
            )

          let maskScaleY =
            Float(
              maskHeight
            ) /
            Float(
              modelHeight
            )

          guard
            maskScaleX.isFinite,
            maskScaleY.isFinite,
            maskScaleX >
              0,
            maskScaleY >
              0
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The native decoder-mask scale is invalid."
              )
          }

          let cancellationRowInterval =
            32

          var foregroundPixelCount:
            Int64 =
              0

          try probabilities
            .withUnsafeMutableBufferPointer {
              probabilityBuffer in

              guard
                let probabilityBaseAddress =
                  probabilityBuffer
                    .baseAddress
              else {
                throw NativeSegmentationEngineError
                  .segmentationFailed(
                    message:
                      "Could not allocate restored native mask probabilities."
                  )
              }

              try alpha
                .withUnsafeMutableBytes {
                  alphaRawBuffer in

                  let alphaBytes =
                    alphaRawBuffer
                      .bindMemory(
                        to:
                          UInt8.self
                      )

                  guard
                    alphaBytes.count ==
                      sourcePixelCount
                  else {
                    throw NativeSegmentationEngineError
                      .segmentationFailed(
                        message:
                          "Could not allocate the restored native alpha mask."
                      )
                  }

                  for sourceY in
                    0..<sourceHeight
                  {
                    if
                      sourceY %
                        cancellationRowInterval ==
                        0
                    {
                      try cancellationToken
                        .throwIfCancelled()
                    }

                    /*
                     * نحول مركز Pixel المصدر إلى:
                     *
                     * source space
                     *      ↓
                     * model letterbox space
                     *      ↓
                     * decoder-mask space
                     */
                    let sourceCenterY =
                      Float(
                        sourceY
                      ) +
                      0.5

                    let modelY =
                      (
                        sourceCenterY *
                        scale
                      ) +
                      paddingTop

                    let maskY =
                      (
                        modelY *
                        maskScaleY
                      ) -
                      0.5

                    for sourceX in
                      0..<sourceWidth
                    {
                      let sourceCenterX =
                        Float(
                          sourceX
                        ) +
                        0.5

                      let modelX =
                        (
                          sourceCenterX *
                          scale
                        ) +
                        paddingLeft

                      let maskX =
                        (
                          modelX *
                          maskScaleX
                        ) -
                        0.5

                      let interpolatedLogit =
                        self
                          .bilinearSampleMaskLogits(
                            selectedMask
                              .logits,

                            width:
                              maskWidth,

                            height:
                              maskHeight,

                            x:
                              maskX,

                            y:
                              maskY
                          )

                      let probability =
                        self
                          .stableSigmoid(
                            interpolatedLogit
                          )

                      let sourceIndex =
                        (
                          sourceY *
                          sourceWidth
                        ) +
                        sourceX

                      probabilityBaseAddress[
                        sourceIndex
                      ] =
                        probability

                      let alphaValue =
                        UInt8(
                          min(
                            255,
                            max(
                              0,
                              Int(
                                (
                                  probability *
                                  255
                                )
                                .rounded()
                              )
                            )
                          )
                        )

                      alphaBytes[
                        sourceIndex
                      ] =
                        alphaValue

                      /*
                       * threshold 0.5 هنا لا يغير الـAlpha.
                       *
                       * يستخدم فقط لحساب foregroundRatio
                       * التشخيصية في النتيجة.
                       */
                      if
                        probability >=
                          0.5
                      {
                        foregroundPixelCount +=
                          1
                      }
                    }
                  }
                }
            }

          try cancellationToken
            .throwIfCancelled()

          let foregroundRatio:
            Double

          if
            sourcePixelCount >
              0
          {
            foregroundRatio =
              Double(
                foregroundPixelCount
              ) /
              Double(
                sourcePixelCount
              )
          } else {
            foregroundRatio =
              0
          }

          continuation.resume(
            returning:
              NativeScanRestoredMask(
                width:
                  sourceWidth,

                height:
                  sourceHeight,

                probabilities:
                  probabilities,

                alpha:
                  alpha,

                foregroundRatio:
                  min(
                    1,
                    max(
                      0,
                      foregroundRatio
                    )
                  ),

                candidateIndex:
                  selectedMask
                    .candidateIndex,

                candidateCount:
                  selectedMask
                    .candidateCount,

                candidateScore:
                  selectedMask
                    .score
              )
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

  // MARK: Stable sigmoid

  private func stableSigmoid(
    _ value:
      Float
  ) -> Float {
    guard
      value.isFinite
    else {
      return 0
    }

    /*
     * الصيغة المتفرعة تمنع Overflow مع
     * Logits الكبيرة جدًا الموجبة أو السالبة.
     */
    if
      value >=
        0
    {
      let exponential =
        expf(
          -value
        )

      return 1 /
        (
          1 +
          exponential
        )
    }

    let exponential =
      expf(
        value
      )

    return exponential /
      (
        1 +
        exponential
      )
  }

  // MARK: Bilinear sampling

  private func bilinearSampleMaskLogits(
    _ logits:
      ContiguousArray<Float>,

    width:
      Int,

    height:
      Int,

    x:
      Float,

    y:
      Float
  ) -> Float {
    guard
      width >
        0,
      height >
        0,
      logits.count ==
        width *
        height,
      x.isFinite,
      y.isFinite
    else {
      return -20
    }

    /*
     * نقاط المصدر يجب أن تقع داخل الجزء غير المبطن
     * بعد تحويلها من أبعاد الصورة الأصلية.
     *
     * Clamp هنا يحمي فقط من أخطاء التقريب عند الحافة.
     */
    let maximumX =
      Float(
        max(
          0,
          width -
          1
        )
      )

    let maximumY =
      Float(
        max(
          0,
          height -
          1
        )
      )

    let clampedX =
      min(
        maximumX,
        max(
          0,
          x
        )
      )

    let clampedY =
      min(
        maximumY,
        max(
          0,
          y
        )
      )

    let x0 =
      Int(
        floorf(
          clampedX
        )
      )

    let y0 =
      Int(
        floorf(
          clampedY
        )
      )

    let x1 =
      min(
        width -
        1,
        x0 +
        1
      )

    let y1 =
      min(
        height -
        1,
        y0 +
        1
      )

    let fractionX =
      clampedX -
      Float(
        x0
      )

    let fractionY =
      clampedY -
      Float(
        y0
      )

    let topLeft =
      logits[
        (
          y0 *
          width
        ) +
        x0
      ]

    let topRight =
      logits[
        (
          y0 *
          width
        ) +
        x1
      ]

    let bottomLeft =
      logits[
        (
          y1 *
          width
        ) +
        x0
      ]

    let bottomRight =
      logits[
        (
          y1 *
          width
        ) +
        x1
      ]

    let top =
      topLeft +
      (
        (
          topRight -
          topLeft
        ) *
        fractionX
      )

    let bottom =
      bottomLeft +
      (
        (
          bottomRight -
          bottomLeft
        ) *
        fractionX
      )

    return top +
      (
        (
          bottom -
          top
        ) *
        fractionY
      )
  }

  // MARK: Apply alpha to original RGBA

  private func createTransparentSourceImage(
    source:
      NativeScanRGBAImage,

    restoredMask:
      NativeScanRestoredMask,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      NativeScanTransparentImage {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          guard
            source.width ==
              restoredMask.width,
            source.height ==
              restoredMask.height
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The source image and restored alpha mask dimensions do not match."
              )
          }

          let pixelCountResult =
            source.width
              .multipliedReportingOverflow(
                by:
                  source.height
              )

          guard
            !pixelCountResult
              .overflow,
            pixelCountResult
              .partialValue >
              0
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The transparent output pixel count overflowed."
              )
          }

          let pixelCount =
            pixelCountResult
              .partialValue

          let expectedRGBAByteCountResult =
            pixelCount
              .multipliedReportingOverflow(
                by:
                  4
              )

          guard
            !expectedRGBAByteCountResult
              .overflow
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The transparent output RGBA byte count overflowed."
              )
          }

          let expectedRGBAByteCount =
            expectedRGBAByteCountResult
              .partialValue

          guard
            source.pixelData.count ==
              expectedRGBAByteCount,
            restoredMask.alpha.count ==
              pixelCount
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The source RGBA or restored alpha buffer has an invalid length."
              )
          }

          var outputRGBA =
            Data(
              count:
                expectedRGBAByteCount
            )

          let cancellationCheckInterval =
            131_072

          try source
            .pixelData
            .withUnsafeBytes {
              sourceRawBuffer in

              let sourceBytes =
                sourceRawBuffer
                  .bindMemory(
                    to:
                      UInt8.self
                  )

              try restoredMask
                .alpha
                .withUnsafeBytes {
                  alphaRawBuffer in

                  let maskAlphaBytes =
                    alphaRawBuffer
                      .bindMemory(
                        to:
                          UInt8.self
                      )

                  try outputRGBA
                    .withUnsafeMutableBytes {
                      outputRawBuffer in

                      let outputBytes =
                        outputRawBuffer
                          .bindMemory(
                            to:
                              UInt8.self
                          )

                      guard
                        sourceBytes.count ==
                          expectedRGBAByteCount,
                        outputBytes.count ==
                          expectedRGBAByteCount,
                        maskAlphaBytes.count ==
                          pixelCount
                      else {
                        throw NativeSegmentationEngineError
                          .segmentationFailed(
                            message:
                              "Could not access transparent native image buffers."
                          )
                      }

                      for pixelIndex in
                        0..<pixelCount
                      {
                        if
                          pixelIndex %
                            cancellationCheckInterval ==
                            0
                        {
                          try cancellationToken
                            .throwIfCancelled()
                        }

                        let rgbaIndex =
                          pixelIndex *
                          4

                        let maskAlpha =
                          UInt16(
                            maskAlphaBytes[
                              pixelIndex
                            ]
                          )

                        let sourceAlpha =
                          UInt16(
                            sourceBytes[
                              rgbaIndex +
                              3
                            ]
                          )

                        /*
                         * نحافظ على Alpha المصدر لو كانت
                         * الصورة الأصلية تحتوي شفافية بالفعل.
                         */
                        let combinedAlpha =
                          UInt8(
                            (
                              maskAlpha *
                              sourceAlpha +
                              127
                            ) /
                            255
                          )

                        /*
                         * RGBA المصدر Premultiplied.
                         *
                         * نعيد ضرب RGB في mask alpha حتى
                         * تظل البيانات Premultiplied ومتوافقة
                         * مع CGImageAlphaInfo.premultipliedLast.
                         */
                        outputBytes[
                          rgbaIndex
                        ] =
                          UInt8(
                            (
                              UInt16(
                                sourceBytes[
                                  rgbaIndex
                                ]
                              ) *
                              maskAlpha +
                              127
                            ) /
                            255
                          )

                        outputBytes[
                          rgbaIndex +
                          1
                        ] =
                          UInt8(
                            (
                              UInt16(
                                sourceBytes[
                                  rgbaIndex +
                                  1
                                ]
                              ) *
                              maskAlpha +
                              127
                            ) /
                            255
                          )

                        outputBytes[
                          rgbaIndex +
                          2
                        ] =
                          UInt8(
                            (
                              UInt16(
                                sourceBytes[
                                  rgbaIndex +
                                  2
                                ]
                              ) *
                              maskAlpha +
                              127
                            ) /
                            255
                          )

                        outputBytes[
                          rgbaIndex +
                          3
                        ] =
                          combinedAlpha
                      }
                    }
                }
            }

          try cancellationToken
            .throwIfCancelled()

          continuation.resume(
            returning:
              NativeScanTransparentImage(
                width:
                  source.width,

                height:
                  source.height,

                bytesPerRow:
                  source.bytesPerRow,

                rgba:
                  outputRGBA,

                foregroundRatio:
                  restoredMask
                    .foregroundRatio,

                candidateIndex:
                  restoredMask
                    .candidateIndex,

                candidateCount:
                  restoredMask
                    .candidateCount,

                candidateScore:
                  restoredMask
                    .candidateScore
              )
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
}

// MARK: - Native transparent PNG export

extension NativeScanProcessor {

  fileprivate func exportTransparentNativeImage(
    transparentImage:
      NativeScanTransparentImage,

    job:
      NativeScanJob,

    context:
      NativeScanProcessorContext,

    processingStartedAt:
      NativeProcessingTimestamp,

    segmentationTiming:
      NativeSegmentationEngineTiming
  ) async throws ->
      NativeScanProcessingOutput {
    try context
      .throwIfCancelled()

    await context.reportProgress(
      "export-transparent-image",
      0.96,
      "Exporting the transparent clothing image.",
      nil
    )

    let pngData =
      try await createTransparentPNGData(
        transparentImage:
          transparentImage,

        cancellationToken:
          context
            .cancellationToken
      )

    try context
      .throwIfCancelled()

    await context.reportProgress(
      "save-processed-image",
      0.98,
      "Saving the processed clothing image.",
      nil
    )

    let outputURL =
      try await saveTransparentPNG(
        pngData:
          pngData,

        job:
          job,

        cancellationToken:
          context
            .cancellationToken
      )

    try context
      .throwIfCancelled()

    let outputAttributes =
      try fileManager
        .attributesOfItem(
          atPath:
            outputURL.path
        )

    let fileSizeBytes =
      (
        outputAttributes[
          .size
        ] as? NSNumber
      )?
      .int64Value ??
      Int64(
        pngData.count
      )

    guard
      fileSizeBytes >
        0
    else {
      throw NativeSegmentationEngineError
        .segmentationFailed(
          message:
            "The exported transparent PNG file is empty."
        )
    }

    let completedAt =
      NativeProcessingTime.now()

    let processingDurationMs =
      normalizedProcessingDuration(
        startedAt:
          processingStartedAt,

        completedAt:
          completedAt
      )

    await context.reportProgress(
      "complete",
      1.0,
      "Native clothing processing completed.",
      0
    )

    /*
     * metadata تظل فارغة حاليًا لضمان توافقها
     * مع نوع Metadata الموجود داخل العقود.
     *
     * يمكن إضافة Diagnostics إليها لاحقًا بعد
     * مراجعة NativeProcessingContracts بالكامل.
     */
    return NativeScanProcessingOutput(
      processedImageUri:
        outputURL
          .absoluteString,

      width:
        transparentImage
          .width,

      height:
        transparentImage
          .height,

      format:
        "png",

      fileSizeBytes:
        fileSizeBytes,

      foregroundRatio:
        transparentImage
          .foregroundRatio,

      processingDurationMs:
        processingDurationMs,

      completedAt:
        completedAt,

      metadata:
        [:]
    )
  }

  // MARK: - PNG creation

  private func createTransparentPNGData(
    transparentImage:
      NativeScanTransparentImage,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      Data {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          let width =
            transparentImage
              .width

          let height =
            transparentImage
              .height

          let bytesPerRow =
            transparentImage
              .bytesPerRow

          guard
            width >
              0,
            height >
              0,
            bytesPerRow ==
              width *
              4
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The transparent image dimensions or row size are invalid."
              )
          }

          let expectedByteCountResult =
            bytesPerRow
              .multipliedReportingOverflow(
                by:
                  height
              )

          guard
            !expectedByteCountResult
              .overflow,
            expectedByteCountResult
              .partialValue >
              0,
            transparentImage
              .rgba
              .count ==
              expectedByteCountResult
                .partialValue
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The transparent RGBA buffer has an invalid length."
              )
          }

          try cancellationToken
            .throwIfCancelled()

          let colorSpace =
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

          guard
            let dataProvider =
              CGDataProvider(
                data:
                  transparentImage
                    .rgba as CFData
              )
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "Could not create a data provider for the transparent image."
              )
          }

          guard
            let cgImage =
              CGImage(
                width:
                  width,

                height:
                  height,

                bitsPerComponent:
                  8,

                bitsPerPixel:
                  32,

                bytesPerRow:
                  bytesPerRow,

                space:
                  colorSpace,

                bitmapInfo:
                  bitmapInfo,

                provider:
                  dataProvider,

                decode:
                  nil,

                shouldInterpolate:
                  true,

                intent:
                  .defaultIntent
              )
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "Could not create a CGImage for transparent PNG export."
              )
          }

          try cancellationToken
            .throwIfCancelled()

          let destinationData =
            NSMutableData()

          guard
            let destination =
              CGImageDestinationCreateWithData(
                destinationData,
                UTType.png
                  .identifier as CFString,
                1,
                nil
              )
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "Could not create the transparent PNG encoder."
              )
          }

          let properties:
            CFDictionary = [
              kCGImagePropertyPNGInterlaceType:
                0
            ] as CFDictionary

          CGImageDestinationAddImage(
            destination,
            cgImage,
            properties
          )

          try cancellationToken
            .throwIfCancelled()

          guard
            CGImageDestinationFinalize(
              destination
            )
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "Transparent PNG encoding did not complete successfully."
              )
          }

          let pngData =
            destinationData as Data

          guard
            !pngData.isEmpty
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "Transparent PNG encoding returned empty data."
              )
          }

          try cancellationToken
            .throwIfCancelled()

          continuation.resume(
            returning:
              pngData
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

  // MARK: - Save PNG

  private func saveTransparentPNG(
    pngData:
      Data,

    job:
      NativeScanJob,

    cancellationToken:
      NativeScanCancellationToken
  ) async throws ->
      URL {
    try await withCheckedThrowingContinuation {
      continuation in

      imageLoadingQueue.async {
        do {
          try cancellationToken
            .throwIfCancelled()

          guard
            !pngData.isEmpty
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The transparent PNG data is empty."
              )
          }

          let outputDirectory =
            try self
              .resolveOutputDirectory(
                job:
                  job
              )

          try self.fileManager
            .createDirectory(
              at:
                outputDirectory,

              withIntermediateDirectories:
                true,

              attributes:
                nil
            )

          try cancellationToken
            .throwIfCancelled()

          let outputFileName =
            self
              .resolveOutputFileName(
                requestedFileName:
                  job
                    .options
                    .outputFileName,

                jobId:
                  job
                    .jobId
              )

          let outputURL =
            outputDirectory
              .appendingPathComponent(
                outputFileName,
                isDirectory:
                  false
              )
              .standardizedFileURL

          guard
            outputURL
              .deletingLastPathComponent()
              .standardizedFileURL ==
            outputDirectory
              .standardizedFileURL
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The native processing output path is unsafe."
              )
          }

          let outputExists =
            self.fileManager
              .fileExists(
                atPath:
                  outputURL.path
              )

          if
            outputExists &&
            !job
              .options
              .replaceExistingOutput
          {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  """
                  The native processing output file already exists at \(outputURL.path).
                  """
              )
          }

          if
            outputExists
          {
            try self.fileManager
              .removeItem(
                at:
                  outputURL
              )
          }

          try cancellationToken
            .throwIfCancelled()

          try pngData
            .write(
              to:
                outputURL,

              options: [
                .atomic
              ]
            )

          try cancellationToken
            .throwIfCancelled()

          guard
            self.fileManager
              .fileExists(
                atPath:
                  outputURL.path
              )
          else {
            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The transparent PNG was not found after saving."
              )
          }

          let attributes =
            try self.fileManager
              .attributesOfItem(
                atPath:
                  outputURL.path
              )

          let savedFileSize =
            (
              attributes[
                .size
              ] as? NSNumber
            )?
            .int64Value ??
            0

          guard
            savedFileSize >
              0
          else {
            try? self.fileManager
              .removeItem(
                at:
                  outputURL
              )

            throw NativeSegmentationEngineError
              .segmentationFailed(
                message:
                  "The saved transparent PNG file is empty."
              )
          }

          /*
           * لا نريد أن يقوم iCloud بعمل Backup لملفات
           * المعالجة التي يمكن إعادة إنشائها.
           */
          var resourceValues =
            URLResourceValues()

          resourceValues
            .isExcludedFromBackup =
              true

          var mutableOutputURL =
            outputURL

          try? mutableOutputURL
            .setResourceValues(
              resourceValues
            )

          continuation.resume(
            returning:
              outputURL
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

  // MARK: - Output directory

  private func resolveOutputDirectory(
    job:
      NativeScanJob
  ) throws ->
      URL {
    if
      let rawDirectoryURI =
        job
          .options
          .outputDirectoryUri?
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          ),
      !rawDirectoryURI
        .isEmpty
    {
      let directoryURL:
        URL

      if
        let parsedURL =
          URL(
            string:
              rawDirectoryURI
          ),
        parsedURL.scheme !=
          nil
      {
        directoryURL =
          parsedURL
      } else {
        directoryURL =
          URL(
            fileURLWithPath:
              rawDirectoryURI,
            isDirectory:
              true
          )
      }

      guard
        directoryURL
          .isFileURL
      else {
        throw NativeSegmentationEngineError
          .segmentationFailed(
            message:
              "Native processing supports file output directories only."
          )
      }

      return directoryURL
        .standardizedFileURL
    }

    let applicationSupportDirectory =
      try fileManager
        .url(
          for:
            .applicationSupportDirectory,

          in:
            .userDomainMask,

          appropriateFor:
            nil,

          create:
            true
        )

    return applicationSupportDirectory
      .appendingPathComponent(
        "TripleN",
        isDirectory:
          true
      )
      .appendingPathComponent(
        "NativeProcessing",
        isDirectory:
          true
      )
      .appendingPathComponent(
        "Outputs",
        isDirectory:
          true
      )
      .standardizedFileURL
  }

  // MARK: - Output file name

  private func resolveOutputFileName(
    requestedFileName:
      String,

    jobId:
      String
  ) -> String {
    let normalizedRequestedName =
      requestedFileName
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    let fallbackName =
      "processed-\(sanitizeOutputFileComponent(jobId)).png"

    guard
      !normalizedRequestedName
        .isEmpty
    else {
      return fallbackName
    }

    /*
     * lastPathComponent يمنع تمرير:
     *
     * ../
     * مجلدات فرعية
     * مسارات مطلقة
     */
    let lastPathComponent =
      URL(
        fileURLWithPath:
          normalizedRequestedName
      )
      .lastPathComponent

    let pathExtension =
      URL(
        fileURLWithPath:
          lastPathComponent
      )
      .pathExtension
      .lowercased()

    let baseName =
      URL(
        fileURLWithPath:
          lastPathComponent
      )
      .deletingPathExtension()
      .lastPathComponent

    let sanitizedBaseName =
      sanitizeOutputFileComponent(
        baseName
      )

    guard
      !sanitizedBaseName
        .isEmpty
    else {
      return fallbackName
    }

    if
      pathExtension ==
        "png"
    {
      return
        "\(sanitizedBaseName).png"
    }

    return
      "\(sanitizedBaseName).png"
  }

  private func sanitizeOutputFileComponent(
    _ value:
      String
  ) -> String {
    let allowedCharacters =
      CharacterSet
        .alphanumerics
        .union(
          CharacterSet(
            charactersIn:
              "-_"
          )
        )

    let unicodeScalars =
      value
        .unicodeScalars
        .map {
          scalar ->
            Character in

          if
            allowedCharacters
              .contains(
                scalar
              )
          {
            return Character(
              String(
                scalar
              )
            )
          }

          return "-"
        }

    var result =
      String(
        unicodeScalars
      )

    while
      result
        .contains(
          "--"
        )
    {
      result =
        result
          .replacingOccurrences(
            of:
              "--",
            with:
              "-"
          )
    }

    result =
      result
        .trimmingCharacters(
          in:
            CharacterSet(
              charactersIn:
                "-_"
            )
        )

    /*
     * منع أسماء ملفات طويلة بشكل مبالغ فيه.
     */
    if
      result.count >
        120
    {
      result =
        String(
          result
            .prefix(
              120
            )
        )
    }

    return result
  }

  // MARK: - Processing duration

  private func normalizedProcessingDuration(
    startedAt:
      NativeProcessingTimestamp,

    completedAt:
      NativeProcessingTimestamp
  ) -> Int64 {
    guard
      completedAt >
        startedAt
    else {
      return 0
    }

    let duration =
      completedAt -
      startedAt

    guard
      duration <=
        NativeProcessingTimestamp(
          Int64.max
        )
    else {
      return Int64.max
    }

    return Int64(
      duration
    )
  }
}