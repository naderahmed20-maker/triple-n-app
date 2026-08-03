// app/data/fashionEngine.ts
// Part 1/2

import {
  calculateOutfitColorScore,
} from './colorEngine';

import {
  OCCASION_RULES,
  SEASON_RULES,
  STYLE_RULES,
  WEATHER_RULES,
  type OccasionType,
  type SeasonType,
  type StyleType,
  type WeatherType,
} from './fashionRules';

export type FashionLanguage =
  | 'English'
  | 'Italian'
  | 'en'
  | 'it'
  | string;

export type FashionItem = {
  id?: string;

  image: string;

  category: string;

  subCategory?:
    | string
    | null;

  name?: string;

  color?: string;

  shade?: string;

  favorite?: boolean;
};

export type FashionOutfit = {
  top:
    | FashionItem
    | null;

  bottom:
    | FashionItem
    | null;

  pants?:
    | FashionItem
    | null;

  shoes:
    | FashionItem
    | null;

  jacket:
    | FashionItem
    | null;

  bag?:
    | FashionItem
    | null;

  cap?:
    | FashionItem
    | null;

  watch?:
    | FashionItem
    | null;

  accessory?:
    | FashionItem
    | null;
};

export type FashionEngineOptions = {
  style?: StyleType;

  occasion?: OccasionType;

  weather?: WeatherType;

  season?: SeasonType;

  language?:
    | FashionLanguage
    | null;

  minimumScore?: number;

  limit?: number;

  maxEvaluations?: number;

  excludeItemIds?: string[];
};

export type OutfitScoreBreakdown = {
  color: number;

  style: number;

  occasion: number;

  weather: number;

  season: number;

  accessory: number;

  favorite: number;

  final: number;
};

export type ScoredFashionOutfit = {
  outfit: FashionOutfit;

  score: number;

  breakdown:
    OutfitScoreBreakdown;

  accepted: boolean;

  reasons: string[];

  rejectionReasons:
    string[];
};

export type FashionEngineResult = {
  bestOutfit:
    | ScoredFashionOutfit
    | null;

  suitableOutfits:
    ScoredFashionOutfit[];

  suitableCount: number;

  evaluatedCount: number;

  minimumScore: number;

  message: string;
};

type ItemRole =
  | 'Tops'
  | 'Bottoms'
  | 'Shoes'
  | 'Jackets'
  | 'Dresses'
  | 'Accessories';

const DEFAULT_STYLE:
  StyleType =
    'Minimal';

const DEFAULT_MINIMUM_SCORE =
  70;

const DEFAULT_LIMIT =
  10;

const DEFAULT_MAX_EVALUATIONS =
  50_000;

const NEUTRAL_COLORS = [
  'Black',
  'White',
  'Gray',
  'Grey',
  'Beige',
  'Brown',
  'Navy',
  'Cream',
];

const LIGHT_COLORS = [
  'White',
  'Beige',
  'Cream',
  'Light Blue',
  'Gray',
  'Grey',
];

const COLOR_FAMILIES: Record<
  string,
  string[]
> = {
  Black: [
    'White',
    'Gray',
    'Grey',
    'Beige',
    'Brown',
    'Navy',
    'Red',
    'Blue',
    'Green',
  ],

  White: [
    'Black',
    'Gray',
    'Grey',
    'Beige',
    'Brown',
    'Navy',
    'Blue',
    'Green',
    'Red',
    'Pink',
    'Purple',
    'Yellow',
  ],

  Gray: [
    'Black',
    'White',
    'Beige',
    'Brown',
    'Navy',
    'Blue',
    'Green',
    'Pink',
  ],

  Grey: [
    'Black',
    'White',
    'Beige',
    'Brown',
    'Navy',
    'Blue',
    'Green',
    'Pink',
  ],

  Beige: [
    'Black',
    'White',
    'Brown',
    'Navy',
    'Blue',
    'Green',
    'Gray',
    'Grey',
  ],

  Brown: [
    'White',
    'Beige',
    'Cream',
    'Black',
    'Green',
    'Navy',
    'Blue',
  ],

  Navy: [
    'White',
    'Beige',
    'Brown',
    'Gray',
    'Grey',
    'Blue',
    'Red',
  ],

  Blue: [
    'White',
    'Black',
    'Gray',
    'Grey',
    'Beige',
    'Brown',
    'Navy',
  ],

  Green: [
    'White',
    'Black',
    'Beige',
    'Brown',
    'Gray',
    'Grey',
  ],

  Red: [
    'Black',
    'White',
    'Gray',
    'Grey',
    'Navy',
    'Beige',
  ],

  Pink: [
    'White',
    'Black',
    'Gray',
    'Grey',
    'Beige',
    'Navy',
  ],

  Purple: [
    'White',
    'Black',
    'Gray',
    'Grey',
    'Beige',
  ],

  Yellow: [
    'Black',
    'White',
    'Gray',
    'Grey',
    'Navy',
    'Blue',
  ],

  Orange: [
    'Black',
    'White',
    'Brown',
    'Navy',
    'Blue',
  ],
};

function clamp(
  value: number,
  min = 0,
  max = 100
) {
  return Math.max(
    min,

    Math.min(
      max,
      Math.round(
        value
      )
    )
  );
}

function normalizeText(
  value?:
    | string
    | null
) {
  return (
    value ||
    ''
  )
    .trim()
    .toLowerCase();
}

