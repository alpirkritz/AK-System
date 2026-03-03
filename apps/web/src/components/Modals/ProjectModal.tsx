'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'

const COLORS = ['#47b8e8', '#e8c547', '#e8477a', '#47e8a8', '#b847e8']

export function ProjectModal({
  open,
  onClose,
  editingId,
}: {
  open: boolean
  onClose: () => void
  editingId: string | null
}) {
  const [form, setForm] = useState({ name: '', color: '#47b8e8' })
  const [error, setError] = useState<string | null>(null)
  const { data: project } = trpc.projects.getById.useQuery({ id: editingId! }, { enabled: !!editingId && open })
  const utils = trpc.useUtils()
  const create = trpc.projects.create.useMutation({
    onSuccess: () => { utils.projects.list.invalidate(); onClose() },
    onError: (err) => setError(err.message),
  })
  const update = trpc.projects.update.useMutation({
    onSuccess: () => { utils.projects.list.invalidate(); onClose() },
    onError: (err) => setError(err.message),
  })

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editingId && project) {
      setForm({ name: project.name, color: project.color ?? '#47b8e8' })
    } else {
      setForm({ name: '', color: '#47b8e8' })
    }
  }, [open, editingId, project])

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

  const canSave = form.name.trim().length > 0 && !create.isPending && !update.isPending

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
          <div className="flex gap-2.5 mt-6 justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
            <button
              type="submit"
              className="btn btn-primary cursor-pointer"
              disabled={!canSave}
            >
              {create.isPending || update.isPending ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
