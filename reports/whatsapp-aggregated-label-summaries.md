# Code Review: WhatsApp aggregated label summaries

> **Slug:** `whatsapp-aggregated-label-summaries`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-09-14

## Spec Conformance

Opt-in clustering is a stored boolean on `whatsapp_labels` (`aggregateSummaries`). Label create / rename / delete is unchanged. No label name is hardcoded; gan/school appear only as UI examples. Cron partitions due groups via `partitionDueSummaries`; clustered labels with 2+ due enabled groups go through `POST /groups/summarize-cluster`; everyone else stays per-group. FOMO/keywords untouched. On-demand **סכם עכשיו** calls `whatsapp.summaries.trigger({ labelId })` with DB fallback when buffers are empty.

## Static Checks

| Check | Result |
|---|---|
| `pnpm -r run lint` | PASS (pre-existing warnings only; none introduced as errors) |
| `pnpm --filter @ak-system/web build` | PASS (`/api/whatsapp/group-cluster-summary` and cron route present) |
| `pnpm test` | PASS (796 API + 209 web) |
| Playwright `e2e/whatsapp-labels-cluster.spec.ts` | PASS |

## UI Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.btn` / `.card` utilities (toggle reused from the page)
- [x] Dark theme colors match existing WhatsApp settings navy/green
- [x] RTL layout preserved
- [x] Mobile layout: same stacked labels tab, no new chrome
- [x] Focus-visible: native button/switch on existing controls
- [x] Loading / error / empty states: existing list empty copy; trigger errors use the page banner
- [x] No new CSS frameworks
- [x] Reuses Labels tab rather than a new route

### Findings
- Must-fix: none
- Nits: helper copy is long; acceptable for a one-time explanation of the parameter.

## Findings

### Must-fix

None.

### Nits

- Playwright does not create a label and assert it in the list. The settings page batches `groups.discover` on first load; with no bridge that procedure throws and `labels.list` stays empty in e2e. CRUD is covered by Vitest. `apps/web/src/app/settings/whatsapp/page.tsx`.
- Postgres/prod requires a manual additive `ALTER TABLE whatsapp_labels ADD COLUMN IF NOT EXISTS aggregate_summaries integer NOT NULL DEFAULT 0` (or boolean equivalent). SQLite is handled by drizzle-kit + `getDb()` bootstrap.
- Bridge `/groups/summarize-all` remains per-group by spec; only AK cron/tRPC are cluster-aware.

### Suggestions

None required for merge.

## Security

- Cluster webhook uses `verifyWhatsAppBridgeAuth`.
- Bridge cluster route is bearer-authed.
- No new secrets. Optional `AK_GROUP_CLUSTER_SUMMARY_URL` only.

## Schema parity

- `packages/database/src/schema.ts`: `aggregateSummaries` boolean-mode integer, default false.
- `packages/database/src/schema.pg.ts`: `aggregate_summaries` integer, default 0 (matches `whatsapp_groups.enabled` style).
- SQLite ALTER in `packages/database/src/index.ts`.
