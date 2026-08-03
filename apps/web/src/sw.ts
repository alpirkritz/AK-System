/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist'
import { ExpirationPlugin, Serwist, StaleWhileRevalidate } from 'serwist'

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

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // iconCaching first so it wins over defaultCache's own (headerless) image rule.
  runtimeCaching: [iconCaching, ...defaultCache],
})

serwist.addEventListeners()

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data: { title?: string; body?: string; url?: string; icon?: string }
  try {
    data = event.data.json() as typeof data
  } catch {
    data = { title: 'ARO', body: event.data.text() }
  }

  const title = data.title ?? 'ARO'
  const body = data.body ?? ''
  const icon = data.icon ?? '/icons/icon-192.png'
  const url = data.url ?? '/'

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        client.postMessage({ type: 'PUSH', title, body, url, icon })
      }
      await self.registration.showNotification(title, {
        body,
        icon,
        badge: '/icons/icon-192.png',
        dir: 'rtl',
        lang: 'he',
        tag: 'ak-push',
        renotify: true,
        data: { url },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url))
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})
