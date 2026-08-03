import {
  getMyProfile,
  saveMyProfile,
} from '@/lib/profileService';

import {
  useTranslation,
} from '@/lib/i18n';

import {
  supabase,
} from '@/lib/supabase';

import {
  Feather,
} from '@expo/vector-icons';

import {
  router,
} from 'expo-router';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type AccountInputProps = {
  icon:
    React.ComponentProps<
      typeof Feather
    >['name'];

  label: string;
  value: string;

  onChangeText?: (
    text: string
  ) => void;

  placeholder?: string;
  editable?: boolean;
};

export default function AccountScreen() {
  const {
    t,
  } = useTranslation();

  const [
    firstName,
    setFirstName,
  ] = useState('');

  const [
    email,
    setEmail,
  ] = useState('');

  const [
    gender,
    setGender,
  ] = useState('');

  const [
    birthDate,
    setBirthDate,
  ] = useState('');

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    loadingAccount,
    setLoadingAccount,
  ] = useState(true);

  const loadAccount =
    useCallback(
      async () => {
        try {
          setLoadingAccount(
            true
          );

          const {
            data,
            error:
              sessionError,
          } =
            await supabase.auth
              .getSession();

          if (
            sessionError
          ) {
            throw sessionError;
          }

          const user =
            data.session?.user;

          if (!user) {
            router.replace(
              '/login' as any
            );

            return;
          }

          setEmail(
            user.email ?? ''
          );

          const profile =
            await getMyProfile();

          if (profile) {
            setFirstName(
              profile.first_name ??
                ''
            );

            setGender(
              profile.gender ??
                ''
            );

            setBirthDate(
              profile.birth_date ??
                ''
            );
          }
        } catch (
          error: any
        ) {
          Alert.alert(
            t(
              'common.error'
            ),
            error?.message ||
              t(
                'account.loadFailed'
              )
          );
        } finally {
          setLoadingAccount(
            false
          );
        }
      },
      [t]
    );

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  async function saveAccount() {
    if (
      loading ||
      loadingAccount
    ) {
      return;
    }

    if (
      !firstName.trim()
    ) {
      Alert.alert(
        t(
          'account.missingTitle'
        ),
        t(
          'account.firstNameRequired'
        )
      );

      return;
    }

    if (!gender) {
      Alert.alert(
        t(
          'account.missingTitle'
        ),
        t(
          'account.genderRequired'
        )
      );

      return;
    }

    if (!birthDate.trim()) {
      Alert.alert(
        t(
          'account.missingTitle'
        ),
        t(
          'account.birthDateRequired'
        )
      );

      return;
    }

    try {
      setLoading(true);

      const cleanedBirthDate =
        birthDate
          .trim()
          .replace(/\./g, '/')
          .replace(/-/g, '/');

      const dateParts =
        cleanedBirthDate
          .split('/')
          .filter(Boolean);

      let normalizedBirthDate =
        birthDate.trim();

      if (
        dateParts.length ===
        3
      ) {
        const [
          first,
          second,
          third,
        ] = dateParts;

        if (
          first.length === 4
        ) {
          normalizedBirthDate =
            `${first}-${second.padStart(
              2,
              '0'
            )}-${third.padStart(
              2,
              '0'
            )}`;
        } else {
          normalizedBirthDate =
            `${third}-${second.padStart(
              2,
              '0'
            )}-${first.padStart(
              2,
              '0'
            )}`;
        }
      }

      const validDatePattern =
        /^\d{4}-\d{2}-\d{2}$/;

      if (
        !validDatePattern.test(
          normalizedBirthDate
        )
      ) {
        Alert.alert(
          t(
            'account.invalidBirthDateTitle'
          ),
          t(
            'account.invalidBirthDateMessage'
          )
        );

        return;
      }

      const parsedDate =
        new Date(
          `${normalizedBirthDate}T00:00:00`
        );

      if (
        Number.isNaN(
          parsedDate.getTime()
        )
      ) {
        Alert.alert(
          t(
            'account.invalidBirthDateTitle'
          ),
          t(
            'account.invalidBirthDateMessage'
          )
        );

        return;
      }

      await saveMyProfile({
        firstName:
          firstName.trim(),

        gender,

        birthDate:
          normalizedBirthDate,
      });

      setFirstName(
        firstName.trim()
      );

      setBirthDate(
        normalizedBirthDate
      );

      Alert.alert(
        t(
          'account.savedTitle'
        ),
        t(
          'account.savedMessage'
        )
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
            'account.saveFailed'
          )
      );
    } finally {
      setLoading(false);
    }
  }

  const avatarLetter =
    firstName
      .trim()
      .charAt(0)
      .toUpperCase() ||
    'N';

  const profileName =
    firstName.trim() ||
    t(
      'account.yourName'
    );

  return (
    <ScrollView
      style={
        styles.container
      }
      showsVerticalScrollIndicator={
        false
      }
      keyboardShouldPersistTaps="handled"
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
          disabled={
            loading
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
            'account.title'
          )}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          {t(
            'account.subtitle'
          )}
        </Text>

        {loadingAccount ? (
          <View
            style={
              styles.loadingCard
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
                'account.loading'
              )}
            </Text>
          </View>
        ) : (
          <>
            <View
              style={
                styles.profileCard
              }
            >
              <View
                style={
                  styles.avatar
                }
              >
                <Text
                  style={
                    styles.avatarText
                  }
                >
                  {
                    avatarLetter
                  }
                </Text>
              </View>

              <Text
                style={
                  styles.profileName
                }
              >
                {
                  profileName
                }
              </Text>

              <Text
                style={
                  styles.profileRole
                }
              >
                {t(
                  'account.member'
                )}
              </Text>
            </View>

            <View
              style={
                styles.formCard
              }
            >
              <AccountInput
                icon="user"
                label={t(
                  'account.firstName'
                )}
                value={
                  firstName
                }
                onChangeText={
                  setFirstName
                }
                placeholder={t(
                  'account.firstNamePlaceholder'
                )}
                editable={
                  !loading
                }
              />

              <AccountInput
                icon="mail"
                label={t(
                  'account.email'
                )}
                value={email}
                editable={
                  false
                }
              />

              <Text
                style={
                  styles.label
                }
              >
                {t(
                  'account.gender'
                )}
              </Text>

              <View
                style={
                  styles.genderRow
                }
              >
                <TouchableOpacity
                  style={[
                    styles.genderButton,

                    gender ===
                      'Male' &&
                      styles.genderActive,
                  ]}
                  onPress={() =>
                    setGender(
                      'Male'
                    )
                  }
                  disabled={
                    loading
                  }
                >
                  <Text
                    style={[
                      styles.genderText,

                      gender ===
                        'Male' &&
                        styles.genderTextActive,
                    ]}
                  >
                    👨{' '}
                    {t(
                      'account.male'
                    )}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.genderButton,

                    gender ===
                      'Female' &&
                      styles.genderActive,
                  ]}
                  onPress={() =>
                    setGender(
                      'Female'
                    )
                  }
                  disabled={
                    loading
                  }
                >
                  <Text
                    style={[
                      styles.genderText,

                      gender ===
                        'Female' &&
                        styles.genderTextActive,
                    ]}
                  >
                    👩{' '}
                    {t(
                      'account.female'
                    )}
                  </Text>
                </TouchableOpacity>
              </View>

              <AccountInput
                icon="calendar"
                label={t(
                  'account.birthDate'
                )}
                value={
                  birthDate
                }
                onChangeText={
                  setBirthDate
                }
                placeholder={t(
                  'account.birthDatePlaceholder'
                )}
                editable={
                  !loading
                }
              />
            </View>

            <TouchableOpacity
              style={[
                styles.saveButton,

                loading &&
                  styles.disabledButton,
              ]}
              disabled={
                loading
              }
              onPress={
                saveAccount
              }
            >
              {loading ? (
                <ActivityIndicator
                  size="small"
                  color="#111"
                />
              ) : (
                <Feather
                  name="check"
                  size={21}
                  color="#111"
                />
              )}

              <Text
                style={
                  styles.saveText
                }
              >
                {loading
                  ? t(
                      'account.saving'
                    )
                  : t(
                      'account.saveChanges'
                    )}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function AccountInput({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
}: AccountInputProps) {
  return (
    <View
      style={
        styles.inputBox
      }
    >
      <Text
        style={
          styles.label
        }
      >
        {label}
      </Text>

      <View
        style={[
          styles.inputRow,

          !editable &&
            styles.disabledInputRow,
        ]}
      >
        <Feather
          name={icon}
          size={20}
          color="#f1d8c2"
        />

        <TextInput
          style={[
            styles.input,

            !editable &&
              styles.disabledInput,
          ]}
          value={value}
          editable={editable}
          onChangeText={
            onChangeText
          }
          placeholder={
            placeholder
          }
          placeholderTextColor="#666"
          autoCapitalize={
            icon === 'mail'
              ? 'none'
              : 'sentences'
          }
          keyboardType={
            icon === 'mail'
              ? 'email-address'
              : 'default'
          }
        />
      </View>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#07090d',
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
      justifyContent:
        'center',
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

    loadingCard: {
      minHeight: 260,
      backgroundColor:
        '#14161b',
      borderRadius: 28,
      borderWidth: 1,
      borderColor:
        '#24272e',
      alignItems: 'center',
      justifyContent:
        'center',
      padding: 24,
    },

    loadingText: {
      color: '#a9adb6',
      fontSize: 15,
      fontWeight: '800',
      marginTop: 14,
      textAlign: 'center',
    },

    profileCard: {
      backgroundColor:
        '#14161b',
      borderRadius: 28,
      paddingVertical: 28,
      alignItems: 'center',
      borderWidth: 1,
      borderColor:
        '#24272e',
      marginBottom: 22,
    },

    avatar: {
      width: 104,
      height: 104,
      borderRadius: 52,
      backgroundColor:
        '#f1d8c2',
      justifyContent:
        'center',
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
      textAlign: 'center',
      paddingHorizontal: 18,
    },

    profileRole: {
      color: '#9b9fa8',
      fontSize: 14,
      fontWeight: '700',
      marginTop: 4,
    },

    formCard: {
      backgroundColor:
        '#111318',
      borderRadius: 26,
      padding: 18,
      borderWidth: 1,
      borderColor:
        '#22252b',
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
      backgroundColor:
        '#1a1d23',
      borderRadius: 18,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
    },

    disabledInputRow: {
      opacity: 0.72,
    },

    input: {
      flex: 1,
      marginLeft: 12,
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },

    disabledInput: {
      color: '#a9adb6',
    },

    genderRow: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      gap: 12,
      marginBottom: 18,
    },

    genderButton: {
      flex: 1,
      height: 56,
      borderRadius: 18,
      backgroundColor:
        '#1a1d23',
      borderWidth: 1,
      borderColor:
        '#2b3038',
      justifyContent:
        'center',
      alignItems: 'center',
    },

    genderActive: {
      backgroundColor:
        '#f1d8c2',
      borderColor:
        '#f1d8c2',
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
      backgroundColor:
        '#f1d8c2',
      marginTop: 24,
      flexDirection: 'row',
      justifyContent:
        'center',
      alignItems: 'center',
    },

    disabledButton: {
      opacity: 0.68,
    },

    saveText: {
      color: '#111',
      fontSize: 17,
      fontWeight: '900',
      marginLeft: 10,
    },
  });