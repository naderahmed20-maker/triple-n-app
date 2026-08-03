// scan/core/ai/Preprocessor.ts
//
// Triple N - EdgeSAM Image Preprocessor
//
// المسؤوليات:
//
// 1. التحقق من مصدر الصورة.
// 2. تحميل الصورة من URI أو RGBA.
// 3. فك الصورة إلى RGBA.
// 4. تصحيح EXIF Orientation.
// 5. تغيير الحجم مع الحفاظ على النسبة.
// 6. تطبيق Letterbox الخاص بـEdgeSAM.
// 7. Normalization.
// 8. إنشاء Encoder Tensor بصيغة:
//
//    [1, 3, 1024, 1024]
//    NCHW Float32
//
// ملاحظة مهمة:
//
// EdgeSAM / SAM يضع الصورة بعد Resize
// في أعلى اليسار، ثم يضيف Padding
// ناحية اليمين والأسفل.
//
// هذا الملف لا يشغّل Encoder أو Decoder.

import {
  AlphaType,
  ColorType,
  Skia,
} from '@shopify/react-native-skia';

import {
  DEFAULT_SEGMENTATION_MODEL_CONFIG,
  cloneSegmentationModelConfig,
  validateSegmentationModelConfig,
} from './modelConfig';

import {
  SEGMENTATION_STAGE_INDEX,
  SegmentationError,
  clampSegmentationValue,
  createSegmentationRequestId,
  getSegmentationProgress,
  getUnknownErrorMessage,
  isSegmentationError,
  isSegmentationImageSource,
  isSegmentationRgbaImageSource,
  normalizeSegmentationImageFormat,
  normalizeSegmentationOrientation,
} from './types';

import type {
  EdgeSamEncoderInput,
  EdgeSamEncoderInputConfig,
  SegmentationCancellationSignal,
  SegmentationImageFormat,
  SegmentationImageSource,
  SegmentationImageValidationIssue,
  SegmentationImageValidationResult,
  SegmentationInterpolationMode,
  SegmentationLoadedImage,
  SegmentationModelConfig,
  SegmentationModelImage,
  SegmentationOrientedImage,
  SegmentationPreprocessResult,
  SegmentationPreprocessTimings,
  SegmentationProgressCallback,
  SegmentationProgressEvent,
  SegmentationResizeMode,
  SegmentationResizedImage,
  SegmentationSource,
  SegmentationTransform
} from './types';

/* =========================================================
 * Public input
 * ======================================================= */

export type SegmentationPreprocessorInput = {
  source:
    SegmentationSource;

  config?:
    SegmentationModelConfig;

  requestId?:
    string;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

/* =========================================================
 * Internal types
 * ======================================================= */

type ResolvedResizeDimensions = {
  width:
    number;

  height:
    number;

  scaleX:
    number;

  scaleY:
    number;

  paddingLeft:
    number;

  paddingTop:
    number;

  paddingRight:
    number;

  paddingBottom:
    number;
};

type DecodedSkiaImage = {
  width:
    number;

  height:
    number;

  rgba:
    Uint8Array;
};

/* =========================================================
 * Constants
 * ======================================================= */

const TOTAL_PIPELINE_STAGES =
  19 as const;

const RGBA_CHANNEL_COUNT =
  4;

const RGB_CHANNEL_COUNT =
  3;

const MINIMUM_IMAGE_DIMENSION =
  2;

const MAXIMUM_IMAGE_DIMENSION =
  16_384;

const MAXIMUM_SAFE_SOURCE_PIXELS =
  64_000_000;

const MAXIMUM_SAFE_MODEL_PIXELS =
  16_777_216;

const PIXEL_CANCELLATION_INTERVAL =
  131_072;

const ROW_CANCELLATION_INTERVAL =
  32;

/* =========================================================
 * Time
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function createEmptyTimings():
  SegmentationPreprocessTimings {
  return {
    validateInputMs:
      0,

    loadImageMs:
      0,

    correctOrientationMs:
      0,

    decodePixelsMs:
      0,

    resizeImageMs:
      0,

    applyLetterboxMs:
      0,

    normalizePixelsMs:
      0,

    createEncoderTensorMs:
      0,

    totalMs:
      0,
  };
}

/* =========================================================
 * Progress
 * ======================================================= */

function emitProgress(
  requestId:
    string,
  stage:
    SegmentationProgressEvent['stage'],
  message:
    string,
  startedAt:
    number,
  onProgress?:
    SegmentationProgressCallback,
  metadata?: Record<
    string,
    string | number | boolean | null
  >
): void {
  if (!onProgress) {
    return;
  }

  try {
    onProgress({
      requestId,

      stage,

      stageNumber:
        SEGMENTATION_STAGE_INDEX[
          stage
        ],

      totalStages:
        TOTAL_PIPELINE_STAGES,

      progress:
        getSegmentationProgress(
          stage
        ),

      message,

      elapsedMs:
        Math.max(
          0,
          now() -
            startedAt
        ),

      metadata,
    });
  } catch (error) {
    console.log(
      'EDGESAM PREPROCESS PROGRESS ERROR:',
      error
    );
  }
}

/* =========================================================
 * Cancellation
 * ======================================================= */

function assertNotCancelled(
  signal?:
    SegmentationCancellationSignal
): void {
  signal?.throwIfCancelled();
}

/* =========================================================
 * Numeric validation
 * ======================================================= */

function assertPositiveInteger(
  value:
    number,
  fieldName:
    string,
  requestId:
    string,
  stage:
    SegmentationProgressEvent['stage']
): void {
  if (
    !Number.isInteger(
      value
    ) ||
    value <= 0
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `${fieldName} must be a positive integer.`,
      {
        requestId,

        stage,

        retryable:
          false,

        metadata: {
          fieldName,

          value:
            Number.isFinite(value)
              ? value
              : String(value),
        },
      }
    );
  }
}

