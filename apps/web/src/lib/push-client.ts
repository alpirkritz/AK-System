/** Client-side Web Push helpers — SW registration, subscribe, foreground fallback. */

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/** Register /sw.js explicitly (Serwist does not auto-register on the client). */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('הדפדפן לא תומך ב-Service Worker')
  }
  let reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  }
  await navigator.serviceWorker.ready
  return reg
}

export type PushPayload = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function getOrCreatePushSubscription(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = await ensureServiceWorker()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') throw new Error('הרשאת התראות נדחתה')
    }
    if (Notification.permission !== 'granted') {
      throw new Error('הרשאת התראות חסומה — אפשר בהגדרות הדפדפן/מערכת')
    }
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
    })
  }
  return sub
}

/** Show OS notification when the tab is focused (SW push alone is often silent in foreground). */
export function showForegroundNotification(
  title: string,
  body: string,
  url = '/chat',
): void {
  if (typeof window === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: 'ak-push',
      data: { url },
    })
    n.onclick = () => {
      window.focus()
      window.location.href = url
      n.close()
    }
  } catch {
    // ignore — SW path may still deliver
  }
}

let foregroundListenerInstalled = false

/** Listen for push messages relayed from the service worker to open tabs. */
export function installForegroundPushListener(): void {
  if (foregroundListenerInstalled || typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  foregroundListenerInstalled = true

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; title?: string; body?: string; url?: string } | null
    if (data?.type !== 'PUSH') return
    showForegroundNotification(data.title ?? 'AK System', data.body ?? '', data.url ?? '/chat')
  })
}
