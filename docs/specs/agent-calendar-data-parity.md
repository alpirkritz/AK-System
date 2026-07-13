# Spec: Agent Calendar Data Parity (no silent event loss)

> **Slug:** `agent-calendar-data-parity`
> **Stack:** next-trpc-monorepo
> **Status:** Approved (user: "do whatever it takes")
> **Owner:** dev-agent
> **Created:** 2026-07-12

## Problem

The calendar optimizer (`06_calendar_optimizer`), when triggered live (WhatsApp/Telegram/web),
sometimes reports "no meetings today — only all-day events," while the archived Notion
Inbox page from the same agent/instructions shows a full, rich analysis with all timed
meetings, conflicts, and load.

Both paths use the **same** Google connections and the **same** agent instructions. The
difference is the **data** injected into the prompt, not the prompt itself.

### Root cause

In `packages/api/src/services/google-calendar.ts`, `fetchEventsForConnection` fetches each
sub-calendar via `Promise.allSettled` and **silently drops** any calendar whose
`events.list` call rejects (transient rate-limit / token-refresh race):

```ts
for (const result of results) {
  if (result.status !== 'fulfilled') continue   // ← silent data loss
  ...
}
```

Per-account errors surface only when the whole account throws; a single failing
sub-calendar (e.g. the Dragontail work calendar holding the timed meetings) disappears
with **no error**. All-day events from other calendars still return, so:

1. The health probe stays green (it only calls `calendarList.list`).
2. `getAgentCalendarContext` returns a non-empty (but incomplete) event list.
3. `calendarWarning` in `conversation-engine.ts` never fires — it only triggers when
   `scopedEvents.length === 0`, and the all-day events keep the count above zero.
4. The agent confidently reports a near-empty day.

## Goals

- Never silently drop a sub-calendar's events. Every per-calendar failure is either
  recovered (retry) or surfaced as an error the agent must report.
- The agent must never state the day is empty/clear when any calendar fetch errored.
- No signature change for the public `fetchGoogleCalendarEvents` (`{ events, errors }`).

## Non-goals

- Changing OAuth/token storage, agent instructions, or the Notion archive flow.
- Changing the web calendar UI beyond errors that already flow through `googleErrors`.

## Changes

### 1. `packages/api/src/services/google-calendar.ts`

- Add a single-retry helper around `fetchEventsFromCalendar` (short backoff) for transient
  per-calendar failures.
- `fetchEventsForConnection` returns `{ events, errors }`; each failing sub-calendar (after
  retry) produces a `GoogleCalendarFetchError` labeled with the account email + calendar
  name. Preserve the existing account-level auth-error retry.
- `fetchGoogleCalendarEvents` merges per-calendar errors from fulfilled connections into the
  returned `errors` array (in addition to account-level rejections).

### 2. `packages/api/src/services/agent-calendar-context.ts`

- In `formatAgentCalendarContextForPrompt`, when `errors.length > 0`, add a prominent
  warning instructing the agent: data may be incomplete, list which calendars failed, and
  never claim the day is clear/empty. Keep existing strings (`Do NOT report 0 hours`,
  `reconnect Google`, per-error lines).

### 3. `apps/web/src/lib/conversation-engine.ts`

- `get_today_schedule`, `get_week_schedule`, `get_upcoming_meetings`: set `calendarWarning`
  whenever `googleErrors.length > 0` (not only when zero events), so partial failures are
  reported.

## Acceptance criteria

- [ ] A failing sub-calendar yields an entry in `errors` (never silent).
- [ ] `formatAgentCalendarContextForPrompt` emits a "data may be incomplete" warning when
      errors exist, even if some events are present.
- [ ] `calendarWarning` is set on any `googleErrors`, regardless of event count.
- [ ] Existing tests still pass; new unit tests cover the partial-error prompt path.
- [ ] `pnpm --filter @ak-system/api test`, lint, and web build are green.

## Test plan

- Unit: `agent-calendar-context` prompt shows incomplete-data warning when `errors` present
  alongside events.
- Unit (optional): google-calendar per-calendar error aggregation via mock.
- Manual (EC2): run `scripts/probe-agent-calendar-context.mts` and confirm Dragontail timed
  events appear or an explicit error is listed.
