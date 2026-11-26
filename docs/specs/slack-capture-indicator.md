# Slack capture indicator (person card) + honest connection status

> **Slug:** `slack-capture-indicator`
> **Status:** Approved and implemented (2026-11-26)
> **Last Updated:** 2026-11-26
> **Builds on:** `local-chat-cache-ingest`, `whatsapp-dm-capture`

## Goal

Two things, both about trust in the Slack feed:

1. **Say how Slack really connects.** Slack is not an API connection (IT blocks it). A launchd
   job on Alpir's Mac (`scripts/work-comms-sync.ts`, source `slack-cache`, every 15 min) reads
   the Slack desktop app's local cache and POSTs new messages to `/api/work-comms/slack/ingest`.
   `/settings/slack` should say that, and show whether the job is alive. The OAuth "connect"
   button is only a secondary option.
2. **Show on the person card that Slack messages were captured**, like the WhatsApp 1:1 line,
   without showing the messages themselves. Alpir only needs to know "yes, it landed".

## User stories

- As Alpir, on David Kotin's card I see "סלאק: 14 הודעות נקלטו · אחרונה לפני 3 שעות" so I know
  the feed works for him. I do not read the messages there.
- As Alpir, if Slack is on but no message from or to this person was captured, the card says so
  ("לא נקלטו הודעות סלאק"), and if the person has no Slack link it says what is missing.
- As Alpir, on `/settings/slack` I see that data comes from the desktop cache via a job on my
  Mac, when it last delivered, and a clear "stale" warning if it did not run for a while.

## Acceptance criteria

### Person card (`PersonContextCard`)
- [ ] New row under the WhatsApp capture row, with a Slack icon, one line only. No message text,
      no list, no toggle (Slack DMs are always on, per `local-chat-cache-ingest`).
- [ ] States:
      - linked + messages: `סלאק · N הודעות נקלטו · אחרונה {dateLabel}` (N = DMs with the person
        in both directions, plus group DMs and channel messages where the person is the sender,
        last 30 days; tooltip shows the 30 day window and the DM / other split).
      - linked, zero messages: `סלאק · מקושר · לא נקלטו הודעות ב־30 הימים האחרונים`.
      - not linked: `סלאק · לא מקושר` with a link to `/settings/slack` ▸ אנשים מסלאק.
      - Slack bridge inactive (no members synced): row hidden.
- [ ] `data-testid="slack-capture-line"`. RTL, dark theme, existing `pill`/muted text styles.
- [ ] "Last contact" (`lastContactAt` / channel) is **not** changed here (separate item in
      `local-chat-cache-ingest` "Not built yet").

### Settings (`/settings/slack`)
- [ ] Connection tab leads with the cache card (`slack-cache-status`) even when no OAuth row
      exists, and its copy says: "הנתונים נקראים מהאפליקציה של סלאק במחשב (job כל 15 דק׳), לא דרך API".
- [ ] The card shows last delivery time, last message time, and message count in the last 24h.
- [ ] Stale: no ingest for > 60 min → amber "הסנכרון לא רץ מ־{time} · בדוק שהמחשב דלוק וה־launchd job פעיל".
- [ ] OAuth block is moved under a collapsed "חיבור API (לא בשימוש בארגון עם חסימת API)".

## Data model changes

None. `slack_messages`, `slack_channels(kind, member_ids)`, `slack_members`,
`person_external_ids(provider='slack')` already hold everything. Nothing to mirror in
`schema.pg.ts` / `schema.ts`.

## tRPC API

- `slack.personCapture({ personId })` → `{ active: boolean, linked: boolean, count: number,
  dmCount: number, otherCount: number, lastMessageAt: number | null, windowDays: 30 }`.
  Resolution: the person's Slack `userId`s via `person_external_ids`; DM channels where
  `memberIds` contains that id; messages in those DMs (any sender) + messages where
  `slack_messages.user_id` is that id in other channels. Excludes `deleted`.
  Prefer folding this into `person-context.ts` (`PersonContext.slack`) so the card needs no
  extra request; the standalone procedure is optional.
- `slack.cacheStatus` extended with `messagesLast24h: number` and `stale: boolean`.

## UI surface

- `apps/web/src/components/people/PersonContextCard.tsx` (one row).
- `apps/web/src/app/settings/slack/page.tsx` (connection tab copy + stale state).

## Tests

- Vitest: `personCapture` counts DM both directions, ignores deleted, respects the 30 day
  window, not-linked and inactive states.
- Playwright: person card shows the line for a seeded linked person; settings shows the stale
  warning with an old seeded ingest.

## Out of scope

- Showing Slack message text on the person card, or a Slack summary like WhatsApp's DM summary.
- Hugo Slack DM tool, "last contact" including Slack, Teams.
- `work_bridge_runs` table and the `work_bridge_cache_unreadable` notification (this spec uses
  the newest `slack_messages.created_at` as the heartbeat, which is approximate: it only moves
  when there are new messages).

## Decisions

1. Heartbeat: approved. The bridge already re-posts the full member list on every run, even with
   zero new messages, so the heartbeat is `max(slack_members.updated_at)`. No bridge change.
   If the cache is unreadable the run throws before posting, so the heartbeat stops and the
   card goes stale, which is correct.
2. Count window: 30 days.
