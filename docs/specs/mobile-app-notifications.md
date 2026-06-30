# Mobile App as Primary Interface + Cross-Channel Push Notifications

> **Slug:** `mobile-app-notifications`
> **Status:** Approved
> **Last Updated:** 2026-06-29

## Goal

WhatsApp "Message Yourself" does not produce reliable OS notifications (the bot sends to the same self-chat). Turn the existing PWA into the primary interface the user talks to on their phone (Galaxy Fold 7), and route every notification source through the already-built Web Push infrastructure so real OS notifications arrive on the device. WhatsApp stays active in parallel (mirror, not replaced). Access is via a Cloudflare Tunnel over HTTPS with Google sign-in re-enabled.

## User Stories

- As the owner, I want every system alert (FOMO, morning brief, task reminders, agent completions, Hugo replies) to arrive as an OS push notification on my phone so I stop missing them.
- As the owner, I want to open the installed PWA and talk to Hugo/the system from `/chat`, like I do today on WhatsApp.
- As the owner, I want WhatsApp to keep receiving the same messages in parallel so I do not lose it.
- As the owner, I want the app to look right both when the Fold 7 is closed (cover screen) and open (tablet mode).
- As the owner, I want only me to be able to access the app once it is reachable from the internet.

## Acceptance Criteria

- [ ] A single `notify()` fan-out helper sends to Web Push + WhatsApp + Telegram + persists to `chat_messages`.
- [ ] `pushAssistantMessage` (all cron jobs) also sends Web Push.
- [ ] `notifyAgentRunComplete` sends Web Push for every channel (not only `web`).
- [ ] Hugo's WhatsApp reply is mirrored to Web Push (deep link `/chat`).
- [ ] FOMO/keyword group alerts and group summaries send Web Push.
- [ ] Push deep links open the right screen: chat -> `/chat`, agent -> `/agents?agent=...`, FOMO -> `/settings/whatsapp`.
- [ ] Google sign-in is enforced in production; only the owner's email is allowed.
- [ ] Webhook/cron/auth API routes (`/api/auth`, `/api/whatsapp`, `/api/telegram`, `/api/cron`) and static SW/manifest/icons bypass the auth redirect.
- [ ] `/settings` has an "Enable notifications" + "Send test notification" control with granted/denied state.
- [ ] `/chat` is the default landing surface on mobile and refreshes to show newly pushed messages.
- [ ] Layout works folded (single column + bottom nav) and unfolded (wide/tablet: persistent sidebar, two-column chat, message `max-w`).
- [ ] A Cloudflare Tunnel exposes the production web app over HTTPS; a run script starts web (prod) + bridge + tunnel; VAPID keys documented.

## Data Model

No schema changes. The `push_subscriptions` table already exists in `packages/database/src/schema.ts` and `schema.pg.ts`. The notification record is the existing `chat_messages` row written by the fan-out path.

## tRPC API

No new procedures required. Existing `push` router (`packages/api/src/routers/push.ts`) is reused:
- `push.getVapidPublicKey` (query)
- `push.subscribe` / `push.unsubscribe` (mutation)
- `push.sendToAll` (mutation) — used by the "Send test notification" button.

All remain `protectedProcedure`.

## UI Surface

- `apps/web/src/app/settings/page.tsx` — notifications card: enable + test button, permission state (granted/denied/default), using `.btn`/`.card`.
- `apps/web/src/app/chat/page.tsx` + `ChatPanel` — default mobile surface; light polling to surface pushed messages; responsive folded/unfolded layout.
- Fold 7: Tailwind breakpoints only (no experimental viewport-segments API). Folded = one column + existing bottom nav; unfolded (`md:`/`lg:`) = persistent sidebar + two-column where applicable; `max-w` on message bubbles. RTL and focus-visible/loading/empty states preserved in both.

## Implementation Notes (non-binding)

- New shared module `apps/web/src/lib/web-push.ts` extracted from `agent-notifications.ts` `sendBrowserPush`.
- Fan-out wired in `apps/web/src/lib/push-notifications.ts`, `agent-notifications.ts`, `whatsapp-bot.ts`, `app/api/whatsapp/group-alert/route.ts`, `app/api/whatsapp/group-summary/route.ts`.
- Auth: `apps/web/src/middleware.ts` (enforce in prod with bypasses) + `apps/web/src/lib/auth.ts` (`signIn` email allowlist via `ALLOWED_EMAILS`).
- Service worker (Serwist) is disabled in dev, so push requires a production build (`pnpm build` + `next start`). Run script + Cloudflare Tunnel in `scripts/`.

## Out of Scope

- Migrating DB / WhatsApp bridge to the cloud (stays on the local Mac behind the tunnel).
- A separate in-app notification center (the `chat_messages` timeline in `/chat` serves this).
- Removing WhatsApp (kept active in parallel).
- Native Android app (PWA only).
