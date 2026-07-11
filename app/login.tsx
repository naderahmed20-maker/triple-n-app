import { supabase } from '@/lib/supabase';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

export default function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const openForm = (type: 'login' | 'signup') => {
    setMode(type);
    setShowForm(true);
  };

  const submit = async () => {
    if (loading) return;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      Alert.alert('Error', 'Write email and password');
      return;
    }

    Keyboard.dismiss();
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (error) {
          Alert.alert('Login failed', error.message);
          return;
        }

        router.replace('/home' as any);
      } else {
        const { error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (error) {
          Alert.alert('Signup failed', error.message);
          return;
        }

        Alert.alert('Success', 'Account created. Now login.');
        setMode('login');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ImageBackground
      source={require('../assets/images/triple-n-bg.jpeg')}
      style={styles.bg}
      resizeMode="cover"
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.logoBox}>
              <Text style={styles.bigN}>N</Text>
              <Text style={styles.logo}>TRIPLE N</Text>
              <Text style={styles.subtitle}>AI FASHION ASSISTANT</Text>
            </View>

            <View style={styles.buttonsBox}>
              {!showForm ? (
                <>
                  <TouchableOpacity
                    style={styles.signInBtn}
                    onPress={() => openForm('login')}
                  >
                    <Text style={styles.signInText}>Sign In</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.createBtn}
                    onPress={() => openForm('signup')}
                  >
                    <Text style={styles.createText}>Create Account</Text>
                  </TouchableOpacity>

                  <Text style={styles.footer}>Your style, powered by AI</Text>
                </>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor="#888"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    returnKeyType="next"
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#888"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    returnKeyType="done"
                    onSubmitEditing={submit}
                  />

                  <TouchableOpacity
                    style={styles.submitBtn}
                    onPress={submit}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#111" />
                    ) : (
                      <Text style={styles.submitText}>
                        {mode === 'login' ? 'Sign In' : 'Create Account'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setShowForm(false)}>
                    <Text style={styles.cancel}>Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 120,
    paddingBottom: 45,
    justifyContent: 'space-between',
  },
  logoBox: { alignItems: 'center' },
  bigN: {
    color: 'white',
    fontSize: 110,
    fontWeight: '900',
    textShadowColor: 'rgba(255,255,255,0.5)',
    textShadowRadius: 18,
  },
  logo: {
    color: 'white',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 11,
    marginTop: 8,
  },
  subtitle: {
    color: '#f1d8c2',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 4,
    marginTop: 14,
  },
  buttonsBox: { width: '100%' },
  signInBtn: {
    height: 66,
    borderRadius: 34,
    backgroundColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  signInText: { color: '#111', fontSize: 20, fontWeight: '900' },
  createBtn: {
    height: 66,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { color: '#f1d8c2', fontSize: 20, fontWeight: '900' },
  footer: {
    color: 'white',
    textAlign: 'center',
    marginTop: 34,
    fontSize: 17,
    fontWeight: '800',
  },
  input: {
    height: 55,
    backgroundColor: '#17191d',
    borderRadius: 16,
    color: 'white',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  submitBtn: {
    height: 56,
    backgroundColor: '#f1d8c2',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitText: { color: '#111', fontSize: 17, fontWeight: '900' },
  cancel: {
    color: '#aaa',
    textAlign: 'center',
    marginTop: 18,
    fontSize: 15,
    fontWeight: '700',
  },
});