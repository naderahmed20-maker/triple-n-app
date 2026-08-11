// app/data/colorEngine.ts
// Part 1/2

import {
  fashionColors,
  type FashionColor,
} from './fashionColors';

import type {
  SeasonType,
  StyleType,
  WeatherType,
} from './fashionRules';

export type ColorEngineItem = {
  image?: string;

  category?: string;

  subCategory?:
    | string
    | null;

  name?: string;

  color?: string;

  shade?: string;
};

export type ColorEngineOutfit = {
  top?:
    | ColorEngineItem
    | null;

  bottom?:
    | ColorEngineItem
    | null;

  pants?:
    | ColorEngineItem
    | null;

  shoes?:
    | ColorEngineItem
    | null;

  jacket?:
    | ColorEngineItem
    | null;

  bag?:
    | ColorEngineItem
    | null;

  cap?:
    | ColorEngineItem
    | null;

  watch?:
    | ColorEngineItem
    | null;

  accessory?:
    | ColorEngineItem
    | null;
};

export type ColorEngineLanguage =
  | 'English'
  | 'Italian'
  | 'en'
  | 'it'
  | string;

export type ColorEngineOptions = {
  style?: StyleType;

  weather?: WeatherType;

  season?: SeasonType;

  language?:
    | ColorEngineLanguage
    | null;
};

export type BrightnessGroup =
  | 'light'
  | 'medium'
  | 'dark'
  | 'metallic'
  | 'unknown';

export type SaturationGroup =
  | 'neutral'
  | 'soft'
  | 'strong'
  | 'metallic'
  | 'unknown';

export type ColorScoreBreakdown = {
  pairHarmony: number;

  colorCount: number;

  lightDarkBalance:
    number;

  neutralBalance:
    number;

  distribution: number;

  context: number;

  final: number;
};

export type ColorEngineResult = {
  score: number;

  breakdown:
    ColorScoreBreakdown;

  colors:
    FashionColor[];

  uniqueColors:
    FashionColor[];

  reasons:
    string[];

  warnings:
    string[];
};

type NormalizedOutfitPieces = {
  top:
    | ColorEngineItem
    | null;

  bottom:
    | ColorEngineItem
    | null;

  shoes:
    | ColorEngineItem
    | null;

  jacket:
    | ColorEngineItem
    | null;

  bag:
    | ColorEngineItem
    | null;

  cap:
    | ColorEngineItem
    | null;

  watch:
    | ColorEngineItem
    | null;

  accessory:
    | ColorEngineItem
    | null;
};

const COLOR_KEYS =
  Object.keys(
    fashionColors
  ) as FashionColor[];

const NEUTRAL_COLORS:
  FashionColor[] = [
    'Black',
    'White',
    'Gray',
    'Navy',
    'Denim',
    'Beige',
    'Camel',
    'Cream',
    'Brown',
    'Khaki',
    'Olive',
    'Gold',
    'Silver',
  ];

const STRONG_COLORS:
  FashionColor[] = [
    'Red',
    'Yellow',
    'Orange',
    'Purple',
    'Pink',
    'Green',
    'Blue',
    'Burgundy',
  ];

const LIGHT_COLORS:
  FashionColor[] = [
    'White',
    'Cream',
    'Beige',
    'Camel',
    'Pink',
    'Yellow',
    'Silver',
  ];

const DARK_COLORS:
  FashionColor[] = [
    'Black',
    'Navy',
    'Brown',
    'Olive',
    'Burgundy',
    'Purple',
    'Gray',
  ];

const WARM_COLORS:
  FashionColor[] = [
    'Red',
    'Orange',
    'Yellow',
    'Brown',
    'Camel',
    'Beige',
    'Cream',
    'Burgundy',
    'Pink',
    'Gold',
  ];

const COOL_COLORS:
  FashionColor[] = [
    'Blue',
    'Navy',
    'Denim',
    'Green',
    'Olive',
    'Purple',
    'Gray',
    'Silver',
  ];

const BRIGHTNESS_MAP: Record<
  FashionColor,
  BrightnessGroup
