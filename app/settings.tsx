import { supabase } from '@/lib/supabase';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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

const SETTINGS_KEY = 'TRIPLE_N_SETTINGS';
const WARDROBE_BUCKET = 'wardrobe';

type TemperatureUnit = '°C' | '°F';
type Occasion = 'Casual' | 'Work' | 'Date' | 'Party' | 'Sport';
type StylePreference =
  | 'Minimal'
  | 'Classic'
  | 'Streetwear'
  | 'Sport'
  | 'Luxury';
type Language = 'English' | 'Arabic';

type AppSettings = {
  notifications: boolean;
  temperature: TemperatureUnit;
  occasion: Occasion;
  language: Language;
  stylePreference: StylePreference;
};

const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  temperature: '°C',
  occasion: 'Casual',
  language: 'English',
  stylePreference: 'Minimal',
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [temperature, setTemperature] =
    useState<TemperatureUnit>('°C');
  const [occasion, setOccasion] = useState<Occasion>('Casual');
  const [language, setLanguage] = useState<Language>('English');
  const [stylePreference, setStylePreference] =
    useState<StylePreference>('Minimal');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  function applySettings(settings: AppSettings) {
    setNotifications(settings.notifications);
    setTemperature(settings.temperature);
    setOccasion(settings.occasion);
    setLanguage(settings.language);
    setStylePreference(settings.stylePreference);
  }

  function getCurrentSettings(): AppSettings {
    return {
      notifications,
      temperature,
      occasion,
      language,
      stylePreference,
    };
  }

  async function loadSettings() {
    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        throw error;
      }

      const user = data.session?.user;

      if (!user) {
        router.replace('/login' as any);
        return;
      }

      const localValue = await AsyncStorage.getItem(SETTINGS_KEY);

      if (localValue) {
        const localSettings = JSON.parse(localValue) as Partial<AppSettings>;

        applySettings({
          ...DEFAULT_SETTINGS,
          ...localSettings,
        });
      }

      const meta = user.user_metadata || {};

      const cloudSettings: AppSettings = {
        notifications:
          typeof meta.notifications === 'boolean'
            ? meta.notifications
            : DEFAULT_SETTINGS.notifications,

        temperature:
          meta.temperature === '°F' ? '°F' : '°C',

        occasion:
          ['Casual', 'Work', 'Date', 'Party', 'Sport'].includes(
            meta.occasion
          )
            ? meta.occasion
            : DEFAULT_SETTINGS.occasion,

        language:
          meta.language === 'Arabic' ? 'Arabic' : 'English',

        stylePreference: [
          'Minimal',
          'Classic',
          'Streetwear',
          'Sport',
          'Luxury',
        ].includes(meta.stylePreference)
          ? meta.stylePreference
          : DEFAULT_SETTINGS.stylePreference,
      };

      applySettings(cloudSettings);

      await AsyncStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(cloudSettings)
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message || 'Could not load settings.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function enableDailyNotification() {
    const permission = await Notifications.requestPermissionsAsync();

    if (!permission.granted) {
      throw new Error(
        'Notification permission was not granted. Enable it from your phone settings.'
      );
    }

    await Notifications.cancelAllScheduledNotificationsAsync();

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Triple N Outfit Reminder 👕',
        body: 'Your outfit of the day is ready.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 8,
        minute: 0,
      },
    });
  }

  async function disableNotifications() {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async function saveSettings() {
    if (saving) return;

    setSaving(true);

    try {
      const settings = getCurrentSettings();

      if (settings.notifications) {
        await enableDailyNotification();
      } else {
        await disableNotifications();
      }

      await AsyncStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(settings)
      );

      const { error } = await supabase.auth.updateUser({
        data: settings,
      });

      if (error) {
        throw error;
      }

      Alert.alert('Saved', 'Settings updated successfully.');
    } catch (error: any) {
      Alert.alert(
        'Error',
        error?.message || 'Could not save settings.'
      );
    } finally {
      setSaving(false);
    }
  }

  function chooseOccasion() {
    Alert.alert(
      'Default Occasion',
      'Choose your default outfit style',
      [
        {
          text: 'Casual',
          onPress: () => setOccasion('Casual'),
        },
        {
          text: 'Work',
          onPress: () => setOccasion('Work'),
        },
        {
          text: 'Date',
          onPress: () => setOccasion('Date'),
        },
        {
          text: 'Party',
          onPress: () => setOccasion('Party'),
        },
        {
          text: 'Sport',
          onPress: () => setOccasion('Sport'),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  }

  function chooseStylePreference() {
    Alert.alert(
      'Style Preference',
      'Choose your favorite fashion style',
      [
        {
          text: 'Minimal',
          onPress: () => setStylePreference('Minimal'),
        },
        {
          text: 'Classic',
          onPress: () => setStylePreference('Classic'),
        },
        {
          text: 'Streetwear',
          onPress: () => setStylePreference('Streetwear'),
        },
        {
          text: 'Sport',
          onPress: () => setStylePreference('Sport'),
        },
        {
          text: 'Luxury',
          onPress: () => setStylePreference('Luxury'),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  }

  function chooseLanguage() {
    Alert.alert('Language', 'Choose app language', [
      {
        text: 'English',
        onPress: () => setLanguage('English'),
      },
      {
        text: 'العربية',
        onPress: () => setLanguage('Arabic'),
      },
      {
        text: 'Cancel',
        style: 'cancel',
      },
    ]);
  }

  function extractStoragePath(imageUrl?: string | null) {
    if (!imageUrl) return null;

    const marker = `/storage/v1/object/public/${WARDROBE_BUCKET}/`;
    const markerIndex = imageUrl.indexOf(marker);

    if (markerIndex === -1) {
      return null;
    }

    const path = imageUrl.slice(markerIndex + marker.length);

    return decodeURIComponent(path.split('?')[0]);
  }

  async function performReset() {
    if (resetting) return;

    setResetting(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace('/login' as any);
        return;
      }

      const { data: wardrobeItems, error: wardrobeReadError } =
        await supabase
          .from('wardrobe_items')
          .select('image')
          .eq('user_id', user.id);

      if (wardrobeReadError) {
        throw wardrobeReadError;
      }

      const storagePaths = (wardrobeItems || [])
        .map((item) => extractStoragePath(item.image))
        .filter((path): path is string => Boolean(path));

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(WARDROBE_BUCKET)
          .remove(storagePaths);

        if (storageError) {
          throw storageError;
        }
      }

      const { error: outfitsError } = await supabase
        .from('saved_outfits')
        .delete()
        .eq('user_id', user.id);

      if (outfitsError) {
        throw outfitsError;
      }

      const { error: wardrobeError } = await supabase
        .from('wardrobe_items')
        .delete()
        .eq('user_id', user.id);

      if (wardrobeError) {
        throw wardrobeError;
      }

      await Notifications.cancelAllScheduledNotificationsAsync();
      await AsyncStorage.clear();

      const { error: metadataError } =
        await supabase.auth.updateUser({
          data: {
            ...DEFAULT_SETTINGS,
            wardrobeType: null,
          },
        });

      if (metadataError) {
        throw metadataError;
      }

      await supabase.auth.signOut();

      router.replace('/login' as any);
    } catch (error: any) {
      Alert.alert(
        'Reset failed',
        error?.message || 'Could not reset app data.'
      );

      setResetting(false);
    }
  }

  function resetAppData() {
    Alert.alert(
      'Reset App Data',
      'This permanently deletes your wardrobe, cleaned images, saved outfits and local settings. This cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: performReset,
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#f1d8c2" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.content}>
        <TouchableOpacity
          style={styles.backIcon}
          onPress={() => router.back()}
        >
          <Feather
            name="chevron-left"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <Text style={styles.title}>Settings</Text>

        <Text style={styles.subtitle}>
          Customize your Triple N experience
        </Text>

        <View style={styles.card}>
          <SettingSwitch
            icon="bell"
            title="Notifications"
            subtitle="Daily outfit reminder at 8:00 AM"
            value={notifications}
            onValueChange={setNotifications}
          />

          <SettingToggle
            icon="thermometer"
            title="Temperature"
            subtitle="Weather outfit unit"
            value={temperature}
            left="°C"
            right="°F"
            onChange={(value) =>
              setTemperature(value as TemperatureUnit)
            }
          />

          <SettingRow
            icon="briefcase"
            title="Default Occasion"
            subtitle="Your usual outfit style"
            value={occasion}
            onPress={chooseOccasion}
          />

          <SettingRow
            icon="star"
            title="Style Preference"
            subtitle="Your favorite fashion style"
            value={stylePreference}
            onPress={chooseStylePreference}
          />

          <SettingRow
            icon="globe"
            title="Language"
            subtitle="App display language"
            value={language}
            onPress={chooseLanguage}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.saveButton,
            saving && styles.disabledButton,
          ]}
          onPress={saveSettings}
          disabled={saving || resetting}
        >
          {saving ? (
            <ActivityIndicator color="#111" />
          ) : (
            <>
              <Feather name="check" size={21} color="#111" />
              <Text style={styles.saveText}>Save Settings</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.resetButton,
            resetting && styles.disabledButton,
          ]}
          onPress={resetAppData}
          disabled={resetting || saving}
        >
          {resetting ? (
            <ActivityIndicator color="#ff5a5a" />
          ) : (
            <>
              <Feather
                name="trash-2"
                size={20}
                color="#ff5a5a"
              />
              <Text style={styles.resetText}>
                Reset App Data
              </Text>
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
  icon: any;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingItem}>
      <View style={styles.settingLeft}>
        <View style={styles.iconBox}>
          <Feather name={icon} size={20} color="#f1d8c2" />
        </View>

        <View style={styles.textBox}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
      </View>

      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: '#333740',
          true: '#f1d8c2',
        }}
        thumbColor={value ? '#111' : '#888'}
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
  icon: any;
  title: string;
  subtitle: string;
  value: string;
  left: string;
  right: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.settingItemColumn}>
      <View style={styles.settingLeft}>
        <View style={styles.iconBox}>
          <Feather name={icon} size={20} color="#f1d8c2" />
        </View>

        <View style={styles.textBox}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.segment}>
        <TouchableOpacity
          style={[
            styles.segmentButton,
            value === left && styles.segmentButtonActive,
          ]}
          onPress={() => onChange(left)}
        >
          <Text
            style={[
              styles.segmentText,
              value === left && styles.segmentTextActive,
            ]}
          >
            {left}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.segmentButton,
            value === right && styles.segmentButtonActive,
          ]}
          onPress={() => onChange(right)}
        >
          <Text
            style={[
              styles.segmentText,
              value === right && styles.segmentTextActive,
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
  icon: any;
  title: string;
  subtitle: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
    >
      <View style={styles.settingLeft}>
        <View style={styles.iconBox}>
          <Feather name={icon} size={20} color="#f1d8c2" />
        </View>

        <View style={styles.textBox}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.settingRight}>
        <Text style={styles.valueText}>{value}</Text>
        <Feather
          name="chevron-right"
          size={22}
          color="#777"
        />
      </View>
    </TouchableOpacity>
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
    backgroundColor: '#17191d',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: '#111318',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#22252b',
    overflow: 'hidden',
  },

  settingItem: {
    minHeight: 78,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#22252b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  settingItemColumn: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#22252b',
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
    backgroundColor: '#1b1e24',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: '#1b1e24',
    borderRadius: 16,
    flexDirection: 'row',
    padding: 4,
    marginTop: 16,
  },

  segmentButton: {
    flex: 1,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  segmentButtonActive: {
    backgroundColor: '#f1d8c2',
  },

  segmentText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '900',
  },

  segmentTextActive: {
    color: '#111',
  },

  saveButton: {
    height: 58,
    borderRadius: 22,
    backgroundColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#2a2d35',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 14,
  },

  resetText: {
    color: '#ff5a5a',
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 10,
  },

  disabledButton: {
    opacity: 0.55,
  },
});