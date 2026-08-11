# Mobile Information Architecture

> **Slug:** `mobile-information-architecture`
> **Status:** Approved for implementation
> **Parent:** [`mobile-full-parity.md`](./mobile-full-parity.md)
> **Last Updated:** 2026-08-11

## Goal

Eliminate duplicate navigation entry points and establish a single canonical home for every destination in ARO mobile: header for identity + inboxes, tabs for daily work, More for areas and settings.

## User Stories

- As a user, I want settings reachable from one place so I am not hunting between header and More.
- As a user, I want unread notification count on the bell so I know when to open the inbox.
- As a user, I want push taps to navigate even if I never opened Chat in this session.

## Acceptance Criteria

- [ ] Header left: Avatar → `/account` (formSheet). Title "החשבון שלי". Sign-out confirms "להתנתק מהמכשיר?"
- [ ] Header right: 📚 → `/reading-list`; 🔔 → `/notifications` with badge from `notifications.unreadCount`.
- [ ] More has Areas (people, projects, calendar, finance, updates, agents, memory) and Settings (notification prefs, dashboard, workspaces, meeting types, developer). No tiles for reading-list / notifications / monolithic settings.
- [ ] Push listener + cold start in root `_layout`.
- [ ] `MobileNotificationRoute` includes new routes; `/settings` maps to More hub or account as appropriate.

## Data Model

See `mobile-full-parity` — `dashboard_prefs` only.

## tRPC API

`settings.dashboard.*`, `notifications.unreadCount`, `settings.notifications.*` (existing).

## UI Surface

`(tabs)/_layout.tsx`, `(tabs)/more.tsx`, `account.tsx`, `settings/*.tsx`, `lib/unread.tsx`.

## Out of Scope

Feature screen bodies for Areas (owned by feature waves); OS app-icon badge.

## Open Questions

None.
