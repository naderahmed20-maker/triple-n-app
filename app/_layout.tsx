// app/_layout.tsx

import 'react-native-reanimated';

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';

import {
  Stack,
  router,
  useSegments,
} from 'expo-router';

import Constants from 'expo-constants';
import * as Device from 'expo-device';

import {
  StatusBar,
} from 'expo-status-bar';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  useColorScheme,
} from '@/hooks/use-color-scheme';

import {
  TranslationProvider,
} from '@/lib/i18n';

import {
  supabase,
} from '@/lib/supabase';

/* =========================================================
 * Device gate types
 * ======================================================= */

type DeviceGateStatus =
  | 'checking'
  | 'supported'
  | 'unsupported';

type DeviceGateReason =
  | 'expo-go'
  | 'web'
  | 'simulator'
  | 'insufficient-memory'
  | 'unsupported-platform'
  | 'device-check-failed'
  | null;

type DeviceGateResult = {
  status:
    DeviceGateStatus;

  reason:
    DeviceGateReason;

  title:
    string;

  message:
    string;

  totalMemoryBytes:
    number | null;

  totalMemoryGB:
    number | null;

  platform:
    string;

  checkedAt:
    number | null;
};

/* =========================================================
 * Device compatibility constants
 * ======================================================= */

/**
 * Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰ Ø§Ù„Ø¢Ù…Ù† Ù„ØªØ´ØºÙŠÙ„ EdgeSAM Ù…Ø­Ù„ÙŠÙ‹Ø§.
 *
 * Device.totalMemory Ù‚Ø¯ ÙŠØ¹Ø±Ø¶ Ù‚ÙŠÙ…Ø© Ø£Ù‚Ù„ Ù‚Ù„ÙŠÙ„Ù‹Ø§
 * Ù…Ù† Ø§Ù„Ø±Ù‚Ù… Ø§Ù„ØªØ¬Ø§Ø±ÙŠ Ø§Ù„Ù…ÙƒØªÙˆØ¨ Ø¹Ù„Ù‰ Ø§Ù„Ø¬Ù‡Ø§Ø².
 *
 * Ù„Ø°Ù„Ùƒ Ù‡Ø°Ø§ Ø§Ù„Ø­Ø¯ ÙŠØ³Ù…Ø­ Ù„Ù„Ø£Ø¬Ù‡Ø²Ø© Ù…Ù† ÙØ¦Ø© 4 GB
 * Ø£Ùˆ Ø£Ø¹Ù„Ù‰ Ø¨Ø§Ù„Ù…Ø±ÙˆØ± Ø¨ØµÙˆØ±Ø© Ø¢Ù…Ù†Ø©.
 */
const MINIMUM_REPORTED_RAM_BYTES =
  3 * 1024 * 1024 * 1024;

/**
 * Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…ÙØ¶Ù„Ø© ÙˆÙ„ÙŠØ³Øª Ø´Ø±Ø· Ù…Ù†Ø¹ Ø¥Ø¶Ø§ÙÙŠÙ‹Ø§.
 */
const RECOMMENDED_RAM_BYTES =
  4 * 1024 * 1024 * 1024;

const INITIAL_DEVICE_GATE:
  DeviceGateResult = {
  status:
    'checking',

  reason:
    null,

  title:
    'Checking your device',

  message:
    'Preparing Triple N for secure local AI processing.',

  totalMemoryBytes:
    null,

  totalMemoryGB:
    null,

  platform:
    Platform.OS,

  checkedAt:
    null,
};

/* =========================================================
 * General helpers
 * ======================================================= */

function bytesToGigabytes(
  bytes:
    number | null
): number | null {
  if (
    bytes ===
      null ||
    !Number.isFinite(
      bytes
    ) ||
    bytes <=
      0
  ) {
    return null;
  }

  return (
    bytes /
    (
      1024 *
      1024 *
      1024
    )
  );
}

