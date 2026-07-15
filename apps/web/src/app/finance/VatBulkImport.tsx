'use client'

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { VAT_CATEGORIES, computeVatBreakdown, periodFromDate } from '@ak-system/types'

// ─── Types ──────────────────────────────────────────────────────────────────

type RowStatus = 'pending' | 'parsing' | 'done' | 'error'

type ReviewRow = {
  fileName: string
  filePath: string
  sizeBytes: number
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
  alreadyImported: boolean
  status: RowStatus
  selected: boolean
  confidence?: 'high' | 'medium' | 'low'
  error?: string
  // editable fields
  categoryId: string
  entryType: 'income' | 'expense'
  year: number
  period: number
  date: string
  invoiceNumber: string
  description: string
  amount: string
  deductionPercent: string
  isVatExempt: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', { text: string; color: string }> = {
  high: { text: 'ודאות גבוהה', color: '#34d399' },
  medium: { text: 'ודאות בינונית', color: '#fbbf24' },
  low: { text: 'ודאות נמוכה', color: '#fb7185' },
}

const DEFAULT_CATEGORY = VAT_CATEGORIES.find((c) => c.id === 'cogs') ?? VAT_CATEGORIES[0]

function makeRow(
  file: {
    fileName: string
    filePath: string
    sizeBytes: number
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
    alreadyImported: boolean
  },
  folder: string,
): ReviewRow {
  const [yearStr, monthStr] = folder.split('_')
  const year = Number(yearStr)
  const month = Number(monthStr)
  return {
    ...file,
    status: 'pending',
    selected: !file.alreadyImported,
    categoryId: DEFAULT_CATEGORY.id,
    entryType: DEFAULT_CATEGORY.entryType,
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    period: Number.isFinite(month) ? Math.ceil(month / 2) : 1,
    date: '',
    invoiceNumber: '',
    description: '',
    amount: '',
    deductionPercent: String(DEFAULT_CATEGORY.defaultDeductionPercent),
    isVatExempt: !DEFAULT_CATEGORY.vatApplicable,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VatBulkImport({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const [folder, setFolder] = useState('')
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [scanning, setScanning] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  const utils = trpc.useUtils()

  const { data: foldersData, isLoading: foldersLoading } =
    trpc.vat.listExpenseFolders.useQuery(undefined, { refetchOnWindowFocus: false })

  const parseMutation = trpc.vat.parseFolderFile.useMutation()
  const createBatchMutation = trpc.vat.createBatch.useMutation()

  const available = foldersData?.available ?? true
  const folders = foldersData?.folders ?? []

  const selectedCount = useMemo(
    () => rows.filter((r) => r.selected && r.status === 'done').length,
    [rows],
  )

  const updateRow = (filePath: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => (r.filePath === filePath ? { ...r, ...patch } : r)))
  }

  const handleCategoryChange = (filePath: string, categoryId: string) => {
    const cat = VAT_CATEGORIES.find((c) => c.id === categoryId)
    if (!cat) return
    updateRow(filePath, {
      categoryId,
      entryType: cat.entryType,
      deductionPercent: String(cat.defaultDeductionPercent),
      isVatExempt: !cat.vatApplicable,
    })
  }

  const handleScan = async () => {
    if (!folder) return
    setScanning(true)
    setBanner(null)
    setRows([])
    try {
      const files = await utils.vat.listFolderFiles.fetch({ folder })
      const built = files.map((f) => makeRow(f, folder))
      setRows(built)
      if (built.length === 0) {
        setBanner('לא נמצאו קבצים בתיקייה זו')
      } else {
        // Auto-parse every not-yet-imported file, sequentially.
        await parseRows(built)
      }
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'שגיאה בסריקת התיקייה')
    } finally {
      setScanning(false)
    }
  }

  const parseRows = async (built: ReviewRow[]) => {
    setParsing(true)
    for (const row of built) {
      if (row.alreadyImported) continue
      updateRow(row.filePath, { status: 'parsing' })
      try {
        const result = await parseMutation.mutateAsync({
          folder,
          fileName: row.fileName,
        })
        const cat = result.suggestedCategory
          ? VAT_CATEGORIES.find((c) => c.label === result.suggestedCategory)
          : undefined
        updateRow(row.filePath, {
          status: 'done',
          confidence: result.confidence,
          date: result.date ?? '',
          invoiceNumber: result.invoiceNumber ?? '',
          description: result.description ?? '',
          amount: result.amount != null ? String(result.amount) : '',
          year: result.year,
          period: result.period,
          ...(cat
            ? {
                categoryId: cat.id,
                entryType: cat.entryType,
                deductionPercent: String(cat.defaultDeductionPercent),
                isVatExempt: !cat.vatApplicable || result.isVatExempt,
              }
            : { isVatExempt: result.isVatExempt }),
        })
      } catch (err) {
        updateRow(row.filePath, {
          status: 'error',
          selected: false,
          error: err instanceof Error ? err.message : 'שגיאה בניתוח',
        })
      }
    }
    setParsing(false)
  }

  const handleReparse = async (row: ReviewRow) => {
    updateRow(row.filePath, { status: 'parsing', error: undefined })
    try {
      const result = await parseMutation.mutateAsync({ folder, fileName: row.fileName })
      const cat = result.suggestedCategory
        ? VAT_CATEGORIES.find((c) => c.label === result.suggestedCategory)
        : undefined
      updateRow(row.filePath, {
        status: 'done',
        selected: true,
        confidence: result.confidence,
        date: result.date ?? '',
        invoiceNumber: result.invoiceNumber ?? '',
        description: result.description ?? '',
        amount: result.amount != null ? String(result.amount) : '',
        year: result.year,
        period: result.period,
        ...(cat
          ? {
              categoryId: cat.id,
              entryType: cat.entryType,
              deductionPercent: String(cat.defaultDeductionPercent),
              isVatExempt: !cat.vatApplicable || result.isVatExempt,
            }
          : {}),
      })
    } catch (err) {
      updateRow(row.filePath, {
        status: 'error',
        error: err instanceof Error ? err.message : 'שגיאה בניתוח',
      })
    }
  }

  const handleImport = async () => {
    const toImport = rows.filter(
      (r) => r.selected && r.status === 'done' && parseFloat(r.amount) > 0 && r.description,
    )
    if (toImport.length === 0) {
      setBanner('אין רשומות תקינות לייבוא (נדרש סכום ותיאור)')
      return
    }
    setImporting(true)
    setBanner(null)
    try {
      const entries = toImport.map((r) => {
        const cat = VAT_CATEGORIES.find((c) => c.id === r.categoryId) ?? DEFAULT_CATEGORY
        const derived = periodFromDate(r.date)
        return {
          year: derived.year,
          period: derived.period,
          taxCode: cat.taxCode,
          category: cat.label,
          entryType: r.entryType,
          date: r.date,
          invoiceNumber: r.invoiceNumber || undefined,
          description: r.description,
          amount: parseFloat(r.amount),
          isVatExempt: r.isVatExempt,
          deductionPercent: parseFloat(r.deductionPercent) || 0,
          invoiceFileUrl: r.filePath,
        }
      })
      const res = await createBatchMutation.mutateAsync({ entries })
      // Mark imported rows so the queue reflects the new state without a full rescan.
      setRows((prev) =>
        prev.map((r) =>
          toImport.some((t) => t.filePath === r.filePath)
            ? { ...r, alreadyImported: true, selected: false }
            : r,
        ),
      )
      utils.vat.listExpenseFolders.invalidate()
      setBanner(`יובאו ${res.inserted} רשומות בהצלחה`)
      onImported()
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'שגיאה בייבוא')
    } finally {
      setImporting(false)
    }
  }

  const incomeCategories = VAT_CATEGORIES.filter((c) => c.entryType === 'income')
  const expenseCategories = VAT_CATEGORIES.filter((c) => c.entryType === 'expense')
  const busy = scanning || parsing

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && !importing && onClose()}
    >
      <div className="card w-full max-w-5xl max-h-[92vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">📁 ייבוא חשבוניות מתיקייה</h2>
          <button className="btn btn-ghost text-xs" onClick={onClose} disabled={importing}>
            ✕
          </button>
        </div>

        {available === false ? (
          <div
            className="rounded-lg p-4 text-sm"
            style={{ background: '#fb718511', border: '1px solid #fb718533', color: '#fb7185' }}
          >
            {foldersData?.reason ?? 'תיקיית ההוצאות אינה נגישה מהשרת'}
            <div className="text-xs text-[#7a89ab] mt-2">
              ייבוא מתיקייה זמין רק כאשר לשרת יש גישה לכונן ה-Google Drive המקומי.
            </div>
          </div>
        ) : (
          <>
            {/* Folder picker + scan */}
            <div className="flex flex-wrap items-end gap-3 mb-5">
              <div className="flex-1 min-w-[200px]">
                <label className="label">תיקיית חודש</label>
                <select
                  className="select w-full"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  disabled={busy || foldersLoading}
                >
                  <option value="">
                    {foldersLoading ? 'טוען תיקיות...' : 'בחר תיקייה'}
                  </option>
                  {folders.map((f) => (
                    <option key={f.folder} value={f.folder}>
                      {f.folder} — {f.fileCount} קבצים
                      {f.importedCount > 0 ? ` (${f.importedCount} יובאו)` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleScan}
                disabled={!folder || busy}
              >
                {scanning ? 'סורק...' : parsing ? 'מנתח חשבוניות...' : '🔍 סרוק תיקייה'}
              </button>
            </div>

            {banner && (
              <div
                className="mb-4 text-xs px-3 py-2 rounded-lg"
                style={{
                  background: banner.includes('שגיאה') || banner.includes('לא ')
                    ? '#fb718511'
                    : '#34d39911',
                  color: banner.includes('שגיאה') || banner.includes('לא ')
                    ? '#fb7185'
                    : '#34d399',
                  border: `1px solid ${
                    banner.includes('שגיאה') || banner.includes('לא ') ? '#fb718533' : '#34d39933'
                  }`,
                }}
              >
                {banner}
              </div>
            )}

            {/* Review queue */}
            {rows.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs text-[#647399]">
                    {rows.length} קבצים · {selectedCount} נבחרו לייבוא
                    {parsing && ' · מנתח...'}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#7a89ab] cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-[#2dd4bf]"
                      checked={
                        rows.filter((r) => r.status === 'done').length > 0 &&
                        rows.filter((r) => r.status === 'done').every((r) => r.selected)
                      }
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r) =>
                            r.status === 'done' ? { ...r, selected: e.target.checked } : r,
                          ),
                        )
                      }
                    />
                    בחר הכל
                  </label>
                </div>

                <div className="flex flex-col gap-3">
                  {rows.map((row) => {
                    const amount = parseFloat(row.amount) || 0
                    const deduction = parseFloat(row.deductionPercent) || 0
                    const preview = computeVatBreakdown(
                      row.entryType,
                      amount,
                      deduction,
                      row.isVatExempt,
                    )
                    return (
                      <div
                        key={row.filePath}
                        className="rounded-xl p-3"
                        style={{
                          background: row.alreadyImported ? '#131d33' : '#1d2b46',
                          border: '1px solid #29395d',
                          opacity: row.alreadyImported ? 0.55 : 1,
                        }}
                      >
                        {/* Row header */}
                        <div className="flex items-center gap-3 mb-2">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-[#2dd4bf] flex-shrink-0"
                            checked={row.selected}
                            disabled={row.status !== 'done'}
                            onChange={(e) => updateRow(row.filePath, { selected: e.target.checked })}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate" title={row.fileName}>
                              {row.fileName}
                            </div>
                            <div className="text-[10px] text-[#5a688c]">{fmtSize(row.sizeBytes)}</div>
                          </div>
                          {row.alreadyImported && (
                            <span className="pill text-[10px] text-[#2dd4bf] border-[#2dd4bf44] flex-shrink-0">
                              יובא
                            </span>
                          )}
                          {row.status === 'parsing' && (
                            <span className="text-xs text-[#2dd4bf] flex-shrink-0">מנתח...</span>
                          )}
                          {row.status === 'done' && row.confidence && (
                            <span
                              className="pill text-[10px] flex-shrink-0"
                              style={{
                                color: CONFIDENCE_LABEL[row.confidence].color,
                                borderColor: `${CONFIDENCE_LABEL[row.confidence].color}44`,
                              }}
                            >
                              {CONFIDENCE_LABEL[row.confidence].text}
                            </span>
                          )}
                          {row.status === 'error' && (
                            <button
                              className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522] flex-shrink-0"
                              onClick={() => handleReparse(row)}
                            >
                              נסה שוב
                            </button>
                          )}
                        </div>

                        {row.status === 'error' && (
                          <div className="text-[11px] text-[#fb7185] mb-2">{row.error}</div>
                        )}

                        {/* Editable fields */}
                        {row.status === 'done' && (
                          <>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                              <div>
                                <label className="label text-[10px]">קטגוריה</label>
                                <select
                                  className="select w-full text-xs"
                                  value={row.categoryId}
                                  onChange={(e) => handleCategoryChange(row.filePath, e.target.value)}
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
                              <div>
                                <label className="label text-[10px]">תאריך</label>
                                <input
                                  className="input text-xs"
                                  type="date"
                                  value={row.date}
                                  onChange={(e) => updateRow(row.filePath, { date: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className="label text-[10px]">מס׳ חשבונית</label>
                                <input
                                  className="input text-xs"
                                  value={row.invoiceNumber}
                                  onChange={(e) =>
                                    updateRow(row.filePath, { invoiceNumber: e.target.value })
                                  }
                                />
                              </div>
                              <div>
                                <label className="label text-[10px]">סכום כולל מע״מ</label>
                                <input
                                  className="input text-xs"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={row.amount}
                                  onChange={(e) => updateRow(row.filePath, { amount: e.target.value })}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
                              <div className="lg:col-span-2">
                                <label className="label text-[10px]">פרטים</label>
                                <input
                                  className="input text-xs"
                                  value={row.description}
                                  onChange={(e) =>
                                    updateRow(row.filePath, { description: e.target.value })
                                  }
                                />
                              </div>
                              {row.entryType === 'expense' && (
                                <div>
                                  <label className="label text-[10px]">אחוז ניכוי</label>
                                  <select
                                    className="select w-full text-xs"
                                    value={row.deductionPercent}
                                    onChange={(e) =>
                                      updateRow(row.filePath, { deductionPercent: e.target.value })
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
                              {row.entryType === 'expense' && (
                                <label className="flex items-center gap-2 cursor-pointer mt-5 text-[11px] text-[#7a89ab]">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 accent-[#2dd4bf]"
                                    checked={row.isVatExempt}
                                    onChange={(e) =>
                                      updateRow(row.filePath, { isVatExempt: e.target.checked })
                                    }
                                  />
                                  פטור ממע״מ
                                </label>
                              )}
                            </div>

                            {amount > 0 && (
                              <div className="text-[11px] text-[#647399] mt-2">
                                {row.entryType === 'expense' && !row.isVatExempt ? (
                                  <>
                                    מחושב: {fmt(preview.computedExpense)} · ללא מע״מ:{' '}
                                    {fmt(preview.expenseExclVat)} · מע״מ תשומות:{' '}
                                    <span className="text-[#2dd4bf]">
                                      {fmt(preview.vatFromExpenses)}
                                    </span>
                                  </>
                                ) : row.entryType === 'income' && !row.isVatExempt ? (
                                  <>
                                    ללא מע״מ: {fmt(preview.incomeExclVat)} · מע״מ עסקאות:{' '}
                                    <span className="text-[#2dd4bf]">{fmt(preview.vatFromIncome)}</span>
                                  </>
                                ) : (
                                  <>פטור ממע״מ: {fmt(amount)}</>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#1d2b46]">
                  <div className="text-xs text-[#5a688c]">
                    {selectedCount} רשומות ייובאו לתקופה הרלוונטית
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={handleImport}
                    disabled={importing || busy || selectedCount === 0}
                  >
                    {importing ? 'מייבא...' : `ייבא ${selectedCount} רשומות`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
