# Code Review: Direct Firebase Push

> **Slug:** `direct-firebase-push`
> **Date:** 2026-08-06
> **Verdict:** APPROVED WITH NITS

## Summary

Migrated ARO mobile push from Expo Push gateway to direct Firebase Admin / FCM. Native device tokens register via `/api/push/fcm/register`; all previous `sendExpoPush` producers now call `sendMobilePush`. Web Push (VAPID) is unchanged.

## UI Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.btn` / `.input` / `.card` utilities (not raw unstyled elements)
- [x] Dark theme colors match palette
- [x] RTL layout preserved
- [x] Mobile layout works
- [x] Focus-visible states present on interactive elements
- [x] Loading / error / empty states handled
- [x] No new CSS frameworks introduced
- [x] Reuses existing components where possible

### Findings
- Must-fix: none
- Nits: Hebrew microcopy now says `ARO (FCM)` / `יומן מסירת פוש (FCM)` — intentional provider clarity, no redesign

## Spec Conformance

- [x] Native FCM token via `getDevicePushTokenAsync`
- [x] `POST`/`DELETE /api/push/fcm/register`
- [x] Firebase Admin from server env only
- [x] `sendMobilePush` fan-out from all former Expo call sites
- [x] Payload: title, body, `data.url`, Android high priority, channel `default`
- [x] Immediate delivery log with provider=`fcm`
- [x] Dead-token prune on unregistered FCM errors
- [x] Missing credentials → error log + count 0 (not false success)
- [x] Legacy Expo tables/endpoints kept as deprecated stubs
- [x] Expo receipt polling removed from task-reminder cron

## Static Checks

