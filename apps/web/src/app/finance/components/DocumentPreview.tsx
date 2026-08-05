'use client'

import {
  DOCUMENT_STRINGS,
  formatDocumentDate,
  formatDocumentMoney,
  interpolate,
} from '@ak-system/types'
import type { DocumentLanguage, PaymentMethod, SalesDocumentType } from '@ak-system/types'

const DEFAULT_LOGO = '/brand/alpir-logo.png'

export type PreviewIssuer = {
  businessName?: string
  businessNameEn?: string
  ownerName?: string
  taxId?: string
  address?: string
  addressEn?: string
  city?: string
  zipCode?: string
  phone?: string
  email?: string
  website?: string
  logoDataUrl?: string
  bankDetails?: string
  bankDetailsEn?: string
  footerText?: string
  footerTextEn?: string
}

export type PreviewDocument = {
  docType: SalesDocumentType | string
  docNumber?: number | null
  numberPrefix?: string | null
  status?: string
  language?: string
  issueDate: string
  dueDate?: string | null
  validUntil?: string | null
  clientName?: string | null
  clientTaxId?: string | null
  clientAddress?: string | null
  clientCountry?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  currency: string
  exchangeRate?: string | null
  totalIls?: string | null
  vatMode: string
  vatRate: string
  subtotal: string
  vatAmount: string
  total: string
  notes?: string | null
  allocationNumber?: string | null
}

export type PreviewLine = {
  id: string
  description: string
  quantity: string
  unitPrice: string
  discountPercent?: string | null
  lineTotal: string
}

export type PreviewPayment = {
  id: string
  method: string
  amount: string
  paidDate: string
  reference?: string | null
}

