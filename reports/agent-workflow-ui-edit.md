# Review — agent-workflow-ui-edit

Verdict: APPROVED WITH NITS

## Scope

Bidirectional edit of agent card + linked workflow from `/agents/manage`, and
production persistence of ABC markdown across redeploys.

## Changes

- `apps/web/src/lib/abc-agents.ts` — `getAgentWorkflowFile`, `saveAgentWorkflowContent`
- `apps/web/src/app/api/agents/[id]/route.ts` — GET returns workflow; PUT accepts `target`
- `apps/web/src/app/agents/manage/page.tsx` — tabs: כרטיס סוכן / Workflow
- `deploy/Dockerfile.runtime` — `abc-seed/` copy
- `deploy/docker-compose.production.yml` — `abc-data:/data/abc`, `ABC_ROOT=/data/abc`
- `scripts/production-start.sh` — seed with `cp -an` (no-clobber)
- Docs/env examples updated

## Verification

- Unit tests: 5 workflow + 3 meeting-prep = 8 passed
- IDE diagnostics clean on edited TS/TSX files

## Nits

- `PUT /api/agents/[id]` still has no auth (pre-existing)
- Railway deploy path not given an `abc-data` volume — EC2 compose is covered; Railway needs a follow-up if used
