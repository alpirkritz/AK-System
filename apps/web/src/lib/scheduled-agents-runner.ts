import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { listAgentsDueAtTime, migrateAgentSchedulesOnce } from '@ak-system/api'
import { runAgentTrigger, wasAgentRunInSlot } from './agent-trigger-runner'
import { getAgentEngine } from './abc-agents'

function currentTimeInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/**
 * Run every agent whose clock schedule matches the current HH:MM slot.
 *
 * Event-driven runs (morning briefing, pre-meeting prep, ...) go through their own
 * cron endpoints. Both paths stamp `agent_schedules.last_run_at`, so an agent wired
 * to a schedule and an event in the same slot runs once.
 *
 * Lives outside the route file because two routes serve it — `/api/cron/scheduled-agents`
 * and the deprecated `/api/cron/agent-triggers` — and Next.js will not register a
 * `route.ts` that another `route.ts` imports from.
 */
export async function runScheduledAgents(request: NextRequest): Promise<NextResponse> {
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
      error: 'Scheduled agents require AGENT_ENGINE=gemini',
    })
  }

  const timezone = process.env.TIMEZONE || 'Asia/Jerusalem'
  const slot = currentTimeInTimezone(timezone)

  const db = getDb()
  // Carries legacy agent_triggers rows over without waiting for a UI visit.
  await migrateAgentSchedulesOnce(db)

  const scheduled = await listAgentsDueAtTime(slot, db)

  const skipped: string[] = []
  const due = scheduled.filter((row) => {
    if (row.lastRunStatus === 'ok' && wasAgentRunInSlot(row.lastRunAt, slot, timezone)) {
      skipped.push(row.agentId)
      return false
    }
    return true
  })

  if (due.length === 0) {
    return NextResponse.json({
      ok: true,
      slot,
      ran: 0,
      skipped,
      message: 'No agents due at this time',
    })
  }

  const results: Record<string, { ok: boolean; error?: string }> = {}
  for (const row of due) {
    results[row.agentId] = await runAgentTrigger(row.agentId)
  }

  const okCount = Object.values(results).filter((r) => r.ok).length
  return NextResponse.json({
    ok: true,
    slot,
    ran: due.length,
    okCount,
    failCount: due.length - okCount,
    skipped,
    results,
  })
}
