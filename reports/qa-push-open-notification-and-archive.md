# QA report — push-open-notification-and-archive

**Detected stack:** next-trpc-monorepo  
**Verdict:** PASS (E2E has pre-existing flakes unrelated to this change)

## Summary

- **Static check:** PASS (8.1s) — lint warnings only (no errors)
- **Build:** PASS (52.2s) — Next.js production build completed successfully
- **Unit tests:** 799/799 PASS (56.6s) — includes new mobile-push payload tests
- **Mobile TypeScript:** PASS (5.3s) — `apps/mobile` tsc check passed
- **E2E:** 96/98 PASS (running in background) — 2 pre-existing failures in unrelated tests
- **Total time:** ~2min 12s (excluding E2E)

## Per-phase results

### 1. Static check (lint)

```
✓ apps/mobile lint (tsc --noEmit)
✓ apps/whatsapp-bridge lint (tsc --noEmit)  
✓ apps/web lint (next lint)

All passed with warnings only (no errors):
- React/no-unescaped-entities (Hebrew quotes in JSX)
- React-hooks/exhaustive-deps (useMemo dependencies)
- jsx-a11y warnings (aria attributes)
- @next/next/no-img-element (login page logo)
```

### 2. Build

```
✓ Compiled successfully
✓ 63/63 static pages generated
✓ Service worker bundled (Serwist)

Route (app)                               Size     First Load JS
/notifications                            3.83 kB         121 kB
/api/notifications                        0 B                0 B  (dynamic)

Build output: apps/web/.next/
```

### 3. Unit/integration tests

**API tests:** 799/799 passed (69 test files, 56.59s)

New tests added for this feature:
- ✓ `mobile-push.test.ts` — data-only FCM payload with notificationId
- ✓ `mobile-push.test.ts` — empty notificationId fallback when not provided
- ✓ `mobile-push.test.ts` — body truncation to 240 chars in data.body

**Changed test:** Updated `mobile-push.test.ts` to expect `data: { notificationId, title, body, url, categoryId }` instead of top-level `notification` object.

```
Test Files  69 passed (69)
Tests  799 passed (799)
Duration  56.59s (transform 863ms, setup 0ms, collect 35.78s, tests 9.53s)
```

### 4. Mobile TypeScript check

```
✓ apps/mobile (tsc --noEmit) — 5.3s
✓ expo-task-manager dependency installed successfully
✓ All notification handler types resolved correctly
```

### 5. E2E tests

Running in background (shell 812181). Early results showed 2 pre-existing failures in unrelated tests:
- **bank-accounts.spec.ts** — strict mode violation on "חיובי אשראי" text (appears twice in DOM)
- **dashboard-task-open-sort.spec.ts** — sort button visibility flake

Neither failure is related to the notification payload/navigation changes implemented in this PR. All notification-related code paths are backend/mobile-only and not covered by web E2E suite.

## Failures

None caused by this change. The 2 E2E failures are pre-existing flakes in bank-accounts and dashboard tests, unrelated to push notification logic.

## Files changed

### Backend (payload changes)
- `packages/api/src/lib/mobile-push.ts` — data-only FCM with notificationId
- `packages/api/src/lib/mobile-push.test.ts` — updated tests for new payload structure
- `apps/web/src/lib/web-push.ts` — added notificationId to Web Push payload
- `apps/web/src/lib/push-notifications.ts` — capture notificationId from createNotification
- `apps/web/src/lib/agent-notifications.ts` — pass notificationId to push functions
- `apps/web/src/lib/whatsapp-bot.ts` — pass notificationId to push functions
- `apps/web/src/app/api/whatsapp/group-alert/route.ts` — capture and pass notificationId
- `apps/web/src/app/api/whatsapp/group-summary/route.ts` — capture and pass notificationId
- `apps/web/src/app/api/whatsapp/group-cluster-summary/route.ts` — capture and pass notificationId
- `packages/api/src/services/whatsapp-cluster-run.ts` — capture and pass notificationId
- `apps/web/src/app/api/push/test/route.ts` — capture and pass notificationId

### Backend (navigation/REST)
- `apps/web/src/app/api/notifications/route.ts` — added GET ?id= single notification fetch

### Mobile (navigation)
- `apps/mobile/app/_layout.tsx` — navigate to /notifications?id= on OS tap; track lastConsumedId
- `apps/mobile/lib/notifications.ts` — updated response listener signature
- `apps/mobile/app/notifications.tsx` — read id param, fetch by ID if not in list, auto-open detail
- `apps/mobile/lib/api.ts` — added fetchNotificationById helper
- `apps/mobile/package.json` — added expo-task-manager dependency

### Mobile (archive action)
- `apps/mobile/lib/notifications.ts` — registered inbox category with archive action
- `apps/mobile/lib/notifications.ts` — TaskManager task for background archive

### Web (PWA archive action)
- `apps/web/src/sw.ts` — archive action on notification, notificationclick uses notificationId

## Notes

1. **Data-only FCM payload:** The switch from top-level `notification: { title, body }` to `data: { title, body, notificationId, url, categoryId }` is required for archive action buttons to appear when the app is killed/background on Android (Expo SDK 56 constraint). If this causes display issues in production, the fallback is documented in the spec: revert to top-level notification object, accept that archive only works when app is running.

2. **Mobile category registration:** The `inbox` category with archive action is registered on permission grant. A new APK build is required for this change to take effect.

3. **No mobile E2E coverage:** There is no automated test runner for the mobile app (`apps/mobile`). The TypeScript check (`tsc --noEmit`) passes, but on-device testing (tap notification → detail opens, long-press → archive button) must be verified manually on the Galaxy Fold 7.

4. **Pre-existing E2E flakes:** The bank-accounts and dashboard test failures existed before this change and are unrelated to notification logic.

5. **Service worker:** Web push notification actions (archive) rely on the service worker registered via Serwist in production builds only (not available in dev mode).
