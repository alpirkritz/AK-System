'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface PersonOption {
  id: string
  name: string
  company?: string | null
  role?: string | null
  color?: string | null
}

/**
 * Type-to-filter picker for a single person. Unlike `CreatableSelect` it works on
 * ids rather than raw strings and cannot create new entries.
 */
export function PersonSelect({
  value,
  options,
  onChange,
  selfId,
  placeholder = 'התחל להקליד שם...',
  id,
  labelledBy,
}: {
  value: string
  options: PersonOption[]
  onChange: (personId: string) => void
  /** Pinned to the top of the list and tagged "אני". */
  selfId?: string | null
  placeholder?: string
  id?: string
  /** Id of the visible `<label>`; a plain `htmlFor` cannot name a div. */
  labelledBy?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listboxId = `${id ?? 'person-select'}-listbox`

  const sorted = useMemo(() => {
    if (!selfId) return options
    const self = options.find((p) => p.id === selfId)
    if (!self) return options
    return [self, ...options.filter((p) => p.id !== selfId)]
  }, [options, selfId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.company ?? '').toLowerCase().includes(q) ||
        (p.role ?? '').toLowerCase().includes(q)
    )
  }, [sorted, query])

  const selected = options.find((p) => p.id === value)

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
    setOpen(true)
    setQuery('')
  }

  const select = (personId: string) => {
    onChange(personId)
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
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const person = filtered[highlight]
      if (person) select(person.id)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        id={id}
        className="input flex items-center gap-2 cursor-pointer min-h-[44px]"
        role="combobox"
        tabIndex={open ? -1 : 0}
        aria-labelledby={labelledBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            return
          }
          if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault()
            openList()
          }
        }}
      >
        {open ? (
          <input
            type="text"
            autoFocus
            className="flex-1 bg-transparent border-none outline-none min-w-0 text-[#eef3fb]"
            value={query}
            placeholder={placeholder}
            aria-label="חיפוש אחראי"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={filtered[highlight] ? `${listboxId}-${filtered[highlight].id}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={cn('flex-1 truncate', !selected && 'text-[#647399]')}>
            {selected ? selected.name : 'ללא אחראי'}
          </span>
        )}
        {selected && selected.id === selfId && !open && (
          <span className="shrink-0 text-[11px] text-[#2dd4bf] bg-[#2dd4bf]/10 border border-[#2dd4bf]/30 rounded-full px-2 py-0.5">
            אני
          </span>
        )}
        <ChevronDown
          className={cn('w-4 h-4 text-[#5a688c] shrink-0 transition-transform', open && 'rotate-180')}
        />
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="אחראי"
          className="absolute top-full mt-1 left-0 right-0 z-20 bg-[#1d2b46] border border-[#2f4368] rounded-lg shadow-lg max-h-[240px] overflow-y-auto py-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={cn(
              'w-full text-right px-3 py-2 min-h-[44px] text-sm transition-colors',
              !value ? 'text-[#2dd4bf] bg-[#2dd4bf]/10' : 'text-[#7a89ab] hover:bg-[#29395d]'
            )}
            onClick={() => select('')}
          >
            ללא אחראי
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[#5a688c]">לא נמצא איש קשר</div>
          ) : (
            filtered.map((p, index) => (
              <button
                type="button"
                key={p.id}
                id={`${listboxId}-${p.id}`}
                role="option"
                aria-selected={value === p.id}
                className={cn(
                  'flex items-center gap-2 w-full text-right px-3 py-2 min-h-[44px] text-sm transition-colors',
                  value === p.id ? 'text-[#2dd4bf] bg-[#2dd4bf]/10' : 'text-[#b8c4dc]',
                  index === highlight && value !== p.id && 'bg-[#29395d]'
                )}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => select(p.id)}
              >
                <span className="truncate">{p.name}</span>
                {p.id === selfId && <span className="text-[11px] text-[#2dd4bf]">אני</span>}
                {p.company && (
                  <span className="text-[11px] text-[#5a688c] truncate">· {p.company}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
