// app/app/smart-suggestion.tsx
// Part 1/2

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  router,
  useFocusEffect,
} from 'expo-router';

import {
  useCallback,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  useTranslation,
} from '@/lib/i18n';

import {
  saveOutfit as saveOutfitToSupabase,
} from '@/lib/outfitService';

import {
  getCurrentUser,
  getMyWardrobeItems,
} from '@/lib/wardrobeService';

import {
  type AppWeatherContext,
  formatTemperature,
  loadTemperatureUnit,
  loadWeatherContext,
  type TemperatureUnit,
} from '../data/appContext';

import {
  type FashionEngineResult,
  type FashionItem,
  pickSmartFashionOutfit,
  type ScoredFashionOutfit,
} from '../data/fashionEngine';

import {
  type SeasonType,
  type StyleType,
  type WeatherType,
} from '../data/fashionRules';

import OutfitCanvas from './components/OutfitCanvas';

const SETTINGS_KEY =
  'TRIPLE_N_SETTINGS';

const VALID_STYLES:
  readonly StyleType[] = [
    'Minimal',
    'Classic',
    'Luxury',
    'Streetwear',
    'Sport',
  ];

type AccessoryPromptStep =
  | 'hidden'
  | 'chooseAccessory'
  | 'chooseBagType'
  | 'askForBag'
  | 'askForCap';

type SelectableAccessoryType =
  | 'Backpack'
  | 'Handbag'
  | 'Cap';

type RecognizedAccessoryType =
  | SelectableAccessoryType
  | 'Watch';

