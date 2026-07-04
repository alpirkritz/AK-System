import { getDb, hugoInstructions, memories, queryRows, desc, eq } from '@ak-system/database'

/** Max characters of memory injected into a prompt, to avoid bloating token usage. */
const MEMORY_CHAR_CAP = 4000

type MemoryRow = {
  id: string
  content: string
  kind: string
  source: string
  pinned: boolean | number
  createdAt: string
  updatedAt: string
}

/**
 * Build the persistent-memory prompt block: user's standing instructions plus
 * pinned + recent memories/knowledge. Injected into every agent run so Hugo (and
 * the specialists) follow the user's preferences across sessions and deploys.
 * Returns '' when there is nothing to inject.
 */
export async function getMemoryPromptBlock(): Promise<string> {
  try {
    const db = getDb()

    const instrRows = await queryRows<{ content: string; enabled: boolean | number }>(
      db.select().from(hugoInstructions).where(eq(hugoInstructions.id, 'default')).limit(1),
    )
    const instr = instrRows[0]
    const instructionsText =
      instr && (instr.enabled === true || instr.enabled === 1) ? (instr.content || '').trim() : ''

    const memRows = await queryRows<MemoryRow>(
      db.select().from(memories).orderBy(desc(memories.pinned), desc(memories.updatedAt)).limit(60),
    )

    if (!instructionsText && memRows.length === 0) return ''

    const parts: string[] = ['## הוראות וזיכרון קבועים מהמשתמש (User instructions & memory)']
    parts.push(
      'These persist across sessions and take priority over defaults. Follow the instructions; use the memory/knowledge as context.',
    )

    let budget = MEMORY_CHAR_CAP

    if (instructionsText) {
      const block = instructionsText.slice(0, budget)
      budget -= block.length
      parts.push('', '### הוראות קבועות (standing instructions)', block)
    }

    if (budget > 200 && memRows.length > 0) {
      const lines: string[] = []
      for (const m of memRows) {
        const label = m.kind === 'knowledge' ? 'ידע' : m.kind === 'instruction' ? 'הוראה' : 'זיכרון'
        const pin = m.pinned === true || m.pinned === 1 ? '📌 ' : ''
        const line = `- ${pin}[${label}] ${m.content.trim()}`
        if (line.length > budget) break
        lines.push(line)
        budget -= line.length + 1
      }
      if (lines.length > 0) {
        parts.push('', '### זיכרון וידע (memories & knowledge)', ...lines)
      }
    }

    return parts.join('\n')
  } catch (err) {
    console.warn('[agent-memory] failed to build memory block:', err)
    return ''
  }
}
