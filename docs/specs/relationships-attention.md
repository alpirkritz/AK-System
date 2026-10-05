# Relationships attention

## Goal

Give warming and cooling relationships one page where the shift, the evidence, and Alpir's own one-line reason are visible together. The dashboard only points at that page when something moved.

## User stories

- As Alpir, I want one page of people and circles that are warming or cooling, so I do not open each card to see who moved.
- As Alpir, I want a sentence from the meeting scores and mood under each name, so I see why the average moved.
- As Alpir, I want to write and edit one sentence of my own on a person or a circle, so my reading of the relationship sits above the data.
- As Alpir, I want the dashboard to name the strongest shift and link to the page, so it gets my attention without becoming a second list.
- As Alpir, I want the same page on the phone, so I do not need the website to read or write the reason.

## Acceptance criteria

- Given a confirmed person with at least 4 analysed meetings in 180 days and a recent-90-day average at least 0.2 below the previous 90 days, when `/relationships` loads, then that person is under "מתקררים". The reverse gap is under "מתחממים". A smaller gap, or fewer than 4 meetings, is absent.
- Given a saved circle (`rosterSavedAt` set) with at least 6 analysed instances and the same gap, when the page loads, then it appears under "חוגים מתקררים" or "חוגים מתחממים".
- Given both lists, when the page renders, then each list is ordered by the absolute gap between the two averages, largest first. People sections render before circle sections. An empty section is omitted. When both are empty, the page shows "אין כרגע קשר שזז. אחרי ארבע שיחות מנותחות בחצי השנה, השינוי יופיע כאן."
- Given a card, when it renders, then it shows the name, מתקרר or מתחמם, the −1…+1 bar chart (older to newer, green above zero, yellow below), "ממוצע אחרון" and "ממוצע קודם" as signed two-decimal numbers, the data sentence, and up to three latest meetings (date, title, score out of 10). "פתח כרטיס" opens the person drawer on the web and `/person/[id]` on the phone. For a circle it opens the latest meeting in the series.
- Given recent and older scores, when the data sentence is built, then it states the 1–10 score direction ("הציון ירד מ־9 ל־3" or "הציון עלה מ־3 ל־9") and, when the latest recent meeting has a mood or score rationale, appends that text trimmed to 80 characters with the meeting date. No LLM call.
- Given no saved note, when the card renders, then the control reads "רשום את הדעה שלך". Submitting a non-empty sentence of at most 280 characters saves it and shows it above the data sentence under the label "למה אני חושב כך".
- Given a saved note, when I change it and press "שמור", then the new text replaces it and the card shows "נשמר" until the next edit. While the save is in flight the button is disabled. A failure shows "לא הצלחנו לשמור. נסה שוב."
- Given a saved note, when I press "נקה" and confirm "למחוק את הדעה שלך על {name}?", then the note becomes null and the write control returns.
- Given more than 280 characters, when I press "שמור", then the note is not saved and the field shows "עד 280 תווים."
- Given at least one flag, when the web dashboard or the ARO home loads, then one card names the largest shift ("דנה מתקררת") and, when others exist, "ועוד {n}". The card links to `/relationships`. When there are no flags, the card is absent.
- Given the people list on web and on ARO, when it loads, then the flags block is gone. A person who is warming or cooling shows a pill, "מתקרר" or "מתחמם", on the row.
- Given the phone, when I open "עוד", then "קשרים" opens the same page, including writing and clearing the note.

## Data model

Additive columns, declared last on each table so the SQLite `ALTER` order matches Drizzle. Mirror in `packages/database/src/schema.ts` and `packages/database/src/schema.pg.ts`. Add the `ALTER TABLE` statements at the end of the bootstrap list in `packages/database/src/index.ts`.

`people`:

- `warmthNote` text, nullable — the owner's sentence
- `warmthNoteUpdatedAt` text, nullable — ISO time of the last save or clear

`meeting_series`:

- `warmthNote` text, nullable
- `warmthNoteUpdatedAt` text, nullable

No new table. The data sentence is computed on read from `meeting_analyses.score`, `mood`, and `score_rationale`.

## tRPC API

Extend `packages/api/src/routers/insights.ts`. All procedures `protectedProcedure`.

- **`relationshipBoard`** (query). Input: none. Returns `{ people: Card[], circles: Card[] }` where each card is `{ id, name, trend: 'warming' | 'cooling', recentAvg, olderAvg, count, dataReason, note, noteUpdatedAt, timeline: { meetingId, date, title, score, sentiment }[] }`. People use the existing 90/180-day rule in `packages/api/src/services/warmth.ts`. Circles use the existing last-8 vs previous-8 rule, and only series with `rosterSavedAt` set. `timeline` is the analysed meetings already used for the trend, newest first, capped at 12 for the chart. The three-meeting list is the first three of that timeline.
- **`setWarmthNote`** (mutation). Input: `{ subject: z.enum(['person', 'circle']), id: z.string().min(1), note: z.string().max(280).nullable() }`. Empty or whitespace `note` is stored as null and clears `warmthNoteUpdatedAt`. A real sentence trims and stamps `warmthNoteUpdatedAt`. Unknown id returns `NOT_FOUND`. Returns `{ note, noteUpdatedAt }`.

`relationshipFlags` stays for the people-list pills and the dashboard highlight. It does not return notes.

## UI surface

New route `apps/web/src/app/relationships/page.tsx`. Title "קשרים". Subtitle "מי מתקרר ומי מתחמם, לפי השיחות של חצי השנה האחרונה." Add `{ href: '/relationships', label: 'קשרים' }` immediately after "אנשים" in both nav arrays in `apps/web/src/components/DashboardLayout.tsx`.

Card component `apps/web/src/components/relationship/RelationshipCard.tsx`. Reuse the sentiment chart treatment from `apps/web/src/components/relationship/WarmthBadge.tsx` (zero line, green above, yellow below). Note field is a single-line `.input`, label "למה אני חושב כך", buttons `.btn-primary` "שמור", `.btn-ghost` "נקה", `.btn-ghost` "רשום את הדעה שלך" and "פתח כרטיס". Data sentence is muted 12px and is not editable.

`apps/web/src/app/page.tsx`: replace the current `RelationshipFlags` chip block with one link card to `/relationships`, as in the acceptance criteria. `apps/web/src/app/people/page.tsx`: remove `RelationshipFlags`. `PersonRow` gains an optional trend pill.

`apps/web/src/components/people/PersonDetailDrawer.tsx` opens when "פתח כרטיס" is used for a person on this page (same drawer as `/people`, local state). Do not navigate away.

Mobile: `apps/mobile/app/relationships.tsx`, linked from `apps/mobile/app/(tabs)/more.tsx` and from the home card in `apps/mobile/app/(tabs)/index.tsx`. Remove the flag chip blocks from the home screen and from `apps/mobile/app/people.tsx`. Add the trend pill on the people row. The note field is a `TextInput`, 44px targets, "שמור" disabled while pending.

Loading: skeleton cards, not a blank page. Pull-to-refresh on the phone reloads the board.

## Out of scope

- WhatsApp groups. They have no −1…+1 score.
- An LLM paraphrase of the data sentence.
- Editing the note from the person drawer or the circle card on a meeting. The relationships page is the editor.
- Changing the 0.2 threshold, the 4-meeting minimum, or the 6-instance circle minimum.
- People-list sorting by warmth.

## Open questions

None.
