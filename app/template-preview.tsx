// app/template-preview.tsx

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as ImageManipulator from 'expo-image-manipulator';

import {
  router,
} from 'expo-router';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

/* =========================================================
 * Storage keys
 * ======================================================= */

const PENDING_TEMPLATE_CAPTURE_KEY =
  'PENDING_TEMPLATE_CAPTURE';

const CAPTURED_TEMPLATE_IMAGE_KEY =
  'CAPTURED_TEMPLATE_IMAGE';

/* =========================================================
 * Image settings
 * ======================================================= */

/**
 * المقاس الأقصى للصورة الخارجة من شاشة
 * المعاينة.
 *
 * لا نجبر الصورة على مربع، بل نحافظ على
 * أبعاد إطار الكاميرا الأصلية.
 */
const MAX_OUTPUT_SIDE =
  1280;

/* =========================================================
 * Types
 * ======================================================= */

type PendingUniversalCapture = {
  uri:
    string;

  photoWidth:
    number;

  photoHeight:
    number;

  previewWidth:
    number;

  previewHeight:
    number;

  frameX:
    number;

  frameY:
    number;

  frameWidth:
    number;

  frameHeight:
    number;

  scanMode?:
    'universal';

  templateId?:
    string;

  category?:
    string;

  subCategory?:
    string;

  capturedAt:
    number;
};

type PreparedCapture = {
  croppedUri:
    string;

  sourceUri:
    string;

  width:
    number;

  height:
    number;

  templateId:
    string;

  category:
    string;

  subCategory:
    string;

  capturedAt:
    number;
};

/* =========================================================
 * Helpers
 * ======================================================= */

function clamp(
  value:
    number,
  minimum:
    number,
  maximum:
    number
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function isFinitePositiveNumber(
  value:
    unknown
): value is number {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    ) &&
    value > 0
  );
}

function validatePendingCapture(
  value:
    unknown
): PendingUniversalCapture {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    throw new Error(
      'The captured photo information is invalid.'
    );
  }

  const capture =
    value as Partial<
      PendingUniversalCapture
    >;

  if (
    typeof capture.uri !==
      'string' ||
    capture.uri.trim().length ===
      0
  ) {
    throw new Error(
      'The captured photo could not be found.'
    );
  }

  if (
    !isFinitePositiveNumber(
      capture.photoWidth
    ) ||
    !isFinitePositiveNumber(
      capture.photoHeight
    ) ||
    !isFinitePositiveNumber(
      capture.previewWidth
    ) ||
    !isFinitePositiveNumber(
      capture.previewHeight
    ) ||
    !isFinitePositiveNumber(
      capture.frameWidth
    ) ||
    !isFinitePositiveNumber(
      capture.frameHeight
    )
  ) {
    throw new Error(
      'The captured photo dimensions are incomplete.'
    );
  }

  if (
    typeof capture.frameX !==
      'number' ||
    !Number.isFinite(
      capture.frameX
    ) ||
    typeof capture.frameY !==
      'number' ||
    !Number.isFinite(
      capture.frameY
    )
  ) {
    throw new Error(
      'The camera frame information is invalid.'
    );
  }

  return {
    uri:
      capture.uri.trim(),

    photoWidth:
      capture.photoWidth,

    photoHeight:
      capture.photoHeight,

    previewWidth:
      capture.previewWidth,

    previewHeight:
      capture.previewHeight,

    frameX:
      capture.frameX,

    frameY:
      capture.frameY,

    frameWidth:
      capture.frameWidth,

    frameHeight:
      capture.frameHeight,

    scanMode:
      capture.scanMode ===
        'universal'
        ? 'universal'
        : undefined,

    templateId:
      typeof capture.templateId ===
        'string'
        ? capture.templateId
        : 'universal-scan',

    category:
      typeof capture.category ===
        'string'
        ? capture.category
        : 'Unknown',

    subCategory:
      typeof capture.subCategory ===
        'string'
        ? capture.subCategory
        : '',

    capturedAt:
      typeof capture.capturedAt ===
        'number' &&
      Number.isFinite(
        capture.capturedAt
      )
        ? capture.capturedAt
        : Date.now(),
  };
}

/**
 * CameraView تعرض المعاينة بنظام cover.
 *
 * لذلك نحسب:
 *
 * 1. نسبة تكبير صورة الكاميرا داخل الشاشة.
 * 2. الجزء المخفي أفقيًا أو رأسيًا.
 * 3. تحويل إطار الشاشة إلى إحداثيات الصورة
 *    الأصلية.
 */
