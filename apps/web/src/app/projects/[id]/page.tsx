'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, DAYS_HE } from '@ak-system/types'
import dynamic from 'next/dynamic'
const ProjectModal = dynamic(() => import('@/components/Modals/ProjectModal').then((m) => m.ProjectModal), { ssr: false })
const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })

export default function ProjectDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { data: project, isLoading } = trpc.projects.getById.useQuery({ id }, { enabled: !!id })
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetingsList = [] } = trpc.meetings.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const utils = trpc.useUtils()
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  })
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)

  const getPerson = (pid: string) => people.find((p) => p.id === pid)
  const meetings = (meetingsList as Array<{ id: string; title: string; date: string; time: string; projectId?: string; recurring?: string; recurrenceDay?: string; peopleIds?: string[] }>).filter((m) => m.projectId === id)
  const tasks = (tasksList as Array<{ id: string; title: string; done: boolean; priority: string; assigneeId?: string; meetingId?: string; dueDate?: string }>).filter((t) => (t as { projectId?: string }).projectId === id)

  if (isLoading || !project) {
    return <div className="text-[#888]">טוען...</div>
  }

  return (
    <div>
      <div className="flex gap-3 items-center mb-7">
        <Link href="/projects" className="btn btn-ghost">
          ← חזרה
        </Link>
        <button className="btn btn-ghost" onClick={() => setProjectModalOpen(true)}>
          ✏ ערוך
        </button>
        <button className="btn btn-primary" onClick={() => setTaskModalOpen(true)}>
          + משימה
        </button>
      </div>
      <div className="flex items-center gap-3 mb-7">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
          style={{ background: (project.color ?? '#47b8e8') + '22', color: project.color ?? '#47b8e8' }}
        >
          📁
        </div>
        <h1 className="text-[26px] font-bold tracking-tight">{project.name}</h1>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold text-[#555] mb-3 uppercase tracking-wider">
            פגישות ({meetings.length})
          </div>
          <div className="card space-y-2">
            {meetings.length === 0 && (
              <div className="text-[#555] text-sm">אין פגישות בפרויקט</div>
            )}
            {meetings.map((m) => (
              <Link key={m.id} href={`/meetings/${m.id}`}>
                <div className="meeting-card py-2 px-3">
                  <div className="font-medium text-sm">{m.title}</div>
                  <div className="text-xs text-[#666]">
                    {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.time}
                    {m.recurring && ` · ↻ ${DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבועי'}`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-[#555] mb-3 uppercase tracking-wider">
            משימות ({tasks.length})
          </div>
          <div className="card">
            {tasks.length === 0 && (
              <div className="text-[#555] text-sm">אין משימות בפרויקט</div>
            )}
            {tasks.map((t) => (
              <div key={t.id} className="task-row">
                <div
                  className={`checkbox ${t.done ? 'checked' : ''}`}
                  onClick={() => toggleTask.mutate({ id: t.id })}
                >
                  {t.done && <span className="text-white text-[10px]">✓</span>}
                </div>
                <div
                  className="flex-1 text-sm"
                  style={{
                    textDecoration: t.done ? 'line-through' : 'none',
                    color: t.done ? '#555' : '#f0ede6',
                  }}
                >
                  {t.title}
                  {t.dueDate && (
                    <span className="text-[11px] text-[#666] mr-2"> · {new Date(t.dueDate).toLocaleDateString('he-IL')}</span>
                  )}
                </div>
                <div className="dot" style={{ color: PRIORITY_COLORS[t.priority as keyof typeof PRIORITY_COLORS] }} />
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
          </div>
        </div>
      </div>
      <ProjectModal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        editingId={id}
      />
      <TaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        projectId={id}
        people={people}
        meetings={meetingsList.map((m) => ({ id: m.id, title: m.title }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  )
}
