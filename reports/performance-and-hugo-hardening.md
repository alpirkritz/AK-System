# Review — performance pass + Hugo hardening

Spec: `docs/specs/performance-and-hugo-hardening.md` · Date: 2026-11-25

## Verdict: APPROVED WITH NITS

Vitest, lint and the web build pass. Playwright is not green, and the failures that were re-checked fail identically without the UI changes of this work (details below). Nothing is committed or deployed.

## What changed

Backend performance
- `cron/pre-meeting-briefing`: checks the 15-minute window before loading meetings, people and tasks.
- `meetings.list`: `timeRange` filtered in SQL; no `IN (<every id>)` on an unfiltered list.
- `notifications.unreadCount` and `GET /api/notifications`: `count(*)`. Mark-all-read, archive-all and its undo: one `UPDATE` each.
- `whatsapp.messages.stats`: `GROUP BY` instead of one row per message.
- Indexes in both schemas and the SQLite bootstrap: `chat_messages(created_at)`, `agent_messages(agent_id, created_at)`, `whatsapp_messages(ts)`.

Web UI performance
- Dashboard uses the same query input as the tasks and meetings pages (shared cache entry).
- Sidebar logo is a new 14 KB file (`public/icons/aro-logo-96.png`) instead of the 193 KB one.
- Finance symbol filter is debounced (250 ms) and keeps the previous rows while loading.
- Stable default-sort object on the dashboard and tasks page; `getPerson` memoised on the meetings page.

Hugo defects
- Async WhatsApp worker passed `(chatJid, reply)` to `sendWhatsAppMessage(text, to)`; fixed.
- The "retry without tools" after a malformed function call now turns function calling off.
- WhatsApp replies no longer trigger two pushes.

Hugo, smarter (spec Phase C)
- The owner is excluded from per-meeting, per-series and per-project people insights and from pre-meeting relationship lines.
- Topic matching treats a version as part of the name, so `Algo` and `Algo 4.0` stay apart.
- `get_projects` flags look-alike project names.
- New tool `get_slack_activity` (`slack.forTool`).
- An "Exact names and sources" block in every agent prompt.

Meeting and recording flow (spec Phase D)
- Record is the primary action on a meeting that is today or later; the copy-summary button is named for what it does.
- Meeting rows on the recording page show a visible record chip.
- The meetings list no longer shows its empty message while loading.
- Checked in the browser on desktop and at 375 px. The after-recording states were not exercised: local data has no recordings.

## Checks

| Check | Result |
|---|---|
| `pnpm test` | Pass: 146 files / 1580 tests (api), 49 files / 331 tests (web) |
| `pnpm -r run lint` | Pass: 0 errors, existing warnings only |
| `pnpm --filter @ak-system/web build` | Pass |
| `pnpm e2e` | 121 passed, 2 skipped, the rest failed (exit 1) |

New tests: `packages/api/src/routers/performance-and-hugo.test.ts` (5) and three cases in `lib/topic-match.test.ts`. One existing case in `apps/web/src/lib/pre-meeting-brief.test.ts` asserted that an `Algo 4.0` task attaches to an unversioned `Algo` meeting; it was changed to assert the opposite, which is the behaviour the owner asked for.

## Playwright failures

Failing specs seen: `full-flow`, `meeting-conversation-analysis`, `multi-level-sort`, `trading-journal`, `task-assignee`, `slack-settings`, `notion-note-meetings`, `project-page-polish`, `calendar-link-and-commitment-task-modal`, `meeting-relationships`, `people-meeting-panel`. Only the last 40 lines of the full run were captured, so this list may be incomplete and the exact failed count was not recorded.

- `full-flow`, `meeting-conversation-analysis`, `multi-level-sort`, `trading-journal` (9 tests) were re-run with the five UI files of this work restored to `HEAD`: the same 9 failed. The backend changes were still in place for that run, so it rules out the UI edits only.
- `notion-note-meetings` and `project-page-polish` fail while seeding, inside the spec files (`FOREIGN KEY constraint failed`, `table people has no column named updated_at`).
- `task-assignee` expects the text "Alpir Kritzler" where the modal shows "אני".
- `trading-journal` fails on a locator that matches two elements.
- `slack-settings`, `calendar-link…`, `meeting-relationships`, `people-meeting-panel` were not investigated.

## Nits and follow-ups

- No runtime measurement was taken; the gains are argued from the code.
- Spec items not done, each with its reason in the spec: A2.5, A3.4-A3.6.
- Spec Phase B (B2-B13) is still open. B1 (Telegram) was dropped by the owner.
- Production applies the new indexes through `pnpm db:push` on container start and the bootstrap SQL.
- `apps/web` has many existing `tsc` errors (the build sets `ignoreBuildErrors`), so type-checking was not usable as a gate for this change.

## Re-applied on release-12 — 2026-11-26

Verdict: APPROVED WITH NITS.

The change was re-applied on top of release-12 (`fecb171`); the differences are listed in the spec under "Integration onto release-12".

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/api test` | Pass: 151 files / 1638 tests |
| `pnpm --filter @ak-system/web test` | Pass: 54 files / 353 tests |
| `pnpm -r run lint` | Pass |
| `tsc --noEmit` in `packages/api` | 0 errors |
| `pnpm e2e` | Not run for this re-application |

Nits
- The sections above this one describe the first implementation; where they disagree with this section (daily summary cron, the "סכם פגישה" label, test counts), this section and the spec are current.
- Meeting prep and the new tools were not exercised against production recordings before deploy.

