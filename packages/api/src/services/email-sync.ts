/**
 * Email archive for known people: recent Gmail threads (metadata + snippet only) from every
 * connected Google account, one row per (thread, person).
 */
import { google } from 'googleapis'
import { and, eq, inArray } from 'drizzle-orm'
import { people, personEmailThreads, personExternalIds, type getDb } from '@ak-system/database'
import { normalizeParticipantName } from '../lib/calendar-participants'
import { getAccessTokenForConnection, listGoogleConnections } from './google-connections'
import { getSelfPersonName } from './self-person'
import { learnAlias } from './person-resolution'

type Db = ReturnType<typeof getDb>

const DAY_MS = 86_400_000
export const EMAIL_SYNC_DAYS = 30
const ADDRESS_BATCH = 15
const MAX_PER_QUERY = 100

export interface EmailHeaderMessage {
  accountEmail: string
  messageId: string
  threadId: string
  subject: string
  from: string
  to: string
  cc: string
  /** ISO timestamp */
  date: string
  /** Gmail snippet as returned (HTML entities encoded) */
  snippet: string
}

export interface EmailFetchResult {
  messages: EmailHeaderMessage[]
  accountErrors: { account: string; error: string }[]
}

export type EmailFetcher = (addresses: string[], days: number) => Promise<EmailFetchResult>

