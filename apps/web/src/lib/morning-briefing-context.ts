import { formatLocalRange } from '@ak-system/api'

/** Shared shape for morning briefing template + agent context. */
export interface MorningBriefEvent {
  start: string
  end?: string | null
  title: string
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
): string {
  const lines: string[] = ['📅 סיכום הבוקר – ' + today]
  if (events.length === 0 && dueTasks.length === 0 && financeLines.length === 0) {
    lines.push('אין אירועים או משימות מועדות להיום.')
  } else {
    if (events.length > 0) {
      lines.push('', 'אירועים:')
      for (const e of events) {
        lines.push(`• ${formatLocalRange(e.start, e.end)} – ${e.title}`)
      }
    }
    if (dueTasks.length > 0) {
      lines.push('', 'משימות להיום:')
      for (const t of dueTasks) {
        lines.push(`• [${t.priority}] ${t.title}`)
      }
    }
    if (financeLines.length > 0) {
      lines.push('', 'פיננסים:', ...financeLines)
    }
  }
  return lines.join('\n').slice(0, 4000)
}
