# QA Report — mobile-task-form-reading-list-feedback

**Detected stack:** next-trpc-monorepo
**Date:** 2026-08-02
**Verdict:** PASS (with pre-existing e2e failures documented below)

## Static checks

| Check | Command | Result |
|---|---|---|
| Mobile typecheck | `pnpm --filter @ak-system/mobile lint` (`tsc --noEmit`) | PASS |
| WhatsApp bridge typecheck | `pnpm -r run lint` | PASS |
| Web lint | `pnpm --filter @ak-system/web lint` (`next lint`) | BLOCKED — pre-existing |
| Web build | `pnpm --filter @ak-system/web build` | PASS |
| Drizzle schema push | `pnpm run pretest` | PASS |

`next lint` cannot run non-interactively in this repo: there is no committed ESLint config, so
`next lint` drops into its interactive "How would you like to configure ESLint?" setup prompt and
exits non-zero. This is a pre-existing repo gap (already flagged in the `notion-task-create-push`
review on 2026-07-30), unrelated to this change. Type safety for `apps/web` is covered by the
production build, which compiles and typechecks all touched files and now emits `/reading-list`
as a static route (2.31 kB).

## Unit / integration tests

| Suite | Result | Notes |
|---|---|---|
| `pnpm test` (packages/api, Vitest) | **239 passed / 26 files** | was 230; +9 new `readingList` router tests |
| `apps/web` Vitest | **78 passed / 11 files** | was 64; +8 `agent-feedback-log`, +6 `log_agent_feedback` dispatch |

New coverage added:

- `packages/api/src/routers/readingList.test.ts` — create (persist + defaults + trimming + null
  note), URL validation rejection (non-http scheme), empty-title rejection, list ordering
  (newest first), status filtering (`unread`/`read`/`all`), default input, `markRead` both
  directions including `readAt` clearing, and delete.
- `apps/web/src/lib/agent-feedback-log.test.ts` — appends without truncating existing log content,
  verbatim multi-line blockquote, agent card left byte-identical, channel attribution,
  repeat appends, path-traversal `agentId` rejection, empty-feedback rejection, `M_Memory/`
  auto-creation.
- `apps/web/src/lib/conversation-engine.agent-feedback.test.ts` — tool declaration exposes the
  registered agent ids as its enum with both params required; dispatch writes through to the log
  helper; channel pass-through; missing-arg guards return errors without writing; write failure
  surfaces as a tool error rather than throwing.

## End-to-end (Playwright)

New spec `apps/web/e2e/reading-list.spec.ts` — **6/6 passing**: page loads, sidebar nav link
present, malformed-URL validation, missing-title validation, full save → mark-read → delete
round trip with success confirmations, and unread/read filter behavior.

Full suite: **27 passed / 12 failed**. All 12 failures are pre-existing stale selectors from an
earlier UI refresh, in files this change does not touch:

| Failing assertion | Why it is pre-existing |
|---|---|
| `heading /צ.?אט/` on `/chat` (4 tests) | `/chat` renders `AssistantWorkspace`; no such heading exists in `HEAD` |
| `heading /שלום/` on `/` (2 tests) | string absent from `HEAD`'s `apps/web/src/app/page.tsx` |
| `heading 'פגישות חוזרות'` on `/recurring` | `/recurring` is now a redirect to `/meetings?filter=recurring`; the string exists only as body text, not a heading |
| `agents-triggers`, `qa-structured` (4), `trading-journal` | same class of stale selector/UI-refresh drift; none touch reading list, task form, or the nav item added here |

Verified non-destructively: the two nav-dependent failures (`ניווט לכל הדפים`,
`נראות: כל דפי הניווט טוענים`) fail *after* successfully navigating `/projects → /meetings →
/people → /tasks`, so the added `רשימת קריאה` nav entry does not break nav traversal.

## Manual verification still required (device-only)

The mobile date picker and keyboard avoidance cannot be exercised by this repo's test tooling
(no React Native test runner is configured). Both need a device pass on the next preview build:

1. Task form → "תאריך יעד" opens the native picker; picking a date shows the Hebrew long-form
   label; "נקה תאריך" clears it; saving persists `YYYY-MM-DD` in local time (no off-by-one
   across timezones).
2. With the keyboard open in the task `formSheet`, the due-date field, workspace chips, and save
   button remain reachable.

## Issues found and fixed during QA

1. `readingList.create` rejected URLs with surrounding whitespace — `z.string().url()` validated
   before the router's `.trim()`, so a pasted `" https://… "` failed. Fixed by trimming inside
   the zod schema (`packages/api/src/routers/readingList.ts`).
2. The web add-form's native `type="url"` validation bubble preempted the app's own Hebrew inline
   error, so `כתובת לא תקינה` never rendered. Fixed with `noValidate` on the form, keeping
   `type="url"` for the touch-keyboard hint (`apps/web/src/app/reading-list/page.tsx`).
