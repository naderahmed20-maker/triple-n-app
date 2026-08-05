//
// NativeTransparentImageExporter.swift
//
// Triple N - Native Transparent Image Exporter
//
// مسؤوليات هذا الملف:
//
// 1) دمج صورة RGBA الأصلية مع الـAlpha Mask النهائية.
// 2) تحويل قيم الـMask إلى Alpha آمنة من 0...255.
// 3) الحفاظ على ألوان القطعة الأصلية بدون تعديل.
// 4) إنشاء UIImage بخلفية شفافة.
// 5) تصدير PNG إلى مسار دائم وآمن.
// 6) الكتابة الذرية لمنع الملفات التالفة.
// 7) دعم استبدال الملف الموجود أو رفضه.
// 8) حساب حجم الملف ونسبة الـForeground.
// 9) دعم Cancellation أثناء إنشاء الـPixels.
// 10) إرجاع NativeScanProcessingOutput جاهزة للـProcessor.
//
// هذا الملف لا يشغّل EdgeSAM.
// هذا الملف لا يعدّل الـMask.
// هذا الملف لا ينفذ Background Understanding.
//

import CoreGraphics
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

// MARK: - Exporter configuration

struct NativeTransparentImageExporterConfiguration:
  Equatable,
  Sendable {

  let maximumPixels:
    Int

  let cancellationCheckPixelInterval:
    Int

  let alphaThreshold:
    Float

  let clampMaskValues:
    Bool

  let createDirectoriesAutomatically:
    Bool

  let excludeOutputFromBackup:
    Bool

  init(
    maximumPixels:
      Int =
        64 * 1024 * 1024,
    cancellationCheckPixelInterval:
      Int =
        131_072,
    alphaThreshold:
      Float =
        0.5,
    clampMaskValues:
      Bool =
        true,
    createDirectoriesAutomatically:
      Bool =
        true,
    excludeOutputFromBackup:
      Bool =
        true
  ) {
    self.maximumPixels =
      maximumPixels

    self.cancellationCheckPixelInterval =
      cancellationCheckPixelInterval

    self.alphaThreshold =
      alphaThreshold

    self.clampMaskValues =
      clampMaskValues

    self.createDirectoriesAutomatically =
      createDirectoriesAutomatically

    self.excludeOutputFromBackup =
      excludeOutputFromBackup
  }

  func validated()
    throws ->
      NativeTransparentImageExporterConfiguration {
    guard maximumPixels >
            0 else {
      throw NativeTransparentImageExporterError
        .invalidMaximumPixels(
          maximumPixels
        )
    }

    guard cancellationCheckPixelInterval >
            0 else {
      throw NativeTransparentImageExporterError
        .invalidCancellationCheckInterval(
          cancellationCheckPixelInterval
        )
    }

    guard alphaThreshold.isFinite,
          alphaThreshold >=
            0,
          alphaThreshold <=
            1 else {
      throw NativeTransparentImageExporterError
        .invalidAlphaThreshold(
          alphaThreshold
        )
    }

    return self
  }
}

// MARK: - Export request

struct NativeTransparentImageExportRequest:
  Sendable {

  let image:
    NativeRGBAImage

  let mask:
    EdgeSamFloatMask

  let outputDirectoryURL:
    URL?

  let outputFileName:
    String

  let replaceExistingOutput:
    Bool

  let cancellationToken:
    NativeScanCancellationToken?

  let metadata:
    [String: NativeProcessingMetadataValue]

  init(
    image:
      NativeRGBAImage,
    mask:
      EdgeSamFloatMask,
    outputDirectoryURL:
      URL? =
        nil,
    outputFileName:
      String,
    replaceExistingOutput:
      Bool =
        true,
    cancellationToken:
      NativeScanCancellationToken? =
        nil,
    metadata:
      [String: NativeProcessingMetadataValue] =
        [:]
  ) {
    self.image =
      image

    self.mask =
      mask

    self.outputDirectoryURL =
      outputDirectoryURL

    self.outputFileName =
      outputFileName

    self.replaceExistingOutput =
      replaceExistingOutput

    self.cancellationToken =
      cancellationToken

    self.metadata =
      metadata
  }
}

// MARK: - Export diagnostics

