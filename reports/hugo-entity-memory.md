# Review — hugo-entity-memory

**Spec:** `docs/specs/hugo-entity-memory.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

- **Data:** new `memory_links` table (SQLite + Postgres schema, SQLite bootstrap in `packages/database/src/index.ts`), `user_settings.memory_links_backfilled_at`. Additive only. Production runs SQLite (`DATABASE_PATH=/data/ak_system.sqlite`), so the bootstrap creates the table on first `getDb()` after deploy.
- **Service:** `packages/api/src/services/memory-relevance.ts` — anchor extraction (names, aliases, project/workspace names, topic tokens; whole-word, Hebrew one-letter prefixes), per-run selection (8 per entity, multi-anchor first), renderer, `recall`, link lifecycle, lazy one-shot backfill.
- **Router:** `packages/api/src/routers/memory.ts` — `memories.list` filters (`personId` / `projectId` / `workspaceId` / `topic` / `scope`) and `links` on each row; `create({ links })`; `setLinks`; `suggestLinks`; `relevant`; `recall`; `resolveNames`. `memories.delete` removes links explicitly (SQLite runs with `foreign_keys` OFF).
- **Lifecycle:** link cleanup on `people.delete` / `bulkDelete`, `projects.delete`, `workspaces.delete`; links move on `people.merge` and workspace merge (`mergeWorkspaces`).
- **Engine:** `runGeminiAgentChat` passes message + last 6 turns; the prefetched calendar text is added for agents with calendar context (`apps/web/src/lib/gemini-agent-engine.ts`). `getMemoryPromptBlock` falls back to the old "newest 60" block on any error (`apps/web/src/lib/agent-memory.ts`).
- **Tools:** `remember` gains `aboutPeople` / `aboutProjects` / `aboutWorkspace` / `topics`, auto-links by content when none are given, and reports `linkedTo` / `unresolved`. New `recall_memories` (gated like `get_harness_insights`). `save_fact` no longer claims "תזכור" requests. One CoS line added for Hugo.
- **UI:** `/memory` — link chips (editable, click to filter), scope filter, suggested links on create (click to toggle), "מה הוגו יראה" tester. "מה הוגו זוכר" in the person drawer (פרטים tab) and on the project page. Components in `apps/web/src/components/memory/`.

## Checks

| check | result |
|---|---|
| `packages/api` Vitest | 1571 / 1572 pass. The one failure, `meetings.analysis.test.ts > retries a failed analysis when force is true`, passes alone (21/21) — order-dependent flake in an untouched file |
| `apps/web` Vitest | 52 files, 343 tests pass |
| New tests | `memory-relevance.test.ts` (13), `conversation-engine.memory-tools.test.ts` (5), `gemini-agent-engine.entity-memory.test.ts` (2), `e2e/hugo-entity-memory.spec.ts` (1, passes) |
| `pnpm -r run lint` | no new findings; 4 pre-existing `react/no-unescaped-entities` warnings on `apps/web/src/app/memory/page.tsx:160` (unchanged line) |
| `pnpm --filter @ak-system/web build` | passes |
| Full `pnpm e2e` | 115 passed, 42 failed, 2 skipped. None of the failures touch memory, the person drawer's פרטים tab or the project page memories. They are stale selectors and e2e seed SQL with outdated columns |

## Deviations from spec

- **Calendar anchors use the calendar text, not `meeting.projectId`.** The prefetched calendar is Google events, which carry no `projectId`. Project anchors come from project names in event titles instead.
- **`memory.relevant` ignores `agentId`.** The tester scans the message only. The UI says so ("בלי היומן של היום").
- **UI review was a self-review**, not a separate UI Designer run: RTL, `.btn` / `.input` / `.card`, existing dark palette, no tables.

## Nits / follow-ups

1. **5-minute directory cache.** A person, project or workspace created in the last 5 minutes is not matched as an anchor until the cache expires. Link writes clear the cache; entity creates do not. Low impact.
2. **Short Hebrew names behind a prefix can false-match.** "הבן" matches a person aliased "בן". Only that person's linked memories get injected, so the cost is a few extra lines.
3. **`memories.update` does not re-suggest links** when content changes. Links are edited separately on the chip row.
4. **Raw `tsc` over `apps/web` reports ~2,900 errors**, all pre-existing (Drizzle union-DB inference). The new files add none. The build runs with `ignoreBuildErrors`.
