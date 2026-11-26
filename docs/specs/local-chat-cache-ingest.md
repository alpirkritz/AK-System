# Slack + Teams from the desktop apps' local cache

> **Slug:** `local-chat-cache-ingest`
> **Status:** Approved (Slack); Teams gated on the access grant + spike
> **Last Updated:** 2026-11-25
> **Supersedes the Slack/Teams half of:** `local-work-comms-bridge` (Outlook mail half stays as is)

## Implementation status (2026-11-25)

**Built (Slack):**
- Decoder and bridge source: `scripts/slack-cache-source.ts`, wired into
  `scripts/work-comms-sync.ts` as `slack-cache`. The default sources are now
  `outlook-mail,slack-cache`.
- Server:
  - `packages/api/src/services/slack-cache-ingest.ts`: members, auto-link, conversations,
    messages, scan;
  - route `POST /api/work-comms/slack/ingest`.
- Scan (`scanSlackCommitments`):
  - works without an OAuth row;
  - Alpir's own lines go to the classifier as "אני";
  - each commitment is attributed to its sender, and Alpir's own promises go to the DM
    counterpart or the last other speaker;
  - the first scan only looks back 14 days.
- People: `slack_members` plus `person_external_ids(provider='slack')`. Linking runs through
  the `slack.listMembers / linkMember / createPersonFromMember / unlinkMember / ignoreMember`
  procedures, and unknown Slack senders on התחייבויות link through the Slack identity.
- UI: `/settings/slack` gets a cache status card, conversations grouped as DMs / group DMs /
  channels, and an "אנשים מסלאק" tab.
- Live run on the real cache (copy of the dev DB): 90 members, 22 auto-linked, 68
  conversations (42 DMs, 11 group DMs, 5 enabled channels), 702 messages stored, 6
  commitments.

**Not built yet:**
- Slack DM on the person page, and DM summaries with the `channel` column.
- The Hugo tool for Slack DMs.
- Slack contact in "last contact" / needs-a-1:1.
- `work_bridge_runs`, the "ערוצי עבודה" status card, and the `work_bridge_cache_unreadable`
  notification. The launchd log is the status source for now.
- Teams phase 2, which waits on the Full Disk Access grant.

## Goal

Get Slack and Teams messages into AK System even though IT blocks every API, by reading
what the **desktop apps already store on the Mac**. Both apps show messages offline, so the
messages sit on disk. The bridge reads those files read-only, sends new messages to EC2, and
the existing commitment scan turns "can you do X" into a proposed commitment / task.
That closes the loop on work requests that arrive in Slack or Teams.

## Why the earlier attempt failed, and why this one doesn't

`local-work-comms-bridge` used the web session tokens: Slack returned
`enterprise_is_restricted` and Teams Graph returned 403 (no `Chat.Read`). Both are blocks on
the **server API**. This spec makes no network call to Slack or Microsoft. It only reads
files the desktop apps wrote to the user's own disk.

## Probe results (2026-11-25, on Alpir's Mac)

| Source | Where | Finding |
|---|---|---|
| **Slack desktop** | `~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob/1/<xx>/<id>` | ✅ **Works.** One ~1.5 MB blob, rewritten minutes ago, holds the app's whole `reduxPersistence` snapshot. Format: 3-byte Chromium IDB header → Snappy → Blink envelope (`ff 15` + padding) → V8 serialized object (V8 format v16). Decoded: **1,154 messages in 68 conversations (25 channels, 43 DMs)**, newest today. The object also has `members` (names, emails), `channels` (names), `threadMetadata`, `unreadCounts`. Message fields: `ts, channel, user, text, thread_ts, reply_count, subtype, files, blocks…` |
| **Teams (new, `com.microsoft.teams2`)** | `~/Library/Containers/com.microsoft.teams2/Data/Library/Application Support/Microsoft/MSTeams/EBWebView/WV2Profile_tfw/IndexedDB/https_teams.microsoft.com_0.indexeddb.leveldb` (expected) | ⚠️ **Not verified.** macOS "App Data" protection blocked the read (the `ls` hung on a privacy prompt). Known layout for new Teams: a LevelDB IndexedDB with conversation and reply-chain stores; message bodies are HTML inside V8-serialized values. Needs the access grant below and a short spike. |

