# QA report — whatsapp-daily-digest

**Detected stack:** next-trpc-monorepo
**Verdict:** FAIL

- Static check: PASS (lint exit 0, ~5s; web build exit 0, ~79s)
- Unit tests: 1019/1019 passed (API 808, web 211)
- E2E: 76 passed, 21 failed, 2 skipped (99 total, ~9.0m)
- Server boot: n/a
- HTTP smoke / API: n/a
- **UI route smoke**: n/a
- **Production config drift**: n/a — no new required env var
- **Build freshness**: n/a — `apps/web/.next/BUILD_ID` was not on disk after the e2e server; deploy builds in Docker. The web build listing includes `ƒ /api/cron/whatsapp-daily-digest`.
- Total time: ~12m

## Per-phase results

### 1. Static

`pnpm -r run lint` exit 0. Pre-existing `next lint` warnings in finance, meetings, and settings pages. None in the new digest files.

`pnpm --filter @ak-system/web build` exit 0. `Compiled successfully`. Route table includes `/api/cron/whatsapp-daily-digest`.

### 2. Unit/integration tests

`pnpm test` exit 0.

- API: 70 files, 808 tests passed. Includes `whatsapp-daily-digest.test.ts` (6) and `whatsapp.test.ts` digest.run cases (unauthenticated, no followed groups, quiet day excludes a disabled group).
- Web: 27 files, 211 tests passed.

### 3–5. E2E

`pnpm e2e` exit 1. 76 passed, 21 failed, 2 skipped.

Digest coverage that passed:

- `e2e/whatsapp-insights.spec.ts` — groups tab shows **סכם עכשיו את כל הקבוצות במעקב**, plus the existing insights tests
- `e2e/notification-preferences.spec.ts` — catalog includes **סיכום קבוצות יומי**
- `e2e/whatsapp-labels-cluster.spec.ts` — label cluster toggle still present

## Failures (if any)

None of the 21 failures are in the WhatsApp digest specs. They are outside this change:

- `e2e/bank-accounts.spec.ts:14` — `getByText('חיובי אשראי')` strict-mode violation (two matches)
- `e2e/dashboard-task-open-sort.spec.ts:38` — sort control in «משימות פתוחות» not found
- `e2e/full-flow.spec.ts`, `e2e/qa-structured.spec.ts`, `e2e/meeting-conversation-analysis.spec.ts`, `e2e/meeting-relationships.spec.ts`, `e2e/multi-level-sort.spec.ts`, `e2e/notion-note-meetings.spec.ts`, `e2e/trading-journal.spec.ts`, `e2e/ui-refresh.spec.ts` — timeouts or missing controls on meetings, tasks, and dashboard flows

## Notes

The digest specs and unit tests are green. The suite verdict stays FAIL because `pnpm e2e` did not exit 0. Those failures were not introduced by the digest files.
