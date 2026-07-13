# IBKR Trading Journal — מ-Notion למערכת + מצב יומי ו-P&L

Detected stack: next-trpc-monorepo

## Goal

להפוך את `finance_trades` במסד הנתונים של המערכת למקור האמת היחיד לעסקאות IBKR: ייבוא יומי אוטומטי דטרמיניסטי מ-Gmail (לא תלוי ב-LLM), ייבוא היסטוריה חד-פעמי מ-Notion, וטאב "יומן מסחר" ב-`/finance` שמציג מה קרה היום, כמה הרווחתי/הפסדתי, ודירוג סימבולים מנצחים מול מפסידים לפי P&L ממומש (FIFO).

## User stories

- כמשקיע, אני רוצה שהמערכת תייבא אוטומטית מיילי IBKR כל יום, כדי שלא אצטרך ללחוץ "סנכרון" ידנית.
- כמשקיע, אני רוצה שהייבוא היומי יעבוד גם כשמנוע ה-LLM עמוס או לא זמין, כדי שלא אאבד עסקאות.
- כמשקיע, אני רוצה לראות מה קרה היום — כמה עסקאות, קניות מול מכירות, ו-P&L יומי.
- כמשקיע, אני רוצה לדעת איפה הרווחתי ואיפה הפסדתי — דירוג סימבולים לפי P&L ממומש.
- כמשקיע, אני רוצה לייבא את ההיסטוריה מ-Notion פעם אחת, בלי כפילויות.
- כמשקיע, אני רוצה לסנן לפי תקופה (היום / השבוע / החודש / הכל).

## Acceptance criteria

- Given מייל IBKR חדש ב-Gmail, When הייבוא היומי רץ, Then העסקה נשמרת ב-`finance_trades` ואינה מוכפלת בהרצה חוזרת.
- Given ש-`GEMINI_API_KEY` חסר או ה-LLM נכשל, When ה-cron מריץ את `05_ibkr_daily_import`, Then הייבוא הדטרמיניסטי עדיין מצליח ומחזיר דיווח עם מספר העסקאות שיובאו.
- Given עסקאות buy/sell לאותו סימבול, When פותחים את טאב "יומן מסחר", Then מוצג P&L ממומש per-symbol לפי FIFO וסיכום התקופה.
- Given סימבול עם מכירה רווחית וסימבול עם מכירה מופסדת, When נטען הדירוג, Then הראשון מופיע ב"מנצחים" והשני ב"מפסידים".
- Given היסטוריה בבסיס הנתונים של Notion "📈 IBKR Transactions", When מריצים `importFromNotion`, Then כל השורות התקינות מיובאות עם dedupe ושורות חסרות שדות מדולגות ומדווחות.
- Given הרצת `importFromNotion` פעמיים, When מריצים בפעם השנייה, Then לא נוצרות כפילויות (dedupe לפי `notion_page_id` או `email_subject`).

## Data model

הרחבה additive של הטבלה `finance_trades` בשלושת המקומות:
[packages/database/src/schema.ts](../../packages/database/src/schema.ts) (SQLite),
[packages/database/src/schema.pg.ts](../../packages/database/src/schema.pg.ts) (Postgres),
ו-DDL + מיגרציית `ALTER TABLE` ב-[packages/database/src/index.ts](../../packages/database/src/index.ts).

| Column | Type | Notes |
|---|---|---|
| `email_subject` | text nullable | נושא המייל / Subject מ-Notion — משמש ל-dedupe |
| `action_type` | text default `'trade'` | `trade` / `dividend` / `interest` / `transfer` |
| `account` | text nullable | מספר חשבון מתוך ה-subject אם קיים |
| `source_detail` | text nullable | שולח + Message Reference Number + Sent Date |
| `notion_page_id` | text nullable | מזהה עמוד Notion למעקב ומניעת כפילויות בייבוא היסטוריה |
| `imported_at` | text nullable | חותמת זמן של הייבוא |

ערכי `source`: `ibkr_email` | `notion_import` | `manual`. מיגרציה additive בלבד — עמודות קיימות אינן משתנות.

## tRPC API

ראוטר: [packages/api/src/routers/finance.ts](../../packages/api/src/routers/finance.ts) (קיים — מרחיבים).

