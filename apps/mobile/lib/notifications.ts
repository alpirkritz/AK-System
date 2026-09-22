import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'
import { registerFcmPushToken } from './api'
import { storage } from './storage'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

const NOTIFICATION_TASK = 'NOTIFICATION_RESPONSE_TASK'

// Archive notification in background (when app is killed/background)
async function archiveNotificationInBackground(token: string, notificationId: string): Promise<void> {
  try {
    const response = await fetch(`${Constants.expoConfig?.extra?.apiUrl}/api/notifications`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ id: notificationId, action: 'archive' }),
    })
    if (!response.ok) {
      console.warn('[archive-bg] Failed:', response.status)
    }
  } catch (err) {
    console.warn('[archive-bg] Error:', err)
  }
}

TaskManager.defineTask(NOTIFICATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{
  actionIdentifier: string
  notification: Notifications.Notification
}>) => {
  if (error) {
    console.error('[notification-task]', error)
    return
  }
  if (!data) return
  const { actionIdentifier, notification } = data
  if (actionIdentifier === 'archive') {
    const notificationId = notification.request.content.data?.notificationId
    if (typeof notificationId === 'string' && notificationId) {
      const token = await storage.getItem('helm_access_token')
      if (token) {
        await archiveNotificationInBackground(token, notificationId)
        await Notifications.dismissNotificationAsync(notification.request.identifier)
      }
    }
  }
})

export async function ensurePushPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === 'granted') {
    await registerNotificationCategory()
    return true
  }

  const { status } = await Notifications.requestPermissionsAsync()
  if (status === 'granted') {
    await registerNotificationCategory()
  }
  return status === 'granted'
}

async function registerNotificationCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync('inbox', [
      {
        identifier: 'archive',
        buttonTitle: 'ארכיון',
        options: { opensAppToForeground: false },
      },
    ])
    await Notifications.registerTaskAsync(NOTIFICATION_TASK)
  } catch (err) {
    console.warn('[notifications] Category registration failed:', err)
  }
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
  onOpen: (url: string, notificationId?: string) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url
    const notificationId = response.notification.request.content.data?.notificationId
    if (typeof url === 'string') {
      onOpen(url, typeof notificationId === 'string' ? notificationId : undefined)
    }
  })
}
