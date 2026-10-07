'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { Mic, Pause, Play, Square, X, RotateCcw } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { uploadRecording, useRecorder } from './lib/use-recorder'

const MIN_SECONDS = 10
const STUCK_MS = 10 * 60_000
/** Rows shown before "עוד פגישות להיום" — keeps the first screen scannable. */
const MEETINGS_COLLAPSED = 5

/** A meeting offered on this screen; mirrors `voice.meetingChoices`. */
type MeetingChoice = {
  id: string
  title: string
  date: string
  time: string
  endTime: string | null
  location: string | null
  projectId: string | null
  projectName: string | null
  people: { id: string; name: string }[]
  state: 'now' | 'upcoming' | 'ended'
}

function meetingRange(m: MeetingChoice): string {
  return m.endTime ? `${m.time}–${m.endTime}` : m.time
}

function meetingPeopleLabel(m: MeetingChoice): string | null {
  if (m.people.length === 0) return null
  if (m.people.length <= 3) return m.people.map((p) => p.name).join(', ')
  return `${m.people.slice(0, 3).map((p) => p.name).join(', ')} +${m.people.length - 3}`
}

const STATUS_LABELS: Record<string, string> = {
  uploaded: 'ממתין לעיבוד',
  processing: 'מתמלל ומנתח…',
  completed: 'נותח',
  failed: 'נכשל',
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type PersonOption = { id: string; name: string }

function PeoplePicker({
  selected,
  onChange,
  inputId,
}: {
  selected: PersonOption[]
  onChange: (next: PersonOption[]) => void
  inputId: string
}) {
  const { data: everyone = [] } = trpc.people.list.useQuery()
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const chosen = new Set(selected.map((p) => p.id))
    return everyone.filter((p) => !chosen.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 6)
  }, [everyone, query, selected])
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {selected.map((p) => (
          <span key={p.id} className="pill text-xs inline-flex items-center gap-1" data-testid="voice-person-chip">
            {p.name}
            <button
              type="button"
              className="text-[#5a688c] hover:text-[#eef3fb]"
              aria-label={`הסר את ${p.name}`}
              onClick={() => onChange(selected.filter((x) => x.id !== p.id))}
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <input
        id={inputId}
        className="input w-full text-sm"
        placeholder="הוסף אדם לפי שם"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {matches.length > 0 && (
        <ul className="card p-1 space-y-0.5" role="listbox" aria-label="תוצאות חיפוש אנשים">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full text-start px-2 py-1 rounded text-sm text-[#b8c4dc] hover:bg-[#1a2744] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#e8c547]"
                onClick={() => {
                  onChange([...selected, { id: p.id, name: p.name }])
                  setQuery('')
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One tappable meeting. Pressing it starts the recording straight away — no second confirm step. */
function MeetingRow({
  meeting,
  disabled,
  onPick,
  showDate = false,
}: {
  meeting: MeetingChoice
  disabled: boolean
  onPick: () => void
  showDate?: boolean
}) {
  const names = meetingPeopleLabel(meeting)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      data-testid="voice-meeting-row"
      className={`card card-interactive w-full text-start p-3 min-h-[44px] flex flex-wrap items-center gap-x-2 gap-y-1 disabled:opacity-50 disabled:cursor-not-allowed ${
        meeting.state === 'ended' ? 'opacity-60' : ''
      }`}
      aria-label={`הקלט את ${meeting.title} בשעה ${meetingRange(meeting)}`}
    >
      <span className="tabular-nums text-xs text-[#5a688c]">{meetingRange(meeting)}</span>
      <span className="text-[#eef3fb] font-medium">{meeting.title}</span>
      {meeting.state === 'now' && <span className="pill text-[10px] text-[#2dd4bf]">עכשיו</span>}
      {showDate && (
        <span className="text-xs text-[#5a688c]">{new Date(meeting.date + 'T00:00:00').toLocaleDateString('he-IL')}</span>
      )}
      <span className="basis-full text-xs text-[#97a4c2]">
        {[names, meeting.location, meeting.projectName].filter(Boolean).join(' · ') || 'הקש להתחלת הקלטה'}
      </span>
    </button>
  )
}

/**
 * "Who is speaking?" — one row per speaker the system could not name. The sample plays out of the
 * full recording by seeking to its start and pausing at its end; nothing is clipped server-side.
 */
function SpeakerPrompt({ recordingId }: { recordingId: string }) {
  const utils = trpc.useUtils()
  const { data: speakers = [] } = trpc.voice.speakers.useQuery({ recordingId })
  const audioRef = useRef<HTMLAudioElement>(null)
  const stopAtRef = useRef<number | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, PersonOption[]>>({})
  const identify = trpc.voice.identifySpeaker.useMutation({
    onSuccess: () => {
      utils.voice.speakers.invalidate({ recordingId })
      utils.voice.get.invalidate({ recordingId })
    },
  })

  const unknown = speakers.filter((s) => s.state === 'unknown')
  if (unknown.length === 0) return null

  const playSample = (speakerLabel: string, startMs: number, endMs: number) => {
    const el = audioRef.current
    if (!el) return
    stopAtRef.current = endMs / 1000
    el.currentTime = startMs / 1000
    setPlaying(speakerLabel)
    void el.play().catch(() => setPlaying(null))
  }

  return (
    <div className="pt-3 border-t border-[#223052] space-y-3" data-testid="voice-speakers">
      <div>
        <p className="label">מי מדבר?</p>
        <p className="text-xs text-[#97a4c2]">שמע דגימה וסמן את האדם. מה שלא מזוהה אפשר לדלג עליו.</p>
      </div>
      <audio
        ref={audioRef}
        src={`/api/voice/${recordingId}/audio`}
        preload="metadata"
        className="hidden"
        onTimeUpdate={() => {
          const el = audioRef.current
          if (!el || stopAtRef.current === null || el.currentTime < stopAtRef.current) return
          el.pause()
          stopAtRef.current = null
          setPlaying(null)
        }}
        onEnded={() => setPlaying(null)}
      />
      {unknown.map((speaker) => {
        const selected = picks[speaker.speakerLabel] ?? []
        return (
          <div key={speaker.speakerLabel} className="card p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill text-xs">{speaker.speakerLabel}</span>
              <span className="text-xs text-[#5a688c]">{speaker.segmentCount} קטעי דיבור</span>
              <button
                type="button"
                className="btn-ghost text-[11px] inline-flex items-center gap-1"
                onClick={() => playSample(speaker.speakerLabel, speaker.sampleStartMs, speaker.sampleEndMs)}
                aria-label={`השמע דגימה של ${speaker.speakerLabel}`}
              >
                <Play className="w-3.5 h-3.5" aria-hidden />
                {playing === speaker.speakerLabel ? 'מנגן…' : 'השמע דגימה'}
              </button>
            </div>
            <p className="text-xs text-[#b8c4dc] leading-relaxed">“{speaker.sampleText}”</p>
            <PeoplePicker
              inputId={`speaker-${speaker.speakerLabel.replace(/\s+/g, '-')}`}
              selected={selected}
              onChange={(next) => setPicks((prev) => ({ ...prev, [speaker.speakerLabel]: next.slice(-1) }))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary text-xs py-1 px-3"
                disabled={selected.length === 0 || identify.isPending}
                onClick={() =>
                  identify.mutate({ recordingId, speakerLabel: speaker.speakerLabel, personId: selected[0].id })
                }
              >
                זה הוא
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs py-1 px-3"
                disabled={identify.isPending}
                onClick={() => identify.mutate({ recordingId, speakerLabel: speaker.speakerLabel, personId: null })}
              >
                לא מזהה
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RecordingResult({ recordingId }: { recordingId: string }) {
  const utils = trpc.useUtils()
  const { data: rec } = trpc.voice.get.useQuery(
    { recordingId },
    { refetchInterval: (data) => (data && ['uploaded', 'processing'].includes(data.status) ? 4000 : false) },
  )
  const done = rec?.status === 'completed'
  const { data: analysis } = trpc.voice.getAnalysis.useQuery({ recordingId }, { enabled: done })
  const { data: candidates = [] } = trpc.voice.attachCandidates.useQuery({ recordingId }, { enabled: done })
  const [people, setPeople] = useState<PersonOption[] | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectTouched, setProjectTouched] = useState(false)
  const [meetingId, setMeetingId] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  const invalidate = () => {
    utils.voice.invalidate()
    utils.insights.personContext.invalidate()
    utils.commitments.listProposed.invalidate()
  }
  const attach = trpc.voice.attachToPeople.useMutation({
    onSuccess: () => {
      setSaved(true)
      invalidate()
    },
  })
  const retry = trpc.voice.retry.useMutation({ onSuccess: invalidate })
  const { data: projects = [] } = trpc.projects.list.useQuery()

  if (!rec) return <div className="card text-sm text-[#5a688c]">טוען הקלטה…</div>
  const chosen = people ?? rec.people
  const stuck = rec.status === 'processing' && Date.now() - new Date(rec.createdAt).getTime() > STUCK_MS
  // A placeholder meeting isn't a real link, so it keeps showing the plain candidate list.
  const linkedToMeeting = rec.meetingLink === 'chosen' || rec.meetingLink === 'auto'

  return (
    <section className="card p-4 space-y-3 text-sm" data-testid="voice-result" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-[#eef3fb]">{rec.topic ?? rec.meetingTitle ?? 'הקלטה'}</h2>
        <span className="pill text-[11px]" data-testid="voice-status">{STATUS_LABELS[rec.status] ?? rec.status}</span>
        <span className="text-xs text-[#5a688c] tabular-nums">
          {format(new Date(rec.createdAt), 'dd/MM HH:mm')} · {clock(rec.duration)}
        </span>
      </div>

      {(rec.status === 'failed' || stuck) && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-red-400 text-xs" role="alert">{stuck ? 'העיבוד נתקע' : rec.error ?? 'הניתוח נכשל'}</p>
          <button
            type="button"
            className="btn btn-ghost text-xs py-1 px-3 inline-flex items-center gap-1"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ recordingId })}
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden />
            {retry.isPending ? 'מנסה שוב…' : 'נסה שוב'}
          </button>
        </div>
      )}
      {(rec.status === 'uploaded' || rec.status === 'processing') && !stuck && (
        <p className="text-xs text-[#97a4c2]">התמלול והניתוח לוקחים בדרך כלל פחות מדקה. אפשר לעזוב את העמוד, תגיע התראה כשזה מוכן.</p>
      )}

      {done && analysis && (
        <div className="space-y-2">
          {analysis.keyInsight && <p className="text-[#eef3fb] leading-relaxed">{analysis.keyInsight}</p>}
          {analysis.actionItems.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold text-[#5a688c] mb-1">משימות שעלו</h3>
              <ul className="space-y-0.5 text-[#b8c4dc]">
                {analysis.actionItems.map((a, i) => (
                  <li key={i}>• {a.content}{a.owner && <span className="text-[#5a688c]"> · {a.owner}</span>}</li>
                ))}
              </ul>
              <Link href="/commitments" className="btn-ghost text-[11px] mt-1 inline-block">לאישור ההתחייבויות</Link>
            </div>
          )}
        </div>
      )}

      {done && <SpeakerPrompt recordingId={recordingId} />}

      {done && (
        <form
          className="pt-3 border-t border-[#223052] space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            setSaved(false)
            attach.mutate({
              recordingId,
              personIds: chosen.map((p) => p.id),
              projectId: projectTouched ? projectId : rec.project?.id ?? null,
              ...(meetingId ? { meetingId } : {}),
            })
          }}
        >
          <div>
            <label className="label" htmlFor="attach-people">משתתפים</label>
            <PeoplePicker inputId="attach-people" selected={chosen} onChange={setPeople} />
          </div>
          <div>
            <label className="label" htmlFor="attach-project">פרויקט</label>
            <select
              id="attach-project"
              className="select w-full"
              value={projectTouched ? projectId ?? '' : rec.project?.id ?? ''}
              onChange={(e) => {
                setProjectTouched(true)
                setProjectId(e.target.value || null)
              }}
            >
              <option value="">ללא פרויקט</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {linkedToMeeting && !showCandidates && (
            <div
              className="rounded-md border border-[#2dd4bf]/30 bg-[#2dd4bf]/10 px-3 py-2 text-xs text-[#b8c4dc] flex flex-wrap items-center gap-2"
              data-testid="voice-meeting-banner"
            >
              <span>
                {rec.meetingLink === 'auto' ? 'זוהתה אוטומטית: ' : 'מקושר לפגישה: '}
                <span className="text-[#eef3fb] font-medium">{rec.meetingTitle}</span>
                {chosen.length > 0 && <span> — {chosen.map((p) => p.name).join(', ')}</span>}
              </span>
              <button type="button" className="btn-ghost text-[11px]" onClick={() => setShowCandidates(true)}>
                {rec.meetingLink === 'auto' ? 'לא נכון? בחר פגישה אחרת' : 'החלף פגישה'}
              </button>
            </div>
          )}
          {candidates.length > 0 && (!linkedToMeeting || showCandidates) && (
            <fieldset>
              <legend className="label">פגישה שהסתיימה עכשיו</legend>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-[#b8c4dc]">
                  <input type="radio" name="meeting" value="" checked={meetingId === ''} onChange={() => setMeetingId('')} />
                  בלי פגישה · שמור כשיחה עצמאית
                </label>
                {candidates.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-[#b8c4dc]">
                    <input type="radio" name="meeting" value={m.id} checked={meetingId === m.id} onChange={() => setMeetingId(m.id)} />
                    <span className="tabular-nums text-[#5a688c]">{m.time}{m.endTime ? `–${m.endTime}` : ''}</span>
                    {m.title}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary text-xs py-1 px-3" disabled={attach.isPending}>
              {attach.isPending ? 'שומר…' : 'שמור קישור'}
            </button>
            {rec.meetingId && (
              <Link href={`/meetings/${attach.data?.meetingId ?? rec.meetingId}`} className="btn btn-ghost text-xs py-1 px-3">
                לסיכום המלא
              </Link>
            )}
            {saved && <span className="text-xs text-[#2dd4bf]" role="status">נשמר</span>}
            {attach.error && <span className="text-xs text-red-400">{attach.error.message}</span>}
          </div>
        </form>
      )}
    </section>
  )
}

function VoicePageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const utils = trpc.useUtils()
  const recorder = useRecorder()
  const { data: everyone = [] } = trpc.people.list.useQuery()
  const { data: recent } = trpc.voice.list.useQuery({ limit: 10 })
  const [consent, setConsent] = useState(true)
  const [people, setPeople] = useState<PersonOption[]>([])
  const [projectId, setProjectId] = useState('')
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const [upload, setUpload] = useState<{ progress: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  // The calendar meeting this recording belongs to, picked before recording starts. Participants
  // and project then come from the meeting server-side (docs/specs/record-from-calendar-meeting.md).
  const [meeting, setMeeting] = useState<MeetingChoice | null>(null)
  const [showAllMeetings, setShowAllMeetings] = useState(false)
  // Kept when an upload fails, so the user can resend the exact same audio without re-recording
  // (see docs/specs/voice-upload-retry-without-rerecording.md). Cleared on success or discard.
  const [failedUpload, setFailedUpload] = useState<{ blob: Blob; durationSeconds: number; meetingId: string | null } | null>(null)
  const recordingId = params.get('recording')
  const presetPerson = params.get('person')
  const presetMeeting = params.get('meeting')
  const meetingsQuery = trpc.voice.meetingChoices.useQuery(undefined, { enabled: !presetMeeting })
  const presetMeetingQuery = trpc.voice.meetingContext.useQuery(
    { meetingId: presetMeeting ?? '' },
    { enabled: Boolean(presetMeeting) },
  )
  const todayMeetings = meetingsQuery.data?.meetings ?? []
  const presetMeetingChoice = presetMeetingQuery.data ?? null

  useEffect(() => {
    if (!presetPerson || people.length > 0) return
    const p = everyone.find((x) => x.id === presetPerson)
    if (p) setPeople([{ id: p.id, name: p.name }])
  }, [presetPerson, everyone, people.length])

  const active = recorder.state !== 'idle'

  const doUpload = async (blob: Blob, durationSeconds: number, meetingId: string | null) => {
    const form = new FormData()
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
    form.append('audio', blob, `recording.${ext}`)
    form.append('durationSeconds', String(durationSeconds))
    form.append('consentConfirmed', 'true')
    form.append('personIds', meetingId ? '' : people.map((p) => p.id).join(','))
    if (meetingId) form.append('meetingId', meetingId)
    else if (projectId) form.append('projectId', projectId)
    setMessage(null)
    setUpload({ progress: 0 })
    try {
      const { recordingId: id } = await uploadRecording(form, (progress) => setUpload({ progress }))
      setUpload(null)
      setFailedUpload(null)
      setConsent(true)
      setMeeting(null)
      utils.voice.list.invalidate()
      router.replace(`/voice?recording=${id}`)
    } catch (err) {
      setUpload(null)
      setFailedUpload({ blob, durationSeconds, meetingId })
      setMessage(err instanceof Error ? err.message : 'ההעלאה נכשלה')
    }
  }

  const stopAndUpload = async () => {
    const result = await recorder.stop()
    if (!result) return
    if (result.durationSeconds < MIN_SECONDS) {
      setMessage(`ההקלטה קצרה מ-${MIN_SECONDS} שניות ולא נשמרה`)
      return
    }
    await doUpload(result.blob, result.durationSeconds, meeting?.id ?? null)
  }

  const retryUpload = async () => {
    if (!failedUpload) return
    await doUpload(failedUpload.blob, failedUpload.durationSeconds, failedUpload.meetingId)
  }

  const startFresh = (forMeeting: MeetingChoice | null = null) => {
    if (failedUpload && !window.confirm('יש הקלטה שממתינה לשליחה — להתחיל הקלטה חדשה בכל זאת ולמחוק אותה?')) return
    setFailedUpload(null)
    setMessage(null)
    setMeeting(forMeeting)
    void recorder.start()
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-[#eef3fb]">הקלטת שיחה</h1>
      </div>

      <section className="card p-4 space-y-4 text-sm" data-testid="voice-recorder">
        {!active && !upload && (
          <>
            <label className="flex items-start gap-2 text-[#eef3fb]">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                data-testid="voice-consent"
              />
              <span>
                כל המשתתפים הסכימו להקלטה
                <span className="block text-xs text-[#97a4c2] mt-0.5">
                  הקלטת שיחה בלי הסכמת המשתתפים עלולה להיות אסורה. ההקלטה נשמרת בשרת שלך ומתומללת ב-Gemini.
                </span>
              </span>
            </label>

            <div className="grid gap-5 md:grid-cols-2">
              <div
                className="space-y-4 md:border-e md:border-[#223052] md:pe-5"
                data-testid="voice-free-section"
              >
                <div>
                  <p className="label">הקלטה חופשית</p>
                  <p className="text-xs text-[#97a4c2]">בלי פגישה מהיומן — בחר משתתפים ופרויקט ידנית.</p>
                </div>
                <div>
                  <label className="label" htmlFor="record-people">משתתפים</label>
                  <PeoplePicker inputId="record-people" selected={people} onChange={setPeople} />
                </div>
                <div>
                  <label className="label" htmlFor="record-project">פרויקט</label>
                  <select id="record-project" className="select w-full" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">ללא פרויקט</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="record-device">התקן קלט</label>
                  <select
                    id="record-device"
                    className="select w-full"
                    value={recorder.selectedDeviceId ?? ''}
                    onChange={(e) => recorder.setSelectedDeviceId(e.target.value || null)}
                  >
                    <option value="">ברירת המחדל של המערכת</option>
                    {recorder.devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `התקן ${d.deviceId.slice(0, 6)}`}</option>
                    ))}
                  </select>
                </div>
                {recorder.displayAudioSupported && (
                  <label className="flex items-center gap-2 text-[#b8c4dc] text-xs">
                    <input
                      type="checkbox"
                      checked={recorder.captureMode === 'tab'}
                      onChange={(e) => recorder.setCaptureMode(e.target.checked ? 'tab' : 'mic')}
                    />
                    גם הקלטת אודיו מטאב/מסך משותף (למשל Google Meet בדפדפן)
                  </label>
                )}
                <button type="button" className="text-xs text-[#e8c547] underline underline-offset-2 w-fit" onClick={() => setShowGuide((v) => !v)}>
                  איך מקליטים שיחת זום/Meet במלואה (כולל הצד השני)?
                </button>
                {showGuide && (
                  <div className="rounded-md border border-[#223052] bg-[#131c33] p-3 text-xs text-[#97a4c2] space-y-1.5">
                    <p className="text-[#b8c4dc] font-medium">אם השיחה רצה באפליקציית Zoom/Teams נפרדת (לא בדפדפן):</p>
                    <p>המיקרופון של המחשב שומע רק מה שנשמע פיזית בחדר — אם את/ה על אוזניות, הצד השני לא נקלט בכלל. הפתרון: להתקין דרייבר אודיו וירטואלי חינמי (BlackHole), ליצור &quot;Multi-Output Device&quot; ב-Audio MIDI Setup שמשמיע גם לרמקולים וגם ל-BlackHole, להגדיר אותו כפלט במערכת/ב-Zoom, ואז לבחור את BlackHole כ&quot;התקן קלט&quot; למעלה.</p>
                    <p className="text-[#b8c4dc] font-medium pt-1">אם השיחה רצה בדפדפן (למשל Google Meet):</p>
                    <p>אפשר לסמן למעלה &quot;גם הקלטת אודיו מטאב/מסך משותף&quot; — בלי שום התקנה. שימו לב: באפשרות ל&quot;שתף מסך&quot; יש לוודא שמסמנים גם &quot;שיתוף אודיו&quot;.</p>
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-primary inline-flex items-center gap-2"
                  disabled={!consent}
                  onClick={() => startFresh(null)}
                  data-testid="voice-start"
                >
                  <Mic className="w-4 h-4" aria-hidden />
                  התחל הקלטה
                </button>
              </div>

              {presetMeeting ? (
                <div className="space-y-2" data-testid="voice-preset-meeting">
                  <p className="label">הקלטת פגישה</p>
                  {presetMeetingQuery.isPending ? (
                    <div className="card p-3 h-16 animate-pulse" aria-hidden />
                  ) : presetMeetingChoice ? (
                    <MeetingRow
                      meeting={presetMeetingChoice}
                      disabled={!consent}
                      showDate
                      onPick={() => startFresh(presetMeetingChoice)}
                    />
                  ) : (
                    <p className="text-xs text-[#97a4c2]">הפגישה לא נמצאה. אפשר לבחור פגישה אחרת או להקליט בלי פגישה.</p>
                  )}
                  <Link href="/voice" className="btn-ghost text-[11px] inline-block">בחר פגישה אחרת</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="label" id="voice-meetings-label">פגישות להיום</p>
                  {meetingsQuery.isPending ? (
                    <div className="space-y-1.5" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="card p-3 h-16 animate-pulse" />
                      ))}
                    </div>
                  ) : meetingsQuery.isError ? (
                    <p className="text-xs text-[#97a4c2]">לא הצלחנו לטעון את היומן. אפשר להקליט בלי פגישה.</p>
                  ) : todayMeetings.length === 0 ? (
                    <p className="text-xs text-[#97a4c2]" data-testid="voice-meetings-empty">
                      אין פגישות ביומן להיום. אפשר להקליט שיחה חופשית.
                    </p>
                  ) : (
                    <div className="space-y-1.5" role="group" aria-labelledby="voice-meetings-label">
                      {(showAllMeetings ? todayMeetings : todayMeetings.slice(0, MEETINGS_COLLAPSED)).map((m) => (
                        <MeetingRow key={m.id} meeting={m} disabled={!consent} onPick={() => startFresh(m)} />
                      ))}
                      {!showAllMeetings && todayMeetings.length > MEETINGS_COLLAPSED && (
                        <button type="button" className="btn-ghost text-[11px]" onClick={() => setShowAllMeetings(true)}>
                          עוד פגישות להיום ({todayMeetings.length - MEETINGS_COLLAPSED})
                        </button>
                      )}
                    </div>
                  )}
                  {!consent && <p className="text-xs text-amber-400">צריך לאשר הסכמה קודם</p>}
                </div>
              )}
            </div>
          </>
        )}

        {active && (
          <div className="space-y-3">
            {meeting && (
              <div className="text-xs text-[#b8c4dc]" data-testid="voice-active-meeting">
                <span className="text-[#eef3fb] font-medium">{meeting.title}</span>
                <span className="text-[#5a688c] tabular-nums"> · {meetingRange(meeting)}</span>
                {meetingPeopleLabel(meeting) && <span className="block text-[#97a4c2]">{meetingPeopleLabel(meeting)}</span>}
              </div>
            )}
            <div className="flex items-center gap-3">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${recorder.state === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-[#5a688c]'}`}
                aria-hidden
              />
              <span className="text-2xl font-semibold tabular-nums text-[#eef3fb]" role="timer" aria-label="זמן הקלטה">
                {clock(recorder.elapsed)}
              </span>
              <span className="text-xs text-[#5a688c]">{recorder.state === 'paused' ? 'מושהה' : 'מקליט'}</span>
            </div>
            <div className="flex items-end gap-0.5 h-10" aria-hidden>
              {recorder.levels.map((l, i) => (
                <span key={i} className="flex-1 rounded-sm bg-[#e8c547]" style={{ height: `${Math.max(6, l * 100)}%`, opacity: 0.35 + l * 0.65 }} />
              ))}
            </div>
            <p className="text-xs text-[#5a688c]">
              {recorder.wakeLockSupported
                ? 'ההקלטה ממשיכה גם אם עוברים לטאב אחר. מצב שינה מלא של המחשב עדיין יעצור אותה.'
                : 'ההקלטה ממשיכה גם אם עוברים לטאב אחר, אבל הדפדפן הזה לא תומך במניעת שינה — מומלץ להשאיר את המחשב ער.'}
            </p>
            {recorder.noCallSignal && (
              <p className="text-xs text-amber-400" role="alert">
                לא מזוהה אודיו ממקור השיחה (ההתקן שנבחר / הטאב המשותף) — ייתכן שרק הקול שלך נקלט. כדאי לבדוק את ההגדרות.
              </p>
            )}
            <div className="flex gap-2">
              {recorder.state === 'recording' ? (
                <button type="button" className="btn btn-ghost inline-flex items-center gap-1" onClick={recorder.pause}>
                  <Pause className="w-4 h-4" aria-hidden />
                  השהה
                </button>
              ) : (
                <button type="button" className="btn btn-ghost inline-flex items-center gap-1" onClick={recorder.resume}>
                  <Play className="w-4 h-4" aria-hidden />
                  המשך
                </button>
              )}
              <button type="button" className="btn btn-primary inline-flex items-center gap-1" onClick={() => void stopAndUpload()}>
                <Square className="w-4 h-4" aria-hidden />
                עצור ושלח
              </button>
            </div>
          </div>
        )}

        {upload && (
          <div className="space-y-1.5" role="status">
            <p className="text-[#b8c4dc]">מעלה… {Math.round(upload.progress * 100)}%</p>
            <div className="h-1.5 rounded bg-[#223052] overflow-hidden">
              <div className="h-full bg-[#e8c547] transition-all" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {(recorder.error || message) && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-red-400" role="alert">{recorder.error ?? message}</p>
            {failedUpload && !upload && (
              <button type="button" className="btn btn-ghost text-xs py-1 px-3" onClick={() => void retryUpload()}>
                שלח שוב
              </button>
            )}
          </div>
        )}
      </section>

      {recordingId && <RecordingResult key={recordingId} recordingId={recordingId} />}

      <section>
        <h2 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">הקלטות אחרונות</h2>
        {!recent ? (
          <p className="text-sm text-[#5a688c]">טוען…</p>
        ) : recent.recordings.length === 0 ? (
          <div className="card text-sm text-[#97a4c2]">עוד אין הקלטות.</div>
        ) : (
          <ul className="space-y-1.5" data-testid="voice-recent">
            {recent.recordings.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/voice?recording=${r.id}`}
                  className={`card card-interactive p-2.5 flex flex-wrap items-center gap-2 text-sm ${r.id === recordingId ? 'border-[#e8c547]' : ''}`}
                >
                  <span className="tabular-nums text-[#5a688c]">{format(new Date(r.createdAt), 'dd/MM HH:mm')}</span>
                  <span className="tabular-nums text-[#5a688c]">· {clock(r.duration)}</span>
                  <span className="text-[#eef3fb] truncate">{r.topic ?? (r.people.map((p) => p.name).join(', ') || 'הקלטה')}</span>
                  <span className="pill text-[10px] ms-auto">{STATUS_LABELS[r.status] ?? r.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function VoicePage() {
  return (
    <Suspense fallback={<div className="card text-sm text-[#5a688c]">טוען…</div>}>
      <VoicePageInner />
    </Suspense>
  )
}
