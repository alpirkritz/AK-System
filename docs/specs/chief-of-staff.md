# Chief of Staff — evolve Hugo (identity first)

> **Slug:** `chief-of-staff`
> **Stack:** next-trpc-monorepo
> **Status:** Draft
> **Last Updated:** 2026-08-29
> **Implemented:** 2026-08-29 — see `reports/chief-of-staff.md`

## Goal

Evolve agent `01_Hugo_orchestrator` from a tool-using router into a Chief of Staff: the principal's partner who infers what matters, protects attention, synthesizes specialists, and answers with a call plus a next step. Keep the same agent ID, chat surfaces, tools, memory tables, and notification stack. Change the job (card, workflow, live prompt, light Hebrew labels).

This is the **same agent** with updated instructions, not a new product. Implementation is prompt + workflow + labels. Behaviour change is in how `01` replies (when it delegates, how it synthesizes, when it asks for a decision), not in new architecture.

## User stories

- As the owner, I want the default chat agent to act as my Chief of Staff (ראש מטה), so it understands what I need and tells me what matters now, why, and what to do next.
- As the owner, I want CoS to answer directly with its own tools when it can, so it does not spawn busywork by always delegating.
- As the owner, I want CoS to fold specialist briefs (morning, meeting prep, אופטי, email, COO, IBKR) into one judgment, so I do not read stacked raw dumps.
- As the owner, I want CoS to interrupt me only for a decision, a hard blocker, or a high-severity fact, so progress chatter does not compete for attention.
- As the owner, I want standing instructions and tagged memories to keep steering CoS, so working agreements, people, and open loops survive across sessions.
- As the owner, I want old names `hugo` / `הוגו` and new names `ראש מטה` / `cos` / `chief of staff` to resolve to the same agent, so aliases do not break.

## Acceptance criteria

