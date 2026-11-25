# Owner identity: recognise "me" by any name or email

## Goal
Every place that must know "this is Alpir" (meeting participants, task assignees/people, Hugo harness, WhatsApp/voice/Notion ingest) resolves the owner by the same rules, whatever the spelling or source: Alpir, אלפיר, Alpir Kritzler, אלפיר קריצלר, "Kritzler, Alpir", "Alpir K.", "Alpir Kritzler (Dragontail)", or any of the owner's emails.

## Findings (current state)
- `packages/api/src/lib/self-identity.ts#isSelfPersonName` is a whole-string match against 4 hardcoded aliases + `NOTION_USER_NAME`. Anything else ("Alpir K.", "Kritzler Alpir", "Alpir Kritzler - DAZ") is treated as a stranger.
- Email is never used for identity except in one calendar path (`routers/meetings.ts:610`, connected Google accounts). Dragontail (`kritzler.alpir@dragontailsystems.com`), DAZ (`alpir@daz.guru`) and Gmail are not recognised elsewhere.
- Local DB has two owner rows: `Alpir Kritzler` (notion, no email, 122 tasks) and `אלפיר` (manual, alpirkritz@gmail.com, 1 task). `ensureSelfPerson` only matches the canonical name, so the second is a live duplicate.
- Harness (`harness-reasoner.ts:971`) builds `selfIds` from `isSelfPersonName(name)` only, so rows matched by email are missed.

## Findings (production, read-only check 2026-11-17)
- Two owner rows: `Alpir Kritzler` (id p_me_1784232002803lvxtp, email `alpir.kritzler@yum.com` = old employer, 362 tasks, 98 task_people) and a duplicate `אלפיר` (p_self_muo54xsq_r2iyok, no email, 0 refs). Neither has the Dragontail/DAZ/Gmail address.
- **The owner is linked as an attendee on 98 of 2096 `meeting_people` rows.** Writers that never filter the owner: `notion-graph-sync.ts:634` (Notion "people" relation includes me), `services/voice.ts:204` (`linkMeetingPeople`), and several in `routers/meetings.ts` (360, 420, 699-754, 1399). That is why you appear in participant lists.
- Hugo's pre-meeting insights read those links and say "אין תקשורת מתועדת עם Alpir Kritzler לפני פגישת ... " (seen in `harness_insights`, e.g. recorded conversations). The harness graph also has `person` nodes for both owner rows, and the meeting nodes' labels carry my name.

## Added acceptance criteria
7. **No data is deleted or merged**, in prod or locally. Existing `meeting_people` links, duplicate owner rows and old insights stay as they are.
8. Self is resolved at read time from one helper `getSelfPersonIds(db)` = every `people` row whose name or email is the owner's (so both `Alpir Kritzler` and `אלפיר` count). Participant lists (meetings list/detail, series list/detail) drop those ids; harness selfIds use the same helper.
9. New writes of owner links are harmless (filtered on read), so no write-side gate is required.
10. `OWNER_EMAILS` env adds owner emails; defaults include the three known addresses.

## User stories
- As Alpir, I never appear as a participant of my own meeting, whichever name the calendar/Outlook/recording uses.
- As Alpir, tasks assigned to any of my names show as "אני".
- As Alpir, Hugo never treats me as a third party.

## Acceptance criteria
1. `isSelfPersonName` also accepts: reversed order ("Kritzler Alpir", "Kritzler, Alpir"), first name alone, initial surname ("Alpir K."), and the name with a trailing org/parenthetical suffix. A different first name with surname Kritzler (e.g. Rom Kritzler) is NOT self.
2. New `isSelfIdentity({ name, email })` is true when the email is in the owner email set OR the name matches. Owner emails = `OWNER_EMAILS` env + connected Google accounts + `people.email` of the canonical owner row.
3. All current `isSelfPersonName` call sites that have an email available use `isSelfIdentity`.
4. `ensureSelfPerson` finds the owner by name, then email; never creates a second row.
5. Unit tests for matcher (positives and Rom Kritzler negative) and for `getSelfPersonIds`.

## Data model
No new column. Canonical owner row gets `email` populated; extra emails come from `OWNER_EMAILS` (comma separated). Optional later: `people.aliases` JSON (both `schema.pg.ts` and `schema.ts`) , out of scope here.

## tRPC API
No new procedures. `people.me` unchanged in shape. Merge runs from `ensureSelfPerson` / a script `scripts/merge-owner-duplicates.ts`.

## UI surface
None. Behavioural fix only.

## Out of scope
Fuzzy matching of other people, an aliases editor in settings.

## Open questions
- Which emails besides alpirkritz@gmail.com, kritzler.alpir@dragontailsystems.com, alpir@daz.guru should count as yours?
- OK to auto-merge the `אלפיר` duplicate into `Alpir Kritzler` (1 task moves)?
