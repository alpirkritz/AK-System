'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { X, Pencil, Phone, Mail, Linkedin, Calendar, CheckSquare, Save, XCircle, Merge } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { he } from 'date-fns/locale'
import dynamic from 'next/dynamic'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/cn'
import { WorkspacePill } from '@/components/WorkspacePill'
import { CreatableSelect } from '@/components/ui/CreatableSelect'
import { CreatableMultiSelect } from '@/components/ui/CreatableMultiSelect'
import { SearchableAddSelect } from '@/components/ui/SearchableAddSelect'
import { sortTasksOpenThenDueAsc } from '@/lib/sort-tasks'

const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })

const COLORS = ['#2dd4bf', '#fb7185', '#38bdf8', '#47e8a8', '#b847e8']
const GOAL_OPTIONS = ['Bi-Weekly', 'Monthly', 'Bi-Monthly', 'Quarterly']

type RelatedTask = {
  id: string
  title: string
  done: boolean
  dueDate?: string | null
  meetingTitle?: string | null
  meetingDate?: string | null
  projectName?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
  workspaceColor?: string | null
}

/** Hint for flipped first/last names (Shani Asaraf → Asaraf Shani). */
function reverseNameHint(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`
  return name.trim()
}

interface Props {
  personId: string
  onClose: () => void
}

function identityChipLabel(provider: string, accountKey: string): string {
  if (provider === 'notion') {
    const db = accountKey.includes('::') ? accountKey.split('::').slice(1).join('::') : accountKey
    return `Notion · ${db || accountKey}`
  }
  if (provider === 'google_contact') return 'Google'
  if (provider === 'slack') return 'Slack'
  if (provider === 'email') return 'אימייל'
  return provider
}

export function PersonDetailDrawer({ personId, onClose }: Props) {
  const { data: person, isLoading } = trpc.people.getById.useQuery({ id: personId })
  const { data: related } = trpc.people.getRelated.useQuery({ id: personId })
  const { data: personContext } = trpc.insights.personContext.useQuery({ personId }, { enabled: !!personId })
  const { data: allProjects = [] } = trpc.projects.list.useQuery()
  const { data: allPeople = [] } = trpc.people.list.useQuery()
  const { data: allMeetings = [] } = trpc.meetings.list.useQuery()
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  const { data: filterOptions } = trpc.people.filterOptions.useQuery(undefined, { enabled: !!personId })
  const [editing, setEditing] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})

  const sortedTasks = useMemo(
    () => sortTasksOpenThenDueAsc((related?.tasks ?? []) as RelatedTask[]),
    [related?.tasks],
  )

  const utils = trpc.useUtils()
  const update = trpc.people.update.useMutation({
    onSuccess: () => {
      utils.people.getById.invalidate({ id: personId })
      utils.people.listPaginated.invalidate()
      utils.people.filterOptions.invalidate()
      setEditing(false)
    },
  })
  const merge = trpc.people.merge.useMutation({
    onSuccess: () => {
      void utils.people.listPaginated.invalidate()
      void utils.people.list.invalidate()
      void utils.people.reviewQueue.invalidate()
      void utils.people.filterOptions.invalidate()
      setMerging(false)
      setMergeSearch('')
      onClose()
    },
  })
  const { data: mergeResults = [] } = trpc.people.search.useQuery(
    { query: mergeSearch },
    { enabled: merging && mergeSearch.trim().length > 0 },
  )
  const invalidatePersonProjects = () => {
    utils.people.getRelated.invalidate({ id: personId })
    utils.insights.personContext.invalidate({ personId })
    utils.projects.getRelated.invalidate()
  }
  const addToProject = trpc.projects.addPerson.useMutation({
    onSuccess: invalidatePersonProjects,
  })
  const removeFromProject = trpc.projects.removePerson.useMutation({
    onSuccess: invalidatePersonProjects,
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
      if (e.key === 'Escape') {
        if (taskModalOpen) return
        if (merging) {
          setMerging(false)
          setMergeSearch('')
          return
        }
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, taskModalOpen, merging])

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
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {!editing && (
              <button
                type="button"
                className="btn btn-ghost flex items-center gap-1.5 text-xs"
                aria-expanded={merging}
                aria-label={`מזג את ${person.name} עם איש קשר אחר`}
                onClick={() => {
                  if (merging) {
                    setMerging(false)
                    setMergeSearch('')
                  } else {
                    setMerging(true)
                    setMergeSearch(reverseNameHint(person.name))
                  }
                }}
              >
                <Merge className="w-3.5 h-3.5" />
                מזג
              </button>
            )}
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

          {merging && (
            <div className="mb-6 p-3 rounded-lg" style={{ border: '1px solid #29395d', background: '#0f1729' }}>
              <p className="text-xs text-[#7a89ab] mb-2">
                בחרי את איש הקשר שנשאר. הכרטיס הנוכחי יימחק אחרי העברת כל הקישורים.
              </p>
              <input
                className="input text-sm"
                placeholder="חפש איש קשר למיזוג…"
                value={mergeSearch}
                onChange={(e) => setMergeSearch(e.target.value)}
                autoFocus
              />
              {mergeSearch.trim().length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg" style={{ border: '1px solid #29395d' }}>
                  {mergeResults.filter((r) => r.id !== personId).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[#5a688c]">לא נמצאו אנשי קשר</div>
                  ) : (
                    mergeResults
                      .filter((r) => r.id !== personId)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className="flex items-center justify-between gap-2 w-full px-3 py-2 text-right hover:bg-[#141f36] transition-colors disabled:opacity-50"
                          onClick={() => merge.mutate({ fromId: personId, toId: r.id })}
                          disabled={merge.isPending}
                        >
                          <span className="min-w-0">
                            <span className="text-xs text-[#b8c4dc] block truncate">{r.name}</span>
                            {r.email && (
                              <span className="text-[11px] text-[#5a688c] block truncate" dir="ltr">
                                {r.email}
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-[#e8c547] shrink-0">
                            {merge.isPending ? 'ממזג…' : 'מזג לכאן'}
                          </span>
                        </button>
                      ))
                  )}
                </div>
              )}
              {merge.isError && (
                <p className="text-xs text-[#e57373] mt-2">המיזוג נכשל — נסי שוב</p>
              )}
            </div>
          )}
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

          {/* Relationship insights */}
          {personContext && (
            <section className="mb-5">
              <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">
                הקשר
              </h3>
              <div
                className="rounded-lg px-3 py-2 text-xs space-y-1"
                style={{ background: '#141f36', border: '1px solid #29395d', color: '#97a4c2' }}
              >
                {personContext.lastContactAt && (
                  <div>
                    קשר אחרון:{' '}
                    {format(new Date(personContext.lastContactAt + (personContext.lastContactAt.length === 10 ? 'T00:00:00' : '')), 'dd/MM/yy')}
                  </div>
                )}
                <div>{personContext.meetingCount} פגישות · {personContext.sharedProjects.length} פרויקטים משותפים</div>
              </div>
            </section>
          )}

          {/* External identities */}
          {related?.identities && related.identities.length > 0 && (
            <section className="mb-5">
              <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">
                מקורות זהות
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {related.identities.map((id) => (
                  <span key={id.id} className="pill text-[10px]">
                    {identityChipLabel(id.provider, id.accountKey)}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Projects — always shown so the user can link from the person */}
          <section className="mb-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider">
                פרויקטים ({related?.projects?.length ?? 0})
              </h3>
              <SearchableAddSelect
                id="person-add-project"
                triggerLabel="+ שייך לפרויקט"
                placeholder="חיפוש פרויקט..."
                emptyLabel="לא נמצא פרויקט"
                disabled={addToProject.isPending}
                options={allProjects
                  .filter((p) => !(related?.projects ?? []).some((linked) => linked.id === p.id))
                  .map((p) => ({
                    id: p.id,
                    name: p.name,
                    color: p.color,
                  }))}
                onAdd={(projectId) => addToProject.mutate({ projectId, personId })}
              />
            </div>
            <div className="space-y-2">
              {(related?.projects ?? []).length === 0 && (
                <p className="text-xs text-[#5a688c]">לא משויך לפרויקטים — בחר מהרשימה למעלה</p>
              )}
              {(related?.projects ?? []).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 py-2 border-b border-[#223052] last:border-0 text-xs"
                >
                  <a
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-2 flex-1 min-w-0 text-[#97a4c2] hover:text-[#eef3fb]"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: p.color ?? '#38bdf8' }}
                    />
                    <span className="truncate">{p.name}</span>
                  </a>
                  <button
                    type="button"
                    className="text-[#5a688c] hover:text-[#fb7185] shrink-0 px-1"
                    title="הסר שיוך"
                    disabled={removeFromProject.isPending}
                    onClick={() => removeFromProject.mutate({ projectId: p.id, personId })}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Meeting notes */}
          {related?.meetingNotes && related.meetingNotes.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-3">
                סיכומי ישיבות ({related.meetingNotes.length})
              </h3>
              <div className="space-y-2">
                {related.meetingNotes.map((note) => {
                  const excerpt =
                    ('bodyText' in note && typeof note.bodyText === 'string' && note.bodyText.trim())
                      ? note.bodyText.trim()
                      : note.snippet?.trim() || ''
                  return (
                  <div key={note.id} className="py-2 border-b border-[#223052] last:border-0">
                    <div className="flex items-center gap-2 text-xs">
                      {note.date && (
                        <span className="text-[10px] text-[#5a688c] tabular-nums shrink-0">
                          {format(new Date(note.date + 'T00:00:00'), 'dd/MM/yy')}
                        </span>
                      )}
                      {'sourceKind' in note && String(note.sourceKind ?? '').startsWith('meeting_page') && (
                        <span className="text-[10px] text-[#5a688c] shrink-0">AI</span>
                      )}
                      {note.meetingId ? (
                        <a href={`/meetings/${note.meetingId}`} className="text-[#97a4c2] hover:text-[#eef3fb] truncate">
                          {note.title}
                        </a>
                      ) : note.notionUrl ? (
                        <a href={note.notionUrl} target="_blank" rel="noreferrer" className="text-[#97a4c2] hover:text-[#eef3fb] truncate">
                          {note.title}
                        </a>
                      ) : (
                        <span className="text-[#97a4c2] truncate">{note.title}</span>
                      )}
                    </div>
                    {excerpt && (
                      <p className="text-[11px] text-[#5a688c] mt-1 line-clamp-8 whitespace-pre-wrap">{excerpt}</p>
                    )}
                  </div>
                  )
                })}
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
          {sortedTasks.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5" />
                משימות ({sortedTasks.length})
              </h3>
              <div className="space-y-2">
                {sortedTasks.map((task) => (
                  <div key={task.id} className="flex flex-col gap-0.5 py-2 border-b border-[#223052] last:border-0">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleTaskDone.mutate({ id: task.id })
                        }}
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
                      <button
                        type="button"
                        className={cn(
                          'text-xs truncate flex-1 text-right hover:text-[#eef3fb] transition-colors',
                          task.done ? 'text-[#5a688c] line-through' : 'text-[#97a4c2]'
                        )}
                        onClick={() => {
                          setEditingTaskId(task.id)
                          setTaskModalOpen(true)
                        }}
                        title="פתח משימה"
                      >
                        {task.title}
                      </button>
                      {task.workspaceName && (
                        <WorkspacePill
                          workspace={{ id: task.workspaceId!, name: task.workspaceName, color: task.workspaceColor }}
                        />
                      )}
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

      <TaskModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false)
          setEditingTaskId(null)
          void utils.people.getRelated.invalidate({ id: personId })
        }}
        editingTaskId={editingTaskId}
        people={allPeople}
        meetings={allMeetings.map((m) => ({ id: m.id, title: m.title }))}
        projects={allProjects.map((p) => ({ id: p.id, name: p.name }))}
        workspaces={workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          hasNotionLink: ((w as { notionDatabases?: unknown[] }).notionDatabases?.length ?? 0) > 0,
        }))}
      />
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
