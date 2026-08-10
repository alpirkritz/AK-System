# Notification Body Truncation Fix

**Detected stack:** `next-trpc-monorepo`

## Goal

Fix notification body text truncation in the notification list (both web and mobile) so users can see the full message content without being forced to open the detail modal.

## User stories

- As a user viewing notifications, I want to see the full message body in the list so I can understand the notification without opening it.
- As a user with long notification messages, I want to know there's more content available rather than having it silently cut off.
- As a user on mobile, I want the same full-text experience as on web.

## Acceptance criteria

- **Given** a notification with body text longer than 2 lines
  - **When** viewing the notifications list (web or mobile)
  - **Then** the full body text should be visible (not truncated to 2 lines)

- **Given** a notification with very long body text (>6 lines)
  - **When** viewing the notifications list
  - **Then** the text should expand naturally with proper line breaks

- **Given** any notification in the list
  - **When** the text wraps to multiple lines
  - **Then** the layout should remain clean and readable (proper padding, line height)

## Data model

No database changes required.

## tRPC API

No API changes required.

## UI surface

### Web — `apps/web/src/app/notifications/page.tsx`

- **Line 147:** Change `line-clamp-2` to allow full text display
- Keep `whitespace-pre-wrap` for proper line breaks
- Adjust line height for readability if needed

### Mobile — `apps/mobile/app/notifications.tsx`

- **Line 130:** Remove `numberOfLines={2}` prop from the body Text component
- **Line 502–508 (`styles.body`):** Adjust line height for readability if needed

## Out of scope

- Modal detail view (already shows full text)
- Empty state, loading state, error handling
- Swipe actions
- Mark read / archive functionality
- Touch targets (already 44px minimum)

## Open questions

None.
