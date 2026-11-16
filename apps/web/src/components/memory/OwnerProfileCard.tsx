'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { SearchableAddSelect } from '@/components/ui/SearchableAddSelect'

interface Priority {
  id?: string
  title: string
  projectId?: string | null
  workspaceId?: string | null
  until?: string | null
}

const MAX = 7

/** "מי אני ומה חשוב עכשיו" — roles, ordered priorities, principles (spec: owner-priorities-profile). */
export function OwnerProfileCard() {
  const utils = trpc.useUtils()
  const { data } = trpc.ownerProfile.get.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const [roles, setRoles] = useState('')
  const [principles, setPrinciples] = useState('')
  const [priorities, setPriorities] = useState<Priority[]>([])
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data && !dirty) {
      setRoles(data.roles)
      setPrinciples(data.principles)
      setPriorities(data.priorities)
    }
  }, [data, dirty])

  const save = trpc.ownerProfile.set.useMutation({
    onSuccess: () => {
      setDirty(false)
      void utils.ownerProfile.get.invalidate()
    },
  })

  const update = (next: Priority[]) => {
    setPriorities(next)
    setDirty(true)
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= priorities.length) return
    const next = [...priorities]
    ;[next[i], next[j]] = [next[j], next[i]]
    update(next)
  }
  const ageDays = data?.updatedAt ? Math.floor((Date.now() - new Date(data.updatedAt).getTime()) / 86400000) : null
  const projectName = (id?: string | null) => (projects as Array<{ id: string; name: string }>).find((p) => p.id === id)?.name

  return (
    <div className="card p-5 mb-6 space-y-4" data-testid="owner-profile-card">
      <div>
        <div className="text-sm font-semibold text-[#cdd7ea]">מי אני ומה חשוב עכשיו</div>
        <div className="text-xs text-[#5a688c] mt-0.5">
          כל הסוכנים רואים את זה. הוגו מדרג כל מה שהוא אומר לך מול העדיפויות, לפי הסדר.
          {ageDays !== null && ` · עודכן לפני ${ageDays} ימים`}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-[#97a4c2]">תפקידים</span>
        <textarea
          value={roles}
          onChange={(e) => {
            setRoles(e.target.value)
            setDirty(true)
          }}
          rows={2}
          maxLength={1000}
          placeholder="לדוגמה: CTO ב-Dragontail; יועץ עצמאי; שותף ב-DAZ"
          className="input w-full text-[13px]"
          dir="rtl"
        />
      </label>

      <div className="space-y-2">
        <span className="text-[11px] text-[#97a4c2]">עדיפויות (עד {MAX}, החשובה ראשונה)</span>
        <ol className="space-y-1.5">
          {priorities.map((p, i) => (
            <li key={p.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#29395d] px-2 py-1.5" data-testid="owner-priority">
              <span className="text-[12px] text-[#5a688c] w-4 text-center">{i + 1}</span>
              <span className="text-[13px] text-[#cdd7ea] flex-1 min-w-[120px]">{p.title}</span>
              {p.projectId ? (
                <span className="text-[11px] text-[#97e6da]">📁 {projectName(p.projectId) ?? 'פרויקט'}</span>
              ) : (
                <div className="min-w-[140px]">
                  <SearchableAddSelect
                    id={`priority-project-${i}`}
                    options={(projects as Array<{ id: string; name: string }>).map((pr) => ({ id: pr.id, name: pr.name }))}
                    triggerLabel="קשר לפרויקט…"
                    onAdd={(projectId) => update(priorities.map((x, k) => (k === i ? { ...x, projectId } : x)))}
                  />
                </div>
              )}
              <input
                type="date"
                value={p.until ?? ''}
                onChange={(e) => update(priorities.map((x, k) => (k === i ? { ...x, until: e.target.value || null } : x)))}
                className="input text-[11px] py-0.5 w-auto"
                aria-label={`עד מתי — ${p.title}`}
              />
              <button type="button" className="btn btn-ghost p-1" onClick={() => move(i, -1)} aria-label="העלה" disabled={i === 0}>
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="btn btn-ghost p-1" onClick={() => move(i, 1)} aria-label="הורד" disabled={i === priorities.length - 1}>
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="btn btn-ghost p-1" onClick={() => update(priorities.filter((_, k) => k !== i))} aria-label={`הסר ${p.title}`}>
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ol>
        {priorities.length < MAX && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const title = draft.trim()
              if (!title) return
              update([...priorities, { title }])
              setDraft('')
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={120}
              placeholder="עדיפות חדשה…"
              className="input text-[13px] flex-1"
              dir="rtl"
              aria-label="עדיפות חדשה"
            />
            <button type="submit" className="btn btn-ghost text-[12px] py-1.5 px-3" disabled={!draft.trim()}>
              הוסף
            </button>
          </form>
        )}
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-[#97a4c2]">עקרונות</span>
        <textarea
          value={principles}
          onChange={(e) => {
            setPrinciples(e.target.value)
            setDirty(true)
          }}
          rows={2}
          maxLength={1500}
          placeholder="לדוגמה: משפחה לפני 19:00; לא מתחייב בלי לבדוק עומס"
          className="input w-full text-[13px]"
          dir="rtl"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate({ roles, principles, priorities })}
          disabled={!dirty || save.isPending}
          className="btn btn-primary text-[12px] py-2 px-4 disabled:opacity-40"
        >
          {save.isPending ? 'שומר…' : 'שמור'}
        </button>
        {dirty && <span className="text-[11px] text-[#2dd4bf]">שינויים לא שמורים</span>}
        {save.error && <span className="text-[11px] text-red-400" role="alert">השמירה נכשלה: {save.error.message}</span>}
      </div>
    </div>
  )
}
