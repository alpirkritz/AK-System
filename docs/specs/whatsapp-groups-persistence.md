# WhatsApp Groups — Persistence & Reliability Fixes

> **Slug:** `whatsapp-groups-persistence`
> **Status:** Draft
> **Last Updated:** 2026-07-02

## Goal

Group watching (FOMO alerts, keyword alerts, scheduled summaries) silently stops working after every bridge restart/redeploy because the bridge holds its watch config only in memory, and the scheduled-summary cron route is broken at build time. This spec restores end-to-end reliability so the 43 configured groups keep working across restarts without manual re-syncing.

## User Stories

- As the user, I want group FOMO/keyword alerts to keep working after a deploy without manually clicking "sync", so I don't miss activity.
- As the user, I want the daily scheduled group summaries to actually run.
- As the user, I want to see in Settings whether the bridge is actually watching my enabled groups (drift indicator).

## Acceptance Criteria

- [ ] `api/cron/whatsapp-group-summary` builds and runs (uses `getDb()` not `db`).
- [ ] The bridge persists its group watch config to disk and reloads it on startup, so `GET /groups` returns the watch list after a restart with no manual sync.
- [ ] After `deploy-ec2.sh`, the bridge watch config is re-synced from the AK DB automatically.
- [ ] Settings → WhatsApp → Connection shows "X מסונכרנות לברידג׳ / Y פעילות ב-DB" and warns on drift.

## Data Model

No new tables. Source of truth stays `whatsapp_groups` / `whatsapp_labels` (already on the `/data` SQLite volume).

New bridge-side persistence file: `${AUTH_STATE_PATH}/group-config.json` (on the `bridge-auth` volume).

## tRPC API

- Add `whatsapp.sync.status` (protected query): returns `{ configured, dbEnabledCount, bridgeWatchedCount, inSync }` by reading DB enabled groups and the bridge `GET /groups` watchList.

## Bridge changes (`apps/whatsapp-bridge`)

- `group-config.ts`: on `reloadGroupConfig`, persist `dynamicGroups` to `${AUTH_STATE_PATH}/group-config.json`; add `loadPersistedGroupConfig()` that restores it and sets `useDynamicConfig`.
- `index.ts`: call `loadPersistedGroupConfig()` on startup (before/around `startWhatsAppClient`).

## Deploy changes

- `scripts/deploy-ec2.sh`: after `docker compose up`, POST `whatsapp.sync.pushToBridge` (via an internal call using `CRON_SECRET`, or a small node script that runs `buildBridgePayload` + `pushConfigToBridge`). Non-fatal on failure.

## UI Surface

`apps/web/src/app/settings/whatsapp/page.tsx` Connection tab: show sync/drift line using `whatsapp.sync.status`, with a hint to press "סנכרן כללים ל-bridge" when out of sync.

## Out of Scope

- Persisting the group message buffer (still in-memory; acceptable).
- Changing FOMO/keyword algorithms or the 15-minute cron grid.

## Open Questions

- None blocking.