> = {
  Black:
    'dark',

  White:
    'light',

  Gray:
    'medium',

  Blue:
    'medium',

  Navy:
    'dark',

  Denim:
    'medium',

  Beige:
    'light',

  Camel:
    'medium',

  Cream:
    'light',

  Brown:
    'dark',

  Green:
    'medium',

  Olive:
    'dark',

  Red:
    'medium',

  Burgundy:
    'dark',

  Pink:
    'light',

  Yellow:
    'light',

  Orange:
    'medium',

  Purple:
    'dark',

  Khaki:
    'medium',

  Gold:
    'metallic',

  Silver:
    'metallic',
};

const SATURATION_MAP: Record<
  FashionColor,
  SaturationGroup
> = {
  Black:
    'neutral',

  White:
    'neutral',

  Gray:
    'neutral',

  Blue:
    'strong',

  Navy:
    'soft',

  Denim:
    'soft',

  Beige:
    'neutral',

  Camel:
    'soft',

  Cream:
    'neutral',

  Brown:
    'soft',

  Green:
    'strong',

  Olive:
    'soft',

  Red:
    'strong',

  Burgundy:
    'soft',

  Pink:
    'soft',

  Yellow:
    'strong',

  Orange:
    'strong',

  Purple:
    'strong',

  Khaki:
    'soft',

  Gold:
    'metallic',

  Silver:
    'metallic',
};

const RISKY_PAIRS:
  Array<
    [
      FashionColor,
      FashionColor,
    ]
  > = [
    [
      'Red',
      'Green',
    ],

    [
      'Purple',
      'Yellow',
    ],

    [
      'Orange',
      'Pink',
    ],

    [
      'Red',
      'Orange',
    ],

    [
      'Green',
      'Purple',
    ],
  ];

const EXCELLENT_PAIRS:
  Array<
    [
      FashionColor,
      FashionColor,
    ]
  > = [
    [
      'Black',
      'White',
    ],

    [
      'Black',
      'Gray',
    ],

    [
      'Black',
      'Beige',
    ],

    [
      'White',
      'Navy',
    ],

    [
      'White',
      'Blue',
    ],

    [
      'White',
      'Denim',
    ],

    [
      'Beige',
      'Brown',
    ],

    [
      'Beige',
      'Navy',
    ],

    [
      'Camel',
      'Navy',
    ],

    [
      'Cream',
      'Brown',
    ],

    [
      'Gray',
      'Navy',
    ],

    [
      'Blue',
      'Brown',
    ],

    [
      'Olive',
      'Cream',
    ],

    [
      'Burgundy',
      'Beige',
    ],
  ];

function clamp(
  value: number,
  minimum = 0,
  maximum = 100
) {
  return Math.max(
    minimum,

    Math.min(
      maximum,
      Math.round(
        value
      )
    )
  );
}

function cleanText(
  value?:
    | string
    | null
) {
  return (
    value ||
    ''
  )
    .trim()
    .toLowerCase()
    .replace(
      /[_-]/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    );
}

function isItalianLanguage(
  language?:
    | ColorEngineLanguage
    | null
) {
  const normalized =
    String(
      language ||
      ''
    )
      .trim()
      .toLowerCase();

  return (
    normalized ===
      'italian' ||
    normalized ===
      'italiano' ||
    normalized ===
      'it' ||
    normalized.startsWith(
      'it-'
    ) ||
    normalized.startsWith(
      'it_'
    )
  );
}

function pairExists(
  pairs:
    Array<
      [
        FashionColor,
        FashionColor,
      ]
    >,

  first:
    FashionColor,

  second:
    FashionColor
) {
  return pairs.some(
    (
      [
        firstPairColor,
        secondPairColor,
      ]
    ) =>
      (
        firstPairColor ===
          first &&
        secondPairColor ===
          second
      ) ||
      (
        firstPairColor ===
          second &&
        secondPairColor ===
          first
      )
  );
}

