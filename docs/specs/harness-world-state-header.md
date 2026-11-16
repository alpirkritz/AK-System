# Harness — world-state header and fresher index

> **Slug:** `harness-world-state-header`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Builds on:** `harness-agent-integration.md`, `agent-clock-and-harness-surfacing.md`

## Goal

Hugo, the morning briefing and meeting prep start every run already knowing the top open cross-domain insights and how fresh they are, instead of depending on a tool call. The harness world model is also updated soon after each sync, not only every 6 hours.

### Why

- Today the harness reaches an agent only if the model chooses to call `get_harness_insights`. The prompt makes that call mandatory for vague asks, but a direct question ("מה עם דן?") can skip it.
- The `harness-insights` cron runs at `10 */6 * * *`, so an insight can be up to 6 hours behind a calendar or WhatsApp change that has already synced.
- `reasonAndPersist` runs Gemini phrasing over **all** detector drafts on every run (`phraseInsights`), so running it more often would multiply Gemini cost.

## User stories

- As Alpir, when I ask Hugo anything, I want him to already know the 3–5 most important open cross-domain links, so he raises them when they are relevant without me asking "מה חשוב".
- As Alpir, I want an insight like "דן שקט שבועיים לפני הפגישה" to show up within the hour, not after the next 6-hour run.
- As Alpir, I want Hugo to tell me when the harness picture is stale, so I know not to trust it blindly.

## Acceptance criteria

### Prompt header

- [ ] For `01_Hugo_orchestrator`, `03_morning_briefing`, `04_meeting_prep_herald` and the general `/chat`, `buildSystemInstruction` injects a `## תמונת מצב (harness)` block right after the Chief of Staff block. The block contains:
  - the time of the last index and last reasoner run, as "עודכן לפני N דק׳";
  - up to 5 open insights ordered by severity, then score. Each one has its title, a one-line body and `basedOn` (the source labels).
- [ ] The block is capped at 1,500 chars.
- [ ] If the last reasoner run is older than 8 hours, the block says so in one line, and Hugo is told to call `get_harness_insights` before relying on it.
- [ ] With no open insights, the block is one line ("אין תובנות פתוחות"), or it is omitted when the harness has never run.
- [ ] The header must not duplicate the tool. The existing "MANDATORY `קישורים בין תחומים:`" rule now treats insights in the header the same as insights returned by the tool.
- [ ] The read is one DB query (`listOpenInsights` with a limit of 5) plus one read of the last-run stamps. A failure omits the block and never fails the run.

### Incremental index

- [ ] `indexHarnessWorld` is called with a narrow scope at the end of these sync crons, only when that run changed rows:

  | sync cron | scopes indexed |
  |---|---|
  | `calendar-sync` | `meetings`, `people` |
  | `notion-sync` | `meetings` |
  | `whatsapp-group-summary` | `whatsapp` |
  | `email-sync` | `email` |
  | `whatsapp-dm-commitments`, `whatsapp-group-commitments`, `slack-commitments` | `commitments` |

- [ ] A new cron route `/api/cron/harness-reason`, scheduled `25 * * * *` (hourly), runs the detectors and pushes, exactly as `harness-insights` does today, but **phrases only drafts whose `dedupe_key` is new or whose detector facts changed**. All other drafts keep their stored title and body.
- [ ] Detector facts are compared through a hash of the draft's `sources` and severity, stored in `harness_insights.facts_hash`.
- [ ] The 6-hourly `harness-insights` cron stays as the full re-index plus re-phrase.
- [ ] The last index time and last reason time are stored in `user_settings.harness_indexed_at` and `harness_reasoned_at`. `harness.worldState` returns them.

## Data model

All changes are additive, in both `schema.pg.ts` and `schema.ts`, plus the SQLite bootstrap `ALTER TABLE` in `packages/database/src/index.ts`.

- `harness_insights.facts_hash`: text, nullable.
- `user_settings.harness_indexed_at`: text, nullable.
- `user_settings.harness_reasoned_at`: text, nullable.

## tRPC API

Router `packages/api/src/routers/harness.ts` (existing):

- `worldState` adds `indexedAt` and `reasonedAt` to its return.
- `runReasoner` gains the input `{ phraseChangedOnly?: boolean }`, with a default of `false`.

## UI surface

- `HarnessWidget` shows "עודכן לפני N דק׳" next to its title.
- No other UI change.

## Tests

- **Vitest — header renderer:** severity ordering, the 1,500-char cap, the stale line, and omitting the block when the harness has never run.
- **Vitest — `reasonAndPersist({ phraseChangedOnly: true })`:**
  - an unchanged draft keeps its stored title and body;
  - a changed `sources` set re-phrases;
  - the phrasing mock is called only for changed drafts.
- **Vitest — sync crons:** each one calls `indexHarnessWorld` with the expected scopes when rows changed, and does not call it when nothing changed.
- **Prompt contract test:** Hugo's system instruction contains the header.

## Out of scope

- Event-driven (push-based) indexing. Narrow scopes on the existing crons are enough.
- New detectors.
- Changes to push thresholds (`selectInsightsToPush`).

## Open questions

- Is hourly reasoning right, or every 30 minutes? The default is hourly, because WhatsApp summaries run every 15 minutes and detectors read 7–21 day windows.
