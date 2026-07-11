import {
  getMyProfile,
  saveMyProfile,
} from '@/lib/profileService';
import { supabase } from '@/lib/supabase';

import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function AccountScreen() {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAccount();
  }, []);

  async function loadAccount() {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;

    if (!user) {
      router.replace('/login' as any);
      return;
    }

    setEmail(user.email ?? '');

    const profile = await getMyProfile();

    if (profile) {
      setFirstName(profile.first_name ?? '');
      setGender(profile.gender ?? '');
      setBirthDate(profile.birth_date ?? '');
    }
  }

  async function saveAccount() {
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

    Alert.alert('Saved', 'Your profile has been updated.');
  } catch (e: any) {
    Alert.alert('Error', e.message ?? 'Something went wrong.');
  } finally {
    setLoading(false);
  }
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

        <Text style={styles.title}>
          Account
        </Text>

        <Text style={styles.subtitle}>
          Manage your personal information
        </Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {firstName
                ? firstName.charAt(0).toUpperCase()
                : 'N'}
            </Text>
          </View>

          <Text style={styles.profileName}>
            {firstName || 'Your Name'}
          </Text>

          <Text style={styles.profileRole}>
            Triple N Member
          </Text>
        </View>

        <View style={styles.formCard}>

          <Input
            icon="user"
            label="First Name"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Ahmed"
          />

          <Input
            icon="mail"
            label="Email"
            value={email}
            editable={false}
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

          <Input
            icon="calendar"
            label="Birth Date"
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="2003-07-14"
          />

        </View>

        <TouchableOpacity
          style={styles.saveButton}
          disabled={loading}
          onPress={saveAccount}
        >
          <Feather
            name="check"
            size={21}
            color="#111"
          />

          <Text style={styles.saveText}>
            {loading
              ? 'Saving...'
              : 'Save Changes'}
          </Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}

function Input({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
}: {
  icon: any;
  label: string;
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  return (
    <View style={styles.inputBox}>
      <Text style={styles.label}>
        {label}
      </Text>

      <View style={styles.inputRow}>
        <Feather
          name={icon}
          size={20}
          color="#f1d8c2"
        />

        <TextInput
          style={styles.input}
          value={value}
          editable={editable}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#666"
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
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
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },

  title: {
    color: '#fff',
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

  profileCard: {
    backgroundColor: '#14161b',
    borderRadius: 28,
    paddingVertical: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#24272e',
    marginBottom: 22,
  },

  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#f1d8c2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },

  avatarText: {
    color: '#111',
    fontSize: 42,
    fontWeight: '900',
  },

  profileName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },

  profileRole: {
    color: '#9b9fa8',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },

  formCard: {
    backgroundColor: '#111318',
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: '#22252b',
  },

  inputBox: {
    marginBottom: 18,
  },

  label: {
    color: '#a9adb6',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 9,
    marginLeft: 4,
  },

  inputRow: {
    height: 56,
    backgroundColor: '#1a1d23',
    borderRadius: 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },

  input: {
    flex: 1,
    marginLeft: 12,
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  genderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },

  genderButton: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#1a1d23',
    borderWidth: 1,
    borderColor: '#2b3038',
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

  saveButton: {
    height: 58,
    borderRadius: 22,
    backgroundColor: '#f1d8c2',
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },

  saveText: {
    color: '#111',
    fontSize: 17,
    fontWeight: '900',
    marginLeft: 10,
  },
});