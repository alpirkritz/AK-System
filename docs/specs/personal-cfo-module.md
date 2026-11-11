# Personal CFO & Financial Intelligence Module — מנהל כספים אישי מלא

> **Slug:** `personal-cfo-module`
> **Status:** DRAFT — awaiting approval
> **Author:** PM Agent
> **Last Updated:** 2026-10-04

## Goal

להוסיף שכבת "CFO אישי" מלאה למודול הפיננסים הקיים, המבוססת על 5 עמודים: (1) סניטיזציה + PII stripping, (2) פרופיל בייסליין מתזרים 12 חודשים, (3) אופטימיזציה טקטית (Leak Hunter, Debt Avalanche, Liquidity Sweep תלת-שכבתי עם אופטימיזציית מסים), (4) ביקורת פנסיה וביטוח ארוכי טווח, (5) סקירת CFO חודשית חוזרת עם סוכן "יריב פיננסי" (adversarial agent). המודול מיושם כטאב חדש בתוך `/finance`, עם מנועי חישוב דטרמיניסטיים טהורים ושכבת נרטיב LLM בעברית שרק מסנתזת טקסט — לעולם לא מחשבת.

**עקרון אדריכלי מוחלט (non-negotiable):** כל חישוב כספי — ריבית דריבית, לוח סילוקין, מס, צבירה — מתבצע בקוד TypeScript טהור ומכוסה בבדיקות יחידה. LLM משמש רק לסיווג נפילה (fallback categorization), פרסור מסמכים, זיהוי אנומליות סמנטיות וסינתזת הודעות בעברית. לעולם לא להעביר מספרים חשופים ל-LLM בלי scrubbing של PII.

## Data Reality Check (read before scoping)

| עובדה | השלכה |
|---|---|
| פרסורי בנק/אשראי נותנים תיאורים מנורמלים לא אחידים | Leak Hunter מסתמך על מנגנון ה-`normalizeDescription` הקיים + LLM fallback לסיווג KEEP/CANCEL/RENEGOTIATE |
| 34% מההוצאות מאחורי חיוב אשראי אטום אחד, אין כרטיסי אשראי מחוברים | התראת כיסוי-נתונים נוספת, אך מנוע הדליפות עובד על מה שיש |
| אין מסד נתונים של חובות/פנסיה/ביטוח נוכחי | דורש 3 טבלאות חדשות + CRUD endpoints |
| קונסטנטות ישראליות 2026 | מרוכז ב-`packages/types/src/il-finance-2026.ts` ומיוצא |
| כל עמודות כסף/תאריך `text` | שומר על הקונבנציה — parseFloat / ISO strings |

## User Stories

### Guardrails & Sanitization
- כמשתמש, אני רוצה שכל נתון פיננסי שעולה לפני LLM יעבור scrubbing של תעודת זהות, מספרי אשראי, IBAN וחשבונות בנק, כדי שלעולם לא תזרום PII למערכת חיצונית.
- כמשתמש, אני רוצה שמערכת הדה-דופליקציה תמזג חיובי אשראי כוללים מהבנק עם פרוט העסקאות מכרטיס האשראי, כדי שסך ההוצאות לא יספור כפול.

### Baseline Profiling
- כמשתמש, אני רוצה לראות פרופיל בייסליין של 12 החודשים האחרונים: קבוע/משתנה/שנתי-ממוצת, הכנסה נטו, "פרי קש" אמיתי (free cash), וכרית מינימום (היסטורית), כדי להבין את מצבי הכספי הבסיסי.
- כמשתמש, אני רוצה לדעת כמה כסף באמת נשאר לי בסוף החודש אחרי כל המחויבויות, לא סך הכנסה פחות הוצאה גולמי.

### Tactical Optimization — Leak Hunter
- כמשתמש, אני רוצה רשימת כל החיובים החוזרים עם סימון KEEP/CANCEL/RENEGOTIATE, כולל חיובים שעלו במחיר YoY (price creep) ומינויים שלא השתמשתי בהם, כדי לחסוך כסף על דברים שונים שאני לא עוקב אחריהם.
- כמשתמש, אני רוצה הודעה בעברית מנוסחת מראש, מנומסת ומקצועית לכל ספק שאני רוצה לנהל אותו מחדש, כדי להעתיק/להדביק ולשלוח מייל או וואטסאפ מיד.
- כמשתמש, אני רוצה סיכום של כל העמלות והריבית שגבה הבנק בחודש האחרון, כדי לזהות דליפות סמויות בדמי ניהול/משיכות/חריגות.

