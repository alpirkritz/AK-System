import { type NextRequest, NextResponse } from 'next/server'
import { agentTriggers, getDb } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { runAgentTrigger, parseJsonTimes, wasAgentRunInSlot } from '@/lib/agent-trigger-runner'
import { getAgentEngine } from '@/lib/abc-agents'

export const maxDuration = 300

function currentTimeInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/**
 * Cron: run ABC specialist agents whose schedule matches current HH:MM.
 * Runs every ~15 min; dedupes per day+slot via last_run_at.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runAgentTriggers(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runAgentTriggers(request)
}

async function runAgentTriggers(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (getAgentEngine() !== 'gemini') {
    return NextResponse.json({
      ok: false,
      error: 'Agent triggers require AGENT_ENGINE=gemini',
    })
  }

  const timezone = process.env.TIMEZONE || 'Asia/Jerusalem'
  const slot = currentTimeInTimezone(timezone)

  const db = getDb()
  const rows = await db
    .select()
    .from(agentTriggers)
    .where(eq(agentTriggers.enabled, true))
    .all()

  const due = rows.filter((row) => {
    const times = parseJsonTimes(row.scheduleTimes)
    if (!times.includes(slot)) return false
    if (row.lastRunStatus === 'ok' && wasAgentRunInSlot(row.lastRunAt, slot, timezone)) {
      return false
    }
    return true
  })

  if (due.length === 0) {
    return NextResponse.json({
      ok: true,
      slot,
      ran: 0,
      message: 'No agents due at this time',
    })
  }

  const results: Record<string, { ok: boolean; error?: string }> = {}
  for (const row of due) {
    const result = await runAgentTrigger(row.agentId)
    results[row.agentId] = result
  }

  const okCount = Object.values(results).filter((r) => r.ok).length
  return NextResponse.json({
    ok: true,
    slot,
    ran: due.length,
    okCount,
    failCount: due.length - okCount,
    results,
  })
}
