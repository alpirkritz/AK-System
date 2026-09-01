# QA report — mobile-calendar-connect-keyboard

**Detected stack:** next-trpc-monorepo
**Verdict:** PASS (automated) — native APK not executed

- Static check: PASS — mobile `tsc --noEmit`; web `next build` compiled
- Unit tests: 752/752 api + 183/183 web
- E2E (scoped): 6/6 passed (`assistant-chat-ux.spec.ts`, `calendar-connect.spec.ts`)
- Full `pnpm e2e` suite: not re-run this pass (scoped UI specs only)
- Production config drift: N/A — no new env vars
- Build freshness: web production build succeeded in this session
- Total time: ~3 min unit + ~26s scoped e2e + ~27s web build

## Per-phase results

### 1. Static

- `@ak-system/mobile` `tsc --noEmit`: PASS
- `@ak-system/web` `next lint`: interactive ESLint setup prompt (pre-existing; not used)
- `@ak-system/web` `next build`: compiled successfully; `/api/auth/google-calendar` and callback listed as dynamic routes

### 2. Unit/integration tests

- `packages/api` including `google-calendar-auth.test.ts` and `routers/calendar.test.ts`: PASS
- `apps/web` including `../mobile/lib/composer-keyboard.test.ts`: PASS

### 3. E2E / UI

See `reports/qa-ui-mobile-calendar-connect-keyboard.md`.

## Failures

None in the runs above.

## Notes

Helm calendar connect and the chat keyboard lift live in the native bundle. QA-UI did not run an APK. Do not mark the phone experience done until a new build is installed and checked on device.
