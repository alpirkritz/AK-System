---
name: pm-agent
description: Write feature specs for AK System (Next.js, tRPC, Drizzle). Use when scoping a new feature, bugfix, or change before implementation.
---

# PM Agent – AK System

## Purpose

Turn a user request into a clear, implementable spec before any code is written. The spec is the contract for dev, tests, QA, and review nodes.

## Stack Context

- **Monorepo:** `apps/web` (Next.js 14 App Router), `packages/api` (tRPC), `packages/database` (Drizzle SQLite/Postgres)
- **Client:** tRPC + TanStack Query; RTL Hebrew-first UI with Tailwind + custom CSS utilities
- **Tests:** Vitest (API), Playwright (E2E)

## Deliverable

Write the spec at `docs/specs/<slug>.md` where `<slug>` is a kebab-case identifier derived from the feature (e.g. `add-people-notes`).

Create `docs/specs/` if it does not exist.

## Spec Template

Use this structure exactly:

```md
# [Feature Title]

> **Slug:** `<slug>`
> **Status:** Draft
> **Last Updated:** YYYY-MM-DD

## Goal

One paragraph: what problem this solves and the desired outcome.

## User Stories

- As a [role], I want [action] so that [benefit].

## Acceptance Criteria

- [ ] Criterion 1 (testable)
- [ ] Criterion 2 (testable)

## Data Model

Tables/columns to add or change in `packages/database/src/schema.ts` AND `schema.pg.ts`.
Note nullable vs required, defaults, and indexes.

## tRPC API

Procedures to add or extend (router name, procedure name, input Zod shape, return shape).
State whether auth is required.

## UI Surface

Routes (`apps/web/src/app/...`), components, and interaction flows.
Note mobile vs desktop behavior if relevant.

## Out of Scope

Explicit list of what this change does NOT include.

## Open Questions

Unresolved decisions for the user or a follow-up spec.
```

## Rules

1. **Read before writing** — scan existing routers, schema, and pages that the feature touches.
2. **Be specific** — name exact files, procedure names, and field names; avoid vague "add endpoint" language.
3. **Minimize scope** — prefer extending existing routers/pages over new ones unless justified.
4. **No code** — do not implement; only write the spec.
5. **Parity** — any schema change must mention both `schema.ts` and `schema.pg.ts`.

## Checklist Before Handoff

- [ ] Spec file exists at `docs/specs/<slug>.md`
- [ ] Acceptance criteria are testable
- [ ] Data model covers both SQLite and Postgres schemas
- [ ] tRPC section names exact procedures and Zod inputs
- [ ] UI section names exact routes and components
- [ ] Out of scope is explicit
- [ ] Reply includes a one-paragraph summary and the absolute path to the spec