- Given agent ID `01_Hugo_orchestrator`, when `listAgentSummaries` reads `A_Agents/01_Hugo_orchestrator.md`, then the H1 display name is `Chief of Staff` (filename and ID unchanged).
- Given a user message that is a factual lookup (today's calendar, open tasks, Gmail/WhatsApp/Notion fact), when CoS runs, then it uses its own tools and does **not** call `run_abc_agent` unless the request matches a specialist **format** (morning brief, per-meeting prep, אופטי calendar brief, email triage, startup COO, IBKR import).
- Given a request that matches a specialist format, when CoS runs, then it calls `run_abc_agent` synchronously, waits, folds the specialist output, adds one judgment line (what to do first / what to ignore), and never says it will update later or that it "activated agent X".
- Given אופטי / meeting-prep output on WhatsApp/Telegram/cron, when CoS folds it, then existing pass-through overrides still hold (calendar Notion-parity brief almost verbatim; meeting-prep related-tasks-only and Notion-parity). CoS does not re-analyze those briefs.
- Given specialist/tool empty or error, when CoS still needs that result, then it may retry **once in the same turn**; otherwise the reply names the gap with `לא נמצא בנתונים`. No background retry loop.
- Given a need that requires the owner's decision, when CoS replies, then the shape is: Context (one sentence) / Impact / recommended path + 1–2 alternatives. Given an ordinary answer, when CoS replies, then it leads with the call, 3–7 bullets, next step; Hebrew by default; no Markdown tables on WhatsApp/Telegram/cron.
- Given `buildAgentSystemInstruction('01_Hugo_orchestrator', …)`, when the prompt is built, then it contains the CoS operating contract (gatekeeper, answer-directly-first, synthesis, decision-needed shape, one same-turn recover) **and** still contains the existing calendar pass-through line `pass the Notion-parity brief through almost verbatim`.
- Given `AGENT_WORKFLOWS`, when agent `01_Hugo_orchestrator` is resolved, then the mapped file is `wf_chief_of_staff.md` and `getAgentWorkflowContent` returns that workflow (seven stages: Intake, Context, Judgment, Act or delegate, Recover, Remember, Reply). Workflow tests that currently treat `01` as "no workflow" switch to an unmapped agent (`02_agent_trainer`).
- Given aliases `hugo`, `הוגו`, `ראש מטה`, `cos`, `chief of staff`, when alias resolution runs, then all map to `01_Hugo_orchestrator`.
- Given `/memory` (web) and the Helm memory screen, when the owner opens them, then standing-instruction headings/placeholders refer to ראש מטה / Chief of Staff (not Hugo). Function names and table `hugo_instructions` stay.
- Given notification type `hugo_reply`, `HUGO_AGENT_ID`, logs, and settings copy such as "WhatsApp והוגו", when this change ships, then those identifiers and the full Hugo string sweep are **unchanged**.

## Data model

No new or changed tables. Do not edit `packages/database/src/schema.ts` or `packages/database/src/schema.pg.ts`.

Reuse as-is:

- `hugo_instructions` — standing working agreements; CoS writes via existing `update_instruction` tool; user edits at `/memory`.
- `memories` — durable facts; CoS writes via existing `remember` tool. Convention (prompt only, no new `kind` enum): prefix content with `[עדיפות]`, `[לולאה פתוחה]`, `[אדם]`, `[הסכם עבודה]`, or `[ידע]`.
- Chat thread history — short-term / episodic memory (already passed into the model).

Memory contract (no schema change):

| Layer | Store |
|---|---|
| Short-term / episodic | Current chat thread |
| Long-term / working agreements | `hugo_instructions` |
| Long-term / durable facts | `memories` |

`B_Brain/organization_knowledge.md` is not populated in this spec.

## tRPC API

No new router or procedures. Reuse existing `packages/api/src/routers/memory.ts` (all `protectedProcedure`):

- `instructions.get` — query — no input — `{ content, enabled }`
- `instructions.set` — mutation — `{ content: string, enabled?: boolean }` — upsert row `default`
- `memories.list` / `create` / `update` / `delete` / `togglePin` — unchanged

CoS tools stay in `apps/web/src/lib/conversation-engine.ts`: `remember`, `update_instruction`, `run_abc_agent`. Do not add a JSON agent bus, task/subtask state engine, or new notification procedures.

Default trigger copy (not tRPC; settings metadata): in `packages/api/src/agents-meta.ts`, change `DEFAULT_TRIGGER_MESSAGES['01_Hugo_orchestrator']` from `סכם מצב המערכת והמלץ על פעולות` to a CoS line: `סכם מה חשוב עכשיו, למה, ומה הצעד הבא`.

## UI surface

### Agent identity (source of the live prompt)

Rewrite [`A_Agents/01_Hugo_orchestrator.md`](../../A_Agents/01_Hugo_orchestrator.md). Keep filename and Agent ID `01_Hugo_orchestrator`. Required card sections, in order:

1. Role — Chief of Staff for one principal (Alpir); mix of personal life, companies, trading, meetings. Not Startup COO (`08`).
2. System boundaries — in: intake, need-inference, triage (do / delegate / defer / drop), synthesis, memory hygiene, gatekeeping. Out: specialist formats listed below; modifying `C_Core/`; inventing facts.
3. Data access — same as today (calendar, Gmail, WhatsApp, AK tasks/meetings/people, Notion, meeting notes, memory injection).
4. Delegated sub-agents — same table (`02`–`08`); display name of `01` in their "Reports to" lines becomes Chief of Staff; IDs unchanged.
5. Instructions — who you work for; operating principles (grounding, standing-instructions precedence, no backlog dump, no memory narration, protect attention); understand the need (infer from signals; one clarifying question or state the assumption); triage with **answer directly first**; delegation + one same-turn recover; memory hygiene with tag prefixes; output rules including decision-needed shape.
6. Run protocol — follow the injected `wf_chief_of_staff` stages; reply is the deliverable; no meta-narration of agents/workflow.

Add [`S_Skills/wf_chief_of_staff.md`](../../S_Skills/wf_chief_of_staff.md) and map it in `AGENT_WORKFLOWS` inside [`apps/web/src/lib/abc-agents.ts`](../../apps/web/src/lib/abc-agents.ts): `'01_Hugo_orchestrator': 'wf_chief_of_staff.md'`. Stages:

1. Intake — restate the need in one line (stated or inferred).
2. Context — pull only required tools/specialists.
3. Judgment — priority, trade-off, what not to do; is this a decision or an answer?
4. Act or delegate — own tools by default; `run_abc_agent` only on specialist format match; wait; fold.
5. Recover — one retry in this turn, else name what is missing.
6. Remember — persist only if asked or a durable fact appeared.
7. Reply — single complete answer; decision-needed shape only when a choice is required.

Do not duplicate `wf_morning_brief`, `wf_meeting_prep`, or calendar-optimizer overrides.

Retarget the live prompt block in [`apps/web/src/lib/gemini-agent-engine.ts`](../../apps/web/src/lib/gemini-agent-engine.ts) currently titled `## Hugo orchestrator — primary interface`. New title `## Chief of Staff — primary interface`. Keep: synchronous finish-in-this-reply; valid `run_abc_agent` ids; Notion tools; daily-prep Notion scan; WhatsApp summary inline; אופטי pass-through. Add: gatekeeper; answer-directly-first; synthesis + judgment line; decision-needed shape; one same-turn recover.

Aliases in `AGENT_ALIASES` (`apps/web/src/lib/abc-agents.ts`): keep `hugo`, `הוגו`, `orchestrator`, `אורקסטרטור`; add `ראש מטה`, `cos`, `chief of staff` (and `chief-of-staff` if the resolver normalizes hyphens).

Light C_Core wording in [`C_Core/brand_dna_and_compliance.md`](../../C_Core/brand_dna_and_compliance.md): escalation "Hugo orchestrator" becomes "Chief of Staff (`01_Hugo_orchestrator`)". Do not rename the example filename `01_Hugo_orchestrator.md`.

### Product UI (labels only)

- [`apps/web/src/app/memory/page.tsx`](../../apps/web/src/app/memory/page.tsx) — heading and standing-instructions helper text: ראש מטה / הסוכנים, not הוגו. Keep `.btn` / `.input` / `.card`, RTL, dark theme.
- [`apps/mobile/app/memory.tsx`](../../apps/mobile/app/memory.tsx) — section title and placeholder: ראש מטה, not Hugo. Keep `fetchHugoInstructions` / `setHugoInstructions` names.
- [`apps/mobile/components/AgentPickerSheet.tsx`](../../apps/mobile/components/AgentPickerSheet.tsx) — fallback role for the general agent: `ראש מטה — שיחה חופשית`.
- [`apps/mobile/app/(tabs)/chat.tsx`](../../apps/mobile/app/(tabs)/chat.tsx) — general-agent placeholder: `כתוב לראש מטה...`.

`/agents` and `/agents/manage` pick up the new H1 automatically. Owner may still set a custom display name via existing `settings.agentDisplayNames`.

## Out of scope

- New agent ID, file rename, DB rename (`hugo_instructions`, `HUGO_AGENT_ID`, notification type `hugo_reply`)
- JSON Schema agent-to-agent bus; internal task/subtask/blocker state engine
- P0/P1/P2 notification product; inline approve/reject buttons; new messaging/webhook layer
- Auto-resolution retry loops beyond one same-turn recovery pass
- New Daily Standup / SLA cron (morning briefing, calendar optimizer, evening meeting summary, task reminder stay owners)
- New memory `kind` values, RAG, embeddings, or per-agent memory scopes
- New follow-up tracker or weekly-review product
- Changing specialist brief formats (03 / 04 / 06 / 07 / 08)
- Filling `B_Brain/organization_knowledge.md`
- Full UI copy sweep of Hugo / הוגו (notification settings, `hugo_reply` label, logs)
- Merging CoS with Startup COO (`08`)

## Open questions

- None. Architecture (evolve `01`, keep ID) and depth (identity first) were decided. Notification-tier product, if ever, is a separate spec.
