# Review — agent-meeting-notes-body

> **Slug:** `agent-meeting-notes-body`
> **Date:** 2026-08-13
> **Verdict:** APPROVED

## Summary

Persists Notion AI Meeting Notes page bodies into local `meeting_notes.body_text` and wires agents (evening summary, meeting prep, Hugo, insights) to read that text instead of live property snippets.

## Spec conformance

| Criterion | Status |
|---|---|
| Schema columns `body_text`, `body_synced_at`, `notion_last_edited_at` (pg + sqlite + ALTER) | Done |
| Graph sync fetches blocks when edited; 8000 cap; skip re-fetch | Done |
| `insights.meetingNotes` with date/meetingId/person/project filters | Done |
| `get_notion_meeting_notes` → local DB + bodyText | Done |
| Evening cron syncs 7 days then injects today’s notes | Done |
| UI excerpts from bodyText (meetings / people / projects) | Done |
| ABC agent cards updated | Done |

## Tests

- `pnpm --filter @ak-system/api test` — 659 passed (includes `notion-graph-sync` body helpers + `insights.meeting-notes`)
- `pnpm --filter @ak-system/web test` — 162 passed (includes `conversation-engine.meeting-notes`)

## UI/UX

Hebrew RTL unchanged; longer `line-clamp-8` excerpts on existing `.card` blocks. No new routes.

## Nits

- None blocking. Full Notion block re-fetch still only on edit / missing body; nested child blocks beyond top-level children are not recursively expanded (parity with Calendar Review depth tradeoff — top-level rich_text covers typical AI summary pages).
