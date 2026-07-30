# Helm APK with working Android push

> **Slug:** `helm-apk-push-fix`
> **Status:** Approved (user request: build APK + fix phone notifications)
> **Last Updated:** 2026-07-13

## Goal

Ship a Helm Android APK that can receive real push banners on the phone. Root cause of current failure: EAS project `@alpir/helm` has **no FCM V1 service account** (`googleServiceAccountKeyForFcmV1: null`). Without FCM, Expo accepts send tickets but the device never shows a notification.

## User Stories

- As the owner, I want a downloadable APK pointed at the live HTTPS backend so I can install Helm on my phone.
- As the owner, I want push (chat/agent alerts) to show as Android banners after I enable notifications in-app.

## Acceptance Criteria

- [ ] EAS Android credentials for `com.alpir.helm` have a non-null FCM V1 service account key before build.
- [ ] `apps/mobile/.env` baked into the build has HTTPS `EXPO_PUBLIC_API_URL` (live tunnel/production), Web + Android Google client IDs.
- [ ] `sendExpoPush` includes Android `channelId: 'default'` matching the channel created in `notifications.ts`.
- [ ] Build scripts refuse to run (or warn hard) when FCM V1 is missing.
- [ ] `pnpm mobile:apk` / production APK script starts EAS preview APK build successfully.
- [ ] After install: Settings → enable push → token shown → test send reports `expoSent >= 1` **and** a banner appears.

## Data Model

None.

## tRPC API

None. REST `sendExpoPush` payload shape change only (`channelId`, clearer ticket error logging).

## UI Surface

No new screens. Existing Helm Settings push controls.

## Out of Scope

- iOS / APNs
- Switching backend off Cloudflare tunnel to Railway (unless user provides a new stable URL)
- Creating the Firebase project automatically (requires Google Console login by the user)

## Open Questions

- User must provide Firebase service account JSON (and ideally `google-services.json` for package `com.alpir.helm`) — cannot be synthesized in-repo.
