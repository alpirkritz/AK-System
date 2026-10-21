# QA Report: Auto-identify speakers in two-person recordings

> **Slug:** `auto-identify-two-person-speakers`
> **Date:** 2026-10-13
> **Feature Verdict:** PASS

## Automated Verification

- `pnpm --filter @ak-system/api test -- src/services/voice-speakers.test.ts` — PASS, 20/20 tests (re-run after the final safety guard).
- `pnpm test` — PASS:
  - API: 114 files, 1,307 tests.
  - Web: 42 files, 302 tests.
- `pnpm --filter @ak-system/web test:e2e -- e2e/email-voice-commitments.spec.ts` — PASS, 7/7 tests.
- `pnpm -r run lint` — PASS. Existing warnings remain in unrelated finance/settings/shared UI files.
- `pnpm --filter @ak-system/web build` — PASS.
- `git diff --check` — PASS.

## Full E2E Baseline

`pnpm e2e` completed with 98 passed, 2 skipped, and 28 failed. The new test
`voice page shows an automatic speaker match and lets the user correct it` passed both in the
focused 7-test run and in the full run.

The 28 failures are outside the changed voice flow, in existing suites including
`assistant-chat-ux`, `full-flow`, `meeting-conversation-analysis`, `meeting-relationships`,
`multi-level-sort`, `notion-note-meetings`, `project-page-polish`, `qa-structured`,
`task-assignee`, `task-workspaces`, `trading-journal`, and `ui-refresh`. No failure references
the changed voice service, router, page, or test.

## UI Review

**Verdict:** APPROVED

- Uses the existing `.card`, `.pill`, `.btn`, `.btn-primary`, `.btn-ghost`, and `PeoplePicker` patterns.
- Hebrew RTL copy is concise and distinguishes automatic matches from unknown speakers.
- Automatic attribution is visible rather than silent.
- “לא נכון? תקן” exposes an explicit correction flow with cancel, pending, and error states.
- Existing responsive wrapping and dark-theme colors are preserved.
- The focused Playwright flow verifies display and correction.

## Safety Coverage

- Exactly two transcript labels are required.
- The owner's label must already be matched from the enrolled owner voiceprint.
- Exactly one non-owner confirmed person must be linked to the recording.
- Ambiguous participant sets do not auto-identify.
- Stored transcript text is unchanged.
- Analysis refresh uses text only and waits until all labels are resolved.
- A no-op all-skipped result does not spend another analysis call.
