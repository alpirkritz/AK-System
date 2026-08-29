# CoS — tomorrow grounding (מחר)

> **Slug:** `cos-tomorrow-grounding`
> **Stack:** next-trpc-monorepo
> **Status:** Approved (user-reported bug)
> **Last Updated:** 2026-08-29

## Goal

When the user asks what matters **tomorrow** (מחר), CoS must load tomorrow’s Google Calendar and Notion meetings/tasks for that date — never default to today and invent an empty day.

## User stories

- As the owner, when I ask מה חשוב מחר, I want tomorrow’s full meeting day and due tasks, so I can prepare.
- As the owner, I never want CoS to say “no meetings tomorrow” unless tools for that date returned empty without calendar errors.

## Acceptance criteria

- Given `get_day_schedule` with `date: tomorrow` (or YYYY-MM-DD), when called, then Google Calendar events and AK tasks due that day are returned for Israel-local tomorrow.
- Given `get_notion_meetings` with `range: tomorrow`, when called, then only Notion meetings on tomorrow’s date are returned.
- Given `get_notion_tasks` with `filter: tomorrow`, when called, then tasks due tomorrow are returned (alongside existing filters).
- Given CoS prompt for agent 01, when built, then it requires: for מחר/tomorrow call `get_day_schedule(tomorrow)` + `get_notion_meetings(tomorrow)` before answering; never claim empty without those results; if `calendarErrors` present, never claim zero meetings.
- Given Vitest, tool date resolution and prompt strings are covered.

## Data model

No schema changes.

## tRPC API

No new routers. Reuse `calendar.events({ startDate, endDate })` and existing Notion helpers. Add/adjust tools in `apps/web/src/lib/conversation-engine.ts` only.

## UI surface

- Prompt: `gemini-agent-engine.ts` CoS block + optional card/workflow one-liners.
- Tools: `get_day_schedule`, extend `get_notion_meetings` / `get_notion_tasks`.
- Helper: `localTomorrowIso` in `packages/api/src/lib/calendar-dates.ts` (export via api package).

## Out of scope

- Fixing wrong Google calendar OAuth/scope selection (if calendars are disconnected, still report errors).
- Changing specialist morning-brief formats.

## Open questions

- None.
