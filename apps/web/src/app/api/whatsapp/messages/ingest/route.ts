import { type NextRequest, NextResponse } from 'next/server'
import { verifyWhatsAppBridgeAuth } from '@/lib/whatsapp-bot'
import { getDb, whatsappGroups, whatsappMessages, eq, and, inArray } from '@ak-system/database'

interface IngestMessage {
  id: string
  sender: string
  senderName: string
  text: string
  timestamp: number
}

function toEpochMs(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return Date.now()
  return raw < 1e12 ? raw * 1000 : raw
}

/**
 * POST /api/whatsapp/messages/ingest — persist watched-group messages for insights.
 * Called by the whatsapp-bridge flush loop. Stores only for `enabled` groups,
 * normalizes timestamps to ms, and dedupes by (group_jid, wa_message_id).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWhatsAppBridgeAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { groupJid?: string; groupName?: string; messages?: IngestMessage[] }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const groupJid = body.groupJid?.trim()
  const messages = Array.isArray(body.messages) ? body.messages : []
  if (!groupJid || messages.length === 0) {
    return NextResponse.json({ error: 'groupJid and messages are required' }, { status: 400 })
  }

  const db = getDb()

  // Only persist for groups the user has explicitly enabled (privacy + scope).
  const groupRows = await db
    .select({ enabled: whatsappGroups.enabled })
    .from(whatsappGroups)
    .where(eq(whatsappGroups.jid, groupJid))
    .limit(1)
  if (!groupRows[0]?.enabled) {
    return NextResponse.json({ ok: true, stored: 0, skipped: 'group not enabled' })
  }

  const normalized = messages
    .filter((m) => m && m.id && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({
      waMessageId: String(m.id),
      sender: String(m.sender ?? 'unknown'),
      senderName: String(m.senderName ?? m.sender ?? 'unknown'),
      text: m.text.trim(),
      ts: toEpochMs(Number(m.timestamp)),
    }))

  if (normalized.length === 0) {
    return NextResponse.json({ ok: true, stored: 0 })
  }

  // Dedupe against already-stored ids for this group.
  const ids = normalized.map((m) => m.waMessageId)
  const existingRows = await db
    .select({ waMessageId: whatsappMessages.waMessageId })
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.groupJid, groupJid), inArray(whatsappMessages.waMessageId, ids)))
  const existing = new Set(existingRows.map((r) => r.waMessageId))

  const toInsert = normalized
    .filter((m) => !existing.has(m.waMessageId))
    // Guard against duplicate ids within the same batch.
    .filter((m, i, arr) => arr.findIndex((x) => x.waMessageId === m.waMessageId) === i)

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, stored: 0 })
  }

  const now = new Date().toISOString()
  const rows = toInsert.map((m, i) => ({
    id: `wm_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 7)}`,
    groupJid,
    waMessageId: m.waMessageId,
    sender: m.sender,
    senderName: m.senderName,
    text: m.text,
    ts: m.ts,
    createdAt: now,
  }))

  try {
    await db.insert(whatsappMessages).values(rows)
  } catch (err) {
    console.error('[whatsapp/messages/ingest]', err)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, stored: rows.length })
}
