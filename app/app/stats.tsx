import { getSavedOutfits } from '@/lib/outfitService';
import {
  getCurrentUser,
  getMyWardrobeItems,
  WardrobeItem,
} from '@/lib/wardrobeService';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function StatsScreen() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      async function loadData() {
        try {
          const user = await getCurrentUser();

          if (!user) {
            router.replace('/login' as any);
            return;
          }

          const wardrobe = await getMyWardrobeItems();
          const savedRows = await getSavedOutfits();

const savedOutfits = savedRows.map((row: any) => ({
  ...row.outfit,
  favorite: row.favorite,
  createdAt: row.created_at
    ? new Date(row.created_at).getTime()
    : undefined,
}));

setItems(wardrobe);
setOutfits(savedOutfits);
        } catch (e: any) {
          Alert.alert('Error', e.message ?? 'Failed to load statistics');
        }
      }

      loadData();
    }, [])
  );

  const tops = items.filter((i) => i.category === 'Top' || i.category === 'Tops').length;
  const pants = items.filter((i) => i.category === 'Pants' || i.category === 'Shorts').length;
  const shoes = items.filter((i) => i.category === 'Shoes').length;
  const jackets = items.filter((i) => i.category === 'Jacket' || i.category === 'Jackets').length;
  const accessories = items.filter((i) => i.category === 'Accessories').length;

  const favoriteItems = items.filter((i) => i.favorite).length;
  const favoriteOutfits = outfits.filter((o) => o.favorite).length;

  const bestMatchScore = outfits.length
    ? Math.max(...outfits.map((o) => o.score || 0))
    : 0;

  const bestColorScore = outfits.length
    ? Math.max(...outfits.map((o) => o.colorScore || 0))
    : 0;

  const latestOutfit = outfits
    .filter((o) => o.createdAt)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

  const latestDate = latestOutfit?.createdAt
    ? new Date(latestOutfit.createdAt).toLocaleDateString()
    : 'None';

  function StatCard(title: string, value: number, route?: string) {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => {
          if (route) router.push(route as any);
        }}
      >
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.label}>{title}</Text>
      </TouchableOpacity>
    );
  }

  function PremiumCard({
    title,
    value,
    icon,
    route,
  }: {
    title: string;
    value: number;
    icon: string;
    route?: string;
  }) {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => {
          if (route) router.push(route as any);
        }}
      >
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.label}>{title}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backIcon}
            onPress={() => router.replace('/app/home' as any)}
          >
            <Text style={styles.backIconText}>‹</Text>
          </TouchableOpacity>

          <View>
            <Text style={styles.title}>Statistics</Text>
            <Text style={styles.subtitle}>Your wardrobe performance</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.welcomeCard}
          activeOpacity={0.85}
          onPress={() => router.push('/profile' as any)}
        >
          <Text style={styles.welcomeTitle}>Welcome back, Nader 👋</Text>
          <Text style={styles.welcomeText}>
            You have {items.length} items ready to create your next outfit.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.summaryCard}
          activeOpacity={0.85}
          onPress={() => router.push('/wardrobe' as any)}
        >
          <View>
            <Text style={styles.summaryLabel}>Total Wardrobe</Text>
            <Text style={styles.summaryValue}>{items.length}</Text>
          </View>

          <View style={styles.summaryDivider} />

          <View>
            <Text style={styles.summaryLabel}>Saved Looks</Text>
            <Text style={styles.summaryValue}>{outfits.length}</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.insightCard}>
          <Text style={styles.insightTitle}>Style Insight</Text>
          <Text style={styles.insightText}>
            {items.length < 20
              ? 'Your wardrobe is still growing. Add more items to improve AI recommendations.'
              : items.length < 50
              ? 'Nice wardrobe! Triple N can create more diverse outfit combinations.'
              : 'Excellent wardrobe! Your AI assistant has plenty of options to build premium outfits.'}
          </Text>
        </View>

        <View style={styles.grid}>
          <PremiumCard title="Items" value={items.length} icon="👕" route="/wardrobe" />
          <PremiumCard title="Outfits" value={outfits.length} icon="✨" route="/saved-outfits" />
          <PremiumCard title="Favorites" value={favoriteItems} icon="❤️" route="/wardrobe" />
          <PremiumCard title="Saved" value={favoriteOutfits} icon="⭐" route="/saved-outfits" />

          {StatCard('Tops', tops, '/wardrobe')}
          {StatCard('Pants', pants, '/wardrobe')}
          {StatCard('Shoes', shoes, '/wardrobe')}
          {StatCard('Jackets', jackets, '/wardrobe')}
          {StatCard('Accessories', accessories, '/wardrobe')}
          {StatCard('Best Match', bestMatchScore, '/saved-outfits')}
          {StatCard('Best Color', bestColorScore, '/saved-outfits')}
        </View>

        <TouchableOpacity
          style={styles.goalCard}
          activeOpacity={0.85}
          onPress={() => router.push('/item' as any)}
        >
          <Text style={styles.goalTitle}>Wardrobe Goal</Text>

          <View style={styles.progressBackground}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min((items.length / 100) * 100, 100)}%`,
                },
              ]}
            />
          </View>

          <Text style={styles.goalText}>
            {items.length >= 100
              ? 'Excellent! Your wardrobe is complete.'
              : `Add ${100 - items.length} more items to reach your first wardrobe goal.`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.historyBox}
          activeOpacity={0.85}
          onPress={() => router.push('/saved-outfits' as any)}
        >
          <Text style={styles.historyTitle}>🕒 Outfit History</Text>
          <Text style={styles.historyText}>Last saved outfit: {latestDate}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace('/app/home' as any)}
        >
          <Text style={styles.backText}>⬅ Back Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0d11',
  },

  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  backIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#17191d',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  backIconText: {
    color: 'white',
    fontSize: 30,
    fontWeight: '300',
  },

  title: {
    color: 'white',
    fontSize: 27,
    fontWeight: '900',
  },

  subtitle: {
    color: '#8f9299',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },

  welcomeCard: {
    backgroundColor: '#15171c',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#252832',
    padding: 14,
    marginBottom: 10,
  },

  welcomeTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },

  welcomeText: {
    color: '#8f9299',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },

  summaryCard: {
    backgroundColor: '#111318',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#252832',
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  summaryLabel: {
    color: '#8f9299',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },

  summaryValue: {
    color: '#f1d8c2',
    fontSize: 28,
    fontWeight: '900',
  },

  summaryDivider: {
    width: 1,
    height: 42,
    backgroundColor: '#252832',
  },

  insightCard: {
    backgroundColor: '#111318',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#252832',
    padding: 12,
    marginBottom: 10,
  },

  insightTitle: {
    color: '#f1d8c2',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },

  insightText: {
    color: '#d4d6db',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 6,
  },

  card: {
    width: '48%',
    backgroundColor: '#15171c',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#252832',
  },

  cardIcon: {
    fontSize: 17,
    marginBottom: 3,
  },

  value: {
    color: '#f1d8c2',
    fontSize: 22,
    fontWeight: '900',
  },

  label: {
    color: '#8f9299',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
    fontWeight: '700',
  },

  goalCard: {
    backgroundColor: '#111318',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#252832',
    padding: 12,
    marginBottom: 8,
  },

  goalTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 7,
  },

  progressBackground: {
    height: 7,
    backgroundColor: '#252832',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 7,
  },

  progressFill: {
    height: '100%',
    backgroundColor: '#f1d8c2',
    borderRadius: 10,
  },

  goalText: {
    color: '#8f9299',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },

  historyBox: {
    backgroundColor: '#15171c',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#252832',
  },

  historyTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },

  historyText: {
    color: '#aaa',
    fontSize: 11,
  },

  backButton: {
    display: 'none',
  },

  backText: {
    color: 'white',
  },
});