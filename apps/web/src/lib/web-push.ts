import { getDb, pushSubscriptions, eq } from '@ak-system/database'
import webPush from 'web-push'

let vapidConfigured = false

function ensureVapid(): boolean {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) return false
  if (!vapidConfigured) {
    webPush.setVapidDetails(
      process.env.VAPID_EMAIL ?? 'mailto:admin@example.com',
      vapidPublic,
      vapidPrivate,
    )
    vapidConfigured = true
  }
  return true
}

export function isWebPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

/**
 * Send a Web Push notification to every registered device.
 * Stale subscriptions (rejected by the push service) are pruned automatically.
 * Returns the number of devices successfully notified.
 */
export async function sendBrowserPush(
  title: string,
  body: string,
  url = '/chat',
): Promise<number> {
  if (!ensureVapid()) return 0

  const db = getDb()
  const subs = await db.select().from(pushSubscriptions).all()
  if (subs.length === 0) return 0

  const payload = JSON.stringify({
    title,
    body,
    url,
    icon: '/icons/icon-192.png',
  })

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      ),
    ),
  )

  const failed = results
    .map((r, i) => (r.status === 'rejected' ? i : null))
    .filter((i): i is number => i !== null)

  for (const i of failed) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, subs[i]!.endpoint)).run()
  }

  return subs.length - failed.length
}
