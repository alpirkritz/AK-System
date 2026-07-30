/** Calendar attendee as returned by Google/Apple calendar APIs. */
export interface PreMeetingAttendee {
  email?: string
  displayName?: string
  self?: boolean
}

export interface PreMeetingEvent {
  title: string
  start: string
  location?: string | null
  description?: string | null
  attendees?: PreMeetingAttendee[]
}

export interface PreMeetingCrmPerson {
  id: string
  name: string
  email?: string | null
}

export interface PreMeetingTask {
  id: string
  title: string
  priority: string
  done: boolean
  meetingId?: string | null
  projectId?: string | null
}

export interface PreMeetingLinked {
  id: string
  notes?: string | null
  projectId?: string | null
  projectName?: string | null
}

export interface FormatPreMeetingBriefInput {
  event: PreMeetingEvent
  linkedMeeting?: PreMeetingLinked | null
  crmPeople?: PreMeetingCrmPerson[]
  relatedTasks?: PreMeetingTask[]
  priorNotes?: string | null
}

/** Drop Teams/Zoom join chrome (per line). */
const TEAMS_BOILERPLATE =
  /^(join|join now|join meeting|join with|click here to join|need help\?|learn more|dial in|phone conference|download teams|join on the web|alternate vtc|or call in|call in \(audio|united states|united kingdom|israel)\b|microsoft teams meeting|join the meeting|meeting id:|passcode:|conference id|https?:\/\/teams\.microsoft\.com|https?:\/\/.*\.zoom\.us|teams@teams\.|________________|-----+|\+\d[\d\s\-(),#]{8,}/i

/** Outlook / Exchange invite header lines — not agenda. */
const OUTLOOK_INVITE_LINE =
  /^(from|sent|to|cc|bcc|subject|when|where|organizer|importance|priority)\s*[:：]/i

const BOT_PARTICIPANT =
  /meetingbot|teams@teams\.|noreply|no-reply|calendar\.google|zoom\.us/i

/** Dragontail / Outlook-bridge embeds attendees in the description under this heading. */
const PARTICIPANTS_HEADING =
  /(?:^|\n)\s*(?:משתתפים|participants)\s*[:：]\s*(.+?)(?=\n\s*(?:אג['׳']נדה|agenda|מיקום|location|הערות|notes)\s*[:：]|\n\n|$)/isu

const MAX_AGENDA_CHARS = 400
const MAX_MESSAGE_CHARS = 2000
const MAX_RELATED_TASKS = 8
const MAX_PARTICIPANTS_SHOWN = 8

/** Plain-text description without HTML / Teams boilerplate (keeps participant heading for parsers). */
export function descriptionToPlainText(raw: string | null | undefined): string {
  if (!raw?.trim()) return ''
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')

  // Protect "Name <email@x.com>" so HTML tag strip does not eat emails (Dragontail bridge format).
  const protectedParts: string[] = []
  text = text.replace(
    /([^<\n,;]+?)\s*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g,
    (_m, name: string, email: string) => {
      const i = protectedParts.length
      protectedParts.push(`${name.trim()} <${email}>`)
      return `__AKMAIL_${i}__`
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

  for (let i = 0; i < protectedParts.length; i++) {
    text = text.replace(`__AKMAIL_${i}__`, protectedParts[i])
  }

  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !TEAMS_BOILERPLATE.test(l) &&
        !OUTLOOK_INVITE_LINE.test(l),
    )

  return lines.join('\n').trim()
}

/**
 * Parse Dragontail-style `משתתפים: Name <email>, …` (or `Participants:`) from description.
 * Returns display labels suitable for the brief.
 */
export function extractParticipantsFromDescription(
  raw: string | null | undefined,
): string[] {
  const plain = descriptionToPlainText(raw)
  if (!plain) return []
  const match = plain.match(PARTICIPANTS_HEADING)
  if (!match?.[1]) return []

  return match[1]
    .split(/,|;|\n|•|·|\|/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const angle = part.match(/^(.+?)\s*<([^>]+)>$/)
      if (angle) {
        const name = angle[1].trim()
        const email = angle[2].trim()
        if (name && email && name.toLowerCase() !== email.toLowerCase()) {
          return `${name} (${email})`
        }
        return name || email
      }
      const paren = part.match(/^(.+?)\s*\(([^)]+@[^)]+)\)$/)
      if (paren) {
        const name = paren[1].trim()
        const email = paren[2].trim()
        if (name && name.toLowerCase() !== email.toLowerCase()) {
          return `${name} (${email})`
        }
        return name || email
      }
      return part
    })
    .filter((label) => label.length > 0 && !/^https?:\/\//i.test(label))
}

/** Remove the participants heading block so agenda does not repeat it. */
export function stripParticipantsSection(plain: string): string {
  return plain
    .replace(
      /(?:^|\n)\s*(?:משתתפים|participants)\s*[:：]\s*.+?(?=\n\s*(?:אג['׳']נדה|agenda|מיקום|location|הערות|notes)\s*[:：]|\n\n|$)/isu,
      '\n',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * True only when text looks like a real agenda/note — not Outlook invite chrome
 * or generic mission-statement / Teams help fluff.
 */
export function isUsefulAgenda(text: string | null | undefined): boolean {
  const t = text?.trim() ?? ''
  if (t.length < 8) return false
  if (/^(from|sent|to|cc|subject|when)\s*:/im.test(t)) return false
  if (/occurs every|effective \d{1,2}\/\d{1,2}\/\d{4}/i.test(t)) return false
  if (/download teams|join on the web|alternate vtc|or call in/i.test(t)) return false
  if (/need help\s*\||system reference|find a local number/i.test(t)) return false
  // Generic vision / mission paste without actionable bullets
  if (
    /our goal is to|operate with a clear|speed with discipline|ideas into measurable impact/i.test(t) &&
    !/\d+\.|•|- /.test(t)
  ) {
    return false
  }
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean)
  const usefulLines = lines.filter(
    (l) =>
      !OUTLOOK_INVITE_LINE.test(l) &&
      !TEAMS_BOILERPLATE.test(l) &&
      !/^occurs every/i.test(l) &&
      !/need help\s*\||system reference/i.test(l),
  )
  if (usefulLines.length === 0) return false
  const joined = usefulLines.join(' ')
  return joined.length >= 12
}

/**
 * Whether this event is worth a Meeting Prep LLM run (skip solo/personal noise).
 * All-day / free-busy / ≥8h are already excluded by calendar.upcoming.
 */
export function shouldRunPreMeetingAgent(event: {
  attendees?: PreMeetingAttendee[]
  description?: string | null
}): boolean {
  const fromDesc = extractParticipantsFromDescription(event.description)
  if (fromDesc.some((l) => !isBotLabel(l))) return true
  const fromCal = (event.attendees ?? []).filter((a) => {
    if (a.self) return false
    const label = a.displayName || a.email || ''
    return label.length > 0 && !isBotLabel(label) && !BOT_PARTICIPANT.test(a.email || '')
  })
  return fromCal.length > 0
}

/** Fact block for the agent — never include invite fluff as "agenda". */
export function buildPreMeetingAgentContext(input: FormatPreMeetingBriefInput): string {
  const { event, linkedMeeting, crmPeople = [], relatedTasks = [], priorNotes } = input
  const time = event.start.includes('T') ? event.start.slice(11, 16) : 'כל היום'
  const participants = formatParticipantsForBrief(
    collectParticipantLabels(crmPeople, event.attendees ?? [], extractParticipantsFromDescription(event.description)),
  )
  const lines: string[] = [
    `Meeting: ${event.title}`,
    `Time: ${time}`,
  ]
  if (event.location?.trim()) lines.push(`Location: ${event.location.trim()}`)
  if (linkedMeeting?.projectName?.trim()) lines.push(`Project: ${linkedMeeting.projectName.trim()}`)
  if (participants) lines.push(`Participants: ${participants}`)
  const agenda = resolveAgenda(input)
  if (agenda) {
    lines.push('', 'Useful note/agenda (may be incomplete — verify with Notion tools):', agenda)
  }
  if (priorNotes && isUsefulAgenda(priorNotes)) {
    lines.push('', 'Prior meeting notes hint:', priorNotes.slice(0, 400))
  }
  if (relatedTasks.length > 0) {
    lines.push('', 'Possibly related open tasks (verify/filter with get_notion_tasks):')
    for (const t of relatedTasks) lines.push(`- [${t.priority}] ${t.title}`)
  }
  return lines.join('\n')
}

/** Strip HTML + invite chrome + participants section; return useful agenda or ''. */
export function stripCalendarDescriptionHtml(raw: string | null | undefined): string {
  let text = stripParticipantsSection(descriptionToPlainText(raw))
  // Drop residual "Occurs every…" recurrence blurbs
  text = text
    .split('\n')
    .filter((l) => !/^occurs every/i.test(l.trim()))
    .join('\n')
    .trim()
  if (!isUsefulAgenda(text)) return ''
  if (text.length > MAX_AGENDA_CHARS) {
    text = text.slice(0, MAX_AGENDA_CHARS - 1).trimEnd() + '…'
  }
  return text
}

function attendeeLabel(a: PreMeetingAttendee): string | null {
  if (a.self) return null
  const name = a.displayName?.trim()
  const email = a.email?.trim()
  if (BOT_PARTICIPANT.test(name || '') || BOT_PARTICIPANT.test(email || '')) return null
  if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} (${email})`
  return name || email || null
}

function isBotLabel(label: string): boolean {
  return BOT_PARTICIPANT.test(label)
}

/** Display name only — drop trailing (email). */
export function participantDisplayName(label: string): string {
  return label.replace(/\s*\([^)]+@[^)]+\)\s*$/, '').trim() || label
}

/**
 * Cap large DL dumps. Names only when list is long; omit bots.
 * Returns null when nothing worth showing.
 */
export function formatParticipantsForBrief(labels: string[]): string | null {
  const cleaned = labels.filter((l) => l.trim() && !isBotLabel(l))
  if (cleaned.length === 0) return null

  const preferNamesOnly = cleaned.length > 5
  const display = cleaned.map((l) =>
    preferNamesOnly ? participantDisplayName(l) : l,
  )

  if (display.length <= MAX_PARTICIPANTS_SHOWN) {
    return display.join(', ')
  }
  const shown = display.slice(0, MAX_PARTICIPANTS_SHOWN)
  const rest = display.length - MAX_PARTICIPANTS_SHOWN
  return `${shown.join(', ')} ועוד ${rest}`
}

/** Merge CRM people + calendar attendees + description `משתתפים:`; dedupe by email/name. */
export function collectParticipantLabels(
  crmPeople: PreMeetingCrmPerson[] = [],
  attendees: PreMeetingAttendee[] = [],
  descriptionParticipants: string[] = [],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const push = (label: string, email?: string | null) => {
    if (isBotLabel(label) || BOT_PARTICIPANT.test(email || '')) return
    const key = (email?.trim() || label.replace(/\s*\([^)]+@[^)]+\)\s*$/, '').trim()).toLowerCase()
    if (seen.has(key)) return
    const emailInLabel = label.match(/\(([^)]+@[^)]+)\)/)?.[1]?.toLowerCase()
    if (emailInLabel && seen.has(emailInLabel)) return
    seen.add(key)
    if (emailInLabel) seen.add(emailInLabel)
    if (email?.trim()) seen.add(email.trim().toLowerCase())
    out.push(label)
  }

  for (const p of crmPeople) {
    if (!p.name?.trim()) continue
    push(p.name.trim(), p.email)
  }
  for (const a of attendees) {
    const label = attendeeLabel(a)
    if (!label) continue
    push(label, a.email)
  }
  for (const label of descriptionParticipants) {
    push(label)
  }
  return out
}

const TITLE_STOP = new Set(
  'follow up meeting sync weekly daily standup the and for with from into about this that next last connect'.split(
    ' ',
  ),
)

/** Significant tokens from a meeting title for light task matching (min length 4). */
export function significantTitleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !TITLE_STOP.has(t))
}

/**
 * Pick open tasks related to this meeting only — linked meetingId, shared projectId,
 * or title-token overlap with the meeting title. Never dumps the full backlog.
 */
export function selectRelatedOpenTasks(
  allTasks: PreMeetingTask[],
  linked: { id: string; projectId?: string | null } | null | undefined,
  meetingTitle?: string,
  limit = MAX_RELATED_TASKS,
): PreMeetingTask[] {
  const tokens = meetingTitle ? significantTitleTokens(meetingTitle) : []
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const matched = allTasks.filter((t) => {
    if (t.done) return false
    if (linked?.id && t.meetingId === linked.id) return true
    if (linked?.projectId && t.projectId === linked.projectId) return true
    if (tokens.length > 0) {
      const hay = t.title.toLowerCase()
      if (tokens.some((tok) => hay.includes(tok))) return true
    }
    return false
  })
  matched.sort(
    (a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1),
  )
  return matched.slice(0, limit)
}

/** Most recent past meeting with same title and non-empty notes. */
export function findPriorMeetingNotes(
  allMeetings: { title: string; date: string; notes?: string | null }[],
  title: string,
  todayIso: string,
): string | null {
  const norm = title.trim().toLowerCase()
  const prior = allMeetings
    .filter(
      (m) =>
        m.title.trim().toLowerCase() === norm &&
        m.date < todayIso &&
        Boolean(m.notes?.trim()),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
  const notes = prior[0]?.notes?.trim() || null
  return notes && isUsefulAgenda(notes) ? notes : null
}

function resolveAgenda(input: FormatPreMeetingBriefInput): string {
  const fromDesc = stripCalendarDescriptionHtml(input.event.description)
  if (fromDesc) return fromDesc
  const fromNotes = input.linkedMeeting?.notes?.trim()
  if (fromNotes && isUsefulAgenda(fromNotes)) return fromNotes.slice(0, MAX_AGENDA_CHARS)
  const fromPrior = input.priorNotes?.trim()
  if (fromPrior && isUsefulAgenda(fromPrior)) return fromPrior.slice(0, MAX_AGENDA_CHARS)
  return ''
}

/**
 * Hebrew pre-meeting brief — signal only.
 * Omits agenda / participants / tasks sections when there is nothing useful to say.
 */
export function formatPreMeetingBrief(input: FormatPreMeetingBriefInput): string {
  const { event, linkedMeeting, crmPeople = [], relatedTasks = [] } = input
  const time = event.start.includes('T') ? event.start.slice(11, 16) : 'כל היום'
  const fromDescription = extractParticipantsFromDescription(event.description)
  const participantsLine = formatParticipantsForBrief(
    collectParticipantLabels(crmPeople, event.attendees ?? [], fromDescription),
  )
  const agenda = resolveAgenda(input)

  const lines: string[] = [
    `⏰ הכנה לפגישה – ${event.title}`,
    `שעה: ${time}`,
  ]
  if (event.location?.trim()) lines.push(`מיקום: ${event.location.trim()}`)
  if (linkedMeeting?.projectName?.trim()) {
    lines.push(`פרויקט: ${linkedMeeting.projectName.trim()}`)
  }

  if (participantsLine) {
    lines.push('')
    lines.push(`משתתפים: ${participantsLine}`)
  }

  if (agenda) {
    lines.push('')
    lines.push('על מה הולכים לדבר:')
    lines.push(agenda)
  }

  if (relatedTasks.length > 0) {
    lines.push('')
    lines.push('משימות קשורות:')
    for (const t of relatedTasks) {
      lines.push(`• [${t.priority}] ${t.title}`)
    }
  }

  return lines.join('\n').slice(0, MAX_MESSAGE_CHARS)
}
