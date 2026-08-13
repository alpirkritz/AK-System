# Person merge from detail drawer

> **Slug:** `person-merge-from-drawer`
> **Status:** Approved
> **Last Updated:** 2026-08-12

## Goal

When the owner opens a person card and notices a duplicate (e.g. `Shani Asaraf` vs `Asaraf Shani`), they can merge immediately from that drawer into the other contact — without going through the unconfirmed review queue.

## User Stories

- As the owner, I want a **מזג** action on the person detail drawer so that I can fix duplicates the moment I see them.
- As the owner, I want search (with a name-order hint) so that finding `Asaraf Shani` from `Shani Asaraf` is easy.

## Acceptance Criteria

- [ ] Person detail drawer (`PersonDetailDrawer`) exposes a **מזג** control (not only edit/close).
- [ ] Activating it opens an inline search picker (same pattern as `PeopleReviewQueue`).
- [ ] Search uses existing `people.search`; current person is excluded from results.
- [ ] Choosing a target calls existing `people.merge({ fromId: current, toId: target })`.
- [ ] On success: invalidate people lists/related queries, close the drawer (source person was deleted).
- [ ] On open of the merge panel, prefill search with reversed first/last name when the name has exactly two tokens (e.g. `Shani Asaraf` → `Asaraf Shani`).
- [ ] No schema or tRPC API changes required (reuse `people.merge` / `people.search`).
- [ ] Hebrew microcopy; RTL; `.btn` / `.input` design-system classes.

## Data Model

None.

## tRPC API

None new. Reuse:

- `people.merge` — `{ fromId, toId }`
- `people.search` — `{ query }`

## UI Surface

- `apps/web/src/components/people/PersonDetailDrawer.tsx`
  - Header actions: add **מזג** next to edit.
  - Expandable merge panel under header (search + result rows with **מזג לכאן**).
  - Optional confirm step: click on a result merges immediately (same as review queue).

## Out of Scope

- Auto-merge / automatic duplicate detection across the people list.
- Bulk merge.
- Changing Notion source pages (identities move via existing `repointPersonExternalIds`).
- Mobile app.

## Open Questions

None — confirmed by user request (merge when seeing Shani Asaraf / Asaraf Shani).
