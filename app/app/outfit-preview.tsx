import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import OutfitCanvas from './components/OutfitCanvas';

type WardrobeItem = {
  image: string;
  category: string;
  name?: string;
  color?: string;
};

type SavedOutfit = {
  top: WardrobeItem | null;
  pants: WardrobeItem | null;
  bottom?: WardrobeItem | null;
  shoes: WardrobeItem | null;
  jacket: WardrobeItem | null;
  accessory?: WardrobeItem | null;
};

export default function OutfitPreviewScreen() {
  const [outfit, setOutfit] = useState<SavedOutfit | null>(null);

  useEffect(() => {
  async function loadOutfit() {
    const savedOutfit = await AsyncStorage.getItem('previewOutfit');
    const savedImage = await AsyncStorage.getItem('previewImage');

    if (savedOutfit) {
      setOutfit(JSON.parse(savedOutfit));
      return;
    }

    if (savedImage) {
     setOutfit({
  top: { image: savedImage, category: 'Preview' },
  pants: null,
  bottom: null,
  shoes: null,
  jacket: null,
  accessory: null,
});
    }
  }

  loadOutfit();
}, []);
  const shareImage = async () => {
    Alert.alert('Soon', 'هنشغل المشاركة بعدين.');
  };

  const downloadImage = async () => {
    const permission = await MediaLibrary.requestPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow access to save images.');
      return;
    }

    Alert.alert('Soon', 'هنشغل التحميل بعدين.');
  };

  if (!outfit) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Virtual Try-On</Text>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No outfit found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Virtual Try-On</Text>

      <View style={styles.previewCard}>
        <OutfitCanvas
  outfit={{
    top: outfit.top,
    bottom: outfit.pants || outfit.bottom || null,
    shoes: outfit.shoes,
    jacket: outfit.jacket,
    accessory: outfit.accessory || null,
  }}
  variant="details"
/>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={shareImage}>
          <Feather name="share" size={24} color="white" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={downloadImage}>
          <Feather name="download" size={24} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
    paddingHorizontal: 22,
  },

  title: {
    color: 'white',
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 18,
  },

  previewCard: {
    flex: 1,
    backgroundColor: '#f4f1eb',
    borderRadius: 42,
    marginBottom: 24,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },

  imageBox: {
    width: '100%',
    height: 132,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#ddd',
    marginBottom: 6,
    borderWidth: 1.5,
    borderColor: '#222',
  },

  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },

  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 22,
    paddingBottom: 28,
  },

  actionButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#191919',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyText: {
    color: '#aaa',
    fontSize: 18,
    fontWeight: '800',
  },
});