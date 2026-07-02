import { type NextRequest, NextResponse } from 'next/server'
import { getDb, whatsappGroups, whatsappLabels } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { pushConfigToBridge, isBridgeConfigured, type GroupRulePayload } from '@ak-system/api'

export const dynamic = 'force-dynamic'

/**
 * Re-push WhatsApp group watch rules from the AK DB to the bridge.
 * Called by the deploy script after (re)start so the in-memory bridge config
 * is restored from the source of truth. Guarded by CRON_SECRET.
 */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

async function run(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!isBridgeConfigured()) {
    return NextResponse.json({ ok: false, error: 'WhatsApp bridge not configured' }, { status: 503 })
  }

  const db = getDb()
  const rows = await db
    .select({ group: whatsappGroups, label: whatsappLabels })
    .from(whatsappGroups)
    .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))

  const groups: GroupRulePayload[] = rows.map(({ group, label }) => ({
    jid: group.jid,
    name: group.name,
    enabled: !!group.enabled,
    fomoEnabled: !!group.fomoEnabled,
    fomoThreshold: group.fomoThreshold,
    fomoWindowMinutes: group.fomoWindowMinutes,
    keywords: parseJsonArray(group.keywords),
    summaryTimes: parseJsonArray(group.summaryTimes),
    labelSummaryTimes: label ? parseJsonArray(label.summaryTimes) : [],
    lastFomoAlertAt: group.lastFomoAlertAt,
  }))

  try {
    await pushConfigToBridge(groups)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Push failed' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, enabled: groups.filter((g) => g.enabled).length })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return run(request)
}
