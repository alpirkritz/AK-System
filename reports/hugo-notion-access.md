# Review — hugo-notion-access

**Verdict:** APPROVED

## Scope
Spec: `docs/specs/hugo-notion-access.md`. Give Hugo real, on-demand access to Notion across two accounts (meetings + tasks), route daily-prep through Notion, and make missing DB shares diagnosable — so Hugo stops reporting "no access to Notion".

## Changes
- `apps/web/src/lib/notion-config.ts` (new) — multi-account config from `NOTION_ACCOUNTS` JSON (`label`, `token`, typed `databases`); backward-compat fallback to `NOTION_API_KEY` + legacy hardcoded DBs; `getNotionAccounts`/`isNotionConfigured`/`getDatabasesByType`/`getAssistantTarget`.
- `apps/web/src/lib/notion.ts` — refactored to multi-account: token-parameterized `notionRequest`/`queryDatabase`; `getNotionTasks` (all accounts), new `getNotionMeetings`, `searchNotion`, `getNotionStatus`; fault-tolerant `getNotionContext` (per-DB errors collected, never blanks the block); `formatNotionContextForPrompt` now includes meetings + access warnings; `notifyNotionInbox` uses the configured assistant target.
- `apps/web/src/lib/conversation-engine.ts` — new tools `get_notion_tasks`, `get_notion_meetings`, `search_notion`, `notion_status` (declarations + executor cases); `resolveIntent` system prompt advertises Notion tools + daily-prep routing. Tools reach both the web (`resolveIntent`) and WhatsApp/agents (`runGeminiAgentChat`) engines via the shared `getToolDeclarations()`/`executeTool()`.
- `apps/web/src/lib/gemini-agent-engine.ts` — Hugo block advertises Notion tools across all accounts and routes daily prep through `get_notion_meetings` + `get_notion_tasks`; instructs never to claim no access and to use `notion_status` to name unshared DBs.
- `apps/web/src/app/api/notion/status/route.ts` (new) — auth-gated GET returning per-account/per-DB connectivity.
- `apps/web/src/app/settings/page.tsx` — new `NotionCard` (RTL, design-system) listing each account/DB with reachable/error badges + "check again"; rendered after Google accounts.
- `A_Agents/01_Hugo_orchestrator.md`, `S_Skills/wf_morning_brief.md` — data-access row, WhatsApp interface, and morning-brief steps updated for multi-account Notion + tools.
- Env docs: `apps/web/.env.local.example`, `deploy/production.env.example` — `NOTION_ACCOUNTS` format.
- Tests: `apps/web/vitest.config.ts` + `notion-config.test.ts` + `notion.test.ts`; `test`/`test:watch` scripts and `vitest` devDep added to `apps/web/package.json`.

## Verification
- Web unit tests: 13/13 pass (`pnpm --filter @ak-system/web run test`) — config parsing (valid/invalid/legacy fallback), meetings split, search, partial-failure error surfacing, status, and not-configured error path.
- API tests: 33/33 pass (`pnpm test`).
- Build: `pnpm --filter @ak-system/web build` passes; `/api/notion/status` route emitted; `/settings` compiles.
- IDE lint (ReadLints) clean on all edited/added TS/TSX files.

## Notes / Out of scope
- No new tRPC procedure: the Notion client lives in `apps/web/src/lib`, so status is exposed via a Next.js route handler (`/api/notion/status`) rather than tRPC. Documented in the spec.
- `next lint` in `apps/web` is unconfigured (interactive prompt) — pre-existing repo state, not introduced here; TS type-checking runs via the Next build.
- Write access unchanged (Inbox notification only); recommendations-only per spec.
- Credentials remain env-based (`NOTION_ACCOUNTS` / `NOTION_API_KEY`), matching the Google/WhatsApp secrets pattern. Each database must be shared with its integration in Notion — surfaced by `notion_status` and the Settings card.
