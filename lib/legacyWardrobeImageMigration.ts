import {
  AlphaType,
  ColorType,
  Skia,
} from '@shopify/react-native-skia';

import * as FileSystem from 'expo-file-system/legacy';

import {
  uploadWardrobeImage,
} from '@/lib/storageService';

import {
  type WardrobeItem,
  updateWardrobeItem,
} from '@/lib/wardrobeService';

const ALPHA_THRESHOLD = 8;
const PADDING_RATIO = 0.02;
const MIN_PADDING = 6;
const MAX_PADDING = 32;

let migrationPromise:
  Promise<number> | null =
    null;

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}

function toUint8(
  pixels:
    Uint8Array |
    Float32Array,
  length: number
) {
  if (
    pixels instanceof
      Uint8Array
  ) {
    return new Uint8Array(
      pixels.slice(
        0,
        length
      )
    );
  }

  const output =
    new Uint8Array(
      length
    );

  let normalized =
    true;

  for (
    let i = 0;
    i <
      Math.min(
        pixels.length,
        256
      );
    i += 1
  ) {
    if (
      pixels[i] >
      1.0001
    ) {
      normalized =
        false;

      break;
    }
  }

  for (
    let i = 0;
    i < length;
    i += 1
  ) {
    output[i] =
      clamp(
        Math.round(
          normalized
            ? pixels[i] * 255
            : pixels[i]
        ),
        0,
        255
      );
  }

  return output;
}