function isItalianLanguage(
  language?:
    | FashionLanguage
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

function translatedText(
  language:
    | FashionLanguage
    | null
    | undefined,

  english: string,

  italian: string
) {
  return isItalianLanguage(
    language
  )
    ? italian
    : english;
}

function getStyleLabel(
  style:
    StyleType,

  language?:
    | FashionLanguage
    | null
) {
  if (
    !isItalianLanguage(
      language
    )
  ) {
    return style;
  }

  switch (style) {
    case 'Minimal':
      return 'minimalista';

    case 'Classic':
      return 'classico';

    case 'Luxury':
      return 'lussuoso';

    case 'Streetwear':
      return 'streetwear';

    case 'Sport':
      return 'sportivo';

    default:
      return style;
  }
}

function normalizeColor(
  value?:
    | string
    | null
) {
  const color =
    (
      value ||
      'Black'
    ).trim();

  if (
    color.toLowerCase() ===
    'grey'
  ) {
    return 'Gray';
  }

  if (
    color.toLowerCase() ===
    'dark blue'
  ) {
    return 'Navy';
  }

  return color
    .split(' ')
    .map(
      (
        part
      ) =>
        part
          .charAt(0)
          .toUpperCase() +
        part
          .slice(1)
          .toLowerCase()
    )
    .join(' ');
}

function normalizeCategory(
  category?:
    | string
    | null
): ItemRole {
  const value =
    normalizeText(
      category
    );

  if (
    value ===
      'top' ||
    value ===
      'tops'
  ) {
    return 'Tops';
  }

  if (
    value ===
      'pants' ||
    value ===
      'shorts' ||
    value ===
      'skirts' ||
    value ===
      'bottoms'
  ) {
    return 'Bottoms';
  }

  if (
    value ===
      'shoes' ||
    value ===
      'heels' ||
    value ===
      'heel'
  ) {
    return 'Shoes';
  }

  if (
    value ===
      'jacket' ||
    value ===
      'jackets'
  ) {
    return 'Jackets';
  }

  if (
    value ===
      'dress' ||
    value ===
      'dresses'
  ) {
    return 'Dresses';
  }

  return 'Accessories';
}

function getItemSearchText(
  item?:
    | FashionItem
    | null
) {
  if (!item) {
    return '';
  }

  return [
    item.category,
    item.subCategory,
    item.name,
    item.color,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hasText(
  item:
    | FashionItem
    | null
    | undefined,

  values:
    string[]
) {
  const text =
    getItemSearchText(
      item
    );

  return values.some(
    (
      value
    ) =>
      text.includes(
        value
          .toLowerCase()
      )
  );
}

function isShorts(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'shorts',
      'short pants',
    ]
  );
}

function isSkirt(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'skirt',
      'skirts',
    ]
  );
}

function isDress(
  item?:
    | FashionItem
    | null
) {
  return (
    normalizeCategory(
      item?.category
    ) ===
    'Dresses'
  );
}

function isTShirt(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'tshirt',
      't-shirt',
      'tee',
    ]
  );
}

function isShirt(
  item?:
    | FashionItem
    | null
) {
  return (
    hasText(
      item,
      [
        'shirt',
      ]
    ) &&
    !isTShirt(
      item
    )
  );
}

function isPolo(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'polo',
    ]
  );
}

function isHoodie(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'hoodie',
    ]
  );
}

function isSweater(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'sweater',
    ]
  );
}

function isFormalBottom(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'formal',
    ]
  );
}

function isJeans(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'jeans',
      'denim',
    ]
  );
}

function isCargo(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'cargo',
    ]
  );
}

function isJoggers(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'joggers',
      'jogger',
      'sweatpants',
    ]
  );
}

function isSneakers(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'sneakers',
      'sneaker',
    ]
  );
}

function isBoots(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'boots',
      'boot',
    ]
  );
}

function isLoafers(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'loafers',
      'loafer',
    ]
  );
}

function isSandals(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'sandals',
      'sandal',
    ]
  );
}

function isCoat(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'coat',
    ]
  );
}

function isWatch(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'watch',
    ]
  );
}

function isCap(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'cap',
      'hat',
    ]
  );
}

function isBag(
  item?:
    | FashionItem
    | null
) {
  return hasText(
    item,
    [
      'bag',
      'bags',
      'handbag',
      'backpack',
    ]
  );
}

function getOutfitItems(
  outfit:
    FashionOutfit
) {
  const items = [
    outfit.top,
    outfit.bottom,
    outfit.pants,
    outfit.shoes,
    outfit.jacket,
    outfit.bag,
    outfit.cap,
    outfit.watch,
    outfit.accessory,
  ].filter(
    Boolean
  ) as FashionItem[];

  return items.filter(
    (
      item,
      index,
      allItems
    ) =>
      allItems.findIndex(
        (
          currentItem
        ) =>
          (
            currentItem.id ||
            currentItem.image
          ) ===
          (
            item.id ||
            item.image
          )
      ) ===
      index
  );
}

function getOutfitColors(
  outfit:
    FashionOutfit
) {
  return getOutfitItems(
    outfit
  ).map(
    (
      item
    ) =>
      normalizeColor(
        item.color
      )
  );
}

function getUniqueColors(
  outfit:
    FashionOutfit
) {
  return Array.from(
    new Set(
      getOutfitColors(
        outfit
      )
    )
  );
}

