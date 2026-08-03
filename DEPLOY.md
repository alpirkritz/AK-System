# פריסה והתקנה – AK System (My Space)

מדריך לפריסת האפליקציה ל-production ולהתקנתה כפי PWA בטלפון.

---

## מסלול מומלץ: EC2 + Docker (פייפליין מקומי, ללא Railway / CI חיצוני)

הבדיקות והבילד רצים לוקאלית על ה-Mac (`pnpm run ci:local`), והפריסה היא פקודת SSH אחת
(`pnpm deploy:ec2`) ל-EC2 Free Tier. Cron רץ על השרת עצמו — אין תלות ב-GitHub Actions.

| שלב | מסמך |
|-----|------|
| 1. Backend יציב (EC2 + Docker) | [`docs/deploy/ec2-production.md`](docs/deploy/ec2-production.md) |
| 1a. מנהרה ציבורית קבועה (ngrok על השרת) | ראה "המנהרה הציבורית" למטה |
| 2. Google OAuth | [`docs/deploy/google-oauth-setup.md`](docs/deploy/google-oauth-setup.md) |
| 3. Cron 24/7 (crontab על השרת) | [`docs/deploy/cron-setup.md`](docs/deploy/cron-setup.md) |
| 4. APK לאנדרואיד (Helm) | [`docs/deploy/helm-apk-build.md`](docs/deploy/helm-apk-build.md) |
| 5. WhatsApp 24/7 (אופציונלי) | [`docs/deploy/whatsapp-bridge-vm.md`](docs/deploy/whatsapp-bridge-vm.md) |

תבנית env ל-production: [`deploy/production.env.example`](deploy/production.env.example)

**זרימה מהירה:**

```bash
# חד-פעמי על EC2 (דרך SSH):
bash scripts/ec2-bootstrap.sh

# חד-פעמי על Mac (AWS CLI מחובר):
aws configure   # Access Key + region us-east-1
pnpm ec2:up     # יוצר EC2 + מפריס + tunnel + cron

מדריך מהיר: [`docs/deploy/ec2-quickstart.md`](docs/deploy/ec2-quickstart.md)

# כל פריסה:
pnpm deploy:ec2
```

> **Legacy — Railway:** הפריסה הישנה ל-Railway נשמרת לעיון ב-[`docs/deploy/railway-production.md`](docs/deploy/railway-production.md) (תבנית [`deploy/railway.env.example`](deploy/railway.env.example)). לא מומלצת יותר.

---

## המנהרה הציבורית — רצה על השרת בלבד

הכתובת הציבורית היא דומיין ngrok סטטי, וה-agent שמגיש אותה רץ **על ה-EC2** כ-systemd unit
בשם `ak-ngrok`. המק אינו חלק מהזרימה: אפשר לכבות אותו, והמערכת תמשיך לענות.

```bash
# התקנה / התקנה מחדש (מריצים על השרת)
sudo NGROK_AUTHTOKEN=<token> NGROK_STATIC_DOMAIN=<name>.ngrok-free.dev \
  bash scripts/ec2-install-ngrok-tunnel.sh

# בדיקת מצב
systemctl status ak-ngrok
sudo tail -f /var/log/ak-ngrok.log
```

הסקריפט גם מכבה את `ak-tunnel` (Cloudflare quick tunnel), שהכתובת שלו התחלפה בכל restart
ולכן שברה את ה-APK ואת מנויי ה-Push.

**חשוב:** תוכנית ngrok החינמית מרשה agent פעיל אחד בחשבון. לכן `pnpm tunnel:ngrok` על המק
חסום כברירת מחדל — הרצתו הייתה מסיטה את הכתובת הציבורית למק. לעקיפה מכוונת:
`ALLOW_LOCAL_TUNNEL=1 pnpm tunnel:ngrok`, ורק אחרי `sudo systemctl stop ak-ngrok` על השרת.

---

## דרישות

