'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { WorldBadge, UnassignedHeading } from '@/components/WorldBadge'
import { FilteredWorldChip } from '@/components/WorldSwitcher'
import { splitByWorld, useWorldFilter } from '@/lib/world-filter'
import dynamic from 'next/dynamic'
const ProjectModal = dynamic(() => import('@/components/Modals/ProjectModal').then((m) => m.ProjectModal), { ssr: false })

export default function ProjectsPage() {
  const { workspaceId: worldFilter, ready: worldReady } = useWorldFilter()
  const { data: projects = [] } = trpc.projects.list.useQuery(
    worldFilter ? { workspaceId: worldFilter } : undefined,
    { enabled: worldReady },
  )
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
  const { matched: matchedProjects, unassigned: unassignedProjects } = splitByWorld(projects, !!worldFilter, (p) => p.workspaceId)

  const renderCard = (p: (typeof projects)[number]) => {
    const projectMeetings = meetingsWithProject.filter((m) => m.projectId === p.id)
    const projectTasks = tasksWithProject.filter((t) => t.projectId === p.id)
    return (
      <Link key={p.id} href={`/projects/${p.id}`} className="no-underline min-w-0">
        <div className="card card-interactive h-full flex flex-col gap-2 !p-3 sm:!p-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-base sm:text-lg shrink-0"
              style={{ background: (p.color ?? '#38bdf8') + '22', color: p.color ?? '#38bdf8' }}
            >
              📁
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm sm:text-[15px] text-[#eef3fb] truncate">{p.name}</div>
              <WorldBadge workspaceId={p.workspaceId} />
            </div>
          </div>
          <div className="text-[11px] sm:text-xs text-[#647399] mt-auto pt-2 border-t border-[#223052] flex items-center gap-3 tabular-nums">
            <span className={projectMeetings.length ? 'text-[#97a4c2]' : ''}>◈ {projectMeetings.length} פגישות</span>
            <span className={projectTasks.length ? 'text-[#97a4c2]' : ''}>◻ {projectTasks.length} משימות</span>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
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
      <FilteredWorldChip />
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        {matchedProjects.map(renderCard)}
      </div>
      {worldFilter && unassignedProjects.length > 0 && (
        <>
          <UnassignedHeading count={unassignedProjects.length} />
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
            {unassignedProjects.map(renderCard)}
          </div>
        </>
      )}
      <ProjectModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingId(null); }}
        editingId={editingId}
      />
    </div>
  )
}
