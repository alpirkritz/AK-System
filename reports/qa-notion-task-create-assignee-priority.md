# QA report — notion-task-create-assignee-priority

**Detected stack:** `next-trpc-monorepo`
**Verdict:** PASS (one pre-existing, unrelated blocker noted)

- Static check: **FAIL — pre-existing**, `apps/web` has no ESLint config so `next lint` drops into an interactive prompt. Reproduces on a clean tree; unrelated to this change. `tsc --noEmit` for `apps/mobile` and `apps/whatsapp-bridge` both pass.
- Unit tests: **505/505 passed** (`packages/api`, 44 files) and **129/129 passed** (`apps/web`, 17 files). 13 of those are new.
- Build: **PASS** — `pnpm --filter @ak-system/web build`, and again inside `deploy-ec2.sh` with `AK_DEPLOY_BUILD=1`.
- Build freshness: **PASS after correcting a false alarm** — see Notes.
- Production deploy: **PASS** — containers recreated, compiled bundle verified to contain the change.
- Live end-to-end against production: **PASS** — page created with assignee, priority and the chosen status.
- Data-loss regression check: **PASS** — pull-sync prune count went from 1 to 0.

## Root cause

Tasks *were* reaching Notion; the page just came out unusable:

- **No assignee.** Notion task views are filtered by `Assignee`, so the page was invisible everywhere the user looks. This is why it read as "the app still doesn't create tasks in Notion".
- **No priority, and always "not started"** regardless of the status picked at creation.
- **Worse: the task was scheduled for deletion.** `syncNotionTasks` keeps a page only if it resolves to a known person, then prunes any in-window page it fetched but did not keep. A production dry-run returned `tasksPruned: 1`, pointing at the user's task "ניסיון". Create a task, and the next Notion sync would delete it locally.

Evidence, page `3b7e7d50-cb8e-8185-aa1c-d3826d64e942` in `DT - Action items` before the fix:

```
Assignee = (EMPTY)
Priority = (EMPTY)
Status   = Not started      # user had chosen "in progress"
Due Date = 2026-08-09
```

## Per-phase results

### 1. Static

```
apps/mobile lint$ tsc --noEmit          → Done
apps/whatsapp-bridge lint$ tsc --noEmit → Done
apps/web lint$ next lint                → Failed (interactive ESLint setup prompt)
```

`ls -a apps/web | rg eslint` returns nothing — no config has ever existed here, so this gate cannot pass on any tree. Not introduced by this change.

### 2. Unit/integration tests

```
packages/api   Test Files  44 passed (44)   Tests  505 passed (505)
apps/web       Test Files  17 passed (17)   Tests  129 passed (129)
```

New coverage in `notion-task-writeback.test.ts` (13 cases): assignee matched by email, assignee matched by name, bots never assigned, unresolvable assignee still creates the page, no assignee means the users endpoint is not even called, priority written, exact priority label preferred over `Critical`, chosen status pushed, four `pickPriorityLabel` cases, and a router-level case proving `tasks.create` forwards assignee, priority and status.

### 3. Live end-to-end (production)

Created through the real tRPC procedure, inspected in Notion, then removed from both sides:

```
notionSync : {"ok":true,"pageId":"3b7e7d50-cb8e-817e-a6a2-e5fa379e893c",
              "accountLabel":"Personal","name":"DT - Action items","label":"In progress"}
source     : notion

--- Notion page as created ---
  Assignee : Alpir Kritzler
  Priority : High
  Status   : In progress
  Due Date : 2026-08-15

RESULT: PASS — page created and assigned
cleanup    : Notion page archived, local task deleted
```

Verified the test page is `archived: true, in_trash: true` and no longer returned by the sync query, so it will not reappear locally.

### 4. Deploy verification

Grepped the **compiled** server bundle rather than the source, since synced source proves nothing about the shipped build:

```
grep -rl "v1/users" /app/apps/web/.next/server
  → chunks/8653.js, chunks/2211.js
```

`v1/users` appears in exactly one source file (`notion-task-writeback.ts`) and is absent from the previous git HEAD, so its presence in the bundle is proof the new code shipped.

### 5. Data-loss regression

`tasks.syncFromNotion` with `dryRun: true`, before and after:

```
before → tasksCreated 0, tasksUpdated 94, tasksSkipped 69, tasksPruned 1
after  → tasksCreated 1, tasksUpdated 94, tasksSkipped 68, tasksPruned 0
```

The pre-existing "ניסיון" page was created before the fix and so was still unassigned and still slated for pruning. It was assigned to the owner in Notion, which is what moves it from the skipped bucket into the kept bucket and drops `tasksPruned` to 0.

## Notes

- **Build-freshness false alarm, worth remembering.** `find apps/web/src packages/*/src -newer apps/web/.next/BUILD_ID` listed three edited files, which looks exactly like a stale build about to ship old code. It isn't: `next.config.js` sets `distDir` to `/tmp/ak-system-next` for ordinary local builds and only writes to `.next` when `AK_DEPLOY_BUILD=1`, which `deploy-ec2.sh` sets. So `.next` is untouched by a plain `pnpm build` on the Mac, and `BUILD_ID` is a misleading freshness marker here. The compiled-bundle grep in phase 4 is the check that actually settles it.
- **Deploy needed `SKIP_CI=1`** to get past the pre-existing lint gate. The production build still ran; only the lint step was bypassed. Adding an ESLint config to `apps/web` would unblock `pnpm deploy:ec2` and `pnpm run ci:local` properly — worth a separate task.
- **`NOTION_USER_NAME` is empty in production**, so `getSelfPersonName()` falls back to the hardcoded `'Alpir Kritzler'`. It happens to match the Notion user's display name, which is the only reason name-based assignee resolution works for the owner. Renaming the Notion account would silently break it; setting `NOTION_USER_NAME` explicitly, or giving the owner's `people` row an email, would make it robust.
- **Not covered:** assignees who are not Notion workspace users (unresolvable by design — the page is created unassigned, which means the pull-sync will prune it). Relation-type people properties are also untouched, per the spec's out-of-scope list.
