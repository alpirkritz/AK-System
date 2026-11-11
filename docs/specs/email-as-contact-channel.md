# Email as a Contact Channel (like WhatsApp) + Open "Reports To"

> **Slug:** `email-as-contact-channel`
> **Status:** Approved 2026-11-03 · Implemented
> **Last Updated:** 2026-11-03

## Goal

Email should be a contact channel on a person, on equal footing with WhatsApp: a person has
**one or more addresses**, the card shows and manages them, the mail exchanged on them is kept
and shown as interaction history, and it counts as contact ("last contact", 1:1 need, the
reasoner's context) the same way WhatsApp messages do.

Today it isn't. Concrete case (2026-11-03): Shani Asaraf and David Kotin appear in 88 / 143
work-mail messages over the last weeks (`Shani.Asaraf@pizzahut.com`,
`David.Kotin@pizzahut.com`), yet their cards show WhatsApp only. Both cards came from Notion
with no email, and nothing on the card shows that, or lets Alpir fix it in place.

Gaps found:

1. **Suggestions only from senders.** `ingestWorkMail` queues unknown *From* addresses only.
   People Alpir writes *to* (Shani is mostly a TO recipient) are never suggested.
2. **No name match.** A new address whose display name or `first.last@` local part matches an
   existing person is suggested as a brand-new person, not "attach to X".
3. **Addresses are invisible.** Storage already supports many addresses per person
   (`person_external_ids`, provider `email`, plus `people.email`), but the card shows only the
   single `people.email` field. Addresses linked through the identity queue or Google
   Contacts can't be seen or removed. WhatsApp, by contrast, has sender pills, link/unlink
   and a capture toggle on the card.
4. **Email is a separate block, not history.** WhatsApp is woven into the card's timeline
   ("since last meeting" / "older"); email threads sit in a separate list after it, and only
   when some already exist.
5. **"Reports to" picker is narrow.** `PersonAffiliations` offers only people already
   affiliated to the same workspace. The server already accepts any person.

## User Stories

- As Alpir, I want to see all of a person's email addresses on their card, add one, and remove
  a wrong one, the same way I manage their WhatsApp senders.
- As Alpir, when someone I correspond with (sending **or** receiving) isn't linked, I want a
  suggestion, and if their name matches an existing person, a one-click "attach to X".
- As Alpir, I want mail with a person to appear in their interaction history alongside
  WhatsApp and meetings, and to count as contact.
- As Alpir, I want to set "reports to" to anyone in People, not only to people already in that
  workspace.

## Acceptance Criteria

### Addresses (channel identity)
- [ ] `personContext` returns `emailAddresses: { address, source: 'primary' | 'linked', accountKey | null }[]`: `people.email` (each address in it) plus every `person_external_ids` row with provider `email`, deduped case-insensitively.
- [ ] The card shows each address as a pill (Mail icon), next to the WhatsApp pills; × removes a linked address (deletes the external-id row) or clears/edits the primary.
- [ ] "Add email" on the card attaches an address as an external id (`accountKey: 'manual'`). Validation: a valid address; if it already belongs to another person → CONFLICT with that person's name.
- [ ] After adding an address, an email sync for that person is triggered (`email.sync({ personIds })` for Gmail); Outlook mail arrives on the next bridge run (≤15 min). The UI says so.

### Suggestions (identity queue)
- [ ] `ingestWorkMail` considers every address in From, **To and Cc** (minus self, automated and already-known), ranked by message count, still capped at 50 per run.
- [ ] Each candidate is name-matched against confirmed people (name + aliases, `normalizeAlias`), then by local part (`first.last`, `first_last`, `firstlast` → "first last"). A single match sets `candidatePersonId`, and the card shows "לצרף ל-X?"; zero or several matches → today's "add to People" flow.
- [ ] Name matching never links automatically; it is always a suggestion (review-first, as before).
- [ ] An existing pending row without a candidate gains one when a later run finds a match.

### History and contact
- [ ] Email threads appear in the card's timeline merged by date with WhatsApp ("since last meeting" / "older"), each with a Mail icon, subject and snippet. The separate "אימיילים" block is removed. *(Implementation note: no per-thread expand — only the latest message is stored per thread; see Out of Scope.)*
- [ ] Each thread item shows direction ("ממני" / "אליי") from the latest message's From.
- [ ] `relationship-attention` keeps counting email as a channel (already does, `channel: 'email'`); "last contact" on the card shows "במייל" when email is the latest channel. No change to warmth (it is meeting-based for WhatsApp too).

### Reports to
- [ ] The "מדווח ל" field is a searchable combobox over all confirmed people (`people.search`), with workspace members listed first.
- [ ] Picking someone not affiliated to that workspace saves the line and also affiliates the manager to the workspace, in the same mutation. *(Implementation note: the manager gets the same relationship type as the person being edited — e.g. both `colleague`; editable afterwards.)*
- [ ] Self-reporting stays rejected.

## Data Model

No new tables or columns; `schema.pg.ts` / `schema.ts` stay unchanged.

- Addresses: `person_external_ids` (provider `email`) is the multi-address store; `people.email` stays as the "primary" field (already comma-tolerant via `extractAddresses`).
- Suggestions: reuse `identity_queue.candidatePersonId` (already exists) for name matches.

## tRPC API

- `insights.personContext` → adds `emailAddresses` (above) and a merged `timeline` that includes email threads (or keeps the existing arrays and adds `kind: 'email'` items to the WhatsApp ones; the Dev Agent picks the less invasive shape and keeps existing consumers working).
- `people.emails.add({ personId, address })` → `{ ok }` | CONFLICT.
- `people.emails.remove({ personId, address })` → removes the external-id row(s) for that address, or strips it from `people.email`.
- `people.linkToWorkspace` → unchanged input; the service always affiliates a manager who isn't in the workspace yet (no flag needed).
- Services: `work-comms-ingest.ts` (To/Cc candidates), `person-resolution.ts` (`matchEmailCandidate(name, address)`, pure and unit-tested), `person-context.ts` (addresses + merged timeline), `person-workspaces.ts` (manager auto-affiliation).

## UI Surface

- `PersonContextCard.tsx`: email pills + "קשר מייל" next to the WhatsApp sender row; email items in the timeline.
- `IdentityQueueCard.tsx`: "לצרף ל-X" when `candidate` is set and `source='email'`; shows whether the address was seen as sender or recipient.
- `PersonAffiliations.tsx`: combobox for "מדווח ל" (RTL, `.input`, keyboard navigable); the hint "מופיעים כאן רק אנשים שכבר שויכו לעולם הזה" is removed.
- UI Designer Agent review required (RTL, dark theme, design-system classes).

## Tests

- Vitest: `matchEmailCandidate` (display name, `Last, First`, local-part forms, ambiguity); `ingestWorkMail` queues To/Cc recipients and sets candidates; `people.emails.add/remove` incl. conflict; `personContext.emailAddresses` dedupe; `linkToWorkspace` manager auto-affiliation.
- Playwright: add an address on a person card → pill appears; pick a non-member in "מדווח ל" → saved and the manager shows in the workspace.

## Out of Scope

- Storing full mail bodies (still headers + snippet).
- Per-message email rows (threads stay the unit; expanding uses stored thread metadata).
- Warmth scoring from messaging channels (applies to WhatsApp too; separate decision).
- Teams/Slack (org-blocked).

## Open Questions

- Should adding an address in the UI also backfill older than 30 days for that one person? → propose **no for now** (bridge window is 30 days); revisit if needed.
- Should recipients-only addresses (never sent to Alpir) rank below senders in the 50 cap? → propose **yes**: rank by (sent-by-them count, then total).
