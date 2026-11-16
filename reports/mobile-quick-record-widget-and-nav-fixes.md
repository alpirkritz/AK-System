# Review: mobile-quick-record-widget-and-nav-fixes

**Verdict: APPROVED WITH NITS** (not yet run on a device)

## Checks
- `pnpm --filter @ak-system/mobile lint` (tsc --noEmit): pass
- Vitest `apps/mobile/lib/**`: 29/29 pass, including the new `notification-route.test.ts` (6 tests)
- Web build / Playwright: not run — no web or API code changed

## What changed
- `apps/mobile/lib/api.ts`: `/agents?agent=<id>` → `/chat?agent=<id>`; `/meetings/<id>` and `/meeting/<id>` → `meeting/[id]`; `/tasks/<id>` → `task/[id]`; new `notificationHref()` forwards every param.
- `apps/mobile/app/(tabs)/notifications.tsx`: "עבור ליעד" pushes the full href, 250ms after the Modal closes.
- `apps/mobile/app/(tabs)/import-recording.tsx`: "ייבא הקלטה נוספת" button; the screen resets on blur after a successful upload.
- `apps/mobile/app/(tabs)/record.tsx`: `quick=1` param starts recording immediately when the screen is idle.
- Widget: `widgets/QuickRecordWidget.tsx`, `widgets/widget-task-handler.tsx`, custom entry `index.ts` (`package.json` main), `react-native-android-widget@0.26.0` plugin in `app.config.ts`.

## Nits / follow-ups
- Needs a new native APK build; there's no OTA path for the widget.
- Verify on the device: cold start from the widget while logged in, and the 250ms modal-close delay on Android.
- No widget preview image (the launcher shows a generic preview).
