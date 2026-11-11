# Agent schedule time-awareness

## Goal

Hugo (and every other agent) answers "what's on today" by reciting meetings that already
ended, as if they were still ahead. The agent knows the wall clock — `agent-clock-and-harness-surfacing`
put `Now: <date>, HH:MM` in the system instruction — but the calendar tool payload carries no
time reference at all, so the model has to compare each event's ISO timestamp against a clock
it was told about in a different part of the prompt. It mostly doesn't bother.

Make "already happened" a fact in the data rather than an inference the model has to perform.

## Root cause

Two surfaces feed an agent today's calendar, and neither carried a time reference.

1. **The prefetched prompt block** — `formatAgentCalendarContextForPrompt` in
   `packages/api/src/services/agent-calendar-context.ts` renders one flat `### Events today`
   list via `eventLine`, where an all-day event reads only `- כל היום <title>`. This is the
   one Hugo actually reads for "what's on today", and it is where the reported behaviour
   came from.
2. **The calendar tool payloads** — `executeTool` in `apps/web/src/lib/conversation-engine.ts`
   returns `{ date, requested, events, dueTasks, calendarErrors }` for
   `get_today_schedule` / `get_day_schedule`, with the same gap in `get_week_schedule` and
   `get_upcoming_events`.

Both must change, and they must agree, or the agent sees one story in its prompt and another
from its tools. All agents share both paths (`gemini-agent-engine.ts` imports `executeTool`),
so one fix per surface covers every agent, both engines, and every channel.

## User stories

- As Hugo's user at 15:51, when I ask what's left today, I want the 09:00 standup reported as
  done (or omitted), not listed as upcoming.
- As a user of any agent, I want "the next meeting" to mean the next one from right now.
- As the morning-briefing reader at 07:00, I want nothing to change — at that hour the whole day
  is still ahead.

## Acceptance criteria

- [ ] One shared helper in `packages/api/src/lib/event-time-status.ts` classifies an event as
      `past` (ended), `current` (in progress), `upcoming` (not started) or `allDay`, and groups
      a list into buckets. Both the prompt block and the tool payloads derive from it, so they
      cannot disagree.
- [ ] All-day events are never classified `past` — they hold for the whole day.
- [ ] A missing or unreadable end time does not leave a 09:00 event reported as "happening now"
      all afternoon; an unreadable start is treated as still ahead rather than asserted over.
- [ ] The prefetched prompt block replaces its single flat `### Events today` list with
      clock-split sections (`מתרחש כרגע`, `עוד לפניך היום`, `כבר הסתיים היום`) and states the
      current wall clock in the heading.
- [ ] All-day markers are rendered as one inline `רקע ליום` background line, not as a bulleted
      section — as a list of events the agent kept re-filing birthdays under its own
      "already passed" heading.
- [ ] Day/week tool payloads return `now` plus `inProgress` / `upcoming` / `allDay` / `past`
      arrays and a `summary` count block, instead of one flat `events` array.
- [ ] Nothing is filtered out and order is preserved within a bucket — an agent asked "how was
      my day" must still see the morning.
- [ ] Both system instructions describe the buckets and forbid inventing a two-way
      "past / ahead" split.
- [ ] Behaviour is unchanged at 07:00: the whole day lands in `upcoming`, so the morning
      briefing reads exactly as before.
- [ ] Vitest coverage for the helper at boundaries (ends exactly now, starts exactly now,
      all-day, missing end, unreadable start, past/future day) and for the prompt block's
      sectioning.

## Data model changes

None. No schema, no migration.

## tRPC API shape

Unchanged. This is tool-payload shaping inside `apps/web`, not a procedure change.

## UI surface

None.

## Out of scope

- Filtering past events out of the payload. The model should decide what to mention; hiding
  history would break "summarize my day" and the daily-meeting-summary cron.
- `get_next_meeting_brief` (`conversation-engine.ts:803`) already uses `calendar.upcoming`,
  which is time-filtered server-side. Left alone.
- The morning-briefing template path, which builds its own context in
  `morning-briefing-context.ts` and is not model-driven.

## Open questions

- Prompt wording alone did not hold. Three successive tightenings of the instruction still left
  Hugo re-filing all-day events under his own "מה כבר עבר" heading; only removing them from the
  event list (one inline background line instead) stopped it. Worth remembering for any future
  formatting rule: if an agent must not do X with a list, the reliable fix is to not give it
  that list, not to ask it more firmly.
