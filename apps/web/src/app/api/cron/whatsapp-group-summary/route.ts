import { type NextRequest, NextResponse } from 'next/server'

/**
 * Cron: Trigger WhatsApp group summarization on the bridge.
 * Calls bridge POST /groups/summarize-all for all WATCH_GROUP_JIDS configured on the bridge.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runGroupSummary(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runGroupSummary(request)
}

async function runGroupSummary(request: NextRequest): Promise<NextResponse> {
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

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/groups/summarize-all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridgeSecret}`,
      },
    })
    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data }, { status: res.status })
    }
    return NextResponse.json({ ok: true, ...data })
  } catch (err) {
    console.error('[cron/whatsapp-group-summary]', err)
    const msg = err instanceof Error ? err.message : 'Group summary cron failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
