'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SearchableAddOption {
  id: string
  name: string
  subtitle?: string | null
  color?: string | null
}

/**
 * Combobox for adding one item from a long list: type to filter, pick, then reset.
 * Used for linking people ↔ projects without a giant native <select>.
 */
export function SearchableAddSelect({
  options,
  onAdd,
  triggerLabel,
  placeholder = 'הקלד לחיפוש...',
  emptyLabel = 'לא נמצאו תוצאות',
  disabled,
  id,
}: {
  options: SearchableAddOption[]
  onAdd: (id: string) => void
  triggerLabel: string
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listboxId = `${id ?? 'searchable-add'}-listbox`

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.subtitle ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  const openList = () => {
    if (disabled) return
    setOpen(true)
    setQuery('')
  }

  const pick = (optionId: string) => {
    onAdd(optionId)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = filtered[highlight]
      if (hit) pick(hit.id)
    }
  }

  return (
    <div ref={wrapRef} className="relative min-w-[180px] max-w-[260px]">
      <button
        type="button"
        id={id}
        disabled={disabled}
        className="input flex items-center gap-2 cursor-pointer min-h-[36px] py-1 text-xs w-full text-right"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className="flex-1 truncate text-[#97a4c2]">{triggerLabel}</span>
        <ChevronDown
          className={cn('w-3.5 h-3.5 text-[#5a688c] shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-30 bg-[#1d2b46] border border-[#2f4368] rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[#2f4368]">
            <input
              type="text"
              autoFocus
              className="input text-xs py-1.5 w-full"
              value={query}
              placeholder={placeholder}
              aria-label={placeholder}
              aria-controls={listboxId}
              aria-activedescendant={
                filtered[highlight] ? `${listboxId}-${filtered[highlight].id}` : undefined
              }
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div
            id={listboxId}
            role="listbox"
            className="max-h-[240px] overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#5a688c]">{emptyLabel}</div>
            ) : (
              filtered.map((o, index) => (
                <button
                  type="button"
                  key={o.id}
                  id={`${listboxId}-${o.id}`}
                  role="option"
                  className={cn(
                    'flex items-center gap-2 w-full text-right px-3 py-2 min-h-[40px] text-sm transition-colors',
                    index === highlight ? 'bg-[#29395d] text-[#eef3fb]' : 'text-[#b8c4dc] hover:bg-[#29395d]',
                  )}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(o.id)}
                >
                  {o.color && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: o.color }}
                    />
                  )}
                  <span className="truncate">{o.name}</span>
                  {o.subtitle && (
                    <span className="text-[11px] text-[#5a688c] truncate">· {o.subtitle}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
