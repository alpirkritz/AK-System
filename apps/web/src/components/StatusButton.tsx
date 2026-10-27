'use client'

import { useEffect, useRef, useState } from 'react'
import { STATUS_COLORS, STATUS_LABELS, TASK_STATUS_ORDER, type TaskStatus } from '@ak-system/types'
import { trpc } from '@/lib/trpc'

interface StatusButtonProps {
  taskId: string
  status: string | null | undefined
  onUpdated?: (newStatus: string) => void
  onError?: (err: Error) => void
  disabled?: boolean
}

export function StatusButton({ taskId, status, onUpdated, onError, disabled }: StatusButtonProps) {
  const [open, setOpen] = useState(false)
  const [optimistic, setOptimistic] = useState<string | null | undefined>(status)
  const [focusIndex, setFocusIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Keep optimistic in sync when parent status changes
  useEffect(() => {
    setOptimistic(status)
  }, [status])

  const utils = trpc.useUtils()
  const update = trpc.tasks.update.useMutation({
    onSuccess: (_, vars) => {
      void utils.tasks.list.invalidate()
      if (vars.status) onUpdated?.(vars.status)
    },
    onError: (err) => {
      // Revert on error
      setOptimistic(status)
      onError?.(new Error(err.message))
    },
  })

  const currentKey = (optimistic ?? 'not_started') as TaskStatus
  const currentColor = STATUS_COLORS[currentKey] ?? '#7a89ab'
  const currentLabel = STATUS_LABELS[currentKey] ?? optimistic ?? 'לא התחיל'

  function selectStatus(newStatus: string) {
    if (newStatus === optimistic) {
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    setOptimistic(newStatus)
    setOpen(false)
    triggerRef.current?.focus()
    update.mutate({ id: taskId, status: newStatus as TaskStatus })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setFocusIndex(TASK_STATUS_ORDER.indexOf(currentKey as typeof TASK_STATUS_ORDER[number]) || 0)
      setOpen(true)
    }
  }

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIndex((i) => (i + 1) % TASK_STATUS_ORDER.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIndex((i) => (i - 1 + TASK_STATUS_ORDER.length) % TASK_STATUS_ORDER.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectStatus(TASK_STATUS_ORDER[focusIndex])
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Focus the active item when menu opens
  useEffect(() => {
    if (!open) return
    const idx = TASK_STATUS_ORDER.indexOf(currentKey as typeof TASK_STATUS_ORDER[number])
    setFocusIndex(idx >= 0 ? idx : 0)
  }, [open, currentKey])

  // Focus the correct item in the list
  useEffect(() => {
    if (!open || !menuRef.current) return
    const items = menuRef.current.querySelectorAll<HTMLButtonElement>('[data-status-item]')
    items[focusIndex]?.focus()
  }, [focusIndex, open])

  return (
    <span className="relative inline-block shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || update.isPending}
        aria-label={`סטטוס: ${currentLabel}. שנה סטטוס`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-[#2dd4bf]"
        style={{ color: currentColor }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: currentColor }}
          aria-hidden="true"
        />
        <span>{currentLabel}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="בחר סטטוס"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          className="absolute z-50 top-full mt-1 right-0 bg-[#0f172a] border border-[#2f4368] rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{ direction: 'rtl' }}
        >
          {TASK_STATUS_ORDER.map((s, i) => {
            const col = STATUS_COLORS[s]
            const lbl = STATUS_LABELS[s]
            const isActive = s === currentKey
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={isActive}
                data-status-item
                tabIndex={focusIndex === i ? 0 : -1}
                onClick={() => selectStatus(s)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#cdd7ea] hover:bg-white/5 focus:bg-white/5 focus:outline-none"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: col }}
                  aria-hidden="true"
                />
                <span className="flex-1 text-right">{lbl}</span>
                {isActive && <span className="text-[#2dd4bf] text-[10px]">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
