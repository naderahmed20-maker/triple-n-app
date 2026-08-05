//
// EdgeSamNativePreprocessor.swift
//
// Triple N - Native EdgeSAM Preprocessor
//
// المسؤوليات:
//
// 1) استقبال NativeRGBAImage.
// 2) التحقق من سلامة الصورة.
// 3) Resize مع الحفاظ على Aspect Ratio.
// 4) Letterbox إلى 1024x1024.
// 5) RGB Normalization.
// 6) إنشاء Encoder Tensor.
// 7) حفظ معلومات التحويل لاسترجاع الـMask.
//
// هذا الملف لا يشغل ONNX.
// هذا الملف لا ينفذ Decoder.
//

import Foundation
import UIKit
import Accelerate

// MARK: - Constants

private enum EdgeSamPreprocessorConstants {

  static let modelWidth = 1024

  static let modelHeight = 1024

  static let channels = 3

  static let rgbaChannels = 4

  static let encoderBatch = 1

  static let encoderShape: [Int] = [
    1,
    3,
    1024,
    1024
  ]

  static let maximumPixels =
    64 * 1024 * 1024

  static let mean: (
    Float,
    Float,
    Float
  ) = (
    0.485,
    0.456,
    0.406
  )

  static let std: (
    Float,
    Float,
    Float
  ) = (
    0.229,
    0.224,
    0.225
  )
}

// MARK: - Resize metadata

struct EdgeSamResizeMetadata:
  Sendable,
  Codable,
  Equatable {

  let originalWidth: Int

  let originalHeight: Int

  let resizedWidth: Int

  let resizedHeight: Int

  let offsetX: Int

  let offsetY: Int

  let scale: Float
}

// MARK: - Preprocess result

struct EdgeSamNativePreprocessorResult:
  Sendable {

  let image:
    NativeRGBAImage

  let encoderInput:
    EdgeSamEncoderInput

  let metadata:
    EdgeSamResizeMetadata

    var encoderTensor:
  EdgeSamFloatTensor {
  encoderInput.tensor
  }
}

// MARK: - Preprocessor

final class EdgeSamNativePreprocessor {

  init() {}

  // MARK: Public

 func preprocess(
  image:
    NativeRGBAImage
) throws
  -> EdgeSamNativePreprocessorResult {

    try validate(
      image
    )

    let metadata =
      calculateResize(
        width:
          image.width,
        height:
          image.height
      )

    let resizedImage =
      try resize(
        image,
        metadata:
          metadata
      )

  let encoderInput =
  try buildEncoderInput(
    from:
      resizedImage,
    metadata:
      metadata
  )

    return EdgeSamNativePreprocessorResult(
      image:
        resizedImage,
      encoderInput:
        encoderInput,
      metadata:
        metadata
    )
  }
  // MARK: - Validation

  private func validate(
    _ image:
      NativeRGBAImage
  ) throws {
    _ =
      try image.validated()

    guard image.width >
            0,
          image.height >
            0 else {
      throw NativeImageLoaderError
        .imageDimensionTooSmall(
          width:
            image.width,
          height:
            image.height
        )
    }

    let pixelCountResult =
      image.width
        .multipliedReportingOverflow(
          by:
            image.height
        )

    guard !pixelCountResult
            .overflow,
          pixelCountResult
            .partialValue >
            0 else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    guard pixelCountResult
            .partialValue <=
            EdgeSamPreprocessorConstants
              .maximumPixels else {
      throw NativeImageLoaderError
        .unsafePixelCount(
          width:
            image.width,
          height:
            image.height,
          pixelCount:
            Int64(
              pixelCountResult
                .partialValue
            )
        )
    }

    let minimumBytesPerRowResult =
      image.width
        .multipliedReportingOverflow(
          by:
            EdgeSamPreprocessorConstants
              .rgbaChannels
        )

    guard !minimumBytesPerRowResult
            .overflow else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    guard image.bytesPerRow >=
            minimumBytesPerRowResult
              .partialValue else {
      throw NativeImageLoaderError
        .invalidBytesPerRow(
          width:
            image.width,
          bytesPerRow:
            image.bytesPerRow
        )
    }

    let expectedByteCountResult =
      image.bytesPerRow
        .multipliedReportingOverflow(
          by:
            image.height
        )

    guard !expectedByteCountResult
            .overflow else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    guard image.data.count ==
            expectedByteCountResult
              .partialValue else {
      throw NativeImageLoaderError
        .rgbaByteCountMismatch(
          expected:
            expectedByteCountResult
              .partialValue,
          received:
            image.data.count,
          width:
            image.width,
          height:
            image.height,
          bytesPerRow:
            image.bytesPerRow
        )
    }
  }