function getItemIdentity(
  item?:
    | ColorEngineItem
    | null
) {
  if (!item) {
    return 'none';
  }

  return [
    item.image,
    item.category,
    item.subCategory,
    item.name,
    item.color,
    item.shade,
  ]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
}

function getItemColorValue(
  item?:
    | ColorEngineItem
    | null
) {
  return (
    item?.shade ||
    item?.color ||
    null
  );
}

export function normalizeColor(
  value?:
    | string
    | null
):
  | FashionColor
  | 'Unknown' {
  const cleaned =
    cleanText(
      value
    );

  if (!cleaned) {
    return 'Unknown';
  }

  for (
    const baseColor of
    COLOR_KEYS
  ) {
    if (
      cleanText(
        baseColor
      ) ===
      cleaned
    ) {
      return baseColor;
    }

    const shades =
      fashionColors[
        baseColor
      ].shades as readonly string[];

    const matchedShade =
      shades.some(
        (
          shade
        ) =>
          cleanText(
            shade
          ) ===
          cleaned
      );

    if (matchedShade) {
      return baseColor;
    }
  }

  for (
    const baseColor of
    COLOR_KEYS
  ) {
    const shades =
      fashionColors[
        baseColor
      ].shades as readonly string[];

    const matchedShade =
      shades.some(
        (
          shade
        ) => {
          const normalizedShade =
            cleanText(
              shade
            );

          if (
            !normalizedShade
          ) {
            return false;
          }

          return (
            cleaned.includes(
              normalizedShade
            ) ||
            normalizedShade.includes(
              cleaned
            )
          );
        }
      );

    if (matchedShade) {
      return baseColor;
    }
  }

  return 'Unknown';
}

export function getColorFamily(
  value?:
    | string
    | null
):
  | FashionColor
  | 'Unknown' {
  return normalizeColor(
    value
  );
}

export function getBrightnessGroup(
  value?:
    | string
    | null
): BrightnessGroup {
  const color =
    normalizeColor(
      value
    );

  if (
    color ===
    'Unknown'
  ) {
    return 'unknown';
  }

  const cleaned =
    cleanText(
      value
    );

  if (
    cleaned.includes(
      'light'
    ) ||
    cleaned.includes(
      'sky'
    ) ||
    cleaned.includes(
      'ivory'
    ) ||
    cleaned.includes(
      'off white'
    ) ||
    cleaned.includes(
      'mint'
    )
  ) {
    return 'light';
  }

  if (
    cleaned.includes(
      'dark'
    ) ||
    cleaned.includes(
      'midnight'
    ) ||
    cleaned.includes(
      'charcoal'
    ) ||
    cleaned.includes(
      'coffee'
    ) ||
    cleaned.includes(
      'chocolate'
    )
  ) {
    return 'dark';
  }

  return BRIGHTNESS_MAP[
    color
  ];
}

export function getSaturationGroup(
  value?:
    | string
    | null
): SaturationGroup {
  const color =
    normalizeColor(
      value
    );

  if (
    color ===
    'Unknown'
  ) {
    return 'unknown';
  }

  const cleaned =
    cleanText(
      value
    );

  if (
    cleaned.includes(
      'dusty'
    ) ||
    cleaned.includes(
      'washed'
    ) ||
    cleaned.includes(
      'sage'
    ) ||
    cleaned.includes(
      'pastel'
    )
  ) {
    return 'soft';
  }

  if (
    cleaned.includes(
      'bright'
    ) ||
    cleaned.includes(
      'royal'
    )
  ) {
    return 'strong';
  }

  return SATURATION_MAP[
    color
  ];
}

