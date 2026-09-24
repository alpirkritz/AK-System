/**
 * One evening briefing of every followed WhatsApp group.
 * The renderer owns order: actions, then one spoken story. Quiet groups are omitted.
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { chatMessages, getDb, userSettings, whatsappGroups, whatsappLabels, whatsappMessages } from '@ak-system/database'
import { resolveWhatsappTimeWindow } from '../lib/whatsapp-time-window'
import { createNotification } from '../lib/notification-store'
import { sendMobilePush } from '../lib/mobile-push'
import { getDefaultTimezone } from '../lib/calendar-dates'
import { QUIET_DAY_BODY } from './whatsapp-summary-clusters'
import { wasNotificationSentToday, resolveNotificationChannels } from './notification-preferences'
import { isBridgeConfigured, sendBridgeText } from './whatsapp-bridge-client'
import {
  DIGEST_NARRATIVE_FALLBACK,
  generateDailyDigestModel,
  type DailyDigestModel,
} from './whatsapp-insights'

type Db = ReturnType<typeof getDb>

export const WHATSAPP_DAILY_DIGEST_TYPE = 'whatsapp_daily_digest'
const OTHER_SECTION = 'אחר'
const ACTION_HEADING = 'צריך אותך'
const WA_CAP = 4000
const MAX_ACTIONS = 5
const SETTINGS_ID = 'default'
const PROMPT_MIN = 40
const PROMPT_MAX = 4000
export const NARRATIVE_CAP = 900

export const DEFAULT_DAILY_DIGEST_PROMPT = [
  'אתה חבר שמספר מה היה היום בקבוצות הוואטסאפ שבמעקב.',
  'כתוב עברית מדוברת, כמו שיחה על כוס קפה — לא דוח, בלי בולטים ובלי תוויות כמו "נושא:".',
  'ספר רק על קבוצות שיש בהן הודעות. אל תזכיר קבוצה שלא קרה בה כלום.',
  'לכל קבוצה פעילה: כמה משפטים קצרים על מה דיברו, מה עלה, ואם הוחלט משהו. תהיה תמציתי — משפט או שניים כשזה מספיק, יותר רק אם באמת קרה משהו. כל הסיפור עד 900 תווים.',
  'אם אותו אירוע עלה בכמה קבוצות של אותה תווית — ספר אותו פעם אחת. ציין שם קבוצה רק כשהפרט שייך לה לבד.',
  'אל תמציא עובדות ואל תצטט הודעות ארוכות.',
  'ב-actions שים רק משהו שהמשתמש צריך לעשות: בקשה, שאלה פתוחה, דדליין, או דבר להביא, לאשר, לשלם או לענות. החלטה שכבר התקבלה בלי משימה פתוחה אינה action.',
].join('\n')

export interface FollowedDigestGroup {
  jid: string
  name: string
  labelName: string | null
  priority: number
  messageCount: number
  messages: { senderName: string; text: string; ts: number }[]
}

export interface DigestAction {
  text: string
  source: string
}

export interface ArrangedDigest {
  dateLabel: string
  actions: DigestAction[]
  narrative: string
  emptyDay: boolean
}

export interface DigestRunResult {
  ok: boolean
  text: string
  actionCount: number
  sectionCount: number
  quietCount: number
  error?: string
  notificationId?: string
  title?: string
  pushBody?: string
  markdown?: string
}

export function formatDigestDateLabel(timeZone: string, now = new Date()): string {
  const weekday = new Intl.DateTimeFormat('he-IL', { timeZone, weekday: 'long' }).format(now)
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric' }).format(now)
  const month = new Intl.DateTimeFormat('en-GB', { timeZone, month: 'numeric' }).format(now)
  return `${weekday}, ${day}.${month}`
}

export function shouldSkipScheduledGroupSummaries(input: {
  digestEnabled: boolean
  lastSentAt: string | null
  timeZone: string
}): boolean {
  return input.digestEnabled && wasNotificationSentToday(input.lastSentAt, input.timeZone)
}

function sectionTitle(group: FollowedDigestGroup): string {
  return group.labelName?.trim() || OTHER_SECTION
}

/** Clip at the last sentence or paragraph break so a long story stays one screen. */
export function clipNarrative(text: string, max = NARRATIVE_CAP): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const slice = trimmed.slice(0, max)
  const boundary = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?'),
    slice.lastIndexOf('\n'),
  )
  if (boundary > max * 0.5) return slice.slice(0, boundary + 1).trim()
  return slice.trimEnd() + '…'
}

export function effectiveDigestPrompt(stored: string | null | undefined): string {
  const trimmed = stored?.trim()
  return trimmed ? trimmed : DEFAULT_DAILY_DIGEST_PROMPT
}

export function normalizeDigestPrompt(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length < PROMPT_MIN || trimmed.length > PROMPT_MAX) {
    throw new Error('DIGEST_PROMPT_LENGTH')
  }
  return trimmed
}

