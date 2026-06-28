# Workflow: Interview & Match

> **Workflow ID:** `wf_interview_and_match`
> **Status:** Example template — customize for your process
> **Last Updated:** YYYY-MM-DD
> **Orchestrator:** `01_Hugo_orchestrator`

---

## Purpose

End-to-end workflow for ingesting a client or candidate interview, querying organizational knowledge for context, and staging a match recommendation or summary in `O_Output/`.

---

## Prerequisites

- [ ] `C_Core/brand_dna_and_compliance.md` reviewed and aligned
- [ ] Raw transcript available (or ready to be placed in `B_Brain/client_transcripts/`)
- [ ] `B_Brain/organization_knowledge.md` is current

---

## Logic Map Overview

```
[Input: Transcript]
        │
        ▼
┌─────────────────────┐
│  STAGE 1: INGESTION │
└─────────────────────┘
        │
        ▼
┌─────────────────────────┐
│  STAGE 2: DB LOOKUP     │
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│  STAGE 3: OUTPUT STAGE  │
└─────────────────────────┘
        │
        ▼
[Output: O_Output/ artifact + M_Memory/ log]
```

---

## Stage 1: Ingestion

**Agent:** `01_Hugo_orchestrator` (delegates ingestion parsing)
**Objective:** Accept and normalize the interview input into a structured, agent-readable format.

### Step 1.1 — Receive Input
- **Input:** Raw transcript file, pasted text, or audio-to-text output
- **Action:** Confirm source format and completeness
- **Output:** Acknowledged intake record

### Step 1.2 — Store Raw Transcript
- **Input:** Raw transcript content
- **Action:** Save to `B_Brain/client_transcripts/YYYY-MM-DD_client-name_source.md`
- **Output:** Stored transcript file path
- **Compliance:** Redact any third-party PII not relevant to the workflow

### Step 1.3 — Extract Key Entities
- **Input:** Stored transcript
- **Action:** Identify and list:
  - Participant roles (interviewer, interviewee)
  - Key topics discussed
  - Stated requirements, preferences, or constraints
  - Action items or follow-ups mentioned
- **Output:** Structured entity summary (inline or temp note for Stage 2)

### Step 1.4 — Validate Ingestion
- **Input:** Entity summary
- **Action:** Confirm all required fields are populated; flag gaps
- **Output:** Ingestion complete signal → proceed to Stage 2
- **On failure:** Log gap in `M_Memory/`; request missing info from user

---

## Stage 2: Database Lookup

**Agent:** `[TBD] Research Analyst` (delegated by Hugo)
**Objective:** Cross-reference extracted entities against organizational knowledge to build context for matching.

### Step 2.1 — Load Organization Context
- **Input:** `B_Brain/organization_knowledge.md`
- **Action:** Read offerings, team structure, glossary, and key constraints
- **Output:** Org context snapshot (referenced, not duplicated)

### Step 2.2 — Query Relevant Knowledge
- **Input:** Entity summary from Step 1.3 + org context
- **Action:** Match interview requirements against:
  - Available offerings (Core Offerings section)
  - Team capabilities (Team Structure section)
  - Known constraints (Key Facts section)
  - Prior transcripts if relevant (read-only, redacted)
- **Output:** Match candidates list with relevance notes

### Step 2.3 — Score & Rank Matches
- **Input:** Match candidates list
- **Action:** Apply ranking criteria:
  1. Requirement fit (high / medium / low)
  2. Availability / capacity
  3. Prior relationship or history
  4. Compliance or constraint conflicts
- **Output:** Ranked match table

### Step 2.4 — Validate Lookup
- **Input:** Ranked match table
- **Action:** Confirm no compliance conflicts (`C_Core/` check); flag uncertainties
- **Output:** Validated match recommendation → proceed to Stage 3
- **On failure:** Log conflict in `M_Memory/`; escalate to user

---

## Stage 3: Output Staging

**Agent:** `[TBD] Content Specialist` (delegated by Hugo)
**Objective:** Produce a human-reviewable artifact and log the run.

### Step 3.1 — Draft Match Summary
- **Input:** Validated match recommendation from Step 2.4
- **Action:** Generate a structured summary including:
  - Interview overview (redacted)
  - Key requirements identified
  - Recommended match(es) with rationale
  - Open questions or follow-ups
  - Compliance disclaimer (per `C_Core/`)
- **Output:** Draft markdown document

### Step 3.2 — Stage Artifact
- **Input:** Draft summary
- **Action:** Save to `O_Output/YYYY-MM-DD_interview-match_client-name.md`
- **Output:** Staged artifact file path

### Step 3.3 — Human Review Flag
- **Input:** Staged artifact
- **Action:** Mark artifact status as `DRAFT — REQUIRES HUMAN REVIEW`
- **Output:** Review flag appended to artifact header

### Step 3.4 — Log Run to Memory
- **Input:** Full run metadata (agent, steps executed, outputs, duration)
- **Action:** Append entry to `M_Memory/agents_daily_sync.md`
- **Output:** Memory log entry confirmed

---

## Workflow Outputs

| Artifact | Location | Format |
|---|---|---|
| Raw transcript | `B_Brain/client_transcripts/` | `.md` |
| Match summary (draft) | `O_Output/` | `.md` |
| Run log | `M_Memory/agents_daily_sync.md` | Append entry |

---

## Error Handling

| Error | Stage | Action |
|---|---|---|
| Missing transcript | 1.1 | Request input from user; halt |
| PII detected without clearance | 1.2 | Redact; notify user |
| No matching offering found | 2.2 | Log gap; suggest manual review |
| Compliance conflict | 2.4 | Halt; escalate to user |
| Output staging failure | 3.2 | Retry once; log error in `M_Memory/` |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| YYYY-MM-DD | [Name] | Initial workflow template created |
