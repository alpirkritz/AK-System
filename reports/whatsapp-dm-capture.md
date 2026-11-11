# Code Review: WhatsApp 1:1 Direct Message Capture

> **Slug:** `whatsapp-dm-capture`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-09-24

## What shipped

- **Opt-in per person.**
  - On the web, the capture switch is in the person card footer (the drawer uses the same card). On mobile it's on the person screen.
  - Switching it on stamps `people.capture_whatsapp_since`, and nothing earlier is ever stored.
  - The switch is disabled when the person has no phone and no manual sender link, because the chat can't be recognised; the reason is shown next to it.
- **Bridge.**
  - `POST /config/dm` receives the allowlisted JIDs and persists them to `dm-config.json`.
  - Only those 1:1 chats are captured, in both directions, and self-chat is excluded.
  - An `@lid` chat is resolved to a phone JID through the contact store.
  - Captured messages are queued and flushed to `/api/whatsapp/dm/ingest` by the existing 60-second loop.
  - The web app pushes the list after any change to capture, phone, or links, and from `sync-bridge`.
- **Ingest.** `/api/whatsapp/dm/ingest` checks the allowlist and the capture start time again before storing. It dedupes on `(wa_message_id, whatsapp_jid)` and links the message to a meeting with that person within 3 days.
- **Person card.**
  - 1:1 and group messages are merged in time order. 1:1 messages carry a "פרטי" badge; group messages show the group name.
  - Any message can be pinned.
  - Expired messages read "ההודעה נמחקה לפי מדיניות השמירה".
  - The latest 1:1 summary is shown, and up to 3 pending commitments link to `/commitments`.
- **Nightly summaries.**
  - The cron `/api/cron/whatsapp-dm-summary` (19:00 UTC) summarizes new messages per person, looking back at most 7 days.
  - It uses Gemini when a key is set. Otherwise a Hebrew-verb heuristic proposes commitments and no summary is written.
  - It sends one notification when new commitments appear.
- **Commitments.**
  - New router `commitments`: `listProposed`, `listForPerson`, `accept`, `dismiss`.
  - Accept calls the existing `tasks.create`. The assignee is the owner for `me` and the person for `them`; the project defaults to the person's first project. An optional workspace gives Notion write-back.
  - The `/commitments` page (web) has an owner filter and inline accept (title, due date, workspace). There is a matching mobile screen, reachable from "עוד" and from the person screen.
- **Retention.** 1:1 text becomes `[expired]` after 90 days (`WHATSAPP_DM_RETENTION_DAYS`) unless pinned. Group messages keep the existing 30-day delete but now skip pinned ones.
- **Merge.** Merging two people moves 1:1 messages, summaries and commitments to the kept person.

## Spec Conformance

Every acceptance criterion is met. Where the implementation differs, the spec's "Implementation Decisions" section records it:

| Spec | Shipped | Why |
|---|---|---|
| Allowlist via `captureWhatsapp` or `person_external_ids` provider `whatsapp` | `captureWhatsapp` plus a `capture_whatsapp_since` stamp; JIDs come from the phone and `whatsapp_person_links` | Links already exist from step 1. The stamp is what enforces no backfill when the bridge replays history. |
| Retention "matches existing group retention" at 90 days | 1:1 messages are cleared at 90 days; groups keep the 30-day delete and now skip pinned messages | The existing group policy is a 30-day delete, and changing it was out of scope. |
| Task quick-create modal | Inline editor in the commitment row | One less layer; the same fields. |
| Warmth badge and timeline in this spec | Removed from this spec | Already shipped in `person-context-hierarchy`. |
| Summary storage not specified | New table `whatsapp_dm_summaries` | The summary has to outlive the raw text. |
| — | `commitments.source_snippet` column | The quote stays readable after the source message expires. |

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | PASS |
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm test` | 875/875 |
| Bridge Vitest | 10/10 |
| New e2e | 2/2 (full suite: see `reports/qa-whatsapp-dm-capture.md`) |

## Findings

### Must-fix
- None.

### Should-fix
- **The bridge tests don't run in CI.** `apps/whatsapp-bridge` has no `test` script, so `pnpm test` skips `dm-capture.test.ts` and `self-chat.test.ts`.
- **`@lid` chats with no contact entry are not captured.** A person who only appears as an `@lid` JID, and whose contact isn't in the bridge store, won't be captured until they are linked through "קשר שולח מוואטסאפ" on the card. That picker lists only group senders today.

### Nits
- **Per-message queries in ingest.** `ingestDmMessages` runs one duplicate check and one meeting lookup per message (`services/whatsapp-dm.ts`). Batches are small (one flush per minute), but this can be batched if volume grows.
- **Postgres `ts` columns can overflow.** `ts`, `from_ts` and `to_ts` are `integer` in `schema.pg.ts`, matching `whatsapp_messages`, and millisecond timestamps overflow Postgres int4. Production is SQLite. If Postgres is ever used, these need `bigint` together with the existing group table.
- **Heuristic commitment content.** Without Gemini, a heuristic commitment's text is the raw message, clipped to 140 characters, not a short task title. The accept editor lets you rewrite it.

## Security and privacy

- Capture is opt-in per person. It is enforced twice: in the bridge (allowlist) and at ingest (allowlist plus the start time).
- Self-chat and groups never take the 1:1 path.
- Ingest uses the existing bridge bearer secret (`verifyWhatsAppBridgeAuth`). Every new tRPC procedure is `protectedProcedure` with Zod inputs.
- 1:1 text goes to Gemini only in the nightly summary, and only for opted-in people, the same way group summaries already work. Meeting prep still never carries raw chat text (`quoteChat: false`).

## Production (EC2)

1. Back up `/data/ak_system.sqlite` on the `web-data` volume, then `pnpm deploy:ec2`. The new columns and tables apply on the first `getDb()`; every change is additive.
2. Redeploy the bridge (`--profile whatsapp`) so it has `/config/dm`. The deploy script's `sync-bridge` call then pushes the allowlist, which is empty until someone is opted in.
3. Reinstall the EC2 crontab (`scripts/install-server-cron-remote.sh`) to pick up `whatsapp-dm-summary`, and `people-duplicates` from step 1.
4. Optional: set `WHATSAPP_DM_RETENTION_DAYS` (default 90).

## UI/UX Review

**Verdict:** APPROVED WITH NITS

- [x] Uses `.btn` / `.input` / `.card` / `.pill`
- [x] Dark palette tokens (`#5a688c`, `#b8c4dc`, `#e8c547`, `#223052`)
- [x] RTL: logical `ms-auto` / `start-*` / `borderInlineStart`; mobile uses `row-reverse` and `writingDirection: 'rtl'`
- [x] Focus-visible outline on the switch and the pin button. The pin is visible on touch devices (hover-only fade applies only on `(hover:hover)`).
- [x] Loading, empty ("אין התחייבויות ממתינות…") and error states are on the page and in the accept form. A success line shows whether the task went to Notion.
- [x] The switch uses `role="switch"` and `aria-checked`, and its helper text states what is and isn't saved.
- **Nit:** the owner labels "עליי" / "עליו/ה" are compact but a little terse. Consider showing the person's name ("על דנה") once the row has room.

## Suggested PR Description

Opt-in WhatsApp 1:1 capture per person. The bridge forwards only allowlisted chats, and ingest checks the allowlist and capture start time again. 1:1 messages are merged into the person card next to group messages. A nightly summary proposes commitments into a new review queue (`/commitments`, web and mobile), and accepting one creates a normal task through `tasks.create`. 1:1 text expires after 90 days unless pinned.
