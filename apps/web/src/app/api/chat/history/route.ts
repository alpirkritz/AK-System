import { type NextRequest, NextResponse } from 'next/server'
import { getDb, chatMessages, desc, lt } from '@ak-system/database'

/**
 * GET /api/chat/history — fetch recent chat messages.
 * Query: ?limit=50&before=<iso>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const before = searchParams.get('before') || undefined

    const db = getDb()
    const where = before ? lt(chatMessages.createdAt, before) : undefined
    const rows = await db
      .select()
      .from(chatMessages)
      .where(where)
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit)

    return NextResponse.json({ messages: rows.reverse() })
  } catch (err) {
    console.error('[api/chat/history]', err)
    const msg = err instanceof Error ? err.message : 'Failed to fetch history'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
