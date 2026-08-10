# QA report — whatsapp-message-time-queries

**Detected stack:** next-trpc-monorepo
**Verdict:** PASS

- Unit tests (`pnpm test`, packages/api): 390/390 passed, 35 files — includes new `whatsapp-time-window.test.ts` (19) and `whatsapp.time-window.test.ts` (7)
- Unit tests (apps/web Vitest): 104/104 passed, 14 files — includes new Hugo tool-argument cases and the bridge-timestamp rendering case
- E2E (`pnpm e2e`): 37 passed, 1 skipped, 9 failed — all 9 failures pre-existing and unrelated (see below). `whatsapp-insights.spec.ts` 3/3 passed
- Build (`pnpm --filter @ak-system/web build`): PASS
- Lint (`pnpm -r run lint`): apps/mobile and apps/whatsapp-bridge `tsc --noEmit` PASS; `apps/web` `next lint` cannot run in this repo state (no ESLint config present, the command drops into its interactive setup prompt) — pre-existing, not introduced here

## Per-phase results

### 1. Unit — packages/api

```
✓ src/lib/whatsapp-time-window.test.ts (19 tests)
✓ src/routers/whatsapp.time-window.test.ts (7 tests)
✓ src/routers/whatsapp.test.ts (7 tests)
  Test Files  35 passed (35)
       Tests  390 passed (390)
```

Range semantics verified against `Asia/Jerusalem`:

| Input | Resolved range | Label |
|---|---|---|
| `window: 'today'` | local midnight → now | היום |
| `window: 'yesterday'` | previous local day, excludes today | אתמול |
| `sinceHour: 14, untilHour: 16` | today 14:00:00.000 → 15:59:59.999 | היום 14:00–16:00 |
| `window: 'yesterday', sinceHour: 22` | yesterday 22:00 → end of yesterday | אתמול מ-22:00 |
| `window: '24h'` | now − 24h → now (unchanged) | 24 השעות האחרונות |

Router-level tests assert the filtered message set (not just the range object): `insights.forGroup` with `yesterday` returns only yesterday's row, hour range returns only the 14:30 row, and `insights.digest` with `yesterday` omits today's message.

### 2. Unit — apps/web

```
✓ src/lib/conversation-engine.whatsapp-summary.test.ts (10 tests)
✓ src/lib/whatsapp-bot.test.ts (6 tests)
  Test Files  14 passed (14)
       Tests  104 passed (104)
```

Covers: `today`/`yesterday` forwarded to `insights.digest`/`forGroup`, hour args anchoring to today when no window is given, string hours coerced, out-of-range hours dropped, invented windows falling back to the default, and second-precision bridge timestamps rendering as `[09.07, 14:30]` (Israel local) instead of 1970.

### 3. E2E

```
✓ e2e/whatsapp-insights.spec.ts — 3 passed
  (includes the new "both window pickers offer calendar-day ranges" test)
```

Full run: 9 failures in `agents-triggers`, `bank-accounts`, `full-flow` (2), `qa-structured` (4), `trading-journal`. Confirmed pre-existing selector/UI drift in unrelated areas — the same list is already documented in `reports/qa-mobile-task-form-reading-list-feedback.md` and `reports/qa-task-workspaces.md`. Example: `trading-journal.spec.ts:12` waits for a `היום` period button on `/finance` that the current WIP finance UI no longer renders. None of these specs touch WhatsApp, the insights router, or the conversation engine.

### 4. Build

`pnpm --filter @ak-system/web build` compiled successfully; `/settings/whatsapp` and `/api/whatsapp/messages/ingest` both present in the route manifest.

## Failures

None attributable to this change.

## Notes

- Rows already persisted with a `Date.now()` fallback timestamp remain wrong; out of scope per spec, and the bridge-side normalization only prevents new ones.
- Hour boundaries are computed as offsets from local midnight, so on the two DST transition days a boundary can be off by an hour (clamped inside the calendar day). Documented in the helper.
