# Review — fix-task-reminder-spam

> **Slug:** `fix-task-reminder-spam`
> **Date:** 2026-07-19
> **Verdict:** APPROVED

## Spec conformance

Matches `docs/specs/fix-task-reminder-spam.md`:

- Once-per-day gate via `wasNotificationSentToday` + `getSchedulablePreference('task_reminder').lastSentAt`
- `markNotificationSent` after template and agent delivery paths
- No send when already sent today (`skipped: 'already-sent'`)
- No stamp when `reminded: 0`
- Enabled check before work
- Vitest for the helper

## Diff review

| Area | Assessment |
|------|------------|
| `packages/api/.../notification-preferences.ts` | Pure day helper; refactors slot helper to share `calendarDayInTz` — good |
| `packages/api/src/index.ts` | Exports `wasNotificationSentToday` |
| `apps/web/.../cron/task-reminder/route.ts` | Dedup + `localTodayIso` for due-date filter |
| Catalog description | Clarifies once-per-day |

## Findings

None blocking.

## Nits

- Full `pnpm e2e` / production build not exercised in this review; deploy required for live stop of spam.

## Verdict

**APPROVED** — safe, minimal fix for minute-level task-reminder spam.
