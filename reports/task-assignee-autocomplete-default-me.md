# Review — Task Assignee Autocomplete + Default to Me

> **Slug:** `task-assignee-autocomplete-default-me`
> **Date:** 2026-08-06
> **Detected stack:** `next-trpc-monorepo` (+ Helm Expo mobile)
> **Spec:** `docs/specs/task-assignee-autocomplete-default-me.md`
> **QA:** `reports/qa-task-assignee-autocomplete-default-me.md`

## Verdict

**APPROVED**

## Files changed

| File | Change |
|---|---|
| `packages/api/src/services/self-person.ts` | New — `getSelfPersonName()` / `ensureSelfPerson(db)` |
| `packages/api/src/routers/people.ts:47` | New `people.me` query |
| `packages/api/src/routers/tasks.ts:107` | `create` defaults `assigneeId` to the owner when the key is omitted |
| `packages/api/src/services/notion-tasks-sync.ts:78,540` | Delegates owner resolution to the shared service |
| `apps/web/src/components/ui/PersonSelect.tsx` | New id-based combobox |
| `apps/web/src/components/Modals/TaskModal.tsx` | Assignee `<select>` → `PersonSelect`, owner pre-fill |
| `apps/mobile/lib/data.ts` | `assigneeId` on `TaskInput`; `fetchSelfPerson`, `fetchNotionConfigured`, `syncTasksFromNotion` |
| `apps/mobile/app/task/[id].tsx` | Assignee row + searchable picker sheet |
| `apps/mobile/app/(tabs)/tasks.tsx` | "סנכרן מ-Notion" button with pending/result states |
| `packages/api/src/routers/tasks.test.ts`, `people.me.test.ts`, `apps/web/e2e/task-assignee.spec.ts` | New tests |

## Spec conformance

Every acceptance criterion in the spec is implemented and covered by a test or a documented manual step. No schema change was needed, as planned.

## Findings

### Correctness

- The `undefined` vs `null` distinction is the load-bearing detail and it is handled explicitly at `packages/api/src/routers/tasks.ts:107`, not via `??`, so "ללא אחראי" survives. Verified by two separate tests.
- `ensureSelfPerson` matches on `lower(name)`, which works on both SQLite and Postgres, so the resolution behaves the same in dev and production.
- Notion sync keeps its `dryRun` semantics: `notion-tasks-sync.ts:545` only calls the shared service when it is actually allowed to write, and synthesises an id otherwise.
- One behavioural change worth noting: the owner row that Notion sync auto-creates is now written with `source: 'manual'` instead of `'notion'`. That is the more accurate label now that the row can be created by an ordinary task create, and no code branches on that value for this row.

### Web UI

- `TaskModal.tsx:105` merges the owner into the option list when `people.list` was fetched before the row existed. Without it, a fresh database would show "ללא אחראי" for a task that is in fact assigned — this was caught during e2e and fixed.
- Pre-fill runs once per open (`assigneePrefilled` ref, `TaskModal.tsx:96`), so a query refetch cannot silently undo a deliberate clear.
- Accessibility: `role="combobox"` with `aria-expanded` / `aria-controls` / `aria-activedescendant`, a `role="listbox"` popup with `role="option"` children, and `aria-labelledby` pointing at the visible label (a plain `htmlFor` cannot name a div). Options are ≥44px, keyboard navigation covers arrows, Enter, and Escape, and Escape is handled on both the trigger and the input so it works regardless of where focus landed.

### Mobile

- `apps/mobile/app/task/[id].tsx:152` omits `assigneeId` entirely when the owner lookup failed, so a network hiccup degrades to the server default rather than silently creating an unassigned task.
- The picker sheet reuses the people-tab filter predicate and the app's dark RTL styling; rows are ≥48px and the list keeps taps alive while the keyboard is open.
- The sync button is hidden unless `tasks.notionConfigured` is true, disables itself while running, and reports outcomes with the same Hebrew strings the web page uses. Pull-to-refresh deliberately stays a local reload.

## Nits (not blocking)

- `apps/web/src/components/Modals/TaskModal.tsx:203` — the כותרת field still has a `<label>` with no `htmlFor`, so `getByLabel('כותרת')` does not resolve and the e2e spec targets the placeholder instead. Pre-existing; worth fixing when that modal is next touched.
- `pnpm --filter @ak-system/web lint` still drops into `next lint`'s interactive setup because the app has no ESLint config. Type safety was verified through the production build instead.

## Checks

| Check | Result |
|---|---|
| `pnpm test` | 473 passed |
| `pnpm --filter @ak-system/web build` | passed |
| `apps/web/e2e/task-assignee.spec.ts` | 3/3 passed |
| `apps/mobile` + `apps/whatsapp-bridge` `tsc --noEmit` | passed |
| `pnpm e2e` | 9 pre-existing failures, unrelated (see QA report) |
