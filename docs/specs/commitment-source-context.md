# commitment-source-context

## Goal

A proposed commitment arrives with no sense of *when* it was said and no way to see the
conversation it came from. Three concrete defects:

1. **No source timestamp.** `commitments` stores only `created_at` — when the cron scan ran. A
   message sent at noon that gets scanned at 20:40 looks like it happened at 20:40.
2. **No original text for group commitments.** `scanGroupCommitments` writes
   `sourceSnippet: cls.because` — the model's *reason sentence*, not the message. (DM scans do
   store the real text.) So a group commitment never carries a quote.
3. **No way to reach the source.** `commitmentSourceUrl` returns `null` for both WhatsApp
   sources, and the chat/group name is only used in the push notification — it is never stored on
   the row. On `/commitments` there is nothing identifying which conversation it came from.

A fourth, related symptom: the cron fires on container boot (`scripts/local-cron.mjs:63`), so a
redeploy makes the scan sweep up everything accumulated since the last run and push it as if it
were fresh.

## User stories

1. As Alpir, every commitment on `/commitments` shows when the underlying message was actually
   sent and in which chat or group.
2. As Alpir, I can open a commitment and read the actual message plus the few messages around it,
   so I understand what it refers to.
3. As Alpir, I do not get pushed about a message that is hours old just because the bridge
   backfilled it or the container restarted — it still shows up in the list, quietly.

## Acceptance criteria

### Source metadata

- Every commitment created by a WhatsApp scan stores the source message's own timestamp.
- Every commitment created by a group scan stores the group JID and the group name; a DM scan
  stores the person's JID and name. Commitments from analyses/voice/email store nothing new.
- A group commitment's `source_snippet` holds the **actual message text**, clipped to 160 chars.
  The model's reason sentence moves to its own `source_reason` column (both sources).
- Existing rows keep working: all new columns are nullable, the UI falls back to `created_at` and
  hides the chat line when the data is absent.

### Notification throttle

- The cron still notifies for every newly proposed commitment (user's choice).
- A commitment whose source message is older than `COMMITMENT_FRESH_HOURS` (6) is excluded from
  the notification but is still inserted and listed. If that leaves nothing, no notification is
  sent at all.
- Commitments with no source timestamp (analyses, email) are treated as fresh.

### Source context view

- A commitment row with a WhatsApp source shows a "הצג הקשר" disclosure.
- Expanding it loads up to 5 messages before and 2 after the source message from the same chat,
  each with speaker and time; the source message is visually marked.
- Expired/retained-away text renders as `[expired]` exactly as stored — no error.

## Data model changes

`packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`, table `commitments`:

| Column | Type | Null | Meaning |
|---|---|---|---|
| `source_ts` | integer | yes | Epoch ms of the source message. Null for non-message sources. |
| `source_chat_jid` | text | yes | Group JID, or the other party's JID for a DM. |
| `source_chat_name` | text | yes | Group name, or the person's name for a DM. |
| `source_reason` | text | yes | One Hebrew sentence from the classifier: why this still stands. |

`source_snippet` comment changes back to "A short quote from the source message."

Bootstrap `ALTER TABLE` block added in `packages/database/src/index.ts` for SQLite, plus an index
`idx_commitments_source_ts` on `source_ts`.

## tRPC API

New query on `commitmentsRouter`:

```ts
sourceContext: protectedProcedure
  .input(z.object({ commitmentId: z.string().min(1) }))
  .query(async ({ ctx, input }) => ({
    chatName: string | null,
    messages: { id: string; speaker: string; text: string; ts: number; isSource: boolean }[],
  }))
```

- `whatsapp_group`: reads `whatsapp_messages` for `source_chat_jid`, window around `source_ts`.
- `whatsapp_dm`: reads `whatsapp_dm_messages` for the commitment's `person_id`, same window.
- Any other source, or missing metadata: `{ chatName: null, messages: [] }`.

`listProposed` / `listForPerson` projections gain `sourceTs`, `sourceChatName`, `sourceReason`.

## Service changes

`packages/api/src/services/whatsapp-dm.ts`

- `ProposedCommitment` gains `sourceTs?: number | null`, `sourceChatJid?: string | null`,
  `sourceChatName?: string | null`.
- `proposeCommitments` writes the four new columns; `sourceSnippet` stays the quote,
  `because` now lands in `source_reason`.
- `scanGroupCommitments` passes `sourceSnippet: clip(m.text, 160)` (was `cls.because`), plus the
  message `ts`, the group JID and the group name.
- `scanDmCommitments` passes the message `ts` and the person's JID/name.
- `ProposedCommitmentLabel` gains `sourceTs?: number | null` so the cron can filter.

`packages/api/src/services/commitments.ts`

- New `COMMITMENT_FRESH_HOURS = 6` and
  `export function freshCommitments(items, now = Date.now()): ProposedCommitmentLabel[]`.
- `buildCommitmentNotification` is unchanged; the cron routes call `freshCommitments` first and
  skip the notification when the result is empty.

Both cron routes (`whatsapp-dm-commitments`, `whatsapp-group-commitments`) adopt the filter.

## UI surface

`apps/web/src/app/commitments/page.tsx`, inside the metadata line of each row:

- Chat name after the source badge: `· <chat name>` when `sourceChatName` is set.
- Time: `· <relative>` where relative is `לפני N דקות` / `לפני N שעות` / `אתמול HH:mm` /
  `dd/MM HH:mm`, computed from `sourceTs ?? createdAt`. `title` holds the full timestamp.
- The existing `source === 'voice' && 'מהקלטה ב-…'` special case is replaced by this general line.
- Quote block keeps rendering `sourceSnippet`; `sourceReason` renders below it in a dimmer style
  prefixed with `למה: `.
- New `<button data-testid="commitment-context-toggle">הצג הקשר</button>` for WhatsApp sources,
  `aria-expanded`, toggling a panel `data-testid="commitment-context"` with the message list.
  Loading shows `טוען הקשר…`; empty shows `ההודעות המקוריות כבר לא נשמרות.`

Design system: existing `.card`, `.btn-ghost`, `.pill`; no new colors beyond the palette already
in the file (`#97a4c2`, `#5a688c`, `#b8c4dc`, `#223052`, `#eef3fb`).

`apps/mobile/app/(tabs)/commitments.tsx` shows the chat name and relative time on each row. The
context panel is web-only for now.

## Out of scope

- A full WhatsApp chat browser page.
- Changing how the classifier picks commitments, or adding an urgency score.
- Changing the cron cadence or the boot-time fire in `scripts/local-cron.mjs`.

## Open questions

None — notification policy (notify on everything, suppress only stale) and the 6-hour threshold
were confirmed by the user.

## Testing notes

- Vitest `packages/api/src/services/commitments.test.ts`: `freshCommitments` keeps items with no
  `sourceTs`, keeps items inside 6h, drops older ones.
- Vitest `packages/api/src/services/whatsapp-group-commitments.test.ts`: a scanned group
  commitment stores the message text as snippet, the reason separately, and the message ts.
- Vitest for `commitments.sourceContext`: returns the window around the source message for a
  group commitment and an empty list for a `meeting_analysis` one.
- Playwright: a seeded group commitment shows its chat name and expands to show context.
