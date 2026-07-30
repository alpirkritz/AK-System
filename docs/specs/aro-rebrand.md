# ARO rebrand (user-facing)

> **Slug:** `aro-rebrand`
> **Status:** Approved
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-16

## Goal

Unify the user-facing product name to **ARO** across web and mobile. Today the product shows three different names (web: "My Space" / "AK System"; mobile: "Helm"). This spec replaces every user-visible occurrence with "ARO" while leaving internal identifiers untouched.

## User stories

- As the owner, I want the browser tab, PWA install name, and web sidebar to say "ARO" so the product has one consistent brand.
- As the owner, I want the mobile launcher name, login screen, and notification channel to say "ARO".
- As the owner, I want push notification titles and the assistant's self-description to say "ARO".
- As the owner, I want the app icons to reflect the ARO brand.

## Acceptance criteria

- Given I open the web app, When the tab loads, Then the title reads "ARO" (not "My Space – AK System").
- Given I install the PWA, When it appears on my home screen, Then the name is "ARO".
- Given I open the web sidebar and login page, When they render, Then the header reads "ARO".
- Given I open the mobile app, When the launcher shows the name, Then it reads "ARO" (display name only; package stays `com.alpir.helm`).
- Given I open the mobile login screen, When it renders, Then the title reads "ARO".
- Given a push notification arrives with no explicit title, When it shows, Then the fallback title is "ARO".
- Given the assistant describes itself, When it responds, Then it refers to "ARO" rather than "AK System".
- Given the Android notification channel is created, Then its name is "ARO".

## Data model

None.

## tRPC API

None. String and asset changes only.

## UI surface

Web (`apps/web/src`):
- `app/layout.tsx` — `metadata.title` and `appleWebApp.title` -> "ARO".
- `public/manifest.json` — `name` and `short_name` -> "ARO".
- `components/DashboardLayout.tsx` — sidebar header "My Space" -> "ARO".
- `app/login/page.tsx` — `<h1>` "My Space" -> "ARO".
- `sw.ts` — push fallback title -> "ARO".
- `lib/push-client.ts` — foreground fallback title -> "ARO".
- `lib/push-notifications.ts` — default title fallback -> "ARO".
- `app/settings/page.tsx` — test push title and "Helm" status label -> "ARO".
- `app/settings/notifications/page.tsx` — "פוש Helm (טלפון)" and Helm-app instructions -> "ARO".
- Assistant prompts: `lib/conversation-engine.ts`, `lib/gemini-agent-engine.ts`, `lib/cursor-agent-engine.ts`, `lib/service-session.ts` — "AK System" -> "ARO".

Mobile (`apps/mobile`):
- `app.config.ts` — `name: 'Helm'` -> `'ARO'`. Keep `slug`, `scheme`, `bundleIdentifier`, `package`, EAS `projectId`.
- `app/login.tsx` — title "Helm" -> "ARO"; tagline updated to drop the "הגה" wordplay.
- `lib/notifications.ts` — Android channel `name: 'Helm'` -> `'ARO'`.
- `lib/api.ts` — test push title `'Helm'` -> `'ARO'`.
- `app/settings.tsx` — status text "Helm" -> "ARO".

Assets (replace in place, same filenames/dimensions):
- Web: `apps/web/public/favicon.ico`, `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, plus in-app `aro-logo.png` (login + sidebar).
- Mobile: `apps/mobile/assets/icon.png`, `splash-icon.png`, `android-icon-foreground.png`, `android-icon-background.png`, `favicon.png`, plus login `aro-logo.png`.
- Source mark: user-provided Gemini ARO logo (3D "ARO" + PERSONAL SYSTEM), square-cropped for launchers.

## Out of scope

- Internal package names `@ak-system/*` and root `ak-system`.
- DB file `ak_system.sqlite`, deploy path `/opt/ak-system`, env var prefixes `AK_*`.
- API protocol header `x-ak-client` / `X-AK-Client` and client value `helm`.
- Mobile `bundleIdentifier` / `package` `com.alpir.helm`, `slug`/`scheme` `helm`, EAS project, Firebase project.
- SecureStore keys `helm_access_token` / `helm_user`.
- Internal code comments referencing "Helm app" (dev-only, not user-facing).
- Renaming the repo folder or scripts.

## Open questions

None.
