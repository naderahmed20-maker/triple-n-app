import { WardrobeType } from './clothingCategories';

export const WARDROBE_CONFIG = {
  male: {
    categories: [
      'All',
      'Tops',
      'Pants',
      'Shorts',
      'Shoes',
      'Jackets',
      'Accessories',
    ],

    outfitSlots: [
      'Top',
      'Pants',
      'Shoes',
      'Jacket',
    ],
  },

  female: {
    categories: [
      'All',
      'Tops',
      'Dresses',
      'Skirts',
      'Heels',
      'Shoes',
      'Bags',
      'Accessories',
    ],

    outfitSlots: [
      'Top',
      'Dress',
      'Skirt',
      'Heels',
      'Bag',
    ],
  },
} satisfies Record<
  WardrobeType,
  {
    categories: string[];
    outfitSlots: string[];
  }
>;