# Review — filter-allday-pre-meeting

> **Date:** 2026-07-22
> **Spec:** `docs/specs/filter-allday-pre-meeting.md`
> **QA:** `reports/qa-filter-allday-pre-meeting.md`
> **Stack:** `next-trpc-monorepo`

## Verdict

**APPROVED**

## Spec conformance

- [x] `calendar.upcoming` excludes all-day / date-only / ≥8h via shared helper
- [x] Free/busy title filter retained
- [x] `calendar.events` unchanged
- [x] Pre-meeting cron benefits via upcoming (no route rewrite required)
- [x] Vitest covers all-day, date-only, ≥8h, short timed, and deprecated alias

## Changed files

- `docs/specs/filter-allday-pre-meeting.md`
- `packages/api/src/lib/calendar-filters.ts`
- `packages/api/src/lib/calendar-filters.test.ts`
- `packages/api/src/routers/calendar.ts`
- `packages/api/src/services/agent-calendar-context.ts`
- `reports/qa-filter-allday-pre-meeting.md`

## Findings

None blocking.

### Nits

1. Needs production deploy before tonight’s all-day UTC-midnight window to verify live silence.
2. Deprecated aliases kept for safety; can remove in a later cleanup.

## Security

No auth/secrets changes.
