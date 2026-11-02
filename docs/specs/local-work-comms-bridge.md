# Local Work-Comms Bridge (Slack / Outlook mail / Teams)

> **Slug:** `local-work-comms-bridge`
> **Status:** Outlook mail works end-to-end; Slack + Teams chat blocked at the org level
> **Last Updated:** 2026-11-02

## Live verification outcome (2026-11-02)

Tested against the real signed-in sessions on the Mac. The browser-session approach gets
through for the scopes IT permits (calendar, mail) but **not** for messaging:

| Source | Result |
|---|---|
| **Outlook mail** | ✅ Works. Pulled 377 real messages via the OWA token (`/me/messages`). Only surfaces value once work colleagues exist as contacts with their work email — matching is identical to Gmail (`syncEmailThreads`). |
| **Slack** | ❌ Blocked. Workspace is Enterprise Grid (team `E01302J69EV`, "Yum Brands"). The web `xoxc` token authenticates (`auth.test` ok) but `users.conversations` → `enterprise_is_restricted` — the admin locks the client conversation APIs. |
| **Teams** | ❌ Blocked. The Teams web Graph token authenticates (`/me` returns the profile) but `/me/chats` → **403** — the token has no `Chat.Read` scope. Teams chats live behind an internal messaging service, and the documented Graph path needs admin-consented app permissions IT withholds. |

**Conclusion:** ship Outlook mail. Slack and Teams code is kept but off by default
(`WORK_BRIDGE_SOURCES` opt-in); they can only be unblocked by a Yum/Pizza Hut admin.

## EC2 delivery (the point: the server must receive the data)

The bridge runs on the Mac (sessions are device-bound) and **forwards** rows to the
production app over HTTP — same split as the WhatsApp bridge — so EC2 persists and runs the
commitment scan (where the Gemini keys and the source-of-truth DB live). With no target URL
it falls back to writing the local SQLite (dev only).

- Server: `packages/api/src/services/work-comms-ingest.ts` (`ingestWorkMail`, `ingestWorkTeams`).
- Routes: `POST /api/work-comms/mail/ingest`, `POST /api/work-comms/teams/ingest` — Bearer `WORK_COMMS_BRIDGE_SECRET` (`apps/web/src/lib/work-comms-auth.ts`). Middleware already passes `/api/*` through.
- Bridge env (on the Mac): `WORK_COMMS_TARGET_URL=https://<ngrok-domain>` + `WORK_COMMS_BRIDGE_SECRET`; EC2 needs the same `WORK_COMMS_BRIDGE_SECRET` in `deploy/production.env`.

## Deploy checklist
1. Set `WORK_COMMS_BRIDGE_SECRET` (same value) in `apps/web/.env.local` **and** `deploy/production.env`.
2. Set `WORK_COMMS_TARGET_URL` (the ngrok prod URL) in `apps/web/.env.local`.
3. `pnpm deploy:ec2` — ships the ingest routes.
4. `bash scripts/install-work-comms-bridge.sh` — schedules the Mac bridge every 15 min.
5. For mail to surface value: make sure work colleagues exist as people with their work email.

## Implementation (2026-11-02)

All three sources ingest into the local SQLite and feed the existing commitments/archive
pipeline. Token capture rides the signed-in sessions, so it needs a one-time interactive
login per source and a first live run on the real DB — neither can be done headless.

