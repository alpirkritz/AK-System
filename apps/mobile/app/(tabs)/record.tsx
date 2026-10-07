import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router'
import { useBringFocusedFieldIntoView } from '../../components/KeyboardSafe'
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

type Phase = 'consent' | 'recording' | 'paused' | 'uploading' | 'result'
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
type PickerMode = { kind: 'person'; replaceId?: string } | { kind: 'project' }
/** Rows shown before "עוד פגישות להיום" — keeps the first screen scannable. */
const MEETINGS_COLLAPSED = 5

function meetingRange(m: MobileMeetingChoice): string {
  return m.endTime ? `${m.time}–${m.endTime}` : m.time
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

function RecordingContextEditor({
  people,
  project,
  directory,
  onChangePeople,
  onChangeProject,
}: {
  people: Named[]
  project: Named | null
  directory: { people: Named[]; projects: MobileProject[] } | null
  onChangePeople: (next: Named[]) => void
  onChangeProject: (next: Named | null) => void
}) {
  const [mode, setMode] = useState<PickerMode | null>(null)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const personMatches = !directory || mode?.kind !== 'person'
    ? []
    : directory.people.filter((p) => !people.some((x) => x.id === p.id) && p.name.toLowerCase().includes(q)).slice(0, 6)
  const projectMatches = !directory || mode?.kind !== 'project'
    ? []
    : directory.projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6)

  const open = (next: PickerMode) => {
    setMode(next)
    setQuery('')
  }
  const pickPerson = (person: Named) => {
    if (mode?.kind === 'person' && mode.replaceId) {
      onChangePeople(people.map((p) => (p.id === mode.replaceId ? person : p)))
    } else {
      onChangePeople([...people, person])
    }
    setMode(null)
    setQuery('')
  }
  const pickProject = (next: Named) => {
    onChangeProject(next)
    setMode(null)
    setQuery('')
  }

  return (
    <View style={styles.block}>
      <Text style={styles.sectionLabel}>משתתפים</Text>
      {people.length === 0 ? <Text style={styles.muted}>עדיין אין משתתפים</Text> : null}
      {people.map((p) => (
        <View key={p.id} style={styles.itemRow}>
          <Text style={[styles.body, styles.itemName]} numberOfLines={1}>{p.name}</Text>
          <Pressable onPress={() => open({ kind: 'person', replaceId: p.id })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`ערוך את ${p.name}`}>
            <Text style={styles.linkBtn}>ערוך</Text>
          </Pressable>
          <Pressable onPress={() => onChangePeople(people.filter((x) => x.id !== p.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`הסר את ${p.name}`}>
            <Text style={styles.removeBtn}>הסר</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => open({ kind: 'person' })} accessibilityRole="button">
        <Text style={styles.link}>הוסף משתתף</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>פרויקט</Text>
      {project ? (
        <View style={styles.itemRow}>
          <Text style={[styles.body, styles.itemName]} numberOfLines={1}>{project.name}</Text>
          <Pressable onPress={() => open({ kind: 'project' })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`ערוך את ${project.name}`}>
            <Text style={styles.linkBtn}>ערוך</Text>
          </Pressable>
          <Pressable onPress={() => onChangeProject(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`הסר את ${project.name}`}>
            <Text style={styles.removeBtn}>הסר</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => open({ kind: 'project' })} accessibilityRole="button">
          <Text style={styles.link}>הוסף פרויקט</Text>
        </Pressable>
      )}

      {mode ? (
        <View style={styles.block}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={mode.kind === 'person' ? 'חפש אדם' : 'חפש פרויקט'}
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            textAlign="right"
            autoFocus
            autoCorrect={false}
          />
          {(mode.kind === 'person' ? personMatches : projectMatches).map((item) => (
            <Pressable
              key={item.id}
              style={styles.match}
              onPress={() => (mode.kind === 'person' ? pickPerson(item) : pickProject(item))}
              accessibilityRole="button"
            >
              <Text style={styles.body}>{item.name}</Text>
            </Pressable>
          ))}
          {q && (mode.kind === 'person' ? personMatches : projectMatches).length === 0 ? (
            <Text style={styles.muted}>אין תוצאות</Text>
          ) : null}
        </View>
      ) : null}
    </View>
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
  // The calendar meeting this recording belongs to, picked before recording starts. Participants
  // and project then come from the meeting server-side (docs/specs/record-from-calendar-meeting.md).
  const [meeting, setMeeting] = useState<MobileMeetingChoice | null>(null)
  const [meetingChoices, setMeetingChoices] = useState<MobileMeetingChoice[] | null>(null)
  const [meetingsFailed, setMeetingsFailed] = useState(false)
  const [presetMeeting, setPresetMeeting] = useState<MobileMeetingChoice | null>(null)
  const [showAllMeetings, setShowAllMeetings] = useState(false)
  const [resending, setResending] = useState(false)
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
    } else {
      void fetchMeetingChoices(token)
        .then((list) => {
          if (!cancelled) setMeetingChoices(list)
        })
        .catch(() => {
          if (!cancelled) setMeetingsFailed(true)
        })
    }
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
          // A meeting brings its own attendees and project server-side, so nothing is sent here.
          personIds: meeting ? [] : people.map((p) => p.id),
          meetingId: meeting?.id,
          projectId: meeting ? undefined : project?.id,
        },
        setProgress,
      )
      setConsent(false)
      setRecordingId(id)
      setPhase('result')
    } catch (err) {
      const pending: PendingUpload = {
        uri,
        durationSeconds,
        personIds: meeting ? [] : people.map((p) => p.id),
        personNames: meeting ? meeting.people.map((p) => p.name) : people.map((p) => p.name),
        projectId: meeting ? undefined : project?.id,
        projectName: meeting ? meeting.projectName ?? undefined : project?.name,
        meetingId: meeting?.id,
      }
      setPendingUpload(pending)
      await storage.setItem(PENDING_VOICE_UPLOAD_KEY, JSON.stringify(pending))
      setPhase('consent')
      setMessage(err instanceof Error ? err.message : 'ההעלאה נכשלה')
    }
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
            style={[styles.primaryBtn, !consent && styles.disabled]}
            disabled={!consent}
            onPress={() => void start(null)}
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
})
