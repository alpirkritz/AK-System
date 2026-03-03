# AK System – My Space

אפליקציית סביבת עבודה אישית בסגנון Notion: דשבורד, פרויקטים, פגישות, אנשים, משימות ופגישות חוזרות.

## סטק

- **Frontend:** Next.js 14, React, TypeScript, Tailwind, tRPC, React Query
- **API:** tRPC (חבילת `@ak-system/api`)
- **DB:** SQLite + Drizzle ORM (`@ak-system/database`)

## הרצה

```bash
pnpm install

# חשוב: ליצור/לעדכן את המסד (פעם ראשונה ואחרי שינוי סכמה)
pnpm db:push

pnpm dev        # http://localhost:3000
```

**איפה ה-DB:** הקובץ נוצר ב־`apps/web/data/ak_system.sqlite`.  
האפליקציה קוראת את הנתיב מ־`apps/web/.env.local` (`DATABASE_PATH=./data/ak_system.sqlite`).  
אם לא הרצת `pnpm db:push` – המסד יהיה ריק או בלי טבלאות ותקבל שגיאות כמו "Unexpected end of JSON input" או "table not found".

## בדיקה שה-DB קיים ומוכן

```bash
# מהשורש של הפרויקט
ls -la apps/web/data/ak_system.sqlite   # הקובץ קיים?
pnpm db:push                            # מעדכן טבלאות לפי הסכמה
```

## בדיקות (QA)

```bash
pnpm test         # בדיקות יחידה/אינטגרציה (API)
pnpm test:api     # בדיקות API בלבד
pnpm e2e          # בדיקות E2E (Playwright) – זרימה מלאה: אנשים, פרויקטים, פגישות, משימות
```

- **Unit/API:** Vitest ב־`packages/api`. **E2E:** Playwright ב־`apps/web/e2e` (מריץ אפליקציה עם DB ייעודי על פורט 3001).

## מבנה

- `apps/web` – אפליקציית Next.js (דשבורד, פרויקטים, פגישות, אנשים, משימות, חוזרות)
- `packages/api` – tRPC routers (people, projects, meetings, tasks)
- `packages/database` – Drizzle schema ו־getDb
- `packages/types` – קבועים (PRIORITY_COLORS, DAYS_HE וכו')

## דפים

- `/` – דשבורד
- `/projects` – פרויקטים
- `/meetings` – פגישות
- `/meetings/[id]` – פרט פגישה
- `/people` – אנשי קשר
- `/tasks` – משימות
- `/recurring` – פגישות חוזרות
