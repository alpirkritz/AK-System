# Workflow: Calendar Optimizer

> **Workflow ID:** `wf_calendar_optimizer`
> **Status:** Active
> **Last Updated:** 2026-06-28
> **Orchestrator:** `01_Hugo_orchestrator`
> **Executing Agent:** `06_calendar_optimizer`
> **Agent instructions:** [`A_Agents/06_calendar_optimizer.md`](../A_Agents/06_calendar_optimizer.md)

---

## Purpose

Daily calendar analysis producing recommendations only (approval-gated) for conflicts, overload, and focus time.

> **Critical rule:** Never take any action without explicit user approval.

---

## Logic Map Overview

```
[Trigger: Daily run]
        │
        ▼
CATEGORIZE → DETECT (conflicts/overload) → PRIORITIZE → RECOMMEND → NOTIFY (approval)
```

---

## Stage 1: Categorize

### Step 1.1 — Classify Events
- **Action:** Work = Dragontail/yum.com + Daz (daz.guru). Personal/Family = Family/Home calendars unrelated to work. Private (alpirkritz@gmail.com) busy events (isTransparent: false) = treat as potential conflicts with work meetings.
- **Output:** Categorized calendar

---

## Stage 2: Detect

### Step 2.1 — Double Bookings
- **Action:** Find overlaps. Real conflicts = meetings with participants. Events with no participants (focus blocks, DNS, reminders) = flag for awareness, not actionable.
- **Output:** Conflict list + awareness overlaps

### Step 2.2 — Overloaded Days
- **Action:** Flag any day with more than 4 hours of meetings
- **Output:** Load assessment

### Step 2.3 — Recent Meeting History
- **Action:** Look back 3-4 days for recent meetings with conflicting participants (affects priority)
- **Output:** Recency context

---

## Stage 3: Prioritize

### Step 3.1 — Rank Conflicts
- **Action:** Evaluate in order: external vs internal → recent meeting context (ask to confirm) → meeting type/topic → attendees & my role → context from email/calendar/Slack/Notion. Apply preferences: 1:1s lower than group; specific-topic group meetings critical; ignore DNS/focus blocks for rescheduling.
- **Output:** Keep/move decision per conflict

### Step 3.2 — Find Alternatives
- **Action:** For each meeting recommended to move, search all attendees' calendars for 2-3 specific alternative slots that work for everyone
- **Output:** Reschedule options

---

## Stage 4: Recommend & Notify

### Step 4.1 — Compose Recommendation
- **Action:** Summary first (3-5 bullets): 🚨 Conflicts (all, with keep/move), ⚠️ Overlaps (all, even non-actionable), 📊 Load, ⏰ Top task → slot. Then details (Conflicts, Load if >4h, Focus time).

### Step 4.2 — Notify & Save (approval-gated)
- **Action:** Send Notion Inbox notification after the daily run and whenever approval is needed. Save results as a page under the database. Append run to `M_Memory/`.
- **Hard rule:** Take no scheduling action without explicit approval.

---

## Error Handling

| Error | Action |
|---|---|
| Calendar access error | Report blocker; do not fabricate events |
| Ambiguous priority | Ask user to confirm before recommending move |
| No conflicts/overload | Still notify with summary (load + focus time) |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Imported from AI Instructions doc (Calendar Optimizer) |
