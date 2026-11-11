'use client'

import { useId, useState } from 'react'

type PersonOption = {
  id: string
  name: string
  company?: string | null
  role?: string | null
}

type AttachInput = { personId: string } | { name: string }

export function AddPersonControl({
  people,
  excludeIds,
  disabled,
  onAttach,
}: {
  people: PersonOption[]
  excludeIds: string[]
  disabled?: boolean
  onAttach: (input: AttachInput) => void
}) {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
  const exact = people.find((person) => person.name.trim().toLowerCase() === q)
  const alreadyOnMeeting = Boolean(exact && excludeIds.includes(exact.id))
  const matches = people
    .filter((person) => !excludeIds.includes(person.id))
    .filter((person) => !q || person.name.toLowerCase().includes(q))
    .slice(0, 8)
  const showCreate = trimmed.length >= 2 && !exact

  function close() {
    setOpen(false)
    setQuery('')
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary min-h-[44px]"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-expanded={open}
      >
        + הוסף אדם
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <label htmlFor={inputId} className="sr-only">
            חיפוש איש קשר
          </label>
          <input
            id={inputId}
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חפש או הקלד שם"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <div className="max-h-52 overflow-y-auto space-y-1">
            {matches.map((person) => (
              <button
                key={person.id}
                type="button"
                className="btn btn-ghost min-h-[44px] w-full text-right"
                disabled={disabled}
                onClick={() => {
                  onAttach({ personId: person.id })
                  close()
                }}
              >
                {person.name}
                {person.company ? (
                  <span className="text-[#7a89ab] mr-2">· {person.company}</span>
                ) : null}
              </button>
            ))}
            {showCreate && (
              <button
                type="button"
                className="btn btn-primary min-h-[44px] w-full text-right"
                disabled={disabled}
                onClick={() => {
                  onAttach({ name: trimmed })
                  close()
                }}
              >
                צור איש קשר «{trimmed}» והוסף לפגישה
              </button>
            )}
            {alreadyOnMeeting && exact && (
              <p className="text-sm text-[#97a4c2] px-1">{exact.name} כבר בפגישה</p>
            )}
            {matches.length === 0 && !showCreate && !alreadyOnMeeting && (
              <p className="text-sm text-[#97a4c2] px-1">
                {trimmed ? 'אין אנשי קשר תואמים' : 'הקלידו שם כדי לחפש או ליצור'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