export function getPairColorScore(
  firstValue?:
    | string
    | null,

  secondValue?:
    | string
    | null
) {
  const first =
    normalizeColor(
      firstValue
    );

  const second =
    normalizeColor(
      secondValue
    );

  if (
    first ===
      'Unknown' ||
    second ===
      'Unknown'
  ) {
    return 62;
  }

  if (
    first ===
    second
  ) {
    const firstBrightness =
      getBrightnessGroup(
        firstValue
      );

    const secondBrightness =
      getBrightnessGroup(
        secondValue
      );

    if (
      firstBrightness !==
      secondBrightness
    ) {
      return 94;
    }

    return 86;
  }

  if (
    pairExists(
      EXCELLENT_PAIRS,
      first,
      second
    )
  ) {
    return 98;
  }

  const firstMatches =
    fashionColors[
      first
    ].matches as readonly string[];

  const secondMatches =
    fashionColors[
      second
    ].matches as readonly string[];

  const directMatch =
    firstMatches.includes(
      second
    ) ||
    secondMatches.includes(
      first
    );

  if (directMatch) {
    return 91;
  }

  if (
    NEUTRAL_COLORS.includes(
      first
    ) &&
    NEUTRAL_COLORS.includes(
      second
    )
  ) {
    return 89;
  }

  if (
    NEUTRAL_COLORS.includes(
      first
    ) ||
    NEUTRAL_COLORS.includes(
      second
    )
  ) {
    return 83;
  }

  const firstBrightness =
    getBrightnessGroup(
      firstValue
    );

  const secondBrightness =
    getBrightnessGroup(
      secondValue
    );

  const hasContrast =
    (
      firstBrightness ===
        'light' &&
      secondBrightness ===
        'dark'
    ) ||
    (
      firstBrightness ===
        'dark' &&
      secondBrightness ===
        'light'
    );

  if (hasContrast) {
    return 79;
  }

  const warmCombination =
    WARM_COLORS.includes(
      first
    ) &&
    WARM_COLORS.includes(
      second
    );

  const coolCombination =
    COOL_COLORS.includes(
      first
    ) &&
    COOL_COLORS.includes(
      second
    );

  if (
    warmCombination ||
    coolCombination
  ) {
    return 74;
  }

  if (
    pairExists(
      RISKY_PAIRS,
      first,
      second
    )
  ) {
    return 42;
  }

  return 64;
}

function getOutfitPieces(
  outfit:
    ColorEngineOutfit
): NormalizedOutfitPieces {
  const bottom =
    outfit.bottom ||
    outfit.pants ||
    null;

  return {
    top:
      outfit.top ||
      null,

    bottom,

    shoes:
      outfit.shoes ||
      null,

    jacket:
      outfit.jacket ||
      null,

    bag:
      outfit.bag ||
      null,

    cap:
      outfit.cap ||
      null,

    watch:
      outfit.watch ||
      null,

    accessory:
      outfit.accessory ||
      null,
  };
}

function getUniqueOutfitItems(
  outfit:
    ColorEngineOutfit
) {
  const pieces =
    getOutfitPieces(
      outfit
    );

  const items =
    Object.values(
      pieces
    ).filter(
      Boolean
    ) as ColorEngineItem[];

  return items.filter(
    (
      item,
      index,
      allItems
    ) => {
      const identity =
        getItemIdentity(
          item
        );

      return (
        allItems.findIndex(
          (
            currentItem
          ) =>
            getItemIdentity(
              currentItem
            ) ===
            identity
        ) ===
        index
      );
    }
  );
}

function getValidColors(
  outfit:
    ColorEngineOutfit
): FashionColor[] {
  return getUniqueOutfitItems(
    outfit
  )
    .map(
      (
        item
      ) =>
        normalizeColor(
          getItemColorValue(
            item
          )
        )
    )
    .filter(
      (
        color
      ): color is FashionColor =>
        color !==
        'Unknown'
    );
}

function isDress(
  item?:
    | ColorEngineItem
    | null
) {
  const category =
    cleanText(
      item?.category
    );

  return (
    category ===
      'dress' ||
    category ===
      'dresses'
  );
}

function averageWeightedScores(
  values:
    Array<{
      score: number;

      weight: number;
    }>
) {
  if (
    values.length ===
    0
  ) {
    return 55;
  }

  const totalWeight =
    values.reduce(
      (
        total,
        item
      ) =>
        total +
        item.weight,

      0
    );

  if (
    totalWeight <=
    0
  ) {
    return 55;
  }

  const weightedTotal =
    values.reduce(
      (
        total,
        item
      ) =>
        total +
        item.score *
          item.weight,

      0
    );

  return clamp(
    weightedTotal /
      totalWeight
  );
}

