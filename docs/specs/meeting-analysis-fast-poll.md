# Near-Real-Time Post-Meeting Conversation Analysis

**Stack:** `next-trpc-monorepo`
**Slug:** `meeting-analysis-fast-poll`
**Status:** Draft
**Created:** 2026-09-30

---

## Goal

Today, automatic conversation analysis + WhatsApp delivery only happens as a side effect of the full `notion-sync` cron pass (tasks + people + projects + meeting notes), which — even after the stopgap fix landed alongside this spec — still only runs every 10 minutes, and does a heavy multi-database sync each time. There is no dedicated, cheap, per-meeting check that runs right after a meeting ends. The user wants analysis + WhatsApp delivery to land close to real time after a meeting finishes (observed gap: a meeting that ended at 14:30 still had no analysis at 15:46 — 76 minutes later).

This spec covers a dedicated lightweight poller that checks specifically for "meeting just ended, no analysis yet" and does a targeted, single-page Notion fetch — decoupled from the heavy `notion-sync` cadence.

---

## User Stories

1. **As Alpir**, I want conversation analysis + the WhatsApp message to arrive within a few minutes of a meeting ending, so I don't have to check manually or wait up to half an hour.
2. **As Alpir**, I want this to keep working the same way whether the meeting came from calendar sync and later got a Notion AI note, or was already fully in the system — as long as a Notion page with a meeting note exists.
3. **As Alpir**, I want the system to stop polling a given meeting once it's analyzed, or after a reasonable cutoff if Notion never produces a note, so it doesn't hammer the Notion API forever.
4. **As Alpir**, I want a way to turn this off (or fall back to the slower full-sync path) if it turns out to be noisy or hits Notion rate limits.

---

## Acceptance Criteria

### Targeted polling window
- **Given** a meeting whose end time (`endTime`, or `time` + 1h default) is between 2 and 90 minutes in the past
- **And** it has a linked Notion page (`meetings.notionPageId` or a linked `meetingNotes.notionPageId`)
- **And** there is no `meeting_analyses` row with `status IN ('completed','pending')`, and no `failed` row created in the last hour
- **When** the fast-poll cron runs
- **Then** the meeting is a candidate for an on-demand check this cycle

### Cheap "did anything change" check before a full fetch
- **Given** a candidate meeting
- **When** the poller checks it
- **Then** it first calls Notion's lightweight page-retrieve (`pages/{id}`, not the block tree) to read `last_edited_time`, and only performs the full block fetch (`ensureMeetingPageNote` / `upsertInPageMeetingNote`) if that timestamp is newer than the stored `meetingNotes.notionLastEditedAt` — to avoid re-fetching the whole note body every 5 minutes for a note that hasn't changed yet

### Auto-trigger on success
- **Given** a fresh fetch that yields `bodyText.length >= 100`
- **Then** the existing `triggerAnalysisIfNeeded` path fires (analysis → `proposeCommitmentsFromAnalysis` → `notifyAnalysisOnWhatsApp`), same as the current notion-sync-triggered flow — no duplicate implementation of the analysis/WhatsApp logic

### Cutoff
- **Given** a meeting whose end time is more than 90 minutes in the past with still no usable note body
- **Then** the fast-poller stops checking it (it remains coverable by the existing 10-min `notion-sync` and `transcript-analysis` safety-net crons, and by the manual "Analyze Conversation" button)

### Kill switch
- **Given** `FAST_MEETING_POLL_ENABLED=false` (env var) or a new `user_settings.fast_meeting_poll_enabled` flag set to false
- **When** the cron runs
- **Then** it exits immediately as a no-op, leaving the existing slower paths intact

### Rate-limit safety
- **Given** N candidate meetings in a single run
- **Then** the poller caps the number of Notion API calls per run (e.g. 10) and logs a warning if more candidates exist than the cap

---

## Data Model Changes

No new tables. Reuses `meetings`, `meetingNotes`, `meetingAnalyses` as-is (all already have the needed columns: `meetings.notionPageId`, `meetingNotes.notionPageId` / `notionLastEditedAt` / `bodySyncedAt`, `meetingAnalyses.status`/`createdAt`).

One optional addition, in both `packages/database/src/schema.pg.ts` and the SQLite mirror `schema.ts`, under `userSettings`:

```ts
fastMeetingPollEnabled: boolean/integer (default true)
```

Bootstrap `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` for the SQLite mirror added in `packages/database/src/index.ts` per existing convention.

---

## tRPC API

None required. This is cron-only. (Optional, out of scope for v1: a settings toggle wired through the existing `settings` router if the `user_settings.fast_meeting_poll_enabled` column is added.)

---

## UI Surface

None required for v1. (Optional future nice-to-have, out of scope here: a small "מנתח שיחה אוטומטית…" indicator on the meeting detail page while a candidate is being polled.)

---

## Implementation Sketch (for the Dev Agent, non-binding)

- New route: `apps/web/src/app/api/cron/meeting-analysis-fast-poll/route.ts`, same `CRON_SECRET` bearer pattern as other cron routes.
- Query candidates as described in Acceptance Criteria; reuse `ensureMeetingPageNote` (`notion-meeting-note-body.ts`) for the fetch, `triggerAnalysisIfNeeded` (`notion-meeting-sync.ts`) for analysis+WhatsApp — do not re-implement either.
- Add a lightweight `retrievePageLastEdited(token, pageId)` helper (single `GET /v1/pages/{id}` call) in `notion-meeting-note-body.ts` for the cheap pre-check; only call `ensureMeetingPageNote` when it indicates a change (or when there's no prior sync at all).
- Register in `deploy/crontab.example` at `*/5 * * * *`, and in `docs/deploy/cron-setup.md`.

---

## Out of Scope

- Meetings whose transcript source is not a Notion page (e.g. direct audio upload / mobile voice recordings) — those already have their own analysis path.
- Retroactive backfill of historical unanalyzed meetings — already covered by `linkOrphanedNotes` / the manual "Analyze Conversation" button.
- Reducing Notion's own latency in generating the AI meeting note after a call ends — that is on Notion's side and out of our control.
- Any change to the `notion-sync` full-database cadence beyond the stopgap already applied (10 min).

---

## Open Questions

1. Is a 90-minute cutoff window right, or does Notion sometimes take longer than that to produce the AI note for longer calls?
2. What's an acceptable Notion API call budget per 5-minute window given the account's rate limits, if the number of same-day meetings is high?
3. Should a repeatedly-failing candidate (Notion page exists but never produces a usable note after the cutoff) surface a notification to Alpir ("ניתוח לא הופק אוטומטית") instead of silently falling back to the slower paths?
