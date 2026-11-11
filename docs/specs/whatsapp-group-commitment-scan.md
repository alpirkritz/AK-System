# WhatsApp group commitment scan + informative notification

**Stack:** `next-trpc-monorepo`
**Slug:** `whatsapp-group-commitment-scan`
**Status:** Implemented
**Created:** 2026-09-26

## Goal

Two problems reported by the owner:

1. The in-app notification that fires when a new WhatsApp commitment is proposed only says "התחייבות חדשה מהוואטסאפ" — it never says which chat it came from or what was promised, so the owner has to open `/commitments` to find out.
2. Commitment detection only ever looks at 1:1 DM chats (`scanDmCommitments`). WhatsApp **groups** (e.g. the "מתי עוזבים את חרוזים?" group) are summarized on a schedule but never scanned for commitments, so a self-promise like "לקנות בשר" said in a group is silently dropped.

This spec fixes both: it enriches the commitment notification with the source chat's name and the commitment text, and it adds a group-chat commitment scan that mirrors the existing DM scan.

## User stories

- As the owner, when a commitment notification arrives, I want it to name the chat (person or group) and show what was promised, so I don't have to open the app to know if it matters.
- As the owner, I want a self-promise I make in a WhatsApp group ("אני קונה בשר") to show up under `/commitments` like a DM promise does, so nothing said in a group I'm active in gets lost.
- As the owner, I do not want commitments attributed to people the system can't identify — if a promise in a group comes from (or names) someone with no linked contact record, it's skipped rather than guessed at.

## Acceptance criteria

### Notification content (DM + group)

- Given exactly one new commitment was proposed in a scan (DM or group), when the notification is created, then the title is `התחייבות חדשה מ<chat name>` and the body is the commitment's own text followed by `עבור עליה ואשר אם נכנס למשימות.`
- Given N > 1 new commitments were proposed in one scan, when the notification is created, then the title is `N התחייבויות חדשות מהוואטסאפ` and the body lists up to 5 lines of `<chat name>: <content>`, followed by `ועוד <k> נוספות.` when more than 5 were proposed, followed by `עבור עליהן ואשר מה נכנס למשימות.`
- Given a DM scan, "chat name" is the person's name (as today). Given a group scan, "chat name" is the WhatsApp group's display name (`whatsapp_groups.name`).
- Given zero new commitments, when the cron finishes, then no notification is created (unchanged).

### Group commitment scan

