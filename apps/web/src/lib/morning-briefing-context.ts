import { formatLocalRange } from '@ak-system/api'

/** Shared shape for morning briefing template + agent context. */
export interface MorningBriefEvent {
  id?: string
  start: string
  end?: string | null
  title: string
}

/** From `insights.coolingForDate`. */
export interface MorningCoolingFlag {
  calendarEventId: string | null
  title: string
  coolingPeople: string[]
  circleCooling: boolean
}

function coolingSuffix(flag: MorningCoolingFlag | undefined): string {
  if (!flag) return ''
  const parts: string[] = []
  if (flag.circleCooling) parts.push('↓ הפגישה מתקררת')
  if (flag.coolingPeople.length > 0) parts.push(`↓ ${flag.coolingPeople.join(', ')}`)
  return parts.length > 0 ? ` (${parts.join(' · ')})` : ''
}

/** From `insights.commitmentsForDate`. */
export interface MorningCommitment {
  personName: string
  owner: string
  content: string
  source: string
}

export interface MorningCommitments {
  byPerson: { personName: string; items: MorningCommitment[] }[]
  mine: MorningCommitment[]
}

const SOURCE_LABELS: Record<string, string> = {
  meeting_analysis: 'מהאנליזה',
  whatsapp_dm: 'מהוואטסאפ',
  whatsapp_group: 'מהוואטסאפ',
  email: 'מאימייל',
  voice: 'מהקלטה',
}

/** From `waiting.list`: open items others owe me. */
export interface MorningWaitingItem { personName: string; title: string; dueDate: string | null }
export interface MorningWaiting { overdue: MorningWaitingItem[]; today: MorningWaitingItem[] }

/** "Who owes me what today": what first, then who. Late items are marked. */
export function waitingLines(w: MorningWaiting | undefined): string[] {
  if (!w || w.overdue.length + w.today.length === 0) return []
  const line = (i: MorningWaitingItem, late: boolean) => `• ${i.title} — ${i.personName}${late ? ' (באיחור)' : ''}`
  return ['', 'חייבים לי היום:', ...w.overdue.map((i) => line(i, true)), ...w.today.map((i) => line(i, false))]
}

function commitmentLines(c: MorningCommitments | undefined): string[] {
  if (!c) return []
  const lines: string[] = []
  if (c.byPerson.length > 0) {
    lines.push('', 'התחייבויות פתוחות:')
    for (const p of c.byPerson) {
      for (const item of p.items) {
        const who = item.owner === 'me' ? `אני ל-${p.personName}` : `${p.personName} לי`
        lines.push(`• ${who}: ${item.content} (${SOURCE_LABELS[item.source] ?? item.source})`)
      }
    }
  }
  if (c.mine.length > 0) {
    lines.push('', 'זכור לטפל:')
    for (const item of c.mine) lines.push(`• אמרת ל-${item.personName}: ${item.content}`)
  }
  return lines
}

export interface MorningBriefTask {
  title: string
  priority: string
  done: boolean
  dueDate: string | null
}

/**
 * Build the Hebrew morning schedule text used as the lightweight template
 * and as context when morning_briefing is routed to an ABC agent (e.g. יועץ יומן).
 */
export function formatMorningBriefingContext(
  today: string,
  events: MorningBriefEvent[],
  dueTasks: MorningBriefTask[],
  /** Pre-formatted finance lines (warn-level insights only) — omitted when nothing stands out. */
  financeLines: string[] = [],
  options?: {
    includeDueTasks?: boolean
    coolingFlags?: MorningCoolingFlag[]
    commitments?: MorningCommitments
    /** Pre-formatted harness lines — cross-domain links no single section can show. */
    harnessLines?: string[]
    /** Open items others owe me that are due today or late. */
    waiting?: MorningWaiting
  },
): string {
  const includeDueTasks = options?.includeDueTasks !== false
  const flags = options?.coolingFlags ?? []
  const flagFor = (e: MorningBriefEvent) =>
    flags.find((f) => (e.id && f.calendarEventId === e.id) || (!f.calendarEventId && f.title === e.title))
  const tasks = includeDueTasks ? dueTasks : []
  const extra = [...commitmentLines(options?.commitments), ...waitingLines(options?.waiting)]
  const harnessLines = options?.harnessLines ?? []
  const lines: string[] = ['📅 סיכום הבוקר – ' + today]
  if (
    events.length === 0 &&
    tasks.length === 0 &&
    financeLines.length === 0 &&
    extra.length === 0 &&
    harnessLines.length === 0
  ) {
    lines.push(includeDueTasks ? 'אין אירועים או משימות מועדות להיום.' : 'אין אירועים להיום.')
  } else {
    if (events.length > 0) {
      lines.push('', 'אירועים:')
      for (const e of events) {
        lines.push(`• ${formatLocalRange(e.start, e.end)} – ${e.title}${coolingSuffix(flagFor(e))}`)
      }
    }
    lines.push(...extra)
    if (tasks.length > 0) {
      lines.push('', 'משימות להיום:')
      for (const t of tasks) {
        lines.push(`• [${t.priority}] ${t.title}`)
      }
    }
    if (financeLines.length > 0) {
      lines.push('', 'פיננסים:', ...financeLines)
    }
    if (harnessLines.length > 0) {
      lines.push('', 'קישורים בין תחומים:', ...harnessLines)
    }
  }
  return lines.join('\n').slice(0, 4000)
}
