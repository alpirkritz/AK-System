# Mobile: quick-record widget + notification nav + repeat import

## Goal

1. **Quick-record widget** (Android home screen): one tap starts recording immediately — for unplanned hallway conversations. Context questions (who, project, meeting) come only after the recording stops, in the existing review step.
2. **Fix "עבור ליעד"** in the notification detail sheet — it often lands on the wrong screen or seems to do nothing.
3. **Import a second recording** without killing the app — the import screen stays stuck on "ההקלטה עלתה".

## User stories

- As Alpir, I tap the ARO widget on my home screen and the phone is recording within a second, with no forms first.
- As Alpir, I tap "עבור ליעד" on an agent/meeting notification and land on that agent chat / meeting.
- As Alpir, after importing one recording I tap "ייבא הקלטה נוספת" (or leave and come back) and can pick another file.

## Acceptance criteria

### Quick record
- A 1x1/2x1 Android widget "הקלטה מהירה" is available in the launcher's widget picker after installing a new build.
- Tapping it opens `helm://record?quick=1`; the record screen starts recording immediately (mic permission prompt only on first use).
- If a recording/review/upload is already in progress, the quick link does not start a second one.
- After stopping, the existing review step asks for participants/project/meeting, then upload — unchanged.
- Consent: the in-app recording screen already defaults consent to on; quick mode keeps the user's legal responsibility note visible during recording (unchanged copy).
- Works when the app is cold-started from the widget (after auth restore) and when it is already open.

### Notification navigation
- The "עבור ליעד" button forwards every mapped param (`message`, `agent`, `focus`), not only `message`.
- `/agents?agent=<id>` opens the chat with that agent (`/chat?agent=<id>`), matching the web behaviour; `/agents` without an id still opens the agents list.
- `/meetings/<id>` and `/meeting/<id>` open the meeting detail; `/tasks/<id>` opens task detail.
- Navigation runs after the detail Modal has closed, so the push isn't lost under a dismissing native modal.
- A tap on a push notification in the tray keeps opening the notification detail (unchanged).

### Import another recording
- The "done" state shows a "ייבא הקלטה נוספת" button that resets the screen to file-pick.
- Leaving the screen while in "done" resets it, so returning from the menu shows file-pick.

## Data model changes
None (`schema.pg.ts` / `schema.ts` untouched).

## tRPC API
None.

## UI surface
- `apps/mobile/widgets/QuickRecordWidget.tsx` (+ task handler, custom entry `index.ts`).
- `apps/mobile/app/(tabs)/record.tsx` — `quick` param auto-start.
- `apps/mobile/app/(tabs)/notifications.tsx`, `apps/mobile/lib/api.ts` — nav fix.
- `apps/mobile/app/(tabs)/import-recording.tsx` — reset.
- `apps/mobile/app.config.ts` — widget plugin.

## Out of scope
- iOS widget (needs a WidgetKit extension target).
- Recording directly from the widget without opening the app.
- Android share-sheet import routing.

## Open questions
- Requires a new native build (`pnpm mobile:build:apk`) — an OTA/JS update can't add a widget.
