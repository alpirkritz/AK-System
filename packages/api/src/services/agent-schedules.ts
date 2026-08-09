import { eq } from 'drizzle-orm'
import {
  agentSchedules,
  agentTriggers,
  getDb,
  notificationPreferences,
  queryRows,
  runMutation,
  userSettings,
} from '@ak-system/database'
import {
  DEFAULT_SCHEDULE_TIMES,
  getDefaultScheduleTimes,
  getDefaultTriggerMessage,
  parseJsonTimes,
  stringifyJsonTimes,
} from '../agents-meta'
import { NOTIFICATION_TYPES, upsertNotificationPreference } from './notification-preferences'

type Db = ReturnType<typeof getDb>
type ScheduleRow = typeof agentSchedules.$inferSelect

const SETTINGS_ID = 'default'

/**
 * Event seeded on first migration so meeting prep works without the user
 * having to discover the routing UI first.
 */
const SEED_EVENT_ROUTING: Record<string, string> = {
  pre_meeting_briefing: '04_meeting_prep_herald',
}

export interface AgentScheduleConfig {
  agentId: string
  name: string
  role: string
  enabled: boolean
  scheduleTimes: string[]
  triggerMessage: string | null
  defaultTriggerMessage: string
  suggestedScheduleTimes: string[]
  subscribedEvents: string[]
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
}

export interface RoutableEventSummary {
  typeId: string
  label: string
  description: string
  schedulable: boolean
  scheduleTimes: string[]
  routedAgentId: string | null
  suggestedAgentId: string | null
}

/** Event types that can hand their run over to an agent. */
export function listRoutableEventTypes() {
  return NOTIFICATION_TYPES.filter((t) => t.routable)
}

export function isRoutableEvent(typeId: string): boolean {
  return listRoutableEventTypes().some((t) => t.id === typeId)
}

async function getScheduleRow(db: Db, agentId: string): Promise<ScheduleRow | null> {
  const rows = await queryRows<ScheduleRow>(
    db.select().from(agentSchedules).where(eq(agentSchedules.agentId, agentId)).limit(1),
  )
  return rows[0] ?? null
}

async function listScheduleRows(db: Db): Promise<ScheduleRow[]> {
  return queryRows<ScheduleRow>(db.select().from(agentSchedules))
}

function rowToConfig(
  agent: { id: string; name: string; role: string },
  row: ScheduleRow | undefined,
  subscribedEvents: string[],
): AgentScheduleConfig {
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    enabled: Boolean(row?.enabled),
    scheduleTimes: row ? parseJsonTimes(row.scheduleTimes) : [],
    triggerMessage: row?.triggerMessage ?? null,
    defaultTriggerMessage: getDefaultTriggerMessage(agent.id),
    suggestedScheduleTimes: getDefaultScheduleTimes(agent.id),
    subscribedEvents,
    lastRunAt: row?.lastRunAt ?? null,
    lastRunStatus: row?.lastRunStatus ?? null,
    lastRunError: row?.lastRunError ?? null,
  }
}

function routingFromPrefRows(
  rows: (typeof notificationPreferences.$inferSelect)[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const agentId = row.agentId?.trim()
    if (agentId && isRoutableEvent(row.typeId)) map.set(row.typeId, agentId)
  }
  return map
}

/** Which agent each routable event currently hands off to. */
async function getEventRoutingMap(db: Db): Promise<Map<string, string>> {
  const rows = await queryRows<typeof notificationPreferences.$inferSelect>(
    db.select().from(notificationPreferences),
  )
  return routingFromPrefRows(rows)
}

/**
 * Full agent configuration for the management UI: one query for every agent,
 * its clock schedule and the events routed to it.
 */
export async function listAgentConfigs(
  agents: { id: string; name: string; role: string }[],
  db: Db = getDb(),
): Promise<{ agents: AgentScheduleConfig[]; events: RoutableEventSummary[] }> {
  const [rows, prefRows] = await Promise.all([
    listScheduleRows(db),
    queryRows<typeof notificationPreferences.$inferSelect>(
      db.select().from(notificationPreferences),
    ),
  ])
  const rowByAgent = new Map(rows.map((r) => [r.agentId, r]))
  const prefByType = new Map(prefRows.map((r) => [r.typeId, r]))
  const routing = routingFromPrefRows(prefRows)

  const eventsByAgent = new Map<string, string[]>()
  for (const [typeId, agentId] of routing) {
    const list = eventsByAgent.get(agentId) ?? []
    list.push(typeId)
    eventsByAgent.set(agentId, list)
  }

  return {
    agents: agents.map((a) =>
      rowToConfig(a, rowByAgent.get(a.id), eventsByAgent.get(a.id) ?? []),
    ),
    events: listRoutableEventTypes().map((t) => {
      const pref = prefByType.get(t.id)
      const stored = parseJsonTimes(pref?.scheduleTimes)
      return {
        typeId: t.id,
        label: t.label,
        description: t.description,
        schedulable: Boolean(t.schedulable),
        scheduleTimes:
          stored.length > 0 ? stored : t.defaultTime ? [t.defaultTime] : [],
        routedAgentId: routing.get(t.id) ?? null,
        suggestedAgentId: t.suggestedAgentId ?? null,
      }
    }),
  }
}

