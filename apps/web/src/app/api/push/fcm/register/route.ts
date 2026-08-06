import { type NextRequest, NextResponse } from 'next/server'
import { getDb, fcmPushTokens, eq } from '@ak-system/database'
import { sessionFromBearer } from '@/lib/mobile-auth'

async function requireMobileSession(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth) return null
  return sessionFromBearer(auth)
}

/** POST /api/push/fcm/register — ARO app FCM device token */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireMobileSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { token?: string; platform?: string }
  try {
    body = (await request.json()) as { token?: string; platform?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token = body.token?.trim()
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }
  if (body.platform !== 'android') {
    return NextResponse.json({ error: 'platform must be android' }, { status: 400 })
  }

  const db = getDb()
  const now = new Date().toISOString()
  const existing = await db.select().from(fcmPushTokens).where(eq(fcmPushTokens.token, token)).get()
  if (existing) {
    await db
      .update(fcmPushTokens)
      .set({ updatedAt: now, platform: 'android' })
      .where(eq(fcmPushTokens.id, existing.id))
      .run()
    return NextResponse.json({ id: existing.id })
  }

  const id = crypto.randomUUID()
  await db
    .insert(fcmPushTokens)
    .values({
      id,
      token,
      platform: 'android',
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return NextResponse.json({ id })
}

/** DELETE /api/push/fcm/register — remove FCM token on sign-out */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await requireMobileSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { token?: string }
  try {
    body = (await request.json()) as { token?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.token) {
    const db = getDb()
    await db.delete(fcmPushTokens).where(eq(fcmPushTokens.token, body.token)).run()
  }

  return NextResponse.json({ ok: true })
}
