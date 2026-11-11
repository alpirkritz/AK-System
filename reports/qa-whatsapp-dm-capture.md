# QA — whatsapp-dm-capture

**Spec:** `docs/specs/whatsapp-dm-capture.md`
**Verdict:** PASS for this change. The full `pnpm e2e` run still exits 1 because of failures that were already there before this work.

## Results

- Vitest, packages/api (`pnpm test`): **78 files, 875 tests passed, 0 failed**. 15 of them are new.
- Vitest, whatsapp-bridge (`vitest run` in `apps/whatsapp-bridge`): 2 files, 10 tests passed. 5 of them are new. The bridge has no `test` script, so the root `pnpm test` does not run these.
- `pnpm -r run lint`: clean. This includes the mobile and bridge `tsc`.
- `pnpm --filter @ak-system/web build`: passes, and the new `/commitments` route is built.
- New e2e spec `e2e/whatsapp-dm-commitments.spec.ts`: 2/2 passed. The step 1 spec `person-context-circles.spec.ts` also passed 2/2 in the same run.
- Full `pnpm e2e`: 79 passed, 22 failed.
  - All failing spec files except one are the same ones listed in `reports/qa-person-context-hierarchy.md`.
  - The exception is `task-workspaces`, which failed once in the full run and then passed 4/4 when run alone. It is flaky under load; this change does not touch it.

## New tests

| File | Covers |
|---|---|
| `packages/api/src/routers/whatsapp-dm.test.ts` | Capture on/off and its start stamp; the allowlist; ingest that keeps only allowlisted messages sent after capture started, deduped; `@lid` chats matched through a manual link or the alt JID; linking a message to a meeting within 3 days; 1:1 and group messages merged on the card; pin plus 90-day retention; `dm.list` paging; the commitment heuristic (owner, Hebrew due dates); summaries that don't repeat and don't propose duplicates; accept (task, assignee, default project, a second accept is rejected); dismiss; merge moves DMs and commitments |
| `apps/whatsapp-bridge/src/dm-capture.test.ts` | Allowlist matching for phone JIDs (including a device suffix) and for `@lid` chats through the contact store; groups, self-chat and non-allowlisted chats are ignored; an empty allowlist captures nothing; the queue dedupes |
| `apps/web/e2e/whatsapp-dm-commitments.spec.ts` | `/commitments` owner filter, accepting into a task (the due date is pre-filled), dismissing; turning on the capture toggle from the person drawer |

## Schema push drift found and fixed

- **Symptom:** the first full `pnpm test` failed in `pretest` with `index idx_people_email already exists`.
- **Cause:** the SQLite bootstrap had created the new columns and tables with `DEFAULT 0` and `id TEXT PRIMARY KEY`, and the schema declared the new columns before `created_at`. drizzle-kit read each of these as a difference and rebuilt the table, and drizzle-kit 0.28 then emits every index twice.
- **Fix:**
  - The bootstrap now writes `DEFAULT false` and `PRIMARY KEY NOT NULL`.
  - The new `people` and `whatsapp_messages` columns are declared last in `schema.ts`.
  - `drizzle-kit push` now reports "No changes detected" against a DB created by the bootstrap.
- **Local DBs repaired:** the test DB and the local dev DB (`apps/web/data/ak_system.sqlite`) already had the old form. On both, the new columns and tables were empty, so they were dropped and re-created. The dev DB was backed up to `/tmp/ak_system.dev.backup-*.sqlite` first.
- **Separate, older drift:** the dev DB push also rebuilt `push_subscriptions`. It kept its 2 rows and `integrity_check` returns ok. This drift existed before this change.
