'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import {
  WaitingView as WaitingViewList, flattenWaiting, groupByPerson,
  type WaitingView,
} from '@/components/waiting/WaitingList'
import { useCommitmentEditor } from '@/components/waiting/useCommitmentEditor'

const VIEWS: { id: WaitingView; label: string }[] = [
  { id: 'today', label: 'היום' },
  { id: 'person', label: 'לפי אדם' },
  { id: 'time', label: 'לפי זמן' },
]

export default function WaitingPage() {
  const { data: buckets, isLoading } = trpc.waiting.list.useQuery()
  const [view, setView] = useState<WaitingView>('today')
  const [personId, setPersonId] = useState<string | null>(null)
  const editor = useCommitmentEditor()

  const all = buckets ? flattenWaiting(buckets) : []
  const people = groupByPerson(all)
  const filtered = buckets && personId
    ? Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.filter((i) => i.personId === personId)])) as typeof buckets
    : buckets

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-[#eef3fb]">חייבים לי</h1>
        {all.length > 0 && <span className="pill">{all.length}</span>}
        <div className="flex gap-1 ms-auto" role="tablist" aria-label="תצוגה">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={`btn text-xs py-1 px-3 ${view === v.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {people.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="סינון לפי אדם">
          <button type="button" className={`filter-chip text-xs ${personId === null ? 'active' : ''}`} aria-pressed={personId === null} onClick={() => setPersonId(null)}>
            כולם
          </button>
          {people.map((p) => (
            <button
              key={p.personId}
              type="button"
              className={`filter-chip text-xs ${personId === p.personId ? 'active' : ''}`}
              aria-pressed={personId === p.personId}
              onClick={() => setPersonId(personId === p.personId ? null : p.personId)}
            >
              {p.personName}
            </button>
          ))}
        </div>
      )}

      {isLoading || !filtered ? (
        <p className="text-sm text-[#5a688c]">טוען…</p>
      ) : all.length === 0 ? (
        <div className="card text-sm text-[#97a4c2]" data-testid="waiting-empty">
          אף אחד לא חייב לך משהו כרגע. משימות שמשויכות לאחרים, והתחייבויות שלהם, יופיעו כאן.
        </div>
      ) : (
        <div className="card p-4" data-testid="waiting-list">
          {editor.modal}
          <WaitingViewList buckets={filtered} view={view} onOpenCommitment={editor.open} />
        </div>
      )}
    </div>
  )
}
