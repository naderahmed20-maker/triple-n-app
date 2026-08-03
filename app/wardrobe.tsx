import {
  useTranslation,
} from '@/lib/i18n';

import {
  getMyProfile,
} from '@/lib/profileService';

import {
  WardrobeItem,
  deleteWardrobeItems,
  getCurrentUser,
  getMyWardrobeItems,
  toggleWardrobeFavorite,
} from '@/lib/wardrobeService';

import {
  getDefaultScanItemQueueService,
} from '@/scan/core/services/ScanItemQueueService';

import type {
  ProcessingJob,
  ProcessingQueueSnapshot,
} from '@/scan/core/queue/QueueTypes';

import {
  router,
  useFocusEffect,
} from 'expo-router';

import {
  useCallback,
  useEffect,
  useMemo,
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
  ClothingCategory,
  WardrobeType,
  getCategoryTranslationKey,
  normalizeCategory,
} from './data/clothingCategories';

/* =========================================================
 * Types
 * ======================================================= */

type DisplayItem =
  WardrobeItem & {
    originalIndex:
      number;

    queueJob:
      ProcessingJob | null;

    displayImage:
      string;

    progress:
      number;

    pending:
      boolean;

    failed:
      boolean;

    ready:
      boolean;
  };

/* =========================================================
 * Constants
 * ======================================================= */

/**
 * النسخة الصيفية لا تعرض الجاكيتات.
 *
 * حتى لو كانت هناك عناصر Jackets قديمة داخل قاعدة البيانات،
 * لن تظهر داخل الدولاب أو الفلاتر.
 */
const HIDDEN_SUMMER_CATEGORIES =
  new Set([
    'Jacket',
    'Jackets',
  ]);

/* =========================================================
 * Helpers
 * ======================================================= */

function clampProgress(
  value:
    number
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value
    )
  );
}

function isWinterCategory(
  category:
    string | null | undefined
): boolean {
  if (
    !category
  ) {
    return false;
  }

  return HIDDEN_SUMMER_CATEGORIES
    .has(
      category.trim()
    );
}

function isDatabasePendingItem(
  item:
    WardrobeItem
): boolean {
  return (
    item.processing_status ===
      'queued' ||
    item.processing_status ===
      'processing'
  );
}

function isDatabaseFailedItem(
  item:
    WardrobeItem
): boolean {
  return (
    item.processing_status ===
      'failed' ||
    item.processing_status ===
      'cancelled'
  );
}

function isQueueJobPending(
  job:
    ProcessingJob | null
): boolean {
  if (
    !job
  ) {
    return false;
  }

  return (
    job.status ===
      'queued' ||
    job.status ===
      'preparing' ||
    job.status ===
      'processing' ||
    job.status ===
      'finalizing' ||
    job.status ===
      'paused' ||
    job.status ===
      'interrupted' ||
    job.status ===
      'retry-scheduled'
  );
}

function isQueueJobFailed(
  job:
    ProcessingJob | null
): boolean {
  if (
    !job
  ) {
    return false;
  }

  return (
    job.status ===
      'failed' ||
    job.status ===
      'cancelled'
  );
}

function isQueueJobCompleted(
  job:
    ProcessingJob | null
): boolean {
  return (
    job?.status ===
      'completed'
  );
}

function getQueueJobForItem(
  jobs:
    readonly ProcessingJob[],
  wardrobeItemId:
    string
): ProcessingJob | null {
  let selectedJob:
    ProcessingJob | null =
      null;

  for (
    const job of
    jobs
  ) {
    if (
      job.wardrobeItemId !==
      wardrobeItemId
    ) {
      continue;
    }

    if (
      !selectedJob
    ) {
      selectedJob =
        job;

      continue;
    }

    if (
      job.timing
        .lastUpdatedAt >
      selectedJob.timing
        .lastUpdatedAt
    ) {
      selectedJob =
        job;
    }
  }

  return selectedJob;
}

