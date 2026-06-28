# Workflow: Meeting Prep

> **Workflow ID:** `wf_meeting_prep`
> **Status:** Active
> **Last Updated:** 2026-06-28
> **Orchestrator:** `01_Hugo_orchestrator`
> **Executing Agent:** `04_meeting_prep_herald`
> **Agent instructions:** [`A_Agents/04_meeting_prep_herald.md`](../A_Agents/04_meeting_prep_herald.md)

---

## Purpose

Step-by-step execution map for meeting preparation — daily briefing for today's meetings, or a focused on-demand briefing when the agent is tagged.

---

## Logic Map Overview

```
[Trigger: Morning OR Tagged on meeting/page]
        │
        ▼
┌──────────────────────────┐
│  STAGE 1: SCOPE          │
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  STAGE 2: GATHER         │
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  STAGE 3: PRIORITIZE     │
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  STAGE 4: BRIEF & LOG    │
└──────────────────────────┘
```

---

## Stage 1: Scope

**Agent:** `04_meeting_prep_herald`

### Step 1.1 — Determine Mode
- **Input:** Trigger (morning run or tag)
- **Action:** Morning → list today's meetings (skip declined/canceled). Tagged → focus on the given meeting/person/company/project.
- **Output:** Target meeting(s) / context

### Step 1.2 — Identify Participants & Entities
- **Input:** Meeting records (Meetings DT / Meetings Alpir Con), People, Companies, Projects
- **Action:** List participants (internal/external) and linked entities
- **Output:** Participant + entity map

---

## Stage 2: Gather

**Agent:** `04_meeting_prep_herald`

### Step 2.1 — Pull Open Action Items
- **Input:** DT - Action items, Con Action items
- **Action:** Prefer items not in Complete/Done; prefer items assigned to me; if meeting is about an entity, prioritize related tasks via relations
- **Output:** Relevant open action items

### Step 2.2 — Pull Recent Meeting Notes
- **Input:** AI Meeting Notes
- **Action:** Find what was discussed recently and what was decided / committed
- **Output:** Recent context per meeting

---

## Stage 3: Prioritize

**Agent:** `04_meeting_prep_herald`

### Step 3.1 — Flag Important Items
- **Input:** Open action items
- **Action:** Highlight overdue / past-due, high priority, and blocked items (and what blocks them)
- **Output:** Flagged item list

---

## Stage 4: Brief & Log

**Agent:** `04_meeting_prep_herald`

### Step 4.1 — Compose Briefing
- **Action:** For each meeting: 👥 Participants · 🚨 Important flags · 💭 Last time we met · 🎯 Today's focus. Keep short and skimmable; separate meetings with `---`.
- **Output format:** Top open items (why they matter) · What changed since last time · Next pushes (concrete) · Questions (to drive a decision)

### Step 4.2 — Stage & Log
- **Action:** Stage briefing in `O_Output/`; append run to `M_Memory/agents_daily_sync.md`

---

## Error Handling

| Error | Action |
|---|---|
| No meetings today | Report "no meetings today"; still surface top open items |
| Meeting notes missing | Note the gap; proceed with action items |
| Ambiguous tag | Ask for the specific meeting/entity |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Imported from AI Instructions doc (Meeting Prep Herald) |
