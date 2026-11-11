# layout-reorder — status

**Verdict: APPROVED WITH NITS (web complete; mobile out of scope per spec). No Reviewer-agent pass yet.**

## Done
- `user_settings.layout_prefs` (pg + SQLite schema, bootstrap `ALTER`), `settings.layout.{get,set,reset}`, `services/layout-prefs.ts` (bounded, validated ids), shared `applyLayout` in `@ak-system/types`.
- Web: `components/layout/` — `ReorderableBlocks` (edit mode, drag handles via `@dnd-kit`, mouse + touch + keyboard, hide/restore tray, reset), `useLayout` (optimistic saves, keeps saved entries for blocks not on screen, hides blocks until the saved layout arrives so the default order never flashes), `pairSpans` (two adjacent half blocks share a row).
- Wired: dashboard (10 blocks, meetings + tasks pair side by side when adjacent), person drawer (10 sections), meetings (upcoming and past timeline sections, open/closed state remembered).
- Tests: `applyLayout` and storage (api), `pairSpans` (web), Playwright `e2e/layout-reorder.spec.ts` (hide → reload → restore; keyboard move → reload). Checked in the browser: drag, persist across reload, person drawer, meetings.
- `pnpm test` api 1422/1422, web 318/318; lint no errors; web build compiles; mobile `tsc` clean.

## Deviations
- "לא משויכות" on the meetings page is not a reorderable block (it only renders for a world filter, below the sections).
- Open/closed state is stored in `collapsed` as `id` (closed) or `id:open` (opened), so a choice against the section's default can be remembered.

## Not done
- Mobile reordering (out of scope), Reviewer pass.
