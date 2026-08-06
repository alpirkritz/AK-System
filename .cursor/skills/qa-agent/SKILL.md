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

## Production config drift check

Whenever a change touches env-dependent server code (push, bank sync, auth,
cron secrets, etc.), confirm production settings didn't silently regress
before calling the change verified:

```bash
set -a; source deploy/production.env; set +a
bash scripts/validate-production-env.sh
```

- Must print `✓ Required production variables present` with **no** missing vars.
- If a new required env var was introduced (e.g. `FIREBASE_PROJECT_ID`), it must
  appear in `scripts/validate-production-env.sh`'s `require` list, `.env.example`,
  `apps/web/.env.local.example`, and `deploy/production.env.example` — diff those
  four files against the previous commit and confirm they moved together.
- For live integrations (push, external APIs), don't stop at "env var is set" —
  probe the credential against the real service once (e.g. mint an OAuth token,
  call a harmless endpoint) inside the actual deploy target. A present-but-wrong
  or present-but-using-the-wrong-SDK-API credential still reads as "configured".

## Build freshness check (deploy correctness)

This stack builds Next.js on the Mac and ships the compiled `.next` output —
`deploy/Dockerfile.runtime` never runs `next build` itself, it only asserts the
directory exists. That means a deploy can silently ship a **stale bundle** that
still contains pre-fix code even though the source on the server looks current.
This exact failure mode shipped once (2026-08-06, see `reports/direct-firebase-push.md`).

Before signing off on any change that will be deployed:

```bash
# BUILD_ID must be newer than the newest source file that could affect it
stat -f "%m %N" apps/web/.next/BUILD_ID
find apps/web/src packages/api/src packages/database/src -type f -newer apps/web/.next/BUILD_ID
```

- The `find` command must print **nothing**. Any output means the local build
  predates the source and a deploy right now would ship old code.
- Never verify "the fix is deployed" by grepping source files inside the
  container/server — that only proves the source synced, not that the running
  bundle was rebuilt from it. Grep the **compiled output**
  (`apps/web/.next/server/**` locally, or the equivalent path in the container)
  for something unique to the change instead.
- `SKIP_LOCAL_BUILD=1` and a bare `pnpm build` (without `AK_DEPLOY_BUILD=1`) both
  skip or misdirect the build — `apps/web/next.config.js` sends output to
  `os.tmpdir()` unless `AK_DEPLOY_BUILD=1` is set. Use `pnpm deploy:ec2` (or
  `SKIP_CI=1 pnpm deploy:ec2`, never `SKIP_LOCAL_BUILD=1`) so the script's own
  `AK_DEPLOY_BUILD=1 pnpm build` runs.

## Checklist Before Committing

- [ ] `pnpm test` passes at repo root
- [ ] New code paths are covered by at least one test
- [ ] No `.only` or `.skip` left in test files
- [ ] If server env vars changed: `scripts/validate-production-env.sh` passes and
      all four env-example/production files were updated together
- [ ] If this will be deployed: local `apps/web/.next/BUILD_ID` is newer than all
      relevant source, and the deployed bundle was grepped for something unique
      to the change — not just the source
