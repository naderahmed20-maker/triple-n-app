import {
  Image,
  ImageStyle,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  useTranslation,
} from '@/lib/i18n';

import {
  normalizeCategory,
} from '../../data/clothingCategories';

import {
  OUTFIT_LAYOUT,
  OutfitCanvasVariant,
} from '../../data/outfitLayout';

type Item = {
  image: string;

  category?: string;

  subCategory?:
    | string
    | null;
};

type Outfit = {
  top?:
    | Item
    | null;

  bottom?:
    | Item
    | null;

  pants?:
    | Item
    | null;

  shoes?:
    | Item
    | null;

  jacket?:
    | Item
    | null;

  bag?:
    | Item
    | null;

  cap?:
    | Item
    | null;

  watch?:
    | Item
    | null;

  accessory?:
    | Item
    | null;
};

type Props = {
  outfit:
    | Outfit
    | null;

  variant:
    OutfitCanvasVariant;
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

function getLayoutKey(
  category?: string
): LayoutKey {
  const key =
    normalizeCategory(
      category
    );
  if (
  key === 'Pants' ||
  key === 'Shorts' ||
  key === 'Skirts'
) {
  return 'Bottoms';
}

  if (
    key === 'Shoes' ||
    key === 'Heels'
  ) {
    return 'Shoes';
  }

  if (
    key === 'Jackets'
  ) {
    return 'Jackets';
  }

  if (
    key === 'Tops'
  ) {
    return 'Tops';
  }

  if (
    key === 'Dresses'
  ) {
    return 'Dresses';
  }

  return 'Accessories';
}

function getAccessoryKey(
  item: Item
): AccessoryLayoutKey {
  const category =
    normalizeCategory(
      item.category
    );

  const normalizedCategory =
    normalizeText(
      category
    );

  const normalizedSubCategory =
    normalizeText(
      item.subCategory
    );

  if (
    normalizedCategory ===
      'bags' ||
    normalizedCategory ===
      'bag' ||
    normalizedSubCategory ===
      'bag' ||
    normalizedSubCategory ===
      'handbag' ||
    normalizedSubCategory ===
      'backpack'
  ) {
    return 'Bag';
  }

  if (
    normalizedSubCategory ===
      'watch'
  ) {
    return 'Watch';
  }

  if (
    normalizedSubCategory ===
      'glasses' ||
    normalizedSubCategory ===
      'sunglasses'
  ) {
    return 'Glasses';
  }

  if (
    normalizedSubCategory ===
      'cap' ||
    normalizedSubCategory ===
      'hat'
  ) {
    return 'Cap';
  }

  if (
    normalizedSubCategory ===
      'other'
  ) {
    return 'Other';
  }

  return 'Accessories';
}

function getItemIdentity(
  item:
    | Item
    | null
    | undefined
) {
  if (!item) {
    return '';
  }

  return [
    item.image,
    item.category,
    item.subCategory,
  ].join('|');
}

export default function OutfitCanvas({
  outfit,
  variant,
}: Props) {
  const {
    t,
  } = useTranslation();

  const isSavedCard =
    variant ===
    'savedCard';

  const layout =
    OUTFIT_LAYOUT[
      variant
    ];

  const accessoryItems = [
    outfit?.bag,
    outfit?.cap,
    outfit?.watch,
    outfit?.accessory,
  ].filter(
    Boolean
  ) as Item[];

  const uniqueAccessoryItems =
    accessoryItems.filter(
      (
        item,
        index,
        currentItems
      ) =>
        currentItems.findIndex(
          (
            currentItem
          ) =>
            getItemIdentity(
              currentItem
            ) ===
            getItemIdentity(
              item
            )
        ) === index
    );

  const pieces = [
    outfit?.jacket,
    outfit?.top,
    outfit?.bottom ||
      outfit?.pants,
    outfit?.shoes,
    ...uniqueAccessoryItems,
  ].filter(
    Boolean
  ) as Item[];

  return (
    <View
      style={[
        styles.wrapper,

        isSavedCard &&
          styles.savedWrapper,
      ]}
    >
      <View
        style={[
          styles.canvas,

          {
            width:
              layout.canvas
                .width,

            height:
              layout.canvas
                .height,
          },
        ]}
      >
        {pieces.map(
          (
            item,
            index
          ) => {
            const layoutKey =
              getLayoutKey(
                item.category
              );

            let itemLayout:
              ImageStyle;

            if (
              layoutKey ===
              'Accessories'
            ) {
              const accessoryKey =
                getAccessoryKey(
                  item
                );

              itemLayout =
                layout[
                  accessoryKey
                ];
            } else {
              itemLayout =
                layout[
                  layoutKey
                ];
            }

            return (
              <Image
                key={`${item.image}-${index}`}
                source={{
                  uri:
                    item.image,
                }}
                style={[
                  styles.item,
                  itemLayout,
                ]}
                resizeMode="contain"
              />
            );
          }
        )}

        {!outfit ? (
          <View
            style={
              styles.emptyContainer
            }
          >
            <Text
              style={
                styles.empty
              }
            >
              {t(
                'outfitCanvas.generateOutfit'
              )}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles =
  StyleSheet.create({
    wrapper: {
      alignItems:
        'center',

      justifyContent:
        'center',
    },

    savedWrapper: {
      width: 180,

      height: 210,

      alignItems:
        'center',

      justifyContent:
        'center',

      overflow:
        'hidden',
    },

    canvas: {
      position:
        'relative',

      alignSelf:
        'center',

      overflow:
        'hidden',
    },

    item: {
      position:
        'absolute',
    },

    emptyContainer: {
      ...StyleSheet.absoluteFillObject,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    empty: {
      color: '#777',

      fontSize: 18,

      fontWeight:
        '900',

      textAlign:
        'center',

      paddingHorizontal:
        15,
    },
  });