function calculateSourceCrop(
  capture:
    PendingUniversalCapture
) {
  const sourceWidth =
    capture.photoWidth;

  const sourceHeight =
    capture.photoHeight;

  const previewWidth =
    capture.previewWidth;

  const previewHeight =
    capture.previewHeight;

  const previewScale =
    Math.max(
      previewWidth /
        sourceWidth,

      previewHeight /
        sourceHeight
    );

  if (
    !Number.isFinite(
      previewScale
    ) ||
    previewScale <= 0
  ) {
    throw new Error(
      'The camera preview scale is invalid.'
    );
  }

  const displayedWidth =
    sourceWidth *
    previewScale;

  const displayedHeight =
    sourceHeight *
    previewScale;

  const horizontalOffset =
    (
      displayedWidth -
      previewWidth
    ) / 2;

  const verticalOffset =
    (
      displayedHeight -
      previewHeight
    ) / 2;

  const requestedOriginX =
    (
      capture.frameX +
      horizontalOffset
    ) /
    previewScale;

  const requestedOriginY =
    (
      capture.frameY +
      verticalOffset
    ) /
    previewScale;

  const requestedWidth =
    capture.frameWidth /
    previewScale;

  const requestedHeight =
    capture.frameHeight /
    previewScale;

  const originX =
    clamp(
      requestedOriginX,
      0,
      Math.max(
        0,
        sourceWidth - 1
      )
    );

  const originY =
    clamp(
      requestedOriginY,
      0,
      Math.max(
        0,
        sourceHeight - 1
      )
    );

  const availableWidth =
    Math.max(
      1,
      sourceWidth -
        originX
    );

  const availableHeight =
    Math.max(
      1,
      sourceHeight -
        originY
    );

  const width =
    clamp(
      requestedWidth,
      1,
      availableWidth
    );

  const height =
    clamp(
      requestedHeight,
      1,
      availableHeight
    );

  const roundedOriginX =
    Math.max(
      0,
      Math.floor(
        originX
      )
    );

  const roundedOriginY =
    Math.max(
      0,
      Math.floor(
        originY
      )
    );

  const roundedWidth =
    Math.max(
      1,
      Math.min(
        Math.round(
          width
        ),
        Math.floor(
          sourceWidth -
            roundedOriginX
        )
      )
    );

  const roundedHeight =
    Math.max(
      1,
      Math.min(
        Math.round(
          height
        ),
        Math.floor(
          sourceHeight -
            roundedOriginY
        )
      )
    );

  return {
    originX:
      roundedOriginX,

    originY:
      roundedOriginY,

    width:
      roundedWidth,

    height:
      roundedHeight,
  };
}

/**
 * نحافظ على Aspect Ratio.
 *
 * نقلل المقاس فقط عندما يكون أحد الجانبين
 * أكبر من MAX_OUTPUT_SIDE.
 */
function calculateOutputSize(
  width:
    number,
  height:
    number
) {
  const largestSide =
    Math.max(
      width,
      height
    );

  if (
    largestSide <=
    MAX_OUTPUT_SIDE
  ) {
    return {
      width,
      height,
    };
  }

  const scale =
    MAX_OUTPUT_SIDE /
    largestSide;

  return {
    width:
      Math.max(
        2,
        Math.round(
          width *
          scale
        )
      ),

    height:
      Math.max(
        2,
        Math.round(
          height *
          scale
        )
      ),
  };
}

async function removePendingCapture():
  Promise<void> {
  await AsyncStorage
    .removeItem(
      PENDING_TEMPLATE_CAPTURE_KEY
    )
    .catch(
      () => {}
    );
}

/* =========================================================
 * Screen
 * ======================================================= */

