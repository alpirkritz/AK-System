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
    ...(headers as Record<string, string>),
  }
  if (token) mergedHeaders.Authorization = `Bearer ${token}`

  return fetch(`${API_URL}${path}`, { ...rest, headers: mergedHeaders })
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

export async function registerExpoPushToken(token: string, expoToken: string): Promise<void> {
  const res = await apiFetch('/api/push/expo/register', {
    method: 'POST',
    token,
    body: JSON.stringify({ token: expoToken }),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    throw new ApiError(data.error ?? 'Push registration failed', res.status)
  }
}

export async function unregisterExpoPushToken(token: string, expoToken: string): Promise<void> {
  await apiFetch('/api/push/expo/register', {
    method: 'DELETE',
    token,
    body: JSON.stringify({ token: expoToken }),
  })
}

export type AppNotification = {
  id: string
  title: string
  body: string
  url: string
  type: string
  readAt: string | null
  createdAt: string
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
    body: JSON.stringify(options),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    throw new ApiError(data.error ?? 'Mark read failed', res.status)
  }
}

export async function sendTestPush(
  token: string,
): Promise<{ webSent: number; expoSent: number }> {
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
    expoSent?: number
    error?: string
  }
  if (!res.ok) throw new ApiError(data.error ?? 'Test push failed', res.status)
  return { webSent: data.webSent ?? 0, expoSent: data.expoSent ?? 0 }
}
