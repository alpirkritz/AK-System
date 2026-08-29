# QA — chief-of-staff

> **Slug:** `chief-of-staff`
> **Date:** 2026-08-29
> **Stack:** next-trpc-monorepo

## Scope tested

Identity-first evolve of `01_Hugo_orchestrator` → Chief of Staff: agent card, `wf_chief_of_staff`, live prompt block, aliases, memory/chat microcopy. No DB/tRPC changes.

## Commands

| Command | Result |
|---|---|
| `pnpm --filter @ak-system/web exec vitest run` (abc-agents.workflow, gemini calendar-brief, meeting-prep, conversation-engine.agent-feedback, agent-memory) | **PASS** — 5 files, 29 tests |
| `pnpm --filter @ak-system/web build` | **PASS** |
| `pnpm --filter @ak-system/web run lint` | **BLOCKED** — `next lint` prompts for ESLint interactive setup (no `.eslintrc` in apps/web); pre-existing, not caused by this change |
| `pnpm e2e` | **SKIPPED** — no new user-facing flow; label-only UI + prompt contract covered by Vitest |

## Acceptance criteria check

| Criterion | Status |
|---|---|
| H1 `Chief of Staff` on `01_Hugo_orchestrator.md` | Pass |
| CoS prompt: answer-directly-first, gatekeeper, synthesis, decision-needed, same-turn recover | Pass (Vitest) |
| Calendar pass-through line retained | Pass (Vitest) |
| `AGENT_WORKFLOWS` maps `01` → `wf_chief_of_staff.md` | Pass (Vitest) |
| Aliases `hugo` / `הוגו` / `ראש מטה` / `cos` / `chief of staff` / `chief-of-staff` | Pass (Vitest) |
| Memory / mobile labels ראש מטה | Pass (manual file review) |
| `hugo_reply` / `HUGO_AGENT_ID` / notification settings copy unchanged | Pass (no edits) |

## Notes

- No browser E2E run: change is prompt + labels; chat behaviour depends on Gemini at runtime.
- Specialist "Reports to" display names updated to Chief of Staff; agent IDs unchanged.
