# Review — Notion People Source Manager (paste-a-link database registration)

> **Slug:** `notion-people-source-manager`
> **Spec:** `docs/specs/notion-people-source-manager.md`
> **Date:** 2026-09-30
> **Verdict:** APPROVED

## Scope reviewed

Self-service registration of additional Notion "people" databases from Settings ← מקורות, without editing the `NOTION_ACCOUNTS` env var or redeploying. Owner picks a configured account, pastes a Notion database's "Copy link" (or bare id), the server extracts and validates the id against that account's token (`GET /v1/databases/{id}`), previews the resolved title, and on confirm stores it in a new `people_notion_sources` table. The People pass in the sync engine now scans env-configured **and** custom sources together.

## Changes

| Area | File | Notes |
|---|---|---|
| Schema (SQLite + Postgres) | `packages/database/src/schema.ts`, `schema.pg.ts` | New `people_notion_sources` table (`id`, `account_label`, `notion_database_id` unique, `notion_database_name`, `created_at`) — not workspace-scoped, matching how people sync already ignores workspaces |
| Bootstrap | `packages/database/src/index.ts` | `PEOPLE_NOTION_SOURCES_TABLE` SQLite bootstrap block; `peopleNotionSources` export + `PeopleNotionSource`/`NewPeopleNotionSource` types |
| Sync engine | `packages/api/src/services/notion-tasks-sync.ts` | Refactored `resolveDatabases` onto a shared `parseNotionAccounts()` (behavior-preserving); added `listNotionAccountLabels`, `findNotionAccountToken`, `resolvePeopleDatabases(db)` (env + custom, reports a mismatched `accountLabel` in `errors` instead of silently dropping it), `extractNotionDatabaseId(link)`. The People pass (line ~631) now calls `resolvePeopleDatabases` instead of `resolveDatabases('people')` directly |
| Notion helper | `packages/api/src/services/notion-people-directory.ts` | New `fetchDatabaseInfo(token, id)` — `GET /v1/databases/{id}`, returns `{ title, properties }`; used to validate + preview a pasted link before it's registered |
| tRPC | `packages/api/src/routers/people.ts` | `notionAccounts`, `notionSources`, `resolveNotionDatabaseLink`, `addNotionSource`, `removeNotionSource` |
| UI | `apps/web/src/app/settings/workspaces/page.tsx` | New "בסיסי נתונים של אנשים ב-Notion" card: env sources shown read-only ("מוגדר בקוד"), custom sources removable |
| UI | `apps/web/src/components/Modals/AddPeopleSourceModal.tsx` (new) | Account select + link paste → "בדוק" (resolve/preview) → "הוסף" (confirm) |
| Test infra | `packages/api/src/test-utils.ts` | `resetDb()` now also clears `peopleNotionSources` |
| Tests | `packages/api/src/services/notion-tasks-sync.test.ts` | +11 cases: `extractNotionDatabaseId` (share-link, dashed id, bare id, invalid, and a specific regression case below), `listNotionAccountLabels`/`findNotionAccountToken`, `resolvePeopleDatabases` (env-only, env+custom merge, stale-account-label error, and an end-to-end check that a registered custom source is actually scanned by `syncNotionTasks`) |
| Tests | `packages/api/src/routers/people.test.ts` | +9 cases covering all 5 new procedures, including the "integration lacks access" (non-2xx) path via a mocked `fetch` |

## A bug caught during test-writing (fixed, not just worked around)

The first `extractNotionDatabaseId` implementation stripped all dashes from the input *before* searching for a 32-hex run. That's wrong for real Notion share links (`.../Page-Title-<32hexid>?v=...`): stripping the dash between the title slug and the id can glue a trailing hex-valid letter from the slug onto the id and shift the whole match by one character — concretely, a slug ending in "...People-<id>" would swallow the "e" from "People" once its separating dash was gone. Caught by a Vitest assertion mismatch during QA, not by inspection. Fixed by no longer stripping dashes: the function now tries a classic dashed-UUID shape first, then falls back to a *maximal* 32-hex run bounded by non-hex characters on both sides — which naturally respects the hyphen Notion's own links already provide as a boundary. A regression test locks this in (`is not confused when the title slug ends in a hex-valid letter right before the id`).

## Spec conformance

- [x] Env-configured people sources keep working unchanged (`resolveDatabases('people')` behavior preserved by construction — same output for the same env, verified by existing + new tests).
- [x] Custom sources display distinctly from env sources ("מוגדר בקוד" vs. removable) and merge into the same sync pass.
- [x] Paste-a-link flow (no live search) — account picker + link/id input, "בדוק" preview step showing the resolved title before "הוסף" commits it.
- [x] Validation-before-Notion-call: an unparseable link is rejected with a clear message before any network call.
- [x] "Not shared with this integration" (403/404, indistinguishable) surfaced as a clear Hebrew message rather than a raw error.
- [x] Duplicate rejection (`CONFLICT`) whether the id collides with an env-configured or another custom source.
- [x] Removing a custom source stops it being scanned on the next sync; env sources have no remove action here (unchanged, env-only).
- [x] A custom source whose `accountLabel` no longer resolves to a configured account is skipped and reported in the sync's `errors` array, not silently dropped.
- [x] Token never persisted — `peopleNotionSources` stores only `accountLabel`; the token is resolved from `NOTION_ACCOUNTS` at sync/validate time.
- [x] Out-of-scope items honored: no live `/v1/search`, no extension to tasks/meetings/projects/companies, no auto-suggestion from task-DB relation directories, no editing (remove + re-add covers it).

## QA

Verified in an isolated, from-scratch Linux `pnpm install` (same rationale as the prior `people-sync-visibility` review — this sandbox is Linux, the project's installed `node_modules` on disk are macOS-built) — no changes made to the real project's installed dependencies.

- `vitest run` (packages/api, full suite): **925 of 926 passed.** The one failure is the same pre-existing, unrelated `voice-diarization.test.ts` bug flagged in the previous report (its own test helper calls `fs.statSync` on a path it expects not to exist, before the function under test ever runs) — confirmed unaffected by this change.
- `next lint` (apps/web): clean — no new warnings in `settings/workspaces/page.tsx` or `AddPeopleSourceModal.tsx`; all shown warnings are pre-existing, in untouched files.
- `pnpm --filter @ak-system/web build`: succeeded; `/settings/workspaces` grew 3.27 kB → 3.88 kB reflecting the new card, all other routes unaffected.
- Manual verification of the modal's two-step (resolve → add) UI flow and the card's env/custom badge distinction was done via code review against the existing `WorkspaceModal`/`NotionDatabaseLinks` pattern it mirrors, plus the passing router tests exercising every branch (bad link, unknown account, not-shared, success, duplicate, remove) — no live Notion credentials are available in this sandbox to click through it end-to-end.

## Nits (non-blocking)

- No Playwright coverage added, consistent with the same reasoning as the prior report: Notion isn't configured in the e2e environment, so `people.notionAccounts` returns empty and the whole card renders its "Notion לא מוגדר" empty state — there's nothing Notion-specific to click through there today.