| Check | Result |
|---|---|
| `pnpm test` | PASS — 42 files / 465 tests |
| `pnpm --filter @ak-system/mobile lint` (`tsc`) | PASS |
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm -r run lint` | PARTIAL — web `next lint` prompts for ESLint setup (pre-existing; no `.eslintrc`) |

## Findings

### Nits
1. `apps/web/src/lib/expo-push.ts` still re-exports `sendExpoPush` as an alias — fine for one release, remove in cleanup.
2. Operators must set `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` in local + EC2 env and rebuild/reinstall the APK so devices re-register FCM tokens (Expo tokens are not convertible).
3. `scripts/push-doctor.mjs` still talks to Expo receipts — out of scope; update in a follow-up.

### Security
- Firebase private key is env-only; not committed.
- Delivery log masks tokens to last 12 chars.

## Test Coverage

- `packages/api/src/lib/mobile-push.test.ts` — empty set, multicast payload, dead-token prune, missing credentials, body truncation
- `packages/api/src/routers/push.test.ts` — FCM register/unregister/auth + deprecated Expo stub

## Manual follow-up (required for live banners)

1. ~~Add Firebase Admin env vars to `.env.local` and `deploy/production.env`~~ — done 2026-08-06 (service account for `helm-push-969711`)
2. ~~Rebuild APK with `google-services.json`~~ — done
3. ARO → Settings → enable push → שלח בדיקה → expect `fcmSent >= 1` + OS banner

## Post-deploy follow-up — 2026-08-06

### Blocker found and fixed: wrong firebase-admin API surface

Verdict on the original implementation: **CHANGES REQUESTED (now resolved)**.

`packages/api/src/lib/mobile-push.ts` used the legacy namespace API
(`admin.apps`, `admin.credential.cert`). The installed firebase-admin is **v14.2.0**,
whose root export no longer provides `credential` or `apps` — both resolve to
`undefined`, so `getFirebaseMessaging()` threw `TypeError: Cannot read properties of
undefined (reading 'cert')` on every call. `sendMobilePush` caught it, logged
`MissingCredentials`, and returned 0. Push would have silently never worked in
production even with valid credentials.

Fixed by switching to the modular entry points, using a named app to avoid
colliding with any other default app in the process:

- `firebase-admin/app` → `initializeApp`, `getApps`, `getApp`, `cert`
- `firebase-admin/messaging` → `getMessaging`

**Why tests missed it:** `mobile-push.test.ts` mocked `'firebase-admin'` with a
hand-written legacy-shaped object, so the mock satisfied code that the real
package could not. The mock now mirrors v14 by mocking `firebase-admin/app` and
`firebase-admin/messaging` instead — a legacy-namespace regression would now fail.

### Live verification on EC2

| Check | Result |
|---|---|
| `FIREBASE_*` present in container | ✓ project `helm-push-969711` |
| Private key survives Compose `env_file` quoting | ✓ normalizes to valid 29-line PEM, no stray quote |
| Service-account OAuth token mint | ✓ `OAUTH_OK: true` |
| FCM Messaging API reachable with these creds | ✓ rejected a deliberately invalid token with `messaging/invalid-argument` (not a permission/credential error) |
| `pnpm test` after fix | ✓ 465/465 |
| `pnpm --filter @ak-system/web build` | ✓ passed |

`fcm_push_tokens` is still empty — the phone could not register while
`/api/push/fcm/register` was un-deployed. Registration happens on next app launch.

### Second blocker: deploy shipped a stale bundle (`0 FCM` after the fix)

First live test reported `5 PWA + 0 FCM`. The device had registered fine
(`fcm_push_tokens` = 1) and credentials were valid — but the container logged the
*pre-fix* error `Cannot read properties of undefined (reading '0')` (i.e. `admin.apps[0]`)
at 16:19 UTC, eight minutes *after* the 16:11 redeploy.

Root cause is the build-output layout, not the push code:

- `deploy/Dockerfile.runtime` does not build Next. It copies a `.next` built on the Mac
  (line 2: "Next.js is built on the Mac before deploy") and only asserts the directory exists.
- `apps/web/next.config.js:22` sets `useDefaultDist = isDev || AK_DEPLOY_BUILD === '1'`;
  otherwise output goes to `os.tmpdir()/ak-system-next` (a Google Drive workaround).
- The verification build was run as a bare `pnpm --filter @ak-system/web build` with
  `AK_DEPLOY_BUILD` unset, so it did **not** write `apps/web/.next`.
- Both redeploys used `SKIP_LOCAL_BUILD=1`, which skips the script's own
  `AK_DEPLOY_BUILD=1 pnpm build`.

Net effect: `apps/web/.next` still held the 18:08 (pre-fix) build while the rsynced
`packages/api` source was current. The source in the container looked fixed, the running
bundle was not. Confirmed by `BUILD_ID` mtime 18:08 vs source mtime 19:06, and by the
compiled bundle lacking the `ak-mobile-push` app-name marker.

Resolved by redeploying via `SKIP_CI=1 pnpm deploy:ec2` (no `SKIP_LOCAL_BUILD`), which
builds with `AK_DEPLOY_BUILD=1` into `apps/web/.next`. Marker now present in both the
local and in-container bundles.

### Live end-to-end result

Sent a real multicast to the registered device from inside the production container:

```
tokens_found: 1
successCount: 1 failureCount: 0
  [GncyHpCU1-jw] OK id=projects/helm-push-969711/messages/0:1786033759160207%d236722bd236722b
```

### Deploy hazard worth fixing (follow-up)

`SKIP_LOCAL_BUILD=1` combined with the conditional `distDir` lets a deploy silently ship
a stale bundle: the image build only checks that `.next` *exists*, never that it is newer
than the source. Suggested guard — fail the deploy when `apps/web/.next/BUILD_ID` is older
than the newest file under `apps/web/src`, `packages/*/src`. Needs its own spec.

### Corrections to the previous section

- The claim that "type checking ran as part of the successful build" was wrong:
  `next.config.js:26` sets `typescript: { ignoreBuildErrors: true }`. Combined with the
  non-functional lint gate, **no** static type check currently runs in this pipeline.
  `tsc --noEmit` should be added as a real gate.

### Additional nit

`pnpm -r run lint` cannot run: there is no ESLint config anywhere in the repo, so
`next lint` drops into its interactive setup prompt and exits non-zero in CI.
Pre-existing and unrelated to this spec, but it means the lint gate is currently
a no-op. Worth a follow-up.