- Given a `whatsapp_groups` row with `enabled = 1` and new stored `whatsapp_messages` since the last group scan, when `/api/cron/whatsapp-group-commitments` runs, then each qualifying message is run through the same Hebrew self-promise/present-tense/plural heuristic already used for DMs (`detectCommitmentsHeuristic`'s regexes).
- Given a matching message whose sender resolves to a known person (see resolution rule below), a `commitments` row is inserted with `source = whatsapp_group`, `sourceId = wa_message_id`, `status = proposed`, and `owner = them` when they spoke or `owner = me` when the owner (bridge's own JID) spoke.
- **Sender resolution rule:** the sender JID is matched to a `people` row by (a) phone extracted from the JID (`phoneFromWhatsappJid` → `people.phone`), then (b) a manual `whatsapp_person_links` entry for that JID. If the sender is the bridge's own JID (`getBridgeStatus().selfJid`), the row is the owner's self-person (`ensureSelfPerson`). If none of these resolve, the message is skipped — no commitment is guessed for an unidentified sender.
- Given the same message is scanned again in a later run, when the heuristic matches it again, then no duplicate `commitments` row is inserted (dedupe by `personId` + `sourceId`, same rule already used for `whatsapp_dm`, extended to `whatsapp_group`).
- Given the scan runs, when it finishes, then it advances a stored cursor so the next run only looks at group messages newer than the last processed one; it never re-summarizes or replaces the existing scheduled group summaries.
- Given one or more new group commitments were inserted, when the cron finishes, then one in-app notification is created per the "Notification content" rules above, `url = /commitments`.
- Given `CRON_SECRET` is set, when the request has no matching bearer token, then the route returns 401.
- Given the EC2 crontab template and the local scheduler, when they are read, then `whatsapp-group-commitments` runs every 10 minutes, same cadence as `whatsapp-dm-commitments`.

## Data model

`packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts` (mirror both):

- `user_settings` gains one nullable column: `whatsappGroupCommitmentScanCursor: text('whatsapp_group_commitment_scan_cursor')` — the `ts` (ms) of the newest `whatsapp_messages` row already scanned for commitments, across all groups. `packages/database/src/index.ts` gets the matching `ALTER TABLE user_settings ADD COLUMN ...` bootstrap line for SQLite.
- No change to `commitments`: `personId` stays `NOT NULL`; `source` already accepts `'whatsapp_group'` (`CommitmentSource` type is unchanged, just used for the first time).
- No change to `whatsapp_groups`, `whatsapp_messages`, or `whatsapp_person_links`.

## tRPC API

No new tRPC procedure.

New cron route `apps/web/src/app/api/cron/whatsapp-group-commitments/route.ts`. `GET` and `POST`. Auth: bearer `CRON_SECRET` when set, same pattern as `whatsapp-dm-commitments`. Calls a new `scanGroupCommitments(db)` in `packages/api/src/services/whatsapp-dm.ts` (or a new `whatsapp-group-commitments.ts` service file, kept next to `scanDmCommitments` for shared regex/dedupe code). Returns `{ ok: true, groups, commitments }`.

Changes to existing code:

- `proposeCommitments` (`packages/api/src/services/whatsapp-dm.ts`): broaden the `sourceId`-based dedupe currently gated on `source === 'whatsapp_dm'` to also cover `source === 'whatsapp_group'`.
- `scanDmCommitments` / the `whatsapp-dm-commitments` route: change the return shape to include per-commitment `{ label, content }` (label = person name) so the route can build the enriched notification instead of just a count.
- A shared `buildCommitmentNotification(items: { label: string; content: string }[])` helper (e.g. in `packages/api/src/services/commitments.ts`) implementing the title/body rules above, used by both the DM and group cron routes.

## UI surface

No page or component change. Proposed rows continue to show on `/commitments`; `CommitmentSourceBadge` already has no special case needed since `whatsapp_group` maps to the same "מהוואטסאפ" label as `whatsapp_dm` (`COMMITMENT_SOURCE_LABELS`).

## Out of scope

- Sending any WhatsApp message back into the group.
- A per-person "capture" opt-in for groups — the existing `whatsapp_groups.enabled` flag is the only gate, matching how group summaries already work.
- Gemini-based detection for groups (heuristic only, same as the DM 10-minute scan; the nightly/scheduled group summary is unchanged).
- Retroactively backfilling commitments from `whatsapp_messages` older than the first run's cursor.
- Any UI to show *why* a sender was skipped as unidentified.

## Open questions

None — resolved during spec review:

- Self-promises and messages from unresolved senders: only propose when the sender resolves to a known person (self or a linked contact); unidentified senders are skipped. *(owner's choice)*
- Cadence: every 10 minutes across all `enabled` groups, mirroring the DM cron. *(owner's choice)*

## Known limitation (found during implementation)

The heuristic only recognizes a fixed Hebrew verb list mirrored from `whatsapp-dm-commitment-scan.md` (שלח/בדק/טיפל/חזר/העביר/הכין/התקשר/דיבר/סידר/עדכן/ארגן/הזמין, in their future/present/plural forms). The owner's own example, "לקנות בשר" (buy meat), uses a verb (קנה) that is **not** in this list, so it would not be detected even now that groups are scanned — this was already out of scope for the original DM spec too. If commitments phrased with other verbs keep getting missed, the fix is to extend the shared verb list in `classifyPromise` (`packages/api/src/services/whatsapp-dm.ts`), which would apply to both DM and group scans.
