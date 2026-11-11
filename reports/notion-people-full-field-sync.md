# Review — Notion People Full-Field Sync (phone / role / company / linkedin)

> **Slug:** `notion-people-full-field-sync`
> **Spec:** `docs/specs/notion-people-full-field-sync.md`
> **Date:** 2026-09-30
> **Verdict:** APPROVED

## Scope reviewed

The People pass in the sync engine previously only extracted `name` + `email` from Notion people pages, leaving `phone`, `role`, `company`, and `linkedin` unpopulated even when the source database had matching properties. This feature extracts all four additional fields, using two distinct mechanisms depending on how the source database was registered:

- **Env-configured databases** (`NOTION_ACCOUNTS`): no interactive moment exists, so extraction is heuristic-only — a field with exactly one property of the matching type is used automatically; when there's more than one candidate, a name-pattern regex (e.g. `role|position|job|תפקיד` for role, `company|companies|חברה|לקוח` for the company relation, `linkedin` for the URL field) breaks the tie if it narrows to exactly one; otherwise the field is left unresolved rather than guessing.
- **Self-service sources** (`people_notion_sources`, added via Settings ← מקורות): the add-source modal now previews auto-detected candidates per field and lets the user confirm or override each one at add-time; the chosen property name (or an explicit "none") is pinned permanently on the source row and read directly thereafter, bypassing heuristics entirely.

Regardless of mechanism, an update to an already-matched local person only **fills blank fields** — a field that already has a non-null local value is never overwritten by a differing Notion value, protecting manually-entered or previously-synced data.

## Changes

| Area | File | Notes |
|---|---|---|
| Schema (SQLite + Postgres) | `packages/database/src/schema.ts`, `schema.pg.ts` | 4 new nullable columns on `people_notion_sources`: `phone_property_name`, `role_property_name`, `company_property_name`, `linkedin_property_name` |
| Bootstrap | `packages/database/src/index.ts` | `PEOPLE_NOTION_SOURCES_COLUMNS` — idempotent `ALTER TABLE ADD COLUMN` statements for the 4 new columns |
| Notion helper | `packages/api/src/services/notion-people-directory.ts` | `fetchDatabaseInfo` now also returns `properties` (already added in the source-manager feature; reused here to drive field-mapping detection) |
| Sync engine | `packages/api/src/services/notion-tasks-sync.ts` | `NotionDb` extended with 4 optional pinned-name fields; generic by-type property readers (`readPhoneNumber`, `readRichText`, `readRelationId`, `readUrl`) and `readPinned`; heuristic extractors (`getPhoneHeuristic`, `getRoleHeuristic`, `getCompanyRelationPageIdHeuristic`, `getLinkedinHeuristic`) built on a shared `pickHeuristic` (exactly-one-candidate, or exactly-one-after-name-hint); `resolveDatabaseFieldMappings(properties)` — the add-source-modal preview, returning `{candidates, auto}` per field; `resolveField()` dispatches pinned-vs-heuristic per database; `resolvePeopleDatabases` merges the 4 pinned names onto each custom row's `NotionDb`; company relation resolved to a local `companyId` via a `companies.notionPageId` lookup map (best-effort — resolves on a later sync if the company hasn't synced yet); People-pass upsert logic rewritten with the fill-blanks-only policy and `peopleUpdated` counting |
| tRPC | `packages/api/src/routers/people.ts` | `resolveNotionDatabaseLink` response extended with `fieldMappings: DatabaseFieldMappings`; `addNotionSource` input extended with the 4 pinned property-name fields (each `string \| null`, independently settable) |
| UI | `apps/web/src/components/Modals/AddPeopleSourceModal.tsx` | After "בדוק" resolves a database, one `<select>` per field that has ≥1 candidate property, pre-filled with the auto-detected pick (or blank when ambiguous) and an "זוהה אוטומטית — אפשר לשנות" hint; "הוסף" now sends the 4 chosen names alongside the existing inputs |
| Tests | `packages/api/src/services/notion-tasks-sync.test.ts` | +13 cases: `resolveDatabaseFieldMappings` unit tests (single-candidate auto-pick, name-pattern tiebreak among 2+ candidates, genuinely-ambiguous → `auto: null`); env-source extraction of phone/role/company/linkedin (unambiguous type match, and name-pattern tiebreak among two relations/two urls); a company relation with no matching local company yet resolving to `null` without an error (best-effort, not a failure); the fill-blanks-only policy on an already-matched existing person (differing phone never overwritten, blank role filled, `peopleUpdated` incremented); custom-source pinned-name reading (bypassing heuristics for a property name a regex would never match) and the "pinned to null → never filled" case |
| Tests | `packages/api/src/routers/people.test.ts` | Updated the existing `resolveNotionDatabaseLink` preview assertion to expect the new `fieldMappings` key; +2 cases: `fieldMappings` shape for a schema with one clear candidate per field, and `addNotionSource` persisting all 4 pinned property names (including explicit nulls) |

