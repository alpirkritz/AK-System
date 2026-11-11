# Review — mobile-focus-refresh-sweep

> **Slug:** `mobile-focus-refresh-sweep`
> **Date:** 2026-09-30
> **Verdict:** APPROVED WITH NITS

## Spec conformance

Matches `docs/specs/mobile-focus-refresh-sweep.md` — all 18 screens now refetch on focus via `useFocusEffect`, not just on mount:

| File | Change |
|---|---|
| `people.tsx` | Added `useFocusEffect` alongside the existing mount/search-change effect (kept, guarded by `hasLoadedOnce`) |
| `commitments.tsx` | Added `mode` param + `refreshing` state + `RefreshControl` (previously missing) + `useFocusEffect` alongside owner-filter effect |
| `index.tsx` | Mount `useEffect` replaced outright by `useFocusEffect` |
| `meetings.tsx` | Same (unrelated scroll-to-focus `useEffect` left untouched) |
| `projects.tsx` | Same |
| `calendar.tsx` | Added `useFocusEffect` alongside existing day/3-day-range effect (kept) |
| `finance.tsx` | Added `useFocusEffect` alongside existing segment-change effect (kept); refetches current segment only |
| `memory.tsx` | Mount effect replaced by `useFocusEffect`; **instructions textarea is only populated on `mode === 'initial'`**, so a focus-triggered refresh never clobbers in-progress typed/unsaved text — memories list still refreshes every time |
| `reading-list.tsx` | Added `mode` param + `refreshing` state + `RefreshControl` (previously missing) + `useFocusEffect` |
| `relationships.tsx` | Mount effect replaced by `useFocusEffect`; per-card note-editing local state (`draft`/`writing`) lives in child components keyed by id, unaffected by parent list refresh |
| `agents.tsx` | Added `mode`/`refreshing`/`RefreshControl` (previously missing, `ScrollView`) + `useFocusEffect` |
| `updates.tsx` | Added `useFocusEffect` calling the existing `'silent'` mode (no spinner) alongside the category-change effect (kept) |
| `chat.tsx` | Added `mode: 'initial' \| 'silent'` to `loadHistory`; focus refetch uses `'silent'` (no full-screen spinner flash on tab revisit); compose `input` state is untouched by either mode |
| `settings/dashboard.tsx` | Mount effect replaced by `useFocusEffect` (no `RefreshControl` — two small option lists, not a scrollable record list) |
| `settings/meeting-types.tsx` | Same, no `RefreshControl` change (single small list, low-traffic settings screen) |
| `settings/notifications.tsx` | Same |
| `settings/workspaces.tsx` | Same |
| `settings/voice-print.tsx` | Same; recording/upload local state (`phase`, recorder state) untouched by the status refetch |

## Diff review

- Every screen follows the same shape already proven in `tasks.tsx`/`notifications.tsx`: a `hasLoadedOnce` ref (or reuse of an existing equivalent, e.g. `updates.tsx`'s `hasLoaded`) and `useFocusEffect(useCallback(() => { if (!token) return; void load(...) }, [token, load]))`.
- Screens with a secondary reload trigger (search debounce, filter, segment, category, agent selection) kept that effect as-is and added the focus effect separately, per spec — no merged mega-effects.
- Three screens (`memory.tsx`, `chat.tsx`, and implicitly `relationships.tsx`/`voice-print.tsx`) needed a deliberate guard so the focus refetch can't stomp in-progress local state (draft text, recording phase); each is called out above.
- `commitments.tsx`, `reading-list.tsx`, `agents.tsx` gained `RefreshControl` where it was missing, per spec.
- No backend/tRPC/schema files touched — 100% client-side.

## Findings

None blocking.

## Nits

- `settings/dashboard.tsx`, `settings/meeting-types.tsx`, `settings/notifications.tsx`, `settings/workspaces.tsx`, `settings/voice-print.tsx` still use a single `loading` flag with no `'refresh'` mode, so a focus-triggered reload briefly shows the same full-screen spinner as the first load rather than a lighter indicator. Accepted as-is: these are low-traffic settings screens with fast fetches and no prior `RefreshControl`/mode infrastructure to build on; flagged in case product wants the lighter treatment later.
- `record.tsx`'s one-shot people/project picker fetch (flagged in the original audit, not part of this spec's scope) is still unfixed — separate, lower-severity follow-up candidate.
- Full `pnpm -r run lint` / `pnpm test` / `pnpm e2e` could not be run from repo root in this sandbox (no `pnpm` binary available). Verified instead via `apps/mobile/node_modules/.bin/tsc --noEmit` directly (the package's actual `lint` script) across all 18 changed files → clean, exit 0. No backend/web files touched, so `packages/api` Vitest and `apps/web` Playwright suites are not expected to be affected — recommend a `pnpm test && pnpm e2e` pass locally to close out QA formally.

## Verdict

**APPROVED WITH NITS** — mechanical, pattern-matching fix applied consistently across all 18 flagged screens; mobile typecheck clean; local `pnpm test && pnpm e2e` recommended as final confirmation before/with the next deploy.
