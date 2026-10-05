# Collapsible Meeting Notes Section on Project Detail Page

> **Slug:** `project-meeting-notes-collapse`
> **Status:** Implemented
> **Last Updated:** 2026-09-29

## Goal

The project detail page (`/projects/[id]`) renders the "סיכומי ישיבות" (meeting notes) block with every note card visible and pre-expanded to its preview blocks. On projects with several meeting notes this makes the page very long and noisy, even though each individual `NotionSummaryCard` already has its own "read more" control. The user wants a more compact default view: the whole meeting-notes block should be collapsible as one section, closed by default, so the page reads as a short overview unless the person explicitly wants to look at meeting history.

## User Stories

- As Alpir, I want the "סיכומי ישיבות" block on a project page to start collapsed so the project page is short and scannable.
- As Alpir, I want to click the section header to expand/collapse it when I do want to read the notes.
- As Alpir, I want the section to clearly show how many notes exist even while collapsed, so I know there's something behind it.

## Acceptance Criteria

- [ ] On `/projects/[id]`, the "סיכומי ישיבות (N)" block is wrapped in a collapsible section with a clickable header (mouse + keyboard) and a chevron indicator.
- [ ] The section defaults to **collapsed** on page load whenever `meetingNotes.length > 0`.
- [ ] Clicking (or pressing Enter/Space while focused on) the header toggles the section open/closed; the chevron rotates to reflect state.
- [ ] The header uses `aria-expanded` and the content region uses a matching `id`/`aria-controls` pair for accessibility.
- [ ] No other section on the page (people roster, meetings, tasks) changes behavior — this only touches the meeting-notes block.
- [ ] Existing `NotionSummaryCard` per-card "קרא עוד/צמצם" behavior is unchanged once the section is open.
- [ ] Visual style matches existing conventions: `.card`, `text-xs font-semibold text-[#5a688c] uppercase tracking-wider` header label, dark theme colors, RTL layout (chevron flips correctly in RTL).
- [ ] Works on mobile widths (no layout break in the single-column grid).

## Data Model

None. Purely client-side UI state (`useState` in the page component). No schema, tRPC, or persistence changes.

## tRPC API

None. No new or modified procedures.

## UI Surface

- `apps/web/src/app/projects/[id]/page.tsx` — wrap the existing `meetingNotes.length > 0 && (...)` block (lines ~152-168) in a new small presentational component instead of a bare `<div className="mb-6">`.
- New component: `apps/web/src/app/projects/components/CollapsibleSection.tsx` — generic, reusable header+chevron+content wrapper (`title`, `count`, `defaultOpen`, `children` props) so the same pattern can be reused for other sections later (out of scope for this change, but the component should not be project-notes-specific in its API).
- Behavior: `defaultOpen` passed as `false` for the meeting-notes usage. Toggle is local `useState`; no persistence across page reloads in this iteration (see Open Questions).
- Desktop and mobile: same collapse behavior, no separate mobile variant needed (single column already responsive).

## Out of Scope

- Collapsing/restructuring the people roster, meetings list, or tasks list sections.
- Persisting collapse state across sessions (localStorage/DB) — can be a fast follow if wanted.
- Changing `NotionSummaryCard`'s internal per-note preview/expand logic.
- Any change to the `/meetings` list page or meeting detail page.

## Open Questions

- Should collapse state persist per-project (e.g. localStorage keyed by project id) across visits, or is resetting to collapsed on every load acceptable? Defaulting to "always collapsed on load" for this iteration; can revisit if it feels wrong in practice.
