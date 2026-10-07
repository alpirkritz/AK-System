# Review — notification-sync-and-archive

**Verdict: APPROVED**

Spec: `docs/specs/notification-sync-and-archive.md`

## What was wrong

ארבעה שורשים, כולם אומתו בפרודקשן על EC2 לפני שנכתבה שורת קוד. הנתון שכיוון את החקירה: 5978 התראות, 5976 מהן בארכיון — כלומר הכתיבה למסד **הייתה** תקינה כל הזמן, והבעיה כולה בשכבת ההצגה.

1. **כפתור "ארכיון" על התראת ווב נכשל בשקט.** ה-service worker שלח POST ל-`/api/trpc/notifications.archive` עם `{id}` גולמי, בלי מעטפת ה-superjson שה-tRPC דורש. שחזור על EC2 החזיר `400 BAD_REQUEST` (`invalid_type, expected object, received undefined`). ה-`.catch` תופס רק שגיאות רשת, ולכן גם ה-fallback שנועד לפתוח את דף ההתראות לא רץ — הלחיצה פשוט לא עשתה כלום.
2. **`tag: 'ak-push'` משותף לכל ההתראות** עם `renotify: true` — כל דחיפה החליפה את קודמתה במגש.
3. **אין פיוס בין מצב השרת למגש** — ארכוב לא סגר התראה שכבר הוצגה.
4. **דף ההתראות בווב לא התרענן** — `useQuery` בלי `refetchInterval`, ולכן פעולה מהטלפון לא השתקפה עד רענון ידני.

## Changes

| קובץ | שינוי |
|---|---|
| `apps/web/src/lib/notification-tray.ts` | חדש — `notificationTag` ו-`staleTrayNotificationIds`, ההיגיון הטהור שגם ה-SW וגם הדף צורכים |
| `apps/web/src/sw.ts` | tag ייחודי, `renotify: false`, ארכוב דרך `PATCH /api/notifications` עם בדיקת `res.ok`, מאזין `CLOSE_NOTIFICATIONS` |
| `apps/web/src/app/notifications/page.tsx` | `refetchInterval: 30s` + `refetchOnWindowFocus`, `reconcileTray` מחובר ל-archive/markRead/markAll/archiveAll ולחזרת פוקוס |
| `apps/mobile/lib/notifications.ts` | `dismissTrayNotifications` — התאמה לפי `data.notificationId` מול `getPresentedNotificationsAsync` |
| `apps/mobile/app/(tabs)/notifications.tsx` | סגירת מגש בכל ארבע פעולות הארכוב והקריאה |
| `apps/web/src/lib/notification-tray.test.ts` | חדש — 9 בדיקות |

ה-API של Expo אומת מול `docs.expo.dev/versions/v56.0.0/sdk/notifications` כנדרש ב-`apps/mobile/AGENTS.md`: `getPresentedNotificationsAsync`, `dismissNotificationAsync` ו-`dismissAllNotificationsAsync` קיימים ונתמכים ב-Android וב-iOS.

## Design note

`staleTrayNotificationIds` שומר חלון חסד של 60 שניות. בלעדיו, דחיפה שמגיעה בין שתי דגימות של הרשימה הייתה נסגרת לפני שהמשתמש רואה אותה — המימוש הראשון שלי אכן סבל מזה. הבדיקות מכסות את הגבול משני צדדיו.

## Verification

- `pnpm test` — 38 קבצים, 292 בדיקות, הכל עובר.
- `pnpm -r run lint` — עובר; האזהרות שנותרו קדמו לשינוי ואינן בקבצים שנגעתי בהם.
- `pnpm --filter @ak-system/web build` — עובר.
- `sw.js` המקומפל נבדק: מכיל `ak-push-`, `renotify:!1`, `CLOSE_NOTIFICATIONS`, ואפס מופעים של `trpc/notifications.archive`.
- **פרודקשן על EC2 אחרי דיפלוי:** אותו חוזה שהחזיר 400 לפני התיקון מחזיר עכשיו `200 {"archived":true,"updated":1}`. ה-`sw.js` שמוגש מהשרת מכיל את התיקונים.

## Outstanding

- Playwright e2e לזרימת ההתראות לא נוספה. הפיוס תלוי ב-`ServiceWorkerRegistration.getNotifications` ובהרשאת התראות, שלא ניתנות לסימולציה אמינה ב-e2e הקיים. ההיגיון ההחלטתי מכוסה ביחידה, והחוזה אומת ישירות בפרודקשן.
- האפליקציה צריכה build חדש כדי לקבל את `dismissTrayNotifications` — התיקון בווב פעיל מיד, זה שבמובייל ימתין ל-APK הבא.
