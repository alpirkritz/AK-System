import { eq, getDb, harnessInsights } from '@ak-system/database'
import { formatInsightLines, listOpenInsights, selectInsightsToPush } from '@ak-system/api'
import { pushAssistantMessage } from '@/lib/push-notifications'
import { runEventAgentIfRouted } from '@/lib/notification-event-runner'

const NOTIFICATION_TYPE = 'harness_insight'

/**
 * Push urgent insights (up to 5) and unpushed situation-level attention (up to 3), once each.
 * Runs through Hugo (the type's default agent) and falls back to the template on failure.
 * Shared by the 6-hourly full run and the hourly reason-only run.
 */
export async function pushHarnessInsights(): Promise<{ sent: number; mode: 'agent' | 'template' | null }> {
  const db = getDb()
  const allOpen = await listOpenInsights(db, { limit: 50 })
  const toSend = selectInsightsToPush(allOpen)
  if (toSend.length === 0) return { sent: 0, mode: null }

  const text = ['🔗 תובנות חוצות-תחומים', '', ...formatInsightLines(toSend)].join('\n')
  let mode: 'agent' | 'template' = 'agent'
  try {
    const routed = await runEventAgentIfRouted(NOTIFICATION_TYPE, { context: text, url: '/' })
    if (routed.status === 'not_routed') mode = 'template'
  } catch (err) {
    console.error('[harness-push] agent run failed, falling back to template', err)
    mode = 'template'
  }
  if (mode === 'template') {
    await pushAssistantMessage(text, 'cron', { typeId: NOTIFICATION_TYPE, url: '/' })
  }
  const nowIso = new Date().toISOString()
  for (const insight of toSend) {
    await db.update(harnessInsights).set({ notifiedAt: nowIso }).where(eq(harnessInsights.id, insight.id))
  }
  return { sent: toSend.length, mode }
}

/** Shared bearer check for cron routes. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return token === secret
}
