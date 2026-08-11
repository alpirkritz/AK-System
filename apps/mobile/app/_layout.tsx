import { Stack, useRouter, useSegments, type Href } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { mobileRouteForNotificationUrl } from '../lib/api'
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

function navigateFromNotificationUrl(router: ReturnType<typeof useRouter>, url: string) {
  const target = mobileRouteForNotificationUrl(url)
  const params: Record<string, string> = {}
  if (target.message) params.message = target.message
  if (target.agent) params.agent = target.agent
  if (target.focus) params.focus = target.focus

  if (Object.keys(params).length > 0) {
    router.push({ pathname: target.pathname, params } as Href)
  } else {
    router.push(target.pathname as Href)
  }
}

function RootNavigator() {
  const { token, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

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
      const url = response?.notification.request.content.data?.url
      if (typeof url === 'string') navigateFromNotificationUrl(router, url)
    })

    const sub = addNotificationResponseListener((url) => {
      navigateFromNotificationUrl(router, url)
    })
    return () => sub.remove()
  }, [token, router])

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
        <Stack.Screen name="notifications" options={{ title: 'התראות' }} />
        <Stack.Screen name="people" options={{ title: 'אנשים' }} />
        <Stack.Screen name="reading-list" options={{ title: 'רשימת קריאה' }} />
        <Stack.Screen name="account" options={{ title: 'החשבון שלי', ...formSheet }} />
        <Stack.Screen name="agents" options={{ title: 'סוכנים' }} />
        <Stack.Screen name="agent/[id]" options={{ title: 'הגדרות סוכן', ...formSheet }} />
        <Stack.Screen name="projects" options={{ title: 'פרויקטים' }} />
        <Stack.Screen name="project/[id]" options={{ title: 'פרויקט', ...formSheet }} />
        <Stack.Screen name="person/[id]" options={{ title: 'איש קשר', ...formSheet }} />
        <Stack.Screen name="meeting/[id]" options={{ title: 'פגישה', ...formSheet }} />
        <Stack.Screen name="calendar" options={{ title: 'יומן' }} />
        <Stack.Screen name="finance" options={{ title: 'פיננסים' }} />
        <Stack.Screen name="memory" options={{ title: 'זיכרון' }} />
        <Stack.Screen name="updates" options={{ title: 'עדכונים' }} />
        <Stack.Screen name="settings/notifications" options={{ title: 'העדפות התראות' }} />
        <Stack.Screen name="settings/dashboard" options={{ title: 'דשבורד' }} />
        <Stack.Screen name="settings/developer" options={{ title: 'מפתחים' }} />
        <Stack.Screen name="settings/workspaces" options={{ title: 'Workspaces' }} />
        <Stack.Screen name="settings/meeting-types" options={{ title: 'סוגי פגישות' }} />
        <Stack.Screen
          name="task/[id]"
          options={{
            ...formSheet,
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
