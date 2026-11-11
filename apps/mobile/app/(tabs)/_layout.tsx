import { Tabs, useRouter, type Href } from 'expo-router'
import { Pressable, Text, StyleSheet, View, type ColorValue } from 'react-native'
import { Avatar } from '../../components/Avatar'
import { KeyboardSafe } from '../../components/KeyboardSafe'
import { useAuth } from '../../lib/auth'
import { useUnread } from '../../lib/unread'
import { colors } from '../../lib/theme'

function TabIcon({ icon, color }: { icon: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>
}

function BackButton() {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      hitSlop={10}
      style={styles.headerLeft}
      accessibilityRole="button"
      accessibilityLabel="חזרה"
    >
      <Text style={styles.backChevron}>‹</Text>
    </Pressable>
  )
}

const HIDDEN_SCREENS: { name: string; title: string }[] = [
  { name: 'notifications', title: 'התראות' },
  { name: 'people', title: 'אנשים' },
  { name: 'relationships', title: 'קשרים' },
  { name: 'reading-list', title: 'רשימת קריאה' },
  { name: 'commitments', title: 'התחייבויות לאישור' },
  { name: 'waiting', title: 'חייבים לי' },
  { name: 'record', title: 'הקלטת שיחה' },
  { name: 'import-recording', title: 'ייבוא הקלטה' },
  { name: 'agents', title: 'סוכנים' },
  { name: 'projects', title: 'פרויקטים' },
  { name: 'calendar', title: 'יומן' },
  { name: 'finance', title: 'פיננסים' },
  { name: 'memory', title: 'זיכרון' },
  { name: 'updates', title: 'עדכונים' },
  { name: 'settings/notifications', title: 'העדפות התראות' },
  { name: 'settings/dashboard', title: 'דשבורד' },
  { name: 'settings/developer', title: 'מפתחים' },
  { name: 'settings/workspaces', title: 'סביבות עבודה' },
  { name: 'settings/meeting-types', title: 'סוגי פגישות' },
  { name: 'settings/voice-print', title: 'זיהוי קולי אוטומטי' },
]

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
    <KeyboardSafe style={styles.tabs}>
    <Tabs
      backBehavior="fullHistory"
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        // The bar stays in the layout. KeyboardSafe around this navigator
        // lifts the bar and the screen together, so the field stays visible.
        tabBarHideOnKeyboard: false,
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
      {HIDDEN_SCREENS.map((screen) => (
        <Tabs.Screen
          key={screen.name}
          name={screen.name}
          options={{
            href: null,
            title: screen.title,
            headerLeft: () => <BackButton />,
          }}
        />
      ))}
    </Tabs>
    </KeyboardSafe>
  )
}

const styles = StyleSheet.create({
  tabs: { flex: 1, backgroundColor: colors.bg },
  headerGroup: { flexDirection: 'row-reverse', alignItems: 'center' },
  headerLeft: { paddingHorizontal: 8 },
  backChevron: { color: colors.accent, fontSize: 32, lineHeight: 34, fontWeight: '400' },
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
