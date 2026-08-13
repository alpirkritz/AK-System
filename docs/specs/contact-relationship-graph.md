# Contact Relationship Graph

> **Slug:** `contact-relationship-graph`
> **Status:** Implemented
> **Last Updated:** 2026-08-12

## Goal

Build a single relationship graph in AK System so the product understands *who* contacts are and *in what context* they appear. A canonical `people` row can carry many external identities (multiple Notion People databases, Google Contacts, Slack, calendar email). Notion meeting notes remain the hub for meeting↔people↔project associations: Notion is the inbound source of truth for that graph, the same edges surface on `/people` and `/projects`, app edits write back to Notion where linked, and a later insights layer derives relationship context from the persisted graph (not from ad-hoc live Notion scrapes).

Builds on: [`notion-tasks-people-sync`](notion-tasks-people-sync.md), [`notion-task-people-relation-push`](notion-task-people-relation-push.md), [`meeting-relationships-recurring-people`](meeting-relationships-recurring-people.md). Insights UX patterns may mirror [`whatsapp-group-insights`](whatsapp-group-insights.md) / [`finance-insights-engine`](finance-insights-engine.md) without reusing their data models.

## User Stories

- As the owner, I want every Notion People directory I configure (not just one) to map into the same CRM person when it is the same human, so relations from DT / Con / DAZ / personal directories all attach correctly.
- As the owner, I want Notion AI meeting notes linked to people and projects in Notion to appear on those people’s drawers and on project pages in the app, so I do not open Notion to recall context.
- As the owner, I want a project page to show its people roster and recent meeting summaries, so I see who is involved and what was discussed.
- As the owner, when I change a project↔people or note↔people association in the app for a Notion-linked row, I want Notion updated too (same never-throw write-back pattern as tasks).
- As the owner, I want Google Contacts (and later Slack) to attach as additional identities on the same person, so calendar, Notion, and chat refer to one contact.
- As the owner, I want relationship insights (last contact, cadence, shared projects, recent note snippets) on a person, so prep and CRM views answer “who is this and why do we talk?”

## Acceptance Criteria

Phased. Later phases depend on earlier ones. Implement in order 0 → 5.

### Phase 0 — Identity foundation

- [ ] New table `person_external_ids` exists in **both** `packages/database/src/schema.ts` and `schema.pg.ts`, with SQLite bootstrap in `packages/database/src/index.ts`.
- [ ] Columns: `id`, `personId` (FK → `people.id`, `onDelete: cascade`), `provider` (`notion` | `google_contact` | `slack` | `email`), `accountKey` (Notion account label / Google account email / Slack workspace id), `externalId` (Notion page id, Google resource name, Slack user id, or normalized email), `displayName` (nullable), `raw` (nullable text/JSON), `createdAt`, `updatedAt`.
- [ ] Unique index on `(provider, account_key, external_id)`; index on `person_id`.
- [ ] Const `PERSON_EXTERNAL_PROVIDERS` exported alongside `PEOPLE_SOURCES`.
- [ ] Existing `people.notion_page_id` rows are backfilled into `person_external_ids` with `provider='notion'` (account key from last known sync provenance when available, else `'legacy'`). Column `people.notion_page_id` stays nullable for back-compat; all new Notion people syncs write/update `person_external_ids` and may refresh `notion_page_id` as a denormalized “primary” (first / preferred directory) only.
- [ ] Notion people sync (`packages/api/src/services/notion-tasks-sync.ts` or extracted helper) upserts **every** configured `people`-type database into identities (not only the first / DAZ).
- [ ] Dedup into one `people` row: hit on `(provider, account_key, external_id)` → else case-insensitive email match on confirmed people → else exact name + same `companyId` hint → else create. Never auto-merge two confirmed people with conflicting non-null emails; leave the new identity on a new/unconfirmed row for the review queue.
- [ ] `people.merge` re-points all `person_external_ids` from `fromId` → `toId` (and continues to re-point `meeting_people` / task links as today).

### Phase 1 — Persist Notion relationship graph

