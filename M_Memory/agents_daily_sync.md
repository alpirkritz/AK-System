# Agents Daily Sync & Run Log

> **Purpose:** Append-only log for agent stand-ups, run summaries, and performance improvements
> **Maintained by:** All agents (append); Hugo orchestrator (review)
> **Format:** Newest entries at the bottom — never overwrite or delete existing entries

---

## How to Log

After every agent run, append a new entry using the template below. One entry per run.

### Entry Template

```md
---

## YYYY-MM-DD — [Agent Name] — [Run/Task ID]

**Workflow:** [S_Skills/wf_xxx.md] — Stage N, Step N.N
**Status:** Completed | Partial | Failed | Blocked

### Stand-up
- **Goal:** [What this run set out to accomplish]
- **Context:** [Relevant background or trigger]

### Actions Taken
1. [Action 1]
2. [Action 2]

### Outputs
- [Link or path to artifact in O_Output/]
- [Any other deliverable]

### Compliance
- [ ] C_Core/ pre-flight check passed
- [ ] No PII exposed without redaction

### Performance Improvements
- [What worked well]
- [What could be improved next run]
- [Suggested changes to agent cards or workflows]

### Blockers / Escalations
- [None] or [Description + who needs to act]

---
```

---

## Daily Stand-up Summary Template

For end-of-day rollups, Hugo may append a summary entry:

```md
---

## YYYY-MM-DD — Daily Stand-up Summary

**Runs today:** [count]
**Agents active:** [list]
**Workflows executed:** [list]

### Highlights
- [Key accomplishment]

### Open Items
- [ ] [Item requiring follow-up]

### System Improvements
- [Suggested change to agents, skills, or core docs]

---
```

---

## Log Entries

<!-- Append new entries below this line. Do not modify entries above. -->

---

## YYYY-MM-DD — System — INIT

**Workflow:** N/A — workspace initialization
**Status:** Completed

### Stand-up
- **Goal:** Scaffold ABC Agentic Workspace structure
- **Context:** Initial setup of A_Agents, B_Brain, C_Core, S_Skills, O_Output, M_Memory directories and templates

### Actions Taken
1. Created directory structure per ABC architecture
2. Authored agent cards: Hugo orchestrator, Agent Trainer
3. Authored organization knowledge template, brand/compliance guardrails
4. Authored example workflow: Interview & Match
5. Configured `.cursorrules` governance

### Outputs
- `A_Agents/01_Hugo_orchestrator.md`
- `A_Agents/02_agent_trainer.md`
- `B_Brain/organization_knowledge.md`
- `C_Core/brand_dna_and_compliance.md`
- `S_Skills/wf_interview_and_match.md`
- `.cursorrules`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No PII exposed without redaction

### Performance Improvements
- Initial baseline established; refine agent cards after first live run

### Blockers / Escalations
- None

---

## 2026-06-28 — Morning Briefing Agent — CREATE-001

**Workflow:** N/A — agent and workflow creation
**Status:** Completed

### Stand-up
- **Goal:** Add Morning Briefing agent to ABC workspace mirroring Notion Morning Brief structure
- **Context:** User Notion page (Overview, Workflow, Actions/Research guidelines); ABC-only scope

### Actions Taken
1. Created `A_Agents/03_morning_briefing.md` with standard fields plus Notion-mirror sections
2. Created `S_Skills/wf_morning_brief.md` with 4-stage logic map
3. Registered agent in Hugo's Delegated Sub-Agents table
4. Embedded Research guidelines under Actions and Stage 2

### Outputs
- `A_Agents/03_morning_briefing.md`
- `S_Skills/wf_morning_brief.md`
- Updated `A_Agents/01_Hugo_orchestrator.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No PII exposed without redaction

### Performance Improvements
- Share Notion Morning Brief page with AK-System integration to enrich Overview/Workflow content
- Run first live brief on next morning trigger or on-demand request

### Blockers / Escalations
- Notion API returns 0 pages — Morning Brief page not yet shared with integration

---

## 2026-06-28 — Morning Briefing Agent — REFINE-001

**Workflow:** N/A — instruction model clarification
**Status:** Completed

### Stand-up
- **Goal:** Reframe Morning Brief content as agent operating instructions, not a Notion page mirror
- **Context:** User clarified Overview / Workflow / Actions are instructions for the agent

### Actions Taken
1. Removed "Notion mirror" framing from `A_Agents/03_morning_briefing.md`
2. Grouped Overview, Workflow, Actions under **Instructions** section
3. Updated `S_Skills/wf_morning_brief.md` to reference agent instructions as source of truth

### Outputs
- Updated `A_Agents/03_morning_briefing.md`
- Updated `S_Skills/wf_morning_brief.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No PII exposed without redaction

### Performance Improvements
- Keep agent card as single instruction doc; workflow file remains execution detail only

### Blockers / Escalations
- None

---

## 2026-06-28 — Morning Briefing Agent — RUN-001

**Workflow:** `S_Skills/wf_morning_brief.md` — Stages 1–4 (full run)
**Status:** Completed

### Stand-up
- **Goal:** On-demand morning brief, simulated 09:00 IDT
- **Context:** User requested live agent run for 2026-06-28

### Actions Taken
1. Stage 1 — Queried `ak_system.sqlite` for meetings and open tasks due today
2. Stage 2 — Applied Research guidelines; no PII from people table
3. Stage 3 — Synthesized brief (Hebrew); noted empty schedule and stale DB
4. Stage 4 — Staged `O_Output/2026-06-28_morning-brief.md`

### Outputs
- `O_Output/2026-06-28_morning-brief.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No PII exposed without redaction

### Performance Improvements
- Wire morning brief to live Google Calendar sync when available
- Populate `B_Brain/organization_knowledge.md` for richer focus areas

### Blockers / Escalations
- AK System DB has no events/tasks for 2026-06-28; last meetings from April 2026

---

## 2026-06-28 — Morning Briefing Agent — RUN-002

**Workflow:** `S_Skills/wf_morning_brief.md` — Stage 1.2–1.6 (Notion gather)
**Status:** Blocked

### Stand-up
- **Goal:** Morning brief from all Notion databases + calendars; triage urgent/today/soon
- **Context:** User clarified SQLite was wrong source; Notion is primary

### Actions Taken
1. Queried Notion API search — 0 pages/databases shared with AK-System
2. Updated agent Instructions: Notion as primary source, triage rules
3. Updated `wf_morning_brief.md`: Steps 1.2–1.6 for Notion scan + fallback
4. Staged blocked brief with sharing instructions

### Outputs
- `O_Output/2026-06-28_morning-brief.md` (updated)
- `A_Agents/03_morning_briefing.md`, `S_Skills/wf_morning_brief.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No PII exposed without redaction

### Performance Improvements
- User must share Notion databases with AK-System integration, then re-run

### Blockers / Escalations
- Notion integration token valid but zero shared resources

---

## 2026-06-28 — Morning Briefing Agent — RUN-003

**Workflow:** `S_Skills/wf_morning_brief.md` — Stages 1–4 (Notion live)
**Status:** Completed

### Stand-up
- **Goal:** Morning brief at 09:00 from all Notion databases + calendars
- **Context:** User shared Notion access; filter Assignee Alpir Kritzler

### Actions Taken
1. Discovered 31 Notion databases; scanned Personal To-do, DT/Con Action items, Meetings, Assistant
2. Pulled Calendar Review + Email Summary for 2026-06-28
3. Triaged: 4 due today (High), 8 overdue High, 3 soon
4. Staged `O_Output/2026-06-28_morning-brief.md`

### Outputs
- `O_Output/2026-06-28_morning-brief.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No third-party PII beyond user's own calendar context

### Performance Improvements
- Exclude template Tasks Tracker DBs from scan (578 false overdue)
- Filter IBKR/Projects from task scan

### Blockers / Escalations
- None

---

## 2026-06-28 — Agent Chat UI — IMPLEMENT-001

**Workflow:** N/A — engineering implementation
**Status:** Completed

### Stand-up
- **Goal:** Build /agents page with Cursor SDK chat to ABC markdown agents + Notion context
- **Context:** User chose Cursor SDK over Gemini for agent page

### Actions Taken
1. Installed @cursor/sdk in apps/web
2. Created notion.ts, abc-agents.ts, cursor-agent-engine.ts, agent-chat-store.ts
3. Added agent_threads + agent_messages DB tables
4. Created /api/agents, /api/agents/chat, /api/agents/history
5. Created /agents page + AgentChatPanel + nav link

### Outputs
- apps/web/src/app/agents/page.tsx
- apps/web/src/components/AgentChatPanel.tsx
- apps/web/src/lib/cursor-agent-engine.ts
- apps/web/src/lib/abc-agents.ts
- apps/web/src/lib/notion.ts

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No PII exposed without redaction

### Performance Improvements
- Add CURSOR_API_KEY to apps/web/.env.local to enable live runs
- Local runtime requires dev server on Mac (not Railway)

### Blockers / Escalations
- Requires CURSOR_API_KEY in .env.local

---

## 2026-06-28 — Import Agents From AI Instructions Doc — IMPORT-001

**Active Agent:** `02_agent_trainer` (authoring) → registered under `01_Hugo_orchestrator`
**Workflow:** N/A — agent-card authoring + workflow creation (per ABC Rule 4)
**Status:** Completed

### Stand-up
- **Goal:** Import all 6 agents from `AI Instructions and settings.docx` into the ABC workspace as agent cards + S_Skills workflows
- **Context:** Verbatim doc instructions embedded in each card's Instructions section; auto-listed in /agents UI

### Actions Taken
1. Updated `A_Agents/03_morning_briefing.md` Instructions with doc's real Morning Brief content (task DBs DT/Con/Personal/DAZ, exclude Done, Today's Priorities + Things I Missed Yesterday, ☀️/H2/no-checkbox style, cite sources)
2. Aligned `S_Skills/wf_morning_brief.md` (sources, output sections, style rules)
3. Created `04_meeting_prep_herald.md` + `S_Skills/wf_meeting_prep.md`
4. Created `05_ibkr_daily_import.md` + `S_Skills/wf_ibkr_daily_import.md`
5. Created `06_calendar_optimizer.md` + `S_Skills/wf_calendar_optimizer.md` (approval-gated)
6. Created `07_email_assistant.md` + `S_Skills/wf_email_assistant.md` (confirmation-gated)
7. Created `08_startup_coo.md` + `S_Skills/wf_startup_coo.md` (no emojis)
8. Registered agents 04–08 in Hugo's Delegated Sub-Agents table

### Outputs
- `A_Agents/04_meeting_prep_herald.md` … `A_Agents/08_startup_coo.md`
- `S_Skills/wf_meeting_prep.md`, `wf_ibkr_daily_import.md`, `wf_calendar_optimizer.md`, `wf_email_assistant.md`, `wf_startup_coo.md`
- Updated `A_Agents/03_morning_briefing.md`, `S_Skills/wf_morning_brief.md`, `A_Agents/01_Hugo_orchestrator.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] Guardrails captured per agent (Calendar Optimizer: never act w/o approval; Email Assistant: no actions w/o confirmation; IBKR: de-dupe + skip non-transactions; Startup COO: no emojis)
- [x] No PII exposed without redaction

