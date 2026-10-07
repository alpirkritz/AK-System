# Review — harness-agent-integration

Spec: [docs/specs/harness-agent-integration.md](../docs/specs/harness-agent-integration.md)

**Verdict: APPROVED WITH NITS** — shipped to EC2 and verified on the box, with one acceptance
criterion that can only be confirmed by using the app (see Not verified).

## What changed

### Tool
- [conversation-engine.ts](../apps/web/src/lib/conversation-engine.ts) — `get_harness_insights`
  declaration, `HARNESS_TOOL_AGENT_IDS` gating inside the existing `getToolDeclarations(agentId)`
  filter, and the `executeTool` case. Returns `basedOn` strings built from each insight's
  `sources`, and drops `nodeId` and node summaries so the prompt gets the derived layer only.
- Gated to `01_Hugo_orchestrator`, `03_morning_briefing`, `04_meeting_prep_herald`, plus the
  general `/chat` assistant (which passes no `agentId`). The other five specialists do not see
  the declaration at all.

### Prompts
- [gemini-agent-engine.ts:259](../apps/web/src/lib/gemini-agent-engine.ts#L259) — the harness is
  now a mandatory leg of Hugo's multi-source scan for vague asks, with instructions to cite
  `basedOn` rather than restate an insight as his own finding, and to say nothing when the tool
  returns empty.
- [conversation-engine.ts](../apps/web/src/lib/conversation-engine.ts) — equivalent line in the
  general chat system instruction.

### Default routing
- [notification-preferences.ts](../packages/api/src/services/notification-preferences.ts) — new
  `defaultAgentId` field on a notification type, distinct from the display-only
  `suggestedAgentId`; `harness_insight` sets it to `01_Hugo_orchestrator`.
- [notification-event-runner.ts](../apps/web/src/lib/notification-event-runner.ts) — reads that
  default from `NOTIFICATION_TYPES` when nothing is routed. An explicit routing wins, and a
  `triggerMessage` orphaned by a cleared routing is not applied to the default agent.
- [cron/harness-insights/route.ts](../apps/web/src/app/api/cron/harness-insights/route.ts) —
  catches an agent failure and falls back to the deterministic template instead of 500-ing and
  sending nothing.
- [settings/notifications/page.tsx](../apps/web/src/app/settings/notifications/page.tsx) — the
  empty picker option reads "ברירת מחדל: הוגו" for a defaulted type.

### Deep link
- [people/page.tsx](../apps/web/src/app/people/page.tsx) — `OpenPersonFromQuery` reads
  `?person=` and seeds `drawerPersonId`, then clears the param. Follows the existing
  `OpenNewMeeting` pattern on the meetings page, including the Suspense boundary
  `useSearchParams` requires.

## Tests added

- `conversation-engine.harness-tool.test.ts` — 8 cases: gating for the three agents and the
  general chat, exclusion of the five specialists, optional-parameter shape, world-state
  response, no leak of `nodeId`/`sources`, severity filter, unrecognised severity ignored rather
  than emptying the list, and the `personId` branch.
- `notification-event-runner.test.ts` — 6 cases: default applied, explicit routing wins,
  orphaned trigger message ignored, `not_routed` preserved for a type with no default, no
  default invented for an unknown type, `dedupeSlot` honoured for the default agent.
- `gemini-agent-engine.calendar-brief.test.ts` — 2 cases on the Hugo prompt block.

## Gates

| Gate | Result |
|---|---|
| `pnpm --filter @ak-system/web exec vitest run` | 35 files, 268 passed |
| `pnpm --filter @ak-system/api exec vitest run` | 105 files, 1178 passed |
| `pnpm -r run lint` | exit 0, no new warnings |
| `pnpm --filter @ak-system/web build` | exit 0 |
| EC2 `/api/cron/harness-insights` | `{"ok":true,"indexed":{"nodes":1736,"edges":2785},"insights":14,"pushed":false,"reason":"no-urgent"}` |
| EC2 `/people?person=…` | 307 (auth redirect, as expected unauthenticated) |

## Not verified

**Hugo actually calling the tool.** Neither available path exercises it end to end: all 14
current insights are `attention`, so the cron's agent branch does not fire, and production has
no auth bypass (`SKIP_AUTH_IN_PRODUCTION` is unset) so an agent run cannot be triggered by
curl. The declaration gating and the executor are covered by unit tests, and the prompt line is
asserted, but whether Gemini chooses to call it on a real "מה חשוב עכשיו" is a live-behaviour
question. Confirm by asking Hugo that in the app and checking he cites a cross-domain link.

## Findings

### Nit — the `/chat` assistant is gated by the absence of an agentId, not by an allowlist

[conversation-engine.ts](../apps/web/src/lib/conversation-engine.ts) treats `agentId: undefined`
as "general chat, allow". Any future caller that forgets to thread `agentId` through would also
get the tool. The two existing call sites are correct, and the same assumption already governs
`calendarOptimizerHidesTasks`, so this follows the file's convention rather than introducing a
new risk — but an explicit `'chat'` sentinel would be safer if more callers appear.

### Nit — a `?person=` id that matches nothing shows a permanent skeleton

`PersonDetailDrawer` renders its loading skeleton whenever `!person`, with no not-found state
([PersonDetailDrawer.tsx:188](../apps/web/src/components/people/PersonDetailDrawer.tsx#L188)).
Pre-existing for every caller, and insight `personId`s always come from a real `people` row, so
the deep link cannot reach it in practice. Worth a real empty state whenever that file is next
touched.

### Observation — `defaultAgentId` is deliberately not seeded into the database

Seeding would have been the obvious move, but the only seeding hook is inside
`migrateAgentSchedulesOnce`, which short-circuits on `user_settings.agent_schedules_migrated_at`
— already stamped in production. A seed added there would silently never apply on the one box
that matters. Keeping the default in `NOTIFICATION_TYPES` means config and behaviour stay in
sync everywhere with no migration, at the cost of the routing row not reflecting it; the picker
label was changed so the UI does not claim otherwise.

## Security

- No new tRPC surface; the tool consumes existing `protectedProcedure` harness procedures.
- The prompt receives insight titles, bodies, severities and source *labels* only — no raw
  WhatsApp text, transcripts or transaction descriptions, matching the reasoner's own boundary.
  A regression test asserts `nodeId` never appears in the tool payload.
- The cron still honours `CRON_SECRET`.
