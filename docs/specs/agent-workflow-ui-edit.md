# Agent card + workflow UI edit (and production persistence)

> **Slug:** `agent-workflow-ui-edit`
> **Status:** Draft
> **Last Updated:** 2026-07-16
> **Stack:** next-trpc-monorepo

## Goal

Make ABC agent behavior fully editable from `/agents/manage`: show and save both the agent card (`A_Agents/*.md`) and its linked workflow (`S_Skills/wf_*.md`) with the same load/edit/save cycle. Persist those edits across production redeploys by storing ABC markdown on a Docker volume instead of only inside the image.

## User Stories

- As the user, I want to see the Meeting Prep (and other agents') workflow next to the agent card in the UI, so what is in the `.md` is what I manage.
- As the user, I want saving in the UI to write immediately to the relevant `.md` file.
- As the user, I want those edits to survive `docker compose` rebuild/redeploy on EC2.

## Acceptance Criteria

- [ ] Selecting an agent on `/agents/manage` loads the agent card markdown (existing) and, when mapped, the linked workflow markdown.
- [ ] Agents without a workflow mapping show a clear "אין workflow מקושר" empty state (not an error).
- [ ] Saving the card writes to `A_Agents/{id}.md`; saving the workflow writes to `S_Skills/{wf_file}.md`.
- [ ] Dirty-state / confirm-before-switch covers both editors.
- [ ] Production start seeds `/data/abc` from image seed without overwriting existing edited files; `ABC_ROOT` points at `/data/abc`.
- [ ] New agent/workflow files added in a future image appear in the volume on next start (copy-if-missing).
- [ ] Unit tests cover workflow get/save path safety (path traversal, empty content, missing mapping).

## Data Model

No DB schema changes. Source of truth remains markdown on disk under `ABC_ROOT`.

## tRPC API

No tRPC changes. Extend existing Next.js route handlers under `apps/web/src/app/api/agents/`.

## UI Surface

- Route: `apps/web/src/app/agents/manage/page.tsx`
- Add tabs (or segmented control): **כרטיס סוכן** | **Workflow**
- Each tab has its own textarea + save button (same monospace LTR style as today)
- Subtitle/path shows `A_Agents/{id}.md` or `S_Skills/{file}.md`
- Hebrew microcopy; preserve existing dark theme / `.btn` / `.input` classes

## Backend

### `apps/web/src/lib/abc-agents.ts`

- Export `getAgentWorkflowFile(agentId): string | null` (from `AGENT_WORKFLOWS`)
- Keep `getAgentWorkflowContent`
- Add `saveAgentWorkflowContent(agentId, content)` with the same safety checks as `saveAgentInstructions` (basename, path prefix under `S_Skills/`, non-empty, file must already exist — no create-new)

### API

- `GET /api/agents/[id]` → `{ id, content, workflowFile: string | null, workflowContent: string | null }`
- `PUT /api/agents/[id]` body → `{ content: string, target?: 'instructions' | 'workflow' }` (default `instructions`)

## Production persistence

- Dockerfile: also copy ABC dirs into `/app/abc-seed/{A_Agents,S_Skills,C_Core,B_Brain,M_Memory,O_Output}`
- `docker-compose.production.yml`: volume `abc-data:/data/abc`, `ABC_ROOT=/data/abc`
- `scripts/production-start.sh`: for each seed dir, `mkdir -p` then `cp -an` (no-clobber) from seed → `/data/abc/...`; `export ABC_ROOT`
- Update `docs/deploy/ec2-production.md` briefly

## Out of Scope

- Structured form editor (Role/Boundaries fields) — stay raw markdown
- Auth hardening of `PUT /api/agents/[id]` (pre-existing gap)
- Editing `C_Core/` / `B_Brain/` from UI
- Railway-specific volume docs beyond a short note if already covered

## Open Questions

None — approach confirmed by user (manage UI + production volume).
