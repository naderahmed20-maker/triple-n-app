import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { saveOutfit as saveOutfitToSupabase } from '@/lib/outfitService';
import { getCurrentUser, getMyWardrobeItems } from '@/lib/wardrobeService';
import OutfitCanvas from './app/components/OutfitCanvas';

import {
  Outfit,
  WardrobeItem,
  pickBestOutfit,
} from './data/outfitRules';

import {
  AppWeatherContext,
  loadWeatherContext,
} from './data/appContext';

import { getAIScore } from './data/aiScoring';
import {
  getPreferenceBonus,
  getUserPreference,
} from './data/userPreference';

export default function OutfitScreen() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [colorScore, setColorScore] = useState(0);
  const [styleScore, setStyleScore] = useState(0);
  const [aiExplanation, setAiExplanation] = useState<string[]>([]);
  const [occasion, setOccasion] = useState('Casual');
  const [appContext, setAppContext] = useState<AppWeatherContext | null>(null);
  const [userPreference, setUserPreference] = useState<any>(null);

  const previewRef = useRef<View>(null);
  const occasions = ['Casual', 'Work', 'Date'];

  useEffect(() => {
    async function init() {
      try {
        const user = await getCurrentUser();

        if (!user) {
          router.replace('/login' as any);
          return;
        }

        const wardrobe = await getMyWardrobeItems();
        setItems(wardrobe as WardrobeItem[]);

        const context = await loadWeatherContext();
        setAppContext(context);

        const preference = await getUserPreference();
        setUserPreference(preference);
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Failed to load outfit data');
      }
    }

    init();
  }, []);

  async function openPreview() {
    if (!outfit || !previewRef.current) {
      Alert.alert('Generate first', 'Generate an outfit first.');
      return;
    }

    const uri = await captureRef(previewRef.current, {
      format: 'png',
      quality: 1,
    });

    await AsyncStorage.setItem('previewImage', uri);
    router.push('/app/outfit-preview' as any);
  }

  function generateOutfit() {
    const shuffledItems = [...items].sort(() => Math.random() - 0.5);
    const newOutfit = pickBestOutfit(shuffledItems, appContext);

    if (appContext?.season === 'Summer') {
      newOutfit.jacket = null;
    }

    if (!newOutfit.top || !newOutfit.bottom || !newOutfit.shoes) {
      Alert.alert(
        'Not enough clothes',
        'You need at least one Top, Bottom and Shoes.'
      );
      return;
    }

    const ai = getAIScore(newOutfit, appContext, occasion);

    const bonus =
      getPreferenceBonus(newOutfit.top, userPreference) +
      getPreferenceBonus(newOutfit.bottom, userPreference) +
      getPreferenceBonus(newOutfit.shoes, userPreference) +
      getPreferenceBonus(newOutfit.jacket, userPreference);

    const finalStyle = Math.min(ai.overall + bonus, 99);

    setOutfit(newOutfit);
    setColorScore(ai.color);
    setStyleScore(finalStyle);
    setAiExplanation(ai.explanation);
  }

  async function saveOutfit() {
    if (!outfit || !outfit.top || !outfit.bottom || !outfit.shoes) {
      return;
    }

    try {
      const ai = getAIScore(outfit, appContext, occasion);

      await saveOutfitToSupabase({
        top: outfit.top,
        pants: outfit.bottom,
        bottom: outfit.bottom,
        shoes: outfit.shoes,
        jacket: outfit.jacket,
        accessory: outfit.accessory,
        score: ai.overall,
        aiScore: ai.overall,
        colorScore: ai.color,
        weatherScore: ai.weather,
        seasonScore: ai.season,
        styleScore: ai.style,
        explanation: ai.explanation,
        occasion,
        weather: appContext?.weather,
        season: appContext?.season,
      });

      Alert.alert('Saved', 'AI outfit saved successfully.');
    } catch (e: any) {
      Alert.alert('Save failed', e.message ?? 'Something went wrong');
    }
  }

  return (
  <ScrollView
  style={styles.container}>
    <View style={styles.topBar}>
      <TouchableOpacity
  onPress={() => router.replace('/home' as any)}
>
  <Text style={styles.backText}>‹</Text>
</TouchableOpacity>
      <Text style={styles.title}>Outfit Builder</Text>

      <View style={{ width: 35 }} />
    </View>

    {appContext && (
      <View style={styles.weatherBanner}>
        <Text style={styles.weatherBannerText}>
          {appContext.season} Mode • {appContext.temperature}°C • {appContext.weather}
        </Text>
      </View>
    )}

    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
      {occasions.map((item) => (
        <TouchableOpacity
          key={item}
          style={[styles.tab, occasion === item && styles.activeTab]}
          onPress={() => setOccasion(item)}
        >
          <Text style={[styles.tabText, occasion === item && styles.activeTabText]}>
            {item}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>

    <View style={styles.mainRow}>
      <TouchableOpacity style={styles.previewCard} activeOpacity={0.9} onPress={openPreview}>
        <View ref={previewRef} collapsable={false} style={styles.outfitCanvas}>
  <OutfitCanvas outfit={outfit} variant="builder" />
</View>
      </TouchableOpacity>

      <View style={styles.scoreBox}>
        <Text style={styles.scoreLabel}>Color Match</Text>
        <Text style={styles.scoreNumber}>{colorScore || 0}%</Text>
        <View style={styles.scoreBar}>
          <View style={[styles.scoreFill, { width: `${colorScore || 5}%` }]} />
        </View>

        <View style={styles.scoreDivider} />

        <Text style={styles.scoreLabel}>Style Match</Text>
        <Text style={styles.scoreNumber}>{styleScore || 0}%</Text>
        <View style={styles.scoreBar}>
          <View style={[styles.scoreFill, { width: `${styleScore || 5}%` }]} />
        </View>
      </View>
    </View>

    <View style={styles.whyBox}>
  <Text style={styles.whyTitle}>Why this works</Text>

  {aiExplanation.length > 0 ? (
    aiExplanation.map((line, index) => (
      <Text key={index} style={styles.whyText}>
        • {line}
      </Text>
    ))
  ) : (
    <>
      <Text style={styles.whyText}>• Triple N will explain the outfit after generation.</Text>
      <Text style={styles.whyText}>• Weather, season and colors will be considered.</Text>
    </>
  )}
</View>

    <View style={styles.buttonsRow}>
      <TouchableOpacity style={styles.regenerateButton} onPress={generateOutfit}>
        <Text style={styles.regenerateText}>
          {outfit ? 'Regenerate' : 'Generate'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.saveButton} onPress={saveOutfit}>
        <Text style={styles.saveText}>Save Outfit</Text>
      </TouchableOpacity>
    </View>
  </ScrollView>
);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090d',
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  backText: {
    color: 'white',
    fontSize: 44,
    fontWeight: '300',
  },
  title: {
    color: 'white',
    fontSize: 24,
    fontWeight: '900',
  },
  weatherBanner: {
    backgroundColor: '#17191d',
    borderRadius: 16,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#252a31',
  },
  weatherBannerText: {
    color: '#facc15',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  tabs: {
    marginBottom: 20,
    maxHeight: 50,
  },
  tab: {
    backgroundColor: '#15171c',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 15,
    marginRight: 10,
  },
  activeTab: {
    backgroundColor: '#f4dfc8',
  },
  tabText: {
    color: '#aaa',
    fontWeight: '900',
  },
  activeTabText: {
    color: '#111',
  },
  mainRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 28,
  },
  previewCard: {

  flex: 1.7,

  height: 420,

  backgroundColor: '#e8e4de',

  borderRadius: 28,

  alignItems: 'center',

  justifyContent: 'center',

  padding: 8,

  overflow: 'hidden',

},
  topImage: {
    width: 190,
    height: 135,
    resizeMode: 'contain',
    marginBottom: -8,
  },
  jacketImage: {
    width: 195,
    height: 125,
    resizeMode: 'contain',
    marginBottom: -25,
    zIndex: 3,
  },
  bottomImage: {
    width: 175,
    height: 175,
    resizeMode: 'contain',
    marginBottom: -5,
  },
  shoesImage: {
    width: 130,
    height: 80,
    resizeMode: 'contain',
    alignSelf: 'flex-end',
  },
  emptySlot: {
    color: '#777',
    fontSize: 18,
    fontWeight: '900',
    marginVertical: 12,
  },
  scoreBox: {
    flex: 1,
    justifyContent: 'center',
  },
  scoreLabel: {
    color: 'white',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 8,
  },
  scoreNumber: {
    color: '#7ee36b',
    fontSize: 38,
    fontWeight: '900',
    marginBottom: 8,
  },
  scoreBar: {
    height: 7,
    backgroundColor: '#1f2933',
    borderRadius: 10,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    backgroundColor: '#7ee36b',
  },
  scoreDivider: {
    height: 1,
    backgroundColor: '#1f2933',
    marginVertical: 32,
  },
  whyBox: {
    marginBottom: 32,
  },
  whyTitle: {
    color: 'white',
    fontSize: 21,
    fontWeight: '900',
    marginBottom: 14,
  },
  whyText: {
    color: '#ddd',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  regenerateButton: {
    flex: 1,
    backgroundColor: '#15171c',
    paddingVertical: 18,
    borderRadius: 22,
    alignItems: 'center',
  },
  regenerateText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
  },
  saveButton: {
    flex: 1.2,
    backgroundColor: '#f4dfc8',
    paddingVertical: 18,
    borderRadius: 22,
    alignItems: 'center',
  },
  saveText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '900',
  },
  outfitCanvas: {

  width: '100%',

  height: '100%',

  alignItems: 'center',

  justifyContent: 'center',

},

content: {
  paddingBottom: 40,
},

});