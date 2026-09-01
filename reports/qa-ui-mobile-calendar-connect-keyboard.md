# QA UI report — mobile-calendar-connect-keyboard

**Stack:** next-trpc-monorepo
**Verdict:** PASS (web + formula) — Helm APK not run

QA-UI was required before claiming the keyboard is fixed. This pass verifies what can be verified without a phone. It does **not** certify the installed APK.

## Automated

- Web Vitest (`chat-layout.test.ts` + `composer-keyboard.test.ts`): PASS — 15 tests
- Full unit: PASS — api 752, web 183
- Playwright `e2e/assistant-chat-ux.spec.ts`: PASS — 4/4
  - bottom nav עוזר opens composer
  - long history opens on latest; שלח tappable
  - composer in viewport after focus
  - **composer bottom ≤ 480px after simulated keyboard** (visualViewport height stub)
- Playwright `e2e/calendar-connect.spec.ts`: PASS — 2/2
  - Settings still shows חשבונות Google + `חבר`
  - `GET /api/auth/google-calendar` 307 → accounts.google.com

## Manual / exploratory

- Interaction: web `/chat` composer and שלח stay inside a 480px visible frame (keyboard simulation). Web Settings still has Google `חבר`. Helm יומן connect UI is native-only — not exercised in a device.
- Keyboard / focus: Playwright cannot open a real Android IME. Native lift formula is unit-tested (`composerLiftPx(300, 56) === 244`). The previous chat heuristic padded **0** once the window shrank >80px (tab bar hide), which matches “keyboard still covers the field” on a phone.
- Responsive: phone viewport 390×844 for chat specs.
- Accessibility (spot): composer `data-testid=chat-composer`; send is a named button; connect button has `accessibilityLabel`.
- Cross-browser: Chromium only.
- Duplication check: chat.tsx has **no** `KeyboardAvoidingView`. Single helper `apps/mobile/lib/composer-keyboard.ts`. Form sheets / memory / reading-list keep iOS `KeyboardAvoidingView` only (not chat listeners). Web uses `visualViewport` in `chat-layout.ts` — different platform, not a copy of the RN path.

## Failures

None in the automated pass above.

## Not verified (do not treat as fixed on the phone)

- Physical Helm APK / Android IME covering the עוזר composer.
- Helm יומן → חבר יומן Google → Google account picker → return to the app.
- No emulator/`adb` device was available in this session.

A new APK install is required before the phone can show either change.

## Evidence

- `apps/web/test-results/qa-ui-chat-keyboard-simulated.png` — composer + שלח at the bottom of the 480px simulated keyboard frame.
- `apps/web/test-results/qa-ui-settings-google-connect.png` — Settings shell (Google card is below the fold; locator still found `חבר`).
- Playwright list: 6 passed (`assistant-chat-ux` + `calendar-connect`).
