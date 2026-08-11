# ARO Mobile — Full Parity (IA + Features + Agent Picker)

> **Slug:** `mobile-full-parity`
> **Status:** Approved for implementation
> **Parent:** [`mobile-web-parity.md`](./mobile-web-parity.md)
> **Last Updated:** 2026-08-11

## Goal

Close the functional gap between web and the ARO mobile app with a phone-first information architecture (one home per destination), a web-parity agent picker in chat, and all remaining feature areas (meetings, calendar, people, projects, finance, memory, updates, settings). Phase 0 (IA + security + shared components) is a hard prerequisite; feature waves run after it.

## User Stories

- As a user on the phone, I want each destination reachable from exactly one place so I am not confused by duplicate entry points.
- As a user, I want the dashboard to show today’s meetings by default and open the item I tap, not a list tab.
- As a user, I want to choose which assistant I talk to (general Hugo or a specialist agent) with separate histories, like on web.
- As a user, I want to change an agent’s operational settings (schedule, events, trigger message, display name, run now) from the phone.
- As a user, I want people, projects, calendar, finance, memory, and updates available under More without leaving the app for web-only gaps that are in scope.

## Acceptance Criteria

### Phase 0 — IA + Foundation
- [ ] Header: avatar → account; 📚 reading-list; 🔔 with unread badge. No ⚙️ in header.
- [ ] More tab: two groups of ListRows (Areas + Settings). Header destinations are NOT duplicated in More.
- [ ] Tab order: Dashboard, Meetings, Tasks, Chat, More.
- [ ] Push tap listener lives in root `_layout` + cold-start handling.
- [ ] `settings.dashboard.get/set` persists `{ meetingWindow, taskWindow }` in `user_settings.dashboard_prefs`.
- [ ] Dashboard defaults to today’s meetings; task section respects prefs; overdue KPI replaces people count; tap opens item.
- [ ] All four `/api/agents/**` routes require `getApiSession`; agent chat uses `clientChannel` for mobile.

### Phase 1 — Features
- [ ] Chat: AgentPickerSheet; general vs agent dual path; persist selection; agent config formSheet.
- [ ] Meetings + calendar agenda + `meeting/[id]`.
- [ ] People paginated + `person/[id]` + review; projects + `project/[id]`.
- [ ] Finance segments + VAT camera + SimpleBars.
- [ ] Memory + updates feed.
- [ ] Tasks search/filter/description/delete; workspaces + meeting types settings; reading-list chips.
- [ ] Every new route registered in `MobileNotificationRoute`.

### Cross-cutting
- [ ] RTL, navy theme, shared components; touch targets ≥44pt.
- [ ] `pnpm --filter @ak-system/mobile lint` and `pnpm test` pass.

## Data Model

`user_settings.dashboard_prefs` (text, nullable, JSON) on both `schema.ts` and `schema.pg.ts`, plus SQLite ALTER in `USER_SETTINGS_COLUMNS`.

Default: `{ "meetingWindow": "today", "taskWindow": "today" }`.

No other schema changes.

## tRPC API

| Procedure | Kind | Input | Auth |
|---|---|---|---|
| `settings.dashboard.get` | query | — | protected |
| `settings.dashboard.set` | mutation | `{ meetingWindow?: 'today'\|'3days'\|'week', taskWindow?: 'today'\|'all' }` | protected |

Reuse existing: `agents.*`, `settings.notifications.*`, `settings.agentDisplayNames.*`, `meetings.*`, `calendar.*`, `people.*`, `projects.*`, `finance.*`, `vat.*`, `memory.*`, `feed.*`, `workspaces.*`, `meetingTypes.*`, `notifications.unreadCount`.

REST (after auth fix): `GET/POST /api/agents`, history, chat.

## UI Surface

All under `apps/mobile/`:

- Tabs: `(tabs)/_layout`, `index`, `meetings`, `tasks`, `chat`, `more`
- Stack: `account`, `agents`, `agent/[id]`, `meeting/[id]`, `person/[id]`, `project/[id]`, `calendar`, `projects`, `finance`, `memory`, `updates`, `settings/*`
- Components: `ListRow`, `ToggleRow`, `Avatar`, `SegmentControl`, `AgentPickerSheet`, `BottomSheetScaffold`
- Lib: `unread.tsx`, `api.ts`, `data.ts`

## Out of Scope

Agent markdown/workflow edit; bank OTP; bulk VAT/CSV; WhatsApp admin; Notion statuses; feed source CRUD; calendar week/month grid; web localStorage migration.

## Open Questions

None — resolved in plan 2026-08-11.
