# Review — Outlook Bridge Alternative Access

> **Slug:** `outlook-bridge-alternative-access`
> **Date:** 2026-08-11
> **Verdict:** APPROVED WITH NITS (source side) — end-to-end still blocked on Google re-auth

## What changed

The bridge's Exchange source is now pluggable. `OUTLOOK_BRIDGE_SOURCE` selects
between the new Outlook Web reader (default) and the original EventKit helper.
Everything downstream — uid matching, adoption of untagged duplicates, the delete
pass, blocklisting, attendee stripping — is untouched.

| File | Change |
|---|---|
| `scripts/owa-login.ts` | New. One-time interactive sign-in creating the persistent profile |
| `scripts/owa-calendar-source.ts` | New. Session handling, REST read, pure mapping helpers |
| `scripts/owa-calendar-source.test.ts` | New. 15 cases |
| `scripts/outlook-to-google-sync.ts` | Source switch, `--source-only` flag, darwin guard scoped to eventkit |
| `apps/web/.env.local` | `OUTLOOK_BRIDGE_SOURCE=owa`, `OWA_PROFILE_DIR` |
| `docs/specs/outlook-bridge-alternative-access.md` | Rewritten around the validated approach |

Removed throwaway probes: `test-ews-connection.ts`, `test-ews-multi.ts`,
`graph-calendar-reader.ts`, `outlook-graph-sync.ts`, `outlook-direct-sync.ts`,
`outlook-direct-reader.sh`, `owa-probe.ts`.

## Verification

| Check | Result |
|---|---|
| `scripts/owa-calendar-source.test.ts` | 15/15 pass |
| Typecheck on the three changed scripts | No errors attributable to them |
| `--source-only` against the live calendar | 151 events, 4 blocked by title |
| All-day handling | PTO/OOO entries map to dates, not timestamps |
| Cancellations | "Canceled: Pentest Results Review" excluded; original retained |
| Full sync | **Not run** — Google returns `invalid_grant` |

## Findings

**1. Google refresh token is dead — blocks the finish line.** `invalid_grant` for
`alpirkritz@gmail.com` both locally and from `scripts/pull-google-token-from-ec2.sh`.
Predates this work and needs a human: reconnect Google from `/settings`. Until then
the write half is unverified, including the first-run churn described below.

**2. First run will delete and recreate every mirrored copy.** `akSourceUid` moved
from EventKit ids to `iCalUId + start`, so existing copies look orphaned. Intended —
they came from the retired yum.com calendar — but it is a visible one-time change,
and worth watching on the first real run.

**3. Session lifetime is unknown.** *(nit)* If the tenant expires the OWA session,
the run fails loudly with the re-auth command, which is the right failure mode, but
it surfaces only in the bridge log. Consider routing it to a notification.

**4. `scripts/outlook-to-google-sync.test.ts` cannot load.** *(pre-existing)*
`Failed to load url drizzle-orm/better-sqlite3`. Confirmed against the unmodified
file via `git stash`. Unrelated to this change; the suite is effectively dark and
should be fixed separately.

**5. Credentials were pasted into the working tree during exploration.** Three probe
scripts carried the Exchange password in plaintext. All deleted. Nothing in the final
design reads a password. Given the exposure, rotating that password is prudent.

## Security notes

- No credentials are stored by the shipped code.
- The Chromium profile at `~/.ak-owa-profile` holds live session cookies. It sits
  outside the repo and must never be committed; treat it like a keychain item.
- Attendee emails still never reach Google as real attendees — `attendees: []` is
  written unconditionally, so no invitations are sent on anyone's behalf.

## Remaining work

1. Reconnect Google (`/settings`) — user action.
2. Run the bridge for real and confirm Dragontail matches Exchange.
3. Confirm the launchd agent succeeds headless on its 15-minute cadence.