function assertSafeImageSize(
  width:
    number,
  height:
    number,
  requestId:
    string,
  stage:
    SegmentationProgressEvent['stage'],
  maximumPixels =
    MAXIMUM_SAFE_SOURCE_PIXELS
): void {
  assertPositiveInteger(
    width,
    'image.width',
    requestId,
    stage
  );

  assertPositiveInteger(
    height,
    'image.height',
    requestId,
    stage
  );

  if (
    width >
      MAXIMUM_IMAGE_DIMENSION ||
    height >
      MAXIMUM_IMAGE_DIMENSION
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'The source image dimensions are too large.',
      {
        requestId,

        stage,

        retryable:
          false,

        metadata: {
          width,

          height,

          maximumDimension:
            MAXIMUM_IMAGE_DIMENSION,
        },
      }
    );
  }

  const pixelCount =
    width *
    height;

  if (
    !Number.isSafeInteger(
      pixelCount
    ) ||
    pixelCount >
      maximumPixels
  ) {
    throw new SegmentationError(
      'OUT_OF_MEMORY',
      'The source image is too large to process safely.',
      {
        requestId,

        stage,

        retryable:
          false,

        metadata: {
          width,

          height,

          pixelCount,

          maximumPixels,
        },
      }
    );
  }
}

function assertValidRgbaLength(
  width:
    number,
  height:
    number,
  rgba:
    Uint8Array,
  requestId:
    string,
  stage:
    SegmentationProgressEvent['stage']
): void {
  const expectedLength =
    width *
    height *
    RGBA_CHANNEL_COUNT;

  if (
    rgba.length !==
    expectedLength
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'RGBA data length does not match the image dimensions.',
      {
        requestId,

        stage,

        retryable:
          false,

        metadata: {
          width,

          height,

          expectedLength,

          actualLength:
            rgba.length,
        },
      }
    );
  }
}

/* =========================================================
 * Source validation
 * ======================================================= */

function resolveSourceFormat(
  source:
    SegmentationImageSource
): SegmentationImageFormat {
  if (
    source.format &&
    source.format !==
      'unknown'
  ) {
    return normalizeSegmentationImageFormat(
      source.format
    );
  }

  const cleanUri =
    source.uri
      .split('?')[0]
      .split('#')[0];

  const extensionMatch =
    cleanUri.match(
      /\.([a-zA-Z0-9]+)$/
    );

  if (!extensionMatch) {
    return 'unknown';
  }

  return normalizeSegmentationImageFormat(
    extensionMatch[1]
  );
}

export function validateSegmentationSource(
  source:
    unknown
): SegmentationImageValidationResult {
  const issues:
    SegmentationImageValidationIssue[] =
      [];

  if (
    source ===
      null ||
    source ===
      undefined
  ) {
    issues.push({
      code:
        'missing-source',

      message:
        'Segmentation image source is missing.',

      fatal:
        true,
    });

    return {
      valid:
        false,

      issues,

      resolvedSize:
        null,
    };
  }

  if (
    isSegmentationRgbaImageSource(
      source
    )
  ) {
    if (
      source.width <
        MINIMUM_IMAGE_DIMENSION
    ) {
      issues.push({
        code:
          'image-too-small',

        message:
          `Image width must be at least ${MINIMUM_IMAGE_DIMENSION} pixels.`,

        fatal:
          true,
      });
    }

    if (
      source.height <
        MINIMUM_IMAGE_DIMENSION
    ) {
      issues.push({
        code:
          'image-too-small',

        message:
          `Image height must be at least ${MINIMUM_IMAGE_DIMENSION} pixels.`,

        fatal:
          true,
      });
    }

    if (
      source.width >
        MAXIMUM_IMAGE_DIMENSION ||
      source.height >
        MAXIMUM_IMAGE_DIMENSION
    ) {
      issues.push({
        code:
          'image-too-large',

        message:
          'Image dimensions exceed the safe preprocessing limit.',

        fatal:
          true,
      });
    }

    const expectedLength =
      source.width *
      source.height *
      RGBA_CHANNEL_COUNT;

    if (
      source.rgba.length !==
      expectedLength
    ) {
      issues.push({
        code:
          'rgba-length-mismatch',

        message:
          'RGBA data length does not match the source dimensions.',

        fatal:
          true,
      });
    }

    const orientation =
      source.orientation;

    if (
      orientation !==
        undefined &&
      (
        !Number.isInteger(
          orientation
        ) ||
        orientation < 1 ||
        orientation > 8
      )
    ) {
      issues.push({
        code:
          'unsupported-orientation',

        message:
          'Unsupported EXIF orientation. Orientation 1 will be used.',

        fatal:
          false,
      });
    }

    return {
      valid:
        !issues.some(
          issue =>
            issue.fatal
        ),

      issues,

      resolvedSize: {
        width:
          source.width,

        height:
          source.height,
      },
    };
  }

  if (
    isSegmentationImageSource(
      source
    )
  ) {
    const trimmedUri =
      source.uri.trim();

    if (
      trimmedUri.length ===
      0
    ) {
      issues.push({
        code:
          'invalid-uri',

        message:
          'Image URI cannot be empty.',

        fatal:
          true,
      });
    }

    if (
      source.width !==
        undefined &&
      (
        !Number.isInteger(
          source.width
        ) ||
        source.width <= 0
      )
    ) {
      issues.push({
        code:
          'invalid-width',

        message:
          'Provided image width is invalid.',

        fatal:
          true,
      });
    }

    if (
      source.height !==
        undefined &&
      (
        !Number.isInteger(
          source.height
        ) ||
        source.height <= 0
      )
    ) {
      issues.push({
        code:
          'invalid-height',

        message:
          'Provided image height is invalid.',

        fatal:
          true,
      });
    }

    const orientation =
      source.orientation;

    if (
      orientation !==
        undefined &&
      (
        !Number.isInteger(
          orientation
        ) ||
        orientation < 1 ||
        orientation > 8
      )
    ) {
      issues.push({
        code:
          'unsupported-orientation',

        message:
          'Unsupported EXIF orientation. Orientation 1 will be used.',

        fatal:
          false,
      });
    }

    return {
      valid:
        !issues.some(
          issue =>
            issue.fatal
        ),

      issues,

      resolvedSize:
        source.width !==
          undefined &&
        source.height !==
          undefined &&
        Number.isInteger(
          source.width
        ) &&
        Number.isInteger(
          source.height
        ) &&
        source.width > 0 &&
        source.height > 0
          ? {
              width:
                source.width,

              height:
                source.height,
            }
          : null,
    };
  }

  issues.push({
    code:
      'invalid-rgba-data',

    message:
      'The supplied value is not a valid segmentation image source.',

    fatal:
      true,
  });

  return {
    valid:
      false,

    issues,

    resolvedSize:
      null,
  };
}

