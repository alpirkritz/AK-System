import type { CalEvent, RsvpStatus } from '../lib/types'
import { RSVP_DOT_COLOR, RSVP_LABEL } from '../lib/constants'
import { fmtTime } from '../lib/date-utils'
import { eventStyle } from '../lib/event-utils'

interface EventPillProps {
  ev: CalEvent
  onClick: (ev: CalEvent) => void
  showTime?: boolean
}

export default function EventPill({ ev, onClick, showTime = false }: EventPillProps) {
  const s = eventStyle(ev)
  const isDeclined = ev.rsvp === 'declined'

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick(ev)
      }}
      title={ev.title}
      className="w-full text-right text-[10px] px-1.5 py-[3px] rounded-[4px] truncate
        text-[#d4d4d4] transition-all duration-150 cursor-pointer
        hover:brightness-125 hover:text-white
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c547]/60
        active:scale-[0.97]"
      style={{
        background: s.bg,
        borderRight: `2px solid ${s.border}`,
        opacity: isDeclined ? 0.4 : 1,
      }}
    >
      {ev.rsvp && ev.rsvp !== 'accepted' && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle shrink-0"
          style={{ background: RSVP_DOT_COLOR[ev.rsvp] }}
          title={RSVP_LABEL[ev.rsvp]}
        />
      )}
      {showTime && !ev.isAllDay && (
        <span className="opacity-40 font-mono ml-1 text-[9px]">{fmtTime(ev.start)} </span>
      )}
      {ev.title}
    </button>
  )
}
