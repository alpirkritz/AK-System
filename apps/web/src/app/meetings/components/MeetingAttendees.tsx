'use client'

import { trpc } from '@/lib/trpc'

type PersonRow = {
  id: string
  name: string
  role?: string | null
  color?: string | null
  company?: string | null
  tags?: string | null
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

  const attach = trpc.meetings.attachPerson.useMutation({
    onSuccess: () => {
      void utils.meetings.getById.invalidate()
      void utils.meetings.list.invalidate()
      void utils.people.list.invalidate()
    },
  })

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
    try {
      for (const person of tagged) {
        if (peopleIds.includes(person.id)) continue
        await attach.mutateAsync({ meetingId, personId: person.id })
      }
    } catch {
      // mutation onError is not set; a failed tag add leaves the list unchanged
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
                disabled={attach.isPending}
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
        <p className="text-sm text-[#97a4c2]">עדיין אין משתתפים בפגישה</p>
      )}

      <div className="space-y-2">
        {peopleIds.map((pid) => {
          const person = people.find((item) => item.id === pid)
          if (!person) return null
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
