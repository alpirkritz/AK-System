# Person portrait — reread when the write finds no traits

> **Slug:** `person-portrait-reread`
> **Stack:** `next-trpc-monorepo`
> **Status:** Implemented
> **Amends:** `docs/specs/person-portrait.md`

## Goal

A click on "נתח אופי" for a person who already has meeting briefings must write traits about that person. A finished write that stored zero traits must say so, and the next click must read the briefings again.

## User stories

- As Alpir, I want traits about Shani herself, so a room-level briefing is not treated as if she has no character.
- As Alpir, I want the analyzer to read the stored briefing, so the short mood line is not the only evidence.
- As Alpir, I want "נתח שוב" to read the conversations again when the last write saved no traits, so I am not stuck on an empty result.
- As Alpir, I want the empty line to say the conversations were read, so it does not look like the analysis never ran.

## Acceptance criteria

- Given a completed meeting analysis whose `transcriptText` is the briefing, when "נתח אופי" runs, then that briefing is included in the artifact text, clipped to 6000 characters, together with title, date, mood, subtext, key insight, and score rationale.
- Given the write runs for a person, when observations are extracted, then the prompt names that person and asks only for their behaviour. Observations about "the participants", another named person, or the meeting as a whole are not requested.
- Given the model returns traits and at least one is stored as `shown` or `once`, when the write finishes, then source scans are updated as they are today, and an unchanged artifact is not sent again.
- Given the model returns no trait that links to a stored observation, when the write finishes, then `traitsAt` is still set, no `person_source_scans` row is inserted or updated for that run, and the next "נתח שוב" sends the current artifacts to extraction again.
- Given scans already exist and the person has zero `shown` and zero `once` traits, when "נתח שוב" runs, then every artifact in the window is extracted again even if `sourceUpdatedAt` is unchanged.
- Given a write finished with sources and zero shown traits, when the card renders, then the line is "השיחות נקראו, ועדיין אין תכונה שחוזרת על עצמה." and the button is "נתח שוב". The pre-write line "עוד אין תכונות." and the button "נתח אופי" stay only when `traitsAt` is null.
- Given Gemini throws, when the click finishes, then the previous traits and scans stay, and the existing error "לא הצלחנו לנתח. התכונות הקודמות נשמרו. נסה שוב." is shown.
- Given the same two-meeting fixture as today, when the write succeeds with a shown trait, then the second call still does not call extract again.

## Data model

No schema change. `people.traitsAt`, `person_traits`, `person_observations`, and `person_source_scans` stay as in `packages/database/src/schema.ts` and `packages/database/src/schema.pg.ts`.

Write rule change in `packages/api/src/services/person-portrait.ts` only: a run that classifies zero traits does not write scans. A run that starts with zero `shown` and zero `once` rows treats every in-window artifact as unscanned.

## tRPC API

No new procedure. `insights.writePersonTraits` in `packages/api/src/routers/insights.ts` keeps input `{ personId: string }` and the `personTraits` return shape.

`PortraitModel.extract` receives `{ name: string; artifacts: Artifact[] }` instead of a bare artifact array. `cluster` is unchanged.

Artifact text for `meeting_analysis` adds `transcriptText` clipped to 6000 characters. WhatsApp summaries, email threads, and commitments stay as specified in `person-portrait.md`.

## UI surface

`apps/web/src/components/people/PersonTraits.tsx` and `apps/mobile/app/person/[id].tsx`, empty branch only:

- `traitsAt == null`: "עוד אין תכונות." and "נתח אופי".
- `traitsAt` set and no shown traits: "השיחות נקראו, ועדיין אין תכונה שחוזרת על עצמה." and "נתח שוב".

No change to the trait list, the detail row, or hide/undo.

## Out of scope

- Analyzing the 89 calendar meetings that have no completed briefing.
- WhatsApp threads that have no `whatsapp_dm_summaries` row.
- Changing the two-source rule for the default list.
- A new Gemini call on page load.
- Rewriting traits for people who already have at least one stored trait.

## Open questions

None.
