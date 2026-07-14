# WhatsApp Group Insights

Detected stack: `next-trpc-monorepo`

## Goal

Persist watched WhatsApp group messages for a rolling 30-day window in the app database, and generate on-demand insights over that history: per-group summary, "what are they discussing", learned-style original insights, and a prioritized cross-group "what's happening now" briefing that ranks groups by importance and links related context across groups.

## User stories

- As the user, I want to ask "מה קורה לי עכשיו בקבוצות הוואטצפ" and get one prioritized briefing across all my watched groups, so that I catch up in seconds.
- As the user, I want to ask what a specific group is discussing over the last day/week, so that I don't have to scroll the chat.
- As the user, I want Hugo to learn the recurring style/tone of a group and add its own observations, so that I get insight beyond a literal summary.
- As the user, I want to mark which groups matter most, so that the briefing prioritizes them.
- As the user, I want old messages purged automatically after 30 days, so that storage stays bounded and private.
- As the user, I want to trigger these insights from the WhatsApp settings screen, so that I have a visual entry point in addition to chatting with Hugo.

## Acceptance criteria

- Given a watched (`enabled`) group receives messages, when the bridge flush runs, then those messages are stored in `whatsapp_messages` (deduped by `wa_message_id` per group).
- Given a group is not `enabled`, when the bridge posts its messages to the ingest endpoint, then nothing is stored.
- Given stored messages exist for a group, when I call `whatsapp.messages.listByGroup` with a time window, then I get the messages in that window ordered by timestamp.
- Given stored messages exist, when I call `whatsapp.insights.forGroup` with `mode: 'summary' | 'topics' | 'style'`, then I get Hebrew insight text and it is saved to `chat_messages` with `source: 'whatsapp'`.
- Given multiple watched groups have recent activity, when I call `whatsapp.insights.digest`, then I get a prioritized Hebrew briefing plus a structured `items[]` array, with higher-`priority`/higher-signal groups surfaced first.
- Given no `GEMINI_API_KEY`, when an insight procedure runs, then it returns a clear error rather than crashing.
- Given the retention cron runs, when messages are older than `WHATSAPP_MESSAGE_RETENTION_DAYS` (default 30), then they are deleted.
- Given a group is deleted, when the delete mutation runs, then its stored messages are also removed.

## Data model

New table `whatsapp_messages` in `packages/database/src/schema.ts` (SQLite), `packages/database/src/schema.pg.ts` (Postgres), and raw DDL in `packages/database/src/index.ts`:

- `id` text PK
- `group_jid` text not null
- `wa_message_id` text not null
- `sender` text not null
- `sender_name` text not null
- `text` text not null
- `ts` integer not null (epoch ms of the message)
- `created_at` text not null (ISO ingest time)
- Index `idx_whatsapp_messages_group_ts` on `(group_jid, ts)`
- Unique index `uq_whatsapp_messages_group_msg` on `(group_jid, wa_message_id)` for idempotent re-ingest

Additive column on existing `whatsapp_groups` (all three files, plus an `ALTER TABLE` for existing SQLite DBs): `priority` integer not null default `0` (0 = normal, 1 = high, 2 = top). Migration is additive only.

## tRPC API

Router file: `packages/api/src/routers/whatsapp.ts` (extend existing `whatsappRouter`). New Gemini service: `packages/api/src/services/whatsapp-insights.ts`.

- `whatsapp.messages.listByGroup` — query. Input `{ groupJid: string, sinceMs?: number, untilMs?: number, limit?: number (<=1000) }`. Auth: `protectedProcedure`. Returns `{ id, sender, senderName, text, ts }[]` ordered by `ts` asc.
- `whatsapp.messages.stats` — query. Input `{ groupJid?: string }`. Returns per-group `{ groupJid, name, count, earliestTs, latestTs }[]`.
- `whatsapp.insights.forGroup` — mutation. Input `{ groupJid: string, window: '24h' | '7d' | '30d', mode: 'summary' | 'topics' | 'style' }`. Reads messages in window, calls `generateGroupInsight`, saves the result to `chat_messages`, returns `{ text, messageCount, mode, window }`.
- `whatsapp.insights.digest` — mutation. Input `{ window?: '6h' | '24h' | '7d' (default '24h') }`. Loads all `enabled` groups' messages in window, computes an importance score per group, calls `generateCrossGroupDigest`, saves to `chat_messages`, returns `{ text, items: { groupJid, name, priority, score, messageCount, topic }[] }`.

