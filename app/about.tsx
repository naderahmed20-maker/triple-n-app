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

import {
  useTranslation,
} from '@/lib/i18n';

export default function AboutScreen() {
  const { t } = useTranslation();

  async function shareApp() {
    try {
      await Share.share({
        message: t(
          'about.shareMessage'
        ),
      });
    } catch {
      Alert.alert(
        t('common.error'),
        t('about.shareError')
      );
    }
  }

  function showRateAlert() {
    Alert.alert(
      t('about.comingSoonTitle'),
      t('about.ratingComingSoon')
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={
        false
      }
    >
      <View style={styles.content}>
        <TouchableOpacity
          style={styles.backIcon}
          onPress={() =>
            router.back()
          }
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t(
            'common.back'
          )}
        >
          <Feather
            name="chevron-left"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <View style={styles.heroCard}>
          <View style={styles.logoCircle}>
            <Text
              style={styles.logoLetter}
            >
              N
            </Text>
          </View>

          <Text style={styles.appName}>
            TRIPLE N
          </Text>

          <Text style={styles.tagline}>
            {t('about.tagline')}
          </Text>

          <View
            style={styles.versionBadge}
          >
            <Text
              style={styles.versionText}
            >
              {t('about.version')}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <InfoItem
            icon="zap"
            title={t(
              'about.smartStylingTitle'
            )}
            text={t(
              'about.smartStylingText'
            )}
          />

          <InfoItem
            icon="cpu"
            title={t(
              'about.aiAssistantTitle'
            )}
            text={t(
              'about.aiAssistantText'
            )}
          />

          <InfoItem
            icon="shield"
            title={t(
              'about.privacyTitle'
            )}
            text={t(
              'about.privacyText'
            )}
            showBorder={false}
          />
        </View>

        <View
          style={styles.statementCard}
        >
          <Text
            style={styles.statementTitle}
          >
            {t('about.missionTitle')}
          </Text>

          <Text
            style={styles.statementText}
          >
            {t('about.missionText')}
          </Text>
        </View>

        <View
          style={styles.statementCard}
        >
          <Text
            style={styles.statementTitle}
          >
            {t('about.visionTitle')}
          </Text>

          <Text
            style={styles.statementText}
          >
            {t('about.visionText')}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={shareApp}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t(
            'about.shareApp'
          )}
        >
          <Feather
            name="share-2"
            size={20}
            color="#111"
          />

          <Text style={styles.actionText}>
            {t('about.shareApp')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={showRateAlert}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t(
            'about.rateApp'
          )}
        >
          <Feather
            name="star"
            size={20}
            color="#f1d8c2"
          />

          <Text
            style={styles.secondaryText}
          >
            {t('about.rateApp')}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footer}>
          {t('about.footer')}
        </Text>

        <Text style={styles.copyright}>
          {t('about.copyright')}
        </Text>
      </View>
    </ScrollView>
  );
}

type InfoItemProps = {
  icon:
    | 'zap'
    | 'cpu'
    | 'shield';
  title: string;
  text: string;
  showBorder?: boolean;
};

function InfoItem({
  icon,
  title,
  text,
  showBorder = true,
}: InfoItemProps) {
  return (
    <View
      style={[
        styles.infoItem,
        !showBorder &&
          styles.infoItemWithoutBorder,
      ]}
    >
      <View style={styles.iconBox}>
        <Feather
          name={icon}
          size={20}
          color="#f1d8c2"
        />
      </View>

      <View style={styles.infoContent}>
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

  infoItemWithoutBorder: {
    borderBottomWidth: 0,
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

  infoContent: {
    flex: 1,
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

  copyright: {
    color: '#555',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
  },
});