### Blockers / Escalations
- None

---

## 2026-06-28 — Daily Agents Run (09:00 simulation) — RUN-004

**Active Agent:** Multiple (`03`–`08`)
**Workflow:** `scripts/run_daily_agents.py` — Notion live fetch + Word export
**Status:** Completed (partial — IBKR/Gmail not connected)

### Stand-up
- **Goal:** Run all daily agents as if 09:00 today; export to Word for easy reading
- **Context:** User requested commit + full agent run + docx export

### Actions Taken
1. Committed ABC agent import (9760b08)
2. Created `scripts/run_daily_agents.py` — fetches Notion tasks + Assistant Calendar/Email pages
3. Ran all 6 agents for 2026-06-28 @ 09:00 IDT
4. Exported combined Word doc + per-agent markdown files

### Outputs
- `O_Output/2026-06-28_daily-agents-run.docx` (main deliverable)
- `O_Output/2026-06-28_daily-agents-run.md`
- Per-agent markdown files in `O_Output/`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] Calendar Optimizer / Email Assistant: recommendations only, no actions taken

### Performance Improvements
- IBKR Daily Import blocked without Gmail — needs inbox connection for live run
- Startup COO is on-demand only (no daily output)

### Blockers / Escalations
- IBKR agent: Gmail not connected in automated run

---

## 2026-06-28 — Startup COO On-Demand Run — RUN-COO-001

**Active Agent:** `08_startup_coo`
**Workflow:** `S_Skills/wf_startup_coo.md`
**Status:** Completed

### Stand-up
- **Goal:** On-demand COO ops review from today's live context (no specific user question)
- **Context:** User requested immediate COO run after daily agents batch

### Actions Taken
1. Read agent Instructions + today's Morning Brief / Email / Meeting Prep outputs
2. Structured problem: dual-context overload (Dragontail + Daz), 17 overdue, 4 High due today
3. Produced recommendation memo: Daz KYC first, delegate Dragontail process items via 1:1s, kill/defer Con backlog noise

