# Mobile Web Parity — כל יכולות ה-web באפליקציה, מותאם-טלפון

> **Slug:** `mobile-web-parity`
> **Status:** In implementation via [`mobile-full-parity.md`](./mobile-full-parity.md)
> **Author:** PM Agent
> **Last Updated:** 2026-08-11

## Goal

לסגור את פער הפונקציונליות בין `apps/web` (~20 אזורים) ל-`apps/mobile` (~5 אזורים חלקיים) כך שכל מה שאלפיר צריך בתנועה זמין בטלפון — בגרסה **מותאמת-טלפון**, לא פורט של ה-desktop: אג'נדה במקום גריד יומן, sheets במקום מודאלים רחבים, קריאה+פעולות נפוצות בפיננסים במקום קונסולות ייבוא. רשימה מפורשת של יכולות נשארת web-only בכוונה (אדמין/רגישות/קלט-כבד) — ראו Out of Scope. הביצוע בגלים מקבילים ללא תלות הדדית, אחרי prerequisite אחד משותף.

**אין כמעט עבודת backend:** כל ה-procedures קיימים ונגישים ב-Bearer auth. העבודה היא מסכים + עטיפות ב-`apps/mobile/lib/data.ts`.

## Prerequisite משותף (חובה לפני כל הגלים)

שכבת קומפוננטות משותפת `apps/mobile/components/`: `StatusPill` (כיום משוכפל בשני קבצים), `Card`, `FilterChips`, `RtlRow`/`RtlText`, `FormSheetScaffold` (הדפוס של `task/[id]`), `EmptyState`, `SectionHeader`, `KpiCard`. בנוסף: הרחבת `MobileNotificationRoute` ב-`apps/mobile/lib/api.ts` לכל route חדש (כיום יעדים web-only נופלים בשקט ל-`/`), ועדכון מיפוי ה-deep-links.

## User Stories

- כמשתמש בדרכים, אני רוצה לפתוח פגישה מהרשימה ולראות/לערוך פרטים, משתתפים, הערות סדרה ומשימות מקושרות — כמו ב-web.
- אני רוצה ליצור ולערוך פגישות מהטלפון ולהריץ סנכרון Google Calendar ידני.
- אני רוצה תצוגת יומן יומית/אג'נדה עם אירועי Google Calendar, קונפליקטים, וסינון יומנים.
- אני רוצה לפתוח איש קשר, לערוך אותו, ליצור חדש, ולעבור על תור ה-review — לא רק רשימה לקריאה.
- אני רוצה את כל הפיננסים לקריאה ופעולה קלה: KPIs, תזרים עם שינוי קטגוריה, תובנות (כולל הנרטיב מ-`finance-insights-engine`), יומן מסחר, יתרות חשבונות, וסיכום מע"מ — וגם לצלם חשבונית במצלמה ולשלוח לפרסור.
- אני רוצה פרויקטים: רשימה + מסך פרויקט עם פגישות/משימות/אנשים.
- אני רוצה לבחור סוכן בצ'אט ולנהל שיחה פר-סוכן, ולערוך את הזיכרון וההנחיות הקבועות של Hugo.
- אני רוצה את פיד העדכונים (RSS) עם סינון וסימון.
- אני רוצה לנהל העדפות התראות פר-טריגר מהמכשיר שמקבל את הפושים, ולנהל workspaces וסוגי פגישות.
- אני רוצה דשבורד עשיר: רצועת יומן, קונפליקטים, סימון משימה כבוצעה במקום, וקישורי עומק לפריט עצמו.
- אני רוצה שהמשימות יקבלו את מה שחסר: חיפוש טקסט, סינון פרויקט/פגישה, מחיקה, תיאור, קישור לפרויקט/פגישה.

## Acceptance Criteria

### גל A — פגישות ויומן
- [ ] מסך `meeting/[id]` (formSheet כמו `task/[id]`): צפייה+עריכה של שדות, משתתפים, פרויקט מקושר, הערות סדרה (`updateSeriesNotes`), משימות מקושרות עם toggle, מחיקה עם אישור.
- [ ] יצירת פגישה ועריכה מ-`(tabs)/meetings`, כולל סוג פגישה ו-workspace; כפתור סנכרון `syncFromCalendar` עם דיווח created/updated/deleted.
- [ ] מסך `calendar` (Stack): אג'נדה יום/3-ימים, אירועי Google לפי היומנים שנבחרו, אינדיקציית קונפליקטים, ניווט תאריכים. **אין** גריד שבוע/חודש.
- [ ] רשימת הפגישות מקבלת: סינון לפי סוג, קיבוץ סדרות, ופגישות עבר.

