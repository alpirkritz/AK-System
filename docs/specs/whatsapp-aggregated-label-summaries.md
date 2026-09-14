# WhatsApp aggregated label summaries

> **Slug:** `whatsapp-aggregated-label-summaries`
> **Status:** Approved
> **Last Updated:** 2026-09-14

Detected stack: `next-trpc-monorepo`

## Goal

Evening WhatsApp summaries today fire once per watched group. Related groups (gan parents vs gan staff, school parents vs school updates) often carry the same event, so the user gets two nearly identical messages. This spec adds an **opt-in** switch on an existing WhatsApp label: groups under that label are summarized together into one friend-style briefing that names the cluster (the label) and collapses duplicate facts. Default stays off, so unrelated groups keep one message each.

How the user turns this on, once implemented: create (or reuse) any label, set its evening summary time, assign the related groups to it, then enable **סכם כאשכול** on that label. Names like `גן אלונה` / `ביה״ס` are examples only — clustering is a stored boolean on whatever labels the user currently has. Adding, renaming, or deleting labels stays fully supported; no label name is hardcoded in code. Do not put unrelated life-clusters under one catch-all label if they should stay separate evening messages.

## User stories

- As the owner, I want to mark a label as a summary cluster so that gan-parents and gan-staff produce one evening message instead of two copies.
- As the owner, I want the cluster message to keep unique facts (a parent-only logistics note) while stating shared facts once, so I do not miss a detail that lived in only one of the groups.
- As the owner, I want groups whose label does not have clustering enabled to keep the current one-message-per-group behavior, so I can turn this on only where it hurts.
- As the owner, I want a "run cluster now" action on the label card so I can verify the merged briefing without waiting for the 20:00 cron slot.
- As the owner, I want the cluster header to use the label name (`גן אלונה`), not a JID and not a concatenation of group names, so I recognize the context immediately.
- As the owner, I want FOMO and keyword alerts to stay per-group, so clustering only changes the scheduled/manual digest, not real-time alerts.
- As the owner, I want to keep adding, renaming, and deleting labels the same way I do today, so clustering is a per-label parameter I can turn on or off rather than a fixed list of named clusters in code.

## Acceptance criteria

