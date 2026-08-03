export type WardrobeType =
  | 'male'
  | 'female';

export type ClothingSeason =
  | 'Summer'
  | 'Autumn'
  | 'Winter';

export type ClothingRole =
  | 'UpperBody'
  | 'LowerBody'
  | 'FullBody'
  | 'Footwear'
  | 'Outerwear'
  | 'Bag'
  | 'Headwear'
  | 'Watch'
  | 'Accessory';

export type ClothingStyle =
  | 'Casual'
  | 'Minimal'
  | 'Classic'
  | 'Luxury'
  | 'Streetwear'
  | 'Sport'
  | 'Elegant'
  | 'Business'
  | 'SmartCasual';

export type ClothingOccasion =
  | 'Casual'
  | 'Work'
  | 'Party'
  | 'Sport'
  | 'Date'
  | 'Summer'
  | 'Winter';

export type AccessoryType =
  | 'Backpack'
  | 'Handbag'
  | 'Cap'
  | 'Watch';

export type TopType =
  | 'TShirt'
  | 'Shirt'
  | 'Polo'
  | 'Hoodie'
  | 'Sweater'
  | 'Blouse'
  | 'TankTop'
  | 'CropTop'
  | 'LongSleeve'
  | 'Turtleneck'
  | 'Cardigan'
  | 'SportsTop';

export type PantsType =
  | 'Jeans'
  | 'Cargo'
  | 'Formal'
  | 'Joggers'
  | 'WideLeg'
  | 'StraightLeg'
  | 'SlimFit'
  | 'Chinos'
  | 'Leggings'
  | 'Flared'
  | 'Culottes';

export type ShortsType =
  | 'DenimShorts'
  | 'CargoShorts'
  | 'SportShorts'
  | 'LinenShorts'
  | 'CasualShorts'
  | 'TailoredShorts'
  | 'CyclingShorts';

export type SkirtType =
  | 'MiniSkirt'
  | 'MidiSkirt'
  | 'MaxiSkirt'
  | 'PleatedSkirt'
  | 'PencilSkirt'
  | 'DenimSkirt'
  | 'AlineSkirt'
  | 'WrapSkirt';

export type DressType =
  | 'MiniDress'
  | 'MidiDress'
  | 'MaxiDress'
  | 'CasualDress'
  | 'FormalDress'
  | 'EveningDress'
  | 'BodyconDress'
  | 'ShirtDress'
  | 'SummerDress'
  | 'CocktailDress'
  | 'SweaterDress';

export type ShoesType =
  | 'Sneakers'
  | 'Boots'
  | 'Loafers'
  | 'Sandals'
  | 'RunningShoes'
  | 'OxfordShoes'
  | 'ChelseaBoots'
  | 'AnkleBoots'
  | 'Slides'
  | 'FormalShoes';

export type HeelsType =
  | 'Pumps'
  | 'Stilettos'
  | 'BlockHeels'
  | 'KittenHeels'
  | 'PlatformHeels'
  | 'HeeledBoots'
  | 'WedgeHeels';

export type JacketType =
  | 'Jacket'
  | 'Coat'
  | 'Blazer'
  | 'DenimJacket'
  | 'LeatherJacket'
  | 'Bomber'
  | 'Puffer'
  | 'TrenchCoat'
  | 'RainJacket'
  | 'Overcoat'
  | 'Vest';

export type ClothingSubCategory =
  | AccessoryType
  | TopType
  | PantsType
  | ShortsType
  | SkirtType
  | DressType
  | ShoesType
  | HeelsType
  | JacketType;

export type ClothingCategory =
  | 'All'
  | 'Tops'
  | 'Pants'
  | 'Shorts'
  | 'Shoes'
  | 'Jackets'
  | 'Accessories'
  | 'Dresses'
  | 'Skirts'
  | 'Heels'
  | 'Bags';

export type ClothingKnowledge = {
  category:
    ClothingCategory;

  subCategory:
    string | null;

  role:
    ClothingRole;

  defaultSeasons:
    ClothingSeason[];

  styles:
    ClothingStyle[];

  occasions:
    ClothingOccasion[];

  warmth:
    1 | 2 | 3 | 4 | 5;

  formality:
    1 | 2 | 3 | 4 | 5;

  isLayer:
    boolean;

  requiresUpperBody:
    boolean;

  requiresLowerBody:
    boolean;

  replacesUpperAndLower:
    boolean;
};

