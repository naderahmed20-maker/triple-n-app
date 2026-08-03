import {
  useTranslation,
} from '@/lib/i18n';

import {
  supabase,
} from '@/lib/supabase';

import {
  Ionicons,
} from '@expo/vector-icons';

import {
  router,
  useFocusEffect,
} from 'expo-router';

import {
  useCallback,
  useState,
} from 'react';

import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import OutfitCanvas from './app/components/OutfitCanvas';

type WardrobeItem = {
  id?: string;

  image: string;

  category: string;

  subCategory?:
    | string
    | null;

  name?: string;

  color?: string;

  favorite?: boolean;
};

type SavedOutfit = {
  top:
    | WardrobeItem
    | null;

  pants:
    | WardrobeItem
    | null;

  bottom?:
    | WardrobeItem
    | null;

  shoes:
    | WardrobeItem
    | null;

 jacket?:
  | WardrobeItem
  | null;

bag?:
  | WardrobeItem
  | null;

cap?:
  | WardrobeItem
  | null;

watch?:
  | WardrobeItem
  | null;

accessory?:
  | WardrobeItem
  | null;

  favorite?: boolean;

  score?: number;

  aiScore?: number;

  colorScore?: number;

  styleScore?: number;

  weatherScore?: number;

  seasonScore?: number;

  occasion?: string;

  weather?: string;

  season?: string;

  explanation?: string[];
};

type SavedRow = {
  id: string;

  outfit: SavedOutfit;

  favorite: boolean;

  created_at: string;
};

const FILTERS = [
  'All',
  'Favorites',
  'Smart',
  'Casual',
  'Work',
  'Date',
  'Party',
  'Sport',
  'Summer',
  'Hot',
  'Mild',
  'Rainy',
] as const;

type FilterType =
  (typeof FILTERS)[number];

  function normalizeSummerWeather(
  value?:
    | string
    | null
) {
  switch (
    value
      ?.trim()
      .toLowerCase()
  ) {
    case 'hot':
      return 'Hot';
    case 'rain':
    case 'rainy':
      return 'Rainy';
    case 'cold':
    case 'mild':
    default:
      return 'Mild';
  }
}
function cleanSavedOutfit(
  outfit: SavedOutfit
): SavedOutfit {
  return {
    ...outfit,
    /**
     * Summer V1:
     * الجاكيت يظل في الدولاب فقط.
     */
    jacket:
      null,
    season:
      'Summer',
    weather:
      normalizeSummerWeather(
        outfit.weather
      ),
  };
}
function cleanSavedRow(
  row: SavedRow
): SavedRow {
  return {
    ...row,
    outfit:
      cleanSavedOutfit(
        row.outfit
      ),
  };
}