Importance score = normalized message volume + keyword-hit count + configured `priority` weight + recency boost. Groups below a low-signal floor are collapsed into a one-line tail in the narrative.

## AI helpers

`packages/api/src/services/whatsapp-insights.ts` (self-contained Gemini, mirrors `feed-summarizer.ts`; reads `GEMINI_MODEL`, default `gemini-2.5-flash`):

- `generateGroupInsight(displayName, messages, mode)` — `summary` (spoken-Hebrew narrative like existing `summarizeGroupMessages`), `topics` (themes/open threads/decisions), `style` (recurring patterns, who drives conversation, tone over the window, plus original observations framed as opinion; "do not invent facts").
- `generateCrossGroupDigest(groups)` — one Gemini call over `{ name, priority, messages }[]`; prompt ranks by importance, links related topics across groups (labels which group each came from), flags items needing a response, ends with a short low-signal tail. Returns `{ text, items }`.

## Ingestion

- Bridge (`apps/whatsapp-bridge`): add an independent per-group persist queue in `src/group-buffer.ts` (separate from the 500-cap FOMO buffer). `src/whatsapp-client.ts` enqueues each watched-group message and runs a flush loop (~60s + before summary) that POSTs batches to the ingest endpoint. New config `AK_MESSAGES_INGEST_URL` (falls back to deriving `/api/whatsapp/messages/ingest` from `AK_WEBHOOK_URL`).
- Web: new route `POST /api/whatsapp/messages/ingest` (`apps/web/src/app/api/whatsapp/messages/ingest/route.ts`), authed via `verifyWhatsAppBridgeAuth`. Body `{ groupJid, groupName?, messages: { id, sender, senderName, text, timestamp }[] }`. Stores only if the group is `enabled` in DB; normalizes `timestamp` to ms; dedupes by existing `wa_message_id`.

## Retention

- New route `POST/GET /api/cron/whatsapp-message-retention` (`apps/web/src/app/api/cron/whatsapp-message-retention/route.ts`), Bearer `CRON_SECRET`, deletes `whatsapp_messages` where `ts < now - WHATSAPP_MESSAGE_RETENTION_DAYS*86400000` (default 30). Add a daily entry to `deploy/crontab.example`.
- Extend `whatsapp.groups.delete` to also delete that group's `whatsapp_messages` by `group_jid`.

## Hugo tools

`apps/web/src/lib/conversation-engine.ts` (declarations in `baseToolDeclarations`, handlers in `executeTool`):

- `query_whatsapp_group` — `{ groupJid?, groupName?, window?, mode? }` → `caller.whatsapp.insights.forGroup` (`topics`/`summary`). Resolves group by name when JID omitted via `caller.whatsapp.groups.list`.
- `whatsapp_group_insights` — `{ groupJid?, groupName?, window? }` → `forGroup` with `style`.
- `whatsapp_now` — `{ window? }` → `caller.whatsapp.insights.digest`.

## UI surface

`apps/web/src/app/settings/whatsapp/page.tsx` — add an "תובנות" tab:

- Top: "מה קורה עכשיו" button + window selector (`6h`/`24h`/`7d`) → `insights.digest`; render `items` (topic, source groups, priority badge) + narrative.
- Below: per-group drill-in — group picker + window (`24h`/`7d`/`30d`) + three buttons (סיכום / על מה מדברים / תובנות בסגנון שלי) → `insights.forGroup`; show `stats` (count, date range).
- Groups tab: add a `priority` selector (רגיל/חשוב/קריטי → 0/1/2) per group, saved through `groups.upsert`.
- Use existing `.card`/`.btn` classes, RTL, dark theme, WhatsApp green accents.

## Compliance / privacy

Storing third-party group message content is PII. Mitigations: single-tenant self-hosted DB, 30-day retention enforced by cron, only `enabled` groups persisted, cascade delete on group removal. Aligns with `C_Core/brand_dna_and_compliance.md` (data minimization, retention limits). No message content is sent anywhere except the existing Gemini calls already used for summaries.

## Out of scope

- Semantic/embedding search (future; plain time-range retrieval only now).
- Persisting non-`enabled` groups, self-chat, or DMs.
- A raw per-message browser UI (aggregate insights only).
- Changing existing FOMO/keyword real-time behavior or the in-memory 500-cap buffer.
- New top-level dependencies.

## Open questions

None.
