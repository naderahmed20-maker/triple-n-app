import AsyncStorage from '@react-native-async-storage/async-storage';

type WardrobeItem = {
  color?: string;
  category?: string;
};

type SavedOutfit = {
  top?: WardrobeItem | null;
  pants?: WardrobeItem | null;
  bottom?: WardrobeItem | null;
  shoes?: WardrobeItem | null;
  jacket?: WardrobeItem | null;
  accessory?: WardrobeItem | null;
  occasion?: string;
  weather?: string;
  season?: string;
  favorite?: boolean;
};

export type UserPreference = {
  favoriteColors: string[];
  favoriteCategories: string[];
  favoriteOccasions: string[];
  favoriteWeather: string[];
  favoriteSeason: string[];
};

function addCount(map: Record<string, number>, value?: string) {
  if (!value) return;
  map[value] = (map[value] || 0) + 1;
}

function getTopKeys(map: Record<string, number>, limit = 5) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

export async function getUserPreference(): Promise<UserPreference> {
  const savedOutfits = await AsyncStorage.getItem('savedOutfits');
  const outfits: SavedOutfit[] = savedOutfits ? JSON.parse(savedOutfits) : [];

  const colorCount: Record<string, number> = {};
  const categoryCount: Record<string, number> = {};
  const occasionCount: Record<string, number> = {};
  const weatherCount: Record<string, number> = {};
  const seasonCount: Record<string, number> = {};

  outfits.forEach((outfit) => {
    const weight = outfit.favorite ? 3 : 1;

    const pieces = [
      outfit.top,
      outfit.pants || outfit.bottom,
      outfit.shoes,
      outfit.jacket,
      outfit.accessory,
    ];

    pieces.forEach((piece) => {
      for (let i = 0; i < weight; i++) {
        addCount(colorCount, piece?.color);
        addCount(categoryCount, piece?.category);
      }
    });

    for (let i = 0; i < weight; i++) {
      addCount(occasionCount, outfit.occasion);
      addCount(weatherCount, outfit.weather);
      addCount(seasonCount, outfit.season);
    }
  });

  return {
    favoriteColors: getTopKeys(colorCount),
    favoriteCategories: getTopKeys(categoryCount),
    favoriteOccasions: getTopKeys(occasionCount),
    favoriteWeather: getTopKeys(weatherCount),
    favoriteSeason: getTopKeys(seasonCount),
  };
}

export function getPreferenceBonus(
  item: WardrobeItem | null | undefined,
  preference: UserPreference | null
) {
  if (!item || !preference) return 0;

  let bonus = 0;

  if (item.color && preference.favoriteColors.includes(item.color)) {
    bonus += 8;
  }

  if (item.category && preference.favoriteCategories.includes(item.category)) {
    bonus += 6;
  }

  return bonus;
}