# QA — world-division-visible

**Date:** 2026-10-21
**Spec:** `docs/specs/world-division-visible.md`

## New and updated tests

| Suite | File | Result |
|---|---|---|
| Vitest — world filter includes children and unassigned rows for tasks, meetings, projects, people | `packages/api/src/routers/world-division-visible.test.ts` | ✅ 4/4 |
| Vitest — people list under a world now also returns unaffiliated people, affiliated first | `packages/api/src/routers/people-domain-hierarchy.test.ts` | ✅ 19/19 |
| Vitest — workspace tree, parent rules, merge | `packages/api/src/routers/workspaces.test.ts` | ✅ 24/24 |
| Playwright — header switcher filters tasks, chip clears the filter, settings page lists worlds | `apps/web/e2e/task-workspaces.spec.ts` | ✅ 5/5 |
| Playwright — drawer affiliation, header filter DAZ then Dragontail, folded 390px layout | `apps/web/e2e/people-domain-hierarchy.spec.ts` | ✅ 3/3 |

Command for the API files: `pnpm exec vitest run` in `packages/api` on the three files above (47 tests). Playwright was `pnpm --filter @ak-system/web exec playwright test` on the two specs (8 tests). The first Playwright pass failed because the switcher options use `role="option"` and the settings names sit next to a kind label; both specs were updated and the rerun passed.

## Not run this pass

`pnpm test` and `pnpm e2e` for the whole repo were not re-run. Earlier QA on this branch already recorded unrelated failures in voice transcription, WhatsApp, and a few e2e specs.

## What the browser specs exercised

- Switcher resting label «הכל», opening the panel, picking DAZ, the «מסונן: DAZ ✕» chip, and clearing it.
- A task assigned to פרטי disappears under DAZ and comes back when the chip is cleared.
- A person linked to DAZ stays visible under DAZ and is gone under Dragontail.
- Settings → עולמות lists the four seeded worlds and still saves a Notion label.
- At 390px the switcher chip is on screen and the people page does not overflow horizontally.
