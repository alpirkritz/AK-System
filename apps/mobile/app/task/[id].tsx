import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '../../lib/auth'
import {
  createTask,
  fetchTask,
  fetchWorkspaces,
  updateTask,
  type MobileWorkspace,
} from '../../lib/data'
import {
  colors,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
} from '../../lib/theme'

const PRIORITIES = ['high', 'medium', 'low'] as const

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const { token } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notionHint, setNotionHint] = useState(false)
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([])

  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<string>('not_started')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [dueDate, setDueDate] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const ws = await fetchWorkspaces(token)
      setWorkspaces(ws)
      if (!isNew && id) {
        setLoading(true)
        const task = await fetchTask(token, id)
        if (!task) {
          setError('המשימה לא נמצאה')
          return
        }
        setTitle(task.title)
        setStatus(task.status ?? (task.done ? 'done' : 'not_started'))
        setPriority(task.priority)
        setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '')
        setWorkspaceId(task.workspaceId ?? null)
        setNotionHint(task.source === 'notion' && Boolean(task.notionPageId))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, id, isNew])

  useEffect(() => {
    void load()
  }, [load])

  const onSave = async () => {
    if (!token) return
    const trimmed = title.trim()
    if (!trimmed) {
      setError('צריך כותרת למשימה')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title: trimmed,
        status,
        priority,
        dueDate: dueDate.trim() || null,
        workspaceId,
      }
      if (isNew) {
        await createTask(token, payload)
      } else if (id) {
        const result = await updateTask(token, id, payload)
        if (result.notionSync && !result.notionSync.ok) {
          setError('נשמר מקומית, אבל העדכון ל-Notion נכשל')
          setSaving(false)
          // Still dismiss after a beat so the user sees the message, then leave.
          setTimeout(() => router.back(), 1200)
          return
        }
      }
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
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
    <>
      <Stack.Screen
        options={{
          title: isNew ? 'משימה חדשה' : 'פרטי משימה',
          headerRight: () => (
            <Pressable
              onPress={() => void onSave()}
              disabled={saving || !title.trim()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="שמור"
            >
              <Text
                style={[
                  styles.headerAction,
                  (saving || !title.trim()) && styles.headerActionDisabled,
                ]}
              >
                {saving ? 'שומר…' : 'שמור'}
              </Text>
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="ביטול"
            >
              <Text style={styles.headerAction}>ביטול</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {notionHint ? (
          <View style={styles.hint}>
            <Text style={styles.hintText}>
              מסונכרן עם Notion — שינוי סטטוס יעודכן גם שם
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>כותרת</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="מה צריך לעשות?"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.inputRtl]}
          autoFocus={isNew}
          textAlign="right"
        />

        <Text style={styles.label}>סטטוס</Text>
        <View style={styles.chips}>
          {STATUS_ORDER.map((key) => {
            const active = status === key
            const color = STATUS_COLOR[key]
            return (
              <Pressable
                key={key}
                onPress={() => setStatus(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  active && {
                    borderColor: color,
                    backgroundColor: color + '22',
                  },
                ]}
              >
                <Text
                  style={[styles.chipText, active && { color, fontWeight: '600' }]}
                >
                  {STATUS_LABEL[key]}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>עדיפות</Text>
        <View style={styles.chips}>
          {PRIORITIES.map((key) => {
            const active = priority === key
            const color = PRIORITY_COLOR[key]
            return (
              <Pressable
                key={key}
                onPress={() => setPriority(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  active && {
                    borderColor: color,
                    backgroundColor: color + '22',
                  },
                ]}
              >
                <Text
                  style={[styles.chipText, active && { color, fontWeight: '600' }]}
                >
                  {PRIORITY_LABEL[key]}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>תאריך יעד (YYYY-MM-DD)</Text>
        <TextInput
          value={dueDate}
          onChangeText={setDueDate}
          placeholder="2026-07-30"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          textAlign="left"
        />

        {workspaces.length > 0 ? (
          <>
            <Text style={styles.label}>מקור</Text>
            <View style={styles.chips}>
              <Pressable
                onPress={() => setWorkspaceId(null)}
                accessibilityRole="button"
                accessibilityState={{ selected: workspaceId === null }}
                style={[styles.chip, workspaceId === null && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    workspaceId === null && styles.chipTextActive,
                  ]}
                >
                  ללא
                </Text>
              </Pressable>
              {workspaces.map((w) => {
                const active = workspaceId === w.id
                return (
                  <Pressable
                    key={w.id}
                    onPress={() => setWorkspaceId(w.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {w.name}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </>
        ) : null}

        <Pressable
          style={[styles.saveBtn, (saving || !title.trim()) && styles.saveBtnDisabled]}
          onPress={() => void onSave()}
          disabled={saving || !title.trim()}
          accessibilityRole="button"
          accessibilityLabel="שמור משימה"
        >
          <Text style={styles.saveBtnText}>{saving ? 'שומר…' : 'שמור'}</Text>
        </Pressable>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 20, gap: 8, paddingBottom: 40 },
  headerAction: { color: colors.accent, fontSize: 16, fontWeight: '600', paddingHorizontal: 8 },
  headerActionDisabled: { color: colors.textMuted },
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
  chips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
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
  hint: {
    backgroundColor: colors.info + '22',
    borderColor: colors.info + '66',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
  },
  hintText: {
    color: colors.info,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingVertical: 4,
  },
  saveBtn: {
    marginTop: 24,
    backgroundColor: colors.accent,
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
})
