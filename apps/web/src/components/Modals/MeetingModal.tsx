'use client'

import { useEffect, useState } from 'react'
import { WorldProjectOptions } from '@/components/ui/WorldProjectOptions'
import { trpc } from '@/lib/trpc'
import { DAYS_HE } from '@ak-system/types'
import type { Person } from '@ak-system/database'
import { MeetingPeoplePicker } from '@/components/ui/MeetingPeoplePicker'

type MeetingForm = {
  id?: string
  title: string
  date: string
  time: string
  recurring: string | null
  recurrenceDay: string | null
  projectId: string
  typeId: string
  peopleIds: string[]
  notes: string
}

const EMPTY_FORM: MeetingForm = {
  title: '',
  date: '',
  time: '09:00',
  recurring: null,
  recurrenceDay: null,
  projectId: '',
  typeId: '',
  peopleIds: [],
  notes: '',
}

export function MeetingModal({
  open,
  onClose,
  editingId,
  initialValues,
  people,
  projects,
}: {
  open: boolean
  onClose: () => void
  editingId: string | null
  initialValues?: Partial<MeetingForm>
  people: Person[]
  projects: { id: string; name: string; workspaceId?: string | null; worldId?: string | null }[]
}) {
  const [form, setForm] = useState<MeetingForm>(EMPTY_FORM)
  const { data: meeting, isLoading } = trpc.meetings.getById.useQuery({ id: editingId! }, { enabled: !!editingId && open })
  const { data: meetingTypes = [] } = trpc.meetingTypes.list.useQuery(undefined, { enabled: open })
  const utils = trpc.useUtils()
  const create = trpc.meetings.create.useMutation({
    onSuccess: () => { utils.meetings.list.invalidate(); onClose() },
  })
  const update = trpc.meetings.update.useMutation({
    onSuccess: () => { utils.meetings.list.invalidate(); utils.meetings.getById.invalidate(); onClose() },
  })

  useEffect(() => {
    if (!open) return
    if (editingId && meeting) {
      setForm({
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        time: meeting.time,
        recurring: meeting.recurring,
        recurrenceDay: meeting.recurrenceDay,
        projectId: (meeting as { projectId?: string }).projectId ?? '',
        typeId: (meeting as { typeId?: string }).typeId ?? '',
        peopleIds: (meeting as { peopleIds?: string[] }).peopleIds ?? [],
        notes: meeting.notes ?? '',
      })
    } else {
      setForm({
        ...EMPTY_FORM,
        ...initialValues,
      })
    }
  }, [open, editingId, meeting])

  const save = () => {
    if (form.id) {
      update.mutate({
        id: form.id,
        title: form.title,
        date: form.date,
        time: form.time,
        recurring: form.recurring,
        recurrenceDay: form.recurrenceDay,
        projectId: form.projectId || null,
        typeId: form.typeId || null,
        peopleIds: form.peopleIds,
        notes: form.notes,
      }, {
        onSuccess: (result) => {
          // Check for Notion sync failure
          const notionSync = (result as { notionSync?: { ok: boolean } | null })?.notionSync
          if (notionSync && !notionSync.ok) {
            console.warn('Notion sync failed on meeting update:', notionSync)
          }
          utils.meetings.list.invalidate()
          utils.meetings.getById.invalidate()
          onClose()
        },
      })
    } else {
      create.mutate({
        title: form.title,
        date: form.date,
        time: form.time,
        recurring: form.recurring,
        recurrenceDay: form.recurrenceDay,
        projectId: form.projectId || null,
        typeId: form.typeId || null,
        peopleIds: form.peopleIds,
        notes: form.notes,
      })
    }
  }

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-6 tracking-tight">
          {form.id ? 'ערוך פגישה' : 'פגישה חדשה'}
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="label">כותרת</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="שם הפגישה"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">תאריך</label>
              <input
                className="input"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">שעה</label>
              <input
                className="input"
                type="time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              />
            </div>
          </div>
          {(meeting as { notionPageId?: string | null } | null)?.notionPageId && form.id ? (
            <p className="text-xs text-[#38bdf8]">
              מסונכרן עם Notion — שינוי כותרת או תאריך יעודכן גם שם
            </p>
          ) : null}
          <div>
            <label className="label">חוזרת?</label>
            <select
              className="select"
              value={form.recurring ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.value || null }))}
            >
              <option value="">לא חוזרת</option>
              <option value="weekly">שבועית</option>
            </select>
          </div>
          <div>
            <label className="label">פרויקט</label>
            <select
              className="select"
              value={form.projectId}
              onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
            >
              <option value="">ללא פרויקט</option>
              <WorldProjectOptions
                projects={projects}
                itemWorkspaceId={(meeting as { workspaceId?: string | null } | undefined)?.workspaceId}
                selectedId={form.projectId}
              />
            </select>
          </div>
          <div>
            <label className="label">סוג פגישה</label>
            <select
              className="select"
              value={form.typeId}
              onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}
            >
              <option value="">ללא סוג</option>
              {meetingTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          {form.recurring && (
            <div>
              <label className="label">יום בשבוע</label>
              <select
                className="select"
                value={form.recurrenceDay ?? 'Monday'}
                onChange={(e) => setForm((f) => ({ ...f, recurrenceDay: e.target.value }))}
              >
                {Object.entries(DAYS_HE).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          )}
          <MeetingPeoplePicker
            people={people}
            selectedIds={form.peopleIds}
            onChange={(peopleIds) => setForm((f) => ({ ...f, peopleIds }))}
          />
          <div>
            <label className="label">הערות</label>
            <textarea
              className="input resize-y"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="אג'נדה, הערות..."
            />
          </div>
        </div>
        <div className="flex gap-2.5 mt-6 justify-end">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.title || create.isPending || update.isPending}>
            שמור
          </button>
        </div>
      </div>
    </div>
  )
}
