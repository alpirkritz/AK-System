# Review — owner-priorities-profile

**Spec:** `docs/specs/owner-priorities-profile.md`
**Verdict:** APPROVED WITH NITS
**Date:** 2026-11-16

## What changed

- `owner_profile` table with a router (`get` / `set` / `promptBlock` / `proposeUpdate` / `applyUpdate`).
- The "על אלפיר — תפקידים ועדיפויות" block (roles, numbered priorities, expired ones, principles, worlds) goes into every agent prompt right after the identity line.
- Hugo's judgment contract now ranks items against the priorities. `propose_priorities_update` never writes; `apply_priorities_update` takes a single-use, 30-minute token bound to that diff.
- New detector `priority_neglected`: no meeting or task change on a priority's project in 7 days, deduped by ISO week.
- The Sunday morning brief nudges when priorities are more than 14 days old, or were never set.
- UI: the "מי אני ומה חשוב עכשיו" card on `/memory`.

## Checks (shared run for all six context specs)

| check | result |
|---|---|
| `packages/api` Vitest | 146 files, 1595 tests pass |
| `apps/web` Vitest | 53 files, 348 tests pass |
| New Playwright | `e2e/hugo-context-layers.spec.ts` (3) and `e2e/hugo-entity-memory.spec.ts` (1) pass; `agent-config.spec.ts` still passes |
| `pnpm -r run lint` | no new findings (pre-existing warnings only) |
| `pnpm --filter @ak-system/web build` | passes; the new cron routes `/api/cron/harness-reason` and `/api/cron/memory-distiller` are listed |
| Full `pnpm e2e` (run before these specs) | 115 passed, 42 failed, 2 skipped. None of the failures touch the changed surfaces. They are stale selectors (`.modal` placeholder `תפקיד`, heading `פגישות חוזרות`, Slack `ערוצים`), e2e seed SQL with outdated columns (`people.updated_at`), and a sub-pixel width assertion |

## Deviations from spec

- The neglect detector checks meetings and task changes only. WhatsApp signals carry no project link.
- Pending tokens live in process memory, as the spec allows. After a restart, Hugo has to propose again.

## Nits / follow-ups

1. `B_Brain/organization_knowledge.md` is untouched. It can be retired separately.
