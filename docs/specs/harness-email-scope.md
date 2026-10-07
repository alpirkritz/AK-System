# Harness email scope

## Goal

Email correspondence is synced and stored but invisible to the harness. `person_email_threads`
holds 99 threads across 20 people, and the harness node kinds are
`person, meeting, commitment, financial_event, whatsapp_signal, voice_recording` — there is no
email kind and no `email` scope. So a thread never becomes a node, never forms an edge, and never
appears in `personSignals`, which is what "everything the system knows about this person" reads
from. An `email`-sourced commitment exists with no visible link back to the thread that produced
it.

Verified on production for Tovit Gal (`p_notion_1790762177620qam28`):

| Signal | Present in harness |
|---|---|
| Person node | yes |
| Meetings (`ATTENDED`) | 2 |
| Commitments (`HAS_COMMITMENT`) | 6 — including one with `source: 'email'` |
| WhatsApp (`MENTIONED_IN`) | 1 |
| Email thread (3 messages, synced, `alpirkritz@gmail.com`) | **none** |

The email sync itself is healthy — both Google accounts connected, threads spread across the
full 30-day window, and her thread is in the table with `message_count: 3`. The gap is purely
the harness indexer.

## User stories

1. As Alpir, when I look at what the system knows about a person, I see the email correspondence
   alongside their meetings, commitments and WhatsApp.
2. As Alpir, an email-sourced commitment points back at the thread it came from, so I can see
   why it was proposed.
3. As Alpir, I can click through from a thread in the system straight into that thread in Gmail.
4. As Hugo, `get_harness_insights` with a `personId` returns the email context too, so a
   cross-domain answer can cite a thread.

## Acceptance criteria

### Node kind and scope

- [ ] `HARNESS_NODE_KINDS` gains `email_thread`; `HARNESS_SCOPES` gains `email`. The kind list
      lives only in `schema.pg.ts` (`schema.ts` re-exports it), and there is no new table, so
      neither the SQLite mirror nor the bootstrap SQL changes.
- [ ] Indexing an email thread writes a node with `label` = subject, `summary` = snippet,
      `occurredAt` = thread date, and `attrs` carrying `gmailUrl`, `messageCount`, `accountEmail`.
- [ ] `gmailUrl` is produced by the existing `gmailThreadUrl()` in `services/commitments.ts` —
      not re-derived — and is `null` for a malformed thread key rather than a broken link.
- [ ] Bounded the same way every other scope is: most recent threads first, capped, within
      `windowDays`.

### Edges

- [ ] `MENTIONED_IN` from person to email thread, mirroring how WhatsApp signals attach.
- [ ] `RELATED_TO` from email thread to commitment where `commitments.source = 'email'` and
      `commitments.source_id` equals the thread's `gmail_thread_id`. This is a deterministic
      join, not a heuristic — `email-sync.ts` already writes the thread key as `sourceMessageId`.

### Read surfaces

- [ ] `personSignals` returns an `emails` array (subject, date, messageCount, gmailUrl),
      newest first, and email dates count toward `lastSignalAt`.
- [ ] `get_harness_insights` with `personId` includes `emails`. Subject and snippet only — no
      message bodies reach the prompt, consistent with the sync, which fetches metadata only.
- [ ] The `unanswered_thread` detector adds the email thread node to its `sources`, so the
      widget's "מבוסס על:" chips name the actual thread rather than only the person and meeting.
- [ ] `HarnessWidget` labels the `email_thread` source kind as "מייל".

## Data model changes

No new table and no new column. `email_thread` is a new value in the existing
`harness_nodes.kind`, and the Gmail link lives in the existing `attrs` JSON bag. Both schema
files get the new constant value; `packages/database/src/index.ts` needs no bootstrap edit.

## tRPC API shape

No new procedures. `harness.personSignals` gains `emails` in its response; `harness.syncToGraph`
accepts `'email'` in its existing `scopes` array.

## UI surface

- `HarnessWidget.tsx` — one entry in `SOURCE_KIND_LABEL`.

## Out of scope

- Fetching message bodies. Decided: subject + snippet only.
- Broadening the `unanswered_thread` detector, which today requires both an upcoming meeting and
  a linked open commitment and so fires for very few people. Worth revisiting once email is
  actually in the graph, as a separate calibration pass.
- Pagination in `fetchGmailHeaders`. It is the only Google fetcher in the repo without a
  `nextPageToken` loop and caps at 100 messages per 15-address batch, but it is not currently
  binding (last run fetched 37 messages total) so it stays a known risk rather than a fix here.

## Open questions

1. `whatsapp_signal` nodes are at their 1000 cap while email contributes 0, so the graph's signal
   mix is heavily skewed toward chat. Once email is in, the caps may need rebalancing so one
   domain cannot crowd out the others.
