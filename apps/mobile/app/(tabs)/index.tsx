import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
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
  fetchRelationshipBoard,
  fetchSelfPerson,
  fetchTasks,
  toggleTaskDone,
  type MobileDashboardPrefs,
  type MobileMeeting,
  type MobileTask,
} from '../../lib/data'
import { isMyTask } from '../../lib/my-tasks'
import { emptyMeetingsCopy, endDateForWindow } from '../../lib/dashboard-window'
import { groupTasksByDueState, limitTaskGroups, sortTasksByPriorityThenDue } from '../../lib/sort-tasks'
import { dueDay, isOverdueOpenTask, todayKey } from '../../lib/task-due'
import { pickAttentionShift, type AttentionShift } from '../../lib/attention-shift'
import { colors } from '../../lib/theme'

function greeting(hour: number): string {
  if (hour < 5) return 'לילה טוב'
  if (hour < 12) return 'בוקר טוב'
  if (hour < 17) return 'צהריים טובים'
  if (hour < 21) return 'ערב טוב'
  return 'לילה טוב'
}

function meetingSectionTitle(window: MobileDashboardPrefs['meetingWindow']): string {
  if (window === 'today') return 'פגישות היום'
  if (window === '3days') return 'פגישות 3 ימים'
  return 'פגישות השבוע'
}

function taskSectionTitle(window: MobileDashboardPrefs['taskWindow']): string {
  return window === 'today' ? 'שלי · היום, באיחור, ובלי תאריך' : 'המשימות שלי'
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
  const [selfId, setSelfId] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<MobileMeeting[]>([])
  const [prefs, setPrefs] = useState<MobileDashboardPrefs>({
    meetingWindow: 'today',
    taskWindow: 'today',
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [attention, setAttention] = useState<AttentionShift | null>(null)
  const hasLoadedOnce = useRef(false)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const [p, t, m, relationship, self] = await Promise.all([
          fetchDashboardPrefs(token),
          fetchTasks(token),
          fetchMeetings(token),
          fetchRelationshipBoard(token).catch(() => ({ people: [], circles: [] })),
          fetchSelfPerson(token),
        ])
        setPrefs(p)
        setTasks(t)
        setSelfId(self.id)
        setMeetings(m)
        setAttention(pickAttentionShift([...relationship.people, ...relationship.circles]))
        hasLoadedOnce.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת הנתונים נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  useFocusEffect(
    useCallback(() => {
      if (!token) return
      void load(hasLoadedOnce.current ? 'refresh' : 'initial')
    }, [token, load]),
  )

  const openTasks = useMemo(
    () => tasks.filter((t) => !t.done && isMyTask(t.assigneeId, selfId)),
    [tasks, selfId],
  )

  const overdueCount = useMemo(
    () => openTasks.filter((t) => isOverdueOpenTask(t)).length,
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
    const inWindow =
      prefs.taskWindow === 'all'
        ? openTasks
        : openTasks.filter((t) => !t.dueDate || t.dueDate <= todayKey())
    return limitTaskGroups(groupTasksByDueState(sortTasksByPriorityThenDue(inWindow)), 8)
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

      {attention ? (
        <Card style={styles.attention} onPress={() => router.push('/relationships' as Href)} accessibilityLabel="קשר שזז">
          <Text style={styles.attentionLabel}>קשר שזז</Text>
          <Text style={styles.itemTitle}>
            {attention.name} {attention.verb}
            {attention.rest > 0 ? ` · ועוד ${attention.rest}` : ''}
          </Text>
          {attention.dataReason ? (
            <Text style={styles.itemMeta} numberOfLines={2}>
              {attention.dataReason}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.kpiRow}>
        <KpiCard
          value={openTasks.length}
          label="המשימות שלי"
          color={colors.coral}
          accessibilityLabel={`המשימות שלי, ${openTasks.length}`}
          onPress={() =>
            router.push({ pathname: '/tasks', params: { filter: 'open' } } as Href)
          }
        />
        <KpiCard
          value={windowMeetings.length}
          label={meetingSectionTitle(prefs.meetingWindow)}
          color={colors.info}
          accessibilityLabel={meetingSectionTitle(prefs.meetingWindow)}
          onPress={() =>
            router.push({ pathname: '/meetings', params: { window: prefs.meetingWindow } } as Href)
          }
        />
        <KpiCard
          value={overdueCount}
          label="באיחור"
          color={colors.accent}
          accessibilityLabel={`משימות באיחור, ${overdueCount}`}
          onPress={() =>
            router.push({ pathname: '/tasks', params: { filter: 'overdue' } } as Href)
          }
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title={meetingSectionTitle(prefs.meetingWindow)} style={styles.sectionHeader} />
        {windowMeetings.length === 0 ? (
          <EmptyState text={emptyMeetingsCopy(prefs.meetingWindow)} compact />
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
          windowTasks.map((group) => (
            <View key={group.key}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              {group.tasks.map((t) => (
                <Card key={t.id} style={styles.item} accessibilityLabel={`משימה: ${t.title}`}>
                  <View style={styles.taskRow}>
                    <Pressable
                      onPress={() => router.push(`/task/${t.id}` as Href)}
                      style={styles.taskBody}
                      accessibilityRole="button"
                    >
                      <Text style={styles.itemTitle}>{t.title}</Text>
                      {dueDay(t.dueDate) ? (
                        <Text style={[styles.itemMeta, isOverdueOpenTask(t) && styles.itemMetaOverdue]}>
                          {isOverdueOpenTask(t) ? 'באיחור · ' : ''}
                          {new Date(dueDay(t.dueDate) + 'T00:00:00').toLocaleDateString('he-IL')}
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
              ))}
            </View>
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
  groupLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 6,
  },
  item: { marginBottom: 8 },
  itemTitle: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  itemMeta: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 4 },
  itemMetaOverdue: { color: colors.coral },
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
  attention: { marginTop: 16 },
  attentionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl', marginBottom: 4 },
})
