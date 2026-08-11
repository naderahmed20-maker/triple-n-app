import {
  Buffer,
} from 'buffer';

import * as ImageManipulator from 'expo-image-manipulator';

import jpeg from 'jpeg-js';

import {
  FashionColor,
  fashionColors,
} from './fashionColors';

export type DetectedColorResult = {
  color: FashionColor;

  shade: string;
};

type RGB = {
  r: number;

  g: number;

  b: number;
};

function rgbToHsl({
  r,
  g,
  b,
}: RGB) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max =
    Math.max(
      r,
      g,
      b
    );

  const min =
    Math.min(
      r,
      g,
      b
    );

  let h = 0;
  let s = 0;

  const l =
    (
      max +
      min
    ) /
    2;

  if (
    max !== min
  ) {
    const d =
      max -
      min;

    s =
      l > 0.5
        ? d /
          (
            2 -
            max -
            min
          )
        : d /
          (
            max +
            min
          );

    if (
      max === r
    ) {
      h =
        (
          g -
          b
        ) /
          d +
        (
          g < b
            ? 6
            : 0
        );
    } else if (
      max === g
    ) {
      h =
        (
          b -
          r
        ) /
          d +
        2;
    } else {
      h =
        (
          r -
          g
        ) /
          d +
        4;
    }

    h *= 60;
  }

  return {
    h,
    s,
    l,
  };
}

function getColorDistance(
  a: RGB,
  b: RGB
) {
  return Math.sqrt(
    Math.pow(
      a.r -
        b.r,
      2
    ) +
      Math.pow(
        a.g -
          b.g,
        2
      ) +
      Math.pow(
        a.b -
          b.b,
        2
      )
  );
}

function isBackgroundPixel(
  pixel: RGB
) {
  const {
    r,
    g,
    b,
  } = pixel;

  const brightness =
    (
      r +
      g +
      b
    ) /
    3;

  const colorSpread =
    Math.max(
      r,
      g,
      b
    ) -
    Math.min(
      r,
      g,
      b
    );

  if (
    brightness > 232 &&
    colorSpread < 28
  ) {
    return true;
  }

  if (
    brightness < 18
  ) {
    return true;
  }

  return false;
}

function getMainColor(
  pixels: RGB[]
) {
  if (
    pixels.length ===
    0
  ) {
    return {
      r: 0,
      g: 0,
      b: 0,
    };
  }

  const buckets: Record<
    string,
    {
      total: RGB;

      count: number;
    }
  > = {};

  pixels.forEach(
    (
      pixel
    ) => {
      const key = [
        Math.round(
          pixel.r /
            24
        ) * 24,

        Math.round(
          pixel.g /
            24
        ) * 24,

        Math.round(
          pixel.b /
            24
        ) * 24,
      ].join('-');

      if (
        !buckets[key]
      ) {
        buckets[key] = {
          total: {
            r: 0,
            g: 0,
            b: 0,
          },

          count: 0,
        };
      }

      buckets[
        key
      ].total.r +=
        pixel.r;

      buckets[
        key
      ].total.g +=
        pixel.g;

      buckets[
        key
      ].total.b +=
        pixel.b;

      buckets[
        key
      ].count += 1;
    }
  );

  const bestBucket =
    Object.values(
      buckets
    ).sort(
      (
        a,
        b
      ) =>
        b.count -
        a.count
    )[0];

  return {
    r:
      Math.round(
        bestBucket
          .total.r /
          bestBucket
            .count
      ),

    g:
      Math.round(
        bestBucket
          .total.g /
          bestBucket
            .count
      ),

    b:
      Math.round(
        bestBucket
          .total.b /
          bestBucket
            .count
      ),
  };
}

