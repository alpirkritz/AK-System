/**
 * Agent episodes (spec: docs/specs/agent-episodes.md): every delivered agent reply, reduced to a
 * few lines and tagged with the entities it was about, so the next run knows what the owner was
 * already told. Deterministic — no LLM.
 */
import { desc, gte, lt } from 'drizzle-orm'
import { agentEpisodes, getDb, queryRows, runMutation } from '@ak-system/database'
import { extractAnchors, type EntityRef } from './memory-relevance'

type Db = ReturnType<typeof getDb>

export const EPISODE_SUMMARY_MAX = 400
export const EPISODE_BLOCK_CAP = 1500
export const EPISODE_BLOCK_COUNT = 6
export const EPISODE_WINDOW_HOURS = 24
export const EPISODE_RETENTION_DAYS = 14

export type EpisodeTrigger = 'chat' | 'schedule' | 'event'

export interface Episode {
  id: string
  agentId: string
  channel: string
  trigger: string
  summary: string
  anchors: EntityRef[]
  createdAt: string
}

/** First 3 heading/bullet lines (or first lines) of a reply, markdown stripped, ≤400 chars. */
export function summarizeReply(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const structural = lines.filter((l) => /^(#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(l))
  const picked = (structural.length >= 2 ? structural : lines).slice(0, 3)
  const clean = picked
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
    )
    .join(' · ')
  return clean.length > EPISODE_SUMMARY_MAX ? `${clean.slice(0, EPISODE_SUMMARY_MAX - 1)}…` : clean
}

export async function recordEpisode(
  input: { agentId: string; channel: string; trigger: EpisodeTrigger; reply: string; insightIds?: string[] },
  db: Db = getDb(),
): Promise<void> {
  const summary = summarizeReply(input.reply)
  if (!summary) return
  try {
    const anchors = await extractAnchors(db, [input.reply])
    const now = new Date().toISOString()
    await runMutation(
      db.insert(agentEpisodes).values({
        id: `ep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        agentId: input.agentId,
        channel: input.channel,
        trigger: input.trigger,
        summary,
        anchors: JSON.stringify(anchors),
        insightIds: JSON.stringify(input.insightIds ?? []),
        createdAt: now,
      }),
    )
  } catch (err) {
    console.warn('[agent-episodes] record failed', err)
  }
}

export async function listEpisodes(db: Db, sinceHours = EPISODE_WINDOW_HOURS, now = new Date()): Promise<Episode[]> {
  const since = new Date(now.getTime() - sinceHours * 3600_000).toISOString()
  const rows = await queryRows<{ id: string; agentId: string; channel: string; trigger: string; summary: string; anchors: string | null; createdAt: string }>(
    db.select().from(agentEpisodes).where(gte(agentEpisodes.createdAt, since)).orderBy(desc(agentEpisodes.createdAt)).limit(200),
  )
  return rows.map((r) => {
    let anchors: EntityRef[] = []
    try {
      anchors = r.anchors ? (JSON.parse(r.anchors) as EntityRef[]) : []
    } catch {
      anchors = []
    }
    return { id: r.id, agentId: r.agentId, channel: r.channel, trigger: r.trigger, summary: r.summary, anchors, createdAt: r.createdAt }
  })
}

const key = (a: { kind: string; entityId: string }) => `${a.kind}:${a.entityId}`

/** Pure renderer — exported for tests. Overlapping episodes first, then most recent. */
export function renderEpisodesBlock(
  episodes: Episode[],
  runAnchors: EntityRef[],
  displayName: (agentId: string) => string = (id) => id,
  timezone = process.env.TIMEZONE || 'Asia/Jerusalem',
): string {
  if (episodes.length === 0) return ''
  const wanted = new Set(runAnchors.map(key))
  const overlap = (e: Episode) => e.anchors.filter((a) => wanted.has(key(a))).length
  const ranked = [...episodes]
    .sort((a, b) => overlap(b) - overlap(a) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, EPISODE_BLOCK_COUNT)
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false })
  let text = [
    '## מה כבר נאמר לך (24 שעות)',
    'Already delivered to the owner. Do NOT present these as new — say what changed since, or skip them.',
  ].join('\n')
  for (const e of ranked) {
    const line = `- ${fmt.format(new Date(e.createdAt))} · ${displayName(e.agentId)} · ${e.summary}`
    if (text.length + line.length + 1 > EPISODE_BLOCK_CAP) break
    text += `\n${line}`
  }
  return text
}

export async function buildEpisodesBlock(
  input: { texts: string[]; displayName?: (agentId: string) => string },
  db: Db = getDb(),
): Promise<string> {
  try {
    const [episodes, anchors] = await Promise.all([listEpisodes(db), extractAnchors(db, input.texts)])
    return renderEpisodesBlock(episodes, anchors, input.displayName)
  } catch (err) {
    console.warn('[agent-episodes] block unavailable', err)
    return ''
  }
}

export async function pruneEpisodes(db: Db, days = EPISODE_RETENTION_DAYS, now = new Date()): Promise<void> {
  const cut = new Date(now.getTime() - days * 86400000).toISOString()
  await runMutation(db.delete(agentEpisodes).where(lt(agentEpisodes.createdAt, cut)))
}
