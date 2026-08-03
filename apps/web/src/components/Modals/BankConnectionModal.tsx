'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

type Provider = 'hapoalim' | 'otsarHahayal' | 'visaCal' | 'isracard'

export const PROVIDER_LABELS: Record<Provider, string> = {
  hapoalim: 'בנק הפועלים',
  otsarHahayal: 'בנק אוצר החייל',
  visaCal: 'ויזה כאל',
  isracard: 'ישראכרט',
}

interface FormState {
  provider: Provider
  displayName: string
  userCode: string
  username: string
  id: string
  card6Digits: string
  password: string
}

const EMPTY_FORM: FormState = {
  provider: 'hapoalim',
  displayName: '',
  userCode: '',
  username: '',
  id: '',
  card6Digits: '',
  password: '',
}

export function BankConnectionModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM })
  const [error, setError] = useState<string | null>(null)
  const utils = trpc.useUtils()

  const create = trpc.finance.bankConnections.create.useMutation({
    onSuccess: () => {
      utils.finance.bankConnections.list.invalidate()
      utils.finance.getAccountsSnapshot.invalidate()
      setForm({ ...EMPTY_FORM })
      setError(null)
      onClose()
    },
    onError: (err) => setError(err.message),
  })

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const { provider, displayName, password } = form
    if (!displayName || !password) return
    if (provider === 'hapoalim') {
      create.mutate({ provider, displayName, userCode: form.userCode, password })
    } else if (provider === 'otsarHahayal' || provider === 'visaCal') {
      create.mutate({ provider, displayName, username: form.username, password })
    } else {
      create.mutate({ provider, displayName, id: form.id, card6Digits: form.card6Digits, password })
    }
  }

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-5 tracking-tight">חיבור חשבון חדש</div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="label">ספק</label>
            <select className="select" value={form.provider} onChange={set('provider')}>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">שם תצוגה</label>
            <input
              className="input"
              value={form.displayName}
              onChange={set('displayName')}
              placeholder='למשל: הפועלים עו"ש'
              required
            />
          </div>

          {form.provider === 'hapoalim' && (
            <div>
              <label className="label">קוד משתמש</label>
              <input className="input" value={form.userCode} onChange={set('userCode')} required />
            </div>
          )}

          {(form.provider === 'otsarHahayal' || form.provider === 'visaCal') && (
            <div>
              <label className="label">שם משתמש</label>
              <input className="input" value={form.username} onChange={set('username')} required />
            </div>
          )}

          {form.provider === 'isracard' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">תעודת זהות</label>
                <input className="input" value={form.id} onChange={set('id')} required />
              </div>
              <div>
                <label className="label">6 ספרות אחרונות של הכרטיס</label>
                <input
                  className="input"
                  value={form.card6Digits}
                  onChange={set('card6Digits')}
                  maxLength={6}
                  pattern="\d{6}"
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label className="label">סיסמה</label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="off"
              required
            />
          </div>

          <div className="text-xs text-[#5a688c]">
            הגישה לקריאה בלבד — מומלץ להשתמש בהרשאות צפייה בלבד אם הבנק מאפשר.
            הפרטים מוצפנים (AES-256) ונשמרים רק במסד הנתונים המקומי שלך.
          </div>

          {error && (
            <div className="text-xs text-red-400 px-3 py-2 rounded-lg" style={{ background: '#fb718511', border: '1px solid #fb718533' }}>
              {error}
            </div>
          )}

          <div className="flex gap-2 mt-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={create.isLoading}>
              {create.isLoading ? 'שומר...' : '+ הוסף חיבור'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
