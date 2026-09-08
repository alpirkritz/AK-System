export type NotionSummaryBlock =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'labeled'; label: string; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; marker: string; text: string }
  | { kind: 'paragraph'; text: string }

const SECTION_HINT =
  /^(executive briefing|summary|summaries|action items?|actions|todos?|decisions?|key points?|takeaways?|insights?|questions?|follow[- ]?ups?|next steps?|notes?|topics?|agenda|participants?|attendees?|risks?|conclusions?|outcomes?|perspectives?|סיכום|סיכומים|משימות|פעולות|החלטות|נקודות|תובנות|שאלות|הערות|נושאים|משתתפים|הצעדים|סדר יום)/i

const SUBSECTION_LABEL =
  /^(topic|conclusion|decision|action|risk|question|insight|item|point|נושא|החלטה|תובנה|משימה|פעולה)\s*\d+/i

function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`/g, '').trim()
}

function isTitleCaseLine(line: string): boolean {
  const words = line
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
  if (words.length === 0 || words.length > 10) return false
  const latin = words.filter((w) => /^[A-Za-z]/.test(w))
  if (latin.length < 2) return false
  const capped = latin.filter((w) => /^[A-Z]/.test(w))
  return capped.length / latin.length >= 0.65
}

function looksLikeHeading(line: string): boolean {
  if (line.length > 72) return false
  if (/[.?!]$/.test(line)) return false
  if (SECTION_HINT.test(line)) return true
  if (isTitleCaseLine(line)) return true
  return false
}

function splitLabeled(line: string): { label: string; rest: string } | null {
  const idx = line.indexOf(': ')
  if (idx < 2 || idx > 60) return null
  const label = line.slice(0, idx).trim()
  const rest = line.slice(idx + 2).trim()
  if (!label || !rest) return null
  if (/^\d{1,2}:\d{2}/.test(line)) return null
  return { label, rest }
}

/**
 * Turn flattened Notion AI notes into scannable blocks. The extractor stores
 * headings and bullets as plain lines (no markdown), plus `Label: paragraph`
 * fields from the executive-briefing template.
 */
export function parseNotionSummary(body: string): NotionSummaryBlock[] {
  const blocks: NotionSummaryBlock[] = []

  for (const raw of body.split('\n')) {
    const line = stripInline(raw)
    if (!line) continue
    const isFirst = blocks.length === 0

    const headingMd = /^(#{1,6})\s+(.*)$/.exec(line)
    if (headingMd) {
      blocks.push({
        kind: 'heading',
        level: headingMd[1]!.length === 1 ? 1 : 2,
        text: headingMd[2]!.trim(),
      })
      continue
    }

    const bullet = /^[-*+•–]\s+(.*)$/.exec(line)
    if (bullet) {
      blocks.push({ kind: 'bullet', text: bullet[1]!.trim() })
      continue
    }

    const checkbox = /^[☐☑✓✔]\s+(.*)$/.exec(line)
    if (checkbox) {
      blocks.push({ kind: 'bullet', text: checkbox[1]!.trim() })
      continue
    }

    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      blocks.push({ kind: 'numbered', marker: numbered[1]!, text: numbered[2]!.trim() })
      continue
    }

    const labeled = splitLabeled(line)
    if (labeled) {
      if (SUBSECTION_LABEL.test(labeled.label) || (labeled.rest.length <= 90 && !/[.?!]/.test(labeled.rest))) {
        blocks.push({ kind: 'heading', level: 2, text: `${labeled.label}: ${labeled.rest}` })
      } else {
        blocks.push({ kind: 'labeled', label: labeled.label, text: labeled.rest })
      }
      continue
    }

    const wordCount = line.split(/\s+/).length
    const looksLikeClock = /^\d{1,2}:\d{2}/.test(line)
    if (
      !looksLikeClock &&
      (looksLikeHeading(line) ||
        (isFirst && line.length <= 56 && wordCount <= 6 && !/[.?!]$/.test(line)))
    ) {
      blocks.push({ kind: 'heading', level: 1, text: line })
      continue
    }

    blocks.push({ kind: 'paragraph', text: line })
  }

  return blocks
}

export function headingEmoji(text: string): string {
  const t = text.toLowerCase()
  if (/action|todo|משימ|פעול/.test(t)) return '✅'
  if (/decision|conclusion|החלט/.test(t)) return '🎯'
  if (/insight|takeaway|תובנ/.test(t)) return '💡'
  if (/question|שאל/.test(t)) return '❓'
  if (/topic|agenda|נושא|סדר יום/.test(t)) return '🗂'
  if (/risk|friction|סיכון/.test(t)) return '⚠️'
  if (/participant|attendee|משתתפ/.test(t)) return '👥'
  if (/briefing|summary|outcome|סיכום/.test(t)) return '📋'
  return '•'
}

export const NOTION_SUMMARY_PREVIEW_BLOCKS = 6