### Tactical Optimization — Debt Exit Plan
- כמשתמש, אני רוצה מחשבון Debt Avalanche שמחשב בדיוק באיזה סדר לפרוע חובות (משיכת יתר, הלוואה, תשלומים) לפי APR מירבי, כדי למזער את סך הריבית ששולם.
- כמשתמש, אני רוצה לראות לוח זמנים של מתי כל חוב מסתיים, כמה ריבית נחסכת לעומת תשלום מינימום, ותאריך היעד לחיסול מלא, כדי לדעת יש תוכנית ברורה.
- כמשתמש, אני רוצה להזין עודף חודשי (surplus) ולראות באופן אוטומטי איך הוא מתחלק על החובות בסדר עדיפות (מבחינה חישובית, לא הערכה).

### Tactical Optimization — Liquidity Sweep
- כמשתמש, אני רוצה שהמערכת תחלק את היתרות שלי לשלוש שכבות: (1) buffer תפעולי (חודש הוצאות + כרית מינימום היסטורית), (2) קרן חירום (3–6 חודשים קבועים → קרן כספית / פקדון קצר), (3) כסף מתוכנן (6–24 חודשים → סולם פקדונות / מק״מ), כדי לייעל את התשואה בלי לסכן נזילות.
- כמשתמש, אני רוצה מחשבון השוואת תשואה נטו: 15% מיסוי נומינלי על פקדון בנק vs. 25% מיסוי ריאלי על קרן כספית בהינתן אינפלציה צפויה, כדי לבחור נכון.
- כמשתמש, אני רוצה המלצת הקצאה ברורה (קרן כספית / סולם פקדונות / מק״מ) עם הנחות מפורשות, כדי לא לנחש בעצמי.

### Pension & Long-Term Audit
- כמשתמש, אני רוצה רשימה של כל פוליסות הפנסיה/קרן השתלמות/ביטוח שלי עם עמלת ניהול נוכחית מול בנצ'מרק רגולטורי 2026 (1.0% על הפקדות, 0.22% על צבירה), כדי לדעת איפה אני משלם יותר מדי.
- כמשתמש, אני רוצה לראות בדיוק כמה כסף גזר העמלות הגבוה גוזל ממני בהקרנה לגיל פרישה 67 (חישוב ריבית דריבית לכל שנה), כדי להבין את העלות האמיתית.
- כמשתמש, אני רוצה זיהוי אוטומטי של פוליסות כפולות, חשבונות לא פעילים וכיסויי סיכון חופפים, כדי לבטל כפילויות ולחסוך.
- כמשתמש, אני רוצה מכתב בעברית רשמי ומנוסח לחברת הביטוח/קופת הגמל עם בקשה להורדת עמלות + ציטוט בנצ'מרק, כדי להעתיק/להדביק ולשלוח.

### Monthly Recurring Review
- כמשתמש, אני רוצה שמערכת תסמן לי כל קטגוריה שחרגה ביותר מ-15% מהממוצע הנגרר 12 חודשים, כדי לתפוס הוצאות חריגות או הפתעות.
- כמשתמש, אני רוצה שמערכת תבדוק אוטומטית אם כסף מעבר ל-buffer Layer 1 אכן הועבר להשקעה/חיסכון, כדי לא להשאיר כסף לא פרודוקטיבי בחשבון השוטף.
- כמשתמש, אני רוצה סוכן "יריב פיננסי" (adversarial financial critic) ששואל "מה יכול לגרום לתוכנית להיכשל?" ונותן 3 פעולות מדורגות לפי השפעה ב-₪, כדי לא להיות בועה.

## Acceptance Criteria

### Stage 0: PII Sanitizer
- [ ] Given טקסט/CSV/Excel עם תעודת זהות ישראלית (9 ספרות), מספר כרטיס אשראי (Luhn-valid 16 ספרות), IBAN (IL + 19 ספרות), When מופעל `sanitizePii(text)`, Then כל המזהים הללו מוחלפים ב-`[REDACTED]` לפני כל קריאת LLM.
- [ ] Given רשימת עסקאות תזרים עם חיוב כרטיס אשראי כולל מהבנק וגם פירוט מהכרטיס, When מופעל `deduplicateAggregateCharges(txns)`, Then חיוב הכולל מוסר אם סך העסקאות המפורטות תואם ±5%.
- [ ] נבדק ב-`cfo-pii-sanitizer.test.ts` עם מקרי קצה (מספרים חוקיים, לא-חוקיים, מספר כרטיס תקף/לא-תקף Luhn).

