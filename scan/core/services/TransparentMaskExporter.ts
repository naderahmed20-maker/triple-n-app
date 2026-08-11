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

type TightAlphaBounds = {
  left: number;

  top: number;

  width: number;

  height: number;
};

/**
 * Alpha صغير جدًا قد يكون مجرد anti-aliasing أو noise.
 * القيمة منخفضة بما يكفي للحفاظ على الحواف الحقيقية،
 * مع تجاهل البكسلات الشفافة شبه الكاملة البعيدة.
 */
const TIGHT_ALPHA_THRESHOLD =
  8;

/**
 * نحتفظ بمساحة شفافة صغيرة حول القطعة حتى لا تلتصق
 * الحواف بإطار الصورة ولا يتم قطع الـsoft edges.
 */
const TIGHT_ALPHA_PADDING_RATIO =
  0.02;

const TIGHT_ALPHA_MIN_PADDING =
  6;

const TIGHT_ALPHA_MAX_PADDING =
  32;

function findTightAlphaBounds(
  mask: AlphaMask
): TightAlphaBounds {
  let minimumX =
    mask.width;

  let minimumY =
    mask.height;

  let maximumX =
    -1;

  let maximumY =
    -1;

  for (
    let y = 0;
    y < mask.height;
    y += 1
  ) {
    const rowOffset =
      y *
      mask.width;

    for (
      let x = 0;
      x < mask.width;
      x += 1
    ) {
      const alpha =
        mask.data[
          rowOffset +
          x
        ];

      if (
        alpha <
        TIGHT_ALPHA_THRESHOLD
      ) {
        continue;
      }

      if (
        x <
        minimumX
      ) {
        minimumX =
          x;
      }

      if (
        x >
        maximumX
      ) {
        maximumX =
          x;
      }

      if (
        y <
        minimumY
      ) {
        minimumY =
          y;
      }

      if (
        y >
        maximumY
      ) {
        maximumY =
          y;
      }
    }
  }

  /**
   * Safety fallback:
   * لو الـMask لا تحتوي بكسلات مرئية،
   * نحتفظ بالأبعاد الأصلية ولا نكسر التصدير.
   */
  if (
    maximumX <
      minimumX ||
    maximumY <
      minimumY
  ) {
    return {
      left:
        0,

      top:
        0,

      width:
        mask.width,

      height:
        mask.height,
    };
  }

  const rawWidth =
    maximumX -
    minimumX +
    1;

  const rawHeight =
    maximumY -
    minimumY +
    1;

  const padding =
    clamp(
      Math.round(
        Math.max(
          rawWidth,
          rawHeight
        ) *
          TIGHT_ALPHA_PADDING_RATIO
      ),
      TIGHT_ALPHA_MIN_PADDING,
      TIGHT_ALPHA_MAX_PADDING
    );

  const left =
    Math.max(
      0,
      minimumX -
        padding
    );

  const top =
    Math.max(
      0,
      minimumY -
        padding
    );

  const right =
    Math.min(
      mask.width -
        1,
      maximumX +
        padding
    );

  const bottom =
    Math.min(
      mask.height -
        1,
      maximumY +
        padding
    );

  return {
    left,

    top,

    width:
      right -
      left +
      1,

    height:
      bottom -
      top +
      1,
  };
}

function cropRgbaPixels(
  rgba: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  bounds: TightAlphaBounds
) {
  if (
    bounds.left ===
      0 &&
    bounds.top ===
      0 &&
    bounds.width ===
      sourceWidth &&
    bounds.height ===
      sourceHeight
  ) {
    return rgba;
  }

  const output =
    new Uint8Array(
      bounds.width *
      bounds.height *
      4
    );

  const sourceRowBytes =
    sourceWidth *
    4;

  const targetRowBytes =
    bounds.width *
    4;

  const sourceLeftBytes =
    bounds.left *
    4;

  for (
    let targetY = 0;
    targetY <
      bounds.height;
    targetY += 1
  ) {
    const sourceY =
      bounds.top +
      targetY;

    if (
      sourceY <
        0 ||
      sourceY >=
        sourceHeight
    ) {
      continue;
    }

    const sourceStart =
      sourceY *
        sourceRowBytes +
      sourceLeftBytes;

    const sourceEnd =
      sourceStart +
      targetRowBytes;

    const targetStart =
      targetY *
      targetRowBytes;

    output.set(
      rgba.subarray(
        sourceStart,
        sourceEnd
      ),
      targetStart
    );
  }

  return output;
}

function cropAlphaMask(
  mask: AlphaMask,
  bounds: TightAlphaBounds
): AlphaMask {
  if (
    bounds.left ===
      0 &&
    bounds.top ===
      0 &&
    bounds.width ===
      mask.width &&
    bounds.height ===
      mask.height
  ) {
    return mask;
  }

  const output =
    new Uint8Array(
      bounds.width *
      bounds.height
    );

  for (
    let targetY = 0;
    targetY <
      bounds.height;
    targetY += 1
  ) {
    const sourceY =
      bounds.top +
      targetY;

    const sourceStart =
      sourceY *
        mask.width +
      bounds.left;

    const sourceEnd =
      sourceStart +
      bounds.width;

    const targetStart =
      targetY *
      bounds.width;

    output.set(
      mask.data.subarray(
        sourceStart,
        sourceEnd
      ),
      targetStart
    );
  }

  return {
    width:
      bounds.width,

    height:
      bounds.height,

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

  /**
   * مهم:
   * الصور القديمة كانت تُصدر بنفس أبعاد الكاميرا كاملة،
   * ولذلك كانت تحتوي على مساحة شفافة ضخمة حول الملابس.
   *
   * نحدد هنا حدود الجسم الفعلية من الـAlpha Mask أولًا،
   * ثم نقص الـRGBA والـMask قبل إنشاء PNG.
   */
  const cropBounds =
    findTightAlphaBounds(
      resizedMask
    );

  const croppedRgba =
    cropRgbaPixels(
      loaded.rgba,
      loaded.width,
      loaded.height,
      cropBounds
    );

  const croppedMask =
    cropAlphaMask(
      resizedMask,
      cropBounds
    );

  const transparentRgba =
    applyMaskToRgbaInPlace(
      croppedRgba,
      croppedMask
    );

  const pixelData =
    Skia.Data.fromBytes(
      transparentRgba
    );

  const image =
    Skia.Image.MakeImage(
      {
        width:
          cropBounds.width,

        height:
          cropBounds.height,

        alphaType:
          AlphaType
            .Unpremul,

        colorType:
          ColorType
            .RGBA_8888,
      },
      pixelData,
      cropBounds.width * 4
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
        cropBounds.width,

      height:
        cropBounds.height,

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