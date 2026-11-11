'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Merge } from 'lucide-react'
import { trpc } from '@/lib/trpc'

type Pair = { personA: { id: string; name: string }; personB: { id: string; name: string } }

function pairKey(p: Pair) {
  return `${p.personA.id}|${p.personB.id}`
}

function confidenceLabel(c: number): string {
  if (c >= 0.95) return 'כמעט בטוח'
  if (c >= 0.8) return 'סביר'
  return 'אולי'
}

export default function PeopleDuplicatesPage() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.people.findDuplicates.useQuery()
  const pairs = data?.pairs ?? []
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = pairs.find((p) => pairKey(p) === selectedKey) ?? pairs[0] ?? null
  const [keepId, setKeepId] = useState<string | null>(null)

  const compare = trpc.people.compareDuplicates.useQuery(
    { personIdA: selected?.personA.id ?? '', personIdB: selected?.personB.id ?? '' },
    { enabled: !!selected },
  )
  const done = () => {
    setKeepId(null)
    setSelectedKey(null)
    utils.people.findDuplicates.invalidate()
    utils.people.list.invalidate()
  }
  const merge = trpc.people.merge.useMutation({ onSuccess: done })
  const notDuplicate = trpc.people.markNotDuplicate.useMutation({ onSuccess: done })

  const cmp = compare.data
  const kept = keepId && cmp ? (cmp.a.person.id === keepId ? cmp.a : cmp.b) : null
  const dropped = keepId && cmp ? (cmp.a.person.id === keepId ? cmp.b : cmp.a) : null

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Link href="/people" className="btn btn-ghost text-xs py-1 px-2 inline-flex items-center gap-1">
          <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          אנשי קשר
        </Link>
        <h1 className="text-lg font-semibold text-[#eef3fb]">כפילויות חשודות</h1>
        {pairs.length > 0 && <span className="pill">{pairs.length}</span>}
      </div>

      {isLoading ? (
        <p className="text-sm text-[#5a688c]">מחפש כפילויות…</p>
      ) : pairs.length === 0 ? (
        <div className="card text-sm text-[#97a4c2]" data-testid="duplicates-empty">אין כפילויות חשודות. כל אנשי הקשר נראים ייחודיים.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(220px,300px)_1fr]">
          <ul className="card p-1.5 space-y-0.5 h-fit" data-testid="duplicates-list">
            {pairs.map((p) => {
              const active = selected && pairKey(p) === pairKey(selected)
              return (
                <li key={pairKey(p)}>
                  <button
                    type="button"
                    onClick={() => { setSelectedKey(pairKey(p)); setKeepId(null) }}
                    className={`w-full text-start rounded-md px-2.5 py-2 text-xs transition-colors ${active ? 'bg-[#1a2744] text-[#eef3fb]' : 'text-[#b8c4dc] hover:bg-[#141f36]'}`}
                    aria-current={active ? 'true' : undefined}
                  >
                    <span className="block truncate">{p.personA.name} · {p.personB.name}</span>
                    <span className="text-[#5a688c]">{confidenceLabel(p.confidence)} · {p.reasons.join(', ')}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          {selected && (
            <div className="card" data-testid="duplicates-compare">
              {!cmp ? (
                <p className="text-sm text-[#5a688c]">טוען השוואה…</p>
              ) : (
                <>
                  <p className="text-xs text-[#97a4c2] mb-3">{cmp.reasons.join(' · ')}. בחר איזה כרטיס נשאר; השני יתמזג לתוכו.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[cmp.a, cmp.b].map((side) => (
                      <div
                        key={side.person.id}
                        className="rounded-lg p-3 text-xs space-y-1.5"
                        style={{ background: '#141f36', border: `1px solid ${keepId === side.person.id ? '#2dd4bf' : '#29395d'}` }}
                      >
                        <div className="text-sm font-semibold text-[#eef3fb]">{side.person.name}</div>
                        <Field label="אימייל" value={side.person.email} />
                        <Field label="טלפון" value={side.person.phone} />
                        <Field label="חברה" value={side.person.company} />
                        <Field label="תפקיד" value={side.person.role ?? side.person.jobTitle} />
                        <Field label="סטטוס" value={side.person.status === 'confirmed' ? 'מאושר' : side.person.status === 'unconfirmed' ? 'לאישור' : side.person.status} />
                        <div className="text-[#97a4c2]">
                          {side.meetingCount} פגישות · {side.taskCount} משימות · {side.notionNoteCount} סיכומי נושן · {side.circleCount} חוגים
                          {side.whatsappJids.length > 0 && ` · ${side.whatsappJids.length} וואטסאפ`}
                        </div>
                        {side.meetings.length > 0 && (
                          <ul className="text-[#5a688c] space-y-0.5">
                            {side.meetings.slice(0, 4).map((m) => (
                              <li key={m.id} className="truncate">{new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.title}</li>
                            ))}
                          </ul>
                        )}
                        {side.externalIds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {side.externalIds.map((x) => <span key={`${x.provider}-${x.externalId}`} className="pill text-[10px]">{x.provider}</span>)}
                          </div>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary text-xs py-1 px-2.5 mt-1 inline-flex items-center gap-1"
                          onClick={() => setKeepId(side.person.id)}
                          aria-pressed={keepId === side.person.id}
                        >
                          <Merge className="w-3.5 h-3.5" aria-hidden />
                          השאר את הכרטיס הזה
                        </button>
                      </div>
                    ))}
                  </div>

                  {kept && dropped ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-xs" style={{ background: 'rgba(45,212,191,0.08)', border: '1px solid rgba(45,212,191,0.35)' }}>
                      <span className="flex-1 min-w-0 text-[#b8c4dc]">
                        {dropped.person.name} יתמזג לתוך {kept.person.name}: הפגישות, המשימות, החוגים והוואטסאפ עוברים, ושדות חסרים יושלמו.
                      </span>
                      <button type="button" className="btn btn-ghost text-xs py-1 px-2.5" onClick={() => setKeepId(null)}>ביטול</button>
                      <button
                        type="button"
                        className="btn btn-primary text-xs py-1 px-2.5"
                        disabled={merge.isPending}
                        onClick={() => merge.mutate({ fromId: dropped.person.id, toId: kept.person.id })}
                      >
                        {merge.isPending ? 'ממזג…' : 'מזג וזכור את השם'}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        className="btn btn-ghost text-xs py-1 px-2.5"
                        disabled={notDuplicate.isPending}
                        onClick={() => notDuplicate.mutate({ personIdA: cmp.a.person.id, personIdB: cmp.b.person.id })}
                      >
                        לא כפילות
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <span className="text-[#5a688c] w-12 shrink-0">{label}</span>
      <span className={value ? 'text-[#b8c4dc] truncate' : 'text-[#435a8c]'}>{value || '—'}</span>
    </div>
  )
}
