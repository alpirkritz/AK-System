# Hugo — Memory tied to entities

> **Slug:** `hugo-entity-memory`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Builds on:** `hugo-memory.md`, `meeting-prep-topic-isolation.md`

## Goal

Link each Hugo memory to the people, projects, workspaces and topics it is about. Then inject the standing instructions and global memories, plus only the linked memories relevant to the current run, in place of today's "60 most recent memories, whatever they are about" block.

### Why

`getMemoryPromptBlock()` (`apps/web/src/lib/agent-memory.ts`) reads the 60 newest rows ordered by `pinned`, `updatedAt` and injects them into every run of every agent, up to 12,000 chars. Consequences today:

- A memory about Dan is injected into a VAT question, and is silently dropped from a prep for Dan's meeting once 60 newer memories exist.
- Nothing records who or what a memory is about. Hugo cannot answer "what do you remember about project X" except by scanning the flat list.
- The memory bank cannot grow past ~60 useful items without losing older ones.

## User stories

- As Alpir, when I tell Hugo "תזכור שדן מעדיף עדכונים בכתב", I want that memory linked to Dan, so it surfaces whenever Dan comes up and nowhere else.
- As Alpir, before a meeting with Dan about DD release, I want Hugo's prep to include every memory linked to Dan, to the DD topic and to the meeting's project, even if those memories are months old.
- As Alpir, I want general preferences ("תמיד תענה בקצרה") to keep applying to every run, as today.
- As Alpir, I want to see and edit a person's or project's memories where I look at that person or project, not only on `/memory`.
- As Alpir, I want to check exactly which memories Hugo would get for a given message, so I can tell why he did or did not know something.
- As Alpir, I want my existing memories linked automatically once, so I do not have to re-tag them by hand.

## Acceptance criteria

### Linking

- [ ] **Given** a memory with zero links, **then** it is *global*: eligible for every run, exactly as today.
- [ ] **Given** a memory with one or more links, **then** it is *scoped*: injected only when at least one linked entity is an anchor of the run (see Retrieval).
- [ ] A memory can link to many entities of mixed kinds (e.g. Dan + project "Algo 4" + topic `dd`).
- [ ] Link kinds: `person` (→ `people.id`), `project` (→ `projects.id`), `workspace` (→ `workspaces.id`), `topic` (a normalized token produced by `topicTokens()` in `packages/api/src/lib/topic-match.ts`).
- [ ] Deleting a person, project or workspace deletes its links. A memory left with no links becomes global, not deleted.
- [ ] Merging two people (`moveAliasesOnMerge` flow) moves memory links from the merged person to the surviving one, with no duplicate links.

### Writing — `remember` tool

- [ ] `remember` (`apps/web/src/lib/conversation-engine.ts`) gains optional args `aboutPeople: string[]`, `aboutProjects: string[]`, `aboutWorkspace: string`, `topics: string[]`. These are names, not IDs. The tool description tells Hugo to fill them whenever the memory is about someone or something specific.
- [ ] Names are resolved on the server: people through `resolvePerson` and `person_aliases`, projects and workspaces through a case-insensitive exact name match, topics through `topicTokens()`.
- [ ] If Hugo passes none of the `about*`/`topics` args, the server runs `suggestMemoryLinks(content)` (see Retrieval → anchor extraction) on the content and applies the matches. A memory that matches nothing stays global.
- [ ] The tool result returns `links: [{ kind, entityId, label }]` and `unresolved: string[]`. Hugo's confirmation names who or what it was linked to, e.g. "נשמר, מקושר לדן כהן ו-Algo 4". An unresolved name is reported and is **not** auto-created as a person or project.
- [ ] `save_fact`'s description no longer lists "תזכור" / "remember that" / "שמור ש" as triggers, so "remember" requests stop landing in the `facts` table, which is never injected. `save_fact` behaviour is otherwise unchanged.

### Retrieval — per run

