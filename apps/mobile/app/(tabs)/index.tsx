import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useAuth } from '../../lib/auth'
import {
  fetchMeetings,
  fetchPeople,
  fetchTasks,
  type MobileMeeting,
  type MobileTask,
} from '../../lib/data'
import { colors } from '../../lib/theme'

function greeting(hour: number): string {
  if (hour < 5) return 'לילה טוב'
  if (hour < 12) return 'בוקר טוב'
  if (hour < 17) return 'צהריים טובים'
  if (hour < 21) return 'ערב טוב'
  return 'לילה טוב'
}

function isPast(date: string, time: string): boolean {
  const [h = 0, m = 0] = (time || '00:00').split(':').map(Number)
  const dt = new Date(date + 'T00:00:00')
  dt.setHours(h, m, 0, 0)
  return dt < new Date()
}

export default function DashboardScreen() {
  const { token, user } = useAuth()
  const router = useRouter()
  const [tasks, setTasks] = useState<MobileTask[]>([])
  const [meetings, setMeetings] = useState<MobileMeeting[]>([])
  const [peopleCount, setPeopleCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const [t, m, p] = await Promise.all([
          fetchTasks(token),
          fetchMeetings(token),
          fetchPeople(token),
        ])
        setTasks(t)
        setMeetings(m)
        setPeopleCount(p.length)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת הנתונים נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  useEffect(() => {
    load()
  }, [load])

  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks])
  const upcoming = useMemo(
    () =>
      meetings
        .filter((m) => !isPast(m.date, m.time))
        .sort(
          (a, b) =>
            new Date(a.date + 'T' + (a.time || '00:00')).getTime() -
            new Date(b.date + 'T' + (b.time || '00:00')).getTime(),
        ),
    [meetings],
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
      }
    >
      <Text style={styles.greeting}>{greeting(new Date().getHours())} 👋</Text>
      {user?.name ? <Text style={styles.subGreeting}>{user.name}</Text> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.kpiRow}>
        <Pressable style={styles.kpi} onPress={() => router.push('/tasks')}>
          <Text style={[styles.kpiNum, { color: colors.coral }]}>{openTasks.length}</Text>
          <Text style={styles.kpiLabel}>משימות פתוחות</Text>
        </Pressable>
        <Pressable style={styles.kpi} onPress={() => router.push('/meetings')}>
          <Text style={[styles.kpiNum, { color: colors.info }]}>{upcoming.length}</Text>
          <Text style={styles.kpiLabel}>פגישות קרובות</Text>
        </Pressable>
        <Pressable style={styles.kpi} onPress={() => router.push('/people')}>
          <Text style={[styles.kpiNum, { color: colors.accent }]}>{peopleCount}</Text>
          <Text style={styles.kpiLabel}>אנשי קשר</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>פגישות קרובות</Text>
        {upcoming.length === 0 ? (
          <Text style={styles.emptyText}>אין פגישות קרובות</Text>
        ) : (
          upcoming.slice(0, 4).map((m) => (
            <Pressable key={m.id} style={styles.item} onPress={() => router.push('/meetings')}>
              <Text style={styles.itemTitle}>{m.title}</Text>
              <Text style={styles.itemMeta}>
                {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.time}
              </Text>
            </Pressable>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>משימות פתוחות</Text>
        {openTasks.length === 0 ? (
          <Text style={styles.emptyText}>הכול נקי ✓</Text>
        ) : (
          openTasks.slice(0, 5).map((t) => (
            <Pressable key={t.id} style={styles.item} onPress={() => router.push('/tasks')}>
              <Text style={styles.itemTitle}>{t.title}</Text>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  greeting: { color: colors.text, fontSize: 24, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl' },
  subGreeting: { color: colors.textMuted, fontSize: 14, textAlign: 'right', marginTop: 2 },
  kpiRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 20 },
  kpi: {
    flex: 1,
    backgroundColor: colors.surfaceCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    alignItems: 'flex-end',
  },
  kpiNum: { fontSize: 26, fontWeight: '700' },
  kpiLabel: { color: colors.textMuted, fontSize: 12, marginTop: 4, textAlign: 'right', writingDirection: 'rtl' },
  section: { marginTop: 24 },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  item: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
  },
  itemTitle: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  itemMeta: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 4 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'right', writingDirection: 'rtl' },
  error: { color: colors.error, textAlign: 'center', padding: 8, marginTop: 8, writingDirection: 'rtl' },
})
