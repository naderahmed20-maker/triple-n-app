// app/data/outfitRules.ts

import type {
  AppWeatherContext,
} from './appContext';

import {
  evaluateFashionOutfit,
  type FashionEngineResult,
  type FashionItem,
  type FashionOutfit,
  getFashionOutfitResult,
} from './fashionEngine';

import type {
  SeasonType,
  StyleType,
  WeatherType,
} from './fashionRules';

import {
  fashionColors,
} from './fashionColors';

export type WardrobeItem =
  FashionItem & {
    shade?: string;

    createdAt?: number;
  };

export type Outfit = {
  top:
    | WardrobeItem
    | null;

  bottom:
    | WardrobeItem
    | null;

  shoes:
    | WardrobeItem
    | null;

  jacket:
    | WardrobeItem
    | null;

  bag?:
    | WardrobeItem
    | null;

  cap?:
    | WardrobeItem
    | null;

  watch?:
    | WardrobeItem
    | null;

  accessory:
    | WardrobeItem
    | null;
};

export type OutfitRulesLanguage =
  | 'English'
  | 'Italian'
  | 'en'
  | 'it'
  | string;

const EMPTY_OUTFIT:
  Outfit = {
  top: null,

  bottom: null,

  shoes: null,

  jacket: null,

  bag: null,

  cap: null,

  watch: null,

  accessory: null,
};

const VALID_STYLES:
  StyleType[] = [
  'Minimal',
  'Classic',
  'Luxury',
  'Streetwear',
  'Sport',
];

const VALID_SEASONS:
  SeasonType[] = [
  'Spring',
  'Summer',
];

export function colorsMatch(
  color1?: string,
  color2?: string
) {
  if (
    !color1 ||
    !color2
  ) {
    return false;
  }

  const normalizedColor1 =
    color1
      .trim()
      .toLowerCase();

  const normalizedColor2 =
    color2
      .trim()
      .toLowerCase();

  if (
    normalizedColor1 ===
    normalizedColor2
  ) {
    return true;
  }

  const exactKey =
    Object.keys(
      fashionColors
    ).find(
      (key) =>
        key
          .toLowerCase() ===
        normalizedColor1
    ) as
      | keyof typeof fashionColors
      | undefined;

  if (!exactKey) {
    return false;
  }

  const rules =
    fashionColors[
      exactKey
    ];

  return (
    rules.matches as
      readonly string[]
  ).some(
    (match) =>
      match
        .toLowerCase() ===
      normalizedColor2
  );
}

function normalizeStyle(
  value?:
    | string
    | null
): StyleType {
  const normalizedValue =
    value
      ?.trim()
      .toLowerCase();

  const match =
    VALID_STYLES.find(
      (style) =>
        style
          .toLowerCase() ===
        normalizedValue
    );

  return (
    match ||
    'Minimal'
  );
}

function normalizeSeason(
  value?:
    | string
    | null
):
  | SeasonType
  | undefined {
  const normalizedValue =
    value
      ?.trim()
      .toLowerCase();

  return VALID_SEASONS.find(
    (season) =>
      season
        .toLowerCase() ===
      normalizedValue
  );
}

function getWeatherType(
  context?:
    | AppWeatherContext
    | null
):
  | WeatherType
  | undefined {
  if (!context) {
    return undefined;
  }

  const weather =
    (
      context.weather ||
      ''
    )
      .trim()
      .toLowerCase();

  if (
    weather ===
      'rainy' ||
    weather ===
      'rain' ||
    weather.includes(
      'rain'
    ) ||
    weather.includes(
      'storm'
    ) ||
    weather.includes(
      'drizzle'
    ) ||
    weather.includes(
      'shower'
    ) ||
    weather.includes(
      'thunder'
    )
  ) {
    return 'Rainy';
  }

  if (
    weather ===
      'hot' ||
    context.temperature >=
      28
  ) {
    return 'Hot';
  }

  return 'Mild';
}

