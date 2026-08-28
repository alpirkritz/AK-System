'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

const COLOR_PRESETS = ['#f59e0b', '#e879f9', '#86efac', '#fcd34d', '#fca5a5', '#93c5fd'] as const

export function CustomCategoriesPanel() {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [color, setColor] = useState<string>(COLOR_PRESETS[0])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const categories = trpc.finance.listCategories.useQuery()
  const custom = (categories.data?.categories ?? []).filter((c) => !c.builtin)

  const create = trpc.finance.createCustomCategory.useMutation({
    onSuccess: () => {
      setLabel('')
      setError(null)
      utils.finance.listCategories.invalidate()
    },
    onError: (err) => setError(err.message),
  })

  const remove = trpc.finance.deleteCustomCategory.useMutation({
    onSuccess: () => {
      setConfirmDeleteId(null)
      utils.finance.listCategories.invalidate()
    },
    onError: (err) => setError(err.message),
  })

  return (
    <section className="mt-6 pt-4 border-t border-[#1d2b46]">
      <h3 className="text-sm font-semibold mb-1">קטגוריות מותאמות</h3>
      <p className="text-xs text-[#647399] mb-3">
        הוסף קטגוריות שלא מופיעות ברשימה המובנית — יופיעו בכל תפריטי הסיווג.
      </p>

      <div className="flex flex-col gap-2 mb-3">
        <input
          className="input"
          placeholder="שם הקטגוריה (למשל: חיות מחמד)"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="select"
            style={{ padding: '6px 10px', fontSize: 13, flex: 1 }}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'expense' | 'income')}
          >
            <option value="expense">הוצאה</option>
            <option value="income">הכנסה</option>
          </select>
          <div className="flex gap-1">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className="w-6 h-6 rounded-full border-2 shrink-0"
                style={{
                  background: c,
                  borderColor: color === c ? '#eef3fb' : 'transparent',
                }}
                aria-label={`צבע ${c}`}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <button
          className="btn btn-secondary"
          disabled={!label.trim() || create.isLoading}
          onClick={() => create.mutate({ label: label.trim(), kind, color })}
        >
          {create.isLoading ? 'מוסיף...' : 'הוסף קטגוריה'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-[#fb7185] mb-2" role="alert">
          {error}
        </p>
      )}

      {custom.length === 0 ? (
        <p className="text-xs text-[#647399]">עדיין אין קטגוריות מותאמות.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {custom.map((cat) => (
            <li
              key={cat.id}
              className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-2"
              style={{ background: '#1d2b46' }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: cat.color }}
              />
              <span className="text-[#eef3fb] flex-1 truncate">
                {cat.label}
                <span className="text-[#647399] mr-1">
                  ({cat.kind === 'income' ? 'הכנסה' : 'הוצאה'})
                </span>
              </span>
              {confirmDeleteId === cat.id ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost text-[#fb7185]"
                    onClick={() => cat.id && remove.mutate({ id: cat.id })}
                  >
                    מחק
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    ביטול
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0"
                  onClick={() => cat.id && setConfirmDeleteId(cat.id)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
