# Workflow: Meeting Prep

> **Workflow ID:** `wf_meeting_prep`
> **Status:** Active
> **Last Updated:** 2026-07-19
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
- **Input:** Trigger (morning run or tag) + injected **Google Calendar context** (authoritative meeting list)
- **Action:** Morning → brief every meeting in today's calendar (skip declined/canceled). Tagged → focus on the given meeting/person/company/project.
- **Output:** Target meeting(s) / context

### Step 1.2 — Identify Participants & Entities
- **Input:** `get_notion_meetings` (meeting records), `get_notion_people`, `get_notion_companies`, `get_notion_projects`
- **Action:** List participants (internal/external) and linked entities **only from these tool results** — never infer a participant from the meeting title; use `search_notion` to resolve a name/topic
- **Output:** Participant + entity map (mark any missing item `לא נמצא בנתונים`)

---

## Stage 2: Gather

**Agent:** `04_meeting_prep_herald`

> Grounding: state facts only from tool results / injected context. `get_notion_tasks` and
> `get_notion_meeting_notes` are **mandatory every run**. Missing data → write
> `לא נמצא בנתונים`, never a plausible guess.

### Step 2.1 — Pull Open Action Items
- **Input:** `get_notion_tasks` (mandatory — Personal To-do, DT - Action items, Con Action items, DAZ Tasks)
- **Action:** Prefer items not in Complete/Done; prefer items assigned to me; **keep only tasks clearly related** to this meeting (person/company/project/topic/explicit link). Weak matches → drop. If the related set is empty → output `לא נמצאו משימות קשורות לפגישה זו` — **never** dump the full open backlog.
- **Output:** Related open action items only (or the empty-related marker)

### Step 2.2 — Pull Recent Meeting Notes
- **Input:** `get_notion_meeting_notes` (mandatory — for a day pass `prepDate`; for one person pass `query`; also `meetingId` / `notionUrl`; returns local `bodyText` from the **meeting page** AI notes block), `get_next_meeting_brief` for the next event's local notes
- **Action:** Find what was discussed recently and what was decided / committed — grounded in `bodyText` only. Do not invent from titles.
- **Output:** Recent context per meeting; if no note / empty body for a meeting, output `לא נמצא בנתונים`

---

## Stage 3: Prioritize

**Agent:** `04_meeting_prep_herald`

### Step 3.1 — Flag Important Items
- **Input:** Related open action items only (from Step 2.1)
- **Action:** Highlight overdue / past-due, high priority, and blocked items among the related set. If Step 2.1 returned empty → skip flags; keep the empty-related marker.
- **Output:** Flagged related item list (or empty)

---

## Stage 4: Brief & Log

**Agent:** `04_meeting_prep_herald`

### Step 4.1 — Compose Briefing
- **Action:** For each meeting: 👥 Participants · 🚨 Related open items (or `לא נמצאו משימות קשורות לפגישה זו`) · 💭 Last time we met · 🎯 Today's focus (only if grounded). Keep short and skimmable; separate meetings with `---`. No tables; no backlog dump.
- **Grounding:** Factual lines (participants, last-time-we-met, related flags) come only from tool
  results; if missing, write `לא נמצא בנתונים` / `לא נמצאו משימות קשורות לפגישה זו`. Interpretive lines (focus, next pushes,
  questions) must be grounded in a real **related** task/note and labeled `המלצה — לא מהנתונים`; omit
  the section if there is no factual basis. Never fabricate participants or past discussion.
- **Output format:** Related top open items · What changed since last time · Next pushes (concrete, labeled recommendation) · Questions (labeled recommendation)

### Step 4.2 — Stage & Log
- **Action:** Stage briefing in `O_Output/`; append run to `M_Memory/agents_daily_sync.md`

---

## Error Handling

| Error | Action |
|---|---|
| Calendar/Notion context shows a "data may be incomplete" warning or a tool returns `errors` | Say the data is partial and name the failing source; do NOT claim "no meetings today" |
| No meetings today (and no errors) | Report "no meetings today"; do **not** dump the full open-task list |
| Meeting notes missing | Write `לא נמצא בנתונים` for "last time we met"; proceed with **related** action items only — do NOT invent past discussion |
| No related open tasks for a meeting | Write `לא נמצאו משימות קשורות לפגישה זו`; do **not** list unrelated open tasks |
| No linked participant | Write `לא נמצא בנתונים`; do NOT infer participants from the meeting title |
| Ambiguous tag | Ask for the specific meeting/entity |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Imported from AI Instructions doc (Meeting Prep Herald) |
| 2026-07-16 | System | Added grounding rules: mandatory tasks/notes tools, `לא נמצא בנתונים` for missing data, labeled recommendations, no participant inference from title |
| 2026-07-19 | System | Related tasks only — never dump full open backlog when none match the meeting |