  // MARK: - Resize calculation

  private func calculateResize(
    width:
      Int,
    height:
      Int
  ) -> EdgeSamResizeMetadata {
    let modelWidth =
      EdgeSamPreprocessorConstants
        .modelWidth

    let modelHeight =
      EdgeSamPreprocessorConstants
        .modelHeight

    let horizontalScale =
      Float(
        modelWidth
      ) /
      Float(
        width
      )

    let verticalScale =
      Float(
        modelHeight
      ) /
      Float(
        height
      )

    let scale =
      min(
        horizontalScale,
        verticalScale
      )

    let resizedWidth =
      min(
        modelWidth,
        max(
          1,
          Int(
            (
              Float(
                width
              ) *
              scale
            )
            .rounded()
          )
        )
      )

    let resizedHeight =
      min(
        modelHeight,
        max(
          1,
          Int(
            (
              Float(
                height
              ) *
              scale
            )
            .rounded()
          )
        )
      )

    /*
     * EdgeSAM / SAM يضع الصورة بعد الـResize
     * في أعلى اليسار، ثم يضيف Padding إلى
     * اليمين والأسفل.
     *
     * لذلك offsetX وoffsetY يظلان صفرًا،
     * ولا نقوم بتمركز الصورة داخل الـCanvas.
     */
    return EdgeSamResizeMetadata(
      originalWidth:
        width,
      originalHeight:
        height,
      resizedWidth:
        resizedWidth,
      resizedHeight:
        resizedHeight,
      offsetX:
        0,
      offsetY:
        0,
      scale:
        scale
    )
  }

  // MARK: - Letterbox image