function getPairColorScore(
  first?:
    | string
    | null,

  second?:
    | string
    | null
) {
  const colorA =
    normalizeColor(
      first
    );

  const colorB =
    normalizeColor(
      second
    );

  if (
    colorA ===
    colorB
  ) {
    return 88;
  }

  if (
    NEUTRAL_COLORS.includes(
      colorA
    ) &&
    NEUTRAL_COLORS.includes(
      colorB
    )
  ) {
    return 95;
  }

  if (
    COLOR_FAMILIES[
      colorA
    ]?.includes(
      colorB
    )
  ) {
    return 92;
  }

  if (
    COLOR_FAMILIES[
      colorB
    ]?.includes(
      colorA
    )
  ) {
    return 92;
  }

  const riskyPairs = [
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

  const risky =
    riskyPairs.some(
      (
        [
          a,
          b,
        ]
      ) =>
        (
          colorA ===
            a &&
          colorB ===
            b
        ) ||
        (
          colorA ===
            b &&
          colorB ===
            a
        )
    );

  if (risky) {
    return 45;
  }

  return 70;
}

function getHardRejectionReasons(
  outfit:
    FashionOutfit,

  options:
    FashionEngineOptions
) {
  const reasons:
    string[] = [];

  const language =
    options.language;

  const style =
    options.style ||
    DEFAULT_STYLE;

  const occasion =
    options.occasion;

  const weather =
    options.weather;

  const season =
    options.season;

  const dressOutfit =
    isDress(
      outfit.top
    );

  if (!outfit.top) {
    reasons.push(
      translatedText(
        language,

        'Missing top or dress.',

        'Manca una parte superiore o un vestito.'
      )
    );
  }

  if (
    !dressOutfit &&
    !outfit.bottom
  ) {
    reasons.push(
      translatedText(
        language,

        'Missing bottom.',

        'Manca la parte inferiore.'
      )
    );
  }

  if (!outfit.shoes) {
    reasons.push(
      translatedText(
        language,

        'Missing shoes.',

        'Mancano le scarpe.'
      )
    );
  }

  if (
    style ===
    'Luxury'
  ) {
    if (
      isShorts(
        outfit.bottom
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Luxury outfits do not use shorts.',

          'Gli outfit di lusso non prevedono pantaloncini.'
        )
      );
    }

    if (
      isHoodie(
        outfit.top
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Hoodies are not suitable for the selected Luxury style.',

          'Le felpe con cappuccio non sono adatte allo stile di lusso selezionato.'
        )
      );
    }

    if (
      isCargo(
        outfit.bottom
      ) ||
      isJoggers(
        outfit.bottom
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Cargo and joggers are not suitable for Luxury outfits.',

          'I pantaloni cargo e sportivi non sono adatti agli outfit di lusso.'
        )
      );
    }

    if (
      isSandals(
        outfit.shoes
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Sandals are not suitable for Luxury outfits.',

          'I sandali non sono adatti agli outfit di lusso.'
        )
      );
    }
  }

  if (
    style ===
    'Classic'
  ) {
    if (
      isShorts(
        outfit.bottom
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Classic outfits do not use shorts.',

          'Gli outfit classici non prevedono pantaloncini.'
        )
      );
    }

    if (
      isCargo(
        outfit.bottom
      ) ||
      isJoggers(
        outfit.bottom
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Cargo and joggers are not suitable for Classic outfits.',

          'I pantaloni cargo e sportivi non sono adatti agli outfit classici.'
        )
      );
    }

    if (
      isHoodie(
        outfit.top
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Hoodies are not suitable for Classic outfits.',

          'Le felpe con cappuccio non sono adatte agli outfit classici.'
        )
      );
    }

    if (
      isSandals(
        outfit.shoes
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Sandals are not suitable for Classic outfits.',

          'I sandali non sono adatti agli outfit classici.'
        )
      );
    }
  }

  if (
    style ===
    'Sport'
  ) {
    if (
      outfit.jacket &&
      !hasText(
        outfit.jacket,
        [
          'sport',
        ]
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'This jacket is not suitable for a Sport outfit.',

          'Questa giacca non è adatta a un outfit sportivo.'
        )
      );
    }

    if (
      isLoafers(
        outfit.shoes
      ) ||
      isBoots(
        outfit.shoes
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Loafers and boots are not suitable for this Sport outfit.',

          'Mocassini e stivali non sono adatti a questo outfit sportivo.'
        )
      );
    }
  }

  if (
    occasion ===
    'Work'
  ) {
    if (
      isShorts(
        outfit.bottom
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Shorts are not suitable for Work.',

          'I pantaloncini non sono adatti al lavoro.'
        )
      );
    }

    if (
      isHoodie(
        outfit.top
      ) ||
      isTShirt(
        outfit.top
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'This top is too casual for Work.',

          'Questa parte superiore è troppo informale per il lavoro.'
        )
      );
    }

    if (
      isSandals(
        outfit.shoes
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Sandals are not suitable for Work.',

          'I sandali non sono adatti al lavoro.'
        )
      );
    }
  }

  if (
    occasion ===
    'Date'
  ) {
    if (
      isShorts(
        outfit.bottom
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Shorts are not suitable for this Date outfit.',

          'I pantaloncini non sono adatti a questo outfit per un appuntamento.'
        )
      );
    }

    if (
      isJoggers(
        outfit.bottom
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Joggers are too casual for this Date outfit.',

          'I pantaloni sportivi sono troppo informali per questo outfit da appuntamento.'
        )
      );
    }
  }

  if (
    occasion ===
      'Party' &&
    isJoggers(
      outfit.bottom
    )
  ) {
    reasons.push(
      translatedText(
        language,

        'Joggers are not suitable for this Party outfit.',

        'I pantaloni sportivi non sono adatti a questo outfit da festa.'
      )
    );
  }

  if (
    occasion ===
    'Sport'
  ) {
    if (
      !isSneakers(
        outfit.shoes
      ) &&
      !hasText(
        outfit.shoes,
        [
          'sport',
        ]
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Sport outfits require sneakers.',

          'Gli outfit sportivi richiedono delle sneakers.'
        )
      );
    }
  }

  if (
    occasion ===
    'Summer'
  ) {
    if (
      outfit.jacket
    ) {
      reasons.push(
        translatedText(
          language,

          'Summer outfits should not include a jacket.',

          'Gli outfit estivi non dovrebbero includere una giacca.'
        )
      );
    }

    if (
      isBoots(
        outfit.shoes
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Boots are not suitable for Summer.',

          'Gli stivali non sono adatti all’estate.'
        )
      );
    }
  }

  if (
    weather ===
    'Hot'
  ) {
    if (
      outfit.jacket
    ) {
      reasons.push(
        translatedText(
          language,

          'Hot weather outfits should not include a jacket.',

          'Gli outfit per il caldo non dovrebbero includere una giacca.'
        )
      );
    }

    if (
      isBoots(
        outfit.shoes
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Boots are not suitable for hot weather.',

          'Gli stivali non sono adatti al caldo.'
        )
      );
    }
  }

  if (
    weather ===
    'Rainy'
  ) {
    if (
      isSandals(
        outfit.shoes
      )
    ) {
      reasons.push(
        translatedText(
          language,

          'Sandals are not suitable for rainy weather.',

          'I sandali non sono adatti alla pioggia.'
        )
      );
    }
  }

  if (
    season ===
      'Summer' &&
    isCoat(
      outfit.jacket
    )
  ) {
    reasons.push(
      translatedText(
        language,

        'A coat is not suitable for Summer.',

        'Un cappotto non è adatto all’estate.'
      )
    );
  }

  return reasons;
}

