import { NextResponse } from 'next/server'
import {
  getAgentInstructions,
  getAgentWorkflowContent,
  getAgentWorkflowFile,
  saveAgentInstructions,
  saveAgentWorkflowContent,
} from '@/lib/abc-agents'

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
    const workflowFile = getAgentWorkflowFile(id)
    const workflowContent = getAgentWorkflowContent(id)
    return NextResponse.json({
      id,
      content,
      workflowFile,
      workflowContent,
    })
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
    const body = (await request.json()) as { content?: unknown; target?: unknown }
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    const target = body.target === 'workflow' ? 'workflow' : 'instructions'
    if (target === 'workflow') {
      saveAgentWorkflowContent(id, body.content)
    } else {
      saveAgentInstructions(id, body.content)
    }
    return NextResponse.json({ ok: true, target })
  } catch (err) {
    console.error('[api/agents/[id] PUT]', err)
    const msg = err instanceof Error ? err.message : 'Failed to save agent'
    let status = 500
    if (msg.includes('not found') || msg.includes('Invalid agent') || msg.includes('No workflow')) {
      status = 404
    } else if (msg.includes('empty') || msg.includes('must be') || msg.includes('Invalid workflow')) {
      status = 400
    }
    return NextResponse.json({ error: msg }, { status })
  }
}