export function getPairHarmonyScore(
  outfit:
    ColorEngineOutfit
) {
  const {
    top,
    bottom,
    shoes,
    jacket,
    bag,
    cap,
    watch,
    accessory,
  } =
    getOutfitPieces(
      outfit
    );

  if (
    isDress(
      top
    ) &&
    top &&
    shoes
  ) {
    const dressScores:
      Array<{
        score: number;

        weight: number;
      }> = [
        {
          score:
            getPairColorScore(
              getItemColorValue(
                top
              ),

              getItemColorValue(
                shoes
              )
            ),

          weight:
            55,
        },
      ];

    if (jacket) {
      dressScores.push({
        score:
          getPairColorScore(
            getItemColorValue(
              jacket
            ),

            getItemColorValue(
              top
            )
          ),

        weight:
          25,
      });
    }

    if (bag) {
      dressScores.push({
        score:
          getPairColorScore(
            getItemColorValue(
              bag
            ),

            getItemColorValue(
              shoes
            )
          ),

        weight:
          10,
      });
    }

    if (watch) {
      dressScores.push({
        score:
          getPairColorScore(
            getItemColorValue(
              watch
            ),

            getItemColorValue(
              top
            )
          ),

        weight:
          5,
      });
    }

    if (cap) {
      dressScores.push({
        score:
          getPairColorScore(
            getItemColorValue(
              cap
            ),

            getItemColorValue(
              top
            )
          ),

        weight:
          5,
      });
    }

    if (accessory) {
      dressScores.push({
        score:
          getPairColorScore(
            getItemColorValue(
              accessory
            ),

            getItemColorValue(
              top
            )
          ),

        weight:
          5,
      });
    }

    return averageWeightedScores(
      dressScores
    );
  }

  const scores:
    Array<{
      score: number;

      weight: number;
    }> = [];

  if (
    top &&
    bottom
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            top
          ),

          getItemColorValue(
            bottom
          )
        ),

      weight:
        35,
    });
  }

  if (
    bottom &&
    shoes
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            bottom
          ),

          getItemColorValue(
            shoes
          )
        ),

      weight:
        25,
    });
  }

  if (
    top &&
    shoes
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            top
          ),

          getItemColorValue(
            shoes
          )
        ),

      weight:
        15,
    });
  }

  if (
    jacket &&
    top
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            jacket
          ),

          getItemColorValue(
            top
          )
        ),

      weight:
        20,
    });
  }

  if (
    bag &&
    shoes
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            bag
          ),

          getItemColorValue(
            shoes
          )
        ),

      weight:
        8,
    });
  }

  if (
    cap &&
    top
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            cap
          ),

          getItemColorValue(
            top
          )
        ),

      weight:
        5,
    });
  }

  if (
    watch &&
    top
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            watch
          ),

          getItemColorValue(
            top
          )
        ),

      weight:
        5,
    });
  }

  if (
    accessory &&
    top
  ) {
    scores.push({
      score:
        getPairColorScore(
          getItemColorValue(
            accessory
          ),

          getItemColorValue(
            top
          )
        ),

      weight:
        5,
    });
  }

  return averageWeightedScores(
    scores
  );
}
export function getColorCountScore(
  outfit:
    ColorEngineOutfit,

  style:
    StyleType =
      'Minimal'
) {
  const colors =
    getValidColors(
      outfit
    );

  const uniqueColors = [
    ...new Set(
      colors
    ),
  ];

  const count =
    uniqueColors.length;

  if (
    count ===
    0
  ) {
    return 45;
  }

  if (
    count ===
    1
  ) {
    return 86;
  }

  if (
    count ===
    2
  ) {
    return 100;
  }

  if (
    count ===
    3
  ) {
    return 96;
  }

  if (
    count ===
    4
  ) {
    if (
      style ===
      'Streetwear'
    ) {
      return 88;
    }

    if (
      style ===
      'Sport'
    ) {
      return 82;
    }

    return 66;
  }

  if (
    style ===
    'Streetwear'
  ) {
    return 64;
  }

  return 38;
}