- [ ] Sync service (new `packages/api/src/services/notion-graph-sync.ts`, or extension of tasks sync) reads configured Notion DBs of types `projects`, `companies`, `meeting_notes` (and optionally `meetings` for match-only).
- [ ] `companies` gain `notion_page_id` (nullable, indexed) in both schemas + SQLite bootstrap.
- [ ] `projects` gain `notion_page_id` (nullable, indexed), `company_id` (nullable FK → `companies`, `onDelete: set null`), `source` (`manual` | `notion`, default `manual`) in both schemas + bootstrap. Export `PROJECT_SOURCES`.
- [ ] New `meeting_notes` table: `id`, `title`, `date` (nullable), `snippet` (nullable), `notion_url` (nullable), `notion_page_id` (indexed), `meeting_id` (nullable FK → `meetings`, `onDelete: set null`), `notion_account`, `notion_db`, `source` default `notion`, `created_at`, `updated_at`.
- [ ] New M2M: `project_people` (`project_id`, `person_id`), `meeting_note_people` (`meeting_note_id`, `person_id`), `meeting_note_projects` (`meeting_note_id`, `project_id`) — cascade delete on both sides; indexes on each FK.
- [ ] Relation page IDs from Notion resolve via `person_external_ids.external_id` (for people) and `projects.notion_page_id` / `companies.notion_page_id` — works across all people directories.
- [ ] Meeting-note → local `meetings` attach heuristic (default): same calendar day + fuzzy title match; if no match, leave `meeting_id` null (orphan note still linked to people/projects). Do **not** create stub meetings.
- [ ] Property names discovered via Notion database schema heuristics (relation targets / name regex for people|projects|companies|meeting); no hardcoded single Hebrew/English property name.
- [ ] Window default **90 days** for `meeting_notes` (created_time or last_edited_time); projects/companies sync full configured DBs (or capped reasonably if huge — document cap in service).
- [ ] Idempotent by `notion_page_id`; prune Notion-sourced `meeting_notes` (and their M2M rows) no longer in window; never delete `source='manual'` projects or manually created companies.
- [ ] tRPC router `notionGraph` registered in `packages/api/src/index.ts`: `configured` + `sync` (see tRPC API).
- [ ] Cron [`apps/web/src/app/api/cron/notion-sync/route.ts`](../../apps/web/src/app/api/cron/notion-sync/route.ts) also calls `notionGraph.sync` (or shared service) after/with task sync; failures isolated per subsystem in the JSON result.
- [ ] Vitest coverage for identity upsert across two people DBs, relation resolution, note↔meeting match, idempotency, prune.

### Phase 2 — UI hierarchy

- [ ] `people.getRelated` extended return shape includes: existing `meetings`, `tasks`, `cadence`; plus `projects` (via `project_people`), `meetingNotes` (via `meeting_note_people`, newest first, capped e.g. 20), `identities` (from `person_external_ids`).
- [ ] New `projects.getRelated` query: `{ people, meetings, tasks, meetingNotes }` for that project id.
- [ ] [`PersonDetailDrawer`](../../apps/web/src/components/people/PersonDetailDrawer.tsx): sections **פרויקטים**, **סיכומי ישיבות**, read-only identity chips (e.g. “Notion · DAZ People”, “Google”, “Slack”).
- [ ] [`apps/web/src/app/projects/[id]/page.tsx`](../../apps/web/src/app/projects/[id]/page.tsx): people roster + meeting notes list; note links to `/meetings/[id]` when `meeting_id` set, else external Notion URL when present.
- [ ] [`apps/web/src/app/meetings/[id]/page.tsx`](../../apps/web/src/app/meetings/[id]/page.tsx): block listing linked `meeting_notes` for that meeting (title, date, snippet, Notion link).
- [ ] Manual sync control “סנכרן מ-Notion” on projects list or settings (mirror tasks page): `notionGraph.configured` + `notionGraph.sync`; Hebrew RTL; `.btn` / `.card` design system.
- [ ] No mobile work in this phase.

### Phase 3 — App → Notion write-back for associations

- [ ] `projects.setPeople` mutation: replaces `project_people` for a project; if project has `notion_page_id`, push People (and/or Projects-directory) relations via write-back helper patterned on `pushTaskPeople` in `packages/api/src/services/notion-task-writeback.ts` — resolve names **per target directory**, never assume a single global Notion page id.
- [ ] Optional v1: editing meeting↔people in the app for calendar meetings does **not** invent Notion meeting pages; write-back applies only when the local row (project / meeting note) already has `notion_page_id`.
- [ ] Mutations return `{ ok: true, notionSync }` (same shape family as `tasks.setTaskPeople`); UI toasts Hebrew failure copy when push fails; local links still saved (or document parity with tasks: local first, toast on Notion miss — match existing task behavior).
- [ ] Conflict rule: explicit app mutation PATCHes Notion; next inbound sync reconciles. Sync must not wipe relation fields the app just wrote within the same run without reading Notion’s post-PATCH state. No silent overwrite of Notion-only properties the app does not edit.
- [ ] Vitest for push: multi-directory resolve, empty list clears relation, no-match skips wipe.

