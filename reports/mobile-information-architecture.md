# Report — mobile-information-architecture

> **Last Updated:** 2026-08-11
> **Verdict:** APPROVED WITH NITS

## Summary

Information architecture restructure landed as part of `mobile-full-parity`:
- Header: Avatar → account; 📚 reading-list; 🔔 with unread badge
- More hub: Areas + Settings ListRows (no duplicates of header destinations)
- Tab order: Dashboard, Meetings, Tasks, Chat, More
- Push listener + cold start in root `_layout`
- Settings split: notifications / dashboard / developer / workspaces / meeting-types
- Dashboard prefs server-side (`settings.dashboard.*`)

## UI/UX Review (Post-implementation)

**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo (Expo)

### Design System Checklist
- [x] Navy theme + accent
- [x] RTL
- [x] Mobile layout
- [x] No unapproved frameworks
- [x] Shared ListRow / Avatar / ToggleRow

### Findings
- Nit: VAT camera still "בפיתוח" until `expo-image-picker` is added and APK rebuilt
- Nit: projects Stack uses formSheet presentation for list — acceptable but list could be full screen

## Manual QA checklist
- [ ] Avatar opens account; sign-out confirms
- [ ] Bell badge updates after reading notifications
- [ ] More has 7 areas + 5 settings; no reading-list/notifications tiles
- [ ] Push tap from cold start navigates
- [ ] Dashboard shows today's meetings by default
