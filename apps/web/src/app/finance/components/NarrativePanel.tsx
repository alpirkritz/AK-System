'use client'

/**
 * The LLM paragraph over the deterministic engines.
 *
 * Kept visually distinct from the insight cards and given its own loading/error state: when
 * Gemini is unavailable the numbers below are still correct, so this panel fails quietly
 * instead of taking the tab down with it.
 */

export interface NarrativeData {
  headline: string
  body: string
  connections: string[]
  watchlist: string[]
  generatedAt: string
  cached: boolean
}

export function NarrativePanel({
  data,
  isLoading,
  isError,
  onRetry,
  isRefreshing = false,
}: {
  data: NarrativeData | null
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  isRefreshing?: boolean
}) {
  if (isLoading) {
    return (
      <div className="card mb-5">
        <div className="skeleton h-4 w-2/3 rounded mb-3" />
        <div className="skeleton h-3 w-full rounded mb-2" />
        <div className="skeleton h-3 w-5/6 rounded" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="card mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[#97a4c2]">
          לא הצלחתי לנסח את התמונה הכוללת כרגע. התובנות והמספרים למטה מחושבים ללא תלות בזה.
        </span>
        <button className="btn btn-ghost text-xs" onClick={onRetry} disabled={isRefreshing}>
          {isRefreshing ? 'מנסה שוב…' : 'נסה שוב'}
        </button>
      </div>
    )
  }

  return (
    <div
      className="card mb-5"
      style={{ borderInlineStartWidth: 3, borderInlineStartColor: '#a78bfa' }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-[#eef3fb] leading-snug">{data.headline}</h3>
        <button
          className="btn btn-ghost text-[11px] shrink-0"
          onClick={onRetry}
          disabled={isRefreshing}
          aria-label="רענן ניתוח"
        >
          {isRefreshing ? 'מרענן…' : 'רענן'}
        </button>
      </div>

      <p className="text-xs text-[#97a4c2] mt-2 leading-relaxed whitespace-pre-line">{data.body}</p>

      {data.connections.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.connections.map((c) => (
            <li key={c} className="text-xs text-[#c3cde2] flex gap-2">
              <span className="text-[#a78bfa]" aria-hidden>
                ↔
              </span>
              <span className="leading-relaxed">{c}</span>
            </li>
          ))}
        </ul>
      )}

      {data.watchlist.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#647399]">לעקוב:</span>
          {data.watchlist.map((w) => (
            <span key={w} className="pill text-[11px]" style={{ color: '#97a4c2' }}>
              {w}
            </span>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[#647399] mt-3">
        נוסח על בסיס המספרים המחושבים בלבד{data.cached ? ' · מתוך מטמון' : ''}
      </p>
    </div>
  )
}
