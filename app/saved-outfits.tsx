import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

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
  subCategory?: string | null;
  name?: string;
  color?: string;
  favorite?: boolean;
};

type SavedOutfit = {
  top: WardrobeItem | null;
  pants: WardrobeItem | null;
  bottom?: WardrobeItem | null;
  shoes: WardrobeItem | null;
  jacket: WardrobeItem | null;
  accessory?: WardrobeItem | null;

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
  'Winter',
  'Hot',
  'Mild',
  'Rainy',
  'Cold',
] as const;

export default function SavedOutfitsScreen() {
  const [outfits, setOutfits] = useState<SavedRow[]>([]);
  const [selectedFilter, setSelectedFilter] = useState('All');

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadOutfits() {
        try {
          const { data: sessionData } =
            await supabase.auth.getSession();

          const user = sessionData.session?.user;

          if (!user) {
            router.replace('/login' as any);
            return;
          }

          const { data, error } = await supabase
            .from('saved_outfits')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', {
              ascending: false,
            });

          if (error) {
            throw error;
          }

          if (!active) return;

          setOutfits((data || []) as SavedRow[]);
        } catch (error: any) {
          if (!active) return;

          Alert.alert(
            'Error',
            error?.message ||
              'Failed to load saved outfits.'
          );
        }
      }

      loadOutfits();

      return () => {
        active = false;
      };
    }, [])
  );

  const filteredOutfits = outfits.filter((row) => {
    const outfit = row.outfit;

    if (selectedFilter === 'All') {
      return true;
    }

    if (selectedFilter === 'Favorites') {
      return row.favorite;
    }

    const weatherFilters = [
      'Hot',
      'Mild',
      'Rainy',
      'Cold',
    ];

    if (weatherFilters.includes(selectedFilter)) {
      return outfit.weather === selectedFilter;
    }

    return outfit.occasion === selectedFilter;
  });

  function goHome() {
    router.replace('/home' as any);
  }

  async function toggleFavorite(row: SavedRow) {
    const newFavorite = !row.favorite;

    try {
      const { error } = await supabase
        .from('saved_outfits')
        .update({
          favorite: newFavorite,
        })
        .eq('id', row.id);

      if (error) {
        throw error;
      }

      setOutfits((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                favorite: newFavorite,
              }
            : item
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

  function deleteOutfit(row: SavedRow) {
    Alert.alert(
      'Delete Outfit',
      'Are you sure you want to delete this outfit?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',

          onPress: async () => {
            try {
              const { error } = await supabase
                .from('saved_outfits')
                .delete()
                .eq('id', row.id);

              if (error) {
                throw error;
              }

              setOutfits((current) =>
                current.filter(
                  (item) => item.id !== row.id
                )
              );
            } catch (error: any) {
              Alert.alert(
                'Error',
                error?.message ||
                  'Could not delete outfit.'
              );
            }
          },
        },
      ]
    );
  }

  async function shareOutfit(outfit: SavedOutfit) {
    try {
      await Share.share({
        message: `👕 ${outfit.top?.name || 'Top'}
👖 ${
          outfit.pants?.name ||
          outfit.bottom?.name ||
          'Bottom'
        }
👟 ${outfit.shoes?.name || 'Shoes'}
🧥 ${outfit.jacket?.name || 'No Jacket'}
👜 ${outfit.accessory?.name || 'No Accessory'}

🎯 ${outfit.occasion || 'Occasion not saved'}
🌦 ${outfit.weather || 'Weather not saved'}
🍂 ${outfit.season || 'Season not saved'}

⭐ Match: ${outfit.score || outfit.aiScore || 0}%
🎨 Colors: ${outfit.colorScore || 0}%
✨ Style: ${outfit.styleScore || 0}%
🌦 Weather: ${outfit.weatherScore || 0}%
🍂 Season: ${outfit.seasonScore || 0}%

Made with Triple N ✨`,
      });
    } catch (error: any) {
      Alert.alert(
        'Share failed',
        error?.message ||
          'Could not share this outfit.'
      );
    }
  }

  function openOutfitDetails(row: SavedRow) {
    router.push({
      pathname: '/app/outfit-details' as any,
      params: {
        id: row.id,
      },
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={goHome}
          activeOpacity={0.85}
        >
          <Ionicons
            name="chevron-back"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <View style={styles.headerTextBox}>
          <Text style={styles.title}>
            Saved Outfits
          </Text>

          <Text style={styles.counter}>
            {filteredOutfits.length} Outfit(s)
          </Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScroll}
        contentContainerStyle={
          styles.filtersContent
        }
      >
        {FILTERS.map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.smallFilterButton,
              selectedFilter === item &&
                styles.activeSmallFilterButton,
            ]}
            onPress={() =>
              setSelectedFilter(item)
            }
          >
            <Text
              style={[
                styles.smallFilterText,
                selectedFilter === item &&
                  styles.activeSmallFilterText,
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.outfitsContent
        }
      >
        {filteredOutfits.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              No saved outfits yet
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {filteredOutfits.map((row) => {
              const outfit = row.outfit;

              const displayedScore =
                outfit.score ||
                outfit.aiScore ||
                0;

              return (
                <TouchableOpacity
                  key={row.id}
                  style={[
                    styles.outfitCard,
                    row.favorite &&
                      styles.favoriteCard,
                  ]}
                  onPress={() =>
                    openOutfitDetails(row)
                  }
                  onLongPress={() =>
                    deleteOutfit(row)
                  }
                  activeOpacity={0.88}
                >
                  <TouchableOpacity
                    style={styles.favoriteButton}
                    onPress={() =>
                      toggleFavorite(row)
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

                  {outfit.weather && (
                    <Text
                      style={
                        styles.weatherBadge
                      }
                    >
                      🌦 {outfit.weather}
                    </Text>
                  )}

                  {displayedScore > 0 && (
                    <View
                      style={
                        styles.scoreBadge
                      }
                    >
                      <Text
                        style={
                          styles.scoreBadgeText
                        }
                      >
                        ⭐ {displayedScore}%
                      </Text>
                    </View>
                  )}

                  <View
                    style={styles.canvasBox}
                  >
                    <OutfitCanvas
                      outfit={{
                        top: outfit.top,

                        bottom:
                          outfit.pants ||
                          outfit.bottom ||
                          null,

                        shoes: outfit.shoes,
                        jacket:
                          outfit.jacket,

                        accessory:
                          outfit.accessory ||
                          null,
                      }}
                      variant="savedCard"
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.shareButton}
                    onPress={() =>
                      shareOutfit(outfit)
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
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
    paddingTop: 58,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 14,
  },

  backButton: {
    width: 46,
    height: 46,
    borderRadius: 18,
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#252a31',
    justifyContent: 'center',
    alignItems: 'center',
  },

  headerTextBox: {
    flex: 1,
    alignItems: 'center',
  },

  headerSpacer: {
    width: 46,
  },

  title: {
    color: 'white',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },

  counter: {
    color: '#999',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },

  filtersScroll: {
    flexGrow: 0,
    maxHeight: 48,
    marginBottom: 18,
  },

  filtersContent: {
    paddingHorizontal: 20,
  },

  smallFilterButton: {
    backgroundColor: '#1a1c20',
    paddingVertical: 10,
    paddingHorizontal: 17,
    borderRadius: 14,
    marginRight: 8,
  },

  activeSmallFilterButton: {
    backgroundColor: '#f4dfc8',
  },

  smallFilterText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '900',
  },

  activeSmallFilterText: {
    color: '#111',
  },

  outfitsContent: {
    paddingHorizontal: 20,
    paddingBottom: 45,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },

  outfitCard: {
    width: '48%',
    height: 225,
    backgroundColor: '#f4efe6',
    borderRadius: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#2a2d33',
    overflow: 'hidden',
  },

  favoriteCard: {
    borderColor: '#f4dfc8',
    borderWidth: 1.5,
  },

  favoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 30,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  favoriteText: {
    fontSize: 25,
  },

  weatherBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 20,
    color: '#d99a00',
    fontSize: 11,
    fontWeight: '900',
  },

  scoreBadge: {
    position: 'absolute',
    top: 34,
    left: 9,
    zIndex: 20,
    backgroundColor:
      'rgba(17,19,24,0.88)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },

  scoreBadgeText: {
    color: '#facc15',
    fontSize: 10,
    fontWeight: '900',
  },

  shareButton: {
    position: 'absolute',
    right: 10,
    bottom: 9,
    zIndex: 30,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor:
      'rgba(255,255,255,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  canvasBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 5,
  },

  emptyBox: {
    paddingTop: 70,
    alignItems: 'center',
  },

  emptyText: {
    color: '#777',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
});