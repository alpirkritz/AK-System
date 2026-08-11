# Finance Insights Engine — תובנות "מתחת לקרחון" לתזרים וליומן המסחר

> **Slug:** `finance-insights-engine`
> **Status:** DRAFT — awaiting approval
> **Author:** PM Agent
> **Last Updated:** 2026-08-11

## Goal

להרחיב את שכבת התובנות ב-`/finance` משכבה דטרמיניסטית-תזרימית בלבד (6 סוגי תובנות קיימים ב-`cashflow-analytics.ts`) לשכבה היברידית מלאה: מנוע תובנות דטרמיניסטי חדש ליומן המסחר (win-rate, ריכוזיות, sizing, רצפים), העמקת מנוע התזרים (תחזית, אנומליות, YoY), שכבה רוחבית (הון, שיעור חיסכון כולל השקעות, תלות מטבעית), ושכבת נרטיב LLM (Gemini) שכותבת "מה באמת קורה מתחת לפני השטח" על בסיס העובדות המחושבות בלבד — בדפוס של `whatsapp-insights.ts`. הכל נחשף גם ל-Hugo ולסוכנים ככלים, עם דחיפת פוש יזומה כשמשהו חריג קורה.

**עיקרון אדריכלי מחייב (ממשיך את התקדים הקיים):** כל מספר נגזר בקוד טהור, נבדק ביחידות, בלי DB ובלי LLM בתוך שירותי החישוב. ה-LLM מקבל אך ורק אובייקטי `Insight`/`Fact` מובנים ומנסח נרטיב — הוא לא מחשב ולא ממציא מספרים.

## Data reality check (read before scoping)

| עובדה | השלכה |
|---|---|
| `commission` ב-`finance_trades` כמעט תמיד 0/null (רוב ענפי הפרסור ב-`ibkr-parser.ts` לא מאכלסים אותו) | תובנת commission-drag תסומן `confidence: low` והמנוע יפיק תובנת data-quality במקום להעמיד פנים |
| 34% מההוצאות מאחורי חיוב אשראי אטום אחד; אפס כרטיסי אשראי מחוברים | תובנות קטגוריה מוגבלות; המנוע חייב לדווח על נקודת העיוורון הזו כתובנה בפני עצמה |
| אין פיד מחירים — פוזיציות פתוחות מוערכות לפי עלות בלבד | "הון נטו" בגרסה זו = יתרות בנק + עלות פוזיציות פתוחות, עם תיוג מפורש. שערוך שוק — Open Question |
| היסטוריית קניות חלקית (מכירות ללא lot תואם תורמות cost basis אפס ב-`pnl.ts`) | מדדי מסחר מסומנים `basedOnMatchedLots` וכמות ה-unmatched מדווחת |
| כל עמודות הכסף/תאריך הן `text` | כל חישוב חדש שומר על הקונבנציה (parseFloat / השוואת ISO strings) |

## User Stories

