import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import {
  useEffect,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const SETTINGS_KEY =
  'TRIPLE_N_SETTINGS';

const WARDROBE_BUCKET =
  'wardrobe';

type TemperatureUnit =
  | '°C'
  | '°F';

type Occasion =
  | 'Casual'
  | 'Work'
  | 'Date'
  | 'Party'
  | 'Sport';

type StylePreference =
  | 'Minimal'
  | 'Classic'
  | 'Streetwear'
  | 'Sport'
  | 'Luxury';

type Language =
  | 'English'
  | 'Italian';

type AppSettings = {
  notifications: boolean;
  temperature: TemperatureUnit;
  occasion: Occasion;
  language: Language;
  stylePreference: StylePreference;
};

const DEFAULT_SETTINGS:
  AppSettings = {
  notifications: true,
  temperature: '°C',
  occasion: 'Casual',
  language: 'English',
  stylePreference: 'Minimal',
};

Notifications.setNotificationHandler({
  handleNotification:
    async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

export default function SettingsScreen() {
  const {
    t,
    language: currentLanguage,
    changeLanguage,
  } = useTranslation();

  const [
    notifications,
    setNotifications,
  ] = useState(true);

  const [
    temperature,
    setTemperature,
  ] =
    useState<TemperatureUnit>(
      '°C'
    );

  const [
    occasion,
    setOccasion,
  ] =
    useState<Occasion>(
      'Casual'
    );

  const [
    language,
    setLanguage,
  ] =
    useState<Language>(
      'English'
    );

  const [
    stylePreference,
    setStylePreference,
  ] =
    useState<StylePreference>(
      'Minimal'
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    resetting,
    setResetting,
  ] = useState(false);

  const [
    deletingAccount,
    setDeletingAccount,
  ] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    setLanguage(
      currentLanguage
    );
  }, [currentLanguage]);

  function applySettings(
    settings: AppSettings
  ) {
    setNotifications(
      settings.notifications
    );

    setTemperature(
      settings.temperature
    );

    setOccasion(
      settings.occasion
    );

    setLanguage(
      settings.language
    );

    setStylePreference(
      settings.stylePreference
    );
  }

  function getCurrentSettings():
    AppSettings {
    return {
      notifications,
      temperature,
      occasion,
      language,
      stylePreference,
    };
  }

  function translateOccasion(
    value: Occasion
  ) {
    switch (value) {
      case 'Work':
        return t(
          'settings.valueWork'
        );

      case 'Date':
        return t(
          'settings.valueDate'
        );

      case 'Party':
        return t(
          'settings.valueParty'
        );

      case 'Sport':
        return t(
          'settings.valueSport'
        );

      case 'Casual':
      default:
        return t(
          'settings.valueCasual'
        );
    }
  }

  function translateStyle(
    value: StylePreference
  ) {
    switch (value) {
      case 'Classic':
        return t(
          'settings.valueClassic'
        );

      case 'Streetwear':
        return t(
          'settings.valueStreetwear'
        );

      case 'Sport':
        return t(
          'settings.valueSport'
        );

      case 'Luxury':
        return t(
          'settings.valueLuxury'
        );

      case 'Minimal':
      default:
        return t(
          'settings.valueMinimal'
        );
    }
  }

  function translateLanguage(
    value: Language
  ) {
    return value ===
      'Italian'
      ? t(
          'settings.valueItalian'
        )
      : t(
          'settings.valueEnglish'
        );
  }

  async function loadSettings() {
    try {
      const {
        data,
        error,
      } =
        await supabase.auth.getSession();

      if (error) {
        throw error;
      }

      const user =
        data.session?.user;

      if (!user) {
        router.replace(
          '/login' as any
        );

        return;
      }

      const localValue =
        await AsyncStorage.getItem(
          SETTINGS_KEY
        );

      if (localValue) {
        const localSettings =
          JSON.parse(
            localValue
          ) as Partial<AppSettings>;

        applySettings({
          ...DEFAULT_SETTINGS,
          ...localSettings,

          language:
            localSettings.language ===
            'Italian'
              ? 'Italian'
              : 'English',
        });
      }

      const meta =
        user.user_metadata ||
        {};

      const cloudSettings:
        AppSettings = {
        notifications:
          typeof meta.notifications ===
          'boolean'
            ? meta.notifications
            : DEFAULT_SETTINGS.notifications,

        temperature:
          meta.temperature ===
          '°F'
            ? '°F'
            : '°C',

        occasion:
          [
            'Casual',
            'Work',
            'Date',
            'Party',
            'Sport',
          ].includes(
            meta.occasion
          )
            ? meta.occasion
            : DEFAULT_SETTINGS.occasion,

        language:
          meta.language ===
          'Italian'
            ? 'Italian'
            : 'English',

        stylePreference:
          [
            'Minimal',
            'Classic',
            'Streetwear',
            'Sport',
            'Luxury',
          ].includes(
            meta.stylePreference
          )
            ? meta.stylePreference
            : DEFAULT_SETTINGS.stylePreference,
      };

      applySettings(
        cloudSettings
      );

      await AsyncStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(
          cloudSettings
        )
      );

      await changeLanguage(
        cloudSettings.language
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        t(
          'common.error'
        ),
        error?.message ||
          t(
            'settings.loadFailed'
          )
      );
    } finally {
      setLoading(false);
    }
  }

  async function enableDailyNotification() {
    const permission =
      await Notifications.requestPermissionsAsync();

    if (
      !permission.granted
    ) {
      throw new Error(
        t(
          'permission.notifications'
        )
      );
    }

    await Notifications.cancelAllScheduledNotificationsAsync();

    await Notifications.scheduleNotificationAsync({
      content: {
        title:
          t(
            'notification.outfitTitle'
          ),

        body:
          t(
            'notification.outfitBody'
          ),

        sound: true,
      },

      trigger: {
        type:
          Notifications
            .SchedulableTriggerInputTypes
            .DAILY,

        hour: 8,
        minute: 0,
      },
    });
  }

  async function disableNotifications() {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async function saveSettings() {
    if (
      saving ||
      resetting ||
      deletingAccount
    ) {
      return;
    }

    setSaving(true);

    try {
      const settings =
        getCurrentSettings();

      if (
        settings.notifications
      ) {
        await enableDailyNotification();
      } else {
        await disableNotifications();
      }

      await AsyncStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(
          settings
        )
      );

      const {
        error,
      } =
        await supabase.auth.updateUser(
          {
            data: settings,
          }
        );

      if (error) {
        throw error;
      }

      await changeLanguage(
        settings.language
      );

      Alert.alert(
        t(
          'settings.savedTitle'
        ),
        settings.language ===
          'Italian'
          ? 'Impostazioni aggiornate correttamente.'
          : 'Settings updated successfully.'
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        t(
          'common.error'
        ),
        error?.message ||
          t(
            'settings.saveFailed'
          )
      );
    } finally {
      setSaving(false);
    }
  }

  function chooseOccasion() {
    Alert.alert(
      t(
        'settings.defaultOccasion'
      ),
      t(
        'settings.occasionDialog'
      ),
      [
        {
          text:
            t(
              'settings.valueCasual'
            ),
          onPress: () =>
            setOccasion(
              'Casual'
            ),
        },
        {
          text:
            t(
              'settings.valueWork'
            ),
          onPress: () =>
            setOccasion(
              'Work'
            ),
        },
        {
          text:
            t(
              'settings.valueDate'
            ),
          onPress: () =>
            setOccasion(
              'Date'
            ),
        },
        {
          text:
            t(
              'settings.valueParty'
            ),
          onPress: () =>
            setOccasion(
              'Party'
            ),
        },
        {
          text:
            t(
              'settings.valueSport'
            ),
          onPress: () =>
            setOccasion(
              'Sport'
            ),
        },
        {
          text:
            t(
              'common.cancel'
            ),
          style: 'cancel',
        },
      ]
    );
  }

  function chooseStylePreference() {
    Alert.alert(
      t(
        'settings.stylePreference'
      ),
      t(
        'settings.styleDialog'
      ),
      [
        {
          text:
            t(
              'settings.valueMinimal'
            ),
          onPress: () =>
            setStylePreference(
              'Minimal'
            ),
        },
        {
          text:
            t(
              'settings.valueClassic'
            ),
          onPress: () =>
            setStylePreference(
              'Classic'
            ),
        },
        {
          text:
            t(
              'settings.valueStreetwear'
            ),
          onPress: () =>
            setStylePreference(
              'Streetwear'
            ),
        },
        {
          text:
            t(
              'settings.valueSport'
            ),
          onPress: () =>
            setStylePreference(
              'Sport'
            ),
        },
        {
          text:
            t(
              'settings.valueLuxury'
            ),
          onPress: () =>
            setStylePreference(
              'Luxury'
            ),
        },
        {
          text:
            t(
              'common.cancel'
            ),
          style: 'cancel',
        },
      ]
    );
  }

  function chooseLanguage() {
    Alert.alert(
      t(
        'settings.language'
      ),
      t(
        'settings.languageDialog'
      ),
      [
        {
          text:
            t(
              'settings.valueEnglish'
            ),
          onPress: () =>
            setLanguage(
              'English'
            ),
        },
        {
          text:
            t(
              'settings.valueItalian'
            ),
          onPress: () =>
            setLanguage(
              'Italian'
            ),
        },
        {
          text:
            t(
              'common.cancel'
            ),
          style: 'cancel',
        },
      ]
    );
  }

  function extractStoragePath(
    imageUrl?:
      | string
      | null
  ) {
    if (!imageUrl) {
      return null;
    }

    const marker =
      `/storage/v1/object/public/${WARDROBE_BUCKET}/`;

    const markerIndex =
      imageUrl.indexOf(
        marker
      );

    if (
      markerIndex === -1
    ) {
      return null;
    }

    const path =
      imageUrl.slice(
        markerIndex +
          marker.length
      );

    return decodeURIComponent(
      path.split('?')[0]
    );
  }

  async function performReset() {
    if (
      resetting ||
      saving ||
      deletingAccount
    ) {
      return;
    }

    setResetting(true);

    try {
      const {
        data: {
          user,
        },
        error:
          userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace(
          '/login' as any
        );

        return;
      }

      const {
        data:
          wardrobeItems,
        error:
          wardrobeReadError,
      } =
        await supabase
          .from(
            'wardrobe_items'
          )
          .select('image')
          .eq(
            'user_id',
            user.id
          );

      if (
        wardrobeReadError
      ) {
        throw wardrobeReadError;
      }

      const storagePaths =
        (
          wardrobeItems ||
          []
        )
          .map(
            (item) =>
              extractStoragePath(
                item.image
              )
          )
          .filter(
            (
              path
            ): path is string =>
              Boolean(path)
          );

      if (
        storagePaths.length >
        0
      ) {
        const {
          error:
            storageError,
        } =
          await supabase.storage
            .from(
              WARDROBE_BUCKET
            )
            .remove(
              storagePaths
            );

        if (storageError) {
          throw storageError;
        }
      }

      const {
        error:
          outfitsError,
      } =
        await supabase
          .from(
            'saved_outfits'
          )
          .delete()
          .eq(
            'user_id',
            user.id
          );

      if (
        outfitsError
      ) {
        throw outfitsError;
      }

      const {
        error:
          wardrobeError,
      } =
        await supabase
          .from(
            'wardrobe_items'
          )
          .delete()
          .eq(
            'user_id',
            user.id
          );

      if (
        wardrobeError
      ) {
        throw wardrobeError;
      }

      await Notifications.cancelAllScheduledNotificationsAsync();

      await AsyncStorage.clear();

      const {
        error:
          metadataError,
      } =
        await supabase.auth.updateUser(
          {
            data: {
              ...DEFAULT_SETTINGS,

              wardrobeType:
                null,
            },
          }
        );

      if (
        metadataError
      ) {
        throw metadataError;
      }

      await changeLanguage(
        'English'
      );

      await supabase.auth.signOut();

      router.replace(
        '/login' as any
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        t(
          'settings.resetFailed'
        ),
        error?.message ||
          t(
            'settings.resetFailedMessage'
          )
      );

      setResetting(false);
    }
  }

  async function performDeleteAccount() {
    if (
      deletingAccount ||
      resetting ||
      saving
    ) {
      return;
    }

    setDeletingAccount(
      true
    );

    try {
      const {
        data: {
          session,
        },
        error:
          sessionError,
      } =
        await supabase.auth.getSession();

      if (
        sessionError
      ) {
        throw sessionError;
      }

      if (!session) {
        router.replace(
          '/login' as any
        );

        return;
      }

      const {
        data,
        error,
      } =
        await supabase
          .functions
          .invoke(
            'delete-account',
            {
              body: {},
            }
          );

      if (error) {
        throw error;
      }

      if (
        !data ||
        data.success !== true ||
        data.deleted !== true
      ) {
        throw new Error(
          data?.message ||
            data?.error ||
            (
              language ===
              'Italian'
                ? 'Impossibile eliminare l’account.'
                : 'Unable to delete the account.'
            )
        );
      }

      await Notifications
        .cancelAllScheduledNotificationsAsync();

      await AsyncStorage.clear();

      await changeLanguage(
        'English'
      );

      try {
        await supabase.auth.signOut({
          scope:
            'local',
        });
      } catch {
        // The server-side account deletion already succeeded.
      }

      router.replace(
        '/login' as any
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        language ===
          'Italian'
          ? 'Eliminazione account non riuscita'
          : 'Account deletion failed',

        error?.message ||
          (
            language ===
            'Italian'
              ? 'Non è stato possibile eliminare il tuo account. Riprova.'
              : 'Your account could not be deleted. Please try again.'
          )
      );

      setDeletingAccount(
        false
      );
    }
  }

  function deleteAccount() {
    Alert.alert(
      language ===
        'Italian'
        ? 'Elimina account'
        : 'Delete Account',

      language ===
        'Italian'
        ? 'Questa operazione eliminerà definitivamente il tuo account Triple N e i dati associati. Qualsiasi abbonamento Triple N attivo tramite Stripe verrà annullato prima dell’eliminazione. Questa operazione non può essere annullata.'
        : 'This permanently deletes your Triple N account and associated data. Any active Triple N subscription through Stripe will be cancelled before deletion. This action cannot be undone.',

      [
        {
          text:
            t(
              'common.cancel'
            ),
          style:
            'cancel',
        },
        {
          text:
            language ===
              'Italian'
              ? 'Elimina account'
              : 'Delete Account',

          style:
            'destructive',

          onPress: () => {
            void performDeleteAccount();
          },
        },
      ]
    );
  }

  function openProblemReport():
    void {
    router.push(
      '/report-problem' as never
    );
  }

  function openPayment():
    void {
    router.push(
      '/payment' as never
    );
  }

  function resetAppData() {
    Alert.alert(
      t(
        'settings.reset'
      ),
      t(
        'settings.resetMessage'
      ),
      [
        {
          text:
            t(
              'common.cancel'
            ),
          style:
            'cancel',
        },
        {
          text:
            t(
              'settings.deleteEverything'
            ),
          style:
            'destructive',
          onPress:
            performReset,
        },
      ]
    );
  }

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
            'common.loading'
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
      showsVerticalScrollIndicator={
        false
      }
    >
      <View
        style={
          styles.content
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
          <Feather
            name="chevron-left"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <Text
          style={
            styles.title
          }
        >
          {t(
            'settings.title'
          )}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          {t(
            'settings.subtitle'
          )}
        </Text>

        <View
          style={
            styles.card
          }
        >
          <SettingSwitch
            icon="bell"
            title={t(
              'settings.notifications'
            )}
            subtitle={t(
              'settings.notificationsSubtitle'
            )}
            value={
              notifications
            }
            onValueChange={
              setNotifications
            }
          />

          <SettingToggle
            icon="thermometer"
            title={t(
              'settings.temperature'
            )}
            subtitle={t(
              'settings.temperatureSubtitle'
            )}
            value={
              temperature
            }
            left="°C"
            right="°F"
            onChange={(
              value
            ) =>
              setTemperature(
                value as TemperatureUnit
              )
            }
          />

          <SettingRow
            icon="briefcase"
            title={t(
              'settings.defaultOccasion'
            )}
            subtitle={t(
              'settings.occasionSubtitle'
            )}
            value={translateOccasion(
              occasion
            )}
            onPress={
              chooseOccasion
            }
          />

          <SettingRow
            icon="star"
            title={t(
              'settings.stylePreference'
            )}
            subtitle={t(
              'settings.styleSubtitle'
            )}
            value={translateStyle(
              stylePreference
            )}
            onPress={
              chooseStylePreference
            }
          />

          <SettingRow
            icon="globe"
            title={t(
              'settings.language'
            )}
            subtitle={t(
              'settings.languageSubtitle'
            )}
            value={translateLanguage(
              language
            )}
            onPress={
              chooseLanguage
            }
          />
        </View>

        <TouchableOpacity
          style={
            styles.premiumCard
          }
          onPress={
            openPayment
          }
          activeOpacity={
            0.86
          }
        >
          <View
            style={
              styles.premiumIcon
            }
          >
            <Feather
              name="star"
              size={24}
              color="#111111"
            />
          </View>

          <View
            style={
              styles.premiumTextBox
            }
          >
            <View
              style={
                styles.premiumTitleRow
              }
            >
              <Text
                style={
                  styles.premiumTitle
                }
              >
                Triple N Premium
              </Text>

</View>

            <Text
              style={
                styles.premiumSubtitle
              }
            >
              Explore premium plans and the complete Triple N experience.
            </Text>
          </View>

          <View
            style={
              styles.premiumArrow
            }
          >
            <Feather
              name="chevron-right"
              size={22}
              color="#f1d8c2"
            />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={
            styles.problemReportCard
          }
          onPress={
            openProblemReport
          }
          activeOpacity={
            0.86
          }
          accessibilityRole="button"
          accessibilityLabel={t(
            'settings.reportProblem' as never
          )}
          accessibilityHint={t(
            'settings.reportProblemSubtitle' as never
          )}
        >
          <View
            style={
              styles.problemReportIcon
            }
          >
            <Feather
              name="message-circle"
              size={24}
              color="#111111"
            />
          </View>

          <View
            style={
              styles.problemReportTextBox
            }
          >
            <Text
              style={
                styles.problemReportTitle
              }
            >
              {t(
                'settings.reportProblem' as never
              )}
            </Text>

            <Text
              style={
                styles.problemReportSubtitle
              }
            >
              {t(
                'settings.reportProblemSubtitle' as never
              )}
            </Text>
          </View>

          <View
            style={
              styles.problemReportArrow
            }
          >
            <Feather
              name="chevron-right"
              size={22}
              color="#f1d8c2"
            />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.saveButton,

            (
              saving ||
              deletingAccount
            ) &&
              styles.disabledButton,
          ]}
          onPress={
            saveSettings
          }
          disabled={
            saving ||
            resetting ||
            deletingAccount
          }
        >
          {saving ? (
            <ActivityIndicator
              color="#111"
            />
          ) : (
            <>
              <Feather
                name="check"
                size={21}
                color="#111"
              />

              <Text
                style={
                  styles.saveText
                }
              >
                {t(
                  'settings.save'
                )}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.resetButton,

            (
              resetting ||
              deletingAccount
            ) &&
              styles.disabledButton,
          ]}
          onPress={
            resetAppData
          }
          disabled={
            resetting ||
            saving ||
            deletingAccount
          }
        >
          {resetting ? (
            <ActivityIndicator
              color="#ff5a5a"
            />
          ) : (
            <>
              <Feather
                name="trash-2"
                size={20}
                color="#ff5a5a"
              />

              <Text
                style={
                  styles.resetText
                }
              >
                {t(
                  'settings.reset'
                )}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.deleteAccountButton,

            deletingAccount &&
              styles.disabledButton,
          ]}
          onPress={
            deleteAccount
          }
          disabled={
            deletingAccount ||
            resetting ||
            saving
          }
          activeOpacity={
            0.86
          }
          accessibilityRole="button"
          accessibilityLabel={
            language ===
              'Italian'
              ? 'Elimina account'
              : 'Delete Account'
          }
          accessibilityHint={
            language ===
              'Italian'
              ? 'Elimina definitivamente il tuo account Triple N e i dati associati.'
              : 'Permanently deletes your Triple N account and associated data.'
          }
        >
          {deletingAccount ? (
            <ActivityIndicator
              color="#ff5a5a"
            />
          ) : (
            <>
              <Feather
                name="user-x"
                size={20}
                color="#ff5a5a"
              />

              <View
                style={
                  styles.deleteAccountTextBox
                }
              >
                <Text
                  style={
                    styles.deleteAccountText
                  }
                >
                  {language ===
                    'Italian'
                    ? 'Elimina account'
                    : 'Delete Account'}
                </Text>

                <Text
                  style={
                    styles.deleteAccountSubtitle
                  }
                >
                  {language ===
                    'Italian'
                    ? 'Elimina definitivamente account e dati'
                    : 'Permanently delete account and data'}
                </Text>
              </View>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function SettingSwitch({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  icon:
    React.ComponentProps<
      typeof Feather
    >['name'];

  title: string;
  subtitle: string;
  value: boolean;

  onValueChange:
    (
      value: boolean
    ) => void;
}) {
  return (
    <View
      style={
        styles.settingItem
      }
    >
      <View
        style={
          styles.settingLeft
        }
      >
        <View
          style={
            styles.iconBox
          }
        >
          <Feather
            name={icon}
            size={20}
            color="#f1d8c2"
          />
        </View>

        <View
          style={
            styles.textBox
          }
        >
          <Text
            style={
              styles.settingTitle
            }
          >
            {title}
          </Text>

          <Text
            style={
              styles.settingSubtitle
            }
          >
            {subtitle}
          </Text>
        </View>
      </View>

      <Switch
        value={value}
        onValueChange={
          onValueChange
        }
        trackColor={{
          false: '#333740',
          true: '#f1d8c2',
        }}
        thumbColor={
          value
            ? '#111'
            : '#888'
        }
      />
    </View>
  );
}

function SettingToggle({
  icon,
  title,
  subtitle,
  value,
  left,
  right,
  onChange,
}: {
  icon:
    React.ComponentProps<
      typeof Feather
    >['name'];

  title: string;
  subtitle: string;
  value: string;
  left: string;
  right: string;

  onChange:
    (
      value: string
    ) => void;
}) {
  return (
    <View
      style={
        styles.settingItemColumn
      }
    >
      <View
        style={
          styles.settingLeft
        }
      >
        <View
          style={
            styles.iconBox
          }
        >
          <Feather
            name={icon}
            size={20}
            color="#f1d8c2"
          />
        </View>

        <View
          style={
            styles.textBox
          }
        >
          <Text
            style={
              styles.settingTitle
            }
          >
            {title}
          </Text>

          <Text
            style={
              styles.settingSubtitle
            }
          >
            {subtitle}
          </Text>
        </View>
      </View>

      <View
        style={
          styles.segment
        }
      >
        <TouchableOpacity
          style={[
            styles.segmentButton,

            value === left &&
              styles.segmentButtonActive,
          ]}
          onPress={() =>
            onChange(left)
          }
        >
          <Text
            style={[
              styles.segmentText,

              value === left &&
                styles.segmentTextActive,
            ]}
          >
            {left}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.segmentButton,

            value === right &&
              styles.segmentButtonActive,
          ]}
          onPress={() =>
            onChange(right)
          }
        >
          <Text
            style={[
              styles.segmentText,

              value === right &&
                styles.segmentTextActive,
            ]}
          >
            {right}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SettingRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
}: {
  icon:
    React.ComponentProps<
      typeof Feather
    >['name'];

  title: string;
  subtitle: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={
        styles.settingItem
      }
      onPress={
        onPress
      }
      activeOpacity={
        0.85
      }
    >
      <View
        style={
          styles.settingLeft
        }
      >
        <View
          style={
            styles.iconBox
          }
        >
          <Feather
            name={icon}
            size={20}
            color="#f1d8c2"
          />
        </View>

        <View
          style={
            styles.textBox
          }
        >
          <Text
            style={
              styles.settingTitle
            }
          >
            {title}
          </Text>

          <Text
            style={
              styles.settingSubtitle
            }
          >
            {subtitle}
          </Text>
        </View>
      </View>

      <View
        style={
          styles.settingRight
        }
      >
        <Text
          style={
            styles.valueText
          }
        >
          {value}
        </Text>

        <Feather
          name="chevron-right"
          size={22}
          color="#777"
        />
      </View>
    </TouchableOpacity>
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
      alignItems: 'center',
      justifyContent:
        'center',
    },

    loadingText: {
      color: '#aaa',
      fontSize: 14,
      fontWeight: '700',
      marginTop: 12,
    },

    content: {
      padding: 24,
      paddingTop: 62,
      paddingBottom: 45,
    },

    backIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor:
        '#17191d',
      alignItems: 'center',
      justifyContent:
        'center',
      marginBottom: 18,
    },

    title: {
      color: 'white',
      fontSize: 34,
      fontWeight: '900',
      marginBottom: 6,
    },

    subtitle: {
      color: '#8f9299',
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 24,
    },

    card: {
      backgroundColor:
        '#111318',
      borderRadius: 28,
      borderWidth: 1,
      borderColor:
        '#22252b',
      overflow: 'hidden',
    },

    settingItem: {
      minHeight: 78,
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor:
        '#22252b',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
    },

    settingItemColumn: {
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        '#22252b',
    },

    settingLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },

    textBox: {
      flex: 1,
    },

    iconBox: {
      width: 42,
      height: 42,
      borderRadius: 16,
      backgroundColor:
        '#1b1e24',
      alignItems: 'center',
      justifyContent:
        'center',
      marginRight: 14,
    },

    settingTitle: {
      color: 'white',
      fontSize: 16,
      fontWeight: '900',
    },

    settingSubtitle: {
      color: '#858995',
      fontSize: 12,
      fontWeight: '700',
      marginTop: 4,
    },

    settingRight: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
    },

    valueText: {
      color: '#f1d8c2',
      fontSize: 14,
      fontWeight: '900',
      marginRight: 6,
    },

    segment: {
      height: 44,
      backgroundColor:
        '#1b1e24',
      borderRadius: 16,
      flexDirection: 'row',
      padding: 4,
      marginTop: 16,
    },

    segmentButton: {
      flex: 1,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent:
        'center',
    },

    segmentButtonActive: {
      backgroundColor:
        '#f1d8c2',
    },

    segmentText: {
      color: '#888',
      fontSize: 15,
      fontWeight: '900',
    },

    segmentTextActive: {
      color: '#111',
    },

    problemReportCard: {
      minHeight: 94,
      marginTop: 22,
      paddingHorizontal: 18,
      paddingVertical: 16,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor:
        'rgba(241, 216, 194, 0.28)',
      borderRadius: 24,
      backgroundColor:
        '#15171c',
    },

    problemReportIcon: {
      width: 50,
      height: 50,
      alignItems: 'center',
      justifyContent:
        'center',
      borderRadius: 25,
      backgroundColor:
        '#f1d8c2',
    },

    problemReportTextBox: {
      flex: 1,
      marginLeft: 15,
      paddingRight: 10,
    },

    problemReportTitle: {
      color: '#ffffff',
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '900',
    },

    problemReportSubtitle: {
      marginTop: 5,
      color: '#8f9299',
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
    },

    problemReportArrow: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent:
        'center',
      borderWidth: 1,
      borderColor:
        '#30333a',
      borderRadius: 17,
      backgroundColor:
        '#1d2026',
    },

    saveButton: {
      height: 58,
      borderRadius: 22,
      backgroundColor:
        '#f1d8c2',
      alignItems: 'center',
      justifyContent:
        'center',
      flexDirection: 'row',
      marginTop: 22,
    },

    saveText: {
      color: '#111',
      fontSize: 17,
      fontWeight: '900',
      marginLeft: 10,
    },

    resetButton: {
      height: 58,
      borderRadius: 22,
      backgroundColor:
        '#17191d',
      borderWidth: 1,
      borderColor:
        '#2a2d35',
      alignItems: 'center',
      justifyContent:
        'center',
      flexDirection: 'row',
      marginTop: 14,
    },

    resetText: {
      color: '#ff5a5a',
      fontSize: 16,
      fontWeight: '900',
      marginLeft: 10,
    },

    deleteAccountButton: {
      minHeight: 68,
      borderRadius: 22,
      backgroundColor:
        'rgba(255,90,90,0.07)',
      borderWidth: 1,
      borderColor:
        'rgba(255,90,90,0.42)',
      alignItems: 'center',
      justifyContent:
        'center',
      flexDirection: 'row',
      paddingHorizontal: 18,
      marginTop: 14,
    },

    deleteAccountTextBox: {
      marginLeft: 12,
    },

    deleteAccountText: {
      color: '#ff5a5a',
      fontSize: 16,
      fontWeight: '900',
    },

    deleteAccountSubtitle: {
      color: '#9b7777',
      fontSize: 11,
      fontWeight: '700',
      marginTop: 3,
    },

    disabledButton: {
      opacity: 0.55,
    },

    premiumCard: {
      minHeight: 104,
      marginTop: 22,
      paddingHorizontal: 18,
      paddingVertical: 17,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor:
        'rgba(241,216,194,0.42)',
      borderRadius: 26,
      backgroundColor:
        '#15171c',
    },

    premiumIcon: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent:
        'center',
      borderRadius: 26,
      backgroundColor:
        '#f1d8c2',
    },

    premiumTextBox: {
      flex: 1,
      marginLeft: 15,
      paddingRight: 8,
    },

    premiumTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
    },

    premiumTitle: {
      color: '#ffffff',
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '900',
    },

    premiumComingSoon: {
      marginLeft: 8,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor:
        '#f1d8c2',
    },

    premiumComingSoonText: {
      color: '#111111',
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 0.7,
    },

    premiumSubtitle: {
      marginTop: 6,
      color: '#8f9299',
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
    },

    premiumArrow: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent:
        'center',
      borderWidth: 1,
      borderColor:
        '#30333a',
      borderRadius: 17,
      backgroundColor:
        '#1d2026',
    },
  });