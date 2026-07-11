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

import { saveMyProfile } from '@/lib/profileService';

export default function OnboardingScreen() {
  const [firstName, setFirstName] = useState('');
  const [gender, setGender] = useState('');
  const [birthDate, setBirthDate] = useState('');

  const [loading, setLoading] = useState(false);

  async function continueApp() {
    if (!firstName.trim()) {
      Alert.alert('Missing', 'Please enter your first name.');
      return;
    }

    if (!gender) {
      Alert.alert('Missing', 'Please choose your gender.');
      return;
    }

    if (!birthDate) {
      Alert.alert('Missing', 'Please enter your birth date.');
      return;
    }

    try {
      setLoading(true);

      const normalizedBirthDate =
  birthDate.includes('/')
    ? birthDate.split('/').reverse().join('-')
    : birthDate;

      await saveMyProfile({
  firstName,
  gender,
  birthDate: normalizedBirthDate,
});

      router.replace('/app/home' as any);
    } catch (e: any) {
      Alert.alert(
        'Error',
        e.message ?? 'Something went wrong.'
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
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.logo}>
          Triple N
        </Text>

        <Text style={styles.title}>
          Welcome 👋
        </Text>

        <Text style={styles.subtitle}>
          Before we start, tell us a little about you.
        </Text>

        <Text style={styles.label}>
          First Name
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Ahmed"
          placeholderTextColor="#777"
          value={firstName}
          onChangeText={setFirstName}
        />

        <Text style={styles.label}>
          Gender
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
          >
            <Text
              style={[
                styles.genderText,
                gender === 'Male' &&
                  styles.genderTextActive,
              ]}
            >
              👨 Male
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
          >
            <Text
              style={[
                styles.genderText,
                gender === 'Female' &&
                  styles.genderTextActive,
              ]}
            >
              👩 Female
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>
          Date of Birth
        </Text>

        <TextInput
          style={styles.input}
          placeholder="2003-07-14"
          placeholderTextColor="#777"
          value={birthDate}
          onChangeText={setBirthDate}
        />

        <TouchableOpacity
          style={styles.button}
          disabled={loading}
          onPress={continueApp}
        >
          <Text style={styles.buttonText}>
            {loading
              ? 'Saving...'
              : 'Continue'}
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
    justifyContent: 'space-between',
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

  buttonText: {
    color: '#111',
    fontSize: 17,
    fontWeight: '900',
  },
});