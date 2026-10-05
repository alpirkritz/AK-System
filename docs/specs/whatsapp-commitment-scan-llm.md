# Gemini-backed commitment detection for the 10-minute WhatsApp scans

**Stack:** `next-trpc-monorepo`
**Slug:** `whatsapp-commitment-scan-llm`
**Status:** Implemented
**Created:** 2026-09-29

## Goal

The 10-minute WhatsApp commitment scans (`scanDmCommitments`, `scanGroupCommitments`) currently run a fixed Hebrew-verb regex (`classifyPromise`) that only recognizes a closed list of verbs in their direct future/present tense. Real messages routinely fall outside that pattern — e.g. Shamir's "אל תשכח להביא לה בשישי" (a "don't forget to X" construction with a verb, "להביא", that isn't even in the list) is missed entirely. This spec replaces the regex classification with the same Gemini model already used for the nightly digest, so phrasing like this is recognized, while keeping the regex as an automatic fallback when Gemini is unavailable or fails.

## User stories

- As the owner, I want a commitment phrased in an unusual way ("אל תשכח להביא לה בשישי") to be proposed the same 10 minutes later as a plain "תשלח לי X", so I don't have to wait for (or hope) the nightly summary catches it.
- As the owner, I want this to work the same way for WhatsApp groups as for 1:1 chats, since the group scan uses the identical regex today.
- As the owner, I don't want the 10-minute scan to silently stop proposing commitments if Gemini is down or the API key is missing — it should fall back to today's heuristic, exactly like the nightly summary already does.
- As the owner, I don't want a new kind of spend surprise — Gemini should only be called for a chat/group that actually has new messages in the window, same as today.

## Acceptance criteria

- Given a DM or group message whose text does not match any of today's tracked verbs, but a Gemini call judges it to be a promise or a request in context, when the relevant 10-minute scan runs, then a commitment is proposed with the same `owner`/`source`/`sourceId` rules as today (owner attribution is still derived from who actually sent the message — fromMe for DM, resolved sender identity for groups — never invented by the model).
- Given `GEMINI_API_KEY` is not set, or the Gemini call throws or times out, when either 10-minute scan runs, then it falls back to `classifyPromise` (today's regex) for that batch, and the route still returns `ok: true` — no user-facing failure.
- Given the same messages are scanned again on the next run (whether the previous run used Gemini or the fallback), when commitments were already proposed for them, then no duplicate rows are inserted — the existing `personId` + `sourceId` dedupe (`whatsapp_dm` / `whatsapp_group`) is unchanged.
- Given a person or group has no new messages since the last scan, when the cron runs, then no Gemini call is made for them (unchanged from today — the loop already skips chats/groups with nothing new).
- Given the model returns a due date, content, or a reference to a message id that doesn't exist in the batch it was given, when the result is parsed, then that item is dropped rather than inserted (mirrors `generateDmDigest`'s existing `ids.has(...)` guard) — the model can never fabricate a `sourceId`.
- Given the nightly digest (`summarizeDmChats`) already calls Gemini once a day per active DM, when this ships, then its behavior and prompt are unchanged — this spec only touches the two 10-minute scans.

## Data model

No schema change. Same `commitments` table, same `source` values (`whatsapp_dm`, `whatsapp_group`), same dedupe columns.

## tRPC API

No new tRPC procedure. No route signature change — `apps/web/src/app/api/cron/whatsapp-dm-commitments/route.ts` and `.../whatsapp-group-commitments/route.ts` keep calling `scanDmCommitments`/`scanGroupCommitments` exactly as today; only what happens inside those functions changes.

### `packages/api/src/services/whatsapp-dm.ts`

- New shared helper, used by both scans in place of the per-message `classifyPromise` regex call:
  ```ts
  async function classifyMessagesWithModel(
    speakerLabel: (msg) => string,   // "אני" for the owner, else the person/sender's name
    messages: { id: string; text: string; ts: number }[],
  ): Promise<{ messageId: string; kind: 'promise' | 'request'; content: string; due: string | null }[]>
  ```
  Prompt shape mirrors `generateDmDigest`'s existing one (same JSON-only contract, same "do not invent" instruction, same `ids.has(...)` validation), but returns a per-message classification (promise vs. request) instead of a full digest — no group/DM chat gets a duplicate summary write from this, since `scanDmCommitments`/`scanGroupCommitments` already don't write summaries today and that stays true.
- `scanDmCommitments`: replaces the `detectCommitmentsHeuristic(messages)` call with `classifyMessagesWithModel(...)` when `process.env.GEMINI_API_KEY` is set, wrapped in the same try/catch-and-fall-back-to-heuristic pattern `defaultGenerator` already uses for the nightly path. Owner attribution (`kind === 'promise' ? fromMe-based : ...`) stays exactly as it is today — only the classification source changes.
- `scanGroupCommitments`: same swap for the per-message `classifyPromise(m.text)` call — batched per group (one model call per group with new messages, passing each message's resolved `senderName`/`"אני"` as `speakerLabel` so the model has the same context a human reading the group would have). Sender-to-person resolution (self via bridge JID, phone, manual link, else skipped) is unchanged — the model is never asked who a person is, only whether a given message is a commitment.
- `detectCommitmentsHeuristic` and `classifyPromise` are kept as-is and become the fallback path, not deleted.

## UI surface

None. Same `/commitments` page, same notification copy (`buildCommitmentNotification` from the previous spec is unaffected).

## Out of scope

- Changing the nightly `summarizeDmChats` prompt or behavior.
- Any new verbs added to the regex fallback (a fast, separate one-line change if wanted, orthogonal to this spec).
- Rate limiting or batching Gemini calls across many simultaneously-due chats/groups — at personal-use volume this hasn't been a problem for the nightly path and isn't expected to become one here.
- A settings toggle to disable the Gemini path and force heuristic-only — can be added later if the model ever proposes too many false positives; for now, dismissing a wrong proposal in `/commitments` is the existing safety valve.

## Open questions

None — the model already exists and is already trusted for the nightly path; this reuses it rather than introducing a new one.
