import { type NextRequest, type NextResponse } from 'next/server'
import { runScheduledAgents } from '@/lib/scheduled-agents-runner'

export const maxDuration = 300

/** Cron: run agents whose clock schedule matches the current HH:MM (every ~15 min). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runScheduledAgents(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runScheduledAgents(request)
}
