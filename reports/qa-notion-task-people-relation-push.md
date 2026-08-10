# QA — `notion-task-people-relation-push`

**Spec:** [`docs/specs/notion-task-people-relation-push.md`](../docs/specs/notion-task-people-relation-push.md)
**Stack:** `next-trpc-monorepo`
**Verdict:** PASS

## Automated

| Suite | Command | Result |
|---|---|---|
| API units | `pnpm --filter @ak-system/api test` | 522 passed / 44 files |
| Web units | `pnpm test` | 138 passed / 18 files |
| Web e2e (new spec) | `playwright test e2e/task-related-people.spec.ts` | 2 passed |
| Web e2e (full) | `pnpm e2e` | 57 passed, 9 failed — all pre-existing, see below |
| Web build | `pnpm --filter @ak-system/web build` | success |

`notion-task-writeback.test.ts` went from 39 to 52 cases. The 13 new ones cover matching (case- and whitespace-insensitive), partial matches, clearing, the no-match guard, absent people relation, self-referencing relations, configured-database precedence, dashed vs undashed ids, unresolvable account, rejected PATCH, directory caching, and pagination — plus four `setTaskPeople` router cases (push, clear, manual task untouched, local rows survive a Notion failure).

One test I wrote initially asserted that an unknown account label yields `reason: 'account'`. It does not: `resolveTaskDatabaseTarget` deliberately falls back to the first configured tasks database, and `account` is reserved for "nothing configured at all" — the same contract `pushTaskStatus` has. The test was corrected to match the real behaviour rather than the behaviour changed.

`notion-people-sync-message.test.ts` adds 9 cases for the notice copy: silence on full success and on `no-people-relation`, naming one or several skipped people, bidi isolation of Latin names, the generic API/account failure, a no-match failure carrying no names, and empty strings being ignored.

## Pre-existing e2e failures

The 9 failures in the full run are all unrelated to this change, and none involve tasks, related people, or the notice:

| Spec | Cause |
|---|---|
| `full-flow` (×2), `qa-structured` (×4) | Assert a dashboard heading matching `/שלום/`. The greeting is `בוקר טוב` / `צהריים טובים` / `ערב טוב` / `לילה טוב` (`app/page.tsx:16`), so this can never match at any hour. `full-flow` also expects a `פגישות חוזרות` heading on `/recurring`, which is now a redirect stub. |
| `bank-accounts`, `trading-journal` | Strict-mode violations — `חיובי אשראי` and `P&L ממומש` each resolve to 2 elements after the finance UI changes already sitting uncommitted in the tree. |
| `task-workspaces` | Passes in isolation; order-dependent flake. |

Confirmed by reading the captured DOM: the dashboard rendered `בוקר טוב 👋` correctly, so the page works and the assertion is stale.

## Relation selection against live databases

Dry run over all four configured task databases, checking which property the new logic picks:

| Database | Relation properties present | Selected |
|---|---|---|
| Personal To-do | (none) | none |
| DT - Action items | Meeting, Sub-task, 📇 People directory, Parent task, Projects | `📇 People directory` |
| Con Action items | Meetings, People, Blocked by, Companies, Blocking, Sub-task, Parent task | `People` |
| DAZ Tasks | Related meeting, Sub-tasks, Parent-task, Is Blocking, Blocked By, Project | none |

No false positive on `Projects`, `Companies`, `Meetings`, `Blocked by`, `Blocking`, or the task self-links.

## End-to-end in production

Created a real task in `Alpir Consulting` → `Con Action items`, attached `Guy Gamzu`, read the page back:

- `setTaskPeople` returned `{ ok: true, propertyName: 'People', matched: ['Guy Gamzu'], unmatched: [] }`.
- The page's `People` relation held one id, and fetching that page confirmed its title is **Guy Gamzu** — the link is the right human, not just a well-formed id.
- All six other relation properties remained empty.
- Clearing the people emptied the relation.
- Cleanup: Notion page archived, local task deleted.

A second production run covered the notice's data and the guard, on the deployed build:

- Partial match — `Guy Gamzu` (in the directory) plus `בר ז'אק` (a Hebrew calendar contact that is not): `{ ok: true, matched: ['Guy Gamzu'], unmatched: ["בר ז'אק"] }`, so the banner can name who was skipped.
- Total miss — only `בר ז'אק`: `{ ok: false, reason: 'no-matching-people', unmatched: ["בר ז'אק"] }`, **and the previously linked `Guy Gamzu` page was still in the relation afterwards**. The no-clobber guard holds against live data, not just mocks.

## Known limitations (not defects)

- **`DAZ Tasks` has no people relation in Notion at all**, so related people cannot be pushed there and the result reports `no-people-relation`. Adding one is a change to the Notion database schema, which is the user's call.
- Name-match coverage against the current people table is thin — 14/144 for the Con directory, 1/144 for DT. The gap is data, not logic: most local people rows are calendar-derived (Hebrew names, addresses, even meeting rooms such as `חדר ישיבות קומה 4`) while the directories hold English-named business contacts. People the user actually attaches to a Con/DT task are the ones likely to exist in those directories.
- The notice is wired on the three surfaces that host `TaskModal` (tasks, meeting detail, project detail). The dashboard quick-add uses `QuickAddTaskModal`, which has no related-people field, so there is nothing to report there.

## Not run

`pnpm -r run lint` still fails on the pre-existing missing ESLint config in `apps/web` (unrelated to this change; `next lint` drops into an interactive prompt). The banner copy itself has no e2e coverage because e2e has no Notion configured — the new spec instead pins the case that must stay silent, and the copy is unit-tested.
