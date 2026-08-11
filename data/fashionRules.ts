// app/data/fashionRules.ts

export const FASHION_RULES_VERSION =
  1;

export type StyleType =
  | 'Minimal'
  | 'Classic'
  | 'Luxury'
  | 'Streetwear'
  | 'Sport';

export type OccasionType =
  | 'Casual'
  | 'Work'
  | 'Date'
  | 'Party'
  | 'Sport'
  | 'Summer';

export type WeatherType =
  | 'Hot'
  | 'Mild'
  | 'Rainy';

export type SeasonType =
  | 'Spring'
  | 'Summer';

export type ClothingCategory =
  | 'Tops'
  | 'Bottoms'
  | 'Shoes'
  | 'Jackets'
  | 'Dresses'
  | 'Accessories';

export type AccessoryType =
  | 'Watch'
  | 'Glasses'
  | 'Cap'
  | 'Bag'
  | 'Other';

export interface StyleRule {
  requiredCategories:
    ClothingCategory[];

  preferredCategories:
    ClothingCategory[];

  forbiddenCategories:
    ClothingCategory[];

  preferredAccessoryTypes:
    AccessoryType[];

  preferredColors:
    string[];

  avoidColors:
    string[];

  preferredWeather:
    WeatherType[];

  preferredSeason:
    SeasonType[];

  jacketRequired:
    boolean;

  maxColors:
    number;

  minimumScore:
    number;

  priority:
    number;

  bonuses: {
    jacket:
      number;

    accessory:
      number;

    favorite:
      number;

    matchingColors:
      number;

    perfectFit:
      number;
  };

  penalties: {
    wrongColor:
      number;

    tooManyColors:
      number;

    forbiddenCategory:
      number;

    missingCategory:
      number;

    wrongSeason:
      number;

    wrongWeather:
      number;
  };
}

export interface OccasionRule {
  requiredCategories:
    ClothingCategory[];

  forbiddenCategories:
    ClothingCategory[];

  jacketRequired:
    boolean;

  preferredStyles:
    StyleType[];

  preferredColors:
    string[];

  minimumScore:
    number;
}

export interface WeatherRule {
  jacketRequired:
    boolean;

  preferredColors:
    string[];

  forbiddenColors:
    string[];

  preferredCategories:
    ClothingCategory[];

  forbiddenCategories:
    ClothingCategory[];

  bonus:
    number;
}

export interface SeasonRule {
  preferredColors:
    string[];

  forbiddenColors:
    string[];

  preferredCategories:
    ClothingCategory[];

  bonus:
    number;
}

export const CATEGORY_RULES = {
  Tops: {
    weight: 30,
    required: true,
  },

  Bottoms: {
    weight: 30,
    required: true,
  },

  Shoes: {
    weight: 25,
    required: true,
  },

  Jackets: {
    weight: 10,
    required: false,
  },

  Dresses: {
    weight: 40,
    required: false,
  },

  Accessories: {
    weight: 5,
    required: false,
  },
} as const;

export const SCORE_RULES = {
  colorWeight: 30,

  styleWeight: 20,

  occasionWeight: 15,

  weatherWeight: 10,

  seasonWeight: 10,

  preferenceWeight: 10,

  accessoryWeight: 5,

  favoriteBonus: 5,

  perfectScore: 100,

  minimumOverallScore: 75,
} as const;

export const STYLE_RULES: Record<
  StyleType,
  StyleRule
