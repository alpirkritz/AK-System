'use client'

import { useEffect, useRef, useState } from 'react'
import { PAYMENT_METHODS, DOCUMENT_STRINGS } from '@ak-system/types'
import type { PaymentMethod } from '@ak-system/types'
import { trpc } from '@/lib/trpc'

export function PaymentModal({
  open,
  documentId,
  suggestedAmount,
  onClose,
  onSaved,
}: {
  open: boolean
  documentId: string
  suggestedAmount?: number
  onClose: () => void
  onSaved?: () => void
}) {
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [amount, setAmount] = useState('')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  const addPayment = trpc.salesDocuments.addPayment.useMutation({
    onSuccess: () => {
      onSaved?.()
      onClose()
    },
    onError: (err) => setError(err.message || 'שמירת התשלום נכשלה. נסה שוב.'),
  })

  useEffect(() => {
    if (!open) return
    setMethod('bank_transfer')
    setAmount(suggestedAmount != null ? String(suggestedAmount) : '')
    setPaidDate(new Date().toISOString().slice(0, 10))
    setReference('')
    setError(null)
  }, [open, suggestedAmount])

  useEffect(() => {
    if (!open) return
    amountRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled])'
      )
      if (!nodes || nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = parseFloat(amount)
    if (!value || addPayment.isPending) return
    setError(null)
    addPayment.mutate({
      documentId,
      method,
      amount: value,
      paidDate,
      reference: reference.trim() || null,
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="הוספת תשלום"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-bold text-lg mb-6 tracking-tight">הוספת תשלום</div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          <div>
            <label className="label" htmlFor="payment-amount">
              סכום
            </label>
            <input
              id="payment-amount"
              ref={amountRef}
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="payment-method">
              אמצעי תשלום
            </label>
            <select
              id="payment-method"
              className="select"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {DOCUMENT_STRINGS.he.paymentMethods[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="payment-date">
              תאריך תשלום
            </label>
            <input
              id="payment-date"
              className="input"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="payment-reference">
              אסמכתא (אופציונלי)
            </label>
            <input
              id="payment-reference"
              className="input"
              placeholder="מספר שיק, אסמכתת העברה..."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
            <button type="submit" className="btn btn-primary" disabled={addPayment.isPending}>
              {addPayment.isPending ? 'שומר...' : 'שמור תשלום'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
