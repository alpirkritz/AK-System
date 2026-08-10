# Review — whatsapp-message-time-queries

**Detected stack:** next-trpc-monorepo
**Spec:** [docs/specs/whatsapp-message-time-queries.md](../docs/specs/whatsapp-message-time-queries.md)
**QA:** [reports/qa-whatsapp-message-time-queries.md](qa-whatsapp-message-time-queries.md) · [reports/qa-ui-whatsapp-message-time-queries.md](qa-ui-whatsapp-message-time-queries.md)
**Verdict:** APPROVED

## What the bug actually was

Not a missing column. `whatsapp_messages.ts` already stores epoch ms and is indexed on `(group_jid, ts)` ([packages/database/src/schema.ts:591](../packages/database/src/schema.ts)). Two real defects made time questions unanswerable:

1. Every agent-reachable procedure computed `sinceMs = Date.now() - WINDOW_MS[window]` with `window` limited to `6h|24h|7d|30d`, so "היום" and "בין 14 ל-16" had no representable range and silently degraded to a rolling window. `messages.listByGroup` already supported `sinceMs`/`untilMs` but no tool called it.
2. Prompt lines used `toLocaleString('he-IL')` with no `timeZone`, so on the UTC EC2 box the model saw Israel times shifted by 2–3 hours ([packages/api/src/services/whatsapp-insights.ts:63](../packages/api/src/services/whatsapp-insights.ts)).

## Spec conformance

| Requirement | Status |
|---|---|
| `today` = local midnight → now | Met — [whatsapp-time-window.ts:117](../packages/api/src/lib/whatsapp-time-window.ts) |
| `yesterday` excludes today | Met — upper bound is `dayEnd - 1` |
| `sinceHour`/`untilHour` local hour range | Met, exclusive end, clamped inside the day |
| Existing rolling windows unchanged | Met — `24h` still `now - 24h → now`; old callers/tests pass untouched |
| Prompts in Israel local time + stated range | Met — `formatLines` sets `timeZone`; `rangeLabel` injected into both prompt builders |
| Bridge seconds → ms at capture | Met — [whatsapp-client.ts:88](../apps/whatsapp-bridge/src/whatsapp-client.ts) `messageTimestampMs`, reused by `messageAgeMs` |
| Single canonical normalizer | Met — ingest route now calls `normalizeWhatsappTs`, its local `toEpochMs` deleted |
| Settings offers היום / אתמול | Met — both selects, with `aria-label` |
| No schema change | Met — no migration, no new column |

## Findings

1. `apps/web/src/lib/conversation-engine.ts:33` duplicates the window list instead of importing `WHATSAPP_WINDOWS`. Deliberate: two existing suites mock `@ak-system/api` with an explicit factory, so importing there breaks them for no behavioral gain. Zod on the server remains the real validator, and the comment points at it. Accepted as-is.
2. `whatsapp-time-window.ts:127` adds hour offsets to local midnight, so a DST-transition day can shift an hour boundary by one hour. Bounded by the `clamp` to the calendar day and documented in the function's doc comment. Acceptable for message retrieval.
3. `digest` recency scoring now uses `range.untilMs` instead of `Date.now()` ([whatsapp.ts:556](../packages/api/src/routers/whatsapp.ts)) — required, otherwise every past range scored `recencyBoost = 0` and group ordering became volume-only.
4. Digest heading picks "מה היה בקבוצות" vs "מה קורה עכשיו בקבוצות" from the requested window rather than from wall-clock drift, so the title cannot flip based on how long Gemini took.

## Security / privacy

No change to auth (all procedures stay `protectedProcedure`), no change to the ingest gate that only persists messages for `enabled` groups, no new logging of message content. Hour/window inputs are integer-bounded by Zod and clamped again in the resolver, so they cannot widen a query beyond one calendar day.

## Gates

- `pnpm test` (packages/api): 390/390 pass
- `apps/web` Vitest: 104/104 pass
- `pnpm e2e`: `whatsapp-insights.spec.ts` 3/3 pass; 9 unrelated pre-existing failures (finance/dashboard selector drift) documented in the QA report
- `pnpm --filter @ak-system/web build`: pass
- `pnpm -r run lint`: mobile + bridge `tsc --noEmit` pass; `apps/web` `next lint` has no ESLint config in this repo state and drops into its interactive setup prompt — pre-existing, unrelated to this change

## Follow-ups (not blocking)

- Rows persisted earlier with a `Date.now()` fallback timestamp are still wrong; a one-off repair would need the bridge's original message ids.
- Ranges beyond today/yesterday ("ביום שלישי שעבר") and cross-midnight hour ranges remain unsupported by design.