> = {
  Minimal: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    preferredCategories: [
      'Accessories',
    ],

    forbiddenCategories: [],

    preferredAccessoryTypes: [
      'Watch',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Beige',
      'Brown',
      'Navy',
    ],

    avoidColors: [
      'Yellow',
      'Orange',
      'Pink',
      'Purple',
    ],

    preferredWeather: [
      'Hot',
      'Mild',
      'Rainy',
    ],

    preferredSeason: [
      'Spring',
      'Summer',
    ],

    jacketRequired:
      false,

    maxColors:
      3,

    minimumScore:
      78,

    priority:
      5,

    bonuses: {
      jacket: 4,

      accessory: 8,

      favorite: 5,

      matchingColors: 15,

      perfectFit: 20,
    },

    penalties: {
      wrongColor: 15,

      tooManyColors: 25,

      forbiddenCategory: 45,

      missingCategory: 40,

      wrongSeason: 8,

      wrongWeather: 10,
    },
  },

  Classic: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    preferredCategories: [
      'Jackets',
      'Accessories',
    ],

    forbiddenCategories: [],

    preferredAccessoryTypes: [
      'Watch',
      'Bag',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Navy',
      'Brown',
      'Beige',
    ],

    avoidColors: [
      'Pink',
      'Orange',
      'Yellow',
      'Purple',
    ],

    preferredWeather: [
      'Mild',
      'Rainy',
    ],

    preferredSeason: [
      'Spring',
      'Summer',
    ],

    jacketRequired:
      false,

    maxColors:
      3,

    minimumScore:
      82,

    priority:
      7,

    bonuses: {
      jacket: 18,

      accessory: 12,

      favorite: 5,

      matchingColors: 20,

      perfectFit: 25,
    },

    penalties: {
      wrongColor: 20,

      tooManyColors: 30,

      forbiddenCategory: 50,

      missingCategory: 40,

      wrongSeason: 12,

      wrongWeather: 15,
    },
  },

  Luxury: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    preferredCategories: [
      'Jackets',
      'Accessories',
    ],

    forbiddenCategories: [],

    preferredAccessoryTypes: [
      'Watch',
      'Bag',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Navy',
      'Brown',
      'Beige',
    ],

    avoidColors: [
      'Yellow',
      'Orange',
      'Pink',
      'Purple',
      'Green',
    ],

    preferredWeather: [
      'Mild',
      'Rainy',
    ],

    preferredSeason: [
      'Spring',
      'Summer',
    ],

    jacketRequired:
      false,

    maxColors:
      3,

    minimumScore:
      85,

    priority:
      10,

    bonuses: {
      jacket: 25,

      accessory: 18,

      favorite: 8,

      matchingColors: 25,

      perfectFit: 30,
    },

    penalties: {
      wrongColor: 25,

      tooManyColors: 35,

      forbiddenCategory: 55,

      missingCategory: 45,

      wrongSeason: 18,

      wrongWeather: 20,
    },
  },

  Streetwear: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    preferredCategories: [
      'Jackets',
      'Accessories',
    ],

    forbiddenCategories: [],

    preferredAccessoryTypes: [
      'Cap',
      'Bag',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Green',
      'Blue',
      'Red',
    ],

    avoidColors: [],

    preferredWeather: [
      'Hot',
      'Mild',
      'Rainy',
    ],

    preferredSeason: [
      'Spring',
      'Summer',
    ],

    jacketRequired:
      false,

    maxColors:
      5,

    minimumScore:
      72,

    priority:
      6,

    bonuses: {
      jacket: 10,

      accessory: 15,

      favorite: 5,

      matchingColors: 15,

      perfectFit: 18,
    },

    penalties: {
      wrongColor: 8,

      tooManyColors: 10,

      forbiddenCategory: 35,

      missingCategory: 25,

      wrongSeason: 8,

      wrongWeather: 10,
    },
  },

  Sport: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    preferredCategories: [
      'Accessories',
    ],

    forbiddenCategories: [
      'Jackets',
    ],

    preferredAccessoryTypes: [
      'Cap',
    ],

    preferredColors: [
      'Black',
      'White',
      'Blue',
      'Gray',
    ],

    avoidColors: [
      'Brown',
      'Purple',
    ],

    preferredWeather: [
      'Hot',
      'Mild',
    ],

    preferredSeason: [
      'Spring',
      'Summer',
    ],

    jacketRequired:
      false,

    maxColors:
      4,

    minimumScore:
      72,

    priority:
      5,

    bonuses: {
      jacket: -10,

      accessory: 8,

      favorite: 5,

      matchingColors: 15,

      perfectFit: 18,
    },

    penalties: {
      wrongColor: 10,

      tooManyColors: 15,

      forbiddenCategory: 45,

      missingCategory: 30,

      wrongSeason: 10,

      wrongWeather: 12,
    },
  },
};

