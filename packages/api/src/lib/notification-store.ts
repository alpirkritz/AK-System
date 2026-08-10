import { getDb, notifications, runMutation } from '@ak-system/database'

export type NotificationType = 'cron' | 'agent' | 'fomo' | 'hugo' | 'system'

/**
 * Upper bound on a stored body. Far above any real agent brief — this only exists
 * so a runaway response cannot bloat the row. Callers must pass the full text:
 * the short excerpt belongs in the OS push payload, not here.
 */
export const MAX_NOTIFICATION_BODY = 20000

/** Clamp without collapsing whitespace, so line breaks survive into the UI. */
export function clampNotificationBody(body: string, max = MAX_NOTIFICATION_BODY): string {
  if (body.length <= max) return body
  return body.slice(0, max - 1) + '…'
}

/** Persist an in-app notification row (shown in notification center). */
export async function createNotification(options: {
  title: string
  body: string
  url: string
  type: NotificationType
}): Promise<string> {
  const id = crypto.randomUUID()
  const db = getDb()
  await runMutation(
    db.insert(notifications).values({
      id,
      title: options.title,
      body: clampNotificationBody(options.body),
      url: options.url,
      type: options.type,
      readAt: null,
      createdAt: new Date().toISOString(),
    }),
  )
  return id
}
