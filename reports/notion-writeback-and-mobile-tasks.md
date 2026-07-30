# Code Review: Notion write-back + mobile tasks parity

**Slug:** `notion-writeback-and-mobile-tasks`
**Spec:** `docs/specs/notion-writeback-and-mobile-tasks.md`
**Date:** 2026-07-30

## Verdict: APPROVED WITH NITS

Two-way status sync and mobile tasks parity land cleanly against the spec. Local writes never wait on Notion, failure reasons are returned, and the phone finally speaks the same status language as the web.

## QA Summary

| Check | Result |
|---|---|
| `pnpm test` (api) | 216/216 passed (14 new write-back tests) |
| Mobile `tsc --noEmit` | green |
| `pnpm --filter @ak-system/web build` | green |
| `pnpm -r run lint` | mobile + whatsapp-bridge green; web `next lint` blocked on interactive ESLint setup (pre-existing, not introduced here) |

## Spec Conformance

- [x] Marking a Notion task done PATCHes the page with the database-specific done label
- [x] Missing option / account / property returns a reason, does not throw
- [x] Manual tasks return `notionSync: null` and issue no fetch
- [x] Notion failure leaves the local status updated
- [x] Mobile: cancelled under "בוטלו", never "הושלמו"
- [x] Mobile: checkbox vs row body are separate tap targets
- [x] Mobile: FAB → formSheet create with title/status/priority/due/source

## Findings

### Nits

1. **Web surfaces write-back failure only on the tasks page checkbox.** Other callers (`/`, `/meetings/[id]`, `/projects/[id]`, person drawer) still invalidate silently on failure. Acceptable for v1 — the mutation itself is correct; expand the toast pattern if it becomes a support issue.
2. **Due date on mobile is a free-text `YYYY-MM-DD` field.** No native date picker was added (would need a new dependency). Fine for power users; revisit if typos show up.
3. **Dashboard open-count still uses `!t.done`.** Cancelled tasks have `done: true`, so they stay out of the open count. If a future status is "closed but not done", revisit.
4. **Typed routes:** `/task/[id]` is cast via `as Href` until Expo regenerates the typed-routes union. Harmless; regenerates on the next `expo start`.

### Security

- Notion tokens stay in env (`NOTION_ACCOUNTS`); write-back reuses the same resolver as the read path.
- No new secrets in code. PATCH body contains only the status property name and label.

## UI/UX Review

**Verdict:** APPROVED WITH NITS

### Checklist

- [x] RTL layout on list, chips, and form sheet
- [x] Touch targets ≥ 40–44 px (checkbox, chips, FAB)
- [x] Split tap targets — inspect vs complete no longer collide
- [x] Empty / loading / error states present
- [x] Notion write-back is discoverable ("מסונכרן עם Notion…") rather than invisible
- [x] FAB mirrors web (bottom-left, turquoise, above tab bar + safe area)
- [x] Status / priority / source chips reuse the same colour language as web
- [ ] Native date picker (nit — deferred)
- [ ] Write-back toast on every web surface (nit — deferred)

### Interaction notes

- Opening a row as a `formSheet` with `fitToContents` + grabber matches Expo SDK 56 platform expectations and keeps the list visible underneath.
- Optimistic checkbox toggle with revert-on-error keeps the phone feeling instant even when Notion is slow.

## Files touched

| Area | Files |
|---|---|
| Spec | `docs/specs/notion-writeback-and-mobile-tasks.md` |
| Write-back | `packages/api/src/services/notion-task-writeback.ts`, `notion-task-writeback.test.ts`, `notion-tasks-sync.ts`, `routers/tasks.ts` |
| Web hint | `apps/web/src/app/tasks/page.tsx`, `components/Modals/TaskModal.tsx` |
| Mobile | `lib/data.ts`, `lib/theme.ts`, `app/(tabs)/tasks.tsx`, `app/task/[id].tsx`, `app/_layout.tsx` |
