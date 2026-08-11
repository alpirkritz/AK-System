# Review — `mobile-parity-foundation`

> **Spec:** [`docs/specs/mobile-parity-foundation.md`](../docs/specs/mobile-parity-foundation.md)
> **Parent spec:** [`docs/specs/mobile-web-parity.md`](../docs/specs/mobile-web-parity.md)
> **Date:** 2026-08-11
> **Verdict:** APPROVED WITH NITS — pending on-device visual pass (see QA below)

## What changed

Wave 0 (prerequisite) of the mobile parity umbrella: the shared component layer went from "written but unused" to actually wired in, and the tab structure moved to the "עוד" hub model.

| File | Change |
|---|---|
| `app/(tabs)/tasks.tsx` | Removed the local `StatusPill` (the duplicate the umbrella spec called out) → `components/StatusPill`; both chip rows → `FilterChips`; empty list → `EmptyState`. Net −92 lines. |
| `app/(tabs)/index.tsx` | KPI tiles → `KpiCard`, section titles → `SectionHeader`, list items → `Card`, empty sections → `EmptyState` (compact). |
| `app/(tabs)/meetings.tsx` | Filter row → `FilterChips`, meeting card → `Card`, empty list → `EmptyState`. |
| `app/(tabs)/people.tsx` → `app/people.tsx` | Moved out of the tab group into the root Stack; rows → `Card` + `RtlRow`, empty list → `EmptyState`. Same data, same search behavior. |
| `app/(tabs)/more.tsx` | **New** — 2-column `Card` grid: אנשים, רשימת קריאה, התראות, הגדרות. Entries are a single `ENTRIES` array so waves B–E append one line each. |
| `app/(tabs)/_layout.tsx` | `people` tab → `more` tab (☰ / "עוד") in the same slot. Tabs are now דשבורד, פגישות, משימות, עוד, עוזר. |
| `app/_layout.tsx` | Registered `Stack.Screen name="people"` with `title: 'אנשים'`. |
| `lib/api.ts` | Doc comment marking `MobileNotificationRoute` + `mobileRouteForNotificationUrl` as the single deep-link extension point every later wave must touch. No behavior change. |

Three small additions to the shared components, each driven by a real call site rather than speculation:

- `EmptyState`: `iconColor` (the tasks screen's ✓ is a glyph, not an emoji — it takes the text color, so without this it renders black on navy) and `compact` (dashboard sections are empty *inside* a populated screen; the default 80pt top padding is for full-screen lists).
- `SectionHeader`: `style` override, so screens whose container already pads horizontally (the dashboard) can zero out the component's own 16pt.

## QA

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/mobile lint` (`tsc --noEmit`) | Pass |
| `pnpm -r run lint` | `apps/mobile` + `apps/whatsapp-bridge` pass. `apps/web` fails — **pre-existing and unrelated**: `apps/web` has no ESLint config at all, so `next lint` drops into its interactive setup prompt and exits non-zero. Not caused by this change (no web files touched). |
| Metro bundle (`expo export --platform android`) | Pass — 1713 modules, no unresolved imports. Confirms the moved route and all new component imports resolve at bundle time, not just at type level. |
| Vitest | N/A — `apps/mobile` has no test runner, and this wave adds no logic to `lib/data.ts`. |
| Playwright | N/A per the umbrella spec ("Playwright לא רלוונטי למובייל"). |

### Manual on-device checklist (not yet run — needs a device/emulator)

- [ ] Tab bar shows 5 tabs: דשבורד, פגישות, משימות, עוד, עוזר — no אנשים tab.
- [ ] "עוד" grid: all four tiles navigate correctly and back-navigation returns to the tab.
- [ ] People screen renders the same list/search as before, now with a Stack header titled "אנשים".
- [ ] Dashboard KPIs, meeting/task cards and empty states look right (see visual notes below).
- [ ] Tasks screen: status/workspace chips filter as before; status pill still appears only for in-progress/blocked/pending/cancelled.
- [ ] A test push with `url: '/people'` lands on the people screen (the mapping is unchanged, but worth confirming post-move).

## UI/UX review

**Verdict:** APPROVED WITH NITS

- [x] RTL preserved everywhere — `row-reverse`, `textAlign: 'right'`, `writingDirection: 'rtl'` throughout; the "עוד" grid fills right-to-left.
- [x] Dark navy theme tokens only (`colors.*` from `lib/theme.ts`); no new one-off color values.
- [x] Touch targets ≥44pt — grid tiles are 96pt tall, `FilterChips` keeps `minHeight: 36` with 8pt vertical padding (unchanged from the chips it replaced).
- [x] Accessibility: every grid tile and card has `accessibilityRole="button"` (via `Card`'s pressable branch) plus a Hebrew `accessibilityLabel`; chips keep `accessibilityState={{ selected }}`.
- [x] Loading / error / empty states preserved on all four screens.
- [x] No new dependencies.

### Visual deltas (intentional, worth an eyeball on device)

1. **Dashboard KPIs** — `KpiCard` centers its content at 22pt; the old inline tiles were right-aligned at 26pt. Consistency win, but it's a visible change.
2. **Dashboard section titles** — 17pt/700 via `SectionHeader` vs the old 16pt/600.
3. **People rows** — now `Card` tiles with 8pt spacing instead of hairline-separated rows. This is the direction wave B needs anyway (rows become tappable → `person/[id]`), but it is the largest visual change in the wave.
4. **Meetings/dashboard cards** — 14pt corner radius via `Card` vs the previous 12pt.

If any of these read wrong on the Fold-7, they are one-line style overrides on the shared component — no structural rework.

### Nits (not blocking)

- `app/task/[id].tsx` still hand-rolls the header/keyboard/scroll pattern that `FormSheetScaffold` now encapsulates. Deliberately out of scope here (wave E owns that screen), but it's the one remaining duplicate of a shared component.
- `SimpleBars` and `FormSheetScaffold` remain unused until waves C and A/B respectively.
- The generated `apps/mobile/.expo/types/router.d.ts` is stale (still lists `/(tabs)/people`); it regenerates on `expo start`. The app already handles this with the `as Href` convention, and `/people` stays valid either way since the path did not change.

## Handoff to waves A–E

`mobile-parity-foundation` no longer blocks anything. Each wave should:

1. Add its Stack screen(s) to `app/_layout.tsx`.
2. Append one entry to `ENTRIES` in `app/(tabs)/more.tsx`.
3. Add its path to `MobileNotificationRoute` **and** a branch in `mobileRouteForNotificationUrl` (`lib/api.ts`) — otherwise its pushes silently fall back to `/`.
4. Build detail screens on `FormSheetScaffold` rather than copying `task/[id].tsx`.
