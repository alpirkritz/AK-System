# Agent episodes — what the agents already told you, and what you did with it

> **Slug:** `agent-episodes`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Depends on:** `hugo-entity-memory.md` (`extractAnchors`)

## Goal

Record every agent delivery as a short episode linked to the entities it was about. Hugo, the morning briefing and meeting prep then know what Alpir was already told and do not repeat it. Alongside that, insight dismissals and "done" clicks feed back into how loudly each detector speaks.

### Why

- Each agent's output is saved in `agent_messages` under its own `agentId` (`agent-trigger-runner.ts`, `/api/agents/chat`, `telegram-bot.ts`). Hugo's history therefore does not contain what the 07:00 briefing, the 15-minute meeting prep or the harness push said, so he repeats it or contradicts it.
- `agent_run_logs` records metrics (tools, status, duration), not content.
- `HarnessWidget` offers only **dismiss**. A dismissed insight stays dismissed for its own `dedupe_key`, but nothing learns from the pattern. A detector Alpir dismisses 9 times out of 10 still fires at the same severity.

## User stories

- As Alpir, when I ask Hugo "מה חשוב" at noon, I don't want him to repeat the three points from this morning's briefing as if they were new. I want him to say what changed since then.
- As Alpir, when I ask about Dan, I want Hugo to know that meeting prep already briefed me on Dan an hour ago.
- As Alpir, I want insight types I keep dismissing to get quieter, and types I act on to stay loud.
- As Alpir, I want to mark an insight "טיפלתי" and not only "dismiss", so the system can tell useful from noisy.

## Acceptance criteria

### Episodes

- [ ] **New table `agent_episodes`.** An episode is written after every delivered agent reply in these paths:
  - scheduled runs and event runs (`agent-trigger-runner.ts`, `notification-event-runner.ts`);
  - the harness push;
  - Hugo chats on web, WhatsApp and Telegram.
- [ ] Episode content is deterministic, with no LLM call:
  - `summary` is the reply with markdown stripped, reduced to its first 3 bullet or heading lines, at most 400 chars;
  - `anchors` holds `extractAnchors()` run over the full reply, saved as JSON;
  - `insightIds` holds the harness insight ids the run surfaced (from tool results, or from the header in `harness-world-state-header`).
- [ ] Episodes older than 14 days are deleted by the existing `whatsapp-message-retention` daily cron, extended to also prune this table.
- [ ] **Prompt block.** For Hugo, `03` and `04`, a `## מה כבר נאמר לך (24 שעות)` block lists up to 6 episodes:
  - episodes whose anchors overlap the run's anchors come first, then the most recent;
  - each line is `HH:MM · <agent display name> · <summary>`;
  - the block is capped at 1,500 chars.
- [ ] The block carries one rule: do not present something from these episodes as new. Say what changed, or skip it.
- [ ] A run never sees its own episode. The block is built before the reply is written.

### Insight feedback

- [ ] `HarnessWidget` gains a **"טיפלתי"** button next to dismiss. It sets `status = 'acted'` through the new `harness.markActed` procedure.
- [ ] Insights surfaced in an episode and then dismissed or acted within 7 days are counted per detector `kind`.
- [ ] **Downgrade rule.** Over the last 30 days, a kind with at least 6 resolved insights and a dismissal rate of 75% or more is downgraded one severity level (`urgent` → `attention` → `info`) when it is persisted. A downgraded kind is not pushed unless it is still `urgent`.
- [ ] The downgrade is recomputed on every reasoner run, so it lifts by itself when behaviour changes.
- [ ] `harness.worldState` returns `kindStats: { kind, dismissed, acted, downgraded }[]`.

## Data model

Additive, in both schema files, plus the SQLite bootstrap.

### `agent_episodes`

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `agent_id` | text notNull | |
| `channel` | text notNull | `web` \| `whatsapp` \| `telegram` \| `cron` |
| `trigger` | text notNull | `chat` \| `schedule` \| `event` |
| `summary` | text notNull | at most 400 chars |
| `anchors` | text | JSON `EntityRef[]` |
| `insight_ids` | text | JSON `string[]` |
| `created_at` | text notNull | indexed |

`harness_insights.status` already allows `acted`. No new column is needed for it.

## tRPC API

- **New router** `packages/api/src/routers/episodes.ts`. It is new because no existing router owns cross-agent run history.
  - `list({ sinceHours?: number = 24, agentId?: string })` → `Episode[]`.
- `packages/api/src/routers/harness.ts`:
  - `markActed({ id })` → `{ ok }`;
  - `worldState` adds `kindStats`.

## UI surface

- `HarnessWidget`: the "טיפלתי" button, plus a small "הוחלש" tag on insights from a downgraded kind.
- `/agents/manage`: an "היסטוריה" tab listing the last 24 hours of episodes across all agents. It reuses the existing list styling.

## Tests

- **Vitest:**
  - the summary reducer (markdown stripping, the 400-char cap);
  - episode writing in the runners, with an engine mock;
  - the prompt block: anchor overlap ranks first, and the 1,500-char cap;
  - retention pruning;
  - the downgrade math, including the thresholds and lifting;
  - `markActed`.
- **Playwright:** clicking "טיפלתי" on the widget removes the insight and records `acted`.

## Out of scope

- LLM-written episode summaries.
- Cross-device read receipts ("did he actually read the push").
- Downgrading per person. Downgrades are per detector kind only.

## Open questions

- Is 14 days of episode retention enough? Only 24 hours are injected; the rest is there for the history tab and the feedback math.
