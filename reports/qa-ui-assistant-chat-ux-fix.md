# QA UI report — assistant-chat-ux-fix

**Stack:** next-trpc-monorepo
**Verdict:** PASS

## Automated

- Web Vitest (`src/lib/chat-layout.test.ts` + full web suite): PASS — 169 tests
- Playwright `e2e/assistant-chat-ux.spec.ts`: PASS — 3/3
  - bottom nav עוזר opens the composer
  - long history opens on the latest message and שלח is tappable
  - composer stays in the viewport after focusing the input
- Playwright `e2e/notifications.spec.ts` + `e2e/ui-refresh.spec.ts`: PASS — 15/15 (regression)

## Manual / exploratory

- Interaction: bottom-nav `עוזר` (`data-testid=nav-tab-chat`) reaches `/chat`; composer and placeholder are visible. FAB is not rendered on `/chat`, so שלח is the topmost control at its center (`elementFromPoint`).
- Keyboard / focus: Playwright cannot open a real OS keyboard. Focus on `כתוב הודעה...` keeps the composer in the layout viewport. Keyboard overlap math is unit-tested (`keyboardOverlapPx` / `isKeyboardOpen`).
- Responsive: phone viewport 390×844. Last of 40 seeded messages is in the messages scroller viewport.
- Accessibility (spot): composer input has `aria-label="הודעה לעוזר"`; send is a named button; nav tab is a real `Link`.
- Cross-browser: Chromium only (repo Playwright project).

## Failures

None in this pass.

## Evidence

- Playwright list reporter: 3 passed (`assistant-chat-ux.spec.ts`), 15 passed (notifications + ui-refresh).
- Device keyboard on a physical phone / Helm APK was not run in this session. Helm needs a fresh install to pick up the inverted list + keyboard padding.
