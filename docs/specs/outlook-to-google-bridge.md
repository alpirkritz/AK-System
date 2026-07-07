# Outlook → Google Dragontail Bridge

> **Slug:** `outlook-to-google-bridge`
> **Stack:** next-trpc-monorepo
> **Status:** Approved
> **Last Updated:** 2026-07-06

## Goal

Replace the unreliable iCalendar feed path with a Mac-local bridge that reads the local Outlook/Exchange calendar via EventKit and writes it directly into the `Dragontail` Google calendar. After the write, the rest of the system (including EC2) reads Dragontail through the existing Google Calendar integration.

## Verified findings

- Outlook source = local calendar named `Calendar`, `calSource=Exchange`, `calType=2` (~37 events).
- Target = Google calendar `Dragontail`, owned by `alpirkritz@gmail.com` (**owner** → writable), ID: `bfa8306ecf5f05d42d22b2349ddbec44d5bd4746dc12940d79e8b3e235add13b@group.calendar.google.com`.
- Legacy path being replaced: calendar `Calendar` of type `...@import.calendar.google.com` (iCalendar feed).
- EventKit is macOS-only → the bridge runs on the Mac (launchd), not on EC2.
- Current OAuth is read-only → write scope + one-time reconnect of the personal account is required.

## User stories

- As a user, I want Outlook events to appear in Dragontail within minutes, without feed delays.
- As a user, I want Outlook edits/deletions to propagate to Dragontail.
- As a user, I want the bridge to touch only the copies it created, never the 3200 real Dragontail events.
- As a user, I want the sync to run automatically while the Mac is awake, without manual intervention.
- As a user, I want the bridge to avoid creating duplicate events when the meeting already exists in Dragontail (e.g. from a legacy feed or manual entry).
- As a user, I want meeting attendees from Outlook to appear on the Google Calendar event.

## Acceptance criteria

- Given a new event in the Exchange `Calendar`, When the bridge runs, Then a matching event is created in Dragontail tagged `akSource=outlook-exchange`.
- Given an event already present as a copy, When its content is unchanged, Then the bridge performs no rewrite (compares `akSig` signature).
- Given an event changed in Outlook, When the bridge runs, Then the Dragontail copy is patched.
- Given an event deleted from Outlook within the sync window, When the bridge runs, Then the tagged copy is deleted — and untagged Dragontail events are never deleted.
- Given the Mac is awake, When ~15 minutes elapse, Then launchd runs the bridge again.
- Given a `cancelled` event, When the bridge runs, Then it is skipped/removed and not created.
- Given an Outlook event whose normalized `title+start` already exists in Dragontail without bridge tags, When the bridge runs, Then it patches the existing event (adopts it) instead of creating a duplicate.
- Given an Outlook event with attendees (email available from EventKit), When the bridge creates or updates the Dragontail copy, Then `attendees` are written to the Google event with `sendUpdates=none` (no invitation emails).

## Data model

No schema change. Copy identification uses Google event fields:

- `extendedProperties.private.akSource = 'outlook-exchange'`
- `extendedProperties.private.akSourceUid = <eventIdentifier>_<startISO>` (unique also for recurring occurrences)
- `extendedProperties.private.akSig = <hash of title|start|end|location|notes|allDay|attendees>`

The bridge reads the `alpirkritz@gmail.com` refresh token from the local SQLite `google_connections`, populated by reconnecting the account with the write scope.

## tRPC API

No new tRPC procedure. Single change in `packages/api`:

- `packages/api/src/google-calendar-auth.ts` — add `https://www.googleapis.com/auth/calendar.events` to `SCOPES` (backward compatible; existing tokens keep reading, writing requires re-consent).

## Files to change

- `packages/api/src/google-calendar-auth.ts` — add write scope.
- `scripts/outlook-to-google-sync.ts` (new) — the bridge. Run via `pnpm exec tsx`, imports `listGoogleConnections` + `getAccessTokenForConnection` from `packages/api`, runs the Swift helper `packages/api/src/services/calendar-helper/calendar-helper`, and syncs to Dragontail via `googleapis`.
- `scripts/outlook-bridge-run.sh` (new) — wrapper: cd to repo, load `apps/web/.env.local`, run the bridge, log to `.cursor/outlook-bridge.log`.
- `deploy/launchd/com.ak.outlook-bridge.plist` (new) — run every 900 seconds.
- `scripts/install-outlook-bridge.sh` (new) — install/load the plist into `~/Library/LaunchAgents`.

## Bridge logic (scripts/outlook-to-google-sync.ts)

1. Run the Swift helper for window `-7d .. +60d`, filter to `calSource==='Exchange'` and calendar `OUTLOOK_SOURCE_CALENDAR` (default `Calendar`), skip holidays. Helper exports `attendees[]` (`email`, `name`, `responseStatus`) per event.
2. Map each event to `akSourceUid` and compute `akSig` (includes attendees).
3. Fetch **all** Dragontail events in the sync window (for dedup) plus tagged copies (for delete tracking).
4. Diff:
   - Match by `akSourceUid` first, then by normalized `title+start` (`matchKey`) to avoid duplicates.
   - Insert when no match; patch when `akSig` differs or when adopting an untagged existing event; skip when unchanged.
   - Delete tagged copies whose UID disappeared from Outlook.
5. all-day → `start.date`; timed → `start.dateTime` (helper already emits local offset). Skip `status==='cancelled'`.
6. POST/PATCH include `attendees` (email required) and `sendUpdates=none`.

## config (env, in apps/web/.env.local)

- `DRAGONTAIL_GCAL_ID` = `bfa8306ecf5f05d42d22b2349ddbec44d5bd4746dc12940d79e8b3e235add13b@group.calendar.google.com`
- `OUTLOOK_BRIDGE_ACCOUNT` = `alpirkritz@gmail.com`
- `OUTLOOK_SOURCE_CALENDAR` = `Calendar`
- `OUTLOOK_BRIDGE_DAYS_BACK` = `7`, `OUTLOOK_BRIDGE_DAYS_FWD` = `60`

## One-time setup

1. Deploy the scope change + run the app locally and reconnect the personal account in Settings (grants write, populates local SQLite).
2. `bash scripts/install-outlook-bridge.sh` — loads launchd.
3. Verify: run the bridge manually, confirm Outlook events appear in Dragontail with the tag, and that the EC2 event count includes them.

## Out of scope

- Two-way sync (Google → Outlook).
- Running the bridge on EC2 (EventKit unavailable on Linux).
- Deleting/modifying the 3200 existing Dragontail events.
- Changing the existing Apple/ICS integration in the app (optional cleanup later only).

## Optional cleanup (after verification)

- Unsubscribe the `...@import.calendar.google.com` calendar ("Calendar" iCalendar) to avoid duplicate display.

## Open questions

- None.
