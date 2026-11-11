# Review — record-from-calendar-meeting

**Spec:** `docs/specs/record-from-calendar-meeting.md`
**Detected stack:** `next-trpc-monorepo` (+ `expo` for `apps/mobile`)
**Date:** 2026-10-05
**Verdict:** APPROVED

---

## What was built

The recording screen is now list-first on both web and mobile: it opens on today's calendar meetings, and a single tap on a row starts recording that meeting. The recording inherits the meeting's title, attendees and project server-side, so nothing is retyped. A collapsed "הקלטה חופשית · בלי פגישה" section preserves the previous free-recording flow unchanged.

No schema change was needed. `voice_recordings.meeting_id` and `meeting_people` already carried everything; the new work is the meeting-choice query, the context seeding on upload, and the screens.

### Files changed

| File | Change |
|---|---|
| `packages/api/src/services/voice.ts` | `listMeetingChoices`, `getMeetingChoice`, `meetingAttendeeIds`, `meetingLinkOf`; `saveVoiceUpload` seeds attendees and project from the meeting; `summarize` returns `meetingLink` |
| `packages/api/src/routers/voice.ts` | `voice.meetingChoices`, `voice.meetingContext` |
| `apps/web/src/app/voice/page.tsx` | `MeetingRow`, list-first idle layout, `?meeting=` deep link, meeting header while recording, "מקושר לפגישה" banner, `meetingId` in upload + retry |
| `apps/web/src/app/meetings/components/MeetingCard.tsx` | 🎙 entry point in the hover action area |
| `apps/web/src/app/meetings/[id]/page.tsx` | "🎙 הקלט פגישה" action-bar button |
| `apps/mobile/app/(tabs)/record.tsx` | Same list-first flow, `meeting` state driving upload and `PendingUpload`, banner |
| `apps/mobile/app/meeting/[id].tsx` | "הקלט פגישה" button |
| `apps/mobile/lib/voice.ts` | `fetchMeetingChoices`, `fetchMeetingChoice`, `meetingLink` on the recording type |
| `apps/mobile/lib/theme.ts` | `warning` color token |
| `packages/api/src/services/voice-meeting-choices.test.ts` | New — 14 cases |
| `apps/web/e2e/email-voice-commitments.spec.ts` | New meeting-list test; fixed two stale selectors in the existing consent test |

---

## Spec conformance

Every acceptance criterion is implemented. Notes on the ones worth calling out:

- **Timezone.** `listMeetingChoices` derives both "today" and "now" from `localDateTime`, not `toISOString()`. `meetings.list({ timeRange: 'today' })` still uses UTC and is wrong between midnight and 03:00 Israel time; this feature deliberately does not reuse it. (`voice.ts:listMeetingChoices`)
- **Ignored people.** Both `meetingAttendeeIds` and `toMeetingChoices` filter `people.status = 'ignored'`, so CRM-hidden calendar contacts never leak into a recording or a row.
- **Link kind.** `meetingLink` is derived from `meeting_id` / `created_meeting_id` / `matched_automatically` rather than stored, so no migration and no risk of the three going out of sync.
- **Auto-match unaffected.** `findAutoMatchMeeting` only runs when `meetingId` is unset, so an explicit pick always wins and the post-upload guess stays as the fallback.
- **Upload retry.** The chosen meeting rides along in `failedUpload` (web) and `PendingUpload` (mobile), so "שלח שוב" re-links correctly rather than silently producing a standalone recording.

---

## UI/UX Review

**Verdict:** APPROVED

### Design System Checklist
- [x] Matches project tokens/classes — `.card`, `.card-interactive`, `.pill`, `.btn-ghost`, `.label`; mobile reuses `colors` from `lib/theme.ts`
- [x] RTL layout preserved — `flexDirection: 'row-reverse'` on mobile rows, existing `dir="rtl"` shell on web
- [x] Mobile layout works — rows are `minHeight: 44`, wrap on narrow screens
- [x] No unapproved UI frameworks introduced
- [x] Reuses existing components — `PeoplePicker`, `RecordingContextEditor`, the existing candidate fieldset

### UX Quality Checklist
- [x] Clear visual hierarchy — the rows are the primary targets; the free-recording path is one quiet secondary control
- [x] Cognitive load minimized — 5 rows, then "עוד פגישות להיום"; ended meetings sort last and dim
- [x] All feedback states handled — skeleton rows while loading, Hebrew empty state, non-blocking calendar error, meeting header during recording, banner after
- [x] Destructive actions require confirmation — unchanged; starting a recording over a pending upload still confirms
- [x] Microcopy — "פגישות להיום", "עכשיו", "הקש להתחלת הקלטה", "הקלטה חופשית · בלי פגישה", "מקושר לפגישה", "החלף פגישה"
- [x] Touch targets ≥ 44px; `.card-interactive:focus-visible` provides the ring; rows are real `<button>`/`Pressable` elements with labels including time and title

### Findings
- Must-fix: none.
- Nit: tap-to-start is a one-tap commit, so a mis-tap does start a recording. Mitigated three ways — the meeting header appears immediately, recordings under 10 seconds are discarded, and "החלף פגישה" re-links in one step. This was the explicitly requested behavior.
- Nit: the mobile meetings list keeps its single "הקלט שיחה" button rather than gaining a per-row record action. The button now lands on the list-first screen, so the flow is the same number of taps; a per-row control would have meant restructuring the row for little gain.

---

## QA

| Check | Result |
|---|---|
| `pnpm test` (Vitest) | 1122 passed, 2 failed, 14 skipped — **both failures pre-existing** |
| New `voice-meeting-choices.test.ts` | 14/14 passed |
| `pnpm e2e` — `email-voice-commitments.spec.ts` | 5/5 passed |
| `pnpm -r run lint` | Passed; no new warnings |
| `pnpm --filter @ak-system/web build` | Passed |
| `tsc --noEmit` (apps/mobile) | Clean |

### Pre-existing failures, verified unrelated

- `audio-features.test.ts`, `voice-diarization.test.ts` — collection fails on `spawnSync ffmpeg ENOENT`; `ffmpeg` is not installed on this machine.
- `voice-large-file.test.ts` (2 cases) — the `GoogleAIFileManager` mock returns `undefined` from `deleteFile`, so the `.catch()` in `transcribeViaFilesApi` throws. Reproduced with `services/voice.ts` stashed, so it predates this work.
- 26 further e2e failures across `bank-accounts`, `trading-journal`, `notion-note-meetings`, `ui-refresh`, `meeting-relationships`, `qa-structured`, `full-flow` and others. Sampled causes are strict-mode duplicate-text violations and `FOREIGN KEY constraint failed` in those suites' own seeds. `notion-note-meetings` + `ui-refresh` + `meeting-relationships` were re-run with `MeetingCard.tsx` and `meetings/[id]/page.tsx` stashed and produced the identical 6 failed / 7 passed, confirming this change is not the cause.

### Stale selectors fixed along the way

The existing test `voice page gates recording on consent…` was already failing before this work: it asserted the start button begins disabled (consent has defaulted to checked for a while) and looked for a label `לאיזה אנשים לקשר?` that no longer exists (the field is labelled `משתתפים`). Both were corrected rather than worked around.