export function getLightDarkBalanceScore(
  outfit:
    ColorEngineOutfit,

  style:
    StyleType =
      'Minimal'
) {
  const items =
    getUniqueOutfitItems(
      outfit
    );

  const brightnessGroups =
    items
      .map(
        (
          item
        ) =>
          getBrightnessGroup(
            getItemColorValue(
              item
            )
          )
      )
      .filter(
        (
          group
        ) =>
          group !==
            'unknown' &&
          group !==
            'metallic'
      );

  if (
    brightnessGroups.length ===
    0
  ) {
    return 55;
  }

  const lightCount =
    brightnessGroups.filter(
      (
        group
      ) =>
        group ===
        'light'
    ).length;

  const mediumCount =
    brightnessGroups.filter(
      (
        group
      ) =>
        group ===
        'medium'
    ).length;

  const darkCount =
    brightnessGroups.filter(
      (
        group
      ) =>
        group ===
        'dark'
    ).length;

  if (
    lightCount >
      0 &&
    darkCount >
      0
  ) {
    return 100;
  }

  if (
    mediumCount >
      0 &&
    (
      lightCount >
        0 ||
      darkCount >
        0
    )
  ) {
    return 91;
  }

  if (
    darkCount ===
    brightnessGroups.length
  ) {
    if (
      style ===
        'Luxury' ||
      style ===
        'Classic'
    ) {
      return 88;
    }

    return 76;
  }

  if (
    lightCount ===
    brightnessGroups.length
  ) {
    if (
      style ===
        'Minimal' ||
      style ===
        'Sport'
    ) {
      return 84;
    }

    return 72;
  }

  return 78;
}

export function getNeutralBalanceScore(
  outfit:
    ColorEngineOutfit
) {
  const colors =
    getValidColors(
      outfit
    );

  if (
    colors.length ===
    0
  ) {
    return 50;
  }

  const neutralCount =
    colors.filter(
      (
        color
      ) =>
        NEUTRAL_COLORS.includes(
          color
        )
    ).length;

  const strongCount =
    colors.filter(
      (
        color
      ) =>
        STRONG_COLORS.includes(
          color
        )
    ).length;

  if (
    strongCount ===
    0
  ) {
    return neutralCount >
      0
      ? 92
      : 68;
  }

  if (
    strongCount ===
      1 &&
    neutralCount >=
      1
  ) {
    return 100;
  }

  if (
    strongCount ===
      2 &&
    neutralCount >=
      2
  ) {
    return 82;
  }

  if (
    strongCount >=
    3
  ) {
    return 42;
  }

  return 70;
}

