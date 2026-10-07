# Review — Intelligence Harness

Spec: [docs/specs/intelligence-harness.md](../docs/specs/intelligence-harness.md)

## Verdict: APPROVED WITH NITS

## Checks

| check | result |
|---|---|
| `pnpm test` | 1152 passed, 2 failed, 14 skipped — **both failures pre-existing** (see below) |
| harness suites | 24/24 pass (`harness-context.test.ts`, `harness-reasoner.test.ts`) |
| `pnpm -r run lint` | clean — no new errors, no new warnings |
| `pnpm --filter @ak-system/web build` | pass; `/api/cron/harness-insights` registered as a dynamic route |
| SQLite bootstrap | verified on a fresh DB — the three tables are created by `getDb()` |

### Pre-existing failures, not caused by this change

`voice-large-file.test.ts` (2 tests), `audio-features.test.ts` and `voice-diarization.test.ts`
(collection errors) fail identically with this branch's changes stashed. They are a
`fileManager.deleteFile` mock returning undefined in the voice transcription path, unrelated
to the harness.

## Deviation from the plan — storage backend

The plan specified grag as the world model. `grag` is a CLI at `~/.local/bin/grag` on the
Mac and is not installed in the EC2 Docker image, so that design would have shipped a
dev-only feature.

The world model is therefore in the app database (`harness_nodes`, `harness_edges`,
`harness_insights` in both `schema.pg.ts` and `schema.ts`). grag remains an optional
mirror in [harness-grag.ts](../packages/api/src/services/harness-grag.ts), gated on
`GRAG_DB_PATH` and failure-tolerant. Every other plan item is implemented as written.

## Spec conformance

| acceptance criterion | status |
|---|---|
| Re-index produces no duplicates | pass — deterministic ids, covered by `harness-context.test.ts` |
| Reasoner works without `GEMINI_API_KEY` | pass — covered in `harness-reasoner.test.ts` |
| Every insight carries source attribution | pass — asserted in `reasonAndPersist` test |
| Dismissed insights do not reappear | pass — `persistInsights` leaves `status` untouched on re-fire |
| Morning briefing survives a harness failure | pass — `.catch()` returning `[]`, same shape as the finance block |
| Widget hidden when no open insights | pass — early `return null` |

## Findings

### Nit — N+1 query in `detectSilentBeforeMeeting`

[harness-reasoner.ts:146](../packages/api/src/services/harness-reasoner.ts#L146) issues one
`whatsappDmMessages` query per attendee. Bounded by a 7-day meeting horizon with an open
commitment, so realistically single digits per run on a 6-hourly cron. Worth batching into
one `GROUP BY person_id` if the horizon ever widens.

### Nit — `TRIGGERED_SPEND` is proximity, not causation

[harness-context.ts:378](../packages/api/src/services/harness-context.ts#L378) links every
transaction within 2 days of every meeting, which is O(meetings × transactions) edges. Both
sides are capped at 500 rows and the edge carries `gapDays` as a weight, so the reasoner can
discount it — but the edge name overstates what is actually known. The comment says so.

### Nit — `worldStateSummary` reads full tables

[harness-context.ts:505](../packages/api/src/services/harness-context.ts#L505) selects every
node and edge row to count them in JS rather than using `COUNT(*) GROUP BY`, because the
Drizzle aggregate syntax differs between the pg and sqlite drivers that `getDb()` returns.
Fine at current volume (capped at ~3000 nodes); revisit if the caps are raised.

### Observation — shared `resetDb` does not clear finance tables

The first run of `harness-reasoner.test.ts` failed because `financeTransactions` rows leaked
in from an earlier suite. The existing finance suites each clear that table themselves, and
the harness test now follows that convention with a local `resetAll`. The underlying gap in
[test-utils.ts](../packages/api/src/test-utils.ts) is untouched — worth closing separately,
as it will bite the next finance-adjacent suite too.

## Security

- The cron route honours `CRON_SECRET` exactly like its siblings.
- Every tRPC procedure is on `protectedProcedure`.
- `harness-grag.ts` uses `spawn` with an argument array, not a shell string, so indexed
  content cannot inject a command. A 10s timeout with `SIGKILL` bounds a hung binary.
- The Gemini prompt receives only detector output (titles, bodies, severities) — no raw
  WhatsApp text, no transcripts, no transaction descriptions.

## Post-deploy: production bug found and fixed

The first run of `/api/cron/harness-insights` on EC2 failed with
`NOT NULL constraint failed: harness_edges.weight`, even though the full local suite was
green. Cause: production `finance_transactions.transaction_date` stores full ISO timestamps
(`2026-10-05T14:06:10.000Z`), while the test fixtures and `meetings.date` use `YYYY-MM-DD`.
The proximity loop appended `T12:00:00` to the already-timestamped value, producing an
invalid date, so `gapDays` was `NaN`. The guard `gapDays > SPEND_PROXIMITY_DAYS` is false for
`NaN`, so the row was not skipped, and SQLite stores a `NaN` float as `NULL`.

Fix in [harness-context.ts](../packages/api/src/services/harness-context.ts): `dayKey()`
reduces any input to a validated calendar day before `middayMs()` builds a timestamp, the
proximity guard is inverted to `!(gapDays <= ...)` so `NaN` skips, and `writeEdges` coerces a
non-finite weight to `1` at the write boundary. Three regression tests in
`harness-context.test.ts` cover an ISO-timestamp transaction date, an unparseable date, and
the `9999-12-31` sentinel that real meeting rows carry.

Verified on EC2 after redeploy:

```
{"ok":true,"indexed":{"nodes":1731,"edges":2779},"insights":14,"pushed":false,"reason":"no-urgent"}
```

The three `harness_*` tables bootstrapped automatically into `/data/ak_system.sqlite` via
`getDb()` (production runs SQLite, no `DATABASE_URL`), the 6-hourly cron line is present in
the instance crontab, and `GRAG_DB_PATH` is unset so the optional grag mirror stays off in
production.

**Lesson for the next feature:** test fixtures that invent their own date format will not
catch a shape mismatch with whatever the real integrations write. Fixtures for any
scraper-fed column should mirror the production shape.
