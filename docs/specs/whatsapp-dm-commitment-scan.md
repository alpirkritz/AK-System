# WhatsApp DM commitments every 10 minutes

**Stack:** `next-trpc-monorepo`  
**Slug:** `whatsapp-dm-commitment-scan`  
**Status:** Implemented  
**Created:** 2026-09-25

## Goal

Proposed commitments from allowlisted 1:1 WhatsApp chats show up in the owner's review queue within about 10 minutes. Present-tense promises such as "מזמין" are detected the same way as "אזמין". Nothing is sent to the other person.

## User stories

- As the owner, I want a promise in a captured 1:1 chat to appear under commitments within about 10 minutes, so I do not wait for the nightly summary.
- As the owner, I want "מזמין כוסות" said by the other person to be proposed as their commitment, so the present tense counts the same as "אזמין".
- As the owner, I want the nightly Hebrew chat summary to stay a once-a-day digest, so a 10-minute scan does not replace it with a short fragment.
- As the owner, I want no WhatsApp message sent to the other person when a commitment is proposed.

## Acceptance criteria

- Given a person with WhatsApp capture on and a new stored DM whose text matches a self-promise, when `/api/cron/whatsapp-dm-commitments` runs, then a `commitments` row is inserted with `source = whatsapp_dm`, `status = proposed`, and `owner = them` when they spoke or `owner = me` when the owner spoke.
- Given the same messages are scanned again and no new promise arrived, when the cron runs, then no second row is inserted and the response reports `commitments: 0`.
- Given the scan runs, when it finishes, then it does not insert a `whatsapp_dm_summaries` row. The nightly `/api/cron/whatsapp-dm-summary` still summarizes messages since the previous summary.
- Given the text is "חלום, מזמין כוסות חדשות" from the other person, when the heuristic runs, then one commitment is proposed with `owner = them`. The same for the present-tense mirrors of the existing future verbs (שולח, בודק, מטפל, חוזר, מעביר, מכין, מתקשר, מדבר, מסדר, מעדכן, מארגן, מזמין, and the feminine form of each) and for first-person plural future (נשלח, נבדוק, נטפל, נחזור, נעביר, נכין, נתקשר, נדבר, נסדר, נעדכן, נארגן, נזמין).
- Given the verb is preceded by הוא, היא, הם, הן, אתה, את, אתם, or אתן, when the heuristic runs, then that present-tense verb is not a self-promise.
- Given one or more new commitments were inserted, when the cron finishes, then one in-app notification is created, titled "התחייבות חדשה מהוואטסאפ" or "N התחייבויות חדשות מהוואטסאפ", body "עבור עליהן ואשר מה נכנס למשימות.", url `/commitments`.
- Given `CRON_SECRET` is set, when the request has no matching bearer token, then the route returns 401.
- Given the EC2 crontab template and the local scheduler, when they are read, then `whatsapp-dm-commitments` is every 10 minutes and `whatsapp-dm-summary` stays once a day.

## Data model

No schema change. `packages/database/src/schema.ts` and `packages/database/src/schema.pg.ts` stay as they are. Commitments keep using the existing `commitments` table. The scan does not write `whatsapp_dm_summaries`, so the nightly job's cursor (`to_ts`) is unchanged.

For `source = whatsapp_dm`, `proposeCommitments` also skips a row whose `sourceId` (the stored message id) is already on a commitment for that person. Email and meeting analysis are unchanged: an email thread and a meeting share one source id across several commitments.

## tRPC API

No new tRPC procedure.

New cron route `apps/web/src/app/api/cron/whatsapp-dm-commitments/route.ts`. `GET` and `POST`. Auth: bearer `CRON_SECRET` when that env var is set, same as `whatsapp-dm-summary`. Calls `scanDmCommitments` from `packages/api/src/services/whatsapp-dm.ts`. Returns `{ ok: true, people, commitments }`.

`scanDmCommitments(db, now?)` loads DM messages in the same 7-day window and "since last summary" cursor as `summarizeDmChats`, runs `detectCommitmentsHeuristic` only (no Gemini), and proposes commitments. It does not insert a summary.

## UI surface

No page or component change. Proposed rows show on the existing `/commitments` page.

## Out of scope

- Sending WhatsApp, push, or any message to the other person.
- Turning capture on for a person. Chats with capture off are still not stored.
- Replacing the nightly Gemini summary, or running Gemini every 10 minutes.
- Backfilling a message that was never ingested.
- New verbs outside the mirrors of the current future-tense list.

## Open questions

None.
