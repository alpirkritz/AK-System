import { getDb, expoPushTokens, eq } from '@ak-system/database'

type ExpoPushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, string>
  sound?: 'default' | null
}

type ExpoPushTicket = {
  status: 'ok' | 'error'
  details?: { error?: string }
}

/** Send push notifications to all registered Expo devices (Helm mobile app). */
export async function sendExpoPush(
  title: string,
  body: string,
  url = '/chat',
): Promise<number> {
  const db = getDb()
  const rows = await db.select().from(expoPushTokens).all()
  if (rows.length === 0) return 0

  const messages: ExpoPushMessage[] = rows.map((row) => ({
    to: row.token,
    title,
    body: body.slice(0, 240),
    data: { url },
    sound: 'default',
  }))

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  }
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
  }

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    })
    if (!res.ok) {
      console.warn('[expo-push] API error:', res.status, await res.text())
      return 0
    }

    const payload = (await res.json()) as { data?: ExpoPushTicket[] }
    const tickets = payload.data ?? []
    let sent = 0

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i]
      const token = rows[i]?.token
      if (ticket?.status === 'ok') {
        sent++
      } else if (
        token &&
        (ticket?.details?.error === 'DeviceNotRegistered' ||
          ticket?.details?.error === 'InvalidCredentials')
      ) {
        await db.delete(expoPushTokens).where(eq(expoPushTokens.token, token)).run()
      }
    }

    return sent
  } catch (err) {
    console.warn('[expo-push] send failed:', err)
    return 0
  }
}
