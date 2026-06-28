import { getDb, agentMessages, agentThreads, eq, desc } from '@ak-system/database'

export async function getAgentHistory(agentId: string, limit = 100) {
  const db = getDb()
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.agentId, agentId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit)
  return rows.reverse()
}

export async function saveAgentMessage(
  agentId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
) {
  const db = getDb()
  const id = 'amsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
  const now = new Date().toISOString()
  await db.insert(agentMessages).values({ id, agentId, role, content, createdAt: now })
}

export async function getCursorAgentId(agentId: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.agentId, agentId))
    .limit(1)
  return rows[0]?.cursorAgentId ?? null
}

export async function saveCursorAgentId(agentId: string, cursorAgentId: string) {
  const db = getDb()
  const now = new Date().toISOString()
  const existing = await getCursorAgentId(agentId)
  if (existing) {
    await db
      .update(agentThreads)
      .set({ cursorAgentId, updatedAt: now })
      .where(eq(agentThreads.agentId, agentId))
  } else {
    await db.insert(agentThreads).values({ agentId, cursorAgentId, updatedAt: now })
  }
}
