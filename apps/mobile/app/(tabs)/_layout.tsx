import { Tabs, useRouter, type Href } from 'expo-router'
import { Pressable, Text, StyleSheet, View, type ColorValue } from 'react-native'
import { Avatar } from '../../components/Avatar'
import { useAuth } from '../../lib/auth'
import { useUnread } from '../../lib/unread'
import { colors } from '../../lib/theme'

function TabIcon({ icon, color }: { icon: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>
}

function HeaderButtons() {
  const router = useRouter()
  const { count } = useUnread()
  const badge = count > 99 ? '99+' : count > 0 ? String(count) : null

  return (
    <View style={styles.headerGroup}>
      <Pressable
        onPress={() => router.push('/reading-list' as Href)}
        hitSlop={10}
        style={styles.headerBtn}
        accessibilityRole="button"
        accessibilityLabel="רשימת קריאה"
      >
        <Text style={styles.headerIcon}>📚</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/notifications')}
        hitSlop={10}
        style={styles.headerBtn}
        accessibilityRole="button"
        accessibilityLabel={badge ? `התראות, ${badge} לא נקראו` : 'התראות'}
      >
        <Text style={styles.headerIcon}>🔔</Text>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

export default function TabsLayout() {
  const router = useRouter()
  const { user } = useAuth()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 11 },
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerRight: () => <HeaderButtons />,
        headerLeft: () => (
          <View style={styles.headerLeft}>
            <Avatar
              name={user?.name ?? user?.email}
              onPress={() => router.push('/account' as Href)}
            />
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'דשבורד',
          tabBarLabel: 'דשבורד',
          tabBarIcon: ({ color }) => <TabIcon icon="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="meetings"
        options={{
          title: 'פגישות',
          tabBarLabel: 'פגישות',
          tabBarIcon: ({ color }) => <TabIcon icon="📅" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'משימות',
          tabBarLabel: 'משימות',
          tabBarIcon: ({ color }) => <TabIcon icon="✅" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'עוזר',
          tabBarLabel: 'עוזר',
          tabBarIcon: ({ color }) => <TabIcon icon="✨" color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'עוד',
          tabBarLabel: 'עוד',
          tabBarIcon: ({ color }) => <TabIcon icon="☰" color={color} />,
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  headerGroup: { flexDirection: 'row-reverse', alignItems: 'center' },
  headerLeft: { paddingHorizontal: 8 },
  headerBtn: {
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
    position: 'relative',
  },
  headerIcon: { fontSize: 20 },
  badge: {
    position: 'absolute',
    top: 2,
    left: 4,
    backgroundColor: colors.coral,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
})
