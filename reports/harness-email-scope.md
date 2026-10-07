# Review — harness-email-scope

**Verdict: APPROVED**

Spec: `docs/specs/harness-email-scope.md`

## Scope reviewed

| File | Change |
|---|---|
| `packages/database/src/schema.pg.ts:1366` | `email_thread` added to `HARNESS_NODE_KINDS` |
| `packages/api/src/services/harness-context.ts:38,46` | `email` scope added to type + `HARNESS_SCOPES` |
| `packages/api/src/services/harness-context.ts:412-470` | email indexing block: nodes, `MENTIONED_IN`, `RELATED_TO` |
| `packages/api/src/services/harness-context.ts:624-633,700` | `PersonSignals.emails`; `fetchNodes` now selects `attrs` |
| `packages/api/src/services/harness-reasoner.ts:385` | email thread added to `unanswered_thread` sources |
| `apps/web/src/lib/conversation-engine.ts` | `emails` surfaced in the `get_harness_insights` person branch |
| `apps/web/src/components/HarnessWidget.tsx` | `email_thread: 'מייל'` source label |
| `packages/api/src/services/harness-context.test.ts` | +7 cases |

## Acceptance criteria

All met. Notes on the two that deserved scrutiny:

**Privacy boundary holds.** The node carries `label` (subject) and `summary` (snippet) only.
This is not merely a convention in the indexer — `person_email_threads` has no body column
because `email-sync.ts` fetches headers only, so there is no body available to leak. One test
asserts the negative directly.

**The commitment join is deterministic, not heuristic.** `email-sync.ts` writes the thread key
(`<account>::<threadId>`) as the commitment's `sourceId`, so the edge is built from an equality
join on `source = 'email' AND source_id = gmail_thread_id`. A test confirms a commitment with
the same `sourceId` but a different `source` is not linked, which guards against a future
channel reusing the key format.

**One spec correction applied.** The spec said the kind list had to be mirrored into
`schema.ts`. It does not: `schema.ts` re-exports the constants from `schema.pg.ts`. The spec
line was corrected rather than the code.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/api exec vitest run` | 1185 passed (105 files) |
| `pnpm --filter @ak-system/web exec vitest run` | 274 passed (36 files) |
| `pnpm -r run lint` | pass (pre-existing warnings only) |
| `pnpm --filter @ak-system/web build` | pass |

## Production verification (EC2)

Deployed, then ran the harness cron on the box:
`{"ok":true,"indexed":{"nodes":1781,"edges":2832},"insights":14}`.

Node kinds now include `email_thread` at 54. The case the user raised resolves correctly —
Tovit Gal's thread is in the graph, attached to her person node, with a working deep link and
an edge to the commitment it produced:

```
email_thread:pet_muwj1y7e_jlijm8
  label       Re: הצעה להרצאת אורח לסטודנטים - מסטודנט לתפקידי ניהול בהייטק
  messageCount 3
  gmailUrl    https://mail.google.com/mail/u/?authuser=alpirkritz%40gmail.com#all/1a11082bedb37423
  MENTIONED_IN ← person:p_notion_1790762177620qam28
  RELATED_TO   → commitment:cm_muwncw0q_bxcs1
```

## Open item carried forward

`whatsapp_signal` sits at its 1000-row cap while email contributes 54 under the shared
`SCOPE_LIMIT` of 500. Email is not currently being starved, but the caps are per-scope and
WhatsApp is the only domain saturating one. Worth revisiting if the reasoner starts missing
older email context; not a blocker now.
