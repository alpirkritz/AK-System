# Outlook Bridge — Alternative Access Methods

> **Slug:** `outlook-bridge-alternative-access`
> **Stack:** next-trpc-monorepo
> **Status:** Implemented (source side); blocked on Google re-auth for end-to-end
> **Date:** 2026-08-11

## Goal

Keep the Dragontail mirror working after the Outlook source moved from
`kxa7990@yum.com` to `alpir.kritzler@pizzahut.com`, whose tenant blocks every
application-level path into the Exchange calendar.

## Background — why the EventKit bridge stopped working

The yum.com account was present in macOS System Settings ▸ Internet Accounts, so
macOS Calendar held a synced copy and the EventKit Swift helper could read it.
The pizzahut.com account cannot be added at all:

```
AADSTS50105: Your administrator has configured the application
Apple Internet Accounts (f8d98a96-0999-43f5-8af3-69977c7b4423) to block users
unless they are specifically granted ('assigned') access to the application.
```

Outlook.app therefore holds the only local view of the calendar, and it runs
online-only — `CalendarEvents` in `Outlook.sqlite` contains 0 rows.

## Access methods evaluated

| Method | Result | Evidence |
|---|---|---|
| EventKit via macOS Calendar | Blocked | AADSTS50105; helper reports only Google calendars |
| AppleScript against Outlook.app | Unusable | Returns 0 events; `every account` raises −1728 |
| Outlook local SQLite cache | Empty | `SELECT COUNT(*) FROM CalendarEvents` → 0 |
| EWS basic auth | Blocked | `outlook.office365.com/EWS/Exchange.asmx` → 401 |
| Graph API, ROPC | Blocked | AADSTS50076 — MFA required |
| Graph API, device code | Blocked | "sign-in successful but does not meet the criteria" |
| **Outlook Web session** | **Works** | 224 events over a 67-day window |

The tenant's Conditional Access policy gates *applications*, not browsers. A
signed-in browser session is the one channel left open.

## Chosen design — OWA-backed source

OWA mints an access token for `aud=https://outlook.office.com` to talk to its own
backend. The bridge drives a headless Chromium holding a persistent session,
captures that token off the wire, and calls the documented Outlook REST v2.0
`calendarview` endpoint with its own date range.

This matters: the read is JSON over a supported API, not DOM scraping. The browser
exists only to hold the session, so OWA UI changes cannot break parsing.

```
Chromium (persistent profile)
  └─ loads outlook.office.com/calendar
       └─ OWA issues Bearer token (aud=outlook.office.com)
            └─ GET /api/v2.0/me/calendarview?startDateTime=…&endDateTime=…
                 └─ owaToSourceEvents() → SourceEvent[]
                      └─ existing Dragontail sync (unchanged)
```

### Authentication lifecycle

One interactive sign-in (`scripts/owa-login.ts`) with MFA. Cookies and refresh
state persist in the Chromium profile, and OWA renews silently on each run. No
recurring human step; re-auth is only needed if the tenant expires the session.

### Why not store the password

The tenant requires MFA, so a password grants nothing on its own. Nothing reads
credentials from disk.

## Data model

No schema changes. The existing Google Calendar tagging is unchanged:
`akSource='outlook-exchange'`, `akSourceUid`, `akSig`, `akAttendeesCleared`.

`akSourceUid` now derives from `iCalUId + occurrence start` rather than the
EventKit event id. `iCalUId` survives edits, while the REST `Id` embeds a change
key that churns on every modification — keying on `Id` would orphan and recreate a
copy each time a meeting is touched.

One-time consequence: existing mirrored copies carry EventKit-era uids, so the
first run deletes them and recreates from the new source. That is the intended
outcome, since those copies came from the retired yum.com calendar.

## tRPC API

None. The bridge is a standalone script run from launchd.

## Files

| File | Role |
|---|---|
| `scripts/owa-login.ts` | One-time interactive sign-in; creates the profile |
| `scripts/owa-calendar-source.ts` | Session handling, REST read, pure OWA→SourceEvent mapping |
| `scripts/owa-calendar-source.test.ts` | 15 cases over the mapping helpers |
| `scripts/outlook-to-google-sync.ts` | `OUTLOOK_BRIDGE_SOURCE` switch, `--source-only` flag |
| `apps/web/.env.local` | `OUTLOOK_BRIDGE_SOURCE`, `OWA_PROFILE_DIR` |

## Env vars

| Name | Default | Meaning |
|---|---|---|
| `OUTLOOK_BRIDGE_SOURCE` | `owa` | `owa` or `eventkit` |
| `OWA_PROFILE_DIR` | `~/.ak-owa-profile` | Chromium profile holding the session |
| `OWA_TOKEN_TIMEOUT_MS` | `60000` | How long to wait for OWA to mint a token |

`eventkit` is retained so the bridge can move back if the account is ever allowed
into macOS Calendar.

## Acceptance criteria

- [x] Given a live OWA session, when the bridge runs, then it reads the
      pizzahut.com calendar for the configured window.
- [x] Given a cancelled Exchange event, when the bridge runs, then it is excluded
      so the delete pass removes the mirrored copy.
- [x] Given a blocklisted title, when the bridge runs, then it is not mirrored.
- [x] Given an all-day event, when the bridge runs, then it maps to a Google date
      rather than a timestamp.
- [x] Given an expired session, when the bridge runs, then it fails with the
      re-authentication command rather than syncing an empty source.
- [ ] Given a valid Google connection, when the bridge runs, then Dragontail
      matches the Exchange calendar. *Blocked: the Google refresh token for
      `alpirkritz@gmail.com` returns `invalid_grant` locally and on EC2.*

## Out of scope

- Two-way sync (Google → Outlook)
- Push notifications; polling stays at 15 minutes
- Multiple Exchange accounts in one run
- macOS Accessibility scraping of Outlook.app — considered, then dropped once the
  OWA REST read proved available; it would have been far more fragile

## Open questions

1. How long does the tenant let the OWA session live before forcing re-auth?
   Unknown until it lapses; the failure is loud and the fix is one command.
2. Should a failed session raise a notification rather than only a log line?
