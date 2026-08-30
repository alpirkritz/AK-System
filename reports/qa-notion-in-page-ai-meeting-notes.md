# QA report — notion-in-page-ai-meeting-notes

**Detected stack:** next-trpc-monorepo
**Verdict:** FAIL

- Static check: FAIL — `pnpm -r run lint` (web `next lint` interactive ESLint setup prompt, pre-existing). Mobile + whatsapp-bridge `tsc --noEmit` PASS. `pnpm --filter @ak-system/web build` PASS (~30s).
- Unit tests: 739/739 api + 177/177 web passed
- E2E: 63/77 passed, 2 skipped, 12 failed (none in `e2e/meeting-ai-notes.spec.ts`)
- Server boot: N/A (Next)
- HTTP smoke / API: N/A
- Production config drift: PASS — required vars present (`scripts/validate-production-env.sh`)
- Build freshness: FAIL — local Next distDir is not `apps/web/.next` (tmpdir custom dir); `MEETING_NOTE_SUMMARY_CAP` was bumped after the QA build. A deploy must rebuild.
- Total time: ~12 min (build + unit + e2e)

## Per-phase results

### 1. Static

`CI=true pnpm -r run lint` — `@ak-system/web` `next lint` failed: “How would you like to configure ESLint?” (no ESLint config). Same as prior QA.

`pnpm --filter @ak-system/web build` — Compiled successfully (types skipped, as usual).

### 2. Unit/integration tests

`pnpm test` — PASS.

Feature cases:

- `extractAiMeetingSummary` keeps structured notes, drops transcript sibling
- `query: שני` + `date: today` returns the English-titled Shani meeting note
- `titlesShareKnownPerson` links “Shani & Alpir 1:1” to “Status update with Shani”, not Algo↔Algo
- `shouldFetchNoteBody` re-fetches `sourceKind: meeting_page` transcript dumps

### 3. E2E

`pnpm e2e` — FAIL 12 / 77. Failures are unrelated to meeting-notes ingest:

- `assistant-chat-ux.spec.ts` (uncommitted chat UX WIP)
- dashboard `/שלום/` greeting (`full-flow`, `qa-structured`)
- strict-mode locators (`חיובי אשראי`, `P&L ממומש`)
- WhatsApp insights `page.goto` timeout after webserver ECONNRESET

**In-page AI Meeting Notes Playwright:** both tests in `e2e/meeting-ai-notes.spec.ts` passed (detail excerpt + meetings list calendar sync).

### Live Notion extract (today / Shani)

Probed Meetings DB page `Status update with Shani` (2026-08-30). Structured summary kept (`Perspectives`, `Action Items`); transcript sibling skipped (`hasTranscriptPhrase: false`). This is the contract Hugo should answer from — not the raw dialogue.

## Failures (if any)

- `apps/web` lint: `next lint` interactive prompt (pre-existing).
- E2E list above — not caused by this change (qa-agent did not fix).
- Build freshness: rebuild required before deploy.

## Notes

- Production Hugo still has the old transcript dump until a meetings-scope sync runs after deploy (`sourceKind: meeting_page` forces re-extract).
- Hebrew query `שני` maps to `Shani` via `packages/api/src/lib/person-name-match.ts`.
- Full Gemini/Hugo chat was not invoked in this QA pass; contract is covered by `insights.meetingNotes` + live extract.