export function getDistributionScore(
  outfit:
    ColorEngineOutfit
) {
  const {
    top,
    bottom,
    shoes,
    jacket,
    bag,
    cap,
    watch,
    accessory,
  } =
    getOutfitPieces(
      outfit
    );

  const topColor =
    normalizeColor(
      getItemColorValue(
        top
      )
    );

  const bottomColor =
    normalizeColor(
      getItemColorValue(
        bottom
      )
    );

  const shoesColor =
    normalizeColor(
      getItemColorValue(
        shoes
      )
    );

  const jacketColor =
    normalizeColor(
      getItemColorValue(
        jacket
      )
    );

  const bagColor =
    normalizeColor(
      getItemColorValue(
        bag
      )
    );

  const capColor =
    normalizeColor(
      getItemColorValue(
        cap
      )
    );

  const watchColor =
    normalizeColor(
      getItemColorValue(
        watch
      )
    );

  const accessoryColor =
    normalizeColor(
      getItemColorValue(
        accessory
      )
    );

  let score =
    68;

  if (
    shoesColor !==
      'Unknown' &&
    bagColor !==
      'Unknown' &&
    shoesColor ===
      bagColor
  ) {
    score +=
      18;
  }

  if (
    jacketColor !==
      'Unknown' &&
    shoesColor !==
      'Unknown' &&
    jacketColor ===
      shoesColor
  ) {
    score +=
      12;
  }

  if (
    topColor !==
      'Unknown' &&
    shoesColor !==
      'Unknown' &&
    topColor ===
      shoesColor
  ) {
    score +=
      12;
  }

  if (
    bottomColor !==
      'Unknown' &&
    jacketColor !==
      'Unknown' &&
    bottomColor ===
      jacketColor
  ) {
    score +=
      10;
  }

  if (
    capColor !==
      'Unknown' &&
    shoesColor !==
      'Unknown' &&
    capColor ===
      shoesColor
  ) {
    score +=
      8;
  }

  if (
    watchColor !==
      'Unknown' &&
    (
      watchColor ===
        topColor ||
      watchColor ===
        shoesColor
    )
  ) {
    score +=
      6;
  }

  if (
    accessoryColor !==
      'Unknown' &&
    (
      accessoryColor ===
        shoesColor ||
      accessoryColor ===
        topColor
    )
  ) {
    score +=
      6;
  }

  const colors =
    getValidColors(
      outfit
    );

  const uniqueColors = [
    ...new Set(
      colors
    ),
  ];

  if (
    uniqueColors.length >=
      2 &&
    uniqueColors.length <=
      3
  ) {
    score +=
      8;
  }

  if (
    uniqueColors.length >=
    5
  ) {
    score -=
      28;
  }

  return clamp(
    score
  );
}

export function getContextColorScore(
  outfit:
    ColorEngineOutfit,

  options:
    ColorEngineOptions =
      {}
) {
  const colors =
    getValidColors(
      outfit
    );

  if (
    colors.length ===
    0
  ) {
    return 55;
  }

  let score =
    72;

  const lightCount =
    colors.filter(
      (
        color
      ) =>
        LIGHT_COLORS.includes(
          color
        )
    ).length;

  const darkCount =
    colors.filter(
      (
        color
      ) =>
        DARK_COLORS.includes(
          color
        )
    ).length;

  const neutralCount =
    colors.filter(
      (
        color
      ) =>
        NEUTRAL_COLORS.includes(
          color
        )
    ).length;

  const strongCount =
    colors.filter(
      (
        color
      ) =>
        STRONG_COLORS.includes(
          color
        )
    ).length;

  if (
    options.weather ===
      'Hot' ||
    options.season ===
      'Summer'
  ) {
    score +=
      lightCount *
      6;

    score -=
      darkCount *
      2;
  }

  if (
    options.weather ===
    'Mild'
  ) {
    score +=
      neutralCount *
      2;

    if (
      lightCount >
        0 &&
      darkCount >
        0
    ) {
      score +=
        6;
    }
  }

  if (
    options.season ===
    'Spring'
  ) {
    score +=
      colors.filter(
        (
          color
        ) =>
          [
            'White',
            'Cream',
            'Beige',
            'Blue',
            'Green',
            'Pink',
            'Yellow',
            'Denim',
          ].includes(
            color
          )
      ).length *
      4;
  }

  if (
    options.weather ===
    'Rainy'
  ) {
    if (
      colors.includes(
        'White'
      )
    ) {
      score -=
        8;
    }

    if (
      colors.some(
        (
          color
        ) =>
          [
            'Black',
            'Navy',
            'Gray',
            'Brown',
            'Olive',
            'Denim',
          ].includes(
            color
          )
      )
    ) {
      score +=
        12;
    }
  }

  if (
    options.style ===
      'Minimal' ||
    options.style ===
      'Classic' ||
    options.style ===
      'Luxury'
  ) {
    score +=
      neutralCount *
      4;
  }

  if (
    options.style ===
    'Streetwear'
  ) {
    if (
      strongCount >=
        1 &&
      strongCount <=
        2
    ) {
      score +=
        10;
    }
  }

  if (
    options.style ===
    'Sport'
  ) {
    if (
      colors.some(
        (
          color
        ) =>
          [
            'Black',
            'White',
            'Gray',
            'Blue',
            'Navy',
          ].includes(
            color
          )
      )
    ) {
      score +=
        10;
    }
  }

  return clamp(
    score
  );
}

