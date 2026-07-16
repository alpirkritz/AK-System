'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Pencil, Phone, Mail, Linkedin, Calendar, CheckSquare, Save, XCircle } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { he } from 'date-fns/locale'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/cn'
import { CreatableSelect } from '@/components/ui/CreatableSelect'
import { CreatableMultiSelect } from '@/components/ui/CreatableMultiSelect'

const COLORS = ['#2dd4bf', '#fb7185', '#38bdf8', '#47e8a8', '#b847e8']
const GOAL_OPTIONS = ['Bi-Weekly', 'Monthly', 'Bi-Monthly', 'Quarterly']

interface Props {
  personId: string
  onClose: () => void
}

export function PersonDetailDrawer({ personId, onClose }: Props) {
  const { data: person, isLoading } = trpc.people.getById.useQuery({ id: personId })
  const { data: related } = trpc.people.getRelated.useQuery({ id: personId })
  const { data: filterOptions } = trpc.people.filterOptions.useQuery(undefined, { enabled: !!personId })
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
  const toggleTaskDone = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => {
      utils.people.getRelated.invalidate({ id: personId })
      utils.tasks.list.invalidate()
      utils.tasks.listByMeeting.invalidate()
      utils.tasks.listByProject.invalidate()
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
        color: person.color ?? '#2dd4bf',
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

  const color = person.color ?? '#2dd4bf'

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
                <h2 className="text-lg font-bold text-[#eef3fb] leading-tight">{person.name}</h2>
                {(person.jobTitle || person.role) && (
                  <p className="text-sm text-[#7a89ab]">{person.jobTitle || person.role}</p>
                )}
                {person.company && (
                  <p className="text-xs text-[#647399]">{person.company}</p>
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
            <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-3">פרטים</h3>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="label">שם</label>
                  <input className="input" value={form.name} onChange={set('name')} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <CreatableSelect
                      label="תפקיד"
                      value={form.role}
                      options={filterOptions?.roles ?? []}
                      onChange={v => setForm(f => ({ ...f, role: v }))}
                      placeholder="תפקיד"
                    />
                  </div>
                  <div>
                    <label className="label">Job Title</label>
                    <input className="input" value={form.jobTitle} onChange={set('jobTitle')} />
                  </div>
                </div>
                <div>
                  <CreatableSelect
                    label="חברה"
                    value={form.company}
                    options={filterOptions?.companies ?? []}
                    onChange={v => setForm(f => ({ ...f, company: v }))}
                    placeholder="חברה"
                  />
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
                  <CreatableMultiSelect
                    label="תגיות"
                    value={form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : []}
                    options={filterOptions?.tags ?? []}
                    onChange={arr => setForm(f => ({ ...f, tags: arr.join(', ') }))}
                    placeholder="בחר או הוסף תגיות"
                  />
                </div>
                <div>
                  <CreatableMultiSelect
                    label="מומחיות"
                    value={form.expertIn ? form.expertIn.split(',').map(e => e.trim()).filter(Boolean) : []}
                    options={filterOptions?.expertIn ?? []}
                    onChange={arr => setForm(f => ({ ...f, expertIn: arr.join(', ') }))}
                    placeholder="בחר או הוסף מומחיות"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <CreatableSelect
                      label="יעד קשר"
                      value={form.goal}
                      options={(filterOptions?.goals?.length ? filterOptions.goals : GOAL_OPTIONS) as string[]}
                      onChange={v => setForm(f => ({ ...f, goal: v }))}
                      placeholder="ללא"
                    />
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
                    <span className="text-[11px] text-[#5a688c]">תגיות</span>
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
                    <span className="text-[11px] text-[#5a688c]">הערות</span>
                    <p className="text-sm text-[#b8c4dc] mt-1 whitespace-pre-wrap leading-relaxed">{person.notes}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Cadence summary */}
          {related?.cadence && (related.cadence.totalMeetings > 0) && (
            <section className="mb-5">
              <div
                className="rounded-lg px-3 py-2 text-xs"
                style={{ background: '#141f36', border: '1px solid #29395d', color: '#97a4c2' }}
              >
                {related.cadence.isRecurring ? '↻ קשר חוזר' : 'קשר'}
                {' · '}
                {related.cadence.recentCount > 0
                  ? `${related.cadence.recentCount} מפגשים ב-${related.cadence.weeks} השבועות האחרונים`
                  : `${related.cadence.totalMeetings} מפגשים בסך הכול`}
              </div>
            </section>
          )}

          {/* Activity timeline */}
          {related && related.meetings.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                פגישות ({related.meetings.length})
              </h3>
              <div className="space-y-2">
                {related.meetings.slice(0, 10).map(meeting => (
                  <div key={meeting.id} className="flex items-center gap-3 py-2 border-b border-[#223052] last:border-0">
                    <span className="text-[10px] text-[#5a688c] tabular-nums w-[70px] shrink-0">
                      {format(new Date(meeting.date), 'dd/MM/yy')}
                    </span>
                    <span className="text-xs text-[#97a4c2] truncate">{meeting.title}</span>
                  </div>
                ))}
                {related.meetings.length > 10 && (
                  <p className="text-[11px] text-[#5a688c]">+ עוד {related.meetings.length - 10} פגישות</p>
                )}
              </div>
            </section>
          )}

          {/* Related tasks */}
          {related && related.tasks.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5" />
                משימות ({related.tasks.length})
              </h3>
              <div className="space-y-2">
                {related.tasks.map((task: { id: string; title: string; done: boolean; dueDate?: string | null; meetingTitle?: string | null; meetingDate?: string | null; projectName?: string | null }) => (
                  <div key={task.id} className="flex flex-col gap-0.5 py-2 border-b border-[#223052] last:border-0">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleTaskDone.mutate({ id: task.id })}
                        disabled={toggleTaskDone.isPending}
                        className={cn(
                          'w-5 h-5 rounded-sm border-2 shrink-0 flex items-center justify-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf] focus-visible:ring-offset-1 focus-visible:ring-offset-[#16233b]',
                          task.done ? 'bg-success border-success text-white' : 'border-[#4d659c] hover:border-[#647399] hover:bg-[#29395d]'
                        )}
                        title={task.done ? 'בטל סימון' : 'סמן בוצע'}
                        aria-label={task.done ? 'בטל סימון משימה' : 'סמן משימה כבוצעה'}
                      >
                        {task.done && <CheckSquare className="w-3 h-3" strokeWidth={2.5} />}
                      </button>
                      <span className={cn(
                        'text-xs truncate flex-1',
                        task.done ? 'text-[#5a688c] line-through' : 'text-[#97a4c2]'
                      )}>
                        {task.title}
                      </span>
                      {task.dueDate && (
                        <span className="text-[10px] text-[#5a688c] tabular-nums shrink-0">
                          {format(new Date(task.dueDate), 'dd/MM')}
                        </span>
                      )}
                    </div>
                    {(task.meetingTitle || task.projectName) && (
                      <div className="text-[10px] text-[#5a688c] pr-6 flex flex-wrap gap-x-2 gap-y-0">
                        {task.meetingTitle && (
                          <span>מפגישה: {task.meetingTitle}{task.meetingDate ? ` (${format(new Date(task.meetingDate), 'dd/MM/yy')})` : ''}</span>
                        )}
                        {task.projectName && (
                          <span>פרויקט: {task.projectName}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sticky footer for edit mode */}
        {editing && (
          <div className="border-t border-[#2f4368] p-4 flex items-center gap-2 justify-end bg-[#16233b]">
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
      <span className="text-[11px] text-[#5a688c]">{label}</span>
      <p className="text-sm text-[#b8c4dc] mt-0.5" dir={dir}>{value}</p>
    </div>
  )
}
