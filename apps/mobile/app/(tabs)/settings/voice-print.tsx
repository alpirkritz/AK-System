import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { useAuth } from '../../../lib/auth'
import { colors } from '../../../lib/theme'
import { deleteVoicePrint, enrollVoicePrint, fetchVoicePrintStatus } from '../../../lib/voice'
import { voiceClock } from '../../../lib/voice-format'

/**
 * Self-voice enrollment (see docs/specs/recording-background-and-speaker-id.md — MVP scope:
 * one enrolled voiceprint, Alpir's own; recordings are then auto-tagged with him when detected,
 * everyone else stays manually tagged like today).
 */

const MIN_SAMPLE_SECONDS = 15
const TARGET_SAMPLE_SECONDS = 25

const SAMPLE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 48000 }

export default function VoicePrintScreen() {
  const { token } = useAuth()
  const recorder = useAudioRecorder(SAMPLE_OPTIONS)
  const state = useAudioRecorderState(recorder, 200)
  const [status, setStatus] = useState<{ enrolled: boolean; updatedAt: string | null } | null>(null)
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading'>('idle')
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      setStatus(await fetchVoicePrintStatus(token))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'טעינת הסטטוס נכשלה')
    }
  }, [token])

  useFocusEffect(
    useCallback(() => {
      if (!token) return
      void load()
    }, [token, load]),
  )

  const elapsedSeconds = Math.floor(state.durationMillis / 1000)

  const start = async () => {
    setMessage(null)
    setPermissionDenied(false)
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      setPermissionDenied(true)
      return
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setPhase('recording')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'לא ניתן להתחיל הקלטה')
    }
  }

  const stopAndSave = async () => {
    if (!token) return
    const durationSeconds = state.durationMillis / 1000
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
    const uri = recorder.uri
    if (!uri) {
      setPhase('idle')
      setMessage('ההקלטה לא נשמרה במכשיר')
      return
    }
    if (durationSeconds < MIN_SAMPLE_SECONDS) {
      setPhase('idle')
      setMessage(`דוגמה קצרה מדי — נסה שוב, לפחות ${MIN_SAMPLE_SECONDS} שניות של דיבור`)
      return
    }
    setPhase('uploading')
    try {
      await enrollVoicePrint(token, uri, 'audio/mp4')
      setPhase('idle')
      setMessage(null)
      await load()
    } catch (err) {
      setPhase('idle')
      setMessage(err instanceof Error ? err.message : 'הרישום נכשל')
    }
  }

  const onDelete = async () => {
    if (!token) return
    setBusy(true)
    setMessage(null)
    try {
      await deleteVoicePrint(token)
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'המחיקה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>זיהוי קולי אוטומטי</Text>
        <Text style={styles.body}>
          הקלטה קצרה של הקול שלך מאפשרת למערכת לזהות אוטומטית מתי אתה מדבר בהקלטה חדשה, ולתייג אותך
          כמשתתף בלי לעשות את זה ידנית בכל פעם. משתתפים אחרים ממשיכים להיות מתויגים ידנית כמו היום.
        </Text>
        <Text style={styles.muted}>
          זו התאמה על בסיס מאפייני קול (לא מודל AI מאומן) — יכולות להיות טעויות מדי פעם, בעיקר בהקלטות
          רועשות או קצרות.
        </Text>

        {status ? (
          <View style={styles.statusRow}>
            <View style={[styles.dot, status.enrolled ? styles.dotOn : styles.dotOff]} />
            <Text style={styles.body}>{status.enrolled ? 'הקול שלך רשום במערכת' : 'עדיין לא נרשם קול'}</Text>
          </View>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>

      {phase === 'idle' ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            {status?.enrolled ? 'רישום מחדש' : 'רישום ראשוני'}
          </Text>
          <Text style={styles.muted}>
            תקריא בקול רגיל במשך כ-{TARGET_SAMPLE_SECONDS} שניות — למשל לספר מה עשית היום. ודא שאתה במקום שקט יחסית.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => void start()} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>התחל הקלטת דוגמה</Text>
          </Pressable>
          {permissionDenied ? <Text style={styles.error}>אין גישה למיקרופון. אפשר לאשר אותה בהגדרות המכשיר.</Text> : null}
          {status?.enrolled ? (
            <Pressable style={[styles.secondaryBtn, busy && styles.disabled]} disabled={busy} onPress={() => void onDelete()} accessibilityRole="button">
              <Text style={styles.secondaryBtnText}>{busy ? 'מוחק…' : 'מחק רישום קול'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {phase === 'recording' ? (
        <View style={styles.card}>
          <View style={styles.timerRow}>
            <View style={[styles.dot, styles.dotLive]} />
            <Text style={styles.timer}>{voiceClock(elapsedSeconds)}</Text>
          </View>
          <Pressable style={styles.primaryBtn} onPress={() => void stopAndSave()} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>סיים ושמור</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'uploading' ? (
        <View style={styles.card}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>שומר דוגמת קול…</Text>
        </View>
      ) : null}

      {message ? <Text style={styles.error} accessibilityRole="alert">{message}</Text> : null}
    </ScrollView>
  )
}

const rtl = { textAlign: 'right' as const, writingDirection: 'rtl' as const }

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surfaceCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', ...rtl },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, ...rtl },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19, ...rtl },
  sectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', ...rtl },
  error: { color: colors.error, fontSize: 13, ...rtl },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: colors.success },
  dotOff: { backgroundColor: colors.textMuted },
  dotLive: { backgroundColor: colors.coral },
  timerRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  timer: { color: colors.text, fontSize: 30, fontWeight: '600', fontVariant: ['tabular-nums'] },
  primaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryBtnText: { color: colors.coral, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
})
