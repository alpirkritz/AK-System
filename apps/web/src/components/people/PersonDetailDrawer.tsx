'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Pencil, Phone, Mail, Linkedin, Calendar, CheckSquare, Save, XCircle } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { he } from 'date-fns/locale'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/cn'

const COLORS = ['#e8c547', '#e8477a', '#47b8e8', '#47e8a8', '#b847e8']
const GOAL_OPTIONS = ['', 'Bi-Weekly', 'Monthly', 'Bi-Monthly', 'Quarterly'] as const

interface Props {
  personId: string
  onClose: () => void
}

export function PersonDetailDrawer({ personId, onClose }: Props) {
  const { data: person, isLoading } = trpc.people.getById.useQuery({ id: personId })
  const { data: related } = trpc.people.getRelated.useQuery({ id: personId })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  const utils = trpc.useUtils()
  const update = trpc.people.update.useMutation({
    onSuccess: () => {
      utils.people.getById.invalidate({ id: personId })
      utils.people.listPaginated.invalidate()
      utils.people.filterOptions.invalidate()
      setEditing(false)
    },
  })

  useEffect(() => {
    if (person) {
      setForm({
        name: person.name,
        role: person.role ?? '',
        email: person.email ?? '',
        phone: person.phone ?? '',
        company: person.company ?? '',
        jobTitle: person.jobTitle ?? '',
        linkedin: person.linkedin ?? '',
        tags: person.tags ?? '',
        expertIn: person.expertIn ?? '',
        goal: person.goal ?? '',
        contactFrequencyDays: person.contactFrequencyDays?.toString() ?? '',
        lastContact: person.lastContact ? person.lastContact.slice(0, 10) : '',
        notes: person.notes ?? '',
        color: person.color ?? '#e8c547',
      })
    }
  }, [person])

  const handleSave = useCallback(() => {
    if (!form.name) return
    update.mutate({
      id: personId,
      name: form.name,
      role: form.role || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      company: form.company || undefined,
      jobTitle: form.jobTitle || undefined,
      linkedin: form.linkedin || undefined,
      tags: form.tags || undefined,
      expertIn: form.expertIn || undefined,
      goal: form.goal || undefined,
      contactFrequencyDays: form.contactFrequencyDays ? parseInt(form.contactFrequencyDays, 10) : undefined,
      lastContact: form.lastContact || undefined,
      notes: form.notes || undefined,
      color: form.color || undefined,
    })
  }, [form, personId, update])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  if (isLoading || !person) {
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <div className="drawer p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="skeleton w-14 h-14 rounded-full" />
            <div className="flex-1">
              <div className="skeleton h-5 w-32 rounded mb-2" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mb-4">
              <div className="skeleton h-3 w-16 rounded mb-2" />
              <div className="skeleton h-4 rounded" style={{ width: 120 + Math.random() * 100 }} />
            </div>
          ))}
        </div>
      </>
    )
  }

  const color = person.color ?? '#e8c547'

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className={cn('drawer flex flex-col', editing && 'border-r-2 border-r-primary')}>
        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3.5">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold border-2 shrink-0"
                style={{
                  background: color + '18',
                  color,
                  borderColor: color + '30',
                }}
              >
                {person.name[0]}
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#f0ede6] leading-tight">{person.name}</h2>
                {(person.jobTitle || person.role) && (
                  <p className="text-sm text-[#888]">{person.jobTitle || person.role}</p>
                )}
                {person.company && (
                  <p className="text-xs text-[#666]">{person.company}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!editing && (
                <button className="icon-btn" onClick={() => setEditing(true)} title="ערוך">
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              <button className="icon-btn" onClick={onClose} title="סגור">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Contact action buttons */}
          <div className="flex items-center gap-2 mb-6">
            {person.phone && (
              <a href={`tel:${person.phone}`} className="btn btn-ghost flex items-center gap-1.5 text-xs">
                <Phone className="w-3.5 h-3.5" />
                התקשר
              </a>
            )}
            {person.email && (
              <a href={`mailto:${person.email}`} className="btn btn-ghost flex items-center gap-1.5 text-xs">
                <Mail className="w-3.5 h-3.5" />
                שלח מייל
              </a>
            )}
            {person.linkedin && (
              <a
                href={person.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost flex items-center gap-1.5 text-xs"
              >
                <Linkedin className="w-3.5 h-3.5" />
                LinkedIn
              </a>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: 'thin' }}>
          {/* Key fields */}
          <section className="mb-6">
            <h3 className="text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-3">פרטים</h3>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="label">שם</label>
                  <input className="input" value={form.name} onChange={set('name')} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">תפקיד</label>
                    <input className="input" value={form.role} onChange={set('role')} />
                  </div>
                  <div>
                    <label className="label">Job Title</label>
                    <input className="input" value={form.jobTitle} onChange={set('jobTitle')} />
                  </div>
                </div>
                <div>
                  <label className="label">חברה</label>
                  <input className="input" value={form.company} onChange={set('company')} />
                </div>
                <div>
                  <label className="label">אימייל</label>
                  <input className="input" value={form.email} onChange={set('email')} />
                </div>
                <div>
                  <label className="label">טלפון</label>
                  <input className="input" value={form.phone} onChange={set('phone')} dir="ltr" />
                </div>
                <div>
                  <label className="label">LinkedIn</label>
                  <input className="input" value={form.linkedin} onChange={set('linkedin')} dir="ltr" />
                </div>
                <div>
                  <label className="label">תגיות (מופרד בפסיקים)</label>
                  <input className="input" value={form.tags} onChange={set('tags')} />
                </div>
                <div>
                  <label className="label">מומחיות</label>
                  <input className="input" value={form.expertIn} onChange={set('expertIn')} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">יעד קשר</label>
                    <select className="input" value={form.goal} onChange={set('goal')}>
                      <option value="">ללא</option>
                      {GOAL_OPTIONS.filter(Boolean).map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">תדירות (ימים)</label>
                    <input className="input" type="number" min="1" value={form.contactFrequencyDays} onChange={set('contactFrequencyDays')} />
                  </div>
                </div>
                <div>
                  <label className="label">קשר אחרון</label>
                  <input className="input" type="date" value={form.lastContact} onChange={set('lastContact')} />
                </div>
                <div>
                  <label className="label">צבע</label>
                  <div className="flex gap-2">
                    {COLORS.map(c => (
                      <div
                        key={c}
                        onClick={() => setForm(f => ({ ...f, color: c }))}
                        className="w-7 h-7 rounded-full cursor-pointer border-[3px] transition-all"
                        style={{
                          background: c,
                          borderColor: form.color === c ? 'white' : 'transparent',
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">הערות</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={form.notes}
                    onChange={set('notes')}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <FieldRow label="תפקיד" value={person.jobTitle || person.role} />
                <FieldRow label="חברה" value={person.company} />
                <FieldRow label="אימייל" value={person.email} dir="ltr" />
                <FieldRow label="טלפון" value={person.phone} dir="ltr" />
                {person.tags && (
                  <div>
                    <span className="text-[11px] text-[#555]">תגיות</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {person.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                        <span key={tag} className="pill text-[10px]">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
                <FieldRow label="מומחיות" value={person.expertIn} />
                <FieldRow label="יעד קשר" value={person.goal} />
                {person.contactFrequencyDays && (
                  <FieldRow label="תדירות" value={`כל ${person.contactFrequencyDays} ימים`} />
                )}
                {person.lastContact && (
                  <FieldRow
                    label="קשר אחרון"
                    value={formatDistanceToNow(new Date(person.lastContact), { addSuffix: true, locale: he })}
                  />
                )}
                {person.notes && (
                  <div>
                    <span className="text-[11px] text-[#555]">הערות</span>
                    <p className="text-sm text-[#ccc] mt-1 whitespace-pre-wrap leading-relaxed">{person.notes}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Activity timeline */}
          {related && related.meetings.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                פגישות ({related.meetings.length})
              </h3>
              <div className="space-y-2">
                {related.meetings.slice(0, 10).map(meeting => (
                  <div key={meeting.id} className="flex items-center gap-3 py-2 border-b border-[#1f1f1f] last:border-0">
                    <span className="text-[10px] text-[#555] tabular-nums w-[70px] shrink-0">
                      {format(new Date(meeting.date), 'dd/MM/yy')}
                    </span>
                    <span className="text-xs text-[#aaa] truncate">{meeting.title}</span>
                  </div>
                ))}
                {related.meetings.length > 10 && (
                  <p className="text-[11px] text-[#555]">+ עוד {related.meetings.length - 10} פגישות</p>
                )}
              </div>
            </section>
          )}

          {/* Related tasks */}
          {related && related.tasks.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold text-[#555] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5" />
                משימות ({related.tasks.length})
              </h3>
              <div className="space-y-2">
                {related.tasks.slice(0, 10).map(task => (
                  <div key={task.id} className="flex items-center gap-3 py-2 border-b border-[#1f1f1f] last:border-0">
                    <span className={cn(
                      'w-3 h-3 rounded-sm border-2 shrink-0',
                      task.done ? 'bg-success border-success' : 'border-[#444]'
                    )} />
                    <span className={cn(
                      'text-xs truncate',
                      task.done ? 'text-[#555] line-through' : 'text-[#aaa]'
                    )}>
                      {task.title}
                    </span>
                    {task.dueDate && (
                      <span className="text-[10px] text-[#555] mr-auto tabular-nums shrink-0">
                        {format(new Date(task.dueDate), 'dd/MM')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sticky footer for edit mode */}
        {editing && (
          <div className="border-t border-[#2a2a2a] p-4 flex items-center gap-2 justify-end bg-[#161616]">
            <button className="btn btn-ghost flex items-center gap-1.5" onClick={() => setEditing(false)}>
              <XCircle className="w-4 h-4" />
              ביטול
            </button>
            <button
              className="btn btn-primary flex items-center gap-1.5"
              onClick={handleSave}
              disabled={!form.name || update.isPending}
            >
              <Save className="w-4 h-4" />
              שמור
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function FieldRow({ label, value, dir }: { label: string; value?: string | null; dir?: string }) {
  if (!value) return null
  return (
    <div>
      <span className="text-[11px] text-[#555]">{label}</span>
      <p className="text-sm text-[#ccc] mt-0.5" dir={dir}>{value}</p>
    </div>
  )
}
