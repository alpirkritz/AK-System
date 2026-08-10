# Code Review: Archive All Notifications

> **Slug:** `notification-archive-all`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-08-06

## Spec Conformance

- [x] Web `/notifications` shows "העבר הכל לארכיון" next to "סמן הכל כנקרא" whenever the list is non-empty (`apps/web/src/app/notifications/page.tsx`).
- [x] Click archives every non-archived row with one shared batch timestamp, optimistically empties the list via query invalidation, shows undo toast `"{N} הודעות הועברו לארכיון · בטל"` for 4s.
- [x] Undo restores exactly the batch (matched by shared `archivedAt` timestamp).
- [x] No confirmation dialog — optimistic + undo, consistent with existing single-archive UX.
- [x] Already-archived rows are untouched by archive-all (verified in Vitest).
- [x] `unreadCount` drops to 0 after archive-all (reuses existing `isNull(archivedAt)` filter).
- [x] Helm parity added: `apps/mobile/app/notifications.tsx` button + undo toast, `apps/mobile/lib/api.ts` `archiveAllNotifications` helper, REST `action: 'archiveAll' | 'archiveAllUndo'` in `apps/web/src/app/api/notifications/route.ts`.
- [x] Vitest: batch archive w/ shared timestamp, no-op on empty inbox, undo restores exact batch — 3 new tests, all passing.
- [x] Playwright: seed 2 notifications → archive-all → empty + toast → undo → both reappear — passing.
- [x] Hebrew-only microcopy; reuses existing error string, no raw error codes.

All acceptance criteria met, none deferred.

## Static Checks

| Check | Result |
|---|---|
| `pnpm test` (Vitest, repo root) | PASS — 42 files / 468 tests, incl. 3 new `archiveAll` cases in `notifications.test.ts` (11/11 in that file) |
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm -r run lint` | apps/mobile `tsc --noEmit` PASS, apps/whatsapp-bridge `tsc --noEmit` PASS, apps/web `next lint` FAILS on an interactive ESLint-config prompt — **pre-existing**, unrelated to this change (already flagged in `reports/notification-detail-swipe.md`) |
| `apps/web/e2e/notifications.spec.ts` (Playwright) | PASS — 8/8, incl. new `archive-all button clears the inbox and undo restores it` |

## Findings

### Must-fix
- None.

### Should-fix
- None.

### Nits
1. `archiveAll`/`archiveAllUndo` walk rows one-by-one via `runMutation` in a loop (same pattern as the existing `markRead({ all: true })`) rather than a single batched `UPDATE ... WHERE` — consistent with existing code style in this router, but will not scale past a few hundred notifications. Not a regression; pre-existing pattern.
2. Mobile screen's bulk-undo and single-item-undo toasts can't both render at once (both anchored `position: absolute; bottom: 24`) — in practice they're mutually exclusive in the current flows (archiving all clears `items`, so a subsequent single-item archive can't fire until reload), so this is a theoretical overlap only.

## Out of Scope Creep

None — implementation stayed within the spec (`docs/specs/notification-archive-all.md`): no new schema column, no confirmation dialog, no filters, no archived-items browser.

## Suggested PR Description

**Add "Archive all" to the notifications inbox**

Adds a bulk "העבר הכל לארכיון" action to the notifications inbox (web + Helm), reusing the existing per-item archive/undo UX. A new `notifications.archiveAll` tRPC procedure (and matching Helm REST actions) archives every non-archived notification under one shared batch timestamp, which doubles as the undo key — no schema change needed. Includes Vitest coverage for the batch behavior, idempotency, and undo, plus a Playwright e2e case.

- `packages/api/src/routers/notifications.ts` — new `archiveAll` procedure
- `apps/web/src/app/api/notifications/route.ts` — new `archiveAll` / `archiveAllUndo` REST actions
- `apps/web/src/app/notifications/page.tsx` — "העבר הכל לארכיון" button + bulk undo toast
- `apps/mobile/lib/api.ts`, `apps/mobile/app/notifications.tsx` — Helm parity
- `packages/api/src/routers/notifications.test.ts`, `apps/web/e2e/notifications.spec.ts` — new tests
- `docs/specs/notification-archive-all.md` — spec
