'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

/**
 * Review queue for unconfirmed people (unknown calendar attendees).
 * Each row offers confirm / merge / ignore. Merge opens an inline person picker.
 */
export function PeopleReviewQueue() {
  const utils = trpc.useUtils()
  const { data: queue = [], isLoading, isError, refetch } = trpc.people.reviewQueue.useQuery()
  const [mergingId, setMergingId] = useState<string | null>(null)
  const [mergeSearch, setMergeSearch] = useState('')

  const invalidate = () => {
    void utils.people.reviewQueue.invalidate()
    void utils.people.listPaginated.invalidate()
    void utils.people.list.invalidate()
  }
  const confirm = trpc.people.confirm.useMutation({ onSuccess: invalidate })
  const ignore = trpc.people.ignore.useMutation({ onSuccess: invalidate })
  const merge = trpc.people.merge.useMutation({
    onSuccess: () => { invalidate(); setMergingId(null); setMergeSearch('') },
  })

  const { data: searchResults = [] } = trpc.people.search.useQuery(
    { query: mergeSearch },
    { enabled: mergingId !== null && mergeSearch.trim().length > 0 },
  )

  if (isLoading) {
    return (
      <div className="space-y-2 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-14 rounded-lg" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="card mt-4 text-center py-8">
        <p className="text-sm text-[#e57373] mb-3">טעינת התור נכשלה</p>
        <button className="btn btn-ghost" onClick={() => refetch()}>נסה שוב</button>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="card mt-4 text-center py-10">
        <p className="text-sm text-[#b8c4dc]">אין אנשים שממתינים לאישור ✓</p>
        <p className="text-xs text-[#5a688c] mt-1">אנשים לא מזוהים מהיומן יופיעו כאן</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 mt-4">
      {queue.map((p) => (
        <div key={p.id} className="card p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#eef3fb] truncate">{p.name}</span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: '#e8c54722', color: '#e8c547', border: '1px solid #e8c54733' }}
                >
                  לא מזוהה
                </span>
              </div>
              <div className="text-xs text-[#647399] mt-0.5" dir="ltr">
                {p.email || '—'}
                {p.meetingCount > 0 && <span className="text-[#5a688c]"> · {p.meetingCount} פגישות</span>}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                className="btn btn-primary text-xs py-1.5 px-3"
                onClick={() => confirm.mutate({ id: p.id })}
                disabled={confirm.isPending}
                aria-label={`אשר את ${p.name}`}
              >
                אשר
              </button>
              <button
                className="btn btn-ghost text-xs py-1.5 px-3"
                onClick={() => { setMergingId(mergingId === p.id ? null : p.id); setMergeSearch(p.suggestedMatch?.name ?? '') }}
                aria-label={`מזג את ${p.name}`}
              >
                מזג
              </button>
              <button
                className="btn btn-ghost text-xs py-1.5 px-3"
                onClick={() => ignore.mutate({ id: p.id })}
                disabled={ignore.isPending}
                aria-label={`התעלם מ-${p.name}`}
              >
                התעלם
              </button>
            </div>
          </div>

          {/* Merge picker */}
          {mergingId === p.id && (
            <div className="mt-3 pt-3 border-t border-[#1d2b46]">
              {p.suggestedMatch && (
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs text-[#7a89ab]">הצעה: {p.suggestedMatch.name}</span>
                  <button
                    className="btn btn-primary text-xs py-1 px-3"
                    onClick={() => merge.mutate({ fromId: p.id, toId: p.suggestedMatch!.id })}
                    disabled={merge.isPending}
                  >
                    מזג לכאן
                  </button>
                </div>
              )}
              <input
                className="input text-sm"
                placeholder="חפש איש קשר למיזוג…"
                value={mergeSearch}
                onChange={(e) => setMergeSearch(e.target.value)}
              />
              {mergeSearch.trim().length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg" style={{ border: '1px solid #29395d' }}>
                  {searchResults.filter((r) => r.id !== p.id).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[#5a688c]">לא נמצאו אנשי קשר</div>
                  ) : (
                    searchResults
                      .filter((r) => r.id !== p.id)
                      .map((r) => (
                        <button
                          key={r.id}
                          className="flex items-center justify-between gap-2 w-full px-3 py-2 text-right hover:bg-[#141f36] transition-colors"
                          onClick={() => merge.mutate({ fromId: p.id, toId: r.id })}
                          disabled={merge.isPending}
                        >
                          <span className="text-xs text-[#b8c4dc] truncate">{r.name}</span>
                          <span className="text-[11px] text-[#5a688c] shrink-0">מזג לכאן</span>
                        </button>
                      ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
