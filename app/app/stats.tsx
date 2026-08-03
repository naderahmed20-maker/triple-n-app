import { useTranslation } from '@/lib/i18n';
import { getSavedOutfits } from '@/lib/outfitService';

import {
  getCurrentUser,
  getMyWardrobeItems,
  WardrobeItem,
} from '@/lib/wardrobeService';

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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type StatsOutfit = {
  favorite?: boolean;
  score?: number;
  aiScore?: number;
  colorScore?: number;
  createdAt?: number;
};

export default function StatsScreen() {
  const {
    t,
    language,
  } = useTranslation();

  const [
    items,
    setItems,
  ] = useState<WardrobeItem[]>([]);

  const [
    outfits,
    setOutfits,
  ] = useState<StatsOutfit[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadData() {
        try {
          const user =
            await getCurrentUser();

          if (!user) {
            router.replace(
              '/login' as any
            );

            return;
          }

          const [
            wardrobe,
            savedRows,
          ] = await Promise.all([
            getMyWardrobeItems(),
            getSavedOutfits(),
          ]);

          if (!active) {
            return;
          }

          const savedOutfits:
            StatsOutfit[] =
            savedRows.map(
              (row: any) => ({
                ...row.outfit,

                favorite:
                  row.favorite,

                createdAt:
                  row.created_at
                    ? new Date(
                        row.created_at
                      ).getTime()
                    : undefined,
              })
            );

          setItems(
            wardrobe
          );

          setOutfits(
            savedOutfits
          );
        } catch (
          error: any
        ) {
          if (!active) {
            return;
          }

          Alert.alert(
            t('common.error'),
            error?.message ||
              t(
                'stats.loadFailed'
              )
          );
        }
      }

      void loadData();

      return () => {
        active = false;
      };
    }, [t])
  );

  const tops =
    items.filter(
      (item) =>
        item.category ===
          'Top' ||
        item.category ===
          'Tops'
    ).length;

  const pants =
    items.filter(
      (item) =>
        item.category ===
          'Pants' ||
        item.category ===
          'Shorts'
    ).length;

  const shoes =
    items.filter(
      (item) =>
        item.category ===
        'Shoes'
    ).length;

  const jackets =
    items.filter(
      (item) =>
        item.category ===
          'Jacket' ||
        item.category ===
          'Jackets'
    ).length;

  const accessories =
    items.filter(
      (item) =>
        item.category ===
          'Accessories' ||
        item.category ===
          'Accessory'
    ).length;

  const favoriteItems =
    items.filter(
      (item) =>
        item.favorite
    ).length;

  const favoriteOutfits =
    outfits.filter(
      (outfit) =>
        outfit.favorite
    ).length;

  const bestMatchScore =
    outfits.length > 0
      ? Math.max(
          ...outfits.map(
            (outfit) =>
              outfit.score ||
              outfit.aiScore ||
              0
          )
        )
      : 0;

  const bestColorScore =
    outfits.length > 0
      ? Math.max(
          ...outfits.map(
            (outfit) =>
              outfit.colorScore ||
              0
          )
        )
      : 0;

  const latestOutfit =
    [...outfits]
      .filter(
        (outfit) =>
          outfit.createdAt
      )
      .sort(
        (
          first,
          second
        ) =>
          (second.createdAt ||
            0) -
          (first.createdAt ||
            0)
      )[0];

  const latestDate =
    latestOutfit?.createdAt
      ? new Date(
          latestOutfit.createdAt
        ).toLocaleDateString(
          language ===
            'Italian'
            ? 'it-IT'
            : 'en-US'
        )
      : t('common.none');

  function replaceValue(
    text: string,
    key: string,
    value:
      | string
      | number
  ) {
    return text.replace(
      `{{${key}}}`,
      String(value)
    );
  }

  function getInsightText() {
    if (
      items.length < 20
    ) {
      return t(
        'stats.insightGrowing'
      );
    }

    if (
      items.length < 50
    ) {
      return t(
        'stats.insightGood'
      );
    }

    return t(
      'stats.insightExcellent'
    );
  }

  function StatCard({
    title,
    value,
    route,
  }: {
    title: string;
    value: number;
    route?: string;
  }) {
    return (
      <TouchableOpacity
        style={
          styles.card
        }
        activeOpacity={
          0.85
        }
        onPress={() => {
          if (route) {
            router.push(
              route as any
            );
          }
        }}
      >
        <Text
          style={
            styles.value
          }
        >
          {value}
        </Text>

        <Text
          style={
            styles.label
          }
        >
          {title}
        </Text>
      </TouchableOpacity>
    );
  }

  function PremiumCard({
    title,
    value,
    icon,
    route,
  }: {
    title: string;
    value: number;
    icon: string;
    route?: string;
  }) {
    return (
      <TouchableOpacity
        style={
          styles.card
        }
        activeOpacity={
          0.85
        }
        onPress={() => {
          if (route) {
            router.push(
              route as any
            );
          }
        }}
      >
        <Text
          style={
            styles.cardIcon
          }
        >
          {icon}
        </Text>

        <Text
          style={
            styles.value
          }
        >
          {value}
        </Text>

        <Text
          style={
            styles.label
          }
        >
          {title}
        </Text>
      </TouchableOpacity>
    );
  }

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
    >
      <View
        style={
          styles.header
        }
      >
        <TouchableOpacity
          style={
            styles.backIcon
          }
          onPress={() =>
            router.replace(
              '/home' as any
            )
          }
        >
          <Text
            style={
              styles.backIconText
            }
          >
            ‹
          </Text>
        </TouchableOpacity>

        <View>
          <Text
            style={
              styles.title
            }
          >
            {t(
              'stats.title'
            )}
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            {t(
              'stats.subtitle'
            )}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={
          styles.welcomeCard
        }
        activeOpacity={
          0.85
        }
        onPress={() =>
          router.push(
            '/profile' as any
          )
        }
      >
        <Text
          style={
            styles.welcomeTitle
          }
        >
          {t(
            'stats.welcome'
          )}
        </Text>

        <Text
          style={
            styles.welcomeText
          }
        >
          {replaceValue(
            t(
              'stats.readyItems'
            ),
            'count',
            items.length
          )}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={
          styles.summaryCard
        }
        activeOpacity={
          0.85
        }
        onPress={() =>
          router.push(
            '/wardrobe' as any
          )
        }
      >
        <View
          style={
            styles.summarySection
          }
        >
          <Text
            style={
              styles.summaryLabel
            }
          >
            {t(
              'stats.totalWardrobe'
            )}
          </Text>

          <Text
            style={
              styles.summaryValue
            }
          >
            {items.length}
          </Text>
        </View>

        <View
          style={
            styles.summaryDivider
          }
        />

        <View
          style={
            styles.summarySection
          }
        >
          <Text
            style={
              styles.summaryLabel
            }
          >
            {t(
              'stats.savedLooks'
            )}
          </Text>

          <Text
            style={
              styles.summaryValue
            }
          >
            {outfits.length}
          </Text>
        </View>
      </TouchableOpacity>

      <View
        style={
          styles.insightCard
        }
      >
        <Text
          style={
            styles.insightTitle
          }
        >
          {t(
            'stats.styleInsight'
          )}
        </Text>

        <Text
          style={
            styles.insightText
          }
        >
          {getInsightText()}
        </Text>
      </View>

      <View
        style={
          styles.grid
        }
      >
        <PremiumCard
          title={t(
            'home.items'
          )}
          value={
            items.length
          }
          icon="👕"
          route="/wardrobe"
        />

        <PremiumCard
          title={t(
            'home.outfits'
          )}
          value={
            outfits.length
          }
          icon="✨"
          route="/saved-outfits"
        />

        <PremiumCard
          title={t(
            'home.favorites'
          )}
          value={
            favoriteItems
          }
          icon="❤️"
          route="/wardrobe"
        />

        <PremiumCard
          title={t(
            'nav.saved'
          )}
          value={
            favoriteOutfits
          }
          icon="⭐"
          route="/saved-outfits"
        />

        <StatCard
          title={t(
            'category.tops'
          )}
          value={tops}
          route="/wardrobe"
        />

        <StatCard
          title={t(
            'category.pants'
          )}
          value={pants}
          route="/wardrobe"
        />

        <StatCard
          title={t(
            'category.shoes'
          )}
          value={shoes}
          route="/wardrobe"
        />

        <StatCard
          title={t(
            'category.jackets'
          )}
          value={jackets}
          route="/wardrobe"
        />

        <StatCard
          title={t(
            'category.accessories'
          )}
          value={
            accessories
          }
          route="/wardrobe"
        />

        <StatCard
          title={t(
            'stats.bestMatch'
          )}
          value={
            bestMatchScore
          }
          route="/saved-outfits"
        />

        <StatCard
          title={t(
            'stats.bestColor'
          )}
          value={
            bestColorScore
          }
          route="/saved-outfits"
        />
      </View>

      <TouchableOpacity
        style={
          styles.goalCard
        }
        activeOpacity={
          0.85
        }
        onPress={() =>
          router.push(
            '/item' as any
          )
        }
      >
        <Text
          style={
            styles.goalTitle
          }
        >
          {t(
            'stats.wardrobeGoal'
          )}
        </Text>

        <View
          style={
            styles.progressBackground
          }
        >
          <View
            style={[
              styles.progressFill,

              {
                width: `${Math.min(
                  items.length,
                  100
                )}%`,
              },
            ]}
          />
        </View>

        <Text
          style={
            styles.goalText
          }
        >
          {items.length >=
          100
            ? t(
                'stats.goalComplete'
              )
            : replaceValue(
                t(
                  'stats.goalRemaining'
                ),
                'count',
                100 -
                  items.length
              )}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={
          styles.historyBox
        }
        activeOpacity={
          0.85
        }
        onPress={() =>
          router.push(
            '/saved-outfits' as any
          )
        }
      >
        <Text
          style={
            styles.historyTitle
          }
        >
          🕒{' '}
          {t(
            'stats.outfitHistory'
          )}
        </Text>

        <Text
          style={
            styles.historyText
          }
        >
          {replaceValue(
            t(
              'stats.lastSaved'
            ),
            'date',
            latestDate
          )}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#0b0d11',
    },

    content: {
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 35,
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },

    backIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor:
        '#17191d',
      alignItems: 'center',
      justifyContent:
        'center',
      marginRight: 12,
    },

    backIconText: {
      color: 'white',
      fontSize: 30,
      fontWeight: '300',
    },

    title: {
      color: 'white',
      fontSize: 27,
      fontWeight: '900',
    },

    subtitle: {
      color: '#8f9299',
      fontSize: 12,
      fontWeight: '700',
      marginTop: 2,
    },

    welcomeCard: {
      backgroundColor:
        '#15171c',
      borderRadius: 20,
      borderWidth: 1,
      borderColor:
        '#252832',
      padding: 14,
      marginBottom: 10,
    },

    welcomeTitle: {
      color: 'white',
      fontSize: 18,
      fontWeight: '900',
      marginBottom: 4,
    },

    welcomeText: {
      color: '#8f9299',
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
    },

    summaryCard: {
      backgroundColor:
        '#111318',
      borderRadius: 20,
      borderWidth: 1,
      borderColor:
        '#252832',
      padding: 14,
      marginBottom: 10,
      flexDirection: 'row',
      justifyContent:
        'space-between',
      alignItems: 'center',
    },

    summarySection: {
      flex: 1,
      alignItems: 'center',
    },

    summaryLabel: {
      color: '#8f9299',
      fontSize: 11,
      fontWeight: '800',
      marginBottom: 4,
    },

    summaryValue: {
      color: '#f1d8c2',
      fontSize: 28,
      fontWeight: '900',
    },

    summaryDivider: {
      width: 1,
      height: 42,
      backgroundColor:
        '#252832',
    },

    insightCard: {
      backgroundColor:
        '#111318',
      borderRadius: 18,
      borderWidth: 1,
      borderColor:
        '#252832',
      padding: 12,
      marginBottom: 10,
    },

    insightTitle: {
      color: '#f1d8c2',
      fontSize: 14,
      fontWeight: '900',
      marginBottom: 4,
    },

    insightText: {
      color: '#d4d6db',
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '700',
    },

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent:
        'space-between',
      marginBottom: 6,
    },

    card: {
      width: '48%',
      backgroundColor:
        '#15171c',
      borderRadius: 18,
      paddingVertical: 10,
      paddingHorizontal: 10,
      alignItems: 'center',
      marginBottom: 8,
      borderWidth: 1,
      borderColor:
        '#252832',
    },

    cardIcon: {
      fontSize: 17,
      marginBottom: 3,
    },

    value: {
      color: '#f1d8c2',
      fontSize: 22,
      fontWeight: '900',
    },

    label: {
      color: '#8f9299',
      fontSize: 10,
      marginTop: 2,
      textAlign: 'center',
      fontWeight: '700',
    },

    goalCard: {
      backgroundColor:
        '#111318',
      borderRadius: 18,
      borderWidth: 1,
      borderColor:
        '#252832',
      padding: 12,
      marginBottom: 8,
    },

    goalTitle: {
      color: 'white',
      fontSize: 14,
      fontWeight: '900',
      marginBottom: 7,
    },

    progressBackground: {
      height: 7,
      backgroundColor:
        '#252832',
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 7,
    },

    progressFill: {
      height: '100%',
      backgroundColor:
        '#f1d8c2',
      borderRadius: 10,
    },

    goalText: {
      color: '#8f9299',
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 15,
    },

    historyBox: {
      backgroundColor:
        '#15171c',
      borderRadius: 18,
      padding: 12,
      borderWidth: 1,
      borderColor:
        '#252832',
    },

    historyTitle: {
      color: 'white',
      fontSize: 14,
      fontWeight: '900',
      marginBottom: 4,
    },

    historyText: {
      color: '#aaa',
      fontSize: 11,
    },
  });