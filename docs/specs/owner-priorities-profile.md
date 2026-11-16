# Owner profile — who Alpir is and what matters now

> **Slug:** `owner-priorities-profile`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Depends on:** `harness-project-topic-nodes.md` (for the neglect detector)

## Goal

Give every agent a short, DB-backed picture of Alpir's roles, his worlds and his **current priorities**. This lets Hugo judge "what is important" against what Alpir has actually committed to, rather than against recency or volume.

### Why

- The only owner context in the Gemini prompt is `ownerIdentityPrompt()` (`packages/api/src/lib/self-identity.ts`). It covers name and address only: no roles, no priorities.
- `B_Brain/organization_knowledge.md` is still an unfilled template. It is read only by `cursor-agent-engine.ts`, not by the Gemini engine that runs in production.
- `workspaces.kind` and `workspaces.description` already describe each world, but no agent prompt reads them.
- The Chief of Staff contract asks Hugo for "מה חשוב עכשיו", but nothing tells him what Alpir's priorities are.

## User stories

- As Alpir, I want to list my 3–5 priorities for this period once, so every brief ranks what it tells me against them.
- As Alpir, I want Hugo to tell me when a priority has gone untouched for a week.
- As Alpir, I want to update priorities by telling Hugo ("העדיפות הראשונה עכשיו היא גיוס"), with a confirmation step, not only from a settings page.
- As Alpir, I want a nudge when my priorities are stale, so they don't silently rot.

## Acceptance criteria

### Profile

- [ ] New single-row table `owner_profile` (`id = 'default'`) with these fields:
  - `roles`: free text, at most 1,000 chars;
  - `priorities`: JSON `{ id, title, projectId?, workspaceId?, until? }[]`, at most 7 items;
  - `principles`: free text, at most 1,500 chars;
  - `updated_at`.
- [ ] **New prompt block** `## על אלפיר — תפקידים ועדיפויות`. It sits right after `ownerIdentityPrompt()`, for **all** agents, capped at 2,500 chars. It contains:
  - the roles;
  - the priorities, numbered in order, with linked project or world names and `until` dates. Priorities past their `until` are hidden and noted as "פג תוקף";
  - the principles;
  - one line per world (workspace with no parent): name, kind and description.
- [ ] Hugo's judgment contract gains one line: rank "מה חשוב עכשיו" against the numbered priorities first, and say which priority an item serves. When an item serves none, say so.

### Updating

- [ ] **New Hugo tool `propose_priorities_update({ priorities, reason })`.**
  - It returns a diff (added, removed, reordered). **It never writes.**
  - Hugo shows the diff and asks for confirmation.
  - On a clear yes in the next turn, he calls `apply_priorities_update({ token })`. The token is single-use, valid for 30 minutes, and bound to that exact diff.
- [ ] When `owner_profile.updated_at` is more than 14 days old, the Sunday morning briefing context gets one line: "העדיפויות לא עודכנו N ימים — עדיין נכונות?"

### Neglect detector

- [ ] **New harness detector `priority_neglected`.** It fires for a priority whose linked project has no meeting, task change or WhatsApp signal in 7 days:
  - severity `attention`;
  - dedupe key `priority_neglected:<priorityId>:<isoWeek>`;
  - its sources are the project node.
- [ ] Priorities with no `projectId` are skipped by the detector.

## Data model

Additive, in both schema files, plus the SQLite bootstrap.

### `owner_profile`

| column | type | notes |
|---|---|---|
| `id` | text PK | always `'default'` |
| `roles` | text | |
| `priorities` | text | JSON |
| `principles` | text | |
| `updated_at` | text notNull | |

Priority ids are generated (`pri_<nanoid>`), so the detector's dedupe keys stay stable when priorities are reordered.

## tRPC API

**New router** `packages/api/src/routers/owner-profile.ts`. It is new because this is not a setting, a memory or a workspace; it is the principal's own record.

| procedure | kind | input | returns |
|---|---|---|---|
| `get` | query | none | `{ roles, priorities, principles, updatedAt }` |
| `set` | mutation | `{ roles?, priorities?, principles? }` | Zod: at most 7 priorities, title 1–120 chars |
| `proposeUpdate` | mutation | `{ priorities, reason }` | `{ token, diff }`; nothing is persisted except the pending token |
| `applyUpdate` | mutation | `{ token }` | `{ ok }` |

Pending tokens live in memory with a TTL. On a process restart they are lost, and the user simply confirms again.

## UI surface

UI Designer review is required.

- A new card at the top of `/memory`: **"מי אני ומה חשוב עכשיו"**. It has:
  - roles and principles textareas;
  - a reorderable priority list, each item with an optional project and world picker (reusing `SearchableAddSelect`) and an optional `until` date;
  - a "עודכן לפני N ימים" line.

## Tests

- **Vitest:**
  - prompt block rendering: the cap, expired priorities, and world lines;
  - `set` validation;
  - propose/apply: a token is single-use, expires, and is bound to its diff;
  - the `priority_neglected` detector: fires after 7 quiet days, does not fire with activity, skips priorities with no project, and dedupes by week.
- **Prompt contract test:** the judgment-contract line is present for Hugo.
- **Playwright:** edit priorities on `/memory` and reload; they persist.

## Out of scope

- Deleting `B_Brain/organization_knowledge.md` or wiring it into Gemini. This profile replaces it for production agents, and it can be retired in a separate change.
- OKR-style scoring or progress tracking.

## Open questions

- Should the cap be 5 priorities rather than 7? A smaller list ranks sharper. The default in this spec is 7.
