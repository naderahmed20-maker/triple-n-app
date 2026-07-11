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

import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const segments = useSegments();

  const [ready, setReady] = useState(false);

  const [hasSession, setHasSession] =
    useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const { data, error } =
          await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!mounted) return;

        setHasSession(Boolean(data.session));
      } catch (error) {
        console.log(
          'SESSION LOAD ERROR:',
          error
        );

        if (mounted) {
          setHasSession(false);
        }
      } finally {
        if (mounted) {
          setReady(true);
        }
      }
    }

    loadSession();

    const { data: authListener } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (!mounted) return;

          setHasSession(
            Boolean(session)
          );
        }
      );

    return () => {
      mounted = false;

      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (
      !ready ||
      hasSession === null
    ) {
      return;
    }

    const firstSegment =
      segments[0];

    const inAuthScreen =
      firstSegment === 'login' ||
      firstSegment === 'signup';

    if (
      !hasSession &&
      !inAuthScreen
    ) {
      router.replace(
        '/login' as any
      );

      return;
    }

    if (
      hasSession &&
      inAuthScreen
    ) {
      router.replace(
        '/home' as any
      );
    }
  }, [
    ready,
    hasSession,
    segments,
  ]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor:
            '#050505',
        }}
      />
    );
  }

  return (
    <ThemeProvider
      value={
        colorScheme === 'dark'
          ? DarkTheme
          : DefaultTheme
      }
    >
      <Stack
        screenOptions={{
          headerShown: false,

          // تفعيل سحب الرجوع على iPhone
          gestureEnabled: true,

          // يسمح بالسحب من أي مكان في الشاشة
          fullScreenGestureEnabled: true,

          // حركة الصفحة من اليمين
          animation:
            'slide_from_right',

          // اتجاه حركة الرجوع
          gestureDirection:
            'horizontal',
        }}
      >
        <Stack.Screen
          name="login"
          options={{
            gestureEnabled: false,
            fullScreenGestureEnabled:
              false,
            animation: 'fade',
          }}
        />

        <Stack.Screen
          name="signup"
          options={{
            gestureEnabled: false,
            fullScreenGestureEnabled:
              false,
            animation: 'fade',
          }}
        />

        <Stack.Screen
          name="(tabs)"
          options={{
            gestureEnabled: false,
            fullScreenGestureEnabled:
              false,
          }}
        />

        <Stack.Screen
          name="onboarding"
          options={{
            gestureEnabled: false,
            fullScreenGestureEnabled:
              false,
          }}
        />

        <Stack.Screen
          name="wardrobe-type"
          options={{
            gestureEnabled: false,
            fullScreenGestureEnabled:
              false,
          }}
        />

        <Stack.Screen name="home" />

        <Stack.Screen name="wardrobe" />

        <Stack.Screen name="item" />

        <Stack.Screen name="edit-item" />

        <Stack.Screen name="outfit" />

        <Stack.Screen name="saved-outfits" />

        <Stack.Screen name="profile" />

        <Stack.Screen name="account" />

        <Stack.Screen name="settings" />

        <Stack.Screen name="about" />

        <Stack.Screen name="help-center" />

        <Stack.Screen name="app/outfit-details" />

        <Stack.Screen name="app/outfit-preview" />

        <Stack.Screen name="app/random-outfit" />

        <Stack.Screen name="app/occasion-outfit" />

        <Stack.Screen name="app/weather-outfit" />

        <Stack.Screen name="app/smart-suggestion" />

        <Stack.Screen name="app/stats" />

        <Stack.Screen
          name="modal"
          options={{
            headerShown: true,
            presentation: 'modal',
            title: 'Modal',

            gestureEnabled: true,

            fullScreenGestureEnabled:
              false,

            animation:
              'slide_from_bottom',
          }}
        />
      </Stack>

      <StatusBar style="auto" />
    </ThemeProvider>
  );
}