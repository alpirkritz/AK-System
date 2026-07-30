/** Shared shape for morning briefing template + agent context. */
export interface MorningBriefEvent {
  start: string
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
): string {
  const lines: string[] = ['📅 סיכום הבוקר – ' + today]
  if (events.length === 0 && dueTasks.length === 0) {
    lines.push('אין אירועים או משימות מועדות להיום.')
  } else {
    if (events.length > 0) {
      lines.push('', 'אירועים:')
      for (const e of events) {
        const time = e.start.includes('T') ? e.start.slice(11, 16) : 'כל היום'
        lines.push(`• ${time} – ${e.title}`)
      }
    }
    if (dueTasks.length > 0) {
      lines.push('', 'משימות להיום:')
      for (const t of dueTasks) {
        lines.push(`• [${t.priority}] ${t.title}`)
      }
    }
  }
  return lines.join('\n').slice(0, 4000)
}
