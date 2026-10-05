# Fix Stale Notifications List on Helm Mobile

> **Slug:** `fix-mobile-notifications-stale-list`
> **Status:** Implemented — see `reports/fix-mobile-notifications-stale-list.md`
> **Detected stack:** `expo-mobile` (`apps/mobile`)
> **Last Updated:** 2026-09-30

## Goal

The header bell badge on Helm (`useUnread`, polled every 30s + on `AppState` foreground) and the `/notifications` list screen (`app/(tabs)/notifications.tsx`) read from the same backend data but are fetched independently and out of sync: the list is loaded exactly once, in a `useEffect` on mount, with no re-fetch on screen focus and no pull-to-refresh. Because Expo Router tab screens stay mounted, revisiting the notifications tab does not remount it and does not refetch. Result observed in production: badge shows 8 unread while the list still shows the 2 items that were present at the last mount. Desired outcome: the list screen always reflects the same unread state as the badge, refreshing whenever it's viewed or pulled, without introducing duplicate/flickering fetches.

## User Stories

- As the owner, when I open the התראות (notifications) tab, I want the list to show every notification the badge is counting, so the numbers never contradict what I see.
- As the owner, I want to pull down on the list to manually refresh it, in case a push arrived while the screen was already open.
- As the owner, I don't want the list to visibly flicker or lose my scroll position on every routine 30s badge poll — only an explicit focus/pull should reload the list.

## Acceptance Criteria

- [ ] Given the notifications screen is already mounted (tab kept alive by Expo Router) and a new notification arrives, when the user navigates back to the התראות tab (screen regains focus), then the list re-fetches and shows the new item — badge count and list unread count match.
- [ ] Given the user is on the notifications list, when they pull down (`RefreshControl`), then the list re-fetches immediately and the refresh spinner clears on completion or error.
- [ ] Given the screen is in the background (not focused) and the 30s `useUnread` poll fires, when the badge count changes, then the list screen does **not** auto-refetch or flicker — only focus/pull-to-refresh/explicit actions (archive, mark read) trigger a list reload.
- [ ] Given a fetch failure on focus-refresh or pull-to-refresh, when the request errors, then the existing list stays visible (no wipe) and the existing inline error message pattern (`setError`) is shown.
- [ ] Existing behaviors are preserved: deep-link-by-id opening, optimistic archive/mark-read/undo, mark-all/archive-all flows.
- [ ] Vitest/component test (or a targeted unit test around the new focus-refresh hook logic if the screen is hard to test directly) covers: focus triggers reload; background poll does not.

## Data Model

No schema changes. Reuses existing `notifications` table / `/api/notifications` REST endpoint and `notifications.unreadCount` tRPC procedure — no backend changes needed since GET `/api/notifications` already returns a consistent `{ notifications, unreadCount }` pair in one query (see `apps/web/src/app/api/notifications/route.ts`). This is a mobile-only client bug (stale cached list), not a data model or API bug.

## tRPC API

No new/changed procedures. `packages/api/src/routers/notifications.ts` (`list`, `unreadCount`, `markRead`, etc.) and the mobile REST client (`apps/mobile/lib/api.ts` → `fetchNotifications`) are unchanged.

## UI Surface

`apps/mobile/app/(tabs)/notifications.tsx` only:

- Add `useFocusEffect` (from `expo-router` / `@react-navigation/native`, already a transitive dep via expo-router) to call the existing `load()` whenever the screen regains focus — but skip the very first mount's duplicate call (the existing mount `useEffect` already covers first load).
- Add a `RefreshControl` to the `FlatList`, wired to a `refreshing` state + the existing `load()` (or a `load({ silent: true })` variant that doesn't show the full-screen spinner, only the pull spinner).
- After a focus/pull refresh, also call `refreshUnread()` so the badge and list can never disagree even if one of the two requests raced.
- No change to the badge/header component (`(tabs)/_layout.tsx`) — its 30s + foreground polling is correct as-is and is the source of truth for "should I show a badge", the list just needs to catch up to it more reliably.

## Implementation Notes

- Guard against double-fetch on initial mount: `useFocusEffect` fires on initial mount too in Expo Router; either drop the separate mount `useEffect` and rely solely on `useFocusEffect`, or track an `isFirstFocus` ref — prefer the former (simpler) unless it changes loading-spinner UX on first entry.
- Keep the full-screen `ActivityIndicator` only for the very first load (`items.length === 0 && loading`); subsequent focus/pull refreshes should use the lightweight `RefreshControl` spinner instead, so returning to the tab doesn't blank the list.
- `load()` already exists and is memoized via `useCallback`; reuse it rather than duplicating fetch logic.

## Out of Scope

- Any change to the 30s polling interval or `AppState` logic in `lib/unread.tsx`.
- Push delivery speed / Android battery-optimization guidance (separate, non-code discussion already had with the user).
- Cross-app notification-shade prioritization (platform limitation, not fixable in this codebase — see conversation).
- Web notification center (`apps/web/src/app/notifications/page.tsx`) — not reported as affected; leave untouched unless QA finds the same bug there.
- Server-side changes to `/api/notifications` or the `notifications` tRPC router.

## Open Questions

- None blocking. One judgment call flagged above for the Dev Agent: whether to replace the mount `useEffect` with `useFocusEffect` outright, or keep both with a guard — default to replacing it (simpler, no duplicate first-load fetch) unless it visibly regresses first-open UX.