- כמשקיע, אני רוצה לראות win-rate, יחס רווח/הפסד ממוצע ו-profit factor לתקופה, כדי לדעת אם אני באמת מרוויח מכישרון או מפוזיציה אחת.
- כמשקיע, אני רוצה התרעה כשה-P&L שלי תלוי בסימבול אחד (ריכוזיות) או כשגודל פוזיציה חורג מהפיזור הרגיל שלי, כדי לזהות סיכון לפני שהוא כואב.
- כמשקיע, אני רוצה לזהות דפוסי התנהגות — רצף הפסדים שאחריו הגדלת פוזיציות (revenge trading), over-trading בתקופות הפסד — כדי לתקן הרגלים ולא רק לספור כסף.
- כמנהל תזרים, אני רוצה תחזית תזרים לחודש הקרוב מבוססת מחויבויות קבועות + ממוצעים נגררים, כדי לדעת לאן אני הולך ולא רק איפה הייתי.
- כמנהל תזרים, אני רוצה זיהוי אנומליות (הוצאה/הכנסה שחורגת מהותית מהדפוס ההיסטורי שלה) והשוואת YoY לאותו חודש אשתקד, כדי לתפוס דברים שעין לא רואה בטבלה.
- כבעל התמונה הכוללת, אני רוצה מסך-על רוחבי: הון (בנק + תיק לפי עלות), כמה חודשי הוצאה מכוסים ביתרות, כמה עבר החודש לחיסכון/השקעות ביחס להכנסה, וחשיפה מטבעית ILS/USD.
- כמשתמש, אני רוצה פסקת נרטיב בעברית שכתובה על בסיס העובדות בלבד ומחברת נקודות בין תחומים ("ההפקדות לברוקר גדלו בדיוק בחודשים שבהם שיעור החיסכון ירד"), כדי לקבל את ה"מתחת לקרחון" בלי לקרוא 20 כרטיסים.
- כמשתמש של Hugo, אני רוצה לשאול בצ'אט "איך היה החודש שלי פיננסית" ולקבל תשובה מבוססת הכלים החדשים, וכן לקבל פוש יזום כשתובנה חמורה מתגלה.
- כמשתמש, אני רוצה שהמערכת תגיד לי במפורש מתי היא עיוורת (עמלות חסרות, אשראי לא מחובר, lots לא תואמים), כדי שלא אקבל החלטה על נתון שקרי.

## Acceptance Criteria

### מנוע יומן מסחר (דטרמיניסטי)
- [ ] Given עסקאות ב-`finance_trades`, When קוראים ל-`finance.analytics.tradingInsights({period})`, Then מוחזרים מדדים: `winRate`, `profitFactor`, `avgWin`, `avgLoss`, `expectancy`, `maxDrawdownRealized`, `topSymbolPnlShare`, `avgHoldingDays`, `medianHoldingDays`, `positionSizeCv` (מקדם שונות), `unmatchedSellsCount` — כולם מחושבים ב-`trading-insights.ts` טהור מעל פלט `computeFifoPnl`.
- [ ] Given רצף של ≥3 הפסדים שאחריו עסקה בגודל ≥150% מהחציון, Then נוצרת תובנת `revenge_pattern` (severity `warn`).
- [ ] Given סימבול אחד עם ≥60% מה-P&L הממומש (חיובי או שלילי), Then נוצרת תובנת `concentration`.
- [ ] Given תקופה עם מספר עסקאות ≥200% מהממוצע התקופתי וה-P&L שלה שלילי, Then נוצרת תובנת `overtrading`.
- [ ] Given `commission` חסר ב->50% מהעסקאות בתקופה, Then נוצרת תובנת `data_quality` במקום `commission_drag`, ולא מוצג מספר עמלות מומצא.
- [ ] כל הספים מרוכזים ב-`TRADING_INSIGHT_THRESHOLDS` מיוצא, וכל פונקציה מכוסה ב-`trading-insights.test.ts` (Vitest, כולל מקרי קצה: אפס מכירות, מכירה יחידה, unmatched בלבד).

### העמקת תזרים (דטרמיניסטי, הרחבת `cashflow-analytics.ts`)
- [ ] `forecastNextMonth(txns)` מחזיר תחזית = Σ(מחויבויות recurring חודשיות) + ממוצע נגרר 3 חודשים של השאר, עם פירוק `fixed`/`variable` ו-`confidence`.
- [ ] `detectAnomalies(txns, month)` מסמן תנועה שסטייתה מהממוצע ההיסטורי של אותו `normalizeDescription` עולה על סף (`INSIGHT_THRESHOLDS.anomalyRatio`, ברירת מחדל 2.0 ומינימום ₪500) — insight kind חדש `anomaly`.
- [ ] `yoyComparison(txns, month)` משווה לאותו חודש אשתקד ברמת קטגוריה (רק כשיש כיסוי נתונים לשני הצדדים) — kind חדש `yoy_shift`.
- [ ] קטגוריות internal (`INTERNAL_CATEGORIES`) ממשיכות להיות מוחרגות מכל סכימה — אין רגרסיה בנוסחת ה-countable של `cashflow-data-reliability`.

