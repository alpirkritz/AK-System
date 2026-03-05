'use client'

import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PeopleFilters } from './usePeopleState'

interface Props {
  filters: PeopleFilters
  onSetFilter: <K extends keyof PeopleFilters>(key: K, value: PeopleFilters[K]) => void
  onClearFilters: () => void
  hasActiveFilters: boolean
  filterOptions?: {
    tags: string[]
    companies: string[]
    goals: string[]
  }
}

const LAST_CONTACT_PRESETS = [
  { value: '' as const, label: 'הכל' },
  { value: '7d' as const, label: '7 ימים' },
  { value: '30d' as const, label: '30 ימים' },
  { value: '90d+' as const, label: 'מעל 90 יום' },
]

function FilterDropdown({
  label,
  value,
  options,
  onChange,
  placeholder = 'בחר...',
}: {
  label: string
  value: string
  options: string[]
  onChange: (val: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        className={cn(
          'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all',
          value
            ? 'border-primary/30 bg-primary/10 text-primary-300'
            : 'border-surface-border text-text-muted hover:border-[#444] hover:text-text-body'
        )}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        {value && <span className="font-medium">{value}</span>}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 z-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg min-w-[160px] max-h-[240px] overflow-y-auto py-1">
          <button
            className={cn(
              'w-full text-right px-3 py-1.5 text-xs transition-colors',
              !value ? 'text-primary-300 bg-primary/5' : 'text-[#aaa] hover:bg-[#222]'
            )}
            onClick={() => { onChange(''); setOpen(false) }}
          >
            {placeholder}
          </button>
          {options.map(opt => (
            <button
              key={opt}
              className={cn(
                'w-full text-right px-3 py-1.5 text-xs transition-colors',
                value === opt ? 'text-primary-300 bg-primary/5' : 'text-[#aaa] hover:bg-[#222]'
              )}
              onClick={() => { onChange(opt); setOpen(false) }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TagsFilterDropdown({
  selectedTags,
  allTags,
  onChange,
}: {
  selectedTags: string[]
  allTags: string[]
  onChange: (tags: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter(t => t !== tag))
    } else {
      onChange([...selectedTags, tag])
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        className={cn(
          'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all',
          selectedTags.length > 0
            ? 'border-primary/30 bg-primary/10 text-primary-300'
            : 'border-surface-border text-text-muted hover:border-[#444] hover:text-text-body'
        )}
        onClick={() => setOpen(!open)}
      >
        <span>תגיות</span>
        {selectedTags.length > 0 && (
          <span className="bg-primary/20 text-primary-300 rounded-full px-1.5 text-[10px] font-semibold">
            {selectedTags.length}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 z-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg min-w-[180px] max-h-[240px] overflow-y-auto py-1">
          {allTags.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#555]">אין תגיות</div>
          )}
          {allTags.map(tag => (
            <button
              key={tag}
              className={cn(
                'w-full text-right px-3 py-1.5 text-xs transition-colors flex items-center gap-2',
                selectedTags.includes(tag) ? 'text-primary-300 bg-primary/5' : 'text-[#aaa] hover:bg-[#222]'
              )}
              onClick={() => toggle(tag)}
            >
              <span className={cn(
                'w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] shrink-0',
                selectedTags.includes(tag) ? 'bg-primary border-primary text-[#0f0f0f]' : 'border-[#444]'
              )}>
                {selectedTags.includes(tag) && '✓'}
              </span>
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function PeopleFilterBar({
  filters,
  onSetFilter,
  onClearFilters,
  hasActiveFilters,
  filterOptions,
}: Props) {
  const quickFilters: { label: string; active: boolean; onClick: () => void }[] = [
    {
      label: 'הכל',
      active: !filters.contactNow && !filters.goal && filters.tags.length === 0 && !filters.company && !filters.lastContactPreset,
      onClick: () => onClearFilters(),
    },
    {
      label: 'קשר עכשיו',
      active: filters.contactNow,
      onClick: () => onSetFilter('contactNow', !filters.contactNow),
    },
    ...(filterOptions?.goals ?? []).map(g => ({
      label: g,
      active: filters.goal === g,
      onClick: () => onSetFilter('goal', filters.goal === g ? '' : g),
    })),
  ]

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <div className="flex items-center gap-1.5">
        {quickFilters.map(qf => (
          <button
            key={qf.label}
            className={cn('filter-chip', qf.label === 'קשר עכשיו' && 'flex items-center gap-1')}
            aria-pressed={qf.active}
            onClick={qf.onClick}
          >
            {qf.label === 'קשר עכשיו' && <Clock className="w-3 h-3" />}
            {qf.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-[#2a2a2a]" />

      <div className="flex items-center gap-2">
        <TagsFilterDropdown
          selectedTags={filters.tags}
          allTags={filterOptions?.tags ?? []}
          onChange={tags => onSetFilter('tags', tags)}
        />
        <FilterDropdown
          label="חברה"
          value={filters.company}
          options={filterOptions?.companies ?? []}
          onChange={val => onSetFilter('company', val)}
          placeholder="כל החברות"
        />
        <FilterDropdown
          label="קשר אחרון"
          value={
            filters.lastContactPreset
              ? LAST_CONTACT_PRESETS.find(p => p.value === filters.lastContactPreset)?.label ?? ''
              : ''
          }
          options={LAST_CONTACT_PRESETS.filter(p => p.value).map(p => p.label)}
          onChange={val => {
            const preset = LAST_CONTACT_PRESETS.find(p => p.label === val)
            onSetFilter('lastContactPreset', preset?.value ?? '')
          }}
          placeholder="כל הזמנים"
        />
      </div>

      {hasActiveFilters && (
        <>
          <div className="w-px h-5 bg-[#2a2a2a]" />
          <div className="flex items-center gap-1.5 flex-wrap">
            {filters.tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary-300 border border-primary/20">
                {tag}
                <button
                  className="hover:text-[#f0ede6] transition-colors"
                  onClick={() => onSetFilter('tags', filters.tags.filter(t => t !== tag))}
                  aria-label={`הסר תגית ${tag}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              className="text-xs text-[#666] hover:text-[#e8477a] transition-colors"
              onClick={onClearFilters}
            >
              נקה הכל
            </button>
          </div>
        </>
      )}
    </div>
  )
}