- **Node.js** 18 ומעלה  
- **pnpm** 8 ומעלה  
- משתני סביבה: העתק מ-`.env.example` ל-`apps/web/.env.local` ומלא ערכים.  
  **חשוב ב-production:** `NEXT_PUBLIC_APP_URL` חייב להיות כתובת ה-production ב-**HTTPS** (למשל `https://your-app.up.railway.app`). משמש ל-OAuth ול-tRPC.

---

## פריסה ל-Railway (legacy)

> מסלול ישן — לא מומלץ יותר. השתמש ב-EC2 ([`docs/deploy/ec2-production.md`](docs/deploy/ec2-production.md)). נשמר לעיון בלבד.

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
     `bash scripts/railway-start.sh`  
     (מריץ `db:push` על ה-volume ואז `next start`)
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
   - `CRON_SECRET` — חובה ב-production (אותו ערך ב-GitHub Actions secrets)
   - `GOOGLE_ANDROID_CLIENT_ID` — ל-Helm native sign-in
   - JWT למובייל משתמש ב-`NEXTAUTH_SECRET` (אין משתנה נפרד)
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

## הרצה מקומית + Cloudflare Tunnel (מומלץ לשימוש אישי בטלפון)

מריצים את כל המערכת על המק (SQLite, גשר WhatsApp, Google Drive נשארים מקומיים) וחושפים רק את האפליקציה ב-HTTPS דרך Cloudflare Tunnel — כדי שה-PWA והנוטיפיקציות יעבדו בטלפון.

**חשוב:** Web Push וה-service worker עובדים **רק בבילד production** (ב-`next dev` ה-SW מנוטרל). לכן מריצים `pnpm serve` (build + start) ולא `pnpm dev`.

### שלב חד-פעמי

1. התקן cloudflared: `brew install cloudflared`
2. צור מפתחות VAPID והכנס ל-`apps/web/.env.local`:
   ```bash
   npx web-push generate-vapid-keys
   # → VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ; הוסף VAPID_EMAIL=mailto:you@example.com
   ```
3. (אופציונלי, לדומיין קבוע) צור named tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create ak-system
   cloudflared tunnel route dns ak-system ak.your-domain.com
   # והגדר ב-.env.local:  CLOUDFLARE_TUNNEL_NAME=ak-system
   ```
   בלי זה, `pnpm tunnel` ייצור כתובת אקראית `*.trycloudflare.com` (משתנה בכל הרצה) —
   וזו הסיבה השכיחה לכך שהתראות Push (במיוחד באפליקציית ARO) מפסיקות לעבוד: כתובת
   ה-API שנאפתה לתוך ה-APK כבר לא חיה.

   **אין דומיין דרך Cloudflare? חלופה חינמית בלי דומיין בכלל — ngrok free static domain:**
   ```bash
   brew install ngrok/ngrok/ngrok
   ngrok config add-authtoken <מהדשבורד: dashboard.ngrok.com/get-started/your-authtoken>
   # תבע דומיין קבוע וחינמי ב-dashboard.ngrok.com/domains, ואז:
   # NGROK_STATIC_DOMAIN=your-name.ngrok-free.app  ב-.env.local
   pnpm tunnel:ngrok
   ```
   הכתובת הזו קבועה לתמיד (בניגוד ל-quick tunnel) — צריך להריץ את `set-tunnel-url.sh` פעם אחת בלבד.
4. הגדר ב-`apps/web/.env.local`:
   - `NEXTAUTH_URL` ו-`NEXT_PUBLIC_APP_URL` = כתובת ה-HTTPS של ה-tunnel
   - `NEXTAUTH_SECRET` (חובה), `GOOGLE_CLIENT_ID/SECRET`, ו-`ALLOWED_EMAILS=you@example.com`
5. ב-Google Cloud Console הוסף redirect URI: `https://<tunnel-domain>/api/auth/callback/google`

### הרצה יומיומית

```bash
pnpm serve   # build + web(prod) + WhatsApp bridge + Cloudflare Tunnel
```

