import Constants from 'expo-constants'

const raw = process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiUrl ?? ''
export const API_URL = raw.replace(/\/$/, '')

export const CLIENT_HEADER = 'helm'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  channel?: string
  createdAt: string
}

export type AuthUser = {
  email: string
  name: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiFetch(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<Response> {
  if (!API_URL) {
    throw new ApiError('EXPO_PUBLIC_API_URL is not configured', 0)
  }

  const { token, headers, ...rest } = options
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-AK-Client': CLIENT_HEADER,
    // Free ngrok domains serve an HTML "browser warning" interstitial instead
    // of proxying the request unless this header is present — breaks JSON
    // parsing on the client with no server-side signal. Harmless no-op for
    // Cloudflare tunnels / real deployments.
    'ngrok-skip-browser-warning': 'true',
    ...(headers as Record<string, string>),
  }
  if (token) mergedHeaders.Authorization = `Bearer ${token}`

  return fetch(`${API_URL}${path}`, { ...rest, headers: mergedHeaders })
    .then(async (res) => {
      // Free ngrok interstitial sometimes returns HTML 200 — rare after header above.
      return res
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        /UnknownHostException|Unable to resolve host|Network request failed|Failed to connect|ENOTFOUND/i.test(
          msg,
        )
      ) {
        throw new ApiError(
          `לא ניתן להתחבר לשרת (${API_URL}). בדוק Wi‑Fi/סלולר ושה-tunnel חי.`,
          0,
        )
      }
      throw err instanceof Error ? err : new ApiError(msg, 0)
    })
}

export async function signInWithGoogleIdToken(idToken: string): Promise<{
  accessToken: string
  user: AuthUser
}> {
  const res = await apiFetch('/api/auth/mobile/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  })
  const data = (await res.json()) as {
    accessToken?: string
    user?: AuthUser
    error?: string
  }
  if (!res.ok || !data.accessToken || !data.user) {
    throw new ApiError(data.error ?? 'Sign-in failed', res.status)
  }
  return { accessToken: data.accessToken, user: data.user }
}

/** Local-only sign-in — backend rejects outside NODE_ENV=development. */
export async function signInLocalDev(): Promise<{
  accessToken: string
  user: AuthUser
}> {
  const res = await apiFetch('/api/auth/mobile/dev', { method: 'POST', body: '{}' })
  const data = (await res.json()) as {
    accessToken?: string
    user?: AuthUser
    error?: string
  }
  if (!res.ok || !data.accessToken || !data.user) {
    throw new ApiError(data.error ?? 'Local sign-in failed', res.status)
  }
  return { accessToken: data.accessToken, user: data.user }
}

export async function fetchChatHistory(
  token: string,
  limit = 50,
): Promise<ChatMessage[]> {
  const res = await apiFetch(`/api/chat/history?limit=${limit}`, { token })
  const data = (await res.json()) as { messages?: ChatMessage[]; error?: string }
  if (!res.ok) throw new ApiError(data.error ?? 'Failed to load history', res.status)
  return data.messages ?? []
}

export async function sendChatMessage(
  token: string,
  message: string,
): Promise<{ userMessage: string; assistantMessage: string }> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    token,
    body: JSON.stringify({ message }),
  })
  const data = (await res.json()) as {
    userMessage?: string
    assistantMessage?: string
    error?: string
  }
  if (!res.ok || !data.assistantMessage) {
    throw new ApiError(data.error ?? 'Chat failed', res.status)
  }
  return { userMessage: data.userMessage ?? message, assistantMessage: data.assistantMessage }
}

export async function registerFcmPushToken(token: string, fcmToken: string): Promise<void> {
  const res = await apiFetch('/api/push/fcm/register', {
    method: 'POST',
    token,
    body: JSON.stringify({ token: fcmToken, platform: 'android' }),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    throw new ApiError(data.error ?? 'Push registration failed', res.status)
  }
}

export async function unregisterFcmPushToken(token: string, fcmToken: string): Promise<void> {
  await apiFetch('/api/push/fcm/register', {
    method: 'DELETE',
    token,
    body: JSON.stringify({ token: fcmToken }),
  })
}

export type AppNotification = {
  id: string
  title: string
  body: string
  url: string
  type: string
  readAt: string | null
  archivedAt?: string | null
  createdAt: string
}

/** Real deep-link target — not empty and not the notifications inbox itself. */
export function isNavigableNotificationUrl(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  const path = raw.split('?')[0]?.replace(/\/+$/, '') || ''
  if (!path || path === '/notifications') return false
  return path.startsWith('/')
}

export async function fetchNotifications(
  token: string,
  limit = 50,
): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const res = await apiFetch(`/api/notifications?limit=${limit}`, { token })
  const data = (await res.json()) as {
    notifications?: AppNotification[]
    unreadCount?: number
    error?: string
  }
  if (!res.ok) throw new ApiError(data.error ?? 'Failed to load notifications', res.status)
  return {
    notifications: data.notifications ?? [],
    unreadCount: data.unreadCount ?? 0,
  }
}

export async function markNotificationRead(
  token: string,
  options: { id?: string; all?: boolean },
): Promise<void> {
  const res = await apiFetch('/api/notifications', {
    method: 'PATCH',
    token,
    body: JSON.stringify({ ...options, action: 'read' }),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    throw new ApiError(data.error ?? 'Mark read failed', res.status)
  }
}

export async function archiveNotification(
  token: string,
  id: string,
  undo = false,
): Promise<void> {
  const res = await apiFetch('/api/notifications', {
    method: 'PATCH',
    token,
    body: JSON.stringify({ id, action: undo ? 'unarchive' : 'archive' }),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    throw new ApiError(data.error ?? 'Archive failed', res.status)
  }
}

export async function sendTestPush(
  token: string,
): Promise<{ webSent: number; fcmSent: number }> {
  const res = await apiFetch('/api/push/test', {
    method: 'POST',
    token,
    body: JSON.stringify({
      title: 'ARO',
      body: 'נוטיפיקציית בדיקה ✓',
      url: '/chat',
    }),
  })
  const data = (await res.json()) as {
    webSent?: number
    fcmSent?: number
    error?: string
  }
  if (!res.ok) throw new ApiError(data.error ?? 'Test push failed', res.status)
  return { webSent: data.webSent ?? 0, fcmSent: data.fcmSent ?? 0 }
}
