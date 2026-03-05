import type { CalEvent } from '../lib/types'
import { DAY_START, HOUR_HEIGHT, VISIBLE_HOURS } from '../lib/constants'
import { isToday } from '../lib/date-utils'
import { layoutDayEvents } from '../lib/event-utils'
import EventCard from './EventCard'
import CurrentTimeIndicator from './CurrentTimeIndicator'

interface DayColumnProps {
  day: Date
  events: CalEvent[]
  onEventClick: (ev: CalEvent) => void
}

export default function DayColumn({ day, events, onEventClick }: DayColumnProps) {
  const hours = Array.from({ length: VISIBLE_HOURS }, (_, i) => DAY_START + i)
  const positioned = layoutDayEvents(events.filter((ev) => !ev.isAllDay))
  const today = isToday(day)

  return (
    <div
      className={`relative flex-1 ${today ? 'bg-[#e8c547]/[0.015]' : ''}`}
      style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}
    >
      {/* Hour grid lines */}
      {hours.map((h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-[#141414]"
          style={{ top: (h - DAY_START) * HOUR_HEIGHT }}
        />
      ))}

      {/* Half-hour faint lines for better time scanning */}
      {hours.map((h) => (
        <div
          key={`half-${h}`}
          className="absolute inset-x-0 border-t border-[#0e0e0e]"
          style={{ top: (h - DAY_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
        />
      ))}

      {/* Current time indicator */}
      {today && <CurrentTimeIndicator />}

      {/* Event cards */}
      {positioned.map(({ ev, col, totalCols }) => (
        <EventCard
          key={ev.id}
          ev={ev}
          col={col}
          totalCols={totalCols}
          onClick={onEventClick}
        />
      ))}
    </div>
  )
}