export default function TemplatePreviewScreen() {
  const [
    preparing,
    setPreparing,
  ] = useState(
    true
  );

  const [
    accepting,
    setAccepting,
  ] = useState(
    false
  );

  const [
    imageReady,
    setImageReady,
  ] = useState(
    false
  );

  const [
    prepared,
    setPrepared,
  ] =
    useState<
      PreparedCapture | null
    >(
      null
    );

  const [
    errorMessage,
    setErrorMessage,
  ] =
    useState<
      string | null
    >(
      null
    );

  const prepareCapture =
    useCallback(
      async () => {
        setPreparing(
          true
        );

        setImageReady(
          false
        );

        setErrorMessage(
          null
        );

        try {
          const stored =
            await AsyncStorage
              .getItem(
                PENDING_TEMPLATE_CAPTURE_KEY
              );

          if (!stored) {
            throw new Error(
              'The captured photo could not be found. Please take another photo.'
            );
          }

          let parsed:
            unknown;

          try {
            parsed =
              JSON.parse(
                stored
              );
          } catch {
            throw new Error(
              'The captured photo information could not be read.'
            );
          }

          const capture =
            validatePendingCapture(
              parsed
            );

          const crop =
            calculateSourceCrop(
              capture
            );

          const outputSize =
            calculateOutputSize(
              crop.width,
              crop.height
            );

          /**
           * هذه الشاشة تقوم فقط بقص مساحة
           * التصوير وتجهيز الصورة.
           *
           * لا يتم تشغيل BiRefNet هنا.
           */
          const cropped =
            await ImageManipulator
              .manipulateAsync(
                capture.uri,
                [
                  {
                    crop,
                  },

                  {
                    resize: {
                      width:
                        outputSize.width,

                      height:
                        outputSize.height,
                    },
                  },
                ],
                {
                  compress:
                    1,

                  format:
                    ImageManipulator
                      .SaveFormat
                      .JPEG,
                }
              );

          if (
            !cropped.uri
          ) {
            throw new Error(
              'The cropped photo could not be created.'
            );
          }

          setPrepared({
            croppedUri:
              cropped.uri,

            sourceUri:
              capture.uri,

            width:
              cropped.width ||
              outputSize.width,

            height:
              cropped.height ||
              outputSize.height,

            templateId:
              capture.templateId ||
              'universal-scan',

            category:
              capture.category ||
              'Unknown',

            subCategory:
              capture.subCategory ||
              '',

            capturedAt:
              capture.capturedAt,
          });
        } catch (
          error:
            unknown
        ) {
          const message =
            error instanceof
              Error
              ? error.message
              : 'Could not prepare the captured photo.';

          setPrepared(
            null
          );

          setErrorMessage(
            message
          );
        } finally {
          setPreparing(
            false
          );
        }
      },
      []
    );

  useEffect(
    () => {
      let active =
        true;

      void prepareCapture()
        .catch(
          error => {
            if (
              !active
            ) {
              return;
            }

            const message =
              error instanceof
                Error
                ? error.message
                : 'Could not prepare the photo.';

            setErrorMessage(
              message
            );

            setPreparing(
              false
            );
          }
        );

      return () => {
        active =
          false;
      };
    },
    [
      prepareCapture,
    ]
  );

  async function retakePhoto() {
    if (
      preparing ||
      accepting
    ) {
      return;
    }

    await removePendingCapture();

    router.replace(
      '/template-camera' as any
    );
  }

  async function cancelPreview() {
    if (
      preparing ||
      accepting
    ) {
      return;
    }

    await removePendingCapture();

    router.back();
  }

  async function retryPreparation() {
    if (
      preparing ||
      accepting
    ) {
      return;
    }

    await prepareCapture();
  }

  async function usePhoto() {
    if (
      !prepared ||
      !imageReady ||
      preparing ||
      accepting
    ) {
      return;
    }

    setAccepting(
      true
    );

    try {
      /**
       * category = '' عندما تكون Unknown.
       *
       * item.tsx ستستخدم الفئة الافتراضية
       * وتسمح للمستخدم بتغييرها قبل الحفظ.
       */
      const category =
        prepared.category ===
          'Unknown'
          ? ''
          : prepared.category;

      await AsyncStorage
        .setItem(
          CAPTURED_TEMPLATE_IMAGE_KEY,
          JSON.stringify({
            uri:
              prepared
                .croppedUri,

            originalUri:
              prepared
                .sourceUri,

            templateId:
              prepared
                .templateId,

            category,

            subCategory:
              category
                ? prepared
                    .subCategory
                : '',

            width:
              prepared.width,

            height:
              prepared.height,

            processed:
              false,

            transparent:
              false,

            scanCompleted:
              false,

            requiresLocalSegmentation:
              true,

            capturedAt:
              prepared
                .capturedAt,

            acceptedAt:
              Date.now(),
          })
        );

      await removePendingCapture();
      console.log(
        'TEMPLATE PREVIEW: opening item screen'
      );
      router.back();
      return;
    } catch (
      error:
        unknown
    ) {
      const message =
        error instanceof
          Error
          ? error.message
          : 'Could not use the selected photo.';

      Alert.alert(
        'Photo error',
        message
      );

      setAccepting(
        false
      );
    }
  }

  /* =======================================================
   * Loading
   * ===================================================== */

  if (
    preparing
  ) {
    return (
      <View
        style={
          styles.loadingContainer
        }
      >
        <ActivityIndicator
          size="large"
          color="#f4dfc8"
        />

        <Text
          style={
            styles.loadingTitle
          }
        >
          Preparing photo
        </Text>

        <Text
          style={
            styles.loadingText
          }
        >
          Cropping the area inside
          the camera frame.
        </Text>

        <Text
          style={
            styles.loadingHint
          }
        >
          Background removal will
          run after you confirm the
          photo.
        </Text>
      </View>
    );
  }

  /* =======================================================
   * Error
   * ===================================================== */

  if (
    !prepared ||
    errorMessage
  ) {
    return (
      <View
        style={
          styles.errorContainer
        }
      >
        <View
          style={
            styles.errorIcon
          }
        >
          <Text
            style={
              styles.errorIconText
            }
          >
            !
          </Text>
        </View>

        <Text
          style={
            styles.errorTitle
          }
        >
          Photo could not be prepared
        </Text>

        <Text
          style={
            styles.errorText
          }
        >
          {errorMessage ||
            'The captured photo is unavailable.'}
        </Text>

        <TouchableOpacity
          style={
            styles.retryButton
          }
          onPress={() => {
            void retryPreparation();
          }}
          activeOpacity={
            0.85
          }
        >
          <Text
            style={
              styles.retryButtonText
            }
          >
            Try again
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={
            styles.retakeErrorButton
          }
          onPress={() => {
            void retakePhoto();
          }}
          activeOpacity={
            0.85
          }
        >
          <Text
            style={
              styles.retakeErrorText
            }
          >
            Retake photo
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={
            styles.cancelErrorButton
          }
          onPress={() => {
            void cancelPreview();
          }}
          activeOpacity={
            0.85
          }
        >
          <Text
            style={
              styles.cancelErrorText
            }
          >
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  /* =======================================================
   * Preview
   * ===================================================== */

  return (
    <View
      style={
        styles.container
      }
    >
      <View
        style={
          styles.topBar
        }
      >
        <TouchableOpacity
          style={
            styles.topButton
          }
          onPress={() => {
            void retakePhoto();
          }}
          disabled={
            accepting
          }
          activeOpacity={
            0.85
          }
        >
          <Text
            style={
              styles.backText
            }
          >
            ‹
          </Text>
        </TouchableOpacity>

        <View
          style={
            styles.headerCenter
          }
        >
          <Text
            style={
              styles.title
            }
          >
            Check the photo
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            Make sure the complete
            item is visible
          </Text>
        </View>

        <TouchableOpacity
          style={
            styles.topButton
          }
          onPress={() => {
            void cancelPreview();
          }}
          disabled={
            accepting
          }
          activeOpacity={
            0.85
          }
        >
          <Text
            style={
              styles.closeText
            }
          >
            ×
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={
          styles.previewArea
        }
      >
        <View
          style={
            styles.imageCard
          }
        >
          <Image
            source={{
              uri:
                prepared
                  .croppedUri,
            }}
            style={
              styles.previewImage
            }
            resizeMode="contain"
            onLoad={() => {
              setImageReady(
                true
              );
            }}
            onError={() => {
              setImageReady(
                false
              );

              setErrorMessage(
                'The prepared photo could not be displayed.'
              );
            }}
          />

          {!imageReady && (
            <View
              style={
                styles.imageLoadingOverlay
              }
            >
              <ActivityIndicator
                size="large"
                color="#111"
              />

              <Text
                style={
                  styles.imageLoadingText
                }
              >
                Loading preview...
              </Text>
            </View>
          )}
        </View>

        <View
          style={
            styles.infoCard
          }
        >
          <Text
            style={
              styles.infoTitle
            }
          >
            Before continuing
          </Text>

          <Text
            style={
              styles.infoText
            }
          >
            Check that the complete
            clothing item is inside
            the photo and that no
            important part is cut
            off.
          </Text>

          <View
            style={
              styles.tipRow
            }
          >
            <Text
              style={
                styles.tipCheck
              }
            >
              ✓
            </Text>

            <Text
              style={
                styles.tipText
              }
            >
              One clothing item only
            </Text>
          </View>

          <View
            style={
              styles.tipRow
            }
          >
            <Text
              style={
                styles.tipCheck
              }
            >
              ✓
            </Text>

            <Text
              style={
                styles.tipText
              }
            >
              Complete edges visible
            </Text>
          </View>

          <View
            style={
              styles.tipRow
            }
          >
            <Text
              style={
                styles.tipCheck
              }
            >
              ✓
            </Text>

            <Text
              style={
                styles.tipText
              }
            >
              Plain contrasting
              background
            </Text>
          </View>
        </View>
      </View>

      <View
        style={
          styles.bottomActions
        }
      >
        <TouchableOpacity
          style={
            styles.retakeButton
          }
          onPress={() => {
            void retakePhoto();
          }}
          disabled={
            accepting
          }
          activeOpacity={
            0.85
          }
        >
          <Text
            style={
              styles.retakeButtonText
            }
          >
            Retake
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.useButton,

            (
              !imageReady ||
              accepting
            ) &&
              styles.disabledButton,
          ]}
          onPress={() => {
            void usePhoto();
          }}
          disabled={
            !imageReady ||
            accepting
          }
          activeOpacity={
            0.85
          }
        >
          {accepting ? (
            <ActivityIndicator
              color="#111"
            />
          ) : (
            <Text
              style={
                styles.useButtonText
              }
            >
              Use photo
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {accepting && (
        <View
          style={
            styles.acceptingOverlay
          }
        >
          <ActivityIndicator
            size="large"
            color="#f4dfc8"
          />

          <Text
            style={
              styles.acceptingTitle
            }
          >
            Opening item editor
          </Text>

          <Text
            style={
              styles.acceptingText
            }
          >
            Triple N will now remove
            the background locally
            on your device.
          </Text>
        </View>
      )}
    </View>
  );
}

/* =========================================================
 * Styles
 * ======================================================= */

const styles =
  StyleSheet.create({
    container: {
      flex:
        1,

      backgroundColor:
        '#07090d',

      paddingTop:
        55,

      paddingHorizontal:
        16,
    },

    loadingContainer: {
      flex:
        1,

      backgroundColor:
        '#07090d',

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal:
        30,
    },

    loadingTitle: {
      color:
        '#fff',

      fontSize:
        23,

      fontWeight:
        '900',

      marginTop:
        20,

      textAlign:
        'center',
    },

    loadingText: {
      color:
        '#9297a0',

      fontSize:
        14,

      fontWeight:
        '700',

      lineHeight:
        22,

      textAlign:
        'center',

      maxWidth:
        320,

      marginTop:
        10,
    },

    loadingHint: {
      color:
        '#656b75',

      fontSize:
        12,

      fontWeight:
        '700',

      lineHeight:
        19,

      textAlign:
        'center',

      maxWidth:
        300,

      marginTop:
        18,
    },

    errorContainer: {
      flex:
        1,

      backgroundColor:
        '#07090d',

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal:
        30,
    },

    errorIcon: {
      width:
        72,

      height:
        72,

      borderRadius:
        24,

      backgroundColor:
        '#251519',

      borderWidth:
        1,

      borderColor:
        '#6e3741',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom:
        20,
    },

    errorIconText: {
      color:
        '#ffb4bd',

      fontSize:
        34,

      fontWeight:
        '900',
    },

    errorTitle: {
      color:
        '#fff',

      fontSize:
        23,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    errorText: {
      color:
        '#b6bac2',

      fontSize:
        14,

      fontWeight:
        '700',

      lineHeight:
        22,

      textAlign:
        'center',

      maxWidth:
        330,

      marginTop:
        10,

      marginBottom:
        24,
    },

    retryButton: {
      width:
        '100%',

      maxWidth:
        330,

      minHeight:
        56,

      borderRadius:
        28,

      backgroundColor:
        '#f4dfc8',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    retryButtonText: {
      color:
        '#111',

      fontSize:
        16,

      fontWeight:
        '900',
    },

    retakeErrorButton: {
      width:
        '100%',

      maxWidth:
        330,

      minHeight:
        54,

      borderRadius:
        27,

      backgroundColor:
        '#15171c',

      borderWidth:
        1,

      borderColor:
        '#343841',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop:
        12,
    },

    retakeErrorText: {
      color:
        '#fff',

      fontSize:
        15,

      fontWeight:
        '900',
    },

    cancelErrorButton: {
      paddingHorizontal:
        30,

      paddingVertical:
        15,

      marginTop:
        8,
    },

    cancelErrorText: {
      color:
        '#969ba4',

      fontSize:
        14,

      fontWeight:
        '800',
    },

    topBar: {
      minHeight:
        64,

      flexDirection:
        'row',

      alignItems:
        'center',

      marginBottom:
        18,
    },

    topButton: {
      width:
        50,

      height:
        50,

      borderRadius:
        18,

      backgroundColor:
        '#15171c',

      borderWidth:
        1,

      borderColor:
        '#252a31',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    backText: {
      color:
        '#fff',

      fontSize:
        42,

      lineHeight:
        45,

      marginTop:
        -5,
    },

    closeText: {
      color:
        '#fff',

      fontSize:
        34,

      lineHeight:
        37,

      marginTop:
        -3,
    },

    headerCenter: {
      flex:
        1,

      alignItems:
        'center',

      paddingHorizontal:
        8,
    },

    title: {
      color:
        '#fff',

      fontSize:
        22,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    subtitle: {
      color:
        '#858b95',

      fontSize:
        12,

      fontWeight:
        '700',

      textAlign:
        'center',

      marginTop:
        4,
    },

    previewArea: {
      flex:
        1,

      paddingBottom:
        115,
    },

    imageCard: {
      flex:
        1,

      minHeight:
        320,

      maxHeight:
        520,

      backgroundColor:
        '#e5e5e5',

      borderRadius:
        24,

      overflow:
        'hidden',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    previewImage: {
      width:
        '100%',

      height:
        '100%',

      backgroundColor:
        '#e5e5e5',
    },

    imageLoadingOverlay: {
      ...StyleSheet
        .absoluteFillObject,

      backgroundColor:
        '#e5e5e5',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    imageLoadingText: {
      color:
        '#333',

      fontSize:
        13,

      fontWeight:
        '800',

      marginTop:
        12,
    },

    infoCard: {
      backgroundColor:
        '#15171c',

      borderWidth:
        1,

      borderColor:
        '#252a31',

      borderRadius:
        20,

      padding:
        16,

      marginTop:
        16,
    },

    infoTitle: {
      color:
        '#f4dfc8',

      fontSize:
        15,

      fontWeight:
        '900',

      marginBottom:
        6,
    },

    infoText: {
      color:
        '#989da6',

      fontSize:
        13,

      fontWeight:
        '700',

      lineHeight:
        20,

      marginBottom:
        12,
    },

    tipRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      marginTop:
        7,
    },

    tipCheck: {
      color:
        '#f4dfc8',

      fontSize:
        13,

      fontWeight:
        '900',

      marginRight:
        8,
    },

    tipText: {
      flex:
        1,

      color:
        '#fff',

      fontSize:
        12,

      fontWeight:
        '800',
    },

    bottomActions: {
      position:
        'absolute',

      left:
        16,

      right:
        16,

      bottom:
        28,

      flexDirection:
        'row',

      gap:
        12,
    },

    retakeButton: {
      flex:
        1,

      minHeight:
        60,

      borderRadius:
        30,

      backgroundColor:
        '#15171c',

      borderWidth:
        1,

      borderColor:
        '#343841',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    retakeButtonText: {
      color:
        '#fff',

      fontSize:
        17,

      fontWeight:
        '900',
    },

    useButton: {
      flex:
        1.5,

      minHeight:
        60,

      borderRadius:
        30,

      backgroundColor:
        '#f4dfc8',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    useButtonText: {
      color:
        '#111',

      fontSize:
        18,

      fontWeight:
        '900',
    },

    disabledButton: {
      opacity:
        0.5,
    },

    acceptingOverlay: {
      position:
        'absolute',

      top:
        0,

      left:
        0,

      right:
        0,

      bottom:
        0,

      backgroundColor:
        'rgba(7,9,13,0.96)',

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal:
        30,

      zIndex:
        9999,

      elevation:
        9999,
    },

    acceptingTitle: {
      color:
        '#fff',

      fontSize:
        22,

      fontWeight:
        '900',

      textAlign:
        'center',

      marginTop:
        20,
    },

    acceptingText: {
      color:
        '#a8adb5',

      fontSize:
        14,

      fontWeight:
        '700',

      lineHeight:
        22,

      textAlign:
        'center',

      maxWidth:
        320,

      marginTop:
        10,
    },
  });