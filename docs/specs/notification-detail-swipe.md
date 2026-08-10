# Notification Detail + Swipe Actions

> **Slug:** `notification-detail-swipe`
> **Status:** Approved
> **Last Updated:** 2026-08-04
> **Detected stack:** `next-trpc-monorepo` (+ Helm Expo mobile)

## Goal

Today, tapping a notification on web navigates away to a deep-link URL, and on mobile it only jumps to `/chat` or stays on `/notifications` — the user never gets a readable full-message view. There is also no way to archive or mark-as-read via gesture. This feature adds a **detail reader** (modal/sheet) on tap for web and Helm, plus **swipe actions** to archive and mark-as-read, with parity across both surfaces.

## User Stories

- As the owner, I want tapping a notification to open a readable window with the full title and body so I can consume the message without leaving the inbox.
- As the owner, I want to swipe one way to archive a notification and the other way to mark it as read, so triage is fast on touch and desktop.
- As the owner, I want archived items hidden from the default inbox so the list stays actionable.
- As the owner, I want opening a detail view to mark the item as read automatically when it was unread.

## Acceptance Criteria

- [ ] Tapping a notification on **web** (`/notifications`) opens a detail modal/sheet with full `title`, `body`, relative time, and type — does **not** navigate away solely on tap.
- [ ] Tapping a notification on **Helm** (`apps/mobile/app/notifications.tsx`) opens a detail screen/sheet with the same content.
- [ ] Opening detail marks the item as read if `readAt` was null (optimistic UI + API).
- [ ] Detail includes secondary CTA **"עבור ליעד"** when `url` is useful (e.g. `/chat`) — optional navigation, not the primary open behavior.
- [ ] Swipe (or desktop swipe/drag equivalent) **toward screen-left** → **ארכיון** (archive); **toward screen-right** → **סמן כנקרא** (mark read). Same absolute directions on web and mobile (RTL layout does not flip action meanings).
- [ ] Archive sets `archivedAt` and removes the item from the default list (soft archive, not hard delete).
- [ ] Mark-read via swipe sets `readAt` without opening detail; already-read items show muted swipe affordance or no-op with brief toast.
- [ ] Existing **"סמן הכל כנקרא"** remains.
- [ ] `list` / REST GET return only non-archived by default; optional `includeArchived` for future, not required in UI now.
- [ ] tRPC + Helm REST support `archive` (and mark-read already exists).
- [ ] Vitest covers archive + list filtering; Playwright (web) covers open-detail + mark-read; mobile covered by unit/API where e2e is impractical.
- [ ] Hebrew microcopy matches UI Surface; no raw error codes shown to the user.

## Data Model

Extend table `notifications` in **both** `packages/database/src/schema.pg.ts` and `schema.ts`, plus SQLite bootstrap `ALTER` in `packages/database/src/index.ts`:

| Column | Type | Notes |
|--------|------|--------|
| `archivedAt` | text nullable | null = in inbox; ISO timestamp when archived |

Index: add or extend for listing inbox (`archived_at IS NULL`, order by `created_at` desc). Existing `readAt` / unread index remains.

No other columns required. Do not hard-delete on archive.

## tRPC API

Router: `packages/api/src/routers/notifications.ts` (protected).

| Procedure | Input | Return | Behavior |
|-----------|--------|--------|----------|
| `list` | `{ limit?: number; includeArchived?: boolean }` default `limit=50`, `includeArchived=false` | `Notification[]` | Exclude rows with `archivedAt` set unless `includeArchived` |
| `unreadCount` | — | `{ count }` | Unread **and** not archived |
| `getById` | `{ id: string }` | `Notification \| null` | For deep-link / refresh; return even if archived |
| `markRead` | `{ id?: string; all?: boolean }` | `{ updated: number }` | Existing; `all` only touches non-archived unread |
| `archive` | `{ id: string }` | `{ archived: boolean }` | Sets `archivedAt` now; idempotent if already archived |

### Helm REST — `apps/web/src/app/api/notifications/route.ts`

- `GET` — same filter (non-archived); response shape unchanged plus `archivedAt` on rows.
- `PATCH` — extend body: `{ id, all?, action?: 'read' \| 'archive' }`  
  - default / `read` → mark read (current behavior)  
  - `archive` → set `archivedAt`  
- Or add `POST /api/notifications/archive` with `{ id }` if PATCH extension is cleaner for clients — prefer single PATCH with `action` for one client helper.

Update `apps/mobile/lib/api.ts` helpers: `archiveNotification`, and detail open uses existing list payload (no mandatory getById on mobile if list already has body).

## UI Surface

### Shared UX (UI/UX Designer — pre-implementation)

**Detected stack:** `next-trpc-monorepo` + Helm Expo.

**Happy path (≤ 3 steps):**
1. Open התראות → see inbox list (preview 2 lines).
2. Tap item → detail opens; body fully readable; auto mark-read.
3. Swipe to triage remaining items (archive / mark-read) without opening.

**Principles applied:** Clarity (full message visible), Deference (list shows content first), Remove friction (swipe triage), Recognition over recall (colored swipe backgrounds + Hebrew labels).

**Swipe directions (absolute, not mirrored by RTL):**

| Gesture | Action | Label | Visual |
|---------|--------|-------|--------|
| Swipe toward **left** of screen | Archive | ארכיון | Muted / danger-tint background (`#c45c5c` or existing `.btn-danger` tone) |
| Swipe toward **right** of screen | Mark as read | סמן כנקרא | Accent teal `#2dd4bf` |