export const OCCASION_RULES: Record<
  OccasionType,
  OccasionRule
> = {
  Casual: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    forbiddenCategories: [],

    jacketRequired:
      false,

    preferredStyles: [
      'Minimal',
      'Streetwear',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Blue',
      'Green',
      'Brown',
      'Beige',
    ],

    minimumScore:
      68,
  },

  Work: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    forbiddenCategories: [],

    jacketRequired:
      false,

    preferredStyles: [
      'Classic',
      'Luxury',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Navy',
      'Brown',
      'Beige',
    ],

    minimumScore:
      80,
  },

  Date: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    forbiddenCategories: [],

    jacketRequired:
      false,

    preferredStyles: [
      'Luxury',
      'Classic',
      'Minimal',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Navy',
      'Brown',
      'Beige',
      'Red',
    ],

    minimumScore:
      80,
  },

  Party: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    forbiddenCategories: [],

    jacketRequired:
      false,

    preferredStyles: [
      'Luxury',
      'Streetwear',
    ],

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Red',
      'Navy',
    ],

    minimumScore:
      78,
  },

  Sport: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    forbiddenCategories: [
      'Jackets',
    ],

    jacketRequired:
      false,

    preferredStyles: [
      'Sport',
    ],

    preferredColors: [
      'Black',
      'White',
      'Blue',
      'Gray',
    ],

    minimumScore:
      70,
  },

  Summer: {
    requiredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    forbiddenCategories: [
      'Jackets',
    ],

    jacketRequired:
      false,

    preferredStyles: [
      'Minimal',
      'Streetwear',
      'Sport',
    ],

    preferredColors: [
      'White',
      'Beige',
      'Blue',
      'Gray',
      'Green',
    ],

    minimumScore:
      70,
  },
};

export const WEATHER_RULES: Record<
  WeatherType,
  WeatherRule
> = {
  Hot: {
    jacketRequired:
      false,

    preferredColors: [
      'White',
      'Beige',
      'Blue',
      'Gray',
      'Green',
    ],

    forbiddenColors: [],

    preferredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    forbiddenCategories: [
      'Jackets',
    ],

    bonus:
      15,
  },

  Mild: {
    jacketRequired:
      false,

    preferredColors: [
      'Black',
      'White',
      'Gray',
      'Brown',
      'Beige',
      'Blue',
    ],

    forbiddenColors: [],

    preferredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
      'Jackets',
    ],

    forbiddenCategories: [],

    bonus:
      10,
  },

  Rainy: {
    jacketRequired:
      false,

    preferredColors: [
      'Black',
      'Gray',
      'Brown',
      'Navy',
    ],

    forbiddenColors: [
      'White',
    ],

    preferredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
      'Jackets',
    ],

    forbiddenCategories: [],

    bonus:
      25,
  },
};

export const SEASON_RULES: Record<
  SeasonType,
  SeasonRule
> = {
  Spring: {
    preferredColors: [
      'White',
      'Blue',
      'Green',
      'Gray',
      'Beige',
    ],

    forbiddenColors: [],

    preferredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
      'Jackets',
    ],

    bonus:
      10,
  },

  Summer: {
    preferredColors: [
      'White',
      'Beige',
      'Blue',
      'Gray',
      'Green',
    ],

    forbiddenColors: [],

    preferredCategories: [
      'Tops',
      'Bottoms',
      'Shoes',
    ],

    bonus:
      15,
  },
};