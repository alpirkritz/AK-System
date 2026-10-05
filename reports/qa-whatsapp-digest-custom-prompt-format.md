# QA report — whatsapp-digest-custom-prompt-format

**Detected stack:** next-trpc-monorepo
**Verdict:** PASS (targeted)

- Unit tests: 12/12 passed (`whatsapp-daily-digest.test.ts`)
- E2E: not re-run (hint copy only; existing editor test still matches `/חבר שמספר/`)
- Static/lint/build: skipped (no schema/tRPC shape change)

## Notes

Customized prompt now uses `contract: 'freeform'`. Default null prompt still uses JSON + 900-char story renderer. Empty groups still omitted.
