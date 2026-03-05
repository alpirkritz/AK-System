'use client'

import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

interface CreatableMultiSelectProps {
  value: string[]
  options: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  label?: string
  dir?: 'ltr' | 'rtl'
}

export function CreatableMultiSelect({
  value,
  options,
  onChange,
  placeholder = 'בחר או הוסף...',
  label,
  dir,
}: CreatableMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = inputValue.trim()
    ? options.filter(o =>
        o.toLowerCase().includes(inputValue.trim().toLowerCase()) && !value.includes(o)
      )
    : options.filter(o => !value.includes(o))
  const exactMatch = inputValue.trim() && options.some(o => o.toLowerCase() === inputValue.trim().toLowerCase())
  const valueExists = inputValue.trim() && value.includes(inputValue.trim())
  const showCreate = inputValue.trim() && !exactMatch && !valueExists

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const add = (val: string) => {
    const trimmed = val.trim()
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed])
    setInputValue('')
    inputRef.current?.focus()
  }

  const remove = (val: string) => {
    onChange(value.filter(v => v !== val))
  }

  return (
    <div ref={ref} className="relative">
      {label && <label className="label">{label}</label>}
      <div
        className={cn(
          'input min-h-[42px] py-2 flex flex-wrap items-center gap-1.5 cursor-text',
          open && 'border-[#e8c547] ring-2 ring-[#e8c547]/15'
        )}
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
      >
        {value.map(item => (
          <span
            key={item}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2a2a2a] text-xs text-[#f0ede6] border border-[#333]"
          >
            {item}
            <button
              type="button"
              className="hover:bg-[#444] rounded p-0.5 transition-colors"
              onClick={e => { e.stopPropagation(); remove(item) }}
              aria-label={`הסר ${item}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-sm text-[#f0ede6] py-0.5"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Backspace' && !inputValue && value.length) remove(value[value.length - 1])
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter') {
              if (showCreate) add(inputValue)
              else if (filtered[0]) add(filtered[0])
            }
          }}
          placeholder={value.length ? '' : placeholder}
          dir={dir}
        />
        <ChevronDown className={cn('w-4 h-4 text-[#555] shrink-0 transition-transform', open && 'rotate-180')} />
      </div>
      {open && (filtered.length > 0 || showCreate) && (
        <div
          className="absolute top-full mt-1 left-0 right-0 z-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg max-h-[200px] overflow-y-auto py-1"
          role="listbox"
        >
          {filtered.map(opt => (
            <button
              type="button"
              key={opt}
              role="option"
              className="w-full text-right px-3 py-1.5 text-sm text-[#ccc] hover:bg-[#222] transition-colors"
              onClick={() => add(opt)}
            >
              {opt}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              className="w-full text-right px-3 py-1.5 text-sm text-[#e8c547] hover:bg-[#222] transition-colors border-t border-[#2a2a2a] mt-1 pt-1"
              onClick={() => add(inputValue.trim())}
            >
              הוסף &quot;{inputValue.trim()}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
