# Review — ARO rebrand + chat keyboard + push diagnosis

**Detected stack:** next-trpc-monorepo
**Specs:** `docs/specs/aro-rebrand.md`, `docs/specs/mobile-chat-keyboard.md`, `docs/specs/helm-apk-push-fix.md`
**QA:** `reports/qa-helm-push.md`
**Verdict:** APPROVED WITH NITS

## Static checks

- Mobile typecheck (`pnpm --filter @ak-system/mobile lint` = `tsc --noEmit`): PASS.
- Web build (`pnpm --filter @ak-system/web build`): PASS.
- Unit tests: PASS — API 146/146, web 31/31 (177 total). Includes `conversation-engine.whatsapp-summary` and `gemini-agent-engine` suites that cover edited prompt files.
- Web lint (`next lint`): not run — interactive ESLint setup prompt, pre-existing repo state, unrelated to this change.

## 1. ARO rebrand (user-facing)

Replaced every user-visible occurrence of "My Space" / "AK System" / "Helm" with "ARO"; internal identifiers untouched per spec.

Web (`apps/web/src`):
- `app/layout.tsx:29,36` — tab + Apple web-app title -> "ARO".
- `public/manifest.json` — `name`/`short_name` -> "ARO".
- `components/DashboardLayout.tsx:104`, `app/login/page.tsx:26` — headers -> "ARO".
- `sw.ts`, `lib/push-client.ts`, `lib/push-notifications.ts`, `app/api/push/test/route.ts:27` — push fallback titles -> "ARO".
- `app/settings/page.tsx`, `app/settings/notifications/page.tsx` — test title + "Helm" labels -> "ARO".
- Assistant prompts: `lib/conversation-engine.ts`, `lib/gemini-agent-engine.ts`, `lib/cursor-agent-engine.ts`, `lib/service-session.ts` — "AK System" -> "ARO".

Mobile (`apps/mobile`):
- `app.config.ts` — `name` -> "ARO" (slug/scheme/package/EAS unchanged).
- `app/login.tsx` — title "ARO", tagline "העוזר האישי שלך".
- `lib/notifications.ts` — Android channel name "ARO".
- `lib/api.ts`, `app/settings.tsx` — test title + status label "ARO".

WhatsApp linked-device (user-visible in WhatsApp -> Linked Devices):
- `apps/whatsapp-bridge/src/config.ts` + `.env.example` — `DEVICE_NAME` default -> "ARO".

Icons (regenerated from one master: teal ring + upward chevron on brand navy `#0e1626`):
- Web: `public/favicon.ico` (16/32/48 multi-size), `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`.
- Mobile: `assets/icon.png` (1024), `splash-icon.png` (1024), `android-icon-foreground.png` (512), `android-icon-background.png` (512), `favicon.png` (48).

Nit: `apps/mobile/assets/android-icon-monochrome.png` was left as the prior chevron silhouette (only affects Android themed-icon mode; the colored master is not a valid monochrome alpha silhouette). Acceptable; revisit if themed icons matter.

Out of scope confirmed untouched: `@ak-system/*`, `ak_system.sqlite`, `com.alpir.helm`, `slug`/`scheme` `helm`, `x-ak-client`, SecureStore keys, deploy paths.

## 2. Chat keyboard fix

- `app.config.ts` — `android.softwareKeyboardLayoutMode: 'resize'` (generates `adjustResize`).
- `app/(tabs)/_layout.tsx` — `tabBarHideOnKeyboard: true`.
- `app/(tabs)/chat.tsx` — `KeyboardAvoidingView behavior="padding"` both platforms; `keyboardVerticalOffset` now derived from `insets.top` (iOS) / `0` (Android) instead of a hardcoded 80; `FlatList` gets `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="interactive"`.

Manifest-level `resize` is baked at build time — verifiable only on a freshly built APK.

## 3. Push diagnosis + follow-up

QA verdict FAIL with a clear primary root cause: the live DB (this machine, fronted by the Cloudflare tunnel) has zero registered Expo tokens, so `sendExpoPush` returns 0 and nothing is ever sent. Secondary: ephemeral quick-tunnel URL baked into the installed APK; and `channelId`/`priority` must be present on whatever server is deployed.

Code done:
- `packages/api/src/lib/expo-push.ts` already sends `channelId: 'default'` + `priority: 'high'` and logs ticket errors (present in working tree; picked up by the running dev server).
- `app/(tabs)/chat.tsx` now surfaces a tappable "התראות לא פעילות / רישום נכשל" notice (-> Settings) instead of silently swallowing `syncPushToken` failures.

## Required manual verification (cannot be automated here)

1. Rebuild + install the ARO APK (`pnpm mobile:apk`) so the new name, icons, and `adjustResize` take effect.
2. On the phone: Settings -> "הפעל התראות Push" -> confirm token; re-check `SELECT count(*) FROM expo_push_tokens`.
3. Use a stable backend URL (not a rotating `trycloudflare.com` quick tunnel) baked into the APK.
4. Settings -> "שלח בדיקה" -> expect `expoSent >= 1` and an actual Android banner.
5. Commit `packages/api/src/lib/expo-push.ts` and `apps/mobile/google-services.json` so deploys carry the fix (left uncommitted per commit policy).
