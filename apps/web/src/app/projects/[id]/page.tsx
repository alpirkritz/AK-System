'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, DAYS_HE } from '@ak-system/types'
import { WorkspacePill } from '@/components/WorkspacePill'
import { SyncToast } from '@/components/SyncToast'
import { SearchableAddSelect } from '@/components/ui/SearchableAddSelect'
import { sortTasksOpenThenDueAsc } from '@/lib/sort-tasks'
import { notionPeopleSyncMessage } from '@/lib/notion-people-sync-message'
import dynamic from 'next/dynamic'
const ProjectModal = dynamic(() => import('@/components/Modals/ProjectModal').then((m) => m.ProjectModal), { ssr: false })
const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })

export default function ProjectDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { data: project, isLoading } = trpc.projects.getById.useQuery({ id }, { enabled: !!id })
  const { data: related } = trpc.projects.getRelated.useQuery({ id }, { enabled: !!id })
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  const utils = trpc.useUtils()
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.projects.getRelated.invalidate({ id })
    },
  })
  const onPeopleMutated = (res: { notionSync?: Parameters<typeof notionPeopleSyncMessage>[0] }) => {
    utils.projects.getRelated.invalidate({ id })
    utils.people.getRelated.invalidate()
    const msg = notionPeopleSyncMessage(res.notionSync)
    if (msg) setPeopleSyncMessage(msg)
  }
  const addPerson = trpc.projects.addPerson.useMutation({ onSuccess: onPeopleMutated })
  const removePerson = trpc.projects.removePerson.useMutation({ onSuccess: onPeopleMutated })
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [peopleSyncMessage, setPeopleSyncMessage] = useState<string | null>(null)

  const getPerson = (pid: string) => people.find((p) => p.id === pid)
  const getWorkspace = (wid?: string | null) => (wid ? workspaces.find((w) => w.id === wid) : undefined)
  const meetings = related?.meetings ?? []
  const tasks = useMemo(
    () => sortTasksOpenThenDueAsc(related?.tasks ?? []),
    [related?.tasks],
  )
  const roster = related?.people ?? []
  const meetingNotes = related?.meetingNotes ?? []

  if (isLoading) {
    return <div className="text-[#7a89ab]">טוען...</div>
  }
  if (!project) {
    return (
      <div>
        <Link href="/projects" className="btn btn-ghost mb-4 inline-block">
          ← חזרה
        </Link>
        <div className="text-[#7a89ab]">הפרויקט לא נמצא</div>
      </div>
    )
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
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditingTaskId(null)
            setTaskModalOpen(true)
          }}
        >
          + משימה
        </button>
      </div>
      <div className="flex items-center gap-3 mb-7">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
          style={{ background: (project.color ?? '#38bdf8') + '22', color: project.color ?? '#38bdf8' }}
        >
          📁
        </div>
        <h1 className="text-[26px] font-bold tracking-tight">{project.name}</h1>
      </div>
      {peopleSyncMessage && (
        <SyncToast message={peopleSyncMessage} onDismiss={() => setPeopleSyncMessage(null)} />
      )}

      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <div className="text-xs font-semibold text-[#5a688c] uppercase tracking-wider">
            אנשים ({roster.length})
          </div>
          <SearchableAddSelect
            id="project-add-person"
            triggerLabel="+ הוסף אדם"
            placeholder="חיפוש לפי שם..."
            emptyLabel="לא נמצא איש קשר"
            disabled={addPerson.isPending}
            options={people
              .filter((p) => !roster.some((r) => r.id === p.id))
              .map((p) => ({
                id: p.id,
                name: p.name,
                subtitle: p.company ?? p.role,
                color: p.color,
              }))}
            onAdd={(personId) => addPerson.mutate({ projectId: id, personId })}
          />
        </div>
        <div className="card flex flex-wrap gap-2">
          {roster.length === 0 && (
            <div className="text-[#5a688c] text-sm">אין אנשים משויכים — בחר מהרשימה למעלה או בעריכת הפרויקט</div>
          )}
          {roster.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pill text-[11px] flex items-center gap-1.5"
              title="הסר מהפרויקט"
              disabled={removePerson.isPending}
              onClick={() => removePerson.mutate({ projectId: id, personId: p.id })}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: p.color ?? '#2dd4bf' }}
              />
              {p.name}
              <span className="text-[#5a688c]">×</span>
            </button>
          ))}
        </div>
      </div>

      {meetingNotes.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold text-[#5a688c] mb-3 uppercase tracking-wider">
            סיכומי ישיבות ({meetingNotes.length})
          </div>
          <div className="card space-y-2">
            {meetingNotes.map((n) => {
              const excerpt =
                ('bodyText' in n && typeof n.bodyText === 'string' && n.bodyText.trim())
                  ? n.bodyText.trim()
                  : n.snippet?.trim() || ''
              return (
              <div key={n.id} className="py-2 border-b border-[#223052] last:border-0">
                {n.meetingId ? (
                  <Link href={`/meetings/${n.meetingId}`} className="text-sm font-medium hover:text-white">
                    {n.title}
                  </Link>
                ) : n.notionUrl ? (
                  <a href={n.notionUrl} target="_blank" rel="noreferrer" className="text-sm font-medium hover:text-white">
                    {n.title}
                  </a>
                ) : (
                  <div className="text-sm font-medium">{n.title}</div>
                )}
                <div className="text-xs text-[#647399]">
                  {n.date ? new Date(n.date + 'T00:00:00').toLocaleDateString('he-IL') : ''}
                  {'sourceKind' in n && String(n.sourceKind ?? '').startsWith('meeting_page') ? ' · מדף הפגישה ב-Notion' : ''}
                </div>
                {excerpt && (
                  <p className="text-xs text-[#647399] mt-1 line-clamp-8 whitespace-pre-wrap">{excerpt}</p>
                )}
              </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold text-[#5a688c] mb-3 uppercase tracking-wider">
            פגישות ({meetings.length})
          </div>
          <div className="card space-y-2">
            {meetings.length === 0 && (
              <div className="text-[#5a688c] text-sm">אין פגישות בפרויקט</div>
            )}
            {meetings.map((m) => (
              <Link key={m.id} href={`/meetings/${m.id}`}>
                <div className="meeting-card py-2 px-3">
                  <div className="font-medium text-sm">{m.title}</div>
                  <div className="text-xs text-[#647399]">
                    {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.time}
                    {m.recurring && ` · ↻ ${DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבועי'}`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-[#5a688c] mb-3 uppercase tracking-wider">
            משימות ({tasks.length})
          </div>
          <div className="card">
            {tasks.length === 0 && (
              <div className="text-[#5a688c] text-sm">אין משימות בפרויקט</div>
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
                <WorkspacePill workspace={getWorkspace(t.workspaceId)} />
                <div className="dot" style={{ color: PRIORITY_COLORS[t.priority as keyof typeof PRIORITY_COLORS] }} />
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
        onClose={() => {
          setTaskModalOpen(false)
          setEditingTaskId(null)
        }}
        editingTaskId={editingTaskId}
        projectId={id}
        people={people}
        meetings={meetings.map((m) => ({ id: m.id, title: m.title }))}
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
