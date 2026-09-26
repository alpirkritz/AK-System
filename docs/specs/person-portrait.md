# Person portrait — character traits

> **Slug:** `person-portrait`
> **Stack:** `next-trpc-monorepo`
> **Status:** Implemented

## Goal

Show five to seven Hebrew lines of a person's character, read from conversations already stored and ordered from the most-supported trait to the least. One more click on "פירוט תכונות" shows, per trait, how it was reached and which conversations support it.

## User stories

- As Alpir, I want five to seven short lines about who this person is, so I know them in ten seconds before a meeting.
- As Alpir, I want the strongest trait first, so the order itself tells me what matters most about them.
- As Alpir, I want one click to see how each trait was reached, with the conversations behind it, so I can trust it or reject it.
- As Alpir, I want to hide a trait I think is wrong, and have it stay hidden when the traits are written again.
- As Alpir, I want the traits written only when I click, and to see when newer conversations arrived since.
- As Alpir, I want the same view on the phone.

## Acceptance criteria

### Traits (default view)

- Given the person has no completed meeting analysis, no WhatsApp DM summary, and no email thread, when the card loads, then the traits block shows "אין עדיין שיחות לנתח." and no button. Gemini is not called.
- Given sources exist and no traits were written, when the card loads, then it shows "עוד אין תכונות." and the button "נתח אופי". Page load does not call Gemini.
- Given Alpir clicks "נתח אופי", when the write finishes, then up to seven traits are stored and shown, with the caption "לפי {n} שיחות · {date}", where n is the number of distinct source artifacts behind the shown traits and date is the Asia/Jerusalem write date. While in flight the button is disabled and reads "מנתח…".
- Given a candidate trait, when it is supported by fewer than two distinct source artifacts, then it is not shown in the default view.
- Given traits are shown, when they render, then they are ordered by `supportCount` descending, ties broken by the newest supporting source date. Each line is a bold trait label (one to three words) followed by one clause, at most 90 characters in total, and no badge, date, or icon.
- Given fewer than three traits qualify, when the block renders, then it shows those traits and the line "צריך עוד שיחות כדי לתאר אותו בביטחון."
- Given a completed analysis, DM summary, or email thread is newer than `traitsAt`, when the card loads, then a quiet line under the traits reads "יש שיחות חדשות · נתח שוב". It is not regenerated until the click.
- Given Gemini fails, when the click finishes, then the previous traits stay and the block shows "לא הצלחנו לנתח. התכונות הקודמות נשמרו. נסה שוב."

### Detail ("פירוט תכונות")

- Given traits exist, when the block renders, then under the traits there is one collapsed row: a chevron, the label "פירוט תכונות", and a count pill with the total number of evidence rows behind the shown traits. The row is closed by default.
- Given Alpir opens the row, when it expands, then each shown trait appears in the same order with its label, a one-sentence "איך הגעתי לזה" reasoning, `supportCount` in the form "{k} שיחות", and its evidence rows, newest first. Each evidence row shows the source kind (פגישה, וואטסאפ, מייל), the date, and a quote of at most 160 characters copied from the stored artifact.
- Given an evidence row from a meeting, when it is clicked, then it opens `/meetings/{meetingId}`. An email row opens the Gmail thread URL already stored. A DM summary row is not a link.
- Given the detail is open, when it renders, then below the shown traits there is one collapsed line "נראה פעם אחת ({m})" listing single-source candidates with their one evidence row. These never enter the default view.
- Given Alpir clicks "הסתר תכונה" on a trait in the detail, when the action completes, then the trait leaves both views immediately, the next shown candidate (if any) moves up, and the next "נתח שוב" does not return a trait with the same label.
- Given the detail is open, when Alpir clicks "נתח שוב" at its bottom, then it behaves exactly like "נתח אופי".

### Sources and cost

- Given the same source artifact is unchanged since its last scan, when "נתח שוב" runs, then that artifact is not sent to Gemini again.
- Given a voice recording produced a meeting analysis, when sources are collected, then it counts once, as a meeting.
- Given the web drawer and ARO `/person/[id]`, when traits exist, then both show the same traits, order, detail, and actions.

## Data model

Additive only. Mirror in `packages/database/src/schema.ts` and `packages/database/src/schema.pg.ts`. SQLite bootstrap in `packages/database/src/index.ts`: `CREATE TABLE IF NOT EXISTS` for the new tables, `ALTER TABLE people ADD COLUMN traits_at TEXT` appended after existing alters. EC2 production is SQLite.

`people`, declared last:

- `traitsAt` text, nullable. ISO time of the last successful write.

New table `person_source_scans` (what was already read, so a re-run is cheap):

- `id` text pk; `personId` text not null, FK → `people.id` cascade, indexed
- `sourceKind` text not null — `meeting_analysis` | `whatsapp_dm_summary` | `email_thread`
- `sourceId` text not null; `sourceUpdatedAt` text not null; `scannedAt` text not null
- unique (`personId`, `sourceKind`, `sourceId`)

New table `person_observations` (raw evidence, one behavioural observation per artifact):

