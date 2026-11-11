# Code Review: Auto-identify speakers in two-person recordings

> **Slug:** `auto-identify-two-person-speakers`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-10-13

## Spec Conformance

The implementation matches the approved conservative scope:

- Automatic inference requires two transcript labels, an owner label backed by the enrolled owner voiceprint, and one confirmed external person.
- Ambiguous recordings remain manual.
- Names are substituted only in analysis input; the stored recording transcript remains unchanged.
- The initial analysis consumes attribution without an extra model call.
- A completed manual identification refreshes the existing analysis from text only.
- Automatic matches are visible and correctable in the existing web flow.
- No schema or mobile changes were introduced.

## Static Checks

- `pnpm -r run lint` — PASS, with existing unrelated warnings.
- `pnpm --filter @ak-system/web build` — PASS.
- `git diff --check` — PASS.

## Tests

- Focused API: 20/20 PASS.
- Full unit/integration: 1,609/1,609 PASS.
- Focused voice Playwright: 7/7 PASS.
- Full Playwright: the feature test passes; repository baseline is 98 passed, 2 skipped, 28 unrelated failures. See `reports/qa-auto-identify-two-person-speakers.md`.

## Findings

### Must-fix

None.

### Should-fix

None.

### Nits

- The identification is saved before the text refresh call (`packages/api/src/routers/voice.ts:138-140`). If Gemini fails, the mutation returns an error while the saved mapping remains. The current UI keeps its old query cache and allows an immediate retry, but a reload before retry can leave the prior analysis in place. A durable refresh-job state can address this later without weakening the current safe attribution behavior.
- The full Playwright baseline is not green, but none of its 28 failures touches the voice files or the new test. Fixing those unrelated suites is outside this feature's scope.

## Security and Performance

- Both procedures remain authenticated `protectedProcedure`s.
- No raw path or audio data is accepted by the new logic.
- No voiceprints for third parties are created.
- Speaker and participant sets are small; the added bounded queries do not introduce list-scale N+1 behavior.
- One-on-one automatic attribution reduces model usage because names are applied before the original analysis call.

## UI Review

**Verdict:** APPROVED

RTL, dark-theme utilities, existing picker/button patterns, correction, loading, and error states are preserved. The focused Playwright flow verifies the automatic badge and correction interaction.

## Out of Scope Creep

None. Audio Range playback, cross-recording third-party voiceprints, mobile UI, and multi-party guessing remain excluded.

## Suggested PR Description

Automatically attribute the other participant in safe one-on-one voice recordings when the owner's voice is already matched. Feed resolved names into analysis without retranscription, refresh text analysis after manual resolution, and expose visible/correctable automatic matches in the voice UI.
