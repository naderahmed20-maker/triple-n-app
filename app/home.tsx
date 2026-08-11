import { useTranslation } from '@/lib/i18n';
import {
  getSavedOutfits,
  type SavedOutfit,
} from '@/lib/outfitService';
import {
  getMyProfile,
} from '@/lib/profileService';
import {
  getCurrentUser,
  getMyWardrobeItems,
  type WardrobeItem,
} from '@/lib/wardrobeService';
import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  router,
  useFocusEffect,
} from 'expo-router';
import {
  useCallback,
  useState,
} from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  type AppWeatherContext,
  formatTemperature,
  loadTemperatureUnit,
  loadWeatherContext,
  saveWeatherContext,
  type TemperatureUnit,
} from '../data/appContext';
import {
  WARDROBE_TYPE_KEY,
} from '../data/clothingCategories';
const SUMMER_SEASON =
  'Summer';
type SummerWeather =
  | 'Hot'
  | 'Mild'
  | 'Rainy';
function removeJacketFromOutfit(
  outfit: SavedOutfit
): SavedOutfit {
  return {
    ...outfit,
    jacket:
      null,
  };
}
export default function HomeDashboard() {
  const { t } =
    useTranslation();
  const insets =
    useSafeAreaInsets();
  const bottomInset =
    Math.max(
      insets.bottom,
      10
    );
  const bottomNavHeight =
    78 +
    bottomInset;
  const [
    items,
    setItems,
  ] =
    useState<
      WardrobeItem[]
    >([]);
  const [
    outfits,
    setOutfits,
  ] =
    useState<
      SavedOutfit[]
    >([]);
  const [
    temperature,
    setTemperature,
  ] =
    useState<
      number | null
    >(null);
  const [
    temperatureUnit,
    setTemperatureUnit,
  ] =
    useState<TemperatureUnit>(
      '°C'
    );
  const [
    weatherType,
    setWeatherType,
  ] =
    useState<SummerWeather>(
      'Mild'
    );
  const [
    weatherEmoji,
    setWeatherEmoji,
  ] =
    useState(
      '🌤️'
    );
  const [
    appContext,
    setAppContext,
  ] =
    useState<
      AppWeatherContext | null
    >(null);
  const [
    outfitOfDay,
    setOutfitOfDay,
  ] =
    useState<
      SavedOutfit | null
    >(null);
  const [
    userName,
    setUserName,
  ] =
    useState('');
  function getGreeting() {
    const hour =
      new Date()
        .getHours();
    if (
      hour <
      12
    ) {
      return t(
        'home.greetingMorning'
      );
    }
    if (
      hour <
      18
    ) {
      return t(
        'home.greetingAfternoon'
      );
    }
    return t(
      'home.greetingEvening'
    );
  }
  function normalizeSummerWeather(
    value?:
      | string
      | null
  ): SummerWeather {
    switch (
      value
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
  useFocusEffect(
    useCallback(
      () => {
        let active =
          true;
        async function loadHomeData() {
          try {
            const user =
              await getCurrentUser();
            if (
              !user
            ) {
              router.replace(
                '/login' as any
              );
              return;
            }
            const wardrobeType =
              await AsyncStorage
                .getItem(
                  WARDROBE_TYPE_KEY
                );
            if (
              !wardrobeType
            ) {
              router.replace(
                '/wardrobe-type' as any
              );
              return;
            }
            const profile =
              await getMyProfile();
            if (
              !profile
            ) {
              router.replace(
                '/onboarding' as any
              );
              return;
            }
            const [
              wardrobe,
              savedRows,
              savedUnit,
            ] =
              await Promise.all([
                getMyWardrobeItems(),
                getSavedOutfits(),
                loadTemperatureUnit(),
              ]);
            if (
              !active
            ) {
              return;
            }
            const savedOutfits =
              savedRows.map(
                (
                  row
                ) =>
                  removeJacketFromOutfit(
                    row.outfit
                  )
              );
            const displayName =
              profile.first_name ||
              user
                .user_metadata
                ?.full_name ||
              user
                .user_metadata
                ?.name ||
              user.email
                ?.split(
                  '@'
                )[0] ||
              '';
            setUserName(
              displayName
            );
            setItems(
              wardrobe
            );
            setOutfits(
              savedOutfits
            );
            setTemperatureUnit(
              savedUnit
            );
            await loadDailyOutfit(
              savedOutfits,
              active
            );
          } catch (
            error
          ) {
            if (
              active
            ) {
              console.log(
                'HOME LOAD ERROR:',
                error
              );
            }
          }
        }
        async function refreshHome() {
          await Promise.all([
            loadHomeData(),
            loadWeather(),
          ]);
        }
        void refreshHome();
        return () => {
          active =
            false;
        };
      },
      []
    )
  );
  async function loadDailyOutfit(
    savedOutfits:
      SavedOutfit[],
    active =
      true
  ) {
    if (
      savedOutfits.length ===
      0
    ) {
      if (
        active
      ) {
        setOutfitOfDay(
          null
        );
      }
      return;
    }
    const today =
      new Date()
        .toDateString();
    const [
      savedDay,
      savedIndexValue,
    ] =
      await Promise.all([
        AsyncStorage
          .getItem(
            'outfitOfDayDate'
          ),
        AsyncStorage
          .getItem(
            'outfitOfDayIndex'
          ),
      ]);
    const savedIndex =
      savedIndexValue !==
      null
        ? Number(
            savedIndexValue
          )
        : -1;
    if (
      savedDay ===
        today &&
      Number.isInteger(
        savedIndex
      ) &&
      savedIndex >=
        0 &&
      savedOutfits[
        savedIndex
      ]
    ) {
      if (
        active
      ) {
        setOutfitOfDay(
          removeJacketFromOutfit(
            savedOutfits[
              savedIndex
            ]
          )
        );
      }
      return;
    }
    const randomIndex =
      Math.floor(
        Math.random() *
          savedOutfits.length
      );
    await AsyncStorage
      .multiSet([
        [
          'outfitOfDayDate',
          today,
        ],
        [
          'outfitOfDayIndex',
          randomIndex
            .toString(),
        ],
      ]);
    if (
      active
    ) {
      setOutfitOfDay(
        removeJacketFromOutfit(
          savedOutfits[
            randomIndex
          ]
        )
      );
    }
  }
  async function loadWeather() {
    try {
      const profile =
        await getMyProfile();
      if (
        profile
          ?.first_name
      ) {
        setUserName(
          profile.first_name
        );
      }
      const permission =
        await Location
          .requestForegroundPermissionsAsync();
      if (
        !permission.granted
      ) {
        const fallbackContext =
          await loadWeatherContext();
        const fallbackWeather =
          normalizeSummerWeather(
            fallbackContext.weather
          );
        const summerContext:
          AppWeatherContext = {
          season:
            SUMMER_SEASON,
          temperature:
            fallbackContext.temperature,
          weather:
            fallbackWeather,
        };
        setTemperature(
          summerContext.temperature
        );
        setWeatherType(
          fallbackWeather
        );
        setWeatherEmoji(
          fallbackWeather ===
            'Rainy'
            ? '🌧️'
            : fallbackWeather ===
                'Hot'
              ? '☀️'
              : '🌤️'
        );
        setAppContext(
          summerContext
        );
        await saveWeatherContext(
          summerContext
        );
        return;
      }
      const location =
        await Location
          .getCurrentPositionAsync(
            {}
          );
      const {
        latitude,
        longitude,
      } =
        location.coords;
      const response =
        await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,precipitation,rain,weather_code&timezone=auto`
        );
      if (
        !response.ok
      ) {
        throw new Error(
          'Weather request failed'
        );
      }
      const data =
        await response
          .json();
      const current =
        data?.current;
      if (
        !current ||
        typeof current
          .temperature_2m !==
          'number'
      ) {
        throw new Error(
          'Invalid weather response'
        );
      }
      const temp =
        Math.round(
          current
            .temperature_2m
        );
      const rain =
        Number(
          current.rain ||
            current
              .precipitation ||
            0
        );
      const weatherCode =
        Number(
          current
            .weather_code
        );
      let type:
        SummerWeather =
        'Mild';
      let emoji =
        '🌤️';
      if (
        rain >
          0 ||
        [
          51,
          53,
          55,
          61,
          63,
          65,
          80,
          81,
          82,
        ].includes(
          weatherCode
        )
      ) {
        type =
          'Rainy';
        emoji =
          '🌧️';
      } else if (
        temp >=
        28
      ) {
        type =
          'Hot';
        emoji =
          '☀️';
      }
      const newContext:
        AppWeatherContext = {
        season:
          SUMMER_SEASON,
        temperature:
          temp,
        weather:
          type,
      };
      setTemperature(
        temp
      );
      setWeatherType(
        type
      );
      setWeatherEmoji(
        emoji
      );
      setAppContext(
        newContext
      );
      await saveWeatherContext(
        newContext
      );
    } catch (
      error
    ) {
      console.log(
        'WEATHER ERROR:',
        error
      );
      const fallbackContext =
        await loadWeatherContext();
      const fallbackWeather =
        normalizeSummerWeather(
          fallbackContext.weather
        );
      const summerContext:
        AppWeatherContext = {
        season:
          SUMMER_SEASON,
        temperature:
          fallbackContext.temperature,
        weather:
          fallbackWeather,
      };
      setTemperature(
        summerContext.temperature
      );
      setWeatherType(
        fallbackWeather
      );
      setWeatherEmoji(
        fallbackWeather ===
          'Rainy'
          ? '🌧️'
          : fallbackWeather ===
              'Hot'
            ? '☀️'
            : '🌤️'
      );
      setAppContext(
        summerContext
      );
    }
  }
  const favorites =
    items.filter(
      (
        item
      ) =>
        item.favorite
    ).length;
  async function openOutfitPreview() {
    if (
      !outfitOfDay
    ) {
      return;
    }
    const previewOutfit =
      removeJacketFromOutfit(
        outfitOfDay
      );
    await AsyncStorage
      .setItem(
        'previewOutfit',
        JSON.stringify(
          previewOutfit
        )
      );
    router.push(
      '/app/outfit-preview' as any
    );
  }
  function openWardrobe() {
    router.replace(
      '/wardrobe' as any
    );
  }
  function openOutfits() {
    router.replace(
      '/outfit' as any
    );
  }
  function openSavedOutfits() {
    router.replace(
      '/saved-outfits' as any
    );
  }
  function openProfile() {
    router.replace(
      '/profile' as any
    );
  }
  return (
    <View
      style={
        styles.container
      }
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom:
              bottomNavHeight +
              24,
          },
        ]}
        showsVerticalScrollIndicator={
          false
        }
      >
        <View
          style={
            styles.header
          }
        >
          <View>
            <Text
              style={
                styles.title
              }
            >
              {t(
                'home.title'
              )}
            </Text>
            <Text
              style={
                styles.greeting
              }
            >
              {getGreeting()}
              {', '}
              {userName ||
                t(
                  'common.user'
                )}{' '}
              👋
            </Text>
            <Text
              style={
                styles.subtitle
              }
            >
              {t(
                'home.dressAmazing'
              )}
            </Text>
          </View>
          <View
            style={
              styles.profileCircle
            }
          >
            <Text
              style={
                styles.profileText
              }
            >
              {(userName ||
                t(
                  'common.user'
                ))
                .charAt(
                  0
                )
                .toUpperCase()}
            </Text>
          </View>
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
                'home.summerMode'
              )}{' '}
              •{' '}
              {formatTemperature(
                appContext.temperature,
                temperatureUnit
              )}
            </Text>
          </View>
        )}
        <View
          style={
            styles.overviewCard
          }
        >
          <Text
            style={
              styles.cardTitle
            }
          >
            {t(
              'home.wardrobeOverview'
            )}
          </Text>
          <View
            style={
              styles.statsRow
            }
          >
            <View
              style={
                styles.statBox
              }
            >
              <Text
                style={
                  styles.statNumber
                }
              >
                {items.length}
              </Text>
              <Text
                style={
                  styles.statLabel
                }
              >
                {t(
                  'home.items'
                )}
              </Text>
            </View>
            <View
              style={
                styles.divider
              }
            />
            <View
              style={
                styles.statBox
              }
            >
              <Text
                style={
                  styles.statNumber
                }
              >
                {outfits.length}
              </Text>
              <Text
                style={
                  styles.statLabel
                }
              >
                {t(
                  'home.outfits'
                )}
              </Text>
            </View>
            <View
              style={
                styles.divider
              }
            />
            <View
              style={
                styles.statBox
              }
            >
              <Text
                style={
                  styles.statNumber
                }
              >
                {favorites}
              </Text>
              <Text
                style={
                  styles.statLabel
                }
              >
                {t(
                  'home.favorites'
                )}
              </Text>
            </View>
          </View>
        </View>
        <View
          style={
            styles.quickGrid
          }
        >
          <TouchableOpacity
            style={
              styles.quickButton
            }
            onPress={() =>
              router.push(
                '/app/random-outfit' as any
              )
            }
          >
            <Text
              style={
                styles.quickIcon
              }
            >
              🎲
            </Text>
            <Text
              style={
                styles.quickText
              }
            >
              {t(
                'home.surprise'
              )}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={
              styles.quickButton
            }
            onPress={() =>
              router.push(
                '/app/occasion-outfit' as any
              )
            }
          >
            <Text
              style={
                styles.quickIcon
              }
            >
              🎯
            </Text>
            <Text
              style={
                styles.quickText
              }
            >
              {t(
                'home.occasion'
              )}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={
              styles.quickButton
            }
            onPress={() =>
              router.push(
                '/app/weather-outfit' as any
              )
            }
          >
            <Text
              style={
                styles.quickIcon
              }
            >
              🌤
            </Text>
            <Text
              style={
                styles.quickText
              }
            >
              {t(
                'home.weather'
              )}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={
              styles.quickButton
            }
            onPress={() =>
              router.push(
                '/app/smart-suggestion' as any
              )
            }
          >
            <Text
              style={
                styles.quickIcon
              }
            >
              🧠
            </Text>
            <Text
              style={
                styles.quickText
              }
            >
              {t(
                'home.smart'
              )}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={
              styles.quickButton
            }
            onPress={() =>
              router.push(
                '/app/stats' as any
              )
            }
          >
            <Text
              style={
                styles.quickIcon
              }
            >
              📊
            </Text>
            <Text
              style={
                styles.quickText
              }
            >
              {t(
                'home.stats'
              )}
            </Text>
          </TouchableOpacity>
        </View>
        <View
          style={
            styles.sectionHeader
          }
        >
          <Text
            style={
              styles.sectionTitle
            }
          >
            {t(
              'home.outfitOfDay'
            )}
          </Text>
          <TouchableOpacity
            onPress={
              openOutfitPreview
            }
            disabled={
              !outfitOfDay
            }
          >
            <Text
              style={
                styles.viewText
              }
            >
              {t(
                'common.view'
              )}{' '}
              ›
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={
            styles.outfitCard
          }
          onPress={
            outfitOfDay
              ? openOutfitPreview
              : openOutfits
          }
        >
          {outfitOfDay ? (
            <>
              {outfitOfDay.top && (
                <Image
                  source={{
                    uri:
                      outfitOfDay
                        .top
                        .image,
                  }}
                  style={
                    styles.outfitImage
                  }
                />
              )}
              {(outfitOfDay.pants ||
                outfitOfDay.bottom) && (
                <Image
                  source={{
                    uri:
                      outfitOfDay
                        .pants
                        ?.image ||
                      outfitOfDay
                        .bottom
                        ?.image ||
                      '',
                  }}
                  style={
                    styles.outfitImage
                  }
                />
              )}
              {outfitOfDay.shoes && (
                <Image
                  source={{
                    uri:
                      outfitOfDay
                        .shoes
                        .image,
                  }}
                  style={
                    styles.outfitImage
                  }
                />
              )}
            </>
          ) : (
            <Text
              style={
                styles.emptyOutfit
              }
            >
              {t(
                'home.generateFirst'
              )}
            </Text>
          )}
        </TouchableOpacity>
        <View
          style={
            styles.weatherCard
          }
        >
          <View>
            <Text
              style={
                styles.cardTitle
              }
            >
              {t(
                'home.currentWeather'
              )}
            </Text>
            <Text
              style={
                styles.temp
              }
            >
              {temperature !==
              null
                ? formatTemperature(
                    temperature,
                    temperatureUnit
                  )
                : `--${temperatureUnit}`}
            </Text>
            <Text
              style={
                styles.city
              }
            >
              {translateWeather(
                weatherType
              )}
            </Text>
          </View>
          <Text
            style={
              styles.sun
            }
          >
            {weatherEmoji}
          </Text>
        </View>
      </ScrollView>
      <View
        style={[
          styles.bottomNav,
          {
            height:
              bottomNavHeight,
            paddingBottom:
              bottomInset,
          },
        ]}
      >
        <TouchableOpacity
          style={
            styles.navItem
          }
          disabled
        >
          <Ionicons
            name="home"
            size={32}
            color="white"
          />
          <Text
            style={
              styles.navLabelActive
            }
          >
            {t(
              'nav.home'
            )}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={
            styles.navItem
          }
          onPress={
            openWardrobe
          }
        >
          <MaterialCommunityIcons
            name="hanger"
            size={32}
            color="#777"
          />
          <Text
            style={
              styles.navLabel
            }
          >
            {t(
              'nav.wardrobe'
            )}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={
            styles.navItem
          }
          onPress={
            openOutfits
          }
        >
          <Ionicons
            name="sparkles"
            size={32}
            color="#777"
          />
          <Text
            style={
              styles.navLabel
            }
          >
            {t(
              'nav.outfits'
            )}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={
            styles.navItem
          }
          onPress={
            openSavedOutfits
          }
        >
          <Ionicons
            name="heart"
            size={32}
            color="#777"
          />
          <Text
            style={
              styles.navLabel
            }
          >
            {t(
              'nav.saved'
            )}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={
            styles.navItem
          }
          onPress={
            openProfile
          }
        >
          <Feather
            name="user"
            size={32}
            color="#777"
          />
          <Text
            style={
              styles.navLabel
            }
          >
            {t(
              'nav.profile'
            )}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const styles =
  StyleSheet.create({
    container: {
      flex:
        1,
      backgroundColor:
        '#07090d',
    },
    content: {
      padding:
        22,
      paddingTop:
        58,
      paddingBottom:
        24,
    },
    header: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'flex-start',
      marginBottom:
        18,
    },
    title: {
      color:
        'white',
      fontSize:
        34,
      fontWeight:
        '900',
      marginBottom:
        18,
    },
    greeting: {
      color:
        'white',
      fontSize:
        20,
      fontWeight:
        '800',
    },
    subtitle: {
      color:
        '#aaa',
      fontSize:
        14,
      marginTop:
        4,
      fontWeight:
        '600',
    },
    profileCircle: {
      width:
        38,
      height:
        38,
      borderRadius:
        19,
      backgroundColor:
        '#f1d8c2',
      justifyContent:
        'center',
      alignItems:
        'center',
    },
    profileText: {
      color:
        '#111',
      fontWeight:
        '900',
      fontSize:
        18,
    },
    overviewCard: {
      backgroundColor:
        '#1A1A1A',
      borderRadius:
        24,
      padding:
        16,
      height:
        118,
      marginBottom:
        14,
    },
    cardTitle: {
      color:
        'white',
      fontSize:
        15,
      fontWeight:
        '800',
      marginBottom:
        12,
    },
    statsRow: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
    },
    statBox: {
      flex:
        1,
      alignItems:
        'center',
    },
    statNumber: {
      color:
        'white',
      fontSize:
        18,
      fontWeight:
        '900',
    },
    statLabel: {
      color:
        '#aaa',
      fontSize:
        8,
      marginTop:
        4,
      fontWeight:
        '700',
    },
    divider: {
      width:
        1,
      height:
        45,
      backgroundColor:
        '#333',
    },
    quickGrid: {
      flexDirection:
        'row',
      flexWrap:
        'wrap',
      justifyContent:
        'space-between',
      marginBottom:
        12,
    },
    quickButton: {
      width:
        '48%',
      height:
        58,
      backgroundColor:
        '#17191d',
      borderRadius:
        16,
      borderWidth:
        1,
      borderColor:
        '#252a31',
      flexDirection:
        'row',
      alignItems:
        'center',
      paddingHorizontal:
        12,
      marginBottom:
        8,
    },
    quickIcon: {
      fontSize:
        20,
      marginRight:
        8,
    },
    quickText: {
      color:
        'white',
      fontSize:
        13,
      fontWeight:
        '800',
    },
    sectionHeader: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      marginBottom:
        8,
    },
    sectionTitle: {
      color:
        'white',
      fontSize:
        13,
      fontWeight:
        '900',
    },
    viewText: {
      color:
        '#f1d8c2',
      fontSize:
        10,
      fontWeight:
        '800',
    },
    outfitCard: {
      height:
        102,
      backgroundColor:
        '#e8e4de',
      borderRadius:
        20,
      marginBottom:
        16,
      flexDirection:
        'row',
      justifyContent:
        'space-around',
      alignItems:
        'center',
      padding:
        8,
    },
    outfitImage: {
      width:
        72,
      height:
        84,
      resizeMode:
        'contain',
      borderRadius:
        12,
    },
    emptyOutfit: {
      color:
        '#111',
      fontSize:
        15,
      fontWeight:
        '800',
    },
    weatherCard: {
      height:
        82,
      backgroundColor:
        '#17191d',
      borderRadius:
        22,
      paddingHorizontal:
        18,
      marginBottom:
        16,
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
    },
    temp: {
      color:
        'white',
      fontSize:
        22,
      fontWeight:
        '900',
    },
    city: {
      color:
        '#aaa',
      fontSize:
        9,
      fontWeight:
        '700',
    },
    sun: {
      fontSize:
        40,
    },
    bottomNav: {
      position:
        'absolute',
      left:
        0,
      right:
        0,
      bottom:
        0,
      minHeight:
        78,
      paddingTop:
        8,
      paddingHorizontal:
        6,
      backgroundColor:
        '#07090d',
      borderTopWidth:
        1,
      borderTopColor:
        '#1b1d22',
      flexDirection:
        'row',
      justifyContent:
        'space-around',
      alignItems:
        'flex-start',
      zIndex:
        100,
      elevation:
        20,
    },
    navItem: {
      flex:
        1,
      minHeight:
        64,
      alignItems:
        'center',
      justifyContent:
        'flex-start',
      paddingTop:
        4,
      paddingHorizontal:
        2,
    },
    navLabelActive: {
      color:
        'white',
      fontSize:
        12,
      marginTop:
        4,
      fontWeight:
        '700',
    },
    navLabel: {
      color:
        '#777',
      fontSize:
        12,
      marginTop:
        4,
      fontWeight:
        '700',
    },
    weatherBanner: {
      backgroundColor:
        '#17191d',
      borderRadius:
        18,
      paddingVertical:
        10,
      paddingHorizontal:
        14,
      marginBottom:
        12,
      borderWidth:
        1,
      borderColor:
        '#2a2d35',
    },
    weatherBannerText: {
      color:
        '#facc15',
      fontSize:
        13,
      fontWeight:
        '900',
      textAlign:
        'center',
    },
  });