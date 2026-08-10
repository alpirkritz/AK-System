# QA — bank-trusted-device-otp

## Scope

Trusted Chromium profile + one-time OTP UI for Hapoalim sync.

## Commands

```bash
pnpm --filter @ak-system/api exec vitest run \
  src/services/bank-otp-bridge.test.ts \
  src/services/bank-sync-service.test.ts \
  src/routers/finance.bank.test.ts
```

## Results

- bank-otp-bridge.test.ts: 6/6 passed
- bank-sync-service.test.ts: 11/11 passed
- finance.bank.test.ts: 8/8 passed

## Notes

- No Chromium launch in unit tests (injected ScrapeFn / bridge helpers only).
- Full e2e OTP against live Hapoalim requires EC2 deploy + manual SMS.
- Lint/build deferred to reviewer gate / deploy.
