# QA — calendar-brief-notion-parity

> **Date:** 2026-07-22
> **Spec:** `docs/specs/calendar-brief-notion-parity.md`
> **Stack:** `next-trpc-monorepo`

## Scope exercised

- Prompt-contract tests for Notion-parity brief override (`gemini-agent-engine.calendar-brief.test.ts`)

## Results

| Suite | Result |
|---|---|
| `gemini-agent-engine.calendar-brief.test.ts` (5) | PASS |

Command:

```bash
pnpm --filter @ak-system/web exec vitest run \
  src/lib/gemini-agent-engine.calendar-brief.test.ts
```

## Notes

- No E2E: presentation/prompt only; no new UI routes or tRPC procedures.
- Manual smoke after deploy: trigger יועץ יומן / morning briefing on WhatsApp and ARO; confirm sections Quick Summary → Meetings → Conflicts → Load → Focus, no `|` table rows, and brief still works if Notion is down.

## Verdict

**PASS** (scoped unit tests green)
