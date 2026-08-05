'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { DOCUMENT_STRINGS, SALES_DOCUMENT_TYPES } from '@ak-system/types'
import type { SalesDocumentType } from '@ak-system/types'
import { trpc } from '@/lib/trpc'

type Form = {
  businessName: string
  businessNameEn: string
  ownerName: string
  taxId: string
  taxIdType: 'osek_morshe' | 'osek_patur' | 'company'
  address: string
  addressEn: string
  city: string
  zipCode: string
  phone: string
  email: string
  website: string
  logoDataUrl: string
  bankDetails: string
  bankDetailsEn: string
  footerText: string
  footerTextEn: string
  defaultPaymentTerms: string
  defaultLanguage: 'he' | 'en'
  numberPrefix: string
}

const EMPTY: Form = {
  businessName: '',
  businessNameEn: '',
  ownerName: '',
  taxId: '',
  taxIdType: 'osek_morshe',
  address: '',
  addressEn: '',
  city: '',
  zipCode: '',
  phone: '',
  email: '',
  website: '',
  logoDataUrl: '',
  bankDetails: '',
  bankDetailsEn: '',
  footerText: '',
  footerTextEn: '',
  defaultPaymentTerms: '',
  defaultLanguage: 'he',
  numberPrefix: '',
}

const MAX_LOGO_BYTES = 400_000

