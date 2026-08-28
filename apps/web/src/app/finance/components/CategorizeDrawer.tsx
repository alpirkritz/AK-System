'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { fmt, fmtDate } from '../lib/format'
import { CategorySelect } from './CategorySelect'
import { CustomCategoriesPanel } from './CustomCategoriesPanel'

/**
 * Row shape stated explicitly: tRPC's inference for this query collapses to `any` because
 * the Drizzle select type is a union of the SQLite and Postgres builders.
 */
interface UncategorizedRow {
  id: string
  description: string | null
  amount: string
  currency: string
  direction: string
  transactionDate: string
}

/**
 * Categorize the backlog and manage the rules learned along the way.
 *
 * Picking a category commits immediately — with a backlog of a few hundred rows, a
 * per-row save button would triple the work for no added safety, since every change is
 * reversible by picking again.
 */
export function CategorizeDrawer({
  open,
  onClose,
  initialSection = 'categorize',
}: {
  open: boolean
  onClose: () => void
  /** Which panel to show when the drawer opens. */
  initialSection?: 'categorize' | 'categories'
}) {
  const [section, setSection] = useState<'categorize' | 'categories'>(initialSection)
  const [applyToSimilar, setApplyToSimilar] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirmRuleId, setConfirmRuleId] = useState<string | null>(null)

  const utils = trpc.useUtils()

  const uncategorized = trpc.finance.listTransactions.useQuery(
    { uncategorized: true, limit: 200 },
    { enabled: open }
  )
  const rules = trpc.finance.analytics.listCategoryRules.useQuery(undefined, { enabled: open })

  const invalidateAnalytics = () => {
    utils.finance.analytics.invalidate()
    utils.finance.listTransactions.invalidate()
    utils.finance.getSummary.invalidate()
  }

  const setCategory = trpc.finance.setTransactionCategory.useMutation({
    onSuccess: (res) => {
      setNote(res.updated > 1 ? `סווגו ${res.updated} תנועות` : 'סווג')
      setPendingId(null)
      invalidateAnalytics()
    },
    onError: (err) => {
      setNote(err.message)
      setPendingId(null)
    },
  })

  const backfill = trpc.finance.categorizeBacklog.useMutation({
    onSuccess: (res) => {
      setNote(`סווגו ${res.updated} תנועות אוטומטית`)
      invalidateAnalytics()
    },
    onError: (err) => setNote(err.message),
  })

  const deleteRule = trpc.finance.analytics.deleteCategoryRule.useMutation({
    onSuccess: () => {
      setConfirmRuleId(null)
      utils.finance.analytics.listCategoryRules.invalidate()
    },
  })

  // Escape closes, matching every other overlay in the app.
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

  useEffect(() => {
    if (open) setSection(initialSection)
  }, [open, initialSection])

  if (!open) return null

  const rows = (uncategorized.data ?? []) as UncategorizedRow[]

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="סיווג תנועות">
        <div className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold tracking-tight">סיווג תנועות</h2>
            <button className="btn btn-ghost" onClick={onClose} aria-label="סגור">
              ✕
            </button>
          </div>
          <p className="text-xs text-[#647399] mb-4">
            סיווג התנועות הוא מה שמאפשר לפילוח ולתובנות להיות מדויקים.
          </p>

          <div
            className="flex gap-1 mb-4 border-b border-[#1d2b46]"
            role="tablist"
            aria-label="סיווג וקטגוריות"
          >
            {(
              [
                ['categorize', 'סיווג תנועות'],
                ['categories', 'קטגוריות מותאמות'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={section === id}
                className="btn btn-ghost text-sm px-3 py-2 rounded-b-none"
                style={{
                  borderBottom:
                    section === id ? '2px solid #2dd4bf' : '2px solid transparent',
                  color: section === id ? '#2dd4bf' : '#647399',
                }}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {section === 'categories' ? (
            <CustomCategoriesPanel embedded />
          ) : (
            <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              className="btn btn-primary"
              onClick={() => backfill.mutate({ dryRun: false })}
              disabled={backfill.isLoading}
            >
              {backfill.isLoading ? 'מסווג...' : 'סווג אוטומטית'}
            </button>
            <label className="flex items-center gap-2 text-xs text-[#97a4c2] cursor-pointer">
              <input
                type="checkbox"
                checked={applyToSimilar}
                onChange={(e) => setApplyToSimilar(e.target.checked)}
              />
              החל על תנועות דומות בעתיד
            </label>
          </div>

          {note && (
            <div
              className="text-xs px-3 py-2 rounded-lg mb-4"
              style={{ background: '#2dd4bf11', color: '#2dd4bf', border: '1px solid #2dd4bf33' }}
              role="status"
            >
              {note}
            </div>
          )}

          <h3 className="text-sm font-semibold mb-2">
            ללא סיווג {rows.length > 0 && <span className="text-[#647399]">({rows.length})</span>}
          </h3>

          {uncategorized.isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-12 rounded-lg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-[#647399] mb-6">
              כל התנועות מסווגות. הפילוח והתובנות מבוססים על נתונים מלאים.
            </div>
          ) : (
            <ul className="flex flex-col gap-2 mb-6">
              {rows.map((row) => (
                <li key={row.id} className="rounded-lg p-2.5" style={{ background: '#1d2b46' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm text-[#eef3fb] truncate flex-1">
                      {row.description || 'ללא תיאור'}
                    </span>
                    <span
                      className="text-sm font-semibold shrink-0"
                      style={{ color: row.direction === 'income' ? '#34d399' : '#fb7185' }}
                    >
                      {row.direction === 'income' ? '+' : '−'}
                      {fmt(Number(row.amount) || 0, row.currency)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[#647399] shrink-0">
                      {fmtDate(row.transactionDate)}
                    </span>
                    <CategorySelect
                      style={{ padding: '6px 10px', fontSize: 13 }}
                      defaultValue=""
                      disabled={pendingId === row.id}
                      aria-label={`קטגוריה עבור ${row.description || 'תנועה'}`}
                      onChange={(category) => {
                        setPendingId(row.id)
                        setCategory.mutate({
                          id: row.id,
                          category,
                          applyToSimilar,
                        })
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="text-sm font-semibold mb-2">כללים שנלמדו</h3>
          {(rules.data?.rules ?? []).length === 0 ? (
            <p className="text-xs text-[#647399]">
              עדיין אין כללים. סיווג עם &quot;החל על תנועות דומות&quot; ייצור כלל.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(rules.data?.rules ?? []).map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-2"
                  style={{ background: '#1d2b46' }}
                >
                  <span className="text-[#97a4c2] truncate flex-1">
                    &quot;{rule.pattern}&quot; → {rule.category}
                  </span>
                  {confirmRuleId === rule.id ? (
                    <>
                      <span className="text-[#647399] shrink-0">
                        למחוק את הכלל? תנועות שסווגו כבר יישארו כפי שהן.
                      </span>
                      <button
                        className="btn btn-ghost shrink-0"
                        style={{ color: '#fb7185', borderColor: '#fb718533' }}
                        onClick={() => deleteRule.mutate({ id: rule.id })}
                      >
                        מחק
                      </button>
                      <button
                        className="btn btn-ghost shrink-0"
                        onClick={() => setConfirmRuleId(null)}
                      >
                        ביטול
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost shrink-0"
                      onClick={() => setConfirmRuleId(rule.id)}
                    >
                      מחק
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
