# Review — local-chat-cache-ingest (Slack slice)

**Verdict: APPROVED WITH NITS**
**Date:** 2026-11-25 · Spec: `docs/specs/local-chat-cache-ingest.md`

## What changed
- `scripts/slack-cache-source.ts` (new) does the following:
  - finds the newest Slack IndexedDB blob, copies it aside, and decodes it with a pure-TS
    Snappy decoder → Blink envelope → `v8.deserialize` (version byte lowered);
  - extracts members, conversations (dm / group_dm / channel) and cleaned messages;
  - tracks a per-conversation "already sent" state in `~/.ak-system/slack-cache-state.json`,
    saved only after the server accepts a post.
- `scripts/work-comms-sync.ts`: new `slack-cache` source, now on by default.
- `packages/api/src/services/slack-cache-ingest.ts` (new) handles ingest:
  - members are upserted and auto-linked by exact email (person or learned work email) or by
    a unique exact name/alias;
  - DMs and group DMs start enabled. Channels start enabled only when Alpir posted or was
    @-mentioned, and later runs keep the user's toggle;
  - messages are stored, then the scan runs.
- `services/slack.ts` `scanSlackCommitments`:
  - works without an OAuth connection;
  - self lines are labelled "אני";
  - attribution follows the sender, and Alpir's own promises go to the DM counterpart or the
    last other speaker;
  - a 14-day first-scan floor;
  - fixed the classifier input shape (it passed `speaker` with no `ts`; the classifier reads
    `speakerLabel` and `ts`).
- Schema (SQLite bootstrap + both schema files): `slack_members`, and
  `slack_channels.kind / member_names / member_ids`. Prod is SQLite, so the bootstrap applies
  it on start.
- tRPC: `slack.cacheStatus`, `listMembers`, `linkMember`, `createPersonFromMember`,
  `unlinkMember`, `ignoreMember`, `memberForPerson`. `commitments.saveUnknownContact` and
  `linkUnknownContact` handle Slack senders.
- Route `POST /api/work-comms/slack/ingest` (Bearer `WORK_COMMS_BRIDGE_SECRET`).
- UI `/settings/slack`: cache status, conversations grouped by kind, and the "אנשים מסלאק"
  tab (`SlackPeoplePanel.tsx`).

## Verification
- New tests: `scripts/slack-cache-source.test.ts` (6) and
  `services/slack-cache-ingest.test.ts` (5). The existing `slack.test.ts` still passes.
- Full API suite: 145 files, 1572 tests, all passing. `pnpm -r run lint` clean. Web build
  passes.
- Live run of the real Slack cache into a **copy** of the dev DB (EC2 untouched): 90
  members, 22 auto-linked, 702 messages, 6 commitments, each attributed to the right person
  or kept as an unknown sender.

## Deploy (2026-11-25)
- Deployed to EC2 (release 11 plus 2 fix redeploys). CI gate: lint, 1573 API tests and 330
  web tests, build. Playwright was skipped because 7 specs already fail on old selectors.
- The first attempt failed with ENOSPC on EC2. 8 GB of unused Docker images were pruned (with
  Alpir's approval). Production stayed up on the old version throughout.
- Fix 1: the first ingest took longer than the ngrok timeout (503). The route now replies after
  storing and runs the scan in the background, one scan at a time.
- Fix 2: overlapping scans produced 3 rephrased duplicate commitments. Slack and Teams now
  dedupe one commitment per source message, the same as WhatsApp.
- Live: the bridge run at 19:52 had all sources ok. 94 members, 49 auto-linked, 740 messages,
  9 Slack commitments (3 of them duplicates from before fix 2).
- Container startup runs `drizzle-kit push`, which prompts (create vs rename) for the new table
  and aborts with no TTY. Harmless, because the runtime bootstrap creates the table, but noisy
  in the logs.

## Nits / follow-ups
1. The 3 duplicate Slack commitments in prod are still there, waiting on a decision.
2. The person-page Slack DM, DM summaries, Hugo tool, last-contact and the status card are
   still open (see the spec's "Not built yet").
3. `resetDb` doesn't clear `user_settings`, so tests reset the Slack scan cursor themselves.
4. The UI Designer pass on the new tab was a self-review only: RTL, dark tokens, `.card` /
   `.btn` / `.input`.
