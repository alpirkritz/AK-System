# Agent Meeting Notes Body

> **Slug:** `agent-meeting-notes-body`
> **Status:** Approved
> **Last Updated:** 2026-08-13
> **Stack:** `next-trpc-monorepo`

## Goal

Persist the text body of Notion AI Meeting Notes into local `meeting_notes`, and make agents (evening daily summary, meeting prep, Hugo, person insights) read that text as the source of meeting insights instead of short property snippets.

## User Stories

- As the owner, I want the evening daily summary to use today’s recorded AI meeting notes, so the wrap-up reflects what actually happened.
- As the owner, I want meeting-prep and Hugo to pull decisions/commitments from those same notes, not from a 200-character property snippet.
- As the owner, I want person/project insights to use the stored note body, so CRM context matches the recording summary.
- As the owner, I want a recording from this afternoon to be available at 20:00, so the evening agent is not waiting on a stale 30-minute sync.

## Acceptance Criteria

- [ ] Given a Notion meeting-notes page whose summary lives in blocks, when graph sync runs, then `meeting_notes.body_text` contains that plain text, capped at 8000 characters, and `snippet` stays a short excerpt (first ~500 chars of body, or existing property snippet if body is empty).
- [ ] Given `body_text` is already stored and Notion `last_edited_time` has not changed, when sync runs again, then the service does not re-fetch blocks for that page (`notion_last_edited_at` vs `body_synced_at`).
- [ ] Given `insights.meetingNotes` with `{ date: today }`, when notes exist for today, then the procedure returns those rows including `bodyText` (auth: protectedProcedure).
- [ ] Given an agent calls `get_notion_meeting_notes`, when local rows exist, then the tool returns local `title`, `date`, `bodyText`, linked `meetingId`. Optional filters: `date` (`today` or `YYYY-MM-DD`), `meetingId`. Default: most recent 15 notes.
- [ ] Given `daily_meeting_summary` cron, when it runs, then it first calls `notionGraph.sync` with `windowDays: 7`, then injects today’s note bodies into the agent trigger `context` (and the no-agent template lists today’s note bodies).
- [ ] Given `04_meeting_prep_herald` calls `get_notion_meeting_notes`, when notes are linked to that meeting, then the tool result includes `bodyText`. Agent card documents filtering by meeting date / id when known.
- [ ] Given `insights.personContext`, when a person has linked notes, then `recentMeetingNotes` includes `bodyText` truncated to 1500 chars per note (limit 5).
- [ ] Given a meeting detail page, when `bodyText` exists, then the סיכומי Notion block shows a longer excerpt (line-clamp ~8) from `bodyText` if `snippet` is empty or shorter.
- [ ] Given a missing or empty body after a failed block fetch, when the agent summarizes, then it writes `לא נמצא בנתונים` for that meeting. Sync errors are recorded in `NotionGraphSyncResult.errors` and do not abort the rest of the graph sync.

## Data Model

Additive columns on `meeting_notes` in both `packages/database/src/schema.ts` and `schema.pg.ts`, plus SQLite bootstrap ALTERs in `packages/database/src/index.ts`:

| Column | Type | Notes |
|---|---|---|
| `body_text` / `bodyText` | text nullable | Capped at 8000 chars on write |
| `body_synced_at` / `bodySyncedAt` | text nullable | ISO timestamp of last successful block pull |
| `notion_last_edited_at` / `notionLastEditedAt` | text nullable | Notion page `last_edited_time` |

No audio. No embeddings.

## tRPC API

Reuse existing routers; no new router.

### `insights.meetingNotes` (new query)

- Auth: `protectedProcedure`
- Input: `{ date?: string, meetingId?: string, personId?: string, projectId?: string }` — `date` is `today` or `YYYY-MM-DD`; at most one of meeting/person/project; if none of filters, last 15 by date desc
- Return: `{ notes: { id, title, date, snippet, bodyText, notionUrl, meetingId, meetingTitle }[], count }`

### Extensions

- `meetings.getById` — include `bodyText` on each linked note
- `people.getRelated` / `projects.getRelated` — include `bodyText` on meeting notes
- `insights.personContext` — `recentMeetingNotes` includes `bodyText` truncated to 1500 chars

### Sync service

`packages/api/src/services/notion-graph-sync.ts`: after upserting a note page, if `last_edited_time` is newer than `body_synced_at` (or body is null), fetch page blocks via Notion REST, flatten rich_text (implement inside `packages/api`), skip table/image/audio, cap 8000 chars. Isolate per-page failures into `errors`.

## UI Surface

- `apps/web/src/app/meetings/[id]/page.tsx` — סיכומי Notion excerpt from `bodyText` when present (line-clamp ~8)
- `apps/web/src/components/people/PersonDetailDrawer.tsx` — same
- `apps/web/src/app/projects/[id]/page.tsx` — same
- No new routes. Hebrew RTL, existing `.card` classes.

## Agent / cron wiring

- `get_notion_meeting_notes` tool → `insights.meetingNotes` (local DB), with optional `date` / `meetingId`
- `daily-meeting-summary` cron: sync window 7 days, then inject today’s note bodies into agent context and template path
- Update `A_Agents/01_Hugo_orchestrator.md`, `03_morning_briefing.md`, `04_meeting_prep_herald.md`, `S_Skills/wf_meeting_prep.md` to use local `body_text` via the tool
- Do not dump full 8k bodies into every system prompt — tool + evening `context` only

## Out of Scope

- Audio, transcripts beyond the 8000-char cap, RAG/embeddings
- Walking every `meetings` row on each agent run
- Live Notion block fetch inside every chat turn
- Replacing calendar as creator of `meetings` rows
- Full `fix-evening-morning-confusion` branding (except using injected notes)
- Mobile UI parity

## Open Questions

- None blocking. Defaults: 8000 char cap; evening sync window 7 days; unfiltered tool list 15 notes.
