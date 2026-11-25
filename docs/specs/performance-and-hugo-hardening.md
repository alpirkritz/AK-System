# Performance pass + Hugo harness hardening

Status: Phase A approved by the owner on 2026-11-25 and implemented, together with Phase C (added at his request). Phase B stays open except where noted. See `reports/performance-and-hugo-hardening.md`.

## Goal

1. Make the web UI and backend faster without changing any behaviour.
2. Fix defects found in the Hugo harness and list further improvements for the owner to choose from.

Findings come from three read-only audits (UI, backend/DB, Hugo). Items marked ✔ were re-checked against the source by hand; the rest are as reported by the audit and will be re-checked before they are touched. Nothing was measured at runtime: no bundle sizes, no query timings, no production row counts.

Context that shapes priorities:

- Production runs on **SQLite** (`deploy/docker-compose.production.yml:20`), and the local DB is 7 MB. Index and scan wins are therefore small; the recurring cron work and the extra network round-trips matter more.
- `getDb()`, tRPC context creation, React Query defaults, code splitting and timer cleanup were all checked and are already fine. They are not in scope.

## Phase A — behaviour-neutral (proposed to implement now)

### A1. Backend

| # | Change | Where | Why |
|---|---|---|---|
| A1.1 ✔ | Fetch `calendar.upcoming` first; return if nothing is in the 15-minute window; only then load meetings, people, tasks and routing. | `apps/web/src/app/api/cron/pre-meeting-briefing/route.ts:70-88` | The cron runs every 5 minutes and loads three whole tables before an early exit that almost always fires. |
| A1.2 ✔ | Push the `timeRange` filter into SQL (`eq` / `gte` / `lte` on `meetings.date`, same computed strings). Skip the two `inArray(<every id>)` clauses when the list is unfiltered. | `packages/api/src/routers/meetings.ts:149-181` | Today the whole table is selected and filtered in JS. |
| A1.3 ✔ | `unreadCount` returns `count(*)` (wrapped in `Number()`) instead of selecting every id. Same in `apps/web/src/app/api/notifications/route.ts:56-59`. | `packages/api/src/routers/notifications.ts:29-35` | Polled every 30 s by the notification bell. |
| A1.4 | `whatsapp.forTool` aggregates with `GROUP BY group_jid` instead of reading every message row. Output order is kept by sorting to match today's order. | `packages/api/src/routers/whatsapp.ts:667-679` | Full scan of `whatsapp_messages` on each Hugo tool call. |
| A1.5 | Bulk notification updates (`markRead all`, `archiveAll`) use one `UPDATE` instead of one per row; the returned `updated` count is preserved. | `notifications.ts:58-69, 127-152` | N writes, each its own commit. |
| A1.6 | Add indexes: `chat_messages(created_at)`, `agent_messages(agent_id, created_at)`, `whatsapp_messages(ts)`. | `schema.pg.ts`, `schema.ts`, bootstrap SQL in `packages/database/src/index.ts` | Each backs an existing `ORDER BY … LIMIT` or range delete. |

### A2. Web UI

| # | Change | Where | Why |
|---|---|---|---|
| A2.1 ✔ | Dashboard passes `worldFilter ? { workspaceId: worldFilter } : undefined`, matching the tasks and meetings pages. | `apps/web/src/app/page.tsx:204-211` | Different input shape means a different cache key, so both lists are refetched on navigation instead of reused. (The refetch itself is inferred from how tRPC builds keys, not observed.) |
| A2.2 ✔ | Sidebar logo uses a small asset (new 80 px PNG) instead of the 193 KB 512 px file. | `components/DashboardLayout.tsx:180-185` | Loaded on every page. |
| A2.3 ✔ | Debounce the finance symbol filter (~250 ms) and set `keepPreviousData`. | `app/finance/page.tsx:91-94` | One query per keystroke; the table blanks between keys. |
| A2.4 | Stabilise memo inputs: `useCallback` for `getPerson`; hoist the default sort object to a module constant. | `meetings/page.tsx:216`, `page.tsx:227`, `tasks/page.tsx:151` | Memos recompute on every render. Small gain. |
| A2.5 ✔ | Meeting detail page uses `tasks.listByMeeting` instead of fetching all tasks and filtering; invalidations at lines 82 and 105 are extended to cover it. | `meetings/[id]/page.tsx:31, 152` | Fetches the full task table for one meeting. |

### A3. Hugo — defects with no intended-behaviour change

