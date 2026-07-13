import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { registerExpoPushToken } from './api'

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

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Helm',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2dd4bf',
    })
  }

  const granted = await ensurePushPermissions()
  if (!granted) return null

  // Standalone APK push requires the EAS projectId to attribute the token.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) {
    throw new Error('חסר EAS projectId — בנה APK מחדש עם app.config.ts מעודכן')
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId })
  return tokenData.data
}

export async function syncPushToken(accessToken: string): Promise<boolean> {
  const expoToken = await getExpoPushToken()
  if (!expoToken) return false
  await registerExpoPushToken(accessToken, expoToken)
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
