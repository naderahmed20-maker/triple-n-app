import { cleanImage } from '@/lib/cleanImageService';
import { getMyProfile } from '@/lib/profileService';
import { uploadWardrobeImage } from '@/lib/storageService';
import {
  createWardrobeItem,
  getCurrentUser,
  getMyWardrobeItems,
} from '@/lib/wardrobeService';

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { detectColorFromImage } from './data/colorDetector';
import {
  FashionColor,
  fashionColors,
} from './data/fashionColors';

import {
  ACCESSORY_TYPES,
  CLOTHING_CATEGORIES,
  JACKET_TYPES,
  PANTS_TYPES,
  SHOES_TYPES,
  TOP_TYPES,
  WardrobeType,
} from './data/clothingCategories';

const DEFAULT_LOADING_MESSAGE =
  'Triple N AI is removing the background, centering your clothing and preparing it for your wardrobe.';

const PREPARED_IMAGE_WIDTH = 1280;
const PREPARED_IMAGE_QUALITY = 0.82;

export default function AddItemScreen() {
  const [image, setImage] = useState<string | null>(null);
  const [category, setCategory] = useState('Tops');
  const [subCategory, setSubCategory] = useState('');
  const [name, setName] = useState('');

  const [detectedColor, setDetectedColor] =
    useState<FashionColor>('Black');

  const [shade, setShade] = useState<string>(
    fashionColors.Black.shades[0]
  );

  const [wardrobeItems, setWardrobeItems] =
    useState<any[]>([]);

  const [wardrobeType, setWardrobeType] =
    useState<WardrobeType>('male');

  const [saving, setSaving] = useState(false);
  const [preparingImage, setPreparingImage] =
    useState(false);

  const [processing, setProcessing] =
    useState(false);

  const [loadingMessage, setLoadingMessage] =
    useState(DEFAULT_LOADING_MESSAGE);

  const categories =
    CLOTHING_CATEGORIES[wardrobeType].filter(
      (item) => item !== 'All'
    );

  let subCategories: string[] = [];

  switch (category) {
    case 'Tops':
      subCategories = TOP_TYPES[wardrobeType];
      break;

    case 'Pants':
    case 'Shorts':
    case 'Skirts':
      subCategories = PANTS_TYPES[wardrobeType];
      break;

    case 'Shoes':
    case 'Heels':
      subCategories = SHOES_TYPES[wardrobeType];
      break;

    case 'Jackets':
      subCategories = JACKET_TYPES[wardrobeType];
      break;

    case 'Accessories':
    case 'Bags':
      subCategories = ACCESSORY_TYPES[wardrobeType];
      break;

    case 'Dresses':
      subCategories = [
        'Casual',
        'Evening',
        'Formal',
      ];
      break;

    default:
      subCategories = [];
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadItems() {
        try {
          const user = await getCurrentUser();

          if (!user) {
            router.replace('/login' as any);
            return;
          }

          const profile = await getMyProfile();

          if (!profile) {
            router.replace('/onboarding' as any);
            return;
          }

          const type: WardrobeType =
            profile.gender === 'Female'
              ? 'female'
              : 'male';

          const data =
            await getMyWardrobeItems();

          if (!active) return;

          setWardrobeType(type);
          setWardrobeItems(data);

          const defaultCategory =
            CLOTHING_CATEGORIES[type].find(
              (item) => item !== 'All'
            ) || 'Tops';

          setCategory(defaultCategory);
          setSubCategory('');
        } catch (error: any) {
          Alert.alert(
            'Error',
            error?.message ??
              'Failed to load wardrobe'
          );
        }
      }

      loadItems();

      return () => {
        active = false;
      };
    }, [])
  );

  const matchingCategories: Record<
    string,
    string[]
  > = {
    Tops: [
      'Pants',
      'Shorts',
      'Skirts',
      'Shoes',
      'Heels',
      'Jackets',
      'Accessories',
      'Bags',
    ],

    Pants: [
      'Tops',
      'Shoes',
      'Heels',
      'Jackets',
      'Accessories',
    ],

    Shorts: [
      'Tops',
      'Shoes',
      'Heels',
      'Accessories',
    ],

    Skirts: [
      'Tops',
      'Heels',
      'Shoes',
      'Bags',
      'Accessories',
      'Jackets',
    ],

    Dresses: [
      'Heels',
      'Shoes',
      'Bags',
      'Accessories',
      'Jackets',
    ],

    Shoes: [
      'Tops',
      'Pants',
      'Shorts',
      'Skirts',
      'Dresses',
    ],

    Heels: [
      'Dresses',
      'Skirts',
      'Tops',
    ],

    Jackets: [
      'Tops',
      'Pants',
      'Shorts',
      'Skirts',
      'Dresses',
    ],

    Bags: [
      'Dresses',
      'Skirts',
      'Tops',
      'Heels',
    ],

    Accessories: [
      'Tops',
      'Pants',
      'Shorts',
      'Skirts',
      'Dresses',
    ],
  };

  const bestMatches = wardrobeItems
    .filter((item) => {
      const colorMatch = (
        fashionColors[detectedColor]
          .matches as readonly string[]
      ).includes(item.color);

      const categoryMatch =
        matchingCategories[category]?.includes(
          item.category
        );

      return colorMatch && categoryMatch;
    })
    .slice(0, 4);

  async function prepareSelectedImage(
    uri: string
  ) {
    setPreparingImage(true);

    try {
      const converted =
        await ImageManipulator.manipulateAsync(
          uri,
          [
            {
              resize: {
                width: PREPARED_IMAGE_WIDTH,
              },
            },
          ],
          {
            compress: PREPARED_IMAGE_QUALITY,
            format:
              ImageManipulator.SaveFormat.JPEG,
          }
        );

      setImage(converted.uri);

      const detected =
        await detectColorFromImage(
          converted.uri
        );

      setDetectedColor(detected.color);
      setShade(detected.shade);
    } catch (error: any) {
      Alert.alert(
        'Image error',
        error?.message ||
          'Could not prepare this image.'
      );
    } finally {
      setPreparingImage(false);
    }
  }

  async function takePhoto() {
    if (saving || preparingImage) return;

    const permission =
      await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Camera permission',
        'Allow camera access to photograph your clothing.'
      );
      return;
    }

    const result =
      await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
        cameraType:
          ImagePicker.CameraType.back,
      });

    if (result.canceled) return;

    await prepareSelectedImage(
      result.assets[0].uri
    );
  }

  async function chooseFromGallery() {
    if (saving || preparingImage) return;

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Photos permission',
        'Allow photo access to choose a clothing image.'
      );
      return;
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });

    if (result.canceled) return;

    await prepareSelectedImage(
      result.assets[0].uri
    );
  }

  function chooseImageSource() {
    if (saving || preparingImage) return;

    Alert.alert(
      'Add Clothing Photo',
      'Place one item on a plain background and keep the whole item inside the frame.',
      [
        {
          text: 'Take Photo',
          onPress: takePhoto,
        },
        {
          text: 'Choose from Gallery',
          onPress: chooseFromGallery,
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  }

  function goToWardrobe() {
    if (saving || processing) return;

    // مهم: يرجع لنفس Wardrobe الموجودة
    // بدل إنشاء Wardrobe جديدة.
    router.back();
  }

  async function saveItem() {
    if (saving || preparingImage) return;

    if (!image) {
      Alert.alert(
        'Error',
        'Choose image first'
      );
      return;
    }

    if (
      subCategories.length > 0 &&
      !subCategory
    ) {
      Alert.alert(
        'Item type required',
        `Choose the ${
          category === 'Accessories' ||
          category === 'Bags'
            ? 'accessory type'
            : 'item type'
        } first.`
      );
      return;
    }

    let messageTimer:
      | ReturnType<typeof setTimeout>
      | undefined;

    setSaving(true);
    setProcessing(true);
    setLoadingMessage(
      DEFAULT_LOADING_MESSAGE
    );

    messageTimer = setTimeout(() => {
      setLoadingMessage(
        'Almost done... Finalizing your clothing.'
      );
    }, 8000);

    try {
      const user = await getCurrentUser();

      if (!user) {
        Alert.alert(
          'Login required',
          'Please login first'
        );

        router.replace('/login' as any);
        return;
      }

      if (wardrobeItems.length >= 100) {
        Alert.alert(
          'Limit',
          'Maximum 100 clothing items'
        );
        return;
      }

      const cleanedImage =
        await cleanImage(
          image,
          user.id,
          category
        );

      const cleanedImageUrl =
        await uploadWardrobeImage(
          cleanedImage,
          user.id
        );

      const finalSubCategory =
        subCategories.length > 0
          ? subCategory || null
          : null;

      await createWardrobeItem({
        image: cleanedImageUrl,
        category,
        subCategory:
          finalSubCategory,
        name:
          name.trim() || undefined,
        color: detectedColor,
        shade,
      });

      // ده الحل الأساسي لمشكلة الرجوع 10 مرات.
      router.back();
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message ??
          'Something went wrong'
      );
    } finally {
      if (messageTimer) {
        clearTimeout(messageTimer);
      }

      setProcessing(false);
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={goToWardrobe}
          disabled={saving || processing}
        >
          <Text style={styles.iconText}>
            ‹
          </Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>
          Add New Item
        </Text>

        <TouchableOpacity
          style={styles.iconButton}
          onPress={goToWardrobe}
          disabled={saving || processing}
        >
          <Text style={styles.closeText}>
            ×
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.content
        }
      >
        <TouchableOpacity
          style={styles.mainImageBox}
          onPress={chooseImageSource}
          disabled={
            saving ||
            preparingImage
          }
          activeOpacity={0.9}
        >
          {preparingImage ? (
            <View
              style={styles.preparingBox}
            >
              <ActivityIndicator
                size="large"
                color="#111"
              />

              <Text
                style={
                  styles.preparingText
                }
              >
                Preparing photo...
              </Text>
            </View>
          ) : image ? (
            <Image
              source={{ uri: image }}
              style={styles.mainImage}
            />
          ) : (
            <View
              style={
                styles.uploadPlaceholder
              }
            >
              <Text
                style={styles.uploadIcon}
              >
                📸
              </Text>

              <Text
                style={styles.uploadText}
              >
                Add Clothing Photo
              </Text>

              <Text
                style={styles.uploadHint}
              >
                One item • plain background
                • full item visible
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.photoActions}>
          <TouchableOpacity
            style={
              styles.photoActionButton
            }
            onPress={takePhoto}
            disabled={
              saving ||
              preparingImage
            }
          >
            <Text
              style={
                styles.photoActionIcon
              }
            >
              📷
            </Text>

            <Text
              style={
                styles.photoActionText
              }
            >
              Take Photo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.photoActionButton
            }
            onPress={chooseFromGallery}
            disabled={
              saving ||
              preparingImage
            }
          >
            <Text
              style={
                styles.photoActionIcon
              }
            >
              🖼️
            </Text>

            <Text
              style={
                styles.photoActionText
              }
            >
              Gallery
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cameraTips}>
          <Text
            style={
              styles.cameraTipsTitle
            }
          >
            Best photo for faster cleaning
          </Text>

          <Text
            style={
              styles.cameraTipsText
            }
          >
            Keep the item centered, avoid
            shadows and leave a small space
            around every edge.
          </Text>
        </View>

        <Text style={styles.label}>
          Item Name
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Example: Olive green shirt"
          placeholderTextColor="#777"
          value={name}
          onChangeText={setName}
          editable={!saving}
        />

        <Text style={styles.label}>
          Color Analysis
        </Text>

        <View style={styles.detectedBox}>
          <Text
            style={styles.detectedLabel}
          >
            Main Color
          </Text>

          <View style={styles.categoryRow}>
            {(Object.keys(
              fashionColors
            ) as FashionColor[]).map(
              (color) => (
                <TouchableOpacity
                  key={color}
                  disabled={saving}
                  style={[
                    styles.categoryButton,
                    detectedColor ===
                      color &&
                      styles.activeCategory,
                  ]}
                  onPress={() => {
                    setDetectedColor(
                      color
                    );

                    setShade(
                      fashionColors[color]
                        .shades[0]
                    );
                  }}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      detectedColor ===
                        color &&
                        styles.activeCategoryText,
                    ]}
                  >
                    {color}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        </View>

        <Text style={styles.smallLabel}>
          Choose Shade
        </Text>

        <View style={styles.categoryRow}>
          {fashionColors[
            detectedColor
          ].shades.map((item) => (
            <TouchableOpacity
              key={item}
              disabled={saving}
              style={[
                styles.categoryButton,
                shade === item &&
                  styles.activeCategory,
              ]}
              onPress={() =>
                setShade(item)
              }
            >
              <Text
                style={[
                  styles.categoryText,
                  shade === item &&
                    styles.activeCategoryText,
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>
          Choose Category
        </Text>

        <View style={styles.categoryRow}>
          {categories.map((item) => (
            <TouchableOpacity
              key={item}
              disabled={saving}
              style={[
                styles.categoryButton,
                category === item &&
                  styles.activeCategory,
              ]}
              onPress={() => {
                setCategory(item);
                setSubCategory('');
              }}
            >
              <Text
                style={[
                  styles.categoryText,
                  category === item &&
                    styles.activeCategoryText,
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {subCategories.length > 0 && (
          <>
            <Text style={styles.label}>
              {category ===
                'Accessories' ||
              category === 'Bags'
                ? 'Accessory Type'
                : 'Item Type'}
            </Text>

            <View
              style={
                styles.categoryRow
              }
            >
              {subCategories.map(
                (item) => (
                  <TouchableOpacity
                    key={item}
                    disabled={saving}
                    style={[
                      styles.categoryButton,
                      subCategory ===
                        item &&
                        styles.activeCategory,
                    ]}
                    onPress={() =>
                      setSubCategory(
                        item
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        subCategory ===
                          item &&
                          styles.activeCategoryText,
                      ]}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          </>
        )}

        <Text style={styles.label}>
          Best Matches
        </Text>

        <View style={styles.matchesRow}>
          {bestMatches.length > 0 ? (
            bestMatches.map(
              (item, index) => (
                <View
                  key={`${item.image}-${index}`}
                  style={
                    styles.matchBox
                  }
                >
                  <Image
                    source={{
                      uri: item.image,
                    }}
                    style={
                      styles.matchImage
                    }
                  />
                </View>
              )
            )
          ) : (
            <Text
              style={
                styles.noMatchesText
              }
            >
              No matching items yet
            </Text>
          )}
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.saveButton,
          (saving ||
            preparingImage) &&
            styles.disabledButton,
        ]}
        onPress={saveItem}
        disabled={
          saving ||
          preparingImage
        }
      >
        {saving ? (
          <ActivityIndicator
            color="#111"
          />
        ) : (
          <Text
            style={
              styles.saveButtonText
            }
          >
            Save to Wardrobe
          </Text>
        )}
      </TouchableOpacity>

      {processing && (
        <View
          style={
            styles.loadingOverlay
          }
        >
          <ActivityIndicator
            size="large"
            color="#f4dfc8"
          />

          <Text
            style={
              styles.loadingTitle
            }
          >
            Preparing your wardrobe
            item...
          </Text>

          <Text
            style={
              styles.loadingSubtitle
            }
          >
            {loadingMessage}
          </Text>

          <Text
            style={
              styles.loadingHint
            }
          >
            The optimized photo helps
            RunPod finish faster.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
    paddingHorizontal: 20,
    paddingTop: 55,
  },

  topBar: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:
      'space-between',
    marginBottom: 10,
  },

  iconButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#15171c',
    justifyContent: 'center',
    alignItems: 'center',
  },

  iconText: {
    color: '#fff',
    fontSize: 44,
    marginTop: -6,
  },

  closeText: {
    color: '#fff',
    fontSize: 38,
    marginTop: -4,
  },

  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },

  content: {
    paddingBottom: 120,
  },

  mainImageBox: {
    height: 360,
    backgroundColor: '#e5e5e5',
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },

  mainImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
    backgroundColor: '#e5e5e5',
  },

  uploadPlaceholder: {
    alignItems: 'center',
    paddingHorizontal: 25,
  },

  uploadIcon: {
    fontSize: 42,
    marginBottom: 10,
  },

  uploadText: {
    color: '#111',
    fontSize: 20,
    fontWeight: '900',
  },

  uploadHint: {
    color: '#555',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },

  preparingBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  preparingText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 12,
  },

  photoActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },

  photoActionButton: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#15171c',
    borderWidth: 1,
    borderColor: '#252a31',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoActionIcon: {
    fontSize: 19,
    marginRight: 8,
  },

  photoActionText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
  },

  cameraTips: {
    backgroundColor: '#15171c',
    borderWidth: 1,
    borderColor: '#252a31',
    borderRadius: 18,
    padding: 14,
    marginBottom: 24,
  },

  cameraTipsTitle: {
    color: '#f4dfc8',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 5,
  },

  cameraTipsText: {
    color: '#999',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },

  label: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8,
  },

  input: {
    backgroundColor: '#15171c',
    color: '#fff',
    borderWidth: 1,
    borderColor: '#252a31',
    borderRadius: 18,
    padding: 15,
    fontSize: 16,
    marginBottom: 22,
  },

  detectedBox: {
    backgroundColor: '#15171c',
    borderWidth: 1,
    borderColor: '#252a31',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },

  detectedLabel: {
    color: '#888',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 5,
  },

  smallLabel: {
    color: '#aaa',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },

  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 28,
  },

  categoryButton: {
    backgroundColor: '#15171c',
    borderWidth: 1,
    borderColor: '#252a31',
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: 18,
  },

  activeCategory: {
    backgroundColor: '#f4dfc8',
  },

  categoryText: {
    color: '#aaa',
    fontWeight: '800',
  },

  activeCategoryText: {
    color: '#111',
  },

  matchesRow: {
    flexDirection: 'row',
    justifyContent:
      'space-between',
    marginBottom: 25,
    minHeight: 80,
  },

  matchBox: {
    width: '23%',
    height: 80,
    backgroundColor: '#e5e5e5',
    borderRadius: 16,
    overflow: 'hidden',
  },

  matchImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },

  noMatchesText: {
    color: '#777',
    fontSize: 16,
    fontWeight: '800',
  },

  saveButton: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    backgroundColor: '#f4dfc8',
    paddingVertical: 19,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },

  disabledButton: {
    opacity: 0.65,
  },

  saveButtonText: {
    color: '#111',
    fontSize: 19,
    fontWeight: '900',
  },

  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor:
      'rgba(7,9,13,0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
    zIndex: 9999,
  },

  loadingTitle: {
    color: '#fff',
    fontSize: 23,
    fontWeight: '900',
    marginTop: 24,
    textAlign: 'center',
  },

  loadingSubtitle: {
    color: '#b5b8be',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 23,
    marginTop: 12,
    maxWidth: 320,
  },

  loadingHint: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 22,
  },
});