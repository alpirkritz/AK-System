'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import dynamic from 'next/dynamic'
const ProjectModal = dynamic(() => import('@/components/Modals/ProjectModal').then((m) => m.ProjectModal), { ssr: false })

export default function ProjectsPage() {
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const { data: notionGraph } = trpc.notionGraph.configured.useQuery()
  const utils = trpc.useUtils()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const syncGraph = trpc.notionGraph.sync.useMutation({
    onSuccess: (res) => {
      const parts = [
        `${res.projectsUpserted} פרויקטים`,
        `${res.meetingsUpserted ?? 0} פגישות`,
        `${res.tasksLinked ?? 0} משימות מקושרות`,
        `${res.notesUpserted} סיכומים`,
      ]
      if (res.projectsUpserted === 0 && (notionGraph?.databases ?? []).every((d) => d.type !== 'projects')) {
        setSyncMessage('לא מוגדר מסד Projects ב-NOTION_ACCOUNTS (type: "projects") — הוסף אותו כדי לסנכרן')
      } else {
        setSyncMessage(
          res.errors.length > 0
            ? `סונכרנו ${parts.join(' · ')} · ${res.errors.length} שגיאות`
            : `סונכרנו ${parts.join(' · ')} מ-Notion`,
        )
      }
      utils.projects.list.invalidate()
      utils.people.list.invalidate()
      utils.notionGraph.configured.invalidate()
    },
    onError: (err) => setSyncMessage(err.message || 'הסנכרון נכשל'),
  })

  const meetingsWithProject = meetings as Array<{ id: string; projectId?: string }>
  const tasksWithProject = tasksList as Array<{ projectId?: string }>

  return (
    <div>
      <div className="flex justify-between items-center mb-7">
        <h1 className="text-2xl font-bold tracking-tight">פרויקטים</h1>
        <div className="flex gap-2">
          {notionGraph?.configured && (
            <button
              className="btn btn-secondary"
              disabled={syncGraph.isPending}
              onClick={() => {
                setSyncMessage(null)
                syncGraph.mutate({ windowDays: 90, dryRun: false })
              }}
              title="סנכרן פרויקטים, חברות וסיכומי ישיבות מ-Notion"
            >
              {syncGraph.isPending ? 'מסנכרן…' : 'סנכרן מ-Notion'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => { setEditingId(null); setModalOpen(true); }}>
            + פרויקט חדש
          </button>
        </div>
      </div>
      {syncMessage && (
        <div className="mb-4 text-sm text-[#97a4c2]">{syncMessage}</div>
      )}
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
                    style={{ background: (p.color ?? '#38bdf8') + '22', color: p.color ?? '#38bdf8' }}
                  >
                    📁
                  </div>
                  <div className="font-semibold text-[15px]">{p.name}</div>
                </div>
                <div className="text-xs text-[#647399] mt-auto pt-2 border-t border-[#223052]">
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
