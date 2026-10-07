# Commitments from the conversation, including followed groups

**Stack:** `next-trpc-monorepo`  
**Slug:** `whatsapp-commitment-from-context`  
**Status:** Implemented  
**Created:** 2026-10-05

## Goal

The 10-minute WhatsApp scan already reads a chat in one Gemini call. Change that call so it proposes the few commitments still real at the end of the conversation, each with a one-line reason. A followed-group promise from a sender who is not a contact shows up immediately as "התחייבות ממספר לא מוכר", with actions to save a new contact or attach an existing one.

## Current behavior

Verified in `packages/api/src/services/whatsapp-dm.ts` on 2026-10-05. This is not the September nightly-only scanner.

- `scanDmCommitments` and `scanGroupCommitments` each run every 10 minutes (`deploy/crontab.example`). Groups with `whatsapp_groups.enabled = 1` are included. Disabled groups are ignored.
- Each chat or group with new lines is one Gemini call, up to the last 200 lines in that batch. The prompt still says to output one entry per message that is a promise or a request. There is no cap, no merge, and no "still true at the end" rule.
- The batch is only the lines since the last DM summary, or since the group cursor. Older lines that the new message answers are not included.
- If the key is missing or the call throws, `defaultClassify` falls back to the verb regex, which emits one commitment per matching sentence (`מזמין`, `אשלח`, `נטפל`, and the rest).
- `sourceSnippet` is an 80-character clip of that one line. The model does not return a reason.
- A group commitment is dropped when the sender JID is not the bridge, not a phone match, and not a manual link. The group cursor still advances, so that line is not scanned again.
- A private chat is unchanged on that point: capture must be on, and the other person is already known.

## User stories

- As the owner, I want one commitment that survived the conversation, not a new row for every sentence that contains a verb, so the queue stays reviewable.
- As the owner, I want that row to say why it is a commitment, in the words of the exchange, so I can accept or dismiss it without opening WhatsApp.
- As the owner, I want a joke or a retraction ("חלום, מזמין כוסות") to produce nothing, so sarcasm does not become a task.
- As the owner, I want the same reading for every WhatsApp group I follow (`whatsapp_groups.enabled = 1`), so a promise made there shows up the way a private-chat promise does.
- As the owner, I want a group promise from an unknown number to appear in the same queue, labeled as such, so I can save them as a contact or attach them to one I already have.
- As the owner, I do not want a failed model call to be replaced by the verb regex, so a timeout does not dump a commitment per sentence.

## Acceptance criteria

### One reading of the window

- Given a 1:1 chat or a followed group with new messages, when `/api/cron/whatsapp-dm-commitments` or `/api/cron/whatsapp-group-commitments` runs, then Gemini is called once for that chat with the new lines plus up to 20 immediately older stored lines marked as prior context.
- Given that call, when the model answers, then it returns at most 3 commitments for the chat. Two lines that restate the same task become one commitment. A window with only small talk, questions, jokes, or "we'll see" returns an empty list.
- Given "חלום, מזמין כוסות חדשות" as a reply to a complaint, when the window is read, then no commitment is inserted.
- Given one side asked for a contract and the other answered "אשלח לך את החוזה מחר", when the window is read, then exactly one commitment is inserted: short Hebrew task, `dueInferred` `YYYY-MM-DD` of the named day, `sourceId` equal to the message id of the line where it became real, and that id is one of the new messages (not a prior-context line).
- Given a commitment is inserted, when it is stored, then `sourceSnippet` is one Hebrew sentence of why it is still on someone after the rest of the window (not an 80-character clip of a single line). The existing row on `/commitments` shows that sentence under the task.
- Given the model returns more than 3 items, a `messageId` that is not in the new-message set, an owner other than `me` or `them`, or a `due` that is not `YYYY-MM-DD`, when the result is parsed, then those items are dropped.
- Given zero commitments, when the scan finishes, then no row and no notification are created. Context is not stored on its own.
- Given the same window is scanned again, when those `sourceId`s already exist for that person and source, then nothing new is inserted.

### Owner of the commitment

- Given a private chat, when a commitment is kept, then `owner` is `me` if the owner must act and `them` if the other person must act. `personId` stays that person. The model does not choose a person id.
- Given a followed group, when the owner (bridge self JID) is the one who must act, then `personId` is the self person and `owner` is `me`.
- Given a followed group, when someone else must act and their JID resolves to a `people` row (phone or `whatsapp_person_links`, same order as today), then `personId` is that person and `owner` is `them`.
- Given a followed group, when someone else must act and their JID does not resolve, then a row is still proposed in `/commitments` immediately. It is not filed on the owner. `personId` stays empty until the owner uses one of the two actions below. The group cursor may advance. The line is not dropped.
- Given that row, when it renders, then the name is `התחייבות ממספר לא מוכר`. Under it: the WhatsApp display name, and the phone when the JID is a phone JID. An `@lid` with no phone shows the display name only, not the raw JID.
- Given the owner presses `שמור לאנשי קשר`, when it completes, then a `people` row is created with that display name (phone filled when the JID has one), the JID is linked with `insights.linkWhatsappSender`, the commitment's `personId` is set, and the row becomes a normal commitment on that person. 1:1 capture turns on only when a phone was saved, which is already what `people.create` does.
- Given the owner presses `שייך לאיש קשר קיים` and picks a person, when it completes, then the JID is linked to that person, `personId` is set to them, and no second person is created. An existing phone on that person is not overwritten.
- Given the sender is still unknown, when the row is shown, then `קבל` is absent and `דחה` still dismisses it. After `personId` is set, `קבל` and `דחה` work as they do today.
- Given a later scan sees the same `sourceId` already proposed or already dismissed, when it runs, then it does not insert another row.

