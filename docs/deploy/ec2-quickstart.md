# EC2 Quick Start (ללא דומיין, Cloudflare Tunnel)

## שלב 1 — חיבור AWS CLI (פעם אחת, בטרמינל)

```bash
aws configure
```

מלא:
- **AWS Access Key ID** + **Secret** — מ-IAM → Users → Security credentials → Create access key
- **Region:** `us-east-1` (או האזור הקרוב אליך)
- **Output format:** `json`

אלטרנטיבה: `aws login` (אם החשבון שלך על SSO).

בדיקה:
```bash
aws sts get-caller-identity
```

## שלב 2 — הרצה אוטומטית מהמק

```bash
pnpm ec2:up
```

הסקריפט עושה הכל:
1. יוצר EC2 Free Tier (`t3.micro`, Ubuntu, Elastic IP, מפתח SSH ב-`~/.ssh/ak-system.pem`)
2. מתקין Docker + swap על השרת
3. מפריס את AK System (Docker)
4. מרים Cloudflare Tunnel (HTTPS בלי דומיין)
5. מתקין cron על השרת

## שלב 3 — Google OAuth (חד-פעמי)

אחרי שהסקריפט מסיים, הוא מדפיס URL מסוג:
`https://xxxx.trycloudflare.com`

הוסף ב-Google Cloud Console → OAuth redirect URI:
```
https://xxxx.trycloudflare.com/api/auth/callback/google
```

## פקודות שימושיות

```bash
# URL נוכחי + redirect ל-Google OAuth
pnpm ec2:url

# פריסה מחדש אחרי שינוי קוד
SKIP_CI=1 pnpm deploy:ec2

# SSH לשרת
ssh -i ~/.ssh/ak-system.pem ubuntu@<ELASTIC-IP>

# לוגים
ssh ... 'cd /opt/ak-system && docker compose -f deploy/docker-compose.production.yml logs -f web'
```

## שלב 1 (עכשיו) — Tunnel חינמי

- URL מסוג `https://xxxx.trycloudflare.com` — **אין עלות, אין דומיין**
- ה-URL נשאר יציב כל עוד לא מפעילים מחדש את `ak-tunnel`
- אם ה-URL השתנה: `pnpm ec2:url` → עדכן `deploy/production.env` → `SKIP_CI=1 pnpm deploy:ec2` → עדכן Google OAuth

## שלב 2 (כשיתייצב) — דומיין קבוע

```bash
cp deploy/cloudflare.env.example deploy/cloudflare.env
# מלא TUNNEL_TOKEN מ-Cloudflare Zero Trust
pnpm ec2:tunnel
```

מדריך: [cloudflare-stable-url.md](./cloudflare-stable-url.md)  
מדריך מלא: [ec2-production.md](./ec2-production.md)
