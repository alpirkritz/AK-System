import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { SectionHeader } from '../components/SectionHeader'
import { useAuth } from '../lib/auth'
import {
  createMemory,
  deleteMemory,
  fetchHugoInstructions,
  fetchMemories,
  setHugoInstructions,
  toggleMemoryPin,
  type MobileMemory,
} from '../lib/data'
import { colors } from '../lib/theme'

export default function MemoryScreen() {
  const { token } = useAuth()

  const [instructions, setInstructions] = useState('')
  const [instructionsEnabled, setInstructionsEnabled] = useState(true)
  const [savingInstructions, setSavingInstructions] = useState(false)

  const [memories, setMemories] = useState<MobileMemory[]>([])
  const [newMemory, setNewMemory] = useState('')
  const [creating, setCreating] = useState(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const [inst, mems] = await Promise.all([
          fetchHugoInstructions(token),
          fetchMemories(token),
        ])
        setInstructions(inst.content ?? '')
        setInstructionsEnabled(inst.enabled ?? true)
        const sorted = [...mems].sort((a, b) => {
          const ap = a.pinned ? 1 : 0
          const bp = b.pinned ? 1 : 0
          if (ap !== bp) return bp - ap
          return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
        })
        setMemories(sorted)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינה נכשלה')
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

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 2000)
  }

  const onSaveInstructions = async () => {
    if (!token) return
    setSavingInstructions(true)
    setError(null)
    try {
      await setHugoInstructions(token, instructions.trim(), instructionsEnabled)
      flash('הנחיות נשמרו')
    } catch {
      setError('שמירת הנחיות נכשלה')
    } finally {
      setSavingInstructions(false)
    }
  }

  const onCreateMemory = async () => {
    if (!token || !newMemory.trim()) return
    setCreating(true)
    setError(null)
    try {
      const created = await createMemory(token, newMemory.trim())
      setMemories((prev) => [created, ...prev])
      setNewMemory('')
      flash('זיכרון נוסף')
    } catch {
      setError('יצירת זיכרון נכשלה')
    } finally {
      setCreating(false)
    }
  }

  const onTogglePin = async (mem: MobileMemory) => {
    if (!token) return
    const pinned = !mem.pinned
    const prev = memories
    setMemories((rows) =>
      [...rows]
        .map((r) => (r.id === mem.id ? { ...r, pinned } : r))
        .sort((a, b) => {
          const ap = a.pinned ? 1 : 0
          const bp = b.pinned ? 1 : 0
          if (ap !== bp) return bp - ap
          return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
        }),
    )
    try {
      await toggleMemoryPin(token, mem.id, pinned)
    } catch {
      setMemories(prev)
      setError('עדכון נעיצה נכשל')
    }
  }

  const onDelete = (mem: MobileMemory) => {
    Alert.alert('למחוק זיכרון?', mem.content.slice(0, 80), [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          if (!token) return
          const prev = memories
          setMemories((rows) => rows.filter((r) => r.id !== mem.id))
          try {
            await deleteMemory(token, mem.id)
            flash('נמחק')
          } catch {
            setMemories(prev)
            setError('מחיקה נכשלה')
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <FlatList
        data={memories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <SectionHeader title="הנחיות קבועות ל-Hugo" style={styles.section} />
            <Card>
              <TextInput
                value={instructions}
                onChangeText={setInstructions}
                placeholder="מה Hugo צריך לדעת תמיד עליך?"
                placeholderTextColor={colors.textMuted}
                style={styles.instructionsInput}
                multiline
                textAlignVertical="top"
                textAlign="right"
              />
              <Pressable
                onPress={() => void onSaveInstructions()}
                disabled={savingInstructions}
                style={[styles.saveBtn, savingInstructions && styles.saveBtnDisabled]}
                accessibilityRole="button"
                accessibilityLabel="שמור הנחיות"
              >
                <Text style={styles.saveBtnText}>{savingInstructions ? 'שומר…' : 'שמור'}</Text>
              </Pressable>
            </Card>

            <SectionHeader title="זיכרונות" style={styles.section} />
            <View style={styles.createRow}>
              <TextInput
                value={newMemory}
                onChangeText={setNewMemory}
                placeholder="זיכרון חדש…"
                placeholderTextColor={colors.textMuted}
                style={styles.createInput}
                textAlign="right"
                returnKeyType="done"
                onSubmitEditing={() => void onCreateMemory()}
              />
              <Pressable
                onPress={() => void onCreateMemory()}
                disabled={creating || !newMemory.trim()}
                style={[styles.addBtn, (creating || !newMemory.trim()) && styles.addBtnDisabled]}
                accessibilityRole="button"
                accessibilityLabel="הוסף זיכרון"
              >
                <Text style={styles.addBtnText}>{creating ? '…' : 'הוסף'}</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="🧠" text="אין עדיין זיכרונות" compact />}
        renderItem={({ item }) => (
          <Card style={styles.memoryCard}>
            <View style={styles.memoryRow}>
              <Text style={styles.memoryText}>{item.content}</Text>
              {item.pinned ? <Text style={styles.pinBadge}>📌</Text> : null}
            </View>
            <View style={styles.memoryActions}>
              <Pressable
                onPress={() => void onTogglePin(item)}
                style={styles.actionBtn}
                accessibilityRole="button"
                accessibilityLabel={item.pinned ? 'בטל נעיצה' : 'נעץ'}
              >
                <Text style={styles.actionText}>{item.pinned ? 'בטל נעיצה' : 'נעץ'}</Text>
              </Pressable>
              <Pressable
                onPress={() => onDelete(item)}
                style={styles.actionBtn}
                accessibilityRole="button"
                accessibilityLabel="מחק זיכרון"
              >
                <Text style={styles.deleteText}>מחק</Text>
              </Pressable>
            </View>
          </Card>
        )}
      />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 32, gap: 10 },
  headerBlock: { gap: 8, marginBottom: 4 },
  section: { paddingHorizontal: 0 },
  instructionsInput: {
    minHeight: 100,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    writingDirection: 'rtl',
    marginBottom: 12,
  },
  saveBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 15, writingDirection: 'rtl' },
  createRow: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center' },
  createInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    minHeight: 48,
    writingDirection: 'rtl',
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.45 },
  addBtnText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
  memoryCard: { marginBottom: 0 },
  memoryRow: { flexDirection: 'row-reverse', gap: 8, alignItems: 'flex-start' },
  memoryText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pinBadge: { fontSize: 16 },
  memoryActions: {
    flexDirection: 'row-reverse',
    gap: 4,
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 4,
  },
  actionBtn: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  actionText: { color: colors.accent, fontSize: 13, writingDirection: 'rtl' },
  deleteText: { color: colors.error, fontSize: 13, writingDirection: 'rtl' },
  error: { color: colors.error, textAlign: 'center', writingDirection: 'rtl', padding: 12 },
  notice: { color: colors.success, textAlign: 'center', writingDirection: 'rtl', padding: 12 },
})
