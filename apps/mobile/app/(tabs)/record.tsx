import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router'
import { useBringFocusedFieldIntoView } from '../../components/KeyboardSafe'
import { RecordingContextEditor } from '../../components/RecordingContextEditor'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../../lib/auth'
import { fetchPeople, fetchProjects, type MobileProject } from '../../lib/data'
import { storage } from '../../lib/storage'
import { colors } from '../../lib/theme'
import {
  attachVoiceToMeeting,
  fetchAttachCandidates,
  fetchMeetingChoice,
  fetchMeetingChoices,
  fetchVoiceAnalysis,
  fetchVoiceRecording,
  retryVoiceRecording,
  uploadVoiceRecording,
  type MobileAttachCandidate,
  type MobileMeetingChoice,
  type MobileVoiceAnalysis,
  type MobileVoiceRecording,
} from '../../lib/voice'
import {
  isVoicePending,
  isVoiceStuck,
  meterLevel,
  pushLevel,
  voiceClock,
  VOICE_MIN_SECONDS,
  VOICE_STATUS_LABELS,
} from '../../lib/voice-format'
type Phase = 'consent' | 'recording' | 'paused' | 'review' | 'uploading' | 'result'
type Named = { id: string; name: string }

/**
 * A recording whose upload failed, kept so the user can resend it without re-recording (see
 * docs/specs/voice-upload-retry-without-rerecording.md). The audio file at `uri` already
 * persists on device storage regardless — this just keeps the reference and enough context to
 * resend, surviving an app restart via `storage` (SecureStore-backed).
 */
type PendingUpload = {
  uri: string
  durationSeconds: number
  personIds: string[]
  personNames: string[]
  projectId?: string
  projectName?: string
  meetingId?: string
}
const PENDING_VOICE_UPLOAD_KEY = 'helm_pending_voice_upload'
/** Rows shown before "עוד פגישות להיום" — keeps the first screen scannable. */
const MEETINGS_COLLAPSED = 5

/** Calendar sync stores endTime as a full ISO string; show it as a local HH:MM. */
function clockOf(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^\d{1,2}:\d{2}$/.test(value)) return value.padStart(5, '0')
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function meetingRange(m: MobileMeetingChoice): string {
  const end = clockOf(m.endTime)
  return end ? `${m.time}–${end}` : m.time
}

function meetingPeopleLabel(m: MobileMeetingChoice): string | null {
  if (m.people.length === 0) return null
  if (m.people.length <= 3) return m.people.map((p) => p.name).join(', ')
  return `${m.people.slice(0, 3).map((p) => p.name).join(', ')} +${m.people.length - 3}`
}

/** One tappable meeting. Pressing it starts the recording straight away — no second confirm step. */
function MeetingRow({
  meeting,
  disabled,
  onPick,
  showDate = false,
}: {
  meeting: MobileMeetingChoice
  disabled: boolean
  onPick: () => void
  showDate?: boolean
}) {
  const names = meetingPeopleLabel(meeting)
  const detail = [names, meeting.location, meeting.projectName].filter(Boolean).join(' · ')
  return (
    <Pressable
      style={[styles.meetingRow, disabled && styles.disabled, meeting.state === 'ended' && styles.meetingRowEnded]}
      disabled={disabled}
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel={`הקלט את ${meeting.title} בשעה ${meetingRange(meeting)}`}
    >
      <View style={styles.meetingRowTop}>
        <Text style={styles.muted}>{meetingRange(meeting)}</Text>
        <Text style={[styles.body, styles.itemName]} numberOfLines={1}>{meeting.title}</Text>
        {meeting.state === 'now' ? <Text style={styles.nowPill}>עכשיו</Text> : null}
      </View>
      <Text style={styles.muted} numberOfLines={2}>
        {showDate ? `${new Date(meeting.date + 'T00:00:00').toLocaleDateString('he-IL')}${detail ? ' · ' : ''}` : ''}
        {detail || (showDate ? '' : 'הקש להתחלת הקלטה')}
      </Text>
    </Pressable>
  )
}

