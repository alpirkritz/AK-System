import { agentSchedules, getDb } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import {
  importIBKREmails,
  formatImportReport,
  markAgentRan,
  parseJsonTimes,
  resolveAgentDisplayName,
  wasAgentRunInSlot,
  runTier1QaScan,
  formatIncompleteMessage,
  formatGroundingMessage,
  saveTier1QaSnapshot,
  deliverTier1QaGroupUpdate,
} from '@ak-system/api'
import {
  getDefaultTriggerMessage,
  getAgentEngine,
} from './abc-agents'
import { getAgentHistory, saveAgentMessage } from './agent-chat-store'
import { runAgentForUser } from './agent-runner'
import { pushAssistantMessage } from './push-notifications'

async function resolveTriggerMessage(agentId: string): Promise<string> {
  const db = getDb()
  const rows = await db
    .select()
    .from(agentSchedules)
    .where(eq(agentSchedules.agentId, agentId))
    .limit(1)
  const custom = rows[0]?.triggerMessage?.trim()
  if (custom) return custom
  return getDefaultTriggerMessage(agentId)
}

import { RELEASE_NOTES_AGENT_ID, runReleaseNotesAgent } from '@/lib/release-notes-runner'

const IBKR_AGENT_ID = '05_ibkr_daily_import'

/**
 * IBKR daily import runs as deterministic code (Gmail → finance_trades), not
 * through the LLM. This keeps the import working even when the Gemini engine is
 * unavailable or overloaded.
 */
