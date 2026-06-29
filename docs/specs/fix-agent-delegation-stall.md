# Fix Agent Delegation Stall (Hugo "אעדכן אותך")

> **Slug:** `fix-agent-delegation-stall`
> **Status:** Approved
> **Last Updated:** 2026-06-29

## Goal

Hugo sometimes replies with "אני מפעיל סוכן X / אעדכן אותך" without calling `run_abc_agent`, leaving the user with no follow-up. The platform is synchronous — delegation must complete in the same HTTP response.

## Acceptance Criteria

- [ ] Hugo system prompt forbids async promises and requires `run_abc_agent` for specialist tasks
- [ ] Chat loop detects deferral language without `run_abc_agent` and forces one corrective retry
- [ ] Only `summarize_whatsapp_groups` is documented as async (separate messages)
- [ ] Same rule applies in `resolveIntent` (main chat)

## Implementation

- `apps/web/src/lib/gemini-agent-engine.ts` — prompt + `runChatLoop` guard
- `apps/web/src/lib/conversation-engine.ts` — `resolveIntent` prompt alignment

## Out of Scope

- True background jobs with second chat message (future enhancement)
