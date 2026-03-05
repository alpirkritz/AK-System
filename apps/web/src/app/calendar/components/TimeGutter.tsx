import { DAY_START, HOUR_HEIGHT, VISIBLE_HOURS } from '../lib/constants'

export default function TimeGutter() {
  const hours = Array.from({ length: VISIBLE_HOURS }, (_, i) => DAY_START + i)

  return (
    <div
      className="w-14 shrink-0 relative select-none"
      style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}
    >
      {hours.map((h) => (
        <div
          key={h}
          className="absolute right-0 text-[10px] text-[#3a3a3a] pr-2 leading-none"
          style={{ top: (h - DAY_START) * HOUR_HEIGHT - 6 }}
        >
          {String(h).padStart(2, '0')}:00
        </div>
      ))}
    </div>
  )
}
