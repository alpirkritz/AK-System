'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { AddPersonControl } from './AddPersonControl'

type PersonRow = {
  id: string
  name: string
  role?: string | null
  color?: string | null
  company?: string | null
  tags?: string | null
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'לא הצלחנו לעדכן את המשתתפים. נסה שוב.'
}

export function MeetingAttendees({
  meetingId,
  people,
  peopleIds,
}: {
  meetingId: string
  people: PersonRow[]
  peopleIds: string[]
}) {
  const utils = trpc.useUtils()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    void utils.meetings.getById.invalidate()
    void utils.meetings.list.invalidate()
    void utils.people.list.invalidate()
    void utils.meetings.getAnalysis.invalidate()
  }

  const attach = trpc.meetings.attachPerson.useMutation({
    onSuccess: (result) => {
      setError(null)
      setNotice(
        result.created
          ? `${result.name} נוסף לפגישה ולאנשי הקשר`
          : `${result.name} נוסף לפגישה`,
      )
      refresh()
    },
    onError: (err) => setError(errorText(err)),
  })

  const detach = trpc.meetings.detachPerson.useMutation({
    onSuccess: () => {
      setConfirmId(null)
      setError(null)
      setNotice('הוסר מהפגישה')
      refresh()
    },
    onError: (err) => setError(errorText(err)),
  })

  const pending = attach.isPending || detach.isPending

  const allTags = new Set<string>()
  people.forEach((person) => {
    person.tags?.split(',').forEach((tag) => {
      const trimmed = tag.trim()
      if (trimmed) allTags.add(trimmed)
    })
  })

  async function addTag(tag: string) {
    const tagged = people.filter((person) =>
      person.tags?.split(',').some((item) => item.trim() === tag),
    )
    setError(null)
    try {
      for (const person of tagged) {
        if (peopleIds.includes(person.id)) continue
        await attach.mutateAsync({ meetingId, personId: person.id })
      }
    } catch {
      // onError already surfaces the Hebrew message
    }
  }

  return (
    <div className="card">
      <div className="text-xs font-semibold text-[#5a688c] mb-3 uppercase tracking-wider">משתתפים</div>

      {allTags.size > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[...allTags].map((tag) => {
            const count = people.filter((person) =>
              person.tags?.split(',').some((item) => item.trim() === tag),
            ).length
            return (
              <button
                key={tag}
                type="button"
                onClick={() => void addTag(tag)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-3 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 hover:border-teal-500/50 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
              >
                + {tag}
                <span className="text-[10px] opacity-70">({count})</span>
              </button>
            )
          })}
        </div>
      )}

      {peopleIds.length === 0 && (
        <p className="text-sm text-[#97a4c2] mb-3">עדיין אין משתתפים בפגישה</p>
      )}

      <div className="space-y-2 mb-3">
        {peopleIds.map((pid) => {
          const person = people.find((item) => item.id === pid)
          if (!person) return null
          const confirming = confirmId === pid
          return (
            <div key={pid} className="flex gap-2.5 items-center">
              <div
                className="avatar w-[34px] h-[34px] text-[13px] border-[1.5px] shrink-0"
                style={{
                  background: (person.color ?? '#2dd4bf') + '22',
                  color: person.color ?? '#2dd4bf',
                  borderColor: (person.color ?? '#2dd4bf') + '33',
                }}
              >
                {person.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{person.name}</div>
                {person.role ? <div className="text-[11px] text-[#5a688c]">{person.role}</div> : null}
              </div>
              {confirming ? (
                <div className="flex flex-col items-end gap-1">
                  <p className="text-xs text-[#97a4c2] text-right max-w-[220px]">
                    להסיר את {person.name} מהפגישה? איש הקשר יישאר באנשים.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost min-h-[44px]"
                      onClick={() => setConfirmId(null)}
                      disabled={pending}
                    >
                      ביטול
                    </button>
                    <button
                      type="button"
                      className="btn min-h-[44px] bg-[#fb7185] text-[#0e1626]"
                      onClick={() => detach.mutate({ meetingId, personId: pid })}
                      disabled={pending}
                    >
                      הסר
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost min-h-[44px]"
                  aria-label={`הסר את ${person.name} מהפגישה`}
                  onClick={() => setConfirmId(pid)}
                  disabled={pending}
                >
                  הסר
                </button>
              )}
            </div>
          )
        })}
      </div>

      <AddPersonControl
        people={people}
        excludeIds={peopleIds}
        disabled={pending}
        onAttach={(input) => {
          setNotice(null)
          attach.mutate({ meetingId, ...input })
        }}
      />

      {notice ? <p className="mt-3 text-sm text-[#34d399]">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-[#fb7185]">{error}</p> : null}
    </div>
  )
}