- Given label `גן אלונה` has `aggregateSummaries = true` and two enabled groups due at `20:00` (parents + staff), when `/api/cron/whatsapp-group-summary` matches that slot, then the user receives **one** WhatsApp message whose header is `📋 סיכום — גן אלונה`, and neither group gets its own `📋 סיכום קבוצה — {groupName}` message for that slot.
- Given the same two groups both mention "טיול ביום חמישי" and only the parents group mentions "להביא כובע", when the cluster summary is generated, then the trip is stated once and the hat instruction is included, attributed to the parents group in natural Hebrew (no bullet labels required).
- Given a label with `aggregateSummaries = false` (or omitted / default), when the evening cron runs, then behavior is unchanged: one message per due enabled group via existing `POST /groups/summarize`.
- Given a clustered label has only one enabled group due at the slot, when the cron runs, then that group uses the existing per-group summary path and header (`📋 סיכום קבוצה — {groupName}`).
- Given some groups under a clustered label are not `enabled`, when the cluster runs, then they are omitted from the merge and are not summarized.
- Given two groups in a clustered label, one with a group-level `summaryTimes` override of `08:00` and the label default `20:00`, when the `20:00` slot fires, then only the group(s) whose effective times include `20:00` join that cluster run; the `08:00`-only group is not included and is not also summarized per-group at 20:00.
- Given a clustered label is due and every member buffer is empty, when summarize runs, then no WhatsApp message is sent for that cluster (same skip semantics as today's empty per-group buffer: `No buffered messages`).
- Given `whatsapp.labels.upsert` is called without `aggregateSummaries`, when a new label is created, then `aggregateSummaries` is `false`. Existing labels remain off after migration.
- Given the Labels tab toggle **סכם כאשכול** is saved, when the page is reloaded, then the toggle state matches the stored value and the label card subtitle shows that clustering is on.
- Given the user clicks **סכם עכשיו** on a clustered label, when the mutation succeeds, then one cluster message is produced (bridge buffers if present; otherwise persisted `whatsapp_messages` for local `today` as fallback) and a success toast is shown. Per-group summaries for those groups are not also sent.
- Given `whatsapp.summaries.trigger` is called with no `groupJid` and no `labelId`, when multiple clustered labels and some unclustered groups are enabled, then clustered labels are merged (one result per such label with 2+ enabled groups) and remaining groups stay per-group.
- Given `whatsapp.summaries.trigger` is called with a specific `groupJid` whose label is clustered, when that mutation runs, then it still summarizes **that one group** (explicit single-group request is not rewritten into a cluster).
- Given push is enabled for `whatsapp_group_summary`, when a cluster summary is delivered, then the push title is `📋 סיכום — {labelName}` and the body is the briefing truncated to 240 characters.
- Given Gemini returns overlapping content, when formatting the cluster body, then it is 4–8 spoken-Hebrew sentences, no JID, no structured labels/headings, total body at most ~1200 characters, and facts not present in the source messages are not invented.
- Given the user creates a new label, assigns two enabled groups to it, and sets `aggregateSummaries = true`, when the next matching summary slot runs, then those groups are clustered — with no code change and no hardcoded label name.
- Given the user deletes a clustered label (existing `whatsapp.labels.delete`), when groups are unassigned (`labelId` set null) and the evening cron runs, then those groups revert to one message each.
- Given source code and prompts, when clustering is implemented, then no label name (gan, school, or otherwise) is special-cased; membership is always `whatsapp_groups.label_id` plus `whatsapp_labels.aggregate_summaries`.

## Data model

Additive only. No new tables. A group already has at most one `labelId`; that is the cluster membership. Do not add a second grouping entity in this spec.

`packages/database/src/schema.ts` — table `whatsapp_labels`:

- `aggregateSummaries` integer boolean, not null, default `false` (SQLite `integer('aggregate_summaries', { mode: 'boolean' })`).

`packages/database/src/schema.pg.ts` — table `whatsapp_labels`:

- `aggregateSummaries` boolean, not null, default `false` (or integer 0/1 if that file already stores WhatsApp booleans as integers — match `whatsapp_groups.enabled` style in the same file).

`packages/database/src/index.ts`:

- Add `ALTER TABLE whatsapp_labels ADD COLUMN aggregate_summaries INTEGER NOT NULL DEFAULT 0` to the existing WhatsApp column-bootstrap list (new `WHATSAPP_LABELS_COLUMNS` array, same idempotent pattern as `WHATSAPP_GROUPS_COLUMNS`).
- Recreate `CREATE TABLE IF NOT EXISTS whatsapp_labels` is **not** required for existing DBs; the ALTER covers them. New SQLite files that hit `CREATE TABLE IF NOT EXISTS` first should include the column in the CREATE for cleanliness.

Postgres/prod: apply the same additive column manually (`ALTER TABLE whatsapp_labels ADD COLUMN IF NOT EXISTS aggregate_summaries boolean NOT NULL DEFAULT false` or integer equivalent). No breaking change; unread column means "off".

`whatsapp_groups` is unchanged. Cluster membership = `label_id`. Effective summary times stay: group `summary_times` if non-empty, else label `summary_times`.

## tRPC API

Router file: existing `packages/api/src/routers/whatsapp.ts`. Shared partition helper: new `packages/api/src/services/whatsapp-summary-clusters.ts` (pure function, used by cron and trigger). Gemini: add `generateClusterSummary` in existing `packages/api/src/services/whatsapp-insights.ts`. Bridge client: extend `packages/api/src/services/whatsapp-bridge-client.ts`. Auth: all procedures remain `protectedProcedure`.

### Helper (not a procedure)

`partitionDueSummaries(rows, slot: HH:MM)` returns:

- `clusters: { labelId, labelName, groups: { jid, name }[] }[]` — labels with `aggregateSummaries` true and **at least two** enabled groups whose effective times include `slot`
- `singles: { jid, name }[]` — every other due enabled group (unlabeled, clustering off, or a clustered label with only one due group)

A group appears in exactly one of those lists for a given slot.

### Procedures

| Procedure | Kind | Input | Return | Change |
|---|---|---|---|---|
| `whatsapp.labels.list` | query | none | existing fields plus `aggregateSummaries: boolean` | include new flag |
| `whatsapp.labels.upsert` | mutation | `{ id?: string, name: string (1–100), summaryTimes: HH:MM[] (default []), aggregateSummaries?: boolean (default false) }` | `{ id, name, summaryTimes, aggregateSummaries, createdAt }` | persist flag |
| `whatsapp.summaries.trigger` | mutation | `{ groupJid?: string, labelId?: string }` (`groupJid` and `labelId` mutually exclusive; both optional) | `{ results: { jid?: string, labelId?: string, name: string, ok: boolean, error?: string }[], okCount, failCount, message?: string }` | see rules below |
| `whatsapp.groupsDueForSummary` | query | `{ time: HH:MM }` | `{ clusters, singles }` using the helper above | replace the flat `{ jid, name }[]` (only used by cron/tests; update callers) |

`whatsapp.summaries.trigger` rules:

- `groupJid` set: existing `summarizeGroup(groupJid)` only.
- `labelId` set: if the label is missing, throw; if fewer than two enabled members, fall through to per-group summarize for the one member (or return empty); otherwise call cluster summarize for those enabled members (ignore cron slot; this is on-demand).
- neither set: partition **all enabled** groups as if every enabled group's effective times matched (on-demand "summarize everything"), then cluster vs single as above.

### HTTP / Bridge

Cron: `apps/web/src/app/api/cron/whatsapp-group-summary/route.ts` — after resolving `due` rows, call `partitionDueSummaries`. For each cluster, `summarizeCluster({ labelName, groupJids })`. For each single, existing `POST /groups/summarize`. Do not also per-group-summarize clustered JIDs.

Bridge (`apps/whatsapp-bridge/src/server.ts` + `whatsapp-client.ts`):

- New `POST /groups/summarize-cluster`, bearer auth, body `{ clusterName: string, groupJids: string[] }` (2+ JIDs).
- Implementation `requestClusterSummary`: for each JID, read `getGroupBuffer`; drop JIDs with empty buffers; if none remain, `{ ok: false, error: 'No buffered messages for this cluster' }`; otherwise POST to the cluster webhook (derive from `AK_WEBHOOK_URL` by replacing `/webhook` with `/group-cluster-summary`, override `AK_GROUP_CLUSTER_SUMMARY_URL` if set); on success `flushPersistQueues`, `clearGroupBuffer` only for JIDs that contributed, `sendWhatsAppMessage(self, summary)` **once**.
- `POST /groups/summarize-all` must use the same partition logic **or** stay per-group and let the AK cron/tRPC be the only cluster-aware caller. Decision: cron and `whatsapp.summaries.trigger` are cluster-aware; bridge `/groups/summarize-all` stays per-group so a raw bridge call does not surprise. Document this.

Web webhook: new `POST /api/whatsapp/group-cluster-summary` (`apps/web/src/app/api/whatsapp/group-cluster-summary/route.ts`), `verifyWhatsAppBridgeAuth`. Body:

```
{ clusterName, groups: [{ groupJid, groupName, messages: BufferedGroupMessage[] }] }
```

Calls `generateClusterSummary(clusterName, groups)`, then the same notification path as `group-summary/route.ts` (`resolveNotificationChannels('whatsapp_group_summary')`, `createNotification`, browser + mobile push) with the cluster title. Returns `{ summary, reply }`.

DB fallback (on-demand **סכם עכשיו** only, when the bridge returns no buffers): load `whatsapp_messages` for those JIDs with `resolveWhatsappTimeWindow({ window: 'today' })`, call the same `generateClusterSummary`, send via existing `sendWhatsAppMessage` in `apps/web/src/lib/whatsapp-bot.ts` if the web app is allowed to send, **or** return the text to the UI and still push. Prefer: web sends WhatsApp through the bridge `POST /send` if that client helper already exists; otherwise show the text in Settings and send push. Do not leave the user with a silent no-op.

### Gemini

`generateClusterSummary(clusterName, groups: { name, messages }[])` in `whatsapp-insights.ts`:

- Friend-style spoken Hebrew, same voice as `summarizeGroupMessages` / group `summary` mode.
- Instruct: merge duplicate events; mention a source group name only when a fact appears in one group; 4–8 sentences; do not invent; if nothing meaningful, say so once for the cluster.
- Cap return at 1200 characters.

Client wrapper: `summarizeCluster({ clusterName, groupJids })` in `whatsapp-bridge-client.ts` posts `/groups/summarize-cluster`.

## UI surface

Route: existing `apps/web/src/app/settings/whatsapp/page.tsx` (Labels tab). No new route. Mobile app: no change (settings live on web).

Labels form (create / edit card):

- Existing name + default summary-times fields stay.
- Add a switch (reuse the page `Toggle`) labeled **סכם כאשכול**.
- Helper under the switch: `קבוצות תחת התווית יקבלו סיכום אחד. כפילויות בין הקבוצות יאוחדו. השתמשו בתווית נפרדת לכל אשכול חיים (גן, בית ספר), לא בתווית כללית לכל הערב.`
- Pass `aggregateSummaries` into `whatsapp.labels.upsert`.

Label list cards:

- Subtitle adds ` · סיכום מאוחד` when the flag is on (keep existing `סיכום: 20:00 · N קבוצות`).
- When flag is on and `groupCount >= 2`, show button **סכם עכשיו** → `whatsapp.summaries.trigger({ labelId })`. Disable while pending; on error show the existing `message` banner.
- When flag is on and `groupCount < 2`, show muted hint `צריך לפחות שתי קבוצות פעילות תחת התווית` instead of the button.

Groups tab: no new fields. Existing label dropdown is membership. Optional one-line hint under the label select when the chosen label has clustering on: `הקבוצה תיכלל בסיכום המאוחד של התווית, לא בסיכום נפרד בערב.` Skip if that requires an extra round-trip; the Labels-tab copy is sufficient for v1.

Insights tab / `whatsapp.insights.digest` / Hugo tools (`summarize_whatsapp_groups`, `whatsapp_now`): unchanged. On-demand "מה קורה עכשיו" already links related topics; this spec only stops duplicate **scheduled** WhatsApp messages.

Design system: existing `.card` / `.btn` / `.btn-primary` / `.btn-ghost`, RTL, dark navy, WhatsApp green toggle already on the page.

E2E: extend `apps/web/e2e/whatsapp-insights.spec.ts` or add `apps/web/e2e/whatsapp-labels-cluster.spec.ts` — open Labels tab, create/edit shows **סכם כאשכול**, toggle is visible. Vitest: `packages/api` tests for `labels.upsert` flag, `partitionDueSummaries` (two clustered + one single + one clustered singleton), and `groupsDueForSummary` shape.

## Out of scope

- Auto-detecting related groups with embeddings or heuristics. Membership is explicit via the user's labels.
- Freezing or seeding a built-in set of cluster names. Labels remain user-managed CRUD.
- A group belonging to multiple clusters (still one `labelId`).
- Changing FOMO, keyword alerts, or the in-memory 500-cap buffer algorithm.
- Changing per-group friend-style wording for non-clustered summaries.
- Merging across labels, or a global "one evening WhatsApp for everything".
- Changing `whatsapp.insights.digest` ranking/narrative, Hugo call-diet, or `messages.forTool`.
- New npm dependencies.
- Mobile settings UI for labels.
- Backfilling historical cluster summaries.

## Open questions

- None. Setup is opt-in per label; singleton clusters fall back to per-group; empty buffers skip; on-demand trigger with `labelId` is the manual test path.