### גל B — אנשים ופרויקטים
- [ ] `people` עובר ל-`people.listPaginated` עם עימוד, סינון ומיון כב-web; מסך `person/[id]` עם עריכה, תגיות, goal, פגישות ומשימות קשורות; יצירת איש קשר; טאב review queue עם אישור/דחייה.
- [ ] מסך `projects` (רשימת כרטיסים עם מוני פגישות/משימות) + `project/[id]` (פגישות, משימות עם toggle, אנשים, workspaces) + יצירה/עריכה.

### גל C — פיננסים (מותאם)
- [ ] מסך `finance` (Stack, נפתח מהדשבורד ומההדר) עם סגמנטים: **סיכום** (4 ה-KPIs של `getSummary` + רצועת overview), **תזרים** (רשימת תנועות עם שינוי קטגוריה inline + applyToSimilar), **תובנות** (כרטיסי insights + נרטיב + coverage banner), **יומן מסחר** (KPIs תקופתיים, מנצחים/מפסידים, תובנות מסחר), **חשבונות** (snapshot יתרות לקריאה בלבד + זמן סנכרון אחרון), **מע"מ** (סיכום תקופתי/שנתי לקריאה בלבד).
- [ ] צילום חשבונית: כפתור מצלמה/גלריה (`expo-image-picker`) → `vat.parseInvoice` → טופס אישור → יצירת רשומת מע"מ. (זו החלופה המובייל-נכונה לייבוא קבצים. permission חדש + בנייה מחדש של Helm APK — אושר 2026-08-11.)
- [ ] גרפים כרכיבי bar פשוטים ב-View בלבד (הוחלט 2026-08-11) — בלי ספריית גרפים ובלי WebView.

### גל D — סוכנים, זיכרון, עדכונים
- [ ] בורר סוכנים בטאב הצ'אט + **הגדרות תפעוליות של הסוכן** (תזמון, אירועים, הודעת טריגר, שם תצוגה, הרץ עכשיו). הועבר לספק ייעודי: [`mobile-agent-picker-and-config.md`](./mobile-agent-picker-and-config.md) — עודכן 2026-08-11, ראו Out of Scope. עריכת instructions/workflow נשארת web-only.
- [ ] מסך `memory`: עריכת הנחיות קבועות, רשימת זיכרונות עם pin/unpin, יצירה ומחיקה.
- [ ] מסך `updates`: פיד עם סינון קטגוריה, פתיחה בדפדפן, סנכרון ידני; **ללא** ניהול מקורות (web-only).

### גל E — הגדרות, דשבורד, השלמות
- [ ] `settings` מורחב: העדפות התראות פר-טריגר (`settings/notifications` המקבילה), workspaces CRUD, סוגי פגישות CRUD, timezone. השאר נשאר web-only.
- [ ] דשבורד: רצועת אירועי היום, ווידג'ט קונפליקטים, toggle-done inline, לחיצה על פריט מנווטת לפריט (לא לטאב).
- [ ] משימות: חיפוש טקסט, סינון פרויקט/פגישה, מחיקה, שדה תיאור וקישור פרויקט/פגישה ב-`task/[id]`.
- [ ] רשימת קריאה: chips של סינון סטטוס.
- [ ] כל route חדש נוסף ל-`MobileNotificationRoute`; פוש עם URL פיננסי/פרויקט/פגישה נוחת במסך הנכון.

### רוחבי
- [ ] מבנה טאבים חדש: דשבורד, פגישות, משימות, צ'אט, **עוד** — טאב "עוד" (grid) מחליף את טאב people (שימוש נמוך, הוחלט 2026-08-11). people הופך למסך Stack שנגיש מ"עוד"; אזורים חדשים נגישים מ"עוד", מהדשבורד ומההדר.
- [ ] כל המסכים RTL מלא, dark navy theme קיים, `layout` tokens של Fold-7.
- [ ] Playwright לא רלוונטי למובייל — בדיקות ידניות לפי checklist ב-report + Vitest לכל עטיפה חדשה ב-`data.ts` אם תתווסף לוגיקה.

## Data Model

**אין שינויי סכימה.** כל הנתונים קיימים. (אם גל C ידרוש שדה חסר — יטופל בספק נפרד.)

## tRPC API

