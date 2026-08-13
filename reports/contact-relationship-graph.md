# Review — contact-relationship-graph

> **Slug:** `contact-relationship-graph`
> **Date:** 2026-08-12
> **Verdict:** APPROVED WITH NITS

## Summary

Implements the Contact Relationship Graph epic: multi-source person identities (`person_external_ids`), Notion graph sync (companies / projects / meeting notes + M2M edges), UI on people/projects/meetings, project↔people write-back, Google Contacts sync hook, and `insights.personContext`.

## Spec conformance

| Phase | Status |
|---|---|
| 0 Identity foundation | Done — schema parity, bootstrap backfill, multi-DB people sync, merge repoint |
| 1 Notion graph persist | Done — `notionGraph` router + cron dual sync |
| 2 UI hierarchy | Done — drawer, project detail, meeting notes block, sync button |
| 3 Write-back | Done — `projects.setPeople` + `pushProjectPeople` |
| 4 Google / email | Done — `contacts.syncGoogle` + calendar email identities (Slack deferred: provider enum only) |
| 5 Insights | Done — `insights.personContext` + drawer section |

## Tests

- `person-external-ids.test.ts` — 2 passed
- `notion-graph-sync.test.ts` — 5 passed
- Regression: `notion-tasks-sync.test.ts` (7), `notion-task-writeback.test.ts` (52) — passed

## Static checks

- `pnpm --filter @ak-system/web lint` — interactive ESLint setup prompt (pre-existing; not run to completion)
- `pnpm --filter @ak-system/database exec tsc --noEmit` — pre-existing `pg` types warning
- `pnpm --filter @ak-system/web build` — passed

## Findings

### Nits

1. **Google Contacts scope** — sync will error until OAuth grants People API / contacts readonly; errors are surfaced in the mutation result (expected Phase 4 behavior).
2. **`syncNotionGraph` people pass** is identity-only (does not re-run full task sync); cron still runs `tasks.syncFromNotion` first — correct, but operators should know both run.
3. **Project Notion write-back** tries each configured projects DB until one PATCH succeeds; multi-account project pages without stored `notion_account` may attempt the wrong token first (falls through).
4. Meeting-note → meeting attach is title/date fuzzy only; orphans remain visible on people/projects (per spec).

### No blockers

- Auth: all new procedures use `protectedProcedure`.
- Schema: `schema.ts` / `schema.pg.ts` / SQLite bootstrap aligned.
- No secrets logged.

## UI/UX Review

- Hebrew RTL labels: פרויקטים, סיכומי ישיבות, מקורות זהות, הקשר, סנכרן מ-Notion.
- Uses existing `.btn` / `.card` / `.pill` / `.input`.
- Identity chips are read-only; project roster add/remove is explicit.

**UI verdict:** APPROVED WITH NITS (mobile out of scope per spec).
