/**
 * One evening briefing of every followed WhatsApp group.
 * The renderer owns order: actions, then label sections, then the quiet line.
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { chatMessages, getDb, whatsappGroups, whatsappLabels, whatsappMessages } from '@ak-system/database'
import { resolveWhatsappTimeWindow } from '../lib/whatsapp-time-window'
import { createNotification } from '../lib/notification-store'
import { sendMobilePush } from '../lib/mobile-push'
import { getDefaultTimezone } from '../lib/calendar-dates'
import { QUIET_DAY_BODY } from './whatsapp-summary-clusters'
import { wasNotificationSentToday, resolveNotificationChannels } from './notification-preferences'
import { isBridgeConfigured, sendBridgeText } from './whatsapp-bridge-client'
import {
  generateDailyDigestModel,
  type DailyDigestModel,
} from './whatsapp-insights'

type Db = ReturnType<typeof getDb>

export const WHATSAPP_DAILY_DIGEST_TYPE = 'whatsapp_daily_digest'
const OTHER_SECTION = 'אחר'
const ACTION_HEADING = 'צריך אותך'
const WA_CAP = 4000
const SUMMARY_CAP = 280
const MAX_ACTIONS = 8
const MAX_POINTS = 4

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

export interface DigestPoint {
  source: string
  text: string
}

export interface DigestSection {
  title: string
  summary: string
  points: DigestPoint[]
}

export interface ArrangedDigest {
  dateLabel: string
  actions: DigestAction[]
  sections: DigestSection[]
  quiet: string[]
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

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1).trimEnd() + '…'
}

export function arrangeDailyDigest(input: {
  dateLabel: string
  groups: FollowedDigestGroup[]
  model: DailyDigestModel | null
}): ArrangedDigest {
  const groups = input.groups
  const busy = groups.filter((g) => g.messageCount > 0)
  const quiet = groups
    .filter((g) => g.messageCount === 0)
    .map((g) => g.name)
    .sort((a, b) => a.localeCompare(b, 'he'))

  if (busy.length === 0) {
    return {
      dateLabel: input.dateLabel,
      actions: [],
      sections: [],
      quiet: [],
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

  const actionSources = new Set(actions.map((a) => a.source))
  const lineByName = new Map((model?.groups ?? []).map((g) => [g.name.trim(), g]))
  const sharedByLabel = new Map((model?.shared ?? []).map((s) => [s.label.trim(), s.summary.trim()]))

  const byTitle = new Map<string, FollowedDigestGroup[]>()
  for (const g of busy) {
    const title = sectionTitle(g)
    const list = byTitle.get(title) ?? []
    list.push(g)
    byTitle.set(title, list)
  }

  const sections: (DigestSection & { priority: number; messageCount: number; hasAction: boolean })[] = []
  for (const [title, members] of byTitle) {
    const sortedMembers = [...members].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.name.localeCompare(b.name, 'he')
    })
    const shared = sharedByLabel.get(title)?.trim() || ''
    const fallbackSummary = sortedMembers.map((g) => lineByName.get(g.name)?.line.trim() || '').filter(Boolean)[0] || ''
    const summary = title === OTHER_SECTION ? '' : clip(shared || fallbackSummary, SUMMARY_CAP)

    const points: DigestPoint[] = []
    const seen = new Set<string>()
    for (const g of sortedMembers) {
      const fromModel = lineByName.get(g.name)
      const detail = fromModel?.detail.trim() || ''
      const line = fromModel?.line.trim() || ''
      let text = ''
      if (title === OTHER_SECTION) {
        text = line || detail || `היו ${g.messageCount} הודעות היום`
      } else if (detail && detail !== summary) {
        text = detail
      } else if (!line && !detail) {
        text = `היו ${g.messageCount} הודעות היום`
      } else if (members.length > 1 && line && line !== summary && line !== shared && line !== fallbackSummary) {
        text = line
      }
      if (!text || seen.has(text)) continue
      seen.add(text)
      points.push({ source: g.name, text })
    }

    sections.push({
      title,
      summary,
      points: points.slice(0, MAX_POINTS),
      priority: Math.max(...sortedMembers.map((g) => g.priority)),
      messageCount: sortedMembers.reduce((n, g) => n + g.messageCount, 0),
      hasAction:
        actionSources.has(title) || sortedMembers.some((g) => actionSources.has(g.name)),
    })
  }

  sections.sort((a, b) => {
    const otherLast = Number(a.title === OTHER_SECTION && !a.hasAction) - Number(b.title === OTHER_SECTION && !b.hasAction)
    if (otherLast !== 0) return otherLast
    const actionFirst = Number(!a.hasAction) - Number(!b.hasAction)
    if (actionFirst !== 0) return actionFirst
    if (a.priority !== b.priority) return b.priority - a.priority
    if (a.messageCount !== b.messageCount) return b.messageCount - a.messageCount
    return a.title.localeCompare(b.title, 'he')
  })

  return {
    dateLabel: input.dateLabel,
    actions,
    sections: sections.map(({ title, summary, points }) => ({ title, summary, points })),
    quiet,
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
  for (const section of digest.sections) {
    lines.push(section.title)
    if (section.summary) lines.push(section.summary)
    for (const point of section.points) {
      lines.push(`• ${point.source}: ${point.text}`)
    }
    lines.push('')
  }
  if (digest.quiet.length > 0) {
    lines.push(`שקט היום: ${digest.quiet.join(', ')}`)
  }

  const full = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (full.length <= WA_CAP) return full

  const names = [
    ...digest.sections.flatMap((s) => s.points.map((p) => p.source)),
    ...digest.quiet,
  ]
  const budget = WA_CAP - 60
  let cut = full.slice(0, budget)
  const nl = cut.lastIndexOf('\n')
  if (nl > budget * 0.5) cut = cut.slice(0, nl)
  const missing = names.filter((name) => name && !cut.includes(name))
  const note =
    missing.length > 0
      ? `\n\nועוד ${missing.length} קבוצות בכרטיס ההתראה.`
      : '\n\nהמשך בכרטיס ההתראה.'
  return (cut.trimEnd() + note).slice(0, WA_CAP)
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
  for (const section of digest.sections) {
    lines.push(`## ${section.title}`)
    if (section.summary) lines.push(section.summary)
    for (const point of section.points) {
      lines.push(`- ${point.source}: ${point.text}`)
    }
    lines.push('')
  }
  if (digest.quiet.length > 0) {
    lines.push(`שקט היום: ${digest.quiet.join(', ')}`)
  }
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
      model = await generateDailyDigestModel(
        busy.map((g) => ({
          name: g.name,
          label: g.labelName?.trim() || OTHER_SECTION,
          priority: g.priority,
          messages: g.messages,
        })),
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
    sectionCount: arranged.sections.length,
    quietCount: arranged.quiet.length,
    error: delivered.error,
    notificationId: delivered.notificationId,
    title,
    pushBody: digestPushBody(plain),
    markdown,
  }
}
