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
  pickOccasionFashionOutfit,
  ScoredFashionOutfit,
} from '../data/fashionEngine';

import {
  OccasionType,
  SeasonType,
  StyleType,
  WeatherType,
} from '../data/fashionRules';

import OutfitCanvas from './components/OutfitCanvas';

const SETTINGS_KEY = 'TRIPLE_N_SETTINGS';

const occasions: OccasionType[] = [
  'Casual',
  'Work',
  'Party',
  'Sport',
  'Summer',
  'Winter',
  'Date',
];

const VALID_STYLES: StyleType[] = [
  'Minimal',
  'Classic',
  'Luxury',
  'Streetwear',
  'Sport',
];

export default function OccasionOutfitScreen() {
  const [items, setItems] = useState<FashionItem[]>([]);

  const [occasion, setOccasion] =
    useState<OccasionType>('Casual');

  const [stylePreference, setStylePreference] =
    useState<StyleType>('Minimal');

  const [appContext, setAppContext] =
    useState<AppWeatherContext | null>(null);

  const [engineResult, setEngineResult] =
    useState<FashionEngineResult | null>(null);

  const [selectedOutfit, setSelectedOutfit] =
    useState<ScoredFashionOutfit | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function init() {
        setLoading(true);

        try {
          const user = await getCurrentUser();

          if (!user) {
            router.replace('/login' as any);
            return;
          }

          const [
            wardrobe,
            context,
            settings,
          ] = await Promise.all([
            getMyWardrobeItems(),
            loadWeatherContext(),
            loadSavedSettings(),
          ]);

          if (!active) return;

          const defaultOccasion =
            getValidOccasion(settings.occasion);

          const savedStyle =
            getValidStyle(settings.stylePreference);

          const wardrobeItems =
            wardrobe as FashionItem[];

          setItems(wardrobeItems);
          setAppContext(context);
          setOccasion(defaultOccasion);
          setStylePreference(savedStyle);

          const result = buildOccasionResult(
            wardrobeItems,
            defaultOccasion,
            savedStyle,
            context
          );

          setEngineResult(result);
          setSelectedOutfit(result.bestOutfit);
          setCurrentIndex(0);
        } catch (error: any) {
          Alert.alert(
            'Error',
            error?.message ||
              'Failed to load occasion outfits.'
          );
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      }

      init();

      return () => {
        active = false;
      };
    }, [])
  );

  async function loadSavedSettings() {
    try {
      const saved = await AsyncStorage.getItem(
        SETTINGS_KEY
      );

      if (!saved) {
        return {
          occasion: 'Casual',
          stylePreference: 'Minimal',
        };
      }

      return JSON.parse(saved);
    } catch {
      return {
        occasion: 'Casual',
        stylePreference: 'Minimal',
      };
    }
  }

  function getValidOccasion(
    value?: string
  ): OccasionType {
    const found = occasions.find(
      (item) =>
        item.toLowerCase() ===
        value?.trim().toLowerCase()
    );

    return found || 'Casual';
  }

  function getValidStyle(
    value?: string
  ): StyleType {
    const found = VALID_STYLES.find(
      (item) =>
        item.toLowerCase() ===
        value?.trim().toLowerCase()
    );

    return found || 'Minimal';
  }

  function getWeatherType(
    context: AppWeatherContext
  ): WeatherType {
    const weather =
      context.weather?.trim().toLowerCase() || '';

    if (
      weather.includes('rain') ||
      context.weather === 'Rainy'
    ) {
      return 'Rainy';
    }

    if (
      context.temperature >= 28 ||
      context.weather === 'Hot'
    ) {
      return 'Hot';
    }

    if (
      context.temperature <= 14 ||
      context.weather === 'Cold'
    ) {
      return 'Cold';
    }

    return 'Mild';
  }

  function buildOccasionResult(
    wardrobe: FashionItem[],
    selectedOccasion: OccasionType,
    selectedStyle: StyleType,
    context: AppWeatherContext
  ) {
    const weather = getWeatherType(context);

    return pickOccasionFashionOutfit(
      wardrobe,
      selectedOccasion,
      selectedStyle,
      weather,
      context.season as SeasonType
    );
  }

  function generateOccasionOutfit(
    selectedOccasion: OccasionType
  ) {
    if (!appContext) return;

    const result = buildOccasionResult(
      items,
      selectedOccasion,
      stylePreference,
      appContext
    );

    setOccasion(selectedOccasion);
    setEngineResult(result);
    setSelectedOutfit(result.bestOutfit);
    setCurrentIndex(0);
  }

  function showNextOutfit() {
    if (
      !engineResult ||
      engineResult.suitableOutfits.length <= 1
    ) {
      return;
    }

    const nextIndex =
      (currentIndex + 1) %
      engineResult.suitableOutfits.length;

    setCurrentIndex(nextIndex);

    setSelectedOutfit(
      engineResult.suitableOutfits[nextIndex]
    );
  }

  async function saveOutfit() {
    if (!selectedOutfit || saving) {
      Alert.alert(
        'No outfit',
        'There is no suitable outfit to save.'
      );
      return;
    }

    const outfit = selectedOutfit.outfit;
const isDressOutfit =
  outfit.top?.category === 'Dresses' ||
  outfit.top?.category === 'Dress';

const bottom =
  outfit.bottom ||
  outfit.pants ||
  null;

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
                `Generated for ${occasion}.`,
                `Style preference: ${stylePreference}.`,
              ],

        occasion,
        weather: appContext?.weather,
        season: appContext?.season,
      });

      Alert.alert(
        'Saved',
        `${occasion} outfit saved successfully.`
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
          Triple N is building your outfit...
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
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Text style={styles.backText}>‹</Text>
      </TouchableOpacity>

      <Text style={styles.title}>
        Occasion Outfit
      </Text>

      <Text style={styles.subtitle}>
        Choose the mood. Triple N builds the look.
      </Text>

      <Text style={styles.styleText}>
        Style preference: {stylePreference}
      </Text>

      <View style={styles.occasionWrap}>
        {occasions.map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.occasionButton,
              occasion === item &&
                styles.activeOccasionButton,
            ]}
            onPress={() =>
              generateOccasionOutfit(item)
            }
          >
            <Text
              style={[
                styles.occasionText,
                occasion === item &&
                  styles.activeOccasionText,
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!selectedOutfit || !displayOutfit ? (
        <View style={styles.noResultCard}>
          <Text style={styles.noResultTitle}>
            No strong {occasion} outfit found
          </Text>

          <Text style={styles.noResultText}>
            {engineResult?.message ||
              `Add more suitable clothes for ${occasion}.`}
          </Text>

          <Text style={styles.noResultHint}>
            Triple N will not show a weak or unsuitable
            outfit.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.resultInfo}>
            <Text style={styles.resultCount}>
              Outfit {currentIndex + 1} of{' '}
              {engineResult?.suitableOutfits.length ||
                1}
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
                {breakdown?.occasion || 0}%
              </Text>

              <Text style={styles.scoreLabel}>
                Occasion
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
              style={[
                styles.nextButton,
                (!engineResult ||
                  engineResult.suitableOutfits
                    .length <= 1) &&
                  styles.disabledButton,
              ]}
              onPress={showNextOutfit}
              disabled={
                !engineResult ||
                engineResult.suitableOutfits
                  .length <= 1
              }
            >
              <Text style={styles.nextButtonText}>
                🔄 Next Outfit
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
                <ActivityIndicator
                  color="#111"
                />
              ) : (
                <Text style={styles.saveButtonText}>
                  💾 Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
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
    paddingTop: 55,
    paddingBottom: 35,
  },

  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#17191d',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  backText: {
    color: 'white',
    fontSize: 29,
    fontWeight: '300',
    marginTop: -2,
  },

  title: {
    color: 'white',
    fontSize: 34,
    fontWeight: '900',
    marginBottom: 6,
  },

  subtitle: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
  },

  styleText: {
    color: '#f1d8c2',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 7,
    marginBottom: 16,
  },

  occasionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },

  occasionButton: {
    backgroundColor: '#17191d',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#252a31',
  },

  activeOccasionButton: {
    backgroundColor: '#f1d8c2',
    borderColor: '#f1d8c2',
  },

  occasionText: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '800',
  },

  activeOccasionText: {
    color: '#111',
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

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },

  nextButton: {
    flex: 1,
    height: 50,
    borderRadius: 22,
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  nextButtonText: {
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