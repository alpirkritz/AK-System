# Review — chief-of-staff-judgment

> **Slug:** `chief-of-staff-judgment`
> **Date:** 2026-08-29
> **Spec:** `docs/specs/chief-of-staff-judgment.md`
> **Verdict:** APPROVED

## Summary

Judgment-first CoS: multi-source scan on vague asks, mandatory recommendation shape, specialists as staff inputs only, calendar prefetch for `01`, and deferral retry no longer force-routes when own tools already ran.

## Spec conformance

- [x] Judgment contract + multi-source scan lead the live prompt
- [x] Verbatim pass-through removed; judgment mandatory after specialists
- [x] Calendar day ≠ default אופטי
- [x] Finance insight tools advertised for "מצב" / money
- [x] `CALENDAR_CONTEXT_AGENTS` includes CoS
- [x] Deferral retry softened + skip when own tools used
- [x] Card + `wf_chief_of_staff` updated; no schema/tRPC
- [x] Optional `/memory` tag hint added
- [x] Notion depth in scan: meetings + AI meeting notes + related people/projects/companies

## Static checks

| Check | Result |
|---|---|
| Related Vitest | PASS |
| Lint | Pre-existing gap |

## Findings

No blockers. Nit: live quality needs a short WhatsApp soak after deploy. Notion depth is prompt-mandated each turn.

## Verdict

**APPROVED**
