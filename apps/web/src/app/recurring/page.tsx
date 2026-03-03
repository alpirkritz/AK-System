'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { DAYS_HE } from '@ak-system/types'

export default function RecurringPage() {
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()

  const recurring = meetings.filter((m) => m.recurring)
  const getPerson = (id: string) => people.find((p) => p.id === id)
  const getTasksForMeeting = (mid: string) => tasksList.filter((t) => t.meetingId === mid)

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">פגישות חוזרות</h1>
      <p className="text-[#555] text-sm mb-7">פגישות שמתקיימות כל שבוע</p>
      <div className="flex flex-col gap-3.5">
        {recurring.map((m) => {
          const meetingWithIds = m as { peopleIds?: string[] }
          const tasks = getTasksForMeeting(m.id)
          return (
            <Link key={m.id} href={`/meetings/${m.id}`}>
              <div className="card cursor-pointer">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-[10px] bg-[#e8c54722] flex items-center justify-center text-lg">
                      ↻
                    </div>
                    <div>
                      <div className="font-semibold text-[15px]">{m.title}</div>
                      <div className="text-xs text-[#666] mt-0.5">
                        כל {DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבוע'} · {m.time}
                      </div>
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="flex gap-1 mb-1.5">
                      {(meetingWithIds.peopleIds ?? []).map((pid) => {
                        const p = getPerson(pid)
                        return p ? (
                          <div
                            key={pid}
                            className="avatar border-[1.5px]"
                            style={{
                              background: (p.color ?? '#e8c547') + '22',
                              color: p.color ?? '#e8c547',
                              borderColor: (p.color ?? '#e8c547') + '33',
                            }}
                          >
                            {p.name[0]}
                          </div>
                        ) : null
                      })}
                    </div>
                    <div className="text-[11px] text-[#555]">{tasks.length} משימות</div>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
        {recurring.length === 0 && (
          <div className="text-[#555] text-sm">אין פגישות חוזרות עדיין. הוסף פגישה עם חזרה שבועית.</div>
        )}
      </div>
    </div>
  )
}
