'use client'

import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { trpc } from '@/lib/trpc'

interface Option {
  id: string
  name: string
  hint: string | null
}

/**
 * "מדווח ל" — search all of People, with this workspace's members listed first. Picking someone
 * outside the workspace is fine: saving adds them to it.
 */
export function ManagerPicker({
  personId,
  members,
  value,
  onChange,
}: {
  personId: string
  members: Option[]
  value: { id: string; name: string } | null
  onChange: (next: { id: string; name: string } | null) => void
}) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const q = query.trim()
  const { data: found = [] } = trpc.people.search.useQuery({ query: q }, { enabled: open && q.length > 0 })

  const memberIds = new Set(members.map((m) => m.id))
  const needle = q.toLowerCase()
  const options: Option[] = [
    ...members.filter((m) => m.id !== personId && (!needle || m.name.toLowerCase().includes(needle))),
    ...found
      .filter((p) => p.id !== personId && !memberIds.has(p.id) && p.status === 'confirmed')
      .map((p) => ({ id: p.id, name: p.name, hint: 'יצורף לעולם' })),
  ].slice(0, 8)

  const pick = (o: Option) => {
    onChange({ id: o.id, name: o.name })
    setQuery('')
    setOpen(false)
  }

  if (value) {
    return (
      <div className="input flex items-center gap-2" data-testid="manager-picker-selected">
        <span className="flex-1 truncate">{value.name}</span>
        <button
          type="button"
          className="text-[#5a688c] hover:text-[#eef3fb] rounded p-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#e8c547]"
          aria-label={`הסר: ${value.name}`}
          onClick={() => onChange(null)}
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        id="affiliation-reports-to"
        className="input w-full"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${options[active]!.id}` : undefined}
        placeholder="חיפוש בכל האנשים…"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && options[active]) { e.preventDefault(); pick(options[active]!) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-[#2f4368] bg-[#141f36] py-1 text-sm shadow-lg"
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={i === active}
              className={`px-3 py-1.5 cursor-pointer flex items-baseline gap-2 ${i === active ? 'bg-[#1a2744] text-[#eef3fb]' : 'text-[#b8c4dc]'}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="truncate">{o.name}</span>
              {o.hint && <span className="text-[11px] text-[#5a688c] shrink-0">· {o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
