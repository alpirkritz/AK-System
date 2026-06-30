# Agent Triggers UI

> **Slug:** `agent-triggers-ui`
> **Status:** Approved
> **Last Updated:** 2026-06-30

## Goal

Enable daily scheduled and on-demand execution of ABC specialist agents (full LLM runs) from the `/agents` UI, parallel to existing lightweight cron digests. Users configure per-agent schedule times, enable/disable triggers, and manually run agents — mirroring the Notion Assistant automation pattern and the existing WhatsApp `summaryTimes` model.

## User Stories

- As a user, I want to enable a daily schedule for an agent (e.g. morning brief at 07:00) so that it runs automatically without opening chat.
- As a user, I want to click "הרץ עכשיו" to trigger an agent immediately without waiting for the schedule.
- As a user, I want to see when an agent last ran and whether it succeeded.
- As a user, I want scheduled agent output delivered via push/Telegram/WhatsApp and archived to Notion like manual runs.

## Acceptance Criteria

- [ ] `agent_triggers` table exists in SQLite and Postgres schemas with migration.
- [ ] tRPC `agents.triggers.list`, `upsert`, `run`, `dueAtTime` procedures work with auth.
- [ ] `/api/cron/agent-triggers` runs due agents every 15 min with dedup per day+slot.
- [ ] `/agents` page shows `AgentTriggersPanel` for the selected agent (toggle, times, message, run now, last run status).
- [ ] Manual and scheduled runs call `runAgentForUser`, persist chat history, push full text to channels.
- [ ] Schedulable agents: `03`–`07`; manual-only UI for Hugo, trainer, startup COO.
- [ ] Vitest covers router; Playwright covers panel visibility and save.
- [ ] Existing lightweight cron endpoints unchanged.

## Data Model

New table `agent_triggers` in `packages/database/src/schema.ts` and `schema.pg.ts`:

| Column | Type | Notes |
|--------|------|-------|
| `agent_id` | text PK | Matches `A_Agents/` filename without `.md` |
| `enabled` | boolean | default `false` |
| `schedule_times` | text | JSON array `["07:00"]`, default `[]` |
| `trigger_message` | text nullable | Custom prompt; null → code default |
| `last_run_at` | text nullable | ISO timestamp |
| `last_run_status` | text nullable | `ok` \| `error` |
| `last_run_error` | text nullable | Short error message |
| `updated_at` | text | ISO timestamp |

Default suggested times (seed on first list, not auto-enabled):
- `03_morning_briefing`: `07:00`
- `04_meeting_prep_herald`: `07:30`
- `05_ibkr_daily_import`: `18:00`
- `06_calendar_optimizer`: `08:00`
- `07_email_assistant`: `09:00`

## tRPC API

Router: `agents` → sub-router `triggers`

| Procedure | Type | Input | Returns | Auth |
|-----------|------|-------|---------|------|
| `list` | query | — | `{ agents: TriggerConfig[] }` | protected |
| `upsert` | mutation | `{ agentId, enabled?, scheduleTimes?, triggerMessage? }` | row | protected |
| `run` | mutation | `{ agentId }` | `{ ok, text? }` | protected |
| `dueAtTime` | query | `{ time: "HH:MM" }` | `{ agents: { agentId, name }[] }` | protected |

`TriggerConfig` includes: `agentId`, `name`, `schedulable`, `enabled`, `scheduleTimes`, `triggerMessage`, `defaultTriggerMessage`, `lastRunAt`, `lastRunStatus`, `lastRunError`.

Agent list sourced from filesystem via shared constants in `packages/api` (agent IDs + schedulability map).

## UI Surface

- **Route:** `apps/web/src/app/agents/page.tsx` — add `AgentTriggersPanel` above chat for selected agent.
- **Component:** `apps/web/src/components/AgentTriggersPanel.tsx`
- **Mobile:** panel collapses above chat; same fields.
- **Copy:** Hebrew RTL; label "טריגר יומי (סוכן מלא AI)" to distinguish from system cron digests.

## Out of Scope

- Replacing lightweight cron (`/api/cron/morning-briefing`, etc.)
- Event-based triggers (pre-meeting, Notion tags)
- Background job queue / async runs
- Per-agent notification channel selection
- Cursor SDK engine for scheduled runs

## Open Questions

None — user approved parallel cron + agents panel placement.
