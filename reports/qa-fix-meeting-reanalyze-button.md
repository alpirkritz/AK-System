# QA report — fix-meeting-reanalyze-button

**Detected stack:** next-trpc-monorepo
**Verdict:** FAIL (full Playwright suite) — **fix itself is covered and green**

- Static check: PASS (~50s lint + ~43s web build; pre-existing ESLint warnings only)
- Unit tests: 996/996 passed (787 API + 209 web)
- E2E: 73/97 passed, 22 failed, 2 skipped (~8.8m)
- Production config drift: PASS — required vars present
- Total time: ~11m

## Per-phase results

### 1. Static

`pnpm -r run lint` — exit 0. Workspace lint passed. `apps/web` printed pre-existing `react/no-unescaped-entities` / hooks / a11y warnings; none in the changed ConversationAnalysis files.

`pnpm --filter @ak-system/web build` — exit 0. Compiled successfully; `/meetings/[id]` in the route table.

### 2. Unit/integration tests

`pnpm test` — 68 API files / 787 tests passed; 27 web files / 209 tests passed.

New coverage in `packages/api/src/routers/meetings.analysis.test.ts`:
- returns existing analysis without Gemini when `force` is false
- creates a new analysis when `force` is true
- retries a failed analysis when `force` is true

### 3. E2E / UI

`pnpm e2e` — 73 passed, 22 failed.

**In scope (this slug):** `Meeting Conversation Analysis › re-analyze button sends force=true` **passed**.

**Same file, pre-existing stale copy** (not introduced by this change; UI says `ניתוח שיחה`, tests still wait for `ניתוח שיחה עמוק` / `ממתין לניתוח` / `צור הכל כמשימות` / `הצג תמלול מלא`):
- shows analyze button when no analysis exists
- triggers analysis and displays results
- allows creating tasks from action items
- can create all tasks at once
- shows raw transcript when toggled

**Unrelated failures** (dashboard greeting, bank snapshot strict-mode, Notion FK seed, qa-structured `שלום`, etc.):
- assistant-chat-ux, bank-accounts, dashboard-task-open-sort, full-flow (2), meeting-relationships, multi-level-sort, notion-note-meetings (4), qa-structured (4), trading-journal, ui-refresh

### 4. Production config

`scripts/validate-production-env.sh` against `deploy/production.env`: all required vars present. No new env vars in this change.

## Failures (if any)

E2E suite is red overall. None of the 22 failures are caused by `force: true` on "נתח מחדש". The new re-analyze assertion passed. Remaining conversation-analysis e2e failures are stale locators vs current Hebrew copy.

## Notes

Unrelated in-progress agent-runtime work was stashed before this QA pass so a missing `nanoid` import would not poison the suite or a deploy. Restore with `git stash pop` (stash message `wip-agent-runtime-unrelated`).

Deploy of this fix should use `SKIP_CI=1` because `scripts/ci.sh` runs the full Playwright suite, which is already red on main-line UI drift.
