'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@ak-system/types'
import { TaskModal } from '@/components/Modals/TaskModal'

export default function TasksPage() {
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const utils = trpc.useUtils()
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  })
  const [taskModalOpen, setTaskModalOpen] = useState(false)

  const getPerson = (id: string) => people.find((p) => p.id === id)
  const getMeeting = (id: string) => meetings.find((m) => m.id === id)
  const getProject = (id: string) => projects.find((p) => p.id === id)

  return (
    <div>
      <div className="flex justify-between items-center mb-7">
        <h1 className="text-2xl font-bold tracking-tight">משימות</h1>
        <button className="btn btn-primary" onClick={() => setTaskModalOpen(true)}>
          + משימה חדשה
        </button>
      </div>
      {(['high', 'medium', 'low'] as const).map((prio) => {
        const tasks = tasksList.filter((t) => t.priority === prio)
        if (!tasks.length) return null
        return (
          <div key={prio} className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: PRIORITY_COLORS[prio] }}
              />
              <span className="text-xs font-semibold text-[#888] uppercase tracking-wider">
                עדיפות {PRIORITY_LABELS[prio]}
              </span>
              <span className="text-xs text-[#444]">({tasks.length})</span>
            </div>
            <div className="card py-1 px-4">
              {tasks.map((t) => {
                const meeting = getMeeting(t.meetingId ?? '')
                return (
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
                          background: (getPerson(t.assigneeId!)?.color ?? '#e8c547') + '22',
                          color: getPerson(t.assigneeId!)?.color ?? '#e8c547',
                          borderColor: (getPerson(t.assigneeId!)?.color ?? '#e8c547') + '33',
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
      })}
      <TaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        people={people}
        meetings={meetings.map((m) => ({ id: m.id, title: m.title }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  )
}
