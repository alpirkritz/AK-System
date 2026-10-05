# Dashboard only on a real shift, and a searchable meeting people field

## Goal

The dashboard's first card names Guy Gamzu every day because it ranks the whole relationship board and labels anyone who is not cooling as "מתחמם". Show that card only when a person or circle actually warmed or cooled, and say why. In the meeting form, stop rendering every contact as a chip; keep the people already on the meeting visible, and find the next one by typing or from a short recent list.

## User stories

- As Alpir, I want the dashboard to stay quiet when no relationship actually moved, so a standing name does not compete with the day.
- As Alpir, I want the card, when it appears, to name the biggest real shift and one sentence of why, so I know whether to open קשרים.
- As Alpir, I want the same rule on the phone home screen, so ARO does not keep a stale name either.
- As Alpir, I want the people already on a meeting shown as removable chips, so I see who is in without scanning the directory.
- As Alpir, I want to add someone by typing a name, company, or role, so a long contact list never opens inside the meeting form.
- As Alpir, I want a few recent people suggested before I type, so repeat attendees are one tap away.

## Acceptance criteria

- Given the relationship board has people or circles and none of them has `trend` of `warming` or `cooling`, when the web dashboard or the ARO home loads, then no attention card is rendered. A `stable` or null trend is not shown, and is not labeled "מתחמם".
- Given one or more cards with `trend` `warming` or `cooling`, when the dashboard loads, then the card links to `/relationships` (web) or the relationships screen (ARO) and shows the one with the largest absolute gap between `recentAvg` and `olderAvg`. Label "קשר שזז". Line "{name} מתקרר" or "{name} מתחמם". Under it, `dataReason` on at most two lines. When other warming or cooling cards exist, the first line ends with "· ועוד {n}" where `{n}` counts only those other movers.
- Given the board query has not returned, when the dashboard paints, then the attention slot is absent. No skeleton, no error text for this card. A failed board fetch on the phone leaves the card absent and does not fail the rest of the home screen.
- Given the new-meeting or edit-meeting dialog (from `/meetings`, `/meetings/[id]`, or a project page), when it opens, then the field "משתתפים" shows only the people already selected, each as a chip with "הסר את {name}". It does not render the rest of the directory. No selection shows the line "עדיין אין משתתפים".
- Given focus is in "חפש לפי שם, חברה או תפקיד" and the query is empty, when suggestions open, then at most six people appear under "לאחרונה": distinct `peopleIds` from `meetings.list`, meetings newest first, skipping anyone already selected. If that list is empty, the only line is "הקלידו לפחות אות אחת".
- Given one or more characters, when the list filters, then it matches name, company, or role, skips people already selected, and shows at most eight rows. No match shows "אין אנשי קשר תואמים". A typed name that equals someone already selected shows "{name} כבר בפגישה".
- Given the list is open, when Enter or a click chooses a row, then that person becomes a chip, the query clears, and the list stays open for the next name. Escape closes the list and keeps the chips. Backspace on an empty query removes the last chip. Clicking outside closes the list. Removing a chip does not ask for confirmation and does not delete the person.
- Given the dialog footer, when the people list is open, then "שמור" stays the only primary button and stays disabled until the title is non-empty, including while create or update is pending.

## Data model

No schema change. `packages/database/src/schema.ts` and `packages/database/src/schema.pg.ts` stay as they are. Warming and cooling keep the existing rule in `packages/api/src/services/warmth.ts`: absolute gap of at least 0.2, at least 4 analysed meetings for a person and 6 for a circle.

## tRPC API

No new procedure and no input change. The dashboard keeps reading `insights.relationshipBoard` from `packages/api/src/routers/insights.ts`. The people field keeps using the `people` array already passed into `MeetingModal`, plus the existing `meetings.list` query (`peopleIds`, `date`) for the recent six. Enable that query only while the meeting dialog is open.

## UI surface

Web dashboard: `apps/web/src/components/relationship/AttentionBanner.tsx`, still mounted from `apps/web/src/app/page.tsx` directly under the greeting. Extract the pick in `apps/web/src/lib/attention-shift.ts` so the component only renders. The card uses the existing `.card` link treatment, `data-testid="attention-banner"`, and `hover:border-[#2dd4bf]`. `dataReason` uses `line-clamp-2` and `text-[#97a4c2]`.

ARO home: `apps/mobile/app/(tabs)/index.tsx`. Replace `topShift` with the same rules in `apps/mobile/lib/attention-shift.ts` (mobile does not depend on `@ak-system/types`, so the function is duplicated and commented to stay in lockstep). Secondary line is `dataReason` with `numberOfLines={2}`. The card is omitted when the helper returns null.

Meeting form: replace the chip cloud in `apps/web/src/components/Modals/MeetingModal.tsx` (the "משתתפים" block) with `apps/web/src/components/ui/MeetingPeoplePicker.tsx`. The result list is in normal flow under the input, `max-h-[240px]` and its own scroll, so the dialog's overflow does not clip it. Combobox: `role="combobox"`, listbox, `aria-activedescendant`, ArrowUp, ArrowDown, Enter, Escape. Search input and each row and each remove control are at least 44px tall. Selected chip text uses the person's color the way the current selected chip does. Recent-list and filter logic live in `apps/web/src/lib/meeting-people-suggest.ts`.

Do not restyle the relationships page, the KPI strip, or `AddPersonControl`.

## Out of scope

- Changing the 0.2 gap, the 4-meeting person minimum, or the 6-instance circle minimum.
- Editing warmth notes, or any layout change on `/relationships`.
- Creating a person from the meeting dialog.
- `AddPersonControl` on conversation analysis, the tag buttons in `MeetingAttendees`, `PersonSelect`, and the voice or record participant lists.
- An ARO screen for editing meeting participants.

## Open questions

None.
