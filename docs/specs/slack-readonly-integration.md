# Slack Read-Only Integration

> **Slug:** `slack-readonly-integration`
> **Status:** Draft
> **Last Updated:** 2026-10-19

## Goal

Connect AK System to the organizational Slack workspace in read-only mode. Selected channels are ingested on arrival (Events API) and stored locally, exactly like WhatsApp groups. The existing commitment-scan, FOMO, Harness, and Hugo tools are extended to operate on Slack data with no changes to their core logic.

## User Stories

- As a user, I want to connect my Slack workspace so commitments from channel conversations surface in `/commitments` alongside WhatsApp and email items.
- As a user, I want a FOMO push notification when a monitored channel spikes with activity.
- As a user, I want `/settings/slack` to let me connect/disconnect, choose channels to monitor, and configure FOMO thresholds per channel.
- As a user, I want Hugo to answer questions about Slack channel activity using the same tools it uses for WhatsApp.
- As a user, I want Harness to include Slack signals when reasoning about reply backlogs and contact warmth.

## Acceptance Criteria

- [ ] OAuth install flow at `/api/slack/oauth` → `/api/slack/oauth/callback` stores bot token and team info.
- [ ] Events endpoint at `/api/slack/events` verifies Slack signing secret, handles `url_verification`, persists `message`, `message_changed`, `message_deleted` for enabled channels only.
- [ ] `slack_connections`, `slack_channels`, `slack_messages` tables exist in both `schema.pg.ts` and `schema.ts`; SQLite bootstrap in `packages/database/src/index.ts`.
- [ ] `slack_channel` added to `COMMITMENT_SOURCES` array in both schema files and all downstream references (labels, badges, `commitmentSourceUrl`).
- [ ] Cron `/api/cron/slack-commitments` scans new messages in enabled channels with Gemini, calls `proposeCommitments`, and pushes notifications when fresh items are found.
- [ ] Harness indexes Slack messages as `slack_signal` nodes; `detectReplyBacklog` counts unanswered Slack DMs (future) and today just counts channels with unread signal.
- [ ] `slack_fomo` notification type is registered and push is sent when channel hits threshold.
- [ ] `/settings/slack` page: connect button (OAuth), channel list with enable/FOMO/keywords toggles, disconnect button; matches `/settings/whatsapp` visual patterns.
- [ ] Middleware bypasses NextAuth for `/api/slack` routes.
- [ ] Disconnecting revokes token via `auth.revoke`, sets `revokedAt`, stops ingest for that team.
- [ ] `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` added to `.env.example`.

## Data Model

### `packages/database/src/schema.pg.ts` and `schema.ts`

**New table `slack_connections`**
```
id TEXT PRIMARY KEY
team_id TEXT NOT NULL UNIQUE
team_name TEXT NOT NULL
bot_token TEXT NOT NULL       -- xoxb-... (store as-is; no at-rest encryption yet, same as google_connections)
bot_user_id TEXT NOT NULL
scopes TEXT NOT NULL           -- comma-separated granted scopes
installed_at TEXT NOT NULL
revoked_at TEXT                -- set on disconnect
updated_at TEXT NOT NULL
```

**New table `slack_channels`**
```
id TEXT PRIMARY KEY
team_id TEXT NOT NULL
channel_id TEXT NOT NULL UNIQUE -- Slack C… / G… id
name TEXT NOT NULL
is_private INTEGER NOT NULL DEFAULT 0
enabled INTEGER NOT NULL DEFAULT 0
fomo_enabled INTEGER NOT NULL DEFAULT 0
fomo_threshold INTEGER NOT NULL DEFAULT 10
fomo_window_minutes INTEGER NOT NULL DEFAULT 5
keywords TEXT NOT NULL DEFAULT '[]'   -- JSON string[]
last_fomo_alert_at TEXT
updated_at TEXT NOT NULL
```

**New table `slack_messages`**
```
id TEXT PRIMARY KEY
team_id TEXT NOT NULL
channel_id TEXT NOT NULL
slack_ts TEXT NOT NULL          -- Slack's "1234567890.123456" format
user_id TEXT NOT NULL
user_name TEXT NOT NULL
text TEXT NOT NULL
thread_ts TEXT                  -- non-null for replies in a thread
ts INTEGER NOT NULL             -- epoch ms for range queries
edited_ts TEXT                  -- set when message was edited
deleted INTEGER NOT NULL DEFAULT 0
created_at TEXT NOT NULL

UNIQUE (channel_id, slack_ts)
INDEX (channel_id, ts)
```

**`COMMITMENT_SOURCES`** — add `'slack_channel'`

**`user_settings`** — add `slackCommitmentScanCursor TEXT` (ms timestamp of newest already-scanned message)

### SQLite bootstrap in `packages/database/src/index.ts`

Add `SLACK_TABLES` constant with `CREATE TABLE IF NOT EXISTS` for the three tables, and run them in the bootstrap sequence.

## tRPC API

Router `slack` registered in `packages/api/src/index.ts` under `appRouter.slack`.

| Procedure | Input | Output | Notes |
|---|---|---|---|
| `slack.getConnection` | — | `{ connected: bool, teamId?, teamName? }` | reads `slack_connections` |
| `slack.disconnect` | — | `{ ok: bool }` | calls `auth.revoke`, sets `revokedAt` |
| `slack.listChannels` | — | `SlackChannel[]` | reads `slack_channels`; also calls Slack API to sync new channels |
| `slack.updateChannel` | `{ channelId, enabled?, fomoEnabled?, fomoThreshold?, fomoWindowMinutes?, keywords? }` | `SlackChannel` | upsert |
| `slack.syncUsers` | — | `{ synced: number }` | calls `users.list`, upserts `person_external_ids` |

All procedures use `protectedProcedure`.

## UI Surface

**Route:** `apps/web/src/app/settings/slack/page.tsx`

- Tab structure (if needed): `connection` | `channels`
- **Connection tab:** "התחבר ל-Slack" button → OAuth redirect; when connected shows team name + "התנתק" button.
- **Channels tab:** list of channels from `slack.listChannels`; per channel: toggle enabled, toggle FOMO with threshold/window inputs, keywords text field, sync users button.
- Design: reuse Toggle component from `/settings/whatsapp`; dark theme; RTL.
- Add "Slack" link in `/settings` nav or sidebar (same pattern as WhatsApp).

## Out of Scope

- DM capture (only channels/groups for now)
- Writing to Slack (no `chat:write`)
- Socket Mode (Events API with HTTPS only)
- Multi-team / Enterprise Grid
- Per-message reactions or file attachments
- Thread-level FOMO (only top-level message count)
- Retention/deletion cron (can be added later like `whatsapp-message-retention`)

## Open Questions

- Should `/api/slack/oauth` be a server-redirect or tRPC mutation? → Use a plain Next.js route (same as Google Calendar OAuth).
- Encryption of bot token at rest? → Match current pattern: stored plain like Google tokens, can add AES later.
