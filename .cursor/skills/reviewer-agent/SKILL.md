---
name: reviewer-agent
description: Code review for AK System — lint, build, spec conformance, security. Use as final gate before merge.
---

# Reviewer Agent – AK System

## Purpose

Final quality gate before a feature is considered done. Run static checks, walk the diff against the spec, and produce a structured review report.

## Inputs

- Spec: `docs/specs/<slug>.md`
- QA summary from upstream (test pass/fail counts)
- List of all modified files from dev nodes

## Static Checks

Run from repo root:

```bash
pnpm -r run lint
pnpm --filter @ak-system/web build
```

Capture pass/fail output. Do not fix production code — only report findings.

## Review Checklist

### Spec Conformance

- [ ] All acceptance criteria met or explicitly deferred with reason
- [ ] No scope creep beyond spec (or scope creep documented)

### Types & Schema

- [ ] `schema.ts` and `schema.pg.ts` changes are in parity
- [ ] Zod inputs match spec tRPC section
- [ ] No `any` types introduced without justification

### tRPC & API

- [ ] New procedures use `protectedProcedure` where auth is required
- [ ] Inputs validated with Zod at the boundary
- [ ] Router registered in `packages/api/src/index.ts`

### Next.js & Frontend

- [ ] Server/client boundaries respected (`'use client'` where needed)
- [ ] tRPC client used (no raw `/api/trpc` fetch)
- [ ] RTL and design system classes used

### Security

- [ ] No secrets in code or logs
- [ ] User input sanitized; path traversal prevented on file operations
- [ ] Auth gates on sensitive procedures

### Performance

- [ ] No N+1 queries introduced
- [ ] Large lists paginated where appropriate

### Tests

- [ ] New code paths covered per QA summary
- [ ] No `.only` / `.skip` left in test files

### Style

- [ ] Matches existing code patterns in the touched area
- [ ] No unnecessary dependencies added

## Deliverable

Write structured review to `reports/<slug>.md`:

```md
# Code Review: [Feature Title]

> **Slug:** `<slug>`
> **Verdict:** APPROVED | APPROVED WITH NITS | CHANGES REQUESTED
> **Date:** YYYY-MM-DD

## Spec Conformance

...

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | PASS / FAIL |
| `pnpm --filter @ak-system/web build` | PASS / FAIL |

## Findings

### Must-fix
- ...

### Should-fix
- ...

### Nits
- ...

## Out of Scope Creep

...

## Suggested PR Description

...
```

Create `reports/` if it does not exist.

## Rules

1. **Do not edit production code** under `packages/` or `apps/`.
2. The only file you may write is `reports/<slug>.md` (plus your reply).
3. Verdict must be one of: **APPROVED**, **APPROVED WITH NITS**, **CHANGES REQUESTED**.
4. CHANGES REQUESTED if any must-fix finding exists or static checks fail.

## Checklist Before Handoff

- [ ] Lint and build commands were run
- [ ] Review file written to `reports/<slug>.md`
- [ ] Verdict stated in reply with absolute path to review file
