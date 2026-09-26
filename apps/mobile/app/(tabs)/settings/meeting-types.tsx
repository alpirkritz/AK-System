import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { ListRow } from '../../components/ListRow'
import { useAuth } from '../../lib/auth'
import {
  createMeetingType,
  deleteMeetingType,
  fetchMeetingTypes,
  type MobileMeetingType,
} from '../../lib/data'
import { colors } from '../../lib/theme'

export default function MeetingTypesSettingsScreen() {
  const { token } = useAuth()
  const [rows, setRows] = useState<MobileMeetingType[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setRows(await fetchMeetingTypes(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    const name = newName.trim()
    if (!token || !name || busy) return
    setBusy(true)
    setError(null)
    try {
      await createMeetingType(token, { name })
      setNewName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'יצירה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const onDelete = (mt: MobileMeetingType) => {
    Alert.alert('למחוק סוג פגישה?', mt.name, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          if (!token) return
          setBusy(true)
          try {
            await deleteMeetingType(token, mt.id)
            await load()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'מחיקה נכשלה')
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.group}>
        {rows.length === 0 ? (
          <Text style={styles.empty}>אין סוגי פגישות</Text>
        ) : (
          rows.map((mt) => (
            <ListRow
              key={mt.id}
              label={mt.name}
              onPress={() => onDelete(mt)}
              accessibilityLabel={`מחק ${mt.name}`}
            />
          ))
        )}
      </View>

      <View style={styles.createRow}>
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="שם סוג חדש"
          placeholderTextColor={colors.textMuted}
          textAlign="right"
          editable={!busy}
        />
        <Pressable
          style={[styles.addBtn, (!newName.trim() || busy) && styles.addBtnDisabled]}
          onPress={() => void onCreate()}
          disabled={!newName.trim() || busy}
        >
          <Text style={styles.addBtnText}>הוסף</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>לחיצה על שורה תפתח אישור מחיקה</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  group: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    padding: 24,
    writingDirection: 'rtl',
  },
  createRow: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 16,
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    minHeight: 48,
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: colors.bg, fontWeight: '600', fontSize: 15 },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
})
