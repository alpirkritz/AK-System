# Notification Body — Store Full Text

**Detected stack:** `next-trpc-monorepo`

## Goal

Stop truncating notification bodies at write time. The in-app notification center must store and display the complete agent/cron output; the 240-character excerpt should apply only to the OS-level push payload, where the operating system enforces a short body anyway.

## Background — why the previous CSS fix was not enough

`docs/specs/notification-body-truncation-fix.md` removed `line-clamp-2` (web) and `numberOfLines={2}` (mobile). Those only governed the list preview. The detail modal still showed a body ending in `…` because the persisted `notifications.body` row itself is only 240 characters.

Five call sites truncate before persisting:

| File | Line | Truncation |
|---|---|---|
| `apps/web/src/lib/push-notifications.ts` | 49 | `excerpt(text)` |
| `apps/web/src/lib/agent-notifications.ts` | 34, 67 | `excerpt(options.summary)` |
| `apps/web/src/app/api/whatsapp/group-summary/route.ts` | 46 | `summary.slice(0, 240)` |
| `apps/web/src/app/api/whatsapp/group-alert/route.ts` | 76 | `text.slice(0, 240)` |
| `apps/web/src/lib/whatsapp-bot.ts` | 178 | `pushExcerpt(result.text)` |

`excerpt` / `pushExcerpt` also collapse whitespace via `replace(/\s+/g, ' ')`, which destroys the newlines in agent markdown output. That is why the stored body renders as one run-on paragraph with inline `##` and `*` markers.

Neither the schema nor the read path constrains length: `notifications.body` is `text` in both `packages/database/src/schema.pg.ts:490` and `schema.ts:611`, and `notificationsRouter.list` plus `GET /api/notifications` both return whole rows.

## User stories

- As a user opening a notification, I want the agent's complete output so I do not have to open the chat to read the rest.
- As a user reading a pre-meeting brief, I want the original line breaks and bullet structure preserved, not flattened into one paragraph.
- As a user on the phone, I want the OS banner to stay short while the in-app detail holds the full text.
- As an operator, I want a sane upper bound on the stored body so a runaway agent response cannot bloat a row without limit.

## Acceptance criteria

- **Given** an agent produces output longer than 240 characters
  - **When** the notification is persisted
  - **Then** `notifications.body` contains the full text and does not end with `…`

- **Given** agent output containing newlines and markdown bullets
  - **When** the notification is persisted and opened in the detail modal
  - **Then** the original line breaks are preserved (whitespace is not collapsed)

- **Given** the same notification
  - **When** the OS push payload is sent via `sendBrowserPush` / `sendMobilePush`
  - **Then** the payload body remains the ~240-character excerpt with `…`

- **Given** an agent output exceeding the storage cap
  - **When** the notification is persisted
  - **Then** the body is capped at `MAX_NOTIFICATION_BODY` characters and suffixed with `…`

- **Given** an existing notification row created before this change
  - **When** it is opened
  - **Then** it still renders without error (already-truncated rows are not retroactively repaired)

## Data model

No schema change. `notifications.body` is already unbounded `text` in both schema files.

## tRPC API

No procedure signature changes. `notificationsRouter.list`, `getById`, and `GET /api/notifications` already return the full row.

Internal contract change in `packages/api/src/lib/notification-store.ts`: `createNotification` clamps `body` to `MAX_NOTIFICATION_BODY` (20000) as a defensive guard, appending `…` only when it actually clamps. Line breaks are preserved.

## UI surface

No new UI. Existing rendering already supports full text:

- Web detail modal (`apps/web/src/app/notifications/page.tsx:384`) uses `whitespace-pre-wrap`.
- Web list preview (same file, line 147) uses `whitespace-pre-wrap leading-relaxed` after the prior fix.
- Mobile `Text` renders `\n` natively; `numberOfLines` was removed from the list preview and the modal never had it.

## Out of scope

- Backfilling or repairing notification rows created before this change.
- Rendering markdown (`##`, `*`) as formatted rich text — body stays plain text.
- Changing the OS push excerpt length (stays 240).
- Notification retention, archiving, swipe actions, preferences routing.
- The `pushDeliveryLog.message` truncations in `packages/api/src/lib/mobile-push.ts` — those are log fields, not user-facing bodies.

## Open questions

None.
