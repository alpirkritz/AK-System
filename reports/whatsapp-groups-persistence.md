# Review — whatsapp-groups-persistence

**Verdict:** APPROVED

## Scope
Spec: `docs/specs/whatsapp-groups-persistence.md`.

## Changes
- `apps/web/src/app/api/cron/whatsapp-group-summary/route.ts` — fixed broken import (`db` → `getDb()` + `const db = getDb()` in handler). Build now includes this route; previously it threw at request time so 20:00 summaries never ran.
- `apps/whatsapp-bridge/src/group-config.ts` — persist `dynamicGroups` to `${AUTH_STATE_PATH}/group-config.json` on every `reloadGroupConfig` and on `updateGroupLastFomoAlert`; added `loadPersistedGroupConfig()`.
- `apps/whatsapp-bridge/src/index.ts` — call `loadPersistedGroupConfig()` on startup.
- `apps/web/src/app/api/whatsapp/sync-bridge/route.ts` — new CRON_SECRET-guarded route that re-pushes DB rules to the bridge (source of truth).
- `packages/api/src/services/whatsapp-bridge-client.ts` — added `getBridgeWatchedGroups()`.
- `packages/api/src/routers/whatsapp.ts` — added `whatsapp.sync.status` drift query.
- `packages/api/src/index.ts` — export bridge client helpers.
- `apps/web/src/app/settings/whatsapp/page.tsx` — drift indicator on Connection tab.
- `scripts/deploy-ec2.sh` — post-start re-sync step (non-fatal).

## Verification (production, EC2)
- Deploy succeeded; both containers up.
- Auto re-sync output: `{"ok":true,"enabled":43} ✓ synced`.
- `GET /groups` watchList = **43**.
- `/data/auth/group-config.json` present (10192 bytes) on the bridge volume → survives restart.
- `web HTTP 200` on `/api/health`.

## Notes / Out of scope
- Group message buffer remains in-memory by design.
- `next lint` is interactive in the local sandbox; typecheck via `next build` (passes) + `tsc --noEmit` on the bridge (passes).
