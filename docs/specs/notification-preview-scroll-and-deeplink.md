# Notification Preview, Scrollable Detail, and Working Deep Links

**Detected stack:** `next-trpc-monorepo`

## Goal

Give the notification center a proper two-tier reading model: a compact, scannable preview in the list and a fully scrollable detail view on tap. Make "עבור ליעד" land on the specific message that triggered the notification instead of dumping the user on a generic screen.

## Background

`docs/specs/notification-body-full-text-storage.md` fixed storage so the full agent output is persisted. That exposed three UI problems:

1. **The list is now unreadable.** Removing `line-clamp-2` (web) and `numberOfLines={2}` (mobile) means a single 2000-character brief can fill the entire inbox, so the list no longer works as an index.
2. **The mobile detail clips with no escape.** `styles.modalCard` caps at `maxHeight: '85%'` (`apps/mobile/app/notifications.tsx:571`) but the body is a bare `<Text>` with no `ScrollView`. Long bodies are cut off and **cannot be scrolled**. On web, `.modal` (`globals.css:299-308`) scrolls as one block, so the title and the action buttons scroll out of reach on a long body.
3. **Deep links do not resolve to content.** `pushAssistantMessage` defaults `url` to `/chat` with no message reference, so "עבור ליעד" opens the chat at the bottom rather than at the relevant message. Mobile is worse: `routeForUrl` (`apps/mobile/app/notifications.tsx:45-48`) collapses every URL to `/chat` or `/notifications`, and the push-response listener in `apps/mobile/app/(tabs)/chat.tsx:71-77` repeats the same guesswork, so a tasks or people notification lands on chat.

## User stories

- As a user opening the notification list, I want each row to stay a compact two-line summary so I can scan the inbox at a glance.
- As a user tapping a notification, I want the full text in a view I can scroll, with the close and action buttons always reachable.
- As a user tapping "עבור ליעד" on an agent brief, I want to land on that exact message in the chat, highlighted, not at the bottom of the conversation.
- As a user tapping a task or people notification on mobile, I want the matching mobile screen, not the chat tab.
- As a user tapping an OS push banner on the phone, I want the same destination I would get from the in-app list.

## Acceptance criteria

### Compact preview

- **Given** a notification whose body is a long multi-line brief
  - **When** the list renders
  - **Then** the row shows at most two lines of flattened text (newlines collapsed, markdown markers stripped, lines joined with ` · `) so two lines carry real content rather than a heading and a blank line

- **Given** a body containing markdown (`##`, `*`, `1.`, `**bold**`)
  - **When** the preview renders
  - **Then** no raw markdown markers appear in the row

- **Given** any notification row
  - **When** compared to another row
  - **Then** all rows have a consistent maximum height; no row can dominate the list

### Scrollable detail

- **Given** a notification with a body far taller than the viewport
  - **When** the detail view opens on mobile
  - **Then** the body scrolls within the sheet, and the title and action buttons remain visible without scrolling

- **Given** the same notification on web
  - **When** the detail modal opens
  - **Then** the body region scrolls independently while the header and the action row stay pinned

- **Given** the detail view is open
  - **When** the body is short enough to fit
  - **Then** no scrollbar or empty scroll area appears

- **Given** an agent brief written in markdown
  - **When** the detail view renders it
  - **Then** headings appear as bold headings, `*`/`-` items as bulleted rows and `1.` items as numbered rows — never as literal `#` or `*` characters

### Deep links

- **Given** an agent or cron notification created from an assistant message
  - **When** the notification is persisted
  - **Then** its `url` is `/chat?message=<chatMessageId>`

- **Given** such a notification
  - **When** the user activates "עבור ליעד" on web
  - **Then** the chat opens scrolled to that message with a brief highlight

- **Given** a notification whose target message no longer exists
  - **When** the user activates "עבור ליעד"
  - **Then** the chat opens normally at the latest message with no error

- **Given** a notification with url `/tasks`, `/people`, `/meetings`, `/reading-list`, or `/settings/*`
  - **When** the user activates "עבור ליעד" on mobile
  - **Then** the corresponding mobile route opens

- **Given** an OS push notification on mobile
  - **When** the user taps the banner
  - **Then** it resolves through the same mapping as the in-app list

## Data model

No schema change. `chatMessages.id` already exists and is generated in `saveChatMessage` (`apps/web/src/lib/conversation-engine.ts:1176`); it is currently discarded.

## tRPC API

No procedure signature changes.

Internal contract changes:

- `saveChatMessage` returns the generated message id (`Promise<string>` instead of `Promise<void>`). Existing callers ignoring the return value are unaffected.
- `pushAssistantMessage` builds the notification `url` as `/chat?message=<id>` when the caller does not pass an explicit `options.url`. Callers that pass a url (for example `runEventAgentIfRouted` with `/chat`) keep control; that call site is updated to let the message id win so meeting briefs deep-link correctly.
- New shared helper `notificationPreview(body, maxChars)` in `apps/web/src/lib/notification-url.ts` and mirrored in `apps/mobile/lib/api.ts`: collapses whitespace and trims, for list previews only.
- New helper `mobileRouteForNotificationUrl(url)` in `apps/mobile/lib/api.ts`, replacing the inline `routeForUrl`.

## UI surface

### Web — `apps/web/src/app/notifications/page.tsx`

- List row body: render `notificationPreview(item.body)` with `line-clamp-2`; drop `whitespace-pre-wrap` from the preview so two lines stay dense.
- Detail modal: restructure into three regions — a non-scrolling header (title + סגור), a `max-h-[60vh] overflow-y-auto` body keeping `whitespace-pre-wrap`, and a non-scrolling action row. Add `overscroll-contain` so scrolling the body does not scroll the page behind it.
- "עבור ליעד" continues to call `router.push(selected.url)`; the url now carries the message id.

### Web — `apps/web/src/components/ChatPanel.tsx`

- Read `message` from `useSearchParams()`.
- Tag each rendered message with `data-message-id` and a ref map.
- After history loads, if the id is present and matches a message, scroll it into view centered and apply a highlight ring for ~2s; otherwise fall back to the existing scroll-to-bottom.
- Suppress the automatic scroll-to-bottom on that first load only, so it does not fight the deep-link scroll.

### Mobile — `apps/mobile/app/notifications.tsx`

- List row body: `numberOfLines={2}` restored, rendering `notificationPreview(item.body)`.
- Modal: wrap the body in a `<ScrollView>` with the header and action row as siblings outside it, so they stay fixed. Keep `maxHeight: '85%'` on the card.
- Replace `routeForUrl` with `mobileRouteForNotificationUrl`, forwarding query params.

### Mobile — `apps/mobile/app/(tabs)/chat.tsx`

- Use the shared mapping in the push-response listener instead of the inline `url.includes('chat')` check.
- Read the `message` param; when present and found in history, scroll the `FlatList` to that index instead of the end.

## Rendering agent markdown

Agents emit markdown and WhatsApp renders it, so raw `##` and `*` in the app read as broken by comparison. A dependency-free parser (`notification-format.ts`, mirrored in `apps/mobile/lib/`) turns a body into heading / bullet / numbered / paragraph blocks, which each surface styles natively. This covers the subset agents actually produce; it is not a general markdown renderer (no links, tables, images, or nesting).

## Out of scope

- A full markdown renderer — no links, tables, images, code blocks, or nested lists.
- Repairing notification rows created before the storage fix.
- An expand/collapse control inside the list row; tapping through to the detail is the expansion mechanism.
- Deep-linking to a specific WhatsApp group message or a specific task field.
- Changing the OS push excerpt length.

## Open questions

None.
