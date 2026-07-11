import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    WARDROBE_TYPE_KEY,
    WardrobeType,
} from './data/clothingCategories';

export default function WardrobeTypeScreen() {
  async function chooseType(type: WardrobeType) {
    await AsyncStorage.setItem(WARDROBE_TYPE_KEY, type);
    router.replace('/home' as any);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose your wardrobe</Text>

      <Text style={styles.subtitle}>
        This controls categories and outfit layouts.
      </Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => chooseType('male')}
      >
        <Text style={styles.icon}>👔</Text>
        <Text style={styles.cardTitle}>Men&apos;s Wardrobe</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => chooseType('female')}
      >
        <Text style={styles.icon}>👗</Text>
        <Text style={styles.cardTitle}>Women&apos;s Wardrobe</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },

  title: {
    color: 'white',
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
  },

  subtitle: {
    color: '#aaa',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 30,
  },

  card: {
    backgroundColor: '#15171c',
    borderRadius: 24,
    paddingVertical: 28,
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#2a2d34',
  },

  icon: {
    fontSize: 42,
    marginBottom: 10,
  },

  cardTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '900',
  },
});