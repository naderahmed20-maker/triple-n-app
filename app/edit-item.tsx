// app/edit-item.tsx
//
// Triple N - Edit Wardrobe Item
//
// تعديل بيانات القطعة وتغيير صورتها.
//
// عند تغيير الصورة:
//
// 1) تجهيز نسخة محلية مناسبة لـEdgeSAM.
// 2) رفع الصورة الأصلية للتخزين.
// 3) تحديث القطعة إلى queued.
// 4) إنشاء Processing Job.
// 5) إدخال الصورة إلى Scan Item Queue.
// 6) EdgeSAM يعالجها محليًا.
// 7) LocalScanItemProcessingAdapter يحدث القطعة
//    بالصورة الشفافة النهائية.
//
// Summer V1:
//
// - لا توجد Jackets.
// - لا توجد أي بيانات شتوية.
// - season وoccasion داخل Job تكون null.

import {
  useTranslation,
} from '@/lib/i18n';

import {
  uploadWardrobeImage,
} from '@/lib/storageService';

import {
  getCurrentUser,
  getMyWardrobeItems,
  updateWardrobeItem,
  type WardrobeItem,
} from '@/lib/wardrobeService';

import {
  getDefaultScanItemQueueService,
} from '@/scan/core/services/ScanItemQueueService';

import {
  createProcessingBatchId,
  type CreateProcessingJobRequest,
  type ProcessingImageSource,
  type ProcessingWardrobeMetadata,
} from '@/scan/core/queue/QueueTypes';

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import {
  useEffect,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';

/* =========================================================
 * Summer categories
 * ======================================================= */

const CATEGORIES = [
  'Tops',
  'Pants',
  'Shorts',
  'Shoes',
  'Accessories',
] as const;

const COLORS = [
  'Black',
  'White',
  'Blue',
  'Red',
  'Green',
  'Brown',
  'Yellow',
  'Purple',
  'Gray',
  'Beige',
] as const;

type EditableCategory =
  (typeof CATEGORIES)[number];

type EditableColor =
  (typeof COLORS)[number];

/* =========================================================
 * Selected local image
 * ======================================================= */

type SelectedLocalImage = {
  uri:
    string;

  width:
    number;

  height:
    number;

  fileName:
    string | null;

  mimeType:
    string;

  assetId:
    string | null;
};

/* =========================================================
 * Helpers
 * ======================================================= */

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'string'
  ) {
    return error;
  }

  try {
    const serialized =
      JSON.stringify(
        error
      );

    if (
      serialized
    ) {
      return serialized;
    }
  } catch {
    // نستخدم String في النهاية.
  }

  return String(
    error
  );
}

function normalizePositiveDimension(
  value:
    number | null | undefined
): number | null {
  if (
    typeof value !==
      'number' ||
    !Number.isFinite(
      value
    ) ||
    value <=
      0
  ) {
    return null;
  }

  return Math.max(
    1,
    Math.floor(
      value
    )
  );
}

function createQueueSource(
  image:
    SelectedLocalImage
): ProcessingImageSource {
  const createdAt =
    Date.now();

  return {
    uri:
      image.uri,

    kind:
      'photo-library',

    width:
      normalizePositiveDimension(
        image.width
      ),

    height:
      normalizePositiveDimension(
        image.height
      ),

    format:
      'jpeg',

    orientation:
      null,

    fileName:
      image.fileName,

    mimeType:
      image.mimeType,

    fileSizeBytes:
      null,

    assetId:
      image.assetId,

    segmentationSourceId:
      [
        'edit-item',
        createdAt
          .toString(
            36
          ),
      ].join(
        '-'
      ),

    createdAt,

    metadata: {
      source:
        'edit-item',

      imageChanged:
        true,

      processedLocally:
        true,
    },
  };
}

