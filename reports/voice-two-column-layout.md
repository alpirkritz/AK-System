# Review — voice-two-column-layout

**Verdict:** APPROVED
**Spec:** `docs/specs/voice-two-column-layout.md`
**Detected stack:** `next-trpc-monorepo`

## Changes

| File | Change |
|---|---|
| `apps/web/src/app/voice/page.tsx` | Idle state is a `grid md:grid-cols-2`: recorder first (right in RTL), meetings second (left). `freeOpen` state and `voice-free-toggle` removed; page widened to `max-w-4xl`. |
| `apps/mobile/app/(tabs)/record.tsx` | Free-recording card no longer collapsed behind a toggle; gained the same "הקלטה חופשית" heading and hint. `freeOpen` removed. |
| `apps/web/e2e/email-voice-commitments.spec.ts` | Consent test no longer expands a toggle to reach `voice-start`. |

## Spec conformance

- Two columns on `md`+, single column below, recorder first in DOM so it stacks on top. ✅
- Consent stays full-width above both columns and still gates both the meeting rows (`disabled={!consent}`) and `voice-start`. ✅
- `?meeting=<id>` still renders `voice-preset-meeting` in the meetings column. ✅
- Active / upload / result states untouched and still single column. ✅

## UI/UX Review

**Verdict:** APPROVED

### Design System Checklist
- [x] Matches project tokens/classes — `.card`, `.label`, `.btn btn-primary`, `.btn-ghost`, `.select`, palette unchanged
- [x] RTL layout preserved — column order is DOM order under `dir="rtl"`, separator uses logical `border-e` / `pe-5` rather than `border-l`
- [x] Mobile layout works — grid collapses to one column under `md`, recorder first
- [x] No unapproved UI frameworks introduced
- [x] Reuses existing components (`PeoplePicker`, `MeetingRow`)

### UX Quality Checklist
- [x] Clear visual hierarchy — one primary action per column: tap a meeting, or "התחל הקלטה"
- [x] Cognitive load reduced — the recorder is no longer hidden behind a disclosure; both paths are visible at once
- [x] Feedback states handled — meeting column keeps skeleton / error / empty states; consent warning unchanged
- [x] Destructive actions — `startFresh` still confirms before discarding a pending failed upload
- [x] Microcopy — new heading `הקלטה חופשית` and hint `בלי פגישה מהיומן — בחר משתתפים ופרויקט ידנית.` label the column that used to be self-describing via its toggle
- [x] Touch targets, focus-visible, keyboard navigable — inherited from `.card-interactive` and `.btn`

### Findings
- Must-fix: none.
- Nits: at exactly `md` the two columns are ~400px each, which is tight for `PeoplePicker` chips but does not wrap badly. Revisit only if it looks cramped in use.

## QA

- `pnpm --filter @ak-system/api test` — 1128 passed. 3 files fail for pre-existing reasons unrelated to this change (`audio-features`, `voice-diarization` fail to collect on `spawnSync ffmpeg ENOENT`; `voice-large-file` has an incomplete `GoogleAIFileManager` mock).
- `npx playwright test email-voice-commitments` — 6 passed.
- `pnpm -r run lint` — clean, only pre-existing warnings.
- `pnpm --filter @ak-system/web build` — succeeds.
- `tsc --noEmit` in `apps/mobile` — clean.
