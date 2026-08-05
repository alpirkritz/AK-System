'use client'

import { useMemo, useState } from 'react'
import {
  DOCUMENT_STRINGS,
  SALES_DOCUMENT_STATUS_LABELS,
  SALES_DOCUMENT_TYPES,
  allowedConversions,
  canCancel,
  formatDocumentMoney,
  isTaxDocument,
} from '@ak-system/types'
import type { SalesDocumentType } from '@ak-system/types'
import { trpc } from '@/lib/trpc'
import { DocumentFormModal } from './components/DocumentFormModal'
import { PaymentModal } from './components/PaymentModal'

const STATUS_COLORS: Record<string, string> = {
  draft: '#647399',
  issued: '#2dd4bf',
  cancelled: '#fb7185',
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

export default function DocumentsTab() {
  const utils = trpc.useUtils()
  const currentYear = new Date().getFullYear()

  const [docTypeFilter, setDocTypeFilter] = useState<SalesDocumentType | ''>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'draft' | 'issued' | 'cancelled'>('')
  const [year, setYear] = useState(currentYear)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [paymentFor, setPaymentFor] = useState<{ id: string; amount: number } | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const { data: documents = [], isLoading } = trpc.salesDocuments.list.useQuery({
    docType: docTypeFilter || undefined,
    status: statusFilter || undefined,
    year,
    search: search.trim() || undefined,
    limit: 300,
  })
  const { data: summary } = trpc.salesDocuments.summary.useQuery({ year })

  const invalidate = () => {
    utils.salesDocuments.list.invalidate()
    utils.salesDocuments.summary.invalidate()
  }

  const removeDocument = trpc.salesDocuments.remove.useMutation({
    onSuccess: invalidate,
    onError: (err) => setBanner(err.message),
  })
  const duplicateDocument = trpc.salesDocuments.duplicate.useMutation({
    onSuccess: () => {
      setBanner('נוצרה טיוטה חדשה מהעתקה')
      invalidate()
    },
  })
  const convertDocument = trpc.salesDocuments.convert.useMutation({
    onSuccess: () => {
      setBanner('נוצרה טיוטה חדשה מההמרה')
      invalidate()
    },
    onError: (err) => setBanner(err.message),
  })
  const createCredit = trpc.salesDocuments.createCreditFor.useMutation({
    onSuccess: () => {
      setBanner('נוצרה טיוטת חשבונית זיכוי — יש לבדוק ולהנפיק')
      invalidate()
    },
    onError: (err) => setBanner(err.message),
  })
  const cancelDocument = trpc.salesDocuments.cancel.useMutation({
    onSuccess: invalidate,
    onError: (err) => setBanner(err.message),
  })

  const years = useMemo(() => {
    const list: number[] = []
    for (let value = currentYear; value >= currentYear - 5; value--) list.push(value)
    return list
  }, [currentYear])

  const openNew = () => {
    setEditingId(null)
    setFormOpen(true)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          className="select"
          style={{ maxWidth: 190 }}
          aria-label="סינון לפי סוג מסמך"
          value={docTypeFilter}
          onChange={(e) => setDocTypeFilter(e.target.value as SalesDocumentType | '')}
        >
          <option value="">כל הסוגים</option>
          {SALES_DOCUMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {DOCUMENT_STRINGS.he.documentTypes[value]}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ maxWidth: 140 }}
          aria-label="סינון לפי סטטוס"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="">כל הסטטוסים</option>
          {(['draft', 'issued', 'cancelled'] as const).map((value) => (
            <option key={value} value={value}>
              {SALES_DOCUMENT_STATUS_LABELS[value]}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ maxWidth: 110 }}
          aria-label="סינון לפי שנה"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="חיפוש לפי לקוח..."
          aria-label="חיפוש מסמכים"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex-1" />

        <a className="btn btn-ghost text-sm" href="/settings/business">
          פרטי עוסק
        </a>
        <button className="btn btn-primary text-sm" onClick={openNew}>
          + מסמך חדש
        </button>
      </div>

      {summary && summary.count > 0 && (
        <div className="text-xs text-[#5a688c] mb-4">
          {summary.count} מסמכים ב-{year} · הכנסות שהונפקו:{' '}
          {formatDocumentMoney(summary.issuedTotalIls, 'ILS', 'he')}
        </div>
      )}

      {banner && (
        <div
          className="mb-4 text-xs px-3 py-2 rounded-lg bg-[#2dd4bf11] border border-[#2dd4bf33] text-[#2dd4bf] flex items-center justify-between gap-3"
          role="status"
        >
          <span>{banner}</span>
          <button className="btn btn-ghost text-[11px] py-1 px-2" onClick={() => setBanner(null)}>
            סגור
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-[#5a688c] text-sm">טוען...</div>
      ) : documents.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">🧾</div>
          <div className="text-[#5a688c] text-sm">עדיין אין מסמכים</div>
          <button className="btn btn-primary text-sm mt-4" onClick={openNew}>
            צור הצעת מחיר ראשונה
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-[#29395d]">
                {['תאריך', 'סוג', 'מספר', 'לקוח', 'סכום', 'שולם', 'סטטוס'].map((header) => (
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
              {documents.map((doc) => {
                const docType = doc.docType as SalesDocumentType
                const total = parseFloat(doc.total) || 0
                const conversions = allowedConversions(docType)
                return (
                  <tr
                    key={doc.id}
                    className="border-b border-[#1d2b46] hover:bg-[#1d2b46] transition-colors group"
                  >
                    <td className="px-4 py-3 text-[#647399] whitespace-nowrap">
                      {fmtDate(doc.issueDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {DOCUMENT_STRINGS.he.documentTypes[docType] ?? docType}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {doc.docNumber != null ? `${doc.numberPrefix ?? ''}${doc.docNumber}` : '—'}
                    </td>
                    <td className="px-4 py-3 max-w-[190px] truncate">{doc.clientName ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatDocumentMoney(total, doc.currency, 'he')}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[#647399]">
                      {doc.paidAmount > 0
                        ? formatDocumentMoney(doc.paidAmount, doc.currency, 'he')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="pill text-xs"
                        style={{
                          color: STATUS_COLORS[doc.status] ?? '#647399',
                          borderColor: `${STATUS_COLORS[doc.status] ?? '#647399'}44`,
                        }}
                      >
                        {SALES_DOCUMENT_STATUS_LABELS[
                          doc.status as keyof typeof SALES_DOCUMENT_STATUS_LABELS
                        ] ?? doc.status}
                      </span>
                      {doc.language === 'en' && (
                        <span className="pill text-[10px] mr-1">EN</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <a
                          className="btn btn-ghost text-[11px] py-1 px-2"
                          href={`/finance/documents/${doc.id}/print`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          הדפס
                        </a>
                        {doc.status === 'draft' && (
                          <button
                            className="btn btn-ghost text-[11px] py-1 px-2"
                            onClick={() => {
                              setEditingId(doc.id)
                              setFormOpen(true)
                            }}
                          >
                            ערוך
                          </button>
                        )}
                        {doc.status === 'issued' && (
                          <button
                            className="btn btn-ghost text-[11px] py-1 px-2"
                            onClick={() => setPaymentFor({ id: doc.id, amount: total - doc.paidAmount })}
                          >
                            תשלום
                          </button>
                        )}
                        {doc.status === 'issued' && conversions.length > 0 && (
                          <button
                            className="btn btn-ghost text-[11px] py-1 px-2"
                            onClick={() =>
                              convertDocument.mutate({ id: doc.id, targetType: conversions[0] })
                            }
                          >
                            ← {DOCUMENT_STRINGS.he.documentTypes[conversions[0]]}
                          </button>
                        )}
                        {doc.status === 'issued' &&
                          isTaxDocument(docType) &&
                          docType !== 'credit_invoice' && (
                            <button
                              className="btn btn-ghost text-[11px] py-1 px-2"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    'ליצור טיוטת חשבונית זיכוי עבור מסמך זה? הזיכוי דורש רישום ידני בדיווח המע"מ.'
                                  )
                                ) {
                                  createCredit.mutate({ taxInvoiceId: doc.id })
                                }
                              }}
                            >
                              זיכוי
                            </button>
                          )}
                        {doc.status === 'issued' && canCancel(docType) && (
                          <button
                            className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                            onClick={() => {
                              const reason = window.prompt('סיבת הביטול:')
                              if (reason) cancelDocument.mutate({ id: doc.id, reason })
                            }}
                          >
                            בטל
                          </button>
                        )}
                        <button
                          className="btn btn-ghost text-[11px] py-1 px-2"
                          onClick={() => duplicateDocument.mutate({ id: doc.id })}
                        >
                          שכפל
                        </button>
                        {doc.status === 'draft' && (
                          <button
                            className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                            onClick={() => {
                              if (window.confirm('למחוק את הטיוטה? הפעולה בלתי הפיכה.')) {
                                removeDocument.mutate({ id: doc.id })
                              }
                            }}
                          >
                            מחק
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <DocumentFormModal
        open={formOpen}
        documentId={editingId}
        onClose={() => {
          setFormOpen(false)
          setEditingId(null)
        }}
      />

      {paymentFor && (
        <PaymentModal
          open
          documentId={paymentFor.id}
          suggestedAmount={paymentFor.amount > 0 ? paymentFor.amount : undefined}
          onClose={() => setPaymentFor(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}
