'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  DOCUMENT_CURRENCIES,
  SERVICE_UNITS,
  SERVICE_UNIT_LABELS,
  formatDocumentMoney,
} from '@ak-system/types'
import type { ServiceUnit } from '@ak-system/types'
import { trpc } from '@/lib/trpc'

type Draft = {
  name: string
  nameEn: string
  unit: ServiceUnit
  defaultUnitPrice: string
  currency: string
  vatApplicable: boolean
}

const EMPTY: Draft = {
  name: '',
  nameEn: '',
  unit: 'session',
  defaultUnitPrice: '',
  currency: 'ILS',
  vatApplicable: true,
}

export default function PricingSettingsPage() {
  const utils = trpc.useUtils()
  const [showInactive, setShowInactive] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: items = [], isLoading } = trpc.serviceItems.list.useQuery({
    includeInactive: showInactive,
  })

  const invalidate = () => {
    utils.serviceItems.list.invalidate()
    utils.serviceItems.pricesForClient.invalidate()
  }
  const create = trpc.serviceItems.create.useMutation({
    onSuccess: () => {
      setDraft(EMPTY)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err.message || 'הוספת הפריט נכשלה. נסה שוב.'),
  })
  const update = trpc.serviceItems.update.useMutation({
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    },
  })
  const archive = trpc.serviceItems.archive.useMutation({ onSuccess: invalidate })

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim() || create.isPending) return
    create.mutate({
      name: draft.name.trim(),
      nameEn: draft.nameEn.trim() || null,
      unit: draft.unit,
      defaultUnitPrice: parseFloat(draft.defaultUnitPrice) || 0,
      currency: draft.currency,
      vatApplicable: draft.vatApplicable,
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">קטלוג פריטים ותמחור</h1>
          <p className="text-xs text-[#5a688c] mt-1">
            ברירות מחדל בלבד. המחיר בפועל נשלף לפי מה שחויב אצל הלקוח הספציפי, וניתן תמיד לשינוי ידני.
          </p>
        </div>
        <Link className="btn btn-ghost text-sm" href="/finance?tab=documents">
          למסמכים
        </Link>
      </div>

      <form onSubmit={handleAdd} className="card flex flex-col gap-3 mb-6">
        <h2 className="font-semibold">פריט חדש</h2>
        {error && (
          <div
            role="alert"
            className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="item-name">
              שם הפריט
            </label>
            <input
              id="item-name"
              className="input"
              placeholder="לדוגמה: הרצאה"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="item-name-en">
              שם באנגלית
            </label>
            <input
              id="item-name-en"
              className="input"
              dir="ltr"
              value={draft.nameEn}
              onChange={(e) => setDraft((d) => ({ ...d, nameEn: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="item-unit">
              יחידה
            </label>
            <select
              id="item-unit"
              className="select"
              value={draft.unit}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value as ServiceUnit }))}
            >
              {SERVICE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {SERVICE_UNIT_LABELS[unit]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="item-price">
              מחיר ברירת מחדל
            </label>
            <input
              id="item-price"
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={draft.defaultUnitPrice}
              onChange={(e) => setDraft((d) => ({ ...d, defaultUnitPrice: e.target.value }))}
              required
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="label" htmlFor="item-currency">
              מטבע
            </label>
            <select
              id="item-currency"
              className="select"
              style={{ maxWidth: 110 }}
              value={draft.currency}
              onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
            >
              {DOCUMENT_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-[#7a89ab] cursor-pointer mt-5">
            <input
              type="checkbox"
              checked={!draft.vatApplicable}
              onChange={(e) => setDraft((d) => ({ ...d, vatApplicable: !e.target.checked }))}
            />
            פריט ללא מע"מ
          </label>
          <div className="flex-1" />
          <button type="submit" className="btn btn-primary text-sm mt-5" disabled={create.isPending}>
            {create.isPending ? 'מוסיף...' : '+ הוסף לקטלוג'}
          </button>
        </div>
      </form>

      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-xs text-[#7a89ab] cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          הצג גם פריטים בארכיון
        </label>
      </div>

      {isLoading ? (
        <div className="text-[#5a688c] text-sm">טוען...</div>
      ) : items.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">🏷️</div>
          <div className="text-[#5a688c] text-sm">הקטלוג ריק</div>
          <div className="text-xs text-[#4d659c] mt-1">
            אפשר גם להוסיף פריט תוך כדי כתיבת מסמך — הקטלוג הוא הצעה, לא חובה.
          </div>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="border-b border-[#29395d]">
                {['פריט', 'יחידה', 'מחיר ברירת מחדל', 'מע"מ', 'סטטוס'].map((header) => (
                  <th
                    key={header}
                    className="text-right px-4 py-3 text-[11px] font-medium text-[#5a688c] uppercase"
                  >
                    {header}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[#1d2b46] hover:bg-[#1d2b46] transition-colors group"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{item.name}</div>
                    {item.nameEn && <div className="text-[11px] text-[#5a688c]">{item.nameEn}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#647399]">
                    {SERVICE_UNIT_LABELS[item.unit as ServiceUnit] ?? item.unit}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {editingId === item.id ? (
                      <div className="flex gap-2">
                        <input
                          className="input"
                          style={{ maxWidth: 120 }}
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={`מחיר חדש ל${item.name}`}
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                        />
                        <button
                          className="btn btn-primary text-[11px] py-1 px-2"
                          onClick={() =>
                            update.mutate({
                              id: item.id,
                              defaultUnitPrice: parseFloat(editPrice) || 0,
                            })
                          }
                        >
                          שמור
                        </button>
                        <button
                          className="btn btn-ghost text-[11px] py-1 px-2"
                          onClick={() => setEditingId(null)}
                        >
                          ביטול
                        </button>
                      </div>
                    ) : (
                      formatDocumentMoney(
                        parseFloat(item.defaultUnitPrice) || 0,
                        item.currency,
                        'he'
                      )
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#647399]">{item.vatApplicable ? 'חייב' : 'פטור'}</td>
                  <td className="px-4 py-3">
                    <span
                      className="pill text-xs"
                      style={{
                        color: item.isActive ? '#2dd4bf' : '#647399',
                        borderColor: item.isActive ? '#2dd4bf44' : '#2f4368',
                      }}
                    >
                      {item.isActive ? 'פעיל' : 'בארכיון'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {editingId !== item.id && (
                        <button
                          className="btn btn-ghost text-[11px] py-1 px-2"
                          onClick={() => {
                            setEditingId(item.id)
                            setEditPrice(item.defaultUnitPrice)
                          }}
                        >
                          שנה מחיר
                        </button>
                      )}
                      {item.isActive ? (
                        <button
                          className="btn btn-ghost text-[11px] py-1 px-2"
                          onClick={() => archive.mutate({ id: item.id })}
                        >
                          העבר לארכיון
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost text-[11px] py-1 px-2"
                          onClick={() => update.mutate({ id: item.id, isActive: true })}
                        >
                          שחזר
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
