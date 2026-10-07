# Harness → Agent integration

## Goal

The harness already builds a cross-domain world model and writes insights, but nothing in the
agent layer can read it. Hugo assembles his own picture from ~40 single-domain tools and never
sees a link that spans two of them. This wires the harness into the agent engine as a first-class
tool, routes urgent harness pushes through Hugo so he adds judgment instead of shipping a raw
template, and fixes the widget's dead "פתח כרטיס" link.

## User stories

1. As Alpir, when I ask Hugo "מה חשוב עכשיו" he mentions the cross-domain links the harness found
   — not just today's calendar and tasks — and tells me what to do about them.
2. As Alpir, when an `urgent` insight fires, the push I get is Hugo's judgment on it, not a bare
   list of detector output.
3. As Alpir, when I ask Hugo about a specific person, he can see that person's full signal set
   (meetings, commitments, chat activity, open insights) in one call.
4. As Alpir, clicking "פתח כרטיס" on an insight opens that person's detail drawer.

## Acceptance criteria

### Tool: `get_harness_insights`

- [ ] Declared in `conversation-engine.ts`'s tool list and gated through the existing
      `getToolDeclarations(agentId)` filter to the three agents that need cross-domain context:
      `01_Hugo_orchestrator`, `03_morning_briefing`, `04_meeting_prep_herald`. Also available in
      the general `/chat` assistant, which passes no `agentId`.
- [ ] Every other specialist does not see the tool at all, so it costs them no prompt budget and
      cannot pull them off-domain. Opening it up later is one entry in that set.
- [ ] Optional `personId` argument. Without it, returns `harness.worldState` — domain counts,
      freshness, and top open insights. With it, returns `harness.personSignals` for that person.
- [ ] Returns insight `title`, `body`, `severity`, `kind`, and `sources` (so the agent can cite
      *why*), never raw WhatsApp text or transcript bodies.
- [ ] Dispatched in the `executeTool` switch via the existing `caller.harness.*` procedures — no
      new tRPC surface needed.

### Hugo system instruction

- [ ] The Chief of Staff block gains one line adding `get_harness_insights` to the multi-source
      scan for vague asks (מה חשוב / מה המצב / תכין אותי), alongside the existing calendar and
      Notion depth passes.
- [ ] A named-person ask may call `get_harness_insights` with `personId` as part of the depth pass.
- [ ] No change to the delegation rules — the harness is one of Hugo's *own* tools, not a
      specialist to delegate to.

### Notification routing

- [ ] A notification type may declare `defaultAgentId` — an agent that actually runs the event
      when the user has routed nothing, as opposed to the existing `suggestedAgentId` which is
      only displayed in the picker. `runEventAgentIfRouted` reads it from `NOTIFICATION_TYPES`,
      so the default is declarative rather than hardcoded per cron.
- [ ] `harness_insight` declares `defaultAgentId: '01_Hugo_orchestrator'`, so the urgent push
      runs through Hugo (`mode: 'agent'`) instead of the deterministic template.
- [ ] An explicit routing in the UI always wins over the default, and a `triggerMessage` left
      behind by a since-cleared routing is not applied to the default agent.
- [ ] The template fallback stays intact when the agent run throws — the cron catches, logs, and
      pushes the deterministic list rather than returning a 500 and sending nothing.
- [ ] `dedupeSlot` suppression applies to the default agent exactly as to a routed one.
- [ ] Not seeded into `notification_preferences`. Seeding happens inside the one-shot migration
      guarded by `agent_schedules_migrated_at`, which has already run in production, so a seed
      would silently never apply there. Declaring the default keeps config and behaviour in sync
      on every box.
- [ ] The routing picker shows "ברירת מחדל: הוגו" rather than "תבנית מערכת (ללא סוכן)" for a
      type that has a `defaultAgentId`, so the UI does not claim the event is unrouted.

### Widget deep link

- [ ] `/people?person=<id>` opens `PersonDetailDrawer` for that person on mount.
- [ ] An unknown or missing id renders the normal people list with no drawer and no error.
- [ ] The param is cleared from the URL when the drawer closes, so a refresh doesn't reopen it.

## Data model changes

None. All three harness tables and the `harness_insight` notification type already exist, and
the default routing is config in `NOTIFICATION_TYPES` rather than a row. No schema edit, no
bootstrap SQL, nothing to apply on deploy.

## tRPC API shape

No new procedures. Consumes the existing `harness.worldState`, `harness.insights`, and
`harness.personSignals`.

## UI surface

- `apps/web/src/app/people/page.tsx` — read `?person=` and seed `drawerPersonId`, via a small
  Suspense-wrapped child following the existing `OpenNewMeeting` pattern on the meetings page.
- `apps/web/src/app/settings/notifications/page.tsx` — honest label for a defaulted event.
- No change to `HarnessWidget.tsx`; its link is already correct, the destination just ignores it.

## Design note — read access vs. authority

The "one agent that centralises the insights and says what matters" role stays Hugo's, and it is
enforced by two things that are *not* the tool: the `harness_insight` push routes only to him, and
only his system instruction tells him to consult the harness when synthesising "מה חשוב". The
other two agents get read access for their own narrow job — the meeting-prep herald should know
there is an unanswered thread with the person he is briefing you on, the same way he already
pulls that person's Notion tasks. Neither of them sends harness notifications or ranks insights.

## Out of scope

- Giving the remaining five specialists the tool (`02`, `05`, `06`, `07`, `08`). No cross-domain
  need identified for them yet, and each extra tool costs prompt budget in every one of their runs.
- Any detector tuning (`unanswered_thread` noise, `TRIGGERED_SPEND` edge volume) — separate pass
  once there is a week of real signal.
- A "run harness now" button in the widget.
- Exposing harness data to the mobile app.

## Open questions

1. Should the tool be capped at a lower insight count for WhatsApp replies, where Hugo's output
   budget is tighter? Starting with the same cap as the dashboard (12) and will tune if replies
   get long.