- [ ] `runGeminiAgentChat` passes the run's `message` and the last 6 `history` turns into `buildSystemInstruction`. `buildAgentSystemInstruction` (the export used by tests) accepts the same input as an optional argument.
- [ ] **Anchor extraction** is deterministic, with no LLM. It runs over that text:
  - Person: whole-word match of `people.name` or any `person_aliases` alias (normalized with `normalizeAlias`), minimum 2 characters, Hebrew and Latin.
  - Project and workspace: whole-word match of the name, minimum 3 characters.
  - Topic: `topicTokens(text)` intersected with the topic tokens that exist in `memory_links`.
- [ ] For agents where `agentNeedsCalendarContext(agentId)` is true, the attendees, `projectId` and title-topic tokens of the meetings in the prefetched calendar context are added as anchors. A meeting-prep run therefore gets the memories of everyone in the room, even when the trigger message names nobody.
- [ ] One hop: a person anchor does **not** pull in that person's projects, and a project anchor does not pull in its people. Only direct links count.
- [ ] **Budget order** within the existing 12,000-char cap (`MEMORY_CHAR_CAP`):
  1. Standing instructions.
  2. Pinned global memories.
  3. Scoped memories matched by anchors, ordered by the number of matched anchors, then `pinned`, then `updatedAt`. At most 8 per entity.
  4. Remaining global memories by `updatedAt`.
- [ ] Scoped memories render grouped under one heading per entity, e.g. `### זיכרון — דן כהן`. A memory matched by two anchors appears once, under the first.
- [ ] **Given** a run whose text and calendar mention no linked entity, **then** the block contains instructions and global memories only. No scoped memory appears.
- [ ] Anchor and name lookups load people, aliases, projects and workspaces once per process and cache them for 5 minutes. The memory block adds no more than 3 DB queries per run after warm-up.
- [ ] Any failure in anchor extraction falls back to today's behaviour (instructions + newest memories). It never fails the run.

### Pull tool — `recall_memories`

- [ ] New Hugo tool `recall_memories({ person?, project?, topic?, query? })`. Names are resolved as in `remember`. It returns every memory linked to that entity (no 8-item cap), plus global memories whose content contains `query`.
- [ ] Gated through `getToolDeclarations(agentId)` to the same set as `get_harness_insights`: `01_Hugo_orchestrator`, `03_morning_briefing`, `04_meeting_prep_herald`, and the general `/chat`.
- [ ] Hugo's Chief of Staff block gains one line: on a named-person or named-project ask, call `recall_memories` as part of the depth pass.

### Backfill

- [ ] A one-shot backfill runs `suggestMemoryLinks` over every existing memory and writes the matched links with `origin = 'backfill'`. It is guarded by a new `user_settings.memory_links_backfilled_at` and runs lazily on the first `getMemoryPromptBlock` call after deploy.
- [ ] The backfill never removes or edits memory content, and never links `kind = 'instruction'` rows. Those stay global.

### Observability

- [ ] `memory.relevant({ message, agentId })` returns the exact block that would be injected, plus the anchors found and the memories dropped by the cap. `/memory` shows it as a "מה הוגו יראה" tester.

## Data model

Additive only. Edit `packages/database/src/schema.pg.ts` first, mirror it in `schema.ts`, add a `CREATE TABLE IF NOT EXISTS` block plus the `ALTER TABLE` in `packages/database/src/index.ts`, and export the table and its types.

### New table `memory_links`

| column | type | notes |
|---|---|---|
| `id` | text PK | `ml_<memoryId>_<kind>_<entityId>`, deterministic |
| `memory_id` | text notNull | FK → `memories.id`, `onDelete: cascade` |
| `entity_kind` | text notNull | `person` \| `project` \| `workspace` \| `topic` |
| `entity_id` | text notNull | the row id, or the normalized topic token |
| `origin` | text notNull | `manual` \| `tool` \| `auto` \| `backfill` |
| `created_at` | text notNull | |

Indexes: `(entity_kind, entity_id)`, `memory_id`, plus unique `(memory_id, entity_kind, entity_id)`.

