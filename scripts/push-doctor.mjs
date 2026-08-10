#!/usr/bin/env node
/**
 * push-doctor — end-to-end Expo push diagnostic for the Helm APK.
 *
 * Why this exists: the server code (packages/api/src/lib/expo-push.ts) only checks
 * Expo *tickets*, never *receipts*. FCM credential problems (the classic
 * "expoSent: 1 but nothing on the phone") surface ONLY in receipts, so failures
 * are invisible in the app. This script sends a real test push and fetches the
 * receipt, printing the exact delivery error if there is one.
 *
 * Usage (from repo root, on the Mac):
 *   node scripts/push-doctor.mjs                 # newest token from the local DB
 *   node scripts/push-doctor.mjs --all           # every registered token
 *   node scripts/push-doctor.mjs --token "ExponentPushToken[...]"
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB = process.env.DATABASE_PATH || path.join(ROOT, 'apps/web/data/ak_system.sqlite')

const args = process.argv.slice(2)
const tokenArg = args.includes('--token') ? args[args.indexOf('--token') + 1] : null
const all = args.includes('--all')

function sql(query) {
  return execFileSync('sqlite3', ['-readonly', DB, query], { encoding: 'utf8' }).trim()
}

// ---------- 1. Health snapshot ----------
console.log('🩺 push-doctor —', new Date().toISOString())
console.log('DB:', DB)
try {
  const cronMsgs = sql(`SELECT COUNT(*) FROM chat_messages WHERE source='cron'`)
  const lastNotif = sql(`SELECT title || ' | ' || created_at FROM notifications ORDER BY created_at DESC LIMIT 1`)
  console.log(`\n— בריאות כללית —`)
  console.log(`הודעות שנוצרו ע"י cron (מאז ומעולם): ${cronMsgs}${cronMsgs === '0' ? '  ⚠️  אף cron לא רץ מול השרת הזה — הסוכנים המתוזמנים לא פועלים כאן' : ''}`)
  console.log(`נוטיפיקציה אחרונה שנשמרה: ${lastNotif || '(אין)'}`)
} catch (e) {
  console.log('⚠️  לא הצלחתי לקרוא את ה-DB:', e.message)
}

// ---------- 2. Tokens ----------
let tokens = []
if (tokenArg) tokens = [tokenArg]
else {
  try {
    const rows = sql(`SELECT token FROM expo_push_tokens ORDER BY created_at DESC`).split('\n').filter(Boolean)
    tokens = all ? rows : rows.slice(0, 1)
    console.log(`\nטוקנים רשומים ב-DB: ${rows.length}${rows.length > 1 && !all ? ' (בודק רק את החדש; --all לכולם. טוקנים ישנים = התקנות קודמות של ה-APK)' : ''}`)
  } catch (e) {
    console.error('לא הצלחתי לשלוף טוקנים:', e.message)
    process.exit(1)
  }
}
if (!tokens.length) {
  console.error('\n❌ אין אף ExponentPushToken ב-DB. פתח את אפליקציית Helm → הגדרות → הפעל נוטיפיקציות, וודא שהטלפון מגיע לשרת (ngrok למעלה?).')
  process.exit(1)
}

// ---------- 3. Send + receipts ----------
const EXPO = 'https://exp.host/--/api/v2/push'
const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`

const RECEIPT_HINTS = {
  DeviceNotRegistered: 'הטוקן מת (האפליקציה הוסרה/הותקנה מחדש). מחק אותו מ-expo_push_tokens ורשום מחדש מהאפליקציה.',
  InvalidCredentials: 'חסר/שגוי FCM V1 service account בפרויקט EAS. הרץ: bash scripts/check-helm-fcm.sh ואז eas credentials (Android → Push Notifications) עם ה-service account של helm-push-969711.',
  MismatchSenderId: 'ה-google-services.json ב-APK שייך לפרויקט Firebase אחר מזה שהוגדר ב-EAS. ודא ששניהם helm-push-969711 ובנה APK מחדש.',
  MessageTooBig: 'ההודעה גדולה מדי (מעל 4KB).',
  MessageRateExceeded: 'קצב שליחה גבוה מדי — חכה ונסה שוב.',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

for (const token of tokens) {
  console.log(`\n📤 שולח אל ${token.slice(0, 30)}…`)
  const res = await fetch(`${EXPO}/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: token,
      title: '🩺 push-doctor',
      body: `בדיקת מסלול מלאה ${new Date().toLocaleTimeString('he-IL')} — אם אתה רואה את זה, המסלול תקין ✓`,
      channelId: 'default',
      priority: 'high',
      sound: 'default',
    }),
  })
  const ticketRaw = (await res.json())?.data
  const ticket = Array.isArray(ticketRaw) ? ticketRaw[0] ?? {} : ticketRaw ?? {}
  if (ticket.status !== 'ok') {
    failures++
    console.log(`❌ TICKET נדחה: ${ticket.message} (${ticket.details?.error ?? '?'})`)
    if (RECEIPT_HINTS[ticket.details?.error]) console.log('   💡', RECEIPT_HINTS[ticket.details.error])
    continue
  }
  console.log(`✓ ticket ok (id ${ticket.id}) — Expo קיבל. ממתין 15ש׳ ל-receipt (שם מתחבאות שגיאות FCM)…`)
  await sleep(15000)
  const rec = (await (await fetch(`${EXPO}/getReceipts`, { method: 'POST', headers, body: JSON.stringify({ ids: [ticket.id] }) })).json())?.data?.[ticket.id]
  if (!rec) console.log('⏳ receipt עוד לא מוכן — הרץ שוב בעוד דקה עם אותו טוקן, או בדוק אם ההודעה כבר הגיעה לטלפון.')
  else if (rec.status === 'ok') console.log('✅ RECEIPT OK — Expo מסר ל-FCM בהצלחה. אם עדיין אין באנר בטלפון: הגדרות אנדרואיד → אפליקציות → Helm → נוטיפיקציות → ערוץ default; ובטל אופטימיזציית סוללה לאפליקציה.')
  else {
    failures++
    let detail = rec.message ?? ''
    const fcmRaw = rec.details?.fcm?.response
    if (typeof fcmRaw === 'string') {
      try {
        const parsed = JSON.parse(fcmRaw)
        if (parsed?.error?.message) detail = parsed.error.message
      } catch { /* keep */ }
    }
    console.log(`❌ RECEIPT ERROR: ${rec.details?.error ?? '?'} — ${detail}`)
    if (/cloudmessaging|PERMISSION_DENIED/i.test(detail)) {
      console.log('   💡 FCM IAM: לשירות החשבון שהועלה ל-EAS חסרה ההרשאה cloudmessaging.messages.create.')
      console.log('      Google Cloud Console → project helm-push-969711 → IAM')
      console.log('      → מצא את ה-service account (firebase-adminsdk@…) → הענק תפקיד:')
      console.log('         "Firebase Cloud Messaging API Admin" (או Firebase Admin)')
      console.log('      ואז Enable את ה-API: Firebase Cloud Messaging API אם כבוי.')
    } else {
      console.log('   💡', RECEIPT_HINTS[rec.details?.error] ?? 'שגיאה לא מוכרת — בדוק את ה-message המלא למעלה.')
    }
  }
}
process.exit(failures ? 1 : 0)
