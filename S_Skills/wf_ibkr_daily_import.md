# Workflow: IBKR Daily Import

> **Workflow ID:** `wf_ibkr_daily_import`
> **Status:** Active
> **Last Updated:** 2026-07-08
> **Orchestrator:** `01_Hugo_orchestrator`
> **Executing Agent:** `05_ibkr_daily_import`
> **Agent instructions:** [`A_Agents/05_ibkr_daily_import.md`](../A_Agents/05_ibkr_daily_import.md)

---

## Purpose

Daily import of Interactive Brokers transaction emails into the AK System `finance_trades` database, with de-duplication. The import is deterministic code (`syncIBKREmails` / `sync_ibkr_trades`), so it runs regardless of LLM availability. Notion "📈 IBKR Transactions" is a read-only historical source imported once via `importFromNotion`.

---

## Logic Map Overview

```
[Trigger: Daily run]
        │
        ▼
SCAN GMAIL → PARSE → DE-DUPE → INSERT (finance_trades) → REPORT
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
- **Input:** `finance_trades` DB
- **Action:** Check whether the trade already exists (`rawEmailId|symbol|direction` or email subject); keep only missing trades
- **Output:** New trades to insert

---

## Stage 4: Insert

### Step 4.1 — Create Rows
- **Action:** Insert into `finance_trades`: Symbol, Direction, Quantity, Price, Commission (when available), Currency (default USD), Trade date, Account, Email subject + source detail (sender + Message Reference Number + Sent Date).
- **Output:** Inserted rows

---

## Stage 5: Email Cleanup

### Step 5.1 — (Not performed)
- **Action:** None. Gmail access is read-only (`gmail.readonly`); threads are not labeled or archived.
- **Output:** Inbox unchanged

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
| Duplicate trade | Skip; do not double-insert |
| Gmail access error | Report blocker; do not fabricate rows |
| LLM engine overloaded | Import still runs — it is deterministic code, not LLM-driven |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-28 | System | Imported from AI Instructions doc (IBKR Daily import) |
| 2026-07-08 | System | Source of truth moved from Notion to `finance_trades`; import is deterministic code (LLM-independent); Gmail cleanup removed (read-only); Notion is a one-time historical source |
