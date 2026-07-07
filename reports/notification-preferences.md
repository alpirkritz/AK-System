# Report — notification-preferences

## QA

- `pnpm test` — 9 files, 68 tests passed (includes 8 new `settings.notifications` cases covering catalog listing, channel resolution defaults, push-only types, per-channel disable, full-type disable, schedulable validation, time persistence, and reset).
- `pnpm --filter @ak-system/web exec playwright test notification-preferences` — 2/2 passed (page loads with catalog + channel status; settings link navigates to the hub).
- `pnpm --filter @ak-system/web build` — success; `/settings/notifications` prerendered (2.93 kB).
- `pnpm -r run lint` — `tsc --noEmit` passes for `apps/mobile` and `apps/whatsapp-bridge`. `apps/web`'s `next lint` fails at an interactive "configure ESLint" prompt — a pre-existing repo condition (no ESLint config), unrelated to this change; type safety for web is covered by the successful build.

Note: the first `pnpm test` invocation appeared to hang; this was slow first-run `drizzle-kit push` I/O on the Google Drive-backed workspace, not an interactive prompt. Re-runs and the isolated push complete in ~1.5s and report the new table as a clean additive change.

## Reviewer Verdict

**APPROVED WITH NITS**

- Implementation matches the spec: one catalog, per-type × per-channel routing gated in `pushAssistantMessage` and the WhatsApp/Hugo push paths, editable times for the two daily briefings with per-slot dedup, and a single `/settings/notifications` hub.
- Additive, backwards-compatible schema and fan-out (no `typeId` = prior behavior); reuses existing `agent_triggers`/`whatsapp` conventions.
- Nit carried from pre-review: `next lint` remains unconfigured at the repo level (out of scope here).

## UI/UX Review (post-implementation)

**Verdict:** APPROVED
**Detected stack:** `next-trpc-monorepo`

- Design system: reuses `.card`/`.btn`/`.input`, dark theme, gold `#e8c547`, and the `role="switch"` Toggle. RTL preserved; back-link pattern matches `/settings/whatsapp`.
- Feedback states: loading skeleton, per-row "שומר…", disabled channel toggles with `title` reason when a channel is not connected, `window.confirm` before reset, and a status line for messages.
- Pre-review nits addressed: disconnected channels are disabled with a reason; time input validates `HH:MM` and blank input falls back to the type default; the device-push enable/test control stays on the main settings page.

## UI/UX Review (pre-implementation)

**Verdict:** APPROVED WITH NITS
**Detected stack:** `next-trpc-monorepo`

### Design System Checklist
- [x] Matches project tokens/classes — page reuses `.card`/`.btn`, dark theme, gold `#e8c547`, and the `Toggle` switch pattern already used in `settings/page.tsx` and `settings/whatsapp/page.tsx`.
- [x] RTL layout preserved — page is Hebrew RTL like the rest of `/settings`.
- [x] Mobile layout works — single-column card list, same as existing settings sections.
- [x] No unapproved UI frameworks introduced — plain React + Tailwind + tRPC client.
- [x] Reuses existing components — `Toggle`, `Section`/`Row` visual language, `trpc` hooks.

### UX Quality Checklist
- [x] Clear visual hierarchy — grouped by category (system briefings / agents / WhatsApp) with a channel-status header.
- [x] Cognitive load minimized — one row per notification type; only the channels that actually apply are shown.
- [x] Feedback states handled — loading skeleton on `list`, per-row saving state, disabled toggles when a channel is not connected, reset confirmation.
- [ ] Destructive actions — "שחזר ברירות מחדל" is mildly destructive; add a lightweight inline confirm rather than a full modal (nit).
- [x] Microcopy — verb-first buttons, human Hebrew descriptions per type ("15 דקות לפני כל פגישה", "נשלח כשמשימה מגיעה למועד או באיחור").
- [x] Touch targets / focus — reuse existing `role="switch"` toggles (already focusable, ≥40px wide).

### Findings
- Must-fix: none.
- Nits:
  1. When a channel is not connected (e.g. Telegram token missing), disable that column's toggle and show a short reason ("Telegram לא מחובר") instead of letting the user toggle something that has no effect.
  2. For schedulable types, validate the time input as `HH:MM` and ignore empty input (fall back to the type default) so a blank field never silently disables scheduling.
  3. Keep the existing device-push enable/test control on the main settings page; the new page manages per-type routing, not browser permission.