function toFashionOutfit(
  outfit?:
    | Outfit
    | null
): FashionOutfit {
  return {
    top:
      outfit?.top ||
      null,

    bottom:
      outfit?.bottom ||
      null,

    pants:
      outfit?.bottom ||
      null,

    shoes:
      outfit?.shoes ||
      null,

    jacket:
      outfit?.jacket ||
      null,

    bag:
      outfit?.bag ||
      null,

    cap:
      outfit?.cap ||
      null,

    watch:
      outfit?.watch ||
      null,

    accessory:
      outfit?.accessory ||
      null,
  };
}

function fromFashionOutfit(
  outfit?:
    | FashionOutfit
    | null
): Outfit {
  if (!outfit) {
    return {
      ...EMPTY_OUTFIT,
    };
  }

  return {
    top:
      (
        outfit.top ||
        null
      ) as
        | WardrobeItem
        | null,

    bottom:
      (
        outfit.bottom ||
        outfit.pants ||
        null
      ) as
        | WardrobeItem
        | null,

    shoes:
      (
        outfit.shoes ||
        null
      ) as
        | WardrobeItem
        | null,

    jacket:
      (
        outfit.jacket ||
        null
      ) as
        | WardrobeItem
        | null,

    bag:
      (
        outfit.bag ||
        null
      ) as
        | WardrobeItem
        | null,

    cap:
      (
        outfit.cap ||
        null
      ) as
        | WardrobeItem
        | null,

    watch:
      (
        outfit.watch ||
        null
      ) as
        | WardrobeItem
        | null,

    accessory:
      (
        outfit.accessory ||
        null
      ) as
        | WardrobeItem
        | null,
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
  items:
    WardrobeItem[],

  context?:
    | AppWeatherContext
    | null,

  stylePreference =
    'Minimal',

  language:
    OutfitRulesLanguage =
      'English'
): FashionEngineResult {
  const style =
    normalizeStyle(
      stylePreference
    );

  const weather =
    getWeatherType(
      context
    );

  const season =
    normalizeSeason(
      context?.season
    );

  return getFashionOutfitResult(
    items as FashionItem[],

    {
      style,

      weather,

      season,

      language,

      limit:
        20,

      maxEvaluations:
        50000,
    }
  );
}

/**
 * للتوافق مع الشاشات القديمة.
 * لو مفيش طقم مناسب ترجع Outfit فاضي بدل طقم سيئ.
 */
export function pickBestOutfit(
  items:
    WardrobeItem[],

  context?:
    | AppWeatherContext
    | null,

  stylePreference =
    'Minimal',

  language:
    OutfitRulesLanguage =
      'English'
): Outfit {
  const result =
    getBestOutfitResult(
      items,
      context,
      stylePreference,
      language
    );

  return fromFashionOutfit(
    result
      .bestOutfit
      ?.outfit ||
      null
  );
}

function getWardrobeItemIdentity(
  item?:
    | WardrobeItem
    | null
) {
  if (!item) {
    return 'none';
  }

  return (
    item.id ||
    item.image ||
    `${item.category}-${item.subCategory}-${item.name}`
  );
}

function getOutfitIdentity(
  outfit?:
    | Outfit
    | null
) {
  if (!outfit) {
    return '';
  }

  return [
    getWardrobeItemIdentity(
      outfit.top
    ),

    getWardrobeItemIdentity(
      outfit.bottom
    ),

    getWardrobeItemIdentity(
      outfit.shoes
    ),

    getWardrobeItemIdentity(
      outfit.jacket
    ),

    getWardrobeItemIdentity(
      outfit.bag
    ),

    getWardrobeItemIdentity(
      outfit.cap
    ),

    getWardrobeItemIdentity(
      outfit.watch
    ),

    getWardrobeItemIdentity(
      outfit.accessory
    ),
  ].join('|');
}

/**
 * خاصة بزر Generate / Regenerate في الـBuilder.
 *
 * تختار طقمًا عشوائيًا من أفضل الأطقم المناسبة،
 * وتحاول عدم تكرار الطقم الظاهر حاليًا.
 *
 * لو المستخدم لا يملك إلا طقمًا واحدًا مناسبًا،
 * ترجع نفس الطقم بدل إظهار رسالة خاطئة.
 */
export function pickDifferentOutfit(
  items:
    WardrobeItem[],

  currentOutfit?:
    | Outfit
    | null,

  context?:
    | AppWeatherContext
    | null,

  stylePreference =
    'Minimal',

  language:
    OutfitRulesLanguage =
      'English'
): Outfit {
  const result =
    getBestOutfitResult(
      items,
      context,
      stylePreference,
      language
    );

  if (
    result
      .suitableOutfits
      .length ===
    0
  ) {
    return {
      ...EMPTY_OUTFIT,
    };
  }

  const currentIdentity =
    getOutfitIdentity(
      currentOutfit
    );

  const differentOutfits =
    result
      .suitableOutfits
      .filter(
        (
          resultItem
        ) => {
          const candidate =
            fromFashionOutfit(
              resultItem.outfit
            );

          return (
            getOutfitIdentity(
              candidate
            ) !==
            currentIdentity
          );
        }
      );

  const availablePool =
    differentOutfits
      .length >
    0
      ? differentOutfits
      : result
          .suitableOutfits;

  const pool =
    availablePool.slice(
      0,
      Math.min(
        10,
        availablePool.length
      )
    );

  const randomIndex =
    Math.floor(
      Math.random() *
        pool.length
    );

  return fromFashionOutfit(
    pool[
      randomIndex
    ]?.outfit ||
      null
  );
}

export function getColorMatchScore(
  outfit?:
    | Outfit
    | null
) {
  if (
    !outfit?.top ||
    !outfit.shoes
  ) {
    return 0;
  }

  const result =
    evaluateFashionOutfit(
      toFashionOutfit(
        outfit
      ),

      {
        style:
          'Minimal',

        minimumScore:
          0,
      }
    );

  return result
    .breakdown
    .color;
}

export function getStyleMatchScore(
  outfit?:
    | Outfit
    | null,

  stylePreference =
    'Minimal'
) {
  if (
    !outfit?.top ||
    !outfit.shoes
  ) {
    return 0;
  }

  const style =
    normalizeStyle(
      stylePreference
    );

  const result =
    evaluateFashionOutfit(
      toFashionOutfit(
        outfit
      ),

      {
        style,

        minimumScore:
          0,
      }
    );

  return result
    .breakdown
    .style;
}

export function getWeatherMatchScore(
  outfit?:
    | Outfit
    | null,

  context?:
    | AppWeatherContext
    | null
) {
  if (
    !outfit?.top ||
    !outfit.shoes
  ) {
    return 0;
  }

  const result =
    evaluateFashionOutfit(
      toFashionOutfit(
        outfit
      ),

      {
        style:
          'Minimal',

        weather:
          getWeatherType(
            context
          ),

        season:
          normalizeSeason(
            context?.season
          ),

        minimumScore:
          0,
      }
    );

  return result
    .breakdown
    .weather;
}

export function getPreferenceMatchScore(
  outfit?:
    | Outfit
    | null,

  stylePreference =
    'Minimal'
) {
  if (
    !outfit?.top ||
    !outfit.shoes
  ) {
    return 0;
  }

  const style =
    normalizeStyle(
      stylePreference
    );

  const result =
    evaluateFashionOutfit(
      toFashionOutfit(
        outfit
      ),

      {
        style,

        minimumScore:
          0,
      }
    );

  return result
    .breakdown
    .style;
}

export function getOutfitTotalScore(
  outfit?:
    | Outfit
    | null,

  context?:
    | AppWeatherContext
    | null,

  stylePreference =
    'Minimal'
) {
  if (
    !outfit?.top ||
    !outfit.shoes
  ) {
    return 0;
  }

  const style =
    normalizeStyle(
      stylePreference
    );

  const result =
    evaluateFashionOutfit(
      toFashionOutfit(
        outfit
      ),

      {
        style,

        weather:
          getWeatherType(
            context
          ),

        season:
          normalizeSeason(
            context?.season
          ),

        minimumScore:
          0,
      }
    );

  return result.score;
}

export function hasCompleteOutfit(
  outfit?:
    | Outfit
    | null
) {
  if (
    !outfit?.top ||
    !outfit.shoes
  ) {
    return false;
  }

  const isDress =
    outfit.top.category ===
      'Dresses' ||
    outfit.top.category ===
      'Dress';

  return (
    isDress ||
    Boolean(
      outfit.bottom
    )
  );
}