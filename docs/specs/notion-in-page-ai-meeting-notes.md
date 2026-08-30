# Notion in-page AI Meeting Notes

> **Slug:** `notion-in-page-ai-meeting-notes`
> **Status:** Approved
> **Last Updated:** 2026-08-30 (summary-only + name match)
> **Stack:** `next-trpc-monorepo`

## Goal

Native Notion AI Meeting Notes live as a block on the Meetings database page, not as pages in a separate `meeting_notes` database. Pull that in-page body into local `meeting_notes`, link it to the meeting (and thus people/projects), and make the whole system — sync, meeting/person/project UI, insights, Hugo, meeting-prep, morning brief, evening summary — use that text as meeting context.

## User Stories

- As the owner, when I ask any agent about a meeting that has Notion AI Meeting Notes on its page, I want Notion’s **AI summary** (perspectives, decisions, action items) — not the raw transcript.
- As the owner, when I ask about a person or project, I want recent meeting context to come from those notes, not from the meeting title alone.
- As the owner, when I paste a Notion meeting URL, I want the system to fetch that page’s notes if they are not already in the local DB.
- As the owner, when I open a meeting/person/project in AK System, I want סיכומי Notion to show the AI notes body when Notion has one.
- As the owner, when the Notion API cannot expose the notes block, I want `לא נמצא בנתונים` plus a sync error naming the page, not invented discussion.

## Acceptance Criteria

- [x] Given a Meetings-database page whose AI notes live as a child block on that page (example: page `3cce7d50-cb8e-809c-8f7c-da639bce5478`, block `fb2e7d50-cb8e-82a1-93b6-01601b869cae`), when `notionGraph.sync` runs, then a `meeting_notes` row is upserted with `meetingId` set to the local meeting that has that `notionPageId`, `sourceKind` = `meeting_page_summary`, and `bodyText` contains the **AI summary only** (cap 8000 chars) — headings/bullets/todos under `transcription`, not the transcript sibling.
- [x] Given a `transcription` tree whose first child is structured notes (headings/bullets/todos) and a later child is dialogue paragraphs, when extract runs, then `bodyText` includes the structured notes and **excludes** transcript lines.
- [x] Given local notes still have `sourceKind` = `meeting_page` (transcript dump), when sync or `get_notion_meeting_notes` for today runs, then bodies are re-extracted once to summary-only.
- [x] Given the user asks about today’s conversation with **שני** / Shani, when `get_notion_meeting_notes` is called with `date: today` and `query: שני`, then the note for the Shani meeting that day is returned (Hebrew↔English name aliases + title token), not “no meeting today”.
- [x] Given that meeting page’s top-level children include `child_page`, `synced_block`, `unsupported` with `has_children`, or a `meeting_notes`-like type, when body fetch runs, then those children are expanded (depth cap 3, block cap 200) instead of skipped.
- [x] Given `body_text` already stored and the meeting page `last_edited_time` is not newer than `body_synced_at`, when sync runs again, then blocks are not re-fetched for that page.
- [x] Given graph sync, when notes are taken from the meeting page, then people/project links on the note are copied from the meeting’s existing `meeting_people` / `meetings.projectId` (not from a separate notes-DB relation).
- [x] Given Hugo or any agent calls `get_notion_meeting_notes` with `meetingId` or `date`, when the in-page notes were synced, then `bodyText` is returned from local DB.
- [x] Given the user pastes a Notion meeting URL or page id, when `get_notion_meeting_notes` is called with `notionPageId` or `notionUrl`, then if local body is missing or stale, the service fetches that page’s blocks once, upserts `meeting_notes`, and returns `bodyText`.
- [x] Given the API returns no extractable text, when the agent answers, then it uses `לא נמצא בנתונים` for that meeting and `NotionGraphSyncResult.errors` includes `meetings/body/<pageId>: <reason>` including the observed top-level block types.
- [x] Given a meeting detail page, when `bodyText` exists, then סיכומי Notion shows the excerpt from `bodyText`. Person/project related notes do the same.
- [x] Given the meetings list page, when Notion graph is configured, then a **סנכרן סיכומי Notion** button runs `notionGraph.sync` with `scope: meetings` (7-day window). Calendar sync stays a separate control. Projects keeps **סנכרן מ-Notion** for the full graph.
- [x] Given an agent asks for today's (or a named person's) meeting notes and local bodies are empty, when `get_notion_meeting_notes` runs, then it refreshes meeting-page notes (`scope: meetings`, 3-day window) once before answering. If a name query matches nothing, today's notes are still returned.
- [x] Given Vitest, when flatten is given nested `has_children` / `child_page` fixtures matching the skip list today, then the extracted text includes the nested rich_text. Playwright: meeting detail shows the excerpt when `bodyText` is seeded.