| # | Change | Where |
|---|---|---|
| A3.1 ✔ | Swap the arguments: `sendWhatsAppMessage(reply, payload.chatJid)`. Today the async WhatsApp path (`WHATSAPP_ASYNC_REPLY=1`) can never deliver a reply and retries the job. | `app/api/cron/agent-jobs-worker/route.ts:49` |
| A3.2 ✔ | The "retry without tools" after `MALFORMED_FUNCTION_CALL` actually builds a model without tools. Today `const noToolModel = model`. | `lib/gemini-agent-engine.ts:714` |
| A3.3 | Stop the double push on WhatsApp replies: pass `notifyOnComplete: false`, since the bot already pushes itself. | `lib/whatsapp-bot.ts:166` (default is `true` at `agent-runner.ts:37` ✔) |
| A3.4 | Key parallel tool results by call, not by tool name, so two calls of the same tool in one round do not overwrite each other. | `gemini-agent-engine.ts:584` |
| A3.5 | One backoff retry on a 429 using the existing `extractRetryAfter`, before giving up. | `gemini-agent-engine.ts` (~`:1000`) |
| A3.6 | Record real token usage (`usageMetadata`), the real model id, and the actual tool list on error rows in `agent_run_logs`. | `gemini-agent-engine.ts` logger calls |

## Phase B — needs an owner decision (not implemented without sign-off)

Each of these changes what Hugo or the app does, so each is a separate yes/no.

- **B1. Telegram webhook authentication.** ✔ There is no `secret_token` check; only `chat.id` from the request body is compared (`lib/telegram-bot.ts:56`). A forged POST could drive Hugo's write tools. Fix: register the webhook with a secret and verify the header. Needs a new env var and re-registering the webhook, which is why it is here and not in Phase A. **Recommended.**
- **B2. Failed runs are delivered as briefs.** Rate-limit and empty-answer text is saved to history, pushed to WhatsApp and marked `ok` (`agent-trigger-runner.ts:252-262`). Fix: the engine returns a status; on failure, skip the push and the history save and mark the run as an error. **Recommended.**
- **B3. Schedule/event dedupe race.** The slot stamp is written after the run with the completion time, so a run crossing a minute boundary, or two crons starting together, can double-fire (`agent-schedules.ts:260, 343`). Fix: claim the slot before running (new `last_run_slot` column in both schemas).
- **B4. Network fallback re-runs the whole loop**, repeating any `create_task` or `add_meeting_notes` already executed (`gemini-agent-engine.ts:1036`). Fix: skip the fallback once a write tool has run.
- **B5. Loose write tools.** `find_and_toggle_task` toggles the first substring match; `add_meeting_notes` overwrites; `update_instruction` with `replace` wipes all instructions with no backup; cron runs hold write tools while reading untrusted WhatsApp/Gmail text.
- **B6. `run_abc_agent` is available to every agent** with no depth limit and includes Hugo itself; the sub-run sends its own push.
- **B7. Prompt cost.** Every turn, including "תודה", does one Calendar and four Notion fetches before the first model call. Options: a 60-120 s TTL cache on the two context builders, or drop the Notion prefetch for Hugo and rely on tools.
- **B8. Prompt contradiction.** The four-section "judgment contract" for every reply sits beside "be concise / answer directly". Fix: scope the contract to briefing-style asks.
- **B9. `C_Core` compliance is never loaded on the Gemini path**, although the Hugo card requires it. Either inject a trimmed version or drop the claim from the card.
- **B10. Memory.** Retrieval is newest-60 / 12K chars only; `save_fact` facts are never recalled automatically. Options: dedupe on `remember`, add a `search_memory` tool.
- **B11. Hugo cannot see the briefs it sent from cron**, so "תרחיב על סעיף 2" has no referent.
- **B12. UI items with a visible trade-off:** split slow Google Calendar queries out of the shared tRPC batch (`lib/trpc.ts`); skip the on-mount calendar sync on `/meetings` and `/calendar` if one ran in the last ~2 minutes; gate modal-only queries behind `enabled: modalOpen`.
- **B13. Backend items with a trade-off:** preload maps in `notion-graph-sync.ts` to remove per-row lookups; skip unchanged rows in calendar sync (changes `updatedAt` semantics); raise SQLite `cache_size` (memory on the 1 GB box).

## Phase C — a smarter Hugo (owner request, 2026-11-25)