export function DocumentPreview({
  document,
  lines,
  payments,
  issuer,
  relatedNumber,
}: {
  document: PreviewDocument
  lines: PreviewLine[]
  payments?: PreviewPayment[]
  issuer?: PreviewIssuer | null
  relatedNumber?: number | null
}) {
  const language: DocumentLanguage = document.language === 'en' ? 'en' : 'he'
  const dir = language === 'en' ? 'ltr' : 'rtl'
  const strings = DOCUMENT_STRINGS[language]
  const currency = document.currency || 'ILS'
  const money = (value: string | number | null | undefined) =>
    formatDocumentMoney(typeof value === 'number' ? value : parseFloat(String(value ?? 0)) || 0, currency, language)

  const issuerName =
    (language === 'en' ? issuer?.businessNameEn : issuer?.businessName) ||
    issuer?.businessName ||
    'Alpir Consulting'
  const issuerAddress = language === 'en' ? issuer?.addressEn ?? issuer?.address : issuer?.address
  const bankDetails = language === 'en' ? issuer?.bankDetailsEn ?? issuer?.bankDetails : issuer?.bankDetails
  const footerText = language === 'en' ? issuer?.footerTextEn ?? issuer?.footerText : issuer?.footerText
  const logo = issuer?.logoDataUrl || DEFAULT_LOGO

  const docTypeLabel =
    strings.documentTypes[document.docType as SalesDocumentType] ?? String(document.docType)
  const displayNumber =
    document.docNumber != null
      ? `${document.numberPrefix ?? ''}${document.docNumber}`
      : language === 'he'
        ? 'טיוטה'
        : 'Draft'

  const exchangeRate = document.exchangeRate ? parseFloat(document.exchangeRate) : null
  const showIlsEquivalent = currency !== 'ILS' && exchangeRate != null
  const showDiscount = lines.some(
    (line) => line.discountPercent && parseFloat(line.discountPercent) > 0
  )
  const isReceipt =
    document.docType === 'receipt' || document.docType === 'tax_invoice_receipt'
  const issuerContactItems = [
    issuer?.taxId ? `${strings.taxId}: ${issuer.taxId}` : null,
    issuerAddress
      ? [issuerAddress, issuer?.city, issuer?.zipCode].filter(Boolean).join(', ')
      : null,
    issuer?.phone ? `${strings.phone}: ${issuer.phone}` : null,
    issuer?.email,
    issuer?.website,
  ].filter(Boolean) as string[]

  return (
    <div className="doc-sheet" dir={dir} lang={language}>
      <header className="doc-header">
        <div className="doc-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="doc-logo" src={logo} alt={issuerName} />
          {issuer?.ownerName && <div className="doc-owner-name">{issuer.ownerName}</div>}
        </div>

        <div className="doc-heading">
          <div className="doc-title">{docTypeLabel}</div>
          <div className="doc-number">
            {strings.documentNumber} {displayNumber}
          </div>
          {document.status === 'cancelled' && (
            <div className="doc-watermark" style={{ marginTop: 8 }}>
              {strings.cancelled}
            </div>
          )}
        </div>
      </header>

      {issuerContactItems.length > 0 && (
        <div className="doc-contact-strip" aria-label={issuerName}>
          {issuerContactItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}

      <section className="doc-meta-card">
        <div className="doc-client-block">
          <div className="doc-label">{strings.billTo}</div>
          <div className="doc-party-name">{document.clientName || '—'}</div>
          <div className="doc-issuer">
            {document.clientTaxId && (
              <div>
                {strings.taxId}: {document.clientTaxId}
              </div>
            )}
            {document.clientAddress && <div>{document.clientAddress}</div>}
            {document.clientCountry && document.clientCountry !== 'IL' && (
              <div>{document.clientCountry}</div>
            )}
            {document.clientEmail && <div>{document.clientEmail}</div>}
            {document.clientPhone && <div>{document.clientPhone}</div>}
          </div>
        </div>
        <div className="doc-details-block">
          <div className="doc-label">{strings.documentDetails}</div>
          <div className="doc-meta-row">
            <span>{strings.issueDate}</span>
            <strong>{formatDocumentDate(document.issueDate, language)}</strong>
          </div>
          {document.dueDate && (
            <div className="doc-meta-row">
              <span>{strings.dueDate}</span>
              <strong>{formatDocumentDate(document.dueDate, language)}</strong>
            </div>
          )}
          {document.validUntil && (
            <div className="doc-meta-row">
              <span>{strings.validUntil}</span>
              <strong>{formatDocumentDate(document.validUntil, language)}</strong>
            </div>
          )}
          {document.allocationNumber && (
            <div className="doc-meta-row">
              <span>{strings.allocationNumber}</span>
              <strong>{document.allocationNumber}</strong>
            </div>
          )}
        </div>
      </section>

      <table className="doc-table">
        <thead>
          <tr>
            <th className="doc-description-cell">{strings.colDescription}</th>
            <th className="doc-num-cell">{strings.colQuantity}</th>
            <th className="doc-num-cell">{strings.colUnitPrice}</th>
            {showDiscount && <th className="doc-num-cell">{strings.colDiscount}</th>}
            <th className="doc-num-cell">{strings.colLineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td className="doc-num-cell">{parseFloat(line.quantity) || 0}</td>
              <td className="doc-num-cell">{money(line.unitPrice)}</td>
              {showDiscount && (
                <td className="doc-num-cell">
                  {line.discountPercent && parseFloat(line.discountPercent) > 0
                    ? `${parseFloat(line.discountPercent)}%`
                    : '—'}
                </td>
              )}
              <td className="doc-num-cell">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-totals">
        <div className="doc-totals-card">
          <table>
            <tbody>
              <tr>
                <td className="doc-label">{strings.subtotal}</td>
                <td>{money(document.subtotal)}</td>
              </tr>
              <tr>
                <td className="doc-label">
                  {strings.vat}
                  {document.vatMode === 'standard'
                    ? ` ${Math.round((parseFloat(document.vatRate) || 0) * 100)}%`
                    : ' 0%'}
                </td>
                <td>{money(document.vatAmount)}</td>
              </tr>
              <tr className="doc-total-row">
                <td>{isReceipt ? strings.amountReceived : strings.total}</td>
                <td>{money(document.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {showIlsEquivalent && (
        <div className="doc-note" style={{ textAlign: dir === 'rtl' ? 'left' : 'right' }}>
          {interpolate(strings.ilsEquivalent, {
            amount: formatDocumentMoney(parseFloat(document.totalIls ?? '0') || 0, 'ILS', language),
            rate: String(exchangeRate),
          })}
        </div>
      )}

      {document.vatMode === 'zero_rated' && <div className="doc-note">{strings.zeroRatedNote}</div>}
      {document.vatMode === 'exempt' && <div className="doc-note">{strings.exemptNote}</div>}
      {document.docType === 'credit_invoice' && relatedNumber != null && (
        <div className="doc-note">
          {interpolate(strings.creditReferenceNote, { number: String(relatedNumber) })}
        </div>
      )}

      {payments && payments.length > 0 && (
        <>
          <div className="doc-section-title">{strings.paymentsTitle}</div>
          <table className="doc-table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>{strings.paymentMethodLabel}</th>
                <th>{strings.paymentDate}</th>
                <th>{strings.paymentReference}</th>
                <th className="doc-num-cell">{strings.colLineTotal}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{strings.paymentMethods[payment.method as PaymentMethod] ?? payment.method}</td>
                  <td>{formatDocumentDate(payment.paidDate, language)}</td>
                  <td>{payment.reference || '—'}</td>
                  <td className="doc-num-cell">{money(payment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {document.notes && (
        <>
          <div className="doc-section-title">{strings.notes}</div>
          <div className="doc-note" style={{ whiteSpace: 'pre-wrap' }}>
            {document.notes}
          </div>
        </>
      )}

      {bankDetails && (
        <div className="doc-info-box">
          <div className="doc-section-title">{strings.bankDetails}</div>
          <div className="doc-note" style={{ whiteSpace: 'pre-wrap' }}>
            {bankDetails}
          </div>
        </div>
      )}

      <footer className="doc-footer">
        <span>{issuerName}</span>
        <span>{footerText || strings.thankYou}</span>
      </footer>
    </div>
  )
}
