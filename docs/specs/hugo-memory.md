# Hugo — Persistent Memory, Instructions & Knowledge

> **Slug:** `hugo-memory`
> **Status:** Draft
> **Last Updated:** 2026-07-02

## Goal

Give the user a persistent, deploy-safe way to steer Hugo (and the other agents): custom instructions the user types once and that are always injected, memories that Hugo can learn automatically ("תזכור ש..."), and long-form knowledge the user pastes in. Today agent cards live in `A_Agents/*.md` baked into the Docker image, so production edits are lost on redeploy, and there is no automatic injection of learned facts.

## User Stories

- As the user, I want to write standing instructions once and have Hugo always follow them.
- As the user, I want to tell Hugo "remember that ..." and have it recalled automatically next time.
- As the user, I want to paste knowledge (about people/projects) that Hugo can use.
- As the user, I want all of this to survive redeploys (stored in DB on the `/data` volume).

## Acceptance Criteria

- [ ] New DB tables `hugo_instructions` and `memories` on both SQLite and Postgres schemas (+ runtime `CREATE TABLE` in `getDb`).
- [ ] Active custom instructions + pinned/recent memories are injected into every Hugo run (and available to all agents), with a character cap.
- [ ] Hugo can call a `remember` tool to persist a memory (`source='chat'`), and an `update_instruction` tool to append/replace standing instructions.
- [ ] tRPC `memory` router: `instructions.get/set`, `memories.list/create/update/delete/togglePin`.
- [ ] A UI screen to manage instructions + memories/knowledge (RTL, design system).

## Data Model

`packages/database/src/schema.ts` + `schema.pg.ts` (parity) + `getDb()` CREATE TABLE:

- `hugo_instructions`: `id` (pk, single row `default`), `content` text, `enabled` boolean(int), `updatedAt` text.
- `memories`: `id` (pk), `content` text notNull, `kind` text (`instruction`|`memory`|`knowledge`) default `memory`, `source` text (`manual`|`auto`|`chat`) default `manual`, `pinned` boolean(int) default false, `createdAt` text, `updatedAt` text.

## tRPC API

New router `memory` (protectedProcedure), registered in `packages/api/src/index.ts`:

- `instructions.get()` → `{ content, enabled }`
- `instructions.set({ content, enabled })` → upsert row `default`
- `memories.list({ kind?, limit? })`
- `memories.create({ content, kind, source? })`
- `memories.update({ id, content?, kind?, pinned? })`
- `memories.delete({ id })`
- `memories.togglePin({ id, pinned })`

## Prompt injection

New `apps/web/src/lib/agent-memory.ts` → `getMemoryPromptBlock()` reads active instructions + pinned + recent memories (cap ~4000 chars) and returns a formatted Hebrew/English block. Injected in `buildSystemInstruction` (`gemini-agent-engine.ts`) after the agent card, before Notion context, for all agents.

## Tools

In `conversation-engine.ts`:

- `remember({ content, kind? })` → `memory.memories.create` with `source='chat'`.
- `update_instruction({ content, mode })` where `mode` = `append`|`replace` → updates `hugo_instructions`.
- Keep existing `save_fact`/`get_reports` (facts) unchanged for backward compat.

## UI Surface

New route `apps/web/src/app/memory/page.tsx` (linked from `DashboardLayout` and/or `/agents/manage`):

- Custom instructions editor (textarea, save = immediate).
- Memories/knowledge list: add (with kind selector), edit, delete, pin. Paste long content for `knowledge`.
- RTL Hebrew, `.btn`/`.input`/`.card`.

## Out of Scope

- Embeddings/RAG semantic search over large knowledge — compact injection + tool recall only for now.
- Per-agent (non-Hugo) separate memory scopes.

## Open Questions

- None blocking; default is always-inject with a size cap.