struct NativeTransparentImageExportDiagnostics:
  Equatable,
  Sendable {

  let outputPath:
    String

  let width:
    Int

  let height:
    Int

  let pixelCount:
    Int

  let foregroundPixelCount:
    Int

  let transparentPixelCount:
    Int

  let foregroundRatio:
    Float

  let fileSizeBytes:
    Int64

  let durationMs:
    Int64

  let completedAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    [
      "outputPath":
        outputPath,

      "width":
        width,

      "height":
        height,

      "pixelCount":
        pixelCount,

      "foregroundPixelCount":
        foregroundPixelCount,

      "transparentPixelCount":
        transparentPixelCount,

      "foregroundRatio":
        foregroundRatio,

      "fileSizeBytes":
        fileSizeBytes,

      "durationMs":
        durationMs,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Export result

struct NativeTransparentImageExportResult:
  Sendable {

  let output:
    NativeScanProcessingOutput

  let diagnostics:
    NativeTransparentImageExportDiagnostics
}

// MARK: - Exporter

final class NativeTransparentImageExporter:
  @unchecked Sendable {

  private let configuration:
    NativeTransparentImageExporterConfiguration

  private let fileManager:
    FileManager

  private let exportQueue:
    DispatchQueue

  init(
    configuration:
      NativeTransparentImageExporterConfiguration =
        NativeTransparentImageExporterConfiguration(),
    fileManager:
      FileManager =
        .default
  ) throws {
    self.configuration =
      try configuration
        .validated()

    self.fileManager =
      fileManager

    self.exportQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.transparent-exporter",
        qos:
          .utility
      )
  }

  // MARK: - Public export

  func export(
    request:
      NativeTransparentImageExportRequest
  ) async throws ->
      NativeTransparentImageExportResult {
    try request
      .cancellationToken?
      .throwIfCancelled()

    return try await withCheckedThrowingContinuation {
      continuation in

      exportQueue.async {
        [weak self] in

        guard let self else {
          continuation.resume(
            throwing:
              NativeTransparentImageExporterError
                .exporterDeallocated
          )

          return
        }

        do {
          let result =
            try self
              .exportSynchronously(
                request:
                  request
              )

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
  }

  // MARK: - Synchronous export

  private func exportSynchronously(
    request:
      NativeTransparentImageExportRequest
  ) throws ->
      NativeTransparentImageExportResult {
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
      request,
      image:
        image,
      mask:
        mask
    )

    let pixelCount =
      try safePixelCount(
        width:
          image.width,
        height:
          image.height
      )

    guard pixelCount <=
            configuration
              .maximumPixels else {
      throw NativeTransparentImageExporterError
        .imageTooLarge(
          pixelCount:
            pixelCount,
          maximum:
            configuration
              .maximumPixels
        )
    }

    let outputURL =
      try resolveOutputURL(
        request:
          request
      )

    try prepareOutputDirectory(
      outputURL
        .deletingLastPathComponent()
    )

    if fileManager
        .fileExists(
          atPath:
            outputURL.path
        ) {
      guard request
              .replaceExistingOutput else {
        throw NativeTransparentImageExporterError
          .outputAlreadyExists(
            path:
              outputURL.path
          )
      }
    }

    let alphaResult =
      try createTransparentRGBAData(
        image:
          image,
        mask:
          mask,
        cancellationToken:
          request.cancellationToken
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    let pngData =
      try createPNGData(
        rgbaData:
          alphaResult.rgbaData,
        width:
          image.width,
        height:
          image.height
      )

    try request
      .cancellationToken?
      .throwIfCancelled()

    try writePNGAtomically(
      pngData,
      to:
        outputURL,
      replaceExisting:
        request.replaceExistingOutput
    )

    if configuration
        .excludeOutputFromBackup {
      try? excludeFromBackup(
        outputURL
      )
    }

    let fileSizeBytes =
      try resolveFileSize(
        outputURL
      )

    let completedAt =
      NativeProcessingTime.now()

    let foregroundRatio =
      pixelCount >
        0
        ? Float(
            alphaResult
              .foregroundPixelCount
          ) /
          Float(
            pixelCount
          )
        : 0

    var outputMetadata =
      request.metadata

    outputMetadata[
      "transparentPixelCount"
    ] =
      .number(
        Double(
          alphaResult
            .transparentPixelCount
        )
      )

    outputMetadata[
      "foregroundPixelCount"
    ] =
      .number(
        Double(
          alphaResult
            .foregroundPixelCount
        )
      )

    outputMetadata[
      "alphaThreshold"
    ] =
      .number(
        Double(
          configuration
            .alphaThreshold
        )
      )

    let output =
      NativeScanProcessingOutput(
        processedImageUri:
          outputURL
            .absoluteString,
        width:
          image.width,
        height:
          image.height,
        format:
          "png",
        fileSizeBytes:
          fileSizeBytes,
        foregroundRatio:
          foregroundRatio,
        processingDurationMs:
          max(
            0,
            completedAt -
            startedAt
          ),
        completedAt:
          completedAt,
        metadata:
          outputMetadata
      )

    let diagnostics =
      NativeTransparentImageExportDiagnostics(
        outputPath:
          outputURL.path,
        width:
          image.width,
        height:
          image.height,
        pixelCount:
          pixelCount,
        foregroundPixelCount:
          alphaResult
            .foregroundPixelCount,
        transparentPixelCount:
          alphaResult
            .transparentPixelCount,
        foregroundRatio:
          foregroundRatio,
        fileSizeBytes:
          fileSizeBytes,
        durationMs:
          max(
            0,
            completedAt -
            startedAt
          ),
        completedAt:
          completedAt
      )

    return NativeTransparentImageExportResult(
      output:
        output,
      diagnostics:
        diagnostics
    )
  }

  // MARK: - Request validation

  private func validateRequest(
    _ request:
      NativeTransparentImageExportRequest,
    image:
      NativeRGBAImage,
    mask:
      EdgeSamFloatMask
  ) throws {
    guard image.width ==
            mask.width,
          image.height ==
            mask.height else {
      throw NativeTransparentImageExporterError
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

    let normalizedFileName =
      request.outputFileName
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalizedFileName
            .isEmpty else {
      throw NativeTransparentImageExporterError
        .missingOutputFileName
    }

    guard !normalizedFileName
            .contains(
              "/"
            ),
          !normalizedFileName
            .contains(
              "\\"
            ),
          normalizedFileName !=
            ".",
          normalizedFileName !=
            ".." else {
      throw NativeTransparentImageExporterError
        .invalidOutputFileName(
          normalizedFileName
        )
    }

    let fileExtension =
      (
        normalizedFileName as NSString
      )
      .pathExtension
      .lowercased()

    if !fileExtension.isEmpty,
       fileExtension !=
         "png" {
      throw NativeTransparentImageExporterError
        .unsupportedOutputFormat(
          fileExtension
        )
    }
  }
  // MARK: - Transparent RGBA creation

  private func createTransparentRGBAData(
    image:
      NativeRGBAImage,
    mask:
      EdgeSamFloatMask,
    cancellationToken:
      NativeScanCancellationToken?
  ) throws ->
      (
        rgbaData:
          Data,
        foregroundPixelCount:
          Int,
        transparentPixelCount:
          Int
      ) {
    let pixelCount =
      try safePixelCount(
        width:
          image.width,
        height:
          image.height
      )

    let byteCountResult =
      pixelCount
        .multipliedReportingOverflow(
          by:
            4
        )

    guard !byteCountResult
            .overflow,
          byteCountResult
            .partialValue >
            0 else {
      throw NativeTransparentImageExporterError
        .rgbaByteCountOverflow
    }

    var rgbaBytes =
      ContiguousArray<UInt8>(
        repeating:
          0,
        count:
          byteCountResult
            .partialValue
      )

    var foregroundPixelCount =
      0

    var transparentPixelCount =
      0

    for y in
      0..<image.height {
      let rowOffset =
        y *
        image.width

      for x in
        0..<image.width {
        let pixelIndex =
          rowOffset +
          x

        if pixelIndex %
            configuration
              .cancellationCheckPixelInterval ==
            0 {
          try cancellationToken?
            .throwIfCancelled()
        }

        let pixel =
          image.pixel(
            x:
              x,
            y:
              y
          )

        let maskValue =
          mask.values[
            pixelIndex
          ]

        guard maskValue.isFinite else {
          throw NativeTransparentImageExporterError
            .nonFiniteMaskValue(
              index:
                pixelIndex
            )
        }

        let normalizedMaskValue:
          Float

        if configuration
            .clampMaskValues {
          normalizedMaskValue =
            min(
              1,
              max(
                0,
                maskValue
              )
            )
        } else {
          normalizedMaskValue =
            maskValue
        }

        let sourceAlpha =
          min(
            1,
            max(
              0,
              pixel.alpha
            )
          )

        let finalAlpha =
          min(
            1,
            max(
              0,
              normalizedMaskValue *
              sourceAlpha
            )
          )

        if finalAlpha >=
            configuration
              .alphaThreshold {
          foregroundPixelCount +=
            1
        }

        if finalAlpha <=
            0 {
          transparentPixelCount +=
            1
        }

        let byteOffsetResult =
          pixelIndex
            .multipliedReportingOverflow(
              by:
                4
            )

        guard !byteOffsetResult
                .overflow else {
          throw NativeTransparentImageExporterError
            .rgbaByteCountOverflow
        }

        let byteOffset =
          byteOffsetResult
            .partialValue

        rgbaBytes[
          byteOffset
        ] =
          floatChannelToByte(
            pixel.red
          )

        rgbaBytes[
          byteOffset +
          1
        ] =
          floatChannelToByte(
            pixel.green
          )

        rgbaBytes[
          byteOffset +
          2
        ] =
          floatChannelToByte(
            pixel.blue
          )

        rgbaBytes[
          byteOffset +
          3
        ] =
          floatChannelToByte(
            finalAlpha
          )
      }
    }

    try cancellationToken?
      .throwIfCancelled()

    let rgbaData =
      rgbaBytes.withUnsafeBytes {
        rawBuffer in

        Data(
          rawBuffer
        )
      }

    return (
      rgbaData:
        rgbaData,
      foregroundPixelCount:
        foregroundPixelCount,
      transparentPixelCount:
        transparentPixelCount
    )
  }

  private func floatChannelToByte(
    _ value:
      Float
  ) -> UInt8 {
    guard value.isFinite else {
      return 0
    }

    let normalized =
      min(
        1,
        max(
          0,
          value
        )
      )

    let scaled =
      (
        normalized *
        255
      )
      .rounded()

    return UInt8(
      min(
        255,
        max(
          0,
          Int(
            scaled
          )
        )
      )
    )
  }

  // MARK: - PNG creation

  private func createPNGData(
    rgbaData:
      Data,
    width:
      Int,
    height:
      Int
  ) throws ->
      Data {
    let pixelCount =
      try safePixelCount(
        width:
          width,
        height:
          height
      )

    let expectedByteCountResult =
      pixelCount
        .multipliedReportingOverflow(
          by:
            4
        )

    guard !expectedByteCountResult
            .overflow else {
      throw NativeTransparentImageExporterError
        .rgbaByteCountOverflow
    }

    let expectedByteCount =
      expectedByteCountResult
        .partialValue

    guard rgbaData.count ==
            expectedByteCount else {
      throw NativeTransparentImageExporterError
        .rgbaDataSizeMismatch(
          expected:
            expectedByteCount,
          received:
            rgbaData.count
        )
    }

    let bytesPerRowResult =
      width
        .multipliedReportingOverflow(
          by:
            4
        )

    guard !bytesPerRowResult
            .overflow,
          bytesPerRowResult
            .partialValue >
            0 else {
      throw NativeTransparentImageExporterError
        .rgbaByteCountOverflow
    }

    guard let dataProvider =
            CGDataProvider(
              data:
                rgbaData as CFData
            ) else {
      throw NativeTransparentImageExporterError
        .dataProviderCreationFailed
    }

    let colorSpace =
      CGColorSpaceCreateDeviceRGB()

    let bitmapInfo =
      CGBitmapInfo(
        rawValue:
          CGImageAlphaInfo
            .last
            .rawValue
      )
      .union(
        .byteOrder32Big
      )

    guard let cgImage =
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
                bytesPerRowResult
                  .partialValue,
              space:
                colorSpace,
              bitmapInfo:
                bitmapInfo,
              provider:
                dataProvider,
              decode:
                nil,
              shouldInterpolate:
                false,
              intent:
                .defaultIntent
            ) else {
      throw NativeTransparentImageExporterError
        .cgImageCreationFailed
    }

    let mutableData =
      NSMutableData()

    let pngTypeIdentifier:
      CFString

    if #available(
      iOS 14.0,
      *
    ) {
      pngTypeIdentifier =
        UTType.png
          .identifier as CFString
    } else {
      pngTypeIdentifier =
        "public.png" as CFString
    }

    guard let destination =
            CGImageDestinationCreateWithData(
              mutableData,
              pngTypeIdentifier,
              1,
              nil
            ) else {
      throw NativeTransparentImageExporterError
        .imageDestinationCreationFailed
    }

    CGImageDestinationAddImage(
      destination,
      cgImage,
      [
        kCGImagePropertyHasAlpha:
          true
      ] as CFDictionary
    )

    guard CGImageDestinationFinalize(
            destination
          ) else {
      throw NativeTransparentImageExporterError
        .pngEncodingFailed
    }

    guard mutableData.length >
            0 else {
      throw NativeTransparentImageExporterError
        .emptyPNGData
    }

    return mutableData as Data
  }

  // MARK: - Output URL

  private func resolveOutputURL(
    request:
      NativeTransparentImageExportRequest
  ) throws ->
      URL {
    let normalizedFileName =
      request.outputFileName
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    let resolvedFileName:
      String

    if normalizedFileName
        .lowercased()
        .hasSuffix(
          ".png"
        ) {
      resolvedFileName =
        normalizedFileName
    } else {
      resolvedFileName =
        "\(normalizedFileName).png"
    }

    let outputDirectoryURL:
      URL

    if let requestedDirectory =
        request.outputDirectoryURL {
      outputDirectoryURL =
        requestedDirectory
          .standardizedFileURL
    } else {
      outputDirectoryURL =
        try resolveDefaultOutputDirectory()
    }

    guard outputDirectoryURL
            .isFileURL else {
      throw NativeTransparentImageExporterError
        .outputDirectoryIsNotFileURL(
          value:
            outputDirectoryURL
              .absoluteString
        )
    }

    return outputDirectoryURL
      .appendingPathComponent(
        resolvedFileName,
        isDirectory:
          false
      )
      .standardizedFileURL
  }

  private func resolveDefaultOutputDirectory()
    throws ->
      URL {
    if let applicationSupportDirectory =
        fileManager
          .urls(
            for:
              .applicationSupportDirectory,
            in:
              .userDomainMask
          )
          .first {
      return applicationSupportDirectory
        .appendingPathComponent(
          "TripleNNativeProcessing",
          isDirectory:
            true
        )
        .appendingPathComponent(
          "Outputs",
          isDirectory:
            true
        )
    }

    if let cachesDirectory =
        fileManager
          .urls(
            for:
              .cachesDirectory,
            in:
              .userDomainMask
          )
          .first {
      return cachesDirectory
        .appendingPathComponent(
          "TripleNNativeProcessing",
          isDirectory:
            true
        )
        .appendingPathComponent(
          "Outputs",
          isDirectory:
            true
        )
    }

    throw NativeTransparentImageExporterError
      .defaultOutputDirectoryUnavailable
  }

  // MARK: - Directory preparation

  private func prepareOutputDirectory(
    _ directoryURL:
      URL
  ) throws {
    var isDirectory:
      ObjCBool =
        false

    if fileManager
        .fileExists(
          atPath:
            directoryURL.path,
          isDirectory:
            &isDirectory
        ) {
      guard isDirectory.boolValue else {
        throw NativeTransparentImageExporterError
          .outputDirectoryIsFile(
            path:
              directoryURL.path
          )
      }

      return
    }

    guard configuration
            .createDirectoriesAutomatically else {
      throw NativeTransparentImageExporterError
        .outputDirectoryMissing(
          path:
            directoryURL.path
        )
    }

    do {
      try fileManager
        .createDirectory(
          at:
            directoryURL,
          withIntermediateDirectories:
            true,
          attributes:
            nil
        )
    } catch {
      throw NativeTransparentImageExporterError
        .outputDirectoryCreationFailed(
          path:
            directoryURL.path,
          message:
            error.localizedDescription
        )
    }
  }

  // MARK: - Atomic PNG writing

  private func writePNGAtomically(
    _ data:
      Data,
    to outputURL:
      URL,
    replaceExisting:
      Bool
  ) throws {
    let temporaryURL =
      outputURL
        .deletingLastPathComponent()
        .appendingPathComponent(
          ".\(UUID().uuidString).tmp",
          isDirectory:
            false
        )

    do {
      try data.write(
        to:
          temporaryURL,
        options:
          [
            .atomic,
            .completeFileProtectionUnlessOpen
          ]
      )

      if fileManager
          .fileExists(
            atPath:
              outputURL.path
          ) {
        guard replaceExisting else {
          throw NativeTransparentImageExporterError
            .outputAlreadyExists(
              path:
                outputURL.path
            )
        }

        _ =
          try fileManager
            .replaceItemAt(
              outputURL,
              withItemAt:
                temporaryURL,
              backupItemName:
                nil,
              options:
                [],
              resultingItemURL:
                nil
            )
      } else {
        try fileManager
          .moveItem(
            at:
              temporaryURL,
            to:
              outputURL
          )
      }
    } catch {
      if fileManager
          .fileExists(
            atPath:
              temporaryURL.path
          ) {
        try? fileManager
          .removeItem(
            at:
              temporaryURL
          )
      }

      if let exporterError =
          error as?
            NativeTransparentImageExporterError {
        throw exporterError
      }

      throw NativeTransparentImageExporterError
        .outputWriteFailed(
          path:
            outputURL.path,
          message:
            error.localizedDescription
        )
    }
  }

  // MARK: - File information

  private func resolveFileSize(
    _ fileURL:
      URL
  ) throws ->
      Int64 {
    do {
      let attributes =
        try fileManager
          .attributesOfItem(
            atPath:
              fileURL.path
          )

      let fileSize =
        (
          attributes[
            .size
          ] as? NSNumber
        )?
        .int64Value ??
        0

      guard fileSize >
              0 else {
        throw NativeTransparentImageExporterError
          .emptyOutputFile(
            path:
              fileURL.path
          )
      }

      return fileSize
    } catch let error as
      NativeTransparentImageExporterError {
      throw error
    } catch {
      throw NativeTransparentImageExporterError
        .outputFileInspectionFailed(
          path:
            fileURL.path,
          message:
            error.localizedDescription
        )
    }
  }

  private func excludeFromBackup(
    _ fileURL:
      URL
  ) throws {
    var mutableURL =
      fileURL

    var resourceValues =
      URLResourceValues()

    resourceValues
      .isExcludedFromBackup =
        true

    try mutableURL
      .setResourceValues(
        resourceValues
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
      throw NativeTransparentImageExporterError
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
      throw NativeTransparentImageExporterError
        .pixelCountOverflow
    }

    return result.partialValue
  }
  }

// MARK: - Exporter errors

enum NativeTransparentImageExporterError:
  LocalizedError,
  Equatable,
  Sendable {

  case exporterDeallocated

  case invalidMaximumPixels(
    Int
  )

  case invalidCancellationCheckInterval(
    Int
  )

  case invalidAlphaThreshold(
    Float
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

  case missingOutputFileName

  case invalidOutputFileName(
    String
  )

  case unsupportedOutputFormat(
    String
  )

  case outputDirectoryIsNotFileURL(
    value:
      String
  )

  case defaultOutputDirectoryUnavailable

  case outputDirectoryIsFile(
    path:
      String
  )

  case outputDirectoryMissing(
    path:
      String
  )

  case outputDirectoryCreationFailed(
    path:
      String,
    message:
      String
  )

  case outputAlreadyExists(
    path:
      String
  )

  case nonFiniteMaskValue(
    index:
      Int
  )

  case pixelCountOverflow

  case rgbaByteCountOverflow

  case rgbaDataSizeMismatch(
    expected:
      Int,
    received:
      Int
  )

  case dataProviderCreationFailed

  case cgImageCreationFailed

  case imageDestinationCreationFailed

  case pngEncodingFailed

  case emptyPNGData

  case outputWriteFailed(
    path:
      String,
    message:
      String
  )

  case emptyOutputFile(
    path:
      String
  )

  case outputFileInspectionFailed(
    path:
      String,
    message:
      String
  )

  var errorDescription:
    String? {
    switch self {
    case .exporterDeallocated:
      return
        """
        Native transparent image exporter was released before export completed.
        """

    case .invalidMaximumPixels(
      let maximum
    ):
      return
        """
        Native transparent image exporter maximum pixel count is invalid: \(maximum).
        """

    case .invalidCancellationCheckInterval(
      let interval
    ):
      return
        """
        Native transparent image exporter cancellation interval is invalid: \(interval).
        """

    case .invalidAlphaThreshold(
      let threshold
    ):
      return
        """
        Native transparent image exporter alpha threshold must be between zero and one. Received \(threshold).
        """

    case .invalidImageDimensions(
      let width,
      let height
    ):
      return
        """
        Native transparent image exporter received invalid image dimensions: \(width)x\(height).
        """

    case .imageMaskSizeMismatch(
      let imageWidth,
      let imageHeight,
      let maskWidth,
      let maskHeight
    ):
      return
        """
        Native transparent image exporter requires matching image and mask dimensions. Image: \(imageWidth)x\(imageHeight), mask: \(maskWidth)x\(maskHeight).
        """

    case .imageTooLarge(
      let pixelCount,
      let maximum
    ):
      return
        """
        Native transparent image export contains \(pixelCount) pixels, exceeding the configured maximum of \(maximum).
        """

    case .missingOutputFileName:
      return
        """
        Native transparent image exporter requires a non-empty output file name.
        """

    case .invalidOutputFileName(
      let fileName
    ):
      return
        """
        Native transparent image exporter received an invalid output file name: \(fileName).
        """

    case .unsupportedOutputFormat(
      let format
    ):
      return
        """
        Native transparent image exporter supports PNG output only. Received \(format).
        """

    case .outputDirectoryIsNotFileURL(
      let value
    ):
      return
        """
        Native transparent image exporter requires a local file URL for the output directory. Received \(value).
        """

    case .defaultOutputDirectoryUnavailable:
      return
        """
        Native transparent image exporter could not resolve a writable default output directory.
        """

    case .outputDirectoryIsFile(
      let path
    ):
      return
        """
        Native transparent image output directory points to a file: \(path).
        """

    case .outputDirectoryMissing(
      let path
    ):
      return
        """
        Native transparent image output directory does not exist: \(path).
        """

    case .outputDirectoryCreationFailed(
      let path,
      let message
    ):
      return
        """
        Native transparent image exporter could not create directory \(path): \(message)
        """

    case .outputAlreadyExists(
      let path
    ):
      return
        """
        Native transparent image output already exists and replacement is disabled: \(path).
        """

    case .nonFiniteMaskValue(
      let index
    ):
      return
        """
        Native transparent image exporter found a non-finite mask value at index \(index).
        """

    case .pixelCountOverflow:
      return
        """
        Native transparent image exporter pixel count overflowed.
        """

    case .rgbaByteCountOverflow:
      return
        """
        Native transparent image exporter RGBA byte count overflowed.
        """

    case .rgbaDataSizeMismatch(
      let expected,
      let received
    ):
      return
        """
        Native transparent image exporter expected \(expected) RGBA bytes but received \(received).
        """

    case .dataProviderCreationFailed:
      return
        """
        Native transparent image exporter could not create a Core Graphics data provider.
        """

    case .cgImageCreationFailed:
      return
        """
        Native transparent image exporter could not create a Core Graphics image.
        """

    case .imageDestinationCreationFailed:
      return
        """
        Native transparent image exporter could not create a PNG image destination.
        """

    case .pngEncodingFailed:
      return
        """
        Native transparent image exporter could not finalize PNG encoding.
        """

    case .emptyPNGData:
      return
        """
        Native transparent image exporter produced empty PNG data.
        """

    case .outputWriteFailed(
      let path,
      let message
    ):
      return
        """
        Native transparent image exporter could not write \(path): \(message)
        """

    case .emptyOutputFile(
      let path
    ):
      return
        """
        Native transparent image exporter created an empty output file at \(path).
        """

    case .outputFileInspectionFailed(
      let path,
      let message
    ):
      return
        """
        Native transparent image exporter could not inspect output file \(path): \(message)
        """
    }
  }
}