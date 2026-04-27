import { type NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `You are a trading journal AI. When a user describes a trade, respond in TWO parts:
PART 1: One sentence. Flag rule violations: no impulse trades, stop always predefined, never average down.
PART 2: Extract to JSON:
{"date":null,"ticker":"","setup_type":"breakout|pullback_ema|range|vcp|other","direction":"Long|Short","entry_price":null,"stop_price":null,"target_price":null,"r_multiple_entry":null,"position_size":null,"execution_quality":null,"emotional_state":"calm|anxious|FOMO|revenge|disciplined","result":"Win|Loss|Breakeven|Open","actual_r":null,"did_right":"","would_change":""}
Use null for missing fields. On REVIEW: win rate, avg R won/lost, common setup, execution mistakes, emotion/result correlation, one fix.`

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY in apps/web/.env.local.' },
      { status: 503 }
    )
  }

  let body: { message?: string }
  try {
    body = (await request.json()) as { message?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const message = body.message?.trim()
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const model =
    process.env.ANTHROPIC_MODEL?.trim() || 'claude-3-5-sonnet-20241022'

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      }),
    })

    const data = (await response.json()) as {
      error?: { message?: string }
      content?: Array<{ type: string; text?: string }>
    }

    if (!response.ok) {
      const errMsg = data.error?.message || response.statusText
      console.error('[api/trading-journal]', response.status, errMsg)
      return NextResponse.json(
        { error: errMsg || 'Anthropic request failed' },
        { status: response.status >= 400 && response.status < 600 ? response.status : 502 }
      )
    }

    const text = data.content?.find((c) => c.type === 'text')?.text
    if (!text) {
      return NextResponse.json({ error: 'Empty model response' }, { status: 502 })
    }

    return NextResponse.json({ text })
  } catch (err) {
    console.error('[api/trading-journal]', err)
    const msg = err instanceof Error ? err.message : 'Request failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
