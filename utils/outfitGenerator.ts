export type WardrobeItem = {
  image: string;
  category: string;
  name?: string;
  favorite?: boolean;
  createdAt?: number;
  color?: string;
};

function randomItem(items: WardrobeItem[], category: string) {
  const list = items.filter((item) => item.category === category);

  if (list.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * list.length);
  return list[randomIndex];
}

export function generateRandomOutfit(items: WardrobeItem[]) {
  return {
    top: randomItem(items, 'Tops'),
    pants: randomItem(items, 'Pants'),
    shoes: randomItem(items, 'Shoes'),
    jacket: randomItem(items, 'Jackets'),
    accessory: randomItem(items, 'Accessories'),
  };
}