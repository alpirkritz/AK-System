# Google Contacts phone fill

> **Slug:** `google-contacts-phone-fill`
> **Status:** Implemented
> **Last Updated:** 2026-09-25

## Goal

Fill empty `people.phone` values from Google Contacts for people who already exist. Matching is by email, then by a unique name. Contacts that do not match stay out of the CRM. The user reviews the list and applies it in one step, unchecking exceptions.

## User Stories

- As the owner, I want a phone number copied from Google onto an existing person who has none, so WhatsApp and the contact card work without typing numbers one by one.
- As the owner, I want to see who matched and uncheck exceptions before anything is saved.
- As the owner, I want Google contacts that do not match anyone to be ignored, so the review queue does not fill up with new people.
- As the owner, I want the saved name to be the phone-book name, editable before save, so the list matches how I know the person.
- As the owner, I want WhatsApp capture turned on for every person I confirm in that batch, so I do not enable it one by one.

## Acceptance Criteria

- [ ] Given a Google contact whose email matches exactly one existing person with an empty phone, when the preview runs, then that person appears as a proposal with `matchedBy: email` and the contact's phone.
- [ ] Given no email match and exactly one existing person whose normalized name equals the contact name, and that person has an empty phone, when the preview runs, then the proposal uses `matchedBy: name`.
- [ ] Given two or more existing people share that name, or two share that email, when the preview runs, then no proposal is created for them and the contact is listed as skipped (`ambiguous_name` or `ambiguous_email`).
- [ ] Given a person already has a non-blank phone, when the preview or apply runs, then that phone is left unchanged.
- [ ] Given a Google contact matches nobody, when the preview runs, then no `people` row is inserted.
- [ ] Given two contacts propose different phones for the same person, when the preview runs, then that person is skipped (`conflicting_phones`).
- [ ] Given the user applies a subset of proposal person ids, when `applyGooglePhones` runs, then only those people whose phone is still empty are updated, and the phone written is the one from a fresh preview (not an arbitrary client string).
- [ ] Given a proposal is shown, when the dialog renders, then the editable name is the Google Contacts name. The current system name is shown beside it when it differs.
- [ ] Given the user edits a name and applies, when the row is saved, then `people.name` becomes that edited name. An empty edit falls back to the Google name. The phone still comes only from the fresh preview.
- [ ] Given apply updates a person, when it finishes, then `captureWhatsapp` is on for that person (from now, no backfill) and the WhatsApp DM allowlist is pushed once.
- [ ] Given Google returns 403 / insufficient scope, when the preview runs, then the UI shows that the Google account must be reconnected to grant contacts read access. No people are created.
- [ ] People with status `ignored` are never proposed. `confirmed` and `unconfirmed` are eligible.
- [ ] The existing `contacts.syncGoogle` behavior (creating unconfirmed people) is unchanged and is not what this screen calls.
- [ ] Given a connected Google account is `alpir@daz.guru`, when phone preview runs, then that account is not queried and does not add an error. Calendar and Gmail for that account are unchanged. DAZ does not store phone numbers in Google.

## Data Model

No schema changes. Reads and writes the existing `people.phone` column in both `packages/database/src/schema.ts` and `schema.pg.ts`.

## tRPC API

Router `contacts` (already registered). Auth required (`protectedProcedure`).

- `previewGooglePhones`: mutation, no input.
  - Returns `{ proposals: { personId, personName, phone, googleName, matchedBy: 'email' | 'name' }[], skipped: { reason: 'ambiguous_email' | 'ambiguous_name' | 'conflicting_phones', googleName, personName?: string }[], unmatched: number, errors: string[] }`.
- `applyGooglePhones`: mutation, input `{ fills: { personId: string, name: string }[] }` (max 500; empty array is a no-op).
  - Re-runs the preview, intersects with `personId`s, updates `people.phone` only when still blank, sets `people.name` from the edited name (or the Google name when blank), and turns `captureWhatsapp` on.
  - Returns `{ updated: number, skipped: number, errors: string[] }`.

OAuth: add `https://www.googleapis.com/auth/contacts.readonly` to the Google Calendar connect scopes in `packages/api/src/google-calendar-auth.ts`. Existing tokens lack it until the user reconnects (`prompt: consent` is already set).

## UI Surface

- `apps/web/src/app/people/page.tsx` — button **טלפונים מגוגל** in the tab row.
- `apps/web/src/components/people/GooglePhoneFillModal.tsx` — `.overlay` / `.modal` dialog.
  - Loading, error (including the reconnect message), and empty states.
  - Proposal rows: checkbox (default on), person name, phone (`dir="ltr"`), match label **אימייל** or **שם**.
  - Skipped rows listed under the proposals.
  - Primary action **מלא N טלפונים** calls `applyGooglePhones` with the checked ids, then invalidates people queries.
- No mobile screen in this change.

## Out of Scope

- Creating people from unmatched Google contacts (`contacts.syncGoogle` stays as it is).
- Overwriting a phone that is already set.
- Fuzzy or nickname matching.
- Editing phone on the mobile person screen.
- Device address-book import.
- Bulk WhatsApp capture toggle.

## Open Questions

None. Name match is exact after trim, collapsed spaces, and Latin lowercasing.
