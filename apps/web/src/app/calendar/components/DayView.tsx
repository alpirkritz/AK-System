import type { CalEvent } from '../lib/types'
import { HE_DAYS, HE_MONTHS, HOUR_HEIGHT, VISIBLE_HOURS } from '../lib/constants'
import { isToday, isoDate } from '../lib/date-utils'
import { useAutoScroll } from '../lib/hooks'
import TimeGutter from './TimeGutter'
import DayColumn from './DayColumn'
import AllDayStrip from './AllDayStrip'

interface DayViewProps {
  events: CalEvent[]
  day: Date
  onEventClick: (ev: CalEvent) => void
}

export default function DayView({ events, day, onEventClick }: DayViewProps) {
  const scrollRef = useAutoScroll(day)
  const today = isToday(day)

  const dayIso = isoDate(day)
  const dayEvents = events.filter(
    (ev) => isoDate(new Date(ev.start)) === dayIso,
  )
  const timedEvents = dayEvents.filter((ev) => !ev.isAllDay)
  const allDayEvents = dayEvents.filter((ev) => ev.isAllDay)

  return (
    <div className="flex flex-col h-full">
      {/* Day header */}
      <div className="flex border-b border-[#1a1a1a] bg-[#080808] shrink-0">
        <div className="w-14 shrink-0" />
        <div className={`flex-1 text-center py-3 border-r border-[#1a1a1a]
          ${today ? 'bg-[#e8c547]/[0.03]' : ''}`}
        >
          <div className="text-[11px] text-[#555] font-medium uppercase tracking-wide">
            {HE_DAYS[day.getDay()]}
          </div>
          <div
            className={`text-2xl font-bold mt-0.5 w-10 h-10 mx-auto flex items-center
              justify-center rounded-full transition-colors
              ${today ? 'bg-[#e8c547] text-black' : 'text-[#999]'}`}
          >
            {day.getDate()}
          </div>
          <div className="text-[11px] text-[#555] mt-0.5">
            {HE_MONTHS[day.getMonth()]} {day.getFullYear()}
          </div>
        </div>
      </div>

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <AllDayStrip days={[day]} events={events} onEventClick={onEventClick} />
      )}

      {/* Time grid */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} className="flex h-full overflow-y-auto">
          <TimeGutter />
          <div
            className="flex-1 border-r border-[#1a1a1a]"
            style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}
          >
            <DayColumn day={day} events={timedEvents} onEventClick={onEventClick} />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#080808] to-transparent pointer-events-none" />
      </div>
    </div>
  )
}
