'use client'

import { formatTimeRange } from '@/lib/clock-time'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { Mic, Pause, Play, Square, X, RotateCcw } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { useRecorder } from './lib/use-recorder'
import {
  appendLocalChunk,
  createLocalRecording,
  deleteLocalRecording,
  listLocalRecordings,
  loadLocalRecordingBlob,
  newLocalRecordingId,
  updateLocalRecording,
  type LocalRecording,
} from './lib/local-recordings'
import { uploadBlobResumable } from './lib/resumable-upload'
import { TranscriptView } from './components/TranscriptView'

const MIN_SECONDS = 10
const NOTES_SAVE_MS = 800
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
  return formatTimeRange(m.time, m.endTime)
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
  suggested = [],
}: {
  selected: PersonOption[]
  onChange: (next: PersonOption[]) => void
  inputId: string
  /** Offered first — e.g. the people chosen before upload who aren't assigned to a speaker yet. */
  suggested?: PersonOption[]
}) {
  const { data: everyone = [] } = trpc.people.list.useQuery()
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const chosen = new Set(selected.map((p) => p.id))
    const first = suggested.filter((p) => !chosen.has(p.id))
    if (!q) return first.slice(0, 6)
    const firstIds = new Set(first.map((p) => p.id))
    return [
      ...first.filter((p) => p.name.toLowerCase().includes(q)),
      ...everyone.filter((p) => !chosen.has(p.id) && !firstIds.has(p.id) && p.name.toLowerCase().includes(q)),
    ].slice(0, 6)
  }, [everyone, query, selected, suggested])
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
      <span className="ms-auto inline-flex items-center gap-1 rounded-full border border-[#2dd4bf55] px-2 py-0.5 text-[11px] font-medium text-[#2dd4bf]">
        <Mic className="w-3.5 h-3.5" aria-hidden />
        הקלט
      </span>
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
  const { data: rec } = trpc.voice.get.useQuery({ recordingId })
  const audioRef = useRef<HTMLAudioElement>(null)
  const stopAtRef = useRef<number | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  // Answers stay local until the one "שמור זיהוי" press: a picked person, or "לא מזהה" (skips).
  const [picks, setPicks] = useState<Record<string, PersonOption[]>>({})
  const [skips, setSkips] = useState<Set<string>>(new Set())
  const [correcting, setCorrecting] = useState<Set<string>>(new Set())
  const identify = trpc.voice.identifySpeakers.useMutation({
    onSuccess: () => {
      setCorrecting(new Set())
      setPicks({})
      setSkips(new Set())
      utils.voice.speakers.invalidate({ recordingId })
      utils.voice.get.invalidate({ recordingId })
      utils.voice.getAnalysis.invalidate({ recordingId })
    },
  })

  const visibleSpeakers = speakers.filter((speaker) => speaker.state === 'unknown' || speaker.state === 'auto')
  const hasUnknown = visibleSpeakers.some((speaker) => speaker.state === 'unknown')
  // People chosen for this recording who no speaker has yet — the likeliest answers, offered first.
  const assignedIds = new Set(speakers.map((speaker) => speaker.personId).filter(Boolean))
  const unassignedChosen = (rec?.people ?? []).filter((person) => !assignedIds.has(person.id))
  const answers = visibleSpeakers.flatMap((speaker) => {
    const person = picks[speaker.speakerLabel]?.[0]
    if (person) return [{ speakerLabel: speaker.speakerLabel, personId: person.id }]
    if (skips.has(speaker.speakerLabel)) return [{ speakerLabel: speaker.speakerLabel, personId: null }]
    return []
  })
  const toggle = (set: Set<string>, label: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(label)
    else next.delete(label)
    return next
  }
  const pickPerson = (label: string, next: PersonOption[]) => {
    setPicks((prev) => ({ ...prev, [label]: next.slice(-1) }))
    if (next.length > 0) setSkips((prev) => toggle(prev, label, false))
  }
  const markSkip = (label: string, on: boolean) => {
    setSkips((prev) => toggle(prev, label, on))
    if (on) setPicks((prev) => ({ ...prev, [label]: [] }))
  }
  if (visibleSpeakers.length === 0) {
    // Every speaker is answered; only a failed summary refresh is still worth saying.
    return identify.data?.analysisError ? (
      <p className="pt-3 text-xs text-amber-300" role="alert">הזיהוי נשמר, אבל עדכון הסיכום נכשל</p>
    ) : null
  }

  const stopSample = () => {
    audioRef.current?.pause()
    stopAtRef.current = null
    setPlaying(null)
  }

  // Plays only the quoted segment [startMs, endMs]; clicking the same button again stops it.
  const playSample = (speakerLabel: string, startMs: number, endMs: number) => {
    const el = audioRef.current
    if (!el) return
    if (playing === speakerLabel) {
      stopSample()
      return
    }
    el.pause()
    stopAtRef.current = endMs / 1000
    setPlaying(speakerLabel)
    const begin = () => {
      el.currentTime = startMs / 1000
      void el.play().catch(stopSample)
    }
    // Seeking before the metadata is loaded is ignored by browsers (it restarts at 0).
    if (el.readyState >= 1) begin()
    else el.addEventListener('loadedmetadata', begin, { once: true })
  }

  return (
    <div className="pt-3 border-t border-[#223052] space-y-3" data-testid="voice-speakers">
      <div>
        <p className="label">מי מדבר?</p>
        <p className="text-xs text-[#97a4c2]">
          {hasUnknown
            ? 'שמע דגימה וסמן את האדם. מה שלא מזוהה אפשר לדלג עליו.'
            : 'הדוברים זוהו אוטומטית לפי הקול שלך והמשתתפים שאישרת.'}
        </p>
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
      {visibleSpeakers.map((speaker) => {
        const selected = picks[speaker.speakerLabel] ?? []
        const isAuto = speaker.state === 'auto'
        const isEditing = !isAuto || correcting.has(speaker.speakerLabel)
        const skipped = skips.has(speaker.speakerLabel)
        return (
          <div
            key={speaker.speakerLabel}
            className="card p-3 space-y-2"
            data-testid={isAuto ? 'voice-auto-speaker' : 'voice-unknown-speaker'}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill text-xs">{speaker.speakerLabel}</span>
              <span className="text-xs text-[#5a688c]">{speaker.segmentCount} קטעי דיבור</span>
              {isAuto && (
                <span className="pill text-[11px] text-[#2dd4bf]">
                  זוהה אוטומטית{speaker.personName ? `: ${speaker.personName}` : ''}
                </span>
              )}
              <button
                type="button"
                className="btn-ghost text-[11px] inline-flex items-center gap-1"
                onClick={() => playSample(speaker.speakerLabel, speaker.sampleStartMs, speaker.sampleEndMs)}
                aria-label={`${playing === speaker.speakerLabel ? 'עצור דגימה' : 'השמע דגימה'} של ${speaker.speakerLabel}`}
              >
                {playing === speaker.speakerLabel ? (
                  <Square className="w-3.5 h-3.5" aria-hidden />
                ) : (
                  <Play className="w-3.5 h-3.5" aria-hidden />
                )}
                {playing === speaker.speakerLabel ? 'עצור' : 'השמע דגימה'}
              </button>
            </div>
            <p className="text-xs text-[#b8c4dc] leading-relaxed">“{speaker.sampleText}”</p>
            {isAuto && !isEditing && (
              <button
                type="button"
                className="btn-ghost text-[11px]"
                onClick={() => setCorrecting((prev) => toggle(prev, speaker.speakerLabel, true))}
              >
                לא נכון? תקן
              </button>
            )}
            {isEditing && (
              <>
                {skipped ? (
                  <p className="text-xs text-[#97a4c2]" data-testid="voice-speaker-skip-marked">
                    יסומן כ&quot;לא מזהה&quot;
                  </p>
                ) : (
                  <PeoplePicker
                    inputId={`speaker-${speaker.speakerLabel.replace(/\s+/g, '-')}`}
                    suggested={unassignedChosen}
                    selected={selected}
                    onChange={(next) => pickPerson(speaker.speakerLabel, next)}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {!isAuto && (
                    <button
                      type="button"
                      className="btn btn-ghost text-xs py-1 px-3"
                      aria-pressed={skipped}
                      disabled={identify.isPending}
                      onClick={() => markSkip(speaker.speakerLabel, !skipped)}
                    >
                      {skipped ? 'בחר אדם' : 'לא מזהה'}
                    </button>
                  )}
                  {isAuto && (
                    <button
                      type="button"
                      className="btn btn-ghost text-xs py-1 px-3"
                      disabled={identify.isPending}
                      onClick={() => {
                        setCorrecting((prev) => toggle(prev, speaker.speakerLabel, false))
                        setPicks((previous) => ({ ...previous, [speaker.speakerLabel]: [] }))
                      }}
                    >
                      ביטול
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
      {visibleSpeakers.length > 0 && (
        <button
          type="button"
          className="btn btn-primary text-sm w-full sm:w-auto"
          data-testid="voice-speakers-save"
          disabled={answers.length === 0 || identify.isPending}
          onClick={() => identify.mutate({ recordingId, answers })}
        >
          {answers.length > 1 ? `שמור זיהוי (${answers.length})` : 'שמור זיהוי'}
        </button>
      )}
      {identify.isPending && <p className="text-xs text-[#97a4c2]" role="status">שומר ומעדכן את הסיכום…</p>}
      {identify.data?.analysisError && (
        <p className="text-xs text-amber-300" role="alert">הזיהוי נשמר, אבל עדכון הסיכום נכשל</p>
      )}
      {identify.error && <p className="text-xs text-red-400" role="alert">{identify.error.message}</p>}
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
  const [showTranscript, setShowTranscript] = useState(false)
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
  // A long recording whose later chunks failed to transcribe still shows as completed, with the analysis
  // covering only what was transcribed — offer to transcribe it again.
  const hasGaps = (rec.transcriptText ?? '').includes('[לא ניתן היה לתמלל את הקטע')
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
      {rec.status === 'completed' && hasGaps && (
        <div className="flex flex-wrap items-center gap-2" data-testid="voice-transcript-gaps">
          <p className="text-amber-400 text-xs" role="alert">חלק מההקלטה לא תומלל, והניתוח מכסה רק את מה שתומלל.</p>
          <button
            type="button"
            className="btn btn-ghost text-xs py-1 px-3 inline-flex items-center gap-1"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ recordingId })}
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden />
            {retry.isPending ? 'מתחיל…' : 'תמלל מחדש את כל ההקלטה'}
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
                  <li key={i} data-testid="voice-action-item">
                    • {a.content}
                    {a.personId && a.personName ? (
                      <>
                        {' · '}
                        <Link href={`/people?person=${a.personId}`} className="text-[#2dd4bf] hover:underline" data-testid="voice-action-owner">
                          {a.personName}
                        </Link>
                      </>
                    ) : (
                      a.owner && <span className="text-[#5a688c]"> · {a.owner}</span>
                    )}
                  </li>
                ))}
              </ul>
              <Link href="/commitments" className="btn-ghost text-[11px] mt-1 inline-block">לאישור ההתחייבויות</Link>
            </div>
          )}
        </div>
      )}

      {done && <SpeakerPrompt recordingId={recordingId} />}

      {done && (
        <div className="pt-3 border-t border-[#223052]" data-testid="voice-transcript-section">
          <button
            type="button"
            className="text-xs font-medium text-[#97a4c2] hover:text-[#eef3fb]"
            aria-expanded={showTranscript}
            onClick={() => setShowTranscript((v) => !v)}
          >
            {showTranscript ? '▼' : '▶'} תמלול מלא
          </button>
          {showTranscript && (
            <div className="mt-3">
              <TranscriptView recordingId={recordingId} />
            </div>
          )}
        </div>
      )}

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
                    <span className="tabular-nums text-[#5a688c]">{formatTimeRange(m.time, m.endTime)}</span>
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

/**
 * Holds a recorded blob awaiting user confirmation before the actual HTTP upload.
 * Introduced by docs/specs/recording-context-before-upload.md.
 */
type PendingReview = {
  blob: Blob
  durationSeconds: number
  /** The calendar meeting ID to attach, if the recording was started from a meeting row. */
  meetingId: string | null
  /** Display title for the linked meeting (shown in the review panel). */
  meetingTitle: string | null
}

/** Prep already stored for the meeting, plus notes to deal with after the recording. Web only. */
function RecordingAside({
  meetingId,
  notes,
  onNotes,
}: {
  meetingId: string | null
  notes: string
  onNotes: (value: string) => void
}) {
  const prep = trpc.meetings.getPrep.useQuery(
    { meetingId: meetingId ?? '' },
    { enabled: Boolean(meetingId) },
  )
  return (
    <div className="space-y-3" data-testid="voice-live-aside">
      {meetingId && (
        <div data-testid="voice-meeting-prep">
          <p className="label">הכנה לפגישה</p>
          {prep.isPending ? (
            <p className="text-xs text-[#5a688c]">טוען הכנה…</p>
          ) : prep.data?.bodyText ? (
            <div className="max-h-48 overflow-y-auto text-sm text-[#97a4c2] leading-relaxed whitespace-pre-wrap">
              {prep.data.bodyText}
            </div>
          ) : (
            <p className="text-xs text-[#5a688c]">אין עדיין הכנה לפגישה</p>
          )}
        </div>
      )}
      <div>
        <label className="label" htmlFor="voice-capture-notes">הערות להמשך</label>
        <textarea
          id="voice-capture-notes"
          className="input w-full text-sm resize-y"
          rows={4}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="דברים לטפל אחרי הפגישה"
          data-testid="voice-capture-notes"
        />
      </div>
    </div>
  )
}

function VoicePageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const utils = trpc.useUtils()
  // Durable on-device copy of the recording in progress (docs/specs/voice-recording-never-lost.md).
  const localId = useRef<string | null>(null)
  const localChain = useRef<Promise<void>>(Promise.resolve())
  const startContext = useRef<{ meetingId: string | null; meetingTitle: string | null; people: PersonOption[]; projectId: string }>({
    meetingId: null, meetingTitle: null, people: [], projectId: '',
  })
  const [localBackupFailed, setLocalBackupFailed] = useState(false)
  const [savedRecordings, setSavedRecordings] = useState<LocalRecording[]>([])
  const [reconnecting, setReconnecting] = useState(false)
  const queueLocal = useCallback((fn: () => Promise<void>) => {
    const next = localChain.current.then(fn).catch(() => setLocalBackupFailed(true))
    localChain.current = next
    return next
  }, [])
  const recorder = useRecorder({
    onStart: (mimeType) => {
      const id = newLocalRecordingId()
      localId.current = id
      setLocalBackupFailed(false)
      const ctx = startContext.current
      void queueLocal(() =>
        createLocalRecording({
          id,
          startedAt: new Date().toISOString(),
          mimeType,
          durationSeconds: 0,
          state: 'recording',
          meetingId: ctx.meetingId,
          meetingTitle: ctx.meetingTitle,
          personIds: ctx.people.map((p) => p.id),
          personNames: ctx.people.map((p) => p.name),
          projectId: ctx.projectId,
          chunkCount: 0,
        }),
      )
    },
    onChunk: (chunk, seq, elapsedSeconds) => {
      const id = localId.current
      if (id) void queueLocal(() => appendLocalChunk(id, seq, chunk, elapsedSeconds))
    },
  })
  const refreshSaved = useCallback(() => {
    void listLocalRecordings()
      .then((all) => setSavedRecordings(all.filter((r) => r.id !== localId.current)))
      .catch(() => setSavedRecordings([]))
  }, [])
  useEffect(() => refreshSaved(), [refreshSaved])
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
  const [failedUpload, setFailedUpload] = useState<{
    blob: Blob
    durationSeconds: number
    meetingId: string | null
    people: PersonOption[]
    projectId: string
    localId: string | null
  } | null>(null)
  // Blob captured after stopping, waiting for the user to confirm context before uploading.
  // (docs/specs/recording-context-before-upload.md)
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null)
  // Separate people/project/meeting state for the review step, pre-seeded from the active context.
  const [reviewPeople, setReviewPeople] = useState<PersonOption[]>([])
  const [reviewProjectId, setReviewProjectId] = useState('')
  // Meeting linked during review (overrides pendingReview.meetingId when set explicitly)
  const [reviewMeetingId, setReviewMeetingId] = useState<string | null>(null)
  const [reviewMeetingTitle, setReviewMeetingTitle] = useState<string | null>(null)
  const [showReviewMeetingPicker, setShowReviewMeetingPicker] = useState(false)
  const [captureNotes, setCaptureNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const saveCapture = trpc.meetings.saveRecordingNotes.useMutation()
  const createManual = trpc.meetings.createManual.useMutation()
  const deleteIfEmpty = trpc.meetings.deleteIfEmpty.useMutation()
  const [notesError, setNotesError] = useState(false)
  // Meeting created on the fly because the recording had none; cleaned up if it stays empty.
  const autoMeetingId = useRef<string | null>(null)
  const saveCaptureRef = useRef(saveCapture.mutateAsync)
  saveCaptureRef.current = saveCapture.mutateAsync
  const saveChain = useRef(Promise.resolve())
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
  // Calendar meetings on the same date as a recording under review (for the meeting-change picker)
  const reviewDate = pendingReview ? new Date(Date.now() - (pendingReview.durationSeconds ?? 0) * 1000).toISOString().slice(0, 10) : null
  const reviewDayMeetingsQuery = trpc.meetings.calendarOnDate.useQuery(
    { date: reviewDate ?? '' },
    { enabled: Boolean(pendingReview && showReviewMeetingPicker) },
  )
  const reviewDayMeetings = reviewDayMeetingsQuery.data?.meetings ?? []

  useEffect(() => {
    if (!presetPerson || people.length > 0) return
    const p = everyone.find((x) => x.id === presetPerson)
    if (p) setPeople([{ id: p.id, name: p.name }])
  }, [presetPerson, everyone, people.length])

  const active = recorder.state !== 'idle'

  // Keep the on-device copy's context in step with the review choices, so a recording recovered
  // after a reload is sent with the people/project/meeting the user picked.
  useEffect(() => {
    const id = localId.current
    if (!pendingReview || !id) return
    void queueLocal(() =>
      updateLocalRecording(id, {
        meetingId: reviewMeetingId,
        meetingTitle: reviewMeetingTitle,
        personIds: reviewPeople.map((p) => p.id),
        personNames: reviewPeople.map((p) => p.name),
        projectId: reviewProjectId,
      }),
    )
  }, [pendingReview, reviewMeetingId, reviewMeetingTitle, reviewPeople, reviewProjectId, queueLocal])

  // Leaving mid-recording / review / upload asks first. The audio is kept on the device either
  // way, but the browser's own prompt is the clearest "you're about to walk away" signal.
  const unsaved = active || Boolean(pendingReview) || Boolean(upload)
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsaved])
  const linkedMeetingId = pendingReview ? reviewMeetingId : meeting?.id ?? null

  const queueCaptureSave = useCallback((meetingId: string, notes: string) => {
    const run = saveCaptureRef.current
    const next = saveChain.current
      .then(() => run({ meetingId, notes }))
      .then(() => setNotesError(false))
      .catch(() => setNotesError(true))
    saveChain.current = next
    return next
  }, [])

  /** Drop the on-the-fly meeting unless the recording ends up linked to it. */
  const dropAutoMeeting = useCallback((keepId: string | null = null) => {
    const id = autoMeetingId.current
    if (!id || id === keepId) return
    autoMeetingId.current = null
    void deleteIfEmpty.mutateAsync({ meetingId: id }).catch(() => undefined)
  }, [deleteIfEmpty])

  useEffect(() => {
    if (!notesDirty || !linkedMeetingId) return
    const handle = window.setTimeout(() => {
      void queueCaptureSave(linkedMeetingId, captureNotes)
    }, NOTES_SAVE_MS)
    return () => window.clearTimeout(handle)
  }, [captureNotes, notesDirty, linkedMeetingId, queueCaptureSave])

  const doUpload = async (
    blob: Blob,
    durationSeconds: number,
    meetingId: string | null,
    uploadPeople: PersonOption[],
    uploadProjectId: string,
    uploadLocalId: string | null,
  ) => {
    setMessage(null)
    setReconnecting(false)
    setUpload({ progress: 0 })
    try {
      // Always confirm people/project — the server then skips merging calendar attendees.
      // meetingId still wires the recording to its calendar event for title / project.
      const { recordingId: id } = await uploadBlobResumable(
        blob,
        {
          clientSessionId: uploadLocalId ?? newLocalRecordingId(),
          mimeType: blob.type || 'audio/webm',
          durationSeconds,
          meetingId,
          projectId: uploadProjectId || null,
          personIds: uploadPeople.map((p) => p.id),
        },
        { onProgress: (progress) => setUpload({ progress }), onRetrying: (info) => setReconnecting(Boolean(info)) },
      )
      // The server has it — only now is the local copy dropped.
      if (uploadLocalId) await deleteLocalRecording(uploadLocalId).catch(() => undefined)
      if (localId.current === uploadLocalId) localId.current = null
      setUpload(null)
      setReconnecting(false)
      setFailedUpload(null)
      setPendingReview(null)
      setReviewMeetingId(null)
      setReviewMeetingTitle(null)
      setShowReviewMeetingPicker(false)
      setConsent(true)
      setMeeting(null)
      setCaptureNotes('')
      setNotesDirty(false)
      utils.voice.list.invalidate()
      refreshSaved()
      router.replace(`/voice?recording=${id}`)
    } catch (err) {
      const error = err instanceof Error ? err.message : 'ההעלאה נכשלה'
      if (uploadLocalId) void updateLocalRecording(uploadLocalId, { state: 'pending', lastError: error }).catch(() => undefined)
      setUpload(null)
      setReconnecting(false)
      setFailedUpload({ blob, durationSeconds, meetingId, people: uploadPeople, projectId: uploadProjectId, localId: uploadLocalId })
      setPendingReview(null)
      setMessage(`${error} — ההקלטה שמורה במכשיר ואפשר לשלוח שוב.`)
    }
  }

  /** Send a recording kept on this device from an earlier visit (reload, closed tab, failed upload). */
  const sendSaved = async (rec: LocalRecording) => {
    const blob = await loadLocalRecordingBlob(rec.id).catch(() => null)
    if (!blob) {
      setMessage('לא נמצא אודיו שמור להקלטה הזו')
      return
    }
    const savedPeople = rec.personIds.map((id, i) => ({ id, name: rec.personNames[i] ?? '' }))
    await doUpload(blob, rec.durationSeconds, rec.meetingId, savedPeople, rec.projectId, rec.id)
  }

  const discardSaved = async (rec: LocalRecording) => {
    if (!window.confirm('למחוק את ההקלטה מהמכשיר? היא לא נשלחה לשרת ולא יהיה אפשר לשחזר אותה.')) return
    await deleteLocalRecording(rec.id).catch(() => undefined)
    refreshSaved()
  }

  /** Stop the recorder and open the review panel instead of uploading immediately. */
  const stopAndReview = async () => {
    if (meeting?.id && notesDirty) await queueCaptureSave(meeting.id, captureNotes)
    const result = await recorder.stop()
    if (!result) return
    const id = localId.current
    if (result.durationSeconds < MIN_SECONDS) {
      setMessage(`ההקלטה קצרה מ-${MIN_SECONDS} שניות ולא נשמרה`)
      dropAutoMeeting()
      if (id) void queueLocal(() => deleteLocalRecording(id))
      localId.current = null
      return
    }
    if (id) void queueLocal(() => updateLocalRecording(id, { state: 'review', durationSeconds: result.durationSeconds }))
    // Pre-seed review state from the current context.
    if (meeting) {
      setReviewPeople(meeting.people.map((p) => ({ id: p.id, name: p.name })))
      setReviewProjectId(meeting.projectId ?? '')
    } else {
      setReviewPeople(people)
      setReviewProjectId(projectId)
    }
    setReviewMeetingId(meeting?.id ?? null)
    setReviewMeetingTitle(meeting?.title ?? null)
    setShowReviewMeetingPicker(false)
    setPendingReview({ blob: result.blob, durationSeconds: result.durationSeconds, meetingId: meeting?.id ?? null, meetingTitle: meeting?.title ?? null })
  }

  /** Confirm the review and send the upload. */
  const confirmUpload = async () => {
    if (!pendingReview) return
    if (reviewMeetingId && (notesDirty || captureNotes.trim())) {
      await queueCaptureSave(reviewMeetingId, captureNotes)
    }
    dropAutoMeeting(reviewMeetingId)
    await localChain.current
    await doUpload(pendingReview.blob, pendingReview.durationSeconds, reviewMeetingId, reviewPeople, reviewProjectId, localId.current)
    autoMeetingId.current = null
  }

  /** Discard captured audio and return to idle. */
  const cancelReview = () => {
    if (!window.confirm('למחוק את ההקלטה? היא לא תישלח ולא תישמר.')) return
    const id = localId.current
    localId.current = null
    if (id) void queueLocal(() => deleteLocalRecording(id))
    dropAutoMeeting()
    setPendingReview(null)
    setMessage(null)
    setReviewMeetingId(null)
    setReviewMeetingTitle(null)
    setShowReviewMeetingPicker(false)
    setCaptureNotes('')
    setNotesDirty(false)
  }

  const retryUpload = async () => {
    if (!failedUpload) return
    await doUpload(
      failedUpload.blob,
      failedUpload.durationSeconds,
      failedUpload.meetingId,
      failedUpload.people,
      failedUpload.projectId,
      failedUpload.localId,
    )
  }

  const startFresh = async (forMeeting: MeetingChoice | null = null) => {
    // A failed upload stays on the device and moves to the "not sent" list — nothing is deleted.
    setFailedUpload(null)
    localId.current = null
    refreshSaved()
    setPendingReview(null)
    setMessage(null)
    setCaptureNotes('')
    setNotesDirty(false)
    let target = forMeeting
    if (!target) {
      // No calendar event: give the recording a meeting now so typed notes have somewhere to go.
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
      try {
        const { id } = await createManual.mutateAsync({ title: `שיחה ${date} ${time}`, date, time })
        autoMeetingId.current = id
        target = {
          id, title: `שיחה ${date} ${time}`, date, time, endTime: null, location: null,
          projectId: null, projectName: null, people: [], state: 'now',
        }
      } catch {
        // Recording still starts; without a meeting the notes are not saved, so say so.
        setMessage('לא ניתן היה ליצור פגישה להקלטה — הערות לא יישמרו עד שתקשר פגישה')
      }
    }
    setMeeting(target)
    startContext.current = target
      ? { meetingId: target.id, meetingTitle: target.title, people: target.people, projectId: target.projectId ?? '' }
      : { meetingId: null, meetingTitle: null, people, projectId }
    void recorder.start()
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-[#eef3fb]">הקלטת שיחה</h1>
      </div>

      {savedRecordings.length > 0 && !active && (
        <section className="card p-4 space-y-2 text-sm border-[#e8c547]" data-testid="voice-saved-recordings" aria-live="polite">
          <p className="font-semibold text-[#eef3fb]">
            {savedRecordings.length === 1 ? 'יש הקלטה שלא נשלחה' : `יש ${savedRecordings.length} הקלטות שלא נשלחו`}
          </p>
          <p className="text-xs text-[#97a4c2]">ההקלטות שמורות בדפדפן הזה בלבד, עד שיגיעו לשרת.</p>
          <ul className="space-y-1.5">
            {savedRecordings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2" data-testid="voice-saved-recording">
                <span className="tabular-nums text-[#5a688c]">{format(new Date(r.startedAt), 'dd/MM HH:mm')}</span>
                <span className="tabular-nums text-[#5a688c]">· {clock(r.durationSeconds)}</span>
                <span className="text-[#eef3fb] truncate min-w-0">
                  {r.meetingTitle ?? (r.personNames.filter(Boolean).join(', ') || 'הקלטה')}
                </span>
                {r.state === 'recording' && <span className="pill text-[10px]">נקטעה באמצע</span>}
                <span className="ms-auto flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary text-xs py-1 px-3"
                    disabled={Boolean(upload)}
                    onClick={() => void sendSaved(r)}
                    data-testid="voice-saved-send"
                  >
                    שלח
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs py-1 px-3"
                    disabled={Boolean(upload)}
                    onClick={() => void discardSaved(r)}
                    data-testid="voice-saved-delete"
                  >
                    מחק
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4 space-y-4 text-sm" data-testid="voice-recorder">
        {active && localBackupFailed && (
          <p className="text-xs text-amber-300" role="alert" data-testid="voice-backup-warning">
            הגיבוי המקומי לא פעיל — אל תסגור את הדף עד שההקלטה תישלח.
          </p>
        )}
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
                  className={presetMeetingChoice ? 'btn btn-ghost inline-flex items-center gap-1 text-xs' : 'btn btn-primary inline-flex items-center gap-2'}
                  disabled={!consent}
                  onClick={() => startFresh(null)}
                  data-testid="voice-start"
                >
                  <Mic className="w-4 h-4" aria-hidden />
                  {presetMeetingChoice ? 'הקלטה חופשית — בלי הפגישה' : 'התחל הקלטה'}
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
            {notesError && (
              <p className="text-xs text-amber-400" role="alert" data-testid="voice-notes-error">
                השמירה נכשלה — ננסה שוב בהקלדה הבאה. ההערות נשארות בתיבה.
              </p>
            )}
            <RecordingAside
              meetingId={meeting?.id ?? null}
              notes={captureNotes}
              onNotes={(value) => { setCaptureNotes(value); setNotesDirty(true) }}
            />
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
              <button type="button" className="btn btn-primary inline-flex items-center gap-1" onClick={() => void stopAndReview()}>
                <Square className="w-4 h-4" aria-hidden />
                עצור ושלח
              </button>
            </div>
          </div>
        )}

        {upload && (
          <div className="space-y-1.5" role="status">
            <p className="text-[#b8c4dc]" data-testid="voice-upload-progress">
              {reconnecting ? 'החיבור נקטע — ממשיך…' : 'מעלה…'} {Math.round(upload.progress * 100)}%
            </p>
            <div className="h-1.5 rounded bg-[#223052] overflow-hidden">
              <div className="h-full bg-[#e8c547] transition-all" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Review step: shown after stopping, before the actual upload */}
        {pendingReview && !upload && (
          <div className="space-y-4 pt-3 border-t border-[#223052]" data-testid="voice-review-panel">
            <p className="text-sm font-semibold text-[#eef3fb]">אישור לפני העלאה</p>
            <RecordingAside
              meetingId={reviewMeetingId}
              notes={captureNotes}
              onNotes={(value) => { setCaptureNotes(value); setNotesDirty(true) }}
            />
            <p className="text-xs text-[#97a4c2]">בדוק את ההקשר ולחץ &ldquo;העלה שיחה&rdquo; כשהכל מוכן.</p>
            {/* Meeting link row */}
            <div>
              <label className="label">פגישה</label>
              {reviewMeetingId && reviewMeetingTitle ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[#eef3fb] font-medium">{reviewMeetingTitle}</span>
                  <button type="button" className="btn-ghost text-[11px]" onClick={() => setShowReviewMeetingPicker((v) => !v)}>
                    החלף
                  </button>
                  <button type="button" className="btn-ghost text-[11px] text-[#97a4c2]" onClick={() => { setReviewMeetingId(null); setReviewMeetingTitle(null); setShowReviewMeetingPicker(false) }}>
                    נקה
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[#5a688c]">בלי פגישה</span>
                  <button type="button" className="btn-ghost text-[11px]" onClick={() => setShowReviewMeetingPicker((v) => !v)}>
                    שייך לפגישה
                  </button>
                </div>
              )}
              {showReviewMeetingPicker && (
                <div className="mt-2 space-y-1" data-testid="voice-review-meeting-picker">
                  {reviewDayMeetingsQuery.isPending ? (
                    <p className="text-xs text-[#5a688c]">טוען פגישות…</p>
                  ) : reviewDayMeetings.length === 0 ? (
                    <p className="text-xs text-[#5a688c]">אין פגישות יומן בתאריך הזה</p>
                  ) : (
                    reviewDayMeetings.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="btn btn-ghost text-xs py-1 px-3 w-full text-start"
                        onClick={() => {
                          setReviewMeetingId(m.id)
                          setReviewMeetingTitle(m.title)
                          setShowReviewMeetingPicker(false)
                        }}
                      >
                        <span className="tabular-nums text-[#5a688c] me-2">{formatTimeRange(m.time, m.endTime)}</span>
                        {m.title}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor="review-people">משתתפים</label>
              <PeoplePicker inputId="review-people" selected={reviewPeople} onChange={setReviewPeople} />
            </div>
            <div>
              <label className="label" htmlFor="review-project">פרויקט</label>
              <select
                id="review-project"
                className="select w-full"
                value={reviewProjectId}
                onChange={(e) => setReviewProjectId(e.target.value)}
              >
                <option value="">ללא פרויקט</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary text-sm"
                onClick={() => void confirmUpload()}
                data-testid="voice-review-confirm"
              >
                העלה שיחה
              </button>
              <button
                type="button"
                className="btn btn-ghost text-sm"
                onClick={cancelReview}
                data-testid="voice-review-cancel"
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {(recorder.error || message) && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-red-400" role="alert">{recorder.error ?? message}</p>
            {failedUpload && !upload && !pendingReview && (
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