**Files**
- `scripts/owa-session.ts` — shared OWA/browser token capture + REST getter (reused by mail & Teams). 9 unit tests.
- `scripts/owa-mail-source.ts` — Outlook mail → `EmailFetcher` feeding `syncEmailThreads` (no new table; rides `person_email_threads` + `email` commitments). 8 tests.
- `scripts/slack-local-source.ts` — harvests the Slack *web* token (`localConfig_v2`), pulls `conversations.history` into the existing `slack_messages` store + `scanSlackCommitments`. 7 tests.
- `scripts/teams-chat-source.ts` — Graph `/me/chats` + `/messages` over the Teams web session. 8 tests.
- `packages/api/src/services/teams.ts` — `teams_chats`/`teams_messages` storage + `scanTeamsCommitments` (mirrors the Slack scan; resolves people by email then name).
- Schema: `teams_chats`, `teams_messages`, `teams_chat` commitment source, `user_settings.teams_commitment_scan_cursor` in `schema.pg.ts` + `schema.ts` + runtime bootstrap.
- `scripts/work-comms-sync.ts` — bridge entry; runs `WORK_BRIDGE_SOURCES` (default `outlook-mail,slack,teams`), each guarded so one failure never aborts the rest.
- `scripts/{owa,slack,teams}-login.ts` — one-time interactive sign-in per source.
- `scripts/work-comms-bridge-run.sh`, `scripts/install-work-comms-bridge.sh`, `deploy/launchd/com.ak.work-comms-bridge.plist` — the launchd agent (every 15 min).

**QA:** 32 new unit tests pass; full API suite 1469/1469; web build + lint clean; Teams tables + cursor verified created by the runtime bootstrap.

**One-time setup (Alpir, interactive):**
```
pnpm exec tsx scripts/owa-login.ts     # Outlook mail (shares the calendar bridge profile)
pnpm exec tsx scripts/slack-login.ts   # Slack web
pnpm exec tsx scripts/teams-login.ts   # Teams web
pnpm exec tsx scripts/work-comms-sync.ts   # first live run — confirms tokens + the Teams audience (open question #2)
bash scripts/install-work-comms-bridge.sh  # schedule it every 15 min
```

**Not built (deferred):** the `/settings` "work channels" status card + `workBridge.status` /
`teams.listChats` tRPC (Open Question area). Data already surfaces through `/commitments`,
people email history, and Hugo; the launchd log is the status source until the card lands.

## Goal

Pull the Dragontail/Pizza Hut work conversations — Slack channels, Outlook (Microsoft 365) email, and Teams chats — into AK System so the commitments and relationship signals living in those channels surface alongside WhatsApp and calendar data. IT's Conditional Access blocks every *application* path into the tenant (OAuth apps, Graph device-code, EWS, public Events webhooks), so this bridge reuses the **already-signed-in browser/desktop sessions on Alpir's Mac**, exactly as the existing Outlook *calendar* bridge does, and runs locally on a cron (launchd) rather than from EC2.

This is the "same brain, more inputs" play: no new product surface is strictly required — the win is feeding three new sources into the existing `commitments` / Harness / Hugo pipeline.

## Why a local bridge (not the cloud)

The shipped `com.ak.outlook-bridge` launchd agent already proves the pattern (`reports/outlook-bridge-alternative-access.md`):

- A signed-in OWA browser session is permitted by Conditional Access where applications are not.
- `scripts/owa-calendar-source.ts` drives a persistent Chromium profile, captures the token OWA itself mints for `aud=https://outlook.office.com`, and reads the documented Outlook REST v2.0 API — real JSON over a supported endpoint, not DOM scraping.
- It runs in the logged-in user's TCC context via launchd (`scripts/install-outlook-bridge.sh`), every 15 min, and writes into the **same local SQLite** the web app reads.

This spec extends that exact mechanism to three more read surfaces. The cloud EC2 box can never hold these sessions (Conditional Access binds them to the managed device), so ingestion stays local and only the *data* reaches the app DB.

## Scope of this spec

Three independent sources, each shippable on its own. Recommend building in this order (lowest risk → highest):

1. **Outlook mail** — reuses the existing OWA session/token; just a new REST endpoint (`/me/messages`). Smallest, highest-confidence.
2. **Slack channels** — local-session variant of the already-specced `slack-readonly-integration`, replacing the OAuth+Events-webhook half with a locally-harvested token.
3. **Teams chats** — Teams web session → Graph `/me/chats`; most uncertain (token audience, throttling).

## User Stories

