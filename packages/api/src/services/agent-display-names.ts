import { eq } from 'drizzle-orm'
import { getDb, queryRows, userSettings } from '@ak-system/database'
import { listAgentSummaries, type AgentSummary } from '../agents-meta'

const SETTINGS_ID = 'default'
const MAX_DISPLAY_NAME_LEN = 40

/** Split "טמפו | tempo" → display "טמפו", aliases ["טמפו", "tempo"]. */
function parseDisplayNameValue(raw: string): { display: string; aliases: string[] } {
  const parts = raw
    .split(/[|/]/)
    .map((p) => p.trim())
    .filter(Boolean)
  const display = (parts[0] ?? raw.trim()).slice(0, MAX_DISPLAY_NAME_LEN)
  const aliases = [...new Set(parts.map((p) => p.slice(0, MAX_DISPLAY_NAME_LEN)))]
  return { display, aliases: aliases.length ? aliases : [display] }
}

function parseDisplayNamesMap(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [id, name] of Object.entries(parsed)) {
      if (typeof name === 'string' && name.trim()) {
        out[id] = parseDisplayNameValue(name.trim()).display
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Raw stored values (may include alias segments separated by |). */
export async function getAgentDisplayNamesRaw(): Promise<Record<string, string>> {
  try {
    const db = getDb()
    const rows = await queryRows<{ agentDisplayNames: string | null }>(
      db
        .select({ agentDisplayNames: userSettings.agentDisplayNames })
        .from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID))
        .limit(1),
    )
    const raw = rows[0]?.agentDisplayNames
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [id, name] of Object.entries(parsed)) {
      if (typeof name === 'string' && name.trim()) out[id] = name.trim()
    }
    return out
  } catch {
    return {}
  }
}

export type AgentWithDisplayName = AgentSummary & {
  defaultName: string
}

/** Read custom display names from DB (display label only). */
export async function getAgentDisplayNamesMap(): Promise<Record<string, string>> {
  try {
    const db = getDb()
    const rows = await queryRows<{ agentDisplayNames: string | null }>(
      db
        .select({ agentDisplayNames: userSettings.agentDisplayNames })
        .from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID))
        .limit(1),
    )
    return parseDisplayNamesMap(rows[0]?.agentDisplayNames)
  } catch (err) {
    console.warn('[agent-display-names] get failed:', err)
    return {}
  }
}

/** Resolve display name: custom override, else markdown default. */
export function applyDisplayName(
  agent: AgentSummary,
  names: Record<string, string>,
): AgentWithDisplayName {
  const custom = names[agent.id]
  return {
    ...agent,
    defaultName: agent.name,
    name: custom ?? agent.name,
  }
}

/** All agents with custom display names applied. */
export async function listAgentsWithDisplayNames(): Promise<AgentWithDisplayName[]> {
  const names = await getAgentDisplayNamesMap()
  return listAgentSummaries().map((a) => applyDisplayName(a, names))
}

/** Single agent display name (async). */
export async function resolveAgentDisplayName(agentId: string): Promise<string> {
  const agents = listAgentSummaries()
  const agent = agents.find((a) => a.id === agentId)
  if (!agent) return agentId
  const names = await getAgentDisplayNamesMap()
  return names[agentId] ?? agent.name
}

/** Persist or clear a custom display name. Pass null/empty to reset. */
export async function setAgentDisplayName(
  agentId: string,
  displayName: string | null,
): Promise<Record<string, string>> {
  const agents = listAgentSummaries()
  if (!agents.some((a) => a.id === agentId)) {
    throw new Error('סוכן לא נמצא')
  }

  const trimmed = displayName?.trim() ?? ''
  const current = await getAgentDisplayNamesRaw()
  const next = { ...current }
  if (trimmed) {
    const { display, aliases } = parseDisplayNameValue(trimmed)
    next[agentId] = aliases.length > 1 ? aliases.join(' | ') : display
  } else delete next[agentId]

  const db = getDb()
  const now = new Date().toISOString()
  const stored = Object.keys(next).length > 0 ? JSON.stringify(next) : null

  const rows = await queryRows<{ id: string }>(
    db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
  )

  if (rows[0]) {
    await db
      .update(userSettings)
      .set({ agentDisplayNames: stored, updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({
      id: SETTINGS_ID,
      agentDisplayNames: stored,
      updatedAt: now,
    })
  }

  return next
}

/** Build alias map (lowercase alias -> agentId) for command parsing. */
export function buildCustomAgentAliases(names: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [agentId, stored] of Object.entries(names)) {
    const { aliases } = parseDisplayNameValue(stored)
    for (const alias of aliases) {
      const key = alias.toLowerCase()
      if (key) out[key] = agentId
      const firstWord = key.split(/\s+/)[0]
      if (firstWord && firstWord !== key) out[firstWord] = agentId
    }
  }
  return out
}
