import { useTranslation } from '@/lib/i18n';
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

type AuthMode =
  | 'login'
  | 'signup';

export default function LoginScreen() {
  const { t } =
    useTranslation();

  const [mode, setMode] =
    useState<AuthMode>(
      'login'
    );

  const [
    showForm,
    setShowForm,
  ] = useState(false);

  const [email, setEmail] =
    useState('');

  const [
    password,
    setPassword,
  ] = useState('');

  const [
    loading,
    setLoading,
  ] = useState(false);

  function openForm(
    type: AuthMode
  ) {
    if (loading) {
      return;
    }

    setMode(type);
    setShowForm(true);
  }

  function closeForm() {
    if (loading) {
      return;
    }

    Keyboard.dismiss();
    setShowForm(false);
  }

  async function submit() {
    if (loading) {
      return;
    }

    const cleanEmail =
      email
        .trim()
        .toLowerCase();

    const cleanPassword =
      password.trim();

    if (
      !cleanEmail ||
      !cleanPassword
    ) {
      Alert.alert(
        t('common.error'),
        t(
          'auth.writeCredentials'
        )
      );

      return;
    }

    Keyboard.dismiss();
    setLoading(true);

    try {
      if (
        mode === 'login'
      ) {
        const {
          error,
        } =
          await supabase.auth
            .signInWithPassword(
              {
                email:
                  cleanEmail,

                password:
                  cleanPassword,
              }
            );

        if (error) {
          Alert.alert(
            t(
              'auth.loginFailed'
            ),
            error.message
          );

          return;
        }

        router.replace(
          '/home' as any
        );

        return;
      }

      const {
        data,
        error,
      } =
        await supabase.auth
          .signUp({
            email:
              cleanEmail,

            password:
              cleanPassword,

            options: {
              emailRedirectTo:
                'triplen://login',
            },
          });

      if (error) {
        Alert.alert(
          t(
            'auth.signupFailed'
          ),
          error.message
        );

        return;
      }

      if (
        data.session
      ) {
        router.replace(
          '/home' as any
        );

        return;
      }

      Alert.alert(
        t(
          'common.success'
        ),
        t(
          'auth.accountCreated'
        )
      );

      setMode(
        'login'
      );

      setPassword('');
    } catch (
      error: any
    ) {
      Alert.alert(
        t('common.error'),
        error?.message ||
          t(
            'outfit.saveFailedMessage'
          )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <ImageBackground
      source={require(
        '../assets/images/triple-n-bg.jpeg'
      )}
      style={
        styles.bg
      }
      resizeMode="cover"
    >
      <TouchableWithoutFeedback
        onPress={
          Keyboard.dismiss
        }
      >
        <KeyboardAvoidingView
          style={
            styles.overlay
          }
          behavior={
            Platform.OS ===
            'ios'
              ? 'padding'
              : undefined
          }
        >
          <ScrollView
            contentContainerStyle={
              styles.scrollContent
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={
              false
            }
          >
            <View
              style={
                styles.logoBox
              }
            >
              <Text
                style={
                  styles.bigN
                }
              >
                N
              </Text>

              <Text
                style={
                  styles.logo
                }
              >
                TRIPLE N
              </Text>

             <Text style={styles.subtitle}>
  {t('auth.aiFashionAssistant')}
</Text>
            </View>

            <View
              style={
                styles.buttonsBox
              }
            >
              {!showForm ? (
                <>
                  <TouchableOpacity
                    style={
                      styles.signInBtn
                    }
                    onPress={() =>
                      openForm(
                        'login'
                      )
                    }
                    disabled={
                      loading
                    }
                    activeOpacity={
                      0.88
                    }
                  >
                    <Text
                      style={
                        styles.signInText
                      }
                    >
                      {t(
                        'auth.signIn'
                      )}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={
                      styles.createBtn
                    }
                    onPress={() =>
                      openForm(
                        'signup'
                      )
                    }
                    disabled={
                      loading
                    }
                    activeOpacity={
                      0.88
                    }
                  >
                    <Text
                      style={
                        styles.createText
                      }
                    >
                      {t(
                        'auth.signUp'
                      )}
                    </Text>
                  </TouchableOpacity>

                  <Text
                    style={
                      styles.footer
                    }
                  >
                    {t(
                      'auth.stylePoweredByAI'
                    )}
                  </Text>
                </>
              ) : (
                <>
                  <TextInput
                    style={
                      styles.input
                    }
                    placeholder={t(
                      'auth.email'
                    )}
                    placeholderTextColor="#888"
                    autoCapitalize="none"
                    autoCorrect={
                      false
                    }
                    keyboardType="email-address"
                    value={
                      email
                    }
                    onChangeText={
                      setEmail
                    }
                    editable={
                      !loading
                    }
                    returnKeyType="next"
                  />

                  <TextInput
                    style={
                      styles.input
                    }
                    placeholder={t(
                      'auth.password'
                    )}
                    placeholderTextColor="#888"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={
                      false
                    }
                    value={
                      password
                    }
                    onChangeText={
                      setPassword
                    }
                    editable={
                      !loading
                    }
                    returnKeyType="done"
                    onSubmitEditing={
                      submit
                    }
                  />

                  <TouchableOpacity
                    style={[
                      styles.submitBtn,

                      loading &&
                        styles.disabledButton,
                    ]}
                    onPress={
                      submit
                    }
                    disabled={
                      loading
                    }
                    activeOpacity={
                      0.88
                    }
                  >
                    {loading ? (
                      <ActivityIndicator
                        color="#111"
                      />
                    ) : (
                      <Text
                        style={
                          styles.submitText
                        }
                      >
                        {mode ===
                        'login'
                          ? t(
                              'auth.signIn'
                            )
                          : t(
                              'auth.signUp'
                            )}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={
                      closeForm
                    }
                    disabled={
                      loading
                    }
                  >
                    <Text
                      style={
                        styles.cancel
                      }
                    >
                      {t(
                        'common.back'
                      )}
                    </Text>
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

const styles =
  StyleSheet.create({
    bg: {
      flex: 1,
    },

    overlay: {
      flex: 1,
    },

    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 28,
      paddingTop: 120,
      paddingBottom: 45,
      justifyContent:
        'space-between',
    },

    logoBox: {
      alignItems: 'center',
    },

    bigN: {
      color: 'white',
      fontSize: 110,
      fontWeight: '900',
      textShadowColor:
        'rgba(255,255,255,0.5)',
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

    buttonsBox: {
      width: '100%',
    },

    signInBtn: {
      height: 66,
      borderRadius: 34,
      backgroundColor:
        '#f1d8c2',
      alignItems: 'center',
      justifyContent:
        'center',
      marginBottom: 18,
    },

    signInText: {
      color: '#111',
      fontSize: 20,
      fontWeight: '900',
    },

    createBtn: {
      height: 66,
      borderRadius: 34,
      borderWidth: 2,
      borderColor:
        '#f1d8c2',
      alignItems: 'center',
      justifyContent:
        'center',
    },

    createText: {
      color: '#f1d8c2',
      fontSize: 20,
      fontWeight: '900',
    },

    footer: {
      color: 'white',
      textAlign: 'center',
      marginTop: 34,
      fontSize: 17,
      fontWeight: '800',
    },

    input: {
      height: 55,
      backgroundColor:
        '#17191d',
      borderRadius: 16,
      borderWidth: 1,
      borderColor:
        '#252a31',
      color: 'white',
      paddingHorizontal: 16,
      marginBottom: 12,
      fontSize: 16,
    },

    submitBtn: {
      height: 56,
      backgroundColor:
        '#f1d8c2',
      borderRadius: 18,
      alignItems: 'center',
      justifyContent:
        'center',
      marginTop: 8,
    },

    submitText: {
      color: '#111',
      fontSize: 17,
      fontWeight: '900',
    },

    cancel: {
      color: '#aaa',
      textAlign: 'center',
      marginTop: 18,
      fontSize: 15,
      fontWeight: '700',
    },

    disabledButton: {
      opacity: 0.6,
    },
  });