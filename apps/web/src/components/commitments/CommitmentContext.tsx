'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { trpc } from '@/lib/trpc'

/** Collapsed by default; the surrounding messages are only fetched once the user asks for them. */
export function CommitmentContext({ commitmentId, compact = false }: { commitmentId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const { data, isPending } = trpc.commitments.sourceContext.useQuery({ commitmentId }, { enabled: open })

  return (
    <div className={compact ? 'mt-0.5' : 'mt-1'}>
      <button
        type="button"
        className={compact ? 'text-[11px] text-[#5a688c] hover:text-[#97a4c2]' : 'btn-ghost text-[11px]'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="commitment-context-toggle"
      >
        {open ? 'הסתר הקשר' : 'הצג הקשר'}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded-md border border-[#223052] bg-[#131c33] p-2" data-testid="commitment-context">
          {isPending ? (
            <p className="text-xs text-[#5a688c]">טוען הקשר…</p>
          ) : !data || data.messages.length === 0 ? (
            <p className="text-xs text-[#5a688c]">ההודעות המקוריות כבר לא נשמרות.</p>
          ) : (
            data.messages.map((m) => (
              <p key={m.id} className={`text-xs ${m.isSource ? 'text-[#eef3fb]' : 'text-[#97a4c2]'}`}>
                <span className="text-[#5a688c] tabular-nums">{format(new Date(m.ts), 'HH:mm')} </span>
                <span className="font-medium">{m.speaker}: </span>
                {m.text}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  )
}
