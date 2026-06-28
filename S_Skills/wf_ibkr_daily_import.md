# Workflow: IBKR Daily Import

> **Workflow ID:** `wf_ibkr_daily_import`
> **Status:** Active
> **Last Updated:** 2026-06-28
> **Orchestrator:** `01_Hugo_orchestrator`
> **Executing Agent:** `05_ibkr_daily_import`
> **Agent instructions:** [`A_Agents/05_ibkr_daily_import.md`](../A_Agents/05_ibkr_daily_import.md)

---

## Purpose

Daily import of Interactive Brokers transaction emails into the 📈 IBKR Transactions Notion database, with de-duplication and email cleanup.

---

## Logic Map Overview

```
[Trigger: Daily run]
        │
        ▼
SCAN GMAIL → PARSE → DE-DUPE → INSERT → LABEL/ARCHIVE → REPORT
```

---

## Stage 1: Scan Gmail

### Step 1.1 — Search Transaction Emails
- **Input:** Gmail (last 2–7 day window)
- **Action:** Find trade-confirmation subjects (BOUGHT, SOLD, Dividend, Interest, Transfer, Assignment, Exercise)
- **Output:** Candidate messages

---

## Stage 2: Parse

### Step 2.1 — Extract Fields
- **Input:** Each candidate email
- **Action:** From subject: Action, Symbol, Quantity, Price, Account (if present). From body/snippet: Message Reference Number, Sent Date → convert to YYYY-MM-DD.
- **Output:** Parsed transaction record

### Step 2.2 — Validate
- **Action:** If key fields can't be reliably parsed, skip and note what's missing. If clearly not a transaction (newsletter/marketing), discard.
- **Output:** Valid transaction records

---

## Stage 3: De-dupe

### Step 3.1 — Check Existing
- **Input:** 📈 IBKR Transactions DB
- **Action:** Check if exact Subject already exists; keep only missing transactions
- **Output:** New transactions to insert

---

## Stage 4: Insert

### Step 4.1 — Create Rows
- **Action:** Insert into 📈 IBKR Transactions: Subject (title), Date, Action, Symbol, Quantity, Price, Currency (default USD), Account, Source (sender + Message Reference Number + Sent Date). Leave Fees/Gross/Net empty unless clearly available.
- **Output:** Inserted rows

---

## Stage 5: Email Cleanup

### Step 5.1 — Label & Archive
- **Action:** For processed threads: apply labels `Interactive Brokers` and `archived by Notion agent`; archive (remove from Inbox)
- **Output:** Cleaned inbox

---

## Stage 6: Report

### Step 6.1 — Summarize Run
- **Action:** If imported: report count + list subjects. If none: "No new transactions found." Append to `M_Memory/`.

---

## Error Handling

| Error | Action |
|---|---|
| Unparseable fields | Skip insert; report missing fields |
| Non-transaction email | Discard; do not insert |
| Duplicate subject | Skip; do not double-insert |
| Gmail/Notion access error | Report blocker; do not fabricate rows |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Imported from AI Instructions doc (IBKR Daily import) |
