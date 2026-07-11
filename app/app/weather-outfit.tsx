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
  formatTemperature,
  loadTemperatureUnit,
  loadWeatherContext,
  TemperatureUnit,
} from '../data/appContext';

import {
  FashionEngineResult,
  FashionItem,
  pickWeatherFashionOutfit,
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

export default function WeatherOutfitScreen() {
  const [items, setItems] = useState<FashionItem[]>([]);

  const [appContext, setAppContext] =
    useState<AppWeatherContext | null>(null);

  const [temperatureUnit, setTemperatureUnit] =
    useState<TemperatureUnit>('°C');

  const [stylePreference, setStylePreference] =
    useState<StyleType>('Minimal');

  const [weatherType, setWeatherType] =
    useState<WeatherType>('Mild');

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

      async function loadData() {
        setLoading(true);

        try {
          const user = await getCurrentUser();

          if (!user) {
            router.replace('/login' as any);
            return;
          }

          const [
            context,
            wardrobe,
            savedStyle,
            savedUnit,
          ] = await Promise.all([
            loadWeatherContext(),
            getMyWardrobeItems(),
            loadStylePreference(),
            loadTemperatureUnit(),
          ]);

          if (!active) return;

          const detectedWeather = getWeatherType(context);
          const wardrobeItems = wardrobe as FashionItem[];

          setItems(wardrobeItems);
          setAppContext(context);
          setWeatherType(detectedWeather);
          setStylePreference(savedStyle);
          setTemperatureUnit(savedUnit);

          const result = buildWeatherResult(
            wardrobeItems,
            detectedWeather,
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
              'Failed to load weather outfit.'
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
    context: AppWeatherContext
  ): WeatherType {
    const weather =
      context.weather?.trim().toLowerCase() || '';

    if (
      weather.includes('rain') ||
      weather === 'rainy'
    ) {
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

  function buildWeatherResult(
    wardrobe: FashionItem[],
    selectedWeather: WeatherType,
    selectedStyle: StyleType,
    context: AppWeatherContext
  ) {
    return pickWeatherFashionOutfit(
      wardrobe,
      selectedWeather,
      selectedStyle,
      context.season as SeasonType
    );
  }

  function generateWeatherOutfit() {
    if (!appContext) {
      Alert.alert(
        'Weather loading',
        'Please wait while the weather is loading.'
      );
      return;
    }

    const result = buildWeatherResult(
      items,
      weatherType,
      stylePreference,
      appContext
    );

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
        'There is no suitable weather outfit to save.'
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

        weatherScore:
          selectedOutfit.breakdown.weather,

        seasonScore:
          selectedOutfit.breakdown.season,

        styleScore:
          selectedOutfit.breakdown.style,

        explanation:
          selectedOutfit.reasons.length > 0
            ? selectedOutfit.reasons
            : [
                `Generated for ${weatherType} weather.`,
                `Style preference: ${stylePreference}.`,
              ],

        occasion: 'Weather',
        weather: weatherType,
        season: appContext?.season,
      });

      Alert.alert(
        'Saved',
        'Weather outfit saved successfully.'
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

  function getWeatherDescription() {
    if (weatherType === 'Hot') {
      return 'Hot weather detected. Triple N avoids jackets and heavy shoes.';
    }

    if (weatherType === 'Cold') {
      return 'Cold weather detected. Triple N requires a suitable outer layer.';
    }

    if (weatherType === 'Rainy') {
      return 'Rainy weather detected. Triple N avoids sandals and requires a jacket.';
    }

    return 'Mild weather detected. Triple N balances comfort and style.';
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
          Triple N is checking the weather...
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
          style={styles.backIcon}
          onPress={() => router.back()}
        >
          <Text style={styles.backIconText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerText}>
          <Text style={styles.title}>
            Weather Outfit
          </Text>

          <Text style={styles.subtitle}>
            Triple N builds around today’s weather.
          </Text>
        </View>
      </View>

      <View style={styles.aiCard}>
        <Text style={styles.weatherText}>
          {appContext
            ? `${appContext.season} • ${formatTemperature(
                appContext.temperature,
                temperatureUnit
              )} • ${weatherType}`
            : 'Weather unavailable'}
        </Text>

        <Text style={styles.aiEmoji}>
          {weatherType === 'Hot'
            ? '☀️'
            : weatherType === 'Cold'
              ? '❄️'
              : weatherType === 'Rainy'
                ? '🌧️'
                : '🌤️'}
        </Text>

        <Text style={styles.aiTitle}>
          {weatherType} Recommendation
        </Text>

        <Text style={styles.aiText}>
          {getWeatherDescription()}
        </Text>

        <Text style={styles.styleText}>
          Style preference: {stylePreference}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.generateButton}
        onPress={generateWeatherOutfit}
      >
        <Text style={styles.generateButtonText}>
          Generate Weather Outfit
        </Text>
      </TouchableOpacity>

      {!selectedOutfit || !displayOutfit ? (
        <View style={styles.noResultCard}>
          <Text style={styles.noResultTitle}>
            No strong {weatherType} outfit found
          </Text>

          <Text style={styles.noResultText}>
            {engineResult?.message ||
              `Add more suitable clothes for ${weatherType} weather.`}
          </Text>

          <Text style={styles.noResultHint}>
            Triple N will not show an unsuitable outfit.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.resultInfo}>
            <Text style={styles.resultCount}>
              Outfit {currentIndex + 1} of{' '}
              {engineResult?.suitableOutfits.length || 1}
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
                {breakdown?.weather || 0}%
              </Text>

              <Text style={styles.scoreLabel}>
                Weather
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
                  engineResult.suitableOutfits.length <=
                    1) &&
                  styles.disabledButton,
              ]}
              onPress={showNextOutfit}
              disabled={
                !engineResult ||
                engineResult.suitableOutfits.length <= 1
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
                <ActivityIndicator color="#111" />
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

  backIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#17191d',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  backIconText: {
    color: '#fff',
    fontSize: 36,
    marginTop: -4,
  },

  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
  },

  subtitle: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },

  aiCard: {
    backgroundColor: '#17191d',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#252a31',
    marginBottom: 16,
    alignItems: 'center',
  },

  weatherText: {
    color: '#facc15',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 10,
    textAlign: 'center',
  },

  aiEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },

  aiTitle: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '900',
    marginBottom: 8,
  },

  aiText: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },

  styleText: {
    color: '#f1d8c2',
    fontSize: 11,
    fontWeight: '900',
    marginTop: 10,
  },

  generateButton: {
    backgroundColor: '#f1d8c2',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },

  generateButtonText: {
    color: '#111',
    fontSize: 15,
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