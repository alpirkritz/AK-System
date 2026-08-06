import {
  getDb,
  fcmPushTokens,
  pushDeliveryLog,
  eq,
  desc,
  queryRows,
  runMutation,
} from '@ak-system/database'
import { createNotification } from './notification-store'

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

const CREDENTIAL_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000

type MessagingResult = {
  success: boolean
  messageId?: string
  error?: { code?: string; message?: string }
}

type MessagingBatchResponse = {
  successCount: number
  failureCount: number
  responses: MessagingResult[]
}

type FirebaseMessaging = {
  sendEachForMulticast: (message: {
    tokens: string[]
    notification: { title: string; body: string }
    data: Record<string, string>
    android: {
      priority: 'high'
      notification: { channelId: string; sound: string }
    }
  }) => Promise<MessagingBatchResponse>
}

let cachedMessaging: FirebaseMessaging | null | undefined

/** Exported for unit tests — resets the memoized Admin app. */
export function resetFirebaseAdminForTests(): void {
  cachedMessaging = undefined
}

function requireFirebaseEnv(): {
  projectId: string
  clientEmail: string
  privateKey: string
} {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim()
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKeyRaw?.trim()) {
    throw new Error(
      'Firebase Admin not configured — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    )
  }
  return {
    projectId,
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
  }
}

const APP_NAME = 'ak-mobile-push'

/**
 * firebase-admin v13+ exposes only the modular entry points; the legacy
 * `admin.credential` / `admin.apps` namespace is gone.
 */
async function getFirebaseMessaging(): Promise<FirebaseMessaging> {
  if (cachedMessaging === null) {
    throw new Error('Firebase Admin initialization previously failed')
  }
  if (cachedMessaging) return cachedMessaging

  const creds = requireFirebaseEnv()
  try {
    const { initializeApp, getApps, getApp, cert } = await import('firebase-admin/app')
    const { getMessaging } = await import('firebase-admin/messaging')

    const existing = getApps().find((app) => app.name === APP_NAME)
    const app =
      existing ??
      initializeApp(
        {
          credential: cert({
            projectId: creds.projectId,
            clientEmail: creds.clientEmail,
            privateKey: creds.privateKey,
          }),
          projectId: creds.projectId,
        },
        APP_NAME,
      )

    cachedMessaging = getMessaging(existing ? getApp(APP_NAME) : app) as unknown as FirebaseMessaging
    return cachedMessaging
  } catch (err) {
    cachedMessaging = null
    throw err
  }
}

/** Send push notifications to all registered FCM devices (ARO mobile app). */
export async function sendMobilePush(
  title: string,
  body: string,
  url = '/chat',
): Promise<number> {
  const db = getDb()
  const rows = await db.select().from(fcmPushTokens).all()
  if (rows.length === 0) return 0

  let messaging: FirebaseMessaging
  try {
    messaging = await getFirebaseMessaging()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Firebase Admin init failed'
    console.warn('[mobile-push] credentials error:', msg)
    const now = new Date().toISOString()
    for (const row of rows) {
      await runMutation(
        db.insert(pushDeliveryLog).values({
          id: crypto.randomUUID(),
          ticketId: null,
          provider: 'fcm',
          providerMessageId: null,
          token: row.token,
          status: 'error',
          errorCode: 'MissingCredentials',
          message: msg.slice(0, 300),
          sentAt: now,
          checkedAt: now,
        }),
      )
    }
    await maybeAlertCredentialFailure('MissingCredentials', msg)
    return 0
  }

  const tokens = rows.map((r) => r.token)
  const shortBody = body.slice(0, 240)
  const now = new Date().toISOString()

  let batch: MessagingBatchResponse
  try {
    batch = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body: shortBody },
      data: { url },
      android: {
        priority: 'high',
        notification: { channelId: 'default', sound: 'default' },
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'FCM send failed'
    console.warn('[mobile-push] send failed:', msg)
    for (const token of tokens) {
      await runMutation(
        db.insert(pushDeliveryLog).values({
          id: crypto.randomUUID(),
          ticketId: null,
          provider: 'fcm',
          providerMessageId: null,
          token,
          status: 'error',
          errorCode: 'SendFailed',
          message: msg.slice(0, 300),
          sentAt: now,
          checkedAt: now,
        }),
      )
    }
    return 0
  }

  let sent = 0
  let sawCredentialFailure = false
  let credentialDetail = ''

  for (let i = 0; i < batch.responses.length; i++) {
    const result = batch.responses[i]
    const token = tokens[i]
    if (!token) continue

    if (result.success) {
      sent++
      await runMutation(
        db.insert(pushDeliveryLog).values({
          id: crypto.randomUUID(),
          ticketId: null,
          provider: 'fcm',
          providerMessageId: result.messageId ?? null,
          token,
          status: 'ok',
          errorCode: null,
          message: title.slice(0, 120),
          sentAt: now,
          checkedAt: now,
        }),
      )
      continue
    }

    const code = result.error?.code ?? 'FcmError'
    const message = (result.error?.message ?? '').slice(0, 300)
    console.warn('[mobile-push] delivery error:', code, message, `(…${token.slice(-12)})`)

    await runMutation(
      db.insert(pushDeliveryLog).values({
        id: crypto.randomUUID(),
        ticketId: null,
        provider: 'fcm',
        providerMessageId: null,
        token,
        status: 'error',
        errorCode: code,
        message,
        sentAt: now,
        checkedAt: now,
      }),
    )

    if (DEAD_TOKEN_CODES.has(code)) {
      await runMutation(db.delete(fcmPushTokens).where(eq(fcmPushTokens.token, token)))
    }

    if (
      code === 'messaging/mismatched-credential' ||
      /permission|credentials|IAM|PERMISSION_DENIED|cloudmessaging/i.test(`${code} ${message}`)
    ) {
      sawCredentialFailure = true
      credentialDetail = message || code
    }
  }

  if (sawCredentialFailure) {
    await maybeAlertCredentialFailure('FcmCredentialError', credentialDetail)
  }

  return sent
}

async function maybeAlertCredentialFailure(errorCode: string, detail = ''): Promise<void> {
  try {
    const db = getDb()
    const windowStart = new Date(Date.now() - CREDENTIAL_ALERT_WINDOW_MS).toISOString()
    const recent = await queryRows<{ id: string; checkedAt: string | null; errorCode: string | null }>(
      db
        .select()
        .from(pushDeliveryLog)
        .where(eq(pushDeliveryLog.status, 'error'))
        .orderBy(desc(pushDeliveryLog.checkedAt))
        .limit(50),
    )
    const priorAlertWorthy = recent.filter(
      (r) =>
        r.errorCode != null &&
        (r.errorCode === 'MissingCredentials' ||
          r.errorCode === 'FcmCredentialError' ||
          /credential|permission|IAM/i.test(r.errorCode)) &&
        r.checkedAt != null &&
        r.checkedAt >= windowStart,
    )
    if (priorAlertWorthy.length > 1) return

    await createNotification({
      title: 'שגיאת הרשאות פוש (FCM)',
      body: `נוטיפיקציות לא מגיעות לטלפון: ${errorCode}. בדוק FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY בפרויקט helm-push-969711.${detail ? ` ${detail.slice(0, 120)}` : ''}`,
      url: '/settings/notifications',
      type: 'system',
    })
  } catch (err) {
    console.warn('[mobile-push] credential alert failed:', err)
  }
}
