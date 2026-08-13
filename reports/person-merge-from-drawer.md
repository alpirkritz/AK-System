# person-merge-from-drawer — Review

> **Slug:** `person-merge-from-drawer`
> **Date:** 2026-08-12

## Spec

`docs/specs/person-merge-from-drawer.md`

## UI/UX Review

- **Verdict:** APPROVED
- Reuses review-queue merge pattern (search + מזג לכאן) inside `PersonDetailDrawer`.
- Prefills reversed two-token name to surface `Asaraf Shani` ↔ `Shani Asaraf`.
- Hebrew copy, `.btn` / `.input`, RTL, closes drawer after successful merge (source deleted).

## Implementation

- `apps/web/src/components/people/PersonDetailDrawer.tsx` — מזג action + inline picker.
- API: existing `people.merge` / `people.search` (no changes).

## Tests

- API merge already covered in `meeting-relationships.test.ts`.
- No new tRPC surface; UI-only change.

## Verdict

**APPROVED**
