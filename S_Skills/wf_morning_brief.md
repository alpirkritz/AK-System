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

- [ ] Notion AK-System integration has access to task databases and calendar pages
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
│  STAGE 4: STAGE AND LOG      │
└──────────────────────────────┘
        │
        ▼
[Output: O_Output/ artifact + M_Memory/ log]
```

---

## Stage 1: Gather Context

**Agent:** `03_morning_briefing`
**Objective:** Collect all inputs needed to build today's brief.

### Step 1.1 — Confirm Date
- **Input:** System date or user-provided date
- **Action:** Set briefing date (YYYY-MM-DD)
- **Output:** Confirmed date

### Step 1.2 — Discover Notion Databases
- **Input:** Notion API (`NOTION_API_KEY`)
- **Action:** Search all shared databases and calendar-linked pages in workspace
- **Output:** List of database IDs and titles to query

### Step 1.3 — Load Today's Calendar
- **Input:** Notion calendar views / event databases for today
- **Action:** List events with time, title, location, attendees (redact PII in output)
- **Output:** Schedule summary

### Step 1.4 — Scan All Tasks Related to User
- **Input:** Task databases (explicit): DT - Action items, Con Action items, Personal to-do list, DAZ workspace (tasks assigned to @Alpir Kritzler)
- **Action:** Query open items (tasks from task DBs, not checklist blocks). Exclude Status = Done. Also pull recent meeting action items by searching meeting notes pages (Notion search + open pages; do not rely on DB filter queries).
- **Output:** Consolidated task list across all task databases

### Step 1.5 — Triage and Prioritize
- **Input:** Schedule summary + consolidated task list
- **Action:** Classify each item:
  - **Urgent** — overdue, due today, or urgent/high priority
  - **Today** — scheduled or due today
  - **Soon** — due within 3 days
  - Flag top 1–3 focus areas for the day
- **Output:** Prioritized list → proceed to Stage 2

### Step 1.6 — Fallback (if Notion unavailable)
- **Input:** Empty Notion results or API error
- **Action:** Log blocker in brief; do not fabricate tasks. Note which databases need sharing with AK-System integration
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
- **Action:** Search through Notion, Calendar, Mail, and Slack:
  - Notion (shared databases and calendars; task DBs per Step 1.4)
  - `B_Brain/organization_knowledge.md`
  - Staged notes in `O_Output/`
  - User-provided context
- **Output:** Research notes

### Step 2.3 — Apply Compliance
- **Input:** Research notes
- **Action:** Redact PII per `C_Core/`; flag uncertainties; do not fabricate
- **Output:** Validated research notes → proceed to Stage 3

**Research guidelines (from agent Instructions → Actions):**

1. Only use approved sources listed above
2. Redact PII per `C_Core/brand_dna_and_compliance.md`
3. Limit depth to what today's brief requires
4. Flag gaps rather than inventing context
5. Mark output for human review

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

## Stage 4: Stage and Log

**Agent:** `03_morning_briefing`
**Objective:** Save the brief and log the run.

### Step 4.1 — Stage Artifact
- **Input:** Validated draft
- **Action:** Save to `O_Output/YYYY-MM-DD_morning-brief.md`
- **Output:** Staged artifact path

### Step 4.2 — Human Review Flag
- **Input:** Staged artifact
- **Action:** Ensure header includes `DRAFT — REQUIRES HUMAN REVIEW`
- **Output:** Review flag confirmed

### Step 4.3 — Log Run
- **Input:** Run metadata (agent, steps, outputs)
- **Action:** Append entry to `M_Memory/agents_daily_sync.md`
- **Output:** Memory log entry confirmed

---

## Output Template

```md
# ☀️ Morning Brief — Short Date

> TL;DR: <brief summary for the page TL;DR property>

## 🏆 Today's Priorities

- **<Priority 1>** — what needs to be done and why it matters. Link to task DB item. (no checkboxes)
- **<Priority 2>** — ...
- **<Priority 3>** — ...

## 👀 Things I Missed Yesterday

- <One or two important items only; skip if nothing important>
```

Notes on the output (per agent Instructions):
- Page is created in the database (not in Morning briefs hub), titled `Morning Brief – Short Date`.
- Use H2 headings; no checklist checkboxes — link tasks to their task DB item.
- Suggested non-task next steps use a `Next step:` bullet.
- Bold key actions/decisions; always cite sources; friendly tone.
- When finished, send a Notion notification with a link to the brief page.

---

## Workflow Outputs

| Artifact | Location | Format |
|---|---|---|
| Morning brief (draft) | `O_Output/` | `.md` |
| Run log | `M_Memory/agents_daily_sync.md` | Append entry |

---

## Error Handling

| Error | Stage | Action |
|---|---|---|
| No schedule or tasks available | 1.2 / 1.3 | Note empty state in brief; proceed |
| Missing org knowledge | 1.4 | Use user context only; flag gap |
| PII detected | 2.3 | Redact; notify in Open Questions |
| Research scope too broad | 2.1 | Narrow to today's meetings/tasks |
| Output staging failure | 4.1 | Retry once; log error in `M_Memory/` |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Initial workflow; implements agent Instructions Workflow section |
| 2026-06-28 | System | Clarified: agent card holds instructions, not Notion page mirror |
| 2026-06-28 | System | Aligned with verbatim Morning Brief instructions from AI Instructions doc (task DBs, output sections, style) |
