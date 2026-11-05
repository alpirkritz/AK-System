# Review: circle-members-from-people

**Verdict: APPROVED WITH NITS**
**Date:** 2026-11-05
**Spec:** `docs/specs/circle-members-from-people.md` (Approved, defaults for both open questions)

## What changed

- `packages/api/src/services/series-roster.ts`
  - Every new roster row gets a `personId`:
    - Calendar import (`insertRosterRows` → `personForAttendee`) matches by email, then exact alias or name, via `resolvePerson`. If nothing matches, it creates an `unconfirmed` person with source `calendar`.
    - The calendar diff reactivates retired rows and links them too.
  - New:
    - `saveRosterFromPeople`: keeps or reactivates rows already linked, retires the rest.
    - `createPersonForCircle`: creates a confirmed person, or reuses one with the same email.
    - `linkRosterMember`: dedupes against an active member.
    - `confirmRosterMember`
    - `circleForMeeting`
  - `getCircle` backfills legacy unlinked rows (match only, never creates) and returns `person` with the current People name.
  - Removed: `saveRosterFromNames`, `addRosterMember`, `followRosterMember`.
- `packages/api/src/routers/circles.ts`
  - Added: `saveFromPeople`, `createPersonForCircle`, `linkMember`, `confirmMember`, `forMeeting`.
  - Removed: `saveFromNames`, `addMember`, `follow`.
  - Error codes: a series that doesn't exist → NOT_FOUND; a person that is unknown or ignored → BAD_REQUEST.
- `apps/web/src/app/meetings/components/CircleCard.tsx`
  - Replaced the textarea with a People picker ("אנשים בחוג", "שמור חוג", "צור ״…״ באנשים").
  - Names link to `/people?person=<id>`.
  - Rows show "אשר באנשים" for unconfirmed people, and "לא מקושר" with "קשר לאדם" for unlinked ones.
  - "הוסף לחוג" by free text is gone; "אורח היום" stays.
- `apps/web/src/components/ui/MeetingPeoplePicker.tsx`
  - New optional props `label`, `emptyText`, `onCreate`, `creating`.
  - The list now closes on `click` instead of `mousedown`. Closing it shifted the layout, so a button below it (save) moved away before the click landed. Defaults keep `MeetingModal` unchanged.
- `apps/web/src/app/calendar/components/EventDetailPanel.tsx`: new "חוג" row, with the count and up to 5 names, or "אין חוג עדיין · שמור מהפגישה".

## Checks

| Check | Result |
|---|---|
| Vitest `circles.test.ts` + `meetings.sync-series` + `insights.person-context` + `calendar-participants` | 43/43 |
| `pnpm test` (full, api + web) | api 1516/1516, web 330/330 |
| Playwright `person-context-circles.spec.ts` (3, including the new picker flow) + `meeting-people-picker.spec.ts` | pass |
| Full `pnpm e2e` | 113 passed, 2 skipped, 35 fail on two runs. None trace to this change; see below |
| `pnpm -r run lint` | no errors |
| `pnpm --filter @ak-system/web build` | passes |

## Nits / notes

1. **Pre-existing e2e failures** (35, reproducible). None involve circle, picker or calendar-panel code:
   - `project-page-polish` and `notion-note-meetings` fail in their own SQLite seed `db.prepare` step.
   - `meeting-conversation-analysis` waits for text ("ניתוח שיחה עמוק") that isn't in the code at HEAD.
   - `task-assignee` and `calendar-link-and-commitment-task-modal` wait for task-modal text from before the last commit.
   - `meeting-relationships` and `whatsapp-dm-commitments` were already listed as pre-existing in earlier reports.
   - Also failing: Slack, trading journal, my-tasks, multi-sort, ui-refresh, qa-structured.
   - Worth a separate cleanup pass.
2. **Stale test fixed in passing:** the `person-context-circles` "merge duplicates" test looked for a button named "מזג", which was renamed to "מזג וזכור את השם" on Nov 2. It's a one-line fix in that spec.
3. **Calendar panel has no e2e:** the "חוג" row is covered by the `forMeeting` unit test only. The calendar page needs a connected Google account to show events.
4. **`displayName` on update:** `series_roster.displayName` is updated to the People name only when a row is saved or linked. Reads always show `people.name`.