function formatGigabytes(
  value:
    number | null
): string | null {
  if (
    value ===
      null ||
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  return value.toFixed(
    1
  );
}

function isExpoGo():
  boolean {
  /**
   * storeClient ÙŠØ¹Ù†ÙŠ Ø£Ù† Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ ÙŠØ¹Ù…Ù„
   * Ø¯Ø§Ø®Ù„ Expo Go ÙˆÙ„ÙŠØ³ Development Build.
   */
  return (
    Constants
      .executionEnvironment ===
    'storeClient'
  );
}

function isSupportedNativePlatform():
  boolean {
  return (
    Platform.OS ===
      'ios' ||
    Platform.OS ===
      'android'
  );
}

/* =========================================================
 * Device compatibility check
 * ======================================================= */

async function checkDeviceCompatibility():
  Promise<DeviceGateResult> {
  const checkedAt =
    Date.now();

  try {
    /* -----------------------------------------------------
     * Web is not supported
     * --------------------------------------------------- */

    if (
      Platform.OS ===
      'web'
    ) {
      return {
        status:
          'unsupported',

        reason:
          'web',

        title:
          'Mobile device required',

        message:
          'Triple N local AI scanning is available only on supported iPhone and Android devices.',

        totalMemoryBytes:
          null,

        totalMemoryGB:
          null,

        platform:
          Platform.OS,

        checkedAt,
      };
    }

    /* -----------------------------------------------------
     * Only iOS and Android
     * --------------------------------------------------- */

    if (
      !isSupportedNativePlatform()
    ) {
      return {
        status:
          'unsupported',

        reason:
          'unsupported-platform',

        title:
          'Unsupported platform',

        message:
          'This version of Triple N supports local AI scanning on iOS and Android only.',

        totalMemoryBytes:
          null,

        totalMemoryGB:
          null,

        platform:
          Platform.OS,

        checkedAt,
      };
    }

    /* -----------------------------------------------------
     * Expo Go cannot load native ONNX modules
     * --------------------------------------------------- */

    if (
      isExpoGo()
    ) {
      return {
        status:
          'unsupported',

        reason:
          'expo-go',

        title:
          'Development Build required',

        message:
          'The local AI scanner cannot run inside Expo Go. Install the Triple N Development Build or production app.',

        totalMemoryBytes:
          Device.totalMemory,

        totalMemoryGB:
          bytesToGigabytes(
            Device.totalMemory
          ),

        platform:
          Platform.OS,

        checkedAt,
      };
    }

    /* -----------------------------------------------------
     * Physical device required
     * --------------------------------------------------- */

    if (
      !Device.isDevice
    ) {
      return {
        status:
          'unsupported',

        reason:
          'simulator',

        title:
          'Physical device required',

        message:
          'Triple N local AI scanning must be tested and used on a real supported device, not a simulator or emulator.',

        totalMemoryBytes:
          Device.totalMemory,

        totalMemoryGB:
          bytesToGigabytes(
            Device.totalMemory
          ),

        platform:
          Platform.OS,

        checkedAt,
      };
    }

    /* -----------------------------------------------------
     * RAM gate
     * --------------------------------------------------- */

    const totalMemoryBytes =
      typeof Device.totalMemory ===
        'number' &&
      Number.isFinite(
        Device.totalMemory
      ) &&
      Device.totalMemory >
        0
        ? Device.totalMemory
        : null;

    const totalMemoryGB =
      bytesToGigabytes(
        totalMemoryBytes
      );

    if (
      totalMemoryBytes !==
        null &&
      totalMemoryBytes <
        MINIMUM_REPORTED_RAM_BYTES
    ) {
      const formattedMemory =
        formatGigabytes(
          totalMemoryGB
        );

      return {
        status:
          'unsupported',

        reason:
          'insufficient-memory',

        title:
          'Device not supported',

        message:
          formattedMemory
            ? `This device reports ${formattedMemory} GB of system memory. Triple N local AI scanning requires a supported 4 GB-class device or higher.`
            : 'This device does not have enough memory to run Triple N local AI scanning safely.',

        totalMemoryBytes,

        totalMemoryGB,

        platform:
          Platform.OS,

        checkedAt,
      };
    }

    /* -----------------------------------------------------
     * Supported
     * --------------------------------------------------- */

    return {
      status:
        'supported',

      reason:
        null,

      title:
        'Device supported',

      message:
        totalMemoryBytes !==
          null &&
        totalMemoryBytes <
          RECOMMENDED_RAM_BYTES
          ? 'Your device passed the local AI safety gate. Triple N will load EdgeSAM only when Scan Item processing starts.'
          : 'Your device is ready for secure local AI processing.',

      totalMemoryBytes,

      totalMemoryGB,

      platform:
        Platform.OS,

      checkedAt,
    };
  } catch (error) {
    console.log(
      'DEVICE COMPATIBILITY CHECK ERROR:',
      error
    );

    return {
      status:
        'unsupported',

      reason:
        'device-check-failed',

      title:
        'Device check failed',

      message:
        'Triple N could not verify that this device can run local AI safely. Please close the app and try again.',

      totalMemoryBytes:
        null,

      totalMemoryGB:
        null,

      platform:
        Platform.OS,

      checkedAt,
    };
  }
}

/* =========================================================
 * Loading screen
 * ======================================================= */

function StartupLoadingScreen() {
  return (
    <View
      style={
        styles.loadingContainer
      }
    >
      <View
        style={
          styles.logoCircle
        }
      >
        <Text
          style={
            styles.logoLetter
          }
        >
          N
        </Text>
      </View>

      <Text
        style={
          styles.brandName
        }
      >
        TRIPLE N
      </Text>

      <Text
        style={
          styles.loadingTitle
        }
      >
        Preparing your experience
      </Text>

      <ActivityIndicator
        size="small"
        color="#f2f2f2"
        style={
          styles.loadingIndicator
        }
      />

      <Text
        style={
          styles.loadingMessage
        }
      >
        Checking device security and account session.
      </Text>
    </View>
  );
}

/* =========================================================
 * Unsupported device screen
 * ======================================================= */

type UnsupportedDeviceScreenProps = {
  result:
    DeviceGateResult;

  checking:
    boolean;

  onRetry:
    () => void;
};

function UnsupportedDeviceScreen({
  result,
  checking,
  onRetry,
}: UnsupportedDeviceScreenProps) {
  const memoryLabel =
    formatGigabytes(
      result.totalMemoryGB
    );

  return (
    <View
      style={
        styles.unsupportedContainer
      }
    >
      <View
        style={
          styles.unsupportedCard
        }
      >
        <View
          style={
            styles.warningIcon
          }
        >
          <Text
            style={
              styles.warningIconText
            }
          >
            !
          </Text>
        </View>

        <Text
          style={
            styles.unsupportedTitle
          }
        >
          {result.title}
        </Text>

        <Text
          style={
            styles.unsupportedMessage
          }
        >
          {result.message}
        </Text>

        <View
          style={
            styles.deviceDetails
          }
        >
          <View
            style={
              styles.deviceDetailRow
            }
          >
            <Text
              style={
                styles.deviceDetailLabel
              }
            >
              Platform
            </Text>

            <Text
              style={
                styles.deviceDetailValue
              }
            >
              {result.platform}
            </Text>
          </View>

          {memoryLabel ? (
            <View
              style={
                styles.deviceDetailRow
              }
            >
              <Text
                style={
                  styles.deviceDetailLabel
                }
              >
                Reported memory
              </Text>

              <Text
                style={
                  styles.deviceDetailValue
                }
              >
                {memoryLabel} GB
              </Text>
            </View>
          ) : null}

          <View
            style={
              styles.deviceDetailRow
            }
          >
            <Text
              style={
                styles.deviceDetailLabel
              }
            >
              Local AI
            </Text>

            <Text
              style={
                styles.deviceDetailValue
              }
            >
              Unavailable
            </Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={
            0.8
          }
          disabled={
            checking
          }
          style={[
            styles.retryButton,

            checking &&
              styles
                .retryButtonDisabled,
          ]}
          onPress={
            onRetry
          }
        >
          {checking ? (
            <ActivityIndicator
              size="small"
              color="#080808"
            />
          ) : (
            <Text
              style={
                styles
                  .retryButtonText
              }
            >
              Check again
            </Text>
          )}
        </TouchableOpacity>

        <Text
          style={
            styles.unsupportedFooter
          }
        >
          Triple N blocks unsupported devices to prevent crashes, memory pressure, and damaged scan results.
        </Text>
      </View>
    </View>
  );
}

/* =========================================================
 * Navigation stack
 * ======================================================= */

function RootNavigationStack() {
  const colorScheme =
    useColorScheme();

  return (
    <ThemeProvider
      value={
        colorScheme ===
        'dark'
          ? DarkTheme
          : DefaultTheme
      }
    >
      <Stack
        screenOptions={{
          headerShown:
            false,

          gestureEnabled:
            true,

          fullScreenGestureEnabled:
            true,

          animation:
            'slide_from_right',

          gestureDirection:
            'horizontal',
        }}
      >
        <Stack.Screen
          name="login"
          options={{
            gestureEnabled:
              false,

            fullScreenGestureEnabled:
              false,

            animation:
              'fade',
          }}
        />

        <Stack.Screen
          name="signup"
          options={{
            gestureEnabled:
              false,

            fullScreenGestureEnabled:
              false,

            animation:
              'fade',
          }}
        />

        <Stack.Screen
          name="(tabs)"
          options={{
            gestureEnabled:
              false,

            fullScreenGestureEnabled:
              false,
          }}
        />

        <Stack.Screen
          name="onboarding"
          options={{
            gestureEnabled:
              false,

            fullScreenGestureEnabled:
              false,
          }}
        />

        <Stack.Screen
          name="wardrobe-type"
          options={{
            gestureEnabled:
              false,

            fullScreenGestureEnabled:
              false,
          }}
        />

        <Stack.Screen
          name="home"
        />

        <Stack.Screen
          name="wardrobe"
        />

        <Stack.Screen
          name="item"
        />

        <Stack.Screen
          name="processing-image"
          options={{
            gestureEnabled:
              false,

            fullScreenGestureEnabled:
              false,
          }}
        />

        <Stack.Screen
          name="edit-item"
        />

        <Stack.Screen
          name="outfit"
        />

        <Stack.Screen
          name="saved-outfits"
        />

        <Stack.Screen
          name="profile"
        />

        <Stack.Screen
          name="account"
        />

        <Stack.Screen
          name="settings"
        />

        <Stack.Screen
  name="report-problem"
  options={{
    headerShown:
      false,
  }}
/>

        <Stack.Screen
          name="about"
        />

        <Stack.Screen
          name="help-center"
        />

        <Stack.Screen
          name="app/outfit-details"
        />

        <Stack.Screen
          name="app/outfit-preview"
        />

        <Stack.Screen
          name="app/random-outfit"
        />

        <Stack.Screen
          name="app/occasion-outfit"
        />

        <Stack.Screen
          name="app/weather-outfit"
        />

        <Stack.Screen
          name="app/smart-suggestion"
        />

        <Stack.Screen
          name="app/stats"
        />

        <Stack.Screen
          name="modal"
          options={{
            headerShown:
              true,

            presentation:
              'modal',

            title:
              'Modal',

            gestureEnabled:
              true,

            fullScreenGestureEnabled:
              false,

            animation:
              'slide_from_bottom',
          }}
        />
      </Stack>

      <StatusBar
        style={
          colorScheme ===
          'dark'
            ? 'light'
            : 'dark'
        }
      />
    </ThemeProvider>
  );
}
/* =========================================================
 * Root layout
 * ======================================================= */

export default function RootLayout() {
  console.log(
    'STARTUP: RootLayout render',
    Date.now()
  );

  const segments =
    useSegments();

  const mountedRef =
    useRef(
      true
    );

  
  const scanProcessingInitializedRef =
  useRef(
    false
  );

const scanProcessingInitializationPromiseRef =
  useRef<
    Promise<void> | null
  >(
    null
  );

  const [
    deviceGate,
    setDeviceGate,
  ] =
    useState<DeviceGateResult>(
      INITIAL_DEVICE_GATE
    );

  const [
    checkingDeviceAgain,
    setCheckingDeviceAgain,
  ] =
    useState(
      false
    );

  const [
    sessionReady,
    setSessionReady,
  ] =
    useState(
      false
    );

  const [
    hasSession,
    setHasSession,
  ] =
    useState<
      boolean | null
    >(
      null
    );

  /* =======================================================
   * Mounted state
   * ===================================================== */

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;
    };
  }, []);

  /* =======================================================
   * Device gate
   * ===================================================== */

  const runDeviceCheck =
    useCallback(
      async (
        isRetry:
          boolean
      ) => {
        if (
          isRetry
        ) {
          setCheckingDeviceAgain(
            true
          );
        } else {
          setDeviceGate(
            INITIAL_DEVICE_GATE
          );
        }

        const result =
          await checkDeviceCompatibility();

        if (
          !mountedRef.current
        ) {
          return;
        }

        setDeviceGate(
          result
        );

        setCheckingDeviceAgain(
          false
        );
      },
      []
    );

  useEffect(() => {
    console.log('STARTUP: device check effect started', Date.now());
    void runDeviceCheck(
      false
    ).then(() => {
      console.log('STARTUP: device check completed', Date.now());
    });
  }, [
    runDeviceCheck,
  ]);

  /* =======================================================
 * Scan processing disposal
 * ===================================================== */