function scoreStyle(
  outfit:
    FashionOutfit,

  style:
    StyleType,

  language?:
    | FashionLanguage
    | null
) {
  const rule =
    STYLE_RULES[
      style
    ];

  const reasons:
    string[] = [];

  let score =
    60;

  const colors =
    getOutfitColors(
      outfit
    );

  const uniqueColors =
    getUniqueColors(
      outfit
    );

  const preferredColorCount =
    colors.filter(
      (
        color
      ) =>
        rule
          .preferredColors
          .includes(
            color
          )
    ).length;

  const avoidedColorCount =
    colors.filter(
      (
        color
      ) =>
        rule
          .avoidColors
          .includes(
            color
          )
    ).length;

  score +=
    preferredColorCount *
    5;

  score -=
    avoidedColorCount *
    rule
      .penalties
      .wrongColor;

  if (
    uniqueColors.length <=
    rule.maxColors
  ) {
    score +=
      rule
        .bonuses
        .matchingColors;

    reasons.push(
      translatedText(
        language,

        `Uses ${uniqueColors.length} coordinated colors.`,

        `Utilizza ${uniqueColors.length} colori coordinati.`
      )
    );
  } else {
    score -=
      rule
        .penalties
        .tooManyColors;
  }

  if (
    outfit.jacket
  ) {
    score +=
      rule
        .bonuses
        .jacket;
  }

  const accessoryCount =
    [
      outfit.bag,
      outfit.cap,
      outfit.watch,
      outfit.accessory,
    ].filter(
      Boolean
    ).length;

  if (
    accessoryCount >
    0
  ) {
    score +=
      rule
        .bonuses
        .accessory;
  }

  if (
    style ===
    'Minimal'
  ) {
    if (
      uniqueColors.every(
        (
          color
        ) =>
          NEUTRAL_COLORS.includes(
            color
          )
      )
    ) {
      score +=
        20;

      reasons.push(
        translatedText(
          language,

          'Neutral colors support the Minimal style.',

          'I colori neutri valorizzano lo stile minimalista.'
        )
      );
    }

    if (
      isTShirt(
        outfit.top
      ) ||
      isShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      )
    ) {
      score +=
        10;
    }

    if (
      isJeans(
        outfit.bottom
      ) ||
      isFormalBottom(
        outfit.bottom
      )
    ) {
      score +=
        10;
    }

    if (
      isSneakers(
        outfit.shoes
      )
    ) {
      score +=
        8;
    }
  }

  if (
    style ===
    'Classic'
  ) {
    if (
      isShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      ) ||
      isSweater(
        outfit.top
      )
    ) {
      score +=
        22;

      reasons.push(
        translatedText(
          language,

          'The top supports a Classic outfit.',

          'La parte superiore valorizza un outfit classico.'
        )
      );
    }

    if (
      isFormalBottom(
        outfit.bottom
      ) ||
      isJeans(
        outfit.bottom
      )
    ) {
      score +=
        18;
    }

    if (
      isLoafers(
        outfit.shoes
      ) ||
      isBoots(
        outfit.shoes
      )
    ) {
      score +=
        20;
    }

    if (
      outfit.jacket
    ) {
      score +=
        12;
    }

    if (
      isWatch(
        outfit.watch
      ) ||
      isWatch(
        outfit.accessory
      )
    ) {
      score +=
        10;
    }
  }

  if (
    style ===
    'Luxury'
  ) {
    if (
      isShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      )
    ) {
      score +=
        25;

      reasons.push(
        translatedText(
          language,

          'Shirt or polo supports the Luxury style.',

          'La camicia o la polo valorizza lo stile di lusso.'
        )
      );
    }

    if (
      isFormalBottom(
        outfit.bottom
      )
    ) {
      score +=
        25;

      reasons.push(
        translatedText(
          language,

          'Formal bottoms strongly support Luxury.',

          'I pantaloni eleganti valorizzano fortemente lo stile di lusso.'
        )
      );
    } else if (
      isJeans(
        outfit.bottom
      )
    ) {
      score +=
        10;
    }

    if (
      isLoafers(
        outfit.shoes
      )
    ) {
      score +=
        25;

      reasons.push(
        translatedText(
          language,

          'Loafers strongly support Luxury.',

          'I mocassini valorizzano fortemente lo stile di lusso.'
        )
      );
    } else if (
      isBoots(
        outfit.shoes
      )
    ) {
      score +=
        15;
    } else if (
      isSneakers(
        outfit.shoes
      )
    ) {
      score -=
        8;
    }

    if (
      outfit.jacket
    ) {
      score +=
        20;

      reasons.push(
        translatedText(
          language,

          'Outerwear improves the Luxury outfit.',

          'Il capospalla migliora l’outfit di lusso.'
        )
      );
    }

    if (
      isWatch(
        outfit.watch
      ) ||
      isWatch(
        outfit.accessory
      ) ||
      isBag(
        outfit.bag
      ) ||
      isBag(
        outfit.accessory
      )
    ) {
      score +=
        15;
    }
  }

  if (
    style ===
    'Streetwear'
  ) {
    if (
      isHoodie(
        outfit.top
      ) ||
      isTShirt(
        outfit.top
      )
    ) {
      score +=
        22;
    }

    if (
      isCargo(
        outfit.bottom
      ) ||
      isJeans(
        outfit.bottom
      )
    ) {
      score +=
        22;
    }

    if (
      isSneakers(
        outfit.shoes
      )
    ) {
      score +=
        25;

      reasons.push(
        translatedText(
          language,

          'Sneakers strongly support Streetwear.',

          'Le sneakers valorizzano fortemente lo stile streetwear.'
        )
      );
    }

    if (
      isCap(
        outfit.cap
      ) ||
      isCap(
        outfit.accessory
      ) ||
      isBag(
        outfit.bag
      ) ||
      isBag(
        outfit.accessory
      )
    ) {
      score +=
        15;
    }
  }

  if (
    style ===
    'Sport'
  ) {
    if (
      isTShirt(
        outfit.top
      ) ||
      isHoodie(
        outfit.top
      )
    ) {
      score +=
        20;
    }

    if (
      isShorts(
        outfit.bottom
      ) ||
      isJoggers(
        outfit.bottom
      )
    ) {
      score +=
        25;

      reasons.push(
        translatedText(
          language,

          'The bottom supports a Sport outfit.',

          'La parte inferiore valorizza un outfit sportivo.'
        )
      );
    }

    if (
      isSneakers(
        outfit.shoes
      )
    ) {
      score +=
        30;

      reasons.push(
        translatedText(
          language,

          'Sneakers strongly support Sport.',

          'Le sneakers valorizzano fortemente lo stile sportivo.'
        )
      );
    }

    if (
      isCap(
        outfit.cap
      ) ||
      isCap(
        outfit.accessory
      )
    ) {
      score +=
        10;
    }
  }

  const mainPairScore =
    getPairColorScore(
      outfit.top?.color,
      outfit.bottom?.color
    );

  if (
    !isDress(
      outfit.top
    )
  ) {
    score +=
      (
        mainPairScore -
        70
      ) *
      0.25;
  }

  return {
    score:
      clamp(
        score
      ),

    reasons,
  };
}

