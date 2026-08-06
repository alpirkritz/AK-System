import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { registerFcmPushToken } from './api'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function ensurePushPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === 'granted') return true

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

/** Native FCM (Android) / APNs device token — not an Expo push token. */
export async function getFcmPushToken(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'ARO',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2dd4bf',
    })
  }

  const granted = await ensurePushPermissions()
  if (!granted) return null

  // google-services.json / EAS project still needed for native FCM on standalone builds.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId && Platform.OS === 'android') {
    // Soft check — getDevicePushTokenAsync still needs the Firebase config baked in.
    console.warn('[push] missing EAS projectId; ensure google-services.json is in the build')
  }

  const tokenData = await Notifications.getDevicePushTokenAsync()
  if (typeof tokenData.data !== 'string' || !tokenData.data.trim()) {
    throw new Error('לא התקבל FCM token מהמכשיר')
  }
  return tokenData.data
}

export async function syncPushToken(accessToken: string): Promise<boolean> {
  const fcmToken = await getFcmPushToken()
  if (!fcmToken) return false
  await registerFcmPushToken(accessToken, fcmToken)
  return true
}

export function addNotificationResponseListener(
  onOpen: (url: string) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url
    if (typeof url === 'string') onOpen(url)
  })
}
