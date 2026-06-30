'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc'

const TYPE_ICONS: Record<string, string> = {
  cron: '⏰',
  agent: '🤖',
  fomo: '🔔',
  hugo: '💬',
  system: '✓',
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  const days = Math.floor(hours / 24)
  return `לפני ${days} ימים`
}

export default function NotificationsPage() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data: items = [], isLoading } = trpc.notifications.list.useQuery({ limit: 50 })
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate()
      void utils.notifications.unreadCount.invalidate()
    },
  })

  async function openItem(id: string, url: string, readAt: string | null) {
    if (!readAt) {
      await markRead.mutateAsync({ id })
    }
    router.push(url)
  }

  async function markAllRead() {
    await markRead.mutateAsync({ all: true })
  }

  const unread = items.filter((n) => !n.readAt).length

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">התראות</h1>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => markAllRead()}
            className="btn btn-ghost text-[12px] py-1.5 px-3"
            data-testid="mark-all-read"
          >
            סמן הכל כנקרא
          </button>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-[#666] text-center py-8">טוען...</p>
      )}

      {!isLoading && items.length === 0 && (
        <div className="card p-8 text-center text-[#666]" data-testid="notifications-empty">
          <p className="text-3xl mb-2">🔔</p>
          <p>אין התראות עדיין</p>
        </div>
      )}

      <ul className="space-y-2" data-testid="notifications-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => openItem(item.id, item.url, item.readAt)}
              className={`card w-full text-right p-4 transition-colors hover:border-[#3a3a3a] ${
                item.readAt ? 'opacity-60' : 'border-[#e8c547]/30'
              }`}
              data-testid="notification-item"
            >
              <div className="flex items-start gap-3 flex-row-reverse">
                <span className="text-xl shrink-0">{TYPE_ICONS[item.type] ?? '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[#e8e8e8] truncate">{item.title}</span>
                    <span className="text-[11px] text-[#666] shrink-0">
                      {formatRelative(item.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-[#888] mt-1 line-clamp-2">{item.body}</p>
                </div>
                {!item.readAt && (
                  <span className="w-2 h-2 rounded-full bg-[#e8c547] shrink-0 mt-2" />
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-[#555] pt-4">
        <Link href="/settings" className="text-[#e8c547] hover:underline">
          הגדרות נוטיפיקציות
        </Link>
      </p>
    </div>
  )
}
