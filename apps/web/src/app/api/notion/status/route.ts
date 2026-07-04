import { type NextRequest, NextResponse } from 'next/server'
import { getNotionStatus } from '@/lib/notion'
import { getApiSession } from '@/lib/api-session'

/**
 * GET /api/notion/status — per-account/per-database Notion connectivity.
 * Used by the Settings Notion card to diagnose unshared databases.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const status = await getNotionStatus()
    return NextResponse.json(status)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Notion status failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
