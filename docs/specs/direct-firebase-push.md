# Direct Firebase Push

> **Slug:** `direct-firebase-push`
> **Status:** Approved
> **Last Updated:** 2026-08-06

## Goal

Replace the Expo Push service with direct Firebase Cloud Messaging (FCM) delivery for the ARO Android app. The mobile app will register its native FCM device token with AK System, and the backend will send notifications directly through the Firebase Admin SDK. `expo-notifications` remains responsible for permission prompts, Android notification channels, foreground display, and notification-tap handling, but Expo's token and push gateway will no longer participate in delivery.

## User Stories

- As an ARO user, I want Android push notifications delivered directly through Firebase so that delivery does not depend on Expo Push tickets and receipts.
- As an administrator, I want the test-notification action to report direct FCM delivery results.
- As an operator, I want invalid device tokens removed automatically and Firebase failures recorded without exposing credentials or full tokens.
- As a developer, I want one provider-neutral push entry point so that all existing notification producers use the same direct-FCM implementation.

## Acceptance Criteria

- [ ] ARO obtains an Android native device token with `Notifications.getDevicePushTokenAsync()` and rejects unexpected non-string token values.
- [ ] Enabling push registers the native FCM token through authenticated `POST /api/push/fcm/register`; signing out unregisters it through authenticated `DELETE /api/push/fcm/register`.
- [ ] The backend initializes `firebase-admin` only from server-side environment variables and never sends Firebase credentials to either client.
- [ ] All current `sendExpoPush(...)` call sites send through a provider-neutral `sendMobilePush(...)` helper backed by Firebase Admin.
- [ ] Direct FCM sends include title, body, `data.url`, Android high priority, sound, and notification channel `default`.
- [ ] A notification tap continues to open the supplied in-app route, such as `/chat`.
- [ ] The Settings “שלח בדיקה” flow reports PWA and FCM/ARO counts and delivers an Android system notification.
- [ ] FCM responses are logged immediately in `push_delivery_log`; full device tokens are not returned to clients.
- [ ] FCM tokens rejected as unregistered are deleted automatically.
- [ ] Missing or invalid Firebase Admin credentials produce a clear server-side error and a failed delivery result rather than a false success count.
- [ ] Legacy Expo tokens are not treated as FCM tokens. Existing installations must re-register after installing the migrated build.
- [ ] The Expo Push gateway (`https://exp.host/--/api/v2/push/send`), Expo ticket creation, and delayed Expo receipt polling are no longer used.
- [ ] Unit tests cover successful multicast delivery, partial failures, dead-token pruning, missing credentials, payload mapping, and empty token sets.
- [ ] Mobile type checking, API tests, web lint, and web build pass.

## Data Model

Add a new `fcm_push_tokens` table in both `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`:

- `id`: text, primary key.
- `token`: text, required, unique.
- `platform`: text, required; initially `android`.
- `created_at`: text, required.
- `updated_at`: text, required.
- Unique index on `token`.

Export `fcmPushTokens` and its inferred select/insert types from `packages/database/src/index.ts`. Add the idempotent SQLite bootstrap `CREATE TABLE` and index statements there as well.

Extend `push_delivery_log` in both schemas:

- `provider`: text, required, default `expo` for compatibility with existing rows; new rows use `fcm`.
- `provider_message_id`: text, nullable; stores the Firebase message ID when available.

Keep the legacy `ticket_id` column and `expo_push_tokens` table temporarily so existing databases and historical logs remain readable. No new code writes Expo tokens or Expo tickets. Physical removal is deferred to a later cleanup migration.

## tRPC API

Extend `packages/api/src/routers/push.ts`:

- `push.registerFcmToken`
  - Auth: required.
  - Input: `{ token: z.string().min(1), platform: z.literal('android') }`.
  - Return: `{ id: string }`.
  - Behavior: insert or refresh `updatedAt` for the unique token.
- `push.unregisterFcmToken`
  - Auth: required.
  - Input: `{ token: z.string().min(1) }`.
  - Return: `{ ok: true }`.
- `push.sendToAll`
  - Preserve current authenticated input `{ title, body, url? }`.
  - Return `{ sent, removed, webSent, fcmSent }`; remove `expoSent` after all in-repository callers are migrated.
