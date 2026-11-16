# Memory distiller — proposed memories from what already happened

> **Slug:** `memory-distiller`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Depends on:** `hugo-entity-memory.md` (memory links, `resolveNamedEntities`)

## Goal

Once a night, read the day's meeting analyses, WhatsApp DM summaries and Hugo conversations, and **propose** durable facts as memories linked to people, projects and topics. Alpir accepts, edits or rejects each proposal. Nothing is injected until it is accepted.

### Why

- Today every memory is written explicitly: by Alpir on `/memory`, or by Hugo when told "תזכור". `MEMORY_SOURCES` includes `auto`, but nothing writes it.
- Decisions and facts that come out of meetings ("Algo 4 נדחה לרבעון הבא", "דן מחליף את רוני כאחראי על DD") stay inside `meeting_analyses` rows. Hugo sees them only when he searches for that meeting.
- Person traits (`person_observations` → `person_traits`) cover *what someone is like*. Nothing covers *what was decided or what is true now*.

## User stories

- As Alpir, I want a short list each morning of facts the system learned yesterday, so I can keep the true ones with one click.
- As Alpir, I want each proposal to show where it came from (meeting, chat, date), so I can judge it without opening the source.
- As Alpir, I want a rejected proposal never to come back.
- As Alpir, I want a proposal that updates an existing memory ("Algo 4 נדחה שוב, לפברואר") to say which memory it replaces.
- As Alpir, I want preferences I mention to Hugo in passing ("אני לא אוהב פגישות אחרי 18:00") proposed as memories, even if I didn't say "תזכור".

## Acceptance criteria

### Extraction

- [ ] **New cron `/api/cron/memory-distiller`,** scheduled at `40 2 * * *`. It reads rows created or updated since the last run (stamp: `user_settings.memory_distilled_at`; on the first run, the last 24 hours):
  - `meeting_analyses` with status `done`: `topic`, `keyInsight`, `openQuestion`, `actionItemsJson`, plus the meeting title and date;
  - `whatsapp_dm_summaries`;
  - user turns in `agent_messages` for `01_Hugo_orchestrator`, and in `chat_messages`.
- [ ] One Gemini call per batch of up to 20 sources. The prompt asks only for **durable** facts:
  - decisions, changed dates, roles and ownership, stable preferences, relationships between entities.
  - It must exclude tasks, one-off logistics, personality judgements (those belong to traits) and anything already present in the "existing memories" list passed in.
- [ ] **Output per fact:**
  - `content`: Hebrew, at most 200 chars, self-contained;
  - `aboutPeople[]`, `aboutProjects[]`, `topics[]`;
  - `sourceKind`, `sourceId`, `sourceDate`;
  - `replacesMemoryId`: nullable;
  - `confidence`: 0–1.
- [ ] Facts with `confidence < 0.6` are dropped.
- [ ] At most 15 proposals per run.
- [ ] Names resolve through `resolveNamedEntities`. Unresolved names stay as text in `content` and are not linked.

### Dedupe

- [ ] A proposal is dropped when its normalized content (`wordTokens` joined) has Jaccard overlap ≥ 0.8 with any **active, proposed or rejected** memory that shares at least one link, or with any global memory.
- [ ] Rejected memories are kept, with status `rejected`, only to feed this dedupe check. They are never injected and never listed by default.

### Lifecycle

- [ ] Proposals are stored as `memories` rows with `source = 'auto'`, `status = 'proposed'` and an `evidence` JSON.
- [ ] Every injection path reads only `status = 'active'`: `selectMemoriesForRun`, `recallMemories`, and the fallback in `getMemoryPromptBlock`.
- [ ] **Accept:** `status → active`. When `replacesMemoryId` is set, the old memory is marked `superseded` and its links are copied onto the new memory.
- [ ] **Edit-and-accept:** the content and links are changed, then accepted.
- [ ] **Reject:** `status → rejected`.
- [ ] If any proposals are pending at 07:00, the morning briefing context includes one line: "N זיכרונות חדשים מחכים לאישור — /memory". There is no separate push.
- [ ] Hugo can list pending proposals and accept or reject them when asked ("מה למדת אתמול?"). He does this only with explicit consent in the chat, using the tool `review_memory_proposals({ action: 'list' | 'accept' | 'reject', ids? })`.

## Data model

All changes are additive, in both `schema.pg.ts` and `schema.ts`, plus the SQLite bootstrap `ALTER TABLE`.

- `memories.status`: text, not null, default `'active'`. Values: `active` | `proposed` | `rejected` | `superseded`.
- `memories.evidence`: text, nullable. A JSON array of `{ sourceKind, sourceId, sourceDate, label }`.
- `memories.replaces_memory_id`: text, nullable.
- `user_settings.memory_distilled_at`: text, nullable.
- Index on `memories(status)`.

Existing rows default to `active`, so behaviour is unchanged.

## tRPC API

Router `packages/api/src/routers/memory.ts` (existing):

| procedure | kind | input | returns |
|---|---|---|---|
| `memories.list` | query | adds `status?: 'active' \| 'proposed' \| 'rejected'` (default `active`) | rows also return `evidence` and `replacesMemoryId` |
| `proposals.accept` | mutation | `{ id, content?, links? }` | `{ ok }` |
| `proposals.reject` | mutation | `{ ids: string[] }` | `{ ok, count }` |
| `proposals.count` | query | none | `{ pending }` |
| `distill` | mutation | `{ sinceHours?: number }` | `{ proposed, dropped }` (manual run, for testing) |

The service lives in `packages/api/src/services/memory-distiller.ts`.

## UI surface

UI Designer review is required.

- `/memory` gets a tab **"הצעות (N)"**. Each proposal card shows:
  - the content;
  - the link chips;
  - the evidence ("מתוך: פגישת Algo 4 · 12/11");
  - when `replacesMemoryId` is set, the replaced memory, struck through;
  - the buttons **שמור**, **ערוך ושמור** and **דחה**.
- The tab also has a "דחה הכל" bulk action.
- The dashboard nav badge on the memory link shows the pending count.

## Tests

- **Vitest:**
  - extraction with a Gemini mock: the confidence filter, the 15-item cap, and name resolution;
  - dedupe against active, proposed and rejected memories;
  - accept, edit-accept and reject;
  - supersede copies links onto the new memory;
  - injection ignores non-active memories;
  - the cron stamp advances.
- **Playwright:** a seeded proposal shows up under "הצעות"; accepting it moves it to the main list.

## Out of scope

- Distilling from email threads. That can be added later, after the cost of email bodies is measured.
- Automatic acceptance at any confidence level.
- Rewriting person traits.

## Open questions

- Should proposals that wait more than 14 days be rejected automatically? The default in this spec is no: they stay pending, and the badge keeps them visible.
