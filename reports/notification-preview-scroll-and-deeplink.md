# Review — Notification Preview, Scrollable Detail, and Working Deep Links

**Spec:** `docs/specs/notification-preview-scroll-and-deeplink.md`
**Detected stack:** `next-trpc-monorepo`
**Verdict:** APPROVED WITH NITS

## What changed

| Area | File | Change |
|---|---|---|
| Shared helpers | `apps/web/src/lib/notification-url.ts` | Added `notificationPreview`, `withChatMessageId`, `chatMessageIdFromUrl` |
| Markdown blocks | `apps/web/src/lib/notification-format.ts`, `apps/mobile/lib/notification-format.ts` | New dependency-free parser for headings / bullets / numbered steps |
| Web list + modal | `apps/web/src/app/notifications/page.tsx` | Two-line clamped preview; modal split into fixed header / scrolling body / fixed actions; body rendered as styled blocks |
| Web chat | `apps/web/src/components/ChatPanel.tsx` | Reads `?message=`, scrolls the message into view, highlights it for 2.5s |
| Message id | `apps/web/src/lib/conversation-engine.ts` | `saveChatMessage` returns the new id |
| Link building | `apps/web/src/lib/push-notifications.ts`, `apps/web/src/lib/whatsapp-bot.ts` | Chat-bound notifications now carry `?message=<id>` |
| Mobile helpers | `apps/mobile/lib/api.ts` | Added `notificationPreview`, `mobileRouteForNotificationUrl` |
| Mobile list + sheet | `apps/mobile/app/notifications.tsx` | Restored `numberOfLines={2}` on a flattened preview; body wrapped in `ScrollView` and rendered as styled blocks; real route mapping |
| Mobile chat | `apps/mobile/app/(tabs)/chat.tsx` | Shared route mapping for push taps; scrolls to and outlines the linked message |

## Checks run

| Check | Result |
|---|---|
| `pnpm test` | 129 passed, 17 files |
| `pnpm e2e -- notifications.spec` | 10 passed |
| `pnpm e2e` (full) | 56 passed, 8 failed — **all 8 pre-existing** |
| `pnpm --filter @ak-system/mobile lint` (`tsc --noEmit`) | clean |
| `pnpm --filter @ak-system/web build` | success |
| Deploy to EC2 | complete, `/notifications` and `/chat` both respond |

New coverage: 14 unit cases in `apps/web/src/lib/notification-url.test.ts`, 8 in `apps/web/src/lib/notification-format.test.ts`, and two e2e cases — one asserting the row stays clamped and under 200px while the detail holds the full body with `overflow-y: auto` and no raw `##`, one walking notification → "עבור ליעד" → the linked chat bubble.

### On the 8 full-suite failures

They sit in `trading-journal.spec.ts`, `task-workspaces.spec.ts`, `qa-structured.spec.ts` and the finance specs (`חיובי אשראי`, `P&L ממומש` strict-mode violations and missing elements). To confirm they are not mine, the working tree was stashed (`git stash push --include-untracked -- apps/web/src apps/mobile apps/web/e2e`) and those specs re-run against `main` at `a6a4e1e`: **5 failed, 5 passed** — the same failures without any of this work applied. Unrelated to notifications; worth a separate bug.

## UI/UX Review

**Verdict:** APPROVED WITH NITS

### Design System Checklist

- [x] Matches project tokens/classes — `.modal`, `.btn`, `.btn-ghost` unchanged; the accent ring reuses `#2dd4bf` from the chat palette
- [x] RTL layout preserved — flattening the preview does not reorder text, and the action row keeps `flex-row-reverse`
- [x] Mobile layout works — sheet keeps `maxHeight: '85%'`, body absorbs the remainder via `flexShrink: 1`
- [x] No unapproved UI frameworks introduced
- [x] Reuses existing components

### UX Quality Checklist

- [x] Clear visual hierarchy — every row is now the same scannable height, so the inbox reads as an index again; in the detail, headings and bullets give the brief real structure instead of a wall of text
- [x] Cognitive load minimized — progressive disclosure: two-line gist in the list, full text on tap
- [x] Feedback states handled — the 2.5s ring answers "which message did I come from?", then fades so it does not become permanent chrome
- [x] Destructive actions still confirmed — archive flow untouched
- [x] Microcopy unchanged; no new strings needed
- [x] Touch targets ≥ 44px — close button keeps `min-h-[44px]`; the scroll region takes `tabIndex={0}` so keyboard users can scroll it

### Findings

**Must-fix:** none.

**Nits:**

1. `apps/mobile/app/notifications.tsx:385` and `apps/mobile/app/(tabs)/chat.tsx:76` — both cast with `as Href`. This follows the existing convention (`app/(tabs)/_layout.tsx:14`, `app/(tabs)/tasks.tsx:294`) because `.expo/types/router.d.ts` is stale (generated 2026-07-14) and lists neither `/reading-list` nor `/task/[id]`. Regenerating those types would let the casts go; worth doing on the next Expo prebuild rather than as part of this change.
2. `mobileRouteForNotificationUrl` has no automated coverage — `apps/mobile` runs `tsc --noEmit` as its only check, with no test runner configured. The parsing it performs mirrors `withChatMessageId` / `chatMessageIdFromUrl`, which are unit-tested on the web side. Adding Vitest to the mobile package would close this gap.
3. `apps/mobile/app/(tabs)/chat.tsx` `onScrollToIndexFailed` uses a 96px-per-row estimate to jump near the target before retrying. It self-corrects on the second pass, but a long brief could land the first jump well short. Acceptable for now; `getItemLayout` is not viable with variable bubble heights.
4. Notifications created before this change keep a bare `/chat` url, so they open the conversation at the bottom instead of at a specific message. This is the intended fallback and is out of scope per the spec.
5. `notification-format.ts` is duplicated between `apps/web/src/lib` and `apps/mobile/lib` because the mobile app does not consume `@ak-system/*` workspace packages. `notificationPreview` has the same split. A shared `packages/types`-style home would remove the drift risk; the files carry a "keep in sync" note in the meantime.

### Scope note

Markdown rendering was not in the original spec — it was added after screenshot review showed the detail view displaying literal `##` and `*`, which fails the stated bar of looking better than the WhatsApp rendering the user compared it to. The spec was updated to match.

## Production verification

Existing rows confirm both the earlier storage fix and the fallback path:

```
2026-08-09T17:01 | cron | /chat                              | len=1771
2026-08-09T14:15 | cron | /chat                              | len=239
```

The 17:01 row carries a full 1771-character body (storage fix working); the 14:15 row is a pre-fix 239-character remnant. A seeded row now exercises the new link format end to end:

```
2026-08-09T17:36 | /chat?message=msg_1786296998_dlink | len=592
```
