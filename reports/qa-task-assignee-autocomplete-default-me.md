# QA — Task Assignee Autocomplete + Default to Me

> **Slug:** `task-assignee-autocomplete-default-me`
> **Date:** 2026-08-06
> **Detected stack:** `next-trpc-monorepo` (+ Helm Expo mobile)

## Commands run

| Command | Result |
|---|---|
| `pnpm test` (Vitest, `packages/api`) | **PASS** — 42 files, 473 tests |
| `pnpm --filter @ak-system/web exec playwright test e2e/task-assignee.spec.ts` | **PASS** — 3/3 |
| `pnpm e2e` (full Playwright suite) | 50 passed, 1 skipped, **9 failed (all pre-existing)** |
| `pnpm --filter @ak-system/web build` | **PASS** |
| `pnpm -r run lint` | mobile + whatsapp-bridge `tsc --noEmit` **PASS**; `apps/web` **blocked** (see below) |

## New automated coverage

`packages/api/src/routers/tasks.test.ts` (6 tests)

- Omitted `assigneeId` resolves to the owner's contact.
- The owner contact is created on the first task when it does not exist yet.
- `assigneeId: null` stays null.
- An explicit assignee id is preserved.
- `update` never injects a default.
- `update` can clear an assignee.

`packages/api/src/routers/people.me.test.ts` (2 tests)

- `people.me` creates the owner once and returns the same id on repeat calls.
- Matches an existing contact by name case-insensitively (no duplicate row).

`apps/web/e2e/task-assignee.spec.ts` (3 tests)

- New task pre-fills אחראי with the owner; typing filters the list; no match renders "לא נמצא איש קשר".
- "ללא אחראי" clears the value, saves, and is still cleared when the task is reopened.
- Escape closes the list without changing the value; Enter picks the highlighted option.

## Pre-existing failures (not caused by this change)

All 9 `pnpm e2e` failures are in areas this change does not touch, and each reproduces from the committed state of the app:

| Spec | Cause |
|---|---|
| `qa-structured.spec.ts` (4 tests) | `beforeEach` waits for a dashboard heading matching `/שלום/`; `apps/web/src/app/page.tsx` (unmodified here, last changed in the deep-navy UI refresh) no longer renders one. |
| `full-flow.spec.ts` (2 tests) | Same missing `/שלום/` heading, plus a missing "פגישות חוזרות" heading on `/recurring`. |
| `agents-triggers.spec.ts`, `bank-accounts.spec.ts`, `trading-journal.spec.ts` | Unrelated feature areas with in-progress working-tree changes. |
| WhatsApp bridge `ECONNREFUSED` noise | The bridge service is not running locally. |

## Manual test script — Helm (not covered by Playwright)

There is no e2e harness for the Expo app; verify by hand on a device or simulator:

1. **Assignee default** — Tasks tab → `+` → the אחראי row shows the owner's name with an "אני" tag.
2. **Picker search** — tap the אחראי row → sheet opens with the search field focused → type part of a contact name → list filters → tap a contact → the row updates and the sheet closes.
3. **Clear** — reopen the picker → "ללא אחראי" → the row reads "ללא אחראי"; save and reopen the task to confirm it persisted.
4. **Existing task** — open a Notion-sourced task assigned to someone else → the row shows that person, unchanged after saving.
5. **Sync button, configured** — with Notion configured, the tasks list shows "סנכרן מ-Notion"; tapping disables it and shows "מסנכרן…", then a result line ("יובאו N משימות מ-Notion") and a refreshed list.
6. **Sync button, not configured** — with Notion unconfigured the button is absent.
7. **Sync failure** — kill connectivity mid-sync and confirm the message reads "הסנכרון נכשל" and the button becomes tappable again.

## Blocked check

`pnpm --filter @ak-system/web lint` runs `next lint`, which has no ESLint config in the repo and drops into an interactive setup prompt. This predates the change; type safety for `apps/web` was covered by the production build instead, which compiles and type-checks the whole app and passed.

## Verdict

**PASS** — every new and existing unit/e2e test relevant to this change is green; remaining suite failures are pre-existing and unrelated.
