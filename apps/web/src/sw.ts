/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist'
import { ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate } from 'serwist'
import { notificationTag } from '@/lib/notification-tray'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis

/**
 * Free-tier tunnels (ngrok's *.ngrok-free.app/.dev) inject an interstitial
 * "you're about to visit" page in front of every request from a real browser
 * (detected via User-Agent), returning HTML instead of the actual asset —
 * this is what breaks icons/favicon when the app is exposed through one.
 * This header opts out of that page. It's a no-op everywhere else (a real
 * domain/production host simply ignores an unknown request header).
 */
const bypassTunnelInterstitial = {
  requestWillFetch: ({ request }: { request: Request }) => {
    const headers = new Headers(request.headers)
    headers.set('ngrok-skip-browser-warning', 'true')
    return new Request(request, { headers })
  },
}

const iconCaching: RuntimeCaching = {
  matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
  handler: new StaleWhileRevalidate({
    cacheName: 'static-image-assets',
    plugins: [
      bypassTunnelInterstitial,
      new ExpirationPlugin({
        maxEntries: 64,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        maxAgeFrom: 'last-used',
      }),
    ],
  }),
}

/**
 * `defaultCache` caches ALL same-origin GET /api/* requests (incl. tRPC
 * queries — sent as GET) as "NetworkFirst" with a 10s timeout, falling back
 * to a stale cached response if the network is slow (e.g. right after a
 * deploy, while the container is cold-starting). For this app almost every
 * /api/* GET is live, mutable app data (tasks, notifications, meetings...),
 * so a stale fallback is actively wrong — e.g. an archived notification could
 * still show up because the SW served a cached pre-archive response. Force
 * these straight to the network, no cache fallback. Must come before
 * defaultCache's own /api/* rule to win.
 */
const apiNoCache: RuntimeCaching = {
  matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/api/'),
  handler: new NetworkOnly(),
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // iconCaching first so it wins over defaultCache's own (headerless) image rule;
  // apiNoCache first so it wins over defaultCache's stale-tolerant /api/* rule.
  runtimeCaching: [iconCaching, apiNoCache, ...defaultCache],
})

serwist.addEventListeners()

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data: { notificationId?: string; title?: string; body?: string; url?: string; icon?: string }
  try {
    data = event.data.json() as typeof data
  } catch {
    data = { title: 'ARO', body: event.data.text() }
  }

  const notificationId = data.notificationId ?? ''
  const title = data.title ?? 'ARO'
  const body = data.body ?? ''
  const icon = data.icon ?? '/icons/icon-192.png'
  const url = data.url ?? '/'

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        client.postMessage({ type: 'PUSH', notificationId, title, body, url, icon })
      }
      await self.registration.showNotification(title, {
        body,
        icon,
        badge: '/icons/icon-192.png',
        dir: 'rtl',
        lang: 'he',
        tag: notificationTag(notificationId),
        renotify: false,
        data: { url, notificationId },
        actions: [{ action: 'archive', title: 'ארכיון' }],
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  
  if (event.action === 'archive') {
    const notificationId = (event.notification.data as { notificationId?: string })?.notificationId
    if (notificationId) {
      event.waitUntil(
        // REST, not tRPC: the tRPC endpoint expects a superjson envelope a
        // service worker has no business constructing.
        fetch('/api/notifications', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: notificationId, action: 'archive' }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`archive failed: ${res.status}`)
          })
          .catch(() => self.clients.openWindow('/notifications')),
      )
    }
    return
  }

  // Default action: open notification detail or URL
  const notificationId = (event.notification.data as { notificationId?: string })?.notificationId
  const fallbackUrl = (event.notification.data as { url?: string })?.url ?? '/'
  const url = notificationId ? `/notifications?id=${notificationId}` : fallbackUrl
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes('/notifications') || c.url.includes(fallbackUrl))
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})

// The page tells us which notifications no longer belong in the tray, so state
// changed on any device converges here once this browser is in focus.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string; notificationIds?: string[] } | undefined
  if (data?.type !== 'CLOSE_NOTIFICATIONS') return

  const ids = new Set(data.notificationIds ?? [])
  if (ids.size === 0) return

  event.waitUntil(
    (async () => {
      const shown = await self.registration.getNotifications()
      for (const notification of shown) {
        const id = (notification.data as { notificationId?: string } | undefined)?.notificationId
        if (id && ids.has(id)) notification.close()
      }
    })(),
  )
})
