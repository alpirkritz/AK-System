import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useAuth } from '../../lib/auth'
import { fetchTasks, toggleTaskDone, type MobileTask } from '../../lib/data'
import { colors, PRIORITY_COLOR, PRIORITY_LABEL } from '../../lib/theme'

type Filter = 'open' | 'done' | 'all'

export default function TasksScreen() {
  const { token } = useAuth()
  const [tasks, setTasks] = useState<MobileTask[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setTasks(await fetchTasks(token))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת המשימות נכשלה')
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

  const onToggle = async (id: string) => {
    if (!token) return
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
    try {
      await toggleTaskDone(token, id)
    } catch {
      // Revert on failure.
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
    }
  }

  const visible = tasks.filter((t) =>
    filter === 'open' ? !t.done : filter === 'done' ? t.done : true,
  )

  const filters: { id: Filter; label: string }[] = [
    { id: 'open', label: 'פתוחות' },
    { id: 'done', label: 'הושלמו' },
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
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[styles.chip, filter === f.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={visible}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
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
        renderItem={({ item }) => (
          <Pressable style={styles.taskRow} onPress={() => onToggle(item.id)}>
            <View style={[styles.checkbox, item.done && styles.checkboxChecked]}>
              {item.done && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <View style={styles.taskBody}>
              <Text style={[styles.taskTitle, item.done && styles.taskTitleDone]}>
                {item.title}
              </Text>
              {item.dueDate ? (
                <Text style={styles.taskMeta}>
                  {new Date(item.dueDate).toLocaleDateString('he-IL')}
                </Text>
              ) : null}
            </View>
            <View
              style={[styles.priorityDot, { backgroundColor: PRIORITY_COLOR[item.priority] ?? colors.textMuted }]}
            />
            <Text style={styles.priorityLabel}>{PRIORITY_LABEL[item.priority] ?? ''}</Text>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  filterRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent + '22',
    borderColor: colors.accent,
  },
  chipText: { color: colors.textMuted, fontSize: 13, writingDirection: 'rtl' },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  taskRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  checkMark: { color: colors.bg, fontSize: 13, fontWeight: '700' },
  taskBody: { flex: 1 },
  taskTitle: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  taskTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  taskMeta: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 2 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  priorityLabel: { color: colors.textMuted, fontSize: 11, minWidth: 44, textAlign: 'left' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyIcon: { fontSize: 34, color: colors.success },
  emptyText: { color: colors.textMuted, fontSize: 15, writingDirection: 'rtl' },
  error: { color: colors.error, textAlign: 'center', padding: 8, writingDirection: 'rtl' },
})
