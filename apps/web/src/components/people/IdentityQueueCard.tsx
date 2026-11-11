'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

const SOURCE_LABEL: Record<string, string> = {
  meeting: 'פגישה', whatsapp: 'וואטסאפ', notion: 'נושן', email: 'מייל', voice: 'הקלטה', analysis: 'ניתוח פגישה', slack: 'סלאק',
}

/** One unplaced name at a time: "זה ירדן?" answered once, remembered for good. */
export function IdentityQueueCard() {
  const utils = trpc.useUtils()
  const { data: item } = trpc.people.identityQueue.next.useQuery()
  const { data: count = 0 } = trpc.people.identityQueue.count.useQuery()
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { data: results = [] } = trpc.people.search.useQuery({ query }, { enabled: picking && query.trim().length > 0 })

  const done = () => {
    setPicking(false); setQuery(''); setError(null)
    void utils.people.identityQueue.invalidate()
    void utils.people.list.invalidate()
    void utils.insights.personContext.invalidate()
  }
  const answer = trpc.people.identityQueue.answer.useMutation({ onSuccess: done, onError: (e) => setError(e.message) })

  if (!item) return null
  const where = [SOURCE_LABEL[item.source] ?? item.source, item.context].filter(Boolean).join(' · ')

  return (
    <section className="card p-3 mb-4 text-sm" data-testid="identity-queue-card">
      <p className="text-[#eef3fb]">
        {item.candidate && item.email
          ? <>״{item.name}״. לצרף את הכתובת ל<strong>{item.candidate.name}</strong>?</>
          : item.candidate ? <>״{item.name}״. זה <strong>{item.candidate.name}</strong>?</> : <>מי זה ״{item.name}״?</>}
        {count > 1 && <span className="text-[11px] text-[#5a688c] ms-2">עוד {count - 1} בתור</span>}
      </p>
      {item.email && <p className="text-[11px] text-[#8fa0c4] mt-0.5 ltr-text" dir="ltr">{item.email}</p>}
      {where && <p className="text-[11px] text-[#5a688c] mt-0.5">{where}</p>}
      <div className="flex flex-wrap gap-2 mt-2">
        {item.candidate && (
          <button className="btn btn-primary text-xs" disabled={answer.isPending}
            onClick={() => answer.mutate({ id: item.id, action: 'link', personId: item.candidate!.id })}>כן</button>
        )}
        <button className="btn btn-ghost text-xs" disabled={answer.isPending}
          onClick={() => answer.mutate({ id: item.id, action: 'new' })}>אדם חדש</button>
        <button className="btn btn-ghost text-xs" onClick={() => setPicking((v) => !v)}>אחר…</button>
        <button className="btn btn-ghost text-xs ms-auto" disabled={answer.isPending}
          onClick={() => answer.mutate({ id: item.id, action: 'dismiss' })}>התעלם</button>
      </div>
      {picking && (
        <div className="mt-2">
          <input className="input text-xs" autoFocus placeholder="חפש אדם…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul className="mt-1 space-y-1">
            {results.slice(0, 5).map((p) => (
              <li key={p.id}>
                <button className="btn btn-ghost text-xs w-full justify-start"
                  onClick={() => answer.mutate({ id: item.id, action: 'link', personId: p.id })}>{p.name}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-[11px] text-[#e57373] mt-1">{error}</p>}
    </section>
  )
}
