import { uploadWardrobeImage } from '@/lib/storageService';
import {
  WardrobeItem,
  getCurrentUser,
  getMyWardrobeItems,
  updateWardrobeItem,
} from '@/lib/wardrobeService';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';

export default function EditItemScreen() {
  const { id } = useLocalSearchParams();

  const [image, setImage] = useState('');
  const [originalImage, setOriginalImage] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Tops');
  const [color, setColor] = useState('Black');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const categories = ['Tops', 'Pants', 'Shorts', 'Shoes', 'Jackets', 'Accessories'];
  const colors = ['Black', 'White', 'Blue', 'Red', 'Green', 'Brown', 'Yellow', 'Purple', 'Gray', 'Beige'];

  useEffect(() => {
    async function loadItem() {
      try {
        if (!id) return router.back();

        const allItems = await getMyWardrobeItems();
        const item = allItems.find((x: WardrobeItem) => x.id === String(id));

        if (!item) {
          Alert.alert('Error', 'Item not found');
          router.back();
          return;
        }

        setImage(item.image || '');
        setOriginalImage(item.image || '');
        setName(item.name || '');
        setCategory(item.category || 'Tops');
        setColor(item.color || 'Black');
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Failed to load item');
        router.back();
      } finally {
        setLoading(false);
      }
    }

    loadItem();
  }, [id]);

  async function changePhoto() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.4,
  });

  if (result.canceled) return;

  const converted = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [
      {
        resize: {
          width: 1024,
        },
      },
    ],

    {
      compress: 0.55,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  setImage(converted.uri);
}
  async function saveChanges() {
    if (!id || saving) return;

    setSaving(true);

    try {
      const user = await getCurrentUser();

      if (!user) {
        Alert.alert('Login required', 'Please login first');
        router.replace('/login' as any);
        return;
      }

      let finalImage = image;

      if (image && image !== originalImage && image.startsWith('file')) {
        finalImage = await uploadWardrobeImage(image, user.id);
      }

      await updateWardrobeItem(String(id), {
        image: finalImage,
        name,
        category,
        color,
      });

      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.center}>
        <ActivityIndicator color="#f4dfc8" />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Edit Item</Text>

      {image !== '' && <Image source={{ uri: image }} style={styles.itemImage} />}

      <TouchableOpacity style={styles.changePhotoButton} onPress={changePhoto}>
        <Text style={styles.changePhotoText}>📸 Change Photo</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Item Name</Text>

      <TextInput
        style={styles.input}
        placeholder="Example: Black T-shirt"
        placeholderTextColor="#777"
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Choose Category</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rowScroll}>
        {categories.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.categoryButton, category === item && styles.activeCategory]}
            onPress={() => setCategory(item)}
          >
            <Text style={[styles.categoryText, category === item && styles.activeCategoryText]}>
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>Choose Color</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rowScroll}>
        {colors.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.colorButton, color === item && styles.activeColor]}
            onPress={() => setColor(item)}
          >
            <Text style={[styles.colorText, color === item && styles.activeColorText]}>
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.button} onPress={saveChanges} disabled={saving}>
        {saving ? (
          <ActivityIndicator color="#111" />
        ) : (
          <Text style={styles.buttonText}>Save Changes</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingTop: 70, paddingBottom: 40 },
  title: {
    color: 'white',
    fontSize: 34,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 25,
  },
  itemImage: {
    width: '100%',
    height: 260,
    borderRadius: 25,
    marginBottom: 15,
  },
  changePhotoButton: {
    backgroundColor: '#222',
    padding: 14,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 25,
  },
  changePhotoText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  label: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  input: {
    backgroundColor: '#1c1c1c',
    color: 'white',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 15,
    padding: 15,
    fontSize: 16,
    marginBottom: 25,
  },
  rowScroll: { marginBottom: 25 },
  categoryButton: {
    borderWidth: 1,
    borderColor: '#444',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginRight: 10,
  },
  activeCategory: { backgroundColor: 'white' },
  categoryText: { color: '#aaa', fontSize: 15 },
  activeCategoryText: { color: '#111', fontWeight: 'bold' },
  colorButton: {
    borderWidth: 1,
    borderColor: '#444',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: '#1c1c1c',
  },
  activeColor: { backgroundColor: '#f59e0b' },
  colorText: { color: '#aaa', fontSize: 15, fontWeight: 'bold' },
  activeColorText: { color: '#111' },
  button: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 30,
    alignItems: 'center',
    marginBottom: 15,
  },
  buttonText: { color: '#111', fontSize: 18, fontWeight: 'bold' },
  cancelButton: {
    backgroundColor: '#222',
    padding: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  cancelText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});