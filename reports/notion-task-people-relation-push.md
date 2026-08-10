# Review — `notion-task-people-relation-push`

**Spec:** [`docs/specs/notion-task-people-relation-push.md`](../docs/specs/notion-task-people-relation-push.md)
**QA:** [`reports/qa-notion-task-people-relation-push.md`](qa-notion-task-people-relation-push.md)
**Verdict:** APPROVED

## Scope reviewed

| File | Change |
|---|---|
| `packages/api/src/services/notion-task-writeback.ts` | `peopleRelation` on the cached schema, `findPeopleRelation`, `fetchPeopleDirectoryIndex` + cache, `pushTaskPeople`, two new failure reasons |
| `packages/api/src/services/notion-tasks-sync.ts` | exports `listConfiguredPeopleDatabaseIds` |
| `packages/api/src/routers/tasks.ts` | `setTaskPeople` pushes the relation and returns `notionSync` |
| `packages/api/src/services/notion-task-writeback.test.ts` | +13 unit cases, +4 router cases |
| `apps/web/src/lib/notion-people-sync-message.ts` (+ test) | pure Hebrew copy mapper, 9 cases |
| `apps/web/src/components/SyncToast.tsx` | self-dismissing notice for surfaces with no banner |
| `apps/web/src/components/Modals/TaskModal.tsx` | `onPeopleSync` callback; accessible grouping for the people list |
| `apps/web/src/app/tasks/page.tsx` | feeds the existing sync banner |
| `apps/web/src/app/meetings/[id]/page.tsx`, `apps/web/src/app/projects/[id]/page.tsx` | render `SyncToast` |
| `apps/web/src/app/globals.css` | `.toast` gains a `max-width` and centred text |
| `apps/web/e2e/task-related-people.spec.ts` | 2 Playwright cases |

No schema migration, matching the spec — nothing new is persisted locally.

## Spec conformance

Every acceptance criterion is covered by a test and, for the main path, by the production run. Placing the push in `setTaskPeople` rather than `createNotionTask` is correct and verified: `TaskModal` chains `create` → `setTaskPeople`, so related people are not knowable at create time, and this placement additionally covers later edits.

## Correctness notes

- **Data safety is layered, which is the strongest part of the change.** Only ids obtained by matching a person's name against titles *inside the relation's own target database* are ever written (`notion-task-writeback.ts:pushTaskPeople`). Even if `findPeopleRelation` ever selected a wrong property, no person's name would match a title there and the write would resolve to nothing. Confirmed empirically: `Projects`, `Companies`, `Meetings`, `Blocking`/`Blocked by` and the task self-links were all left untouched on a live page.
- **The empty-vs-unresolvable distinction is right.** An empty `personNames` clears the relation (real intent), while "names given, none resolved" skips the PATCH so a lookup miss cannot wipe links a human set in Notion. Both branches are tested.
- **Self-referencing relations are excluded before the name test**, so a hypothetical `Blocked by people` on the task database itself cannot be selected (tested).
- **`sameId` normalises dashes** because Notion returns ids both ways depending on endpoint; without it, matching a configured people database would silently fall through to the name heuristic (tested both ways).
- **Never-throws contract preserved.** `pushTaskPeople` mirrors `pushTaskStatus`: every failure is a return value, and a Notion outage still leaves the local `task_people` rows committed (tested).
- **Pagination is handled** — the Con directory has 153 pages, so the single-page read this originally could have been would have silently missed a third of the directory. Caught before deploy by querying live and tested.

## UI/UX Review

**Verdict:** APPROVED

- **Silence is used deliberately, not by omission.** Nothing is shown on full success, and nothing on `no-people-relation` — the latter matters because `DAZ Tasks` has no people relation by design, so reporting it would nag on every DAZ save with something the user has already decided not to fix.
- **The copy names the specific people who were skipped**, which is what makes it actionable ("add בר ז'אק to the directory") rather than a vague failure.
- **Bidi handled.** Latin names inside Hebrew copy are wrapped in FSI/PDI isolates, so trailing punctuation and comma placement stay correct in the RTL banner. Covered by a test asserting the isolate characters.
- **Design system respected.** No new visual language: the tasks page reuses its existing banner, the other two surfaces reuse the global `.toast` class, which already handles the dark palette, mobile safe-area offset and `prefers-reduced-motion`.
- **Two real defects found and fixed during review**, both in code I had just written:
  - `SyncToast` had `onDismiss` in its effect deps while every caller passes an inline arrow, so any unrelated re-render restarted the countdown and the toast could have stayed up indefinitely. Now held in a ref.
  - `.toast` had no `max-width`. Fine for the existing "נוספה משימה", but a notice naming two or three people would have run off the viewport. Bounded to `min(440px, 100vw - 32px)` with centred text.
- **Accessibility improved beyond the ask.** The related-people checkbox list had no accessible grouping; it is now a `role="group"` labelled by the existing "קשור לאנשים" label, mirroring the assignee field's `aria-labelledby` pattern. This also gave the e2e spec a stable selector instead of a brittle text filter.
- **Toast duration** is 6s rather than the 2.5s used for "נוספה משימה", because this copy is longer and carries names to read.

## Findings

No blocking findings. Two things worth knowing, both recorded in QA:

1. `DAZ Tasks` exposes no relation to `DAZ People`, so related people on DAZ tasks report `no-people-relation`. The user chose to leave this as is; the notice is deliberately suppressed for that case.
2. Name-match coverage against the current people table is thin (14/144 for Con, 1/144 for DT) because most local rows are calendar-derived. This is data, not logic — and it is now visible to the user rather than silent, which is the mitigation.

## Gates

- `pnpm --filter @ak-system/api test` — 522 passed
- `pnpm test` — 138 passed
- `pnpm e2e` — 57 passed, 2 new passed; 9 failures all pre-existing and itemised in the QA report
- `pnpm --filter @ak-system/web build` — success
- `pnpm -r run lint` — still blocked by the pre-existing missing ESLint config in `apps/web`, unrelated to this change and unchanged by it

## Deploy note

`pnpm deploy:ec2` completed its build, sync and container recreation, then hung for 34 minutes on its final step — the WhatsApp bridge rule re-sync, a `curl` with no `--max-time` fired 10s after the container restarts. Re-running it by hand returned `{"ok":true,"enabled":51}` immediately, so it was a readiness race rather than a fault. Worth adding a timeout to that step in `scripts/deploy-ec2.sh`, in a separate change.
