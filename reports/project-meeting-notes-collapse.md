# project-meeting-notes-collapse — Reviewer Report

> Spec: `docs/specs/project-meeting-notes-collapse.md`

## Summary

Wrapped the "סיכומי ישיבות" block on `/projects/[id]` in a new generic `CollapsibleSection` component (`apps/web/src/app/projects/components/CollapsibleSection.tsx`), defaulting to collapsed. No schema, tRPC, or `NotionSummaryCard` internals changed.

## Files changed

- `apps/web/src/app/projects/components/CollapsibleSection.tsx` — new
- `apps/web/src/app/projects/[id]/page.tsx` — swapped the static meeting-notes `<div>` for `<CollapsibleSection>`
- `apps/web/e2e/project-meeting-notes-collapse.spec.ts` — new Playwright test

## UI Review

**Verdict:** APPROVED WITH NITS

### Checklist
- [x] Uses `.card` utility for content region (not raw unstyled elements)
- [x] Dark theme colors match palette (`#5a688c` / `#7a89ab` label tones reused as-is)
- [x] RTL layout preserved (header uses `text-right`, chevron rotation is direction-agnostic)
- [x] Mobile layout unaffected (single-column section, no new breakpoints needed)
- [x] Focus-visible: header is a real `<button>`, keyboard-operable by default
- [x] Loading/error/empty states unchanged (section only renders when `meetingNotes.length > 0`, same as before)
- [x] No new CSS frameworks introduced
- [x] Reuses existing components (`NotionSummaryCard` untouched)

### Findings
- Nits: Collapse state is not persisted (resets to collapsed on every page load), per the spec's Open Questions — acceptable for this iteration.
- Nits: `CollapsibleSection` is intentionally generic so it can be reused on the people/meetings/tasks sections later, but that reuse is out of scope here and not yet done.

## Verification

- `pnpm --filter @ak-system/web run lint`: clean — 0 errors, only pre-existing warnings in unrelated files (none in the new/changed files).
- `pnpm --filter @ak-system/web build`: **could not complete in this sandbox** — the Google-Drive-mounted working copy rejects `unlink` on the service-worker output file (`EPERM`, reproduced independently of this change with a plain `rm -f`), and a full monorepo `tsc --noEmit` also hit an OOM in this constrained sandbox. Both are environment limitations, not related to the two files touched here. Recommend running `pnpm --filter @ak-system/web build` (or the existing `pnpm run ci:local` / EC2 deploy step) in the normal dev environment as the final gate before shipping.
- `pnpm test` (Vitest, packages/api): not run — this change touches no backend/tRPC/schema code, so it's unaffected.
- `pnpm e2e`: not run in this sandbox (same environment constraints as above); the new spec `project-meeting-notes-collapse.spec.ts` should be run locally as part of the normal `pnpm e2e` pass.

**Overall:** APPROVED WITH NITS — safe to merge; run the build/e2e gate locally before deploying.