export default function SavedOutfitsScreen() {
  const {
    t,
  } = useTranslation();

  const [
    outfits,
    setOutfits,
  ] =
    useState<
      SavedRow[]
    >([]);

  const [
    selectedFilter,
    setSelectedFilter,
  ] =
    useState<FilterType>(
      'All'
    );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadOutfits() {
        try {
          const {
            data:
              sessionData,
          } =
            await supabase
              .auth
              .getSession();

          const user =
            sessionData
              .session
              ?.user;

          if (!user) {
            router.replace(
              '/login' as any
            );

            return;
          }

          const {
            data,
            error,
          } =
            await supabase
              .from(
                'saved_outfits'
              )
              .select('*')
              .eq(
                'user_id',
                user.id
              )
              .order(
                'created_at',
                {
                  ascending:
                    false,
                }
              );

          if (error) {
            throw error;
          }

          if (!active) {
            return;
          }

         const cleanedRows =
  (
    (
      data ||
      []
    ) as SavedRow[]
  ).map(
    cleanSavedRow
  );
setOutfits(
  cleanedRows
);
        } catch (
          error: unknown
        ) {
          if (!active) {
            return;
          }

          const message =
            error instanceof Error
              ? error.message
              : t(
                  'savedOutfits.loadFailed'
                );

          Alert.alert(
            t(
              'common.error'
            ),
            message
          );
        }
      }

      void loadOutfits();

      return () => {
        active = false;
      };
    }, [t])
  );

  function replaceCount(
    value: string,
    count: number
  ) {
    return value.replace(
      '{{count}}',
      String(count)
    );
  }

 function translateFilter(
  filter: FilterType
) {
  switch (filter) {
    case 'All':
      return t(
        'common.all'
      );
    case 'Favorites':
      return t(
        'common.favorites'
      );
    case 'Smart':
      return t(
        'savedOutfits.filter.smart'
      );
    case 'Casual':
      return t(
        'savedOutfits.filter.casual'
      );
    case 'Work':
      return t(
        'savedOutfits.filter.work'
      );
    case 'Date':
      return t(
        'savedOutfits.filter.date'
      );
    case 'Party':
      return t(
        'savedOutfits.filter.party'
      );
    case 'Sport':
      return t(
        'savedOutfits.filter.sport'
      );
    case 'Summer':
      return t(
        'season.summer'
      );
    case 'Hot':
      return t(
        'weather.hot'
      );
    case 'Mild':
      return t(
        'weather.mild'
      );
    case 'Rainy':
      return t(
        'weather.rainy'
      );
    default:
      return filter;
  }
}

 function translateWeather(
  value?: string
) {
  switch (
    normalizeSummerWeather(
      value
    )
  ) {
    case 'Hot':
      return t(
        'weather.hot'
      );
    case 'Rainy':
      return t(
        'weather.rainy'
      );
    case 'Mild':
    default:
      return t(
        'weather.mild'
      );
  }
}

  function translateSeason(
  _value?: string
) {
  return t(
    'season.summer'
  );
}

  function translateOccasion(
    value?: string
  ) {
    switch (
      value
        ?.trim()
        .toLowerCase()
    ) {
      case 'work':
        return t(
          'savedOutfits.filter.work'
        );

      case 'date':
        return t(
          'savedOutfits.filter.date'
        );

      case 'party':
        return t(
          'savedOutfits.filter.party'
        );

      case 'summer':
        return t(
          'season.summer'
        );

      case 'weather':
        return t(
          'savedOutfits.occasion.weather'
        );

      case 'smart':
        return t(
          'savedOutfits.filter.smart'
        );

      case 'sport':
        return t(
          'savedOutfits.filter.sport'
        );

      case 'casual':
        return t(
          'savedOutfits.filter.casual'
        );

      default:
        return (
          value ||
          ''
        );
    }
  }

  const filteredOutfits =
  outfits.filter(
    (
      row
    ) => {
      const outfit =
        cleanSavedOutfit(
          row.outfit
        );
      if (
        selectedFilter ===
        'All'
      ) {
        return true;
      }
      if (
        selectedFilter ===
        'Favorites'
      ) {
        return row.favorite;
      }
      if (
        selectedFilter ===
          'Hot' ||
        selectedFilter ===
          'Mild' ||
        selectedFilter ===
          'Rainy'
      ) {
        return (
          normalizeSummerWeather(
            outfit.weather
          ) ===
          selectedFilter
        );
      }
      if (
        selectedFilter ===
        'Summer'
      ) {
        return true;
      }
      return (
        outfit.occasion
          ?.trim()
          .toLowerCase() ===
        selectedFilter
          .toLowerCase()
      );
    }
  );

  function goHome() {
    router.replace(
      '/home' as any
    );
  }

  async function toggleFavorite(
    row: SavedRow
  ) {
    const newFavorite =
      !row.favorite;

    try {
      const {
        error,
      } =
        await supabase
          .from(
            'saved_outfits'
          )
          .update({
            favorite:
              newFavorite,
          })
          .eq(
            'id',
            row.id
          );

      if (error) {
        throw error;
      }

      setOutfits(
        (
          current
        ) =>
          current.map(
            (
              item
            ) =>
              item.id ===
              row.id
                ? {
                    ...item,

                    favorite:
                      newFavorite,
                  }
                : item
          )
      );
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : t(
              'savedOutfits.favoriteFailed'
            );

      Alert.alert(
        t(
          'common.error'
        ),
        message
      );
    }
  }

  function deleteOutfit(
    row: SavedRow
  ) {
    Alert.alert(
      t(
        'details.deleteTitle'
      ),

      t(
        'details.deleteQuestion'
      ),

      [
        {
          text:
            t(
              'common.cancel'
            ),

          style:
            'cancel',
        },

        {
          text:
            t(
              'common.delete'
            ),

          style:
            'destructive',

          onPress:
            async () => {
              try {
                const {
                  error,
                } =
                  await supabase
                    .from(
                      'saved_outfits'
                    )
                    .delete()
                    .eq(
                      'id',
                      row.id
                    );

                if (error) {
                  throw error;
                }

                setOutfits(
                  (
                    current
                  ) =>
                    current.filter(
                      (
                        item
                      ) =>
                        item.id !==
                        row.id
                    )
                );
              } catch (
                error: unknown
              ) {
                const message =
                  error instanceof Error
                    ? error.message
                    : t(
                        'savedOutfits.deleteFailed'
                      );

                Alert.alert(
                  t(
                    'common.error'
                  ),
                  message
                );
              }
            },
        },
      ]
    );
  }

  async function shareOutfit(
  sourceOutfit:
    SavedOutfit
) {
  try {
    const outfit =
      cleanSavedOutfit(
        sourceOutfit
      );
    const topName =
      outfit.top
        ?.name ||
      t(
        'savedOutfits.share.top'
      );
    const bottomName =
      outfit.pants
        ?.name ||
      outfit.bottom
        ?.name ||
      t(
        'savedOutfits.share.bottom'
      );
    const shoesName =
      outfit.shoes
        ?.name ||
      t(
        'savedOutfits.share.shoes'
      );
    const bagName =
      outfit.bag
        ?.name;
    const capName =
      outfit.cap
        ?.name;
    const watchName =
      outfit.watch
        ?.name;
    const accessoryName =
      outfit.accessory
        ?.name;
    const occasionText =
      outfit.occasion
        ? translateOccasion(
            outfit.occasion
          )
        : t(
            'savedOutfits.share.occasionMissing'
          );
    const weatherText =
      translateWeather(
        outfit.weather
      );
    const seasonText =
      t(
        'season.summer'
      );
    const accessories:
      string[] = [];
    if (bagName) {
      accessories.push(
        `👜 ${bagName}`
      );
    }
    if (capName) {
      accessories.push(
        `🧢 ${capName}`
      );
    }
    if (watchName) {
      accessories.push(
        `⌚ ${watchName}`
      );
    }
    if (accessoryName) {
      accessories.push(
        `✨ ${accessoryName}`
      );
    }
    const accessoriesText =
      accessories.length >
      0
        ? `\n${accessories.join(
            '\n'
          )}`
        : '';
    await Share.share({
      message: `👕 ${topName}
👖 ${bottomName}
👟 ${shoesName}${accessoriesText}
🎯 ${occasionText}
🌦 ${weatherText}
☀️ ${seasonText}
⭐ ${t(
        'outfit.match'
      )}: ${
        outfit.score ||
        outfit.aiScore ||
        0
      }%
🎨 ${t(
        'outfit.colors'
      )}: ${
        outfit.colorScore ||
        0
      }%
✨ ${t(
        'outfit.style'
      )}: ${
        outfit.styleScore ||
        0
      }%
🌦 ${t(
        'outfit.weather'
      )}: ${
        outfit.weatherScore ||
        0
      }%
☀️ ${t(
        'outfit.season'
      )}: ${
        outfit.seasonScore ||
        0
      }%
${t(
        'savedOutfits.share.signature'
      )}`,
    });
  } catch (
    error: unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : t(
            'savedOutfits.shareFailed'
          );
    Alert.alert(
      t(
        'savedOutfits.shareErrorTitle'
      ),
      message
    );
  }
}

  function openOutfitDetails(
    row: SavedRow
  ) {
    router.push({
      pathname:
        '/app/outfit-details' as any,

      params: {
        id:
          row.id,
      },
    });
  }

  return (
    <View
      style={
        styles.container
      }
    >
      <View
        style={
          styles.header
        }
      >
        <TouchableOpacity
          style={
            styles.backButton
          }
          onPress={
            goHome
          }
          activeOpacity={
            0.85
          }
        >
          <Ionicons
            name="chevron-back"
            size={28}
            color="white"
          />
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
              'savedOutfits.title'
            )}
          </Text>

          <Text
            style={
              styles.counter
            }
          >
            {replaceCount(
              t(
                'savedOutfits.count'
              ),
              filteredOutfits.length
            )}
          </Text>
        </View>

        <View
          style={
            styles.headerSpacer
          }
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={
          false
        }
        style={
          styles.filtersScroll
        }
        contentContainerStyle={
          styles.filtersContent
        }
      >
        {FILTERS.map(
          (
            item
          ) => (
            <TouchableOpacity
              key={
                item
              }
              style={[
                styles.smallFilterButton,

                selectedFilter ===
                  item &&
                  styles.activeSmallFilterButton,
              ]}
              onPress={() =>
                setSelectedFilter(
                  item
                )
              }
            >
              <Text
                style={[
                  styles.smallFilterText,

                  selectedFilter ===
                    item &&
                    styles.activeSmallFilterText,
                ]}
              >
                {translateFilter(
                  item
                )}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={
          false
        }
        contentContainerStyle={
          styles.outfitsContent
        }
      >
        {filteredOutfits.length ===
        0 ? (
          <View
            style={
              styles.emptyBox
            }
          >
            <Text
              style={
                styles.emptyText
              }
            >
              {t(
                'savedOutfits.empty'
              )}
            </Text>
          </View>
        ) : (
          <View
            style={
              styles.grid
            }
          >
            {filteredOutfits.map(
              (
                row
              ) => {
                const outfit =
                  row.outfit;

                return (
                  <TouchableOpacity
                    key={
                      row.id
                    }
                    style={[
                      styles.outfitCard,

                      row.favorite &&
                        styles.favoriteCard,
                    ]}
                    onPress={() =>
                      openOutfitDetails(
                        row
                      )
                    }
                    onLongPress={() =>
                      deleteOutfit(
                        row
                      )
                    }
                    activeOpacity={
                      0.88
                    }
                  >
                    <TouchableOpacity
                      style={
                        styles.favoriteButton
                      }
                      onPress={() =>
                        toggleFavorite(
                          row
                        )
                      }
                    >
                      <Text
                        style={
                          styles.favoriteText
                        }
                      >
                        {row.favorite
                          ? '❤️'
                          : '🤍'}
                      </Text>
                    </TouchableOpacity>

                    <View
                      style={
                        styles.canvasBox
                      }
                    >
                    
                      <OutfitCanvas
  outfit={{
    top:
      outfit.top,
    bottom:
      outfit.pants ||
      outfit.bottom ||
      null,
    shoes:
      outfit.shoes,
    /**
     * لا يتم عرض الجاكيت حتى
     * في الأطقم القديمة.
     */
    jacket:
      null,
    bag:
      outfit.bag ||
      null,
    cap:
      outfit.cap ||
      null,
    watch:
      outfit.watch ||
      null,
    accessory:
      outfit.accessory ||
      null,
  }}
  variant="savedCard"
/>
                    </View>

                    <TouchableOpacity
                      style={
                        styles.shareButton
                      }
                      onPress={() =>
                        shareOutfit(
                          outfit
                        )
                      }
                    >
                      <Ionicons
                        name="share-outline"
                        size={17}
                        color="#111"
                      />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,

      backgroundColor:
        '#07090d',

      paddingTop: 58,
    },

    header: {
      flexDirection:
        'row',

      alignItems:
        'center',

      paddingHorizontal:
        20,

      marginBottom: 14,
    },

    backButton: {
      width: 46,

      height: 46,

      borderRadius: 18,

      backgroundColor:
        '#17191d',

      borderWidth: 1,

      borderColor:
        '#252a31',

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    headerTextBox: {
      flex: 1,

      alignItems:
        'center',
    },

    headerSpacer: {
      width: 46,
    },

    title: {
      color: 'white',

      fontSize: 28,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    counter: {
      color: '#999',

      fontSize: 13,

      fontWeight:
        '700',

      textAlign:
        'center',

      marginTop: 4,
    },

    filtersScroll: {
      flexGrow: 0,

      height: 54,

      marginBottom: 18,
    },

    filtersContent: {
      paddingHorizontal:
        20,

      alignItems:
        'center',
    },

    smallFilterButton: {
      backgroundColor:
        '#1a1c20',

      height: 46,

      paddingHorizontal:
        17,

      borderRadius: 14,

      marginRight: 8,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    activeSmallFilterButton: {
      backgroundColor:
        '#f4dfc8',
    },

    smallFilterText: {
      color: '#aaa',

      fontSize: 14,

      lineHeight: 18,

      fontWeight:
        '900',
    },

    activeSmallFilterText: {
      color: '#111',
    },

    outfitsContent: {
      paddingHorizontal:
        20,

      paddingBottom: 45,
    },

    grid: {
      flexDirection:
        'row',

      flexWrap:
        'wrap',

      justifyContent:
        'space-between',
    },

    outfitCard: {
      width: '48%',

      height: 225,

      backgroundColor:
        '#f4efe6',

      borderRadius: 18,

      marginBottom: 18,

      borderWidth: 1,

      borderColor:
        '#2a2d33',

      overflow:
        'hidden',
    },

    favoriteCard: {
      borderColor:
        '#f4dfc8',

      borderWidth: 1.5,
    },

    favoriteButton: {
      position:
        'absolute',

      top: 8,

      right: 8,

      zIndex: 30,

      width: 34,

      height: 34,

      borderRadius: 17,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    favoriteText: {
      fontSize: 25,
    },

    weatherBadge: {
      position:
        'absolute',

      top: 10,

      left: 10,

      zIndex: 20,

      color: '#d99a00',

      fontSize: 11,

      fontWeight:
        '900',
    },

    scoreBadge: {
      position:
        'absolute',

      top: 34,

      left: 9,

      zIndex: 20,

      backgroundColor:
        'rgba(17,19,24,0.88)',

      paddingHorizontal:
        8,

      paddingVertical:
        5,

      borderRadius: 12,
    },

    scoreBadgeText: {
      color: '#facc15',

      fontSize: 10,

      fontWeight:
        '900',
    },

    shareButton: {
      position:
        'absolute',

      left: 10,

      bottom: 9,

      zIndex: 30,

      width: 30,

      height: 30,

      borderRadius: 15,

      backgroundColor:
        'rgba(255,255,255,0.82)',

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    canvasBox: {
      flex: 1,

      alignItems:
        'center',

      justifyContent:
        'flex-start',

      paddingTop: 5,
    },

    emptyBox: {
      paddingTop: 70,

      alignItems:
        'center',
    },

    emptyText: {
      color: '#777',

      fontSize: 16,

      fontWeight:
        '800',

      textAlign:
        'center',
    },
  });