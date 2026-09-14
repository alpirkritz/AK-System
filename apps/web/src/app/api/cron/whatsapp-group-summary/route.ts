import { type NextRequest, NextResponse } from 'next/server'
import { getDb, whatsappGroups, whatsappLabels } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { partitionDueSummaries, summarizeCluster, summarizeGroup } from '@ak-system/api'

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

/**
 * Cron: summarize WhatsApp groups whose schedule matches current HH:MM.
 * Runs every ~15 min. Labels with aggregateSummaries merge into one message;
 * other due groups stay one-message-each.
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

  if (!process.env.WHATSAPP_BRIDGE_URL || !process.env.WHATSAPP_BRIDGE_SECRET) {
    return NextResponse.json({ ok: false, error: 'WhatsApp bridge not configured' }, { status: 503 })
  }

  const timezone = process.env.TIMEZONE || 'Asia/Jerusalem'
  const slot = currentTimeInTimezone(timezone)

  const db = getDb()
  const rows = await db
    .select({ group: whatsappGroups, label: whatsappLabels })
    .from(whatsappGroups)
    .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))

  const { clusters, singles } = partitionDueSummaries(
    rows.map(({ group, label }) => ({
      enabled: !!group.enabled,
      jid: group.jid,
      name: group.name,
      groupTimes: parseJsonArray(group.summaryTimes),
      labelId: group.labelId,
      labelName: label?.name ?? null,
      labelTimes: label ? parseJsonArray(label.summaryTimes) : [],
      aggregateSummaries: Boolean(label?.aggregateSummaries),
    })),
    slot,
  )

  if (clusters.length === 0 && singles.length === 0) {
    return NextResponse.json({ ok: true, slot, summarized: 0, message: 'No groups due at this time' })
  }

  const results: Record<string, { ok: boolean; error?: string }> = {}

  for (const cluster of clusters) {
    const result = await summarizeCluster({
      clusterName: cluster.labelName,
      groupJids: cluster.groups.map((g) => g.jid),
    })
    results[`cluster:${cluster.labelId}`] = result
  }

  for (const group of singles) {
    results[group.jid] = await summarizeGroup(group.jid)
  }

  const okCount = Object.values(results).filter((r) => r.ok).length
  return NextResponse.json({
    ok: true,
    slot,
    summarized: okCount,
    clustered: clusters.length,
    singles: singles.length,
    results,
  })
}
