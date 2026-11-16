import {
  createLiveReleaseNotesDeps,
  isAgentEnabled,
  markAgentRan,
  RELEASE_NOTES_NOTIFICATION_TYPE_ID,
  runReleaseNotesListener,
} from '@ak-system/api'
import { pushAssistantMessage } from '@/lib/push-notifications'

export const RELEASE_NOTES_AGENT_ID = '11_release_notes_listener'

export interface ReleaseNotesRunSummary {
  ok: boolean
  skipped?: 'disabled'
  baselined?: number
  announced?: Array<{ pageId: string; status: string }>
  error?: string
}

/**
 * One listener pass, gated by the agent's on/off switch on /agents/manage
 * (`agent_schedules.enabled`). `force` is for the manual "run now" button,
 * which should work even while the switch is off.
 */
export async function runReleaseNotesAgent(opts?: { force?: boolean }): Promise<ReleaseNotesRunSummary> {
  if (!opts?.force && !(await isAgentEnabled(RELEASE_NOTES_AGENT_ID))) {
    return { ok: true, skipped: 'disabled' }
  }

  const result = await runReleaseNotesListener(createLiveReleaseNotesDeps())
  if (!result.ok) {
    await markAgentRan(RELEASE_NOTES_AGENT_ID, 'error', (result.error ?? 'failed').slice(0, 500))
    return { ok: false, error: result.error }
  }

  const failures: string[] = []
  for (const a of result.announcements) {
    // A still-retrying item is reported once it resolves (sent/failed/drafted).
    if (a.status === 'pending') {
      if (a.error) failures.push(`${a.title}: ${a.error}`)
      continue
    }
    const note =
      a.status === 'sent'
        ? '✅ נשלח לקבוצת טכני'
        : a.status === 'drafted'
          ? '📝 מצב טיוטה — לא נשלח ל-WhatsApp'
          : `⚠️ לא נשלח אחרי ניסיונות חוזרים (${a.error ?? 'שגיאה'})`
    if (a.status === 'failed') failures.push(`${a.title}: ${a.error ?? 'failed'}`)
    await pushAssistantMessage(`${a.message}\n\n---\n${note}`, 'cron', {
      title: `Release notes — ${a.title}`,
      url: '/notifications',
      typeId: RELEASE_NOTES_NOTIFICATION_TYPE_ID,
      // Group delivery already happened (or was skipped) above; never fall back to self-chat.
      whatsapp: false,
    })
  }

  await markAgentRan(
    RELEASE_NOTES_AGENT_ID,
    failures.length ? 'error' : 'ok',
    failures.length ? failures.join('; ').slice(0, 500) : undefined,
  )
  return {
    ok: true,
    baselined: result.baselined,
    announced: result.announcements.map((a) => ({ pageId: a.pageId, status: a.status })),
  }
}
