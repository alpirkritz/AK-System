/**
 * Decisions shared by the service worker and the notifications page about what
 * belongs in the browser notification tray. Kept free of service-worker and DOM
 * globals so both callers — and tests — can use it.
 */

/** Grace period for notifications that may have arrived after the last fetch. */
export const TRAY_RECONCILE_GRACE_MS = 60_000

/**
 * A tag per notification. A shared tag makes each push replace the previous
 * one in the tray, so only the newest is ever visible.
 */
export function notificationTag(notificationId: string | undefined | null): string {
  return notificationId ? `ak-push-${notificationId}` : 'ak-push'
}

export interface TrayNotification {
  notificationId?: string
  /** Epoch ms the notification was shown, from `Notification.timestamp`. */
  timestamp: number
}

/**
 * Tray entries that no longer belong there: the row left the inbox — archived
 * or read, possibly on another device — and the entry is old enough that it
 * cannot have arrived after the inbox snapshot was taken.
 */
export function staleTrayNotificationIds(
  tray: TrayNotification[],
  inboxIds: Iterable<string>,
  now: number,
): string[] {
  const inbox = new Set(inboxIds)
  const stale = new Set<string>()

  for (const entry of tray) {
    const id = entry.notificationId
    if (!id) continue
    if (inbox.has(id)) continue
    if (now - entry.timestamp <= TRAY_RECONCILE_GRACE_MS) continue
    stale.add(id)
  }

  return [...stale]
}
