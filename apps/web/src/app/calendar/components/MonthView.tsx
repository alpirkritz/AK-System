import type { CalEvent } from '../lib/types'
import { HE_DAYS } from '../lib/constants'
import { isoDate, isToday, fmtFullDate } from '../lib/date-utils'
import EventPill from './EventPill'

interface MonthViewProps {
  events: CalEvent[]
  month: number
  year: number
  onEventClick: (ev: CalEvent) => void
  onDayClick: (day: Date) => void
}

const MAX_EVENTS_PER_DAY = 3

export default function MonthView({ events, month, year, onEventClick, onDayClick }: MonthViewProps) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const cells: (Date | null)[] = [
    ...Array(firstDay.getDay()).fill(null),
    ...Array.from({ length: lastDay.getDate() }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const eventsForDay = (d: Date) =>
    events.filter((ev) => isoDate(new Date(ev.start)) === isoDate(d))

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-[#1d2b46] shrink-0 bg-[#0a1120]">
        {HE_DAYS.map((d) => (
          <div key={d} className="text-center text-[11px] text-[#5a688c] font-medium py-2.5 uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells grid */}
      <div className="grid grid-cols-7 flex-1">
        {cells.map((day, i) => {
          const today = day ? isToday(day) : false
          const dayEvents = day ? eventsForDay(day) : []
          const overflow = dayEvents.length - MAX_EVENTS_PER_DAY

          return (
            <div
              key={i}
              onClick={() => day && onDayClick(day)}
              title={
                day
                  ? `${fmtFullDate(day.toISOString())} — ${dayEvents.length > 0 ? `${dayEvents.length} אירועים` : 'אין אירועים'}`
                  : undefined
              }
              className={`min-h-[60px] md:min-h-[100px] border-b border-l border-[#141f36] p-1 md:p-1.5 transition-colors
                ${!day
                  ? 'bg-[#060606]'
                  : today
                    ? 'bg-[#2dd4bf]/[0.025] hover:bg-[#2dd4bf]/[0.045] cursor-pointer'
                    : 'bg-[#0a1120] hover:bg-[#0c1424] cursor-pointer'
                }`}
            >
              {day && (
                <>
                  <div
                    className={`text-[13px] w-7 h-7 flex items-center justify-center rounded-full mb-1
                      transition-colors
                      ${today ? 'bg-[#2dd4bf] text-black font-bold' : 'text-[#647399] font-medium'}`}
                  >
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, MAX_EVENTS_PER_DAY).map((ev) => (
                      <EventPill key={ev.id} ev={ev} onClick={onEventClick} showTime />
                    ))}
                    {overflow > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDayClick(day)
                        }}
                        className="w-full text-[9px] text-[#4d659c] hover:text-[#8593b3] px-1.5 py-0.5
                          transition-colors cursor-pointer rounded hover:bg-[#141f36]
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/60"
                      >
                        +{overflow} נוספים
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
