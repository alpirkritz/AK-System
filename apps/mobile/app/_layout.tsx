import { Stack, useRouter, useSegments, type Href } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from '../lib/auth'
import { addNotificationResponseListener } from '../lib/notifications'
import { colors } from '../lib/theme'
import { UnreadProvider } from '../lib/unread'

const formSheet = {
  presentation: 'formSheet' as const,
  sheetAllowedDetents: 'fitToContents' as const,
  sheetGrabberVisible: true,
  sheetCornerRadius: 20,
}

/**
 * Sheets whose body is a ScrollView must NOT use `fitToContents`: the sheet
 * sizes itself to the content, so the scroll viewport equals the content height
 * and the list can never overflow — scrolling is dead and the tail is clipped.
 * A fixed detent bounds the sheet so the ScrollView can actually scroll.
 */
const scrollableFormSheet = {
  ...formSheet,
  sheetAllowedDetents: [0.92],
}

function RootNavigator() {
  const { token, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()
  const [lastConsumedId, setLastConsumedId] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    const inAuth = segments[0] === 'login'
    if (!token && !inAuth) {
      router.replace('/login')
    } else if (token && inAuth) {
      router.replace('/')
    }
  }, [token, loading, segments, router])

  useEffect(() => {
    if (!token) return

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return
      const requestId = response.notification.request.identifier
      if (lastConsumedId === requestId) return // Already handled
      setLastConsumedId(requestId)

      const notifId = response.notification.request.content.data?.notificationId
      if (typeof notifId === 'string' && notifId) {
        router.push({ pathname: '/notifications', params: { id: notifId } } as Href)
      }
    })

    const sub = addNotificationResponseListener((url, notificationId) => {
      if (typeof notificationId === 'string' && notificationId) {
        router.push({ pathname: '/notifications', params: { id: notificationId } } as Href)
      } else {
        router.push('/notifications')
      }
    })
    return () => sub.remove()
  }, [token, router, lastConsumedId])

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="account" options={{ title: 'החשבון שלי', ...formSheet }} />
        <Stack.Screen name="agent/[id]" options={{ title: 'הגדרות סוכן', ...scrollableFormSheet }} />
        <Stack.Screen name="project/[id]" options={{ title: 'פרויקט', ...scrollableFormSheet }} />
        <Stack.Screen name="person/[id]" options={{ title: 'איש קשר', ...scrollableFormSheet }} />
        <Stack.Screen name="meeting/[id]" options={{ title: 'פגישה', ...scrollableFormSheet }} />
        <Stack.Screen
          name="task/[id]"
          options={{
            ...scrollableFormSheet,
            headerShown: true,
            title: 'משימה',
          }}
        />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <UnreadProvider>
          <RootNavigator />
        </UnreadProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
