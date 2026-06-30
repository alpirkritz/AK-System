# In-App Notification Center

> **Slug:** `notification-center`
> **Status:** Approved
> **Last Updated:** 2026-06-30

## Goal

Add a dedicated in-app notification center (bell icon, unread badge, list, mark-as-read) on web and Helm mobile, alongside existing OS push (Web Push + Expo). Every fan-out event persists a `notifications` row so users can open and review alerts from the UI, not only from OS push taps or the chat timeline.

## User Stories

- As the owner, I want a bell icon with an unread badge so I can see at a glance if I missed alerts.
- As the owner, I want to open a notification list in the app (web + Helm) and tap an item to navigate to the relevant screen.
- As the owner, I want to mark notifications as read individually or all at once.
- As the owner, I want OS push test to reach both PWA and Helm from settings.

## Acceptance Criteria

- [ ] `notifications` table exists in `schema.ts` and `schema.pg.ts` with migration in `index.ts`.
- [ ] `createNotification()` helper is called from all fan-out paths (cron, agents, Hugo, FOMO, group summary).
- [ ] tRPC `notifications` router: `list`, `unreadCount`, `markRead` (protected).
- [ ] Web: bell + badge in `DashboardLayout`; `/notifications` page with list, mark read, mark all read.
- [ ] Helm: `/notifications` screen; bell in chat header with badge; REST endpoints for list/count/mark (Bearer JWT).
- [ ] `push.sendToAll` and `POST /api/push/test` send Web Push + Expo Push.
- [ ] Helm settings: permission status on load + "send test" button.
- [ ] Vitest tests for `notifications` router; E2E smoke for bell and list on web.
- [ ] Mobile push tap navigates to target URL when possible, else `/notifications`.

## Data Model

New table `notifications` in both schemas:

| Column | Type | Notes |
|--------|------|--------|
| `id` | text PK | UUID |
| `title` | text NOT NULL | Short title |
| `body` | text NOT NULL | Excerpt |
| `url` | text NOT NULL | Deep link path |
| `type` | text NOT NULL | `cron` \| `agent` \| `fomo` \| `hugo` \| `system` |
| `readAt` | text nullable | null = unread |
| `createdAt` | text NOT NULL | ISO timestamp |

Index on `readAt` + `createdAt` for unread queries.

## tRPC API

New router `notifications` in `packages/api/src/routers/notifications.ts`:

| Procedure | Input | Return | Auth |
|-----------|-------|--------|------|
| `list` | `{ limit?: number }` default 50 | `Notification[]` | protected |
| `unreadCount` | — | `{ count: number }` | protected |
| `markRead` | `{ id?: string; all?: boolean }` | `{ updated: number }` | protected |

Extend `push.sendToAll` return: `{ webSent, expoSent, removed }`.

## UI Surface

### Web

- `apps/web/src/components/NotificationBell.tsx` — bell + badge, links to `/notifications`
- `apps/web/src/components/DashboardLayout.tsx` — mount bell in header area
- `apps/web/src/app/notifications/page.tsx` — full list, RTL, `.card`/`.btn` classes

### Helm

- `apps/mobile/app/notifications.tsx` — FlatList, RTL dark theme
- `apps/mobile/app/chat.tsx` — header bell with badge
- `apps/mobile/lib/api.ts` — REST helpers for notifications + test push
- `apps/web/src/app/api/notifications/route.ts` — GET list, PATCH mark read (Bearer)
- `apps/web/src/app/api/push/test/route.ts` — POST test push (Bearer)

## Out of Scope

- Per-user notification scoping (single-owner system)
- Push notification history sync from OS tray
- Agents screen in Helm (deep links to chat or open web URL for agents)

## Open Questions

- None — approved for implementation.
