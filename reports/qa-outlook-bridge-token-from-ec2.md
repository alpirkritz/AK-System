# QA: Outlook Bridge Token from EC2

> **Slug:** `outlook-bridge-token-from-ec2`
> **Date:** 2026-07-27
> **Result:** PASS WITH EXISTING SUITE FAILURES

## Feature verification

- `bash scripts/pull-google-token-from-ec2.sh`: PASS
  - Opened SSH access for the current Mac IP.
  - Exported only `alpirkritz@gmail.com` from production `google_connections`.
  - Imported into local SQLite and force-refresh verified the token.
- `bash scripts/install-outlook-bridge.sh`: PASS
- launchd automatic run: PASS (`last exit code = 0`)
  - Imported and verified the EC2 token.
  - Read 37 Outlook events.
  - Sync completed: created 4, unchanged 33.
- Local app health: PASS (`http://localhost:3000` returned 200 after restart).
- Shell syntax (`bash -n`) and scoped whitespace (`git diff --check`): PASS.
- IDE diagnostics for changed scripts: PASS (no errors).

## Automated checks

- `pnpm test`: PASS — 22 files, 180 tests.
- `pnpm --filter @ak-system/web build`: PASS.
- `pnpm -r run lint`: BLOCKED by the repository's existing interactive
  `next lint` setup prompt; mobile and WhatsApp TypeScript lint passed.
- `pnpm e2e`: 22 passed, 11 failed. Failures are existing UI expectations
  (missing/renamed headings and pages) and WhatsApp bridge availability; this
  feature changes no web UI, route, tRPC procedure, or E2E behavior.

## Test coverage note

No new tRPC procedure or UI flow was added. The new token-transfer path was
covered by a live EC2-to-local integration run and a real launchd sync.
