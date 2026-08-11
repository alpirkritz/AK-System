import { type NextRequest, NextResponse } from 'next/server'
import { listAgentsWithDisplayNames } from '@ak-system/api'
import { getAgentEngine } from '@/lib/abc-agents'
import { getApiSession } from '@/lib/api-session'

// Reads A_Agents/*.md from disk — must not be statically generated at build time
// (deploy build may set ABC_ROOT=/app which does not exist on the Mac builder).
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const agents = await listAgentsWithDisplayNames()
    return NextResponse.json({ agents, engine: getAgentEngine() })
  } catch (err) {
    console.error('[api/agents]', err)
    const msg = err instanceof Error ? err.message : 'Failed to list agents'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
