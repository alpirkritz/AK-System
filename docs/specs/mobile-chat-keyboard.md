# Mobile chat keyboard covers input

> **Slug:** `mobile-chat-keyboard`
> **Status:** Approved
> **Detected stack:** `next-trpc-monorepo` (mobile: Expo SDK 56, new architecture)
> **Last Updated:** 2026-07-16

## Goal

Fix the assistant chat so the on-screen keyboard no longer hides the text the user is typing. The composer input must stay visible above the keyboard on both Android and iOS.

## User stories

- As a user typing to the assistant, I want the input field to rise above the keyboard so I can see what I write.
- As a user, I want the bottom tab bar to get out of the way when the keyboard is open so the composer sits directly above the keyboard.
- As a user, I want tapping a message while the keyboard is open to not lose my focus/text unexpectedly.

## Acceptance criteria

- Given the chat screen on Android, When I focus the composer, Then the window resizes and the input + send button stay fully visible above the keyboard.
- Given the chat screen on iOS, When I focus the composer, Then the input rises above the keyboard using a dynamically computed offset (not a hardcoded 80px).
- Given the keyboard is open, When it is shown, Then the bottom tab bar is hidden so it does not consume vertical space.
- Given the keyboard is open, When I tap the message list, Then taps are handled without abruptly dismissing state (`keyboardShouldPersistTaps="handled"`).

## Data model

None.

## tRPC API

None.

## UI surface

- `apps/mobile/app.config.ts` — add `android.softwareKeyboardLayoutMode: 'resize'` (generates `android:windowSoftInputMode="adjustResize"` at build time).
- `apps/mobile/app/(tabs)/_layout.tsx` — set `tabBarHideOnKeyboard: true` (screenOptions or per chat screen).
- `apps/mobile/app/(tabs)/chat.tsx`:
  - `KeyboardAvoidingView` `behavior="padding"` on both platforms.
  - Replace `keyboardVerticalOffset={80}` with a dynamic value derived from safe-area insets (`0` on Android with resize; header/inset-based on iOS).
  - Add `keyboardShouldPersistTaps="handled"` to the `FlatList`.

## Build / verification note

`softwareKeyboardLayoutMode` is baked into the Android manifest at prebuild/EAS build time. The fix is only observable on a **freshly built APK**, not in an already-installed build. If Android edge-to-edge still overlays the composer after rebuild, the follow-up is to adopt `react-native-keyboard-controller` (out of scope for this pass).

## Out of scope

- Adding `react-native-keyboard-controller` (deferred second step).
- Redesigning the chat layout or composer styling.
- Keyboard handling on non-chat screens (search input in `people.tsx`).

## Open questions

None.
