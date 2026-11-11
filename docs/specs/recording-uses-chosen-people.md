# Recording uses the people chosen before upload

> **Slug:** `recording-uses-chosen-people`
> **Status:** Approved
> **Last Updated:** 2026-11-05
> **Related:** `circle-members-from-people` (same principle: every name is a People record), `auto-identify-two-person-speakers`, `recording-context-before-upload`

## Goal

When the owner picks participants before uploading a recording, processing should use them as the answer to "who was here". Today:

- Speaker auto-identification works only for a two-person conversation (`autoIdentifyTwoPersonConversation`). With three or more speakers you still get the "מי מדבר בהקלטה?" prompt, even though you already said who was there.
- The analysis gets the names as context (`participantNames` / `knownPeople`), but the prompt says to write owners "as mentioned in transcript". So it returns "עומרי" instead of "Omri Ben Simon". `proposeCommitmentsFromAnalysis` then fails to match across scripts (`namesMatch` compares normalized strings), so the action item never reaches the person.

After this change, the chosen people are the candidate set. Speakers and names in the analysis resolve to those People records (by id), in any spelling or script. You are asked only about what is truly unresolved.

## User Stories

- As the owner, I want the people I chose before upload to be used to identify speakers, so I'm not asked "who's talking" about people I already named.
- As the owner, I want "עומרי" in the conversation to show in the summary, participants and action items as Omri Ben Simon, linked to his People record. Omri is just an example; this applies to any participant, in either direction (Hebrew ↔ English, first name only, nickname).
- As the owner, I want an action item owned by a chosen participant to reach that person's commitments.
- As the owner, I want to see what was identified automatically and be able to correct it.

## Acceptance Criteria

### Speakers

- [ ] After transcription and the existing self-voice step, if the recording has chosen people (`voice_recording_people`), a text-only attribution pass runs. There is no new audio upload or transcription. It receives the transcript turns by speaker label and the candidates: the owner plus the chosen people, with names, aliases, role and company. It returns at most one candidate per label. Candidates are restricted to that list (response-schema enum of ids), and `null` means "not sure".
- [ ] Clues it uses: someone addressed by name ("עומרי, מה אתה אומר?"), self-introduction, the reply after being addressed, role/topic, and elimination (one speaker left and one candidate left).
- [ ] Each attributed label is saved in `voice_speaker_identities` with `state = 'auto'`. Labels already `identified` / `skipped` by hand, or the self-voice match, are never overwritten. The same person is never assigned to two labels. A conflict leaves both unknown.
- [ ] The existing two-person rule stays as a deterministic shortcut. The new pass runs only on labels still unknown.
- [ ] `notifyUnknownSpeakers` sends the "מי מדבר בהקלטה?" notification only if unknown labels remain after this pass. Its text then states how many are left ("נשאר דובר אחד שלא זוהה").
- [ ] In the "who's speaking" section on `/voice`, the picker for an unknown speaker shows chosen people not yet assigned first, then everyone else. Auto matches show "זוהה אוטומטית: <name>" with a correction option (existing behavior).
- [ ] Without chosen people, behavior is unchanged (no extra Gemini call).

### Names in the analysis

- [ ] The analysis prompt receives the candidates with ids and aliases and an explicit rule: when the conversation refers to a participant in any form (first name, nickname, other script, e.g. "עומרי" → "Omri Ben Simon"), write the exact canonical name from the list and fill `personId`. It must not invent people who aren't on the list. Someone not on the list keeps the name as spoken, with `personId = null`.
- [ ] `participants[]` and `actionItems[].owner` in the response schema gain `personId` (an enum of candidate ids, or null).
- [ ] Deterministic post-processing before saving `participantsJson` / `actionItemsJson`: an item whose `personId` is not a candidate is set to null. An item with no `personId` is matched to a candidate by `namesMatch` + `person_aliases` (existing logic, moved to a shared helper). When an item is linked, its `name` / `owner` is replaced with `people.name`.
- [ ] When a cross-script link was made by the model (the spoken name differs from the canonical name and from every alias), the spoken form is added to `person_aliases` (if missing), so the deterministic match catches it next time.
- [ ] `proposeCommitmentsFromAnalysis` prefers an item's `personId` over name matching.
- [ ] On `/voice` and `/meetings/[id]`, a linked participant or action-item owner is shown with its People name and links to the person. An unlinked name shows as it does today.
- [ ] The text-only re-analysis after manual speaker resolution (`refreshVoiceAnalysisAfterSpeakerResolution`) goes through the same pipeline and the same post-processing.
- [ ] Existing analyses with no `personId` in their JSON display as before.

## Data Model

No new tables or columns.

- `voice_speaker_identities` (existing, `state = 'auto'`).
- `person_aliases` (existing): new rows from cross-script links.
- `meeting_analyses.participants_json` / `action_items_json` (text JSON): items gain an optional `personId` field. No change to `schema.pg.ts` / `schema.ts`.

## tRPC API

- `voice.speakers`: unchanged in shape. Items keep `personId` / `personName` / `state`. New `candidate: boolean` field, true when the person was chosen before upload (for ordering the picker).
- `meetings.getAnalysis` / the voice recording view: `participants[]` and `actionItems[]` items include `personId` and, when linked, `personName`.
- No new procedures. Logic lives in `services/voice-diarization.ts` (new `attributeSpeakersFromCandidates`), `services/meeting-analysis.ts` (prompt + schema), and a shared `services/people-resolve.ts` (`resolveCandidate(name, candidates)`, used by analysis and commitments).

## UI Surface

- `apps/web/src/app/voice/page.tsx`: picker ordering in the speaker section; linked names in the analysis.
- The meeting analysis display on `/meetings/[id]`: linked names.
- RTL, dark theme, existing classes. Mobile unchanged.

## Tests

- Vitest: three-speaker attribution with a fake analyzer (name addressed, elimination, conflict → unknown, manual identity is not overwritten); no prompt when everything is resolved; prompt with the count when one is left; prompt + post-processing: "עומרי" with personId → name is replaced with "Omri Ben Simon" and an alias is added; a personId that isn't a candidate → null; commitments use personId.
- Playwright: a recording with three chosen people and a fake analyzer → no "who's speaking" section, the action item shows the People name.

## Out of Scope

- Voiceprints for people other than the owner (voice identification of others).
- Auto-creating People records from names in the analysis that weren't chosen.
- Changing the transcription itself (labels stay "דובר N" in `transcript_text`).

## Open Questions

Resolved 2026-11-05 (approved with defaults): cross-script aliases are saved automatically; model speaker attributions are `auto` and correctable, with no confirm step.
