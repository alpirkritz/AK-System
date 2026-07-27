# Code Review: Outlook Bridge Token from EC2

> **Slug:** `outlook-bridge-token-from-ec2`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-07-27

## Spec Conformance

The Mac bridge now imports and verifies the production Google token before
every launchd sync, falls back to the existing local token if EC2 is
unreachable, and retries once after `invalid_grant`. A standalone one-shot
import command is available. No local Next.js server or local OAuth callback is
needed for normal operation.

## Static Checks

| Check | Result |
|---|---|
| `pnpm test` | PASS — 180/180 |
| `pnpm --filter @ak-system/web build` | PASS |
| Shell syntax + scoped whitespace | PASS |
| Changed-file IDE diagnostics | PASS |
| `pnpm -r run lint` | BLOCKED — existing interactive Next.js ESLint setup prompt |
| `pnpm e2e` | 22 PASS / 11 unrelated existing UI failures |

## Findings

### Must-fix

- None.

### Should-fix

- Configure a non-interactive ESLint setup for `apps/web` so the repository
  lint gate can run in CI.
- Repair stale UI E2E expectations separately; this feature has no UI surface.

### Nits

- Pulling one token over SSH every 15 minutes is intentionally simple and
  reliable, but could later be reduced to invalid-token/once-daily refresh if
  EC2 SSH traffic becomes noisy.

## Security

- Only the selected account row is exported; the production DB is not copied.
- Token JSON lives in a private `mktemp` directory under `umask 077`, is never
  printed, and is removed on exit.
- Account input is email-format validated before interpolation.
- SSH uses the existing restricted key and a current-IP `/32` security-group
  rule.

## Out of Scope Creep

None. No database schema, API, UI, or production OAuth behavior changed.

## Suggested PR Description

Use the production Google Calendar connection as the OAuth source of truth for
the Mac Outlook bridge. Import and verify the selected token over SSH before
launchd sync, retain local-token fallback, and retry once on `invalid_grant`.
