// app/app/weather-outfit.tsx
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
  pickWeatherFashionOutfit,
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

export default function WeatherOutfitScreen() {
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
    weatherType,
    setWeatherType,
  ] =
    useState<WeatherType>(
      'Mild'
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

  useFocusEffect(
    useCallback(() => {
      let active =
        true;

      async function loadData() {
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
            wardrobe,
            savedStyle,
            savedUnit,
          ] =
            await Promise.all([
              loadWeatherContext(),
              getMyWardrobeItems(),
              loadStylePreference(),
              loadTemperatureUnit(),
            ]);

          if (!active) {
            return;
          }

          const detectedWeather =
            getWeatherType(
              context
            );

          const wardrobeItems =
            wardrobe as FashionItem[];

          setItems(
            wardrobeItems
          );

          setAppContext(
            context
          );

          setWeatherType(
            detectedWeather
          );

          setStylePreference(
            savedStyle
          );

          setTemperatureUnit(
            savedUnit
          );

          const result =
            buildWeatherResult(
              wardrobeItems,
              detectedWeather,
              savedStyle,
              context
            );

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
                'weatherOutfit.loadFailed'
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

      void loadData();

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
    error: unknown
  ) {
    if (
      typeof error ===
        'object' &&
      error !==
        null &&
      'message' in error &&
      typeof (
        error as {
          message?: unknown;
        }
      ).message ===
        'string'
    ) {
      return (
        error as {
          message: string;
        }
      ).message;
    }

    return '';
  }

  async function loadStylePreference():
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
    value: StyleType
  ) {
    if (!isItalian) {
      return value;
    }

    switch (value) {
      case 'Classic':
        return 'Classico';

      case 'Luxury':
        return 'Lusso';

      case 'Streetwear':
        return 'Streetwear';

      case 'Sport':
        return 'Sportivo';

      case 'Minimal':
      default:
        return 'Minimal';
    }
  }

  function translateWeather(
    value: WeatherType
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
    text: string,
    key: string,
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
    text: string,
    firstKey: string,
    firstValue:
      | string
      | number,
    secondKey: string,
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

  function buildWeatherResult(
    wardrobe:
      FashionItem[],

    selectedWeather:
      WeatherType,

    selectedStyle:
      StyleType,

    context:
      AppWeatherContext
  ) {
    const season =
      normalizeSeason(
        context.season,
        context.temperature
      );

    return pickWeatherFashionOutfit(
      wardrobe,
      selectedWeather,
      selectedStyle,
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

  function generateWeatherOutfit() {
    if (!appContext) {
      Alert.alert(
        t(
          'weatherOutfit.weatherLoading'
        ),
        t(
          'weatherOutfit.weatherLoadingMessage'
        )
      );

      return;
    }

    const result =
      buildWeatherResult(
        items,
        weatherType,
        stylePreference,
        appContext
      );

    applyEngineResult(
      result
    );
  }

  function showNextOutfit() {
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

  async function saveOutfit() {
    if (
      !selectedOutfit ||
      saving
    ) {
      Alert.alert(
        t(
          'outfit.noOutfit'
        ),
        t(
          'weatherOutfit.noOutfitToSave'
        )
      );

      return;
    }

    const outfit =
      selectedOutfit.outfit;

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

    const bottom =
      outfit.bottom ||
      outfit.pants ||
      null;

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
      const normalizedSeason =
        normalizeSeason(
          appContext?.season,
          appContext?.temperature
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
                  ? `Generato per il meteo ${translateWeather(
                      weatherType
                    )}.`
                  : `Generated for ${weatherType} weather.`,

                isItalian
                  ? `Preferenza di stile: ${translateStyle(
                      stylePreference
                    )}.`
                  : `Style preference: ${stylePreference}.`,
              ],

        occasion:
          'Weather',

        weather:
          weatherType,

        season:
          normalizedSeason,
      });

      Alert.alert(
        t(
          'common.saved'
        ),
        t(
          'weatherOutfit.saved'
        )
      );
    } catch (
      error: unknown
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

  function getWeatherDescription() {
    switch (weatherType) {
      case 'Hot':
        return t(
          'weatherOutfit.hotDescription'
        );

      case 'Rainy':
        return t(
          'weatherOutfit.rainyDescription'
        );

      case 'Mild':
      default:
        return t(
          'weatherOutfit.mildDescription'
        );
    }
  }

  function getWeatherEmoji() {
    switch (weatherType) {
      case 'Hot':
        return '☀️';

      case 'Rainy':
        return '🌧️';

      case 'Mild':
      default:
        return '🌤️';
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
            'weatherOutfit.loading'
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
              'weatherOutfit.title'
            )}
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            {t(
              'weatherOutfit.subtitle'
            )}
          </Text>
        </View>
      </View>

      <View
        style={
          styles.aiCard
        }
      >
        <Text
          style={
            styles.weatherText
          }
        >
          {appContext
            ? `${translateSeason(
                appContext.season
              )} • ${formatTemperature(
                appContext.temperature,
                temperatureUnit
              )} • ${translateWeather(
                weatherType
              )}`
            : t(
                'weatherOutfit.unavailable'
              )}
        </Text>

        <Text
          style={
            styles.aiEmoji
          }
        >
          {getWeatherEmoji()}
        </Text>

        <Text
          style={
            styles.aiTitle
          }
        >
          {replaceValue(
            t(
              'weatherOutfit.recommendation'
            ),
            'weather',
            translateWeather(
              weatherType
            )
          )}
        </Text>

        <Text
          style={
            styles.aiText
          }
        >
          {getWeatherDescription()}
        </Text>

        <Text
          style={
            styles.styleText
          }
        >
          {replaceValue(
            t(
              'weatherOutfit.stylePreference'
            ),
            'style',
            translateStyle(
              stylePreference
            )
          )}
        </Text>
      </View>

      <TouchableOpacity
        style={
          styles.generateButton
        }
        onPress={
          generateWeatherOutfit
        }
      >
        <Text
          style={
            styles.generateButtonText
          }
        >
          {t(
            'weatherOutfit.generate'
          )}
        </Text>
      </TouchableOpacity>

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
                'weatherOutfit.noStrong'
              ),
              'weather',
              translateWeather(
                weatherType
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
                  'weatherOutfit.addMore'
                ),
                'weather',
                translateWeather(
                  weatherType
                )
              )}
          </Text>

          <Text
            style={
              styles.noResultHint
            }
          >
            {t(
              'weatherOutfit.noUnsuitable'
            )}
          </Text>
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
              {replaceTwoValues(
                t(
                  'weatherOutfit.outfitCount'
                ),
                'current',
                currentIndex +
                  1,
                'total',
                engineResult
                  ?.suitableOutfits
                  .length ||
                  1
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
                  ?.weather ||
                  0}
                %
              </Text>

              <Text
                style={
                  styles.scoreLabel
                }
              >
                {t(
                  'outfit.weather'
                )}
              </Text>
            </View>
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
                        {isItalian
                          ? 'No'
                          : 'No'}
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
                        {isItalian
                          ? 'No'
                          : 'No'}
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
            .reasons.length >
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
                  4
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
                styles.nextButton,

                (
                  !engineResult ||
                  engineResult
                    .suitableOutfits
                    .length <=
                    1
                ) &&
                  styles.disabledButton,
              ]}
              onPress={
                showNextOutfit
              }
              disabled={
                !engineResult ||
                engineResult
                  .suitableOutfits
                  .length <=
                  1
              }
            >
              <Text
                style={
                  styles.nextButtonText
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
                styles.saveButton,

                saving &&
                  styles.disabledButton,
              ]}
              onPress={
                saveOutfit
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
                    styles.saveButtonText
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
      marginTop: 15,
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
        18,
    },

    headerText: {
      flex: 1,
    },

    backIcon: {
      width: 44,
      height: 44,
      borderRadius:
        22,
      backgroundColor:
        '#17191d',
      justifyContent:
        'center',
      alignItems:
        'center',
      marginRight:
        12,
    },

    backIconText: {
      color: '#fff',
      fontSize: 36,
      marginTop: -4,
    },

    title: {
      color: '#fff',
      fontSize: 30,
      fontWeight:
        '900',
    },

    subtitle: {
      color: '#aaa',
      fontSize: 13,
      fontWeight:
        '600',
      marginTop: 3,
    },

    aiCard: {
      backgroundColor:
        '#17191d',
      borderRadius:
        24,
      padding: 18,
      borderWidth: 1,
      borderColor:
        '#252a31',
      marginBottom:
        16,
      alignItems:
        'center',
    },

    weatherText: {
      color: '#facc15',
      fontSize: 14,
      fontWeight:
        '900',
      marginBottom:
        10,
      textAlign:
        'center',
    },

    aiEmoji: {
      fontSize: 36,
      marginBottom: 8,
    },

    aiTitle: {
      color: '#fff',
      fontSize: 21,
      fontWeight:
        '900',
      marginBottom: 8,
      textAlign:
        'center',
    },

    aiText: {
      color: '#aaa',
      fontSize: 13,
      fontWeight:
        '700',
      lineHeight: 20,
      textAlign:
        'center',
    },

    styleText: {
      color: '#f1d8c2',
      fontSize: 11,
      fontWeight:
        '900',
      marginTop: 10,
    },

    generateButton: {
      backgroundColor:
        '#f1d8c2',
      height: 48,
      borderRadius:
        24,
      justifyContent:
        'center',
      alignItems:
        'center',
      marginBottom:
        14,
    },

    generateButtonText: {
      color: '#111',
      fontSize: 15,
      fontWeight:
        '900',
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
      marginBottom:
        12,
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
      marginTop: 12,
    },

    actionRow: {
      flexDirection:
        'row',
      gap: 10,
      marginTop: 14,
    },

    nextButton: {
      flex: 1,
      height: 50,
      borderRadius:
        22,
      backgroundColor:
        '#17191d',
      borderWidth: 1,
      borderColor:
        '#f1d8c2',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    nextButtonText: {
      color: '#f1d8c2',
      fontSize: 14,
      fontWeight:
        '900',
    },

    saveButton: {
      flex: 1,
      height: 50,
      borderRadius:
        22,
      backgroundColor:
        '#f1d8c2',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    saveButtonText: {
      color: '#111',
      fontSize: 15,
      fontWeight:
        '900',
    },

    disabledButton: {
      opacity: 0.45,
    },
  });