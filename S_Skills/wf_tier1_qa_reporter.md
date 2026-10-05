# Workflow: Tier 1 QA Reporter

> **Workflow ID:** `wf_tier1_qa_reporter`
> **Status:** Draft
> **Last Updated:** 2026-09-30
> **Orchestrator:** `01_Hugo_orchestrator`
> **Executing Agent:** `10_tier1_qa_reporter`
> **Agent instructions:** [`A_Agents/10_tier1_qa_reporter.md`](../A_Agents/10_tier1_qa_reporter.md)
> **Spec:** [`docs/specs/tier1-qa-whatsapp-agent.md`](../docs/specs/tier1-qa-whatsapp-agent.md)

---

## Purpose

Step-by-step execution map for the daily Tier 1 QA WhatsApp update. Unlike every other workflow in this folder, most of the steps below run as **deterministic code** in `packages/api/src/services/notion-tier1-qa.ts`, not as agent/tool calls — the LLM (`10_tier1_qa_reporter`) only executes the final "Narrate" stage.

---

## Logic Map Overview

```
[Trigger: daily cron slot, agent_schedules]
        │
        ▼
┌────────────────────────────────┐
│ STAGE 1: SCAN (code)           │
└────────────────────────────────┘
        │
        ▼
┌────────────────────────────────┐
│ STAGE 2: VALIDATE (code)       │──── incomplete? ──▶ fixed failure message, push/in-app only, STOP (no LLM, no WhatsApp)
└────────────────────────────────┘
        │ complete
        ▼
┌────────────────────────────────┐
│ STAGE 3: CLASSIFY & DIFF (code)│
└────────────────────────────────┘
        │
        ▼
┌────────────────────────────────┐
│ STAGE 4: NARRATE (LLM agent)   │
└────────────────────────────────┘
        │
        ▼
┌────────────────────────────────┐
│ STAGE 5: DELIVER & SNAPSHOT    │
│ (code)                        │
└────────────────────────────────┘
```

---

## Stage 1: Scan (code)

**Executor:** `runTier1QaScan()` in `notion-tier1-qa.ts`

### Step 1.1 — Load all test rows
- **Input:** Tests data source (`TIER1_TESTS_DATA_SOURCE_ID`), via the `DAZ` Notion account
- **Action:** Paginated query, no view filter, no row cap
- **Output:** Raw Notion pages

### Step 1.2 — Extract fields + page content + comments per test
- **Input:** Each test page
- **Action:** Extract Street / גוש / חלקה / סטטוס בדיקה / לינק לתוצאות הריצה / Engineering tasks / Tested by / Done / ID / page URL; fetch page body text and all comments (open + resolved, author + timestamp)
- **Output:** `Tier1TestRecord[]`

### Step 1.3 — Load every linked engineering task
- **Input:** Distinct `Engineering tasks` relation ids across all tests
- **Action:** Fetch each task page directly by id, including Archived/Deleted (a 404/purged page is recorded as `classification: 'deleted'`, not treated as a load failure); extract Task ID/name/Status/Priority/Assignee/QA/Reporter/Type/Due/Tests-for-Tier-1/URL, plus body text + comments
- **Output:** `Tier1BugRecord[]`

---

## Stage 2: Validate (code)

**Executor:** same function, checked before any classification runs

### Step 2.1 — Safety gate
- **Input:** Every fetch error collected during Stage 1 (`missingParts`)
- **Action:** If **any** test, task, page-content, or comment fetch failed, set `incomplete = true`. The caller (`agent-trigger-runner.ts`) must then skip the LLM entirely and post the fixed message `formatIncompleteMessage(missingParts)` — push/in-app only, `whatsapp: false` unconditionally, regardless of the notification-preference setting.
- **Output:** `incomplete: boolean`, `missingParts: string[]`

> This is the "כלל בטיחות קריטי" from the source spec: never send a partial update as if it were complete.

---

## Stage 3: Classify & Diff (code)

**Executor:** `computeStats`, `detectGaps`, `routeOwner`, `computeDiff` in `notion-tier1-qa.ts`

### Step 3.1 — Stats
- **Action:** Total tests; counts per סטטוס בדיקה; Done count; Tested-by count; result-link count; total linked bugs; bug counts by classification (open/released/cancelled/archived/deleted); active-bug × priority breakdown; open bugs missing Assignee/Due

### Step 3.2 — Classify each bug
- **Action:** Released → not open, regression needed if test not Done; Cancelled/Archived → not open; Deleted task → not active, flagged if still linked; everything else → open. Never infer test-complete from bug-released.

