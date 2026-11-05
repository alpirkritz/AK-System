# Review: recording-uses-chosen-people

**Verdict: APPROVED WITH NITS**
**Date:** 2026-11-05
**Spec:** `docs/specs/recording-uses-chosen-people.md` (Approved, defaults: aliases learned automatically; model attributions are `auto` and can be corrected)

## What changed

- New `packages/api/src/services/people-resolve.ts`:
  - `namesMatch`, moved out of commitments.
  - `resolveCandidate`: exact name or alias first, then loose matching; returns null if the name fits more than one candidate.
  - `loadPersonCandidates`
  - `linkAnalysisPeople`: drops a `personId` that isn't a candidate, links by name or alias, swaps in the People name, and learns the spoken form as an alias with `origin: 'analysis'`. A clashing alias is not saved, but the link is kept.
  - `withPersonNames`
- `voice-diarization.ts`
  - `attributeSpeakersFromCandidates` is a text-only Gemini pass:
    - Its answers are limited by the response schema to unknown speakers and candidate ids, or null.
    - It never overwrites speakers set by hand, skipped, or matched by the owner's voice.
    - If two speakers get the same person, both stay unknown.
  - Runs after the two-person rule.
  - `notifyUnknownSpeakers` says how many speakers are left.
- `voice.ts`: processing and the re-analysis after a manual answer both go through the shared `analyzeRecordingTranscript`, which passes `candidates` and links names.
- `meeting-analysis.ts`
  - New `candidates` option with a canonical-name rule.
  - `personId` (an enum of candidate ids) on participants and action items.
  - `spokenAs` / `ownerSpokenAs` are used only to learn aliases.
- `commitments.ts`: an item's `personId` wins over name matching.
- Routers: `voice.speakers` adds `candidate`; `voice.getAnalysis` and `meetings.getAnalysis` add `personName`.
- Web:
  - `voice/page.tsx`: the speaker picker shows the chosen people not yet assigned first, and linked owners link to the person.
  - `ConversationAnalysis.tsx`: linked participants and owners link to the person, and a linked owner is used as the task assignee.

## Checks

| Check | Result |
|---|---|
| `voice-chosen-people.test.ts` (new) | 15/15 |
| `voice-speakers.test.ts` | pass. One expectation updated: the action item now carries `personId` |
| `pnpm test` (full) | api 1516/1516, web 330/330 |
| Playwright `recording-uses-chosen-people.spec.ts` | pass |
| `pnpm -r run lint` / web build | no errors / passes |

## Nits / notes

1. **E2E seeds the end state:** the e2e test seeds the state the pipeline leaves behind, because the running app has no way to fake Gemini. The pipeline itself is covered by Vitest with fakes.
2. **Where it differs from the spec:**
   - `personId` is left out instead of stored as null.
   - Candidates are everyone in `voice_recording_people` (including people added later by hand), plus the owner.
   - Elimination is a clue in the prompt only, with no fixed rule, because a chosen person may never speak.
3. **Pre-existing bug, not fixed:** on a retry that reuses the stored transcript, `processVoiceRecording` calls `saveTranscriptSegments` with an empty list. That deletes the speaker segments, so the speaker list and the attribution pass are lost on that retry. Worth its own fix.
4. **Shared working tree:** while this was being built, another session ("voice-recording-never-lost") was working in the same checkout, also in `voice.ts` and `voice/page.tsx`. Review the diff by hunk before committing, so each change lands with its own spec.
5. **Same 35 e2e failures** as listed in `reports/circle-members-from-people.md`, which this change didn't cause.
