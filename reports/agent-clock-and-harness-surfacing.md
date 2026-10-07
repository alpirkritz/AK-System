# Review — agent-clock-and-harness-surfacing

Spec: [docs/specs/agent-clock-and-harness-surfacing.md](../docs/specs/agent-clock-and-harness-surfacing.md)

**Verdict: APPROVED** — both defects reproduced from production data, fixed, and shipped to EC2.

## Diagnosis

The run was found in `agent_run_logs` (2026-10-06T12:07:12Z, `01_Hugo_orchestrator`, channel
`web`, status `ok`):

```
tools_called: ["get_harness_insights","whatsapp_now"]
gemini_calls: 1
finish_reason: STOP
```

So the harness integration worked — Hugo called the tool first. The failure was downstream: he
had twelve open insights in hand and wrote an answer composed entirely of prefetched calendar
and Notion context. Nothing forced the result into the reply.

The greeting was a separate, simpler gap: `buildSystemInstruction` passed only
`Today is <date>` and never a clock, so "בוקר טוב" at 15:07 was the model filling in a blank.

## What changed

### Clock
- [gemini-agent-engine.ts:106](../apps/web/src/lib/gemini-agent-engine.ts#L106) — `formatDateLabel`
  now passes `timeZone`, and a new `formatClockLabel` supplies `HH:MM`. The instruction reads
  `Now: <date>, HH:MM (<iso>, Asia/Jerusalem)` plus an explicit rule against a contradicting
  time-of-day greeting.
- [conversation-engine.ts](../apps/web/src/lib/conversation-engine.ts) — same clock line and rule
  for the general `/chat` assistant, which had the identical date-only gap.

The missing `timeZone` was a real latent bug, not just cosmetics. Verified on EC2 after deploy:

```
TZ=Asia/Jerusalem
date -u  → 12:16      # container clock is UTC
zoned    → 15:16      # what the agent now sees
```

Before the fix, `toLocaleDateString` used the container zone, so any request after 21:00 Israel
time reported the previous day's date to every agent.

### Harness surfacing
- [gemini-agent-engine.ts](../apps/web/src/lib/gemini-agent-engine.ts) — Hugo's judgment contract
  now requires a `קישורים בין תחומים:` section whenever the tool returned insights, including the
  case where he judges none actionable (keep the section, say why in one line).
- A deterministic guard in `runChatLoop`: if `get_harness_insights` returned ≥1 insight and the
  reply lacks that header, one forced retry. Follows the existing `MEETING_PREP_GROUNDING_RETRY`
  and deferred-delegation patterns, with `maxIterations: 0` so the retry cannot call more tools.
- The retry is only taken if it produced text, so a failed retry never trades away a good answer.

## Tests added

`gemini-agent-engine.harness-surfacing.test.ts` — 6 cases: clock present and greeting rule
asserted; retry fires and its text is kept; no retry when the section is already there; no retry
when the harness returned nothing; original answer preserved on an empty retry; other agents
unaffected.

Six existing suites that mock `@ak-system/api` needed `getDefaultTimezone` added to their mock
surface.

## Gates

| Gate | Result |
|---|---|
| `pnpm --filter @ak-system/web exec vitest run` | 36 files, 274 passed |
| `pnpm -r run lint` | exit 0 |
| `pnpm --filter @ak-system/web build` | exit 0 |
| EC2 zoned clock | container UTC 12:16 → agent sees 15:16 |

## Findings

### Nit — the guard keys on a Hebrew header, so an English-language reply would retry forever (once)

`HARNESS_SECTION_HEADER` is `קישורים בין תחומים`. If Hugo ever answers in English he would not
emit it, so the single retry fires and is then accepted regardless. Bounded at one extra Gemini
call and the reply is still delivered, so the blast radius is a little latency. Matching on
either language would be a one-line change if English replies become common.

### Observation — a prompt rule plus a retry is a weaker mechanism than injected context

The open question in the spec stands: the durable fix is probably to inject the insights into
the prefetched context block the way calendar and Notion context already are, rather than relying
on a tool call the model may ignore. The retry was chosen because it is bounded and observable —
every occurrence lands in `agent_run_logs` as a run with `gemini_calls: 2`. If that count is
routinely 2 for Hugo, switch to injection.

### Observation — all twelve insights being one detector may be the real reason he dismissed them

Every current insight is `unanswered_thread`. A set that uniform plausibly read as low-signal.
Detector calibration stays out of scope until the links are actually visible in his answers,
which is what this change makes true.
