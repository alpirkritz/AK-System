'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@ak-system/types'
import dynamic from 'next/dynamic'
const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })

type StatusFilter = 'open' | 'done' | 'all'

export default function TasksPage() {
  const { data: tasksList = [], isLoading } = trpc.tasks.list.useQuery()
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: notionState } = trpc.tasks.notionConfigured.useQuery()
  const utils = trpc.useUtils()
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  })
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const syncFromNotion = trpc.tasks.syncFromNotion.useMutation({
    onSuccess: (res) => {
      const imported = res.tasksCreated + res.tasksUpdated
      setSyncMessage(
        res.errors.length > 0
          ? `יובאו ${imported} משימות · ${res.errors.length} שגיאות`
          : `יובאו ${imported} משימות מ-Notion`,
      )
      utils.tasks.list.invalidate()
      utils.people.list.invalidate()
    },
    onError: (err) => setSyncMessage(err.message || 'הסנכרון נכשל'),
  })
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

  const [status, setStatus] = useState<StatusFilter>('open')
  const [projectId, setProjectId] = useState<string>('')
  const [meetingId, setMeetingId] = useState<string>('')
  const [search, setSearch] = useState('')

  const getPerson = (id: string) => people.find((p) => p.id === id)
  const getMeeting = (id: string) => meetings.find((m) => m.id === id)
  const getProject = (id: string) => projects.find((p) => p.id === id)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasksList.filter((t) => {
      if (status === 'open' && t.done) return false
      if (status === 'done' && !t.done) return false
      if (projectId && (t as { projectId?: string }).projectId !== projectId) return false
      if (meetingId && t.meetingId !== meetingId) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasksList, status, projectId, meetingId, search])

  const hasActiveFilter = status !== 'open' || !!projectId || !!meetingId || !!search

  const statusTabs: { id: StatusFilter; label: string }[] = [
    { id: 'open', label: 'פתוחות' },
    { id: 'done', label: 'הושלמו' },
    { id: 'all', label: 'הכל' },
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-2xl font-bold tracking-tight">משימות</h1>
        <div className="flex items-center gap-2">
          {notionState?.configured && (
            <button
              className="btn btn-secondary"
              disabled={syncFromNotion.isPending}
              onClick={() => {
                setSyncMessage(null)
                syncFromNotion.mutate({ windowDays: 60, dryRun: false })
              }}
              title="סנכרן משימות ואנשים מ-Notion (60 הימים האחרונים)"
            >
              {syncFromNotion.isPending ? 'מסנכרן…' : 'סנכרן מ-Notion'}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingTaskId(null)
              setTaskModalOpen(true)
            }}
          >
            + משימה חדשה
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="mb-4 text-sm text-[#9fb0d4] bg-[#141b2e] border border-[#26324d] rounded-lg px-3 py-2">
          {syncMessage}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="flex gap-1.5">
          {statusTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="filter-chip"
              aria-pressed={status === tab.id}
              onClick={() => setStatus(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          className="input w-auto flex-1 min-w-[160px] max-w-[280px]"
          placeholder="חיפוש משימה…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select w-auto min-w-[130px]" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">כל הפרויקטים</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className="select w-auto min-w-[130px]" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
          <option value="">כל הפגישות</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>{m.title}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="card">
          <div className="skeleton h-5 w-1/3 mb-3" />
          <div className="skeleton h-5 w-2/3 mb-3" />
          <div className="skeleton h-5 w-1/2" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3">✓</div>
          <div className="text-[#eef3fb] font-medium mb-1">
            {hasActiveFilter ? 'אין משימות שתואמות לסינון' : 'אין משימות פתוחות'}
          </div>
          <div className="text-sm text-[#647399] mb-4">
            {hasActiveFilter ? 'נסה לשנות את המסננים' : 'הכול נקי. אפשר להוסיף משימה חדשה.'}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingTaskId(null)
              setTaskModalOpen(true)
            }}
          >
            + משימה חדשה
          </button>
        </div>
      ) : (
        (['high', 'medium', 'low'] as const).map((prio) => {
          const tasks = filtered.filter((t) => t.priority === prio)
          if (!tasks.length) return null
          return (
            <div key={prio} className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLORS[prio] }} />
                <span className="text-xs font-semibold text-[#7a89ab] uppercase tracking-wider">
                  עדיפות {PRIORITY_LABELS[prio]}
                </span>
                <span className="text-xs text-[#4d659c]">({tasks.length})</span>
              </div>
              <div className="card py-1 px-4">
                {tasks.map((t) => {
                  const meeting = getMeeting(t.meetingId ?? '')
                  return (
                    <div key={t.id} className="task-row">
                      <button
                        type="button"
                        className="checkbox-btn"
                        role="checkbox"
                        aria-checked={t.done}
                        aria-label={t.done ? 'סמן כלא בוצע' : 'סמן כבוצע'}
                        onClick={() => toggleTask.mutate({ id: t.id })}
                      >
                        {t.done && <span className="text-[10px]">✓</span>}
                      </button>
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
                        {t.dueDate && (
                          <span className="text-[11px] text-[#647399] mr-2"> · {new Date(t.dueDate).toLocaleDateString('he-IL')}</span>
                        )}
                      </div>
                      {t.projectId && getProject(t.projectId) && (
                        <Link href={`/projects/${t.projectId}`}>
                          <span className="pill cursor-pointer text-[11px]">📁 {getProject(t.projectId)?.name}</span>
                        </Link>
                      )}
                      {meeting && (
                        <Link href={`/meetings/${meeting.id}`}>
                          <span className="pill cursor-pointer">◈ {meeting.title}</span>
                        </Link>
                      )}
                      {t.assigneeId && (
                        <div
                          className="avatar w-6 h-6 text-[10px] border"
                          style={{
                            background: (getPerson(t.assigneeId!)?.color ?? '#2dd4bf') + '22',
                            color: getPerson(t.assigneeId!)?.color ?? '#2dd4bf',
                            borderColor: (getPerson(t.assigneeId!)?.color ?? '#2dd4bf') + '33',
                          }}
                        >
                          {getPerson(t.assigneeId!)?.name[0]}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}

      <TaskModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false)
          setEditingTaskId(null)
        }}
        editingTaskId={editingTaskId}
        people={people}
        meetings={meetings.map((m) => ({ id: m.id, title: m.title }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  )
}
