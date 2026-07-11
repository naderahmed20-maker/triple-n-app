// app/data/outfitRules.ts

import type { AppWeatherContext } from './appContext';

import {
  evaluateFashionOutfit,
  FashionEngineResult,
  FashionItem,
  FashionOutfit,
  getFashionOutfitResult,
} from './fashionEngine';

import {
  SeasonType,
  StyleType,
  WeatherType,
} from './fashionRules';

import { fashionColors } from './fashionColors';

export type WardrobeItem = FashionItem & {
  shade?: string;
  createdAt?: number;
};

export type Outfit = {
  top: WardrobeItem | null;
  bottom: WardrobeItem | null;
  shoes: WardrobeItem | null;
  jacket: WardrobeItem | null;
  accessory: WardrobeItem | null;
};

const EMPTY_OUTFIT: Outfit = {
  top: null,
  bottom: null,
  shoes: null,
  jacket: null,
  accessory: null,
};

const VALID_STYLES: StyleType[] = [
  'Minimal',
  'Classic',
  'Luxury',
  'Streetwear',
  'Sport',
];

const VALID_SEASONS: SeasonType[] = [
  'Spring',
  'Summer',
  'Autumn',
  'Winter',
];

export function colorsMatch(
  color1?: string,
  color2?: string
) {
  if (!color1 || !color2) return false;

  if (
    color1.trim().toLowerCase() ===
    color2.trim().toLowerCase()
  ) {
    return true;
  }

  const exactKey = Object.keys(fashionColors).find(
    (key) =>
      key.toLowerCase() === color1.trim().toLowerCase()
  ) as keyof typeof fashionColors | undefined;

  if (!exactKey) return false;

  const rules = fashionColors[exactKey];

  return (rules.matches as readonly string[]).some(
    (match) =>
      match.toLowerCase() ===
      color2.trim().toLowerCase()
  );
}

function normalizeStyle(
  value?: string | null
): StyleType {
  const match = VALID_STYLES.find(
    (style) =>
      style.toLowerCase() ===
      value?.trim().toLowerCase()
  );

  return match || 'Minimal';
}

function normalizeSeason(
  value?: string | null
): SeasonType | undefined {
  return VALID_SEASONS.find(
    (season) =>
      season.toLowerCase() ===
      value?.trim().toLowerCase()
  );
}

function getWeatherType(
  context?: AppWeatherContext | null
): WeatherType | undefined {
  if (!context) return undefined;

  const weather = context.weather
    ?.trim()
    .toLowerCase();

  if (
    weather === 'rainy' ||
    weather === 'rain' ||
    weather.includes('rain')
  ) {
    return 'Rainy';
  }

  if (
    weather === 'cold' ||
    context.temperature <= 14
  ) {
    return 'Cold';
  }

  if (
    weather === 'hot' ||
    context.temperature >= 28
  ) {
    return 'Hot';
  }

  return 'Mild';
}

function toFashionOutfit(
  outfit?: Outfit | null
): FashionOutfit {
  return {
    top: outfit?.top || null,
    bottom: outfit?.bottom || null,
    pants: outfit?.bottom || null,
    shoes: outfit?.shoes || null,
    jacket: outfit?.jacket || null,
    accessory: outfit?.accessory || null,
  };
}

function fromFashionOutfit(
  outfit?: FashionOutfit | null
): Outfit {
  if (!outfit) {
    return { ...EMPTY_OUTFIT };
  }

  return {
    top: outfit.top as WardrobeItem | null,
    bottom:
      (outfit.bottom || outfit.pants || null) as
        | WardrobeItem
        | null,
    shoes: outfit.shoes as WardrobeItem | null,
    jacket: outfit.jacket as WardrobeItem | null,
    accessory:
      outfit.accessory as WardrobeItem | null,
  };
}

/**
 * ترجع نتيجة المحرك كاملة:
 * - أفضل طقم
 * - عدد الأطقم المناسبة
 * - رسالة واضحة
 * - تفاصيل التقييم
 */
export function getBestOutfitResult(
  items: WardrobeItem[],
  context?: AppWeatherContext | null,
  stylePreference = 'Minimal'
): FashionEngineResult {
  const style = normalizeStyle(stylePreference);
  const weather = getWeatherType(context);
  const season = normalizeSeason(context?.season);

  return getFashionOutfitResult(
    items as FashionItem[],
    {
      style,
      weather,
      season,
      limit: 20,
      maxEvaluations: 50000,
    }
  );
}

/**
 * للتوافق مع الشاشات القديمة.
 * لو مفيش طقم مناسب ترجع Outfit فاضي بدل طقم سيئ.
 */
export function pickBestOutfit(
  items: WardrobeItem[],
  context?: AppWeatherContext | null,
  stylePreference = 'Minimal'
): Outfit {
  const result = getBestOutfitResult(
    items,
    context,
    stylePreference
  );

  return fromFashionOutfit(
    result.bestOutfit?.outfit || null
  );
}

export function getColorMatchScore(
  outfit?: Outfit | null
) {
  if (!outfit?.top || !outfit.shoes) {
    return 0;
  }

  const result = evaluateFashionOutfit(
    toFashionOutfit(outfit),
    {
      style: 'Minimal',
      minimumScore: 0,
    }
  );

  return result.breakdown.color;
}

export function getStyleMatchScore(
  outfit?: Outfit | null,
  stylePreference = 'Minimal'
) {
  if (!outfit?.top || !outfit.shoes) {
    return 0;
  }

  const style = normalizeStyle(stylePreference);

  const result = evaluateFashionOutfit(
    toFashionOutfit(outfit),
    {
      style,
      minimumScore: 0,
    }
  );

  return result.breakdown.style;
}

export function getWeatherMatchScore(
  outfit?: Outfit | null,
  context?: AppWeatherContext | null
) {
  if (!outfit?.top || !outfit.shoes) {
    return 0;
  }

  const result = evaluateFashionOutfit(
    toFashionOutfit(outfit),
    {
      style: 'Minimal',
      weather: getWeatherType(context),
      season: normalizeSeason(context?.season),
      minimumScore: 0,
    }
  );

  return result.breakdown.weather;
}

export function getPreferenceMatchScore(
  outfit?: Outfit | null,
  stylePreference = 'Minimal'
) {
  if (!outfit?.top || !outfit.shoes) {
    return 0;
  }

  const style = normalizeStyle(stylePreference);

  const result = evaluateFashionOutfit(
    toFashionOutfit(outfit),
    {
      style,
      minimumScore: 0,
    }
  );

  return result.breakdown.style;
}

export function getOutfitTotalScore(
  outfit?: Outfit | null,
  context?: AppWeatherContext | null,
  stylePreference = 'Minimal'
) {
  if (!outfit?.top || !outfit.shoes) {
    return 0;
  }

  const style = normalizeStyle(stylePreference);

  const result = evaluateFashionOutfit(
    toFashionOutfit(outfit),
    {
      style,
      weather: getWeatherType(context),
      season: normalizeSeason(context?.season),
      minimumScore: 0,
    }
  );

  return result.score;
}

export function hasCompleteOutfit(
  outfit?: Outfit | null
) {
  if (!outfit?.top || !outfit.shoes) {
    return false;
  }

  const isDress =
    outfit.top.category === 'Dresses' ||
    outfit.top.category === 'Dress';

  return isDress || Boolean(outfit.bottom);
}