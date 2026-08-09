# Dynamic Agent Management

**Detected stack:** `next-trpc-monorepo`

## Goal

Make every agent discovered in `A_Agents/` configurable from the UI — enabled, time-scheduled, and/or subscribed to system events — without touching code. Remove the hardcoded schedulable-agent allowlist and give schedules and event routing one clear home each, so an agent can no longer fire twice for the same slot.

## User stories

- As Alpir, I want a new agent card dropped into `A_Agents/` to be schedulable from the UI immediately, so adding an agent never requires a code change.
- As Alpir, I want to configure an agent's daily times (for example 07:00 and 20:00) in one screen, so I stop maintaining schedules in two places.
- As Alpir, I want the meeting prep agent to run 15 minutes before every meeting without me scheduling a clock time, so prep is tied to the meeting and not to a fixed hour.
- As Alpir, I want to see which system events an agent is subscribed to and flip them on or off, so event routing is visible next to the schedule instead of buried in notification settings.
- As Alpir, I want an agent that is both scheduled and event-subscribed to run once per slot, so I stop getting duplicate morning briefs.
- As Alpir, I want my existing trigger configuration carried over automatically, so nothing silently stops running after the change.

## Acceptance criteria

- **Given** a new file `A_Agents/09_test_agent.md`, **when** I open `/agents/manage`, **then** the agent appears with a Configuration tab and can be enabled and scheduled.
- **Given** an agent with `enabled = true` and `scheduleTimes = ["07:00"]`, **when** `/api/cron/scheduled-agents` runs at 07:00, **then** the agent runs once and a second call in the same 07:00 slot skips it.
- **Given** `pre_meeting_briefing` is routed to `04_meeting_prep_herald`, **when** a calendar event starts in 15 minutes, **then** the meeting prep agent runs for that event with the meeting context.
- **Given** an agent that is both scheduled at 07:00 and subscribed to `morning_briefing` at 07:00, **when** both crons fire in that slot, **then** the agent runs once and the second path records a skip.
- **Given** rows in `agent_triggers` and an empty `agent_schedules`, **when** the agents API or the scheduled-agents cron first runs, **then** the rows are copied to `agent_schedules` and the migration does not repeat.
- **Given** an agent subscribed to an event, **when** I clear the checkbox in `/agents/manage`, **then** `notification_preferences.agent_id` for that event becomes null and the event falls back to its built-in template.
- **Given** no agent has ever been configured, **when** the one-time migration runs, **then** `pre_meeting_briefing` is seeded to `04_meeting_prep_herald` so meeting prep works out of the box.

## Data model

New table, mirrored in `packages/database/src/schema.pg.ts` (canonical) and `packages/database/src/schema.ts` (SQLite), with the bootstrap block added to `packages/database/src/index.ts`:

```ts
export const agentSchedules = sqliteTable('agent_schedules', {
  agentId: text('agent_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  scheduleTimes: text('schedule_times').notNull().default('[]'), // JSON ["07:00"]
  triggerMessage: text('trigger_message'),
  lastRunAt: text('last_run_at'),
  lastRunStatus: text('last_run_status'), // 'ok' | 'error'
  lastRunError: text('last_run_error'),
  updatedAt: text('updated_at').notNull(),
})
```

`user_settings` gains one nullable column, `agent_schedules_migrated_at TEXT`, added through the existing `USER_SETTINGS_COLUMNS` additive-ALTER list. It is the one-shot guard for the migration.

`agent_triggers` stays in both schemas and keeps its data, marked deprecated. Nothing reads or writes it after this change; it exists so a rollback has somewhere to fall back to.

`notification_preferences` is unchanged. Its existing `agent_id` and `trigger_message` columns remain the store for event-to-agent routing, so an event routes to at most one agent while an agent may serve many events.

Migration is additive only. No column is dropped or retyped.

## tRPC API

Router file: `packages/api/src/routers/agents.ts` (existing — the `triggers` namespace is replaced by the procedures below). Backing service: `packages/api/src/services/agent-schedules.ts` (new). All procedures are `protectedProcedure`.

