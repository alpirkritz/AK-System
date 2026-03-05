'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'

const CATEGORY_LABELS: Record<string, string> = {
  economics: 'כלכלה',
  us_market: 'בורסה ארה"ב',
  ai_tech: 'טק ו-AI',
  israel_market: 'בורסה ישראלית',
}

const SVG_EXTERNAL_SMALL = (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 opacity-40">
    <path
      d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3m0 0v3m0-3L5 7"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const SVG_ARROW_LEFT = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function FeedWidget() {
  const { data: items, isLoading, isError } = trpc.feed.getLatest.useQuery(
    { limit: 5 },
    { staleTime: 5 * 60_000, retry: false },
  )
  const list = Array.isArray(items) ? items : []

  return (
    <section aria-label="עדכוני חדשות">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[#f0ede6]">עדכון כלכלה וחדשות</h2>
        <Link href="/updates" className="section-link">
          {SVG_ARROW_LEFT}
          כל העדכונים
        </Link>
      </div>

      <div className="card py-3 px-4">
        {isError ? (
          <div className="text-sm text-[#666] py-2">
            לא ניתן לטעון עדכונים. גש לדף העדכונים והרץ סנכרון.
          </div>
        ) : isLoading ? (
          <div className="text-sm text-[#555] py-2">טוען...</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-[#555] py-2">
            אין עדכונים. הרץ סנכרון מדף העדכונים.
          </div>
        ) : (
          <ul className="space-y-1">
            {list.map((item, i) => (
              <li key={item?.id ?? `feed-${i}`}>
                <a
                  href={item?.link ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-lg p-2.5 -mx-1 hover:bg-[#1a1a1a] transition-colors no-underline group"
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium text-[#f0ede6] overflow-hidden text-ellipsis"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {item?.title ?? ''}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{
                          background: '#e8c54722',
                          color: '#e8c547',
                          border: '1px solid #e8c54744',
                        }}
                      >
                        {CATEGORY_LABELS[item?.category ?? ''] ?? item?.category ?? ''}
                      </span>
                      <span className="text-[11px] text-[#555]">{item?.sourceName ?? ''}</span>
                      <span className="text-[11px] text-[#444]">
                        {item?.publishedAt ? fmtDate(item.publishedAt) : ''}
                      </span>
                    </div>
                  </div>
                  {SVG_EXTERNAL_SMALL}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
