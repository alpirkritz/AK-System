'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { AddTaskSourceModal } from './AddTaskSourceModal'

const COLORS = ['#2dd4bf', '#fb7185', '#38bdf8', '#b847e8', '#47e8a8']

export function WorkspaceModal({
  open,
  onClose,
  editingId,
}: {
  open: boolean
  onClose: () => void
  editingId: string | null
}) {
  const [form, setForm] = useState({ name: '', color: '#2dd4bf', notionAccountLabel: '' })
  const [error, setError] = useState<string | null>(null)
  const { data: workspace, isLoading } = trpc.workspaces.getById.useQuery(
    { id: editingId! },
    { enabled: !!editingId && open },
  )
  const utils = trpc.useUtils()
  const create = trpc.workspaces.create.useMutation({
    onSuccess: () => { utils.workspaces.list.invalidate(); onClose() },
    onError: (err) => setError(err.message),
  })
  const update = trpc.workspaces.update.useMutation({
    onSuccess: () => { utils.workspaces.list.invalidate(); onClose() },
    onError: (err) => setError(err.message),
  })

  // Hydrate the form once per open — a later refetch must not overwrite typing.
  const hydratedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null
      return
    }
    setError(null)
    if (!editingId) {
      if (hydratedFor.current !== 'new') {
        setForm({ name: '', color: '#2dd4bf', notionAccountLabel: '' })
        hydratedFor.current = 'new'
      }
      return
    }
    if (workspace && hydratedFor.current !== editingId) {
      setForm({
        name: workspace.name,
        color: workspace.color ?? '#2dd4bf',
        notionAccountLabel: workspace.notionAccountLabel ?? '',
      })
      hydratedFor.current = editingId
    }
  }, [open, editingId, workspace])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const name = form.name.trim()
    if (!name) return
    const notionAccountLabel = form.notionAccountLabel.trim() || null
    if (editingId) {
      update.mutate({ id: editingId, name, color: form.color, notionAccountLabel })
    } else {
      create.mutate({ name, color: form.color, notionAccountLabel })
    }
  }

  const canSave = form.name.trim().length > 0 && !create.isPending && !update.isPending

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-6 tracking-tight">
          {editingId ? 'עריכת מקור' : 'מקור חדש'}
        </div>
        {editingId && isLoading ? (
          <div className="text-[#7a89ab] py-6">טוען...</div>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="workspace-name">שם המקור</label>
            <input
              id="workspace-name"
              className="input"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="לדוגמה: Dragontail"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">צבע</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`בחר צבע ${c}`}
                  aria-pressed={form.color === c}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="w-7 h-7 rounded-full cursor-pointer border-[3px] transition-all"
                  style={{ background: c, borderColor: form.color === c ? 'white' : 'transparent' }}
                />
              ))}
            </div>
          </div>

          <NotionDatabaseLinks workspaceId={editingId} />

          <div>
            <label className="label" htmlFor="workspace-notion-label">תווית Notion (גיבוי)</label>
            <input
              id="workspace-notion-label"
              className="input"
              type="text"
              value={form.notionAccountLabel}
              onChange={(e) => setForm((f) => ({ ...f, notionAccountLabel: e.target.value }))}
              placeholder="לדוגמה: DT - Action items"
              autoComplete="off"
            />
            <p className="text-[11px] text-[#647399] mt-1.5">
              משמש רק אם לא קושר בסיס נתונים ספציפי למעלה
            </p>
          </div>
          <div className="flex gap-2.5 mt-6 justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>
              {create.isPending || update.isPending ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}

