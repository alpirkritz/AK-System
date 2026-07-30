'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { PRIORITY_LABELS, PRIORITY_COLORS, type TaskStatus } from '@ak-system/types'
import { StatusChips } from '@/components/StatusChips'
import type { Person } from '@ak-system/database'

type MeetingOption = { id: string; title: string }
type ProjectOption = { id: string; name: string }
type WorkspaceOption = { id: string; name: string }

export function TaskModal({
  open,
  onClose,
  editingTaskId,
  meetingId,
  projectId: projectIdProp,
  workspaceId: workspaceIdProp,
  people,
  meetings,
  projects,
  workspaces = [],
}: {
  open: boolean
  onClose: () => void
  editingTaskId?: string | null
  meetingId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  people: Person[]
  meetings: MeetingOption[]
  projects: ProjectOption[]
  workspaces?: WorkspaceOption[]
}) {
  const [form, setForm] = useState({
    title: '',
    meetingId: meetingId ?? '',
    projectId: projectIdProp ?? '',
    workspaceId: workspaceIdProp ?? '',
    assigneeId: '',
    dueDate: '',
    priority: 'medium' as 'high' | 'medium' | 'low',
    status: 'not_started' as TaskStatus,
    relatedPersonIds: [] as string[],
  })
  const [relatedPeopleFilter, setRelatedPeopleFilter] = useState('')
  const { data: meeting } = trpc.meetings.getById.useQuery({ id: meetingId! }, { enabled: !!meetingId && open })
  const { data: editingTask, isLoading: isLoadingTask } = trpc.tasks.getById.useQuery(
    { id: editingTaskId! },
    { enabled: !!editingTaskId && open }
  )
  const { data: taskPeopleIds } = trpc.tasks.getTaskPeople.useQuery(
    { id: editingTaskId! },
    { enabled: !!editingTaskId && open }
  )
  useEffect(() => {
    if (!open) return
    if (editingTaskId && editingTask) {
      setForm((f) => ({
        title: editingTask.title,
        meetingId: editingTask.meetingId ?? '',
        projectId: (editingTask as { projectId?: string | null }).projectId ?? '',
        workspaceId: (editingTask as { workspaceId?: string | null }).workspaceId ?? '',
        assigneeId: editingTask.assigneeId ?? '',
        dueDate: editingTask.dueDate ?? '',
        priority: (editingTask.priority as 'high' | 'medium' | 'low') || 'medium',
        status: ((editingTask as { status?: string }).status as TaskStatus) || 'not_started',
        relatedPersonIds: taskPeopleIds ?? f.relatedPersonIds,
      }))
    } else if (!editingTaskId) {
      setForm((f) => ({
        title: '',
        meetingId: meetingId ?? '',
        projectId: projectIdProp ?? (meeting as { projectId?: string } | null)?.projectId ?? f.projectId,
        workspaceId: workspaceIdProp ?? f.workspaceId,
        assigneeId: '',
        dueDate: '',
        priority: 'medium',
        status: 'not_started',
        relatedPersonIds: [],
      }))
      setRelatedPeopleFilter('')
    }
  }, [open, editingTaskId, editingTask, meetingId, projectIdProp, workspaceIdProp, meeting, taskPeopleIds])
  const utils = trpc.useUtils()
  const invalidateAndClose = () => {
    utils.tasks.list.invalidate()
    utils.tasks.listByMeeting.invalidate()
    utils.tasks.listByProject.invalidate()
    utils.tasks.getById.invalidate()
    utils.tasks.getTaskPeople.invalidate()
    utils.meetings.list.invalidate()
    utils.projects.list.invalidate()
    utils.people.getRelated.invalidate()
    onClose()
  }
  const setTaskPeople = trpc.tasks.setTaskPeople.useMutation({
    onSuccess: invalidateAndClose,
  })
  const create = trpc.tasks.create.useMutation()
  const update = trpc.tasks.update.useMutation()

  const toggleRelatedPerson = (personId: string) => {
    setForm((f) =>
      f.relatedPersonIds.includes(personId)
        ? { ...f, relatedPersonIds: f.relatedPersonIds.filter((id) => id !== personId) }
        : { ...f, relatedPersonIds: [...f.relatedPersonIds, personId] }
    )
  }

  const save = () => {
    const relatedIds = form.relatedPersonIds
    if (editingTaskId) {
      update.mutate(
        {
          id: editingTaskId,
          title: form.title,
          meetingId: form.meetingId || null,
          projectId: form.projectId || null,
          workspaceId: form.workspaceId || null,
          assigneeId: form.assigneeId || null,
          dueDate: form.dueDate || null,
          priority: form.priority,
          status: form.status,
        },
        {
          onSuccess: () => {
            setTaskPeople.mutate(
              { taskId: editingTaskId, personIds: relatedIds },
              { onSuccess: invalidateAndClose }
            )
          },
        }
      )
    } else {
      create.mutate(
        {
          title: form.title,
          meetingId: form.meetingId || null,
          projectId: form.projectId || null,
          workspaceId: form.workspaceId || null,
          assigneeId: form.assigneeId || null,
          dueDate: form.dueDate || null,
          priority: form.priority,
          status: form.status,
        },
        {
          onSuccess: (task) => {
            if (relatedIds.length > 0) {
              setTaskPeople.mutate(
                { taskId: task.id, personIds: relatedIds },
                { onSuccess: invalidateAndClose }
              )
            } else {
              invalidateAndClose()
            }
          },
        }
      )
    }
  }

  const isEdit = !!editingTaskId
  const isPending = create.isPending || update.isPending

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-6 tracking-tight">{isEdit ? 'ערוך משימה' : 'משימה חדשה'}</div>
        {isEdit && isLoadingTask ? (
          <div className="text-[#7a89ab] py-6">טוען...</div>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label">כותרת</label>
                <input
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="מה צריך לעשות?"
                />
              </div>
              <div>
                <label className="label">תאריך יעד</label>
                <input
                  className="input"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              {workspaces.length > 0 && (
                <div>
                  <label className="label">מקור</label>
                  <select
                    className="select"
                    value={form.workspaceId}
                    onChange={(e) => setForm((f) => ({ ...f, workspaceId: e.target.value }))}
                  >
                    <option value="">ללא מקור</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="label">פרויקט</label>
                <select
                  className="select"
                  value={form.projectId}
                  onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                >
                  <option value="">ללא פרויקט</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">פגישה קשורה</label>
                <select
                  className="select"
                  value={form.meetingId}
                  onChange={(e) => setForm((f) => ({ ...f, meetingId: e.target.value }))}
                >
                  <option value="">ללא פגישה</option>
                  {meetings.map((m) => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">אחראי</label>
                <select
                  className="select"
                  value={form.assigneeId}
                  onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}
                >
                  <option value="">ללא</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">קשור לאנשים</label>
                <p className="text-[11px] text-[#647399] mb-2">המשימה תופיע בכרטיסיה של כל אדם שנבחר</p>
                <input
                  type="text"
                  className="input mb-2"
                  placeholder="חפש לפי שם או חברה..."
                  value={relatedPeopleFilter}
                  onChange={(e) => setRelatedPeopleFilter(e.target.value)}
                />
                <div className="max-h-[140px] overflow-y-auto rounded-lg border border-[#2f4368] bg-[#1d2b46] p-2 space-y-1">
                  {people.length === 0 ? (
                    <span className="text-xs text-[#5a688c]">אין אנשי קשר</span>
                  ) : (() => {
                    const q = relatedPeopleFilter.trim().toLowerCase()
                    const filtered = q
                      ? people.filter(
                          (p) =>
                            p.name.toLowerCase().includes(q) ||
                            (p.company ?? '').toLowerCase().includes(q) ||
                            (p.jobTitle ?? '').toLowerCase().includes(q) ||
                            (p.role ?? '').toLowerCase().includes(q)
                        )
                      : people
                    return filtered.length === 0 ? (
                      <span className="text-xs text-[#5a688c]">אין תוצאות</span>
                    ) : (
                      filtered.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-[#29395d] transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border border-[#4d659c] bg-transparent accent-[#2dd4bf]"
                            checked={form.relatedPersonIds.includes(p.id)}
                            onChange={() => toggleRelatedPerson(p.id)}
                          />
                          <span className="text-sm text-[#b8c4dc]">{p.name}</span>
                          {p.company && (
                            <span className="text-[11px] text-[#5a688c] truncate max-w-[100px]"> · {p.company}</span>
                          )}
                        </label>
                      ))
                    )
                  })()}
                </div>
              </div>
              <div>
                <label className="label">סטטוס</label>
                <StatusChips
                  value={form.status}
                  onChange={(status) => setForm((f) => ({ ...f, status }))}
                />
              </div>
              <div>
                <label className="label">עדיפות</label>
                <div className="flex flex-wrap gap-2">
                  {(['high', 'medium', 'low'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={form.priority === p}
                      onClick={() => setForm((f) => ({ ...f, priority: p }))}
                      className="cursor-pointer inline-flex items-center min-h-[40px] py-1.5 px-3.5 rounded-[20px] border text-sm transition-all"
                      style={{
                        borderColor: form.priority === p ? PRIORITY_COLORS[p] : '#2f4368',
                        background: form.priority === p ? PRIORITY_COLORS[p] + '22' : 'transparent',
                        color: form.priority === p ? PRIORITY_COLORS[p] : '#7a89ab',
                      }}
                    >
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2.5 mt-6 justify-end">
              <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.title || isPending}>
                שמור
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
