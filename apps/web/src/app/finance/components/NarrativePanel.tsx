'use client'

/**
 * The last saved Gemini paragraph over the deterministic engines.
 *
 * Opening the tab only reads what was already stored. Gemini runs when the user
 * presses the button. A failure to refresh leaves the previous text on screen.
 */

export interface NarrativeData {
  available: boolean
  headline: string | null
  body: string | null
  connections: string[]
  watchlist: string[]
  generatedAt: string | null
  cached: boolean
  stale: boolean
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function NarrativePanel({
  data,
  isLoading,
  isError,
  onGenerate,
  onRetry,
  isRefreshing = false,
  refreshError = false,
}: {
  data: NarrativeData | null
  isLoading: boolean
  isError: boolean
  onGenerate: () => void
  onRetry: () => void
  isRefreshing?: boolean
  refreshError?: boolean
}) {
  if (isLoading && !data) {
    return (
      <div className="card mb-5">
        <div className="skeleton h-4 w-2/3 rounded mb-3" />
        <div className="skeleton h-3 w-full rounded mb-2" />
        <div className="skeleton h-3 w-5/6 rounded" />
      </div>
    )
  }

  if (isError && !data?.available) {
    return (
      <div className="card mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[#97a4c2]">
          לא הצלחתי לטעון את הניתוח השמור. המספרים למטה מחושבים ללא תלות בזה.
        </span>
        <button className="btn btn-ghost text-xs" onClick={onRetry} disabled={isRefreshing}>
          נסה שוב
        </button>
      </div>
    )
  }

  if (!data?.available) {
    return (
      <div className="card mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[#97a4c2]">
          {refreshError ? 'לא הצלחתי לעדכן את הניתוח' : 'אין עדיין ניתוח שמור'}
        </span>
        <button className="btn btn-ghost text-xs" onClick={onGenerate} disabled={isRefreshing}>
          {isRefreshing ? 'מעדכן…' : 'צור ניתוח'}
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
          onClick={onGenerate}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'מעדכן…' : 'עדכן ניתוח'}
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
        {data.generatedAt ? `עודכן ${formatGeneratedAt(data.generatedAt)}` : 'עודכן'}
        {data.stale ? ' · הנתונים השתנו מאז הניתוח' : ''}
      </p>
      {refreshError && (
        <p className="text-[11px] text-[#fb7185] mt-2">לא הצלחתי לעדכן את הניתוח</p>
      )}
    </div>
  )
}
