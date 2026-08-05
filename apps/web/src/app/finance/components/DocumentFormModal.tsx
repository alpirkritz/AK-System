'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DOCUMENT_CURRENCIES,
  DOCUMENT_STRINGS,
  PAYMENT_METHODS,
  SALES_DOCUMENT_TYPES,
  VAT_MODES,
  VAT_MODE_LABELS,
  VAT_RATE,
  allocationThresholdFor,
  computeDocumentTotals,
  formatDocumentMoney,
  requiresAllocationNumber,
  requiresPayment,
} from '@ak-system/types'
import type {
  DocumentLanguage,
  PaymentMethod,
  SalesDocumentType,
  VatMode,
} from '@ak-system/types'
import { trpc } from '@/lib/trpc'
import { DocumentLinesEditor, emptyLine, type LineDraft } from './DocumentLinesEditor'
import { DocumentPreview } from './DocumentPreview'

const today = () => new Date().toISOString().slice(0, 10)

export function DocumentFormModal({
  open,
  documentId,
  initialDocType,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Set when editing an existing draft. */
  documentId?: string | null
  initialDocType?: SalesDocumentType
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const utils = trpc.useUtils()
  const modalRef = useRef<HTMLDivElement>(null)

  const [docType, setDocType] = useState<SalesDocumentType>(initialDocType ?? 'tax_invoice')
  const [language, setLanguage] = useState<DocumentLanguage>('he')
  const [companyId, setCompanyId] = useState<string>('')
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [currency, setCurrency] = useState('ILS')
  const [exchangeRate, setExchangeRate] = useState('')
  const [vatMode, setVatMode] = useState<VatMode>('standard')
  const [notes, setNotes] = useState('')
  const [allocationNumber, setAllocationNumber] = useState('')
  const [relatedDocumentId, setRelatedDocumentId] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [payMethod, setPayMethod] = useState<PaymentMethod>('bank_transfer')
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(today())
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissedForeignHint, setDismissedForeignHint] = useState(false)
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanyTaxId, setNewCompanyTaxId] = useState('')

  const { data: companies = [] } = trpc.companies.list.useQuery(undefined, { enabled: open })
  const { data: catalog = [] } = trpc.serviceItems.list.useQuery(undefined, { enabled: open })
  const { data: profile } = trpc.settings.businessProfile.get.useQuery(undefined, { enabled: open })
  const { data: nextNumber } = trpc.salesDocuments.nextNumber.useQuery(
    { docType },
    { enabled: open }
  )
  const { data: prices = {} } = trpc.serviceItems.pricesForClient.useQuery(
    { companyId: companyId || null, currency },
    { enabled: open }
  )
  const { data: existing } = trpc.salesDocuments.get.useQuery(
    { id: documentId ?? '' },
    { enabled: open && Boolean(documentId) }
  )
  const { data: issuedInvoices = [] } = trpc.salesDocuments.list.useQuery(
    { status: 'issued', docType: 'tax_invoice', limit: 100 },
    { enabled: open && docType === 'credit_invoice' }
  )

  const selectedCompany = companies.find((company) => company.id === companyId)

  const resetForm = useCallback(() => {
    setDocType(initialDocType ?? 'tax_invoice')
    setLanguage('he')
    setCompanyId('')
    setIssueDate(today())
    setDueDate('')
    setValidUntil('')
    setCurrency('ILS')
    setExchangeRate('')
    setVatMode('standard')
    setNotes('')
    setAllocationNumber('')
    setRelatedDocumentId('')
    setLines([emptyLine()])
    setPayAmount('')
    setPayDate(today())
    setShowPreview(false)
    setError(null)
    setDismissedForeignHint(false)
    setShowNewCompany(false)
    setNewCompanyName('')
    setNewCompanyTaxId('')
  }, [initialDocType])

  useEffect(() => {
    if (open && !documentId) resetForm()
  }, [open, documentId, resetForm])

  // Hydrate from an existing draft.
  useEffect(() => {
    if (!open || !documentId || !existing?.document) return
    const doc = existing.document
    setDocType(doc.docType as SalesDocumentType)
    setLanguage(doc.language === 'en' ? 'en' : 'he')
    setCompanyId(doc.companyId ?? '')
    setIssueDate(doc.issueDate)
    setDueDate(doc.dueDate ?? '')
    setValidUntil(doc.validUntil ?? '')
    setCurrency(doc.currency)
    setExchangeRate(doc.exchangeRate ?? '')
    setVatMode(doc.vatMode as VatMode)
    setNotes(doc.notes ?? '')
    setAllocationNumber(doc.allocationNumber ?? '')
    setRelatedDocumentId(doc.relatedDocumentId ?? '')
    setLines(
      existing.lines.length > 0
        ? existing.lines.map((line) => ({
            key: line.id,
            serviceItemId: line.serviceItemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent ?? '',
            vatApplicable: Boolean(line.vatApplicable),
            priceSource: (line.priceSource as LineDraft['priceSource']) ?? 'manual',
            priceEditedManually: true,
            pinToClient: false,
          }))
        : [emptyLine()]
    )
  }, [open, documentId, existing])

  // Language follows the client's preference unless it was already chosen.
  useEffect(() => {
    if (!selectedCompany || documentId) return
    setLanguage(selectedCompany.preferredLanguage === 'en' ? 'en' : 'he')
  }, [selectedCompany, documentId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const totals = useMemo(
    () =>
      computeDocumentTotals(
        lines.map((line) => ({
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          discountPercent: parseFloat(line.discountPercent) || 0,
          vatApplicable: line.vatApplicable,
        })),
        { vatRate: VAT_RATE, vatMode }
      ),
    [lines, vatMode]
  )

  const createCompany = trpc.companies.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.companies.list.invalidate()
      setCompanyId(id)
      setShowNewCompany(false)
      setNewCompanyName('')
      setNewCompanyTaxId('')
    },
  })

  const createServiceItem = trpc.serviceItems.create.useMutation({
    onSuccess: () => utils.serviceItems.list.invalidate(),
  })
  const pinPrice = trpc.serviceItems.pinPrice.useMutation()
  const createDraft = trpc.salesDocuments.createDraft.useMutation()
  const updateDraft = trpc.salesDocuments.updateDraft.useMutation()
  const addPayment = trpc.salesDocuments.addPayment.useMutation()
  const issue = trpc.salesDocuments.issue.useMutation()

  const foreignClient = Boolean(selectedCompany && selectedCompany.country !== 'IL')
  const showForeignHint =
    foreignClient && !dismissedForeignHint && (language !== 'en' || vatMode !== 'zero_rated')

  const needsAllocation = requiresAllocationNumber({
    issueDate,
    subtotal: totals.subtotal,
    clientTaxId: selectedCompany?.taxId ?? null,
    docType,
    vatMode,
  })

  const missingRate = currency !== 'ILS' && !(parseFloat(exchangeRate) > 0)
  const needsPayment = requiresPayment(docType)
  const paymentReady = !needsPayment || parseFloat(payAmount) > 0 || Boolean(documentId)
  const hasLines = lines.some((line) => line.description.trim() && parseFloat(line.unitPrice) >= 0)

  const buildLinePayload = () =>
    lines
      .filter((line) => line.description.trim())
      .map((line) => ({
        serviceItemId: line.serviceItemId,
        priceSource: line.priceSource,
        description: line.description.trim(),
        quantity: parseFloat(line.quantity) || 0,
        unitPrice: parseFloat(line.unitPrice) || 0,
        discountPercent: parseFloat(line.discountPercent) || 0,
        vatApplicable: line.vatApplicable,
      }))

  const persistPins = async () => {
    if (!companyId) return
    for (const line of lines) {
      if (!line.pinToClient || !line.serviceItemId) continue
      await pinPrice.mutateAsync({
        companyId,
        serviceItemId: line.serviceItemId,
        unitPrice: parseFloat(line.unitPrice) || 0,
        currency,
      })
    }
  }

  const save = async (): Promise<string | null> => {
    const payload = {
      language,
      companyId: companyId || null,
      issueDate,
      dueDate: dueDate || null,
      validUntil: validUntil || null,
      currency,
      exchangeRate: currency === 'ILS' ? null : parseFloat(exchangeRate) || null,
      vatMode,
      notes: notes.trim() || null,
      relatedDocumentId: relatedDocumentId || null,
      lines: buildLinePayload(),
    }

    if (documentId) {
      await updateDraft.mutateAsync({ id: documentId, ...payload })
      await persistPins()
      return documentId
    }

    const created = await createDraft.mutateAsync({ docType, ...payload })
    if (needsPayment && parseFloat(payAmount) > 0) {
      await addPayment.mutateAsync({
        documentId: created.id,
        method: payMethod,
        amount: parseFloat(payAmount),
        paidDate: payDate,
      })
    }
    await persistPins()
    return created.id
  }

  const invalidate = async () => {
    await Promise.all([
      utils.salesDocuments.list.invalidate(),
      utils.salesDocuments.summary.invalidate(),
      utils.serviceItems.pricesForClient.invalidate(),
    ])
  }

  const handleSaveDraft = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const id = await save()
      await invalidate()
      if (id) onSaved?.(id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירת הטיוטה נכשלה. נסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  const handleIssue = async () => {
    if (busy) return
    const label = DOCUMENT_STRINGS.he.documentTypes[docType]
    const number = nextNumber?.number ?? ''
    if (
      !window.confirm(
        `להנפיק ${label} ${number}? לאחר ההנפקה לא ניתן לערוך — ביטול מחייב חשבונית זיכוי.`
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = await save()
      if (!id) return
      await issue.mutateAsync({ id, allocationNumber: allocationNumber.trim() || null })
      await invalidate()
      onSaved?.(id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההנפקה נכשלה. נסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  const handleAddToCatalog = async (line: LineDraft) => {
    const created = await createServiceItem.mutateAsync({
      name: line.description.trim(),
      unit: 'item',
      defaultUnitPrice: parseFloat(line.unitPrice) || 0,
      currency,
      vatApplicable: line.vatApplicable,
    })
    setLines((current) =>
      current.map((item) =>
        item.key === line.key ? { ...item, serviceItemId: created.id } : item
      )
    )
  }

  if (!open) return null

  const previewDocument = {
    docType,
    docNumber: nextNumber?.number ?? null,
    numberPrefix: profile?.numberPrefix ?? null,
    status: 'draft',
    language,
    issueDate,
    dueDate: dueDate || null,
    validUntil: validUntil || null,
    clientName: selectedCompany?.name ?? null,
    clientTaxId: selectedCompany?.taxId ?? null,
    clientAddress:
      [selectedCompany?.address, selectedCompany?.city, selectedCompany?.zipCode]
        .filter(Boolean)
        .join(', ') || null,
    clientCountry: selectedCompany?.country ?? null,
    clientEmail: selectedCompany?.email ?? null,
    clientPhone: selectedCompany?.phone ?? null,
    currency,
    exchangeRate: exchangeRate || null,
    totalIls: String(totals.total * (parseFloat(exchangeRate) || 1)),
    vatMode,
    vatRate: String(vatMode === 'standard' ? VAT_RATE : 0),
    subtotal: String(totals.subtotal),
    vatAmount: String(totals.vatAmount),
    total: String(totals.total),
    notes: notes || null,
    allocationNumber: allocationNumber || null,
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={documentId ? 'עריכת טיוטה' : 'מסמך חדש'}
        style={{ width: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="font-bold text-lg tracking-tight">
            {documentId ? 'עריכת טיוטה' : 'מסמך חדש'}
          </div>
          <div className="flex gap-1" role="group" aria-label="שפת המסמך">
            {(['he', 'en'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="btn btn-ghost text-xs"
                style={{
                  color: language === value ? '#2dd4bf' : '#647399',
                  borderColor: language === value ? '#2dd4bf44' : '#2f4368',
                }}
                onClick={() => setLanguage(value)}
              >
                {value === 'he' ? 'עברית' : 'English'}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2 mb-4"
          >
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="doc-type">
                סוג מסמך
              </label>
              <select
                id="doc-type"
                className="select"
                value={docType}
                disabled={Boolean(documentId)}
                onChange={(e) => setDocType(e.target.value as SalesDocumentType)}
              >
                {SALES_DOCUMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {DOCUMENT_STRINGS.he.documentTypes[value]}
                  </option>
                ))}
              </select>
              {nextNumber && (
                <div className="text-[11px] text-[#5a688c] mt-1">
                  המספר הבא: {nextNumber.display}
                </div>
              )}
            </div>

            <div>
              <label className="label" htmlFor="doc-company">
                לקוח
              </label>
              <select
                id="doc-company"
                className="select"
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value)
                  setDismissedForeignHint(false)
                }}
              >
                <option value="">בחר חברה...</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost text-[11px] py-1 px-2 mt-1"
                onClick={() => setShowNewCompany((value) => !value)}
              >
                {showNewCompany ? 'ביטול' : '+ חברה חדשה'}
              </button>
            </div>
          </div>

          {showNewCompany && (
            <div className="rounded-xl border border-[#2f4368] bg-[#16233b] p-3 flex flex-col gap-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="new-company-name">
                    שם החברה
                  </label>
                  <input
                    id="new-company-name"
                    className="input"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="new-company-tax">
                    ח.פ. / עוסק מורשה
                  </label>
                  <input
                    id="new-company-tax"
                    className="input"
                    value={newCompanyTaxId}
                    onChange={(e) => setNewCompanyTaxId(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary text-xs self-start"
                disabled={!newCompanyName.trim() || createCompany.isPending}
                onClick={() =>
                  createCompany.mutate({
                    name: newCompanyName.trim(),
                    taxId: newCompanyTaxId.trim() || null,
                  })
                }
              >
                {createCompany.isPending ? 'שומר...' : 'צור והמשך'}
              </button>
            </div>
          )}

          {showForeignHint && (
            <div className="rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-3 bg-[#38bdf811] border border-[#38bdf833] text-[#7dd3fc]">
              <span>לקוח בחו"ל: יצוא שירותים בשיעור מע"מ אפס. להחיל אנגלית ושיעור אפס?</span>
              <span className="flex gap-2 shrink-0">
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1 px-2"
                  onClick={() => {
                    setLanguage('en')
                    setVatMode('zero_rated')
                    setDismissedForeignHint(true)
                  }}
                >
                  החל
                </button>
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1 px-2"
                  onClick={() => setDismissedForeignHint(true)}
                >
                  לא, תודה
                </button>
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="doc-issue-date">
                תאריך
              </label>
              <input
                id="doc-issue-date"
                className="input"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            {docType === 'quote' ? (
              <div>
                <label className="label" htmlFor="doc-valid-until">
                  בתוקף עד
                </label>
                <input
                  id="doc-valid-until"
                  className="input"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <label className="label" htmlFor="doc-due-date">
                  לתשלום עד
                </label>
                <input
                  id="doc-due-date"
                  className="input"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor="doc-vat-mode">
                מצב מע"מ
              </label>
              <select
                id="doc-vat-mode"
                className="select"
                value={vatMode}
                onChange={(e) => setVatMode(e.target.value as VatMode)}
              >
                {VAT_MODES.map((value) => (
                  <option key={value} value={value}>
                    {VAT_MODE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="doc-currency">
                מטבע
              </label>
              <select
                id="doc-currency"
                className="select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {DOCUMENT_CURRENCIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            {currency !== 'ILS' && (
              <div>
                <label className="label" htmlFor="doc-rate">
                  שער המרה ל-₪
                </label>
                <input
                  id="doc-rate"
                  className="input"
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="3.7"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                />
              </div>
            )}
          </div>

          {docType === 'credit_invoice' && (
            <div>
              <label className="label" htmlFor="doc-related">
                חשבונית מס מזוכה
              </label>
              <select
                id="doc-related"
                className="select"
                value={relatedDocumentId}
                onChange={(e) => setRelatedDocumentId(e.target.value)}
              >
                <option value="">בחר חשבונית...</option>
                {issuedInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    #{invoice.docNumber} · {invoice.clientName ?? ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="label">שורות</div>
            <DocumentLinesEditor
              lines={lines}
              onChange={setLines}
              catalog={catalog}
              prices={prices}
              currency={currency}
              canPin={Boolean(companyId)}
              onAddToCatalog={handleAddToCatalog}
              disabled={busy}
            />
          </div>

          {needsPayment && !documentId && (
            <div className="rounded-xl border border-[#2f4368] bg-[#16233b] p-3">
              <div className="text-xs text-[#7a89ab] mb-2">
                מסמך זה מחייב תשלום אחד לפחות לפני ההנפקה.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="label" htmlFor="doc-pay-amount">
                    סכום שהתקבל
                  </label>
                  <input
                    id="doc-pay-amount"
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px] py-1 px-2 mt-1"
                    onClick={() => setPayAmount(String(totals.total))}
                  >
                    מלא סכום מלא
                  </button>
                </div>
                <div>
                  <label className="label" htmlFor="doc-pay-method">
                    אמצעי תשלום
                  </label>
                  <select
                    id="doc-pay-method"
                    className="select"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  >
                    {PAYMENT_METHODS.map((value) => (
                      <option key={value} value={value}>
                        {DOCUMENT_STRINGS.he.paymentMethods[value]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="doc-pay-date">
                    תאריך תשלום
                  </label>
                  <input
                    id="doc-pay-date"
                    className="input"
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor="doc-notes">
              הערות למסמך
            </label>
            <textarea
              id="doc-notes"
              className="input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {needsAllocation && (
            <div className="rounded-lg px-3 py-2 text-xs bg-[#fbbf2411] border border-[#fbbf2433] text-[#fbbf24]">
              <div className="mb-2">
                עסקה מעל {allocationThresholdFor(issueDate).toLocaleString('he-IL')} ₪ מול עוסק מורשה —
                ללא מספר הקצאה הלקוח לא יוכל לנכות מע"מ.
              </div>
              <input
                className="input"
                placeholder="מספר הקצאה מרשות המסים"
                aria-label="מספר הקצאה"
                value={allocationNumber}
                onChange={(e) => setAllocationNumber(e.target.value)}
              />
            </div>
          )}

          {missingRate && (
            <div className="rounded-lg px-3 py-2 text-xs bg-[#fb718511] border border-[#fb718533] text-[#fb7185]">
              הזן שער המרה — נדרש לרישום המע"מ בשקלים.
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[#1d2b46] pt-3">
            <div className="text-xs text-[#5a688c]">
              לפני מע"מ {formatDocumentMoney(totals.subtotal, currency, 'he')} · מע"מ{' '}
              {formatDocumentMoney(totals.vatAmount, currency, 'he')}
            </div>
            <div className="text-lg font-bold tracking-tight">
              {formatDocumentMoney(totals.total, currency, 'he')}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost text-xs self-start"
            onClick={() => setShowPreview((value) => !value)}
          >
            {showPreview ? '▲ הסתר תצוגה מקדימה' : '▼ תצוגה מקדימה'}
          </button>

          {showPreview && (
            <div className="rounded-xl overflow-auto" style={{ maxHeight: 460 }}>
              <div style={{ transform: 'scale(0.72)', transformOrigin: 'top center' }}>
                <DocumentPreview
                  document={previewDocument}
                  lines={lines
                    .filter((line) => line.description.trim())
                    .map((line) => ({
                      id: line.key,
                      description: line.description,
                      quantity: line.quantity,
                      unitPrice: line.unitPrice || '0',
                      discountPercent: line.discountPercent || null,
                      lineTotal: String(
                        (parseFloat(line.quantity) || 0) *
                          (parseFloat(line.unitPrice) || 0) *
                          (1 - (parseFloat(line.discountPercent) || 0) / 100)
                      ),
                    }))}
                  issuer={profile ?? null}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              ביטול
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleSaveDraft}
              disabled={busy || !hasLines || missingRate}
            >
              {busy ? 'שומר...' : 'שמור טיוטה'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleIssue}
              disabled={busy || !hasLines || missingRate || !paymentReady}
            >
              {busy ? 'מנפיק...' : 'הנפק'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
