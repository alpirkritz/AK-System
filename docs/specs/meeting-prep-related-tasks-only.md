# Meeting Prep — related tasks only (no full dump)

> **Slug:** `meeting-prep-related-tasks-only`
> **Status:** Approved
> **Last Updated:** 2026-07-19
> **Stack:** `next-trpc-monorepo`

## Goal

When `04_meeting_prep_herald` finds no tasks related to a specific meeting, it currently (or may) dump the user's full open-task list into the briefing. That makes WhatsApp/ARO replies long and unhelpful.

Require: **only meeting-related tasks**; if none match, state that clearly and stop — do not list unrelated tasks.

## User Stories

- As the owner, I want meeting prep to show only tasks relevant to that meeting so the brief stays purposeful.
- As the owner, if nothing related exists, I want a one-line "not found" — not my entire backlog.

## Acceptance Criteria

- [ ] Per meeting, open-items section includes **only** tasks linked by person/company/project/topic/title match to that meeting.
- [ ] If zero related tasks: write a short line such as `לא נמצאו משימות קשורות לפגישה זו` (or English equivalent) — **do not** list other open tasks.
- [ ] Same rule on WhatsApp, Telegram, and ARO.
- [ ] Keep the briefing short: no full backlog dump under any section.
- [ ] Existing grounding rules (no invention, `לא נמצא בנתונים` for missing notes/participants) remain.
- [ ] Prompt-contract / override test asserts the related-tasks-only rule is present for `04`.

## Data Model

No schema changes.

## tRPC API

No procedure changes.

## UI Surface

No UI chrome changes — chat message content only.

## Implementation Plan

1. `A_Agents/04_meeting_prep_herald.md` — harden task-filter + empty-state wording; concise channel note.
2. `S_Skills/wf_meeting_prep.md` — Stage 2.1 / 4.1 / Error Handling mirror the rule.
3. `apps/web/src/lib/gemini-agent-engine.ts` — hard override for `04` (like calendar secretary brief).
4. Test: assert override strings in system instruction for `04`.

## Out of Scope

- Changing Notion sync or task-to-meeting DB linking.
- Morning Briefing agent (`03`) backlog behavior.
- Inventing relatedness heuristics in code (prompt-level filter only for this change).

## Open Questions

None — approved with calendar brief session (same purposeful WhatsApp tone).
