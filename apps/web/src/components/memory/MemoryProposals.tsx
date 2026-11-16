'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { MemoryLinkChipView, linkKey, type MemoryLinkChip } from './MemoryLinkEditor'

interface Proposal {
  id: string
  content: string
  links?: MemoryLinkChip[]
  evidence: string | null
  replacesMemoryId: string | null
}

function evidenceLabel(raw: string | null): string | null {
  if (!raw) return null
  try {
    const items = JSON.parse(raw) as Array<{ label: string; sourceDate: string }>
    return items.map((e) => `${e.label} · ${e.sourceDate.split('-').reverse().slice(0, 2).join('/')}`).join(', ') || null
  } catch {
    return null
  }
}

/** Memories the nightly distiller proposed, waiting for the owner (spec: memory-distiller). */
export function MemoryProposals() {
  const utils = trpc.useUtils()
  const { data = [], isLoading } = trpc.memory.memories.list.useQuery({ status: 'proposed', limit: 100 })
  const { data: active = [] } = trpc.memory.memories.list.useQuery({ limit: 500 })
  const [editing, setEditing] = useState<Record<string, string>>({})
  const refresh = () => {
    void utils.memory.memories.list.invalidate()
    void utils.memory.proposals.count.invalidate()
  }
  const accept = trpc.memory.proposals.accept.useMutation({ onSuccess: refresh })
  const reject = trpc.memory.proposals.reject.useMutation({ onSuccess: refresh })

  const rows = data as Proposal[]
  const byId = new Map((active as Array<{ id: string; content: string }>).map((m) => [m.id, m.content]))

  if (isLoading) return <div className="text-xs text-[#4d659c]">טוען…</div>
  if (rows.length === 0) {
    return <div className="card p-6 text-center text-sm text-[#5a688c]">אין הצעות חדשות. הן נוצרות כל לילה מהפגישות והשיחות של היום.</div>
  }

  return (
    <div className="space-y-3" data-testid="memory-proposals">
      <div className="flex justify-end">
        <button type="button" className="btn btn-ghost text-[11px] py-1 px-2" onClick={() => reject.mutate({ ids: rows.map((r) => r.id) })}>
          דחה הכל
        </button>
      </div>
      {rows.map((p) => {
        const isEditing = editing[p.id] !== undefined
        const replaced = p.replacesMemoryId ? byId.get(p.replacesMemoryId) : null
        const evidence = evidenceLabel(p.evidence)
        return (
          <div key={p.id} className="card p-4 space-y-2" data-testid="memory-proposal">
            {isEditing ? (
              <textarea
                value={editing[p.id]}
                onChange={(e) => setEditing((s) => ({ ...s, [p.id]: e.target.value }))}
                rows={3}
                className="input w-full text-[13px]"
                dir="rtl"
                aria-label="עריכת הצעה"
              />
            ) : (
              <div className="text-[13px] text-[#cdd7ea] leading-relaxed">{p.content}</div>
            )}
            {replaced && <div className="text-[12px] text-[#5a688c] line-through">{replaced}</div>}
            {(p.links ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(p.links ?? []).map((l) => (
                  <MemoryLinkChipView key={linkKey(l)} link={l} />
                ))}
              </div>
            )}
            {evidence && <div className="text-[11px] text-[#5a688c]">מתוך: {evidence}</div>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="btn btn-primary text-[11px] py-1.5 px-3"
                disabled={accept.isPending}
                onClick={() => accept.mutate({ id: p.id, ...(isEditing ? { content: editing[p.id] } : {}) })}
              >
                {isEditing ? 'שמור עריכה' : 'שמור'}
              </button>
              {!isEditing && (
                <button type="button" className="btn btn-ghost text-[11px] py-1.5 px-3" onClick={() => setEditing((s) => ({ ...s, [p.id]: p.content }))}>
                  ערוך ושמור
                </button>
              )}
              <button type="button" className="btn btn-ghost text-[11px] py-1.5 px-3" disabled={reject.isPending} onClick={() => reject.mutate({ ids: [p.id] })}>
                דחה
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
