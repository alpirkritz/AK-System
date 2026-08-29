# QA report — chief-of-staff-judgment

**Detected stack:** next-trpc-monorepo  
**Verdict:** PASS

- Static check: SKIPPED (`next lint` interactive / no eslint config — pre-existing)
- Unit tests: 18/18 passed (abc-agents.workflow, gemini calendar-brief, meeting-prep)
- E2E: SKIPPED (prompt/workflow change; no new UI flow)
- Production config drift: N/A
- Build freshness: N/A (not deployed in this QA pass)
- Total time: ~2s Vitest

## Per-phase results

### 1. Static
Lint blocked by pre-existing missing ESLint config in `apps/web`.

### 2. Unit/integration tests
```
✓ abc-agents.workflow.test.ts (7)
✓ gemini-agent-engine.calendar-brief.test.ts (8) — Judgment contract + Multi-source scan; no "almost verbatim"
✓ gemini-agent-engine.meeting-prep.test.ts (3)
```

### Spec AC mapping

| AC | Evidence |
|---|---|
| Judgment contract in prompt | Vitest |
| Multi-source scan (≥2 own tools) in prompt | Vitest |
| No verbatim-only pass-through | Vitest `not.toContain('almost verbatim')` |
| Calendar prefetch for 01 | `CALENDAR_CONTEXT_AGENTS` includes `HUGO_AGENT_ID` |
| Deferral retry does not force route if own tools used | `COS_OWN_WORK_TOOLS` guard in `runChatLoop` |
| Retry prompt prefers own judgment | `DELEGATION_RETRY_PROMPT` rewritten |

## Notes

- Runtime judgment quality still depends on Gemini following the prompt; soak on WhatsApp/chat after deploy.
- Cron digests remain on specialists (out of scope).
