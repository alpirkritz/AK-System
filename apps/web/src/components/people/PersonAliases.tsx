'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { trpc } from '@/lib/trpc'

const ORIGIN_LABEL: Record<string, string> = {
  slack: 'סלאק', whatsapp: 'וואטסאפ', meeting: 'פגישה', email: 'מייל', notion: 'נושן', voice: 'הקלטה', analysis: 'ניתוח', calendar: 'יומן',
}

/** Other names for one person; every source that sees one of them resolves to this person. */
export function PersonAliases({ personId }: { personId: string }) {
  const utils = trpc.useUtils()
  const { data: aliases = [] } = trpc.people.aliases.list.useQuery({ personId })
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const refresh = () => utils.people.aliases.list.invalidate({ personId })
  const add = trpc.people.aliases.add.useMutation({
    onSuccess: () => { setDraft(''); setError(null); void refresh() },
    onError: (e) => setError(e.message),
  })
  const remove = trpc.people.aliases.remove.useMutation({ onSuccess: () => void refresh() })

  const submit = () => {
    if (!draft.trim()) return
    setError(null)
    add.mutate({ personId, alias: draft })
  }

  return (
    <section className="mb-5" data-testid="person-aliases">
      <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">שמות נוספים</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {aliases.map((a) => (
          <span key={a.id} className="filter-chip text-xs min-h-[28px] inline-flex items-center gap-1">
            {a.alias}
            {a.origin && <span className="text-[10px] text-[#5a688c]">{ORIGIN_LABEL[a.origin] ?? a.origin}</span>}
            <button
              type="button"
              aria-label={`הסר ${a.alias}`}
              className="text-[#5a688c] hover:text-[#e57373]"
              onClick={() => remove.mutate({ id: a.id })}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="input text-xs py-1 flex-1 min-w-[140px]"
          value={draft}
          placeholder="הוסף שם: ג׳ורדן, Jordan…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          onBlur={submit}
        />
      </div>
      {error && <p className="text-[11px] text-[#e57373] mt-1">{error}</p>}
    </section>
  )
}
