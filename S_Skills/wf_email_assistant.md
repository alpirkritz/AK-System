# Workflow: Email Assistant

> **Workflow ID:** `wf_email_assistant`
> **Status:** Active
> **Last Updated:** 2026-06-28
> **Orchestrator:** `01_Hugo_orchestrator`
> **Executing Agent:** `07_email_assistant`
> **Agent instructions:** [`A_Agents/07_email_assistant.md`](../A_Agents/07_email_assistant.md)

---

## Purpose

Daily inbox triage producing recommendations and optional draft replies only (confirmation-gated).

> **Hard rule:** No actions (send/archive/delete) without explicit confirmation.

---

## Logic Map Overview

```
[Trigger: Daily run]
        │
        ▼
LOAD INBOXES → ANALYZE → TRIAGE → RECOMMEND → NOTIFY → LEARN
```

---

## Stage 1: Load Inboxes

### Step 1.1 — Pull New Threads
- **Action:** Review new/unread threads across connected inboxes since the last run
- **Output:** Candidate threads

---

## Stage 2: Analyze

### Step 2.1 — Classify Each Thread
- **Action:** Determine sender (internal/external/automated), topic, and whether it needs reply / action / nothing. Use Notion, Slack, Calendar context (meeting today, project, known person).
- **Output:** Per-thread analysis

---

## Stage 3: Triage

### Step 3.1 — Categorize
- **Action:** 🔴 Needs attention / reply (important, time-sensitive, key people) · 🟡 FYI / optional · 🟢 Archive (newsletters, notifications, marketing, non-actionable)
- **Output:** Categorized threads

---

## Stage 4: Recommend

### Step 4.1 — Build Triage Table
- **Action:** Table: From · Subject · Summary · Recommended action (Reply / Archive / FYI). For Reply items, optionally draft a short editable reply.
- **Output:** Triage table + draft replies

### Step 4.2 — Summary
- **Action:** Lead with counts per category + the 1-3 most important items
- **Output:** Summary block

---

## Stage 5: Notify & Learn

### Step 5.1 — Notify
- **Action:** Send Notion Inbox notification when triage is ready
- **Output:** Notification sent

### Step 5.2 — Learn
- **Action:** Record feedback patterns (senders/types always archived, who always gets a reply) in `M_Memory/`; adjust future recommendations
- **Output:** Updated preferences

---

## Error Handling

| Error | Action |
|---|---|
| Inbox access error | Report blocker; do not fabricate threads |
| Uncertain category | Default to 🟡 FYI; flag for user |
| Reply needs sensitive info | Draft placeholder; ask user before sending |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Imported from AI Instructions doc (Email Assistant) |
