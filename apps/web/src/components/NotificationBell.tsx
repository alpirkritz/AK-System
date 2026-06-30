'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'

export function NotificationBell() {
  const { data, refetch } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const count = data?.count ?? 0

  return (
    <Link
      href="/notifications"
      className="relative inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[#2a2a2a] bg-[#161616] text-[#e8c547] hover:bg-[#1f1f1f] transition-colors"
      aria-label={count > 0 ? `${count} התראות שלא נקראו` : 'התראות'}
      data-testid="notification-bell"
      onMouseEnter={() => refetch()}
    >
      <span className="text-lg leading-none" aria-hidden>
        🔔
      </span>
      {count > 0 && (
        <span
          className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center"
          data-testid="notification-badge"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