export function extractAddresses(header: string): string[] {
  return [...new Set((header.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((a) => a.toLowerCase()))]
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function gmailSearchQuery(addresses: string[], days: number): string {
  const terms = addresses.flatMap((a) => [`from:${a}`, `to:${a}`, `cc:${a}`])
  return `newer_than:${days}d {${terms.join(' ')}}`
}

/** Default fetcher: Gmail metadata only (no bodies), across all connected accounts. */
export const fetchGmailHeaders: EmailFetcher = async (addresses, days) => {
  const connections = await listGoogleConnections()
  const out: EmailFetchResult = { messages: [], accountErrors: [] }
  for (const conn of connections) {
    try {
      const auth = new google.auth.OAuth2()
      auth.setCredentials({ access_token: await getAccessTokenForConnection(conn) })
      const gmail = google.gmail({ version: 'v1', auth })
      for (let i = 0; i < addresses.length; i += ADDRESS_BATCH) {
        const list = await gmail.users.messages.list({
          userId: 'me',
          q: gmailSearchQuery(addresses.slice(i, i + ADDRESS_BATCH), days),
          maxResults: MAX_PER_QUERY,
        })
        for (const ref of list.data.messages ?? []) {
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id: ref.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
          })
          const headers = msg.data.payload?.headers ?? []
          const hdr = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
          const ms = Number(msg.data.internalDate) || Date.parse(hdr('Date')) || Date.now()
          out.messages.push({
            accountEmail: conn.calendarEmail,
            messageId: ref.id!,
            threadId: ref.threadId ?? msg.data.threadId ?? ref.id!,
            subject: hdr('Subject'),
            from: hdr('From'),
            to: hdr('To'),
            cc: hdr('Cc'),
            date: new Date(ms).toISOString(),
            snippet: msg.data.snippet ?? '',
          })
        }
      }
    } catch (err) {
      out.accountErrors.push({ account: conn.calendarEmail, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}

/** Email address → person id for confirmed people (people.email + external ids), skipping me. */
export async function knownEmailAddresses(db: Db, personIds?: string[]): Promise<Map<string, string>> {
  const selfName = normalizeParticipantName(getSelfPersonName())
  const rows = await db
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(personIds?.length ? and(eq(people.status, 'confirmed'), inArray(people.id, personIds)) : eq(people.status, 'confirmed'))
  const confirmed = rows.filter((p) => normalizeParticipantName(p.name) !== selfName)
  const ids = new Set(confirmed.map((p) => p.id))
  const map = new Map<string, string>()
  for (const p of confirmed) for (const a of extractAddresses(p.email ?? '')) map.set(a, p.id)
  if (ids.size > 0) {
    const external = await db
      .select({ personId: personExternalIds.personId, externalId: personExternalIds.externalId })
      .from(personExternalIds)
      .where(and(eq(personExternalIds.provider, 'email'), inArray(personExternalIds.personId, [...ids])))
    for (const e of external) for (const a of extractAddresses(e.externalId)) if (!map.has(a)) map.set(a, e.personId)
  }
  return map
}

export interface EmailSyncResult {
  people: number
  messages: number
  created: number
  updated: number
  commitments: number
  accountErrors: { account: string; error: string }[]
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export async function syncEmailThreads(
  db: Db,
  options: { fetch?: EmailFetcher; personIds?: string[]; now?: number } = {},
): Promise<EmailSyncResult> {
  const now = options.now ?? Date.now()
  const known = await knownEmailAddresses(db, options.personIds)
  const result: EmailSyncResult = { people: new Set(known.values()).size, messages: 0, created: 0, updated: 0, commitments: 0, accountErrors: [] }
  if (known.size === 0) return result

  const fetched = await (options.fetch ?? fetchGmailHeaders)([...known.keys()], EMAIL_SYNC_DAYS)
  result.accountErrors = fetched.accountErrors
  result.messages = fetched.messages.length

  const groups = new Map<string, { threadKey: string; personId: string; messages: EmailHeaderMessage[] }>()
  const learnedNames = new Set<string>()
  for (const raw of fetched.messages) {
    const m = { ...raw, snippet: decodeEntities(raw.snippet) }
    const account = m.accountEmail.toLowerCase()
    const addresses = [...extractAddresses(m.from), ...extractAddresses(m.to), ...extractAddresses(m.cc)].filter((a) => a !== account)
    const threadKey = `${m.accountEmail}::${m.threadId}`
    const fromName = m.from.match(/^\s*"?([^"<@]+?)"?\s*</)?.[1]?.trim()
    const sender = extractAddresses(m.from).map((a) => known.get(a)).find((id): id is string => !!id)
    if (fromName && sender && !learnedNames.has(`${sender}|${fromName}`)) {
      learnedNames.add(`${sender}|${fromName}`)
      await learnAlias(db, sender, fromName, 'email')
    }
    for (const personId of new Set(addresses.map((a) => known.get(a)).filter((id): id is string => !!id))) {
      const key = `${threadKey}|${personId}`
      const g = groups.get(key) ?? { threadKey, personId, messages: [] }
      if (!g.messages.some((x) => x.messageId === m.messageId)) g.messages.push(m)
      groups.set(key, g)
    }
  }

  const syncedAt = new Date(now).toISOString()
  for (const { threadKey, personId, messages } of groups.values()) {
    messages.sort((a, b) => a.date.localeCompare(b.date))
    const latest = messages[messages.length - 1]
    const [existing] = await db
      .select({ id: personEmailThreads.id, date: personEmailThreads.date, messageCount: personEmailThreads.messageCount })
      .from(personEmailThreads)
      .where(and(eq(personEmailThreads.gmailThreadId, threadKey), eq(personEmailThreads.personId, personId)))
    if (existing && existing.date >= latest.date) continue
    const fields = {
      subject: latest.subject || '(ללא נושא)',
      from: latest.from,
      to: latest.to,
      date: latest.date,
      snippet: clip(latest.snippet, 200) || null,
      messageCount: Math.max(existing?.messageCount ?? 0, messages.length),
      lastSyncedAt: syncedAt,
    }
    if (existing) {
      // A newer message makes the previous reply/FYI label stale.
      await db.update(personEmailThreads).set({ ...fields, replyNeed: null, replyNeedAt: null }).where(eq(personEmailThreads.id, existing.id))
      result.updated++
    } else {
      await db.insert(personEmailThreads).values({
        id: `pet_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        personId,
        gmailThreadId: threadKey,
        accountEmail: latest.accountEmail,
        ...fields,
        createdAt: syncedAt,
      })
      result.created++
    }
  }
  return result
}