### שכבה רוחבית (Cross-domain)
- [ ] `finance.analytics.overview()` מחזיר: `bankTotal` (מ-`bank_accounts.balance`), `portfolioCostBasis` (פוזיציות פתוחות לפי עלות ממוצעת משוקללת), `runwayMonths` (יתרות בנק ÷ ממוצע הוצאה חודשית countable 3ח׳), `savingsRateInclInvest` (כולל העברות ל-INTERNAL חיסכון/השקעות), `fxExposure` (חלק ה-USD), `brokerDepositsTrend` — עם `asOf` ו-`valuation: 'cost'` מפורשים.
- [ ] כשאין יתרת בנק עדכנית (מעל 7 ימים) — השדה מסומן `stale: true` והנרטיב מציין זאת.

### שכבת נרטיב LLM
- [ ] שירות חדש `finance-narrative.ts` (packages/api/src/services) בדפוס `whatsapp-insights.ts`: מקבל את מערכי ה-`Insight`+facts משלושת המנועים, מבקש JSON מובנה (`{headline, body, connections[], watchlist[]}`), ועם fallback ל-text בכשל parse. אין לו גישה ל-DB.
- [ ] הפרומפט אוסר במפורש על המצאת מספרים — כל מספר בנרטיב חייב להופיע ב-facts שסופקו; מספר שלא מופיע = באג.
- [ ] תוצאה נשמרת ב-cache בטבלת `finance_insight_narratives` לפי `scopeKey` + `inputHash`; קריאה חוזרת עם אותו hash לא מפעילה את Gemini.
- [ ] כשל Gemini (עומס/מפתח חסר) אינו מפיל את הדף — התובנות הדטרמיניסטיות מוצגות תמיד, הנרטיב מציג שגיאה שקטה עם retry.

### חיבור לסוכנים + פוש
- [ ] נוספים ל-`conversation-engine.ts` (getToolDeclarations/executeTool) הכלים: `get_cashflow_insights`, `get_trading_insights`, `get_finance_overview`, `get_recurring_charges` — עטיפות דקות מעל אותם services.
- [ ] תדריך הבוקר (`morning-briefing`) יכול לכלול שורת פיננסים כשקיימת תובנה בדרגת `warn` ומעלה מה-24 שעות האחרונות.
- [ ] תובנה חדשה בדרגת `warn` עם `amount` מעל סף (ברירת מחדל ₪1,000) מפעילה פוש דרך `pushAssistantMessage` עם קישור עומק ל-`/finance?tab=insights` — לכל היותר פוש פיננסי אחד ביום (dedupe דרך `dedupeSlot`).

### UI
- [ ] `InsightsTab` מקבל בלוק נרטיב עליון (headline + body + connections) עם מצב טעינה/שגיאה נפרד מהכרטיסים.
- [ ] `TradingJournalTab` מקבל סקשן "תובנות מסחר" עם אותו `InsightCard` קיים + כרטיסי מדדים (win-rate, profit factor, expectancy) עם tooltip הסבר בעברית.
- [ ] סקשן "תמונה כוללת" חדש בראש טאב insights: הון, runway, שיעור חיסכון כולל, חשיפה מטבעית — עם תגית "שערוך לפי עלות".
- [ ] תובנות `data_quality` מוצגות בסגנון הבאנר הקיים של coverage, לא ככרטיס רגיל.

## Data Model

טבלה חדשה אחת (ב-`schema.pg.ts` תחילה, מראה ב-`schema.ts`, בלוק bootstrap ב-`database/src/index.ts`):

