import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CameraView,
  useCameraPermissions,
} from 'expo-camera';

import {
  router,
} from 'expo-router';

import {
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

const PENDING_TEMPLATE_CAPTURE_KEY =
  'PENDING_TEMPLATE_CAPTURE';

type PendingUniversalCapture = {
  uri: string;

  photoWidth: number;
  photoHeight: number;

  previewWidth: number;
  previewHeight: number;

  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;

  scanMode: 'universal';

  /**
   * مؤقتًا للحفاظ على توافق البيانات
   * حتى نعدّل شاشة المعاينة.
   */
  templateId: 'universal-scan';

  category: 'Unknown';
  subCategory: '';

  capturedAt: number;
};

export default function TemplateCameraScreen() {
  const {
    width: screenWidth,
    height: screenHeight,
  } = useWindowDimensions();

  const cameraRef =
    useRef<CameraView | null>(
      null
    );

  const [
    permission,
    requestPermission,
  ] =
    useCameraPermissions();

  const [
    takingPhoto,
    setTakingPhoto,
  ] = useState(false);

  /**
   * إطار عام كبير مثل Document Scanner.
   *
   * الإطار لا يقص القطعة على شكل معين.
   * وظيفته فقط مساعدة المستخدم على إبقاء
   * القطعة كاملة داخل مساحة التصوير.
   */
  const frame =
    useMemo(() => {
      const horizontalMargin =
        Math.max(
          18,
          screenWidth * 0.055
        );

      const top =
        Math.max(
          150,
          screenHeight * 0.17
        );

      const bottomReserved =
        Math.max(
          190,
          screenHeight * 0.22
        );

      const width =
        screenWidth -
        horizontalMargin * 2;

      const availableHeight =
        screenHeight -
        top -
        bottomReserved;

      return {
        x:
          horizontalMargin,

        y:
          top,

        width,

        height:
          Math.max(
            300,
            availableHeight
          ),
      };
    }, [
      screenHeight,
      screenWidth,
    ]);

  function closeScreen() {
    if (takingPhoto) {
      return;
    }

    router.back();
  }

  async function takePhoto() {
    if (
      takingPhoto ||
      !cameraRef.current
    ) {
      return;
    }

    setTakingPhoto(
      true
    );

    try {
      const photo =
        await cameraRef
          .current
          .takePictureAsync({
            quality:
              1,

            skipProcessing:
              false,
          });

      if (!photo?.uri) {
        throw new Error(
          'The camera did not return a photo.'
        );
      }

      const payload:
        PendingUniversalCapture = {
        uri:
          photo.uri,

        photoWidth:
          photo.width ||
          screenWidth,

        photoHeight:
          photo.height ||
          screenHeight,

        previewWidth:
          screenWidth,

        previewHeight:
          screenHeight,

        frameX:
          frame.x,

        frameY:
          frame.y,

        frameWidth:
          frame.width,

        frameHeight:
          frame.height,

        scanMode:
          'universal',

        templateId:
          'universal-scan',

        category:
          'Unknown',

        subCategory:
          '',

        capturedAt:
          Date.now(),
      };

      await AsyncStorage
        .setItem(
          PENDING_TEMPLATE_CAPTURE_KEY,
          JSON.stringify(
            payload
          )
        );

      router.replace(
        '/template-preview' as any
      );
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not take the photo.';

      Alert.alert(
        'Camera error',
        message
      );

      setTakingPhoto(
        false
      );
    }
  }

  if (!permission) {
    return (
      <View
        style={
          styles.centerContainer
        }
      >
        <ActivityIndicator
          size="large"
          color="#f4dfc8"
        />

        <Text
          style={
            styles.loadingText
          }
        >
          Opening camera...
        </Text>
      </View>
    );
  }

  if (
    !permission.granted
  ) {
    return (
      <View
        style={
          styles.permissionContainer
        }
      >
        <View
          style={
            styles.permissionIcon
          }
        >
          <Text
            style={
              styles.permissionIconText
            }
          >
            📷
          </Text>
        </View>

        <Text
          style={
            styles.permissionTitle
          }
        >
          Camera permission
        </Text>

        <Text
          style={
            styles.permissionText
          }
        >
          Triple N needs camera
          access to scan your
          clothing item and remove
          its background.
        </Text>

        <TouchableOpacity
          style={
            styles.permissionButton
          }
          onPress={() => {
            void requestPermission();
          }}
          activeOpacity={0.85}
        >
          <Text
            style={
              styles.permissionButtonText
            }
          >
            Allow camera
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={
            styles.cancelPermissionButton
          }
          onPress={
            closeScreen
          }
          activeOpacity={0.85}
        >
          <Text
            style={
              styles.cancelPermissionText
            }
          >
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={
        styles.container
      }
    >
      <CameraView
        ref={
          cameraRef
        }
        style={
          styles.camera
        }
        facing="back"
        mode="picture"
      />

      <View
        pointerEvents="none"
        style={
          styles.cameraShade
        }
      />

      <View
        pointerEvents="none"
        style={[
          styles.scanFrame,
          {
            left:
              frame.x,

            top:
              frame.y,

            width:
              frame.width,

            height:
              frame.height,
          },
        ]}
      >
        <View
          style={[
            styles.corner,
            styles.topLeftCorner,
          ]}
        />

        <View
          style={[
            styles.corner,
            styles.topRightCorner,
          ]}
        />

        <View
          style={[
            styles.corner,
            styles.bottomLeftCorner,
          ]}
        />

        <View
          style={[
            styles.corner,
            styles.bottomRightCorner,
          ]}
        />

        <View
          style={
            styles.frameCenter
          }
        >
          <Text
            style={
              styles.frameCenterText
            }
          >
            Keep the complete item
            inside this area
          </Text>
        </View>
      </View>

      <View
        pointerEvents="none"
        style={
          styles.instructionsBox
        }
      >
        <Text
          style={
            styles.instructionsEyebrow
          }
        >
          SCAN ITEM
        </Text>

        <Text
          style={
            styles.instructionsTitle
          }
        >
          Scan any clothing item
        </Text>

        <Text
          style={
            styles.instructionsText
          }
        >
          Lay one item flat on a
          plain contrasting
          background
        </Text>
      </View>

      <View
        style={
          styles.topControls
        }
      >
        <TouchableOpacity
          style={
            styles.closeButton
          }
          onPress={
            closeScreen
          }
          disabled={
            takingPhoto
          }
          activeOpacity={0.85}
        >
          <Text
            style={
              styles.closeButtonText
            }
          >
            ‹
          </Text>
        </TouchableOpacity>

        <View
          style={
            styles.scanBadge
          }
        >
          <View
            style={
              styles.scanBadgeDot
            }
          />

          <Text
            style={
              styles.scanBadgeText
            }
          >
            AUTO SCAN
          </Text>
        </View>

        <TouchableOpacity
          style={
            styles.exitButton
          }
          onPress={
            closeScreen
          }
          disabled={
            takingPhoto
          }
          activeOpacity={0.85}
        >
          <Text
            style={
              styles.exitButtonText
            }
          >
            ×
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={
          styles.bottomControls
        }
      >
        <View
          style={
            styles.tipsContainer
          }
        >
          <View
            style={
              styles.tipItem
            }
          >
            <Text
              style={
                styles.tipIcon
              }
            >
              ✓
            </Text>

            <Text
              style={
                styles.tipText
              }
            >
              One item only
            </Text>
          </View>

          <View
            style={
              styles.tipDivider
            }
          />

          <View
            style={
              styles.tipItem
            }
          >
            <Text
              style={
                styles.tipIcon
              }
            >
              ✓
            </Text>

            <Text
              style={
                styles.tipText
              }
            >
              Leave space around it
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.captureOuter,

            takingPhoto &&
              styles.captureDisabled,
          ]}
          onPress={() => {
            void takePhoto();
          }}
          disabled={
            takingPhoto
          }
          activeOpacity={0.85}
        >
          <View
            style={
              styles.captureInner
            }
          >
            {takingPhoto && (
              <ActivityIndicator
                size="small"
                color="#111"
              />
            )}
          </View>
        </TouchableOpacity>

        <Text
          style={
            styles.captureLabel
          }
        >
          {takingPhoto
            ? 'Taking photo...'
            : 'Scan item'}
        </Text>
      </View>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#000',
    },

    camera: {
      ...StyleSheet
        .absoluteFillObject,
    },

    centerContainer: {
      flex: 1,
      backgroundColor:
        '#07090d',
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal: 30,
    },

    loadingText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '800',
      marginTop: 16,
    },

    permissionContainer: {
      flex: 1,
      backgroundColor:
        '#07090d',
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal: 30,
    },

    permissionIcon: {
      width: 82,
      height: 82,
      borderRadius: 28,
      backgroundColor:
        '#15171c',
      borderWidth: 1,
      borderColor:
        '#292d34',
      alignItems:
        'center',
      justifyContent:
        'center',
      marginBottom: 20,
    },

    permissionIconText: {
      fontSize: 34,
    },

    permissionTitle: {
      color: '#fff',
      fontSize: 26,
      fontWeight: '900',
      textAlign: 'center',
      marginBottom: 12,
    },

    permissionText: {
      color: '#a1a1aa',
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 23,
      textAlign: 'center',
      maxWidth: 330,
      marginBottom: 28,
    },

    permissionButton: {
      width: '100%',
      maxWidth: 330,
      minHeight: 58,
      borderRadius: 30,
      backgroundColor:
        '#f4dfc8',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    permissionButtonText: {
      color: '#111',
      fontSize: 17,
      fontWeight: '900',
    },

    cancelPermissionButton: {
      marginTop: 14,
      paddingHorizontal: 30,
      paddingVertical: 14,
    },

    cancelPermissionText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '800',
    },

    cameraShade: {
      ...StyleSheet
        .absoluteFillObject,
      backgroundColor:
        'rgba(0,0,0,0.12)',
    },

    scanFrame: {
      position: 'absolute',
    },

    corner: {
      position: 'absolute',
      width: 54,
      height: 54,
      borderColor:
        '#f4dfc8',
    },

    topLeftCorner: {
      top: 0,
      left: 0,
      borderTopWidth: 5,
      borderLeftWidth: 5,
      borderTopLeftRadius: 22,
    },

    topRightCorner: {
      top: 0,
      right: 0,
      borderTopWidth: 5,
      borderRightWidth: 5,
      borderTopRightRadius: 22,
    },

    bottomLeftCorner: {
      bottom: 0,
      left: 0,
      borderBottomWidth: 5,
      borderLeftWidth: 5,
      borderBottomLeftRadius: 22,
    },

    bottomRightCorner: {
      right: 0,
      bottom: 0,
      borderRightWidth: 5,
      borderBottomWidth: 5,
      borderBottomRightRadius: 22,
    },

    frameCenter: {
      position: 'absolute',
      left: 20,
      right: 20,
      top: '47%',
      alignItems:
        'center',
    },

    frameCenterText: {
      color:
        'rgba(255,255,255,0.94)',
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
      backgroundColor:
        'rgba(7,9,13,0.62)',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      overflow: 'hidden',
      textShadowColor:
        'rgba(0,0,0,0.8)',
      textShadowOffset: {
        width: 0,
        height: 1,
      },
      textShadowRadius: 3,
    },

    instructionsBox: {
      position: 'absolute',
      top: 114,
      left: 30,
      right: 30,
      alignItems:
        'center',
    },

    instructionsEyebrow: {
      color: '#f4dfc8',
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 2,
      textShadowColor:
        'rgba(0,0,0,0.9)',
      textShadowOffset: {
        width: 0,
        height: 1,
      },
      textShadowRadius: 4,
    },

    instructionsTitle: {
      color: '#fff',
      fontSize: 22,
      fontWeight: '900',
      textAlign: 'center',
      marginTop: 4,
      textShadowColor:
        'rgba(0,0,0,0.9)',
      textShadowOffset: {
        width: 0,
        height: 2,
      },
      textShadowRadius: 5,
    },

    instructionsText: {
      color:
        'rgba(255,255,255,0.9)',
      fontSize: 13,
      fontWeight: '800',
      textAlign: 'center',
      marginTop: 5,
      textShadowColor:
        'rgba(0,0,0,0.9)',
      textShadowOffset: {
        width: 0,
        height: 1,
      },
      textShadowRadius: 4,
    },

    topControls: {
      position: 'absolute',
      top: 55,
      left: 20,
      right: 20,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
    },

    closeButton: {
      width: 48,
      height: 48,
      borderRadius: 18,
      backgroundColor:
        'rgba(7,9,13,0.72)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.22)',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    closeButtonText: {
      color: '#fff',
      fontSize: 42,
      lineHeight: 45,
      marginTop: -5,
    },

    exitButton: {
      width: 48,
      height: 48,
      borderRadius: 18,
      backgroundColor:
        'rgba(7,9,13,0.72)',
      borderWidth: 1,
      borderColor:
        'rgba(255,255,255,0.22)',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    exitButtonText: {
      color: '#fff',
      fontSize: 34,
      lineHeight: 37,
      marginTop: -3,
    },

    scanBadge: {
      minHeight: 38,
      borderRadius: 20,
      paddingHorizontal: 16,
      backgroundColor:
        'rgba(7,9,13,0.72)',
      borderWidth: 1,
      borderColor:
        'rgba(244,223,200,0.65)',
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 7,
    },

    scanBadgeDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor:
        '#f4dfc8',
    },

    scanBadgeText: {
      color: '#f4dfc8',
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.4,
    },

    bottomControls: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: 30,
      alignItems:
        'center',
    },

    tipsContainer: {
      minHeight: 38,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        'rgba(7,9,13,0.7)',
      borderRadius: 20,
      paddingHorizontal: 14,
      marginBottom: 16,
    },

    tipItem: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 5,
    },

    tipIcon: {
      color: '#f4dfc8',
      fontSize: 11,
      fontWeight: '900',
    },

    tipText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '800',
    },

    tipDivider: {
      width: 1,
      height: 16,
      backgroundColor:
        'rgba(255,255,255,0.28)',
      marginHorizontal: 10,
    },

    captureOuter: {
      width: 88,
      height: 88,
      borderRadius: 44,
      borderWidth: 5,
      borderColor: '#fff',
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        'rgba(255,255,255,0.16)',
    },

    captureInner: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor:
        '#f4dfc8',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    captureDisabled: {
      opacity: 0.55,
    },

    captureLabel: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '900',
      marginTop: 9,
      textShadowColor:
        'rgba(0,0,0,0.9)',
      textShadowOffset: {
        width: 0,
        height: 1,
      },
      textShadowRadius: 4,
    },
  });