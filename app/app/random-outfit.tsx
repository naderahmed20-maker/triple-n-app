import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { saveOutfit as saveOutfitToSupabase } from '@/lib/outfitService';
import {
  getCurrentUser,
  getMyWardrobeItems,
} from '@/lib/wardrobeService';

import {
  AppWeatherContext,
  loadWeatherContext,
} from '../data/appContext';

import {
  FashionEngineResult,
  FashionItem,
  getFashionOutfitResult,
  ScoredFashionOutfit,
} from '../data/fashionEngine';

import {
  SeasonType,
  StyleType,
  WeatherType,
} from '../data/fashionRules';

import OutfitCanvas from './components/OutfitCanvas';

const SETTINGS_KEY = 'TRIPLE_N_SETTINGS';

const VALID_STYLES: StyleType[] = [
  'Minimal',
  'Classic',
  'Luxury',
  'Streetwear',
  'Sport',
];

export default function RandomOutfitScreen() {
  const [items, setItems] = useState<FashionItem[]>([]);

  const [stylePreference, setStylePreference] =
    useState<StyleType>('Minimal');

  const [appContext, setAppContext] =
    useState<AppWeatherContext | null>(null);

  const [engineResult, setEngineResult] =
    useState<FashionEngineResult | null>(null);

  const [selectedOutfit, setSelectedOutfit] =
    useState<ScoredFashionOutfit | null>(null);

  const [lastIndex, setLastIndex] = useState(-1);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadData() {
        setLoading(true);

        try {
          const user = await getCurrentUser();

          if (!user) {
            router.replace('/login' as any);
            return;
          }

          const [wardrobe, context, savedStyle] =
            await Promise.all([
              getMyWardrobeItems(),
              loadWeatherContext(),
              loadStylePreference(),
            ]);

          if (!active) return;

          setItems(wardrobe as FashionItem[]);
          setAppContext(context);
          setStylePreference(savedStyle);
          setEngineResult(null);
          setSelectedOutfit(null);
          setLastIndex(-1);
        } catch (error: any) {
          Alert.alert(
            'Error',
            error?.message || 'Failed to load wardrobe.'
          );
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      }

      loadData();

      return () => {
        active = false;
      };
    }, [])
  );

  async function loadStylePreference(): Promise<StyleType> {
    try {
      const savedSettings = await AsyncStorage.getItem(
        SETTINGS_KEY
      );

      if (!savedSettings) {
        return 'Minimal';
      }

      const settings = JSON.parse(savedSettings);
      const savedStyle = settings.stylePreference;

      if (VALID_STYLES.includes(savedStyle)) {
        return savedStyle;
      }

      return 'Minimal';
    } catch {
      return 'Minimal';
    }
  }

  function getWeatherType(
    context?: AppWeatherContext | null
  ): WeatherType | undefined {
    if (!context) return undefined;

    const weather =
      context.weather?.trim().toLowerCase() || '';

    if (weather.includes('rain')) {
      return 'Rainy';
    }

    if (
      weather === 'hot' ||
      context.temperature >= 28
    ) {
      return 'Hot';
    }

    if (
      weather === 'cold' ||
      context.temperature <= 14
    ) {
      return 'Cold';
    }

    return 'Mild';
  }

  function buildResult() {
    const weather = getWeatherType(appContext);

    return getFashionOutfitResult(items, {
      style: stylePreference,
      weather,
      season: appContext?.season as SeasonType | undefined,
      limit: 20,
      maxEvaluations: 50000,
    });
  }

  function chooseRandomIndex(length: number) {
    if (length <= 1) return 0;

    let nextIndex = Math.floor(Math.random() * length);

    while (nextIndex === lastIndex) {
      nextIndex = Math.floor(Math.random() * length);
    }

    return nextIndex;
  }

  function generateRandomOutfit() {
    if (generating) return;

    setGenerating(true);

    try {
      const result = buildResult();

      setEngineResult(result);

      if (result.suitableOutfits.length === 0) {
        setSelectedOutfit(null);
        setLastIndex(-1);
        return;
      }

      const randomIndex = chooseRandomIndex(
        result.suitableOutfits.length
      );

      setLastIndex(randomIndex);

      setSelectedOutfit(
        result.suitableOutfits[randomIndex]
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message || 'Failed to generate outfit.'
      );
    } finally {
      setGenerating(false);
    }
  }

  async function saveOutfit() {
    if (!selectedOutfit || saving) {
      Alert.alert(
        'No outfit',
        'Generate an outfit first.'
      );
      return;
    }

    const outfit = selectedOutfit.outfit;

    const isDressOutfit =
      outfit.top?.category === 'Dresses' ||
      outfit.top?.category === 'Dress';

    const bottom =
      outfit.bottom || outfit.pants || null;

    if (
      !outfit.top ||
      !outfit.shoes ||
      (!isDressOutfit && !bottom)
    ) {
      Alert.alert(
        'No outfit',
        'Generate a complete outfit first.'
      );
      return;
    }

    setSaving(true);

    try {
      await saveOutfitToSupabase({
        top: outfit.top,
        pants: bottom,
        bottom,
        shoes: outfit.shoes,
        jacket: outfit.jacket,
        accessory: outfit.accessory,

        score: selectedOutfit.score,
        aiScore: selectedOutfit.score,

        colorScore:
          selectedOutfit.breakdown.color,

        styleScore:
          selectedOutfit.breakdown.style,

        weatherScore:
          selectedOutfit.breakdown.weather,

        seasonScore:
          selectedOutfit.breakdown.season,

        explanation:
          selectedOutfit.reasons.length > 0
            ? selectedOutfit.reasons
            : [
                `Generated from Surprise Me.`,
                `Style preference: ${stylePreference}.`,
              ],

        occasion: 'Casual',
        weather: appContext?.weather,
        season: appContext?.season,
      });

      Alert.alert(
        'Saved',
        'Outfit saved successfully.'
      );
    } catch (error: any) {
      Alert.alert(
        'Save failed',
        error?.message || 'Something went wrong.'
      );
    } finally {
      setSaving(false);
    }
  }

  const displayOutfit =
    selectedOutfit?.outfit || null;

  const breakdown =
    selectedOutfit?.breakdown || null;

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator
          size="large"
          color="#f1d8c2"
        />

        <Text style={styles.loadingText}>
          Triple N is analyzing your wardrobe...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerText}>
          <Text style={styles.title}>
            Surprise Me
          </Text>

          <Text style={styles.subtitle}>
            A smart surprise from your best outfits.
          </Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoEmoji}>🎲</Text>

        <Text style={styles.infoTitle}>
          {stylePreference} Surprise
        </Text>

        <Text style={styles.infoText}>
          Triple N chooses randomly from your strongest
          matching outfits.
        </Text>

        {appContext && (
          <Text style={styles.contextText}>
            {appContext.season} • {appContext.weather}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={[
          styles.generateButton,
          generating && styles.disabledButton,
        ]}
        onPress={generateRandomOutfit}
        disabled={generating}
      >
        {generating ? (
          <ActivityIndicator color="#111" />
        ) : (
          <Text style={styles.generateButtonText}>
            🎲 Surprise Me
          </Text>
        )}
      </TouchableOpacity>

      {engineResult &&
      (!selectedOutfit || !displayOutfit) ? (
        <View style={styles.noResultCard}>
          <Text style={styles.noResultTitle}>
            No strong {stylePreference} outfit found
          </Text>

          <Text style={styles.noResultText}>
            {engineResult.message}
          </Text>

          <Text style={styles.noResultHint}>
            Triple N will not show a weak or unsuitable
            combination.
          </Text>
        </View>
      ) : selectedOutfit && displayOutfit ? (
        <>
          <View style={styles.resultInfo}>
            <Text style={styles.resultCount}>
              Random choice from{' '}
              {engineResult?.suitableCount || 1} suitable
              outfit(s)
            </Text>

            <Text style={styles.resultMessage}>
              {engineResult?.message}
            </Text>
          </View>

          <View style={styles.scoreRow}>
            <View style={styles.scoreChip}>
              <Text style={styles.scoreValue}>
                {selectedOutfit.score}%
              </Text>

              <Text style={styles.scoreLabel}>
                Match
              </Text>
            </View>

            <View style={styles.scoreChip}>
              <Text style={styles.scoreValue}>
                {breakdown?.color || 0}%
              </Text>

              <Text style={styles.scoreLabel}>
                Colors
              </Text>
            </View>

            <View style={styles.scoreChip}>
              <Text style={styles.scoreValue}>
                {breakdown?.style || 0}%
              </Text>

              <Text style={styles.scoreLabel}>
                Style
              </Text>
            </View>
          </View>

          <View style={styles.outfitCanvasCard}>
            <OutfitCanvas
              outfit={{
                top: displayOutfit.top,
                bottom:
                  displayOutfit.bottom ||
                  displayOutfit.pants ||
                  null,
                shoes: displayOutfit.shoes,
                jacket: displayOutfit.jacket,
                accessory:
                  displayOutfit.accessory,
              }}
              variant="suggestion"
            />
          </View>

          {selectedOutfit.reasons.length > 0 && (
            <View style={styles.reasonsCard}>
              <Text style={styles.reasonsTitle}>
                Why this works
              </Text>

              {selectedOutfit.reasons
                .slice(0, 4)
                .map((reason, index) => (
                  <Text
                    key={`${reason}-${index}`}
                    style={styles.reasonText}
                  >
                    • {reason}
                  </Text>
                ))}
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.anotherButton}
              onPress={generateRandomOutfit}
            >
              <Text style={styles.anotherButtonText}>
                🎲 Another One
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveButton,
                saving && styles.disabledButton,
              ]}
              onPress={saveOutfit}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#111" />
              ) : (
                <Text style={styles.saveButtonText}>
                  💾 Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyEmoji}>👕</Text>

          <Text style={styles.emptyTitle}>
            Ready for a surprise?
          </Text>

          <Text style={styles.emptyText}>
            Press Surprise Me to generate a smart outfit.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
  },

  loadingScreen: {
    flex: 1,
    backgroundColor: '#07090d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  loadingText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 15,
  },

  content: {
    padding: 22,
    paddingTop: 58,
    paddingBottom: 35,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },

  headerText: {
    flex: 1,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#17191d',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  backText: {
    color: 'white',
    fontSize: 32,
    fontWeight: '300',
    marginTop: -3,
  },

  title: {
    color: 'white',
    fontSize: 32,
    fontWeight: '900',
  },

  subtitle: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },

  infoCard: {
    backgroundColor: '#17191d',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#252a31',
    marginBottom: 14,
    alignItems: 'center',
  },

  infoEmoji: {
    fontSize: 36,
  },

  infoTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 8,
  },

  infoText: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
  },

  contextText: {
    color: '#facc15',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 10,
  },

  generateButton: {
    backgroundColor: '#f1d8c2',
    height: 54,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },

  generateButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '900',
  },

  resultInfo: {
    alignItems: 'center',
    marginBottom: 10,
  },

  resultCount: {
    color: '#f1d8c2',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },

  resultMessage: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },

  scoreRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },

  scoreChip: {
    flex: 1,
    backgroundColor: '#17191d',
    borderRadius: 18,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#272a33',
  },

  scoreValue: {
    color: '#f59e0b',
    fontSize: 18,
    fontWeight: '900',
  },

  scoreLabel: {
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },

  outfitCanvasCard: {
    backgroundColor: '#f4efe6',
    borderRadius: 26,
    paddingVertical: 18,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#252a31',
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reasonsCard: {
    backgroundColor: '#17191d',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#272a33',
  },

  reasonsTitle: {
    color: 'white',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 8,
  },

  reasonText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 19,
    marginBottom: 4,
  },

  noResultCard: {
    backgroundColor: '#17191d',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#272a33',
  },

  noResultTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },

  noResultText: {
    color: '#999',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },

  noResultHint: {
    color: '#f1d8c2',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },

  emptyCard: {
    backgroundColor: '#17191d',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#272a33',
  },

  emptyEmoji: {
    fontSize: 38,
  },

  emptyTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 10,
  },

  emptyText: {
    color: '#999',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 7,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },

  anotherButton: {
    flex: 1,
    height: 50,
    borderRadius: 22,
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  anotherButtonText: {
    color: '#f1d8c2',
    fontSize: 14,
    fontWeight: '900',
  },

  saveButton: {
    flex: 1,
    height: 50,
    borderRadius: 22,
    backgroundColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButtonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '900',
  },

  disabledButton: {
    opacity: 0.45,
  },
});