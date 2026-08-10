# Review — notification-detail-swipe

> **Date:** 2026-08-04
> **Spec:** `docs/specs/notification-detail-swipe.md`
> **QA:** `reports/qa-notification-detail-swipe.md`

## Verdict: APPROVED WITH NITS

## Spec Conformance

- [x] Tap opens detail reader (web modal + Helm modal) instead of navigating away
- [x] Auto mark-read on open
- [x] Swipe left → archive, swipe right → mark read (absolute directions)
- [x] Archive soft-deletes via `archivedAt`; undo toast 4s
- [x] "עבור ליעד" only when `isNavigableNotificationUrl`
- [x] Schema parity PG + SQLite + bootstrap ALTER
- [x] tRPC: `list` filter, `getById`, `archive` (+ undo), `unreadCount` excludes archived
- [x] Helm REST PATCH `action: read|archive|unarchive`

## Static Checks

- Mobile `tsc --noEmit`: PASS
- Web build: PASS
- API + web unit tests + notifications e2e: PASS
- Web `next lint`: blocked by missing ESLint config prompt (pre-existing)

## UI/UX Review

**Verdict:** APPROVED WITH NITS  
**Detected stack:** `next-trpc-monorepo`

### Design System Checklist
- [x] Matches project tokens/classes (`.card` / `.btn` / `.modal` / `.toast`)
- [x] RTL layout preserved
- [x] Mobile layout works (sheet modal + PanResponder swipe)
- [x] No unapproved UI frameworks
- [x] Reuses existing notifications surfaces

### UX Quality Checklist
- [x] Clear hierarchy — tap = read; swipe / buttons = triage
- [x] Feedback states (loading / empty / error / undo)
- [x] Archive uses undo toast (not hard confirm)
- [x] Hebrew microcopy per spec
- [x] Touch targets ≥ 44px on primary controls

### Findings

**Nits:**
1. Desktop hover action buttons are `hidden` below `sm` — intentional; swipe covers touch. OK.
2. Helm "עבור ליעד" still maps coarsely via `routeForUrl` (`/chat` vs `/notifications`) — pre-existing mobile deep-link limitation; out of scope for full path parity.
3. Push OS-tap still does not open detail by notification id — deferred per spec.

**Must-fix:** none.

## Security

- Archive/mark-read remain `protectedProcedure` / Bearer REST — OK.
- No secrets introduced.

## Changed files (summary)

- `packages/database/src/schema.ts`, `schema.pg.ts`, `index.ts`
- `packages/api/src/routers/notifications.ts`, `notifications.test.ts`
- `apps/web/src/app/notifications/page.tsx`
- `apps/web/src/app/api/notifications/route.ts`
- `apps/web/src/lib/notification-url.ts`, `notification-url.test.ts`
- `apps/web/e2e/notifications.spec.ts`
- `apps/mobile/app/notifications.tsx`, `apps/mobile/lib/api.ts`
- `docs/specs/notification-detail-swipe.md`
