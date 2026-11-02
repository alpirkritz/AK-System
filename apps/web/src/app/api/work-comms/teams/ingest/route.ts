import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { ingestWorkTeams, type WorkTeamsIngestPayload } from '@ak-system/api'
import { verifyWorkCommsAuth } from '@/lib/work-comms-auth'

/**
 * POST /api/work-comms/teams/ingest — Teams chats + messages pushed from the local bridge.
 * Body: WorkTeamsIngestPayload. Persists and runs the Teams commitment scan. Bearer secret auth.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWorkCommsAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: Partial<WorkTeamsIngestPayload>
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const payload: WorkTeamsIngestPayload = {
    chats: Array.isArray(body.chats) ? body.chats : [],
    messages: Array.isArray(body.messages) ? body.messages : [],
  }
  try {
    const result = await ingestWorkTeams(getDb(), payload)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[work-comms/teams/ingest]', err)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }
}