function createWardrobeMetadata(
  input: {
    category:
      EditableCategory;

    itemName:
      string;

    color:
      EditableColor;

    subcategory:
      string | null;
  }
): ProcessingWardrobeMetadata {
  return {
    wardrobeType:
      null,

    category:
      input.category,

    subcategory:
      input.subcategory,

    itemName:
      input.itemName ||
      null,

    color:
      input.color,

    style:
      null,

    season:
      null,

    occasion:
      null,

    isFavorite:
      false,

    metadata: {
      source:
        'edit-item',

      summerMode:
        true,
    },
  };
}

/* =========================================================
 * Screen
 * ======================================================= */

export default function EditItemScreen() {
  const {
    t,
    language,
  } =
    useTranslation();

  const {
    id,
  } =
    useLocalSearchParams<{
      id?:
        | string
        | string[];
    }>();

  const itemId =
    Array.isArray(
      id
    )
      ? id[0]
      : id;

  const [
    loadedItem,
    setLoadedItem,
  ] =
    useState<WardrobeItem | null>(
      null
    );

  const [
    image,
    setImage,
  ] =
    useState(
      ''
    );

  const [
    originalImage,
    setOriginalImage,
  ] =
    useState(
      ''
    );

  const [
    selectedLocalImage,
    setSelectedLocalImage,
  ] =
    useState<SelectedLocalImage | null>(
      null
    );

  const [
    name,
    setName,
  ] =
    useState(
      ''
    );

  const [
    category,
    setCategory,
  ] =
    useState<EditableCategory>(
      'Tops'
    );

  const [
    color,
    setColor,
  ] =
    useState<EditableColor>(
      'Black'
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false
    );

  /* =======================================================
   * Load item
   * ===================================================== */

  useEffect(() => {
    let active =
      true;

    async function loadItem():
      Promise<void> {
      try {
        if (
          !itemId
        ) {
          router.back();

          return;
        }

        const allItems =
          await getMyWardrobeItems();

        const item =
          allItems.find(
            currentItem =>
              currentItem.id ===
              itemId
          );

        if (
          !item
        ) {
          Alert.alert(
            t(
              'common.error'
            ),
            t(
              'editItem.notFound'
            )
          );

          router.back();

          return;
        }

        if (
          !active
        ) {
          return;
        }

        setLoadedItem(
          item
        );

        setImage(
          item.image ||
          ''
        );

        setOriginalImage(
          item.image ||
          ''
        );

        setName(
          item.name ||
          ''
        );

        setSelectedLocalImage(
          null
        );

        if (
          CATEGORIES.includes(
            item.category as
              EditableCategory
          )
        ) {
          setCategory(
            item.category as
              EditableCategory
          );
        } else {
          /**
           * أي Jacket قديمة لن تبقى كفئة
           * قابلة للاختيار داخل Summer V1.
           */
          setCategory(
            'Tops'
          );
        }

        const normalizedColor =
          item.color ===
          'Grey'
            ? 'Gray'
            : item.color;

        if (
          COLORS.includes(
            normalizedColor as
              EditableColor
          )
        ) {
          setColor(
            normalizedColor as
              EditableColor
          );
        } else {
          setColor(
            'Black'
          );
        }
      } catch (error) {
        if (
          !active
        ) {
          return;
        }

        Alert.alert(
          t(
            'common.error'
          ),
          getUnknownErrorMessage(
            error
          ) ||
          t(
            'editItem.loadFailed'
          )
        );

        router.back();
      } finally {
        if (
          active
        ) {
          setLoading(
            false
          );
        }
      }
    }

    void loadItem();

    return () => {
      active =
        false;
    };
  }, [
    itemId,
    t,
  ]);

  /* =======================================================
   * Translations
   * ===================================================== */

  function translateCategory(
    value:
      string
  ): string {
    switch (
      value
    ) {
      case 'Top':
      case 'Tops':
        return t(
          'category.tops'
        );

      case 'Pants':
        return t(
          'category.pants'
        );

      case 'Shorts':
        return t(
          'category.shorts'
        );

      case 'Shoes':
        return t(
          'category.shoes'
        );

      case 'Accessory':
      case 'Accessories':
        return t(
          'category.accessories'
        );

      default:
        return value;
    }
  }

  function translateColor(
    value:
      string
  ): string {
    if (
      language !==
        'Italian'
    ) {
      return value;
    }

    const italianColors:
      Record<
        string,
        string
      > = {
      Black:
        'Nero',

      White:
        'Bianco',

      Blue:
        'Blu',

      Red:
        'Rosso',

      Green:
        'Verde',

      Brown:
        'Marrone',

      Yellow:
        'Giallo',

      Purple:
        'Viola',

      Gray:
        'Grigio',

      Grey:
        'Grigio',

      Beige:
        'Beige',
    };

    return (
      italianColors[
        value
      ] ||
      value
    );
  }

  /* =======================================================
   * Select replacement photo
   * ===================================================== */

  async function changePhoto():
    Promise<void> {
    if (
      saving ||
      loading
    ) {
      return;
    }

    try {
      const permission =
        await ImagePicker
          .requestMediaLibraryPermissionsAsync();

      if (
        !permission.granted
      ) {
        Alert.alert(
          t(
            'addItem.photosPermission'
          ),
          t(
            'addItem.photosPermissionMessage'
          )
        );

        return;
      }

      const result =
        await ImagePicker
          .launchImageLibraryAsync({
            mediaTypes: [
              'images',
            ],

            allowsMultipleSelection:
              false,

            quality:
              1,
          });

      const selectedAsset =
        result.assets?.[0];

      if (
        result.canceled ||
        !selectedAsset
      ) {
        return;
      }

      const converted =
        await ImageManipulator
          .manipulateAsync(
            selectedAsset.uri,
            [
              {
                resize: {
                  width:
                    1280,
                },
              },
            ],
            {
              compress:
                0.9,

              format:
                ImageManipulator
                  .SaveFormat
                  .JPEG,
            }
          );

      const convertedWidth =
        normalizePositiveDimension(
          converted.width
        ) ??
        normalizePositiveDimension(
          selectedAsset.width
        ) ??
        1;

      const convertedHeight =
        normalizePositiveDimension(
          converted.height
        ) ??
        normalizePositiveDimension(
          selectedAsset.height
        ) ??
        1;

      setSelectedLocalImage({
        uri:
          converted.uri,

        width:
          convertedWidth,

        height:
          convertedHeight,

        fileName:
          selectedAsset.fileName ??
          `edit-item-${Date.now()}.jpg`,

        mimeType:
          'image/jpeg',

        assetId:
          selectedAsset.assetId ??
          null,
      });

      setImage(
        converted.uri
      );
    } catch (error) {
      Alert.alert(
        t(
          'addItem.photoError'
        ),
        getUnknownErrorMessage(
          error
        ) ||
        t(
          'addItem.photoErrorMessage'
        )
      );
    }
  }

  /* =======================================================
   * Save metadata only
   * ===================================================== */

  async function saveMetadataOnly():
    Promise<void> {
    if (
      !itemId
    ) {
      return;
    }

    const categoryChanged =
      loadedItem?.category !==
      category;

    await updateWardrobeItem(
      itemId,
      {
        name:
          name.trim(),

        category,

        /**
         * لا نحتفظ بـsubcategory قديمة
         * إذا تغيرت الفئة الأساسية.
         */
        subCategory:
          categoryChanged
            ? null
            : loadedItem
                ?.subCategory ??
              null,

        color,
      }
    );

    router.back();
  }

  /* =======================================================
   * Queue replacement image
   * ===================================================== */

  async function queueReplacementImage(
    userId:
      string,
    localImage:
      SelectedLocalImage
  ): Promise<void> {
    if (
      !itemId
    ) {
      throw new Error(
        'The wardrobe item ID is missing.'
      );
    }

    const queueService =
      getDefaultScanItemQueueService();

    await queueService
      .initialize(
        false
      );

    if (
      !queueService
        .hasExecutor()
    ) {
      throw new Error(
        'The local image processing system is not ready.'
      );
    }

    /**
     * نحفظ نسخة الصورة الأصلية في التخزين،
     * لكن هذه ليست النتيجة النهائية.
     *
     * الصورة المحلية تدخل EdgeSAM.
     */
    const uploadedOriginalImage =
      await uploadWardrobeImage(
        localImage.uri,
        userId
      );

    const batchId =
      createProcessingBatchId();

    const queueId =
      queueService
        .getSnapshot()
        .queueId;

    const categoryChanged =
      loadedItem?.category !==
      category;

    const resolvedSubcategory =
      categoryChanged
        ? null
        : loadedItem
            ?.subCategory ??
          null;

    /**
     * القطعة تبقى موجودة في الدولاب،
     * لكن حالتها تصبح queued حتى ينتهي EdgeSAM.
     */
    await updateWardrobeItem(
      itemId,
      {
        image:
          uploadedOriginalImage,

        name:
          name.trim(),

        category,

        subCategory:
          resolvedSubcategory,

        color,

        original_image_path:
          uploadedOriginalImage,

        cleaned_image_path:
          null,

        processing_status:
          'queued',

        processing_error:
          null,

        processing_started_at:
          null,

        processing_finished_at:
          null,
      }
    );

    const source =
      createQueueSource(
        localImage
      );

    const wardrobe =
      createWardrobeMetadata({
        category,

        itemName:
          name.trim(),

        color,

        subcategory:
          resolvedSubcategory,
      });

    const request:
      CreateProcessingJobRequest = {
      queueId,

      batchId,

      wardrobeItemId:
        itemId,

      source,

      wardrobe,

      priority:
        10,

      metadata: {
        source:
          'edit-item',

        operation:
          'replace-image',

        userId,

        originalRemoteImage:
          uploadedOriginalImage,

        summerMode:
          true,
      },
    };

    try {
      const enqueueResult =
        await queueService
          .enqueueItem(
            request,
            true
          );

      if (
        enqueueResult
          .accepted
          .length ===
          0
      ) {
        const firstRejection =
          enqueueResult
            .rejected[0];

        throw new Error(
          firstRejection
            ?.error
            .message ||
          'The replacement image could not be added to the processing queue.'
        );
      }

      router.replace({
        pathname:
          '/processing-image',

        params: {
          batchId,
        },
      } as never);
    } catch (error) {
      const message =
        getUnknownErrorMessage(
          error
        );

      /**
       * لو فشل إدخال الـJob، نظهر حالة الفشل
       * بدل ترك القطعة معلقة على queued.
       */
      try {
        await updateWardrobeItem(
          itemId,
          {
            processing_status:
              'failed',

            processing_error:
              message,

            processing_finished_at:
              new Date()
                .toISOString(),
          }
        );
      } catch {
        // لا نخفي خطأ الـQueue الأصلي.
      }

      throw error;
    }
  }

  /* =======================================================
   * Save
   * ===================================================== */

  async function saveChanges():
    Promise<void> {
    if (
      !itemId ||
      saving
    ) {
      return;
    }

    setSaving(
      true
    );

    try {
      const user =
        await getCurrentUser();

      if (
        !user
      ) {
        Alert.alert(
          t(
            'auth.loginRequired'
          ),
          t(
            'auth.loginFirst'
          )
        );

        router.replace(
          '/login' as never
        );

        return;
      }

      const imageChanged =
        selectedLocalImage !==
          null &&
        image !==
          originalImage;

      if (
        !imageChanged ||
        !selectedLocalImage
      ) {
        await saveMetadataOnly();

        return;
      }

      await queueReplacementImage(
        user.id,
        selectedLocalImage
      );
    } catch (error) {
      Alert.alert(
        t(
          'common.error'
        ),
        getUnknownErrorMessage(
          error
        ) ||
        t(
          'outfit.saveFailedMessage'
        )
      );
    } finally {
      setSaving(
        false
      );
    }
  }

  /* =======================================================
   * Loading
   * ===================================================== */

  if (
    loading
  ) {
    return (
      <ScrollView
        style={
          styles.container
        }
        contentContainerStyle={
          styles.center
        }
      >
        <ActivityIndicator
          size="large"
          color="#f4dfc8"
        />

        <Text
          style={
            styles.loadingText
          }
        >
          {t(
            'common.loading'
          )}
        </Text>
      </ScrollView>
    );
  }

  /* =======================================================
   * UI
   * ===================================================== */

  return (
    <ScrollView
      style={
        styles.container
      }
      contentContainerStyle={
        styles.content
      }
      showsVerticalScrollIndicator={
        false
      }
      keyboardShouldPersistTaps="handled"
    >
      <Text
        style={
          styles.title
        }
      >
        {t(
          'editItem.title'
        )}
      </Text>

      {image !==
      '' ? (
        <Image
          source={{
            uri:
              image,
          }}
          style={
            styles.itemImage
          }
          resizeMode="contain"
        />
      ) : null}

      {selectedLocalImage ? (
        <Text
          style={
            styles.processingNotice
          }
        >
          The new photo will be processed locally before it replaces the current item.
        </Text>
      ) : null}

      <TouchableOpacity
        style={[
          styles.changePhotoButton,

          saving &&
            styles.disabledButton,
        ]}
        onPress={
          changePhoto
        }
        disabled={
          saving
        }
      >
        <Text
          style={
            styles.changePhotoText
          }
        >
          📸{' '}
          {t(
            'editItem.changePhoto'
          )}
        </Text>
      </TouchableOpacity>

      <Text
        style={
          styles.label
        }
      >
        {t(
          'addItem.itemName'
        )}
      </Text>

      <TextInput
        style={
          styles.input
        }
        placeholder={t(
          'editItem.itemNamePlaceholder'
        )}
        placeholderTextColor="#777"
        value={
          name
        }
        onChangeText={
          setName
        }
        editable={
          !saving
        }
      />

      <Text
        style={
          styles.label
        }
      >
        {t(
          'editItem.chooseCategory'
        )}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={
          false
        }
        style={
          styles.rowScroll
        }
        contentContainerStyle={
          styles.rowContent
        }
      >
        {CATEGORIES.map(
          item => (
            <TouchableOpacity
              key={
                item
              }
              style={[
                styles.categoryButton,

                category ===
                  item &&
                  styles.activeCategory,
              ]}
              onPress={() => {
                setCategory(
                  item
                );
              }}
              disabled={
                saving
              }
            >
              <Text
                style={[
                  styles.categoryText,

                  category ===
                    item &&
                    styles
                      .activeCategoryText,
                ]}
              >
                {translateCategory(
                  item
                )}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>

      <Text
        style={
          styles.label
        }
      >
        {t(
          'editItem.chooseColor'
        )}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={
          false
        }
        style={
          styles.rowScroll
        }
        contentContainerStyle={
          styles.rowContent
        }
      >
        {COLORS.map(
          item => (
            <TouchableOpacity
              key={
                item
              }
              style={[
                styles.colorButton,

                color ===
                  item &&
                  styles.activeColor,
              ]}
              onPress={() => {
                setColor(
                  item
                );
              }}
              disabled={
                saving
              }
            >
              <Text
                style={[
                  styles.colorText,

                  color ===
                    item &&
                    styles
                      .activeColorText,
                ]}
              >
                {translateColor(
                  item
                )}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.button,

          saving &&
            styles.disabledButton,
        ]}
        onPress={
          saveChanges
        }
        disabled={
          saving
        }
      >
        {saving ? (
          <ActivityIndicator
            color="#111"
          />
        ) : (
          <Text
            style={
              styles.buttonText
            }
          >
            {t(
              'editItem.saveChanges'
            )}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.cancelButton,

          saving &&
            styles.disabledButton,
        ]}
        onPress={() => {
          router.back();
        }}
        disabled={
          saving
        }
      >
        <Text
          style={
            styles.cancelText
          }
        >
          {t(
            'common.cancel'
          )}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* =========================================================
 * Styles
 * ======================================================= */

const styles =
  StyleSheet.create({
    container: {
      flex:
        1,

      backgroundColor:
        '#111',
    },

    center: {
      flexGrow:
        1,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    loadingText: {
      marginTop:
        12,

      color:
        '#aaa',

      fontSize:
        14,

      fontWeight:
        '700',
    },

    content: {
      padding:
        20,

      paddingTop:
        70,

      paddingBottom:
        40,
    },

    title: {
      marginBottom:
        25,

      color:
        'white',

      fontSize:
        34,

      fontWeight:
        'bold',

      textAlign:
        'center',
    },

    itemImage: {
      width:
        '100%',

      height:
        260,

      marginBottom:
        12,

      borderRadius:
        25,

      backgroundColor:
        '#e5e5e5',
    },

    processingNotice: {
      marginBottom:
        15,

      paddingHorizontal:
        10,

      color:
        '#bcbcbc',

      fontSize:
        12,

      lineHeight:
        18,

      textAlign:
        'center',
    },

    changePhotoButton: {
      marginBottom:
        25,

      padding:
        14,

      borderRadius:
        25,

      alignItems:
        'center',

      backgroundColor:
        '#222',
    },

    changePhotoText: {
      color:
        'white',

      fontSize:
        16,

      fontWeight:
        'bold',
    },

    label: {
      marginBottom:
        12,

      color:
        'white',

      fontSize:
        18,

      fontWeight:
        'bold',
    },

    input: {
      marginBottom:
        25,

      padding:
        15,

      borderWidth:
        1,

      borderColor:
        '#333',

      borderRadius:
        15,

      color:
        'white',

      backgroundColor:
        '#1c1c1c',

      fontSize:
        16,
    },

    rowScroll: {
      marginBottom:
        25,
    },

    rowContent: {
      paddingRight:
        10,
    },

    categoryButton: {
      marginRight:
        10,

      paddingVertical:
        10,

      paddingHorizontal:
        14,

      borderWidth:
        1,

      borderColor:
        '#444',

      borderRadius:
        20,
    },

    activeCategory: {
      backgroundColor:
        'white',
    },

    categoryText: {
      color:
        '#aaa',

      fontSize:
        15,
    },

    activeCategoryText: {
      color:
        '#111',

      fontWeight:
        'bold',
    },

    colorButton: {
      marginRight:
        10,

      paddingVertical:
        10,

      paddingHorizontal:
        14,

      borderWidth:
        1,

      borderColor:
        '#444',

      borderRadius:
        20,

      backgroundColor:
        '#1c1c1c',
    },

    activeColor: {
      backgroundColor:
        '#f59e0b',
    },

    colorText: {
      color:
        '#aaa',

      fontSize:
        15,

      fontWeight:
        'bold',
    },

    activeColorText: {
      color:
        '#111',
    },

    button: {
      marginBottom:
        15,

      padding:
        18,

      borderRadius:
        30,

      alignItems:
        'center',

      backgroundColor:
        '#fff',
    },

    buttonText: {
      color:
        '#111',

      fontSize:
        18,

      fontWeight:
        'bold',
    },

    cancelButton: {
      padding:
        16,

      borderRadius:
        30,

      alignItems:
        'center',

      backgroundColor:
        '#222',
    },

    cancelText: {
      color:
        'white',

      fontSize:
        16,

      fontWeight:
        'bold',
    },

    disabledButton: {
      opacity:
        0.55,
    },
  });