`entity_id` has no FK because it is polymorphic. Cleanup on entity delete is done explicitly in the `people.delete`, `projects.delete` and `workspaces.delete` mutations and in the people-merge path.

### Changed table `user_settings`

- Add `memory_links_backfilled_at` text, nullable.

`memories` itself is unchanged.

## tRPC API

Extend the existing router `packages/api/src/routers/memory.ts`. All procedures are `protectedProcedure`.

| procedure | kind | input | returns |
|---|---|---|---|
| `memories.list` | query | adds `personId?`, `projectId?`, `workspaceId?`, `topic?`, `scope?: 'global' \| 'scoped'` | each row gains `links: { kind, entityId, label }[]` |
| `memories.create` | mutation | adds `links?: { kind, entityId }[]` | row with `links` |
| `memories.update` | mutation | unchanged | unchanged |
| `memories.setLinks` | mutation | `{ id, links: { kind, entityId }[] }`, which replaces all links | `{ links }` |
| `memories.suggestLinks` | query | `{ content: string }` | `{ links: { kind, entityId, label }[] }` |
| `relevant` | query | `{ message: string, agentId?: string }` | `{ block: string, anchors: { kind, entityId, label }[], dropped: string[] }` |

The engine-side logic lives in a new service, `packages/api/src/services/memory-relevance.ts`, with these exports:

- `extractAnchors(db, text, extra?)`
- `suggestMemoryLinks(db, content)`
- `selectMemoriesForRun(db, { anchors, charCap })`
- `backfillMemoryLinks(db)`

`apps/web/src/lib/agent-memory.ts` keeps `composeMemoryPromptBlock` as the pure renderer, extended with grouped scoped sections, and calls the service.

## UI surface

UI Designer review is required: RTL, dark theme, `.btn` / `.input` / `.card`.

- **`apps/web/src/app/memory/page.tsx`**
  - Each memory shows its link chips (person, project, workspace, topic) and an edit control that uses `setLinks`.
  - A filter bar: all / global / by entity.
  - The create form shows the `suggestLinks` result as pre-checked chips the user can remove.
  - A collapsible "מה הוגו יראה" tester: a text field that calls `relevant` and shows the anchors found and the rendered block.
- **`apps/web/src/components/people/PersonDetailDrawer.tsx`**: a "זיכרונות" section listing that person's linked memories, with a one-line add that pre-links the person.
- **`apps/web/src/app/projects/[id]`**: the same "זיכרונות" section for the project.

## Tests

- **Vitest** (`packages/api`):
  - `extractAnchors`: Hebrew and Latin names, aliases, whole-word only (e.g. "דן" must not match "דנה"), topic tokens.
  - `selectMemoriesForRun`: budget order, the 8-per-entity cap, de-dupe across anchors, and global-only when there are no anchors.
  - `setLinks` and cleanup when an entity is deleted.
  - Link move on person merge.
  - Backfill is idempotent.
- **Vitest** (`apps/web`):
  - Prompt contract: a meeting-prep run includes an attendee's scoped memory.
  - A finance question with no anchors excludes it.
  - The `remember` tool resolves `aboutPeople`.
- **Playwright**: on `/memory`, add a memory, see the suggested chip, save it, then see it in that person's drawer.

## Out of scope

- Embeddings or semantic search. Matching is name, alias and token based only.
- Automatic memory writing from meetings, WhatsApp or email (the "memory distiller"). That is a separate spec.
- Project and topic nodes in the harness world model. That is a separate spec.
- Per-agent memory scopes. All agents share one bank, as today.
- Changes to `hugo_instructions` or to the `PRECEDENCE` block.
- Removing the `facts` table or the `save_fact` tool.
- Multi-hop expansion (person → their projects).

## Open questions

- Should a person anchor also pull memories linked to that person's company (`people.company_id`)? The default in this spec is no (one hop only); this can be revisited once real usage shows a need.
