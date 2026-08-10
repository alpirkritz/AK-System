# QA — Outlook Bridge Title Blocklist

> **Slug:** `outlook-bridge-title-blocklist`
> **Spec:** `docs/specs/outlook-bridge-title-blocklist.md`
> **Stack:** next-trpc-monorepo
> **Date:** 2026-08-05

## Commands run

| Check | Command | Result |
|---|---|---|
| Bridge unit tests | `pnpm --filter @ak-system/api exec vitest run ../../scripts/outlook-to-google-sync.test.ts` | PASS — 21/21 |
| Full unit suite | `pnpm test` | PASS — 35 files, 397 tests |
| Typecheck | `npx tsc --noEmit -p packages/api/tsconfig.json` | PASS — no errors in the bridge |
| Lint | `pnpm -r run lint` | `apps/mobile`, `apps/whatsapp-bridge` PASS; `apps/web` FAILS — pre-existing, see below |
| Bridge dry run | `pnpm exec tsx scripts/outlook-to-google-sync.ts --dry-run` | PASS — 3 blocked, 3 stale copies queued for delete |
| Shell env parsing | `set -a; source apps/web/.env.local` | PASS — value survives with spaces intact |

E2E (`pnpm e2e`) not run: the change touches a standalone macOS script with no web UI or tRPC surface, so no Playwright flow exercises it.

## Pre-existing lint failure

`pnpm --filter @ak-system/web lint` runs `next lint`, which has no ESLint config in `apps/web` and drops into an interactive setup prompt, so it exits non-zero in any non-TTY run. This is unrelated to the change — the only file touched under `apps/web` is `.env.local`, which is gitignored and not linted. Worth fixing separately.

## Functional verification against real data

Dry run against the live Exchange calendar and the Dragontail Google calendar:

```
[outlook-bridge] source: 31 Outlook events (calendar "Calendar"), 3 blocked by title,
                 319 attendees with email, 0 name-only
[outlook-bridge] [dry-run] done — created 0, adopted 0, updated 3, deleted 3, unchanged 28
```

The three blocked events, confirmed against the raw EventKit output:

| Start | Attendees | Title |
|---|---|---|
| 2026-08-05 18:00 | 2,066 | Global D&T Town Hall [Detailed Enclosed] |
| 2026-08-10 18:00 | 448 | Tech Hour [Details Enclosed] |
| 2026-08-27 17:00 | 418 | Q3 Global Eng-Arch Town Hall |

False-positive check: of the 55 events that remain, none contain `hall`, `hour`, or `hold` in the title, so nothing legitimate is caught by the current patterns. Attendee volume drops from 3,251 to 319, which also shrinks every `description` the bridge writes.

`deleted 3` confirms the acceptance criterion that previously-created copies of a newly blocked title are removed: the blocked events leave `sourceUids`, and the existing delete pass reclaims their tagged copies. Untagged events are untouched — `existing copies in Dragontail: 31` versus `all in window: 1225`.

## Acceptance criteria coverage

| Criterion | Covered by | Status |
|---|---|---|
| Empty/unset blocklist is a no-op | `parseBlocklist` + `isBlockedTitle` unit tests | PASS |
| `town hall` blocks the Town Hall invite | unit test + live dry run | PASS |
| Existing bridge copy of a blocked title gets deleted | unit test asserting empty plan + orphaned uid; live `deleted 3` | PASS |
| Untagged Dragontail events untouched | delete pass only iterates `existingCopies` (tagged); unchanged code path | PASS |
| Case-insensitive and trimmed matching | unit test | PASS |
| Empty pattern never matches everything | unit test on `' Town Hall , ,TECH HOUR,, [HOLD] '` | PASS |
| Blocked count is logged | live dry run shows `3 blocked by title` | PASS |

## Verdict

**PASS.** No regressions; the one failing lint target fails identically on a clean tree.