function getDisplayImage(
  item:
    WardrobeItem,
  queueJob:
    ProcessingJob | null
): string {
  /**
   * بعد اكتمال المعالجة نعرض الصورة الناتجة مباشرة
   * من Queue، دون انتظار جلب Supabase التالي.
   */
  if (
    queueJob?.output
      ?.processedImageUri
  ) {
    return queueJob
      .output
      .processedImageUri;
  }

  /**
   * أثناء المعالجة نعرض الصورة الأصلية.
   */
  if (
    isQueueJobPending(
      queueJob
    ) ||
    isDatabasePendingItem(
      item
    )
  ) {
    return (
      item.original_image_path ||
      item.image ||
      ''
    );
  }

  return (
    item.cleaned_image_path ||
    item.image ||
    item.original_image_path ||
    ''
  );
}

function getItemProgress(
  item:
    WardrobeItem,
  queueJob:
    ProcessingJob | null
): number {
  if (
    queueJob
  ) {
    if (
      queueJob.status ===
        'completed'
    ) {
      return 1;
    }

    return clampProgress(
      queueJob.progress
        .progress
    );
  }

  if (
    item.processing_status ===
      'ready' ||
    !item.processing_status
  ) {
    return 1;
  }

  if (
    item.processing_status ===
      'processing'
  ) {
    /**
     * قيمة بصرية مبدئية فقط لحين وصول أول
     * Queue progress event.
     */
    return 0.08;
  }

  return 0;
}

function toClothingCategory(
  category?:
    string
): ClothingCategory {
  const normalized =
    normalizeCategory(
      category
    );

  switch (
    normalized
  ) {
    case 'All':
    case 'Tops':
    case 'Pants':
    case 'Shorts':
    case 'Shoes':
    case 'Accessories':
    case 'Dresses':
    case 'Skirts':
    case 'Heels':
    case 'Bags':
      return normalized;

    default:
      return 'Accessories';
  }
}

/* =========================================================
 * Screen
 * ======================================================= */

