import { useRouter, type Href } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { ListRow } from '../../components/ListRow'
import { SectionHeader } from '../../components/SectionHeader'
import { colors } from '../../lib/theme'

type MoreEntry = {
  icon: string
  label: string
  route: Href
}

/**
 * Canonical hub for everything that does not earn a tab.
 * Areas = content domains. Settings = preferences (not duplicated in the header).
 * Header destinations (reading-list, notifications, account) must NOT appear here.
 */
const AREAS: MoreEntry[] = [
  { icon: '👥', label: 'אנשים', route: '/people' as Href },
  { icon: '📁', label: 'פרויקטים', route: '/projects' as Href },
  { icon: '📅', label: 'יומן', route: '/calendar' as Href },
  { icon: '💰', label: 'פיננסים', route: '/finance' as Href },
  { icon: '📰', label: 'עדכונים', route: '/updates' as Href },
  { icon: '🤖', label: 'סוכנים', route: '/agents' as Href },
  { icon: '🧠', label: 'זיכרון', route: '/memory' as Href },
]

const SETTINGS: MoreEntry[] = [
  { icon: '🔔', label: 'העדפות התראות', route: '/settings/notifications' as Href },
  { icon: '📊', label: 'דשבורד', route: '/settings/dashboard' as Href },
  { icon: '🗂️', label: 'Workspaces', route: '/settings/workspaces' as Href },
  { icon: '🏷️', label: 'סוגי פגישות', route: '/settings/meeting-types' as Href },
  { icon: '🔧', label: 'מפתחים', route: '/settings/developer' as Href },
]

export default function MoreScreen() {
  const router = useRouter()

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <SectionHeader title="אזורים" style={styles.section} />
      <View style={styles.group}>
        {AREAS.map((entry) => (
          <ListRow
            key={entry.label}
            icon={entry.icon}
            label={entry.label}
            onPress={() => router.push(entry.route)}
          />
        ))}
      </View>

      <SectionHeader title="הגדרות" style={styles.section} />
      <View style={styles.group}>
        {SETTINGS.map((entry) => (
          <ListRow
            key={entry.label}
            icon={entry.icon}
            label={entry.label}
            onPress={() => router.push(entry.route)}
          />
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 32 },
  section: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  group: {
    marginHorizontal: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
})
