'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'

const FIELD_LABELS: Record<string, string> = {
  company: 'חברה',
  jobTitle: 'תפקיד',
  notes: 'הערות',
}

/**
 * Reviewed fill of company / job title / notes from Google Contacts. Only empty fields are
 * proposed, and nothing is written until the owner confirms.
 */
export function GoogleProfileFillModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [done, setDone] = useState<string | null>(null)
  const preview = trpc.contacts.previewGoogleProfiles.useMutation({
    onSuccess: (data) => setChecked(new Set(data.proposals.map((p) => p.personId))),
  })
  const apply = trpc.contacts.applyGoogleProfiles.useMutation({
    onSuccess: async (res) => {
      await utils.people.invalidate()
      setDone(res.updated === 1 ? 'עודכן איש קשר אחד' : `עודכנו ${res.updated} אנשי קשר`)
    },
  })

  useEffect(() => {
    preview.mutate()
    // Preview once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const proposals = preview.data?.proposals ?? []
  const selectedCount = proposals.filter((p) => checked.has(p.personId)).length
  const allChecked = proposals.length > 0 && selectedCount === proposals.length

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal w-full max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-profile-fill-title"
        data-testid="google-profile-fill-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '85dvh', display: 'flex', flexDirection: 'column' }}
      >
        <div id="google-profile-fill-title" className="font-bold text-lg mb-2 tracking-tight">פרטים מגוגל</div>
        <p className="text-xs text-[#7a89ab] mb-4">
          חברה, תפקיד והערות מאנשי הקשר בגוגל. ממלאים רק שדות ריקים — שום דבר שכבר כתבת במערכת לא נדרס.
        </p>

        <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin' }}>
          {preview.isPending && <p className="text-sm text-[#5a688c]">מחפש התאמות…</p>}
          {preview.error && <p className="text-sm text-red-400">{preview.error.message}</p>}
          {preview.data?.errors.map((err) => (
            <p key={err} className="text-sm text-red-400 mb-2 break-words">{err}</p>
          ))}
          {done && <p className="text-sm text-[#2dd4bf] mb-3" role="status">{done}</p>}

          {preview.data && proposals.length === 0 && preview.data.errors.length === 0 && !preview.isPending && (
            <p className="text-sm text-[#97a4c2]" data-testid="google-profile-fill-empty">
              אין מה להשלים — כל השדות כבר מלאים או שאין התאמה.
            </p>
          )}

          {proposals.length > 0 && !done && (
            <>
              <button
                type="button"
                className="text-xs text-[#2dd4bf] mb-2"
                onClick={() => setChecked(allChecked ? new Set() : new Set(proposals.map((p) => p.personId)))}
              >
                {allChecked ? 'נקה בחירה' : 'בחר הכל'}
              </button>
              <ul className="space-y-2" data-testid="google-profile-fill-list">
                {proposals.map((p) => (
                  <li key={p.personId} className="card p-3 flex items-start gap-3">
                    <button
                      type="button"
                      role="checkbox"
                      className="checkbox-btn shrink-0 mt-0.5"
                      aria-checked={checked.has(p.personId)}
                      aria-label={`בחר ${p.personName}`}
                      onClick={() => toggle(p.personId)}
                    >
                      {checked.has(p.personId) && <span className="text-[10px]">✓</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#eef3fb] truncate">{p.personName}</div>
                      <dl className="mt-1 space-y-0.5">
                        {Object.entries(p.fields).map(([field, value]) => (
                          <div key={field} className="text-xs flex gap-1.5 min-w-0">
                            <dt className="text-[#7a89ab] shrink-0">{FIELD_LABELS[field] ?? field}:</dt>
                            <dd className="text-[#b8c4dc] truncate" title={value}>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {preview.data && preview.data.unmatched > 0 && (
            <p className="text-xs text-[#5a688c] mt-3">
              {preview.data.unmatched} אנשי קשר בגוגל בלי התאמה במערכת — לא נוספו.
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-4 justify-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>סגור</button>
          {proposals.length > 0 && !done && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedCount === 0 || apply.isPending}
              onClick={() => apply.mutate({ personIds: proposals.filter((p) => checked.has(p.personId)).map((p) => p.personId) })}
            >
              {apply.isPending ? 'שומר…' : selectedCount === 1 ? 'עדכן איש קשר' : `עדכן ${selectedCount}`}
            </button>
          )}
        </div>
        {apply.error && <p className="text-sm text-red-400 mt-2">{apply.error.message}</p>}
      </div>
    </div>
  )
}
