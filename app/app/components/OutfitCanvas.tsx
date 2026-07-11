import { Image, ImageStyle, StyleSheet, Text, View } from 'react-native';
import { normalizeCategory } from '../../data/clothingCategories';
import {
    OUTFIT_LAYOUT,
    OutfitCanvasVariant,
} from '../../data/outfitLayout';

type Item = {
  image: string;
  category?: string;
  subCategory?: string | null;
};

type Outfit = {
  top?: Item | null;
  bottom?: Item | null;
  pants?: Item | null;
  shoes?: Item | null;
  jacket?: Item | null;
  accessory?: Item | null;
};

type Props = {
  outfit: Outfit | null;
  variant: OutfitCanvasVariant;
};

type LayoutKey =
  | 'Tops'
  | 'Bottoms'
  | 'Shoes'
  | 'Jackets'
  | 'Dresses'
  | 'Accessories';

type AccessoryLayoutKey =
  | 'Watch'
  | 'Glasses'
  | 'Cap'
  | 'Bag'
  | 'Other'
  | 'Accessories';

function getLayoutKey(category?: string): LayoutKey {
  const key = normalizeCategory(category);

  if (
    key === 'Pants' ||
    key === 'Shorts' ||
    key === 'Skirts' ||
    key === 'Bottoms'
  ) {
    return 'Bottoms';
  }

  if (key === 'Shoes' || key === 'Heels') {
    return 'Shoes';
  }

  if (key === 'Jackets') {
    return 'Jackets';
  }

  if (key === 'Tops') {
    return 'Tops';
  }

  if (key === 'Dresses') {
    return 'Dresses';
  }

  return 'Accessories';
}

function getAccessoryKey(item: Item): AccessoryLayoutKey {
  const category = normalizeCategory(item.category);
  const subCategory = item.subCategory?.trim();

  if (category === 'Bags' || subCategory === 'Bag') {
    return 'Bag';
  }

  if (subCategory === 'Watch') {
    return 'Watch';
  }

  if (subCategory === 'Glasses') {
    return 'Glasses';
  }

  if (subCategory === 'Cap') {
    return 'Cap';
  }

  if (subCategory === 'Other') {
    return 'Other';
  }

  return 'Accessories';
}

export default function OutfitCanvas({ outfit, variant }: Props) {
  const isSavedCard = variant === 'savedCard';

  // كل شاشة تستخدم المقاسات الخاصة بها مباشرة من outfitLayout.ts
  const layout = OUTFIT_LAYOUT[variant];

  const pieces = [
    outfit?.jacket,
    outfit?.top,
    outfit?.bottom || outfit?.pants,
    outfit?.shoes,
    outfit?.accessory,
  ].filter(Boolean) as Item[];

  return (
    <View style={[styles.wrapper, isSavedCard && styles.savedWrapper]}>
      <View
        style={[
          styles.canvas,
          {
            width: layout.canvas.width,
            height: layout.canvas.height,
          },
        ]}
      >
        {pieces.map((item, index) => {
          const layoutKey = getLayoutKey(item.category);
          const accessoryKey = getAccessoryKey(item);

          let itemLayout: ImageStyle;

          if (layoutKey === 'Accessories') {
            itemLayout = layout[accessoryKey];
          } else {
            itemLayout = layout[layoutKey];
          }

          return (
            <Image
              key={`${item.image}-${index}`}
              source={{ uri: item.image }}
              style={[styles.item, itemLayout]}
              resizeMode="contain"
            />
          );
        })}

        {!outfit && <Text style={styles.empty}>Generate outfit</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  savedWrapper: {
    width: 180,
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  canvas: {
    position: 'relative',
    alignSelf: 'center',
    overflow: 'hidden',
  },

  item: {
    position: 'absolute',
  },

  empty: {
    color: '#777',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 150,
  },
});