- As Alpir, I want commitments I made or received over work email, Slack, and Teams to appear in `/commitments` with the right source badge, so nothing promised in a work channel is lost.
- As Alpir, I want Harness / the morning brief / meeting prep to read these work channels when judging reply backlog and who needs a 1:1, so "last contact" is correct across every channel (the `relationship-needs-1on1` work already expects this).
- As Alpir, I want Hugo to answer questions about recent Slack/Teams/work-email threads using the same tools it uses for WhatsApp.
- As Alpir, I want the whole thing to run quietly on my Mac on a schedule, surviving session expiry with a clear "re-sign-in" signal, with no credentials stored by the code.

## Acceptance Criteria

### Shared
- [ ] One launchd agent (`com.ak.work-comms-bridge`) installed by `scripts/install-work-comms-bridge.sh`, runs every 15 min in the user session, logs to `~/.ak-system/work-comms-bridge.log`.
- [ ] Each source is independently toggleable via env (`WORK_BRIDGE_SOURCES=outlook-mail,slack,teams`); a failing source never aborts the others.
- [ ] All three write only into local SQLite (`DATABASE_PATH`); no message body ever leaves the Mac except into the app's own DB.
- [ ] Session expiry fails loudly with the exact re-auth command in the log **and** raises an in-app `work_bridge_session_expired` notification (addresses nit #4 of the calendar-bridge review).
- [ ] No credential or token is persisted by shipped code; sessions live only in the Chromium profiles / desktop app stores outside the repo.
- [ ] Ingest is idempotent (unique keys per source); re-running does not duplicate.

### Outlook mail
- [ ] New `scripts/owa-mail-source.ts` captures the existing `outlook.office.com` token (reuse `~/.ak-owa-profile`) and reads `/api/v2.0/me/messages` for the last `OUTLOOK_MAIL_DAYS_BACK` (default 30) days, metadata + `bodyPreview` only (parity with Gmail's snippet-only policy in `email-sync.ts`).
- [ ] Messages map onto the existing `personEmailThreads` archive where the sender/recipient matches a known person (reuse `knownEmailAddresses`, `learnAlias`), so the people-page email history gains work mail with no new table.
- [ ] A commitment scan (`/api/cron`-free; runs in the bridge or a thin cron like `whatsapp-commitments`) feeds work-mail threads through `proposeCommitments` with `source='email'` (existing source reused; no schema change).

### Slack
- [ ] Token acquired locally (see Open Questions for method) and verified with `auth.test`; stored transiently in the bridge process only.
- [ ] Reuses the `slack_connections` / `slack_channels` / `slack_messages` tables and `slack_channel` commitment source **already defined** in `docs/specs/slack-readonly-integration.md` — this spec changes only *how the token and messages arrive* (local pull via `conversations.history` on enabled channels) instead of OAuth + Events webhook.
- [ ] `/settings/slack` channel-enable UI from that spec is reused as-is; the "connect" button is replaced by a "locally connected" status read from the bridge's last successful run.
- [ ] Per-channel incremental cursor (newest `slack_ts` seen) so each run pulls only new messages.

### Teams
- [ ] New `scripts/teams-chat-source.ts` drives the Teams web session, captures its Graph token, reads `/me/chats` + `/me/chats/{id}/messages` (delta where available) for recent chats.
- [ ] New tables `teams_chats`, `teams_messages` in `schema.pg.ts` + `schema.ts` + SQLite bootstrap, modelled on `slack_*`.
- [ ] `teams_chat` added to `COMMITMENT_SOURCES` with label/badge/`commitmentSourceUrl` (deep-link to the Teams chat) in both schema files and `commitments.ts`.
- [ ] Commitment scan over new Teams messages via `proposeCommitments`.

## Data Model

### Reused, no change
- `personEmailThreads` (Outlook mail rides the existing email archive).
- `slack_connections`, `slack_channels`, `slack_messages` (from `slack-readonly-integration` spec — build those tables as part of the Slack slice).
- `COMMITMENT_SOURCES` already contains `email` and `slack_channel`.

### New — Teams only (`schema.pg.ts` + `schema.ts` + bootstrap in `packages/database/src/index.ts`)

**`teams_chats`**
```
id TEXT PRIMARY KEY            -- Graph chat id
topic TEXT                     -- group topic, null for 1:1
chat_type TEXT NOT NULL        -- oneOnOne | group | meeting
member_names TEXT NOT NULL     -- JSON string[]
enabled INTEGER NOT NULL DEFAULT 1
last_message_at INTEGER
updated_at TEXT NOT NULL
```

**`teams_messages`**
```
id TEXT PRIMARY KEY            -- Graph message id
chat_id TEXT NOT NULL
from_name TEXT NOT NULL
from_email TEXT
text TEXT NOT NULL             -- plain text from body.content, HTML stripped
ts INTEGER NOT NULL            -- epoch ms
deleted INTEGER NOT NULL DEFAULT 0
created_at TEXT NOT NULL

UNIQUE (chat_id, id)
INDEX (chat_id, ts)
```

**`COMMITMENT_SOURCES`** — add `'teams_chat'`.
**`user_settings`** — add `teamsCommitmentScanCursor TEXT`, `workMailCommitmentScanCursor TEXT`.

## tRPC API

Minimal — the bridge writes directly to SQLite; the app mostly reads.

| Procedure | Input | Output | Notes |
|---|---|---|---|
| `workBridge.status` | — | `{ outlookMail, slack, teams: { lastRunAt, ok, messageCount }, sessionExpired: bool }` | reads a `work_bridge_runs` log row (or `user_settings` stamps) |
| `teams.listChats` | — | `TeamsChat[]` | reads `teams_chats` |
| `teams.updateChat` | `{ chatId, enabled }` | `TeamsChat` | mute a chat |

Slack procedures come from the Slack spec; Outlook mail needs none (rides email archive + existing people/commitments reads). All `protectedProcedure`.

## UI Surface

- **`/settings` → new "ערוצי עבודה" (Work channels) card** showing per-source status (last run, OK/expired, message count) from `workBridge.status`, with a short "להתחבר מחדש" (re-sign-in) hint that shows the terminal command when a session is expired.
- Reuse `/settings/slack` channels UI from the Slack spec.
- Teams: a compact chat enable/disable list under the same Work-channels card (dark, RTL, `.card`/Toggle components — UI Designer Agent pass required).
- No new top-level nav; commitments/people/Hugo already render the new sources through existing surfaces.

## Out of Scope

- Sending/replying on any channel (read-only, like the WhatsApp and Slack specs).
- Running any of this from EC2/cloud (Conditional Access forbids it — local only).
- Encryption at rest of the local message store (matches current plain-SQLite posture; can follow later).
- Teams *channel* (team) messages — 1:1 and group chats only for v1.
- Attachments, reactions, files.
- Real-time push; 15-min cron cadence is enough.

## Open Questions

1. **Slack local token** — two options: (a) drive a signed-in Slack **web** session in a Chromium profile (same mechanism as OWA, cleanest, consistent) and harvest the `xoxc` token + `d` cookie it uses; or (b) read the token the **Slack desktop app** keeps in its local leveldb. Recommend **(a)** for consistency with the Outlook bridge and to avoid coupling to Slack desktop's storage format. → *Need Alpir's confirmation before building.*
2. **Teams token audience** — Teams web may mint a token for `graph.microsoft.com` or a Teams-internal resource; needs a short spike to confirm which endpoint the captured token actually authorizes. → resolve in a throwaway probe before the Teams slice.
3. **One shared OWA profile vs. per-source profiles** — Outlook mail reuses `~/.ak-owa-profile`; Slack and Teams each need their own. Confirm naming (`~/.ak-slack-profile`, `~/.ak-teams-profile`).
4. **Is any of this against Dragontail IT policy?** Reusing a personal signed-in session to read one's *own* mail/chats is materially different from installing an unsanctioned app, but Alpir should confirm there's no explicit prohibition before this goes beyond the already-running calendar bridge. → **Alpir to confirm.**
5. **Commitment-scan placement** — run scans inside the bridge process (keeps everything local, no new cron route) or add thin `/api/cron/work-comms-commitments` routes like the Slack spec proposes? Recommend in-bridge for mail/Teams to avoid EC2 touching tenant data; Slack can follow its spec's cron.