export default function WardrobeScreen() {
  const {
    t,
  } =
    useTranslation();

  const [
    items,
    setItems,
  ] =
    useState<
      WardrobeItem[]
    >([]);

  const [
    queueSnapshot,
    setQueueSnapshot,
  ] =
    useState<
      ProcessingQueueSnapshot | null
    >(
      null
    );

  const [
    deleteMode,
    setDeleteMode,
  ] =
    useState(
      false
    );

  const [
    selectedItems,
    setSelectedItems,
  ] =
    useState<
      number[]
    >(
      []
    );

  const [
    previewImage,
    setPreviewImage,
  ] =
    useState<
      string | null
    >(
      null
    );

  const [
    selectedCategory,
    setSelectedCategory,
  ] =
    useState<
      ClothingCategory
    >(
      'All'
    );

  const [
    searchText,
    setSearchText,
  ] =
    useState(
      ''
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

  /* =======================================================
   * Categories
   * ===================================================== */

  const categories =
    useMemo<
      ClothingCategory[]
    >(
      () =>
        CLOTHING_CATEGORIES[
          wardrobeType
        ].filter(
          category =>
            category !==
              'Jackets'
        ),
      [
        wardrobeType,
      ]
    );

  useEffect(() => {
    if (
      !categories.includes(
        selectedCategory
      )
    ) {
      setSelectedCategory(
        'All'
      );
    }
  }, [
    categories,
    selectedCategory,
  ]);

  /* =======================================================
   * Database loading
   * ===================================================== */

  const refreshWardrobeItems =
    useCallback(
      async () => {
        const data =
          await getMyWardrobeItems();

        setItems(
          data.filter(
            item =>
              !isWinterCategory(
                item.category
              )
          )
        );
      },
      []
    );

  useFocusEffect(
    useCallback(() => {
      let active =
        true;

      async function loadItems():
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

          const type:
            WardrobeType =
            profile.gender ===
              'Female'
              ? 'female'
              : 'male';

          const data =
            await getMyWardrobeItems();

          if (
            !active
          ) {
            return;
          }

          setWardrobeType(
            type
          );

          setItems(
            data.filter(
              item =>
                !isWinterCategory(
                  item.category
                )
            )
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
        }
      }

      void loadItems();

      return () => {
        active =
          false;
      };
    }, [
      t,
    ])
  );

  /* =======================================================
   * Local queue subscription
   * ===================================================== */

  useEffect(() => {
    let active =
      true;

    let unsubscribe:
      (() => void) | null =
        null;

    try {
      const queueService =
        getDefaultScanItemQueueService();

      setQueueSnapshot(
        queueService
          .getSnapshot()
      );

      unsubscribe =
        queueService.subscribe(
          (
            snapshot,
            event
          ) => {
            if (
              !active
            ) {
              return;
            }

            setQueueSnapshot(
              snapshot
            );

            /**
             * بعد اكتمال أو فشل Job نعيد قراءة
             * عنصر الدولاب من Supabase.
             *
             * الصورة النهائية تظهر فورًا من output،
             * وإعادة القراءة توحّد الحالة الدائمة.
             */
            if (
              event?.type ===
                'job-completed' ||
              event?.type ===
                'job-failed' ||
              event?.type ===
                'job-cancelled' ||
              event?.type ===
                'queue-completed'
            ) {
              void refreshWardrobeItems()
                .catch(
                  error => {
                    console.log(
                      'WARDROBE QUEUE REFRESH ERROR:',
                      error
                    );
                  }
                );
            }
          }
        );
    } catch (
      error:
        unknown
    ) {
      console.log(
        'WARDROBE QUEUE SUBSCRIPTION ERROR:',
        error
      );
    }

    return () => {
      active =
        false;

      unsubscribe?.();
    };
  }, [
    refreshWardrobeItems,
  ]);

  /* =======================================================
   * Database fallback polling
   * ===================================================== */

  const hasPendingItems =
    useMemo(
      () =>
        items.some(
          item => {
            const queueJob =
              getQueueJobForItem(
                queueSnapshot
                  ?.jobs ??
                [],
                item.id
              );

            return (
              isDatabasePendingItem(
                item
              ) ||
              isQueueJobPending(
                queueJob
              )
            );
          }
        ),
      [
        items,
        queueSnapshot,
      ]
    );

  useEffect(() => {
    if (
      !hasPendingItems
    ) {
      return;
    }

    let active =
      true;

    let refreshing =
      false;

    const interval =
      setInterval(
        async () => {
          if (
            refreshing
          ) {
            return;
          }

          refreshing =
            true;

          try {
            const data =
              await getMyWardrobeItems();

            if (
              active
            ) {
              setItems(
                data.filter(
                  item =>
                    !isWinterCategory(
                      item.category
                    )
                )
              );
            }
          } catch (
            error:
              unknown
          ) {
            console.log(
              'WARDROBE REFRESH ERROR:',
              error instanceof
                Error
                ? error.message
                : error
            );
          } finally {
            refreshing =
              false;
          }
        },
        2500
      );

    return () => {
      active =
        false;

      clearInterval(
        interval
      );
    };
  }, [
    hasPendingItems,
  ]);

  /* =======================================================
   * Display items
   * ===================================================== */

  const displayItems =
    useMemo<
      DisplayItem[]
    >(
      () =>
        items.map(
          (
            item,
            index
          ) => {
            const queueJob =
              getQueueJobForItem(
                queueSnapshot
                  ?.jobs ??
                [],
                item.id
              );

            const queuePending =
              isQueueJobPending(
                queueJob
              );

            const queueFailed =
              isQueueJobFailed(
                queueJob
              );

            const queueCompleted =
              isQueueJobCompleted(
                queueJob
              );

            const pending =
              queuePending ||
              (
                !queueCompleted &&
                isDatabasePendingItem(
                  item
                )
              );

            const failed =
              queueFailed ||
              (
                !queueCompleted &&
                isDatabaseFailedItem(
                  item
                )
              );

            const ready =
              queueCompleted ||
              (
                !pending &&
                !failed &&
                (
                  !item.processing_status ||
                  item.processing_status ===
                    'ready'
                )
              );

            return {
              ...item,

              originalIndex:
                index,

              queueJob,

              displayImage:
                getDisplayImage(
                  item,
                  queueJob
                ),

              progress:
                getItemProgress(
                  item,
                  queueJob
                ),

              pending,

              failed,

              ready,
            };
          }
        ),
      [
        items,
        queueSnapshot,
      ]
    );

  const filteredItems =
    useMemo(
      () =>
        displayItems.filter(
          item => {
            const search =
              searchText
                .trim()
                .toLowerCase();

            const itemCategory =
              toClothingCategory(
                item.category
              );

            const categoryMatch =
              selectedCategory ===
                'All' ||
              itemCategory ===
                selectedCategory;

            const searchMatch =
              search.length ===
                0 ||
              item.category
                .toLowerCase()
                .includes(
                  search
                ) ||
              (
                item.name ||
                ''
              )
                .toLowerCase()
                .includes(
                  search
                ) ||
              (
                item.color ||
                ''
              )
                .toLowerCase()
                .includes(
                  search
                ) ||
              (
                item.subCategory ||
                ''
              )
                .toLowerCase()
                .includes(
                  search
                ) ||
              (
                item.shade ||
                ''
              )
                .toLowerCase()
                .includes(
                  search
                );

            return (
              categoryMatch &&
              searchMatch
            );
          }
        ),
      [
        displayItems,
        searchText,
        selectedCategory,
      ]
    );

  /* =======================================================
   * Translation
   * ===================================================== */

  function replaceCount(
    value:
      string,
    count:
      number
  ): string {
    return value.replace(
      '{{count}}',
      String(
        count
      )
    );
  }

  function translateCategory(
    category:
      ClothingCategory
  ): string {
    return t(
      getCategoryTranslationKey(
        category
      )
    );
  }

  /* =======================================================
   * Selection
   * ===================================================== */

  function toggleSelect(
    index:
      number
  ): void {
    if (
      !deleteMode
    ) {
      return;
    }

    setSelectedItems(
      current => {
        if (
          current.includes(
            index
          )
        ) {
          return current.filter(
            item =>
              item !==
              index
          );
        }

        return [
          ...current,
          index,
        ];
      }
    );
  }

  async function deleteSelectedItems():
    Promise<void> {
    const idsToDelete =
      selectedItems
        .map(
          index =>
            items[
              index
            ]?.id
        )
        .filter(
          Boolean
        ) as string[];

    if (
      idsToDelete.length ===
      0
    ) {
      return;
    }

    try {
      await deleteWardrobeItems(
        idsToDelete
      );

      setItems(
        current =>
          current.filter(
            (
              _,
              index
            ) =>
              !selectedItems.includes(
                index
              )
          )
      );

      setSelectedItems(
        []
      );

      setDeleteMode(
        false
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
              'wardrobe.deleteFailedMessage'
            );

      Alert.alert(
        t(
          'wardrobe.deleteFailed'
        ),
        message
      );
    }
  }

  /* =======================================================
   * Favorite
   * ===================================================== */

  async function toggleFavorite(
    indexToChange:
      number
  ): Promise<void> {
    const item =
      items[
        indexToChange
      ];

    if (
      !item?.id
    ) {
      return;
    }

    const queueJob =
      getQueueJobForItem(
        queueSnapshot
          ?.jobs ??
        [],
        item.id
      );

    if (
      isQueueJobPending(
        queueJob
      ) ||
      isDatabasePendingItem(
        item
      )
    ) {
      return;
    }

    const newFavorite =
      !item.favorite;

    try {
      await toggleWardrobeFavorite(
        item.id,
        newFavorite
      );

      setItems(
        current =>
          current.map(
            (
              oldItem,
              index
            ) =>
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
    } catch (
      error:
        unknown
    ) {
      const message =
        error instanceof
          Error
          ? error.message
          : t(
              'wardrobe.favoriteFailed'
            );

      Alert.alert(
        t(
          'common.error'
        ),
        message
      );
    }
  }

  /* =======================================================
   * Item actions
   * ===================================================== */

  function openItem(
    item:
      DisplayItem
  ): void {
    if (
      deleteMode
    ) {
      toggleSelect(
        item.originalIndex
      );

      return;
    }

    /**
     * أثناء المعالجة لا نفتح شاشة أو رسالة.
     * القطعة تظل تكمل بصمت داخل الدولاب.
     */
    if (
      item.pending
    ) {
      return;
    }

    /**
     * العنصر الفاشل يبقى قابلًا للحذف من وضع الحذف،
     * ولا نعرض نصوص حالة داخل الكارت.
     */
    if (
      item.failed
    ) {
      return;
    }

    router.push({
      pathname:
        '/edit-item',

      params: {
        id:
          item.id,
      },
    });
  }

  function openPreview(
    item:
      DisplayItem
  ): void {
    if (
      !item.ready ||
      !item.displayImage
    ) {
      return;
    }

    setPreviewImage(
      item.displayImage
    );
  }

  function goHome():
    void {
    router.replace(
      '/home' as never
    );
  }

  /**
   * لا توجد Gallery ولا Add Item تقليدية.
   *
   * Scan Item هو الطريق الوحيد لإضافة قطعة.
   */
  function openScanItem():
    void {
    router.push(
      '/item' as never
    );
  }

  /* =======================================================
   * Render
   * ===================================================== */

  return (
    <ImageBackground
      source={require(
        '../assets/images/luxury-fabric.jpeg'
      )}
      resizeMode="cover"
      style={
        styles.container
      }
    >
      <View
        style={
          styles.overlay
        }
      >
        <FlatList
          data={
            filteredItems
          }
          numColumns={
            3
          }
          keyExtractor={
            item =>
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
                  onPress={
                    goHome
                  }
                  activeOpacity={
                    0.85
                  }
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
                    style={
                      styles.title
                    }
                  >
                    {t(
                      'wardrobe.title'
                    )}
                  </Text>

                  <Text
                    style={
                      styles.subtitle
                    }
                  >
                    {replaceCount(
                      t(
                        'wardrobe.itemsCount'
                      ),
                      items.length
                    )}

                    {' • '}

                    {wardrobeType ===
                    'female'
                      ? t(
                          'wardrobe.women'
                        )
                      : t(
                          'wardrobe.men'
                        )}
                  </Text>
                </View>
              </View>

              <TextInput
                style={
                  styles.searchInput
                }
                placeholder={t(
                  'common.search'
                )}
                placeholderTextColor="#777"
                value={
                  searchText
                }
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
                  category => (
                    <TouchableOpacity
                      key={
                        category
                      }
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
                        {translateCategory(
                          category
                        )}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </ScrollView>

              {items.length >
              0 ? (
                <TouchableOpacity
                  style={[
                    styles.deleteModeButton,

                    deleteMode &&
                      styles.cancelDeleteButton,
                  ]}
                  onPress={() => {
                    setDeleteMode(
                      current =>
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
                      ? t(
                          'wardrobe.cancelDelete'
                        )
                      : t(
                          'wardrobe.selectDelete'
                        )}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {deleteMode &&
              selectedItems.length >
                0 ? (
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
                    {replaceCount(
                      t(
                        'wardrobe.deleteItems'
                      ),
                      selectedItems.length
                    )}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          }
          renderItem={({
            item,
          }) => {
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

                  item.pending &&
                    styles.processingCard,

                  item.failed &&
                    styles.failedCard,

                  isSelected &&
                    styles.selectedCard,
                ]}
                onPress={() =>
                  openItem(
                    item
                  )
                }
                onLongPress={() =>
                  openPreview(
                    item
                  )
                }
                activeOpacity={
                  0.85
                }
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
                  {item.displayImage ? (
                    <Image
                      source={{
                        uri:
                          item.displayImage,
                      }}
                      style={[
                        styles.image,

                        item.pending &&
                          styles.processingImage,
                      ]}
                    />
                  ) : (
                    <View
                      style={
                        styles.emptyImage
                      }
                    />
                  )}
                </View>

                {item.ready ? (
                  <View
                    pointerEvents="none"
                    style={
                      styles.darkOverlay
                    }
                  />
                ) : null}

                {item.ready ? (
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
                ) : null}

                {item.ready &&
                item.name ? (
                  <View
                    style={
                      styles.nameBadge
                    }
                  >
                    <Text
                      numberOfLines={
                        1
                      }
                      style={
                        styles.nameText
                      }
                    >
                      {item.name}
                    </Text>
                  </View>
                ) : null}

                {item.pending ? (
                  <View
                    pointerEvents="none"
                    style={
                      styles.progressContainer
                    }
                  >
                    <View
                      style={
                        styles.progressTrack
                      }
                    >
                      <View
                        style={[
                          styles.progressFill,

                          {
                            width:
                              `${Math.max(
                                2,
                                Math.round(
                                  item.progress *
                                  100
                                )
                              )}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ) : null}

                {isSelected ? (
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
                ) : null}
              </TouchableOpacity>
            );
          }}
        />

        <TouchableOpacity
          style={
            styles.fixedAddButton
          }
          onPress={
            openScanItem
          }
          activeOpacity={
            0.9
          }
        >
          <Text
            style={
              styles.fixedAddButtonText
            }
          >
            ＋{' '}
            {t(
              'wardrobe.scanItem'
            )}
          </Text>
        </TouchableOpacity>

        <Modal
          visible={
            previewImage !==
            null
          }
          transparent
          animationType="fade"
          onRequestClose={() =>
            setPreviewImage(
              null
            )
          }
        >
          <TouchableOpacity
            style={
              styles.modalBackground
            }
            onPress={() =>
              setPreviewImage(
                null
              )
            }
            activeOpacity={
              1
            }
          >
            {previewImage ? (
              <Image
                source={{
                  uri:
                    previewImage,
                }}
                style={
                  styles.previewImage
                }
              />
            ) : null}
          </TouchableOpacity>
        </Modal>
      </View>
    </ImageBackground>
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
        '#0f0f10',

      paddingHorizontal:
        18,

      paddingTop:
        65,
    },

    overlay: {
      flex:
        1,

      backgroundColor:
        'rgba(7, 9, 13, 0.88)',
    },

    list: {
      paddingBottom:
        190,
    },

    smallHeader: {
      flexDirection:
        'row',

      alignItems:
        'center',

      marginBottom:
        18,
    },

    homeButton: {
      width:
        44,

      height:
        44,

      borderRadius:
        18,

      backgroundColor:
        '#15171c',

      borderWidth:
        1,

      borderColor:
        '#252a31',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginRight:
        12,
    },

    homeButtonText: {
      color:
        'white',

      fontSize:
        34,

      lineHeight:
        37,

      marginTop:
        -2,
    },

    headerTextBox: {
      flex:
        1,
    },

    title: {
      color:
        'white',

      fontSize:
        36,

      fontWeight:
        '900',
    },

    subtitle: {
      color:
        '#888',

      fontSize:
        15,

      fontWeight:
        '700',

      marginTop:
        4,
    },

    searchInput: {
      backgroundColor:
        '#15171c',

      color:
        'white',

      padding:
        16,

      borderRadius:
        20,

      fontSize:
        15,

      marginBottom:
        14,

      borderWidth:
        1,

      borderColor:
        '#252a31',
    },

    categoryContainer: {
      paddingBottom:
        15,

      paddingHorizontal:
        2,

      gap:
        10,
    },

    filterButton: {
      backgroundColor:
        '#15171c',

      paddingVertical:
        12,

      paddingHorizontal:
        18,

      borderRadius:
        14,

      borderWidth:
        1,

      borderColor:
        '#252a31',
    },

    activeFilter: {
      backgroundColor:
        '#f4dfc8',

      borderColor:
        '#f4dfc8',
    },

    filterText: {
      color:
        '#aaa',

      fontSize:
        13,

      fontWeight:
        'bold',
    },

    activeFilterText: {
      color:
        '#111',

      fontWeight:
        'bold',
    },

    deleteModeButton: {
      backgroundColor:
        '#222',

      padding:
        14,

      borderRadius:
        24,

      alignItems:
        'center',

      marginBottom:
        10,

      borderWidth:
        1,

      borderColor:
        '#333',
    },

    cancelDeleteButton: {
      backgroundColor:
        '#333',
    },

    deleteModeText: {
      color:
        'white',

      fontSize:
        15,

      fontWeight:
        'bold',
    },

    deleteButton: {
      backgroundColor:
        '#ef4444',

      padding:
        14,

      borderRadius:
        24,

      alignItems:
        'center',

      marginBottom:
        15,
    },

    deleteButtonText: {
      color:
        'white',

      fontSize:
        15,

      fontWeight:
        'bold',
    },

    card: {
      flex:
        1,

      height:
        150,

      margin:
        6,

      borderRadius:
        22,

      overflow:
        'hidden',

      backgroundColor:
        '#e8e4de',

      borderWidth:
        1,

      borderColor:
        '#252a31',
    },

    processingCard: {
      borderColor:
        '#353a40',
    },

    failedCard: {
      borderColor:
        '#4b4b4b',

      opacity:
        0.78,
    },

    selectedCard: {
      borderColor:
        '#f4dfc8',

      borderWidth:
        2,
    },

    imageBackground: {
      width:
        '100%',

      height:
        '100%',

      backgroundColor:
        '#e5e5e5',

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    image: {
      width:
        '92%',

      height:
        '92%',

      resizeMode:
        'contain',
    },

    processingImage: {
      opacity:
        0.78,
    },

    emptyImage: {
      width:
        '100%',

      height:
        '100%',

      backgroundColor:
        '#d7d7d7',
    },

    darkOverlay: {
      ...StyleSheet.absoluteFillObject,

      backgroundColor:
        'rgba(0,0,0,0.08)',
    },

    favoriteButton: {
      position:
        'absolute',

      top:
        10,

      right:
        10,

      backgroundColor:
        'rgba(255,255,255,0.75)',

      width:
        32,

      height:
        32,

      borderRadius:
        16,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    favoriteText: {
      fontSize:
        18,
    },

    nameBadge: {
      position:
        'absolute',

      left:
        8,

      right:
        8,

      bottom:
        8,

      backgroundColor:
        'rgba(0,0,0,0.62)',

      paddingHorizontal:
        8,

      paddingVertical:
        6,

      borderRadius:
        14,
    },

    nameText: {
      color:
        'white',

      fontSize:
        11,

      fontWeight:
        'bold',

      textAlign:
        'center',
    },

    progressContainer: {
      position:
        'absolute',

      left:
        10,

      right:
        10,

      bottom:
        10,

      height:
        7,

      justifyContent:
        'center',
    },

    progressTrack: {
      width:
        '100%',

      height:
        7,

      overflow:
        'hidden',

      borderRadius:
        999,

      backgroundColor:
        '#9ca3af',
    },

    progressFill: {
      height:
        '100%',

      borderRadius:
        999,

      backgroundColor:
        '#22c55e',
    },

    checkCircle: {
      position:
        'absolute',

      top:
        12,

      right:
        12,

      backgroundColor:
        '#22c55e',

      width:
        34,

      height:
        34,

      borderRadius:
        17,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    checkText: {
      color:
        'white',

      fontSize:
        19,

      fontWeight:
        'bold',
    },

    fixedAddButton: {
      position:
        'absolute',

      left:
        55,

      right:
        55,

      bottom:
        25,

      backgroundColor:
        '#f4dfc8',

      paddingVertical:
        16,

      borderRadius:
        35,

      alignItems:
        'center',

      zIndex:
        20,
    },

    fixedAddButtonText: {
      color:
        '#111',

      fontSize:
        18,

      fontWeight:
        '900',
    },

    modalBackground: {
      flex:
        1,

      backgroundColor:
        'rgba(0,0,0,0.82)',

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    previewImage: {
      width:
        360,

      height:
        520,

      borderRadius:
        35,

      resizeMode:
        'contain',
    },
  });