**What the Slack cache does and doesn't hold:** it's what the client has loaded, not full
history. It covers DMs and channels you've opened recently, and older messages roll off.
Polling every 15 min and keeping what we've seen (idempotent on `channel + ts`) collects
everything that passes through the app. That's enough for "someone asked me something".

## User stories

- As Alpir, when someone asks me in a Slack DM or channel to do something, I want it in
  `/commitments` as a proposal (owner `me`, source badge Slack, link back to the message), and
  one tap makes it a task.
- As Alpir, when I promise something in Slack or Teams, or someone promises me something, I
  want it tracked the same way as WhatsApp (`me` / `them`).
- As Alpir, I want Hugo, the morning brief and the person page to know about recent Slack/Teams
  contact, so "last contact" and "needs a 1:1" count work chat too.
- As Alpir, I want this to run quietly on my Mac, not need the Slack/Teams app to be open or
  closed, and tell me clearly when it stops working (cache format changed, or no access).

## Acceptance criteria

### Shared bridge
- [ ] `scripts/work-comms-sync.ts` gets two new sources, `slack-cache` and `teams-cache`, and
      the default `WORK_BRIDGE_SOURCES` becomes `outlook-mail,slack-cache,teams-cache`. The old
      token sources `slack` and `teams` stay as opt-in only.
- [ ] Read-only: the bridge copies the needed files to a temp dir and reads the copy. It never
      opens the live LevelDB with a lock and never writes into the app folders.
- [ ] Each source fails on its own. If decoding fails, the run logs the reason and raises one
      `work_bridge_cache_unreadable` notification (deduped per source per day). The other
      sources keep running.
- [ ] New messages are POSTed to EC2 (same Bearer `WORK_COMMS_BRIDGE_SECRET` as mail/Teams).
      Without `WORK_COMMS_TARGET_URL`, they're written to local SQLite (dev).
- [ ] The bridge keeps a local high-water mark per conversation (`~/.ak-system/chat-cache-state.json`)
      and only sends messages newer than it. The server is idempotent anyway.

### Slack (desktop cache)
- [ ] `scripts/slack-cache-source.ts`: finds the newest blob under the IDB blob dir (by mtime),
      Snappy-decompresses it (small pure-TS decoder, no native dep), strips the Blink envelope,
      and V8-deserializes it.
- [ ] V8 version handling: Node 24 reads format ≤ 15 and Slack's Electron writes 16. The
      probe got a correct decode by patching the version byte. Ship that with a fixture test
      (a scrubbed sample blob in `test-data/`). If deserialize throws, fail loudly (see Shared)
      and never guess.
- [ ] Mapping per message: `channel` → conversation; `user` → `members[user]` (real name,
      display name, email); `ts` → `slack_ts` / epoch ms; `text` with `<@U…>` mentions resolved
      to names; `thread_ts` kept. Skips `subtype` in {`channel_join`, `channel_leave`,
      `bot_message` from integrations} and messages with no text.
- [ ] Conversations: `C…` keeps its channel name; `D…` (DM) is named after the other member;
      `G…`/mpim is named from its member list. All are upserted into `slack_channels`
      (`is_private`, plus a new `kind` column: `channel|dm|group_dm`).
- [ ] Default enablement: **DMs and group DMs are on**. Channels are on only if Alpir posted in
      them or was @-mentioned in the cached window. Everything can be toggled in `/settings/slack`.
- [ ] New route `POST /api/work-comms/slack/ingest` → `ingestWorkSlack(db, payload)` in
      `work-comms-ingest.ts`. It upserts channels, then calls the existing
      `ingestSlackMessage`, which already dedupes on `(channel_id, slack_ts)`.
- [ ] **Every message is attributed to its sender, in channels too, not just DMs.** A channel is
      a place, the people are the senders. Per message: Slack member email → `people` by email
      (work email or alias), then by name through `person_aliases`. When it resolves,
      `person_external_ids` (`slack:<U…>`) is learned so later runs match by id. A sender who
      isn't a contact yet is kept on the row (`user_id` + `user_name`) like unknown WhatsApp
      group senders, and surfaces in the same "unknown correspondents" flow as work mail.
- [ ] Per-person effects of a channel message (same as DMs): it updates that person's last
      contact (Slack channel shown as the channel, e.g. "Slack · #ops"). A commitment found in a
      channel is attached to the **sender's** person, not to the channel. Owner rules:
      - The sender asks Alpir (`@Alpir` or a clear "אלפיר, …") → `owner='me'`, person = sender.
      - Alpir promises someone in the channel → `owner='me'`, person = the addressee if named or
        replied to, otherwise the thread starter.
      - The sender promises Alpir → `owner='them'`, person = sender.
      - Requests between other people that don't involve Alpir → ignored.
