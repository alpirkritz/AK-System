# פריסה והתקנה – AK System (My Space)

מדריך לפריסת האפליקציה ל-production ולהתקנתה כפי PWA בטלפון.

---

## דרישות

- **Node.js** 18 ומעלה  
- **pnpm** 8 ומעלה  
- משתני סביבה: העתק מ-`.env.example` ל-`apps/web/.env.local` ומלא ערכים.  
  **חשוב ב-production:** `NEXT_PUBLIC_APP_URL` חייב להיות כתובת ה-production ב-**HTTPS** (למשל `https://your-app.up.railway.app`). משמש ל-OAuth ול-tRPC.

---

## פריסה ל-Railway (מומלץ)

Railway תומך ב-volume לאחסון SQLite ומתאים ל-monorepo.

1. **חיבור רפו**
   - היכנס ל-[railway.app](https://railway.app) וחבר את חשבון GitHub.
   - New Project → Deploy from GitHub repo → בחר את הרפו של AK System.

2. **הגדרות Build (חשוב)**
   - **Root Directory:** **חייב להישאר ריק** (שורש הפרויקט). אם מוגדר `apps/web` – ה-build לא רואה את `pnpm-lock.yaml` ויכול להיכשל על גרסאות ישנות.
   - הפקודות מוגדרות ב-`railway.toml` ברפו. אם אתה מעדיף להגדיר ידנית:
   - **Build Command:**  
     `pnpm install --frozen-lockfile && pnpm run build`
   - **Start Command:**  
     `cd apps/web && pnpm start`
   - אם הבילד עדיין נכשל על "security vulnerabilities" (next ישן): הוסף משתנה **`NO_CACHE=1`** ב-Variables, שמור, הרץ Redeploy (כדי לנקות cache), ואז אפשר להסיר את `NO_CACHE=1`.

3. **Volume למסד הנתונים**
   - Settings → Volumes → Add Volume.
   - Mount path: `/data`
   - במשתני הסביבה הגדר:  
     `DATABASE_PATH=/data/ak_system.sqlite`  
   כך ה-SQLite יישמר בין deployments.

4. **משתני סביבה**
   העתק את כל הערכים מ-`apps/web/.env.local` (אל תעלה את הקובץ ל-Git). חובה לעדכן:
   - `NEXT_PUBLIC_APP_URL=https://<שם-הפרויקט>.up.railway.app`  
     (או הדומיין שמוגדר ב-Railway)
   - `DATABASE_PATH=/data/ak_system.sqlite`
   השאר את ה-VAPID keys אם Push Notifications מופעלים:  
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.

5. **Deploy**
   אחרי שמירה Railway יריץ build ו-start. לאחר ההצלחה האפליקציה זמינה ב-URL שהוגדר.

---

## פריסה ל-Render

1. **חיבור רפו**
   - [render.com](https://render.com) → New → Web Service.
   - חבר את רפו ה-GitHub של AK System.

2. **הגדרות שירות**
   - **Build Command:**  
     `pnpm install && pnpm --filter @ak-system/web build`
   - **Start Command:**  
     `cd apps/web && pnpm start`
   - **Root Directory:** (ריק = שורש הפרויקט)

3. **Persistent Disk**
   - Storage → Add Disk.
   - Mount path: `/data`
   - במשתני הסביבה:  
     `DATABASE_PATH=/data/ak_system.sqlite`

4. **משתני סביבה**
   כמו ב-Railway: כל הערכים מ-`apps/web/.env.local`, עם  
   `NEXT_PUBLIC_APP_URL` לכתובת ה-Render (HTTPS) ו-`DATABASE_PATH` above.

---

## הרצה עם Docker (VPS / שרת פרטי)

אפשר להריץ את האפליקציה כ-container עם volume ל-SQLite.

**Build והרצה:**

```bash
# מהשורש של הפרויקט
docker build -t ak-system .
docker run -p 3000:3000 \
  -v "$(pwd)/data:/data" \
  -e DATABASE_PATH=/data/ak_system.sqlite \
  -e NEXT_PUBLIC_APP_URL=https://your-domain.com \
  --env-file apps/web/.env.local \
  ak-system
```

העבר את שאר משתני הסביבה (Supabase, Google, VAPID וכו') דרך `--env-file` או `-e`. כך המסד יישמר בתיקייה `./data` על המארח.

---

## התקנה בטלפון (PWA)

אחרי שהאפליקציה פרוסה וזמינה ב-HTTPS:

1. **בטלפון** (Samsung Fold / כל אנדרואיד): פתח בדפדפן **Chrome** או **Samsung Internet** את כתובת ה-production (למשל `https://your-app.up.railway.app`).

2. **התקנת האפליקציה**
   - **Chrome:** תפריט (⋮) → "הוסף למסך הבית" / "Add to Home screen"  
   - **Samsung Internet:** תפריט → "הוסף דף ל" → "מסך הבית"

3. **סיום**
   האייקון "My Space" יופיע במסך הבית. לחיצה תפתח את האפליקציה במצב standalone (ללא שורת כתובת), כמו אפליקציה native.

**הערה:** Push Notifications יעבדו רק כשהאתר נגיש ב-HTTPS (כולל בפריסה זו).
