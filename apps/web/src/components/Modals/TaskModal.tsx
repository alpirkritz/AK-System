'use client'

import { useState, useEffect, useRef } from 'react'
import { WorldProjectOptions } from '@/components/ui/WorldProjectOptions'
import { trpc } from '@/lib/trpc'
import { PRIORITY_LABELS, PRIORITY_COLORS, type TaskStatus } from '@ak-system/types'
import { StatusChips } from '@/components/StatusChips'
import { PersonSelect, type PersonOption } from '@/components/ui/PersonSelect'
import type { PeopleSyncResult } from '@/lib/notion-people-sync-message'
import type { Person } from '@ak-system/database'
import { WorkspacePicker } from '@/components/WorkspacePicker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { shiftDayKey, todayKey } from '@/lib/task-due'

type MeetingOption = { id: string; title: string }
type ProjectOption = { id: string; name: string; workspaceId?: string | null; worldId?: string | null }
type WorkspaceOption = { id: string; name: string; hasNotionLink?: boolean }

const OVERRIDE_FIELD_LABELS: Record<string, string> = {
  title: 'כותרת',
  dueDate: 'תאריך יעד',
  priority: 'עדיפות',
  status: 'סטטוס',
  assigneeId: 'אחראי',
  projectId: 'פרויקט',
  meetingId: 'פגישה',
  workspaceId: 'עולם',
}

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
  initialValues,
  explanations,
  onCreated,
  onPeopleSync,
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
  /** Pre-fill form fields when creating a new task (ignored when editing). */
  initialValues?: {
    title?: string
    priority?: 'high' | 'medium' | 'low'
    dueDate?: string
    assigneeId?: string
  }
  /**
   * Hebrew explanations to show under each field, explaining why a value was suggested.
   * Keys match field names: title, dueDate, projectId, assigneeId, meetingId.
   * Only shown when creating (not editing).
   */
  explanations?: Record<string, string>
  /** Fired after a successful create with the Notion push outcome (`null` when the workspace has no Notion link). */
  onCreated?: (notionSync: { ok: boolean } | null, task?: { id: string }) => void
  /** Fired after the related people are saved, with the outcome of pushing them to the Notion relation. */
  onPeopleSync?: (notionSync: PeopleSyncResult | null) => void
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
  const utilsOverrides = trpc.useUtils()
  const { data: overrides } = trpc.notionOverrides.get.useQuery(
    { entity: 'task', id: editingTaskId! },
    { enabled: !!editingTaskId && open }
  )
  const resetOverride = trpc.notionOverrides.reset.useMutation({
    onSuccess: () => utilsOverrides.notionOverrides.get.invalidate(),
  })
  const { data: taskPeopleIds } = trpc.tasks.getTaskPeople.useQuery(
    { id: editingTaskId! },
    { enabled: !!editingTaskId && open }
  )
  const { data: selfPerson } = trpc.people.me.useQuery(undefined, { enabled: open })
  // A new task inherits the context it was opened from: the meeting's project and world,
  // falling back to the world of that project.
  const meetingCtx = meeting as { projectId?: string | null; workspaceId?: string | null } | null | undefined
  const defaultProjectId = projectIdProp || meetingCtx?.projectId || ''
  const { data: defaultProject } = trpc.projects.getById.useQuery(
    { id: defaultProjectId },
    { enabled: open && !editingTaskId && !!defaultProjectId && !workspaceIdProp && !meetingCtx?.workspaceId }
  )
  const defaultWorkspaceId =
    workspaceIdProp || meetingCtx?.workspaceId || (defaultProject as { workspaceId?: string | null } | null | undefined)?.workspaceId || ''
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
        title: initialValues?.title ?? '',
        meetingId: meetingId ?? '',
        projectId: defaultProjectId,
        workspaceId: defaultWorkspaceId,
        assigneeId: initialValues?.assigneeId ?? '',
        dueDate: initialValues?.dueDate ?? todayKey(),
        priority: initialValues?.priority ?? 'medium',
        status: 'not_started',
        relatedPersonIds: [],
      }))
      setRelatedPeopleFilter('')
    }
    // Context defaults are applied by the effect below, so a late-loading meeting or project does not wipe what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingTaskId, editingTask, meetingId, taskPeopleIds, initialValues])

  useEffect(() => {
    if (!open || editingTaskId) return
    setForm((f) => ({
      ...f,
      projectId: f.projectId || defaultProjectId,
      workspaceId: f.workspaceId || defaultWorkspaceId,
    }))
  }, [open, editingTaskId, defaultProjectId, defaultWorkspaceId])

  // New tasks default to the owner. Applied once per open so a deliberate
  // "ללא אחראי" is not undone when the query refetches.
  const assigneePrefilled = useRef(false)
  useEffect(() => {
    if (!open) {
      assigneePrefilled.current = false
      return
    }
    if (editingTaskId || assigneePrefilled.current || !selfPerson) return
    assigneePrefilled.current = true
    setForm((f) => (f.assigneeId ? f : { ...f, assigneeId: selfPerson.id }))
  }, [open, editingTaskId, selfPerson])

  // The owner row can be created by `people.me` after `people.list` was fetched,
  // so on a fresh database it would otherwise be missing from the picker.
  const assigneeOptions: PersonOption[] =
    selfPerson && !people.some((p) => p.id === selfPerson.id) ? [selfPerson, ...people] : people

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
    onSuccess: (res) => {
      onPeopleSync?.((res as { notionSync?: PeopleSyncResult | null }).notionSync ?? null)
      invalidateAndClose()
    },
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
          onSuccess: (task) => {
            // Check for Notion sync failure
            const notionSync = (task as { notionSync?: { ok: boolean } | null })?.notionSync
            if (notionSync && !notionSync.ok) {
              // Still proceed with setTaskPeople, but this shows the error was non-fatal
              console.warn('Notion sync failed on task update:', notionSync)
            }
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
            onCreated?.((task as { notionSync?: { ok: boolean } | null }).notionSync ?? null, task)
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
        {isEdit && overrides && overrides.fields.length > 0 && (
          <div className="mb-4 rounded-lg border border-[#2dd4bf44] bg-[#2dd4bf0d] p-3 text-xs text-[#9fb0d0]">
            <div className="mb-1 font-semibold text-[#cdd7ea]">נערך אצלך — Notion לא ידרוס:</div>
            <div className="flex flex-wrap gap-2">
              {overrides.fields.map((field) => (
                <span key={field} className="inline-flex items-center gap-1 rounded-full bg-[#1d2b46] px-2 py-0.5">
                  {OVERRIDE_FIELD_LABELS[field] ?? field}
                  <button
                    type="button"
                    className="text-[#2dd4bf] hover:underline disabled:opacity-50"
                    disabled={resetOverride.isPending}
                    onClick={() => resetOverride.mutate({ entity: 'task', id: editingTaskId!, field })}
                  >
                    החזר ל-Notion
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
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
                {!isEdit && explanations?.title && (
                  <p className="mt-1 text-[11px] text-[#647399]">💡 {explanations.title}</p>
                )}
              </div>
              <div>
                <label className="label">תאריך יעד</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0 px-2"
                    aria-label="יום קודם"
                    title="יום קודם"
                    onClick={() => setForm((f) => ({ ...f, dueDate: shiftDayKey(f.dueDate || todayKey(), -1) }))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <input
                    className="input flex-1"
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0 px-2"
                    aria-label="יום הבא"
                    title="יום הבא"
                    onClick={() => setForm((f) => ({ ...f, dueDate: shiftDayKey(f.dueDate || todayKey(), 1) }))}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
                {!isEdit && explanations?.dueDate && (
                  <p className="mt-1 text-[11px] text-[#647399]">💡 {explanations.dueDate}</p>
                )}
              </div>
              {workspaces.length > 0 && (
                <div>
                  <label className="label" htmlFor="task-world">עולם</label>
                  <WorkspacePicker
                    id="task-world"
                    value={form.workspaceId}
                    onChange={(workspaceId) => setForm((f) => ({ ...f, workspaceId }))}
                  />
                  {!isEdit && (() => {
                    const selected = workspaces.find((w) => w.id === form.workspaceId)
                    return selected?.hasNotionLink ? (
                      <p className="mt-2 text-xs text-[#38bdf8]">
                        המשימה תיווצר גם ב-Notion ({selected.name})
                      </p>
                    ) : null
                  })()}
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
                  <WorldProjectOptions projects={projects} itemWorkspaceId={form.workspaceId || null} selectedId={form.projectId} />
                </select>
                {!isEdit && explanations?.projectId && (
                  <p className="mt-1 text-[11px] text-[#647399]">💡 {explanations.projectId}</p>
                )}
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
                {(editingTask as { source?: string | null; notionPageId?: string | null } | null)
                  ?.source === 'notion' &&
                (editingTask as { notionPageId?: string | null } | null)?.notionPageId &&
                form.meetingId ? (
                  <p className="mt-2 text-xs text-[#38bdf8]">
                    מסונכרן עם Notion — קישור לפגישה יעודכן גם שם
                  </p>
                ) : null}
                {!isEdit && !form.meetingId && explanations?.meetingId && (
                  <p className="mt-1 text-[11px] text-[#647399]">💡 {explanations.meetingId}</p>
                )}
              </div>
              <div>
                <label className="label" id="task-assignee-label">אחראי</label>
                <PersonSelect
                  id="task-assignee"
                  labelledBy="task-assignee-label"
                  value={form.assigneeId}
                  options={assigneeOptions}
                  selfId={selfPerson?.id ?? null}
                  onChange={(personId) => setForm((f) => ({ ...f, assigneeId: personId }))}
                />
                {!isEdit && explanations?.assigneeId && (
                  <p className="mt-1 text-[11px] text-[#647399]">💡 {explanations.assigneeId}</p>
                )}
              </div>
              <div>
                <label className="label" id="task-related-people-label">קשור לאנשים</label>
                <p className="text-[11px] text-[#647399] mb-2">המשימה תופיע בכרטיסיה של כל אדם שנבחר</p>
                <input
                  type="text"
                  className="input mb-2"
                  placeholder="חפש לפי שם או חברה..."
                  value={relatedPeopleFilter}
                  onChange={(e) => setRelatedPeopleFilter(e.target.value)}
                />
                <div
                  role="group"
                  aria-labelledby="task-related-people-label"
                  className="max-h-[140px] overflow-y-auto rounded-lg border border-[#2f4368] bg-[#1d2b46] p-2 space-y-1"
                >
                  {people.filter((p) => p.id !== selfPerson?.id).length === 0 ? (
                    <span className="text-xs text-[#5a688c]">אין אנשי קשר</span>
                  ) : (() => {
                    const contacts = people.filter((p) => p.id !== selfPerson?.id)
                    const q = relatedPeopleFilter.trim().toLowerCase()
                    const filtered = q
                      ? contacts.filter(
                          (p) =>
                            p.name.toLowerCase().includes(q) ||
                            (p.company ?? '').toLowerCase().includes(q) ||
                            (p.jobTitle ?? '').toLowerCase().includes(q) ||
                            (p.role ?? '').toLowerCase().includes(q)
                        )
                      : contacts
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
                {(editingTask as { source?: string | null; notionPageId?: string | null } | null)
                  ?.source === 'notion' &&
                (editingTask as { notionPageId?: string | null } | null)?.notionPageId ? (
                  <p className="mt-2 text-xs text-[#38bdf8]">
                    מסונכרן עם Notion — שינוי כותרת, סטטוס, עדיפות או תאריך יעד יעודכן גם שם
                  </p>
                ) : null}
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
