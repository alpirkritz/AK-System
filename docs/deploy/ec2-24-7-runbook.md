# Runbook: מעבר מלא ל-EC2 24/7 (נוטיפיקציות + סוכנים)

> 2026-08-03. מטרה: אפס תלות במק. כל שלב = פקודה מדויקת. סדר חשוב.
> רקע: הטלפון (Helm APK) אפוי עם `https://retype-engross-strike.ngrok-free.dev`. כרגע הטוקנים נרשמו ל-DB **המקומי במק** — כלומר הדומיין הצביע על המק. אחרי הראנבוק הזה הדומיין יצביע על EC2, וה-cron של EC2 יריץ את הסוכנים.

## שלב 0 — אימות מקומי (חובה, פעם אחת)

```bash
pnpm db:push
pnpm test
pnpm --filter @ak-system/web test
pnpm -r run lint
pnpm --filter @ak-system/web build
```

הכל ירוק? ממשיכים. משהו אדום? לתקן לפני deploy (השינויים החדשים ב-`reports/agent-precision-and-push-reliability.md`).

## שלב 1 — Firebase Admin credentials (שליחה ישירה ל-FCM)

השרת שולח ישירות דרך Firebase Admin (לא דרך Expo Push). ב-`deploy/production.env`:

```bash
FIREBASE_PROJECT_ID=helm-push-969711
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-…@helm-push-969711.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
```

את המפתח מייצרים ב-Firebase Console → Project settings → Service accounts → Generate new private key
(**חייב להיות בפרויקט helm-push-969711**, אותו פרויקט כמו `apps/mobile/google-services.json`).

ה-APK עדיין צריך `google-services.json` בבילד כדי לקבל FCM device token.

## שלב 2 — ngrok עובר ל-EC2 (ואסור שירוץ במקביל במק)

הדומיין הסטטי יכול לשרת רק agent אחד. במק: לוודא ש-`scripts/serve.sh` / ngrok **כבויים** לפני שמרימים ב-EC2.

ב-EC2 (SSH):

```bash
# אם עדיין לא מותקן כ-systemd (ראה docs/deploy/ec2-production.md):
sudo systemctl status ngrok       # אמור להצביע על http://localhost:3000
sudo systemctl enable --now ngrok
curl -s https://retype-engross-strike.ngrok-free.dev/api/health || echo "בדוק tunnel"
```

## שלב 3 — Deploy הקוד החדש ל-EC2 (מהמק)

```bash
pnpm run ci:local
pnpm deploy:ec2
```

## שלב 4 — Cron על EC2 (זה מה שמפעיל את כל הסוכנים המתוזמנים)

ב-EC2:

```bash
cd ~/ak-system   # או נתיב הפריסה בפועל
bash scripts/install-server-cron.sh     # קורא CRON_SECRET + APP_URL מ-deploy/production.env
crontab -l | head                        # לוודא שהשורות נכנסו
# בדיקת חיים מיידית:
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/morning-briefing
```

## שלב 5 — רישום הטלפון מחדש מול EC2

עכשיו שהדומיין מצביע על EC2, ה-DB של EC2 ריק מטוקנים:

1. פתח את אפליקציית Helm בטלפון
2. הגדרות → כבה והדלק נוטיפיקציות (או התנתק/התחבר) — זה שולח `POST /api/push/expo/register` ל-EC2
3. הגדרות → "שלח בדיקה"

## שלב 6 — אימות מסירה אמיתי

- מיידי: באנר בטלפון מהבדיקה בשלב 5? מעולה.
- אין באנר? חכה 16 דקות ואז: **הגדרות ▸ נוטיפיקציות ▸ יומן מסירת פוש** בממשק — שגיאת ה-receipt המדויקת תופיע שם (חדש). `InvalidCredentials` = חזור לשלב 1.
- חלופה מהמק (עם הטוקן מה-DB של EC2): `node scripts/push-doctor.mjs --token "ExponentPushToken[...]"`

## שלב 7 — ניתוב הסוכנים (בממשק, פעם אחת)

הטבלאות `notification_preferences` ו-`agent_triggers` ריקות — בלי זה אין סוכנים מתוזמנים:

1. **הגדרות ▸ נוטיפיקציות**: תדריך בוקר → סוכן `03_morning_briefing`, שעה 07:00; הכנה לפגישה → `04_meeting_prep_herald`
2. **מסך הסוכנים**: תזמן את `07_email_assistant` (למשל 08:30) עם הוראות טריאז' משלך
3. הוראות קבועות אישיות: עמוד **/memory** (עכשיו נכנסות עד 12,000 תווים והן גוברות על ברירות המחדל)

## שלב 8 — כיבוי התלות במק

- לא מריצים יותר `serve.sh` לפרודקשן (רק לפיתוח, ועם `SKIP_TUNNEL=1` כדי לא להתנגש בדומיין)
- ה-Outlook bridge (launchd) נשאר במק — הוא לא קשור לנוטיפיקציות

## תקלות נפוצות

| סימפטום | סיבה | תיקון |
|---|---|---|
| "שלח בדיקה" עובד אבל אין באנר | Firebase Admin חסר/שגוי או APK בלי google-services | שלב 1; השגיאה תופיע ביומן המסירה מיד |
| שום נוטיפיקציה מתוזמנת | cron לא מותקן / DB בלי routing | שלבים 4 + 7 |
| הטלפון לא נרשם | tunnel לא חי / מצביע על המק | שלב 2 |
| APK ישן (לפני 30.7) | אין google-services.json בבילד | `pnpm mobile:build:apk` והתקנה מחדש |
