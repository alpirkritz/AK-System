import { type NextRequest, NextResponse } from 'next/server'
import { verifyWhatsAppBridgeAuth } from '@/lib/whatsapp-bot'
import { getDb } from '@ak-system/database'
import { ingestDmMessages, type DmIngestMessage } from '@ak-system/api'

/**
 * POST /api/whatsapp/dm/ingest — 1:1 messages from the bridge for allowlisted people.
 * The allowlist is re-checked here; messages from people with capture off, or older than the
 * moment capture was switched on, are dropped.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWhatsAppBridgeAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { messages?: DmIngestMessage[] }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages are required' }, { status: 400 })
  }
  try {
    const result = await ingestDmMessages(getDb(), messages)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[whatsapp/dm/ingest]', err)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }
}