- `agents.list` — `query`, no input. Returns `{ agents: AgentConfig[], events: EventSummary[] }`. `AgentConfig` is `{ agentId, name, role, enabled, scheduleTimes: string[], triggerMessage: string | null, defaultTriggerMessage: string, suggestedScheduleTimes: string[], subscribedEvents: string[], lastRunAt, lastRunStatus, lastRunError }`. `EventSummary` is `{ typeId, label, description, schedulable, routedAgentId: string | null, suggestedAgentId: string | null }`. Runs the one-time migration before reading.
- `agents.setSchedule` — `mutation`, input `{ agentId: string, enabled?: boolean, scheduleTimes?: string[] (HH:MM), triggerMessage?: string | null (max 4000) }`. Returns the updated `AgentConfig`. Rejects unknown `agentId` with `NOT_FOUND`; rejects `enabled: true` with no times with `BAD_REQUEST`.
- `agents.setEventSubscription` — `mutation`, input `{ agentId: string, typeId: string, subscribed: boolean }`. Returns `{ typeId, routedAgentId }`. Subscribing sets `notification_preferences.agent_id` to the agent, taking the event over from whichever agent held it. Unsubscribing clears it only when the agent currently owns it. Rejects a non-routable `typeId` with `BAD_REQUEST`.
- `agents.run` — `mutation`, input `{ agentId: string }`. Delegates to `ctx.runAgentTrigger`; `NOT_FOUND` for an unknown agent, `INTERNAL_SERVER_ERROR` when no runner is wired.
- `agents.dueAtTime` — `query`, input `{ time: string (HH:MM) }`. Returns `{ agents: { agentId, name }[] }` for enabled agents whose schedule contains that slot. Used by tests and debugging.

`packages/api/src/agents-meta.ts` loses `SCHEDULABLE_AGENT_IDS` and `isAgentSchedulable`; any agent present in `A_Agents/` is schedulable. `DEFAULT_SCHEDULE_TIMES` keeps its role as non-binding suggestions and drops its `04_meeting_prep_herald` entry, because meeting prep is event-driven rather than clock-driven.

Duplicate suppression is shared state rather than a UI rule: both the scheduled path and the event path stamp `agent_schedules.lastRunAt` through `markAgentRan`, and the scheduled cron skips an agent whose last successful run already falls in the current day-plus-slot via the existing `wasAgentRunInSlot`.

## UI surface

`apps/web/src/app/agents/manage/page.tsx` gains a third tab, `הגדרות`, alongside the existing `כרטיס סוכן` and `Workflow` tabs, rendering a new `apps/web/src/components/AgentConfigPanel.tsx`. The panel shows, for the selected agent: an enable switch; schedule times as removable `HH:MM` chips with an add control and the suggested times offered when empty; a checkbox per routable event, each labelled with its Hebrew name and noting when another agent currently owns it; an optional trigger-message textarea placeholdered with the agent default; last-run time and status; and a `הרץ עכשיו` button. When an agent has both times and event subscriptions, the panel shows an inline note that the run is de-duplicated per slot.

`apps/web/src/components/AgentTriggersPanel.tsx` and `apps/web/src/app/settings/notifications/page.tsx` are repointed from `agents.triggers.list`/`upsert` to `agents.list`/`setSchedule`; their layout and copy stay as they are. `packages/api/src/routers/finance.ts` reads the IBKR last-sync stamp from `agentSchedules` instead of `agentTriggers`.

All new UI uses the existing design-system classes (`.card`, `.btn`, `.input`), the dark palette already used on the page, Hebrew copy, and RTL flow.

## Cron

`apps/web/src/app/api/cron/scheduled-agents/route.ts` is the schedule path, reading `agent_schedules` every 15 minutes and keeping the current slot de-duplication. `apps/web/src/app/api/cron/agent-triggers/route.ts` remains as a deprecation shim returning `{ ok: true, deprecated: true }` so a not-yet-reinstalled crontab on the running instance does not 404. `deploy/crontab.example` calls the new path. The event endpoints (`morning-briefing`, `pre-meeting-briefing`, `daily-meeting-summary`, `task-reminder`) keep their schedules and their existing routing lookup.

## Out of scope

- Dropping the `agent_triggers` table or its schema definitions.
- Editing any `A_Agents/*.md` or `S_Skills/*.md` content.
- The `.cursor/skills/` development agents, which are a separate system.
- Creating new ABC agents or a UI for authoring agent cards.
- Multiple agents per single event, or per-event schedule offsets other than the existing 15-minute pre-meeting window.
- Postgres migration execution; production schema changes stay manual, as they are today.

## Open questions

None.