// Mono speech at 48 kbps: plenty for transcription quality and keeps file sizes small. Recordings
// longer than ~40 minutes now go through Gemini's Files API server-side instead of being rejected
// (see docs/specs/voice-large-recording-transcription.md) — this bitrate is just about efficiency.
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
  const [showCandidates, setShowCandidates] = useState(false)

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
  // A placeholder meeting isn't a real link, so it keeps showing the plain candidate list.
  const linkedToMeeting = rec.meetingLink === 'chosen' || rec.meetingLink === 'auto'

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

      {rec.status === 'completed' && linkedToMeeting && !showCandidates ? (
        <View style={styles.autoMatchBanner}>
          <Text style={styles.body}>
            {rec.meetingLink === 'auto' ? 'זוהתה אוטומטית: ' : 'מקושר לפגישה: '}
            <Text style={styles.autoMatchTitle}>{rec.meetingTitle}</Text>
            {rec.people.length > 0 ? ` — ${rec.people.map((p) => p.name).join(', ')}` : ''}
          </Text>
          <Pressable onPress={() => setShowCandidates(true)} accessibilityRole="button">
            <Text style={styles.link}>{rec.meetingLink === 'auto' ? 'לא נכון? בחר פגישה אחרת' : 'החלף פגישה'}</Text>
          </Pressable>
        </View>
      ) : null}

      {rec.status === 'completed' && candidates.length > 0 && (!linkedToMeeting || showCandidates) ? (
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
                  {m.time ? `${meetingRange(m as MobileMeetingChoice)} ` : ''}
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
  const [consent, setConsent] = useState(true)
  const [people, setPeople] = useState<Named[]>([])
  const [project, setProject] = useState<Named | null>(null)
  const [directory, setDirectory] = useState<{ people: Named[]; projects: MobileProject[] } | null>(null)
  const [savingContext, setSavingContext] = useState(false)
  const [savedContext, setSavedContext] = useState(false)
  const [levels, setLevels] = useState<number[]>([])
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  // URI and duration of a stopped recording awaiting context confirmation before upload.
  // (docs/specs/recording-context-before-upload.md)
  const [pendingUri, setPendingUri] = useState<string | null>(null)
  const [pendingDuration, setPendingDuration] = useState(0)
  // The calendar meeting this recording belongs to, picked before recording starts. Participants
  // and project then come from the meeting server-side (docs/specs/record-from-calendar-meeting.md).
  const [meeting, setMeeting] = useState<MobileMeetingChoice | null>(null)
  const [meetingChoices, setMeetingChoices] = useState<MobileMeetingChoice[] | null>(null)
  const [meetingsFailed, setMeetingsFailed] = useState(false)
  const [presetMeeting, setPresetMeeting] = useState<MobileMeetingChoice | null>(null)
  const [showAllMeetings, setShowAllMeetings] = useState(false)
  const [resending, setResending] = useState(false)
  const [showMeetingChangePicker, setShowMeetingChangePicker] = useState(false)
  const phaseRef = useRef(phase)
  const scrollRef = useRef<ScrollView>(null)
  useBringFocusedFieldIntoView(scrollRef)
  phaseRef.current = phase

  const elapsedSeconds = Math.floor(state.durationMillis / 1000)
  const seededPerson = useRef(false)

  useEffect(() => {
    void storage.getItem(PENDING_VOICE_UPLOAD_KEY).then((raw) => {
      if (!raw) return
      try {
        setPendingUpload(JSON.parse(raw) as PendingUpload)
      } catch {
        void storage.deleteItem(PENDING_VOICE_UPLOAD_KEY)
      }
    })
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void Promise.all([fetchPeople(token), fetchProjects(token)])
      .then(([loadedPeople, loadedProjects]) => {
        if (!cancelled) setDirectory({ people: loadedPeople, projects: loadedProjects })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    if (params.meetingId) {
      void fetchMeetingChoice(token, params.meetingId)
        .then((m) => {
          if (!cancelled) setPresetMeeting(m)
        })
        .catch(() => undefined)
    }
    // Always fetch the full day list so it's available for the meeting-change picker in review phase.
    void fetchMeetingChoices(token)
      .then((list) => {
        if (!cancelled) setMeetingChoices(list)
      })
      .catch(() => {
        if (!cancelled && !params.meetingId) setMeetingsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [token, params.meetingId])

  useEffect(() => {
    if (seededPerson.current || !params.personId) return
    const known = directory?.people.find((p) => p.id === params.personId)
    if (known) {
      setPeople([known])
      seededPerson.current = true
    } else if (params.personName) {
      setPeople([{ id: params.personId, name: params.personName }])
      seededPerson.current = true
    }
  }, [directory, params.personId, params.personName])

  useEffect(() => {
    if (phase !== 'recording') return
    setLevels((prev) => pushLevel(prev, meterLevel(state.metering)))
  }, [phase, state.durationMillis, state.metering])

  // Android has a foreground recording service (see app.config.ts, docs/specs/recording-background-and-speaker-id.md)
  // and keeps recording when backgrounded. iOS doesn't have that background entitlement here,
  // so it still pauses rather than losing audio silently.
  useEffect(() => {
    if (Platform.OS === 'android') return
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
      if (p !== 'recording' && p !== 'paused' && p !== 'review' && p !== 'uploading') return
      e.preventDefault()
      Alert.alert(
        p === 'uploading' ? 'ההעלאה עדיין רצה' : p === 'review' ? 'לבטל את ההקלטה?' : 'ההקלטה תימחק',
        p === 'uploading'
          ? 'יציאה עכשיו עלולה לבטל את ההעלאה.'
          : p === 'review'
          ? 'לצאת בלי לשלוח את ההקלטה? הקובץ יימחק.'
          : 'לצאת בלי לשלוח את ההקלטה?',
        [
          { text: 'להישאר', style: 'cancel' },
          {
            text: 'לצאת',
            style: 'destructive',
            onPress: () => {
              if (p !== 'uploading') void recorder.stop().catch(() => undefined)
              if (p === 'review' && pendingUri) {
                void import('expo-file-system/legacy')
                  .then(({ deleteAsync }) => deleteAsync(pendingUri, { idempotent: true }))
                  .catch(() => undefined)
              }
              phaseRef.current = 'consent'
              navigation.dispatch(e.data.action)
            },
          },
        ],
      )
    })
  }, [navigation, recorder, pendingUri])

  const start = async (forMeeting: MobileMeetingChoice | null = null) => {
    if (pendingUpload) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'יש הקלטה שממתינה לשליחה',
          'להתחיל הקלטה חדשה בכל זאת ולמחוק אותה?',
          [
            { text: 'ביטול', style: 'cancel', onPress: () => resolve(false) },
            { text: 'התחל חדשה ומחק', style: 'destructive', onPress: () => resolve(true) },
          ],
        )
      })
      if (!proceed) return
      const uri = pendingUpload.uri
      setPendingUpload(null)
      void storage.deleteItem(PENDING_VOICE_UPLOAD_KEY)
      void import('expo-file-system/legacy').then(({ deleteAsync }) => deleteAsync(uri, { idempotent: true })).catch(() => undefined)
    }
    setMessage(null)
    setPermissionDenied(false)
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      setPermissionDenied(true)
      return
    }
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        ...(Platform.OS === 'android' ? { allowsBackgroundRecording: true } : {}),
      })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setLevels([])
      setRecordingId(null)
      setMeeting(forMeeting)
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

  /**
   * Stop the recorder and transition to the context-review phase before uploading.
   * (docs/specs/recording-context-before-upload.md)
   */
  const stopRecording = async () => {
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
    // Pre-seed people/project from the meeting context if this was a meeting recording.
    if (meeting) {
      setPeople(meeting.people.map((p) => ({ id: p.id, name: p.name })))
      const meetingProject = directory?.projects.find((pr) => pr.id === meeting.projectId) ?? null
      setProject(meetingProject ? { id: meetingProject.id, name: meetingProject.name } : null)
    }
    setPendingUri(uri)
    setPendingDuration(durationSeconds)
    setPhase('review')
  }

  /** Upload the reviewed recording. Called from the review-phase "העלה שיחה" button. */
  const confirmUpload = async () => {
    if (!token || !pendingUri) return
    setProgress(0)
    setPhase('uploading')
    try {
      const { recordingId: id } = await uploadVoiceRecording(
        token,
        {
          uri: pendingUri,
          durationSeconds: pendingDuration,
          personIds: people.map((p) => p.id),
          meetingId: meeting?.id,
          projectId: project?.id ?? null,
        },
        setProgress,
      )
      setConsent(false)
      setPendingUri(null)
      setRecordingId(id)
      setPhase('result')
    } catch (err) {
      const pending: PendingUpload = {
        uri: pendingUri,
        durationSeconds: pendingDuration,
        personIds: people.map((p) => p.id),
        personNames: people.map((p) => p.name),
        projectId: project?.id,
        projectName: project?.name,
        meetingId: meeting?.id,
      }
      setPendingUri(null)
      setPendingUpload(pending)
      await storage.setItem(PENDING_VOICE_UPLOAD_KEY, JSON.stringify(pending))
      setPhase('consent')
      setMessage(err instanceof Error ? err.message : 'ההעלאה נכשלה')
    }
  }

  /** Discard the stopped recording without uploading. */
  const discardReview = () => {
    Alert.alert('לבטל את ההקלטה?', 'הקובץ שהוקלט יימחק לצמיתות.', [
      { text: 'להישאר', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          const uri = pendingUri
          setPendingUri(null)
          setPhase('consent')
          if (uri) {
            void import('expo-file-system/legacy')
              .then(({ deleteAsync }) => deleteAsync(uri, { idempotent: true }))
              .catch(() => undefined)
          }
        },
      },
    ])
  }

  const retryPendingUpload = async () => {
    if (!pendingUpload || !token) return
    setMessage(null)
    setProgress(0)
    setResending(true)
    setPhase('uploading')
    try {
      const { recordingId: id } = await uploadVoiceRecording(
        token,
        {
          uri: pendingUpload.uri,
          durationSeconds: pendingUpload.durationSeconds,
          personIds: pendingUpload.personIds,
          meetingId: pendingUpload.meetingId,
          projectId: pendingUpload.projectId,
        },
        setProgress,
      )
      await storage.deleteItem(PENDING_VOICE_UPLOAD_KEY)
      setPendingUpload(null)
      setConsent(false)
      setRecordingId(id)
      setPhase('result')
    } catch (err) {
      setPhase('consent')
      setMessage(err instanceof Error ? err.message : 'ההעלאה נכשלה')
    } finally {
      setResending(false)
    }
  }

  const discardPendingUpload = () => {
    Alert.alert('למחוק את ההקלטה?', 'ההקלטה שממתינה לשליחה תימחק לצמיתות.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          const uri = pendingUpload?.uri
          setPendingUpload(null)
          void storage.deleteItem(PENDING_VOICE_UPLOAD_KEY)
          if (uri) {
            void import('expo-file-system/legacy')
              .then(({ deleteAsync }) => deleteAsync(uri, { idempotent: true }))
              .catch(() => undefined)
          }
        },
      },
    ])
  }

  const active = phase === 'recording' || phase === 'paused'

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      {(phase === 'recording' || phase === 'paused' || phase === 'uploading') && meeting ? (
        <View>
          <Text style={styles.body}>
            {meeting.title} <Text style={styles.muted}>· {meetingRange(meeting)}</Text>
          </Text>
          {meetingPeopleLabel(meeting) ? <Text style={styles.muted}>{meetingPeopleLabel(meeting)}</Text> : null}
        </View>
      ) : null}
      {(phase === 'recording' || phase === 'paused' || phase === 'uploading') && !meeting && (people.length > 0 || project) ? (
        <Text style={styles.muted}>
          {[people.map((p) => p.name).join(', '), project?.name].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {phase === 'consent' && pendingUpload ? (
        <View style={styles.autoMatchBanner}>
          <Text style={styles.body}>
            יש הקלטה ({voiceClock(pendingUpload.durationSeconds)}) שלא נשלחה
            {pendingUpload.personNames.length > 0 ? ` — ${pendingUpload.personNames.join(', ')}` : ''}
          </Text>
          <View style={{ flexDirection: 'row-reverse', gap: 16 }}>
            <Pressable onPress={() => void retryPendingUpload()} disabled={resending} accessibilityRole="button">
              <Text style={styles.link}>{resending ? 'שולח…' : 'שלח שוב'}</Text>
            </Pressable>
            <Pressable onPress={discardPendingUpload} disabled={resending} accessibilityRole="button">
              <Text style={[styles.link, { color: colors.error }]}>מחק</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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

          {params.meetingId ? (
            <View style={styles.block}>
              <Text style={styles.sectionLabel}>הקלטת פגישה</Text>
              {presetMeeting ? (
                <MeetingRow meeting={presetMeeting} disabled={!consent} showDate onPick={() => void start(presetMeeting)} />
              ) : (
                <Text style={styles.muted}>טוען פגישה…</Text>
              )}
              <Pressable onPress={() => router.replace('/record' as Href)} accessibilityRole="button">
                <Text style={styles.link}>בחר פגישה אחרת</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.block}>
              <Text style={styles.sectionLabel}>פגישות להיום</Text>
              {meetingsFailed ? (
                <Text style={styles.muted}>לא הצלחנו לטעון את היומן. אפשר להקליט בלי פגישה.</Text>
              ) : !meetingChoices ? (
                <ActivityIndicator color={colors.accent} />
              ) : meetingChoices.length === 0 ? (
                <Text style={styles.muted}>אין פגישות ביומן להיום. אפשר להקליט שיחה חופשית.</Text>
              ) : (
                <>
                  {(showAllMeetings ? meetingChoices : meetingChoices.slice(0, MEETINGS_COLLAPSED)).map((m) => (
                    <MeetingRow key={m.id} meeting={m} disabled={!consent} onPick={() => void start(m)} />
                  ))}
                  {!showAllMeetings && meetingChoices.length > MEETINGS_COLLAPSED ? (
                    <Pressable onPress={() => setShowAllMeetings(true)} accessibilityRole="button">
                      <Text style={styles.link}>עוד פגישות להיום ({meetingChoices.length - MEETINGS_COLLAPSED})</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
              {!consent ? <Text style={styles.warning}>צריך לאשר הסכמה קודם</Text> : null}
            </View>
          )}
        </View>
      ) : null}

      {phase === 'consent' || phase === 'result' ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>הקלטה חופשית</Text>
          <Text style={styles.muted}>בלי פגישה מהיומן — בחר משתתפים ופרויקט ידנית.</Text>
          <RecordingContextEditor
            people={people}
            project={project}
            directory={directory}
            onChangePeople={(next) => {
              setSavedContext(false)
              setPeople(next)
            }}
            onChangeProject={(next) => {
              setSavedContext(false)
              setProject(next)
            }}
          />
          {phase === 'result' && recordingId && token ? (
            <Pressable
              style={[styles.secondaryBtn, savingContext && styles.disabled]}
              disabled={savingContext}
              onPress={() => {
                setSavingContext(true)
                setMessage(null)
                void attachVoiceToMeeting(token, {
                  recordingId,
                  personIds: people.map((p) => p.id),
                  projectId: project?.id ?? null,
                })
                  .then(() => setSavedContext(true))
                  .catch((err) => setMessage(err instanceof Error ? err.message : 'השמירה נכשלה'))
                  .finally(() => setSavingContext(false))
              }}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnText}>{savingContext ? 'שומר…' : 'שמור משתתפים ופרויקט'}</Text>
            </Pressable>
          ) : null}
          {savedContext ? <Text style={styles.success}>נשמר</Text> : null}
          <Pressable
            style={[params.meetingId ? styles.secondaryBtn : styles.primaryBtn, !consent && styles.disabled]}
            disabled={!consent}
            onPress={() => void start(null)}
            accessibilityRole="button"
            accessibilityHint={consent ? undefined : 'צריך לאשר הסכמה קודם'}
          >
            <Text style={params.meetingId ? styles.secondaryBtnText : styles.primaryBtnText}>{phase === 'result' ? 'הקלטה חדשה' : params.meetingId ? 'הקלט בלי פגישה' : 'התחל הקלטה'}</Text>
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
            <Pressable style={styles.primaryBtn} onPress={() => void stopRecording()} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>עצור ושלח</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase === 'uploading' ? (
        <View style={styles.card} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          {progress < 1 ? (
            <>
              <Text style={styles.body}>מעלה… {Math.round(progress * 100)}%</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            </>
          ) : (
            // All bytes sent — server is writing to disk and registering the recording.
            // Show a spinner instead of a frozen "100%" bar so the user knows it is still working.
            <View style={styles.pendingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.body}>מעבד… ממתין לשרת</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Review phase: confirm context before upload (docs/specs/recording-context-before-upload.md) */}
      {phase === 'review' ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>אישור לפני העלאה</Text>
          <Text style={styles.muted}>בדוק את ההקשר ולחץ ״העלה שיחה״ כשהכל מוכן.</Text>
          <RecordingContextEditor
            people={people}
            project={project}
            directory={directory}
            onChangePeople={setPeople}
            onChangeProject={setProject}
          />
          {/* Show the linked meeting (if any) so the user can see / change it before uploading */}
          <View style={styles.reviewMeetingRow}>
            <Text style={styles.sectionLabel}>פגישה</Text>
            {meeting ? (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flex: 1 }}>
                <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>{meeting.title}</Text>
                <Pressable onPress={() => setShowMeetingChangePicker(true)} accessibilityRole="button">
                  <Text style={styles.link}>החלף</Text>
                </Pressable>
                <Pressable onPress={() => setMeeting(null)} accessibilityRole="button">
                  <Text style={[styles.link, { color: colors.error }]}>הסר</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Text style={styles.muted}>ללא פגישה</Text>
                {meetingChoices && meetingChoices.length > 0 && (
                  <Pressable onPress={() => setShowMeetingChangePicker(true)} accessibilityRole="button">
                    <Text style={styles.link}>שייך לפגישה</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
          <View style={styles.controls}>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => void confirmUpload()}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>העלה שיחה</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={discardReview}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnText}>ביטול</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Meeting-change picker Modal for review phase */}
      <Modal
        visible={showMeetingChangePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMeetingChangePicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowMeetingChangePicker(false)}
          accessibilityRole="button"
          accessibilityLabel="סגור"
        >
          <View style={styles.modalSheet}>
            <Text style={[styles.sectionLabel, { marginBottom: 4 }]}>בחר פגישה</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Pressable
                style={styles.meetingRow}
                onPress={() => { setMeeting(null); setShowMeetingChangePicker(false) }}
                accessibilityRole="button"
              >
                <Text style={styles.body}>ללא פגישה</Text>
              </Pressable>
              {(meetingChoices ?? []).map((m) => (
                <Pressable
                  key={m.id}
                  style={[styles.meetingRow, meeting?.id === m.id && { borderColor: colors.accent }]}
                  onPress={() => { setMeeting(m); setShowMeetingChangePicker(false) }}
                  accessibilityRole="button"
                >
                  <View style={styles.meetingRowTop}>
                    <Text style={styles.muted}>{meetingRange(m)}</Text>
                    <Text style={[styles.body, styles.itemName]} numberOfLines={1}>{m.title}</Text>
                    {m.state === 'now' ? <Text style={styles.nowPill}>עכשיו</Text> : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

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
  autoMatchBanner: {
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent + '4d',
    backgroundColor: colors.accent + '1a',
    padding: 10,
  },
  autoMatchTitle: { color: colors.text, fontWeight: '600' },
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
  meetingRow: {
    gap: 4,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  meetingRowEnded: { opacity: 0.6 },
  meetingRowTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  nowPill: {
    color: colors.accent,
    fontSize: 11,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  warning: { color: colors.warning, fontSize: 13, ...rtl },
  radioRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, minHeight: 44 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  itemRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, minHeight: 44 },
  itemName: { flex: 1 },
  linkBtn: { color: colors.accent, fontSize: 14, fontWeight: '600', paddingVertical: 8 },
  removeBtn: { color: colors.coral, fontSize: 14, fontWeight: '600', paddingVertical: 8 },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    writingDirection: 'rtl',
  },
  match: { minHeight: 44, justifyContent: 'center' },
  reviewMeetingRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surfaceCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 8,
    maxHeight: '70%',
  },
})
