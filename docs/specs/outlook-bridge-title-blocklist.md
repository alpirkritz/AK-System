# Outlook Bridge — Title Blocklist for Global Broadcast Events

> **Slug:** `outlook-bridge-title-blocklist`
> **Stack:** next-trpc-monorepo
> **Status:** Draft
> **Last Updated:** 2026-08-05

## Goal

Let the Outlook → Dragontail bridge skip company-wide broadcast invites (Town Halls, "Tech Hour", mass HOLD placeholders) so they never reach the Dragontail calendar. These events carry thousands of attendees, are never actionable for the owner, and crowd out real meetings in the calendar UI and in every agent brief that reads Dragontail.

## Background

Two separate problems surfaced together on 2026-08-05:

1. **Duplicates (already resolved operationally, not in this spec).** A retired standalone agent, `com.alpir.exchange-to-gcal` (project `DEV/exchange-to-gcal-agent`, tag `extendedProperties.private.source=exchangeSync`), re-inserted the same events every 15 minutes between 2026-06-14 and 2026-06-28 without deleting its previous copies — 4,376 duplicate events across 8 titles, of which 710 were `Global D&T Town Hall [HOLD]`. Its dedup keyed on a description that changed between runs because the ~2,000-attendee list is truncated at Google's 8 KB description limit. The launchd agent has been booted out and its plist disabled; the duplicates were deleted by a one-off cleanup. The current bridge (`akSource=outlook-exchange`) never created any of them.
2. **Noise (this spec).** Even with exactly one copy each, these global invites are unwanted in Dragontail.

## User stories

- As the owner, I do not want company-wide broadcast invites mirrored into Dragontail at all.
- As the owner, I want to control which titles are filtered without editing code.
- As the owner, when I add a pattern to the blocklist, I want the bridge to remove copies it previously created for that title on the next run.
- As the owner, I want the filter to never touch Dragontail events the bridge did not create.

## Acceptance criteria

- Given `OUTLOOK_BRIDGE_TITLE_BLOCKLIST` is unset or empty, when the bridge runs, then behaviour is identical to today (no event is filtered).
- Given the blocklist contains `town hall`, when an Outlook event titled `Global D&T Town Hall [HOLD]` is read, then it is excluded from the source set and no Dragontail event is created for it.
- Given a bridge copy already exists for a now-blocked title, when the bridge runs, then that tagged copy is deleted (it falls out of `sourceUids`, which the existing delete pass already handles).
- Given an untagged Dragontail event matches a blocked pattern, when the bridge runs, then it is left untouched.
- Given patterns differ in case or surrounding whitespace, when matched, then matching is case-insensitive and trimmed.
- Given a pattern is an empty string between separators, when parsing, then it is ignored (an empty pattern must never match everything).
- Given the bridge filters events, when it logs its summary, then the number of blocked events is reported.

## Data model changes

None. No table touched in `schema.pg.ts` or `schema.ts`.

## tRPC API

None. The bridge is a standalone script, not a router.

## Configuration

New optional env var, read in `scripts/outlook-to-google-sync.ts` and documented alongside the other bridge vars in `docs/specs/outlook-to-google-bridge.md`:

- `OUTLOOK_BRIDGE_TITLE_BLOCKLIST` — comma-separated, case-insensitive **substrings** matched against the Outlook event title. Default: empty (no filtering).

Substrings rather than regex: the values live in `apps/web/.env.local`, which is `source`d by `scripts/outlook-bridge-run.sh`, so regex metacharacters and shell quoting interact badly. Substring matching covers every observed case.

Proposed initial value for this machine:

```
OUTLOOK_BRIDGE_TITLE_BLOCKLIST=town hall,townhall,tech hour,[hold]
```

## Files to change

- `scripts/outlook-to-google-sync.ts` — export two pure helpers, `parseBlocklist(raw)` and `isBlockedTitle(title, patterns)`; apply them in `main()` to the output of `toSourceEvents`, and log how many events were blocked. Keeping the filter out of `toSourceEvents` leaves that function's contract unchanged and makes the blocked count a plain subtraction.
- `scripts/outlook-to-google-sync.test.ts` — unit tests for the criteria above.
- `apps/web/.env.local` — set the initial value (not committed).
- `docs/specs/outlook-to-google-bridge.md` — add the new var to its config list.

## Out of scope

- Filtering by attendee count or organizer domain. Attendee-count thresholds were considered (the Town Hall has 2,066 attendees) but a title blocklist is predictable and easier to reason about; revisit only if titles prove too varied.
- A UI for managing the blocklist.
- Retroactive deletion of untagged legacy copies — handled by the one-off cleanup, not by the bridge.
- Any change to Google/Apple calendar sync inside `apps/web` or `packages/api`.

## Open questions

- None.
