# Circle members come from People

> **Slug:** `circle-members-from-people`
> **Status:** Approved
> **Last Updated:** 2026-11-05

## Goal

Each recurring calendar meeting (`meeting_series`) has a circle (`series_roster`). Today you can fill the circle with free text: the "שמות בחוג" textarea (`circles.saveFromNames`) and the "הוסף לחוג" name input (`circles.addMember`). Those rows end up with `person_id = null` and never reach People, 1:1 flags, person context or warmth. Instead, every circle member should be a record from People: picked from People, created there from the circle, or matched to People when imported from the calendar. Recurring events in the calendar should also show their circle.

This replaces the free-text circle editor from `meeting-circle-names-and-live-notes`. The recording notes from that spec are unchanged.

## User Stories

- As the owner, I want to build a recurring meeting's circle by picking people from People, so each member is the same person I track everywhere else.
- As the owner, I want to add someone who isn't in People yet straight from the circle, so I don't have to leave the meeting page. The person is created in People.
- As the owner, I want a circle saved from the calendar to link each attendee to their People record, so nobody is a loose name.
- As the owner, I want to open a recurring event in the calendar and see which circle it belongs to and who is in it.

## Acceptance Criteria

- [ ] On `/meetings/[id]` for a series meeting, `CircleCard` has no textarea and no free-text "הוסף לחוג". The editor is a People picker (the `MeetingPeoplePicker` pattern: search, recent people, chips) labeled "אנשים בחוג", with a "שמור חוג" button.
- [ ] Saving calls `circles.saveFromPeople`. The active roster becomes exactly the picked `personId`s. A row already linked to a picked person is kept, or reactivated if it was inactive, so its exceptions and history stay. Active rows not picked become `inactive` (not deleted). New rows use `source = 'manual'` and `personId` set. `rosterSavedAt` is stamped.
- [ ] If the search text matches no one, the picker offers "צור ״<שם>״ באנשים". This calls `circles.createPersonForCircle`, which creates a `people` row (`status = 'confirmed'`, `source = 'manual'`) and adds it to the selection. `כהן, יוסי` becomes `יוסי כהן` (existing `normalizeDisplayName`).
- [ ] "שמור חוג מהיומן" and "עדכן מהיומן" link each attendee to People: by email first, then by exact normalized name or alias. If nothing matches, a person is created with `status = 'unconfirmed'`, `source = 'calendar'`, so they show up in the People review queue and not in the main list. After either action, every active row has a `personId`.
- [ ] Roster rows show the linked person's current `people.name` (a rename in People shows in the circle). `displayName` is kept only as a fallback snapshot. Each name links to the person (opens the person drawer / `/people?person=<id>`).
- [ ] The "עקוב" button is replaced. A row whose person is `unconfirmed` shows "אשר באנשים" (sets `status = 'confirmed'`, same as today's `follow`). Confirmed rows show no button.
- [ ] Legacy rows with `personId = null` (from the old textarea, or a person that was deleted, since the FK is `set null`) show "לא מקושר" plus a "קשר לאדם" action. That action picks an existing person or creates one, via `circles.linkMember`. The new UI creates no unlinked rows.
- [ ] One-time backfill on `getCircle`: unlinked active rows are matched by email/name/alias the same way as the calendar import. Rows that don't match stay unlinked (no person is auto-created for legacy free text).
- [ ] `circles.saveFromNames` and `circles.addMember` (free-text) are removed from the router. No web or mobile caller remains.
- [ ] Calendar: in `EventDetailPanel`, when the event's linked meeting has a `seriesId`, show a "חוג" row: member count and up to 5 names, with a link to `/meetings/<id>`. If the series has no saved roster yet: "אין חוג עדיין · שמור מהפגישה".
- [ ] A one-off meeting with no series still has no circle editor. "אורח היום" (per-occurrence guest) is unchanged (see Open Questions).

## Data Model

No new tables or columns. `series_roster.person_id` already exists in both `schema.pg.ts` and `schema.ts` (nullable, FK `people.id`, `on delete set null`). It stays nullable at the DB level for legacy rows and deleted people. The application stops creating null rows. No `getDb()` bootstrap SQL change.

## tRPC API

All on `protectedProcedure`, in `packages/api/src/routers/circles.ts`. Logic lives in `services/series-roster.ts`.

- `circles.saveFromPeople`
  - Input: `{ seriesId: z.string().min(1), personIds: z.array(z.string().min(1)).min(1).max(200) }`
  - Return: `{ saved: number; added: number; retired: number }`
  - Unknown series → `NOT_FOUND`. Any id that is not in People, or is `ignored` → `BAD_REQUEST`.
- `circles.createPersonForCircle`
  - Input: `{ name: z.string().trim().min(1).max(200), email: z.string().trim().email().nullable().optional() }`
  - Return: `{ id: string; name: string }`. If a person with that email already exists, returns it instead of creating a duplicate.
- `circles.linkMember`
  - Input: `{ rosterId: z.string().min(1), personId: z.string().min(1) }` → `{ ok: true }`. Sets `personId`, and `displayName` to the person's name. If the same person is already active in that series, the legacy row is retired instead (no duplicates).
- `circles.confirmMember` (renamed from `follow`): `{ rosterId }` → `{ personId }`. Confirms the linked person. It no longer creates people.
- `circles.get`: roster items gain `person: { id, name, status } | null`.
- `circles.forMeeting` (new, for the calendar panel)
  - Input: `{ meetingId: z.string().min(1) }`
  - Return: `{ seriesId: string; meetingId: string; saved: boolean; count: number; names: string[] } | null`
- Removed: `circles.saveFromNames`, `circles.addMember`, `circles.follow`.

## UI Surface

- `apps/web/src/app/meetings/components/CircleCard.tsx`: picker plus save replaces the textarea form. The roster list shows linked names, "אשר באנשים" / "קשר לאדם". The bottom input keeps only "אורח היום". Reuses `MeetingPeoplePicker` (adds an `onCreate` prop for the "צור ״…״ באנשים" option). Data comes from `people.list`.
- `apps/web/src/app/calendar/components/EventDetailPanel.tsx`: new "חוג" detail row (desktop and responsive web).
- RTL, dark theme, `.btn` / `.input` / `.card` classes only. Mobile (ARO) has no circle editor today, so no change there.

## Tests

- Vitest (`packages/api/src/routers/circles.test.ts`): saveFromPeople keep/reactivate/retire, bad person id, createPersonForCircle dedupe by email, calendar import links or creates unconfirmed people, linkMember dedupe, backfill on get, forMeeting.
- Playwright: on a series meeting, pick two people, save, see both in the roster; create a new person from the picker and see them in People; the calendar panel shows the circle row.

## Out of Scope

- Making guests ("אורח היום") People records.
- A DB-level `NOT NULL` on `series_roster.person_id`.
- Circle editing in the mobile app.
- Changing how series are detected from the calendar.

## Open Questions

Resolved 2026-11-05 (approved with defaults): unknown calendar attendees are created as `unconfirmed` People; "אורח היום" stays free text.
