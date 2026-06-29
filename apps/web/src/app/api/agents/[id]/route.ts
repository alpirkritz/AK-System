import { NextResponse } from 'next/server'
import { getAgentInstructions, saveAgentInstructions } from '@/lib/abc-agents'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params
    const content = getAgentInstructions(id)
    return NextResponse.json({ id, content })
  } catch (err) {
    console.error('[api/agents/[id] GET]', err)
    const msg = err instanceof Error ? err.message : 'Failed to load agent'
    const status = msg.includes('not found') || msg.includes('Invalid agent') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params
    const body = (await request.json()) as { content?: unknown }
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    saveAgentInstructions(id, body.content)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/agents/[id] PUT]', err)
    const msg = err instanceof Error ? err.message : 'Failed to save agent'
    let status = 500
    if (msg.includes('not found') || msg.includes('Invalid agent')) status = 404
    else if (msg.includes('empty') || msg.includes('must be')) status = 400
    return NextResponse.json({ error: msg }, { status })
  }
}
