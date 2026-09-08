# Readable Notion meeting summaries

> **Slug:** `notion-summary-readable`
> **Status:** Approved
> **Last Updated:** 2026-09-08
> **Stack:** `next-trpc-monorepo`

## Goal

Notion AI meeting notes on the meeting detail page are currently a clamped wall of plain text. Parse the stored `bodyText` into headings, labeled fields, and body copy, and render it with the existing dark-theme hierarchy so the summary is scannable without changing sync or storage.

## User Stories

- As the owner, when I open a meeting that has a Notion AI summary, I want section titles and labeled fields (e.g. "High-Level Outcome") to stand out so I can scan instead of reading a blob.
- As the owner, when a summary is long, I want a "קרא עוד" control instead of a silent `line-clamp`.
- As the owner, when notes came from the meeting page in Notion, I still want that source label and a link out to Notion.

## Acceptance Criteria

- [ ] Given a meeting with `meetingNotes.bodyText` that includes Title-Case section lines and `Label: paragraph` lines, when the meeting detail page renders, then those become distinct heading / labeled blocks — not one `whitespace-pre-wrap` paragraph.
- [ ] Given markdown headings / bullets / numbered lists in `bodyText`, when rendered, then they match the existing notification-body treatment (headings, teal bullets, numbered markers).
- [ ] Given a summary longer than the preview threshold, when collapsed, then a "קרא עוד ›" button appears; activating it shows the rest and "‹ צמצם".
- [ ] Given `sourceKind` starting with `meeting_page`, when rendered, then "מדף הפגישה ב-Notion" remains visible.
- [ ] Given `notionUrl`, when the title is clicked, then it opens the Notion page in a new tab.
- [ ] Given the card heading, when the page loads, then "סיכום AI (Notion)" remains the section label.
- [ ] No schema or tRPC changes. Person/project related-notes lists may reuse the same renderer.

## Data Model

None. Read-only UI over existing `meeting_notes.body_text`.

## tRPC API

None.

## UI Surface

- `apps/web/src/app/meetings/[id]/page.tsx` — replace the plain excerpt with `NotionSummaryCard`.
- Optional reuse: `apps/web/src/app/projects/[id]/page.tsx`, `apps/web/src/components/people/PersonDetailDrawer.tsx`.
- New: `apps/web/src/lib/notion-summary-format.ts` (parser), `apps/web/src/app/meetings/components/NotionSummaryCard.tsx`.
- Hebrew RTL, `.card`, tokens from `globals.css` (`#eef3fb`, `#97a4c2`, `#2dd4bf`, `#8b5cf6`). No new UI libraries.

Microcopy:

| Element | Copy |
|---|---|
| Section header | סיכום AI (Notion) |
| Page-notes badge | מדף הפגישה ב-Notion |
| Expand | קרא עוד › |
| Collapse | ‹ צמצם |

## Out of Scope

- Changing Notion flatten/extract (`notion-meeting-note-body.ts`)
- ConversationAnalysis (Gemini transcript analysis)
- Mobile app
- Editing Notion notes from this card

## Open Questions

None — shipping the meeting-detail renderer first; person/project reuse is included if cheap.
