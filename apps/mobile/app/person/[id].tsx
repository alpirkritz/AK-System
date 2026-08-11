import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Pressable } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { FormSheetScaffold } from '../../components/FormSheetScaffold'
import { useAuth } from '../../lib/auth'
import {
  deletePerson,
  fetchPerson,
  fetchPersonRelated,
  updatePerson,
} from '../../lib/data'
import { colors } from '../../lib/theme'

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { token } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [company, setCompany] = useState('')
  const [meetingCount, setMeetingCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)

  const load = useCallback(async () => {
    if (!token || !id) return
    setLoading(true)
    setError(null)
    try {
      const [person, related] = await Promise.all([
        fetchPerson(token, id),
        fetchPersonRelated(token, id).catch(() => null),
      ])
      if (!person) {
        setError('איש הקשר לא נמצא')
        return
      }
      setName(person.name)
      setRole(person.role ?? '')
      setCompany(person.company ?? '')
      if (related && typeof related === 'object') {
        const r = related as { meetings?: unknown[]; tasks?: unknown[] }
        setMeetingCount(r.meetings?.length ?? 0)
        setTaskCount(r.tasks?.length ?? 0)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, id])

  useEffect(() => {
    void load()
  }, [load])

  const onSave = async () => {
    if (!token || !id) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('צריך שם')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updatePerson(token, {
        id,
        name: trimmed,
        role: role.trim() || null,
        company: company.trim() || null,
      })
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = () => {
    Alert.alert('מחיקת איש קשר', 'למחוק את איש הקשר?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!token || !id) return
            try {
              await deletePerson(token, id)
              router.back()
            } catch {
              setError('מחיקה נכשלה')
            }
          })()
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
    <FormSheetScaffold
      title="פרטי איש קשר"
      onSave={() => void onSave()}
      saving={saving}
      saveDisabled={!name.trim()}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {(meetingCount > 0 || taskCount > 0) && (
        <View style={styles.stats}>
          {meetingCount > 0 ? (
            <Text style={styles.statText}>{meetingCount} פגישות</Text>
          ) : null}
          {taskCount > 0 ? (
            <Text style={styles.statText}>{taskCount} משימות</Text>
          ) : null}
        </View>
      )}

      <Text style={styles.label}>שם</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="שם מלא"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Text style={styles.label}>תפקיד</Text>
      <TextInput
        value={role}
        onChangeText={setRole}
        placeholder="תפקיד"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Text style={styles.label}>חברה</Text>
      <TextInput
        value={company}
        onChangeText={setCompany}
        placeholder="חברה"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Pressable onPress={onDelete} style={styles.deleteBtn} accessibilityRole="button">
        <Text style={styles.deleteText}>מחק איש קשר</Text>
      </Pressable>
    </FormSheetScaffold>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  stats: {
    flexDirection: 'row-reverse',
    gap: 16,
    marginBottom: 8,
    paddingVertical: 8,
  },
  statText: { color: colors.textMuted, fontSize: 13, writingDirection: 'rtl' },
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
