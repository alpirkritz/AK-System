# Spec: Bank trusted device (persistent Chrome profile + one-time OTP)

## Goal

Remember Bank Hapoalim’s device after a one-time SMS OTP so later EC2 syncs do not ask for a code. Persist Chromium `user-data-dir` per bank connection, and add a one-shot OTP entry UI while the first sync is waiting on the bank’s verification screen.

## User stories

- As Alpir, I want to enter the Hapoalim SMS code once in the Finance Accounts UI when sync asks for it, so the login can finish.
- As Alpir, I want that Chromium profile saved on the EC2 data volume, so the next daily/manual sync skips OTP when the bank treats the profile as a trusted device.
- As Alpir, I want a clear Hebrew state “ממתין לקוד אימות” on the connection while waiting for my code.
- As Alpir, I want the same profile mechanism available for Otsar HaHayal (and other providers) even if OTP UI is only wired for Hapoalim in this change.

## Acceptance criteria

- Given a Hapoalim connection sync on EC2, When the bank shows an OTP screen after password login, Then connection `status` becomes `awaiting_otp` within ~5s and the Accounts tab shows an OTP input for that connection.
- Given Alpir submits a valid OTP via `finance.bankConnections.submitOtp`, When the scraper is still waiting, Then the code is typed into the bank page, login continues, and sync either succeeds or returns a normal bank error (not a silent hang).
- Given OTP wait exceeds 3 minutes with no submit, When the scrape ends, Then status is `error` with a Hebrew-friendly message that the code was not entered in time.
- Given a successful sync that used a profile directory, When Chromium exits, Then `/data/bank-browser-profiles/<connectionId>/` (or local `apps/web/data/bank-browser-profiles/<connectionId>/`) still exists on the data volume.
- Given a later sync with the same connectionId and an already-trusted profile, When Hapoalim does not show OTP, Then sync completes without `awaiting_otp` (best-effort; bank policy may still re-challenge).
- Given `submitOtp` when status is not `awaiting_otp`, When called, Then the API rejects with a clear error.
- Given unit tests, When OTP bridge and profile-path helpers run, Then they pass without launching Chromium.

## Data model

No new tables. `bank_connections.status` gains documented value `awaiting_otp` alongside existing `pending` | `connected` | `error` | `disabled`.

Update comments in:
- `packages/database/src/schema.ts`
- `packages/database/src/schema.pg.ts`

No SQLite bootstrap ALTER needed (status is free-form text).

## tRPC API

Extend `packages/api/src/routers/finance.ts` → `bankConnections`:

| Procedure | Kind | Input | Return |
|-----------|------|-------|--------|
| `submitOtp` | mutation | `{ id: string, code: string.min(4).max(12) }` | `{ ok: true }` |
| `sync` | mutation | unchanged `{ id }` | unchanged `SyncResult`; may leave row in `awaiting_otp` until OTP or timeout |

Auth: `protectedProcedure` for both.

## UI surface

- `apps/web/src/app/finance/AccountsTab.tsx`: poll connections while any row is `awaiting_otp` or sync in flight; show inline OTP form (`.input` + `.btn`) on that card; Hebrew copy: כותרת “נדרש קוד אימות”, רמז “הזן את הקוד שקיבלת מהבנק”, כפתור “שלח קוד”.
- Status pill: `awaiting_otp` → “ממתין לקוד אימות” (amber).
- No new route; stay on `/finance` Accounts tab.

## Implementation notes

1. Profile root env `BANK_BROWSER_PROFILE_ROOT` (default: `DATABASE_PATH` dirname + `/bank-browser-profiles`, production `/data/bank-browser-profiles`).
2. Pass `--user-data-dir=<root>/<connectionId>` into scraper Chromium args; keep existing Docker/UA flags.
3. In-process OTP bridge (Map of connectionId → pending Promise); `submitOtp` resolves it; scrape watcher on the page detects OTP inputs (placeholder/name/id heuristics for Hapoalim) and fills + confirms.
4. Extend `ScrapeFn` / `realScrape` to accept `connectionId` so profile + OTP bridge can key correctly.
5. Raise Hapoalim scrape timeout enough to allow ~3 minutes for OTP entry.

## Out of scope

- Switching to `@sergienko4/israeli-bank-scrapers` or Playwright/Camoufox.
- Long-term OTP tokens / reverse-engineered Hapoalim device APIs.
- Headed browser / VNC on EC2.
- Guaranteeing the bank never re-asks OTP (bank policy).
- OTP UI for credit-card providers in this change (profile dir still created).

## Open questions

None — proceed with profile persistence + one-time OTP UI for Hapoalim.
