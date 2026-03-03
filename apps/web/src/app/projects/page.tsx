'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { ProjectModal } from '@/components/Modals/ProjectModal'

export default function ProjectsPage() {
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const meetingsWithProject = meetings as Array<{ id: string; projectId?: string }>
  const tasksWithProject = tasksList as Array<{ projectId?: string }>

  return (
    <div>
      <div className="flex justify-between items-center mb-7">
        <h1 className="text-2xl font-bold tracking-tight">פרויקטים</h1>
        <button className="btn btn-primary" onClick={() => { setEditingId(null); setModalOpen(true); }}>
          + פרויקט חדש
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => {
          const projectMeetings = meetingsWithProject.filter((m) => m.projectId === p.id)
          const projectTasks = tasksWithProject.filter((t) => t.projectId === p.id)
          return (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div
                className="card cursor-pointer flex flex-col"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) e.preventDefault()
                }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                    style={{ background: (p.color ?? '#47b8e8') + '22', color: p.color ?? '#47b8e8' }}
                  >
                    📁
                  </div>
                  <div className="font-semibold text-[15px]">{p.name}</div>
                </div>
                <div className="text-xs text-[#666] mt-auto pt-2 border-t border-[#1f1f1f]">
                  ◈ {projectMeetings.length} פגישות · ◻ {projectTasks.length} משימות
                </div>
              </div>
            </Link>
          )
        })}
      </div>
      <ProjectModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingId(null); }}
        editingId={editingId}
      />
    </div>
  )
}
