import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  useTranslation,
} from '@/lib/i18n';

import {
  getMyProfile,
} from '@/lib/profileService';

import {
  uploadWardrobeImage,
} from '@/lib/storageService';

import {
  createWardrobeItem,
  getCurrentUser,
  getMyWardrobeItems,
  updateWardrobeItem,
} from '@/lib/wardrobeService';

import {
  createProcessingBatchId,
} from '@/scan/core/queue/QueueTypes';

import {
  enqueueScanItem,
} from '@/scan/core/services/ScanItemQueueService';


import {
  router,
  useFocusEffect,
} from 'expo-router';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  View,
} from 'react-native';

import {
  detectColorFromImage,
} from './data/colorDetector';

import {
  FashionColor,
  fashionColors,
} from './data/fashionColors';

import {
  CLOTHING_CATEGORIES,
  PANTS_TYPES,
  SHOES_TYPES,
  TOP_TYPES,
  WardrobeType,
} from './data/clothingCategories';

import {
  pauseScanItemProcessingQueue,
  startScanItemProcessingQueue,
} from '@/scan/core/background';

/* =========================================================
 * Constants
 * ======================================================= */

const PREPARED_IMAGE_WIDTH =
  1280;

const MAX_WARDROBE_ITEMS =
  100;

const PROCESSING_QUEUE_ID =
  'triple-n-scan-item-queue';

const CAPTURED_TEMPLATE_IMAGE_KEY =
  'CAPTURED_TEMPLATE_IMAGE';

/**
 * الفئات غير المتاحة مؤقتًا في أول نسخة:
 *
 * - Jackets
 * - Accessories
 * - Bags
 *
 * ولا نسمح بإضافة صورة من Gallery.
 * الطريقة الوحيدة هي Scan Item.
 */
const TEMPORARILY_DISABLED_CATEGORIES =
  new Set([
    'All',
    'Jackets',
    'Jacket',
    'Accessories',
    'Accessory',
    'Bags',
    'Bag',
  ]);

/**
 * أنواع شتوية لا تظهر في النسخة الصيفية.
 */
const TEMPORARILY_DISABLED_SUBCATEGORIES =
  new Set([
    'Hoodie',
    'Sweater',
    'Sweatshirt',
    'Pullover',
    'Cardigan',
    'Turtleneck',
    'Coat',
    'Jacket',
    'Puffer',
    'Puffer Jacket',
    'Winter Jacket',
    'Rain Jacket',
    'Boots',
    'Ankle Boots',
    'Chelsea Boots',
    'Snow Boots',
    'Scarf',
    'Beanie',
    'Gloves',
  ]);

/* =========================================================
 * Types
 * ======================================================= */

type ScanDraftImage = {
  id:
    string;

  uri:
    string;

  width:
    number;

  height:
    number;

  templateId:
    string | null;

  name:
    string;

  color:
    FashionColor;

  shade:
    string;

  category:
    string;

  subCategory:
    string;
};

/* =========================================================
 * Matching categories
 * ======================================================= */

