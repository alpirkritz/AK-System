# משימה חדשה לא נוצרת ב-Notion — אבחון ותיקון

מדריך תפעולי למצב שבו יוצרים משימה מהאפליקציה (web או ARO), המשימה נשמרת, אבל שום דף לא נוצר ב-Notion.

הלוגיקה עצמה מתועדת ב-[`docs/specs/notion-task-create-push.md`](specs/notion-task-create-push.md). המדריך הזה עוסק בקונפיגורציה שהלוגיקה תלויה בה.

## התנאי היחיד שקובע

משימה נוצרת ב-Notion רק אם **שני** התנאים מתקיימים:

1. נבחר "מקור" (workspace) למשימה.
2. לאותו מקור יש **קישור מפורש** לבסיס נתונים ב-Notion — שורה בטבלת `workspace_notion_databases`.

אם אחד מהם חסר, המשימה נשמרת כמשימה מקומית רגילה (`source: 'manual'`, בלי `notionPageId`) ולא נוצר כלום ב-Notion. זו התנהגות מתוכננת, לא כשל — ראה `resolveWorkspaceNotionTarget` ב-[`packages/api/src/services/notion-tasks-sync.ts`](../packages/api/src/services/notion-tasks-sync.ts).

## המלכודת: "תווית Notion" היא לא קישור

זו הסיבה הנפוצה לבלבול. בעמוד **הגדרות ← מקורות** כל מקור מציג שורת מצב, ויש שני מצבים שנראים דומים אבל מתנהגים הפוך:

| מה מוצג | המשמעות | משימה חדשה תיווצר ב-Notion? |
|---|---|---|
| `🔗 N מקושרים` | יש קישור מפורש לבסיס נתונים | כן |
| `Notion: DT - Action items` | רק **תווית גיבוי** (`notionAccountLabel`) | **לא** |
| `אין קישור Notion` | אין כלום | לא |

השורה `Notion: <שם>` נראית כמו קישור פעיל, אבל `notionAccountLabel` משמש **רק לכיוון הנכנס** — לשייך משימות שנשאבות מ-Notion אל המקור הנכון בסנכרון. הוא לא משתתף כלל ביצירת משימות **אל** Notion.

הכלל המעשי: אם לא רואים `🔗` — משימות חדשות לא יגיעו ל-Notion.

## התיקון (דרך הממשק)

לכל מקור שאמור לדחוף משימות ל-Notion:

1. היכנס ל-**הגדרות ← מקורות** (`/settings/workspaces`).
2. לחץ על אייקון העיפרון של המקור.
3. בקטע **"בסיסי נתונים מקושרים ב-Notion"** — סמן את ה-checkbox של בסיס הנתונים הרצוי.
4. הקישור נשמר מיד עם הסימון (אין צורך ב"שמור"). סגור את החלון.
5. אמת: שורת המצב של המקור בעמוד המקורות צריכה להשתנות ל-`🔗 1 מקושרים`.

השיוך הנכון בין מקור לבסיס נתונים:

| מקור | בסיס נתונים ב-Notion |
|---|---|
| פרטי | Personal To-do |
| Dragontail | DT - Action items |
| Alpir Consulting | Con Action items |
| DAZ | DAZ Tasks |

### אימות מקצה לקצה

צור משימה חדשה ובחר את המקור. **לפני** השמירה צריכה להופיע שורת רמז תכלת:

> המשימה תיווצר גם ב-Notion (Dragontail)

הרמז הזה הוא האינדיקטור האמין — הוא נגזר מאותו שדה `notionDatabases` שה-backend מסתמך עליו. אם הוא לא מופיע, הקישור לא נשמר. הוא קיים גם ב-web ([`TaskModal.tsx`](../apps/web/src/components/Modals/TaskModal.tsx)) וגם במובייל ([`task/[id].tsx`](../apps/mobile/app/task/%5Bid%5D.tsx)).

## הערות חשובות

- **קישור הוא לכל מסד נתונים בנפרד.** קישור שנוצר בסביבה המקומית לא קיים בפרודקשן ולהיפך — הטבלה יושבת ב-SQLite של אותה סביבה. זה היה שורש הבעיה באבחון של 09/08/2026: מקומית כל ארבעת המקורות היו מקושרים, בפרודקשן רק DAZ.
- **בסיס נתונים אחד יכול להיות מקושר למקור אחד בלבד.** יש `uniqueIndex` על `notion_database_id`. אם ה-checkbox מופיע מעומעם עם "מקושר ל-<שם>", בטל אותו שם קודם.
- **מקור עם כמה קישורים** — הראשון לפי סדר היצירה הוא זה שיקבל משימות חדשות.
- **מה נדחף ל-Notion:** כותרת, סטטוס התחלתי (מותאם לאפשרויות של בסיס הנתונים) ותאריך יעד. עדיפות ואחראי **לא** נדחפים — מחוץ לתחום לפי הספק.
- **כשל בדחיפה לא מאבד את המשימה.** היא נשמרת מקומית, ומוצגת ההודעה "המשימה נשמרה, אבל לא נוצרה ב-Notion".

## אבחון מהיר

### 1. האם Notion מוגדר בכלל

```bash
# בקונטיינר בפרודקשן — מציג את בסיסי הנתונים מסוג tasks
docker exec deploy-web-1 node -e 'const d=JSON.parse(process.env.NOTION_ACCOUNTS);for(const a of d)for(const x of a.databases||[])console.log(x.type,x.name,x.id)'
```

אם `NOTION_ACCOUNTS` חסר או ריק — הבעיה בסביבה, לא בקישורים. ה-checklist בממשק יופיע ריק עם ההודעה "לא נמצאו בסיסי נתונים ב-Notion".

### 2. אילו מקורות מקושרים

```bash
sqlite3 "$DATABASE_PATH" -header -column "
  SELECT w.name,
         w.notion_account_label AS label_backup_only,
         COALESCE(wnd.notion_database_name, '(NOT LINKED)') AS linked_db
  FROM workspaces w
  LEFT JOIN workspace_notion_databases wnd ON w.id = wnd.workspace_id
  ORDER BY w.name;"
```

כל מקור עם `(NOT LINKED)` לא ידחוף משימות ל-Notion, גם אם `label_backup_only` מאוכלס.

בפרודקשן (EC2) המסד יושב ב-volume של Docker:

```bash
sudo sqlite3 /var/lib/docker/volumes/deploy_web-data/_data/ak_system.sqlite -header -column "<אותה שאילתה>"
```

### 3. אילו משימות באמת הגיעו ל-Notion

```bash
sqlite3 "$DATABASE_PATH" -header -column "
  SELECT substr(created_at,1,16) AS created, substr(title,1,40) AS title,
         COALESCE(workspace_id,'(none)') AS ws, source,
         COALESCE(notion_page_id,'-') AS page
  FROM tasks WHERE created_at >= date('now','-14 day')
  ORDER BY created_at DESC LIMIT 25;"
```

איך לקרוא את הפלט: `source='notion'` עם `notion_page_id` = מסונכרן. `source='manual'` עם מקור מאוכלס = בדיוק התסמין הזה — המקור לא מקושר.
