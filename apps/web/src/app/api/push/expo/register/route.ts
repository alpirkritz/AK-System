import { type NextRequest, NextResponse } from 'next/server'
import { getDb, expoPushTokens, eq } from '@ak-system/database'
import { sessionFromBearer } from '@/lib/mobile-auth'

async function requireMobileSession(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth) return null
  return sessionFromBearer(auth)
}

/** POST /api/push/expo/register — Helm app Expo push token */
export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const token = body.token?.trim()
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  const db = getDb()
  const existing = await db.select().from(expoPushTokens).where(eq(expoPushTokens.token, token)).get()
  if (existing) {
    return NextResponse.json({ id: existing.id })
  }

  const id = crypto.randomUUID()
  await db
    .insert(expoPushTokens)
    .values({ id, token, createdAt: new Date().toISOString() })
    .run()

  return NextResponse.json({ id })
}

/** DELETE /api/push/expo/register — remove Expo token on sign-out */
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
    await db.delete(expoPushTokens).where(eq(expoPushTokens.token, body.token)).run()
  }

  return NextResponse.json({ ok: true })
}