async function migrateOne(
  item:
    WardrobeItem,
  userId:
    string
): Promise<boolean> {
  const sourceUri =
    (
      item.cleaned_image_path ||
      item.image ||
      ''
    ).trim();

  if (
    !sourceUri ||
    (
      !sourceUri.startsWith(
        'http://'
      ) &&
      !sourceUri.startsWith(
        'https://'
      )
    )
  ) {
    return false;
  }

  if (
    item.processing_status &&
    item.processing_status !==
      'ready'
  ) {
    return false;
  }

  const cacheDirectory =
    FileSystem.cacheDirectory;

  if (!cacheDirectory) {
    return false;
  }

  const downloadedUri =
    `${cacheDirectory}legacy-wardrobe-${item.id}-${Date.now()}`;

  const croppedUri =
    `${cacheDirectory}legacy-wardrobe-cropped-${item.id}-${Date.now()}.png`;

  let image:
    ReturnType<
      typeof Skia.Image.MakeImageFromEncoded
    > =
      null;

  try {
    await FileSystem
      .downloadAsync(
        sourceUri,
        downloadedUri
      );

    const base64 =
      await FileSystem
        .readAsStringAsync(
          downloadedUri,
          {
            encoding:
              FileSystem
                .EncodingType
                .Base64,
          }
        );

    const encoded =
      Skia.Data.fromBase64(
        base64
      );

    image =
      Skia.Image
        .MakeImageFromEncoded(
          encoded
        );

    if (!image) {
      return false;
    }

    const width =
      image.width();

    const height =
      image.height();

    const pixels =
      image.readPixels();

    if (
      !pixels ||
      width < 2 ||
      height < 2
    ) {
      return false;
    }

    const rgba =
      toUint8(
        pixels,
        width *
          height *
          4
      );

    let minX =
      width;

    let minY =
      height;

    let maxX =
      -1;

    let maxY =
      -1;

    for (
      let y = 0;
      y < height;
      y += 1
    ) {
      for (
        let x = 0;
        x < width;
        x += 1
      ) {
        const alpha =
          rgba[
            (
              y *
                width +
              x
            ) *
              4 +
            3
          ];

        if (
          alpha <
          ALPHA_THRESHOLD
        ) {
          continue;
        }

        minX =
          Math.min(
            minX,
            x
          );

        minY =
          Math.min(
            minY,
            y
          );

        maxX =
          Math.max(
            maxX,
            x
          );

        maxY =
          Math.max(
            maxY,
            y
          );
      }
    }

    if (
      maxX < minX ||
      maxY < minY
    ) {
      return false;
    }

    const rawWidth =
      maxX -
      minX +
      1;

    const rawHeight =
      maxY -
      minY +
      1;

    const padding =
      clamp(
        Math.round(
          Math.max(
            rawWidth,
            rawHeight
          ) *
            PADDING_RATIO
        ),
        MIN_PADDING,
        MAX_PADDING
      );

    const left =
      Math.max(
        0,
        minX -
          padding
      );

    const top =
      Math.max(
        0,
        minY -
          padding
      );

    const right =
      Math.min(
        width - 1,
        maxX +
          padding
      );

    const bottom =
      Math.min(
        height - 1,
        maxY +
          padding
      );

    const cropWidth =
      right -
      left +
      1;

    const cropHeight =
      bottom -
      top +
      1;

    /*
     * الصورة Tight بالفعل.
     * ده يخلي الـmigration idempotent:
     * مش هنعيد رفع الجديدة كل مرة.
     */
    if (
      left === 0 &&
      top === 0 &&
      cropWidth === width &&
      cropHeight === height
    ) {
      return false;
    }

    const cropped =
      new Uint8Array(
        cropWidth *
        cropHeight *
        4
      );

    const sourceRowBytes =
      width *
      4;

    const targetRowBytes =
      cropWidth *
      4;

    for (
      let y = 0;
      y <
        cropHeight;
      y += 1
    ) {
      const sourceStart =
        (
          top +
          y
        ) *
          sourceRowBytes +
        left *
          4;

      cropped.set(
        rgba.subarray(
          sourceStart,
          sourceStart +
            targetRowBytes
        ),
        y *
          targetRowBytes
      );
    }

    const data =
      Skia.Data.fromBytes(
        cropped
      );

    const croppedImage =
      Skia.Image.MakeImage(
        {
          width:
            cropWidth,

          height:
            cropHeight,

          alphaType:
            AlphaType.Unpremul,

          colorType:
            ColorType.RGBA_8888,
        },
        data,
        cropWidth *
          4
      );

    if (!croppedImage) {
      return false;
    }

    try {
      const encodedBase64 =
        croppedImage
          .encodeToBase64();

      if (!encodedBase64) {
        return false;
      }

      await FileSystem
        .writeAsStringAsync(
          croppedUri,
          encodedBase64,
          {
            encoding:
              FileSystem
                .EncodingType
                .Base64,
          }
        );
    } finally {
      croppedImage.dispose();
    }

    const uploaded =
      await uploadWardrobeImage(
        croppedUri,
        userId
      );

    await updateWardrobeItem(
      item.id,
      {
        image:
          uploaded,

        cleaned_image_path:
          uploaded,
      }
    );

    console.log(
      'WARDROBE LEGACY IMAGE CROPPED:',
      item.id,
      `${width}x${height}`,
      '->',
      `${cropWidth}x${cropHeight}`
    );

    return true;
  } catch (
    error
  ) {
    console.warn(
      'WARDROBE LEGACY IMAGE MIGRATION ERROR:',
      item.id,
      error
    );

    return false;
  } finally {
    image?.dispose();

    await FileSystem
      .deleteAsync(
        downloadedUri,
        {
          idempotent:
            true,
        }
      )
      .catch(
        () => {}
      );

    await FileSystem
      .deleteAsync(
        croppedUri,
        {
          idempotent:
            true,
        }
      )
      .catch(
        () => {}
      );
  }
}

async function runMigration(
  items:
    WardrobeItem[],
  userId:
    string
): Promise<number> {
  let migrated =
    0;

  /*
   * Sequential intentionally:
   * صورة واحدة فقط في الذاكرة في نفس الوقت.
   */
  for (
    const item of
    items
  ) {
    const changed =
      await migrateOne(
        item,
        userId
      );

    if (changed) {
      migrated += 1;
    }
  }

  return migrated;
}

export function migrateLegacyWardrobeImages(
  items:
    WardrobeItem[],
  userId:
    string
): Promise<number> {
  if (
    migrationPromise
  ) {
    return migrationPromise;
  }

  migrationPromise =
    runMigration(
      items,
      userId
    ).finally(
      () => {
        migrationPromise =
          null;
      }
    );

  return migrationPromise;
}
