# Code Review: Meeting prep topic isolation

> **Slug:** `meeting-prep-topic-isolation`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-10-06

## Spec Conformance

Single-meeting prep now keeps a note or task only when it shares a topic token with the calendar title, or the same project / series. Shared attendees no longer qualify. Day-wide `prepDate` without `focusTitle` is unchanged.

Acceptance criteria covered by Vitest: token rules, DD vs Algo notes under `focusTitle`, project and series bridges, task filtering, prior-note selection, and injection of `focusTitle` from exactly one `Meeting:` line.

## Static Checks

| Check | Result |
|---|---|
| Targeted Vitest (api meeting notes + topic match; web brief, engine, tool) | PASS — 17 api + 43 web in the touched files |
| ESLint on touched `apps/web` files | PASS |
| `pnpm -r run lint` | not run |
| `pnpm --filter @ak-system/web build` | not run |

## Findings

### Must-fix

None.

### Nits

- `keepNotesForFocusTitle` loads every meeting row on each focused call. Fine for this personal database; revisit if the table grows.
- No Playwright case. The change is agent context, not a page.

## Out of Scope Creep

None. No alias table for DD ↔ Dragon Drive. No schema change.
