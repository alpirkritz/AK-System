# Code Review: Assistant chat UX — latest message, composer, keyboard

> **Slug:** `assistant-chat-ux-fix`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-08-13
> **Detected stack:** next-trpc-monorepo

## Spec Conformance

- [x] `/chat` locks the shell (`h-dvh`, `min-h-0`) so only the thread scrolls
- [x] Latest message is pinned via `scrollTop = scrollHeight` (not `scrollIntoView`)
- [x] FAB hidden on `/chat` and `/agents` so שלח is tappable
- [x] `interactiveWidget: 'resizes-content'` + `visualViewport` overlap padding; bottom nav hides while the keyboard is open
- [x] Helm: inverted `FlatList`; composer lifts from `Keyboard` events (iOS always; Android when the window did not resize)
- [x] No schema / tRPC changes

## UI/UX Review

**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo

### Design System Checklist
- [x] Matches project tokens/classes (navy/teal, `.btn` / `.btn-primary` on send)
- [x] RTL layout preserved
- [x] Mobile layout works (390×844 e2e)
- [x] No unapproved UI frameworks introduced
- [x] Reuses `DashboardLayout`, `ChatPanel`, `AgentChatPanel`

### UX Quality Checklist
- [x] Clear visual hierarchy — one primary action (שלח) on the composer
- [x] Cognitive load minimized — open עוזר, see the latest, type
- [x] Feedback states unchanged (loading / empty / error already present)
- [x] Destructive actions N/A
- [x] Microcopy unchanged: `כתוב הודעה...`, `שלח`, empty `שאל שאלה או בקש משהו מהמערכת`
- [x] Touch targets ≥ 44px on send and input; nav tabs already 44px

### Findings
- Must-fix: none
- Nits:
  - Real OS keyboard was not exercised in Playwright. Confirm on the phone that the composer sits above the keyboard after deploy / APK rebuild.
  - Specialist-agent mode still shows `AgentTriggersPanel` above the thread; that can shrink the chat. Out of spec.

## Static Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/web run test` | PASS (169) |
| `pnpm --filter @ak-system/web exec playwright test e2e/assistant-chat-ux.spec.ts` | PASS (3/3) |
| Related e2e (notifications + ui-refresh) | PASS (15/15) |
| `pnpm -r run lint` | SKIP — `next lint` prompts to create an ESLint config (pre-existing; see ui-refresh-navy nits) |
| `pnpm --filter @ak-system/web build` | PASS |

## Findings

### Must-fix

None.

### Should-fix

None for web. Helm keyboard/inverted-list fix is only on device after a new APK.

### Nits

- `next lint` still has no committed ESLint config.
- Android Helm still depends on `softwareKeyboardLayoutMode: 'resize'` being baked into the installed APK; the JS padding is a fallback when the window does not shrink.

## Out of Scope Creep

None. No new dependencies. No chat-feature work.

## Suggested PR Description

Fix עוזר so a phone opens on the latest message, שלח is not covered by the quick-add FAB, and the composer stays above the keyboard.
