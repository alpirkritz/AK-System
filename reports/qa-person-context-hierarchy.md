# QA — person-context-hierarchy

**Date:** 2026-09-24
**Spec:** `docs/specs/person-context-hierarchy.md`
**Verdict:** PASS for this change (the full `pnpm e2e` run exits 1 on 21 failures that were already failing before it)

## Summary

- Vitest (`pnpm test`, packages/api): **76 files, 857 tests passed, 0 failed**
- Vitest (apps/web `src/lib/pre-meeting-brief.test.ts`): **22 passed** (3 new)
- Lint (`pnpm -r run lint`): pass. Web has only warnings, none in files this change touched. Mobile and whatsapp-bridge `tsc --noEmit` pass.
- Build (`pnpm --filter @ak-system/web build`): pass. `/people/duplicates` is a new static route.
- E2E (`pnpm e2e`): 78 passed, 21 failed, 2 skipped. Both new tests in `e2e/person-context-circles.spec.ts` passed.

## New tests

| File | Covers |
|---|---|
| `packages/api/src/lib/calendar-participants.test.ts` | Dragontail `משתתפים:` parsing, owner/bot exclusion, dedupe, participant keys, title keys, phone + WhatsApp JID helpers |
| `packages/api/src/routers/circles.test.ts` | Roster save from calendar, known-person linking without creating people, calendar diff + dismiss + apply, absent/guest exceptions, follow, remove, series warmth, warmth math |
| `packages/api/src/routers/meetings.sync-series.test.ts` | Bridge events with no recurring id grouped into one series with a participant snapshot; no review-queue people for a rostered series |
| `packages/api/src/routers/people.duplicates.test.ts` | Ranking (email 1.0 > phone 0.95 > similar name 0.7), not-duplicate is remembered, side-by-side footprint, merge moves roster/WhatsApp links and fills missing fields |
| `packages/api/src/routers/insights.person-context.test.ts` | WhatsApp split around the last Notion meeting, open loops per owner, recommendation, manual LID linking, meeting prep context (people mode has no raw chat, circle mode) |
| `apps/web/src/lib/pre-meeting-brief.test.ts` (appended) | Circle count replaces the participant list; agent told not to profile participants; people mode unchanged |
| `apps/web/e2e/person-context-circles.spec.ts` | Save a 12-person circle from the calendar, mark one absent (11 expected); review and merge a duplicate pair |

## E2E failures already present before this change

The 21 failures are in the same spec files listed in `reports/qa-whatsapp-daily-digest.md` (21 failed there too): bank-accounts, dashboard-task-open-sort, full-flow, meeting-conversation-analysis, meeting-relationships, multi-level-sort, notion-note-meetings, qa-structured, trading-journal, ui-refresh. A re-run of `meeting-conversation-analysis` shows the cause is missing copy (`ניתוח שיחה עמוק`, `ממתין לניתוח`) in a section this change does not touch. The circle card only renders for meetings with a `seriesId`, and those test meetings have none.