async function runIbkrImportTrigger(agentId: string): Promise<{
  ok: boolean
  text?: string
  error?: string
}> {
  const agentName = await resolveAgentDisplayName(agentId)
  try {
    await saveAgentMessage(agentId, 'user', await resolveTriggerMessage(agentId))
    const result = await importIBKREmails({ maxEmails: 100 })
    const text = formatImportReport(result)

    await saveAgentMessage(agentId, 'assistant', text)
    await pushAssistantMessage(`🤖 ${agentName}\n\n${text}`, 'cron', {
      title: `${agentName} — סיים`,
      url: `/agents?agent=${encodeURIComponent(agentId)}`,
      typeId: 'agent_run',
    })
    await markAgentRan(agentId, 'ok')
    return { ok: true, text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'IBKR import failed'
    console.error('[runIbkrImportTrigger]', err)
    await markAgentRan(agentId, 'error', msg.slice(0, 500))
    return { ok: false, error: msg }
  }
}

const TIER1_QA_AGENT_ID = '10_tier1_qa_reporter'

/**
 * Tier 1 QA daily update: the Notion fetch, validation, classification, gap
 * detection and diffing all run as deterministic code (notion-tier1-qa.ts)
 * *before* the LLM is ever called — the model only narrates an
 * already-computed payload into the Hebrew WhatsApp template. If the scan
 * is incomplete, the hard safety rule short-circuits here: the LLM is
 * skipped entirely and the fixed failure message goes out on push/in-app
 * only, never WhatsApp, regardless of notification-preference settings.
 * See docs/specs/tier1-qa-whatsapp-agent.md.
 */
async function runTier1QaAgentTrigger(agentId: string): Promise<{
  ok: boolean
  text?: string
  error?: string
}> {
  const agentName = await resolveAgentDisplayName(agentId)
  const db = getDb()

  try {
    const scan = await runTier1QaScan(db)

    if (scan.incomplete) {
      const text = formatIncompleteMessage(scan.missingParts)
      await saveAgentMessage(agentId, 'assistant', text)
      await pushAssistantMessage(`🤖 ${agentName}\n\n${text}`, 'cron', {
        title: `${agentName} — הסריקה לא הושלמה`,
        url: `/agents?agent=${encodeURIComponent(agentId)}`,
        typeId: 'tier1_qa_daily_update',
        whatsapp: false,
      })
      await markAgentRan(agentId, 'error', `סריקה חלקית — לא נשלח: ${scan.missingParts.join('; ')}`.slice(0, 500))
      return { ok: false, error: 'incomplete scan — blocked per safety rule', text }
    }

    const message = formatGroundingMessage(scan)
    await saveAgentMessage(agentId, 'user', message)

    const result = await runAgentForUser({
      agentId,
      message,
      // No chat history: each run is a self-contained, freshly-computed
      // payload — yesterday's huge JSON blob as a "user" turn would only
      // burn tokens, and diffing already comes from the deterministic
      // snapshot compare above, not from LLM memory of prior chat.
      history: [],
      channel: 'cron',
      notifyOnComplete: false,
    })

    // Deliver (or find out exactly why not) *before* saving/pushing anything,
    // so the diagnostic travels with the actual saved/displayed report — not
    // just a push notification, which (a) OS push bodies are truncated to
    // ~240 chars (see push-notifications.ts's `excerpt()`), almost always
    // cutting off anything appended after this 300-600 word report, and
    // (b) /agents/manage's "last run" status line only ever renders
    // `lastRunError`, i.e. it shows nothing extra at all when the run is
    // marked 'ok' — which is exactly how a silent, undiagnosable delivery
    // failure slipped through everywhere Alpir was actually looking.
    const groupJid = process.env.TIER1_QA_WHATSAPP_GROUP_JID?.trim()
    let deliveryOk = false
    let deliveryNote: string
    if (!groupJid) {
      deliveryNote = '⚠️ לא נשלח ל-WhatsApp: TIER1_QA_WHATSAPP_GROUP_JID לא מוגדר בסביבת השרת.'
    } else {
      const delivery = await deliverTier1QaGroupUpdate(result.text, groupJid)
      if (delivery.ok) {
        deliveryOk = true
        deliveryNote = '✅ נשלח בהצלחה לקבוצת ה-WhatsApp.'
      } else {
        console.warn('[runTier1QaAgentTrigger] group delivery skipped/failed:', delivery.error)
        deliveryNote = `⚠️ לא נשלח ל-WhatsApp: ${delivery.error}`
      }
    }

    // The delivery note is part of the saved/displayed message itself, not
    // an addendum only the push payload carries — so it shows up wherever
    // the report itself shows up (agent chat history, /agents/manage).
    const textWithStatus = `${result.text}\n\n---\n${deliveryNote}`
    await saveAgentMessage(agentId, 'assistant', textWithStatus)

    const pushText = `🤖 ${agentName}\n\n${textWithStatus}`
    await pushAssistantMessage(pushText, 'cron', {
      title: `${agentName} — סיים`,
      url: `/agents?agent=${encodeURIComponent(agentId)}`,
      typeId: 'tier1_qa_daily_update',
      // The group send already happened above (or was explicitly skipped) —
      // never let pushAssistantMessage's own generic whatsapp path also fire
      // (that path is self-chat only, per the notification-preferences
      // channel it resolves against; this agent's WhatsApp delivery is
      // exclusively the group send above).
      whatsapp: false,
    })

    // Snapshot persists whenever the scan itself was complete, independent
    // of whether WhatsApp delivery is enabled yet (draft mode still needs
    // day-over-day diffing to work).
    await saveTier1QaSnapshot(db, scan)

    // A run that computed and narrated correctly but failed to actually reach
    // the WhatsApp group is not a clean success for an agent whose entire job
    // is that delivery — mark it as an error (with the concrete reason) so
    // /agents/manage's status line shows "נכשל: <reason>" instead of a bare
    // "הצליחה" that hides the real problem.
    if (deliveryOk) {
      await markAgentRan(agentId, 'ok')
    } else {
      await markAgentRan(agentId, 'error', deliveryNote.slice(0, 500))
    }

    return { ok: deliveryOk, text: textWithStatus }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tier 1 QA agent failed'
    console.error('[runTier1QaAgentTrigger]', err)
    await markAgentRan(agentId, 'error', msg.slice(0, 500))
    return { ok: false, error: msg }
  }
}

/** Run an ABC agent from a trigger (manual or cron). */
export async function runAgentTrigger(agentId: string, opts?: {
  /** ISO date for the calendar context. Only applied for 06_calendar_optimizer. */
  calendarPlanDate?: string
}): Promise<{
  ok: boolean
  text?: string
  error?: string
}> {
  if (agentId === IBKR_AGENT_ID) {
    return runIbkrImportTrigger(agentId)
  }

  // Deterministic poller (no LLM): "run now" works even while the switch is off.
  if (agentId === RELEASE_NOTES_AGENT_ID) {
    const res = await runReleaseNotesAgent({ force: true })
    return res.ok
      ? { ok: true, text: `נבדקו רשומות חדשות: ${res.announced?.length ?? 0} הודעות, ${res.baselined ?? 0} תועדו כקיימות` }
      : { ok: false, error: res.error }
  }

  if (getAgentEngine() !== 'gemini') {
    return {
      ok: false,
      error: 'טריגרים אוטומטיים זמינים רק עם מנוע Gemini',
    }
  }

  // Unlike IBKR, this agent's narration step does call the LLM (the
  // deterministic work is only the data fetch/validation before it), so it
  // needs the engine check above — but skips the generic history/message
  // handling below in favor of its own grounding-payload message.
  if (agentId === TIER1_QA_AGENT_ID) {
    return runTier1QaAgentTrigger(agentId)
  }

  const message = await resolveTriggerMessage(agentId)

  try {
    // Keep scheduled runs isolated from prior chat: with 20 messages of history,
    // yesterday's malformed output became today's few-shot example. 3 turns are
    // enough for continuity without format contamination.
    const history = (await getAgentHistory(agentId, 3))
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    await saveAgentMessage(agentId, 'user', message)

    const result = await runAgentForUser({
      agentId,
      message,
      history,
      channel: 'cron',
      notifyOnComplete: false,
      calendarPlanDate: opts?.calendarPlanDate,
    })

    await saveAgentMessage(agentId, 'assistant', result.text)

    const agentName = await resolveAgentDisplayName(agentId)
    const pushText = `🤖 ${agentName}\n\n${result.text}`
    await pushAssistantMessage(pushText, 'cron', {
      title: `${agentName} — סיים`,
      url: `/agents?agent=${encodeURIComponent(agentId)}`,
      typeId: 'agent_run',
    })

    await markAgentRan(agentId, 'ok')

    return { ok: true, text: result.text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent trigger failed'
    console.error('[runAgentTrigger]', agentId, err)
    await markAgentRan(agentId, 'error', msg.slice(0, 500))
    return { ok: false, error: msg }
  }
}

export { parseJsonTimes, wasAgentRunInSlot }
