# Notion People Source Manager (paste-a-link database registration)

**Stack:** `next-trpc-monorepo`
**Slug:** `notion-people-source-manager`
**Status:** Draft — awaiting approval
**Created:** 2026-09-30
**Depends on:** `notion-tasks-people-sync` (existing sync engine), `people-sync-visibility` (People page sync button that surfaced this gap)

---

## Goal

Today, which Notion databases the People pass treats as "people" sources is decided **exclusively by the `NOTION_ACCOUNTS` environment variable** (`resolveDatabases('people')` in `packages/api/src/services/notion-tasks-sync.ts:102-140`) — there is no UI, and no code path in the app ever calls Notion's live search/discovery API (confirmed: zero references to `v1/search` anywhere in the repo). Registering a new Notion database as a people source currently requires hand-editing that JSON env var and restarting the process — something the owner discovered the hard way after adding a contact to a database that was never listed there, running the new People-page sync button, and seeing "0 imported" with no error. This spec adds a settings UI that lets the owner paste a Notion database's share link (the way Notion databases are normally handed to an integration — no live search needed) and register it as a people source, stored in the app database instead of requiring an env var edit + redeploy.

## User Stories

- As the owner, I want to see which Notion databases are currently treated as people sources, so I know why a given database's contacts aren't showing up.
- As the owner, I want to paste the link to a Notion database (copied straight from Notion's "Copy link") and add it as a people source, so a new contact list starts syncing without me touching env vars or redeploying.
- As the owner, I want to remove a people source I added by mistake, so I can correct without redeploying.
- As the owner, I want the databases already configured via `NOTION_ACCOUNTS` to keep showing up (clearly marked as "built-in"/env-managed), so this feature is additive and doesn't require migrating existing config.

## Acceptance Criteria

### Viewing current sources

- Given I open the Notion sources section in Settings, when it loads, then I see every people database currently in effect: both env-configured ones (from `NOTION_ACCOUNTS`, labeled e.g. "מוגדר בקוד") and custom ones added via this UI (labeled e.g. "נוסף ידנית", with a remove action).
- Given no Notion account is configured at all (`NOTION_ACCOUNTS` empty/missing), when the section loads, then it shows the existing "Notion not configured" state (consistent with how `tasks.notionConfigured` gates the sync button today) rather than a broken picker.

### Adding a source

- Given at least one Notion account is configured, when I open "הוסף בסיס נתונים", then I see an account `<select>` (from configured `NOTION_ACCOUNTS` labels) and a single text field for pasting a Notion database link (or bare ID) — no search step, matching how the owner already grabs a link via Notion's own "Copy link" action.
- Given I paste a link/ID and pick an account, when I submit, then the server extracts the 32-character database ID from whatever was pasted (a full URL with a workspace slug and `?v=` query string, a bare dashed UUID, or a bare 32-char hex string all work) and calls `GET /v1/databases/{id}` with that account's token to confirm access and fetch its title.
- Given the lookup succeeds, when it resolves, then a new row is written (accountLabel + notionDatabaseId + notionDatabaseName from the fetched title, editable before confirming) and it immediately appears in the sources list — no restart needed.
- Given the pasted text has no extractable 32-character ID, when I submit, then I see a clear Hebrew validation error before any Notion call is made ("לא זיהיתי מזהה בסיס נתונים בקישור הזה").
- Given the ID is valid but the selected account's integration doesn't have access to that database (Notion returns 404/403 — indistinguishable from "not shared with this integration"), when the lookup runs, then I see "האינטגרציה של [חשבון] לא משותפת לבסיס הנתונים הזה ב-Notion — שתף אותו קודם משם ונסה שוב."
- Given I try to add a database ID that's already registered (by any source, env or custom), when the mutation runs, then it's rejected with a clear "כבר רשום" error (mirrors the existing `linkNotionDatabase` conflict behavior in `workspaces.ts`).

### Removing a source

- Given a custom (non-env) people source, when I remove it, then it's deleted and stops being scanned on the next sync; env-configured sources have no remove action in this UI (they can only be removed by editing `NOTION_ACCOUNTS`, unchanged).

### Sync integration

- Given one or more custom people sources exist, when `tasks.syncFromNotion` runs (button or cron), then the People pass scans env-configured **and** custom sources together, using the token of the matching `accountLabel` resolved from `NOTION_ACCOUNTS` at sync time (the token itself is never written to the database).
- Given a custom source's `accountLabel` no longer matches any configured account (e.g. env changed after it was added), when sync runs, then that source is skipped with an entry in the sync's `errors` array (not a silent no-op), so it's visible in the People page's result banner.

## Data Model

Changes in **both** `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres). Export new table + inferred types. Add SQLite bootstrap in `packages/database/src/index.ts` (same pattern as the existing `workspace_notion_databases` block).

### New table: `people_notion_sources`

A new table rather than extending `workspace_notion_databases` — that table's `workspaceId` is `NOT NULL` with an `onDelete: 'cascade'` FK (`schema.pg.ts:140-149`), purpose-built for the task/workspace relationship; people sources aren't workspace-scoped (matching the existing design note in `docs/specs/people-sync-visibility.md`: "people sync remains workspace-agnostic").

```ts
export const peopleNotionSources = pgTable('people_notion_sources', {
  id: text('id').primaryKey(),
  accountLabel: text('account_label').notNull(),   // matches a NOTION_ACCOUNTS[].label at sync time; token resolved from env, never stored here
  notionDatabaseId: text('notion_database_id').notNull(),
  notionDatabaseName: text('notion_database_name'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  notionDatabaseIdUq: uniqueIndex('uq_people_notion_sources_notion_database_id').on(table.notionDatabaseId),
}))
```

## tRPC API Shape

Added to the existing `peopleRouter` (`packages/api/src/routers/people.ts`) rather than a new router, since these procedures are specifically about people's Notion sources:

- `people.notionAccounts` — query, no input. Returns `{ label: string }[]` parsed from `NOTION_ACCOUNTS` (no tokens exposed to the client). Returns `[]` when unconfigured.
- `people.notionSources` — query, no input. Merges `resolveDatabases('people')` (env, `source: 'env'`) with rows from `peopleNotionSources` (`source: 'custom'`, includes `id` for removal). Shape: `{ source: 'env' | 'custom'; id: string | null; accountLabel: string; notionDatabaseId: string; name: string }[]`.
- `people.resolveNotionDatabaseLink` — input `{ accountLabel: string; link: string }`, mutation. Extracts the 32-char ID from `link` (regex `[0-9a-f]{32}` on the de-dashed, lowercased input — matches a pasted URL or bare ID alike); throws `BAD_REQUEST` if none found. Resolves the account's token from `NOTION_ACCOUNTS`; calls `GET https://api.notion.com/v1/databases/{id}` with the existing header pattern (`Authorization: Bearer <token>`, `'Notion-Version': '2022-06-28'`). Returns `{ notionDatabaseId: string; name: string; alreadyAdded: boolean }` (cross-checked against `people.notionSources`) or throws `NOT_FOUND` with the "not shared with this integration" copy on a 403/404. This is a preview/validate step the UI calls before the final add, so the owner can see/edit the resolved name first.
- `people.addNotionSource` — input `{ accountLabel: string; notionDatabaseId: string; notionDatabaseName: string }`, mutation. Validates `accountLabel` exists in `NOTION_ACCOUNTS`; rejects (`CONFLICT`) if `notionDatabaseId` already exists in either `peopleNotionSources` or the env list; else inserts.
- `people.removeNotionSource` — input `{ id: string }`, mutation. Deletes the row from `peopleNotionSources`.

### Sync engine change

`packages/api/src/services/notion-tasks-sync.ts` line 563 (`const peopleDbs = resolveDatabases('people')`) becomes an async call to a new `resolvePeopleDatabases(db)` that:
1. Starts from `resolveDatabases('people')` (env, unchanged).
2. Reads `peopleNotionSources`, and for each row looks up the token for `accountLabel` from the same parsed `NOTION_ACCOUNTS` data `resolveDatabases` already parses (a small refactor to expose the parsed account list, or a second lookup helper) — pushes a `NotionDb` entry when a match is found, else appends to `result.errors` (`people-source/${row.notionDatabaseName}: no matching Notion account "${row.accountLabel}"`) and skips it.

## UI Surface

- `apps/web/src/app/settings/workspaces/page.tsx` — this is already the "Notion sources" hub (per `docs/notion-task-sync-troubleshooting.md`, reached via "הגדרות ← מקורות"). Add a new card below the workspaces list: "בסיסי נתונים של אנשים ב-Notion", listing `people.notionSources` (env rows show a static "מוגדר בקוד" pill with no action; custom rows show an "הסר" button calling `removeNotionSource`).
- A new small modal (e.g. `apps/web/src/components/Modals/AddPeopleSourceModal.tsx`), opened by an "הוסף בסיס נתונים" button on that card: account `<select>` populated from `people.notionAccounts`, a single `<input>` for pasting the Notion link/ID, a "בדוק" step that calls `resolveNotionDatabaseLink` and shows the resolved name (editable) for confirmation, then a "הוסף" button that calls `addNotionSource` and closes the modal on success.
- Follows existing design-system classes (`.btn`, `.input`, `.card`), RTL, dark theme — per project conventions; UI Designer Agent to review before implementation for exact spacing/empty-states (no accounts configured, no search results, search error).

## Out of Scope

- Extending this same self-service mechanism to `tasks`/`meetings`/`projects`/`companies` database types (still env-only) — could be a natural follow-up once this pattern is proven for `people`, but not built here.
- Live Notion search/browse (`POST /v1/search`) — deliberately dropped in favor of paste-a-link, which is simpler to build and matches how Notion links are normally shared with an integration anyway.
- Auto-suggesting the People-relation directories already discovered read-only inside task databases (`findPeopleRelation`/`fetchPeopleDirectoryIndex`, notion-tasks-sync.ts:675-719) as one-click add candidates — plausible nice-to-have, not required for the core gap.
- Editing/renaming a custom source's `notionDatabaseName` after adding (remove + re-add covers it for now).
- Any change to matching/dedup logic inside the People pass itself (name/email/notionPageId precedence) — unrelated to where the database list comes from.
- Any change to `workspace_notion_databases` / the task-database linker — untouched.

## Open Questions

- Should removing a custom source that already produced synced people also offer to clean up those people/rows? Proposed: no — removing a source only stops future scans, consistent with how disabling Notion sync generally doesn't retroactively delete already-synced data anywhere else in the app.
- A pasted link only tells us the database ID, not which account's integration to use — the owner still has to pick the right account from the dropdown. If they pick the wrong one (token without access), they'll see the "not shared" error and can just retry with the other account; not worth auto-trying every account silently, since a 403 vs 404 look identical from Notion and trying all accounts could be slow with several configured.
