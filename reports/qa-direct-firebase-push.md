# QA: Direct Firebase Push

> **Slug:** `qa-direct-firebase-push`
> **Date:** 2026-08-06
> **Verdict:** PASS (unit) — manual Android banner verification still required

## Commands

```bash
pnpm test
pnpm --filter @ak-system/mobile lint
pnpm --filter @ak-system/web build
```

## Results

| Suite | Result |
|---|---|
| API Vitest | 465/465 passed |
| Mobile `tsc` | passed |
| Web build | passed |
| Playwright e2e | not run — no e2e assertions tied to Expo/`expoSent` labels |

## Notes

- Firebase Admin is mocked in unit tests; no live Firebase calls.
- Live acceptance needs Firebase env on the server + fresh APK re-registration.

## Second pass — 2026-08-06 (post-credential deploy)

Credentials for `helm-push-969711` were installed on EC2 and a live credential
probe was run inside the running container. It exposed a defect the mocked unit
tests could not see: firebase-admin v14 has no `admin.credential` / `admin.apps`,
so the original namespace-style init always threw and `sendMobilePush` returned 0.
See `reports/direct-firebase-push.md` for details and the fix.

| Suite / check | Result |
|---|---|
| API Vitest (after fix) | 465/465 passed |
| Web build (after fix) | passed |
| Container env — `FIREBASE_*` | present; key normalizes to a valid 29-line PEM |
| Service-account OAuth mint | succeeded |
| FCM Messaging API with these creds | reachable; invalid-token probe rejected as `messaging/invalid-argument` |
| `pnpm -r run lint` | cannot run — no ESLint config in repo, `next lint` prompts interactively (pre-existing) |
| Playwright e2e | not run — no e2e coverage tied to push provider labels |

### Test-quality finding

The unit-test mock was written to match the implementation rather than the real
dependency, which let a fatal API mismatch pass as green. The mock now mirrors the
installed v14 module layout (`firebase-admin/app`, `firebase-admin/messaging`).

### Third pass — live delivery confirmed

Device registration succeeded (`fcm_push_tokens` = 1). The first live test still showed
`5 PWA + 0 FCM` because the deploy shipped a pre-fix `.next` bundle — see
`reports/direct-firebase-push.md` for the full root cause (Mac-built `.next` +
conditional `distDir` + `SKIP_LOCAL_BUILD=1`).

After redeploying with a proper `AK_DEPLOY_BUILD=1` build:

| Check | Result |
|---|---|
| Fixed code present in deployed bundle | ✓ `ak-mobile-push` marker in container `.next` |
| Live multicast to registered device | ✓ `successCount: 1, failureCount: 0` |
| FCM message id | `0:1786033759160207%d236722bd236722b` |

### Gate gaps found

- `typescript: { ignoreBuildErrors: true }` — `next build` does not type-check.
- `next lint` has no config and prompts interactively.

Together these mean the pipeline currently has **no** static analysis gate. Adding
`tsc --noEmit` plus an ESLint config should be specced separately.