### Stage 1: Baseline Profiler
- [ ] Given עסקאות 12 חודשים, When מופעל `computeBaseline(txns)`, Then מוחזר: `fixed` (חודשי קבוע), `variable` (חודשי משתנה), `yearlyAmortized` (שנתי/מחולק ב-12), `netIncome`, `freeCash`, `minBalanceCushion` (מינימום היסטורי + מרווח 10%).
- [ ] קטגוריות Internal מוחרגות מכל סכום, בדיוק כמו ב-`cashflow-analytics.ts`.
- [ ] נבדק ב-`cfo-profiler.test.ts` עם מספרים ידועים מראש.

### Stage 2: Leak Hunter
- [ ] Given `RecurringItem[]` מ-`computeRecurring()` של `cashflow-analytics.ts`, When מופעל `analyzeLeaks(recurring)`, Then מזוהים פריטים עם `increasedPct > 0` (price creep), פריטים עם פערי תדירות > 60 ימים (silent cancellation), וסך עמלות בנק.
- [ ] כל פריט מסווג `KEEP` / `CANCEL` / `RENEGOTIATE` לפי כללים דטרמיניסטיים: `increasedPct > 10% → RENEGOTIATE`, `lastDate` > 90 ימים לאחור ו-`avgAmount > 50` → `CANCEL`, אחרת `KEEP`.
- [ ] שכבת LLM מעדנת סיווג בלבד (לא משנה מספרים) ומייצרת הודעה בעברית לכל פריט `RENEGOTIATE` עם template: "שלום, אני לקוח מזה X חודשים. שמתי לב שהתשלום החודשי עלה מ-Y ל-Z. אני מעוניין להמשיך את השירות, אך אשמח לשמוע האם ניתן להתאים את המחיר לרמה הקודמת או להציע תכנית חלופית. תודה."
- [ ] נבדק ב-`cfo-leak-hunter.test.ts` עם recurring items דמה (עליית מחיר, לא פעיל, קבוע).

### Stage 3: Debt Avalanche Engine
- [ ] Given רשימת חובות `{name, balance, apr, minPayment, debtType}[]` + עודף חודשי, When מופעל `computeAvalanche(debts, surplus)`, Then מוחזר לוח זמנים חודשי של תשלומים (highest APR first), תאריך סילוק לכל חוב, סך ריבית ששולמה, וסך ריבית חסוכה לעומת בייסליין min-payment.
- [ ] When surplus=0, Then מחזיר אזהרה ו-min-payment schedule בלבד.
- [ ] When יש חוב יחיד, Then מחזיר לוח פירעון ישר עבורו.
- [ ] נבדק ב-`cfo-debt-avalanche.test.ts` עם 3 מקרים: אפס עודף, חוב יחיד, 3 חובות (כל אחד APR שונה).

### Stage 4: Liquidity Sweep Engine
- [ ] Given יתרת בנק + פרופיל בייסליין, When מופעל `partitionLiquidity(balance, baseline)`, Then מוחזר חלוקה לשלוש שכבות: Layer 1 = `baseline.fixed + baseline.minBalanceCushion`, Layer 2 = `3–6 × baseline.fixed`, Layer 3 = שאר.
- [ ] Given שיעור ריבית פקדון נומינלי + אינפלציה צפויה, When מופעל `compareTaxYield(nominalRate, inflation)`, Then מוחזר נטו ריאלי לשני מסלולי המיסוי (15% פקדון, 25% קרן כספית) עם break-even inflation: `nominalRate × IL_FINANCE_2026.breakEvenInflationFactor`.
- [ ] ההמלצה (`recommendation`) מבוססת על: אם inflation < break-even → פקדון, אחרת → קרן כספית (L2) + סולם פקדונות/מק״מ (L3).
- [ ] נבדק ב-`cfo-liquidity-sweep.test.ts` עם inflation scenarios.

