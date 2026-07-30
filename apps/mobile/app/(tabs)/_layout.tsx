import { Tabs, useRouter } from 'expo-router'
import { Pressable, Text, StyleSheet, type ColorValue } from 'react-native'
import { colors } from '../../lib/theme'

function TabIcon({ icon, color }: { icon: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>
}

function HeaderButtons() {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      style={styles.headerBtn}
    >
      <Text style={styles.headerIcon}>🔔</Text>
    </Pressable>
  )
}

export default function TabsLayout() {
  const router = useRouter()
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
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={10}
            style={styles.headerBtn}
          >
            <Text style={styles.headerIcon}>⚙️</Text>
          </Pressable>
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
        name="people"
        options={{
          title: 'אנשים',
          tabBarLabel: 'אנשים',
          tabBarIcon: ({ color }) => <TabIcon icon="👥" color={color} />,
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
    </Tabs>
  )
}

const styles = StyleSheet.create({
  headerBtn: { paddingHorizontal: 16 },
  headerIcon: { fontSize: 20 },
})