export default function BusinessSettingsPage() {
  const utils = trpc.useUtils()
  const { data: profile, isLoading } = trpc.settings.businessProfile.get.useQuery()
  const [form, setForm] = useState<Form>(EMPTY)
  const [startNumbers, setStartNumbers] = useState<Partial<Record<SalesDocumentType, string>>>({})
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!profile) return
    setForm({ ...EMPTY, ...(profile as Partial<Form>) })
    const numbers: Partial<Record<SalesDocumentType, string>> = {}
    for (const [key, value] of Object.entries(profile.startNumbers ?? {})) {
      if (value != null) numbers[key as SalesDocumentType] = String(value)
    }
    setStartNumbers(numbers)
  }, [profile])

  const save = trpc.settings.businessProfile.set.useMutation({
    onSuccess: () => {
      utils.settings.businessProfile.get.invalidate()
      setSaved(true)
      setError(null)
      window.setTimeout(() => setSaved(false), 2500)
    },
    onError: (err) => setError(err.message || 'השמירה נכשלה. נסה שוב.'),
  })

  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))

  const handleLogo = (file: File) => {
    if (file.size > MAX_LOGO_BYTES) {
      setError('הלוגו גדול מדי — עד 400KB. נסה קובץ קטן יותר.')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result === 'string') {
        set({ logoDataUrl: result })
        setError(null)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const numbers: Partial<Record<SalesDocumentType, number>> = {}
    for (const [key, value] of Object.entries(startNumbers)) {
      const parsed = parseInt(value ?? '', 10)
      if (parsed > 0) numbers[key as SalesDocumentType] = parsed
    }
    save.mutate({ ...form, startNumbers: numbers })
  }

  if (isLoading) {
    return <div className="text-[#5a688c] text-sm">טוען...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">פרטי העוסק</h1>
          <p className="text-xs text-[#5a688c] mt-1">
            הפרטים כאן מודפסים על כל מסמך מכירה. שינוי לא משפיע על מסמכים שכבר הונפקו.
          </p>
        </div>
        <Link className="btn btn-ghost text-sm" href="/finance?tab=documents">
          למסמכים
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-3xl">
        {error && (
          <div
            role="alert"
            className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}

        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">זהות העסק</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="business-name">
                שם העסק (עברית)
              </label>
              <input
                id="business-name"
                className="input"
                value={form.businessName}
                onChange={(e) => set({ businessName: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="business-name-en">
                שם העסק (אנגלית)
              </label>
              <input
                id="business-name-en"
                className="input"
                dir="ltr"
                value={form.businessNameEn}
                onChange={(e) => set({ businessNameEn: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="owner-name">
                שם בעל העסק
              </label>
              <input
                id="owner-name"
                className="input"
                value={form.ownerName}
                onChange={(e) => set({ ownerName: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="tax-id">
                מספר עוסק / ח.פ.
              </label>
              <input
                id="tax-id"
                className="input"
                value={form.taxId}
                onChange={(e) => set({ taxId: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="tax-id-type">
                סוג עוסק
              </label>
              <select
                id="tax-id-type"
                className="select"
                value={form.taxIdType}
                onChange={(e) => set({ taxIdType: e.target.value as Form['taxIdType'] })}
              >
                <option value="osek_morshe">עוסק מורשה</option>
                <option value="osek_patur">עוסק פטור</option>
                <option value="company">חברה בע"מ</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="default-language">
                שפת ברירת מחדל למסמך
              </label>
              <select
                id="default-language"
                className="select"
                value={form.defaultLanguage}
                onChange={(e) => set({ defaultLanguage: e.target.value as 'he' | 'en' })}
              >
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </section>

        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">כתובת ויצירת קשר</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="address">
                כתובת (עברית)
              </label>
              <input
                id="address"
                className="input"
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="address-en">
                כתובת (אנגלית)
              </label>
              <input
                id="address-en"
                className="input"
                dir="ltr"
                value={form.addressEn}
                onChange={(e) => set({ addressEn: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="city">
                עיר
              </label>
              <input
                id="city"
                className="input"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="zip">
                מיקוד
              </label>
              <input
                id="zip"
                className="input"
                value={form.zipCode}
                onChange={(e) => set({ zipCode: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="phone">
                טלפון
              </label>
              <input
                id="phone"
                className="input"
                dir="ltr"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="email">
                דוא"ל
              </label>
              <input
                id="email"
                className="input"
                dir="ltr"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="website">
                אתר
              </label>
              <input
                id="website"
                className="input"
                dir="ltr"
                value={form.website}
                onChange={(e) => set({ website: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">לוגו</h2>
          <p className="text-xs text-[#5a688c]">
            ברירת המחדל היא לוגו Alpir Consulting. העלאה כאן דוחה אותו בכל המסמכים החדשים.
          </p>
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-white p-3 flex items-center justify-center" style={{ width: 160, height: 90 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.logoDataUrl || '/brand/alpir-logo.png'}
                alt="תצוגה מקדימה של הלוגו"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" className="btn btn-ghost text-sm" onClick={() => fileRef.current?.click()}>
                העלה לוגו
              </button>
              {form.logoDataUrl && (
                <button
                  type="button"
                  className="btn btn-ghost text-sm text-[#fb7185] border-[#fb718522]"
                  onClick={() => set({ logoDataUrl: '' })}
                >
                  חזור ללוגו ברירת המחדל
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleLogo(file)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        </section>

        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">פרטי תשלום וטקסט תחתית</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="bank">
                פרטי בנק (עברית)
              </label>
              <textarea
                id="bank"
                className="input"
                rows={3}
                placeholder={'בנק לאומי (10)\nסניף 800 · חשבון 123456'}
                value={form.bankDetails}
                onChange={(e) => set({ bankDetails: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="bank-en">
                פרטי בנק בינלאומיים (IBAN / SWIFT)
              </label>
              <textarea
                id="bank-en"
                className="input"
                rows={3}
                dir="ltr"
                placeholder={'IBAN: IL00 0000 ...\nSWIFT: XXXXILIT'}
                value={form.bankDetailsEn}
                onChange={(e) => set({ bankDetailsEn: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="footer">
                טקסט תחתית (עברית)
              </label>
              <input
                id="footer"
                className="input"
                value={form.footerText}
                onChange={(e) => set({ footerText: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="footer-en">
                טקסט תחתית (אנגלית)
              </label>
              <input
                id="footer-en"
                className="input"
                dir="ltr"
                value={form.footerTextEn}
                onChange={(e) => set({ footerTextEn: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="payment-terms">
                תנאי תשלום ברירת מחדל
              </label>
              <input
                id="payment-terms"
                className="input"
                placeholder="שוטף + 30"
                value={form.defaultPaymentTerms}
                onChange={(e) => set({ defaultPaymentTerms: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="number-prefix">
                קידומת למספר מסמך
              </label>
              <input
                id="number-prefix"
                className="input"
                placeholder="ריק = ללא קידומת"
                value={form.numberPrefix}
                onChange={(e) => set({ numberPrefix: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">מספרי התחלה</h2>
          <p className="text-xs text-[#5a688c]">
            כדי להמשיך את המספור מהמערכת הקודמת בלי כפילות. משפיע רק על הסוג שטרם הונפק אצלך פה.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SALES_DOCUMENT_TYPES.map((type) => (
              <div key={type}>
                <label className="label" htmlFor={`start-${type}`}>
                  {DOCUMENT_STRINGS.he.documentTypes[type]}
                </label>
                <input
                  id={`start-${type}`}
                  className="input"
                  type="number"
                  min="1"
                  placeholder="1"
                  value={startNumbers[type] ?? ''}
                  onChange={(e) =>
                    setStartNumbers((current) => ({ ...current, [type]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'שומר...' : 'שמור פרטים'}
          </button>
          {saved && <span className="text-xs text-[#2dd4bf]">נשמר</span>}
        </div>
      </form>
    </div>
  )
}