### Stage 5: Pension Audit Engine
- [ ] Given פוליסה `{balance, depositFeePct, accumFeePct, monthlyDeposit, retirementAge}`, When מופעל `auditPensionPolicy(policy, userAge)`, Then מוחזר `excessFeeDrag` = `(depositFeePct - IL_FINANCE_2026.pensionMaxDepositFeePct) × monthlyDeposit × 12 × yearsLeft + (accumFeePct - IL_FINANCE_2026.pensionMaxAccumFeePct) × balance × compound(yearsLeft)`.
- [ ] ה-compound factor לצבירה משתמש בהנחת תשואה שמרנית (3% נומינלי).
- [ ] When `depositFeePct` או `accumFeePct` מעל הבנצ'מרק, Then מסומן `overBenchmark: true`.
- [ ] נבדק ב-`cfo-pension-audit.test.ts` עם פוליסה מעל/מתחת לבנצ'מרק.

### Stage 6: Monthly Review Engine
- [ ] Given עסקאות 12 חודשים + חודש נוכחי, When מופעל `detectAnomalies(txns, currentMonth)`, Then מחזיר רשימת קטגוריות שחריגתן > 15% מהממוצע הנגרר.
- [ ] Given יתרה נוכחית + Layer 1 threshold, When מופעל `validateSweep(balance, threshold)`, Then מחזיר `sweepStatus: 'OK' | 'WARN'` (WARN אם balance > threshold × 1.2).
- [ ] When מופעל `generateAdversarialChecklist(profile, debts, pension)`, Then מחזיר 3 פעולות מדורגות לפי `impactIls` + רשימת stress-tests: "מה אם ההכנסה יורדת ב-20%?", "מה אם חירום דורש משיכת Layer 2?", "מה אם APR עולה?".
- [ ] נבדק ב-`cfo-monthly-review.test.ts`.

### Stage 7: LLM Narrative Layer
- [ ] שירות חדש `cfo-narrative.ts` בדפוס `finance-narrative.ts`: מקבל `facts: Record<string, unknown>` + `context: 'leak' | 'debt' | 'liquidity' | 'pension' | 'monthly'`, ומחזיר JSON `{ headline, body, actionItems[], formalLetter? }`.
- [ ] הפרומפט מכיל שורת guardrail קשיחה: "Calculate with code, don't estimate. Validate financial thresholds against 2026 Israeli regulations."
- [ ] כל מספר בפלט חייב להופיע ב-facts. מספר שלא מופיע = regression test failure.
- [ ] cache ב-`finance_cfo_reports.reportJson` לפי `scopeKey` (למשל `leak:2026-10`) + `inputHash`.
- [ ] כשל Gemini לא מפיל UI — fallback ל-text stub "נתונים זמינים, נרטיב לא זמין".

### Stage 8: tRPC Router
- [ ] Router חדש `cfo.ts` עם 10 procedures (כל אחד `protectedProcedure`):
  - `getProfile()` → baseline
  - `runLeakHunter()` → recurring + classification + Hebrew messages
  - `getDebtPlan()` → avalanche from `finance_debts`
  - `upsertDebt(input)` / `deleteDebt(id)`
  - `getLiquidityPlan(balance, inflation)` → 3-layer partition + tax calc
  - `getPensionAudit()` → policy fees vs benchmark from `finance_pension_policies`
  - `upsertPensionPolicy(input)` / `deletePensionPolicy(id)`
  - `getMonthlyReview()` → anomalies + sweep + adversarial
  - `sanitizeUpload(text)` → PII-stripped preview
- [ ] רשום ב-`packages/api/src/index.ts` כ-`cfo: cfoRouter`.

### Stage 9: UI — CFO Tab
- [ ] טאב חדש `'cfo'` נוסף ל-`TABS` ב-`apps/web/src/app/finance/page.tsx`.
- [ ] קומפוננטה חדשה `CfoTab.tsx` עם 6 סקשנים:
  1. **Dashboard** — KPI cards: free cash, debt-free date (או "אין חובות"), sweep status, ע״פ `SummaryCard` קיים
  2. **Leak Hunter** — טבלה של recurring charges עם badge צבעוני (KEEP=ירוק, CANCEL=אדום, RENEGOTIATE=כתום) + כפתור העתקת הודעה בעברית
  3. **Debt Exit Plan** — לוח זמנים חודשי, progress bar ליחס נותר/מקורי, סך ריבית חסוכה
  4. **Liquidity Sweep** — donut chart של 3 השכבות + slider לבחירת inflation projected + תצוגת נטו ריאלי לשני מסלולי מיסוי
  5. **Pension Audit** — כרטיס לכל פוליסה עם gauge של עמלה/בנצ'מרק + אומדן fee drag + כפתור "צור מכתב" שמייצר טקסט רשמי להעתקה
  6. **Monthly Review** — רשימת אנומליות (קטגוריה + % חריגה), סטטוס sweep, adversarial checklist (3 פעולות + stress tests)
