# QA — filter-allday-pre-meeting

> **Date:** 2026-07-22
> **Spec:** `docs/specs/filter-allday-pre-meeting.md`
> **Stack:** `next-trpc-monorepo`

## Scope exercised

- Shared all-day / ≥8h filter (`calendar-filters.test.ts`)

## Results

| Suite | Result |
|---|---|
| `packages/api` `calendar-filters.test.ts` (8) | PASS |

Command:

```bash
pnpm --filter @ak-system/api exec vitest run src/lib/calendar-filters.test.ts
```

## Notes

- No E2E: filter is in `calendar.upcoming`; pre-meeting cron consumes that list.
- After deploy, all-day blocks (WFH, birthdays, company periods) must not produce 02:45 "הכנה לפגישה" WhatsApp messages.

## Verdict

**PASS**
