/**
 * WhatsApp bridge health watchdog.
 *
 * The bridge's own `/status` can say `connected: true` while nothing is getting through —
 * e.g. corrupted Signal sessions ("Bad MAC") make every message fail to decrypt. So the
 * check that matters is whether messages are actually landing in the database, with the
 * bridge status as a second, faster signal.
 *
 * One alert per incident (re-reminded every REMIND_HOURS), and one "back online" message
 * when it recovers. Incident state is `notification_preferences.last_sent_at` for
 * WHATSAPP_HEALTH_TYPE: set while an alert is open, cleared on recovery. No LLM.
 * Delivered over push / Telegram only — WhatsApp is the thing that is broken.
 */
import { desc, eq } from 'drizzle-orm'
import { getDb, notificationPreferences, whatsappDmMessages, whatsappMessages } from '@ak-system/database'
import { createNotification } from '../lib/notification-store'
import { sendMobilePush } from '../lib/mobile-push'
import { getDefaultTimezone } from '../lib/calendar-dates'
import { getBridgeStatus, isBridgeConfigured } from './whatsapp-bridge-client'
import { getSchedulablePreference, markNotificationSent, resolveNotificationChannels } from './notification-preferences'

type Db = ReturnType<typeof getDb>

export const WHATSAPP_HEALTH_TYPE = 'whatsapp_bridge_health'
/** No message stored for this long (counted from the day's start, see below) is a stall. */
export const STALE_HOURS = 5
/** Silence before this local hour is the night, not an outage. */
export const DAY_START_HOUR = 7
/** An open incident is re-announced this often. */
export const REMIND_HOURS = 12

export type HealthProblem = 'unreachable' | 'disconnected' | 'stale'

export interface HealthInput {
  /** null when the bridge could not be reached. */
  status: { connected: boolean; lastError: string | null } | null
  statusError: string | null
  /** Newest stored group or DM message (ms), null when there are none. */
  lastMessageTs: number | null
  now: Date
  timeZone: string
}

export interface HealthVerdict {
  healthy: boolean
  problem: HealthProblem | null
  /** Hours of silence counted for the stale check (from max(last message, today's day start)). */
  silentHours: number | null
  detail: string
}