/** Checklist of configured Notion task databases, linkable to this workspace. */
function NotionDatabaseLinks({ workspaceId }: { workspaceId: string | null }) {
  const utils = trpc.useUtils()
  const { data: databases = [], isLoading } = trpc.workspaces.listNotionDatabases.useQuery(undefined, {
    enabled: !!workspaceId,
  })
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const invalidate = () => {
    utils.workspaces.listNotionDatabases.invalidate()
    utils.workspaces.list.invalidate()
    if (workspaceId) utils.workspaces.getById.invalidate({ id: workspaceId })
  }
  const link = trpc.workspaces.linkNotionDatabase.useMutation({
    onSuccess: () => { setLinkError(null); invalidate() },
    onError: () => setLinkError('לא הצלחנו לעדכן את הקישור. נסה שוב.'),
    onSettled: () => setPendingId(null),
  })
  const unlink = trpc.workspaces.unlinkNotionDatabase.useMutation({
    onSuccess: () => { setLinkError(null); invalidate() },
    onError: () => setLinkError('לא הצלחנו לעדכן את הקישור. נסה שוב.'),
    onSettled: () => setPendingId(null),
  })

  if (!workspaceId) {
    return (
      <div>
        <label className="label">בסיסי נתונים מקושרים ב-Notion</label>
        <p className="text-[11px] text-[#647399]">שמור את המקור כדי לקשר אליו בסיסי נתונים מ-Notion.</p>
      </div>
    )
  }

  return (
    <div>
      <label className="label">בסיסי נתונים מקושרים ב-Notion</label>
      {isLoading ? (
        <div className="text-[11px] text-[#647399] py-1">טוען…</div>
      ) : databases.length === 0 ? (
        <p className="text-[11px] text-[#647399]">לא נמצאו בסיסי נתונים ב-Notion. אפשר להוסיף אחד עם קישור.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {databases.map((db) => {
            const linkedHere = db.linkedWorkspaceId === workspaceId
            const linkedElsewhere = !!db.linkedWorkspaceId && !linkedHere
            const busy = pendingId === db.notionDatabaseId
            const removeCustom = () => {
              if (!db.linkId) return
              if (!window.confirm(`להסיר את "${db.name}" ממקורות המשימות?`)) return
              setLinkError(null)
              setPendingId(db.notionDatabaseId)
              unlink.mutate({ id: db.linkId })
            }
            return (
              <div
                key={db.notionDatabaseId}
                className={`flex items-center gap-2 py-1.5 px-2 rounded transition-colors ${
                  linkedElsewhere ? 'opacity-50' : 'hover:bg-[#29395d]'
                }`}
              >
                <label className={`flex items-center gap-2 flex-1 min-w-0 ${linkedElsewhere ? '' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border border-[#4d659c] bg-transparent accent-[#2dd4bf]"
                    checked={linkedHere}
                    disabled={linkedElsewhere || busy}
                    onChange={() => {
                      if (db.source === 'custom' && linkedHere) {
                        removeCustom()
                        return
                      }
                      setLinkError(null)
                      setPendingId(db.notionDatabaseId)
                      if (linkedHere && db.linkId) {
                        unlink.mutate({ id: db.linkId })
                      } else {
                        link.mutate({
                          workspaceId,
                          notionDatabaseId: db.notionDatabaseId,
                          notionDatabaseName: db.name,
                        })
                      }
                    }}
                  />
                  <span className="text-sm text-[#b8c4dc]">{db.name}</span>
                  {db.accountLabel && (
                    <span className="text-[11px] text-[#5a688c] truncate">· {db.accountLabel}</span>
                  )}
                  {busy && <span className="text-[11px] text-[#647399]">מעדכן…</span>}
                  {linkedElsewhere && (
                    <span className="text-[11px] text-[#647399] mr-auto">מקושר ל-{db.linkedWorkspaceName}</span>
                  )}
                </label>
                {db.source === 'custom' && linkedHere && (
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={`הסר את ${db.name}`}
                    disabled={busy}
                    onClick={removeCustom}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      <button
        type="button"
        className="btn btn-secondary text-xs py-1 px-3 mt-2 self-start"
        onClick={() => setAddOpen(true)}
      >
        + הוסף בסיס נתונים
      </button>
      {linkError && (
        <p role="alert" className="text-[11px] text-red-400 mt-1.5">{linkError}</p>
      )}
      <AddTaskSourceModal
        open={addOpen}
        workspaceId={workspaceId}
        onClose={() => setAddOpen(false)}
      />
    </div>
  )
}