export function arrangeDailyDigest(input: {
  dateLabel: string
  groups: FollowedDigestGroup[]
  model: DailyDigestModel | null
}): ArrangedDigest {
  const groups = input.groups
  const busy = groups.filter((g) => g.messageCount > 0)

  if (busy.length === 0) {
    return {
      dateLabel: input.dateLabel,
      actions: [],
      narrative: '',
      emptyDay: true,
    }
  }

  const priorityOf = new Map<string, number>()
  for (const g of groups) {
    priorityOf.set(g.name, Math.max(priorityOf.get(g.name) ?? 0, g.priority))
    const label = sectionTitle(g)
    priorityOf.set(label, Math.max(priorityOf.get(label) ?? 0, g.priority))
  }
  const allowedSources = new Set(priorityOf.keys())
  const busyNames = new Set(busy.map((g) => g.name))

  const model = input.model
  const actions = (model?.actions ?? [])
    .map((a) => ({ text: a.text.trim(), source: a.source.trim() }))
    .filter((a) => a.text && allowedSources.has(a.source))
    .filter((a) => {
      if (busyNames.has(a.source)) return true
      return busy.some((g) => sectionTitle(g) === a.source)
    })
    .sort((a, b) => {
      const prio = (priorityOf.get(b.source) ?? 0) - (priorityOf.get(a.source) ?? 0)
      if (prio !== 0) return prio
      return a.source.localeCompare(b.source, 'he')
    })
    .slice(0, MAX_ACTIONS)

  const rawNarrative = model?.narrative?.trim() ?? ''
  return {
    dateLabel: input.dateLabel,
    actions: rawNarrative ? actions : [],
    narrative: clipNarrative(rawNarrative || DIGEST_NARRATIVE_FALLBACK),
    emptyDay: false,
  }
}

function headerLine(dateLabel: string): string {
  return `מה היה היום — ${dateLabel}`
}

export function renderDailyDigestPlain(digest: ArrangedDigest): string {
  if (digest.emptyDay) {
    return `${headerLine(digest.dateLabel)}\n\n${QUIET_DAY_BODY}`
  }

  const lines: string[] = [headerLine(digest.dateLabel), '']
  if (digest.actions.length > 0) {
    lines.push(ACTION_HEADING)
    for (const action of digest.actions) {
      lines.push(`• ${action.text} — ${action.source}`)
    }
    lines.push('')
  }
  if (digest.narrative) lines.push(digest.narrative)

  const full = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (full.length <= WA_CAP) return full

  const budget = WA_CAP - 40
  let cut = full.slice(0, budget)
  const nl = cut.lastIndexOf('\n')
  if (nl > budget * 0.5) cut = cut.slice(0, nl)
  return (cut.trimEnd() + '\n\nהמשך בכרטיס ההתראה.').slice(0, WA_CAP)
}

/** Markdown twin for the in-app notification. Headings and bullets match parseNotificationBody. */
export function renderDailyDigestMarkdown(digest: ArrangedDigest): string {
  if (digest.emptyDay) {
    return `# ${headerLine(digest.dateLabel)}\n\n${QUIET_DAY_BODY}`
  }

  const lines: string[] = [`# ${headerLine(digest.dateLabel)}`, '']
  if (digest.actions.length > 0) {
    lines.push(`## ${ACTION_HEADING}`)
    for (const action of digest.actions) {
      lines.push(`- ${action.text} — ${action.source}`)
    }
    lines.push('')
  }
  if (digest.narrative) lines.push(digest.narrative)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function digestTitle(digest: ArrangedDigest): string {
  return digest.actions.length > 0 ? ACTION_HEADING : 'מה היה היום'
}

export function digestPushBody(plain: string): string {
  const fromAction = plain.indexOf(ACTION_HEADING)
  const start = fromAction >= 0 ? plain.slice(fromAction) : plain
  return start.slice(0, 240)
}

export async function loadFollowedGroups(db: Db): Promise<FollowedDigestGroup[]> {
  const rows = await db
    .select({ group: whatsappGroups, label: whatsappLabels })
    .from(whatsappGroups)
    .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))
    .where(eq(whatsappGroups.enabled, true))

  if (rows.length === 0) return []

  const range = resolveWhatsappTimeWindow({ window: 'today' })
  const jids = rows.map(({ group }) => group.jid)
  const msgRows = await db
    .select({
      groupJid: whatsappMessages.groupJid,
      senderName: whatsappMessages.senderName,
      text: whatsappMessages.text,
      ts: whatsappMessages.ts,
    })
    .from(whatsappMessages)
    .where(
      and(
        inArray(whatsappMessages.groupJid, jids),
        gte(whatsappMessages.ts, range.sinceMs),
        lte(whatsappMessages.ts, range.untilMs),
      ),
    )
    .orderBy(asc(whatsappMessages.ts))

  const byGroup = new Map<string, { senderName: string; text: string; ts: number }[]>()
  for (const row of msgRows) {
    const list = byGroup.get(row.groupJid) ?? []
    list.push({ senderName: row.senderName, text: row.text, ts: row.ts })
    byGroup.set(row.groupJid, list)
  }

  return rows.map(({ group, label }) => {
    const messages = byGroup.get(group.jid) ?? []
    return {
      jid: group.jid,
      name: group.name,
      labelName: label?.name ?? null,
      priority: group.priority ?? 0,
      messageCount: messages.length,
      messages,
    }
  })
}

