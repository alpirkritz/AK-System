# Review — notion-task-source-manager

**Date:** 2026-10-07
**Spec:** `docs/specs/notion-task-source-manager.md`

## UI Review

**Verdict:** APPROVED

### Checklist

- [x] RTL Hebrew copy, dark theme, existing `.btn` / `.input` / `.label` / `.modal` / `.overlay`
- [x] Paste flow reuses the people-source modal pattern (`AddTaskSourceModal`)
- [x] Saved מקור only: paste control is hidden until the מקור exists
- [x] Env rows stay checkboxes; custom rows have a confirm-before-remove trash action
- [x] Empty, loading, validation, and "already registered" states are inline
- [x] Second dialog stacks above the workspace modal (`z-index: 110`)

## Tests

- Vitest: `workspaces.test.ts`, `notion-tasks-sync.test.ts`, `notion-task-writeback.test.ts`, `notion-tasks-sync.workspaces.test.ts` — 140 passed
- Playwright: `editing a source offers paste-a-link and rejects a link with no database id` passed (invalid link returns "לא זיהיתי מזהה בסיס נתונים בקישור הזה")
- Happy-path Notion lookup is covered in Vitest with a mocked `GET /v1/databases/{id}`; the live paste against a real database was not exercised in the browser

## Reviewer

**Verdict:** APPROVED WITH NITS

Acceptance criteria are implemented: paste-a-link on a saved מקור, env checkboxes unchanged, custom rows removed via `unlinkNotionDatabase`, sync and writeback resolve the stored `accountLabel`, `tasks.notionConfigured` is true when only custom rows exist.

Nit: `resolveTaskDatabaseTarget` loads every workspace link on each writeback. Fine at this data size.

Schema parity: `account_label` added in `schema.ts`, `schema.pg.ts`, and the SQLite `ALTER` bootstrap. Production start runs `db:push` against SQLite, so the column is applied on deploy.
