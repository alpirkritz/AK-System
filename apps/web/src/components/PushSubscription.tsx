'use client'

import { useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc'

export function PushSubscription() {
  const subscribed = useRef(false)
  const { data: vapidKey } = trpc.push.getVapidPublicKey.useQuery()
  const subscribe = trpc.push.subscribe.useMutation()

  useEffect(() => {
    if (!vapidKey || subscribed.current) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission === 'denied') return

    async function registerPush() {
      try {
        const reg = await navigator.serviceWorker.ready
        let sub = await reg.pushManager.getSubscription()

        if (!sub) {
          if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission()
            if (perm !== 'granted') return
          }

          const keyBuffer = urlBase64ToUint8Array(vapidKey!)
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBuffer.buffer as ArrayBuffer,
          })
        }

        const json = sub.toJSON()
        if (json.endpoint && json.keys) {
          subscribe.mutate({
            endpoint: json.endpoint,
            keys: {
              p256dh: json.keys.p256dh!,
              auth: json.keys.auth!,
            },
          })
        }
        subscribed.current = true
      } catch {
        // Push subscription failed silently
      }
    }

    registerPush()
  }, [vapidKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
