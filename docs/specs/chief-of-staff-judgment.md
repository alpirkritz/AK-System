# Chief of Staff — judgment first (wise advisor)

> **Slug:** `chief-of-staff-judgment`
> **Stack:** next-trpc-monorepo
> **Status:** Implemented
> **Last Updated:** 2026-08-29
> **Depends on:** `docs/specs/chief-of-staff.md` (identity shipped)
> **Trigger:** User feedback that CoS still behaves as a router, not a wise personal advisor who monitors insights and recommends.
> **Review:** `reports/chief-of-staff-judgment.md`

## Goal

Make agent `01_Hugo_orchestrator` (Chief of Staff) lead with judgment across the principal's whole picture — calendar, tasks, meetings, people, finance insights, WhatsApp signals, and memory — and use specialists only as staff inputs, never as the final voice.

## User stories

- As the owner, when I ask something vague ("מה חשוב?", "מה המצב?", "תעזור לי"), I want CoS to scan the relevant sources and tell me what matters now, why, and what to do — not ask which agent to use.
- As the owner, when a specialist runs (אופטי, morning brief, meeting prep), I want CoS to keep their facts but add a clear call: prioritize X, ignore Y, decide Z.
- As the owner, I want CoS to surface cross-domain insight (e.g. heavy calendar + overdue tasks + finance warn) without me naming each domain.
- As the owner, I want CoS to stay grounded — every claim from a tool this turn — and never invent wisdom.
- As the owner, I still want structured specialist formats available when I explicitly ask for "תדריך בוקר" / אופטי-style conflict analysis / meeting prep for a named meeting.

## Acceptance criteria

- Given a vague ask (מה חשוב / מה המצב / תכין אותי / empty intent on chat with CoS), when CoS runs, then it calls **at least two** of its own tools from different domains before answering (e.g. calendar + tasks, or tasks + finance insights, or calendar + meeting notes), and does **not** call `run_abc_agent` as the first action.
- Given day/prep/people/"מצב" asks, when CoS scans, then it includes a Notion depth pass: `get_notion_meetings`, `get_notion_meeting_notes` (AI Meeting Notes), and for people who appear — `get_notion_people` (plus projects/companies/`search_notion` when named). Empty note body → `לא נמצא בנתונים`; never invent discussion points.
- Given that multi-source scan, when CoS replies, then the reply uses this shape in Hebrew (or user language): (1) מה חשוב עכשיו — 1–3 bullets, (2) למה — one line each, (3) המלצה — one primary next step, (4) מה לא לטפל עכשיו — optional. No specialist dump as the body.
- Given an explicit specialist-format ask (תדריך בוקר structured, אופטי conflict brief, הכנה לפגישה X, מייל, COO, IBKR), when CoS runs, then it may `run_abc_agent`, but must append a CoS judgment block of 2–4 lines (do first / skip / decision needed). Pass-through "almost verbatim" without judgment is **forbidden**.
- Given calendar/day questions that are not "אופטי conflict analysis", when CoS runs, then it uses own calendar tools (and may use prefetched calendar context) — it does **not** default-delegate to `06`.
- Given finance or trading may matter (user mentions money, or vague "מצב" with pinned `[עדיפות]` finance memory, or morning-style ask), when CoS scans, then it may call `get_cashflow_insights` / `get_trading_insights` / `get_finance_overview` and fold warn-level facts into the recommendation.
- Given `buildAgentSystemInstruction('01_Hugo_orchestrator')`, when built, then the CoS block leads with **Judgment contract** and **Multi-source scan**, and the old "pass almost verbatim" line is replaced by "keep specialist facts; CoS judgment is mandatory".
- Given the deferral retry path in `runGeminiAgentChat`, when agent is `01` and the model answered with tools but without `run_abc_agent`, then the engine must **not** force `run_abc_agent` solely because the text looked like routing deferral if own tools were already used (or: retry prompt must say "complete with your own tools or specialist — prefer own judgment").
- Given Vitest, when run, then new prompt-contract tests assert Judgment contract + multi-source scan strings and absence of "almost verbatim" without judgment.

## Data model

No schema changes. Reuse `hugo_instructions`, `memories`, existing finance/WhatsApp insight APIs. Reference `packages/database/src/schema.ts` and `schema.pg.ts` unchanged.

Optional (prompt-only, no migration): encourage pinned memories tagged `[עדיפות]` and `[לולאה פתוחה]` so CoS scan has durable priorities.

## tRPC API

No new procedures. Reuse existing tools in `apps/web/src/lib/conversation-engine.ts` (already wired):

- Calendar: `get_today_schedule`, `get_week_schedule`, `get_upcoming_meetings`, …
- Tasks / Notion: `get_open_tasks`, `get_notion_tasks`, `get_notion_meetings`, `get_notion_meeting_notes`, …
- Finance: `get_cashflow_insights`, `get_trading_insights`, `get_finance_overview`, `get_recurring_charges`
- WhatsApp: digest / `whatsapp_group_insights` when relevant
- Delegation: `run_abc_agent` (staff only)

Wire-up change (not new API): include `HUGO_AGENT_ID` in `CALENDAR_CONTEXT_AGENTS` in `apps/web/src/lib/abc-agents.ts` so CoS receives prefetched calendar context like morning/אופטי.

## UI surface

No new routes. Prompt/workflow only:

- Rewrite CoS sections in `A_Agents/01_Hugo_orchestrator.md` Instructions: Judgment contract + Scan order before Triage/Delegation.
- Rewrite `S_Skills/wf_chief_of_staff.md` Stage 2–4: Stage 2 becomes mandatory multi-source scan on vague asks; Stage 4 judgment is the reply spine; specialists are inputs.
- Retarget `## Chief of Staff — primary interface` in `apps/web/src/lib/gemini-agent-engine.ts`: lead with judgment + scan; demote delegation; remove verbatim pass-through.
- Soften or reword `DELEGATION_RETRY_PROMPT` / deferred-delegation retry for agent `01` so completing with own tools counts as success.
- Tests in `gemini-agent-engine.calendar-brief.test.ts` (or sibling): CoS judgment contract strings.

Hebrew microcopy unchanged from identity spec unless judgment shape needs a one-line hint on `/memory` (optional): "עדיפויות ופתוחות שראש מטה צריך לזכור — השתמש בתגיות [עדיפות] / [לולאה פתוחה]".

## Out of scope

- New agent, ID rename, or DB tables
- Proactive push product / P0–P2 tiers / CoS-owned cron replacing morning/evening (may route digests *through* CoS judgment in a later spec)
- Auto-monitoring loop that messages the user without a trigger
- Changing specialist brief internals (03/04/06 formats stay); only how CoS wraps them
- RAG / embeddings / B_Brain fill
- Full Hugo string sweep

## Open questions

- Should scheduled morning/evening digests be rewritten to run as CoS (01) with specialists as tools, or stay on 03/06 with CoS only on chat? Default in this spec: **chat path only**; cron ownership unchanged until a separate cron-routing spec.
