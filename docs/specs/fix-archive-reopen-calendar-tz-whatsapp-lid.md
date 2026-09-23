# Fix archive reopen, calendar UTC clocks, WhatsApp self-chat decrypt

**Slug:** `fix-archive-reopen-calendar-tz-whatsapp-lid`

## Goal

Stop the notifications sheet from closing and opening again after Archive, show Outlook-synced events in Israel time in יועץ יומן, and send WhatsApp self-chat messages to the phone's LID so the primary device can decrypt them.

## User stories

- As the owner, I want Archive to dismiss a notification once, so the sheet does not slide back up.
- As the owner, I want יועץ יומן to show חוג מדע ורפואה at 15:30–16:00, so a UTC `Z` timestamp is not printed as 12:30.
- As the owner, I want other events that already carry `+03:00` to stay on the same clock time.
- As the owner, I want bridge messages in Message Yourself to arrive decrypted on the phone, so they do not stay on "Waiting for this message".
- As the owner, I want this shipped by the existing EC2 deploy, without building a new APK.

## Acceptance criteria

- Given a notification opened from a push (`?id=`), when Archive succeeds, then the detail sheet stays closed and the row is not fetched back onto the list.
- Given `GET /api/notifications?id=` for a row with `archivedAt` set, then the response is 404.
- Given start `2026-09-23T12:30:00.000Z` and end `2026-09-23T13:00:00.000Z` with timezone `Asia/Jerusalem`, when the morning brief or calendar-optimizer prompt is formatted, then the text contains `15:30–16:00` and does not contain the clock `12:30`.
- Given a floating timestamp with no offset (`2026-07-20T09:30:00`), when formatted, then the clock stays `09:30`.
- Given the bridge knows the account LID, when `/send` targets the owner's phone JID, then the socket send goes to that `@lid` instead.
- Given an explicit `@lid` target, when sending, then it is not rewritten.

## Data model

No schema changes in `packages/database/src/schema.ts` or `schema.pg.ts`. `notifications.archived_at` already exists.

## tRPC API

No new procedures. Mobile archive uses `GET/PATCH /api/notifications` in `apps/web/src/app/api/notifications/route.ts`. `GET ?id=` returns 404 when `archivedAt` is set. List behavior is unchanged.

## UI surface

- `apps/mobile/app/notifications.tsx` — open a deep-linked notification once; do not re-run that open when the list changes; ignore an archived payload.
- `apps/web/src/app/notifications/page.tsx` — no visual change.
- Calendar copy is produced server-side (`morning-briefing-context`, calendar optimizer prompt, pre-meeting brief, daily summary). No new page.

## Out of scope

- Building or publishing a new Helm APK.
- Rewriting every existing Google event in place (the next Outlook sync update writes a zoned `dateTime`; display conversion covers events already stored as `Z`).
- Changing `markOnlineOnConnect`.
- Group send targets.

## Open questions

None.