| Procedure | Kind | Input | Return |
|---|---|---|---|
| `syncIBKREmails` | mutation | `{ maxEmails?: number, sinceDays?: number }` | `{ inserted, skipped, failed, total, subjects: string[] }` |
| `importFromNotion` | mutation | `{ dryRun?: boolean }` | `{ inserted, skipped, failed, errors: string[] }` |
| `getTradingJournal` | query | `{ period?: 'today'\|'week'\|'month'\|'all' }` | סיכום תקופה + עסקאות התקופה עם P&L למכירות + מידע סנכרון אחרון |
| `getSymbolRanking` | query | `{ period?: 'today'\|'week'\|'month'\|'all', limit?: number }` | `{ winners[], losers[], breakeven[] }` |

שירותים חדשים (packages/api, self-contained — קוראים env ו-DB ישירות כמו `gmail.ts`):
- [packages/api/src/services/ibkr-import-service.ts](../../packages/api/src/services/ibkr-import-service.ts) — לוגיקת ייבוא Gmail מרוכזת (fetch → parse → dedupe → insert), מחזירה תוצאה מובנית לדיווח.
- [packages/api/src/services/pnl.ts](../../packages/api/src/services/pnl.ts) — מחשבון FIFO טהור (unit-testable): `computeFifoPnl(trades)` → per-symbol P&L + רשימת מכירות ממומשות.
- [packages/api/src/services/notion-ibkr-import.ts](../../packages/api/src/services/notion-ibkr-import.ts) — שולף עמודים מ-Notion "📈 IBKR Transactions" וממפה למבנה עסקה.

לוגיקת P&L (FIFO per symbol):
- כל מכירה מותאמת ל-buy lots הישנים ביותר; `realizedPnl = proceeds - costBasis - commission`.
- `dailyPnl` = סכום ה-P&L של מכירות בתאריך/תקופה הנבחרים.
- `openPositions` = lots שנותרו + עלות ממוצעת (ללא מחיר שוק — מחוץ לגבולות).

## UI surface

מסלול קיים: [apps/web/src/app/finance/page.tsx](../../apps/web/src/app/finance/page.tsx) — מוסיפים טאב חמישי `journal` ("יומן מסחר").
רכיב חדש: [apps/web/src/app/finance/TradingJournalTab.tsx](../../apps/web/src/app/finance/TradingJournalTab.tsx) (lazy, כדי לשמור על `page.tsx` נקי).
סוג DB חדש: `ibkr_transactions` ב-[apps/web/src/lib/notion-config.ts](../../apps/web/src/lib/notion-config.ts).
כפתור "ייבא היסטוריה מ-Notion" בטאב "ייבוא".

מבנה הטאב (RTL, מערכת העיצוב הקיימת — `.card`, `.btn`, `.pill`, זהב `#e8c547`, ירוק `#47b86e`, אדום `#e8477a`):
1. פילטר תקופה (pills): היום | השבוע | החודש | הכל.
2. סרגל סיכום (4 cards): עסקאות בתקופה, P&L ממומש (ירוק/אדום), קניות/מכירות (notional), סנכרון אחרון (זמן + סטטוס).
3. טבלת עסקאות התקופה: תאריך, סימבול, פעולה, כמות, מחיר, P&L (רק למכירות).
4. דירוג סימבולים בשתי עמודות: מנצחים (P&L חיובי) מול מפסידים (P&L שלילי).

מצבי משוב:
- loading: "טוען..." בכל אזור.
- empty (אין עסקאות): "אין עסקאות בתקופה זו — העסקאות יופיעו אחרי סנכרון מיילי IBKR".
- empty (דירוג): "אין מספיק מכירות ממומשות לדירוג עדיין".
- error סנכרון: "לא הצלחנו לקרוא מ-Gmail — בדוק חיבור Google בהגדרות".

## Out of scope

- מחירי שוק / P&L לא-ממומש (unrealized).
- הערות או דירוג ידני לעסקאות.
- תיוג ו-archive של מיילים ב-Gmail (דורש scope `gmail.modify`).
- ניתוח Dividend / Interest / Transfer (הפרסר נשאר ממוקד buy/sell; העמודה `action_type` מוכנה להרחבה עתידית).
- עמוד `/trading-journal` נפרד — הכל בתוך `/finance`.
- כתיבה חזרה ל-Notion (הכיוון היחיד הוא Notion → מערכת).

## Open questions

- נדרש מזהה בסיס הנתונים של "📈 IBKR Transactions" ב-Notion, שיתווסף ל-`NOTION_ACCOUNTS` עם `"type":"ibkr_transactions"`. עד שיוגדר, `importFromNotion` יחזיר שגיאה ידידותית ("לא הוגדר בסיס נתונים של IBKR ב-Notion").
