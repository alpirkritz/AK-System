# WhatsApp message time-aware queries

Detected stack: `next-trpc-monorepo`

## Goal

Let Hugo answer time-anchored questions about stored WhatsApp group messages — "מה היה היום בקבוצה", "מה נכתב בין 14 ל-16", "מה היה אתמול" — by resolving calendar days and hour ranges in `Asia/Jerusalem` instead of only rolling `6h/24h/7d/30d` windows, and by showing the model local Israel clock times.

## User stories

- As Alpir, I want "סכם לי מה היה היום בקבוצה X" to cover today from local midnight until now, so a 09:00 question does not pull in yesterday evening.
- As Alpir, I want "מה היה אתמול בקבוצות" to cover only yesterday's calendar day, so the answer is not smeared across a rolling 24h window.
- As Alpir, I want "מה נכתב בין 14 ל-16" to restrict retrieval to that local hour range, so the answer is about that slice only.
- As Alpir, I want the summary text to reference correct Israel clock times, so hours in the answer match what I saw on my phone.
- As Alpir, I want the WhatsApp settings insights tab to offer "היום" and "אתמול" windows, so I can reproduce the same query from the UI.
- As Alpir, I want messages arriving with WhatsApp second-precision timestamps to be stored and summarized as milliseconds everywhere, so no message lands in 1970 or at ingest time.

## Acceptance criteria

- Given stored messages with correct `ts`, when Hugo calls a WhatsApp tool with `window: 'today'`, then the query range is `[local midnight today, now]` in `Asia/Jerusalem`.
- Given `window: 'yesterday'`, when the query runs, then the range is `[local midnight yesterday, local midnight today)` — messages from today are excluded.
- Given `sinceHour: 14, untilHour: 16` with no window, when the query runs, then the range is today's 14:00:00.000 through 15:59:59.999 local.
- Given `window: 'yesterday', sinceHour: 22`, when the query runs, then the range is yesterday 22:00 through yesterday 23:59:59.999 local.
- Given `window: '24h'` (existing behavior), when the query runs, then the range stays `[now - 24h, now]` and current callers keep working unchanged.
- Given messages in range, when the insight prompt is built, then each line shows the time formatted with `timeZone` = `TIMEZONE` env or `Asia/Jerusalem`, and the prompt states the covered range.
- Given a bridge message whose `messageTimestamp` is in seconds, when it is buffered and later summarized by the cron/bridge path, then the rendered time is the real message time (not 1970 and not ingest time).
- Given the WhatsApp settings insights tab, when the user picks "היום" and runs digest or a per-group insight, then the request carries `window: 'today'` and the result's heading line states the covered range.
- `pnpm test`, `pnpm e2e`, `pnpm -r run lint` and `pnpm --filter @ak-system/web build` pass.

## Data model

No schema change. `whatsapp_messages.ts` (epoch ms) in both `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts` already stores message time and is indexed by `(group_jid, ts)`. No migration.

## tRPC API

Router: `packages/api/src/routers/whatsapp.ts` (existing).

New shared helper: `packages/api/src/lib/whatsapp-time-window.ts`

- `WHATSAPP_WINDOWS = ['6h','24h','7d','30d','today','yesterday']`
- `resolveWhatsappTimeWindow(input, nowMs?, timeZone?) => { sinceMs, untilMs, window, rangeLabel }`
  - `input`: `{ window?, sinceHour?, untilHour?, sinceMs?, untilMs? }`
  - explicit `sinceMs`/`untilMs` win over named windows
  - `sinceHour`/`untilHour` (0–24 ints) anchor to `today` unless `window` is `yesterday`
  - `rangeLabel` is Hebrew, e.g. `היום 14:00–16:00`, `היום`, `אתמול`, `24 השעות האחרונות`
- `normalizeWhatsappTs(raw)` — seconds/ms → ms, invalid → `Date.now()` (single canonical normalizer, also used by the ingest route)

Changed procedures (input shape additions are all optional, so existing calls are unaffected):

- `whatsapp.insights.forGroup` — `mutation`
  - input: `{ groupJid: string, window?: enum(WHATSAPP_WINDOWS) = '7d', mode?: 'summary'|'topics'|'style' = 'summary', sinceHour?: int 0..23, untilHour?: int 1..24 }`
  - filter: `ts >= sinceMs AND ts <= untilMs`
  - return: `{ text, messageCount, mode, window, rangeLabel, sinceMs, untilMs }`
- `whatsapp.insights.digest` — `mutation`
  - input: `{ window?: enum(WHATSAPP_WINDOWS) = '24h', sinceHour?, untilHour? }`
  - filter: `groupJid IN (enabled) AND ts >= sinceMs AND ts <= untilMs`
  - group scoring recency is measured against `untilMs` (end of range) rather than `Date.now()`
  - return: `{ text, items, window, rangeLabel, sinceMs, untilMs }`
- `whatsapp.messages.listByGroup` — unchanged (already accepts `sinceMs`/`untilMs`)

Auth: unchanged, all on `protectedProcedure`.

## UI surface

- `apps/web/src/app/settings/whatsapp/page.tsx` (insights tab): digest window select gains `היום` / `אתמול`; per-group insight window select gains `היום` / `אתמול`. Both keep existing rolling options and the current `.card` / select styling, and get an `aria-label`.
- Result text starts with a heading line stating the covered `rangeLabel` (server-generated, so the same range is visible in the chat timeline). The per-group block adds a caption with the number of messages found in the range.
- Changing the per-group window clears a stale insight so the shown text always matches the selected range.

## Agent surface

`apps/web/src/lib/conversation-engine.ts`

- Tool declarations for `summarize_whatsapp_groups`, `whatsapp_now`, `query_whatsapp_group`, `whatsapp_group_insights` accept `window` values `6h|24h|7d|30d|today|yesterday` plus numeric `sinceHour` / `untilHour`.
- Descriptions state the Hebrew mapping: "היום" → `today`, "אתמול" → `yesterday`, "בין X ל-Y" → `sinceHour`/`untilHour`.
- System instruction gains one line telling the model to use `today`/`yesterday`/hour args for time-anchored WhatsApp questions instead of rolling windows.
- Tool results include `rangeLabel` so the reply can state the covered range.

## Bridge / ingest hardening

- `apps/whatsapp-bridge/src/whatsapp-client.ts`: normalize `msg.messageTimestamp` seconds → ms at capture (same rule as `messageAgeMs`) before buffering/enqueueing.
- `apps/web/src/lib/whatsapp-bot.ts` `summarizeGroupMessages`: normalize seconds → ms and format with the Israel timezone, matching the FOMO path.
- `apps/web/src/app/api/whatsapp/messages/ingest/route.ts`: use the shared `normalizeWhatsappTs`.

## Out of scope

- Backfilling or repairing rows already stored with a `Date.now()` fallback timestamp.
- Semantic/keyword search over message history.
- Any schema/column change or migration.
- Arbitrary date ranges beyond today/yesterday (e.g. "בשבוע שעבר ביום שלישי") and cross-day hour ranges.
- Changing the bridge in-memory FOMO buffer flow or the scheduled `whatsapp-group-summary` cron source.
- Per-group timezone; a single system timezone is assumed.

## Open questions

None.
