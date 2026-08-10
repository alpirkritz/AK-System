# QA — notification-detail-swipe

> **Date:** 2026-08-04
> **Spec:** `docs/specs/notification-detail-swipe.md`

## Results

| Suite | Result |
|-------|--------|
| `pnpm test` (API Vitest) | PASS — 351 tests (incl. 8 notifications router) |
| `pnpm --filter @ak-system/web test -- src/lib/notification-url.test.ts` | PASS — 2 tests |
| `playwright test e2e/notifications.spec.ts` | PASS — 7/7 |
| `pnpm --filter @ak-system/mobile run lint` | PASS |
| `pnpm --filter @ak-system/web build` | PASS |

## Notes

- E2E chat heading assertion updated from `/צ.?אט/` to exact `עוזר` (current `AssistantWorkspace` title).
- Web `next lint` interactive prompt (missing eslint config) is a pre-existing workspace issue — not introduced by this change.