function classifyFashionColor(
  rgb: RGB
): FashionColor {
  const {
    h,
    s,
    l,
  } =
    rgbToHsl(
      rgb
    );

  if (
    s < 0.08
  ) {
    if (
      l < 0.18
    ) {
      return 'Black';
    }

    if (
      l > 0.86
    ) {
      return 'White';
    }

    if (
      l > 0.68
    ) {
      return 'Silver';
    }

    return 'Gray';
  }

  if (
    h >= 345 ||
    h < 12
  ) {
    if (
      l < 0.42
    ) {
      return 'Burgundy';
    }

    if (
      l > 0.68 &&
      s < 0.65
    ) {
      return 'Pink';
    }

    return 'Red';
  }

  if (
    h >= 12 &&
    h < 32
  ) {
    if (
      l < 0.36
    ) {
      return 'Brown';
    }

    if (
      s < 0.45 &&
      l > 0.55
    ) {
      return 'Camel';
    }

    return 'Orange';
  }

  if (
    h >= 32 &&
    h < 52
  ) {
    if (
      l > 0.72 &&
      s < 0.38
    ) {
      return 'Cream';
    }

    if (
      l > 0.56 &&
      s < 0.45
    ) {
      return 'Beige';
    }

    if (
      l < 0.42
    ) {
      return 'Brown';
    }

    return 'Camel';
  }

  if (
    h >= 52 &&
    h < 72
  ) {
    if (
      s < 0.35
    ) {
      return 'Khaki';
    }

    if (
      l < 0.45
    ) {
      return 'Gold';
    }

    return 'Yellow';
  }

  if (
    h >= 72 &&
    h < 165
  ) {
    if (
      s < 0.42 ||
      l < 0.36
    ) {
      return 'Olive';
    }

    return 'Green';
  }

  if (
    h >= 165 &&
    h < 195
  ) {
    if (
      l > 0.72
    ) {
      return 'Blue';
    }

    return 'Green';
  }

  if (
    h >= 195 &&
    h < 245
  ) {
    if (
      l < 0.32
    ) {
      return 'Navy';
    }

    if (
      s < 0.48 &&
      l < 0.62
    ) {
      return 'Denim';
    }

    return 'Blue';
  }

  if (
    h >= 245 &&
    h < 285
  ) {
    if (
      l < 0.35
    ) {
      return 'Navy';
    }

    return 'Purple';
  }

  if (
    h >= 285 &&
    h < 345
  ) {
    if (
      l > 0.58
    ) {
      return 'Pink';
    }

    return 'Purple';
  }

  return 'Black';
}

function getShade(
  color: FashionColor,
  rgb: RGB
) {
  const {
    l,
  } =
    rgbToHsl(
      rgb
    );

  const shades =
    fashionColors[
      color
    ].shades;

  if (
    shades.length ===
    1
  ) {
    return shades[0];
  }

  const lowerName =
    color.toLowerCase();

  if (
    l < 0.32
  ) {
    return (
      shades.find(
        (
          shade
        ) =>
          shade
            .toLowerCase()
            .includes(
              'dark'
            )
      ) ||
      shades.find(
        (
          shade
        ) =>
          shade
            .toLowerCase()
            .includes(
              lowerName
            )
      ) ||
      shades[0]
    );
  }

  if (
    l > 0.7
  ) {
    return (
      shades.find(
        (
          shade
        ) =>
          shade
            .toLowerCase()
            .includes(
              'light'
            )
      ) ||
      shades.find(
        (
          shade
        ) =>
          shade
            .toLowerCase()
            .includes(
              'cream'
            )
      ) ||
      shades.find(
        (
          shade
        ) =>
          shade
            .toLowerCase()
            .includes(
              'ivory'
            )
      ) ||
      shades[0]
    );
  }

  return (
    shades.find(
      (
        shade
      ) =>
        shade
          .toLowerCase()
          .includes(
            lowerName
          )
    ) ||
    shades[0]
  );
}

export async function detectColorFromImage(
  imageUri: string
): Promise<DetectedColorResult> {
  try {
    const resized =
      await ImageManipulator
        .manipulateAsync(
          imageUri,

          [
            {
              resize: {
                width: 80,
              },
            },
          ],

          {
            compress:
              0.8,

            format:
              ImageManipulator
                .SaveFormat
                .JPEG,

            base64:
              true,
          }
        );

    if (
      !resized.base64
    ) {
      return {
        color:
          'Black',

        shade:
          fashionColors
            .Black
            .shades[0],
      };
    }

    const raw =
      Buffer.from(
        resized.base64,
        'base64'
      );

    const decoded =
      jpeg.decode(
        raw,
        {
          useTArray:
            true,
        }
      );

    const pixels:
      RGB[] = [];

    for (
      let index = 0;
      index <
      decoded.data.length;
      index += 4 * 6
    ) {
      const pixel = {
        r:
          decoded.data[
            index
          ],

        g:
          decoded.data[
            index +
              1
          ],

        b:
          decoded.data[
            index +
              2
          ],
      };

      if (
        !isBackgroundPixel(
          pixel
        )
      ) {
        pixels.push(
          pixel
        );
      }
    }

    const mainColor =
      getMainColor(
        pixels
      );

    const color =
      classifyFashionColor(
        mainColor
      );

    const shade =
      getShade(
        color,
        mainColor
      );

    return {
      color,
      shade,
    };
  } catch {
    return {
      color:
        'Black',

      shade:
        fashionColors
          .Black
          .shades[0],
    };
  }
}