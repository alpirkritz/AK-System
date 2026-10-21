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
    version: '1.0.9',
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
      versionCode: 10,
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
      // Android-only background recording (see docs/specs/recording-background-and-speaker-id.md).
      // The foreground-service permissions + service declaration are added by the expo-audio
      // plugin below via `enableBackgroundRecording: true` — nothing extra needed here for that.
      // Lets Android's share sheet (e.g. the native call-recorder app, Files app) offer ARO as a
      // target for an audio file — used by the "Import Recording" flow.
      intentFilters: [
        {
          action: 'SEND',
          category: ['DEFAULT'],
          data: { mimeType: 'audio/*' },
        },
      ],
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
      [
        'expo-audio',
        {
          microphonePermission: 'ARO צריך גישה למיקרופון כדי להקליט שיחות שכל המשתתפים הסכימו להקליט.',
          // Adds the Android foreground-recording service + permissions (what this spec is
          // actually after). Note: this plugin has no per-platform switch, and its iOS
          // UIBackgroundModes:['audio'] entry is already added unconditionally today via the
          // (default-true) enableBackgroundPlayback option — so this flag doesn't newly change
          // iOS native config either way. iOS stays out of scope at the JS level: record.tsx only
          // skips the background-pause behavior on Platform.OS === 'android'.
          enableBackgroundRecording: true,
        },
      ],
      'expo-secure-store',
      'expo-web-browser',
      'expo-document-picker',
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
