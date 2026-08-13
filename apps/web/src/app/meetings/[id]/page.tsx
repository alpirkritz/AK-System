'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, DAYS_HE } from '@ak-system/types'
import { WorkspacePill } from '@/components/WorkspacePill'
import { SyncToast } from '@/components/SyncToast'
import { notionPeopleSyncMessage } from '@/lib/notion-people-sync-message'
import dynamic from 'next/dynamic'
const MeetingModal = dynamic(() => import('@/components/Modals/MeetingModal').then((m) => m.MeetingModal), { ssr: false })
const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })

export default function MeetingDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const { data: meeting, isLoading } = trpc.meetings.getById.useQuery({ id }, { enabled: !!id })
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetingsList = [] } = trpc.meetings.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  const { data: meetingTypes = [] } = trpc.meetingTypes.list.useQuery()

  type MeetingExtended = typeof meeting & {
    projectId?: string | null
    typeId?: string | null
    seriesId?: string | null
    location?: string | null
    endTime?: string | null
    calendarSource?: string | null
    calendarEventId?: string | null
    peopleIds?: string[]
  }
  const mx = meeting as MeetingExtended
  const project = mx?.projectId ? projects.find((p) => p.id === mx.projectId) : null
  const meetingType = mx?.typeId ? meetingTypes.find((t) => t.id === mx.typeId) : null

  const { data: series } = trpc.meetings.getSeries.useQuery(
    { id: mx?.seriesId as string },
    { enabled: !!mx?.seriesId },
  )
  const [editingSeriesNotes, setEditingSeriesNotes] = useState(false)
  const [seriesNotesValue, setSeriesNotesValue] = useState('')

  const SOURCE_LABEL: Record<string, string> = { google: 'Google', apple: 'Apple' }
  const SOURCE_COLOR: Record<string, string> = { google: '#4285f4', apple: '#7a89ab' }

  function formatDuration(start: string, end: string): string {
    const diffMs = new Date(end).getTime() - new Date(start).getTime()
    const mins = Math.round(diffMs / 60000)
    if (mins < 60) return `${mins} דק׳`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `${h}ש׳ ${m}דק׳` : `${h} שעות`
  }

  const utils = trpc.useUtils()

  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  })

  const updateMeeting = trpc.meetings.update.useMutation({
    onSuccess: () => {
      utils.meetings.getById.invalidate()
      utils.meetings.list.invalidate()
    },
  })

  const deleteMeeting = trpc.meetings.delete.useMutation({
    onSuccess: () => router.push('/meetings'),
  })

  const updateSeriesNotes = trpc.meetings.updateSeriesNotes.useMutation({
    onSuccess: () => {
      utils.meetings.getSeries.invalidate()
      setEditingSeriesNotes(false)
    },
  })

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.meetings.list.invalidate()
    },
  })

  const [meetingModalOpen, setMeetingModalOpen] = useState(false)
  const [peopleSyncMessage, setPeopleSyncMessage] = useState<string | null>(null)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  // Inline notes
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')

  // Quick task add
  const [quickTask, setQuickTask] = useState('')

  // Copy-summary feedback
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!moreOpen) return
    function handler(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moreOpen])

  const getPerson = (pid: string) => people.find((p) => p.id === pid)
  const getWorkspace = (wid?: string | null) => (wid ? workspaces.find((w) => w.id === wid) : undefined)
  const tasks = tasksList.filter((t) => t.meetingId === id)

  if (isLoading || !meeting) {
    return <div className="text-[#7a89ab]">טוען...</div>
  }

  const peopleIds = mx?.peopleIds ?? []

  function startEditNotes() {
    setNotesValue(meeting?.notes ?? '')
    setEditingNotes(true)
  }

  function saveNotes() {
    if (!mx || !meeting) return
    updateMeeting.mutate({
      id,
      title: meeting.title,
      date: meeting.date,
      time: meeting.time,
      recurring: meeting.recurring,
      recurrenceDay: meeting.recurrenceDay,
      projectId: mx.projectId ?? null,
      peopleIds,
      notes: notesValue,
    })
    setEditingNotes(false)
  }

  function copySummary() {
    const lines: string[] = []
    lines.push(`📋 ${meeting.title}`)
    lines.push(`📅 ${new Date(meeting.date + 'T00:00:00').toLocaleDateString('he-IL')} · ${meeting.time}`)
    if (project) lines.push(`📁 ${project.name}`)
    if (peopleIds.length > 0) {
      lines.push('')
      lines.push('משתתפים:')
      peopleIds.forEach((pid) => {
        const p = getPerson(pid)
        if (p) lines.push(`• ${p.name}${p.role ? ` (${p.role})` : ''}`)
      })
    }
    if (meeting.notes) {
      lines.push('')
      lines.push('הערות:')
      lines.push(meeting.notes)
    }
    if (tasks.length > 0) {
      lines.push('')
      lines.push('פעולות שהוחלטו:')
      tasks.forEach((t) => {
        const assignee = t.assigneeId ? getPerson(t.assigneeId) : null
        lines.push(`${t.done ? '✓' : '◻'} ${t.title}${assignee ? ` — ${assignee.name}` : ''}`)
      })
    }
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function addQuickTask() {
    if (!quickTask.trim()) return
    createTask.mutate({
      title: quickTask.trim(),
      meetingId: id,
      projectId: mx?.projectId ?? null,
      assigneeId: null,
      dueDate: null,
      priority: 'medium',
    })
    setQuickTask('')
  }

  const followUpInitialValues = {
    title: `המשך — ${meeting.title}`,
    projectId: mx?.projectId ?? '',
    peopleIds,
    time: meeting.time,
    date: '',
    notes: '',
    recurring: null as string | null,
    recurrenceDay: null as string | null,
  }

  return (
    <div>
      {/* ── Action bar ─────────────────────────────────────────────────────── */}
      <div className="flex gap-2 items-center mb-7 flex-wrap">
        <Link href="/meetings" className="btn btn-ghost">← חזרה</Link>
        <button className="btn btn-ghost" onClick={() => setMeetingModalOpen(true)}>✏ ערוך</button>
        <button className="btn btn-ghost" onClick={copySummary} title="העתק סיכום ללוח">
          {copied ? '✓ הועתק' : '📋 צור סיכום'}
        </button>
        <button className="btn btn-primary" onClick={() => setTaskModalOpen(true)}>+ משימה</button>

        {/* More menu — follow-up + delete */}
        <div className="relative" ref={moreRef}>
          <button
            className="btn btn-ghost px-2.5"
            onClick={() => setMoreOpen((v) => !v)}
            title="עוד פעולות"
          >
            ⋯
          </button>
          {moreOpen && (
            <div
              className="absolute right-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden shadow-2xl"
              style={{ minWidth: 180, background: '#141f36', border: '1px solid #29395d' }}
            >
              <button
                className="flex items-center gap-2 w-full px-3.5 py-2.5 text-sm text-right hover:bg-[#1e1e1e] transition-colors"
                onClick={() => { setMoreOpen(false); setFollowUpOpen(true) }}
              >
                🔁 קבע המשך
              </button>
              <div style={{ height: 1, background: '#1e1e1e' }} />
              <button
                className="flex items-center gap-2 w-full px-3.5 py-2.5 text-sm text-right hover:bg-[#1e1e1e] transition-colors"
                style={{ color: '#e57373' }}
                onClick={() => {
                  setMoreOpen(false)
                  if (window.confirm('למחוק את הפגישה? הפעולה לא ניתנת לביטול.')) {
                    deleteMeeting.mutate({ id })
                  }
                }}
              >
                🗑 מחק פגישה
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Title + badges ─────────────────────────────────────────────────── */}
      <div className="flex gap-2 items-center mb-1.5 flex-wrap">
        <h1 className="text-[26px] font-bold tracking-tight">{meeting.title}</h1>
        {meeting.recurring && (
          <span className="pill">↻ {DAYS_HE[meeting.recurrenceDay ?? ''] ?? 'שבועי'}</span>
        )}
        {meetingType && (
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{
              background: (meetingType.color ?? '#8b5cf6') + '22',
              color: meetingType.color ?? '#8b5cf6',
              border: `1px solid ${(meetingType.color ?? '#8b5cf6')}33`,
            }}
          >
            {meetingType.name}
          </span>
        )}
        {mx.calendarSource && (
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{
              background: (SOURCE_COLOR[mx.calendarSource] ?? '#7a89ab') + '22',
              color: SOURCE_COLOR[mx.calendarSource] ?? '#7a89ab',
              border: `1px solid ${(SOURCE_COLOR[mx.calendarSource] ?? '#7a89ab')}33`,
            }}
          >
            {SOURCE_LABEL[mx.calendarSource] ?? mx.calendarSource}
          </span>
        )}
      </div>

      {/* ── Metadata row ───────────────────────────────────────────────────── */}
      <div className="text-[#647399] text-sm mb-7 flex items-center gap-3 flex-wrap">
        📅 {new Date(meeting.date + 'T00:00:00').toLocaleDateString('he-IL')} · {meeting.time}
        {mx.endTime && (
          <span className="text-[#5a688c]">
            · {formatDuration(`${meeting.date}T${meeting.time}`, mx.endTime)}
          </span>
        )}
        {mx.location && (
          <span className="flex items-center gap-1 text-[#5a688c]">📍 {mx.location}</span>
        )}

        {/* Project pill — or actionable CTA when missing */}
        {project ? (
          <Link href={`/projects/${project.id}`} className="pill text-[11px]">
            📁 {project.name}
          </Link>
        ) : (
          <button
            className="text-[11px] text-[#435a8c] hover:text-[#6f7ea0] transition-colors border border-dashed rounded-full px-2.5 py-0.5"
            style={{ borderColor: '#2e2e2e' }}
            onClick={() => setMeetingModalOpen(true)}
            title="שייך לפרויקט"
          >
            + שייך לפרויקט
          </button>
        )}
      </div>

      {/* ── Two-column body ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Left: Attendees + Notes */}
        <div>
          <div className="card">
            <div className="text-xs font-semibold text-[#5a688c] mb-3 uppercase tracking-wider">משתתפים</div>
            {peopleIds.map((pid) => {
              const p = getPerson(pid)
              return p ? (
                <div key={pid} className="flex gap-2.5 items-center mb-2.5">
                  <div
                    className="avatar w-[34px] h-[34px] text-[13px] border-[1.5px]"
                    style={{
                      background: (p.color ?? '#2dd4bf') + '22',
                      color: p.color ?? '#2dd4bf',
                      borderColor: (p.color ?? '#2dd4bf') + '33',
                    }}
                  >
                    {p.name[0]}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-[11px] text-[#5a688c]">{p.role}</div>
                  </div>
                </div>
              ) : null
            })}
          </div>

          {/* Notion meeting summaries linked to this calendar meeting */}
          {Array.isArray((meeting as { meetingNotes?: Array<{ id: string; title: string; date: string | null; snippet: string | null; bodyText?: string | null; notionUrl: string | null }> }).meetingNotes) &&
            ((meeting as { meetingNotes: Array<{ id: string; title: string; date: string | null; snippet: string | null; bodyText?: string | null; notionUrl: string | null }> }).meetingNotes.length > 0) && (
            <div className="card mt-4">
              <div className="text-xs font-semibold text-[#5a688c] mb-3 uppercase tracking-wider">
                סיכומי Notion
              </div>
              <div className="space-y-2">
                {(meeting as { meetingNotes: Array<{ id: string; title: string; date: string | null; snippet: string | null; bodyText?: string | null; notionUrl: string | null }> }).meetingNotes.map((n) => {
                  const excerpt = (n.bodyText?.trim() || n.snippet?.trim() || '')
                  return (
                  <div key={n.id} className="py-1.5 border-b border-[#223052] last:border-0">
                    {n.notionUrl ? (
                      <a href={n.notionUrl} target="_blank" rel="noreferrer" className="text-sm font-medium hover:text-white">
                        {n.title}
                      </a>
                    ) : (
                      <div className="text-sm font-medium">{n.title}</div>
                    )}
                    {excerpt && (
                      <p className="text-xs text-[#647399] mt-0.5 line-clamp-8 whitespace-pre-wrap">{excerpt}</p>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Notes card — inline editing */}
          <div className="card mt-4">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-xs font-semibold text-[#5a688c] uppercase tracking-wider">הערות</div>
              {!editingNotes && meeting.notes && (
                <button
                  className="text-[11px] text-[#4d659c] hover:text-[#7a89ab] transition-colors"
                  onClick={startEditNotes}
                >
                  ✏ ערוך
                </button>
              )}
            </div>

            {editingNotes ? (
              <div>
                <textarea
                  className="input resize-y w-full text-sm"
                  rows={5}
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <div className="flex gap-2 mt-2 justify-end">
                  <button
                    className="btn btn-ghost text-xs py-1 px-3"
                    onClick={() => setEditingNotes(false)}
                  >
                    ביטול
                  </button>
                  <button
                    className="btn btn-primary text-xs py-1 px-3"
                    onClick={saveNotes}
                    disabled={updateMeeting.isPending}
                  >
                    שמור
                  </button>
                </div>
              </div>
            ) : meeting.notes ? (
              <div
                className="text-sm text-[#97a4c2] leading-relaxed cursor-pointer hover:text-[#b8c4dc] transition-colors whitespace-pre-wrap"
                onClick={startEditNotes}
                title="לחץ לעריכה"
              >
                {meeting.notes}
              </div>
            ) : (
              /* Signifier: empty notes actively invite action */
              <button
                className="text-sm text-[#435a8c] hover:text-[#647399] transition-colors w-full text-right"
                onClick={startEditNotes}
              >
                + הוסף הערות ›
              </button>
            )}
          </div>
        </div>

        {/* Right: Tasks */}
        <div>
          <div className="card">
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs font-semibold text-[#5a688c] uppercase tracking-wider">
                פעולות שהוחלטו ({tasks.length})
              </div>
              <button
                className="text-[11px] text-[#4d659c] hover:text-[#7a89ab] transition-colors"
                onClick={() => {
                  setEditingTaskId(null)
                  setTaskModalOpen(true)
                }}
              >
                + משימה מלאה
              </button>
            </div>

            {/* Empty state — signifier: invite task creation */}
            {tasks.length === 0 && (
              <button
                className="w-full text-sm text-[#435a8c] hover:text-[#647399] transition-colors text-right py-2.5 mb-3 border border-dashed rounded-lg px-3"
                style={{ borderColor: '#29395d' }}
onClick={() => {
                  setEditingTaskId(null)
                  setTaskModalOpen(true)
                }}
            >
              + הוסף פעולות שהוחלטו ›
            </button>
            )}

            {/* Task list */}
            {tasks.map((t) => (
              <div key={t.id} className="task-row">
                <div
                  className={`checkbox ${t.done ? 'checked' : ''}`}
                  onClick={() => toggleTask.mutate({ id: t.id })}
                >
                  {t.done && <span className="text-white text-[10px]">✓</span>}
                </div>
                <div
                  className="flex-1 text-sm cursor-pointer hover:text-[#fff] transition-colors min-w-0"
                  style={{
                    textDecoration: t.done ? 'line-through' : 'none',
                    color: t.done ? '#5a688c' : '#eef3fb',
                  }}
                  onClick={() => {
                    setEditingTaskId(t.id)
                    setTaskModalOpen(true)
                  }}
                  title="ערוך משימה"
                >
                  {t.title}
                  {(t as { dueDate?: string }).dueDate && (
                    <span className="text-[11px] text-[#647399] mr-2">
                      · {new Date((t as { dueDate: string }).dueDate).toLocaleDateString('he-IL')}
                    </span>
                  )}
                </div>
                <WorkspacePill workspace={getWorkspace((t as { workspaceId?: string | null }).workspaceId)} />
                <div
                  className="dot"
                  style={{ color: PRIORITY_COLORS[t.priority as keyof typeof PRIORITY_COLORS] }}
                />
                {t.assigneeId && (
                  <div
                    className="avatar w-[22px] h-[22px] text-[9px] border"
                    style={{
                      background: (getPerson(t.assigneeId)?.color ?? '#2dd4bf') + '22',
                      color: getPerson(t.assigneeId)?.color ?? '#2dd4bf',
                      borderColor: (getPerson(t.assigneeId)?.color ?? '#2dd4bf') + '33',
                    }}
                  >
                    {getPerson(t.assigneeId)?.name[0]}
                  </div>
                )}
              </div>
            ))}

            {/* Quick task add — batch affordance, always visible */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-[#1d2b46]">
              <input
                className="input flex-1 text-sm py-1.5"
                placeholder="+ הוסף פעולה מהירה…"
                value={quickTask}
                onChange={(e) => setQuickTask(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addQuickTask() }}
              />
              {quickTask.trim() && (
                <button
                  className="btn btn-primary text-xs py-1 px-3"
                  onClick={addQuickTask}
                  disabled={createTask.isPending}
                >
                  הוסף
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Series card — shared notes + sibling instances ─────────────────── */}
      {series && (
        <div className="card mt-5">
          <div className="flex justify-between items-center mb-3">
            <div className="text-xs font-semibold text-[#5a688c] uppercase tracking-wider flex items-center gap-2">
              סדרה
              <span className="pill">↻ {series.cadence === 'weekly' ? 'שבועי' : 'סדרה'}</span>
              <span className="text-[#647399] normal-case">{series.instances.length} מפגשים</span>
            </div>
            {!editingSeriesNotes && (
              <button
                className="text-[11px] text-[#4d659c] hover:text-[#7a89ab] transition-colors"
                onClick={() => { setSeriesNotesValue(series.rollingNotes ?? ''); setEditingSeriesNotes(true) }}
              >
                ✏ הערות סדרה
              </button>
            )}
          </div>

          {editingSeriesNotes ? (
            <div className="mb-4">
              <textarea
                className="input resize-y w-full text-sm"
                rows={4}
                value={seriesNotesValue}
                onChange={(e) => setSeriesNotesValue(e.target.value)}
                placeholder="הערות מתגלגלות שנשמרות לכל המפגשים בסדרה…"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              <div className="flex gap-2 mt-2 justify-end">
                <button className="btn btn-ghost text-xs py-1 px-3" onClick={() => setEditingSeriesNotes(false)}>ביטול</button>
                <button
                  className="btn btn-primary text-xs py-1 px-3"
                  onClick={() => updateSeriesNotes.mutate({ id: series.id, rollingNotes: seriesNotesValue })}
                  disabled={updateSeriesNotes.isPending}
                >
                  שמור
                </button>
              </div>
            </div>
          ) : series.rollingNotes ? (
            <div className="text-sm text-[#97a4c2] leading-relaxed whitespace-pre-wrap mb-4">{series.rollingNotes}</div>
          ) : (
            <button
              className="text-sm text-[#435a8c] hover:text-[#647399] transition-colors w-full text-right mb-4"
              onClick={() => { setSeriesNotesValue(''); setEditingSeriesNotes(true) }}
            >
              + הוסף הערות סדרה ›
            </button>
          )}

          <div className="space-y-1.5">
            {series.instances.map((inst) => (
              <Link
                key={inst.id}
                href={`/meetings/${inst.id}`}
                className={`flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-[#141f36] transition-colors ${inst.id === id ? 'bg-[#141f36]' : ''}`}
              >
                <span className="text-[11px] text-[#5a688c] tabular-nums w-[74px] shrink-0">
                  {new Date(inst.date + 'T00:00:00').toLocaleDateString('he-IL')}
                </span>
                <span className="text-xs text-[#97a4c2] truncate">{inst.title}</span>
                {inst.id === id && <span className="text-[10px] text-[#2dd4bf] mr-auto shrink-0">נוכחי</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <MeetingModal
        open={meetingModalOpen}
        onClose={() => setMeetingModalOpen(false)}
        editingId={id}
        people={people}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
      <MeetingModal
        open={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        editingId={null}
        initialValues={followUpInitialValues}
        people={people}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
      <TaskModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false)
          setEditingTaskId(null)
        }}
        editingTaskId={editingTaskId}
        meetingId={id}
        projectId={mx?.projectId ?? null}
        people={people}
        meetings={meetingsList.map((m) => ({ id: m.id, title: m.title }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        workspaces={workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          hasNotionLink: ((w as { notionDatabases?: unknown[] }).notionDatabases?.length ?? 0) > 0,
        }))}
        onPeopleSync={(sync) => setPeopleSyncMessage(notionPeopleSyncMessage(sync))}
      />
      <SyncToast message={peopleSyncMessage} onDismiss={() => setPeopleSyncMessage(null)} />
    </div>
  )
}