/* =========================================================
 * Skia image decoding
 * ======================================================= */

async function decodeUriWithSkia(
  uri:
    string,
  requestId:
    string,
  signal?:
    SegmentationCancellationSignal
): Promise<DecodedSkiaImage> {
  assertNotCancelled(
    signal
  );

  let encodedData:
    Awaited<
      ReturnType<
        typeof Skia.Data.fromURI
      >
    >;

  try {
    encodedData =
      await Skia.Data.fromURI(
        uri
      );
  } catch (error) {
    throw new SegmentationError(
      'IMAGE_LOAD_FAILED',
      `Unable to load image from URI: ${getUnknownErrorMessage(
        error
      )}`,
      {
        requestId,

        stage:
          'load-image',

        retryable:
          true,

        cause:
          error,

        metadata: {
          uri,
        },
      }
    );
  }

  assertNotCancelled(
    signal
  );

  if (!encodedData) {
    throw new SegmentationError(
      'IMAGE_LOAD_FAILED',
      'Skia returned no encoded image data.',
      {
        requestId,

        stage:
          'load-image',

        retryable:
          true,

        metadata: {
          uri,
        },
      }
    );
  }

  const image =
    Skia.Image.MakeImageFromEncoded(
      encodedData
    );

  if (!image) {
    throw new SegmentationError(
      'IMAGE_DECODE_FAILED',
      'Skia could not decode the supplied image.',
      {
        requestId,

        stage:
          'decode-pixels',

        retryable:
          true,

        metadata: {
          uri,
        },
      }
    );
  }

  try {
    const width =
      image.width();

    const height =
      image.height();

    assertSafeImageSize(
      width,
      height,
      requestId,
      'decode-pixels'
    );

    const pixels =
      image.readPixels(
        0,
        0,
        {
          width,

          height,

          colorType:
            ColorType.RGBA_8888,

          alphaType:
            AlphaType.Unpremul,
        }
      );

    if (!pixels) {
      throw new SegmentationError(
        'PIXEL_READ_FAILED',
        'Skia could not read RGBA pixels from the decoded image.',
        {
          requestId,

          stage:
            'decode-pixels',

          retryable:
            true,

          metadata: {
            width,

            height,

            uri,
          },
        }
      );
    }

    const rgba =
      pixels instanceof
        Uint8Array
        ? new Uint8Array(
            pixels
          )
        : new Uint8Array(
            pixels.buffer,
            pixels.byteOffset,
            pixels.byteLength
          ).slice();

    assertValidRgbaLength(
      width,
      height,
      rgba,
      requestId,
      'decode-pixels'
    );

    return {
      width,

      height,

      rgba,
    };
  } finally {
    image.dispose();
  }
}

/* =========================================================
 * Image loading
 * ======================================================= */

async function loadSourceImage(
  source:
    SegmentationSource,
  requestId:
    string,
  signal?:
    SegmentationCancellationSignal
): Promise<SegmentationLoadedImage> {
  assertNotCancelled(
    signal
  );

  if (
    isSegmentationRgbaImageSource(
      source
    )
  ) {
    assertSafeImageSize(
      source.width,
      source.height,
      requestId,
      'load-image'
    );

    assertValidRgbaLength(
      source.width,
      source.height,
      source.rgba,
      requestId,
      'load-image'
    );

    return {
      uri:
        null,

      width:
        source.width,

      height:
        source.height,

      format:
        'unknown',

      orientation:
        normalizeSegmentationOrientation(
          source.orientation
        ),

      rgba:
          source.rgba,

      bytesPerPixel:
        4,

      sourceId:
        source.id ??
        null,
    };
  }

  if (
    !isSegmentationImageSource(
      source
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'Invalid segmentation image source.',
      {
        requestId,

        stage:
          'validate-input',

        retryable:
          false,
      }
    );
  }

  const decoded =
    await decodeUriWithSkia(
      source.uri,
      requestId,
      signal
    );

  return {
    uri:
      source.uri,

    width:
      decoded.width,

    height:
      decoded.height,

    format:
      resolveSourceFormat(
        source
      ),

    orientation:
      normalizeSegmentationOrientation(
        source.orientation
      ),

    rgba:
      decoded.rgba,

    bytesPerPixel:
      4,

    sourceId:
      source.id ??
      null,
  };
}

/* =========================================================
 * Orientation
 * ======================================================= */

/**
 * EXIF:
 *
 * 1 = normal
 * 2 = mirror horizontal
 * 3 = rotate 180
 * 4 = mirror vertical
 * 5 = transpose
 * 6 = rotate 90 clockwise
 * 7 = transverse
 * 8 = rotate 90 counter-clockwise
 */
function getOrientedDimensions(
  width:
    number,
  height:
    number,
  orientation:
    number
): {
  width:
    number;

  height:
    number;
} {
  if (
    orientation >=
      5 &&
    orientation <=
      8
  ) {
    return {
      width:
        height,

      height:
        width,
    };
  }

  return {
    width,

    height,
  };
}

