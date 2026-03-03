---
name: qa-agent
description: Run and add tests for AK System (Next.js, tRPC, Drizzle). Use when the user asks for QA, tests, testing, test coverage, or to run or write tests on the system.
---

# QA Agent – AK System

## Purpose

Execute tests, add new tests, and fix failing tests for the AK System monorepo (Next.js 14, tRPC, SQLite/Drizzle).

## Stack

- **Unit/Integration:** Vitest (packages/api, packages/database)
- **E2E:** Playwright in apps/web (e2e/*.spec.ts); uses DB at apps/web/data/e2e.sqlite
- **DB in tests:** SQLite; unit tests use test-data, E2E uses e2e.sqlite via `DATABASE_PATH`

## How to Run Tests

From repo root:

```bash
pnpm test           # unit/integration (API)
pnpm test:api       # API tests only
pnpm test:watch     # API watch mode
pnpm e2e            # E2E (Playwright; starts app on port 3001, uses e2e DB)
```

From apps/web:

```bash
pnpm test:e2e       # E2E only (run pretest:e2e first if DB missing)
pnpm test:e2e:ui    # E2E with UI
```

## Test Layout

- `packages/api/src/**/*.test.ts` – tRPC router tests
- `apps/web/e2e/*.spec.ts` – E2E flows (full-flow.spec.ts covers people, projects, meetings, tasks, dashboard)

## Adding Tests

1. **tRPC procedures:** Use the test helper that creates a caller with in-memory DB (see existing `*.test.ts`). Test `list`, `getById`, `create`, `update`, `delete` with valid and invalid input; check Zod validation and DB state.
2. **Conventions:**
   - One `*.test.ts` next to the module or in `__tests__` beside the router.
   - Use `describe` for router name, `it` for each procedure or scenario.
   - Create fresh context/caller per test or reset DB so tests don’t depend on order.
3. **DB:** Prefer in-memory SQLite (`DATABASE_PATH=:memory:` or test helper) so CI and local runs don’t need a real file. Push schema in test setup (see `packages/api/src/test-utils.ts`).

## When Tests Fail

1. Run the failing test in isolation: `pnpm test -- --run path/to/file.test.ts`
2. Read the error: assertion failure, validation (Zod), or DB/context setup.
3. Fix the test (expected value, setup) or the implementation (router/DB/schema).
4. Re-run the full suite: `pnpm test`

## Checklist Before Committing

- [ ] `pnpm test` passes at repo root
- [ ] New code paths are covered by at least one test
- [ ] No `.only` or `.skip` left in test files
