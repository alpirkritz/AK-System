'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, DAYS_HE } from '@ak-system/types'
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

  type MeetingExtended = typeof meeting & {
    projectId?: string | null
    location?: string | null
    endTime?: string | null
    calendarSource?: string | null
    calendarEventId?: string | null
    peopleIds?: string[]
  }
  const mx = meeting as MeetingExtended
  const project = mx?.projectId ? projects.find((p) => p.id === mx.projectId) : null

  const SOURCE_LABEL: Record<string, string> = { google: 'Google', apple: 'Apple' }
  const SOURCE_COLOR: Record<string, string> = { google: '#4285f4', apple: '#888' }

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

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.meetings.list.invalidate()
    },
  })

  const [meetingModalOpen, setMeetingModalOpen] = useState(false)
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
  const tasks = tasksList.filter((t) => t.meetingId === id)

  if (isLoading || !meeting) {
    return <div className="text-[#888]">טוען...</div>
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
              style={{ minWidth: 180, background: '#141414', border: '1px solid #222' }}
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
        {mx.calendarSource && (
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{
              background: (SOURCE_COLOR[mx.calendarSource] ?? '#888') + '22',
              color: SOURCE_COLOR[mx.calendarSource] ?? '#888',
              border: `1px solid ${(SOURCE_COLOR[mx.calendarSource] ?? '#888')}33`,
            }}
          >
            {SOURCE_LABEL[mx.calendarSource] ?? mx.calendarSource}
          </span>
        )}
      </div>

      {/* ── Metadata row ───────────────────────────────────────────────────── */}
      <div className="text-[#666] text-sm mb-7 flex items-center gap-3 flex-wrap">
        📅 {new Date(meeting.date + 'T00:00:00').toLocaleDateString('he-IL')} · {meeting.time}
        {mx.endTime && (
          <span className="text-[#555]">
            · {formatDuration(`${meeting.date}T${meeting.time}`, mx.endTime)}
          </span>
        )}
        {mx.location && (
          <span className="flex items-center gap-1 text-[#555]">📍 {mx.location}</span>
        )}

        {/* Project pill — or actionable CTA when missing */}
        {project ? (
          <Link href={`/projects/${project.id}`} className="pill text-[11px]">
            📁 {project.name}
          </Link>
        ) : (
          <button
            className="text-[11px] text-[#3a3a3a] hover:text-[#777] transition-colors border border-dashed rounded-full px-2.5 py-0.5"
            style={{ borderColor: '#2e2e2e' }}
            onClick={() => setMeetingModalOpen(true)}
            title="שייך לפרויקט"
          >
            + שייך לפרויקט
          </button>
        )}
      </div>

      {/* ── Two-column body ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-5">

        {/* Left: Attendees + Notes */}
        <div>
          <div className="card">
            <div className="text-xs font-semibold text-[#555] mb-3 uppercase tracking-wider">משתתפים</div>
            {peopleIds.map((pid) => {
              const p = getPerson(pid)
              return p ? (
                <div key={pid} className="flex gap-2.5 items-center mb-2.5">
                  <div
                    className="avatar w-[34px] h-[34px] text-[13px] border-[1.5px]"
                    style={{
                      background: (p.color ?? '#e8c547') + '22',
                      color: p.color ?? '#e8c547',
                      borderColor: (p.color ?? '#e8c547') + '33',
                    }}
                  >
                    {p.name[0]}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-[11px] text-[#555]">{p.role}</div>
                  </div>
                </div>
              ) : null
            })}
          </div>

          {/* Notes card — inline editing */}
          <div className="card mt-4">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-xs font-semibold text-[#555] uppercase tracking-wider">הערות</div>
              {!editingNotes && meeting.notes && (
                <button
                  className="text-[11px] text-[#444] hover:text-[#888] transition-colors"
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
                className="text-sm text-[#aaa] leading-relaxed cursor-pointer hover:text-[#ccc] transition-colors whitespace-pre-wrap"
                onClick={startEditNotes}
                title="לחץ לעריכה"
              >
                {meeting.notes}
              </div>
            ) : (
              /* Signifier: empty notes actively invite action */
              <button
                className="text-sm text-[#3a3a3a] hover:text-[#666] transition-colors w-full text-right"
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
              <div className="text-xs font-semibold text-[#555] uppercase tracking-wider">
                פעולות שהוחלטו ({tasks.length})
              </div>
              <button
                className="text-[11px] text-[#444] hover:text-[#888] transition-colors"
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
                className="w-full text-sm text-[#3a3a3a] hover:text-[#666] transition-colors text-right py-2.5 mb-3 border border-dashed rounded-lg px-3"
                style={{ borderColor: '#222' }}
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
                    color: t.done ? '#555' : '#f0ede6',
                  }}
                  onClick={() => {
                    setEditingTaskId(t.id)
                    setTaskModalOpen(true)
                  }}
                  title="ערוך משימה"
                >
                  {t.title}
                  {(t as { dueDate?: string }).dueDate && (
                    <span className="text-[11px] text-[#666] mr-2">
                      · {new Date((t as { dueDate: string }).dueDate).toLocaleDateString('he-IL')}
                    </span>
                  )}
                </div>
                <div
                  className="dot"
                  style={{ color: PRIORITY_COLORS[t.priority as keyof typeof PRIORITY_COLORS] }}
                />
                {t.assigneeId && (
                  <div
                    className="avatar w-[22px] h-[22px] text-[9px] border"
                    style={{
                      background: (getPerson(t.assigneeId)?.color ?? '#e8c547') + '22',
                      color: getPerson(t.assigneeId)?.color ?? '#e8c547',
                      borderColor: (getPerson(t.assigneeId)?.color ?? '#e8c547') + '33',
                    }}
                  >
                    {getPerson(t.assigneeId)?.name[0]}
                  </div>
                )}
              </div>
            ))}

            {/* Quick task add — batch affordance, always visible */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-[#1a1a1a]">
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
      />
    </div>
  )
}