**אין procedures חדשים.** שימוש קיים בלבד דרך Bearer: `meetings.*` (כולל `syncFromCalendar`, `updateSeriesNotes`), `people.listPaginated`/`reviewQueue`, `projects.*`, `finance.getSummary`/`listTransactions`/`setTransactionCategory`/`getTradingJournal`/`getSymbolRanking`/`analytics.*`/`getAccountsSnapshot`, `vat.periodSummary`/`annualSummary`/`parseInvoice`, `memory/hugoInstructions` routers, feeds, `settings.*`, workspaces. עטיפות חדשות ב-`apps/mobile/lib/data.ts` פר-דומיין (typed ידנית, בלי לייבא AppRouter — כמו היום).

## UI Surface

כל הקבצים תחת `apps/mobile/`:
- `components/*` — השכבה המשותפת (prerequisite).
- `(tabs)/more.tsx` — טאב "עוד" חדש (grid) שמחליף את `(tabs)/people.tsx` ב-`(tabs)/_layout.tsx`.
- `app/meeting/[id].tsx`, `app/person/[id].tsx`, `app/project/[id].tsx` — formSheet.
- `app/people.tsx` (עובר מ-tabs ל-Stack), `app/calendar.tsx`, `app/projects.tsx`, `app/finance.tsx`, `app/memory.tsx`, `app/updates.tsx` — Stack screens רשומים ב-`app/_layout.tsx`.
- הרחבות: `(tabs)/index.tsx`, `(tabs)/meetings.tsx`, `(tabs)/tasks.tsx`, `(tabs)/chat.tsx`, `app/task/[id].tsx`, `app/settings.tsx`, `app/reading-list.tsx`.
- `lib/api.ts` — `MobileNotificationRoute` + deep-link map; `lib/data.ts` — עטיפות.
- הערת תהליך: לבדוק גרסאות Expo מול docs.expo.dev לפני כתיבה (אזהרת `apps/mobile/AGENTS.md`).

## Out of Scope (נשאר web-only, בכוונה)

| יכולת | סיבה |
|---|---|
| חיבור בנקים + הזנת credentials + OTP | רגיש-אבטחה, stateful מול scraper בשרת; במובייל — snapshot לקריאה בלבד |
| ייבוא CSV/XLS/PDF וייבוא תיקיית חשבוניות (bulk) | תלוי מערכת קבצים בשרת/desktop; החלופה המובייל: צילום חשבונית בודדת |
| עורך מסמכי מכירה (lines, תשלומים, הדפסה) | עריכה מרובת-עמודות; מובייל יקבל לכל היותר רשימה לקריאה (לא בגרסה זו) |
| `/agents/manage` — עריכת **הנחיות/workflow** (markdown של `A_Agents/` ו-`S_Skills/`) | כתיבת פרומפטים ארוכה לא מתאימה לטלפון. **עודכן 2026-08-11:** ההגדרות התפעוליות (תזמון/אירועים/הודעת טריגר/שם תצוגה/הרץ עכשיו) **כן** עוברות למובייל — `mobile-agent-picker-and-config` |
| קונסולת WhatsApp (labels, discovery, stats) | אדמין בתדירות נמוכה |
| Notion statuses, pricing, companies, business profile | קונפיגורציה נדירה, עלות/תועלת גרועה |
| גריד יומן שבוע/חודש מלא | 17 קומפוננטות סביב desktop grid; אג'נדה עדיפה בטלפון |
| Bulk actions + CSV export באנשים | אידיומות desktop (multi-select table, blob download) |

## Decisions (Open Questions — resolved 2026-08-11)

1. **ניווט** — טאב "עוד" מחליף את טאב people (שימוש נמוך מהטלפון); people הופך למסך Stack נגיש מ"עוד".
2. **גרפים** — bars פשוטים, בלי dependency.
3. **צילום חשבונית** — אושר, כולל permission ובנייה מחדש של Helm APK.
4. **פיצול** — כל גל מקבל slug-בן משלו לביצוע ול-reports; ספק זה הוא ספק-העל (umbrella):

| Slug בן | היקף |
|---|---|
| `mobile-parity-foundation` | prerequisite: `apps/mobile/components/`, טאב "עוד", העברת people ל-Stack, הרחבת `MobileNotificationRoute` |
| `mobile-parity-meetings-calendar` | גל A |
| `mobile-parity-people-projects` | גל B |
| `mobile-parity-finance` | גל C |
| `mobile-agent-picker-and-config` | גל D — סוכנים (ספק כתוב) |
| `mobile-parity-memory-updates` | גל D — זיכרון + עדכונים |
| `mobile-parity-settings-dashboard` | גל E |

`mobile-parity-foundation` חוסם את כל השאר; גלים A–E מקבילים ביניהם. כל slug-בן מקבל report משלו ב-`reports/`.
