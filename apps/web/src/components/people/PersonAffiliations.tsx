'use client'

import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/cn'
import {
  relationshipLabel,
  relationshipSuggestions,
  workspaceKindLabel,
  type Affiliation,
} from './affiliations'
import { ManagerPicker } from './ManagerPicker'

interface FormState {
  workspaceId: string
  relationshipType: string
  reportsTo: { id: string; name: string } | null
  notes: string
}

const EMPTY_FORM: FormState = { workspaceId: '', relationshipType: '', reportsTo: null, notes: '' }

/**
 * "שיוכים" — the life domains a person belongs to. A person can hold several at once
 * (e.g. a colleague at Dragontail and a friend in the personal workspace).
 */
export function PersonAffiliations({ personId }: { personId: string }) {
  const utils = trpc.useUtils()
  const { data: affiliations = [] } = trpc.people.affiliations.useQuery({ personId })
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery(undefined, { staleTime: 60_000 })
  const [form, setForm] = useState<FormState | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)

  const { data: workspaceMembers = [] } = trpc.people.listByWorkspace.useQuery(
    { workspaceId: form?.workspaceId ?? '' },
    { enabled: !!form?.workspaceId },
  )

  const refresh = async () => {
    await Promise.all([
      utils.people.affiliations.invalidate(),
      utils.people.listPaginated.invalidate(),
      utils.people.listByWorkspace.invalidate(),
    ])
  }

  const link = trpc.people.linkToWorkspace.useMutation({
    onSuccess: async () => {
      await refresh()
      setForm(null)
      setEditingWorkspaceId(null)
    },
  })
  const unlink = trpc.people.unlinkFromWorkspace.useMutation({ onSuccess: refresh })

  const takenWorkspaceIds = new Set(affiliations.map((a) => a.workspaceId))
  const availableWorkspaces = workspaces.filter((w) => !takenWorkspaceIds.has(w.id) || w.id === editingWorkspaceId)
  const selectedWorkspace = workspaces.find((w) => w.id === form?.workspaceId)
  const suggestions = relationshipSuggestions(selectedWorkspace?.kind)
  const managerOptions = workspaceMembers
    .filter((m) => m.person.id !== personId)
    .map((m) => ({ id: m.person.id, name: m.person.name, hint: m.relationshipType ? relationshipLabel(m.relationshipType) : null }))

  const startAdd = () => {
    setEditingWorkspaceId(null)
    setForm({ ...EMPTY_FORM, workspaceId: availableWorkspaces[0]?.id ?? '' })
  }

  const startEdit = (a: Affiliation) => {
    setEditingWorkspaceId(a.workspaceId)
    setForm({
      workspaceId: a.workspaceId,
      relationshipType: a.relationshipType,
      reportsTo: a.reportsToPersonId ? { id: a.reportsToPersonId, name: a.reportsToName ?? '' } : null,
      notes: a.notes ?? '',
    })
  }

  const cancel = () => {
    setForm(null)
    setEditingWorkspaceId(null)
    link.reset()
  }

  const save = () => {
    if (!form || !form.workspaceId || !form.relationshipType.trim()) return
    link.mutate({
      personId,
      workspaceId: form.workspaceId,
      relationshipType: form.relationshipType.trim(),
      reportsToPersonId: form.reportsTo?.id ?? null,
      notes: form.notes.trim() || null,
    })
  }

  return (
    <section className="mb-6" data-testid="person-affiliations">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider">
          שיוכים ({affiliations.length})
        </h3>
        {!form && availableWorkspaces.length > 0 && (
          <button type="button" className="btn btn-ghost text-xs py-1 px-2 min-h-[36px]" onClick={startAdd}>
            <Plus className="w-3.5 h-3.5" />
            שייך לעולם
          </button>
        )}
      </div>

      {affiliations.length === 0 && !form && (
        <p className="text-xs text-[#7a89ab]">
          עוד לא שויך לאף עולם. שיוך עוזר ל-Hugo להבין מי זה — עמית בדראגונטייל, שותף ב-DAZ או חבר.
        </p>
      )}

      {affiliations.length > 0 && (
        <ul className="space-y-2">
          {affiliations.map((a) => (
            <li
              key={a.id}
              className={cn(
                'rounded-lg border border-[#2f4368] bg-[#141f36] px-3 py-2.5 flex items-start gap-3',
                editingWorkspaceId === a.workspaceId && 'border-[#2dd4bf]',
              )}
            >
              <span
                className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: a.workspaceColor ?? '#2dd4bf' }}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#eef3fb] font-medium">
                  {a.workspaceName}
                  {a.workspaceKind && (
                    <span className="text-[#7a89ab] font-normal"> · {workspaceKindLabel(a.workspaceKind)}</span>
                  )}
                </div>
                <div className="text-xs text-[#97a4c2] mt-0.5">{relationshipLabel(a.relationshipType)}</div>
                {a.reportsToName && (
                  <div className="text-xs text-[#7a89ab] mt-0.5">מדווח ל: {a.reportsToName}</div>
                )}
                {a.notes && <p className="text-xs text-[#7a89ab] mt-1 whitespace-pre-wrap">{a.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  className="icon-btn min-w-[36px] min-h-[36px]"
                  aria-label={`ערוך שיוך ל${a.workspaceName}`}
                  onClick={() => startEdit(a)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="icon-btn min-w-[36px] min-h-[36px] hover:text-[#fb7185]"
                  aria-label={`הסר שיוך ל${a.workspaceName}`}
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate({ personId, workspaceId: a.workspaceId })}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="mt-3 rounded-lg border border-[#2f4368] bg-[#141f36] p-3 space-y-3" data-testid="affiliation-form">
          <div>
            <label className="label" htmlFor="affiliation-workspace">עולם</label>
            <select
              id="affiliation-workspace"
              className="input"
              value={form.workspaceId}
              disabled={!!editingWorkspaceId}
              onChange={(e) => setForm((f) => (f ? { ...f, workspaceId: e.target.value, reportsTo: null } : f))}
            >
              {availableWorkspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.kind ? ` · ${workspaceKindLabel(w.kind)}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="affiliation-relationship">סוג הקשר</label>
            <input
              id="affiliation-relationship"
              className="input"
              value={form.relationshipType}
              placeholder="בחר למטה או כתוב חופשי"
              onChange={(e) => setForm((f) => (f ? { ...f, relationshipType: e.target.value } : f))}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="filter-chip text-xs min-h-[32px]"
                  aria-pressed={form.relationshipType === s}
                  onClick={() => setForm((f) => (f ? { ...f, relationshipType: s } : f))}
                >
                  {relationshipLabel(s)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="affiliation-reports-to">מדווח ל (לא חובה)</label>
            <ManagerPicker
              personId={personId}
              members={managerOptions}
              value={form.reportsTo}
              onChange={(reportsTo) => setForm((f) => (f ? { ...f, reportsTo } : f))}
            />
          </div>

          <div>
            <label className="label" htmlFor="affiliation-notes">הערה לשיוך (לא חובה)</label>
            <input
              id="affiliation-notes"
              className="input"
              value={form.notes}
              onChange={(e) => setForm((f) => (f ? { ...f, notes: e.target.value } : f))}
            />
          </div>

          {link.error && <p className="text-xs text-[#fb7185]">{link.error.message}</p>}

          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-ghost min-h-[40px]" onClick={cancel}>ביטול</button>
            <button
              type="button"
              className="btn btn-primary min-h-[40px]"
              disabled={!form.workspaceId || !form.relationshipType.trim() || link.isPending}
              onClick={save}
            >
              {link.isPending ? 'שומר…' : 'שמור שיוך'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
