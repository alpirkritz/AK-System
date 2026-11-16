# Agent feedback loop — corrections that actually change behaviour

> **Slug:** `agent-feedback-loop`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Depends on:** `hugo-entity-memory.md` (memory links)

## Goal

Turn a correction Alpir gives about an agent ("הסיכום בוקר תמיד מפספס את X") into a reviewed, per-agent standing rule that is injected into that agent's runs only. Agent cards (`A_Agents/*.md`) are never machine-edited.

### Why

- `log_agent_feedback` appends a block to `M_Memory/agents_daily_sync.md`, under `/data/abc` in production (`apps/web/src/lib/agent-feedback-log.ts`). Hugo then tells Alpir "נרשם לטיפול, ייבדק ידנית". Nothing reads that file again, so the loop never closes.
- `.cursorrules` Rule 3 keeps agent cards human-curated. The fix therefore has to live outside the cards.
- The only per-agent knob today is the schedule's `triggerMessage`. Standing instructions (`hugo_instructions`) apply to **every** agent, so a rule meant for the calendar optimizer leaks into meeting prep.

## User stories

- As Alpir, when I complain about how an agent behaved, I want to see the complaint in one list with a suggested rule, and apply it in one click.
- As Alpir, I want an applied rule to affect only that agent.
- As Alpir, I want to see, edit and switch off every rule I applied per agent, next to that agent's settings.
- As Alpir, I want the markdown journal to keep recording corrections, for the audit trail.

## Acceptance criteria

### Capture

- [ ] `log_agent_feedback` keeps appending to `agents_daily_sync.md`, unchanged. It also inserts a row into the new `agent_feedback` table:
  - `status = 'pending'`;
  - `suggested_rule` holds one imperative Hebrew line produced by a single Gemini call ("Rewrite this complaint as one rule the agent should follow"), at most 200 chars.
  - On a Gemini failure, `suggested_rule` is null, and the row is still saved.
- [ ] Hugo's confirmation text changes to: "נרשם ל-<agentId>. הצעה לכלל: «…» — אפשר לאשר במסך הסוכנים". The no-false-claims rule stays: Hugo never says the behaviour already changed.

### Apply

- [ ] `MEMORY_LINK_KINDS` gains `agent`, so a link's `entity_id` can be an agent id.
- [ ] **Applying feedback** creates a memory with:
  - `kind = 'instruction'`, `source = 'manual'`;
  - content = the (possibly edited) rule;
  - one link `agent:<agentId>`.
- [ ] Applying sets the feedback row to `status = 'applied'` with `memory_id`.
- [ ] **Rejecting** sets `status = 'rejected'`.
- [ ] **Injection.** `selectMemoriesForRun` always adds `{ kind: 'agent', entityId: <run agentId> }` as the first anchor. The rule renders under `### כללים לסוכן הזה`, placed before the global memories, and is exempt from the 8-per-entity cap. The cap for agent rules is 20.
- [ ] An agent-linked instruction never reaches any other agent, because no other run has that anchor.
- [ ] Switching a rule off works by setting `pinned = false` plus a new `memories.status = 'disabled'`. This reuses the `status` column from `memory-distiller`; if that spec has not landed, this one adds the column with the same default `'active'`.

## Data model

Additive, in both schema files, plus the SQLite bootstrap.

### `agent_feedback`

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `agent_id` | text notNull | indexed |
| `feedback` | text notNull | verbatim |
| `channel` | text | |
| `suggested_rule` | text | |
| `status` | text notNull | default `'pending'`; `pending` \| `applied` \| `rejected` |
| `memory_id` | text | set on apply |
| `created_at` / `updated_at` | text notNull | |

`MEMORY_LINK_KINDS` adds `'agent'` (`schema.ts`). The existing column needs no change.

## tRPC API

**Existing router** `packages/api/src/routers/agents.ts`, new sub-router `feedback`:

| procedure | kind | input | returns |
|---|---|---|---|
| `feedback.list` | query | `{ agentId?, status? = 'pending' }` | rows |
| `feedback.apply` | mutation | `{ id, rule: string (1–500) }` | `{ memoryId }` |
| `feedback.reject` | mutation | `{ id }` | `{ ok }` |
| `rules.list` | query | `{ agentId }` | instruction memories linked to that agent |
| `rules.setEnabled` | mutation | `{ memoryId, enabled }` | `{ ok }` |

`memory.memories.update` can edit a rule's text.

## UI surface

UI Designer review is required.

- In `/agents/manage` ▸ the agent's panel (`AgentConfigPanel.tsx`), add a **"כללים ותיקונים"** section with:
  - pending feedback: the verbatim complaint, an editable suggested rule, and **החל** / **דחה** buttons;
  - applied rules: each with an on/off toggle and edit.
- `/memory`: agent-linked instructions show an agent chip. The `MemoryLinkAdder` "סוכן" kind lists runnable agents.

## Tests

- **Vitest:**
  - `log_agent_feedback` writes both the file block and the DB row, and survives a Gemini failure;
  - apply/reject state transitions;
  - an agent-linked rule is injected only for that agent;
  - the cap of 20;
  - disabled rules are excluded.
- **Playwright:** apply a seeded pending feedback, and see it under "כללים" for that agent.

## Out of scope

- Editing `A_Agents/*.md`.
- Hugo applying rules by himself without the UI step.
- Bulk migration of past feedback entries from the markdown journal. They stay in the file.

## Open questions

- Should Hugo also be able to apply a rule from chat after an explicit "כן, תחיל"? This spec says no: rules change agent behaviour persistently, so applying stays a deliberate UI action.
