'use client'

import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@ak-system/types'

const STORAGE_KEY = 'ak.quickAdd.workspaceId'
const PERSONAL_WORKSPACE_ID = 'ws_personal'

type Priority = 'high' | 'medium' | 'low'

/** Lightweight capture: title + source, everything else behind a disclosure. */
export function QuickAddTaskModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}) {
  const { data: workspacesData } = trpc.workspaces.list.useQuery(undefined, { enabled: open })
  const workspaces = workspacesData ?? []

  const [title, setTitle] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const utils = trpc.useUtils()
  const create = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      if (workspaceId) window.localStorage.setItem(STORAGE_KEY, workspaceId)
      onCreated?.()
      onClose()
    },
    onError: () => setError('לא הצלחנו להוסיף את המשימה. נסה שוב.'),
  })

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDueDate('')
    setPriority('medium')
    setShowMore(false)
    setError(null)
    const stored = window.localStorage.getItem(STORAGE_KEY)
    setWorkspaceId(stored ?? PERSONAL_WORKSPACE_ID)
  }, [open])

  // The remembered workspace may have been deleted or renamed away; fall back to personal.
  useEffect(() => {
    if (!open || !workspacesData) return
    setWorkspaceId((current) => {
      if (current && workspacesData.some((w) => w.id === current)) return current
      return workspacesData.find((w) => w.id === PERSONAL_WORKSPACE_ID)?.id ?? ''
    })
  }, [open, workspacesData])

  useEffect(() => {
    if (!open) return
    titleRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled])',
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || create.isPending) return
    setError(null)
    create.mutate({
      title: trimmed,
      workspaceId: workspaceId || null,
      dueDate: dueDate || null,
      priority,
    })
  }

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="הוספת משימה מהירה"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-bold text-lg mb-6 tracking-tight">משימה מהירה</div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="quick-add-title">
              כותרת
            </label>
            <input
              id="quick-add-title"
              ref={titleRef}
              className="input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="מה צריך לעשות?"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label" htmlFor="quick-add-workspace">
              מקור
            </label>
            <select
              id="quick-add-workspace"
              className="select"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              <option value="">ללא מקור</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="text-xs text-[#7a89ab] hover:text-[#b8c4dc] transition-colors self-start min-h-[44px] md:min-h-0"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? 'פחות פרטים' : 'עוד פרטים'}
          </button>

          {showMore && (
            <>
              <div>
                <label className="label" htmlFor="quick-add-due">
                  תאריך יעד
                </label>
                <input
                  id="quick-add-due"
                  className="input"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label">עדיפות</label>
                <div className="flex gap-2">
                  {(['high', 'medium', 'low'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={priority === p}
                      onClick={() => setPriority(p)}
                      className="cursor-pointer py-1.5 px-3 rounded-[20px] border text-sm transition-all"
                      style={{
                        borderColor: priority === p ? PRIORITY_COLORS[p] : '#2f4368',
                        background: priority === p ? PRIORITY_COLORS[p] + '22' : 'transparent',
                        color: priority === p ? PRIORITY_COLORS[p] : '#7a89ab',
                      }}
                    >
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2.5 mt-2 justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || create.isPending}>
              {create.isPending ? 'מוסיף...' : 'הוסף'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
