# Person aliases — one identity per person

> **Slug:** `person-aliases`
> **Status:** Approved — in progress (see reports/person-aliases.md)
> **Last Updated:** 2026-11-01

## Goal

The people table is the owner's source of truth, but one person arrives under many names (ירדן, ג׳ורדן, Jordan Ferenz, "Ferenz, Jordan"). Every path that creates or matches a person (meetings, WhatsApp, Notion, email, voice, conversation analysis) must land on the same `personId`, and a name the system has been taught once is never asked about again.

## User Stories

- As the owner, I want to add other names to a person's card, so every source resolves to them.
- As the owner, I want a merge to remember the merged person's name, so the duplicate never comes back.
- As the owner, I want an unknown name to ask me once ("זה ירדן?") instead of silently creating a new person.
- As the owner, I want to see when a person was recognised through an alias, so I can correct a wrong match.

## Acceptance Criteria

- [ ] Given a person with alias "Jordan Ferenz", when a meeting participant, WhatsApp sender, Notion person, email or voice mention arrives as "jordan ferenz", then it resolves to that person and no new person is created.
- [ ] Matching normalises case, niqqud, punctuation, ג׳/ג, and "Last, First" order before comparing.
- [ ] Resolution order: email or phone, then exact normalised alias or name, then fuzzy. Fuzzy never auto-links; it creates a suggestion.
- [ ] Given `people.merge(A → B)`, A's name and A's aliases become aliases of B.
- [ ] An alias belongs to one person. Adding one that already belongs to someone else is refused and names the owner, with a "merge instead" action.
- [ ] A name that resolves to nothing and has no fuzzy suggestion creates the pending person as today. One with a fuzzy suggestion goes to the identity queue and stays unlinked until answered.
- [ ] Identity queue: one question at a time, "'X' מ<source>. זה <candidate>?" with [כן] [אדם חדש] [אחר…]. "כן" stores the alias; "אדם חדש" stores a not-the-same pair like `duplicateReviews`.
- [ ] Person card shows aliases as removable chips with an add field. Removing an alias does not unlink history.
- [ ] A one-off clean-up lists existing duplicate pairs from `findDuplicatePairs` with "מזג וזכור את השם".
- [ ] RTL and dark theme correct; chips use existing design-system classes.

## Data Model

`schema.pg.ts` and `schema.ts` (plus SQLite bootstrap in `database/src/index.ts`):

```
person_aliases
  id            text pk
  person_id     text not null → people.id on delete cascade
  alias         text not null        -- as displayed
  alias_norm    text not null        -- normalised key
  source        text not null        -- manual | merge | queue | sync
  created_at    text not null
  unique (alias_norm)
```

Backfill: one alias per existing person name and per `person_external_ids.display_name`.

## tRPC API

- `people.aliases.list({ personId })`, `add({ personId, alias })`, `remove({ id })`.
- `people.merge` extended to write aliases.
- `people.identityQueue.next()` and `people.identityQueue.answer({ id, personId | 'new' })`.
- Service `resolvePerson({ name?, email?, phone?, jid? })` in `packages/api/src/services/person-resolution.ts`, returning `{ personId, via } | { suggestion } | null`. Wired into `meeting-attendees.ts`, `notion-tasks-sync.ts`, `email-sync.ts`, `analysis-whatsapp.ts`, `analysis-message.ts`, `google-contacts-sync.ts` and `slack.ts`, replacing their own name matching.

## UI Surface

- Web `people/[id]`: aliases chips.
- Web: identity-queue card on the dashboard and next to meeting participants.
- Mobile: same chips on the person screen and the queue card on home.
- "זוהה מ-<alias>" tag next to resolved names.

## Out of scope

Automatic merging without confirmation; cross-owner identity; changing Notion's own names.

## Open questions

- Should a Hebrew first name alone ("ירדן") match when two people share it? Proposed: ambiguous matches go to the queue.