## Data Model

Reuse `meeting_notes` in `packages/database/src/schema.ts` and `schema.pg.ts`. No new table.

Additive columns, plus SQLite bootstrap ALTERs in `packages/database/src/index.ts`:

| Column | Type | Notes |
|---|---|---|
| `source_block_id` / `sourceBlockId` | text nullable | Notion block id of the AI notes widget when known |
| `source_kind` / `sourceKind` | text nullable | `meeting_page_summary` for in-page AI summary; legacy `meeting_page` is re-extracted; separate-DB notes stay `notes_db` or null |

`notion_page_id` for in-page notes = the **meeting page id**. Unique via existing index. `meeting_id` is set from `meetings.notion_page_id`, not title fuzzy-match.

Existing `body_text` / `body_synced_at` / `notion_last_edited_at` stay as in `agent-meeting-notes-body`. Summary cap is 8000 (structured AI notes only — transcript is dropped before the cap). No audio, no full transcript, no embeddings.

Migration: additive only. Separate `meeting_notes`-typed DBs keep working if configured.

## tRPC API

Reuse `packages/api/src/routers/notion-graph.ts` and `packages/api/src/routers/insights.ts`. No new router.

### `notionGraph.sync` (existing mutation)

- Auth: `protectedProcedure`
- Input: unchanged `{ windowDays?: number, dryRun?: boolean }`
- Change: after upserting each Meetings DB page, if `shouldFetchNoteBody`, fetch that page’s blocks (recursive rules above), upsert `meeting_notes` with `meetingId` + `sourceKind: 'meeting_page'`.
- Return: existing `NotionGraphSyncResult`; `notesUpserted` includes meeting-page notes.

### `insights.meetingNotes` (existing query)

- Auth: `protectedProcedure`
- Input: extend with optional `notionPageId: string` and `notionUrl: string` (parse page id from Notion URL, including `app.notion.com/p/...` and hash block id).
- Return: unchanged `{ notes, count }`. If `notionPageId`/`notionUrl` is set and local body is missing/stale, fetch once then return.

### `get_notion_meeting_notes` (existing Gemini tool)

- File: `apps/web/src/lib/conversation-engine.ts`
- Args: existing `date`, `meetingId`, plus `notionUrl?: string`, `notionPageId?: string`
- Return: same shape; `source` remains `local_db` after upsert

`get_notion_meetings` stays properties-only.

## UI Surface

- `apps/web/src/app/meetings/[id]/page.tsx` — existing סיכומי Notion block; label may say סיכום AI (Notion) when `sourceKind` is `meeting_page`.
- `apps/web/src/app/projects/[id]/page.tsx` and `apps/web/src/components/people/PersonDetailDrawer.tsx` — same excerpt behavior; no new routes.
- Settings Notion status (`apps/web/src/app/settings/` Notion card, or `/api/notion/status` consumer): if a `meetings` DB is configured, show that AI notes are read from meeting pages.
- Hebrew RTL, existing `.card` classes. No new CSS frameworks.

## Out of Scope

- Storing or returning the raw meeting transcript (Notion already summarizes; agents must use that summary)
- Audio/RAG/embeddings
- Replacing calendar as creator of `meetings` rows
- Requiring a separate “AI Meeting Notes” database
- Dumping full 8k bodies into every system prompt
- Mobile UI parity
- Recursively walking every Notion page in the workspace
- Bumping `Notion-Version` globally for tasks/writeback (bump only the meeting-notes block fetch if a newer version is required, and isolate that header)

## Open Questions

- Probe (2026-08-30) of page `3cce7d50-cb8e-809c-8f7c-da639bce5478`: top-level types were `paragraph`, `heading_1`, `bulleted_list_item`, `transcription+`, `heading_1`, `child_database`, `unsupported`, `paragraph`. The AI Meeting Notes hash block is type `transcription` (has_children). Nested paragraph children hold the summary (headings/bullets/todos) then the transcript. `unsupported` is a button the API cannot expand. Flatten walks `transcription.title` (rich_text array) plus nested children to depth 3. Public API **does** return readable text.