const disposeScanProcessing =
  useCallback(
    async () => {
      scanProcessingInitializedRef
        .current =
        false;

      scanProcessingInitializationPromiseRef
        .current =
        null;

      const results =
        await Promise.allSettled([
          import(
            '@/scan/core/background'
          ).then(
            async module => {
              await module
                .disposeScanItemBackgroundProcessing();
            }
          ),

          import(
            '@/scan/core/ai/SegmentationEngine'
          ).then(
            async module => {
              await module
                .disposeSharedSegmentationEngine();
            }
          ),
        ]);

      for (
        const result of
        results
      ) {
        if (
          result.status ===
            'rejected'
        ) {
          console.log(
            'SCAN PROCESSING DISPOSE ERROR:',
            result.reason
          );
        }
      }
    },
    []
  );

  /* =======================================================
   * Supabase session
   * ===================================================== */

  useEffect(() => {
    if (
      deviceGate.status !==
        'supported'
    ) {
      return;
    }

    let active =
      true;

    async function loadSession():
      Promise<void> {
      console.log('STARTUP: session load started', Date.now());
      try {
        const {
          data,
          error,
        } =
          await supabase.auth
            .getSession();

        if (
          error
        ) {
          throw error;
        }

        if (
          !active ||
          !mountedRef.current
        ) {
          return;
        }

        setHasSession(
          Boolean(
            data.session
          )
        );
      } catch (error) {
        console.log(
          'SESSION LOAD ERROR:',
          error
        );

        if (
          active &&
          mountedRef.current
        ) {
          setHasSession(
            false
          );
        }
      } finally {
        if (
          active &&
          mountedRef.current
        ) {
          console.log('STARTUP: session load finished', Date.now());
          setSessionReady(
            true
          );
        }
      }
    }

    void loadSession();

    const {
      data:
        authListener,
    } =
      supabase.auth
        .onAuthStateChange(
          (
            event,
            session
          ) => {
            if (
              !active ||
              !mountedRef.current
            ) {
              return;
            }

            const authenticated =
              Boolean(
                session
              );

            setHasSession(
              authenticated
            );

            setSessionReady(
              true
            );

            if (
              event ===
                'SIGNED_OUT' ||
              !authenticated
            ) {
              void disposeScanProcessing();
            }
          }
        );

    return () => {
      active =
        false;

      authListener
        .subscription
        .unsubscribe();
    };
  }, [
    deviceGate.status,
    disposeScanProcessing,
  ]);

