import { type NextRequest, NextResponse } from 'next/server'
import { runScheduledAgents } from '@/lib/scheduled-agents-runner'

export const maxDuration = 300

/**
 * @deprecated Renamed to `/api/cron/scheduled-agents`.
 *
 * Kept as a forwarding shim so a deployed crontab that has not been reinstalled yet
 * keeps running scheduled agents instead of 404ing. Per-slot de-duplication makes it
 * harmless for both paths to be wired at once. Remove once every host's crontab
 * points at the new path.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withDeprecationNotice(await runScheduledAgents(request))
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withDeprecationNotice(await runScheduledAgents(request))
}

async function withDeprecationNotice(res: NextResponse): Promise<NextResponse> {
  console.warn(
    '[cron/agent-triggers] deprecated path — update crontab to /api/cron/scheduled-agents',
  )
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return NextResponse.json(
    {
      ...(body && typeof body === 'object' ? body : {}),
      deprecated: true,
      movedTo: '/api/cron/scheduled-agents',
    },
    { status: res.status },
  )
}
