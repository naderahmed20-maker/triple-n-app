export type WardrobeType = 'male' | 'female';

export type AccessoryType =
  | 'Watch'
  | 'Glasses'
  | 'Cap'
  | 'Bag'
  | 'Other';

export type TopType =
  | 'TShirt'
  | 'Shirt'
  | 'Polo'
  | 'Hoodie'
  | 'Sweater';

export type PantsType =
  | 'Jeans'
  | 'Cargo'
  | 'Formal'
  | 'Joggers';

export type ShoesType =
  | 'Sneakers'
  | 'Boots'
  | 'Loafers'
  | 'Sandals';

export type JacketType =
  | 'Jacket'
  | 'Coat';

export const WARDROBE_TYPE_KEY = 'wardrobeType';

export const CLOTHING_CATEGORIES: Record<WardrobeType, string[]> = {
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
    'Dresses',
    'Skirts',
    'Jackets',
    'Heels',
    'Shoes',
    'Bags',
    'Accessories',
  ],
};

export function isFemaleBottom(category?: string) {
  return category === 'Skirts';
}

export function isFemaleDress(category?: string) {
  return category === 'Dresses';
}

export function isBottom(category?: string) {
  return (
    category === 'Pants' ||
    category === 'Shorts' ||
    category === 'Skirts'
  );
}

export function isTop(category?: string) {
  return category === 'Top' || category === 'Tops';
}

export function isJacket(category?: string) {
  return category === 'Jacket' || category === 'Jackets';
}

export function isAccessory(category?: string) {
  return (
    category === 'Accessories' ||
    category === 'Accessory' ||
    category === 'Bags'
  );
}

export function isShoes(category?: string) {
  return (
    category === 'Shoes' ||
    category === 'Heels'
  );
}

export const TOP_TYPES: Record<WardrobeType, TopType[]> = {
  male: ['TShirt', 'Shirt', 'Polo', 'Hoodie', 'Sweater'],
  female: ['TShirt', 'Shirt', 'Hoodie', 'Sweater', 'Polo'],
};

export const PANTS_TYPES: Record<WardrobeType, PantsType[]> = {
  male: ['Jeans', 'Cargo', 'Formal', 'Joggers'],
  female: ['Jeans', 'Formal', 'Joggers', 'Cargo'],
};

export const SHOES_TYPES: Record<WardrobeType, ShoesType[]> = {
  male: ['Sneakers', 'Boots', 'Loafers', 'Sandals'],
  female: ['Sneakers', 'Boots', 'Sandals', 'Loafers'],
};

export const JACKET_TYPES: Record<WardrobeType, JacketType[]> = {
  male: ['Jacket', 'Coat'],
  female: ['Jacket', 'Coat'],
};

export const ACCESSORY_TYPES: Record<WardrobeType, AccessoryType[]> = {
  male: ['Watch', 'Glasses', 'Cap', 'Bag', 'Other'],
  female: ['Watch', 'Glasses', 'Cap', 'Bag', 'Other'],
};

export function normalizeCategory(category?: string) {
  if (!category) return 'Accessories';

  if (category === 'Top') return 'Tops';
  if (category === 'Jacket') return 'Jackets';
  if (category === 'Accessory') return 'Accessories';

  if (category === 'Bag') return 'Bags';
  if (category === 'Heel') return 'Heels';

  return category;
}