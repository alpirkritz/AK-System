import type { CalEvent, RsvpStatus } from '../lib/types'
import { RSVP_DOT_COLOR, RSVP_LABEL } from '../lib/constants'
import { eventTop, eventHeight, fmtTime } from '../lib/date-utils'
import { eventStyle } from '../lib/event-utils'

function RsvpDot({ rsvp }: { rsvp: RsvpStatus }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0 ml-1"
      style={{ background: RSVP_DOT_COLOR[rsvp] }}
      title={RSVP_LABEL[rsvp]}
    />
  )
}

interface EventCardProps {
  ev: CalEvent
  col: number
  totalCols: number
  onClick: (ev: CalEvent) => void
}

export default function EventCard({ ev, col, totalCols, onClick }: EventCardProps) {
  const top = eventTop(ev.start)
  const height = eventHeight(ev.start, ev.end)
  const s = eventStyle(ev)
  const isShort = height < 44
  const isCancelled = ev.status === 'cancelled'
  const isDeclined = ev.rsvp === 'declined'
  const isTentative = ev.rsvp === 'tentative'
  const colW = 100 / totalCols
  const left = `${col * colW}%`
  const width = `calc(${colW}% - 3px)`

  return (
    <button
      onClick={() => onClick(ev)}
      title={`${ev.title}${ev.isAllDay ? '' : ` · ${fmtTime(ev.start)}`}`}
      className="absolute rounded-md overflow-hidden cursor-pointer text-right
        transition-all duration-150 ease-out
        hover:z-20 hover:shadow-lg hover:shadow-black/30
        focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#080808]
        group"
      style={{
        top,
        left,
        width,
        height: Math.max(height, 24),
        background: isTentative
          ? `repeating-linear-gradient(45deg,${s.bg},${s.bg} 4px,transparent 4px,transparent 8px)`
          : s.bg,
        borderRight: `2.5px solid ${s.border}`,
        opacity: isCancelled || isDeclined ? 0.35 : 1,
        zIndex: 5,
      }}
    >
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        style={{ background: s.border + '18' }}
      />
      <div className="relative px-2 py-1 overflow-hidden h-full">
        <div
          className={`font-medium leading-tight truncate text-[#e8e8e8]
            ${isShort ? 'text-[9px]' : 'text-[11px]'}
            ${isCancelled || isDeclined ? 'line-through' : ''}`}
        >
          {ev.rsvp && ev.rsvp !== 'accepted' && <RsvpDot rsvp={ev.rsvp} />}
          {ev.title}
        </div>
        {!isShort && (
          <div className="text-[10px] text-white/40 font-mono truncate mt-0.5">
            {fmtTime(ev.start)}
          </div>
        )}
      </div>
    </button>
  )
}
