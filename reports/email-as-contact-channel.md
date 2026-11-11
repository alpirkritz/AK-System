# Review — email-as-contact-channel

**Verdict: APPROVED WITH NITS**
**Date:** 2026-11-03 · Spec: `docs/specs/email-as-contact-channel.md`

## What shipped

- **Addresses as a channel** — `services/person-emails.ts` (list/add/remove across `people.email` + `person_external_ids`), `people.emails.{list,add,remove}`; add fills the primary field first, refuses an address owned by another person (CONFLICT with their name), and triggers a Gmail sync for that person.
- **Card** — `PersonContextCard.tsx`: email pills + "קשר מייל" beside the WhatsApp senders; WhatsApp and email merged into one timeline ("התכתבות מאז הפגישה…" / "התכתבות ישנה יותר"), each mail item with direction (ממני / אליי). Separate "אימיילים" block removed.
- **Suggestions** — `work-comms-ingest.ts`: From/To/Cc correspondents (`rankUnknownCorrespondents`: senders first, then volume, cap 50); `matchEmailCandidate` (display name in any order, `first.last` local part, alias, words-within-fuller-name) sets `candidatePersonId`; a pending row gains a candidate on a later run. Queue card says "לצרף את הכתובת ל-X?".
- **Reports to** — `ManagerPicker.tsx` combobox over all confirmed people (workspace members first); `upsertAffiliation` adds an outside manager to the workspace.
- **Bug fix found on the way** — `gmailThreadUrl` produced Gmail links for Outlook ConversationIds; now null for that shape (`isOutlookConversationId`), which also fixes commitment source links.

## Checks

| Check | Result |
|---|---|
| `pnpm test` | 1810 passed (136 + 47 files), incl. 17 new in `routers/email-as-contact-channel.test.ts` |
| Playwright (people-card specs) | new `email-as-contact-channel.spec.ts` 2/2; updated `email-voice-commitments.spec.ts` passes |
| Pre-existing e2e failures | `person-context-circles.spec.ts:61` and `whatsapp-dm-commitments.spec.ts:27` fail identically with the change stashed — not caused by this work |
| `pnpm -r run lint` | clean |
| `pnpm --filter @ak-system/web build` | passes |

## Nits

1. `test-utils.ts` `resetDb` didn't clear `identity_queue`, `person_aliases`, `person_external_ids`; added, since the new suites otherwise leaked rows across runs.
2. Removing an address doesn't delete threads already archived through it (history is kept). If a wrong address pulled in someone else's mail, those threads stay until a merge/cleanup.
3. Manager auto-affiliation copies the edited person's relationship type; adjust on the manager's card if it differs.
4. Not verified against production data (SSH read was blocked); Shani/David's addresses will show as suggestions on the next bridge run after deploy, or can be added on their cards directly.
5. `apps/web` `tsc --noEmit` has ~2750 pre-existing errors (unresolved package types) and isn't a usable gate; `next build` is.