export interface SetScheduleInput {
  agentId: string
  enabled?: boolean
  scheduleTimes?: string[]
  triggerMessage?: string | null
}

/** Create or update an agent's clock schedule, preserving last-run history. */
export async function setAgentSchedule(
  input: SetScheduleInput,
  db: Db = getDb(),
): Promise<ScheduleRow> {
  const prev = await getScheduleRow(db, input.agentId)
  const now = new Date().toISOString()

  const scheduleTimes =
    input.scheduleTimes ?? (prev ? parseJsonTimes(prev.scheduleTimes) : [])

  const row = {
    agentId: input.agentId,
    enabled: input.enabled ?? Boolean(prev?.enabled),
    scheduleTimes: stringifyJsonTimes(scheduleTimes),
    triggerMessage:
      input.triggerMessage !== undefined
        ? input.triggerMessage
        : (prev?.triggerMessage ?? null),
    lastRunAt: prev?.lastRunAt ?? null,
    lastRunStatus: prev?.lastRunStatus ?? null,
    lastRunError: prev?.lastRunError ?? null,
    updatedAt: now,
  }

  if (prev) {
    await runMutation(
      db.update(agentSchedules).set(row).where(eq(agentSchedules.agentId, input.agentId)),
    )
  } else {
    await runMutation(db.insert(agentSchedules).values(row))
  }

  return row as ScheduleRow
}

/**
 * Stamp a run against the agent regardless of which path triggered it. The
 * scheduled cron consults this to skip an agent an event already ran this slot,
 * which is what keeps a doubly-wired agent from firing twice.
 */
export async function markAgentRan(
  agentId: string,
  status: 'ok' | 'error',
  error?: string,
  db: Db = getDb(),
): Promise<void> {
  const now = new Date().toISOString()
  const prev = await getScheduleRow(db, agentId)

  if (prev) {
    await runMutation(
      db
        .update(agentSchedules)
        .set({
          lastRunAt: now,
          lastRunStatus: status,
          lastRunError: error ?? null,
          updatedAt: now,
        })
        .where(eq(agentSchedules.agentId, agentId)),
    )
    return
  }

  await runMutation(
    db.insert(agentSchedules).values({
      agentId,
      enabled: false,
      scheduleTimes: '[]',
      triggerMessage: null,
      lastRunAt: now,
      lastRunStatus: status,
      lastRunError: error ?? null,
      updatedAt: now,
    }),
  )
}

/**
 * Point a routable event at an agent, or clear it. An event serves at most one
 * agent, so subscribing takes it over from whoever held it; unsubscribing only
 * clears the routing when this agent is the current owner.
 */
export async function setEventSubscription(
  input: { agentId: string; typeId: string; subscribed: boolean },
  db: Db = getDb(),
): Promise<{ typeId: string; routedAgentId: string | null }> {
  const rows = await queryRows<typeof notificationPreferences.$inferSelect>(
    db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.typeId, input.typeId))
      .limit(1),
  )
  const currentOwner = rows[0]?.agentId?.trim() || null

  if (!input.subscribed && currentOwner !== input.agentId) {
    return { typeId: input.typeId, routedAgentId: currentOwner }
  }

  const nextAgentId = input.subscribed ? input.agentId : null
  await upsertNotificationPreference({ typeId: input.typeId, agentId: nextAgentId })
  return { typeId: input.typeId, routedAgentId: nextAgentId }
}

/** Whether a run timestamp falls in the given calendar day + HH:MM slot. */
export function wasAgentRunInSlot(
  lastRunAt: string | null | undefined,
  slot: string,
  timezone: string,
): boolean {
  if (!lastRunAt) return false
  try {
    const dayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const slotFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const runDate = new Date(lastRunAt)
    return (
      dayFmt.format(runDate) === dayFmt.format(new Date()) &&
      slotFmt.format(runDate) === slot
    )
  } catch {
    return false
  }
}

