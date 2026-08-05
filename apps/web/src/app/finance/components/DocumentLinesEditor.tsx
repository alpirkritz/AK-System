'use client'

import { useMemo } from 'react'
import { PRICE_SOURCE_LABELS, computeLineTotal, formatDocumentMoney } from '@ak-system/types'
import type { PriceSource, ServiceUnit } from '@ak-system/types'

export type LineDraft = {
  key: string
  serviceItemId: string | null
  description: string
  quantity: string
  unitPrice: string
  discountPercent: string
  vatApplicable: boolean
  priceSource: PriceSource
  /** Once true the system stops filling this price — a typed amount is never overwritten. */
  priceEditedManually: boolean
  priceHintDate?: string
  currencyMismatch?: boolean
  pinToClient: boolean
}

export type CatalogItem = {
  id: string
  name: string
  nameEn: string | null
  unit: string
  defaultUnitPrice: string
  currency: string
  vatApplicable: boolean
}

export type ResolvedPriceMap = Record<
  string,
  {
    unitPrice: number
    currency: string
    source: 'pinned' | 'history' | 'catalog'
    currencyMismatch: boolean
    lastUsedAt?: string
    lastDocumentId?: string
  }
>

export function emptyLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    serviceItemId: null,
    description: '',
    quantity: '1',
    unitPrice: '',
    discountPercent: '',
    vatApplicable: true,
    priceSource: 'manual',
    priceEditedManually: false,
    pinToClient: false,
  }
}

