# Outlook Bridge — Import Google Token from EC2

> **Slug:** `outlook-bridge-token-from-ec2`
> **Stack:** next-trpc-monorepo
> **Status:** Approved
> **Last Updated:** 2026-07-27

## Goal

Stop requiring a separate local Google OAuth reconnect (`pnpm dev` / `reconnect-google-calendar.sh`) for the Mac Outlook→Dragontail bridge. The bridge should reuse the Google Calendar refresh token already stored on EC2 (production SQLite `google_connections`), so the user reconnects once via production Settings and the Mac keeps working.

## User Stories

- As the Mac owner, I want the Outlook bridge to use my EC2 Google token so I don’t run the local web app just to reconnect Calendar.
- As the Mac owner, when the local token dies (`invalid_grant`), I want the bridge to pull a fresh token from EC2 and continue syncing automatically.
- As the operator, I want reconnecting Google on production Settings to be the single source of truth for OAuth.

## Acceptance Criteria

- [ ] Given EC2 has a valid `google_connections` row for `OUTLOOK_BRIDGE_ACCOUNT` (default `alpirkritz@gmail.com`), when the Outlook bridge runner starts, then it imports that row into local `apps/web/data/ak_system.sqlite` before syncing.
- [ ] Given the import succeeds, when `getAccessTokenForConnection(..., { forceRefresh: true })` runs, then it succeeds (token verified).
- [ ] Given local sync fails with `invalid_grant`, when the runner retries after a fresh EC2 import, then sync proceeds if EC2 token is valid.
- [ ] Given EC2 token is also invalid / missing, when import or verify fails, then the log shows a clear Hebrew/English message pointing to reconnect on production Settings (not local `3099`), and exit code ≠ 0.
- [ ] Given launchd runs `com.ak.outlook-bridge`, when the Mac is awake, then no `pnpm dev` / local OAuth browser flow is required for normal sync.
- [ ] Given SSH/EC2 is unreachable, when import fails, then the bridge still attempts sync with the existing local token (best-effort), and logs the import failure without masking a later sync error.
- [ ] Manual one-shot works: `bash scripts/pull-google-token-from-ec2.sh` imports + verifies without running the full Outlook sync.

## Data Model

No schema changes. Reuses existing `google_connections` on both EC2 (`/data/ak_system.sqlite` in Docker volume) and local (`apps/web/data/ak_system.sqlite`).

Fields used: `calendar_email`, `access_token`, `refresh_token`, `token_expires_at`, `user_id` (default).

## tRPC API

None. This is Mac-side scripting + existing `upsertGoogleCalendarConnection` / `getAccessTokenForConnection` in `packages/api`.

## UI Surface

None for v1. Production Settings reconnect CTA remains the user-facing OAuth path (`/settings` on EC2 `NEXT_PUBLIC_APP_URL`).

Optional later (out of scope): Settings hint that Mac bridge will pick up the new token within ~15 minutes.

## Implementation Plan

1. **`scripts/pull-google-token-from-ec2.sh`** (new)
   - Load `deploy/ec2.env` (`DEPLOY_HOST`, `DEPLOY_USER`, `SSH_KEY`, `DEPLOY_PATH`).
   - Via SSH + `docker compose exec` (same pattern as `scripts/sync-vat-to-ec2.sh`), export only the bridge account row from production SQLite to a temp SQL/JSON file on the Mac (do **not** scp the whole DB).
   - Prefer a small remote Node one-liner or `sqlite3` dump of a single row into `/tmp/ak-google-conn.json`, then `scp` that file.
   - Call existing `scripts/import-google-token-from-prod.ts` **or** extend it to accept JSON as well as a full sqlite path.
   - Verify with `pnpm exec tsx scripts/repair-google-oauth.ts verify`.
   - Exit non-zero on failure.

2. **Extend `scripts/import-google-token-from-prod.ts`**
   - Keep current sqlite-file mode.
   - Add JSON mode: `pnpm exec tsx scripts/import-google-token-from-prod.ts --json /tmp/ak-google-conn.json [email]`.
   - Upsert into local `DATABASE_PATH` (default local web sqlite) and force-refresh verify.

3. **Wire into bridge runner**
   - Update `scripts/outlook-bridge-run.sh` and the generated `~/.ak-system/outlook-bridge-run.sh` template in `scripts/install-outlook-bridge.sh`:
     1. Best-effort: `bash scripts/pull-google-token-from-ec2.sh` (log success/fail).
     2. Run `outlook-to-google-sync.ts`.
     3. If sync exits with `invalid_grant`, re-run pull once and retry sync once.
   - Re-run `bash scripts/install-outlook-bridge.sh` after change so launchd uses the new runner.

4. **Docs**
   - Short note in `docs/specs/outlook-to-google-bridge.md` or `docs/deploy/ec2-production.md`: reconnect Google on production Settings; Mac bridge imports token automatically.

## Out of Scope

- Running Outlook/EventKit sync on EC2 (still Mac-only).
- Changing production OAuth redirect URIs or client IDs.
- Syncing tokens for accounts other than `OUTLOOK_BRIDGE_ACCOUNT` (unless trivially cheap — default one account).
- UI changes on `/settings`.
- Sharing tokens via Supabase / shared secret store (SSH+SQLite is enough).
- Fixing `NEXT_PUBLIC_APP_URL` local vs tunnel confusion beyond documenting production reconnect as the path.

## Open Questions

1. Should every launchd tick (every 15 min) pull from EC2, or only on local `invalid_grant` / once per day?  
   **Recommendation:** pull every run (single-row export is cheap; keeps Mac aligned after production reconnect within one interval). Fallback: if SSH fails, use local token.
2. Confirm production Google connection includes write scope (`calendar.events`) required for Dragontail writes — if user reconnects read-only on web, bridge write will fail even with a “valid” token.
