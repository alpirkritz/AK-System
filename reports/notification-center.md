# Code Review: In-App Notification Center + Cross-Channel Push

> **Slug:** `notification-center`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-06-30

## Spec Conformance

[`docs/specs/notification-center.md`](../docs/specs/notification-center.md) criteria met:

- `notifications` table in SQLite + Postgres schemas with migration in `packages/database/src/index.ts`
- `createNotification()` wired in fan-out: `push-notifications`, `agent-notifications`, `whatsapp-bot`, group-alert, group-summary
- tRPC `notifications.list`, `unreadCount`, `markRead`
- Web: `NotificationBell` in `DashboardLayout`, `/notifications` page
- Helm: `/notifications` screen, bell + badge in chat toolbar
- `push.sendToAll` + `POST /api/push/test` send Web Push + Expo + persist notification
- Helm settings: permission status + test button
- Vitest: 4 new notification router tests (29/29 API pass)
- E2E: bell + notifications page smoke (6/6 pass)

## Static Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/api run test` | PASS — 29/29 |
| `pnpm --filter @ak-system/web build` | PASS — `/notifications` route included |
| Playwright `e2e/notifications.spec.ts` | PASS — 6/6 |

## Findings

### Must-fix
- None.

### Nits
- `getDb()` opens a new SQLite connection per call; notification inserts via `createNotification()` and reads via tRPC may occasionally race in tests (mitigated in test file).
- Helm has no local `/agents` screen — agent/FOMO push taps route to `/notifications` or `/chat`.

## Deployment Checklist (manual)

### VAPID (Web Push)
```bash
npx web-push generate-vapid-keys
# Add to apps/web/.env.local:
# VAPID_PUBLIC_KEY=...
# VAPID_PRIVATE_KEY=...
# VAPID_EMAIL=mailto:you@example.com
```

### PWA on phone
```bash
pnpm serve   # production build + tunnel
# Install PWA → Settings → הפעל נוטיפיקציות → שלח בדיקה
```

### Helm APK
See [`docs/deploy/railway-production.md`](../docs/deploy/railway-production.md) and [`docs/deploy/helm-apk-build.md`](../docs/deploy/helm-apk-build.md).

### Device QA (Fold 7)
1. Bell shows unread badge after cron/agent/FOMO event
2. `/notifications` lists items; tap navigates; mark all read works
3. OS push arrives on PWA + Helm; tap opens correct screen
4. Helm Settings → שלח בדיקה reports webSent + expoSent