function scoreOccasion(
  outfit:
    FashionOutfit,

  occasion?:
    OccasionType,

  language?:
    | FashionLanguage
    | null
) {
  if (!occasion) {
    return {
      score:
        75,

      reasons:
        [] as string[],
    };
  }

  const rule =
    OCCASION_RULES[
      occasion
    ];

  const reasons:
    string[] = [];

  let score =
    65;

  const colors =
    getOutfitColors(
      outfit
    );

  const matchingColors =
    colors.filter(
      (
        color
      ) =>
        rule
          .preferredColors
          .includes(
            color
          )
    ).length;

  score +=
    matchingColors *
    5;

  if (
    occasion ===
    'Casual'
  ) {
    if (
      isTShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      ) ||
      isHoodie(
        outfit.top
      )
    ) {
      score +=
        15;
    }

    if (
      isJeans(
        outfit.bottom
      ) ||
      isCargo(
        outfit.bottom
      ) ||
      isShorts(
        outfit.bottom
      )
    ) {
      score +=
        15;
    }

    if (
      isSneakers(
        outfit.shoes
      )
    ) {
      score +=
        15;
    }
  }

  if (
    occasion ===
    'Work'
  ) {
    if (
      isShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      )
    ) {
      score +=
        25;

      reasons.push(
        translatedText(
          language,

          'The top is suitable for Work.',

          'La parte superiore è adatta al lavoro.'
        )
      );
    }

    if (
      isFormalBottom(
        outfit.bottom
      )
    ) {
      score +=
        25;
    }

    if (
      isLoafers(
        outfit.shoes
      )
    ) {
      score +=
        20;
    }

    if (
      outfit.jacket
    ) {
      score +=
        10;
    }
  }

  if (
    occasion ===
    'Date'
  ) {
    if (
      isShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      ) ||
      isSweater(
        outfit.top
      )
    ) {
      score +=
        18;
    }

    if (
      isFormalBottom(
        outfit.bottom
      ) ||
      isJeans(
        outfit.bottom
      )
    ) {
      score +=
        18;
    }

    if (
      isLoafers(
        outfit.shoes
      ) ||
      isBoots(
        outfit.shoes
      )
    ) {
      score +=
        16;
    }

    if (
      isWatch(
        outfit.watch
      ) ||
      isWatch(
        outfit.accessory
      )
    ) {
      score +=
        12;
    }
  }

  if (
    occasion ===
    'Party'
  ) {
    if (
      isShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      ) ||
      isTShirt(
        outfit.top
      )
    ) {
      score +=
        15;
    }

    if (
      isJeans(
        outfit.bottom
      ) ||
      isFormalBottom(
        outfit.bottom
      )
    ) {
      score +=
        15;
    }

    if (
      isSneakers(
        outfit.shoes
      ) ||
      isLoafers(
        outfit.shoes
      )
    ) {
      score +=
        15;
    }
  }

  if (
    occasion ===
    'Sport'
  ) {
    if (
      isTShirt(
        outfit.top
      ) ||
      isHoodie(
        outfit.top
      )
    ) {
      score +=
        20;
    }

    if (
      isShorts(
        outfit.bottom
      ) ||
      isJoggers(
        outfit.bottom
      )
    ) {
      score +=
        25;
    }

    if (
      isSneakers(
        outfit.shoes
      )
    ) {
      score +=
        25;
    }
  }

  if (
    occasion ===
    'Summer'
  ) {
    if (
      isTShirt(
        outfit.top
      ) ||
      isPolo(
        outfit.top
      )
    ) {
      score +=
        15;
    }

    if (
      isShorts(
        outfit.bottom
      ) ||
      isSkirt(
        outfit.bottom
      )
    ) {
      score +=
        20;
    }

    if (
      isSneakers(
        outfit.shoes
      ) ||
      isSandals(
        outfit.shoes
      )
    ) {
      score +=
        15;
    }

    if (
      !outfit.jacket
    ) {
      score +=
        10;
    }
  }

  return {
    score:
      clamp(
        score
      ),

    reasons,
  };
}

function scoreWeather(
  outfit:
    FashionOutfit,

  weather?:
    WeatherType,

  language?:
    | FashionLanguage
    | null
) {
  if (!weather) {
    return {
      score:
        75,

      reasons:
        [] as string[],
    };
  }

  const rule =
    WEATHER_RULES[
      weather
    ];

  const reasons:
    string[] = [];

  let score =
    65;

  const colors =
    getOutfitColors(
      outfit
    );

  score +=
    colors.filter(
      (
        color
      ) =>
        rule
          .preferredColors
          .includes(
            color
          )
    ).length *
    5;

  score -=
    colors.filter(
      (
        color
      ) =>
        rule
          .forbiddenColors
          .includes(
            color
          )
    ).length *
    10;

  if (
    weather ===
    'Hot'
  ) {
    if (
      !outfit.jacket
    ) {
      score +=
        20;
    }

    if (
      isShorts(
        outfit.bottom
      ) ||
      isSkirt(
        outfit.bottom
      )
    ) {
      score +=
        15;
    }

    if (
      isSandals(
        outfit.shoes
      ) ||
      isSneakers(
        outfit.shoes
      )
    ) {
      score +=
        10;
    }
  }

  if (
    weather ===
    'Mild'
  ) {
    score +=
      15;

    if (
      outfit.jacket &&
      !isCoat(
        outfit.jacket
      )
    ) {
      score +=
        5;
    }
  }

  if (
    weather ===
    'Rainy'
  ) {
    if (
      outfit.jacket
    ) {
      score +=
        15;

      reasons.push(
        translatedText(
          language,

          'The jacket is useful for rainy weather.',

          'La giacca è utile in caso di pioggia.'
        )
      );
    } else {
      score +=
        5;
    }

    if (
      isBoots(
        outfit.shoes
      )
    ) {
      score +=
        20;

      reasons.push(
        translatedText(
          language,

          'Boots are suitable for rainy weather.',

          'Gli stivali sono adatti alla pioggia.'
        )
      );
    }

    if (
      isSandals(
        outfit.shoes
      )
    ) {
      score -=
        40;
    }
  }

  return {
    score:
      clamp(
        score
      ),

    reasons,
  };
}

