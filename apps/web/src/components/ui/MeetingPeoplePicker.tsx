'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { filterPeople, recentPersonIds, selectedExactName } from '@/lib/meeting-people-suggest'

export interface MeetingPersonOption {
  id: string
  name: string
  company?: string | null
  role?: string | null
  color?: string | null
}

export function MeetingPeoplePicker({
  people,
  selectedIds,
  onChange,
}: {
  people: MeetingPersonOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const { data: meetings = [], isLoading: meetingsLoading } = trpc.meetings.list.useQuery(undefined, {
    staleTime: 30_000,
  })

  const knownIds = useMemo(() => new Set(people.map((person) => person.id)), [people])
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const selected = selectedIds.map((id) => byId.get(id)).filter((person): person is MeetingPersonOption => Boolean(person))

  const trimmed = query.trim()
  const recent = useMemo(() => {
    const ids = recentPersonIds(
      meetings.map((meeting: { date: string; peopleIds?: string[] }) => ({
        date: meeting.date,
        peopleIds: meeting.peopleIds ?? [],
      })),
      knownIds,
      selectedIds,
    )
    return ids.map((id) => byId.get(id)).filter((person): person is MeetingPersonOption => Boolean(person))
  }, [meetings, knownIds, selectedIds, byId])

  const matches = useMemo(
    () => (trimmed ? filterPeople(people, selectedIds, trimmed) : []),
    [people, selectedIds, trimmed],
  )
  const exactSelected = trimmed ? selectedExactName(people, selectedIds, trimmed) : null
  const options = trimmed ? matches : recent

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(options.length - 1, 0)))
  }, [options.length])

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setListOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [])

  function choose(id: string) {
    if (!selectedIds.includes(id)) onChange([...selectedIds, id])
    setQuery('')
    setListOpen(true)
    setHighlight(0)
    inputRef.current?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (!listOpen) return
      event.preventDefault()
      event.stopPropagation()
      setListOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setListOpen(true)
      setHighlight((current) => Math.min(current + 1, Math.max(options.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setListOpen(true)
      setHighlight((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const person = options[highlight]
      if (person) choose(person.id)
      return
    }
    if (event.key === 'Backspace' && query === '' && selectedIds.length > 0) {
      onChange(selectedIds.slice(0, -1))
    }
  }

  const activeId = listOpen && options[highlight] ? `${listboxId}-${options[highlight].id}` : undefined

  return (
    <div ref={wrapRef} data-testid="meeting-people-picker">
      <label className="label" htmlFor={inputId}>משתתפים</label>
      {selected.length === 0 ? (
        <p className="text-sm text-[#97a4c2] mb-2">עדיין אין משתתפים</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-2">
          {selected.map((person) => {
            const color = person.color ?? '#2dd4bf'
            return (
              <div
                key={person.id}
                className="inline-flex items-center rounded-[20px] border text-sm"
                style={{ borderColor: color, background: `${color}22`, color }}
              >
                <span className="py-1.5 ps-2.5">{person.name}</span>
                <button
                  type="button"
                  className="min-h-[44px] min-w-[44px] px-2"
                  aria-label={`הסר את ${person.name}`}
                  onClick={() => onChange(selectedIds.filter((id) => id !== person.id))}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
      <input
        ref={inputRef}
        id={inputId}
        className="input min-h-[44px]"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        data-testid="meeting-people-search"
        value={query}
        placeholder="חפש לפי שם, חברה או תפקיד"
        onChange={(event) => {
          setQuery(event.target.value)
          setListOpen(true)
        }}
        onFocus={() => setListOpen(true)}
        onKeyDown={onKeyDown}
      />
      {listOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="משתתפים"
          className="mt-1 max-h-[240px] overflow-y-auto rounded-lg border border-[#2f4368] bg-[#1d2b46] py-1"
        >
          {!trimmed && recent.length > 0 && (
            <p className="px-3 py-1 text-[11px] font-semibold text-[#5a688c]" data-testid="meeting-people-recent">
              לאחרונה
            </p>
          )}
          {!trimmed && recent.length === 0 && meetingsLoading && (
            <p className="px-3 py-2 text-sm text-[#97a4c2]">טוען…</p>
          )}
          {!trimmed && recent.length === 0 && !meetingsLoading && (
            <p className="px-3 py-2 text-sm text-[#97a4c2]">הקלידו לפחות אות אחת</p>
          )}
          {exactSelected && (
            <p className="px-3 py-2 text-sm text-[#97a4c2]">{exactSelected} כבר בפגישה</p>
          )}
          {trimmed && matches.length === 0 && !exactSelected && (
            <p className="px-3 py-2 text-sm text-[#97a4c2]">אין אנשי קשר תואמים</p>
          )}
          {options.map((person, index) => (
            <button
              type="button"
              key={person.id}
              id={`${listboxId}-${person.id}`}
              role="option"
              aria-selected={index === highlight}
              data-testid="meeting-people-suggestion"
              className={`flex w-full min-h-[44px] items-center px-3 text-right text-sm ${
                index === highlight ? 'bg-[#29395d] text-[#eef3fb]' : 'text-[#b8c4dc]'
              }`}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(person.id)}
            >
              <span className="truncate">{person.name}</span>
              {person.company ? (
                <span className="truncate text-[11px] text-[#5a688c] ms-2">· {person.company}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
