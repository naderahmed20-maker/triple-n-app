import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';

import {
  router,
  useFocusEffect,
} from 'expo-router';

import {
  useCallback,
  useState,
} from 'react';

import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTranslation } from '@/lib/i18n';

import {
  getSavedOutfits,
} from '@/lib/outfitService';

import {
  getMyProfile,
} from '@/lib/profileService';

import {
  supabase,
} from '@/lib/supabase';

import {
  getMyWardrobeItems,
} from '@/lib/wardrobeService';

export default function ProfileScreen() {
  const {
    t,
  } = useTranslation();

  const [
    email,
    setEmail,
  ] = useState('');

  const [
    displayName,
    setDisplayName,
  ] = useState('User');

  const [
    itemsCount,
    setItemsCount,
  ] = useState(0);

  const [
    outfitsCount,
    setOutfitsCount,
  ] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadProfile() {
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

          const [
            items,
            outfits,
            profile,
          ] =
            await Promise.all([
              getMyWardrobeItems(),
              getSavedOutfits(),
              getMyProfile(),
            ]);

          if (!active) {
            return;
          }

          const name =
            profile?.first_name ||
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split('@')[0] ||
            'User';

          setDisplayName(
            name
          );

          setEmail(
            user.email ||
              t(
                'profile.noEmail'
              )
          );

          setItemsCount(
            items.length
          );

          setOutfitsCount(
            outfits.length
          );
        } catch (
          error: any
        ) {
          if (!active) {
            return;
          }

          Alert.alert(
            t(
              'common.error'
            ),
            error?.message ||
              t(
                'profile.loadFailed'
              )
          );
        }
      }

      void loadProfile();

      return () => {
        active = false;
      };
    }, [t])
  );

  function replaceTwoValues(
    text: string,
    firstKey: string,
    firstValue:
      | string
      | number,
    secondKey: string,
    secondValue:
      | string
      | number
  ) {
    return text
      .replace(
        `{{${firstKey}}}`,
        String(firstValue)
      )
      .replace(
        `{{${secondKey}}}`,
        String(secondValue)
      );
  }

  async function logout() {
    try {
      const {
        error,
      } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      router.replace(
        '/login' as any
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        t(
          'profile.logoutFailed'
        ),
        error?.message ||
          t(
            'profile.logoutFailedMessage'
          )
      );
    }
  }

  return (
    <View
      style={
        styles.container
      }
    >
      <View
        style={
          styles.content
        }
      >
        <Text
          style={
            styles.title
          }
        >
          {t(
            'profile.title'
          )}
        </Text>

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
            {displayName
              .charAt(0)
              .toUpperCase() ||
              'N'}
          </Text>
        </View>

        <Text
          style={
            styles.name
          }
          numberOfLines={
            1
          }
        >
          {displayName}
        </Text>

        <Text
          style={
            styles.email
          }
          numberOfLines={
            1
          }
        >
          {email}
        </Text>

        <Text
          style={
            styles.role
          }
        >
          {replaceTwoValues(
            t(
              'profile.summary'
            ),
            'items',
            itemsCount,
            'outfits',
            outfitsCount
          )}
        </Text>

        <View
          style={
            styles.menuBox
          }
        >
          <MenuItem
            icon="user"
            title={t(
              'profile.account'
            )}
            onPress={() =>
              router.push(
                '/account' as any
              )
            }
          />

          <MenuItem
            icon="settings"
            title={t(
              'profile.settings'
            )}
            onPress={() =>
              router.push(
                '/settings' as any
              )
            }
          />

          <MenuItem
            icon="help-circle"
            title={t(
              'profile.help'
            )}
            onPress={() =>
              router.push(
                '/help-center' as any
              )
            }
          />

          <MenuItem
            icon="info"
            title={t(
              'profile.about'
            )}
            onPress={() =>
              router.push(
                '/about' as any
              )
            }
          />
        </View>

        <TouchableOpacity
          style={
            styles.logoutBox
          }
          onPress={
            logout
          }
          activeOpacity={
            0.85
          }
        >
          <Feather
            name="log-out"
            size={22}
            color="#ff5a5a"
          />

          <Text
            style={
              styles.logoutText
            }
          >
            {t(
              'auth.logout'
            )}
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={
          styles.bottomNav
        }
      >
        <TouchableOpacity
          style={
            styles.navItem
          }
          onPress={() =>
            router.replace(
              '/home' as any
            )
          }
        >
          <Ionicons
            name="home-outline"
            size={30}
            color="#777"
          />

          <Text
            style={
              styles.navLabel
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
          onPress={() =>
            router.replace(
              '/wardrobe' as any
            )
          }
        >
          <MaterialCommunityIcons
            name="hanger"
            size={30}
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
          onPress={() =>
            router.replace(
              '/outfit' as any
            )
          }
        >
          <Ionicons
            name="sparkles-outline"
            size={30}
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
          onPress={() =>
            router.replace(
              '/saved-outfits' as any
            )
          }
        >
          <Ionicons
            name="heart-outline"
            size={30}
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
          disabled
        >
          <Feather
            name="user"
            size={30}
            color="white"
          />

          <Text
            style={
              styles.navLabelActive
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

function MenuItem({
  icon,
  title,
  onPress,
}: {
  icon:
    React.ComponentProps<
      typeof Feather
    >['name'];

  title: string;

  onPress:
    () => void;
}) {
  return (
    <TouchableOpacity
      style={
        styles.menuItem
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
          styles.menuLeft
        }
      >
        <Feather
          name={icon}
          size={22}
          color="#d8d8d8"
        />

        <Text
          style={
            styles.menuText
          }
        >
          {title}
        </Text>
      </View>

      <Feather
        name="chevron-right"
        size={24}
        color="#d8d8d8"
      />
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

    content: {
      flex: 1,
      paddingHorizontal: 28,
      paddingTop: 70,
      paddingBottom: 120,
      alignItems: 'center',
    },

    title: {
      color: 'white',
      fontSize: 28,
      fontWeight: '900',
      marginBottom: 18,
    },

    avatar: {
      width: 105,
      height: 105,
      borderRadius: 53,
      backgroundColor:
        '#f1d8c2',
      alignItems: 'center',
      justifyContent:
        'center',
      marginBottom: 14,
    },

    avatarText: {
      color: '#111',
      fontSize: 44,
      fontWeight: '900',
    },

    name: {
      color: 'white',
      fontSize: 27,
      fontWeight: '900',
      textAlign: 'center',
      maxWidth: '100%',
    },

    email: {
      color: '#b4b4b4',
      fontSize: 13,
      fontWeight: '700',
      marginTop: 5,
      maxWidth: '100%',
    },

    role: {
      color: '#aaa',
      fontSize: 16,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 32,
    },

    menuBox: {
      width: '100%',
      borderRadius: 22,
      overflow: 'hidden',
      marginBottom: 18,
    },

    menuItem: {
      height: 58,
      backgroundColor:
        '#17191d',
      borderBottomWidth: 1,
      borderBottomColor:
        '#22252b',
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
    },

    menuLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },

    menuText: {
      color: 'white',
      fontSize: 17,
      fontWeight: '800',
      marginLeft: 16,
    },

    logoutBox: {
      width: '100%',
      height: 58,
      backgroundColor:
        '#17191d',
      borderRadius: 18,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
    },

    logoutText: {
      color: '#ff5a5a',
      fontSize: 17,
      fontWeight: '900',
      marginLeft: 16,
    },

    bottomNav: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 100,
      backgroundColor:
        '#07090d',
      borderTopWidth: 1,
      borderTopColor:
        '#1b1d22',
      flexDirection: 'row',
      justifyContent:
        'space-around',
      alignItems: 'center',
    },

    navItem: {
      alignItems: 'center',
      justifyContent:
        'center',
      minWidth: 58,
    },

    navLabelActive: {
      color: 'white',
      fontSize: 13,
      marginTop: 5,
      fontWeight: '700',
    },

    navLabel: {
      color: '#777',
      fontSize: 13,
      marginTop: 5,
      fontWeight: '700',
    },
  });