- [ ] Commitment scan: after ingest, the server runs `scanSlackCommitments`, extended to DMs.
      In a DM, a request from the other person aimed at Alpir ("תוכל לשלוח…", "can you…") is
      `owner='me'`. The source URL deep-links `slack://channel?team=<T>&id=<C>&message=<ts>`.
- [ ] Self identity: Alpir's Slack user id comes from `bootData.user_id` in the same blob and
      is never hard-coded.

### Slack DMs — same behavior as WhatsApp DMs
Slack DMs (`D…`) and group DMs get the same features WhatsApp DMs have today, applied to the
other person:
- [ ] **Person page conversation:** the person page shows the recent Slack DM next to the
      WhatsApp one (same component, with a "Slack" tab or badge). It reads `slack_messages`
      where `kind='dm'` and the counterpart is that person.
- [ ] **DM summaries:** the same rolling summary as `whatsapp_dm_summaries`, through a generic
      `channel` column (`whatsapp | slack | teams`) added to that table instead of a new one.
- [ ] **DM commitment scan:** the same rules as `whatsapp-dm-commitment-scan` and
      `whatsapp-commitment-from-context` (context window, `me`/`them`, "because" sentence,
      source snippet and timestamp), reusing that prompt with the channel name swapped.
- [ ] **Last contact / relationships / "needs a 1:1":** a Slack DM counts as contact with that
      person, the same way a WhatsApp DM does.
- [ ] **Hugo:** the existing "recent conversation with X" tool returns Slack DMs too.

### Linking a Slack member to a person in AK (`people`)
- [ ] Slack identity is stored in the existing `person_external_ids`:
      `provider='slack'`, `accountKey=<team id>`, `externalId=<U…>`, plus `displayName`.
      In `raw`: email, title, avatar URL. This is the Slack equivalent of `whatsapp_person_links`.
- [ ] **Auto-link** on each run, in order:
      1. existing link by `U…`;
      2. exact email match (person email or work email);
      3. exact name or alias match (`person_aliases`) when it's unique.

      Steps 2 and 3 create the link. A fuzzy name never auto-links.
- [ ] **Unlinked Slack people** (sent you a DM, @-mentioned you, or appear in an enabled
      channel) appear in one list at `/settings/slack` → "אנשים מסלאק". It shows name, title
      and email, with a person picker: "קשר לאדם קיים" / "צור אדם חדש" (prefilled with name,
      email, title) / "התעלם". Same actions as the WhatsApp unknown-contact flow
      (`linkUnknownContact` / `saveUnknownContact`).
- [ ] The same link actions appear inline on a proposed commitment whose sender is an unlinked
      Slack member, like unknown WhatsApp senders today. Linking re-attributes that member's
      earlier messages and commitments to the person.
- [ ] **Person page:** the identities section shows "Slack: <display name>" with "נתק".
      Unlinking moves that member back to the unlinked list.
- [ ] tRPC: `slack.listMembers({ linked?: boolean })`,
      `slack.linkMember({ slackUserId, personId })`,
      `slack.createPersonFromMember({ slackUserId })`, `slack.unlinkMember({ slackUserId })`,
      `slack.ignoreMember({ slackUserId })`.
- [ ] The bridge sends the members it saw (`id, real_name, display_name, email, title`) with
      each ingest. The server upserts them into a small `slack_members` table
      (`team_id, user_id PK, real_name, display_name, email, title, ignored, updated_at`), so
      the list works even for members without a link.
- [ ] The same model is used for Teams in phase 2 (`provider='teams'`, AAD object id).

### Teams (desktop cache) — phase 2, gated on a spike
- [ ] **Access:** the launchd runner (`scripts/work-comms-bridge-run.sh` → `node`) needs macOS
      access to other apps' data (Full Disk Access for the `node` binary the plist runs, or the
      "App Data" grant). The install script prints how to grant it, and a run without access
      raises `work_bridge_cache_unreadable` with that hint.
- [ ] Spike (≤ ½ day, throwaway): copy the Teams IDB LevelDB, read it with a pure-JS LevelDB
      reader, and confirm which object stores hold conversations and messages and how bodies
      are encoded. If messages aren't there in readable form, Teams stops at the spike and is
      reported back. No forcing it.
