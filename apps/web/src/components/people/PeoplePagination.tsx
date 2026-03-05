'use client'

import { ChevronRight, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function PeoplePagination({ page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between pt-4 pb-2 border-t border-[#1f1f1f]">
      <span className="text-xs text-[#666] tabular-nums">
        מציג {from}–{to} מתוך {total}
      </span>

      <div className="flex items-center gap-1">
        <button
          className={cn('icon-btn', page <= 1 && 'opacity-30 pointer-events-none')}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="עמוד הבא"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <span className="text-xs text-[#aaa] px-2 tabular-nums">
          {page} / {totalPages}
        </span>

        <button
          className={cn('icon-btn', page >= totalPages && 'opacity-30 pointer-events-none')}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="עמוד קודם"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
