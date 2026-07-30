# Spec — Meeting Prep Herald grounding (no invention)

Slug: `fix-meeting-prep-grounding`
Stack: `next-trpc-monorepo` (Next.js + tRPC + Drizzle) + ABC markdown (`A_Agents/`, `S_Skills/`)
Type: Bugfix / behavior hardening

## Problem

`04_meeting_prep_herald` writes meeting-prep content that was never in the user's data —
invented participants ("1:1 with X" inferred from the calendar title), fabricated "last
time we met" notes, and speculative decisions/questions. This happens even though the
agent card already says "Do NOT guess or rely on memory."

### Root cause

Behavior is defined in ABC markdown, but at runtime nothing forces grounding:

1. Tools are optional — Gemini runs with `FunctionCallingMode.AUTO`, so it can answer from
   the injected snapshot (or general knowledge) without calling `get_notion_*`.
   ([apps/web/src/lib/gemini-agent-engine.ts](apps/web/src/lib/gemini-agent-engine.ts))
2. The output template requires generative sections ("🎯 Today's focus", "Next pushes",
   "Questions") that get filled even when there is no underlying task/note data.
   ([A_Agents/04_meeting_prep_herald.md](A_Agents/04_meeting_prep_herald.md),
   [S_Skills/wf_meeting_prep.md](S_Skills/wf_meeting_prep.md))
3. Injected Google Calendar context has no attendees, so the model infers participants
   from the title unless it calls `get_notion_people`.
4. The engine's "no text after tools" fallback tells the model to "write your complete
   answer" with no "only from tool results / say unknown" constraint.

## Change

### A. ABC behavior (source of truth for what the agent does)

- `A_Agents/04_meeting_prep_herald.md`
  - Add a hard grounding rule: state facts only from injected context / tool results; when
    a datum is missing, write an explicit "לא נמצא בנתונים" marker instead of filling it.
  - Rework the output format so factual sections (participants, "last time we met",
    important flags) are shown only when backed by data; strategic sections (focus / next
    pushes / questions) must be clearly marked as recommendations
    ("המלצה — לא מהנתונים") and omitted when there is no factual basis.
  - Require calling at minimum `get_notion_tasks` + `get_notion_meeting_notes` every run;
    for a focused meeting also the relevant `get_notion_people` / `get_notion_projects` /
    `get_notion_companies`.
  - Forbid inferring participants from the meeting title.
- `S_Skills/wf_meeting_prep.md`
  - Mirror the same rules in Stage 2 (Gather) and Stage 4 (Brief) and Error Handling:
    missing notes/people → say so, do not invent.

### B. Runtime enforcement (04-specific, minimal)

- `apps/web/src/lib/gemini-agent-engine.ts`
  - After the tool loop for `04_meeting_prep_herald`, if no grounding tool was called
    (`get_notion_tasks`, `get_notion_meeting_notes`, `get_notion_people`,
    `get_notion_projects`, `get_notion_companies`, `get_notion_meetings`,
    `get_next_meeting_brief`, `search_notion`), send one retry prompt instructing it to
    call the tools now, not invent, and mark gaps. Bounded (single retry).
  - Strengthen the existing "no text after tools" fallback prompt: answer only from tool
    results; if a datum is missing, say it is missing rather than inventing.

## Out of scope

- Fixing production Notion wiring (`NOTION_ACCOUNTS` DB IDs + sharing) — separate task.
- Changing Hugo delegation behavior across all scenarios — only revisit if invention
  persists after A + B.

## Files

- `A_Agents/04_meeting_prep_herald.md`
- `S_Skills/wf_meeting_prep.md`
- `apps/web/src/lib/gemini-agent-engine.ts`
- `apps/web/src/lib/gemini-agent-engine.meeting-prep.test.ts` (new) — verify the retry
  triggers only for `04` when no grounding tool was called.

## Acceptance criteria

- With no meeting notes / no people data, the briefing does not fabricate "last time we
  met" content or participants — it states the gap.
- A `04_meeting_prep_herald` run that produced no grounding tool calls triggers exactly one
  grounding retry; runs that did call a grounding tool do not retry.
- Strategic sections are present only with a factual basis and are marked as
  recommendations.
- Web unit tests pass; edited TS files have no new lint/type errors.
