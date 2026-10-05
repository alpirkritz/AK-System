# Mobile tab bar on every screen, keyboard clears the field

> **Slug:** `mobile-persistent-tab-and-keyboard`
> **Status:** Approved
> **Detected stack:** `next-trpc-monorepo` (mobile: Expo SDK 56)
> **Last Updated:** 2026-09-26

## Goal

The bottom tab bar disappears on every screen that is pushed onto the root stack (notifications, people, settings, and the rest of the "עוד" destinations). It should stay visible on all of those full-screen routes, with a back button to return to the previous tab.

The on-screen keyboard still covers the field the user is typing in. The composer, form fields, and bottom-of-screen inputs must stay visible above the keyboard on iOS and Android, including when Android does not actually resize the window.

## User stories

- As a user on notifications (or any other secondary screen), I want the same tab bar as on the dashboard so I can jump to another area without going back first.
- As a user typing in chat, a form sheet, a note, or a create field, I want to see the text I am writing while the keyboard is open.

## Acceptance criteria

- [ ] Given I am signed in and I open notifications, people, relationships, reading list, commitments, record, agents, projects, calendar, finance, memory, updates, or any settings screen, the five-tab bar is still visible.
- [ ] Those screens are not extra tabs. The bar still shows only דשבורד, פגישות, משימות, עוזר, עוד.
- [ ] Each of those screens shows a back control that returns to the screen I came from.
- [ ] Login stays full screen with no tab bar. Form sheets (account, task, person, project, meeting, agent settings) stay sheets over the current screen.
- [ ] Given the keyboard is open on chat, the composer and send button are fully above the keyboard.
- [ ] Given the keyboard is open on a form sheet or a screen with a lower text field (reading list, memory, relationships, record, workspaces, meeting types, task assignee sheet, batch-task sheet), the focused field is scrolled or lifted so it is not covered.
- [ ] The tab bar is not removed from layout when the keyboard opens (`tabBarHideOnKeyboard` is off). The keyboard may cover the bar; the field must not be covered.
- [ ] Lift is computed from the view's on-screen bottom versus the keyboard top, so a window that did not resize still clears the field, and a window that already resized does not add a second gap.

## Data model

None.

## tRPC API

None.

## UI surface

- `apps/mobile/app/(tabs)/_layout.tsx` wraps the tab navigator in `KeyboardSafe`, so the bar and the focused screen rise together. `tabBarHideOnKeyboard` stays off. `backBehavior="fullHistory"`.
- Hidden routes are registered with `href: null`, a Hebrew title, and a back button. They are not extra tabs.
- Root stack keeps `login` and the form-sheet routes only. Sheets and the two bottom modals use their own `KeyboardSafe`, because they are not inside the tab navigator.
- Scroll screens (relationships, reading list, memory, record, workspaces, meeting types) call `useBringFocusedFieldIntoView` so a field lower on the page scrolls above the keyboard.

## Out of scope

- Adding `react-native-keyboard-controller` / Reanimated (needs a new native binary).
- Changing form sheets into full screens so the tab bar shows on top of a sheet.
- Redesigning tab icons, labels, or header actions.

## Open questions

None.
