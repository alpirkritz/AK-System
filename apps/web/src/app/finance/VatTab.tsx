'use client'

import { useState, useMemo, useCallback, useRef, memo } from 'react'
import { trpc } from '@/lib/trpc'
import {
  VAT_CATEGORIES,
  BIMONTHLY_PERIODS,
  getCurrentPeriod,
  computeVatBreakdown,
  VAT_RATE,
} from '@ak-system/types'
import type { VatCategoryDef } from '@ak-system/types'

type VatEntryRow = {
  id: string
  year: number
  period: number
  taxCode: string
  category: string
  entryType: string
  date: string
  invoiceNumber: string | null
  description: string
  amount: string
  isVatExempt: number | boolean
  deductionPercent: string | null
  dollarRate: string | null
  invoiceFileUrl: string | null
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function periodFromDate(date: string): number {
  const month = new Date(date).getMonth() + 1
  return Math.ceil(month / 2)
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

const SummaryCard = memo(function SummaryCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: string
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="card flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-[#666] font-medium">{label}</span>
      </div>
      <div
        className="text-2xl font-bold tracking-tight"
        style={{ color: color ?? '#f0ede6' }}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-[#555]">{sub}</div>}
    </div>
  )
})

// ─── Entry Form Modal ─────────────────────────────────────────────────────────

type FormData = {
  entryType: 'income' | 'expense'
  categoryId: string
  date: string
  invoiceNumber: string
  description: string
  amount: string
  isVatExempt: boolean
  deductionPercent: string
  dollarRate: string
}

const EMPTY_FORM: FormData = {
  entryType: 'expense',
  categoryId: 'cogs',
  date: new Date().toISOString().slice(0, 10),
  invoiceNumber: '',
  description: '',
  amount: '',
  isVatExempt: false,
  deductionPercent: '1',
  dollarRate: '',
}

function EntryForm({
  year,
  period,
  editEntry,
  onClose,
  onSaved,
}: {
  year: number
  period: number
  editEntry?: {
    id: string
    entryType: string
    category: string
    date: string
    invoiceNumber: string | null
    description: string
    amount: string
    isVatExempt: number | boolean
    deductionPercent: string | null
    dollarRate: string | null
    taxCode: string
    invoiceFileUrl: string | null
  } | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!editEntry

  const initialCategory = editEntry
    ? VAT_CATEGORIES.find(
        (c) => c.label === editEntry.category && c.taxCode === editEntry.taxCode
      ) ?? VAT_CATEGORIES[0]
    : VAT_CATEGORIES.find((c) => c.id === 'cogs')!

  const [form, setForm] = useState<FormData>(() => {
    if (editEntry) {
      return {
        entryType: editEntry.entryType as 'income' | 'expense',
        categoryId: initialCategory.id,
        date: editEntry.date,
        invoiceNumber: editEntry.invoiceNumber ?? '',
        description: editEntry.description,
        amount: editEntry.amount,
        isVatExempt:
          editEntry.isVatExempt === 1 || editEntry.isVatExempt === true,
        deductionPercent: editEntry.deductionPercent ?? '1',
        dollarRate: editEntry.dollarRate ?? '',
      }
    }
    return { ...EMPTY_FORM }
  })

  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrFileName, setOcrFileName] = useState<string | null>(null)
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const MAX_FILE_SIZE_MB = 8
  const MAX_FILE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

  const createMutation = trpc.vat.create.useMutation({
    onSuccess: () => {
      setSubmitting(false)
      onSaved()
    },
    onError: () => setSubmitting(false),
  })

  const updateMutation = trpc.vat.update.useMutation({
    onSuccess: () => {
      setSubmitting(false)
      onSaved()
    },
    onError: () => setSubmitting(false),
  })

  const parseInvoiceMutation = trpc.vat.parseInvoice.useMutation({
    onSuccess: (result) => {
      setOcrLoading(false)
      setOcrError(null)
      setOcrFileName(null)
      const touched = new Set<string>()
      setForm((f) => {
        const updated = { ...f }
        if (result.amount != null) {
          updated.amount = String(result.amount)
          touched.add('amount')
        }
        if (result.date) {
          updated.date = result.date
          touched.add('date')
        }
        if (result.invoiceNumber) {
          updated.invoiceNumber = result.invoiceNumber
          touched.add('invoiceNumber')
        }
        if (result.description) {
          updated.description = result.description
          touched.add('description')
        }
        if (result.suggestedCategory) {
          const match = VAT_CATEGORIES.find(
            (c) => c.label === result.suggestedCategory
          )
          if (match) {
            updated.categoryId = match.id
            updated.deductionPercent = String(match.defaultDeductionPercent)
            updated.isVatExempt = !match.vatApplicable
            updated.entryType = match.entryType
            touched.add('category')
          }
        }
        if (result.isVatExempt) {
          updated.isVatExempt = true
          touched.add('isVatExempt')
        }
        return updated
      })
      setOcrFields(touched)
    },
    onError: (err) => {
      setOcrLoading(false)
      setOcrFileName(null)
      setOcrError(err.message || 'שגיאה בניתוח החשבונית')
    },
  })

  const selectedCat = VAT_CATEGORIES.find((c) => c.id === form.categoryId)

  const handleCategoryChange = (catId: string) => {
    const cat = VAT_CATEGORIES.find((c) => c.id === catId)
    if (cat) {
      setForm((f) => ({
        ...f,
        categoryId: catId,
        entryType: cat.entryType,
        deductionPercent: String(cat.defaultDeductionPercent),
        isVatExempt: !cat.vatApplicable,
      }))
    }
  }

  const handleFileUpload = useCallback(
    (file: File) => {
      if (!file) return
      setOcrError(null)
      setOcrFields(new Set())
      setOcrFileName(file.name)

      if (file.size > MAX_FILE_BYTES) {
        setOcrError(`הקובץ גדול מדי (מקסימום ${MAX_FILE_SIZE_MB} MB). נסה לצמצם או לצלם מחדש.`)
        setOcrFileName(null)
        return
      }

      const isPdf =
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
      const isJpeg =
        file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg')
      const mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' = isPdf
        ? 'application/pdf'
        : isJpeg
        ? 'image/jpeg'
        : 'image/png'

      setOcrLoading(true)

      const reader = new FileReader()
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer
        if (!buffer || buffer.byteLength === 0) {
          setOcrLoading(false)
          setOcrError('לא ניתן לקרוא את הקובץ')
          return
        }
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        parseInvoiceMutation.mutate({ fileBase64: base64, mimeType })
      }
      reader.onerror = () => {
        setOcrLoading(false)
        setOcrFileName(null)
        setOcrError('שגיאה בקריאת הקובץ')
      }
      reader.readAsArrayBuffer(file)
    },
    [parseInvoiceMutation]
  )

  const amount = parseFloat(form.amount) || 0
  const deduction = parseFloat(form.deductionPercent) || 0
  const preview = computeVatBreakdown(
    form.entryType,
    amount,
    deduction,
    form.isVatExempt
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount || !form.description) return
    setSubmitting(true)

    const cat = VAT_CATEGORIES.find((c) => c.id === form.categoryId)!
    const payload = {
      taxCode: cat.taxCode,
      category: cat.label,
      entryType: form.entryType as 'income' | 'expense',
      date: form.date,
      invoiceNumber: form.invoiceNumber || undefined,
      description: form.description,
      amount,
      isVatExempt: form.isVatExempt,
      deductionPercent: deduction,
      dollarRate: form.dollarRate ? parseFloat(form.dollarRate) : undefined,
    }

    if (isEdit && editEntry) {
      updateMutation.mutate({ id: editEntry.id, ...payload })
    } else {
      createMutation.mutate({ year, period, ...payload })
    }
  }

  const incomeCategories = VAT_CATEGORIES.filter(
    (c) => c.entryType === 'income'
  )
  const expenseCategories = VAT_CATEGORIES.filter(
    (c) => c.entryType === 'expense'
  )

  const aiBadge = (field: string) =>
    ocrFields.has(field) ? (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#e8c54722] text-[#e8c547] mr-1">
        AI
      </span>
    ) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">
            {isEdit ? 'עריכת רשומה' : 'הוספת רשומה'}
          </h2>
          <button className="btn btn-ghost text-xs" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Invoice OCR Upload */}
        {!isEdit && (
          <div className="mb-5">
            <div
              className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors hover:border-[#e8c547]"
              style={{ borderColor: ocrLoading ? '#e8c547' : '#2a2a2a' }}
              onClick={() => fileRef.current?.click()}
            >
              {ocrLoading ? (
                <div className="text-sm text-[#e8c547]">
                  מנתח חשבונית{ocrFileName ? `: ${ocrFileName}` : ''}...
                </div>
              ) : (
                <>
                  <div className="text-2xl mb-1">📄</div>
                  <div className="text-xs text-[#888]">
                    העלה חשבונית (PDF / תמונה) למילוי אוטומטי
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFileUpload(file)
                e.target.value = ''
              }}
            />
            {ocrError && (
              <div
                className="mt-3 text-sm px-3 py-2 rounded-lg"
                style={{
                  background: '#e8477a11',
                  color: '#e8477a',
                  border: '1px solid #e8477a33',
                }}
              >
                {ocrError}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Category */}
          <div>
            <label className="label">
              {aiBadge('category')}
              קטגוריה
            </label>
            <select
              className="select w-full"
              value={form.categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <optgroup label="הכנסות">
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="הוצאות">
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({fmtPct(c.defaultDeductionPercent)})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Date */}
            <div>
              <label className="label">
                {aiBadge('date')}
                תאריך
              </label>
              <input
                className="input"
                type="date"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
                required
              />
            </div>

            {/* Invoice Number */}
            <div>
              <label className="label">
                {aiBadge('invoiceNumber')}
                מס׳ חשבונית
              </label>
              <input
                className="input"
                placeholder="לדוגמה: 10024"
                value={form.invoiceNumber}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invoiceNumber: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="label">
              {aiBadge('description')}
              פרטים
            </label>
            <input
              className="input"
              placeholder="תיאור ההוצאה/הכנסה"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Amount */}
            <div>
              <label className="label">
                {aiBadge('amount')}
                סכום כולל מע״מ
              </label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value }))
                }
                required
              />
            </div>

            {/* Deduction Percent */}
            {form.entryType === 'expense' && (
              <div>
                <label className="label">אחוז ניכוי</label>
                <select
                  className="select w-full"
                  value={form.deductionPercent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      deductionPercent: e.target.value,
                    }))
                  }
                >
                  {[1, 0.67, 0.5, 0.25, 0].map((p) => (
                    <option key={p} value={String(p)}>
                      {fmtPct(p)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* VAT Exempt Toggle */}
          {form.entryType === 'expense' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isVatExempt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isVatExempt: e.target.checked }))
                }
                className="w-4 h-4 accent-[#e8c547]"
              />
              <span className="text-sm text-[#888]">
                {aiBadge('isVatExempt')}
                פטור ממע״מ (ארנונה, ועד בית, ביטוח לאומי וכו׳)
              </span>
            </label>
          )}

          {/* Dollar Rate */}
          <div>
            <label className="label">שער דולר (אופציונלי)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              placeholder="למשל 3.90"
              value={form.dollarRate}
              onChange={(e) =>
                setForm((f) => ({ ...f, dollarRate: e.target.value }))
              }
            />
          </div>

          {/* Live Preview */}
          {amount > 0 && (
            <div
              className="rounded-lg p-3 text-xs flex flex-col gap-1"
              style={{
                background: '#1a1a1a',
                border: '1px solid #222',
              }}
            >
              <div className="text-[#666] font-semibold mb-1">פירוט מחושב:</div>
              {form.entryType === 'income' ? (
                form.isVatExempt ? (
                  <div>
                    הכנסה פטורת מע״מ:{' '}
                    <span className="text-[#47b86e] font-semibold">
                      {fmt(amount)}
                    </span>
                  </div>
                ) : (
                  <>
                    <div>
                      הכנסה כולל מע״מ:{' '}
                      <span className="text-[#47b86e] font-semibold">
                        {fmt(preview.incomeInclVat)}
                      </span>
                    </div>
                    <div>
                      תקבולים ללא מע״מ: {fmt(preview.incomeExclVat)}
                    </div>
                    <div>
                      מע״מ עסקאות:{' '}
                      <span className="text-[#e8c547]">
                        {fmt(preview.vatFromIncome)}
                      </span>
                    </div>
                  </>
                )
              ) : form.isVatExempt ? (
                <div>
                  הוצאה פטורת מע״מ:{' '}
                  <span className="text-[#e8477a] font-semibold">
                    {fmt(amount)}
                  </span>
                </div>
              ) : (
                <>
                  <div>
                    הוצאה מקורית: {fmt(amount)} × {fmtPct(deduction)} ={' '}
                    <span className="text-[#e8477a] font-semibold">
                      {fmt(preview.computedExpense)}
                    </span>
                  </div>
                  <div>
                    הוצאה ללא מע״מ: {fmt(preview.expenseExclVat)}
                  </div>
                  <div>
                    מע״מ תשומות:{' '}
                    <span className="text-[#e8c547]">
                      {fmt(preview.vatFromExpenses)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary mt-1"
            disabled={submitting}
          >
            {submitting ? 'שומר...' : isEdit ? 'עדכן רשומה' : '+ הוסף רשומה'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Annual Summary View ──────────────────────────────────────────────────────

function AnnualSummaryView({ year }: { year: number }) {
  const { data, isLoading } = trpc.vat.annualSummary.useQuery({ year })

  if (isLoading) {
    return <div className="text-[#555] text-sm">טוען סיכום שנתי...</div>
  }

  if (!data || data.groups.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-3">📊</div>
        <div className="text-[#555] text-sm">
          אין נתונים לשנת {year}
        </div>
      </div>
    )
  }

  const taxCodeLabels: Record<string, string> = {
    '1': 'הכנסות',
    '2': 'קניות / עלות המכירות',
    '8': 'אחזקה תיקונים שוטפים',
    '9': 'משרדיות',
    '10': 'הנהלת חשבונות',
    '12': 'נסיעה אשל / רכב',
    '13': 'מיסים',
  }

  return (
    <div>
      {/* Grand Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <SummaryCard
          icon="💰"
          label="סה״כ הכנסות"
          value={fmt(data.grandTotalIncomeInclVat)}
          color="#47b86e"
        />
        <SummaryCard
          icon="💸"
          label="סה״כ הוצאות (שנתי)"
          value={fmt(data.grandTotalExpenseForAnnual)}
          color="#e8477a"
        />
        <SummaryCard
          icon="📈"
          label="מע״מ עסקאות"
          value={fmt(data.grandTotalVatFromIncome)}
        />
        <SummaryCard
          icon="📉"
          label="מע״מ תשומות"
          value={fmt(data.grandTotalVatFromExpenses)}
        />
        <SummaryCard
          icon="🏦"
          label="סה״כ מע״מ לתשלום"
          value={fmt(data.grandVatToPay)}
          color={data.grandVatToPay >= 0 ? '#e8c547' : '#47b86e'}
        />
      </div>

      {/* Groups by Tax Code */}
      {data.groups.map((group) => (
        <div key={group.taxCode} className="mb-6">
          <h3 className="text-sm font-semibold text-[#888] mb-3 uppercase tracking-wider">
            סעיף {group.taxCode} — {taxCodeLabels[group.taxCode] ?? group.taxCode}
            <span className="text-[#555] font-normal mr-2">
              ({group.entries.length} רשומות)
            </span>
          </h3>

          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-[#222]">
                  {['תאריך', 'חשבונית', 'פרטים', 'הכנסה כולל מע"מ', 'הוצאה מחושבת', 'מע"מ', 'סה"כ ללא מע"מ'].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-right px-3 py-2 text-[11px] font-medium text-[#555] uppercase"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry: VatEntryRow) => {
                  const amt = parseFloat(entry.amount) || 0
                  const ded =
                    entry.deductionPercent != null
                      ? parseFloat(entry.deductionPercent)
                      : 1
                  const exempt =
                    entry.isVatExempt === 1 ||
                    (entry.isVatExempt as unknown) === true
                  const b = computeVatBreakdown(
                    entry.entryType as 'income' | 'expense',
                    amt,
                    ded,
                    exempt
                  )
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors"
                    >
                      <td className="px-3 py-2 text-[#666] whitespace-nowrap">
                        {fmtDate(entry.date)}
                      </td>
                      <td className="px-3 py-2 text-[#666]">
                        {entry.invoiceNumber ?? '—'}
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate">
                        {entry.description}
                      </td>
                      <td className="px-3 py-2 text-[#47b86e]">
                        {b.incomeInclVat > 0 ? fmt(b.incomeInclVat) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[#e8477a]">
                        {b.computedExpense > 0
                          ? fmt(b.computedExpense)
                          : b.vatExemptExpense > 0
                          ? fmt(b.vatExemptExpense)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-[#e8c547]">
                        {b.vatFromIncome > 0
                          ? fmt(b.vatFromIncome)
                          : b.vatFromExpenses > 0
                          ? fmt(b.vatFromExpenses)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {entry.entryType === 'income'
                          ? fmt(b.incomeExclVat + b.vatExemptIncome)
                          : fmt(b.totalExpenseForAnnual)}
                      </td>
                    </tr>
                  )
                })}
                {/* Subtotal */}
                <tr className="bg-[#1a1a1a] font-semibold">
                  <td className="px-3 py-2" colSpan={3}>
                    סה״כ סעיף {group.taxCode}
                  </td>
                  <td className="px-3 py-2 text-[#47b86e]">
                    {group.totalIncomeInclVat > 0
                      ? fmt(group.totalIncomeInclVat)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-[#e8477a]">
                    {group.totalComputedExpense + group.totalVatExemptExpense >
                    0
                      ? fmt(
                          group.totalComputedExpense +
                            group.totalVatExemptExpense
                        )
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-[#e8c547]">
                    {group.totalVatFromIncome + group.totalVatFromExpenses > 0
                      ? fmt(
                          group.totalVatFromIncome + group.totalVatFromExpenses
                        )
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {fmt(
                      group.totalIncomeInclVat / (1 + VAT_RATE) +
                        group.totalExpenseForAnnual
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main VAT Tab ─────────────────────────────────────────────────────────────

export default function VatTab() {
  const current = getCurrentPeriod()
  const [year, setYear] = useState(current.year)
  const [selectedPeriod, setSelectedPeriod] = useState<number | 'annual'>(
    current.period
  )
  const [showForm, setShowForm] = useState(false)
  const [editEntry, setEditEntry] = useState<Parameters<typeof EntryForm>[0]['editEntry']>(null)

  const isAnnual = selectedPeriod === 'annual'
  const periodNum = isAnnual ? 1 : selectedPeriod

  const utils = trpc.useUtils()

  const { data: entries = [], isLoading: entriesLoading } =
    trpc.vat.list.useQuery(
      { year, period: periodNum },
      { enabled: !isAnnual }
    )

  const { data: summary, isLoading: summaryLoading } =
    trpc.vat.periodSummary.useQuery(
      { year, period: periodNum },
      { enabled: !isAnnual }
    )

  const deleteMutation = trpc.vat.delete.useMutation({
    onSuccess: () => {
      utils.vat.list.invalidate()
      utils.vat.periodSummary.invalidate()
      utils.vat.annualSummary.invalidate()
    },
  })

  const handleAdd = () => {
    setEditEntry(null)
    setShowForm(true)
  }

  const handleEdit = (entry: (typeof entries)[number]) => {
    setEditEntry(entry)
    setShowForm(true)
  }

  const handleSaved = () => {
    setShowForm(false)
    setEditEntry(null)
    utils.vat.list.invalidate()
    utils.vat.periodSummary.invalidate()
    utils.vat.annualSummary.invalidate()
  }

  const years = useMemo(() => {
    const cur = new Date().getFullYear()
    return [cur - 1, cur, cur + 1]
  }, [])

  return (
    <div>
      {/* Period Selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <select
          className="select text-sm"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <div className="flex gap-1 flex-wrap">
          {BIMONTHLY_PERIODS.map((p) => (
            <button
              key={p.index}
              className="btn btn-ghost text-xs px-3 py-1.5"
              style={{
                color: selectedPeriod === p.index ? '#e8c547' : '#666',
                borderColor:
                  selectedPeriod === p.index ? '#e8c54744' : '#2a2a2a',
                background:
                  selectedPeriod === p.index ? '#e8c54711' : 'transparent',
              }}
              onClick={() => setSelectedPeriod(p.index)}
            >
              {p.label}
            </button>
          ))}
          <div className="w-px bg-[#2a2a2a] mx-1" />
          <button
            className="btn btn-ghost text-xs px-3 py-1.5"
            style={{
              color: isAnnual ? '#e8c547' : '#666',
              borderColor: isAnnual ? '#e8c54744' : '#2a2a2a',
              background: isAnnual ? '#e8c54711' : 'transparent',
            }}
            onClick={() => setSelectedPeriod('annual')}
          >
            סיכום שנתי
          </button>
        </div>

        {!isAnnual && (
          <button className="btn btn-primary text-xs mr-auto" onClick={handleAdd}>
            + הוסף רשומה
          </button>
        )}
      </div>

      {/* Annual vs Bimonthly */}
      {isAnnual ? (
        <AnnualSummaryView year={year} />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <SummaryCard
              icon="💰"
              label="הכנסות כולל מע״מ"
              value={summaryLoading ? '...' : fmt(summary?.totalIncomeInclVat ?? 0)}
              color="#47b86e"
            />
            <SummaryCard
              icon="🧾"
              label="תקבולים ללא מע״מ"
              value={summaryLoading ? '...' : fmt(summary?.totalIncomeExclVat ?? 0)}
            />
            <SummaryCard
              icon="💸"
              label="הוצאות מחושב"
              value={
                summaryLoading
                  ? '...'
                  : fmt(
                      (summary?.totalComputedExpense ?? 0) +
                        (summary?.totalVatExemptExpense ?? 0)
                    )
              }
              color="#e8477a"
            />
            <SummaryCard
              icon="📊"
              label="מע״מ עסקאות / תשומות"
              value={
                summaryLoading
                  ? '...'
                  : `${fmt(summary?.totalVatFromIncome ?? 0)} / ${fmt(
                      summary?.totalVatFromExpenses ?? 0
                    )}`
              }
              sub={`${summary?.entryCount ?? 0} רשומות`}
            />
            <SummaryCard
              icon="🏦"
              label="מע״מ לתשלום"
              value={summaryLoading ? '...' : fmt(summary?.vatToPay ?? 0)}
              color={
                (summary?.vatToPay ?? 0) >= 0 ? '#e8c547' : '#47b86e'
              }
            />
          </div>

          {/* Entries Table */}
          {entriesLoading ? (
            <div className="text-[#555] text-sm">טוען...</div>
          ) : entries.length === 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-3">📋</div>
              <div className="text-[#555] text-sm">
                אין רשומות לתקופה זו
              </div>
              <div className="text-xs text-[#444] mt-1">
                לחץ "הוסף רשומה" כדי להתחיל
              </div>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="border-b border-[#222]">
                    {[
                      '#',
                      'קטגוריה',
                      'תאריך',
                      'חשבונית',
                      'פרטים',
                      'הכנסה כולל מע"מ',
                      'הוצאה כולל מע"מ',
                      'ניכוי',
                      'מע"מ',
                      'סה"כ ללא מע"מ',
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-right px-3 py-2 text-[11px] font-medium text-[#555] uppercase"
                      >
                        {h}
                      </th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry: VatEntryRow, idx: number) => {
                    const amt = parseFloat(entry.amount) || 0
                    const ded =
                      entry.deductionPercent != null
                        ? parseFloat(entry.deductionPercent)
                        : 1
                    const exempt =
                      entry.isVatExempt === 1 ||
                      (entry.isVatExempt as unknown) === true
                    const b = computeVatBreakdown(
                      entry.entryType as 'income' | 'expense',
                      amt,
                      ded,
                      exempt
                    )
                    const isIncome = entry.entryType === 'income'

                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors group"
                        style={{
                          background: isIncome
                            ? 'rgba(71,184,110,0.04)'
                            : undefined,
                        }}
                      >
                        <td className="px-3 py-2 text-[#555]">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <span className="pill text-xs">
                            {entry.category}
                          </span>
                          {exempt && (
                            <span className="pill text-[10px] mr-1 text-[#e8c547] border-[#e8c54744]">
                              פטור
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[#666] whitespace-nowrap">
                          {fmtDate(entry.date)}
                        </td>
                        <td className="px-3 py-2 text-[#666]">
                          {entry.invoiceNumber ?? '—'}
                        </td>
                        <td className="px-3 py-2 max-w-[180px] truncate">
                          {entry.description}
                        </td>
                        <td className="px-3 py-2 text-[#47b86e]">
                          {isIncome
                            ? fmt(
                                b.incomeInclVat > 0
                                  ? b.incomeInclVat
                                  : b.vatExemptIncome
                              )
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-[#e8477a]">
                          {!isIncome ? fmt(amt) : '—'}
                        </td>
                        <td className="px-3 py-2 text-[#888]">
                          {!isIncome && !exempt ? fmtPct(ded) : '—'}
                        </td>
                        <td className="px-3 py-2 text-[#e8c547]">
                          {b.vatFromIncome > 0
                            ? fmt(b.vatFromIncome)
                            : b.vatFromExpenses > 0
                            ? fmt(b.vatFromExpenses)
                            : '—'}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {isIncome
                            ? fmt(b.incomeExclVat + b.vatExemptIncome)
                            : fmt(b.totalExpenseForAnnual)}
                        </td>
                        <td className="px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="flex gap-1">
                            <button
                              className="btn btn-ghost text-[11px] py-1 px-2"
                              onClick={() => handleEdit(entry)}
                            >
                              ערוך
                            </button>
                            <button
                              className="btn btn-ghost text-[11px] py-1 px-2 text-[#e8477a] border-[#e8477a22]"
                              onClick={() =>
                                deleteMutation.mutate({ id: entry.id })
                              }
                            >
                              מחק
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Entry Form Modal */}
      {showForm && !isAnnual && (
        <EntryForm
          year={year}
          period={periodNum}
          editEntry={editEntry}
          onClose={() => {
            setShowForm(false)
            setEditEntry(null)
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
