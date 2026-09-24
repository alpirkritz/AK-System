import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'
import {
  attachVoiceToMeeting,
  fetchAttachCandidates,
  fetchVoiceAnalysis,
  fetchVoiceRecording,
  retryVoiceRecording,
  uploadVoiceRecording,
  type MobileAttachCandidate,
  type MobileVoiceAnalysis,
  type MobileVoiceRecording,
} from '../lib/voice'
import {
  isVoicePending,
  isVoiceStuck,
  meterLevel,
  pushLevel,
  voiceClock,
  VOICE_MIN_SECONDS,
  VOICE_STATUS_LABELS,
} from '../lib/voice-format'

type Phase = 'consent' | 'recording' | 'paused' | 'uploading' | 'result'

// Mono speech at 48 kbps keeps ~40 minutes under the server's 19 MB Gemini inline cap.
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 48000,
  isMeteringEnabled: true,
}

function RecordingResult({ token, recordingId }: { token: string; recordingId: string }) {
  const router = useRouter()
  const [rec, setRec] = useState<MobileVoiceRecording | null>(null)
  const [analysis, setAnalysis] = useState<MobileVoiceAnalysis | null>(null)
  const [candidates, setCandidates] = useState<MobileAttachCandidate[]>([])
  const [meetingId, setMeetingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await fetchVoiceRecording(token, recordingId)
      setRec(next)
      if (next.status === 'completed') {
        const [a, c] = await Promise.all([
          fetchVoiceAnalysis(token, recordingId),
          fetchAttachCandidates(token, recordingId),
        ])
        setAnalysis(a)
        setCandidates(c)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת ההקלטה נכשלה')
    }
  }, [token, recordingId])

  useEffect(() => {
    void load()
  }, [load])

  const pending = isVoicePending(rec?.status)
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => void load(), 4000)
    return () => clearInterval(timer)
  }, [pending, load])

  if (!rec) {
    return (
      <View style={styles.card}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    )
  }

  const stuck = isVoiceStuck(rec)
  const targetMeetingId = rec.meetingId

  const onRetry = async () => {
    setRetrying(true)
    setError(null)
    try {
      await retryVoiceRecording(token, recordingId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הניסיון החוזר נכשל')
    } finally {
      setRetrying(false)
    }
  }

  const onAttach = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await attachVoiceToMeeting(token, {
        recordingId,
        personIds: rec.people.map((p) => p.id),
        ...(meetingId ? { meetingId } : {}),
      })
      setSaved(true)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'השמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.resultHeader}>
        <Text style={styles.resultTitle} numberOfLines={2}>
          {rec.topic ?? rec.meetingTitle ?? 'הקלטה'}
        </Text>
        <Text style={styles.pill}>{stuck ? 'נתקע' : VOICE_STATUS_LABELS[rec.status] ?? rec.status}</Text>
      </View>
      <Text style={styles.muted}>
        {voiceClock(rec.duration)}
        {rec.people.length > 0 ? ` · ${rec.people.map((p) => p.name).join(', ')}` : ''}
      </Text>

      {pending && !stuck ? (
        <View style={styles.pendingRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.body}>התמלול והניתוח לוקחים בדרך כלל פחות מדקה. אפשר לצאת, תגיע התראה כשזה מוכן.</Text>
        </View>
      ) : null}

      {rec.status === 'failed' || stuck ? (
        <View style={styles.block}>
          <Text style={styles.error} accessibilityRole="alert">
            {stuck ? 'העיבוד נתקע' : rec.error ?? 'הניתוח נכשל'}
          </Text>
          <Pressable
            style={[styles.secondaryBtn, retrying && styles.disabled]}
            disabled={retrying}
            onPress={() => void onRetry()}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>{retrying ? 'מנסה שוב…' : 'נסה שוב'}</Text>
          </Pressable>
        </View>
      ) : null}

      {rec.status === 'completed' && analysis ? (
        <View style={styles.block}>
          {analysis.keyInsight ? <Text style={styles.body}>{analysis.keyInsight}</Text> : null}
          {analysis.actionItems.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>משימות שעלו</Text>
              {analysis.actionItems.map((a, i) => (
                <Text key={i} style={styles.body}>
                  • {a.content}
                  {a.owner ? <Text style={styles.muted}> · {a.owner}</Text> : null}
                </Text>
              ))}
              <Pressable onPress={() => router.push('/commitments' as Href)} accessibilityRole="link">
                <Text style={styles.link}>לאישור ההתחייבויות ›</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      {rec.status === 'completed' && candidates.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.sectionLabel}>פגישה שהסתיימה עכשיו</Text>
          {[{ id: '', title: 'בלי פגישה · שמור כשיחה עצמאית', time: '', endTime: null }, ...candidates].map((m) => {
            const selected = meetingId === m.id
            return (
              <Pressable
                key={m.id || 'none'}
                style={styles.radioRow}
                onPress={() => setMeetingId(m.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
              >
                <View style={[styles.radio, selected && styles.radioOn]} />
                <Text style={styles.body}>
                  {m.time ? `${m.time}${m.endTime ? `–${m.endTime}` : ''} ` : ''}
                  {m.title}
                </Text>
              </Pressable>
            )
          })}
          <Pressable
            style={[styles.primaryBtn, saving && styles.disabled]}
            disabled={saving}
            onPress={() => void onAttach()}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>{saving ? 'שומר…' : 'שמור קישור'}</Text>
          </Pressable>
          {saved ? <Text style={styles.success}>נשמר</Text> : null}
        </View>
      ) : null}

      {rec.status === 'completed' && targetMeetingId ? (
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => router.push(`/meeting/${targetMeetingId}` as Href)}
          accessibilityRole="link"
        >
          <Text style={styles.secondaryBtnText}>לסיכום המלא</Text>
        </Pressable>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

export default function RecordScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ personId?: string; personName?: string; meetingId?: string }>()
  const recorder = useAudioRecorder(RECORDING_OPTIONS)
  const state = useAudioRecorderState(recorder, 200)
  const [phase, setPhase] = useState<Phase>('consent')
  const [consent, setConsent] = useState(false)
  const [levels, setLevels] = useState<number[]>([])
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const elapsedSeconds = Math.floor(state.durationMillis / 1000)

  useEffect(() => {
    if (phase !== 'recording') return
    setLevels((prev) => pushLevel(prev, meterLevel(state.metering)))
  }, [phase, state.durationMillis, state.metering])

  // No background-recording permission: pause instead of losing audio silently.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && phaseRef.current === 'recording') {
        recorder.pause()
        setPhase('paused')
        setMessage('ההקלטה הושהתה כשהאפליקציה עברה לרקע')
      }
    })
    return () => sub.remove()
  }, [recorder])

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      const p = phaseRef.current
      if (p !== 'recording' && p !== 'paused' && p !== 'uploading') return
      e.preventDefault()
      Alert.alert(
        p === 'uploading' ? 'ההעלאה עדיין רצה' : 'ההקלטה תימחק',
        p === 'uploading' ? 'יציאה עכשיו עלולה לבטל את ההעלאה.' : 'לצאת בלי לשלוח את ההקלטה?',
        [
          { text: 'להישאר', style: 'cancel' },
          {
            text: 'לצאת',
            style: 'destructive',
            onPress: () => {
              if (p !== 'uploading') void recorder.stop().catch(() => undefined)
              phaseRef.current = 'consent'
              navigation.dispatch(e.data.action)
            },
          },
        ],
      )
    })
  }, [navigation, recorder])

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
      setLevels([])
      setRecordingId(null)
      setPhase('recording')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'לא ניתן להתחיל הקלטה')
    }
  }

  const pause = () => {
    recorder.pause()
    setPhase('paused')
  }

  const resume = () => {
    setMessage(null)
    recorder.record()
    setPhase('recording')
  }

  const stopAndUpload = async () => {
    if (!token) return
    const durationSeconds = state.durationMillis / 1000
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
    const uri = recorder.uri
    if (!uri) {
      setPhase('consent')
      setMessage('ההקלטה לא נשמרה במכשיר')
      return
    }
    if (durationSeconds < VOICE_MIN_SECONDS) {
      setPhase('consent')
      setMessage(`ההקלטה קצרה מ-${VOICE_MIN_SECONDS} שניות ולא נשמרה`)
      return
    }
    setProgress(0)
    setPhase('uploading')
    try {
      const { recordingId: id } = await uploadVoiceRecording(
        token,
        {
          uri,
          durationSeconds,
          personIds: params.personId ? [params.personId] : [],
          meetingId: params.meetingId,
        },
        setProgress,
      )
      setConsent(false)
      setRecordingId(id)
      setPhase('result')
    } catch (err) {
      setPhase('consent')
      setMessage(err instanceof Error ? err.message : 'ההעלאה נכשלה')
    }
  }

  const active = phase === 'recording' || phase === 'paused'

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      {params.personName ? <Text style={styles.muted}>שיחה עם {params.personName}</Text> : null}

      {phase === 'consent' || phase === 'result' ? (
        <View style={styles.card}>
          <Pressable
            style={styles.consentRow}
            onPress={() => setConsent((c) => !c)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
          >
            <View style={[styles.checkbox, consent && styles.checkboxOn]}>
              {consent ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <View style={styles.flexText}>
              <Text style={styles.body}>כל המשתתפים הסכימו להקלטה</Text>
              <Text style={styles.muted}>
                הקלטת שיחה בלי הסכמת המשתתפים עלולה להיות אסורה. ההקלטה נשמרת בשרת שלך ומתומללת ב-Gemini.
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, !consent && styles.disabled]}
            disabled={!consent}
            onPress={() => void start()}
            accessibilityRole="button"
            accessibilityHint={consent ? undefined : 'צריך לאשר הסכמה קודם'}
          >
            <Text style={styles.primaryBtnText}>{phase === 'result' ? 'הקלטה חדשה' : 'התחל הקלטה'}</Text>
          </Pressable>
          {permissionDenied ? (
            <View style={styles.block}>
              <Text style={styles.error}>אין גישה למיקרופון. אפשר לאשר אותה בהגדרות המכשיר.</Text>
              <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link">
                <Text style={styles.link}>פתח הגדרות ›</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {active ? (
        <View style={styles.card}>
          <View style={styles.timerRow}>
            <View style={[styles.dot, phase === 'recording' ? styles.dotLive : styles.dotPaused]} />
            <Text style={styles.timer} accessibilityRole="timer" accessibilityLabel={`זמן הקלטה ${voiceClock(elapsedSeconds)}`}>
              {voiceClock(elapsedSeconds)}
            </Text>
            <Text style={styles.muted}>{phase === 'paused' ? 'מושהה' : 'מקליט'}</Text>
          </View>
          <View style={styles.levels} importantForAccessibility="no-hide-descendants">
            {levels.map((l, i) => (
              <View key={i} style={[styles.levelBar, { height: `${Math.max(8, l * 100)}%`, opacity: 0.35 + l * 0.65 }]} />
            ))}
          </View>
          <View style={styles.controls}>
            {phase === 'recording' ? (
              <Pressable style={styles.secondaryBtn} onPress={pause} accessibilityRole="button">
                <Text style={styles.secondaryBtnText}>השהה</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.secondaryBtn} onPress={resume} accessibilityRole="button">
                <Text style={styles.secondaryBtnText}>המשך</Text>
              </Pressable>
            )}
            <Pressable style={styles.primaryBtn} onPress={() => void stopAndUpload()} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>עצור ושלח</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase === 'uploading' ? (
        <View style={styles.card} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <Text style={styles.body}>מעלה… {Math.round(progress * 100)}%</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
      ) : null}

      {message ? <Text style={styles.error} accessibilityRole="alert">{message}</Text> : null}

      {recordingId && token ? <RecordingResult key={recordingId} token={token} recordingId={recordingId} /> : null}

      {phase === 'result' ? (
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.link}>סיום</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

const rtl = { textAlign: 'right' as const, writingDirection: 'rtl' as const }

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexText: { flex: 1 },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surfaceCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  block: { gap: 8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, ...rtl },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19, ...rtl },
  sectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', ...rtl },
  error: { color: colors.error, fontSize: 13, ...rtl },
  success: { color: colors.success, fontSize: 13, ...rtl },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600', paddingVertical: 10, ...rtl },
  consentRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  primaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    flexGrow: 1,
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
  secondaryBtnText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  timerRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotLive: { backgroundColor: colors.coral },
  dotPaused: { backgroundColor: colors.textMuted },
  timer: { color: colors.text, fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'] },
  levels: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 3, height: 48 },
  levelBar: { flex: 1, borderRadius: 2, backgroundColor: colors.accent },
  controls: { flexDirection: 'row-reverse', gap: 10 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  resultHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  resultTitle: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, ...rtl },
  pill: {
    color: colors.accent,
    fontSize: 11,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  pendingRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  radioRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, minHeight: 44 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
})
