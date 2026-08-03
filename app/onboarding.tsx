import { useTranslation } from '@/lib/i18n';
import { saveMyProfile } from '@/lib/profileService';

import { router } from 'expo-router';
import { useState } from 'react';

import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

export default function OnboardingScreen() {
  const { t } = useTranslation();

  const [firstName, setFirstName] =
    useState('');

  const [gender, setGender] =
    useState('');

  const [birthDate, setBirthDate] =
    useState('');

  const [loading, setLoading] =
    useState(false);

  async function continueApp() {
    if (!firstName.trim()) {
      Alert.alert(
        t('onboarding.missingTitle'),
        t('onboarding.enterFirstName')
      );

      return;
    }

    if (!gender) {
      Alert.alert(
        t('onboarding.missingTitle'),
        t('onboarding.chooseGender')
      );

      return;
    }

    if (!birthDate.trim()) {
      Alert.alert(
        t('onboarding.missingTitle'),
        t('onboarding.enterBirthDate')
      );

      return;
    }

    try {
      setLoading(true);

      const normalizedBirthDate =
        birthDate.includes('/')
          ? birthDate
              .split('/')
              .reverse()
              .join('-')
          : birthDate;

      await saveMyProfile({
        firstName:
          firstName.trim(),

        gender,

        birthDate:
          normalizedBirthDate,
      });

      router.replace(
        '/app/home' as any
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : t(
              'onboarding.genericError'
            );

      Alert.alert(
        t('common.error'),
        message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : undefined
      }
    >
      <ScrollView
        contentContainerStyle={
          styles.content
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={
          false
        }
      >
        <Text style={styles.logo}>
          TRIPLE N
        </Text>

        <Text style={styles.title}>
          {t('onboarding.welcome')}
        </Text>

        <Text style={styles.subtitle}>
          {t('onboarding.subtitle')}
        </Text>

        <Text style={styles.label}>
          {t('onboarding.firstName')}
        </Text>

        <TextInput
          style={styles.input}
          placeholder={t(
            'onboarding.firstNamePlaceholder'
          )}
          placeholderTextColor="#777"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          editable={!loading}
        />

        <Text style={styles.label}>
          {t('onboarding.gender')}
        </Text>

        <View style={styles.genderRow}>
          <TouchableOpacity
            style={[
              styles.genderButton,

              gender === 'Male' &&
                styles.genderActive,
            ]}
            onPress={() =>
              setGender('Male')
            }
            activeOpacity={0.85}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{
              selected:
                gender === 'Male',
            }}
            accessibilityLabel={t(
              'onboarding.male'
            )}
          >
            <Text
              style={[
                styles.genderText,

                gender === 'Male' &&
                  styles.genderTextActive,
              ]}
            >
              👨 {t('onboarding.male')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.genderButton,

              gender === 'Female' &&
                styles.genderActive,
            ]}
            onPress={() =>
              setGender('Female')
            }
            activeOpacity={0.85}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{
              selected:
                gender === 'Female',
            }}
            accessibilityLabel={t(
              'onboarding.female'
            )}
          >
            <Text
              style={[
                styles.genderText,

                gender === 'Female' &&
                  styles.genderTextActive,
              ]}
            >
              👩 {t('onboarding.female')}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>
          {t('onboarding.birthDate')}
        </Text>

        <TextInput
          style={styles.input}
          placeholder={t(
            'onboarding.birthDatePlaceholder'
          )}
          placeholderTextColor="#777"
          value={birthDate}
          onChangeText={setBirthDate}
          keyboardType={
            Platform.OS === 'ios'
              ? 'numbers-and-punctuation'
              : 'numeric'
          }
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          editable={!loading}
          onSubmitEditing={
            continueApp
          }
        />

        <TouchableOpacity
          style={[
            styles.button,

            loading &&
              styles.buttonDisabled,
          ]}
          disabled={loading}
          onPress={continueApp}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t(
            'onboarding.continue'
          )}
        >
          <Text style={styles.buttonText}>
            {loading
              ? t('onboarding.saving')
              : t(
                  'onboarding.continue'
                )}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
  },

  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },

  logo: {
    color: '#f1d8c2',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 2,
  },

  title: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '900',
    textAlign: 'center',
  },

  subtitle: {
    color: '#999',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 35,
    lineHeight: 22,
  },

  label: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
    marginTop: 16,
  },

  input: {
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#2b3038',
    borderRadius: 18,
    height: 56,
    paddingHorizontal: 18,
    color: '#fff',
    fontSize: 16,
  },

  genderRow: {
    flexDirection: 'row',
    justifyContent:
      'space-between',
    gap: 12,
  },

  genderButton: {
    flex: 1,
    height: 56,
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#2b3038',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },

  genderActive: {
    backgroundColor: '#f1d8c2',
    borderColor: '#f1d8c2',
  },

  genderText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },

  genderTextActive: {
    color: '#111',
  },

  button: {
    marginTop: 40,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#f1d8c2',
    justifyContent: 'center',
    alignItems: 'center',
  },

  buttonDisabled: {
    opacity: 0.65,
  },

  buttonText: {
    color: '#111',
    fontSize: 17,
    fontWeight: '900',
  },
});