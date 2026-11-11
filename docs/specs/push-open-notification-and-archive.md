# Push notification tap opens notification detail + archive action on popup

> **Slug:** `push-open-notification-and-archive`
> **Status:** Draft
> **Last Updated:** 2026-09-17

## Goal

When the user taps an OS push notification (FCM popup) on the ARO mobile app, open the notification detail view inside the notifications screen rather than navigating to an arbitrary screen based on URL mapping. Add an archive button to the OS popup so the user can dismiss the notification without navigating anywhere.

## User Stories

- As a user, when I tap an OS push notification on my phone, I want the notification detail modal to open inside `/notifications`, so I can read the full message and then decide where to go next (via "עבור ליעד") rather than being thrown to a random screen.
- As a user, when I receive an OS push notification, I want an "ארכיון" button directly on the popup, so I can archive the notification without opening the app at all.
- As a user on PWA (web), when I tap an OS push notification, I want the same behavior: notification detail opens at `/notifications?id=`, and I have an archive action on the notification itself.
- As a user, when I open the ARO app without tapping a notification, I do not want the last notification I tapped yesterday to open again — I want the app to open normally.

## Acceptance Criteria

### Notification payload includes notification ID

- **Given** the server creates a notification via `createNotification`
  - **When** it sends a push notification via `sendMobilePush` or `sendBrowserPush`
  - **Then** the FCM/Web Push `data` payload includes `notificationId` (the DB row ID), `title`, `body`, `url`, and `categoryId: 'inbox'`

- **Given** `sendMobilePush` is called
  - **When** sending to FCM
  - **Then** the payload is data-only (no top-level `notification` object), with `android.priority: 'high'`, and all notification fields inside `data` as strings

### OS notification tap opens notification detail

- **Given** the user receives an OS push notification on ARO
  - **When** they tap the notification body (default action)
  - **Then** the app navigates to `/notifications?id=<notificationId>`
  - **And** the notification detail modal opens automatically
  - **And** the notification is marked as read

- **Given** the notification is not in the current list (older than the limit)
  - **When** the detail view opens
  - **Then** the app fetches the notification by ID via `GET /api/notifications?id=<id>`
  - **And** displays it in the modal

- **Given** the user tapped a notification yesterday
  - **When** they open the app today without tapping a new notification
  - **Then** the app opens to the home screen, not the old notification detail
  - **And** `getLastNotificationResponseAsync` is consumed once and ignored on subsequent launches

- **Given** the user taps a PWA web push notification
  - **When** the notification click fires
  - **Then** the browser opens `/notifications?id=<notificationId>` on web
  - **And** the notification detail modal opens if the ID is valid

### Archive action on OS popup

- **Given** the user receives an OS push notification on ARO
  - **When** they long-press or expand the notification
  - **Then** an "ארכיון" button appears

- **Given** the user taps the "ארכיון" button
  - **When** the archive action runs (even if the app is killed)
  - **Then** the notification is archived via `PATCH /api/notifications` with `action: 'archive'`
  - **And** the OS notification is dismissed
  - **And** the app does not open

- **Given** the user taps the "ארכיון" button on a PWA notification
  - **When** the service worker handles the action
  - **Then** it archives via tRPC `notifications.archive` (if session exists)
  - **And** dismisses the notification
  - **Or** opens `/notifications` if no session (cannot archive without auth)

### Notification routing no longer uses URL mapping for OS taps

- **Given** a notification with `url: '/settings/whatsapp'` is sent
  - **When** the user taps the OS popup
  - **Then** the app opens `/notifications?id=<id>` (not `/more` tab)
  - **And** "עבור ליעד" inside the detail modal still uses the URL mapping to open WhatsApp settings

- **Given** a notification with `url: '/agents?agent=...'` is sent
  - **When** the user taps the OS popup
  - **Then** the app opens `/notifications?id=<id>` (not agents list)
  - **And** "עבור ליעד" preserves the agent query param

## Data Model