- [ ] If the spike works: `scripts/teams-cache-source.ts` produces the existing
      `WorkTeamsIngestPayload` and posts to the existing `POST /api/work-comms/teams/ingest`
      (`ingestWorkTeams` → `teams_chats` / `teams_messages` → `scanTeamsCommitments`). No new
      server tables. HTML bodies are stripped to text and system/call events are skipped.

### Visibility
- [ ] `/settings` → "ערוצי עבודה" card: last good run, messages read and conversations, per
      source (Outlook mail / Slack / Teams), with a red state and the fix hint when a source is
      unreadable. Fed by a new `workBridge.status` procedure (this was deferred in the earlier
      spec, and it's needed now that sources can go silent).

## Data model (`schema.pg.ts` + `schema.ts` + SQLite bootstrap)

- `slack_channels`: add `kind TEXT NOT NULL DEFAULT 'channel'` (`channel | dm | group_dm`),
  `member_names TEXT` (JSON, for DMs and group DMs).
- `slack_messages`: no change (`team_id` holds the team id from the blob).
- New `slack_members` (see "Linking a Slack member"). The person link itself lives in the
  existing `person_external_ids`.
- `whatsapp_dm_summaries`: add `channel TEXT NOT NULL DEFAULT 'whatsapp'`.
- New `work_bridge_runs`: `id, source, ok INTEGER, message_count INTEGER, conversation_count INTEGER, error TEXT, ran_at TEXT`.
  The bridge posts one row per source per run (`POST /api/work-comms/runs`). The table is
  trimmed to the last 200 rows.
- `COMMITMENT_SOURCES` already has `slack_channel` and `teams_chat`. Labels: Slack DM shows as
  "Slack · <name>".

## tRPC API

| Procedure | Input | Output |
|---|---|---|
| `workBridge.status` | — | `{ sources: { source, lastRunAt, ok, messageCount, conversationCount, error }[] }` |
| `slack.listChannels` (existing) | — | now includes `kind`, `memberNames` |
| `slack.updateChannel` (existing) | `{ channelId, enabled }` | unchanged |

All `protectedProcedure`. HTTP ingest routes are Bearer-secret like the existing mail/Teams ones.

## UI surface

- `/settings/slack`: hide the OAuth "connect" button when the cache source is active. Show
  "מחובר דרך אפליקציית Slack במחשב" plus a list grouped into DMs / channels, with toggles.
- `/settings` "ערוצי עבודה" card (described above). RTL, dark theme, `.card` and `.btn`.
  Needs a UI Designer pass.
- Commitments, people and Hugo pick up the new sources through existing surfaces.

## Out of scope
- Sending or replying in Slack/Teams.
- Full history backfill beyond what the desktop cache holds.
- Slack HTTP cache / Service Worker cache (400 MB) parsing. The redux snapshot is enough. Revisit only if coverage turns out to be too thin.
- Files, images, reactions.
- Teams channel (team) posts in phase 2. Chats and DMs only.

## Risks
- **Format drift:** a Slack/Teams update can change the cache layout. Mitigation: fixture
  tests, a loud failure with a notification, and the status card. No silent zero.
- **V8 version gap:** if Electron moves to a V8 format Node can't read even with the patch,
  fall back to running the decoder with Slack's own bundled Electron as Node
  (`ELECTRON_RUN_AS_NODE=1 /Applications/Slack.app/Contents/MacOS/Slack decode.js`), which
  always matches the format.
- **IT policy:** this reads local files of Alpir's own signed-in account and makes no network
  call to the vendor. Still, Alpir should confirm there's no explicit policy against it.

## Decisions (2026-11-25, Alpir)
- Channels default: on only where Alpir posted or was mentioned. **Approved.**
- Teams: Full Disk Access for the bridge is **approved**. Alpir grants it in System Settings
  (it can't be granted from code) to `/opt/homebrew/Cellar/node/24.5.0/bin/node` (the real
  binary behind `/opt/homebrew/bin/node`). A Node upgrade changes that path, so the bridge's
  unreadable-cache notification has to say "re-grant Full Disk Access to node".
- Channel messages are attributed per sender (see Slack acceptance criteria).

## Open questions
1. Should Slack/Teams message text be kept forever, or follow a retention window like WhatsApp DMs (`runDmRetention`)? Proposed: 90 days for text, and commitments keep their snippet.
