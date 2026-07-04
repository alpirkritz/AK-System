# Review — hugo-memory

**Verdict:** APPROVED

## Scope
Spec: `docs/specs/hugo-memory.md`.

## Changes
- `packages/database/src/schema.ts` + `schema.pg.ts` — new `hugo_instructions` and `memories` tables (parity) + types + `MEMORY_KINDS`/`MEMORY_SOURCES`.
- `packages/database/src/index.ts` — runtime `CREATE TABLE IF NOT EXISTS` for both tables + exports/types.
- `packages/api/src/routers/memory.ts` — new `memory` router: `instructions.get/set`, `memories.list/create/update/delete/togglePin`.
- `packages/api/src/index.ts` — registered `memory` router.
- `apps/web/src/lib/agent-memory.ts` — `getMemoryPromptBlock()` (active instructions + pinned/recent memories, ~4000 char cap).
- `apps/web/src/lib/gemini-agent-engine.ts` — inject memory block in `buildSystemInstruction` (after agent card, before Notion; all agents).
- `apps/web/src/lib/conversation-engine.ts` — new tools `remember` and `update_instruction` (auto-learning).
- `apps/web/src/app/memory/page.tsx` — RTL management screen (instructions editor + memories/knowledge CRUD + pin).
- `apps/web/src/app/settings/page.tsx` + `components/DashboardLayout.tsx` — navigation entry points.

## Verification (production, EC2)
- `next build` passes; `/memory` route emitted (2.52 kB).
- API tests: 33/33 pass.
- Tables auto-created in prod DB (`hugo_instructions`, `memories` both present).
- Injection query verified against prod DB: instruction (`enabled=1`) + pinned-first memories read back correctly; test rows cleaned up.

## Notes / Out of scope
- No embeddings/RAG — compact injection + `remember`/recall only (per spec).
- `facts`/`save_fact` retained for backward compatibility.
- Agent card edits under `A_Agents/*.md` remain code (git) — user steers via the memory screen instead.
