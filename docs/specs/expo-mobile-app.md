# Helm — Expo Native Mobile App (Phase 1 MVP)

> **Slug:** `expo-mobile-app`
> **Status:** Approved
> **Last Updated:** 2026-06-29
> **Working brand:** **Helm** (הגה) — see Branding section

## Goal

Replace the phone experience of “Add to Home screen” PWA with a **real Android native app** (Expo / React Native) for the Galaxy Fold 7. The app connects to the existing Mac-hosted backend (Next.js + agents + WhatsApp bridge) over HTTPS (Cloudflare Tunnel). Native **FCM push** delivers Hugo replies, FOMO, cron briefs, and agent completions reliably. Phase 1 delivers chat-with-Hugo + auth + notifications + installable APK.

## Branding

| Field | Value |
|-------|--------|
| **App name (stores / launcher)** | Helm |
| **Hebrew tagline** | הגה — העוזר האישי שלך |
| **Internal slug** | `helm` |
| **Package ID** | `com.alpir.helm` |
| **Alternatives considered** | Pulse (דופק), Orbit, Cortex, Sigil — see user-facing note in PM reply |

Replaces user-facing “My Space” / “AK System” on mobile only. Web app title may stay as-is until a separate rebrand spec.

## User Stories

- As the owner, I want a **native Android app** (APK) on my Fold 7 so it feels like a real assistant, not a browser tab.
- As the owner, I want to **chat with Hugo** from the app the same way I do on WhatsApp/web.
- As the owner, I want **OS push notifications** (FCM) for FOMO, briefs, reminders, and agent replies.
- As the owner, I want to **sign in with Google** so only I can access my data.
- As the owner, I want the layout to work **folded and unfolded** on Fold 7.

## Acceptance Criteria

- [ ] New Expo app at `apps/mobile` builds and runs on Android (dev client or APK).
- [ ] App displays branded name **Helm** and dark RTL chat UI.
- [ ] Google sign-in works against production/tunnel backend with `ALLOWED_EMAILS` enforcement.
- [ ] Chat screen sends messages to `POST /api/chat` and loads history from `GET /api/chat/history`.
- [ ] Expo push token registered via new tRPC procedure; backend fan-out sends FCM/Expo push in addition to Web Push + WhatsApp.
- [ ] Tapping a notification opens the chat screen (deep link).
- [ ] Documented flow: `eas build` or local APK install on Fold 7.
- [ ] Fold 7: usable on cover (~380px) and inner (~900px) widths.

## Data Model

Extend `push_subscriptions` (both `schema.ts` and `schema.pg.ts`):

| Column | Type | Notes |
|--------|------|--------|
| `platform` | `text` NOT NULL DEFAULT `'web'` | `'web'` \| `'expo'` |
| `expo_push_token` | `text` nullable | Expo push token when `platform='expo'` |

For Expo rows: `endpoint` stores a synthetic key `expo:<token>`; `p256dh`/`auth` nullable or empty placeholders (or separate table in Phase 2 — Phase 1 uses extended table for minimal diff).

**Alternative (preferred if cleaner):** new table `expo_push_tokens` (`id`, `token` UNIQUE, `created_at`). PM chooses at implementation — **prefer new table** to avoid breaking web-push row shape.

### New table (preferred)

```typescript
expoPushTokens = sqliteTable('expo_push_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull(),
})
```

Parity in `schema.pg.ts`.

## tRPC API

Extend `push` router (`packages/api/src/routers/push.ts`):

| Procedure | Input | Return | Auth |
|-----------|-------|--------|------|
| `push.registerExpoToken` | `{ token: z.string().min(1) }` | `{ id: string }` | `protectedProcedure` |
| `push.unregisterExpoToken` | `{ token: z.string() }` | `{ ok: true }` | `protectedProcedure` |

Backend helper `sendExpoPush(title, body, data?)` in `apps/web/src/lib/expo-push.ts` using Expo Push API (`EXPO_ACCESS_TOKEN` env optional for enhanced rate limits).

Update fan-out in `push-notifications.ts`, `agent-notifications.ts`, `whatsapp-bot.ts`, group-alert/summary routes to call `sendExpoPush` alongside existing channels.

## REST / Auth (mobile client)

Mobile uses existing REST where simpler than tRPC:

- `POST /api/chat`, `GET /api/chat/history`
- NextAuth session: **Phase 1** — cookie session via `expo-auth-session` + WebBrowser OAuth flow to `/api/auth/signin/google`, session cookie stored and sent on API requests (`credentials: 'include'` or token exchange if needed).

If cookie auth proves fragile on RN, **Phase 1 fallback:** short-lived API token endpoint (out of scope unless blocked — document in Open Questions).

**Env (mobile):** `EXPO_PUBLIC_API_URL=https://<tunnel-domain>`

## UI Surface

| Screen | Route (expo-router) | Notes |
|--------|---------------------|--------|
| Sign-in | `/` or `/login` | Google OAuth |
| Chat (Hugo) | `/chat` | Default after login; Hebrew RTL |
| Settings | `/settings` | Notification permission, sign out, API URL display |

**Design:** dark `#0f0f0f`, gold accent `#e8c547`, Heebo or system Hebrew font. Fold: single column cover; inner width uses max content width + optional side padding.

## Out of Scope (Phase 1)

- iOS build
- Play Store submission
- Full CRM/calendar/tasks screens (web only for now)
- Agents list screen (Phase 2)
- Removing PWA or web app
- Rewriting Hugo/agent logic

## Open Questions

- Final brand name user confirmation (working title: **Helm**).
- Cookie-based NextAuth on RN vs dedicated mobile JWT endpoint.
- EAS project under personal Expo account vs local `expo run:android` only.

## Implementation Notes

- Monorepo: add `apps/mobile` to `pnpm-workspace.yaml`; Expo manages its own deps (may use npm inside app or pnpm if compatible).
- Backend stays on Mac; `pnpm serve` + tunnel required for phone use.
- Reuse fan-out architecture from `docs/specs/mobile-app-notifications.md`.