- `push.deliveryLog`
  - Include `provider` and `providerMessageId`.
  - Continue masking tokens to their final 12 characters.

Mobile authentication currently uses REST rather than the tRPC client, so add matching Next.js routes:

- `POST /api/push/fcm/register`
  - Bearer auth required.
  - Body: `{ token: string, platform: 'android' }`.
  - Return: `{ id: string }`.
- `DELETE /api/push/fcm/register`
  - Bearer auth required.
  - Body: `{ token: string }`.
  - Return: `{ ok: true }`.
- `POST /api/push/test`
  - Preserve Bearer auth and request body.
  - Return `{ webSent: number, fcmSent: number }`.

The legacy Expo registration route and tRPC registration procedures may remain as deprecated compatibility stubs for one release, but no current client may call them.

## UI Surface

- `apps/mobile/lib/notifications.ts`
  - Replace `getExpoPushToken()` with `getFcmPushToken()` using `Notifications.getDevicePushTokenAsync()`.
  - Preserve permission, Android channel, foreground display, and response-listener behavior.
- `apps/mobile/lib/api.ts`
  - Replace Expo registration helpers and endpoint names with FCM equivalents.
  - Update the test-push response type from `expoSent` to `fcmSent`.
- `apps/mobile/app/settings.tsx`
  - Register/unregister the FCM token.
  - Keep the existing Hebrew interaction flow.
  - Show `נשלח: X PWA + Y ARO (FCM)` after a test.
- `apps/web/src/app/settings/page.tsx`
  - Replace the Expo count label with the FCM/ARO count.
- `apps/web/src/app/settings/notifications/page.tsx`
  - Present delivery provider and direct Firebase status in the existing delivery log; remove copy that describes delayed Expo receipts.

No visual redesign is required. Existing RTL, dark-theme, disabled, busy, success, and error states must remain intact.

## Server and Deployment

- Add `firebase-admin` to `packages/api`.
- Add a server-only `packages/api/src/lib/mobile-push.ts` helper and export it for `apps/web`.
- Configure Firebase Admin from `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`; normalize escaped newlines in the private key.
- Document the variables in `.env.example`, `apps/web/.env.local.example`, `deploy/production.env.example`, and the EC2 deployment guide.
- Never commit a Firebase service-account JSON or private key.
- Remove the task-reminder cron dependency on `checkPendingExpoReceipts()` because direct FCM responses are immediate.

## Testing

- Replace `packages/api/src/lib/expo-push.test.ts` coverage with tests for the direct-FCM helper.
- Mock Firebase Admin; unit tests must not contact Firebase.
- Update API router and notification-producer mocks from `sendExpoPush` to `sendMobilePush`.
- Add route tests for authenticated registration, invalid payloads, duplicate-token refresh, unregister, and unauthorized access where the existing route-test setup permits.
- Update notification Settings E2E assertions from `expoSent`/Expo copy to `fcmSent`/FCM copy.
- Manual Android acceptance:
  1. Build and install a fresh APK containing `google-services.json`.
  2. Enable notifications and confirm an FCM token is registered.
  3. Tap “שלח בדיקה” and confirm `fcmSent >= 1`.
  4. Confirm a system banner appears in foreground and background.
  5. Tap the banner and confirm ARO opens `/chat`.

## Out of Scope

- Direct APNs delivery for iOS. This migration targets the currently deployed Android APK; iOS push requires a separate provider path and credentials.
- Firebase Authentication, Firestore, Analytics, Crashlytics, or Remote Config.
- Web Push migration; PWA notifications continue to use VAPID and `web-push`.
- Automatic conversion of Expo push tokens into FCM tokens, which is not technically possible.
- Physical deletion of legacy Expo tables or historical delivery-log columns.
- Notification topics, audience segmentation, scheduled Firebase campaigns, or Firebase Console message composition.
- UI redesign of notification settings.

## Open Questions

- Should direct iOS/APNs support be added in a follow-up before the legacy Expo implementation is physically deleted?
- After one release confirms all Android devices have re-registered, should a cleanup migration remove `expo_push_tokens`, `ticket_id`, and the old Expo registration endpoints?
