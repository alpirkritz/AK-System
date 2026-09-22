import { type NextRequest, NextResponse } from 'next/server'
import { getPendingJobs, markJobRunning, markJobDone, markJobFailed, type AgentJobPayload } from '@ak-system/api'
import { handleWhatsAppInbound, type WhatsAppInboundPayload } from '@/lib/whatsapp-bot'
import { sendWhatsAppMessage } from '@/lib/whatsapp-bot'

/**
 * Agent Jobs Worker — processes queued WhatsApp/Telegram messages.
 * Run every minute via cron.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const batchSize = 5
  const jobs = await getPendingJobs(batchSize)

  if (jobs.length === 0) {
    return NextResponse.json({ processed: 0, skipped: 0 })
  }

  let processed = 0
  let skipped = 0

  for (const job of jobs) {
    try {
      await markJobRunning(job.id)

      const payload = JSON.parse(job.payload) as AgentJobPayload

      if (job.channel === 'whatsapp') {
        // Process WhatsApp message
        const whatsappPayload: WhatsAppInboundPayload = {
          message: payload.message,
          from: payload.from,
          chatJid: payload.chatJid,
          messageId: payload.messageId,
        }

        // Process the message (this calls the agent)
        const reply = await handleWhatsAppInbound(whatsappPayload)

        // Send reply via bridge if we got one
        if (reply && reply.trim()) {
          const sent = await sendWhatsAppMessage(payload.chatJid, reply)
          if (!sent) {
            throw new Error('Failed to send WhatsApp message via bridge')
          }
        }

        await markJobDone(job.id)
        processed++
      } else {
        // Telegram support can be added later
        await markJobFailed(job.id, 'Unsupported channel', job.attempts + 1)
        skipped++
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[AgentJobsWorker] Job ${job.id} failed:`, errorMsg)
      await markJobFailed(job.id, errorMsg, job.attempts + 1)
      skipped++
    }
  }

  return NextResponse.json({
    processed,
    skipped,
    total: jobs.length,
  })
}
