import type { CalEvent } from '../lib/types'
import { HE_DAYS, HOUR_HEIGHT, VISIBLE_HOURS } from '../lib/constants'
import { addDays, isoDate, isToday } from '../lib/date-utils'
import { useAutoScroll } from '../lib/hooks'
import TimeGutter from './TimeGutter'
import DayColumn from './DayColumn'
import AllDayStrip from './AllDayStrip'

interface WeekViewProps {
  events: CalEvent[]
  weekStart: Date
  onEventClick: (ev: CalEvent) => void
}

export default function WeekView({ events, weekStart, onEventClick }: WeekViewProps) {
  const scrollRef = useAutoScroll(weekStart)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const eventsForDay = (day: Date) =>
    events.filter((ev) => isoDate(new Date(ev.start)) === isoDate(day))

  return (
    <div className="flex flex-col h-full">
      {/* Day column headers */}
      <div className="flex border-b border-[#1a1a1a] bg-[#080808] shrink-0">
        <div className="w-14 shrink-0" />
        {days.map((day, i) => {
          const today = isToday(day)
          return (
            <div
              key={i}
              className={`flex-1 text-center py-2.5 px-1 border-r border-[#1a1a1a] first:border-r-0
                ${today ? 'bg-[#e8c547]/[0.03]' : ''}`}
            >
              <div className="text-[11px] text-[#555] font-medium uppercase tracking-wide">
                {HE_DAYS[day.getDay()]}
              </div>
              <div
                className={`text-lg font-semibold mt-0.5 w-8 h-8 mx-auto flex items-center
                  justify-center rounded-full transition-colors
                  ${today ? 'bg-[#e8c547] text-black' : 'text-[#999]'}`}
              >
                {day.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* All-day events */}
      <AllDayStrip days={days} events={events} onEventClick={onEventClick} />

      {/* Time grid with scroll */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} className="flex h-full overflow-y-auto">
          <TimeGutter />
          <div
            className="flex flex-1 min-w-0 border-r border-[#1a1a1a]"
            style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}
          >
            {days.map((day, di) => (
              <div key={di} className="flex-1 border-r border-[#1a1a1a] first:border-r-0">
                <DayColumn day={day} events={eventsForDay(day)} onEventClick={onEventClick} />
              </div>
            ))}
          </div>
        </div>
        {/* Fade at bottom signals scrollable content */}
        <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#080808] to-transparent pointer-events-none" />
      </div>
    </div>
  )
}
