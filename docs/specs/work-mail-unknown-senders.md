# Surface Unknown Work-Mail Senders for Adding to People

> **Slug:** `work-mail-unknown-senders`
> **Status:** Draft — awaiting approval
> **Last Updated:** 2026-11-02

## Goal

Today the work-comms bridge only stores Outlook threads that touch a known person (first
run: 110 of 377). Alpir wants the rest not to be lost: when mail arrives from someone who
isn't a contact, surface that **sender** for review so he can add them to People with one
click. Chosen approach (his call): **don't archive the mail upfront** — just surface the
sender; once added, their mail flows in on the next 15-min run (they're now "known").

Real humans only — automated senders (no-reply, mailer-daemon, newsletters, notifications)
are filtered out so the review list stays clean.

## User Stories

- As Alpir, when a non-contact emails me at work, I want their name + address to appear in a
  short "add to People?" list, so nothing slips through just because they aren't a contact yet.
- As Alpir, I want to add such a sender to People in one click (with their work email
  attached), after which their past and future mail archives automatically.
- As Alpir, I don't want the list polluted by no-reply/newsletter/automated addresses.

## Acceptance Criteria

- [ ] During `ingestWorkMail`, every sender address not matching a known person is considered a candidate.
- [ ] Automated senders are filtered out: local-part or name matching `no-?reply`, `do-?not-?reply`, `mailer-daemon`, `postmaster`, `bounce`, `notifications?`, `newsletter`, `digest`, `noreply`, `automated`, `alerts?`, plus anything the self-account sent.
- [ ] A surviving unknown sender is recorded once as a pending suggestion carrying **name + email** (deduped by email; not re-created while one is pending or after it was dismissed).
- [ ] The existing `IdentityQueueCard` review surface lists these; "add to People" creates a person **with the email set** (so the next run matches and archives their threads).
- [ ] "Dismiss" hides the sender and doesn't resurface them.
- [ ] No mail body/thread is stored for an unknown sender until they become a person.
- [ ] Counts reported by the ingest endpoint include `suggestedSenders`.

## Data Model

Reuse `identity_queue` (don't add a table), with two additions in `schema.pg.ts` + `schema.ts` + bootstrap:

- `email TEXT` — the sender address for `source='email'` entries (null for existing name-only entries).
- `status` already supports `pending | linked | new | dismissed`; add nothing.

A new helper (not `resolveOrQueue`, which only queues ambiguous `suggestion` cases) queues a
brand-new email sender: `queueUnknownEmailSender(db, { name, email, context })` — inserts a
`pending` row with `source='email'`, `email`, dedup by `lower(email)` among non-dismissed rows.

## tRPC / Logic

- `packages/api/src/services/work-comms-ingest.ts` → after `syncEmailThreads`, compute the
  set of sender addresses, drop known + automated + self, and queue the rest. Return
  `suggestedSenders: number`.
- `packages/api/src/services/person-resolution.ts` → `queueUnknownEmailSender` + an
  `isAutomatedSender(address, name)` predicate (pure, unit-tested).
- `packages/api/src/routers/people.ts` → the identity-queue "link/new" mutation sets
  `people.email` from the queue row's `email` when creating a new person (and learns the
  alias). Confirm the existing mutation path; extend minimally.

## UI Surface

- `IdentityQueueCard.tsx`: show the email under the name for `source='email'` rows; the
  existing "add / link / dismiss" actions work unchanged. No new page.

## Out of Scope

- Storing mail bodies for non-contacts (explicitly chosen against).
- Teams/Slack senders (both still org-blocked).
- Auto-creating people (explicitly chosen against — review-first).
- Domain allow/deny lists (can add later if the list gets noisy).

## Open Questions

- Should the suggestion list be capped per run (e.g. top 50 by frequency) to avoid a flood on
  the first run over 30 days of mail? → propose **yes, cap + order by message count** so the
  most-frequent senders surface first.
