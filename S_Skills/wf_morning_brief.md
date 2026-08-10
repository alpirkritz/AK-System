# Workflow: Morning Brief

> **Workflow ID:** `wf_morning_brief`
> **Status:** Active
> **Last Updated:** 2026-06-28
> **Orchestrator:** `01_Hugo_orchestrator`
> **Executing Agent:** `03_morning_briefing`
> **Agent instructions:** [`A_Agents/03_morning_briefing.md`](../A_Agents/03_morning_briefing.md) — Overview, Workflow, Actions

---

## Purpose

Step-by-step execution map for the Morning Briefing agent. The agent's **Instructions** (what to do and why) live in the agent card; this file defines **how** each stage runs.

---

## Prerequisites

- [ ] Notion integrations for **all connected accounts** have access to the task and meeting databases (verify with `notion_status`)
- [ ] `C_Core/brand_dna_and_compliance.md` reviewed and aligned
- [ ] Today's date confirmed

---

## Logic Map Overview

```
[Trigger: Daily or On-Demand]
        │
        ▼
┌──────────────────────────┐
│  STAGE 1: GATHER CONTEXT │
└──────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  STAGE 2: RESEARCH GUIDELINES   │
└─────────────────────────────────┘
        │
        ▼
┌──────────────────────────────┐
│  STAGE 3: SYNTHESIZE BRIEF   │
└──────────────────────────────┘
        │
        ▼
┌──────────────────────────────┐
│  STAGE 4: DELIVER            │
└──────────────────────────────┘
        │
        ▼
[Output: the brief, written in full in the chat reply — delivered automatically to WhatsApp / push / app]
```

---

## Stage 1: Gather Context

**Agent:** `03_morning_briefing`
**Objective:** Collect all inputs needed to build today's brief.

### Step 1.1 — Confirm Date
- **Input:** System date or user-provided date
- **Action:** Set briefing date (YYYY-MM-DD)
- **Output:** Confirmed date

### Step 1.2 — Confirm Notion Access
- **Input:** Configured Notion accounts (`NOTION_ACCOUNTS`, or legacy `NOTION_API_KEY`)
- **Action:** Optionally run `notion_status` to confirm each account/database is reachable; note any database that must be shared with its integration
- **Output:** List of reachable task/meeting databases across all accounts

### Step 1.3 — Load Today's Meetings (all accounts)
- **Input:** `get_notion_meetings` (range `today`) across every connected Notion account
- **Action:** List meetings with time, title, attendees (redact PII in output)
- **Output:** Schedule summary (Notion meetings + Google/Apple calendar events)

### Step 1.4 — Scan All Tasks Related to User (all accounts)
- **Input:** `get_notion_tasks` across every connected account (Personal To-do, DT - Action items, Con Action items, DAZ meetings/tasks assigned to @Alpir Kritzler)
- **Action:** Query open items (exclude Status = Done). Use `search_notion` to pull recent meeting action items by keyword when needed.
- **Output:** Consolidated task list across all task databases and accounts

### Step 1.5 — Triage and Prioritize
- **Input:** Schedule summary + consolidated task list
- **Action:** Classify each item:
  - **Urgent** — overdue, due today, or urgent/high priority
  - **Today** — scheduled or due today
  - **Soon** — due within 3 days
  - Flag top 1–3 focus areas for the day
- **Output:** Prioritized list → proceed to Stage 2

### Step 1.6 — Fallback (if Notion unavailable)
- **Input:** Empty Notion results or API error (per-account/per-database)
- **Action:** Log blocker in brief; do not fabricate tasks. Run `notion_status` and note which account/database needs sharing with its integration. Continue with the accounts/databases that succeeded (partial failure never blanks the whole brief).
- **Output:** Partial context with explicit gap → proceed to Stage 2

---

## Stage 2: Research Guidelines

**Agent:** `03_morning_briefing`
**Objective:** Apply Research guidelines before synthesizing the brief.

### Step 2.1 — Scope Research
- **Input:** Priority list, today's meetings, open questions
- **Action:** Determine what additional context is needed (attendee roles, project links, prior notes)
- **Output:** Research scope (bounded — no open-ended browsing)

### Step 2.2 — Gather from Approved Sources
- **Input:** Research scope
- **Action:** Search through Notion, Calendar, and Mail (Slack is not connected):
  - Notion (shared databases and calendars; task DBs per Step 1.4)
  - Injected Google Calendar context
  - `search_gmail` when an email is likely relevant to today
  - User-provided context and injected Memory
- **Output:** Research notes

### Step 2.3 — Apply Compliance
- **Input:** Research notes
- **Action:** Redact PII per `C_Core/`; flag uncertainties; do not fabricate
- **Output:** Validated research notes → proceed to Stage 3

**Research guidelines (from agent Instructions → Actions):**

1. Only use approved sources listed above
2. Redact third-party PII
3. Limit depth to what today's brief requires
4. Flag gaps rather than inventing context (`לא נמצא בנתונים`)

---

## Stage 3: Synthesize Brief

**Agent:** `03_morning_briefing`
**Objective:** Draft a structured morning brief for human review.

### Step 3.1 — Assemble Sections
- **Input:** Schedule, tasks, priorities, research notes
- **Action:** Draft brief using output template (below)
- **Output:** Complete draft

### Step 3.2 — Quality Check
- **Input:** Draft brief
- **Action:** Verify all sections populated; compliance disclaimer present; no PII exposed
- **Output:** Validated draft → proceed to Stage 4

---

## Stage 4: Deliver

**Agent:** `03_morning_briefing`
**Objective:** Deliver the brief.

### Step 4.1 — Write the Full Brief in the Reply
- **Input:** Validated draft
- **Action:** Write the complete brief (Hebrew, template below) as the chat reply. The platform sends it to WhatsApp / push / app and archives it automatically — do not create pages, stage files, or send notifications yourself
- **Output:** Delivered brief

---

## Output Template

```
☀️ תדריך בוקר — <תאריך>
TL;DR: <שורה אחת>

🏆 העדיפויות של היום
• <עדיפות 1> — מה צריך לעשות ולמה זה חשוב (מקור: <DB>)
• <עדיפות 2> — ...
• <עדיפות 3> — ...

👀 דברים שפספסתי אתמול
• <רק פריט אחד או שניים חשובים; לדלג אם אין>
```

Notes on the output (per agent Instructions):
- Hebrew, phone-friendly: short bullets, no Markdown tables, no H2/H3 headers
- No checklist checkboxes — reference tasks by their task-DB name
- Suggested non-task next steps use a `Next step:` bullet
- Bold key actions/decisions; name sources briefly; friendly tone

---

## Workflow Outputs

| Artifact | Location | Format |
|---|---|---|
| Morning brief | The chat reply itself (auto-delivered to WhatsApp / push / app) | Short Hebrew text |

---

## Error Handling

| Error | Stage | Action |
|---|---|---|
| No schedule or tasks available | 1.2 / 1.3 | Note empty state in brief; proceed |
| Missing org knowledge | 1.4 | Use user context only; flag gap |
| PII detected | 2.3 | Redact; notify in Open Questions |
| Research scope too broad | 2.1 | Narrow to today's meetings/tasks |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Initial workflow; implements agent Instructions Workflow section |
| 2026-06-28 | System | Clarified: agent card holds instructions, not Notion page mirror |
| 2026-06-28 | System | Aligned with verbatim Morning Brief instructions from AI Instructions doc (task DBs, output sections, style) |
