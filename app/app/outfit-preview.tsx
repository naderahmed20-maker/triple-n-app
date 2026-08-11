import { useTranslation } from '@/lib/i18n';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  captureRef,
} from 'react-native-view-shot';
import OutfitCanvas from '../../components/triple-n/OutfitCanvas';
type WardrobeItem = {
  image: string;
  category: string;
  name?: string;
  color?: string;
};
type StoredPreviewOutfit = {
  top:
    | WardrobeItem
    | null;
  pants:
    | WardrobeItem
    | null;
  bottom?:
    | WardrobeItem
    | null;
  shoes:
    | WardrobeItem
    | null;
  /**
   * موجود فقط لاستقبال بيانات المعاينة القديمة.
   * لا يتم عرضه داخل أي Outfit في Summer V1.
   */
  jacket?:
    | WardrobeItem
    | null;
  bag?:
    | WardrobeItem
    | null;
  cap?:
    | WardrobeItem
    | null;
  watch?:
    | WardrobeItem
    | null;
  accessory?:
    | WardrobeItem
    | null;
};
type PreviewOutfit = {
  top:
    | WardrobeItem
    | null;
  pants:
    | WardrobeItem
    | null;
  bottom?:
    | WardrobeItem
    | null;
  shoes:
    | WardrobeItem
    | null;
  bag?:
    | WardrobeItem
    | null;
  cap?:
    | WardrobeItem
    | null;
  watch?:
    | WardrobeItem
    | null;
  accessory?:
    | WardrobeItem
    | null;
};
export default function OutfitPreviewScreen() {
  const { t } =
    useTranslation();
  const [
    outfit,
    setOutfit,
  ] =
    useState<PreviewOutfit | null>(
      null
    );
  const [
    loading,
    setLoading,
  ] =
    useState(true);
  const [
    exporting,
    setExporting,
  ] =
    useState(false);
  const previewRef =
    useRef<View | null>(
      null
    );
  useEffect(() => {
    let active = true;
    async function loadOutfit() {
      try {
        const [
          savedOutfit,
          savedImage,
        ] =
          await Promise.all([
            AsyncStorage.getItem(
              'previewOutfit'
            ),
            AsyncStorage.getItem(
              'previewImage'
            ),
          ]);
        if (!active) {
          return;
        }
        if (savedOutfit) {
          const parsedOutfit =
            JSON.parse(
              savedOutfit
            ) as StoredPreviewOutfit;
          /**
           * ننشئ نسخة نظيفة للمعاينة.
           * لا ننقل jacket حتى لو كان موجودًا
           * داخل بيانات قديمة محفوظة.
           */
          const previewOutfit:
            PreviewOutfit = {
              top:
                parsedOutfit.top ||
                null,
              pants:
                parsedOutfit.pants ||
                null,
              bottom:
                parsedOutfit.bottom ||
                null,
              shoes:
                parsedOutfit.shoes ||
                null,
              bag:
                parsedOutfit.bag ||
                null,
              cap:
                parsedOutfit.cap ||
                null,
              watch:
                parsedOutfit.watch ||
                null,
              accessory:
                parsedOutfit.accessory ||
                null,
            };
          setOutfit(
            previewOutfit
          );
          return;
        }
        if (savedImage) {
          setOutfit({
            top: {
              image:
                savedImage,
              category:
                'Preview',
            },
            pants:
              null,
            bottom:
              null,
            shoes:
              null,
            bag:
              null,
            cap:
              null,
            watch:
              null,
            accessory:
              null,
          });
          return;
        }
        setOutfit(
          null
        );
      } catch (
        error
      ) {
        console.error(
          'PREVIEW LOAD ERROR:',
          error
        );
        if (active) {
          Alert.alert(
            t(
              'preview.unavailable'
            ),
            t(
              'preview.loadFailed'
            )
          );
        }
      } finally {
        if (active) {
          setLoading(
            false
          );
        }
      }
    }
    void loadOutfit();
    return () => {
      active = false;
    };
  }, [t]);
  async function captureOutfit() {
    if (
      !previewRef.current
    ) {
      throw new Error(
        t(
          'preview.notReady'
        )
      );
    }
    return captureRef(
      previewRef.current,
      {
        format:
          'png',
        quality:
          1,
        result:
          'tmpfile',
      }
    );
  }
  async function shareImage() {
    if (exporting) {
      return;
    }
    setExporting(
      true
    );
    try {
      const sharingAvailable =
        await Sharing.isAvailableAsync();
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
        await captureOutfit();
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
      setExporting(
        false
      );
    }
  }
  async function downloadImage() {
    if (exporting) {
      return;
    }
    setExporting(
      true
    );
    try {
      const permission =
        await MediaLibrary
          .requestPermissionsAsync();
      if (
        !permission.granted
      ) {
        Alert.alert(
          t(
            'permission.required'
          ),
          t(
            'preview.permissionMessage'
          )
        );
        return;
      }
      const imageUri =
        await captureOutfit();
      await MediaLibrary
        .saveToLibraryAsync(
          imageUri
        );
      Alert.alert(
        t(
          'preview.savedTitle'
        ),
        t(
          'preview.savedMessage'
        )
      );
    } catch (
      error
    ) {
      console.error(
        'OUTFIT DOWNLOAD ERROR:',
        error
      );
      Alert.alert(
        t(
          'preview.couldNotSave'
        ),
        t(
          'details.tryAgainMoment'
        )
      );
    } finally {
      setExporting(
        false
      );
    }
  }
  if (loading) {
    return (
      <SafeAreaView
        style={
          styles.container
        }
      >
        <View
          style={
            styles.loadingBox
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
              'common.loading'
            )}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!outfit) {
    return (
      <SafeAreaView
        style={
          styles.container
        }
      >
        <Text
          style={
            styles.title
          }
        >
          {t(
            'preview.title'
          )}
        </Text>
        <View
          style={
            styles.emptyBox
          }
        >
          <Text
            style={
              styles.emptyText
            }
          >
            {t(
              'preview.noOutfit'
            )}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  const bottom =
    outfit.pants ||
    outfit.bottom ||
    null;
  return (
    <SafeAreaView
      style={
        styles.container
      }
    >
      <Text
        style={
          styles.title
        }
      >
        {t(
          'preview.title'
        )}
      </Text>
      <View
        ref={
          previewRef
        }
        collapsable={
          false
        }
        style={
          styles.previewCard
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
             * الجاكيت يظل داخل الدولاب فقط.
             * لا يظهر في أي Outfit.
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
        <View
          style={
            styles.brandBox
          }
        >
          <Text
            style={
              styles.brandTitle
            }
          >
            TRIPLE N
          </Text>
          <Text
            style={
              styles.brandSubtitle
            }
          >
            AI FASHION ASSISTANT
          </Text>
        </View>
      </View>
      <View
        style={
          styles.actions
        }
      >
        <TouchableOpacity
          style={[
            styles.actionButton,
            exporting &&
              styles.disabledButton,
          ]}
          onPress={
            shareImage
          }
          disabled={
            exporting
          }
          activeOpacity={
            0.8
          }
          accessibilityLabel={t(
            'common.share'
          )}
        >
          {exporting ? (
            <ActivityIndicator
              size="small"
              color="white"
            />
          ) : (
            <Feather
              name="share"
              size={24}
              color="white"
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            exporting &&
              styles.disabledButton,
          ]}
          onPress={
            downloadImage
          }
          disabled={
            exporting
          }
          activeOpacity={
            0.8
          }
          accessibilityLabel={t(
            'common.download'
          )}
        >
          {exporting ? (
            <ActivityIndicator
              size="small"
              color="white"
            />
          ) : (
            <Feather
              name="download"
              size={24}
              color="white"
            />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#050505',
      paddingHorizontal:
        22,
    },
    title: {
      color:
        'white',
      fontSize:
        34,
      fontWeight:
        '900',
      textAlign:
        'center',
      marginTop:
        32,
      marginBottom:
        18,
    },
    loadingBox: {
      flex: 1,
      alignItems:
        'center',
      justifyContent:
        'center',
    },
    loadingText: {
      color:
        '#aaa',
      fontSize:
        15,
      fontWeight:
        '700',
      marginTop:
        14,
    },
    previewCard: {
      flex: 1,
      backgroundColor:
        '#f4f1eb',
      borderRadius:
        42,
      marginBottom:
        24,
      padding:
        20,
      justifyContent:
        'center',
      alignItems:
        'center',
      overflow:
        'hidden',
      position:
        'relative',
    },
    brandBox: {
      position:
        'absolute',
      bottom:
        18,
      alignItems:
        'center',
    },
    brandTitle: {
      color:
        '#17191d',
      fontSize:
        14,
      fontWeight:
        '900',
      letterSpacing:
        3,
    },
    brandSubtitle: {
      color:
        '#555',
      fontSize:
        7,
      fontWeight:
        '800',
      letterSpacing:
        1.4,
      marginTop:
        2,
    },
    actions: {
      flexDirection:
        'row',
      justifyContent:
        'center',
      gap:
        22,
      paddingBottom:
        28,
    },
    actionButton: {
      width:
        68,
      height:
        68,
      borderRadius:
        34,
      backgroundColor:
        '#191919',
      alignItems:
        'center',
      justifyContent:
        'center',
      borderWidth:
        1,
      borderColor:
        '#292929',
    },
    disabledButton: {
      opacity:
        0.5,
    },
    emptyBox: {
      flex: 1,
      alignItems:
        'center',
      justifyContent:
        'center',
    },
    emptyText: {
      color:
        '#aaa',
      fontSize:
        18,
      fontWeight:
        '800',
    },
  });