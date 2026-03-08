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
   - **Branch / Source:** ב-**Settings → Source** וודא ש-**Branch** הוא `main` (או ה-branch שאתה דוחף אליו). אם Railway מפריס כל פעם את אותו commit ישן, תקן את ה-Branch ל-`main` ואז **Deploy → Redeploy** או **Deploy latest commit** (ב-Railway: CMD+K → "Deploy latest commit" או כפתור Redeploy).
   - הפקודות מוגדרות ב-`railway.toml` ברפו. אם אתה מעדיף להגדיר ידנית:
   - **Build Command:**  
     `pnpm install --frozen-lockfile && pnpm run build`
   - **Start Command:**  
     `pnpm --filter @ak-system/web start`  
     (לא `cd apps/web && pnpm start` – ב-Railway זה עלול לגרום ל-"The executable cd could not be found".)
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
   - `NEXTAUTH_URL=https://<שם-הפרויקט>.up.railway.app` (אותו ערך כמו NEXT_PUBLIC_APP_URL)
   - `NEXTAUTH_SECRET=<מחרוזת-אקראית>` — **חובה ב-production**. ליצירה: `openssl rand -base64 32` או `npx auth secret`
   - `DATABASE_PATH=/data/ak_system.sqlite`
   השאר את ה-VAPID keys אם Push Notifications מופעלים:  
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.

5. **Deploy**
   אחרי שמירה Railway יריץ build ו-start. לאחר ההצלחה האפליקציה זמינה ב-URL שהוגדר.

6. **איך לוודא ש-Railway בנה מה-commit האחרון**
   - בדף ה-Deployment ב-Railway אמור להופיע ה-commit message של ה-build (למשל "fix: Railway start without shell..."). אם אתה רואה commit ישן:
   - **Settings → Source** → וודא ש-**Branch** = `main` (או ה-branch שלך).
   - **Deployments** → **Redeploy** (או CMD+K → "Deploy latest commit") כדי להריץ build מה-commit האחרון ב-main.
   - אם עדיין אותו commit: נסה **Clear build cache** (אם קיים) ואז Redeploy.

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
