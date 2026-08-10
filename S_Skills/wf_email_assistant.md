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
- **Input:** `search_gmail` (query `is:unread newer_than:2d`; widen/narrow as needed)
- **Action:** Pull recent unread threads across all connected Google accounts. If the tool returns an auth/scope error, report it and stop — do not fabricate threads.
- **Output:** Candidate threads

---

## Stage 2: Analyze

### Step 2.1 — Classify Each Thread
- **Action:** Determine sender (internal/external/automated), topic, and whether it needs reply / action / nothing. Use context from the injected Google Calendar block + `get_today_schedule` (meeting today?) and `get_notion_meetings` / `get_notion_people` (project, known person). Slack is not connected.
- **Output:** Per-thread analysis

---

## Stage 3: Triage

### Step 3.1 — Categorize
- **Action:** 🔴 Needs attention / reply (important, time-sensitive, key people) · 🟡 FYI / optional · 🟢 Archive (newsletters, notifications, marketing, non-actionable)
- **Output:** Categorized threads

---

## Stage 4: Recommend

### Step 4.1 — Build Triage List (no tables — WhatsApp)
- **Action:** One line per thread, grouped 🔴/🟡/🟢: sender — subject — one-line summary — recommended action (Reply / Archive / FYI). For Reply items, optionally draft a short editable reply at the end. Hebrew.
- **Output:** Triage list + draft replies

### Step 4.2 — Summary
- **Action:** Lead with counts per category + the 1-3 most important items
- **Output:** Summary block

---

## Stage 5: Deliver & Learn

### Step 5.1 — Deliver
- **Action:** The chat reply itself is the triage report — it is sent automatically to WhatsApp / push / app. Do not send Notion notifications or stage files
- **Output:** Delivered triage

### Step 5.2 — Learn
- **Action:** Apply feedback patterns from injected Memory (senders/types always archived, who always gets a reply); when the user states a new preference, suggest saving it to Memory
- **Output:** Adjusted recommendations

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