No schema changes. The `notifications` table in `packages/database/src/schema.ts` and `schema.pg.ts` already has all required fields: `id` (primary key), `title`, `body`, `url`, `type`, `readAt`, `archivedAt`, `createdAt`.

## tRPC API

Router: `packages/api/src/routers/notifications.ts` (existing, protected).

### Changes to existing procedures

No signature changes to existing procedures. Internal behavior changes only.

### New shared helper in notification creation flow

`createNotification` (in `packages/api/src/lib/notification-store.ts`) already returns `Promise<string>` (the notification ID). Callers must now capture and forward this ID to push functions.

## UI Surface

### Backend — Push notification payload

**File:** `packages/api/src/lib/mobile-push.ts`

- Change `sendMobilePush` signature to:
  ```ts
  export async function sendMobilePush(
    title: string,
    body: string,
    url = '/chat',
    extras?: { notificationId?: string }
  ): Promise<number>
  ```
- Change FCM payload to **data-only** (remove top-level `notification: { title, body }`):
  ```ts
  {
    tokens,
    data: {
      notificationId: extras?.notificationId ?? '',
      title,
      body: body.slice(0, 240),
      url,
      categoryId: 'inbox',
    },
    android: {
      priority: 'high',
      notification: { channelId: 'default', sound: 'default' },
    },
  }
  ```

**File:** `apps/web/src/lib/web-push.ts`

- Change `sendBrowserPush` signature similarly:
  ```ts
  export async function sendBrowserPush(
    title: string,
    body: string,
    url = '/chat',
    extras?: { notificationId?: string }
  ): Promise<number>
  ```
- Add `notificationId` to payload `data`:
  ```ts
  const payload = JSON.stringify({
    notificationId: extras?.notificationId ?? '',
    title,
    body,
    url,
    icon: '/icons/icon-192.png',
  })
  ```

**File:** `apps/web/src/lib/push-notifications.ts`, `apps/web/src/lib/agent-notifications.ts`, `apps/web/src/app/api/whatsapp/group-alert/route.ts`, `apps/web/src/app/api/whatsapp/group-summary/route.ts`, `apps/web/src/app/api/whatsapp/group-cluster-summary/route.ts`, `packages/api/src/services/whatsapp-cluster-run.ts`, `apps/web/src/lib/whatsapp-bot.ts`, `apps/web/src/app/api/push/test/route.ts`

- All callers of `createNotification` + `sendMobilePush`/`sendBrowserPush` must capture the notification ID and pass it:
  ```ts
  const notificationId = await createNotification({ title, body, url, type })
  await sendMobilePush(title, pushBody, url, { notificationId })
  await sendBrowserPush(title, pushBody, url, { notificationId })
  ```

### Mobile — Notification category registration

**File:** `apps/mobile/lib/notifications.ts`

- Register `inbox` category with an archive action on app startup:
  ```ts
  await Notifications.setNotificationCategoryAsync('inbox', [
    {
      identifier: 'archive',
      buttonTitle: 'ארכיון',
      options: { opensAppToForeground: false },
    },
  ])
  ```

- Add `expo-task-manager` to `package.json` dependencies (if not already present)
- Register a background task to handle archive action when app is killed:
  ```ts
  import * as TaskManager from 'expo-task-manager'

  const NOTIFICATION_TASK = 'NOTIFICATION_RESPONSE_TASK'

  TaskManager.defineTask(NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('[notification-task]', error)
      return
    }
    const { actionIdentifier, notification } = data as {
      actionIdentifier: string
      notification: { request: { content: { data: { notificationId?: string } } } }
    }
    if (actionIdentifier === 'archive') {
      const id = notification.request.content.data?.notificationId
      if (id) {
        const token = await storage.getItem('helm_access_token')
        if (token) {
          await archiveNotificationInBackground(token, id)
          await Notifications.dismissNotificationAsync(notification.request.identifier)
        }
      }
    }
  })

  await Notifications.registerTaskAsync(NOTIFICATION_TASK)
  ```

- Add `archiveNotificationInBackground` helper that calls `PATCH /api/notifications` with `action: 'archive'`

**File:** `apps/mobile/app/_layout.tsx`