export type ClothingTranslationKey =
  | 'clothing.category.all'
  | 'clothing.category.tops'
  | 'clothing.category.pants'
  | 'clothing.category.shorts'
  | 'clothing.category.shoes'
  | 'clothing.category.jackets'
  | 'clothing.category.accessories'
  | 'clothing.category.dresses'
  | 'clothing.category.skirts'
  | 'clothing.category.heels'
  | 'clothing.category.bags'
  | 'clothing.topType.tShirt'
  | 'clothing.topType.shirt'
  | 'clothing.topType.polo'
  | 'clothing.topType.hoodie'
  | 'clothing.topType.sweater'
  | 'clothing.pantsType.jeans'
  | 'clothing.pantsType.cargo'
  | 'clothing.pantsType.formal'
  | 'clothing.pantsType.joggers'
  | 'clothing.shoesType.sneakers'
  | 'clothing.shoesType.boots'
  | 'clothing.shoesType.loafers'
  | 'clothing.shoesType.sandals'
  | 'clothing.jacketType.jacket'
  | 'clothing.jacketType.coat'
  | 'clothing.accessoryType.backpack'
  | 'clothing.accessoryType.handbag'
  | 'clothing.accessoryType.cap'
  | 'clothing.accessoryType.watch';

export const WARDROBE_TYPE_KEY =
  'wardrobeType';

export const CLOTHING_SEASONS:
  ClothingSeason[] = [
  'Summer',
  'Autumn',
  'Winter',
];

export const CLOTHING_CATEGORIES: Record<
  WardrobeType,
  ClothingCategory[]
> = {
  male: [
    'All',
    'Tops',
    'Pants',
    'Shorts',
    'Shoes',
    'Jackets',
    'Accessories',
  ],

  female: [
    'All',
    'Tops',
    'Pants',
    'Shorts',
    'Dresses',
    'Skirts',
    'Jackets',
    'Heels',
    'Shoes',
    'Bags',
    'Accessories',
  ],
};

export const TOP_TYPES: Record<
  WardrobeType,
  TopType[]
> = {
  male: [
    'TShirt',
    'Shirt',
    'Polo',
    'Hoodie',
    'Sweater',
    'LongSleeve',
    'Turtleneck',
    'Cardigan',
    'TankTop',
    'SportsTop',
  ],

  female: [
    'TShirt',
    'Shirt',
    'Blouse',
    'Polo',
    'Hoodie',
    'Sweater',
    'TankTop',
    'CropTop',
    'LongSleeve',
    'Turtleneck',
    'Cardigan',
    'SportsTop',
  ],
};

export const PANTS_TYPES: Record<
  WardrobeType,
  PantsType[]
> = {
  male: [
    'Jeans',
    'Cargo',
    'Formal',
    'Joggers',
    'StraightLeg',
    'SlimFit',
    'Chinos',
    'WideLeg',
  ],

  female: [
    'Jeans',
    'Formal',
    'Joggers',
    'Cargo',
    'WideLeg',
    'StraightLeg',
    'SlimFit',
    'Leggings',
    'Flared',
    'Culottes',
    'Chinos',
  ],
};

export const SHORTS_TYPES: Record<
  WardrobeType,
  ShortsType[]
> = {
  male: [
    'DenimShorts',
    'CargoShorts',
    'SportShorts',
    'LinenShorts',
    'CasualShorts',
    'TailoredShorts',
  ],

  female: [
    'DenimShorts',
    'CargoShorts',
    'SportShorts',
    'LinenShorts',
    'CasualShorts',
    'TailoredShorts',
    'CyclingShorts',
  ],
};

export const SKIRT_TYPES:
  SkirtType[] = [
  'MiniSkirt',
  'MidiSkirt',
  'MaxiSkirt',
  'PleatedSkirt',
  'PencilSkirt',
  'DenimSkirt',
  'AlineSkirt',
  'WrapSkirt',
];

export const DRESS_TYPES:
  DressType[] = [
  'MiniDress',
  'MidiDress',
  'MaxiDress',
  'CasualDress',
  'FormalDress',
  'EveningDress',
  'BodyconDress',
  'ShirtDress',
  'SummerDress',
  'CocktailDress',
  'SweaterDress',
];

export const SHOES_TYPES: Record<
  WardrobeType,
  ShoesType[]
> = {
  male: [
    'Sneakers',
    'RunningShoes',
    'Boots',
    'ChelseaBoots',
    'Loafers',
    'OxfordShoes',
    'FormalShoes',
    'Sandals',
    'Slides',
  ],

  female: [
    'Sneakers',
    'RunningShoes',
    'Boots',
    'ChelseaBoots',
    'AnkleBoots',
    'Loafers',
    'OxfordShoes',
    'Sandals',
    'Slides',
  ],
};

