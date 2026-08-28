'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { CategorySelect } from './CategorySelect'
import { fmt, fmtDate } from '../lib/format'

/**
 * Drill-down: which rows are inside the month KPI vs excluded as internal.
 * Inline category change fixes wrong tags without leaving insights.
 */
export function MonthCompositionPanel({
  open,
  onClose,
  month,
}: {
  open: boolean
  onClose: () => void
  month: string
}) {
  const [applyToSimilar, setApplyToSimilar] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const utils = trpc.useUtils()

  const composition = trpc.finance.analytics.monthComposition.useQuery(
    { month, direction: 'expense' },
    { enabled: open },
  )

  const setCategory = trpc.finance.setTransactionCategory.useMutation({
    onSuccess: (res) => {
      setNote(res.updated > 1 ? `עודכנו ${res.updated} תנועות` : 'הקטגוריה עודכנה')
      utils.finance.analytics.invalidate()
      utils.finance.getSummary.invalidate()
      utils.finance.listTransactions.invalidate()
    },
    onError: (err) => setNote(err.message),
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2500)
    return () => clearTimeout(t)
  }, [note])

  if (!open) return null

  const data = composition.data

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="ממה מורכב הסכום">
        <div className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold tracking-tight">ממה מורכב הסכום</h2>
            <button className="btn btn-ghost" onClick={onClose} aria-label="סגור">
              ✕
            </button>
          </div>
          <p className="text-xs text-[#647399] mb-4 leading-relaxed">
            הוצאות שנכללות ב־KPI לעומת תנועות שהוחרגו (העברות / חיובי אשראי) כדי למנוע כפל.
            אפשר לשנות תיוג ישירות כאן.
          </p>

          <label className="flex items-center gap-2 text-xs text-[#97a4c2] mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={applyToSimilar}
              onChange={(e) => setApplyToSimilar(e.target.checked)}
            />
            החל גם על תנועות דומות (לומד כלל)
          </label>

          {note && (
            <div className="mb-3 text-xs px-3 py-2 rounded-lg" style={{ background: '#34d39911', color: '#34d399' }}>
              {note}
            </div>
          )}

          {composition.isLoading ? (
            <div className="text-sm text-[#5a688c]">טוען...</div>
          ) : (
            <>
              <Section
                title={`נכלל ב־KPI — ${fmt(data?.includedTotal ?? 0)}`}
                empty="אין הוצאות נספרות בחודש הזה"
                rows={data?.included ?? []}
                onChangeCategory={(id, category) =>
                  setCategory.mutate({ id, category, applyToSimilar })
                }
                pending={setCategory.isPending}
              />
              <Section
                title={`הוחרג — ${fmt(data?.excludedTotal ?? 0)}`}
                empty="אין תנועות מוחרגות"
                rows={data?.excluded ?? []}
                onChangeCategory={(id, category) =>
                  setCategory.mutate({ id, category, applyToSimilar })
                }
                pending={setCategory.isPending}
                muted
              />
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function Section({
  title,
  empty,
  rows,
  onChangeCategory,
  pending,
  muted,
}: {
  title: string
  empty: string
  rows: Array<{
    id: string
    date: string
    description: string | null
    category: string | null
    amount: number
  }>
  onChangeCategory: (id: string, category: string) => void
  pending: boolean
  muted?: boolean
}) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold mb-2" style={{ color: muted ? '#fb7185' : '#eef3fb' }}>
        {title}
      </h3>
      {rows.length === 0 ? (
        <div className="text-xs text-[#5a688c]">{empty}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg px-3 py-2 text-xs"
              style={{ background: '#121a2b', border: '1px solid #1d2b46' }}
            >
              <div className="flex justify-between gap-2 mb-1">
                <span className="text-[#647399]">{fmtDate(r.date)}</span>
                <span className="font-semibold" style={{ color: muted ? '#fb7185' : '#eef3fb' }}>
                  {fmt(r.amount)}
                </span>
              </div>
              <div className="text-[#97a4c2] mb-2 break-words">{r.description || '—'}</div>
              <CategorySelect
                className="input text-xs w-full"
                value={r.category ?? 'אחר'}
                disabled={pending}
                aria-label="שנה קטגוריה"
                onChange={(category) => onChangeCategory(r.id, category)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