### Phase 4 — Additional source connectors

- [ ] Google Contacts sync service + `contacts.syncGoogle` mutation: for each connected Google account used for calendar (see `google_connections` / multi-account patterns), pull contacts; upsert `person_external_ids` with `provider='google_contact'`; soft-match to existing people by email first, else create `unconfirmed` person for review queue when no safe match.
- [ ] Calendar attendee linking writes `provider='email'` identity (`account_key` = calendar source, `external_id` = lowercased email) when creating/linking people in `meetings.syncFromCalendar`.
- [ ] Slack: schema + provider value supported in Phase 0; live Slack user sync only when a Slack token/integration exists — until then, no Slack UI. Spec does not block Phases 0–3 on Slack.
- [ ] OAuth / scopes for Google Contacts documented in Open Questions with default: reuse existing Google OAuth connection and add Contacts scope when implementing Phase 4.

### Phase 5 — Relationship insights

- [ ] New read procedure `insights.personContext` (auth required): input `{ personId: string }` → `{ lastContactAt, cadence, sharedProjects, recentMeetingNotes, identitySources, meetingCount }` computed **only** from persisted DB graph (meetings, notes, projects, identities) — no live Notion fetch in this procedure.
- [ ] Person drawer shows an **הקשר** / insights section fed by `insights.personContext`.
- [ ] Out of scope for this phase: predictive scoring, auto-send messages, Slack/Gmail body archival, agent tool wiring (follow-up spec).

## Data Model

All additive changes in **both** `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres), plus guarded SQLite `ALTER` / `CREATE TABLE IF NOT EXISTS` in `packages/database/src/index.ts`.

### `person_external_ids` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `person_id` | text FK → `people.id` | `onDelete: cascade`, indexed |
| `provider` | text not null | `notion` \| `google_contact` \| `slack` \| `email` |
| `account_key` | text not null | Notion account label, Google account, Slack workspace, or `calendar` / `legacy` |
| `external_id` | text not null | Page id / resource name / user id / email |
| `display_name` | text nullable | |
| `raw` | text nullable | Optional JSON blob for connector debug |
| `created_at` / `updated_at` | text not null | |

Unique: `(provider, account_key, external_id)`.

### `people` (existing)

- Keep `notion_page_id` nullable (denormalized primary Notion page for legacy callers).
- Sync always maintains `person_external_ids`.

### `companies` (existing)

- Add `notion_page_id` text nullable + index `idx_companies_notion_page_id`.
- Add `source` text not null default `manual` (`manual` \| `notion`) if useful for prune rules; otherwise Notion-linked rows identified solely by non-null `notion_page_id`.

### `projects` (existing)

- Add `notion_page_id` text nullable + index.
- Add `company_id` text nullable FK → `companies.id` `onDelete: set null` + index.
- Add `source` text not null default `manual` (`manual` \| `notion`).

### `project_people` (new)

| Column | Notes |
|---|---|
| `project_id` | FK → `projects.id` cascade |
| `person_id` | FK → `people.id` cascade |

Indexes on both FKs. Composite uniqueness `(project_id, person_id)`.

### `meeting_notes` (new)

| Column | Notes |
|---|---|
| `id` | text PK |
| `title` | text not null |
| `date` | text nullable (`YYYY-MM-DD`) |
| `snippet` | text nullable — short plain excerpt, not full Notion blocks |
| `notion_url` | text nullable |
| `notion_page_id` | text nullable, indexed |
| `meeting_id` | text nullable FK → `meetings.id` `onDelete: set null` |
| `notion_account` / `notion_db` | text nullable provenance |
| `source` | text not null default `notion` |
| `created_at` / `updated_at` | text not null |

### `meeting_note_people` / `meeting_note_projects` (new)

M2M join tables mirroring `meeting_people` / `task_people` shape (two FKs, cascade, indexes, composite unique).

### Hierarchy (logical)

```
Company
  ├── People (company_id + identities)
  └── Projects (optional company_id)
        ├── project_people
        ├── Meetings (meetings.project_id — calendar SoR)
        └── Meeting notes (meeting_note_projects)
              ├── meeting_note_people
              └── optional meetings.id attach