  private func resize(
    _ image:
      NativeRGBAImage,
    metadata:
      EdgeSamResizeMetadata
  ) throws ->
      NativeRGBAImage {
    let validatedImage =
      try image.validated()

    guard metadata.scale.isFinite,
          metadata.scale >
            0 else {
      throw NativeImageLoaderError
        .invalidResizeScale
    }

    guard metadata.resizedWidth >
            0,
          metadata.resizedHeight >
            0,
          metadata.resizedWidth <=
            EdgeSamPreprocessorConstants
              .modelWidth,
          metadata.resizedHeight <=
            EdgeSamPreprocessorConstants
              .modelHeight else {
      throw NativeImageLoaderError
        .invalidResizeScale
    }

    let sourceCGImage =
      try createCGImage(
        from:
          validatedImage
      )

    let outputWidth =
      EdgeSamPreprocessorConstants
        .modelWidth

    let outputHeight =
      EdgeSamPreprocessorConstants
        .modelHeight

    let outputBytesPerRowResult =
      outputWidth
        .multipliedReportingOverflow(
          by:
            EdgeSamPreprocessorConstants
              .rgbaChannels
        )

    guard !outputBytesPerRowResult
            .overflow else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    let outputBytesPerRow =
      outputBytesPerRowResult
        .partialValue

    let outputByteCountResult =
      outputBytesPerRow
        .multipliedReportingOverflow(
          by:
            outputHeight
        )

    guard !outputByteCountResult
            .overflow,
          outputByteCountResult
            .partialValue >
            0 else {
      throw NativeImageLoaderError
        .invalidResizeBufferSize
    }

    var outputData =
      Data(
        count:
          outputByteCountResult
            .partialValue
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
                      8,
                    bytesPerRow:
                      outputBytesPerRow,
                    space:
                      colorSpace,
                    bitmapInfo:
                      bitmapInfo
                        .rawValue
                  ) else {
            return false
          }

          context
            .setBlendMode(
              .copy
            )

          /*
           * Padding أسود مطابق لإدخال EdgeSAM.
           */
          context
            .setFillColor(
              red:
                0,
              green:
                0,
              blue:
                0,
              alpha:
                1
            )

          context
            .fill(
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

          context
            .interpolationQuality =
              .high

          context
            .setAllowsAntialiasing(
              true
            )

          context
            .setShouldAntialias(
              true
            )

          /*
           * نجعل نقطة الأصل أعلى اليسار حتى تتطابق
           * الصورة الناتجة مع ترتيب RGBA المعتاد.
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
              sourceCGImage,
              in:
                CGRect(
                  x:
                    metadata.offsetX,
                  y:
                    metadata.offsetY,
                  width:
                    metadata.resizedWidth,
                  height:
                    metadata.resizedHeight
                )
            )

          return true
        }

    guard didDraw else {
      throw NativeImageLoaderError
        .resizeContextCreationFailed
    }

    return try NativeRGBAImage(
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
        .up,
      orientationNormalized:
        true,
      createdAt:
        NativeProcessingTime.now()
    )
    .validated()
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

    guard let provider =
            CGDataProvider(
              data:
                validatedImage
                  .data as CFData
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
                8,
              bitsPerPixel:
                32,
              bytesPerRow:
                validatedImage.bytesPerRow,
              space:
                colorSpace,
              bitmapInfo:
                bitmapInfo,
              provider:
                provider,
              decode:
                nil,
              shouldInterpolate:
                true,
              intent:
                .defaultIntent
            ) else {
      throw NativeImageLoaderError
        .cgImageCreationFailed
    }

    return cgImage
  }
  
  // MARK: - Encoder tensor

  private func buildEncoderInput(
    from image:
      NativeRGBAImage,
    metadata:
      EdgeSamResizeMetadata
  ) throws ->
      EdgeSamEncoderInput {
    let validatedImage =
      try image.validated()

    let modelWidth =
      EdgeSamPreprocessorConstants
        .modelWidth

    let modelHeight =
      EdgeSamPreprocessorConstants
        .modelHeight

    guard validatedImage.width ==
            modelWidth,
          validatedImage.height ==
            modelHeight else {
      throw EdgeSamNativePreprocessorError
        .unexpectedLetterboxSize(
          expectedWidth:
            modelWidth,
          expectedHeight:
            modelHeight,
          receivedWidth:
            validatedImage.width,
          receivedHeight:
            validatedImage.height
        )
    }

    guard metadata.originalWidth >
            0,
          metadata.originalHeight >
            0,
          metadata.resizedWidth >
            0,
          metadata.resizedHeight >
            0,
          metadata.offsetX >=
            0,
          metadata.offsetY >=
            0,
          metadata.offsetX +
            metadata.resizedWidth <=
            modelWidth,
          metadata.offsetY +
            metadata.resizedHeight <=
            modelHeight,
          metadata.scale.isFinite,
          metadata.scale >
            0 else {
      throw EdgeSamNativePreprocessorError
        .invalidResizeMetadata
    }

    let modelPixelCountResult =
      modelWidth
        .multipliedReportingOverflow(
          by:
            modelHeight
        )

    guard !modelPixelCountResult
            .overflow,
          modelPixelCountResult
            .partialValue >
            0 else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    let modelPixelCount =
      modelPixelCountResult
        .partialValue

    let tensorElementCountResult =
      modelPixelCount
        .multipliedReportingOverflow(
          by:
            EdgeSamPreprocessorConstants
              .channels
        )

    guard !tensorElementCountResult
            .overflow,
          tensorElementCountResult
            .partialValue >
            0 else {
      throw NativeImageLoaderError
        .integerOverflow
    }

    var tensorValues =
      ContiguousArray<Float>(
        repeating:
          0,
        count:
          tensorElementCountResult
            .partialValue
      )

    let redOffset =
      0

    let greenOffset =
      modelPixelCount

    let blueOffset =
      modelPixelCount *
      2

    let inverse255:
      Float =
        1.0 /
        255.0

    let redMean =
      EdgeSamPreprocessorConstants
        .mean
        .0

    let greenMean =
      EdgeSamPreprocessorConstants
        .mean
        .1

    let blueMean =
      EdgeSamPreprocessorConstants
        .mean
        .2

    let redInverseStandardDeviation =
      1.0 /
      EdgeSamPreprocessorConstants
        .std
        .0

    let greenInverseStandardDeviation =
      1.0 /
      EdgeSamPreprocessorConstants
        .std
        .1

    let blueInverseStandardDeviation =
      1.0 /
      EdgeSamPreprocessorConstants
        .std
        .2

    try validatedImage.data
      .withUnsafeBytes {
        rawBuffer in

        guard let sourceBaseAddress =
                rawBuffer
                  .baseAddress?
                  .assumingMemoryBound(
                    to:
                      UInt8.self
                  ) else {
          throw EdgeSamNativePreprocessorError
            .rgbaBufferAccessFailed
        }

        tensorValues
          .withUnsafeMutableBufferPointer {
            tensorBuffer in

            guard let tensorBaseAddress =
                    tensorBuffer
                      .baseAddress else {
              return
            }

            for y in
              0..<modelHeight {
              let sourceRowOffset =
                y *
                validatedImage
                  .bytesPerRow

              let tensorRowOffset =
                y *
                modelWidth

              for x in
                0..<modelWidth {
                let sourcePixelOffset =
                  sourceRowOffset +
                  x *
                  EdgeSamPreprocessorConstants
                    .rgbaChannels

                let tensorPixelIndex =
                  tensorRowOffset +
                  x

                let red =
                  Float(
                    sourceBaseAddress[
                      sourcePixelOffset
                    ]
                  ) *
                  inverse255

                let green =
                  Float(
                    sourceBaseAddress[
                      sourcePixelOffset +
                      1
                    ]
                  ) *
                  inverse255

                let blue =
                  Float(
                    sourceBaseAddress[
                      sourcePixelOffset +
                      2
                    ]
                  ) *
                  inverse255

                tensorBaseAddress[
                  redOffset +
                  tensorPixelIndex
                ] =
                  (
                    red -
                    redMean
                  ) *
                  redInverseStandardDeviation

                tensorBaseAddress[
                  greenOffset +
                  tensorPixelIndex
                ] =
                  (
                    green -
                    greenMean
                  ) *
                  greenInverseStandardDeviation

                tensorBaseAddress[
                  blueOffset +
                  tensorPixelIndex
                ] =
                  (
                    blue -
                    blueMean
                  ) *
                  blueInverseStandardDeviation
              }
            }
          }
      }

    let tensorMetadata =
      try EdgeSamTensorMetadata(
        name:
          "images",
        dimensions:
          EdgeSamPreprocessorConstants
            .encoderShape,
        elementType:
          .float32,
        layout:
          .nchw
      )
      .validated()

    let tensor =
      try EdgeSamFloatTensor(
        metadata:
          tensorMetadata,
        values:
          tensorValues
      )
      .validated()

    let sourceSize =
      EdgeSamImageSize(
        width:
          metadata.originalWidth,
        height:
          metadata.originalHeight
      )

    let resizedSize =
      EdgeSamImageSize(
        width:
          metadata.resizedWidth,
        height:
          metadata.resizedHeight
      )

    let rightPadding =
      modelWidth -
      metadata.offsetX -
      metadata.resizedWidth

    let bottomPadding =
      modelHeight -
      metadata.offsetY -
      metadata.resizedHeight

    let letterbox =
      EdgeSamLetterbox(
        scale:
          metadata.scale,
        left:
          metadata.offsetX,
        top:
          metadata.offsetY,
        right:
          max(
            0,
            rightPadding
          ),
        bottom:
          max(
            0,
            bottomPadding
          ),
        outputWidth:
          modelWidth,
        outputHeight:
          modelHeight
      )

    return try EdgeSamEncoderInput(
      tensor:
        tensor,
      sourceSize:
        sourceSize,
      resizedSize:
        resizedSize,
      letterbox:
        letterbox,
      createdAt:
        NativeProcessingTime.now()
    )
    .validated()
  }
}

// MARK: - Preprocessor errors

enum EdgeSamNativePreprocessorError:
  LocalizedError,
  Equatable,
  Sendable {

  case invalidResizeMetadata

  case unexpectedLetterboxSize(
    expectedWidth:
      Int,
    expectedHeight:
      Int,
    receivedWidth:
      Int,
    receivedHeight:
      Int
  )

  case rgbaBufferAccessFailed

  var errorDescription:
    String? {
    switch self {
    case .invalidResizeMetadata:
      return
        """
        EdgeSAM preprocessing received invalid resize or letterbox metadata.
        """

    case .unexpectedLetterboxSize(
      let expectedWidth,
      let expectedHeight,
      let receivedWidth,
      let receivedHeight
    ):
      return
        """
        EdgeSAM preprocessing expected a letterbox image of \(expectedWidth)x\(expectedHeight), but received \(receivedWidth)x\(receivedHeight).
        """

    case .rgbaBufferAccessFailed:
      return
        """
        EdgeSAM preprocessing could not access the RGBA image buffer.
        """
    }
  }
}