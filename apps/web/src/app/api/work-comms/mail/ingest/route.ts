import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { ingestWorkMail, type EmailHeaderMessage } from '@ak-system/api'
import { verifyWorkCommsAuth } from '@/lib/work-comms-auth'

/**
 * POST /api/work-comms/mail/ingest — Outlook mail headers pushed from the local bridge.
 * Body: { messages: EmailHeaderMessage[] }. Persists into the shared email archive and
 * runs the same matching/commitment path as Gmail. Bearer secret auth.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWorkCommsAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { messages?: EmailHeaderMessage[] }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  try {
    const result = await ingestWorkMail(getDb(), messages)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[work-comms/mail/ingest]', err)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }
}