function scoreSeason(
  outfit:
    FashionOutfit,

  season?:
    SeasonType
) {
  if (!season) {
    return {
      score:
        75,

      reasons:
        [] as string[],
    };
  }

  const rule =
    SEASON_RULES[
      season
    ];

  const reasons:
    string[] = [];

  let score =
    65;

  const colors =
    getOutfitColors(
      outfit
    );

  score +=
    colors.filter(
      (
        color
      ) =>
        rule
          .preferredColors
          .includes(
            color
          )
    ).length *
    5;

  score -=
    colors.filter(
      (
        color
      ) =>
        rule
          .forbiddenColors
          .includes(
            color
          )
    ).length *
    10;

  if (
    season ===
    'Summer'
  ) {
    if (
      !outfit.jacket
    ) {
      score +=
        20;
    }

    if (
      isShorts(
        outfit.bottom
      ) ||
      isSkirt(
        outfit.bottom
      )
    ) {
      score +=
        15;
    }

    if (
      colors.some(
        (
          color
        ) =>
          LIGHT_COLORS.includes(
            color
          )
      )
    ) {
      score +=
        10;
    }
  }

  if (
    season ===
    'Spring'
  ) {
    if (
      colors.some(
        (
          color
        ) =>
          [
            'White',
            'Blue',
            'Green',
            'Beige',
            'Gray',
          ].includes(
            color
          )
      )
    ) {
      score +=
        15;
    }

    if (
      outfit.jacket &&
      !isCoat(
        outfit.jacket
      )
    ) {
      score +=
        5;
    }
  }

  return {
    score:
      clamp(
        score
      ),

    reasons,
  };
}
// app/data/fashionEngine.ts
// Part 2/2