## Spec conformance

- [x] Env databases: phone/role/company/linkedin extracted by type match when unambiguous; name-pattern tiebreak when 2+ candidates of the same type exist; left unresolved (no guess) when still ambiguous after the tiebreak.
- [x] Self-service sources: add-time preview surfaces per-field candidates and an auto-detected default; the user's confirmed choice (including "ללא"/none, stored as `null`) is pinned permanently and read by exact property name on every subsequent sync — never re-guessed, never affected by a later rename producing a new ambiguous candidate.
- [x] A pinned property that's later renamed or removed on the Notion side is a silent skip (`readPinned` returns `null` when the name isn't found on the page), not an error.
- [x] Fill-blanks-only update policy: an existing person's non-null field is never overwritten by a differing Notion value, regardless of whether the person's `source` is `manual` or `notion`; a blank field is filled and counted in `peopleUpdated`.
- [x] Mechanism applies uniformly to both env-configured and self-service (Settings ← מקורות) databases — the People pass has always scanned `resolvePeopleDatabases()`'s merged list (env + custom) since the prior feature; this change only extends what's read per page, not which databases are scanned.
- [x] Company relation resolves via existing local `companies.notionPageId`, not by creating companies (out of scope) — an unresolvable relation (company not yet synced) is `null`, not an error.
- [x] `resolveDatabaseFieldMappings` is exposed and covered directly (not just indirectly through the tRPC procedure), since it's also the core detection logic reused by both the preview endpoint and documented add-time UX.

## QA

Verified in an isolated, from-scratch Linux `pnpm install` (same rationale as the two prior reviews in this area — the sandbox is Linux, the project's installed `node_modules` on disk are macOS-built) — no changes made to the real project's installed dependencies; scratch copy deleted after the run.

- `vitest run` (packages/api, full suite): **994 of 995 passed**, including all 32 cases in `notion-tasks-sync.test.ts` and all 20 in `people.test.ts`. The one failure is the same pre-existing, unrelated `voice-diarization.test.ts` bug flagged in both prior reports (its own test helper calls `fs.statSync` on a path it expects not to exist, before the function under test — which is specifically supposed to handle a missing file — ever runs); confirmed unaffected by this change.
- `pnpm -r run lint`: clean across all 6 non-mobile-typecheck-only projects — every warning shown (unescaped quotes, `<img>` vs `next/image`, a couple of `exhaustive-deps` hints, some pre-existing a11y warnings) is in a file untouched by this feature.
- `pnpm --filter @ak-system/web build`: succeeded, all 75 routes generated; `/settings/workspaces` unchanged in size from the prior feature (the new per-field `<select>`s only render conditionally inside the already-dynamic-imported modal).
- The interactive field-picker UI (auto-fill, override, "ללא") and the live Notion property-type responses were verified by code review against the router's passing tests (which exercise every response shape the modal consumes) rather than a live click-through — no Notion credentials are available in this sandbox.

## Nits (non-blocking)

- `resolveField`'s pinned/heuristic dispatch keys off `pinnedName !== undefined` rather than an explicit per-database flag; this is correct today because only `resolvePeopleDatabases`'s custom-row branch ever sets these 4 properties on a `NotionDb`, but a future third source of `NotionDb` objects would need to either also set them explicitly (even to `undefined`) or risk silently getting the heuristic path. Worth a comment if a third construction site is ever added.
- No Playwright coverage added for the field-picker modal, consistent with the same reasoning as the prior report: Notion isn't configured in the e2e environment, so the "בדוק" step never resolves and the per-field pickers never render there today.
