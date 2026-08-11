# Mobile Parity Foundation — שכבת קומפוננטות משותפת וטאב "עוד"

> **Slug:** `mobile-parity-foundation`
> **Parent spec:** [`mobile-web-parity.md`](./mobile-web-parity.md) (umbrella)
> **Status:** Ready for implementation
> **Last Updated:** 2026-08-11

## Goal

לממש את ה-prerequisite המשותף של ספק-העל `mobile-web-parity`: שכבת קומפוננטות משותפת ב-`apps/mobile/components/` שכל הגלים A–E יבנו עליה, ומבנה ניווט חדש — טאב "עוד" (grid) שמחליף את טאב "אנשים", כאשר `people` הופך למסך Stack. הגל הזה חוסם את כל שאר הגלים, ולכן הוא מכוון ל-**שינוי מבני בלי שינוי התנהגות**: אותם מסכים, אותו מידע, אותו עיצוב — רק בלי כפילויות ועם נקודת הרחבה אחת לכל אזור חדש שיגיע בגלים הבאים.

הקומפוננטות עצמן כבר נכתבו (untracked ב-`apps/mobile/components/`) אבל **אף אחת מהן לא מיובאת בשום מסך**. הגל הזה מחבר אותן בפועל.

## User Stories

- כמפתח שמממש גל A–E, אני רוצה קומפוננטות משותפות (`Card`, `EmptyState`, `FilterChips`, `FormSheetScaffold`, `KpiCard`, `RtlRow`, `RtlText`, `SectionHeader`, `StatusPill`) שכבר בשימוש במסך אמיתי אחד לפחות, כדי לדעת שהן עובדות ולא להמציא סגנון מחדש.
- כמשתמש, אני רוצה טאב "עוד" שמרכז את האזורים שלא מקבלים טאב משלהם (אנשים, הגדרות, רשימת קריאה, התראות), כדי שהטאבים הראשיים יישארו למה שאני באמת פותח כל יום.
- כמשתמש, אני רוצה שפוש שמפנה ל-`/people` ימשיך לנחות במסך אנשים גם אחרי שהוא הפסיק להיות טאב.

## Acceptance Criteria

- [ ] `(tabs)/tasks.tsx` לא מגדיר יותר `StatusPill` מקומי — מייבא מ-`components/StatusPill`; המראה בשורת המשימה זהה.
- [ ] `(tabs)/index.tsx` (דשבורד) משתמש ב-`KpiCard` לשלושת ה-KPIs, ב-`SectionHeader` לכותרות הסקשנים, ב-`Card` לפריטי הרשימה וב-`EmptyState` למצבים הריקים — עם אותו טקסט עברי בדיוק.
- [ ] `(tabs)/people.tsx` משתמש ב-`EmptyState` ו-`Card`.
- [ ] `(tabs)/meetings.tsx` משתמש ב-`Card`, `EmptyState` ו-`FilterChips` (החלפה 1:1 של ה-chips הקיימים "הכל"/"↻ חוזרות").
- [ ] קיים `app/(tabs)/more.tsx` — grid דו-טורי מבוסס `Card` עם כניסות: אנשים, רשימת קריאה, התראות, הגדרות. כל כניסה מנווטת למסך הנכון. המבנה הוא מערך כניסות שגלים B–E יוסיפו אליו שורה אחת כל אחד. אין כותרת בתוך המסך — כותרת הטאב ("עוד") כבר מספקת אותה.
- [ ] `(tabs)/_layout.tsx` מציג 5 טאבים: דשבורד, פגישות, משימות, **עוד**, עוזר. אין יותר טאב "אנשים".
- [ ] `people` עבר מ-`app/(tabs)/people.tsx` ל-`app/people.tsx` ורשום ב-Stack של `app/_layout.tsx` עם `title: 'אנשים'`; ה-route נשאר `/people`.
- [ ] כל קריאות `router.push('/people')` הקיימות (KPI בדשבורד, ניווט מהתראה) ממשיכות לעבוד ללא שינוי.
- [ ] `MobileNotificationRoute` ב-`lib/api.ts` מתועד כנקודת ההרחבה שכל גל חייב לעדכן כשהוא מוסיף מסך חדש.
- [ ] `pnpm --filter @ak-system/mobile lint` (`tsc --noEmit`) עובר.

## Data Model

**אין שינויי סכימה.** לא נוגעים ב-`packages/database/src/schema.ts` ולא ב-`schema.pg.ts`.

## tRPC API

**אין procedures חדשים ואין שינוי ב-`apps/mobile/lib/data.ts`.** הגל הזה הוא UI וניווט בלבד; כל הנתונים מגיעים מהעטיפות הקיימות (`fetchTasks`, `fetchMeetings`, `fetchPeople`, `fetchWorkspaces`).

## UI Surface

כל הקבצים תחת `apps/mobile/`:

| קובץ | שינוי |
|---|---|
| `components/*` | קיימות כבר; אין קומפוננטה חדשה בגל הזה |
| `app/(tabs)/_layout.tsx` | הסרת `Tabs.Screen name="people"`, הוספת `Tabs.Screen name="more"` באותו מיקום |
| `app/(tabs)/more.tsx` | **חדש** — grid דו-טורי מבוסס `Card` |
| `app/(tabs)/people.tsx` → `app/people.tsx` | העברה ל-Stack; אותה לוגיקה, `EmptyState`+`Card` |
| `app/_layout.tsx` | רישום `Stack.Screen name="people"` עם `title: 'אנשים'` |
| `app/(tabs)/index.tsx` | `KpiCard`, `SectionHeader`, `Card`, `EmptyState` |
| `app/(tabs)/tasks.tsx` | הסרת `StatusPill` המקומי + `EmptyState` |
| `app/(tabs)/meetings.tsx` | `Card`, `EmptyState`, `FilterChips` |
| `lib/api.ts` | הערת חוזה מעל `MobileNotificationRoute` (בלי שינוי התנהגות) |

טאב "עוד" — כל כניסה: אימוג'י גדול, תווית עברית, טאץ' יעד ≥44pt, RTL, `Card` על רקע ה-navy הקיים. אין תת-מסכים ואין state.

## Out of Scope

- מסכים חדשים כלשהם לגלים A–E (`meeting/[id]`, `person/[id]`, `project/[id]`, `calendar`, `projects`, `finance`, `memory`, `updates`) — כל אחד בספק-הבן שלו.
- שימוש ב-`SimpleBars` (קומפוננטת גל C) וב-`FormSheetScaffold` (ייכנס לשימוש בגלים A/B כשייבנו ה-formSheets).
- רפקטור של `app/task/[id].tsx` ל-`FormSheetScaffold` — הוא עובד, והגל שנוגע במסך הזה הוא גל E.
- הרחבת `MobileNotificationRoute` ליעדים שעדיין לא קיימים (`/finance`, `/calendar`, `/projects`, `/memory`, `/updates`) — כל גל מוסיף את היעד שלו כשהמסך נולד.
- שינוי כפתורי ההדר הקיימים (הגדרות/רשימת קריאה/התראות) — הם נשארים כקיצור דרך במקביל ל"עוד".
- שינוי עיצובי מכוון. כל הפרש חזותי מהמצב הקיים נחשב רגרסיה ומדווח.

## Open Questions

אין. ההחלטות (טאב "עוד" מחליף את people, גרפים כ-bars, צילום חשבונית) נסגרו בספק-העל ב-2026-08-11.
