import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { useAuth } from '../../lib/auth'
import {
  fetchNotionConfigured,
  fetchTasks,
  fetchWorkspaces,
  syncTasksFromNotion,
  toggleTaskDone,
  type MobileTask,
  type MobileWorkspace,
} from '../../lib/data'
import {
  colors,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from '../../lib/theme'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type StatusFilter = 'open' | 'done' | 'cancelled' | 'all'

function effectiveStatus(t: MobileTask): string {
  return t.status ?? (t.done ? 'done' : 'not_started')
}

function StatusPill({ status }: { status: string }) {
  // Match web: silent for not_started and done — the checkbox already conveys those.
  if (!status || status === 'not_started' || status === 'done') return null
  const color = STATUS_COLOR[status] ?? colors.textMuted
  return (
    <View style={[styles.pill, { borderColor: color + '66', backgroundColor: color + '22' }]}>
      <Text style={[styles.pillText, { color }]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  )
}

export default function TasksScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [tasks, setTasks] = useState<MobileTask[]>([])
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('open')
  const [workspaceId, setWorkspaceId] = useState<string | 'all'>('all')
  const [notionConfigured, setNotionConfigured] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const [t, w, notion] = await Promise.all([
          fetchTasks(token),
          fetchWorkspaces(token),
          fetchNotionConfigured(token).catch(() => false),
        ])
        setTasks(t)
        setWorkspaces(w)
        setNotionConfigured(notion)
        hasLoadedOnce.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת המשימות נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  const onSync = async () => {
    if (!token || syncing) return
    setSyncing(true)
    setSyncMessage(null)
    setError(null)
    try {
      const res = await syncTasksFromNotion(token)
      const imported = res.tasksCreated + res.tasksUpdated
      setSyncMessage(
        res.errors.length > 0
          ? `יובאו ${imported} משימות · ${res.errors.length} שגיאות`
          : `יובאו ${imported} משימות מ-Notion`,
      )
      await load('refresh')
    } catch {
      setSyncMessage('הסנכרון נכשל')
    } finally {
      setSyncing(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (!token) return
      void load(hasLoadedOnce.current ? 'refresh' : 'initial')
    }, [token, load]),
  )

  const workspaceById = useMemo(() => {
    const map = new Map<string, MobileWorkspace>()
    for (const w of workspaces) map.set(w.id, w)
    return map
  }, [workspaces])

  const onToggle = async (id: string) => {
    if (!token) return
    const prev = tasks.find((t) => t.id === id)
    if (!prev) return
    const nextDone = !prev.done
    const nextStatus = nextDone ? 'done' : 'not_started'
    setTasks((list) =>
      list.map((t) => (t.id === id ? { ...t, done: nextDone, status: nextStatus } : t)),
    )
    try {
      const result = await toggleTaskDone(token, id)
      setTasks((list) =>
        list.map((t) =>
          t.id === id
            ? {
                ...t,
                done: result.done,
                status: result.status ?? nextStatus,
                notionStatusRaw: result.notionStatusRaw ?? t.notionStatusRaw,
              }
            : t,
        ),
      )
      if (result.notionSync && !result.notionSync.ok) {
        setError('עודכן מקומית, אבל העדכון ל-Notion נכשל')
      }
    } catch {
      setTasks((list) => list.map((t) => (t.id === id ? prev : t)))
      setError('לא הצלחתי לעדכן את המשימה')
    }
  }

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      const st = effectiveStatus(t)
      if (filter === 'open' && (st === 'done' || st === 'cancelled')) return false
      if (filter === 'done' && st !== 'done') return false
      if (filter === 'cancelled' && st !== 'cancelled') return false
      if (workspaceId !== 'all' && t.workspaceId !== workspaceId) return false
      return true
    })
  }, [tasks, filter, workspaceId])

  const filters: { id: StatusFilter; label: string }[] = [
    { id: 'open', label: 'פתוחות' },
    { id: 'done', label: 'הושלמו' },
    { id: 'cancelled', label: 'בוטלו' },
    { id: 'all', label: 'הכל' },
  ]

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      {notionConfigured ? (
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => void onSync()}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel="סנכרן משימות מ-Notion"
            accessibilityState={{ disabled: syncing }}
            style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          >
            {syncing ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            <Text style={styles.syncBtnText}>{syncing ? 'מסנכרן…' : 'סנכרן מ-Notion'}</Text>
          </Pressable>
        </View>
      ) : null}

      {syncMessage ? <Text style={styles.notice}>{syncMessage}</Text> : null}

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.id }}
            style={[styles.chip, filter === f.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {workspaces.length > 0 ? (
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setWorkspaceId('all')}
            accessibilityRole="button"
            accessibilityState={{ selected: workspaceId === 'all' }}
            style={[styles.chip, workspaceId === 'all' && styles.chipActive]}
          >
            <Text style={[styles.chipText, workspaceId === 'all' && styles.chipTextActive]}>
              כל המקורות
            </Text>
          </Pressable>
          {workspaces.map((w) => (
            <Pressable
              key={w.id}
              onPress={() => setWorkspaceId(w.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: workspaceId === w.id }}
              style={[styles.chip, workspaceId === w.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, workspaceId === w.id && styles.chipTextActive]}>
                {w.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={visible}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[styles.list, { paddingBottom: 88 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={styles.emptyText}>
              {filter === 'open' ? 'אין משימות פתוחות' : 'אין משימות להצגה'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const st = effectiveStatus(item)
          const isCancelled = st === 'cancelled'
          const workspace = item.workspaceId ? workspaceById.get(item.workspaceId) : null
          return (
            <View style={styles.taskRow}>
              <Pressable
                onPress={() => {
                  void onToggle(item.id)
                }}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={
                  isCancelled
                    ? 'שחזר משימה שבוטלה'
                    : item.done
                      ? 'סמן כלא בוצע'
                      : 'סמן כבוצע'
                }
                style={[
                  styles.checkbox,
                  item.done && styles.checkboxChecked,
                  isCancelled && styles.checkboxCancelled,
                ]}
              >
                {item.done ? (
                  <Text style={styles.checkMark}>{isCancelled ? '✕' : '✓'}</Text>
                ) : null}
              </Pressable>
              <Pressable
                style={styles.taskBody}
                onPress={() => router.push(`/task/${item.id}` as Href)}
                accessibilityRole="button"
                accessibilityLabel={`פרטי משימה: ${item.title}`}
              >
                <Text style={[styles.taskTitle, item.done && styles.taskTitleDone]}>
                  {item.title}
                </Text>
                <View style={styles.metaRow}>
                  <StatusPill status={st} />
                  {workspace ? (
                    <Text style={styles.taskMeta}>{workspace.name}</Text>
                  ) : null}
                  {item.dueDate ? (
                    <Text style={styles.taskMeta}>
                      {new Date(item.dueDate).toLocaleDateString('he-IL')}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              <View
                style={[
                  styles.priorityDot,
                  { backgroundColor: PRIORITY_COLOR[item.priority] ?? colors.textMuted },
                ]}
              />
              <Text style={styles.priorityLabel}>{PRIORITY_LABEL[item.priority] ?? ''}</Text>
            </View>
          )
        }}
      />

      <Pressable
        style={[styles.fab, { bottom: 16 + insets.bottom }]}
        onPress={() => router.push('/task/new' as Href)}
        accessibilityRole="button"
        accessibilityLabel="הוסף משימה"
      >
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  filterRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.accent + '22',
    borderColor: colors.accent,
  },
  chipText: { color: colors.textMuted, fontSize: 13, writingDirection: 'rtl' },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  syncBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  syncBtnDisabled: { opacity: 0.6 },
  syncBtnText: { color: colors.accent, fontSize: 14, fontWeight: '600', writingDirection: 'rtl' },
  notice: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  list: { paddingHorizontal: 16, flexGrow: 1 },
  taskRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  checkboxCancelled: {
    backgroundColor: STATUS_COLOR.cancelled,
    borderColor: STATUS_COLOR.cancelled,
  },
  checkMark: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  taskBody: { flex: 1, gap: 4 },
  taskTitle: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  taskTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  metaRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  taskMeta: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  pillText: { fontSize: 11, fontWeight: '600', writingDirection: 'rtl' },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  priorityLabel: { color: colors.textMuted, fontSize: 11, minWidth: 44, textAlign: 'left' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyIcon: { fontSize: 34, color: colors.success },
  emptyText: { color: colors.textMuted, fontSize: 15, writingDirection: 'rtl' },
  error: { color: colors.error, textAlign: 'center', padding: 8, writingDirection: 'rtl' },
  fab: {
    position: 'absolute',
    left: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPlus: { color: colors.bg, fontSize: 32, fontWeight: '400', lineHeight: 34 },
})
