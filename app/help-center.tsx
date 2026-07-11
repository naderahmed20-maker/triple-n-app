import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function HelpCenterScreen() {
  function show(title: string, message: string) {
    Alert.alert(title, message);
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.content}>
        <TouchableOpacity
          style={styles.backIcon}
          onPress={() => router.back()}
        >
          <Feather
            name="chevron-left"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <Text style={styles.title}>
          Help Center
        </Text>

        <Text style={styles.subtitle}>
          Everything you need to use Triple N
        </Text>

        <View style={styles.card}>

          <HelpItem
            icon="image"
            title="Add Clothes"
            subtitle="Build your digital wardrobe"
            onPress={() =>
              show(
                'Add Clothes',
                'Go to Wardrobe → Add Item → Choose Photo → Select Category → Save.'
              )
            }
          />

          <HelpItem
            icon="cpu"
            title="AI Outfit Suggestions"
            subtitle="How Triple N builds outfits"
            onPress={() =>
              show(
                'AI Suggestions',
                'Triple N analyzes colors, categories, weather, season and your preferences to build the best outfit.'
              )
            }
          />

          <HelpItem
            icon="heart"
            title="Favorites"
            subtitle="Save your favorite clothes"
            onPress={() =>
              show(
                'Favorites',
                'Tap the ❤️ icon to save any clothing item or outfit.'
              )
            }
          />

          <HelpItem
            icon="help-circle"
            title="Frequently Asked Questions"
            subtitle="Common questions"
            onPress={() =>
              Linking.openURL(
                'https://triplen.ai/faq'
              )
            }
          />

          <HelpItem
            icon="mail"
            title="Contact Support"
            subtitle="support@triplen.ai"
            onPress={() =>
              Linking.openURL(
                'mailto:support@triplen.ai?subject=Triple N Support'
              )
            }
          />

          <HelpItem
            icon="alert-circle"
            title="Report a Bug"
            subtitle="Tell us about an issue"
            onPress={() =>
              Linking.openURL(
                'mailto:bugs@triplen.ai?subject=Bug Report'
              )
            }
          />

          <HelpItem
            icon="shield"
            title="Privacy Policy"
            subtitle="How we protect your data"
            onPress={() =>
              Linking.openURL(
                'https://triplen.ai/privacy'
              )
            }
          />

          <HelpItem
            icon="file-text"
            title="Terms of Service"
            subtitle="Read the app terms"
            onPress={() =>
              Linking.openURL(
                'https://triplen.ai/terms'
              )
            }
          />

        </View>

      </View>

    </ScrollView>
  );
}

function HelpItem({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={onPress}
    >
      <View style={styles.left}>
        <View style={styles.iconBox}>
          <Feather
            name={icon}
            size={20}
            color="#f1d8c2"
          />
        </View>

        <View>
          <Text style={styles.itemTitle}>
            {title}
          </Text>

          <Text style={styles.itemSubtitle}>
            {subtitle}
          </Text>
        </View>
      </View>

      <Feather
        name="chevron-right"
        size={22}
        color="#777"
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
    padding: 24,
    paddingTop: 62,
    paddingBottom: 40,
  },

  backIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#17191d',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },

  title: {
    color: 'white',
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

  card: {
    backgroundColor: '#111318',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#22252b',
    overflow: 'hidden',
  },

  item: {
    minHeight: 78,
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#22252b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: '#1b1e24',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },

  itemTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
  },

  itemSubtitle: {
    color: '#8c9099',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },

  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  arrow: {
    color: '#777',
    fontSize: 20,
  },
  chevron: {
    color: '#777',
    fontSize: 22,
    fontWeight: '700',
  },

  sectionSpacing: {
    height: 12,
  },

  footer: {
    marginTop: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footerText: {
    color: '#666',
    fontSize: 13,
    fontWeight: '700',
  },
});