# Code Review: Mobile updates TLDR + task title wrap

> **Slug:** `mobile-updates-tldr-and-task-title-wrap`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-09-06
> **Detected stack:** next-trpc-monorepo (Expo mobile client)

## Spec Conformance

- [x] Digest card + five Hebrew category chips on **עוד → עדכונים**
- [x] **תמצית הפיד** / **קורא את כל העדכונים…** calls `feed.generateDigest` for the selected category; previous digest stays visible (dimmed) while regenerating
- [x] `feed.getDigest` loaded per category; last chip persisted (`ak.updates-category`, SecureStore-safe)
- [x] Empty feed disables digest and shows sync-first copy
- [x] **סנכרן מקורות** shows `נוספו N פריטים (M מקורות חדשים)` then reloads list + stored digest (does not auto-generate)
- [x] Feed items and שים לב rows open `link` (maps API `link`, with `url` fallback — previously taps were dead)
- [x] Gemini/network errors stay in Hebrew; previous digest remains
- [x] Task **כותרת** is multiline, grows, `scrollEnabled={false}`
- [x] No מקורות tab on mobile

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | PASS (`tsc --noEmit` on mobile; web lint warnings are pre-existing, none in touched files) |
| `pnpm --filter @ak-system/web exec vitest run ../mobile/lib/feed.test.ts` | PASS (6 tests) |
| `pnpm --filter @ak-system/web build` | SKIPPED — no `apps/web` or `packages/` production changes |

## QA

- Vitest: `apps/mobile/lib/feed.test.ts` — mapping `link` vs `url`, digest watch filter, Hebrew category labels, sync/meta copy.
- Playwright: not applicable (mobile-only UI). Existing `apps/web/e2e/updates.spec.ts` untouched.
- Native/Expo: not exercised on a device in this pass. Reload Helm (Expo Go or a new APK) to confirm wrap + digest against the live API.

## UI/UX Review

**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo (Expo)

### Design System Checklist
- [x] Matches navy/turquoise tokens (`colors.bg`, `colors.accent`, `Card`, `FilterChips`, `EmptyState`)
- [x] RTL layout preserved (`row-reverse`, `textAlign: 'right'`, `writingDirection: 'rtl'`)
- [x] Mobile layout: sticky actions + chips; digest and list scroll
- [x] No unapproved UI frameworks
- [x] Reuses existing components; duplicate in-page **עדכונים** heading removed (stack header already has it)

### UX Quality Checklist
- [x] Clear hierarchy — digest is the briefing; list is secondary
- [x] Cognitive load: two labeled actions, not a sources-management clone
- [x] Feedback states: loading spinner, empty list + CTA, sync/digest pending, Hebrew errors, 4s success notice
- [x] No new destructive actions
- [x] Microcopy matches web (verb-first: **סנכרן מקורות**, **תמצית הפיד**)
- [x] Action buttons ≥ 44px; title field ≥ 72px; focus/labels on icon-less buttons
- [ ] FilterChips still use `minHeight: 36` (shared component) — below 44px target

### Findings

**Must-fix:** none.

**Nits:**
- `apps/mobile/components/FilterChips.tsx` chips are 36px tall. Acceptable (existing pattern on tasks) but shy of the 44px touch-target rule. Do not change in this slug unless we bump the shared chip everywhere.
- Digest **TLDR** / **שים לב** section labels are Latin/Hebrew mixed like web. Fine for consistency; a fully Hebrew **בקצרה** would be warmer if we ever rename both surfaces together.

## Findings

### Must-fix
None.

### Should-fix
None for this slug.

### Nits
- Shared `FilterChips` height (see UI/UX).
- `syncFeed` still casts the loosely typed tRPC client result; mapping helpers cover `list`/`getDigest` more strictly than sync.

## Out of Scope Creep

None. Sources CRUD stays web-only. No schema or new procedures.

## Suggested PR Description

Port the web updates briefing (category chips, RSS sync with counts, persisted TLDR + שים לב) to Helm, fix feed item links (`link` vs `url`), and wrap long task titles on the detail sheet.
