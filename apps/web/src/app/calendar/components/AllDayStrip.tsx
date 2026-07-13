import { useState } from 'react'
import type { CalEvent } from '../lib/types'
import { ALL_DAY_MAX_ROWS } from '../lib/constants'
import { isoDate } from '../lib/date-utils'
import EventPill from './EventPill'

interface AllDayStripProps {
  days: Date[]
  events: CalEvent[]
  onEventClick: (ev: CalEvent) => void
}

export default function AllDayStrip({ days, events, onEventClick }: AllDayStripProps) {
  const [expanded, setExpanded] = useState(false)

  const allDayForDay = (day: Date) =>
    events.filter((ev) => ev.isAllDay && isoDate(new Date(ev.start)) === isoDate(day))

  const maxPerDay = Math.max(...days.map((d) => allDayForDay(d).length))
  if (maxPerDay === 0) return null

  const visibleRows = expanded ? maxPerDay : Math.min(maxPerDay, ALL_DAY_MAX_ROWS)

  return (
    <div className="flex border-b border-[#1d2b46] shrink-0 bg-[#0a1120]">
      <div className="w-14 shrink-0 flex flex-col items-end justify-between pr-2 py-1.5">
        <span className="text-[9px] text-[#435a8c] leading-none select-none">
          כל
          <br />
          היום
        </span>
        {maxPerDay > ALL_DAY_MAX_ROWS && (
          <button
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? 'כווץ' : `הצג ${maxPerDay - ALL_DAY_MAX_ROWS} נוספים`}
            className="text-[9px] text-[#435a8c] hover:text-[#7a89ab] transition-colors leading-none
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60 rounded"
          >
            {expanded ? '▲' : `+${maxPerDay - ALL_DAY_MAX_ROWS}`}
          </button>
        )}
      </div>
      {days.map((day, i) => {
        const dayEvents = allDayForDay(day)
        const hidden = dayEvents.length - visibleRows
        return (
          <div
            key={i}
            className="flex-1 border-r border-[#1d2b46] first:border-r-0 px-0.5 py-1 space-y-0.5"
          >
            {dayEvents.slice(0, visibleRows).map((ev) => (
              <EventPill key={ev.id} ev={ev} onClick={onEventClick} />
            ))}
            {!expanded && hidden > 0 && (
              <button
                onClick={() => setExpanded(true)}
                title={`הצג ${hidden} אירועים נוספים`}
                className="w-full text-[9px] text-[#4d659c] hover:text-[#8593b3] px-1.5 py-0.5
                  transition-colors cursor-pointer rounded hover:bg-[#141f36]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60"
              >
                +{hidden} נוספים
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