/** Epoch ms of today's DAY_START_HOUR in the given zone. */
export function dayStartMs(now: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const hour = Number(parts.hour) % 24
  const sinceLocalMidnightMs = ((hour * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000
  const localMidnight = now.getTime() - sinceLocalMidnightMs
  return localMidnight + DAY_START_HOUR * 3_600_000
}

function hoursLabel(h: number): string {
  return h < 48 ? `${Math.round(h)} שעות` : `${Math.round(h / 24)} ימים`
}

/** Pure verdict — the runner only gathers inputs. */
export function evaluateWhatsappHealth(input: HealthInput): HealthVerdict {
  const { status, statusError, lastMessageTs, now, timeZone } = input
  if (!status) {
    return { healthy: false, problem: 'unreachable', silentHours: null, detail: `הגשר לא עונה${statusError ? ` (${statusError})` : ''}` }
  }
  if (!status.connected) {
    return { healthy: false, problem: 'disconnected', silentHours: null, detail: `הגשר מנותק מוואטסאפ${status.lastError ? ` (${status.lastError})` : ''}` }
  }
  const start = dayStartMs(now, timeZone)
  // Night silence never counts: the clock starts at the later of the last message and 07:00.
  const from = Math.max(lastMessageTs ?? 0, start)
  const silentHours = now.getTime() > from ? (now.getTime() - from) / 3_600_000 : 0
  if (silentHours >= STALE_HOURS) {
    const last = lastMessageTs != null ? `ההודעה האחרונה נקלטה לפני ${hoursLabel((now.getTime() - lastMessageTs) / 3_600_000)}` : 'לא נקלטה אף הודעה'
    return {
      healthy: false,
      problem: 'stale',
      silentHours,
      detail: `הגשר מדווח שהוא מחובר, אבל הודעות לא מגיעות למערכת — ${last}. סימן נפוץ לפענוח שנכשל; בדרך כלל צריך לחבר מחדש (סריקת QR).`,
    }
  }
  return { healthy: true, problem: null, silentHours, detail: 'תקין' }
}

export type HealthAction = 'alert' | 'remind' | 'recovered' | 'none'

/** What to send, given the verdict and when the open incident was last announced. */
export function decideHealthAction(verdict: HealthVerdict, openSince: string | null, now: Date): HealthAction {
  if (verdict.healthy) return openSince ? 'recovered' : 'none'
  if (!openSince) return 'alert'
  const ageH = (now.getTime() - new Date(openSince).getTime()) / 3_600_000
  return ageH >= REMIND_HOURS ? 'remind' : 'none'
}

async function newestMessageTs(db: Db): Promise<number | null> {
  const [g] = await db.select({ ts: whatsappMessages.ts }).from(whatsappMessages).orderBy(desc(whatsappMessages.ts)).limit(1)
  const [d] = await db.select({ ts: whatsappDmMessages.ts }).from(whatsappDmMessages).orderBy(desc(whatsappDmMessages.ts)).limit(1)
  const all = [g?.ts, d?.ts].filter((t): t is number => typeof t === 'number')
  return all.length ? Math.max(...all) : null
}

async function clearIncident(db: Db): Promise<void> {
  await db
    .update(notificationPreferences)
    .set({ lastSentAt: null, updatedAt: new Date().toISOString() })
    .where(eq(notificationPreferences.typeId, WHATSAPP_HEALTH_TYPE))
}

export interface HealthRunResult {
  ok: boolean
  skipped?: 'not-configured' | 'disabled'
  verdict?: HealthVerdict
  action?: HealthAction
  title?: string
  text?: string
  notificationId?: string
  /** Channels the web layer should deliver to (browser push, Telegram). */
  channels?: { push: boolean; telegram: boolean }
}

export async function runWhatsappHealthCheck(db: Db, now = new Date()): Promise<HealthRunResult> {
  if (!isBridgeConfigured()) return { ok: true, skipped: 'not-configured' }
  const pref = await getSchedulablePreference(WHATSAPP_HEALTH_TYPE)
  if (!pref.enabled) return { ok: true, skipped: 'disabled' }

  let status: HealthInput['status'] = null
  let statusError: string | null = null
  try {
    const s = await getBridgeStatus()
    status = { connected: !!s.connected, lastError: s.lastError ?? null }
  } catch (err) {
    statusError = err instanceof Error ? err.message : 'unreachable'
  }

  const verdict = evaluateWhatsappHealth({
    status,
    statusError,
    lastMessageTs: await newestMessageTs(db),
    now,
    timeZone: getDefaultTimezone(),
  })
  const action = decideHealthAction(verdict, pref.lastSentAt, now)
  if (action === 'none') return { ok: true, verdict, action }

  const title = action === 'recovered' ? '✅ וואטסאפ חזר לעבוד' : '⚠️ הגשר לוואטסאפ לא עובד'
  const text = action === 'recovered'
    ? 'הודעות מוואטסאפ שוב נקלטות במערכת.'
    : `${verdict.detail}\nבינתיים אין סיכומים, התחייבויות ותובנות מוואטסאפ. לחיבור מחדש: הגדרות ▸ וואטסאפ, או pnpm ec2:whatsapp:pair.`

  let notificationId: string | undefined
  try {
    notificationId = await createNotification({ title, body: text, url: '/settings/whatsapp', type: 'system' })
  } catch (err) {
    console.warn('[whatsapp-health] notification save failed:', err)
  }

  const resolved = await resolveNotificationChannels(WHATSAPP_HEALTH_TYPE)
  if (resolved.push) {
    try {
      await sendMobilePush(title, text.slice(0, 240), '/settings/whatsapp', { notificationId })
    } catch (err) {
      console.warn('[whatsapp-health] mobile push failed:', err)
    }
  }

  if (action === 'recovered') await clearIncident(db)
  else await markNotificationSent(WHATSAPP_HEALTH_TYPE)

  return { ok: true, verdict, action, title, text, notificationId, channels: { push: resolved.push, telegram: resolved.telegram } }
}
