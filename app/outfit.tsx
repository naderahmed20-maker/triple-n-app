import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import {
  useEffect,
  useRef,
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

import { captureRef } from 'react-native-view-shot';

import { useTranslation } from '@/lib/i18n';

import {
  saveOutfit as saveOutfitToSupabase,
} from '@/lib/outfitService';

import {
  getCurrentUser,
  getMyWardrobeItems,
} from '@/lib/wardrobeService';

import OutfitCanvas from './app/components/OutfitCanvas';

import {
  Outfit,
  pickDifferentOutfit,
  WardrobeItem,
} from './data/outfitRules';

import {
  AppWeatherContext,
  formatTemperature,
  loadTemperatureUnit,
  loadWeatherContext,
  TemperatureUnit,
} from './data/appContext';

import {
  getAIScore,
} from './data/aiScoring';

import {
  getPreferenceBonus,
  getUserPreference,
} from './data/userPreference';

type Occasion =
  | 'Casual'
  | 'Work'
  | 'Date';
  type AccessoryPromptStep =
  | 'hidden'
  | 'chooseAccessory'
  | 'chooseBagType'
  | 'askForBag'
  | 'askForCap';

  const SUMMER_SEASON =
  'Summer';
function normalizeSummerWeather(
  weather?:
    | string
    | null
) {
  switch (
    weather
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
function createSummerContext(
  context:
    AppWeatherContext
): AppWeatherContext {
  return {
    ...context,
    season:
      SUMMER_SEASON,
    weather:
      normalizeSummerWeather(
        context.weather
      ),
  };
}
function removeJacketFromOutfit(
  value: Outfit
): Outfit {
  return {
    ...value,
    /**
     * Summer V1:
     * الجاكيت موجود في الدولاب فقط.
     * لا يدخل في أي Outfit.
     */
    jacket:
      null,
  };
}
function isJacketItem(
  item: WardrobeItem
) {
  const category =
    item.category
      ?.trim()
      .toLowerCase();
  return (
    category ===
      'jacket' ||
    category ===
      'jackets'
  );
}

export default function OutfitScreen() {
  const {
    t,
    language,
  } = useTranslation();

  const [
    items,
    setItems,
  ] =
    useState<WardrobeItem[]>(
      []
    );

  const [
    outfit,
    setOutfit,
  ] =
    useState<Outfit | null>(
      null
    );

  const [
    colorScore,
    setColorScore,
  ] = useState(0);

  const [
    styleScore,
    setStyleScore,
  ] = useState(0);

  const [
    aiExplanation,
    setAiExplanation,
  ] =
    useState<string[]>(
      []
    );

  const [
    occasion,
    setOccasion,
  ] =
    useState<Occasion>(
      'Casual'
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
    userPreference,
    setUserPreference,
  ] = useState<any>(null);

  const [
  accessoryPromptStep,
  setAccessoryPromptStep,
] =
  useState<AccessoryPromptStep>(
    'hidden'
  );

  const previewRef =
    useRef<View>(null);

  const occasions:
    Occasion[] = [
    'Casual',
    'Work',
    'Date',
  ];

  useEffect(() => {
    let active = true;

    async function init() {
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
          context,
          preference,
          savedUnit,
        ] =
          await Promise.all([
            getMyWardrobeItems(),
            loadWeatherContext(),
            getUserPreference(),
            loadTemperatureUnit(),
          ]);

        if (!active) {
          return;
        }

       const summerContext =
  createSummerContext(
    context
  );
/**
 * لا نرسل الجاكيتات لمحرك توليد الأطقم أصلًا.
 * تظل موجودة في الدولاب، لكن هذه الشاشة لا تراها.
 */
const outfitEligibleItems =
  (
    wardrobe as
      WardrobeItem[]
  ).filter(
    (item) =>
      !isJacketItem(
        item
      )
  );
setItems(
  outfitEligibleItems
);
setAppContext(
  summerContext
);
setUserPreference(
  preference
);
setTemperatureUnit(
  savedUnit
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
              'outfit.saveFailedMessage'
            )
        );
      }
    }

    void init();

    return () => {
      active = false;
    };
  }, [t]);

  function translateOccasion(
    value: Occasion
  ) {
    if (
      language ===
      'Italian'
    ) {
      switch (value) {
        case 'Casual':
          return 'Casual';

        case 'Work':
          return 'Lavoro';

        case 'Date':
          return 'Appuntamento';

        default:
          return value;
      }
    }

    return value;
  }

  function translateWeather(
  value?:
    | string
    | null
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

  function normalizeAccessoryText(
  value?: string | null
) {
  return (
    value || ''
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
    | WardrobeItem
    | null
    | undefined,

  type:
    | 'Backpack'
    | 'Handbag'
    | 'Cap'
    | 'Watch'
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

  const normalizedType =
    normalizeAccessoryText(
      type
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
        'bag'
    );
  }

  return (
    subCategory ===
      normalizedType
  );
}

function updateOutfitScores(
  nextOutfit: Outfit
) {
  const cleanOutfit =
    removeJacketFromOutfit(
      nextOutfit
    );
  if (
    !cleanOutfit.top ||
    !cleanOutfit.bottom ||
    !cleanOutfit.shoes
  ) {
    return;
  }
  const ai =
    getAIScore(
      cleanOutfit,
      appContext,
      occasion,
      language
    );
  /**
   * لا نحسب أي Bonus للجاكيت.
   */
  const bonus =
    getPreferenceBonus(
      cleanOutfit.top,
      userPreference
    ) +
    getPreferenceBonus(
      cleanOutfit.bottom,
      userPreference
    ) +
    getPreferenceBonus(
      cleanOutfit.shoes,
      userPreference
    );
  setColorScore(
    ai.color
  );
  setStyleScore(
    Math.min(
      ai.overall +
        bonus,
      99
    )
  );
  setAiExplanation(
    ai.explanation
  );
}

function addAccessoryToOutfit(
  type:
    | 'Backpack'
    | 'Handbag'
    | 'Cap'
) {
  if (!outfit) {
    return;
  }

  const matchingItems =
    items.filter(
      (item) =>
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
      t('common.error'),
      language ===
      'Italian'
        ? `Non hai ${type} nel guardaroba.`
        : `You don't have a ${type} in your wardrobe.`
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

  const nextOutfit:
  Outfit =
  removeJacketFromOutfit(
    type === 'Cap'
      ? {
          ...outfit,
          cap:
            selectedItem,
        }
      : {
          ...outfit,
          bag:
            selectedItem,
        }
  );

 setOutfit(
  nextOutfit
);

updateOutfitScores(
  nextOutfit
);

if (
  type === 'Cap'
) {
  setAccessoryPromptStep(
    outfit.bag
      ? 'hidden'
      : 'askForBag'
  );
} else {
  setAccessoryPromptStep(
    outfit.cap
      ? 'hidden'
      : 'askForCap'
  );
}
}

  async function openPreview() {
    if (
      !outfit ||
      !previewRef.current
    ) {
      Alert.alert(
        t(
          'outfit.generateFirst'
        )
      );

      return;
    }

    try {
      const uri =
        await captureRef(
          previewRef.current,
          {
            format: 'png',
            quality: 1,
          }
        );

      await AsyncStorage.setItem(
        'previewImage',
        uri
      );

      await AsyncStorage.removeItem(
        'previewOutfit'
      );

      router.push(
        '/app/outfit-preview' as any
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        t('common.error'),
        error?.message ||
          t(
            'preview.loadFailed'
          )
      );
    }
  }

function generateOutfit() {
  /**
   * items لا تحتوي أصلًا على أي جاكيت،
   * ثم ننظف النتيجة كطبقة حماية إضافية.
   */
  const generatedOutfit =
    pickDifferentOutfit(
      items,
      outfit
        ? removeJacketFromOutfit(
            outfit
          )
        : null,
      appContext
    );
  const newOutfit =
    removeJacketFromOutfit(
      generatedOutfit
    );
  if (
    !newOutfit.watch &&
    isAccessoryType(
      newOutfit.accessory,
      'Watch'
    )
  ) {
    newOutfit.watch =
      newOutfit.accessory;
  }
  newOutfit.bag =
    null;
  newOutfit.cap =
    null;
  newOutfit.accessory =
    null;
  /**
   * الجاكيت يظل null دائمًا،
   * وليس فقط عندما يكون الفصل Summer.
   */
  newOutfit.jacket =
    null;
  if (
    !newOutfit.top ||
    !newOutfit.bottom ||
    !newOutfit.shoes
  ) {
    Alert.alert(
      t(
        'outfit.notEnoughClothes'
      ),
      t(
        'outfit.needPieces'
      )
    );
    return;
  }
  const ai =
    getAIScore(
      newOutfit,
      appContext,
      occasion,
      language
    );
  const bonus =
    getPreferenceBonus(
      newOutfit.top,
      userPreference
    ) +
    getPreferenceBonus(
      newOutfit.bottom,
      userPreference
    ) +
    getPreferenceBonus(
      newOutfit.shoes,
      userPreference
    );
  const finalStyle =
    Math.min(
      ai.overall +
        bonus,
      99
    );
  setOutfit(
    newOutfit
  );
  setColorScore(
    ai.color
  );
  setStyleScore(
    finalStyle
  );
  setAiExplanation(
    ai.explanation
  );
  setAccessoryPromptStep(
    'chooseAccessory'
  );
}

  async function saveOutfit() {
  if (
    !outfit
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
  const cleanOutfit =
    removeJacketFromOutfit(
      outfit
    );
  if (
    !cleanOutfit.top ||
    !cleanOutfit.bottom ||
    !cleanOutfit.shoes
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
  try {
    const ai =
      getAIScore(
        cleanOutfit,
        appContext,
        occasion,
        language
      );
    await saveOutfitToSupabase({
      top:
        cleanOutfit.top,
      pants:
        cleanOutfit.bottom,
      bottom:
        cleanOutfit.bottom,
      shoes:
        cleanOutfit.shoes,
      /**
       * لا يتم حفظ الجاكيت حتى لو وصلت
       * بيانات قديمة إلى هذه الشاشة.
       */
      jacket:
        null,
      bag:
        cleanOutfit.bag ||
        null,
      cap:
        cleanOutfit.cap ||
        null,
      watch:
        cleanOutfit.watch ||
        null,
      accessory:
        cleanOutfit.accessory ||
        null,
      score:
        ai.overall,
      aiScore:
        ai.overall,
      colorScore:
        ai.color,
      weatherScore:
        ai.weather,
      seasonScore:
        ai.season,
      styleScore:
        ai.style,
      explanation:
        ai.explanation,
      occasion,
      weather:
        normalizeSummerWeather(
          appContext?.weather
        ),
      season:
        SUMMER_SEASON,
    });
    Alert.alert(
      t(
        'common.saved'
      ),
      t(
        'outfit.saved'
      )
    );
  } catch (
    error: any
  ) {
    Alert.alert(
      t(
        'outfit.saveFailed'
      ),
      error?.message ||
        t(
          'outfit.saveFailedMessage'
        )
    );
  }
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
          styles.topBar
        }
      >
        <TouchableOpacity
          onPress={() =>
            router.replace(
              '/home' as any
            )
          }
        >
          <Text
            style={
              styles.backText
            }
          >
            ‹
          </Text>
        </TouchableOpacity>

        <Text
          style={
            styles.title
          }
        >
          {t(
            'outfit.builder'
          )}
        </Text>

        <View
          style={{
            width: 35,
          }}
        />
      </View>

      {appContext && (
        <View
          style={
            styles.weatherBanner
          }
        >
          <Text
  style={
    styles.weatherBannerText
  }
>
  ☀️{' '}
  {t(
    'season.summer'
  )}
  {' • '}
  {formatTemperature(
    appContext.temperature,
    temperatureUnit
  )}
  {' • '}
  {translateWeather(
    appContext.weather
  )}
</Text>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={
          false
        }
        style={
          styles.tabs
        }
      >
        {occasions.map(
          (item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.tab,

                occasion ===
                  item &&
                  styles.activeTab,
              ]}
              onPress={() =>
                setOccasion(
                  item
                )
              }
            >
              <Text
                style={[
                  styles.tabText,

                  occasion ===
                    item &&
                    styles.activeTabText,
                ]}
              >
                {translateOccasion(
                  item
                )}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>
{outfit &&
  accessoryPromptStep !==
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
            {language ===
            'Italian'
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
                {language ===
                'Italian'
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
                {language ===
                'Italian'
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
                {language ===
                'Italian'
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
            {language ===
            'Italian'
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
                {language ===
                'Italian'
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
                {language ===
                'Italian'
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
                {language ===
                'Italian'
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
            {language ===
            'Italian'
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
                {language ===
                'Italian'
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
            {language ===
            'Italian'
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
                {language ===
                'Italian'
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
    styles.mainSection
  }
>
  <TouchableOpacity
    style={
      styles.previewCard
    }
    activeOpacity={
      0.9
    }
    onPress={
      openPreview
    }
  >
    <View
      ref={
        previewRef
      }
      collapsable={
        false
      }
      style={
        styles.outfitCanvas
      }
    >
     <OutfitCanvas
  outfit={
    outfit
      ? removeJacketFromOutfit(
          outfit
        )
      : null
  }
  variant="builder"
/>
    </View>
  </TouchableOpacity>

  <View
    style={
      styles.scoreBox
    }
  >
    <View
      style={
        styles.scoreColumn
      }
    >
      <Text
        style={
          styles.scoreLabel
        }
      >
        {t(
          'outfit.colorMatch'
        )}
      </Text>

      <Text
        style={
          styles.scoreNumber
        }
      >
        {colorScore || 0}%
      </Text>

      <View
        style={
          styles.scoreBar
        }
      >
        <View
          style={[
            styles.scoreFill,

            {
              width:
                `${colorScore || 5}%`,
            },
          ]}
        />
      </View>
    </View>

    <View
      style={
        styles.verticalDivider
      }
    />

    <View
      style={
        styles.scoreColumn
      }
    >
      <Text
        style={
          styles.scoreLabel
        }
      >
        {t(
          'outfit.styleMatch'
        )}
      </Text>

      <Text
        style={
          styles.scoreNumber
        }
      >
        {styleScore || 0}%
      </Text>

      <View
        style={
          styles.scoreBar
        }
      >
        <View
          style={[
            styles.scoreFill,

            {
              width:
                `${styleScore || 5}%`,
            },
          ]}
        />
      </View>
    </View>
  </View>
</View>

      <View
        style={
          styles.whyBox
        }
      >
        <Text
          style={
            styles.whyTitle
          }
        >
          {t(
            'outfit.whyWorks'
          )}
        </Text>

        {aiExplanation.length >
        0 ? (
          aiExplanation.map(
            (
              line,
              index
            ) => (
              <Text
                key={`${line}-${index}`}
                style={
                  styles.whyText
                }
              >
                • {line}
              </Text>
            )
          )
        ) : (
          <>
            <Text
              style={
                styles.whyText
              }
            >
              •{' '}
              {t(
                'outfit.explanationAfterGeneration'
              )}
            </Text>

            <Text
              style={
                styles.whyText
              }
            >
              •{' '}
              {t(
                'outfit.contextConsidered'
              )}
            </Text>
          </>
        )}
      </View>

      <View
        style={
          styles.buttonsRow
        }
      >
        <TouchableOpacity
          style={
            styles.regenerateButton
          }
          onPress={
            generateOutfit
          }
        >
          <Text
            style={
              styles.regenerateText
            }
          >
            {outfit
              ? t(
                  'outfit.regenerate'
                )
              : t(
                  'outfit.generate'
                )}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={
            styles.saveButton
          }
          onPress={
            saveOutfit
          }
        >
          <Text
            style={
              styles.saveText
            }
          >
            {t(
              'outfit.save'
            )}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#07090d',
      paddingHorizontal: 20,
      paddingTop: 60,
    },

    content: {
      paddingBottom: 40,
    },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      marginBottom: 14,
    },

    backText: {
      color: 'white',
      fontSize: 44,
      fontWeight: '300',
    },

    title: {
      color: 'white',
      fontSize: 24,
      fontWeight: '900',
    },

    weatherBanner: {
      backgroundColor:
        '#17191d',
      borderRadius: 16,
      paddingVertical: 9,
      paddingHorizontal: 12,
      marginBottom: 12,
      borderWidth: 1,
      borderColor:
        '#252a31',
    },

    weatherBannerText: {
      color: '#facc15',
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
    },

    tabs: {
      marginBottom: 20,
      maxHeight: 50,
    },

    tab: {
      backgroundColor:
        '#15171c',
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 15,
      marginRight: 10,
    },

    activeTab: {
      backgroundColor:
        '#f4dfc8',
    },

    tabText: {
      color: '#aaa',
      fontWeight: '900',
    },

    activeTabText: {
      color: '#111',
    },

    accessoryPrompt: {
  width: '100%',
  backgroundColor:
    '#17191d',
  borderRadius: 18,
  borderWidth: 1,
  borderColor:
    '#252a31',
  paddingVertical: 12,
  paddingHorizontal: 12,
  marginBottom: 14,
},

accessoryPromptTitle: {
  color: 'white',
  fontSize: 13,
  fontWeight: '900',
  textAlign: 'center',
  marginBottom: 10,
},

accessoryPromptButtons: {
  flexDirection: 'row',
  justifyContent:
    'center',
  gap: 8,
},

accessoryPromptButton: {
  flex: 1,
  minHeight: 38,
  backgroundColor:
    '#f4dfc8',
  borderRadius: 13,
  alignItems: 'center',
  justifyContent:
    'center',
  paddingHorizontal: 8,
},

accessoryPromptButtonText: {
  color: '#111',
  fontSize: 11,
  fontWeight: '900',
  textAlign: 'center',
},

accessorySkipButton: {
  minWidth: 64,
  minHeight: 38,
  backgroundColor:
    '#25282e',
  borderRadius: 13,
  alignItems: 'center',
  justifyContent:
    'center',
  paddingHorizontal: 10,
},

accessorySkipText: {
  color: '#ddd',
  fontSize: 11,
  fontWeight: '800',
},

   mainSection: {
  width: '100%',
  marginBottom: 28,
},

   previewCard: {
  width: '100%',
  height: 470,
  backgroundColor:
    '#e8e4de',
  borderRadius: 28,
  alignItems: 'center',
  justifyContent:
    'center',
  padding: 8,
  overflow: 'hidden',
  marginBottom: 18,
},

    topImage: {
      width: 190,
      height: 135,
      resizeMode: 'contain',
      marginBottom: -8,
    },

    jacketImage: {
      width: 195,
      height: 125,
      resizeMode: 'contain',
      marginBottom: -25,
      zIndex: 3,
    },

    bottomImage: {
      width: 175,
      height: 175,
      resizeMode: 'contain',
      marginBottom: -5,
    },

    shoesImage: {
      width: 130,
      height: 80,
      resizeMode: 'contain',
      alignSelf:
        'flex-end',
    },

    emptySlot: {
      color: '#777',
      fontSize: 18,
      fontWeight: '900',
      marginVertical: 12,
    },

  scoreBox: {
  width: '80%',
  alignSelf: 'center',
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor:
    '#17191d',
  borderRadius: 22,
  borderWidth: 1,
  borderColor:
    '#252a31',
  paddingVertical: 2,
  paddingHorizontal: 16,
},

scoreColumn: {
  flex: 1,
},

verticalDivider: {
  width: 1,
  height: 70,
  backgroundColor:
    '#2a2d33',
  marginHorizontal: 18,
},

    scoreLabel: {
      color: 'white',
      fontSize: 8,
      fontWeight: '600',
      marginBottom: 8,
    },

    scoreNumber: {
      color: '#7ee36b',
      fontSize: 20,
      fontWeight: '900',
      marginBottom: 8,
    },

    scoreBar: {
      height: 2,
      backgroundColor:
        '#1f2933',
      borderRadius: 10,
      overflow: 'hidden',
    },

    scoreFill: {
      height: '100%',
      backgroundColor:
        '#7ee36b',
    },

    scoreDivider: {
      height: 1,
      backgroundColor:
        '#1f2933',
      marginVertical: 32,
    },

    whyBox: {
      marginBottom: 32,
    },

    whyTitle: {
      color: 'white',
      fontSize: 21,
      fontWeight: '900',
      marginBottom: 14,
    },

    whyText: {
      color: '#ddd',
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 10,
    },

    buttonsRow: {
      flexDirection: 'row',
      gap: 14,
    },

    regenerateButton: {
      flex: 1,
      backgroundColor:
        '#15171c',
      paddingVertical: 18,
      borderRadius: 22,
      alignItems: 'center',
    },

    regenerateText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '900',
    },

    saveButton: {
      flex: 1.2,
      backgroundColor:
        '#f4dfc8',
      paddingVertical: 18,
      borderRadius: 22,
      alignItems: 'center',
    },

    saveText: {
      color: '#111',
      fontSize: 16,
      fontWeight: '900',
    },

    outfitCanvas: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent:
        'center',
    },
  });