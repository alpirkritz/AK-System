# QA UI report — dashboard-task-open-sort

**Stack:** next-trpc-monorepo  
**Verdict:** PASS

## Automated
- Playwright `e2e/dashboard-task-open-sort.spec.ts`: title opens modal; checkbox does not; `documentElement.scrollWidth <= clientWidth` (no horizontal page scroll)

## Manual / exploratory
- Interaction: checkbox toggles done; title opens TaskModal; sort select full-width under heading
- Keyboard / focus: title is a real `<button>`; checkbox separate; sort has `aria-label`
- Responsive: `grid-cols-1` / `md:grid-cols-2` with `minmax` via equal `1fr` tracks; `html/body/main` `overflow-x: hidden` + `min-w-0`
- Accessibility (spot): priority is a color dot with `aria-label` / `title` (no Hebrew badge text in-row); due date / assignee / status removed from dashboard row (details in modal)
- Cross-browser: Chromium via Playwright

## Design decision (UI Designer + QA UI)

**Goal:** fit full viewport with zero horizontal scroll.

| Before | After |
|---|---|
| Title + due + priority label + avatar in one flex row | Checkbox + truncated title + 8px priority dot |
| Sort select inline with heading | Sort on its own full-width row |
| Unequal grid `1.2fr / 1fr` | Equal `grid-cols-2` |
| Metadata / avatars on meetings | Title + one meta line, both `truncate` |

## Failures
None.

## Evidence
- Spec: `docs/specs/dashboard-task-open-sort.md`
- Review: `reports/dashboard-task-open-sort.md`
- E2E asserts no horizontal overflow on `/`
