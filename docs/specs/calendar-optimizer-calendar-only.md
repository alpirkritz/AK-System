# Calendar Optimizer — calendar only, no due-today tasks

> **Slug:** `calendar-optimizer-calendar-only`
> **Status:** Approved (2026-09-23), including card authority: `/agents/manage` edits are what this agent follows. Code does not restate or override the card's sections.
> **Last Updated:** 2026-09-23
> **Stack:** `next-trpc-monorepo`
> **Narrows:** reminder/task wording in `docs/specs/calendar-brief-notion-parity.md` for `06_calendar_optimizer` only. Conflict, load, focus-window, no-tables, and no-meta rules stay.

## Goal

`06_calendar_optimizer` (יועץ יומן) keeps writing the owner's open tasks that are due today even after those lines are deleted from the agent card in `/agents/manage`. Stop every path that feeds that task list into this agent, so the brief is only the connected calendars: events, conflicts, load, and free windows.

## User Stories

- As the owner, I want יועץ יומן to talk only about the calendar, so I can read the day without a task list in the middle.
- As the owner, I want deleting task wording from the agent card to match what the agent actually does, so the UI is not a dead end.
- As the owner, I want other agents (Hugo, meeting prep, the morning template) to keep seeing tasks, so this change does not blank task context everywhere.

## Acceptance Criteria

- Given `06_calendar_optimizer` runs on any channel (`web`, `whatsapp`, `telegram`, `cron`), when the reply is composed, then it does not list, summarize, or name open tasks, tasks due today, overdue tasks, or Notion task-database rows. No section titled תזכורות / Reminders whose bullets are tasks. No line like `משימות להיום` or `Tasks — Due Today`.
- Given the same run, when there are timed calendar events, then the reply still has, in order: title, Quick Summary / סיכום מהיר, Today's Meetings / הפגישות להיום, Conflicts & Overlaps / קונפליקטים וחפיפות, Load Analysis / ניתוח עומס, Focus Time Opportunities / חלונות פוקוס, and optional Recommendations / המלצות for real conflicts or overload only. Focus-window lines name a clock range only; they do not name a task.
- Given the system instruction built for `06_calendar_optimizer`, when inspected, then it does not contain the headings `Tasks — Due Today`, `Tasks — Overdue`, or `Tasks — Soon`, and it does contain an explicit ban: do not list open or due tasks. The ban is a grounding rule, so standing instructions from `/memory` do not turn the task list back on.
- Given Notion has tasks due today, when this agent's prompt is built, then those task titles are not present in the injected Notion block. Meetings-today and meetings-upcoming lines may remain.
- Given this agent calls `get_today_schedule`, `get_day_schedule`, or `get_week_schedule`, when the tool returns, then the payload has calendar `events` and no `dueTasks` (omit the key). The same tools for every other agent still return `dueTasks`.
- Given this agent, when its tool list is built, then `get_open_tasks`, `get_overdue_tasks`, and `get_notion_tasks` are not declared. `get_next_meeting_brief`, if called by this agent, returns no `openTasks`.
- Given `morning_briefing` is routed to `06_calendar_optimizer`, when the cron builds the user message, then that message has events and no `משימות להיום` block. If `morning_briefing` is not routed, or is routed to any other agent, the existing task lines stay.
- Given prompt-contract tests, when `buildAgentSystemInstruction('06_calendar_optimizer')` runs with Notion tasks present in the fixture, then the instruction fails the test if a due-today task title or `Tasks — Due Today` appears.

## Data Model

No schema changes. `packages/database/src/schema.ts` and `schema.pg.ts` stay as they are. Tasks remain stored; this agent stops receiving them.

## tRPC API

No new or changed procedures. `packages/api/src/routers/*` unchanged. Task and calendar queries stay; the filter is in the agent prompt and tool layer (`apps/web/src/lib/`).

## UI Surface

No new routes. On `/agents/manage`, the instructions tab for `06_calendar_optimizer` states that the saved card is what the next run follows, and that a due-today task list is not injected unless the card contains a line `משימות להיום` or `include due tasks`. The hardcoded brief must not say it overrides the card and must not repeat the section list, so a delete or an added section in that editor is what the model sees.

Chat, WhatsApp, and Telegram keep rendering whatever text the agent returns. The change is the text, not the screens.

## Implementation notes

Cut these sources for `06_calendar_optimizer` only:

1. `apps/web/src/lib/gemini-agent-engine.ts` — `getCalendarOptimizerBriefOverride()`. Remove the "overrides the card" brief and the Reminders-from-tasks section. The block is delivery constraints only (no tables, no meta, calendar is the data source, do not invent) plus: follow the agent card below; do not list open/due/overdue tasks unless the card has a line `משימות להיום` or `include due tasks`. Section order lives in the card, so UI edits apply. In the PRECEDENCE paragraph for this agent only, standing memory cannot add that task list when the card does not request it. Pass `agentId` into tool execution.

2. `apps/web/src/lib/gemini-agent-engine.ts` — `buildSystemInstruction`. When `agentId` is `06_calendar_optimizer`, do not append the task sections from `formatNotionContextForPrompt` (`Tasks — Due Today`, `Tasks — Overdue`, `Tasks — Soon`) and do not append the Calendar Review page body (it is a previous brief and copies tasks back in). Prefer a flag on the formatter over dropping the agent from `NOTION_CONTEXT_AGENTS`, so meeting lines can stay.

3. `apps/web/src/lib/notion.ts` — `formatNotionContextForPrompt` accepts an option such as `{ omitTasks: true, omitCalendarReview: true }` used only by this agent. Default behavior for other callers stays.

4. `apps/web/src/lib/conversation-engine.ts` — tool declarations for this agent exclude `get_open_tasks`, `get_overdue_tasks`, `get_notion_tasks`. Schedule tools, when `toolCtx.agentId === '06_calendar_optimizer'`, return events without `dueTasks`. `get_next_meeting_brief` omits `openTasks` for this agent. Descriptions of schedule tools that this agent still sees must not say "and tasks due today".

5. `apps/web/src/app/api/cron/morning-briefing/route.ts` — resolve the routed agent before building context. If it is `06_calendar_optimizer`, call `formatMorningBriefingContext` with due tasks omitted (`apps/web/src/lib/morning-briefing-context.ts` gains an explicit omit flag; default remains include). Finance lines stay.

6. `A_Agents/06_calendar_optimizer.md` and `S_Skills/wf_calendar_optimizer.md` — delete the Reminders-from-tasks instruction. State that the brief does not list tasks. This keeps the UI copy aligned with the override; the override remains the one that actually runs.

## Out of Scope

- Hugo, `03_morning_briefing`, `04_meeting_prep_herald`, and any other agent: they still receive Notion task sections and task tools.
- The unrouted morning-briefing template (the message that is not an agent reply).
- Task reminder cron, dashboard task lists, and the tasks UI.
- Removing Notion meetings-today / meetings-upcoming from this agent's prompt.
- Calendar fetch, all-day / ≥8h exclusion, conflict detection, or the 4-hour load rule.
- A setting in the UI to toggle tasks back on.

## Open Questions

None.
