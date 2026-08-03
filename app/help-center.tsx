import {
  useTranslation,
} from '@/lib/i18n';

import {
  Feather,
} from '@expo/vector-icons';

import {
  router,
} from 'expo-router';

import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type HelpItemProps = {
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
  isLast?: boolean;
};

export default function HelpCenterScreen() {
  const {
    t,
  } = useTranslation();

  function show(
    title: string,
    message: string
  ) {
    Alert.alert(
      title,
      message
    );
  }

  async function openLink(
    url: string
  ) {
    try {
      const supported =
        await Linking.canOpenURL(
          url
        );

      if (!supported) {
        Alert.alert(
          t(
            'helpCenter.linkErrorTitle'
          ),
          t(
            'helpCenter.linkErrorMessage'
          )
        );

        return;
      }

      await Linking.openURL(
        url
      );
    } catch (
      error
    ) {
      console.log(
        'HELP CENTER LINK ERROR:',
        error
      );

      Alert.alert(
        t(
          'helpCenter.linkErrorTitle'
        ),
        t(
          'helpCenter.linkErrorMessage'
        )
      );
    }
  }

  function openSupportEmail() {
    const subject =
      encodeURIComponent(
        t(
          'helpCenter.supportEmailSubject'
        )
      );

    void openLink(
      `mailto:support@triplen.ai?subject=${subject}`
    );
  }

  function openBugEmail() {
    const subject =
      encodeURIComponent(
        t(
          'helpCenter.bugEmailSubject'
        )
      );

    void openLink(
      `mailto:bugs@triplen.ai?subject=${subject}`
    );
  }

  return (
    <ScrollView
      style={
        styles.container
      }
      showsVerticalScrollIndicator={
        false
      }
      contentContainerStyle={
        styles.scrollContent
      }
    >
      <View
        style={
          styles.content
        }
      >
        <TouchableOpacity
          style={
            styles.backIcon
          }
          onPress={() =>
            router.back()
          }
          activeOpacity={
            0.8
          }
        >
          <Feather
            name="chevron-left"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <Text
          style={
            styles.title
          }
        >
          {t(
            'helpCenter.title'
          )}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          {t(
            'helpCenter.subtitle'
          )}
        </Text>

        <View
          style={
            styles.card
          }
        >
          <HelpItem
            icon="image"
            title={t(
              'helpCenter.addClothesTitle'
            )}
            subtitle={t(
              'helpCenter.addClothesSubtitle'
            )}
            onPress={() =>
              show(
                t(
                  'helpCenter.addClothesTitle'
                ),
                t(
                  'helpCenter.addClothesMessage'
                )
              )
            }
          />

          <HelpItem
            icon="cpu"
            title={t(
              'helpCenter.aiTitle'
            )}
            subtitle={t(
              'helpCenter.aiSubtitle'
            )}
            onPress={() =>
              show(
                t(
                  'helpCenter.aiAlertTitle'
                ),
                t(
                  'helpCenter.aiMessage'
                )
              )
            }
          />

          <HelpItem
            icon="heart"
            title={t(
              'helpCenter.favoritesTitle'
            )}
            subtitle={t(
              'helpCenter.favoritesSubtitle'
            )}
            onPress={() =>
              show(
                t(
                  'helpCenter.favoritesTitle'
                ),
                t(
                  'helpCenter.favoritesMessage'
                )
              )
            }
          />

          <HelpItem
            icon="help-circle"
            title={t(
              'helpCenter.faqTitle'
            )}
            subtitle={t(
              'helpCenter.faqSubtitle'
            )}
            onPress={() =>
              void openLink(
                'https://triplen.ai/faq'
              )
            }
          />

          <HelpItem
            icon="mail"
            title={t(
              'helpCenter.supportTitle'
            )}
            subtitle="support@triplen.ai"
            onPress={
              openSupportEmail
            }
          />

          <HelpItem
            icon="alert-circle"
            title={t(
              'helpCenter.reportBugTitle'
            )}
            subtitle={t(
              'helpCenter.reportBugSubtitle'
            )}
            onPress={
              openBugEmail
            }
          />

          <HelpItem
            icon="shield"
            title={t(
              'helpCenter.privacyTitle'
            )}
            subtitle={t(
              'helpCenter.privacySubtitle'
            )}
            onPress={() =>
              void openLink(
                'https://triplen.ai/privacy'
              )
            }
          />

          <HelpItem
            icon="file-text"
            title={t(
              'helpCenter.termsTitle'
            )}
            subtitle={t(
              'helpCenter.termsSubtitle'
            )}
            onPress={() =>
              void openLink(
                'https://triplen.ai/terms'
              )
            }
            isLast
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
  isLast = false,
}: HelpItemProps) {
  return (
    <TouchableOpacity
      style={[
        styles.item,

        isLast &&
          styles.lastItem,
      ]}
      onPress={
        onPress
      }
      activeOpacity={
        0.75
      }
    >
      <View
        style={
          styles.left
        }
      >
        <View
          style={
            styles.iconBox
          }
        >
          <Feather
            name={icon}
            size={20}
            color="#f1d8c2"
          />
        </View>

        <View
          style={
            styles.textBox
          }
        >
          <Text
            style={
              styles.itemTitle
            }
          >
            {title}
          </Text>

          <Text
            style={
              styles.itemSubtitle
            }
          >
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

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#07090d',
    },

    scrollContent: {
      flexGrow: 1,
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
      backgroundColor:
        '#17191d',
      justifyContent:
        'center',
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
      backgroundColor:
        '#111318',
      borderRadius: 26,
      borderWidth: 1,
      borderColor:
        '#22252b',
      overflow: 'hidden',
    },

    item: {
      minHeight: 78,
      paddingHorizontal: 18,
      paddingVertical: 15,
      borderBottomWidth: 1,
      borderBottomColor:
        '#22252b',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
    },

    lastItem: {
      borderBottomWidth: 0,
    },

    left: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      paddingRight: 10,
    },

    iconBox: {
      width: 42,
      height: 42,
      borderRadius: 16,
      backgroundColor:
        '#1b1e24',
      justifyContent:
        'center',
      alignItems: 'center',
      marginRight: 14,
    },

    textBox: {
      flex: 1,
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
      lineHeight: 17,
    },
  });