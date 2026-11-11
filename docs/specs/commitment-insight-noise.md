# commitment-insight-noise — פחות התחייבויות, ותובנות שלא חוזרות

## Goal

שלושה תסמינים מתרחשים יחד:
1. ההתחייבויות מכילות ניחושים שאינם אמיתיים (הסריקה לא מספיק קפדנית, ומסלול הסיכום הלילי מוסיף עוד).
2. התחייבות שנדחתה חוזרת בסריקה הבאה בניסוח קצת שונה.
3. תובנות חוצות שנדחו חוזרות בדחיפה מחר.

## User stories

- כמשתמש, אני רוצה שהתחייבות שדחיתי לא תחזור בסריקה הבאה גם אם המודל ניסח אותה אחרת.
- כמשתמש, אני רוצה שרק התחייבויות שאישרתי מזינות תובנות חוצות ודחיפות.
- כמשתמש, אני רוצה לא לקבל את אותה תובנה חוצה בדחיפה כל יום אחרי שכבר ראיתי אותה.

## Acceptance criteria

- [ ] לחיצה על **דחה** בהתחייבות — הסריקה הבאה לא מציעה אותה שוב, גם בניסוח שונה.
- [ ] סיכום הלילה (`whatsapp-dm-summary`) לא מציע התחייבויות חדשות.
- [ ] מייל לא מציע התחייבויות דרך זיהוי פעלים בלבד — בלי מודל, אפס הצעות.
- [ ] הגלאים של ה-Harness בונים תובנות רק מהתחייבויות `accepted`.
- [ ] תובנה חוצה שנדחפה לא נדחפת שוב (עמודת `notified_at`).
- [ ] דחיית התחייבות סוגרת מיד תובנות שמבוססות עליה.
- [ ] הכפתור **התעלם** בווידג׳ט תישא עכשיו **דחה**.

## Data model changes

### `packages/database/src/schema.ts` ו-`schema.pg.ts`

הוסף עמודה ל-`harness_insights`:

```sql
notified_at text  -- ISO timestamp; null = טרם נדחפה
```

שום טבלה אחרת לא משתנה.

### `packages/database/src/index.ts`

הוסף `ALTER TABLE harness_insights ADD COLUMN IF NOT EXISTS notified_at TEXT` לבלוק ה-SQLite bootstrap.

## tRPC API shape

אין נהלים חדשים. שינויים בקיימים:

| נוהל | שינוי |
|---|---|
| `harness.dismissInsight` | ללא שינוי בחתימה |
| `commitments.dismiss` | אחרי סימון `dismissed` — קורא ל-`closeInsightsForCommitment(db, commitmentId)` |

## שינויי שירות

### `packages/api/src/services/whatsapp-dm.ts`

**`classifyMessagesWithModel` — פרומפט קפדן יותר:**

הוסף לפרומפט (אחרי שורת ה-«Be strict»):
- «Return empty when in doubt. Uncertainty, vague intent ("I'll think about it"), encouragement, or a task already resolved in the thread are not commitments.»
- לפני הקריאה למודל: שלוף מה-DB את ההתחייבויות ה-`dismissed` לאותו `personId` (30 האחרונות), העבר אותן בראש הפרומפט כ-`REJECTED (do not return these or any rephrasing):\n- ...`, ואחרי קבלת התשובה — סנן כל פריט שה-`content` שלו קרוב לאחד מהנדחים (נרמול: `toLowerCase().replace(/[^\u05d0-\u05ea a-z0-9]/g, '').trim()`, חפיפה של ≥0.8 לפי Jaccard על מילים) **או** שה-`sourceId` שלו כבר קיים ב-DB בסטטוס `dismissed`.

**`summarizeDmChats` — ללא הצעת התחייבויות:**

הסר את קטע הקריאה ל-`proposeCommitments` שבתוך `summarizeDmChats`. הסיכום עצמו נשמר. `DmSummaryRunResult.commitments` יחזיר תמיד 0 ו-`proposed: []`.

### `packages/api/src/services/email-sync.ts`

הסר את הקריאה ל-`detectCommitmentsHeuristic` ול-`proposeCommitments` בתוך `syncEmailThreads`. כשאין מודל זמין — אפס הצעות, ללא נפילה להיוריסטיקה.

### `packages/api/src/services/harness-reasoner.ts`

**גלאים — `accepted` בלבד:**

בשלושת הגלאים שמסתכלים על `commitments`:
- `detectSilentBeforeMeeting` — שורה 124: שנה `['proposed', 'accepted']` ל-`['accepted']`
- `detectCoolingWithOpenLoop` — שורה 193: אותה שורה
- `detectStaleCommitments` — שורה 246: אותה שורה

**`persistInsights` — retire-on-miss:**

אחרי ה-upsert loop, שלוף את כל המפתחות שה-reasoner **לא** החזיר בריצה הנוכחית (`dedupeKey NOT IN [keys]`) ושסטטוסם `open`, וסגור אותם (`status = 'retired'`).

**`closeInsightsForCommitment` (פונקציה חדשה):**

```ts
export async function closeInsightsForCommitment(db: Db, commitmentId: string): Promise<void>
```

שולפת את כל ה-`harness_insights` שה-`sources` (JSON) שלהן מכיל `nodeId` עם הערך `commitment:<commitmentId>` וסטטוסן `open`, ומסמנת אותן `dismissed`.

### `apps/web/src/app/api/cron/harness-insights/route.ts`

**push dedupe:**

אחרי `listOpenInsights`, סנן רק תובנות שה-`notifiedAt` שלהן הוא `null`. אם רשימת הדחופות החדשות ריקה, שלח תובנת `attention` חדשה אחת (הראשונה שטרם נדחפה). אחרי שליחה, עדכן `notified_at = now()` לכל התובנות שנכללו. הסר את בדיקת `wasNotificationSentToday` (מוחלפת במנגנון זה).

### `apps/web/src/components/HarnessWidget.tsx`

שנה את תווית הכפתור מ-`'התעלם'` ל-`'דחה'`.

### `packages/api/src/routers/commitments.ts`

בנוהל `dismiss` — אחרי `update ... set status = 'dismissed'`, קרא ל-`closeInsightsForCommitment(ctx.db, input.commitmentId)`.

## UI surface

- וידג׳ט תובנות חוצות בדשבורד: כפתור «התעלם» → «דחה».
- אין שינוי אחר ב-UI.

## Out of scope

- שינוי בתדירות הסריקה (נשאר 10 דקות).
- שינוי בסריקת קבוצות (אותו פרומפט, אותו חסם דחייה).
- שינוי ב-UI של מסך ההתחייבויות.

## Open questions

- Jaccard threshold של 0.8 — אם זה נמוך מדי ויחסום התחייבויות שונות, אפשר להעלות ל-0.85 אחרי תצפית.