**Microcopy (Hebrew):**

| Context | Copy |
|---------|------|
| Page title | התראות |
| Empty inbox | אין התראות כרגע |
| Empty CTA hint | כשתגיע התראה חדשה — היא תופיע כאן |
| Mark all | סמן הכל כנקרא |
| Detail close | סגור |
| Detail deep link | עבור ליעד |
| Archive confirm (optional; prefer undo) | Prefer **optimistic archive + Undo toast** "הועבר לארכיון · בטל" for 4s instead of confirm dialog |
| Mark-read already read | אין פעולה / silent no-op |
| Error | לא ניתן לעדכן את ההתראה. נסה שוב. |
| Chat unreachable (ops) | לא ניתן להתחבר לשרת. בדוק חיבור וכתובת API. |

**Feedback states:**
- Loading: skeleton/list spinner (existing).
- Empty: helpful Hebrew + no dead "אין נתונים".
- Error: human Hebrew + retry.
- Success: brief undo snackbar after archive; opacity change after mark-read.
- Detail: focus trap on web modal; Escape / backdrop closes; `aria-label` on close.

**Touch:** swipe row height ≥ 44px; detail primary close ≥ 44px.

### Web — `apps/web/src/app/notifications/page.tsx`

- Keep list with `.card` / design tokens; unread accent border.
- On tap → open `.modal` / `.overlay` detail (not `router.push(url)` as primary).
- Swipe: use a lightweight swipeable row (pointer events or small dependency already in monorepo if any; prefer no new UI framework). Desktop: same swipe OR visible icon buttons on hover as progressive enhancement if swipe is awkward with mouse — **minimum:** swipe works on touch; hover reveals "ארכיון" / "סמן כנקרא" ghost buttons for mouse.
- Optional CTA in modal: `עבור ליעד` → `router.push(item.url)`.

### Helm — `apps/mobile/app/notifications.tsx`

- Replace tap→`routeForUrl` primary with open detail (`Modal` or `router.push('/notification/[id]')`).
- Prefer Expo Router route `app/notification/[id].tsx` **or** in-screen `Modal` — Modal is fine to minimize navigation stack churn; full screen sheet preferred for long agent bodies.
- Swipe: `react-native-gesture-handler` Swipeable (if already a transitive dep via Expo) or equivalent Expo-supported pattern — check Expo 56 docs before adding packages.
- Push OS-tap listener: when opening from push, prefer landing on notifications list **and** opening detail for that id if payload includes notification id; if only `url` exists, keep current coarse routing as fallback (out of scope to change all push payloads unless easy).

### Settings

No change to `/settings/notifications` preferences page.

## Out of Scope

- Archived-items browser UI / restore screen (archive + undo toast only for v1).
- Hard delete, bulk archive, filters (unread-only tab).
- Changing all push payload schemas to include `notificationId` (nice-to-have if trivial).
- Fixing Helm `EXPO_PUBLIC_API_URL` / ngrok DNS (tracked as ops note below — separate from this UX feature).
- Per-user multi-tenant notification scoping.

## Open Questions

Resolved 2026-08-04:

1. **Swipe sides** — confirmed: left=ארכיון, right=סמן כנקרא (absolute).
2. **Auto mark-read on open** — yes.
3. **Deep-link CTA** — show "עבור ליעד" only when `url` is a real target (not empty / not `/notifications`).

## Ops note (chat `UnknownHostException`) — not part of implementation scope

Helm chat fails with:

`fetch failed: java.net.UnknownHostException: Unable to resolve host "retype-engross-strike.ngrok-free.dev"`

Cause: APK / `apps/mobile/.env` + `eas.json` bake `EXPO_PUBLIC_API_URL=https://retype-engross-strike.ngrok-free.dev`. Android cannot resolve that hostname (DNS), so every chat/API call fails. Mac-side health may still return 200 while the phone cannot resolve DNS.

**Fix path (ops, after approving this spec or in parallel):**
1. Confirm ngrok/tunnel process is running and domain resolves on the phone (browser open same URL).
2. If DNS fails on device: rebuild Helm APK with a reachable stable URL (`pnpm set-tunnel-url` / `eas.json` + `apps/mobile/.env`), then reinstall.
3. Surface friendlier Hebrew error in chat when host resolution fails (optional small follow-up).

## UI/UX Review (pre-implementation)

**Verdict:** APPROVED WITH NITS (spec-level — ready to implement after product answers to Open Questions)

**Detected stack:** `next-trpc-monorepo`

### Design System Checklist
- [x] Matches project tokens/classes (web: `.card` / `.btn` / `.modal`; mobile: existing `colors` theme)
- [x] RTL layout preserved (list/detail text RTL; **swipe actions use absolute L/R**, documented)
- [x] Mobile layout works (sheet/modal + swipe rows)
- [x] No unapproved UI frameworks introduced (gesture-handler only if Expo-native)
- [x] Reuses existing notifications pages

### UX Quality Checklist
- [x] Clear hierarchy — tap = read; swipe = triage
- [x] Cognitive load minimized — one primary open path
- [x] Feedback states specified (loading / empty / error / undo)
- [x] Destructive archive uses undo over hard confirm
- [x] Microcopy: clear Hebrew, verb-first where buttons
- [x] Touch targets ≥ 44px called out

### Findings
- **Nits:** Confirm swipe side mapping with user (Open Q1). Prefer undo toast over archive confirm (already in AC).
- **Must-fix before ship:** Do not keep current mobile `routeForUrl` as primary tap — that is the core bug.