function mapOrientedPixelToSource(
  destinationX:
    number,
  destinationY:
    number,
  sourceWidth:
    number,
  sourceHeight:
    number,
  orientation:
    number
): {
  x:
    number;

  y:
    number;
} {
  switch (orientation) {
    case 2:
      return {
        x:
          sourceWidth -
          1 -
          destinationX,

        y:
          destinationY,
      };

    case 3:
      return {
        x:
          sourceWidth -
          1 -
          destinationX,

        y:
          sourceHeight -
          1 -
          destinationY,
      };

    case 4:
      return {
        x:
          destinationX,

        y:
          sourceHeight -
          1 -
          destinationY,
      };

    case 5:
      return {
        x:
          destinationY,

        y:
          destinationX,
      };

    case 6:
      return {
        x:
          destinationY,

        y:
          sourceHeight -
          1 -
          destinationX,
      };

    case 7:
      return {
        x:
          sourceWidth -
          1 -
          destinationY,

        y:
          sourceHeight -
          1 -
          destinationX,
      };

    case 8:
      return {
        x:
          sourceWidth -
          1 -
          destinationY,

        y:
          destinationX,
      };

    case 1:
    default:
      return {
        x:
          destinationX,

        y:
          destinationY,
      };
  }
}

function correctImageOrientation(
  image:
    SegmentationLoadedImage,
  requestId:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationOrientedImage {
  const orientation =
    normalizeSegmentationOrientation(
      image.orientation
    );

  if (
    orientation ===
    1
  ) {
    return {
      width:
        image.width,

      height:
        image.height,

      rgba:
          image.rgba,

      orientationCorrected:
        false,

      originalOrientation:
        image.orientation,

      appliedOrientation:
        1,
    };
  }

  const destinationSize =
    getOrientedDimensions(
      image.width,
      image.height,
      orientation
    );

  assertSafeImageSize(
    destinationSize.width,
    destinationSize.height,
    requestId,
    'correct-orientation'
  );

  const output =
    new Uint8Array(
      destinationSize.width *
      destinationSize.height *
      RGBA_CHANNEL_COUNT
    );

  for (
    let y = 0;
    y <
      destinationSize.height;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    for (
      let x = 0;
      x <
        destinationSize.width;
      x += 1
    ) {
      const sourcePoint =
        mapOrientedPixelToSource(
          x,
          y,
          image.width,
          image.height,
          orientation
        );

      const sourceX =
        Math.max(
          0,
          Math.min(
            image.width -
              1,
            sourcePoint.x
          )
        );

      const sourceY =
        Math.max(
          0,
          Math.min(
            image.height -
              1,
            sourcePoint.y
          )
        );

      const sourceOffset =
        (
          sourceY *
            image.width +
          sourceX
        ) *
        RGBA_CHANNEL_COUNT;

      const destinationOffset =
        (
          y *
            destinationSize.width +
          x
        ) *
        RGBA_CHANNEL_COUNT;

      output[
        destinationOffset
      ] =
        image.rgba[
          sourceOffset
        ];

      output[
        destinationOffset +
        1
      ] =
        image.rgba[
          sourceOffset +
          1
        ];

      output[
        destinationOffset +
        2
      ] =
        image.rgba[
          sourceOffset +
          2
        ];

      output[
        destinationOffset +
        3
      ] =
        image.rgba[
          sourceOffset +
          3
        ];
    }
  }

  return {
    width:
      destinationSize.width,

    height:
      destinationSize.height,

    rgba:
      output,

    orientationCorrected:
      true,

    originalOrientation:
      image.orientation,

    appliedOrientation:
      orientation,
  };
}

/* =========================================================
 * Resize calculation
 * ======================================================= */

function resolveResizeDimensions(
  sourceWidth:
    number,
  sourceHeight:
    number,
  destinationWidth:
    number,
  destinationHeight:
    number,
  resizeMode:
    SegmentationResizeMode
): ResolvedResizeDimensions {
  const sourceAspect =
    sourceWidth /
    sourceHeight;

  const destinationAspect =
    destinationWidth /
    destinationHeight;

  let width =
    destinationWidth;

  let height =
    destinationHeight;

  switch (resizeMode) {
    case 'stretch':
      width =
        destinationWidth;

      height =
        destinationHeight;

      break;

    case 'cover':
      if (
        sourceAspect >
        destinationAspect
      ) {
        height =
          destinationHeight;

        width =
          Math.ceil(
            destinationHeight *
            sourceAspect
          );
      } else {
        width =
          destinationWidth;

        height =
          Math.ceil(
            destinationWidth /
            sourceAspect
          );
      }

      break;

    case 'contain':
    case 'letterbox':
    default:
      if (
        sourceAspect >
        destinationAspect
      ) {
        width =
          destinationWidth;

        height =
          Math.max(
            1,
            Math.round(
              destinationWidth /
              sourceAspect
            )
          );
      } else {
        height =
          destinationHeight;

        width =
          Math.max(
            1,
            Math.round(
              destinationHeight *
              sourceAspect
            )
          );
      }

      break;
  }

  width =
    Math.max(
      1,
      width
    );

  height =
    Math.max(
      1,
      height
    );

  /**
   * EdgeSAM / SAM:
   *
   * الصورة توضع في أعلى اليسار.
   * Padding يكون يمين وأسفل فقط.
   */
  const paddingLeft =
    0;

  const paddingTop =
    0;

  const paddingRight =
    Math.max(
      0,
      destinationWidth -
      width
    );

  const paddingBottom =
    Math.max(
      0,
      destinationHeight -
      height
    );

  return {
    width,

    height,

    scaleX:
      width /
      sourceWidth,

    scaleY:
      height /
      sourceHeight,

    paddingLeft,

    paddingTop,

    paddingRight,

    paddingBottom,
  };
}

/* =========================================================
 * RGBA sampling
 * ======================================================= */

function readRgbaChannel(
  rgba:
    Uint8Array,
  width:
    number,
  x:
    number,
  y:
    number,
  channel:
    number
): number {
  return rgba[
    (
      y *
        width +
      x
    ) *
      RGBA_CHANNEL_COUNT +
    channel
  ];
}

function sampleNearestChannel(
  rgba:
    Uint8Array,
  sourceWidth:
    number,
  sourceHeight:
    number,
  sourceX:
    number,
  sourceY:
    number,
  channel:
    number
): number {
  const x =
    Math.max(
      0,
      Math.min(
        sourceWidth -
          1,
        Math.round(
          sourceX
        )
      )
    );

  const y =
    Math.max(
      0,
      Math.min(
        sourceHeight -
          1,
        Math.round(
          sourceY
        )
      )
    );

  return readRgbaChannel(
    rgba,
    sourceWidth,
    x,
    y,
    channel
  );
}

function sampleLinearChannel(
  rgba:
    Uint8Array,
  sourceWidth:
    number,
  sourceHeight:
    number,
  sourceX:
    number,
  sourceY:
    number,
  channel:
    number
): number {
  const clampedX =
    Math.max(
      0,
      Math.min(
        sourceWidth -
          1,
        sourceX
      )
    );

  const clampedY =
    Math.max(
      0,
      Math.min(
        sourceHeight -
          1,
        sourceY
      )
    );

  const x0 =
    Math.floor(
      clampedX
    );

  const y0 =
    Math.floor(
      clampedY
    );

  const x1 =
    Math.min(
      sourceWidth -
        1,
      x0 +
        1
    );

  const y1 =
    Math.min(
      sourceHeight -
        1,
      y0 +
        1
    );

  const xFraction =
    clampedX -
    x0;

  const yFraction =
    clampedY -
    y0;

  const topLeft =
    readRgbaChannel(
      rgba,
      sourceWidth,
      x0,
      y0,
      channel
    );

  const topRight =
    readRgbaChannel(
      rgba,
      sourceWidth,
      x1,
      y0,
      channel
    );

  const bottomLeft =
    readRgbaChannel(
      rgba,
      sourceWidth,
      x0,
      y1,
      channel
    );

  const bottomRight =
    readRgbaChannel(
      rgba,
      sourceWidth,
      x1,
      y1,
      channel
    );

  const top =
    topLeft +
    (
      topRight -
      topLeft
    ) *
      xFraction;

  const bottom =
    bottomLeft +
    (
      bottomRight -
      bottomLeft
    ) *
      xFraction;

  return (
    top +
    (
      bottom -
      top
    ) *
      yFraction
  );
}

function sampleRgbaChannel(
  rgba:
    Uint8Array,
  sourceWidth:
    number,
  sourceHeight:
    number,
  sourceX:
    number,
  sourceY:
    number,
  channel:
    number,
  interpolation:
    SegmentationInterpolationMode
): number {
  if (
    interpolation ===
    'nearest'
  ) {
    return sampleNearestChannel(
      rgba,
      sourceWidth,
      sourceHeight,
      sourceX,
      sourceY,
      channel
    );
  }

  /**
   * linear هو المسار الرسمي المستخدم.
   *
   * cubic وarea يعودان مؤقتًا إلى
   * bilinear الآمن داخل JavaScript.
   */
  return sampleLinearChannel(
    rgba,
    sourceWidth,
    sourceHeight,
    sourceX,
    sourceY,
    channel
  );
}

/* =========================================================
 * RGBA resize
 * ======================================================= */

function resizeRgbaImage(
  image:
    SegmentationOrientedImage,
  destinationWidth:
    number,
  destinationHeight:
    number,
  interpolation:
    SegmentationInterpolationMode,
  transform:
    SegmentationTransform,
  requestId:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationResizedImage {
  assertSafeImageSize(
    destinationWidth,
    destinationHeight,
    requestId,
    'resize-image',
    MAXIMUM_SAFE_MODEL_PIXELS
  );

  if (
    image.width ===
      destinationWidth &&
    image.height ===
      destinationHeight
  ) {
    return {
      width:
        image.width,

      height:
        image.height,

      rgba:
          image.rgba,

      transform,
    };
  }

  const output =
    new Uint8Array(
      destinationWidth *
      destinationHeight *
      RGBA_CHANNEL_COUNT
    );

  const xScale =
    image.width /
    destinationWidth;

  const yScale =
    image.height /
    destinationHeight;

  for (
    let y = 0;
    y <
      destinationHeight;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const sourceY =
      (
        y +
        0.5
      ) *
        yScale -
      0.5;

    for (
      let x = 0;
      x <
        destinationWidth;
      x += 1
    ) {
      const sourceX =
        (
          x +
          0.5
        ) *
          xScale -
        0.5;

      const destinationOffset =
        (
          y *
            destinationWidth +
          x
        ) *
        RGBA_CHANNEL_COUNT;

      for (
        let channel = 0;
        channel <
          RGBA_CHANNEL_COUNT;
        channel += 1
      ) {
        const value =
          sampleRgbaChannel(
            image.rgba,
            image.width,
            image.height,
            sourceX,
            sourceY,
            channel,
            interpolation
          );

        output[
          destinationOffset +
          channel
        ] =
          Math.round(
            clampSegmentationValue(
              value,
              0,
              255
            )
          );
      }
    }
  }

  return {
    width:
      destinationWidth,

    height:
      destinationHeight,

    rgba:
      output,

    transform,
  };
}

/* =========================================================
 * Letterbox
 * ======================================================= */

function applyLetterbox(
  resized:
    SegmentationResizedImage,
  modelWidth:
    number,
  modelHeight:
    number,
  inputConfig:
    EdgeSamEncoderInputConfig,
  requestId:
    string,
  signal?:
    SegmentationCancellationSignal
): SegmentationModelImage {
  assertSafeImageSize(
    modelWidth,
    modelHeight,
    requestId,
    'apply-letterbox',
    MAXIMUM_SAFE_MODEL_PIXELS
  );

  const [
    paddingRed,
    paddingGreen,
    paddingBlue,
  ] =
    inputConfig
      .letterboxColor;

  const output =
    new Uint8Array(
      modelWidth *
      modelHeight *
      RGBA_CHANNEL_COUNT
    );

  for (
    let index = 0;
    index <
      modelWidth *
      modelHeight;
    index += 1
  ) {
    if (
      index %
        PIXEL_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const offset =
      index *
      RGBA_CHANNEL_COUNT;

    output[
      offset
    ] =
      Math.round(
        clampSegmentationValue(
          paddingRed,
          0,
          255
        )
      );

    output[
      offset +
      1
    ] =
      Math.round(
        clampSegmentationValue(
          paddingGreen,
          0,
          255
        )
      );

    output[
      offset +
      2
    ] =
      Math.round(
        clampSegmentationValue(
          paddingBlue,
          0,
          255
        )
      );

    output[
      offset +
      3
    ] =
      255;
  }

  const left =
    Math.max(
      0,
      Math.round(
        resized.transform
          .padding.left
      )
    );

  const top =
    Math.max(
      0,
      Math.round(
        resized.transform
          .padding.top
      )
    );

  const copyWidth =
    Math.min(
      resized.width,
      modelWidth -
      left
    );

  const copyHeight =
    Math.min(
      resized.height,
      modelHeight -
      top
    );

  if (
    copyWidth <= 0 ||
    copyHeight <= 0
  ) {
    throw new SegmentationError(
      'IMAGE_RESIZE_FAILED',
      'The resized image does not fit inside the EdgeSAM model input.',
      {
        requestId,

        stage:
          'apply-letterbox',

        retryable:
          false,

        metadata: {
          resizedWidth:
            resized.width,

          resizedHeight:
            resized.height,

          modelWidth,

          modelHeight,

          left,

          top,
        },
      }
    );
  }

  for (
    let y = 0;
    y <
      copyHeight;
    y += 1
  ) {
    if (
      y %
        ROW_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const sourceOffset =
      y *
      resized.width *
      RGBA_CHANNEL_COUNT;

    const destinationOffset =
      (
        (
          y +
          top
        ) *
          modelWidth +
        left
      ) *
      RGBA_CHANNEL_COUNT;

    output.set(
      resized.rgba.subarray(
        sourceOffset,
        sourceOffset +
          copyWidth *
            RGBA_CHANNEL_COUNT
      ),
      destinationOffset
    );
  }

  return {
    width:
      modelWidth,

    height:
      modelHeight,

    rgba:
      output,

    transform:
      resized.transform,

    letterboxApplied:
      (
        resized.width !==
          modelWidth ||
        resized.height !==
          modelHeight ||
        left !== 0 ||
        top !== 0
      ),
  };
}

/* =========================================================
 * Encoder tensor
 * ======================================================= */

function createEncoderTensor(
  modelImage:
    SegmentationModelImage,
  inputConfig:
    EdgeSamEncoderInputConfig,
  requestId:
    string,
  signal?:
    SegmentationCancellationSignal
): EdgeSamEncoderInput {
  const width =
    modelImage.width;

  const height =
    modelImage.height;

  if (
    width !==
      inputConfig.width ||
    height !==
      inputConfig.height
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'Model image dimensions do not match the EdgeSAM encoder input configuration.',
      {
        requestId,

        stage:
          'create-encoder-tensor',

        component:
          'encoder',

        retryable:
          false,

        metadata: {
          modelWidth:
            width,

          modelHeight:
            height,

          expectedWidth:
            inputConfig.width,

          expectedHeight:
            inputConfig.height,
        },
      }
    );
  }

  assertValidRgbaLength(
    width,
    height,
    modelImage.rgba,
    requestId,
    'create-encoder-tensor'
  );

  const pixelCount =
    width *
    height;

  const data =
    new Float32Array(
      pixelCount *
      RGB_CHANNEL_COUNT
    );

  const normalization =
    inputConfig.normalization;

  const [
    mean0,
    mean1,
    mean2,
  ] =
    normalization.mean;

  const [
    std0,
    std1,
    std2,
  ] =
    normalization.std;

  const channelOrder =
    normalization.channelOrder;

  const scale =
    normalization.scale;

  const channel0Offset =
    0;

  const channel1Offset =
    pixelCount;

  const channel2Offset =
    pixelCount *
    2;

  for (
    let pixelIndex = 0;
    pixelIndex <
      pixelCount;
    pixelIndex += 1
  ) {
    if (
      pixelIndex %
        PIXEL_CANCELLATION_INTERVAL ===
      0
    ) {
      assertNotCancelled(
        signal
      );
    }

    const rgbaOffset =
      pixelIndex *
      RGBA_CHANNEL_COUNT;

    const red =
      modelImage.rgba[
        rgbaOffset
      ];

    const green =
      modelImage.rgba[
        rgbaOffset +
        1
      ];

    const blue =
      modelImage.rgba[
        rgbaOffset +
        2
      ];

    const channel0 =
      channelOrder ===
        'rgb'
        ? red
        : blue;

    const channel1 =
      green;

    const channel2 =
      channelOrder ===
        'rgb'
        ? blue
        : red;

    /**
     * modelConfig الحالي:
     *
     * scale = 1
     * mean/std على نطاق 0..255
     *
     * المعادلة:
     *
     * ((pixel / scale) - mean) / std
     */
    data[
      channel0Offset +
      pixelIndex
    ] =
      (
        channel0 /
          scale -
        mean0
      ) /
      std0;

    data[
      channel1Offset +
      pixelIndex
    ] =
      (
        channel1 /
          scale -
        mean1
      ) /
      std1;

    data[
      channel2Offset +
      pixelIndex
    ] =
      (
        channel2 /
          scale -
        mean2
      ) /
      std2;
  }

  const expectedLength =
    inputConfig.batchSize *
    inputConfig.channels *
    inputConfig.width *
    inputConfig.height;

  if (
    data.length !==
    expectedLength
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'EdgeSAM encoder tensor length is invalid.',
      {
        requestId,

        stage:
          'create-encoder-tensor',

        component:
          'encoder',

        retryable:
          false,

        metadata: {
          expectedLength,

          actualLength:
            data.length,
        },
      }
    );
  }

  return {
    image: {
      name:
        inputConfig.name,

      data,

      dimensions: [
        1,
        3,
        height,
        width,
      ],

      dataType:
        'float32',

      layout:
        'NCHW',

      width,

      height,

      channels:
        3,

      batchSize:
        1,
    },

    transform:
      modelImage.transform,
  };
}

/* =========================================================
 * Transform
 * ======================================================= */

function createImageTransform(
  loadedImage:
    SegmentationLoadedImage,
  orientedImage:
    SegmentationOrientedImage,
  modelWidth:
    number,
  modelHeight:
    number,
  resize:
    ResolvedResizeDimensions,
  resizeMode:
    SegmentationResizeMode
): SegmentationTransform {
  const originalToModelScaleX =
    resize.width /
    orientedImage.width;

  const originalToModelScaleY =
    resize.height /
    orientedImage.height;

  const modelToOriginalScaleX =
    orientedImage.width /
    resize.width;

  const modelToOriginalScaleY =
    orientedImage.height /
    resize.height;

  return {
    originalSize: {
      width:
        loadedImage.width,

      height:
        loadedImage.height,
    },

    orientedSize: {
      width:
        orientedImage.width,

      height:
        orientedImage.height,
    },

    modelInputSize: {
      width:
        modelWidth,

      height:
        modelHeight,
    },

    resizedSize: {
      width:
        resize.width,

      height:
        resize.height,
    },

    scale: {
      x:
        resize.scaleX,

      y:
        resize.scaleY,
    },

    padding: {
      top:
        resize.paddingTop,

      right:
        resize.paddingRight,

      bottom:
        resize.paddingBottom,

      left:
        resize.paddingLeft,
    },

    resizeMode,

    originalToModelScale: {
      x:
        originalToModelScaleX,

      y:
        originalToModelScaleY,
    },

    modelToOriginalScale: {
      x:
        modelToOriginalScaleX,

      y:
        modelToOriginalScaleY,
    },

    orientationApplied:
      orientedImage
        .appliedOrientation,
  };
}

/* =========================================================
 * Main class
 * ======================================================= */

export class SegmentationPreprocessor {
  private readonly config:
    SegmentationModelConfig;

  constructor(
    config:
      SegmentationModelConfig =
        DEFAULT_SEGMENTATION_MODEL_CONFIG
  ) {
    this.config =
      validateSegmentationModelConfig(
        cloneSegmentationModelConfig(
          config
        )
      );
  }

  getConfig():
    SegmentationModelConfig {
    return cloneSegmentationModelConfig(
      this.config
    );
  }

  validate(
    source:
      unknown
  ): SegmentationImageValidationResult {
    return validateSegmentationSource(
      source
    );
  }

  async process(
    input:
      SegmentationPreprocessorInput
  ): Promise<SegmentationPreprocessResult> {
    const startedAt =
      now();

    const requestId =
      input.requestId ??
      createSegmentationRequestId();

    const timings =
      createEmptyTimings();

    const signal =
      input.cancellationSignal;

    const config =
      input.config
        ? validateSegmentationModelConfig(
            cloneSegmentationModelConfig(
              input.config
            )
          )
        : this.config;

    try {
      assertNotCancelled(
        signal
      );

      /* ---------------------------------------------------
       * 1. Validate input
       * ------------------------------------------------- */

      emitProgress(
        requestId,
        'validate-input',
        'Validating the source image.',
        startedAt,
        input.onProgress
      );

      const validationStartedAt =
        now();

      const validation =
        validateSegmentationSource(
          input.source
        );

      timings.validateInputMs =
        now() -
        validationStartedAt;

      const fatalIssues =
        validation.issues.filter(
          issue =>
            issue.fatal
        );

      if (
        !validation.valid ||
        fatalIssues.length >
          0
      ) {
        throw new SegmentationError(
          'INVALID_INPUT',
          fatalIssues
            .map(
              issue =>
                issue.message
            )
            .join(' ') ||
            'Invalid segmentation image source.',
          {
            requestId,

            stage:
              'validate-input',

            retryable:
              false,

            metadata: {
              issueCount:
                validation
                  .issues
                  .length,

              fatalIssueCount:
                fatalIssues
                  .length,
            },
          }
        );
      }

      assertNotCancelled(
        signal
      );

      /* ---------------------------------------------------
       * 2. Load image
       * ------------------------------------------------- */

      emitProgress(
        requestId,
        'load-image',
        'Loading the source image.',
        startedAt,
        input.onProgress
      );

      const loadStartedAt =
        now();

      const loadedImage =
        await loadSourceImage(
          input.source,
          requestId,
          signal
        );

      timings.loadImageMs =
        now() -
        loadStartedAt;

      assertSafeImageSize(
        loadedImage.width,
        loadedImage.height,
        requestId,
        'load-image'
      );

      assertNotCancelled(
        signal
      );

      /* ---------------------------------------------------
       * 3. Decode pixels
       * ------------------------------------------------- */

      emitProgress(
        requestId,
        'decode-pixels',
        'Reading RGBA image pixels.',
        startedAt,
        input.onProgress,
        {
          width:
            loadedImage.width,

          height:
            loadedImage.height,
        }
      );

      const decodeStartedAt =
        now();

      assertValidRgbaLength(
        loadedImage.width,
        loadedImage.height,
        loadedImage.rgba,
        requestId,
        'decode-pixels'
      );

      timings.decodePixelsMs =
        now() -
        decodeStartedAt;

      assertNotCancelled(
        signal
      );

      /* ---------------------------------------------------
       * 4. Correct orientation
       * ------------------------------------------------- */

      emitProgress(
        requestId,
        'correct-orientation',
        'Correcting image orientation.',
        startedAt,
        input.onProgress
      );

      const orientationStartedAt =
        now();

      const orientedImage =
        correctImageOrientation(
          loadedImage,
          requestId,
          signal
        );

      timings.correctOrientationMs =
        now() -
        orientationStartedAt;

      assertNotCancelled(
        signal
      );

      /* ---------------------------------------------------
       * 5. Resolve resize
       * ------------------------------------------------- */

      const encoderInputConfig =
        config.encoder.input;

      const modelWidth =
        encoderInputConfig.width;

      const modelHeight =
        encoderInputConfig.height;

      const resize =
        resolveResizeDimensions(
          orientedImage.width,
          orientedImage.height,
          modelWidth,
          modelHeight,
          encoderInputConfig
            .resizeMode
        );

      const transform =
        createImageTransform(
          loadedImage,
          orientedImage,
          modelWidth,
          modelHeight,
          resize,
          encoderInputConfig
            .resizeMode
        );

      emitProgress(
        requestId,
        'resize-image',
        'Resizing the image for EdgeSAM.',
        startedAt,
        input.onProgress,
        {
          sourceWidth:
            orientedImage.width,

          sourceHeight:
            orientedImage.height,

          resizedWidth:
            resize.width,

          resizedHeight:
            resize.height,
        }
      );

      const resizeStartedAt =
        now();

      let resizedImage =
        resizeRgbaImage(
          orientedImage,
          resize.width,
          resize.height,
          encoderInputConfig
            .interpolation,
          transform,
          requestId,
          signal
        );

      /**
       * cover قد ينتج أبعادًا أكبر من الموديل.
       *
       * لأن EdgeSAM الرسمي يستخدم letterbox،
       * هذا المسار موجود فقط لدعم config العام.
       * نقوم بقص أعلى اليسار بأمان.
       */
      if (
        resizedImage.width >
          modelWidth ||
        resizedImage.height >
          modelHeight
      ) {
        const croppedWidth =
          Math.min(
            resizedImage.width,
            modelWidth
          );

        const croppedHeight =
          Math.min(
            resizedImage.height,
            modelHeight
          );

        const cropped =
          new Uint8Array(
            croppedWidth *
            croppedHeight *
            RGBA_CHANNEL_COUNT
          );

        for (
          let y = 0;
          y <
            croppedHeight;
          y += 1
        ) {
          const sourceOffset =
            y *
            resizedImage.width *
            RGBA_CHANNEL_COUNT;

          const destinationOffset =
            y *
            croppedWidth *
            RGBA_CHANNEL_COUNT;

          cropped.set(
            resizedImage.rgba.subarray(
              sourceOffset,
              sourceOffset +
                croppedWidth *
                  RGBA_CHANNEL_COUNT
            ),
            destinationOffset
          );
        }

        resizedImage = {
          width:
            croppedWidth,

          height:
            croppedHeight,

          rgba:
            cropped,

          transform,
        };
      }

      timings.resizeImageMs =
        now() -
        resizeStartedAt;

      assertNotCancelled(
        signal
      );

      /* ---------------------------------------------------
       * 6. Apply letterbox
       * ------------------------------------------------- */

      emitProgress(
        requestId,
        'apply-letterbox',
        'Applying EdgeSAM letterbox padding.',
        startedAt,
        input.onProgress,
        {
          paddingLeft:
            transform.padding.left,

          paddingTop:
            transform.padding.top,

          paddingRight:
            transform.padding.right,

          paddingBottom:
            transform.padding.bottom,
        }
      );

      const letterboxStartedAt =
        now();

      const modelImage =
        applyLetterbox(
          resizedImage,
          modelWidth,
          modelHeight,
          encoderInputConfig,
          requestId,
          signal
        );

      timings.applyLetterboxMs =
        now() -
        letterboxStartedAt;

      assertNotCancelled(
        signal
      );

      /* ---------------------------------------------------
       * 7. Normalize pixels
       * 8. Create tensor
       * ------------------------------------------------- */

      emitProgress(
        requestId,
        'normalize-pixels',
        'Normalizing EdgeSAM image pixels.',
        startedAt,
        input.onProgress
      );

      const normalizeStartedAt =
        now();

      /**
       * التطبيع وإنشاء NCHW يحدثان في Loop واحد
       * لتقليل استهلاك الذاكرة والوقت.
       */
      emitProgress(
        requestId,
        'create-encoder-tensor',
        'Creating the EdgeSAM encoder tensor.',
        startedAt,
        input.onProgress
      );

      const tensorStartedAt =
        now();

      const encoderInput =
        createEncoderTensor(
          modelImage,
          encoderInputConfig,
          requestId,
          signal
        );

      const tensorDuration =
        now() -
        tensorStartedAt;

      timings.normalizePixelsMs =
        Math.max(
          0,
          now() -
            normalizeStartedAt
        );

      timings.createEncoderTensorMs =
        tensorDuration;

      timings.totalMs =
        now() -
        startedAt;

      assertNotCancelled(
        signal
      );

      return {
        source:
          input.source,

        loadedImage,

        orientedImage,

        modelImage,

        encoderInput,

        transform,

        timings,
      };
    } catch (error) {
      if (
        isSegmentationError(
          error
        )
      ) {
        if (
          error.requestId
        ) {
          throw error;
        }

        throw new SegmentationError(
          error.code,
          error.message,
          {
            requestId,

            stage:
              error.stage ??
              'validate-input',

            component:
              error.component,

            retryable:
              error.retryable,

            cause:
              error.cause ??
              error,

            metadata:
              error.metadata,
          }
        );
      }

      throw new SegmentationError(
        'IMAGE_DECODE_FAILED',
        `Unable to preprocess the EdgeSAM image: ${getUnknownErrorMessage(
          error
        )}`,
        {
          requestId,

          stage:
            'decode-pixels',

          retryable:
            true,

          cause:
            error,
        }
      );
    }
  }
}

/* =========================================================
 * Functional API
 * ======================================================= */

export async function preprocessSegmentationImage(
  input:
    SegmentationPreprocessorInput
): Promise<SegmentationPreprocessResult> {
  const preprocessor =
    new SegmentationPreprocessor(
      input.config ??
      DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return preprocessor.process(
    input
  );
}

export function createSegmentationPreprocessor(
  config:
    SegmentationModelConfig =
      DEFAULT_SEGMENTATION_MODEL_CONFIG
): SegmentationPreprocessor {
  return new SegmentationPreprocessor(
    config
  );
}

export default
  SegmentationPreprocessor;