const MATCHING_CATEGORIES:
  Record<
    string,
    readonly string[]
  > = {
  Tops: [
    'Pants',
    'Shorts',
    'Skirts',
    'Shoes',
    'Heels',
  ],

  Pants: [
    'Tops',
    'Shoes',
    'Heels',
  ],

  Shorts: [
    'Tops',
    'Shoes',
    'Heels',
  ],

  Skirts: [
    'Tops',
    'Heels',
    'Shoes',
  ],

  Dresses: [
    'Heels',
    'Shoes',
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
};

/* =========================================================
 * Helpers
 * ======================================================= */

function createDraftId():
  string {
  return [
    'scan-draft',
    Date.now()
      .toString(
        36
      ),
    Math.random()
      .toString(
        36
      )
      .slice(
        2,
        10
      ),
  ].join(
    '-'
  );
}

function normalizeCategory(
  value:
    string | null | undefined,
  fallback:
    string
): string {
  if (
    typeof value !==
      'string'
  ) {
    return fallback;
  }

  const normalized =
    value.trim();

  if (
    normalized.length ===
      0 ||
    normalized ===
      'Unknown' ||
    TEMPORARILY_DISABLED_CATEGORIES
      .has(
        normalized
      )
  ) {
    return fallback;
  }

  return normalized;
}

function normalizeSubCategory(
  value:
    string | null | undefined
): string {
  if (
    typeof value !==
      'string'
  ) {
    return '';
  }

  const normalized =
    value.trim();

  if (
    normalized.length ===
      0 ||
    normalized ===
      'Unknown' ||
    TEMPORARILY_DISABLED_SUBCATEGORIES
      .has(
        normalized
      )
  ) {
    return '';
  }

  return normalized;
}

function filterSummerSubCategories(
  values:
    readonly string[]
): string[] {
  return values.filter(
    value =>
      !TEMPORARILY_DISABLED_SUBCATEGORIES
        .has(
          value
        )
  );
}

function getSubCategories(
  category:
    string,
  wardrobeType:
    WardrobeType
): string[] {
  switch (
    category
  ) {
    case 'Tops':
      return filterSummerSubCategories(
        TOP_TYPES[
          wardrobeType
        ]
      );

    case 'Pants':
    case 'Shorts':
    case 'Skirts':
      return filterSummerSubCategories(
        PANTS_TYPES[
          wardrobeType
        ]
      );

    case 'Shoes':
    case 'Heels':
      return filterSummerSubCategories(
        SHOES_TYPES[
          wardrobeType
        ]
      );

    case 'Dresses':
      return [
        'Casual',
        'Evening',
        'Formal',
      ];

    default:
      return [];
  }
}

function resolveQueueImageFormat(
  uri:
    string
):
  | 'png'
  | 'jpeg' {
  const normalized =
    uri
      .split(
        '?'
      )[0]
      .split(
        '#'
      )[0]
      .toLowerCase();

  return normalized.endsWith(
    '.png'
  )
    ? 'png'
    : 'jpeg';
}

/* =========================================================
 * Screen
 * ======================================================= */

export default function AddItemScreen() {
  const {
    t,
    language,
  } =
    useTranslation();

  const [
    draft,
    setDraft,
  ] =
    useState<
      ScanDraftImage | null
    >(
      null
    );

  const [
    wardrobeItems,
    setWardrobeItems,
  ] =
    useState<
      any[]
    >(
      []
    );

  const [
    wardrobeType,
    setWardrobeType,
  ] =
    useState<
      WardrobeType
    >(
      'male'
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    preparingImage,
    setPreparingImage,
  ] =
    useState(
      false
    );

  const [
    savingAction,
    setSavingAction,
  ] =
    useState<
      'wardrobe' |
      'more' |
      null
    >(
      null
    );

    const initialCameraOpenedRef =
    useRef(
      false
    );

  const isItalian =
    language ===
      'Italian';

  const tr =
    useCallback(
      (
        english:
          string,
        italian:
          string
      ) =>
        isItalian
          ? italian
          : english,
      [
        isItalian,
      ]
    );

  /* =======================================================
   * Categories
   * ===================================================== */

  const categories =
    useMemo(
      () =>
        CLOTHING_CATEGORIES[
          wardrobeType
        ].filter(
          category =>
            !TEMPORARILY_DISABLED_CATEGORIES
              .has(
                category
              )
        ),
      [
        wardrobeType,
      ]
    );

  const defaultCategory =
    useMemo(
      () =>
        categories[0] ??
        'Tops',
      [
        categories,
      ]
    );

  const subCategories =
    useMemo(
      () =>
        draft
          ? getSubCategories(
              draft.category,
              wardrobeType
            )
          : [],
      [
        draft
          ?.category,
        wardrobeType,
      ]
    );

  /* =======================================================
   * Best matches
   * ===================================================== */

  const bestMatches =
    useMemo(
      () => {
        if (
          !draft
        ) {
          return [];
        }

        const matchingCategories =
          MATCHING_CATEGORIES[
            draft.category
          ] ??
          [];

        return wardrobeItems
          .filter(
            item => {
              if (
                !item ||
                item.processing_status ===
                  'queued' ||
                item.processing_status ===
                  'processing' ||
                item.processing_status ===
                  'failed' ||
                item.processing_status ===
                  'cancelled'
              ) {
                return false;
              }

              if (
                TEMPORARILY_DISABLED_CATEGORIES
                  .has(
                    item.category
                  )
              ) {
                return false;
              }

              const colorMatch =
                (
                  fashionColors[
                    draft.color
                  ].matches as
                    readonly string[]
                ).includes(
                  item.color
                );

              const categoryMatch =
                matchingCategories
                  .includes(
                    item.category
                  );

              return (
                colorMatch &&
                categoryMatch
              );
            }
          )
          .slice(
            0,
            4
          );
      },
      [
        draft,
        wardrobeItems,
      ]
    );

  /* =======================================================
   * User and wardrobe
   * ===================================================== */

  useFocusEffect(
    useCallback(
      () => {
        let active =
          true;

        async function loadScreenData():
          Promise<void> {
          try {
            const user =
              await getCurrentUser();

            if (
              !user
            ) {
              router.replace(
                '/login' as never
              );

              return;
            }

            const profile =
              await getMyProfile();

            if (
              !profile
            ) {
              router.replace(
                '/onboarding' as never
              );

              return;
            }

            const resolvedWardrobeType:
              WardrobeType =
              profile.gender ===
                'Female'
                ? 'female'
                : 'male';

            const items =
              await getMyWardrobeItems();

            if (
              !active
            ) {
              return;
            }

            setWardrobeType(
              resolvedWardrobeType
            );

            setWardrobeItems(
              items
            );
          } catch (
            error:
              unknown
          ) {
            if (
              !active
            ) {
              return;
            }

            const message =
              error instanceof
                Error
                ? error.message
                : t(
                    'wardrobe.loadFailed'
                  );

            Alert.alert(
              t(
                'common.error'
              ),
              message
            );
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

        void loadScreenData();

        return () => {
          active =
            false;
        };
      },
      [
        t,
      ]
    )
  );

  /* =======================================================
   * Open Scan Item automatically
   * ===================================================== */

  useEffect(
    () => {
      if (
        loading ||
        draft ||
        preparingImage ||
        initialCameraOpenedRef
          .current
      ) {
        return;
      }

      let active =
        true;

      async function openInitialCamera():
        Promise<void> {
        const storedCapture =
          await AsyncStorage
            .getItem(
              CAPTURED_TEMPLATE_IMAGE_KEY
            );

        if (
          !active ||
          storedCapture
        ) {
          return;
        }

        initialCameraOpenedRef
          .current =
          true;

        router.push(
          '/template-camera' as never
        );
      }

      void openInitialCamera();

      return () => {
        active =
          false;
      };
    },
    [
      loading,
      draft,
      preparingImage,
    ]
  );

/* =======================================================
   * Receive Scan Item capture
   * ===================================================== */

  useFocusEffect(
    useCallback(
      () => {
        let active =
          true;

        async function loadCapturedScan():
          Promise<void> {
          try {
            const storedValue =
              await AsyncStorage
                .getItem(
                  CAPTURED_TEMPLATE_IMAGE_KEY
                );

            if (
              !storedValue ||
              !active
            ) {
              return;
            }

            let captured: {
              uri?:
                string;

              templateId?:
                string;

              category?:
                string;

              subCategory?:
                string;

              width?:
                number;

              height?:
                number;
            };

            try {
              captured =
                JSON.parse(
                  storedValue
                );
            } catch {
              throw new Error(
                'The captured photo information could not be read.'
              );
            }

            if (
              !captured.uri
            ) {
              throw new Error(
                'The captured photo could not be found.'
              );
            }

            setPreparingImage(
              true
            );

            console.log(
              'SCAN ITEM: received image',
              captured.uri
            );

            const imageWidth =
              typeof captured.width ===
                'number' &&
              Number.isFinite(
                captured.width
              ) &&
              captured.width >
                0
                ? Math.floor(
                    captured.width
                  )
                : PREPARED_IMAGE_WIDTH;

            const imageHeight =
              typeof captured.height ===
                'number' &&
              Number.isFinite(
                captured.height
              ) &&
              captured.height >
                0
                ? Math.floor(
                    captured.height
                  )
                : PREPARED_IMAGE_WIDTH;

            let detectedColor: {
              color:
                FashionColor;

              shade:
                string;
            };

            try {
              detectedColor =
                await detectColorFromImage(
                  captured.uri
                );
            } catch (
              colorError
            ) {
              console.log(
                'SCAN ITEM COLOR DETECTION ERROR:',
                colorError
              );

              detectedColor = {
                color:
                  'Black',

                shade:
                  fashionColors
                    .Black
                    .shades[0],
              };
            }

            if (
              !active
            ) {
              return;
            }

            const resolvedCategory =
              normalizeCategory(
                captured.category,
                defaultCategory
              );

            const availableSubCategories =
              getSubCategories(
                resolvedCategory,
                wardrobeType
              );

            const requestedSubCategory =
              normalizeSubCategory(
                captured.subCategory
              );

            const resolvedSubCategory =
              requestedSubCategory &&
              availableSubCategories
                .includes(
                  requestedSubCategory
                )
                ? requestedSubCategory
                : '';


                setSavingAction(
  null
);

            setDraft({
              id:
                createDraftId(),

              uri:
                captured.uri,

              width:
                Math.max(
                  1,
                  imageWidth
                ),

              height:
                Math.max(
                  1,
                  imageHeight
                ),

              templateId:
                captured.templateId
                  ?.trim() ||
                null,

              name:
                '',

              color:
                detectedColor.color,

              shade:
                detectedColor.shade,

              category:
                resolvedCategory,

              subCategory:
                resolvedSubCategory,
            });

            await AsyncStorage
              .removeItem(
                CAPTURED_TEMPLATE_IMAGE_KEY
              )
              .catch(
                error => {
                  console.log(
                    'SCAN ITEM STORAGE CLEANUP ERROR:',
                    error
                  );
                }
              );

            console.log(
              'SCAN ITEM: draft created successfully'
            );
          } catch (
            error:
              unknown
          ) {
            const message =
              error instanceof
                Error
                ? error.message
                : t(
                    'addItem.photoErrorMessage'
                  );

            console.log(
              'SCAN ITEM CAPTURE ERROR:',
              error
            );

            if (
              active
            ) {
              Alert.alert(
                t(
                  'addItem.photoError'
                ),
                message
              );
            }
          } finally {
            if (
              active
            ) {
              setPreparingImage(
                false
              );
            }
          }
        }

        void loadCapturedScan();

        return () => {
          active =
            false;
        };
      },
      [
        defaultCategory,
        wardrobeType,
        t,
      ]
    )
  );

  /* =======================================================
   * Draft editing
   * ===================================================== */

  function updateDraft(
    changes:
      Partial<
        ScanDraftImage
      >
  ): void {
    setDraft(
      current =>
        current
          ? {
              ...current,
              ...changes,
            }
          : current
    );
  }

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
      case 'Tops':
      case 'Top':
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

      case 'Dresses':
      case 'Dress':
        return t(
          'category.dresses'
        );

      case 'Skirts':
      case 'Skirt':
        return t(
          'category.skirts'
        );

      case 'Heels':
      case 'Heel':
        return t(
          'category.heels'
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
      !isItalian
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

      Orange:
        'Arancione',

      Pink:
        'Rosa',

      Navy:
        'Blu navy',

      Cream:
        'Crema',

      Gold:
        'Oro',

      Silver:
        'Argento',
    };

    return (
      italianColors[
        value
      ] ??
      value
    );
  }

  function translateSubCategory(
    value:
      string
  ): string {
    if (
      !isItalian
    ) {
      return value;
    }

    const translations:
      Record<
        string,
        string
      > = {
      Casual:
        'Casual',

      Evening:
        'Da sera',

      Formal:
        'Formale',

      Shirt:
        'Camicia',

      TShirt:
        'T-shirt',

      'T-Shirt':
        'T-shirt',

      Polo:
        'Polo',

      TankTop:
        'Canotta',

      'Tank Top':
        'Canotta',

      CropTop:
        'Crop top',

      'Crop Top':
        'Crop top',

      Blouse:
        'Blusa',

      Jeans:
        'Jeans',

      Chinos:
        'Chino',

      Trousers:
        'Pantaloni',

      Joggers:
        'Jogger',

      Cargo:
        'Cargo',

      Sneakers:
        'Sneakers',

      Sandals:
        'Sandali',

      Loafers:
        'Mocassini',

      Flats:
        'Ballerine',
    };

    return (
      translations[
        value
      ] ??
      value
    );
  }

  /* =======================================================
   * Navigation
   * ===================================================== */

  async function openScanItem():
  Promise<void> {
  if (
    savingAction ||
    preparingImage
  ) {
    return;
  }

  try {
    await pauseScanItemProcessingQueue();
  } catch (
    error
  ) {
    console.log(
      'SCAN ITEM QUEUE PAUSE ERROR:',
      error
    );
  }

  router.push(
    '/template-camera' as never
  );
}

  function goBack():
    void {
    if (
      savingAction
    ) {
      return;
    }

    router.back();
  }

  /* =======================================================
   * Validation
   * ===================================================== */

  function validateDraft(
    currentDraft:
      ScanDraftImage
  ): boolean {
    if (
      TEMPORARILY_DISABLED_CATEGORIES
        .has(
          currentDraft.category
        )
    ) {
      Alert.alert(
        t(
          'common.error'
        ),
        tr(
          'This category is temporarily unavailable.',
          'Questa categoria non è temporaneamente disponibile.'
        )
      );

      return false;
    }

    const availableSubCategories =
      getSubCategories(
        currentDraft.category,
        wardrobeType
      );

    if (
      availableSubCategories
        .length >
        0 &&
      !currentDraft
        .subCategory
    ) {
      Alert.alert(
        t(
          'addItem.itemTypeRequired'
        ),
        t(
          'addItem.chooseItemType'
        )
      );

      return false;
    }

    return true;
  }

  /* =======================================================
   * Queue current item
   * ===================================================== */

  async function queueCurrentDraft(
    destination:
      'wardrobe' |
      'more'
  ): Promise<void> {
    if (
      !draft ||
      savingAction
    ) {
      return;
    }

    if (
      !validateDraft(
        draft
      )
    ) {
      return;
    }

    if (
      wardrobeItems.length >=
        MAX_WARDROBE_ITEMS
    ) {
      Alert.alert(
        t(
          'wardrobe.itemLimit'
        ),
        t(
          'wardrobe.itemLimit'
        )
      );

      return;
    }

    setSavingAction(
      destination
    );

    let createdItemId:
      string | null =
        null;

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

      /**
       * نرفع الصورة الأصلية فقط.
       *
       * لا ننتظر EdgeSAM هنا.
       * المعالجة ستحدث من Queue بعد دخول
       * العنصر إلى الدولاب.
       */
      const originalImageUrl =
        await uploadWardrobeImage(
          draft.uri,
          user.id
        );

      /**
       * createWardrobeItem الحالي ينشئ العنصر
       * بحالة ready، لذلك نحوله مباشرة إلى queued
       * قبل تشغيل Queue.
       */
      const wardrobeItem =
        await createWardrobeItem({
          image:
            originalImageUrl,

          category:
            draft.category,

          subCategory:
            draft.subCategory ||
            null,

          name:
            draft.name
              .trim() ||
            undefined,

          color:
            draft.color,

          shade:
            draft.shade,
        });

      createdItemId =
        wardrobeItem.id;

      await updateWardrobeItem(
        wardrobeItem.id,
        {
          image:
            originalImageUrl,

          original_image_path:
            originalImageUrl,

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

      const createdAt =
        Date.now();

      const batchId =
        createProcessingBatchId();

      const imageFormat =
        resolveQueueImageFormat(
          draft.uri
        );

const enqueueResult =
  await enqueueScanItem(
    {
      queueId:
        PROCESSING_QUEUE_ID,

      batchId,

      wardrobeItemId:
        wardrobeItem.id,

      source: {
        uri:
          draft.uri,

        kind:
          'camera',

        width:
          draft.width,

        height:
          draft.height,

        format:
          imageFormat,

        orientation:
          null,

        fileName:
          imageFormat ===
            'png'
            ? `${draft.id}.png`
            : `${draft.id}.jpg`,

        mimeType:
          imageFormat ===
            'png'
            ? 'image/png'
            : 'image/jpeg',

        fileSizeBytes:
          null,

        assetId:
          null,

        segmentationSourceId:
          draft.id,

        createdAt,

        metadata: {
          templateId:
            draft.templateId,

          capturedWithScanItem:
            true,

          originalImageUrl,
        },
      },

      wardrobe: {
        wardrobeType,

        category:
          draft.category,

        subcategory:
          draft.subCategory ||
          null,

        itemName:
          draft.name
            .trim() ||
          null,

        color:
          draft.color,

        style:
          null,

        season:
          null,

        occasion:
          null,

        isFavorite:
          false,

        metadata: {
          shade:
            draft.shade,

          templateId:
            draft.templateId,

          summerVersion:
            true,
        },
      },

      priority:
        0,

      metadata: {
        source:
          'scan-item',

        processingLocation:
          'wardrobe',

        originalImageUrl,

        templateId:
          draft.templateId,
      },
    },

    /**
     * ممنوع بدء EdgeSAM أثناء الإضافة.
     * كل القطع تدخل Queue في الانتظار فقط.
     */
    false
  );

      if (
        enqueueResult
          .accepted
          .length ===
          0
      ) {
        const rejection =
          enqueueResult
            .rejected[0];

        throw new Error(
          rejection
            ?.error
            .message ??
          tr(
            'The item could not be added to the processing queue.',
            'Non è stato possibile aggiungere il capo alla coda di elaborazione.'
          )
        );
      }

      if (
  destination ===
    'more'
) {
  /**
   * لازم نفك قفل الأزرار قبل الانتقال،
   * حتى شاشة القطعة التالية تسمح باختيار
   * Pants أو Shorts أو Shoes وغيرها.
   */
  setSavingAction(
    null
  );

  setDraft(
    null
  );

  /**
   * الكاميرا ستفتح من هنا فقط.
   * نخلي الـref على true لمنع useEffect
   * من محاولة فتح كاميرا ثانية في نفس الوقت.
   */
  initialCameraOpenedRef
    .current =
    true;

  router.replace(
    '/template-camera' as never
  );

  return;
}

/**
 * لا يصل الكود إلى هنا إلا عند الضغط على:
 * Add to Wardrobe
 *
 * آخر قطعة أضيفت بالفعل للانتظار،
 * والآن فقط نبدأ معالجة الدفعة كلها.
 */
await startScanItemProcessingQueue();

router.replace(
  '/wardrobe' as never
);
    } catch (
      error:
        unknown
    ) {
      const message =
        error instanceof
          Error
          ? error.message
          : t(
              'outfit.saveFailedMessage'
            );

      /**
       * إذا تم إنشاء العنصر ثم فشل إدخاله
       * إلى Queue، نظهره في الدولاب كفشل
       * بدل تركه بحالة queued إلى الأبد.
       */
      if (
        createdItemId
      ) {
        try {
          await updateWardrobeItem(
            createdItemId,
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
        } catch (
          updateError
        ) {
          console.log(
            'WARDROBE PLACEHOLDER FAILURE UPDATE ERROR:',
            updateError
          );
        }
      }

      Alert.alert(
        t(
          'addItem.couldNotAdd'
        ),
        message
      );
    } finally {
      setSavingAction(
        null
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
      <View
        style={
          styles.loadingScreen
        }
      >
        <ActivityIndicator
          size="large"
          color="#f4dfc8"
        />
      </View>
    );
  }

  /* =======================================================
   * Render
   * ===================================================== */

  return (
    <View
      style={
        styles.container
      }
    >
      <View
        style={
          styles.topBar
        }
      >
        <TouchableOpacity
          style={
            styles.iconButton
          }
          onPress={
            goBack
          }
          disabled={
            savingAction !==
            null
          }
        >
          <Text
            style={
              styles.iconText
            }
          >
            ‹
          </Text>
        </TouchableOpacity>

        <View
          style={
            styles.headerCenter
          }
        >
          <Text
            style={
              styles.headerTitle
            }
          >
            {t(
              'addItem.title'
            )}
          </Text>
        </View>

        <TouchableOpacity
          style={
            styles.iconButton
          }
          onPress={
            goBack
          }
          disabled={
            savingAction !==
            null
          }
        >
          <Text
            style={
              styles.closeText
            }
          >
            ×
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={
          false
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={
          styles.content
        }
      >
        <TouchableOpacity
          style={
            styles.mainImageBox
          }
          activeOpacity={
            0.9
          }
          onPress={
            openScanItem
          }
          disabled={
            preparingImage ||
            savingAction !==
              null
          }
        >
          {preparingImage ? (
            <View
              style={
                styles.preparingBox
              }
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
                {t(
                  'addItem.preparingPhoto'
                )}
              </Text>
            </View>
          ) : draft ? (
            <Image
              source={{
                uri:
                  draft.uri,
              }}
              style={
                styles.mainImage
              }
            />
          ) : (
            <View
              style={
                styles.uploadPlaceholder
              }
            >
              <Text
                style={
                  styles.uploadIcon
                }
              >
                📷
              </Text>

              <Text
                style={
                  styles.uploadText
                }
              >
                {t(
                  'addItem.scanItem'
                )}
              </Text>

              <Text
                style={
                  styles.uploadHint
                }
              >
                {tr(
                  'Scan a clothing item to add it to your wardrobe.',
                  'Scansiona un capo per aggiungerlo al guardaroba.'
                )}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {!draft ? (
          <>
            <TouchableOpacity
              style={
                styles.scanButton
              }
              onPress={
                openScanItem
              }
              disabled={
                preparingImage ||
                savingAction !==
                  null
              }
            >
              <Text
                style={
                  styles.scanButtonIcon
                }
              >
                📷
              </Text>

              <Text
                style={
                  styles.scanButtonText
                }
              >
                {t(
                  'addItem.scanItem'
                )}
              </Text>
            </TouchableOpacity>

            <View
              style={
                styles.cameraTips
              }
            >
              <Text
                style={
                  styles.cameraTipsTitle
                }
              >
                {t(
                  'addItem.bestPhotoTitle'
                )}
              </Text>

              <Text
                style={
                  styles.cameraTipsText
                }
              >
                {t(
                  'addItem.bestPhotoText'
                )}
              </Text>
            </View>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={
                styles.rescanButton
              }
              onPress={
                openScanItem
              }
              disabled={
                savingAction !==
                null
              }
            >
              <Text
                style={
                  styles.rescanButtonText
                }
              >
                {tr(
                  'Scan again',
                  'Scansiona di nuovo'
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
                'addItem.itemNamePlaceholder'
              )}
              placeholderTextColor="#777"
              value={
                draft.name
              }
              onChangeText={
                value =>
                  updateDraft({
                    name:
                      value,
                  })
              }
              editable={
                savingAction ===
                null
              }
            />

            <Text
              style={
                styles.label
              }
            >
              {t(
                'addItem.colorAnalysis'
              )}
            </Text>

            <View
              style={
                styles.detectedBox
              }
            >
              <Text
                style={
                  styles.detectedLabel
                }
              >
                {t(
                  'addItem.mainColor'
                )}
              </Text>

              <View
                style={
                  styles.categoryRow
                }
              >
                {(
                  Object.keys(
                    fashionColors
                  ) as
                    FashionColor[]
                ).map(
                  color => (
                    <TouchableOpacity
                      key={
                        color
                      }
                      disabled={
                        savingAction !==
                        null
                      }
                      style={[
                        styles.categoryButton,

                        draft.color ===
                          color &&
                          styles.activeCategory,
                      ]}
                      onPress={() =>
                        updateDraft({
                          color,

                          shade:
                            fashionColors[
                              color
                            ].shades[0],
                        })
                      }
                    >
                      <Text
                        style={[
                          styles.categoryText,

                          draft.color ===
                            color &&
                            styles.activeCategoryText,
                        ]}
                      >
                        {translateColor(
                          color
                        )}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </View>

            <Text
              style={
                styles.smallLabel
              }
            >
              {t(
                'addItem.chooseShade'
              )}
            </Text>

            <View
              style={
                styles.categoryRow
              }
            >
              {fashionColors[
                draft.color
              ].shades.map(
                shade => (
                  <TouchableOpacity
                    key={
                      shade
                    }
                    disabled={
                      savingAction !==
                      null
                    }
                    style={[
                      styles.categoryButton,

                      draft.shade ===
                        shade &&
                        styles.activeCategory,
                    ]}
                    onPress={() =>
                      updateDraft({
                        shade,
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.categoryText,

                        draft.shade ===
                          shade &&
                          styles.activeCategoryText,
                      ]}
                    >
                      {translateColor(
                        shade
                      )}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>

            <Text
              style={
                styles.label
              }
            >
              {t(
                'addItem.chooseCategory'
              )}
            </Text>

            <View
              style={
                styles.categoryRow
              }
            >
              {categories.map(
                category => (
                  <TouchableOpacity
                    key={
                      category
                    }
                    disabled={
                      savingAction !==
                      null
                    }
                    style={[
                      styles.categoryButton,

                      draft.category ===
                        category &&
                        styles.activeCategory,
                    ]}
                    onPress={() =>
                      updateDraft({
                        category,

                        subCategory:
                          '',
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.categoryText,

                        draft.category ===
                          category &&
                          styles.activeCategoryText,
                      ]}
                    >
                      {translateCategory(
                        category
                      )}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>

            {subCategories.length >
            0 ? (
              <>
                <Text
                  style={
                    styles.label
                  }
                >
                  {t(
                    'addItem.itemType'
                  )}
                </Text>

                <View
                  style={
                    styles.categoryRow
                  }
                >
                  {subCategories.map(
                    subCategory => (
                      <TouchableOpacity
                        key={
                          subCategory
                        }
                        disabled={
                          savingAction !==
                          null
                        }
                        style={[
                          styles.categoryButton,

                          draft.subCategory ===
                            subCategory &&
                            styles.activeCategory,
                        ]}
                        onPress={() =>
                          updateDraft({
                            subCategory,
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.categoryText,

                            draft.subCategory ===
                              subCategory &&
                              styles.activeCategoryText,
                          ]}
                        >
                          {translateSubCategory(
                            subCategory
                          )}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              </>
            ) : null}

            <Text
              style={
                styles.label
              }
            >
              {t(
                'addItem.bestMatches'
              )}
            </Text>

            <View
              style={
                styles.matchesRow
              }
            >
              {bestMatches.length >
              0 ? (
                bestMatches.map(
                  (
                    item,
                    index
                  ) => (
                    <View
                      key={
                        item.id ??
                        `${item.image}-${index}`
                      }
                      style={
                        styles.matchBox
                      }
                    >
                      <Image
                        source={{
                          uri:
                            item.image,
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
                  {t(
                    'addItem.noMatches'
                  )}
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {draft ? (
        <View
          style={
            styles.bottomActions
          }
        >
          <TouchableOpacity
            style={[
              styles.saveButton,

              (
                preparingImage ||
                savingAction !==
                  null
              ) &&
                styles.disabledButton,
            ]}
            disabled={
              preparingImage ||
              savingAction !==
                null
            }
            onPress={() => {
              void queueCurrentDraft(
                'wardrobe'
              );
            }}
          >
            {savingAction ===
            'wardrobe' ? (
              <ActivityIndicator
                color="#111"
              />
            ) : (
              <Text
                style={
                  styles.saveButtonText
                }
              >
                {tr(
                  'Add to Wardrobe',
                  'Aggiungi al guardaroba'
                )}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.addMoreButton,

              (
                preparingImage ||
                savingAction !==
                  null
              ) &&
                styles.disabledButton,
            ]}
            disabled={
              preparingImage ||
              savingAction !==
                null
            }
            onPress={() => {
              void queueCurrentDraft(
                'more'
              );
            }}
          >
            {savingAction ===
            'more' ? (
              <ActivityIndicator
                color="#f4dfc8"
              />
            ) : (
              <Text
                style={
                  styles.addMoreButtonText
                }
              >
                {tr(
                  'Add More Items',
                  'Aggiungi altri capi'
                )}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

/* =========================================================
 * Styles
 * ======================================================= */

const styles =
  StyleSheet.create({
    loadingScreen: {
      flex:
        1,

      alignItems:
        'center',

      justifyContent:
        'center',

      backgroundColor:
        '#07090d',
    },

    container: {
      flex:
        1,

      paddingHorizontal:
        20,

      paddingTop:
        55,

      backgroundColor:
        '#07090d',
    },

    topBar: {
      height:
        60,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      marginBottom:
        10,
    },

    headerCenter: {
      flex:
        1,

      alignItems:
        'center',

      paddingHorizontal:
        8,
    },

    iconButton: {
      width:
        52,

      height:
        52,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        18,

      backgroundColor:
        '#15171c',
    },

    iconText: {
      marginTop:
        -6,

      color:
        '#fff',

      fontSize:
        44,
    },

    closeText: {
      marginTop:
        -4,

      color:
        '#fff',

      fontSize:
        38,
    },

    headerTitle: {
      color:
        '#fff',

      fontSize:
        24,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    content: {
      paddingBottom:
        210,
    },

    mainImageBox: {
      height:
        360,

      overflow:
        'hidden',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom:
        12,

      borderRadius:
        24,

      backgroundColor:
        '#e5e5e5',
    },

    mainImage: {
      width:
        '100%',

      height:
        '100%',

      resizeMode:
        'contain',

      backgroundColor:
        '#e5e5e5',
    },

    uploadPlaceholder: {
      alignItems:
        'center',

      paddingHorizontal:
        25,
    },

    uploadIcon: {
      marginBottom:
        10,

      fontSize:
        42,
    },

    uploadText: {
      color:
        '#111',

      fontSize:
        20,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    uploadHint: {
      marginTop:
        8,

      color:
        '#555',

      fontSize:
        13,

      lineHeight:
        19,

      fontWeight:
        '700',

      textAlign:
        'center',
    },

    preparingBox: {
      alignItems:
        'center',

      justifyContent:
        'center',
    },

    preparingText: {
      marginTop:
        12,

      color:
        '#111',

      fontSize:
        15,

      fontWeight:
        '800',
    },

    scanButton: {
      minHeight:
        62,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom:
        14,

      borderRadius:
        32,

      backgroundColor:
        '#f4dfc8',
    },

    scanButtonIcon: {
      marginRight:
        9,

      fontSize:
        20,
    },

    scanButtonText: {
      color:
        '#111',

      fontSize:
        18,

      fontWeight:
        '900',
    },

    rescanButton: {
      minHeight:
        48,

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom:
        24,

      borderWidth:
        1,

      borderColor:
        '#343840',

      borderRadius:
        24,

      backgroundColor:
        '#15171c',
    },

    rescanButtonText: {
      color:
        '#f4dfc8',

      fontSize:
        14,

      fontWeight:
        '900',
    },

    cameraTips: {
      padding:
        14,

      marginBottom:
        24,

      borderWidth:
        1,

      borderColor:
        '#252a31',

      borderRadius:
        18,

      backgroundColor:
        '#15171c',
    },

    cameraTipsTitle: {
      marginBottom:
        5,

      color:
        '#f4dfc8',

      fontSize:
        14,

      fontWeight:
        '900',
    },

    cameraTipsText: {
      color:
        '#999',

      fontSize:
        12,

      lineHeight:
        18,

      fontWeight:
        '700',
    },

    label: {
      marginBottom:
        8,

      color:
        '#fff',

      fontSize:
        20,

      fontWeight:
        '900',
    },

    input: {
      padding:
        15,

      marginBottom:
        22,

      borderWidth:
        1,

      borderColor:
        '#252a31',

      borderRadius:
        18,

      color:
        '#fff',

      fontSize:
        16,

      backgroundColor:
        '#15171c',
    },

    detectedBox: {
      padding:
        16,

      marginBottom:
        14,

      borderWidth:
        1,

      borderColor:
        '#252a31',

      borderRadius:
        18,

      backgroundColor:
        '#15171c',
    },

    detectedLabel: {
      marginBottom:
        5,

      color:
        '#888',

      fontSize:
        14,

      fontWeight:
        '800',
    },

    smallLabel: {
      marginBottom:
        10,

      color:
        '#aaa',

      fontSize:
        15,

      fontWeight:
        '800',
    },

    categoryRow: {
      flexDirection:
        'row',

      flexWrap:
        'wrap',

      gap:
        10,

      marginBottom:
        28,
    },

    categoryButton: {
      paddingVertical:
        11,

      paddingHorizontal:
        15,

      borderWidth:
        1,

      borderColor:
        '#252a31',

      borderRadius:
        18,

      backgroundColor:
        '#15171c',
    },

    activeCategory: {
      borderColor:
        '#f4dfc8',

      backgroundColor:
        '#f4dfc8',
    },

    categoryText: {
      color:
        '#aaa',

      fontWeight:
        '800',
    },

    activeCategoryText: {
      color:
        '#111',
    },

    matchesRow: {
      minHeight:
        80,

      flexDirection:
        'row',

      justifyContent:
        'space-between',

      marginBottom:
        25,
    },

    matchBox: {
      width:
        '23%',

      height:
        80,

      overflow:
        'hidden',

      borderRadius:
        16,

      backgroundColor:
        '#e5e5e5',
    },

    matchImage: {
      width:
        '100%',

      height:
        '100%',

      resizeMode:
        'contain',
    },

    noMatchesText: {
      color:
        '#777',

      fontSize:
        16,

      fontWeight:
        '800',
    },

    bottomActions: {
      position:
        'absolute',

      left:
        20,

      right:
        20,

      bottom:
        24,

      gap:
        10,
    },

    saveButton: {
      minHeight:
        60,

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingVertical:
        18,

      borderRadius:
        35,

      backgroundColor:
        '#f4dfc8',

      shadowColor:
        '#000',

      shadowOffset: {
        width:
          0,

        height:
          6,
      },

      shadowOpacity:
        0.28,

      shadowRadius:
        10,

      elevation:
        8,
    },

    saveButtonText: {
      color:
        '#111',

      fontSize:
        19,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    addMoreButton: {
      minHeight:
        56,

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingVertical:
        16,

      borderWidth:
        1,

      borderColor:
        '#f4dfc8',

      borderRadius:
        30,

      backgroundColor:
        '#15171c',
    },

    addMoreButtonText: {
      color:
        '#f4dfc8',

      fontSize:
        16,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    disabledButton: {
      opacity:
        0.55,
    },
  });