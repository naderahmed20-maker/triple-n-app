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
  pickSmartFashionOutfit,
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

export default function SmartSuggestionScreen() {
  const [items, setItems] = useState<FashionItem[]>([]);

  const [appContext, setAppContext] =
    useState<AppWeatherContext | null>(null);

  const [temperatureUnit, setTemperatureUnit] =
    useState<TemperatureUnit>('°C');

  const [stylePreference, setStylePreference] =
    useState<StyleType>('Minimal');

  const [engineResult, setEngineResult] =
    useState<FashionEngineResult | null>(null);

  const [selectedOutfit, setSelectedOutfit] =
    useState<ScoredFashionOutfit | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const summerMode = appContext?.season === 'Summer';

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
            context,
            savedStyle,
            savedUnit,
            wardrobe,
          ] = await Promise.all([
            loadWeatherContext(),
            getStylePreference(),
            loadTemperatureUnit(),
            getMyWardrobeItems(),
          ]);

          if (!active) return;

          const wardrobeItems = wardrobe as FashionItem[];

          setItems(wardrobeItems);
          setAppContext(context);
          setStylePreference(savedStyle);
          setTemperatureUnit(savedUnit);

          const result = buildSmartResult(
            wardrobeItems,
            savedStyle,
            context
          );

          if (!active) return;

          setEngineResult(result);
          setSelectedOutfit(result.bestOutfit);
          setCurrentIndex(0);
        } catch (error: any) {
          Alert.alert(
            'Error',
            error?.message ||
              'Failed to load smart suggestion.'
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

  async function getStylePreference(): Promise<StyleType> {
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
      weather.includes('storm')
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

  function buildSmartResult(
    wardrobe: FashionItem[],
    style: StyleType,
    context: AppWeatherContext
  ): FashionEngineResult {
    return pickSmartFashionOutfit(
      wardrobe,
      style,
      getWeatherType(context),
      context.season as SeasonType
    );
  }

  function generateAgain() {
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

  async function refreshSuggestion() {
    if (loading) return;

    setLoading(true);

    try {
      const context =
        appContext || (await loadWeatherContext());

      const savedStyle = await getStylePreference();

      const wardrobe =
        items.length > 0
          ? items
          : ((await getMyWardrobeItems()) as FashionItem[]);

      const result = buildSmartResult(
        wardrobe,
        savedStyle,
        context
      );

      setItems(wardrobe);
      setAppContext(context);
      setStylePreference(savedStyle);
      setEngineResult(result);
      setSelectedOutfit(result.bestOutfit);
      setCurrentIndex(0);
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message ||
          'Failed to refresh smart suggestion.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveSmartOutfit() {
    if (!selectedOutfit || saving) {
      Alert.alert(
        'No outfit',
        'There is no suitable outfit to save.'
      );
      return;
    }

    const outfit = selectedOutfit.outfit;

    const bottom =
      outfit.bottom ||
      outfit.pants ||
      null;

    const isDressOutfit =
      outfit.top?.category === 'Dresses' ||
      outfit.top?.category === 'Dress';

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
                `Generated for the ${stylePreference} style.`,
              ],

        occasion: 'Smart',
        weather: getWeatherType(
          appContext || (await loadWeatherContext())
        ),
        season: appContext?.season,
      });

      Alert.alert(
        'Saved',
        'Smart outfit saved successfully.'
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

  const suitableOutfits =
    engineResult?.suitableOutfits || [];

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator
          size="large"
          color="#f1d8c2"
        />

        <Text style={styles.loadingText}>
          Triple N is finding your best outfit...
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
            Smart Suggestion
          </Text>

          <Text style={styles.subtitle}>
            Your AI fashion assistant
          </Text>
        </View>
      </View>

      <View style={styles.aiCard}>
        {appContext && (
          <Text style={styles.weatherText}>
            {appContext.season}
            {' • '}
            {formatTemperature(
              appContext.temperature,
              temperatureUnit
            )}
            {' • '}
            {getWeatherType(appContext)}
          </Text>
        )}

        <Text style={styles.aiEmoji}>🧠</Text>

        <Text style={styles.aiTitle}>
          {stylePreference} Recommendation
        </Text>

        <Text style={styles.aiText}>
          {engineResult?.message ||
            'Triple N analyzed your wardrobe.'}
        </Text>

        {summerMode && (
          <Text style={styles.modeText}>
            ☀️ Summer Mode avoids heavy layers.
          </Text>
        )}
      </View>

      {!selectedOutfit || !displayOutfit ? (
        <View style={styles.noResultCard}>
          <Text style={styles.noResultTitle}>
            No strong {stylePreference} outfit found
          </Text>

          <Text style={styles.noResultText}>
            {engineResult?.message ||
              `Add more suitable pieces for the ${stylePreference} style.`}
          </Text>

          <Text style={styles.noResultHint}>
            Triple N will not show a weak or unsuitable
            combination.
          </Text>

          <TouchableOpacity
            style={styles.refreshButton}
            onPress={refreshSuggestion}
          >
            <Text style={styles.refreshButtonText}>
              Analyze Again
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.resultInfo}>
            <Text style={styles.resultCount}>
              {engineResult?.suitableCount === 1
                ? `You have 1 suitable ${stylePreference} outfit`
                : `Outfit ${currentIndex + 1} of ${
                    suitableOutfits.length
                  }`}
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

          <View style={styles.secondaryScoreRow}>
            <Text style={styles.secondaryScoreText}>
              🌦 Weather: {breakdown?.weather || 0}%
            </Text>

            <Text style={styles.secondaryScoreText}>
              🍂 Season: {breakdown?.season || 0}%
            </Text>
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
                .slice(0, 5)
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
                styles.actionButton,
                suitableOutfits.length <= 1 &&
                  styles.disabledButton,
              ]}
              onPress={generateAgain}
              disabled={suitableOutfits.length <= 1}
            >
              <Text style={styles.actionButtonText}>
                🔄 Next Outfit
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButtonLight,
                saving && styles.disabledButton,
              ]}
              onPress={saveSmartOutfit}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#111" />
              ) : (
                <Text
                  style={styles.actionButtonLightText}
                >
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
    marginTop: 16,
  },

  content: {
    padding: 22,
    paddingTop: 58,
    paddingBottom: 35,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },

  headerText: {
    flex: 1,
  },

  backIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#17191d',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  backIconText: {
    color: 'white',
    fontSize: 28,
    fontWeight: '300',
  },

  title: {
    color: 'white',
    fontSize: 30,
    fontWeight: '900',
  },

  subtitle: {
    color: '#888',
    fontSize: 13,
    marginTop: 3,
    fontWeight: '600',
  },

  aiCard: {
    backgroundColor: '#17191d',
    borderRadius: 22,
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#272a33',
  },

  weatherText: {
    color: '#facc15',
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 12,
    fontWeight: '900',
  },

  aiEmoji: {
    fontSize: 30,
  },

  aiTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 6,
  },

  aiText: {
    color: '#aaa',
    textAlign: 'center',
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },

  modeText: {
    color: '#facc15',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 8,
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
    marginBottom: 8,
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

  secondaryScoreRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },

  secondaryScoreText: {
    color: '#aaa',
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#272a33',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    fontSize: 10,
    fontWeight: '800',
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
    marginTop: 10,
  },

  refreshButton: {
    backgroundColor: '#f1d8c2',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 18,
  },

  refreshButtonText: {
    color: '#111',
    fontSize: 14,
    fontWeight: '900',
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },

  actionButton: {
    flex: 1,
    backgroundColor: '#f1d8c2',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
  },

  actionButtonText: {
    color: '#111',
    fontSize: 14,
    fontWeight: '900',
  },

  actionButtonLight: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
  },

  actionButtonLightText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '900',
  },

  disabledButton: {
    opacity: 0.45,
  },
});