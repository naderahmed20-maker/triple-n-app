import { getMyProfile } from '@/lib/profileService';
import {
  WardrobeItem,
  deleteWardrobeItems,
  getCurrentUser,
  getMyWardrobeItems,
  toggleWardrobeFavorite,
} from '@/lib/wardrobeService';

import { router, useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  Alert,
  FlatList,
  Image,
  ImageBackground,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  CLOTHING_CATEGORIES,
  WardrobeType,
} from './data/clothingCategories';

type DisplayItem = WardrobeItem & {
  originalIndex: number;
};

export default function WardrobeScreen() {
  const [items, setItems] =
    useState<WardrobeItem[]>([]);

  const [deleteMode, setDeleteMode] =
    useState(false);

  const [selectedItems, setSelectedItems] =
    useState<number[]>([]);

  const [previewImage, setPreviewImage] =
    useState<string | null>(null);

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState('All');

  const [searchText, setSearchText] =
    useState('');

  const [wardrobeType, setWardrobeType] =
    useState<WardrobeType>('male');

  const categories =
    CLOTHING_CATEGORIES[wardrobeType];

  function normalizeCategory(
    category?: string
  ) {
    if (!category) {
      return 'Accessories';
    }

    if (category === 'Top') {
      return 'Tops';
    }

    if (category === 'Jacket') {
      return 'Jackets';
    }

    if (category === 'Accessory') {
      return 'Accessories';
    }

    if (category === 'Bag') {
      return 'Bags';
    }

    if (category === 'Heel') {
      return 'Heels';
    }

    return category;
  }

  useEffect(() => {
    if (
      !categories.includes(
        selectedCategory
      )
    ) {
      setSelectedCategory('All');
    }
  }, [
    wardrobeType,
    categories,
    selectedCategory,
  ]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadItems() {
        try {
          const user =
            await getCurrentUser();

          if (!user) {
            router.replace(
              '/login' as any
            );
            return;
          }

          const profile =
            await getMyProfile();

          if (!profile) {
            router.replace(
              '/onboarding' as any
            );
            return;
          }

          const type: WardrobeType =
            profile.gender === 'Female'
              ? 'female'
              : 'male';

          const data =
            await getMyWardrobeItems();

          if (!active) {
            return;
          }

          setWardrobeType(type);
          setItems(data);
        } catch (error: any) {
          Alert.alert(
            'Error',
            error?.message ||
              'Failed to load wardrobe.'
          );
        }
      }

      loadItems();

      return () => {
        active = false;
      };
    }, [])
  );

  const filteredItems: DisplayItem[] =
    items
      .map((item, index) => ({
        ...item,
        originalIndex: index,
      }))
      .filter((item) => {
        const search =
          searchText
            .trim()
            .toLowerCase();

        const itemCategory =
          normalizeCategory(
            item.category
          );

        const categoryMatch =
          selectedCategory === 'All' ||
          itemCategory ===
            selectedCategory;

        const searchMatch =
          search.length === 0 ||
          item.category
            .toLowerCase()
            .includes(search) ||
          (item.name || '')
            .toLowerCase()
            .includes(search) ||
          (item.color || '')
            .toLowerCase()
            .includes(search) ||
          (item.subCategory || '')
            .toLowerCase()
            .includes(search) ||
          (item.shade || '')
            .toLowerCase()
            .includes(search);

        return (
          categoryMatch &&
          searchMatch
        );
      });

  function toggleSelect(index: number) {
    if (!deleteMode) {
      return;
    }

    setSelectedItems((current) => {
      if (current.includes(index)) {
        return current.filter(
          (item) => item !== index
        );
      }

      return [...current, index];
    });
  }

  async function deleteSelectedItems() {
    const idsToDelete =
      selectedItems
        .map(
          (index) =>
            items[index]?.id
        )
        .filter(Boolean) as string[];

    if (idsToDelete.length === 0) {
      return;
    }

    try {
      await deleteWardrobeItems(
        idsToDelete
      );

      setItems((current) =>
        current.filter(
          (_, index) =>
            !selectedItems.includes(
              index
            )
        )
      );

      setSelectedItems([]);
      setDeleteMode(false);
    } catch (error: any) {
      Alert.alert(
        'Delete failed',
        error?.message ||
          'Could not delete items.'
      );
    }
  }

  async function toggleFavorite(
    indexToChange: number
  ) {
    const item =
      items[indexToChange];

    if (!item?.id) {
      return;
    }

    const newFavorite =
      !item.favorite;

    try {
      await toggleWardrobeFavorite(
        item.id,
        newFavorite
      );

      setItems((current) =>
        current.map(
          (oldItem, index) =>
            index ===
            indexToChange
              ? {
                  ...oldItem,
                  favorite:
                    newFavorite,
                }
              : oldItem
        )
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message ||
          'Could not update favorite.'
      );
    }
  }

  function goHome() {
    router.replace('/home' as any);
  }

  function openAddItem() {
    router.push('/item' as any);
  }

  return (
    <ImageBackground
      source={require(
        '../assets/images/luxury-fabric.jpeg'
      )}
      resizeMode="cover"
      style={styles.container}
    >
      <View style={styles.overlay}>
        <FlatList
          data={filteredItems}
          numColumns={3}
          keyExtractor={(item) =>
            item.id
          }
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.list
          }
          ListHeaderComponent={
            <>
              <View
                style={
                  styles.smallHeader
                }
              >
                <TouchableOpacity
                  style={
                    styles.homeButton
                  }
                  onPress={goHome}
                  activeOpacity={0.85}
                >
                  <Text
                    style={
                      styles.homeButtonText
                    }
                  >
                    ‹
                  </Text>
                </TouchableOpacity>

                <View
                  style={
                    styles.headerTextBox
                  }
                >
                  <Text
                    style={styles.title}
                  >
                    Wardrobe
                  </Text>

                  <Text
                    style={
                      styles.subtitle
                    }
                  >
                    {items.length}{' '}
                    items •{' '}
                    {wardrobeType ===
                    'female'
                      ? 'Women'
                      : 'Men'}
                  </Text>
                </View>
              </View>

              <TextInput
                style={
                  styles.searchInput
                }
                placeholder="Search..."
                placeholderTextColor="#777"
                value={searchText}
                onChangeText={
                  setSearchText
                }
              />

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={
                  false
                }
                contentContainerStyle={
                  styles.categoryContainer
                }
              >
                {categories.map(
                  (category) => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.filterButton,
                        selectedCategory ===
                          category &&
                          styles.activeFilter,
                      ]}
                      onPress={() =>
                        setSelectedCategory(
                          category
                        )
                      }
                    >
                      <Text
                        style={[
                          styles.filterText,
                          selectedCategory ===
                            category &&
                            styles.activeFilterText,
                        ]}
                      >
                        {category}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </ScrollView>

              {items.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.deleteModeButton,
                    deleteMode &&
                      styles.cancelDeleteButton,
                  ]}
                  onPress={() => {
                    setDeleteMode(
                      (current) =>
                        !current
                    );

                    setSelectedItems(
                      []
                    );
                  }}
                >
                  <Text
                    style={
                      styles.deleteModeText
                    }
                  >
                    {deleteMode
                      ? 'Cancel Delete'
                      : 'Select to Delete'}
                  </Text>
                </TouchableOpacity>
              )}

              {deleteMode &&
                selectedItems.length >
                  0 && (
                  <TouchableOpacity
                    style={
                      styles.deleteButton
                    }
                    onPress={
                      deleteSelectedItems
                    }
                  >
                    <Text
                      style={
                        styles.deleteButtonText
                      }
                    >
                      Delete{' '}
                      {
                        selectedItems.length
                      }{' '}
                      Items
                    </Text>
                  </TouchableOpacity>
                )}
            </>
          }
          renderItem={({ item }) => {
            const realIndex =
              item.originalIndex;

            const isSelected =
              selectedItems.includes(
                realIndex
              );

            return (
              <TouchableOpacity
                style={[
                  styles.card,
                  isSelected &&
                    styles.selectedCard,
                ]}
                onPress={() => {
                  if (deleteMode) {
                    toggleSelect(
                      realIndex
                    );
                    return;
                  }

                  router.push({
                    pathname:
                      '/edit-item',
                    params: {
                      id: item.id,
                    },
                  });
                }}
                onLongPress={() =>
                  setPreviewImage(
                    item.image
                  )
                }
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.imageBackground,
                    {
                      backgroundColor:
                        item.imageBackground ||
                        '#e5e5e5',
                    },
                  ]}
                >
                  <Image
                    source={{
                      uri: item.image,
                    }}
                    style={styles.image}
                  />
                </View>

                <View
                  style={
                    styles.darkOverlay
                  }
                />

                <TouchableOpacity
                  style={
                    styles.favoriteButton
                  }
                  onPress={() =>
                    toggleFavorite(
                      realIndex
                    )
                  }
                >
                  <Text
                    style={
                      styles.favoriteText
                    }
                  >
                    {item.favorite
                      ? '❤️'
                      : '🤍'}
                  </Text>
                </TouchableOpacity>

                {item.name && (
                  <View
                    style={
                      styles.nameBadge
                    }
                  >
                    <Text
                      style={
                        styles.nameText
                      }
                    >
                      {item.name}
                    </Text>
                  </View>
                )}

                {isSelected && (
                  <View
                    style={
                      styles.checkCircle
                    }
                  >
                    <Text
                      style={
                        styles.checkText
                      }
                    >
                      ✓
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />

        <TouchableOpacity
          style={
            styles.fixedAddButton
          }
          onPress={openAddItem}
          activeOpacity={0.9}
        >
          <Text
            style={
              styles.fixedAddButtonText
            }
          >
            ＋ Add Item
          </Text>
        </TouchableOpacity>

        <Modal
          visible={
            previewImage !== null
          }
          transparent
          animationType="fade"
          onRequestClose={() =>
            setPreviewImage(null)
          }
        >
          <TouchableOpacity
            style={
              styles.modalBackground
            }
            onPress={() =>
              setPreviewImage(null)
            }
            activeOpacity={1}
          >
            {previewImage && (
              <Image
                source={{
                  uri: previewImage,
                }}
                style={
                  styles.previewImage
                }
              />
            )}
          </TouchableOpacity>
        </Modal>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f10',
    paddingHorizontal: 18,
    paddingTop: 65,
  },

  overlay: {
    flex: 1,
    backgroundColor:
      'rgba(7, 9, 13, 0.88)',
  },

  list: {
    paddingBottom: 190,
  },

  smallHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },

  homeButton: {
    width: 44,
    height: 44,
    borderRadius: 18,
    backgroundColor: '#15171c',
    borderWidth: 1,
    borderColor: '#252a31',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  homeButtonText: {
    color: 'white',
    fontSize: 34,
    lineHeight: 37,
    marginTop: -2,
  },

  headerTextBox: {
    flex: 1,
  },

  title: {
    color: 'white',
    fontSize: 36,
    fontWeight: '900',
  },

  subtitle: {
    color: '#888',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },

  searchInput: {
    backgroundColor: '#15171c',
    color: 'white',
    padding: 16,
    borderRadius: 20,
    fontSize: 15,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#252a31',
  },

  categoryContainer: {
    paddingBottom: 15,
    paddingHorizontal: 2,
    gap: 10,
  },

  filterButton: {
    backgroundColor: '#15171c',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#252a31',
  },

  activeFilter: {
    backgroundColor: '#f4dfc8',
    borderColor: '#f4dfc8',
  },

  filterText: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: 'bold',
  },

  activeFilterText: {
    color: '#111',
    fontWeight: 'bold',
  },

  deleteModeButton: {
    backgroundColor: '#222',
    padding: 14,
    borderRadius: 24,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#333',
  },

  cancelDeleteButton: {
    backgroundColor: '#333',
  },

  deleteModeText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
  },

  deleteButton: {
    backgroundColor: '#ef4444',
    padding: 14,
    borderRadius: 24,
    alignItems: 'center',
    marginBottom: 15,
  },

  deleteButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
  },

  card: {
    flex: 1,
    height: 150,
    margin: 6,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#e8e4de',
    borderWidth: 1,
    borderColor: '#252a31',
  },

  selectedCard: {
    borderColor: '#f4dfc8',
    borderWidth: 2,
  },

  imageBackground: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e5e5e5',
    justifyContent: 'center',
    alignItems: 'center',
  },

  image: {
    width: '92%',
    height: '92%',
    resizeMode: 'contain',
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.08)',
  },

  favoriteButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor:
      'rgba(255,255,255,0.75)',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },

  favoriteText: {
    fontSize: 18,
  },

  nameBadge: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor:
      'rgba(0,0,0,0.62)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
  },

  nameText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  checkCircle: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#22c55e',
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },

  checkText: {
    color: 'white',
    fontSize: 19,
    fontWeight: 'bold',
  },

  fixedAddButton: {
    position: 'absolute',
    left: 55,
    right: 55,
    bottom: 25,
    backgroundColor: '#f4dfc8',
    paddingVertical: 16,
    borderRadius: 35,
    alignItems: 'center',
    zIndex: 20,
  },

  fixedAddButtonText: {
    color: '#111',
    fontSize: 18,
    fontWeight: '900',
  },

  modalBackground: {
    flex: 1,
    backgroundColor:
      'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  previewImage: {
    width: 360,
    height: 520,
    borderRadius: 35,
    resizeMode: 'cover',
  },
});