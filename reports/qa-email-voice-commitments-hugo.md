# QA: Email Archive, Voice Capture, and Hugo Commitment Integration

> **Slug:** `email-voice-commitments-hugo`
> **Verdict:** PASS for this change. The full `pnpm e2e` run still exits 1 because of failures that were already there before this work.
> **Date:** 2026-09-24

## Results

- Vitest, packages/api (`pnpm test`): **79 files, 887 tests passed, 0 failed**. 12 are new (`email-voice-commitments.test.ts`).
- Vitest, apps/web: **31 files, 233 tests passed**. 2 are new (`morning-briefing-context.test.ts`).
- New e2e spec `e2e/email-voice-commitments.spec.ts`: 4/4 passed, twice. The step 1 and step 2 specs (`person-context-circles`, `whatsapp-dm-commitments`) passed 4/4 in the same targeted run.
- Full `pnpm e2e`: 82 passed, 23 failed, 2 skipped.
  - 22 of the 23 are the baseline from `reports/qa-whatsapp-dm-capture.md`: bank-accounts, dashboard-task-open-sort, full-flow (2), meeting-conversation-analysis (5), meeting-relationships, multi-level-sort, notion-note-meetings (4), qa-structured (4), trading-journal, ui-refresh, and the flaky task-workspaces.
  - `notion-note-meetings` fails on its own seed: it inserts a meeting whose `source_note_id` points at a note it hasn't created yet (`FOREIGN KEY constraint failed`). This change doesn't touch `meetings` or `meeting_notes`.
  - The extra failure is `agent-config` › "configures a schedule and an event subscription". It passed 2/2 when run alone, so it is flaky under load, like task-workspaces.
- `pnpm -r run lint`: no findings in changed files (only existing warnings elsewhere).
- `pnpm --filter @ak-system/web build`: PASS.
- `apps/mobile` `tsc --noEmit`: PASS.
- Drizzle check: after the `getDb()` bootstrap ran on a copy of the test DB, `drizzle-kit push` reported **"No changes detected"**. The bootstrap DDL matches drizzle's, so push won't rebuild the new tables.

## New coverage

| File | Covers |
|---|---|
| `packages/api/src/routers/email-voice-commitments.test.ts` | Email: the Gmail OR query; one row per (thread, person); `people.email` and `person_external_ids`; unconfirmed people and strangers skipped; update only on newer mail; commitments only from new mail; Gmail link; HTML entities decoded; router and person card; merge moves threads and recordings. Voice: consent, length and type checks; file stored under `VOICE_STORAGE_DIR`; standalone placeholder meeting, attendees and a `voice` analysis; `voice` commitments; failure then retry; attach candidates; attaching moves analysis, people and commitments and drops the placeholder. Queue: analysis items assigned to the named attendee, owner-less items skipped with several attendees; the morning-brief query; meeting-prep source labels with no raw snippet; `sourceUrl`; an accepted voice commitment's task is tied to its meeting. |
| `apps/web/src/lib/morning-briefing-context.test.ts` | "התחייבויות פתוחות" after events with source labels; "זכור לטפל"; a day with only commitments isn't reported as empty |
| `apps/web/e2e/email-voice-commitments.spec.ts` | Person card email and recording sections (Gmail href, duration, audio player, source badges, record link); `/commitments` badges and source links; `/voice` consent gate, analyzed result, adding a person and saving; the upload endpoint rejects missing consent and recordings under 10 s |

## Not covered by automation

- The real Gmail fetch (`fetchGmailHeaders`) and real Gemini transcription. Both are injected in the tests; they need a live check on EC2 after deploy.
- Recording from the browser microphone (MediaRecorder). The e2e covers the consent gate and everything after upload. A manual check in Chrome and Safari is needed; Safari records `audio/mp4`, which the server accepts.
