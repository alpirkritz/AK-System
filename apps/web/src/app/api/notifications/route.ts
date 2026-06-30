import { type NextRequest, NextResponse } from 'next/server'
import {
  getDb,
  notifications,
  eq,
  desc,
  isNull,
  runMutation,
} from '@ak-system/database'
import { sessionFromBearer } from '@/lib/mobile-auth'

async function requireMobileSession(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth) return null
  return sessionFromBearer(auth)
}

/** GET /api/notifications — list notifications for Helm app */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireMobileSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 50), 100)
  const db = getDb()
  const rows = await db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)

  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(isNull(notifications.readAt))

  return NextResponse.json({ notifications: rows, unreadCount: unread.length })
}

/** PATCH /api/notifications — mark read */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await requireMobileSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; all?: boolean }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb()
  const now = new Date().toISOString()
  let updated = 0

  if (body.all) {
    const unread = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(isNull(notifications.readAt))
    for (const row of unread) {
      await runMutation(
        db.update(notifications).set({ readAt: now }).where(eq(notifications.id, row.id)),
      )
    }
    updated = unread.length
  } else if (body.id) {
    await runMutation(
      db.update(notifications).set({ readAt: now }).where(eq(notifications.id, body.id)),
    )
    updated = 1
  }

  return NextResponse.json({ updated })
}
