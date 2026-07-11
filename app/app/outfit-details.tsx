import {
  SavedOutfit,
  deleteOutfit as deleteOutfitFromService,
  getSavedOutfitById,
  updateOutfitFavorite,
} from '@/lib/outfitService';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import OutfitCanvas from './components/OutfitCanvas';

type DetailedSavedOutfit = SavedOutfit & {
  aiScore?: number;
  weatherScore?: number;
  seasonScore?: number;
  styleScore?: number;
  explanation?: string[];
};

export default function OutfitDetailsScreen() {
  const { id } = useLocalSearchParams();

  const [outfit, setOutfit] =
    useState<DetailedSavedOutfit | null>(null);

  const [rowFavorite, setRowFavorite] = useState(false);
  const [createdAt, setCreatedAt] =
    useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadOutfit();
  }, [id]);

  async function loadOutfit() {
    if (!id) {
      setLoading(false);
      return;
    }

    try {
      const row = await getSavedOutfitById(String(id));

      setOutfit(row.outfit as DetailedSavedOutfit);
      setRowFavorite(Boolean(row.favorite));
      setCreatedAt(row.created_at);
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message || 'Outfit not found.'
      );

      router.back();
    } finally {
      setLoading(false);
    }
  }

  async function openPreview() {
    if (!outfit) return;

    await AsyncStorage.removeItem('previewImage');

    await AsyncStorage.setItem(
      'previewOutfit',
      JSON.stringify({
        top: outfit.top,
        pants:
          outfit.pants ||
          outfit.bottom ||
          null,
        bottom:
          outfit.pants ||
          outfit.bottom ||
          null,
        shoes: outfit.shoes,
        jacket: outfit.jacket,
        accessory: outfit.accessory || null,
      })
    );

    router.push('/app/outfit-preview' as any);
  }

  async function toggleFavorite() {
    if (!id) return;

    const newFavorite = !rowFavorite;

    try {
      await updateOutfitFavorite(
        String(id),
        newFavorite
      );

      setRowFavorite(newFavorite);
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message ||
          'Could not update favorite.'
      );
    }
  }

  async function performDelete() {
    if (!id || deleting) return;

    setDeleting(true);

    try {
      await deleteOutfitFromService(String(id));
      router.back();
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message ||
          'Could not delete outfit.'
      );

      setDeleting(false);
    }
  }

  function deleteOutfit() {
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
          onPress: performDelete,
        },
      ]
    );
  }

  async function shareOutfit() {
    if (!outfit) return;

    const bottom =
      outfit.pants ||
      outfit.bottom ||
      null;

    const explanation =
      outfit.explanation &&
      outfit.explanation.length > 0
        ? `\n\nWhy it works:\n${outfit.explanation
            .slice(0, 3)
            .map((reason) => `• ${reason}`)
            .join('\n')}`
        : '';

    await Share.share({
      message: `👕 ${outfit.top?.name || 'Top'}
👖 ${bottom?.name || 'Bottom'}
👟 ${outfit.shoes?.name || 'Shoes'}
🧥 ${outfit.jacket?.name || 'No Jacket'}
👜 ${outfit.accessory?.name || 'No Accessory'}
🎯 ${outfit.occasion || 'Occasion not saved'}
🌦 ${outfit.weather || 'Weather not saved'}
🍂 ${outfit.season || 'Season not saved'}

Match: ${outfit.score || outfit.aiScore || 0}%
Colors: ${outfit.colorScore || 0}%
Style: ${outfit.styleScore || 0}%
Weather: ${outfit.weatherScore || 0}%
Season: ${outfit.seasonScore || 0}%${explanation}

Made with Triple N ✨`,
    });
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator
          size="large"
          color="#f1d8c2"
        />

        <Text style={styles.loadingText}>
          Loading outfit...
        </Text>
      </View>
    );
  }

  if (!outfit) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.title}>
          Outfit not found
        </Text>
      </View>
    );
  }

  const bottom =
    outfit.pants ||
    outfit.bottom ||
    null;

  const matchScore =
    outfit.score ||
    outfit.aiScore ||
    0;

  const colorScore =
    outfit.colorScore ||
    0;

  const styleScore =
    outfit.styleScore ||
    0;

  const weatherScore =
    outfit.weatherScore ||
    0;

  const seasonScore =
    outfit.seasonScore ||
    0;

  const explanation =
    outfit.explanation || [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backIcon}
          onPress={() => router.back()}
        >
          <Ionicons
            name="chevron-back"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <View style={styles.headerText}>
          <Text style={styles.title}>
            Saved Outfit
          </Text>

          <Text style={styles.date}>
            {createdAt
              ? new Date(
                  createdAt
                ).toLocaleDateString()
              : outfit.createdAt
                ? new Date(
                    outfit.createdAt
                  ).toLocaleDateString()
                : ''}
          </Text>
        </View>
      </View>

      <View style={styles.tagsRow}>
        {outfit.occasion && (
          <Text style={styles.tagChip}>
            🎯 {outfit.occasion}
          </Text>
        )}

        {outfit.weather && (
          <Text style={styles.tagChip}>
            🌦 {outfit.weather}
          </Text>
        )}

        {outfit.season && (
          <Text style={styles.tagChip}>
            🍂 {outfit.season}
          </Text>
        )}
      </View>

      <View style={styles.mainScoreCard}>
        <Text style={styles.mainScoreValue}>
          {matchScore}%
        </Text>

        <Text style={styles.mainScoreLabel}>
          Triple N Match
        </Text>
      </View>

      <View style={styles.scoreGrid}>
        <ScoreCard
          emoji="🎨"
          value={colorScore}
          label="Colors"
        />

        <ScoreCard
          emoji="✨"
          value={styleScore}
          label="Style"
        />

        <ScoreCard
          emoji="🌦"
          value={weatherScore}
          label="Weather"
        />

        <ScoreCard
          emoji="🍂"
          value={seasonScore}
          label="Season"
        />
      </View>

      <View style={styles.preview}>
        <View style={styles.previewCanvasBox}>
          <OutfitCanvas
            outfit={{
              top: outfit.top,
              bottom,
              shoes: outfit.shoes,
              jacket: outfit.jacket,
              accessory:
                outfit.accessory || null,
            }}
            variant="details"
          />
        </View>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            rowFavorite &&
              styles.activeActionButton,
          ]}
          onPress={toggleFavorite}
        >
          <Ionicons
            name={
              rowFavorite
                ? 'heart'
                : 'heart-outline'
            }
            size={24}
            color={
              rowFavorite
                ? '#111'
                : 'white'
            }
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={openPreview}
        >
          <Ionicons
            name="eye-outline"
            size={24}
            color="white"
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={shareOutfit}
        >
          <Ionicons
            name="share-outline"
            size={24}
            color="white"
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={deleteOutfit}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator
              size="small"
              color="#ff5c5c"
            />
          ) : (
            <Ionicons
              name="trash-outline"
              size={24}
              color="#ff5c5c"
            />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.aiCard}>
        <Text style={styles.aiTitle}>
          AI Insight
        </Text>

        {explanation.length > 0 ? (
          explanation
            .slice(0, 5)
            .map((reason, index) => (
              <Text
                key={`${reason}-${index}`}
                style={styles.aiText}
              >
                • {reason}
              </Text>
            ))
        ) : (
          <Text style={styles.aiText}>
            • Strong balance between the selected
            pieces.
            {'\n'}
            • The colors and categories create a
            complete outfit.
            {'\n'}
            • This outfit fits the saved context.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

function ScoreCard({
  emoji,
  value,
  label,
}: {
  emoji: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.scoreCard}>
      <Text style={styles.scoreEmoji}>
        {emoji}
      </Text>

      <Text style={styles.scoreValue}>
        {value}%
      </Text>

      <Text style={styles.scoreLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
  },

  loadingContainer: {
    flex: 1,
    backgroundColor: '#07090d',
    justifyContent: 'center',
    alignItems: 'center',
  },

  loadingText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 14,
  },

  emptyContainer: {
    flex: 1,
    backgroundColor: '#07090d',
    justifyContent: 'center',
    alignItems: 'center',
  },

  content: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 45,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },

  headerText: {
    flex: 1,
  },

  backIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#17191d',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },

  title: {
    color: 'white',
    fontSize: 30,
    fontWeight: '900',
  },

  date: {
    color: '#8f9299',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },

  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },

  tagChip: {
    color: '#facc15',
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#2a2d33',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 18,
    fontSize: 13,
    fontWeight: '900',
  },

  mainScoreCard: {
    backgroundColor: '#17191d',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2a2d33',
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 12,
  },

  mainScoreValue: {
    color: '#f59e0b',
    fontSize: 32,
    fontWeight: '900',
  },

  mainScoreLabel: {
    color: '#999',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },

  scoreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 18,
  },

  scoreCard: {
    width: '48%',
    backgroundColor: '#17191d',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2d33',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 10,
  },

  scoreEmoji: {
    fontSize: 18,
  },

  scoreValue: {
    color: 'white',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 3,
  },

  scoreLabel: {
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },

  preview: {
    height: 500,
    backgroundColor: '#f4efe6',
    borderRadius: 34,
    borderWidth: 1.5,
    borderColor: '#2a2d33',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },

  previewCanvasBox: {
    transform: [{ scale: 1.08 }],
  },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginVertical: 24,
  },

  actionButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#2a2d33',
    justifyContent: 'center',
    alignItems: 'center',
  },

  activeActionButton: {
    backgroundColor: '#f4dfc8',
    borderColor: '#f4dfc8',
  },

  aiCard: {
    backgroundColor: '#17191d',
    borderRadius: 26,
    padding: 22,
    borderWidth: 1,
    borderColor: '#2a2d33',
    marginBottom: 35,
  },

  aiTitle: {
    color: 'white',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 12,
  },

  aiText: {
    color: '#9ca3af',
    lineHeight: 23,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 5,
  },
});