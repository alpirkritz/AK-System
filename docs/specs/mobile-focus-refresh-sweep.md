# Mobile-Wide Focus-Refresh Sweep

> **Slug:** `mobile-focus-refresh-sweep`
> **Status:** Approved (user asked to fix all screens in one pass)
> **Detected stack:** `expo-mobile` (`apps/mobile`)
> **Last Updated:** 2026-09-30

## Goal

`fix-mobile-notifications-stale-list` fixed one screen (`app/(tabs)/notifications.tsx`) for a bug where a tab screen loads its data once on mount and never refetches, because Expo Router keeps tab screens mounted across navigation. A full audit of `apps/mobile/app/` found the identical pattern in **18 more screens** — every data-driven screen except the two that were already fixed (`tasks.tsx`, `notifications.tsx`). Two concrete symptoms the owner hit today: renaming a contact in `person/[id].tsx` and pressing save (`router.back()`) lands back on `people.tsx`, which still shows the old name because it never refetches on focus; accepting a commitment in `commitments.tsx` has the same problem plus no pull-to-refresh at all.

Desired outcome: every tab-persistent, data-driven mobile screen refetches its data on focus (not just on first mount), so edits/creates/deletes made on another screen (or via `router.back()` from a detail sheet) are reflected the next time the user looks at the list — without introducing flicker on routine background polling or breaking in-progress UI state (search text, open forms, chat scroll position, etc).

## User Stories

- As the owner, when I edit something (a contact, a task, settings) and navigate back to a list, I want the list to show my change immediately, not require me to leave and come back again.
- As the owner, I want pull-to-refresh available on every list screen that doesn't already have it, so I can manually force a refresh.
- As the owner, I don't want screens to visibly flicker, lose my scroll position, or reset in-progress input (search box, chat draft, open edit forms) every time I revisit a tab.

## Acceptance Criteria

