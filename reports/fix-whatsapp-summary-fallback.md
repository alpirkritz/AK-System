# Review — fix-whatsapp-summary-fallback

Verdict: APPROVED WITH NITS

## Scope

Fix the WhatsApp "המערכת עמוסה כרגע ולא הצלחתי לסכם את הקבוצות" reply that appeared on
every summary request. Root cause: the `summarize_whatsapp_groups` Hugo tool routed to the
bridge-dependent `whatsapp.summaries.trigger`, which fails whenever the live bridge is
disconnected or its in-memory buffer is empty. Gemini then paraphrased the tool failure as
a generic "system busy" apology.

## Changes

- `apps/web/src/lib/conversation-engine.ts`
  - `summarize_whatsapp_groups` handler now uses the DB-backed insights path:
    `whatsapp.insights.digest` (all groups) / `whatsapp.insights.forGroup` (single group),
    returning the summary text inline. No longer touches the bridge.
  - Tool declaration updated (inline behavior + optional `window` param).
  - Base system instruction: summaries are delivered inline (not "separate messages").
- `apps/web/src/lib/gemini-agent-engine.ts`
  - Hugo prompt lines updated: include summary inline; never claim "system busy" — the
    insights path returns an honest "no new activity" message when empty.
- `apps/web/src/lib/conversation-engine.whatsapp-summary.test.ts` (new)
  - 4 tests: all-groups digest routing, honest empty-state (no "המערכת עמוסה"),
    single-group routing, explicit window. Verifies bridge `summaries.trigger` is NOT called.

## Verification

- Unit tests: 4/4 pass (`vitest run conversation-engine.whatsapp-summary.test.ts`).
- IDE TS diagnostics (ReadLints): no errors on edited files.
- `next lint` not run — repo has no ESLint config wired (interactive prompt); pre-existing.
- Raw workspace `tsc --noEmit` shows pre-existing cross-package errors in `packages/api`
  and `packages/database` (Drizzle dual pg/sqlite builder unions, missing `@types/pg` /
  `@types/pdf-parse`) that collapse the tRPC caller type to `any`. These are unrelated to
  this change and also affect the pre-existing `whatsapp_now` handler.

## Nits / follow-ups (out of scope)

- Production WhatsApp bridge is still the underlying reliability issue for the FOMO/live
  buffer path — worth verifying its connection separately.
- `GEMINI_API_KEY` in committed env files starts with `AQ.` (looks like an OAuth token,
  not an AI Studio `AIza…` key) and is exposed in git-tracked files — rotate and remove.
