# QA report — chief-of-staff (behavior gap)

**Detected stack:** next-trpc-monorepo  
**Verdict:** FAIL against the user's intended CoS (wise personal advisor). PASS against the shipped identity-first acceptance criteria (rename + prompt contract).

- Static check: N/A this pass (advisory re-open; prior build PASS)
- Unit tests: prior CoS contract tests PASS (prompt strings present)
- E2E: N/A
- Production config drift: N/A
- Build freshness: N/A (advisory)
- Total time: advisory review

## Per-phase results

### 1. Static / product behavior audit

User report: CoS still feels like a router — routes to the right agent and returns their response.

Root causes in shipped code (not a deploy miss):

1. **Prompt still optimizes for routing.** Most lines in `gemini-agent-engine.ts` CoS block are delegation rules, valid agentIds, and format matches. Judgment is one sentence ("add ONE judgment line").
2. **אופטי pass-through fights CoS.** Instruction: pass calendar brief "almost verbatim" — that forbids the wise synthesis the user wants when they ask about the day/calendar.
3. **Engine still force-routes.** If the model answers without `run_abc_agent` but text matches deferral patterns, a retry forces `run_abc_agent` (`DELEGATION_RETRY_PROMPT`). That reinforces switchboard behavior.
4. **No "monitor" path.** CoS is reactive to a single user message. There is no mandated multi-source scan (calendar + tasks + meeting notes + finance insights + memory open loops) before recommending. Prefetched calendar context is **not** injected for agent `01` (`CALENDAR_CONTEXT_AGENTS` excludes Hugo).
5. **Insights exist as tools but are not CoS-default.** `get_cashflow_insights`, `get_trading_insights`, `get_finance_overview`, WhatsApp insights are available; CoS card/workflow never require pulling them for "what matters now".
6. **Specialists own the digests.** Morning / evening / calendar cron still land as specialist formats, not as CoS-owned judgment briefs.

### 2. Unit/integration tests

Prior tests verify strings ("Chief of Staff — primary interface", aliases, workflow mapping). They do **not** verify judgment quality or multi-tool advisory behavior. That is a coverage gap relative to the new intent.

## Failures (intent gap)

| Expected (user) | Actual (shipped) |
|---|---|
| Monitor insights across life/work/money | Answers one question; rarely aggregates |
| Wise recommendation | Often specialist dump + thin wrap |
| Personal assistant judgment | Routing + format match dominates prompt |

## Notes

- Identity-first shipped as designed; the design under-specified "wise advisor".
- Follow-up product work: `docs/specs/chief-of-staff-judgment.md`.
- Do not treat this FAIL as a rollback of the rename — the gap is behavior depth, not branding.
