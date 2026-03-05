import { DAY_START, HOUR_HEIGHT, VISIBLE_HOURS } from '../lib/constants'
import { useCurrentTime } from '../lib/hooks'

export default function CurrentTimeIndicator() {
  const now = useCurrentTime()
  const top = ((now.getHours() * 60 + now.getMinutes() - DAY_START * 60) / 60) * HOUR_HEIGHT

  if (top < 0 || top > VISIBLE_HOURS * HOUR_HEIGHT) return null

  return (
    <div
      className="absolute inset-x-0 z-10 flex items-center pointer-events-none"
      style={{ top }}
      aria-hidden="true"
    >
      <div
        className="w-2.5 h-2.5 rounded-full bg-red-500 -mr-[5px] shrink-0 relative z-10"
        style={{ boxShadow: '0 0 6px rgba(239,68,68,0.6)' }}
      />
      <div className="flex-1 h-[1.5px] bg-red-500/75" />
    </div>
  )
}
