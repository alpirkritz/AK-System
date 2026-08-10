import { type NextRequest, NextResponse } from 'next/server'
import {
  getDb,
  notifications,
  eq,
  desc,
  isNull,
  and,
  runMutation,
} from '@ak-system/database'
import { sessionFromBearer } from '@/lib/mobile-auth'

async function requireMobileSession(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth) return null
  return sessionFromBearer(auth)
}

/** GET /api/notifications — list non-archived notifications for Helm app */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireMobileSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 50), 100)
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === '1'
  const db = getDb()
  const rows = includeArchived
    ? await db
        .select()
        .from(notifications)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(notifications)
        .where(isNull(notifications.archivedAt))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)

  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(isNull(notifications.readAt), isNull(notifications.archivedAt)))

  return NextResponse.json({ notifications: rows, unreadCount: unread.length })
}

/** PATCH /api/notifications — mark read or archive */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await requireMobileSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    id?: string
    all?: boolean
    action?: 'read' | 'archive' | 'unarchive' | 'archiveAll' | 'archiveAllUndo'
    batchAt?: string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb()
  const now = new Date().toISOString()
  const action = body.action ?? 'read'

  if (action === 'archive') {
    if (!body.id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }
    await runMutation(
      db
        .update(notifications)
        .set({ archivedAt: now })
        .where(eq(notifications.id, body.id)),
    )
    return NextResponse.json({ archived: true, updated: 1 })
  }

  if (action === 'unarchive') {
    if (!body.id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }
    await runMutation(
      db
        .update(notifications)
        .set({ archivedAt: null })
        .where(eq(notifications.id, body.id)),
    )
    return NextResponse.json({ archived: false, updated: 1 })
  }

  if (action === 'archiveAll') {
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(isNull(notifications.archivedAt))
    for (const row of rows) {
      await runMutation(
        db.update(notifications).set({ archivedAt: now }).where(eq(notifications.id, row.id)),
      )
    }
    return NextResponse.json({ archived: true, updated: rows.length, batchAt: now })
  }

  if (action === 'archiveAllUndo') {
    if (!body.batchAt) {
      return NextResponse.json({ error: 'batchAt required' }, { status: 400 })
    }
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.archivedAt, body.batchAt))
    for (const row of rows) {
      await runMutation(
        db.update(notifications).set({ archivedAt: null }).where(eq(notifications.id, row.id)),
      )
    }
    return NextResponse.json({ archived: false, updated: rows.length })
  }

  let updated = 0

  if (body.all) {
    const unread = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(isNull(notifications.readAt), isNull(notifications.archivedAt)))
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
