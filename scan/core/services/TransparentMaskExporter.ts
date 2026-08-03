import * as FileSystem from 'expo-file-system/legacy';

import {
  AlphaType,
  ColorType,
  Skia,
} from '@shopify/react-native-skia';

import {
  applyMaskToRgbaInPlace,
  type AlphaMask,
} from '../ai/MaskGenerator';

export type ExportTransparentMaskInput = {
  sourceUri: string;

  mask: AlphaMask;

  /**
   * جودة PNG.
   * PNG لا يفقد الجودة، لكن نحتفظ بالقيمة
   * للتوافق مع Skia.
   */
  quality?: number;

  fileNamePrefix?: string;
};

export type ExportTransparentMaskResult = {
  uri: string;

  width: number;

  height: number;

  sourceWidth: number;

  sourceHeight: number;

  maskWidth: number;

  maskHeight: number;

  createdAt: number;
};

type LoadedImagePixels = {
  width: number;

  height: number;

  rgba: Uint8Array;
};

function clamp(
  value: number,
  minimum: number,
  maximum: number
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function normalizeUri(
  uri: string
) {
  const trimmed =
    uri.trim();

  if (!trimmed) {
    throw new Error(
      'The source image URI is empty.'
    );
  }

  if (
    trimmed.startsWith(
      'data:'
    )
  ) {
    const commaIndex =
      trimmed.indexOf(
        ','
      );

    if (
      commaIndex < 0
    ) {
      throw new Error(
        'The source data URI is invalid.'
      );
    }

    return {
      type:
        'base64' as const,

      value:
        trimmed.slice(
          commaIndex + 1
        ),
    };
  }

  return {
    type:
      'uri' as const,

    value:
      trimmed,
  };
}

async function readImageAsBase64(
  uri: string
) {
  const normalized =
    normalizeUri(
      uri
    );

  if (
    normalized.type ===
    'base64'
  ) {
    return normalized.value;
  }

  return FileSystem
    .readAsStringAsync(
      normalized.value,
      {
        encoding:
          FileSystem
            .EncodingType
            .Base64,
      }
    );
}

function convertPixelsToUint8(
  pixels:
    Uint8Array |
    Float32Array,
  expectedLength: number
) {
  if (
    pixels.length <
    expectedLength
  ) {
    throw new Error(
      `Skia returned ${pixels.length} pixel values, but ${expectedLength} were expected.`
    );
  }

  if (
    pixels instanceof
    Uint8Array
  ) {
    return new Uint8Array(
      pixels.slice(
        0,
        expectedLength
      )
    );
  }

  const output =
    new Uint8Array(
      expectedLength
    );

  let normalizedValues =
    true;

  const inspectionLength =
    Math.min(
      pixels.length,
      256
    );

  for (
    let index = 0;
    index <
      inspectionLength;
    index += 1
  ) {
    if (
      pixels[index] >
      1.0001
    ) {
      normalizedValues =
        false;

      break;
    }
  }

  for (
    let index = 0;
    index <
      expectedLength;
    index += 1
  ) {
    const value =
      normalizedValues
        ? pixels[index] *
          255
        : pixels[index];

    output[index] =
      clamp(
        Math.round(
          value
        ),
        0,
        255
      );
  }

  return output;
}

async function loadImagePixels(
  uri: string
): Promise<LoadedImagePixels> {
  const base64 =
    await readImageAsBase64(
      uri
    );

  const encodedData =
    Skia.Data.fromBase64(
      base64
    );

  const image =
    Skia.Image
      .MakeImageFromEncoded(
        encodedData
      );

  if (!image) {
    throw new Error(
      'Skia could not decode the source image.'
    );
  }

  try {
    const width =
      image.width();

    const height =
      image.height();

    if (
      !Number.isInteger(
        width
      ) ||
      !Number.isInteger(
        height
      ) ||
      width < 2 ||
      height < 2
    ) {
      throw new Error(
        'The decoded image dimensions are invalid.'
      );
    }

    const pixels =
      image.readPixels();

    if (!pixels) {
      throw new Error(
        'Skia could not read the source image pixels.'
      );
    }

    const expectedLength =
      width *
      height *
      4;

    return {
      width,

      height,

      rgba:
        convertPixelsToUint8(
          pixels,
          expectedLength
        ),
    };
  } finally {
    image.dispose();
  }
}

/**
 * تكبير أو تصغير الـMask إلى أبعاد الصورة.
 *
 * نستخدم Bilinear Sampling بدل Nearest Neighbor
 * حتى لا تظهر حواف متكسرة عند تصدير الصورة.
 */
function resizeAlphaMask(
  mask: AlphaMask,
  targetWidth: number,
  targetHeight: number
): AlphaMask {
 if (
  mask.width ===
    targetWidth &&
  mask.height ===
    targetHeight
) {
  /**
   * لا نحتاج نسخة جديدة لأن مرحلة التصدير
   * تقرأ الـMask فقط ولا تعدّل بياناته.
   *
   * النتيجة الحسابية تظل متطابقة تمامًا،
   * مع توفير Buffer كامل بحجم الصورة.
   */
  return mask;
}

  const output =
    new Uint8Array(
      targetWidth *
      targetHeight
    );

  const scaleX =
    mask.width /
    targetWidth;

  const scaleY =
    mask.height /
    targetHeight;

  for (
    let targetY = 0;
    targetY <
      targetHeight;
    targetY += 1
  ) {
    const sourceY =
      (
        targetY +
        0.5
      ) *
        scaleY -
      0.5;

    const y0 =
      clamp(
        Math.floor(
          sourceY
        ),
        0,
        mask.height - 1
      );

    const y1 =
      clamp(
        y0 + 1,
        0,
        mask.height - 1
      );

    const yWeight =
      clamp(
        sourceY - y0,
        0,
        1
      );

    for (
      let targetX = 0;
      targetX <
        targetWidth;
      targetX += 1
    ) {
      const sourceX =
        (
          targetX +
          0.5
        ) *
          scaleX -
        0.5;

      const x0 =
        clamp(
          Math.floor(
            sourceX
          ),
          0,
          mask.width - 1
        );

      const x1 =
        clamp(
          x0 + 1,
          0,
          mask.width - 1
        );

      const xWeight =
        clamp(
          sourceX - x0,
          0,
          1
        );

      const topLeft =
        mask.data[
          y0 *
            mask.width +
          x0
        ];

      const topRight =
        mask.data[
          y0 *
            mask.width +
          x1
        ];

      const bottomLeft =
        mask.data[
          y1 *
            mask.width +
          x0
        ];

      const bottomRight =
        mask.data[
          y1 *
            mask.width +
          x1
        ];

      const top =
        topLeft *
          (
            1 -
            xWeight
          ) +
        topRight *
          xWeight;

      const bottom =
        bottomLeft *
          (
            1 -
            xWeight
          ) +
        bottomRight *
          xWeight;

      const alpha =
        top *
          (
            1 -
            yWeight
          ) +
        bottom *
          yWeight;

      output[
        targetY *
          targetWidth +
        targetX
      ] =
        clamp(
          Math.round(
            alpha
          ),
          0,
          255
        );
    }
  }

  return {
    width:
      targetWidth,

    height:
      targetHeight,

    data:
      output,
  };
}

function sanitizeFileName(
  value: string
) {
  const sanitized =
    value
      .trim()
      .replace(
        /[^a-zA-Z0-9-_]/g,
        '-'
      )
      .replace(
        /-+/g,
        '-'
      )
      .replace(
        /^-|-$/g,
        ''
      );

  return (
    sanitized ||
    'scan-item'
  );
}

async function resolveOutputDirectory():
  Promise<string> {
  const baseDirectory =
    FileSystem
      .documentDirectory;

  if (!baseDirectory) {
    throw new Error(
      'The application document directory is unavailable.'
    );
  }

  const outputDirectory =
    `${baseDirectory}scan-items/`;

  const directoryInfo =
    await FileSystem
      .getInfoAsync(
        outputDirectory
      );

  if (
    directoryInfo.exists
  ) {
    if (
      'isDirectory' in
        directoryInfo &&
      !directoryInfo.isDirectory
    ) {
      throw new Error(
        'The scan-items output path points to a file.'
      );
    }

    return outputDirectory;
  }

  await FileSystem
    .makeDirectoryAsync(
      outputDirectory,
      {
        intermediates:
          true,
      }
    );

  return outputDirectory;
}

export async function exportTransparentMask({
  sourceUri,
  mask,
  quality = 100,
  fileNamePrefix = 'scan-item',
}: ExportTransparentMaskInput): Promise<ExportTransparentMaskResult> {
  if (
    !sourceUri ||
    !sourceUri.trim()
  ) {
    throw new Error(
      'The source image URI is missing.'
    );
  }

  if (
    mask.width < 2 ||
    mask.height < 2 ||
    mask.data.length !==
      mask.width *
        mask.height
  ) {
    throw new Error(
      'The supplied AlphaMask is invalid.'
    );
  }

  const loaded =
    await loadImagePixels(
      sourceUri
    );

  const resizedMask =
    resizeAlphaMask(
      mask,
      loaded.width,
      loaded.height
    );

 const transparentRgba =
  applyMaskToRgbaInPlace(
    loaded.rgba,
    resizedMask
  );

  const pixelData =
    Skia.Data.fromBytes(
      transparentRgba
    );

  const image =
    Skia.Image.MakeImage(
      {
        width:
          loaded.width,

        height:
          loaded.height,

        alphaType:
          AlphaType
            .Unpremul,

        colorType:
          ColorType
            .RGBA_8888,
      },
      pixelData,
      loaded.width * 4
    );

  if (!image) {
    throw new Error(
      'Skia could not create the transparent image.'
    );
  }

  try {
    const safeQuality =
      clamp(
        Math.round(
          quality
        ),
        0,
        100
      );

    const encodedBase64 =
  image.encodeToBase64();

    if (
      !encodedBase64
    ) {
      throw new Error(
        'Skia could not encode the transparent PNG.'
      );
    }

    const directory =
     await resolveOutputDirectory();

    const safePrefix =
      sanitizeFileName(
        fileNamePrefix
      );

    const outputUri =
      `${directory}${safePrefix}-${Date.now()}.png`;

    await FileSystem
      .writeAsStringAsync(
        outputUri,
        encodedBase64,
        {
          encoding:
            FileSystem
              .EncodingType
              .Base64,
        }
      );

    const outputInfo =
      await FileSystem
        .getInfoAsync(
          outputUri
        );

    if (
      !outputInfo.exists
    ) {
      throw new Error(
        'The transparent PNG was not saved.'
      );
    }

    return {
      uri:
        outputUri,

      width:
        loaded.width,

      height:
        loaded.height,

      sourceWidth:
        loaded.width,

      sourceHeight:
        loaded.height,

      maskWidth:
        mask.width,

      maskHeight:
        mask.height,

      createdAt:
        Date.now(),
    };
  } finally {
    image.dispose();
  }
}