'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { notionPeopleSyncMessage } from '@/lib/notion-people-sync-message'
import { SyncToast } from '@/components/SyncToast'

const COLORS = ['#38bdf8', '#2dd4bf', '#fb7185', '#47e8a8', '#b847e8']

export function ProjectModal({
  open,
  onClose,
  editingId,
}: {
  open: boolean
  onClose: () => void
  editingId: string | null
}) {
  const [form, setForm] = useState({ name: '', color: '#38bdf8' })
  const [personIds, setPersonIds] = useState<string[]>([])
  const [peopleQuery, setPeopleQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const { data: project } = trpc.projects.getById.useQuery(
    { id: editingId! },
    { enabled: !!editingId && open },
  )
  const { data: related } = trpc.projects.getRelated.useQuery(
    { id: editingId! },
    { enabled: !!editingId && open },
  )
  const { data: people = [] } = trpc.people.list.useQuery(undefined, { enabled: open })
  const utils = trpc.useUtils()

  const setPeople = trpc.projects.setPeople.useMutation({
    onSuccess: (res) => {
      utils.projects.getRelated.invalidate()
      utils.people.getRelated.invalidate()
      const msg = notionPeopleSyncMessage(res.notionSync)
      if (msg) setSyncMessage(msg)
    },
  })

  const create = trpc.projects.create.useMutation({
    onSuccess: async (row) => {
      if (personIds.length > 0 && row?.id) {
        await setPeople.mutateAsync({ projectId: row.id, personIds })
      }
      utils.projects.list.invalidate()
      onClose()
    },
    onError: (err) => setError(err.message),
  })
  const update = trpc.projects.update.useMutation({
    onSuccess: async () => {
      if (editingId) {
        await setPeople.mutateAsync({ projectId: editingId, personIds })
      }
      utils.projects.list.invalidate()
      utils.projects.getById.invalidate({ id: editingId! })
      onClose()
    },
    onError: (err) => setError(err.message),
  })

  useEffect(() => {
    if (!open) return
    setError(null)
    setSyncMessage(null)
    setPeopleQuery('')
    if (editingId && project) {
      setForm({ name: project.name, color: project.color ?? '#38bdf8' })
    } else {
      setForm({ name: '', color: '#38bdf8' })
      setPersonIds([])
    }
  }, [open, editingId, project])

  useEffect(() => {
    if (open && editingId && related) {
      setPersonIds(related.people.map((p) => p.id))
    }
  }, [open, editingId, related])

  const togglePerson = (id: string) => {
    setPersonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const name = form.name.trim()
    if (!name) return
    if (editingId) {
      update.mutate({ id: editingId, name, color: form.color })
    } else {
      create.mutate({ name, color: form.color })
    }
  }

  const canSave =
    form.name.trim().length > 0 &&
    !create.isPending &&
    !update.isPending &&
    !setPeople.isPending

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-6 tracking-tight">
          {editingId ? 'ערוך פרויקט' : 'פרויקט חדש'}
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="project-name">
              שם הפרויקט
            </label>
            <input
              id="project-name"
              className="input"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="שם"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">צבע</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <div
                  key={c}
                  role="button"
                  tabIndex={0}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  onKeyDown={(e) => e.key === 'Enter' && setForm((f) => ({ ...f, color: c }))}
                  className="w-7 h-7 rounded-full cursor-pointer border-[3px] border-transparent transition-all"
                  style={{
                    background: c,
                    borderColor: form.color === c ? 'white' : 'transparent',
                  }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="label">אנשים משויכים</label>
            <input
              className="input text-sm mb-2"
              type="search"
              value={peopleQuery}
              onChange={(e) => setPeopleQuery(e.target.value)}
              placeholder="חיפוש אנשים..."
              autoComplete="off"
            />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[#29395d] p-2 space-y-1">
              {people.length === 0 && (
                <div className="text-xs text-[#5a688c] px-1 py-2">אין אנשים ברשימה</div>
              )}
              {people
                .filter((p) => {
                  const q = peopleQuery.trim().toLowerCase()
                  if (!q) return true
                  return (
                    p.name.toLowerCase().includes(q) ||
                    (p.company ?? '').toLowerCase().includes(q) ||
                    (p.role ?? '').toLowerCase().includes(q)
                  )
                })
                .map((p) => {
                  const checked = personIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#1a2744] cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        className="accent-[#2dd4bf]"
                        checked={checked}
                        onChange={() => togglePerson(p.id)}
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: p.color ?? '#2dd4bf' }}
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  )
                })}
            </div>
            {personIds.length > 0 && (
              <div className="text-[11px] text-[#5a688c] mt-1.5">{personIds.length} נבחרו</div>
            )}
          </div>
          <div className="flex gap-2.5 mt-6 justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
            <button
              type="submit"
              className="btn btn-primary cursor-pointer"
              disabled={!canSave}
            >
              {create.isPending || update.isPending || setPeople.isPending ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </form>
        {syncMessage && (
          <SyncToast message={syncMessage} onDismiss={() => setSyncMessage(null)} />
        )}
      </div>
    </div>
  )
}
