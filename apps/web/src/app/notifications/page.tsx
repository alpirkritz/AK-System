'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseNotificationBody } from '@/lib/notification-format'
import { isNavigableNotificationUrl, notificationPreview } from '@/lib/notification-url'
import { trpc } from '@/lib/trpc'

const TYPE_ICONS: Record<string, string> = {
  cron: '⏰',
  agent: '🤖',
  fomo: '🔔',
  hugo: '💬',
  system: '✓',
}

const SWIPE_THRESHOLD = 72

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

type NotificationRow = {
  id: string
  title: string
  body: string
  url: string
  type: string
  readAt: string | null
  archivedAt?: string | null
  createdAt: string
}

function SwipeableRow({
  item,
  onOpen,
  onArchive,
  onMarkRead,
}: {
  item: NotificationRow
  onOpen: () => void
  onArchive: () => void
  onMarkRead: () => void
}) {
  const [offset, setOffset] = useState(0)
  const startX = useRef<number | null>(null)
  const dxRef = useRef(0)
  const dragging = useRef(false)

  const reset = () => {
    dxRef.current = 0
    setOffset(0)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button[data-action]')) {
      startX.current = null
      return
    }
    startX.current = e.clientX
    dxRef.current = 0
    dragging.current = false
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current == null) return
    const dx = e.clientX - startX.current
    dxRef.current = dx
    if (Math.abs(dx) > 8) dragging.current = true
    setOffset(Math.max(-120, Math.min(120, dx)))
  }

  const onPointerUp = () => {
    if (startX.current == null) return
    const dx = dxRef.current
    startX.current = null
    if (dx <= -SWIPE_THRESHOLD) {
      reset()
      onArchive()
      return
    }
    if (dx >= SWIPE_THRESHOLD) {
      reset()
      onMarkRead()
      return
    }
    reset()
  }

  const onOpenClick = () => {
    if (dragging.current) {
      dragging.current = false
      return
    }
    onOpen()
  }

  return (
    <div className="relative overflow-hidden rounded-xl" data-testid="notification-swipe-row">
      <div
        className="absolute inset-0 flex items-stretch pointer-events-none select-none"
        aria-hidden
      >
        <div className="flex-1 flex items-center justify-start px-4 bg-[#2dd4bf]/25 text-[#2dd4bf] text-sm font-medium">
          סמן כנקרא
        </div>
        <div className="flex-1 flex items-center justify-end px-4 bg-[#c45c5c]/30 text-[#f0a0a0] text-sm font-medium">
          ארכיון
        </div>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          startX.current = null
          reset()
        }}
        style={{ transform: `translateX(${offset}px)` }}
        className={`card relative w-full text-right p-4 transition-colors hover:border-[#435a8c] touch-pan-y ${
          item.readAt ? 'opacity-60' : 'border-[#2dd4bf]/30'
        }`}
        data-testid="notification-item"
      >
        <button
          type="button"
          onClick={onOpenClick}
          className="w-full text-right"
          aria-label={`פתח התראה: ${item.title}`}
        >
          <div className="flex items-start gap-3 flex-row-reverse">
            <span className="text-xl shrink-0">{TYPE_ICONS[item.type] ?? '🔔'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[#dde5f4] truncate">{item.title}</span>
                <span className="text-[11px] text-[#647399] shrink-0">
                  {formatRelative(item.createdAt)}
                </span>
              </div>
              <p className="text-sm text-[#7a89ab] mt-1 line-clamp-2">
                {notificationPreview(item.body)}
              </p>
            </div>
            {!item.readAt && (
              <span className="w-2 h-2 rounded-full bg-[#2dd4bf] shrink-0 mt-2" />
            )}
          </div>
        </button>
        <div className="hidden sm:flex gap-2 mt-3 justify-start flex-row-reverse">
          <button
            type="button"
            data-action="mark-read"
            className="btn btn-ghost text-[11px] py-1 px-2 min-h-[44px]"
            data-testid="notification-mark-read-btn"
            onClick={onMarkRead}
          >
            סמן כנקרא
          </button>
          <button
            type="button"
            data-action="archive"
            className="btn btn-ghost text-[11px] py-1 px-2 min-h-[44px] text-[#f0a0a0]"
            data-testid="notification-archive-btn"
            onClick={onArchive}
          >
            ארכיון
          </button>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data: items = [], isLoading } = trpc.notifications.list.useQuery({ limit: 50 })
  const [selected, setSelected] = useState<NotificationRow | null>(null)
  const [undoId, setUndoId] = useState<string | null>(null)
  const [bulkUndo, setBulkUndo] = useState<{ batchAt: string; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bulkUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const invalidate = useCallback(() => {
    void utils.notifications.list.invalidate()
    void utils.notifications.unreadCount.invalidate()
  }, [utils])

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: invalidate,
    onError: () => setError('לא ניתן לעדכן את ההתראה. נסה שוב.'),
  })
  const archiveMut = trpc.notifications.archive.useMutation({
    onSuccess: invalidate,
    onError: () => setError('לא ניתן לעדכן את ההתראה. נסה שוב.'),
  })
  const archiveAllMut = trpc.notifications.archiveAll.useMutation({
    onSuccess: invalidate,
    onError: () => setError('לא ניתן לעדכן את ההתראה. נסה שוב.'),
  })

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
      if (bulkUndoTimer.current) clearTimeout(bulkUndoTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  async function openItem(item: NotificationRow) {
    setError(null)
    setSelected(item)
    if (!item.readAt) {
      try {
        await markRead.mutateAsync({ id: item.id })
      } catch {
        // detail still opens
      }
    }
  }

  async function markAllRead() {
    setError(null)
    await markRead.mutateAsync({ all: true })
  }

  async function handleMarkRead(item: NotificationRow) {
    setError(null)
    if (item.readAt) return
    await markRead.mutateAsync({ id: item.id })
  }

  async function handleArchive(item: NotificationRow) {
    setError(null)
    if (selected?.id === item.id) setSelected(null)
    await archiveMut.mutateAsync({ id: item.id })
    setUndoId(item.id)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndoId(null), 4000)
  }

  async function handleUndo() {
    if (!undoId) return
    const id = undoId
    setUndoId(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    await archiveMut.mutateAsync({ id, undo: true })
  }

  async function handleArchiveAll() {
    setError(null)
    const count = items.length
    if (count === 0) return
    const res = await archiveAllMut.mutateAsync({})
    if (!res.batchAt) return
    setBulkUndo({ batchAt: res.batchAt, count: res.updated })
    if (bulkUndoTimer.current) clearTimeout(bulkUndoTimer.current)
    bulkUndoTimer.current = setTimeout(() => setBulkUndo(null), 4000)
  }

  async function handleBulkUndo() {
    if (!bulkUndo) return
    const { batchAt } = bulkUndo
    setBulkUndo(null)
    if (bulkUndoTimer.current) clearTimeout(bulkUndoTimer.current)
    await archiveAllMut.mutateAsync({ undo: true, batchAt })
  }

  const unread = items.filter((n) => !n.readAt).length

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">התראות</h1>
        <div className="flex items-center gap-2">
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
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => handleArchiveAll()}
              className="btn btn-ghost text-[12px] py-1.5 px-3 text-[#f0a0a0]"
              data-testid="archive-all"
            >
              העבר הכל לארכיון
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 text-center" role="alert">
          {error}
        </p>
      )}

      {isLoading && (
        <p className="text-sm text-[#647399] text-center py-8">טוען...</p>
      )}

      {!isLoading && items.length === 0 && (
        <div className="card p-8 text-center text-[#647399]" data-testid="notifications-empty">
          <p className="text-3xl mb-2">🔔</p>
          <p>אין התראות כרגע</p>
          <p className="text-xs mt-2">כשתגיע התראה חדשה — היא תופיע כאן</p>
        </div>
      )}

      <ul className="space-y-2" data-testid="notifications-list">
        {items.map((item) => (
          <li key={item.id}>
            <SwipeableRow
              item={item}
              onOpen={() => openItem(item)}
              onArchive={() => handleArchive(item)}
              onMarkRead={() => handleMarkRead(item)}
            />
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-[#5a688c] pt-4">
        <Link href="/settings/notifications" className="text-[#2dd4bf] hover:underline">
          הגדרות נוטיפיקציות
        </Link>
      </p>

      {selected && (
        <div
          className="overlay"
          onClick={() => setSelected(null)}
          data-testid="notification-detail-overlay"
        >
          <div
            className="modal max-w-lg flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-detail-title"
            onClick={(e) => e.stopPropagation()}
            data-testid="notification-detail"
          >
            <div className="flex items-start justify-between gap-3 mb-3 shrink-0">
              <h2
                id="notification-detail-title"
                className="text-lg font-semibold text-[#dde5f4]"
              >
                {selected.title}
              </h2>
              <button
                type="button"
                className="btn btn-ghost text-sm py-2 px-3 min-h-[44px]"
                aria-label="סגור"
                onClick={() => setSelected(null)}
                data-testid="notification-detail-close"
              >
                סגור
              </button>
            </div>
            <p className="text-xs text-[#647399] mb-3 shrink-0">
              {TYPE_ICONS[selected.type] ?? '🔔'} · {formatRelative(selected.createdAt)}
            </p>
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
              data-testid="notification-detail-body"
              tabIndex={0}
            >
              <div className="text-sm text-[#c5d0e6] leading-relaxed space-y-2">
                {parseNotificationBody(selected.body).map((block, i) => {
                  if (block.kind === 'heading') {
                    return (
                      <h3
                        key={i}
                        className={`font-semibold text-[#eef3fb] ${
                          block.level === 1 ? 'text-base pt-1' : 'text-sm pt-2'
                        }`}
                      >
                        {block.text}
                      </h3>
                    )
                  }
                  if (block.kind === 'bullet') {
                    return (
                      <div key={i} className="flex gap-2">
                        <span className="text-[#2dd4bf] shrink-0">•</span>
                        <span>{block.text}</span>
                      </div>
                    )
                  }
                  if (block.kind === 'numbered') {
                    return (
                      <div key={i} className="flex gap-2">
                        <span className="text-[#647399] shrink-0">{block.marker}.</span>
                        <span>{block.text}</span>
                      </div>
                    )
                  }
                  return <p key={i}>{block.text}</p>
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-6 justify-start flex-row-reverse shrink-0">
              {isNavigableNotificationUrl(selected.url) && (
                <button
                  type="button"
                  className="btn btn-primary min-h-[44px]"
                  data-testid="notification-goto-target"
                  onClick={() => {
                    const url = selected.url
                    setSelected(null)
                    router.push(url)
                  }}
                >
                  עבור ליעד
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost min-h-[44px] text-[#f0a0a0]"
                onClick={() => handleArchive(selected)}
              >
                ארכיון
              </button>
            </div>
          </div>
        </div>
      )}

      {undoId && (
        <div className="toast" role="status" data-testid="notification-undo-toast">
          הועבר לארכיון ·{' '}
          <button type="button" className="underline text-[#2dd4bf]" onClick={handleUndo}>
            בטל
          </button>
        </div>
      )}

      {bulkUndo && (
        <div className="toast" role="status" data-testid="notification-archive-all-undo-toast">
          {bulkUndo.count} הודעות הועברו לארכיון ·{' '}
          <button type="button" className="underline text-[#2dd4bf]" onClick={handleBulkUndo}>
            בטל
          </button>
        </div>
      )}
    </div>
  )
}
