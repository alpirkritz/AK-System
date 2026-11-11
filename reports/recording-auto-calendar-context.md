# Reviewer Report: recording-auto-calendar-context

**Verdict: APPROVED WITH NITS** (pending a local `pnpm test` run — see QA Gate below)

## What changed

Implements `docs/specs/recording-auto-calendar-context.md`: in-app voice recordings now auto-attach to the right calendar meeting (title + already-synced attendees) when exactly one calendar-sourced meeting overlaps the recording's time window, scoped by the existing "יומנים לסוכנים" (`userSettings.agentCalendarIds`) setting. No match, or more than one candidate, falls back unchanged to today's manual attach-candidates flow.

- `packages/database/src/schema.pg.ts`, `schema.ts`, `src/index.ts` — new `meetings.calendarId` (which connected calendar a synced meeting came from — didn't exist before; required to make scope filtering possible at all) and `voiceRecordings.matchedAutomatically`, with SQLite bootstrap ALTERs and fresh-DB CREATE TABLE updated.
- `packages/api/src/routers/meetings.ts` — calendar-sync now persists `calendarId` on both insert and update paths.
- `packages/api/src/services/voice.ts` — new `findAutoMatchMeeting()`; wired into `processVoiceRecording` ahead of placeholder-meeting creation; `matchedAutomatically` surfaced on `VoiceRecordingSummary` (flows through the existing `voice.get` query, no new endpoint).
- `apps/web/src/app/voice/page.tsx`, `apps/mobile/app/(tabs)/record.tsx`, `apps/mobile/lib/voice.ts` — confirmation banner ("זוהתה אוטומטית: … / לא נכון? בחר פגישה אחרת") on both platforms when auto-matched; candidate list still reachable, never silently overridden.
- `apps/web/src/app/settings/page.tsx` — one-line copy update on the existing calendar-scope setting; no new settings UI, since scope is fully shared with the agent's existing setting.
- Tests: `packages/api/src/services/voice-auto-match.test.ts` (new) covers `findAutoMatchMeeting` — no match, single match, ambiguous (2+) match, non-calendar source excluded, scope include/exclude, null-calendarId treated as in-scope — plus `processVoiceRecording` integration (auto-attach vs. placeholder fallback). `packages/api/src/routers/email-voice-commitments.test.ts` — the one existing test whose fixture now legitimately auto-matches (a calendar meeting existed before `processVoiceRecording` ran) was split into an auto-match assertion and a separate manual-attach test that inserts the calendar meeting *after* processing, preserving original coverage of `attachVoiceRecording`'s move/cleanup logic.

## Correction made mid-implementation

The spec originally assumed `agentCalendarIds` scope could filter existing `meetings` rows directly. It can't: `meetings` never stored which calendar (of possibly several) a synced event came from, and the calendar-sync cron always syncs every calendar unconditionally (`calendarIds: null` in `apps/web/src/app/api/cron/calendar-sync/route.ts`). Added `meetings.calendarId`, populated at sync time, to make scope filtering meaningful; documented in the spec's Data Model section. No product-facing behavior changed from what was approved (same defaults, same shared setting, same banner).

## QA Gate

- `pnpm -r run lint` (`next lint` on `apps/web`, the only package with a lint script): **ran clean** — no new warnings on any file touched by this change (pre-existing warnings elsewhere untouched).
- `pnpm test` / `pnpm --filter @ak-system/web build`: **could not run in this sandbox.** `better-sqlite3`'s and `esbuild`'s native binaries in `node_modules` are macOS arm64 (Mach-O); this session runs Linux. Re-running `pnpm install` here to fix that was avoided deliberately — this repo's `node_modules` lives in the connected Google Drive folder synced to the user's Mac, and rebuilding native modules for Linux in place would break the user's local `pnpm dev`. `next build` was also attempted and got past module resolution into webpack compilation before hitting an unrelated `EPERM` unlinking `public/sw.js` on the Drive-mounted filesystem — an environment/mount limitation, not a code issue.
- **Recommendation:** run `pnpm test && pnpm -r run lint && pnpm --filter @ak-system/web build` locally before merging. The new test file is written to the project's existing patterns (`getTestDb()`/`resetDb()`, same fixtures style as `email-voice-commitments.test.ts`) and should run as-is.

## Out of scope / follow-ups (per spec)

Match window size (±15 min, applied both sides), imported-file timestamp reliability, and tie-breaking instead of bailing on ambiguous matches are open questions left for follow-up, not blockers — current behavior is conservative (never guesses among multiple candidates).
