# Reviewer report — whatsapp-commitment-scan-llm

**Verdict: APPROVED**

## What changed

`scanDmCommitments` and `scanGroupCommitments` (`packages/api/src/services/whatsapp-dm.ts`) now classify messages through Gemini (`classifyMessagesWithModel`, exposed as `defaultClassify`) instead of the fixed-verb regex, with automatic fallback to the regex heuristic (`heuristicClassifications`) when `GEMINI_API_KEY` is unset, the model call throws, or its response isn't valid JSON. Both scan functions accept an optional `{ classify }` override for tests, mirroring the existing `summarizeDmChats(db, { generate, now })` pattern. `proposeCommitments` now returns the inserted items (not just a count) so callers can build per-item notification text; `commitments.ts` gained `buildCommitmentNotification` for that, and both DM/group cron routes now include the chat/group name and commitment content in the notification instead of a bare "there's a commitment" message.

## Verification

Copied the repo to an isolated `/tmp` checkout (Google-Drive-mounted working tree doesn't tolerate pnpm's install/build I/O directly), installed deps, ran:

- `pnpm test` (Vitest, both `packages/api` and `apps/web`): **962/963 passing.** The one failure (`voice-diarization.test.ts`, "never throws... when the audio file does not exist") is a pre-existing bug in that test's own setup helper (`fs.statSync` on a path that's supposed to be missing) — confirmed unrelated by `git status`, which shows no diff touching that file or anything near it this session.
- New/updated tests, all passing: `whatsapp-commitment-classifier.test.ts` (new — exercises `defaultClassify`'s model path, JSON/id-validation guard, and every fallback trigger), `whatsapp-dm.test.ts` (new case: injected classifier catches "אל תשכח להביא לה בשישי", correct `owner` attribution), `whatsapp-group-commitments.test.ts` (new case: injected classifier wired per-group with correct speaker labels, still gated on sender resolution), `commitments.test.ts` (new — `buildCommitmentNotification` single/multi/overflow cases).
- Two bugs caught by this verification pass and fixed before landing: the new DM test asserted on the literal id `'m1'`, but `ingestDmMessages` assigns its own row id, so the injected classifier never matched anything — fixed by keying off whatever id the classifier is handed. The new group test asserted the wrong `owner` for a "request" from a non-self sender (copy-paste slip) — corrected to `'me'`, matching the same owner formula already used (and tested) on the DM side.
- `pnpm -r run lint`: clean (pre-existing warnings only, none in touched files).
- `pnpm --filter @ak-system/web build`: succeeds.

## Notes

- Cost/behavior tradeoffs (latency, occasional false positives, spend scaling with message volume) were discussed with the owner before implementation; no rate limiting or opt-out toggle was in scope per the spec.
- Nightly digest (`summarizeDmChats`/`generateDmDigest`) is untouched — this only touches the two 10-minute scans, as specified.
