# QA report — meeting-analysis-attendees

**Detected stack:** next-trpc-monorepo
**Verdict:** FAIL

- Static check: PASS (lint ~12s, exit 0, warnings only; web build ~41s, exit 0)
- Unit tests: 1051/1051 passed (API 826/826, web 225/225)
- E2E: 75 passed, 22 failed, 2 skipped (99 total, ~10.4m)
- Server boot: n/a
- HTTP smoke / API: n/a
- **UI route smoke**: n/a
- **Production config drift**: n/a — no new required env var
- **Build freshness**: PASS — `find apps/web/src packages/*/src -type f -newer apps/web/.next/BUILD_ID` printed nothing
- Total time: ~13m

## Per-phase results
### 1. Static
`pnpm -r run lint` exit 0. Warnings only, none in the meeting-attendee files. Pre-existing examples: unescaped quotes in finance pages, `react-hooks/exhaustive-deps` on `apps/web/src/app/meetings/page.tsx`.

`pnpm --filter @ak-system/web build` exit 0. Compiled successfully. Dynamic-server notices for `/api/chat/history` and `/api/agents/history` during static generation; build still finished.

### 2. Unit/integration tests
`pnpm test` exit 0.

```
Test Files  71 passed (71)
Tests  826 passed (826)   # @ak-system/api, includes meetings.analysis.test.ts (19)
Test Files  30 passed (30)
Tests  225 passed (225)   # @ak-system/web
```

No UI test covers linking a suggested name to an existing person, or that add/remove appears only once.

### 3. E2E
`pnpm e2e` exit 1. 22 failed, 75 passed, 2 skipped.

Meeting analysis specs fail on stale copy, not on the new buttons:

```
e2e/meeting-conversation-analysis.spec.ts:59
Locator: getByText('ניתוח שיחה עמוק')
Error: element(s) not found
```

The screen heading is `ניתוח שיחה`. The same stale locator fails the rest of that file and `e2e/notion-note-meetings.spec.ts` analysis case. No spec looks for `קשר לאיש קשר קיים`, `קשר לקיים`, or `+ הוסף אדם`.

Other failures are outside this change (timeouts / missing controls): `e2e/bank-accounts.spec.ts`, `e2e/full-flow.spec.ts`, `e2e/qa-structured.spec.ts`, `e2e/ui-refresh.spec.ts` (`כל הפגישות` not found), `e2e/trading-journal.spec.ts`, `e2e/task-workspaces.spec.ts`, `e2e/dashboard-task-open-sort.spec.ts`, `e2e/multi-level-sort.spec.ts`, `e2e/meeting-relationships.spec.ts`.

## Failures (if any)

**Product, not caught by automation**

1. Add/remove is mounted twice on the meeting page.
   - `apps/web/src/app/meetings/[id]/page.tsx:342` renders `MeetingAttendees`, which includes `+ הוסף אדם` and `הסר` (`MeetingAttendees.tsx:183`).
   - `ConversationAnalysis.tsx:533` renders a second `AddPersonControl`, and each suggestion row has its own add/remove (`ConversationAnalysis.tsx:389-444`).

2. The previous per-person link to אנשים is gone for the common case.
   - Old control was always available on a suggestion: `קשר לאיש קשר קיים` (search existing people, then `linkAnalysisParticipant`).
   - Now `קשר לקיים` / `קשר לאחר` renders only when the person is not already on the meeting and there is at most one name match (`ConversationAnalysis.tsx:433`).
   - If the name is already on the meeting (including a Notion link), the row shows only `בפגישה` and `הסר` (`ConversationAnalysis.tsx:389`). There is no control to point that name at a different person in אנשים.
   - Zero name matches offers `צור והוסף` first, which creates a new person instead of opening the existing-contact search.

## Notes
This QA run happened after commit `681070a` and after deploy. The commit was gated by unit tests and `SKIP_E2E=1 pnpm deploy:ec2`. The QA agent gate was not run before that commit.

This pass did not change source. Playwright's web server exited with the suite. No server was left on port 8089.