- [ ] All 18 screens listed below use `useFocusEffect` (from `expo-router`) to refetch on every focus, following the exact shape already used in `tasks.tsx` / `notifications.tsx`: a `hasLoadedOnce` ref, `load(mode: 'initial' | 'refresh')` toggling `loading` vs `refreshing`, and the plain mount `useEffect` removed (superseded by `useFocusEffect`, which also fires on initial mount).
- [ ] Screens that already have `RefreshControl` keep it, now wired to the same `refreshing` state as the focus refetch.
- [ ] Screens that do not yet have `RefreshControl` (`commitments`, `reading-list`, `agents`, `chat`, `settings/dashboard`, `settings/meeting-types`, `settings/notifications`, `settings/workspaces`, `settings/voice-print`) get one added, unless the screen has no scrollable list to attach it to (e.g. a single-form settings screen — in that case focus-refetch alone is enough, no `RefreshControl` needed).
- [ ] `finance.tsx` and `updates.tsx` (which already refetch on a secondary dependency — segment/category change) keep that behavior; focus-refetch is additive, not a replacement.
- [ ] `chat.tsx`: focus-refetch must not clear an in-progress draft message or jump scroll position on every tab revisit — reload history in place, preserve local compose state.
- [ ] Screens with a debounced search (`people.tsx`) keep debounce behavior; focus-refetch uses the current committed search term, does not reset it.
- [ ] `apps/mobile` typecheck (`tsc --noEmit`, the package's `lint` script) passes clean after all 18 changes.
- [ ] No behavior change to the 5 stack-pushed detail screens (`person/[id].tsx`, `task/[id].tsx`, `project/[id].tsx`, `meeting/[id].tsx`, `agent/[id].tsx`) — confirmed not affected by this bug (they remount fresh on every push already) and out of scope.

## Data Model

None. Client-only fix; no backend/tRPC/schema changes.

## tRPC API

None. Same REST/data-fetch helpers (`lib/api.ts`, `lib/data.ts`) already used by each screen; no new endpoints.

## UI Surface

`apps/mobile/app/(tabs)/` and nested `settings/`, all in the persistent `Tabs` navigator (confirmed via `app/(tabs)/_layout.tsx`):

| File | Load fn | Had `RefreshControl`? | Notes |
|---|---|---|---|
| `people.tsx` | `load` | yes | Confirmed bug (contact rename symptom). Keep debounced search as-is. |
| `commitments.tsx` | `load` | no → add | Confirmed bug (commitment-accept symptom). Optimistic local filter on accept/dismiss stays; focus-refetch is the backstop. |
| `index.tsx` | `load` | yes | Dashboard. |
| `meetings.tsx` | `load` | yes | |
| `projects.tsx` | `load` | yes | |
| `calendar.tsx` | `load` | yes | |
| `finance.tsx` | `loadSegment` | yes | Keep segment-change refetch; add focus refetch on top. |
| `memory.tsx` | `load` | yes | |
| `reading-list.tsx` | `load` | no → add | |
| `relationships.tsx` | `load` | yes | |
| `agents.tsx` | `load` | no → add | |
| `updates.tsx` | `load` | yes | Keep category-change refetch; add focus refetch on top. |
| `chat.tsx` | `loadHistory` | no → skip (see notes) | Refetch history on focus; do not add pull-to-refresh (chat convention, not a list-of-records screen) — see acceptance criteria for draft/scroll preservation. |
| `settings/dashboard.tsx` | `load` | no → skip if no list | Add `RefreshControl` only if there's a scrollable list; else focus-refetch alone. |
| `settings/meeting-types.tsx` | `load` | no → add | Has a list of meeting types — add. |
| `settings/notifications.tsx` | `load` | no → add if list present | |
| `settings/workspaces.tsx` | `load` | no → add | |
| `settings/voice-print.tsx` | `load` (enrollment status) | no → skip | Single status view, no list — focus-refetch only. |

Not in scope (confirmed not tab-persistent, already remount fresh): `person/[id].tsx`, `task/[id].tsx`, `project/[id].tsx`, `meeting/[id].tsx`, `agent/[id].tsx` (root `Stack.Screen`s).

Also not in scope for this sweep (flagged separately, lower severity, follow-up candidate): `record.tsx`'s one-shot fetch of the people/project picker list for the recording-participant autocomplete.

## Implementation Notes

- Exact pattern per screen (mirrors `tasks.tsx`):
  ```ts
  const hasLoadedOnce = useRef(false)
  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!token) return
    mode === 'refresh' ? setRefreshing(true) : setLoading(true)
    // ...fetch...
    hasLoadedOnce.current = true
    setLoading(false); setRefreshing(false)
  }, [token, /* other real deps */])

  useFocusEffect(
    useCallback(() => {
      if (!token) return
      void load(hasLoadedOnce.current ? 'refresh' : 'initial')
    }, [token, load]),
  )
  ```
- Where a screen already refetches on a secondary dependency (segment/category/search), keep that effect and add the focus effect alongside it — don't merge them into one mega-effect; two small effects are clearer and match existing style.
- `chat.tsx`: refetch history only, never touch the compose text state or force-scroll on a focus-triggered reload (only auto-scroll on a true initial load or a genuinely new incoming message, matching whatever it already does today).
- Any screen with only a single record / form (no `FlatList`/`ScrollView` of many items) does not need `RefreshControl` — focus-refetch is the fix, pull-to-refresh would be a no-op UX.
- Go file by file; each is a small, mechanical, low-risk diff. No shared abstraction/hook introduced — matches the existing repo convention of inlining this per screen (as `tasks.tsx` already does) rather than adding a new shared utility.

## Out of Scope

- `record.tsx` picker staleness (flagged, not fixed here).
- Any backend/tRPC changes — this is 100% a mobile client staleness bug.
- Web app changes — the equivalent web flows (`PersonDetailDrawer.tsx`, `commitments/page.tsx`) were checked and already invalidate their query caches correctly on mutation; no fix needed there.
- Introducing a shared `useFocusRefresh` hook (considered, rejected to match existing per-screen inline convention; can revisit if duplication becomes a maintenance issue).

## Open Questions

- None blocking. `settings/dashboard.tsx` and `settings/notifications.tsx`'s exact List-vs-form shape decides whether they get `RefreshControl` — left to implementation judgment per the table above.