The owner reported three problems: Slack is now a channel and Hugo knows nothing about it; the harness mixes up the `Algo` (core) and `Algo 4.0` projects; and meeting summaries say his relationship with "Alpir Kritzler" cooled, which is himself. Telegram is not in use, so B1 is dropped.

| # | Change | Where | Root cause |
|---|---|---|---|
| C1 | The owner is left out of per-meeting, per-series and per-project people insights, and out of the pre-meeting relationship lines. | `services/warmth.ts` (`peopleInProject`, `meetingInsight`), `services/person-context.ts` (`meetingPrepRelationship`) | The global relationship lists already skipped the owner by name; these three code paths did not, so any meeting he was linked to scored him like any other attendee. |
| C2 | Topic matching treats a version as part of the name. `Algo 4` and `Algo 4.0` are one topic; `Algo 4.0` and plain `Algo` no longer match on `algo` alone. | `lib/topic-match.ts` | Version tokens were dropped, so both project names reduced to the single token `algo`. That match decides which tasks and which previous notes are pulled into a meeting brief. |
| C3 | `get_projects` marks look-alike names with `notTheSameAs`. | `lib/conversation-engine.ts` | The model received two near-identical names with nothing telling it they are distinct. |
| C4 | New Hugo tool `get_slack_activity`, backed by `slack.forTool`: stored Slack messages filtered by channel, sender, text and time window, with the owner's own messages marked. | `routers/slack.ts`, `lib/conversation-engine.ts` | Hugo had WhatsApp, Gmail and Notion tools but none for Slack. |
| C5 | Every agent prompt gets an "Exact names and sources" block: versions are part of project names, the owner is never a relationship subject, and Slack / WhatsApp / email are separate sources. | `lib/gemini-agent-engine.ts` (`ENTITY_PRECISION_PROMPT`) | Backs C1-C4 on the model side. |

C2 is a deliberate behaviour change: a task or note titled only `Algo …` no longer attaches to an `Algo 4.0` meeting, and the reverse. One existing test that encoded the old behaviour was updated.

Not done in this pass, with the reason:

- A2.5 (meeting page → `tasks.listByMeeting`): other components invalidate `tasks.list` after edits, so the switch could leave the meeting's task list stale.
- A3.4-A3.6 (tool results keyed per call, 429 retry, token usage in run logs): the retry can repeat write tools that already ran, and token logging needs new columns. Both belong with B4 and a schema change.
- A1.5 is implemented as "one `UPDATE` with the same `WHERE`", keeping the preceding select for the returned count.
- A1.4 applies to `whatsapp.messages.stats` (the settings page), which is where the full scan was; `forTool` was already bounded.

## Data model changes

Phase A: three indexes only (A1.6), added to `schema.pg.ts`, mirrored in `schema.ts`, plus `CREATE INDEX IF NOT EXISTS` in the SQLite bootstrap. No columns, no tables.

Phase B3 would add `agent_schedules.last_run_slot` (text, nullable) to both schemas.

## tRPC API shape

No procedure is added, removed or re-typed in Phase A. Inputs and outputs stay identical; only how results are computed changes.

## UI surface

No visual change except A2.3 (typing in the finance symbol filter no longer blanks the table). The UI Designer step is not required.

## Acceptance criteria

- `pnpm test`, `pnpm e2e`, `pnpm -r run lint` and `pnpm --filter @ak-system/web build` pass.
- New Vitest cases: `meetings.list` returns the same rows for each `timeRange` as before; `unreadCount` and bulk mark-read/archive return the same counts; `forTool` returns the same per-group stats.
- `pre-meeting-briefing` with no meeting in the window does not call `meetings.list`, `people.list` or `tasks.list`.
- The agent-jobs worker calls `sendWhatsAppMessage` with text first.
- Reviewer verdict in `reports/performance-and-hugo-hardening.md`.

## Risks

- The working tree has uncommitted owner changes in files this touches (`routers/meetings.ts`, `agent-trigger-runner.ts`, `database/src/index.ts`, both schema files). Edits will be minimal and layered on top; nothing is reverted or reformatted.
- A1.3 on Postgres: `count(*)` returns a string, hence the `Number()` wrap.
- Nothing here is deployed; `pnpm deploy:ec2` stays with the owner.

## Out of scope

- `voice/page.tsx`, `settings/*`, finance/voice/harness services and `harness-reasoner.ts` internals were not audited.
- The Cursor engine path.
- Any change to agent cards or workflows in `A_Agents/` / `S_Skills/`.

