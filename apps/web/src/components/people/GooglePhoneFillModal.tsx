'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'

function ErrorLine({ err }: { err: string }) {
  const match = err.match(/https:\/\/\S+/)
  if (!match || match.index == null) {
    return <p className="text-sm text-red-400 mb-2" data-testid="google-phone-fill-error">{err}</p>
  }
  const url = match[0]
  return (
    <p className="text-sm text-red-400 mb-2" data-testid="google-phone-fill-error">
      {err.slice(0, match.index)}
      <a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">{url}</a>
      {err.slice(match.index + url.length)}
    </p>
  )
}

const SKIP_LABELS: Record<string, string> = {
  ambiguous_email: 'האימייל מתאים ליותר מאדם אחד',
  ambiguous_name: 'השם מתאים ליותר מאדם אחד',
  conflicting_phones: 'כמה טלפונים שונים לאותו אדם',
}

export function GooglePhoneFillModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string | null>(null)
  const preview = trpc.contacts.previewGooglePhones.useMutation({
    onSuccess: (data) => {
      setChecked(new Set(data.proposals.map((p) => p.personId)))
      setNames(Object.fromEntries(data.proposals.map((p) => [p.personId, p.googleName])))
    },
  })
  const apply = trpc.contacts.applyGooglePhones.useMutation({
    onSuccess: async (res) => {
      await utils.people.invalidate()
      setDone(res.updated === 1 ? 'עודכן איש קשר אחד, וואטסאפ דולק' : `עודכנו ${res.updated} אנשי קשר, וואטסאפ דולק`)
    },
  })

  useEffect(() => {
    preview.mutate()
    // Preview once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const proposals = preview.data?.proposals ?? []
  const skipped = preview.data?.skipped ?? []
  const selectedCount = proposals.filter((p) => checked.has(p.personId)).length

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
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-phone-fill-title"
        data-testid="google-phone-fill-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div id="google-phone-fill-title" className="font-bold text-lg mb-2 tracking-tight">טלפונים מגוגל</div>
        <p className="text-xs text-[#7a89ab] mb-4">
          השם הוא מספר הטלפונים, ואפשר לשנות אותו לפני השמירה. וואטסאפ נדלק לכל מי שמסומן.
        </p>

        <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin' }}>
          {preview.isPending && <p className="text-sm text-[#5a688c]">מחפש התאמות…</p>}
          {preview.error && <p className="text-sm text-red-400">{preview.error.message}</p>}
          {preview.data?.errors.map((err) => (
            <ErrorLine key={err} err={err} />
          ))}
          {done && <p className="text-sm text-[#2dd4bf] mb-3" role="status">{done}</p>}

          {preview.data && proposals.length === 0 && preview.data.errors.length === 0 && !preview.isPending && (
            <p className="text-sm text-[#97a4c2]" data-testid="google-phone-fill-empty">
              לא נמצאו טלפונים לאנשים בלי מספר.
            </p>
          )}

          {proposals.length > 0 && (
            <ul className="space-y-2" data-testid="google-phone-fill-list">
              {proposals.map((p) => (
                <li key={p.personId} className="card p-3 flex items-center gap-3">
                  <button
                    type="button"
                    className="checkbox-btn shrink-0"
                    aria-checked={checked.has(p.personId)}
                    aria-label={`בחר ${p.personName}`}
                    onClick={() => toggle(p.personId)}
                  >
                    {checked.has(p.personId) && <span className="text-[10px]">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <input
                      className="input text-sm py-1"
                      value={names[p.personId] ?? p.googleName}
                      aria-label={`שם ${p.googleName}`}
                      onChange={(e) => setNames((prev) => ({ ...prev, [p.personId]: e.target.value }))}
                    />
                    {p.personName.trim() !== (names[p.personId] ?? p.googleName).trim() && (
                      <div className="text-xs text-[#7a89ab] mt-1">במערכת: {p.personName}</div>
                    )}
                  </div>
                  <span className="text-sm tabular-nums text-[#eef3fb]" dir="ltr">{p.phone}</span>
                </li>
              ))}
            </ul>
          )}

          {skipped.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-[#7a89ab] mb-2">דילגנו</div>
              <ul className="space-y-1">
                {skipped.slice(0, 12).map((s, i) => (
                  <li key={`${s.reason}-${s.googleName}-${i}`} className="text-xs text-[#97a4c2]">
                    {s.googleName}{s.personName ? ` · ${s.personName}` : ''} — {SKIP_LABELS[s.reason] ?? s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.data && preview.data.unmatched > 0 && (
            <p className="text-xs text-[#5a688c] mt-3">
              {preview.data.unmatched} אנשי קשר בגוגל בלי התאמה — לא נוספו.
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
              onClick={() => apply.mutate({
                fills: proposals
                  .filter((p) => checked.has(p.personId))
                  .map((p) => ({ personId: p.personId, name: (names[p.personId] ?? p.googleName).trim() })),
              })}
            >
              {apply.isPending ? 'שומר…' : selectedCount === 1 ? 'שמור איש קשר' : `שמור ${selectedCount}`}
            </button>
          )}
        </div>
        {apply.error && <p className="text-sm text-red-400 mt-2">{apply.error.message}</p>}
      </div>
    </div>
  )
}
