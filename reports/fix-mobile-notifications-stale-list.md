# Review — fix-mobile-notifications-stale-list

> **Slug:** `fix-mobile-notifications-stale-list`
> **Date:** 2026-09-30
> **Verdict:** APPROVED WITH NITS

## Spec conformance

Matches `docs/specs/fix-mobile-notifications-stale-list.md`:

- List refetches on every screen focus via `useFocusEffect` (mirrors the existing, already-proven pattern in `app/(tabs)/tasks.tsx` — same `hasLoadedOnce` ref / `mode: 'initial' | 'refresh'` shape), instead of only on first mount.
- Pull-to-refresh added (`RefreshControl` on the `FlatList`, wired to `refreshing` state + `load('refresh')`).
- Background 30s badge poll (`lib/unread.tsx`) untouched — list no longer auto-refetches off that timer, only off focus/pull/explicit actions, per acceptance criteria.
- `load()` now also calls `refreshUnread()` on every focus/pull so badge and list can't disagree even if one request races the other.
- Failure path preserved: on error the existing list is left in place (`setItems` only runs on success) and the inline `setError` message shows.
- Deep-link-by-id, optimistic archive/mark-read/undo, mark-all/archive-all flows: untouched, still function on the same state.

## Diff review

| Area | Assessment |
|------|------------|
| `apps/mobile/app/(tabs)/notifications.tsx` imports | Added `useFocusEffect` (expo-router) and `RefreshControl` (react-native) |
| `load()` | Now takes `mode`, toggles `refreshing` vs `loading` correctly; added `hasLoadedOnce` guard so only the true first load shows the full-screen spinner |
| Removed plain mount `useEffect(() => load(), [load])` | Replaced by `useFocusEffect`, which also fires on initial mount — no double-fetch |
| `FlatList` (non-empty branch) | `refreshControl` added, styled consistent with `colors.gold` used elsewhere in this file |
| Empty-state branch | Left as-is (outside the `FlatList`, no pull-to-refresh there) — intentionally out of scope per spec, to keep the diff minimal; noted as a nit below |

## Findings

None blocking.

## Nits

- Pull-to-refresh only works once at least one notification is showing (the empty state is a separate branch, not `ListEmptyComponent`). Spec explicitly scoped this out; flagging in case product wants it later — `tasks.tsx` already shows the `ListEmptyComponent` pattern to copy if so.
- `onArchive`'s error-recovery path and `onUndo`/`onBulkUndo` still call bare `load()` (defaults to `mode: 'initial'`), so they still show the full-screen spinner rather than a lighter refresh — this matches the pre-existing behavior exactly (no regression), just noting it wasn't upgraded to `'refresh'` mode.
- `pnpm -r run lint` / `pnpm test` / `pnpm e2e` could not be run from repo root in this sandbox (`pnpm` binary unavailable; project relies on pnpm-specific symlinked `node_modules` per package). Verified instead by running the mobile package's own lint script directly: `apps/mobile/node_modules/.bin/tsc --noEmit` → clean, exit 0. No backend/web files touched, so `packages/api` Vitest and `apps/web` Playwright suites are not expected to be affected — recommend a `pnpm test && pnpm e2e` pass locally before/along with the next deploy as final confirmation.

## Verdict

**APPROVED WITH NITS** — minimal, pattern-matching fix for the badge/list desync; mobile typecheck clean; full monorepo test/e2e run recommended locally to close out QA.