## Open questions

1. Approve Phase A as listed?
2. Which Phase B items do you want? B1 and B2 are the ones I recommend first.
3. Is `WHATSAPP_ASYNC_REPLY=1` set in production? If so, A3.1 is a live bug today.

## Phase D — meeting and recording flow (owner request, 2026-11-25)

Walked in the browser against local data: meetings list → meeting page → recording page, desktop and phone width. Local data has no recordings and no analysed meetings, so the after-recording states (upload, transcription, speaker naming, analysis) were read in code only, not seen running.

Implemented (small, no data or API change):

| # | Change | Where | Why |
|---|---|---|---|
| D1 | On a meeting that is today or later, "🎙 הקלט פגישה" is the primary action and comes first; "+ משימה" becomes secondary. Past meetings keep "+ משימה" as primary. | `meetings/[id]/page.tsx` | Recording was the fourth button and off-screen on a phone, exactly when it is the next step. |
| D2 | "📋 צור סיכום" is now "📋 העתק סיכום". | `meetings/[id]/page.tsx` | The button copies a summary to the clipboard; it does not create one. |
| D3 | Each meeting row on the recording page carries a visible "🎙 הקלט" chip. | `voice/page.tsx` (`MeetingRow`) | Arriving from a meeting, the only labelled button was "הקלטה חופשית — בלי הפגישה"; recording the meeting itself meant guessing that its card is clickable. |
| D4 | The meetings list shows "טוען פגישות…" while loading. | `meetings/page.tsx` | It showed "אין פגישות קרובות" for a few seconds before the list arrived. |

Proposed, not implemented (each changes layout or behaviour and needs a decision):

- **Recording page arriving from a meeting**: the free-recording form (people, project) still fills the main column although the meeting already supplies both. Show the meeting as the main card with one large start button, and fold the free-recording form away.
- **"נתח שיחה" on a meeting with nothing to analyse**: a future meeting with no notes or recording shows a prominent analyse button. Hide it until there is a note, a transcript or a recording, and say what is missing.
- **Meeting page before vs after**: an upcoming meeting should lead with preparation (prep brief, attendees, open items); a past one with the analysis and decisions. Today both show the same stack.
- **Calendar attendees vs "עדיין אין משתתפים בפגישה"**: the page says there are no participants while the circle card says "9 משתתפים ביומן". Show the calendar attendees as unlinked chips with a one-tap link.
- **Series list**: 27 instances are listed in full, future first, with the current one in the middle. Collapse to the nearest few around the current one.
- **After recording**: the meeting page gives no sign that a recording for it is uploading or being transcribed; the status lives only on the recording page.

## Phase E — system summaries first, and the post-recording button (owner request, 2026-11-25)

| # | Change | Where | Root cause |
|---|---|---|---|
| E1 | The daily meeting summary is built from the system's own analyses of today's meetings. A Notion note is included only for a meeting with no analysis here. | `api/cron/daily-meeting-summary/route.ts` | The cron's context was headed "Today's AI Meeting Notes (primary source)" and contained Notion notes only; `meeting_analyses` was never read. |
| E2 | New `insights.meetingSummaries` and Hugo tool `get_meeting_summaries`; `get_notion_meeting_notes` is described as the fallback and also returns `systemSummaries` for the same filter. | `services/meeting-summaries.ts`, `routers/insights.ts`, `lib/conversation-engine.ts` | Hugo had no tool that reads the system's analyses, so Notion was its only source of meeting summaries. |
| E3 | Prompt rule for every agent: system summaries are the primary record, Notion is a fallback, and this overrides later Notion-first wording. | `lib/gemini-agent-engine.ts` | Several existing prompt lines name Notion as the summary source; they were left in place and outranked. |
| E4 | `today` / `tomorrow` date arguments now also accept `yesterday` / `אתמול` (previously read as today). | `lib/calendar-dates.ts` | Needed for "what happened yesterday". |
| E5 | The confirm button after a recording says "סכם פגישה" instead of "העלה שיחה". | `voice/page.tsx` | The button uploads the recording and sends it to Gemini for a summary. |

Not changed: the mobile app still says "העלה שיחה" (`apps/mobile/app/(tabs)/record.tsx`, `import-recording.tsx`); that needs an APK build. The older Notion-first prompt lines and the meeting-prep grounding check that requires `get_notion_meeting_notes` are still there.
