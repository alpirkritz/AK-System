import type { ConfigContext, ExpoConfig } from 'expo/config'

/**
 * Dynamic Expo config — reads EXPO_PUBLIC_* at build time (EAS or local .env).
 * See docs/deploy/helm-apk-build.md
 */
export default ({ config }: ConfigContext): ExpoConfig =>
  ({
    ...config,
    name: 'Helm',
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
      backgroundColor: '#0f0f0f',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.alpir.helm',
    },
    android: {
      package: 'com.alpir.helm',
      adaptiveIcon: {
        backgroundColor: '#0f0f0f',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
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
          color: '#e8c547',
        },
      ],
      'expo-secure-store',
      'expo-web-browser',
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
