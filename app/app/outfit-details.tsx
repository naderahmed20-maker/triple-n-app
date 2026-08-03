import { useTranslation } from '@/lib/i18n';

import {
  type SavedOutfit,
  deleteOutfit as deleteOutfitFromService,
  getSavedOutfitById,
  updateOutfitFavorite,
} from '@/lib/outfitService';

import { Ionicons } from '@expo/vector-icons';

import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import * as Sharing from 'expo-sharing';

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  captureRef,
} from 'react-native-view-shot';

import OutfitCanvas from './components/OutfitCanvas';

type DetailedSavedOutfit =
  SavedOutfit & {
    aiScore?: number;
    weatherScore?: number;
    styleScore?: number;
    explanation?: string[];
  };

export default function OutfitDetailsScreen() {
  const {
    t,
    language,
  } = useTranslation();

  const { id } =
    useLocalSearchParams<{
      id?:
        | string
        | string[];
    }>();

  const outfitId =
    Array.isArray(id)
      ? id[0]
      : id;

  const previewRef =
    useRef<View | null>(
      null
    );

  const [
    outfit,
    setOutfit,
  ] =
    useState<DetailedSavedOutfit | null>(
      null
    );

  const [
    rowFavorite,
    setRowFavorite,
  ] =
    useState(false);

  const [
    createdAt,
    setCreatedAt,
  ] =
    useState<string | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    deleting,
    setDeleting,
  ] =
    useState(false);

  const [
    sharing,
    setSharing,
  ] =
    useState(false);

  useEffect(() => {
    let active = true;

    async function loadOutfit() {
      if (!outfitId) {
        setLoading(false);

        return;
      }

      try {
        const row =
          await getSavedOutfitById(
            outfitId
          );

        if (!active) {
          return;
        }

        setOutfit(
          row.outfit as
            DetailedSavedOutfit
        );

        setRowFavorite(
          Boolean(
            row.favorite
          )
        );

        setCreatedAt(
          row.created_at
        );
      } catch (
        error: any
      ) {
        if (!active) {
          return;
        }

        Alert.alert(
          t('common.error'),
          error?.message ||
            t(
              'details.loadFailed'
            )
        );

        router.back();
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadOutfit();

    return () => {
      active = false;
    };
  }, [
    outfitId,
    t,
  ]);

  function formatSavedDate(
    value?:
      | string
      | number
      | null
  ) {
    if (!value) {
      return '';
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '';
    }

    return date.toLocaleDateString(
      language === 'Italian'
        ? 'it-IT'
        : 'en-US'
    );
  }

  function showTryOnComingSoon() {
    Alert.alert(
      t(
        'details.tryOnTitle'
      ),
      t(
        'details.tryOnMessage'
      ),
      [
        {
          text: t(
            'details.gotIt'
          ),
        },
      ]
    );
  }

  async function toggleFavorite() {
    if (!outfitId) {
      return;
    }

    const newFavorite =
      !rowFavorite;

    try {
      await updateOutfitFavorite(
        outfitId,
        newFavorite
      );

      setRowFavorite(
        newFavorite
      );
    } catch (
      error: any
    ) {
      Alert.alert(
        t('common.error'),
        error?.message ||
          t(
            'details.favoriteFailed'
          )
      );
    }
  }

  async function performDelete() {
    if (
      !outfitId ||
      deleting
    ) {
      return;
    }

    setDeleting(true);

    try {
      await deleteOutfitFromService(
        outfitId
      );

      router.back();
    } catch (
      error: any
    ) {
      Alert.alert(
        t('common.error'),
        error?.message ||
          t(
            'details.deleteFailed'
          )
      );

      setDeleting(false);
    }
  }

  function deleteOutfit() {
    Alert.alert(
      t(
        'details.deleteTitle'
      ),
      t(
        'details.deleteQuestion'
      ),
      [
        {
          text: t(
            'common.cancel'
          ),
          style: 'cancel',
        },
        {
          text: t(
            'common.delete'
          ),
          style:
            'destructive',
          onPress:
            performDelete,
        },
      ]
    );
  }

  async function shareOutfit() {
    if (
      !outfit ||
      sharing
    ) {
      return;
    }

    setSharing(true);

    try {
      if (
        !previewRef.current
      ) {
        throw new Error(
          t(
            'details.previewNotReady'
          )
        );
      }

      const sharingAvailable =
        await Sharing
          .isAvailableAsync();

      if (
        !sharingAvailable
      ) {
        Alert.alert(
          t(
            'details.shareUnavailable'
          ),
          t(
            'details.shareUnavailableMessage'
          )
        );

        return;
      }

      const imageUri =
        await captureRef(
          previewRef.current,
          {
            format: 'png',
            quality: 1,
            result:
              'tmpfile',
          }
        );

      await Sharing.shareAsync(
        imageUri,
        {
          mimeType:
            'image/png',
          dialogTitle:
            'Triple N',
        }
      );
    } catch (
      error
    ) {
      console.error(
        'OUTFIT SHARE ERROR:',
        error
      );

      Alert.alert(
        t(
          'details.couldNotShare'
        ),
        t(
          'details.tryAgainMoment'
        )
      );
    } finally {
      setSharing(false);
    }
  }

  if (loading) {
    return (
      <View
        style={
          styles.loadingContainer
        }
      >
        <ActivityIndicator
          size="large"
          color="#f1d8c2"
        />

        <Text
          style={
            styles.loadingText
          }
        >
          {t(
            'details.loading'
          )}
        </Text>
      </View>
    );
  }

  if (!outfit) {
    return (
      <View
        style={
          styles.emptyContainer
        }
      >
        <Text
          style={
            styles.title
          }
        >
          {t(
            'details.notFound'
          )}
        </Text>
      </View>
    );
  }

  const bottom =
    outfit.pants ||
    outfit.bottom ||
    null;

  const matchScore =
    outfit.score ||
    outfit.aiScore ||
    0;

  const colorScore =
    outfit.colorScore ||
    0;

  const styleScore =
    outfit.styleScore ||
    0;

  const weatherScore =
    outfit.weatherScore ||
    0;

  const explanation =
    outfit.explanation ||
    [];

  const savedDate =
    formatSavedDate(
      createdAt ||
        outfit.createdAt ||
        null
    );

  return (
    <ScrollView
      style={
        styles.container
      }
      contentContainerStyle={
        styles.content
      }
      showsVerticalScrollIndicator={
        false
      }
    >
      <View
        style={
          styles.header
        }
      >
        <TouchableOpacity
          style={
            styles.backIcon
          }
          onPress={() =>
            router.back()
          }
        >
          <Ionicons
            name="chevron-back"
            size={28}
            color="white"
          />
        </TouchableOpacity>

        <View
          style={
            styles.headerText
          }
        >
          <Text
            style={
              styles.title
            }
          >
            {t(
              'details.title'
            )}
          </Text>

          {savedDate ? (
            <Text
              style={
                styles.date
              }
            >
              {savedDate}
            </Text>
          ) : null}
        </View>
      </View>

      <View
        style={
          styles.tagsRow
        }
      >
        {outfit.occasion && (
          <Text
            style={
              styles.tagChip
            }
          >
            🎯{' '}
            {outfit.occasion}
          </Text>
        )}

        {outfit.weather && (
          <Text
            style={
              styles.tagChip
            }
          >
            ☀️{' '}
            {outfit.weather}
          </Text>
        )}
      </View>

      <View
        style={
          styles.mainScoreCard
        }
      >
        <Text
          style={
            styles.mainScoreValue
          }
        >
          {matchScore}%
        </Text>

        <Text
          style={
            styles.mainScoreLabel
          }
        >
          {t(
            'details.match'
          )}
        </Text>
      </View>

      <View
        style={
          styles.scoreGrid
        }
      >
        <ScoreCard
          emoji="🎨"
          value={
            colorScore
          }
          label={t(
            'outfit.colors'
          )}
        />

        <ScoreCard
          emoji="✨"
          value={
            styleScore
          }
          label={t(
            'outfit.style'
          )}
        />

        <ScoreCard
          emoji="☀️"
          value={
            weatherScore
          }
          label={t(
            'outfit.weather'
          )}
        />
      </View>

      <View
        ref={previewRef}
        collapsable={false}
        style={
          styles.preview
        }
      >
        <View
          style={
            styles.previewCanvasBox
          }
        >
          <OutfitCanvas
            outfit={{
              top:
                outfit.top,

              bottom,

              shoes:
                outfit.shoes,

              /**
               * Summer V1:
               * لا يتم عرض الجاكيت،
               * حتى داخل الأطقم القديمة.
               */
              jacket:
                null,

              bag:
                outfit.bag ||
                null,

              cap:
                outfit.cap ||
                null,

              watch:
                outfit.watch ||
                null,

              accessory:
                outfit.accessory ||
                null,
            }}
            variant="details"
          />
        </View>

        <View
          style={
            styles.previewBrand
          }
        >
          <Text
            style={
              styles.previewBrandText
            }
          >
            TRIPLE N
          </Text>

          <Text
            style={
              styles.previewBrandSubtitle
            }
          >
            AI FASHION ASSISTANT
          </Text>
        </View>
      </View>

      <View
        style={
          styles.actionsRow
        }
      >
        <TouchableOpacity
          style={[
            styles.actionButton,

            rowFavorite &&
              styles.activeActionButton,
          ]}
          onPress={
            toggleFavorite
          }
        >
          <Ionicons
            name={
              rowFavorite
                ? 'heart'
                : 'heart-outline'
            }
            size={24}
            color={
              rowFavorite
                ? '#111'
                : 'white'
            }
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={
            styles.actionButton
          }
          onPress={
            showTryOnComingSoon
          }
        >
          <Ionicons
            name="eye-outline"
            size={24}
            color="white"
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionButton,

            sharing &&
              styles.disabledActionButton,
          ]}
          onPress={
            shareOutfit
          }
          disabled={
            sharing
          }
        >
          {sharing ? (
            <ActivityIndicator
              size="small"
              color="white"
            />
          ) : (
            <Ionicons
              name="share-outline"
              size={24}
              color="white"
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionButton,

            deleting &&
              styles.disabledActionButton,
          ]}
          onPress={
            deleteOutfit
          }
          disabled={
            deleting
          }
        >
          {deleting ? (
            <ActivityIndicator
              size="small"
              color="#ff5c5c"
            />
          ) : (
            <Ionicons
              name="trash-outline"
              size={24}
              color="#ff5c5c"
            />
          )}
        </TouchableOpacity>
      </View>

      <View
        style={
          styles.aiCard
        }
      >
        <Text
          style={
            styles.aiTitle
          }
        >
          {t(
            'details.aiInsight'
          )}
        </Text>

        {explanation.length >
        0 ? (
          explanation
            .slice(
              0,
              5
            )
            .map(
              (
                reason,
                index
              ) => (
                <Text
                  key={`${reason}-${index}`}
                  style={
                    styles.aiText
                  }
                >
                  • {reason}
                </Text>
              )
            )
        ) : (
          <>
            <Text
              style={
                styles.aiText
              }
            >
              •{' '}
              {t(
                'details.defaultInsightOne'
              )}
            </Text>

            <Text
              style={
                styles.aiText
              }
            >
              •{' '}
              {t(
                'details.defaultInsightTwo'
              )}
            </Text>

            <Text
              style={
                styles.aiText
              }
            >
              •{' '}
              {t(
                'details.defaultInsightThree'
              )}
            </Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function ScoreCard({
  emoji,
  value,
  label,
}: {
  emoji: string;
  value: number;
  label: string;
}) {
  return (
    <View
      style={
        styles.scoreCard
      }
    >
      <Text
        style={
          styles.scoreEmoji
        }
      >
        {emoji}
      </Text>

      <Text
        style={
          styles.scoreValue
        }
      >
        {value}%
      </Text>

      <Text
        style={
          styles.scoreLabel
        }
      >
        {label}
      </Text>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#07090d',
    },

    loadingContainer: {
      flex: 1,
      backgroundColor:
        '#07090d',
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    loadingText: {
      color: '#aaa',
      fontSize: 14,
      fontWeight:
        '700',
      marginTop: 14,
    },

    emptyContainer: {
      flex: 1,
      backgroundColor:
        '#07090d',
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    content: {
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 45,
    },

    header: {
      flexDirection:
        'row',
      alignItems:
        'center',
      marginBottom: 18,
    },

    headerText: {
      flex: 1,
    },

    backIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor:
        '#17191d',
      justifyContent:
        'center',
      alignItems:
        'center',
      marginRight: 14,
    },

    title: {
      color: 'white',
      fontSize: 30,
      fontWeight:
        '900',
    },

    date: {
      color: '#8f9299',
      fontSize: 15,
      fontWeight:
        '800',
      marginTop: 4,
    },

    tagsRow: {
      flexDirection:
        'row',
      flexWrap:
        'wrap',
      gap: 8,
      marginBottom: 16,
    },

    tagChip: {
      color: '#facc15',
      backgroundColor:
        '#17191d',
      borderWidth: 1,
      borderColor:
        '#2a2d33',
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 18,
      fontSize: 13,
      fontWeight:
        '900',
    },

    mainScoreCard: {
      backgroundColor:
        '#17191d',
      borderRadius: 24,
      borderWidth: 1,
      borderColor:
        '#2a2d33',
      alignItems:
        'center',
      paddingVertical: 16,
      marginBottom: 12,
    },

    mainScoreValue: {
      color: '#f59e0b',
      fontSize: 32,
      fontWeight:
        '900',
    },

    mainScoreLabel: {
      color: '#999',
      fontSize: 12,
      fontWeight:
        '800',
      marginTop: 3,
    },

    scoreGrid: {
      flexDirection:
        'row',
      flexWrap:
        'wrap',
      justifyContent:
        'space-between',
      marginBottom: 18,
    },

    scoreCard: {
      width: '48%',
      backgroundColor:
        '#17191d',
      borderRadius: 20,
      borderWidth: 1,
      borderColor:
        '#2a2d33',
      alignItems:
        'center',
      paddingVertical: 12,
      marginBottom: 10,
    },

    scoreEmoji: {
      fontSize: 18,
    },

    scoreValue: {
      color: 'white',
      fontSize: 20,
      fontWeight:
        '900',
      marginTop: 3,
    },

    scoreLabel: {
      color: '#888',
      fontSize: 10,
      fontWeight:
        '800',
      marginTop: 2,
    },

    preview: {
      height: 500,
      backgroundColor:
        '#f4efe6',
      borderRadius: 34,
      borderWidth: 1.5,
      borderColor:
        '#2a2d33',
      overflow:
        'hidden',
      justifyContent:
        'center',
      alignItems:
        'center',
      marginTop: 4,
      position:
        'relative',
    },

    previewCanvasBox: {
      transform: [
        {
          scale: 1.08,
        },
      ],
    },

    previewBrand: {
      position:
        'absolute',
      bottom: 18,
      alignItems:
        'center',
    },

    previewBrandText: {
      color: '#17191d',
      fontSize: 14,
      fontWeight:
        '900',
      letterSpacing: 3,
    },

    previewBrandSubtitle: {
      color: '#555',
      fontSize: 7,
      fontWeight:
        '800',
      letterSpacing: 1.4,
      marginTop: 2,
    },

    actionsRow: {
      flexDirection:
        'row',
      justifyContent:
        'space-evenly',
      marginVertical: 24,
    },

    actionButton: {
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor:
        '#17191d',
      borderWidth: 1,
      borderColor:
        '#2a2d33',
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    activeActionButton: {
      backgroundColor:
        '#f4dfc8',
      borderColor:
        '#f4dfc8',
    },

    disabledActionButton: {
      opacity: 0.55,
    },

    aiCard: {
      backgroundColor:
        '#17191d',
      borderRadius: 26,
      padding: 22,
      borderWidth: 1,
      borderColor:
        '#2a2d33',
      marginBottom: 35,
    },

    aiTitle: {
      color: 'white',
      fontSize: 22,
      fontWeight:
        '900',
      marginBottom: 12,
    },

    aiText: {
      color: '#9ca3af',
      lineHeight: 23,
      fontSize: 14,
      fontWeight:
        '700',
      marginBottom: 5,
    },
  });