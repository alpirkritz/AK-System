# Review — bank-trusted-device-otp

## Verdict: APPROVED WITH NITS

## Spec

`docs/specs/bank-trusted-device-otp.md`

## UI/UX Review

- **Verdict:** APPROVED WITH NITS
- Inline OTP block on Accounts card uses `.input` / `.btn` / amber status pill; Hebrew copy matches spec.
- Polling while `awaiting_otp` / sync in flight is appropriate.
- Nit: OTP form is inline (not modal) — acceptable for urgency during long sync.

## Spec conformance

- [x] Persistent `--user-data-dir` per connection under data volume
- [x] `awaiting_otp` status + Hebrew pill
- [x] `finance.bankConnections.submitOtp`
- [x] Redirect wait extended for OTP entry window (~3 min)
- [x] Unit tests for bridge + profile path + submitOtp rejection

## Findings

1. **Nit:** OTP fill heuristics are best-effort; if Hapoalim changes DOM, sync may still timeout after code submit — log page URL on failure in a follow-up if needed.
2. **Nit:** `submitOtp` only works in the same Node process as the running scrape (correct for single EC2 container; document if ever multi-replica).
3. **Info:** Bank may still re-challenge OTP despite profile (bank policy) — called out in spec out-of-scope.

## Security

- Credentials remain encrypted; OTP is transient (not stored).
- Profile dir holds bank session cookies — lives on encrypted volume path under `/data`; treat like secrets on disk.

## Static checks

- Targeted Vitest: 25/25 bank-related passed.
- Full `pnpm -r run lint` + web build not re-run in this pass (prior bank deploys used same stack); recommend before/at deploy.