function genMsgId(): string {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

async function deliverDigest(
  db: Db,
  plain: string,
  markdown: string,
  title: string,
): Promise<{ notificationId?: string; error?: string }> {
  try {
    await db.insert(chatMessages).values({
      id: genMsgId(),
      role: 'assistant',
      content: plain,
      source: 'whatsapp',
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[whatsapp-daily-digest] chat save failed:', err)
  }

  let notificationId: string | undefined
  try {
    notificationId = await createNotification({
      title,
      body: markdown,
      url: '/notifications',
      type: 'cron',
    })
  } catch (err) {
    console.warn('[whatsapp-daily-digest] notification save failed:', err)
  }

  const channels = await resolveNotificationChannels(WHATSAPP_DAILY_DIGEST_TYPE)
  let sendError: string | undefined

  if (channels.whatsapp && isBridgeConfigured()) {
    const sent = await sendBridgeText(plain)
    if (!sent.ok) sendError = sent.error || 'הסיכום נוצר אבל לא נשלח לוואטסאפ'
  }

  if (channels.push && notificationId) {
    try {
      await sendMobilePush(title, digestPushBody(plain), '/notifications', { notificationId })
    } catch (err) {
      console.warn('[whatsapp-daily-digest] mobile push failed:', err)
    }
  }

  return { notificationId, error: sendError }
}

async function readStoredDigestPrompt(db: Db): Promise<string | null> {
  const rows = await db
    .select({ prompt: userSettings.whatsappDailyDigestPrompt })
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID))
    .limit(1)
  return rows[0]?.prompt ?? null
}

export async function getDailyDigestPrompt(db: Db): Promise<{ prompt: string; customized: boolean }> {
  const stored = await readStoredDigestPrompt(db)
  const customized = Boolean(stored?.trim())
  return { prompt: effectiveDigestPrompt(stored), customized }
}

export async function saveDailyDigestPrompt(
  db: Db,
  raw: string,
): Promise<{ prompt: string; customized: true }> {
  const prompt = normalizeDigestPrompt(raw)
  const now = new Date().toISOString()
  const rows = await db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID))
    .limit(1)
  if (rows[0]) {
    await db
      .update(userSettings)
      .set({ whatsappDailyDigestPrompt: prompt, updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({
      id: SETTINGS_ID,
      whatsappDailyDigestPrompt: prompt,
      updatedAt: now,
    })
  }
  return { prompt, customized: true }
}

export async function resetDailyDigestPrompt(db: Db): Promise<{ prompt: string; customized: false }> {
  const now = new Date().toISOString()
  const rows = await db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID))
    .limit(1)
  if (rows[0]) {
    await db
      .update(userSettings)
      .set({ whatsappDailyDigestPrompt: null, updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  }
  return { prompt: DEFAULT_DAILY_DIGEST_PROMPT, customized: false }
}

export async function runFollowedDailyDigest(db: Db): Promise<DigestRunResult> {
  const groups = await loadFollowedGroups(db)
  if (groups.length === 0) {
    return { ok: true, text: '', actionCount: 0, sectionCount: 0, quietCount: 0 }
  }

  const dateLabel = formatDigestDateLabel(getDefaultTimezone())
  const busy = groups.filter((g) => g.messageCount > 0)
  let model: DailyDigestModel | null = null
  if (busy.length > 0) {
    try {
      const { prompt } = await getDailyDigestPrompt(db)
      model = await generateDailyDigestModel(
        busy.map((g) => ({
          name: g.name,
          label: g.labelName?.trim() || OTHER_SECTION,
          priority: g.priority,
          messages: g.messages,
        })),
        prompt,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Daily digest failed'
      return { ok: false, text: '', actionCount: 0, sectionCount: 0, quietCount: 0, error: message }
    }
  }

  const arranged = arrangeDailyDigest({ dateLabel, groups, model })
  const plain = renderDailyDigestPlain(arranged)
  const markdown = renderDailyDigestMarkdown(arranged)
  const title = digestTitle(arranged)
  const delivered = await deliverDigest(db, plain, markdown, title)

  return {
    ok: !delivered.error,
    text: plain,
    actionCount: arranged.actions.length,
    sectionCount: arranged.emptyDay || !arranged.narrative ? 0 : 1,
    quietCount: 0,
    error: delivered.error,
    notificationId: delivered.notificationId,
    title,
    pushBody: digestPushBody(plain),
    markdown,
  }
}
