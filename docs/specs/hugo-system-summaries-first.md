# Spec: Hugo reads system summaries before Notion summaries

> **Slug:** `hugo-system-summaries-first`
> **Stack:** next-trpc-monorepo
> **Status:** Approved by user request 2026-11-18
> **Created:** 2026-11-18

## Problem

Hugo (chat, morning briefing, meeting prep, the 20:00 daily summary) reads meeting summaries only from
Notion AI Meeting Notes (`insights.meetingNotes` → `meeting_notes`). Summaries the system itself produces
from recordings (`meeting_analyses`, status `completed`: topic, key insight, action items) are ignored,
so a recorded meeting with no Notion note ("התייעצות עם ליאור") is missing from the day summary, and where
both exist Hugo prefers Notion.

## Rule (default, no setting)

Per meeting: **system summary first, Notion note only as a fallback.** This follows
"ARO is the source of truth, Notion fills gaps" (memory `aro-is-source-of-truth-not-notion`).

- A meeting with a completed system analysis → its summary is what Hugo gets; the Notion note body for that
  meeting is not passed along (no double reporting).
- A meeting without a system analysis → the Notion note, as today.
- A meeting with a system analysis but no Notion note → still returned (synthetic entry), for day /
  prepDate / meetingId lookups.
- When several completed analyses exist for a meeting, the newest wins.

## Design

One place, so every consumer follows the rule: `insights.meetingNotes` (used by `get_notion_meeting_notes`,
the daily summary cron, morning briefing and prep).

- New `packages/api/src/services/system-summaries.ts`:
  `loadSystemSummaries(db, meetingIds)`, `systemSummaryText(analysis)`, and the pure
  `mergeSystemFirst(notes, summaries, meetingsForSynthetic)`.
- Merged entries carry `sourceKind: 'system'`; `bodyText` = system summary text
  (topic, key insight, action items with owners, open question), `snippet` = key insight.
- Synthetic entries only for `date` / `prepDate` / `meetingId` lookups, not for person/project/query lookups
  (those still replace Notion bodies when a system summary exists).
- Daily summary cron wording and the Hugo card / tool description say "system summary first, Notion fallback".

## API shape

`insights.meetingNotes` result entries are unchanged in shape. New values: `sourceKind: 'system'`,
`notionUrl: null` and `id: 'sys_<analysisId>'` for synthetic entries.

## Out of scope

- A user setting to flip the order.
- `person-context` and other code that reads `meeting_notes` directly.
- Changing how analyses are produced.

## Acceptance

- [ ] Meeting with both → Hugo gets the system summary, not the Notion body.
- [ ] Meeting with only Notion → unchanged.
- [ ] Meeting with only a system analysis → appears in the day's notes with `sourceKind: 'system'`.
- [ ] Pending/failed analyses are ignored.
- [ ] Newest completed analysis wins.
- [ ] Daily summary context says system summaries are primary.
