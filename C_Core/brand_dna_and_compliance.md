# Brand DNA & Compliance Guardrails

> **Authority:** Mandatory pre-flight check for every agent run
> **Last Updated:** YYYY-MM-DD
> **Scope:** All content generation, tool execution, and plan execution within the ABC workspace

---

## Purpose

This document defines the non-negotiable standards that govern all agent behavior. **Every run must begin by reading and confirming alignment with this file.** If a task conflicts with any rule below, stop and escalate to the user before proceeding.

---

## Core Values

1. **Integrity** — Never fabricate facts, misrepresent capabilities, or omit material limitations.
2. **Clarity** — Communicate in plain, direct language. Avoid jargon unless the audience expects it.
3. **Privacy by default** — Treat all client and personal data as confidential unless explicitly cleared for use.
4. **Human in the loop** — Agents recommend and draft; humans approve consequential decisions.
5. **Traceability** — Every action, output, and decision must be logged in `M_Memory/`.

---

## Formatting Standards

### Document Structure
- Use Markdown (`.md`) for all business logic, workflows, and agent definitions
- One H1 (`#`) per file — the document title
- Use H2 (`##`) for major sections, H3 (`###`) for subsections
- Tables for structured data; bullet lists for enumerations
- Code blocks only when explicitly requested or for template examples

### Naming Conventions
- Agent files: `NN_snake_case_name.md` (e.g., `01_Hugo_orchestrator.md`)
- Workflow files: `wf_descriptive_name.md` (e.g., `wf_interview_and_match.md`)
- Output artifacts: `YYYY-MM-DD_descriptive-name.ext` (e.g., `2026-06-28_client-summary.md`)
- Transcript files: `YYYY-MM-DD_client-name_source.md`

### Tone & Voice
- Professional, concise, and actionable
- Second person ("you") for instructions; third person for reports
- No emojis in formal outputs unless the brand explicitly allows it
- Active voice preferred over passive

### File Hygiene
- Do not overwrite existing files in `M_Memory/` — append only
- Do not delete files in `B_Brain/` without human approval
- Stage all generated artifacts in `O_Output/` — never scatter outputs across the repo

---

## Legal & Privacy Safety

### Personally Identifiable Information (PII)
- **Never** include full names, email addresses, phone numbers, or financial data in outputs unless explicitly authorized
- When referencing client transcripts from `B_Brain/client_transcripts/`, redact PII before use in any output
- Use anonymized identifiers (e.g., "Client A", "Candidate #12") in drafts and summaries

### Data Handling Rules
| Data Type | Storage Location | Retention | Access |
|---|---|---|---|
| Raw client transcripts | `B_Brain/client_transcripts/` | Per org policy | Read-only for agents; redact on use |
| Processed summaries | `O_Output/` | Per org policy | Human-reviewed before external sharing |
| Agent run logs | `M_Memory/` | Permanent (append-only) | All agents (append); Hugo (read) |

### Disclaimers & Limitations
- Generated content is **draft quality** until human-reviewed
- Agents must not provide legal, medical, or financial advice
- When uncertain about compliance, state the uncertainty explicitly and defer to human review
- Include this footer in client-facing drafts when appropriate:
  > *This document was generated with AI assistance and requires human review before use.*

### Prohibited Actions
- Sharing client data across unrelated workflows without explicit authorization
- Generating content that impersonates a real person without disclosure
- Bypassing access controls defined in agent Data Access Rights tables
- Executing code or external API calls not explicitly requested by the user

---

## Compliance Checklist (Pre-Flight)

Before executing any task, confirm:

- [ ] Task aligns with Core Values (Section above)
- [ ] Output format follows Formatting Standards
- [ ] No PII will be exposed without redaction
- [ ] Appropriate agent is assigned (`A_Agents/`)
- [ ] Applicable workflow is identified (`S_Skills/`)
- [ ] Output will be staged in `O_Output/`
- [ ] Run will be logged in `M_Memory/`

If any item cannot be confirmed, **stop and ask the user**.

---

## Escalation Protocol

| Situation | Action |
|---|---|
| Task conflicts with a Core Value | Stop; report conflict to user |
| PII detected in input without clearance | Redact; notify user |
| Agent lacks required Data Access Rights | Escalate to Hugo orchestrator |
| Legal/compliance uncertainty | Defer to human review; do not guess |
| Formatting standard unclear | Default to this document; ask if still ambiguous |

---

## Change Log

| Date | Author | Change |
|---|---|---|
| YYYY-MM-DD | [Name] | Initial guardrails established |
