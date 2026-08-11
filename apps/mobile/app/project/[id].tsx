import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { FormSheetScaffold } from '../../components/FormSheetScaffold'
import { useAuth } from '../../lib/auth'
import {
  deleteProject,
  fetchProject,
  fetchTasks,
  toggleTaskDone,
  updateProject,
  type MobileTask,
} from '../../lib/data'
import { colors } from '../../lib/theme'

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { token } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tasks, setTasks] = useState<MobileTask[]>([])

  const load = useCallback(async () => {
    if (!token || !id) return
    setLoading(true)
    setError(null)
    try {
      const [project, allTasks] = await Promise.all([
        fetchProject(token, id),
        fetchTasks(token),
      ])
      if (!project) {
        setError('הפרויקט לא נמצא')
        return
      }
      setName(project.name)
      setDescription(project.description ?? '')
      setTasks(allTasks.filter((t) => t.projectId === id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, id])

  useEffect(() => {
    void load()
  }, [load])

  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks])

  const onSave = async () => {
    if (!token || !id) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('צריך שם לפרויקט')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateProject(token, {
        id,
        name: trimmed,
        description: description.trim() || null,
      })
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = () => {
    Alert.alert('מחיקת פרויקט', 'למחוק את הפרויקט?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!token || !id) return
            try {
              await deleteProject(token, id)
              router.back()
            } catch {
              setError('מחיקה נכשלה')
            }
          })()
        },
      },
    ])
  }

  const onToggleTask = async (taskId: string) => {
    if (!token) return
    const prev = tasks.find((t) => t.id === taskId)
    if (!prev) return
    setTasks((list) =>
      list.map((t) =>
        t.id === taskId ? { ...t, done: !t.done, status: !t.done ? 'done' : 'not_started' } : t,
      ),
    )
    try {
      const result = await toggleTaskDone(token, taskId)
      setTasks((list) =>
        list.map((t) =>
          t.id === taskId
            ? { ...t, done: result.done, status: result.status ?? t.status }
            : t,
        ),
      )
    } catch {
      setTasks((list) => list.map((t) => (t.id === taskId ? prev : t)))
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
    <FormSheetScaffold
      title="פרטי פרויקט"
      onSave={() => void onSave()}
      saving={saving}
      saveDisabled={!name.trim()}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>שם</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="שם הפרויקט"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Text style={styles.label}>תיאור</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="תיאור…"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl, styles.multiline]}
        textAlign="right"
        multiline
      />

      <Text style={styles.sectionTitle}>
        משימות ({openTasks.length} פתוחות)
      </Text>
      {tasks.length === 0 ? (
        <Text style={styles.emptyTasks}>אין משימות בפרויקט</Text>
      ) : (
        tasks.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <Pressable
              onPress={() => void onToggleTask(task.id)}
              style={[styles.checkbox, task.done && styles.checkboxDone]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: task.done }}
            >
              {task.done ? <Text style={styles.checkMark}>✓</Text> : null}
            </Pressable>
            <Text style={[styles.taskTitle, task.done && styles.taskDone]}>{task.title}</Text>
          </View>
        ))
      )}

      <Pressable onPress={onDelete} style={styles.deleteBtn} accessibilityRole="button">
        <Text style={styles.deleteText}>מחק פרויקט</Text>
      </Pressable>
    </FormSheetScaffold>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
  },
  inputRtl: { writingDirection: 'rtl' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 20,
    marginBottom: 8,
  },
  emptyTasks: { color: colors.textMuted, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  taskRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: colors.success, borderColor: colors.success },
  checkMark: { color: colors.bg, fontSize: 14, fontWeight: '700' },
  taskTitle: { flex: 1, color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  taskDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  error: { color: colors.error, textAlign: 'center', writingDirection: 'rtl', paddingVertical: 4 },
  deleteBtn: {
    marginTop: 32,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.coral + '66',
  },
  deleteText: { color: colors.coral, fontSize: 16, fontWeight: '600', writingDirection: 'rtl' },
})
