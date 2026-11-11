const TASK_HEADING =
  /(?:תזכורות|reminders|משימות לתאריך יעד היום|משימות בפיגור|משימות קרובות|משימות להיום|tasks — due today|tasks — overdue|tasks — soon)/i

const TASK_LINE =
  /(?:משימות לתאריך יעד|משימות בפיגור|משימות קרובות|משימות להיום|tasks — due today|personal to-do|dt - action items|con action items|daz tasks)/i

function isHeading(line: string): boolean {
  const t = line.trim()
  return /^#{1,3}\s+\S/.test(t) || /^\*{2}.+\*{2}\s*$/.test(t) || /^[*•-]\s+\*{2}.+\*{2}\s*$/.test(t)
}

/**
 * Drop task-list sections copied from an earlier יועץ יומן reply.
 * Meeting lines stay. Used on chat history so a fresh run cannot replay the old dump.
 */
export function stripCalendarTaskEcho(text: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (isHeading(line) && TASK_HEADING.test(line)) {
      skipping = true
      continue
    }
    if (skipping && isHeading(line) && !TASK_HEADING.test(line)) {
      skipping = false
    }
    if (skipping) continue
    if (TASK_LINE.test(line)) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
