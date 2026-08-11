import { useRouter, type Href } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Card } from '../../components/Card'
import { colors } from '../../lib/theme'

type MoreEntry = {
  icon: string
  label: string
  route: Href
}

/**
 * Hub for everything that does not earn a tab of its own. Waves B–E of
 * `mobile-web-parity` each append one entry here when their Stack screen lands
 * (projects, finance, calendar, memory, updates). `as Href` matches the app's
 * convention for routes the stale generated router.d.ts does not list yet.
 */
const ENTRIES: MoreEntry[] = [
  { icon: '👥', label: 'אנשים', route: '/people' as Href },
  { icon: '📚', label: 'רשימת קריאה', route: '/reading-list' as Href },
  { icon: '🔔', label: 'התראות', route: '/notifications' as Href },
  { icon: '⚙️', label: 'הגדרות', route: '/settings' as Href },
]

export default function MoreScreen() {
  const router = useRouter()

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.grid}>
        {ENTRIES.map((entry) => (
          <Card
            key={entry.label}
            style={styles.tile}
            onPress={() => router.push(entry.route)}
            accessibilityLabel={entry.label}
          >
            <Text style={styles.tileIcon}>{entry.icon}</Text>
            <Text style={styles.tileLabel}>{entry.label}</Text>
          </Card>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12 },
  tile: {
    // Two columns — 48% leaves room for the 12pt gap between them.
    width: '48%',
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tileIcon: { fontSize: 28 },
  tileLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
})