function normalizeAccessoryValue(
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

function getAccessorySlot(
  item?:
    | FashionItem
    | null
):
  | 'bag'
  | 'cap'
  | 'watch'
  | 'other' {
  if (!item) {
    return 'other';
  }

  const category =
    normalizeAccessoryValue(
      item.category
    );

  const subCategory =
    normalizeAccessoryValue(
      item.subCategory
    );

  const name =
    normalizeAccessoryValue(
      item.name
    );

  const combinedValue =
    [
      category,
      subCategory,
      name,
    ]
      .filter(Boolean)
      .join(' ');

  if (
    category ===
      'bags' ||
    category ===
      'bag' ||
    subCategory ===
      'bag' ||
    subCategory ===
      'bags' ||
    subCategory ===
      'handbag' ||
    subCategory ===
      'backpack' ||
    combinedValue.includes(
      'handbag'
    ) ||
    combinedValue.includes(
      'backpack'
    )
  ) {
    return 'bag';
  }

  if (
    subCategory ===
      'cap' ||
    subCategory ===
      'hat' ||
    combinedValue.includes(
      'cap'
    ) ||
    combinedValue.includes(
      'hat'
    )
  ) {
    return 'cap';
  }

  if (
    subCategory ===
      'watch' ||
    combinedValue.includes(
      'watch'
    )
  ) {
    return 'watch';
  }

  return 'other';
}

function getAccessoryPools(
  items:
    FashionItem[]
) {
  const bags:
    FashionItem[] = [];

  const caps:
    FashionItem[] = [];

  const watches:
    FashionItem[] = [];

  const others:
    FashionItem[] = [];

  for (
    const item of
    items
  ) {
    const role =
      normalizeCategory(
        item.category
      );

    if (
      role !==
      'Accessories'
    ) {
      continue;
    }

    const slot =
      getAccessorySlot(
        item
      );

    if (
      slot ===
      'bag'
    ) {
      bags.push(
        item
      );

      continue;
    }

    if (
      slot ===
      'cap'
    ) {
      caps.push(
        item
      );

      continue;
    }

    if (
      slot ===
      'watch'
    ) {
      watches.push(
        item
      );

      continue;
    }

    others.push(
      item
    );
  }

  return {
    bags,

    caps,

    watches,

    others,
  };
}

function pickAccessoryItem(
  items:
    FashionItem[],

  seed:
    number
) {
  if (
    items.length ===
    0
  ) {
    return null;
  }

  const safeSeed =
    Math.abs(
      Math.floor(
        seed
      )
    );

  return (
    items[
      safeSeed %
        items.length
    ] ||
    null
  );
}

function addAccessorySlots(
  outfit:
    FashionOutfit,

  wardrobeItems:
    FashionItem[],

  seed:
    number
): FashionOutfit {
  const {
    bags,
    caps,
    watches,
    others,
  } =
    getAccessoryPools(
      wardrobeItems
    );

  const legacySlot =
    getAccessorySlot(
      outfit.accessory
    );

  const bag =
    outfit.bag ||
    (
      legacySlot ===
      'bag'
        ? outfit.accessory
        : null
    ) ||
    pickAccessoryItem(
      bags,
      seed
    );

  const cap =
    outfit.cap ||
    (
      legacySlot ===
      'cap'
        ? outfit.accessory
        : null
    ) ||
    pickAccessoryItem(
      caps,
      seed +
        1
    );

  const watch =
    outfit.watch ||
    (
      legacySlot ===
      'watch'
        ? outfit.accessory
        : null
    ) ||
    pickAccessoryItem(
      watches,
      seed +
        2
    );

  const accessory =
    legacySlot ===
      'other'
      ? (
          outfit.accessory ||
          pickAccessoryItem(
            others,
            seed +
              3
          )
        )
      : pickAccessoryItem(
          others,
          seed +
            3
        );

  return {
    ...outfit,

    bag,

    cap,

    watch,

    accessory,
  };
}

function scoreAccessory(
  outfit:
    FashionOutfit,

  style:
    StyleType
) {
  const accessories = [
    outfit.bag,
    outfit.cap,
    outfit.watch,
    outfit.accessory,
  ].filter(
    Boolean
  ) as FashionItem[];

  if (
    accessories.length ===
    0
  ) {
    return 65;
  }

  let score =
    75;

  const hasWatch =
    accessories.some(
      (
        item
      ) =>
        isWatch(
          item
        )
    );

  const hasCap =
    accessories.some(
      (
        item
      ) =>
        isCap(
          item
        )
    );

  const hasBag =
    accessories.some(
      (
        item
      ) =>
        isBag(
          item
        )
    );

  if (
    (
      style ===
        'Luxury' ||
      style ===
        'Classic'
    ) &&
    hasWatch
  ) {
    score +=
      20;
  }

  if (
    (
      style ===
        'Luxury' ||
      style ===
        'Classic'
    ) &&
    hasBag
  ) {
    score +=
      10;
  }

  if (
    style ===
      'Streetwear' &&
    (
      hasCap ||
      hasBag
    )
  ) {
    score +=
      20;
  }

  if (
    style ===
      'Sport' &&
    hasCap
  ) {
    score +=
      20;
  }

  if (
    accessories.length >
    3
  ) {
    score -=
      10;
  }

  return clamp(
    score
  );
}

function scoreFavorites(
  outfit:
    FashionOutfit
) {
  const items =
    getOutfitItems(
      outfit
    );

  if (
    items.length ===
    0
  ) {
    return 0;
  }

  const favoriteCount =
    items.filter(
      (
        item
      ) =>
        item.favorite
    ).length;

  return clamp(
    (
      favoriteCount /
      items.length
    ) *
      100
  );
}

export function evaluateFashionOutfit(
  outfit:
    FashionOutfit,

  options:
    FashionEngineOptions =
      {}
): ScoredFashionOutfit {
  const style =
    options.style ||
    DEFAULT_STYLE;

  const rejectionReasons =
    getHardRejectionReasons(
      outfit,
      options
    );

  const colorResult =
    calculateOutfitColorScore(
      outfit,
      {
        style,

        weather:
          options.weather,

        season:
          options.season,

        language:
          options.language,
      }
    );

  const colorScore =
    colorResult.score;

  const styleResult =
    scoreStyle(
      outfit,
      style,
      options.language
    );

  const occasionResult =
    scoreOccasion(
      outfit,
      options.occasion,
      options.language
    );

  const weatherResult =
    scoreWeather(
      outfit,
      options.weather,
      options.language
    );

  const seasonResult =
    scoreSeason(
      outfit,
      options.season
    );

  const accessoryScore =
    scoreAccessory(
      outfit,
      style
    );

  const favoriteScore =
    scoreFavorites(
      outfit
    );

  const finalScore =
    clamp(
      colorScore *
        0.3 +
      styleResult.score *
        0.25 +
      occasionResult.score *
        0.15 +
      weatherResult.score *
        0.1 +
      seasonResult.score *
        0.1 +
      accessoryScore *
        0.05 +
      favoriteScore *
        0.05
    );

  const minimumScore =
    options.minimumScore ??
    STYLE_RULES[
      style
    ].minimumScore ??
    DEFAULT_MINIMUM_SCORE;

  const accepted =
    rejectionReasons.length ===
      0 &&
    finalScore >=
      minimumScore;

  const reasons = [
    ...colorResult.reasons,

    ...styleResult.reasons,

    ...occasionResult.reasons,

    ...weatherResult.reasons,

    ...seasonResult.reasons,
  ];

  return {
    outfit,

    score:
      finalScore,

    breakdown: {
      color:
        colorScore,

      style:
        styleResult.score,

      occasion:
        occasionResult.score,

      weather:
        weatherResult.score,

      season:
        seasonResult.score,

      accessory:
        accessoryScore,

      favorite:
        favoriteScore,

      final:
        finalScore,
    },

    accepted,

    reasons:
      Array.from(
        new Set(
          reasons
        )
      ),

    rejectionReasons:
      Array.from(
        new Set(
          rejectionReasons
        )
      ),
  };
}

function groupWardrobeItems(
  items:
    FashionItem[]
) {
  const tops:
    FashionItem[] = [];

  const dresses:
    FashionItem[] = [];

  const bottoms:
    FashionItem[] = [];

  const shoes:
    FashionItem[] = [];

  const jackets:
    FashionItem[] = [];

  const accessories:
    FashionItem[] = [];

  for (
    const item of
    items
  ) {
    const role =
      normalizeCategory(
        item.category
      );

    if (
      role ===
      'Tops'
    ) {
      tops.push(
        item
      );

      continue;
    }

    if (
      role ===
      'Dresses'
    ) {
      dresses.push(
        item
      );

      continue;
    }

    if (
      role ===
      'Bottoms'
    ) {
      bottoms.push(
        item
      );

      continue;
    }

    if (
      role ===
      'Shoes'
    ) {
      shoes.push(
        item
      );

      continue;
    }

    if (
      role ===
      'Jackets'
    ) {
      jackets.push(
        item
      );

      continue;
    }

    accessories.push(
      item
    );
  }

  return {
    tops,

    dresses,

    bottoms,

    shoes,

    jackets,

    accessories,
  };
}

function getItemIdentity(
  item?:
    | FashionItem
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
  outfit:
    FashionOutfit
) {
  return [
    getItemIdentity(
      outfit.top
    ),

    getItemIdentity(
      outfit.bottom
    ),

    getItemIdentity(
      outfit.shoes
    ),

    getItemIdentity(
      outfit.jacket
    ),

    getItemIdentity(
      outfit.bag
    ),

    getItemIdentity(
      outfit.cap
    ),

    getItemIdentity(
      outfit.watch
    ),

    getItemIdentity(
      outfit.accessory
    ),
  ].join('|');
}

function insertRankedOutfit(
  ranked:
    ScoredFashionOutfit[],

  candidate:
    ScoredFashionOutfit,

  limit:
    number
) {
  ranked.push(
    candidate
  );

  ranked.sort(
    (
      first,
      second
    ) =>
      second.score -
      first.score
  );

  if (
    ranked.length >
    limit
  ) {
    ranked.length =
      limit;
  }
}

export function rankFashionOutfits(
  items:
    FashionItem[],

  options:
    FashionEngineOptions =
      {}
) {
  const limit =
    Math.max(
      1,

      options.limit ||
        DEFAULT_LIMIT
    );

  const maxEvaluations =
    Math.max(
      100,

      options.maxEvaluations ||
        DEFAULT_MAX_EVALUATIONS
    );

  const excluded =
    new Set(
      options.excludeItemIds ||
        []
    );

  const availableItems =
    items.filter(
      (
        item
      ) =>
        !item.id ||
        !excluded.has(
          item.id
        )
    );

  const {
    tops,
    dresses,
    bottoms,
    shoes,
    jackets,
    accessories,
  } =
    groupWardrobeItems(
      availableItems
    );

  const jacketOptions:
    Array<
      | FashionItem
      | null
    > = [
      null,
      ...jackets,
    ];

  const accessoryOptions:
    Array<
      | FashionItem
      | null
    > = [
      null,
      ...accessories,
    ];

  const ranked:
    ScoredFashionOutfit[] =
    [];

  const identities =
    new Set<string>();

  let evaluatedCount =
    0;

  let suitableCount =
    0;

  function evaluateCandidate(
    outfit:
      FashionOutfit
  ) {
    if (
      evaluatedCount >=
      maxEvaluations
    ) {
      return false;
    }

    const outfitWithAccessories =
      addAccessorySlots(
        outfit,
        availableItems,
        evaluatedCount
      );

    const identity =
      getOutfitIdentity(
        outfitWithAccessories
      );

    if (
      identities.has(
        identity
      )
    ) {
      return true;
    }

    identities.add(
      identity
    );

    evaluatedCount +=
      1;

    const result =
      evaluateFashionOutfit(
        outfitWithAccessories,
        options
      );

    if (
      result.accepted
    ) {
      suitableCount +=
        1;

      insertRankedOutfit(
        ranked,
        result,
        limit
      );
    }

    return true;
  }

  outerRegular:
  for (
    const top of
    tops
  ) {
    for (
      const bottom of
      bottoms
    ) {
      for (
        const shoe of
        shoes
      ) {
        for (
          const jacket of
          jacketOptions
        ) {
          for (
            const accessory of
            accessoryOptions
          ) {
            const shouldContinue =
              evaluateCandidate({
                top,

                bottom,

                pants:
                  bottom,

                shoes:
                  shoe,

                jacket,

                bag:
                  null,

                cap:
                  null,

                watch:
                  null,

                accessory,
              });

            if (
              !shouldContinue
            ) {
              break outerRegular;
            }
          }
        }
      }
    }
  }

  outerDress:
  for (
    const dress of
    dresses
  ) {
    for (
      const shoe of
      shoes
    ) {
      for (
        const jacket of
        jacketOptions
      ) {
        for (
          const accessory of
          accessoryOptions
        ) {
          const shouldContinue =
            evaluateCandidate({
              top:
                dress,

              bottom:
                null,

              pants:
                null,

              shoes:
                shoe,

              jacket,

              bag:
                null,

              cap:
                null,

              watch:
                null,

              accessory,
            });

          if (
            !shouldContinue
          ) {
            break outerDress;
          }
        }
      }
    }
  }

  return {
    ranked,

    suitableCount,

    evaluatedCount,
  };
}

function buildResultMessage(
  style:
    StyleType,

  suitableCount:
    number,

  language?:
    | FashionLanguage
    | null
) {
  const styleLabel =
    getStyleLabel(
      style,
      language
    );

  if (
    suitableCount ===
    0
  ) {
    return translatedText(
      language,

      `You don't currently have enough suitable pieces to create a high-quality ${style} outfit.`,

      `Al momento non hai abbastanza capi adatti per creare un outfit ${styleLabel} di alta qualità.`
    );
  }

  if (
    suitableCount ===
    1
  ) {
    return translatedText(
      language,

      `You currently have 1 suitable ${style} outfit.`,

      `Al momento hai 1 outfit ${styleLabel} adatto.`
    );
  }

  return translatedText(
    language,

    `You currently have ${suitableCount} suitable ${style} outfits.`,

    `Al momento hai ${suitableCount} outfit ${styleLabel} adatti.`
  );
}

export function getFashionOutfitResult(
  items:
    FashionItem[],

  options:
    FashionEngineOptions =
      {}
): FashionEngineResult {
  const style =
    options.style ||
    DEFAULT_STYLE;

  const minimumScore =
    options.minimumScore ??
    STYLE_RULES[
      style
    ].minimumScore ??
    DEFAULT_MINIMUM_SCORE;

  const {
    ranked,
    suitableCount,
    evaluatedCount,
  } =
    rankFashionOutfits(
      items,
      {
        ...options,

        style,

        minimumScore,
      }
    );

  return {
    bestOutfit:
      ranked[0] ||
      null,

    suitableOutfits:
      ranked,

    suitableCount,

    evaluatedCount,

    minimumScore,

    message:
      buildResultMessage(
        style,
        suitableCount,
        options.language
      ),
  };
}

export function pickBestFashionOutfit(
  items:
    FashionItem[],

  options:
    FashionEngineOptions =
      {}
) {
  return getFashionOutfitResult(
    items,
    options
  ).bestOutfit;
}

export function pickRandomSuitableOutfit(
  items:
    FashionItem[],

  options:
    FashionEngineOptions =
      {}
) {
  const result =
    getFashionOutfitResult(
      items,
      {
        ...options,

        limit:
          options.limit ||
          20,
      }
    );

  if (
    result
      .suitableOutfits
      .length ===
    0
  ) {
    return null;
  }

  const pool =
    result
      .suitableOutfits
      .slice(
        0,

        Math.min(
          10,

          result
            .suitableOutfits
            .length
        )
      );

  const randomIndex =
    Math.floor(
      Math.random() *
        pool.length
    );

  return (
    pool[
      randomIndex
    ] ||
    null
  );
}

export function pickSmartFashionOutfit(
  items:
    FashionItem[],

  style:
    StyleType,

  weather?:
    WeatherType,

  season?:
    SeasonType,

  language?:
    FashionLanguage
) {
  return getFashionOutfitResult(
    items,
    {
      style,

      weather,

      season,

      language,

      limit:
        10,
    }
  );
}

export function pickOccasionFashionOutfit(
  items:
    FashionItem[],

  occasion:
    OccasionType,

  style:
    StyleType =
      DEFAULT_STYLE,

  weather?:
    WeatherType,

  season?:
    SeasonType,

  language?:
    FashionLanguage
) {
  return getFashionOutfitResult(
    items,
    {
      style,

      occasion,

      weather,

      season,

      language,

      minimumScore:
        Math.max(
          STYLE_RULES[
            style
          ].minimumScore,

          OCCASION_RULES[
            occasion
          ].minimumScore
        ),

      limit:
        10,
    }
  );
}

export function pickWeatherFashionOutfit(
  items:
    FashionItem[],

  weather:
    WeatherType,

  style:
    StyleType =
      DEFAULT_STYLE,

  season?:
    SeasonType,

  language?:
    FashionLanguage
) {
  return getFashionOutfitResult(
    items,
    {
      style,

      weather,

      season,

      language,

      limit:
        10,
    }
  );
}