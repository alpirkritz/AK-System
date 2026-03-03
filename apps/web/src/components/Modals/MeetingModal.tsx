'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { DAYS_HE } from '@ak-system/types'
import type { Person } from '@ak-system/database'

type MeetingForm = {
  id?: string
  title: string
  date: string
  time: string
  recurring: string | null
  recurrenceDay: string | null
  projectId: string
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
  projects: { id: string; name: string }[]
}) {
  const [form, setForm] = useState<MeetingForm>(EMPTY_FORM)
  const { data: meeting, isLoading } = trpc.meetings.getById.useQuery({ id: editingId! }, { enabled: !!editingId && open })
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
        peopleIds: form.peopleIds,
        notes: form.notes,
      })
    } else {
      create.mutate({
        title: form.title,
        date: form.date,
        time: form.time,
        recurring: form.recurring,
        recurrenceDay: form.recurrenceDay,
        projectId: form.projectId || null,
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
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
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
          <div>
            <label className="label">משתתפים</label>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => {
                const selected = form.peopleIds.includes(p.id)
                return (
                  <div
                    key={p.id}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        peopleIds: selected
                          ? f.peopleIds.filter((id) => id !== p.id)
                          : [...f.peopleIds, p.id],
                      }))
                    }
                    className="cursor-pointer py-1.5 px-2.5 rounded-[20px] border text-sm transition-all"
                    style={{
                      borderColor: selected ? p.color ?? '#e8c547' : '#2a2a2a',
                      background: selected ? (p.color ?? '#e8c547') + '22' : 'transparent',
                      color: selected ? p.color ?? '#e8c547' : '#888',
                    }}
                  >
                    {p.name}
                  </div>
                )
              })}
            </div>
          </div>
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
