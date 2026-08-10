# Review — Outlook Bridge Title Blocklist

> **Slug:** `outlook-bridge-title-blocklist`
> **Spec:** `docs/specs/outlook-bridge-title-blocklist.md`
> **QA:** `reports/qa-outlook-bridge-title-blocklist.md`
> **Date:** 2026-08-05

## Scope reviewed

- `scripts/outlook-to-google-sync.ts` — new `parseBlocklist` / `isBlockedTitle`, applied in `main()`.
- `scripts/outlook-to-google-sync.test.ts` — 9 new cases (21 total in the file).
- `docs/specs/outlook-to-google-bridge.md` — config list updated.
- `apps/web/.env.local` — blocklist value set (gitignored, not part of the diff).

Also reviewed as part of the same incident, but operational rather than code: booting out `com.alpir.exchange-to-gcal` and deleting 4,376 duplicate Google Calendar events.

## Findings

### Correctness

`scripts/outlook-to-google-sync.ts:206-219` — `parseBlocklist` filters out blank entries before returning, so a stray comma (`'town hall,,'`) can't produce an empty-string pattern that `String.includes` would match against every title. This is the one input that would have silently emptied the calendar, and it is both guarded and tested.

`scripts/outlook-to-google-sync.ts:498-501` — the filter is applied to the output of `toSourceEvents` rather than inside it. `toSourceEvents`'s contract is unchanged, and `blocked` is a plain subtraction of two array lengths, so the logged count cannot drift from what was actually filtered.

Deletion of already-synced copies is inherited rather than added: a blocked event never enters `sources`, so its uid is absent from `sourceUids` (`:509`) and the existing delete pass at `:557-561` reclaims the tagged copy. No new deletion code path, and the guard that only tagged copies are ever deleted is untouched. The live dry run confirmed `deleted 3`.

### Safety

The blocklist can only ever *remove* events from the bridge's source set. It cannot cause a write to an untagged Dragontail event, and the `isBridgeCopy` gate on deletion is unchanged. Worst case of a bad pattern is that a wanted meeting stops mirroring — visible, reversible by editing one env var, and it does not destroy the Outlook original.

### Configuration

`OUTLOOK_BRIDGE_TITLE_BLOCKLIST` is quoted in `.env.local`. This matters: `scripts/outlook-bridge-run.sh:19-24` does `set -a; source "$ENV_FILE"`, and the unquoted value would have parsed as `OUTLOOK_BRIDGE_TITLE_BLOCKLIST=town` followed by an attempt to run `hall,townhall,tech` as a command — under `set -euo pipefail` that aborts the whole run. Caught before the first live run and verified by sourcing the file. The requirement is now documented in both specs, which is the right place for it since `.env.local` is gitignored and can't carry the warning into version control.

Substring matching over regex is the right call given the value passes through a shell `source`; regex metacharacters plus shell quoting is a bad combination for a value a human edits by hand.

### Tests

Nine new cases cover every acceptance criterion including the blank-pattern edge case and the orphaned-copy behaviour. The orphan test asserts both that `planSyncActions` returns an empty plan and that the uid is absent from the set the delete pass consults, which is the actual mechanism rather than a proxy for it.

## Nits

- `docs/specs/outlook-bridge-title-blocklist.md` documents the retired `exchange-to-gcal` agent as background. That history is the reason this filter exists at all, so it belongs somewhere, but it may be worth also recording in `M_Memory/agents_daily_sync.md` so it is findable from the run log rather than only from a spec.
- The current patterns are tuned to three observed titles. If the organizer renames the series (`* D&T Townhall` already appeared as a variant in the old duplicate data), the filter silently stops matching. The `blocked by title` count in the log is the signal to watch — if it drops to 0, a pattern has gone stale.

## Verdict

**APPROVED.**

Implementation matches the spec, the risky input is guarded and tested, and the shell-quoting hazard was caught before it could break the launchd run. The `apps/web` lint failure is pre-existing (no ESLint config; `next lint` prompts interactively) and unrelated to this change.
