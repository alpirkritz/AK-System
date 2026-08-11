import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { FilterChips } from '../components/FilterChips'
import { useAuth } from '../lib/auth'
import {
  createReadingListItem,
  deleteReadingListItem,
  fetchReadingList,
  markReadingListItemRead,
  type MobileReadingListItem,
} from '../lib/data'
import { colors } from '../lib/theme'

function domainOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url)
  return match ? match[1].replace(/^www\./, '') : url
}

function isValidUrl(value: string): boolean {
  return /^https?:\/\/.+/i.test(value.trim())
}

export default function ReadingListScreen() {
  const { token } = useAuth()

  const [items, setItems] = useState<MobileReadingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all')

  const statusChips = useMemo(
    () => [
      { key: 'all', label: 'הכל' },
      { key: 'unread', label: 'לא נקרא' },
      { key: 'read', label: 'נקרא' },
    ],
    [],
  )

  const visibleItems = useMemo(() => {
    if (statusFilter === 'all') return items
    return items.filter((i) => i.status === statusFilter)
  }, [items, statusFilter])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setItems(await fetchReadingList(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setUrl('')
    setTitle('')
    setNote('')
    setFormError(null)
  }

  const onSave = async () => {
    if (!token) return
    if (!isValidUrl(url)) {
      setFormError('כתובת לא תקינה — ודא שהיא מתחילה ב-http:// או https://')
      return
    }
    if (!title.trim()) {
      setFormError('צריך כותרת לפריט')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const created = await createReadingListItem(token, {
        url: url.trim(),
        title: title.trim(),
        note: note.trim() || undefined,
      })
      setItems((prev) => [created, ...prev])
      resetForm()
      setFormOpen(false)
      setNotice('נשמר לרשימה')
      setTimeout(() => setNotice(null), 2000)
    } catch {
      setFormError('שמירה נכשלה — נסה שוב')
    } finally {
      setSaving(false)
    }
  }

  const onToggleRead = async (item: MobileReadingListItem) => {
    if (!token) return
    const read = item.status !== 'read'
    // Optimistic — the row flips immediately, reverted below if the call fails.
    setItems((prev) =>
      prev.map((r) => (r.id === item.id ? { ...r, status: read ? 'read' : 'unread' } : r)),
    )
    try {
      await markReadingListItemRead(token, item.id, read)
    } catch {
      setItems((prev) => prev.map((r) => (r.id === item.id ? item : r)))
      setError('עדכון נכשל — נסה שוב')
    }
  }

  const onDelete = (item: MobileReadingListItem) => {
    Alert.alert('למחוק את הפריט הזה?', 'לא ניתן לשחזר.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          if (!token) return
          const previous = items
          setItems((prev) => prev.filter((r) => r.id !== item.id))
          try {
            await deleteReadingListItem(token, item.id)
            setNotice('הפריט נמחק')
            setTimeout(() => setNotice(null), 2000)
          } catch {
            setItems(previous)
            setError('מחיקה נכשלה — נסה שוב')
          }
        },
      },
    ])
  }

  const openLink = (item: MobileReadingListItem) => {
    void Linking.openURL(item.url).catch(() => setError('לא ניתן לפתוח את הקישור'))
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <FilterChips
        items={statusChips}
        selectedKey={statusFilter}
        onSelect={(k) => setStatusFilter(k as 'all' | 'unread' | 'read')}
      />

      {formOpen ? (
        <View style={styles.form}>
          <Text style={styles.label}>קישור</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://..."
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textAlign="left"
            autoFocus
          />

          <Text style={styles.label}>כותרת</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="על מה זה?"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.inputRtl]}
            textAlign="right"
          />

          <Text style={styles.label}>הערה (אופציונלי)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="למה שמרתי את זה"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.inputRtl]}
            textAlign="right"
          />

          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <View style={styles.formActions}>
            <Pressable
              onPress={() => {
                resetForm()
                setFormOpen(false)
              }}
              style={styles.secondaryBtn}
              accessibilityRole="button"
              accessibilityLabel="ביטול"
            >
              <Text style={styles.secondaryBtnText}>ביטול</Text>
            </Pressable>
            <Pressable
              onPress={() => void onSave()}
              disabled={saving}
              style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="שמור לרשימה"
            >
              <Text style={styles.primaryBtnText}>{saving ? 'שומר…' : 'שמור לרשימה'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setFormOpen(true)}
          style={styles.addBtn}
          accessibilityRole="button"
          accessibilityLabel="הוסף קישור"
        >
          <Text style={styles.addBtnText}>הוסף קישור</Text>
        </Pressable>
      )}

      {visibleItems.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyText}>
            {items.length === 0
              ? 'אין עדיין פריטים ברשימת הקריאה. הדבק קישור ותן לו כותרת כדי להתחיל.'
              : 'אין פריטים בסינון הנוכחי.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const read = item.status === 'read'
            return (
              <View style={[styles.card, read && styles.cardRead]}>
                <Pressable
                  onPress={() => openLink(item)}
                  accessibilityRole="link"
                  accessibilityLabel={`פתח ${item.title}`}
                >
                  <Text style={[styles.title, read && styles.titleRead]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.domain} numberOfLines={1}>
                    {domainOf(item.url)}
                  </Text>
                  {item.note ? (
                    <Text style={styles.note} numberOfLines={2}>
                      {item.note}
                    </Text>
                  ) : null}
                </Pressable>

                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => void onToggleRead(item)}
                    style={styles.cardAction}
                    accessibilityRole="button"
                    accessibilityLabel={read ? 'סמן כלא נקרא' : 'סמן כנקרא'}
                  >
                    <Text style={[styles.cardActionText, read && styles.cardActionTextActive]}>
                      {read ? 'סמן כלא נקרא' : 'סמן כנקרא'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onDelete(item)}
                    style={styles.cardAction}
                    accessibilityRole="button"
                    accessibilityLabel={`מחק ${item.title}`}
                  >
                    <Text style={styles.deleteText}>מחק</Text>
                  </Pressable>
                </View>
              </View>
            )
          }}
        />
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 16, gap: 10 },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 10,
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
  form: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 4,
  },
  formActions: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 16,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    minHeight: 48,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: colors.textMuted, fontSize: 15, writingDirection: 'rtl' },
  addBtn: {
    margin: 16,
    marginBottom: 0,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: colors.accent, fontSize: 16, fontWeight: '600', writingDirection: 'rtl' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardRead: { opacity: 0.6 },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  titleRead: { textDecorationLine: 'line-through' },
  domain: { color: colors.info, fontSize: 12, textAlign: 'right', marginTop: 4 },
  note: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 6,
    lineHeight: 19,
  },
  cardActions: {
    flexDirection: 'row-reverse',
    gap: 4,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 4,
  },
  cardAction: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  cardActionText: { color: colors.textMuted, fontSize: 13, writingDirection: 'rtl' },
  cardActionTextActive: { color: colors.accent },
  deleteText: { color: colors.error, fontSize: 13, writingDirection: 'rtl' },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    writingDirection: 'rtl',
    lineHeight: 22,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    writingDirection: 'rtl',
    padding: 12,
  },
  notice: {
    color: colors.success,
    textAlign: 'center',
    writingDirection: 'rtl',
    padding: 12,
  },
})
