'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@ak-system/types'
import type { Person } from '@ak-system/database'

type MeetingOption = { id: string; title: string }
type ProjectOption = { id: string; name: string }

export function TaskModal({
  open,
  onClose,
  editingTaskId,
  meetingId,
  projectId: projectIdProp,
  people,
  meetings,
  projects,
}: {
  open: boolean
  onClose: () => void
  editingTaskId?: string | null
  meetingId?: string | null
  projectId?: string | null
  people: Person[]
  meetings: MeetingOption[]
  projects: ProjectOption[]
}) {
  const [form, setForm] = useState({
    title: '',
    meetingId: meetingId ?? '',
    projectId: projectIdProp ?? '',
    assigneeId: '',
    dueDate: '',
    priority: 'medium' as 'high' | 'medium' | 'low',
  })
  const { data: meeting } = trpc.meetings.getById.useQuery({ id: meetingId! }, { enabled: !!meetingId && open })
  const { data: editingTask, isLoading: isLoadingTask } = trpc.tasks.getById.useQuery(
    { id: editingTaskId! },
    { enabled: !!editingTaskId && open }
  )
  useEffect(() => {
    if (!open) return
    if (editingTaskId && editingTask) {
      setForm({
        title: editingTask.title,
        meetingId: editingTask.meetingId ?? '',
        projectId: (editingTask as { projectId?: string | null }).projectId ?? '',
        assigneeId: editingTask.assigneeId ?? '',
        dueDate: editingTask.dueDate ?? '',
        priority: (editingTask.priority as 'high' | 'medium' | 'low') || 'medium',
      })
    } else if (!editingTaskId) {
      setForm((f) => ({
        title: '',
        meetingId: meetingId ?? '',
        projectId: projectIdProp ?? (meeting as { projectId?: string } | null)?.projectId ?? f.projectId,
        assigneeId: '',
        dueDate: '',
        priority: 'medium',
      }))
    }
  }, [open, editingTaskId, editingTask, meetingId, projectIdProp, meeting])
  const utils = trpc.useUtils()
  const create = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.tasks.listByMeeting.invalidate()
      utils.tasks.listByProject.invalidate()
      utils.meetings.list.invalidate()
      utils.projects.list.invalidate()
      onClose()
    },
  })
  const update = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.tasks.listByMeeting.invalidate()
      utils.tasks.listByProject.invalidate()
      utils.tasks.getById.invalidate()
      utils.meetings.list.invalidate()
      utils.projects.list.invalidate()
      onClose()
    },
  })

  const save = () => {
    if (editingTaskId) {
      update.mutate({
        id: editingTaskId,
        title: form.title,
        meetingId: form.meetingId || null,
        projectId: form.projectId || null,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        priority: form.priority,
      })
    } else {
      create.mutate({
        title: form.title,
        meetingId: form.meetingId || null,
        projectId: form.projectId || null,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        priority: form.priority,
      })
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
          <div className="text-[#888] py-6">טוען...</div>
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
                <label className="label">עדיפות</label>
                <div className="flex gap-2">
                  {(['high', 'medium', 'low'] as const).map((p) => (
                    <div
                      key={p}
                      onClick={() => setForm((f) => ({ ...f, priority: p }))}
                      className="cursor-pointer py-1.5 px-3 rounded-[20px] border text-sm transition-all"
                      style={{
                        borderColor: form.priority === p ? PRIORITY_COLORS[p] : '#2a2a2a',
                        background: form.priority === p ? PRIORITY_COLORS[p] + '22' : 'transparent',
                        color: form.priority === p ? PRIORITY_COLORS[p] : '#888',
                      }}
                    >
                      {PRIORITY_LABELS[p]}
                    </div>
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
