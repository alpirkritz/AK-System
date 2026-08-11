# QA — mobile-full-parity

> **Date:** 2026-08-11
> **Stack:** next-trpc-monorepo

## Automated

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/mobile exec tsc --noEmit` | PASS |
| `pnpm --filter @ak-system/api exec vitest run src/routers/settings.test.ts` | PASS (19 tests, incl. 3 dashboard) |
| `pnpm test` | PASS (see suite log) |

## Manual checklist (device / web preview)

### IA
- [ ] Header: avatar, 📚, 🔔+badge — no ⚙️
- [ ] More: areas + settings rows only
- [ ] Push cold-start navigation

### Chat / agents
- [ ] Default עוזר כללי
- [ ] AgentPickerSheet switch + separate history
- [ ] Gear → agent config; schedule save; run now
- [ ] Unauthenticated `/api/agents` returns 401

### Features
- [ ] Meeting detail open/edit/delete; calendar agenda
- [ ] People search + review; person/project detail
- [ ] Finance segments load without crash
- [ ] Memory pin/delete; updates sync
- [ ] Dashboard prefs change meeting window

## Notes
- VAT invoice camera deferred (`expo-image-picker` not installed) — copy shows "בפיתוח"
- Playwright N/A for Expo mobile
