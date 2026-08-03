import fs from 'node:fs'
import type { ConfigContext, ExpoConfig } from 'expo/config'

/**
 * Dynamic Expo config — reads EXPO_PUBLIC_* at build time (EAS or local .env).
 * See docs/deploy/helm-apk-build.md
 */
export default ({ config }: ConfigContext): ExpoConfig =>
  ({
    ...config,
    name: 'ARO',
    slug: 'helm',
    owner: 'alpir',
    version: '1.0.0',
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    scheme: 'helm',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0e1626',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.alpir.helm',
    },
    android: {
      package: 'com.alpir.helm',
      // Resize the window when the keyboard opens so the chat composer stays visible.
      softwareKeyboardLayoutMode: 'resize',
      adaptiveIcon: {
        backgroundColor: '#0e1626',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // Present when downloaded from Firebase (package com.alpir.helm).
      ...(process.env.GOOGLE_SERVICES_JSON || fs.existsSync('./google-services.json')
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './google-services.json' }
        : {}),
    },
    plugins: [
      'expo-router',
      [
        '@react-native-google-signin/google-signin',
        {
          iosUrlScheme:
            'com.googleusercontent.apps.185057895621-r25eljj8fbj6mlnemu32mte4r9vd6kmo',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/icon.png',
          color: '#2dd4bf',
        },
      ],
      'expo-secure-store',
      'expo-web-browser',
      '@react-native-community/datetimepicker',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
      router: {},
      eas: {
        // EAS project @alpir/helm (created via `eas init`).
        projectId: process.env.EAS_PROJECT_ID || '02c86ee3-b071-44e9-a53c-8d22a548c49e',
      },
    },
  }) as ExpoConfig