### Groups that are followed

- Given `whatsapp_groups.enabled = 1`, when the group cron runs, then that group's new `whatsapp_messages` are part of the scan. `enabled` is the follow toggle already labeled מעקב in Settings. No second flag.
- Given `enabled = 0`, when the cron runs, then that group's messages are ignored.
- Given a group classification throws or times out, when the run ends, then the group cursor stays at or before that group's oldest unscanned message, so the next run retries it. A successful chat is safe to retry: `sourceId` dedupe blocks a second row.
- Given `GEMINI_API_KEY` is missing or the call throws, when either 10-minute scan handles that chat, then it proposes nothing for that chat and does not call `classifyPromise` / `detectCommitmentsHeuristic`.

### Notification

- Given one or more commitments were inserted, when the cron notifies, then the existing `buildCommitmentNotification` title is unchanged, and each body line gains the reason sentence after the task (`<chat>: <task> — <reason>`), truncated so the whole body stays within the current notification clamp.
- Given the new row has no person, when that line is built, then the label is `מספר לא מוכר` instead of a person name. The group name stays in the title when it is the only new item (`התחייבות חדשה מ<group>`).

## Data model

Mirror in `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`. Add the SQLite `ALTER TABLE` in `packages/database/src/index.ts`. Additive only.

`commitments.person_id` becomes nullable in `schema.pg.ts` and `schema.ts`. Postgres: `ALTER COLUMN person_id DROP NOT NULL`. SQLite: the bootstrap in `packages/database/src/index.ts` rebuilds the table only if a null insert would fail; existing rows keep their person. A null `personId` means the group sender is not a contact yet.

Also on `commitments`, additive:

- `senderJid` text, nullable — set only while `personId` is null
- `senderName` text, nullable — WhatsApp display name for that unknown sender

`sourceSnippet` already exists and, for these two scans only, stores the reason sentence. Email, voice, and meeting-analysis snippets stay whatever those paths write today. No pending table. The group cursor column stays, and an unknown sender does not freeze it.

## tRPC API

`packages/api/src/routers/commitments.ts`, all `protectedProcedure`:

- `listProposed` and `listForPerson` left-join `people` so a null `personId` is included. Each row adds `senderJid: string | null` and `senderName: string | null`. `personName` is null when there is no person.
- `saveUnknownContact` mutation. Input `{ commitmentId: string, name?: string }`. The commitment must be `proposed` with a null `personId` and a `senderJid`. Creates a person via the same fields as `people.create` (`name` defaults to `senderName`, else `מספר לא מוכר`; `phone` from the JID when it is a phone JID). Calls `insights.linkWhatsappSender` for that JID. Sets `personId`, clears `senderJid` and `senderName`. Returns `{ personId }`.
- `linkUnknownContact` mutation. Input `{ commitmentId: string, personId: string }`. Same preconditions. Links the JID with `insights.linkWhatsappSender`. Does not change that person's phone. Sets `personId`, clears the sender columns. Unknown `personId` returns `NOT_FOUND`. Returns `{ personId }`.

No new cron route. Both existing routes keep their HTTP shape:

- `GET`/`POST` `/api/cron/whatsapp-dm-commitments` → `scanDmCommitments`
- `GET`/`POST` `/api/cron/whatsapp-group-commitments` → `scanGroupCommitments`

Bearer `CRON_SECRET` when set. Response JSON stays `{ ok, people|groups, commitments }`.

`packages/api/src/services/whatsapp-dm.ts`:

- Replace `classifyMessagesWithModel` for these two scans. One call per chat. Prompt: read the thread; return only commitments still standing at the end; merge restatements; drop jokes and hedges; at most 3; each item is `{ messageId, owner: "me"|"them", content, due, because }`. `owner` is who must act. Prior lines are prefixed so the model can use them and cannot cite them as `messageId`.
- `defaultClassify` for these scans no longer falls back to `heuristicClassifications`. Email sync keeps `detectCommitmentsHeuristic` unchanged.
- `scanGroupCommitments`, when `resolveGroupSenderPersonId` returns null for a kept commitment, inserts the `commitments` row with `personId` null, `senderJid`, and `senderName` set. It does not skip the line.

`generateDmDigest` / `summarizeDmChats` are unchanged.

## UI surface

`apps/web/src/app/commitments/page.tsx`, same card, RTL, existing `.btn` / `.card` classes:

- The empty sentence mentions followed WhatsApp groups alongside private WhatsApp.
- When `personId` is null, the name line is `התחייבות ממספר לא מוכר`, with the display name and phone (if any) on the next line. `קבל` is hidden. Two buttons: `שמור לאנשי קשר` (`saveUnknownContact`) and `שייך לאיש קשר קיים` (opens the existing people search, then `linkUnknownContact`). `דחה` stays.
- After either action the row reloads as a normal commitment for that person, and `קבל` is available.

Mobile commitments list shows the same label and hides accept until a person is set. Linking stays on the web page. No new screen.

## Out of scope

- Redesigning `/commitments` or the accept/dismiss flow.
- Sending anything back to WhatsApp.
- Changing email, voice, or meeting-analysis detection.
- Changing the nightly DM summary (`summarizeDmChats`).
- A new follow flag. Followed already means `whatsapp_groups.enabled = 1`.
- Backfilling group messages older than the current cursor.
- Filing an unknown sender on the owner's own person.
- A separate pending table, or a new people screen. Saving and linking happen from the commitment row.
- Raising the cap above 3, or storing a context row when there is no commitment.

## Open questions

None.
