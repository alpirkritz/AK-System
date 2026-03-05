'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { CreatableSelect } from '@/components/ui/CreatableSelect'
import { CreatableMultiSelect } from '@/components/ui/CreatableMultiSelect'

const COLORS = ['#e8c547', '#e8477a', '#47b8e8', '#47e8a8', '#b847e8']

const GOAL_OPTIONS = ['Bi-Weekly', 'Monthly', 'Bi-Monthly', 'Quarterly']

interface PersonForm {
  name: string
  role: string
  email: string
  color: string
  phone: string
  company: string
  jobTitle: string
  linkedin: string
  tags: string
  expertIn: string
  lastContact: string
  goal: string
  contactFrequencyDays: string
  notes: string
}

const EMPTY_FORM: PersonForm = {
  name: '',
  role: '',
  email: '',
  color: '#e8c547',
  phone: '',
  company: '',
  jobTitle: '',
  linkedin: '',
  tags: '',
  expertIn: '',
  lastContact: '',
  goal: '',
  contactFrequencyDays: '',
  notes: '',
}

export function PersonModal({
  open,
  onClose,
  editingId,
}: {
  open: boolean
  onClose: () => void
  editingId: string | null
}) {
  const [form, setForm] = useState<PersonForm>({ ...EMPTY_FORM })
  const { data: person } = trpc.people.getById.useQuery({ id: editingId! }, { enabled: !!editingId && open })
  const { data: filterOptions } = trpc.people.filterOptions.useQuery(undefined, { enabled: open })
  const utils = trpc.useUtils()
  const create = trpc.people.create.useMutation({
    onSuccess: () => { utils.people.list.invalidate(); utils.people.listPaginated.invalidate(); utils.people.filterOptions.invalidate(); onClose() },
  })
  const update = trpc.people.update.useMutation({
    onSuccess: () => { utils.people.list.invalidate(); utils.people.listPaginated.invalidate(); utils.people.filterOptions.invalidate(); onClose() },
  })

  useEffect(() => {
    if (!open) return
    if (editingId && person) {
      setForm({
        name: person.name,
        role: person.role ?? '',
        email: person.email ?? '',
        color: person.color ?? '#e8c547',
        phone: person.phone ?? '',
        company: person.company ?? '',
        jobTitle: person.jobTitle ?? '',
        linkedin: person.linkedin ?? '',
        tags: person.tags ?? '',
        expertIn: person.expertIn ?? '',
        lastContact: person.lastContact ? person.lastContact.slice(0, 10) : '',
        goal: person.goal ?? '',
        contactFrequencyDays: person.contactFrequencyDays?.toString() ?? '',
        notes: person.notes ?? '',
      })
    } else {
      setForm({ ...EMPTY_FORM })
    }
  }, [open, editingId, person])

  const save = () => {
    const payload = {
      name: form.name,
      role: form.role || undefined,
      email: form.email || undefined,
      color: form.color || undefined,
      phone: form.phone || undefined,
      company: form.company || undefined,
      jobTitle: form.jobTitle || undefined,
      linkedin: form.linkedin || undefined,
      tags: form.tags || undefined,
      expertIn: form.expertIn || undefined,
      lastContact: form.lastContact || undefined,
      goal: form.goal || undefined,
      contactFrequencyDays: form.contactFrequencyDays ? parseInt(form.contactFrequencyDays, 10) : undefined,
      notes: form.notes || undefined,
    }
    if (editingId) {
      update.mutate({ id: editingId, ...payload })
    } else {
      create.mutate(payload)
    }
  }

  const set = (key: keyof PersonForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="font-bold text-lg mb-5 tracking-tight">
          {editingId ? 'ערוך איש קשר' : 'איש קשר חדש'}
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto flex-1 pl-1" style={{ scrollbarWidth: 'thin' }}>
          {/* Basic Info */}
          <section>
            <div className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-3">פרטים בסיסיים</div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="label">שם מלא</label>
                <input className="input" value={form.name} onChange={set('name')} placeholder="שם" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <CreatableSelect
                    label="תפקיד"
                    value={form.role}
                    options={filterOptions?.roles ?? []}
                    onChange={(v) => setForm((f) => ({ ...f, role: v }))}
                    placeholder="תפקיד"
                  />
                </div>
                <div>
                  <label className="label">Job Title</label>
                  <input className="input" value={form.jobTitle} onChange={set('jobTitle')} placeholder="Co-founder & CEO" />
                </div>
              </div>
              <div>
                <CreatableSelect
                  label="חברה"
                  value={form.company}
                  options={filterOptions?.companies ?? []}
                  onChange={(v) => setForm((f) => ({ ...f, company: v }))}
                  placeholder="שם חברה"
                />
              </div>
              <div>
                <label className="label">צבע</label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <div
                      key={c}
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      className="w-7 h-7 rounded-full cursor-pointer border-[3px] border-transparent transition-all"
                      style={{
                        background: c,
                        borderColor: form.color === c ? 'white' : 'transparent',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Contact */}
          <section>
            <div className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-3">פרטי קשר</div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="label">אימייל</label>
                <input className="input" value={form.email} onChange={set('email')} placeholder="email@example.com" />
              </div>
              <div>
                <label className="label">טלפון</label>
                <input className="input" value={form.phone} onChange={set('phone')} placeholder="+972-50-000-0000" dir="ltr" />
              </div>
              <div>
                <label className="label">LinkedIn</label>
                <input className="input" value={form.linkedin} onChange={set('linkedin')} placeholder="https://linkedin.com/in/..." dir="ltr" />
              </div>
            </div>
          </section>

          {/* Relationship */}
          <section>
            <div className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-3">ניהול קשר</div>
            <div className="flex flex-col gap-3">
              <div>
                <CreatableMultiSelect
                  label="תגיות"
                  value={form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : []}
                  options={filterOptions?.tags ?? []}
                  onChange={(arr) => setForm((f) => ({ ...f, tags: arr.join(', ') }))}
                  placeholder="בחר או הוסף תגיות"
                />
              </div>
              <div>
                <CreatableMultiSelect
                  label="מומחיות"
                  value={form.expertIn ? form.expertIn.split(',').map((e) => e.trim()).filter(Boolean) : []}
                  options={filterOptions?.expertIn ?? []}
                  onChange={(arr) => setForm((f) => ({ ...f, expertIn: arr.join(', ') }))}
                  placeholder="בחר או הוסף מומחיות"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <CreatableSelect
                    label="תדירות יעד"
                    value={form.goal}
                    options={(filterOptions?.goals?.length ? filterOptions.goals : GOAL_OPTIONS) as string[]}
                    onChange={(v) => setForm((f) => ({ ...f, goal: v }))}
                    placeholder="ללא"
                  />
                </div>
                <div>
                  <label className="label">תדירות (ימים)</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={form.contactFrequencyDays}
                    onChange={set('contactFrequencyDays')}
                    placeholder="30"
                  />
                </div>
              </div>
              <div>
                <label className="label">קשר אחרון</label>
                <input className="input" type="date" value={form.lastContact} onChange={set('lastContact')} />
              </div>
              <div>
                <label className="label">הערות</label>
                <textarea
                  className="input"
                  rows={3}
                  value={form.notes}
                  onChange={set('notes')}
                  placeholder="הערות חופשיות..."
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="flex gap-2.5 mt-5 justify-end">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name || create.isPending || update.isPending}>
            שמור
          </button>
        </div>
      </div>
    </div>
  )
}
