'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'

/**
 * Paste-a-link flow for registering a Notion task database on one מקור
 * (see docs/specs/notion-task-source-manager.md).
 */
export function AddTaskSourceModal({
  open,
  workspaceId,
  onClose,
}: {
  open: boolean
  workspaceId: string
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const { data: accounts = [] } = trpc.people.notionAccounts.useQuery(undefined, { enabled: open })
  const [accountLabel, setAccountLabel] = useState('')
  const [link, setLink] = useState('')
  const [name, setName] = useState('')
  const [resolved, setResolved] = useState<{ notionDatabaseId: string; name: string; alreadyAdded: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLink('')
    setName('')
    setResolved(null)
    setError(null)
  }, [open])

  useEffect(() => {
    if (open && !accountLabel && accounts.length > 0) setAccountLabel(accounts[0].label)
  }, [open, accounts, accountLabel])

  const resolve = trpc.workspaces.resolveNotionTaskDatabaseLink.useMutation({
    onSuccess: (data) => {
      setError(null)
      setResolved(data)
      setName(data.name)
    },
    onError: (err) => {
      setResolved(null)
      setError(err.message || 'לא הצלחנו לאמת את הקישור')
    },
  })
  const add = trpc.workspaces.addNotionTaskDatabase.useMutation({
    onSuccess: () => {
      utils.workspaces.listNotionDatabases.invalidate()
      utils.workspaces.list.invalidate()
      utils.workspaces.getById.invalidate({ id: workspaceId })
      utils.tasks.notionConfigured.invalidate()
      onClose()
    },
    onError: (err) => setError(err.message || 'ההוספה נכשלה'),
  })

  if (!open) return null

  const canResolve = !!accountLabel && link.trim().length > 0 && !resolve.isPending
  const canAdd = !!resolved && !resolved.alreadyAdded && name.trim().length > 0 && !add.isPending
  const showAddStep = !!resolved && !resolved.alreadyAdded

  return (
    <div className="overlay" style={{ zIndex: 110 }} onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="הוסף בסיס נתונים של משימות"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-bold text-lg mb-6 tracking-tight">הוסף בסיס נתונים של משימות</div>
        <div className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="label" htmlFor="tns-account">חשבון Notion</label>
            <select
              id="tns-account"
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
            <label className="label" htmlFor="tns-link">קישור לבסיס הנתונים ב-Notion</label>
            <input
              id="tns-link"
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

          {resolved?.alreadyAdded && (
            <div className="text-sm text-[#b8c4dc] bg-[#141b2e] border border-[#26324d] rounded-lg px-3 py-2">
              נמצא: <span className="font-medium text-[#eef3fb]">{resolved.name}</span>
              <span className="text-[11px] text-[#647399]"> · כבר רשום</span>
            </div>
          )}

          {showAddStep && (
            <div>
              <label className="label" htmlFor="tns-name">שם</label>
              <input
                id="tns-name"
                className="input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          <div className="flex gap-2.5 mt-2 justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
            {showAddStep ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canAdd}
                onClick={() => {
                  if (!resolved) return
                  setError(null)
                  add.mutate({
                    workspaceId,
                    accountLabel,
                    notionDatabaseId: resolved.notionDatabaseId,
                    notionDatabaseName: name.trim(),
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
