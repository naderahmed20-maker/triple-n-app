import { getSavedOutfits } from '@/lib/outfitService';
import { supabase } from '@/lib/supabase';
import { getMyWardrobeItems } from '@/lib/wardrobeService';

import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function ProfileScreen() {
  const [email, setEmail] = useState('');
  const [itemsCount, setItemsCount] = useState(0);
  const [outfitsCount, setOutfitsCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadProfile() {
        try {
          const { data } = await supabase.auth.getSession();
          const user = data.session?.user;

          if (!user) {
            router.replace('/login' as any);
            return;
          }

          const [items, outfits] = await Promise.all([
            getMyWardrobeItems(),
            getSavedOutfits(),
          ]);

          if (!active) return;

          setEmail(user.email || 'No email');
          setItemsCount(items.length);
          setOutfitsCount(outfits.length);
        } catch (error: any) {
          if (!active) return;

          Alert.alert(
            'Error',
            error?.message || 'Failed to load profile.'
          );
        }
      }

      loadProfile();

      return () => {
        active = false;
      };
    }, [])
  );

  async function logout() {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      router.replace('/login' as any);
    } catch (error: any) {
      Alert.alert(
        'Logout failed',
        error?.message || 'Could not log out.'
      );
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.avatar}>
          <Text style={styles.avatarText}>N</Text>
        </View>

        <Text style={styles.name}>{email}</Text>

        <Text style={styles.role}>
          {itemsCount} items • {outfitsCount} outfits
        </Text>

        <View style={styles.menuBox}>
          <MenuItem
            icon="user"
            title="Account"
            onPress={() => router.push('/account' as any)}
          />

          <MenuItem
            icon="settings"
            title="Settings"
            onPress={() => router.push('/settings' as any)}
          />

          <MenuItem
            icon="help-circle"
            title="Help Center"
            onPress={() => router.push('/help-center' as any)}
          />

          <MenuItem
            icon="info"
            title="About Triple N"
            onPress={() => router.push('/about' as any)}
          />
        </View>

        <TouchableOpacity
          style={styles.logoutBox}
          onPress={logout}
        >
          <Feather
            name="log-out"
            size={22}
            color="#ff5a5a"
          />

          <Text style={styles.logoutText}>
            Log Out
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.replace('/home' as any)}
        >
          <Ionicons
            name="home-outline"
            size={30}
            color="#777"
          />

          <Text style={styles.navLabel}>
            Home
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.replace('/wardrobe' as any)}
        >
          <MaterialCommunityIcons
            name="hanger"
            size={30}
            color="#777"
          />

          <Text style={styles.navLabel}>
            Wardrobe
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.replace('/outfit' as any)}
        >
          <Ionicons
            name="sparkles-outline"
            size={30}
            color="#777"
          />

          <Text style={styles.navLabel}>
            Outfits
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() =>
            router.replace('/saved-outfits' as any)
          }
        >
          <Ionicons
            name="heart-outline"
            size={30}
            color="#777"
          />

          <Text style={styles.navLabel}>
            Saved
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          disabled
        >
          <Feather
            name="user"
            size={30}
            color="white"
          />

          <Text style={styles.navLabelActive}>
            Profile
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
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
    >
      <View style={styles.menuLeft}>
        <Feather
          name={icon}
          size={22}
          color="#d8d8d8"
        />

        <Text style={styles.menuText}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
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
    backgroundColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
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
  },

  role: {
    color: '#aaa',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
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
    backgroundColor: '#17191d',
    borderBottomWidth: 1,
    borderBottomColor: '#22252b',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
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
    backgroundColor: '#17191d',
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
    backgroundColor: '#07090d',
    borderTopWidth: 1,
    borderTopColor: '#1b1d22',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },

  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
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