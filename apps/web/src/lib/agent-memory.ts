import { getDb, hugoInstructions, memories, queryRows, desc, eq } from '@ak-system/database'

/**
 * Max characters of memory injected into a prompt. Raised 4000 → 12000: user
 * instructions were being silently cut mid-sentence, which read as "the agent
 * ignores my instructions". Gemini context is not the constraint here.
 */
const MEMORY_CHAR_CAP = 12000

/** Marker appended when standing instructions still exceed the budget. */
export const MEMORY_TRUNCATION_MARKER =
  '\n[⚠️ ההוראות הקבועות נחתכו כאן — קצר אותן בעמוד /memory כדי שכולן ייכנסו]'

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
 * Pure composition — exported for tests.
 * Truncation never cuts mid-line and always leaves an explicit marker.
 */
export function composeMemoryPromptBlock(
  instructionsText: string,
  memRows: Array<Pick<MemoryRow, 'content' | 'kind' | 'pinned'>>,
  charCap: number = MEMORY_CHAR_CAP,
): string {
  if (!instructionsText && memRows.length === 0) return ''

  const parts: string[] = ['## הוראות וזיכרון קבועים מהמשתמש (User instructions & memory)']
  parts.push(
    'These persist across sessions and take priority over defaults. Follow the instructions; use the memory/knowledge as context.',
  )

  let budget = charCap

  if (instructionsText) {
    let block = instructionsText
    if (block.length > budget) {
      const cut = block.lastIndexOf('\n', budget)
      block = block.slice(0, cut > budget / 2 ? cut : budget) + MEMORY_TRUNCATION_MARKER
    }
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

    return composeMemoryPromptBlock(instructionsText, memRows)
  } catch (err) {
    console.warn('[agent-memory] failed to build memory block:', err)
    return ''
  }
}
