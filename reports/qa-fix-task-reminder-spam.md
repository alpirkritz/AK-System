# QA — fix-task-reminder-spam

> **Slug:** `fix-task-reminder-spam`
> **Date:** 2026-07-19
> **Stack:** `next-trpc-monorepo`

## Summary

Focused Vitest for the new once-per-day helper and related settings notification tests **passed**. Full `pnpm e2e` not run (no UI surface). `next lint` is interactive / unconfigured in this workspace (pre-existing).

## Checks

| Check | Result |
|-------|--------|
| `vitest` `notification-preferences.test.ts` + `settings.test.ts` | PASS — 21 tests |
| Schema / migration | N/A — no schema change |
| E2E Playwright | SKIPPED — cron-only, no UI flow |
| `pnpm --filter @ak-system/web lint` | BLOCKED — Next prompts to configure ESLint (pre-existing) |
| Full web build | NOT RUN — change is small cron + pure helper |

## Notes

- Production will keep spamming until this build is deployed; until then disable **תזכורת משימות** under `/settings/notifications`.
- After deploy, at most one digest may still fire once (if `last_sent_at` is empty), then subsequent minute ticks skip with `already-sent`.
