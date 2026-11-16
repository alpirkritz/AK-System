'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

/**
 * Memories linked to one person or project, with a one-line add that pre-links the entity.
 * Shown in the person drawer and on the project page (spec: hugo-entity-memory).
 */
export function EntityMemories({ kind, entityId }: { kind: 'person' | 'project'; entityId: string }) {
  const utils = trpc.useUtils()
  const filter = kind === 'person' ? { personId: entityId } : { projectId: entityId }
  const { data: rows = [], isLoading } = trpc.memory.memories.list.useQuery(filter)
  const [draft, setDraft] = useState('')
  const create = trpc.memory.memories.create.useMutation({
    onSuccess: () => {
      setDraft('')
      void utils.memory.memories.list.invalidate()
    },
  })

  return (
    <div className="space-y-2" data-testid={`entity-memories-${kind}`}>
      {isLoading ? (
        <p className="text-[11px] text-[#5a688c]">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-[#5a688c]">
          {kind === 'person' ? 'אין זיכרונות על האדם הזה עדיין.' : 'אין זיכרונות על הפרויקט הזה עדיין.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((m: { id: string; content: string; pinned: boolean }) => (
            <li key={m.id} className="text-xs text-[#cdd7ea] leading-relaxed whitespace-pre-wrap">
              {m.pinned && <span className="ml-1" aria-label="נעוץ">📌</span>}
              {m.content}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault()
          const content = draft.trim()
          if (!content) return
          create.mutate({ content, kind: 'memory', source: 'manual', links: [{ kind, entityId }] })
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="משהו שהוגו צריך לזכור…"
          className="input text-[12px] py-1.5 flex-1"
          dir="rtl"
          aria-label="זיכרון חדש"
        />
        <button type="submit" disabled={!draft.trim() || create.isPending} className="btn btn-primary text-[11px] py-1.5 px-3 disabled:opacity-40">
          {create.isPending ? 'שומר…' : 'זכור'}
        </button>
      </form>
      <Link href="/memory" className="text-[10px] text-[#5a688c] hover:text-[#97a4c2]">
        כל הזיכרונות ←
      </Link>
    </div>
  )
}
