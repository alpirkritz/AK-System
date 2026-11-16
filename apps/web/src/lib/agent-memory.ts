import { getDb, hugoInstructions, memories, queryRows, desc, eq } from '@ak-system/database'
import {
  buildRelevantMemoryBlock,
  MEMORY_CHAR_CAP,
  MEMORY_TRUNCATION_MARKER,
  renderMemoryBlock,
} from '@ak-system/api'

export { MEMORY_TRUNCATION_MARKER }

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
 * Pure composition of global memories only — exported for tests.
 * Truncation never cuts mid-line and always leaves an explicit marker.
 */
export function composeMemoryPromptBlock(
  instructionsText: string,
  memRows: Array<Pick<MemoryRow, 'content' | 'kind' | 'pinned'>>,
  charCap: number = MEMORY_CHAR_CAP,
): string {
  const global = memRows.map((m, i) => ({ id: String(i), updatedAt: '', ...m }))
  return renderMemoryBlock({ instructions: instructionsText, global, scoped: [] }, charCap).block
}

export interface MemoryRunContext {
  /** The run's message, recent turns and prefetched calendar text — the anchor sources. */
  texts: string[]
}

/**
 * Build the persistent-memory prompt block: standing instructions, global memories, and the
 * memories linked to the people / projects / workspaces / topics this run is about
 * (spec: hugo-entity-memory). Falls back to the pre-scoping "newest 60" block on any error.
 * Returns '' when there is nothing to inject.
 */
export async function getMemoryPromptBlock(context?: MemoryRunContext): Promise<string> {
  const db = getDb()
  try {
    const { block } = await buildRelevantMemoryBlock(db, { texts: context?.texts ?? [] })
    return block
  } catch (err) {
    console.warn('[agent-memory] scoped memory failed, falling back to newest memories:', err)
  }
  try {
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
