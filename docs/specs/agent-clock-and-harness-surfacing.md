# Agent clock awareness + harness surfacing

## Goal

Two defects observed in a live Hugo run (`agent_run_logs`, 2026-10-06T12:07Z, channel `web`,
message "מה חשוב עכשיו?"):

1. He opened with "בוקר טוב" at 15:07 local time. The agent system instruction carries the
   **date** but never the **time**, so any time-of-day phrasing is a guess.
2. He called `get_harness_insights` (confirmed: `tools_called` was
   `["get_harness_insights","whatsapp_now"]`) and then wrote an answer built purely from the
   prefetched calendar and Notion context. Twelve open cross-domain insights were in hand and
   none reached the reply, which is the whole point of the integration.

## User stories

1. As Alpir, an agent never greets me with the wrong time of day, and can reason about how much
   of the working day is left.
2. As Alpir, when the harness has found something, Hugo's answer tells me about it instead of
   silently discarding it.

## Acceptance criteria

### Clock in the prompt

- [ ] The agent system instruction states the current local time alongside the date, formatted
      in `TIMEZONE` (default `Asia/Jerusalem`), e.g. `Now: יום שלישי, 6 באוקטובר 2026, 15:07`.
- [ ] `formatDateLabel()` passes `timeZone` to `toLocaleDateString`. Without it the container
      (UTC) reports the previous day's date for any request after 21:00 Israel time — a latent
      bug independent of the greeting.
- [ ] An explicit rule: never use a time-of-day greeting that contradicts the clock; prefer no
      greeting at all on a direct question.
- [ ] The same clock line is added to the general `/chat` assistant instruction, which has the
      identical date-only gap.

### Harness surfacing

- [ ] Hugo's judgment contract requires that when `get_harness_insights` returns at least one
      insight, the reply carries a `קישורים בין תחומים:` section naming at least one of them
      with what it was based on — or one explicit line saying none are actionable and why.
- [ ] A deterministic guard in the chat loop: if `get_harness_insights` returned ≥1 insight and
      the reply contains neither that header nor the explicit dismissal, force **one** retry
      asking for it, following the existing `MEETING_PREP_GROUNDING_RETRY` and deferred-
      delegation retry patterns. Never more than one extra round.
- [ ] The guard keys on a fixed Hebrew header rather than on matching insight text, because
      person labels arrive transliterated (`Or Zelniker`) while Hugo writes Hebrew
      (`אור זלניקר`) — substring matching would produce false retries.
- [ ] The guard applies to Hugo only. The morning briefing and meeting-prep agents have their
      own output contracts and are out of scope here.

## Data model changes

None.

## tRPC API shape

No change.

## UI surface

None. Both changes are in the agent prompt and chat loop.

## Out of scope

- Detector tuning. All 12 current insights are `unanswered_thread`, which may itself be why the
  set read as low-value to Hugo; that is a separate calibration pass once the links are actually
  visible in his answers.
- Teaching other agents the same surfacing contract.
- Showing the clock to the Cursor engine (`cursor-agent-engine.ts`) — same gap exists there, but
  `AGENT_ENGINE=gemini` is what production runs.

## Open questions

1. If the forced retry proves to fire often, the right fix is probably to inject the insights
   into the prefetched context block rather than relying on a tool call the model may ignore.
   Starting with the retry because it is bounded and observable in `agent_run_logs`.