### Outputs
- `O_Output/2026-06-28_startup-coo.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] No emojis in COO output
- [x] Assumptions flagged (Daz stage/runway unknown)

### Blockers / Escalations
- None

---

## 2026-06-28 — Hugo Orchestrator — WhatsApp Bridge Implementation

**Active Agent:** `01_Hugo_orchestrator`
**Workflow:** `S_Skills/wf_whatsapp_bridge.md` — Stages 1–3
**Status:** Completed

### Stand-up
- **Goal:** Implement personal WhatsApp bridge (Baileys) as standalone app + AK System integration
- **Context:** User approved plan for self-chat first, groups later, standalone project connecting to AK

### Actions Taken
1. Created `S_Skills/wf_whatsapp_bridge.md` and `wf_whatsapp_summary.md` with compliance checklist
2. Built `apps/whatsapp-bridge` — Baileys, QR UI, `/send`, group buffer, summarize endpoints
3. Added AK `whatsapp-bot.ts`, webhooks, `push-notifications.ts`, cron WhatsApp push, group-summary API
4. Updated `DEPLOY.md`, env examples, root pnpm scripts

### Outputs
- `apps/whatsapp-bridge/` (new package)
- `apps/web/src/lib/whatsapp-bot.ts`, `push-notifications.ts`
- `apps/web/src/app/api/whatsapp/webhook/route.ts`, `group-summary/route.ts`
- `apps/web/src/app/api/cron/whatsapp-group-summary/route.ts`
- `S_Skills/wf_whatsapp_bridge.md`, `S_Skills/wf_whatsapp_summary.md`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] Baileys ToS risk documented in workflow compliance checklist
- [x] No PII in code or logs

### Performance Improvements
- `pushAssistantMessage` unifies Telegram + WhatsApp cron delivery
- Bridge isolated from Next.js for persistent Baileys session

### Blockers / Escalations
- User must pair QR and deploy bridge with volume before live WhatsApp use

---

## 2026-06-28 — Hugo Orchestrator — WhatsApp Settings UI

**Workflow:** `S_Skills/wf_whatsapp_bridge.md` + `S_Skills/wf_whatsapp_summary.md` — Stage 3 extension
**Status:** Completed

### Stand-up
- **Goal:** DB-backed WhatsApp settings UI with group discovery, labels, FOMO/keyword alerts, and scheduled summaries (self-chat only).
- **Context:** Plan `whatsapp_settings_ui_f93ad762` — replace env `WATCH_GROUP_JIDS` with UI + bridge reload.

### Actions Taken
1. Added `whatsapp_labels` + `whatsapp_groups` tables (SQLite + Postgres schemas, inline migration).
2. Created `packages/api/src/routers/whatsapp.ts` — labels/groups CRUD, discover proxy, sync.pushToBridge.
3. Bridge: `GET /groups/available`, `POST /config/reload`, `group-config.ts`, `rules-engine.ts` (FOMO + keywords).
4. Built `/settings/whatsapp` page (Groups / Labels / Connection tabs); nav + settings card link.
5. Added `POST /api/whatsapp/group-alert` (Hebrew alerts → Message Yourself only).
6. Extended cron `whatsapp-group-summary` to match per-group/label `summaryTimes` in `TIMEZONE`.
7. Updated `DEPLOY.md`, `wf_whatsapp_bridge.md`, `wf_whatsapp_summary.md`.

### Outputs
- `apps/web/src/app/settings/whatsapp/page.tsx`
- `packages/api/src/routers/whatsapp.ts`
- `apps/whatsapp-bridge/src/group-config.ts`, `rules-engine.ts`
- `apps/web/src/app/api/whatsapp/group-alert/route.ts`

### Compliance
- [x] C_Core/ pre-flight check passed
- [x] Outbound guards unchanged — alerts/summaries self-chat only
- [x] No raw API errors sent to WhatsApp

### Performance Improvements
- Dynamic watch list via `POST /config/reload` — no bridge restart on group changes
- FOMO/keyword engines run in bridge RAM; scheduled summaries driven by AK cron + DB

### Blockers / Escalations
- User must click "Sync rules to bridge" after saving group settings
- Bridge must be connected for group discovery (`GET /groups/available`)

---

## 2026-06-28 — Agent session fix + יועץ יומן + notifications

**Agent:** Cursor engineering (Hugo-adjacent)
**Workflow:** N/A — standard `apps/` engineering

### Actions Taken
1. Fixed `createApiCaller()` — server-side agents/cron now use `createServiceCaller()` with a system session (resolves UNAUTHORIZED on calendar/tasks tools).
2. Renamed display name **Calendar Optimizer → יועץ יומן** (`06_calendar_optimizer` ID unchanged); added Hebrew aliases (יומן, לוח, יועץ).
3. WhatsApp natural-language triggers: `תריץ יועץ יומן`, `תריץ calendar optimizer`, etc.
4. Added `notifyAgentRunComplete` — Notion Inbox page for workflow agents; browser push when run from web UI.
5. Updated all cron routes to use `createServiceCaller()`.

### Outputs
- `apps/web/src/lib/api-caller.ts`, `service-session.ts`, `agent-notifications.ts`
- `apps/web/src/lib/notion.ts` — `notifyNotionInbox()`
- `A_Agents/06_calendar_optimizer.md` — display name יועץ יומן

### Compliance
- [x] C_Core/ — engineering-only; no client-facing content generated
- [x] Recommendations-only agent behavior unchanged

### Performance Notes
- Verified `/api/agents/chat` returns live calendar analysis after session fix (~31s)

---

## 2026-06-28 — Multi-channel delivery for all agents

**Agent:** Cursor engineering

### Actions Taken
1. Unified delivery: all agents instructed (Gemini + Cursor) to answer fully in chat — WhatsApp/Web/Telegram — not Notion-only.
2. `run_abc_agent` tool now includes all 8 agents dynamically; Hebrew/English aliases for every agent.
3. Notion context expanded to meeting prep, email, IBKR, startup COO (not just calendar/morning).
4. Notion Inbox archive on completion for all specialists (except Hugo orchestrator).
5. `runAgentForUser` wrapper + channel passed through resolveIntent (web/whatsapp/telegram).
6. Telegram bot gained same agent command support as WhatsApp.

### Outputs
- `apps/web/src/lib/agent-runner.ts`
- Updated: `abc-agents.ts`, `conversation-engine.ts`, `gemini-agent-engine.ts`, `whatsapp-bot.ts`, `telegram-bot.ts`

---

## 2026-06-29 — Hugo (Dev Pipeline) — mobile-app-notifications

**Workflow:** `.cursor/rules/dev-pipeline.mdc` — PM → UI → Dev → Tests → QA → Reviewer
**Status:** Completed

### Stand-up
- **Goal:** Make the PWA on the phone (Galaxy Fold 7) the primary interface to talk with the system, with real OS push notifications for every alert source (FOMO, morning brief, reminders, agent completions, Hugo). Keep WhatsApp active in parallel.
- **Context:** WhatsApp "Message Yourself" does not produce reliable notifications. User switched to a Fold 7 and wants folded + unfolded support. Decisions: Cloudflare Tunnel to local Mac + re-enable Google sign-in.

### Actions Taken
1. PM spec at `docs/specs/mobile-app-notifications.md`.
2. Infra: `scripts/serve.sh` (build + web prod + bridge + tunnel), `scripts/tunnel.sh`, root `serve`/`tunnel`/`start` scripts, VAPID + ALLOWED_EMAILS + Cloudflare env docs, DEPLOY.md tunnel section.
3. Auth: enforced session in production via `middleware.ts` (API/webhook/static bypass), email allowlist in `auth.ts`.
4. Fan-out: new `apps/web/src/lib/web-push.ts`; wired Web Push into `push-notifications.ts`, `agent-notifications.ts` (all channels), `whatsapp-bot.ts` (Hugo mirror), `group-alert` + `group-summary` routes.
5. Mobile/Fold UX: PWA `start_url=/chat` + shortcuts, Chat as primary bottom-nav tab, `ChatPanel` polling + focus refresh + centered max-width for tablet, Settings notifications card (enable + test).
6. Tests: `packages/api/src/routers/push.test.ts` (7), `apps/web/e2e/notifications.spec.ts` (chat + settings + folded/unfolded).

### Outputs
- Spec: `docs/specs/mobile-app-notifications.md`
- Review: `reports/mobile-app-notifications.md` (APPROVED WITH NITS)
- New: `apps/web/src/lib/web-push.ts`, `scripts/serve.sh`, `scripts/tunnel.sh`, `packages/api/src/routers/push.test.ts`, `apps/web/e2e/notifications.spec.ts`
- Updated: `middleware.ts`, `auth.ts`, `push-notifications.ts`, `agent-notifications.ts`, `whatsapp-bot.ts`, `group-alert/route.ts`, `group-summary/route.ts`, `ChatPanel.tsx`, `DashboardLayout.tsx`, `settings/page.tsx`, `manifest.json`, env examples, `DEPLOY.md`, root `package.json`

### Compliance
- [x] C_Core/ pre-flight check passed (engineering task; no PII)
- [x] No PII exposed without redaction

### Performance Improvements
- Push fan-out is now centralized; future channels plug into one helper.
- Next: initialize `apps/web` ESLint config so `next lint` runs non-interactively; consider true background agent jobs.

### Static Checks
- Vitest: 14/14 pass. Web build: pass (37/37 routes). Lint: bridge tsc pass; `apps/web` next lint uninitialized (pre-existing).

### Blockers / Escalations
- None. Real push delivery requires manual device verification (Fold 7) and VAPID keys + tunnel URL in `.env.local`.

---

## 2026-06-30 — Hugo (Dev Pipeline) — notification-center

**Workflow:** `.cursor/rules/dev-pipeline.mdc` — PM → Dev → Tests → QA → Reviewer
**Status:** Completed

### Stand-up
- **Goal:** In-app notification center (bell, badge, list, mark read) on web + Helm, plus Expo push parity for test sends.
- **Context:** User requested opening notifications from UI, not only OS push / chat timeline.

### Actions Taken
1. PM spec at `docs/specs/notification-center.md`.
2. DB: `notifications` table; `createNotification()` in fan-out paths.
3. API: tRPC `notifications` router; REST `/api/notifications` + `/api/push/test` for Helm.
4. Web: `NotificationBell`, `/notifications` page; `sendToAll` sends Web + Expo.
5. Helm: `notifications.tsx`, bell badge in chat, settings test button + permission state.
6. Tests: `notifications.test.ts` (4); E2E bell + page (6/6).

### Outputs
- Spec: `docs/specs/notification-center.md`
- Review: `reports/notification-center.md` (APPROVED WITH NITS)

### Compliance
- [x] C_Core/ pre-flight check passed (engineering task)

### Blockers / Escalations
- Manual: VAPID keys, `pnpm serve` + tunnel, Railway + EAS APK, Fold 7 device QA.

---

## 2026-07-12 — Hugo (Dev Pipeline) — agent-calendar-data-parity

**Workflow:** `.cursor/rules/dev-pipeline.mdc` — PM → Dev → Tests → QA
**Status:** Completed

### Stand-up
- **Goal:** Live calendar analysis (06_calendar_optimizer via WhatsApp/web) must match the rich Notion Inbox output that uses the same connections + instructions.
- **Context:** Live runs sometimes reported "only all-day events / no meetings" while the archived Notion review showed a full timed schedule.

### Root cause
- `fetchEventsForConnection` (`google-calendar.ts`) silently dropped any sub-calendar whose `events.list` transiently failed (`Promise.allSettled` → `if (!fulfilled) continue`). The work calendar's timed meetings vanished with no error; health probe stayed green (only `calendarList.list`). `calendarWarning` also only fired at zero events, so all-day events masked the failure.

### Actions Taken
1. PM spec at `docs/specs/agent-calendar-data-parity.md`.
2. `google-calendar.ts`: per-sub-calendar retry + surface each failure as a `GoogleCalendarFetchError`; `fetchEventsForConnection` returns `{ events, errors }`; `fetchGoogleCalendarEvents` merges them.
3. `agent-calendar-context.ts`: prompt now warns "נתונים חלקיים" / "אל תצהיר שהיום פנוי" whenever errors exist, even with events present.
4. `conversation-engine.ts`: `calendarWarning` now fires on any `googleErrors` (today/week/upcoming), not only zero events.
5. Tests: new partial-data prompt case in `agent-calendar-context.test.ts`.

### Outputs
- Spec: `docs/specs/agent-calendar-data-parity.md`
- Verify: `@ak-system/api` tests 89/89 green; `@ak-system/web` build green.

### Compliance
- [x] C_Core/ pre-flight check passed (engineering reliability fix)

### Blockers / Escalations
- Deploy to EC2, then confirm via `scripts/probe-agent-calendar-context.mts` that Dragontail timed events appear (or an explicit per-calendar error is listed).

---

## 2026-07-12 — Hugo (Dev Pipeline) — calendar off-by-one (small-ICU) + optimizer 8h filter

**Workflow:** `.cursor/rules/dev-pipeline.mdc` — diagnose → fix → test → deploy → verify
**Status:** Completed (root cause fixed, verified on EC2)

### Stand-up
- **Goal:** Make live agent calendar output match the rich Notion review (same connections/instructions). Also: exclude all-day + ≥8h events for `06_calendar_optimizer` only.

### TRUE root cause (found via in-container probe on EC2)
- The EC2 web container runs a **small-ICU** Node build (`process.config icu_small=false → icu false`). `Intl` formats **local midnight as hour "24"** instead of "00".
- `localMidnightToUtc` (`packages/api/src/lib/calendar-dates.ts`) subtracts the local time-of-day to snap to midnight; with hour=24 it subtracted a full extra day, so **every server-side calendar fetch was shifted one day earlier**. Only multi-day all-day events overlapped the wrong window, which is why live agent/app replies showed "only all-day events, no meetings." Notion looked fine because its Calendar Review page is a saved snapshot.
- Local Mac (full ICU) returned hour=0, so tests + local runs never reproduced it.

### Actions Taken
1. Fix: `const hour = Number(...) % 24` in `localMidnightToUtc` — normalizes the "24" quirk.
2. Regression test: ICU-independent round-trip in `calendar-dates.test.ts` (midnight instant must format back to the same date).
3. `06_calendar_optimizer` scope: `isExcludedFromCalendarOptimizer` in `calendar-filters.ts` (all-day + ≥8h) wired via `getAgentCalendarContext({ forCalendarOptimizer })` for agentId `06` only; unit tests added.
4. Also (prior turn, same session): per-sub-calendar retry + error surfacing in `google-calendar.ts`; partial-data prompt warning; `calendarWarning` on any error.

### Verification (EC2, live probe)
- Before fix: window = July 11, `total: 4` (all all-day), `timed: 0`.
- After fix: `today 2026-07-12, total: 11, timed: 7, dragontail: 7, errors: []` — matches Notion (Sync R&D, Agentic Infra Training, Shani 1:1, Tinko 1:1, …).

### Compliance
- [x] C_Core/ pre-flight check passed (reliability fix)

### Blockers / Escalations
- Consider baking full ICU into the runtime image (or `--icu-data-dir`) to prevent similar `Intl` quirks; not required now (`% 24` fix is ICU-agnostic). Tests 93/93 green; web build green.

---

## 2026-07-12 — Hugo (Dev Pipeline) — calendar optimizer never omits events (אבא וצף)

**Workflow:** diagnose → fix → test → deploy → verify (probe)
**Status:** Completed (verified on EC2)

### Stand-up
- **Goal:** Agent 06 missed the personal busy block "אבא וצף" (10:15–12:30, personal gmail calendar). Match Notion behavior of listing every event.

### Diagnosis (in-container probe)
- Data was correct: אבא וצף IS in the context agent 06 receives (TIMED, opaque, in scope). The LLM dropped it because it had 0 attendees.
- Key data insight: **all** events in this dataset have `attendees: []` (even real meetings like Shani 1:1, Tinko 1:1). So an attendee-count heuristic is unusable for classifying personal-vs-meeting.

### Actions Taken
1. Added a strong directive in `formatAgentCalendarContextForPrompt`: list EVERY event, never omit; personal blocks (e.g. אבא וצף) are real commitments; judge conflicts by title/type/calendar, NOT by attendee count (attendee lists are often empty).
2. Reinforced `A_Agents/06_calendar_optimizer.md` "How to present": always render a full schedule table of every event; personal blocks listed as "חסימת זמן אישי"; don't use attendee count to dismiss meetings.
3. Rejected+reverted an initial per-event "no-attendee = personal block" tag after the EC2 probe showed it mislabeled ALL meetings (would have suppressed real conflicts). Verification caught this before it shipped as the final state.
4. Test: `agent-calendar-context.test.ts` asserts אבא וצף is listed and the attendee-count caveat is present (94/94 green).

### Verification (EC2 probe, forCalendarOptimizer=true)
- All 7 timed events listed including "10:15 אבא וצף"; no false personal-block tags; load 8.6h.

### Compliance
- [x] C_Core/ pre-flight check passed (prompt/behavior refinement)

---

## 2026-07-13 — Hugo (Dev Pipeline) — Meeting Prep (04) + Email (07) data-source cleanup

**Workflow:** PM spec → dev → tests → QA (lint/build) — [`docs/specs/agent-data-sources-cleanup.md`](../docs/specs/agent-data-sources-cleanup.md)
**Status:** Completed locally (build + 22 web tests green); EC2 deploy + live verify pending user's Notion DB IDs

### Stand-up
- **Goal:** Agents 04 and 07 felt disconnected. Root cause: cards/workflows instructed reading data sources with no tool/config mapping (Notion People/Projects/Companies/AI Meeting Notes, Slack), so the model flailed.

### Actions Taken
1. Extended Notion integration: new `NotionDbType`s `people | projects | companies | meeting_notes` (`notion-config.ts`); generic `getNotionEntries()` fetcher + expanded `searchNotion` coverage + injected "Recent Meeting Notes" (`notion.ts`).
2. Exposed tools `get_notion_people/projects/companies/meeting_notes` and broadened `search_notion` (`conversation-engine.ts`).
3. Added `07_email_assistant` to `CALENDAR_CONTEXT_AGENTS` so it gets today's schedule (`abc-agents.ts`).
4. Rewrote `A_Agents/04` + `wf_meeting_prep`: Google Calendar authoritative for today's meetings, named exact Notion tools, partial-data warning (never claim empty day on errors).
5. Rewrote `A_Agents/07` + `wf_email_assistant`: explicit `search_gmail` (`is:unread newer_than:2d`), removed Slack (no integration), added calendar/Notion cross-ref, report scope errors instead of fabricating.
6. Documented new `NOTION_ACCOUNTS` types in env examples; added Vitest for the new types/fetchers.

### Compliance
- [x] C_Core/ pre-flight check passed (instruction alignment + read-only data wiring)

### Blockers / Escalations
- Meeting Prep enrichment (People/Projects/Companies/Meeting Notes) returns data only after the user adds those DB IDs to `NOTION_ACCOUNTS` on the server and shares each DB with the integration. Verify with `notion_status`. Also confirm Gmail `gmail.readonly` consent on both Google accounts for `search_gmail`.

---

---

## 2026-07-16 — Dev Pipeline (PM→UX→Dev→Tests→QA→Reviewer) — meeting-relationships-recurring-people

**Workflow:** dev-pipeline — Stages 1–6 (full)
**Status:** Completed

### Stand-up
- **Goal:** Ship meeting-series grouping, user-managed meeting types (1:1/strategy/operations/ad-hoc), a people-centric relationship + associated-tasks view, and a review/confirm queue for unknown calendar attendees.
- **Context:** Follows the Notion-vs-AK strategic review; user approved building the structured-data side in AK System.

### Actions Taken
1. Schema (additive): `meeting_series`, `meeting_types`; `seriesId`/`typeId` on meetings; `status`/`source` on people (schema.ts + schema.pg.ts + runtime migrations in index.ts).
2. API: new `meetingTypes` router (CRUD); extended `meetings` (series grouping by `recurringEventId`, Apple attendees, type on create/update/sync) and `people` (reviewQueue/confirm/merge/ignore, cadence, tasks-by-person).
3. UI: type filter/badges + series grouping on /meetings and detail, meeting-type selector in the meeting form, People review-queue tab, per-person cadence + full task list, meeting-type management in /settings.
4. Tests: 10 Vitest cases (meeting-relationships.test.ts) + 2 Playwright e2e.
5. QA/Reviewer: ran full suite; found and fixed a client cache-refresh bug on meeting-type CRUD (setData + refetch); re-verified green.

### Outputs
- docs/specs/meeting-relationships-recurring-people.md
- reports/meeting-relationships-recurring-people.md (pre + post UI/UX + QA verdict: APPROVED)
- Code: packages/database, packages/api, apps/web

### Compliance
- [x] C_Core/ pre-flight check passed (structured-data feature; no client-facing content generated)
- [x] No PII exposed without redaction (test data only; unknown attendees gated behind review queue)

### Performance Improvements
- Prefer `setData` + explicit `refetch()` over `invalidate()` alone for tRPC list caches — invalidate did not refetch the active query reliably here.
- Kill stale dev servers before Playwright runs (reuseExistingServer) and clear stale test sqlite before `drizzle-kit push` to avoid index-conflict false failures.

---

## 2026-07-16 — Dev Pipeline (PM→Dev→QA→Reviewer) — aro-rebrand + mobile-chat-keyboard + push

**Workflow:** dev-pipeline — Stages 1 (PM), 3 (Dev), 5 (QA), 6 (Reviewer)
**Status:** Completed (code); manual APK rebuild + device push verification pending on user

### Stand-up
- **Goal:** (1) Rebrand user-facing product name to ARO across web + mobile incl. logo/icons; (2) fix keyboard hiding the chat composer; (3) diagnose why phone push never arrives.

### Actions Taken
1. Rebrand: replaced My Space / AK System / Helm with ARO in web titles/manifest/sidebar/login/push fallbacks/settings/assistant prompts and mobile name/login/channel/test-title; WhatsApp `DEVICE_NAME` default -> ARO. Internal IDs (`@ak-system/*`, `com.alpir.helm`, `x-ak-client`, db path) untouched.
2. Icons: generated one ARO master (teal ring + chevron on navy), derived all web + mobile PNG sizes via sips, built multi-size favicon.ico via Node.
3. Keyboard: `softwareKeyboardLayoutMode: 'resize'`, `tabBarHideOnKeyboard: true`, `KeyboardAvoidingView behavior="padding"` + inset-based offset + `keyboardShouldPersistTaps` in chat.tsx.
4. Push: QA root-caused FAIL = 0 registered tokens in live DB + ephemeral tunnel URL; `channelId`/`priority` already in expo-push.ts working tree; added chat.tsx UI notice for failed push registration.
5. Verified: mobile tsc, web build, 177 unit tests (146 api + 31 web) all green.

### Outputs
- docs/specs/aro-rebrand.md, docs/specs/mobile-chat-keyboard.md
- reports/qa-helm-push.md (QA: FAIL — operational root cause), reports/aro-rebrand.md (Reviewer: APPROVED WITH NITS)
- Code: apps/web, apps/mobile, apps/whatsapp-bridge; icon assets.

### Compliance
- [x] C_Core/ pre-flight: no client-facing content generated; user-facing rename only.

### Blockers / Escalations
- Push requires user action: rebuild/install ARO APK, register a token, use a stable (non-quick-tunnel) backend URL, then confirm banner. Commit of expo-push.ts + google-services.json left to user per commit policy.

### Performance Improvements
- macOS has no ImageMagick; use `sips -Z <size>` for PNG scaling and a small Node script to assemble a PNG-entry .ico.
- Expo `next lint` prompts interactively (ESLint unconfigured) — rely on `tsc --noEmit` + `next build` for the reviewer gate.

## 2026-07-19 — Hugo (PM) — calendar optimizer WhatsApp secretary brief (spec only)

- **Active Agent:** `01_Hugo_orchestrator` (PM gate)
- **Workflow:** `S_Skills/wf_calendar_optimizer.md` (presentation fix pending)
- **Actions:** Diagnosed WhatsApp clutter (Markdown tables + meta self-talk in `A_Agents/06_calendar_optimizer.md`); drafted spec for secretary-style brief.
- **Output:** `docs/specs/calendar-optimizer-whatsapp-brief.md`
- **Compliance:** Clarity + human-in-loop; no code until approval
- **Notes:** Awaiting user approval + Telegram scope decision


## 2026-07-19 — Hugo (Dev Pipeline) — calendar optimizer secretary brief (all channels)

- **Active Agent:** `01_Hugo_orchestrator` → `06_calendar_optimizer` presentation
- **Workflow:** `S_Skills/wf_calendar_optimizer.md` Stage 4.1
- **Actions:** Approved scope = WhatsApp + Telegram + ARO; updated agent card + workflow; hard prompt override in `gemini-agent-engine.ts`; Hugo pass-through; prompt-contract tests; QA + review reports.
- **Output:** `docs/specs/calendar-optimizer-whatsapp-brief.md`, `reports/qa-calendar-optimizer-whatsapp-brief.md`, `reports/calendar-optimizer-whatsapp-brief.md`
- **Compliance:** Clarity; recommendations-only unchanged
- **Notes:** Needs deploy + live smoke on WhatsApp/ARO to confirm LLM adherence


## 2026-07-19 — Hugo (Dev Pipeline) — meeting prep related tasks only

- **Active Agent:** `04_meeting_prep_herald`
- **Workflow:** `S_Skills/wf_meeting_prep.md` Stage 2.1 / 4.1
- **Actions:** Spec + agent/workflow rules + hard prompt override — never dump full open backlog when no related tasks; empty → `לא נמצאו משימות קשורות לפגישה זו`.
- **Output:** `docs/specs/meeting-prep-related-tasks-only.md`, `reports/qa-meeting-prep-related-tasks-only.md`, `reports/meeting-prep-related-tasks-only.md`
- **Compliance:** Clarity; no invention; concise WhatsApp
- **Notes:** Deploy + live smoke recommended


## 2026-07-20 — Hugo (Dev Pipeline) — morning יועץ יומן, stop Meeting Prep spam

- **Active Agent:** `01_Hugo_orchestrator` → notification routing + `06_calendar_optimizer`
- **Workflow:** morning briefing cron / notification preferences
- **Actions:** Option A — cleared `pre_meeting_briefing` agent routing (UI-reversible); cleared broken morning `trigger_message`; morning cron now passes today’s schedule as agent context; deployed to EC2.
- **Output:** `docs/specs/morning-calendar-advisor-no-prep-spam.md`, `reports/morning-calendar-advisor-no-prep-spam.md`
- **Compliance:** Owner retains UI control over agent routing; on-demand Meeting Prep unchanged
- **Notes:** Prefs live immediately; morning context code live after deploy


## 2026-07-20 — Hugo (Dev Pipeline) — enrich pre-meeting template

- **Active Agent:** `01_Hugo_orchestrator` → pre-meeting cron template
- **Workflow:** `/api/cron/pre-meeting-briefing` (Option A, no LLM)
- **Actions:** Enriched brief with Google attendees, cleaned description/agenda, prior notes, related open tasks (meeting/project/title-token); deployed EC2.
- **Output:** `docs/specs/enrich-pre-meeting-template.md`, `reports/enrich-pre-meeting-template.md`
- **Compliance:** No invention; empty-state lines when data missing; Meeting Prep still re-routable from UI
- **Notes:** Live on next ~15-min pre-meeting window


## 2026-07-22 — Hugo (PM) — calendar brief Notion-parity (spec only)

- **Active Agent:** `01_Hugo_orchestrator` → PM gate for `06_calendar_optimizer` presentation
- **Workflow:** Dev pipeline — PM Agent (spec before code)
- **Actions:** Diagnosed quality gap vs Notion Calendar Optimizer (caused by 2026-07-19 ultra-short secretary brief); drafted Notion-parity WhatsApp-safe structure (no tables, full sections).
- **Output:** `docs/specs/calendar-brief-notion-parity.md`
- **Compliance:** Clarity; recommendations-only unchanged; awaiting owner approval before implementation
- **Notes:** Supersedes structure of `calendar-optimizer-whatsapp-brief`; keeps no-tables + no-meta


## 2026-07-22 — Hugo (Dev Pipeline) — calendar brief Notion-parity

- **Active Agent:** `01_Hugo_orchestrator` → `06_calendar_optimizer` presentation
- **Workflow:** `S_Skills/wf_calendar_optimizer.md` Stage 4.1
- **Actions:** Replaced ultra-short secretary brief with Notion-parity WhatsApp-safe sections; calendars primary / Notion optional; hard prompt override + Hugo pass-through; prompt-contract tests; QA + review.
- **Output:** `docs/specs/calendar-brief-notion-parity.md`, `reports/qa-calendar-brief-notion-parity.md`, `reports/calendar-brief-notion-parity.md`
- **Compliance:** Clarity; recommendations-only unchanged; no Notion dependency for core brief
- **Notes:** Needs deploy + live smoke on WhatsApp/ARO to confirm LLM adherence


## 2026-07-22 — Hugo (Dev Pipeline) — filter all-day from pre-meeting

- **Active Agent:** `01_Hugo_orchestrator` → pre-meeting cron / `calendar.upcoming`
- **Workflow:** `/api/cron/pre-meeting-briefing`
- **Actions:** Diagnosed 02:45 WhatsApp spam (Google date-only → UTC midnight → 03:00 IL); renamed shared filter to `isExcludedFromTimedMeetingAlerts`; applied to `calendar.upcoming` (+ DRY conflicts); tests + QA + review.
- **Output:** `docs/specs/filter-allday-pre-meeting.md`, `reports/qa-filter-allday-pre-meeting.md`, `reports/filter-allday-pre-meeting.md`
- **Compliance:** No invention; calendar UI `events` unchanged
- **Notes:** Deploy required to stop live spam tonight


## 2026-07-23 — Hugo (Dev Pipeline) — pre-meeting Notion parity on WhatsApp

- **Active Agent:** `04_meeting_prep_herald` via `pre_meeting_briefing` cron
- **Workflow:** `S_Skills/wf_meeting_prep.md` + Notion-parity channel override
- **Actions:** Re-routed pre-meeting to Meeting Prep Herald; WhatsApp/cron prompt bans invite paste and requires talk-about/stance/actions; gate skips solo/bot-only; template fluff tightened; deployed.
- **Output:** `docs/specs/pre-meeting-prep-notion-parity.md`, `reports/pre-meeting-prep-notion-parity.md`
- **Compliance:** UI-reversible routing; grounding + related-tasks-only retained; silent skip for gated noise
- **Notes:** Next ~15-min pre-meeting with real attendees should look like Notion Unleash prep, not calendar description dump


---

## 2026-07-26 — PM Agent — fix-evening-morning-confusion

**Workflow:** Dev pipeline — PM spec
**Status:** Partial (spec drafted; awaiting approval)

### Stand-up
- **Goal:** Diagnose Calendar Optimizer “evening instead of morning” + missing WhatsApp morning delivery; write fix spec
- **Context:** User report; prod DB + chat history inspected on EC2

### Actions Taken
1. Confirmed `morning_briefing` fires at 07:00 IL via `06_calendar_optimizer`; evening 20:00 is Hugo `daily_meeting_summary` titled wrongly as עדכון בוקר
2. Confirmed WhatsApp channel on; bridge send works (LID+JID); reshent today’s brief for smoke
3. Wrote `docs/specs/fix-evening-morning-confusion.md`

### Outputs
- `docs/specs/fix-evening-morning-confusion.md`

### Compliance
- [x] Engineering task (apps/packages) — PM-first per pipeline
- [x] No secrets committed

### Performance Improvements
- Prod evidence beat guessing: schedule was fine; branding + delivery observability are the real gaps


---

## 2026-07-27 — Hugo (Dev Pipeline) — task-workspaces (מקורות + quick-add)

**Workflow:** Dev pipeline — PM → UI/UX → Dev → Tests → QA → Reviewer
**Status:** Complete

### Stand-up
- **Goal:** Unify tasks from Alpir Consulting / Dragontail / DAZ / personal in one view, filterable by source, with quick task capture from anywhere
- **Context:** User request; source dimension chosen as a new "workspace" layer orthogonal to projects, plus Notion-label-driven auto-assignment

### Actions Taken
1. DB: `workspaces` table + `tasks.workspaceId` in SQLite and Postgres schemas; runtime bootstrap migration with idempotent seed of the four sources
2. API: new `workspaces` router (CRUD, delete nullifies task links); `tasks` create/update/list/listByWorkspace extended; Notion sync maps `notionDb` / `notionAccount` to a workspace label
3. UI: source filter chips + pill on `/tasks`, source field in `TaskModal`, global FAB + `QuickAddTaskModal`, `/settings/workspaces` management page, pills on project/meeting/person surfaces
4. Tests: 20 new Vitest cases + 4 Playwright cases
5. QA + review: 180/180 unit tests green over three runs; web build passes

### Outputs
- `docs/specs/task-workspaces.md`, `reports/qa-task-workspaces.md`, `reports/task-workspaces.md`

### Compliance
- [x] Engineering task (apps/packages) — PM-first per pipeline
- [x] All new procedures are protected; no new public surface
- [x] No secrets committed

### Performance Improvements
- Writing tests first surfaced a latent task-id collision (`'t' + Date.now()`) that quick-add would have made user-visible
- The e2e run caught a modal that discarded typing when its fetch resolved late — a class of bug unit tests cannot see


---

## 2026-07-27 — Hugo (Dev Pipeline) — Outlook bridge token from EC2

**Workflow:** Dev pipeline — PM → Dev → Tests → QA → Reviewer
**Status:** Complete

### Stand-up
- **Goal:** Make production Google OAuth the single source of truth for the Mac Outlook→Dragontail bridge
- **Context:** Local bridge token had `invalid_grant`; user wanted to avoid running local Next.js solely to reconnect Google

### Actions Taken
1. Added an SSH-based single-row token export from EC2 production SQLite; no full DB copy
2. Extended the local importer with JSON input and force-refresh verification
3. Wired token import, local fallback, and one `invalid_grant` retry into manual and generated launchd runners
4. Automatically maintains a current-IP `/32` SSH security-group rule when AWS CLI credentials are available
5. Reinstalled launchd and completed a live automatic sync with exit code 0

### Outputs
- `docs/specs/outlook-bridge-token-from-ec2.md`
- `scripts/pull-google-token-from-ec2.sh`
- `scripts/import-google-token-from-prod.ts`
- `scripts/outlook-bridge-run.sh`
- `scripts/install-outlook-bridge.sh`
- `reports/qa-outlook-bridge-token-from-ec2.md`
- `reports/outlook-bridge-token-from-ec2.md`

### Compliance
- [x] User approved spec before implementation
- [x] Only the selected OAuth row crosses SSH; temporary token files use `umask 077` and are removed
- [x] No token or secret was printed or committed
- [x] Production reconnect remains human-approved through Settings

### Performance Improvements
- A production reconnect now reaches the Mac within the next 15-minute launchd interval
- EC2 outage falls back to the last valid local token instead of stopping preemptively
- QA: 180/180 unit tests and build passed; 22/33 existing E2E tests passed; repository lint remains blocked by interactive Next.js ESLint setup


---

## 2026-07-30 — Hugo (Dev Pipeline) — Notion workspace mapping & rich task status

**Workflow:** Dev pipeline — PM → UI → Dev → Tests → QA → Reviewer
**Status:** Complete

### Stand-up
- **Goal:** Link Notion databases to workspaces by database id (over free-text labels) and replace boolean done with a 5-value canonical status; stop skipping done/cancelled Notion tasks so they still display.
- **Context:** DAZ lives in a separate Notion workspace and needs its own integration/token; code change is generic and surfaces it automatically once `NOTION_ACCOUNTS` includes DAZ.

### Actions Taken
1. Schema: `workspace_notion_databases` + `notion_status_overrides` tables, `tasks.status` / `tasks.notion_status_raw` columns, SQLite bootstrap + idempotent status backfill, Postgres parity.
2. Types: `STATUS_COLORS` / `STATUS_LABELS` / `TASK_STATUS_ORDER` / `TaskStatus` (cancelled = muted purple).
3. API: workspaces link/unlink/list procedures, new `notion-status-overrides` router, tasks `status⇄done` coupling, sync ID-first workspace resolution + status capture, removed the done-skip.
4. UI: WorkspaceModal link checklist (pending/error states), `/settings/notion-statuses` mapping page + settings card, workspaces link-count caption, TaskModal status chips, `StatusPill` on `/tasks`.
5. Tests updated to the new keep-done behavior; added db-id/heuristic/override/link/coupling coverage.

### Outputs
- `docs/specs/notion-workspace-mapping.md`, `reports/qa-notion-workspace-mapping.md`, `reports/notion-workspace-mapping.md`

### Compliance
- [x] Engineering task (apps/packages) — PM-first per pipeline
- [x] All new procedures are protected; no new public surface
- [x] No secrets committed; DAZ token/env is a manual production step

### Performance Improvements
- Deriving `done` from `status` in one place (create/update/toggle/sync) prevents the two fields from drifting
- Writing the "Not started" heuristic test caught `started ⊂ not started` before it mislabeled backlog items
- QA: 200/200 API unit/integration tests pass; web build green; repository lint remains blocked by interactive Next.js ESLint setup


---

## 2026-07-30 — Hugo (Dev Pipeline) — `pending` status, DAZ Notion wiring, tasks UX pass

**Workflow:** Dev pipeline — PM → UI/UX → Dev → Tests → QA → Reviewer
**Status:** Complete (deploy to EC2 still pending — user action)

### Stand-up
- **Goal:** Add a sixth canonical status `pending`, connect the DAZ Notion workspace (tasks + people), and make the tasks screen effortless per a UI/UX review.
- **Context:** The DAZ integration token was supplied by the user. Discovery through the Notion API found the tasks database nested inside the "Product roadmap" page — it was not visible at the top level, so a plain database search would have missed it.

### Actions Taken
1. Notion discovery (live, read-only): resolved `DAZ Tasks` and `DAZ People` database ids and full property schemas; confirmed the user's DAZ display name is "Alpir Kritzler" so the assignee filter matches.
2. Env: `NOTION_ACCOUNTS` in `deploy/production.env` + `apps/web/.env.local` — Personal (3 task DBs, preserving legacy parity) and DAZ (tasks + people).
3. Status: `pending` added to `TASK_STATUSES` (both dialects), types order/colors/labels; `blocked` relabelled "חסום" so it no longer collides with "בהמתנה".
4. Heuristic: split the old catch-all into pending (`pending`/`waiting`/`on hold`/`ממתין`) vs blocked (`block`/`stuck`/`חסום`); `Testing` now reads as `in_progress`.
5. UX: `בוטלו` tab with status-based filtering so cancelled work is never filed under "הושלמו", ✕ glyph for cancelled rows, priority chips converted to accessible buttons, chip targets to 40 px, redundant "הושלם" pill suppressed.

### Outputs
- `docs/specs/task-status-pending-and-ux.md`, `reports/task-status-pending-and-ux.md`

### Compliance
- [x] Engineering task (apps/packages) — PM spec written before any code
- [x] PII: importing DAZ contacts into the CRM was explicitly requested by the user before wiring the people database
- [x] No secrets committed — both env files carrying the tokens are git-ignored

### Performance Improvements
- Reviewing labels before implementing caught the "ממתין" / "בהמתנה" collision while it was still a one-line change
- Diagnosing 5 red tests as leaked `ABC_ROOT=/data/abc` from an earlier `source` in the same persistent shell — rather than as a regression — avoided chasing a phantom bug; worth unsetting sourced env before running suites
- QA: 202/202 unit/integration tests, 5/5 tasks-screen e2e, web build green, no lint errors on changed files

## 2026-07-30 — Hugo (Dev Pipeline) — Notion write-back + mobile tasks parity

**Workflow:** Dev pipeline — PM → UI/UX → Dev → Tests → QA → Reviewer
**Status:** Complete (commit/push/deploy + mobile APK rebuild still pending — user action)

### Stand-up
- **Goal:** Make status changes in the app write back to Notion, and bring the mobile tasks screen up to the same language as web (statuses, sources, detail, FAB).
- **Context:** User confirmed two-way sync + full mobile parity (statuses, source filter, tap-for-details, floating +).

### Actions Taken
1. Spec: `docs/specs/notion-writeback-and-mobile-tasks.md`.
2. Write-back service: resolve account/db → schema cache → map canonical→literal label (same overrides as read) → `PATCH /v1/pages/{id}`; hooked into `tasks.toggleDone` + `tasks.update`.
3. Local write always commits first; mutations return `notionSync` so UI can report failure without rolling back.
4. Mobile: status/workspace fields, 4 status tabs, source chips, status pills, split checkbox/detail targets, FAB, `formSheet` create/edit at `/task/[id]`.
5. Web: Notion hint in TaskModal; checkbox failure toast on `/tasks`.

### Outputs
- `docs/specs/notion-writeback-and-mobile-tasks.md`, `reports/notion-writeback-and-mobile-tasks.md`

### Compliance
- [x] Engineering task — PM spec before code
- [x] No secrets committed
- [x] Notion write scoped to status property only (title/due/assignee out of scope)

### Performance Improvements
- Schema cached 5 min so rapid checkbox taps do not re-fetch the database definition each time
- QA: 216/216 unit tests, mobile tsc green, web build green

## 2026-07-30 — Hugo (Dev Pipeline) — Fix stale-deploy bug (write-back never reached production)

**Workflow:** Bugfix
**Status:** Complete — verified live

### Stand-up
- **Goal:** User reported marking a task done in ARO, then running Notion sync, reverted it — investigate why two-way sync was not working.
- **Root cause:** `deploy-ec2.sh` only exports `AK_DEPLOY_BUILD=1` in its own `SKIP_CI=1` fallback branch. The default path runs `ci.sh`, whose build step called plain `pnpm build`. `next.config.js` sends non-`AK_DEPLOY_BUILD` builds to a `/tmp` distDir (a Google-Drive-workspace workaround), so `apps/web/.next` — the directory rsync ships — was never touched. The prior deploy (commit aa2d118, containing the write-back feature) reported success and passed health checks, but the container kept running commit a4e1a5c's bundle. Verified via BUILD_ID mismatch and `grep` for write-back string literals missing from the deployed `.next`.

### Actions Taken
1. `scripts/ci.sh`: build step now always sets `AK_DEPLOY_BUILD=1`.
2. Rebuilt locally with the correct env var; confirmed new BUILD_ID + write-back strings present in `apps/web/.next` before shipping.
3. Redeployed (`SKIP_CI=1 SKIP_LOCAL_BUILD=1`, using the verified local build); confirmed the *same* BUILD_ID now running inside the EC2 container, with the write-back code present.
4. Confirmed low-level Notion PATCH works against a real production page/token (schema fetch on "Personal To-do" returns `Status` options `Not started/In progress/Pending/Done/Canceled`, correctly resolves to `Done`).

### Outputs
- `scripts/ci.sh` fix, commit `3049e94`

### Compliance
- [x] No secrets committed or logged (Notion tokens read locally only, from gitignored env files, never printed in full)
- [x] Diagnostic PATCH against a real Notion page was reverted immediately after verification

### Performance Improvements
- Verifying the *deployed artifact* (BUILD_ID + string grep inside the running container) rather than trusting "Deploy complete" health-check output would have caught this immediately — add this check as a standing habit after any deploy that changes server-side logic

## 2026-07-30 — Hugo (Dev Pipeline) — Push new ARO tasks into their workspace's linked Notion database

**Workflow:** Dev pipeline — PM → Dev → Tests → QA → Reviewer
**Status:** Complete (commit/push/deploy pending — user action)

### Stand-up
- **Goal:** User asked whether a task created in ARO lands in the correct Notion database. Confirmed it did not — task creation was local-only, no `POST /v1/pages` call existed anywhere. User confirmed (via structured question) they want a push, scoped to workspaces with an existing Notion link.
- **Context:** Builds directly on the write-back feature shipped earlier today — reuses its schema cache, status-label mapping, and `notionSync` result convention.

### Actions Taken
1. Spec: `docs/specs/notion-task-create-push.md`.
2. `resolveWorkspaceNotionTarget` (notion-tasks-sync.ts): workspace → linked Notion database → token/account.
3. `createNotionTask` (notion-task-writeback.ts): `POST /v1/pages` with title + best-effort not_started-status + best-effort due date; refactored the schema fetcher to also detect the title/date properties, same 5-min cache.
4. `tasks.create`: local insert first (unchanged), then best-effort push; on success attaches `notionPageId`/`notionAccount`/`notionDb`/`notionStatusRaw` so the task is indistinguishable from one pulled from Notion; on failure the task stays an ordinary manual task.
5. Web: "will also create in Notion" hint + failure notice in `TaskModal`, `QuickAddTaskModal`, `DashboardLayout`'s FAB toast, and `tasks/page.tsx`'s sync message.
6. Mobile: user asked for the same on the app. The push itself needed zero backend changes — mobile's create screen already called `tasks.create` with `workspaceId`. Added `notionDatabases` to `MobileWorkspace`, `notionSync` to `createTask`'s return, and the same hint/failure-notice pattern already used for `update`'s write-back in `apps/mobile/app/task/[id].tsx`.

### Outputs
- `docs/specs/notion-task-create-push.md`, `reports/notion-task-create-push.md`

### Compliance
- [x] Engineering task — PM spec before code
- [x] No secrets committed
- [x] Local task is never lost or blocked by a Notion outage — push is strictly additive/best-effort

### Performance Improvements
- QA: 224/224 API unit/integration tests (22 new), 64/64 web unit tests, web build green, mobile/whatsapp-bridge tsc green
- `apps/web`'s `next lint` cannot run non-interactively (no committed `.eslintrc`) — pre-existing gap, flagged in the review report, not fixed in this pass since it's orthogonal to the feature

---

## 2026-08-02 — Hugo (Dev Pipeline) — Mobile task-form date picker, keyboard avoidance, reading list, agent-feedback chat tool

**Workflow:** Dev pipeline — PM → UI/UX → Dev → Tests → QA → Reviewer
**Status:** Complete (commit/push pending — user action; EAS preview build queued)

### Stand-up
- **Goal:** Four user-requested items, all reachable from the mobile app: (1) a real date picker in the task form, (2) the keyboard must not cover the form, (3) a personal reading list, (4) a way to describe a correction in chat and have it routed to the right `A_Agents` specialist.
- **Context:** Follows this session's `ngrok-skip-browser-warning` connectivity fix. User confirmed scope via structured questions: items 1–2 for mobile **and** web, reading list = personal bookmarks (manual URL + title, read/unread), and item 4 as a new tool on the existing chat that logs to `M_Memory` for human review rather than editing agent cards.

### Actions Taken
1. Spec `docs/specs/mobile-task-form-reading-list-feedback.md`; pre-implementation UI/UX review (APPROVED WITH NITS).
2. Mobile date picker: `@react-native-community/datetimepicker@9.1.0` (verified against the Expo **SDK 56** docs per `apps/mobile/AGENTS.md`, listed as supported/in Expo Go), registered in `app.config.ts` plugins. Replaced the free-text `YYYY-MM-DD` field with a pressable field showing a Hebrew long-form date, plus a "נקה תאריך" affordance. Formats from local date parts, not `toISOString()`, so the chosen day can't shift a day back east of UTC.
3. Mobile keyboard: `KeyboardAvoidingView` with `behavior="padding"` on **iOS only** — Android already sets `softwareKeyboardLayoutMode: 'resize'`, and stacking both double-adjusts inside a `formSheet`. Web needed no change (both task modals already use `<input type="date">`; `.modal` already scrolls).
4. DB: `reading_list_items` in `schema.pg.ts` + `schema.ts`, plus SQLite `CREATE TABLE IF NOT EXISTS` bootstrap in `packages/database/src/index.ts` (the repo's actual migration mechanism — there is no `drizzle/` migration dir).
5. API: `packages/api/src/routers/readingList.ts` (`list`/`create`/`markRead`/`delete`), mounted as `readingList`.
6. UI: `apps/mobile/app/reading-list.tsx` reached from a new header icon (5-tab bar left intact) and `apps/web/src/app/reading-list/page.tsx` linked from the "מידע" nav section.
7. Chat tool: `log_agent_feedback` declaration + dispatch in `conversation-engine.ts`, backed by new `apps/web/src/lib/agent-feedback-log.ts` which **appends only** to this file. Confirmation phrasing pinned in the system prompt ("נרשם לטיפול ב-X, ייבדק ידנית") so the model can't imply the fix is already live.
8. EAS preview APK queued (bundles the datetimepicker native dep together with the earlier ngrok header fix): build `8fbcf7fa-b475-4e1a-b78d-87c2fbf137ec`.

### Outputs
- `docs/specs/mobile-task-form-reading-list-feedback.md`
- `reports/qa-mobile-task-form-reading-list-feedback.md`
- `reports/mobile-task-form-reading-list-feedback.md` (pre- and post-implementation UI/UX + code review, both APPROVED)

### Compliance
- [x] Engineering task — PM spec written before any code
- [x] Rule 3 honored: the new tool only ever appends to `M_Memory/agents_daily_sync.md`; a test asserts the target `A_Agents/*.md` stays byte-identical, and `agentId` is `path.basename`-guarded against traversal
- [x] No secrets added; the new table stores only user-supplied URLs/titles

### Performance Improvements
- QA: 239/239 API tests (+9), 78/78 web unit tests (+14), 6/6 new reading-list Playwright specs, web build green with `/reading-list` emitted, mobile/whatsapp-bridge tsc green
- Two real bugs were caught by writing the tests rather than by inspection: zod validated the URL *before* trimming (pasted URLs with whitespace were rejected), and the browser's native `type="url"` bubble preempted our Hebrew inline error on web
- 12 pre-existing e2e failures confirmed unrelated — stale selectors from an earlier UI refresh (e.g. `/recurring` is now a redirect, the `/chat` heading no longer exists in `HEAD`). Verified against `HEAD` rather than assumed, since files I never touched were involved
- Process note: I briefly ran `git stash` mid-QA, which silently pulled the new untracked files out of the build (the missing `/reading-list` route in the build output was the tell). Restored and verified, but the lesson is not to reach for `git stash` while a build/verification step is in flight
- Repo gap worth a future pass: `next lint` still can't run non-interactively, and Postgres deployments need `drizzle-kit push` for `reading_list_items` since the SQLite auto-create path doesn't cover PG

---

## 2026-08-03 — bank-accounts-snapshot (feature pipeline, Claude/Cowork)

- **Goal:** Bank & credit card snapshot view — Hapoalim, Otsar HaHayal, Visa Cal, Isracard via israeli-bank-scrapers (read-only), per spec `docs/specs/bank-accounts-snapshot.md` (Approved).
- **Actions Taken:** PM spec → UI pre-review → dev (schema ×2 + SQLite bootstrap, AES-256-GCM credential crypto, bank-sync-service with sequential scraping + dedupe, finance.bankConnections tRPC sub-router + getAccountsSnapshot, cron/bank-sync route, Accounts tab + BankConnectionModal + source pill, Node 20→22 upgrade) → tests (3 Vitest files + 1 Playwright spec) → QA (sandbox: full tsc typecheck, crypto runtime verification, SQLite bootstrap SQL verification) → review.
- **Outputs:** `reports/bank-accounts-snapshot.md` (APPROVED WITH NITS — pending local `pnpm install && pnpm qa && build` on Node ≥22.12; sandbox lacked npm registry + macOS-only node_modules binaries).
- **Compliance:** Read-only bank access only (`scrape()` sole operation); credentials AES-256-GCM encrypted at rest, never returned by any procedure; no PII in logs; sync capped at once daily + manual click.
- **Performance Improvements:** Sequential scraping enforced + tested (1 GB EC2 constraint); dedupe via unique sha256 key prevents duplicate imports.
- **Blockers:** Local verification required before deploy (see report Verification section).

---

## 2026-08-03 — agent-precision-and-push-reliability (audit + card cleanup, Claude/Cowork)

- **Goal:** (1) Fix agent instruction precision (Hugo, morning briefing, meeting prep, email assistant); (2) diagnose why Helm APK never shows push notifications.
- **Root causes found:**
  - Push (a): **no scheduler invokes `/api/cron/*` in the local-Mac deployment** — `chat_messages` has 0 rows ever with `source='cron'`; only manual test pushes were ever sent. (b): server checks Expo *tickets* only, never *receipts* — FCM V1 credential errors (the "expoSent: 1, no banner" case, documented in `docs/deploy/helm-apk-build.md`) are invisible. 3 tokens accumulated in `expo_push_tokens` (stale reinstalls never pruned).
  - Precision: A_Agents/S_Skills md **are** the production prompts (`abc-agents.ts` → `gemini-agent-engine.ts` systemInstruction), but cards were written for the offline Notion/filesystem framework — "create a Notion page", "stage in O_Output", "DRAFT — REQUIRES HUMAN REVIEW", "output staged for human delivery", "search Slack", Hugo card still `Status: Template` with `[TBD]` sub-agents, email card demanding Markdown tables WhatsApp can't render. Also: hugoInstructions silently truncated at 4000 chars mid-prompt; morning_briefing suggested routing → `06_calendar_optimizer` (whose MANDATORY override beats the user's 03 card); unrouted morning briefing = template with no LLM; cron runs inherit last 20 chat messages as few-shot.
- **Actions Taken:**
  1. Cleaned 4 agent cards + 2 workflows to match the real runtime (reply = deliverable; no staging/meta-narration; Hebrew, WhatsApp-friendly, no tables; grounding markers): `A_Agents/01_Hugo_orchestrator.md` (Template→Active, [TBD] rows removed, runtime Run Protocol), `03_morning_briefing.md` (Notion-page workflow → direct-reply; Slack removed; phone-friendly style), `04_meeting_prep_herald.md` (runtime header + protocol), `07_email_assistant.md` (table → grouped list format; Notion Inbox notify removed), `S_Skills/wf_morning_brief.md`, `S_Skills/wf_email_assistant.md`.
  2. `scripts/local-cron.mjs` — local scheduler mirroring `deploy/crontab.example`, wired into `scripts/serve.sh` (skip with `SKIP_CRON=1`).
  3. `scripts/push-doctor.mjs` — sends a real test push and fetches Expo **receipts**, printing exact FCM errors + Hebrew fix hints; also reports cron-health from the DB.
  4. Spec `docs/specs/agent-precision-and-push-reliability.md` (DRAFT — awaiting approval) for the code-level fixes: receipt checking + token pruning + pushDeliveryLog table, memory budget 4000→12000 + precedence fix, universal no-table channel guard, morning-briefing routing default → 03, cron history isolation, Notion context cap, temp 0.3 on cron.
- **Outputs:** edited cards/workflows above; `scripts/push-doctor.mjs`; `scripts/local-cron.mjs`; `docs/specs/agent-precision-and-push-reliability.md`.
- **Compliance:** No `apps/`/`packages/` code touched without spec (scripts/ + md only). Append-only log honored. No PII exposed.
- **Blockers:** FCM V1 credential state on EAS project unverifiable from sandbox — user must run `node scripts/push-doctor.mjs` (and `bash scripts/check-helm-fcm.sh`) on the Mac. Empty `notification_preferences` / `agent_triggers` tables mean the email assistant has never been scheduled — user must route agents in Settings → Notifications.

---

## 2026-08-03 — agent-precision-and-push-reliability: IMPLEMENTATION (Claude/Cowork, phase 2)

- **Goal:** User approved the spec ("תעשה כל מה שאמרת") + directive: production dependency moves to EC2 24/7, not the Mac.
- **Actions Taken:** Full spec implemented — push_delivery_log table (pg+sqlite+bootstrap); expo-push.ts receipts check (`checkPendingExpoReceipts`, piggybacked on task-reminder cron) with dead-token pruning + once-per-24h FCM credential alert; `push.deliveryLog` tRPC + read-only יומן מסירה section in Settings ▸ Notifications; agent-memory cap 4000→12000 with pure `composeMemoryPromptBlock` + line-boundary truncation marker; memory block moved to END of system instruction with explicit PRECEDENCE statement; universal no-tables channel guard for all agents on whatsapp/telegram/cron; cron temperature 0.3; cron history 20→3; Notion calendarReview capped 6000; morning_briefing suggestedAgentId 06→03; unrouted morning template labeled. Tests: +7 expo-push, +5 agent-memory (new file), +1 preferences regression.
- **Outputs:** `reports/agent-precision-and-push-reliability.md` (IMPLEMENTED — PENDING LOCAL QA), `docs/deploy/ec2-24-7-runbook.md` (8-step migration off the Mac: FCM V1 → ngrok on EC2 → deploy → install-server-cron → phone re-register → receipt verification → agent routing → Mac shutdown).
- **Compliance:** Spec approved before code per dev-pipeline. Sandbox cannot run vitest/build (macOS-native binaries) — QA gate explicitly deferred to the Mac with exact commands in the report; verdict intentionally NOT marked APPROVED.
- **Blockers:** `pnpm db:push && pnpm test && pnpm --filter @ak-system/web test && pnpm -r run lint && pnpm --filter @ak-system/web build` must pass on the Mac; FCM V1 upload via `eas credentials` (helm-push-969711) is manual.

---

## 2026-08-04 — bank-scraper-ec2-chrome-deps (Hugo / Dev pipeline)

- **Active Agent:** Dev + QA + Reviewer (dev-pipeline)
- **Workflow:** docs/specs/bank-scraper-ec2-chrome-deps.md
- **Goal:** Fix Hapoalim sync on EC2 failing with Puppeteer Code 127 / missing libglib-2.0.so.0.
- **Actions Taken:** Installed Chromium shared libs in `deploy/Dockerfile.runtime` + root `Dockerfile`; passed Docker-safe Chromium args from `realScrape`; unit test for args; note in `docs/deploy/ec2-production.md`.
- **Outputs:** `docs/specs/bank-scraper-ec2-chrome-deps.md`, `reports/qa-bank-scraper-ec2-chrome-deps.md`, `reports/bank-scraper-ec2-chrome-deps.md` (APPROVED WITH NITS).
- **Compliance:** Spec approved before code. No schema/UI change. Tests 17/17 bank-related passed.
- **Blockers:** Needs `pnpm deploy:ec2` then manual "סנכרן עכשיו" to confirm Chromium launches on the instance.


---

## 2026-08-04 — bank-scraper-puppeteer-externals (follow-up)

- **Goal:** Fix `e.mask is not a function (UNKNOWN_ERROR)` on Hapoalim + Otsar sync after Chromium libs fix.
- **Root cause:** Next webpack + Puppeteer `ws` optional `bufferutil.mask` during browser launch in scraper `initialize()`.
- **Actions:** Externalize scrapers/puppeteer/ws in `next.config.js`; set `WS_NO_BUFFER_UTIL` / `WS_NO_UTF_8_VALIDATE`; redeployed EC2.
- **Outputs:** `docs/specs/bank-scraper-puppeteer-externals.md`, `reports/bank-scraper-puppeteer-externals.md`.
- **Blockers:** User should retry sync manually to confirm.


---

## 2026-08-04 — bank-trusted-device-otp (option 2)

- **Active Agent:** Dev pipeline (PM → Dev → Tests → QA → Reviewer)
- **Workflow:** docs/specs/bank-trusted-device-otp.md
- **Goal:** Persist Chromium profile per bank connection + one-time OTP UI so Hapoalim trusted-device skips SMS on later syncs.
- **Actions Taken:** Profile dir under `/data/bank-browser-profiles/<id>`; OTP bridge + page heuristics; `awaiting_otp` status; `submitOtp` mutation; AccountsTab OTP form + poll; extend redirect wait for OTP window.
- **Outputs:** `docs/specs/bank-trusted-device-otp.md`, `reports/qa-bank-trusted-device-otp.md`, `reports/bank-trusted-device-otp.md` (APPROVED WITH NITS).
- **Compliance:** Spec written for user-chosen option 2 before code. Tests 25/25 bank-related passed.
- **Blockers:** Needs `pnpm deploy:ec2` then one manual Hapoalim sync with SMS code; verify later sync skips OTP.

---

## 2026-08-04 — bank OTP Hapoalim modal fix (hot)

- **Goal:** OTP UI never appeared; Hapoalim shows device-trust modal over login form with 5 digit boxes.
- **Actions:** Detect modal by Hebrew copy even when #userCode/#password remain; fill digit boxes and click המשך (not כניסה). Redeployed.
- **Note:** Code 29028 could not be applied in time (wrong field then Chrome exited). User must sync again for a fresh SMS.

---

## 2026-08-04 — cashflow-data-reliability (PM + QA + QA-UI)

- **Active Agent:** PM Agent → QA Agent → QA UI Agent
- **Workflow:** docs/specs/cashflow-data-reliability.md
- **Goal:** Audit why Finance insights totals feel wrong (rent-only month).
- **Actions Taken:** Prod DB sample on EC2; mapped dual KPI paths; wrote reliability spec + QA/QA-UI FAIL reports. No code changes.
- **Outputs:** `docs/specs/cashflow-data-reliability.md`, `reports/qa-cashflow-data-reliability.md`, `reports/qa-ui-cashflow-data-reliability.md`
- **Key finding:** Aug countable ≈ ₪8186 (check ₪8100 as אחר + ₪86); Cal settlement ₪8884 excluded; no credit-card connection; header vs insights use different formulas.
- **Compliance:** Spec-only from PM; QA report-only.
- **Blockers:** Awaiting user approval of spec (and open questions: timezone normalize, force דיור on check, header label vs countable default) before Dev.

---

## 2026-08-04 — cashflow-data-reliability (implemented)

- **Active Agent:** UI Designer → Dev
- **Decisions:** (1) ₪8100 = שכירות + retag UX; (2) unify countable KPIs + subtext; (3) cards later.
- **Actions:** monthKey Asia/Jerusalem; getSummary countable; monthComposition; משיכת שיק→שכירות; cashflow select + composition panel; prod reclassified check rows; deployed EC2.
- **Outputs:** docs/specs + reports/cashflow-data-reliability.md; tests 81/81 analytics/categorizer.

### 2026-08-04 — Cashflow: user answers locked + rent tag refine
- **Agent:** Dev / UI Designer follow-up
- **Actions:** Locked OQ: retag UX critical; KPI = countable + shared subtext; cards deferred. Softened auto-keyword (no blanket משיכת שיק→שכירות). Prod: 11×₪8100 keep שכירות; 12 other checks → אחר; removed overbroad learned rule.
- **Compliance:** N/A (apps/packages engineering)

---

## 2026-08-05 — outlook-bridge-title-blocklist (incident + fix)

- **Active Agent:** PM → Dev → Dev Tests → QA → Reviewer
- **Workflow:** `docs/specs/outlook-bridge-title-blocklist.md`
- **Goal:** `Global D&T Town Hall [HOLD]` appeared hundreds of times in Dragontail and could not be deleted by hand.
- **Root cause:** Not the current bridge. The retired standalone agent `com.alpir.exchange-to-gcal` (`DEV/exchange-to-gcal-agent`, tag `source=exchangeSync`) was still loaded in launchd and re-inserted copies every 15 min between 2026-06-14 and 2026-06-28 without deleting prior ones. Its dedup keyed on a description that shifts between runs because the ~2,000-attendee list is truncated at Google's 8 KB limit. 4,680 of the 4,755 events in a ±365d window were its copies; 4,376 were duplicates of just 8 titles (1,461 "Tech Hour", 1,240 + 458 "* D&T Townhall", 710 Town Hall [HOLD], 493 "Round Table w Itzik").
- **Actions Taken:** (1) `launchctl bootout` the old agent + renamed its plist to `.disabled` so it cannot reload at login. (2) One-off cleanup script deleting only `source=exchangeSync`-tagged events — keep 1 per title+start, or 0 where the current bridge already owns the slot; untagged events never touched. (3) Added `OUTLOOK_BRIDGE_TITLE_BLOCKLIST` to the live bridge so global broadcast invites are never mirrored again.
- **Outputs:** `docs/specs/outlook-bridge-title-blocklist.md`, `reports/qa-outlook-bridge-title-blocklist.md`, `reports/outlook-bridge-title-blocklist.md`, `scripts/outlook-to-google-sync.ts`, `scripts/outlook-to-google-sync.test.ts`
- **Verification:** 21/21 bridge tests, 397/397 full suite, tsc clean. Live dry run: 3 blocked (2,066 / 448 / 418 attendees), 3 stale copies reclaimed, 0 false positives among the 55 kept events.
- **Gotcha worth remembering:** the blocklist value contains spaces and `scripts/outlook-bridge-run.sh` does `set -a; source apps/web/.env.local` under `set -euo pipefail` — it **must** stay quoted in `.env.local` or the whole launchd run aborts.
- **Compliance:** N/A (apps/packages/scripts engineering, not ABC workspace).
- **Follow-up:** `apps/web` has no ESLint config, so `pnpm -r run lint` fails on `next lint` interactively — pre-existing, worth a separate fix.

---

## 2026-08-05 — sales-documents (new module)

- **Active Agent:** PM → UI Designer → Dev → Dev Tests → QA → Reviewer
- **Workflow:** `docs/specs/sales-documents.md`
- **Goal:** Stop paying an external invoicing SaaS for 1–5 documents a month. In-house quotes, proformas, tax invoices, tax-invoice-receipts, credit invoices and receipts, wired into the existing VAT ledger.
- **Actions Taken:** New `packages/types/src/sales.ts` (document rules, bilingual `DOCUMENT_STRINGS`, totals with `vatMode`, allocation-number thresholds). Seven new tables — `companies`, `service_items`, `company_item_prices`, `sales_documents`, `sales_document_lines`, `sales_document_payments`, `sales_document_counters` — in `schema.pg.ts` + `schema.ts` + SQLite bootstrap, plus `people.companyId`, `vat_entries.salesDocumentId`, `user_settings.businessProfile`. Three new routers (`companies`, `serviceItems`, `salesDocuments`) + `settings.businessProfile`. Pricing memory as a pure function (`services/pricing-memory.ts`): pinned → last charged to this client → catalog default, with the source always shown in the UI. UI: `documents` tab in `/finance`, form/lines/payment/preview components, a layout-free print page, and three settings pages (business, companies, pricing). Print palette derived from the logo (`--doc-accent: #01AAC1`).
- **Outputs:** `docs/specs/sales-documents.md`, `reports/qa-sales-documents.md`, `reports/sales-documents.md`
- **Verification:** 463/463 Vitest (60 new), 10/10 new Playwright specs, web build green. Reviewer verdict APPROVED WITH NITS.
- **Gotcha worth remembering:** adding tables to the Drizzle schema made `drizzle-kit push` treat the bootstrap-only `google_connections` table as an orphan and prompt "is X a rename of google_connections?" — interactive, so `pnpm test` hung. Fixed with `tablesFilter: ['!google_connections']` in `packages/database/drizzle.config.ts`. Any future table added by raw bootstrap SQL rather than the schema will do the same thing.
- **Known limit:** credit invoices don't auto-post to VAT (`vat.create` rejects negative amounts) — the UI says so and the entry has to be added by hand.
- **Compliance:** N/A (apps/packages engineering, not ABC workspace).

---

## 2026-08-05 — sales-documents print polish

- **Active Agent:** UI Designer → Dev → QA
- **Workflow:** `docs/specs/sales-documents.md` — post-implementation visual refinement
- **Actions Taken:** Refined the printable document into a quieter Alpir-branded hierarchy: larger logo, compact issuer contact strip, grouped client/document metadata card, softly tinted table header, conditional discount column, prominent total card, receipt-specific “amount received” wording, structured bank-details block, and bilingual thank-you footer.
- **Outputs:** `apps/web/src/app/finance/components/DocumentPreview.tsx`, `apps/web/src/app/globals.css`, `packages/types/src/sales.ts`, UI/UX review appended to `reports/sales-documents.md`.
- **Verification:** 18/18 sales-type tests; 6/6 sales-document Playwright tests; web production build passed; no changed-file diagnostics.
- **Compliance:** N/A (apps/packages engineering, not ABC workspace).
