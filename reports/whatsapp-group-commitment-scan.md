# Reviewer verdict — whatsapp-group-commitment-scan

**Verdict:** APPROVED

## What changed

- `packages/api/src/services/whatsapp-dm.ts`: refactored the Hebrew promise/request heuristic into a shared `classifyPromise`; broadened `proposeCommitments`'s dedupe (previously `whatsapp_dm`-only) to also cover `whatsapp_group`; `proposeCommitments` now returns the inserted items (not just a count); added `resolveGroupSenderPersonId` (self via bridge JID / phone match / manual `whatsapp_person_links` entry, else `null`); added `scanGroupCommitments` with a `user_settings`-backed scan cursor; `summarizeDmChats`/`scanDmCommitments` now also return `proposed: { label, content }[]` for notification building.
- `packages/api/src/services/commitments.ts`: added `buildCommitmentNotification` (title/body rules for 1 vs. N proposed commitments).
- `packages/api/src/services/email-sync.ts`, `packages/api/src/services/commitments.ts` (`proposeCommitmentsFromAnalysis`): updated for `proposeCommitments`'s new return type.
- `packages/api/src/index.ts`: exported the new function/types.
- `apps/web/src/app/api/cron/whatsapp-dm-commitments/route.ts`, `.../whatsapp-dm-summary/route.ts`: use `buildCommitmentNotification` instead of the generic title/body.
- `apps/web/src/app/api/cron/whatsapp-group-commitments/route.ts` (new): mirrors the DM commitments cron for groups.
- `packages/database/src/schema.pg.ts`, `schema.ts`, `packages/database/src/index.ts`: added `user_settings.whatsapp_group_commitment_scan_cursor` (nullable text) + SQLite bootstrap ALTER.
- `scripts/local-cron.mjs`, `deploy/crontab.example`: wired the new cron in at every 10 minutes.
- Tests: fixed `packages/api/src/routers/whatsapp-dm.test.ts` expectations for the new `proposed` field; added `packages/api/src/services/whatsapp-group-commitments.test.ts` (self-promise attribution, phone-matched contact + skipped unidentified sender, `@lid` via manual link, disabled group ignored, no-repeat on rerun) and `packages/api/src/services/commitments.test.ts` (notification builder: single item, >5 items with tail count, ≤5 items).

## Verification

- `pnpm test` (repo root): **85 + 32 test files, 1177 tests passed** (packages/api + apps/web), including the new/updated suites above. Run in an isolated copy of the repo since the mounted Google Drive folder doesn't support pnpm's store operations; `pg` had to be added as a local dev dependency in that copy only to unblock vitest's module resolution — this is a pre-existing gap (no package in the repo declares `pg`, even though `getDb()` needs it whenever `DATABASE_URL` is set) unrelated to this change, flagged here for awareness rather than fixed as part of this spec.
- `pnpm -r run lint`: mobile/whatsapp-bridge/web all pass; the web app's warnings are pre-existing (unescaped quotes, `<img>` vs `<Image>`, hook deps, aria roles) and none are in files touched by this change.
- `pnpm --filter @ak-system/web build`: succeeds (exit 0); `/api/cron/whatsapp-group-commitments` appears in the route manifest. (Had to point `DATABASE_PATH` at a path that exists in the sandbox — the checked-in `.env.local` hardcodes the Mac's absolute path — reverted after verification, no repo file left changed by this.)

## Known limitation

The shared verb heuristic doesn't include קנה/לקנות ("buy") — the owner's own example, "לקנות בשר", would still not be detected by either the DM or the new group scan, since that verb isn't in the mirrored list from the original DM spec. Flagged as a known limitation in the spec; a one-line follow-up to `classifyPromise` would close it if needed.
