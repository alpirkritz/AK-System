# People Page Sync Visibility & Default WhatsApp Capture

**Stack:** `next-trpc-monorepo`
**Slug:** `people-sync-visibility`
**Status:** Draft — awaiting approval
**Created:** 2026-09-30
**Depends on:** `notion-tasks-people-sync` (existing sync engine), `whatsapp-dm-capture` (existing opt-in capture flag)

---

## Goal

Close two visibility gaps reported on the People page: (1) there is no manual way to trigger a Notion sync from `/people` itself, so a newly-added Notion contact only appears after the next cron run (every 30 min) or a trip to `/tasks`; (2) a newly created person with a phone number does not get WhatsApp 1:1 capture enabled by default, so conversations with them are silently dropped until someone remembers to toggle capture on. Neither is a bug in the sync/capture engines themselves — both are missing defaults/entry points on top of already-implemented systems.

## User Stories

- As the owner, I want a "סנכרן מ-Notion" button on the People page, so I can pull in a newly-added Notion contact immediately instead of waiting for the next cron tick or navigating to Tasks.
- As the owner, I want to see how many people were created/updated by a sync I trigger from People, so I get confirmation the new contact actually came in.
- As the owner, I want a person I add with a phone number to have WhatsApp capture on automatically, so I don't lose the next conversation with them the way I lost this one.
- As the owner, I still want capture to be per-person and forward-only (no backfill), consistent with `whatsapp-dm-capture` — auto-enabling on creation is a default, not a bulk retroactive enable.

## Acceptance Criteria

### Notion sync button on People

- Given Notion is configured (`tasks.notionConfigured` returns `configured: true`), when I open `/people`, then I see a "סנכרן מ-Notion" button (same label/pattern as `/tasks`).
- Given Notion is not configured, when I open `/people`, then the button is hidden (mirrors `/tasks` behavior).
- Given I click the button, when the sync is in flight, then the button shows a pending state (`מסנכרן…`) and is disabled, matching `/tasks`.
- Given the sync completes, when the mutation resolves, then a toast/message shows `peopleCreated`/`peopleUpdated` counts (and errors, if any) — this reuses the existing `NotionTasksSyncResult` fields, which `/tasks` currently ignores.
- Given the sync completes successfully, when the result returns, then `people.list` (and `people.pendingReview` if applicable) query cache is invalidated so the new/updated people show up without a manual refresh.
- Given the sync fails (network/Notion API error), when the mutation errors, then a Hebrew error toast is shown and no crash occurs.

### Default WhatsApp capture on person creation

- Given I create a new person via the People page "הוסף איש קשר" flow with a phone number filled in, when the person is saved, then `captureWhatsapp` is set to `true` and `captureWhatsappSince` is set to the creation timestamp (same semantics as manually enabling capture today).
- Given I create a new person without a phone number, when the person is saved, then `captureWhatsapp` stays `false` (unchanged — nothing to capture against yet).
- Given capture was auto-enabled at creation, when the WhatsApp allowlist is next computed, then this person is included the same way as someone who toggled capture on manually (call the existing `pushDmAllowlist` path used by `people.update`).
- Given a person is later edited to add/remove a phone number via `people.update`, then existing `captureWhatsapp`/`captureWhatsappSince` behavior is unchanged (this spec only changes the **create** path's default, not update semantics).
- Out of scope for this spec: this default applies only to the manual "add person" flow (`people.create`). People created via Notion sync, Google Contacts import, or calendar-attendee auto-creation do not currently capture a phone at creation time at all, so auto-enable does not apply to those paths yet — a future spec would need to add phone capture to those paths first.
- This is explicitly a **forward-only default at creation time**, not a backfill and not a bulk enable for existing people — consistent with `whatsapp-dm-capture`'s "must be opt-in, no retroactive backfill" constraints. The person can still be found via People > edit and have capture toggled off if unwanted.

## Data Model

No schema changes. Both features use existing columns:
- `people.phone` (text, nullable) — `packages/database/src/schema.pg.ts:54` / `schema.ts:56`
- `people.captureWhatsapp` (boolean, default false) — `schema.pg.ts:69` / `schema.ts:75`
- `people.captureWhatsappSince` (text/ISO, nullable) — `schema.pg.ts:71` / `schema.ts:77`

## tRPC API Shape

- No new procedures needed for the sync button — reuse existing `tasks.notionConfigured` (query) and `tasks.syncFromNotion` (mutation, `packages/api/src/routers/tasks.ts:421-438`), called from the People page the same way `/tasks/page.tsx` already does.
- `people.create` (`packages/api/src/routers/people.ts:39-55` input, insert logic `~561-585`): no input shape change required. Insert logic gains:
  ```ts
  const capturesWhatsapp = !!input.phone
  // ...insert values:
  captureWhatsapp: capturesWhatsapp,
  captureWhatsappSince: capturesWhatsapp ? createdAt : null,
  ```
  followed by a call to `pushDmAllowlist(ctx.db)` (imported from `packages/api/src/services/whatsapp-dm.ts`) when `capturesWhatsapp` is true, mirroring what `people.update` already does when the allowlist changes.

## UI Surface

- `apps/web/src/app/people/page.tsx`: add `trpc.tasks.notionConfigured.useQuery()` + `trpc.tasks.syncFromNotion.useMutation()` (same imports/hooks as `apps/web/src/app/tasks/page.tsx:51,65-77`), invalidating `people.list` (and `people.pendingReview` if it exists) `onSuccess`.
- Button placement: in the tabs/actions row (`apps/web/src/app/people/page.tsx:52-80`) alongside the existing "טלפונים מגוגל" button, or inside `PeopleTopBar.tsx` next to "+ הוסף איש קשר" — UI Designer Agent to confirm final placement/spacing per RTL + `.btn` classes.
- No new UI for the WhatsApp default — it's silent at creation time. The existing person edit view already surfaces the `captureWhatsapp` toggle, so the user can see/change the auto-set state after the fact.

## Out of Scope

- Backfilling the WhatsApp conversation that prompted this request (unrecoverable — bridge doesn't retain history and capture wasn't enabled at the time).
- Extending phone capture / auto-enable to Notion sync, Google Contacts import, or calendar-attendee person creation paths.
- Changing the cron cadence (still every 30 min) or making Notion sync incremental for people (still a full scan every run).
- A `workspaceNotionDatabases`-style per-workspace scoping for people databases (people sync remains workspace-agnostic, pulling from every configured people DB — unchanged by this spec).

## Open Questions

- Should the People sync button also be visible when Notion is configured but no people databases are set up (i.e., only task DBs configured)? Proposed: yes, keep it tied to `tasks.notionConfigured` for consistency with `/tasks`, since the same mutation is doing both.
- Should auto-enabling capture on creation show a small inline confirmation (e.g., "לכידת וואטסאפ הופעלה אוטומטית") rather than being fully silent? Proposed default: silent, matching how it's a background default rather than a user action — revisit if it causes confusion.
