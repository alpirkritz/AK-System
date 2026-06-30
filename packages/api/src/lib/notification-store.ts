import { getDb, notifications, runMutation } from '@ak-system/database'

export type NotificationType = 'cron' | 'agent' | 'fomo' | 'hugo' | 'system'

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
      body: options.body,
      url: options.url,
      type: options.type,
      readAt: null,
      createdAt: new Date().toISOString(),
    }),
  )
  return id
}
