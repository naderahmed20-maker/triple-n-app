import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function AboutScreen() {
  async function shareApp() {
    await Share.share({
      message:
        'Check out Triple N — AI Fashion Assistant.\nDownload coming soon.',
    });
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

        <View style={styles.heroCard}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoLetter}>N</Text>
          </View>

          <Text style={styles.appName}>
            TRIPLE N
          </Text>

          <Text style={styles.tagline}>
            Your Personal Fashion Assistant
          </Text>

          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>
              Version 1.0.0 Production
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <InfoItem
            icon="zap"
            title="Smart Styling"
            text="Triple N helps you build better outfits from the clothes you already own."
          />

          <InfoItem
            icon="cpu"
            title="AI Assistant"
            text="The app suggests outfits based on categories, colors, weather, seasons and occasions."
          />

          <InfoItem
            icon="shield"
            title="Private by Design"
            text="Your wardrobe is securely stored in the cloud and synced across your devices."
          />
        </View>

        <View style={styles.statementCard}>
          <Text style={styles.statementTitle}>
            Our Mission
          </Text>

          <Text style={styles.statementText}>
            To make choosing outfits faster, smarter and more personal every day.
          </Text>
        </View>

        <View style={styles.statementCard}>
          <Text style={styles.statementTitle}>
            Our Vision
          </Text>

          <Text style={styles.statementText}>
            To become the world's most trusted AI fashion assistant.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={shareApp}
        >
          <Feather
            name="share-2"
            size={20}
            color="#111"
          />

          <Text style={styles.actionText}>
            Share Triple N
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() =>
            Alert.alert(
              'Coming Soon',
              'App Store & Google Play rating will be available after launch.'
            )
          }
        >
          <Feather
            name="star"
            size={20}
            color="#f1d8c2"
          />

          <Text style={styles.secondaryText}>
            Rate App
          </Text>
        </TouchableOpacity>

        <Text style={styles.footer}>
          Made with passion for better style.
        </Text>

        <Text
          style={{
            color: '#555',
            textAlign: 'center',
            marginTop: 8,
            fontSize: 12,
            fontWeight: '700',
          }}
        >
          © 2026 Triple N. All rights reserved.
        </Text>

      </View>
    </ScrollView>
  );
}

function InfoItem({
  icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.infoItem}>
      <View style={styles.iconBox}>
        <Feather
          name={icon}
          size={20}
          color="#f1d8c2"
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.infoTitle}>
          {title}
        </Text>

        <Text style={styles.infoText}>
          {text}
        </Text>
      </View>
    </View>
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
    paddingBottom: 45,
  },

  backIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#17191d',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  heroCard: {
    backgroundColor: '#111318',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#252832',
    alignItems: 'center',
    paddingVertical: 34,
    paddingHorizontal: 20,
    marginBottom: 18,
  },

  logoCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  logoLetter: {
    color: '#111',
    fontSize: 54,
    fontWeight: '900',
  },

  appName: {
    color: 'white',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 4,
  },

  tagline: {
    color: '#9b9fa8',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 8,
    textAlign: 'center',
  },

  versionBadge: {
    marginTop: 18,
    backgroundColor: '#1b1e24',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },

  versionText: {
    color: '#f1d8c2',
    fontSize: 13,
    fontWeight: '900',
  },

  card: {
    backgroundColor: '#111318',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#22252b',
    overflow: 'hidden',
    marginBottom: 18,
  },

  infoItem: {
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#22252b',
    flexDirection: 'row',
  },

  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: '#1b1e24',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },

  infoTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 5,
  },

  infoText: {
    color: '#8f9299',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },

  statementCard: {
    backgroundColor: '#111318',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#22252b',
    padding: 20,
    marginBottom: 14,
  },

  statementTitle: {
    color: '#f1d8c2',
    fontSize: 17,
    fontWeight: '900',
    marginBottom: 8,
  },

  statementText: {
    color: '#d7d8dc',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  actionButton: {
    height: 58,
    borderRadius: 22,
    backgroundColor: '#f1d8c2',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 8,
  },

  actionText: {
    color: '#111',
    fontSize: 17,
    fontWeight: '900',
    marginLeft: 10,
  },

  secondaryButton: {
    height: 56,
    borderRadius: 22,
    backgroundColor: '#17191d',
    borderWidth: 1,
    borderColor: '#2a2d35',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 14,
  },

  secondaryText: {
    color: '#f1d8c2',
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 10,
  },

  footer: {
    color: '#777',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 24,
  },
});