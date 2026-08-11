import { Tabs, useRouter, type Href } from 'expo-router'
import { Pressable, Text, StyleSheet, View, type ColorValue } from 'react-native'
import { colors } from '../../lib/theme'

function TabIcon({ icon, color }: { icon: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>
}

function HeaderButtons() {
  const router = useRouter()
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
        accessibilityLabel="התראות"
      >
        <Text style={styles.headerIcon}>🔔</Text>
      </Pressable>
    </View>
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
        name="more"
        options={{
          title: 'עוד',
          tabBarLabel: 'עוד',
          tabBarIcon: ({ color }) => <TabIcon icon="☰" color={color} />,
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
  headerGroup: { flexDirection: 'row-reverse', alignItems: 'center' },
  headerBtn: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  headerIcon: { fontSize: 20 },
})