function fmtHintDate(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

export function DocumentLinesEditor({
  lines,
  onChange,
  catalog,
  prices,
  currency,
  canPin,
  onAddToCatalog,
  disabled,
}: {
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  catalog: CatalogItem[]
  prices: ResolvedPriceMap
  currency: string
  canPin: boolean
  onAddToCatalog?: (line: LineDraft) => void
  disabled?: boolean
}) {
  const catalogByName = useMemo(() => {
    const map = new Map<string, CatalogItem>()
    for (const item of catalog) {
      map.set(item.name.trim().toLowerCase(), item)
      if (item.nameEn) map.set(item.nameEn.trim().toLowerCase(), item)
    }
    return map
  }, [catalog])

  const update = (key: string, patch: Partial<LineDraft>) => {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const handleDescription = (line: LineDraft, value: string) => {
    const match = catalogByName.get(value.trim().toLowerCase())
    if (!match) {
      update(line.key, { description: value, serviceItemId: null })
      return
    }
    const resolved = prices[match.id]
    if (line.priceEditedManually || !resolved) {
      update(line.key, {
        description: value,
        serviceItemId: match.id,
        vatApplicable: match.vatApplicable,
      })
      return
    }
    update(line.key, {
      description: value,
      serviceItemId: match.id,
      vatApplicable: match.vatApplicable,
      unitPrice: String(resolved.unitPrice),
      priceSource: resolved.source,
      priceHintDate: resolved.lastUsedAt,
      currencyMismatch: resolved.currencyMismatch,
    })
  }

  const addLine = () => onChange([...lines, emptyLine()])
  const removeLine = (key: string) => onChange(lines.filter((line) => line.key !== key))

  return (
    <div className="flex flex-col gap-3">
      <datalist id="service-item-options">
        {catalog.map((item) => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>

      {lines.length === 0 && (
        <div className="text-xs text-[#5a688c] py-2">אין שורות עדיין — הוסף את הפריט הראשון.</div>
      )}

      {lines.map((line, index) => {
        const quantity = parseFloat(line.quantity) || 0
        const unitPrice = parseFloat(line.unitPrice) || 0
        const discount = parseFloat(line.discountPercent) || 0
        const lineTotal = computeLineTotal({
          quantity,
          unitPrice,
          discountPercent: discount,
          vatApplicable: line.vatApplicable,
        })
        const catalogItem = line.serviceItemId
          ? catalog.find((item) => item.id === line.serviceItemId)
          : null
        const catalogDefault = catalogItem ? parseFloat(catalogItem.defaultUnitPrice) || 0 : null
        const differsFromCatalog =
          catalogDefault != null && unitPrice > 0 && Math.abs(catalogDefault - unitPrice) > 0.001

        const hint = line.priceEditedManually
          ? PRICE_SOURCE_LABELS.manual
          : line.unitPrice !== '' && line.serviceItemId
            ? line.priceSource === 'history' && line.priceHintDate
              ? `${PRICE_SOURCE_LABELS.history} · ${fmtHintDate(line.priceHintDate)}`
              : PRICE_SOURCE_LABELS[line.priceSource]
            : null

        return (
          <div
            key={line.key}
            className="rounded-xl border border-[#2f4368] bg-[#16233b] p-3 flex flex-col gap-2"
          >
            <div className="flex items-start gap-2">
              <span className="text-[11px] text-[#5a688c] pt-2.5 w-4 shrink-0">{index + 1}</span>
              <div className="flex-1 min-w-0">
                <label className="label" htmlFor={`desc-${line.key}`}>
                  פירוט
                </label>
                <input
                  id={`desc-${line.key}`}
                  className="input"
                  list="service-item-options"
                  placeholder="לדוגמה: הרצאה"
                  value={line.description}
                  disabled={disabled}
                  onChange={(e) => handleDescription(line, e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost text-[11px] py-1 px-2 mt-6 text-[#fb7185] border-[#fb718522]"
                aria-label={`מחק שורה ${index + 1}`}
                disabled={disabled}
                onClick={() => removeLine(line.key)}
              >
                מחק
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="label" htmlFor={`qty-${line.key}`}>
                  כמות
                </label>
                <input
                  id={`qty-${line.key}`}
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.quantity}
                  disabled={disabled}
                  onChange={(e) => update(line.key, { quantity: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor={`price-${line.key}`}>
                  מחיר יחידה
                </label>
                <input
                  id={`price-${line.key}`}
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.unitPrice}
                  disabled={disabled}
                  onChange={(e) =>
                    update(line.key, {
                      unitPrice: e.target.value,
                      priceEditedManually: true,
                      priceSource: 'manual',
                      currencyMismatch: false,
                    })
                  }
                />
              </div>
              <div>
                <label className="label" htmlFor={`discount-${line.key}`}>
                  הנחה %
                </label>
                <input
                  id={`discount-${line.key}`}
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={line.discountPercent}
                  disabled={disabled}
                  onChange={(e) => update(line.key, { discountPercent: e.target.value })}
                />
              </div>
              <div>
                <span className="label">סה"כ שורה</span>
                <div className="text-sm font-semibold pt-2 tabular-nums">
                  {formatDocumentMoney(lineTotal, currency, 'he')}
                </div>
              </div>
            </div>

            {hint && <div className="text-[11px] text-[#5a688c]">{hint}</div>}

            {line.currencyMismatch && (
              <div className="text-[11px] text-[#fbbf24]">
                המחיר השמור במטבע אחר — הזן את הסכום ב-{currency} ידנית.
              </div>
            )}

            {differsFromCatalog && !line.currencyMismatch && (
              <div className="text-[11px] text-[#5a688c]">
                מחיר הקטלוג: {formatDocumentMoney(catalogDefault!, catalogItem!.currency, 'he')}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[11px] text-[#7a89ab] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!line.vatApplicable}
                  disabled={disabled}
                  onChange={(e) => update(line.key, { vatApplicable: !e.target.checked })}
                />
                שורה ללא מע"מ
              </label>

              {canPin && line.serviceItemId && (
                <label className="flex items-center gap-2 text-[11px] text-[#7a89ab] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={line.pinToClient}
                    disabled={disabled}
                    onChange={(e) => update(line.key, { pinToClient: e.target.checked })}
                  />
                  שמור כמחיר קבוע ללקוח
                </label>
              )}

              {!line.serviceItemId && line.description.trim() && onAddToCatalog && (
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1 px-2"
                  disabled={disabled}
                  onClick={() => onAddToCatalog(line)}
                >
                  + הוסף לקטלוג
                </button>
              )}
            </div>
          </div>
        )
      })}

      <button type="button" className="btn btn-ghost text-sm self-start" disabled={disabled} onClick={addLine}>
        + הוסף שורה
      </button>
    </div>
  )
}

export function unitLabel(unit: string): string {
  const labels: Record<ServiceUnit, string> = {
    hour: 'שעה',
    session: 'מפגש',
    day: 'יום',
    month: 'חודש',
    project: 'פרויקט',
    item: 'יחידה',
  }
  return labels[unit as ServiceUnit] ?? unit
}