export default function SmartSuggestionScreen() {
  const {
    t,
    language,
  } = useTranslation();

  const [
    items,
    setItems,
  ] =
    useState<FashionItem[]>(
      []
    );

  const [
    appContext,
    setAppContext,
  ] =
    useState<AppWeatherContext | null>(
      null
    );

  const [
    temperatureUnit,
    setTemperatureUnit,
  ] =
    useState<TemperatureUnit>(
      '°C'
    );

  const [
    stylePreference,
    setStylePreference,
  ] =
    useState<StyleType>(
      'Minimal'
    );

  const [
    engineResult,
    setEngineResult,
  ] =
    useState<FashionEngineResult | null>(
      null
    );

  const [
    selectedOutfit,
    setSelectedOutfit,
  ] =
    useState<ScoredFashionOutfit | null>(
      null
    );

  const [
    currentIndex,
    setCurrentIndex,
  ] =
    useState(
      0
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false
    );

  const [
    accessoryPromptStep,
    setAccessoryPromptStep,
  ] =
    useState<AccessoryPromptStep>(
      'hidden'
    );

  const normalizedLanguage =
    String(
      language
    )
      .trim()
      .toLowerCase();

  const isItalian =
    normalizedLanguage ===
      'italian' ||
    normalizedLanguage ===
      'it';

  const normalizedCurrentSeason =
    normalizeSeason(
      appContext?.season,
      appContext?.temperature
    );

  const summerMode =
    normalizedCurrentSeason ===
    'Summer';

  useFocusEffect(
    useCallback(() => {
      let active =
        true;

      async function init() {
        setLoading(
          true
        );

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
            context,
            savedStyle,
            savedUnit,
            wardrobe,
          ] =
            await Promise.all([
              loadWeatherContext(),
              getStylePreference(),
              loadTemperatureUnit(),
              getMyWardrobeItems(),
            ]);

          if (!active) {
            return;
          }

          const wardrobeItems =
            wardrobe as FashionItem[];

          setItems(
            wardrobeItems
          );

          setAppContext(
            context
          );

          setStylePreference(
            savedStyle
          );

          setTemperatureUnit(
            savedUnit
          );

          const result =
            buildSmartResult(
              wardrobeItems,
              savedStyle,
              context
            );

          if (!active) {
            return;
          }

          applyEngineResult(
            result
          );
        } catch (
          error: unknown
        ) {
          if (!active) {
            return;
          }

          Alert.alert(
            t(
              'common.error'
            ),
            getErrorMessage(
              error
            ) ||
              t(
                'smartSuggestion.loadFailed'
              )
          );
        } finally {
          if (active) {
            setLoading(
              false
            );
          }
        }
      }

      void init();

      return () => {
        active =
          false;
      };
    }, [
      t,
      language,
    ])
  );

  function getErrorMessage(
    error:
      unknown
  ) {
    if (
      typeof error ===
        'object' &&
      error !==
        null &&
      'message' in error
    ) {
      const message =
        (
          error as {
            message?: unknown;
          }
        ).message;

      if (
        typeof message ===
        'string'
      ) {
        return message;
      }
    }

    return '';
  }

  async function getStylePreference():
    Promise<StyleType> {
    try {
      const savedSettings =
        await AsyncStorage.getItem(
          SETTINGS_KEY
        );

      if (!savedSettings) {
        return 'Minimal';
      }

      const parsedSettings:
        unknown =
        JSON.parse(
          savedSettings
        );

      if (
        typeof parsedSettings !==
          'object' ||
        parsedSettings ===
          null ||
        !(
          'stylePreference' in
          parsedSettings
        )
      ) {
        return 'Minimal';
      }

      const savedStyle =
        (
          parsedSettings as {
            stylePreference?: unknown;
          }
        ).stylePreference;

      if (
        typeof savedStyle ===
          'string' &&
        VALID_STYLES.includes(
          savedStyle as StyleType
        )
      ) {
        return savedStyle as StyleType;
      }

      return 'Minimal';
    } catch {
      return 'Minimal';
    }
  }

  function translateStyle(
    value:
      StyleType
  ) {
    if (!isItalian) {
      return value;
    }

    switch (value) {
      case 'Classic':
        return 'Classico';

      case 'Luxury':
        return 'Lusso';

      case 'Sport':
        return 'Sportivo';

      case 'Streetwear':
        return 'Streetwear';

      case 'Minimal':
      default:
        return 'Minimal';
    }
  }

  function normalizeSeason(
    value?:
      | string
      | null,

    temperature?:
      | number
      | null
  ): SeasonType {
    const normalized =
      (
        value ||
        ''
      )
        .trim()
        .toLowerCase();

    if (
      normalized ===
      'summer'
    ) {
      return 'Summer';
    }

    if (
      normalized ===
      'spring'
    ) {
      return 'Spring';
    }

    if (
      typeof temperature ===
        'number' &&
      Number.isFinite(
        temperature
      ) &&
      temperature >=
        24
    ) {
      return 'Summer';
    }

    return 'Spring';
  }

  function translateSeason(
    value?:
      | string
      | null
  ) {
    const season =
      normalizeSeason(
        value,
        appContext?.temperature
      );

    switch (season) {
      case 'Summer':
        return t(
          'season.summer'
        );

      case 'Spring':
      default:
        return t(
          'season.spring'
        );
    }
  }

  function translateWeather(
    value:
      WeatherType
  ) {
    switch (value) {
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

  function normalizeAccessoryText(
    value?:
      | string
      | null
  ) {
    return (
      value ||
      ''
    )
      .trim()
      .toLowerCase()
      .replace(
        /[_-]/g,
        ' '
      )
      .replace(
        /\s+/g,
        ' '
      );
  }

  function isAccessoryType(
    item:
      | FashionItem
      | null
      | undefined,

    type:
      RecognizedAccessoryType
  ) {
    if (!item) {
      return false;
    }

    const category =
      normalizeAccessoryText(
        item.category
      );

    const subCategory =
      normalizeAccessoryText(
        item.subCategory
      );

    const name =
      normalizeAccessoryText(
        item.name
      );

    const normalizedType =
      normalizeAccessoryText(
        type
      );

    const combinedValue =
      [
        category,
        subCategory,
        name,
      ]
        .filter(
          Boolean
        )
        .join(
          ' '
        );

    if (
      normalizedType ===
      'handbag'
    ) {
      return (
        subCategory ===
          'handbag' ||
        subCategory ===
          'bag' ||
        category ===
          'bags' ||
        category ===
          'bag' ||
        combinedValue.includes(
          'handbag'
        )
      );
    }

    if (
      normalizedType ===
      'backpack'
    ) {
      return (
        subCategory ===
          'backpack' ||
        combinedValue.includes(
          'backpack'
        )
      );
    }

    if (
      normalizedType ===
      'cap'
    ) {
      return (
        subCategory ===
          'cap' ||
        combinedValue.includes(
          ' cap'
        ) ||
        combinedValue.startsWith(
          'cap'
        )
      );
    }

    if (
      normalizedType ===
      'watch'
    ) {
      return (
        subCategory ===
          'watch' ||
        combinedValue.includes(
          'watch'
        )
      );
    }

    return false;
  }

  function prepareOutfitForAccessoryChoice(
    scoredOutfit:
      ScoredFashionOutfit | null
  ) {
    if (!scoredOutfit) {
      return null;
    }

    const existingAccessory =
      scoredOutfit
        .outfit
        .accessory;

    const watch =
      scoredOutfit
        .outfit
        .watch ||
      (
        isAccessoryType(
          existingAccessory,
          'Watch'
        )
          ? existingAccessory
          : null
      );

    return {
      ...scoredOutfit,

      outfit: {
        ...scoredOutfit.outfit,

        watch,

        bag:
          null,

        cap:
          null,

        accessory:
          null,
      },
    };
  }

  function addAccessoryToOutfit(
    type:
      SelectableAccessoryType
  ) {
    if (!selectedOutfit) {
      return;
    }

    const matchingItems =
      items.filter(
        (
          item
        ) =>
          isAccessoryType(
            item,
            type
          )
      );

    if (
      matchingItems.length ===
      0
    ) {
      Alert.alert(
        t(
          'common.error'
        ),

        isItalian
          ? type ===
            'Backpack'
            ? 'Non hai uno zaino nel guardaroba.'
            : type ===
                'Handbag'
              ? 'Non hai una borsa nel guardaroba.'
              : 'Non hai un cappellino nel guardaroba.'
          : type ===
              'Backpack'
            ? "You don't have a backpack in your wardrobe."
            : type ===
                'Handbag'
              ? "You don't have a handbag in your wardrobe."
              : "You don't have a cap in your wardrobe."
      );

      return;
    }

    const selectedItem =
      matchingItems[
        Math.floor(
          Math.random() *
            matchingItems.length
        )
      ];

    const hasBag =
      Boolean(
        selectedOutfit
          .outfit
          .bag
      );

    const hasCap =
      Boolean(
        selectedOutfit
          .outfit
          .cap
      );

    setSelectedOutfit(
      (
        current
      ) => {
        if (!current) {
          return current;
        }

        if (
          type ===
          'Cap'
        ) {
          return {
            ...current,

            outfit: {
              ...current.outfit,

              cap:
                selectedItem,
            },
          };
        }

        return {
          ...current,

          outfit: {
            ...current.outfit,

            bag:
              selectedItem,
          },
        };
      }
    );

    if (
      type ===
      'Cap'
    ) {
      setAccessoryPromptStep(
        hasBag
          ? 'hidden'
          : 'askForBag'
      );

      return;
    }

    setAccessoryPromptStep(
      hasCap
        ? 'hidden'
        : 'askForCap'
    );
  }

  function replaceValue(
    text:
      string,

    key:
      string,

    value:
      | string
      | number
  ) {
    return text.replace(
      `{{${key}}}`,
      String(
        value
      )
    );
  }

  function replaceTwoValues(
    text:
      string,

    firstKey:
      string,

    firstValue:
      | string
      | number,

    secondKey:
      string,

    secondValue:
      | string
      | number
  ) {
    return text
      .replace(
        `{{${firstKey}}}`,
        String(
          firstValue
        )
      )
      .replace(
        `{{${secondKey}}}`,
        String(
          secondValue
        )
      );
  }

  function getWeatherType(
    context:
      AppWeatherContext
  ): WeatherType {
    const weather =
      (
        context.weather ||
        ''
      )
        .trim()
        .toLowerCase();

    if (
      weather.includes(
        'rain'
      ) ||
      weather.includes(
        'storm'
      ) ||
      weather.includes(
        'drizzle'
      ) ||
      weather.includes(
        'shower'
      ) ||
      weather.includes(
        'thunder'
      )
    ) {
      return 'Rainy';
    }

    if (
      weather.includes(
        'hot'
      ) ||
      context.temperature >=
        28
    ) {
      return 'Hot';
    }

    return 'Mild';
  }

  function buildSmartResult(
    wardrobe:
      FashionItem[],

    style:
      StyleType,

    context:
      AppWeatherContext
  ): FashionEngineResult {
    const weather =
      getWeatherType(
        context
      );

    const season =
      normalizeSeason(
        context.season,
        context.temperature
      );

    return pickSmartFashionOutfit(
      wardrobe,
      style,
      weather,
      season,
      language
    );
  }

  function applyEngineResult(
    result:
      FashionEngineResult
  ) {
    setEngineResult(
      result
    );

    const preparedOutfit =
      prepareOutfitForAccessoryChoice(
        result.bestOutfit
      );

    setSelectedOutfit(
      preparedOutfit
    );

    setCurrentIndex(
      0
    );

    setAccessoryPromptStep(
      preparedOutfit
        ? 'chooseAccessory'
        : 'hidden'
    );
  }

  function generateAgain() {
    if (
      !engineResult ||
      engineResult
        .suitableOutfits
        .length <=
        1
    ) {
      return;
    }

    const nextIndex =
      (
        currentIndex +
        1
      ) %
      engineResult
        .suitableOutfits
        .length;

    const nextOutfit =
      engineResult
        .suitableOutfits[
        nextIndex
      ];

    const preparedOutfit =
      prepareOutfitForAccessoryChoice(
        nextOutfit
      );

    setCurrentIndex(
      nextIndex
    );

    setSelectedOutfit(
      preparedOutfit
    );

    setAccessoryPromptStep(
      preparedOutfit
        ? 'chooseAccessory'
        : 'hidden'
    );
  }

  async function refreshSuggestion() {
    if (loading) {
      return;
    }

    setLoading(
      true
    );

    try {
      const context =
        appContext ||
        (
          await loadWeatherContext()
        );

      const savedStyle =
        await getStylePreference();

      const wardrobe =
        items.length >
        0
          ? items
          : (
              await getMyWardrobeItems()
            ) as FashionItem[];

      const result =
        buildSmartResult(
          wardrobe,
          savedStyle,
          context
        );

      setItems(
        wardrobe
      );

      setAppContext(
        context
      );

      setStylePreference(
        savedStyle
      );

      applyEngineResult(
        result
      );
    } catch (
      error:
        unknown
    ) {
      Alert.alert(
        t(
          'common.error'
        ),
        getErrorMessage(
          error
        ) ||
          t(
            'smartSuggestion.refreshFailed'
          )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  async function saveSmartOutfit() {
    if (
      !selectedOutfit ||
      saving
    ) {
      Alert.alert(
        t(
          'outfit.noOutfit'
        ),
        t(
          'smartSuggestion.noOutfitToSave'
        )
      );

      return;
    }

    const outfit =
      selectedOutfit.outfit;

    const bottom =
      outfit.bottom ||
      outfit.pants ||
      null;

    const normalizedTopCategory =
      (
        outfit.top
          ?.category ||
        ''
      )
        .trim()
        .toLowerCase();

    const isDressOutfit =
      normalizedTopCategory ===
        'dress' ||
      normalizedTopCategory ===
        'dresses';

    if (
      !outfit.top ||
      !outfit.shoes ||
      (
        !isDressOutfit &&
        !bottom
      )
    ) {
      Alert.alert(
        t(
          'outfit.noOutfit'
        ),
        t(
          'outfit.completeFirst'
        )
      );

      return;
    }

    setSaving(
      true
    );

    try {
      const context =
        appContext ||
        (
          await loadWeatherContext()
        );

      const weather =
        getWeatherType(
          context
        );

      const season =
        normalizeSeason(
          context.season,
          context.temperature
        );

      await saveOutfitToSupabase({
        top:
          outfit.top,

        pants:
          bottom,

        bottom,

        shoes:
          outfit.shoes,

        jacket:
          outfit.jacket,

        bag:
          outfit.bag,

        cap:
          outfit.cap,

        watch:
          outfit.watch,

        accessory:
          outfit.accessory,

        score:
          selectedOutfit.score,

        aiScore:
          selectedOutfit.score,

        colorScore:
          selectedOutfit
            .breakdown
            .color,

        weatherScore:
          selectedOutfit
            .breakdown
            .weather,

        seasonScore:
          selectedOutfit
            .breakdown
            .season,

        styleScore:
          selectedOutfit
            .breakdown
            .style,

        explanation:
          selectedOutfit
            .reasons
            .length >
          0
            ? selectedOutfit
                .reasons
            : [
                isItalian
                  ? `Generato per lo stile ${translateStyle(
                      stylePreference
                    )}.`
                  : `Generated for the ${stylePreference} style.`,
              ],

        occasion:
          'Smart',

        weather,

        season,
      });

      Alert.alert(
        t(
          'common.saved'
        ),
        t(
          'smartSuggestion.saved'
        )
      );
    } catch (
      error:
        unknown
    ) {
      Alert.alert(
        t(
          'outfit.saveFailed'
        ),
        getErrorMessage(
          error
        ) ||
          t(
            'outfit.saveFailedMessage'
          )
      );
    } finally {
      setSaving(
        false
      );
    }
  }
  const displayOutfit =
    selectedOutfit
      ?.outfit ||
    null;

  const breakdown =
    selectedOutfit
      ?.breakdown ||
    null;

  const suitableOutfits =
    engineResult
      ?.suitableOutfits ||
    [];

  if (loading) {
    return (
      <View
        style={
          styles.loadingScreen
        }
      >
        <ActivityIndicator
          size="large"
          color="#f1d8c2"
        />

        <Text
          style={
            styles.loadingText
          }
        >
          {t(
            'smartSuggestion.loading'
          )}
        </Text>
      </View>
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
            router.back()
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

        <View
          style={
            styles.headerText
          }
        >
          <Text
            style={
              styles.title
            }
          >
            {t(
              'smartSuggestion.title'
            )}
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            {t(
              'smartSuggestion.subtitle'
            )}
          </Text>
        </View>
      </View>

      <View
        style={
          styles.aiCard
        }
      >
        {appContext && (
          <Text
            style={
              styles.weatherText
            }
          >
            {translateSeason(
              appContext.season
            )}
            {' • '}
            {formatTemperature(
              appContext.temperature,
              temperatureUnit
            )}
            {' • '}
            {translateWeather(
              getWeatherType(
                appContext
              )
            )}
          </Text>
        )}

        <Text
          style={
            styles.aiEmoji
          }
        >
          🧠
        </Text>

        <Text
          style={
            styles.aiTitle
          }
        >
          {replaceValue(
            t(
              'smartSuggestion.recommendation'
            ),
            'style',
            translateStyle(
              stylePreference
            )
          )}
        </Text>

        <Text
          style={
            styles.aiText
          }
        >
          {engineResult
            ?.message ||
            t(
              'smartSuggestion.analyzed'
            )}
        </Text>

        {summerMode && (
          <Text
            style={
              styles.modeText
            }
          >
            {t(
              'smartSuggestion.summerMode'
            )}
          </Text>
        )}
      </View>

      {!selectedOutfit ||
      !displayOutfit ? (
        <View
          style={
            styles.noResultCard
          }
        >
          <Text
            style={
              styles.noResultTitle
            }
          >
            {replaceValue(
              t(
                'smartSuggestion.noStrong'
              ),
              'style',
              translateStyle(
                stylePreference
              )
            )}
          </Text>

          <Text
            style={
              styles.noResultText
            }
          >
            {engineResult
              ?.message ||
              replaceValue(
                t(
                  'smartSuggestion.addMore'
                ),
                'style',
                translateStyle(
                  stylePreference
                )
              )}
          </Text>

          <Text
            style={
              styles.noResultHint
            }
          >
            {t(
              'smartSuggestion.noWeak'
            )}
          </Text>

          <TouchableOpacity
            style={
              styles.refreshButton
            }
            onPress={
              refreshSuggestion
            }
          >
            <Text
              style={
                styles.refreshButtonText
              }
            >
              {t(
                'smartSuggestion.analyzeAgain'
              )}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View
            style={
              styles.resultInfo
            }
          >
            <Text
              style={
                styles.resultCount
              }
            >
              {engineResult
                ?.suitableCount ===
              1
                ? replaceValue(
                    t(
                      'smartSuggestion.oneSuitable'
                    ),
                    'style',
                    translateStyle(
                      stylePreference
                    )
                  )
                : replaceTwoValues(
                    t(
                      'smartSuggestion.outfitCount'
                    ),
                    'current',
                    currentIndex +
                      1,
                    'total',
                    suitableOutfits.length
                  )}
            </Text>

            <Text
              style={
                styles.resultMessage
              }
            >
              {
                engineResult
                  ?.message
              }
            </Text>
          </View>

          <View
            style={
              styles.scoreRow
            }
          >
            <View
              style={
                styles.scoreChip
              }
            >
              <Text
                style={
                  styles.scoreValue
                }
              >
                {
                  selectedOutfit.score
                }
                %
              </Text>

              <Text
                style={
                  styles.scoreLabel
                }
              >
                {t(
                  'outfit.match'
                )}
              </Text>
            </View>

            <View
              style={
                styles.scoreChip
              }
            >
              <Text
                style={
                  styles.scoreValue
                }
              >
                {breakdown
                  ?.color ||
                  0}
                %
              </Text>

              <Text
                style={
                  styles.scoreLabel
                }
              >
                {t(
                  'outfit.colors'
                )}
              </Text>
            </View>

            <View
              style={
                styles.scoreChip
              }
            >
              <Text
                style={
                  styles.scoreValue
                }
              >
                {breakdown
                  ?.style ||
                  0}
                %
              </Text>

              <Text
                style={
                  styles.scoreLabel
                }
              >
                {t(
                  'outfit.style'
                )}
              </Text>
            </View>
          </View>

          <View
            style={
              styles.secondaryScoreRow
            }
          >
            <Text
              style={
                styles.secondaryScoreText
              }
            >
              🌦{' '}
              {t(
                'outfit.weather'
              )}
              :{' '}
              {breakdown
                ?.weather ||
                0}
              %
            </Text>

            <Text
              style={
                styles.secondaryScoreText
              }
            >
              🌸{' '}
              {t(
                'outfit.season'
              )}
              :{' '}
              {breakdown
                ?.season ||
                0}
              %
            </Text>
          </View>

          {accessoryPromptStep !==
            'hidden' && (
            <View
              style={
                styles.accessoryPrompt
              }
            >
              {accessoryPromptStep ===
              'chooseAccessory' ? (
                <>
                  <Text
                    style={
                      styles.accessoryPromptTitle
                    }
                  >
                    {isItalian
                      ? 'Vuoi aggiungere una borsa o un cappellino?'
                      : 'Would you like to add a bag or a cap?'}
                  </Text>

                  <View
                    style={
                      styles.accessoryPromptButtons
                    }
                  >
                    <TouchableOpacity
                      style={
                        styles.accessoryPromptButton
                      }
                      onPress={() =>
                        setAccessoryPromptStep(
                          'chooseBagType'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessoryPromptButtonText
                        }
                      >
                        {isItalian
                          ? 'Borsa'
                          : 'Bag'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.accessoryPromptButton
                      }
                      onPress={() =>
                        addAccessoryToOutfit(
                          'Cap'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessoryPromptButtonText
                        }
                      >
                        {isItalian
                          ? 'Cappellino'
                          : 'Cap'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.accessorySkipButton
                      }
                      onPress={() =>
                        setAccessoryPromptStep(
                          'hidden'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessorySkipText
                        }
                      >
                        {isItalian
                          ? 'Niente'
                          : 'Neither'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : accessoryPromptStep ===
                'chooseBagType' ? (
                <>
                  <Text
                    style={
                      styles.accessoryPromptTitle
                    }
                  >
                    {isItalian
                      ? 'Scegli il tipo di borsa'
                      : 'Choose a bag type'}
                  </Text>

                  <View
                    style={
                      styles.accessoryPromptButtons
                    }
                  >
                    <TouchableOpacity
                      style={
                        styles.accessoryPromptButton
                      }
                      onPress={() =>
                        addAccessoryToOutfit(
                          'Backpack'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessoryPromptButtonText
                        }
                      >
                        {isItalian
                          ? 'Zaino'
                          : 'Backpack'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.accessoryPromptButton
                      }
                      onPress={() =>
                        addAccessoryToOutfit(
                          'Handbag'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessoryPromptButtonText
                        }
                      >
                        {isItalian
                          ? 'Borsa'
                          : 'Handbag'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.accessorySkipButton
                      }
                      onPress={() =>
                        setAccessoryPromptStep(
                          'chooseAccessory'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessorySkipText
                        }
                      >
                        {isItalian
                          ? 'Indietro'
                          : 'Back'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : accessoryPromptStep ===
                'askForBag' ? (
                <>
                  <Text
                    style={
                      styles.accessoryPromptTitle
                    }
                  >
                    {isItalian
                      ? 'Vuoi aggiungere anche una borsa?'
                      : 'Would you also like to add a bag?'}
                  </Text>

                  <View
                    style={
                      styles.accessoryPromptButtons
                    }
                  >
                    <TouchableOpacity
                      style={
                        styles.accessoryPromptButton
                      }
                      onPress={() =>
                        setAccessoryPromptStep(
                          'chooseBagType'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessoryPromptButtonText
                        }
                      >
                        {isItalian
                          ? 'Sì, borsa'
                          : 'Yes, add bag'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.accessorySkipButton
                      }
                      onPress={() =>
                        setAccessoryPromptStep(
                          'hidden'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessorySkipText
                        }
                      >
                        No
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text
                    style={
                      styles.accessoryPromptTitle
                    }
                  >
                    {isItalian
                      ? 'Vuoi aggiungere anche un cappellino?'
                      : 'Would you also like to add a cap?'}
                  </Text>

                  <View
                    style={
                      styles.accessoryPromptButtons
                    }
                  >
                    <TouchableOpacity
                      style={
                        styles.accessoryPromptButton
                      }
                      onPress={() =>
                        addAccessoryToOutfit(
                          'Cap'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessoryPromptButtonText
                        }
                      >
                        {isItalian
                          ? 'Sì, cappellino'
                          : 'Yes, add cap'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.accessorySkipButton
                      }
                      onPress={() =>
                        setAccessoryPromptStep(
                          'hidden'
                        )
                      }
                    >
                      <Text
                        style={
                          styles.accessorySkipText
                        }
                      >
                        No
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          )}

          <View
            style={
              styles.outfitCanvasCard
            }
          >
            <OutfitCanvas
              outfit={{
                top:
                  displayOutfit.top,

                bottom:
                  displayOutfit.bottom ||
                  displayOutfit.pants ||
                  null,

                shoes:
                  displayOutfit.shoes,

                jacket:
                  displayOutfit.jacket,

                bag:
                  displayOutfit.bag,

                cap:
                  displayOutfit.cap,

                watch:
                  displayOutfit.watch,

                accessory:
                  displayOutfit.accessory,
              }}
              variant="suggestion"
            />
          </View>

          {selectedOutfit
            .reasons
            .length >
            0 && (
            <View
              style={
                styles.reasonsCard
              }
            >
              <Text
                style={
                  styles.reasonsTitle
                }
              >
                {t(
                  'outfit.whyWorks'
                )}
              </Text>

              {selectedOutfit
                .reasons
                .slice(
                  0,
                  5
                )
                .map(
                  (
                    reason,
                    index
                  ) => (
                    <Text
                      key={`${reason}-${index}`}
                      style={
                        styles.reasonText
                      }
                    >
                      •{' '}
                      {reason}
                    </Text>
                  )
                )}
            </View>
          )}

          <View
            style={
              styles.actionRow
            }
          >
            <TouchableOpacity
              style={[
                styles.actionButton,

                suitableOutfits.length <=
                  1 &&
                  styles.disabledButton,
              ]}
              onPress={
                generateAgain
              }
              disabled={
                suitableOutfits.length <=
                1
              }
            >
              <Text
                style={
                  styles.actionButtonText
                }
              >
                🔄{' '}
                {t(
                  'outfit.next'
                )}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButtonLight,

                saving &&
                  styles.disabledButton,
              ]}
              onPress={
                saveSmartOutfit
              }
              disabled={
                saving
              }
            >
              {saving ? (
                <ActivityIndicator
                  color="#111"
                />
              ) : (
                <Text
                  style={
                    styles.actionButtonLightText
                  }
                >
                  💾{' '}
                  {t(
                    'common.save'
                  )}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#07090d',
    },

    loadingScreen: {
      flex: 1,
      backgroundColor:
        '#07090d',
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal:
        30,
    },

    loadingText: {
      color: '#aaa',
      fontSize: 14,
      fontWeight:
        '700',
      textAlign:
        'center',
      marginTop: 16,
    },

    content: {
      padding: 22,
      paddingTop: 58,
      paddingBottom:
        35,
    },

    header: {
      flexDirection:
        'row',
      alignItems:
        'center',
      marginBottom:
        14,
    },

    headerText: {
      flex: 1,
    },

    backIcon: {
      width: 38,
      height: 38,
      borderRadius:
        19,
      backgroundColor:
        '#17191d',
      justifyContent:
        'center',
      alignItems:
        'center',
      marginRight: 12,
    },

    backIconText: {
      color: '#fff',
      fontSize: 28,
      fontWeight:
        '300',
    },

    title: {
      color: '#fff',
      fontSize: 30,
      fontWeight:
        '900',
    },

    subtitle: {
      color: '#888',
      fontSize: 13,
      marginTop: 3,
      fontWeight:
        '600',
    },

    aiCard: {
      backgroundColor:
        '#17191d',
      borderRadius:
        22,
      padding: 14,
      alignItems:
        'center',
      marginBottom:
        14,
      borderWidth: 1,
      borderColor:
        '#272a33',
    },

    weatherText: {
      color: '#facc15',
      textAlign:
        'center',
      fontSize: 13,
      marginBottom:
        12,
      fontWeight:
        '900',
    },

    aiEmoji: {
      fontSize: 30,
    },

    aiTitle: {
      color: '#fff',
      fontSize: 18,
      fontWeight:
        '900',
      marginTop: 6,
      textAlign:
        'center',
    },

    aiText: {
      color: '#aaa',
      textAlign:
        'center',
      marginTop: 6,
      fontSize: 12,
      lineHeight: 18,
      fontWeight:
        '700',
    },

    modeText: {
      color: '#facc15',
      fontSize: 11,
      fontWeight:
        '800',
      marginTop: 8,
    },

    resultInfo: {
      alignItems:
        'center',
      marginBottom:
        10,
    },

    resultCount: {
      color: '#f1d8c2',
      fontSize: 13,
      fontWeight:
        '900',
      textAlign:
        'center',
    },

    resultMessage: {
      color: '#888',
      fontSize: 11,
      fontWeight:
        '700',
      textAlign:
        'center',
      marginTop: 4,
    },

    scoreRow: {
      flexDirection:
        'row',
      gap: 8,
      marginBottom: 8,
    },

    scoreChip: {
      flex: 1,
      backgroundColor:
        '#17191d',
      borderRadius:
        18,
      paddingVertical:
        10,
      alignItems:
        'center',
      borderWidth: 1,
      borderColor:
        '#272a33',
    },

    scoreValue: {
      color: '#f59e0b',
      fontSize: 18,
      fontWeight:
        '900',
    },

    scoreLabel: {
      color: '#888',
      fontSize: 10,
      fontWeight:
        '800',
      marginTop: 2,
    },

    secondaryScoreRow: {
      flexDirection:
        'row',
      justifyContent:
        'center',
      gap: 8,
      marginBottom:
        12,
    },

    secondaryScoreText: {
      color: '#aaa',
      backgroundColor:
        '#17191d',
      borderWidth: 1,
      borderColor:
        '#272a33',
      paddingHorizontal:
        10,
      paddingVertical:
        6,
      borderRadius:
        14,
      fontSize: 10,
      fontWeight:
        '800',
    },

    accessoryPrompt: {
      width: '100%',
      backgroundColor:
        '#17191d',
      borderRadius:
        18,
      borderWidth: 1,
      borderColor:
        '#252a31',
      paddingVertical:
        12,
      paddingHorizontal:
        12,
      marginBottom:
        12,
    },

    accessoryPromptTitle: {
      color: '#fff',
      fontSize: 13,
      fontWeight:
        '900',
      textAlign:
        'center',
      marginBottom:
        10,
    },

    accessoryPromptButtons: {
      flexDirection:
        'row',
      justifyContent:
        'center',
      gap: 8,
    },

    accessoryPromptButton: {
      flex: 1,
      minHeight: 38,
      backgroundColor:
        '#f1d8c2',
      borderRadius:
        13,
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal:
        8,
    },

    accessoryPromptButtonText: {
      color: '#111',
      fontSize: 11,
      fontWeight:
        '900',
      textAlign:
        'center',
    },

    accessorySkipButton: {
      minWidth: 64,
      minHeight: 38,
      backgroundColor:
        '#25282e',
      borderRadius:
        13,
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal:
        10,
    },

    accessorySkipText: {
      color: '#ddd',
      fontSize: 11,
      fontWeight:
        '800',
    },

    outfitCanvasCard: {
      backgroundColor:
        '#f4efe6',
      borderRadius:
        26,
      paddingVertical:
        18,
      paddingHorizontal:
        10,
      borderWidth: 1,
      borderColor:
        '#252a31',
      marginBottom:
        12,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    reasonsCard: {
      backgroundColor:
        '#17191d',
      borderRadius:
        20,
      padding: 14,
      borderWidth: 1,
      borderColor:
        '#272a33',
    },

    reasonsTitle: {
      color: '#fff',
      fontSize: 15,
      fontWeight:
        '900',
      marginBottom: 8,
    },

    reasonText: {
      color: '#aaa',
      fontSize: 12,
      fontWeight:
        '700',
      lineHeight: 19,
      marginBottom: 4,
    },

    noResultCard: {
      backgroundColor:
        '#17191d',
      borderRadius:
        24,
      padding: 22,
      alignItems:
        'center',
      borderWidth: 1,
      borderColor:
        '#272a33',
    },

    noResultTitle: {
      color: '#fff',
      fontSize: 18,
      fontWeight:
        '900',
      textAlign:
        'center',
    },

    noResultText: {
      color: '#999',
      fontSize: 13,
      fontWeight:
        '700',
      lineHeight: 20,
      textAlign:
        'center',
      marginTop: 8,
    },

    noResultHint: {
      color: '#f1d8c2',
      fontSize: 11,
      fontWeight:
        '800',
      textAlign:
        'center',
      marginTop: 10,
    },

    refreshButton: {
      backgroundColor:
        '#f1d8c2',
      borderRadius:
        18,
      paddingVertical:
        12,
      paddingHorizontal:
        28,
      marginTop: 18,
    },

    refreshButtonText: {
      color: '#111',
      fontSize: 14,
      fontWeight:
        '900',
    },

    actionRow: {
      flexDirection:
        'row',
      gap: 10,
      marginTop: 14,
    },

    actionButton: {
      flex: 1,
      backgroundColor:
        '#f1d8c2',
      paddingVertical:
        14,
      borderRadius:
        20,
      alignItems:
        'center',
    },

    actionButtonText: {
      color: '#111',
      fontSize: 14,
      fontWeight:
        '900',
    },

    actionButtonLight: {
      flex: 1,
      backgroundColor:
        '#fff',
      paddingVertical:
        14,
      borderRadius:
        20,
      alignItems:
        'center',
    },

    actionButtonLightText: {
      color: '#111',
      fontSize: 15,
      fontWeight:
        '900',
    },

    disabledButton: {
      opacity: 0.45,
    },
  });