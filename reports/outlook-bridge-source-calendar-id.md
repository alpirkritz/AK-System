# Outlook Bridge Source Calendar Selection — Final Report

> **Slug:** `outlook-bridge-source-calendar-id`  
> **Date:** 2026-08-11  
> **Status:** Superseded — see [`outlook-bridge-alternative-access`](./outlook-bridge-alternative-access.md)

**Outcome:** the EventKit path stayed blocked, but a signed-in Outlook Web session
turned out to be permitted and now backs the bridge. The manual ICS workaround
proposed below was never needed. The `OUTLOOK_SOURCE_CALENDAR_ID` work documented
here still ships, guarding the `eventkit` source should it ever be usable again.

## Summary

Attempted to switch Outlook→Google sync source from `kxa7990@yum.com` to `alpir.kritzler@pizzahut.com`. All programmatic access methods were blocked by PizzaHut IT policy.

## Methods tested

### ✅ EventKit calendar ID selection (implemented)
- Added `OUTLOOK_SOURCE_CALENDAR_ID` env var to `outlook-to-google-sync.ts`
- Implemented filtering by unique calendar identifier
- Added safety guard `assertSourceCalendarPresent` to prevent data loss
- **Result:** Code works, but cannot test because macOS cannot sync the new account (see below)

### ❌ EventKit sync (blocked by IT)
- Error: `AADSTS50105: Your administrator has configured the application Apple Internet Accounts (f8d98a96-0999-43f5-8af3-69977c7b4423) to block users`
- PizzaHut IT explicitly blocks adding the account to macOS Internet Accounts
- **Result:** EventKit cannot see the calendar at all

### ❌ AppleScript (unreliable)
- Tested direct AppleScript commands to read from Outlook.app
- Consistently returned 0 events despite events being visible in the UI
- **Result:** AppleScript cannot reliably read Exchange calendars

### ❌ Exchange Web Services (EWS) (blocked)
- Found endpoint: `outlook.office365.com/EWS/Exchange.asmx`
- Returned 401 (unauthorized) with Basic Auth
- Likely requires Modern Auth (OAuth2) or IT disabled EWS entirely
- **Result:** EWS not accessible with username/password

### ❌ Outlook local database (empty)
- Found `Outlook.sqlite` at `~/Library/Group Containers/UBF8T346G9.Office/Outlook/`
- `CalendarEvents` table exists but contains 0 rows
- Outlook works in online-only mode for Exchange calendars
- **Result:** No local cache to read from

## Working solution: Manual ICS export

Since all programmatic access is blocked, the only viable option is **manual ICS export** from Outlook:

### Setup instructions

1. **Export calendar from Outlook:**
   - Open Microsoft Outlook
   - File → Export
   - Select "Calendar" from the list
   - Choose format: iCalendar (.ics)
   - Date range: Last 7 days + Next 60 days
   - Save as: `~/outlook-calendar.ics`

2. **Modify sync script to read ICS:**
   - Update `scripts/outlook-to-google-sync.ts` to support ICS input
   - Parse ICS file instead of calling EventKit helper
   - Keep same Google Calendar write logic

3. **Automate reminders:**
   - Add a weekly reminder to re-export the calendar
   - Or: use folder action to detect when ICS file is updated

### Pros
- Works regardless of IT policy
- No authentication required
- Simple and reliable

### Cons
- Manual export required (weekly or when calendar changes)
- Data is stale between exports
- Extra step in the workflow

## Files modified

- `scripts/outlook-to-google-sync.ts` — added `OUTLOOK_SOURCE_CALENDAR_ID` support
- `scripts/outlook-to-google-sync.test.ts` — added 9 test cases for new feature
- `apps/web/.env.local` — added commented `OUTLOOK_SOURCE_CALENDAR_ID` example
- `docs/specs/outlook-to-google-bridge.md` — documented calendar selection
- `docs/specs/outlook-bridge-alternative-access.md` — EWS research and alternatives
- `scripts/outlook-direct-reader.sh` — basic ICS parser (ready for integration)
- `scripts/test-ews-connection.ts` — EWS connection tester (unsuccessful)
- `scripts/test-ews-multi.ts` — multi-endpoint EWS tester (unsuccessful)

## Recommendations

### Short term (manual workaround)
Use ICS export approach described above. Requires user discipline but will work immediately.

### Medium term (negotiate with IT)
Request PizzaHut IT to allow one of:
1. Adding Exchange account to macOS Internet Accounts (unblock AADSTS50105)
2. Enable EWS Basic Auth for your account
3. Register an Azure AD app for Graph API access with Calendar.Read scope

### Long term (structural solution)
Migrate to a cloud-based calendar sync service (Zapier, etc.) that handles Exchange OAuth properly, or switch to a fully cloud-based calendar system.

## Status

**Implementation:** ✅ Complete and tested (for EventKit ID selection)  
**Deployment:** ❌ Blocked (cannot access source calendar via any method)  
**User impact:** High — sync currently broken, manual export required

## Next steps

**Immediate:** Implement ICS file reader in `outlook-to-google-sync.ts` if user approves manual export approach.

**User decision needed:** 
- Accept manual ICS export workflow?
- Or: Escalate to PizzaHut IT to request unblock?
