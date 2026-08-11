import { useRouter, type Href } from 'expo-router'
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
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { KpiCard } from '../../components/KpiCard'
import { SectionHeader } from '../../components/SectionHeader'
import { useAuth } from '../../lib/auth'
import {
  fetchDashboardPrefs,
  fetchMeetings,
  fetchTasks,
  toggleTaskDone,
  type MobileDashboardPrefs,
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

function toDateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function todayKey(): string {
  return toDateKey(new Date())
}

function endDateForWindow(window: MobileDashboardPrefs['meetingWindow']): string {
  const d = new Date()
  if (window === 'today') return todayKey()
  if (window === '3days') {
    d.setDate(d.getDate() + 2)
    return toDateKey(d)
  }
  d.setDate(d.getDate() + 6)
  return toDateKey(d)
}

function meetingSectionTitle(window: MobileDashboardPrefs['meetingWindow']): string {
  if (window === 'today') return 'פגישות היום'
  if (window === '3days') return 'פגישות 3 ימים'
  return 'פגישות השבוע'
}

function taskSectionTitle(window: MobileDashboardPrefs['taskWindow']): string {
  return window === 'today' ? 'משימות להיום' : 'משימות פתוחות'
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
  const [prefs, setPrefs] = useState<MobileDashboardPrefs>({
    meetingWindow: 'today',
    taskWindow: 'today',
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const [p, t, m] = await Promise.all([
          fetchDashboardPrefs(token),
          fetchTasks(token),
          fetchMeetings(token),
        ])
        setPrefs(p)
        setTasks(t)
        setMeetings(m)
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
    void load()
  }, [load])

  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks])

  const overdueCount = useMemo(
    () =>
      openTasks.filter((t) => t.dueDate && t.dueDate < todayKey()).length,
    [openTasks],
  )

  const windowMeetings = useMemo(() => {
    const start = todayKey()
    const end = endDateForWindow(prefs.meetingWindow)
    return meetings
      .filter((m) => m.date >= start && m.date <= end && !isPast(m.date, m.time))
      .sort(
        (a, b) =>
          new Date(a.date + 'T' + (a.time || '00:00')).getTime() -
          new Date(b.date + 'T' + (b.time || '00:00')).getTime(),
      )
  }, [meetings, prefs.meetingWindow])

  const windowTasks = useMemo(() => {
    if (prefs.taskWindow === 'all') return openTasks
    const today = todayKey()
    return openTasks.filter(
      (t) => !t.dueDate || t.dueDate <= today,
    )
  }, [openTasks, prefs.taskWindow])

  const onToggleTask = async (task: MobileTask) => {
    if (!token || togglingId) return
    setTogglingId(task.id)
    try {
      const updated = await toggleTaskDone(token, task.id)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'עדכון נכשל')
    } finally {
      setTogglingId(null)
    }
  }

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
        <KpiCard
          value={openTasks.length}
          label="משימות פתוחות"
          color={colors.coral}
          onPress={() => router.push('/tasks' as Href)}
        />
        <KpiCard
          value={windowMeetings.length}
          label="פגישות בחלון"
          color={colors.info}
          onPress={() => router.push('/meetings' as Href)}
        />
        <KpiCard
          value={overdueCount}
          label="באיחור"
          color={colors.accent}
          onPress={() => router.push('/tasks' as Href)}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title={meetingSectionTitle(prefs.meetingWindow)} style={styles.sectionHeader} />
        {windowMeetings.length === 0 ? (
          <EmptyState text="אין פגישות בחלון" compact />
        ) : (
          windowMeetings.slice(0, 6).map((m) => (
            <Card
              key={m.id}
              style={styles.item}
              onPress={() => router.push(`/meeting/${m.id}` as Href)}
              accessibilityLabel={`פגישה: ${m.title}`}
            >
              <Text style={styles.itemTitle}>{m.title}</Text>
              <Text style={styles.itemMeta}>
                {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.time}
              </Text>
            </Card>
          ))
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader title={taskSectionTitle(prefs.taskWindow)} style={styles.sectionHeader} />
        {windowTasks.length === 0 ? (
          <EmptyState text="הכול נקי ✓" compact />
        ) : (
          windowTasks.slice(0, 8).map((t) => (
            <Card key={t.id} style={styles.item} accessibilityLabel={`משימה: ${t.title}`}>
              <View style={styles.taskRow}>
                <Pressable
                  onPress={() => router.push(`/task/${t.id}` as Href)}
                  style={styles.taskBody}
                  accessibilityRole="button"
                >
                  <Text style={styles.itemTitle}>{t.title}</Text>
                  {t.dueDate ? (
                    <Text style={styles.itemMeta}>
                      {t.dueDate < todayKey() ? 'באיחור · ' : ''}
                      {new Date(t.dueDate + 'T00:00:00').toLocaleDateString('he-IL')}
                    </Text>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => void onToggleTask(t)}
                  disabled={togglingId === t.id}
                  style={styles.checkBtn}
                  accessibilityRole="button"
                  accessibilityLabel="סמן כהושלם"
                >
                  <Text style={styles.checkIcon}>{togglingId === t.id ? '…' : '○'}</Text>
                </Pressable>
              </View>
            </Card>
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
  greeting: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subGreeting: { color: colors.textMuted, fontSize: 14, textAlign: 'right', marginTop: 2 },
  kpiRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 20 },
  section: { marginTop: 12 },
  sectionHeader: { paddingHorizontal: 0, paddingTop: 12, paddingBottom: 10 },
  item: { marginBottom: 8 },
  itemTitle: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  itemMeta: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 4 },
  taskRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  taskBody: { flex: 1 },
  checkBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIcon: { color: colors.accent, fontSize: 22, fontWeight: '600' },
  error: { color: colors.error, textAlign: 'center', padding: 8, marginTop: 8, writingDirection: 'rtl' },
})
