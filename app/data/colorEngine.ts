// app/data/colorEngine.ts

import { FashionColor, fashionColors } from './fashionColors';
import type {
    SeasonType,
    StyleType,
    WeatherType,
} from './fashionRules';

export type ColorEngineItem = {
  image?: string;
  category?: string;
  subCategory?: string | null;
  name?: string;
  color?: string;
  shade?: string;
};

export type ColorEngineOutfit = {
  top?: ColorEngineItem | null;
  bottom?: ColorEngineItem | null;
  pants?: ColorEngineItem | null;
  shoes?: ColorEngineItem | null;
  jacket?: ColorEngineItem | null;
  accessory?: ColorEngineItem | null;
};

export type ColorEngineOptions = {
  style?: StyleType;
  weather?: WeatherType;
  season?: SeasonType;
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
  lightDarkBalance: number;
  neutralBalance: number;
  distribution: number;
  context: number;
  final: number;
};

export type ColorEngineResult = {
  score: number;
  breakdown: ColorScoreBreakdown;
  colors: FashionColor[];
  uniqueColors: FashionColor[];
  reasons: string[];
  warnings: string[];
};

const COLOR_KEYS = Object.keys(
  fashionColors
) as FashionColor[];

const NEUTRAL_COLORS: FashionColor[] = [
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

const STRONG_COLORS: FashionColor[] = [
  'Red',
  'Yellow',
  'Orange',
  'Purple',
  'Pink',
  'Green',
  'Blue',
  'Burgundy',
];

const LIGHT_COLORS: FashionColor[] = [
  'White',
  'Cream',
  'Beige',
  'Camel',
  'Pink',
  'Yellow',
  'Silver',
];

const DARK_COLORS: FashionColor[] = [
  'Black',
  'Navy',
  'Brown',
  'Olive',
  'Burgundy',
  'Purple',
  'Gray',
];

const WARM_COLORS: FashionColor[] = [
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

const COOL_COLORS: FashionColor[] = [
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
  Black: 'dark',
  White: 'light',
  Gray: 'medium',
  Blue: 'medium',
  Navy: 'dark',
  Denim: 'medium',
  Beige: 'light',
  Camel: 'medium',
  Cream: 'light',
  Brown: 'dark',
  Green: 'medium',
  Olive: 'dark',
  Red: 'medium',
  Burgundy: 'dark',
  Pink: 'light',
  Yellow: 'light',
  Orange: 'medium',
  Purple: 'dark',
  Khaki: 'medium',
  Gold: 'metallic',
  Silver: 'metallic',
};

const SATURATION_MAP: Record<
  FashionColor,
  SaturationGroup
> = {
  Black: 'neutral',
  White: 'neutral',
  Gray: 'neutral',
  Blue: 'strong',
  Navy: 'soft',
  Denim: 'soft',
  Beige: 'neutral',
  Camel: 'soft',
  Cream: 'neutral',
  Brown: 'soft',
  Green: 'strong',
  Olive: 'soft',
  Red: 'strong',
  Burgundy: 'soft',
  Pink: 'soft',
  Yellow: 'strong',
  Orange: 'strong',
  Purple: 'strong',
  Khaki: 'soft',
  Gold: 'metallic',
  Silver: 'metallic',
};

const RISKY_PAIRS: Array<
  [FashionColor, FashionColor]
> = [
  ['Red', 'Green'],
  ['Purple', 'Yellow'],
  ['Orange', 'Pink'],
  ['Red', 'Orange'],
  ['Green', 'Purple'],
];

const EXCELLENT_PAIRS: Array<
  [FashionColor, FashionColor]
> = [
  ['Black', 'White'],
  ['Black', 'Gray'],
  ['Black', 'Beige'],
  ['White', 'Navy'],
  ['White', 'Blue'],
  ['White', 'Denim'],
  ['Beige', 'Brown'],
  ['Beige', 'Navy'],
  ['Camel', 'Navy'],
  ['Cream', 'Brown'],
  ['Gray', 'Navy'],
  ['Blue', 'Brown'],
  ['Olive', 'Cream'],
  ['Burgundy', 'Beige'],
];

function clamp(
  value: number,
  minimum = 0,
  maximum = 100
) {
  return Math.max(
    minimum,
    Math.min(maximum, Math.round(value))
  );
}

function cleanText(value?: string | null) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function pairExists(
  pairs: Array<[FashionColor, FashionColor]>,
  first: FashionColor,
  second: FashionColor
) {
  return pairs.some(
    ([a, b]) =>
      (a === first && b === second) ||
      (a === second && b === first)
  );
}

export function normalizeColor(
  value?: string | null
): FashionColor | 'Unknown' {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return 'Unknown';
  }

  for (const baseColor of COLOR_KEYS) {
    if (cleanText(baseColor) === cleaned) {
      return baseColor;
    }

    const shades =
      fashionColors[baseColor].shades as readonly string[];

    const matchedShade = shades.some(
      (shade) => cleanText(shade) === cleaned
    );

    if (matchedShade) {
      return baseColor;
    }
  }

  for (const baseColor of COLOR_KEYS) {
    const shades =
      fashionColors[baseColor].shades as readonly string[];

    const matchedShade = shades.some((shade) => {
      const normalizedShade = cleanText(shade);

      return (
        cleaned.includes(normalizedShade) ||
        normalizedShade.includes(cleaned)
      );
    });

    if (matchedShade) {
      return baseColor;
    }
  }

  return 'Unknown';
}

export function getColorFamily(
  value?: string | null
): FashionColor | 'Unknown' {
  return normalizeColor(value);
}

export function getBrightnessGroup(
  value?: string | null
): BrightnessGroup {
  const color = normalizeColor(value);

  if (color === 'Unknown') {
    return 'unknown';
  }

  const cleaned = cleanText(value);

  if (
    cleaned.includes('light') ||
    cleaned.includes('sky') ||
    cleaned.includes('ivory') ||
    cleaned.includes('off white') ||
    cleaned.includes('mint')
  ) {
    return 'light';
  }

  if (
    cleaned.includes('dark') ||
    cleaned.includes('midnight') ||
    cleaned.includes('charcoal') ||
    cleaned.includes('coffee') ||
    cleaned.includes('chocolate')
  ) {
    return 'dark';
  }

  return BRIGHTNESS_MAP[color];
}

export function getSaturationGroup(
  value?: string | null
): SaturationGroup {
  const color = normalizeColor(value);

  if (color === 'Unknown') {
    return 'unknown';
  }

  const cleaned = cleanText(value);

  if (
    cleaned.includes('dusty') ||
    cleaned.includes('washed') ||
    cleaned.includes('sage') ||
    cleaned.includes('pastel')
  ) {
    return 'soft';
  }

  if (
    cleaned.includes('bright') ||
    cleaned.includes('royal')
  ) {
    return 'strong';
  }

  return SATURATION_MAP[color];
}

export function getPairColorScore(
  firstValue?: string | null,
  secondValue?: string | null
) {
  const first = normalizeColor(firstValue);
  const second = normalizeColor(secondValue);

  if (
    first === 'Unknown' ||
    second === 'Unknown'
  ) {
    return 62;
  }

  if (first === second) {
    const firstBrightness =
      getBrightnessGroup(firstValue);

    const secondBrightness =
      getBrightnessGroup(secondValue);

    if (firstBrightness !== secondBrightness) {
      return 94;
    }

    return 86;
  }

  if (pairExists(EXCELLENT_PAIRS, first, second)) {
    return 98;
  }

  const firstMatches =
    fashionColors[first].matches as readonly string[];

  const secondMatches =
    fashionColors[second].matches as readonly string[];

  const directMatch =
    firstMatches.includes(second) ||
    secondMatches.includes(first);

  if (directMatch) {
    return 91;
  }

  if (
    NEUTRAL_COLORS.includes(first) &&
    NEUTRAL_COLORS.includes(second)
  ) {
    return 89;
  }

  if (
    NEUTRAL_COLORS.includes(first) ||
    NEUTRAL_COLORS.includes(second)
  ) {
    return 83;
  }

  const firstBrightness =
    getBrightnessGroup(firstValue);

  const secondBrightness =
    getBrightnessGroup(secondValue);

  const hasContrast =
    (firstBrightness === 'light' &&
      secondBrightness === 'dark') ||
    (firstBrightness === 'dark' &&
      secondBrightness === 'light');

  if (hasContrast) {
    return 79;
  }

  const warmCombination =
    WARM_COLORS.includes(first) &&
    WARM_COLORS.includes(second);

  const coolCombination =
    COOL_COLORS.includes(first) &&
    COOL_COLORS.includes(second);

  if (warmCombination || coolCombination) {
    return 74;
  }

  if (pairExists(RISKY_PAIRS, first, second)) {
    return 42;
  }

  return 64;
}

function getOutfitPieces(outfit: ColorEngineOutfit) {
  const bottom =
    outfit.bottom || outfit.pants || null;

  return {
    top: outfit.top || null,
    bottom,
    shoes: outfit.shoes || null,
    jacket: outfit.jacket || null,
    accessory: outfit.accessory || null,
  };
}

function getValidColors(
  outfit: ColorEngineOutfit
): FashionColor[] {
  const pieces = getOutfitPieces(outfit);

  return Object.values(pieces)
    .filter(Boolean)
    .map((item) =>
      normalizeColor(
        item?.shade || item?.color
      )
    )
    .filter(
      (color): color is FashionColor =>
        color !== 'Unknown'
    );
}

function isDress(item?: ColorEngineItem | null) {
  const category = cleanText(item?.category);

  return (
    category === 'dress' ||
    category === 'dresses'
  );
}

function averageWeightedScores(
  values: Array<{
    score: number;
    weight: number;
  }>
) {
  if (values.length === 0) {
    return 55;
  }

  const totalWeight = values.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  const weightedTotal = values.reduce(
    (sum, item) =>
      sum + item.score * item.weight,
    0
  );

  return clamp(weightedTotal / totalWeight);
}

export function getPairHarmonyScore(
  outfit: ColorEngineOutfit
) {
  const {
    top,
    bottom,
    shoes,
    jacket,
    accessory,
  } = getOutfitPieces(outfit);

  const scores: Array<{
    score: number;
    weight: number;
  }> = [];

  if (top && bottom) {
    scores.push({
      score: getPairColorScore(
        top.shade || top.color,
        bottom.shade || bottom.color
      ),
      weight: 35,
    });
  }

  if (bottom && shoes) {
    scores.push({
      score: getPairColorScore(
        bottom.shade || bottom.color,
        shoes.shade || shoes.color
      ),
      weight: 25,
    });
  }

  if (top && shoes) {
    scores.push({
      score: getPairColorScore(
        top.shade || top.color,
        shoes.shade || shoes.color
      ),
      weight: 15,
    });
  }

  if (jacket && top) {
    scores.push({
      score: getPairColorScore(
        jacket.shade || jacket.color,
        top.shade || top.color
      ),
      weight: 20,
    });
  }

  if (accessory && top) {
    scores.push({
      score: getPairColorScore(
        accessory.shade || accessory.color,
        top.shade || top.color
      ),
      weight: 5,
    });
  }

  if (isDress(top) && top && shoes) {
    return averageWeightedScores([
      {
        score: getPairColorScore(
          top.shade || top.color,
          shoes.shade || shoes.color
        ),
        weight: 60,
      },
      ...(jacket
        ? [
            {
              score: getPairColorScore(
                jacket.shade || jacket.color,
                top.shade || top.color
              ),
              weight: 30,
            },
          ]
        : []),
      ...(accessory
        ? [
            {
              score: getPairColorScore(
                accessory.shade ||
                  accessory.color,
                top.shade || top.color
              ),
              weight: 10,
            },
          ]
        : []),
    ]);
  }

  return averageWeightedScores(scores);
}

export function getColorCountScore(
  outfit: ColorEngineOutfit,
  style: StyleType = 'Minimal'
) {
  const colors = getValidColors(outfit);
  const uniqueColors = [...new Set(colors)];

  const count = uniqueColors.length;

  if (count === 0) return 45;
  if (count === 1) return 86;
  if (count === 2) return 100;
  if (count === 3) return 96;

  if (count === 4) {
    if (style === 'Streetwear') return 88;
    if (style === 'Sport') return 82;
    return 66;
  }

  if (style === 'Streetwear') return 64;

  return 38;
}

export function getLightDarkBalanceScore(
  outfit: ColorEngineOutfit,
  style: StyleType = 'Minimal'
) {
  const pieces = getOutfitPieces(outfit);

  const brightnessGroups = Object.values(pieces)
    .filter(Boolean)
    .map((item) =>
      getBrightnessGroup(
        item?.shade || item?.color
      )
    )
    .filter(
      (group) =>
        group !== 'unknown' &&
        group !== 'metallic'
    );

  if (brightnessGroups.length === 0) {
    return 55;
  }

  const lightCount = brightnessGroups.filter(
    (group) => group === 'light'
  ).length;

  const mediumCount = brightnessGroups.filter(
    (group) => group === 'medium'
  ).length;

  const darkCount = brightnessGroups.filter(
    (group) => group === 'dark'
  ).length;

  if (lightCount > 0 && darkCount > 0) {
    return 100;
  }

  if (
    mediumCount > 0 &&
    (lightCount > 0 || darkCount > 0)
  ) {
    return 91;
  }

  if (
    darkCount === brightnessGroups.length
  ) {
    if (
      style === 'Luxury' ||
      style === 'Classic'
    ) {
      return 88;
    }

    return 76;
  }

  if (
    lightCount === brightnessGroups.length
  ) {
    if (
      style === 'Minimal' ||
      style === 'Sport'
    ) {
      return 84;
    }

    return 72;
  }

  return 78;
}

export function getNeutralBalanceScore(
  outfit: ColorEngineOutfit
) {
  const colors = getValidColors(outfit);

  if (colors.length === 0) {
    return 50;
  }

  const neutralCount = colors.filter((color) =>
    NEUTRAL_COLORS.includes(color)
  ).length;

  const strongCount = colors.filter((color) =>
    STRONG_COLORS.includes(color)
  ).length;

  if (strongCount === 0) {
    return neutralCount > 0 ? 92 : 68;
  }

  if (
    strongCount === 1 &&
    neutralCount >= 1
  ) {
    return 100;
  }

  if (
    strongCount === 2 &&
    neutralCount >= 2
  ) {
    return 82;
  }

  if (strongCount >= 3) {
    return 42;
  }

  return 70;
}

export function getDistributionScore(
  outfit: ColorEngineOutfit
) {
  const {
    top,
    bottom,
    shoes,
    jacket,
    accessory,
  } = getOutfitPieces(outfit);

  const topColor = normalizeColor(
    top?.shade || top?.color
  );

  const bottomColor = normalizeColor(
    bottom?.shade || bottom?.color
  );

  const shoesColor = normalizeColor(
    shoes?.shade || shoes?.color
  );

  const jacketColor = normalizeColor(
    jacket?.shade || jacket?.color
  );

  const accessoryColor = normalizeColor(
    accessory?.shade || accessory?.color
  );

  let score = 68;

  if (
    shoesColor !== 'Unknown' &&
    accessoryColor !== 'Unknown' &&
    shoesColor === accessoryColor
  ) {
    score += 18;
  }

  if (
    jacketColor !== 'Unknown' &&
    shoesColor !== 'Unknown' &&
    jacketColor === shoesColor
  ) {
    score += 12;
  }

  if (
    topColor !== 'Unknown' &&
    shoesColor !== 'Unknown' &&
    topColor === shoesColor
  ) {
    score += 12;
  }

  if (
    bottomColor !== 'Unknown' &&
    jacketColor !== 'Unknown' &&
    bottomColor === jacketColor
  ) {
    score += 10;
  }

  const colors = getValidColors(outfit);
  const uniqueColors = [...new Set(colors)];

  if (
    uniqueColors.length >= 2 &&
    uniqueColors.length <= 3
  ) {
    score += 8;
  }

  if (uniqueColors.length >= 5) {
    score -= 28;
  }

  return clamp(score);
}

export function getContextColorScore(
  outfit: ColorEngineOutfit,
  options: ColorEngineOptions = {}
) {
  const colors = getValidColors(outfit);

  if (colors.length === 0) {
    return 55;
  }

  let score = 72;

  const lightCount = colors.filter((color) =>
    LIGHT_COLORS.includes(color)
  ).length;

  const darkCount = colors.filter((color) =>
    DARK_COLORS.includes(color)
  ).length;

  if (
    options.weather === 'Hot' ||
    options.season === 'Summer'
  ) {
    score += lightCount * 6;
    score -= darkCount * 2;
  }

  if (
    options.weather === 'Cold' ||
    options.season === 'Winter'
  ) {
    score += darkCount * 5;
  }

  if (options.weather === 'Rainy') {
    if (colors.includes('White')) {
      score -= 12;
    }

    if (
      colors.some((color) =>
        ['Black', 'Navy', 'Gray', 'Brown'].includes(
          color
        )
      )
    ) {
      score += 12;
    }
  }

  if (
    options.style === 'Minimal' ||
    options.style === 'Classic' ||
    options.style === 'Luxury'
  ) {
    const neutralCount = colors.filter((color) =>
      NEUTRAL_COLORS.includes(color)
    ).length;

    score += neutralCount * 4;
  }

  if (options.style === 'Streetwear') {
    const strongCount = colors.filter((color) =>
      STRONG_COLORS.includes(color)
    ).length;

    if (strongCount >= 1 && strongCount <= 2) {
      score += 10;
    }
  }

  if (options.style === 'Sport') {
    if (
      colors.some((color) =>
        ['Black', 'White', 'Gray', 'Blue'].includes(
          color
        )
      )
    ) {
      score += 10;
    }
  }

  return clamp(score);
}

export function calculateOutfitColorScore(
  outfit: ColorEngineOutfit,
  options: ColorEngineOptions = {}
): ColorEngineResult {
  const style = options.style || 'Minimal';

  const pairHarmony =
    getPairHarmonyScore(outfit);

  const colorCount =
    getColorCountScore(outfit, style);

  const lightDarkBalance =
    getLightDarkBalanceScore(outfit, style);

  const neutralBalance =
    getNeutralBalanceScore(outfit);

  const distribution =
    getDistributionScore(outfit);

  const context =
    getContextColorScore(outfit, options);

  const final = clamp(
    pairHarmony * 0.45 +
      colorCount * 0.15 +
      lightDarkBalance * 0.15 +
      neutralBalance * 0.1 +
      distribution * 0.1 +
      context * 0.05
  );

  const colors = getValidColors(outfit);
  const uniqueColors = [...new Set(colors)];

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (pairHarmony >= 90) {
    reasons.push(
      'The main outfit colors have excellent harmony.'
    );
  } else if (pairHarmony >= 80) {
    reasons.push(
      'The main outfit colors work well together.'
    );
  } else if (pairHarmony < 60) {
    warnings.push(
      'Some of the main outfit colors clash.'
    );
  }

  if (
    uniqueColors.length >= 2 &&
    uniqueColors.length <= 3
  ) {
    reasons.push(
      `The outfit uses a balanced ${uniqueColors.length}-color palette.`
    );
  }

  if (uniqueColors.length > 4) {
    warnings.push(
      'The outfit uses too many unrelated colors.'
    );
  }

  if (neutralBalance >= 90) {
    reasons.push(
      'Neutral colors keep the outfit balanced.'
    );
  } else if (neutralBalance < 55) {
    warnings.push(
      'The outfit contains too many strong colors.'
    );
  }

  if (lightDarkBalance >= 90) {
    reasons.push(
      'Light and dark tones are well balanced.'
    );
  }

  if (distribution >= 90) {
    reasons.push(
      'Shoes and accessories repeat colors from the outfit.'
    );
  }

  return {
    score: final,

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
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
  };
}