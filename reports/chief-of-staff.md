# Review — chief-of-staff

> **Slug:** `chief-of-staff`
> **Date:** 2026-08-29
> **Spec:** `docs/specs/chief-of-staff.md`
> **Verdict:** APPROVED WITH NITS

## Summary

Evolves the same agent `01_Hugo_orchestrator` into a Chief of Staff identity: rewritten card, new workflow, retargeted live prompt, aliases, and Hebrew microcopy. No schema, tRPC, or notification-product changes. Matches the identity-first scope.

## Spec conformance

- [x] Same agent ID / filename / chat surfaces
- [x] CoS operating contract in card + `gemini-agent-engine.ts` primary-interface block
- [x] `wf_chief_of_staff.md` mapped in `AGENT_WORKFLOWS`
- [x] Aliases for ראש מטה / cos / chief of staff (hyphenated too)
- [x] Default trigger message updated in `agents-meta.ts`
- [x] Memory / mobile labels; `hugo_instructions` names kept
- [x] Out of scope respected (no state engine, P0/P1/P2, JSON bus, full Hugo string sweep)

## Static checks

| Check | Result |
|---|---|
| Related Vitest (29) | Pass |
| `@ak-system/web` build | Pass |
| Lint | Pre-existing: `next lint` has no ESLint config and prompts interactively |

## UI/UX Review

- [x] RTL Hebrew labels on `/memory` and Helm memory/chat
- [x] Design-system classes unchanged (`.card` etc.)
- [x] No emoji removed from web memory title intentionally (spec: drop Hugo branding)
- **Verdict:** APPROVED — label-only; no layout/flow change

## Findings

### Nits

1. `apps/web/src/lib/conversation-engine.ts` still mentions "Hugo orchestration" in `run_abc_agent` tool description — out of full-string-sweep scope; harmless.
2. Notification settings still say "WhatsApp והוגו" / `hugo_reply` label — explicitly out of scope per spec.
3. Runtime behaviour (answer-directly-first vs over-delegation) depends on Gemini following the new prompt; cannot be fully proven without live chat soak.

### No blockers

No security issues; no new auth surface; no schema drift.

## Verdict

**APPROVED WITH NITS** — ship identity change; optional follow-up for remaining Hugo UI strings if desired.
