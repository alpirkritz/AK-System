'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

interface CreatableSelectProps {
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  dir?: 'ltr' | 'rtl'
}

export function CreatableSelect({
  value,
  options,
  onChange,
  placeholder = 'בחר...',
  label,
  dir,
}: CreatableSelectProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = inputValue.trim()
    ? options.filter(o => o.toLowerCase().includes(inputValue.trim().toLowerCase()))
    : options
  const exactMatch = inputValue.trim() && options.some(o => o.toLowerCase() === inputValue.trim().toLowerCase())
  const showCreate = inputValue.trim() && !exactMatch

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (val: string) => {
    onChange(val)
    setInputValue('')
    setOpen(false)
  }

  const handleCreate = () => {
    const newVal = inputValue.trim()
    if (newVal) {
      onChange(newVal)
      setInputValue('')
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      {label && <label className="label">{label}</label>}
      <div
        className="input flex items-center gap-2 cursor-pointer min-h-[42px]"
        onClick={() => { setOpen(!open); if (!open) inputRef.current?.focus() }}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {open ? (
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none outline-none min-w-0 text-[#f0ede6]"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') {
                if (showCreate) handleCreate()
                else if (filtered[0]) handleSelect(filtered[0])
              }
            }}
            onClick={e => e.stopPropagation()}
            placeholder={placeholder}
            dir={dir}
          />
        ) : (
          <span className={cn('flex-1 truncate', !value && 'text-[#666]')} dir={dir}>
            {value || placeholder}
          </span>
        )}
        <ChevronDown className={cn('w-4 h-4 text-[#555] shrink-0 transition-transform', open && 'rotate-180')} />
      </div>
      {open && (
        <div
          className="absolute top-full mt-1 left-0 right-0 z-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg max-h-[220px] overflow-y-auto py-1"
          role="listbox"
        >
          {!value ? null : (
            <button
              type="button"
              className="w-full text-right px-3 py-1.5 text-xs text-[#555] hover:bg-[#222] transition-colors"
              onClick={() => handleSelect('')}
            >
              נקה
            </button>
          )}
          {filtered.map(opt => (
            <button
              type="button"
              key={opt}
              role="option"
              aria-selected={value === opt}
              className={cn(
                'w-full text-right px-3 py-1.5 text-sm transition-colors',
                value === opt ? 'text-[#e8c547] bg-[#e8c547]/10' : 'text-[#ccc] hover:bg-[#222]'
              )}
              onClick={() => handleSelect(opt)}
            >
              {opt}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              className="w-full text-right px-3 py-1.5 text-sm text-[#e8c547] hover:bg-[#222] transition-colors border-t border-[#2a2a2a] mt-1 pt-1"
              onClick={handleCreate}
            >
              הוסף &quot;{inputValue.trim()}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
