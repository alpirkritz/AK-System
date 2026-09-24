import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Pressable } from 'react-native'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { FormSheetScaffold } from '../../components/FormSheetScaffold'
import { useAuth } from '../../lib/auth'
import {
  deletePerson,
  fetchPerson,
  fetchPersonContext,
  fetchPersonRelated,
  setCaptureWhatsapp,
  updatePerson,
  type MobilePersonContext,
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
  const [context, setContext] = useState<MobilePersonContext | null>(null)
  const [captureSaving, setCaptureSaving] = useState(false)

  const toggleCapture = async (enabled: boolean) => {
    if (!token || !id || !context) return
    setCaptureSaving(true)
    try {
      const on = await setCaptureWhatsapp(token, id, enabled)
      setContext({ ...context, captureWhatsapp: on })
    } catch (err) {
      Alert.alert('שגיאה', err instanceof Error ? err.message : 'השמירה נכשלה')
    } finally {
      setCaptureSaving(false)
    }
  }

  const load = useCallback(async () => {
    if (!token || !id) return
    setLoading(true)
    setError(null)
    try {
      const [person, related, ctx] = await Promise.all([
        fetchPerson(token, id),
        fetchPersonRelated(token, id).catch(() => null),
        fetchPersonContext(token, id).catch(() => null),
      ])
      setContext(ctx)
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

      {context && (context.recommendation || context.openLoops.length > 0 || context.circles.length > 0) ? (
        <View style={styles.contextCard}>
          <View style={styles.contextHeader}>
            <Text style={styles.contextTitle}>הקשר</Text>
            {context.warmthTrend === 'cooling' ? <Text style={[styles.warmth, styles.cooling]}>↓ מתקרר</Text> : null}
            {context.warmthTrend === 'warming' ? <Text style={[styles.warmth, styles.warming]}>↑ מתחמם</Text> : null}
          </View>
          {context.recommendation ? <Text style={styles.recommendation}>{context.recommendation}</Text> : null}
          {context.openLoops.slice(0, 3).map((l, i) => (
            <Text key={i} style={styles.contextLine}>• {l.content}</Text>
          ))}
          {context.whatsappSinceCount > 0 ? (
            <Text style={styles.contextMuted}>{context.whatsappSinceCount} הודעות וואטסאפ מאז הפגישה האחרונה</Text>
          ) : null}
          {context.circles.length > 0 ? (
            <Text style={styles.contextMuted}>חוגים: {context.circles.map((c) => c.seriesTitle).join(', ')}</Text>
          ) : null}
        </View>
      ) : null}

      {context ? (
        <View style={styles.contextCard}>
          <View style={styles.captureRow}>
            <Text style={styles.contextTitle}>תיעוד וואטסאפ 1:1</Text>
            <Switch
              value={context.captureWhatsapp}
              onValueChange={toggleCapture}
              disabled={captureSaving || (!context.captureWhatsapp && !context.captureReachable)}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel="תיעוד וואטסאפ 1:1"
            />
          </View>
          <Text style={styles.contextMuted}>
            {context.captureWhatsapp
              ? 'הודעות חדשות בצ׳אט הפרטי נשמרות בכרטיס'
              : context.captureReachable
                ? 'כבוי · שום הודעה פרטית לא נשמרת'
                : 'צריך טלפון או שולח מקושר כדי לזהות את הצ׳אט'}
          </Text>
          {context.dmSummary ? <Text style={styles.contextLine}>{context.dmSummary}</Text> : null}
          {context.proposedCommitmentCount > 0 ? (
            <Pressable onPress={() => router.push('/commitments' as Href)} accessibilityRole="link">
              <Text style={styles.commitmentsLink}>{context.proposedCommitmentCount} התחייבויות לאישור ›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

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
  contextCard: {
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginBottom: 8,
  },
  contextHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  contextTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '600', writingDirection: 'rtl' },
  warmth: { fontSize: 12, fontWeight: '600', writingDirection: 'rtl' },
  cooling: { color: '#facc15' },
  warming: { color: colors.success },
  recommendation: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
    borderRightWidth: 3,
    borderRightColor: colors.accent,
    paddingRight: 8,
  },
  contextLine: { color: colors.text, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  contextMuted: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  captureRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  commitmentsLink: { color: colors.accent, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', marginTop: 4 },
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
