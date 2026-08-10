import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '../../lib/auth'
import {
  createTask,
  fetchPeople,
  fetchSelfPerson,
  fetchTask,
  fetchWorkspaces,
  updateTask,
  type MobilePerson,
  type MobileWorkspace,
  type TaskInput,
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

/** Local-time YYYY-MM-DD — `toISOString()` would shift the day across timezones. */
function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateLabel(value: string): string {
  const date = parseDateInput(value)
  if (!date) return value
  return date.toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [people, setPeople] = useState<MobilePerson[]>([])
  const [selfPersonId, setSelfPersonId] = useState<string | null>(null)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState('')

  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId)
  const willCreateInNotion = isNew && (selectedWorkspace?.notionDatabases?.length ?? 0) > 0
  const assignee = people.find((p) => p.id === assigneeId) ?? null

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [ws, contacts, self] = await Promise.all([
        fetchWorkspaces(token),
        fetchPeople(token),
        fetchSelfPerson(token),
      ])
      setWorkspaces(ws)
      // The owner may not be in `people.list` yet on a fresh install.
      setPeople(contacts.some((p) => p.id === self.id) ? contacts : [self, ...contacts])
      setSelfPersonId(self.id)
      if (isNew) {
        setAssigneeId(self.id)
      } else if (id) {
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
        setAssigneeId(task.assigneeId ?? null)
        setNotionHint(task.source === 'notion' && Boolean(task.notionPageId))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, id, isNew])

  const visiblePeople = useMemo(() => {
    const ordered = selfPersonId
      ? [
          ...people.filter((p) => p.id === selfPersonId),
          ...people.filter((p) => p.id !== selfPersonId),
        ]
      : people
    const q = assigneeSearch.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.company ?? '').toLowerCase().includes(q) ||
        (p.role ?? '').toLowerCase().includes(q),
    )
  }, [people, selfPersonId, assigneeSearch])

  const closeAssigneePicker = () => {
    setAssigneePickerOpen(false)
    setAssigneeSearch('')
  }

  const pickAssignee = (personId: string | null) => {
    setAssigneeId(personId)
    closeAssigneePicker()
  }

  useEffect(() => {
    void load()
  }, [load])

  const onPickDate = (event: DateTimePickerEvent, picked?: Date) => {
    // Android owns its own dialog and fires once; iOS keeps the inline picker
    // mounted until the user dismisses it explicitly.
    if (Platform.OS !== 'ios') setPickerOpen(false)
    if (event.type === 'dismissed' || !picked) return
    setDueDate(toDateInput(picked))
  }

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
      const payload: TaskInput = {
        title: trimmed,
        status,
        priority,
        dueDate: dueDate.trim() || null,
        workspaceId,
      }
      // Only send an assignee once the picker actually has state. If loading the
      // owner failed, omitting the key lets the server apply its own default
      // rather than silently creating an unassigned task.
      if (assigneeId !== null || selfPersonId !== null) payload.assigneeId = assigneeId
      if (isNew) {
        const result = await createTask(token, payload)
        if (result.notionSync && !result.notionSync.ok) {
          setError('המשימה נשמרה, אבל לא נוצרה ב-Notion')
          setSaving(false)
          // Still dismiss after a beat so the user sees the message, then leave.
          setTimeout(() => router.back(), 1200)
          return
        }
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

      {/* iOS needs explicit padding; Android relies on softwareKeyboardLayoutMode: 'resize'
          in app.config.ts, and stacking both causes double-adjustment inside a formSheet. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
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

          <Text style={styles.label}>אחראי</Text>
          <Pressable
            onPress={() => setAssigneePickerOpen(true)}
            style={[styles.input, styles.assigneeField]}
            accessibilityRole="button"
            accessibilityLabel={assignee ? `אחראי ${assignee.name}` : 'בחר אחראי'}
          >
            <Text style={[styles.dateText, !assignee && styles.datePlaceholder]}>
              {assignee ? assignee.name : 'ללא אחראי'}
            </Text>
            {assignee && assignee.id === selfPersonId ? (
              <Text style={styles.selfTag}>אני</Text>
            ) : null}
          </Pressable>

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

          <Text style={styles.label}>תאריך יעד</Text>
          <View style={styles.dateRow}>
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={[styles.input, styles.dateField]}
              accessibilityRole="button"
              accessibilityLabel={
                dueDate ? `תאריך יעד ${formatDateLabel(dueDate)}` : 'בחר תאריך יעד'
              }
            >
              <Text style={[styles.dateText, !dueDate && styles.datePlaceholder]}>
                {dueDate ? formatDateLabel(dueDate) : 'בחר תאריך'}
              </Text>
            </Pressable>
            {dueDate ? (
              <Pressable
                onPress={() => setDueDate('')}
                style={styles.clearDate}
                accessibilityRole="button"
                accessibilityLabel="נקה תאריך"
              >
                <Text style={styles.clearDateText}>נקה תאריך</Text>
              </Pressable>
            ) : null}
          </View>

          {pickerOpen ? (
            <DateTimePicker
              value={parseDateInput(dueDate) ?? new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={onPickDate}
              themeVariant="dark"
            />
          ) : null}

          {pickerOpen && Platform.OS === 'ios' ? (
            <Pressable
              onPress={() => setPickerOpen(false)}
              style={styles.pickerDone}
              accessibilityRole="button"
              accessibilityLabel="סיים בחירת תאריך"
            >
              <Text style={styles.pickerDoneText}>סיום</Text>
            </Pressable>
          ) : null}

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
              {willCreateInNotion ? (
                <View style={styles.hint}>
                  <Text style={styles.hintText}>
                    המשימה תיווצר גם ב-Notion ({selectedWorkspace?.name})
                  </Text>
                </View>
              ) : null}
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
      </KeyboardAvoidingView>

      <Modal
        visible={assigneePickerOpen}
        animationType="slide"
        transparent
        onRequestClose={closeAssigneePicker}
      >
        <Pressable style={styles.modalOverlay} onPress={closeAssigneePicker}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>אחראי</Text>
            <TextInput
              value={assigneeSearch}
              onChangeText={setAssigneeSearch}
              placeholder="התחל להקליד שם..."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.inputRtl]}
              textAlign="right"
              autoFocus
              accessibilityLabel="חיפוש אחראי"
            />
            <Pressable
              onPress={() => pickAssignee(null)}
              style={styles.personRow}
              accessibilityRole="button"
              accessibilityState={{ selected: assigneeId === null }}
            >
              <Text style={[styles.personName, styles.personNameMuted]}>ללא אחראי</Text>
            </Pressable>
            <FlatList
              data={visiblePeople}
              keyExtractor={(p) => p.id}
              keyboardShouldPersistTaps="handled"
              style={styles.personList}
              ListEmptyComponent={<Text style={styles.emptyText}>לא נמצא איש קשר</Text>}
              renderItem={({ item }) => {
                const active = item.id === assigneeId
                return (
                  <Pressable
                    onPress={() => pickAssignee(item.id)}
                    style={styles.personRow}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[styles.personName, active && styles.personNameActive]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {item.id === selfPersonId ? <Text style={styles.selfTag}>אני</Text> : null}
                    {item.company ? (
                      <Text style={styles.personMeta} numberOfLines={1}>
                        {item.company}
                      </Text>
                    ) : null}
                  </Pressable>
                )
              }}
            />
            <Pressable
              onPress={closeAssigneePicker}
              style={styles.modalClose}
              accessibilityRole="button"
              accessibilityLabel="סגור בחירת אחראי"
            >
              <Text style={styles.modalCloseText}>סגור</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  dateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  dateField: { flex: 1, justifyContent: 'center' },
  assigneeField: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  selfTag: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: colors.accent + '55',
    backgroundColor: colors.accent + '22',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surfaceCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
    maxHeight: '80%',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  personList: { flexGrow: 0 },
  personRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  personName: {
    color: colors.text,
    fontSize: 15,
    textAlign: 'right',
    writingDirection: 'rtl',
    flexShrink: 1,
  },
  personNameActive: { color: colors.accent, fontWeight: '600' },
  personNameMuted: { color: colors.textMuted },
  personMeta: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl', flexShrink: 1 },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    paddingVertical: 12,
  },
  modalClose: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  dateText: { color: colors.text, fontSize: 16, textAlign: 'right', writingDirection: 'rtl' },
  datePlaceholder: { color: colors.textMuted },
  clearDate: {
    minHeight: 48,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  clearDateText: { color: colors.textMuted, fontSize: 13, writingDirection: 'rtl' },
  pickerDone: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  pickerDoneText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
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
