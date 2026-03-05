import { VISIBLE_HOURS, HOUR_HEIGHT, DAY_START } from '../lib/constants'

export default function SkeletonGrid() {
  const hours = Array.from({ length: VISIBLE_HOURS }, (_, i) => DAY_START + i)

  return (
    <div className="flex flex-1 animate-pulse overflow-hidden">
      {/* Time gutter skeleton */}
      <div className="w-14 shrink-0 relative" style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}>
        {hours.map((h) => (
          <div
            key={h}
            className="absolute right-0 pr-2"
            style={{ top: (h - DAY_START) * HOUR_HEIGHT - 6 }}
          >
            <div className="w-8 h-3 bg-[#141414] rounded" />
          </div>
        ))}
      </div>
      {/* Columns skeleton */}
      <div className="flex flex-1 border-r border-[#141414]">
        {Array.from({ length: 7 }).map((_, ci) => (
          <div
            key={ci}
            className="flex-1 border-r border-[#141414] relative"
            style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}
          >
            {hours.map((h) => (
              <div
                key={h}
                className="absolute inset-x-0 border-t border-[#0e0e0e]"
                style={{ top: (h - DAY_START) * HOUR_HEIGHT }}
              />
            ))}
            {/* Fake event blocks */}
            {ci % 2 === 0 && (
              <div
                className="absolute right-1 left-1 rounded-md bg-[#141414]"
                style={{ top: 3 * HOUR_HEIGHT + 10, height: HOUR_HEIGHT * 0.8 }}
              />
            )}
            {ci % 3 === 1 && (
              <div
                className="absolute right-1 left-1 rounded-md bg-[#121212]"
                style={{ top: 5 * HOUR_HEIGHT + 4, height: HOUR_HEIGHT * 1.2 }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
