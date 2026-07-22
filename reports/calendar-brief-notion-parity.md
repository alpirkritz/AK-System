# Review — calendar-brief-notion-parity

> **Date:** 2026-07-22
> **Spec:** `docs/specs/calendar-brief-notion-parity.md`
> **QA:** `reports/qa-calendar-brief-notion-parity.md`
> **Stack:** `next-trpc-monorepo`

## Verdict

**APPROVED**

## Spec conformance

- [x] Rich section structure (Quick Summary → Meetings → Conflicts → Load → Focus → Reminders → Recommendations)
- [x] No Markdown tables (hard override + agent card)
- [x] No meta / "I understood" narration
- [x] Calendars primary; Notion optional only (override + agent card + AC)
- [x] Same format on WhatsApp / Telegram / ARO (channel-agnostic `06` override)
- [x] Hugo pass-through for Notion-parity brief
- [x] Prompt-contract tests updated and passing (5/5)
- [x] Old secretary-brief spec marked superseded for structure
- [x] Analysis rules (≥8h, approval-gated) untouched

## Changed files

- `docs/specs/calendar-brief-notion-parity.md`
- `docs/specs/calendar-optimizer-whatsapp-brief.md` (supersession note)
- `A_Agents/06_calendar_optimizer.md`
- `S_Skills/wf_calendar_optimizer.md`
- `apps/web/src/lib/gemini-agent-engine.ts`
- `apps/web/src/lib/gemini-agent-engine.calendar-brief.test.ts`
- `reports/qa-calendar-brief-notion-parity.md`

## UI / UX Review

**Verdict:** APPROVED (N/A for chrome)

No new routes/components/styling. Chat/WhatsApp message body gains richer headings + bullets; existing RTL surfaces render lists as-is. Remains WhatsApp-safe (no tables).

## Findings

None blocking.

### Nits

1. LLM adherence cannot be fully guaranteed by prompt contracts — one live morning/WhatsApp smoke after deploy is still recommended.
2. Reminders that existed only as Notion AI context (not on calendar) will be thinner when Notion is offline — by design per owner requirement.

## Security

No secrets, no auth surface changes, no new endpoints.
