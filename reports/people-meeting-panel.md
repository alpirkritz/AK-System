# people-meeting-panel — report

**Spec:** `docs/specs/people-meeting-panel.md` · **Date:** 2026-11-11

## Verdict: APPROVED WITH NITS

(Written by the implementing agent, not an independent reviewer. A separate pass is still worth doing.)

## What shipped

- `waiting.owedByMe` (task assigned to me **and** linked to the person; nothing else counts) and `waiting.quickAdd` (iOwe task / theyOwe task / accepted `owner=them` commitment) in `packages/api`.
- Resizable panel: `useResizablePanel` hook, drag handle (`role="separator"`, keyboard, double-click cycle), width saved in localStorage, re-clamped on resize/fold.
- Tabs "במפגש" / "פרטים" / "היסטוריה"; the meeting tab has the two count cards, lists, "חשוב לדעת" and a sticky quick-add bar. Merge moved into "פרטים".
- Side-by-side (no backdrop, list stays usable) when the panel is ≥720px **and** ≥560px of the screen remains.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/api test` | all passed (140 files); then re-ran `waiting` router + service tests after restoring the two original router tests: 10 passed (4 new + 2 new service-level `listOwedByMe`, 4 new `quickAdd`) |
| Playwright: `people-meeting-panel` (5 new), `people-domain-hierarchy`, `email-as-contact-channel`, `waiting-commitment-open`, `person-traits`, `person-context-circles` | 20 passed |
| `pnpm -r run lint` | no errors (existing warnings only) |
| `pnpm --filter @ak-system/web build` | passes |
| Manual, in-app browser | 360×800 (Fold cover), 880×800 (Fold open), 1024 desktop |

Existing e2e specs that looked for "שיוכים" on the person card now click the "פרטים" tab first.

## Nits / deviations from spec

- Width is stored in localStorage only; no `userSettings` key (spec allowed the fallback).
- "חשוב לדעת" renders the existing `PersonContextCard` (not three trimmed lines), so its own "הקשר" heading shows right under it.
- "+ הערה" left out (no person note field to power it; notes show read-only in "חשוב לדעת" and are edited in "פרטים").
- Side-by-side needs ≥560px free beside the panel (added after seeing the list crushed at 1024px); spec updated.
- Not tested on a real Galaxy Z Fold 7, only emulated viewports. Not run: the full `pnpm e2e` suite and the mobile app (out of scope).
- `commitments.source = 'manual'` is used for hand-added commitments; it is not in `COMMITMENT_SOURCES` (column is free text, UI treats it as "manual").
