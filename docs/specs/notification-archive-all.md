# Archive All Notifications

> **Slug:** `notification-archive-all`
> **Status:** Implemented
> **Last Updated:** 2026-08-06

## Goal

Today the notifications inbox (`/notifications`) only supports archiving one item at a time (swipe or per-row "ארכיון" button) plus a "סמן הכל כנקרא" (mark all as read) bulk action. There is no way to clear the whole inbox at once. This was explicitly out of scope for `notification-detail-swipe` ("bulk archive"). This spec adds a single **"העבר הכל לארכיון"** (archive all) action, with the same soft-archive + undo pattern already used for single-item archive, on both web and Helm (mobile) to preserve existing parity.

## User Stories

- As the owner, I want one button to archive every notification currently in my inbox, so I can clear it out without swiping/tapping each item individually.
- As the owner, I want to undo a bulk archive within a few seconds in case I hit the button by mistake.

## Acceptance Criteria

- [ ] Web `/notifications` shows an **"העבר הכל לארכיון"** button next to "סמן הכל כנקרא" whenever the (non-archived) list is non-empty.
- [ ] Clicking it archives every currently non-archived notification (sets `archivedAt` to the same batch timestamp), optimistically clears the list, and shows an undo toast: `"N הודעות הועברו לארכיון · בטל"` for 4s (same pattern/timing as single-item archive undo).
- [ ] Clicking "בטל" within the window restores exactly the notifications archived in that batch (matched by the shared batch timestamp), re-populating the list.
- [ ] No confirmation dialog — optimistic action + undo, consistent with existing single-archive UX decision in `notification-detail-swipe`.
- [ ] Archiving all does not touch already-archived notifications (idempotent no-op on rows already archived).
- [ ] `unreadCount` drops to 0 immediately after archive-all (archived notifications are excluded from unread count, same as today).
- [ ] Helm (`apps/mobile/app/notifications.tsx`) gets the same "העבר הכל לארכיון" button + undo toast for parity, calling the REST endpoint.
- [ ] Vitest covers: archiving all sets `archivedAt` on every previously non-archived row with one shared timestamp, returns the count, is idempotent when list is already empty, and undo restores exactly that batch.
- [ ] Playwright (web) covers: seed 2+ notifications → click archive-all → list becomes empty + undo toast shown → click "בטל" → both notifications reappear.
- [ ] Hebrew microcopy only; no raw error codes surfaced to the user (reuse existing error string "לא ניתן לעדכן את ההתראה. נסה שוב.").

## Data Model

No schema changes. Reuses the existing `archivedAt` (text, nullable) column on `notifications` in `packages/database/src/schema.ts` and `schema.pg.ts`. The batch archive sets the **same ISO timestamp** on every row archived in one call, which doubles as the undo-matching key (no new column needed).

## tRPC API

Router: `packages/api/src/routers/notifications.ts` (protected).

| Procedure | Input | Return | Behavior |
|-----------|-------|--------|----------|
| `archiveAll` (new) | `{ undo?: boolean; batchAt?: string }` | `{ archived: boolean; updated: number; batchAt?: string }` | Default (no `undo`): select all rows where `archivedAt IS NULL`, set `archivedAt = now` on each, return `{ archived: true, updated: n, batchAt: now }`. When `undo: true` and `batchAt` provided: select rows where `archivedAt = batchAt`, set `archivedAt = null` on each, return `{ archived: false, updated: n }`. |

Leave the existing `archive` procedure (single-id) unchanged.

### Helm REST — `apps/web/src/app/api/notifications/route.ts`

Extend the `PATCH` handler's `action` union: `'read' | 'archive' | 'unarchive' | 'archiveAll' | 'archiveAllUndo'`.

- `action: 'archiveAll'` → same batch-archive behavior as the tRPC procedure; response `{ archived: true, updated: n, batchAt }`.
- `action: 'archiveAllUndo'` with body `{ batchAt }` → restores that batch; response `{ archived: false, updated: n }`.

Add `archiveAllNotifications(token, opts?: { undo?: boolean; batchAt?: string })` helper in `apps/mobile/lib/api.ts` mirroring `archiveNotification`.

## UI Surface

### Web — `apps/web/src/app/notifications/page.tsx`

- In the header row (next to the existing conditional "סמן הכל כנקרא" button), add a second button `data-testid="archive-all"`, label **"העבר הכל לארכיון"**, visible whenever `items.length > 0`.
- On click: call `archiveAllMut.mutateAsync({})`, optimistically the list will empty via query invalidation, then show a bulk-undo toast (separate from the existing single-item `undoId` state, e.g. a `bulkUndo: { batchAt: string; count: number } | null` state) reading `"{count} הודעות הועברו לארכיון · בטל"`, auto-dismiss after 4s, same visual `.toast` component as today.
- "בטל" calls `archiveAllMut.mutateAsync({ undo: true, batchAt: bulkUndo.batchAt })` then invalidates the list/unread queries.
- Reuse the existing error string and `role="alert"` error paragraph on failure.

### Helm — `apps/mobile/app/notifications.tsx`

- Add the same button near the existing header area (or above the list), label **"העבר הכל לארכיון"**, shown when `items.length > 0`.
- Same optimistic-clear + undo-toast pattern as web, backed by the new REST actions and `archiveAllNotifications` helper.

### Microcopy (Hebrew)

| Context | Copy |
|---------|------|
| Button | העבר הכל לארכיון |
| Undo toast | `{N} הודעות הועברו לארכיון · בטל` |
| Error (reuse existing) | לא ניתן לעדכן את ההתראה. נסה שוב. |

## Out of Scope

- Filters (e.g. "archive all unread only" or "archive all older than X days") — this action always archives everything currently in the non-archived list.
- An archived-items browser/restore screen (still not part of this feature; only the immediate 4s undo).
- Confirmation dialog before bulk archive (deliberately using undo instead, consistent with existing single-archive UX).
- Changing `markRead`/`archive` (single) procedures.

## Open Questions

None — undo-via-shared-timestamp approach avoids needing a new schema column or confirmation-dialog UX debate. Proceeding with implementation.