- `id` text pk; `personId` text not null, FK cascade, indexed
- `claim` text not null — one Hebrew sentence of observed behaviour, at most 200 characters
- `quote` text, nullable — at most 160 characters, copied from the artifact
- `sourceKind`, `sourceId`, `sourceDate` (ISO date) text not null
- `createdAt` text not null

New table `person_traits`:

- `id` text pk; `personId` text not null, FK cascade, indexed
- `label` text not null — one to three Hebrew words
- `line` text not null — the full default-view line, at most 90 characters
- `reasoning` text not null — one sentence, at most 200 characters
- `supportCount` integer not null — distinct source artifacts
- `latestSourceDate` text not null
- `status` text not null, default `shown` — `shown` | `once` | `dismissed`
- `createdAt`, `updatedAt` text not null

New table `person_trait_evidence`: `traitId` FK → `person_traits.id` cascade, `observationId` FK → `person_observations.id` cascade, unique pair.

Export `PERSON_TRAIT_STATUSES` from both schema files.

Write rule: rescanning an artifact whose `sourceUpdatedAt` is newer than its scan replaces that artifact's observations. Each write deletes the person's `shown` and `once` traits and inserts the new set. `dismissed` rows are kept, and their labels are passed to the model as excluded.

## tRPC API

Extend `packages/api/src/routers/insights.ts`, all `protectedProcedure`. Logic in the new service `packages/api/src/services/person-portrait.ts`. Model: `GEMINI_MODEL`, else `gemini-2.5-flash`.

`personTraits` query, input `{ personId: string }`, no Gemini. Returns:

- `traits`: `{ id, label, line, supportCount }[]` for `shown`, ordered as above, at most 7
- `traitsAt: string | null`; `stale: boolean`; `hasSources: boolean`
- `sourceCount: number`; `evidenceCount: number`

`personTraitDetail` query, input `{ personId: string }`, no Gemini. Returns `shown` traits with `reasoning` and `evidence: { observationId, sourceKind, sourceDate, quote, href: string | null }[]`, plus `once` traits in the same shape.

`writePersonTraits` mutation, input `{ personId: string }`. Source window, newest first:

- Up to 16 completed `meeting_analyses` on meetings in `meeting_people`: date, title, mood, subtext, key insight, score rationale. Not `transcriptText`.
- Up to 8 `whatsapp_dm_summaries`: summary and its date range. Not raw DM rows.
- Up to 8 `person_email_threads`: subject, snippet, date.
- Up to 12 `commitments` with `owner = them`: content, status.

Step 1, extract, only for unscanned or updated artifacts: return zero to three observations of this person's behaviour, each with a quote from the input. Empty is valid.
Step 2, cluster: from all observations and the excluded labels, return traits. Each trait lists the observation ids it rests on, a label, a line, and a reasoning. `supportCount` is computed in code from distinct `sourceId`s, not trusted from the model. Two or more → `shown` (top 7 by count), one → `once`.
Store only after step 2 succeeds; on failure throw the Hebrew error and keep the previous rows. Returns the `personTraits` shape.

`dismissPersonTrait` mutation, input `{ traitId: string }`. Sets `dismissed`, no Gemini. Missing id throws `NOT_FOUND`. Returns `{ id }`.

`insights.personContext` also returns the `personTraits` payload so the card paints in one round trip. `personTraitDetail` loads only when the row is opened.

## UI surface

New component `apps/web/src/components/people/PersonTraits.tsx`, rendered as the first block inside `PersonContextCard.tsx`, above the recommendation, under the heading "אופי".

- Default: the trait lines as a plain list, generous line height, `text-sm`, label in `#eef3fb` semibold and the clause in `#b8c4dc`. Caption in `#5a688c` `text-[11px]`. No borders or badges between lines.
- The "פירוט תכונות" row matches the existing collapsed-row pattern: full-width button, chevron at the inline end, count pill `bg-white/5` `tabular-nums`, 44px minimum height, `aria-expanded`.
- Detail: one group per trait, separated by spacing, not cards within the card. "הסתר תכונה" is a `.btn-ghost` text button at the group's end. No confirm dialog. Instead the toast "התכונה הוסתרה · בטל" stays for five seconds, and "בטל" calls `restorePersonTrait` (input `{ traitId }`, sets `shown`, no Gemini).
- Primary button "נתח אופי" / "נתח שוב" is `.btn` only in the empty state. With traits present, it lives as the stale line or at the bottom of the detail, so the default view has no button.

ARO: `apps/mobile/app/person/[id].tsx` gets the same block, first in the screen, with the same copy, using the existing collapsed-row component style there.

## Out of scope

- Reordering or trimming the rest of `PersonContextCard`. That is a separate focus pass.
- Numeric trait scores, personality-test types, or clinical terms.
- Raw transcripts, raw WhatsApp messages, group chats, full email bodies.
- Writing on page load, on a cron, or when an analysis finishes.
- Using traits in meeting prep, the morning brief, or WhatsApp.
- Un-hiding a trait after the undo toast is gone, or editing a trait's text by hand.
- Circles.

## Open questions

None.
