'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'

type FieldKey = 'phone' | 'role' | 'company' | 'linkedin'

interface FieldMappingCandidate {
  candidates: string[]
  auto: string | null
}

interface ResolvedSource {
  notionDatabaseId: string
  name: string
  alreadyAdded: boolean
  fieldMappings: Record<FieldKey, FieldMappingCandidate>
}

const FIELD_LABELS: Record<FieldKey, string> = {
  phone: 'טלפון',
  role: 'תפקיד',
  company: 'חברה',
  linkedin: 'לינקדאין',
}
const FIELD_ORDER: FieldKey[] = ['phone', 'role', 'company', 'linkedin']

/**
 * Paste-a-link flow for registering an additional Notion "people" database as a self-service
 * source (see docs/specs/notion-people-source-manager.md) — no live search, just: pick the
 * account whose integration has access, paste the database's "Copy link", confirm the resolved
 * title, add.
 */
export function AddPeopleSourceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: accounts = [] } = trpc.people.notionAccounts.useQuery(undefined, { enabled: open })
  const [accountLabel, setAccountLabel] = useState('')
  const [link, setLink] = useState('')
  const [resolved, setResolved] = useState<ResolvedSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<FieldKey, string>>({
    phone: '', role: '', company: '', linkedin: '',
  })

  useEffect(() => {
    if (!open) return
    setLink('')
    setResolved(null)
    setError(null)
    setFieldValues({ phone: '', role: '', company: '', linkedin: '' })
  }, [open])

  // Default to the first account once the list loads, without stomping a deliberate selection.
  useEffect(() => {
    if (open && !accountLabel && accounts.length > 0) setAccountLabel(accounts[0].label)
  }, [open, accounts, accountLabel])

  const resolve = trpc.people.resolveNotionDatabaseLink.useMutation({
    onSuccess: (data) => {
      setError(null)
      setResolved(data)
      setFieldValues({
        phone: data.fieldMappings.phone.auto ?? '',
        role: data.fieldMappings.role.auto ?? '',
        company: data.fieldMappings.company.auto ?? '',
        linkedin: data.fieldMappings.linkedin.auto ?? '',
      })
    },
    onError: (err) => {
      setResolved(null)
      setError(err.message || 'לא הצלחנו לאמת את הקישור')
    },
  })
  const add = trpc.people.addNotionSource.useMutation({
    onSuccess: () => {
      utils.people.notionSources.invalidate()
      onClose()
    },
    onError: (err) => setError(err.message || 'ההוספה נכשלה'),
  })

  if (!open) return null

  const canResolve = !!accountLabel && link.trim().length > 0 && !resolve.isPending
  const canAdd = !!resolved && !resolved.alreadyAdded && !add.isPending
  const showAddStep = !!resolved && !resolved.alreadyAdded

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-6 tracking-tight">הוסף בסיס נתונים של אנשים</div>
        <div className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="label" htmlFor="pns-account">חשבון Notion</label>
            <select
              id="pns-account"
              className="input"
              value={accountLabel}
              onChange={(e) => {
                setAccountLabel(e.target.value)
                setResolved(null)
              }}
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 && <option value="">לא נמצאו חשבונות Notion</option>}
              {accounts.map((a) => (
                <option key={a.label} value={a.label}>{a.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="pns-link">קישור לבסיס הנתונים ב-Notion</label>
            <input
              id="pns-link"
              className="input"
              type="text"
              value={link}
              onChange={(e) => {
                setLink(e.target.value)
                setResolved(null)
              }}
              placeholder="https://www.notion.so/..."
              autoComplete="off"
              autoFocus
            />
            <p className="text-[11px] text-[#647399] mt-1.5">
              ב-Notion: פתח את בסיס הנתונים ← ⋯ ← Copy link, והדבק כאן.
            </p>
          </div>

          {resolved && (
            <div className="text-sm text-[#b8c4dc] bg-[#141b2e] border border-[#26324d] rounded-lg px-3 py-2">
              נמצא: <span className="font-medium text-[#eef3fb]">{resolved.name}</span>
              {resolved.alreadyAdded && (
                <span className="text-[11px] text-[#647399]"> · כבר רשום כמקור אנשים</span>
              )}
            </div>
          )}

          {showAddStep && FIELD_ORDER.filter((key) => resolved!.fieldMappings[key].candidates.length > 0).map((key) => {
            const mapping = resolved!.fieldMappings[key]
            return (
              <div key={key}>
                <label className="label" htmlFor={`pns-field-${key}`}>{FIELD_LABELS[key]}</label>
                <select
                  id={`pns-field-${key}`}
                  className="input"
                  value={fieldValues[key]}
                  onChange={(e) => setFieldValues((f) => ({ ...f, [key]: e.target.value }))}
                >
                  <option value="">ללא</option>
                  {mapping.candidates.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {mapping.auto && fieldValues[key] === mapping.auto && (
                  <p className="text-[11px] text-[#647399] mt-1">זוהה אוטומטית — אפשר לשנות</p>
                )}
              </div>
            )
          })}

          <div className="flex gap-2.5 mt-2 justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
            {showAddStep ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canAdd}
                onClick={() => {
                  setError(null)
                  add.mutate({
                    accountLabel,
                    notionDatabaseId: resolved.notionDatabaseId,
                    notionDatabaseName: resolved.name,
                    phonePropertyName: fieldValues.phone || null,
                    rolePropertyName: fieldValues.role || null,
                    companyPropertyName: fieldValues.company || null,
                    linkedinPropertyName: fieldValues.linkedin || null,
                  })
                }}
              >
                {add.isPending ? 'מוסיף…' : 'הוסף'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canResolve}
                onClick={() => {
                  setError(null)
                  resolve.mutate({ accountLabel, link })
                }}
              >
                {resolve.isPending ? 'בודק…' : 'בדוק'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
