# Fix Task Reminder Push Spam

> **Slug:** `fix-task-reminder-spam`
> **Status:** Approved (user asked to fix)
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-19

## Goal

Stop the mobile/push/WhatsApp/Telegram task-reminder digest from firing every minute. The cron poller at `/api/cron/task-reminder` correctly finds overdue/today open tasks, but it has no dedup — so the same digest is re-sent on every tick while any due task remains open. Desired outcome: at most one task-reminder digest per calendar day (server `TIMEZONE`), while keeping the existing digest content and channel routing.

## User Stories

- As the owner, I want overdue/today task reminders at most once per day so my phone is not flooded every minute with the same list.
- As the owner, I still want the digest to include open tasks that are due today or overdue when it does fire.

## Acceptance Criteria

- [ ] Given open overdue/today tasks and no `task_reminder` send yet today, when the cron runs, then one digest is delivered via `pushAssistantMessage` (respecting channel prefs) and `last_sent_at` is stamped.
- [ ] Given `task_reminder` was already sent today (same `TIMEZONE` calendar day), when the cron runs again (including every subsequent minute), then the handler returns `{ ok: true, skipped: 'already-sent' }` and sends nothing (no chat row, no push, no WhatsApp/Telegram).
- [ ] Given no overdue/today open tasks, when the cron runs, then it returns `{ ok: true, reminded: 0 }` and does not stamp `last_sent_at`.
- [ ] Given the agent-routing path (`runEventAgentIfRouted` returns non-null), when a digest is delivered that way, then `last_sent_at` is still stamped so the next ticks skip.
- [ ] Vitest covers the new once-per-day helper (sent today → true; yesterday / null → false).

## Data Model

No schema changes. Reuse existing `notification_preferences.last_sent_at` via `markNotificationSent('task_reminder')` and a new day-level helper (not slot-based).

## tRPC API

No new procedures. Service additions in `packages/api/src/services/notification-preferences.ts` (exported from `packages/api/src/index.ts`):

- `wasNotificationSentToday(lastSentAt, timezone): boolean` — true when `lastSentAt` falls on the same calendar day as now in `timezone` (mirror the day comparison already used inside `wasNotificationSentInSlot`).
- Prefer reading `lastSentAt` via `getSchedulablePreference('task_reminder')` (already returns `lastSentAt` even for non-schedulable types) or a thin `getNotificationLastSentAt` if cleaner; do not require making `task_reminder` schedulable in the UI.

## UI Surface

No UI changes. Catalog copy may optionally clarify “פעם ביום” in a follow-up; out of scope for this fix unless touched for consistency.

## Implementation notes

- File: `apps/web/src/app/api/cron/task-reminder/route.ts`
- After auth, load preference / `lastSentAt`; if `wasNotificationSentToday` → skip.
- On successful template or agent delivery, call `markNotificationSent('task_reminder')`.
- Keep cron schedule at every minute (deploy unchanged); dedup is in-app.
- Timezone: `process.env.TIMEZONE || 'Asia/Jerusalem'` (same as morning briefing).

## Out of Scope

- Making `task_reminder` schedulable / editable time in `/settings/notifications`.
- Re-notifying mid-day when the due-task set changes (fingerprint / delta alerts).
- Changing crontab frequency.
- Disabling the notification type by default.

## Open Questions

- None — once-per-day is the approved stop-gap for spam; delta alerts can be a later spec if needed.
