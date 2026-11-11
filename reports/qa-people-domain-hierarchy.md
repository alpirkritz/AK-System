# QA — people-domain-hierarchy

**Date:** 2026-10-20
**Spec:** `docs/specs/people-domain-hierarchy.md`

## New tests

| Suite | File | Result |
|---|---|---|
| Vitest — affiliations, workspace kind, Harness, Google profile fill (19 cases) | `packages/api/src/routers/people-domain-hierarchy.test.ts` | ✅ 19/19 |
| Playwright — drawer link flow + workspace filter, profile-fill dialog, folded-phone layout (390px) | `apps/web/e2e/people-domain-hierarchy.spec.ts` | ✅ 3/3 |

Coverage: multi-workspace links, upsert per pair, reports-to + name resolution, validation (self-report, blank relationship, unknown workspace), unlink, `listByWorkspace`, `listPaginated.workspaceId` + per-row affiliations, merge repoint (kept person wins on conflict, reports-to repointed), delete cleanup, workspace delete cleanup, default kind seed, create/update kind + description, invalid kind rejected, `describeAffiliations`, Harness person node summary + attrs, profile matcher (link-first, unique email, shared email ignored, filled fields skipped), apply re-check (never overwrites, only selected).

## Full suites

| Command | Result | Notes |
|---|---|---|
| `pnpm --filter @ak-system/api test` | 1352/1357 | 5 failures all in `voice-chunked-transcription.test.ts` (`Cannot redefine property: readFileSync`) — uncommitted voice work from another task, unrelated. `notion-task-writeback` failed once in one full run and passed in the next full run and in isolation (flaky). |
| `pnpm --filter @ak-system/web test` | 294/294 tests; 1 file fails to load | `whatsapp-bot.test.ts` — `HarmCategory` missing from the `@google/generative-ai` mock, introduced by uncommitted `services/voice.ts` changes. Unrelated. |
| `pnpm e2e` | see reviewer report | Pre-existing failures observed in `task-assignee`, `ui-refresh`, `slack-settings`, trading journal — none touch `/people` or workspaces. |

## Schema / production check

- `drizzle-kit push` on the test DB: **No changes detected** after the bootstrap-created table (format fix below).
- Production replica (schema-only copy of the EC2 SQLite + its 6 workspaces): `getDb()` bootstrap adds `kind`/`description`, seeds the 4 default kinds, creates `person_workspaces` + 3 indexes. Detail in the spec's "Production rollout (EC2)" section.
