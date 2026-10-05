# project-page-polish — Reviewer Report

> Spec: `docs/specs/project-page-polish.md`

## Summary

Four fixes to `/projects/[id]`:

1. **Roster pill** — split into a name/avatar button (opens `PersonModal`, reused as-is) and a separate hover-revealed `×` (removes from project), mirroring `CircleCard.tsx`'s existing pattern. `aria-label` names the person.
2. **Task sort** — new `sortTasksByDueThenPriority` (nearest due date first, priority only breaks ties) used on this page only; `sortTasksByPriorityThenDue` untouched (`PersonDetailDrawer.tsx` still uses it).
3. **Company + Notion link** — `projects.getById` now left-joins `companies` and returns `companyName`; header shows it plus a "פתח ב-Notion ↗" link built by the new `notionPageUrl()` helper, when the underlying data exists.
4. **Meetings** — client-side reorder (upcoming ascending, then past as already returned), plus a "+ פגישה" header button opening `MeetingModal` pre-filled with `projectId`.

## Files changed

- `packages/api/src/routers/projects.ts` — `getById` leftJoin on `companies`
- `apps/web/src/app/projects/[id]/page.tsx` — all four UI changes
- `apps/web/src/lib/sort-tasks.ts` / `sort-tasks.test.ts` — new sort fn + tests
- `apps/web/src/lib/notion-url.ts` / `notion-url.test.ts` — new helper + tests
- `apps/web/e2e/project-page-polish.spec.ts` — new Playwright coverage (5 tests)

## UI Review

**Verdict:** APPROVED WITH NITS

### Checklist
- [x] Uses `.btn` / `.pill` / `.card` utilities (no raw unstyled elements)
- [x] Dark theme colors match palette (`#5a688c`/`#7a89ab`/`#eef3fb`, reused as-is)
- [x] RTL layout preserved
- [x] Mobile layout unaffected (no new breakpoints)
- [x] Focus-visible: remove `×` uses `focus:opacity-100` (keyboard-reachable, not hover-only), matching `CircleCard.tsx`
- [x] Loading/error/empty states unchanged
- [x] No new CSS frameworks introduced
- [x] Reuses existing components (`PersonModal`, `MeetingModal`, `CircleCard`'s remove-icon pattern) rather than inventing new ones

### Findings
- Nits: meetings are reordered but not visually split into "upcoming"/"past" sub-headers — acceptable per spec (ordering only, out of scope to add sub-headers).
- Nits: the stale color palette in `.cursor/skills/ui-designer-agent/SKILL.md` (flagged during design review) is not fixed here — explicitly out of scope for this spec, tracked separately.

## Verification

- `pnpm --filter @ak-system/web run lint`: clean — 0 errors; fixed one new warning (`useMemo` dependency shape) during review; only pre-existing warnings remain elsewhere.
- `pnpm --filter @ak-system/web build`: **not completed** — same sandbox limitation as the previous spec in this series (Google-Drive-mounted folder rejects `unlink` on build output).
- `vitest run` (new unit tests): **could not run in this sandbox** — `esbuild`/`vite` in `node_modules` are the macOS (`darwin-arm64`) native build, but this sandbox is Linux (`linux-arm64`). This is a cross-platform `node_modules` mismatch (the project's dependencies were installed on the Mac and reached this sandbox via the synced Google Drive folder), not a defect in the new code. The new tests (`sort-tasks.test.ts` additions, `notion-url.test.ts`) were reviewed by hand for correctness instead.
- `pnpm e2e`: not run, same native-binary limitation would affect Playwright's own browser binaries.
- `pnpm test` (Vitest, packages/api): not run, same limitation; this change's only backend edit (`projects.ts` `getById` join) was reviewed by hand — it preserves every previously-selected field and adds one (`companyName`), so existing callers (`ProjectModal`, `conversation-engine.ts`, `cron/pre-meeting-briefing`) are unaffected.

**Recommendation:** run `pnpm install` fresh (or at least reinstall `esbuild`) and `pnpm qa` + `pnpm --filter @ak-system/web build` on the actual dev machine (Mac) or CI before deploying — this sandbox cannot execute this repo's build/test toolchain end-to-end because its `node_modules` contains macOS-only native binaries. This applies to this spec and the previous one (`project-meeting-notes-collapse`) equally.

**Overall:** APPROVED WITH NITS on code review; build/test execution deferred to the normal dev environment.
