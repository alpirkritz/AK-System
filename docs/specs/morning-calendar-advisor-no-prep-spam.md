# Morning יועץ יומן — stop Meeting Prep Herald spam

> **Slug:** `morning-calendar-advisor-no-prep-spam`
> **Status:** Approved
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-20

## Goal

Stop the flood of WhatsApp (and in-app) messages from **Meeting Prep Herald** that fire ~15 minutes before every calendar event, and ensure **יועץ יומן** (`06_calendar_optimizer`) delivers a real morning calendar review at **07:00** Israel time via WhatsApp and the system (chat/push).

## Diagnosis (production)

Current `notification_preferences` on EC2:

| type_id | schedule | agent_id | trigger_message | effect |
|---------|----------|----------|-----------------|--------|
| `pre_meeting_briefing` | every ~5 min cron window | `04_meeting_prep_herald` | (null / default) | Full LLM Meeting Prep run **per meeting** → many WhatsApp messages all day (birthdays, workouts, 1:1s, …) |
| `morning_briefing` | `["07:00"]` | `06_calendar_optimizer` | `להתעלם מפגישות של מעל 8 שעות…` | Agent treats the custom string as the *task* and replies with an ack instead of a calendar review |

`agent_triggers` table is empty — the spam is **not** from the `/agents` daily schedule UI; it is from **event routing** on `pre_meeting_briefing`.

## User Stories

- As the owner, I want Meeting Prep Herald to stop auto-messaging me before every meeting so WhatsApp stays quiet in the morning.
- As the owner, I want יועץ יומן to send one useful daily calendar review at 07:00 via WhatsApp and ARO (chat + push).
- As the owner, I still want to be able to run Meeting Prep Herald on demand (chat / agents UI) when I ask for it.

## Acceptance Criteria

- [ ] `pre_meeting_briefing` no longer routes to `04_meeting_prep_herald` (agent_id = null). Default behavior = lightweight template only, **or** the type is fully disabled if we choose Option B below.
- [ ] No new `🤖 Meeting Prep Herald` cron messages appear for upcoming meetings after the change (unless the user manually runs the agent).
- [ ] `morning_briefing` remains enabled at `07:00` Asia/Jerusalem, routed to `06_calendar_optimizer`, with WhatsApp + push + telegram channels on.
- [ ] `morning_briefing.trigger_message` is cleared (null) or replaced with a proper daily-review prompt — not the “ignore all-day events” instruction fragment.
- [ ] When the morning cron fires, יועץ יומן receives today’s calendar/tasks context (same spirit as the template) and returns a short secretary-style brief (per `calendar-optimizer-whatsapp-brief`), delivered via `pushAssistantMessage` with `typeId: morning_briefing`.
- [ ] On-demand Meeting Prep (WhatsApp “תריץ הכנה לפגישה”, `/agents` run) still works.
- [ ] Vitest covers: routing cleared for pre-meeting; morning route passes context / default prompt when trigger_message is null.

## Decision — pre-meeting behavior

**Chosen: Option A.** Clear `agent_id` on `pre_meeting_briefing` only (revert to lightweight template). Short template alerts (“⏰ הכנה לפגישה – …”) may still send 15 min before meetings; no full Meeting Prep LLM spam.

**UI-reversible (mandatory):** Do **not** hard-code a permanent disconnect. Clearing `agent_id` is a preference row change — the owner can re-assign Meeting Prep Herald (or any agent) from **הגדרות → התראות וערוצים** at any time, and can still run Meeting Prep on demand via chat / `/agents`.

## Data Model

No schema changes. Updates are rows in existing `notification_preferences` (SQLite production volume; same shape in `schema.ts` / `schema.pg.ts`):

| Column | Change |
|--------|--------|
| `pre_meeting_briefing.agent_id` | set to `NULL` |
| `pre_meeting_briefing.trigger_message` | set to `NULL` |
| `morning_briefing.agent_id` | keep `06_calendar_optimizer` |
| `morning_briefing.schedule_times` | keep `["07:00"]` |
| `morning_briefing.trigger_message` | set to `NULL` (use `getDefaultTriggerMessage('06_calendar_optimizer')`) |
| `morning_briefing` channels | keep whatsapp/push/telegram enabled |

Optional code default nudge (not required for prod fix):

- `packages/api/src/agents-meta.ts` — `DEFAULT_SCHEDULE_TIMES['06_calendar_optimizer']`: `['08:00']` → `['07:00']` (UI hint only; morning path uses notification prefs).

## tRPC API

No new procedures. Existing:

- `settings.notifications.upsert` — can apply the preference changes from the UI or a one-shot ops script.
- `getNotificationRouting('pre_meeting_briefing')` → `{ agentId: null, … }` after fix.
- `getNotificationRouting('morning_briefing')` → `{ agentId: '06_calendar_optimizer', triggerMessage: null }`.

## Implementation (code + ops)

### 1. Ops / production (required)

Update EC2 SQLite `notification_preferences`:

```sql
UPDATE notification_preferences
SET agent_id = NULL, trigger_message = NULL, updated_at = datetime('now')
WHERE type_id = 'pre_meeting_briefing';

UPDATE notification_preferences
SET trigger_message = NULL, updated_at = datetime('now')
WHERE type_id = 'morning_briefing';
-- leave agent_id = 06_calendar_optimizer, schedule_times = ["07:00"], enabled = 1
```

### 2. Code — morning context for routed agent (required)

`apps/web/src/app/api/cron/morning-briefing/route.ts`:

- Before `runEventAgentIfRouted('morning_briefing')`, build the same today events + due-tasks text the template uses (respecting calendar scope).
- Pass it as `context` to `runEventAgentIfRouted` so יועץ יומן grounds on real data even when `trigger_message` is empty/default.

`apps/web/src/lib/notification-event-runner.ts`:

- No API change; already supports `options.context`.

### 3. All-day / long-event filter (optional, separate if already in agent MD)

The broken trigger_message was trying to encode “ignore events > 8h / all-day”. That belongs in `A_Agents/06_calendar_optimizer.md` / workflow (or existing filter logic), **not** in `notification_preferences.trigger_message`. Out of scope unless already missing from agent instructions — verify during impl; do not re-introduce via trigger_message.

## UI Surface

- **Settings → התראות וערוצים** (`apps/web/src/app/settings/notifications/page.tsx`): after fix, “הכנה לפגישה” shows template (no agent), “תדריך בוקר” shows יועץ יומן at 07:00.
- No new screens. Optional microcopy note on pre-meeting row: agent routing produces long per-meeting LLM messages — prefer template for light alerts.

## Out of Scope

- Changing Meeting Prep Herald agent instructions / grounding.
- Disabling manual/on-demand Meeting Prep.
- Changing `/api/cron/pre-meeting-briefing` window (14–16 min).
- Replacing lightweight morning template permanently (routing to יועץ יומן stays).
- Agent Triggers UI (`agent_triggers`) — unused for this spam path.

## Open Questions

None — Option A approved; morning channels stay WhatsApp + in-app + push; Meeting Prep remains available on demand and re-routable from the UI.
`)