- Change `navigateFromNotificationUrl` to:
  - Check `actionIdentifier` — if it's `Notifications.DEFAULT_ACTION_IDENTIFIER` (regular tap), extract `notificationId` from `data` and navigate to `/notifications?id=<id>`
  - If no `notificationId`, navigate to `/notifications` (inbox)
  - Do NOT call `mobileRouteForNotificationUrl` for OS taps anymore

- Track consumed notification responses to prevent re-navigating on app restart:
  ```ts
  const [lastConsumedId, setLastConsumedId] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return
      const id = response.notification.request.identifier
      if (lastConsumedId === id) return // Already handled
      setLastConsumedId(id)
      const notifId = response.notification.request.content.data?.notificationId
      if (typeof notifId === 'string' && notifId) {
        router.push({ pathname: '/notifications', params: { id: notifId } })
      }
    })
    // ... existing response listener
  }, [token, router, lastConsumedId])
  ```

**File:** `apps/mobile/app/notifications.tsx`

- Read `id` param from `useLocalSearchParams<{ id?: string }>()`
- On mount, if `id` is present:
  - Search the loaded list for a notification with that ID
  - If found, call `onOpen(item)` to show the detail modal
  - If not found, fetch via `GET /api/notifications?id=<id>`, add to list, and open

### Mobile — REST endpoint for single notification fetch

**File:** `apps/web/src/app/api/notifications/route.ts`

- Extend `GET` handler to support `?id=<uuid>` query param:
  ```ts
  const id = request.nextUrl.searchParams.get('id')
  if (id) {
    const row = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1)
    if (!row[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ notification: row[0] })
  }
  // ... existing list logic
  ```

### Web — Service worker notification actions

**File:** `apps/web/src/sw.ts`

- Change `self.registration.showNotification` to include `actions`:
  ```ts
  await self.registration.showNotification(title, {
    body,
    icon,
    badge: '/icons/icon-192.png',
    dir: 'rtl',
    lang: 'he',
    tag: 'ak-push',
    renotify: true,
    data: { url, notificationId: data.notificationId },
    actions: [{ action: 'archive', title: 'ארכיון' }],
  })
  ```

- Add `notificationaction` listener:
  ```ts
  self.addEventListener('notificationaction', (event) => {
    event.notification.close()
    if (event.action === 'archive') {
      const notifId = event.notification.data?.notificationId
      if (notifId) {
        event.waitUntil(
          fetch('/api/trpc/notifications.archive', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notifId }),
          }).catch(() => {
            // If archive fails (no session), just open the notifications page
            self.clients.openWindow('/notifications')
          })
        )
      }
    }
  })
  ```

- Change `notificationclick` to use `notificationId` if present:
  ```ts
  const notifId = event.notification.data?.notificationId
  const url = notifId ? `/notifications?id=${notifId}` : (event.notification.data?.url ?? '/')
  ```

**File:** `apps/web/src/app/notifications/page.tsx`

- Read `id` from `useSearchParams()`
- On mount, if `id` is present and valid:
  - Find the notification in the loaded list
  - If found, call `setSelected(item)` to open the detail modal
  - If not found, fetch via `notificationsApi.getById.useQuery({ id })` and open

## Out of Scope

- Changing the behavior of "עבור ליעד" inside the detail modal (it still uses `mobileRouteForNotificationUrl` and navigates based on `url`)
- Adding category/filter options to the OS popup (single archive action only)
- iOS-specific customization (the category will register on iOS if the app is built there, but the primary device is Android)
- Removing `getLastNotificationResponseAsync` entirely (still used but consumed once)
- Refactoring `mobileRouteForNotificationUrl` (it stays for "עבור ליעד" inside the detail view)

## Open Questions

None. If FCM data-only notifications fail to display when the app is killed (a known Android/Expo edge case), we will fall back to a hybrid approach: keep the top-level `notification` object for display, but still include `data.notificationId`, and the archive action will only work when the app is running. The core navigation fix (OS tap → notification detail) does not depend on data-only mode.