**`finance_insight_narratives`**
| עמודה | סוג | הערות |
|---|---|---|
| `id` | text PK | |
| `scopeKey` | text, not null | למשל `cashflow:2026-08`, `trading:month`, `overview:2026-08` |
| `inputHash` | text, not null | hash של ה-facts שנשלחו; index ייחודי על (`scopeKey`,`inputHash`) |
| `model` | text | מזהה מודל Gemini בפועל |
| `content` | text, not null | JSON: headline/body/connections/watchlist |
| `generatedAt` | text, not null | ISO |
| `createdAt` | text, not null | |

אין שינוי ב-`finance_trades` / `finance_transactions`. העשרת יומן (strategy/notes/emotion per trade) — מחוץ להיקף, ראו Open Questions.

## tRPC API

הכל תחת `finance.analytics` (router קיים, `protectedProcedure`):

| Procedure | Input (Zod) | Return |
|---|---|---|
| `tradingInsights` | `{ period: z.enum(['week','month','quarter','all']) }` | `{ metrics: TradingMetrics, insights: Insight[], dataQuality: {...} }` |
| `overview` | `z.void()` | `{ bankTotal, portfolioCostBasis, runwayMonths, savingsRateInclInvest, fxExposure, brokerDepositsTrend, asOf, stale }` |
| `narrative` | `{ scope: z.enum(['cashflow','trading','overview']), month: z.string().optional(), force: z.boolean().optional() }` | `{ headline, body, connections[], watchlist[], generatedAt, cached }` |
| `insights` (קיים) | ללא שינוי חתימה | מורחב ב-kinds חדשים: `anomaly`, `yoy_shift`, `forecast_gap`, `data_quality` |

Services חדשים: `packages/api/src/services/trading-insights.ts` (+test), `finance-overview.ts` (+test), `finance-narrative.ts` (+test עם Gemini ממוקק). הרחבות ב-`cashflow-analytics.ts` (+test קיים).

## UI Surface

- `apps/web/src/app/finance/InsightsTab.tsx` — בלוק נרטיב + סקשן overview.
- `apps/web/src/app/finance/TradingJournalTab.tsx` — סקשן תובנות ומדדים.
- קומפוננטות חדשות תחת `finance/components/`: `NarrativePanel.tsx`, `OverviewStrip.tsx`, `TradingMetricCard.tsx` — כולן עם מחלקות design-system קיימות (`.card` וכו'), RTL, dark theme (נדרש UI Designer Agent).
- `conversation-engine.ts` + `A_Agents` (עדכון כרטיס `08_startup_coo.md` ו-morning briefing שהכלים קיימים).

## Out of Scope

- שערוך שוק חי של פוזיציות (פיד מחירים) — הון לפי עלות בלבד בגרסה זו.
- שדות יומן ידניים לעסקה (אסטרטגיה, רגש, סטופ) — ספק המשך אם יוחלט.
- תקציבים/יעדים לקטגוריות ו-what-if simulation.
- חיבור כרטיסי אשראי (visaCal/isracard) — prerequisite מוצרי שנעקב בנפרד (Open Question קיים ב-`cashflow-insights.md`).
- מובייל — נכלל בספק `mobile-web-parity` (טאב הפיננסים במובייל יצרוך את אותם endpoints).
- שינוי מנגנון הייבוא של IBKR או תיקון פרסור עמלות היסטורי.

## Open Questions

1. **פיד מחירים** — להוסיף שערוך שוק (למשל Yahoo Finance לא-רשמי / Alpha Vantage חינמי) כספק המשך? משנה מהותית את ערך ה-overview.
2. **העשרת יומן מסחר** — האם להוסיף `notes`/`strategy`/`setup` ל-`finance_trades` כדי לאפשר תובנות לפי אסטרטגיה? (דורש קלט ידני ממך אחרי כל טרייד.)
3. **תדירות נרטיב** — לחדש אוטומטית פעם ביום (cron) או רק on-demand עם cache? ברירת המחדל בספק: on-demand + cache לפי inputHash.
4. **סף הפוש** — ₪1,000 ל-warn הוא ניחוש; לכייל אחרי שבועיים של ריצה?