export function calculateOutfitColorScore(
  outfit:
    ColorEngineOutfit,

  options:
    ColorEngineOptions =
      {}
): ColorEngineResult {
  const style =
    options.style ||
    'Minimal';

  const isItalian =
    isItalianLanguage(
      options.language
    );

  const pairHarmony =
    getPairHarmonyScore(
      outfit
    );

  const colorCount =
    getColorCountScore(
      outfit,
      style
    );

  const lightDarkBalance =
    getLightDarkBalanceScore(
      outfit,
      style
    );

  const neutralBalance =
    getNeutralBalanceScore(
      outfit
    );

  const distribution =
    getDistributionScore(
      outfit
    );

  const context =
    getContextColorScore(
      outfit,
      options
    );

  const final =
    clamp(
      pairHarmony *
        0.45 +
      colorCount *
        0.15 +
      lightDarkBalance *
        0.15 +
      neutralBalance *
        0.1 +
      distribution *
        0.1 +
      context *
        0.05
    );

  const colors =
    getValidColors(
      outfit
    );

  const uniqueColors = [
    ...new Set(
      colors
    ),
  ];

  const reasons:
    string[] = [];

  const warnings:
    string[] = [];

  if (
    pairHarmony >=
    90
  ) {
    reasons.push(
      isItalian
        ? 'I colori principali dell’outfit hanno un’armonia eccellente.'
        : 'The main outfit colors have excellent harmony.'
    );
  } else if (
    pairHarmony >=
    80
  ) {
    reasons.push(
      isItalian
        ? 'I colori principali dell’outfit si abbinano bene.'
        : 'The main outfit colors work well together.'
    );
  } else if (
    pairHarmony <
    60
  ) {
    warnings.push(
      isItalian
        ? 'Alcuni dei colori principali dell’outfit sono in contrasto.'
        : 'Some of the main outfit colors clash.'
    );
  }

  if (
    uniqueColors.length >=
      2 &&
    uniqueColors.length <=
      3
  ) {
    reasons.push(
      isItalian
        ? `L’outfit utilizza una palette equilibrata di ${uniqueColors.length} colori.`
        : `The outfit uses a balanced ${uniqueColors.length}-color palette.`
    );
  }

  if (
    uniqueColors.length >
    4
  ) {
    warnings.push(
      isItalian
        ? 'L’outfit utilizza troppi colori non coordinati.'
        : 'The outfit uses too many unrelated colors.'
    );
  }

  if (
    neutralBalance >=
    90
  ) {
    reasons.push(
      isItalian
        ? 'I colori neutri mantengono l’outfit equilibrato.'
        : 'Neutral colors keep the outfit balanced.'
    );
  } else if (
    neutralBalance <
    55
  ) {
    warnings.push(
      isItalian
        ? 'L’outfit contiene troppi colori intensi.'
        : 'The outfit contains too many strong colors.'
    );
  }

  if (
    lightDarkBalance >=
    90
  ) {
    reasons.push(
      isItalian
        ? 'I toni chiari e scuri sono ben bilanciati.'
        : 'Light and dark tones are well balanced.'
    );
  }

  if (
    distribution >=
    90
  ) {
    reasons.push(
      isItalian
        ? 'Le scarpe e gli accessori riprendono i colori dell’outfit.'
        : 'Shoes and accessories repeat colors from the outfit.'
    );
  }

  if (
    context >=
    90
  ) {
    reasons.push(
      isItalian
        ? 'La palette è adatta al contesto selezionato.'
        : 'The color palette suits the selected context.'
    );
  }

  return {
    score:
      final,

    breakdown: {
      pairHarmony,

      colorCount,

      lightDarkBalance,

      neutralBalance,

      distribution,

      context,

      final,
    },

    colors,

    uniqueColors,

    reasons: [
      ...new Set(
        reasons
      ),
    ],

    warnings: [
      ...new Set(
        warnings
      ),
    ],
  };
}