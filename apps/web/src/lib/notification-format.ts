export type NotificationBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; marker: string; text: string }
  | { kind: 'paragraph'; text: string }

/** Drop inline emphasis markers; the renderer conveys emphasis with styling. */
function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`/g, '').trim()
}

/**
 * Parse an agent brief into renderable blocks. Agents emit markdown, and WhatsApp
 * renders it, so showing raw `##` and `*` in the app reads as broken by
 * comparison. This covers the subset the agents actually produce — headings,
 * bullets, numbered steps — rather than pulling in a full markdown renderer.
 */
export function parseNotificationBody(body: string): NotificationBlock[] {
  const blocks: NotificationBlock[] = []

  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const depth = heading[1]!.length
      blocks.push({
        kind: 'heading',
        level: depth === 1 ? 1 : depth === 2 ? 2 : 3,
        text: stripInline(heading[2]!),
      })
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      blocks.push({ kind: 'bullet', text: stripInline(bullet[1]!) })
      continue
    }

    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      blocks.push({ kind: 'numbered', marker: numbered[1]!, text: stripInline(numbered[2]!) })
      continue
    }

    blocks.push({ kind: 'paragraph', text: stripInline(line) })
  }

  return blocks
}
