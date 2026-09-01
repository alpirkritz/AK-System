# Assistant chat UX — latest message, composer, keyboard

> **Slug:** `assistant-chat-ux-fix`
> **Status:** Approved (user asked to fix עוזר: click/send dead, thread opens at the top, keyboard covers input)
> **Detected stack:** `next-trpc-monorepo` (web PWA + Helm Expo)

## Goal

Make עוזר usable on a phone: opening the tab shows the latest message with the composer visible and tappable; typing never hides the input behind the keyboard or the quick-add FAB.

## User stories

- As a user opening עוזר, I want to land on the latest message so I do not scroll a long history to catch up.
- As a user tapping שלח, I want the tap to send — not open "הוסף משימה".
- As a user typing on a phone, I want the input and שלח to stay fully visible above the keyboard.
- As a Helm user, I want the same: latest at the bottom, composer above the keyboard.

## Acceptance criteria

- Given `/chat` on a mobile-width viewport with a long history, When the page finishes loading, Then the last message is inside the messages scroller viewport (not only the first messages).
- Given `/chat` on a mobile-width viewport, When I look at the composer, Then the quick-add FAB is not rendered and שלח is the topmost control at its center (elementFromPoint).
- Given `/chat` on a **phone-width** viewport, When the virtual keyboard opens, Then the app shell height equals `visualViewport.height` (not `100dvh`) so the input and שלח stay fully visible above the keyboard. Desktop layout is unchanged.
- Given I focus the composer, When the messages list is long, Then the list stays pinned to the latest message (or the deep-linked message if `?message=` is present).
- Given Helm chat with a long history, When the screen mounts, Then the latest message is at the visual bottom without the user scrolling.
- Given Helm chat, When the keyboard opens, Then the input and שלח stay fully visible above it.

## Data model

None.

## tRPC API

None.

## UI surface

- `apps/web/src/app/layout.tsx` — `interactiveWidget: 'resizes-content'` so mobile browsers shrink the layout viewport with the keyboard.
- `apps/web/src/components/DashboardLayout.tsx` — on `/chat` and `/agents`: lock the shell; hide the FAB. **Mobile only (max-width 767px):** size the shell to `visualViewport.height` + `offsetTop` (iOS does not shrink `100dvh` with the keyboard); lock body scroll; hide the bottom nav while the keyboard is open. Desktop keeps `h-dvh` and is not pinned to the visual viewport.
- `apps/web/src/components/AssistantWorkspace.tsx` — fill remaining height (`flex-1 min-h-0`), drop the `100dvh-8rem` guess that overflows `<main>`.
- `apps/web/src/components/ChatPanel.tsx` and `AgentChatPanel.tsx` — `min-h-0` on the flex chain; scroll the **messages element** with `scrollTop = scrollHeight` (not `scrollIntoView`, which moves the page); composer `min-h-[44px]`; `data-testid` on list, composer, send.
- `apps/web/src/lib/chat-layout.ts` — pure helpers for keyboard overlap and list scroll (unit-tested).
- `apps/mobile/app/(tabs)/chat.tsx` — inverted `FlatList` (latest at the visual bottom); pad the composer from `Keyboard` show/hide events instead of relying on `KeyboardAvoidingView` alone.

### Microcopy (unchanged)

- Placeholder: `כתוב הודעה...` / `כתוב להוגו...`
- Send: `שלח`
- Empty: `שאל שאלה או בקש משהו מהמערכת`

## Out of scope

- New chat features, agent picker changes, or history pagination.
- Adding `react-native-keyboard-controller`.
- Redesigning the composer or message bubbles.

## Open questions

None.
