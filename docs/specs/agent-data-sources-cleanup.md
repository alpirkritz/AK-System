# Spec: Agent Data Sources Cleanup (Meeting Prep 04 + Email Assistant 07)

> **Slug:** `agent-data-sources-cleanup`
> **Stack:** next-trpc-monorepo
> **Status:** Approved (user: "Implement the plan as specified")
> **Owner:** dev-agent
> **Created:** 2026-07-13

## Problem

`04_meeting_prep_herald` and `07_email_assistant` feel "disconnected" — their output is
generic and unrelated to the user's real data. Root cause: their agent cards and workflows
instruct them to read data sources that have **no tool or config mapping**, so the model
flails (hallucinates, apologizes, or ignores the real tools that do exist):

- `04_meeting_prep_herald` is told to read Notion "AI Meeting Notes", "Projects",
  "Companies", "People directory", and additional "Meetings" DBs. Only `get_notion_tasks`,
  `get_notion_meetings`, and `search_notion` (tasks + meetings only) exist. Real meeting
  context (participants, past notes) also lives in the local DB via `get_next_meeting_brief`
  and the injected Google Calendar block — none of which the card names.
- `07_email_assistant` references **Slack** (absent everywhere in the codebase) and vague
  "connected inboxes." The real tool is `search_gmail` (the `gmail.readonly` scope is present
  in `packages/api/src/google-calendar-auth.ts`), but the card never names it or a query, and
  no email/calendar context is injected.

Per user direction, the referenced Notion databases (People, Projects, Companies, Meetings,
AI Meeting Notes, Action items) should be **real, queryable sources**, with meeting events
coming from Google Calendar.

## Goals

- Wire the referenced Notion databases into the integration as typed, queryable tools.
- Realign the 04 and 07 agent cards + workflows to name the exact tools and real sources.
- Remove phantom sources (Slack; unwired Notion DB references).
- Email agent gets today's schedule injected for cross-referencing.

## Non-goals

- Building a Slack integration (flag if the user wants one later).
- Changing OAuth/token storage, the calendar pipeline, or the Notion archive flow.
- Building a config UI — new Notion DBs are added via the `NOTION_ACCOUNTS` env JSON.

## Changes

### 1. `apps/web/src/lib/notion-config.ts`

- Extend `NotionDbType` and `DB_TYPES` with `'people' | 'projects' | 'companies' | 'meeting_notes'`.
- Legacy accounts unchanged (they only carry `tasks` + `assistant`). New DBs come from
  `NOTION_ACCOUNTS`.

### 2. `apps/web/src/lib/notion.ts`

- Add a generic `getNotionEntries(type)` fetcher returning `{ account, db, title, date,
  status, people, snippet }` per page for `people` / `projects` / `companies` /
  `meeting_notes`, reusing existing `plain`/`getTitle`/`queryDatabase` helpers. Fault-tolerant
  per DB (one failing DB records an error, never blanks the result).
- Expand `searchNotion` targets to include the new types so "connect people/topics" works.
- Fold the most recent `meeting_notes` into `getNotionContext` (+ `formatNotionContextForPrompt`)
  so 04 receives recent-discussion context in its prompt.

### 3. `apps/web/src/lib/conversation-engine.ts`

- Add tools `get_notion_people`, `get_notion_projects`, `get_notion_companies`,
  `get_notion_meeting_notes` (thin wrappers over `getNotionEntries`). `search_notion` now
  covers the new DBs; update its description accordingly.

### 4. `apps/web/src/lib/abc-agents.ts`

- Add `07_email_assistant` to `CALENDAR_CONTEXT_AGENTS` so it receives today's schedule.

### 5. `A_Agents/04_meeting_prep_herald.md` + `S_Skills/wf_meeting_prep.md`

- Today's meetings authoritative from the injected Google Calendar block; enrich with
  `get_notion_meetings`, `get_notion_people` / `get_notion_projects` / `get_notion_companies`,
  action items via `get_notion_tasks`, and past notes via `get_notion_meeting_notes` +
  `get_next_meeting_brief`. Name exact tools; drop unwired-DB wording; add the partial-data
  warning pattern (never claim the day is empty when a source errored).

### 6. `A_Agents/07_email_assistant.md` + `S_Skills/wf_email_assistant.md`

- Replace "connected inboxes / Slack" with explicit `search_gmail` usage (`is:unread
  newer_than:2d`). Remove Slack. Cross-reference with `get_today_schedule` +
  `get_notion_meetings` / `get_notion_people`. If `search_gmail` returns an auth/scope error,
  report it — never fabricate threads.

## Config dependency

The People/Projects/Companies/Meetings/AI Meeting Notes/Action-items database IDs must be added
to the `NOTION_ACCOUNTS` env JSON (typed), and each DB shared with the Notion integration.
Example DB entry: `{"id":"<db-id>","name":"People","type":"people"}`. Verify via `notion_status`.

## Acceptance criteria

- [ ] New Notion DB types parse from `NOTION_ACCOUNTS`; `getDatabasesByType` returns them.
- [ ] `getNotionEntries` returns entries per type and records per-DB errors without blanking.
- [ ] `search_notion` matches titles in the new DBs.
- [ ] New tools appear in `getToolDeclarations()` and execute.
- [ ] `07_email_assistant` receives an injected calendar block.
- [ ] 04/07 cards + workflows name only real tools; no Slack/unwired-DB references remain.
- [ ] Vitest + web build + lint green.

## Test plan

- Unit: `notion-config` parses the four new types.
- Unit: `getNotionEntries('people')` returns entries and surfaces a broken-DB error;
  `searchNotion` matches a person title.
- Manual (EC2): configure the DB IDs, run `notion_status`, run 04 and 07 live, confirm real
  data appears; confirm `search_gmail is:unread` works on both accounts.

## Follow-up: person/entity relations (approved by user)

Meeting prep should surface each person's relations (company, projects, manager/reports-to)
so it can say "X (Acme) works on Project Z." Notion `relation` properties return only related
page IDs, so we resolve them to titles.

### Changes

- `apps/web/src/lib/notion.ts`:
  - Add `NotionEntry.relations: Record<string, string[]>` (property name -> related titles).
  - Capture all `relation`-typed properties per page (name -> related page IDs).
  - Add a cached, bounded `resolvePageTitle(token, id)` (module cache + global cap per call)
    to convert related IDs to titles; expose `__resetNotionCache()` for tests.
  - `getNotionEntries(type, opts)` gains `{ limit?, resolveRelations? }`. When
    `resolveRelations` is true, relation IDs are resolved to titles (capped) and attached.
- `apps/web/src/lib/conversation-engine.ts`: call `get_notion_people` / `get_notion_projects`
  / `get_notion_companies` with `resolveRelations: true`; leave injected `meeting_notes` off
  (keep prompt build fast).
- `A_Agents/04_meeting_prep_herald.md`: note that people/project/company entries include their
  relations (company/projects/manager) — use them to connect participants to context.

### Acceptance

- [ ] `getNotionEntries('people', { resolveRelations: true })` returns `relations` with
      resolved titles; resolution is cached and capped.
- [ ] Non-resolving calls (default) do no extra page fetches.
- [ ] Vitest covers relation resolution; build + web tests green.
