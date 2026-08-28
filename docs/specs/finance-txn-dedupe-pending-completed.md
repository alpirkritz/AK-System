# Finance transaction dedupe — pending/completed pairs

## Goal

Stop duplicate finance rows when Visa Cal (and similar scrapers) return the same purchase twice: once as `pending` and again as `completed` with a slightly different timestamp.

## Root cause

`transactionDedupeKey` hashed the full ISO `date`, so pending/completed variants got different keys and both were inserted.

## Acceptance criteria

- Dedupe key uses **calendar day** + normalized description + absolute amount + account number.
- On sync: if a fuzzy match exists (`account + day + amount + description`):
  - pending existing + completed incoming → upgrade existing to completed (no new row).
  - completed existing + pending incoming → skip incoming.
- Before importing txns for an account, delete orphan **pending** rows when a **completed** row exists for the same purchase.
- Re-syncing the same scrape inserts zero duplicates.
- **Same merchant + same day + different amounts** remain separate transactions (e.g. 10 ₪ and 5 ₪ at the same store).
- Vitest covers day-normalized keys, pending→completed merge, and reconcile cleanup.

## Out of scope

- CSV/PDF import dedupe (separate gap).
- Cross-account dedupe.
