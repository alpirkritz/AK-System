import { type NextRequest, NextResponse } from 'next/server'
import { handleWhatsAppInbound, verifyWhatsAppBridgeAuth, type WhatsAppInboundPayload } from '@/lib/whatsapp-bot'
import { createAgentJob } from '@ak-system/api'
import { HUGO_AGENT_ID } from '@/lib/abc-agents'

/**
 * WhatsApp bridge webhook — receives inbound messages from apps/whatsapp-bridge.
 *
 * Bridge env: AK_WEBHOOK_URL=https://<YOUR_DOMAIN>/api/whatsapp/webhook
 * Shared secret: WHATSAPP_BRIDGE_SECRET (AK) = BRIDGE_SECRET (bridge)
 *
 * When WHATSAPP_ASYNC_REPLY=1 is set, messages are queued for background processing
 * instead of being processed synchronously. This prevents webhook timeouts under load.
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

  // Check if async mode is enabled
  const asyncMode = process.env.WHATSAPP_ASYNC_REPLY === '1'

  if (asyncMode) {
    // Queue the message for background processing
    try {
      const { jobId, created } = await createAgentJob({
        channel: 'whatsapp',
        agentId: HUGO_AGENT_ID,
        payload: {
          message: payload.message,
          from: payload.from,
          chatJid: payload.chatJid,
          messageId: payload.messageId,
        },
        dedupeKey: payload.messageId, // idempotent on message ID
      })

      console.log(
        `[WhatsApp Webhook] Message queued as job ${jobId} ${created ? '(new)' : '(duplicate)'}`,
      )

      // Return immediately — worker will process and send reply
      return NextResponse.json({ status: 'queued', jobId })
    } catch (err) {
      console.error('[WhatsApp Webhook] Failed to queue job:', err)
      // Fall back to sync processing on queue failure
    }
  }

  // Synchronous mode (original behavior)
  try {
    const reply = await handleWhatsAppInbound(payload)
    return NextResponse.json({ reply: reply || '' })
  } catch (err) {
    console.error('[WhatsApp Webhook] Unhandled error:', err)
    return NextResponse.json({ reply: '' })
  }
}
