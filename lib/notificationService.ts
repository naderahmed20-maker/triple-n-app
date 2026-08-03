import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications() {
  try {
    if (!Device.isDevice) {
      console.log(
        'Push notifications require a physical device'
      );

      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(
        'wardrobe-ready',
        {
          name: 'Wardrobe Ready',
          importance:
            Notifications.AndroidImportance.HIGH,
          vibrationPattern: [
            0,
            250,
            250,
            250,
          ],
          sound: 'default',
        }
      );
    }

    const currentPermissions =
      await Notifications.getPermissionsAsync();

    let finalStatus =
      currentPermissions.status;

    if (
      finalStatus !==
      'granted'
    ) {
      const requestedPermissions =
        await Notifications.requestPermissionsAsync();

      finalStatus =
        requestedPermissions.status;
    }

    if (
      finalStatus !==
      'granted'
    ) {
      console.log(
        'Notification permission was not granted'
      );

      return null;
    }

    const projectId =
      Constants.expoConfig
        ?.extra?.eas
        ?.projectId ||
      Constants.easConfig
        ?.projectId;

    if (!projectId) {
      throw new Error(
        'EAS project ID is missing'
      );
    }

    const tokenResult =
      await Notifications.getExpoPushTokenAsync({
        projectId,
      });

    const expoPushToken =
      tokenResult.data;

    const {
      data: sessionData,
      error: sessionError,
    } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    const user =
      sessionData.session?.user;

    if (!user) {
      return null;
    }

    const { error: saveError } =
      await supabase
        .from('push_tokens')
        .upsert(
          {
            user_id:
              user.id,

            expo_push_token:
              expoPushToken,

            platform:
              Platform.OS,

            device_name:
              Device.deviceName ||
              null,

            is_active:
              true,

            updated_at:
              new Date()
                .toISOString(),
          },
          {
            onConflict:
              'user_id,expo_push_token',
          }
        );

    if (saveError) {
      throw saveError;
    }

    console.log(
      'PUSH TOKEN SAVED'
    );

    return expoPushToken;
  } catch (error) {
    console.log(
      'PUSH REGISTRATION ERROR:',
      error
    );

    return null;
  }
}