דגלים: `SKIP_BUILD=1` (לדלג על build), `SKIP_BRIDGE=1`, `SKIP_TUNNEL=1`. להרצת ה-tunnel בלבד: `pnpm tunnel`.

המק חייב להיות דלוק כדי שהתראות (FOMO, בריף בוקר, אייג'נטים) יישלחו לטלפון.

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

## WhatsApp Bridge (פרויקט נפרד)

ה-bridge (`apps/whatsapp-bridge`) רץ כ-process נפרד עם Baileys — **חייב volume** ל-auth state.

```bash
cp apps/whatsapp-bridge/.env.example apps/whatsapp-bridge/.env
# ערוך BRIDGE_SECRET, AUTH_STATE_PATH=/data/auth

pnpm whatsapp-bridge:dev   # פיתוח — http://localhost:3001 לסריקת QR
pnpm whatsapp-bridge:build && cd apps/whatsapp-bridge && pnpm start
```

**חיבור ל-AK System:**

1. Bridge: `AK_WEBHOOK_URL=https://<domain>/api/whatsapp/webhook`
2. AK: `WHATSAPP_BRIDGE_URL=http://<bridge-host>:3001`, `WHATSAPP_BRIDGE_SECRET=<same as BRIDGE_SECRET>`
3. אופציונלי: `WHATSAPP_ALLOWED_JID` מה-`GET /status` אחרי pairing
4. **הגדרות UI:** `/settings/whatsapp` — גילוי קבוצות, תוויות, FOMO, מילות מפתח, שעות סיכום. לחץ "סנכרן כללים ל-bridge" אחרי שינוי.

**Cron — סיכומי קבוצות (לפי שעה):**

```bash
# כל 15 דקות — מסכם רק קבוצות whose summaryTimes (או תווית) תואמים ל-HH:MM
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<domain>/api/cron/whatsapp-group-summary
```

אזור זמן: `TIMEZONE=Asia/Jerusalem` (ברירת מחדל). `WATCH_GROUP_JIDS` ב-env — fallback בלבד; מומלץ DB דרך UI.

פריסה: VM / Railway volume — לא Cloud Run (session state). ראה [`docs/deploy/whatsapp-bridge-vm.md`](docs/deploy/whatsapp-bridge-vm.md) ו-[`deploy/docker-compose.production.yml`](deploy/docker-compose.production.yml).

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

---

## Helm — אפליקציית Android native (Expo)

אפליקציה native בשם **Helm** (`apps/mobile`) — חלופה ל-PWA, עם Expo Push (FCM) ו-JWT auth.

**מדריך מלא:** [`docs/deploy/helm-apk-build.md`](docs/deploy/helm-apk-build.md)

### דרישות

- Backend רץ ב-HTTPS (Railway מומלץ — URL קבוע)
- `EXPO_PUBLIC_API_URL` = כתובת ה-production
- Google OAuth: Web client ID + Android client ל-`com.alpir.helm`

### הגדרה חד-פעמית

1. העתק env:
   ```bash
   cp apps/mobile/.env.example apps/mobile/.env
   ```
   מלא:
   - `EXPO_PUBLIC_API_URL=https://<railway-domain>`
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — אותו `GOOGLE_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` — OAuth Android client

2. ב-Google Cloud Console — ראה [`docs/deploy/google-oauth-setup.md`](docs/deploy/google-oauth-setup.md)

3. EAS (פעם אחת):
   ```bash
   cd apps/mobile && eas login && eas init
   ```

### בניית APK

```bash
pnpm mobile:build:apk
```

או: `eas build --platform android --profile preview`

### זרימת auth

1. Helm → Google Sign-In → `POST /api/auth/mobile/google` עם `idToken`
2. שמירת JWT ב-SecureStore; כל בקשה עם `Authorization: Bearer`
3. Expo push token → `POST /api/push/expo/register`

### התראות

Backend שולח Expo Push בנוסף ל-Web Push ו-WhatsApp. לחיצה על התראה פותחת את מסך הצ'אט.
