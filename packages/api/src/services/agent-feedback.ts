/**
 * Agent feedback loop (spec: docs/specs/agent-feedback-loop.md).
 *
 * A correction about an agent is stored with a suggested one-line rule. Applying it creates an
 * instruction memory linked to `agent:<agentId>`, which `selectMemoriesForRun` injects into that
 * agent's runs only. Agent cards (A_Agents/*.md) are never edited.
 */
import { and, desc, eq } from 'drizzle-orm'
import {
  agentFeedback,
  memories,
  memoryLinks,
  queryRows,
  runMutation,
  type getDb,
} from '@ak-system/database'
import { geminiTextModel, type TextModel } from '../lib/gemini-text'
import { addMemoryLinks, clearMemoryRelevanceCache } from './memory-relevance'

type Db = ReturnType<typeof getDb>

export type FeedbackStatus = 'pending' | 'applied' | 'rejected'

export interface FeedbackRow {
  id: string
  agentId: string
  feedback: string
  channel: string | null
  suggestedRule: string | null
  status: string
  memoryId: string | null
  createdAt: string
  updatedAt: string
}

const RULE_MAX = 200

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function suggestRulePrompt(agentId: string, feedback: string): string {
  return [
    `The user complained about how the automated agent "${agentId}" behaved:`,
    `"""${feedback}"""`,
    'Rewrite this complaint as ONE imperative rule, in Hebrew, that the agent should follow from now on.',
    `At most ${RULE_MAX} characters. No preamble, no quotes, no bullet — just the rule.`,
  ].join('\n')
}

export async function recordAgentFeedback(
  db: Db,
  input: { agentId: string; feedback: string; channel?: string | null },
  model: TextModel = geminiTextModel(),
): Promise<FeedbackRow> {
  const now = new Date().toISOString()
  const raw = await model(suggestRulePrompt(input.agentId, input.feedback))
  const suggestedRule = raw ? raw.replace(/^["'«\-•\s]+|["'»\s]+$/g, '').slice(0, RULE_MAX) || null : null
  const row = {
    id: genId('afb'),
    agentId: input.agentId,
    feedback: input.feedback,
    channel: input.channel ?? null,
    suggestedRule,
    status: 'pending',
    memoryId: null,
    createdAt: now,
    updatedAt: now,
  }
  await runMutation(db.insert(agentFeedback).values(row))
  return row
}

export async function listAgentFeedback(
  db: Db,
  filter: { agentId?: string; status?: FeedbackStatus | 'all' } = {},
): Promise<FeedbackRow[]> {
  const status = filter.status ?? 'pending'
  const conds = [
    filter.agentId ? eq(agentFeedback.agentId, filter.agentId) : undefined,
    status !== 'all' ? eq(agentFeedback.status, status) : undefined,
  ].filter(Boolean)
  return queryRows<FeedbackRow>(
    db
      .select()
      .from(agentFeedback)
      .where(conds.length ? and(...(conds as Parameters<typeof and>)) : undefined)
      .orderBy(desc(agentFeedback.createdAt))
      .limit(200),
  )
}

/** Turn a feedback row into an agent-scoped standing rule. Returns the new memory id. */
export async function applyAgentFeedback(db: Db, id: string, rule: string): Promise<{ memoryId: string }> {
  const [row] = await queryRows<FeedbackRow>(db.select().from(agentFeedback).where(eq(agentFeedback.id, id)).limit(1))
  if (!row) throw new Error('feedback not found')
  if (row.status === 'applied' && row.memoryId) return { memoryId: row.memoryId }
  const content = rule.trim()
  if (!content) throw new Error('rule is required')
  const now = new Date().toISOString()
  const memoryId = genId('mem')
  await runMutation(
    db.insert(memories).values({
      id: memoryId,
      content,
      kind: 'instruction',
      source: 'manual',
      pinned: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
  )
  await addMemoryLinks(db, memoryId, [{ kind: 'agent', entityId: row.agentId }], 'manual')
  await runMutation(
    db.update(agentFeedback).set({ status: 'applied', memoryId, updatedAt: now }).where(eq(agentFeedback.id, id)),
  )
  return { memoryId }
}

export async function rejectAgentFeedback(db: Db, id: string): Promise<void> {
  await runMutation(
    db
      .update(agentFeedback)
      .set({ status: 'rejected', updatedAt: new Date().toISOString() })
      .where(eq(agentFeedback.id, id)),
  )
}

export interface AgentRule {
  memoryId: string
  content: string
  enabled: boolean
  updatedAt: string
}

/** Instruction memories linked to one agent, enabled or not. */
export async function listAgentRules(db: Db, agentId: string): Promise<AgentRule[]> {
  const rows = await queryRows<{ id: string; content: string; status: string; updatedAt: string }>(
    db
      .select({ id: memories.id, content: memories.content, status: memories.status, updatedAt: memories.updatedAt })
      .from(memories)
      .innerJoin(memoryLinks, eq(memoryLinks.memoryId, memories.id))
      .where(and(eq(memoryLinks.entityKind, 'agent'), eq(memoryLinks.entityId, agentId)))
      .orderBy(desc(memories.updatedAt)),
  )
  return rows.map((r) => ({ memoryId: r.id, content: r.content, enabled: r.status === 'active', updatedAt: r.updatedAt }))
}

export async function setAgentRuleEnabled(db: Db, memoryId: string, enabled: boolean): Promise<void> {
  await runMutation(
    db
      .update(memories)
      .set({ status: enabled ? 'active' : 'disabled', updatedAt: new Date().toISOString() })
      .where(eq(memories.id, memoryId)),
  )
  clearMemoryRelevanceCache(db)
}
