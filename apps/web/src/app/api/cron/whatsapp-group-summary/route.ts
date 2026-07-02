import { type NextRequest, NextResponse } from 'next/server'
import { getDb, whatsappGroups, whatsappLabels } from '@ak-system/database'
import { eq } from 'drizzle-orm'

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function currentTimeInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

function isDueAtSlot(times: string[], slot: string): boolean {
  return times.includes(slot)
}

/**
 * Cron: summarize WhatsApp groups whose schedule matches current HH:MM.
 * Runs every ~15 min; only groups with matching summaryTimes (or label default) are summarized.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runScheduledSummary(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runScheduledSummary(request)
}

async function runScheduledSummary(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const url = process.env.WHATSAPP_BRIDGE_URL
  const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET
  if (!url || !bridgeSecret) {
    return NextResponse.json({ ok: false, error: 'WhatsApp bridge not configured' }, { status: 503 })
  }

  const timezone = process.env.TIMEZONE || 'Asia/Jerusalem'
  const slot = currentTimeInTimezone(timezone)

  const db = getDb()
  const rows = await db
    .select({ group: whatsappGroups, label: whatsappLabels })
    .from(whatsappGroups)
    .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))

  const due = rows.filter(({ group, label }) => {
    if (!group.enabled) return false
    const groupTimes = parseJsonArray(group.summaryTimes)
    const labelTimes = label ? parseJsonArray(label.summaryTimes) : []
    const times = groupTimes.length > 0 ? groupTimes : labelTimes
    return isDueAtSlot(times, slot)
  })

  if (due.length === 0) {
    return NextResponse.json({ ok: true, slot, summarized: 0, message: 'No groups due at this time' })
  }

  const results: Record<string, { ok: boolean; error?: string }> = {}
  for (const { group } of due) {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/groups/summarize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bridgeSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ groupJid: group.jid }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      results[group.jid] = res.ok ? { ok: true } : { ok: false, error: data.error || 'Failed' }
    } catch (err) {
      results[group.jid] = {
        ok: false,
        error: err instanceof Error ? err.message : 'Summarize failed',
      }
    }
  }

  const okCount = Object.values(results).filter((r) => r.ok).length
  return NextResponse.json({ ok: true, slot, summarized: okCount, results })
}
