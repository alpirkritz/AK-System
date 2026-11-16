# Spec — Notion Release Notes Listener (WhatsApp "טכני")

> **Slug:** `notion-release-notes-listener`
> **Status:** Implemented — see `reports/notion-release-notes-listener.md`
> **Stack:** `next-trpc-monorepo`

## Goal

A listener agent that detects every **new record** in the Notion "version updates" database
(`da65ad6281c04fac8611638650120899`) and posts a Hebrew **release notes** message with the full
details of that record into the WhatsApp group **"טכני"**
(JID `120363411443506535@g.us`, already allow-listed for outbound on the bridge — precedent:
`tier1-qa-whatsapp-agent`).

## User stories

- As Alpir, when a version is logged in Notion, the team in "טכני" gets release notes automatically, without me copying anything.
- As Alpir, a record is announced exactly once — no duplicates on re-polls, restarts or edits.
- As Alpir, I can turn the listener off, or run it in draft mode (visible in-app only) before it posts to the group.

## Design

**Trigger = polling, not push.** Notion has no webhook usable here; the app already polls Notion via
cron on EC2. Add `GET|POST /api/cron/notion-release-notes` (CRON_SECRET bearer, same pattern as
`notion-sync`), run every 5 min from `deploy/crontab.example`.

**Flow per run**
1. Resolve DB via `resolveDatabases('release_notes')` (new `NotionDbType`, configured in `NOTION_ACCOUNTS` like other DBs).
2. Query pages sorted by `created_time` desc, paginate until reaching a page already recorded.
3. For each page not in `notion_release_seen` (by Notion page id): read properties + block content (full body, so the notes carry "all the detail").
4. Compose the message: deterministic template for fields (version, date, type, links) + LLM (Gemini, existing engine) only to rewrite the page body into tidy Hebrew bullets grouped (חדש / שיפורים / תיקונים). No invented content; if the body is empty, send fields only.
5. Send via `sendBridgeGroupText(groupJid, text)`; on success mark the page `sent` in `notion_release_seen`. On failure leave it `pending` so the next run retries (max N attempts, then `failed` + in-app notification).

**First-run safety (backfill guard):** on the very first run, all existing records are marked `seen` **without sending**; only records created afterwards are announced.

**Edits are not new records:** only creation triggers a send. (Optional later: re-announce on status change — out of scope.)

**Draft mode:** env `RELEASE_NOTES_WHATSAPP_ENABLED=1` gates real delivery. Off → message is stored and delivered as an in-app notification only (same pattern as Tier 1 QA).

**Agent surface:** add `A_Agents/11_release_notes_listener.md` (card) + `S_Skills/wf_release_notes_listener.md`, so it appears in `/agents/manage` with enable/disable. The cron routes through `runEventAgentIfRouted`-style wiring only if needed; the polling cron itself is deterministic.

## Data model

New table `notion_release_seen` in **both** `schema.pg.ts` and `schema.ts` (+ SQLite bootstrap SQL in `database/src/index.ts`, + exports):

| column | type | note |
|---|---|---|
| `page_id` | text PK | Notion page id |
| `status` | text | `seen` (baseline) / `pending` / `sent` / `failed` |
| `attempts` | int | send attempts |
| `title` | text | for logs/UI |
| `message` | text | composed message (audit) |
| `created_at`, `sent_at` | text | ISO |

## tRPC / API

- No new UI-facing procedures required. Service `packages/api/src/services/notion-release-notes.ts` exposes `runReleaseNotesListener({ dryRun })`; cron route calls it via `createServiceCaller` (add a thin `releaseNotes.run` procedure for the service caller + manual dry-run).

## UI surface

None new. Enable/disable through existing `/agents/manage`. (No UI-designer step needed.)

## Acceptance criteria

- [ ] A new page in the DB produces exactly one WhatsApp message to "טכני" within ~5 min.
- [ ] Re-running / restarting never re-sends a `sent` page.
- [ ] First run sends nothing for pre-existing records.
- [ ] Message contains all populated properties and full body content; Hebrew; WhatsApp-safe formatting (single-asterisk bold, no tables).
- [ ] Bridge down → page stays `pending`, retried next run; after N failures flagged and notified.
- [ ] Draft mode (flag off) never calls the bridge.
- [ ] Vitest: dedupe, baseline, retry, draft mode, message composition (Notion + bridge mocked).

## Out of scope

Re-announcing edits; other groups; Notion webhooks; editing the Notion record.

## Verified Notion facts (2026-11-08)

- Access resolved: DB is readable by the **DAZ** account ("ARO System"); Personal → 404.
- Title: **"סיכומי שינויי DB בדיפלוי"**. Properties: `Name` (title), `Date` (date), `Commit` (url), `Run` (url), `Services` (rich_text), `Schema changes` (checkbox). The table currently has **0 records**, so page-body content is unverified.
- Config: add the DB to the DAZ account in `NOTION_ACCOUNTS` with `type: "release_notes"`.

## Open questions

1. **Is this the right DB?** Its schema is per-deploy DB-change summaries (commit, run, services, schema-change flag), not product "version updates" with a version number. Confirm; if so the template is: Name, Date, Services, "שינויי סכמה: כן/לא", links to Commit and Run, plus page body (where the detailed summary presumably lives).
2. **Properties:** which fields should appear in the notes (and in what order)? Default as above.
3. **Group JID:** reuse `120363411443506535@g.us` from the Tier 1 spec — I'll cross-check it against `/settings/whatsapp` before use.
4. **Start in draft mode** for the first few records? (Recommended: yes.)

## Implementation notes (deviations from the draft above)

- Message composition is **fully deterministic** (no Gemini): fields + page body are rendered as-is, so nothing can be invented.
- Draft-mode switch is the notification type `notion_release_notes` (WhatsApp channel off by default, toggled in Settings), same mechanism as Tier 1 QA — not a new env flag.
- Group JID comes from env `RELEASE_NOTES_WHATSAPP_GROUP_JID`; it must also be in the bridge's `WHATSAPP_ALLOWED_GROUP_JIDS`.
- No agent card: this is a deterministic poller (like the IBKR import), not an LLM agent run.
- Baseline uses a `__baseline__` marker row, so an empty database still baselines correctly.