/* =======================================================
 * Scan Item foreground processing initialization
 * ===================================================== */

useEffect(() => {
  if (
    deviceGate.status !==
      'supported' ||
    !sessionReady ||
    !hasSession
  ) {
    return;
  }

  let active =
    true;

  async function initializeScanProcessingSystem():
    Promise<void> {
    if (
      scanProcessingInitializedRef
        .current
    ) {
      return;
    }

    if (
      scanProcessingInitializationPromiseRef
        .current
    ) {
      await scanProcessingInitializationPromiseRef
        .current;

      return;
    }

    const initializationPromise =
      (
        async () => {
          const [
  processingModule,
  wardrobeModule,
  storageModule,
] =
  await Promise.all([
    import(
      '@/scan/core/background'
    ),

    import(
      '@/lib/wardrobeService'
    ),

    import(
      '@/lib/storageService'
    ),
  ]);

          if (
            !active ||
            !mountedRef.current
          ) {
            return;
          }

          await processingModule
            .initializeScanItemBackgroundProcessing({
             updateWardrobeItem:
  async input => {
    const user =
      await wardrobeModule
        .getCurrentUser();

    if (
      !user
    ) {
      throw new Error(
        'The authenticated user is unavailable while saving the processed image.'
      );
    }

    /*
     * processedImageUri هنا file:// محلي.
     *
     * نرفعه أولًا إلى Supabase Storage،
     * ثم نحفظ الرابط الدائم فقط في قاعدة البيانات.
     */
    const uploadedProcessedImage =
      await storageModule
        .uploadWardrobeImage(
          input
            .processedImageUri,
          user.id
        );

    if (
      !uploadedProcessedImage ||
      !uploadedProcessedImage
        .trim()
    ) {
      throw new Error(
        'The processed wardrobe image upload returned an empty URL.'
      );
    }

    await wardrobeModule
      .updateWardrobeItem(
        input
          .wardrobeItemId,
        {
          image:
            uploadedProcessedImage,

          /*
           * لا نحفظ originalImageUri لأنها أيضًا
           * file:// محلية وقد تختفي بعد Build جديد.
           *
           * نحتفظ بالرابط الدائم الناتج حتى لا تصبح
           * القطعة فارغة بعد إعادة تثبيت التطبيق.
           */
          original_image_path:
            uploadedProcessedImage,

          cleaned_image_path:
            uploadedProcessedImage,

          processing_status:
            'ready',

          processing_error:
            null,

          processing_finished_at:
            new Date()
              .toISOString(),
        }
      );

    return {
      updated:
        true,

      metadata: {
        processedLocally:
          true,

        uploadedRemotely:
          true,

        width:
          input.width,

        height:
          input.height,

        category:
          input.category,

        subcategory:
          input.subcategory,

        wardrobeType:
          input
            .wardrobeType,
      },
    };
  },

              transparentImageQuality:
                100,

              collectSegmentationDiagnostics:
                false,

              reuseSegmentationSession:
                true,

              processedFileNamePrefix:
                'scan-item-queue',

              /*
               * تشغيل Queue مسموح أثناء فتح التطبيق.
               */
              autoStartQueue:
                true,

              /*
               * ممنوع طلب أي تنفيذ بعد إغلاق التطبيق.
               */
              autoStartBackgroundProcessing:
                false,

              enableDebugLogs:
                __DEV__,
            });

          if (
            active &&
            mountedRef.current
          ) {
            scanProcessingInitializedRef
              .current =
              true;
          }
        }
      )();

    scanProcessingInitializationPromiseRef
      .current =
        initializationPromise;

    try {
      await initializationPromise;
    } finally {
      if (
        scanProcessingInitializationPromiseRef
          .current ===
        initializationPromise
      ) {
        scanProcessingInitializationPromiseRef
          .current =
          null;
      }
    }
  }

  void initializeScanProcessingSystem()
    .catch(
      error => {
        scanProcessingInitializedRef
          .current =
          false;

        console.log(
          'SCAN ITEM PROCESSING INITIALIZATION ERROR:',
          error
        );
      }
    );

  return () => {
    active =
      false;
  };
}, [
  deviceGate.status,
  sessionReady,
  hasSession,
]);

  /* =======================================================
   * Authentication navigation guard
   * ===================================================== */

  useEffect(() => {
    if (
      deviceGate.status !==
        'supported' ||
      !sessionReady ||
      hasSession ===
        null
    ) {
      return;
    }

    const firstSegment =
      segments[0];

    const inAuthScreen =
      firstSegment ===
        'login' ||
      firstSegment ===
        'signup';

    if (
      !hasSession &&
      !inAuthScreen
    ) {
      router.replace(
        '/login' as never
      );

      return;
    }

    if (
      hasSession &&
      inAuthScreen
    ) {
      router.replace(
        '/home' as never
      );
    }
  }, [
    deviceGate.status,
    sessionReady,
    hasSession,
    segments,
  ]);

  /* =======================================================
   * Rendering gates
   * ===================================================== */

  if (
    deviceGate.status ===
      'checking'
  ) {
    return (
      <TranslationProvider>
        <StartupLoadingScreen />

        <StatusBar
          style="light"
        />
      </TranslationProvider>
    );
  }

  if (
    deviceGate.status ===
      'unsupported'
  ) {
    return (
      <TranslationProvider>
        <UnsupportedDeviceScreen
          result={
            deviceGate
          }
          checking={
            checkingDeviceAgain
          }
          onRetry={() => {
            void runDeviceCheck(
              true
            );
          }}
        />

        <StatusBar
          style="light"
        />
      </TranslationProvider>
    );
  }

  if (
    !sessionReady ||
    hasSession ===
      null
  ) {
    return (
      <TranslationProvider>
        <StartupLoadingScreen />

        <StatusBar
          style="light"
        />
      </TranslationProvider>
    );
  }

  return (
    <TranslationProvider>
      <RootNavigationStack />
    </TranslationProvider>
  );
}
/* =========================================================
 * Styles
 * ======================================================= */

