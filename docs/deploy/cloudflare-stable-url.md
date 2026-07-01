# כתובת Cloudflare קבועה (חינמי מצד Cloudflare)

## מה חינם ומה לא

| פריט | מחיר |
|------|------|
| חשבון Cloudflare | חינם |
| Cloudflare Tunnel (Named) | חינם |
| HTTPS / SSL | חינם |
| **דומיין** (למשל `ak.example.com`) | בדרך כלל **~$4–12/שנה** (או דומיין שכבר יש לך) |
| `*.trycloudflare.com` (מה שיש עכשיו) | חינם לגמרי, אבל **הכתובת משתנה** אחרי restart ל-tunnel |

**מסקנה:** Cloudflare לא נותן כתובת קבועת `something.cloudflare.com` בלי דומיין.
לכתובת קבועה צריך **Named Tunnel** + דומיין שמנוהל ב-Cloudflare DNS (תוכנית Free מספיקה).

---

## אפשרות א — Named Tunnel (מומלץ, כתובת קבועה)

### שלב 1 — דומיין ב-Cloudflare

אם יש לך דומיין (בכל רשם):

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a site**
2. הזן את הדומיין → תוכנית **Free**
3. עדכן nameservers אצל הרשם לפי מה ש-Cloudflare נותן

אין דומיין? אפשר לרכוש זול ב-Cloudflare Registrar (למשל `.xyz` / `.link` — לעיתים ~$4/שנה).

### שלב 2 — צור Tunnel ב-Zero Trust

1. פתח [one.dash.cloudflare.com](https://one.dash.cloudflare.com) (חשבון Cloudflare חינמי)
2. **Networks** → **Connectors** → **Cloudflare Tunnels** → **Create**
3. שם: `ak-system` → **Save tunnel**
4. בחר **Docker** (או Cloudflared) → **העתק את ה-Token** (מחרוזת ארוכה)

### שלב 3 — Public Hostname (הכתובת הקבועה)

באותו מסך Tunnel → **Public Hostname** → **Add**:

| שדה | ערך |
|-----|-----|
| Subdomain | `ak` (או `myspace`) |
| Domain | הדומיין שלך |
| Service type | HTTP |
| URL | `127.0.0.1:3000` |

הכתובת תהיה: `https://ak.yourdomain.com` — **קבועה לתמיד**.

### שלב 4 — התקנה על EC2

על המק, שמור token בקובץ (לא ב-git):

```bash
cp deploy/cloudflare.env.example deploy/cloudflare.env
# ערוך: CLOUDFLARE_TUNNEL_TOKEN=...
# ערוך: APP_URL=https://ak.yourdomain.com
```

הרץ:

```bash
bash scripts/ec2-setup-named-tunnel.sh
```

הסקריפט מתקין את ה-tunnel על EC2, מעדכן `production.env`, ומפעיל מחדש את האפליקציה.

### שלב 5 — Google OAuth

הוסף redirect URI:

```
https://ak.yourdomain.com/api/auth/callback/google
```

---

## אפשרות ב — trycloudflare (מה שיש היום, בלי דומיין)

- **חינם 100%**, אין צורך בדומיין
- כתובת נוכחית: ראה `deploy/tunnel.url` על השרת או `/var/log/ak-tunnel.log`
- **חיסרון:** אחרי `systemctl restart ak-tunnel` הכתובת עלולה להשתנות → צריך לעדכן Google OAuth

```bash
# אחרי שינוי URL:
ssh ... 'cd /opt/ak-system && bash scripts/ec2-sync-tunnel-url.sh'
# ואז rebuild+deploy מהמק עם APP_URL החדש
```

---

## השוואה

| | trycloudflare (עכשיו) | Named Tunnel + דומיין |
|--|----------------------|------------------------|
| עלות | $0 | ~$4–12/שנה לדומיין |
| URL קבוע | לא | כן |
| Google OAuth | לעדכן אם URL משתנה | פעם אחת |
