import { type NextRequest, NextResponse } from 'next/server'
import { handleWhatsAppInbound, verifyWhatsAppBridgeAuth, type WhatsAppInboundPayload } from '@/lib/whatsapp-bot'

/**
 * WhatsApp bridge webhook — receives inbound messages from apps/whatsapp-bridge.
 *
 * Bridge env: AK_WEBHOOK_URL=https://<YOUR_DOMAIN>/api/whatsapp/webhook
 * Shared secret: WHATSAPP_BRIDGE_SECRET (AK) = BRIDGE_SECRET (bridge)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWhatsAppBridgeAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: WhatsAppInboundPayload
  try {
    payload = (await request.json()) as WhatsAppInboundPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!payload.message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  try {
    const reply = await handleWhatsAppInbound(payload)
    return NextResponse.json({ reply: reply || '' })
  } catch (err) {
    console.error('[WhatsApp Webhook] Unhandled error:', err)
    return NextResponse.json({ reply: '' })
  }
}