### Step 3.3 — Detect gaps
- **Action:** Waiting-for-fix with no active bug; Released bug with test not closed; test linked only to an inactive bug; אור-review-after-release; open bug missing Assignee/Due; unanswered question in comments; "דור ממתין לאור" comment; cancelled test still linked to an active task; missing גוש/חלקה/result-link where relevant
- **Ready for QA (added 2026-10-05):** an open bug with Status `Ready for QA` → `ready_for_qa` gap, owned by the ticket's **QA** people; if QA is empty, its **Reporter**; if both are empty, unassigned. Names are resolved here in code and carried as `people[]` + `peopleSource`. The same bug is also excluded from `open_bug_missing_assignee`/`open_bug_missing_due` (which route to דור) — once a bug is in QA, a missing Assignee/Due is no longer דור's problem to chase.
- **Output:** `Tier1QaGap[]`, each routed to an owner bucket (`routeOwner`) — לאור / לדור / לאלפיר-QA / לבעלים מהטיקט (named people from the ticket) / נדרש לקבוע בעלים

### Step 3.4 — Diff vs yesterday
- **Input:** Latest `tier1_qa_snapshots` row before today's Jerusalem date key
- **Action:** Compare test statuses and bug classifications; emit only real changes (status changed, bug opened, bug released), capped at 5. No prior snapshot → `diff: null`.

---

## Stage 4: Narrate (LLM agent)

**Agent:** `10_tier1_qa_reporter`

### Step 4.1 — Compose the WhatsApp message
- **Input:** `formatGroundingMessage(scan)` — the trimmed JSON payload (stats, tests incl. `linkedBugIds`, bugs incl. `linkedTestIds`, gaps, ownerActions, diff) as the agent's entire trigger message, **no chat history**
- **Action:** Render the compact dashboard template per the agent card (rewritten 2026-09-30 — a name-only "ממתינות לאור" list, bugs grouped by linked test/street, no links, ~150–300 words; see `A_Agents/10_tier1_qa_reporter.md` for the exact template) — verbatim numbers/classifications, no invention, no meta-commentary. A dedicated "ממתין ל-QA (לפי טיקט)" section (added 2026-10-05) is mandatory whenever any `ready_for_qa` gap exists — it's a standalone section, not a Next Steps bullet, specifically because a first live run showed the model silently drops a conditional numbered-list item under length pressure but not a whole section header.
- **Output:** Final Hebrew WhatsApp text

---

## Stage 5: Deliver & Snapshot (code)

**Executor:** `agent-trigger-runner.ts` + `notion-tier1-qa.ts`

### Step 5.1 — WhatsApp group delivery (gated), attempted first
- **Action:** `deliverTier1QaGroupUpdate(text, TIER1_QA_WHATSAPP_GROUP_JID)` — no-ops unless the `tier1_qa_daily_update` notification preference's WhatsApp channel has been switched on (off by default: draft/review rollout), and unless `TIER1_QA_WHATSAPP_GROUP_JID` is configured. Runs *before* Step 5.2 so its outcome can be reported.

### Step 5.2 — Push (always)
- **Action:** A short delivery-status line (e.g. "✅ נשלח בהצלחה לקבוצת ה-WhatsApp" or "⚠️ לא נשלח ל-WhatsApp: <reason>") is appended to the saved/displayed report text itself — not just the push payload — before `saveAgentMessage` and `pushAssistantMessage(..., { typeId: 'tier1_qa_daily_update', whatsapp: false })` run. This matters: OS push bodies are truncated to ~240 chars (`excerpt()` in push-notifications.ts), which would silently cut off any status line appended only to the push text for a 300-600 word report, and `/agents/manage`'s status line only renders `lastRunError` when the run is marked `'error'` — nothing extra shows on a bare `'ok'`. So the status line has to live in the report text itself to be reliably visible. The actual WhatsApp group message (Step 5.1) is still sent without this line — only the agent's own narration.
- **Run status:** if group delivery failed, `markAgentRan` is called with `status: 'error'` and the delivery-failure reason (not `'ok'`) — a computed-and-narrated-but-undelivered run is not a clean success for an agent whose whole job is that delivery, and `/agents/manage` should show "נכשל: <reason>", not a bare "הצליחה".

### Step 5.3 — Snapshot
- **Action:** `saveTier1QaSnapshot(db, scan)` — persists whenever the scan was complete, independent of whether WhatsApp delivery is enabled, so day-over-day diffing keeps working through the draft period

---

## Error Handling

| Error | Action |
|---|---|
| Any test/task/page-content/comment fetch fails | `incomplete = true`; fixed failure message, push/in-app only, no LLM call, no WhatsApp, no snapshot save |
| No Notion account/token configured (`DAZ`) | Same as above — treated as a load failure |
| LLM/Gemini engine unavailable | `runAgentTrigger` returns the generic "טריגרים אוטומטיים זמינים רק עם מנוע Gemini" error before Stage 4 runs; Stages 1–3 still complete but nothing is sent |
| `TIER1_QA_WHATSAPP_GROUP_JID` not set, or the group JID isn't in the bridge's `WHATSAPP_ALLOWED_GROUP_JIDS` allow-list | `deliverTier1QaGroupUpdate`/the bridge's `/send-group` route return an error; push/in-app still went out; log a warning, do not fail the whole run |
| No prior snapshot | Omit "מה השתנה מאתמול" — never fabricate a diff |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-09-30 | System | Initial version, per `docs/specs/tier1-qa-whatsapp-agent.md` |
