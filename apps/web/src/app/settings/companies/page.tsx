'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

type Form = {
  name: string
  nameEn: string
  taxId: string
  taxIdType: 'osek_morshe' | 'osek_patur' | 'company' | 'foreign' | 'other'
  address: string
  city: string
  zipCode: string
  country: string
  preferredLanguage: 'he' | 'en'
  phone: string
  email: string
  website: string
  notes: string
}

const EMPTY: Form = {
  name: '',
  nameEn: '',
  taxId: '',
  taxIdType: 'company',
  address: '',
  city: '',
  zipCode: '',
  country: 'IL',
  preferredLanguage: 'he',
  phone: '',
  email: '',
  website: '',
  notes: '',
}

const TAX_ID_TYPE_LABELS: Record<Form['taxIdType'], string> = {
  osek_morshe: 'עוסק מורשה',
  osek_patur: 'עוסק פטור',
  company: 'חברה בע"מ',
  foreign: 'ישות זרה',
  other: 'אחר',
}

function CompanyModal({
  open,
  companyId,
  onClose,
}: {
  open: boolean
  companyId: string | null
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const [form, setForm] = useState<Form>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const { data: companies = [] } = trpc.companies.list.useQuery(undefined, { enabled: open })
  const existing = companyId ? companies.find((company) => company.id === companyId) : null

  useEffect(() => {
    if (!open) return
    setError(null)
    if (existing) {
      setForm({
        name: existing.name,
        nameEn: existing.nameEn ?? '',
        taxId: existing.taxId ?? '',
        taxIdType: (existing.taxIdType as Form['taxIdType']) ?? 'company',
        address: existing.address ?? '',
        city: existing.city ?? '',
        zipCode: existing.zipCode ?? '',
        country: existing.country ?? 'IL',
        preferredLanguage: existing.preferredLanguage === 'en' ? 'en' : 'he',
        phone: existing.phone ?? '',
        email: existing.email ?? '',
        website: existing.website ?? '',
        notes: existing.notes ?? '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, existing])

  useEffect(() => {
    if (!open) return
    nameRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
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

  const onDone = () => {
    utils.companies.list.invalidate()
    onClose()
  }
  const create = trpc.companies.create.useMutation({
    onSuccess: onDone,
    onError: (err) => setError(err.message || 'השמירה נכשלה. נסה שוב.'),
  })
  const update = trpc.companies.update.useMutation({
    onSuccess: onDone,
    onError: (err) => setError(err.message || 'השמירה נכשלה. נסה שוב.'),
  })

  if (!open) return null

  const pending = create.isPending || update.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || pending) return
    const payload = {
      name: form.name.trim(),
      nameEn: form.nameEn.trim() || null,
      taxId: form.taxId.trim() || null,
      taxIdType: form.taxIdType,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      zipCode: form.zipCode.trim() || null,
      country: form.country.trim() || 'IL',
      preferredLanguage: form.preferredLanguage,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      website: form.website.trim() || null,
      notes: form.notes.trim() || null,
    }
    if (companyId) update.mutate({ id: companyId, ...payload })
    else create.mutate(payload)
  }

  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))

  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={companyId ? 'עריכת חברה' : 'חברה חדשה'}
        style={{ width: 600 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-bold text-lg mb-6 tracking-tight">
          {companyId ? 'עריכת חברה' : 'חברה חדשה'}
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <div
              role="alert"
              className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="company-name">
                שם החברה
              </label>
              <input
                id="company-name"
                ref={nameRef}
                className="input"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="company-name-en">
                שם באנגלית
              </label>
              <input
                id="company-name-en"
                className="input"
                dir="ltr"
                value={form.nameEn}
                onChange={(e) => set({ nameEn: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="company-tax-id">
                ח.פ. / עוסק מורשה
              </label>
              <input
                id="company-tax-id"
                className="input"
                value={form.taxId}
                onChange={(e) => set({ taxId: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="company-tax-type">
                סוג ישות
              </label>
              <select
                id="company-tax-type"
                className="select"
                value={form.taxIdType}
                onChange={(e) => set({ taxIdType: e.target.value as Form['taxIdType'] })}
              >
                {(Object.keys(TAX_ID_TYPE_LABELS) as Form['taxIdType'][]).map((value) => (
                  <option key={value} value={value}>
                    {TAX_ID_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="company-address">
                כתובת
              </label>
              <input
                id="company-address"
                className="input"
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="company-city">
                עיר
              </label>
              <input
                id="company-city"
                className="input"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="company-zip">
                מיקוד
              </label>
              <input
                id="company-zip"
                className="input"
                value={form.zipCode}
                onChange={(e) => set({ zipCode: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="company-country">
                מדינה (קוד)
              </label>
              <input
                id="company-country"
                className="input"
                dir="ltr"
                placeholder="IL"
                value={form.country}
                onChange={(e) => set({ country: e.target.value.toUpperCase() })}
              />
              <div className="text-[11px] text-[#5a688c] mt-1">
                מדינה שאינה IL תציע מסמך באנגלית בשיעור מע"מ אפס.
              </div>
            </div>
            <div>
              <label className="label" htmlFor="company-language">
                שפת מסמך מועדפת
              </label>
              <select
                id="company-language"
                className="select"
                value={form.preferredLanguage}
                onChange={(e) => set({ preferredLanguage: e.target.value as 'he' | 'en' })}
              >
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="company-phone">
                טלפון
              </label>
              <input
                id="company-phone"
                className="input"
                dir="ltr"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="company-email">
                דוא"ל
              </label>
              <input
                id="company-email"
                className="input"
                dir="ltr"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="company-website">
                אתר
              </label>
              <input
                id="company-website"
                className="input"
                dir="ltr"
                value={form.website}
                onChange={(e) => set({ website: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="company-notes">
              הערות
            </label>
            <textarea
              id="company-notes"
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CompaniesSettingsPage() {
  const utils = trpc.useUtils()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const { data: companies = [], isLoading } = trpc.companies.list.useQuery({
    search: search.trim() || undefined,
  })
  const remove = trpc.companies.remove.useMutation({
    onSuccess: () => utils.companies.list.invalidate(),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">חברות</h1>
          <p className="text-xs text-[#5a688c] mt-1">
            הלקוחות שמופיעים על מסמכי המכירה, עם פרטי החיוב שלהם.
          </p>
        </div>
        <Link className="btn btn-ghost text-sm" href="/finance?tab=documents">
          למסמכים
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="חיפוש חברה..."
          aria-label="חיפוש חברה"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex-1" />
        <button
          className="btn btn-primary text-sm"
          onClick={() => {
            setEditingId(null)
            setModalOpen(true)
          }}
        >
          + חברה חדשה
        </button>
      </div>

      {isLoading ? (
        <div className="text-[#5a688c] text-sm">טוען...</div>
      ) : companies.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-[#5a688c] text-sm">עדיין אין חברות</div>
          <button
            className="btn btn-primary text-sm mt-4"
            onClick={() => {
              setEditingId(null)
              setModalOpen(true)
            }}
          >
            הוסף את הלקוח הראשון
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-[#29395d]">
                {['שם', 'ח.פ.', 'מדינה', 'שפה', 'דוא"ל'].map((header) => (
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
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className="border-b border-[#1d2b46] hover:bg-[#1d2b46] transition-colors group"
                >
                  <td className="px-4 py-3 font-medium">{company.name}</td>
                  <td className="px-4 py-3 text-[#647399] tabular-nums">{company.taxId ?? '—'}</td>
                  <td className="px-4 py-3 text-[#647399]">{company.country}</td>
                  <td className="px-4 py-3 text-[#647399]">
                    {company.preferredLanguage === 'en' ? 'English' : 'עברית'}
                  </td>
                  <td className="px-4 py-3 text-[#647399] truncate max-w-[180px]">
                    {company.email ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        className="btn btn-ghost text-[11px] py-1 px-2"
                        onClick={() => {
                          setEditingId(company.id)
                          setModalOpen(true)
                        }}
                      >
                        ערוך
                      </button>
                      <button
                        className="btn btn-ghost text-[11px] py-1 px-2 text-[#fb7185] border-[#fb718522]"
                        onClick={() => {
                          if (
                            window.confirm(
                              `למחוק את ${company.name}? מסמכים קיימים יישמרו עם פרטי הלקוח שהודפסו עליהם.`
                            )
                          ) {
                            remove.mutate({ id: company.id })
                          }
                        }}
                      >
                        מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CompanyModal open={modalOpen} companyId={editingId} onClose={() => setModalOpen(false)} />
    </div>
  )
}