/**
 * Whether this agent already completed a run in the current slot, whichever path
 * triggered it. Lets the event path stand down when the clock schedule already
 * ran the agent, and vice versa.
 */
export async function hasAgentRunInSlot(
  agentId: string,
  slot: string,
  timezone: string,
  db: Db = getDb(),
): Promise<boolean> {
  const row = await getScheduleRow(db, agentId)
  return row?.lastRunStatus === 'ok' && wasAgentRunInSlot(row.lastRunAt, slot, timezone)
}

/** Enabled agents whose schedule contains the given HH:MM slot. */
export async function listAgentsDueAtTime(
  time: string,
  db: Db = getDb(),
): Promise<ScheduleRow[]> {
  const rows = await queryRows<ScheduleRow>(
    db.select().from(agentSchedules).where(eq(agentSchedules.enabled, true)),
  )
  return rows.filter((row) => parseJsonTimes(row.scheduleTimes).includes(time))
}

async function readMigratedAt(db: Db): Promise<string | null> {
  const rows = await queryRows<{ agentSchedulesMigratedAt: string | null }>(
    db
      .select({ agentSchedulesMigratedAt: userSettings.agentSchedulesMigratedAt })
      .from(userSettings)
      .where(eq(userSettings.id, SETTINGS_ID))
      .limit(1),
  )
  return rows[0]?.agentSchedulesMigratedAt ?? null
}

async function writeMigratedAt(db: Db, at: string): Promise<void> {
  const existing = await queryRows<{ id: string }>(
    db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
  )
  if (existing[0]) {
    await runMutation(
      db
        .update(userSettings)
        .set({ agentSchedulesMigratedAt: at, updatedAt: at })
        .where(eq(userSettings.id, SETTINGS_ID)),
    )
  } else {
    await runMutation(
      db.insert(userSettings).values({
        id: SETTINGS_ID,
        agentSchedulesMigratedAt: at,
        updatedAt: at,
      }),
    )
  }
}

export interface MigrationResult {
  migrated: number
  seededEvents: string[]
  alreadyDone: boolean
}

/**
 * One-shot carry-over from the deprecated agent_triggers table, plus the
 * default meeting-prep routing. Guarded by a timestamp in user_settings so a
 * schedule the user later deletes is not resurrected on the next call. Safe to
 * call on every request; it short-circuits once the stamp is set.
 */
export async function migrateAgentSchedulesOnce(db: Db = getDb()): Promise<MigrationResult> {
  try {
    if (await readMigratedAt(db)) {
      return { migrated: 0, seededEvents: [], alreadyDone: true }
    }
  } catch (err) {
    // Column missing means the bootstrap ALTER has not run for this driver yet.
    console.warn('[agent-schedules] migration guard unreadable, skipping:', err)
    return { migrated: 0, seededEvents: [], alreadyDone: true }
  }

  let migrated = 0
  const seededEvents: string[] = []

  try {
    const legacy = await queryRows<typeof agentTriggers.$inferSelect>(
      db.select().from(agentTriggers),
    )
    const existing = await listScheduleRows(db)
    const known = new Set(existing.map((r) => r.agentId))

    for (const row of legacy) {
      if (known.has(row.agentId)) continue
      await runMutation(
        db.insert(agentSchedules).values({
          agentId: row.agentId,
          enabled: Boolean(row.enabled),
          scheduleTimes: row.scheduleTimes ?? '[]',
          triggerMessage: row.triggerMessage ?? null,
          lastRunAt: row.lastRunAt ?? null,
          lastRunStatus: row.lastRunStatus ?? null,
          lastRunError: row.lastRunError ?? null,
          updatedAt: new Date().toISOString(),
        }),
      )
      migrated++
    }
  } catch (err) {
    console.warn('[agent-schedules] legacy trigger copy failed:', err)
  }

  try {
    const routing = await getEventRoutingMap(db)
    for (const [typeId, agentId] of Object.entries(SEED_EVENT_ROUTING)) {
      if (routing.has(typeId)) continue
      await setEventSubscription({ agentId, typeId, subscribed: true }, db)
      seededEvents.push(typeId)
    }
  } catch (err) {
    console.warn('[agent-schedules] event seeding failed:', err)
  }

  try {
    await writeMigratedAt(db, new Date().toISOString())
  } catch (err) {
    console.warn('[agent-schedules] could not persist migration stamp:', err)
  }

  return { migrated, seededEvents, alreadyDone: false }
}

export { DEFAULT_SCHEDULE_TIMES }
