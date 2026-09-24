/**
 * Participants of one calendar occurrence, read from Google attendees or — for events the
 * Outlook bridge writes with `attendees: []` (Dragontail) — the description `משתתפים:` block.
 */
export interface CalendarParticipant {
  name: string
  email: string | null
  source: 'attendees' | 'description'
}

export interface CalendarAttendeeInput {
  email?: string | null
  displayName?: string | null
  self?: boolean | null
}

export interface ParseParticipantsInput {
  attendees?: CalendarAttendeeInput[] | null
  description?: string | null
  /** Lowercased emails that belong to the owner (connected Google accounts). */
  ownerEmails?: string[]
  ownerName?: string | null
}

const BOT_PARTICIPANT = /meetingbot|teams@teams\.|noreply|no-reply|calendar\.google|zoom\.us|resource\.calendar/i

const PARTICIPANTS_HEADING =
  /(?:^|\n)\s*(?:משתתפים|participants)\s*[:：]\s*(.+?)(?=\n\s*(?:אג['׳']נדה|agenda|מיקום|location|הערות|notes)\s*[:：]|\n\n|$)/isu

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

function descriptionToPlainText(raw: string): string {
  let text = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
  const protectedParts: string[] = []
  text = text.replace(
    /([^<\n,;]+?)\s*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g,
    (_m, name: string, email: string) => {
      protectedParts.push(`${name.trim()} <${email}>`)
      return `__AKMAIL_${protectedParts.length - 1}__`
    },
  )
  text = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
  protectedParts.forEach((part, i) => {
    text = text.replace(`__AKMAIL_${i}__`, part)
  })
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function parseEntry(part: string): { name: string; email: string | null } | null {
  const trimmed = part.trim().replace(/^["']|["']$/g, '')
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return null
  const angle = trimmed.match(/^(.*?)\s*<([^>]+)>$/)
  if (angle) {
    const email = angle[2].trim().toLowerCase()
    return { name: angle[1].trim() || email, email: EMAIL_RE.test(email) ? email : null }
  }
  const paren = trimmed.match(/^(.+?)\s*\(([^)]+@[^)]+)\)$/)
  if (paren) {
    const email = paren[2].trim().toLowerCase()
    return { name: paren[1].trim() || email, email: EMAIL_RE.test(email) ? email : null }
  }
  if (EMAIL_RE.test(trimmed)) return { name: trimmed.toLowerCase(), email: trimmed.toLowerCase() }
  return { name: trimmed, email: null }
}

export function normalizeParticipantName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Stable identity for diffing a roster against an occurrence: email when known, else name. */
export function participantKey(p: { name: string; email?: string | null }): string {
  return p.email?.trim() ? `e:${p.email.trim().toLowerCase()}` : `n:${normalizeParticipantName(p.name)}`
}

export function parseDescriptionParticipants(raw: string | null | undefined): { name: string; email: string | null }[] {
  if (!raw?.trim()) return []
  const match = descriptionToPlainText(raw).match(PARTICIPANTS_HEADING)
  if (!match?.[1]) return []
  return match[1]
    .split(/,|;|\n|•|·|\|/)
    .map(parseEntry)
    .filter((e): e is { name: string; email: string | null } => e !== null)
}

/**
 * Attendees win when present; the description block fills in for bridge-written events.
 * Drops the owner, bots and rooms; dedupes by email, then by normalized name.
 */
export function parseCalendarParticipants(input: ParseParticipantsInput): CalendarParticipant[] {
  const ownerEmails = new Set((input.ownerEmails ?? []).map((e) => e.toLowerCase()))
  const ownerName = input.ownerName ? normalizeParticipantName(input.ownerName) : ''
  const seen = new Set<string>()
  const out: CalendarParticipant[] = []

  const push = (name: string, email: string | null, source: CalendarParticipant['source'], self = false) => {
    if (self) return
    if (BOT_PARTICIPANT.test(name) || (email && BOT_PARTICIPANT.test(email))) return
    if (email && ownerEmails.has(email)) return
    const normName = normalizeParticipantName(name)
    if (!normName && !email) return
    if (ownerName && normName === ownerName) return
    const emailKey = email ? `e:${email}` : null
    const nameKey = normName ? `n:${normName}` : null
    if ((emailKey && seen.has(emailKey)) || (nameKey && seen.has(nameKey))) return
    if (emailKey) seen.add(emailKey)
    if (nameKey) seen.add(nameKey)
    out.push({ name: name.trim() || (email ?? ''), email, source })
  }

  for (const a of input.attendees ?? []) {
    const email = a.email?.trim().toLowerCase() || null
    const name = a.displayName?.trim() || email || ''
    push(name, email, 'attendees', !!a.self)
  }
  for (const e of parseDescriptionParticipants(input.description)) {
    push(e.name, e.email, 'description')
  }
  return out
}

export function parseStoredParticipants(json: string | null | undefined): CalendarParticipant[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is CalendarParticipant => p && typeof p.name === 'string' && (p.email === null || typeof p.email === 'string'),
    )
  } catch {
    return []
  }
}

/** Groups non-recurring-id events that repeat under the same title on the same calendar. */
export function seriesTitleKey(calendarId: string, title: string): string {
  return `${calendarId}|${normalizeParticipantName(title)}`
}
