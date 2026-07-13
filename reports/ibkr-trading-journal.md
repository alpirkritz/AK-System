# IBKR Trading Journal — Report

## UI/UX Review

**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo

Review of the planned "יומן מסחר" tab added to [apps/web/src/app/finance/page.tsx](../apps/web/src/app/finance/page.tsx) via [apps/web/src/app/finance/TradingJournalTab.tsx](../apps/web/src/app/finance/TradingJournalTab.tsx), plus the "ייבא היסטוריה מ-Notion" button in the Import tab.

### Design System Checklist
- [x] Matches project tokens/classes — `.card`, `.btn`, `.btn-primary`, `.btn-ghost`, `.pill`, gold `#e8c547`, P&L green `#47b86e` / red `#e8477a`, consistent with the existing Portfolio and Cashflow tabs.
- [x] RTL layout preserved — the tab lives inside the existing `dir="rtl"` finance page; tables use `text-right` headers like the current trade table.
- [x] Mobile layout works — summary cards use `grid-cols-2 lg:grid-cols-4`; tables wrap in `overflow-x-auto` with `min-w-[...]` exactly like the existing tables.
- [x] No unapproved UI frameworks introduced — reuses the local `SummaryCard`, plain Tailwind, no shadcn/Radix.
- [x] Reuses existing components — mirrors `fmt`, `fmtDate`, `SummaryCard`, pill styling, tab bar pattern.

### UX Quality Checklist
- [x] Clear visual hierarchy — period filter first, then summary, then daily trades, then winners/losers ranking. One primary action (סנכרון) already lives in the Import tab; the journal is read-first.
- [x] Cognitive load minimized — the four cards answer "מה מצבי היום" at a glance; ranking answers "איפה הרווחתי ואיפה הפסדתי" without the user reading raw rows.
- [x] Feedback states handled — loading ("טוען..."), empty trades, empty ranking, and a sync-status badge (last run time + ok/error) are all specified.
- [x] Destructive actions require confirmation — the only mutation surfaced here is the one-time "ייבא היסטוריה מ-Notion", which uses a confirm dialog before running.
- [x] Microcopy — verb-first Hebrew, human error text, no raw codes.
- [x] Touch targets — pills and buttons follow the existing `.btn`/`.pill` sizing already used across `/finance`.

### Microcopy (exact Hebrew)
- Period pills: `היום` · `השבוע` · `החודש` · `הכל`.
- Summary cards: `עסקאות בתקופה`, `P&L ממומש`, `קניות / מכירות`, `סנכרון אחרון`.
- Sync status badge: `✓ הצליח` (green) / `✗ נכשל` (red) / `— טרם רץ` (muted).
- Ranking headers: `מנצחים` / `מפסידים`.
- Empty (trades): `אין עסקאות בתקופה זו — העסקאות יופיעו אחרי סנכרון מיילי IBKR`.
- Empty (ranking): `אין מספיק מכירות ממומשות לדירוג עדיין`.
- Notion import button: `ייבא היסטוריה מ-Notion`, confirm text: `לייבא את היסטוריית העסקאות מ-Notion? כפילויות ידולגו אוטומטית.`
- Notion not configured: `לא הוגדר בסיס נתונים של IBKR ב-Notion — הוסף אותו ל-NOTION_ACCOUNTS`.

### Findings
- Must-fix: none.
- Nits (all applied in the implementation):
  - Show the P&L cell only for sells; leave buys with a muted `—` so the column reads cleanly.
  - The "סנכרון אחרון" card renders an absolute he-IL time rather than a raw ISO string.
  - Ranking defaults to top/bottom 5 to avoid overwhelming the view.

## QA & Reviewer

**Verdict:** APPROVED

- Unit tests: `pnpm --filter @ak-system/api test` — 83 passed (10 new for FIFO P&L + import report) in [packages/api/src/services/pnl.test.ts](../packages/api/src/services/pnl.test.ts).
- Build/type-check: `pnpm --filter @ak-system/web build` — succeeded; `/finance` route compiled.
- E2E: [apps/web/e2e/trading-journal.spec.ts](../apps/web/e2e/trading-journal.spec.ts) authored (journal tab summary + ranking, Notion import button). Not executed here (requires a running authenticated server).
- Lint: repo has no configured ESLint (`next lint` is interactive/unconfigured) — pre-existing; not introduced by this change.

### Spec conformance
- Source of truth moved to `finance_trades`; deterministic import wired into the daily cron via [apps/web/src/lib/agent-trigger-runner.ts](../apps/web/src/lib/agent-trigger-runner.ts) so it runs independent of LLM load — addresses the "עומס גבוה" failure.
- FIFO realized P&L per symbol; `getTradingJournal` + `getSymbolRanking` power the journal tab.
- One-time Notion historical import via `importFromNotion` with page-id/subject dedupe.
- ABC docs ([A_Agents/05_ibkr_daily_import.md](../A_Agents/05_ibkr_daily_import.md), [S_Skills/wf_ibkr_daily_import.md](../S_Skills/wf_ibkr_daily_import.md)) updated to the new architecture.