export const HEELS_TYPES:
  HeelsType[] = [
  'Pumps',
  'Stilettos',
  'BlockHeels',
  'KittenHeels',
  'PlatformHeels',
  'HeeledBoots',
  'WedgeHeels',
];

export const JACKET_TYPES: Record<
  WardrobeType,
  JacketType[]
> = {
  male: [
    'Jacket',
    'Blazer',
    'DenimJacket',
    'LeatherJacket',
    'Bomber',
    'Puffer',
    'Coat',
    'TrenchCoat',
    'RainJacket',
    'Overcoat',
    'Vest',
  ],

  female: [
    'Jacket',
    'Blazer',
    'DenimJacket',
    'LeatherJacket',
    'Bomber',
    'Puffer',
    'Coat',
    'TrenchCoat',
    'RainJacket',
    'Overcoat',
    'Vest',
  ],
};

export const ACCESSORY_TYPES: Record<
  WardrobeType,
  AccessoryType[]
> = {
  male: [
    'Backpack',
    'Handbag',
    'Cap',
    'Watch',
  ],

  female: [
    'Backpack',
    'Handbag',
    'Cap',
    'Watch',
  ],
};

function normalizeText(
  value?: string | null
) {
  return (
    value || ''
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

export function normalizeSeason(
  season?: string | null
):
  | ClothingSeason
  | null {
  const normalized =
    normalizeText(
      season
    );

  if (
    normalized ===
      'summer' ||
    normalized ===
      'estate'
  ) {
    return 'Summer';
  }

  if (
    normalized ===
      'autumn' ||
    normalized ===
      'fall' ||
    normalized ===
      'autunno'
  ) {
    return 'Autumn';
  }

  if (
    normalized ===
      'winter' ||
    normalized ===
      'inverno'
  ) {
    return 'Winter';
  }

  return null;
}

export function normalizeSeasons(
  seasons?:
    | string[]
    | null
):
  ClothingSeason[] {
  if (
    !Array.isArray(
      seasons
    )
  ) {
    return [];
  }

  return Array.from(
    new Set(
      seasons
        .map(
          normalizeSeason
        )
        .filter(
          (
            season
          ): season is
            ClothingSeason =>
            Boolean(
              season
            )
        )
    )
  );
}

export function normalizeCategory(
  category?: string
): ClothingCategory {
  const normalized =
    normalizeText(
      category
    );

  if (!normalized) {
    return 'Accessories';
  }

  if (
    normalized ===
      'all'
  ) {
    return 'All';
  }

  if (
    [
      'top',
      'tops',
      'shirt',
      'shirts',
      't shirt',
      'tshirt',
      'tshirts',
      'blouse',
      'blouses',
      'hoodie',
      'hoodies',
      'sweater',
      'sweaters',
      'polo',
      'polos',
      'tank top',
      'crop top',
    ].includes(
      normalized
    )
  ) {
    return 'Tops';
  }

  if (
    [
      'pant',
      'pants',
      'trouser',
      'trousers',
      'jean',
      'jeans',
      'cargo',
      'cargos',
      'jogger',
      'joggers',
      'legging',
      'leggings',
      'chino',
      'chinos',
    ].includes(
      normalized
    )
  ) {
    return 'Pants';
  }

  if (
    [
      'short',
      'shorts',
      'short pant',
      'short pants',
    ].includes(
      normalized
    )
  ) {
    return 'Shorts';
  }

  if (
    [
      'dress',
      'dresses',
      'gown',
      'gowns',
    ].includes(
      normalized
    )
  ) {
    return 'Dresses';
  }

  if (
    [
      'skirt',
      'skirts',
    ].includes(
      normalized
    )
  ) {
    return 'Skirts';
  }

  if (
    [
      'shoe',
      'shoes',
      'sneaker',
      'sneakers',
      'boot',
      'boots',
      'loafer',
      'loafers',
      'sandal',
      'sandals',
      'slides',
    ].includes(
      normalized
    )
  ) {
    return 'Shoes';
  }

  if (
    [
      'heel',
      'heels',
      'high heel',
      'high heels',
      'stiletto',
      'stilettos',
      'pumps',
    ].includes(
      normalized
    )
  ) {
    return 'Heels';
  }

  if (
    [
      'jacket',
      'jackets',
      'coat',
      'coats',
      'blazer',
      'blazers',
      'bomber',
      'puffer',
      'trench',
      'outerwear',
    ].includes(
      normalized
    )
  ) {
    return 'Jackets';
  }

  if (
    [
      'bag',
      'bags',
      'handbag',
      'handbags',
      'backpack',
      'backpacks',
      'purse',
      'purses',
    ].includes(
      normalized
    )
  ) {
    return 'Bags';
  }

  if (
    [
      'accessory',
      'accessories',
      'watch',
      'watches',
      'cap',
      'caps',
      'hat',
      'hats',
    ].includes(
      normalized
    )
  ) {
    return 'Accessories';
  }

  return 'Accessories';
}

export function normalizeSubCategory(
  subCategory?: string | null
): string | null {
  const normalized =
    normalizeText(
      subCategory
    );

  if (!normalized) {
    return null;
  }

  const mappings:
    Record<
      string,
      ClothingSubCategory
    > = {
    't shirt':
      'TShirt',

    tshirt:
      'TShirt',

    tee:
      'TShirt',

    shirt:
      'Shirt',

    blouse:
      'Blouse',

    polo:
      'Polo',

    hoodie:
      'Hoodie',

    sweater:
      'Sweater',

    jumper:
      'Sweater',

    'tank top':
      'TankTop',

    'crop top':
      'CropTop',

    'long sleeve':
      'LongSleeve',

    turtleneck:
      'Turtleneck',

    cardigan:
      'Cardigan',

    'sports top':
      'SportsTop',

    jean:
      'Jeans',

    jeans:
      'Jeans',

    cargo:
      'Cargo',

    cargos:
      'Cargo',

    formal:
      'Formal',

    'formal pants':
      'Formal',

    jogger:
      'Joggers',

    joggers:
      'Joggers',

    'wide leg':
      'WideLeg',

    'straight leg':
      'StraightLeg',

    'slim fit':
      'SlimFit',

    chino:
      'Chinos',

    chinos:
      'Chinos',

    legging:
      'Leggings',

    leggings:
      'Leggings',

    flared:
      'Flared',

    culottes:
      'Culottes',

    'denim shorts':
      'DenimShorts',

    'cargo shorts':
      'CargoShorts',

    'sport shorts':
      'SportShorts',

    'sports shorts':
      'SportShorts',

    'linen shorts':
      'LinenShorts',

    'casual shorts':
      'CasualShorts',

    'tailored shorts':
      'TailoredShorts',

    'cycling shorts':
      'CyclingShorts',

    'mini skirt':
      'MiniSkirt',

    'midi skirt':
      'MidiSkirt',

    'maxi skirt':
      'MaxiSkirt',

    'pleated skirt':
      'PleatedSkirt',

    'pencil skirt':
      'PencilSkirt',

    'denim skirt':
      'DenimSkirt',

    'a line skirt':
      'AlineSkirt',

    'wrap skirt':
      'WrapSkirt',

    'mini dress':
      'MiniDress',

    'midi dress':
      'MidiDress',

    'maxi dress':
      'MaxiDress',

    'casual dress':
      'CasualDress',

    'formal dress':
      'FormalDress',

    'evening dress':
      'EveningDress',

    'bodycon dress':
      'BodyconDress',

    'shirt dress':
      'ShirtDress',

    'summer dress':
      'SummerDress',

    'cocktail dress':
      'CocktailDress',

    'sweater dress':
      'SweaterDress',

    sneaker:
      'Sneakers',

    sneakers:
      'Sneakers',

    'running shoes':
      'RunningShoes',

    boot:
      'Boots',

    boots:
      'Boots',

    'chelsea boots':
      'ChelseaBoots',

    'ankle boots':
      'AnkleBoots',

    loafer:
      'Loafers',

    loafers:
      'Loafers',

    oxford:
      'OxfordShoes',

    'oxford shoes':
      'OxfordShoes',

    'formal shoes':
      'FormalShoes',

    sandal:
      'Sandals',

    sandals:
      'Sandals',

    slide:
      'Slides',

    slides:
      'Slides',

    pump:
      'Pumps',

    pumps:
      'Pumps',

    stiletto:
      'Stilettos',

    stilettos:
      'Stilettos',

    'block heels':
      'BlockHeels',

    'kitten heels':
      'KittenHeels',

    'platform heels':
      'PlatformHeels',

    'heeled boots':
      'HeeledBoots',

    'wedge heels':
      'WedgeHeels',

    jacket:
      'Jacket',

    coat:
      'Coat',

    blazer:
      'Blazer',

    'denim jacket':
      'DenimJacket',

    'leather jacket':
      'LeatherJacket',

    bomber:
      'Bomber',

    puffer:
      'Puffer',

    'trench coat':
      'TrenchCoat',

    trench:
      'TrenchCoat',

    'rain jacket':
      'RainJacket',

    overcoat:
      'Overcoat',

    vest:
      'Vest',

    backpack:
      'Backpack',

    handbag:
      'Handbag',

    bag:
      'Handbag',

    purse:
      'Handbag',

    cap:
      'Cap',

    hat:
      'Cap',

    watch:
      'Watch',
  };

  return (
    mappings[
      normalized
    ] ||
    subCategory?.trim() ||
    null
  );
}

export function getClothingRole(
  category?: string,
  subCategory?: string | null
): ClothingRole {
  const normalizedCategory =
    normalizeCategory(
      category
    );

  const normalizedSubCategory =
    normalizeSubCategory(
      subCategory
    );

  if (
    normalizedCategory ===
    'Tops'
  ) {
    return 'UpperBody';
  }

  if (
    normalizedCategory ===
      'Pants' ||
    normalizedCategory ===
      'Shorts' ||
    normalizedCategory ===
      'Skirts'
  ) {
    return 'LowerBody';
  }

  if (
    normalizedCategory ===
    'Dresses'
  ) {
    return 'FullBody';
  }

  if (
    normalizedCategory ===
      'Shoes' ||
    normalizedCategory ===
      'Heels'
  ) {
    return 'Footwear';
  }

  if (
    normalizedCategory ===
    'Jackets'
  ) {
    return 'Outerwear';
  }

  if (
    normalizedCategory ===
      'Bags' ||
    normalizedSubCategory ===
      'Backpack' ||
    normalizedSubCategory ===
      'Handbag'
  ) {
    return 'Bag';
  }

  if (
    normalizedSubCategory ===
    'Cap'
  ) {
    return 'Headwear';
  }

  if (
    normalizedSubCategory ===
    'Watch'
  ) {
    return 'Watch';
  }

  return 'Accessory';
}

export function inferDefaultSeasons(
  category?: string,
  subCategory?: string | null
):
  ClothingSeason[] {
  const normalizedCategory =
    normalizeCategory(
      category
    );

  const normalizedSubCategory =
    normalizeSubCategory(
      subCategory
    );

  const summerOnly =
    new Set<string>([
      'TankTop',
      'CropTop',
      'DenimShorts',
      'CargoShorts',
      'SportShorts',
      'LinenShorts',
      'CasualShorts',
      'TailoredShorts',
      'CyclingShorts',
      'SummerDress',
      'Sandals',
      'Slides',
      'WedgeHeels',
    ]);

  const winterOnly =
    new Set<string>([
      'Sweater',
      'Turtleneck',
      'SweaterDress',
      'Puffer',
      'Coat',
      'Overcoat',
      'Boots',
      'ChelseaBoots',
      'AnkleBoots',
      'HeeledBoots',
    ]);

  const autumnWinter =
    new Set<string>([
      'Hoodie',
      'Cardigan',
      'LeatherJacket',
      'Bomber',
      'TrenchCoat',
      'RainJacket',
      'DenimJacket',
    ]);

  if (
    normalizedSubCategory &&
    summerOnly.has(
      normalizedSubCategory
    )
  ) {
    return [
      'Summer',
    ];
  }

  if (
    normalizedSubCategory &&
    winterOnly.has(
      normalizedSubCategory
    )
  ) {
    return [
      'Winter',
    ];
  }

  if (
    normalizedSubCategory &&
    autumnWinter.has(
      normalizedSubCategory
    )
  ) {
    return [
      'Autumn',
      'Winter',
    ];
  }

  if (
    normalizedCategory ===
    'Shorts'
  ) {
    return [
      'Summer',
    ];
  }

  if (
    normalizedCategory ===
    'Jackets'
  ) {
    return [
      'Autumn',
      'Winter',
    ];
  }

  if (
    normalizedCategory ===
    'Dresses'
  ) {
    return [
      'Summer',
      'Autumn',
    ];
  }

  if (
    normalizedCategory ===
      'Pants' ||
    normalizedCategory ===
      'Tops' ||
    normalizedCategory ===
      'Skirts' ||
    normalizedCategory ===
      'Shoes' ||
    normalizedCategory ===
      'Heels' ||
    normalizedCategory ===
      'Bags' ||
    normalizedCategory ===
      'Accessories'
  ) {
    return [
      'Summer',
      'Autumn',
      'Winter',
    ];
  }

  return [
    'Summer',
    'Autumn',
    'Winter',
  ];
}

export function getClothingKnowledge(
  category?: string,
  subCategory?: string | null
): ClothingKnowledge {
  const normalizedCategory =
    normalizeCategory(
      category
    );

  const normalizedSubCategory =
    normalizeSubCategory(
      subCategory
    );

  const role =
    getClothingRole(
      normalizedCategory,
      normalizedSubCategory
    );

  const defaultSeasons =
    inferDefaultSeasons(
      normalizedCategory,
      normalizedSubCategory
    );

  let styles:
    ClothingStyle[] = [
      'Casual',
      'Minimal',
    ];

  let occasions:
    ClothingOccasion[] = [
      'Casual',
    ];

  let warmth:
    1 | 2 | 3 | 4 | 5 =
    2;

  let formality:
    1 | 2 | 3 | 4 | 5 =
    2;

  const smartCasualItems =
    new Set<string>([
      'Shirt',
      'Polo',
      'Blouse',
      'Chinos',
      'StraightLeg',
      'WideLeg',
      'Loafers',
      'ChelseaBoots',
      'Blazer',
      'MidiSkirt',
      'ShirtDress',
    ]);

  const formalItems =
    new Set<string>([
      'Formal',
      'Blazer',
      'PencilSkirt',
      'FormalDress',
      'EveningDress',
      'CocktailDress',
      'Pumps',
      'Stilettos',
      'BlockHeels',
      'KittenHeels',
      'OxfordShoes',
      'FormalShoes',
      'Overcoat',
    ]);

  const sportItems =
    new Set<string>([
      'SportsTop',
      'Joggers',
      'Leggings',
      'SportShorts',
      'CyclingShorts',
      'Sneakers',
      'RunningShoes',
    ]);

  const streetwearItems =
    new Set<string>([
      'Hoodie',
      'Cargo',
      'CargoShorts',
      'WideLeg',
      'Bomber',
      'Puffer',
      'Sneakers',
      'Cap',
      'Backpack',
    ]);

  const luxuryItems =
    new Set<string>([
      'Blazer',
      'Formal',
      'PencilSkirt',
      'FormalDress',
      'EveningDress',
      'CocktailDress',
      'Pumps',
      'Stilettos',
      'BlockHeels',
      'Handbag',
      'Watch',
      'Overcoat',
      'TrenchCoat',
    ]);

  const warmItems =
    new Set<string>([
      'Sweater',
      'Turtleneck',
      'Hoodie',
      'Cardigan',
      'SweaterDress',
      'Puffer',
      'Coat',
      'Overcoat',
      'Boots',
      'ChelseaBoots',
      'AnkleBoots',
      'HeeledBoots',
    ]);

  const veryWarmItems =
    new Set<string>([
      'Puffer',
      'Coat',
      'Overcoat',
    ]);

  const lightItems =
    new Set<string>([
      'TankTop',
      'CropTop',
      'LinenShorts',
      'SportShorts',
      'SummerDress',
      'Sandals',
      'Slides',
    ]);

  if (
    normalizedSubCategory &&
    smartCasualItems.has(
      normalizedSubCategory
    )
  ) {
    styles = [
      'SmartCasual',
      'Classic',
      'Minimal',
    ];

    occasions = [
      'Casual',
      'Work',
      'Date',
    ];

    formality = 3;
  }

  if (
    normalizedSubCategory &&
    formalItems.has(
      normalizedSubCategory
    )
  ) {
    styles = [
      'Classic',
      'Elegant',
      'Luxury',
      'Business',
    ];

    occasions = [
      'Work',
      'Party',
      'Date',
    ];

    formality = 5;
  }

  if (
    normalizedSubCategory &&
    sportItems.has(
      normalizedSubCategory
    )
  ) {
    styles = [
      'Sport',
      'Casual',
    ];

    occasions = [
      'Sport',
      'Casual',
    ];

    formality = 1;
  }

  if (
    normalizedSubCategory &&
    streetwearItems.has(
      normalizedSubCategory
    )
  ) {
    styles = Array.from(
      new Set([
        ...styles,
        'Streetwear',
        'Casual',
      ])
    );

    occasions = Array.from(
      new Set([
        ...occasions,
        'Casual',
      ])
    );

    formality =
      Math.min(
        formality,
        2
      ) as
        | 1
        | 2
        | 3
        | 4
        | 5;
  }

  if (
    normalizedSubCategory &&
    luxuryItems.has(
      normalizedSubCategory
    )
  ) {
    styles = Array.from(
      new Set([
        ...styles,
        'Luxury',
        'Elegant',
      ])
    );

    occasions = Array.from(
      new Set([
        ...occasions,
        'Party',
        'Date',
      ])
    );
  }

  if (
    normalizedSubCategory &&
    veryWarmItems.has(
      normalizedSubCategory
    )
  ) {
    warmth = 5;
  } else if (
    normalizedSubCategory &&
    warmItems.has(
      normalizedSubCategory
    )
  ) {
    warmth = 4;
  } else if (
    normalizedSubCategory &&
    lightItems.has(
      normalizedSubCategory
    )
  ) {
    warmth = 1;
  } else if (
  normalizedCategory ===
    'Jackets' ||
  normalizedCategory ===
    'Pants' ||
  normalizedSubCategory ===
    'Boots' ||
  normalizedSubCategory ===
    'ChelseaBoots' ||
  normalizedSubCategory ===
    'AnkleBoots' ||
  normalizedSubCategory ===
    'HeeledBoots'
) {
  warmth = 3;
}

  if (
    normalizedCategory ===
    'Shorts'
  ) {
    occasions = Array.from(
      new Set([
        ...occasions,
        'Summer',
      ])
    );

    warmth = 1;
  }

  if (
    normalizedCategory ===
    'Dresses'
  ) {
    styles = Array.from(
      new Set([
        ...styles,
        'Elegant',
      ])
    );

    occasions = Array.from(
      new Set([
        ...occasions,
        'Date',
        'Party',
      ])
    );

    formality =
      Math.max(
        formality,
        3
      ) as
        | 1
        | 2
        | 3
        | 4
        | 5;
  }

  if (
    normalizedCategory ===
    'Heels'
  ) {
    styles = Array.from(
      new Set([
        ...styles,
        'Elegant',
      ])
    );

    occasions = Array.from(
      new Set([
        ...occasions,
        'Date',
        'Party',
        'Work',
      ])
    );

    formality =
      Math.max(
        formality,
        4
      ) as
        | 1
        | 2
        | 3
        | 4
        | 5;
  }

  return {
    category:
      normalizedCategory,

    subCategory:
      normalizedSubCategory,

    role,

    defaultSeasons,

    styles,

    occasions,

    warmth,

    formality,

    isLayer:
      role ===
      'Outerwear',

    requiresUpperBody:
      role ===
      'LowerBody',

    requiresLowerBody:
      role ===
      'UpperBody',

    replacesUpperAndLower:
      role ===
      'FullBody',
  };
}

export function getItemSeasons(
  item: {
    category?: string;

    subCategory?:
      | string
      | null;

    seasons?:
      | string[]
      | null;
  }
):
  ClothingSeason[] {
  const savedSeasons =
    normalizeSeasons(
      item.seasons
    );

  if (
    savedSeasons.length >
    0
  ) {
    return savedSeasons;
  }

  return inferDefaultSeasons(
    item.category,
    item.subCategory
  );
}

export function isItemSuitableForSeason(
  item: {
    category?: string;

    subCategory?:
      | string
      | null;

    seasons?:
      | string[]
      | null;
  },

  season?:
    | string
    | null
) {
  const normalizedSeason =
    normalizeSeason(
      season
    );

  if (!normalizedSeason) {
    return true;
  }

  return getItemSeasons(
    item
  ).includes(
    normalizedSeason
  );
}

export function isFemaleBottom(
  category?: string
) {
  return (
    normalizeCategory(
      category
    ) ===
    'Skirts'
  );
}

export function isFemaleDress(
  category?: string
) {
  return (
    normalizeCategory(
      category
    ) ===
    'Dresses'
  );
}

/**
 * للتوافق مع الملفات القديمة فقط.
 * المقصود هنا أي قطعة LowerBody:
 * Pants أو Shorts أو Skirts.
 */
export function isBottom(
  category?: string
) {
  const normalized =
    normalizeCategory(
      category
    );

  return (
    normalized ===
      'Pants' ||
    normalized ===
      'Shorts' ||
    normalized ===
      'Skirts'
  );
}

export function isLowerBody(
  category?: string
) {
  return isBottom(
    category
  );
}

export function isFullBody(
  category?: string
) {
  return (
    normalizeCategory(
      category
    ) ===
    'Dresses'
  );
}

export function isTop(
  category?: string
) {
  return (
    normalizeCategory(
      category
    ) ===
    'Tops'
  );
}

export function isJacket(
  category?: string
) {
  return (
    normalizeCategory(
      category
    ) ===
    'Jackets'
  );
}

export function isAccessory(
  category?: string
) {
  const normalized =
    normalizeCategory(
      category
    );

  return (
    normalized ===
      'Accessories' ||
    normalized ===
      'Bags'
  );
}

export function isShoes(
  category?: string
) {
  const normalized =
    normalizeCategory(
      category
    );

  return (
    normalized ===
      'Shoes' ||
    normalized ===
      'Heels'
  );
}

export function isFootwear(
  category?: string
) {
  return isShoes(
    category
  );
}

export function isBag(
  category?: string,
  subCategory?:
    | string
    | null
) {
  return (
    getClothingRole(
      category,
      subCategory
    ) ===
    'Bag'
  );
}

export function isCap(
  category?: string,
  subCategory?:
    | string
    | null
) {
  return (
    getClothingRole(
      category,
      subCategory
    ) ===
    'Headwear'
  );
}

export function isWatch(
  category?: string,
  subCategory?:
    | string
    | null
) {
  return (
    getClothingRole(
      category,
      subCategory
    ) ===
    'Watch'
  );
}

export function getCategoryTranslationKey(
  category?: string
): ClothingTranslationKey {
  const normalizedCategory =
    normalizeCategory(
      category
    );

  switch (
    normalizedCategory
  ) {
    case 'All':
      return 'clothing.category.all';

    case 'Tops':
      return 'clothing.category.tops';

    case 'Pants':
      return 'clothing.category.pants';

    case 'Shorts':
      return 'clothing.category.shorts';

    case 'Shoes':
      return 'clothing.category.shoes';

    case 'Jackets':
      return 'clothing.category.jackets';

    case 'Dresses':
      return 'clothing.category.dresses';

    case 'Skirts':
      return 'clothing.category.skirts';

    case 'Heels':
      return 'clothing.category.heels';

    case 'Bags':
      return 'clothing.category.bags';

    case 'Accessories':
    default:
      return 'clothing.category.accessories';
  }
}

export function getTopTypeTranslationKey(
  type: TopType
): ClothingTranslationKey {
  switch (type) {
    case 'TShirt':
      return 'clothing.topType.tShirt';

    case 'Shirt':
      return 'clothing.topType.shirt';

    case 'Polo':
      return 'clothing.topType.polo';

    case 'Hoodie':
      return 'clothing.topType.hoodie';

    case 'Sweater':
    default:
      return 'clothing.topType.sweater';
  }
}

export function getPantsTypeTranslationKey(
  type: PantsType
): ClothingTranslationKey {
  switch (type) {
    case 'Jeans':
      return 'clothing.pantsType.jeans';

    case 'Cargo':
      return 'clothing.pantsType.cargo';

    case 'Formal':
      return 'clothing.pantsType.formal';

    case 'Joggers':
    default:
      return 'clothing.pantsType.joggers';
  }
}

export function getShoesTypeTranslationKey(
  type: ShoesType
): ClothingTranslationKey {
  switch (type) {
    case 'Sneakers':
      return 'clothing.shoesType.sneakers';

    case 'Boots':
      return 'clothing.shoesType.boots';

    case 'Loafers':
      return 'clothing.shoesType.loafers';

    case 'Sandals':
    default:
      return 'clothing.shoesType.sandals';
  }
}

export function getJacketTypeTranslationKey(
  type: JacketType
): ClothingTranslationKey {
  switch (type) {
    case 'Jacket':
      return 'clothing.jacketType.jacket';

    case 'Coat':
    default:
      return 'clothing.jacketType.coat';
  }
}

export function getAccessoryTypeTranslationKey(
  type: AccessoryType
): ClothingTranslationKey {
  switch (type) {
    case 'Backpack':
      return 'clothing.accessoryType.backpack';

    case 'Handbag':
      return 'clothing.accessoryType.handbag';

    case 'Cap':
      return 'clothing.accessoryType.cap';

    case 'Watch':
    default:
      return 'clothing.accessoryType.watch';
  }
}

export function getSeasonLabel(
  season:
    ClothingSeason,

  language:
    | 'English'
    | 'Italian' =
    'English'
) {
  if (
    language ===
    'Italian'
  ) {
    switch (season) {
      case 'Summer':
        return 'Estivo';

      case 'Autumn':
        return 'Autunnale';

      case 'Winter':
        return 'Invernale';
    }
  }

  switch (season) {
    case 'Summer':
      return 'Summer';

    case 'Autumn':
      return 'Autumn';

    case 'Winter':
      return 'Winter';
  }
}