'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'

const CATEGORY_LABELS: Record<string, string> = {
  economics: 'כלכלה',
  us_market: 'בורסה ארה"ב',
  ai_tech: 'טק ו-AI',
  israel_market: 'בורסה ישראלית',
}

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
    { staleTime: 5 * 60_000, retry: false }
  )
  const list = Array.isArray(items) ? items : []

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#e8c547]">עדכון כלכלה וחדשות</h2>
        <Link
          href="/updates"
          className="text-xs font-medium text-[#888] hover:text-[#e8c547] transition-colors no-underline"
        >
          לכל העדכונים →
        </Link>
      </div>
      {isError ? (
        <div className="text-sm text-[#888] py-2">לא ניתן לטעון עדכונים. גש לדף העדכונים והרץ סנכרון.</div>
      ) : isLoading ? (
        <div className="text-sm text-[#555] py-2">טוען...</div>
      ) : list.length === 0 ? (
        <div className="text-sm text-[#555] py-2">
          אין עדכונים. הרץ סנכרון מדף העדכונים.
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((item, i) => (
            <li key={item?.id ?? `feed-${i}`}>
              <a
                href={item?.link ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg p-2 -mx-2 hover:bg-[#1a1a1a] transition-colors no-underline"
              >
                <div className="text-sm font-medium text-[#f0ede6] overflow-hidden text-ellipsis" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {item?.title ?? ''}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: '#e8c54722',
                      color: '#e8c547',
                      border: '1px solid #e8c54744',
                    }}
                  >
                    {CATEGORY_LABELS[item?.category ?? ''] ?? item?.category ?? ''}
                  </span>
                  <span className="text-[11px] text-[#555]">{item?.sourceName ?? ''}</span>
                  <span className="text-[11px] text-[#444]">{item?.publishedAt ? fmtDate(item.publishedAt) : ''}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