- [ ] כל UI בעברית RTL, dark theme, `.btn` / `.input` / `.card` מהמערכת הקיימת.
- [ ] UI Designer Agent approval נדרש.

### Stage 10: E2E Tests
- [ ] `apps/web/e2e/cfo-tab.spec.ts` כולל:
  - טעינת טאב CFO
  - יצירת חוב דמה, בדיקת הופעתו בטבלה, מחיקתו
  - בדיקת טעינת Leak Hunter table עם recurring items
  - בדיקת כניסה לסקשן Liquidity Sweep ושינוי slider inflation

## Data Model

3 טבלאות חדשות (ב-`schema.pg.ts` תחילה, מראה ב-`schema.ts`, bootstrap ב-`database/src/index.ts`):

### `finance_debts`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `userId` | text, not null | index |
| `name` | text, not null | שם החוב (למשל "משיכת יתר בנק הפועלים") |
| `balance` | text, not null | יתרה נוכחית, כמו שאר עמודות הכסף |
| `apr` | text, not null | ריבית שנתית אפקטיבית (עשרוני) |
| `minPayment` | text, not null | תשלום מינימום חודשי |
| `debtType` | text, not null | `overdraft` \| `credit_loan` \| `installment` |
| `createdAt` | text, not null | |

### `finance_pension_policies`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `userId` | text, not null | index |
| `provider` | text, not null | שם חברה (מיטב דש, הראל, וכו') |
| `policyType` | text, not null | `pension` \| `keren_hishtalmut` \| `gemel_lehaskaa` \| `bituach_managers` |
| `balance` | text, not null | צבירה נוכחית |
| `depositFeePct` | text, not null | עמלת ניהול על הפקדות (עשרוני) |
| `accumFeePct` | text, not null | עמלת ניהול על צבירה (עשרוני) |
| `monthlyDeposit` | text, not null | הפקדה חודשית ממוצעת |
| `retirementAge` | integer | גיל פרישה (ברירת מחדל 67) |
| `isActive` | integer, default 1 | 0/1 (inactive = זיהוי כפילות) |
| `createdAt` | text, not null | |

### `finance_cfo_reports`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `userId` | text, not null | index |
| `reportMonth` | text, not null | `YYYY-MM` |
| `scopeKey` | text, not null | `leak`, `debt`, `liquidity`, `pension`, `monthly` |
| `inputHash` | text, not null | hash של facts שנשלחו |
| `reportJson` | text, not null | JSON: headline/body/actionItems/formalLetter |
| `model` | text | Gemini model ID |
| `generatedAt` | text, not null | |
| `createdAt` | text, not null | |

Index ייחודי על (`userId`, `scopeKey`, `inputHash`) למניעת regeneration מיותרת.

## tRPC API

Router חדש: `cfo` (registered ב-`packages/api/src/index.ts`), כל procedure הוא `protectedProcedure`:

| Procedure | Input | Return |
|---|---|---|
| `getProfile` | `z.void()` | `{ fixed, variable, yearlyAmortized, netIncome, freeCash, minBalanceCushion }` |
| `runLeakHunter` | `z.object({ forceRefresh: z.boolean().optional() })` | `{ items: LeakItem[], totalBankFees, narrativeHeadline, narrativeBody }` |
| `getDebtPlan` | `z.object({ monthlySurplus: z.number().positive() })` | `{ timeline: MonthlyPayment[], debtFreeDate, totalInterestPaid, totalInterestSaved, narrative }` |
| `listDebts` | `z.void()` | `Debt[]` |
| `upsertDebt` | `z.object({ id?, name, balance, apr, minPayment, debtType })` | `{ id }` |
| `deleteDebt` | `z.object({ id: z.string() })` | `{ success: boolean }` |
| `getLiquidityPlan` | `z.object({ currentBalance: z.number(), projectedInflation: z.number().min(0).max(0.2) })` | `{ layer1, layer2, layer3, depositNetYield, mmfNetYield, recommendation, narrative }` |
| `listPensionPolicies` | `z.void()` | `PensionPolicy[]` |
| `upsertPensionPolicy` | `z.object({ id?, provider, policyType, balance, depositFeePct, accumFeePct, monthlyDeposit, retirementAge?, isActive? })` | `{ id }` |
| `deletePensionPolicy` | `z.object({ id: z.string() })` | `{ success: boolean }` |
| `getPensionAudit` | `z.object({ userAge: z.number().int().min(18).max(67) })` | `{ policies: AuditedPolicy[], totalFeeDrag, narrative, formalLetterTemplate }` |
| `getMonthlyReview` | `z.object({ month: z.string() })` | `{ anomalies: Anomaly[], sweepStatus, adversarialChecklist: ActionItem[], stressTests: string[], narrative }` |
| `sanitizeUpload` | `z.object({ text: z.string() })` | `{ sanitized: string, redactedCount: number }` |

Services חדשים (כולם ב-`packages/api/src/services/`):
- `cfo-pii-sanitizer.ts` + `.test.ts`
- `cfo-profiler.ts` + `.test.ts`
- `cfo-leak-hunter.ts` + `.test.ts`
- `cfo-debt-avalanche.ts` + `.test.ts` ★ most critical
- `cfo-liquidity-sweep.ts` + `.test.ts`
- `cfo-pension-audit.ts` + `.test.ts`
- `cfo-monthly-review.ts` + `.test.ts`
- `cfo-narrative.ts` + `.test.ts` (with mocked Gemini)

קובץ קבועים: `packages/types/src/il-finance-2026.ts` (exported מ-`packages/types/src/index.ts`).

## UI Surface

- `apps/web/src/app/finance/page.tsx` — הוספת `'cfo'` ל-`TABS`
- `apps/web/src/app/finance/CfoTab.tsx` — הקומפוננטה הראשית
- `apps/web/src/app/finance/components/CfoDashboard.tsx` — KPI cards
- `apps/web/src/app/finance/components/LeakHunterTable.tsx` — recurring charges table
- `apps/web/src/app/finance/components/DebtExitPlan.tsx` — amortization timeline + progress
- `apps/web/src/app/finance/components/LiquiditySweepPanel.tsx` — donut + slider + yield comparison
- `apps/web/src/app/finance/components/PensionAuditCards.tsx` — policy cards + letter generator
- `apps/web/src/app/finance/components/MonthlyReviewPanel.tsx` — anomalies + adversarial checklist

כל UI:
- עברית RTL
- Dark theme (`#0e1626` bg, `#2dd4bf` accent)
- `.btn`, `.input`, `.card` מה-design system הקיים
- Responsive (desktop + mobile)

UI Designer Agent approval נדרש לפני merge.

## Out of Scope

- חיבור אוטומטי לפורטלים של חברות פנסיה/ביטוח (API scraping) — הזנת נתונים ידנית בלבד בגרסה זו
- אינטגרציה עם מערכות משכנתא (לא נגזרת מתזרים ולא מיוצגת ב-schema)
- תקציבים/יעדים לקטגוריות (דורש ספק נפרד)
- what-if simulation עם שינוי פרמטרים מרובה (feature נפרד עתידי)
- ניתוח פנסיוני מתקדם (asset allocation, תשואה היסטורית, switching cost) — רק benchmark fees בגרסה זו
- יישום של כלי CFO כסוכן אוטונומי שרץ בcron ושולח פוש יזום — פאזה 2
- mobile — תיכלל בספק `mobile-web-parity` כשיופעל

## Open Questions

1. **User age source** — איפה לשמור את גיל המשתמש (נדרש לחישוב pension audit)? להוסיף `user_settings.birthYear` או לבקש בזמן ריצה?
2. **Debt import** — האם לאפשר ייבוא חובות מתזרים אוטומטי (זיהוי overdraft interest / installment patterns)? דורש parser נוסף.
3. **Pension API scraping** — האם יש צורך בעתיד באינטגרציה עם מסלקה פנסיונית / הר הביטוח? (data entry ידני בגרסה זו)
4. **Push triggers** — מתי לשלוח פוש יזום? (ברירת מחדל: לא, רק on-demand מה-CFO tab; phase 2 = cron monthly review + push).
5. **Inflation source** — לאפשר fetch אוטומטי של CPI צפוי מ-Bank of Israel או להשאיר manual slider? (manual בגרסה זו).
6. **Benchmark updates** — האם לאפשר עדכון שנתי אוטומטי של `IL_FINANCE_2026` constants או hardcode? (hardcode 2026, עדכון ידני בעתיד).