const styles =
  StyleSheet.create({
    loadingContainer: {
      flex:
        1,

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal:
        32,

      backgroundColor:
        '#050505',
    },

    logoCircle: {
      width:
        86,

      height:
        86,

      borderRadius:
        43,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        'rgba(255,255,255,0.42)',

      backgroundColor:
        '#121212',

      shadowColor:
        '#ffffff',

      shadowOpacity:
        0.12,

      shadowRadius:
        18,

      shadowOffset: {
        width:
          0,

        height:
          0,
      },

      elevation:
        5,
    },

    logoLetter: {
      color:
        '#f2f2f2',

      fontSize:
        46,

      lineHeight:
        52,

      fontWeight:
        '300',

      letterSpacing:
        1,
    },

    brandName: {
      marginTop:
        20,

      color:
        '#f5f5f5',

      fontSize:
        22,

      fontWeight:
        '700',

      letterSpacing:
        5,
    },

    loadingTitle: {
      marginTop:
        38,

      color:
        '#ffffff',

      fontSize:
        18,

      fontWeight:
        '600',

      textAlign:
        'center',
    },

    loadingIndicator: {
      marginTop:
        22,
    },

    loadingMessage: {
      maxWidth:
        310,

      marginTop:
        18,

      color:
        '#989898',

      fontSize:
        13,

      lineHeight:
        20,

      textAlign:
        'center',
    },

    unsupportedContainer: {
      flex:
        1,

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal:
        22,

      paddingVertical:
        42,

      backgroundColor:
        '#050505',
    },

    unsupportedCard: {
      width:
        '100%',

      maxWidth:
        430,

      alignItems:
        'center',

      paddingHorizontal:
        24,

      paddingTop:
        32,

      paddingBottom:
        26,

      borderWidth:
        1,

      borderColor:
        '#2b2b2b',

      borderRadius:
        28,

      backgroundColor:
        '#111111',
    },

    warningIcon: {
      width:
        62,

      height:
        62,

      borderRadius:
        31,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderWidth:
        1,

      borderColor:
        '#5d5d5d',

      backgroundColor:
        '#1b1b1b',
    },

    warningIconText: {
      color:
        '#f3f3f3',

      fontSize:
        32,

      lineHeight:
        38,

      fontWeight:
        '500',
    },

    unsupportedTitle: {
      marginTop:
        22,

      color:
        '#ffffff',

      fontSize:
        23,

      lineHeight:
        30,

      fontWeight:
        '700',

      textAlign:
        'center',
    },

    unsupportedMessage: {
      marginTop:
        14,

      color:
        '#b3b3b3',

      fontSize:
        14,

      lineHeight:
        22,

      textAlign:
        'center',
    },

    deviceDetails: {
      width:
        '100%',

      marginTop:
        25,

      paddingHorizontal:
        16,

      paddingVertical:
        8,

      borderWidth:
        1,

      borderColor:
        '#292929',

      borderRadius:
        17,

      backgroundColor:
        '#0b0b0b',
    },

    deviceDetailRow: {
      minHeight:
        45,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      borderBottomWidth:
        StyleSheet.hairlineWidth,

      borderBottomColor:
        '#292929',
    },

    deviceDetailLabel: {
      flex:
        1,

      paddingRight:
        14,

      color:
        '#858585',

      fontSize:
        13,
    },

    deviceDetailValue: {
      color:
        '#e6e6e6',

      fontSize:
        13,

      fontWeight:
        '600',

      textTransform:
        'capitalize',
    },

    retryButton: {
      width:
        '100%',

      minHeight:
        52,

      marginTop:
        24,

      alignItems:
        'center',

      justifyContent:
        'center',

      borderRadius:
        16,

      backgroundColor:
        '#ededed',
    },

    retryButtonDisabled: {
      opacity:
        0.65,
    },

    retryButtonText: {
      color:
        '#080808',

      fontSize:
        15,

      fontWeight:
        '700',
    },

    unsupportedFooter: {
      marginTop:
        18,

      color:
        '#707070',

      fontSize:
        11,

      lineHeight:
        17,

      textAlign:
        'center',
    },
  });