```

## tRPC API

All procedures `protectedProcedure` (auth required).

### Router `notionGraph` — `packages/api/src/routers/notion-graph.ts` (new)

- `configured: query() -> { configured: boolean, databases: { type: string, name: string, account: string }[] }`
  - True when any account has at least one of `projects` | `companies` | `meeting_notes` | `people` configured.
- `sync: mutation(input: { windowDays?: number (default 90), dryRun?: boolean (default false) }) -> NotionGraphSyncResult`
  - Shape: `{ companiesUpserted, projectsUpserted, notesUpserted, notesPruned, peopleIdentitiesUpserted, linksRewritten, errors: string[] }`
  - Calls `syncNotionGraph(opts, ctx.db)` in `packages/api/src/services/notion-graph-sync.ts`.

### Extend `people` — `packages/api/src/routers/people.ts`

- `getRelated` return adds:
  - `projects: { id, name, color }[]`
  - `meetingNotes: { id, title, date, snippet, notionUrl, meetingId, projectIds: string[] }[]`
  - `identities: { id, provider, accountKey, externalId, displayName }[]`
- `merge` also moves `person_external_ids`.

### Extend `projects` — `packages/api/src/routers/projects.ts`

- `getRelated: query({ id }) -> { people, meetings, tasks, meetingNotes }`
- `setPeople: mutation({ projectId, personIds: string[] }) -> { ok: true, notionSync }`

### Phase 4 — `contacts` router (new or under `people`)

- `syncGoogle: mutation({ dryRun?: boolean }) -> { identitiesUpserted, peopleCreated, unmatched, errors: string[] }`

### Phase 5 — `insights` router (extend existing if present, else new)

- `personContext: query({ personId: z.string().min(1) }) -> PersonContextInsight`

Register new routers in `packages/api/src/index.ts` `appRouter`.

## UI Surface

| Route / component | Change |
|---|---|
| `apps/web/src/components/people/PersonDetailDrawer.tsx` | Projects, meeting notes, identity chips; Phase 5 insights block |
| `apps/web/src/app/people/page.tsx` | No list redesign required; drawer gains data |
| `apps/web/src/app/projects/page.tsx` | Optional sync button + invalidate related queries |
| `apps/web/src/app/projects/[id]/page.tsx` | People roster, meeting notes list |
| `apps/web/src/app/meetings/[id]/page.tsx` | Linked Notion summaries |
| Design system | Hebrew RTL, dark theme, `.btn` / `.card` / `.input` — no new visual language |

Mobile: out of scope for this epic (follow-up under mobile parity specs).

## Out of Scope

- Replacing Google/Apple calendar as the creator of `meetings` rows.
- Full Notion page body / block sync (snippet + Notion URL only).
- Mobile UI parity.
- Auto-merge of identities when emails conflict (review queue only).
- Full Slack message warehouse or Gmail body indexing.
- Org-chart manager/reports tree.
- Predictive ML scoring or automated outreach.
- Changing Hugo agent tools in this epic (agents may later read `insights.personContext` in a follow-up).
- Bidirectional sync of calendar meeting creation into Notion Meetings DB.

## Open Questions

- Exact Notion relation property names for `meeting_notes` / `projects` / `companies` — **default:** discover via schema heuristics at sync time (same family as task people relation detection).
- Whether `companies.source` is required — **default:** identify Notion companies by non-null `notion_page_id` only unless prune rules need `source`.
- Google Contacts OAuth: which scopes and which of the multi-Google accounts — **default:** all accounts already connected for calendar; add Contacts readonly scope at Phase 4 implementation.
- Slack workspace token source — **default:** defer live sync until a Slack integration exists; provider enum ready from Phase 0.
- Cap on projects/companies full-DB sync size — **default:** sync all pages with pagination; revisit if a directory exceeds ~2k pages.
- Denormalized `people.notion_page_id` “primary” selection when multiple Notion identities exist — **default:** prefer identity from the account/db used most recently in task write-back, else first inserted.
