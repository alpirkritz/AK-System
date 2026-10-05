# Calendar Optimizer: reference free-marked events, exclude from load/conflicts

> **Slug:** `calendar-optimizer-exclude-free-events`
> **Status:** Approved
> **Last Updated:** 2026-09-29
> **Stack:** `next-trpc-monorepo`

## Goal

06_calendar_optimizer (יועץ יומן) currently treats every timed event the same regardless of Google Calendar's "Show me as: Free" (`transparency: transparent`) setting, because `getAgentCalendarContext`/`formatAgentCalendarContextForPrompt` never surfaces transparency to the LLM. Free-marked events should still be listed in the daily brief (so the owner sees them), but must not count toward meeting-load hours and must not be treated as actionable conflicts/overlaps or as contributing to an "overloaded day" flag.

Note: this is distinct from the existing `calendar.ts` router filter (`fetchAllEvents` drops `transparency: 'transparent'` entirely for the UI/pre-meeting-notification path) and from `isFreeBusyPlaceholderTitle` (cross-calendar `פנוי`/`busy` placeholder titles). Neither of those affects the agent context builder used by 06_calendar_optimizer.

## User stories

- As the owner, I want free-marked events to still appear in my daily calendar brief (so I have context on what's on my calendar), but not be counted in "load" hours.
- As the owner, I don't want the agent to flag a free-marked event as a double-booking/conflict against a real meeting, or to use it to justify "overloaded day".
- As the owner, I still want busy (opaque) events — including private-calendar busy events — treated as real load/conflicts, unchanged from current behavior.

## Acceptance criteria

- Given a timed event with `transparency: 'transparent'`, when `formatAgentCalendarContextForPrompt` renders it, then it still appears in "Events today" but is visibly marked (e.g. suffix `(מסומן כפנוי)`).
- Given one opaque event (1h) and one transparent event (2h) on the same day, when the prompt's "Timed meeting hours" summary is computed, then only the opaque event's duration counts (1.0h, not 3.0h).
- Given a transparent event overlapping an opaque meeting, when the prompt is built, then the transparent event is not silently merged into load — the instructions (below) tell the agent to treat it like a DNS/focus block (awareness only, not an actionable conflict), not as a real double-booking.
- Given an event with no `transparency` field (Apple Calendar, or Google default), when rendered, then it is treated as opaque/busy (existing default `?? 'opaque'` behavior preserved) — no regression.
- Given `A_Agents/06_calendar_optimizer.md` and `S_Skills/wf_calendar_optimizer.md`, when read, then both explicitly state: free-marked (`transparency: transparent`) events are shown/mentioned but excluded from load-hour totals, from double-booking/conflict detection, and from the >4h overload threshold — same tier as DNS/focus blocks.
- Given Vitest, when covering `formatAgentCalendarContextForPrompt`, then a case asserts the free-event tag text and a case asserts the load-hours summary excludes transparent-event duration.

## Data model

No schema changes. No changes to stored calendar event rows — this only affects the prompt-formatting layer in `packages/api/src/services/agent-calendar-context.ts`.

## tRPC API

No new procedures. No changes to `packages/api/src/routers/calendar.ts` (its existing transparent-event filter for `upcoming`/UI stays as-is; out of scope here).

Changes confined to:
- `packages/api/src/services/agent-calendar-context.ts`
  - `eventLine()`: append a marker (e.g. ` (מסומן כפנוי)`) when `ev.transparency === 'transparent'`.
  - `formatAgentCalendarContextForPrompt()`: exclude transparent events from the `meetingHours` reduce; add one line to the prompt's guidance text telling the agent free-marked events are informational only, not load/conflicts.

## UI surface

None. Backend prompt-context + agent instruction docs only.

## Out of scope

- Changing `calendar.ts`'s `fetchAllEvents` transparent-event filter (UI/pre-meeting path).
- Changing `isFreeBusyPlaceholderTitle` cross-calendar placeholder handling.
- Any change to the Private-calendar (`alpirkritz@gmail.com`) busy-event-as-conflict rule — unchanged.
- Mobile/web UI rendering of calendar events.

## Open questions

None.
